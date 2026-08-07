/**
 * check-water-extent.mjs — DOES THE SEA ACTUALLY REACH THREE TIMES FURTHER
 * THAN THE MOUNTAIN UNDER IT?
 *
 * ==> THIS IS A MEASUREMENT AGAINST THE REAL CATALOG, NOT A FIXTURE. <== The
 * water sheet used to borrow the mountain heightfield's grid, so its extent was
 * the mountain's extent by construction and there was nothing to check. It
 * builds its own grid now, which is exactly the kind of change that can look
 * right in the source and come out the same size as before.
 *
 * SPEC.md §13: when a fixture passes and glass fails, the fixture is wrong. So
 * this reads the shipped 1,196-feature catalog and reports what the geometry
 * actually measures, rather than asserting against numbers this file made up.
 *
 * Run: node tools/check-water-extent.mjs
 */

import { readFileSync } from 'fs';
import { buildRidges } from '../lib/volcano-ridge.js';
import { isEdifice, volcanoBaseRadius } from '../lib/volcano-dimensions.js';
import { volcanoFamily, isSubmarine } from '../lib/volcano-shape.js';
import { severityScore } from '../lib/volcano-severity.js';
import { VOLCANO } from '../config/volcano.js';

const W = VOLCANO.map3d.water;

const gj = JSON.parse(readFileSync(new URL('../assets/hazards/volcanoes-holocene.geojson', import.meta.url), 'utf8'));

/* The same mark shape `loadVolcanoField()` builds, minus the live overlay —
 * nothing here depends on what is erupting today. */
const marks = gj.features.map((f) => ({
  n: f.properties.n,
  name: f.properties.name,
  lon: f.geometry.coordinates[0],
  lat: f.geometry.coordinates[1],
  sev: severityScore(f.properties),
  erupting: false,
  submarine: isSubmarine(f.properties),
  family: volcanoFamily(f.properties),
  elev: Number(f.properties.elev),
}));

const subs = marks.filter((m) => m.submarine && isEdifice(m));
console.log(`catalog ${marks.length} · submarine edifices ${subs.length}`);

/* ==> THE DRAWN TIER, NOT THE WHOLE CATALOG. <== The renderer caps at
 * `maxDrawn`, so a cost read over all 816 edifices is a number nothing pays.
 * The first version of this check did exactly that and reported four times the
 * real vertex count. */
const drawable = marks.filter(isEdifice).slice(0, VOLCANO.map3d.maxDrawn);
const ridges = buildRidges(drawable);
const wet = ridges.filter((r) => r.water);
console.log(`ridges ${ridges.length} · with a sea over them ${wet.length}`);

if (!wet.length) {
  console.log('\nNO WATER BUILT AT ALL — that is the failure, not a number to read.');
  process.exit(1);
}

/* Extent of a vertex set, in metres, on the wider axis. */
function span(pos, stride) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.length; i += stride) {
    if (pos[i] < minX) minX = pos[i];
    if (pos[i] > maxX) maxX = pos[i];
    if (pos[i + 1] < minY) minY = pos[i + 1];
    if (pos[i + 1] > maxY) maxY = pos[i + 1];
  }
  return Math.max(maxX - minX, maxY - minY);
}

let worst = Infinity;
let worstName = '';
const rows = [];
for (const r of wet) {
  const land = span(r.positions, 3);
  const sea = span(r.water.positions, 3);
  const ratio = sea / land;
  if (ratio < worst) { worst = ratio; worstName = `${r.lon.toFixed(1)},${r.lat.toFixed(1)}`; }
  rows.push({ ratio, land, sea, verts: r.water.positions.length / 3, tris: r.water.indices.length / 3 });
}

rows.sort((a, b) => a.ratio - b.ratio);
console.log('\nsea width vs mountain-grid width, per cluster:');
for (const q of [0, Math.floor(rows.length / 2), rows.length - 1]) {
  const r = rows[q];
  console.log(`  ${r.ratio.toFixed(2)}x   land ${(r.land / 1000).toFixed(1)} km · sea ${(r.sea / 1000).toFixed(1)} km · ${r.verts} verts, ${r.tris} tris`);
}

const totalVerts = rows.reduce((a, r) => a + r.verts, 0);
const totalTris = rows.reduce((a, r) => a + r.tris, 0);
console.log(`\nwhole drawn set: ${totalVerts} water vertices, ${totalTris} water triangles`);
console.log(`spread ${W.spread}x, grid ${W.cellsPerRadius}/radius`);

/* ==> THIS TOOL NO LONGER CHECKS A SAMPLING FLOOR, BECAUSE THERE IS NOT ONE.
 * <== It used to measure the grid against the shortest DISPLACING wavelength
 * and fail the run below three samples per wave, because the vertex shader
 * raised this grid and a travelling wave sampled too coarsely renders as a
 * standing zigzag.
 *
 * The surface is a flat plane now and every wave is a fragment-shader normal,
 * so the grid's spacing has nothing to do with any wavelength. What is left for
 * it to carry is the alpha ramp at the sheet's rim — measured below as samples
 * across the fade band, and reported rather than asserted: a coarse rim reads
 * as a slightly creased edge, which is a look call, not a correctness one.
 *
 * The saving from dropping the old floor is real and lands on the widest sheets,
 * which were being held to a spacing fixed in metres regardless of their size. */
/* ==> AND THE RIM FADE'S RESOLUTION IS A CONSTANT, NOT A PER-SHEET MEASUREMENT.
 * <== It works out to `edgeFade x spread x cellsPerRadius` for every sheet
 * alike, because the grid spacing and the fade band both scale with the same
 * seamount radius. Worth printing rather than looping over: the loop that used
 * to sit here measured something that could not vary. The one case where it
 * DOES vary is the cell ceiling firing, which is reported separately below. */
const fadeSamples = W.edgeFade * W.spread * W.cellsPerRadius;
console.log(`rim fade carries ${fadeSamples.toFixed(1)} samples on every sheet`);

let biggest = null;
for (const r of wet) {
  const p = r.water.positions;
  const verts = p.length / 3;
  if (!biggest || verts > biggest.verts) {
    biggest = {
      at: `${r.lon.toFixed(1)},${r.lat.toFixed(1)}`,
      km: (span(p, 3) / 1000).toFixed(0),
      verts,
      spacing: (Math.abs(p[3] - p[0]) || 0).toFixed(0),
      members: r.members,
    };
  }
}
if (biggest) {
  console.log(`heaviest sheet at ${biggest.at}: ${biggest.km} km across, ${biggest.verts} verts, ${biggest.spacing} m spacing, ${biggest.members} members`);
  console.log(`  cell ceiling is ${W.maxCells} — ${biggest.verts >= W.maxCells * 0.9 ? 'BINDING, and the rim fade above is coarser than stated' : 'not binding'}`);
}

console.log(`\nnarrowest cluster ${worst.toFixed(2)}x at ${worstName}`);
