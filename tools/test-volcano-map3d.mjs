/**
 * test-volcano-map3d.mjs — the real-scale maths behind the map-zoom mountains,
 * and the one safety property the tilt ramp must have.
 *
 * ==> THE POINT OF THIS FILE IS THAT `fill-extrusion` DIED OF A NUMBER. <== It
 * was cut because a footprint sized to read at z6 put Masaya's caldera across
 * 45 km of Nicaragua at z10. The replacement's whole claim is that a TRUE
 * footprint cannot do that. That claim is a number, so it is asserted here
 * against the real shipped catalog rather than argued in a comment.
 *
 * Runs against `assets/hazards/volcanoes-holocene.geojson` — the actual file,
 * not a fixture. Fixtures passing while glass fails is a lesson this project
 * has already paid for.
 *
 *   node tools/test-volcano-map3d.mjs
 */

import { readFileSync } from 'node:fs';
import { VOLCANO, TILT, DIVE } from '../config/constants.js';
import { volcanoFamily } from '../lib/volcano-shape.js';
import {
  isEdifice,
  volcanoRelief,
  volcanoBaseRadius,
  inflationAt,
  edificeOpacityAt,
} from '../lib/volcano-dimensions.js';
import { pitchAt } from '../map/pitch-ramp.js';

let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log('  ok   ' + name);
  } else {
    failed++;
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

const catalog = JSON.parse(
  readFileSync(new URL('../assets/hazards/volcanoes-holocene.geojson', import.meta.url), 'utf8')
);

/** Rebuild the minimum of a `marks` entry from a catalog feature. */
function markOf(f) {
  const p = f.properties;
  return {
    name: p.name,
    elev: Number(p.elev),
    submarine: Number(p.elev) < 0,
    family: volcanoFamily(p),
    erupting: false,
  };
}

const marks = catalog.features.map(markOf);
const byName = new Map(marks.map((m) => [m.name, m]));

console.log('\n== the tilt floor, which is the desync guard ==');

/* ==> THE ONE ASSERTION IN THIS FILE THAT IS ABOUT A BUG RATHER THAN A LOOK.
 * <== `map/globe-follow.js` has no concept of pitch, so any tilt while the 3D
 * globe is still VISIBLE pulls the two planets apart on screen. Visible ends
 * at the tail of `DIVE.fade.cage`. If somebody lowers `TILT.zStart` below that
 * to get tilt earlier, this is what tells them. */
const cageEndsAtZoom = DIVE.zSpace + DIVE.fade.cage[1] * (DIVE.zHandoff - DIVE.zSpace);
check(
  'tilt starts above the zoom where the 3D globe is last visible',
  TILT.zStart > cageEndsAtZoom,
  'zStart ' + TILT.zStart + ' vs cage gone at z' + cageEndsAtZoom.toFixed(2)
);
check('pitch is exactly 0 at the space floor', pitchAt(DIVE.zSpace) === 0);
check('pitch is exactly 0 where the cage disappears', pitchAt(cageEndsAtZoom) === 0);
check('pitch is exactly 0 at the start of the ramp', pitchAt(TILT.zStart) === 0);
check('pitch reaches its ceiling and stops', pitchAt(20) === TILT.maxDeg);
check('pitch never exceeds MapLibre default maxPitch', TILT.maxDeg <= 60);
check(
  'the projection has finished flattening before the mountains finish arriving',
  TILT.flatten[1] <= VOLCANO.map3d.handoff[1]
);

console.log('\n== the handoff leaves no gap ==');

check(
  'mountains start fading in no later than the circle starts fading out',
  VOLCANO.map3d.handoff[0] >= DIVE.zHandoff - 1e-9
);
check('mountains are absent below the handoff', edificeOpacityAt(VOLCANO.map3d.handoff[0]) === 0);
check('mountains are at full strength above it', edificeOpacityAt(VOLCANO.map3d.handoff[1]) === 1);

console.log('\n== the number that killed fill-extrusion ==');

/* Masaya's real caldera is about 6 x 11 km. The rejected version drew it at
 * roughly 45 km, spanning Managua to Granada. */
const masaya = byName.get('Masaya');
check('Masaya is in the catalog', !!masaya);
if (masaya) {
  const km = (volcanoBaseRadius(masaya) * 2) / 1000;
  check(
    'Masaya models under 20 km across, not 45',
    km < 20,
    km.toFixed(1) + ' km'
  );
}

console.log('\n== real proportions land near reality ==');

const expectKm = [
  ['Fujisan', 20, 45],
  ['Etna', 20, 50],
  ['Mauna Loa', 60, 160],
  ['Vesuvius', 8, 40],
];
for (const [name, lo, hi] of expectKm) {
  const m = byName.get(name);
  if (!m) {
    check(name + ' is in the catalog', false);
    continue;
  }
  const km = (volcanoBaseRadius(m) * 2) / 1000;
  check(
    name + ' models between ' + lo + ' and ' + hi + ' km across',
    km >= lo && km <= hi,
    km.toFixed(1) + ' km'
  );
}

console.log('\n== the plateau problem is capped, not ignored ==');

/* `elev` is height above SEA. Ojos del Salado stands on a 4,000 m plateau and
 * reads 6,879 m, which uncapped becomes a 7 km spire. */
const ojos = byName.get('Ojos del Salado, Nevados');
check('Ojos del Salado is in the catalog', !!ojos);
if (ojos) {
  check(
    'its modelled relief is capped well under its sea-level elevation',
    volcanoRelief(ojos) < ojos.elev,
    'relief ' + volcanoRelief(ojos) + ' m vs elev ' + ojos.elev + ' m'
  );
}

let maxRelief = 0;
for (const m of marks) if (isEdifice(m)) maxRelief = Math.max(maxRelief, volcanoRelief(m));
check(
  'no modelled volcano is taller than the tallest family cap',
  maxRelief <= Math.max(...Object.values(VOLCANO.map3d.families).map((f) => f.reliefCap)),
  maxRelief + ' m'
);

let minRelief = Infinity;
for (const m of marks) if (isEdifice(m)) minRelief = Math.min(minRelief, volcanoRelief(m));
check(
  'no modelled volcano has zero or negative height',
  minRelief >= VOLCANO.map3d.reliefFloor,
  minRelief + ' m'
);

console.log('\n== the two sets that never become mountains ==');

const subs = marks.filter((m) => m.submarine);
const fields = marks.filter((m) => m.family === 'field');
check('the catalog still has submarine volcanoes', subs.length > 0, subs.length + ' of them');
check('the catalog still has volcanic fields', fields.length > 0, fields.length + ' of them');
check('no submarine volcano gets an edifice', subs.every((m) => !isEdifice(m)));
check('no volcanic field gets an edifice', fields.every((m) => !isEdifice(m)));
check(
  'every other family does get one',
  marks
    .filter((m) => !m.submarine && m.family !== 'field')
    .every((m) => isEdifice(m))
);

console.log('\n== inflation is uniform and decays to the truth ==');

check('inflation is at its maximum at the handoff', inflationAt(VOLCANO.map3d.handoff[0]) === VOLCANO.map3d.inflate);
check('inflation is exactly 1 at the far end of its band', inflationAt(VOLCANO.map3d.inflateBand[1]) === 1);
check('inflation stays exactly 1 beyond it', inflationAt(18) === 1);
let monotonic = true;
let prev = Infinity;
for (let z = 5; z <= 12; z += 0.25) {
  const v = inflationAt(z);
  if (v > prev + 1e-9) monotonic = false;
  prev = v;
}
check('inflation never increases as you zoom in', monotonic);

console.log('\n== the two ratio tables are deliberately different ==');

/* §42.1.2 spreads the globe's ratios apart so six silhouettes separate at 3 px.
 * This layer uses real ones. If somebody ever "tidies up" by merging them, the
 * globe's shapes stop separating or the map's stop being true. */
let anyDiffer = false;
for (const fam of Object.keys(VOLCANO.map3d.families)) {
  if (VOLCANO.map3d.families[fam].ratio !== VOLCANO.shapes.families[fam].ratio) anyDiffer = true;
}
check('the map-zoom ratios are not the globe ratios', anyDiffer);
check(
  'a shield is still flatter than a cone (§42.1.2 rank order)',
  VOLCANO.map3d.families.shield.ratio > VOLCANO.map3d.families.cone.ratio
);
check(
  'a dome is still steeper than a cone',
  VOLCANO.map3d.families.dome.ratio < VOLCANO.map3d.families.cone.ratio
);

console.log('');
if (failed) {
  console.log(failed + ' check(s) failed');
  process.exit(1);
}
console.log('all checks passed');
