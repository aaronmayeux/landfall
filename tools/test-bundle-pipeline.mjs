#!/usr/bin/env node
/**
 * test-bundle-pipeline.mjs — the decoration order, and nothing else.
 *
 * ZERO DEPENDENCIES, like every other suite here.
 *
 * WHY THIS SUITE EXISTS. `forMap` is the ordering contract for silenced and
 * ended storms and it is the single most load-bearing piece of logic in the
 * app's §5 story — it is what stops a warmed a-deck painting five-day model
 * guidance across a storm nobody has published a fix for since yesterday. It
 * lived inside boot()'s closure sharing five mutable variables with everything
 * else in that function, so no assertion could ever reach it. Every check
 * below is about the ORDER of the three decorations, or about the shallow-copy
 * rule that keeps them from corrupting the shared cache.
 *
 * WHAT IT CANNOT PROVE: that a fetch actually lands, that the sequence guard
 * beats a real race, or that any of it looks right. Those are glass and a
 * browser. What it CAN prove is that the three steps happen in the one order
 * that is correct, which is the thing that was silently unverifiable before.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { withModelTracks, forMap, needsRefetch } = await import('../app/bundle-pipeline.js');
const { FUTURE_SLOTS } = await import('../lib/future-slots.js');

/* --- fixtures --------------------------------------------------------------
 * A bundle in the shape the two geometry fetchers return: named layer slots,
 * a forecast array, an advisory stamp.
 * ------------------------------------------------------------------------ */

const slot = (n) => ({
  status: 'ok',
  fc: { type: 'FeatureCollection', features: Array.from({ length: n }, () => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[-60, 20], [-62, 21], [-64, 22]] },
    properties: {},
  })) },
  error: null,
});

const bundleWith = (...keys) => ({
  layers: Object.fromEntries(keys.map((k) => [k, slot(1)])),
  forecast: [{ lat: 20, lon: -60, windKt: 65 }],
  stamp: { advisnum: '12', filedate: '2026-07-28T15:00:00Z' },
});

/* A deck lookup that always answers ok, with two model tracks in it. */
const deckFor = () => ({
  status: 'ok',
  tracks: [
    { tech: 'AVNO', points: [{ lat: 20, lon: -60 }, { lat: 21, lon: -62 }] },
    { tech: 'EGRR', points: [{ lat: 20, lon: -60 }, { lat: 22, lon: -63 }] },
  ],
  error: null,
});
const allModels = () => true;
const deps = { deckFor, modelOn: allModels };

const now = Date.now();
const HOURS = 3600 * 1000;

const liveStorm = {
  id: 'nhc:al012026', name: 'ALPHA', source: 'nhc',
  advisoryKey: 'al012026-12', observedAt: now - HOURS,
};
const silentStorm = { ...liveStorm, id: 'gdacs:1', observedAt: now - 40 * HOURS };
const endedStorm = {
  ...liveStorm, id: 'nhc:al022026',
  ended: { reason: 'declared', by: 'NHC', at: now - 2 * HOURS },
};

/* --- withModelTracks ------------------------------------------------------ */
section('withModelTracks — the slot always exists');

const decorated = withModelTracks(liveStorm, bundleWith('cone', 'pastTrack'), deps);
ok(decorated.layers.modelTracks?.status === 'ok', 'a warmed deck lands as an ok slot');
ok(decorated.layers.modelTracks.fc?.features?.length > 0, 'and carries features');

const noDeck = withModelTracks(liveStorm, bundleWith('cone'), { deckFor: () => undefined, modelOn: allModels });
ok(noDeck.layers.modelTracks?.status === 'none',
  'NOTHING WARMED YET IS `none`, NOT A MISSING KEY — the layer tests status === "ok" and would read undefined off an absent slot');
ok('modelTracks' in noDeck.layers, 'the key is present even with no deck');

const failedDeck = withModelTracks(liveStorm, bundleWith('cone'),
  { deckFor: () => ({ status: 'unavailable', error: 'relay 502' }), modelOn: allModels });
ok(failedDeck.layers.modelTracks?.status === 'unavailable', 'a failed deck stays unavailable, not none');
ok(failedDeck.layers.modelTracks?.error === 'relay 502', 'and keeps its reason — §5 forbids a silent failure');

section('withModelTracks — shallow copy, never mutation');

const shared = bundleWith('cone', 'pastTrack');
const before = JSON.stringify(shared);
const out = withModelTracks(liveStorm, shared, deps);
ok(out !== shared, 'a new bundle object comes back');
ok(out.layers !== shared.layers, 'and a new layers object');
ok(JSON.stringify(shared) === before,
  'THE INPUT IS UNTOUCHED — it is the cached object the ambient collections and the cage share');
ok(out.layers.cone === shared.layers.cone, 'untouched slots are the SAME objects, not deep copies');

ok(withModelTracks(liveStorm, null, deps) === null, 'a null bundle passes straight through');

/* --- forMap: THE ORDER ----------------------------------------------------
 * This is the whole reason the file exists.
 * ------------------------------------------------------------------------ */
section('forMap — a LIVE storm keeps its future');

const liveOut = forMap(liveStorm, bundleWith('cone', 'forecastTrack', 'pastTrack'), deps);
ok(liveOut.layers.cone?.fc?.features?.length > 0, 'the cone survives');
ok(liveOut.layers.modelTracks?.status === 'ok', 'model guidance draws');
ok(liveOut.forecast.length === 1, 'the forecast array survives');

section('forMap — MODEL TRACKS ARE FOLDED IN BEFORE THE FUTURE IS DROPPED');

for (const [label, storm] of [['SILENT', silentStorm], ['ENDED', endedStorm]]) {
  const res = forMap(storm, bundleWith('cone', 'forecastTrack', 'forecastPoints', 'pastTrack'), deps);

  ok(res.layers.modelTracks && !res.layers.modelTracks.fc,
    `${label}: guidance is EMPTIED, not absent — folded in first so the future-drop could take it back out`);
  ok(res.layers.modelTracks?.status !== 'ok',
    `${label}: a warmed a-deck cannot paint five-day guidance across a storm with no published fix`);
  ok(!res.layers.cone?.fc, `${label}: the cone is emptied`);
  ok(!res.layers.forecastTrack?.fc, `${label}: the forecast track is emptied`);
  ok(res.forecast.length === 0, `${label}: the forecast array is emptied`);
  ok(res.layers.pastTrack?.fc?.features?.length > 0,
    `${label}: HISTORY SURVIVES — the past is a record, not a claim about now`);
}

section('forMap — every future slot the app knows about is covered');

const everySlot = forMap(silentStorm, bundleWith(...FUTURE_SLOTS, 'pastTrack'), deps);
for (const key of FUTURE_SLOTS) {
  ok(!everySlot.layers[key]?.fc, `${key} is emptied for a silent storm`);
}
ok(FUTURE_SLOTS.includes('modelTracks'),
  'MODEL TRACKS ARE ON THE FUTURE LIST — if they ever come off it, the fold-first ordering above stops protecting anything');
ok(FUTURE_SLOTS.includes('watchWarning'),
  'WATCH/WARNING IS ON THE FUTURE LIST — a day-old evacuation stripe painted as current is the most dangerous thing this app could draw');

section('forMap — smoothing runs LAST, on what survived');

const smoothed = forMap(liveStorm, bundleWith('pastTrack', 'forecastTrack'), deps);
const raw = bundleWith('pastTrack').layers.pastTrack.fc.features[0].geometry.coordinates.length;
ok(smoothed.layers.pastTrack.fc.features[0].geometry.coordinates.length > raw,
  'a surviving track comes back with more points than it went in with — it was smoothed');

const smoothedSilent = forMap(silentStorm, bundleWith('pastTrack', 'forecastTrack'), deps);
ok(smoothedSilent.layers.pastTrack?.fc?.features?.length > 0, 'a silent storm still gets a smoothed history');
ok(!smoothedSilent.layers.forecastTrack?.fc,
  'AND NO CONNECTOR TO A FORECAST THAT IS GONE — smooth first and that leg would outlive the forecast it reached for');

section('forMap — the shared bundle survives the whole pass');

const cached = bundleWith('cone', 'forecastTrack', 'pastTrack');
const snapshot = JSON.stringify(cached);
forMap(silentStorm, cached, deps);
forMap(endedStorm, cached, deps);
forMap(liveStorm, cached, deps);
ok(JSON.stringify(cached) === snapshot,
  'THREE PASSES, INCLUDING TWO THAT EMPTY SLOTS, AND THE CACHED OBJECT IS BYTE-IDENTICAL — a mutation here would strip a storm everywhere it is held, permanently');

/* --- needsRefetch --------------------------------------------------------- */
section('needsRefetch — the self-invalidation test');

const a1 = { id: 'x', advisoryKey: 'x-1' };
const a2 = { id: 'x', advisoryKey: 'x-2' };
ok(needsRefetch(a1, a2) === true, 'a new advisory refetches');
ok(needsRefetch(a1, { ...a1 }) === false, 'the same advisory does not');
ok(needsRefetch(a1, { id: 'y', advisoryKey: 'y-1' }) === false,
  'two DIFFERENT storms is a selection change, not a refresh — that comes in through select()');
ok(needsRefetch(null, a1) === false && needsRefetch(a1, null) === false, 'a missing side never refetches');

ok(needsRefetch(
  { id: 'g', advisoryKey: 'g-3', geometryKey: 'g-3|008' },
  { id: 'g', advisoryKey: 'g-3', geometryKey: 'g-3|009' },
) === true,
  'A NEW JTWC WARNING REFETCHES ON AN UNCHANGED ADVISORY — it restamps the winds on every track point, and comparing advisoryKey alone would miss it');

/* --- report -------------------------------------------------------------- */
if (failures.length) {
  console.log(`\n✗ ${failures.length} failed:`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (the decoration ORDER only — whether it draws right is glass)');
