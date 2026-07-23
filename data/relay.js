/**
 * relay.js — the one fetch path for feed data (SPEC §4 recovery rules).
 *
 * Every storm-feed request in the app goes through fetchFeed(), which owns:
 *   - the per-request timeout (POLL.fetchTimeout, via AbortController)
 *   - auto-retry at 5 s / 15 s / 45 s, then give up until the next poll
 *   - the retryable/not-retryable split: timeout, network error, and 5xx
 *     retry; a 4xx is "no data," not "try again," and is never retried
 *   - never retrying while the page is hidden (no background work, ever)
 *   - reading the relay's stale markers (X-Landfall-Stale / -Fetched-At)
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

async function fetchOnce(url) {
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
      r.status >= RETRYABLE_STATUS.min && r.status <= RETRYABLE_STATUS.max;
    throw new FeedError(`HTTP ${r.status}`, retryable);
  }

  let json;
  try {
    json = await r.json();
  } catch {
    // 200 with a non-JSON body is an upstream fault, not our bug — retryable.
    throw new FeedError('bad response body', true);
  }

  return {
    json,
    /** Set when the RELAY served last-good because upstream was down. */
    relayStale: r.headers.get('X-Landfall-Stale') === 'true',
    /** When the relay actually pulled this from upstream (relay routes only). */
    fetchedAt: r.headers.get('X-Landfall-Fetched-At') || null,
  };
}

/**
 * Fetch a feed URL with the full §4 recovery behavior.
 *
 * @param {string} url
 * @returns {Promise<{json: object, relayStale: boolean, fetchedAt: string|null}>}
 * @throws {FeedError} once retries are exhausted (or the error is a 4xx).
 */
export async function fetchFeed(url) {
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
      return await fetchOnce(url);
    } catch (e) {
      lastError = e;
      if (!e.retryable) break;
    }
  }
  throw lastError;
}
