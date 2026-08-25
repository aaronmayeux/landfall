/**
 * season-years.js — which seasons a basin can offer, and which one is running.
 *
 * ==> IT IS A CUT TAKEN RATHER THAN A DESIGN, AND NOW.md PREDICTED IT. <==
 * `ui/view-seasons-board.js` has crossed §12's ~700-line ceiling on three
 * consecutive seasons passes; step 6a took `liveDownHtml` out, step 6b took the
 * roster assembly, and this pass took this. The note in NOW.md said the next
 * pass should expect to cut again rather than be surprised, so this is that.
 *
 * ==> WHY THIS BLOCK AND NOT ANOTHER. <== Everything else in that file reads
 * and writes the board's own state — the ticked set, the focus, the load token
 * — so extracting it would mean handing a bag of mutable state across a file
 * boundary, which is a worse file with the same line count. These four
 * functions read only two INDEXES and a basin name. They are pure, they take
 * what they need as arguments, and they can be driven straight from a suite
 * with no view mounted.
 *
 * ==> AND THE RULE THEY ENFORCE IS WORTH HAVING IN ONE PLACE. <== The picker
 * offers years and the load path fetches them, and if those two ever disagree
 * the app shows a year in the dropdown that it then cannot open. Both ask here.
 *
 * Imports config/ and one lib sibling. No DOM, no network, no clock — the
 * season in progress is read off the b-deck FILENAMES the route published,
 * never off the reader's clock (§58.1).
 */

import { SEASONS } from '../config/constants.js';

/**
 * The season in progress, or null.
 *
 * @param {object|null} liveIndex  the live index, or null when that road failed
 */
export function liveYearOf(liveIndex) {
  return liveIndex?.year ?? null;
}

/**
 * Does this basin have a live half at all? `SEASONS.liveBasins` answers, and a
 * basin missing from it has none — the honest state for the rest of the world
 * until step 13.
 */
export function basinHasLive(basin) {
  return Boolean(SEASONS.liveBasins[basin]);
}

/**
 * Every year this basin offers, newest first.
 *
 * The live season sits at the top when there is one, and ONLY when the settled
 * record has not already caught up to it — in the spring both roads briefly
 * know the same year and the reviewed one wins, because it is the better
 * record of the two.
 *
 * @param {object} deps
 * @param {(index:object, basin:string) => number[]} deps.seasonsIn  the settled
 *   index reader, injected rather than imported so this file does not depend on
 *   `data/` and can be driven from a suite with a plain object
 * @param {object} deps.index      the settled index
 * @param {object|null} deps.liveIndex
 * @param {string} basin
 */
export function yearsFor({ seasonsIn, index, liveIndex }, basin) {
  const settled = seasonsIn(index, basin);
  const ly = liveYearOf(liveIndex);
  if (ly == null || !basinHasLive(basin) || settled.includes(ly)) return settled;
  return [ly, ...settled];
}

/**
 * Is this the year still running?
 *
 * The one place that question is answered, because it decides the road, the
 * filters, the stamp and the ghosts. A year the settled record already holds is
 * NOT live even when the live road also knows it — same spring overlap as
 * `yearsFor`, same winner.
 */
export function isLiveSeason({ seasonsIn, index, liveIndex }, basin, year) {
  const ly = liveYearOf(liveIndex);
  return ly != null && Number(year) === ly && basinHasLive(basin)
    && !seasonsIn(index, basin).includes(Number(year));
}
