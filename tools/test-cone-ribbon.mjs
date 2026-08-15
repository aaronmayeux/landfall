#!/usr/bin/env node
/**
 * test-cone-ribbon.mjs — the environment ribbon's arithmetic. SPEC §47.
 *
 * WHAT THIS SUITE IS FOR. Every decision this layer makes is invisible on
 * screen: a slice that inherited the wrong hour, a zero read as an ending, a
 * colour taken from the wrong end of a span — all of them draw a perfectly
 * plausible cone. There is nothing to notice. So the assertions here are the
 * only thing standing between a wrong number and a confident violet.
 *
 * EVERY ASSERTION IS MUTATION-TESTED. A test that cannot be made to fail by
 * breaking the thing it tests is not a test, and this file's whole subject is
 * arithmetic that looks fine when it is wrong.
 *
 * THE FIXTURES ARE REAL FILES. `samples/ships/` holds twelve runs promoted by
 * hand from the 2026 corpus (§47.10), chosen to span the extremes a season
 * actually produced. Nothing here is invented — the numbers are parsed out of
 * the same bytes the relay parses.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const { parseShips } = await import('../functions/api/nhc/_ships-parse.js');
const { buildRibbon, environmentAtHour, hoursAlong, rampAt, rampT } =
  await import('../lib/cone-ribbon.js');
const { ENV_RIBBON, CONE_SWEEP } = await import('../config/constants.js');
const { DARK, LIGHT } = await import('../config/tokens.js');

const runOf = (file) =>
  ({ status: 'ok', ...parseShips(fs.readFileSync(`samples/ships/${file}`, 'utf8')) });

/* The season's only major hurricane, at 140 kt. The file §47.10 calls the one
 * that proves the headroom exclusion, and the one the dark end of the ramp has
 * to be judged against. */
const MAJOR = runOf('26072706EP0726_ships.txt');
/* No forecast position at all past hour 0, while still publishing winds. The
 * run-exists-but-nothing-to-draw case. */
const NO_POSITION = runOf('26060618EP9126_ships.txt');
/* Position runs to +120 h, wind stops at +84 h — the file where the two
 * definitions of "drawable" disagree by 22 kt. */
const SPLIT_ENDS = runOf('26061618EP9326_ships.txt');

/* ---------------------------------------------------------------------------
 * 1. THE RAMP
 * ------------------------------------------------------------------------- */
section('the ramp lands on the palette, not near it');

const STOPS = DARK.geo.envRamp;

ok(rampAt(STOPS, 0).toUpperCase() === STOPS[0].toUpperCase(),
  'the dark end IS the first stop — a ramp that drifted off its token would still look like a ramp');
ok(rampAt(STOPS, 1).toUpperCase() === STOPS[STOPS.length - 1].toUpperCase(),
  'and the bright end IS the last');
ok(rampAt(STOPS, 0.5).toUpperCase() === STOPS[1].toUpperCase(),
  'the middle stop sits at exactly halfway — three stops, evenly walked');

ok(rampAt(STOPS, -5) === rampAt(STOPS, 0) && rampAt(STOPS, 5) === rampAt(STOPS, 1),
  'out of range clamps rather than wrapping or extrapolating');

ok(LIGHT.geo.envRamp.length === DARK.geo.envRamp.length,
  'both themes carry the same number of stops, so rampAt walks them identically');
ok(LIGHT.geo.envRamp[0].toUpperCase() !== DARK.geo.envRamp[0].toUpperCase(),
  'and the two dark ends DIFFER — hostile dissolves into the sea, and the sea is not the same colour in both themes');

/* ==> THE SCALE IS MEASURED AND IS NOT A ROUND NUMBER BY ACCIDENT. <== §47.4
 * pinned ±15 against a whole season and said not to re-litigate it. Asserting
 * it here means a later tidy-up that "simplifies" the domain fails loudly. */
ok(ENV_RIBBON.scaleLoKt === -15 && ENV_RIBBON.scaleHiKt === 15,
  'the ramp domain is the measured -15..+15 kt');
ok(near(rampT(0), 0.5), 'zero knots is dead centre of the ramp');
ok(rampT(-40) === 0 && rampT(40) === 1, 'beyond the domain clips, which §47.4 measured and accepted');

/* ---------------------------------------------------------------------------
 * 2. A ZERO IS NOT AN ENDING
 *
 * The single most important rule in the whole layer, and the one a reasonable
 * implementation gets wrong: 110 files in the season fall to zeros past the
 * last wind and 75 keep publishing real numbers, so the VALUES cannot tell the
 * two apart. Drawability comes off the `drawable` array or the ribbon paints a
 * confident "nothing happening" over half a cone with no forecast in it.
 * ------------------------------------------------------------------------- */
section('a zero is a reading, and an undrawable hour is not a zero');

{
  /* A synthetic run rather than a fixture, because the point is the CONTRAST:
   * the same value, 0, in a drawable column and an undrawable one. No real
   * file can put those side by side on demand. */
  const run = {
    status: 'ok',
    hours: [6, 12, 18, 24],
    environmentKt: [0, -8, 0, 0],
    drawable: [true, true, false, false],
    drawableHours: 2,
  };

  ok(environmentAtHour(run, 6) === 0,
    'a genuine 0 kt inside the drawable window is READ, not treated as absent — it is the season\'s most common real answer');
  ok(environmentAtHour(run, 18) === null,
    'and a 0 kt PAST the drawable window is absent, not neutral');
  ok(environmentAtHour(run, 15) === null,
    'a span with one undrawable end does not interpolate — that would run the ribbon half an interval past its own data');
  ok(near(environmentAtHour(run, 9), -4),
    'inside the window it interpolates linearly between published hours');
}

/* ---------------------------------------------------------------------------
 * 3. THE FIX INHERITS +6 h AND IS NEVER GIVEN A ZERO
 *
 * §47.5. Filling the gap with zero lands dead centre of the ramp and paints a
 * confident mid-violet "neutral" over the storm's current position — the
 * brightest thing the eye goes to first, asserting something the file never
 * said, and doing it worst on a storm the environment is tearing apart.
 * ------------------------------------------------------------------------- */
section('the fix has no number of its own and borrows the next one');

ok(MAJOR.hours[0] === 6, 'the contribution table starts at +6 h — there is no column for now');
ok(environmentAtHour(MAJOR, 0) === MAJOR.environmentKt[0],
  'hour 0 inherits the +6 h value exactly');
ok(environmentAtHour(MAJOR, 3) === MAJOR.environmentKt[0],
  'and so does every hour between, rather than interpolating toward a number that does not exist');
ok(environmentAtHour(MAJOR, 0) !== 0,
  'on this storm the inherited value is NOT zero, so a zero-filled fix would be visibly wrong here');
ok(rampT(environmentAtHour(MAJOR, 0)) < 0.5,
  'the season\'s only major hurricane starts in the dark half — zero-filling would have painted it neutral');

/* ---------------------------------------------------------------------------
 * 4. WHERE THE RIBBON STOPS
 * ------------------------------------------------------------------------- */
section('a healthy file with nothing to paint says so');

ok(NO_POSITION.drawableHours === 0,
  'the fixture really does publish no drawable hour — the premise is real');
{
  const built = buildRibbon({ ribs: fakeRibs(60), forecast: fakeForecast(), run: NO_POSITION, stops: STOPS });
  ok(built.status === 'empty' && built.reason === 'nothing_drawable',
    'and it is reported as nothing-to-draw, NOT as a basin gap and NOT as a fault');
  ok(built.features.length === 0, 'with no slices');
}

ok(SPLIT_ENDS.lastWindHr !== SPLIT_ENDS.lastPositionHr,
  'the split-ends fixture really does end its two rows at different hours');
ok(SPLIT_ENDS.drawable[SPLIT_ENDS.hours.indexOf(SPLIT_ENDS.lastWindHr)] === true,
  'the last hour with BOTH a wind and a position is drawable');
{
  const past = SPLIT_ENDS.hours.find((h) => h > SPLIT_ENDS.lastWindHr);
  ok(environmentAtHour(SPLIT_ENDS, past) === null,
    'and an hour with a position but no wind is not — §47.2\'s rule, applied where the two disagree by 22 kt');
}

/* ---------------------------------------------------------------------------
 * 5. THE JOIN IS BY FORECAST HOUR
 *
 * SHIPS can be NEWER than the advisory, so its own coordinates are a different
 * forecast from the one the map draws. The hour is the only thing both
 * publications agree on.
 * ------------------------------------------------------------------------- */
section('stations get their hour from the drawn track, never from SHIPS');

{
  const ribs = fakeRibs(41);            // t from 0 to 1
  const forecast = [
    { lon: 0, lat: 0, tau: 0 },
    { lon: 5, lat: 0, tau: 24 },
    { lon: 10, lat: 0, tau: 48 },
  ];
  const hrs = hoursAlong(ribs, forecast);
  ok(hrs && hrs.length === ribs.length, 'one hour per station');
  ok(near(hrs[0], 0), 'the first station is the current position');
  ok(near(hrs[hrs.length - 1], 48), 'the last is the end of the forecast');
  ok(near(hrs[Math.floor(ribs.length / 2)], 24, 1),
    'and the middle station lands on the middle forecast point, which is what "by hour" means');

  /* A forecast point whose nearest station sits BEFORE an earlier point's —
   * possible on a track that doubles back. Dropped rather than allowed to run
   * the hours backwards down a stretch of cone. */
  const backwards = hoursAlong(ribs, [
    { lon: 0, lat: 0, tau: 0 },
    { lon: 5, lat: 0, tau: 48 },
    { lon: 2, lat: 0, tau: 72 },
  ]);
  ok(backwards && backwards.every((h, i) => i === 0 || h >= backwards[i - 1]),
    'hours never decrease along the track, whatever order the anchors land in');

  ok(hoursAlong(ribs, [{ lon: 0, lat: 0, tau: 0 }]) === null,
    'one anchor is not enough to place anything, and is refused rather than guessed');
  ok(hoursAlong(ribs, [{ lon: 0, lat: 0, tau: null }, { lon: 5, lat: 0, tau: null }]) === null,
    'and GDACS points with no forecast hour are no use as anchors');
}

/* ---------------------------------------------------------------------------
 * 6. THE SLICES
 * ------------------------------------------------------------------------- */
section('slices tile the cone without overlapping it');

{
  const ribs = fakeRibs(201);
  const built = buildRibbon({ ribs, forecast: fakeForecast(), run: MAJOR, stops: STOPS });

  ok(built.status === 'ok', 'the major hurricane paints');
  ok(built.features.length > 1, 'in several slices');

  /* ==> FAR FEWER SLICES THAN STATIONS, AND THAT IS THE POINT OF sliceDeg. <==
   * The cone is measured every 0.06° because its EDGE has to read as a curve;
   * the colour comes from a number published every six hours. One slice per
   * station would be hundreds of polygons per storm carrying sixteen colours. */
  const stride = Math.round(ENV_RIBBON.sliceDeg / CONE_SWEEP.stepDeg);
  ok(stride > 1, 'a slice spans more than one station');
  ok(built.features.length < ribs.length / 2,
    `${built.features.length} slices from ${ribs.length} stations — polygons saved, shape kept`);

  /* Every intermediate station is still a vertex, so the slice hugs the same
   * curve the cone edge is drawn from. */
  const ring = built.features[0].geometry.coordinates[0];
  ok(ring.length === 2 * (stride + 1) + 1,
    'a slice keeps every station along both edges plus its closing point — the saving is polygons, never shape');
  ok(ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1],
    'and closes');

  /* Adjacent slices SHARE their edge exactly. This is what lets
   * `fill-antialias: false` tile them seamlessly instead of leaving hairlines
   * — the corduroy failure §47.5 names. */
  const a = built.features[0].geometry.coordinates[0];
  const b = built.features[1].geometry.coordinates[0];
  const aEndLeft = a[stride];
  const bStartLeft = b[0];
  ok(aEndLeft[0] === bStartLeft[0] && aEndLeft[1] === bStartLeft[1],
    'consecutive slices share a vertex EXACTLY — no overlap to double-paint, no gap to show through');

  /* ==> A SLICE IS COLOURED FROM ITS MIDDLE, NOT ITS LEADING EDGE. <== Taking
   * either end makes every slice a whole step brighter or darker than the
   * stretch it actually represents, which on a storm whose environment moves
   * 13-21 kt along one cone is a visible shift of the whole ribbon toward the
   * storm or away from it. Checked on a slice partway down the cone, where the
   * number is genuinely moving — at the fix the value is inherited and both
   * readings would agree by construction. */
  const hrs = hoursAlong(ribs, fakeForecast());
  const f3 = built.features[3];
  const startStation = 3 * stride;
  const midStation = startStation + Math.floor(stride / 2);
  ok(f3.properties.hr === Math.round(hrs[midStation]),
    'a slice reports the hour at its MIDDLE station');
  ok(f3.properties.hr !== Math.round(hrs[startStation]),
    'which on this fixture is a different hour from its first station, so the two are distinguishable');
  ok(f3.properties.kt === Math.round(environmentAtHour(MAJOR, hrs[midStation])),
    'and its colour is the environment at that middle hour');
  ok(f3.properties.kt !== Math.round(environmentAtHour(MAJOR, hrs[startStation])),
    'not the one at its leading edge — a whole slice of drift the eye would read as a stronger environment');

  ok(built.features.every((f) => /^#[0-9a-f]{6}$/i.test(f.properties._color)),
    'every slice carries a resolved colour, because a themed expression with a feature read would resolve to black');
  ok(built.features.every((f) => Number.isInteger(f.properties.kt)),
    'and a whole-knot figure, which is the precision SHIPS publishes');
}

section('a refused cone rebuild draws no ribbon and says which kind of nothing');

{
  const cases = [
    [{ ribs: null, run: MAJOR }, 'no_ribs', 'no stations — the cone fell back to the published outline'],
    [{ ribs: fakeRibs(201), run: { status: 'basin_not_covered' } }, 'basin', 'a basin SHIPS does not cover'],
    [{ ribs: fakeRibs(201), run: { status: 'no_run_published' } }, 'no_run', 'a storm whose first run has not appeared'],
    [{ ribs: fakeRibs(201), run: null }, 'loading', 'nothing warmed yet'],
  ];
  for (const [args, reason, why] of cases) {
    const built = buildRibbon({ forecast: fakeForecast(), stops: STOPS, ...args });
    ok(built.status === 'empty' && built.reason === reason && built.features.length === 0,
      `${why} → "${reason}", and not one of the other three`);
  }

  const reasons = new Set(cases.map(([, r]) => r));
  ok(reasons.size === cases.length,
    'all four absences are DISTINCT — they look identical on the map, so the row is the only thing that can tell them apart');
}

/* ---------------------------------------------------------------------------
 * FIXTURE HELPERS — a straight west-to-east track with parallel edges. The
 * SHAPE is deliberately trivial: this suite is about which hour and which
 * colour each slice gets, and lib/cone-sweep.js already owns whether the ribs
 * follow the cone.
 * ------------------------------------------------------------------------- */
function fakeRibs(n) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const lon = t * 10;
    return { t, lon, lat: 0, left: [lon, 1], right: [lon, -1] };
  });
}

function fakeForecast() {
  return [
    { lon: 0, lat: 0, tau: 0 },
    { lon: 2.5, lat: 0, tau: 24 },
    { lon: 5, lat: 0, tau: 48 },
    { lon: 7.5, lat: 0, tau: 96 },
    { lon: 10, lat: 0, tau: 120 },
  ];
}

/* ------------------------------------------------------------------------- */
if (failures.length) {
  console.log(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (none of them can tell you whether a Cat 5\'s nearly-black cone reads');
console.log('   as "the environment is against it" or as "this layer is broken" — that is glass)');
