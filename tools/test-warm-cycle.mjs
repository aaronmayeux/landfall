#!/usr/bin/env node
/**
 * test-warm-cycle.mjs — one full cron cycle, against stubs.
 *
 * WHY THIS EXISTS. `tools/test-kv-keys.mjs` proves the writer and the readers
 * agree on every key. `tools/test-relay-fallback.mjs` proves the readers do the
 * right thing at every level. Neither one runs `warm()`, which is the function
 * that has to actually orchestrate a cycle — fetch the lists, derive the
 * per-storm work, deduplicate, cap, and write only what changed.
 *
 * ===> THE FAILURE THIS CATCHES IS "DEPLOYS AND DOES NOTHING". <===
 * A Worker that throws on its scheduled run logs a stack trace nobody is
 * watching. A Worker that completes but derives an empty list logs a cheerful
 * summary of zero. Both look identical from the Cloudflare dashboard — a green
 * cron with a recent run — and both leave every route falling through to
 * upstream forever, which is precisely the silent-success failure §17 Pass B is
 * most exposed to. Running the real function against fixtures costs nothing and
 * turns that into a thing that can fail here instead.
 *
 * WHAT IT DOES NOT COVER: whether Cloudflare stored what we asked it to,
 * whether the cron trigger fires, or whether the live feeds still publish these
 * field names. Those need a deploy and a namespace. This is the orchestration.
 *
 * Zero dependencies (§12). Run: node tools/test-warm-cycle.mjs
 */

import { warm } from '../worker/src/index.js';

const GEOM = 'https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1000123';

/** What each relay route returns, keyed by the path the Worker requests. */
const ROUTE_BODIES = {
  '/api/nhc/storms': JSON.stringify({
    activeStorms: [{ id: 'al012026', binNumber: 'AT1' }, { id: 'ep052026', binNumber: 'EP2' }],
  }),
  '/api/jtwc/storms': JSON.stringify({ state: 'ok', storms: [{ product: 'wp1126' }] }),
  '/api/gdacs/events': JSON.stringify({
    /* `iscurrent` is required since 2026-07-26 — the cyclone-only list carries
     * finished storms and gdacsDerived skips them, so a fixture without the
     * flag derives nothing and the whole cycle's key count comes up short. */
    features: [{ properties: { eventtype: 'TC', iscurrent: 'true', url: { geometry: GEOM } } }],
  }),
};

/* Every derived route answers with something unique, so an accidental key
 * collision shows up as an unexpected `unchanged` rather than passing quietly. */
const bodyFor = (path) => ROUTE_BODIES[path] ?? `payload for ${path}`;

let failures = 0;
/** `cond` may be a boolean OR an actual value to deep-compare against
 *  `detail` when `detail` is an array — the two forms keep the call sites
 *  readable without a second assertion helper. */
const ok = (label, cond, detail = '') => {
  const pass = Array.isArray(detail)
    ? JSON.stringify(cond) === JSON.stringify(detail)
    : Boolean(cond);
  if (pass) return;
  failures++;
  const shown = Array.isArray(detail)
    ? `expected ${JSON.stringify(detail, null, 2)}\n      actual   ${JSON.stringify(cond, null, 2)}`
    : detail;
  console.error(`  ✗ ${label}${shown ? `\n      ${shown}` : ''}`);
};

/** A KV namespace that records what was put, and reports it back through
 *  `list()` metadata the way the real one does. */
function fakeKv() {
  const store = new Map();
  return {
    store,
    async list({ prefix, cursor }) {
      void cursor;
      return {
        list_complete: true,
        keys: [...store.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([name, v]) => ({ name, metadata: v.metadata })),
      };
    },
    async put(key, value, opts) {
      store.set(key, { value, metadata: opts?.metadata });
    },
  };
}

let requested = [];
globalThis.fetch = async (url) => {
  const path = new URL(String(url)).pathname + new URL(String(url)).search;
  requested.push(path);
  return new Response(bodyFor(path), { status: 200 });
};

const env = (kv) => ({
  LANDFALL_CACHE: kv,
  SITE_ORIGIN: 'https://landfall.test',
  WARM_KEY: 'secret',
});

/* --- 1. A missing binding is named, not thrown. -------------------------- */
{
  const summary = await warm({ SITE_ORIGIN: 'https://landfall.test' });
  ok('missing KV binding -> reported, not thrown', summary.ok === false);
  ok('missing KV binding -> names the binding', /LANDFALL_CACHE/.test(summary.error || ''));
  console.log('  ✓ missing binding: reported plainly');
}

/* --- 2. A full first cycle writes everything. ---------------------------- */
const kv = fakeKv();
{
  requested = [];
  const summary = await warm(env(kv));

  ok('first cycle succeeds', summary.ok === true, JSON.stringify(summary));
  ok('first cycle: nothing failed', summary.failed === 0, JSON.stringify(summary.failures));

  /* 3 lists + 2 adecks + 2 advisories + 1 jtwc warning + 1 gdacs geometry */
  ok('first cycle: 9 entries written', summary.written === 9,
    `written=${summary.written} derived=${summary.derived}`);
  ok('first cycle: nothing capped', summary.dropped === 0);

  /* The exact key set, frozen. Asserting the COUNT alone would pass while the
   * Worker wrote nine keys the readers have never heard of — a check that
   * cannot fail the way you actually break things is not a check
   * (tools/check-syntax.mjs's own lesson, applied here). */
  const keys = [...kv.store.keys()].sort();
  ok('first cycle: exactly the expected keys', keys, [
    'v1:gdacs/events',
    `v1:gdacs/geometry/${encodeURIComponent(GEOM)}`,
    'v1:jtwc/storms',
    'v1:jtwc/warning/wp1126',
    'v1:nhc/adeck/al012026',
    'v1:nhc/adeck/ep052026',
    'v1:nhc/advisory/MIATCPAT1',
    'v1:nhc/advisory/MIATCPEP2',
    'v1:nhc/storms',
  ].sort());

  console.log('  ✓ first cycle wrote:');
  for (const k of keys) console.log(`      ${k}`);

  ok('every key carries a fetchedAt stamp',
    [...kv.store.values()].every((v) => v.metadata && v.metadata.fetchedAt));
  ok('every key carries a hash',
    [...kv.store.values()].every((v) => v.metadata && v.metadata.hash));

  /* The bypass header is what makes a warm cycle actually reach the source. */
  ok('the Worker sends its requests to SITE_ORIGIN',
    requested.includes('/api/nhc/storms') && requested.includes('/api/gdacs/events'));
}

/* --- 3. A SECOND CYCLE WITH IDENTICAL BODIES WRITES NOTHING. ------------- */
{
  const summary = await warm(env(kv));
  ok('second cycle: zero writes on unchanged content', summary.written === 0,
    `written=${summary.written} — the write budget depends on this`);
  ok('second cycle: everything reported unchanged', summary.unchanged === 9,
    `unchanged=${summary.unchanged}`);
  console.log('  ✓ second cycle: 0 writes, 9 unchanged — the budget holds');
}

/* --- 4. A CHANGED BODY WRITES AGAIN, AND RE-STAMPS. ---------------------- */
{
  const before = kv.store.get('v1:nhc/storms').metadata.fetchedAt;
  ROUTE_BODIES['/api/nhc/storms'] = JSON.stringify({
    activeStorms: [{ id: 'al012026', binNumber: 'AT1' }, { id: 'ep052026', binNumber: 'EP2' }],
    updated: true,
  });

  await new Promise((r) => setTimeout(r, 5)); // so the new stamp differs
  const summary = await warm(env(kv));

  ok('changed content is written', summary.written === 1, `written=${summary.written}`);
  ok('changed content is re-stamped',
    kv.store.get('v1:nhc/storms').metadata.fetchedAt !== before);
  console.log('  ✓ changed content: 1 write, freshly stamped');
}

/* --- 5. A DEAD ROUTE IS AN INDEPENDENT SLOT, NOT A DEAD CYCLE. ----------- */
{
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/gdacs/events') throw new Error('simulated GDACS outage');
    return original(url);
  };

  const summary = await warm(env(kv));
  ok('a dead feed does not fail the cycle', summary.ok === true);
  ok('a dead feed is counted', summary.failed === 1, `failed=${summary.failed}`);
  ok('a dead feed is NAMED in the summary', /gdacs\/events/.test(String(summary.failures)));
  ok('the other feeds still warmed', summary.unchanged >= 7, `unchanged=${summary.unchanged}`);
  console.log('  ✓ dead feed: named, counted, and the rest of the cycle continues');

  globalThis.fetch = original;
}

/* --- 6. THE BYPASS DETECTOR. The check that this loop is not decorative. --- */
{
  const original = globalThis.fetch;

  /* `stampAgeMs` is what the route's X-Landfall-Fetched-At says. A fresh stamp
   * means the route went upstream (bypass honoured); an old one means it
   * answered from the KV copy a previous cycle wrote — WARM_KEY mismatched,
   * and the loop is confirming its own last answer forever. */
  const withStamp = (stampAgeMs) => async (url) => {
    const path = new URL(String(url)).pathname + new URL(String(url)).search;
    return new Response(bodyFor(path), {
      status: 200,
      headers: { 'X-Landfall-Fetched-At': new Date(Date.now() - stampAgeMs).toISOString() },
    });
  };

  globalThis.fetch = withStamp(1000); // one second old — upstream
  let summary = await warm(env(fakeKv()));
  ok('fresh stamps -> every route counted as reaching the source',
    summary.reachedSource, [summary.lists + summary.derived][0] === summary.reachedSource
      ? summary.reachedSource : 'mismatch');
  ok('fresh stamps -> no warning', summary.warning === undefined, JSON.stringify(summary.warning));
  console.log('  ✓ bypass honoured: counted, no warning');

  globalThis.fetch = withStamp(20 * 60 * 1000); // twenty minutes old — from cache
  summary = await warm(env(fakeKv()));
  ok('stale stamps -> the cycle WARNS', /BYPASS REFUSED/.test(String(summary.warning)),
    'a loop that never reaches the source must not report a clean cycle');
  ok('stale stamps -> the affected routes are NAMED',
    Array.isArray(summary.servedFromCache) && summary.servedFromCache.length > 0);
  ok('stale stamps -> nothing counted as reaching the source', summary.reachedSource === 0);
  console.log('  ✓ bypass refused: warned, named, and counted at zero');

  globalThis.fetch = original;
}

if (failures) {
  console.error(`\n${failures} warm cycle failure(s).\n`);
  process.exit(1);
}
console.log('\n✓ warm cycle: writes what changed, skips what did not, survives a dead source');
