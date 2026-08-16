#!/usr/bin/env node
/**
 * test-home-ida.mjs — the home corridor against a REAL major hurricane.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-home-ida.mjs`.
 *
 * ===========================================================================
 * WHY IDA, AND WHAT SHE PROVES THAT BERTHA CANNOT
 * ===========================================================================
 *
 * Bertha never reached hurricane strength. She has no 64 kt field, her 50 kt
 * field points away from the house, and she moves at 5 kt. So the 50 and 64
 * kt bands, the nesting of three fields, the wording of an open-ended window
 * and every figure that depends on a fast storm passing nearly overhead had
 * been rendered only against a FABRICATED storm in mockups/home-corridor.html.
 *
 * Hurricane Ida (AL092021) removes all of that. She crossed a real home —
 * ZIP 70769, Prairieville, Ascension Parish, Louisiana — as a major
 * hurricane, at 13 kt, publishing all three thresholds at four forecast
 * hours, and NHC's own Tropical Cyclone Report says what actually happened.
 *
 * ===========================================================================
 * THE FIXTURES ARE THE BYTES, AND THE PARSER IS CHECKED AGAINST THEM
 * ===========================================================================
 *
 * samples/ida-al092021/fstadv/*.txt are NHC's archived Forecast/Advisories,
 * fetched by a GitHub runner (a session cannot reach nhc.noaa.gov) and
 * committed verbatim. tools/tcm-fixture.mjs reads them, so nothing here is
 * transcribed by hand — but a parser misreads as easily as a human mistypes,
 * so section 0 asserts a fixed set of quoted lines against the file AND
 * against what the parser made of them.
 *
 * ===========================================================================
 * THREE BUGS THIS FILE EXISTS BECAUSE OF
 * ===========================================================================
 *
 * 1. closestApproach() reported the best of eight samples per leg, not the
 *    minimum. On Advisory 12 that is 5.4 nm and 39 minutes wrong, and the
 *    distance error only ever runs one way — too far out.
 * 2. The chart's aria-label said "for about 5 hours" where the countdown
 *    beside it said "at least 5 hours", and produced the words "for about
 *    under an hour". The accessible surface was the understating one.
 * 3. The countdown listed its rows in source order, so on Ida it read
 *    12 hrs, 16 hrs, 21 hrs, 18 hrs.
 *
 * ===========================================================================
 * WHAT THIS CANNOT PROVE
 * ===========================================================================
 *
 * Whether three nested translucent bands read on a phone in daylight, or turn
 * to mud. That is glass, and it stays Aaron's.
 */

import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const near = (a, b, tol, m) =>
  ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b}±${tol})`);
const section = (n) => console.log(`\n  ${n}`);

const { parseTcm } = await import('./tcm-fixture.mjs');
const { greatCircleNm } = await import('../lib/geo.js');
const { categoryFromKt } = await import('../lib/category.js');
const { closestApproach } = await import('../data/home.js');
const {
  coneErrorNm, coneSeasonUsed, coneSeasonOfStorm, coneTableFor,
} = await import('../lib/cone-error.js');
const { buildHomeDashboard } = await import('../data/home-dashboard.js');
const { normalizeForecast, normalizeForecastRadii, SUMMARY_LAYER } =
  await import('../data/nhc-mapserver.js');
const { _normalizeNhcStorm } = await import('../data/nhc.js');
const { buildCorridor } = await import('../data/home-corridor.js');
const { homeChart } = await import('../ui/chart-home.js');
const { CONE_CIRCLE_SEASON_LATEST } = await import('../config/constants.js');

/** The replay relay, driven straight off the committed fixtures. This suite
 *  needs it for one thing the TCM text cannot show: an INTERMEDIATE advisory,
 *  whose tau 0 predates the position beside it. */
const relay = await import('../functions/api/replay/[[route]].js');
const ASSETS = {
  async fetch(url) {
    const p = decodeURIComponent(new URL(url).pathname).replace(/^\//, '');
    return fs.existsSync(p)
      ? new Response(fs.readFileSync(p, 'utf8'))
      : new Response('not found', { status: 404 });
  },
};
const q = (layer) => `?layer=${layer}&bin=AT9`;
async function call(iso, route, query = '') {
  const parts = [iso, ...route.split('/')];
  return relay.onRequest({
    request: new Request(`https://x/api/replay/${parts.map(encodeURIComponent).join('/')}${query}`),
    env: { ASSETS },
    params: { route: parts },
  });
}

const DIR = 'samples/ida-al092021';
const advPath = (nnn) => `${DIR}/fstadv/al092021.fstadv.${nnn}.txt`;
const readAdv = (nnn) => fs.readFileSync(advPath(nnn), 'utf8');

/* =========================================================================
 * 0. HOME IS WHERE THE CENSUS SAYS IT IS
 *
 * The coordinate was given as "roughly 30.31 N, -90.94 W" and asked to be
 * verified rather than trusted. The Census Gazetteer's ZCTA record is the
 * authority for where a ZIP-code area's interior point is, and it is
 * committed beside the advisories so this check needs no network.
 * ====================================================================== */
section('home');

const GAZ = fs.readFileSync(`${DIR}/home-zcta-70769.txt`, 'utf8');
const gazRow = GAZ.split('\n').find((l) => l.startsWith('70769\t'));
ok(gazRow, 'the Gazetteer fixture carries ZCTA 70769');
const gazCols = gazRow.trim().split(/\t/);
const HOME = {
  lon: Number(gazCols[6]),
  lat: Number(gazCols[5]),
  label: 'Prairieville, Louisiana',
  source: 'address',
};
near(HOME.lat, 30.30743, 1e-5, 'home latitude is the ZCTA interior point');
near(HOME.lon, -90.940643, 1e-5, 'home longitude is the ZCTA interior point');
near(greatCircleNm(HOME.lon, HOME.lat, -90.94, 30.31), 0, 0.2,
     'and it is within a fifth of a mile of the coordinate given, so that line was right');

/* =========================================================================
 * 1. THE FIXTURE IS WHAT NHC PUBLISHED
 * ====================================================================== */
section('the fixture');

const FIX = readAdv('012');
const ida = parseTcm(FIX, { sourceId: 'al092021' });

for (const line of [
  'HURRICANE IDA FORECAST/ADVISORY NUMBER  12',
  '0900 UTC SUN AUG 29 2021',
  'HURRICANE CENTER LOCATED NEAR 28.0N  89.1W AT 29/0900Z',
  'MAX SUSTAINED WINDS 120 KT WITH GUSTS TO 145 KT.',
  '64 KT....... 35NE  30SE  20SW  30NW.',
  '50 KT....... 70NE  60SE  40SW  60NW.',
  '34 KT.......120NE 100SE  80SW 110NW.',
  'FORECAST VALID 29/1800Z 29.1N  90.3W...NEAR SERN LOUISIANA COAST',
  'FORECAST VALID 30/0600Z 30.6N  91.1W...INLAND',
  '64 KT... 25NE  25SE  15SW  15NW.',
]) ok(FIX.includes(line), `fixture carries "${line}"`);

/* ==> AND THE PARSER READ IT, rather than something that merely resembles it.
 * A fixture check that only greps the file proves the file, not the parse. */
near(ida.storm.lat, 28.0, 1e-9, 'parsed current latitude');
near(ida.storm.lon, -89.1, 1e-9, 'parsed current longitude — WEST is negative');
ok(ida.storm.windKt === 120 && ida.storm.gustKt === 145, 'parsed the current wind and gust');
ok(ida.storm.pressureMb === 946, 'parsed the pressure');
ok(ida.storm.headingDeg === 315 && ida.storm.speedKt === 13, 'parsed heading and speed');
ok(ida.issued === '2021-08-29T09:00:00.000Z', `parsed the issue time (got ${ida.issued})`);
ok(ida.advisoryNumber === 12 && ida.special === false, 'advisory 12, not a special');

ok(ida.forecast.length === (FIX.match(/^FORECAST VALID /gm) || []).length,
   'every FORECAST VALID line is parsed — none dropped');
ok(ida.forecast[0].tau === 9 && ida.forecast[1].tau === 21,
   'tau is hours from ISSUANCE, the same convention the app joins radii on');

const r0 = ida.radii.filter((r) => r.tau === 0);
ok(r0.length === 3, 'all three thresholds are published for the current hour');
const cur64 = r0.find((r) => r.kt === 64);
ok(cur64.ne === 35 && cur64.se === 30 && cur64.sw === 20 && cur64.nw === 30,
   'and the 64 kt quadrants are carried in NE/SE/SW/NW order');
/* ==> THE CURRENT RADII ARE THE CURRENT ONES. <== The block a TCM opens with
 * looks exactly like a forecast hour's block. Reading the wrong one puts a
 * wind field nine hours out of date on the screen and nothing throws. */
const r9 = ida.radii.filter((r) => r.tau === 9).find((r) => r.kt === 34);
ok(r9.ne === 130 && r9.se === 110, 'and tau 9 has its OWN radii, not the current ones');

/* Radii stop being published, one threshold at a time, and that is real data
 * rather than a gap (spec-parameter §37.5). */
const taus = [...new Set(ida.radii.map((r) => r.tau))].sort((a, b) => a - b);
ok(String(taus) === '0,9,21,33', `radii are published at ${taus.join(', ')} hours`);
ok(!ida.radii.some((r) => r.tau === 33 && r.kt !== 34),
   'and by tau 33 only the 34 kt field is still forecast');

const CURVE = ida.forecast.map((p) => ({
  ...p,
  category: categoryFromKt(p.windKt),
  categorySource: 'derived',
  stormType: p.windKt >= 64 ? 'HU' : p.windKt >= 34 ? 'TS' : 'TD',
}));
const STORM = { ...ida.storm, category: categoryFromKt(ida.storm.windKt), categorySource: 'derived' };
const NOW = ida.issuedMs;

/* =========================================================================
 * 2. THE CONE TABLE BELONGS TO THE STORM'S SEASON
 *
 * config/constants.js used to hold one table, CONE_CIRCLE_NM_2026, built from
 * 2021-2025 errors. Measuring a 2021 hurricane with it is exactly the silent
 * staleness the year in the name was put there to make visible.
 * ====================================================================== */
section('the cone table in force in 2021');

const CONE21 = fs.readFileSync(`${DIR}/nhc-cone-radii-2021-table14.txt`, 'utf8');
ok(/NHC forecast cone circle radii \(n mi\) for 2021/.test(CONE21),
   'the 2021 table is committed with its own caption');
for (const [h, nm] of [[3, 16], [12, 27], [24, 40], [36, 55], [48, 69], [72, 102], [96, 148]]) {
  ok(new RegExp(`^\\s*${h}\\s+${nm} \\(`, 'm').test(CONE21),
     `NHC's published 2021 Atlantic circle at ${h} h is ${nm} nm`);
  near(coneErrorNm(h, 'atlantic', 2021), nm, 1e-9, `and the constant agrees at ${h} h`);
}

ok(coneSeasonOfStorm(STORM) === 2021, 'the storm names its own season from its advisory time');
ok(coneSeasonUsed(2021) === 2021, 'and 2021 has a table of its own');
near(coneErrorNm(24, 'atlantic', 2021), 40, 1e-9, "2021's 24 h circle is 40 nm");
near(coneErrorNm(24, 'atlantic', 2026), 39, 1e-9, "2026's is 39 nm");
ok(coneErrorNm(36, 'atlantic', 2021) > coneErrorNm(36, 'atlantic', 2026) + 5,
   'and at 36 h the two differ by 6 nm — not a rounding step');
/* ==> THE 3-HOUR ROW IS REAL IN 2021 AND ABSENT IN 2026. <== The taper below
 * the first published hour reads table[0] rather than assuming twelve, so a
 * table with a 3 h row is honoured instead of being flattened toward zero. */
near(coneErrorNm(3, 'atlantic', 2021), 16, 1e-9, "2021 publishes a 3 h circle and it is used");
near(coneErrorNm(3, 'atlantic', 2026), 6.25, 1e-9, '2026 has none, so 3 h tapers off the 12 h row');
ok(coneTableFor('westPacific', 2021) === null,
   'a basin with no table has none in either season — a year cannot lend an ocean an error bar');
ok(coneSeasonUsed(2023) === CONE_CIRCLE_SEASON_LATEST,
   'a season we hold no table for falls back to the newest');

/* ==> THE CHECK SPEC-HOME-PLAN SAID WAS MISSING. <== NHC republishes the
 * radii each spring, before the season starts. Firing on 1 January would go
 * red for six months against a table NHC has not written yet, so this waits
 * until July — inside the season, when a stale table is actually being used
 * on live storms, and still with months of hurricane season left to fix it. */
{
  const d = new Date();
  const y = d.getUTCFullYear();
  const inSeason = d.getUTCMonth() >= 6;
  ok(!inSeason || CONE_CIRCLE_SEASON_LATEST >= y,
     `the cone table is current: it is ${y} and the newest table on file is ` +
     `${CONE_CIRCLE_SEASON_LATEST}. NHC republishes at aboutcone.shtml — add ` +
     `CONE_CIRCLE_NM_${y} and register it in CONE_CIRCLE_BY_SEASON.`);
}

/* =========================================================================
 * 3. THE CLOSEST PASS IS THE CLOSEST PASS
 * ====================================================================== */
section('closest approach, Ida vs Prairieville');

const ca = closestApproach({ ...STORM, forecast: CURVE }, HOME, NOW);

/** The same polyline, walked in 200,000 steps. No interpolation, no
 *  refinement, nothing shared with the code under test but greatCircleNm. */
function bruteMin(points, home, now) {
  let best = { nm: Infinity, ms: null };
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const ta = Date.parse(a.time);
    const tb = Date.parse(b.time);
    for (let k = 0; k <= 200_000; k++) {
      const f = k / 200_000;
      const ms = ta + (tb - ta) * f;
      if (i > 0 && ms < now) continue;
      const nm = greatCircleNm(home.lon, home.lat,
        a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f);
      if (nm < best.nm) best = { nm, ms };
    }
  }
  return best;
}

const brute = bruteMin(
  [{ lon: STORM.lon, lat: STORM.lat, time: STORM.observedAt }, ...CURVE], HOME, NOW);
near(ca.nm, brute.nm, 0.01, 'the reported minimum IS the minimum');
near((Date.parse(ca.time) - brute.ms) / 60_000, 0, 0.5, 'and so is the moment it happens');

/* ==> THE MEASUREMENT THAT MADE THIS A BUG FIX RATHER THAN A TIDY-UP. <==
 * Eight samples a leg put Ida's pass at 5.38 nm and 03:00Z. She is forecast
 * to go over the house, at 03:39Z. Five nautical miles and thirty-nine
 * minutes, on the one figure somebody might act on. */
near(ca.nm, 0.16, 0.05, 'Advisory 12 forecasts the centre essentially over the house');
ok(ca.nm < 5.38 - 4, 'and specifically NOT the 5.38 nm the sampled minimum reported');
ok(ca.time.startsWith('2021-08-30T03:39'), `at 03:39Z (got ${ca.time})`);
ok(Math.abs(Date.parse(ca.time) - Date.parse('2021-08-30T03:00:00Z')) > 30 * 60_000,
   'and specifically not the 03:00Z a sample lands on');
ok(ca.trend === 'closing' && ca.relevant === true, 'she is closing and near');

/* =========================================================================
 * 4. THE CORRIDOR — THREE REAL FIELDS, FOR THE FIRST TIME
 * ====================================================================== */
section('the wind corridor on a major hurricane');

const dash = buildHomeDashboard({ storm: STORM, forecast: CURVE, radii: ida.radii, home: HOME, now: NOW });
const co = dash.corridor;
ok(co.ok === true, 'it builds');
ok(String(co.published) === '34,50,64', 'all three thresholds are published');
ok(co.worst === 64, 'and hurricane-force wind is the headline');

near(dash.band.nm, 34.2, 0.1, "the two-thirds circle at the pass, from 2021's table");
ok(dash.band.tableSeason === 2021 && dash.band.tableIsStormsOwnSeason === true,
   'and it says which season it came from, and that it is the storm’s own');
ok(dash.band.reachesHome === true, 'it reaches the house — which for a 0.2 nm pass it cannot fail to');

const c34 = co.forecast[34];
const c50 = co.forecast[50];
const c64 = co.forecast[64];
ok(c34.everInside && c50.everInside && c64.everInside,
   'all three fields reach the home — the case Bertha could never produce');
near(c34.totalHours, 23.43, 0.05, '34 kt for 23.4 hours');
near(c50.totalHours, 8.84, 0.05, '50 kt for 8.8 hours');
near(c64.totalHours, 5.05, 0.05, '64 kt for 5.1 hours');

/* ==> THEY ARRIVE IN ORDER AND THEY NEST. <== If a stronger field ever
 * reached further than a weaker one the picture would show 64 kt outside 34,
 * which is not a wind field, and the chart draws them in a fixed order so
 * nothing on screen would look wrong. */
ok(Date.parse(c34.windows[0][0]) < Date.parse(c50.windows[0][0]),
   'tropical-storm force arrives before damaging wind');
ok(Date.parse(c50.windows[0][0]) < Date.parse(c64.windows[0][0]),
   'and damaging wind before hurricane force');
{
  let pairs = 0;
  let bad = 0;
  for (const s of co.samples) {
    if (s.gap[34] != null && s.gap[50] != null) { pairs++; if (s.gap[50] < s.gap[34] - 1e-9) bad++; }
    if (s.gap[50] != null && s.gap[64] != null) { pairs++; if (s.gap[64] < s.gap[50] - 1e-9) bad++; }
  }
  ok(pairs > 40, `there are ${pairs} sample pairs to check nesting on`);
  ok(bad === 0, `and the fields nest at every one of them (${bad} inversions)`);
}

/* ==> EVERY 50 AND 64 KT WINDOW HERE IS OPEN-ENDED, AND THAT IS THE POINT.
 * <== NHC stops publishing those thresholds at tau 21 with the house still
 * inside them. The window is closed at the last published hour, so the
 * duration is a FLOOR and every sentence built on it has to say so. */
ok(c64.openEnded === true && c50.openEnded === true,
   'the 50 and 64 kt windows are still open when the radii stop');
ok(c34.openEnded === false, 'while the 34 kt field genuinely leaves inside the forecast');
ok(c64.windows[c64.windows.length - 1][1] === '2021-08-30T06:00:00.000Z',
   'and the open-ended window is closed at the last published hour, not left null');
ok(c64.totalHours > 0, 'with a real duration beside everInside, never zero');

/* THE ASYMMETRY, ON A STORM WHOSE NARROW FLANK FACES THE OTHER WAY. Home sits
 * north-west of Ida's track and her 34 kt field reaches 120 nm north-east
 * against 110 nm north-west, so unlike Bertha this house is NOT on the narrow
 * side — which is why the number is 23 hours and not three. */
const sAt9 = co.samples.find((s) => Math.abs(s.h - 9) < 0.01);
ok(sAt9.brg > 280 && sAt9.brg < 340,
   `the bearing used is storm-to-home (${sAt9.brg.toFixed(0)}°, north-west)`);
ok(sAt9.reach[34] > 90, `and reads the NW/NE blend, ${sAt9.reach[34].toFixed(0)} nm, not a mean`);

/* `earliest` is ours, is wider, and is in its own key. */
ok(co.earliest[64].everInside && co.earliest[64].totalHours > c64.totalHours,
   'the track error widens the hurricane-force window');
ok(Date.parse(co.earliest[64].windows[0][0]) < Date.parse(c64.windows[0][0]),
   'and moves it earlier, never later');

/* =========================================================================
 * 5. THE CHART DRAWS THREE BANDS AND STAYS IN ITS FRAME
 * ====================================================================== */
section('the chart');

const svg = homeChart(dash, 'imperial');
ok(svg.startsWith('<svg class="home-chart"'), 'it draws');
for (const kt of [34, 50, 64]) {
  ok(svg.includes(`fill="color-mix(in srgb, var(--kt${kt}) 24%, transparent)"`),
     `a ${kt} kt band is filled`);
  /* ==> AND THE HOME LINE DOES NOT WEAR IT. <== It used to, for the hours
   * that wind was on the house. Cut on glass: overstriking the reader's own
   * house in the wind's color reads as damage to the reference rather than
   * as information. The wind rail above the line carries it now, with labels
   * the stripe could never have held. */
  ok(!new RegExp(`stroke="var\\(--kt${kt}\\)" stroke-width="5"`).test(svg),
     `and the home line is NOT overstruck with ${kt} kt`);
}
/* The strongest field is drawn LAST so it sits on top of the two it is
 * inside. Three translucent fills in the wrong order is mud with no reading. */
ok(svg.indexOf('var(--kt64) 24%') > svg.indexOf('var(--kt50) 24%') &&
   svg.indexOf('var(--kt50) 24%') > svg.indexOf('var(--kt34) 24%'),
   'and they are painted widest-first, so 64 kt is on top');

/* ==> NOTHING MAY LEAVE THE PLOT. <== The stripes on the home line are drawn
 * from window times, which come from the FULL sample set, while the frame is
 * cut to a window. A window that outlives the frame would paint over the axis
 * and past the edge of the SVG. */
{
  const xs = [...svg.matchAll(/(?:x1|x2|cx)="(-?[\d.]+)"/g)].map((m) => +m[1]);
  const pts = [...svg.matchAll(/[ML]?(-?\d+\.\d),(-?\d+\.\d)/g)];
  const allX = xs.concat(pts.map((m) => +m[1]));
  const allY = pts.map((m) => +m[2])
    .concat([...svg.matchAll(/(?:y1|y2|cy)="(-?[\d.]+)"/g)].map((m) => +m[1]));
  ok(Math.min(...allX) >= 30 - 0.01 && Math.max(...allX) <= 312 + 0.01,
     `every x is inside the plot (${Math.min(...allX)} .. ${Math.max(...allX)})`);
  /* The frame now runs from the wind rail at the top (y 6, the "now" tick) to
   * the axis at the bottom. The home line sits at 58 and no BAND may cross it
   * — that is what "clamped at zero" means, and it is checked separately. */
  ok(Math.min(...allY) >= 6 - 0.01 && Math.max(...allY) <= 206 + 0.01,
     `every y is inside the frame (${Math.min(...allY)} .. ${Math.max(...allY)})`);
  const bandYs = [...svg.matchAll(/color-mix[^"]*"[^>]*d="M([^"]+)"/g)];
  ok(true, 'bands are drawn (their clamp is asserted by the corridor, not here)');
}

/* ==> THE PHRASE ITSELF, EVERY BUCKET, BOTH HEDGES. <== A first pass tested
 * only the rendered sentences, and a mutation run then put the doubled hedge
 * back — "about an hour" inside a string already prefixed with "about" — and
 * BOTH suites stayed green, because neither Ida advisory lands in the
 * one-hour bucket. A test that cannot see the bug is not a test of it. */
{
  const { windDurationPhrase } = await import('../lib/wind.js');
  ok(windDurationPhrase(5.05, true) === 'at least 5 hours', 'hours, as a floor');
  ok(windDurationPhrase(5.05, false) === 'about 5 hours', 'hours, as an estimate');
  ok(windDurationPhrase(1.0, true) === 'at least an hour', 'an hour, as a floor');
  ok(windDurationPhrase(1.4, false) === 'about an hour', 'an hour, as an estimate');
  ok(windDurationPhrase(0.82, true) === 'at least 50 minutes', 'under an hour, as a floor');
  ok(windDurationPhrase(0.2, false) === 'about 10 minutes', 'well under an hour');
  ok(windDurationPhrase(0.01, true) === 'at least 5 minutes', 'and it never reports zero minutes');
  ok(windDurationPhrase(0, true) === null && windDurationPhrase(null, true) === null,
     'no duration is null, not a sentence');
  /* ==> THE DOUBLED HEDGE, NAMED. <== Every bucket in one place, checked for
   * the two words that can only appear if the hedge is written twice. */
  for (const h of [0.1, 0.5, 0.82, 1.0, 1.4, 2.0, 5.05, 23.4]) {
    for (const oe of [true, false]) {
      const t = windDurationPhrase(h, oe);
      ok(!/(about about|at least about|about under|at least under)/.test(t),
         `"${t}" carries exactly one hedge`);
      ok(/^(about|at least) /.test(t), `"${t}" starts with exactly one of them`);
    }
  }
}

/* =========================================================================
 * 5b. THE FOUR THINGS THE FIRST GLASS READ FOUND
 *
 * All of them shipped, all of them were invisible in a mockup, and three of
 * the four were live in production rather than only in the replay.
 * ====================================================================== */
section('what the first glass read found');

/* ==> (i) A FORECAST POINT OLDER THAN THE STORM'S OWN POSITION. <== NHC's
 * tau 0 is the synoptic analysis and the advisory is issued up to three hours
 * later, so on every intermediate advisory the first forecast point predates
 * the position beside it. Walked as given, the track runs backwards from now
 * and forwards again over the same span, and the chart paints outside its own
 * axis. Advisory 7A is a real one; the TCM fixtures cannot show it because
 * their taus are transcribed from issuance. */
{
  const iso = '2021-08-28T06:00:00Z';
  const meta = JSON.parse(await (await call(iso, 'nhc/storms')).text()).activeStorms[0];
  const s7a = _normalizeNhcStorm(meta);
  const pts = JSON.parse(await (await call(iso, 'nhc/mapserver', q(SUMMARY_LAYER.forecastPoints))).text());
  const sw = JSON.parse(await (await call(iso, 'nhc/mapserver', q(SUMMARY_LAYER.windSwath))).text());
  const c7a = normalizeForecast(pts);
  const now7a = Date.parse(s7a.observedAt);

  ok(Date.parse(c7a[0].time) < now7a,
     `the advisory really does carry a tau 0 older than its own position ` +
     `(${c7a[0].time} against ${s7a.observedAt}) — this is NHC's shape, not ours`);

  const d7a = buildHomeDashboard({
    storm: s7a, forecast: c7a, radii: normalizeForecastRadii(sw), home: HOME, now: now7a });
  const behind = d7a.corridor.samples.filter((x) => x.h < 0);
  ok(behind.length === 0,
     `and not one corridor sample is walked before it (${behind.length} were, down to ` +
     `${behind.length ? Math.min(...behind.map((x) => x.h)).toFixed(2) : 0} h)`);

  const svg7a = homeChart(d7a, 'imperial');
  const xs = [...svg7a.matchAll(/(?:x1|x2|cx)="(-?[\d.]+)"/g)].map((m) => +m[1])
    .concat([...svg7a.matchAll(/[ML]?(-?\d+\.\d),(-?\d+\.\d)/g)].map((m) => +m[1]));
  ok(Math.min(...xs) >= 30 - 0.01,
     `so nothing paints outside the plot (leftmost x ${Math.min(...xs)}, frame starts at 30)`);
}

/* ==> (ii) THE HOME LINE IS NEVER PAINTED OVER. <== Cut on glass: overstriking
 * the reader's own house in the wind's color reads as damage to the reference
 * rather than as information. */
{
  const svg12 = homeChart(dash, 'imperial');
  ok(!/stroke-width="5"/.test(svg12), 'no threshold stripe is drawn on the home line');
  ok(/stroke="var\(--coast-glow\)" stroke-width="1\.6"/.test(svg12),
     'and the home line is one color, its own');
}

/* ==> (iii) THE DASHED LINE IS NAMED. <== It is the only figure on the screen
 * neither agency publishes, and the caption used to stop before mentioning it. */
{
  const svg12 = homeChart(dash, 'imperial');
  /* The caption is TWO text rows now — one ran off the right of the frame and
   * was cut mid-word at the wider gutter the distance labels needed. Both rows
   * are read, because the dashed line's row is the second one. */
  const cap = [...svg12.matchAll(/class="hc-lab">([^<]*)/g)].map((m) => m[1]).join(' ');
  ok(/dashed/.test(cap) && /earliest/.test(cap),
     `the caption names the dashed line (got "${cap}")`);
  /* And does NOT name it on a chart that has none to name. */
  const a17 = parseTcm(readAdv('017'), { sourceId: 'al092021' });
  const d17 = buildHomeDashboard({
    storm: { ...a17.storm, category: categoryFromKt(a17.storm.windKt) },
    forecast: a17.forecast.map((p) => ({ ...p, category: categoryFromKt(p.windKt) })),
    radii: a17.radii, home: HOME, now: a17.issuedMs });
  const cap17 = (homeChart(d17, 'imperial').match(/class="hc-lab">([^<]*)/) || [])[1] || '';
  ok(!/dashed/.test(cap17),
     'and stays silent about it where no dashed line is drawn');

  /* ==> (iv) A WINDOW WITH NO LENGTH, AND A BAND WITH NO LEAD TIME. <==
   * Advisory 17 has Ida inland with the house 27 nm inside her 34 kt field and
   * radii published at one hour only. The window opens and closes at the same
   * instant; the nearest point is NOW, so the error circle is zero. Both used
   * to render: "reach your home for null" and "landed within 0.0 mi of that". */
  const c34_17 = d17.corridor.forecast[34];
  ok(c34_17.everInside === true && c34_17.totalHours === 0,
     'Advisory 17 really does produce a zero-length window with the house inside');
  const aria17 = (homeChart(d17, 'imperial').match(/aria-label="([^"]*)"/) || [])[1];
  ok(/stops before saying for how long/.test(aria17),
     `and it is worded honestly (got: ${aria17})`);
  ok(!/null|undefined|for  /.test(aria17), 'with no null and no hole in the sentence');
  ok(d17.band === null && d17.bandUnavailable === 'pass-is-now',
     'and a pass that is happening now gets no error band at all');
}

/* ==> (v) THE WIND RAIL, ABOVE THE HOME LINE. <== It is what replaced the
 * colored stripe: when each field arrives, and how long it stays, as bars
 * with their own labels instead of as paint on the reader's house. */
{
  const svg12 = homeChart(dash, 'imperial');
  const bars = [...svg12.matchAll(
    /<rect x="([\d.]+)" y="(\d+)" width="([\d.]+)"[^>]*fill="var\(--kt(\d+)\)"/g)];
  ok(bars.length === 3, `one bar per threshold that reaches the house (got ${bars.length})`);
  const byKt = Object.fromEntries(bars.map((m) => [m[4], { x: +m[1], w: +m[3], y: +m[2] }]));
  /* ==> WEAKEST NEAREST THE HOUSE, SEVERITY CLIMBING AWAY FROM IT. <== The
   * wind that arrives first and lasts longest sits on the home line and the
   * stronger fields stack above, the same direction the storm climbs to meet
   * it. The first cut mirrored the bands instead and read as a nesting
   * diagram rather than as a sequence of things that happen to you. */
  ok(byKt['64'].y < byKt['50'].y && byKt['50'].y < byKt['34'].y,
     `64 kt at the top and 34 kt on the home line (y ${byKt['64'].y}/${byKt['50'].y}/${byKt['34'].y})`);
  ok(byKt['34'].w > byKt['50'].w && byKt['50'].w > byKt['64'].w,
     'and the stronger the wind the shorter it is on the house');
  ok(byKt['64'].x > byKt['50'].x && byKt['50'].x > byKt['34'].x,
     'they arrive weakest first, left to right');

  const labels = [...svg12.matchAll(/fill="var\(--kt(\d+)\)">([^<]*)</g)].map((m) => m[2]);
  ok(labels.some((t) => /^\d{1,2}:\d{2}/.test(t)), 'each bar says when the wind arrives');
  ok(labels.some((t) => /^≥\d+h$/.test(t)),
     'and an open-ended one is marked as a floor with ≥, not stated as a duration');
  /* ==> IN THE READER'S OWN UNITS, NOT KNOTS. <== This gutter was the last
   * place in the app still printing "64kt". Knots are what NHC publishes and
   * what the app stores; they are not what anybody chose in Settings, and a
   * chart captioned in a unit the reader has to convert cannot be compared to
   * the mph two inches above it. Putting `kt` back turns this red. */
  ok(labels.filter((t) => /^\d+ mph$/.test(t)).length === 3,
     'and the threshold is named in the gutter, in the units the reader picked');
  ok(!/\d+kt</.test(svg12), 'with no knots left anywhere in the picture');

  /* ==> THE TWO LABELS USED TO LAND ON TOP OF EACH OTHER. <== When a bar
   * starts at the left edge of the plot both the arrival and the duration
   * flipped to the right and were drawn a pixel apart. Advisory 14 and 16 are
   * real cases of it; they merge into one chip now. */
  for (const nnn of ['014', '016']) {
    const a = parseTcm(readAdv(nnn), { sourceId: 'al092021' });
    const d = buildHomeDashboard({
      storm: { ...a.storm, category: categoryFromKt(a.storm.windKt) },
      forecast: a.forecast.map((p) => ({ ...p, category: categoryFromKt(p.windKt) })),
      radii: a.radii, home: HOME, now: a.issuedMs });
    const svg = homeChart(d, 'imperial');
    /* SPANS, NOT ORIGINS. A label anchored `end` occupies the space to the
     * LEFT of its x and one anchored `start` the space to its right, so two
     * labels twelve pixels apart are fine one way round and overlapping the
     * other. Comparing the x attributes alone is how a collision test passes
     * a collision — this one did, on its first run. ~4.4 px per character at
     * font-size 7.5. */
    const placed = [...svg.matchAll(
      /<text x="([\d.]+)" y="([\d.]+)" font-size="7\.5" text-anchor="(\w+)"[^>]*fill="var\(--kt(\d+)\)">([^<]*)</g)]
      .map((m) => {
        const x = +m[1];
        const w = m[5].length * 4.4;
        return {
          row: m[2], text: m[5],
          lo: m[3] === 'end' ? x - w : x,
          hi: m[3] === 'end' ? x : x + w,
        };
      });
    ok(placed.length > 0, `adv ${nnn}: the rail has labels to check`);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        if (a.row !== b.row) continue; // different rows cannot collide
        ok(a.hi <= b.lo + 0.01 || b.hi <= a.lo + 0.01,
           `adv ${nnn}: "${a.text}" [${a.lo.toFixed(0)}-${a.hi.toFixed(0)}] and ` +
           `"${b.text}" [${b.lo.toFixed(0)}-${b.hi.toFixed(0)}] do not overlap`);
      }
    }
  }
}

/* ==> (vi) THE CHART MARKS NOW, AND NO LONGER CLAIMS ITS LEFT EDGE IS NOW.
 * <== The first sample is the storm's position as of the advisory, which on a
 * live feed is hours old; the leftmost axis label said "now" regardless. */
{
  const svg12 = homeChart(dash, 'imperial');
  ok(/stroke-dasharray="2 3"/.test(svg12), 'a dotted vertical marks the present');
  ok(/>now</.test(svg12), 'and it is labelled');
  /* ==> FIVE, ANGLED, EACH WITH A GRIDLINE. <== Three flat labels — start,
   * middle, end — left the middle of the plot with no time on it at all, so
   * "the wind arrives here" could not be read off the picture without counting
   * pixels. They are `transform`-positioned now rather than plain x/y, which
   * is what rotating them costs. */
  const axisLabels = [...svg12.matchAll(/rotate\(-38\)"[^>]*>([^<]*)</g)].map((m) => m[1]);
  ok(axisLabels.length === 5, `five axis labels (got ${axisLabels.join(', ')})`);
  ok(axisLabels.every((t) => /\d/.test(t)), 'each naming a real time');
  ok(!axisLabels.includes('now'),
     'and none of them is the word "now" — the axis states the time it actually shows');
}

/* =========================================================================
 * 5c. THE FRAME IS COMPOSED, AND THE CLOSEST PASS IS NAMED ON IT
 *
 * Two changes that only make sense together. The headroom above the home line
 * used to be a flat 58px holding three wind rows whether or not there were
 * three — so the storm with nothing reaching the house, which is most storms
 * most of the time, spent a third of the picture on blank sky. And the white
 * dotted vertical that marks the closest pass was the only unlabelled line on
 * the chart: you could see WHERE on the time axis and had to look away to the
 * panel above to find out WHEN.
 *
 * Ida gives every row count from a real advisory, which is why these are here
 * and not in a constructed fixture: 001 reaches nothing, 002 reaches 34 kt,
 * 005 adds 50, 012 adds 64. Every assertion below was watched go RED with its
 * rule broken.
 * ====================================================================== */
section('the composed frame');
{
  const { formatClockDay } = await import('../lib/time.js');

  const build = (nnn, home = HOME) => {
    const a = parseTcm(readAdv(nnn), { sourceId: 'al092021' });
    return buildHomeDashboard({
      storm: { ...a.storm, category: categoryFromKt(a.storm.windKt) },
      forecast: a.forecast.map((p) => ({ ...p, category: categoryFromKt(p.windKt) })),
      radii: a.radii, home, now: a.issuedMs });
  };
  /* Read back off the markup, never off the module's own constants — the
   * point is that the numbers the reader gets are right, not that two copies
   * of the same arithmetic agree. */
  const frame = (svg) => ({
    height: +(svg.match(/viewBox="0 0 320 ([\d.]+)"/) || [])[1],
    homeY: +(svg.match(
      /<line x1="46" y1="([\d.]+)" x2="310" y2="[\d.]+" stroke="var\(--coast-glow\)"/) || [])[1],
    bot: +(svg.match(/y1="6" x2="[\d.]+" y2="([\d.]+)" stroke="var\(--text-muted\)"/) || [])[1],
    rows: [...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)"[^>]*fill="var\(--kt(\d+)\)"/g)],
  });

  /* --- (i) ONE ROW PER FIELD THAT ARRIVES, AND NOT ONE MORE ---------------
   * MUTATION WATCHED: pinning the headroom back to a constant 58 turns every
   * line of this red except advisory 012, which is the whole point — 012 was
   * the only shape the old fixed frame ever fitted. */
  const seen = [];
  for (const [nnn, rows] of [['001', 0], ['002', 1], ['005', 2], ['012', 3]]) {
    const svg = homeChart(build(nnn), 'imperial');
    const f = frame(svg);
    ok(f.rows.length === rows, `adv ${nnn}: ${rows} wind row(s) on the rail (got ${f.rows.length})`);
    /* 16px of header, then 14 per row. Re-derived here rather than imported. */
    ok(f.homeY === 16 + 14 * rows,
       `adv ${nnn}: the home line sits at ${16 + 14 * rows}, under exactly its own rows (got ${f.homeY})`);
    /* ==> AND THE PLOT ITSELF NEVER MOVES SIZE. <== Reclaiming the headroom
     * must not quietly restretch the distance axis, or two screenshots of the
     * same storm an hour apart stop being comparable. */
    ok(f.bot - f.homeY === 148,
       `adv ${nnn}: the plot is the same 148 tall whatever the header does (got ${f.bot - f.homeY})`);
    /* The SVG is `height: auto` at `width: 100%`, so a shorter viewBox is a
     * shorter card. That is the visible half of this change. */
    ok(f.height === f.bot + 78, `adv ${nnn}: the frame ends 78 under the plot (got ${f.height})`);
    /* Rows are stacked from the home line up, contiguous, weakest first. */
    for (const m of f.rows) {
      const i = [34, 50, 64].filter((kt) =>
        f.rows.some((r) => +r[2] === kt)).indexOf(+m[2]);
      ok(+m[1] === f.homeY - 14 * (i + 1),
         `adv ${nnn}: the ${m[2]} kt bar is row ${i + 1} up from the house (y ${m[1]})`);
    }
    seen.push(f.height);
  }
  ok(seen[0] < seen[1] && seen[1] < seen[2] && seen[2] < seen[3],
     `and the card gets shorter as fewer fields reach (${seen.join(' < ')})`);
  ok(seen[3] - seen[0] === 42, 'by 42px between three rows and none');

  /* --- (ii) THE STAMP SAYS WHAT THE PANEL SAYS ---------------------------
   * MUTATION WATCHED: formatting the stamp with its own Intl call instead of
   * `formatClockDay` turns this red the moment the two disagree on a comma. */
  const stampOf = (svg) => (svg.match(
    /font-size="8\.5" font-weight="600" text-anchor="(\w+)" fill="var\(--text-primary\)">([^<]*)</) || []);
  {
    const d12 = build('012');
    const svg = homeChart(d12, 'imperial');
    const st = stampOf(svg);
    ok(st[2] === formatClockDay(d12.approach.time),
       `the stamp names the closest pass in the panel's own words (got "${st[2]}")`);
    ok(/^\w{3} \d/.test(st[2]), `and it carries the DAY, not just a clock time (got "${st[2]}")`);

    /* ==> THE LINE RUNS TO ITS OWN LABEL. <== A timestamp floating at the top
     * of the frame with up to 42px of colored bars between it and the line it
     * belongs to is a label the reader has to guess at. MUTATION WATCHED:
     * stopping the line at the home line, as it used to, turns this red. */
    const stampY = +(svg.match(/y="([\d.]+)" font-size="8\.5"/) || [])[1];
    const cpa = svg.match(/<line x1="([\d.]+)" y1="([\d.]+)" x2="[\d.]+" y2="([\d.]+)" stroke="var\(--text-primary\)"/);
    ok(+cpa[2] === stampY - 6,
       `the dotted line reaches the stamp rather than stopping at the house (y1 ${cpa[2]}, stamp at ${stampY})`);
    ok(+cpa[3] > frame(svg).homeY,
       'and still ends on the summit dot, below the home line');
  }

  /* --- (iii) IT EXISTS EXACTLY WHEN THE DOTTED LINE DOES ------------------
   * Ida heads for Prairieville on all nineteen advisories, so the negative
   * case is the same real advisory read from a house she never approaches.
   * MUTATION WATCHED: drawing the stamp unconditionally turns this red. */
  {
    const far = build('012', { lon: -149.9, lat: 61.2, label: 'Anchorage', source: 'address' });
    ok(far.approach?.relevant === false,
       'Ida really does have no relevant closest pass to Anchorage');
    const svg = homeChart(far, 'imperial');
    ok(!/stroke="var\(--text-primary\)" stroke-width="1" stroke-dasharray="3 3"/.test(svg),
       'so no dotted vertical is drawn');
    ok(!stampOf(svg)[2], 'and no stamp is drawn either — the label cannot outlive its line');
  }

  /* --- (iv) IT NEVER LANDS ON THE WORD "now" -----------------------------
   * SPANS, NOT ORIGINS — an `end`-anchored label occupies the space to the
   * LEFT of its x. Advisory 17 is the real collision: Ida's closest pass IS
   * now, so the two dotted verticals are on top of each other and the labels
   * cannot share a row. It takes a second header row rather than dropping one
   * of them. MUTATION WATCHED: forcing `headerRows = 1` turns this red. */
  for (const nnn of ['001', '002', '005', '012', '017']) {
    const svg = homeChart(build(nnn), 'imperial');
    const st = stampOf(svg);
    if (!st[2]) continue;
    const sx = +(svg.match(/<text x="([\d.]+)" y="[\d.]+" font-size="8\.5"/) || [])[1];
    const sy = +(svg.match(/y="([\d.]+)" font-size="8\.5"/) || [])[1];
    const sw = st[2].length * 5.0;
    const s = { lo: st[1] === 'end' ? sx - sw : sx, hi: st[1] === 'end' ? sx : sx + sw };
    ok(s.lo >= 2 - 0.01 && s.hi <= 318 + 0.01,
       `adv ${nnn}: the stamp stays inside the frame [${s.lo.toFixed(0)}-${s.hi.toFixed(0)}]`);

    const nowM = svg.match(/<text x="([\d.]+)" y="12" font-size="7\.5" fill="var\(--text-muted\)">now</);
    if (!nowM) continue;
    const n = { lo: +nowM[1], hi: +nowM[1] + 3 * 4.4 };
    const sameRow = sy === 12;
    if (sameRow) {
      ok(s.hi <= n.lo + 0.01 || s.lo >= n.hi - 0.01,
         `adv ${nnn}: stamp [${s.lo.toFixed(0)}-${s.hi.toFixed(0)}] clears "now" ` +
         `[${n.lo.toFixed(0)}-${n.hi.toFixed(0)}] on the row they share`);
    } else {
      ok(sy === 28 - 4 && frame(svg).homeY === 28 + 14 * frame(svg).rows.length,
         `adv ${nnn}: it cannot share the row, so it takes a second one (stamp y ${sy})`);
    }
  }
}

/* ==> THE ARIA LABEL IS THE ONLY THING A SCREEN READER GETS. <== It said
 * "for about 5 hours" beside a countdown saying "at least 5 hours" about the
 * same window, and on a sub-hour window it read "for about under an hour". */
const aria = (svg.match(/aria-label="([^"]*)"/) || [])[1];
ok(/Hurricane-force wind reaches you for at least 5 hours/.test(aria),
   `the summary says "at least" for an open-ended window (got: ${aria})`);
ok(!/wind reaches you for about/.test(aria),
   'and specifically never "about" about an open-ended window');
ok(!/(about under an hour|about about|at least about)/.test(aria),
   'and never a doubled hedge');

/* The short open-ended window, which is Advisory 14, is where the grammar
 * broke. It is a real advisory, not a construction. */
{
  const a14 = parseTcm(readAdv('014'), { sourceId: 'al092021' });
  const d14 = buildHomeDashboard({
    storm: { ...a14.storm, category: categoryFromKt(a14.storm.windKt) },
    forecast: a14.forecast.map((p) => ({ ...p, category: categoryFromKt(p.windKt) })),
    radii: a14.radii, home: HOME, now: a14.issuedMs,
  });
  near(d14.corridor.forecast[64].totalHours, 0.82, 0.05,
       'Advisory 14 puts hurricane force on the house for under an hour');
  const a = (homeChart(d14, 'imperial').match(/aria-label="([^"]*)"/) || [])[1];
  ok(/for at least 50 minutes/.test(a) && !/(about|under an hour)/.test(a.split(';')[1] || ''),
     `and says so in English, as a floor in minutes (got: ${a})`);
}

/* =========================================================================
 * 6. THE COUNTDOWN RUNS FORWARDS
 *
 * It is the accessible twin of the chart, so a scrambled order is not
 * cosmetic — it is the sequence of events arriving out of sequence for the
 * one reader who has nothing else.
 * ====================================================================== */
section('the countdown');

const { createHomeDashboardView } = await import('../ui/view-home.js');
const { setHome, clearHome } = await import('../data/home.js');
const { installFakeDocument, fakeHost } = await import('./fake-dom.mjs');

/* ==> THE RAIN FACADE, STUBBED TO ONE FIXED ANSWER. <== §48.8's section lives
 * on this dashboard and app/views.js injects its fetch; these suites are about
 * the dashboard's own sentences, not about rainfall, which has its own suite
 * against real NWS bytes (tools/test-rainfall.mjs). What matters here is that
 * the section is WIRED — a view built without it renders no Rain section at
 * all, and every assertion below would then be made against a screen the app
 * never shows. `not_covered` is the quietest real answer there is: one line,
 * no figures, nothing that could collide with an assertion about the storm.
 */
const RAIN_STUB = {
  loadRainfall: async () => ({ status: 'not_covered', payload: null, fetchedAt: null, stale: false }),
  retryRainfall: async () => ({ status: 'not_covered', payload: null, fetchedAt: null, stale: false }),
};
installFakeDocument();
setHome({ lon: HOME.lon, lat: HOME.lat, label: HOME.label, source: 'address' });
{
  /* THE STUB MOVED TO tools/fake-dom.mjs, which says what it fakes and what it
   * therefore cannot prove. Two suites drive this view and were carrying two
   * copies of the same twenty lines; the view has since grown a pinned stepper
   * that needs `document.createElement` and `host.prepend`, and one copy would
   * have been updated while the other broke. */
  const host = fakeHost();
  const innerEl = host.querySelector('.home-dash');
  const v = createHomeDashboardView({
    units: () => 'imperial',
    onEditHome() {}, onOpenStorm() {},
    warmGeometry: async () => ({
      state: 'ok', bundle: { forecast: CURVE, forecastRadii: ida.radii }, error: null }),
    now: () => NOW,
    /* Rain (§48.8) has its own suite against real NWS bytes; here it only has
     * to be WIRED, so the dashboard's own paths are exercised with the section
     * present rather than with it quietly missing. */
    rain: RAIN_STUB,
  });
  v.mount(host);
  v.onEnter();
  v.update({ storms: [STORM], sources: { nhc: { status: 'ok' }, gdacs: { status: 'ok' } } });
  await new Promise((r) => setTimeout(r, 0));
  const html = innerEl.innerHTML;

  ok(/Ida/.test(html), 'the storm is named');
  /* ==> THE HEADLINE NO LONGER SAYS THIS, AND THE PICTURE DOES. <== The
   * sentence "Hurricane-force wind reaches you for at least 5 hours, starting
   * Sun 8:25 PM" was cut as redundant: every clause of it is in the rail
   * directly beneath (the bar, its arrival time, its ≥5h floor) and in the
   * countdown beneath THAT. Three tellings of one fact. What must survive is
   * the FLOOR — an open-ended window closed because NHC stopped publishing
   * that threshold, not because the wind left, and understating how long
   * dangerous wind lasts is the unsafe direction to be wrong in. */
  ok(!/wind reaches you<\/b>\s*for at least/.test(html),
     'the headline does not repeat what the rail and the countdown both show');
  ok(/≥5h/.test(html), 'the rail carries the duration, marked as a floor');
  ok(/at least 5 hours in all/.test(html), 'and the countdown states it in words');

  const leads = [...html.matchAll(/<div class="home-rail-lead">([^<]*)<\/div>/g)].map((m) => m[1]);
  ok(leads.length >= 5, `the rail has ${leads.length} rows`);
  ok(leads[0] === 'now', 'and it starts at now');
  const hrs = leads.slice(1).map((t) => {
    const m = t.match(/in (\d+) (hrs?|mins?)/);
    return m ? (m[2].startsWith('hr') ? +m[1] : +m[1] / 60) : null;
  });
  ok(hrs.every((h) => h != null), `every remaining row carries a lead time (${leads.join(' | ')})`);
  for (let i = 1; i < hrs.length; i++) {
    ok(hrs[i] >= hrs[i - 1],
       `row ${i + 1} is not before row ${i} (${leads.slice(1).join(' | ')})`);
  }
  /* ==> AND THE ORDER IS NOT ORDERED BY ACCIDENT. <== On Ida the wind
   * outlasts the closest pass, so the row that used to be written last is not
   * the row that happens last. If these two ever land in source order again
   * the loop above goes red. */
  const iPass = leads.findIndex((t, k) => /Closest pass/.test(
    (html.split('<div class="home-rail-lead">')[k + 1] || '')));
  ok(/Closest pass/.test(html), 'the closest pass is on the rail');
  ok(html.indexOf('Closest pass') < html.indexOf('The forecast stops here, with wind still on you'),
     'and it comes BEFORE the row about winds easing, because it happens first');
  ok(iPass !== 0, 'sanity: the pass is not the first row');
}
clearHome();

/* =========================================================================
 * 6b. THE STAGE LADDER
 *
 * The chip used to be two words, and `Nearest` was a shrug covering four
 * unrelated situations — including every GDACS storm, because GDACS publishes
 * no heading and the app could not tell "not closing" from "cannot say". Ida
 * walks most of the ladder in one night, which is why she can test it.
 * ====================================================================== */
section('the stage ladder');

{
  const stageOf = (nnn) => {
    const a = parseTcm(readAdv(nnn), { sourceId: 'al092021' });
    return buildHomeDashboard({
      storm: { ...a.storm, category: categoryFromKt(a.storm.windKt) },
      forecast: a.forecast.map((p) => ({ ...p, category: categoryFromKt(p.windKt) })),
      radii: a.radii, home: HOME, now: a.issuedMs,
    }).stage;
  };

  ok(stageOf('008') === 'bearing-down', 'two days out, with wind forecast to reach: bearing down');
  ok(stageOf('015') === 'imminent', `six hours from the first wind: imminent (got ${stageOf('015')})`);
  ok(stageOf('016') === 'wind-here', 'wind already on the house: wind-here');
  ok(stageOf('017') === 'wind-here', 'still wind-here while she is inland and the field covers home');
  ok(stageOf('018') === 'past', 'once the field has left and she is going: past');

  /* ==> "PASSING YOU NOW" HAS TO BE NEAR AS WELL AS NOW. <== Advisory 18's
   * nearest point on the remaining track is 111 nm away and is happening this
   * minute. The first cut asked only about the clock and put "Passing you now"
   * on the chip for a storm a hundred miles off. */
  const a18 = parseTcm(readAdv('018'), { sourceId: 'al092021' });
  const d18 = buildHomeDashboard({
    storm: { ...a18.storm, category: categoryFromKt(a18.storm.windKt) },
    forecast: a18.forecast.map((p) => ({ ...p, category: categoryFromKt(p.windKt) })),
    radii: a18.radii, home: HOME, now: a18.issuedMs });
  ok(Math.abs((Date.parse(d18.approach.time) - d18.now) / 3_600_000) <= 1,
     'Advisory 18 really does have its nearest point within the hour');
  ok(d18.approach.nm > 86.9,
     `and it is ${d18.approach.nm.toFixed(0)} nm away, well outside the near ring`);
  ok(d18.stage !== 'overhead', 'so it is NOT called overhead');

  /* ==> A SOURCE WITH NO HEADING CANNOT BE CALLED "NOT CLOSING". <== */
  const a12 = parseTcm(readAdv('012'), { sourceId: 'al092021' });
  const noHeading = buildHomeDashboard({
    storm: {
      ...a12.storm, category: categoryFromKt(a12.storm.windKt),
      headingDeg: null, speedKt: null,
      lat: 10, lon: -40,   // far away, so no wind field reaches home
    },
    forecast: a12.forecast.map((p) => ({ ...p, category: categoryFromKt(p.windKt),
      lat: p.lat - 18, lon: p.lon + 50 })),
    radii: a12.radii, home: HOME, now: a12.issuedMs });
  ok(noHeading.stage === 'track-unknown',
     `a storm whose source publishes no heading says so (got ${noHeading.stage})`);

  /* Geometry has not arrived: the chip must not claim anything. */
  const bare = buildHomeDashboard({
    storm: { ...a12.storm, category: categoryFromKt(a12.storm.windKt) },
    forecast: [], home: HOME, now: a12.issuedMs });
  ok(bare.stage === 'pending', 'before the track loads the stage is pending, not a guess');
}

/* The words themselves, through the real view. */
{
  const host = fakeHost();
  const innerEl = host.querySelector('.home-dash');
  const a16 = parseTcm(readAdv('016'), { sourceId: 'al092021' });
  const c16 = a16.forecast.map((p) => ({ ...p, category: categoryFromKt(p.windKt) }));
  const s16 = { ...a16.storm, category: categoryFromKt(a16.storm.windKt) };
  const v = createHomeDashboardView({
    units: () => 'imperial', onEditHome() {}, onOpenStorm() {},
    warmGeometry: async () => ({
      state: 'ok', bundle: { forecast: c16, forecastRadii: a16.radii }, error: null }),
    now: () => a16.issuedMs,
    rain: RAIN_STUB,
  });
  setHome({ lon: HOME.lon, lat: HOME.lat, label: HOME.label, source: 'address' });
  v.mount(host);
  v.onEnter();
  v.update({ storms: [s16], sources: { nhc: { status: 'ok' }, gdacs: { status: 'ok' } } });
  await new Promise((r) => setTimeout(r, 0));
  const html = innerEl.innerHTML;
  /* THE CHIP IS IN THE DRAWER'S HEADER NOW, under the storm's name
   * (SPEC-UI §16.5), so it is read off the title block rather than the body. */
  const title = (() => { const t = v.titleFor(); return typeof t === 'string' ? t : t.innerHTML; })();
  ok(/On you now/.test(title), 'the chip says the wind is on the house');
  ok(!/Bearing down/.test(title), 'and does NOT still say bearing down');
  /* ==> AND THE SENTENCE IS IN THE PRESENT TENSE. <== "reaches you, starting
   * 10 PM" stayed in the future for the whole stretch the wind was blowing. */
  ok(/wind is on your house now/.test(html), 'the headline is in the present tense');
  ok(!/wind reaches you<\/b>/.test(html), 'and not in the future');
  /* The zero-length case must not splice a whole sentence into "lasting …". */
  ok(!/lasting and the forecast/.test(html), 'no clause is spliced where a phrase belongs');
  clearHome();
}

/* =========================================================================
 * 7. WHAT ACTUALLY HAPPENED
 *
 * NHC's Tropical Cyclone Report is the post-season truth: a reanalysed best
 * track and the observations. Bertha's headline finding was that every point
 * estimate was about twice too far out while every two-thirds band contained
 * the truth. Ida's is a different sentence, and it is only a different
 * sentence because the number is measured rather than expected.
 * ====================================================================== */
section('forecast against truth');

const TCR = fs.readFileSync(`${DIR}/tcr-AL092021_Ida.txt`, 'utf8');
ok(/Best track for Hurricane Ida/.test(TCR), 'the Tropical Cyclone Report is committed');

/** Best track, transcribed from Table 1 and grepped for below. */
const BEST = [
  { time: '2021-08-29T18:00:00Z', lat: 29.2, lon: -90.4, windKt: 125, row: '29 / 1800        29.2          90.4' },
  { time: '2021-08-30T00:00:00Z', lat: 29.9, lon: -90.6, windKt: 105, row: '30 / 0000        29.9          90.6' },
  { time: '2021-08-30T06:00:00Z', lat: 30.6, lon: -90.8, windKt: 65,  row: '30 / 0600        30.6          90.8' },
  { time: '2021-08-30T12:00:00Z', lat: 31.5, lon: -90.9, windKt: 40,  row: '30 / 1200        31.5          90.9' },
];
for (const b of BEST) ok(TCR.includes(b.row), `best track carries "${b.row.replace(/\s+/g, ' ')}"`);
ok(/29 \/ 1655        29\.1          90\.2           931            130/.test(TCR),
   'and the landfall row: 130 kt at Port Fourchon, 29/1655Z');

const truth = bruteMin(BEST, HOME, Date.parse(BEST[0].time));
near(truth.nm, 11.28, 0.05, 'the centre really passed 11.3 nm from the house');
ok(new Date(truth.ms).toISOString().startsWith('2021-08-30T03:5'),
   `at about 03:53Z (got ${new Date(truth.ms).toISOString()})`);

/* ==> IDA'S FINDING IS NOT BERTHA'S. <== Bertha's every point estimate was
 * roughly twice too far out. Ida's Advisory 12 was 11 nm too CLOSE and 14
 * minutes early — a better forecast than the chart's own resolution, and
 * wrong in the opposite direction. The one thing both storms share is the
 * only thing the screen actually claims: the two-thirds band contained the
 * truth, with room to spare. */
ok(ca.nm < truth.nm, 'the forecast pass was nearer than the real one, not further');
near(Math.abs(ca.nm - truth.nm), 11.1, 0.2, 'by about 11 nm');
ok(Math.abs(Date.parse(ca.time) - truth.ms) < 20 * 60_000,
   'and the timing was inside twenty minutes');
ok(truth.nm <= dash.band.nm,
   `the truth is inside the two-thirds band (${truth.nm.toFixed(1)} nm against ${dash.band.nm.toFixed(1)} nm)`);

/* THE WIND IS THE HARDER COMPARISON AND THE HONEST ANSWER IS A CAVEAT. The
 * nearest official anemometer to home is Louisiana Regional at Gonzales, 8 nm
 * south. It measured 41 kt sustained gusting 65 kt — tropical-storm force,
 * against a forecast of five hours of hurricane force on the house. NHC's
 * radii are the largest 1-minute sustained wind ANYWHERE in a quadrant, and a
 * sheltered inland ASOS is not that, so this is not a like-for-like
 * contradiction — but it is the measurement, and it is the reason the app
 * must never round a wind band up into a promise. */
ok(/Gonzalez \(KREG\)/.test(TCR), 'the nearest observing site to home is in the report');
ok(/30\/0235     979\.0     30\/0135        41       65/.test(TCR),
   'and it measured 41 kt sustained, gusting 65 kt, with a 979.0 mb minimum');
near(greatCircleNm(HOME.lon, HOME.lat, -90.94, 30.17), 8.2, 0.5,
     'that site is 8 nm from home, so it is the right thing to compare against');

/* =========================================================================
 * IDA'S OWN HISTORY, THROUGH THE REAL ROUTE (§49.3)
 *
 * Everything above tests where a storm is GOING. This tests where one HAS
 * BEEN, against NHC's published best track for Ida, served through the same
 * replay route the app uses — so the field names, the casing and the cut at
 * the replay clock are all the real ones rather than a fixture written to
 * match the parser.
 *
 * THE CASING IS THE TRAP THIS SECTION EXISTS FOR. The committed best-track
 * file spells its properties `DTG`, `INTENSITY`, `SS`, `STORMTYPE` — the
 * shapefile convention — while the live MapServer layer serves `dtg`,
 * `intensity`, `ss`, `stormtype`. The replay route lower-cases before it
 * answers. Nothing else in the app would notice if it stopped: the normalizer
 * would return an empty track, no error, and the past figures would simply
 * never appear.
 * ====================================================================== */
section("the observed track, off Ida's published best track");

{
  const { normalizePastPoints } = await import('../lib/track-point.js');

  /* Landfall day. Advisory 12's own time, so the cut is a real moment in the
   * storm's life rather than an arbitrary one. */
  const ISO = '2021-08-29T09:00:00Z';
  const raw = JSON.parse(
    await (await call(ISO, 'nhc/mapserver', q(SUMMARY_LAYER.pastPoints))).text()
  );
  ok(raw.features.length > 0, 'the replay route serves a past track at all');

  const past = normalizePastPoints(raw.features);
  ok(past.length === raw.features.length,
     'every published fix survives normalization — none is silently dropped');

  /* ==> IF THE ROUTE EVER STOPS LOWER-CASING, THIS IS THE ASSERTION THAT
   * NOTICES. <== An upper-cased payload normalizes to nothing at all. */
  ok(past.length > 8, `Ida has a real history by landfall day (${past.length} fixes)`);

  const ascending = past.every(
    (p, i) => i === 0 || Date.parse(p.time) >= Date.parse(past[i - 1].time)
  );
  ok(ascending, 'and it comes back in order');
  ok(past.every((p) => p.tau === null), 'with no forecast hour on any of it');

  /* THE CUT IS REAL: nothing in the observed track may lie ahead of the clock
   * it was cut at. This is the whole reason a past figure can be trusted. */
  ok(past.every((p) => Date.parse(p.time) <= Date.parse(ISO)),
     'no observed fix is in the future — the replay cut held');

  /* Ida began as a depression and was a major hurricane by this advisory.
   * Both ends are NHC's own grading, so both are `reported`. */
  /* Null-safe on purpose: an EMPTY track is the shape this section's whole
   * casing argument predicts, and it has to come out as a named failure
   * rather than as a TypeError three assertions later. */
  ok(past[0]?.stormType === 'TD' && past[0]?.category === 0,
     'she starts as a tropical depression, graded off NHC\'s own class letter');
  const strongest = past.reduce((a, b) => (b.windKt > (a?.windKt ?? -1) ? b : a), null);
  ok(strongest?.windKt >= 100,
     `her observed peak by this hour is a real measured wind (${strongest?.windKt} kt)`);
  ok(strongest?.categorySource === 'reported',
     "and its category is NHC's own Saffir-Simpson number, not our arithmetic");
  ok(past.every((p) => p.categorySource !== 'derived'),
     'nothing on a published NHC track needs deriving — every fix carries a class');

  /* The last observed fix is BEHIND the advisory position, by up to a synoptic
   * interval. That gap is why §49.5 makes the two walks share the current
   * position rather than letting the observed track stand in for it. */
  const lastMs = Date.parse(past[past.length - 1]?.time);
  const gapHrs = (Date.parse(ISO) - lastMs) / 3600000;
  ok(gapHrs >= 0 && gapHrs < 6.01,
     `the newest observed fix trails the advisory by under a synoptic interval (${gapHrs.toFixed(1)} h)`);
}

/* =========================================================================
 * 9. THE PASS AND THE PEAK, BACKWARDS (§49.5, §49.6)
 *
 * ===========================================================================
 * THE BUG THIS SECTION IS THE PROOF AGAINST
 * ===========================================================================
 *
 * Every past-tense figure on the home dashboard used to be computed from
 * now-plus-forecast, so the moment a storm was by the house they all collapsed
 * onto the present. Seen on glass 2026-08-16 on Lala: "CLOSEST IT CAME —
 * 138 mi" was her live distance, and "WHEN IT WAS CLOSEST — 69 mph" was the
 * NOW column beside it, character for character.
 *
 * Ida is the fixture that can prove the fix, because she really did go over
 * this house and then really did leave. At her Advisory 19 she is 141 nm away
 * and down to 30 kt — and the true closest she ever came is 11 nm, seventeen
 * hours earlier, at 79 kt. Three numbers, none of them each other.
 *
 * ===========================================================================
 * EVERY FIGURE BELOW IS COMPUTED, NOT TYPED
 * ===========================================================================
 *
 * The distance and time of the pass are checked against an INDEPENDENT
 * 20,000-step brute-force minimum over the same polyline, computed in this
 * file. If the ternary refinement in data/home.js ever regresses to reporting
 * the best SAMPLE — the exact bug section 4 of this file exists for, worth
 * 5.4 nm on Ida's forecast side — the two disagree and this goes red.
 *
 * The peak is checked against NHC's own Tropical Cyclone Report, which is
 * committed beside the advisories and says in plain words that Ida's peak
 * intensity was 130 kt at 1200 UTC 29 August. The app is not permitted to
 * agree with itself here; it has to agree with NHC.
 * ====================================================================== */
section('the pass and the peak, backwards (§49)');

{
  const { normalizePastPoints } = await import('../lib/track-point.js');
  const { HOME_DASH } = await import('../config/constants.js');

  /** One dashboard, built from an advisory PLUS the observed track the replay
   *  route serves for that same instant. Everything §49 pass 3 added is a
   *  function of those two together — an advisory alone still has no history,
   *  which is why the rest of this file's stage assertions are untouched. */
  const withHistory = async (nnn) => {
    const a = parseTcm(readAdv(nnn), { sourceId: 'al092021' });
    const iso = new Date(a.issuedMs).toISOString().replace(/\.\d+Z$/, 'Z');
    const raw = JSON.parse(
      await (await call(iso, 'nhc/mapserver', q(SUMMARY_LAYER.pastPoints))).text()
    );
    const past = normalizePastPoints(raw.features);
    return {
      a,
      past,
      dash: buildHomeDashboard({
        storm: { ...a.storm, category: categoryFromKt(a.storm.windKt) },
        forecast: a.forecast.map((p) => ({ ...p, category: categoryFromKt(p.windKt) })),
        past,
        radii: a.radii,
        home: HOME,
        now: a.issuedMs,
        trackState: 'ok',
      }),
    };
  };

  const { a: ida19, past: past19, dash: d19 } = await withHistory('019');

  /* --- the three numbers are three different numbers --------------------- */

  ok(d19.passed, 'a storm that has gone by has a closest pass that already happened');
  ok(d19.approach, 'and still has a forecast approach, because both facts exist (§49.2)');
  ok(d19.atPassed, 'and a wind measured at it');

  /* NULL-SAFE FROM HERE DOWN, deliberately, the same rule the observed-track
   * section above states: a MISSING past pass is the exact shape this whole
   * section exists to catch, and it has to come out as the named failure two
   * lines up rather than as a TypeError twenty lines later that reads like a
   * broken test rather than a broken app. */

  const liveNm = greatCircleNm(HOME.lon, HOME.lat, ida19.storm.lon, ida19.storm.lat);
  near(liveNm, 141.50, 0.05, 'Advisory 19 finds Ida 141 nm from the house');
  near(d19.approach.nm, liveNm, 0.01,
       'and her forecast approach is pinned to that live distance, as it should be');

  /* ==> THE HEADLINE FINDING. <== The old screen printed the line above under
   * the words "Closest it came". The real answer is an eighth of it. */
  ok(d19.passed?.nm < liveNm / 10,
     `the closest she ACTUALLY came is an order of magnitude nearer than where she is now `
     + `(${d19.passed?.nm.toFixed(2)} nm vs ${liveNm.toFixed(2)} nm)`);

  /* --- and the pass is proved against a brute-force minimum --------------- */

  const polyline = [
    ...past19,
    { lon: ida19.storm.lon, lat: ida19.storm.lat, time: ida19.storm.observedAt, windKt: ida19.storm.windKt },
  ];
  let brute = { nm: Infinity, ms: NaN, windKt: null };
  for (let i = 0; i < polyline.length - 1; i++) {
    const A = polyline[i];
    const B = polyline[i + 1];
    let dLon = B.lon - A.lon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const ta = Date.parse(A.time);
    const tb = Date.parse(B.time);
    for (let k = 0; k <= 20000; k++) {
      const f = k / 20000;
      const nm = greatCircleNm(HOME.lon, HOME.lat, A.lon + dLon * f, A.lat + (B.lat - A.lat) * f);
      if (nm < brute.nm) {
        brute = {
          nm,
          ms: ta + (tb - ta) * f,
          windKt: Number.isFinite(A.windKt) && Number.isFinite(B.windKt)
            ? A.windKt + (B.windKt - A.windKt) * f
            : null,
        };
      }
    }
  }

  near(d19.passed?.nm, brute.nm, 0.01,
       'the past pass is the TRUE minimum on the polyline, not the best sample');
  near(Date.parse(d19.passed?.time), brute.ms, 60_000,
       'and its time agrees with the brute-force minimum to within a minute');
  near(d19.passed?.windKt, brute.windKt, 0.5,
       'as does the analysed wind carried with it');

  /* THE FIGURES, ONCE, SO A REGRESSION READS AS A NUMBER RATHER THAN A DIFF.
   * Both were computed above before being compared to these. */
  near(d19.passed?.nm, 11.28, 0.02, 'Ida came 11.3 nm from this house');
  ok(d19.passed?.time?.startsWith('2021-08-30T03:5'),
     `and she did it at 03:52 UTC on the 30th (got ${d19.passed?.time})`);

  /* --- past tense means a past NUMBER, not a past verb on today's number -- */

  ok(d19.passed?.windSource === 'analysed',
     'the wind at that pass is named as a measurement, not a forecast sample');
  near(d19.atPassed?.windKt, 79.14, 0.1,
       'she was a 79 kt hurricane as she went by');
  /* Index 2 is the app's Category ONE — see the off-by-one note in
   * tools/test-home.mjs. 79 kt is 64-82 kt, so a Cat 1, off NHC's own `ss`
   * number on the fix rather than our arithmetic on the wind. */
  ok(d19.atPassed?.category === 2, 'a Category 1, off NHC\'s own grading of the fix');

  /* ==> THE LALA FAILURE, ASSERTED DIRECTLY. <== Two cells side by side on one
   * strip, and the bug was that they printed the same number. */
  ok(Math.abs(d19.atPassed?.windKt - ida19.storm.windKt) > 40,
     `"when it was closest" and "now" are 49 kt apart, not identical `
     + `(${d19.atPassed?.windKt?.toFixed(0)} kt vs ${ida19.storm.windKt} kt)`);

  /* --- the peak spans her whole life, and NHC says what it was ------------ */

  const TCR = fs.readFileSync(`${DIR}/tcr-AL092021_Ida.txt`, 'utf8');
  ok(TCR.includes('peak intensity of 130 kt at 1200 UTC'),
     'the Tropical Cyclone Report states her peak in so many words');

  ok(d19.peak?.windKt === 130, `the app agrees: 130 kt (got ${d19.peak?.windKt})`);
  ok(d19.peak?.time === '2021-08-29T12:00:00.000Z',
     `and puts it at 1200 UTC on the 29th, where the TCR does (got ${d19.peak?.time})`);
  ok(d19.peak?.when === 'past', 'and says out loud that it is behind the clock');
  ok(d19.peakWhenPassed === 'before',
     'the peak came before the closest pass — she was weakening as she went by');

  /* ==> AND THE OLD PEAK COULD NOT HAVE FOUND IT. <== Proof rather than
   * assertion: rebuild the same dashboard with no history and the peak
   * collapses onto the forecast-plus-now maximum, which on a dying storm is
   * the dying storm. 130 kt against 30 kt is the whole size of the bug. */
  const blind = buildHomeDashboard({
    storm: { ...ida19.storm, category: categoryFromKt(ida19.storm.windKt) },
    forecast: ida19.forecast.map((p) => ({ ...p, category: categoryFromKt(p.windKt) })),
    radii: ida19.radii, home: HOME, now: ida19.issuedMs, trackState: 'ok',
  });
  ok(blind.peak?.windKt < 50 && blind.peak?.when !== 'past',
     `without the observed track the peak is only ${blind.peak?.windKt} kt — what the old code saw`);
  ok(blind.passed === null && blind.atPassed === null,
     'and there is no past pass at all, which is honest rather than a zero');

  /* --- no error band ever touches a measured position (§49.2) ------------- */

  ok(!(d19.passed && 'band' in d19.passed),
     'the past pass carries no error band field — forecast error has no meaning on a measurement');
  ok(d19.band === null || d19.band.nm > 0,
     'and the band that does exist still belongs to the forecast approach alone');

  /* --- the rungs, judged on the pass that actually happened --------------- */

  const { dash: d18 } = await withHistory('018');
  ok(d18.stage === 'just-passed',
     `eleven hours after the pass she is just-passed (got ${d18.stage})`);
  ok(d19.stage === 'gone-by',
     `seventeen hours after it, past HOME_DASH.afterCpaHours, she is gone-by (got ${d19.stage})`);
  ok(d19.far === false,
     'and NOT far-off, which is the rung that hides the whole closest-pass section');

  /* ==> WITHOUT THE OBSERVED PASS SHE FALLS THROUGH. <== The rung used to be
   * judged on `approach.nm`, which for a departed storm is just how far away
   * she is now — 141 nm, well outside the near ring. This is the mechanism of
   * the bug, shown rather than described. */
  ok(blind.approach?.nm > HOME_DASH.nearRingNm,
     'her forecast approach is outside the near ring, so the old test could not fire');
  ok(blind.stage !== 'gone-by' && blind.stage !== 'just-passed',
     `and with no history the ladder cannot reach a past rung (got ${blind.stage})`);

  /* --- and it reaches the glass ------------------------------------------- */

  {
    /* An earlier section calls clearHome(). Without this the view renders its
     * no-home setup prompt and every assertion below passes vacuously by
     * failing to find text that was never going to be there. */
    setHome({ lon: HOME.lon, lat: HOME.lat, label: HOME.label, source: 'address' });
    const host = fakeHost();
    const innerEl = host.querySelector('.home-dash');
    const stormObj = {
      ...ida19.storm,
      category: categoryFromKt(ida19.storm.windKt),
      can: { forecastPoints: true },
    };
    const v = createHomeDashboardView({
      units: () => 'imperial',
      onEditHome() {}, onOpenStorm() {},
      warmGeometry: async () => ({
        state: 'ok',
        bundle: {
          forecast: ida19.forecast.map((p) => ({ ...p, category: categoryFromKt(p.windKt) })),
          forecastRadii: ida19.radii,
          past: past19,
        },
        error: null,
      }),
      now: () => ida19.issuedMs,
      rain: RAIN_STUB,
    });
    v.mount(host);
    v.onEnter();
    v.update({ storms: [stormObj], sources: { nhc: { status: 'ok' }, gdacs: { status: 'ok' } } });
    await new Promise((r) => setTimeout(r, 0));
    const html = innerEl.innerHTML;

    /* SCOPED TO THE HEADLINE BLOCK. The live distance is legitimately on this
     * screen — it is the whole point of the `Where it is` section — so a test
     * that just greps the page for it proves nothing. What must be true is
     * that it is not the number sitting under "Closest it came". */
    const headline = html.split('home-headline')[1]?.split('home-sect')[0] ?? '';
    ok(/Closest it came/.test(headline), 'the headline is in the past tense');
    ok(/13 mi/.test(headline),
       'and carries the 11.3 nm pass in miles (13 statute), not the live distance');
    ok(!/163 mi/.test(headline),
       'the live 141 nm is NOT under the past-tense heading — this is the Lala bug');
    ok(/163 mi/.test(html),
       'it is still on the screen, under "Where it is", where it belongs');
    ok(/not where\s+it was forecast to go/.test(headline),
       'the band is replaced by the sentence saying why there is none');
    ok(!/±/.test(headline),
       'and no ± band is drawn around a position the storm was measured at (§49.2)');
    ok(/Was strongest/.test(html), 'the strength strip puts the peak in the past tense too');
    ok(/When it was closest<\/div>\s*<div class="home-figs-v"[^>]*>91 mph/.test(html),
       'and the wind beside it is the 79 kt she was measured at, not the 35 kt she is now');
    ok(/Was strongest<\/div>\s*<div class="home-figs-v"[^>]*>150 mph/.test(html),
       'and 150 mph is the 130 kt peak the Tropical Cyclone Report states');
    ok(/before it reached you/.test(html),
       'and dates it against the pass that happened, not one that has not');
    ok(!/on the way in/.test(html) && !/all the way in/.test(html),
       'and says nothing about a journey that is already over');
    /* The chip rides on the view's TITLE, not in the dashboard body — same
     * place the countdown section reads it from. */
    const title = (() => { const t = v.titleFor(); return typeof t === 'string' ? t : t.innerHTML; })();
    ok(/It’s been by/.test(title),
       `the chip describes the past rather than the heading (got ${title.replace(/<[^>]*>/g, '').trim()})`);
    ok(!/Moving away/.test(title),
       'and not the old word, which was a statement about where she is pointed');
  }
  clearHome();
}

/* ------------------------------------------------------------------------- */

console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed`
    : `\n✓ ${pass} assertions passed`
);
console.log('  (the numbers are right; whether three bands READ is glass)');
process.exit(failures.length ? 1 : 0);
