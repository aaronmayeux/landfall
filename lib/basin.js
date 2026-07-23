/**
 * basin.js — which ocean basin a storm belongs to.
 *
 * Two jobs:
 *   1. Basin from a storm id prefix (NHC ids are basin-prefixed: al/ep/cp).
 *   2. Basin from a position (GDACS publishes no basin — derive from lon/lat).
 *
 * The canonical order below is the Phase 2 list order (SPEC §14: "strongest-
 * first within canonical basin order") and the §4 merge rule's ground truth:
 * a GDACS storm sitting in an NHC basin is dropped, NHC wins.
 *
 * Boundaries are deliberately coarse — they assign a basin, they don't draw
 * one. The only line that MATTERS is the NHC/GDACS split, and the operative
 * edge there is 140°W (CPHC's western edge is the dateline; everything west
 * of it is GDACS territory).
 *
 * Pure functions. Imports nothing. Ever.
 */

/** Canonical basin order — NHC basins first, then west across the GDACS world. */
export const BASIN_ORDER = Object.freeze([
  'atlantic',
  'eastPacific',
  'centralPacific',
  'westPacific',
  'northIndian',
  'southwestIndian',
  'australian',
  'southPacific',
]);

export const BASIN_LABEL = Object.freeze({
  atlantic: 'Atlantic',
  eastPacific: 'East Pacific',
  centralPacific: 'Central Pacific',
  westPacific: 'Northwest Pacific',
  northIndian: 'North Indian',
  southwestIndian: 'Southwest Indian',
  australian: 'Australian Region',
  southPacific: 'South Pacific',
});

/** The basins NHC/CPHC covers natively (SPEC §4). A GDACS storm placed in one
 *  of these is a duplicate of an NHC storm — or shortly will be — and is
 *  dropped by the merge. */
export const NHC_BASINS = new Set(['atlantic', 'eastPacific', 'centralPacific']);

/** NHC storm-id prefix → basin. */
export const BASIN_BY_PREFIX = Object.freeze({
  al: 'atlantic',
  ep: 'eastPacific',
  cp: 'centralPacific',
});

export const basinRank = (basin) => {
  const i = BASIN_ORDER.indexOf(basin);
  return i === -1 ? BASIN_ORDER.length : i;
};

/**
 * Position → basin. Longitude normalized to [-180, 180).
 *
 * Northern hemisphere, west to east:
 *   dateline..140W  centralPacific · 140W..the Americas  eastPacific ·
 *   the Americas..20E  atlantic · 20E..100E  northIndian · 100E..dateline
 *   westPacific.
 * The Atlantic/EPac divide follows the Central America landmass — a latitude-
 * dependent step, coarse on purpose (a storm ON the divide is in both feeds,
 * and the id prefix, not this function, decides its basin for NHC storms).
 *
 * Southern hemisphere: 20E..90E southwestIndian · 90E..160E australian ·
 * 160E..120W southPacific · (south Atlantic storms are near-mythical; they
 * fall to southPacific's else and read fine in an "all storms" list).
 */
export function basinFromPosition(lon, lat) {
  let L = ((lon % 360) + 540) % 360 - 180; // normalize to [-180, 180)

  if (lat >= 0) {
    if (L >= 100) return 'westPacific';
    if (L >= 20) return 'northIndian';
    if (L >= -75) return 'atlantic';
    /* -100..-75 is the Central America step: north of ~17N (Gulf of Mexico,
     * Caribbean) it is Atlantic; south of it, East Pacific. Checked BEFORE the
     * general East Pacific band or the step is unreachable. */
    if (L >= -100) return lat > 17 ? 'atlantic' : 'eastPacific';
    if (L >= -140) return 'eastPacific';
    return 'centralPacific';
  }

  if (L >= 20 && L < 90) return 'southwestIndian';
  if (L >= 90 && L < 160) return 'australian';
  return 'southPacific';
}
