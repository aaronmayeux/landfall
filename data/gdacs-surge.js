/**
 * gdacs-surge.js — modelled surge at named towns, fetched. SPEC §51.2, §51.3.
 *
 * Sits between the relay route (`/api/gdacs/surge`) and the two surfaces that
 * read it: the home dashboard's Surge section and the coastal layer. Owns the
 * network and the cache; owns no parsing, no arithmetic and no words —
 * `lib/surge-locations.js` reads the towns, `ui/surge-home.js` writes the
 * sentences, `map/layers/gdacs-surge-coast.js` paints them.
 *
 * ==> ONE FETCH SERVES BOTH SURFACES AND THAT IS WHY THIS FILE EXISTS. <== The
 * dashboard asks "what happens at this house" and the layer asks "what happens
 * along this coast", and they are the same forecast seen twice. Two fetches
 * would be two answers that could disagree on screen, which is precisely the
 * bug §48.10 spends a section on for rainfall. The memo below is keyed by
 * storm, so the second caller is free.
 *
 * NEVER THROWS. Every failure comes back as a status, for the reason
 * `data/rainfall.js` gives: a thrown error would have to be caught identically
 * by the render path and the retry path, and two catch blocks drift.
 *
 *   ok            — towns came back
 *   none_matched  — the model ran and found no populated place. An ANSWER
 *                   about the storm (Hernán, mid-Pacific), not a failure, and
 *                   the one state that must never offer Retry.
 *   unavailable   — network, timeout, or 5xx. Retryable.
 *
 * ==> NHC STORMS ARE NOT EXCLUDED, AND THAT IS THE FEATURE. <== It would be
 * natural to gate this on `storm.source === 'gdacs'`. It would also be wrong:
 * Lala is a NOAA-sourced storm carried by GDACS and it returned 47 Hawaiian
 * towns. The gate is whether the storm has a GDACS event id, nothing else.
 *
 * No DOM, ever. Imports: config/ only.
 */

import { ENDPOINT, GDACS_SURGE, POLL } from '../config/constants.js';

/** A SMALL MAP, NOT ONE ENTRY. Unlike rainfall — which is about the single
 *  home and so can hold one answer — this is per storm, and both the dashboard
 *  and the layer move between storms as the reader browses. Bounded by the
 *  number of live storms, which is a dozen at the worst hour of the worst
 *  season, so there is nothing to evict on a schedule. */
const held = new Map(); // eventId -> { at, result }

/** Drop everything. The Retry button and the test suites are the callers. */
export function evictGdacsSurge(eventId = null) {
  if (eventId == null) held.clear();
  else held.delete(String(eventId));
}

/** Test seam — module state would otherwise leak between suites in one
 *  process. */
export const resetGdacsSurge = () => held.clear();

const fail = (error) => ({ status: 'unavailable', error, payload: null, fetchedAt: null, stale: false });

async function fetchSurge(eventId) {
  const url = `${ENDPOINT.relay}/gdacs/surge?eventid=${encodeURIComponent(eventId)}`;

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

  /* ==> THE RELAY'S "NONE MATCHED" IS PASSED THROUGH, NOT REINTERPRETED. <==
   * It arrives as HTTP 200 on purpose: a storm with no populated place in
   * reach is a fact about the storm rather than a failure of ours, and turning
   * it into an error here would put a Retry button on a section with nothing
   * to retry. */
  if (body?.status === 'none_matched') {
    return { status: 'none_matched', payload: body, fetchedAt, stale };
  }
  if (body?.status !== 'ok') return fail('unexpected answer');

  return { status: 'ok', payload: body, fetchedAt, stale };
}

/**
 * The surge answer for one storm, cache-first and cache-filling.
 *
 * ==> AN HOUR, AND `GDACS_SURGE.clientTtlMs` CARRIES THE REASON. <== A JRC run
 * is redone per bulletin at best, which is six-hourly, and unlike the rainfall
 * payload nothing in this one expires.
 *
 * A cached failure is retried on the next call. `none_matched` is a RESOLVED
 * answer and is kept — a storm does not grow a coastline while somebody is
 * reading about it, and the next bulletin's run is an hour away anyway.
 *
 * @param {string|number} eventId  the storm's GDACS event id
 */
export async function loadGdacsSurge(eventId, { now = Date.now() } = {}) {
  if (eventId == null || eventId === '') return fail('no storm');
  const key = String(eventId);

  const hit = held.get(key);
  if (hit && hit.result.status !== 'unavailable' && now - hit.at < GDACS_SURGE.clientTtlMs) {
    return hit.result;
  }

  const result = await fetchSurge(key);
  held.set(key, { at: now, result });
  return result;
}

/** Retry: evicts first, so a cached failure cannot answer the retry. */
export async function retryGdacsSurge(eventId, opts) {
  evictGdacsSurge(eventId);
  return loadGdacsSurge(eventId, opts);
}
