/**
 * merge.js — two sources, one list (SPEC §4).
 *
 * The merge lives in the BROWSER by decision: debuggable on a phone plugged
 * into a laptop, tweakable without redeploying a relay, and one source going
 * down never blinds the other.
 *
 * Rules:
 *   - Where both know a storm, NHC wins: any GDACS storm sitting in an NHC
 *     basin (Atlantic / East Pacific / Central Pacific) is dropped. Matching
 *     by name or distance would be cleverer and wronger — basins are the
 *     stable fact, names transliterate differently between agencies.
 *   - Sort: canonical basin order, then ENDED LAST, then SILENT, then strongest
 *     first within each basin. Unknown wind sorts below known. This is the
 *     STORE's order — the baseline when
 *     there is no reference point. The storm list re-sorts to nearest-first
 *     once a home exists (ui/panel-storms.js); it does not mutate this one,
 *     because other surfaces still want intensity order.
 *
 * `now` IS A PARAMETER, not a Date.now() call inside the comparator. Two
 * reasons, and the second is the load-bearing one: it makes the silence rule
 * testable against real recorded timestamps, and it guarantees every pair in
 * one sort is judged against the SAME instant. A comparator that read the
 * clock per comparison could, across a long enough list, place a storm above
 * and below the threshold within a single sort — which is an inconsistent
 * comparator, and those produce garbage orderings rather than errors.
 *
 * Pure functions. No DOM, ever. Imports: lib/ only.
 */

import { NHC_BASINS, basinRank } from '../lib/basin.js';
import { isSilent } from '../lib/silence.js';
import { isEnded } from '../lib/lifecycle.js';

/**
 * @param {object[]} nhcStorms   normalized, may be []
 * @param {object[]} gdacsStorms normalized, may be []
 * @returns {object[]} merged and sorted
 */
export function mergeStorms(nhcStorms, gdacsStorms, now = Date.now()) {
  const kept = [
    ...nhcStorms,
    ...gdacsStorms.filter((s) => !NHC_BASINS.has(s.basin)),
  ];
  return sortStorms(kept, now);
}

/**
 * The live merge, plus storms that have ENDED and are inside their grace period
 * (SPEC §5, data/lifecycle.js).
 *
 * WHY THIS IS A SEPARATE FUNCTION AND NOT A THIRD ARGUMENT TO `mergeStorms`:
 * the ended list is not a source. It has already been through this merge once —
 * every storm in it was normalized, basin-ruled and sorted while it was alive —
 * and it obeys a different dedupe rule. Folding it into the same signature would
 * put two unlike things behind one parameter list and give `now` two possible
 * positions.
 *
 * TWO RULES, AND BOTH ARE LOAD-BEARING.
 *
 * 1. THE REGISTRY WINS OVER THE FEED COPY. A storm can be in a feed AND in the
 *    registry at once, and it is the NORMAL case rather than an edge one: NHC
 *    keeps a storm listed for hours after its final advisory. Without the
 *    dedupe it appears twice, once live and once grey, and a duplicated storm
 *    is a false count of live systems (§5) — the same failure the cage's head
 *    flag exists to prevent. The registry copy is the one that has read the
 *    final bulletin, so it is the honest one.
 *
 * 2. AN ENDED STORM IS STILL SUBJECT TO NHC-WINS. A GDACS copy of an Atlantic
 *    storm is dropped while it is alive; it must not come back through the
 *    grace period. That would resurrect Bertha's GDACS shadow — the exact storm
 *    whose 58-hour `iscurrent` freeze is written up in the SILENCE note — as a
 *    grey second Bertha beside the real one.
 */
export function mergeWithEnded(nhcStorms, gdacsStorms, endedList = [], now = Date.now()) {
  const dead = (Array.isArray(endedList) ? endedList : []).filter(
    (s) => s.source !== 'gdacs' || !NHC_BASINS.has(s.basin)
  );
  const deadIds = new Set(dead.map((s) => s.id));
  const live = [
    ...nhcStorms,
    ...gdacsStorms.filter((s) => !NHC_BASINS.has(s.basin)),
  ].filter((s) => !deadIds.has(s.id));
  return sortStorms([...live, ...dead], now);
}

/** Canonical basin order; strongest first within a basin; stable tiebreak on
 *  name so two 35 kt storms don't swap rows between polls. */
export function sortStorms(storms, now = Date.now()) {
  return [...storms].sort((a, b) => {
    const br = basinRank(a.basin) - basinRank(b.basin);
    if (br !== 0) return br;
    /* ENDED BELOW SILENT, AND BOTH BELOW EVERYTHING LIVE. The order within the
     * dead is not arbitrary: a silent storm MAY still be out there and is the
     * one of the two worth a second look, while an ended storm's agency has
     * either said it is finished or stopped listing it. Sorting a storm nobody
     * is issuing advisories for above one that might still be alive would put
     * the least actionable row nearest the top of the basin. */
    const ea = isEnded(a) ? 1 : 0;
    const eb = isEnded(b) ? 1 : 0;
    if (ea !== eb) return ea - eb;
    /* WITHIN A BASIN, SILENT LAST \u2014 before intensity, not after it. This is
     * the STORE's order, so it is what every surface without its own opinion
     * inherits, and "strongest first" would otherwise put a typhoon nobody has
     * published a fix for since yesterday at the top of its basin purely on the
     * strength of a day-old number. Above the basin split on purpose: a silent
     * West Pacific storm still belongs in the West Pacific, it just belongs at
     * the bottom of it. ui/view-storms.js applies the same rule for its own
     * nearest-first ordering; both are stated rather than shared, because they
     * are two different sorts that happen to agree on this one rule. */
    const qa = isSilent(a, now) ? 1 : 0;
    const qb = isSilent(b, now) ? 1 : 0;
    if (qa !== qb) return qa - qb;
    const wa = a.windKt ?? a.peakWindKt ?? -1;
    const wb = b.windKt ?? b.peakWindKt ?? -1;
    if (wb !== wa) return wb - wa;
    return String(a.name).localeCompare(String(b.name));
  });
}
