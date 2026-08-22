#!/usr/bin/env node
/**
 * test-cone-ribbon.mjs — the environment ribbon's arithmetic. SPEC §47.
 *
 * WHAT THIS SUITE IS FOR. Every decision this layer makes is invisible on
 * screen: a slice that inherited the wrong hour, a zero read as an ending, a
 * color taken from the wrong end of a span — all of them draw a perfectly
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
/** WCAG contrast, computed here rather than imported: a test that reuses the
 *  implementation's own arithmetic agrees with the implementation's own bug. */
function contrastOf(a, b) {
  const lum = (h) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const { buildRibbon, environmentAtHour, hoursAlong, liftToLegible, rampAt, rampT } =
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
/* Position runs to +120 h, wind stops at +84 h — the file the two definitions
 * of "drawable" disagreed on by 22 kt, SETTLED position-only on 2026-08-22
 * (§47.2). It now draws all twelve hours, so it is the fixture that proves the
 * wind row no longer gates anything. */
const SPLIT_ENDS = runOf('26061618EP9326_ships.txt');
/* ==> THE RUN-STOPS-SHORT FIXTURE, AND IT HAD TO CHANGE. <== §47.6's cap rule
 * needs a file whose POSITIONS end before the cone does, and EP9326 used to
 * stand in for that because its WIND ended early. Under the position-only rule
 * it no longer stops short of anything, so the case needs a file that really
 * does: EP0726's 2026-08-02 18Z run loses its positions at +72 h. Substituting
 * one that only LOOKED short would have left §47.6 asserted against nothing. */
const SHORT_POSITIONS = runOf('26080218EP0726_ships.txt');

/* ---------------------------------------------------------------------------
 * 1. THE RAMP
 * ------------------------------------------------------------------------- */
section('the ramp lands on the palette, not near it');

const STOPS = DARK.geo.envRamp;

ok(rampAt(STOPS, 0).toUpperCase() === STOPS[0].toUpperCase(),
  'the dark end IS the first stop — a ramp that drifted off its token would still look like a ramp');
ok(rampAt(STOPS, 1).toUpperCase() === STOPS[STOPS.length - 1].toUpperCase(),
  'and the bright end IS the last');
ok(rampAt(STOPS, 1 / 2).toUpperCase() === STOPS[2].toUpperCase(),
  'the neutral stop sits in the MIDDLE — FIVE stops, evenly walked (§47.4, §47.5)');
ok(rampAt(STOPS, 1 / 4).toUpperCase() === STOPS[1].toUpperCase(),
  'the hostile end of the measured domain sits a quarter along');
ok(rampAt(STOPS, 3 / 4).toUpperCase() === STOPS[3].toUpperCase(),
  'and the old bright end sits three quarters along, where +15 kt now lands');

ok(rampAt(STOPS, -5) === rampAt(STOPS, 0) && rampAt(STOPS, 5) === rampAt(STOPS, 1),
  'out of range clamps rather than wrapping or extrapolating');

ok(LIGHT.geo.envRamp.length === DARK.geo.envRamp.length,
  'both themes carry the same number of stops, so rampAt walks them identically');
ok(LIGHT.geo.envRamp[0].toUpperCase() !== DARK.geo.envRamp[0].toUpperCase(),
  'and the two dark ends DIFFER — hostile dissolves into the sea, and the sea is not the same color in both themes');

/* ==> THE SCALE IS MEASURED AND IS NOT A ROUND NUMBER BY ACCIDENT. <== §47.4
 * pinned ±15 against a whole season and said not to re-litigate it. Asserting
 * it here means a later tidy-up that "simplifies" the domain fails loudly. */
ok(ENV_RIBBON.scaleLoKt === -15 && ENV_RIBBON.scaleHiKt === 15,
  'the ramp domain is the measured -15..+15 kt');
/* ==> AND THE MAPPING INSIDE THE DOMAIN IS UNCHANGED, WHICH IS THE WHOLE
 * ARGUMENT FOR THE FOURTH STOP. <== §47.4 measured ±15 against a season and
 * said not to re-litigate it. The extension did not: -15, 0 and +15 land on
 * stops 0, 1 and 2 exactly, so every reading inside the domain resolves to the
 * colour it had before the stop existed. If this ever stops being byte-exact,
 * the fourth stop HAS re-litigated the domain and this says so. */
ok(near(rampT(0), 1 / 2), 'ZERO KNOTS IS THE MIDDLE OF THE RAMP — the whole reason it is symmetric');
ok(near(rampT(-15), 1 / 4), 'the hostile end of the measured domain is a quarter along');
ok(near(rampT(15), 3 / 4), 'and +15 kt is still the old bright stop, not the new one');
for (const kt of [-15, -12, -9, -6, -3, 0, 3, 6, 9, 12, 15]) {
  const before = rampAt(STOPS.slice(1, 4), (kt + 15) / 30);
  ok(rampAt(STOPS, rampT(kt)).toUpperCase() === before.toUpperCase(),
    `${kt} kt draws exactly the colour the three-stop ramp gave it`);
}

/* ==> AND BETWEEN THE STOPS IT IS WITHIN ONE UNIT, WHICH IS THE HONEST CLAIM.
 * <== The symmetric ramp reaches the same blend fraction by a different
 * arithmetic path (t*4 rather than t*3), so the last bit of a float can round
 * a channel the other way. Measured across both palettes at quarter-knot steps
 * from -60 to +60: worst deviation 1/255, which no screen shows. Pinned so a
 * future change to `rampT` cannot quietly move a colour and call it rounding. */
for (const [name, pal, three] of [
  ['dark', DARK.geo.envRamp, ['#0A1420', '#5B4A9E', '#C4B0FF', '#EFE9FF']],
  ['light', LIGHT.geo.envRamp, ['#C2C6CA', '#8E7BC6', '#4B2C9E', '#2A1263']],
]) {
  const oldT = (k) => {
    const lo = -15, hi = 15, outer = 40, inner = 2 / 3;
    if (k <= lo) return 0;
    if (k <= hi) return ((k - lo) / (hi - lo)) * inner;
    return inner + Math.min(1, Math.max(0, (k - hi) / (outer - hi))) * (1 - inner);
  };
  let worst = 0;
  for (let kt = -60; kt <= 60; kt += 0.25) {
    const a = rampAt(three, oldT(kt));
    const b = rampAt(pal, rampT(kt));
    for (let c = 1; c < 7; c += 2) {
      worst = Math.max(worst, Math.abs(parseInt(a.substr(c, 2), 16) - parseInt(b.substr(c, 2), 16)));
    }
  }
  ok(worst <= 1,
    `${name}: the five-stop ramp draws the four-stop ramp's colour to within ${worst}/255 everywhere`);
}

/* THE EXTENSION ITSELF. */
ok(ENV_RIBBON.scaleOuterKt === 40, 'the extension reaches +40 kt — the season topped out at +38');
ok(near(rampT(40), 1), 'which is the far stop');
ok(near(rampT(60), 1), 'and past it clamps rather than wrapping');
ok(rampAt(STOPS, rampT(18)).toUpperCase() !== rampAt(STOPS, rampT(34)).toUpperCase(),
  '+18 kt and +34 kt are no longer the same colour — the flat half-cone Aaron reported');
ok(DARK.geo.envRamp.length === 5 && LIGHT.geo.envRamp.length === 5,
  'both palettes carry FIVE stops — scaleInnerFraction is 1/2 only because of this');
ok(ENV_RIBBON.scaleInnerFraction === 1 / 2,
  'and the measured domain occupies the middle HALF, which is what centres 0 kt');
/* ==> THE DOUBLED HOSTILE STOP IS THE POINT, NOT A TYPO. <== There is nothing
 * darker than the night ocean and nothing paler than the daylight sea (§47.5),
 * so the extension below -15 kt repeats the stop rather than inventing a colour
 * that cannot be seen. Asserted so nobody "fixes" the duplicate. */
ok(DARK.geo.envRamp[0].toUpperCase() === DARK.geo.envRamp[1].toUpperCase() &&
   LIGHT.geo.envRamp[0].toUpperCase() === LIGHT.geo.envRamp[1].toUpperCase(),
  'the hostile extension repeats its stop — symmetry without inventing a colour');

/* ==> THE HOSTILE END IS STILL FLAT AND THAT IS DELIBERATE. <== It is already
 * the ocean colour in both themes (§47.5), so there is nowhere darker to go on
 * a night-sky map. Asserted so nobody "fixes" the asymmetry without reading
 * why it is there. */
ok(rampAt(STOPS, rampT(-23)).toUpperCase() === rampAt(STOPS, rampT(-52)).toUpperCase(),
  'a -23 kt hour and a -52 kt hour still draw identically — no headroom below the sea');
ok(rampT(-40) === 0 && rampT(40) === 1, 'the scale runs -40..+40, symmetric, and clips beyond');
ok(rampT(-60) === 0 && rampT(60) === 1, 'and past both ends clamps rather than wrapping');
ok(near(rampT(-40) + rampT(40), 1) && near(rampT(-15) + rampT(15), 1),
  'the two halves are mirror images — if this fails, `Balanced` is no longer the middle');

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
  'the last hour with both a wind and a position is drawable');
{
  /* ==> THE RULE CHANGED HERE ON 2026-08-22 AND THIS IS THE ASSERTION THAT
   * SAYS SO. <== An hour with a POSITION and no wind used to be undrawable, and
   * that is what left a grey blob on the end of Lala's cone. The environment is
   * the sum of the ten environment rows; the wind row is the intensity model's
   * own answer and is not evidence about them. */
  const past = SPLIT_ENDS.hours.find((h) => h > SPLIT_ENDS.lastWindHr);
  ok(Number.isFinite(environmentAtHour(SPLIT_ENDS, past)),
    'and an hour with a position but NO wind is drawable too — the position alone decides');
  ok(environmentAtHour(SPLIT_ENDS, SPLIT_ENDS.lastPositionHr) === -52,
    'which is how its worst reading becomes -52 kt where the old rule showed -30');
  const pastPos = SPLIT_ENDS.hours.find((h) => h > SPLIT_ENDS.lastPositionHr);
  ok(environmentAtHour(SPLIT_ENDS, pastPos) === null,
    'past the last POSITION it still stops — that end is unchanged');
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
 * 5a. THE ANTIMERIDIAN — THE TWO INPUTS ARRIVE ON DIFFERENT BRANCHES
 *
 * The ribs come out of lib/cone-sweep.js on the TRACK's branch, unwrapped past
 * ±180 so MapLibre draws one continuous cone across the seam. The forecast
 * points arrive from the source wrapped into (−180, 180]. The same ground is
 * −182 in one and 178 in the other, and subtracting them measures most of the
 * way round the planet.
 *
 * SHIPS covers the Central Pacific, so this is a live basin: a CP storm sits
 * within twenty degrees of the seam and its five-day cone reaches across it.
 * ------------------------------------------------------------------------- */
section('a cone across the dateline joins to its forecast, not to the far side of the world');

{
  /* Ribs from 175°E to 175°W, carried unwrapped: 175 … 185. */
  const n = 41;
  const seamRibs = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const lon = 175 + t * 10;
    return { t, lon, lat: 20, left: [lon, 21], right: [lon, 19] };
  });
  /* The same five points as the source publishes them — the last three have
   * crossed and come back as negatives. */
  const wrapped = [
    { lon: 175, lat: 20, tau: 0 },
    { lon: 177.5, lat: 20, tau: 24 },
    { lon: 180, lat: 20, tau: 48 },
    { lon: -177.5, lat: 20, tau: 72 },
    { lon: -175, lat: 20, tau: 96 },
  ];
  ok(wrapped.some((p) => p.lon < 0) && seamRibs.every((r) => r.lon > 0),
    'the fixture really does put the ribs and the forecast on opposite branches');

  const hrs = hoursAlong(seamRibs, wrapped);
  ok(hrs !== null, 'the join survives the seam at all — before this it refused outright');
  ok(hrs && near(hrs[0], 0), 'the first station is still hour 0');
  ok(hrs && near(hrs[hrs.length - 1], 96), 'and the last station is still the end of the forecast');
  ok(hrs && near(hrs[Math.floor(n / 2)], 48, 1),
    'the middle station lands on the point that sits exactly ON 180');
  ok(hrs && hrs.every((h, i) => i === 0 || h >= hrs[i - 1]),
    'and the hours ascend the whole way across');

  /* THE SHAPE IS IDENTICAL AWAY FROM THE SEAM. Same geometry, same forecast,
   * shifted off the dateline — if the two disagree, the branch arithmetic is
   * doing something beyond moving whole turns. */
  const homeRibs = seamRibs.map((r) => ({ ...r, lon: r.lon - 100 }));
  const homeFc = wrapped.map((p) => ({ ...p, lon: p.lon > 0 ? p.lon - 100 : p.lon + 260 }));
  const homeHrs = hoursAlong(homeRibs, homeFc);
  ok(homeHrs && hrs && homeHrs.every((h, i) => near(h, hrs[i])),
    'and the same cone away from the dateline produces exactly the same hours');
}

/* ---------------------------------------------------------------------------
 * 6. THE SLICES
 * ------------------------------------------------------------------------- */
section('slices tile the cone without overlapping it');

/* ONE COLLECTION, TWO KINDS (§47.5, §47.11): a cone polygon and the stretch of
 * forecast CENTRELINE it covers. Every positional assertion below is about the
 * polygons, so it selects them rather than counting on the emit order — a test
 * indexing `features[0]` is asserting something about the loop, not about the
 * shape, and this suite already had to be rewritten once when the line
 * features landed. */
const slices = (b) => b.features.filter((f) => f.properties._kind === 'slice');
const lines = (b) => b.features.filter((f) => f.properties._kind === 'line');

{
  const ribs = fakeRibs(201);
  const built = buildRibbon({ ribs, forecast: fakeForecast(), run: MAJOR, stops: STOPS });

  ok(built.status === 'ok', 'the major hurricane paints');
  ok(slices(built).length > 1, 'in several slices');

  /* ==> FAR FEWER SLICES THAN STATIONS, AND THAT IS THE POINT OF sliceDeg. <==
   * The cone is measured every 0.06° because its EDGE has to read as a curve;
   * the color comes from a number published every six hours. One slice per
   * station would be hundreds of polygons per storm carrying sixteen colors. */
  const stride = Math.round(ENV_RIBBON.sliceDeg / CONE_SWEEP.stepDeg);
  ok(stride > 1, 'a slice spans more than one station');
  ok(slices(built).length < ribs.length / 2,
    `${slices(built).length} slices from ${ribs.length} stations — polygons saved, shape kept`);

  /* Every intermediate station is still a vertex, so the slice hugs the same
   * curve the cone edge is drawn from. */
  const ring = slices(built)[0].geometry.coordinates[0];
  ok(ring.length === 2 * (stride + 1) + 1,
    'a slice keeps every station along both edges plus its closing point — the saving is polygons, never shape');
  ok(ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1],
    'and closes');

  /* Adjacent slices SHARE their edge exactly. This is what lets
   * `fill-antialias: false` tile them seamlessly instead of leaving hairlines
   * — the corduroy failure §47.5 names. */
  const a = slices(built)[0].geometry.coordinates[0];
  const b = slices(built)[1].geometry.coordinates[0];
  const aEndLeft = a[stride];
  const bStartLeft = b[0];
  ok(aEndLeft[0] === bStartLeft[0] && aEndLeft[1] === bStartLeft[1],
    'consecutive slices share a vertex EXACTLY — no overlap to double-paint, no gap to show through');

  /* ==> A SLICE IS COLORED FROM ITS MIDDLE, NOT ITS LEADING EDGE. <== Taking
   * either end makes every slice a whole step brighter or darker than the
   * stretch it represents, which on a storm whose environment moves 13-21 kt
   * along one cone is a visible shift of the whole ribbon toward the storm or
   * away from it.
   *
   * MEASURED ON A COARSE TRACK ON PURPOSE. With stations a few minutes apart
   * the middle and the leading edge round to the same knot and the assertion
   * cannot fail however the code is written — a test that passes because the
   * two answers happen to agree is not testing anything. Forty-one stations
   * over five days puts a slice's middle about four hours past its start,
   * which is where the two genuinely differ. And it is checked partway down
   * the cone rather than at the fix, where the value is INHERITED and both
   * readings agree by construction (§47.5). */
  {
    const coarse = fakeRibs(41);
    const cb = buildRibbon({ ribs: coarse, forecast: fakeForecast(), run: MAJOR, stops: STOPS });
    const hrs = hoursAlong(coarse, fakeForecast());
    const cstride = Math.max(1, Math.round(ENV_RIBBON.sliceDeg / CONE_SWEEP.stepDeg));
    const startStation = 3 * cstride;
    const midStation = startStation + Math.floor(cstride / 2);
    const f3 = slices(cb)[3];
    ok(f3.properties.hr === Math.round(hrs[midStation]),
      'a slice reports the hour at its MIDDLE station');
    ok(f3.properties.hr !== Math.round(hrs[startStation]),
      'which on this track is a different hour from its first station, so the two are distinguishable');
    ok(f3.properties.kt === Math.round(environmentAtHour(MAJOR, hrs[midStation])),
      'and its color is the environment at that middle hour');
    ok(f3.properties.kt !== Math.round(environmentAtHour(MAJOR, hrs[startStation])),
      'not the one at its leading edge — a whole slice of drift the eye would read as a stronger environment');
  }

  ok(built.features.every((f) => /^#[0-9a-f]{6}$/i.test(f.properties._color)),
    'every slice carries a resolved color, because a themed expression with a feature read would resolve to black');
  ok(built.features.every((f) => Number.isInteger(f.properties.kt)),
    'and a whole-knot figure, which is the precision SHIPS publishes');
}

/* ---------------------------------------------------------------------------
 * A STATION THAT COULD NOT BE MEASURED — §47.5.
 *
 * Ribs from lib/cone-sweep.js `measureConeRibs` — the path taken when the cone
 * rebuild declines and the published outline is measured instead — carry
 * `ok: false` where a ray missed or the edge doubles back on the inside of a
 * bend. Both stations of a bad segment are marked, and the slice bounded by
 * them is not a slice: its two edges cross, so it paints one stretch of cone
 * TWICE, which is the double-blend §47.5's shared vertices exist to prevent.
 *
 * ==> LOSING A SLICE IS THE POINT, NOT A REGRET. <== Before this path existed a
 * cone the rebuild would not draw got no ribbon at all — twelve of Ida's
 * thirty-five advisories, a third of her life with no color. Skipping the one
 * or two slices on a hard turn and keeping the rest is the trade, and it is the
 * same trimming rule a slice already gets when its hours are not all drawable.
 * ------------------------------------------------------------------------- */
section('a station that could not be measured');
{
  const clean = fakeRibs(201);
  const whole = buildRibbon({
    ribs: clean, caps: fakeCaps(clean), forecast: fakeForecast(), run: MAJOR, stops: STOPS,
  });
  ok(whole.status === 'ok', 'the clean cone paints, so the comparison below means something');

  /* One bad segment, mid-cone: two adjacent stations, as `measureConeRibs`
   * marks them. Deliberately away from either end so no cap is involved. */
  const holed = clean.map((r, i) => (i === 100 || i === 101 ? { ...r, ok: false } : r));
  const gapped = buildRibbon({
    ribs: holed, caps: fakeCaps(holed), forecast: fakeForecast(), run: MAJOR, stops: STOPS,
  });

  ok(gapped.status === 'ok',
     'two unmeasurable stations cost a slice, NOT the ribbon — the whole failure this path exists to end');
  const sliceCount = (b) => b.features.filter((f) => f.properties._kind === 'slice').length;
  ok(sliceCount(gapped) < sliceCount(whole),
     `and the slice across them is gone (${sliceCount(whole)} → ${sliceCount(gapped)})`);
  ok(sliceCount(whole) - sliceCount(gapped) <= 2,
     'and only that slice — one bad station must not take the cone with it');

  /* ==> A SWEPT RIB HAS NO `ok` AT ALL AND MUST STILL BE TRUSTED. <== The two
   * paths hand out different rib shapes, and a check written as `if (rib.ok)`
   * rather than `if (rib.ok === false)` would silently drop every slice on the
   * path that works today — the ribbon would vanish everywhere instead of
   * nowhere, which is a worse version of the bug being fixed. */
  ok(clean.every((r) => r.ok === undefined),
     'the swept rib fixture carries no `ok`, which is what the sweep really returns');
  ok(sliceCount(whole) > 50, 'and every one of its slices is painted regardless');

  /* An end station marked bad takes its own cap and nothing else. */
  const noNose = clean.map((r, i) => (i >= clean.length - 2 ? { ...r, ok: false } : r));
  const capless = buildRibbon({
    ribs: noNose, caps: fakeCaps(noNose), forecast: fakeForecast(), run: MAJOR, stops: STOPS,
  });
  ok(capless.status === 'ok' && sliceCount(capless) < sliceCount(whole),
     'an unmeasurable end station drops its own cap and leaves the body painted');
}

/* ---------------------------------------------------------------------------
 * A PINCHED EDGE — §47.5.
 *
 * On the measured path (lib/cone-measure.js) the inside edge of a tight bend
 * has nowhere further to go, so the point is held at its predecessor rather
 * than allowed to run backwards. Consecutive ribs then SHARE an edge point, and
 * a slice through that stretch arrives carrying repeated vertices.
 *
 * ==> A REPEATED VERTEX IS A ZERO-LENGTH SEGMENT AND A ZERO-LENGTH SEGMENT HAS
 * NO DIRECTION. <== Enough to make a self-intersection test report a crossing
 * that is not there, and enough to hand MapLibre a degenerate edge to
 * triangulate. Every other ring in the app is deduped for exactly this reason;
 * the slices were not, and the moment pinching existed 148 of them read as
 * crossed on the Ida corpus.
 * ------------------------------------------------------------------------- */
section('a pinched edge');
{
  const clean = fakeRibs(201);
  /* A run of stations sharing one left-edge point, as a pinch produces. */
  const pinched = clean.map((r, i) =>
    (i > 100 && i <= 108 ? { ...r, left: clean[100].left.slice() } : r));

  const built = buildRibbon({
    ribs: pinched, caps: fakeCaps(pinched), forecast: fakeForecast(), run: MAJOR, stops: STOPS,
  });
  ok(built.status === 'ok', 'a pinched cone still paints — the pinch is a corner, not an absence');

  const sliceRings = built.features
    .filter((f) => f.properties._kind === 'slice')
    .map((f) => f.geometry.coordinates[0]);

  let dupes = 0;
  let degenerate = 0;
  for (const ring of sliceRings) {
    for (let i = 0; i < ring.length - 1; i++) {
      if (ring[i][0] === ring[i + 1][0] && ring[i][1] === ring[i + 1][1]) dupes++;
    }
    if (ring.length < 4) degenerate++;
  }
  ok(dupes === 0,
     `no slice carries a repeated vertex (${dupes} found) — the pinch shares points and the ring must strip them`);
  ok(degenerate === 0, 'and no slice comes out as a line pretending to be a polygon');

  /* THE PINCH MUST NOT COST A SLICE. That was the whole failure it replaced. */
  const whole = buildRibbon({
    ribs: clean, caps: fakeCaps(clean), forecast: fakeForecast(), run: MAJOR, stops: STOPS,
  });
  const n = (b) => b.features.filter((f) => f.properties._kind === 'slice').length;
  ok(n(built) === n(whole),
     `and every slice is still painted (${n(built)}/${n(whole)}) — pinching costs shape, never coverage`);
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

section('the caps — the two ends that are not ribs');

{
  const ribs = fakeRibs(201);
  const caps = fakeCaps(ribs);
  const withCaps = buildRibbon({ ribs, caps, forecast: fakeForecast(), run: MAJOR, stops: STOPS });
  const without = buildRibbon({ ribs, caps: null, forecast: fakeForecast(), run: MAJOR, stops: STOPS });

  ok(withCaps.features.length === without.features.length + 2,
    'a drawable-throughout run paints BOTH caps — the nose and the tail are shapes no pair of stations spans');

  /* ==> THE COVERAGE ASSERTION. THIS IS THE ONE THAT WOULD HAVE CAUGHT IT.
   * <== Nothing previously proved the ribbon covered the cone; the slices
   * tiled the straight middle perfectly and both rounded ends dropped through
   * to the plain veil, which on glass read as missing DATA on a run that
   * published everything. Reaching the first and last station is not the test
   * — the caps live BEYOND them. */
  const first = withCaps.features[0].geometry.coordinates[0];
  const last = withCaps.features[withCaps.features.length - 1].geometry.coordinates[0];
  const lons = (ring) => ring.map((p) => p[0]);
  ok(Math.min(...lons(first)) < ribs[0].lon,
    'the tail cap reaches BEHIND the current position, where the cone actually ends');
  ok(Math.max(...lons(last)) > ribs[ribs.length - 1].lon,
    'and the nose cap reaches PAST the last forecast point');

  ok(withCaps.features[0].properties.kt === Math.round(environmentAtHour(MAJOR, 0)),
    'the tail cap takes the fix\'s own color, which is the +6 h value inherited back — nothing new is claimed');

  /* ==> A CAP IS NEVER PAINTED ACROSS A GAP IN THE DATA. <== §47.6: 86 files
   * in the season lost their positions before +120 h. The ribbon must stop
   * mid-cone with plain fill beyond it, and painting the far cap would jump
   * that gap and put confident color on the one stretch we know nothing
   * about. SHORT_POSITIONS loses its positions at +72 h while its cone runs to
   * +120 — a real short run, not one that merely lost its wind row. */
  const short = buildRibbon({ ribs, caps, forecast: fakeForecast(), run: SHORT_POSITIONS, stops: STOPS });
  ok(short.status === 'ok', 'the short run still paints what it has');
  const shortLast = short.features[short.features.length - 1].geometry.coordinates[0];
  ok(Math.max(...lons(shortLast)) <= ribs[ribs.length - 1].lon,
    'but its NOSE cap is left plain — the run stops short of the cone, so the ribbon does too');
  ok(Math.min(...lons(short.features[0].geometry.coordinates[0])) < ribs[0].lon,
    'while the tail cap, whose own end IS drawable, is still painted');
}

/* ---------------------------------------------------------------------------
 * 8. THE FORECAST LINE (§47.5, §47.11)
 *
 * The cone fill and the track carry the SAME number off the SAME stations, and
 * the failure this section exists to prevent is the two of them disagreeing —
 * a line saying "helping" over a cone saying "hostile" would be two answers to
 * one question, on the one layer in the app whose color encodes a signed
 * quantity rather than a category.
 * ------------------------------------------------------------------------- */
section('the forecast line carries the same number as the fill it lies in');

{
  const ribs = fakeRibs(201);
  const SEA = '#070D18'; // the night ocean, DARK.ocean
  const built = buildRibbon({
    ribs, caps: fakeCaps(ribs), forecast: fakeForecast(), run: MAJOR,
    stops: STOPS, sea: SEA,
  });

  const S = slices(built);
  const L = lines(built);

  /* One line per SLICE, not one per cap: a cap is a shape beyond the last
   * station and there is no centreline out there to draw. */
  const capCount = built.features.length - S.length - L.length;
  ok(capCount === 0, 'caps are slices too, so the two kinds account for every feature');
  ok(L.length > 1 && L.length === S.length - 2,
    `${L.length} line segments against ${S.length} polygons — one per slice, and none for the two caps`);

  ok(L.every((f) => f.geometry.type === 'LineString'), 'each is a LineString');
  ok(L.every((f) => f.geometry.coordinates.length >= 2), 'with at least two points');

  /* ==> THE ASSERTION THAT MATTERS: SAME KNOTS, SAME HOUR, SLICE FOR SLICE.
   * <== Compared by index because both are emitted in track order, and by
   * VALUE because the color is what the reader sees. Break the pairing in
   * lib/cone-ribbon.js — take the line's value from `a` while the polygon
   * takes it from the middle — and this fails on every slice. Verified by
   * doing exactly that, 2026-08-16. */
  const paired = L.every((line, i) => {
    /* The caps bracket the slices: features[0] is the tail cap, so the i-th
     * line pairs with the i-th NON-cap polygon. */
    const poly = S[i + 1];
    return line.properties.kt === poly.properties.kt
        && line.properties.hr === poly.properties.hr;
  });
  ok(paired, 'every segment reports the same knots and the same hour as the polygon it lies inside');

  /* ==> ONE RAMP NOW, LIFTED ONLY WHERE A COLOR WOULD VANISH. <== §47.5. The
   * line used to carry a whole second ramp, which met the legibility bar and
   * compressed the entire journey to do it — on Lala the fill read as a
   * gradient and the line read as one flat color across the same stretch
   * (glass, 2026-08-18). Both halves of the replacement are asserted here,
   * because either one alone is a regression: legible-but-flat is where this
   * started, and matching-but-invisible is the §5 silence it was built to
   * avoid. */
  const hostile = L.reduce((a, b) => (a.properties.kt < b.properties.kt ? a : b));
  const hostilePoly = S.find((f) => f.properties.kt === hostile.properties.kt);
  ok(hostile.properties.kt < 0, 'the major hurricane has a hostile stretch to test with');
  ok(hostile.properties._color !== hostilePoly.properties._color,
    'a HOSTILE line is not the same hex as its fill — the fill may fade into the ocean, the line may not');
  ok(contrastOf(hostile.properties._color, SEA) >= ENV_RIBBON.lineMinContrast,
    `and it clears the bar against the sea (${contrastOf(hostile.properties._color, SEA).toFixed(2)} : 1)`);
  ok(L.every((f) => contrastOf(f._color || f.properties._color, SEA) >= ENV_RIBBON.lineMinContrast - 1e-9),
    'as does EVERY segment — one dark stretch of a five-day track is one that is not there');

  /* THE OTHER HALF. Above the crossover the line must be the cone's EXACT hex,
   * not a nearby one — that is the whole reason the second ramp went. */
  const bright = L.filter((f) => {
    const poly = S.find((p) => p.properties.kt === f.properties.kt
                            && p.properties.hr === f.properties.hr);
    return poly && contrastOf(poly.properties._color, SEA) >= ENV_RIBBON.lineMinContrast;
  });
  ok(bright.length > 0, 'the storm has a stretch whose fill is legible on its own');
  ok(bright.every((f) => {
    const poly = S.find((p) => p.properties.kt === f.properties.kt
                            && p.properties.hr === f.properties.hr);
    return f.properties._color === poly.properties._color;
  }), 'and wherever the fill is legible the line is the SAME hex — no second ramp, no near-miss');

  ok(L.every((f) => /^#[0-9a-f]{6}$/i.test(f.properties._color)),
    'every line color is a resolved hex, never left as an expression');

  /* Consecutive segments MEET. A slice ends on the station the next one starts
   * from, so the drawn line has no gap where the color steps — which on a
   * 1.75 px track would read as a broken forecast rather than as a boundary. */
  const joins = L.every((f, i) => {
    if (i === 0) return true;
    const prev = L[i - 1].geometry.coordinates;
    const end = prev[prev.length - 1];
    const start = f.geometry.coordinates[0];
    return end[0] === start[0] && end[1] === start[1];
  });
  ok(joins, 'each segment starts exactly where the last one ended — no gap at a color step');

  /* An older palette with no line ramp draws a dimmer line, never no ribbon. */
  const noLineRamp = buildRibbon({
    ribs, caps: fakeCaps(ribs), forecast: fakeForecast(), run: MAJOR, stops: STOPS,
  });
  ok(noLineRamp.status === 'ok' && lines(noLineRamp).length === L.length,
    'a palette missing the line ramp falls back to the cone ramp rather than losing the ribbon');
}

/* ---------------------------------------------------------------------------
 * FIXTURE HELPERS — a straight west-to-east track with parallel edges. The
 * SHAPE is deliberately trivial: this suite is about which hour and which
 * color each slice gets, and lib/cone-sweep.js already owns whether the ribs
 * follow the cone.
 * ------------------------------------------------------------------------- */
/* ---------------------------------------------------------------------------
 * THE FLOOR IN BOTH THEMES — §47.5.
 *
 * ==> BRIGHTNESS INVERTS BETWEEN THE THEMES AND SATURATION DOES NOT. <== On the
 * night globe a helping environment glows; on the greyscale day globe it
 * darkens, so the LIGHT ramp's hostile stop IS the daylight sea. A floor
 * written as "lighten until visible" would be right in one theme and exactly
 * backwards in the other — the light theme's line would be lifted TOWARD the
 * water it is trying to be seen against. This block is what fails if anyone
 * ever writes it that way, and it runs against the real palettes rather than a
 * fixture, so a retune of either ramp is checked here on the day it lands.
 * ------------------------------------------------------------------------- */
section('the line clears the sea in both themes');
for (const [themeName, pal] of [['dark', DARK], ['light', LIGHT]]) {
  const rampStops = pal.geo.envRamp;
  const sea = pal.ocean;
  const target = rampStops[rampStops.length - 1];

  let worst = Infinity;
  let untouched = 0;
  let lifted = 0;
  /* Across the whole domain and past both ends, because rampT clamps and the
   * clipped tails are 5.5% of the season. */
  for (let kt = -30; kt <= 30; kt += 1) {
    const cone = rampAt(rampStops, rampT(kt));
    const line = liftToLegible(cone, sea, target, ENV_RIBBON.lineMinContrast);
    worst = Math.min(worst, contrastOf(line, sea));
    if (line === cone) untouched++; else lifted++;
  }

  ok(worst >= ENV_RIBBON.lineMinContrast - 1e-9,
     `${themeName}: every colour the line can take clears ${ENV_RIBBON.lineMinContrast} : 1 against the sea (worst ${worst.toFixed(2)})`);
  ok(lifted > 0,
     `${themeName}: and the floor actually does something — ${lifted} of 61 sampled knots need lifting`);
  ok(untouched > 0,
     `${themeName}: while ${untouched} are left exactly as the cone paints them, which is the whole reason the second ramp went`);

  /* ==> LIFTING MUST MOVE AWAY FROM THE WATER, NOT TOWARD IT. <== The one
   * assertion that catches a lightness rule wearing a contrast rule's name. */
  const hostileHex = rampAt(rampStops, rampT(-30));
  const liftedHex = liftToLegible(hostileHex, sea, target, ENV_RIBBON.lineMinContrast);
  ok(contrastOf(liftedHex, sea) > contrastOf(hostileHex, sea),
     `${themeName}: the most hostile colour ends up further from the sea than it started`);

  /* ==> AND ONLY AS FAR AS IT HAS TO. <== §47.5's founding rule is that the
   * line and the fill never point opposite ways. A lift that overshoots to the
   * ramp's far end paints a HOSTILE stretch in the fully-favourable colour,
   * which is a line saying "helping" over a cone saying "tearing it apart" —
   * the two-answers-to-one-question failure this whole section exists to
   * prevent, and it does not trip any legibility check because the far end is
   * the most legible colour there is. Reached by lifting toward the sea, which
   * can never clear the bar and falls through to the far end; verified,
   * 2026-08-18. */
  ok(liftedHex !== target,
     `${themeName}: and a hostile line is NOT painted the fully-favourable colour`);

  /* The same rule stated across the whole domain: more environment can never
   * come out reading as LESS. Contrast against the sea rises with distance
   * along the ramp in BOTH themes — the dark ramp brightens and the light one
   * deepens — so one comparison covers both.
   *
   * ==> THE TOLERANCE IS NOT SLOP, AND PICKING IT BY EYE WOULD HAVE MADE THIS
   * ASSERTION MEANINGLESS. <== Through the lifted stretch every colour sits ON
   * the floor by construction, so contrast is FLAT there and the only movement
   * is where the bisection happened to stop — measured at 0.017 contrast points
   * across both themes, which is invisible and is not a direction. A real
   * inversion is the line jumping to the ramp's far end and back, which is
   * whole points. 0.1 sits an order of magnitude above the noise and an order
   * below the fault. */
  const NOISE = 0.1;
  let worstDrop = 0;
  let prev = -Infinity;
  for (let kt = -30; kt <= 30; kt += 1) {
    const c = contrastOf(
      liftToLegible(rampAt(rampStops, rampT(kt)), sea, target, ENV_RIBBON.lineMinContrast),
      sea
    );
    if (prev > -Infinity && c < prev) worstDrop = Math.max(worstDrop, prev - c);
    prev = c;
  }
  ok(worstDrop < NOISE,
     `${themeName}: and the line never reads backwards — worst backward step ${worstDrop.toFixed(3)} contrast points`);
}


function fakeRibs(n) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const lon = t * 10;
    return { t, lon, lat: 0, left: [lon, 1], right: [lon, -1] };
  });
}

/** The two half-ellipses lib/cone-sweep.js returns, in the same shape: a
 *  closed ring reaching BEYOND the end station it is attached to. */
function fakeCaps(ribs) {
  const a = ribs[0];
  const z = ribs[ribs.length - 1];
  const half = (x, dir) => {
    const ring = [];
    for (let i = 0; i <= 8; i++) {
      const th = -Math.PI / 2 + (Math.PI * i) / 8;
      ring.push([x + dir * 0.5 * Math.cos(th), Math.sin(th)]);
    }
    ring.push(ring[0].slice());
    return ring;
  };
  return { start: half(a.lon, -1), end: half(z.lon, +1) };
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
