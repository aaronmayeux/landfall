/**
 * surge-locations.js — modelled surge at named towns, read. SPEC §51.1, §51.3.
 *
 * Pure. No DOM, no network, no clock of its own — every function that needs
 * "now" is handed it, for the same reason `lib/rainfall.js` is: a sentence
 * about what is still ahead can only be tested against a moment somebody can
 * choose.
 *
 * ==> THE HEIGHTS ARE METRES AND THEY ARE SMALL, AND BOTH FACTS ARE LOAD
 *     BEARING. <== §51.1. The entire archive, three storms, reads: Lala's
 * worst populated place 0.17 m, Saudel's 0.48 m, Hernán none at all. Two
 * things follow, and neither is a style choice:
 *
 *   1. NHC'S RAMP CANNOT BE REUSED. Its bottom rung is "up to 3 ft" ≈ 0.91 m,
 *      so every observation this product has ever made lands in it. The globe
 *      would show one colour for the whole planet outside America and a reader
 *      would learn a falsehood from it. `GDACS_SURGE.thresholdsM` is the scale
 *      this product's own numbers need.
 *   2. THE FIGURE OUTRANKS THE COLOUR. At this scale a bucket says almost
 *      nothing and the number says everything, so every surface shows the
 *      height itself — in the reader's own units, through `formatSurge`, the
 *      same as every other length in the app.
 *
 * ==> DISTANCE IS THE HALF OF THIS THAT CAN LIE. <== The export is a list of
 * towns with no notion of which one is anybody's. `nearestPlace()` applies
 * `GDACS_SURGE.homeRadiusKm` and returns null past it, because Lala's 47
 * places span four Hawaiian islands and a nearest-with-no-ceiling would hand a
 * Honolulu house the Big Island's number and print it as that house's
 * forecast (§5).
 *
 * Imports: config/ and lib/ only.
 */

import { GDACS_SURGE } from '../config/constants.js';
import { GDACS_SURGE_RAMP } from '../config/tokens.js';
import { greatCircleNm } from './geo.js';
import { formatSurge } from './units.js';

const KM_PER_NM = 1.852; // exact, by definition
const M_PER_FT = 0.3048;

/**
 * The GDACS event id this storm can be asked about, or null.
 *
 * ==> READ OFF `source` AND `sourceId`, WHICH ARE THE FIELDS THAT EXIST. <==
 * `data/gdacs.js` sets `source: 'gdacs'` and `sourceId: eventId`; there is no
 * `gdacsEventId` field on a storm anywhere in this app and a first draft of
 * this feature invented one, which would have rendered the whole section
 * invisible with nothing failing.
 *
 * ==> AND IT RETURNS NULL FOR EVERY STORM IN AN NHC BASIN. THAT IS THE DESIGN,
 *     NOT A LIMITATION. <== §51.5. `mergeStorms` (data/merge.js) drops the
 * GDACS twin of any storm whose basin NHC covers, so an Atlantic, East Pacific
 * or Central Pacific storm arrives as its NHC record alone.
 *
 * ==> AARON, 2026-08-19: NHC's SURGE DATA IS TRUSTED OVER GDACS'S, SO IN NHC's
 * BASINS NHC IS THE ONLY SOURCE. <== Do not "fix" this by matching an NHC storm
 * to a GDACS event by name. NHC publishes an official inundation forecast in
 * feet above ground level; this is a global model whose datum is stated
 * nowhere, whose figures are sub-metre on every storm measured, and whose own
 * two products disagree with each other (§51.1). Filling an American coast from
 * it would override the responsible warning centre with something weaker.
 *
 * The American half is NHC's own product (§4.8, §36). It shows nothing today
 * because `/api/nhc/surge` was never built, which is a route to write rather
 * than a source to substitute.
 */
export function gdacsEventIdOf(storm) {
  return storm?.source === 'gdacs' && storm.sourceId ? String(storm.sourceId) : null;
}

/** Kilometres between two points. `greatCircleNm` is the app's one distance
 *  function and this is a unit change on it, not a second implementation —
 *  two haversines in one codebase drift in the fourth decimal and then
 *  somebody spends an afternoon on it. */
export function kmBetween(lon1, lat1, lon2, lat2) {
  return greatCircleNm(lon1, lat1, lon2, lat2) * KM_PER_NM;
}

/**
 * A height in metres → its rung on `GDACS_SURGE_RAMP`, `0..4`.
 *
 * Open-ended at the top by construction: a height above the last threshold
 * lands on the last rung. `thresholdsM` has four entries and the ramp has
 * five colours, and that relationship is what makes "above 2 m" a rung rather
 * than a schema change the day a real typhoon produces one.
 */
export function surgeRung(heightM) {
  if (!Number.isFinite(heightM)) return null;
  const t = GDACS_SURGE.thresholdsM;
  for (let i = 0; i < t.length; i++) if (heightM < t[i]) return i;
  return t.length;
}

/** The paint for a height. Null for a height that is not a number — a town
 *  with no readable height is not painted, the same rule `cap-coast.js`
 *  applies to an alert with no stated severity. */
export function surgeColor(heightM) {
  const rung = surgeRung(heightM);
  return rung == null ? null : GDACS_SURGE_RAMP[rung].color;
}

/**
 * A modelled height in the reader's own units.
 *
 * ==> IT GOES THROUGH `formatSurge`, WHICH TAKES FEET. <== Every length in
 * this app is stored in one unit and formatted in the reader's, and surge's
 * storage unit is feet because NHC's product is feet (SPEC §8). This source
 * publishes metres, so the conversion happens HERE, once, at the boundary —
 * rather than a second surge formatter existing that takes metres and rounds
 * differently from the first one.
 *
 * ==> BELOW `negligibleM` IT IS WORDS, NOT A FIGURE. <== Same judgement
 * `RAIN.negligibleMm` records for the same reason: "0.0 m" or "0 ft" under a
 * house reads as a broken section rather than as a forecast. Returns null so
 * the caller writes the sentence; a shared "about none" string here would be
 * words in the arithmetic file.
 */
export function formatSurgeHeight(heightM, system) {
  if (!Number.isFinite(heightM)) return null;
  if (heightM < GDACS_SURGE.negligibleM) return null;
  return formatSurge(heightM / M_PER_FT, system);
}

/**
 * The town this house should be told about, or null.
 *
 * @param {Array} places  the relay's projection (§51.2)
 * @param {{lat:number, lon:number}} home
 * @returns {{place:object, km:number}|null}
 *
 * ==> NEAREST, AND THEN A CEILING. <== Not "the deepest within the radius":
 * a reader asking what happens at their house is asking about their house,
 * and handing them a worse number from a town further away — because it is
 * scarier — is inventing a forecast for a place the model did not run for.
 * The deepest town for the storm as a whole is a separate figure and it is
 * labelled as such.
 */
export function nearestPlace(places, home, radiusKm = GDACS_SURGE.homeRadiusKm) {
  if (!Array.isArray(places) || !home || !Number.isFinite(home.lat)) return null;
  let best = null;
  for (const p of places) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) continue;
    const km = kmBetween(home.lon, home.lat, p.lon, p.lat);
    if (km > radiusKm) continue;
    if (!best || km < best.km) best = { place: p, km };
  }
  return best;
}

/**
 * Everything the home Surge section renders, from one relay payload.
 *
 * ==> IT COMPUTES AND IT DOES NOT WRITE SENTENCES. <== The same split
 * `rainSummary` uses: figures that can be asserted against captured bytes stay
 * here where a test reaches them with no browser, and the phrasing stays where
 * somebody can change it without touching arithmetic.
 *
 * FOUR STATES, AND THEY ARE NOT INTERCHANGEABLE (§5):
 *
 *   ok            a town near this house has a modelled height
 *   out_of_range  the model ran and produced towns, none near this house.
 *                 A FACT ABOUT THE HOUSE. Never retryable, and never worded as
 *                 "no surge" — a house 200 km from the nearest modelled town
 *                 has not been told it is safe, it has been told nobody looked.
 *   none_matched  the model ran and produced no towns at all — Hernán,
 *                 mid-ocean. A FACT ABOUT THE STORM, and the only one of these
 *                 four that may be worded as an all-clear.
 *   unavailable   handled by the caller, not here — this function is only ever
 *                 given a payload that arrived.
 *
 * @param {object} payload the relay's projection
 * @param {{lat:number, lon:number}} home
 * @param {{system?:string|null, bulletinBaseMs?:number|null}} opts
 */
export function surgeAtHome(payload, home, { system = null, bulletinBaseMs = null } = {}) {
  if (payload?.status === 'none_matched' || payload?.placeCount === 0) {
    return { state: 'none_matched' };
  }

  const places = Array.isArray(payload?.places) ? payload.places : null;
  if (!places || !places.length) return { state: 'none_matched' };

  /* The storm's own worst town, regardless of the house. Carried on every
   * state below `ok` as well, because "nothing near you; the worst anywhere is
   * X at Y" is a far more useful sentence than a bare absence — and the relay
   * already sorted deepest-first, so this is the head of the list rather than
   * a second pass. */
  const worst = places[0];

  const near = nearestPlace(places, home);
  if (!near) {
    return {
      state: 'out_of_range',
      worst: describe(worst, system, bulletinBaseMs),
      placeCount: payload.placeCount ?? places.length,
    };
  }

  return {
    state: 'ok',
    km: near.km,
    here: describe(near.place, system, bulletinBaseMs),
    /* ==> NAMED ONLY WHEN IT IS A DIFFERENT RUNG, AND THE FIRST RULE HERE WAS
     * WRONG. <== It read "deeper by more than `negligibleM`", which borrowed a
     * constant meaning "too small to print" to answer "too small a difference
     * to mention" — two different jobs, and at this product's scale the
     * borrowed number silences everything: Lala's entire 47-town spread is
     * 0.10 m to 0.17 m, so no town on that storm is 0.1 m deeper than any
     * other. The rung is the honest test. If the deepest town anywhere shares
     * this house's colour, it is the same story and repeating it is noise; if
     * it is a rung up, that is a real difference and worth a sentence. */
    worst: worst !== near.place && surgeRung(worst.heightM) > surgeRung(near.place.heightM)
      ? describe(worst, system, bulletinBaseMs)
      : null,
    placeCount: payload.placeCount ?? places.length,
  };
}

/**
 * The storm's own modelled coastal flooding, with no house in it. §56.7.
 *
 * ==> IT EXISTS BECAUSE THE STORM DRAWER MAY NOT ASK ABOUT THE READER'S
 * HOUSE. <== §56.9: a storm panel is about the storm. `surgeAtHome` answers
 * "how much water reaches THIS ADDRESS", which is the home dashboard's
 * question and belongs on the home dashboard. The storm drawer's Flooding
 * section asks the storm-shaped version of the same question — how much water
 * this storm is modelled to put on any coast, and where — and that answer is
 * already sitting at the head of the list, because the relay sorted it
 * deepest-first.
 *
 * ==> IT IS NOT `surgeAtHome` WITH A NULL HOME, AND THAT WAS THE TEMPTING
 * WRONG SHAPE. <== That function's `out_of_range` state means "the model ran
 * and nothing is near YOU", which is a fact about a house. Reached with no
 * house it would be a sentence about the reader's address on a panel that has
 * no business having one, and the state itself would be meaningless. Two
 * questions, two functions, and neither can answer as the other by accident.
 *
 * TWO STATES ONLY:
 *
 *   ok            the model produced towns; `worst` is the deepest of them.
 *   none_matched  the model ran and produced no populated place at all —
 *                 Hernán, mid-ocean. A fact about the storm, and the one
 *                 answer here that may be worded as an all-clear.
 *
 * `unavailable` is the caller's, exactly as it is for `surgeAtHome`: this
 * function is only ever handed a payload that arrived.
 *
 * @param {object} payload the relay's projection
 * @param {{system?:string|null, bulletinBaseMs?:number|null}} opts
 */
export function surgeOnStorm(payload, { system = null, bulletinBaseMs = null } = {}) {
  if (payload?.status === 'none_matched' || payload?.placeCount === 0) {
    return { state: 'none_matched' };
  }

  const places = Array.isArray(payload?.places) ? payload.places : null;
  if (!places || !places.length) return { state: 'none_matched' };

  return {
    state: 'ok',
    worst: describe(places[0], system, bulletinBaseMs),
    placeCount: payload.placeCount ?? places.length,
  };
}

/** One town, with its figures resolved. `arrivalMs` is null unless the caller
 *  supplied the bulletin base — the offsets in this product are hours from the
 *  storm's FIRST bulletin, so without that instant they are a duration and not
 *  a time, and printing a clock time from a guessed base would be a confident
 *  wrong answer about when water arrives. */
function describe(p, system, bulletinBaseMs) {
  const negligible = p.heightM < GDACS_SURGE.negligibleM;
  return {
    city: p.city,
    country: p.country || null,
    heightM: p.heightM,
    heightText: formatSurgeHeight(p.heightM, system),
    negligible,
    color: surgeColor(p.heightM),
    rung: surgeRung(p.heightM),
    arrivalHours: Number.isFinite(p.arrivalHours) ? p.arrivalHours : null,
    peakHours: Number.isFinite(p.peakHours) ? p.peakHours : null,
    arrivalMs: Number.isFinite(bulletinBaseMs) && Number.isFinite(p.arrivalHours)
      ? bulletinBaseMs + p.arrivalHours * 3600000
      : null,
    peakMs: Number.isFinite(bulletinBaseMs) && Number.isFinite(p.peakHours)
      ? bulletinBaseMs + p.peakHours * 3600000
      : null,
  };
}
