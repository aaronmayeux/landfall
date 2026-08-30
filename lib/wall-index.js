/**
 * wall-index.js — reading the Wall of Years index.
 * SPEC-SEASONS-BUILD.md §57.29, §57.36.
 *
 * Pure. No DOM, no network, no `data/`. Everything here runs under `node`,
 * which is the whole reason the arithmetic lives in `lib/` and not in the view.
 *
 * ==> THE FOUR FIELD POSITIONS ARE NAMED HERE AND IN `tools/seasons-wall.mjs`,
 * AND THOSE TWO MUST NOT DRIFT. <== A storm arrives as a bare array of four
 * numbers, so an off-by-one silently reads landfall as category — every dot
 * the wrong colour, nothing thrown, nothing to notice. `tools/test-wall-index.mjs`
 * asserts the two files agree rather than trusting a comment to keep them so.
 */

import { SEASONS } from '../config/constants.js';

/** `LANDFALL` is 0 or 1 — did this storm touch land at all. See `stormRow`:
 *  it briefly held a count and Aaron reverted that on glass. */
export const CAT = 0, LANDFALL = 1, ACE = 2, PEAK_KT = 3;

/**
 * ==> THE SECOND THREE ARRIVED WITH STEP 3'S COLLAPSED FILTERS AND COST 15 KB
 * GZIPPED. <== §57.36 asks for filters on how long a storm lasted, how low its
 * pressure went, and whether its name was retired. None of those is derivable
 * from the first four columns, so the file had to widen or the controls had to
 * be dropped.
 *
 * MEASURED on the real files before the shape was chosen, 3,266 storms:
 * 10.4 KB gzipped today, 14.6 with days, 18.6 with pressure, 25.7 with names.
 * Re-derive with `node tools/seasons-wall.mjs --measure`; do not trust this
 * paragraph over the tool.
 *
 * ==> `NAME` IS WHAT THE RETIRED CHIP JOINS ON, AND IT NEEDS THE YEAR BESIDE
 * IT. <== §57.52. The name alone is not an answer: Ida 2021 is retired and Ida
 * 2009 is not, and a name-only join marks 202 storms that never earned it. A
 * storm row carries no year of its own — the year is the key it was found
 * under — so `rowsFor` passes it to the predicate explicitly.
 */
export const DAYS = 4, PRESSURE_MB = 5, NAME = 6;

/** Where the satellite era starts, and therefore where the record stops being
 *  an undercount. §57.36. One constant, read by the wall and by
 *  `lib/season-facts.js` alike. */
export const SATELLITE_ERA_FROM = SEASONS.satelliteEraFrom;

/** A season the record holds no storms for. §5 — this is `clear`, and it is a
 *  different answer from a year the file does not mention at all, which the
 *  generator makes impossible on purpose. */
export const isQuiet = (row) => row.total === 0;

/** One decimal place on ACE. The generator writes it rounded, and the live
 *  season is rounded here, so a settled row and a live row are the same shape
 *  down to the last digit. */
const ACE_DP = 10;

/**
 * One storm, reduced to the four numbers a wall row is made of.
 *
 * ==> IT LIVES HERE RATHER THAN IN THE GENERATOR SO THERE IS ONE COPY. <==
 * `tools/seasons-wall.mjs` writes settled seasons on the runner and the browser
 * builds the LIVE season's row at read time, and both have to produce the same
 * four columns in the same order. Two implementations of that is one dot the
 * wrong colour for the current year and nothing on screen saying so.
 *
 * ==> A NULL CATEGORY STAYS NULL. <== §6. A storm the record never graded is
 * not a tropical depression. Writing 0 would put it under the TD chip, colour
 * it as one, and count it as one — three wrong answers from one convenience.
 *
 * ==> AND ACE IS `0` WHERE THE STORM EARNED NONE, `null` WHERE IT COULD NOT BE
 * MEASURED. <== §5's missing-versus-none, arriving through arithmetic.
 */
export function stormRow(facts) {
  const cat = Number.isFinite(facts?.peakCategory) ? facts.peakCategory : null;

  /* ==> A FLAG, AND IT WENT BACK TO BEING ONE. <== §57.7a. For about a day it
   * carried a real count, because computing landfalls ourselves finally made
   * counting them possible. Aaron reverted it on glass, 2026-08-27, and the
   * reason is worth keeping so nobody re-derives the count as an improvement:
   *
   * **The wall asks whether a storm touched land, not how often.** A count
   * turns the sort into a ranking of ARCHIPELAGOS. Irene crossed five separate
   * Bahamian islands and scores 10; Katrina scores 1. 1933 topped the wall at
   * 41 while a season that flattened the Gulf coast scored 6. Every one of
   * those numbers was correct and the leaderboard they built was useless.
   *
   * The real counts are not lost — they are in the landfall file per storm,
   * where "Irene made 10 landfalls" is a fact about Irene rather than a claim
   * about 1933 being the worst season on record. */
  const landfall = (facts?.landfalls?.length || 0) > 0 ? 1 : 0;
  const ace = Number.isFinite(facts?.ace) ? Math.round(facts.ace * ACE_DP) / ACE_DP : null;
  const kt = Number.isFinite(facts?.peakWindKt) ? facts.peakWindKt : null;

  /* ==> DAYS, NOT HOURS, AND ROUNDED TO ONE PLACE. <== The reader's question is
   * "which storms lasted a long time", and a tenth of a day is six hours, which
   * is exactly the resolution the record has. Hours would be three more digits
   * per storm across 3,266 of them for precision the source does not carry. */
  const days = Number.isFinite(facts?.lifespanHours)
    ? Math.round((facts.lifespanHours / 24) * ACE_DP) / ACE_DP
    : null;

  /* ==> A STORM WITH NO PRESSURE READING IS `null`, NEVER 1013. <== §5. Before
   * aircraft reconnaissance most storms carry no central pressure at all —
   * 1,235 of the Atlantic's 2,004 — and a filter on "under 950 mb" must exclude
   * those as unmeasured rather than sweep them in on a stand-in sea-level
   * figure that would silently make every 1850s storm look weak. */
  const mb = Number.isFinite(facts?.lowestPressureMb) ? facts.lowestPressureMb : null;

  /* Empty string rather than null: it is the overwhelmingly common value in the
   * early record and `""` is two bytes where `null` is four, across thousands
   * of rows. Consumers test truthiness either way. */
  const name = typeof facts?.name === 'string' ? facts.name : '';

  return [cat, landfall, ace, kt, days, mb, name];
}

/**
 * Every season in one basin, newest first, as rows the wall can draw.
 *
 * ==> `shown` AND `total` ARE BOTH CARRIED FROM THE START, EVEN THOUGH STEP 2
 * HAS NO FILTER. <== §57.36's count column is `4 of 31` and the reason is that
 * a bare 4 invites a comparison the row cannot support — 2005 had 31 storms and
 * 1932 had 15. Building the row with one number now would mean every consumer
 * of it changing when the filter lands, so the shape is right from the first
 * push and the filter fills it in.
 *
 * @param {object|null} wall   the parsed index
 * @param {string} basin
 * @param {(storm:Array) => boolean} [keep]  the filter, or nothing
 * @returns {Array<{year:number, shown:Array, total:number, strongest:number,
 *   landfalls:number, ace:number|null, aceMeasured:boolean, pre:boolean}>}
 * `landfalls` is how many storms came ashore, not how many landfalls happened.
 */
/**
 * The three figures a row carries about its own storms.
 *
 * ==> IT IS ONE FUNCTION BECAUSE THERE ARE THREE CALLERS AND THEY MUST AGREE.
 * <== `rowsFor` for a settled season, `liveRow` for the season in progress,
 * and `lib/wall-filter.js` re-deriving them after a filter narrows a row. Three
 * copies of "the strongest storm still showing" is three answers to the same
 * question on one screen.
 *
 * @param {Array<Array>} shown  storm rows, already filtered
 */
export function aggregate(shown) {
  /* -1 rather than null, so the sort comparator never has to branch. It is
   * turned back into "none graded" at the point words are made. */
  let strongest = -1;
  let landfalls = 0;
  let ace = 0;
  let aceMeasured = false;

  for (const s of shown || []) {
    const c = s[CAT];
    if (Number.isFinite(c) && c > strongest) strongest = c;
    /* Counted, not summed. One storm that came ashore is one, however many
     * times it did. See `stormRow` for why the sum was wrong. */
    if (s[LANDFALL]) landfalls++;
    /* ==> A STORM WITH NO MEASURABLE ACE CONTRIBUTES NOTHING AND DOES NOT
     * MAKE THE SUM ZERO. <== §5 through arithmetic: a season whose storms
     * were all unmeasurable has an UNKNOWN ACE, not an ACE of nought, and
     * the two must not sort into the same place. */
    if (Number.isFinite(s[ACE])) { ace += s[ACE]; aceMeasured = true; }
  }

  return {
    strongest,
    landfalls,
    ace: aceMeasured ? Math.round(ace * ACE_DP) / ACE_DP : null,
    aceMeasured,
  };
}

export function rowsFor(wall, basin, keep = null) {
  const years = wall?.basins?.[basin]?.years;
  if (!years) return [];

  const out = [];
  for (const [key, list] of Object.entries(years)) {
    const year = Number(key);
    if (!Number.isFinite(year)) continue;

    /* ==> THE ARROW IS LOAD-BEARING AND `list.filter(keep)` IS A BUG. <==
     * `Array.filter` calls its predicate with `(element, index, array)`, so
     * passing `keep` bare hands the retired filter an ARRAY INDEX where it
     * expects a year. Nothing throws: index 0 through 30 are all plausible
     * years to `Number.isFinite`, they simply match nothing, and the chip would
     * silently return an empty wall. A storm row carries no year of its own —
     * the year is the key it was found under — so it has to be named here. */
    const shown = keep ? list.filter((s) => keep(s, year)) : list;

    out.push({
      year,
      shown,
      total: list.length,
      ...aggregate(shown),
      pre: year < SATELLITE_ERA_FROM,
    });
  }

  out.sort((a, b) => b.year - a.year);
  return out;
}

/**
 * The season in progress, as a wall row.
 *
 * ==> IT IS BUILT IN THE BROWSER BECAUSE IT CANNOT BE BUILT ON THE RUNNER.
 * <== `seasons/wall.json` comes out of HURDAT2, which is NOAA's REVIEWED
 * record — the current year is not in it and cannot be until next February
 * (§57.11). Before this existed the wall's newest row was last year and the
 * season actually happening was unreachable, which is the regression that
 * removing the year dropdown created.
 *
 * ==> ENDED STORMS GET DOTS. STORMS STILL RUNNING GET COUNTED IN WORDS. <==
 * §57.21c, and it is the same rule the archive globe already follows: a storm
 * the live app is still drawing in colour is not part of the past. Drawing it
 * as a dot beside the finished ones would say the season is over when it is
 * not, and the count says the opposite in the one place a reader is looking.
 *
 * ==> `landfallsKnown` IS THE MASK'S ANSWER, NOT A CONSTANT FALSE. <== §57.7b.
 * Measured on the real 2026 b-decks (§57.18b): the working best track carries
 * NO landfall marker, because NOAA writes those into the reviewed record the
 * following spring. Until 2026-08-28 that made this permanently false and the
 * running season permanently unmarked. It is now answerable on the device —
 * `lib/land-mask.js` ships the same coastline the archive is measured against
 * and `lib/landfall.js` runs the same walk — so this flag tracks whether that
 * answer actually arrived. False still means "not recorded yet" and step 4's
 * triangles still must not draw the absence as a claim.
 *
 * @param {object} opts
 * @param {number} opts.year
 * @param {Array<object>} opts.facts      `stormFacts` for every storm loaded
 * @param {Set<string>|null} opts.running lowercased ATCF ids the live app is
 *   still drawing, or null when the live feed has never answered
 */
export function liveRow({ year, facts, running }) {
  const ended = [];
  let active = 0;

  for (const f of facts || []) {
    /* ==> `null` RUNNING IS "CANNOT ASK", NOT "NOTHING IS RUNNING". <== §5,
     * §57.21c. With no answer from the live feed, treating every storm as
     * ended would draw a season as finished that may not be — so nothing is
     * claimed as active and nothing is claimed as over either: the storms are
     * drawn and the count is withheld (`activeKnown` below). */
    if (running && running.has(String(f?.id).toLowerCase())) { active++; continue; }
    ended.push(f);
  }

  /* ==> THE SAME AGGREGATE THE SETTLED ROWS USE, OVER THE SAME COLUMNS. <== It
   * used to read `peakCategory` and `ace` off the FACTS while `rowsFor` read
   * them off the row arrays, which is two implementations of one figure — and
   * the drift would show up only on the current year, where nothing is
   * cross-checkable against NOAA. Reducing to rows first makes them one. */
  const shown = ended.map(stormRow);
  const agg = aggregate(shown);

  /* ==> KNOWN-NESS IS READ OFF THE FACTS, NEVER PASSED IN ALONGSIDE THEM. <==
   * §57.7b. `stormFacts` already stamps each storm `computed` or `noaa`, so
   * asking the facts is asking the same thing that produced the dots. A
   * separate flag threaded down from the loader would be a second copy of one
   * truth, and the failure it invites is the quiet one: the mask fails to
   * arrive, the flag still says true, and the row states that nothing came
   * ashore this year on the strength of NOAA markers the working best track
   * does not carry (§57.18b).
   *
   * So an empty landfall list means "measured, and it stayed at sea" only when
   * the mask answered for it, and means "not known" the rest of the time. */
  const known = ended.length > 0
    && ended.every((f) => f?.landfallSource === 'computed');

  return {
    year,
    shown,
    total: ended.length + active,
    strongest: agg.strongest,
    /* ==> MEASURED WHEN THE MASK ANSWERED, AND STRUCTURALLY ZERO WHEN IT DID
     * NOT. <== §57.7b. The working best track carries no landfall marker at
     * all (§57.18b), so before the mask lands the only honest reading of 0 is
     * "not recorded yet" — which is what `landfallsKnown: false` says. Once the
     * mask has answered, 0 is a real measurement and means the season's ended
     * storms genuinely stayed at sea. */
    landfalls: known ? agg.landfalls : 0,
    landfallsKnown: known,
    ace: agg.ace,
    aceMeasured: agg.aceMeasured,
    pre: false,
    live: true,
    active,
    activeKnown: running != null,
  };
}

/**
 * How big one dot is, so that the widest season in the basin fits the strip.
 *
 * ==> THE SCALE IS PER BASIN, NEVER PER ROW, AND THAT IS THE WHOLE POINT OF
 * THE SCREEN. <== If a violent year did not physically look longer than a quiet
 * one there would be no reason to draw a wall at all. Sizing each row to its
 * own contents would make every strip the same length and turn 175 years of
 * history into 175 identical bars.
 *
 * Clamped at both ends: `SEASONS.wallDotMin` keeps a dot visible on the busiest
 * basin, `wallDotMax` stops a sparse basin drawing beach balls.
 *
 * @param {object|null} wall
 * @param {string} basin
 * @param {number} stripPx  the space a strip has, in CSS pixels
 */
export function dotSizeFor(wall, basin, stripPx) {
  const years = wall?.basins?.[basin]?.years || {};
  let widest = 0;
  for (const list of Object.values(years)) if (list.length > widest) widest = list.length;
  if (!widest) return { size: SEASONS.wallDotMin, gap: SEASONS.wallDotGap, widest: 0 };

  const gap = SEASONS.wallDotGap;
  const room = Math.max(0, stripPx - gap * (widest - 1));
  const size = Math.floor(room / widest);
  return {
    size: Math.max(SEASONS.wallDotMin, Math.min(SEASONS.wallDotMax, size)),
    gap,
    widest,
  };
}

/**
 * The row's accessible name.
 *
 * ==> THE DOTS ARE DECORATION AND THIS SENTENCE IS THE ROW. <== §13. A screen
 * reader gets no strip at all, so everything the strip says has to be here:
 * how many storms, how strong the worst of them got, and — this is the one that
 * matters — whether the year predates satellites, because a short strip in 1890
 * means something different from a short strip in 1990 and a reader who cannot
 * see the shading has no other way to know.
 */
export function rowLabel(row, { catLabel, isRetired = null }) {
  const n = row.shown.length;
  if (!n) return `${row.year} — no storms recorded`;
  const strongest = row.strongest < 0 ? 'none graded' : `strongest ${catLabel(row.strongest)}`;
  const under = row.pre ? ', before satellites — likely an undercount' : '';

  /* ==> THE TRIANGLES ARE INFORMATION AND THIS IS THE ONLY WAY TO REACH THEM.
   * <== §13, and it is the same rule the rest of this sentence already obeys:
   * the strip is `aria-hidden`, so anything drawn in it that is not also said
   * here does not exist for a reader who cannot see it. Sub-step 4 put a mark
   * under every storm that came ashore; without this line that mark is visual
   * only.
   *
   * ==> AND `none` IS SAID OUT LOUD RATHER THAN LEFT OUT. <== A sentence that
   * mentions landfalls only when there were some cannot be told apart from a
   * sentence that never mentions them at all — silence would read as "not
   * known" on a year where it is known and the answer is nought (§5). Every
   * settled season has a computed answer (§57.7a), so nought here is a real
   * measurement and it is worth three words to say so.
   *
   * Counted over `shown`, not over the season, so it agrees with the triangles
   * actually on screen under a filter rather than with the ones a filter just
   * removed. */
  const ashore = row.landfalls > 0
    ? `, ${row.landfalls} made landfall`
    : ', none made landfall';

  /* ==> THE BAR IS INFORMATION AND THIS IS THE ONLY WAY TO REACH IT. <== §13,
   * §57.52, and it is exactly the rule the landfall clause above already obeys:
   * the strip is `aria-hidden`, so a mark drawn in it that is not also said
   * here does not exist for a reader who cannot see it.
   *
   * ==> BUT SILENCE HERE MEANS "NONE", NOT "NONE MADE LANDFALL"'S EXPLICIT
   * NOUGHT, AND THAT ASYMMETRY IS DELIBERATE. <== Landfall says `none` out
   * loud because every settled season has a COMPUTED answer, so nought is a
   * real measurement (§57.7a). Retirement has no such guarantee: below a
   * basin's derivation floor the frozen historic block answers and nothing in
   * the data distinguishes "no name from this year was withdrawn" from "this
   * era was never assessed". §5 — so the sentence speaks only when the answer
   * is yes, and never states a negative it cannot stand behind. */
  let retiredSaid = '';
  if (isRetired) {
    let count = 0;
    for (const s of row.shown) if (isRetired(s[NAME])) count++;
    if (count > 0) retiredSaid = `, ${count} later retired`;
  }

  return `${row.year} — ${n} storm${n === 1 ? '' : 's'}, ${strongest}${ashore}${retiredSaid}${under}`;
}
