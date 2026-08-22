#!/usr/bin/env node
/**
 * test-forecast-overtaken.mjs — a forecast hour the storm has already driven
 * past is not a forecast (SPEC-MAP.md §7.14).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-forecast-overtaken.mjs`, same as
 * every other suite here (§12 — this project has no toolchain by design).
 *
 * ==> WHY THIS IS A SEPARATE SUITE FROM test-forecast-now.mjs. <== That one
 * pins `samples/lala-cp012026/`, the 2026-08-21T23:30Z capture, and it must
 * keep pinning it: it is the fixture for the CLOCK rule and its assertions are
 * about hours that had genuinely passed. This suite pins
 * `samples/lala-cp012026-overtaken/`, the 13:04Z capture the day after, whose
 * fault is an hour that had NOT passed and was already wrong. Mixing them in
 * one file is how the next reader measures §7.14 against yesterday's bytes,
 * which is the trap that has now cost two sessions.
 *
 * ==> IT COVERS BOTH DOORS ON PURPOSE. <== The track line (lib/forecast-now.js)
 * and the wind swath (lib/windswath.js) never read each other's output and each
 * builds its own timeline. They have to agree hour for hour or the corridor
 * folds around a track that does not, and the only way to hold them together is
 * a suite that asks both the same question about the same bytes.
 *
 * THE CLOCK IS PINNED to the moment Aaron reported it on glass. Reading the
 * real wall clock would make this pass today and fail forever after, because
 * the fixture's noon recedes into the past and the CLOCK rule starts catching
 * what the GROUND rule is supposed to catch — which would look like a pass and
 * would be the test quietly stopping.
 *
 * WHAT THIS CANNOT PROVE: that the corrected line reads as a forecast. That is
 * glass, and it is Aaron's.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const near = (a, b, eps, m) => ok(Number.isFinite(a) && Math.abs(a - b) <= eps,
  `${m} — got ${a}, wanted ${b} ± ${eps}`);
const section = (n) => console.log(`\n  ${n}`);

const { reanchorNow } = await import('../lib/forecast-now.js');
const { buildFullTrack } = await import('../lib/windswath.js');
const { alongTrackNm } = await import('../lib/geo.js');
const { centreOfRadiiRing } = await import('../lib/windswath.js');
const { FORECAST_NOW, WIND_SWEEP } = await import('../config/constants.js');
const { parseNhcValidtime } = await import('../lib/time.js');

const S = 'samples/lala-cp012026-overtaken';
const read = (f) => JSON.parse(readFileSync(`${S}/${f}`, 'utf8'));

/* The wall clock at Aaron's screenshot, 07:53 local on 2026-08-22. Inside the
 * 09:00Z–13:00Z window; see the fixture README. */
const NOW = Date.parse('2026-08-22T12:53:00Z');

/* Both storms straight out of the archived feed, normalized the way data/nhc.js
 * normalizes them. Read from the file rather than typed, so a fixture swapped
 * for a fresher capture cannot leave stale numbers hardcoded here. */
const FEED = read('currentstorms-040.json').activeStorms;
const feedStorm = (name) => {
  const r = FEED.find((s) => s.name === name);
  return {
    name: r.name,
    lon: r.longitudeNumeric,
    lat: r.latitudeNumeric,
    headingDeg: r.movementDir,
    observedAt: r.lastUpdate,
  };
};
const LALA = feedStorm('Lala');
const MOKE = feedStorm('Moke');

/* `_time` is stamped during parsing (data/nhc-mapserver.js
 * `annotateForecastTimes`), not published on the wire, so the fixture gets it
 * through the SAME parser the app uses. Stamping it by hand would let a change
 * in that parser slip past this suite. */
function forecastPoints(file) {
  const fc = read(file);
  for (const f of fc.features) {
    f.properties._time = parseNhcValidtime(f.properties.validtime, f.properties.advdate);
  }
  fc.features.sort((a, b) => a.properties.tau - b.properties.tau);
  return fc;
}

const clone = (o) => JSON.parse(JSON.stringify(o));

function lalaBundle() {
  return {
    layers: {
      forecastPoints: { status: 'ok', fc: forecastPoints('forecast-points-039.geojson') },
      forecastTrack: { status: 'ok', fc: read('forecast-track-039.geojson') },
      pastPoints: { status: 'ok', fc: read('past-points-040.geojson') },
    },
  };
}

function mokeBundle() {
  return {
    layers: {
      forecastPoints: { status: 'ok', fc: forecastPoints('moke-forecast-points-004.geojson') },
      forecastTrack: { status: 'ok', fc: read('moke-forecast-track-004.geojson') },
      pastPoints: { status: 'ok', fc: read('moke-past-points-008.geojson') },
    },
  };
}

function lalaTiers(extra = {}) {
  return {
    pastRadii: read('wind-past-040.geojson').features,
    pastPoints: read('past-points-040.geojson').features,
    currentField: read('wind-current-039.geojson').features,
    forecastRadii: read('wind-swath-039.geojson').features,
    forecastPoints: forecastPoints('forecast-points-039.geojson').features,
    currentPos: {
      lon: LALA.lon, lat: LALA.lat, at: LALA.observedAt, headingDeg: LALA.headingDeg,
    },
    ...extra,
  };
}

const lineOf = (b) =>
  b.layers.forecastTrack.fc.features.find((f) => f.geometry.type === 'LineString')
    .geometry.coordinates;
const taus = (b) => b.layers.forecastPoints.fc.features.map((f) => f.properties.tau);

/* The bearing of a leg, so a fold-back is asserted as a REVERSAL and not as a
 * pair of coordinates that happen to differ. A coordinate assertion passes just
 * as well when the whole track has moved for an unrelated reason. */
function legBearing(a, b) {
  const east = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
  const north = b[1] - a[1];
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}
function turnBetween(p0, p1, p2) {
  const d = Math.abs(legBearing(p1, p2) - legBearing(p0, p1)) % 360;
  return d > 180 ? 360 - d : d;
}

/* ==========================================================================
 * 1. THE RAW BYTES STILL REPRODUCE THE FAULT
 *
 * If NHC's clocks ever line up, or the fixture is replaced with a capture from
 * outside the window, these fail and say so rather than letting everything
 * below pass vacuously against bytes with nothing wrong in them.
 * ======================================================================== */
section('the archived bytes still carry the overtake');

{
  const fc = forecastPoints('forecast-points-039.geojson');
  const t0 = fc.features[0];
  const t12 = fc.features[1];

  ok(String(t0.properties.advisnum) === '39',
    'fixture forecast points are advisory 39');
  ok(FEED.find((s) => s.name === 'Lala').publicAdvisory.advNum === '040',
    'fixture feed is advisory 040 — an advisory NEWER than the forecast');

  near(t12.properties._time, Date.parse('2026-08-22T12:00:00Z'), 0,
    'advisory 39 tau-12 is valid at noon');
  ok(t12.properties._time > NOW - FORECAST_NOW.expiryGraceMs,
    'and noon has NOT expired on the clock at the pinned moment — the clock '
    + 'rule alone would keep it');

  const along = alongTrackNm(
    LALA.lon, LALA.lat,
    t12.geometry.coordinates[0], t12.geometry.coordinates[1],
    LALA.headingDeg
  );
  near(along, -33.6, 1.5,
    'and it sits ~34 nm behind her ALONG THE HEADING (43 nm of straight-line '
    + 'separation, the rest of it across-track)');
  ok(along < -FORECAST_NOW.behindGraceNm,
    'which is past the grace distance');

  const along0 = alongTrackNm(
    LALA.lon, LALA.lat,
    t0.geometry.coordinates[0], t0.geometry.coordinates[1],
    LALA.headingDeg
  );
  ok(along0 < along, 'tau-0 is further behind still');
}

/* ==========================================================================
 * 2. THE TRACK LINE (lib/forecast-now.js)
 * ======================================================================== */
section('door one — the forecast track line');

{
  const out = reanchorNow(lalaBundle(), LALA, NOW, 'Lala');
  const line = lineOf(out);

  near(line[0][0], LALA.lon, 1e-9, 'the line now starts at the storm, longitude');
  near(line[0][1], LALA.lat, 1e-9, 'the line now starts at the storm, latitude');

  near(line[1][0], -172.2, 1e-9, 'and continues to tau-24, longitude');
  near(line[1][1], 31.0, 1e-9, 'and continues to tau-24, latitude');

  ok(!line.some((c) => Math.abs(c[0] + 171.2) < 1e-9 && Math.abs(c[1] - 30.1) < 1e-9),
    'noon is GONE from the line — it was three hours away and 43 nm behind her');

  ok(!taus(out).includes(12), 'noon is gone from the forecast points too');
  ok(taus(out).includes(24), 'tau-24 survives — it is genuinely ahead');
  ok(taus(out)[0] === 0 && out.layers.forecastPoints.fc.features[0].properties._now === true,
    'the surviving head is the stamped observation, not a forecast hour');

  near(legBearing(line[0], line[1]), 346, 3,
    'the first leg now runs northwest, with the storm');
  ok(turnBetween(line[0], line[1], line[2]) < 45,
    'and the head of the line no longer reverses on itself');
}

{
  /* THE FAULT AS IT SHIPPED, reproduced by removing only the ground test. Not a
   * historical note — this is the assertion that the rule is load-bearing. */
  const before = reanchorNow(lalaBundle(), { ...LALA, headingDeg: null }, NOW, 'Lala');
  const line = lineOf(before);
  near(legBearing(line[0], line[1]), 106, 4,
    'without a heading the first leg runs ESE — backwards');
  ok(turnBetween(line[0], line[1], line[2]) > 140,
    'and then turns ~150° at the second vertex: the hairpin Aaron saw');
}

/* ==========================================================================
 * 3. THE WIND SWATH (lib/windswath.js)
 * ======================================================================== */
section('door two — the full-track wind swath');

const { __internals: swathInternals } = await import('../lib/windswath.js');
const { leadingOvertaken } = swathInternals;

/* The forecast tier as buildFullTrack assembles it: one entry per tau, each at
 * the centre solved out of its own published ring (§7.13). Rebuilt here through
 * the shipped solver rather than approximated, because the whole question is
 * where those rings actually sit. */
function forecastEntries(tiers) {
  const seen = new Map();
  for (const f of tiers.forecastRadii) {
    const tau = f.properties.tau;
    if (!Number.isFinite(tau) || seen.has(tau)) continue;
    const p = f.properties;
    const c = centreOfRadiiRing(f.geometry, {
      ne: +p.ne || 0, se: +p.se || 0, sw: +p.sw || 0, nw: +p.nw || 0,
    });
    if (c) seen.set(tau, { tau, lon: c.lon, lat: c.lat });
  }
  return [...seen.values()].sort((a, b) => a.tau - b.tau);
}

{
  /* THE DECISION, ASSERTED DIRECTLY. The swath returns polygons, and reading a
   * fold back out of a 1,200-vertex corridor means guessing at extents — the
   * past tier alone runs from 137°W to 178°W, so "how far east does it reach"
   * answers a question about Lala's whole life and nothing about noon. This
   * calls the shipped walk with the shipped inputs instead. */
  const tiers = lalaTiers();
  const cur = { lon: tiers.currentPos.lon, lat: tiers.currentPos.lat };
  const entries = forecastEntries(tiers);

  ok(entries[0].tau === 0 && entries[1].tau === 12,
    'the forecast tier really does lead with tau-0 and noon');

  const n = leadingOvertaken(entries, cur, LALA.headingDeg, WIND_SWEEP.behindGraceNm);
  ok(n === 2, `the walk drops tau-0 and noon and stops there (dropped ${n})`);

  /* GUARDED, because a walk that runs off the end is one of the mutations this
   * suite is supposed to catch and a suite that THROWS reports nothing. A
   * thrown test is a test that has stopped, and it looks the same from the
   * outside as the tool being broken. */
  const survivor = entries[n] || null;
  ok(survivor?.tau === 24, 'the first surviving ring is tau-24');
  ok(survivor != null
    && alongTrackNm(cur.lon, cur.lat, survivor.lon, survivor.lat, LALA.headingDeg) > 0,
  'and it is ahead of her');
}

{
  /* NO HEADING, NO TEST. The clock rules are untouched, so this is the ground
   * rule and nothing else. */
  ok(leadingOvertaken(
    forecastEntries(lalaTiers()),
    { lon: LALA.lon, lat: LALA.lat },
    null,
    WIND_SWEEP.behindGraceNm
  ) === 0, 'without a heading the walk drops nothing');
}

{
  /* AND THE CORRIDOR ITSELF STILL BUILDS. A correct walk is no use if the sweep
   * it feeds throws or comes back empty. */
  const built = buildFullTrack(lalaTiers());
  ok(built.length > 0, 'the swath still builds');
  const t34 = built.filter((f) => f.properties.radii === 34);
  ok(t34.length === 1, 'the 34 kt tier is one unbroken corridor');
  ok(t34[0].geometry.coordinates[0].every((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])),
    'and every vertex of it is a real place');

  const before = buildFullTrack(lalaTiers({
    currentPos: { lon: LALA.lon, lat: LALA.lat, at: LALA.observedAt, headingDeg: null },
  }));
  const b34 = before.filter((f) => f.properties.radii === 34);
  ok(JSON.stringify(b34[0].geometry) !== JSON.stringify(t34[0].geometry),
    'and the corridor really is a different shape without the rule');
}

{
  /* ==> THE ASSERTION THE WHOLE SUITE EXISTS FOR. <== The two doors must drop
   * the same hours. They share `alongTrackNm` and one grace distance precisely
   * so this cannot drift, and this is what catches it if someone ever gives one
   * of them its own copy. */
  const anchored = reanchorNow(lalaBundle(), LALA, NOW, 'Lala');
  const dropped = leadingOvertaken(
    forecastEntries(lalaTiers()),
    { lon: LALA.lon, lat: LALA.lat },
    LALA.headingDeg,
    WIND_SWEEP.behindGraceNm
  );
  const keptByLine = taus(anchored).slice(1);   // past the stamped now-point
  const keptBySwath = forecastEntries(lalaTiers()).slice(dropped).map((e) => e.tau);
  ok(JSON.stringify(keptByLine) === JSON.stringify(keptBySwath),
    `the line and the swath keep the same hours (${keptByLine} vs ${keptBySwath})`);
  ok(FORECAST_NOW.behindGraceNm === WIND_SWEEP.behindGraceNm,
    'and both doors read the same grace distance');
}

/* ==========================================================================
 * 4. MOKE IS THE CONTROL AND HE MUST NOT MOVE
 *
 * 28 hours and four advisories of skew — far worse than Lala's six — and no
 * fold, because advisory 4 forecast him well. A rule that fired on STALENESS
 * rather than on OVERTAKING would wreck him to fix her. See the fixture README.
 * ======================================================================== */
section('Moke — worse skew, no fault, must be untouched');

{
  const withRule = reanchorNow(mokeBundle(), MOKE, NOW, 'Moke');
  const withoutRule = reanchorNow(mokeBundle(), { ...MOKE, headingDeg: null }, NOW, 'Moke');

  ok(JSON.stringify(taus(withRule)) === JSON.stringify(taus(withoutRule)),
    'the ground rule drops nothing on Moke that the clock rule did not');
  ok(JSON.stringify(lineOf(withRule)) === JSON.stringify(lineOf(withoutRule)),
    'and his track line is byte-identical either way');

  const fc = forecastPoints('moke-forecast-points-004.geojson');
  ok(String(fc.features[0].properties.advisnum) === '4'
    && FEED.find((s) => s.name === 'Moke').publicAdvisory.advNum === '008',
    'and he really is four advisories out of step — the control is a real one');

  /* READ OUT OF THE OUTPUT, and the stamped now-point skipped. Filtering the
   * fixture by surviving tau would match advisory 4's OWN tau-0 against the new
   * one — same number, 215 nm apart — and report the storm as behind itself. */
  const behind = withRule.layers.forecastPoints.fc.features
    .filter((f) => !f.properties._now)
    .filter((f) => {
      const a = alongTrackNm(
        MOKE.lon, MOKE.lat, f.geometry.coordinates[0], f.geometry.coordinates[1], MOKE.headingDeg
      );
      return a != null && a < -FORECAST_NOW.behindGraceNm;
    });
  ok(behind.length === 0, 'every hour he keeps is genuinely ahead of him');
}

/* ==========================================================================
 * 5. THE GUARDS — no heading, no test; and the maths itself
 * ======================================================================== */
section('guards');

{
  const noHeading = reanchorNow(lalaBundle(), { ...LALA, headingDeg: undefined }, NOW, 'Lala');
  ok(taus(noHeading).includes(12),
    'no published heading means no ground test — the clock rule stands alone');

  const bogus = reanchorNow(lalaBundle(), { ...LALA, headingDeg: 'north' }, NOW, 'Lala');
  ok(taus(bogus).includes(12), 'an unreadable heading is not a heading of zero');

  ok(alongTrackNm(0, 0, 0, 0, null) === null, 'a null heading returns null, not 0');
  ok(alongTrackNm(0, 0, 1, 0, undefined) === null, 'so does a missing one');
}

{
  /* The maths, pinned on numbers a reader can check by hand. */
  near(alongTrackNm(0, 0, 0, 1, 0), 60, 1e-6, 'one degree due north, heading north: 60 nm');
  near(alongTrackNm(0, 0, 0, -1, 0), -60, 1e-6, 'one degree due south, heading north: -60 nm');
  near(alongTrackNm(0, 0, 1, 0, 90), 60, 1e-6, 'one degree due east, heading east: 60 nm');
  near(alongTrackNm(0, 0, 0, 1, 90), 0, 1e-6, 'due north is abeam of an eastward heading');

  /* Compass, not maths: (sin, cos). A (cos, sin) mistake mirrors the NE
   * diagonal, which is exactly where a recurving storm lives. */
  near(alongTrackNm(0, 0, 1, 1, 45), 84.85, 0.01, 'northeast on a 045 heading is the hypotenuse');
  near(alongTrackNm(0, 0, 1, 1, 315), 0, 1e-6, 'and abeam of a 315 heading');

  /* The seam. 179.8E measured against 179.9W is 0.3° apart, not 359.7°. */
  near(alongTrackNm(179.8, 0, -179.9, 0, 90), 18, 0.01,
    'the antimeridian is 0.3° wide, not 359.7°');
}

/* ------------------------------------------------------------------------ */

console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
