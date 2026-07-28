/**
 * data/jtwc-wind.js — fetch the JTWC index, hand it to the pure join.
 *
 * The thin async half of lib/jtwc-wind.js, which holds all the reasoning and
 * every rule. This file does two things and nothing else: it asks
 * data/jtwc-index.js for the shared index, and it guarantees that asking can
 * never break the storm list.
 *
 * ==> WHY THE TRY/CATCH IS THE POINT OF THE FILE <==
 * The GDACS roster is load-bearing: it is the ONLY source of storms for every
 * basin outside the Atlantic and the eastern Pacific. Wind is an enhancement
 * on top of it. So an enrichment that throws must cost the app a wind number,
 * never a typhoon.
 *
 * `getJtwcIndex()` already promises not to throw — it returns
 * `{state: 'unavailable'}` instead — and `joinJtwcWinds` is pure. Neither
 * SHOULD be able to fail here. The guard is for the case where one of them
 * changes and stops being true, because the failure that would cause is a West
 * Pacific with no storms in it during a typhoon, which is the worst outcome
 * this app has. Cheap insurance against an expensive silence (§5).
 *
 * ==> IT COSTS NOTHING MOST OF THE TIME <==
 * The index is shared and TTL'd (ADVISORY_TEXT.indexTtl, 15 min) with an
 * in-flight dedupe, and the relay behind it is colo-cached and KV-warmed. On a
 * normal 30-minute poll this is one cheap request; if the advisory panel or
 * model tracks already asked inside the window it is free.
 *
 * No DOM, ever. Imports: data/ and lib/ siblings.
 */

import { joinJtwcWinds } from '../lib/jtwc-wind.js';
import { getJtwcIndex } from './jtwc-index.js';

/**
 * @param {object[]} storms normalized GDACS storms
 * @returns {Promise<object[]>} the same storms, with measured wind where JTWC
 *          has a warning that passes the name, distance and age tests
 */
export async function withJtwcWinds(storms) {
  const list = Array.isArray(storms) ? storms : [];
  if (list.length === 0) return list;

  try {
    const index = await getJtwcIndex();
    const { storms: out, matched, considered } = joinJtwcWinds(list, index, Date.now());

    /* DIAGNOSTIC ONLY — there is no user-facing claim to make here. A storm
     * that did not match still renders, still has a category, and still lifts
     * the cage; it is just doing it from GDACS's three-word classification
     * instead of a measured wind. What the console gets is the difference
     * between "JTWC is quiet" and "we asked and could not use the answer",
     * which is the distinction that cost the most time on the GDACS list bug.
     *
     * Nothing is logged when everything matched: a quiet console is the
     * signal that the join is working. */
    if (considered > 0 && matched < considered) {
      console.warn(
        `[landfall] JTWC wind matched ${matched}/${considered} GDACS storms` +
          ` (index ${index?.state || 'unknown'}) — unmatched storms keep the` +
          ' derived class midpoint (SPEC §4)'
      );
    }

    return out;
  } catch (e) {
    console.warn(
      '[landfall] JTWC wind enrichment failed, storms unchanged:',
      e?.message || e
    );
    return list;
  }
}
