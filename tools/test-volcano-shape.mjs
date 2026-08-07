/**
 * test-volcano-shape.mjs — the Phase F family mapping, against the SHIPPED
 * catalog rather than a fixture.
 *
 * ==> THE ONE THING WORTH LOCKING IS THAT NOTHING FALLS THROUGH. <== The
 * classifier has a stated fallback (`cone`), which is correct behaviour and
 * also the exact shape of a silent bug: a catalog refetch that introduces a
 * new `type` string would render it as a stratovolcano and say nothing. This
 * suite fails loudly on that, and on nothing else that a glass read would
 * answer better.
 *
 * Deliberately NOT tested: whether a shield LOOKS flatter than a cone, whether
 * the exaggeration curve is right, whether any of it reads at 10 px. Those are
 * glass questions and a fixture that passed them would be worse than nothing
 * (SPEC.md — when a fixture passes and glass fails, stop building fixtures).
 *
 *   node tools/test-volcano-shape.mjs
 */

import { readFileSync } from 'node:fs';
import { FAMILY, EDIFICE_FAMILIES, volcanoFamily, volcanoFamilyIsFallback } from '../lib/volcano-shape.js';
import { VOLCANO } from '../config/volcano.js';

const CATALOG = JSON.parse(readFileSync('assets/hazards/volcanoes-holocene.geojson', 'utf8'));
const FEATURES = CATALOG.features || [];
const M = VOLCANO.marks;
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

console.log('volcano shape families — against the shipped catalog');

/* ------------------------------------------------------------------------ */
group('the catalog is the one we think it is');

ok('catalog parses with features', FEATURES.length > 0, `${FEATURES.length} features`);
ok('catalog is 1,196 positioned volcanoes', FEATURES.length === 1196, `got ${FEATURES.length}`);

/* ------------------------------------------------------------------------ */
group('every volcano lands in a real family');

const counts = {};
const fellThrough = [];
for (const f of FEATURES) {
  const p = f.properties || {};
  const fam = volcanoFamily(p);
  counts[fam] = (counts[fam] || 0) + 1;
  if (volcanoFamilyIsFallback(p)) fellThrough.push(`${p.name} (type=${p.type}, landform=${p.landform})`);
}

const known = new Set(Object.values(FAMILY));
ok(
  'every result is one of the six families',
  Object.keys(counts).every((k) => known.has(k)),
  Object.keys(counts).join(', ')
);

/* ==> THE ASSERTION THIS FILE EXISTS FOR. <== Not "the fallback is never
 * used" as a matter of taste — it is that the shipped catalog contains no
 * type or landform string the table has not been shown. The moment a refetch
 * adds one, this is the line that goes red. */
ok(
  'no volcano reaches the stated fallback',
  fellThrough.length === 0,
  fellThrough.length ? `${fellThrough.length}: ${fellThrough.slice(0, 5).join(' · ')}` : ''
);

const total = Object.values(counts).reduce((a, b) => a + b, 0);
ok('every feature classified exactly once', total === FEATURES.length, `${total} of ${FEATURES.length}`);

console.log(
  '    ' +
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ')
);

/* ------------------------------------------------------------------------ */
group('the families the spec argues for actually exist in the data');

/* Six families is a claim about the catalog, not a wish. If any one of them
 * is empty across all 1,196, that family is geometry nobody will ever see and
 * the spec should say so instead of the code carrying it. */
for (const fam of Object.values(FAMILY)) {
  ok(`family '${fam}' is populated`, (counts[fam] || 0) > 0, `${counts[fam] || 0}`);
}

ok(
  'cones dominate, as §42.1.2 assumes',
  counts[FAMILY.cone] > counts[FAMILY.shield],
  `cone ${counts[FAMILY.cone]} vs shield ${counts[FAMILY.shield]}`
);

/* ------------------------------------------------------------------------ */
group('§42.1.4 — the two sets that are not mountains');

/* A volcanic field must never be an edifice. This is the fabrication test:
 * "West Eifel Volcanic Field" drawn as a single cone is the layer inventing a
 * mountain that is not there. */
ok(
  'volcanic fields are never an edifice family',
  !EDIFICE_FAMILIES.includes(FAMILY.field),
  'field is in EDIFICE_FAMILIES'
);

const clustersAsEdifice = FEATURES.filter(
  (f) => (f.properties || {}).landform === 'Cluster' && EDIFICE_FAMILIES.includes(volcanoFamily(f.properties))
);
/* Fissures ARE clusters and are meant to stay a ridge — they are the one
 * multi-vent form with its own silhouette. Everything else that carries
 * `Cluster` must have been demoted. */
ok(
  'the only clusters left as edifices are fissures',
  clustersAsEdifice.every((f) => volcanoFamily(f.properties) === FAMILY.fissure),
  clustersAsEdifice
    .filter((f) => volcanoFamily(f.properties) !== FAMILY.fissure)
    .map((f) => `${f.properties.name}=${volcanoFamily(f.properties)}`)
    .slice(0, 5)
    .join(' · ')
);

/* ------------------------------------------------------------------------ */
group('the drawn set — what the quiet tier actually asks the mesh to build');

const tier = FEATURES.filter((f) => Number((f.properties || {})[M.tierField] || 0) >= M.tierMin);
ok('the quiet tier is still 128', tier.length === 128, `got ${tier.length}`);

const tierFams = {};
for (const f of tier) {
  const fam = volcanoFamily(f.properties);
  tierFams[fam] = (tierFams[fam] || 0) + 1;
}
console.log(
  '    ' +
    Object.entries(tierFams)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ')
);

const tierSubmarine = tier.filter((f) => Number(f.properties.elev) < 0);
ok('seven of the tier are underwater', tierSubmarine.length === 7, `${tierSubmarine.length}`);

/* ------------------------------------------------------------------------ */
group('the geometry numbers exist for every family the classifier can return');

for (const fam of Object.values(FAMILY)) {
  if (fam === FAMILY.field) continue;
  const spec = SH.families[fam];
  ok(`'${fam}' has geometry constants`, !!spec, 'missing from VOLCANO.shapes.families');
  if (!spec) continue;
  ok(`'${fam}' width ratio is positive`, spec.ratio > 0, String(spec.ratio));
  ok(`'${fam}' rim is in 0..1`, spec.rim > 0 && spec.rim <= 1, String(spec.rim));
}

/* §42.1.2's ONE absolute claim: rank order is true even though proportion is
 * not. A shield is always flatter than a cone, everywhere, forever. */
ok(
  'a shield is flatter than a cone',
  SH.families[FAMILY.shield].ratio > SH.families[FAMILY.cone].ratio,
  `shield ${SH.families[FAMILY.shield].ratio} vs cone ${SH.families[FAMILY.cone].ratio}`
);
ok(
  'a dome is flatter than a cone and steeper than a shield',
  SH.families[FAMILY.dome].ratio > SH.families[FAMILY.cone].ratio &&
    SH.families[FAMILY.dome].ratio < SH.families[FAMILY.shield].ratio,
  `dome ${SH.families[FAMILY.dome].ratio}`
);
ok(
  'only the caldera has a notch',
  Object.entries(SH.families).filter(([, v]) => v.notch > 0).length === 1 &&
    SH.families[FAMILY.caldera].notch > 0,
  'notch is not exclusive to caldera'
);
ok(
  'only the fissure is elongated',
  Object.entries(SH.families).filter(([, v]) => v.elongate !== 1).length === 1 &&
    SH.families[FAMILY.fissure].elongate > 1,
  'elongation is not exclusive to fissure'
);

/* ------------------------------------------------------------------------ */
group('the exaggeration curve covers the real elevation range');

const elevs = FEATURES.map((f) => Number(f.properties.elev)).filter(Number.isFinite);
const above = elevs.filter((v) => v >= 0).sort((a, b) => a - b);
ok('floor sits below the median volcano', SH.elevFloorM < above[Math.floor(above.length / 2)],
  `floor ${SH.elevFloorM}, median ${above[Math.floor(above.length / 2)]}`);
ok('peak sits below the tallest', SH.elevPeakM < above[above.length - 1],
  `peak ${SH.elevPeakM}, tallest ${above[above.length - 1]}`);
ok('the smallest edifice still clears the noise floor', SH.minLift > 0.1, String(SH.minLift));
ok('the curve is a perceptual boost, not linear', SH.curve > 0 && SH.curve < 1, String(SH.curve));

/* ------------------------------------------------------------------------ */
console.log('\n' + '-'.repeat(60));
if (failures.length) {
  console.log(`FAILED — ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED — ${passed} assertions\n`);
