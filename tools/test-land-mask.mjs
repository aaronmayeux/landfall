#!/usr/bin/env node
/**
 * test-land-mask.mjs — the point-in-land test, and the sea sheet's shore cut.
 *
 * ==> WHY THIS IS ASSERTED RATHER THAN LOOKED AT. <== Every failure mode here
 * is a one-pixel stripe or a spill on one island at one zoom, and the sandbox
 * has no browser. A ray cast that double-counts a shared vertex reports the
 * middle of a continent as ocean along a single line of latitude — invisible
 * in a screenshot, obvious to an assertion.
 */

import { createLandMask, lonDelta } from '../lib/land-mask.js';
import { buildWater } from '../lib/volcano-water.js';
import { VOLCANO } from '../config/constants.js';

let pass = 0;
let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass++; console.log('  ok   ' + what); }
  else { fail++; console.log('  FAIL ' + what); }
};
const head = (s) => console.log('\n== ' + s + ' ==');

/* A 2° square of land centred on (10, 10). */
const SQUARE = [[[9, 9], [11, 9], [11, 11], [9, 11]]];

head('lonDelta wraps');
ok(lonDelta(179, -179) === 2, '179 to -179 is +2, not -358');
ok(lonDelta(-179, 179) === -2, 'and the reverse is -2');
ok(lonDelta(0, 10) === 10, 'an ordinary step is untouched');

head('a square of land');
const m = createLandMask(SQUARE);
ok(!!m, 'the mask builds');
ok(m.landAt(10, 10) === true, 'the centre is land');
ok(m.landAt(9.5, 10.5) === true, 'and so is an off-centre interior point');
ok(m.landAt(12, 10) === false, 'a point east of it is sea');
ok(m.landAt(8, 10) === false, 'a point west of it is sea');
ok(m.landAt(10, 12) === false, 'a point north of it is sea');
ok(m.landAt(10, 8) === false, 'a point south of it is sea');

head('the shared-vertex stripe — the bug this test exists for');
/* Two stacked rectangles meeting exactly at lat 10. A ray at that latitude
 * passes through the joint on both rings; counted twice it reads as sea. */
const STACKED = [
  [[9, 9], [11, 9], [11, 10], [9, 10]],
  [[9, 10], [11, 10], [11, 11], [9, 11]],
];
const ms = createLandMask(STACKED);
ok(ms.landAt(10, 10) === true, 'the seam between two abutting rings is still land');
ok(ms.landAt(10, 9.5) === true, 'as is the lower rectangle');
ok(ms.landAt(10, 10.5) === true, 'as is the upper one');

head('the antimeridian is not an edge case, it is the Aleutians');
const ACROSS = [[[179, 9], [-179, 9], [-179, 11], [179, 11]]];
const ma = createLandMask(ACROSS);
ok(ma.landAt(180, 10) === true, 'a point inside a ring spanning 180 is land');
ok(ma.landAt(179.5, 10) === true, 'and just west of the line');
ok(ma.landAt(-179.5, 10) === true, 'and just east of it');
ok(ma.landAt(170, 10) === false, 'but open ocean 10 degrees away is not');

head('nothing to build from is null, never an empty mask');
ok(createLandMask([]) === null, 'no rings at all is null');
ok(createLandMask(null) === null, 'null in is null out');
ok(createLandMask([[[0, 0], [1, 1]]]) === null, 'a two-point ring is not a polygon');

/* ------------------------------------------------------------------ the sea */

const WATER = VOLCANO.map3d.water;

/** One seamount at the cluster origin, 8 km base radius. */
const SUB = [{ e: 0, n: 0, radius: 8000, submarine: true }];

/** Fraction of emitted water vertices carrying any alpha at all. */
function wetFraction(w) {
  if (!w) return 0;
  let wet = 0;
  const n = w.colors.length / 4;
  for (let i = 0; i < n; i++) if (w.colors[i * 4 + 3] > 0.001) wet++;
  return wet / n;
}

head('the sea, uncut');
const open = buildWater(SUB, 0, 0, null);
ok(!!open, 'a sheet builds with no mask at all');
const openWet = wetFraction(open);
ok(openWet > 0.1, 'and a good part of it is wet (' + (openWet * 100).toFixed(0) + '%)');

head('==> NO MASK MEANS UNKNOWN, AND UNKNOWN STILL DRAWS THE SEA <==');
/* The alternative — no mask means no water — would delete the one feature
 * that says Ahyi is submarine, every time the basemap was slow. */
ok(wetFraction(buildWater(SUB, 0, 0, undefined)) === openWet,
  'undefined behaves identically to null: the old behaviour, not a blank sea');

head('land over the seamount cuts the sheet');
/* A landmass covering everything east of the cluster centre. The sheet reaches
 * water.spread x 8 km = 24 km, which at this latitude is about 0.22 degrees. */
const EAST = [[[0, -5], [5, -5], [5, 5], [0, 5]]];
const cut = buildWater(SUB, 0, 0, createLandMask(EAST));
ok(!!cut, 'a partly-covered sheet still builds');
const cutWet = wetFraction(cut);
ok(cutWet < openWet, 'less of it is wet than the uncut sheet');
ok(cutWet > 0.02, 'but the western half survives — this is a cut, not a delete');

head('land over ALL of it removes the sheet entirely');
const ALL = [[[-5, -5], [5, -5], [5, 5], [-5, 5]]];
ok(buildWater(SUB, 0, 0, createLandMask(ALL)) === null,
  'a seamount entirely under a landmass gets no sea mesh at all, not a transparent one');

head('the shore edge is anti-aliased, not stepped');
/* Between fully wet and fully dry there must be intermediate alphas, or the
 * coast is a staircase at grid resolution. */
let partial = 0;
for (let i = 0; i < cut.colors.length / 4; i++) {
  const a = cut.colors[i * 4 + 3];
  if (a > 0.001 && a < WATER.opacity * 0.99) partial++;
}
ok(WATER.shoreSamples > 1, 'supersampling is switched on in constants');
ok(partial > 0, 'and there are ' + partial + ' part-strength vertices along the cut');

head('==> AND THE RAMP DOES NOT LEAK PAST ONE CELL — THE GLASS FAILURE <==');
/* The first version blurred over ~4 cells, which at 1,731 m a cell was a 7 km
 * smear: Aaron reported the sea fading rather than clipping at the coast.
 *
 * The rim fade makes raw alpha useless for this — most of a sheet is
 * part-strength because it is near the sheet's OWN edge. So the test compares
 * the masked sheet against the unmasked one node for node: the mask may only
 * change nodes whose own cell straddles the coast. A node two cells out in
 * open water must be bit-for-bit unchanged. A blur cannot pass this.
 *
 * `EAST` is land for lon > 0, so a node's distance from the coast is just its
 * own x in metres. */
{
  const bare = buildWater(SUB, 0, 0, null);
  const w = buildWater(SUB, 0, 0, createLandMask(EAST));
  ok(bare.colors.length === w.colors.length, 'both sheets have the same grid');

  /* Cell size, read off the grid rather than recomputed from constants. */
  const n = bare.positions.length / 3;
  let cell = Infinity;
  for (let i = 1; i < n; i++) {
    const d = Math.abs(bare.positions[i * 3] - bare.positions[(i - 1) * 3]);
    if (d > 1 && d < cell) cell = d;
  }
  ok(cell < 2000, 'grid spacing is ' + cell.toFixed(0) + ' m — this is the floor on edge sharpness');

  let leaked = 0;
  let farthest = 0;
  for (let i = 0; i < n; i++) {
    const x = bare.positions[i * 3];
    if (x >= 0) continue;                       // on the land side, skip
    const before = bare.colors[i * 4 + 3];
    const after = w.colors[i * 4 + 3];
    if (Math.abs(before - after) < 1e-9) continue;
    const outCells = -x / cell;                 // cells west of the coast
    if (outCells > farthest) farthest = outCells;
    if (outCells > 1.5) leaked++;
  }
  ok(leaked === 0,
    'no open-water node beyond 1.5 cells from the coast was touched (' + leaked + ' leaks)');
  ok(farthest <= 1.5,
    'the furthest the mask reached into open water is ' + farthest.toFixed(2) + ' cells');
}

console.log('\n' + (fail ? fail + ' FAILED, ' : '') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
