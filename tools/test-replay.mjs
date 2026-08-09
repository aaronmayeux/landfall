#!/usr/bin/env node
/**
 * test-replay.mjs — the Ida replay relay, driven through the app's own parsers.
 *
 * ZERO DEPENDENCIES. No browser, no network: the Pages Function is imported
 * directly and handed a fake `env.ASSETS` that reads the committed fixtures
 * off disk. What it returns then goes through the REAL normalizeStorm,
 * scrubSentinels, normalizeForecast and normalizeForecastRadii, because the
 * only thing worth proving here is that the app cannot tell the difference.
 *
 * WHAT THIS CANNOT PROVE: that the globe draws it. That needs a browser and a
 * basemap, neither of which exists in a session. It is glass.
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

const mod = await import('../functions/api/replay/[[route]].js');
const { _normalizeNhcStorm } = await import('../data/nhc.js');
const { normalizeForecast, normalizeForecastRadii, SUMMARY_LAYER } =
  await import('../data/nhc-mapserver.js');

/** Static assets, off disk, exactly as the Function will see them. */
const ASSETS = {
  async fetch(url) {
    const p = decodeURIComponent(new URL(url).pathname).replace(/^\//, '');
    if (!fs.existsSync(p)) return new Response('not found', { status: 404 });
    return new Response(fs.readFileSync(p, 'utf8'), { status: 200 });
  },
};

async function call(iso, route, query = '') {
  const parts = [iso, ...route.split('/')];
  const url = `https://x/api/replay/${parts.map(encodeURIComponent).join('/')}${query}`;
  return mod.onRequest({
    request: new Request(url),
    env: { ASSETS },
    params: { route: parts },
  });
}
const body = async (res) => JSON.parse(await res.text());

const AT = '2021-08-29T09:00:00Z';   // Advisory 12
const BIN = 'AT9';
const q = (layer) => `?layer=${layer}&bin=${BIN}`;

/* =========================================================================
 * 1. THE STORM LIST IS A CurrentStorms.json THE APP ALREADY PARSES
 * ====================================================================== */
section('the storm list');

const listRes = await call(AT, 'nhc/storms');
ok(listRes.status === 200, `it answers 200 (got ${listRes.status})`);
ok(listRes.headers.get('x-landfall-fetched-at') === AT,
   'and stamps the advisory time, so the app’s staleness machinery has something to read');
ok(listRes.headers.get('cache-control') === 'no-store',
   'no-store, same as every other relay route — a cached advisory outlives the scrubber');

const list = await body(listRes);
ok(Array.isArray(list.activeStorms) && list.activeStorms.length === 1, 'one storm');

/* ==> THE APP’S OWN NORMALIZER, NOT A RESHAPE OF IT. <== */
const storm = _normalizeNhcStorm(list.activeStorms[0]);
ok(storm != null, 'normalizeStorm accepts it');
ok(storm.name === 'Ida' && storm.sourceId === 'al092021', 'named and identified');
near(storm.lat, 28.0, 1e-9, 'latitude');
near(storm.lon, -89.1, 1e-9, 'longitude — WEST is negative, which is where a replay dies quietly');
ok(storm.windKt === 120, '120 kt');
ok(storm.pressureMb === 946, '946 mb');
ok(storm.headingDeg === 315 && storm.speedKt === 13, 'moving NW at 13 kt');
ok(storm.nature === 'tropical', 'tropical');
ok(storm.raw.binNumber === BIN, `bin ${BIN}, which is what the geometry fetch keys on`);
ok(storm.can.watchWarning === true,
   'and it can answer for watches, because this advisory published them');

/* ==> AN ADVISORY WITH NO WATCH/WARNING FILE MUST NOT CLAIM IT CAN. <== The
 * PRESENCE of the key is the app’s signal, so getting this wrong turns "none
 * in effect" into a layer the app asks for and cannot get. */
const early = _normalizeNhcStorm((await body(await call('2021-08-26T15:00:00Z', 'nhc/storms'))).activeStorms[0]);
ok(early.windKt === 30, 'at advisory 1 she is a 30 kt depression, not a hurricane');
ok(early.can.watchWarning === true,
   'and she already has watches — Jamaica and Cuba were warned from the first advisory');
/* The LAST advisory is the one with none: by then she is inland over
 * Mississippi and every coastal warning has been dropped. */
const last = _normalizeNhcStorm((await body(await call('2021-08-31T00:00:00Z', 'nhc/storms'))).activeStorms[0]);
ok(last.can.watchWarning === false,
   'by the final advisory every warning is down, and the app is told there is nothing to ask for');

/* =========================================================================
 * 2. THE CLOCK ONLY EVER LOOKS BACKWARDS
 * ====================================================================== */
section('the replay clock');

const before = await body(await call('2021-08-20T00:00:00Z', 'nhc/storms'));
ok(before.activeStorms.length === 0,
   'before the first advisory there is no storm — an empty ocean, not an error');

/* One minute before advisory 12 must still be advisory 11. A replay that
 * rounds to the nearest advisory shows the reader a forecast that had not
 * been written yet, which is the only way this page can actually lie. */
/* NHC issues an intermediate advisory between the six-hourly ones, so the
 * advisory in force at 0859Z is 11A and not 11 — which is exactly the sort of
 * thing a replay must get right, because 11A carries a position three hours
 * fresher than 11 did. */
const justBefore = await call('2021-08-29T08:59:00Z', 'nhc/storms');
ok(justBefore.headers.get('x-landfall-replay-advisory') === '11A',
   `a minute early is the intermediate 11A (got ${justBefore.headers.get('x-landfall-replay-advisory')})`);
const onTime = await call(AT, 'nhc/storms');
ok(onTime.headers.get('x-landfall-replay-advisory') === '12', 'and on the minute it is 12');

ok((await call('not-a-time', 'nhc/storms')).status === 400, 'a bad time is a 400, not a guess');
ok((await call(AT, 'nhc/mapserver', '?layer=7&bin=EP2')).status === 400,
   'a bin this archive does not hold is a 400');
ok((await call(AT, 'nhc/mapserver', '?layer=99&bin=' + BIN)).status === 400,
   'and so is a layer it does not serve');
ok((await call(AT, 'gdacs/events')).status === 404, 'it serves NHC only, and says so');

/* =========================================================================
 * 3. EVERY LAYER THE APP ASKS FOR, ANSWERED
 * ====================================================================== */
section('all nine layers');

const got = {};
for (const [key, id] of Object.entries(SUMMARY_LAYER)) {
  const res = await call(AT, 'nhc/mapserver', q(id));
  ok(res.status === 200, `layer ${id} (${key}) answers 200`);
  const fc = await body(res);
  ok(fc.type === 'FeatureCollection', `layer ${id} (${key}) is a FeatureCollection`);
  got[key] = fc;
}
for (const key of Object.keys(SUMMARY_LAYER)) {
  ok(got[key].features.length > 0, `${key} is not empty at advisory 12`);
}

/* ==> KEYS ARE LOWER-CASED, AND THAT IS THE WHOLE TRANSLATION. <== The DBF
 * gives MAXWIND; the service the app was written against gives maxwind. Every
 * parser downstream reads the lower-case name and finds nothing otherwise —
 * silently, with no error, producing a storm with no wind. */
const p0 = got.forecastPoints.features[0]?.properties || {};
ok(Object.keys(p0).every((k) => k === k.toLowerCase()), 'every property key is lower-case');
ok('maxwind' in p0 && !('MAXWIND' in p0), 'maxwind, not MAXWIND');

/* =========================================================================
 * 4. THE PARSERS AGREE WITH THE ADVISORY TEXT
 *
 * The text fixtures and the GIS fixtures are two independent captures of the
 * same advisory. If the relay is wired wrong they disagree, and nothing else
 * in this suite would notice.
 * ====================================================================== */
section('the geometry agrees with the text');

const TXT = fs.readFileSync('samples/ida-al092021/fstadv/al092021.fstadv.012.txt', 'utf8');
ok(TXT.includes('MAX SUSTAINED WINDS 120 KT WITH GUSTS TO 145 KT.'),
   'the text advisory says 120 kt gusting 145');

const curve = normalizeForecast(got.forecastPoints);
ok(curve.length >= 7, `the forecast curve has ${curve.length} points`);
ok(curve[0]?.windKt === 120, 'tau 0 is 120 kt, the same number the text carries');
ok(curve.some((p) => p.windKt === 125), 'and the 125 kt peak the text forecasts is in it');
ok(curve[0]?.categorySource === 'reported',
   'category comes from NHC’s own ssnum here, not derived from knots');
ok(curve[0]?.category === 5, 'ssnum 4 is a Cat 4, which is the app’s index 5');

const radii = normalizeForecastRadii(got.windSwath);
const at0 = radii.filter((r) => r.tau === 0);
ok(at0.length === 3, `all three thresholds are published at tau 0 (got ${at0.length})`);
/* ==> DEFAULTED, BECAUSE A MISWIRED RELAY MUST FAIL LOUDLY AND KEEP GOING. <==
 * A mutation run pointed this suite at the wrong advisory — a 30 kt depression
 * with no hurricane-force field — and these two lines threw on `undefined`,
 * which killed the run and hid every assertion after them. A suite that stops
 * at the first surprise reports one bug when there are four. */
const r64 = at0.find((r) => r.kt === 64) || {};
ok(r64.ne === 35 && r64.se === 30 && r64.sw === 20 && r64.nw === 30,
   `64 kt quadrants match "64 KT....... 35NE  30SE  20SW  30NW." exactly (got ${JSON.stringify(r64)})`);
const r34 = at0.find((r) => r.kt === 34) || {};
ok(r34.ne === 120 && r34.se === 100 && r34.sw === 80 && r34.nw === 110,
   `and so do the 34 kt quadrants (got ${JSON.stringify(r34)})`);

/* ==> 9999 IS A SENTINEL AND IT MUST STILL ARRIVE AS ONE. <== The relay does
 * not clean it; scrubSentinels does, inside the app. A replay that pre-cleans
 * is a replay that stops testing the cleaner. */
const rawPts = await body(await call(AT, 'nhc/mapserver', q(SUMMARY_LAYER.forecastPoints)));
ok(rawPts.features.some((f) => f.properties.mslp === 9999 || f.properties.tcdir === 9999),
   'sentinels are passed through untouched for the app to scrub');
ok(curve.every((p) => p.windKt == null || p.windKt < 9999), 'and the app does scrub them');

/* =========================================================================
 * 5. THE WATCHES AND WARNINGS — THE THING THE SPEC SAID COULD NOT BE HAD
 * ====================================================================== */
section('watches and warnings');

const ww = got.watchWarning;
ok(ww.features.length === 6, `six warned segments at advisory 12 (got ${ww.features.length})`);
const codes = [...new Set(ww.features.map((f) => f.properties.tcww))].sort();
ok(String(codes) === 'HWR,TWR', `hurricane and tropical-storm warnings (got ${codes})`);
ok(ww.features.every((f) => f.geometry.type === 'LineString'),
   'as coastal LINES, which is what makes "is my house inside" answerable at all');
ok(TXT.includes('A HURRICANE WARNING IS IN EFFECT FOR...'),
   'and the text advisory agrees a hurricane warning was in force');

/* =========================================================================
 * 6. THE PAST IS THE BEST TRACK, CUT AT THE CLOCK
 * ====================================================================== */
section('the past track');

const past = got.pastPoints.features;
ok(past.length > 5, `${past.length} past positions`);
const dtgs = past.map((f) => Number(f.properties.dtg));
ok(Math.max(...dtgs) <= 2021082909, `nothing after the replay clock (max ${Math.max(...dtgs)})`);
ok(Math.max(...dtgs) === 2021082906,
   'the newest is the 0600Z synoptic fix, which is the last one that existed at 0900Z');
ok(got.pastTrack.features[0]?.geometry?.type === 'LineString', 'the past track is one line');
ok(got.pastTrack.features[0]?.geometry?.coordinates?.length === past.length,
   'with a vertex per past position and no extras');

/* AND IT GROWS. A past track that is the same length at every advisory is a
 * past track that is not being cut at all. */
const later = await body(await call('2021-08-30T09:00:00Z', 'nhc/mapserver', q(SUMMARY_LAYER.pastPoints)));
ok(later.features.length > past.length,
   `a day later there are more past positions (${past.length} -> ${later.features.length})`);

const wp = got.windPast.features;
ok(wp.length > 0, 'past wind radii are served');
ok(wp.every((f) => Number(String(f.properties.synoptime).slice(0, 10)) <= 2021082909),
   'and none of them is from the future either');
/* They have to JOIN — buildFullTrack matches past radii to past centres on the
 * ten digits, and a join that silently misses produces a swath with no past. */
const synops = new Set(wp.map((f) => String(f.properties.synoptime)));
ok(past.some((f) => synops.has(String(f.properties.dtg))),
   'past radii and past centres share their ten-digit stamp, so the swath can join them');

/* ------------------------------------------------------------------------- */
console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed`
    : `\n✓ ${pass} assertions passed`
);
console.log('  (the app cannot tell; whether the globe DRAWS it is glass)');
process.exit(failures.length ? 1 : 0);
