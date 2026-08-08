/**
 * cone-sweep.js — the cone of uncertainty, rebuilt as a swept circle.
 *
 * WHAT A CONE ACTUALLY IS. A growing circle slid along the forecast track. At
 * each forecast hour there is a circle the centre is expected to stay inside,
 * and the cone is the ground that circle covers on its way. Nothing about that
 * object is straight.
 *
 * WHAT THE SOURCES PUBLISH INSTEAD. The circle at day 1, 2, 3, 4 and 5, joined
 * by the straight lines pulled taut around consecutive pairs — the outline of a
 * union of five discs rather than of a continuous sweep. MEASURED on
 * samples/gdacs/geometry-TC.json: 16 segments longer than ~55 km carry 81.6% of
 * the outline's perimeter, four of them 5.2° (≈570 km) of dead-straight edge
 * each, and the breaks between them are mostly under 2°. The remaining 195
 * vertices are all inside the rounded nose.
 *
 * ==> WHY THE TRACK SMOOTHER COULD NOT FIX THIS, AND WHY THIS FILE EXISTS. <==
 * A spline decides which way to bend by looking at a vertex's NEIGHBOURS. On the
 * track that works: the straight legs are gaps between 6-hourly fixes, and the
 * fixes either side of a gap describe a curve. On the cone it cannot: along one
 * of those 570 km legs the neighbouring outline is straight too, so an
 * interpolating curve through those vertices is — correctly, given its input —
 * a straight line. The knowledge that the edge should bend is not in the outline
 * at all. It is one object over, in the track.
 *
 * A first attempt (2026-08-08) splined the outline anyway. It rounded the joints
 * and left 81.6% of the perimeter exactly as it found it. The lesson is already
 * written down in lib/ringpolish.js — "those are steps in r(theta), not corners
 * in x/y, so smooth r(theta), not x/y" — and was applied to the wrong axis here.
 *
 * SO: STOP POLISHING THE OUTLINE. Take the two things that carry meaning — the
 * smoothed track, and the circle radius at each forecast hour — and sweep.
 *
 * CONTAINMENT IS BY CONSTRUCTION, NOT BY LUCK, and this is the §5 argument that
 * lets a safety layer be redrawn at all:
 *
 *   - The published cone IS the union of the discs at the forecast points.
 *   - Every boundary point of a union of discs is at least R_i from centre i
 *     (anything nearer is interior). So the SHORTEST distance from a forecast
 *     point to the published outline is exactly that point's own radius —
 *     measurable, never guessed, and never an underestimate.
 *   - The smoothed track passes exactly through every forecast point
 *     (interpolating spline), so the swept shape contains every one of those
 *     discs, so it contains the published cone. Whatever the radius does
 *     between forecast hours cannot break that.
 *
 * IT CAN THEREFORE ONLY EVER BE BIGGER, and that is the correct direction for a
 * hazard shape. The straight line pulled around two circles cuts INSIDE the
 * ground the circle actually covers on a curving track; the published outline is
 * a slight under-statement and this removes it.
 *
 * FAILURE IS PASS-THROUGH, and there are several ways to fail: a storm with no
 * forecast points, a cone that does not belong to this track, a recurve tight
 * enough that the inner edge would fold through itself. Every one of them
 * returns `null` and the caller draws the published outline exactly as before.
 * A rebuilt cone is a better picture; a missing or folded cone is a bug.
 *
 * Pure functions. Imports: config and lib only. No DOM, ever.
 */

import { CONE_SWEEP, TRACK_LINE } from '../config/constants.js';

const DEG = Math.PI / 180;

/* ---------------------------------------------------------------------------
 * PLANAR FRAME — the same trick lib/trackline.js uses.
 *
 * Longitude is scaled by cos(latitude) so a degree east is the same length as a
 * degree north. Every distance, normal and rotation below is computed in that
 * frame and unscaled on the way out. Without it a cone at 40°N comes out an
 * ellipse, because a "radius" measured in raw degrees is a quarter wider
 * east-west than north-south there.
 * ------------------------------------------------------------------------- */

const frameOf = (lat) => Math.max(Math.cos(lat * DEG), TRACK_LINE.minCosLat);
const toXY = (p, k) => [p[0] * k, p[1]];
const toLonLat = (p, k) => [p[0] / k, p[1]];

/** Squared distance from point p to segment ab, plus the parameter along it. */
function segDist2(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = a[0] + t * dx - p[0];
  const qy = a[1] + t * dy - p[1];
  return { d2: qx * qx + qy * qy, t };
}

/**
 * The radius of the disc centred at `p` — the SHORTEST distance from it to the
 * published outline.
 *
 * See the containment argument in the file header: for a union of discs this
 * quantity equals that disc's own published radius whenever the disc reaches
 * the boundary at all, and OVER-states it when the disc is buried inside its
 * neighbours. Over-stating grows the cone, which is the safe direction, so
 * there is no correction here and no guess.
 */
function radiusFrom(p, rings) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const { d2 } = segDist2(p, ring[i], ring[i + 1]);
      if (d2 < best) best = d2;
    }
  }
  return Number.isFinite(best) ? Math.sqrt(best) : NaN;
}

/**
 * How far from `p`, along unit direction `d`, the published outline first lies.
 *
 * ==> THE FIRST CROSSING, AND THE ALTERNATIVE IS A TRAP WORTH NAMING. <== The
 * obvious neighbour of this function, `radialProfile` in lib/ringpolish.js,
 * takes the FARTHEST crossing — correct there, because a wind band is
 * star-shaped about the storm and a ray leaves it exactly once. A cone is not
 * star-shaped about anything. It is a tube, and on a recurve a ray cast
 * outward from one part of it can cross the far flank several degrees away.
 * Taking the farthest crossing there returns a width from the other side of the
 * storm: measured, it produced a staircase along the inner flank and a spike
 * shooting out past the nose. Rays leave the centreline through the near
 * boundary; that is the one being measured.
 *
 * Bounded by `limit` so a ray that escapes through a malformed ring cannot
 * return a distance from the far side of the basin.
 *
 * Returns 0 when nothing is hit, which makes it a no-op inside the `Math.max`
 * that consumes it rather than a hole in the shape.
 */
function rayHit(p, d, rings, limit) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i];
      const b = ring[i + 1];
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const den = d[0] * ey - d[1] * ex;
      if (den === 0) continue;                       // parallel
      const ax = a[0] - p[0];
      const ay = a[1] - p[1];
      const t = (ax * ey - ay * ex) / den;           // along the ray
      const u = (ax * d[1] - ay * d[0]) / -den;      // along the edge
      if (t > 0 && t <= limit && u >= 0 && u <= 1 && t < best) best = t;
    }
  }
  return Number.isFinite(best) ? best : 0;
}

/** Cumulative arc length along a polyline. */
function arcLengths(pts) {
  const s = [0];
  for (let i = 1; i < pts.length; i++) {
    s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return s;
}

/** Where along the track (arc length) a forecast point sits. The track is an
 *  interpolating spline through these very points, so the projection lands on
 *  a vertex to within float noise — this is a lookup, not a fit. */
function stationOf(p, track, s) {
  let best = { d2: Infinity, at: 0 };
  for (let i = 0; i < track.length - 1; i++) {
    const { d2, t } = segDist2(p, track[i], track[i + 1]);
    if (d2 < best.d2) best = { d2, at: s[i] + t * (s[i + 1] - s[i]) };
  }
  return { station: best.at, offset: Math.sqrt(best.d2) };
}

/* ---------------------------------------------------------------------------
 * THE RADIUS PROFILE — monotone cubic, and the shape matters more than it looks
 *
 * Straight-line interpolation between forecast hours would put a KINK in the
 * radius at every forecast point, and a kink in the radius is a crease in the
 * drawn edge: the edge direction carries a term in dr/ds, so a jump there turns
 * the outline by several degrees on the spot. That is the same faceting this
 * file exists to remove, moved from the source's sampling to ours.
 *
 * FRITSCH-CARLSON, not a plain cubic. It passes through every published radius
 * and CANNOT OVERSHOOT between two of them — the interpolated radius always
 * lies between its neighbours. A plain cubic spline can bulge past both, which
 * on a hazard shape means inventing coverage nobody published.
 * ------------------------------------------------------------------------- */

function pchipSlopes(xs, ys) {
  const n = xs.length;
  const d = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);

  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  }
  /* The monotonicity fix-up: clamp any tangent that would make the cubic
   * overshoot its own interval. */
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const tau = 3 / Math.sqrt(h);
      m[i] = tau * a * d[i];
      m[i + 1] = tau * b * d[i];
    }
  }
  return m;
}

/** Evaluate the monotone cubic at x, flat outside the published range. */
function pchipAt(xs, ys, m, x) {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 0;
  while (i < n - 2 && x > xs[i + 1]) i++;
  const h = xs[i + 1] - xs[i];
  const t = (x - xs[i]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    ys[i] * (2 * t3 - 3 * t2 + 1) +
    m[i] * h * (t3 - 2 * t2 + t) +
    ys[i + 1] * (-2 * t3 + 3 * t2) +
    m[i + 1] * h * (t3 - t2)
  );
}

/* ---------------------------------------------------------------------------
 * THE SWEEP
 * ------------------------------------------------------------------------- */

/** Unit tangent at every vertex, by central difference. */
function tangents(pts) {
  const n = pts.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    out[i] = [dx / L, dy / L];
  }
  return out;
}

/**
 * Half a circle of directions at `c`, starting from unit vector `v` and
 * rotating NEGATIVE — the way that carries the left edge round the outside of
 * an end and back onto the right edge. Endpoints excluded; the flanks own them.
 */
function capDirs(v, steps) {
  const out = [];
  for (let k = 1; k < steps; k++) {
    const a = -(Math.PI * k) / steps;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    out.push([v[0] * cs - v[1] * sn, v[0] * sn + v[1] * cs]);
  }
  return out;
}

/**
 * Would an offset edge double back on itself?
 *
 * On the inside of a bend the offset points crowd together, and once the radius
 * exceeds the track's radius of curvature they REVERSE — the edge folds into a
 * loop, which MapLibre fills as a hole. One dot product per vertex catches it:
 * a healthy offset edge always advances in the same direction the track does.
 */
function folds(edge, tan) {
  for (let i = 0; i < edge.length - 1; i++) {
    const dx = edge[i + 1][0] - edge[i][0];
    const dy = edge[i + 1][1] - edge[i][1];
    if (dx * tan[i][0] + dy * tan[i][1] < 0) return true;
  }
  return false;
}

/**
 * Rebuild one cone.
 *
 * @param {Array<[number,number]>} trackLonLat  the SMOOTHED forecast track
 * @param {Array<[number,number]>} pointsLonLat forecast point positions
 * @param {Array<Array<[number,number]>>} rings the published cone's rings
 * @returns {Array<[number,number]>|null} a closed ring, or null to fall back
 */
export function sweepCone(trackLonLat, pointsLonLat, rings) {
  if (!Array.isArray(trackLonLat) || trackLonLat.length < 3) return null;
  if (!Array.isArray(pointsLonLat) || pointsLonLat.length < 2) return null;
  if (!Array.isArray(rings) || !rings.length) return null;

  const lat0 = trackLonLat.reduce((a, p) => a + p[1], 0) / trackLonLat.length;
  const k = frameOf(lat0);
  const track = trackLonLat.map((p) => toXY(p, k));
  const ringsXY = rings.map((r) => r.map((p) => toXY(p, k)));
  const s = arcLengths(track);
  const total = s[s.length - 1];
  if (!(total > 0)) return null;

  /* Each forecast point becomes a knot: where it sits along the track, and how
   * big its circle is. A point sitting well off the track is a cone that does
   * not belong to it — bail rather than build a shape from two storms. */
  const knots = [];
  for (const p of pointsLonLat) {
    const q = toXY(p, k);
    const { station, offset } = stationOf(q, track, s);
    if (offset > CONE_SWEEP.maxPointOffDeg) return null;
    const r = radiusFrom(q, ringsXY);
    if (!Number.isFinite(r) || r <= 0) return null;
    knots.push({ station, r });
  }

  knots.sort((a, b) => a.station - b.station);

  /* Collapse knots that land on the same station — two forecast points at one
   * position would divide by zero in the interpolation. The larger radius
   * wins, which is the safe direction. */
  const xs = [];
  const ys = [];
  for (const kn of knots) {
    if (xs.length && kn.station - xs[xs.length - 1] < CONE_SWEEP.minKnotGapDeg) {
      ys[ys.length - 1] = Math.max(ys[ys.length - 1], kn.r);
      continue;
    }
    xs.push(kn.station);
    ys.push(kn.r);
  }
  if (xs.length < 2) return null;

  /* A cone never narrows with lead time. A radius that came back smaller than
   * the one before it is a measurement artifact — a disc buried inside its
   * neighbour — and carrying it through would put a waist in the cone. Held at
   * the running maximum, which can only grow the shape. */
  for (let i = 1; i < ys.length; i++) if (ys[i] < ys[i - 1]) ys[i] = ys[i - 1];

  const m = pchipSlopes(xs, ys);
  const tan = tangents(track);
  const nrm = tan.map((t) => [-t[1], t[0]]);

  /* ==> THE PUBLISHED CONE IS NOT THE UNION OF THE DISCS. IT IS THE HULL. <==
   *
   * Between two forecast hours a source does not draw the union's waist — it
   * draws the two lines pulled taut around both circles, which fills that waist
   * in. That extra ground is a real part of what was published, and it matters
   * on a bend: the taut line cuts straight across the INSIDE of a curve, while
   * a circle swept along the curve stays a fixed distance from it. So on the
   * inner flank the sweep alone comes out NARROWER than the published cone.
   *
   * Measured on the sample: up to 0.077° (~9 km) narrower, on a track that is
   * nearly straight. On a real recurve it is several times that.
   *
   * THAT IS NOT A DEFECT IN THE PUBLISHED SHAPE, IT IS HONESTY IN IT. The
   * source is agnostic about the path between two forecast hours. Our smoothed
   * track is a good guess at that path, and using a guess to REMOVE ground from
   * an uncertainty region would be claiming more than anybody published.
   *
   * So the width at each station is the LARGEST of three: the swept radius, and
   * the published cone's own half-width measured out along each normal. The
   * sweep wins on the outer flank, which is where the bend was missing; the
   * published shape wins on the inner flank, which is where it was already
   * right. One symmetric width, so the cone stays centred on its own track. */
  const rSwept = track.map((_, i) => pchipAt(xs, ys, m, s[i]));
  const last = track.length - 1;
  const capSteps = (r) =>
    Math.max(CONE_SWEEP.minCapSteps,
      Math.min(CONE_SWEEP.maxCapSteps, Math.ceil((Math.PI * r) / CONE_SWEEP.spacingDeg)));

  /* THE WHOLE OUTLINE AS ONE LIST OF (WHERE FROM, WHICH WAY, HOW FAR AT LEAST).
   *
   * Flanks and caps are the same operation and are built the same way, which is
   * the fix for a bug the first draft shipped: the caps were drawn as plain
   * circles of the swept radius while only the flanks were checked against the
   * published outline. GDACS's nose is not a circle about the last forecast
   * point — measured, it runs from 2.42° to 2.65° from that point depending on
   * bearing — so a circular cap at 2.42° left the published nose sticking out.
   * Anything that decides how far the edge goes must apply everywhere on the
   * edge, or the one stretch it skips is where the shape breaks. */
  const samples = [
    ...track.map((p, i) => ({ c: p, d: nrm[i], r: rSwept[i], t: tan[i], side: 1, at: i })),
    ...capDirs(nrm[last], capSteps(rSwept[last])).map((d) => ({ c: track[last], d, r: rSwept[last] })),
    ...track.map((p, i) => ({ c: p, d: [-nrm[i][0], -nrm[i][1]], r: rSwept[i], t: tan[i], side: -1, at: i }))
      .reverse(),
    ...capDirs([-nrm[0][0], -nrm[0][1]], capSteps(rSwept[0])).map((d) => ({ c: track[0], d, r: rSwept[0] })),
  ];

  const ring = [];
  const left = [];
  const right = [];
  for (const smp of samples) {
    const w = Math.max(smp.r, rayHit(smp.c, smp.d, ringsXY, CONE_SWEEP.maxRayDeg));
    const q = [smp.c[0] + smp.d[0] * w, smp.c[1] + smp.d[1] * w];
    ring.push(q);
    if (smp.side === 1) left.push(q);
    else if (smp.side === -1) right.push(q);
  }

  /* Checked on the flanks only. A cap is a fan of directions from one centre
   * and cannot double back by construction; a flank can, and that is the
   * failure this refuses to draw. `right` was walked backwards, so it is
   * re-reversed to compare against the track's own direction. */
  if (folds(left, tan) || folds(right.slice().reverse(), tan)) return null;

  const out = ring.map((p) => toLonLat(p, k));
  out.push(out[0].slice());
  return out;
}
