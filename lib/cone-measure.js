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
  DEG, rayHit, resample, ringOnBranch, tangents,
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

  /* ==> A FOLD PINCHES THE EDGE. IT DOES NOT PUT A HOLE IN THE CONE. <==
   * §47.5, and this is the second cut at it. The first MARKED both stations of
   * a folding segment and let lib/cone-ribbon.js skip the slice, on the
   * reasoning that a self-overlapping slice paints one stretch of cone twice.
   * The reasoning was right and the remedy was not: a slice spans
   * `ENV_RIBBON.sliceDeg` of track, so ONE bad station takes the whole slice
   * with it and two adjacent bad stations take two — which on glass is a black
   * wedge cut clean across the cone at the inflection, and reads as a
   * rendering fault rather than as an absence of data. Aaron, 2026-08-18.
   *
   * What is actually happening at a fold is that the inside edge of the bend
   * has nowhere further to go: consecutive perpendicular rays hit the outline
   * in reverse order, because the turn is tighter than the cone is wide. The
   * honest edge there is the one that STOPS. So the point is held at its
   * predecessor rather than allowed to move backwards — the edge pinches to a
   * corner, which is exactly the shape the union-of-circles boundary has at
   * that spot, and consecutive slices go on sharing a boundary vertex exactly
   * as they always did. No overlap, no double blend, and no hole.
   *
   * ==> IT CANNOT LEAVE THE CONE, WHICH IS WHY IT IS SAFE. <== The held point
   * is a ray hit from an earlier station, so it is a point ON the outline; the
   * segment joining two points of the outline across the inside of a bend
   * stays within it, because that stretch of boundary is convex toward the
   * cone's interior. `tools/test-cone-sweep.mjs` asserts the property rather
   * than trusting this paragraph.
   *
   * The test itself is `folds` solved rather than estimated. It asks whether
   * `(edge[i+1] − edge[i]) · tan[i]` goes negative; `n[i] · tan[i]` is exactly
   * zero by construction, so `w[i]` cancels out and what is left is linear in
   * `w[i+1]` alone. `ahead` is the step forward and is positive, so it can
   * only bite where `n[i+1] · tan[i]` is negative — the inside of a bend.
   *
   * `ok:false` now means ONE thing and it is the honest one: no ray hit at
   * this station, so there is no measurement to pinch or to paint. */
  const edge = (sgn, w) => {
    const pts = [];
    for (let i = 0; i < track.length; i++) {
      pts.push(ok[i]
        ? [track[i][0] + sgn * nrm[i][0] * w[i], track[i][1] + sgn * nrm[i][1] * w[i]]
        : null);
    }
    /* One forward pass. Holding a point back cannot invalidate an earlier
     * segment — each test involves only its own two points — so there is
     * nothing to iterate. */
    for (let i = 0; i < pts.length - 1; i++) {
      if (!pts[i] || !pts[i + 1]) continue;
      const d = (pts[i + 1][0] - pts[i][0]) * tan[i][0]
              + (pts[i + 1][1] - pts[i][1]) * tan[i][1];
      if (d < 0) pts[i + 1] = pts[i].slice();
    }
    return pts;
  };
  const eL = edge(+1, wL);
  const eR = edge(-1, wR);

  const unscale = (p) => [p[0] / k, p[1]];
  const lastIdx = track.length - 1;
  const ribs = track.map((p, i) => ({
    t: lastIdx > 0 ? i / lastIdx : 0,
    lon: p[0] / k,
    lat: p[1],
    /* A rib with no measurement still occupies its index — `hoursAlong` maps
     * one hour per rib and lib/cone-ribbon.js reads both arrays by the same
     * index. Dropping it here would silently shift every hour after it. */
    left: ok[i] ? unscale(eL[i]) : unscale(track[i]),
    right: ok[i] ? unscale(eR[i]) : unscale(track[i]),
    ok: ok[i],
  }));

  /* ==> THE CAPS ARE THE OUTLINE'S OWN NOSE AND TAIL, WALKED. <== A cap is the
   * stretch of cone BEYOND the end station, which no pair of ribs spans;
   * without one a fully-colored cone shows a grey blob at each end (glass,
   * 2026-08-15). This path has the drawn ring in hand, so the cap is simply
   * the arc of it between that station's two edge points — exact, and it is
   * the day-5 circle itself rather than a stand-in for it.
   *
   * ==> IT IS THE THIRD ATTEMPT AND THE OTHER TWO ARE WORTH KEEPING HERE. <==
   * Clipping the ring to the half-plane ahead of the station is exact on a
   * straight cone and self-intersecting on a hooked one, because the region
   * ahead is then two disconnected pieces and clipping bridges them with a
   * zero-width neck (Ida 006A: one cap in thirty-five, 418 vertices). The
   * rebuild's half-ellipse cannot do that — but it is a MODEL of the end, and
   * measured against the ring actually drawn it sat up to 17.5 km off it,
   * which on a phone is the color and the cone edge visibly disagreeing at the
   * one place a reader looks first. An arc is neither: it cannot leave the
   * outline because it IS the outline, and it cannot pick up a far-away piece
   * because it is one contiguous walk between two known points. */
  const capStart = ok[0]
    ? ringArc(ringsXY[0], eR[0], eL[0], track[0], [-tan[0][0], -tan[0][1]], unscale)
    : null;
  const capEnd = ok[lastIdx]
    ? ringArc(ringsXY[0], eL[lastIdx], eR[lastIdx], track[lastIdx], tan[lastIdx], unscale)
    : null;

  return { ribs, capStart, capEnd };
}

/**
 * The stretch of a ring between two points on it, taken on the side that lies
 * AHEAD of a station.
 *
 * Both endpoints are ray hits, so each lies on a segment rather than on a
 * vertex; the segment is located by distance and the exact hit is used as the
 * endpoint, so the arc starts and ends precisely where the rib does and no
 * hairline of plain veil shows through at the seam.
 *
 * ==> WHICH OF THE TWO ARCS IS "AHEAD" IS DECIDED BY MEASUREMENT, NOT BY
 * WINDING. <== A ring's direction is a property of whoever published it, and
 * both NHC and GDACS are in here. Averaging each candidate's projection onto
 * the direction the cap reaches in answers the question from the geometry
 * itself, and gets the same answer whichever way the ring was wound.
 *
 * @param {Array<[number,number]>} ring   the DRAWN ring, scaled planar frame
 * @param {[number,number]} from  where the arc starts (a rib edge point)
 * @param {[number,number]} to    where it ends (the other rib edge point)
 * @param {[number,number]} c     the end station
 * @param {[number,number]} d     the direction the cap reaches in
 * @param {(p:[number,number]) => [number,number]} unscale
 */
function ringArc(ring, from, to, c, d, unscale) {
  const pts = ring.slice();
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) pts.pop();
  }
  const n = pts.length;
  if (n < 3) return null;

  /** The index of the segment `v` sits on. */
  const segOf = (v) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const L = dx * dx + dy * dy;
      let t = L ? ((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = a[0] + t * dx - v[0];
      const qy = a[1] + t * dy - v[1];
      const dd = qx * qx + qy * qy;
      if (dd < bestD) { bestD = dd; best = i; }
    }
    return best;
  };

  const iFrom = segOf(from);
  const iTo = segOf(to);

  /** Walk forward from one segment's far end to the other's near end. */
  const walk = (i, j) => {
    const out = [];
    let k = (i + 1) % n;
    for (let guard = 0; guard <= n; guard++) {
      out.push(pts[k]);
      if (k === j) break;
      k = (k + 1) % n;
    }
    return out;
  };

  const ahead = (arc) => {
    if (!arc.length) return -Infinity;
    let s = 0;
    for (const v of arc) s += (v[0] - c[0]) * d[0] + (v[1] - c[1]) * d[1];
    return s / arc.length;
  };

  const fwd = walk(iFrom, iTo);
  const back = walk(iTo, iFrom).reverse();
  const arc = ahead(fwd) >= ahead(back) ? fwd : back;

  const raw = [from, ...arc, to].map(unscale);
  const out = [];
  for (const p of raw) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev[0] - p[0]) < TRACK_LINE.joinEpsDeg
             && Math.abs(prev[1] - p[1]) < TRACK_LINE.joinEpsDeg) continue;
    out.push(p);
  }
  if (out.length < 3) return null;
  out.push(out[0].slice());
  return out;
}
