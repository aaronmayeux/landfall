/**
 * seasons-years.js — which years exist, which one is still running, and which
 * storms a filter leaves on screen. §57.18, §57.18a, §57.30 step 5b.
 *
 * ==> EXTRACTED THE THIRD TIME `ui/view-seasons-board.js` CROSSED §12'S
 * CEILING, AND THE PATTERN IS THE POINT. <== That file has gone over 700 lines
 * in three consecutive seasons passes and been cut three times. Step 6a took
 * `liveDownHtml` out; step 6b took the whole roster assembly; this is step 7's
 * cut. NOW.md predicted it. The next pass should expect a fourth rather than
 * be surprised by one — **the board is a state machine that grows every time
 * the feature does, and the cure each time has been to notice that something
 * in it was not about state at all.**
 *
 * ==> EVERY FUNCTION HERE IS PURE AND TAKES ITS WORLD AS ARGUMENTS. <== They
 * were reading five module variables between them, which is what made them
 * look like state and kept them in that file. They are not: "does this basin
 * have a season in progress" is a question about two objects, and answering it
 * needs no memory. Pure means a suite can drive every branch without mounting
 * a board.
 *
 * ==> AND `isLive` IS THE ONE THAT EARNS THE FILE ON ITS OWN. <== It decides
 * the road a season is fetched by, which filters are offered, whether the
 * provisional stamp shows and whether ghosts are drawn — four behaviours off
 * one predicate. Left inline it was a three-line function nobody would think
 * to test; out here it is the thing four behaviours agree about.
 *
 * Imports config/ only. No DOM, no network, no clock.
 */

import { SEASONS } from '../config/constants.js';

/**
 * The season still running, or null.
 *
 * @param {object|null} liveIndex  what `data/seasons-live.js` returned
 */
export function liveYear(liveIndex) {
  return liveIndex?.year ?? null;
}

/**
 * Does this basin have a live half at all?
 *
 * `SEASONS.liveBasins` answers, and a basin missing from it has none — the
 * honest state for the rest of the world until step 13.
 */
export function basinHasLive(basin) {
  return Boolean(SEASONS.liveBasins[basin]);
}

/**
 * Every year this basin offers, newest first.
 *
 * The live season sits at the top when there is one, and **only when the
 * settled record has not already caught up to it** — in the spring both roads
 * briefly know the same year and the reviewed one wins, because it is the
 * better record of the two.
 *
 * @param {object} seasons    the `data/seasons.js` facade, for `seasonsIn`
 * @param {object} index      the settled index
 * @param {object|null} liveIndex
 * @param {string} basin
 */
export function yearsFor(seasons, index, liveIndex, basin) {
  const settled = seasons.seasonsIn(index, basin);
  const ly = liveYear(liveIndex);
  if (ly == null || !basinHasLive(basin) || settled.includes(ly)) return settled;
  return [ly, ...settled];
}

/**
 * Is this the year still running?
 *
 * ==> THE ONE PLACE THAT QUESTION IS ANSWERED. <== It decides which road the
 * season is fetched by, which filters are offered, whether the provisional
 * stamp shows and whether the unused-name ghosts are drawn. Four behaviours
 * hang off it, so two copies of this rule would be four ways to disagree.
 */
export function isLive(seasons, index, liveIndex, basin, year) {
  const ly = liveYear(liveIndex);
  return ly != null && Number(year) === ly && basinHasLive(basin)
    && !seasons.seasonsIn(index, basin).includes(Number(year));
}

/**
 * The storms a filter leaves on screen.
 *
 * ==> `landfalls` IS NOT OFFERED ON THE SEASON IN PROGRESS AND THIS FUNCTION
 * DOES NOT KNOW THAT. <== `filtersFor` in the markup file decides which
 * filters exist; this only applies the one it is handed. Keeping the two apart
 * is what stops the rule being written twice — a b-deck carries no `L` marker,
 * so the filter could only ever come back empty, and that is a fact about
 * which CONTROL to show rather than about how to filter.
 */
export function visibleEntries(entries, filter) {
  if (filter === 'majors') {
    return entries.filter((e) => Number.isFinite(e.facts.peakWindKt)
      && e.facts.peakWindKt >= SEASONS.majorKt);
  }
  if (filter === 'landfalls') return entries.filter((e) => e.facts.landfalls.length > 0);
  return entries;
}
