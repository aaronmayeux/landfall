#!/usr/bin/env node
/**
 * test-forecast-now.mjs — re-anchoring "now" onto the storm's real position
 * (lib/forecast-now.js).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-forecast-now.mjs`, same as every
 * other suite here (§12 — this project has no toolchain by design).
 *
 * ==> THE HEADLINE FIXTURE IS REAL ARCHIVED BYTES AND MUST STAY THAT WAY. <==
 * `samples/lala-cp012026/` holds the 2026-08-21T23:30Z archive run: forecast
 * geometry from advisory 36A (published 12:02Z, tau-0 valid 09:00Z at 26.9°N)
 * against past geometry published 21:04Z whose newest fix is 18:00Z at 28.1°N.
 * The storm feed put Lala at 28.6°N at 21:00Z.
 *
 * An invented fixture would have had the forecast starting where the record
 * ends, which is the one arrangement in which none of this reproduces. The
 * whole bug is that those two numbers disagree.
 *
 * THE CLOCK IS PINNED. `NOW` below is the moment Aaron reported the fault on
 * glass. Reading the real wall clock would make this suite pass today and fail
 * forever after, since the fixture's forecast hours recede into the past.
 *
 * WHAT THIS CANNOT PROVE: that the ring reads as "the storm is here". Whether
 * a white ring on a moved dot says the right thing to a person is a question
 * for a phone.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { reanchorNow, __internals } = await import('../lib/forecast-now.js');
const { FORECAST_NOW } = await import('../config/constants.js');
const { parseNhcValidtime } = await import('../lib/time.js');
const { smoothTracks } = await import('../lib/trackline.js');
const { trackPointReading } = await import('../lib/track-point.js');
const { CATEGORY_COLOR, PREGENESIS_COLOR } = await import('../config/tokens.js');
const {
  num, dLon, samePoint, newestPastPoint, readingFrom, readingFromStorm,
} = __internals;

/* The wall clock Aaron was looking at. Pinned — see the header. */
const NOW = Date.parse('2026-08-22T00:39:00Z');

/* The storm feed's own record for Lala in that same archive run
 * (latest/nhc-currentstorms.json, advisory 038). */
const LALA = { lon: -170.4, lat: 28.6, observedAt: '2026-08-21T21:00:00.000Z' };

const S = 'samples/lala-cp012026';
const read = (f) => JSON.parse(readFileSync(`${S}/${f}`, 'utf8'));

/* `_time` is stamped during parsing (data/nhc-mapserver.js
 * `annotateForecastTimes`), not published on the wire, so the fixture gets it
 * through the SAME parser the app uses. Stamping it by hand here would let a
 * change in that parser slip past this suite. */
function forecastPoints() {
  const fc = read('forecast-points-038-stale.geojson');
  for (const f of fc.features) {
    f.properties._time = parseNhcValidtime(f.properties.validtime, f.properties.advdate);
  }
  return fc;
}

const slot = (fc) => ({ status: 'ok', fc, error: null });
const bundle = (over = {}) => ({
  layers: {
    pastTrack: slot(read('past-track-038-doubled.geojson')),
    pastPoints: slot(read('past-points-038.geojson')),
    forecastTrack: slot(read('forecast-track-038-stale.geojson')),
    forecastPoints: slot(forecastPoints()),
    ...over,
  },
});

const ptsOf = (b) => b.layers.forecastPoints.fc.features;
const lineOf = (b) => b.layers.forecastTrack.fc.features
  .find((f) => f.geometry.type === 'LineString').geometry.coordinates;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/* Quiet the module's own console during the negative cases — those warnings
 * are the point of the assertion, not noise to read. */
function muted(fn) {
  const w = console.warn;
  const seen = [];
  console.warn = (m) => seen.push(String(m));
  try { return { out: fn(), seen }; } finally { console.warn = w; }
}

/* ---------------------------------------------------------------------------
 * THE FIXTURE ITSELF — assert the disagreement is still in the bytes
 * ------------------------------------------------------------------------- */
section('the fixture still carries the fault');
{
  const fp = forecastPoints();
  const tau0 = fp.features[0];
  const tau12 = fp.features[1];
  ok(near(tau0.geometry.coordinates[1], 26.9, 1e-6),
    `tau-0 should sit at 26.9N, got ${tau0.geometry.coordinates[1]}`);
  ok(near(tau12.geometry.coordinates[1], 28.1, 1e-6),
    `tau-12 should sit at 28.1N, got ${tau12.geometry.coordinates[1]}`);
  ok(tau0.properties._time < NOW && tau12.properties._time < NOW,
    'both leading forecast hours should already have passed at the pinned clock');
  ok(fp.features[2].properties._time > NOW,
    'tau-24 should still be in the future at the pinned clock — if this fails the '
    + 'fixture has aged out and the suite is no longer testing a partial expiry');

  const newest = newestPastPoint(bundle());
  ok(near(newest.geometry.coordinates[1], 28.1, 1e-6),
    `newest past fix should be 28.1N, got ${newest.geometry.coordinates[1]}`);
  ok(Number(newest.properties.dtg) === 2026082118,
    `newest past fix should be the 18Z one, got dtg ${newest.properties.dtg}`);

  /* ==> THE FACT THE WHOLE DIAGNOSIS TURNS ON. <== tau-12 and the newest
   * record fix name the same latitude at the same hour. The forecast was not
   * wrong, it was overtaken — so trimming the RECORD to fit it would have been
   * deleting a verified position to tidy a line. */
  ok(near(tau12.geometry.coordinates[1], newest.geometry.coordinates[1], 1e-6),
    'tau-12 and the newest past fix should agree on latitude — that agreement is '
    + 'the evidence the forecast verified rather than went wrong');
  ok(tau12.properties._time === Date.parse('2026-08-21T18:00:00.000Z'),
    'tau-12 should be valid at 18Z, the same hour as the newest record fix');
}

/* ---------------------------------------------------------------------------
 * THE RE-ANCHOR
 * ------------------------------------------------------------------------- */
section('expired forecast hours are dropped and now moves to the storm');
{
  const out = reanchorNow(bundle(), LALA, NOW, 'Lala');
  const pts = ptsOf(out);

  ok(pts.length === 8, `9 points minus 2 expired plus 1 now = 8, got ${pts.length}`);
  ok(pts[0].properties.tau === 0, `the new head should be tau 0, got ${pts[0].properties.tau}`);
  ok(pts[0].properties._now === true, 'the new head should be stamped _now');
  ok(samePoint(pts[0].geometry.coordinates, [LALA.lon, LALA.lat]),
    `the new head should sit on the feed position, got ${pts[0].geometry.coordinates}`);
  ok(pts[0].properties._time === Date.parse(LALA.observedAt),
    'the new head should carry the feed\'s observation time, not the analysis hour');
  ok(pts[1].properties.tau === 24,
    `the next surviving hour should be tau 24, got ${pts[1].properties.tau}`);
  /* The new head is an OBSERVATION and is older than the grace window by
   * design — it is where the storm was measured, not an hour anyone forecast.
   * Every FORECAST hour that survives must still be live. */
  ok(!pts.some((p) => !p.properties._now && p.properties._time < NOW - FORECAST_NOW.expiryGraceMs),
    'no forecast point older than the grace window should survive');

  /* Identity fields must ride through or the dots stop grouping, stop being tap
   * targets and lose their label placement. */
  ok(pts[0].properties.basin === 'CP' && pts[0].properties.stormnum === 1,
    'the new head should keep the basin/stormnum identity of the hour it replaces');

  const l = lineOf(out);
  ok(samePoint(l[0], [LALA.lon, LALA.lat]),
    `the forecast line should start on the feed position, got ${l[0]}`);
  ok(l.length === 8, `the line should have one vertex per surviving point, got ${l.length}`);
  ok(near(l[1][1], 29.8, 1e-6),
    `the line's second vertex should be tau-24 at 29.8N, got ${l[1][1]}`);
}

section('with no classification on the feed, the ring falls back to the record');
{
  /* LALA carries no `raw.classification` — the fixture predates the field
   * being read here — so this is the fallback path, and it must still behave
   * exactly as it did before the storm feed was given precedence. */
  const out = reanchorNow(bundle(), LALA, NOW, 'Lala');
  const p = ptsOf(out)[0].properties;
  /* lib/track-point.js reads `ssnum` before `ss`, so writing the record's `ss`
   * under its own name would leave the STALE forecast's ssnum winning. */
  ok(p.ssnum === 1, `ssnum should be the record's reported 1, got ${p.ssnum}`);
  ok(p.stormtype === 'HU', `stormtype should come from the record, got ${p.stormtype}`);
  ok(p.maxwind === 80, `maxwind should be the record's 80 kt, got ${p.maxwind}`);
  ok(p.tcdvlp === null,
    'the stale advisory\'s words for its analysis hour must not describe now');
  ok(p.advdate === '200 AM HST Fri Aug 21 2026',
    'the advisory stamp itself rides through untouched — the UI displays the '
    + 'geometry\'s own identity (§4) and this dot is still 36A geometry');
}

/* ---------------------------------------------------------------------------
 * THE STORM FEED WINS — Five, 2026-08-31
 *
 * The bug: the ring took its classification from the newest past fix, which
 * still said `LO` six hours after the feed had graded the system `TD`. Teal
 * dot, no letters, directly under a panel reading "Tropical Depression".
 *
 * FIVE below is the archived storm feed entry for al052026 verbatim, and
 * FIVE_RECORD is the newest fix from that same run's pastPoints. If the record
 * ever wins again, the first assertion here goes teal.
 * ------------------------------------------------------------------------- */
section('the ring is classified by the same feed that placed it');
{
  const FIVE = {
    lon: -91, lat: 28, observedAt: '2026-08-31T18:00:00.000Z',
    windKt: 30, category: 0, nature: 'tropical',
    raw: { classification: 'TD' },
  };
  const r = readingFromStorm(FIVE);
  ok(r.stormtype === 'TD', `stormtype should be the feed's TD, got ${r.stormtype}`);
  ok(r.maxwind === 30, `maxwind should be the feed's 30 kt, got ${r.maxwind}`);
  ok(r.tcdvlp === null, 'the stale advisory\'s words must not survive');

  const read = trackPointReading(r);
  ok(read.color === CATEGORY_COLOR.TD,
    `a TD on the feed must draw TD blue, got ${read.color}`);
  ok(read.code === 'TD',
    `a TD on the feed must carry its letters, got "${read.code}"`);
  ok(read.color !== PREGENESIS_COLOR,
    'the ungraded hue is the exact bug this section exists to catch');

  /* ==> THE MUTATION. <== The record's own words for that same moment, run
   * through the same reader. If this did NOT come out teal and letterless the
   * fixture would no longer reproduce the fault and the section above would be
   * proving nothing. */
  const FIVE_RECORD = { stormtype: 'LO', ss: 0, intensity: 30 };
  const stale = trackPointReading(FIVE_RECORD);
  ok(stale.color === PREGENESIS_COLOR && stale.code === '',
    'the record\'s LO must still read as ungraded and letterless — if it does '
    + 'not, this suite has stopped testing the bug it was written for');

  /* ssnum is written even at 0. The template it lands on is a stale forecast
   * hour carrying its own, and a key we decline to write is one that value
   * keeps — which is how a depression would inherit a hurricane's number. */
  ok(r.ssnum === 0, `ssnum must be written, not omitted, got ${r.ssnum}`);
  const HURRICANE = { ...FIVE, windKt: 120, category: 5, raw: { classification: 'HU' } };
  ok(readingFromStorm(HURRICANE).ssnum === 4,
    'category 5 is Cat 4, and NHC\'s ssnum is the Saffir-Simpson number itself');
  ok(trackPointReading(readingFromStorm(HURRICANE)).code === '4',
    'a Cat 4 on the feed must draw its own number in the dot');

  /* A source that states no classification hands the record back its job. */
  ok(readingFromStorm({ ...FIVE, raw: {} }) === null,
    'no classification on the feed → fall through to the record');
  ok(readingFromStorm(null) === null, 'no storm at all → fall through');

  /* ==> AND THE WIRING, WHICH IS THE PART THAT WAS ACTUALLY BROKEN. <==
   * Everything above this proves `readingFromStorm` computes the right answer.
   * None of it proves `reanchorNow` ASKS IT — the first draft of this section
   * passed in full with the call site still reading the record, which is the
   * §12 failure of a test agreeing with the bug. So: the Lala bundle, whose
   * record says HU / ss 1 / 80 kt, handed a storm the feed has graded TD. The
   * feed must win every field. */
  const LALA_AS_TD = {
    ...LALA, windKt: 30, category: 0, nature: 'tropical',
    raw: { classification: 'TD' },
  };
  const wired = ptsOf(reanchorNow(bundle(), LALA_AS_TD, NOW, 'Lala'))[0].properties;
  ok(wired.stormtype === 'TD',
    `the feed's TD must beat the record's HU at the call site, got ${wired.stormtype}`);
  ok(wired.ssnum === 0,
    `the record's ss of 1 must not survive a depression, got ${wired.ssnum}`);
  ok(wired.maxwind === 30,
    `the feed's 30 kt must beat the record's 80, got ${wired.maxwind}`);
  ok(trackPointReading(wired).code === 'TD',
    `the wired ring must carry its letters, got "${trackPointReading(wired).code}"`);
}

/* ---------------------------------------------------------------------------
 * THE POINT OF ALL OF IT — what the track does afterwards
 * ------------------------------------------------------------------------- */
section('the record no longer doubles back to reach the ring');
{
  const peakOvershoot = (b) => {
    const c = smoothTracks(b, 'Lala', null).layers.pastTrack.fc.features[0].geometry.coordinates;
    const lats = c.map((p) => p[1]);
    return Math.max(...lats) - c[c.length - 1][1];
  };

  /* BEFORE, from the same bytes: the smoothed record climbs to its own newest
   * fix and comes back down to the ring. Asserted so this suite fails if the
   * fixture is ever swapped for one that does not reproduce. */
  const before = muted(() => peakOvershoot(bundle()));
  ok(before.out > 1.0,
    `the raw bytes should still overshoot by more than a degree, got ${before.out.toFixed(3)}`);

  const after = muted(() => peakOvershoot(reanchorNow(bundle(), LALA, NOW, 'Lala')));
  ok(after.out < 1e-6,
    `after re-anchoring the record must not double back at all, got ${after.out.toFixed(6)}`);

  /* The seam warning in lib/trackline.js says the record has probably overtaken
   * a stale forecast. Once it has not, the line must stop firing — a warning
   * that cries wolf on every storm is worse than none. */
  ok(!after.seen.some((m) => /overtaken a stale forecast/.test(m)),
    'the stale-forecast seam warning should no longer fire after re-anchoring');
  ok(before.seen.some((m) => /overtaken a stale forecast/.test(m)),
    'the seam warning SHOULD fire on the raw bytes — if not, the fixture no '
    + 'longer reproduces the condition this module exists for');

  /* A forecast line that steps backwards is the smaller version of the same
   * bug, and it is what dropping only tau-0 would have left behind. */
  const l = lineOf(reanchorNow(bundle(), LALA, NOW, 'Lala'));
  let back = 0;
  for (let i = 1; i < l.length; i++) if (l[i][1] < l[i - 1][1] - 1e-9) back++;
  ok(back === 0, `the forecast line should never step south here, got ${back} vertices that do`);
}

/* ---------------------------------------------------------------------------
 * EVERY GUARD BAILS WHOLE
 * ------------------------------------------------------------------------- */
section('every guard returns the bundle untouched rather than half-applying');
{
  const b = bundle();
  ok(reanchorNow(b, LALA, Date.parse('2026-08-21T09:30:00Z'), 'Lala') === b,
    'a clock before the first hour expires should return the SAME object');

  /* ==> 0,0 IS A REAL PLACE. <== `Number(null)` is 0, so a plain isFinite test
   * would have planted the ring in the Gulf of Guinea for any storm whose feed
   * position had not landed yet. Each falsy-but-not-a-number case, separately. */
  for (const bad of [null, undefined, '', 'NaN', {}]) {
    ok(reanchorNow(bundle(), { lon: bad, lat: 28.6 }, NOW, 'Lala').layers.forecastPoints.fc
      .features.length === 9, `no feed longitude (${JSON.stringify(bad)}) → nothing changes`);
    ok(reanchorNow(bundle(), { lon: -170.4, lat: bad }, NOW, 'Lala').layers.forecastPoints.fc
      .features.length === 9, `no feed latitude (${JSON.stringify(bad)}) → nothing changes`);
  }
  ok(num(null) === null && num('') === null && num(0) === 0,
    'num must keep a genuine zero and reject an absent value');

  /* A line from a different advisory than the points. One nudged vertex is
   * enough: the head no longer IS the expired point, so the trim cannot prove
   * what it is dropping. */
  const mismatched = bundle();
  const ml = mismatched.layers.forecastTrack.fc.features[0].geometry.coordinates;
  ml[0] = [ml[0][0] + 0.5, ml[0][1]];
  const m = muted(() => reanchorNow(mismatched, LALA, NOW, 'Lala'));
  ok(m.out === mismatched, 'a line that disagrees with the points must abandon the whole re-anchor');
  ok(m.seen.some((s) => /does not begin with the hours/.test(s)),
    'and it must say so out loud rather than silently doing nothing');

  /* An entirely expired forecast belongs to lib/silence.js, not here. */
  const late = muted(() => reanchorNow(bundle(), LALA, Date.parse('2026-09-01T00:00:00Z'), 'Lala'));
  ok(late.out.layers.forecastPoints.fc.features.length === 9,
    'a wholly expired forecast is left as published');
  ok(late.seen.some((s) => /every published forecast hour has already passed/.test(s)),
    'and it must say so — a silently blanked forecast is the §5 failure');

  /* A missing time stops the walk rather than guessing the hour is live. */
  const untimed = bundle();
  untimed.layers.forecastPoints.fc.features[0].properties._time = null;
  ok(reanchorNow(untimed, LALA, NOW, 'Lala') === untimed,
    'a forecast point with no readable time must stop the walk, not be assumed live');

  const noFc = bundle({ forecastPoints: { status: 'none', fc: null, error: null } });
  ok(reanchorNow(noFc, LALA, NOW, 'Lala') === noFc,
    'a silenced or ended storm, whose forecast slots are already empty, is a no-op');

  /* Purity: the input bundle must survive untouched, because ambient and
   * selected paths hand the same cached object through here. */
  const src = bundle();
  const before = JSON.stringify(src);
  reanchorNow(src, LALA, NOW, 'Lala');
  ok(JSON.stringify(src) === before, 'the input bundle must not be mutated');
}

section('longitude wrap at the antimeridian');
{
  ok(dLon(179.9, -179.9) < 0.3, 'a fix either side of 180 must compare as close, not 359 apart');
  ok(samePoint([-179.99999999, 5], [180.00000001, 5]),
    'the same fix written from either side of the seam must match');
  ok(!samePoint([-171.2, 26.9], [-171.3, 28.1]),
    'the tolerance must never match two genuinely different published fixes');
  ok(Object.keys(readingFrom(null)).length === 0,
    'no record to read from → no invented reading');
}

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
