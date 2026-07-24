/**
 * wind.js — wind-band thresholds: detection, labels, draw order.
 *
 * The three NHC wind radii thresholds, which are the SAME thresholds the
 * watch/warning products are defined against (SPEC §6): 34 kt is tropical-
 * storm force, 64 kt is hurricane force. 50 kt sits between them with no
 * product of its own — it exists because damage between "bad" and "hurricane"
 * is worth separating.
 *
 * Colors are the §6 fixed contract (WIND_BAND_COLOR) and are not themeable.
 *
 * Pure functions. Imports: config/ only.
 */

import { WIND_BAND_COLOR } from '../config/tokens.js';

/** The three thresholds, in knots. */
export const WIND_KT = Object.freeze({ KT34: 34, KT50: 50, KT64: 64 });

/** Display label per band. Knots is the storm-data unit throughout (§4), but
 *  these strings are USER-FACING, so they say what the wind actually does
 *  rather than making the reader convert. */
export const WIND_LABEL = Object.freeze({
  34: 'Tropical storm force',
  50: 'Damaging',
  64: 'Hurricane force',
});

const COLOR_BY_KT = Object.freeze({
  34: WIND_BAND_COLOR.KT34,
  50: WIND_BAND_COLOR.KT50,
  64: WIND_BAND_COLOR.KT64,
});

/**
 * The field carrying the threshold.
 *
 * CONFIRMED LIVE 2026-07-24 (SPEC §4): `radii` was read off real features on
 * Fausto EP1, on both `+10 Past Wind Radii` and `+12 Forecast Wind Radii`,
 * via /api/nhc/inspect. It is the threshold field. The fallback list below
 * is now belt-and-braces against a NOAA schema change, not a load-bearing
 * guess.
 */
const KT_FIELD = 'radii';

/** Other names seen on ArcGIS wind products, tried in order after the named
 *  field. Cheap, and they cost nothing when the first one hits. */
const KT_FALLBACK_FIELDS = Object.freeze(['RADII', 'wind_kt', 'windspeed', 'WINDSPEED', 'speed']);

/** Snap a number to the nearest legal threshold, or null. Values arrive as
 *  numbers or as numeric strings depending on the layer, so both parse. */
function toThreshold(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return null;
  if (n === 34 || n === 50 || n === 64) return n;
  return null;
}

/**
 * Find the wind threshold on a feature's properties.
 *
 * Named field first, then the known aliases. THERE IS NO LAST-RESORT SCAN of
 * every property, and that is a deliberate difference from the watch/warning
 * detector next door.
 *
 * A scan was written here and removed after its own test caught it: a feature
 * carrying `tau: 34` (forecast hour 34, an ordinary value on these layers)
 * was read as a 34 kt band and would have painted a green tropical-storm ring
 * off a coincidence. The watch/warning scan is safe because "HWR" is a
 * distinctive string that appears nowhere by accident; 34, 50, and 64 are
 * ordinary numbers that appear all over a forecast product. The same trick
 * does not survive the move from codes to magnitudes.
 *
 * Consequence, and it is the right one: if NHC renames the field, every band
 * returns null and NOTHING draws. A missing wind field is visible and gets
 * reported. A wind field in the wrong severity color is invisible and is a
 * safety-adjacent bug (§6).
 *
 * Returns 34 | 50 | 64 | null.
 */
export function windThresholdFromProps(props) {
  if (!props) return null;

  const named = toThreshold(props[KT_FIELD]);
  if (named != null) return named;

  for (const f of KT_FALLBACK_FIELDS) {
    const hit = toThreshold(props[f]);
    if (hit != null) return hit;
  }
  return null;
}

/** Fixed §6 color for a threshold, or null when the threshold is unknown —
 *  an unidentifiable band draws in NO color rather than a guessed one. */
export function windColor(kt) {
  return COLOR_BY_KT[kt] || null;
}

/**
 * Draw order: 34 kt widest and BOTTOM, 64 kt core on TOP (§6 "drawn nested
 * 34 widest → 64 core"). Higher sort key paints later, so severity rises
 * with the number — the same convention as the watch/warning stripe, on
 * purpose: two layers using opposite sort conventions is how a severity
 * stacking bug gets written.
 */
export function windSortKey(kt) {
  return kt === 64 ? 2 : kt === 50 ? 1 : 0;
}
