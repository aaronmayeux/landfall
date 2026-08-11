/**
 * relay.js — the one fetch path for feed data (SPEC §4 recovery rules).
 *
 * Every storm-feed request in the app goes through fetchFeed(), which owns:
 *   - the per-request timeout (POLL.fetchTimeout, via AbortController)
 *   - auto-retry at 5 s / 15 s / 45 s, then give up until the next poll
 *   - the retryable/not-retryable split: timeout, network error, 5xx and 429
 *     retry; every other 4xx is "no data," not "try again," and is never
 *     retried. 429 is the exception because our own relay issues it
 *     (functions/api/_middleware.js) and it means "ask again shortly"
 *   - never retrying while the page is hidden (no background work, ever)
 *   - reading the relay's stale markers (X-Landfall-Stale / -Held / -Fetched-At)
 *
 * It does NOT know what the JSON means — parsing lives in nhc.js / gdacs.js.
 * No DOM, ever (document.hidden is page state, not DOM manipulation).
 *
 * Imports: config/ only.
 */

import { POLL, RETRYABLE_STATUS } from '../config/constants.js';

/** Error with a `retryable` flag so the caller never re-derives the rule. */
class FeedError extends Error {
  constructor(message, retryable) {
    super(message);
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function fetchOnce(url, as) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), POLL.fetchTimeout);
  let r;
  try {
    r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
  } catch (e) {
    // Abort (timeout) and network failure both land here. Both retryable.
    throw new FeedError(
      e.name === 'AbortError' ? 'timeout' : 'network error',
      true
    );
  } finally {
    clearTimeout(timer);
  }

  if (!r.ok) {
    const retryable =
      (r.status >= RETRYABLE_STATUS.min && r.status <= RETRYABLE_STATUS.max) ||
      RETRYABLE_STATUS.also.includes(r.status);
    throw new FeedError(`HTTP ${r.status}`, retryable);
  }

  /* Advisory TEXT products are not JSON — NHC's is an HTML page, JTWC's is
   * plain teletype — so the body reader is a parameter. Everything above and
   * below it (timeout, backoff, the retryable split, the stale headers) is
   * identical, which is the whole reason this is one function with a mode
   * rather than two fetch paths that drift. */
  let json = null;
  let text = null;
  if (as === 'text') {
    try {
      text = await r.text();
    } catch {
      throw new FeedError('bad response body', true);
    }
  } else {
    try {
      json = await r.json();
    } catch {
      // 200 with a non-JSON body is an upstream fault, not our bug — retryable.
      throw new FeedError('bad response body', true);
    }
  }

  return {
    json,
    text,
    /** Set when the RELAY served last-good because upstream was down. */
    relayStale: r.headers.get('X-Landfall-Stale') === 'true',
    /** ==> WHY THE RELAY SERVED A REMEMBERED ANSWER, NOT JUST THAT IT DID. <==
     *
     *  `relayStale` above is true for BOTH of the relay's remembering paths and
     *  they are different events: upstream refused to answer, or upstream
     *  answered with nothing while we had areas minutes ago. `data/genesis.js`
     *  was inferring the second from `relayStale && areas.length > 0`, which is
     *  also true of the first — so a dead NHC would have printed "NHC's outlook
     *  layer has stopped publishing", a sentence about a specific fault that
     *  had not happened. The relay has stated which one on the wire since the
     *  held branch shipped; nothing read it. This reads it.
     *
     *  Null on every route that is not holding, which is nearly all of them. */
    relayHeld: r.headers.get('X-Landfall-Held') || null,
    /** When the relay actually pulled this from upstream (relay routes only). */
    fetchedAt: r.headers.get('X-Landfall-Fetched-At') || null,
  };
}

/**
 * Fetch a feed URL with the full §4 recovery behavior.
 *
 * @param {string} url
 * @returns {Promise<{json: object, relayStale: boolean, relayHeld: string|null, fetchedAt: string|null}>}
 * @throws {FeedError} once retries are exhausted (or the error is a 4xx).
 */
export async function fetchFeed(url) {
  return withRecovery(url, 'json');
}

/**
 * The same thing for a body that is not JSON — advisory text products.
 *
 * @param {string} url
 * @returns {Promise<{text: string, relayStale: boolean, relayHeld: string|null, fetchedAt: string|null}>}
 * @throws {FeedError} once retries are exhausted (or the error is a 4xx).
 */
export async function fetchText(url) {
  return withRecovery(url, 'text');
}

async function withRecovery(url, as) {
  let lastError;
  // One initial try + one per backoff step.
  for (let attempt = 0; attempt <= POLL.retryBackoff.length; attempt++) {
    if (attempt > 0) {
      await sleep(POLL.retryBackoff[attempt - 1]);
      // The page may have been hidden while we slept. Stop; the visibility
      // handler refetches on return.
      if (typeof document !== 'undefined' && document.hidden) break;
    }
    try {
      return await fetchOnce(url, as);
    } catch (e) {
      lastError = e;
      if (!e.retryable) break;
    }
  }
  throw lastError;
}
