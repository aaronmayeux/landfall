/**
 * data/jtwc-index.js — ONE copy of the JTWC active-storm index for the app.
 *
 * ==> WHY THIS IS ITS OWN FILE <==
 * It lived inside `data/advisory.js` while advisory text was its only reader.
 * Model tracks became the second (§15: TCGP publishes a-decks for the basins
 * NOAA does not, and the only way to name the file for a GDACS storm runs
 * through JTWC's designation). The project rule is that a pattern used twice
 * gets extracted before the second use, and the alternative — model tracks
 * importing from the advisory module — would have made a text feature a
 * dependency of a map layer for no reason anyone could later reconstruct.
 *
 * ==> WHAT THE INDEX IS FOR <==
 * GDACS gives a NAME ("NOUL-26") and no designation; its `sourceid` field,
 * which would carry one, is an EMPTY STRING. Everything downstream of GDACS
 * that needs an ATCF identity — a warning product, an a-deck filename — has to
 * get it from somewhere else. JTWC's warnings carry both in their own header:
 *
 *     SUBJ/TYPHOON 11W (NOUL) WARNING NR 008//
 *
 * `/api/jtwc/storms` reads every active warning and returns that join. This
 * module holds the one shared copy of the answer.
 *
 * ==> ONE COPY, NOT ONE PER STORM <==
 * Building the index means reading every active warning upstream. Selecting a
 * second GDACS storm inside the TTL must cost nothing, and two storms selected
 * in the same second must not both trigger it — hence the in-flight dedupe.
 *
 * ==> A FAILED INDEX IS NOT AN EMPTY INDEX <==
 * The single most important line in this file. Returning `{storms: []}` on a
 * failure is how "we could not reach JTWC" silently becomes "no storm has a
 * warning", which is §5's exact failure. Callers get a `state` and are
 * expected to branch on it.
 *
 * No DOM, ever. Imports: config/, data/relay.js.
 */

import { ADVISORY_TEXT, ENDPOINT } from '../config/constants.js';
import { fetchFeed } from './relay.js';

let jtwcIndex = null;      // { state, storms, pubDate, fetchedAt }
let jtwcIndexAt = 0;
let jtwcInFlight = null;   // dedupes concurrent readers

/**
 * The shared index, fetched at most once per TTL.
 *
 * @param {{force?: boolean}} [opts] `force` bypasses both the TTL and the
 *        in-flight dedupe — the Retry paths, which must not be answered from
 *        the same degraded copy that failed a moment ago.
 * @returns {Promise<{state: string, storms: Array, pubDate?: string|null,
 *                    fetchedAt?: string|null, detail?: string}>}
 */
export async function getJtwcIndex({ force = false } = {}) {
  const fresh = jtwcIndex && Date.now() - jtwcIndexAt < ADVISORY_TEXT.indexTtl;
  if (fresh && !force) return jtwcIndex;
  if (jtwcInFlight && !force) return jtwcInFlight;

  jtwcInFlight = (async () => {
    try {
      const { json } = await fetchFeed(`${ENDPOINT.relay}/jtwc/storms`);
      jtwcIndex = {
        state: json?.state || 'ok',
        storms: Array.isArray(json?.storms) ? json.storms : [],
        pubDate: json?.pubDate || null,
        fetchedAt: json?.fetchedAt || null,
      };
      jtwcIndexAt = Date.now();
      return jtwcIndex;
    } catch (e) {
      /* See the header. This is NOT an empty index and must never be read as
       * one. */
      return { state: 'unavailable', storms: [], detail: e?.message || 'failed' };
    } finally {
      jtwcInFlight = null;
    }
  })();

  return jtwcInFlight;
}

/** Drop the shared index so the next call re-reads it. Retry paths call this —
 *  otherwise retrying a storm whose name is missing from a degraded index
 *  would keep matching against the same degraded copy. */
export function evictJtwcIndex() {
  jtwcIndex = null;
  jtwcIndexAt = 0;
}
