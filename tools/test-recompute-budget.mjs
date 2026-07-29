#!/usr/bin/env node
/**
 * test-recompute-budget.mjs — how much work one tap is allowed to cost.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-recompute-budget.mjs`, same as
 * every other suite here (§12 — this project has no toolchain by design).
 *
 * ==> WHY THIS SUITE EXISTS <==
 *
 * Web Analytics measured INP at 320 ms on the map canvas. Nothing was broken:
 * every path did the right thing, several times. Selecting a storm ran the
 * layer engine's ambient merge THREE times — once for the bundle that actually
 * arrived, then once more for each exclusive pair that `applyLayerState()`
 * pushed with the value it already held — and each merge re-derived the
 * coastal band from a fresh walk of every loaded basemap tile.
 *
 * That is a class of bug this project keeps meeting: correct output, no error
 * anywhere, and the cost invisible in a code review because each individual
 * call is defensible. It is only visible as a COUNT, so this suite counts.
 *
 * WHAT IT CANNOT PROVE: that the app feels fast. These are call counts against
 * stubs. The 200 ms bar is a question for a phone and Web Analytics.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let passed = 0;
const problems = [];

const eq = (label, got, want) => {
  if (got === want) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label} — got ${got}, want ${want}`);
    problems.push(label);
  }
};

const ok = (label, cond) => eq(label, cond === true, true);

/* ---------------------------------------------------------------------------
 * A MapLibre stub with counters.
 *
 * Only the surface these modules actually touch: sources with `setData`, the
 * event registration the memo hangs its invalidation on, and
 * `querySourceFeatures` — which is the expensive call being counted.
 *
 * The coastline it returns is a single ring around a stretch of Gulf coast,
 * enough vertices to clear COAST_BAND.minCoastVertices.
 * ------------------------------------------------------------------------ */

function makeRing(n) {
  const ring = [];
  for (let i = 0; i < n; i++) {
    ring.push([-95 + i * 0.05, 27 + Math.sin(i / 6) * 0.4]);
  }
  return ring;
}

function makeMap() {
  const listeners = new Map();
  const sources = new Map();
  const counts = { query: 0, setData: 0 };

  return {
    counts,
    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, []);
      listeners.get(evt).push(fn);
    },
    emit(evt, payload) {
      for (const fn of listeners.get(evt) || []) fn(payload);
    },
    addSource(id) {
      sources.set(id, {
        setData: () => { counts.setData++; },
      });
    },
    getSource: (id) => sources.get(id),
    addLayer() {},
    getLayer: () => null,
    setLayoutProperty() {},
    project: ([lon, lat]) => ({ x: (lon + 180) * 4, y: (90 - lat) * 4 }),
    querySourceFeatures(source, opts) {
      counts.query++;
      /* Protomaps is asked first and must miss, so the openmaptiles branch is
       * the one exercised — the live basemap today. */
      if (opts.sourceLayer === 'earth') throw new Error('no such source-layer');
      return [
        {
          geometry: { type: 'Polygon', coordinates: [makeRing(400)] },
          properties: { class: 'ocean' },
        },
      ];
    },
  };
}

/** One NHC-shaped watch/warning line, long enough to have coast in its
 *  corridor. */
function wwFeatures() {
  const coords = [];
  for (let i = 0; i < 40; i++) coords.push([-94.5 + i * 0.05, 27.2]);
  return [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { TCWW: 'HWW' },
    },
  ];
}

/** Forecast points for one storm, in NHC's own field shape. */
function pointFeatures(basin, num, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-94 + i * 1.4, 26 + i * 0.9] },
      properties: {
        basin,
        stormnum: num,
        tau: i * 12,
        _time: new Date(Date.UTC(2026, 6, 28, 0) + i * 12 * 3600e3).toISOString(),
        MAXWIND: 90 - i * 5,
      },
    });
  }
  return out;
}

/** A geometry bundle in the shape registry.js consumes. */
function bundleFor(basin, num) {
  return {
    stamp: { advisnum: '7' },
    layers: {
      watchWarning: {
        status: 'ok',
        fc: { type: 'FeatureCollection', features: wwFeatures() },
      },
      forecastPoints: {
        status: 'ok',
        fc: { type: 'FeatureCollection', features: pointFeatures(basin, num, 8) },
      },
    },
  };
}

/* ---------------------------------------------------------------------------
 * 1. THE PAIR PUSH — a no-op must not recompute ambient.
 * ------------------------------------------------------------------------ */

console.log('\n  a no-op pair push costs nothing\n');

const { createLayerEngine } = await import('../map/layers/registry.js');
await import('../map/layers/watch-warning.js');
await import('../map/layers/points-forecast.js');
await import('../map/layers/wind-field.js');

const map = makeMap();
const engine = createLayerEngine(map);
engine.attach();

/* Warm two storms, then select one — the state a tap lands in. */
engine.ambientBundle({ id: 'al012026' }, bundleFor('AL', 1));
engine.ambientBundle({ id: 'ep062026' }, bundleFor('EP', 6));
engine.setBundle({ id: 'al012026' }, bundleFor('AL', 1));

/* Push both pairs at the values they already hold — precisely what
 * `applyLayerState()` does on every selection and every layer change. */
map.counts.query = 0;
map.counts.setData = 0;
engine.setPair('coastal', 'watchWarning');
engine.setPair('windField', 'current');

eq('a redundant coastal push runs no tile query', map.counts.query, 0);
eq('a redundant pair push writes no source', map.counts.setData, 0);

/* A REAL segment change must still reach the map — the guard must not have
 * turned the control off, which is the failure mode this exact pair has had
 * before (config/layers.js, watch-warning.js headers). */
map.counts.setData = 0;
engine.setPair('coastal', 'off');
ok('switching coastal off still writes both sources', map.counts.setData >= 2);

map.counts.setData = 0;
engine.setPair('windField', 'swath');
ok('switching the wind field segment still redraws', map.counts.setData >= 2);

/* ---------------------------------------------------------------------------
 * 2. THE COAST MEMO — repeated selects on one substrate walk the tiles once.
 * ------------------------------------------------------------------------ */

console.log('\n  the coastline is decoded once per substrate\n');

const { coastRings, coastGeneration } = await import('../map/coast-source.js');
const { bandFor, clearBands } = await import('../map/coast-band-cache.js');

const m2 = makeMap();
const first = coastRings(m2);
ok('the stub coastline decodes', first.rings.length > 0 && first.schema === 'openmaptiles');

m2.counts.query = 0;
for (let i = 0; i < 20; i++) coastRings(m2);
eq('20 repeat calls, same substrate, zero extra queries', m2.counts.query, 0);

const genBefore = coastGeneration(m2);
m2.emit('sourcedata', { sourceId: 'basemap' });
ok('a basemap tile event moves the generation', coastGeneration(m2) > genBefore);

m2.counts.query = 0;
coastRings(m2);
ok('and the next ask decodes again', m2.counts.query > 0);

/* bandFor's early-out: same stamp, same substrate, no work at all. */
clearBands();
const m3 = makeMap();
const feats = wwFeatures();
const warm = bandFor(m3, 'al012026', feats, 'adv7');
ok('the first select paints something', warm.paintedCount > 0);

m3.counts.query = 0;
for (let i = 0; i < 10; i++) bandFor(m3, 'al012026', feats, 'adv7');
eq('10 repeat selects, unchanged substrate, zero queries', m3.counts.query, 0);

/* New advisory geometry still invalidates — the one-way rule is about
 * QUALITY, never about showing a band for a superseded warning. */
const fresh = bandFor(m3, 'al012026', feats, 'adv8');
eq('a new advisory stamp re-selects', fresh.fromCache, false);

/* ---------------------------------------------------------------------------
 * 3. IMAGERY COALESCING — one URL in flight, one download.
 * ------------------------------------------------------------------------ */

console.log('\n  two asks for one frame make one request\n');

const { fetchFrameOnce, inflightCount } = await import('../lib/imagery-cache.js');

let runs = 0;
let release;
const gate = new Promise((r) => { release = r; });
const fetcher = () => { runs++; return gate; };

const URL_A = 'https://relay.example/sat?BBOX=1,2,3,4&WIDTH=768';
const p1 = fetchFrameOnce(URL_A, fetcher);
const p2 = fetchFrameOnce(URL_A, fetcher);

eq('the second ask joins the first', runs, 1);
eq('one entry in flight', inflightCount(), 1);
ok('both callers hold the same promise', p1 === p2);

release('BYTES');
eq('both are answered', await p1, 'BYTES');
await p2;
eq('the entry clears on settle', inflightCount(), 0);

/* A FAILED FETCH MUST NOT BE PARKED. Retry is the whole recovery path for
 * imagery (map/imagery.js scheduleRetry); joining a rejected promise would
 * hand the retry the original failure without ever asking the vendor again. */
let failRuns = 0;
const failing = () => { failRuns++; return Promise.reject(new Error('HTTP 503')); };
await fetchFrameOnce(URL_A, failing).catch(() => {});
eq('a failure clears its entry', inflightCount(), 0);
await fetchFrameOnce(URL_A, failing).catch(() => {});
eq('so the retry really re-asks', failRuns, 2);

/* A throwing (not rejecting) fetcher must behave the same — the caller's
 * body is arbitrary code and one bad line must not park an entry forever. */
await fetchFrameOnce('https://relay.example/other', () => { throw new Error('boom'); })
  .catch(() => {});
eq('a synchronous throw clears too', inflightCount(), 0);

/* ------------------------------------------------------------------------ */

console.log('');
if (problems.length) {
  console.log(`✗ ${problems.length} failed:`);
  for (const p of problems) console.log(`   - ${p}`);
  process.exit(1);
}
console.log(`✓ ${passed} assertions passed`);
console.log('  (call counts only — whether it FEELS fast is a question for a phone)');
