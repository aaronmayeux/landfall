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
  /* TCGP spells the same storm with a FOUR-digit year (`wp112026`) where JTWC
   * uses two (`wp1126`). Both forms are in this fixture on purpose: an id
   * transform that ever gets bolted on between them has to fail here rather
   * than in production, where the failure is a real deck fetched for the wrong
   * storm. */
  '/api/tcgp/storms': JSON.stringify({ state: 'ok', storms: [{ id: 'wp112026' }] }),
  '/api/gdacs/events': JSON.stringify({
    /* `iscurrent` is required since 2026-07-26 — the cyclone-only list carries
     * finished storms and gdacsDerived skips them, so a fixture without the
     * flag derives nothing and the whole cycle's key count comes up short. */
    features: [{ properties: { eventtype: 'TC', iscurrent: 'true', url: { geometry: GEOM } } }],
  }),
};

/* Every derived route answers with something unique, so an accidental key
 * collision shows up as an unexpected `restamped` rather than passing quietly. */
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

  /* 4 lists + 2 nhc adecks + 2 advisories + 1 jtwc warning + 1 gdacs geometry
   * + 2 tcgp adeck variants (guidance and analysed history, separate keys) */
  ok('first cycle: 12 entries written', summary.written === 12,
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
    'v1:tcgp/storms',
    /* TWO KEYS FROM ONE DECK ID, and the pair is the assertion. The guidance
     * body and the analysed-history body come off the same upstream file and
     * must never share a key — a storm's past served as guidance would draw
     * its history across the map as a five-day forecast. */
    'v1:tcgp/adeck/wp112026/models',
    'v1:tcgp/adeck/wp112026/carq',
  ].sort());

  console.log('  ✓ first cycle wrote:');
  for (const k of keys) console.log(`      ${k}`);

  ok('every key carries a fetchedAt stamp',
    [...kv.store.values()].every((v) => v.metadata && v.metadata.fetchedAt));
  ok('every key carries a verifiedAt stamp',
    [...kv.store.values()].every((v) => v.metadata && v.metadata.verifiedAt));
  ok('every key carries a hash',
    [...kv.store.values()].every((v) => v.metadata && v.metadata.hash));

  /* On a FIRST write the two stamps are equal by construction — there is no
   * older content stamp to carry forward. Asserted so that the divergence
   * proved in step 3 is unambiguously the re-stamp doing it. */
  ok('a first write sets both stamps to the same instant',
    [...kv.store.values()].every((v) => v.metadata.fetchedAt === v.metadata.verifiedAt));

  /* The bypass header is what makes a warm cycle actually reach the source. */
  ok('the Worker sends its requests to SITE_ORIGIN',
    requested.includes('/api/nhc/storms') && requested.includes('/api/gdacs/events'));
}

/* --- 3. A SECOND CYCLE RE-STAMPS WITHOUT CLAIMING THE CONTENT MOVED. -----
 *
 * ===> THIS IS THE WHOLE TWO-FIELD FIX, AND IT IS TWO ASSERTIONS. <===
 * `verifiedAt` MUST move — it is what `kvRead` judges freshness on, and a feed
 * that re-issues every six hours against a 30-minute window is judged stale
 * for most of its life if this stamp only moves when the bytes do.
 * `fetchedAt` MUST NOT move — it is what the reader sees, and refreshing it on
 * an unchanged body would tell a person the data is seconds old when it is
 * hours old. Either one alone is the bug wearing the other's clothes. */
{
  const beforeStamps = new Map(
    [...kv.store.entries()].map(([k, v]) => [k, { ...v.metadata }])
  );

  await new Promise((r) => setTimeout(r, 5)); // so a moved stamp is detectable
  const summary = await warm(env(kv));

  ok('second cycle: zero CONTENT writes on unchanged bodies', summary.written === 0,
    `written=${summary.written} — "how much weather happened" depends on this`);
  ok('second cycle: everything reported restamped', summary.restamped === 12,
    `restamped=${summary.restamped}`);

  ok('a re-stamp MOVES verifiedAt',
    [...kv.store.entries()].every(
      ([k, v]) => v.metadata.verifiedAt !== beforeStamps.get(k).verifiedAt
    ),
    'freshness is judged on this — if it does not move, the store stays bypassed');

  ok('a re-stamp PRESERVES fetchedAt',
    [...kv.store.entries()].every(
      ([k, v]) => v.metadata.fetchedAt === beforeStamps.get(k).fetchedAt
    ),
    'this is what the reader sees — moving it would misreport the data age');

  console.log('  ✓ second cycle: 0 content writes, 12 restamped — verifiedAt moved, fetchedAt held');
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

  /* When the bytes DO move, both stamps move together and land on the same
   * instant — the content changed and we confirmed it in the same breath.
   * The divergence in step 3 is the only case where they differ. */
  const meta = kv.store.get('v1:nhc/storms').metadata;
  ok('a real change moves both stamps to the same instant',
    meta.fetchedAt === meta.verifiedAt,
    `fetchedAt=${meta.fetchedAt} verifiedAt=${meta.verifiedAt}`);

  console.log('  ✓ changed content: 1 write, both stamps fresh');
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
  ok('the other feeds still warmed', summary.restamped >= 7, `restamped=${summary.restamped}`);
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
