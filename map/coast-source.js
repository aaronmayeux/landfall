/**
 * coast-source.js — coastline rings from the basemap, for tracing against.
 *
 * THIS FILE IS THE ONLY SCHEMA-AWARE PART OF THE TRACER. Everything
 * downstream in coast-trace.js is pure [lon, lat] math and never learns which
 * basemap it came from. That split is deliberate: flipping TILES.useR2
 * changes the answer here and nothing else, the same one-line-flip promise
 * style-dark.js already makes.
 *
 * TWO SCHEMAS, INVERTED — the same inversion style-dark.js documents:
 *   OpenMapTiles (OpenFreeMap) has NO land polygon. The coast is the edge of
 *     the `water` fill, filtered to class=ocean.
 *   Protomaps has a real `earth` layer. The coast is the edge of the land.
 * Same shoreline either way; only the name and filter differ.
 *
 * WINDING DIRECTION IS NEVER ASSUMED. Because one schema hands us ocean and
 * the other hands us land, the two may wind opposite ways. Nothing here (or
 * downstream) depends on winding: the walk in coast-trace.js tries both
 * directions and keeps the shorter. That is why flipping to R2 does not need
 * a sign flip or a flag.
 *
 * ONLY LOADED TILES ARE VISIBLE. querySourceFeatures returns geometry for
 * tiles currently in the source cache — pan away and vertices vanish. That is
 * a real limit, not a bug to code around, and it is why the caller caches its
 * best result rather than trusting any single query.
 *
 * Imports: config/ only. No DOM.
 */

import { COAST_TRACE } from '../config/constants.js';

const SOURCE = 'basemap';

/** Ordered by preference. Protomaps first so that once R2 is live it wins
 *  without a flag — the presence of a real `earth` layer IS the signal. */
const SCHEMAS = Object.freeze([
  { schema: 'protomaps', sourceLayer: 'earth', filter: null },
  {
    schema: 'openmaptiles',
    sourceLayer: 'water',
    filter: ['==', ['get', 'class'], 'ocean'],
  },
]);

/** Every [lon, lat] ring in a GeoJSON geometry. Lines stay as-is; polygons
 *  contribute each ring (outer and holes alike — an island in a lake is still
 *  coastline). */
function ringsOf(geometry) {
  if (!geometry) return [];
  const { type, coordinates } = geometry;
  if (type === 'LineString') return [coordinates];
  if (type === 'MultiLineString') return coordinates;
  if (type === 'Polygon') return coordinates;
  if (type === 'MultiPolygon') return coordinates.flat();
  return [];
}

/**
 * Pull coastline rings from whatever the basemap currently has loaded.
 *
 * @returns {{schema: string|null, rings: Array<Array<[number,number]>>, vertexCount: number}}
 *   `schema` is null when nothing answered — the honest "no substrate" state
 *   the caller must treat as `unavailable`, never as "no coastline here".
 */
export function coastRings(map) {
  if (!map?.querySourceFeatures) return { schema: null, rings: [], vertexCount: 0 };

  for (const s of SCHEMAS) {
    let feats;
    try {
      const opts = { sourceLayer: s.sourceLayer };
      if (s.filter) opts.filter = s.filter;
      feats = map.querySourceFeatures(SOURCE, opts);
    } catch {
      /* The source-layer does not exist on this schema. Not an error —
       * it is how we detect which basemap is live. */
      continue;
    }
    if (!feats?.length) continue;

    const rings = [];
    let vertexCount = 0;
    for (const f of feats) {
      for (const ring of ringsOf(f.geometry)) {
        /* Two points is a tile-edge stub, not coastline. */
        if (ring.length < 3) continue;
        rings.push(ring);
        vertexCount += ring.length;
      }
    }

    if (vertexCount >= COAST_TRACE.minCoastVertices) {
      return { schema: s.schema, rings, vertexCount };
    }
  }

  return { schema: null, rings: [], vertexCount: 0 };
}
