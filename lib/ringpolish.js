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
 * CONTAINMENT — the safety half of polishing a PUBLISHED shape.
 *
 * Resampling only ever shaves (chords cut inward), and averaging a CONVEX
 * corner rounds it inward too. A REFLEX corner is the exception: averaging
 * pushes it OUTWARD, into space the source never claimed.
 *
 * That is not a rounding detail on a wind field. A published quadrant band is
 * a statement about where a wind threshold reaches, and its notches are
 * exactly the reflex corners — measured on GDACS's own green band, the radius
 * steps 32 nm across the due-west seam. Rounding that corner outward would
 * paint tropical-storm-force wind over 32 nm of ocean the source says is
 * clear. That is the §5 lie, on the layer where it matters most.
 *
 * So the polish is CLIPPED: every smoothed vertex must lie inside the
 * original ring, and any that does not is pulled back onto it. The guarantee
 * is simple enough to state and to check — THE DRAWN SHAPE IS ALWAYS A SUBSET
 * OF THE PUBLISHED SHAPE. Corners round inward only. The cost is that the
 * field reads slightly smaller than published at the seams, and understating
 * coverage is the safe direction.
 *
 * This is the difference between these corners and the ones lib/windswath.js
 * rounds. Those are artifacts of sampling a continuous track every 6 hours —
 * fake, safe to remove. These are real asymmetry.
 * ------------------------------------------------------------------------- */

/** Ray casting. Vertices on the boundary may fall either way; that is fine,
 *  because a boundary point is already legal and both answers keep it. */
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = (yi > y) !== (yj > y);
    if (straddles && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Closest point on a closed ring's boundary. Pulls an escaped vertex back
 *  the SHORTEST way, which keeps the outline smooth where it hugs the
 *  original instead of snapping to the nearest published vertex and
 *  reinstating the corner we just rounded. */
function nearestOnRing(x, y, ring) {
  let best = null;
  let bestD2 = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const dx = xi - xj;
    const dy = yi - yj;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((x - xj) * dx + (y - yj) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = xj + t * dx;
    const py = yj + t * dy;
    const d2 = (x - px) * (x - px) + (y - py) * (y - py);
    if (d2 < bestD2) { bestD2 = d2; best = [px, py]; }
  }
  return best;
}

/**
 * Clip a ring so it never leaves `original`.
 *
 * @param {Array<[number,number]>} ring     the smoothed ring
 * @param {Array<[number,number]>} original the published ring it must not exceed
 */
export function containRing(ring, original) {
  if (!Array.isArray(ring) || !Array.isArray(original) || original.length < 4) return ring;
  return ring.map(([x, y]) =>
    pointInRing(x, y, original) ? [x, y] : (nearestOnRing(x, y, original) || [x, y])
  );
}

/**
 * The full finish for ONE published band ring: resample, smooth, clip.
 *
 * Resample FIRST — see the header note; averaging over irregular spacing can
 * sharpen an angle instead of rounding it. Clip LAST, because it is the
 * smoothing that can escape and only the final positions matter.
 *
 * Returns the ring untouched when it is too small to be worth polishing, so
 * a degenerate or near-degenerate shape passes through rather than being
 * reshaped by a solver that has nothing to work with.
 */
export function polishBandRing(ring, spacing, passes = RING_POLISH.smoothPasses) {
  if (!Array.isArray(ring) || ring.length < RING_POLISH.minPolishPoints) return ring;
  const resampled = resampleClosedRing(ring, spacing);
  if (resampled.length < RING_POLISH.minPolishPoints) return ring;
  return containRing(smoothClosedRing(resampled, passes), ring);
}
