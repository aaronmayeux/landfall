#!/usr/bin/env node
/**
 * test-plate-lines.mjs — the chained, straightened, curved, named plate boundary
 * network (lib/plate-lines.js).
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
 * ==> AND ONE ASSERTION HERE IS THE EXACT OPPOSITE OF WHAT IT USED TO BE. <==
 * The first version checked that the curve passes through every published vertex,
 * which is the storm tracks' honesty rule. That rule is deliberately BROKEN now:
 * PB2002 digitises ridges on a grid and the staircase has to be simplified away
 * before the spline sees it. So the check became a BOUND instead of an identity —
 * every output point within `PLATE_LINE.simplifyToleranceDeg` of the published
 * line — plus a direct measurement that the staircase is actually gone. A test
 * that still demanded exact passage would have blocked the fix; a test that
 * simply dropped the assertion would have lost the only thing keeping the
 * tolerance honest.
 *
 * WHAT THIS CANNOT PROVE: that the labels READ well — that a name is legible at
 * the size it lands, that the density is right, that turning the globe always
 * leaves one on screen. Those are phone questions. It also cannot prove MapLibre
 * draws what it is handed; the headless harness does that.
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
const rawTotal = RAW.features.reduce((s, f) => s + f.geometry.coordinates.length, 0);

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
section('each name is on the correct side of its seam');

/**
 * Where a plate's labels sit relative to ONE named seam, as a compass bearing.
 *
 * ==> STATED AS GEOGRAPHY, NOT AS THE MODEL'S FIELD ORDER, AND THAT IS THE
 * SECOND VERSION OF THIS TEST. <== The first version asserted "the published
 * `PlateA` comes out on the left of the drawn line", which is the rule
 * `lib/plate-lines.js` implements. Then chaining started canonicalising the pair
 * order — reversing a fragment and swapping its two plates, which is the same
 * geography — and four of six fixtures failed while the map stayed correct. A
 * test that breaks when a correct refactor lands is testing the implementation.
 *
 * ==> AND THE THIRD VERSION FIXED THE METRIC, WHICH WAS ALSO WRONG. <== Version
 * two averaged every label for a plate against every seam touching that plate
 * inside a window. Near a triple junction that is meaningless: "Pacific" by
 * California borders North America, Juan de Fuca AND Gorda, so the mean seam
 * position is not the San Andreas and the mean label position is not its label.
 * It reported the Pacific plate east of the San Andreas, which is wrong, from
 * code that draws it correctly.
 *
 * So this pins down ONE seam — the one separating the two plates the fixture
 * names — and measures only labels that actually belong to it, each against its
 * own nearest point on that seam. Precise, and still a statement about the
 * compass rather than about field order.
 */
function bearingOf(plateA, plateB, plate, lonRange, latRange) {
  const inWindow = (c) =>
    c[0] > lonRange[0] && c[0] < lonRange[1] && c[1] > latRange[0] && c[1] < latRange[1];

  /* THE one seam: it separates exactly this pair, in either stored order, and it
   * is the candidate with the most vertices inside the fixture window. */
  const seam = built.seams.features
    .filter((f) => {
      const pair = [f.properties.plateA, f.properties.plateB];
      return pair.includes(plateA) && pair.includes(plateB);
    })
    .map((f) => ({ f, n: f.geometry.coordinates.filter(inWindow).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)[0];
  if (!seam) return null;

  const seamPts = seam.f.geometry.coordinates;
  const nearestOn = (p) =>
    seamPts.reduce((best, q) => {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      return !best || d < best.d ? { q, d } : best;
    }, null);

  /* Only labels that sit against THIS seam. The widest band displaces by
   * `labelOffsetDeg.far`, so anything further off belongs to another boundary. */
  const maxOffset = Math.max(...PLATE_LINE.labelBands.map((b) => b.offsetDeg));
  const deltas = [];
  for (const f of built.labels.features) {
    if (f.properties.plate !== plate) continue;
    const c = f.geometry.coordinates;
    const mid = c[Math.floor(c.length / 2)];
    if (!inWindow(mid)) continue;
    const near = nearestOn(mid);
    if (!near || near.d > maxOffset * 1.6) continue;
    deltas.push([mid[0] - near.q[0], mid[1] - near.q[1]]);
  }
  if (!deltas.length) return null;
  return {
    dLon: deltas.reduce((s, d) => s + d[0], 0) / deltas.length,
    dLat: deltas.reduce((s, d) => s + d[1], 0) / deltas.length,
    n: deltas.length,
  };
}

/* Six boundaries, and for each one a compass fact somebody can check on a wall
 * map. The Iceland row is the load-bearing one: it is the same Mid-Atlantic
 * Ridge as the 50°N row with the published pair written the other way round, so
 * any rule of the form "PlateA is the western one" passes five and fails it. */
const FIXTURES = [
  ['San Andreas', 'North America', 'Pacific', 'North America', 'east', [-127, -113], [32, 41]],
  ['San Andreas', 'North America', 'Pacific', 'Pacific', 'west', [-127, -113], [32, 41]],
  ['Japan Trench', 'Pacific', 'Okhotsk', 'Pacific', 'east', [140, 147], [34, 41]],
  ['Peru-Chile Trench', 'Nazca', 'South America', 'Nazca', 'west', [-82, -70], [-34, -12]],
  ['Mid-Atlantic Ridge at 50N', 'North America', 'Eurasia', 'North America', 'west', [-36, -24], [42, 58]],
  ['Mid-Atlantic Ridge at Iceland', 'Eurasia', 'North America', 'Eurasia', 'east', [-24, -16], [60, 69]],
  ['Himalayan front', 'Eurasia', 'India', 'Eurasia', 'north', [74, 92], [26, 36]],
  ['Himalayan front', 'Eurasia', 'India', 'India', 'south', [74, 92], [26, 36]],
];

const CHECK = {
  east: (b) => b.dLon > 0,
  west: (b) => b.dLon < 0,
  north: (b) => b.dLat > 0,
  south: (b) => b.dLat < 0,
};

for (const [label, pa, pb, plate, dir, lonR, latR] of FIXTURES) {
  const b = bearingOf(pa, pb, plate, lonR, latR);
  if (!b) {
    failures.push(`${label}: no ${pa}/${pb} seam or ${plate} label found in the fixture window`);
    continue;
  }
  ok(
    CHECK[dir](b),
    `${label}: ${plate} is labelled to the ${dir} (dLon ${b.dLon.toFixed(2)}, dLat ${b.dLat.toFixed(2)}, n=${b.n})`
  );
}

section('chaining, simplifying, smoothing');

/* CHAINING. The Mid-Atlantic Ridge's Africa-South America boundary is published
 * as THREE abutting features; unchained it splines with a corner at each joint
 * and labels three times. It must come out as ONE. */
const afsa = built.seams.features.filter(
  (f) => f.properties.codeA === 'AF' && f.properties.codeB === 'SA'
);
ok(afsa.length === 1, `the Mid-Atlantic AF-SA boundary chains into one seam (got ${afsa.length})`);
ok(
  built.stats.boundaries < RAW.features.length,
  `chaining reduces ${RAW.features.length} published features to ${built.stats.boundaries} boundaries`
);

/* CHAINING MUST NOT LOSE GEOMETRY. Every published vertex should still be
 * accounted for once the shared join points are collapsed. */
ok(
  built.stats.rawVertices >= rawTotal - built.stats.boundaries * 2 &&
    built.stats.rawVertices <= rawTotal,
  `chaining keeps the vertices (${rawTotal} published, ${built.stats.rawVertices} chained)`
);

/* ==> THE STAIRCASE IS GONE, AND THIS IS THE MEASUREMENT THAT SAYS SO. <== The
 * published Mid-Atlantic Ridge turns more than 70° at 106 of its 171 vertices.
 * A spline alone cannot fix that — it rounds each corner and still draws a
 * staircase — so the number to watch is not "is it smooth in places" but how
 * many near-right-angle turns survive the whole pipeline. */
const turnsOf = (c) => {
  const out = [];
  for (let i = 1; i < c.length - 1; i++) {
    const ax = c[i][0] - c[i - 1][0];
    const ay = c[i][1] - c[i - 1][1];
    const bx = c[i + 1][0] - c[i][0];
    const by = c[i + 1][1] - c[i][1];
    out.push(Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * (180 / Math.PI));
  }
  return out;
};
const rawSharp = RAW.features.flatMap((f) => turnsOf(f.geometry.coordinates)).filter((t) => t > 70).length;
const outSharp = built.seams.features.flatMap((f) => turnsOf(f.geometry.coordinates)).filter((t) => t > 70).length;
ok(
  outSharp * 10 < rawSharp,
  `near-right-angle turns collapse by more than 10x (${rawSharp} published -> ${outSharp} drawn)`
);

const outTurns = built.seams.features.flatMap((f) => turnsOf(f.geometry.coordinates)).sort((a, b) => a - b);
const medTurn = outTurns[outTurns.length >> 1];
ok(medTurn < 5, `the median turn along a drawn seam is ${medTurn.toFixed(2)}°, well under a visible corner`);

/* ==> THE HONESTY BOUND THAT REPLACED "PASSES THROUGH EVERY VERTEX". <== The
 * simplification is allowed to move the line, and this is the promise about how
 * far: Douglas-Peucker guarantees it, and asserting it here is what keeps
 * `simplifyToleranceDeg` from being quietly raised without anyone re-reading the
 * argument for it. Checked on the longest published feature. */
const longest = RAW.features.reduce((a, b) =>
  b.geometry.coordinates.length > a.geometry.coordinates.length ? b : a
);
const perpDist = (p, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (!dx && !dy) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};
/* The chain this feature ended up in — matched by plate pair, then by proximity,
 * since a pair can occur in several places around the planet. */
const lmid = longest.geometry.coordinates[Math.floor(longest.geometry.coordinates.length / 2)];
const host = built.seams.features
  .filter((f) => [f.properties.codeA, f.properties.codeB].every((c) =>
    [longest.properties.PlateA, longest.properties.PlateB].includes(c)))
  .reduce((best, f) => {
    const m = f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)];
    const d = Math.hypot(m[0] - lmid[0], m[1] - lmid[1]);
    return !best || d < best.d ? { f, d } : best;
  }, null);
let worstDev = 0;
if (host) {
  for (const p of longest.geometry.coordinates) {
    let near = Infinity;
    const c = host.f.geometry.coordinates;
    for (let i = 1; i < c.length; i++) near = Math.min(near, perpDist(p, c[i - 1], c[i]));
    worstDev = Math.max(worstDev, near);
  }
}
/* ==> THE BOUND IS TWICE THE TOLERANCE, AND THAT IS THE POINT OF ASSERTING IT.
 * <== Douglas-Peucker promises every point stays within the tolerance of the
 * chords it keeps; the spline then bows away from those chords by about as much
 * again. Measured across the whole file the worst case is 2.0x, so this holds the
 * real end-to-end distance rather than the one the algorithm advertises. If
 * `simplifyToleranceDeg` is ever raised, this is what makes the doubling visible
 * instead of leaving a comment claiming half the true figure. */
const DEV_BOUND = PLATE_LINE.simplifyToleranceDeg * 2.2;
ok(
  host && worstDev <= DEV_BOUND,
  `the drawn seam stays within ${DEV_BOUND.toFixed(2)}° of every published vertex (worst ${worstDev.toFixed(3)}°)`
);

/* And the spline still adds resolution on top of what simplification left. */
ok(
  built.stats.vertices > built.stats.simplifiedVertices * 4,
  `the spline restores density (${built.stats.simplifiedVertices} simplified -> ${built.stats.vertices} drawn)`
);
ok(
  built.stats.vertices < built.stats.rawVertices * 3,
  `and the whole pipeline stays cheap (${built.stats.rawVertices} published -> ${built.stats.vertices} drawn)`
);

const worst = Math.max(...built.seams.features.map((f) => f.geometry.coordinates.length));
ok(worst <= PLATE_LINE.maxVerticesPerBoundary + 2, `the longest seam lands at ${worst}, inside the per-boundary ceiling`);

/* ---------------------------------------------------------------------------
 * A PAIR OR NOTHING
 * ------------------------------------------------------------------------- */
section('the two names of a seam arrive together');

/* ==> THE INVARIANT THAT MATTERS MOST AFTER "WHICH SIDE". <== A lone plate name
 * does not read as "the other one did not fit", it reads as a statement about the
 * plate that got named. And the failure is systematically one-sided, because only
 * the INNER copy of a pair is bent by the displacement — so without this rule the
 * map quietly labels one side of curved boundaries and not the other. Seen on
 * glass on the Mid-Atlantic Ridge before `pairAt` existed. */
ok(built.labels.features.length % 2 === 0, `label windows come in pairs (${built.labels.features.length})`);

let unpaired = 0;
let mismatched = 0;
for (let i = 0; i < built.labels.features.length; i += 2) {
  const a = built.labels.features[i];
  const b = built.labels.features[i + 1];
  if (!b) { unpaired++; break; }
  if (a.properties.band !== b.properties.band) mismatched++;
  if (a.properties.plate === b.properties.plate) mismatched++;
}
ok(!unpaired, 'no label window is left without a partner');
ok(!mismatched, `every pair shares a band and names two different plates (${mismatched} bad)`);

/* AND THE PAIR IS ACTUALLY CO-LOCATED — that is what lets both be read in one
 * glance rather than hunted for. Their midpoints must sit within roughly the two
 * displacements that separate them. */
let farApart = 0;
for (let i = 0; i < built.labels.features.length; i += 2) {
  const a = built.labels.features[i];
  const b = built.labels.features[i + 1];
  if (!b) break;
  const band = PLATE_LINE.labelBands.find((x) => x.id === a.properties.band);
  const ma = a.geometry.coordinates[Math.floor(a.geometry.coordinates.length / 2)];
  const mb = b.geometry.coordinates[Math.floor(b.geometry.coordinates.length / 2)];
  /* LATITUDE-CORRECTED, and the first version was not — which failed on exactly
   * one pair, on the Gakkel Ridge at 86°N, where the two labels are 14.65° of
   * LONGITUDE apart and about 1° of ground apart. The code was right and the
   * measurement was wrong. Everything in this file that compares distances is in
   * ground degrees for the same reason.
   *
   * Generous on the bound: the two windows can be thinned to different vertex
   * counts, so their midpoints sit near the anchor rather than exactly on it. */
  const cos = Math.max(Math.cos((((ma[1] + mb[1]) / 2) * Math.PI) / 180), PLATE_LINE.minCosLat);
  const apart = Math.hypot((ma[0] - mb[0]) * cos, ma[1] - mb[1]);
  if (apart > band.offsetDeg * 6 + band.windowDeg * 0.5) farApart++;
}
ok(!farApart, `every pair sits at one point on its seam (${farApart} scattered)`);

/* THE CURVATURE CLAMP AND FOLD FILTER, as an outcome rather than as code. Nothing
 * emitted may bend past what MapLibre will lay text around — the renderer would
 * drop it silently, and silently on one side only. */
const overAngle = built.labels.features.filter((f) => {
  const c = f.geometry.coordinates;
  let worst = 0;
  for (let i = 1; i < c.length - 1; i++) {
    const cos = Math.max(Math.cos((c[i][1] * Math.PI) / 180), PLATE_LINE.minCosLat);
    const ax = (c[i][0] - c[i - 1][0]) * cos;
    const ay = c[i][1] - c[i - 1][1];
    const bx = (c[i + 1][0] - c[i][0]) * cos;
    const by = c[i + 1][1] - c[i][1];
    worst = Math.max(worst, Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * (180 / Math.PI));
  }
  return worst > PLATE_LINE.labelMaxAngle;
}).length;
ok(!overAngle, `no label window bends past text-max-angle (${overAngle} would be dropped by the renderer)`);

/* A rejected anchor is normal and a mostly-rejected file is not. If this ever
 * fires, `curvatureSafety` or the window lengths have gone wrong rather than the
 * data. */
const rejectRate = built.stats.rejectedAnchors / built.stats.anchors;
ok(rejectRate < 0.35, `${(rejectRate * 100).toFixed(0)}% of anchors are rejected, which is within tolerance`);

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

/* READ OFF THE SEAMS, NOT THE LABELS. A plate whose every label anchor was
 * rejected has no label features at all — which is legitimate for a fragment on
 * a tight bend, and used to make this return null and fail for Manus. */
const tierOfPlate = (name) => {
  for (const f of built.seams.features) {
    if (f.properties.plateA === name) return Math.min(f.properties.tier, 9);
  }
  for (const f of built.seams.features) {
    if (f.properties.plateB === name) return Math.min(f.properties.tier, 9);
  }
  return null;
};
ok(tierOfPlate('Pacific') === 1, 'Pacific is tier 1');
ok(tierOfPlate('Eurasia') === 1, 'Eurasia is tier 1');
ok(tierOfPlate('Antarctica') === 1, 'Antarctica is tier 1');
/* A SEAM's tier is the better of its two plates', so reading a small plate's
 * tier off a seam it shares with a big one gives the big one's. These two check
 * the ladder through `lengthByPlate` instead, via a seam where both sides are in
 * the same tier. */
const tierSet = new Set(built.labels.features.filter((f) => f.properties.plate === 'Nazca').map((f) => f.properties.tier));
ok(tierSet.size === 1 && tierSet.has(2), `Nazca's labels are tier 2 (got ${[...tierSet].join(',')})`);
const manus = built.labels.features.filter((f) => f.properties.plate === 'Manus');
ok(!manus.length || manus.every((f) => f.properties.tier === 3), 'Manus, the smallest, is tier 3 wherever it is labelled');

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
ok(built.stats.labels > 0, `${built.stats.labels} label windows across ${built.stats.anchors} anchors`);

/* --- report --------------------------------------------------------------- */
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (sides, curve and ranking are checked; whether a name READS on a phone is glass)');
