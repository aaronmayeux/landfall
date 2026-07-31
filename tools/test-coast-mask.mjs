/**
 * test-coast-mask.mjs — THE TWO THINGS THAT KILLED THE LAST TWO SHORELINE CUTS.
 *
 * The mask itself needs a canvas and a GPU, so what is asserted here is the
 * part that has actually been wrong twice and is pure data:
 *
 *   1. POLARITY. OpenMapTiles publishes no land polygon — what comes back is
 *      the OCEAN. Protomaps has a real `earth` layer and what comes back is the
 *      LAND. Reading that backwards paints water exactly where the island is,
 *      which is precisely what the reverted attempt did.
 *   2. FAILING OPEN. No schema, too little coastline, a source that throws:
 *      every one of those must report "no answer" so the caller draws the sea
 *      unmasked. A mask that deleted the ocean because a tile was late would be
 *      a worse bug than the one it replaces, and it would look like a rendering
 *      fault rather than a data one.
 *
 * Also asserted: polygon holes survive the decode. A flattened ring list cannot
 * tell an island inside an ocean polygon from the ocean's own outline, and a
 * filler handed flat rings paints straight over the island.
 *
 * Run: node tools/test-coast-mask.mjs
 */

import { coastPolygons } from '../map/coast-source.js';
import { COAST_BAND } from '../config/constants.js';

let passed = 0;
let failed = 0;

function check(label, ok, note) {
  if (ok) {
    passed++;
    console.log('  ok   ' + label);
  } else {
    failed++;
    console.log('  FAIL ' + label + (note ? '   (' + note + ')' : ''));
  }
}

/** A ring of `n` points, closed, around a centre. Enough vertices to clear the
 *  decoder's own floor when asked to. */
function ring(cx, cy, r, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  out.push(out[0].slice());
  return out;
}

/** The smallest thing that behaves like a MapLibre map for this module: it has
 *  `querySourceFeatures`, and `on` so the memo can wire its listeners. */
function fakeMap(byLayer) {
  return {
    on() {},
    querySourceFeatures(_source, opts) {
      const layer = opts && opts.sourceLayer;
      if (!(layer in byLayer)) throw new Error('no such source-layer: ' + layer);
      return byLayer[layer];
    },
  };
}

function polyFeature(rings) {
  return { geometry: { type: 'Polygon', coordinates: rings } };
}

/** Big enough that ONE ring clears the decoder's vertex floor by itself, so a
 *  test meaning "enough coastline" does not accidentally sit under it. */
const BIG = COAST_BAND.minCoastVertices + 8;

console.log('\n== polarity is READ from the schema, never assumed ==');

{
  /* OpenMapTiles: the coast is the edge of the water fill. No `earth` layer at
   * all, so asking for one throws — which is how the decoder tells them apart. */
  const m = fakeMap({ water: [polyFeature([ring(0, 0, 1, BIG)])] });
  const r = coastPolygons(m);
  check('OpenMapTiles answers, and names itself', r.schema === 'openmaptiles', 'got ' + r.schema);
  check('and hands back a polygon to fill', r.polygons.length === 1);
}

{
  /* Protomaps: a real land polygon. It is tried FIRST, so when both would
   * answer the land schema wins — which is what makes flipping TILES.useR2 a
   * one-line change with no flag anywhere else. */
  const m = fakeMap({
    earth: [polyFeature([ring(0, 0, 1, BIG)])],
    water: [polyFeature([ring(0, 0, 1, BIG)])],
  });
  const r = coastPolygons(m);
  check('Protomaps wins when it is present', r.schema === 'protomaps', 'got ' + r.schema);
}

console.log('\n== holes survive, because a fill needs them ==');

{
  const outer = ring(0, 0, 10, BIG);
  const island = ring(0, 0, 2, BIG);
  const m = fakeMap({ water: [polyFeature([outer, island])] });
  const r = coastPolygons(m);
  check('one polygon, not two loose rings', r.polygons.length === 1, r.polygons.length + ' polygons');
  check('and it still carries both of its rings', r.polygons[0] && r.polygons[0].length === 2);
  check('ring count counts every ring', r.ringCount === 2, 'got ' + r.ringCount);
}

console.log('\n== it fails OPEN — an unknown is never a confident answer ==');

{
  const r = coastPolygons(null);
  check('no map at all -> no schema', r.schema === null);
  check('and no polygons, so the caller draws unmasked', r.polygons.length === 0);
}

{
  /* Neither source-layer exists: every schema throws. */
  const m = fakeMap({});
  const r = coastPolygons(m);
  check('every schema throwing -> no schema', r.schema === null);
}

{
  /* A source that answers with nothing is not the same as one that is absent,
   * and both must land on the same safe answer. */
  const m = fakeMap({ water: [] });
  const r = coastPolygons(m);
  check('an empty answer -> no schema', r.schema === null);
}

{
  /* Below the vertex floor: a corner of one tile, not a coastline. A mask built
   * from this would cut the sea away from most of the world. */
  const tiny = ring(0, 0, 1, 4);
  const m = fakeMap({ water: [polyFeature([tiny])] });
  const r = coastPolygons(m);
  check(
    'too few vertices to trust -> no schema',
    r.schema === null,
    'floor is ' + COAST_BAND.minCoastVertices
  );
}

{
  /* Degenerate rings cannot be filled and must not be counted towards the
   * floor either, or two-point tile stubs would let a mask through. */
  const m = fakeMap({ water: [polyFeature([[[0, 0], [1, 1]]])] });
  const r = coastPolygons(m);
  check('a two-point stub is not a polygon', r.schema === null);
}

console.log('\n== lines are dropped, because a line has no inside ==');

{
  const m = fakeMap({
    water: [{ geometry: { type: 'LineString', coordinates: ring(0, 0, 1, BIG) } }],
  });
  const r = coastPolygons(m);
  check('a LineString coast yields nothing fillable', r.schema === null);
}

console.log('\n== the answer is memoized, and shared rather than copied ==');

{
  const m = fakeMap({ water: [polyFeature([ring(0, 0, 1, BIG)])] });
  const a = coastPolygons(m);
  const b = coastPolygons(m);
  check('same generation returns the same object', a === b);
}

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
