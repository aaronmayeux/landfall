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
import { cameAshore, landfallNature, landfallsFor } from '../lib/landfall.js';
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

section('8. A cyclone comes ashore, and so does what one turned into');

/* ==> `LO` IS NOT IN THIS LOOP ANY MORE AND THAT IS THE POINT OF §57.7d. <==
 * It used to be, and with `LO` added to `postTropicalStatuses` these tracks
 * would STILL have passed — every fix is `LO`, so the system was never a
 * cyclone and the sequence test refuses it anyway. The assertion would have
 * gone on printing "a LO crossing the coast is not a landfall" while the code
 * had stopped meaning it. §12: a test that stays green on the wrong reason is
 * worse than no test. `LO` gets its own cases in 8b, both ways. */
for (const status of ['WV', 'DB']) {
  eq(`a ${status} crossing the coast is not a landfall`,
    landfallsFor([fix(0, -45, 15, { status }), fix(1, -35, 15, { status })], mask.isLand).length, 0);
}

/* ==> AND A WAVE OR A DISTURBANCE STAYS REFUSED EVEN AFTER A TROPICAL PHASE,
 * WHICH IS THE CASE THE LOOP ABOVE CANNOT REACH. <== A `WV` or `DB` at full
 * tropical-storm force, after the system had genuinely been a hurricane, is
 * the exact shape `LO` now passes — so the only thing separating them is the
 * code list. Four real crossings in the archive are this, all at 35 kt in the
 * Lesser Antilles, and all of them stay out on purpose. */
for (const status of ['WV', 'DB']) {
  eq(`a ${status} at 70 kt after a hurricane phase is still not a landfall`,
    landfallsFor([
      fix(0, -55, 15, { status: 'HU', windKt: 80 }),
      fix(1, -45, 15, { status, windKt: 70 }),
      fix(2, -35, 15, { status, windKt: 70 }),
    ], mask.isLand).length, 0);
}
for (const status of SEASONS.cycloneStatuses) {
  eq(`a ${status} crossing the coast is`,
    landfallsFor([fix(0, -45, 15, { status }), fix(1, -35, 15, { status })], mask.isLand).length, 1);
}

/* ==> MUTATION: hard-coding TD/TS/HU instead of reading
 * SEASONS.cycloneStatuses turns the two subtropical cases red — which is the
 * real bug, since a subtropical storm does come ashore. Accepting every status
 * turns the three LO/WV/DB cases red. */

section('8a. A post-tropical storm comes ashore. §57.7c');

/* Sandy's shape, in miniature: a hurricane out at sea, transition, then the
 * coast crossed while still well above tropical-storm force.
 *
 * ==> BOTH ENDS OF THE CROSSING LEG ARE `EX` DELIBERATELY. <== The walk reads
 * the status of whichever fix the sample is NEARER, so a leg that begins as a
 * hurricane and ends extratropical would test the hurricane branch for a
 * crossing in its first half. Straddling the transition is a different case
 * and not the one this section is about. */
const sandyish = (over = {}) => [
  fix(0, -55, 15, { status: 'HU', windKt: 80 }),
  fix(1, -45, 15, { status: 'EX', windKt: 70, ...over }),
  fix(2, -35, 15, { status: 'EX', windKt: 70, ...over }),
];

const post = landfallsFor(sandyish(), mask.isLand);
eq('a system that was a hurricane and crossed the coast as EX came ashore', post.length, 1);
eq('and it is stamped post-tropical rather than tropical',
  post[0]?.nature, 'post-tropical');
eq('==> AND IT IS NOT GIVEN A SAFFIR-SIMPSON CATEGORY, however strong it was',
  post[0]?.category, null);
eq('while the wind at the coast is still reported', post[0]?.windKt, 70);

/* ==> MUTATION: returning `'tropical'` from `landfallNature` for an EX status
 * turns the nature case red; grading it with `categoryFromKt` regardless of
 * nature turns the category case red. Both were run. */

eq('a tropical crossing is stamped tropical',
  landfallsFor([fix(0, -45, 15), fix(1, -35, 15)], mask.isLand)[0]?.nature, 'tropical');

section('8b. The two floors that separate Sandy from a dying remnant');

eq(`under ${SEASONS.postTropicalLandfallMinKt} kt a post-tropical crossing does not count`,
  landfallsFor(sandyish({ windKt: SEASONS.postTropicalLandfallMinKt - 1 }), mask.isLand).length, 0);
eq('exactly at the floor it does',
  landfallsFor(sandyish({ windKt: SEASONS.postTropicalLandfallMinKt }), mask.isLand).length, 1);

/* ==> MUTATION: deleting the wind test, or writing `>` where the code writes
 * `<`, turns one of these two red. */

/* ==> DORIAN'S SHAPE, AND IT IS `LO` RATHER THAN `EX`. <== §57.7d. HURDAT2
 * codes his 2019 Nova Scotia crossing — 80 kt at 44.64N 63.30W, the storm
 * Canada remembers — as `LO`, not `EX`. The `EX` list alone refused it, for
 * exactly the reason it once refused Sandy. NWS Instruction 10-604 makes the
 * remnant low and the extratropical cyclone two classes of ONE thing, and
 * draws the line between them at 34 kt, which is the floor this file already
 * had. */
const dorianish = (over = {}) => [
  fix(0, -55, 15, { status: 'HU', windKt: 95 }),
  fix(1, -45, 15, { status: 'LO', windKt: 80, ...over }),
  fix(2, -35, 15, { status: 'LO', windKt: 80, ...over }),
];

const lo = landfallsFor(dorianish(), mask.isLand);
eq('a system that was a hurricane and crossed the coast as LO came ashore', lo.length, 1);
eq('and it is post-tropical, the same as an EX crossing', lo[0]?.nature, 'post-tropical');
eq('and it is not graded either', lo[0]?.category, null);

eq('under the floor the same LO crossing does not count',
  landfallsFor(dorianish({ windKt: SEASONS.postTropicalLandfallMinKt - 1 }), mask.isLand).length, 0);

/* ==> MUTATION: removing `'LO'` from SEASONS.postTropicalStatuses turns the
 * first three of these red and leaves the floor case green — which is the
 * asymmetry worth knowing, because it is why the floor case alone would not
 * have caught the bug. Both mutations were run. */

/* An LO that was never a cyclone is still nothing, and this is the case that
 * keeps `LO` from swallowing every pre-genesis low over 34 kt. Measured: of
 * the 47 LO crossings the archive walk finds after a cyclone phase, 5 clear
 * the floor and 0 of those are pre-genesis — the guard is unexercised on real
 * data and is here so it stays correct anyway. */
eq('an LO crossing on a system that was never a cyclone is not a landfall',
  landfallsFor([
    fix(0, -45, 15, { status: 'LO', windKt: 70 }),
    fix(1, -35, 15, { status: 'LO', windKt: 70 }),
  ], mask.isLand).length, 0);

/* An extratropical low that comes ashore BEFORE it was ever tropical. Same
 * strength, same coast, and it must not count — it had not been a storm yet. */
const preTropical = landfallsFor([
  fix(0, -45, 15, { status: 'EX', windKt: 70 }),
  fix(1, -35, 15, { status: 'EX', windKt: 70 }),
  fix(2, -25, 15, { status: 'HU', windKt: 80 }),
], mask.isLand);
eq('an EX crossing before the system was ever a cyclone is not a landfall',
  preTropical.length, 0);

/* And the same track with the tropical phase FIRST does count, which is the
 * control that proves the assertion above is about sequence and not about the
 * statuses being present at all. */
eq('the identical crossing after a tropical phase does', landfallsFor([
  fix(0, -55, 15, { status: 'HU', windKt: 80 }),
  fix(1, -45, 15, { status: 'EX', windKt: 70 }),
  fix(2, -35, 15, { status: 'EX', windKt: 70 }),
], mask.isLand).length, 1);

/* ==> MUTATION: dropping the `firstCycloneTime` test turns the pre-tropical
 * case red. Anchoring on the LAST cyclone fix instead of the first leaves both
 * green here but breaks a storm that re-intensifies, which is why the header
 * says first and the code reads first. */

section('8c. `landfallNature` answers directly');

eq('a hurricane is tropical', landfallNature('HU', 80, 100, 0), 'tropical');
eq('a subtropical storm is tropical too', landfallNature('SS', 40, 100, 0), 'tropical');
eq('a wave is nothing', landfallNature('WV', 80, 100, 0), null);
eq('a strong EX after the tropical phase is post-tropical',
  landfallNature('EX', 70, 100, 0), 'post-tropical');
eq('a weak EX is nothing', landfallNature('EX', 20, 100, 0), null);
eq('an EX with no wind reading at all is nothing, never assumed strong',
  landfallNature('EX', null, 100, 0), null);
eq('and an ABSENT wind reading is the same answer, which is not free',
  landfallNature('EX', undefined, 100, 0), null);
eq('an EX on a system that was never a cyclone is nothing',
  landfallNature('EX', 70, 100, null), null);
eq('and an EX before the tropical phase is nothing',
  landfallNature('EX', 70, 100, 200), null);
eq('a strong LO after the tropical phase is post-tropical too',
  landfallNature('LO', 80, 100, 0), 'post-tropical');
eq('a weak LO is nothing', landfallNature('LO', 20, 100, 0), null);
eq('an LO on a system that was never a cyclone is nothing',
  landfallNature('LO', 80, 100, null), null);
eq('a DB at the same strength and sequence is still nothing',
  landfallNature('DB', 80, 100, 0), null);

/* ==> MUTATION: each null case was made to return a nature in turn and each
 * one bites. The ABSENT-wind case is the one worth naming, and the reason it
 * is here is a mutation that survived. Replacing `!Number.isFinite(windKt) ||
 * windKt < …` with a bare `windKt < …` changed NOTHING for `null`, because
 * `null` coerces to 0 and `0 < 34` is true — so the suite stayed green over a
 * real hole. `undefined < 34` is `NaN < 34`, which is false, and that one lets
 * an unmeasured crossing through as a landfall. The walk itself only ever
 * produces `null`, but `landfallNature` is exported and the NOAA fallback in
 * `lib/season-facts.js` hands it a parser field that can be absent. */

section('8d. The walk can say what it refused. §57.7e');

/* ==> THE DEFAULT IS SILENCE AND THAT IS THE POINT OF AN OUT-PARAMETER. <==
 * Four callers ask this walk for landfalls and none of them wants refusals.
 * A changed return shape would have moved all four. */
const quiet = landfallsFor(dorianish({ windKt: 20 }), mask.isLand);
eq('with no array passed the walk still just returns landfalls', quiet.length, 0);

const refused = [];
eq('a crossing under the floor is refused',
  landfallsFor(dorianish({ windKt: 20 }), mask.isLand, { declined: refused }).length, 0);
eq('and the refusal is recorded', refused.length, 1);
eq('with the status that caused it', refused[0]?.status, 'LO');
eq('and the wind at the coast, so a reader could work out why', refused[0]?.windKt, 20);
ok('and a position', Number.isFinite(refused[0]?.lat) && Number.isFinite(refused[0]?.lon));

/* ==> AN ACCEPTED CROSSING IS NEVER ALSO A REFUSED ONE. <== The panel prints
 * "one other time" off this count, so double-counting Dorian's own landfall
 * would make the sentence contradict the list directly above it. */
const both = [];
eq('a crossing that IS a landfall is not recorded as refused',
  landfallsFor(dorianish(), mask.isLand, { declined: both }).length, 1);
eq('so the refusal list stays empty', both.length, 0);

/* A wave at full force after a hurricane phase — refused on the code alone. */
const waveRefused = [];
landfallsFor([
  fix(0, -55, 15, { status: 'HU', windKt: 80 }),
  fix(1, -45, 15, { status: 'WV', windKt: 70 }),
  fix(2, -35, 15, { status: 'WV', windKt: 70 }),
], mask.isLand, { declined: waveRefused });
eq('a WV crossing at 70 kt is refused and recorded', waveRefused.length, 1);
eq('and it names WV rather than guessing a reason', waveRefused[0]?.status, 'WV');

/* ==> MUTATION: deleting the `declined.push` block turns four of these red and
 * leaves the `quiet` and `both` cases green — which is why both of those are
 * here. Pushing on EVERY crossing rather than on a refused one turns the
 * `both` case red. Both mutations were run. */


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
