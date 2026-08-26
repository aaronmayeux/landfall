/**
 * seasons-near-home.js — the fourth filter and the radius slider.
 * SPEC-SEASONS-BUILD.md §57.19, §57.30 step 9.
 *
 * ==> IT IS A FILE OF ITS OWN BECAUSE THE TWO IT WOULD OTHERWISE JOIN ARE
 * ALREADY OVER THE CEILING. <== `ui/view-seasons-board.js` is 868 lines and
 * `ui/seasons-board-markup.js` is 730, both past §12's ~700. This is the fifth
 * seasons pass in a row where the honest place for new code was a new file,
 * and the alternative — a hundred more lines in whichever of the two happened
 * to be convenient — is exactly the "bolt it on for now" §12 exists to forbid.
 *
 * ==> AND THE SEASON FILTER NEEDS NOTHING DOWNLOADED. <== This is the half of
 * step 9 that costs nothing. §57.35 fault 2's precomputed index exists for the
 * WHOLE ARCHIVE, which is the Home dashboard's question. A single season is
 * thirty storms and nine hundred segments already sitting in memory — the
 * measurement runs in under a millisecond, on every pixel of a slider drag,
 * with no worker, no fetch and no store. Reaching for the index here would be
 * paying a megabyte to answer a question the loaded file already answers.
 *
 * ==> THE FILTER IS ONLY OFFERED WHEN THERE IS A HOME. <== §57.18a's rule
 * about a control that cannot succeed, applied again: with no house set, "Near
 * home" can only ever narrow to nothing, and an empty roster is the one thing
 * this feature must not produce by accident. A reader with no home sees three
 * filters and misses nothing they could have used.
 *
 * ==> AND THE SLIDER IS THE APP'S OWN, DOWN TO THE CLASS NAMES. <== `.slider`,
 * `.slider-row`, `.slider-label` and `.slider-value` are Settings' controls
 * (`ui/panels.css`), and `ui/slider-grab.js`'s thumb rule comes with them. A
 * second range control styled separately would be a second thing to keep in
 * step with the visual contract, and a second one to remember to guard against
 * the scroll-past-a-slider trap.
 *
 * Imports config/ and lib/. Pure: told what is true, returns markup or numbers.
 * No DOM, no clock, no stored setting read here.
 */

import { closestApproach } from '../lib/near-home.js';
import { approachPhrase, radiusToNm, rangeFor } from '../lib/near-home-words.js';

/** The filter's id, written in one place because three files compare against
 *  it — the board's state, the markup's filter list, and this file's own
 *  matcher. Three string literals is how a filter offered by one and unknown
 *  to another ends up narrowing a roster to nothing. */
export const NEAR_HOME_FILTER = 'near';

/**
 * The filter entry, or nothing.
 *
 * @param {{lon:number, lat:number}|null} home
 * @returns {Array<{id:string,label:string}>} zero or one entry, to spread
 */
export function nearHomeFilters(home) {
  const has = Number.isFinite(home?.lon) && Number.isFinite(home?.lat);
  return has ? [{ id: NEAR_HOME_FILTER, label: 'Near home' }] : [];
}

/**
 * Which storms in this season came within the radius, and how close.
 *
 * ==> IT RETURNS THE MEASUREMENT ALONGSIDE THE ROW, NOT JUST A YES. <== Every
 * row that survives this has to print how close it came, and measuring twice —
 * once to filter and once to caption — would double the work on the one
 * interaction that runs on every pixel of a drag. The measurement rides along.
 *
 * ==> AND IT IS SORTED BY DISTANCE, WHICH BREAKS THE ROSTER'S OWN RULE ON
 * PURPOSE. <== §57.18 says the roster is chronological and that nobody should
 * ever tidy it by sorting. That rule is about a SEASON — the order names were
 * handed out in is the shape of the year. This list is not a season, it is an
 * answer to "what has come near my house", and the first thing a reader wants
 * from it is the closest one. The chronological rule still governs every other
 * filter, and switching back to All restores it.
 *
 * @param {Array<{storm:object, facts:object}>} entries  the whole season
 * @param {{lon:number, lat:number}} home
 * @param {number} radiusNm
 * @returns {Array<{storm:object, facts:object, near:object}>}
 */
export function entriesNearHome(entries, home, radiusNm) {
  if (!Number.isFinite(home?.lon) || !Number.isFinite(home?.lat)) return [];
  if (!Number.isFinite(radiusNm)) return [];

  const out = [];
  for (const e of entries || []) {
    const near = closestApproach(e.storm, home);
    if (!near || near.nm > radiusNm) continue;
    out.push({ ...e, near });
  }
  out.sort((a, b) => a.near.nm - b.near.nm);
  return out;
}

/**
 * The slider, and the number it is currently showing.
 *
 * ==> THE FIGURE IS IN THE LABEL, ABOVE THE TRACK, NOT UNDER THE THUMB. <== The
 * same arrangement Settings uses and for the same reason: a value that follows
 * the thumb is a value under the reader's finger. `aria-valuetext` carries the
 * same words to a screen reader, because "120" on its own does not say what it
 * is 120 of.
 *
 * ==> IT IS ALWAYS IN THE MARKUP WHEN THE FILTER IS CHOSEN, AND NEVER
 * OTHERWISE. <== A slider that greys out on the other three filters would be
 * furniture explaining itself; the control appearing WITH the thing it controls
 * is the plainer statement, and the board rebuilds this block wholesale on a
 * filter change anyway.
 *
 * @param {number} radius   the reader's value, in `unit`
 * @param {string} system   units preference
 */
export function radiusSliderHtml(radius, system) {
  const r = rangeFor(system);
  const value = Number.isFinite(radius) ? radius : r.default;
  const words = `${value} ${r.unit}`;
  return `
      <div class="slider-row seasons-radius">
        <label class="slider-label" for="seasons-radius">
          <span>Within</span>
          <span class="slider-value">${words}</span>
        </label>
        <input class="slider" type="range" id="seasons-radius" data-radius
               min="${r.min}" max="${r.max}" step="${r.step}" value="${value}"
               aria-valuetext="${words}">
      </div>`;
}

/**
 * How close this storm came, as a line under its name.
 *
 * *"Passed 31 mi WSW as a Cat 2."* §57.19 asks for the strength at closest
 * approach rather than the peak, and calls the displayed fact the more
 * interesting one — it is also the only one the row does not already carry,
 * since the badge beside the name is already the peak.
 *
 * ==> IT IS A SEPARATE ELEMENT RATHER THAN MORE TEXT IN THE ROW'S OWN LABEL.
 * <== The row's `aria-label` is what a screen reader announces on the button,
 * and it is already a sentence long. This sits inside the button as visible
 * text, so it is read in reading order after the name rather than folded into
 * an announcement nobody can pause in the middle of.
 *
 * @param {object|null} near   a `closestApproach` result, or null
 * @param {{lon:number, lat:number}} home
 * @param {string} system
 * @returns {string} markup, or '' when there is nothing true to say
 */
export function approachNoteHtml(near, home, system) {
  const phrase = approachPhrase(near, home, system);
  return phrase ? `<span class="seasons-approach">Passed ${phrase}</span>` : '';
}

/**
 * A slider value read off the DOM, turned into the number the measurement
 * wants — or null.
 *
 * ==> IT IS CLAMPED TO THE RANGE RATHER THAN TRUSTED. <== A native range input
 * cannot produce an off-range value with a thumb, but the board reads
 * `input.value` as a string and a value carried across a units change can
 * legitimately sit outside the new range — 500 miles is not a value the metric
 * slider has. Clamping here means the one number that reaches the geometry is
 * always one the control could have produced.
 */
export function radiusFromValue(raw, system) {
  const r = rangeFor(system);
  /* ==> AN EMPTY STRING IS REFUSED, AND THAT NEEDS SAYING BECAUSE `Number('')`
   * IS `0`. <== A blank value would otherwise clamp silently to the minimum and
   * the roster would narrow to a ten-mile circle nobody asked for, with the
   * slider sitting wherever it was. `Number` also reads whitespace as zero, so
   * the guard trims first. */
  if (typeof raw === 'string' && !raw.trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.min(r.max, Math.max(r.min, n));
  return { radius: clamped, nm: radiusToNm(clamped, system) };
}
