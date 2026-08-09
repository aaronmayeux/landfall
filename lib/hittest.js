/**
 * hittest.js — is this point inside that shape, and how far is it from it?
 *
 * ONE POINT — HOME — AGAINST OFFICIAL GEOMETRY. Everything the home panel says
 * about surge, watches and warnings, and wind arrival reduces to two questions
 * asked of a published shape: is home inside it, and if not, how far away is
 * it. Both live here so there is one implementation and one set of traps.
 *
 * WHY THIS IS NOT map/coast-band.js. That file asks a DIFFERENT question about
 * the same warning line: which coastline segments fall inside a 50 km corridor,
 * with flat end caps, so a warning paints the bays inside it. It answers
 * membership for a whole set of segments and deliberately never computes a
 * distance. Here there is one point and the distance IS the answer — "nearest
 * Hurricane Warning, 41 mi" is the sentence. Two questions, two files; sharing
 * one would mean bending the corridor's end-cap rule around a caller that does
 * not want it.
 *
 * THREE TRAPS, ALL HANDLED HERE SO NO CALLER HAS TO:
 *
 * 1. THE ANTIMERIDIAN. A West Pacific warning line runs 178E, 179E, -179E. Any
 *    test that subtracts raw longitudes reads that last step as 358 degrees of
 *    travel — most of the planet — and returns a confident wrong answer. Every
 *    vertex is shifted to within 180 degrees of the TEST POINT before use,
 *    which makes the whole calculation local and the wrap disappear.
 * 2. HOLES. A GeoJSON Polygon's first ring is the outer boundary and every ring
 *    after it is a hole. A surge band with a pocket of high ground inside it
 *    has holes, and treating them as more outer rings would report a home
 *    standing in the hole as inside the band. Rings after the first FLIP.
 * 3. LATITUDE SQUEEZE. A degree of longitude is 111 km at the equator and 55 km
 *    at 60N. Planar math without a cos(lat) factor overstates east-west
 *    distance by that ratio — at Gulf latitudes, 15%.
 *
 * NOTHING HERE IS APPROXIMATE IN THE WAY THAT MATTERS. The planar reduction is
 * exact enough because every distance asked of it is tens of nautical miles
 * over geometry published at roughly 1 km resolution; a great-circle segment
 * solve would change no sentence on screen. What it is NOT is scale-free — do
 * not reach for `nmToGeometry` to measure a storm 2,000 nm away. The planar
 * pass only picks WHICH segment is nearest; the number returned is measured by
 * `greatCircleNm`, so this file and the rest of the app cannot disagree.
 *
 * Pure. Imports lib/ only. No DOM, no fetch, no config.
 */

import { greatCircleNm } from './geo.js';

const DEG_TO_RAD = Math.PI / 180;

/** Shift `lon` to within 180 degrees of `ref` — the antimeridian fix (trap 1).
 *  Applied to every vertex against the test point rather than the reverse,
 *  because a shape can legitimately straddle the line and a point never does. */
export function unwrapLon(lon, ref) {
  let d = lon - ref;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return ref + d;
}

/* ---------------------------------------------------------------------------
 * INSIDE
 * ------------------------------------------------------------------------- */

/**
 * Crossing-number test of one ring, in unwrapped longitude.
 *
 * The `(yi > y) !== (yj > y)` form is deliberate and is why this is not written
 * the obvious way: it counts a vertex exactly AT the test latitude once rather
 * than zero or twice, so a point level with a ring vertex returns a stable
 * answer instead of one that flips with the ring's winding. Coastal geometry
 * has thousands of vertices; a home level with one is not a rare case.
 */
function ringContains(ring, lon, lat) {
  const n = Array.isArray(ring) ? ring.length : 0;
  if (n < 3) return false;

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = unwrapLon(ring[i][0], lon);
    const yi = ring[i][1];
    const xj = unwrapLon(ring[j][0], lon);
    const yj = ring[j][1];

    if ((yi > lat) !== (yj > lat)) {
      const t = (lat - yi) / (yj - yi);
      if (lon < xi + t * (xj - xi)) inside = !inside;
    }
  }
  return inside;
}

/** One Polygon's rings: outer, then holes that flip the answer (trap 2). */
function polygonContains(rings, lon, lat) {
  if (!Array.isArray(rings) || !rings.length) return false;
  if (!ringContains(rings[0], lon, lat)) return false;
  for (let r = 1; r < rings.length; r++) {
    if (ringContains(rings[r], lon, lat)) return false;
  }
  return true;
}

/**
 * Is [lon, lat] inside this GeoJSON geometry?
 *
 * Polygon and MultiPolygon only. A point is never "inside" a line, and asking
 * returns false rather than throwing — a caller handing this a mixed
 * FeatureCollection should get a clean miss on the lines, not a crash on one
 * feature (SPEC section 5).
 */
export function pointInGeometry(lon, lat, geometry) {
  if (!geometry || !Number.isFinite(lon) || !Number.isFinite(lat)) return false;

  if (geometry.type === 'Polygon') {
    return polygonContains(geometry.coordinates, lon, lat);
  }
  if (geometry.type === 'MultiPolygon') {
    for (const rings of geometry.coordinates || []) {
      if (polygonContains(rings, lon, lat)) return true;
    }
  }
  return false;
}

/**
 * The first feature whose geometry contains the point, or null. Order is the
 * CALLER's — features are tested as given, so a caller wanting the severest hit
 * sorts before calling rather than hoping.
 */
export function featureContaining(lon, lat, features) {
  for (const f of features || []) {
    if (pointInGeometry(lon, lat, f && f.geometry)) return f;
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * HOW FAR
 * ------------------------------------------------------------------------- */

/**
 * Squared perpendicular distance to one segment, in degrees of latitude, with
 * longitude squeezed by cos(lat) (trap 3).
 *
 * Squared and in degrees on purpose: this runs over every segment of every
 * feature, and a square root plus a great-circle call per segment is thousands
 * of transcendental functions to answer one question. The winner is re-measured
 * properly at the end, so the cheap comparison never reaches the screen.
 */
function segDist2(px, py, ax, ay, bx, by, kx) {
  const dx = (bx - ax) * kx;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;

  let t = 0;
  if (len2 > 0) {
    t = ((px - ax) * kx * dx + (py - ay) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }

  const qx = ax + (bx - ax) * t;
  const qy = ay + (by - ay) * t;
  const ex = (px - qx) * kx;
  const ey = py - qy;
  return { d2: ex * ex + ey * ey, lon: qx, lat: qy };
}

/** Every coordinate path in a geometry, as arrays of [lon, lat]. A Polygon
 *  contributes its rings — the distance to a polygon a point is OUTSIDE is the
 *  distance to its boundary, which is what "how far is the nearest surge band"
 *  means. */
function paths(geometry) {
  if (!geometry) return [];
  const c = geometry.coordinates;
  switch (geometry.type) {
    case 'Point': return [[c]];
    case 'MultiPoint':
    case 'LineString': return [c];
    case 'MultiLineString':
    case 'Polygon': return c || [];
    case 'MultiPolygon': return (c || []).flat();
    default: return [];
  }
}

/**
 * Nearest distance from [lon, lat] to a geometry, in NAUTICAL MILES, with the
 * point on the geometry that answered.
 *
 * ZERO WHEN INSIDE. A point inside a polygon is not "some distance from the
 * boundary" in any sentence this app says — it is in the band. Returning the
 * boundary distance would let a caller print "surge band 2 mi away" about a
 * home standing in one.
 *
 * @returns {{nm:number, lon:number, lat:number}|null} null when the geometry
 *          carries nothing measurable — "cannot say", not "far away".
 */
export function nmToGeometry(lon, lat, geometry) {
  if (!geometry || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (pointInGeometry(lon, lat, geometry)) return { nm: 0, lon, lat };

  const kx = Math.cos(lat * DEG_TO_RAD);
  let best = null;

  for (const path of paths(geometry)) {
    if (!Array.isArray(path) || !path.length) continue;

    /* A single-coordinate path (a Point) has no segment; measure the vertex. */
    if (path.length === 1 || typeof path[0] === 'number') {
      const p = typeof path[0] === 'number' ? path : path[0];
      if (!Array.isArray(p) || !Number.isFinite(p[0])) continue;
      const x = unwrapLon(p[0], lon);
      const ex = (lon - x) * kx;
      const ey = lat - p[1];
      const d2 = ex * ex + ey * ey;
      if (!best || d2 < best.d2) best = { d2, lon: x, lat: p[1] };
      continue;
    }

    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      const hit = segDist2(lon, lat, unwrapLon(a[0], lon), a[1], unwrapLon(b[0], lon), b[1], kx);
      if (!best || hit.d2 < best.d2) best = hit;
    }
  }

  if (!best) return null;

  /* The real answer, on the sphere, from the one distance function the whole
   * app uses. The planar pass above only chose WHERE to measure. */
  return { nm: greatCircleNm(lon, lat, best.lon, best.lat), lon: best.lon, lat: best.lat };
}

/**
 * The nearest feature in a list, by `nmToGeometry`.
 * @returns {{feature, nm, lon, lat}|null}
 */
export function nearestFeature(lon, lat, features) {
  let best = null;
  for (const f of features || []) {
    const hit = nmToGeometry(lon, lat, f && f.geometry);
    if (!hit) continue;
    if (!best || hit.nm < best.nm) best = { feature: f, nm: hit.nm, lon: hit.lon, lat: hit.lat };
  }
  return best;
}
