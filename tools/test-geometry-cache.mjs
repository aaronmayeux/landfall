#!/usr/bin/env node
/**
 * test-geometry-cache.mjs — the never-regress rule, asserted directly.
 *
 * ===> THIS SUITE EXISTS BECAUSE OF ONE MEASURED OUTAGE. <===
 * 2026-07-26. Hurricane Fausto crossed 140°W. NHC moved his bin from EP1 to
 * CP1 at the 15:00Z advisory and published the new bin's geometry later. For
 * that window the app fetched successfully, got an empty answer, stored it as
 * a success under the advisory key, and threw away the cone and wind field it
 * had drawn correctly minutes earlier. The map went blank and the panel said
 * "no wind field published for this advisory", which was false.
 *
 * Nothing about that was a crash, a rejected promise, or a 500. Every function
 * involved did exactly what it was written to do. The bug was a POLICY — that
 * the newest answer wins — and a policy is only testable if it lives in one
 * place with a name. `preferBundle` is that place; this file is that test.
 *
 * WHAT IT CANNOT TELL YOU: whether the summary service is the right upstream,
 * whether the bin filter matches, or whether anything draws. Those need the
 * live service and a phone. This is the decision logic, in isolation, with
 * fixtures — which is the part that had no way to fail loudly before.
 *
 * Zero dependencies (§12). Run: node tools/test-geometry-cache.mjs
 */

import {
  preferBundle,
  bundleHasFeatures,
  getGeometry,
  getGeometryRecord,
  putGeometry,
  geometryNeedsFetch,
  evictGeometry,
  _resetGeometryCache,
} from '../data/cache.js';
import { CACHE } from '../config/constants.js';

let passed = 0;
const failures = [];

function ok(label, cond) {
  if (cond) { passed++; return; }
  failures.push(label);
  console.error(`  ✗ ${label}`);
}
function eq(label, actual, expected) {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}
function group(name) { console.log(`\n  ${name}`); }

/* `putGeometry` warns on the console every time it keeps a held bundle over an
 * emptier one — correct in the app, pure noise in a suite that provokes it
 * dozens of times on purpose. Silenced here and nowhere else. */
const realWarn = console.warn;
console.warn = () => {};

/* --- fixtures ------------------------------------------------------------
 * The minimum shape the cache reads: layer statuses and the geometry's own
 * stamp. `ok` is the only status that means features exist. */
const withFeatures = (advisnum, filedate, bin = 'EP1') => ({
  layers: { cone: { status: 'ok', fc: { type: 'FeatureCollection', features: [{}] } } },
  stamp: { advisnum, filedate },
  bin,
});
const empty = (bin = 'CP1') => ({
  layers: { cone: { status: 'none', fc: null }, windCurrent: { status: 'none', fc: null } },
  stamp: { advisnum: null, filedate: null },
  bin,
});
const allUnavailable = (bin = 'EP1') => ({
  layers: { cone: { status: 'unavailable', fc: null, error: 'HTTP 500' } },
  stamp: { advisnum: null, filedate: null },
  bin,
});

const T0 = 1_785_000_000_000; // fixed epoch — no wall clock in assertions

/* --- bundleHasFeatures --------------------------------------------------- */
group('what counts as geometry');
eq('a bundle with an ok slot has features', bundleHasFeatures(withFeatures('30', T0)), true);
eq('all-none has no features', bundleHasFeatures(empty()), false);
eq('all-unavailable has no features', bundleHasFeatures(allUnavailable()), false);
eq('an error record has no features', bundleHasFeatures({ error: 'boom' }), false);
eq('null has no features', bundleHasFeatures(null), false);

/* --- preferBundle: THE RULE ---------------------------------------------- */
group('preferBundle — features beat no features, in both directions');
{
  const good = withFeatures('30', T0);
  const nothing = empty();

  ok('nothing held: take whatever arrives', preferBundle(null, nothing) === nothing);
  ok('held good, incoming empty: KEEP THE GOOD ONE', preferBundle(good, nothing) === good);
  ok('held empty, incoming good: take the good one', preferBundle(nothing, good) === good);
  ok('held good, incoming all-unavailable: keep the good one',
    preferBundle(good, allUnavailable()) === good);

  /* The exact regression. An empty answer that claims to be NEWER still loses:
   * recency is not a reason to erase geometry. */
  const newerButEmpty = { ...empty(), stamp: { advisnum: '31', filedate: T0 + 6 * 3600_000 } };
  ok('a NEWER empty answer still loses to older real geometry',
    preferBundle(good, newerButEmpty) === good);
}

group('preferBundle — two real bundles compare on the GEOMETRY stamp');
{
  const older = withFeatures('30', T0);
  const newer = withFeatures('31', T0 + 6 * 3600_000);
  ok('newer wins', preferBundle(older, newer) === newer);
  ok('older loses', preferBundle(newer, older) === newer);

  /* `>=` on purpose: re-fetching the same advisory refreshes rather than
   * sticking on the first copy forever. */
  const sameAgain = withFeatures('31', T0 + 6 * 3600_000);
  ok('an equal stamp refreshes rather than sticking',
    preferBundle(newer, sameAgain) === sameAgain);

  const noStamp = { ...withFeatures(null, null), bin: 'EP1' };
  ok('an unreadable stamp moves rather than freezes',
    preferBundle(older, noStamp) === noStamp);
}

group('preferBundle — two empties');
{
  const a = empty('EP1');
  const b = empty('CP1');
  ok('nothing to protect: take the newer attempt', preferBundle(a, b) === b);
}

/* --- the cache around it -------------------------------------------------- */
group('putGeometry keeps good geometry through an empty fetch');
{
  _resetGeometryCache();
  const good = withFeatures('30', T0, 'EP1');
  const drawn1 = putGeometry('nhc:ep062026', good, 'nhc:ep062026:030');
  ok('first good bundle is what we draw', drawn1 === good);

  const drawn2 = putGeometry('nhc:ep062026', empty('CP1'), 'nhc:ep062026:031');
  ok('empty fetch: we still draw the good one', drawn2 === good);
  ok('and getGeometry agrees', getGeometry('nhc:ep062026') === good);
  eq('the record still points at the OLD advisory',
    getGeometryRecord('nhc:ep062026').bundleKey, 'nhc:ep062026:030');
}

group('putGeometry keeps good geometry through a failed fetch');
{
  _resetGeometryCache();
  const good = withFeatures('30', T0);
  putGeometry('nhc:al012026', good, 'nhc:al012026:030');
  const drawn = putGeometry('nhc:al012026', { error: 'HTTP 502' }, 'nhc:al012026:031');
  ok('failed fetch: the cone keeps drawing', drawn === good);
  eq('the error is recorded even so', getGeometryRecord('nhc:al012026').error, 'HTTP 502');
}

group('a failure with nothing held IS the answer');
{
  _resetGeometryCache();
  const drawn = putGeometry('nhc:ep092026', { error: 'HTTP 502' }, 'nhc:ep092026:001');
  eq('returns the error', drawn.error, 'HTTP 502');
  eq('getGeometry returns the error too', getGeometry('nhc:ep092026').error, 'HTTP 502');
}

/* --- the retry window ----------------------------------------------------- */
group('geometryNeedsFetch — an empty answer must not settle in');
{
  _resetGeometryCache();
  const id = 'nhc:ep062026';
  eq('unknown storm: fetch it', geometryNeedsFetch(id, 'nhc:ep062026:030', T0), true);

  putGeometry(id, withFeatures('30', T0, 'EP1'), 'nhc:ep062026:030');
  eq('advisory we hold: leave it alone',
    geometryNeedsFetch(id, 'nhc:ep062026:030', T0), false);
  eq('a NEW advisory: fetch it',
    geometryNeedsFetch(id, 'nhc:ep062026:031', T0), true);

  /* The empty CP1 answer lands. It must NOT look settled — but it must not be
   * hammered either. */
  putGeometry(id, empty('CP1'), 'nhc:ep062026:031');
  const now = getGeometryRecord(id).triedAt;
  eq('just tried and got nothing: back off briefly',
    geometryNeedsFetch(id, 'nhc:ep062026:031', now + 1000), false);
  eq('after the retry window: ASK AGAIN',
    geometryNeedsFetch(id, 'nhc:ep062026:031', now + CACHE.geometryRetryMs + 1), true);

  /* This is the assertion that would have caught the six-hour freeze: under
   * the old advisory-keyed cache the answer here was "no, we already have
   * advisory 31" — forever, because the empty result had claimed that key. */
  ok('the empty answer never claimed the new advisory',
    getGeometryRecord(id).bundleKey === 'nhc:ep062026:030');
}

/* --- the whole Fausto sequence ------------------------------------------- */
group('end to end: EP1 good → CP1 empty → CP1 real');
{
  _resetGeometryCache();
  const id = 'nhc:ep062026';

  const ep1 = withFeatures('30', T0, 'EP1');
  putGeometry(id, ep1, 'nhc:ep062026:030');
  ok('advisory 30 draws', getGeometry(id) === ep1);

  putGeometry(id, empty('CP1'), 'nhc:ep062026:031');
  ok('bin flips, CP1 is empty: advisory 30 STILL draws', getGeometry(id) === ep1);
  eq('and the map is not blank', bundleHasFeatures(getGeometry(id)), true);

  const cp1 = withFeatures('31', T0 + 6 * 3600_000, 'CP1');
  const drawn = putGeometry(id, cp1, 'nhc:ep062026:031');
  ok('NOAA publishes CP1: the new geometry takes over', drawn === cp1);
  eq('the record now points at advisory 31',
    getGeometryRecord(id).bundleKey, 'nhc:ep062026:031');
  eq('and nothing needs fetching', geometryNeedsFetch(id, 'nhc:ep062026:031', T0), false);
}

/* --- retry and bounds ----------------------------------------------------- */
group('evict and LRU');
{
  _resetGeometryCache();
  putGeometry('nhc:al012026', withFeatures('30', T0), 'nhc:al012026:030');
  evictGeometry('nhc:al012026');
  eq('evict drops everything, including good geometry', getGeometry('nhc:al012026'), null);
  eq('and the next fetch is real', geometryNeedsFetch('nhc:al012026', 'nhc:al012026:030', T0), true);

  _resetGeometryCache();
  const n = CACHE.geometryLruStorms;
  for (let i = 0; i <= n; i++) {
    putGeometry(`storm:${i}`, withFeatures('1', T0 + i), `storm:${i}:001`);
  }
  eq('the cache is bounded — oldest evicted', getGeometry('storm:0'), null);
  ok('the newest survives', !!getGeometry(`storm:${n}`));
}

/* --- report --------------------------------------------------------------- */
console.warn = realWarn;
console.log('');
if (failures.length) {
  console.error(`✗ ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`✓ ${passed} assertions passed`);
console.log('  (policy only — they cannot tell you the summary service still publishes these bins)');
