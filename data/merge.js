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
 *   - Sort: canonical basin order, strongest first within each basin. Unknown
 *     wind sorts below known. This is the STORE's order — the baseline when
 *     there is no reference point. The storm list re-sorts to nearest-first
 *     once a home exists (ui/panel-storms.js); it does not mutate this one,
 *     because other surfaces still want intensity order.
 *
 * Pure functions. No DOM, ever. Imports: lib/ only.
 */

import { NHC_BASINS, basinRank } from '../lib/basin.js';

/**
 * @param {object[]} nhcStorms   normalized, may be []
 * @param {object[]} gdacsStorms normalized, may be []
 * @returns {object[]} merged and sorted
 */
export function mergeStorms(nhcStorms, gdacsStorms) {
  const kept = [
    ...nhcStorms,
    ...gdacsStorms.filter((s) => !NHC_BASINS.has(s.basin)),
  ];
  return sortStorms(kept);
}

/** Canonical basin order; strongest first within a basin; stable tiebreak on
 *  name so two 35 kt storms don't swap rows between polls. */
export function sortStorms(storms) {
  return [...storms].sort((a, b) => {
    const br = basinRank(a.basin) - basinRank(b.basin);
    if (br !== 0) return br;
    const wa = a.windKt ?? -1;
    const wb = b.windKt ?? -1;
    if (wb !== wa) return wb - wa;
    return String(a.name).localeCompare(String(b.name));
  });
}
