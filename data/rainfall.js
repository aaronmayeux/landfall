/**
 * rainfall.js — how much rain is coming to the house. SPEC §48.3, §48.5, §48.7.
 *
 * Sits between the relay route (`/api/nws/rainfall`) and the home drawer's Rain
 * section. Owns the network and the cache; owns no parsing, no arithmetic and
 * no words — `lib/rainfall.js` reads the series, `ui/rain-home.js` writes the
 * sentences.
 *
 * ==> THE ONLY REQUEST THIS APP MAKES THAT IS ABOUT THE READER. <== Everything
 * else asks about a storm. This asks about a place, and the place is somebody's
 * house, so two rules apply that apply nowhere else:
 *
 *   1. THE COORDINATES ARE ROUNDED BEFORE THEY LEAVE (`RAIN.wireDecimals`).
 *      Two decimals is about 1.1 km, comfortably inside a ~2.5 km NWS grid
 *      cell, so the coarser number resolves to the same cell and the same
 *      forecast. The request names a neighbourhood rather than a doorstep, and
 *      it costs nothing to answer.
 *   2. IT ONLY RUNS WHEN THE SECTION IS ON SCREEN. No warm loop, no poll. The
 *      reading surface is the gate, the same way the advisory text and the
 *      environment paragraph are gated.
 *
 * NEVER THROWS. Every failure comes back as a status, for the reason the SHIPS
 * fetch gives: a thrown error would have to be caught identically by the render
 * path and the retry path, and two catch blocks drift.
 *
 *   ok            — a forecast came back
 *   not_covered   — outside NWS's forecast area. An ANSWER, not a failure, and
 *                   the one state that must never offer Retry (§48.5).
 *   unavailable   — network, timeout, or 5xx. Retryable.
 *
 * No DOM, ever. Imports: config/ and data/ siblings.
 */

import { ENDPOINT, POLL, RAIN } from '../config/constants.js';

/** ONE ENTRY, NOT AN LRU. There is exactly one home, and a reader who changes
 *  it wants the new answer rather than a remembered one for a house they no
 *  longer live in. Keyed by the rounded coordinates so that changing home
 *  misses naturally and there is nothing to evict on a schedule. */
let entry = null; // { key, at, result }

const keyOf = (lat, lon) =>
  `${Number(lat).toFixed(RAIN.wireDecimals)},${Number(lon).toFixed(RAIN.wireDecimals)}`;

/** Drop the held answer so the next call refetches. The Retry button is the
 *  only caller. */
export function evictRainfall() {
  entry = null;
}

/** Test seam. This store is module state, so two suites in one process would
 *  otherwise inherit each other's answers. */
export const resetRainfall = evictRainfall;

const fail = (error) => ({ status: 'unavailable', error, payload: null, fetchedAt: null, stale: false });

async function fetchRainfall(home) {
  if (!home || !Number.isFinite(home.lat) || !Number.isFinite(home.lon)) {
    return fail('no home');
  }

  const lat = Number(home.lat).toFixed(RAIN.wireDecimals);
  const lon = Number(home.lon).toFixed(RAIN.wireDecimals);
  const url = `${ENDPOINT.relay}/nws/rainfall?lat=${lat}&lon=${lon}`;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), POLL.fetchTimeout);
  let res;
  try {
    res = await fetch(url, { cache: 'no-store', signal: ctl.signal });
  } catch (e) {
    /* Named in human terms right here — §5 forbids raw exception text reaching
     * a surface, and 'AbortError' is exactly that. */
    return fail(e?.name === 'AbortError' ? 'timed out' : 'network error');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) return fail(`HTTP ${res.status}`);

  let body;
  try {
    body = await res.json();
  } catch {
    return fail('unreadable response');
  }

  const fetchedAt = res.headers.get('X-Landfall-Fetched-At') || null;
  const stale = res.headers.get('X-Landfall-Stale') === 'true';

  /* ==> THE RELAY'S "NOT COVERED" IS PASSED THROUGH, NOT REINTERPRETED. <== It
   * arrives as HTTP 200 on purpose: a house in the Bahamas is outside NWS's
   * forecast area, which is a fact about the world rather than a failure of
   * ours, and turning it into an error here would put a Retry button on a
   * section that has nothing to retry (§48.5). */
  if (body?.status === 'not_covered') {
    return { status: 'not_covered', payload: null, fetchedAt, stale };
  }
  if (body?.status !== 'ok') return fail('unexpected answer');

  return { status: 'ok', payload: body, fetchedAt, stale };
}

/**
 * The rainfall answer for a home, cache-first and cache-filling.
 *
 * ==> THE HOLD IS SHORT AND THE REASON IS THE ALERTS, NOT THE NUMBER. <== The
 * grid updates a few times a day; a flash flood warning can come and go inside
 * an hour. `RAIN.clientTtlMs` is set by the second of those, and expiry is
 * filtered again at render (`floodAlerts`) so that even a held payload cannot
 * show a warning that has run out.
 *
 * A cached failure is retried on the next call, exactly as the SHIPS loop
 * retries one. `not_covered` is a RESOLVED answer and is kept — a house does
 * not move into coverage while somebody is reading about it.
 */
export async function loadRainfall(home, { now = Date.now() } = {}) {
  if (!home) return fail('no home');
  const key = keyOf(home.lat, home.lon);

  if (
    entry &&
    entry.key === key &&
    entry.result.status !== 'unavailable' &&
    now - entry.at < RAIN.clientTtlMs
  ) {
    return entry.result;
  }

  const result = await fetchRainfall(home);
  entry = { key, at: now, result };
  return result;
}
