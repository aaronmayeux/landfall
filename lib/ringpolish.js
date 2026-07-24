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
 * Pure functions. Imports: config/ only. No DOM, ever.
 */

import { RING_POLISH } from '../config/constants.js';

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
  /* Fill bearings no vertex landed on, by nearest neighbour either side, so a
   * sparse arc cannot punch a zero-radius hole through the shape. */
  for (let i = 0; i < n; i++) {
    if (prof[i] > 0) continue;
    let a = i, b = i;
    while (prof[(a + n) % n] === 0 && a > i - n) a--;
    while (prof[b % n] === 0 && b < i + n) b++;
    prof[i] = Math.min(prof[(a + n) % n] || 0, prof[b % n] || 0) || (prof[(a + n) % n] || prof[b % n]);
  }
  return prof;
}

/** Raised-cosine circular blur over a profile. One pass, exact, periodic —
 *  and because every weight is non-negative and they sum to 1, the output at
 *  any bearing lies between the min and max published radius inside the
 *  window. It cannot overshoot. */
function blurProfile(prof, windowDeg) {
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

/**
 * Round the radial seams off a sector-built ring.
 *
 * @param {Array<[number,number]>} ring   published ring, lon/lat degrees
 * @param {[number,number]} centre        storm centre [lon, lat]
 * @param {number} samples                bearings to sample
 * @param {number} windowDeg              angular blend width
 */
export function smoothRadialSeams(ring, centre, samples, windowDeg) {
  if (!Array.isArray(ring) || ring.length < RING_POLISH.minPolishPoints) return ring;
  const [cx, cy] = centre || [];
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return ring;

  const lonScale = Math.cos(cy * DEG) || 1;
  const prof = radialProfile(ring, cx, cy, lonScale, samples);
  if (!prof.some((r) => r > 0)) return ring;

  const smooth = blurProfile(prof, windowDeg);
  const out = [];
  for (let i = 0; i < samples; i++) {
    const th = (i / samples) * 360 * DEG;
    out.push([cx + (smooth[i] * Math.sin(th)) / lonScale, cy + smooth[i] * Math.cos(th)]);
  }
  out.push(out[0]);
  return out;
}
