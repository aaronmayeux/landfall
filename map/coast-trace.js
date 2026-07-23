/**
 * coast-trace.js — watch/warning segments re-cut against the drawn coastline.
 *
 * THE SETTLED DESIGN (SPEC §7): trace each segment against the coastline
 * basemap so a warning covering Tampa Bay follows the bay instead of chording
 * across open water; traced segments smooth with the coast; untraced segments
 * draw straight, FLAGGED — official geometry isn't ours to curve.
 *
 * AS-BUILT, PHASE 4: this module is the seam, and it currently passes
 * segments through untraced. Reason, so nobody "finishes" it blind:
 *
 *   Tracing means re-cutting against THE SAME VERTICES AS THE DRAWN COAST.
 *   The drawn coast today is OpenFreeMap scaffolding (OpenMapTiles schema),
 *   which has NO land polygon — land is the background and the coast is the
 *   edge of the `water` fill, reachable only via per-tile queries of whatever
 *   happens to be loaded. The Protomaps basemap that §7 names as the tracing
 *   substrate is not live yet (TILES.useR2 = false; the .pmtiles file is
 *   still unbuilt, §14 Phase 1). Tracing against the wrong vertices — e.g.
 *   the baked planet-band rings in map/coastline.js, which never match the
 *   basemap's shoreline at z7–8 — reintroduces the exact "stripe peels off
 *   the shoreline" failure the trace exists to fix.
 *
 *   Meanwhile the MapServer delivers the segments as NHC's own line geometry,
 *   which may or may not chord across bays — unverifiable from a dev sandbox
 *   that cannot reach NOAA. Drawing that geometry as delivered, flagged
 *   untraced, IS the fallback path §7 defines. Verify on glass with a live
 *   storm; the trace pass lands with the real basemap.
 *
 * Imports: nothing. Pure.
 */

/**
 * @param {Array} features  watch/warning GeoJSON features
 * @returns {{features: Array, traced: boolean}}  traced=false → the stripe
 *   is NHC's delivered geometry, drawn straight where NHC drew it straight.
 */
export function traceSegments(features) {
  return { features: features || [], traced: false };
}
