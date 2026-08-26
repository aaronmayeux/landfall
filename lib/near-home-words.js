/**
 * near-home-words.js — what "near home" is called on screen.
 * SPEC-SEASONS-BUILD.md §57.19, §57.30 step 9.
 *
 * ==> `lib/near-home.js` ANSWERS HOW FAR. THIS FILE ANSWERS WHAT TO SAY. <==
 * The split is the same one `seasons/bar.js` took from the board: the
 * measurement is arithmetic and belongs beside the geometry, the sentence is
 * wording and belongs somewhere a suite can read it without mounting anything.
 * Every function here is pure — handed numbers, returns a string or a small
 * object, reads no clock, no DOM and no stored setting.
 *
 * ==> THE SLIDER SPEAKS THE READER'S OWN UNITS, WHICH §57.19 DID NOT ANTICIPATE.
 * <== That section fixed the range in miles, on the reasoning that a reader
 * thinks in miles. Half of them think in kilometres and this app already knows
 * which (`lib/units.js`), so the range is per-system in `SEASONS.nearHomeRange`
 * and this file is where the choice is made. Both ranges cover the same
 * ground — 800 km and 500 mi differ by half a percent — so nothing about the
 * archive changes when somebody flips the setting, only the numbers on the
 * control.
 *
 * ==> AND EVERY DISTANCE THAT LEAVES HERE HAS BEEN THROUGH `formatDistance`.
 * <== The rest of the app converts at the moment of display and stores
 * nautical miles underneath. A second conversion here, however small, would be
 * a second place the app's units can drift.
 *
 * ==> A STRENGTH IS ONLY CLAIMED WHEN THE RECORD SUPPORTS ONE. <== HURDAT2
 * records `EX`, `LO`, `WV` and `DB` as well as the five cyclone statuses, and
 * a storm can be extratropical at its closest approach and a Cat 4 two days
 * earlier. "Passed 31 mi WSW as a Cat 2" read off an `EX` record would be a
 * Saffir-Simpson grading NOAA did not give it (§6), so the clause is dropped
 * rather than guessed and the sentence still carries the distance and the
 * direction, which are true either way.
 *
 * Imports config/ and lib/. No DOM, no network, no clock.
 */

import { SEASONS, UNITS } from '../config/constants.js';
import { categoryFromKt, categoryShortLabel } from './category.js';
import { bearingDeg } from './geo.js';
import { miToNm } from './near-home.js';
import { formatDistance, formatBearing, resolveSystem } from './units.js';

/* ---------------------------------------------------------------------------
 * THE RANGE
 * ------------------------------------------------------------------------- */

/**
 * The slider's numbers for one unit system.
 *
 * @param {string} system  a resolved or unresolved units preference
 * @returns {{min:number, max:number, step:number, default:number, unit:string}}
 */
export function rangeFor(system) {
  return resolveSystem(system) === UNITS.METRIC
    ? SEASONS.nearHomeRange.metric
    : SEASONS.nearHomeRange.imperial;
}

/* ==> THE KILOMETRE FACTOR IS DERIVED, NOT TYPED. <== `lib/units.js` owns the
 * conversions and this file must not grow a second copy of them that can drift.
 * A kilometre is 1/1.852 nautical miles by definition, and the nautical mile is
 * the unit `lib/near-home.js` measures in — so one division is the whole
 * conversion and there is no new constant to keep in step. */
const NM_PER_KM = 1 / 1.852;

/**
 * A slider value, in whatever units the slider is showing, as nautical miles —
 * which is what every measurement in this app is in.
 *
 * ==> THIS IS THE ONLY PLACE THE TWO SYSTEMS MEET. <== Everything upstream of
 * it is a reader-facing number on a control; everything downstream is
 * `lib/near-home.js`'s nautical miles. A second converter anywhere else is how
 * a metric reader ends up filtering a circle 60% the size of the one on their
 * screen.
 */
export function radiusToNm(value, system) {
  if (!Number.isFinite(value)) return null;
  return resolveSystem(system) === UNITS.METRIC ? value * NM_PER_KM : miToNm(value);
}

/* ---------------------------------------------------------------------------
 * ONE STORM
 * ------------------------------------------------------------------------- */

const isCyclone = (status) =>
  SEASONS.cycloneStatuses.includes(String(status || '').toUpperCase());

/**
 * How close one storm came, as a phrase. §57.19.
 *
 * *"31 mi WSW as a Cat 2"* — the distance, the direction it passed on, and
 * what it was doing when it did. §57.19 asks for the strength AT CLOSEST
 * APPROACH rather than the storm's peak, and that is the more interesting fact
 * as well as the honest one: a Cat 5 that was a depression by the time it
 * reached you did not pass you as a Cat 5.
 *
 * ==> THE BEARING IS FROM HOME TO THE STORM, WHICH IS THE WAY ROUND A READER
 * MEANS. <== "Passed west of me" is a statement about where the storm was, not
 * about which way it was going. `lib/geo.js`'s `bearingDeg` takes the two
 * points in that order and `formatBearing` gives the sixteen-point compass
 * word every other list in this app uses, rather than a second vocabulary.
 *
 * @param {object|null} near   a `closestApproach` result
 * @param {{lon:number, lat:number}} home
 * @param {string} system      units preference
 * @returns {string} the phrase, or '' when there is nothing true to say
 */
export function approachPhrase(near, home, system) {
  if (!near || !Number.isFinite(near.nm)) return '';
  const dist = formatDistance(near.nm, system);

  const way = Number.isFinite(home?.lon) && Number.isFinite(home?.lat)
    && Number.isFinite(near.lon) && Number.isFinite(near.lat)
    ? formatBearing(bearingDeg(home.lon, home.lat, near.lon, near.lat))
    : '';

  /* ==> A DIRECTION IS DROPPED WHEN THE STORM PASSED OVER THE HOUSE. <== At a
   * distance of nothing the bearing is arbitrary — two coordinates a few
   * metres apart can point any way at all — so "0.0 mi NNE" would be a
   * direction invented out of rounding. `formatDistance` prints one decimal
   * below ten units, so this only ever fires on a genuine direct hit. */
  const where = near.nm > 0.05 && way ? ` ${way}` : '';

  const cat = isCyclone(near.status) ? categoryFromKt(near.windKt) : null;
  const label = cat == null ? '' : categoryShortLabel(cat, 'tropical', null);
  /* `categoryShortLabel` answers with an em dash for anything it cannot grade,
   * and a dash inside a sentence reads as a missing word rather than as an
   * absence. Dropped, the same as a missing bearing. */
  const strength = label && label !== '—' ? ` as a ${label}` : '';

  return `${dist}${where}${strength}`;
}

/* ---------------------------------------------------------------------------
 * THE WHOLE ARCHIVE
 * ------------------------------------------------------------------------- */

/**
 * How many storms in the index came within `radius`, and when the last one was.
 *
 * ==> IT FILTERS PRECOMPUTED NUMBERS AND TOUCHES NO GEOMETRY. <== §57.35 fault
 * 2. The index it is handed is a few hundred entries carrying one distance
 * each, so this runs on every pixel of a slider drag without noticing. The 175
 * years of segment arithmetic happened once, in a worker, before this was ever
 * called.
 *
 * @param {Array<{nm:number, year:number}>} index  from `indexNearHome`, trimmed
 * @param {number} radiusNm
 * @returns {{count:number, lastYear:number|null}}
 */
export function standingCount(index, radiusNm) {
  let count = 0;
  let lastYear = null;
  if (!Number.isFinite(radiusNm)) return { count, lastYear };
  for (const e of index || []) {
    if (!Number.isFinite(e?.nm) || e.nm > radiusNm) continue;
    count++;
    if (Number.isFinite(e.year) && (lastYear == null || e.year > lastYear)) lastYear = e.year;
  }
  return { count, lastYear };
}

/**
 * The standing line on the Home dashboard. §57.19.
 *
 * *"143 storms have passed within 120 mi since 1851. The last was 2024."*
 *
 * ==> ZERO GETS A SENTENCE OF ITS OWN AND IT IS NOT "0 storms". <== A count of
 * none is a real and interesting answer for an inland house, and it has to read
 * as one. What it must never be confused with is the archive failing to load,
 * which is why this function is only ever called with a real index — the
 * caller says nothing at all when it has nothing (§5, §57.35 FIX 8).
 *
 * ==> AND THE FIRST YEAR IS READ OFF THE ARCHIVE, NOT TYPED. <== "since 1851"
 * is a fact about which files are in the repo. Written as a literal it becomes
 * wrong the first time the record is extended backwards, silently, in a
 * sentence whose whole job is to be trustworthy about the past.
 *
 * @param {object} opts
 * @param {number} opts.count
 * @param {number|null} opts.lastYear
 * @param {number} opts.radius      the slider's number, in `unit`
 * @param {string} opts.unit        'mi' | 'km'
 * @param {number|null} opts.firstSeason
 * @returns {string}
 */
export function standingSentence({ count, lastYear, radius, unit, firstSeason }) {
  const since = Number.isFinite(firstSeason) ? ` since ${firstSeason}` : '';
  const within = `within ${radius} ${unit}`;

  if (!count) return `No storm on record has passed ${within}${since}.`;

  const storms = count === 1 ? '1 storm has' : `${count} storms have`;
  const last = Number.isFinite(lastYear) ? ` The last was ${lastYear}.` : '';
  return `${storms} passed ${within}${since}.${last}`;
}

export const __internals = { NM_PER_KM, isCyclone };
