/**
 * test-volcano-ridge.mjs — the merged-heightfield maths behind "a cordillera
 * is one ridge, not a row of cones".
 *
 * ==> THIS FILE EXISTS BECAUSE THE SANDBOX HAS NO BROWSER AND EVERY BUG THIS
 * FEATURE HAS HAD LOOKED FINE IN CODE. <== Four deploys drew mountains that
 * were fifty million times too tall while the layer's own readout said it was
 * working. The maths that can be wrong lives in `lib/volcano-ridge.js`, with
 * no THREE and no MapLibre in it, precisely so it can be asserted here.
 *
 * Runs against `assets/hazards/volcanoes-holocene.geojson` — the actual file.
 * Fixtures passing while glass fails is a lesson this project has paid for.
 *
 *   node tools/test-volcano-ridge.mjs
 */

import { readFileSync } from 'node:fs';
import { VOLCANO } from '../config/constants.js';
import { volcanoFamily, volcanoProfile } from '../lib/volcano-shape.js';
import {
  isEdifice,
  volcanoBaseRadius,
  volcanoRelief,
  inflationAt,
  ridgeScale,
} from '../lib/volcano-dimensions.js';
import {
  profileTable,
  heightFrac,
  smax,
  ridgeMember,
  clusterMembers,
  buildRidge,
  buildRidges,
} from '../lib/volcano-ridge.js';

const M3 = VOLCANO.map3d;
const R = M3.ridge;

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

const marks = catalog.features.map((f) => {
  const p = f.properties;
  const c = f.geometry.coordinates;
  return {
    name: p.name,
    elev: Number(p.elev),
    lon: c[0],
    lat: c[1],
    submarine: Number(p.elev) < 0,
    family: volcanoFamily(p),
    erupting: false,
  };
});
const byName = new Map(marks.map((m) => [m.name, m]));
const drawable = marks.filter(isEdifice);

console.log('\n== the profile is inverted, not reimplemented ==');

/* ==> THE WHOLE POINT OF THE TABLE IS THAT IT IS THE SAME CURVE. <== A lathe
 * asks "at this fraction up the profile, what radius and height"; a
 * heightfield asks "at this distance from the axis, how high". If the
 * inversion drifts, a volcano is one shape on the globe and a different shape
 * on the map, and nothing on screen says so. */
for (const [fam, spec] of Object.entries(VOLCANO.shapes.families)) {
  const table = profileTable(spec, 400);
  let worst = 0;
  for (let i = 0; i <= 200; i++) {
    const v = i / 200;
    const p = volcanoProfile(v, spec);
    /* Skip the caldera's crater floor, where two heights share one radius only
     * in the limit — the table holds the surface, which is what a heightfield
     * wants and what the lathe draws too. */
    const back = heightFrac(table, p.r);
    worst = Math.max(worst, Math.abs(back - p.h));
  }
  check(
    fam + ': the inverted table reproduces volcanoProfile within a sample',
    worst < 0.02,
    'worst ' + worst.toFixed(4)
  );
}

const coneTable = profileTable(VOLCANO.shapes.families.cone);
check('height is zero at and beyond the base radius', heightFrac(coneTable, 1) === 0);
check('height is zero well outside the footprint', heightFrac(coneTable, 3) === 0);
check('height is full at the axis', Math.abs(heightFrac(coneTable, 0) - 1) < 1e-9);

/* ==> ZERO OUTSIDE THE FOOTPRINT IS LOAD-BEARING, NOT COSMETIC. <== It is what
 * lets the mesh be trimmed at the footprint edge. Without it every cluster
 * would carry a large fully-transparent sheet that still writes depth, and a
 * transparent sheet that occludes is worse than no soft base at all. */
let monotone = true;
let prev = Infinity;
for (let q = 0; q <= 1.001; q += 0.005) {
  const h = heightFrac(coneTable, q);
  if (h > prev + 1e-9) monotone = false;
  prev = h;
}
check('a cone never rises again as you walk outward from its axis', monotone);

console.log('\n== smooth max: exact at the peaks, a saddle at the join ==');

check('far apart, it is exactly the larger value', smax(100, 10, 20) === 100);
check('far apart the other way, it is exactly the larger value', smax(10, 100, 20) === 100);
check('at zero blend it is a plain max', smax(50, 50, 0) === 50);

/* ==> NEVER A SUM. <== Two overlapping volcanoes are not one volcano twice as
 * tall. The blend is bounded above by `max + k/4`, which is the entire licence
 * it has to lift anything. */
const k = 40;
const joined = smax(100, 100, k);
check('equal values lift by exactly a quarter of the blend width', Math.abs(joined - (100 + k / 4)) < 1e-9);
check('and that is nowhere near a sum', joined < 200);
let boundOk = true;
for (let a = 0; a <= 100; a += 7) {
  for (let b = 0; b <= 100; b += 11) {
    const s = smax(a, b, k);
    if (s < Math.max(a, b) - 1e-9 || s > Math.max(a, b) + k / 4 + 1e-9) boundOk = false;
  }
}
check('the blend is always between max and max plus a quarter of the width', boundOk);

console.log('\n== clustering reads TRUE footprints, so it does not move with zoom ==');

/* Two cones 20 km apart, each modelling ~31 km across, genuinely overlap. That
 * is the geography this whole change is about. */
const near = [
  ridgeMember({ lon: -90.0, lat: 14.5, family: 'cone', elev: 3500, erupting: false }),
  ridgeMember({ lon: -90.0, lat: 14.68, family: 'cone', elev: 3500, erupting: false }),
];
check('two cones 20 km apart are one cluster', clusterMembers(near).length === 1);

const far = [
  ridgeMember({ lon: -90.0, lat: 14.5, family: 'cone', elev: 3500, erupting: false }),
  ridgeMember({ lon: -90.0, lat: 16.5, family: 'cone', elev: 3500, erupting: false }),
];
check('two cones 220 km apart are two clusters', clusterMembers(far).length === 2);

/* ==> THE ANTIMERIDIAN. <== The Kurils and the Aleutians straddle it, and a
 * naive longitude difference puts two neighbours 359 degrees apart. */
const dateline = [
  ridgeMember({ lon: 179.95, lat: 51.0, family: 'cone', elev: 3500, erupting: false }),
  ridgeMember({ lon: -179.95, lat: 51.0, family: 'cone', elev: 3500, erupting: false }),
];
check('a cluster spanning the antimeridian does not come apart', clusterMembers(dateline).length === 1);
const dlRidge = buildRidge(clusterMembers(dateline)[0]);
check(
  'and its centre lands on the antimeridian, not in Africa',
  dlRidge && Math.abs(Math.abs(dlRidge.lon) - 180) < 0.2,
  dlRidge && 'lon ' + dlRidge.lon.toFixed(3)
);

console.log('\n== one mountain: the footprint is true and the height is the stated lie ==');

const fuji = byName.get('Fujisan');
check('Fujisan is in the catalog', !!fuji);
if (fuji) {
  const one = buildRidge([ridgeMember(fuji)]);
  const radius = volcanoBaseRadius(fuji);
  const wantPeak = volcanoRelief(fuji) * M3.vertical;

  let peak = 0;
  let reach = 0;
  let bad = 0;
  for (let i = 0; i < one.positions.length; i += 3) {
    const x = one.positions[i];
    const y = one.positions[i + 1];
    const z = one.positions[i + 2];
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) bad++;
    if (z > peak) peak = z;
    if (z > 0) reach = Math.max(reach, Math.hypot(x, y));
  }
  const cell = radius / R.cellsPerRadius;

  check('no vertex is NaN or infinite', bad === 0, bad + ' bad');
  check(
    'the summit stands at relief x vertical',
    Math.abs(peak - wantPeak) < wantPeak * 0.02,
    peak.toFixed(0) + ' m vs ' + wantPeak.toFixed(0) + ' m'
  );
  check(
    'nothing is drawn outside the TRUE footprint',
    reach <= radius + 1e-6,
    reach.toFixed(0) + ' m vs radius ' + radius.toFixed(0) + ' m'
  );
  check(
    'and the mesh reaches most of the way to it',
    reach > radius - 2 * cell,
    reach.toFixed(0) + ' m vs radius ' + radius.toFixed(0) + ' m'
  );

  /* ==> THE RATIO IS THE UNITS GUARD, AND IT IS DIMENSIONLESS. <== Height and
   * width are both derived from one relief, so their proportion is fixed by
   * the family and the stated exaggeration. If one axis were ever in different
   * units from the other, this picks up a factor of ~50 million. */
  check(
    'height over base radius is exactly the stated exaggeration',
    Math.abs(peak / radius - M3.vertical / M3.families.cone.ratio) < 0.02,
    (peak / radius).toFixed(3)
  );

  /* ---- the soft base ---------------------------------------------------- */

  let alphaAtSummit = 0;
  let alphaAtRim = 1;
  for (let i = 0, v = 0; i < one.positions.length; i += 3, v++) {
    const z = one.positions[i + 2];
    const a = one.colors[v * 4 + 3];
    if (z >= peak - 1e-6) alphaAtSummit = Math.max(alphaAtSummit, a);
    if (z > 0 && z < wantPeak * 0.01) alphaAtRim = Math.min(alphaAtRim, a);
  }
  check(
    'the summit is drawn at the full quiet opacity',
    Math.abs(alphaAtSummit - M3.opacity) < 1e-6,
    alphaAtSummit.toFixed(3)
  );
  check(
    'the base fades in rather than meeting the map at a hard rim',
    alphaAtRim < M3.opacity * 0.25,
    alphaAtRim.toFixed(4)
  );

  /* Every alpha must be a real number in range, or the GPU gets nonsense. */
  let alphaOk = true;
  for (let v = 0; v * 4 + 3 < one.colors.length; v++) {
    const a = one.colors[v * 4 + 3];
    if (!(a >= 0 && a <= 1)) alphaOk = false;
  }
  check('every vertex alpha is between 0 and 1', alphaOk);
}

console.log('\n== two mountains: one ridge with a saddle, never a sum ==');

const pair = clusterMembers(near);
check('the pair really is one cluster', pair.length === 1);
if (pair.length === 1) {
  const ridge = buildRidge(pair[0]);
  const single = buildRidge([near[0]]);

  let singlePeak = 0;
  for (let i = 2; i < single.positions.length; i += 3) singlePeak = Math.max(singlePeak, single.positions[i]);

  let peak = 0;
  for (let i = 2; i < ridge.positions.length; i += 3) peak = Math.max(peak, ridge.positions[i]);

  const lift = (peak * R.saddle) / 4;
  check(
    'merging two mountains does not make either of them taller than a saddle allows',
    peak <= singlePeak + lift + 1e-6,
    peak.toFixed(0) + ' m vs one at ' + singlePeak.toFixed(0) + ' m'
  );
  check('and emphatically not the sum of the two', peak < singlePeak * 1.5);

  /* The col between two equal summits must be a real dip — a ridge, not a
   * plateau — and it must sit ABOVE what a plain max would leave there, which
   * is what stops the join reading as a crease.
   *
   * Read off the grid node nearest the midpoint rather than a fixed window: a
   * window narrower than one cell finds nothing and reports a confident zero,
   * which is exactly the kind of false negative this suite exists to avoid. */
  let col = 0;
  let bestD = Infinity;
  for (let i = 0; i < ridge.positions.length; i += 3) {
    const d = Math.hypot(ridge.positions[i], ridge.positions[i + 1]);
    if (d < bestD) {
      bestD = d;
      col = ridge.positions[i + 2];
    }
  }
  check('there is a saddle between the two summits', col > 0 && col < peak, col.toFixed(0) + ' m');

  /* What a plain max would have left at the midpoint, for comparison. Each
   * cone contributes the same amount there, so `max` is that amount and the
   * blend must exceed it. */
  const half = 0.5 * Math.hypot(0, 20000);
  const plainMax =
    near[0].height * heightFrac(profileTable(VOLCANO.shapes.families.cone), half / near[0].radius);
  check(
    'and it sits above the crease a plain max would leave',
    col > plainMax,
    col.toFixed(0) + ' m vs plain max ' + plainMax.toFixed(0) + ' m'
  );
}

console.log('\n== the whole catalog, which is the only denominator that matters ==');

const ridges = buildRidges(drawable.slice(0, M3.maxDrawn));
check('the catalog produces ridges at all', ridges.length > 0, ridges.length + ' of them');

let members = 0;
let verts = 0;
let tris = 0;
let anyBad = false;
for (const r of ridges) {
  members += r.members;
  verts += r.positions.length / 3;
  tris += r.indices.length / 3;
  for (let i = 0; i < r.positions.length; i++) if (!isFinite(r.positions[i])) anyBad = true;
  for (let i = 0; i < r.colors.length; i++) if (!isFinite(r.colors[i])) anyBad = true;
}
check('every volcano handed in comes back out in exactly one ridge', members === Math.min(drawable.length, M3.maxDrawn), members + ' of ' + Math.min(drawable.length, M3.maxDrawn));
check('nothing in the whole catalog produces a NaN', !anyBad);
check(
  'clustering actually merges something',
  ridges.length < members,
  members + ' volcanoes in ' + ridges.length + ' ridges'
);
check(
  'and does not collapse the planet into one ridge',
  ridges.length > 1,
  ridges.length + ' ridges'
);

console.log(
  '  ..   ' +
    members +
    ' volcanoes in ' +
    ridges.length +
    ' ridges — ' +
    verts.toLocaleString() +
    ' vertices, ' +
    tris.toLocaleString() +
    ' triangles, ' +
    ridges.length +
    ' draw calls'
);
check(
  'the whole layer stays inside a sane triangle budget for a phone',
  tris < 600000,
  tris.toLocaleString() + ' triangles'
);

/* No single cluster may run away, whatever the geography does. */
let worstCells = 0;
for (const r of ridges) worstCells = Math.max(worstCells, r.positions.length / 3);
check(
  'no single cluster exceeds its grid ceiling',
  worstCells <= R.maxCells * 1.05,
  worstCells + ' nodes vs cap ' + R.maxCells
);

console.log('\n== the scale applied at draw time is ONE number ==');

/* ==> `inflate` MAY NEVER BECOME TWO CURVES, AND NOW IT STRUCTURALLY CANNOT.
 * <== The old code returned a width and a height separately, which is the
 * shape that let one of them be in metres and the other in fractions of the
 * world for four deploys. There is one scalar now. */
const EARTH_CIRCUMFERENCE_M = 40075016.686;
const upmAt = (lat) => (1 / EARTH_CIRCUMFERENCE_M) * (1 / Math.cos((lat * Math.PI) / 180));

check('the ridge scale is a plain number, not a per-axis object', typeof ridgeScale(6, upmAt(35)) === 'number');
check(
  'it is the inflation times one metre, at every zoom in the band',
  [5.4, 6.2, 7, 8, 9.5, 12].every(
    (z) => Math.abs(ridgeScale(z, upmAt(35)) - inflationAt(z) * upmAt(35)) < 1e-18
  )
);

/* The blunt one, in the units of the thing itself: the world is 1.0 across. */
let tallest = 0;
let tallestAt = '';
for (const r of ridges) {
  for (const lat of [0, 60, 71]) {
    const s = ridgeScale(M3.handoff[0], upmAt(lat));
    const h = r.peak * s;
    if (h > tallest) {
      tallest = h;
      tallestAt = 'lat ' + lat;
    }
  }
}
check(
  'the tallest modelled ridge is under 1% of the width of the world',
  tallest < 0.01,
  tallest.toExponential(2) + ' world-widths at ' + tallestAt
);
check('...and is not zero either', tallest > 1e-6, tallest.toExponential(2));

console.log('');
if (failed) {
  console.log(failed + ' check(s) failed');
  process.exit(1);
}
console.log('all checks passed');
