/**
 * test-volcano-extrusion.mjs — the map-side rings, built from real catalog
 * volcanoes rather than a fixture.
 *
 * ==> WHAT IS WORTH LOCKING HERE IS GEOMETRY THAT IS SILENTLY WRONG. <== A
 * polygon that does not close, a hole wound the same way as its outer ring, or
 * a ring wider than the one it is punched out of all render as SOMETHING —
 * usually a smear, occasionally nothing, never an error. Those are the failures
 * a glass read cannot diagnose, so they belong here.
 *
 * Deliberately NOT tested: whether the terracing looks like a contour model or
 * like a mistake, whether the exaggeration curve is right, whether any of it
 * reads on a phone. Glass questions.
 *
 *   node tools/test-volcano-extrusion.mjs
 */

import { readFileSync } from 'node:fs';
import { buildVolcanoExtrusions, buildVolcanoPoints } from '../lib/volcano-extrusion.js';
import { FAMILY, volcanoFamily } from '../lib/volcano-shape.js';
import { severityScore } from '../lib/volcano-severity.js';
import { VOLCANO } from '../config/constants.js';

const CATALOG = JSON.parse(readFileSync('assets/hazards/volcanoes-holocene.geojson', 'utf8'));
const M = VOLCANO.marks;
const EX = VOLCANO.extrusion;
const SH = VOLCANO.shapes;

let passed = 0;
const failures = [];
function ok(what, cond, detail = '') {
  if (cond) passed++;
  else failures.push(`${what}${detail ? ' — ' + detail : ''}`);
}
function group(name) {
  console.log('\n  ' + name);
}

/** The quiet tier, shaped exactly as `loadVolcanoField()` hands it over. */
const marks = CATALOG.features
  .filter((f) => Number((f.properties || {})[M.tierField] || 0) >= M.tierMin)
  .map((f) => {
    const p = f.properties;
    const c = f.geometry.coordinates;
    return {
      n: p.n,
      name: p.name,
      lon: c[0],
      lat: c[1],
      sev: severityScore(p),
      erupting: false,
      submarine: Number(p.elev) < 0,
      family: volcanoFamily(p),
      elev: Number(p.elev),
    };
  });

console.log('volcano extrusions — against the shipped catalog');
ok('the quiet tier is still 128', marks.length === 128, String(marks.length));

const fc = buildVolcanoExtrusions(marks);
const pts = buildVolcanoPoints(marks);

/* ------------------------------------------------------------------------ */
group('who gets an extrusion and who does not');

ok('every mark gets a point', pts.features.length === marks.length, `${pts.features.length}`);

const extruded = new Set(fc.features.map((f) => f.properties.n));
const submarine = marks.filter((m) => m.submarine);
ok('seven of the tier are underwater', submarine.length === 7, String(submarine.length));
/* §42.1.4 — a submarine volcano extruded above sea level is a lie that gets
 * WORSE the closer you look, which is the opposite of what a map layer should
 * do. Ahyi is erupting 55 m down. */
ok(
  'no submarine volcano is extruded',
  submarine.every((m) => !extruded.has(m.n)),
  submarine.filter((m) => extruded.has(m.n)).map((m) => m.name).join(' · ')
);

const fields = marks.filter((m) => m.family === FAMILY.field);
ok(
  'no volcanic field is extruded',
  fields.every((m) => !extruded.has(m.n)),
  fields.filter((m) => extruded.has(m.n)).map((m) => m.name).join(' · ')
);

const shouldExtrude = marks.filter((m) => !m.submarine && m.family !== FAMILY.field);
ok(
  'everything else is extruded',
  shouldExtrude.every((m) => extruded.has(m.n)),
  shouldExtrude.filter((m) => !extruded.has(m.n)).map((m) => m.name).slice(0, 5).join(' · ')
);
ok(
  'each extruded volcano gets exactly the ring count',
  shouldExtrude.every((m) => fc.features.filter((f) => f.properties.n === m.n).length === EX.rings),
  ''
);

/* ------------------------------------------------------------------------ */
group('the polygons are valid, not merely present');

/** Signed area in the xy plane. Positive is counter-clockwise. */
function signedArea(r) {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return a / 2;
}
function maxRadius(r, c) {
  let m = 0;
  for (const [x, y] of r) m = Math.max(m, Math.hypot(x - c[0], y - c[1]));
  return m;
}

let unclosed = 0;
let badWind = 0;
let holeTooBig = 0;
let nonFinite = 0;
for (const f of fc.features) {
  const [outer, hole] = f.geometry.coordinates;
  const c = [outer.reduce((s, p) => s + p[0], 0) / outer.length, outer.reduce((s, p) => s + p[1], 0) / outer.length];

  for (const r of f.geometry.coordinates) {
    if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) unclosed++;
    if (r.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) nonFinite++;
  }
  if (signedArea(outer) <= 0) badWind++;
  if (hole) {
    /* GeoJSON's right-hand rule: an interior ring is wound OPPOSITE its
     * exterior. Get this wrong and some renderers fill the hole in. */
    if (signedArea(hole) >= 0) badWind++;
    if (maxRadius(hole, c) >= maxRadius(outer, c)) holeTooBig++;
  }
  if (!Number.isFinite(f.properties.hM)) nonFinite++;
}
ok('every ring closes exactly', unclosed === 0, `${unclosed} open`);
ok('no coordinate or height is non-finite', nonFinite === 0, `${nonFinite}`);
ok('outers wind CCW and holes wind CW', badWind === 0, `${badWind} wrong`);
ok('every hole fits inside its outer ring', holeTooBig === 0, `${holeTooBig}`);

/* ------------------------------------------------------------------------ */
group('the stack actually makes a cone');

let notAscending = 0;
for (const m of shouldExtrude) {
  const hs = fc.features.filter((f) => f.properties.n === m.n).map((f) => f.properties.hM);
  for (let i = 1; i < hs.length; i++) if (hs[i] <= hs[i - 1]) notAscending++;
}
/* Outermost ring first, each one standing taller than the last. A stack that
 * does not ascend is a flat disc with extra polygons. */
ok('ring heights ascend inward', notAscending === 0, `${notAscending} steps flat or falling`);

const tallest = Math.max(...fc.features.map((f) => f.properties.hM));
const shortest = Math.min(...fc.features.map((f) => f.properties.hM));
ok('nothing extrudes to zero', shortest > 0, `${shortest} m`);
ok('the tallest ring is a real summit height', tallest > 3000 && tallest < 7000, `${tallest} m`);

/* ------------------------------------------------------------------------ */
group('§42.1.2 — the caldera is the one with a missing middle');

const byFamily = {};
for (const m of shouldExtrude) (byFamily[m.family] ||= []).push(m);
for (const [fam, list] of Object.entries(byFamily)) {
  const sample = list[0];
  const rings = fc.features.filter((f) => f.properties.n === sample.n);
  const innermost = rings[rings.length - 1];
  const hasHole = innermost.geometry.coordinates.length > 1;
  if (fam === FAMILY.caldera) {
    ok('a caldera keeps its crater open', hasHole, sample.name);
  } else {
    ok(`a ${fam} caps its summit`, !hasHole, sample.name);
  }
}

/* ------------------------------------------------------------------------ */
group('a circle in kilometres, not a circle in degrees');

/* At 55°N a degree of longitude is 57% of a degree of latitude. A ring built
 * in raw degrees is squashed by nearly half exactly where this catalog is
 * densest, and it reads as an oval rather than as a bug. */
const north = shouldExtrude.filter((m) => Math.abs(m.lat) > 50);
ok('the catalog has high-latitude volcanoes to test', north.length > 5, `${north.length}`);
let squashed = 0;
for (const m of north) {
  const f = fc.features.find((x) => x.properties.n === m.n);
  const r = f.geometry.coordinates[0];
  const lons = r.map((p) => p[0]);
  const lats = r.map((p) => p[1]);
  const wDeg = Math.max(...lons) - Math.min(...lons);
  const hDeg = Math.max(...lats) - Math.min(...lats);
  const cos = Math.cos((m.lat * Math.PI) / 180);
  /* Corrected, the ring should be WIDER in degrees than it is tall, by
   * exactly 1/cos(lat). */
  if (Math.abs(wDeg * cos - hDeg) / hDeg > 0.02) squashed++;
}
ok('high-latitude rings are round on the ground', squashed === 0, `${squashed} of ${north.length} wrong`);

/* ------------------------------------------------------------------------ */
group('the payload is small enough to hand MapLibre on every load');

/* ==> THE BINDING COST IS COORDINATES, NOT BYTES, AND MEASURING BYTES WAS
 * WRONG. <== This collection is built in the browser from a catalog that is
 * already loaded and handed to `setData` as a live object — it is never
 * serialised and never crosses the network. What MapLibre actually pays for is
 * tessellating every ring, so that is the number with a ceiling on it. */
const coords = fc.features.reduce(
  (a, f) => a + f.geometry.coordinates.reduce((b, r) => b + r.length, 0),
  0
);
const bytes = JSON.stringify(fc).length;
console.log(
  `    ${fc.features.length} polygons, ${coords} coordinates, ${(bytes / 1024).toFixed(0)} KB if serialised`
);
ok('under 60,000 coordinates to tessellate', coords < 60000, String(coords));
ok('and small enough in memory to be uninteresting', bytes < 1024 * 1024, `${(bytes / 1024).toFixed(0)} KB`);

/* ------------------------------------------------------------------------ */
group('the footprint lands in a range a phone can use');

const cone = shouldExtrude.find((m) => m.family === FAMILY.cone);
const coneF = fc.features.find((f) => f.properties.n === cone.n);
const cR = coneF.geometry.coordinates[0];
const spanDeg = Math.max(...cR.map((p) => p[1])) - Math.min(...cR.map((p) => p[1]));
const spanKm = (spanDeg * Math.PI * 6371) / 180;
console.log(`    a cone (${cone.name}, ${cone.elev} m) spans ${spanKm.toFixed(0)} km`);
/* Small enough that z11 is a mountain rather than a wall you are inside, big
 * enough that z6 is a shape rather than a smudge. */
ok('a cone spans between 15 and 70 km', spanKm > 15 && spanKm < 70, `${spanKm.toFixed(0)} km`);

/* ------------------------------------------------------------------------ */
console.log('\n' + '-'.repeat(60));
if (failures.length) {
  console.log(`FAILED — ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED — ${passed} assertions\n`);
