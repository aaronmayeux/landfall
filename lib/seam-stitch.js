/**
 * seam-stitch.js — a shape the SOURCE cut in half at ±180, put back together.
 *
 * ==> WHY THIS EXISTS AS ITS OWN FILE. <== Nothing in `lib/` owned the
 * question "did this polygon arrive whole?". Every consumer downstream —
 * measuring the cone, curving it for drawing, deciding whether it can be
 * swept — assumed it did, and each of them went wrong in a DIFFERENT way when
 * it had not. Putting the repair in any one of them would have fixed that
 * one and left the others reasoning about half a shape.
 *
 * ==> WHAT THE SOURCE ACTUALLY DOES. <== NHC's MapServer serves geometry
 * wrapped into (−180, 180], so a cone that crosses the antimeridian cannot be
 * one polygon: it is CUT along the meridian and returned as a `MultiPolygon`
 * whose two parts each carry a straight artificial edge down the seam. Lala
 * CP012026 advisory 33: 1,332 points spanning −180.00 to −170.58, and 191
 * points spanning 178.78 to 180.00. The two seam edges are the SAME edge —
 * both run between latitude 37.8069 and latitude 33.9638, to ten decimal
 * places. That exactness is what makes this a stitch rather than a union.
 *
 * ==> AND WHY LEAVING IT CUT LOOKED BROKEN. <== Two separate failures, both
 * seen on glass 2026-08-20:
 *
 *   1. `lib/cone-smooth.js` `curveGeometry` thins each ring to knots and puts
 *      arcs back between them. Run over a ring with an artificial straight
 *      edge, it ROUNDS THAT EDGE like any other corner — so the western half
 *      bulged to −180.24 and the eastern half to +180.22, each pushing a
 *      curved nose across the meridian into the other's ground. Two lens
 *      shapes overlapping down the middle of the cone.
 *   2. The cone is drawn with a fill AND an outline (`map/layers/cone.js`).
 *      The outline strokes every ring it is given, so both artificial seam
 *      edges were drawn as real cone edges — a hard line down the centre of a
 *      shape that has no edge there at all.
 *
 * Stitched, there is no artificial edge to round and none to stroke. The
 * result is also a single Polygon again, so the cone rebuild is offered the
 * shape it was designed for instead of being turned away at the door.
 *
 * ==> THE OUTPUT IS UNWRAPPED, AND THAT IS THE APP'S CONVENTION, NOT A BUG.
 * <== `lib/trackline.js` already emits the track past ±180 so MapLibre draws
 * one continuous line across the seam; a station at 178°E is carried as −182.
 * The stitched ring follows the same rule — Lala's eastern half comes back as
 * −181.22 to −180.00 — which is exactly what makes it one shape rather than
 * two on opposite rims of the map.
 *
 * Imports: nothing. No DOM, no network, no clock, no map, no config.
 */

/** How close to ±180 a vertex must sit to count as ON the cut. The sources
 *  land within 1e-9 of it; this is loose enough for a reprojection to have
 *  rounded and far tighter than any real cone edge comes to the meridian
 *  without actually touching it. */
const SEAM_EPS = 1e-4;

/** How close two seam edges' latitudes must be to be judged the same edge.
 *  Deliberately tighter than a cone is ever thin: these are two halves of one
 *  cut, so they agree to the precision the source published, and anything
 *  looser would start joining shapes that merely both touch the meridian. */
const LAT_EPS = 1e-4;

const onSeam = (pt) => Math.abs(Math.abs(pt[0]) - 180) <= SEAM_EPS;

/** A ring without its closing duplicate, so index arithmetic is not off by
 *  one at the wrap. */
function open(ring) {
  const n = ring.length;
  if (n > 1) {
    const a = ring[0];
    const b = ring[n - 1];
    if (Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12) {
      return ring.slice(0, n - 1);
    }
  }
  return ring.slice();
}

/**
 * The ring re-cut so the artificial seam edge is removed, or null if it has
 * none.
 *
 * Returns the remaining points as an OPEN path whose two ends are the seam
 * edge's endpoints — the shape of the half without the lid on it.
 */
function cutOpen(ring) {
  const pts = open(ring);
  const n = pts.length;
  if (n < 4) return null;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (!onSeam(a) || !onSeam(b)) continue;
    /* ==> A ZERO-LENGTH SEAM EDGE IS A TANGENT, NOT A CUT. <== A cone that
     * merely grazes the meridian has one vertex on it, and two consecutive
     * near-identical points there would otherwise read as an edge and get the
     * ring spliced open around nothing. */
    if (Math.abs(a[1] - b[1]) <= LAT_EPS) continue;
    /* Rotate so the path runs from the edge's far end all the way round to
     * its near end: [b, b+1, …, a]. */
    const path = [];
    for (let k = 0; k < n; k++) path.push(pts[(i + 1 + k) % n]);
    return { path, latStart: b[1], latEnd: a[1] };
  }
  return null;
}

const near = (x, y) => Math.abs(x - y) <= LAT_EPS;

/**
 * One polygon's rings, rejoined if the source cut them at ±180.
 *
 * Only OUTER rings are considered. A hole that straddles the meridian would
 * need the same treatment, and NHC has never published a cone with one — so
 * rather than write untested code for it, holes are carried through as they
 * arrived and this comment is the record that it was a decision.
 *
 * @param {Array} polygons  a MultiPolygon's coordinates
 * @returns {Array|null}    a single Polygon's coordinates, or null if these
 *                          parts are not two halves of one cut shape
 */
function stitchPolygons(polygons) {
  if (!Array.isArray(polygons) || polygons.length !== 2) return null;

  const cuts = polygons.map((poly) => cutOpen(poly?.[0] || []));
  if (!cuts[0] || !cuts[1]) return null;

  /* Put the second half on the first half's branch. A cut is a whole turn
   * apart by construction, so this is a shift of exactly ±360 rather than
   * anything measured. */
  const refLon = cuts[0].path[0][0];
  const otherLon = cuts[1].path[0][0];
  const shift = 360 * Math.round((refLon - otherLon) / 360);
  if (shift === 0) return null; // same side of the world — not a seam cut
  const moved = cuts[1].path.map((p) => [p[0] + shift, p[1]]);

  /* ==> THE TWO EDGES HAVE TO BE THE SAME EDGE. <== Both halves of one cut
   * carry the identical pair of latitudes; two unrelated polygons that happen
   * to touch the meridian do not. If they disagree, this is not a stitch and
   * the caller keeps what it was given. */
  const a = cuts[0];
  const b = { ...cuts[1], path: moved };
  let bPath;
  if (near(a.latEnd, b.latStart) && near(a.latStart, b.latEnd)) {
    bPath = b.path;
  } else if (near(a.latEnd, b.latEnd) && near(a.latStart, b.latStart)) {
    /* The halves were wound in opposite directions, so the second path runs
     * the wrong way round the join. Reversing it is what keeps the stitched
     * ring from tying a bow at the seam. */
    bPath = b.path.slice().reverse();
  } else {
    return null;
  }

  /* a.path ends at latEnd; b.path starts at the same point. Drop the
   * duplicate at each join so no zero-length segment survives into the
   * spline. */
  const ring = a.path.concat(bPath.slice(1, bPath.length - 1));
  ring.push(ring[0].slice());
  return [ring];
}

/**
 * A geometry whose antimeridian cut has been undone, or the geometry as it
 * arrived when there is nothing to undo.
 *
 * ==> IT NEVER THROWS AND NEVER RETURNS SOMETHING WORSE THAN ITS INPUT. <==
 * §5. Every path that cannot recognise a clean two-part cut hands the
 * original straight back, so a source that changes shape degrades to exactly
 * today's behaviour rather than to a blank cone.
 */
export function stitchDatelineSplit(geometry) {
  if (geometry?.type !== 'MultiPolygon') return geometry;
  const stitched = stitchPolygons(geometry.coordinates);
  if (!stitched) return geometry;
  return { type: 'Polygon', coordinates: stitched };
}
