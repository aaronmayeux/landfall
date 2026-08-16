/**
 * cone-sweep.js — the cone of uncertainty, redrawn along the smoothed track.
 *
 * ==> IT MEASURES THE PUBLISHED CONE. IT DOES NOT MODEL IT. <== That is the
 * whole file, and it is the second design.
 *
 * The first one modelled a cone as a growing circle slid along the track,
 * recovered one radius per forecast point, and rebuilt from those. It carried
 * an interpolation floor, a lean correction, tangency caps and a sagitta bound,
 * every one of which existed to make the model fit the data. In production it
 * refused itself on every storm and fell back to the published outline, which
 * is why the map looked untouched.
 *
 * ==> AND THE MEASUREMENT THAT CONDEMNED IT WAS MY OWN BUG. <== The redesign
 * was justified by a reading that published cones are up to 43% wider on one
 * side of their forecast track than the other. They are not. That came from a
 * SIGN ERROR in the ray-segment test below — `u` was computed negated, so a
 * crossing inside a segment was rejected and one outside it accepted, and the
 * ray silently returned the wrong side or nothing at all. Corrected, the
 * shipped GDACS payload is symmetric about its own track to within 1 km at
 * every forecast point. The same broken ray was inside the first design too,
 * feeding it garbage widths, and is the most likely reason it refused itself.
 * Recorded because a wrong measurement that survives into a design decision is
 * worse than a wrong line of code, and because the same function is still here.
 *
 * WHAT SURVIVES THAT, AND WHY THIS IS STILL THE RIGHT SHAPE. Measuring beats
 * modelling on its own merits: it keeps the published outline's own extent
 * rather than eight numbers and a theory about what joins them, it needs no
 * forecast points, and it assumes nothing about the cone being symmetric, or
 * circular, or growing. A model of the data is a thing that can be wrong about
 * the data. This has nothing to be wrong with.
 *
 * WHAT IT KEEPS. The published outline's own width, left and right, sampled all
 * the way along the track. Every one of those numbers is read off the source's
 * polygon. Nothing about how far the cone reaches is invented.
 *
 * WHAT CHANGES, AND IT IS ONLY THIS. Where the width is measured FROM: out
 * along the normal to our smoothed track, rather than from the straight legs
 * the source drew between forecast hours. Redrawn on a curve that bends, a
 * width profile that barely changes produces an edge that bends with it. That
 * is the entire trick, and it is why the flanks stop being straight.
 *
 * THE PROFILES ARE BLURRED, NOT THE OUTLINE. The same argument
 * lib/ringpolish.js makes for wind bands: the corners are steps in a 1-D
 * profile, not corners in x/y, so smooth the profile. A raised cosine, whose
 * weights are non-negative and sum to one, so a blurred width always lies
 * between the published widths near it and can never invent coverage.
 *
 * ==> THE BLUR IS WHERE THE BEND COMES FROM, WHICH IS NOT OBVIOUS. <== Measure
 * the width exactly and redraw it and you get the published outline back, kinks
 * and all — the operation is an identity. It is removing the per-leg ripple
 * from the width profile that lets the drawn edge follow the track instead of
 * the source's straight legs. So the blur window is the one dial that decides
 * how smooth the cone looks, and too narrow a window leaves a visible wobble
 * rather than a facet.
 *
 * FAILURE IS `null`, and the caller draws the published outline and SAYS SO on
 * the console. A rebuilt cone is a better picture; a wrong one is a §5 bug, and
 * one that quietly declines is a feature nobody can debug.
 *
 * Pure functions. Imports: config only. No DOM, ever.
 */

import { CONE_SWEEP, TRACK_LINE } from '../config/constants.js';

const DEG = Math.PI / 180;

/* ---------------------------------------------------------------------------
 * THE ANTIMERIDIAN — the inputs do not arrive on the same branch
 *
 * lib/trackline.js emits the smoothed track UNWRAPPED on purpose: longitudes
 * may run past ±180, because that is what MapLibre needs to draw one continuous
 * line across the seam. The published cone arrives from the source wrapped into
 * (−180, 180]. Left alone, every storm crossing the dateline measures its cone
 * as a world away and refuses itself — silently, across the western half of the
 * West Pacific. Everything is brought onto the TRACK's branch, and the result
 * is emitted there too: the frame the track beside it is already drawn in.
 * ------------------------------------------------------------------------- */

/** A ring made continuous, then moved onto `ref`'s branch AS ONE PIECE. Shifting
 *  vertex by vertex would tear a straddling ring in half across the world. */
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

/* ---------------------------------------------------------------------------
 * GEOMETRY
 * ------------------------------------------------------------------------- */

/**
 * Distance from `p` along unit direction `d` to where the outline FIRST lies.
 *
 * First, not farthest. The neighbouring function in lib/ringpolish.js takes the
 * farthest crossing, correctly, because a wind band is star-shaped about the
 * storm and a ray leaves it once. A cone is a tube: on a recurve a ray cast out
 * from one part of it crosses the far flank several degrees away, and taking
 * that reading builds a staircase down the inner flank and a spike past the
 * nose. Both were measured before this comment existed.
 *
 * NaN when nothing is hit — a real answer, distinguishable from a width of
 * zero, and handled by the caller rather than silently becoming a pinch.
 *
 * ==> `u` IS NOT NEGATED. IT WAS ONCE, AND IT COST A WHOLE DESIGN. <== With the
 * sign flipped, a crossing genuinely inside a segment lands at −u and is
 * rejected, while one beyond the segment's end is accepted. The function still
 * returns plausible-looking distances, so nothing errors and nothing looks
 * broken — it just reports the wrong edge, or none. It produced a fictional 43%
 * asymmetry in the published cone that a whole redesign was argued from. If
 * this ever needs touching, check it against a hand-worked case first.
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
      if (den === 0) continue;
      const ax = a[0] - p[0];
      const ay = a[1] - p[1];
      const t = (ax * ey - ay * ex) / den;
      const u = (ax * d[1] - ay * d[0]) / den;
      if (t > 0 && t <= limit && u >= 0 && u <= 1 && t < best) best = t;
    }
  }
  return Number.isFinite(best) ? best : NaN;
}

/** Cumulative arc length along a polyline. */
function arcLengths(pts) {
  const s = [0];
  for (let i = 1; i < pts.length; i++) {
    s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return s;
}

/**
 * Resample a polyline to uniform spacing.
 *
 * ==> BEFORE ANY BLURRING, ALWAYS. <== lib/ringpolish.js states the reason and
 * paid for it once: averaging over IRREGULAR spacing can sharpen a local angle
 * instead of rounding it. The smoothed track's own vertices are deliberately
 * unevenly spaced — lib/trackline.js subdivides long legs harder than short
 * ones — so a blur run over them would smooth the width unevenly along the
 * cone. Uniform stations make the blur window mean the same distance
 * everywhere.
 */
function resample(pts, step) {
  const s = arcLengths(pts);
  const total = s[s.length - 1];
  if (!(total > step)) return pts.slice();
  const n = Math.max(2, Math.round(total / step));
  const out = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const d = (total * i) / n;
    while (j < pts.length - 2 && s[j + 1] < d) j++;
    const span = s[j + 1] - s[j];
    const t = span > 0 ? (d - s[j]) / span : 0;
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t,
              pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
  }
  return out;
}

/** Unit tangents by central difference. */
function tangents(pts) {
  const n = pts.length;
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    return [dx / L, dy / L];
  });
}

/**
 * Fill gaps in a measured profile from the nearest readings either side.
 *
 * A ray misses where the track runs close to the cone's own end, and near the
 * nose it misses on both sides. A gap is not a width of zero — drawing it as
 * one would pinch the cone shut, which is the same class of bug the GDACS band
 * work hit when a degenerate polygon read as a zero radius. Interpolated
 * between real readings, or held flat past the last one; never invented from
 * nothing, and `null` if there is nothing to work from.
 */
function fillGaps(w) {
  const idx = [];
  for (let i = 0; i < w.length; i++) if (Number.isFinite(w[i])) idx.push(i);
  if (!idx.length) return null;
  const out = w.slice();
  for (let i = 0; i < idx[0]; i++) out[i] = w[idx[0]];
  for (let i = idx[idx.length - 1] + 1; i < w.length; i++) out[i] = w[idx[idx.length - 1]];
  for (let k = 0; k < idx.length - 1; k++) {
    const a = idx[k];
    const b = idx[k + 1];
    for (let i = a + 1; i < b; i++) out[i] = w[a] + ((w[b] - w[a]) * (i - a)) / (b - a);
  }
  return out;
}

/**
 * Raised-cosine blur along a profile, clamped at the ends.
 *
 * NON-NEGATIVE WEIGHTS SUMMING TO ONE, so a blurred width always lies between
 * the published widths inside its window. It cannot overshoot into coverage
 * nobody published, and it cannot collapse toward zero. Same guarantee
 * lib/ringpolish.js states for the angular version, and the same reason for
 * choosing a cosine over a box.
 */
function blur(w, half) {
  if (half < 1) return w.slice();
  const weights = [];
  let sum = 0;
  for (let k = -half; k <= half; k++) {
    const v = 0.5 * (1 + Math.cos((Math.PI * k) / (half + 1)));
    weights.push(v);
    sum += v;
  }
  const n = w.length;
  return w.map((_, i) => {
    let acc = 0;
    for (let k = -half, j = 0; k <= half; k++, j++) {
      acc += w[Math.max(0, Math.min(n - 1, i + k))] * weights[j];
    }
    return acc / sum;
  });
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
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = dx * dx + dy * dy;
    let t = L ? ((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = a[0] + t * dx - v[0];
    const qy = a[1] + t * dy - v[1];
    best = Math.min(best, qx * qx + qy * qy);
  }
  return Math.sqrt(best);
}

/** Does an edge double back on itself? On the inside of a bend tighter than the
 *  cone is wide the offsets reverse and the edge ties a loop, which MapLibre
 *  fills as a hole punched through the veil. */
function folds(edge, tan) {
  for (let i = 0; i < edge.length - 1; i++) {
    const dx = edge[i + 1][0] - edge[i][0];
    const dy = edge[i + 1][1] - edge[i][1];
    if (dx * tan[i][0] + dy * tan[i][1] < 0) return true;
  }
  return false;
}

/**
 * A quarter-turn of cap, from the flank's last point round to the nose.
 *
 * HALF AN ELLIPSE, NOT AN ARC OF A CIRCLE, because the two sides are different
 * widths and the reach ahead is a third number. Swept as
 * `centre + reach·cos θ · t + width·sin θ · n`, which arrives at the flank
 * endpoint with its tangent along the track — so the cap does not corner where
 * it meets the flank — and at the nose pointing straight across it, which is
 * where the other quarter picks it up.
 */
function capQuarter(c, t, n, reach, width, sgn, steps) {
  const out = [];
  for (let k = 1; k <= steps; k++) {
    /* From ±90° (the flank) toward 0° (dead ahead). The flank endpoint itself
     * is excluded; the flank already owns it. */
    const th = (sgn * Math.PI) / 2 - (sgn * Math.PI * k) / (2 * steps);
    const ct = Math.cos(th);
    const st = Math.sin(th);
    out.push([c[0] + reach * ct * t[0] + width * st * n[0],
              c[1] + reach * ct * t[1] + width * st * n[1]]);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * THE REBUILD
 * ------------------------------------------------------------------------- */

/**
 * Redraw a published cone along the smoothed forecast track.
 *
 * @param {Array<[number,number]>} trackLonLat  the SMOOTHED forecast track
 * @param {Array<Array<[number,number]>>} rings the published cone's rings
 * @returns {Array<[number,number]>|null} a closed ring, or null to fall back
 */
export function sweepCone(trackLonLat, rings) {
  return sweepConeDetail(trackLonLat, rings)?.ring || null;
}

/**
 * The same rebuild, keeping the stations it is assembled from.
 *
 * ==> WHY THIS EXISTS: THE RIBS WERE ALREADY BEING COMPUTED AND THROWN AWAY.
 * <== §47.5's environment ribbon fills the cone in slices colored by what the
 * environment is worth at each forecast hour, and a slice is exactly one
 * station's left edge, its right edge, and the next station's. Measuring the
 * cone a second time to get them would be a second answer to a question this
 * file has already answered — and the two could disagree, which would show as
 * a ribbon that does not fit the cone it is painted inside.
 *
 * ==> IT IS ALSO WHY THE RIBBON DOES NOT DRAW ON A REFUSAL. <== Everything
 * below returns `null` rather than a worse shape, and a `null` here means the
 * published outline is what the map draws (lib/cone-smooth.js). That outline
 * has no stations, so there is nothing honest to slice: a ribbon built from
 * widths the guard has just rejected would sit visibly inside the cone edge on
 * exactly the storms where the measurement is least trustworthy. No ribs, no
 * ribbon, and the layer row says so (§47.9).
 *
 * `t` is the fraction along the resampled track, 0 at the current position and
 * 1 at the end of the forecast. The stations are uniformly spaced by arc
 * length — that is what `resample` above guarantees — so it is simply the
 * index over the count, and a caller can turn it into a forecast hour without
 * re-walking the geometry.
 *
 * @returns {{ring: Array<[number,number]>,
 *            ribs: Array<{t:number, lon:number, lat:number,
 *                         left:[number,number], right:[number,number]}>}|null}
 */
export function sweepConeDetail(trackLonLat, rings) {
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

  /* --- measure, both sides, every station ------------------------------- */
  const rawL = [];
  const rawR = [];
  let hits = 0;
  for (let i = 0; i < track.length; i++) {
    const l = rayHit(track[i], nrm[i], ringsXY, CONE_SWEEP.maxRayDeg);
    const r = rayHit(track[i], [-nrm[i][0], -nrm[i][1]], ringsXY, CONE_SWEEP.maxRayDeg);
    rawL.push(l);
    rawR.push(r);
    if (Number.isFinite(l) || Number.isFinite(r)) hits++;
  }
  /* A track that mostly cannot see the cone is not this cone's track. Refuse
   * rather than draw a shape assembled from a handful of readings. */
  if (hits < track.length * CONE_SWEEP.minHitFrac) return null;

  const fillL = fillGaps(rawL);
  const fillR = fillGaps(rawR);
  if (!fillL || !fillR) return null;

  /* THE WINDOW IS ALSO CAPPED AGAINST THE CONE'S OWN LENGTH. The blur is wide
   * on purpose — it has to span a forecast interval to flatten the per-leg
   * ripple — but a short forecast is shorter than that window, and blurring a
   * whole cone with a window as long as itself flattens its taper into a
   * sausage. A quarter of the track each way is the most any station may see. */
  const half = Math.max(1, Math.min(
    Math.round(CONE_SWEEP.blurDeg / CONE_SWEEP.stepDeg),
    Math.floor(track.length * CONE_SWEEP.maxBlurFrac)
  ));
  const wL = blur(fillL, half);
  const wR = blur(fillR, half);

  /* --- the ends --------------------------------------------------------- */
  const last = track.length - 1;
  const reachEnd = rayHit(track[last], tan[last], ringsXY, CONE_SWEEP.maxRayDeg);
  const reachStart = rayHit(track[0], [-tan[0][0], -tan[0][1]], ringsXY, CONE_SWEEP.maxRayDeg);
  /* A ray straight ahead can miss on a cone whose nose is off to one side. The
   * flank width is the honest stand-in: it makes the cap a half-circle rather
   * than a point, which is what the end of a cone looks like anyway. */
  const aheadEnd = Number.isFinite(reachEnd) ? reachEnd : Math.max(wL[last], wR[last]);
  const aheadStart = Number.isFinite(reachStart) ? reachStart : Math.max(wL[0], wR[0]);

  const capSteps = (r) => Math.max(CONE_SWEEP.minCapSteps,
    Math.min(CONE_SWEEP.maxCapSteps, Math.ceil((Math.PI * r) / (2 * CONE_SWEEP.stepDeg))));

  /* --- assemble --------------------------------------------------------- */
  const left = track.map((p, i) => [p[0] + nrm[i][0] * wL[i], p[1] + nrm[i][1] * wL[i]]);
  const right = track.map((p, i) => [p[0] - nrm[i][0] * wR[i], p[1] - nrm[i][1] * wR[i]]);
  if (folds(left, tan) || folds(right, tan)) return null;

  const ring = [
    ...left,
    ...capQuarter(track[last], tan[last], nrm[last], aheadEnd, wL[last], +1, capSteps(aheadEnd)),
    ...capQuarter(track[last], tan[last], nrm[last], aheadEnd, wR[last], -1, capSteps(aheadEnd))
      .reverse(),
    ...right.slice().reverse(),
    ...capQuarter(track[0], [-tan[0][0], -tan[0][1]], nrm[0], aheadStart, wR[0], -1,
                  capSteps(aheadStart)),
    ...capQuarter(track[0], [-tan[0][0], -tan[0][1]], nrm[0], aheadStart, wL[0], +1,
                  capSteps(aheadStart)).reverse(),
  ];

  /* --- the guard -------------------------------------------------------- */

  /* WALKED, NOT SAMPLED AT VERTICES. A published tangent leg is two vertices
   * hundreds of km apart; checking only those tests the two ends of the leg and
   * skips everything between them, which is where a wrong profile shows up. It
   * hid a 3.5 km sag through a full round of testing on the previous design. */
  let worst = 0;
  for (const r of ringsXY) {
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i];
      const b = r[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / CONE_SWEEP.checkStepDeg));
      for (let j = 0; j < steps; j++) {
        const t = j / steps;
        const d = outsideBy([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ring);
        if (d > worst) worst = d;
      }
    }
  }
  /* The only thing that may narrow the cone is the blur, and its window is what
   * bounds how much. Anything deeper is not smoothing — it is a cone that does
   * not belong to this track. */
  if (worst > CONE_SWEEP.blurDeg * CONE_SWEEP.undercutSlack + CONE_SWEEP.undercutFloorDeg) {
    return null;
  }

  /* DEDUPED BEFORE IT LEAVES. The two halves of each cap both own the point
   * dead ahead, so each cap emits it twice. A repeated vertex is a zero-length
   * segment, and a zero-length segment has no direction — which is enough to
   * make a self-intersection test report a crossing that is not there, and
   * enough to give MapLibre a degenerate edge to triangulate. Cheap to remove
   * here, awkward to chase anywhere else. */
  const out = [];
  for (const p of ring) {
    const q = [p[0] / k, p[1]];
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev[0] - q[0]) < TRACK_LINE.joinEpsDeg
             && Math.abs(prev[1] - q[1]) < TRACK_LINE.joinEpsDeg) continue;
    out.push(q);
  }
  if (out.length < 4) return null;
  out.push(out[0].slice());

  /* THE RIBS COME BACK IN LON/LAT, LIKE THE RING. Everything above works in a
   * plane where longitude is scaled by cos(latitude) so the ray casts and the
   * blur are in comparable units; `x / k` is the same undo the ring gets three
   * lines up. A rib left in scaled space would land the ribbon a few degrees
   * off the cone at high latitude, which is exactly where a recurving storm
   * spends its last two days. */
  const unscale = (p) => [p[0] / k, p[1]];
  const lastIdx = track.length - 1;
  const ribs = track.map((p, i) => ({
    t: lastIdx > 0 ? i / lastIdx : 0,
    lon: p[0] / k,
    lat: p[1],
    left: unscale(left[i]),
    right: unscale(right[i]),
  }));

  /* ==> THE TWO CAPS ARE HANDED OUT SEPARATELY, BECAUSE THEY ARE NOT RIBS AND
   * FORGETTING THAT LEFT BOTH ENDS OF EVERY CONE UNPAINTED. <== A rib is a cut
   * across the cone perpendicular to the track; a cap is the half-ellipse
   * BEYOND the last station, and no pair of stations spans it. The environment
   * ribbon sliced the ribs, covered the straight middle perfectly, and dropped
   * the rounded nose and tail through to the plain veil — visible on glass as a
   * grey blob at each end of a fully-drawable cone (2026-08-15).
   *
   * Each is a closed ring in its own right: the two cap quarters plus the rib
   * that closes them back against the body. So a caller paints one polygon per
   * cap and the whole cone is accounted for.
   *
   * THE START CAP IS THE TAIL, BEHIND THE CURRENT POSITION, and the END CAP is
   * the nose at the far end of the forecast. Named for the track's direction
   * rather than for how they look, because that is what a caller has to match
   * a forecast hour against. */
  /* ==> THE WIDTH THAT GOES WITH `+1` IS THE ONE ON THE NORMAL'S SIDE, AND
   * GETTING THE PAIRING WRONG DOES NOT THROW. <== `capQuarter` sweeps from the
   * flank at ±90° round to dead ahead, so the width handed to the `+1` call
   * has to be the flank width on the `+n` side and the `-1` call the `-n` side
   * — the same pairing the ring above uses. Swap them and the cap comes out
   * inside out on an asymmetric cone, silently, and only on the storms where
   * the two sides genuinely differ.
   *
   * The flank endpoints themselves are excluded by `capQuarter` (the flank
   * owns them), so the ring is closed by adding them back explicitly. Without
   * that a cap is a lens floating just past the cone rather than a shape
   * joined to it, and a hairline of veil shows through at the seam. */
  /* ==> DEDUPED, FOR THE SAME REASON THE BODY RING IS. <== Both quarters own
   * the point dead ahead — one ends there, the other starts there — so every
   * cap carried a repeated vertex, and a repeated vertex is a zero-length
   * segment with no direction: enough to make a self-intersection test report
   * a crossing that is not there, and enough to hand MapLibre a degenerate
   * edge to triangulate. The body ring strips this fifty lines up; leaving it
   * in here made one file contradict its own rule. Eight cap steps minimum
   * (CONE_SWEEP.minCapSteps) means the ring cannot collapse. */
  const capRing = (c, t, n, reach, plusWidth, minusWidth, steps) => {
    const raw = [
      [c[0] + plusWidth * n[0], c[1] + plusWidth * n[1]],
      ...capQuarter(c, t, n, reach, plusWidth, +1, steps),
      ...capQuarter(c, t, n, reach, minusWidth, -1, steps).reverse(),
      [c[0] - minusWidth * n[0], c[1] - minusWidth * n[1]],
    ].map(unscale);
    const ring = [];
    for (const p of raw) {
      const prev = ring[ring.length - 1];
      if (prev && Math.abs(prev[0] - p[0]) < TRACK_LINE.joinEpsDeg
               && Math.abs(prev[1] - p[1]) < TRACK_LINE.joinEpsDeg) continue;
      ring.push(p);
    }
    ring.push(ring[0].slice());
    return ring;
  };

  return {
    ring: out,
    ribs,
    capStart: capRing(track[0], [-tan[0][0], -tan[0][1]], nrm[0],
      aheadStart, wL[0], wR[0], capSteps(aheadStart)),
    capEnd: capRing(track[last], tan[last], nrm[last],
      aheadEnd, wL[last], wR[last], capSteps(aheadEnd)),
  };
}
