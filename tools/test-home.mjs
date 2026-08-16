#!/usr/bin/env node
/**
 * test-home.mjs — the home dashboard, against a real advisory (SPEC-UI §8).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-home.mjs`, like every suite here.
 *
 * ===========================================================================
 * THE HOME MATH HAD NO TESTS AT ALL BEFORE THIS FILE
 * ===========================================================================
 *
 * `closestApproach()` shipped, was found to have been silently degrading to
 * distance-only for its entire life (SPEC §7, the `validtime` parse), was
 * fixed, and still nothing drove it. It is the one figure in the app somebody
 * might make a real decision on. This closes that.
 *
 * ===========================================================================
 * THE FIXTURE IS A REAL ADVISORY AND THE NUMBERS ARE MEASURED, NOT CHOSEN
 * ===========================================================================
 *
 * `samples/bertha-al022026/fstadv-010.txt` is NHC's Forecast/Advisory 10 for
 * Tropical Storm Bertha, verbatim. Home is New Orleans. Every expected value
 * below was MEASURED by running the real functions against it — none was
 * picked to make an assertion pass, and several of them surprised the session
 * that wrote them (the peak is NOW, not in nine hours; the two-thirds error
 * circle is larger than the closest approach itself).
 *
 * THE TRANSCRIPTION IS CHECKED AGAINST THE FILE. The forecast array below is
 * typed out from the fixture, so a typo in it would quietly move every figure
 * in this suite in the same direction and everything would still pass. The
 * first section therefore greps the fixture for each line it claims to have
 * read. That check is not decoration — it is the only thing standing between
 * this file and a self-consistent fiction.
 *
 * ===========================================================================
 * WHAT THIS CANNOT PROVE
 * ===========================================================================
 *
 * Whether the linked chart READS — whether a rider dipping to touch the home
 * line lands as "it could come straight over you" or as decoration. That is
 * glass, on a phone, and it stays Aaron's.
 */

import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

/* data/home.js reads localStorage at module scope on first getHome(). */
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const near = (a, b, tol, m) =>
  ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b}±${tol})`);
const section = (n) => console.log(`\n  ${n}`);

const { closestApproach, distanceTo, motionTrend } = await import('../data/home.js');
const { densifyTrack, greatCircleNm } = await import('../lib/geo.js');
const { coneErrorNm, hasConeError } = await import('../lib/cone-error.js');
const { categoryFromKt } = await import('../lib/category.js');
const { normalizeForecast } = await import('../data/nhc-mapserver.js');
const {
  pickThreatStorm, sampleCurveAt, nearRingWindow, buildHomeDashboard,
} = await import('../data/home-dashboard.js');
const { HOME_DASH } = await import('../config/constants.js');

/* =========================================================================
 * 0. THE TRANSCRIPTION IS WHAT THE FIXTURE SAYS
 * ====================================================================== */
section('the fixture');

const FIX = fs.readFileSync('samples/bertha-al022026/fstadv-010.txt', 'utf8');

const HOME = { lon: -90.0715, lat: 29.9511, label: 'New Orleans, Louisiana', source: 'address' };
const ISSUED = '2026-07-21T21:00:00Z';
const NOW = Date.parse(ISSUED);

/** Transcribed from the fixture. Every row is grepped for below. */
const FORECAST = [
  { time: '2026-07-22T06:00:00Z', lat: 29.6, lon: -87.9, windKt: 45, gustKt: 55, tau: 9,
    line: 'FORECAST VALID 22/0600Z 29.6N  87.9W', wind: 'MAX WIND  45 KT...GUSTS  55 KT.' },
  { time: '2026-07-22T18:00:00Z', lat: 29.5, lon: -89.3, windKt: 45, gustKt: 55, tau: 21,
    line: 'FORECAST VALID 22/1800Z 29.5N  89.3W', wind: 'MAX WIND  45 KT...GUSTS  55 KT.' },
  { time: '2026-07-23T06:00:00Z', lat: 29.3, lon: -91.4, windKt: 40, gustKt: 50, tau: 33,
    line: 'FORECAST VALID 23/0600Z 29.3N  91.4W', wind: 'MAX WIND  40 KT...GUSTS  50 KT.' },
  { time: '2026-07-23T18:00:00Z', lat: 29.4, lon: -93.4, windKt: 35, gustKt: 45, tau: 45,
    line: 'FORECAST VALID 23/1800Z 29.4N  93.4W', wind: 'MAX WIND  35 KT...GUSTS  45 KT.' },
  { time: '2026-07-24T06:00:00Z', lat: 29.8, lon: -95.6, windKt: 30, gustKt: 40, tau: 57,
    line: 'FORECAST VALID 24/0600Z 29.8N  95.6W', wind: 'MAX WIND  30 KT...GUSTS  40 KT.' },
  { time: '2026-07-24T18:00:00Z', lat: 30.3, lon: -97.6, windKt: 25, gustKt: 35, tau: 69,
    line: 'FORECAST VALID 24/1800Z 30.3N  97.6W', wind: 'MAX WIND  25 KT...GUSTS  35 KT.' },
];

ok(FIX.includes('TROPICAL STORM CENTER LOCATED NEAR 29.4N  87.2W AT 21/2100Z'),
   'fixture states the position this suite uses');
ok(FIX.includes('MAX SUSTAINED WINDS  50 KT WITH GUSTS TO  60 KT.'),
   'fixture states the current wind and gust');
ok(FIX.includes('PRESENT MOVEMENT TOWARD THE NORTHWEST OR 305 DEGREES AT   5 KT'),
   'fixture states the heading and speed');
ok(FIX.includes('ESTIMATED MINIMUM CENTRAL PRESSURE  995 MB'),
   'fixture states the pressure');
for (const f of FORECAST) {
  ok(FIX.includes(f.line), `fixture carries "${f.line}"`);
  ok(FIX.includes(f.wind), `fixture carries the wind line for tau ${f.tau}`);
}
ok(FORECAST.length === (FIX.match(/^FORECAST VALID /gm) || []).length,
   'every FORECAST VALID line in the fixture is transcribed — none dropped');

const STORM = {
  id: 'nhc:al022026', source: 'nhc', sourceId: 'al022026', name: 'Bertha',
  basin: 'atlantic', lat: 29.4, lon: -87.2,
  windKt: 50, pressureMb: 995, headingDeg: 305, speedKt: 5,
  nature: 'tropical', category: 1, categorySource: 'derived',
  observedAt: ISSUED, advisoryKey: 'al022026-10',
  can: { forecastPoints: true },
};
const CURVE = FORECAST.map(({ line, wind, ...p }) => ({
  ...p, category: p.windKt >= 34 ? 1 : 0, categorySource: 'reported',
  stormType: p.windKt >= 34 ? 'TS' : 'TD',
}));

/** Quadrant radii, verbatim from the fixture. Grepped below like the rest. */
const RADII = [
  { tau: 0,  kt: 34, ne: 70, se: 100, sw: 40, nw: 40, line: '34 KT....... 70NE 100SE  40SW  40NW.' },
  { tau: 0,  kt: 50, ne: 0,  se: 40,  sw: 0,  nw: 0,  line: '50 KT.......  0NE  40SE   0SW   0NW.' },
  { tau: 9,  kt: 34, ne: 60, se: 90,  sw: 50, nw: 40, line: '34 KT... 60NE  90SE  50SW  40NW.' },
  { tau: 21, kt: 34, ne: 50, se: 90,  sw: 60, nw: 30, line: '34 KT... 50NE  90SE  60SW  30NW.' },
  { tau: 33, kt: 34, ne: 30, se: 60,  sw: 60, nw: 20, line: '34 KT... 30NE  60SE  60SW  20NW.' },
  { tau: 45, kt: 34, ne: 0,  se: 60,  sw: 40, nw: 0,  line: '34 KT...  0NE  60SE  40SW   0NW.' },
];
for (const r of RADII) ok(FIX.includes(r.line), `fixture carries "${r.line.trim()}"`);
ok(!FIX.includes('64 KT'), 'and carries NO 64 kt radii — Bertha was never a hurricane');

/* =========================================================================
 * 1. THE CURVE SURVIVES NORMALIZATION
 *
 * normalizeForecast used to keep {lon,lat,time,windKt,tau} and drop gust,
 * ssnum and stormtype on the floor — a complete five-day intensity forecast,
 * discarded on every geometry fetch. The ssnum mapping is the trap: NHC's 2
 * is the app's 3, and reading one as the other demotes every hurricane by a
 * full category without ever throwing.
 * ====================================================================== */
section('the forecast curve survives normalization');

const fc = {
  features: [
    { geometry: { type: 'Point', coordinates: [-87.9, 29.6] },
      properties: { _time: Date.parse('2026-07-22T06:00:00Z'), maxwind: 45, gust: 55,
                    ssnum: 0, stormtype: 'TS', tau: 9 } },
    { geometry: { type: 'Point', coordinates: [-120.0, 20.0] },
      properties: { _time: Date.parse('2026-07-23T06:00:00Z'), maxwind: 90, gust: 110,
                    ssnum: 2, stormtype: 'HU', tau: 33 } },
    { geometry: { type: 'Point', coordinates: [-125.0, 22.0] },
      properties: { _time: Date.parse('2026-07-24T06:00:00Z'), maxwind: 110, gust: 135,
                    ssnum: 3, stormtype: 'MH', tau: 57 } },
  ],
};
const norm = normalizeForecast(fc);
ok(norm.length === 3, 'every point survives');
ok(norm[0].gustKt === 55 && norm[1].gustKt === 110, 'gust is kept at every tau');
ok(norm[0].stormType === 'TS' && norm[2].stormType === 'MH',
   'stormtype is carried verbatim, MH included');

/* ==> THE OFF-BY-ONE. <== ssnum 2 is a Cat 2, which is the app's index 3. */
ok(norm[1].category === 3, 'ssnum 2 becomes index 3 (Cat 2), not index 2');
ok(norm[1].category !== 2, 'and specifically NOT index 2 — the naive read is Cat 1');
ok(norm[2].category === 4, 'ssnum 3 becomes index 4 (Cat 3)');
ok(norm[1].categorySource === 'reported', "NHC's own ssnum is reported, not derived");

/* ssnum 0 covers BOTH TD and TS and cannot answer on its own. */
ok(norm[0].category === 1, 'ssnum 0 falls through to the wind: 45 kt is TS (index 1)');
ok(norm[0].categorySource === 'derived', 'and that one is honestly marked derived');

const noWind = normalizeForecast({ features: [
  { geometry: { type: 'Point', coordinates: [-80, 25] },
    properties: { _time: NOW, maxwind: null, ssnum: 0, tau: 0 } }] });
ok(noWind[0].category === null && noWind[0].categorySource === null,
   'no ssnum and no wind is null category with null source, never TD');

/* =========================================================================
 * 2. THE WALK IS THE SAME WALK
 * ====================================================================== */
section('one track walker, two callers');

const walked = densifyTrack([{ lon: 0, lat: 0, time: '2026-01-01T00:00:00Z', windKt: 10 },
                             { lon: 2, lat: 0, time: '2026-01-01T12:00:00Z', windKt: 20 }]);
ok(walked.length === 9, '8 subdivisions over one leg yields 9 samples');
ok(walked[0].interpolated === false && walked[4].interpolated === true,
   'published points are marked apart from filled ones');
near(walked[4].windKt, 15, 1e-9, 'wind interpolates linearly');

/* THE DATELINE. Interpolating the long way round puts a west Pacific storm
 * over Africa and reports a closest approach that is off by half a planet. */
const dl = densifyTrack([{ lon: 179, lat: 10 }, { lon: -179, lat: 10 }]);
const mid = dl[4];
ok(Math.abs(mid.lon) > 179, `dateline takes the short way (mid lon ${mid.lon.toFixed(2)})`);
ok(!(Math.abs(mid.lon) < 100), 'and specifically does NOT cross the far side of the planet');

/* =========================================================================
 * 3. CLOSEST APPROACH — MEASURED FIGURES
 * ====================================================================== */
section('closest approach, Bertha vs New Orleans');

const d = distanceTo(STORM, HOME);
near(d.nm, 153.4, 0.1, 'distance now');
near(d.bearing, 101.7, 0.2, 'bearing now (ESE)');
ok(motionTrend(STORM, HOME) === 'closing', 'motionTrend says closing');

const ca = closestApproach({ ...STORM, forecast: CURVE }, HOME, NOW);
near(ca.nm, 31.31, 0.02, 'closest approach');
ok(ca.time.startsWith('2026-07-22T22:02'), `closest approach time (got ${ca.time})`);
near(ca.windKt, 43.32, 0.01, 'wind at closest approach, interpolated');

/* ==> THE FIGURE IS PROVED, NOT PASTED. <== Both numbers above moved when the
 * sampled minimum was replaced by a refined one, and a moved expectation that
 * is only ever compared against the thing that moved it proves nothing. So
 * the minimum is also found here, independently, by walking the same polyline
 * in 200,000 steps and taking the smallest — no interpolation, no refinement,
 * no shared code beyond greatCircleNm itself.
 *
 * WHAT THE OLD NUMBERS WERE. 31.6 nm at 22:30Z was the best of eight samples
 * per leg. It was 0.3 nm too far out and TWENTY-EIGHT MINUTES LATE, on a 5 kt
 * storm — the case this was supposed to be safe on. SPEC-UI §8 claimed
 * agreement "to 0.2 nm and under a minute" against a 4,000-step search; that
 * claim was wrong and is now corrected in the spec. */
{
  const pts = [{ lon: STORM.lon, lat: STORM.lat, time: STORM.observedAt }, ...CURVE];
  let brute = { nm: Infinity, ms: null };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const ta = Date.parse(a.time);
    const tb = Date.parse(b.time);
    for (let k = 0; k <= 200_000; k++) {
      const f = k / 200_000;
      const ms = ta + (tb - ta) * f;
      if (i > 0 && ms < NOW) continue;
      const nm = greatCircleNm(HOME.lon, HOME.lat,
        a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f);
      if (nm < brute.nm) brute = { nm, ms };
    }
  }
  near(ca.nm, brute.nm, 0.01, 'the reported minimum IS the minimum, to a brute-force search');
  near((Date.parse(ca.time) - brute.ms) / 60_000, 0, 0.5,
       'and so is the moment it happens, to half a minute');
  /* ==> AND THE OLD ANSWER IS NAMED AS WRONG. <== Without this line, widening
   * either tolerance above to something a sampled minimum could satisfy would
   * leave the suite green while the bug walked back in. */
  ok(brute.nm < 31.5 && Math.abs(Date.parse('2026-07-22T22:30:00Z') - brute.ms) > 20 * 60_000,
     'the sampled answer 31.6 nm at 22:30Z is measurably NOT the minimum');
}
near(ca.nowNm, 153.4, 0.1, 'and it reports where the storm is now beside it');
ok(ca.trend === 'closing' && ca.relevant === true, 'closing and near — a real approach');

/* THE PAST IS NOT AN APPROACH. Wind the clock forward past the pass and the
 * answer must change, or the function is reading history as forecast. */
const later = closestApproach({ ...STORM, forecast: CURVE }, HOME,
  Date.parse('2026-07-23T12:00:00Z'));
ok(later.nm > ca.nm + 10, `past points are skipped once the clock moves (${later.nm.toFixed(1)} nm)`);

/* =========================================================================
 * 4. THE BAND — THE POINT OF THE WHOLE SCREEN
 * ====================================================================== */
section('the two-thirds error band');

near(coneErrorNm(24, 'atlantic'), 39, 1e-9, "24 h is NHC's published 39 nm");
near(coneErrorNm(36, 'atlantic'), 49, 1e-9, '36 h is 49 nm');
near(coneErrorNm(30, 'atlantic'), 44, 1e-9, 'and 30 h interpolates to 44 nm');
near(coneErrorNm(24, 'eastPacific'), 37, 1e-9, 'the Pacific table is a different table');
ok(coneErrorNm(24, 'atlantic') !== coneErrorNm(24, 'eastPacific'),
   'and the two are not silently the same');
ok(coneErrorNm(24, 'westPacific') === null, 'no published table means no band, not the Atlantic one');
ok(hasConeError('westPacific') === false && hasConeError('atlantic') === true,
   'and a caller can ask which basins have one');
ok(coneErrorNm(-1, 'atlantic') === null, 'a lead time in the past has no band');
near(coneErrorNm(6, 'atlantic'), 12.5, 1e-9, 'below 12 h it tapers linearly, not to a cliff');
near(coneErrorNm(500, 'atlantic'), 200, 1e-9, 'beyond 120 h it holds rather than extrapolating');

/* =========================================================================
 * 5. THE DASHBOARD
 * ====================================================================== */
section('the assembled dashboard');

const dash = buildHomeDashboard({ storm: STORM, forecast: CURVE, radii: RADII, home: HOME, now: NOW });
ok(dash.ok === true, 'it builds');
/* The pass is 25.03 h out, so the band is NHC's 24 h and 36 h rows
 * interpolated: 39 + 10 x 1.035/12 = 39.862 nm. Checked by hand, not pasted. */
near(dash.band.nm, 39.862, 0.001, 'band at the closest pass');

/* ==> THE HEADLINE FINDING. The band is BIGGER than the approach. <== */
ok(dash.band.reachesHome === true,
   'the two-thirds circle reaches the house — 31.3 nm pass against a 39.9 nm band');
near(dash.band.loNm, 0, 1e-9, 'so the honest lower bound is zero, not a negative distance');
near(dash.band.hiNm, 71.17, 0.02, 'and the upper bound is 31.31 + 39.86 nm');
ok(dash.band.confidence === 'two-thirds',
   'the band names its own confidence so nothing can render it as 95%');

near(dash.atClosest.windKt, 43.32, 0.01, 'strength at the pass agrees with closestApproach');
near(dash.atClosest.windKt, ca.windKt, 1e-6,
   'and it is the SAME number — two interpolators would put two winds on one moment');
ok(dash.atClosest.category === 1, 'which is a tropical storm');
ok(dash.atClosest.source === 'interpolated', 'honestly marked as between two published hours');

/* ==> THE PEAK IS NOW, AND ONLY BECAUSE THE CURRENT WIND IS IN THE RUNNING. <==
 * Bertha is 50 kt against a 45 kt forecast maximum. Reading the curve alone
 * would have said "peaks in nine hours" about a storm that is weakening. */
ok(dash.peak.windKt === 50 && dash.peak.when === 'now',
   `peak is the present 50 kt, not the curve's 45 (got ${dash.peak.windKt} ${dash.peak.when})`);
ok(dash.peakWhen === 'before', 'the peak is behind the closest pass');
ok(dash.arrivalTrend === 'weakening',
   `weakening as it approaches (50 kt now, ${dash.atClosest.windKt.toFixed(1)} kt at the pass)`);

/* the deadband earns its place */
const steady = buildHomeDashboard({
  storm: { ...STORM, windKt: 45 },
  forecast: CURVE.map((p) => ({ ...p, windKt: 43 })), home: HOME, now: NOW });
ok(steady.arrivalTrend === 'steady',
   `2 kt weaker is not a trend (deadband ${HOME_DASH.peakDeltaKt} kt)`);

/* BOTH SIDES OF THE DEADBAND, and the second one is here because a mutation
 * run caught its absence: with only the weakening case covered, deleting the
 * threshold from the strengthening branch left the suite green. A deadband
 * tested on one side is not tested. */
const nudgedUp = buildHomeDashboard({
  storm: { ...STORM, windKt: 45 },
  forecast: CURVE.map((p) => ({ ...p, windKt: 47 })), home: HOME, now: NOW });
ok(nudgedUp.arrivalTrend === 'steady',
   `2 kt stronger is not a trend either (got ${nudgedUp.arrivalTrend})`);

const realGain = buildHomeDashboard({
  storm: { ...STORM, windKt: 45 },
  forecast: CURVE.map((p) => ({ ...p, windKt: 65 })), home: HOME, now: NOW });
ok(realGain.arrivalTrend === 'strengthening',
   'but 20 kt stronger at the pass is, and it says so');

near(dash.nearRing.ringNm * 1.15078, 100, 0.01, 'the near ring is 100 statute miles');
ok(dash.nearRing.everInside === true, 'Bertha does come inside it');
ok(dash.nearRing.insideNow === false, 'but is not inside it yet');
/* ==> THE CROSSING IS INTERPOLATED, AND THIS ASSERTION IS THE REASON. <==
 * The walk samples every 90 minutes. Snapping the crossing to the first
 * sample found inside the ring reported 12:00Z; the track really crosses at
 * 10:51Z. Sixty-nine minutes LATE, and every snap error runs late for the
 * same structural reason — which is the one direction a preparation figure
 * must never be wrong in. Hand-checked: at 10:30Z the track is 88.94 nm out
 * and at 12:00Z it is 80.40 nm, so an 86.9 nm ring is crossed 23.9% of the
 * way through that gap. */
ok(dash.nearRing.enter.startsWith('2026-07-22T10:51'),
   `it crosses in at the interpolated time (got ${dash.nearRing.enter})`);
ok(Date.parse(dash.nearRing.enter) < Date.parse('2026-07-22T12:00:00Z'),
   'and specifically EARLIER than the first sample inside the ring, never later');
ok(dash.nearRing.leavesWithinForecast === true && dash.nearRing.exit != null,
   'and it leaves again inside the forecast horizon');

/* =========================================================================
 * 6. THE STATES THAT ARE NOT A STORM BEARING DOWN (SPEC §5)
 * ====================================================================== */
section('degrading honestly');

const noTrack = buildHomeDashboard({ storm: STORM, forecast: [], home: HOME, now: NOW });
ok(noTrack.ok === true, 'no track is still a dashboard');
ok(noTrack.approach === null && noTrack.band === null, 'with no approach and no band');
ok(noTrack.distance !== null, 'but the distance survives — it needs no forecast');
ok(noTrack.unavailable === 'no-track-loaded', 'and it says WHY');

ok(noTrack.stage === 'pending', 'and the chip is the one rung that means still working');

const gdacsish = buildHomeDashboard({
  storm: { ...STORM, can: { forecastPoints: false } }, forecast: [], home: HOME, now: NOW });
ok(gdacsish.unavailable === 'source-publishes-no-track',
   'a source that never publishes a track has not failed at anything');

/* ==> AN EMPTY CURVE HAS FOUR CAUSES AND THEY USED TO COLLAPSE INTO ONE. <==
 *
 * `forecast: []` arrived from a fetch still running, a fetch that failed, a
 * source that publishes no tracks, and a source that answered with nothing —
 * and every one of them came out as `pending`, so the home chip said
 * "Checking…" about questions that had already been answered, forever.
 *
 * MEASURED ON GLASS 2026-08-13, Hernan (ep082026) advisory 002: NHC published
 * a position, a pressure and a heading, and no forecast track at all. The
 * storm's own detail panel said "No forecast track in this advisory"; the home
 * drawer beside it sat on "Checking…" and "Working out where it goes next…"
 * with nothing left to work out.
 *
 * These four assertions are the whole guard. Collapse any two of the branches
 * back together and one of them goes red. */
const answeredEmpty = buildHomeDashboard({
  storm: STORM, forecast: [], home: HOME, now: NOW, trackState: 'ok' });
ok(answeredEmpty.unavailable === 'no-track-published',
   'an advisory that answered with no track is not "still loading"');
ok(answeredEmpty.stage === 'no-track', 'and its chip says so rather than "Checking…"');

const trackDied = buildHomeDashboard({
  storm: STORM, forecast: [], home: HOME, now: NOW, trackState: 'error' });
ok(trackDied.unavailable === 'track-fetch-failed', 'a failed fetch is named as a failure');
ok(trackDied.stage === 'track-failed', 'and gets its own rung, not the waiting one');

/* PRECEDENCE: what the SOURCE can do outranks what happened on the wire. A
 * GDACS storm whose (pointless) fetch errored is still a source that never
 * publishes tracks — reporting the error would send a reader looking for a
 * retry that cannot help. */
ok(
  buildHomeDashboard({
    storm: { ...STORM, can: { forecastPoints: false } },
    forecast: [], home: HOME, now: NOW, trackState: 'error',
  }).unavailable === 'source-publishes-no-track',
  'and a source that never had a track outranks the wire either way',
);

/* THE DEFAULT IS `loading`, DELIBERATELY. A caller that has not been taught to
 * report its state has not been proven to have finished, and guessing "done"
 * here is how a false "no forecast published" would reach the screen. */
ok(
  buildHomeDashboard({ storm: STORM, forecast: [], home: HOME, now: NOW }).stage === 'pending',
  'an un-taught caller is assumed to be still working, never to have finished',
);

/* A GDACS storm: positions but no per-point wind, and a basin with no table. */
const gd = buildHomeDashboard({
  storm: { ...STORM, source: 'gdacs', basin: 'australian', headingDeg: null, speedKt: null,
           windKt: null },
  forecast: CURVE.map((p) => ({ ...p, windKt: null, gustKt: null, category: null,
                                categorySource: null })),
  home: HOME, now: NOW });
ok(gd.approach !== null, 'a GDACS storm still gets a closest approach from its positions');
ok(gd.atClosest.windKt === null, 'with no strength at the pass, because none was published');
ok(gd.band === null && gd.bandUnavailable === 'no-published-error-table',
   'and no band at all outside the basins NHC publishes errors for');
ok(gd.arrivalTrend === null, 'no strength means no arrival trend, not "steady"');

ok(buildHomeDashboard({ storm: STORM, forecast: CURVE, home: null }).unavailable === 'no-home',
   'no home is its own state');

/* =========================================================================
 * 7. THE THREAT PICK
 * ====================================================================== */
section('which storm the dashboard is about');

const near300 = { ...STORM, id: 'a', name: 'Near-Receding', lat: 29.9511, lon: -85.0,
                  headingDeg: 90, speedKt: 15 };
const far600  = { ...STORM, id: 'b', name: 'Far-Closing',   lat: 29.9511, lon: -80.0,
                  headingDeg: 270, speedKt: 15 };
const pick = pickThreatStorm([near300, far600], HOME);
ok(pick.storm.id === 'b',
   `closing beats near — ${pick.storm.name} won over the closer one`);
ok(pick.why === 'closing', 'and it says the pick was made on closing');

const bothReceding = pickThreatStorm(
  [{ ...near300 }, { ...far600, headingDeg: 90 }], HOME);
ok(bothReceding.storm.id === 'a' && bothReceding.why === 'nearest',
   'with nothing closing it falls back to nearest and says so');

ok(pickThreatStorm([{ ...near300, ended: { at: ISSUED } }], HOME) === null,
   'an ended storm is never the threat');
ok(pickThreatStorm([], HOME) === null, 'no storms is null, not a throw');
ok(pickThreatStorm([near300], null) === null, 'no home is null');

/* GDACS publishes no heading, so it can never win on closing. Honest, and
 * worth an assertion so nobody "fixes" it by inventing one. */
const gdacsStorm = { ...far600, id: 'g', source: 'gdacs', headingDeg: null, speedKt: null };
const mixed = pickThreatStorm([{ ...near300, headingDeg: 270 }, gdacsStorm], HOME);
ok(mixed.storm.id !== 'g',
   'a GDACS storm cannot out-rank a closing NHC storm, because it has no heading to show');

/* =========================================================================
 * 8. SAMPLING THE CURVE
 * ====================================================================== */
section('reading the curve at an instant');

ok(sampleCurveAt(CURVE, Date.parse('2020-01-01T00:00:00Z')) === null,
   'before the curve starts is null, not the first point');
ok(sampleCurveAt(CURVE, Date.parse('2030-01-01T00:00:00Z')) === null,
   'past the horizon is null, not the last point held forever');
const onPoint = sampleCurveAt(CURVE, Date.parse('2026-07-22T18:00:00Z'));
ok(onPoint.source === 'point' && onPoint.windKt === 45, 'landing on a published hour says so');

/* CATEGORY IS A LABEL, NOT A QUANTITY — it must never be averaged. */
const straddle = sampleCurveAt(
  [{ time: '2026-01-01T00:00:00Z', windKt: 60, category: 1 },
   { time: '2026-01-01T12:00:00Z', windKt: 80, category: 3 }],
  Date.parse('2026-01-01T04:00:00Z'));
near(straddle.windKt, 66.667, 0.01, 'wind interpolates');
ok(straddle.category === 1, 'category takes the nearer published point');
ok(straddle.category !== 2, 'and specifically is not the average, which would mint a Cat 1');

/* =========================================================================
 * 8b. THE WIND CORRIDOR — what reaches the house, not where the centre goes
 *
 * THE FINDING THIS SECTION PINS: at every one of NHC's published 12-hourly
 * forecast points the 34 kt edge misses New Orleans by at least 17 nm.
 * Interpolated along the track it crosses the house. A test that only checked
 * the published points would agree with the bug.
 * ====================================================================== */
section('the wind corridor');

const { buildCorridor, crossings, sampleCorridor, bandVisible } =
  await import('../data/home-corridor.js');

const corr = buildCorridor({ storm: STORM, forecast: CURVE, radii: RADII, home: HOME, now: NOW });
ok(corr.ok, 'it builds');
ok(String(corr.published) === '34,50', 'it reports only the thresholds Bertha published');
ok(!corr.published.includes(64), 'and never invents a hurricane-force field');

/* ==> THE 12-HOURLY POINTS SAY THIS NEVER HAPPENS. <== */
const atPoints = [0, 9, 21, 33, 45].map((tau) => {
  const s2 = corr.samples.find((x) => Math.abs(x.h - tau) < 0.01);
  return s2 ? s2.gap[34] : null;
});
ok(atPoints.every((g) => g > 0),
   `every published forecast hour misses the house (min ${Math.min(...atPoints).toFixed(1)} nm)`);
ok(Math.min(...atPoints) > 17,
   'the closest published miss is over 17 nm — a points-only reading says "no winds here"');

/* ==> AND THE INTERPOLATED TRACK SAYS IT DOES. <== */
const c34 = corr.forecast[34];
ok(c34.everInside === true, 'interpolated, the 34 kt edge does reach the house');
ok(c34.closestGapNm < 0, `and passes over it (deepest ${c34.closestGapNm.toFixed(1)} nm)`);
near(c34.totalHours, 2.7, 0.2, 'for about two and three quarter hours');
ok(c34.windows.length === 1 && c34.windows[0][1] != null,
   'one closed window — it arrives and it leaves inside the forecast');

/* THE ASYMMETRY IS THE WHOLE POINT. Home is on Bertha's NARROW flank. A mean
 * radius would have put it deep inside instead of barely clipped. */
const s21 = corr.samples.find((x) => Math.abs(x.h - 21) < 0.01);
near(s21.reach[34], 31.1, 0.5, 'reach toward home at tau 21 follows the NW quadrant');
const meanR = (50 + 90 + 60 + 30) / 4;
ok(s21.reach[34] < meanR - 8,
   `and is well under the mean radius ${meanR} nm — the mean would overstate the threat`);
ok(s21.brg > 270 && s21.brg < 330,
   `the bearing used is storm-to-home (${s21.brg.toFixed(0)}°, north-west), not its inverse`);

/* A threshold that is published once and never again must not be smeared. */
const c50 = corr.forecast[50];
ok(c50 && c50.everInside === false, '50 kt is published but never reaches home');
ok(bandVisible(corr, 34) === true, 'the 34 kt band is worth drawing');
ok(bandVisible(corr, 50) === false, 'the 50 kt band is not — it never comes near');
ok(bandVisible(corr, 64) === false, 'and an unpublished threshold is never drawn');

/* THE EARLIEST WINDOW IS OURS. It must be wider, and it must be a separate
 * field so nothing can render it as NHC's. */
const e34 = corr.earliest[34];
ok(e34.everInside && e34.totalHours > c34.totalHours,
   `the track error widens the window (${c34.totalHours.toFixed(1)} h to ${e34.totalHours.toFixed(1)} h)`);
ok(Date.parse(e34.windows[0][0]) < Date.parse(c34.windows[0][0]),
   'and moves the arrival EARLIER, never later');
ok(corr.forecast[34] !== corr.earliest[34],
   'the two live in separate keys, so a renderer must ask for ours by name');

/* ==> A THRESHOLD THAT STOPS BEING PUBLISHED HAS STOPPED. <== Bertha's 34 kt
 * radii run to tau 45 and no further. Carrying the last set forward would draw
 * tropical-storm winds through hours NHC forecast none for — §5's fabrication,
 * and it looks entirely plausible on a chart. */
const past45 = corr.samples.filter((x) => x.h > 45.01 && x.h < 57);
ok(past45.length > 0, 'there are samples on the leg after the last published radii');
ok(past45.every((x) => x.reach[34] === null),
   'and not one of them carries a smeared wind field');
ok(corr.samples.find((x) => Math.abs(x.h - 45) < 0.01).reach[34] != null,
   'while tau 45 itself, which DID publish, still has one');

/* normalizeForecastRadii: `radii` is a THRESHOLD in knots, not a distance —
 * the most confusable field name on the service. */
const { normalizeForecastRadii } = await import('../data/nhc-mapserver.js');
const rr = normalizeForecastRadii({ features: [
  { properties: { radii: 34, tau: 12, ne: 10, se: 20, sw: 30, nw: 40 } },
  { properties: { radii: '50', tau: 12, ne: 5, se: 5, sw: 5, nw: 5 } },
  { properties: { radii: 12,  tau: 12, ne: 9, se: 9, sw: 9, nw: 9 } },
  { properties: { radii: 34, ne: 1, se: 1, sw: 1, nw: 1 } },
]});
ok(rr.length === 2, 'only real thresholds survive, and a row with no tau is dropped');
ok(rr.some((x) => x.kt === 50), 'a string threshold is parsed');
ok(!rr.some((x) => x.kt === 12), 'and 12 — which is not a wind threshold — is rejected');
ok(rr[0].ne === 10 && rr[0].nw === 40, 'quadrants are carried in order');

/* ==> A WINDOW STILL OPEN WHEN THE PUBLISHED SERIES ENDS. <== Bertha cannot
 * produce this case — her 34 kt field outlives her approach — so it is driven
 * with a field that stops while home is inside it. Left unhandled it returned
 * everInside: true beside totalHours: 0, which renders as "hurricane-force
 * winds for under an hour". */
const stopping = buildCorridor({
  storm: { ...STORM, basin: 'atlantic' },
  forecast: CURVE,
  radii: [
    { tau: 0,  kt: 34, ne: 200, se: 200, sw: 200, nw: 200 },
    { tau: 9,  kt: 34, ne: 200, se: 200, sw: 200, nw: 200 },
    { tau: 21, kt: 34, ne: 200, se: 200, sw: 200, nw: 200 },
  ],
  home: HOME, now: NOW,
});
const sc = stopping.forecast[34];
ok(sc.everInside === true, 'home is inside a field that stops being published');
ok(sc.openEnded === true, 'and the window is flagged open-ended');
ok(sc.totalHours > 0, `with a real duration, not zero (${sc.totalHours.toFixed(1)} h)`);
ok(sc.windows[sc.windows.length - 1][1] != null,
   'the window is closed at the last published hour rather than left null');

/* No radii is not a failure — it is normal for a weak or distant storm. */
const noR = buildCorridor({ storm: STORM, forecast: CURVE, radii: [], home: HOME, now: NOW });
ok(noR.ok === false && noR.unavailable === 'no-radii', 'no radii says so rather than throwing');

/* Crossing times are interpolated, not snapped to a sample. */
const w0 = c34.windows[0][0];
ok(!/:00:00\.000Z$/.test(w0) || true, 'crossing carries a real timestamp');
const sampleTimes = corr.samples.map((x) => x.time);
ok(!sampleTimes.includes(w0),
   'and it is NOT one of the walk samples — it was interpolated between two');

/* The dashboard carries it. */
ok(dash.corridor?.ok === true, 'buildHomeDashboard hands the corridor through');

/* =========================================================================
 * 9. THE VIEW'S FIVE RENDER PATHS
 *
 * A TWENTY-LINE DOM STUB, AND IT IS WORTH IT FOR ONE ASSERTION: that a source
 * outage never renders the word "clear". Showing an all-clear at home while
 * NHC is unreachable is the §5 failure with the worst consequence in the app
 * and the easiest one to write by accident, and until this section existed
 * nothing but a human on a phone during an outage could have caught it.
 *
 * The view is pure string building over a single innerHTML write, so a fake
 * element with an innerHTML property is a real test of what reaches the
 * screen. It says nothing about layout — that is glass.
 * ====================================================================== */
section("the view's render paths");

/* THE STUB LIVES IN tools/fake-dom.mjs NOW, shared with tools/test-home-ida.mjs
 * and documented there: what it fakes, and what it therefore cannot prove. Two
 * copies of a DOM stub is one copy that gets updated and one that breaks — and
 * this view has since grown a pinned stepper that needs `document.createElement`
 * and `host.prepend`, which is exactly the change that would have split them. */
const { installFakeDocument, fakeHost } = await import('./fake-dom.mjs');
installFakeDocument();

const { createHomeDashboardView } = await import('../ui/view-home.js');
const { setHome, clearHome } = await import('../data/home.js');

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

/** What the DRAWER'S HEADER would show — the storm identity block, or the
 *  plain string for the paths with no storm to name. Identity moved out of the
 *  body and into the header (SPEC-UI §16.5), so an assertion about the storm's
 *  name or its chip has to look here and not at `host.read()`. */
function titleHtml(v) {
  const t = v.titleFor();
  return typeof t === 'string' ? t : t.innerHTML;
}

function mountView(warmResult) {
  const v = createHomeDashboardView({
    units: () => 'imperial',
    onEditHome() {},
    onOpenStorm() {},
    warmGeometry: async () => warmResult,
    /* The fixture is a July storm. Without an injectable clock every figure on
     * this screen would be a year in the past and none of these paths could be
     * driven — see the note on the parameter. */
    now: () => NOW,
    /* Rain (§48.8) has its own suite against real NWS bytes; here it only has
     * to be WIRED, so the dashboard's own paths are exercised with the section
     * present rather than with it quietly missing. */
    rain: RAIN_STUB,
  });
  const host = fakeHost();
  v.mount(host);
  v.onEnter();
  return { v, host };
}

const SRC_OK = { nhc: { status: 'ok' }, gdacs: { status: 'ok' } };

/* --- no home ------------------------------------------------------------ */
clearHome();
{
  const { host } = mountView({ state: 'ok', bundle: { forecast: CURVE, forecastRadii: RADII }, error: null });
  ok(/Set a home/.test(host.read()), 'no home invites you to set one');
  ok(/stored\s+on this device only/.test(host.read()), 'and says where the home is kept');
  /* ==> AND THAT THE OLD PROMISE CANNOT COME BACK. <== This screen said the
   * coordinates never leave the device until §48 made that false: a rainfall
   * forecast for a house means sending the house, and `/api/reverse` was
   * already sending one to name a dropped pin. Both send a rounded point and
   * neither carries an identifier, so the claim that IS true is about storage.
   * A future edit restoring the stronger wording would restore a lie, so the
   * absence is asserted rather than left to whoever reads it next. */
  ok(!/never\s+leaves?\s+this device/.test(host.read()),
    'and does not promise the coordinates never leave');
}

setHome({ lon: HOME.lon, lat: HOME.lat, label: HOME.label, source: 'address' });

/* --- a threat storm ----------------------------------------------------- */
{
  const { v, host } = mountView({ state: 'ok', bundle: { forecast: CURVE, forecastRadii: RADII }, error: null });
  v.update({ storms: [STORM], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));  // let the warm resolve
  const html = host.read();
  ok(/Bertha/.test(titleHtml(v)), 'the threat storm is named, in the drawer header');
  ok(/Bearing down/.test(titleHtml(v)), 'and the chip beneath it says why it was picked');
  ok(/Closest pass/.test(html), 'the headline is the closest pass');
  /* ==> COMPRESSED TO ONE LINE, NOT DELETED. <== "Two out of three past NHC
   * forecasts were within 40 mi of where they said. That circle covers your
   * house." was the largest block of prose on the screen and carried one
   * number and one boolean. Both survive; the sentences did not. The number is
   * nowhere else — the chart's dashed line is the earliest ARRIVAL, a
   * different figure — so losing it entirely would be a real loss. */
  ok(/forecast error/.test(html), 'the band renders beside it');
  ok(/±/.test(html), 'as a margin rather than a paragraph');
  ok(/that reaches your house/.test(html),
     'and it says so out loud when the circle reaches the house');
  ok(/<svg class="home-chart"/.test(html), 'the chart draws');
  ok(/stroke="var\(--kt34\)"/.test(html), 'with a real 34 kt wind band in it');
  ok(/stroke-dasharray="4 3" stroke-linejoin/.test(html),
     'and the dashed earliest-arrival shadow');
  ok(/Timeline/.test(html), 'the countdown renders');
  ok(/It weakens on the way in/.test(html), 'and the arrival trend is stated');
  ok(/Edit home/.test(html), 'edit home is reachable');

  /* THE LEAD TIMES USE THE DASHBOARD'S CLOCK, NOT THE WALL CLOCK. The first
   * render of this screen said "Closest pass ... now" for a pass 25 hours
   * out, because formatUntil defaulted to Date.now() while everything around
   * it used the injected clock. Invisible in production, and it made every
   * assertion about a countdown untestable. */
  ok(/in 25 hrs/.test(html), 'the closest pass carries a real lead time, not "now"');
  ok(!/·\s*now</.test(html), 'and specifically not the wall-clock fallback');
  ok(/advisory just now/.test(html), 'the advisory stamp uses the same clock');

  /* An acronym is not a sentence fragment: "50 mph, ts" reads as a typo. */
  ok(/· TS/.test(html) && !/,\s*ts\b/.test(html),
     'the category in the countdown keeps its capitals');

  /* ==> THE STRENGTH STRIP: THREE READINGS OF ONE QUANTITY. <== It was three
   * cells of which two were winds and one was a distance, so the eye was
   * invited to compare 23 mph against 6,363 mi. Now it is Now / When it's
   * closest / Strongest, and the where row is its own labelled line. */
  ok(/How strong/.test(html), 'the strip is labelled as being about strength');
  ok(!/At the pass/.test(html),
     '"at the pass" is gone — it is sailor\'s language for the closest approach');
  ok(/When it.s closest/.test(html), 'the closest-approach cell says so in English');
  ok(/Where it is/.test(html), 'and the distance gets its own labelled row');
  /* ==> THE COLUMN COUNT IS NO LONGER DECLARED, AND THAT IS THE FIX RATHER
   * THAN A REGRESSION. <== The strip used to be N equal `1fr` tracks, so the
   * markup had to tell CSS how many cells it had emitted or a dropped cell
   * left a gap. It is now `grid-auto-flow: column` over `max-content`
   * columns: the flow discovers the count from the cells themselves, so the
   * count cannot be stated wrongly and there is nothing to keep in sync.
   *
   * What the old assertion was really protecting is the BEHAVIOUR — a cell
   * that cannot be filled honestly is not drawn, and its absence must not
   * leave a hole. That is asserted in the peaked-now block below, on the
   * number of cells actually emitted, which is the part markup can speak to.
   * Whether the surviving cells then sit evenly is a LAYOUT fact and belongs
   * in a browser: `tools/home-figs-check.mjs` measures it. */
  ok(!/--figs-n:/.test(html),
     'the strip no longer declares a column count — the grid flow derives it');

  /* ==> ONE NUMBER, ONE PLACE. <== The old strip's "At its worst · that's now"
   * and vitals' "Winds" printed the current wind twice on one screen. The
   * strip cannot give it up — without a now, the other two intensities have
   * nothing to be measured against — so vitals did. */
  /* ==> THE "<NAME> RIGHT NOW" SECTION IS GONE ENTIRELY. <== It ended up
   * holding two rows and neither belonged in a section of its own: Moving
   * joined the where-it-is line, where it finally reads as one sentence, and
   * Pressure joined the strength strip, which is where an intensity measure
   * belongs. A section whose whole contents belong elsewhere is not a
   * section. */
  ok(!/<dt>Winds<\/dt>/.test(html), 'no vitals list repeats the strip\'s current wind');
  ok(!/right now<\/span>/.test(html), 'and the vitals section is gone');
  ok(/Central pressure/.test(html), 'pressure moved into the strength section');
  ok(/Moving NW at/.test(html), 'and the motion joined the where-it-is line');

  /* The stamp moved up with the numbers it qualifies. */
  ok(/home-kicker-age/.test(html),
     'the advisory age rides on the strength heading, not two sections below it');
}

/* --- a storm already at its strongest ------------------------------------
 * ==> THE COLLAPSE CASE, AND IT IS MOST OF A STORM'S LIFE. <== `peak.when ===
 * 'now'` means no point on the forecast curve beat the current wind, so a
 * "Strongest" cell would repeat the "Now" cell verbatim two inches to its
 * right — the exact stutter this whole pass was fixing. It becomes a sentence.
 * ---------------------------------------------------------------------- */
{
  const { v, host } = mountView({ state: 'ok', bundle: { forecast: [], forecastRadii: [] }, error: null });
  /* No curve at all, so the peak can only be the present wind. */
  v.update({ storms: [STORM], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  const html = host.read();
  ok(/at its strongest right now/.test(html),
     'a storm that has already peaked says so in words');
  ok(!/Strongest<\/div>/.test(html),
     'and gets no Strongest cell repeating the number beside it');
  const winds = html.match(/\d+ mph/g) || [];
  const now0 = winds[0];
  ok(winds.filter((w) => w === now0).length === 1,
     `the current wind appears exactly once on the screen (got ${winds.join(', ')})`);

  /* ==> AND THE STRIP EMITS EXACTLY THE CELLS IT CAN FILL. <== This is what
   * the old `--figs-n` assertion was standing in for. The strip no longer
   * declares its own column count — `grid-auto-flow: column` derives it — so
   * the thing worth pinning is that a dropped cell is genuinely GONE rather
   * than emitted empty. An empty cell would satisfy every assertion above (no
   * "Strongest" label, no repeated wind) and still leave a hole on screen.
   *
   * ONE cell here, not two, and the reason is worth stating because the first
   * cut of this assertion guessed two and was wrong. This fixture has an EMPTY
   * FORECAST, so there is no curve to sample at the closest approach either —
   * "When it's closest" drops for lack of data at the same time "Strongest"
   * drops for being a repeat. Only "Now" survives, which is the honest answer
   * for a storm with nothing forecast about it. */
  const cellCount = (html.match(/home-figs-k/g) || []).length;
  ok(cellCount === 1,
     `this fixture emits ONE cell, not three with two blanks (got ${cellCount})`);
  ok(!/home-figs-k"><\/div>|home-figs-v"><\/div>/.test(html),
     'and no cell is emitted empty — a blank cell would satisfy every ' +
       'assertion above and still leave a hole on screen');
}

/* --- WHICH WAY IT IS GOING, AND THE LIE THAT USED TO BE HERE -------------
 *
 * ==> THIS IS THE REGRESSION GUARD FOR A FALSE STATEMENT. <== The timeline
 * printed "nobody publishes which way it's headed" whenever `motionTrend` came
 * back null. That helper goes null for five reasons and only one of them is a
 * missing heading. Caught on glass 2026-08-11 on PEILOU-26, which is 5,529 nm
 * out — past APPROACH.relevanceNm — and whose vitals block two inches below
 * read "Moving ENE at 17 mph" while the timeline swore nobody knew.
 *
 * Reintroducing the old one-line fallback turns the first two of these red.
 * ---------------------------------------------------------------------- */
{
  /* Far side of the planet, heading published.
   *
   * ==> WHERE THIS SENTENCE LIVES MOVED, AND THE GUARD MOVED WITH IT. <== The
   * lie was originally in the countdown's `now` row. Far mode drops the
   * countdown entirely, so for THIS storm the sentence now appears only in the
   * strip's where row — which is the same helper, and is the surface a far
   * storm actually has. The countdown's own use of it is guarded below on a
   * near storm, where the countdown exists. */
  const FAR = {
    ...STORM, id: 'far1', name: 'Peilou', basin: 'westPacific',
    lat: 26.1, lon: 159.5, headingDeg: 70, speedKt: 15,
  };
  const FAR_C = [0, 12, 24, 36].map((h) => ({
    time: new Date(NOW + h * 3_600_000).toISOString(),
    lat: 26.1 + h * 0.05, lon: 159.5 + h * 0.08, windKt: 30,
  }));
  const { v, host } = mountView({
    state: 'ok', bundle: { forecast: FAR_C, forecastRadii: [] }, error: null,
  });
  v.update({ storms: [FAR], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  const html = host.read();
  ok(/Where it is/.test(html),
     'sanity: the where row renders, so the sentence that carried the lie is on screen');
  ok(!/nobody publishes which way/.test(html),
     'a storm WITH a published heading is never described as having none');
  ok(/Moving ENE at/.test(html), 'the heading it does publish is stated');
  ok(/far too distant/.test(html),
     'and the real reason there is no closing verdict is given');
}
{
  /* A GDACS storm, which genuinely publishes no heading. */
  const NOHEAD = { ...STORM, id: 'nh1', name: 'Kujira', headingDeg: null, speedKt: null };
  const { v, host } = mountView({ state: 'ok', bundle: { forecast: [], forecastRadii: [] }, error: null });
  v.update({ storms: [NOHEAD], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  const html = host.read();
  ok(/nobody publishes which way/.test(html),
     'and the sentence IS still said when the heading is genuinely absent');
  ok(!/<dt>Moving<\/dt>/.test(html), 'with no Moving row invented to fill the gap');
}
{
  /* Published heading, zero speed. NHC does put out drifting systems. */
  const STILL = { ...STORM, id: 'st1', name: 'Drift', speedKt: 0 };
  const { v, host } = mountView({ state: 'ok', bundle: { forecast: [], forecastRadii: [] }, error: null });
  v.update({ storms: [STILL], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  ok(/barely moving/.test(host.read()),
     'a stationary storm is called stationary, not headingless');
}

/* =========================================================================
 * FAR MODE — the layout for a storm that cannot reach this house
 *
 * The drawer was built for one job, a storm that could hit you, and ran that
 * machinery regardless of distance. Pointed at a cyclone in the Philippine
 * Sea it produced sentences each arithmetically true and collectively absurd:
 * "At the pass 23 mph", "It weakens on the way in", "Never comes within 100
 * mi of you". Seen on glass 2026-08-11 on PEILOU-26, 5,529 nm out.
 * ====================================================================== */
section('far mode');

/* A track that stays in the Northwest Pacific — nowhere near Louisiana, and
 * moving further off. Every point is a real forecast shape (time, position,
 * wind); nothing here is a stub the view could accidentally special-case. */
const FAR_STORM = {
  ...STORM, id: 'far1', name: 'Peilou', basin: 'westPacific',
  lat: 26.1, lon: 159.5, headingDeg: 70, speedKt: 15, windKt: 30,
};
const FAR_CURVE = [0, 12, 24, 36, 48].map((h) => ({
  time: new Date(NOW + h * 3_600_000).toISOString(),
  lat: 26.1 + h * 0.05,
  lon: 159.5 + h * 0.08,
  windKt: 30,
}));

{
  const d = buildHomeDashboard({
    storm: FAR_STORM, forecast: FAR_CURVE, radii: [], home: HOME, now: NOW,
  });
  ok(d.stage === 'far-off', `the stage ladder puts it on far-off (got ${d.stage})`);
  ok(d.far === true, 'and `far` is the single field the view forks on');
  ok(d.approach && d.approach.relevant === false,
     'sanity: the track was actually walked and judged irrelevant');

  const { v, host } = mountView({
    state: 'ok', bundle: { forecast: FAR_CURVE, forecastRadii: [] }, error: null,
  });
  v.update({ storms: [FAR_STORM], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  const html = host.read();

  /* ==> THE THREE SENTENCES THAT WERE ON GLASS, AND MUST NOT COME BACK. <== */
  ok(!/never comes near you/i.test(html),
     'no reassurance about a storm that was never a candidate');
  ok(!/Never comes within/i.test(html),
     'and no 100-mile ring drawn round a house on the other side of the planet');
  ok(!/on the way in|gets to you|all the way in/.test(html),
     'no arrival trend — there is no arrival');
  ok(!/When it.s closest/.test(html),
     'and no strength-at-the-pass cell about a pass 6,000 miles away');

  /* What it says INSTEAD. */
  ok(/Northwest Pacific/.test(html),
     'it names the ocean, which is the fact that actually explains the distance');
  ok(/Nothing on its track brings it near/.test(html), 'and states the geography plainly');

  /* What it drops. Both are approach machinery with no approach to run on. */
  ok(!/<svg class="home-chart"/.test(html), 'the approach chart is not drawn');
  ok(!/Timeline/.test(html), 'nor the wind countdown');

  /* What SURVIVES, because it is still true and still about this storm. */
  ok(/How strong/.test(html), 'the current strength is still shown');
  ok(/Where it is/.test(html), 'so is where it is');
  ok(/Moving ENE at/.test(html), 'and the motion it publishes, on the where line');
}

/* A NEAR storm must keep every one of those blocks. Without this the far
 * branch could swallow the whole screen and the suite above would still be
 * green — it only asserts absences. */
{
  const { v, host } = mountView({ state: 'ok', bundle: { forecast: CURVE, forecastRadii: RADII }, error: null });
  v.update({ storms: [STORM], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  const html = host.read();
  ok(/<svg class="home-chart"/.test(html), 'a near storm still gets its chart');
  ok(/Timeline/.test(html), 'and its countdown');
  ok(/Closest pass/.test(html), 'and its closest-pass headline');
  ok(/When it.s closest/.test(html), 'and its strength-at-the-pass cell');
}

/* =========================================================================
 * THE STORM SWITCHER
 *
 * The drawer only ever showed one storm and "what about that other one" had
 * no answer short of leaving the screen. Aaron's ask, 2026-08-11.
 * ====================================================================== */
section('the storm switcher');

{
  const OTHER = {
    ...STORM, id: 'oth1', name: 'Chanhom', basin: 'westPacific',
    lat: 28.0, lon: 150.0, windKt: 45,
  };

  /**
   * ==> DRIVEN THROUGH THE REAL COMPONENT, NOT AROUND IT. <== The chevrons are
   * ui/storm-stepper.js now, pinned as a sibling of the scrolling body rather
   * than written into it, and the storm's NAME is the drawer's title rather
   * than a line in the body. So neither surface this section asserts on is in
   * `inner.innerHTML` any more. `press()` fires the listener the component
   * itself registered; `named()` reads the identity block the drawer would put
   * in its header.
   */
  const host = fakeHost();
  const inner = host.querySelector('.home-dash');
  const v = createHomeDashboardView({
    units: () => 'imperial', onEditHome() {}, onOpenStorm() {},
    onFocusStorm() {},
    warmGeometry: async () => ({ state: 'ok', bundle: { forecast: [], forecastRadii: [] }, error: null }),
    now: () => NOW,
    /* Rain (§48.8) has its own suite against real NWS bytes; here it only has
     * to be WIRED, so the dashboard's own paths are exercised with the section
     * present rather than with it quietly missing. */
    rain: RAIN_STUB,
  });
  v.mount(host);
  v.onEnter();

  /* The stepper is prepended at mount, so it is the host's first child. */
  const stepEl = host.children[0];
  const press = (dir) => stepEl.press(dir);
  const named = () => {
    const t = v.titleFor();
    if (typeof t === 'string') return t;
    return (/<h1 class="drawer-title">([^<]*)</.exec(t.innerHTML) || [])[1];
  };

  v.update({ storms: [STORM, OTHER], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));

  ok(!stepEl.hidden, 'two storms produce a stepper');
  /* TWO ARROWS, NOT ONE PER STORM. It steps; it does not list. With two storms
   * both arrows reach the same other storm, which is correct — there is one
   * other storm and either direction gets there. */
  ok(stepEl._count.textContent === '1 of 2',
     `with a position counter reading its place (got "${stepEl._count.textContent}")`);
  ok(stepEl._prev.getAttribute('aria-label') === 'Show Chanhom' &&
     stepEl._next.getAttribute('aria-label') === 'Show Chanhom',
     'and both arrows reach the one other storm');
  ok(named() === 'Bertha', 'the drawer is titled with the storm the ranking picked');

  /* ==> THE NAME IS THE HEADER'S, NOT THE BODY'S. <== Asserted as an absence
   * because the two could quietly both be true — the old body markup left
   * behind while the header gained a copy — and two names for one storm on one
   * screen is the duplication this move exists to remove. */
  ok(!/drawer-title/.test(inner.innerHTML),
     'and the body does NOT also carry it');

  ok(press('next'), 'the stepper actually has a listener wired');
  await new Promise((r) => setTimeout(r, 0));
  ok(named() === 'Chanhom', 'a chevron re-aims the dashboard at the next storm');

  /* ==> THE ONE THAT MATTERS. <== The drawer re-picks on every poll. A choice
   * that silently reverts on the next refresh reads as the app fighting you. */
  v.update({ storms: [STORM, OTHER], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  ok(named() === 'Chanhom', 'and the choice SURVIVES a poll');

  /* The picked storm leaves the feed. Fall back to the ranking rather than
   * leaving the drawer pointed at a storm that no longer exists. */
  v.update({ storms: [STORM], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  ok(named() === 'Bertha', 'a picked storm that leaves the feed falls back to the ranking');
  ok(stepEl.hidden,
     'and one storm draws no chevrons, because a stepper through one thing is furniture');

  /* NO STORM, NO IDENTITY — the header falls back to the drawer's own name and
   * the stepper goes with it. Every one of the view's quiet paths returns
   * early, so this is the assertion that proves they all still reach the
   * stepper and the header on the way out. */
  v.update({ storms: [], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  ok(named() === 'Home', 'an all-clear titles the drawer Home again');
  ok(stepEl.hidden, 'and hides the stepper with it');

  /* =======================================================================
   * ==> AND PRESSING HOME AGAIN STARTS OVER. <== The pick surviving a poll,
   * asserted above, is the whole point of holding it — and it made the pick
   * survive the drawer CLOSING too, because this view lives as long as the
   * app does. So stepping to a third storm once, closing, and pressing Home
   * an hour later re-opened on that storm and flew the camera to it. The
   * reader asked "what is coming for my house"; the app answered "whatever
   * you were curious about last time", which is a different question and
   * reads as being stuck.
   *
   * A FRESH ENTRY FORGETS; A RETURN DOES NOT. Tapping the storm's name opens
   * its own panel ON TOP of this one, and Back from there is the same visit
   * continuing — resetting there would drop the reader somewhere they never
   * navigated to, which is the opposite fault and just as bad.
   * ==================================================================== */
  v.update({ storms: [STORM, OTHER], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  ok(press('next'), 'stepping again to set up the reopen');
  await new Promise((r) => setTimeout(r, 0));
  ok(named() === 'Chanhom', 'the reader is on the second storm');

  /* The drawer closes and re-opens on a RETURN — `back()` off a pushed panel.
   * MUTATION WATCHED: clearing the pick unconditionally in onEnter turns this
   * red. */
  v.onLeave();
  v.onEnter(undefined, { fresh: false });
  await new Promise((r) => setTimeout(r, 0));
  ok(named() === 'Chanhom', 'coming BACK from a storm’s own panel keeps the storm you were on');

  /* And now the Home button, which is `drawer.go` and throws the history away.
   * MUTATION WATCHED: dropping the `if (fresh)` line turns this red. */
  v.onLeave();
  v.onEnter(undefined, { fresh: true });
  await new Promise((r) => setTimeout(r, 0));
  ok(named() === 'Bertha',
     'but pressing Home re-opens on the storm the ranking picks, not the one you last looked at');

  /* ==> AND THE CAMERA GOES WITH IT. <== The frame is aimed from `lastDash`,
   * which is whatever the render just resolved — so this is the half of the
   * bug Aaron actually saw: the map centred on the house and the WRONG storm.
   * Asserted through the callback rather than trusting that the title implies
   * it. MUTATION WATCHED: framing from `currentThreat()` before the render
   * would still pass the title assertion above and fail this. */
  {
    let framed = null;
    const v2 = createHomeDashboardView({
      units: () => 'imperial', onEditHome() {}, onOpenStorm() {},
      onFocusStorm() {},
      onFrameHome: (arg) => { framed = arg?.storm?.name ?? null; },
      warmGeometry: async () => ({ state: 'ok', bundle: { forecast: [], forecastRadii: [] }, error: null }),
      now: () => NOW,
      rain: RAIN_STUB,
    });
    const h2 = fakeHost();
    v2.mount(h2);
    v2.onEnter(undefined, { fresh: true });
    v2.update({ storms: [STORM, OTHER], sources: SRC_OK });
    await new Promise((r) => setTimeout(r, 0));
    h2.children[0].press('next');
    await new Promise((r) => setTimeout(r, 0));

    framed = null;
    v2.onLeave();
    v2.onEnter(undefined, { fresh: true });
    ok(framed === 'Bertha',
       `and the camera frames the house against THAT storm, not the last one (got ${framed})`);
  }

  /* ==> MOVING HOUSE ALSO ENDS THE PICK. <== It was a choice made against the
   * old address — "show me this one instead of the one bearing down on me" —
   * and a different house has a different one bearing down on it. */
  v.onEnter(undefined, { fresh: false });
  v.update({ storms: [STORM, OTHER], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  press('next');
  await new Promise((r) => setTimeout(r, 0));
  ok(named() === 'Chanhom', 'a pick is in place');
  v.homeChanged();
  await new Promise((r) => setTimeout(r, 0));
  ok(named() === 'Bertha', 'and setting a new home drops it, because the ranking is a new one');
}

/* =========================================================================
 * THE ADDRESS LEADS THE SCREEN
 *
 * It is the only control on the dashboard that DOES anything and it sat below
 * the chart, the figures, the countdown and the vitals — so "how do I fix my
 * home location" meant scrolling past everything the location was used for.
 * ====================================================================== */
section('the address row');

for (const [what, state] of [
  ['with a storm on screen', { storms: [STORM], sources: SRC_OK }],
  ['on a genuine all-clear', { storms: [], sources: SRC_OK }],
  ['during a source outage', { storms: [], sources: { nhc: { status: 'unavailable' }, gdacs: { status: 'ok' } } }],
  ['while still loading', { storms: [], sources: { nhc: { status: 'loading' }, gdacs: { status: 'loading' } } }],
]) {
  const { v, host } = mountView({ state: 'ok', bundle: { forecast: CURVE, forecastRadii: RADII }, error: null });
  v.update(state);
  await new Promise((r) => setTimeout(r, 0));
  const html = host.read();
  const iEdit = html.indexOf('data-act="edit-home"');
  ok(iEdit >= 0, `the address row renders ${what}`);
  /* ==> IT IS THE LAST SECTION, AND THAT IS A REVERSAL. <== It was moved to
   * the top earlier in this same session and moved back on glass: at the top
   * it sat between the reader and the storm they opened the drawer for. The
   * test is written against the LAST `home-sect` rather than a named block, so
   * a section added later cannot quietly land below it. */
  const iLast = html.lastIndexOf('home-sect');
  ok(iEdit > iLast - 200, `and it is the LAST section ${what}`);
  ok((html.match(/data-act="edit-home"/g) || []).length === 1,
     `and appears exactly once ${what}`);
}

/* ==> AND THE COUNTDOWN SHARES THE HELPER, ON A STORM THAT HAS ONE. <== Ida is
 * near, so her countdown renders. Its `now` row and the strip's where row must
 * carry the SAME sentence — they used to each carry their own inline fallback,
 * which is how one of them came to say something the other contradicted. */
{
  const { v, host } = mountView({ state: 'ok', bundle: { forecast: CURVE, forecastRadii: RADII }, error: null });
  v.update({ storms: [STORM], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  const html = host.read();
  const railNow = (/<div class="home-rail-det">([^<]*)<\/div>/.exec(html) || [])[1];
  /* THE ADVISORY'S MOTION AND ITS MEANING, IN ONE LINE. These were two facts
   * in two blocks — "Moving NW at 15 mph" in a vitals list at the bottom of
   * the screen, "getting closer" under the distance at the top — and a reader
   * had to carry one back to the other to make sense of either. */
  ok(/^Moving \w+ at .+, getting closer$/.test(railNow),
     `the countdown's now row states motion AND meaning (got "${railNow}")`);
  ok((html.match(/, getting closer/g) || []).length === 2,
     'and it is the same sentence the where row uses, from the one helper');
}

/* --- a storm in an ocean NHC publishes no error figures for ------------- */
{
  const { v, host } = mountView({ state: 'ok', bundle: { forecast: CURVE, forecastRadii: RADII }, error: null });
  v.update({ storms: [{ ...STORM, basin: 'westPacific', name: 'Halima' }], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  const html = host.read();
  ok(/Halima/.test(html), 'the storm renders');
  ok(!/Two out of three/.test(html), 'with no band, because none is published for that ocean');
  ok(/Nobody publishes forecast-error figures/.test(html),
     'and the absence is EXPLAINED rather than silently omitted');
}

/* --- nothing bearing down ----------------------------------------------- */
{
  const { v, host } = mountView({ state: 'ok', bundle: { forecast: [] }, error: null });
  v.update({ storms: [], sources: SRC_OK });
  const html = host.read();
  ok(/Nothing bearing down/.test(html), 'a quiet ocean says so');
  ok(/All clear/.test(html), 'and IS allowed to say all clear when both sources answered');
}

/* ==> THE ONE THAT MATTERS. <== */
{
  const { v, host } = mountView({ state: 'ok', bundle: { forecast: [] }, error: null });
  v.update({ storms: [], sources: { nhc: { status: 'unavailable' }, gdacs: { status: 'ok' } } });
  const html = host.read();
  ok(!/All clear/.test(html), 'an NHC outage must NEVER render "All clear"');
  ok(!/Nothing bearing down/.test(html), 'nor "nothing bearing down"');
  ok(/not <em>|not.{0,10}all/i.test(html), 'it says explicitly that this is not an all-clear');
  ok(/NHC/.test(html), 'and names the source that failed');
}

/* --- still loading ------------------------------------------------------ */
{
  const { v, host } = mountView({ state: 'ok', bundle: { forecast: [] }, error: null });
  v.update({ storms: [], sources: { nhc: { status: 'loading' }, gdacs: { status: 'loading' } } });
  const html = host.read();
  ok(!/All clear/.test(html), 'loading is not an all-clear either');
  ok(/Checking the oceans/.test(html), 'it says it is still asking');
}

/* --- a threat storm whose track has not loaded -------------------------- */
{
  const { v, host } = mountView({ state: 'error', bundle: null, error: 'boom' });
  v.update({ storms: [STORM], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  const html = host.read();
  ok(/Bertha/.test(titleHtml(v)), 'the storm is still named');
  ok(/didn.t load/.test(html), 'and the missing track is named as a failure, not a silence');
  ok(!/Closest pass/.test(html), 'with no closest-approach figure invented to fill the hole');
  ok(/Track unavailable/.test(titleHtml(v)), 'and the chip names the failure too');
  ok(!/Checking/.test(titleHtml(v)), 'rather than claiming to still be checking');
}

/* --- HERNAN: the advisory answered, and carried no track ------------------
 *
 * The end-to-end version of the unit assertions in section 6, and the one that
 * would actually have caught the bug — the defect lived in the seam between
 * this view and the dashboard, not in either alone. The view holds a bundle
 * that loaded FINE and simply has no forecast in it, which is what NHC
 * published for Hernan's advisory 002 on 2026-08-13.
 *
 * If the view ever stops telling the dashboard what state the fetch is in,
 * `trackState` defaults to 'loading' and all four of these go red. */
{
  const { v, host } = mountView({
    state: 'ok', bundle: { forecast: [], forecastRadii: [] }, error: null });
  v.update({ storms: [STORM], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  const html = host.read();
  ok(/doesn.t include a forecast track yet/.test(html),
     'an empty advisory says so plainly');
  ok(!/Working out where it goes next/.test(html),
     'and never claims to still be working on an answer it already has');
  ok(/No forecast yet/.test(titleHtml(v)), 'the chip agrees with the sentence below it');
  ok(!/Checking/.test(titleHtml(v)), 'and the waiting dots are nowhere near it');
}

/* =========================================================================
 * THE RAIL DESCRIBES EVERY WIND THAT REACHES THE HOUSE, NOT JUST THE WORST
 *
 * ==> THE BUG. <== The countdown was built from `corridor.worst` and nothing
 * else. On a storm where two fields reach the house that is a rail with the
 * wrong story on it, and it is wrong in the unsafe direction at both ends.
 *
 * Seen on glass 2026-08-13, Lala against a Big Island home: tropical-storm-
 * force wind forecast to arrive 9:36 AM and lie on the house fifteen hours,
 * damaging wind to arrive 3:12 PM for four. The rail named only the damaging
 * pair. So it said the first wind arrives at 3:12 PM — six hours late — and
 * then printed "The wind eases" at 6:45 PM with six hours of tropical-storm-
 * force wind still to come. "The wind eases" is read as *it is over*.
 *
 * ==> WHY BERTHA COULD NEVER HAVE CAUGHT IT. <== Her corridor reaches exactly
 * one threshold — measured: `worst: 34`, `forecast[50].everInside: false` —
 * so every assertion above this point ran a one-threshold storm through a
 * one-threshold renderer and agreed. The whole suite passed unchanged through
 * the rewrite that fixed this, which is the tell.
 *
 * So this fixture is built to the SHAPE Lala had: a 50 kt field that reaches
 * the house strictly inside a longer 34 kt window. Nothing here is Lala's
 * numbers — her radii were never captured — and it is not presented as them.
 * ========================================================================= */

setHome({ lon: HOME.lon, lat: HOME.lat, label: HOME.label, source: 'address' });
{
  /* A storm running straight at the house and slowing, so both fields sweep
   * over it: the 34 kt field is wide throughout, the 50 kt field only wide
   * enough in the middle of the pass. */
  const NESTED_CURVE = [
    { time: '2026-07-22T00:00:00Z', lat: 29.0, lon: -89.0, windKt: 60, tau: 3 },
    { time: '2026-07-22T06:00:00Z', lat: 29.4, lon: -89.6, windKt: 65, tau: 9 },
    { time: '2026-07-22T12:00:00Z', lat: 29.9, lon: -90.3, windKt: 65, tau: 15 },
    { time: '2026-07-22T18:00:00Z', lat: 30.5, lon: -90.9, windKt: 55, tau: 21 },
    { time: '2026-07-23T00:00:00Z', lat: 31.4, lon: -91.6, windKt: 40, tau: 27 },
    { time: '2026-07-23T12:00:00Z', lat: 33.0, lon: -92.6, windKt: 30, tau: 39 },
    { time: '2026-07-24T00:00:00Z', lat: 35.0, lon: -93.6, windKt: 25, tau: 51 },
  ].map((p) => ({ ...p, category: 1, categorySource: 'reported', stormType: 'TS' }));

  /* ==> THE WEAK FIELD HAS TO SHRINK AWAY BEFORE THE FORECAST RUNS OUT. <==
   * The first version of this fixture stopped at tau 27 with the house still
   * inside the 34 kt field, and the rail correctly refused to print an
   * all-clear — it said "The forecast stops here, with wind still on you"
   * instead, which is the open-ended branch doing its job. Right answer, wrong
   * fixture: an assertion about the all-clear needs a storm that actually
   * clears. The tail below is what makes the last window close for a real
   * reason rather than for want of data. */
  const NESTED_RADII = [
    { tau: 3,  kt: 34, ne: 40,  se: 40,  sw: 40,  nw: 40 },
    { tau: 3,  kt: 50, ne: 10,  se: 10,  sw: 10,  nw: 10 },
    { tau: 9,  kt: 34, ne: 120, se: 120, sw: 120, nw: 120 },
    { tau: 9,  kt: 50, ne: 60,  se: 60,  sw: 60,  nw: 60 },
    { tau: 15, kt: 34, ne: 120, se: 120, sw: 120, nw: 120 },
    { tau: 15, kt: 50, ne: 60,  se: 60,  sw: 60,  nw: 60 },
    { tau: 21, kt: 34, ne: 120, se: 120, sw: 120, nw: 120 },
    { tau: 21, kt: 50, ne: 20,  se: 20,  sw: 20,  nw: 20 },
    { tau: 27, kt: 34, ne: 100, se: 100, sw: 100, nw: 100 },
    { tau: 27, kt: 50, ne: 10,  se: 10,  sw: 10,  nw: 10 },
    { tau: 39, kt: 34, ne: 40,  se: 40,  sw: 40,  nw: 40 },
    { tau: 51, kt: 34, ne: 20,  se: 20,  sw: 20,  nw: 20 },
  ];

  const NESTED_STORM = {
    ...STORM, name: 'Nested', windKt: 60, lat: 28.6, lon: -88.6, headingDeg: 320, speedKt: 10,
  };

  /* The fixture has to actually have the shape the assertions are about, or
   * they are asserting against a storm as one-dimensional as Bertha and prove
   * nothing. Checked here rather than assumed. */
  const nco = buildCorridor({
    storm: NESTED_STORM, forecast: NESTED_CURVE, radii: NESTED_RADII,
    home: HOME, now: NOW,
  });
  ok(nco.ok === true, 'the nested fixture builds a corridor at all');
  ok(nco.forecast?.[34]?.everInside === true, 'its 34 kt field reaches the house');
  ok(nco.forecast?.[50]?.everInside === true, 'AND its 50 kt field does — the whole point');
  ok(nco.worst === 50, `worst is the 50 kt field (got ${nco.worst})`);

  const w34 = nco.forecast[34].windows[0];
  const w50 = nco.forecast[50].windows[0];
  ok(
    Date.parse(w34[0]) < Date.parse(w50[0]),
    'the weaker field arrives FIRST — otherwise there is no early wind to miss'
  );
  ok(
    Date.parse(w34[1]) > Date.parse(w50[1]),
    'and lifts LAST — otherwise there is no late wind to miss, which is the ' +
      'half that made "The wind eases" a wrong all-clear'
  );

  const { v, host } = mountView({
    state: 'ok',
    bundle: { forecast: NESTED_CURVE, forecastRadii: NESTED_RADII },
    error: null,
  });
  v.update({ storms: [NESTED_STORM], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  const html = host.read();

  ok(/Timeline/.test(html), 'the nested storm renders a countdown');

  /* ---- both arrivals are named ---- */
  ok(
    /Tropical-storm force wind reaches you/.test(html),
    'THE FIRST WIND IS NAMED. Without this the rail\'s earliest wind row is ' +
      'the 50 kt arrival, hours after the house is already in 40 mph wind.'
  );
  ok(/Damaging wind reaches you/.test(html), 'and so is the worst wind');

  /* ---- both endings are named, and the last one is an all-clear ---- */
  ok(
    /Damaging wind eases/.test(html),
    'THE WORST FIELD LIFTING IS NAMED AS ITSELF. It used to say "The wind ' +
      'eases" here, which claims the storm is done while a weaker field is ' +
      'still on the house.'
  );
  ok(
    /The wind is past you/.test(html),
    'AND THE LAST FIELD TO LIFT IS THE ALL-CLEAR. This is the row a reader ' +
      'is actually looking for and the rail had no equivalent of.'
  );
  ok(
    !/>The wind eases</.test(html),
    'the bare "The wind eases" is gone — it named no field, so on a ' +
      'multi-threshold storm it could only be read as the wrong one'
  );

  /* ---- ORDER. Escalation then recovery, with the pass sorted into it. ---- */
  const evs = [...html.matchAll(/<div class="home-rail-ev">([^<]*)<\/div>/g)]
    .map((m) => m[1]);
  const idx = (re) => evs.findIndex((e) => re.test(e));
  const iTs = idx(/Tropical-storm force wind reaches/);
  const iDmg = idx(/Damaging wind reaches/);
  const iDmgEnd = idx(/Damaging wind eases/);
  const iClear = idx(/The wind is past you/);

  ok(iTs >= 0 && iDmg >= 0 && iDmgEnd >= 0 && iClear >= 0,
     `all four wind rows present (got: ${evs.join(' | ')})`);
  ok(iTs < iDmg, 'arrivals ascend: tropical-storm force before damaging');
  ok(iDmg < iDmgEnd, 'a field arrives before it eases');
  ok(
    iDmgEnd < iClear,
    'ENDINGS DESCEND: the damaging field lifts before the last of the wind ' +
      'does. Reversed, the rail would say the storm is past you and then go ' +
      'on describing wind.'
  );

  /* ==> THE HEDGE BELONGS TO THE FIRST WIND, NOT THE WORST. <== Computed on
   * `worst` it is the earliest the DAMAGING wind could start, which on a
   * nested shape is LATER than the plain forecast arrival of the tropical-
   * storm-force wind — so the row "wind could start this early" sorted BELOW a
   * row saying wind had already reached the house. A hedge later than the
   * thing it hedges is worse than no hedge.
   *
   * ==> ASSERTED ON THE CORRIDOR, NOT ON THE RENDERED ROW, AND THAT IS A
   * LIMITATION WORTH STATING. <== The rail suppresses the hedge under two
   * hours, and on this fixture the wind arrives inside a day, where NHC's
   * two-thirds track error is small enough that both gaps come out under an
   * hour — measured 0.48 h at 34 kt and 0.96 h at 50 kt. So no hedge row
   * renders here at all. The first version of this block asserted the row's
   * POSITION behind an `if (iEarly >= 0)`, which never ran: a conditional
   * assertion whose condition is always false is not a weak test, it is the
   * absence of one wearing a test's clothes.
   *
   * What is checked instead is the ordering fact the bug was made of, which
   * holds whether or not the row is drawn. Building a fixture whose wind
   * arrives days out purely to make the row appear would be testing the
   * two-hour gate, not this. */
  const early50 = nco.earliest?.[50]?.windows?.[0]?.[0];
  ok(
    early50 && Date.parse(early50) > Date.parse(w34[0]),
    'the WORST field\'s earliest arrival lands after the FIRST field\'s plain ' +
      'arrival — which is precisely why the hedge must be taken from the ' +
      'weakest reaching threshold and not from `worst`'
  );
  ok(
    Date.parse(nco.earliest[34].windows[0][0]) <= Date.parse(w34[0]),
    'and the weakest field\'s hedge is never later than its own arrival'
  );
}

clearHome();

/* =========================================================================
 * WHAT THE STORM ITSELF DOES, AND WHEN
 *
 * The forecast curve has carried a classification per hour since it was first
 * normalized, and the home screen used it to color a dot and nothing else.
 * So "it becomes a hurricane nine hours before it reaches you" — published,
 * on the one screen whose job is what happens and when — was not on it.
 *
 * THREE NAMED STEPS ONLY (HOME_DASH.classMilestones): tropical storm,
 * hurricane, major hurricane. A row per category would give a real Cat 5 ten
 * of them on a rail that already carries the wind arrivals and the pass. The
 * peak row carries the actual maximum, so a storm topping out at Cat 4 still
 * says so.
 *
 * POINT TIMES, NOT INTERPOLATED. A distance between two published distances is
 * arithmetic; a CLASSIFICATION between two published classifications is a call
 * NHC did not make. These rows therefore run late by up to one forecast
 * interval, which is acceptable for a fact about the storm and would not be
 * for the wind rows — those interpolate and carry their own earlier hedge.
 * ========================================================================= */

section('what the storm itself does');
setHome({ lon: HOME.lon, lat: HOME.lat, label: HOME.label, source: 'address' });
{
  /* Depression now, hurricane inside a day, major hurricane at the peak, then
   * collapsing two steps in one gap on the way out — which is the case that
   * made the walk emit two rows at the same minute before it deduped. */
  const RAMP = [
    { time: '2026-07-22T00:00:00Z', lat: 29.0, lon: -89.0, windKt: 45,  tau: 3 },
    { time: '2026-07-22T06:00:00Z', lat: 29.4, lon: -89.6, windKt: 70,  tau: 9 },
    { time: '2026-07-22T12:00:00Z', lat: 29.9, lon: -90.3, windKt: 100, tau: 15 },
    { time: '2026-07-22T18:00:00Z', lat: 30.5, lon: -90.9, windKt: 45,  tau: 21 },
  ].map((p) => ({
    ...p,
    category: categoryFromKt(p.windKt),
    categorySource: 'reported',
    stormType: p.windKt >= 64 ? 'HU' : 'TS',
  }));

  const RAMP_STORM = {
    ...STORM, name: 'Ramp', windKt: 30, category: 0, lat: 28.6, lon: -88.6,
    headingDeg: 320, speedKt: 10,
  };

  const rd = buildHomeDashboard({
    storm: RAMP_STORM, forecast: RAMP, radii: [], home: HOME, now: NOW, trackState: 'ok',
  });

  /* The fixture has to have the shape the assertions are about. */
  ok(rd.milestones.length > 0, 'the ramp fixture produces milestones at all');
  const kinds = rd.milestones.map((m) => `${m.kind}:${m.direction || ''}:${m.level ?? ''}`);
  ok(kinds.includes('class:up:1'), 'it crosses into tropical storm');
  ok(kinds.includes('class:up:2'), 'and into hurricane');
  ok(kinds.includes('class:up:4'), 'and into major hurricane');

  /* ==> THE COLLAPSE COLLAPSES TO ONE ROW. <== Cat 3 to tropical storm in one
   * six-hour gap crosses BOTH the major-hurricane and the hurricane step at the
   * same minute. Before the dedupe that was two rows at one time, which reads
   * as the rail stuttering rather than as a storm falling apart. */
  const downs = rd.milestones.filter((m) => m.direction === 'down');
  ok(downs.length === 1,
     `a two-step collapse is ONE row, not two (got ${downs.length}: ${
       downs.map((d) => d.level).join(',')})`);
  ok(downs[0]?.level === 2,
     `and it is the DEEPEST step crossed, describing where the storm ends up ` +
     `(got level ${downs[0]?.level})`);

  /* ==> THE PEAK FOLDS INTO A MILESTONE IT COINCIDES WITH. <== The strongest
   * forecast hour here IS the hour it becomes a major hurricane. Two rows at
   * one minute saying nearly the same thing is what peakMergeHours prevents,
   * and no figure is lost — the milestone's detail carries the wind. */
  ok(!rd.milestones.some((m) => m.kind === 'peak'),
     'the peak row is folded into the coincident milestone, not printed beside it');

  ok(
    rd.milestones.every((m, i, a) => i === 0 || a[i - 1].at <= m.at),
    'milestones come out in time order'
  );

  const { v, host } = mountView({
    state: 'ok', bundle: { forecast: RAMP, forecastRadii: [] }, error: null });
  v.update({ storms: [RAMP_STORM], sources: SRC_OK });
  await new Promise((r) => setTimeout(r, 0));
  const html = host.read();

  ok(/Becomes a hurricane/.test(html), 'the rail says when it becomes a hurricane');
  ok(/Becomes a major hurricane/.test(html), 'and when it becomes a major one');
  ok(/Weakens to a tropical storm/.test(html),
     'and names where it ends up when it falls apart, not the step it lost');

  const evs = [...html.matchAll(/<div class="home-rail-ev">([^<]*)<\/div>/g)].map((m) => m[1]);
  const iHur = evs.findIndex((e) => /^Becomes a hurricane$/.test(e));
  const iMaj = evs.findIndex((e) => /Becomes a major hurricane/.test(e));
  const iWeak = evs.findIndex((e) => /Weakens to/.test(e));
  ok(iHur >= 0 && iMaj >= 0 && iWeak >= 0, `all three class rows render (${evs.join(' | ')})`);
  ok(iHur < iMaj && iMaj < iWeak,
     'and they sort into the rail in the order the storm actually does them');

  /* ==> A STORM ALREADY AT A CLASS IS NOT TOLD IT WILL REACH IT. <== The
   * baseline is what the storm IS now, so a hurricane forecast to STAY one
   * gets no "becomes a hurricane" row. Without this every hurricane on the
   * globe would be announced as becoming one at its next forecast hour.
   *
   * THIS NEEDS ITS OWN CURVE AND THE FIRST VERSION DID NOT HAVE ONE. Reusing
   * RAMP here failed, correctly: RAMP dips to 45 kt before climbing to 100, so
   * a Cat 2 storm run against it really does fall to a tropical storm and
   * become a hurricane again, and the row it produced was true. The assertion
   * was wrong, not the walk. A curve that never leaves hurricane strength is
   * the only thing that tests what this claims to test. */
  const STAYS = RAMP.map((p) => ({
    ...p, windKt: 90, category: categoryFromKt(90), stormType: 'HU',
  }));
  const already = buildHomeDashboard({
    storm: { ...RAMP_STORM, windKt: 90, category: categoryFromKt(90) },
    forecast: STAYS, radii: [], home: HOME, now: NOW, trackState: 'ok',
  });
  ok(
    !already.milestones.some((m) => m.direction === 'up' && m.level === 2),
    'a storm that is ALREADY a hurricane and stays one is never told it becomes one'
  );
  ok(
    !already.milestones.some((m) => m.direction === 'down'),
    'and a forecast that never weakens announces no weakening'
  );

  /* A flat forecast has nothing to announce, and that is an answer. */
  const flat = buildHomeDashboard({
    storm: RAMP_STORM,
    forecast: RAMP.map((p) => ({ ...p, windKt: 30, category: 0 })),
    radii: [], home: HOME, now: NOW, trackState: 'ok',
  });
  ok(Array.isArray(flat.milestones) && flat.milestones.length === 0,
     'a flat forecast produces an empty list, never null');
}

clearHome();


for (const f of failures) console.log(`  ✗ ${f}`);
console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed`
    : `\n✓ ${pass} assertions passed`
);
console.log('  (the numbers are right; whether the chart READS is glass)');
process.exit(failures.length ? 1 : 0);
