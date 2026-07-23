/**
 * units.js — conversion AT RENDER ONLY (SPEC §8).
 *
 * The rule that makes this file safe: storage and logic are always knots and
 * nautical miles. Nothing in this file is ever called before a number is about
 * to become text. Converting internally means rounding drift, and drift near a
 * threshold flips a storm between categories — a 64.0 kt Cat 1 that round-trips
 * through mph and back is a 63.9 kt tropical storm, and the color changes.
 *
 * Pressure is mb in BOTH systems. NHC quotes mb; inHg is a personal preference,
 * not a measurement system, and supporting it would mean a third unit path for
 * one number.
 *
 * Imports nothing but constants. Pure functions, no state.
 */

import { UNITS } from '../config/constants.js';

/* ---------------------------------------------------------------------------
 * THE CONVERSION FACTORS
 *
 * Exact by definition, not approximations — the nautical mile and the knot are
 * both defined against the metre. Written out rather than rounded so nobody
 * later "improves" 1.15078 into 1.15.
 * ------------------------------------------------------------------------- */

const KM_PER_NM = 1.852;          // exact, by definition
const MI_PER_NM = 1.15077945;     // 1852 / 1609.344, exact ratio
const KMH_PER_KT = 1.852;         // a knot IS one nautical mile per hour
const MPH_PER_KT = 1.15077945;
const M_PER_FT = 0.3048;          // exact, by definition

/* ---------------------------------------------------------------------------
 * SYSTEM RESOLUTION
 *
 * Auto-from-locale with a manual override (SPEC §8): auto alone breaks for the
 * American living abroad, a setting alone is a chore for everyone else.
 * ------------------------------------------------------------------------- */

/** The three holdouts that never adopted metric, by region subtag. Liberia and
 *  Myanmar are the other two commonly cited, but both actually use metric for
 *  weather — the US is the only one where a hurricane is quoted in mph. */
const IMPERIAL_REGIONS = new Set(['US', 'PR', 'VI', 'GU', 'AS', 'MP']);

/** Resolve AUTO against the device locale. Puerto Rico and the USVI are in
 *  here deliberately: they are squarely in the Atlantic basin, they are who
 *  this app is FOR during a September storm, and they read NHC advisories in
 *  the same mph the mainland does. */
export function systemFromLocale() {
  try {
    const loc = new Intl.Locale(navigator.language);
    const region = loc.region || loc.maximize?.().region;
    return IMPERIAL_REGIONS.has(region) ? UNITS.IMPERIAL : UNITS.METRIC;
  } catch {
    /* Intl.Locale is not everywhere, and navigator.language can be absent in
     * odd embeddings. Fall back on the raw string rather than throwing on a
     * units question — no unit preference is worth a blank screen. */
    const tag = (navigator.language || '').toUpperCase();
    return /-(US|PR|VI|GU|AS|MP)\b/.test(tag) ? UNITS.IMPERIAL : UNITS.METRIC;
  }
}

/** Collapse a stored preference (which may be AUTO) into a concrete system. */
export function resolveSystem(pref) {
  return pref === UNITS.IMPERIAL || pref === UNITS.METRIC
    ? pref
    : systemFromLocale();
}

/* ---------------------------------------------------------------------------
 * FORMATTERS
 *
 * Each returns a STRING with its unit attached. Returning a bare number would
 * invite callers to do their own concatenation and their own rounding, which
 * is how "45 mph" and "45mph" and "45 MPH" end up in three panels.
 *
 * Every one of these tolerates null/undefined and returns an em-dash. A
 * missing wind speed is a real state in NHC data, and it must render as
 * visibly absent rather than as "0 mph" — which would read as calm.
 * ------------------------------------------------------------------------- */

const MISSING = '—';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Wind: stored knots → mph or km/h. Rounded to whole units — NHC issues wind
 *  in 5 kt increments, so a decimal place would imply precision that isn't
 *  in the source. */
export function formatWind(kt, system) {
  if (!isNum(kt)) return MISSING;
  const imperial = resolveSystem(system) === UNITS.IMPERIAL;
  const v = kt * (imperial ? MPH_PER_KT : KMH_PER_KT);
  return `${Math.round(v)} ${imperial ? 'mph' : 'km/h'}`;
}

/** Distance: stored nautical miles → miles or km.
 *
 *  Precision scales with magnitude, because "1,247.3 miles" is false precision
 *  on a forecast track whose 72-hour error is measured in hundreds of miles,
 *  while "0 miles" for something 0.4 miles away is actively wrong. */
export function formatDistance(nm, system) {
  if (!isNum(nm)) return MISSING;
  const imperial = resolveSystem(system) === UNITS.IMPERIAL;
  const v = nm * (imperial ? MI_PER_NM : KM_PER_NM);
  const unit = imperial ? 'mi' : 'km';
  if (v < 10) return `${v.toFixed(1)} ${unit}`;
  return `${Math.round(v).toLocaleString()} ${unit}`;
}

/** Pressure: mb in both systems. Here for symmetry so callers never have to
 *  remember which measurements convert and which don't. */
export function formatPressure(mb) {
  return isNum(mb) ? `${Math.round(mb)} mb` : MISSING;
}

/** Surge: stored feet → feet or metres.
 *
 *  NOTE (SPEC §8): NHC's own surge LEGEND text is shown verbatim ("Up to 3 ft")
 *  with the conversion in parentheses for metric users. This function is for
 *  computed surge values only — never use it to rewrite an official legend.
 *  Rewriting an official legend is the same class of error as curving official
 *  geometry (§7). */
export function formatSurge(ft, system) {
  if (!isNum(ft)) return MISSING;
  const imperial = resolveSystem(system) === UNITS.IMPERIAL;
  if (imperial) return `${Math.round(ft)} ft`;
  return `${(ft * M_PER_FT).toFixed(1)} m`;
}

/** Metric conversion of an official imperial legend string, for the
 *  parenthetical. Returns null when there is no number to convert, so the
 *  caller shows the legend alone rather than an empty pair of brackets. */
export function surgeLegendMetric(legendText) {
  const m = String(legendText || '').match(/(\d+(?:\.\d+)?)\s*ft/i);
  if (!m) return null;
  return `${(parseFloat(m[1]) * M_PER_FT).toFixed(1)} m`;
}

/** Speed of movement: stored knots → mph or km/h.
 *  Separate from formatWind despite identical math — storm MOTION and storm
 *  WIND are different quantities that happen to share a unit, and one day one
 *  of them will need different rounding. */
export const formatSpeed = formatWind;

/** Bearing in degrees → compass point. NHC quotes movement as "NW at 12 mph",
 *  never as "315° at 12 mph". 16-point compass: 8 is too coarse to distinguish
 *  a track that clears the coast from one that doesn't. */
const COMPASS = Object.freeze([
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
]);

export function formatBearing(deg) {
  if (!isNum(deg)) return MISSING;
  const i = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return COMPASS[i];
}
