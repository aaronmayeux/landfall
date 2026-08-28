/**
 * test-landfall.mjs — the land mask and the track walk.
 * SPEC-SEASONS-BUILD.md §57.7a, `lib/landfall.js`.
 *
 * ==> IT BUILDS ITS OWN CONTINENTS RATHER THAN LOADING A COASTLINE. <== The
 * real coastline is 11.5 MB fetched from GitHub, which this suite must not
 * need — it runs offline, on plain node, in the pre-push hook. More to the
 * point, a synthetic square island has an answer that is known exactly, so
 * "did the walk find the landfall" is a real question rather than a comparison
 * against another approximation. The real coastline is exercised by
 * `tools/seasons-landfall.mjs --check`, which prints its agreement with NOAA
 * on every run.
 *
 * ==> EVERY SECTION WAS MUTATION-CHECKED AND THE MUTATIONS ARE NAMED. <== §12:
 * a test that passes on the same wrong assumption as the bug is worse than no
 * test. Each section says what was broken to prove it bites.
 *
 *   node tools/test-landfall.mjs
 */

import { SEASONS } from '../config/constants.js';
import { cameAshore, landfallsFor } from '../lib/landfall.js';
import { buildLandMask } from './land-raster.mjs';

let passed = 0;
const failures = [];
const ok = (what, cond) => {
  if (cond) { passed++; console.log(`  ok    ${what}`); }
  else { failures.push(what); console.log(`  FAIL  ${what}`); }
};
const eq = (what, got, want) => ok(`${what} — got ${JSON.stringify(got)}`,
  JSON.stringify(got) === JSON.stringify(want));
const section = (t) => console.log(`\n${t}`);

/** A closed rectangular ring, counter-clockwise. */
const box = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];

const HOUR = 3600 * 1000;
/** A fix. Defaults are a hurricane, so a test that cares about status says so. */
const fix = (h, lon, lat, over = {}) => ({
  time: h * 6 * HOUR, lat, lonU: lon, lon, status: 'HU', windKt: 80, pressureMb: 960, ...over,
});

/* ---------------------------------------------------------------------------
 * 1. THE MASK
 * ------------------------------------------------------------------------- */

section('1. The mask says land where land is and water where it is not');

/* A 10x10 degree continent in the north Atlantic's empty quarter, plus a lake
 * cut out of the middle of it as an inner ring. */
const CONTINENT = box(-40, 10, -30, 20);
const LAKE = box(-36, 14, -34, 16);
const mask = buildLandMask([CONTINENT, LAKE]);

ok('the middle of the continent is land', mask.isLand(-38, 12));
ok('a degree outside it is water', mask.isLand(-41, 12) === false);
ok('and the far side is water too', mask.isLand(-29, 12) === false);

/* ==> MUTATION: filling from `xs[0]` to `xs[xs.length - 1]` rather than
 * between alternating pairs turns section 9 red.
 *
 * ==> AND ONE MUTATION WAS TRIED AND DOES NOT BITE, WHICH IS RECORDED RATHER
 * THAN QUIETLY DROPPED. <== Removing the half-open `(y0 > y) === (y1 > y)`
 * test changes no answer this suite can produce — boxes, lakes and a spike
 * with its apex exactly on a scanline were all tried. The row bucketing in
 * `buildLandMask` already excludes the edges that test would have. The line
 * stays for the day that bucketing changes; it is uncovered and `lib/landfall.js`
 * says so at the line itself. */

eq('the mask covers the whole globe at the configured cell',
  [mask.width, mask.height, mask.step],
  [Math.round(360 / SEASONS.landfallMaskStep),
    Math.round((SEASONS.landfallMaskLatMax - SEASONS.landfallMaskLatMin) / SEASONS.landfallMaskStep),
    SEASONS.landfallMaskStep]);

section('2. An inner ring is a hole, with no ring-nesting logic anywhere');

ok('the lake in the middle of the continent is water', mask.isLand(-35, 15) === false);
ok('but the land just outside the lake is still land', mask.isLand(-37, 15));

/* ==> MUTATION: filling from the first crossing to the LAST on each row rather
 * than between alternating pairs makes the lake land. The first of these two
 * goes red and the second stays green, which is the pair working. */

section('3. Out of the mask\'s latitude band is water, not an error');

ok('above the band', mask.isLand(-38, 85) === false);
ok('below the band', mask.isLand(-38, -85) === false);
ok('a nonsense coordinate is water rather than a throw', mask.isLand(NaN, 12) === false);

section('4. An unwrapped longitude is wrapped once, at the mask door');

/* `lib/hurdat.js` carries `lonU` so a track crossing the date line stays one
 * continuous line — a storm at 190° is really at -170°. The walk hands that
 * straight through, so the mask is the only place the wrap can happen. */
const PACIFIC = box(-175, 10, -165, 20);
const wrapMask = buildLandMask([PACIFIC]);
ok('a real longitude finds the island', wrapMask.isLand(-170, 15));
ok('==> AND SO DOES THE UNWRAPPED ONE 360 DEGREES ON <==', wrapMask.isLand(190, 15));
ok('and 360 the other way', wrapMask.isLand(-530, 15));

/* Twice round. A storm that loops back across the date line more than once is
 * why the wrap is a `while` and not an `if`, and these two are the assertions
 * that hold it there — a single `if` leaves 550 at 190 and -890 at -530, both
 * outside the mask. */
ok('and twice round, eastward', wrapMask.isLand(550, 15));
ok('and twice round, westward', wrapMask.isLand(-890, 15));

/* ==> MUTATION: replacing either `while` with a single `if` turns one of the
 * two lines above red. Deleting the wrap entirely takes four of the five. */

/* ---------------------------------------------------------------------------
 * 5. THE WALK
 * ------------------------------------------------------------------------- */

section('5. A track crossing the coast reports one landfall, placed and timed');

const ashore = landfallsFor([
  fix(0, -45, 15),   /* well out to sea */
  fix(1, -35, 15),   /* inland */
], mask.isLand);

eq('one landfall', ashore.length, 1);
/* Read through `?.` throughout: a mutation that finds NO landfall here should
 * turn this section red, not throw and take the rest of the suite with it. */
ok(`it sits on the coast at -40, not at either fix — got ${ashore[0]?.lon}`,
  Math.abs((ashore[0]?.lon ?? 0) + 40) <= 0.2);
ok('its time is between the two fixes',
  ashore[0]?.time > fix(0, 0, 0).time && ashore[0]?.time < fix(1, 0, 0).time);
eq('and it is stamped as ours', ashore[0]?.source, 'computed');

/* ==> MUTATION: firing at the FIX rather than at the sample puts the landfall
 * at -35 and the position assertion goes red. Starting the sample loop at k=0
 * rather than k=1 double-counts the shared endpoint between segments and the
 * count assertion goes red on the three-fix cases below. */

section('6. ==> AN ISLAND ENTIRELY BETWEEN TWO FIXES IS STILL A LANDFALL <==');

/* This is the whole reason the path is sampled rather than the fixes tested.
 * The median gap between real fixes is 107 km; this island is 55 km across and
 * neither fix is anywhere near it. */
const islandMask = buildLandMask([box(-40.25, 14.75, -39.75, 15.25)]);
const overIsland = landfallsFor([fix(0, -45, 15), fix(1, -35, 15)], islandMask.isLand);

eq('the crossing is found', overIsland.length, 1);
ok('neither fix is on the island',
  islandMask.isLand(-45, 15) === false && islandMask.isLand(-35, 15) === false);

/* ==> MUTATION: testing only `pts[i]` instead of walking the samples reports
 * zero landfalls here. This is the single assertion that proves the method. */

const coarse = landfallsFor([fix(0, -45, 15), fix(1, -35, 15)], islandMask.isLand, { sampleKm: 500 });
eq('and a sample step wider than the island loses it, which is why the constant is 5 km',
  coarse.length, 0);

section('7. A storm already over land has not come ashore');

const inland = landfallsFor([
  fix(0, -38, 15),   /* starts inland */
  fix(1, -37, 15),
  fix(2, -36.5, 15),
], mask.isLand);
eq('no landfall for a track that never touched water first', inland.length, 0);

/* ==> MUTATION: seeding `wasLand` to false rather than reading the first
 * sample reports a landfall on the first step and this goes red. */

section('8. Only a cyclone comes ashore');

for (const status of ['EX', 'LO', 'WV', 'DB']) {
  eq(`a ${status} crossing the coast is not a landfall`,
    landfallsFor([fix(0, -45, 15, { status }), fix(1, -35, 15, { status })], mask.isLand).length, 0);
}
for (const status of SEASONS.cycloneStatuses) {
  eq(`a ${status} crossing the coast is`,
    landfallsFor([fix(0, -45, 15, { status }), fix(1, -35, 15, { status })], mask.isLand).length, 1);
}

/* ==> MUTATION: dropping the `isCyclone` guard turns the four EX/LO/WV/DB
 * cases red. Hard-coding TD/TS/HU instead of reading SEASONS.cycloneStatuses
 * turns the two subtropical cases red — which is the real bug, since a
 * subtropical storm does come ashore. */

section('9. A storm skimming a ragged coast is one landfall, not six');

/* Two islands 20 km apart. Crossing both is two crossings, but the storm never
 * genuinely went back out to sea. */
const twoIslands = buildLandMask([box(-40.5, 14.5, -40.1, 15.5), box(-39.9, 14.5, -39.5, 15.5)]);
const skim = landfallsFor([fix(0, -45, 15), fix(1, -35, 15)], twoIslands.isLand);
eq('the second crossing inside the separation distance does not count', skim.length, 1);

const separate = landfallsFor([fix(0, -45, 15), fix(1, -35, 15)], twoIslands.isLand, { separationKm: 5 });
eq('with the separation lowered below the gap, both count', separate.length, 2);

/* ==> MUTATION: resetting `waterKm` to 0 only on a landfall rather than on
 * every land sample lets the second island count, and the first goes red.
 * Deleting the separation test entirely does the same. */

section('10. The separation changes the COUNT and never the ANSWER');

for (const separationKm of [0, 5, 50, 500]) {
  ok(`came ashore is true at separation ${separationKm}`,
    cameAshore([fix(0, -45, 15), fix(1, -35, 15)], twoIslands.isLand, { separationKm }));
}

section('11. What was never measured stays null');

const noWind = landfallsFor([
  fix(0, -45, 15, { windKt: null, pressureMb: null }),
  fix(1, -35, 15, { windKt: null, pressureMb: null }),
], mask.isLand);
eq('a landfall with no wind reading carries null, not zero',
  [noWind[0]?.windKt, noWind[0]?.pressureMb, noWind[0]?.category], [null, null, null]);

const halfPressure = landfallsFor([
  fix(0, -45, 15, { pressureMb: 970 }),
  fix(1, -35, 15, { pressureMb: null }),
], mask.isLand);
eq('and a pressure measured at only one end is not half of the other',
  halfPressure[0]?.pressureMb, null);
ok('while the wind, measured at both, is interpolated',
  Number.isFinite(halfPressure[0]?.windKt));

/* ==> MUTATION: `(a + b) / 2` or `a ?? b` in `lerpOrNull` turns the second
 * assertion red — 970 would arrive as a measurement at a coast where the file
 * says nothing. Writing 0 for a missing wind turns the first red AND would
 * grade every unmeasured landfall as a tropical depression. */

const graded = landfallsFor([fix(0, -45, 15, { windKt: 100 }), fix(1, -35, 15, { windKt: 100 })], mask.isLand);
ok(`a 100 kt landfall is graded — got ${graded[0]?.category}`, Number.isFinite(graded[0]?.category));

section('12. Degenerate input answers rather than throws');

eq('no points', landfallsFor([], mask.isLand).length, 0);
eq('one point', landfallsFor([fix(0, -45, 15)], mask.isLand).length, 0);
eq('null points', landfallsFor(null, mask.isLand).length, 0);
eq('no mask', landfallsFor([fix(0, -45, 15), fix(1, -35, 15)], null).length, 0);
eq('a point with no position is skipped',
  landfallsFor([fix(0, -45, 15), { time: 1, lat: null, lonU: null }, fix(2, -35, 15)], mask.isLand).length, 1);

section('13. cameAshore and landfallsFor never disagree');

const cases = [
  [fix(0, -45, 15), fix(1, -35, 15)],
  [fix(0, -45, 15), fix(1, -44, 15)],
  [fix(0, -38, 15), fix(1, -37, 15)],
  [fix(0, -45, 15, { status: 'EX' }), fix(1, -35, 15, { status: 'EX' })],
];
for (let i = 0; i < cases.length; i++) {
  eq(`case ${i + 1}`, cameAshore(cases[i], mask.isLand), landfallsFor(cases[i], mask.isLand).length > 0);
}

console.log(`\ntest-landfall: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
