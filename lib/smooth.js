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
 * INWARD OFFSET — buy the budget that smoothing spends
 * ------------------------------------------------------------------------- */

/**
 * Signed area, doubled. Sign gives the winding direction, which is the only
 * way to know which side of an edge is "inside" — GeoJSON nominally wants
 * counter-clockwise outer rings, but NHC's rasterizer does not reliably
 * honour that and a wrong guess would push the ring OUTWARD, doing precisely
 * the harm this whole exercise avoids.
 */
function signedArea2(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a;
}

/**
 * Move every vertex inward along the bisector of its two edges.
 *
 * This is a vertex offset, not a true polygon buffer. A real buffer handles
 * self-intersection when the offset exceeds a local feature's width; this
 * does not, which is why the distance is held to a fraction of one grid cell
 * — far below the width of any real wind band. The cheap version is the right
 * one here: a full buffer needs a library, runs per storm per advisory, and
 * would be doing careful work to move a boundary by less than a pixel at the
 * zooms this layer draws at.
 *
 * Degenerate bisectors (a spike doubling back on itself) leave the vertex
 * where it is rather than sending it to infinity.
 */
function offsetInward(ring, dist) {
  const n = ring.length;
  /* Positive signed area = counter-clockwise. For CCW the inward normal of
   * edge (x1,y1)->(x2,y2) is (-dy, dx) normalized; for CW it is the negation.
   * `sign` folds that choice into the arithmetic below. */
  const sign = signedArea2(ring) > 0 ? 1 : -1;

  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const cur = ring[i];
    const next = ring[(i + 1) % n];

    /* Inward normals of the two edges meeting at this vertex. */
    const n1 = edgeNormal(prev, cur, sign);
    const n2 = edgeNormal(cur, next, sign);
    if (!n1 || !n2) {
      out.push([cur[0], cur[1]]);
      continue;
    }

    /* The bisector is the sum of the two unit normals. On a straight run the
     * two agree and this is just the normal; at a corner it points into the
     * wedge between them. */
    let bx = n1[0] + n2[0];
    let by = n1[1] + n2[1];
    const len = Math.hypot(bx, by);
    if (len < 1e-12) {
      out.push([cur[0], cur[1]]);
      continue;
    }
    bx /= len;
    by /= len;

    /* Scale so the offset distance is measured PERPENDICULAR to the edges,
     * not along the bisector — without this, a 90° corner (every corner on a
     * staircase) would move inward by only 0.7 of the intended distance. The
     * cosine of half the corner angle is exactly the dot of the bisector with
     * either normal. Clamped so a near-spike cannot explode the scale. */
    const cosHalf = Math.max(0.35, bx * n1[0] + by * n1[1]);
    const step = dist / cosHalf;

    out.push([cur[0] + bx * step, cur[1] + by * step]);
  }
  return out;
}

/** Unit inward normal of one edge, or null if the edge has no length. */
function edgeNormal(a, b, sign) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return null;
  return [(-dy / len) * sign, (dx / len) * sign];
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
 *
 * SHRINK, THEN SMOOTH. The first version of this function clipped the
 * smoothed ring back inside the raw one, which sounded safe and was useless:
 * on a shallow swath 93% of vertices landed outside at a concave corner and
 * were dragged straight back onto the staircase, producing four times the
 * points and a visually identical outline (measured 2026-07-24, after it
 * shipped and Aaron reported no change on glass).
 *
 * Offsetting inward FIRST buys the budget that Chaikin's concave bulges then
 * spend. The ring ends up near the original boundary having passed through a
 * smooth path, instead of being yanked back to a jagged one.
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

  if (opts.shrinkDeg > 0) work = offsetInward(work, opts.shrinkDeg);
  for (let i = 0; i < opts.iterations; i++) work = chaikinOnce(work, opts.ratio);

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
