/**
 * smooth.js — Chaikin corner-cutting for GeoJSON polygon rings.
 *
 * Built for NHC's wind swath, which arrives rasterized: the polygons are
 * traced off a grid, so every boundary is a staircase of right angles at a
 * fixed cell size. The shape is right; the outline is quantized.
 *
 * HOW CHAIKIN WORKS, in one line: walk each edge and replace its two endpoints
 * with points a quarter and three-quarters of the way along it. Corners get
 * cut off. Repeat, and the staircase dissolves into a curve.
 *
 * WHY THIS AND NOT A SPLINE. Chaikin's displacement is BOUNDED — every new
 * point lies on an edge of the original ring, so no vertex can travel further
 * than one edge length from the shape. A Catmull-Rom or B-spline through the
 * same points has no such bound: it overshoots tight corners by an amount
 * that depends on the neighbours, and on a staircase of right angles that
 * overshoot is large and unpredictable.
 *
 * CHAIKIN IS NOT PURELY INWARD, and an earlier version of this file claimed
 * it was. Corner-cutting shrinks CONVEX corners but bulges into CONCAVE ones
 * — and a staircase alternates between the two, so roughly half the corners
 * move outward. Total area drops, which makes an area check pass while the
 * boundary is leaking. Measured: 92 of 193 vertices landed outside the raw
 * ring, up to 9 nm out on a 0.1° grid.
 *
 * That direction is not acceptable here. Drawing inside NHC's extent
 * understates the edge of the hazard; drawing outside CLAIMS hurricane-force
 * wind where NHC claims none (SPEC §6 — safety colors on a safety layer). So
 * the smoothed ring is CLIPPED back: any vertex that ends up outside the
 * original polygon is pulled to the nearest point on it. The result is smooth
 * where smoothing is safe and pinned to the raw boundary where it is not.
 *
 * LONGITUDE IS NOT WRAPPED HERE. Averaging two points either side of the
 * antimeridian would swing a vertex halfway around the planet. Rings that
 * cross it are detected and passed through raw — see smoothRing. Rare for a
 * single storm's swath, catastrophic when it happens, cheap to check.
 *
 * Pure functions, no DOM, no map. Imports: config/ only.
 */

import { WIND_SMOOTH } from '../config/constants.js';

/** Longitude span beyond which a ring is assumed to cross the antimeridian.
 *  A real swath is a few degrees wide; a ring reported as spanning more than
 *  half the planet has wrapped, not grown. */
const WRAP_SPAN_DEG = 180;

/** Does this ring cross the antimeridian? Checked on the raw coordinates,
 *  before any averaging can corrupt them. */
function crossesAntimeridian(ring) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of ring) {
    if (p[0] < min) min = p[0];
    if (p[0] > max) max = p[0];
  }
  return max - min > WRAP_SPAN_DEG;
}

/**
 * One Chaikin pass over a CLOSED ring.
 *
 * The ring is treated as cyclic — the last vertex connects back to the first
 * — so the seam is smoothed like any other corner rather than staying a hard
 * point. GeoJSON repeats the first coordinate as the last to close the ring;
 * that duplicate is dropped on the way in and re-added on the way out, or it
 * would be smoothed as if it were a real vertex sitting on top of another.
 */
function chaikinOnce(ring, ratio) {
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    out.push([x1 + (x2 - x1) * ratio, y1 + (y2 - y1) * ratio]);
    out.push([x1 + (x2 - x1) * (1 - ratio), y1 + (y2 - y1) * (1 - ratio)]);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * CONTAINMENT — keep the smoothed ring inside the raw one
 * ------------------------------------------------------------------------- */

/** Even-odd point-in-ring test. */
function pointInRing(pt, ring) {
  const px = pt[0];
  const py = pt[1];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Nearest point to `pt` on the segment a–b. */
function nearestOnSegment(pt, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return a;
  let t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [a[0] + t * dx, a[1] + t * dy];
}

/** Nearest point to `pt` anywhere on the ring's boundary. */
function nearestOnRing(pt, ring) {
  let best = ring[0];
  let bestD = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const q = nearestOnSegment(pt, ring[i], ring[i + 1]);
    const d = (q[0] - pt[0]) ** 2 + (q[1] - pt[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/**
 * Pull any vertex that escaped the raw ring back onto its boundary.
 *
 * Vertices already inside are left alone — those are the corner cuts doing
 * their job. Only the concave-corner bulges get pinned, so the outline stays
 * smooth along the long runs and goes tight exactly where it would otherwise
 * overclaim.
 */
function clipToRing(smoothed, raw) {
  return smoothed.map((p) => (pointInRing(p, raw) ? p : nearestOnRing(p, raw)));
}

/**
 * Smooth one ring. Returns the ring unchanged when smoothing would do harm
 * rather than good:
 *  - too few points: no staircase to remove, and cutting corners off a
 *    triangle collapses it toward its centroid.
 *  - too many points: the doubling would cost frames on a phone. Jagged and
 *    honest beats smooth and stuttering (§9 — feel is the overriding lens).
 *  - crosses the antimeridian: averaging across the seam would fling
 *    vertices across the planet.
 */
export function smoothRing(ring, opts = WIND_SMOOTH) {
  if (!Array.isArray(ring) || ring.length < opts.minRingPoints) return ring;
  if (ring.length > opts.maxRingPoints) return ring;

  /* Drop GeoJSON's closing duplicate before treating the ring as cyclic. */
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1];
  let work = closed ? ring.slice(0, -1) : ring.slice();

  if (work.length < opts.minRingPoints) return ring;
  if (crossesAntimeridian(work)) return ring;

  for (let i = 0; i < opts.iterations; i++) work = chaikinOnce(work, opts.ratio);

  /* Pin the concave-corner bulges back to the raw boundary. Done ONCE after
   * all iterations rather than between them: clipping mid-way would feed
   * pinned vertices back into the next pass and re-round the very corners
   * that were just tightened. */
  work = clipToRing(work, ring);

  /* Re-close. A polygon ring that does not return to its start is invalid
   * GeoJSON and MapLibre will not fill it. */
  work.push([work[0][0], work[0][1]]);
  return work;
}

/**
 * Smooth every ring of a Polygon or MultiPolygon geometry, holes included —
 * a hole with a staircase edge is as visible as an outer boundary with one.
 *
 * Any other geometry type is returned untouched rather than throwing: the
 * caller feeds it whatever NHC published, and a LineString arriving on a
 * polygon layer should draw raw, not blow up the layer (§5).
 */
export function smoothGeometry(geometry, opts = WIND_SMOOTH) {
  if (!geometry) return geometry;

  if (geometry.type === 'Polygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((r) => smoothRing(r, opts)),
    };
  }

  if (geometry.type === 'MultiPolygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((poly) =>
        poly.map((r) => smoothRing(r, opts))
      ),
    };
  }

  return geometry;
}

/** Smooth a whole feature, leaving its properties alone. */
export function smoothFeature(feature, opts = WIND_SMOOTH) {
  if (!feature?.geometry) return feature;
  return { ...feature, geometry: smoothGeometry(feature.geometry, opts) };
}
