/**
 * season-shape-markup.js — the three sentences §57.48 adds to the archive's
 * storm panel. SPEC-SEASONS-BUILD.md §57.48, §57.42 Tier 1 items 4, 6 and 8.
 *
 * ==> EACH ONE JOINS A SECTION THAT ALREADY EXISTS. <== Aaron's call,
 * 2026-08-29. The comeback goes under `How it changed`, the season window
 * under `In its season`, the origin under `How it moved`. No new heading, no
 * tenth section on a panel Aaron already accepted as crowded at nine.
 *
 * ==> THEY LIVE IN THEIR OWN FILE BECAUSE `season-detail-markup.js` WAS 19
 * LINES UNDER §12's CEILING. <== The sections these join are built there and
 * the strings are appended by `ui/view-season-detail.js`, which is where the
 * panel is composed anyway. A section is where a sentence APPEARS; it does not
 * have to be where the sentence is written.
 *
 * ==> ALL THREE ARE SENTENCES RATHER THAN ROWS, AND THAT IS NOT A STYLE CALL.
 * <== §57.25 bans a value slot that shrugs. `Cape Verde — yes` is a row whose
 * value carries no information without the label, and `Out of season — early`
 * is worse: it states a verdict and hides the date that justifies it. Each of
 * these is a comparison or a judgement, so each is said as a sentence with its
 * evidence in it.
 *
 * Every function is PURE — told what to draw, reading no module state, no
 * clock and no DOM. Imports config/, lib/ and the shared markup bits.
 */

import { SEASONS } from '../config/constants.js';
/* ==> THE LOOP'S WIDTH IS THE FIRST FIGURE THIS FILE PRINTS, AND IT GOES
 * THROUGH THE APP'S ONE CONVERTER. <== §57.45, §57.49. The other three
 * sentences here carry dates, knots and degrees, none of which change with the
 * reader's unit preference. A distance does, and writing the arithmetic here
 * would be a second opinion about a setting `lib/units.js` already owns. */
import { formatDistance } from '../lib/units.js';
import { absenceHtml, utcDay } from './season-markup-bits.js';

/** Month names for the season-window sentence. Written out rather than run
 *  through `utcDay`, because these are calendar boundaries with no year and no
 *  storm attached — `June 1` rather than `June 1, 2017`. */
const MONTHS = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);

const monthDay = (month, day) => `${MONTHS[month - 1]} ${day}`;

/* ---------------------------------------------------------------------------
 * THE COMEBACK — joins `How it changed`
 * ------------------------------------------------------------------------- */

/**
 * A hurricane that fell to a depression and became a hurricane again.
 *
 * ==> IT NAMES BOTH DATES AND THE WIND IT FELL TO. <== Without them the
 * sentence is a label — "this storm made a comeback" — which the reader has to
 * take on trust. With them it is a claim they can check against the track on
 * the globe and against the `Fastest strengthening` row directly above it.
 *
 * ==> AND IT SAYS NOTHING AT ALL WHEN THERE WAS NO COMEBACK. <== 14 storms in
 * 3,266 have one. A sentence saying "it did not weaken and recover" on the
 * other 3,252 would be a qualifier that fires everywhere and qualifies
 * nothing, and it would push the real ones down the section.
 *
 * @param {object|null} cb  `facts.comeback` from `lib/storm-shape.js`
 * @returns {string}  HTML, or '' when there is nothing to say
 */
export function comebackHtml(cb) {
  if (!cb || !Number.isFinite(cb.fellKt)) return '';
  const fell = utcDay(cb.fellTime);
  const back = utcDay(cb.backTime);
  if (!fell || !back) return '';

  return absenceHtml(
    `It fell apart and came back. By ${fell} it was down to ${Math.round(cb.fellKt)} knots, `
    + `weaker than a tropical storm, and by ${back} it was a hurricane again.`,
  );
}

/* ---------------------------------------------------------------------------
 * OUT OF SEASON — joins `In its season`
 * ------------------------------------------------------------------------- */

/**
 * A storm that arrived before its basin's season opened, or after it shut.
 *
 * ==> THE SENTENCE CARRIES THE SEASON'S OWN DATES, BECAUSE THEY ARE NOT THE
 * SAME IN EVERY BASIN. <== `SEASONS.seasonWindows`: the Atlantic opens June 1
 * and the East Pacific opens May 15. A reader who learned "the season starts
 * June 1" from an Atlantic storm and then met an East Pacific storm dated May
 * 20 with no explanation would reasonably conclude the app had missed one.
 * Printing the window that was actually applied removes the question.
 *
 * ==> IT DOES NOT SAY HOW EARLY OR HOW LATE IN DAYS. <== The two dates are on
 * the same line and the reader can see the gap. A computed "three weeks early"
 * would be a second figure to get wrong for nothing, and across a December
 * storm it would have to reason about which season it belongs to.
 *
 * @param {object|null} sw  `facts.seasonWindow` from `lib/storm-shape.js`
 * @returns {string}  HTML, or '' when the storm formed inside its season or
 *   the basin has no window on file
 */
export function seasonWindowHtml(sw) {
  if (!sw || (sw.side !== 'early' && sw.side !== 'late')) return '';

  const formed = monthDay(sw.month, sw.day);
  const opens = monthDay(sw.startMonth, sw.startDay);
  const shuts = monthDay(sw.endMonth, sw.endDay);

  return absenceHtml(sw.side === 'early'
    ? `It formed out of season, on ${formed}. This basin\u2019s season does not open `
      + `until ${opens}.`
    : `It formed out of season, on ${formed}. This basin\u2019s season had shut on `
      + `${shuts}.`);
}

/* ---------------------------------------------------------------------------
 * WHERE IT WAS BORN — joins `How it moved`
 * ------------------------------------------------------------------------- */

/**
 * Cape Verde, or home-grown.
 *
 * ==> THIS IS THE ONE OF THE THREE THAT SPEAKS ON THE ORDINARY CASE TOO. <==
 * The other two say nothing when the answer is no, because "it did not make a
 * comeback" is a non-event. Origin is different: both labels are real
 * information and the distinction only means anything if the reader sees both
 * halves of it. A storm born off Africa has an ocean to cross before it
 * threatens anybody; one born in the western Caribbean may have two days.
 *
 * ==> BUT IT STAYS SILENT ON THE 11 STORMS THAT ARE NEITHER. <== `origin`
 * returns a `kind` of null for a genesis east of `capeVerdeMaxLon` and north
 * of the Cape Verde latitudes — the far eastern Atlantic outside the belt.
 * Printing "it formed inside the basin" there would be false and would read
 * exactly like the other 1,811. The reasoning and the count are at `origin`.
 *
 * ==> IT SITS IN `How it moved` BECAUSE IT IS ABOUT THE TRACK, NOT THE
 * POSITION. <== The genesis coordinates are already on the panel and the
 * paragraph already names the place (§57.40a). What this adds is what the
 * birthplace implies about the journey, which is the section's subject.
 *
 * @param {object|null} o  `facts.origin` from `lib/storm-shape.js`
 * @returns {string}  HTML, or '' outside the basins that make the distinction
 *   and on a genesis neither label fits
 */
/**
 * A track that turned a full circle and crossed itself.
 *
 * ==> IT NAMES BOTH DATES AND THE WIDTH, WHICH IS THE SAME RULE THE COMEBACK
 * FOLLOWS. <== Without them the sentence is a label the reader has to take on
 * trust. With them it is a claim they can check by looking at the track on the
 * globe, and the width is the difference between Ivan 2004 turning a circle
 * 790 miles across and a storm doing a tight one in a day.
 *
 * ==> THE WIDTH GOES THROUGH `formatDistance`, WHICH MEANS `system` HAS TO
 * REACH HERE. <== §57.45. It is the one function in the app that turns a
 * stored nautical mile into the reader's own miles or kilometres, and `auto`
 * — which follows the device — is exactly the value a conversion written
 * here would get wrong. It is also what keeps this sentence agreeing with the
 * distance rows directly above it in the same section.
 *
 * ==> AND IT SAYS NOTHING WHEN THERE WAS NO LOOP. <== 120 storms in 3,266
 * have one. `trackLoop` has already refused the ones too small to be real, so
 * an empty answer here covers both "it did not loop" and "it wobbled inside
 * the rounding", and neither is worth a line on the panel.
 *
 * @param {object|null} lp  `facts.loop` from `lib/storm-shape.js`
 * @param {string|null} system  the reader's unit preference
 * @returns {string}  HTML, or '' when there is nothing to say
 */
export function loopHtml(lp, system) {
  if (!lp || !Number.isFinite(lp.widthNm)) return '';
  const from = utcDay(lp.startTime);
  const to = utcDay(lp.endTime);
  if (!from || !to) return '';

  return absenceHtml(
    `It looped. Between ${from} and ${to} its track crossed itself, turning a full `
    + `circle about ${formatDistance(lp.widthNm, system)} across.`,
  );
}

export function originHtml(o) {
  if (o?.kind === 'cape-verde') {
    return absenceHtml('It was a Cape Verde storm, formed in the far eastern Atlantic '
      + 'off the coast of Africa, with the whole ocean ahead of it.');
  }
  if (o?.kind === 'home-grown') {
    return absenceHtml('It formed inside the basin rather than coming off Africa, west '
      + `of ${Math.abs(SEASONS.capeVerdeMaxLon)}\u00B0W.`);
  }
  return '';
}
