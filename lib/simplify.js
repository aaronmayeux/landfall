/**
 * simplify.js — Douglas–Peucker line simplification for GeoJSON rings.
 *
 * WHY THIS EXISTS, WITH A NUMBER: one GDACS storm returns 8,868 coordinates
 * across 44 features, largest single ring 365 points (measured live
 * 2026-07-24). Wind bands draw AMBIENT on every storm, so that multiplies by
 * the storm count. This is a globe on a phone — frame budget is the bar, and
 * shipping every published vertex to the GPU fails it for no visible gain.
 *
 * THE SAFETY RULE, and it is the whole design: simplification must never
 * DELETE a ring. The surge notes (SPEC §4) record exactly this failure —
 * a budget spent front-to-back with a hard break dropped whole bands, which
 * read on glass as missing coverage. A missing wind band is indistinguishable
 * from "no dangerous wind here," which is the §5 lie. So every ring that
 * comes in comes out: `minRingPoints` is a floor, not a target, and a ring
 * that cannot be reduced without falling through it is returned untouched.
 *
 * Pure functions. Imports: config/ only. No DOM, ever.
 */

import { SIMPLIFY } from '../config/constants.js';

/**
 * Perpendicular distance from point p to the segment a→b, in degrees.
 *
 * Planar on purpose. Real perpendicular distance on a sphere is a great-circle
 * cross-track calculation, and at the scale of one wind band (a few degrees
 * across, far from the poles) the difference is far below the tolerance we
 * simplify at. Using the cheap version keeps this loop tight, which is the
 * point of the exercise.
 */
function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  /* Project p onto the segment, clamped to its ends, then measure. */
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Douglas–Peucker on an open polyline. Iterative, not recursive: these rings
 * are hundreds of points and a pathological input should not be able to blow
 * the stack on someone's phone.
 */
function douglasPeucker(points, tolerance) {
  const n = points.length;
  if (n < 3) return points.slice();

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack = [[0, n - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDist(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * Simplify one closed ring, preserving closure and never dropping it.
 *
 * A GeoJSON ring repeats its first point at the end. That closing point is
 * structural, not data: it is excluded from the simplification and re-added
 * afterwards, so the ring can never come back open (an open "polygon" is
 * undefined behaviour in MapLibre and renders as a torn shape).
 */
export function simplifyRing(ring, tolerance = SIMPLIFY.gdacsToleranceDeg) {
  if (!Array.isArray(ring) || ring.length <= SIMPLIFY.skipUnderPoints) return ring;

  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1];
  const open = closed ? ring.slice(0, -1) : ring;

  let simplified = douglasPeucker(open, tolerance);

  /* THE FLOOR. If the tolerance ate the ring down past legibility, back off
   * and keep the original rather than draw a triangle where a storm's wind
   * field should be — or worse, nothing at all. Returning the input is always
   * safe; returning a husk is not. */
  if (simplified.length < SIMPLIFY.minRingPoints) return ring;

  if (closed) simplified = [...simplified, simplified[0]];
  return simplified;
}

/** Simplify every ring of a Polygon or MultiPolygon. Any other geometry type
 *  passes through untouched — lines here are 2-point track segments with
 *  nothing to simplify, and a Point has no rings at all. */
export function simplifyGeometry(geometry, tolerance = SIMPLIFY.gdacsToleranceDeg) {
  if (!geometry) return geometry;
  if (geometry.type === 'Polygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((r) => simplifyRing(r, tolerance)),
    };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((p) => p.map((r) => simplifyRing(r, tolerance))),
    };
  }
  return geometry;
}

/** Count coordinates in a geometry — used to report what simplification
 *  actually bought, so the constant can be tuned against a real number
 *  rather than a feeling. */
export function countCoordinates(geometry) {
  const c = geometry?.coordinates;
  if (!c) return 0;
  let n = 0;
  const walk = (a) => {
    if (!Array.isArray(a)) return;
    if (typeof a[0] === 'number') { n++; return; }
    for (const x of a) walk(x);
  };
  walk(c);
  return n;
}
