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
 *   - Sort: canonical basin order, then SILENT LAST, then strongest first
 *     within each basin. Unknown wind sorts below known. This is the STORE's
 *     order — the baseline when
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

/** Canonical basin order; strongest first within a basin; stable tiebreak on
 *  name so two 35 kt storms don't swap rows between polls. */
export function sortStorms(storms, now = Date.now()) {
  return [...storms].sort((a, b) => {
    const br = basinRank(a.basin) - basinRank(b.basin);
    if (br !== 0) return br;
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
