/**
 * ringpolish.js — uniform resample + iterated averaging for closed rings.
 *
 * EXTRACTED, NOT INVENTED. These two stages were built and tuned inside
 * lib/windswath.js across several on-glass iterations, and they are the
 * reason the NHC full-track swath reads as a smooth wall instead of a corner
 * at every 6-hourly fix. When the GDACS band merge needed the same finish
 * (lib/bandmerge.js), the choice was copy or extract — and §12 says any
 * pattern used twice gets extracted before the second use.
 *
 * They live here because they are pure ring geometry: they know nothing
 * about wind, thresholds, quadrants, or where the ring came from. Both
 * callers hand in a closed ring of [x, y] pairs and get a smoother one back.
 *
 * THE ORDER MATTERS AND IS NOT INTERCHANGEABLE. Resample first, ALWAYS.
 * 3-point averaging over IRREGULAR vertex spacing can sharpen a local angle
 * instead of rounding it — measured during the NHC work: the polish pass
 * manufactured a 154° micro-kink out of an 85° corner it was meant to
 * soften. On uniform spacing the same averaging is a clean low-pass and can
 * only round. Anything calling smoothClosedRing on an unresampled ring is
 * re-opening a bug that has already been paid for once.
 *
 * Units are whatever the caller uses — nautical miles in the planar frame
 * for the NHC sweep, degrees for the GDACS merge. The maths is unitless; the
 * `spacing` argument just has to match the ring's own units.
 *
 * Pure functions. Imports: config/ and lib/catmullrom.js only. No DOM, ever.
 */

import { RING_POLISH } from '../config/constants.js';
import { crPoint } from './catmullrom.js';

/**
 * Resample a closed ring to uniform vertex spacing.
 *
 * Resampled points lie ON the original ring and chords cut inward, so this
 * can only shave area, never add it. Returns the input unchanged when the
 * ring is too short to be worth it.
 *
 * @param {Array<[number,number]>} ring — closed or open; treated as closed.
 * @param {number} spacing — target distance between output vertices.
 * @param {number} [maxSamples] — hard ceiling on output vertices.
 */
export function resampleClosedRing(ring, spacing, maxSamples = RING_POLISH.maxSamples) {
  if (!Array.isArray(ring) || ring.length < 4 || !(spacing > 0)) return ring;

  /* Work on the open form; the closing vertex is structural. */
  const first = ring[0];
  const last = ring[ring.length - 1];
  const isClosed = first[0] === last[0] && first[1] === last[1];
  const pts = isClosed ? ring.slice(0, -1) : ring;
  if (pts.length < 3) return ring;

  const per = [0];
  for (let i = 1; i < pts.length; i++) {
    per.push(per[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const closeLen = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  const total = per[per.length - 1] + closeLen;

  /* Too small to resample meaningfully — leave it alone rather than reduce a
   * legitimate small shape to a triangle. */
  if (!(total > spacing * 8)) return ring;

  const count = Math.min(Math.ceil(total / spacing), maxSamples);
  const out = [];
  let j = 0;
  for (let s = 0; s < count; s++) {
    const d = (total * s) / count;
    while (j < pts.length - 1 && per[j + 1] < d) j++;
    const a = pts[j];
    const b = pts[(j + 1) % pts.length];
    const span = (j + 1 < per.length ? per[j + 1] : total) - per[j];
    const t = span > 0 ? (d - per[j]) / span : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out.push(out[0].slice());
  return out;
}

/**
 * Iterated 3-point averaging around a closed ring.
 *
 * Each pass replaces every vertex with a weighted average of itself and its
 * two neighbours (1:2:1), wrapping at the seam so the join is smoothed like
 * any other vertex. Equivalent to a Gaussian blur along the ring.
 *
 * BOUNDED, and the bound is worth stating because this runs on a safety
 * layer: an averaged vertex always lands inside the triangle of itself and
 * its neighbours, so the ring cannot grow lobes or spikes. It CAN nudge a
 * concave vertex outward toward its neighbours' chord — bounded by the
 * sagitta at one vertex spacing, a couple of units at the sharpest dent
 * against bands a hundred wide. That is the accepted smoothness-over-
 * accuracy trade, taken with the bound recorded.
 *
 * @param {Array<[number,number]>} ring — closed ring.
 * @param {number} passes — 0 returns the input untouched.
 */
export function smoothClosedRing(ring, passes = RING_POLISH.smoothPasses) {
  if (!Array.isArray(ring) || ring.length < 5 || passes <= 0) return ring;

  const first = ring[0];
  const last = ring[ring.length - 1];
  const isClosed = first[0] === last[0] && first[1] === last[1];
  let pts = (isClosed ? ring.slice(0, -1) : ring).map((p) => p.slice());
  const n = pts.length;
  if (n < 4) return ring;

  for (let p = 0; p < passes; p++) {
    const prev = pts.map((v) => v.slice());
    for (let i = 0; i < n; i++) {
      const a = prev[(i - 1 + n) % n];
      const c = prev[(i + 1) % n];
      pts[i] = [(a[0] + 2 * prev[i][0] + c[0]) / 4, (a[1] + 2 * prev[i][1] + c[1]) / 4];
    }
  }

  pts.push(pts[0].slice());
  return pts;
}

/* ---------------------------------------------------------------------------
 * RADIAL SEAM SMOOTHING — for shapes built from QUADRANT SECTORS.
 *
 * WHY XY SMOOTHING CANNOT DO THIS, measured 2026-07-24. A published wind band
 * is four sectors of different radii joined by RADIAL EDGES at 90/180/270.
 * Those edges are step discontinuities in r(theta), not corners in x/y, and:
 *
 *   - Rounding one means moving OUTWARD, into the notch. An earlier attempt
 *     clipped the smoothed ring to stay inside the published one, which
 *     forbids exactly that — it either changed nothing or tore the ring.
 *   - The XY smoothing window is set by vertex spacing. At the shipped
 *     settings that was 1.5 nm against a 32 nm notch: a measured radius
 *     change of 0.005 deg. Real, invisible.
 *
 * SO SMOOTH r(theta), NOT x/y. This is the method lib/windswath.js already
 * uses (`radiusAtBearing`) and the HA project used before it: a periodic
 * COSINE blend, chosen because a cosine CANNOT OVERSHOOT the values it blends
 * between. Every smoothed radius stays within the range of the published
 * radii inside its window, which is the same bound windswath states — a
 * smoothed radius can never exceed any published radius nearby.
 *
 * THE QUADRANT STEP IS A REPORTING ARTIFACT, NOT WEATHER. Four radii are
 * samples of a continuous field, exactly as 6-hourly fixes are samples of a
 * continuous track. No storm's wind ends in a square step at due west. The
 * spec already made this argument for bridging GDACS bands across time; this
 * is the same argument in the angular dimension.
 *
 * Longitude is scaled by cos(lat) so the profile is measured on real
 * distances rather than raw degrees, then unscaled on rebuild.
 * ------------------------------------------------------------------------- */

const DEG = Math.PI / 180;

/**
 * Radius at each of `n` evenly spaced bearings, taking the FARTHEST crossing.
 *
 * These bands are star-shaped about the storm centre, so a ray leaves through
 * one boundary — except exactly at a radial seam, where it meets both sector
 * radii. Taking the farthest makes the profile single-valued and puts the
 * seam in as a clean step for the blend to work on.
 */
function radialProfile(ring, cx, cy, lonScale, n) {
  const prof = new Array(n).fill(0);
  for (const [x, y] of ring) {
    const dx = (x - cx) * lonScale;
    const dy = y - cy;
    let b = Math.atan2(dx, dy) / DEG;
    if (b < 0) b += 360;
    const i = Math.round((b / 360) * n) % n;
    const r = Math.hypot(dx, dy);
    if (r > prof[i]) prof[i] = r;
  }
  /* Fill bearings no vertex landed on, so a sparse arc cannot punch a
   * zero-radius hole through the shape.
   *
   * LINEAR INTERPOLATION, NOT nearest-neighbour-min. The old fill took the
   * SMALLER of the two flanking radii, which turns a sparsely sampled arc into
   * flat plateaus with a step at every occupied bearing — a staircase, handed
   * to a blur whose whole job is removing steps. Worse, the treads could be
   * wider than the blur window, so they survived it. Interpolating gives the
   * blur a clean ramp between real samples and adds no radius the source did
   * not publish: an interpolated value always lies between its two neighbours,
   * the same containment bound the blur itself honours.
   *
   * The single-occupied-bearing case falls out of the wrap arithmetic: gap
   * becomes the full circle and every bin is filled with that one radius. */
  const occupied = [];
  for (let i = 0; i < n; i++) if (prof[i] > 0) occupied.push(i);
  if (!occupied.length || occupied.length === n) return prof;

  const filled = prof.slice();
  for (let k = 0; k < occupied.length; k++) {
    const a = occupied[k];
    const b = occupied[(k + 1) % occupied.length];
    const gap = ((b - a + n) % n) || n;
    for (let s = 1; s < gap; s++) {
      filled[(a + s) % n] = prof[a] + ((prof[b] - prof[a]) * s) / gap;
    }
  }
  return filled;
}

/** Raised-cosine circular blur over a profile. Exact, periodic — and because
 *  every weight is non-negative and they sum to 1, the output at any bearing
 *  lies between the min and max published radius inside the window. It cannot
 *  overshoot. */
function blurOnce(prof, windowDeg) {
  const n = prof.length;
  const half = Math.max(1, Math.round((windowDeg / 360) * n / 2));
  const w = [];
  let sum = 0;
  for (let k = -half; k <= half; k++) {
    const v = 0.5 * (1 + Math.cos((Math.PI * k) / (half + 1)));
    w.push(v);
    sum += v;
  }
  return prof.map((_, i) => {
    let acc = 0;
    for (let k = -half, j = 0; k <= half; k++, j++) {
      acc += prof[(i + k + n * 2) % n] * w[j];
    }
    return acc / sum;
  });
}

/** Repeated raised-cosine, which converges on a Gaussian. Each pass is a
 *  convex combination of the previous one, so N passes carry the same
 *  no-overshoot guarantee a single pass does. See RING_POLISH.seamBlurPasses
 *  on why one pass leaves a curvature jump the eye reads as a corner. */
function blurProfile(prof, windowDeg, passes = 1) {
  let cur = prof;
  for (let p = 0; p < Math.max(1, passes); p++) cur = blurOnce(cur, windowDeg);
  return cur;
}

/**
 * Round the radial seams off a sector-built ring.
 *
 * FEED THIS THE PUBLISHED RING, NOT A SIMPLIFIED ONE. The profile is built by
 * binning the ring's own vertices into bearings, so vertex density IS profile
 * resolution. Douglas-Peucker at 0.01° leaves arc points ~16° of bearing apart
 * on a 1° band — 22 real samples out of 360 bins — and no blur can recover a
 * step from a profile that coarse. GDACS publishes these rings at ~330-365
 * points (≈1° per bearing), which is exactly the density this wants.
 *
 * @param {Array<[number,number]>} ring   published ring, lon/lat degrees
 * @param {[number,number]} centre        storm centre [lon, lat]
 * @param {number} samples                bearings to sample
 * @param {number} windowDeg              angular blend width
 * @param {number} [passes]               blur passes; see seamBlurPasses
 */
export function smoothRadialSeams(
  ring,
  centre,
  samples,
  windowDeg,
  passes = RING_POLISH.seamBlurPasses
) {
  if (!Array.isArray(ring) || ring.length < RING_POLISH.minPolishPoints) return ring;
  const [cx, cy] = centre || [];
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return ring;

  const lonScale = Math.cos(cy * DEG) || 1;
  const prof = radialProfile(ring, cx, cy, lonScale, samples);
  if (!prof.some((r) => r > 0)) return ring;

  const smooth = blurProfile(prof, windowDeg, passes);
  const out = [];
  for (let i = 0; i < samples; i++) {
    const th = (i / samples) * 360 * DEG;
    out.push([cx + (smooth[i] * Math.sin(th)) / lonScale, cy + smooth[i] * Math.cos(th)]);
  }
  out.push(out[0]);
  return out;
}

/* ---------------------------------------------------------------------------
 * CLOSED-RING SPLINE — the same curve the tracks get, wrapped around a shape.
 *
 * WHY THIS AND NOT resample + smoothClosedRing, which is right above it. The
 * averaging pair exists to take the STEPS out of a shape assembled from
 * sectors: it is a low-pass filter, it moves every vertex, and it is judged on
 * whether the seam disappears. The cone of uncertainty has no seams. It is a
 * published outline that arrives smooth, gets thinned by Douglas-Peucker
 * (lib/simplify.js) for the vertex budget, and reads as FACETS afterwards —
 * measured on the shipped GDACS cone: 211 published points with a worst turn
 * of 9.4° become 53 points with a worst turn of 18.6°, and the nose cap
 * degenerates into four straight chords.
 *
 * That is the identical complaint lib/trackline.js was built to answer, so it
 * gets the identical answer: bend the polyline back into a curve THROUGH its
 * own points. A blur would round the corner by pulling the outline off the
 * vertices the source published; the spline rounds it by putting the arc back
 * between them. Only one of those can be described to a reader as "we did not
 * move anything NOAA or GDACS said".
 *
 * IT ERRS OUTWARD, WHICH IS THE ONLY ACCEPTABLE DIRECTION HERE. Measured on
 * the same cone: area 70.480 → 70.606 (+0.18%), worst excursion 0.034° outside
 * the published outline and 0.027° inside it — about 3 km against a cone
 * several hundred km across. A cone drawn smaller than the published one would
 * be a §5 bug wearing a cosmetic hat; this is not that.
 *
 * COST IS BOUNDED AND SMALL. Subdivision is length-scaled, so a ring that is
 * already dense gets one sample per leg and comes back roughly as it went in —
 * which is what makes this safe to point at an NHC cone (published fine) and a
 * GDACS cone (published coarse after DP) without knowing which is which.
 * ------------------------------------------------------------------------- */

/** Longitude difference wrapped into (−180, 180]. */
function dLon(a, b) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/**
 * Unwrap a ring's longitudes into one continuous run.
 *
 * A ring that straddles the antimeridian arrives with a ±360 jump in the
 * middle of it. Splining across that jump would throw a control point a world
 * away and drag the curve with it, so the maths runs on the unwrapped copy.
 *
 * ==> THE OUTPUT IS RE-WRAPPED BY THE CALLER WHEN THE INPUT WAS WRAPPED. <==
 * How a straddling POLYGON should be drawn is a separate, unsolved question
 * (a line can run past ±180 and MapLibre copes; a fill is not the same case).
 * This function exists to keep the curve correct, not to change what the map
 * does with it — so a wrapped ring goes back out wrapped, unchanged in that
 * respect from what shipped before.
 *
 * @returns {{pts: Array<[number,number]>, wrapped: boolean}}
 */
function unwrapRing(pts) {
  let wrapped = false;
  const out = [pts[0].slice()];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[i - 1];
    const d = dLon(pts[i][0], prev[0]);
    if (Math.abs(pts[i][0] - prev[0]) > 180) wrapped = true;
    out.push([prev[0] + d, pts[i][1]]);
  }
  /* The closing leg counts too: a ring can be continuous all the way round and
   * still take its jump on the segment back to the first vertex. */
  if (Math.abs(out[out.length - 1][0] - out[0][0]) > 180) wrapped = true;
  return { pts: out, wrapped };
}

/** Back into (−180, 180]. */
function rewrapLon(x) {
  let v = x;
  while (v > 180) v -= 360;
  while (v <= -180) v += 360;
  return v;
}

/**
 * Bend a closed ring into a curve through all of its own vertices.
 *
 * PLANAR FRAME, same as lib/trackline.js: longitude is scaled by cos(latitude)
 * before splining and unscaled after, so the curve is computed on something
 * shaped like the ocean rather than on a stretched lon/lat grid. Without it a
 * cone at 40°N rounds visibly wrong east-west.
 *
 * EVERY LEG IS A SEGMENT, INCLUDING THE CLOSING ONE. The neighbours wrap
 * around the ring, so the join at vertex 0 is curved exactly like every other
 * vertex — a ring with a corner at its own seam is the bug that closed-form
 * smoothing exists to avoid.
 *
 * Fewer than four vertices is not a shape worth curving; returned untouched
 * rather than padded into one.
 *
 * @param {Array<[number,number]>} ring closed or open; treated as closed
 * @param {object} opts
 * @param {number} opts.spacingDeg   target output vertex spacing, planar degrees
 * @param {number} opts.minPerLeg    floor on samples per leg
 * @param {number} opts.maxPerLeg    ceiling on samples per leg
 * @param {number} opts.maxVertices  hard ceiling on the whole ring
 * @param {number} opts.alpha        Catmull-Rom knot exponent (0.5 = centripetal)
 * @param {number} opts.minKnotGap   floor on knot spacing
 * @param {number} opts.minCosLat    floor on cos(lat) in the planar frame
 * @returns {Array<[number,number]>} closed ring
 */
export function splineClosedRing(ring, opts) {
  if (!Array.isArray(ring) || ring.length < 5) return ring;
  const { spacingDeg, minPerLeg, maxPerLeg, maxVertices, alpha, minKnotGap, minCosLat } = opts;

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!Array.isArray(first) || !Array.isArray(last)) return ring;
  const isClosed = first[0] === last[0] && first[1] === last[1];
  const raw = isClosed ? ring.slice(0, -1) : ring;
  if (raw.length < 4) return ring;
  if (!raw.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) {
    return ring;
  }

  const { pts, wrapped } = unwrapRing(raw);
  const n = pts.length;

  const lat0 = pts.reduce((s, p) => s + p[1], 0) / n;
  const cos = Math.max(Math.cos(lat0 * DEG), minCosLat);
  const xy = pts.map((p) => [p[0] * cos, p[1]]);

  /* THE BUDGET IS SPREAD ACROSS THE LEGS, NOT SPENT FRONT TO BACK — the same
   * correction lib/trackline.js carries, and for the same reason. A running
   * total drawn down leg by leg leaves a ring smooth at the start and dead
   * straight at the end, with one hard corner where the money ran out. On a
   * closed shape that corner has nowhere to hide. */
  const perLegCap = Math.max(1, Math.floor(maxVertices / n));

  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = xy[(i - 1 + n) % n];
    const p1 = xy[i];
    const p2 = xy[(i + 1) % n];
    const p3 = xy[(i + 2) % n];

    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    let k = Math.ceil(len / spacingDeg);
    k = Math.min(Math.max(k, minPerLeg), maxPerLeg);
    k = Math.max(1, Math.min(k, perLegCap));

    for (let s = 0; s < k; s++) {
      const q = crPoint(p0, p1, p2, p3, s / k, alpha, minKnotGap);
      const lon = q[0] / cos;
      out.push([wrapped ? rewrapLon(lon) : lon, q[1]]);
    }
  }
  out.push(out[0].slice());
  return out;
}
