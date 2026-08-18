/**
 * cone-measure.js — the cone we are NOT redrawing, measured where it stands.
 *
 * ==> WHY THIS IS ITS OWN FILE. <== §12's ceiling took `lib/cone-sweep.js` past
 * 700 lines, and the seam it wanted was already the finding of the session that
 * wrote this: REBUILDING a cone and MEASURING one are two different questions
 * with two different bars. `cone-sweep.js` answers "can this be redrawn as a
 * smooth shape along its track?" and holds itself high, because its answer
 * becomes pixels — a fold ties a loop and MapLibre fills the loop as a hole
 * punched through the veil. This file answers "where does the cone that is
 * already on screen sit at each station?", and nothing it returns is drawn as
 * an outline at all.
 *
 * It imports the shared primitives from `cone-sweep.js` and never the reverse
 * (§12: one-directional imports). Those exports exist for this file; they are
 * not a public surface.
 *
 * Imports: config/, lib/cone-sweep.js. No DOM, no network, no clock, no map.
 */

import { CONE_SWEEP, TRACK_LINE } from '../config/constants.js';
import {
  DEG, capRing, rayHit, resample, ringOnBranch, tangents,
} from './cone-sweep.js';

/* ===========================================================================
 * MEASURING A CONE WE ARE NOT REDRAWING — §7.9, §47.5.
 *
 * ==> THE ENVIRONMENT RIBBON WAS HOSTAGE TO THE REBUILD, AND THE TWO ARE NOT
 * THE SAME QUESTION. <== `sweepConeDetail` answers "can this cone be redrawn
 * as a smooth shape along its track?", and it holds itself to a high bar
 * because the answer becomes pixels: a fold ties a loop and MapLibre fills the
 * loop as a hole punched through the veil. When it says no, the map draws
 * NHC's published outline instead and nobody is worse off.
 *
 * The ribbon then got nothing, and that WAS a loss. Measured on the archived
 * Ida corpus, twelve of thirty-five advisories were refused — a third of one
 * storm's life with no environment color at all, appearing and disappearing as
 * she turned. Aaron reported exactly that on Lala, 2026-08-18.
 *
 * ==> A FIRST ATTEMPT HELD THE WIDTHS BACK TO WHERE `folds` COULD NOT FIRE,
 * AND IT WAS WRONG IN A WAY WORTH WRITING DOWN. <== All thirty-five then swept
 * — and ten of the twelve recovered outlines crossed themselves. `folds` is a
 * cheap PROXY for self-intersection, not a test of it, and holding every
 * segment forward satisfies the proxy while the inside edge loops around and
 * crosses further along. The clamp did not fix the fold; it silenced the alarm.
 *
 * The real finding underneath it: A SWEPT RIBBON IS THE WRONG MODEL FOR A CONE
 * ON A TIGHT BEND. NHC's cone is a union of growing circles, and on the inside
 * of a bend that union's boundary is the outer envelope of the overlap. An
 * offset curve has no envelope, so it loops. No threshold fixes that.
 *
 * ==> SO THIS FUNCTION DOES NOT REBUILD ANYTHING. IT MEASURES WHAT IS ALREADY
 * BEING DRAWN. <== Same stations, same perpendicular rays, and then it stops:
 * no blur, no fold test, no undercut guard, no ring. Every point it returns is
 * a RAY HIT ON THE PUBLISHED POLYGON, so the ribbon it feeds sits inside the
 * published cone by construction rather than by agreement. The drawn fallback
 * cone is that same polygon with the corners rounded (lib/cone-smooth.js
 * `curveGeometry`), which moves it by at most 3.1 km across the whole Ida
 * corpus — a fifth of one slice, and well under the width of the cone edge.
 *
 * ==> WHERE IT CANNOT ANSWER, IT SAYS SO PER STATION RATHER THAN GIVING UP.
 * <== `ok: false` on a rib means one of its rays missed the cone entirely, or
 * the edge between it and its neighbour doubles back. lib/cone-ribbon.js skips
 * any slice containing one, exactly as it already skips a slice whose hours
 * are not all drawable. The reader loses a slice or two of color on the inside
 * of a hard bend and keeps the rest of the cone — which is the whole point.
 * ======================================================================== */

/**
 * Ribs and caps measured off the PUBLISHED cone, for the path where the
 * rebuild declined.
 *
 * @param {Array<[number,number]>} trackLonLat  the smoothed forecast track
 * @param {Array<Array<[number,number]>>} rings the published cone's rings
 * @returns {{ribs: Array, capStart: Array, capEnd: Array}|null}
 */
export function measureConeRibs(trackLonLat, rings) {
  if (!Array.isArray(trackLonLat) || trackLonLat.length < 3) return null;
  if (!Array.isArray(rings) || !rings.length) return null;
  if (!trackLonLat.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) {
    return null;
  }

  const lat0 = trackLonLat.reduce((a, p) => a + p[1], 0) / trackLonLat.length;
  const k = Math.max(Math.cos(lat0 * DEG), TRACK_LINE.minCosLat);
  const ref = trackLonLat.reduce((a, p) => a + p[0], 0) / trackLonLat.length;

  const ringsXY = rings
    .filter((r) => Array.isArray(r) && r.length > 3)
    .map((r) => ringOnBranch(r, ref).map((p) => [p[0] * k, p[1]]));
  if (!ringsXY.length) return null;

  const track = resample(trackLonLat.map((p) => [p[0] * k, p[1]]), CONE_SWEEP.stepDeg);
  if (track.length < 4) return null;
  const tan = tangents(track);
  const nrm = tan.map((t) => [-t[1], t[0]]);

  /* RAW, AND THAT IS THE WHOLE DIFFERENCE FROM THE SWEEP. `fillGaps` invents a
   * width where the ray missed and `blur` moves every width a little; both are
   * right when the output is a shape being DRAWN and wrong when it is a
   * measurement of somebody else's. A miss stays a miss and becomes `ok:false`. */
  const wL = [];
  const wR = [];
  for (let i = 0; i < track.length; i++) {
    wL.push(rayHit(track[i], nrm[i], ringsXY, CONE_SWEEP.maxRayDeg));
    wR.push(rayHit(track[i], [-nrm[i][0], -nrm[i][1]], ringsXY, CONE_SWEEP.maxRayDeg));
  }

  /* Same hit floor the rebuild uses: below it the track and the cone are not
   * describing the same storm, and slicing a shape the track cannot see would
   * be a confident lie rather than a partial answer. */
  let hits = 0;
  for (let i = 0; i < track.length; i++) {
    if (Number.isFinite(wL[i]) && Number.isFinite(wR[i])) hits++;
  }
  if (hits < track.length * CONE_SWEEP.minHitFrac) return null;

  const ok = track.map((_, i) => Number.isFinite(wL[i]) && Number.isFinite(wR[i]));

  /* ==> THE FOLD TEST, SOLVED RATHER THAN ESTIMATED, AND USED TO MARK RATHER
   * THAN TO REFUSE. <== `folds` asks whether `(edge[i+1] − edge[i]) · tan[i]`
   * goes negative. `n[i] · tan[i]` is exactly zero by construction, so `w[i]`
   * cancels out of that and what remains is linear in `w[i+1]` alone:
   *
   *     ahead + w[i+1] · (n[i+1] · tan[i])  <  0
   *
   * `ahead` is the step forward and is positive, so it can only bite where
   * `n[i+1] · tan[i]` is negative — the inside of a bend. BOTH stations of a
   * bad segment are marked, because the slice that would be drawn across it is
   * bounded by both. */
  const mark = (w, sgn) => {
    for (let i = 0; i < track.length - 1; i++) {
      if (!ok[i] || !ok[i + 1]) continue;
      const c = sgn * (nrm[i + 1][0] * tan[i][0] + nrm[i + 1][1] * tan[i][1]);
      if (c >= 0) continue;
      const ahead =
        (track[i + 1][0] - track[i][0]) * tan[i][0] +
        (track[i + 1][1] - track[i][1]) * tan[i][1];
      if (ahead + w[i + 1] * c < 0) { ok[i] = false; ok[i + 1] = false; }
    }
  };
  mark(wL, +1);
  mark(wR, -1);

  const unscale = (p) => [p[0] / k, p[1]];
  const lastIdx = track.length - 1;
  const at = (i, sgn, w) => [
    track[i][0] + sgn * nrm[i][0] * w,
    track[i][1] + sgn * nrm[i][1] * w,
  ];
  const ribs = track.map((p, i) => ({
    t: lastIdx > 0 ? i / lastIdx : 0,
    lon: p[0] / k,
    lat: p[1],
    /* A rib with no measurement still occupies its index — `hoursAlong` maps
     * one hour per rib and lib/cone-ribbon.js reads both arrays by the same
     * index. Dropping it here would silently shift every hour after it. */
    left: ok[i] ? unscale(at(i, +1, wL[i])) : unscale(track[i]),
    right: ok[i] ? unscale(at(i, -1, wR[i])) : unscale(track[i]),
    ok: ok[i],
  }));

  /* THE TWO CAPS, from the SAME builder the rebuild uses and from the measured
   * end widths. Without them a fully-colored cone shows a grey blob at each
   * end — that shipped once and was caught on glass (2026-08-15).
   *
   * The reach is a ray straight ahead, like everything else here: a hit on the
   * published outline, or the flank width when the ray misses a nose that sits
   * off to one side. `capRing` carries the note on why this is an ellipse
   * rather than the published polygon clipped, which was the first attempt and
   * self-intersects on a hooked cone.
   *
   * A cap whose own end station could not be measured is not drawn — there is
   * no flank width to anchor it to. lib/cone-ribbon.js checks the same `ok`
   * before painting either one. */
  const reachEnd = rayHit(track[lastIdx], tan[lastIdx], ringsXY, CONE_SWEEP.maxRayDeg);
  const reachStart = rayHit(track[0], [-tan[0][0], -tan[0][1]], ringsXY, CONE_SWEEP.maxRayDeg);

  const capStart = ok[0]
    ? capRing(track[0], [-tan[0][0], -tan[0][1]], nrm[0],
        Number.isFinite(reachStart) ? reachStart : Math.max(wL[0], wR[0]),
        wL[0], wR[0], unscale)
    : null;
  const capEnd = ok[lastIdx]
    ? capRing(track[lastIdx], tan[lastIdx], nrm[lastIdx],
        Number.isFinite(reachEnd) ? reachEnd : Math.max(wL[lastIdx], wR[lastIdx]),
        wL[lastIdx], wR[lastIdx], unscale)
    : null;

  return { ribs, capStart, capEnd };
}
