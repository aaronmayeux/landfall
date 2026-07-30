#!/usr/bin/env node
/**
 * test-plate-lines.mjs — the curved, named plate boundary network
 * (lib/plate-lines.js).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-plate-lines.mjs`, same as every
 * other suite here (§12 — this project has no toolchain by design).
 *
 * ==> THE ONE THING THIS SUITE EXISTS FOR: WHICH SIDE EACH NAME GOES ON. <==
 * Everything else here is arithmetic that would fail loudly. Getting the side
 * wrong fails QUIETLY and beautifully — a clean, well-placed, curve-following
 * label that says PACIFIC over California. Nothing about the render looks
 * broken; the map is just lying. So the six fixtures below are real boundaries
 * whose geography is not in dispute, checked against the compass rather than
 * against the code's own idea of left.
 *
 * THE ICELAND FIXTURE IS THE LOAD-BEARING ONE. It is the same Mid-Atlantic
 * Ridge as the 50°N fixture with `PlateA` and `PlateB` written the other way
 * round, and the sides genuinely swap with it. Any rule of the form "PlateA is
 * the western one" passes five of these six and fails that one.
 *
 * WHAT THIS CANNOT PROVE: that the labels READ well — that a name is legible at
 * the size it lands, that the repeats are not too dense, that turning the globe
 * always leaves one on screen. Those are phone questions. It also cannot prove
 * MapLibre draws what it is handed; the headless harness does that.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { buildPlateLines } = await import('../lib/plate-lines.js');
const { PLATE_NAMES, plateName } = await import('../config/plate-names.js');
const { PLATE_LINE } = await import('../config/constants.js');

const RAW = JSON.parse(readFileSync('assets/hazards/plate-boundaries.geojson', 'utf8'));
const built = buildPlateLines(RAW);

/* ---------------------------------------------------------------------------
 * THE NAME TABLE
 * ------------------------------------------------------------------------- */
section('the fifty-two names');

const codesInData = new Set();
for (const f of RAW.features) {
  codesInData.add(f.properties.PlateA);
  codesInData.add(f.properties.PlateB);
}
const codesInTable = new Set(Object.keys(PLATE_NAMES));

ok(codesInTable.size === 52, `the table holds 52 plates, not ${codesInTable.size}`);
ok(codesInData.size === 52, `the file mentions 52 plates, not ${codesInData.size}`);

/* BOTH DIRECTIONS. A table missing a code draws a two-letter stub on the map; a
 * table with codes the file has never heard of is a sign it came from a
 * different model than the geometry did, which is the worse of the two. */
const missing = [...codesInData].filter((c) => !codesInTable.has(c));
const extra = [...codesInTable].filter((c) => !codesInData.has(c));
ok(!missing.length, `every code in the file has a name (missing: ${missing.join(', ')})`);
ok(!extra.length, `the table invents no plates (extra: ${extra.join(', ')})`);

/* A handful spot-checked against Bird's own publication page, chosen as the ones
 * least likely to be guessed right: an initial that matches nothing in the name,
 * an apostrophe, and two that are easy to confuse with each other. */
ok(plateName('JZ') === 'Juan Fernandez', 'JZ is Juan Fernandez, not Juan de Fuca');
ok(plateName('JF') === 'Juan de Fuca', 'JF is Juan de Fuca');
ok(plateName('NZ') === 'Nazca', 'NZ is Nazca, not New Zealand');
ok(plateName('NI') === "Niuafo'ou", "NI keeps its apostrophe");
ok(plateName('YA') === 'Yangtze', 'YA is Yangtze');

/* §5, applied to a lookup: an unknown code draws visibly rather than silently. */
ok(plateName('ZZ') === 'ZZ', 'an unknown code falls back to itself, never to blank');
ok(plateName(undefined) === '', 'a missing code is empty, not the string "undefined"');

/* ---------------------------------------------------------------------------
 * WHICH SIDE THE NAME GOES ON
 * ------------------------------------------------------------------------- */
section('PlateA is to the LEFT of the direction of travel');

/**
 * For the boundary matching `pair` whose midpoint falls in the given window,
 * return where each plate's label actually landed relative to the seam.
 *
 * MEASURED OFF THE BUILT OUTPUT, not off a re-implementation of the offset
 * maths — a test that recomputes the normal itself would agree with a sign error
 * in `offsetRun` rather than catch it. This compares the label line's own
 * position against the seam it belongs to.
 */
function sides(pair, lonRange, latRange) {
  const idx = RAW.features.findIndex((f) => {
    const p = f.properties;
    if (![p.PlateA, p.PlateB].every((c) => pair.includes(c))) return false;
    if (p.PlateA === p.PlateB) return false;
    const c = f.geometry.coordinates;
    const lon = c.reduce((s, x) => s + x[0], 0) / c.length;
    const lat = c.reduce((s, x) => s + x[1], 0) / c.length;
    return lon > lonRange[0] && lon < lonRange[1] && lat > latRange[0] && lat < latRange[1];
  });
  if (idx < 0) return null;
  const props = RAW.features[idx].properties;

  /* The seam this feature became: matched on its plate pair AND on being the one
   * whose midpoint is closest to the raw feature's, so a plate pair that appears
   * several times around the planet cannot match the wrong copy. */
  const rawC = RAW.features[idx].geometry.coordinates;
  const mid = rawC[Math.floor(rawC.length / 2)];
  const near = (fc) =>
    fc
      .filter((f) => (f.properties.codeA || f.properties.plate) !== undefined)
      .reduce((best, f) => {
        const c = f.geometry.coordinates;
        const m = c[Math.floor(c.length / 2)];
        const d = Math.hypot(m[0] - mid[0], m[1] - mid[1]);
        return !best || d < best.d ? { f, d } : best;
      }, null);

  const seam = near(built.seams.features.filter((f) => f.properties.codeA === props.PlateA && f.properties.codeB === props.PlateB));
  if (!seam) return null;

  /* Compare each plate's `far` label line against the seam at the same point.
   * The offset is perpendicular, so the sign of the cross product of (travel
   * direction) x (seam -> label) is the side, and it is +1 for left. */
  const sc = seam.f.geometry.coordinates;
  const i = Math.floor(sc.length / 2);
  const dir = [sc[Math.min(i + 1, sc.length - 1)][0] - sc[i][0], sc[Math.min(i + 1, sc.length - 1)][1] - sc[i][1]];

  const out = {};
  for (const code of [props.PlateA, props.PlateB]) {
    const name = plateName(code);
    const cand = built.labels.features.filter((f) => f.properties.plate === name && f.properties.band === 'far');
    const best = cand.reduce((b, f) => {
      const c = f.geometry.coordinates;
      const m = c[Math.floor(c.length / 2)];
      const d = Math.hypot(m[0] - sc[i][0], m[1] - sc[i][1]);
      return !b || d < b.d ? { m, d } : b;
    }, null);
    if (!best) return null;
    const off = [best.m[0] - sc[i][0], best.m[1] - sc[i][1]];
    out[code] = Math.sign(dir[0] * off[1] - dir[1] * off[0]);
  }
  return { props, out };
}

/* Six boundaries, and for each one the compass answer somebody can check on a
 * wall map. `+1` means left of travel. */
const FIXTURES = [
  ['San Andreas', ['NA', 'PA'], [-130, -110], [30, 42]],
  ['Japan Trench', ['PA', 'OK'], [139, 148], [33, 42]],
  ['Peru-Chile Trench', ['NZ', 'SA'], [-85, -70], [-35, -10]],
  ['Mid-Atlantic Ridge at 50N', ['NA', 'EU'], [-40, -25], [40, 60]],
  ['Mid-Atlantic Ridge at Iceland', ['EU', 'NA'], [-25, -18], [60, 70]],
  ['Himalayan front', ['EU', 'IN'], [70, 95], [25, 40]],
];

for (const [label, pair, lonR, latR] of FIXTURES) {
  const r = sides(pair, lonR, latR);
  if (!r) {
    failures.push(`${label}: fixture no longer matches any boundary in the file`);
    continue;
  }
  ok(r.out[r.props.PlateA] === 1, `${label}: ${r.props.PlateA} (PlateA) is on the LEFT`);
  ok(r.out[r.props.PlateB] === -1, `${label}: ${r.props.PlateB} (PlateB) is on the RIGHT`);
}

/* AND THE SAME THING STATED AS GEOGRAPHY, for the one case that matters most.
 * If this ever fails, the map says PACIFIC over California. */
const sa = built.labels.features.filter(
  (f) => f.properties.band === 'far' && f.geometry.coordinates.some((c) => c[0] > -126 && c[0] < -112 && c[1] > 33 && c[1] < 41)
);
const meanLon = (name) => {
  const f = sa.filter((x) => x.properties.plate === name);
  const all = f.flatMap((x) => x.geometry.coordinates);
  return all.length ? all.reduce((s, c) => s + c[0], 0) / all.length : NaN;
};
ok(
  meanLon('North America') > meanLon('Pacific'),
  `over California, North America labels sit EAST of Pacific ones (${meanLon('North America').toFixed(1)} vs ${meanLon('Pacific').toFixed(1)})`
);

/* ---------------------------------------------------------------------------
 * THE CURVE
 * ------------------------------------------------------------------------- */
section('smoothing');

const rawVerts = RAW.features.reduce((s, f) => s + f.geometry.coordinates.length, 0);
ok(built.stats.vertices > rawVerts * 2, `the network gains vertices (${rawVerts} -> ${built.stats.vertices})`);
ok(built.stats.boundaries === RAW.features.length, `every boundary survives (${built.stats.boundaries})`);

/* THE HONESTY PROPERTY, INHERITED FROM THE STORM TRACKS: the curve passes
 * exactly through every published vertex. It bends the space BETWEEN
 * measurements and never moves one. Checked on the longest boundary, which is
 * also the one whose budget is tightest. */
const longest = RAW.features.reduce((a, b) =>
  b.geometry.coordinates.length > a.geometry.coordinates.length ? b : a
);
const longestOut = built.seams.features.reduce((a, b) =>
  b.geometry.coordinates.length > a.geometry.coordinates.length ? b : a
);
const hasPoint = (coords, p) =>
  coords.some((c) => Math.abs(c[0] - p[0]) < 1e-6 && Math.abs(c[1] - p[1]) < 1e-6);
const kept = longest.geometry.coordinates.filter((p) => hasPoint(longestOut.geometry.coordinates, p)).length;
ok(
  kept === longest.geometry.coordinates.length,
  `the curve passes through all ${longest.geometry.coordinates.length} published vertices of the longest boundary (${kept} found)`
);

/* Budget. A pathological boundary costs a coarser line, never the frame. */
const worst = Math.max(...built.seams.features.map((f) => f.geometry.coordinates.length));
ok(worst <= PLATE_LINE.maxVerticesPerBoundary + 2, `the longest seam lands at ${worst}, inside the per-boundary ceiling`);

/* ---------------------------------------------------------------------------
 * THE THINGS THAT KILL A WHOLE SOURCE
 * ------------------------------------------------------------------------- */
section('coordinate validity');

/* ==> LATITUDE PAST 90 IS NOT A COSMETIC FAULT. <== geojson-vt fails on it and
 * MapLibre then tiles the ENTIRE source to nothing — every plate label on the
 * planet gone because of two vertices in the Arctic, with no error logged
 * anywhere. That is exactly how it presented before the clamp went in. */
const allLabelCoords = built.labels.features.flatMap((f) => f.geometry.coordinates);
ok(allLabelCoords.every((c) => Math.abs(c[1]) <= 90), 'no label coordinate escapes latitude 90');
ok(allLabelCoords.every((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])), 'no label coordinate is NaN');
ok(
  built.seams.features.flatMap((f) => f.geometry.coordinates).every((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])),
  'no seam coordinate is NaN'
);

/* Every label line needs two points to place text along. A one-point "line" is
 * silently dropped by MapLibre rather than reported. */
ok(built.labels.features.every((f) => f.geometry.coordinates.length >= 2), 'every label line has at least two vertices');

/* THE ANTIMERIDIAN SPLIT, on synthetic input — today's file is already
 * pre-split, so the real data cannot exercise this. A missed split draws a
 * straight line through the middle of the planet on the 3D globe. */
const jumper = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { PlateA: 'PA', PlateB: 'NA', Type: '' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [176, 50], [178, 51], [-178, 52], [-176, 53],
        ],
      },
    },
  ],
};
const split = buildPlateLines(jumper);
ok(split.seams.features.length === 2, `a boundary crossing 180 splits in two (got ${split.seams.features.length})`);
ok(
  split.seams.features.every((f) =>
    f.geometry.coordinates.every((c, i, a) => i === 0 || Math.abs(c[0] - a[i - 1][0]) < 180)
  ),
  'neither half contains a jump across the antimeridian'
);

/* A POLAR BOUNDARY, also synthetic. This is the fixture that would have caught
 * the whole-source failure above before it happened. */
const polar = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { PlateA: 'NA', PlateB: 'EU', Type: '' },
      geometry: { type: 'LineString', coordinates: [[0, 86], [10, 87], [20, 88], [30, 88.5]] },
    },
  ],
};
const polarOut = buildPlateLines(polar);
ok(
  polarOut.labels.features.flatMap((f) => f.geometry.coordinates).every((c) => Math.abs(c[1]) <= 90),
  'a boundary near the pole still yields legal latitudes'
);

/* ---------------------------------------------------------------------------
 * THE TIER LADDER
 * ------------------------------------------------------------------------- */
section('ranking');

const tierOfPlate = (name) => {
  const f = built.labels.features.find((x) => x.properties.plate === name);
  return f ? f.properties.tier : null;
};
ok(tierOfPlate('Pacific') === 1, 'Pacific is tier 1');
ok(tierOfPlate('Eurasia') === 1, 'Eurasia is tier 1');
ok(tierOfPlate('Antarctica') === 1, 'Antarctica is tier 1');
ok(tierOfPlate('Nazca') === 2, 'Nazca is tier 2');
ok(tierOfPlate('Manus') === 3, 'Manus, the smallest, is tier 3');

/* SEVEN IN TIER 1, and the number is the check. The thresholds were read off a
 * step in the measured data (Australia 378° then a gap to Somalia 222°); if a
 * future boundary file moves that step, this fails and the constant gets
 * re-derived rather than silently admitting fifteen plates to the planet band. */
const tier1 = new Set(
  built.labels.features.filter((f) => f.properties.tier === 1).map((f) => f.properties.plate)
);
ok(tier1.size === 7, `seven plates reach tier 1, not ${tier1.size} (${[...tier1].sort().join(', ')})`);

/* A boundary takes the BETTER of its two plates' tiers, so a major plate's seam
 * is never held back by whichever fragment is on the other side. */
const cocosNazca = built.seams.features.find(
  (f) => f.properties.codeA === 'CO' && f.properties.codeB === 'NZ'
);
if (cocosNazca) ok(cocosNazca.properties.tier === 2, 'the Cocos-Nazca seam takes the better of its two tiers');

/* ---------------------------------------------------------------------------
 * COST
 * ------------------------------------------------------------------------- */
section('cost');
const t0 = performance.now();
for (let i = 0; i < 5; i++) buildPlateLines(RAW);
const ms = (performance.now() - t0) / 5;
/* Generous on purpose: this is a ONE-TIME cost after a fetch, off the
 * first-paint path, and the bound exists to catch an accidental order-of-
 * magnitude regression rather than to police the number. Server hardware runs
 * this near 20 ms; a phone is a few times that. */
ok(ms < 250, `the whole network builds in ${ms.toFixed(1)} ms`);
ok(built.stats.labels === built.stats.boundaries * 4, `four label lines per boundary (${built.stats.labels})`);

/* --- report --------------------------------------------------------------- */
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (sides, curve and ranking are checked; whether a name READS on a phone is glass)');
