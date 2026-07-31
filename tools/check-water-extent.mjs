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
import { VOLCANO } from '../config/constants.js';

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
console.log(`spread ${W.spread}x, grid ${W.cellsPerRadius}/radius, floor ${W.wave.minSamplesPerWave} samples per wave`);

/* ==> THE FLOOR APPLIES TO THE DISPLACING TRAINS ONLY. <== The short train is
 * lit per fragment and never touches a vertex, so measuring the grid against it
 * fails a sheet for not carrying something it was never asked to carry. This
 * check asserted against all three for one run and reported a false failure. */
const shortest = Math.min(...W.wave.lengthsM.slice(0, W.wave.displaceCount));
let worstSamples = Infinity;
let worstSheet = null;
for (const r of wet) {
  const p = r.water.positions;
  const spacing = Math.abs(p[3] - p[0]) || Infinity;
  const n = shortest / spacing;
  if (n < worstSamples) {
    worstSamples = n;
    worstSheet = {
      at: `${r.lon.toFixed(1)},${r.lat.toFixed(1)}`,
      km: (span(r.water.positions, 3) / 1000).toFixed(0),
      verts: p.length / 3,
      spacing: spacing.toFixed(0),
      members: r.members,
    };
  }
}
console.log(`shortest displacing wave ${shortest} m · worst sampling ${worstSamples.toFixed(1)} samples per wave`);
if (worstSheet) {
  console.log(`  worst sheet at ${worstSheet.at}: ${worstSheet.km} km across, ${worstSheet.verts} verts, ${worstSheet.spacing} m spacing, ${worstSheet.members} members`);
  console.log(`  cell ceiling is ${W.maxCells} — ${worstSheet.verts >= W.maxCells * 0.9 ? 'BINDING' : 'not binding'}`);
}
if (worstSamples < W.wave.minSamplesPerWave - 0.01) {
  console.log('FAIL — a sheet is under-sampling the shortest train and will alias.');
  process.exit(1);
}
console.log(`\nnarrowest cluster ${worst.toFixed(2)}x at ${worstName}`);
