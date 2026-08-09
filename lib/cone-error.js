/**
 * cone-error.js — NHC's own forecast-error circle, for a given lead time.
 *
 * ONE JOB: turn "how many hours ahead is this?" into "how far off has NHC
 * historically been by then?", using NHC's published table and nothing else.
 *
 * WHY IT IS ITS OWN FILE. The number it returns is the difference between a
 * closest-approach figure that informs somebody and one that quietly misleads
 * them, and the whole value of it is that it is NHC's arithmetic rather than
 * ours. Isolating it means there is exactly one place to look when the table
 * is republished, exactly one place to test, and no opportunity for a second
 * implementation to appear next to a chart.
 *
 * WHAT THE NUMBER MEANS, PRECISELY: the radius of the circle NHC draws its
 * forecast cone from at that hour, sized so that two thirds of the previous
 * five years' official track errors fell inside it. It is a TRACK error — how
 * far the centre may be from where it was forecast. It says nothing about
 * intensity, and it is not a 95% bound. One in three past forecasts fell
 * OUTSIDE it. Anything rendering it has to say two-thirds, or it is
 * overstating a hedge.
 *
 * Pure. Imports config/ only.
 */

import { CONE_CIRCLE_NM_2026, CONE_CIRCLE_BASIN } from '../config/constants.js';

/** The table in force. Named by year at the source so that swapping it is a
 *  one-line change with the old numbers still readable beside it. */
const TABLE = CONE_CIRCLE_NM_2026;

/**
 * Which of NHC's two tables, if either, describes this basin.
 *
 * NULL IS THE COMMON CASE AND THE IMPORTANT ONE. NHC publishes these figures
 * for the oceans it forecasts. A west Pacific typhoon is JTWC's, an Indian
 * Ocean cyclone is somebody else's, and neither agency publishes an
 * equivalent — so those get no band at all. Lending them the Atlantic's
 * numbers would be fabricating an error bar and signing NHC's name to it
 * (§5). An unknown basin lands here too, which is the safe direction to fail.
 */
export function coneTableFor(basin) {
  const key = CONE_CIRCLE_BASIN[basin];
  return key ? TABLE[key] : null;
}

/** True when this basin has a published error table at all — for a caller
 *  that wants to explain the absence rather than just omit a line. */
export function hasConeError(basin) {
  return coneTableFor(basin) != null;
}

/**
 * Two-thirds track-error radius at `hours` ahead, NAUTICAL MILES.
 * Returns null when the basin has no published table, or when `hours` is not
 * a usable number.
 *
 * BOTH ENDS ARE CLAMPED, AND THE TWO CLAMPS ARE NOT SYMMETRIC:
 *
 *  - BELOW 12 HOURS the table stops but the error does not go to zero at a
 *    discontinuity, so this scales the 12-hour circle linearly down to zero
 *    at zero hours. That is a straight line through the origin, not a claim
 *    about NHC's sub-12-hour skill — but a storm's position NOW is known
 *    within about 30 nm (the advisory says so in its own "POSITION ACCURATE
 *    WITHIN" line), and pretending the error is nil at +1 h would be worse
 *    than a linear taper.
 *
 *  - BEYOND 120 HOURS it holds the 120-hour value rather than extrapolating.
 *    There is no forecast past 120 h to attach a band to, so this only fires
 *    on a caller doing something odd, and holding is the honest floor.
 *
 * Between rows it interpolates linearly, which is how the cone itself is
 * drawn between its circles.
 *
 * NEGATIVE HOURS RETURN NULL, NOT ZERO. A lead time in the past means the
 * caller is asking about a moment that has already happened, and a forecast
 * error bar is meaningless there — the answer is "no band", not "no error".
 */
export function coneErrorNm(hours, basin) {
  const table = coneTableFor(basin);
  if (!table) return null;
  if (!Number.isFinite(hours) || hours < 0) return null;

  const [h0, r0] = table[0];
  if (hours <= h0) return (r0 * hours) / h0;

  for (let i = 0; i < table.length - 1; i++) {
    const [ha, ra] = table[i];
    const [hb, rb] = table[i + 1];
    if (hours <= hb) return ra + ((rb - ra) * (hours - ha)) / (hb - ha);
  }
  return table[table.length - 1][1];
}
