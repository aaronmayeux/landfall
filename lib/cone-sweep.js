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

/* ---------------------------------------------------------------------------
 * THE ANTIMERIDIAN — three inputs, and they do not arrive on the same branch
 *
 * ==> lib/trackline.js DELIBERATELY EMITS THE TRACK UNWRAPPED. <== Its own
 * header says so: longitudes may run past ±180, because that is what MapLibre
 * needs to draw one continuous line across the seam. The forecast POINTS and
 * the published CONE arrive straight from the source in (−180, 180].
 *
 * So for any storm that crosses the dateline the three inputs sit 360° apart,
 * every forecast point measures as hundreds of degrees off its own track, and
 * the rebuild refuses itself — silently, on the whole western half of the West
 * Pacific. Found by shifting the sample payload across the seam and watching
 * `_swept` go false; nothing errored and nothing logged, which is exactly how
 * this would have survived on glass.
 *
 * Everything is therefore brought onto the TRACK's branch before any of it is
 * measured, and the result is emitted on that branch too — the same frame the
 * track beside it is already drawn in, and already proven in production.
 * ------------------------------------------------------------------------- */

/** `lon` moved by whole turns onto the same branch as `ref`. */
const onBranch = (lon, ref) => lon + 360 * Math.round((ref - lon) / 360);

/**
 * A ring made continuous, then moved onto `ref`'s branch as one piece.
 *
 * PER-RING, NEVER PER-VERTEX. A ring that straddles the seam has vertices on
 * both sides of it; shifting each one to whichever branch is nearest would tear
 * the ring in half across the world. It is unwrapped from its own first vertex
 * first, so it is continuous, and only then moved bodily.
 */
function ringOnBranch(ring, ref) {
  const out = [ring[0].slice()];
  for (let i = 1; i < ring.length; i++) {
    let d = ring[i][0] - out[i - 1][0];
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    out.push([out[i - 1][0] + d, ring[i][1]]);
  }
  const mean = out.reduce((a, p) => a + p[0], 0) / out.length;
  const shift = 360 * Math.round((ref - mean) / 360);
  return shift === 0 ? out : out.map((p) => [p[0] + shift, p[1]]);
}

/**
 * The farthest the published outline reaches from `c` in the half-plane ahead
 * of direction `d`. Used only for the two end caps — see the note at the call.
 */
function reachFrom(c, d, rings) {
  let best = 0;
  for (const ring of rings) {
    for (const v of ring) {
      const dx = v[0] - c[0];
      const dy = v[1] - c[1];
      if (dx * d[0] + dy * d[1] <= 0) continue;      // behind us
      const r = Math.hypot(dx, dy);
      if (r > best) best = r;
    }
  }
  return best;
}

/**
 * How far the smoothed track bows off the straight chords between consecutive
 * forecast points — the SAGITTA, and the exact size of the undercut this file
 * accepts. Zero on a straight track, largest mid-leg on a recurve.
 */
function sagittaOf(track, s, xs) {
  let worst = 0;
  for (let j = 0; j < xs.length - 1; j++) {
    /* The track vertices nearest each end of this leg bound the chord. */
    let ia = 0;
    let ib = 0;
    for (let i = 0; i < s.length; i++) {
      if (Math.abs(s[i] - xs[j]) < Math.abs(s[ia] - xs[j])) ia = i;
      if (Math.abs(s[i] - xs[j + 1]) < Math.abs(s[ib] - xs[j + 1])) ib = i;
    }
    if (ib <= ia) continue;
    const a = track[ia];
    const b = track[ib];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const L = Math.hypot(ex, ey);
    if (!(L > 0)) continue;
    for (let i = ia; i <= ib; i++) {
      const d = Math.abs((track[i][0] - a[0]) * ey - (track[i][1] - a[1]) * ex) / L;
      if (d > worst) worst = d;
    }
  }
  return worst;
}

/** How far outside the closed polyline `ring` the point `v` lies. 0 if inside. */
function outsideBy(v, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][1];
    const yj = ring[j][1];
    if ((yi > v[1]) !== (yj > v[1]) &&
        v[0] < ((ring[j][0] - ring[i][0]) * (v[1] - yi)) / (yj - yi) + ring[i][0]) {
      inside = !inside;
    }
  }
  if (inside) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const { d2 } = segDist2(v, ring[i], ring[(i + 1) % ring.length]);
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
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

/** Straight interpolation between the same knots, flat outside them. This is
 *  the published tangent line's own profile — see the note at the call site. */
function linearAt(xs, ys, x) {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 0;
  while (i < n - 2 && x > xs[i + 1]) i++;
  const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
  return ys[i] + (ys[i + 1] - ys[i]) * t;
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
 * The arc at `c` of radius `r` running from unit direction `a` round to unit
 * direction `b`, rotating NEGATIVE — the way that carries the left flank round
 * the outside of an end and back onto the right flank. Endpoints excluded; the
 * flanks already own them.
 */
function capBetween(c, a, b, r, steps) {
  const a0 = Math.atan2(a[1], a[0]);
  const a1 = Math.atan2(b[1], b[0]);
  let sweep = a0 - a1;
  while (sweep <= 0) sweep += 2 * Math.PI;
  while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI;
  const out = [];
  for (let k = 1; k < steps; k++) {
    const t = a0 - (sweep * k) / steps;
    out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
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

  /* The track's own branch is the reference — see the antimeridian note above.
   * Its mean rather than its first vertex, so a track that itself crosses the
   * seam does not anchor everything to whichever end happened to be first. */
  const ref = trackLonLat.reduce((a, p) => a + p[0], 0) / trackLonLat.length;
  const track = trackLonLat.map((p) => toXY(p, k));
  const ringsXY = rings.map((r) => ringOnBranch(r, ref).map((p) => toXY(p, k)));
  const s = arcLengths(track);
  const total = s[s.length - 1];
  if (!(total > 0)) return null;

  /* Each forecast point becomes a knot: where it sits along the track, and how
   * big its circle is. A point sitting well off the track is a cone that does
   * not belong to it — bail rather than build a shape from two storms. */
  const knots = [];
  for (const p of pointsLonLat) {
    const q = toXY([onBranch(p[0], ref), p[1]], k);
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

  const tan = tangents(track);
  const nrm = tan.map((t) => [-t[1], t[0]]);
  const last0 = track.length - 1;

  /* ==> THE CAPS COVER WHAT THE SOURCE ACTUALLY DREW AT EACH END. <== A
   * published cone's nose is not a circle about the last forecast point.
   * Measured on the GDACS sample: the outline runs from 2.42° to 2.65° from
   * that point depending on bearing, because the cone keeps growing past the
   * last hour anybody plotted. The radius measured perpendicular is the
   * SMALLEST of those, so a cap drawn at it leaves the published nose sticking
   * out — the far end of the cone, which is the part people look at hardest.
   * Both end radii are therefore raised to the farthest the published outline
   * reaches ahead of (or behind) that end. Raising a radius only grows the
   * shape, and it stays smooth because the interpolation carries the larger
   * value along the flank instead of stepping to it at the cap. */
  ys[0] = Math.max(ys[0], reachFrom(track[0], [-tan[0][0], -tan[0][1]], ringsXY));
  ys[ys.length - 1] = Math.max(
    ys[ys.length - 1], reachFrom(track[last0], tan[last0], ringsXY)
  );

  /* ==> NEVER BELOW THE STRAIGHT INTERPOLATION, AND THE REASON IS THE TANGENT
   * LINE ITSELF. <== Between two forecast hours the published flank is the line
   * pulled taut around both circles, and the distance from the centre line to
   * that tangent is EXACTLY the straight interpolation of the two radii — one
   * line of algebra, and it is why the published flank is straight in the first
   * place. A monotone cubic through radii that ACCELERATE (which cone radii do)
   * sags below its own chords, so using it alone draws a cone narrower than the
   * published one all the way along, on a dead straight track where there is no
   * bend to justify anything. Measured before this line existed: a constant
   * ~22 km undercut at zero turn, which is nothing to do with the sagitta and
   * everything to do with picking the wrong interpolant.
   *
   * So the cubic is only allowed to WIN where it is wider. It still earns its
   * place — on the stretches where the radii flatten off it rounds a corner the
   * straight interpolation would leave — but it can never take ground away. */
  const m = pchipSlopes(xs, ys);
  const radius = track.map((_, i) =>
    Math.max(pchipAt(xs, ys, m, s[i]), linearAt(xs, ys, s[i])));

  /* ==> A GROWING CIRCLE'S EDGE IS NOT PERPENDICULAR TO ITS TRACK. <==
   *
   * Where the cone widens, its edge leans away from the track by an angle φ,
   * and sin φ is exactly how fast the radius grows — dr/ds. Lay a straight
   * track on the x axis: the published tangent line makes that same angle with
   * it, and the point where the circle at this station actually TOUCHES that
   * line is not straight out along the normal. It is rotated back toward the
   * track by φ.
   *
   * Placing the edge straight out along the normal by `radius` therefore draws
   * it inside the published flank everywhere the cone is widening — measured,
   * an 11 km undercut on a dead straight track, where the sagitta is zero and
   * nothing else can be blamed.
   *
   * ==> AND THE TANGENCY POINT IS WHY THE CAPS FIT. <== An earlier version got
   * the flank onto the right line by pushing out along the normal by
   * radius/cos φ instead. That traces the same line — but its last point is not
   * on the end circle, so the cap started 11 km away from where the flank
   * finished and left a notch at the nose. The tangency point IS on the end
   * circle by construction, so the cap simply carries on from it.
   *
   * `lean` is clamped because dr/ds → 1 is a cone widening as fast as the storm
   * advances: a 90° flank, which no forecast publishes. */
  const lean = track.map((_, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(track.length - 1, i + 1);
    const ds = s[b] - s[a];
    const sinp = ds > 0 ? (radius[b] - radius[a]) / ds : 0;
    const clamped = Math.max(-1 + CONE_SWEEP.minLeanCos, Math.min(1 - CONE_SWEEP.minLeanCos, sinp));
    return { sin: clamped, cos: Math.sqrt(Math.max(0, 1 - clamped * clamped)) };
  });

  /** The two tangency directions at station i — the normal rotated back toward
   *  the track by φ, on each side. */
  const dirL = track.map((_, i) =>
    [nrm[i][0] * lean[i].cos - tan[i][0] * lean[i].sin,
     nrm[i][1] * lean[i].cos - tan[i][1] * lean[i].sin]);
  const dirR = track.map((_, i) =>
    [-nrm[i][0] * lean[i].cos - tan[i][0] * lean[i].sin,
     -nrm[i][1] * lean[i].cos - tan[i][1] * lean[i].sin]);

  const capSteps = (r) =>
    Math.max(CONE_SWEEP.minCapSteps,
      Math.min(CONE_SWEEP.maxCapSteps, Math.ceil((Math.PI * r) / CONE_SWEEP.spacingDeg)));

  const left = track.map((p, i) => [p[0] + dirL[i][0] * radius[i], p[1] + dirL[i][1] * radius[i]]);
  const right = track.map((p, i) => [p[0] + dirR[i][0] * radius[i], p[1] + dirR[i][1] * radius[i]]);

  /* A fan of directions from one centre cannot double back; a flank can, and
   * that is the one shape this refuses to draw. On the inside of a bend tighter
   * than the cone is wide the offset points reverse and the edge ties itself in
   * a loop, which MapLibre fills as a hole through the veil. */
  if (folds(left, tan) || folds(right, tan)) return null;

  /* The caps run between the real tangency directions, so each one picks up
   * exactly where its flank stopped. A widening cone's end cap is therefore a
   * little MORE than a half circle and its start cap a little less, which is
   * the shape of the thing rather than an approximation of it. */
  const ring = [
    ...left,
    ...capBetween(track[last0], dirL[last0], dirR[last0], radius[last0],
                  capSteps(radius[last0])),
    ...right.slice().reverse(),
    ...capBetween(track[0], dirR[0], dirL[0], radius[0], capSteps(radius[0])),
  ];

  /* ==> THE ONE UNDERCUT WE ACCEPT, AND ITS EXACT SIZE. <==
   *
   * A published cone is the HULL of the forecast-hour discs, not their union:
   * the source fills the waist between consecutive circles with the two lines
   * pulled taut around them. On the inside of a bend that taut line cuts
   * straight across the corner while a circle swept along the curve stays a
   * fixed distance from it, so the sweep is narrower there. It is not a bug and
   * it cannot be engineered away — any smooth curve that hugs the inside of the
   * bend is inside the published cone, and any curve that contains the published
   * cone IS the straight line. Aaron took the smooth side, 2026-08-08.
   *
   * WHAT IT IS NOT ALLOWED TO BE IS UNBOUNDED. The deficit is exactly the
   * SAGITTA — how far the smoothed track bows off the straight chord between
   * two forecast points — so that quantity, computed from our own geometry, is
   * the yardstick. An undercut deeper than the sagitta is not this effect; it
   * is a cone that does not belong to this track, a bad radius, or a source
   * that publishes something other than a hull of discs. Those fall back.
   *
   * This is the difference between an accepted trade and a silent failure, and
   * without the bound they look identical from outside. */
  const bound = sagittaOf(track, s, xs) * CONE_SWEEP.undercutSlack
    + ys[ys.length - 1] * CONE_SWEEP.undercutRadiusFrac;

  /* ==> SAMPLED ALONG THE EDGES, NOT JUST AT THE VERTICES. <== A published
   * tangent leg is TWO vertices hundreds of km apart, and both of them sit on a
   * forecast point's own circle — the one place the rebuild is exact by
   * construction. Checking vertices alone therefore tests the two spots that
   * cannot fail and skips the entire middle of the leg, which is precisely
   * where a wrong radius profile shows up. It hid a 3.5 km sag for a full round
   * of testing before the fixture was densified and it reappeared. */
  for (const ring0 of ringsXY) {
    for (let i = 0; i < ring0.length - 1; i++) {
      const a = ring0[i];
      const b = ring0[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / CONE_SWEEP.checkStepDeg));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        if (outsideBy([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ring) > bound) return null;
      }
    }
  }

  const out = ring.map((p) => toLonLat(p, k));
  out.push(out[0].slice());
  return out;
}
