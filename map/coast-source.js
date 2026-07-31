/**
 * coast-source.js — coastline rings from the basemap, for band-selecting
 * against (map/coast-band.js).
 *
 * THIS FILE IS THE ONLY SCHEMA-AWARE PART OF THE PIPELINE. Everything
 * downstream in coast-band.js is pure [lon, lat] math and never learns which
 * basemap it came from. That split is deliberate: flipping TILES.useR2
 * changes the answer here and nothing else, the same one-line-flip promise
 * style.js already makes.
 *
 * TWO SCHEMAS, INVERTED — the same inversion style.js documents:
 *   OpenMapTiles (OpenFreeMap) has NO land polygon. The coast is the edge of
 *     the `water` fill, filtered to class=ocean.
 *   Protomaps has a real `earth` layer. The coast is the edge of the land.
 * Same shoreline either way; only the name and filter differ.
 *
 * WINDING DIRECTION IS NEVER ASSUMED — because nothing depends on it. The
 * band select asks only whether a segment is inside the corridor, so ocean
 * rings and land rings answer identically. Flipping to R2 needs no sign flip
 * or flag. (This also removed the walk tracer's split-landmass failure: a
 * schema that fragments the coast into separate rings just yields more rings
 * to select from.)
 *
 * ONLY LOADED TILES ARE VISIBLE. querySourceFeatures returns geometry for
 * tiles currently in the source cache — pan away and vertices vanish. That is
 * a real limit, not a bug to code around, and it is why the caller caches its
 * best result rather than trusting any single query.
 *
 * ==> THE ANSWER IS MEMOIZED, KEYED ON A SUBSTRATE GENERATION <==
 *
 * `querySourceFeatures` re-decodes every loaded basemap tile on the main
 * thread, and this was being called fresh on every band select — several times
 * per tap once the layer engine's redundant re-merges are counted. Measured as
 * the second half of the 320 ms map-canvas INP.
 *
 * The rings can only change when the tile set does, so a counter bumped by the
 * map's own `sourcedata` and `styledata` events is an exact invalidation
 * signal, not a guess. Between two bumps the decoded rings are literally the
 * same answer, so serving the memo is not a staleness tradeoff — it is
 * skipping work that would produce the identical result. `coastGeneration()`
 * exposes the counter so callers can ask "has the coast moved?" without paying
 * for a decode to find out (map/coast-band-cache.js does exactly that).
 *
 * Per-map, in a WeakMap: a `setStyle` builds a new map object in some flows
 * and a stale memo keyed globally would outlive the vertices it describes.
 *
 * Imports: config/ only. No DOM.
 */

import { COAST_BAND } from '../config/constants.js';

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

const NOTHING = Object.freeze({ schema: null, rings: [], vertexCount: 0 });

/** map -> { gen, memo, memoGen }. Weak so a discarded map takes its rings with
 *  it; the ring arrays are the largest thing this module holds. */
const state = new WeakMap();

/** Per-map memo state, wiring the invalidation listeners on first use.
 *  Listeners are attached once per map and never removed — the map outlives
 *  this module, and a listener that only increments an integer is cheaper than
 *  the bookkeeping to take it off again. */
function stateFor(map) {
  let st = state.get(map);
  if (st) return st;

  st = { gen: 1, memo: null, memoGen: 0, polyMemo: null, polyMemoGen: 0 };
  state.set(map, st);

  if (typeof map.on === 'function') {
    /* Tiles arriving or being evicted is exactly when the answer changes. This
     * fires often DURING a pan and not at all once the camera settles, which is
     * the shape we want: the memo is live precisely when taps happen. */
    map.on('sourcedata', (e) => {
      if (e?.sourceId === SOURCE) st.gen++;
    });
    /* A restyle replaces the source outright — and can swap the schema under
     * us, which is the one change a tile-level signal would miss. */
    map.on('styledata', () => { st.gen++; });
  }
  return st;
}

/**
 * How many times the loaded coastline could have changed on this map.
 *
 * A CHEAP IDENTITY, NOT A MEASUREMENT. It answers "is this the same substrate
 * my last answer came from" without decoding a single tile, which is what lets
 * a caller holding a good result skip the whole pipeline.
 */
export function coastGeneration(map) {
  if (!map?.querySourceFeatures) return 0;
  return stateFor(map).gen;
}

/**
 * Pull coastline rings from whatever the basemap currently has loaded.
 *
 * Memoized per generation — see the header. The returned object is SHARED
 * between callers within a generation, so nobody may mutate it.
 *
 * @returns {{schema: string|null, rings: Array<Array<[number,number]>>, vertexCount: number}}
 *   `schema` is null when nothing answered — the honest "no substrate" state
 *   the caller must treat as `unavailable`, never as "no coastline here".
 */
export function coastRings(map) {
  if (!map?.querySourceFeatures) return NOTHING;

  const st = stateFor(map);
  if (st.memo && st.memoGen === st.gen) return st.memo;

  const out = decodeRings(map);
  st.memo = out;
  st.memoGen = st.gen;
  return out;
}

/** The actual tile walk. Split out so the memo above reads as one decision. */
function decodeRings(map) {
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

    if (vertexCount >= COAST_BAND.minCoastVertices) {
      return { schema: s.schema, rings, vertexCount };
    }
  }

  return NOTHING;
}

/* ===========================================================================
 * THE SAME TILES, WITH THEIR POLYGON STRUCTURE LEFT INTACT
 *
 * ==> `coastRings()` ABOVE FLATTENS, AND FLATTENING IS RIGHT FOR ITS CALLER
 * AND WRONG FOR A FILL. <== A band select asks "is this segment inside a
 * corridor", so an outer ring and the hole punched through it are both just
 * coastline and the distinction costs nothing to lose. A MASK has to FILL these
 * shapes, and there the distinction is the whole thing: an island inside an
 * ocean polygon arrives as an inner ring, and a filler that cannot tell it from
 * an outer ring paints straight over the island.
 *
 * So this is a second decode rather than a flag on the first. The two answer
 * different questions and neither should grow a mode switch to pretend
 * otherwise.
 * ======================================================================== */

const NO_POLYGONS = Object.freeze({ schema: null, polygons: [], ringCount: 0, vertexCount: 0 });

/** Every polygon in a geometry, as an array of rings — outer first, then its
 *  holes, which is the GeoJSON ordering. Lines cannot be filled and are
 *  dropped: a `LineString` coast has no inside. */
function polygonsOf(geometry) {
  if (!geometry) return [];
  const { type, coordinates } = geometry;
  if (type === 'Polygon') return [coordinates];
  if (type === 'MultiPolygon') return coordinates;
  return [];
}

/**
 * Coastline polygons from whatever the basemap currently has loaded, with each
 * polygon's rings still grouped.
 *
 * Memoized per generation on its own slot, so asking for polygons does not
 * throw away a caller's ring memo or vice versa.
 *
 * ==> `schema` IS THE POLARITY AND THE CALLER MUST READ IT. <== On
 * `openmaptiles` these polygons are the OCEAN; on `protomaps` they are the
 * LAND. Same shoreline, opposite fill. Assuming either one is how the second
 * shoreline attempt painted water exactly where the island was.
 *
 * @returns {{schema: string|null, polygons: Array<Array<Array<[number,number]>>>,
 *            ringCount: number, vertexCount: number}}
 *   `schema` is null when nothing answered — the honest "no substrate" state,
 *   which a caller must treat as `unavailable` and NEVER as "no land here".
 */
export function coastPolygons(map) {
  if (!map?.querySourceFeatures) return NO_POLYGONS;

  const st = stateFor(map);
  if (st.polyMemo && st.polyMemoGen === st.gen) return st.polyMemo;

  const out = decodePolygons(map);
  st.polyMemo = out;
  st.polyMemoGen = st.gen;
  return out;
}

function decodePolygons(map) {
  for (const s of SCHEMAS) {
    let feats;
    try {
      const opts = { sourceLayer: s.sourceLayer };
      if (s.filter) opts.filter = s.filter;
      feats = map.querySourceFeatures(SOURCE, opts);
    } catch {
      continue;
    }
    if (!feats?.length) continue;

    const polygons = [];
    let ringCount = 0;
    let vertexCount = 0;
    for (const f of feats) {
      for (const poly of polygonsOf(f.geometry)) {
        const kept = [];
        for (const ring of poly) {
          /* Under three points there is no area to fill. */
          if (ring.length < 3) continue;
          kept.push(ring);
          vertexCount += ring.length;
        }
        if (!kept.length) continue;
        polygons.push(kept);
        ringCount += kept.length;
      }
    }

    /* The same floor the ring decode uses. A handful of vertices is a corner of
     * one tile, not a coastline, and a mask built from it would cut the sea
     * away from most of the world. */
    if (vertexCount >= COAST_BAND.minCoastVertices) {
      return { schema: s.schema, polygons, ringCount, vertexCount };
    }
  }

  return NO_POLYGONS;
}
