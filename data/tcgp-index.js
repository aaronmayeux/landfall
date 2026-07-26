/**
 * data/tcgp-index.js — ONE copy of TCGP's storm list for the app.
 *
 * Same shape and same reasoning as `data/jtwc-index.js`: resolving a storm to a
 * deck identity is a shared question, so the answer is fetched once per TTL and
 * a second storm asking inside that window costs nothing.
 *
 * ==> IT REPLACED A JTWC LOOKUP, AND THAT IS THE WHOLE POINT <==
 * Model tracks used to derive a TCGP filename from JTWC's active-warning feed.
 * When JTWC stopped warning on a dying storm, the id vanished and the app never
 * attempted a fetch it would have succeeded at. `functions/api/tcgp/storms.js`
 * carries the full account. The rule: ask the source that has the data.
 *
 * ==> A FAILED INDEX IS NOT AN EMPTY INDEX <==
 * Callers MUST branch on `state`. An `unavailable` index with an empty list
 * read as fact means "no storm has model guidance", which is §5's exact
 * failure and the reason both index modules report a state at all.
 *
 * No DOM, ever. Imports: config/, data/relay.js.
 */

import { ADVISORY_TEXT, ENDPOINT } from '../config/constants.js';
import { fetchFeed } from './relay.js';

let index = null;      // { state, storms, fetchedAt }
let indexAt = 0;
let inFlight = null;   // dedupes concurrent readers

/**
 * The shared index, fetched at most once per TTL.
 *
 * REUSES `ADVISORY_TEXT.indexTtl` rather than introducing a second number.
 * Both indexes answer "which storms does this agency currently list", both turn
 * over on the same 6-hourly model/warning cycle, and two constants free to
 * drift apart would be two answers to one question (§Tuning).
 *
 * @param {{force?: boolean}} [opts] `force` bypasses the TTL and the in-flight
 *        dedupe — for Retry, which must not be answered from the copy that
 *        just failed.
 */
export async function getTcgpIndex({ force = false } = {}) {
  const fresh = index && Date.now() - indexAt < ADVISORY_TEXT.indexTtl;
  if (fresh && !force) return index;
  if (inFlight && !force) return inFlight;

  inFlight = (async () => {
    try {
      const { json } = await fetchFeed(`${ENDPOINT.relay}/tcgp/storms`);
      index = {
        state: json?.state || 'ok',
        storms: Array.isArray(json?.storms) ? json.storms : [],
        fetchedAt: json?.fetchedAt || null,
      };
      indexAt = Date.now();
      return index;
    } catch (e) {
      return { state: 'unavailable', storms: [], detail: e?.message || 'failed' };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Drop the shared index so the next call re-reads it. Retry paths call this. */
export function evictTcgpIndex() {
  index = null;
  indexAt = 0;
}
