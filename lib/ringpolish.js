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
