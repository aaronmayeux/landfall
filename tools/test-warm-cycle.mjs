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
  /* ==> THE ONLY ENTRY THAT CAN REFUSE ITS OWN WRITE. <== Two areas, so the
   * `last-good` gate has something to say yes to. The gate reads a HEADER, not
   * this body — see ROUTE_HEADERS below and the genesis entry in sources.js. */
  '/api/nhc/genesis?part=areas': JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { prob7day: '70%' }, geometry: null },
      { type: 'Feature', properties: { prob7day: '20%' }, geometry: null },
    ],
  }),
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

/* What each route says ABOUT its body. Only genesis says anything today: the
 * writer's gate is driven entirely by these two headers, because the judgement
 * of what counts as a good answer stays in the route that owns it and is never
 * duplicated in the Worker. Mutable, so section 4c can make the route claim it
 * is holding. */
const ROUTE_HEADERS = {
  '/api/nhc/genesis?part=areas': { 'X-Landfall-Genesis-Areas': '2' },
};
const headersFor = (path) => ({ ...(ROUTE_HEADERS[path] || {}) });

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
  return new Response(bodyFor(path), { status: 200, headers: headersFor(path) });
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

/* ==> THE EXACT KEY SET ONE FULL CYCLE MUST PRODUCE, FROZEN, AND EVERY COUNT
 * IN THIS FILE IS DERIVED FROM IT. <== Asserting the COUNT alone would pass
 * while the Worker wrote nine keys the readers have never heard of — a check
 * that cannot fail the way you actually break things is not a check.
 *
 * It used to be an inline literal with the number 19 typed beside it in four
 * places, and adding ONE feed to `LIST_FEEDS` turned five checks in this file
 * red for no reason but arithmetic. That is the shape the palette suite was
 * fixed for: a hand-maintained count eventually gets maintained by editing the
 * number until it goes green, which is how a suite stops meaning anything. */
let EXPECTED_KEYS = [];

/* --- 2. A full first cycle writes everything. ---------------------------- */
const kv = fakeKv();
{
  requested = [];
  const summary = await warm(env(kv));

  ok('first cycle succeeds', summary.ok === true, JSON.stringify(summary));
  ok('first cycle: nothing failed', summary.failed === 0, JSON.stringify(summary.failures));

  /* 4 lists + 2 nhc adecks + 2 advisories + 1 jtwc warning + 1 gdacs geometry
   * + 2 tcgp adeck variants (guidance and analysed history, separate keys)
   * + 2 genesis keys, which are ONE fetch answering two different questions:
   *   what the layer says now, and when it last said anything at all
   * + 2 text outlooks, one per basin, which are what ARBITRATE the genesis
   *   layer when it goes empty (§45.9)
   * + 2 SHIPS runs, one per NHC storm, which color the cone (§47)
   * + 1 national NWS flood list, added with §56.17 — the `Flooding` section
   *   renders on both screens for every reader now, so the first ask on a cold
   *   edge must not be a round trip to weather.gov
   * + 1 peak storm surge list — ONE key for every storm, not one per storm,
   *   because the service is queried whole and filtered on the client (§4.8) */
  ok('first cycle: nothing capped', summary.dropped === 0);

  /* The exact key set, frozen. Asserting the COUNT alone would pass while the
   * Worker wrote nine keys the readers have never heard of — a check that
   * cannot fail the way you actually break things is not a check
   * (tools/check-syntax.mjs's own lesson, applied here). */
  const keys = [...kv.store.keys()].sort();
  EXPECTED_KEYS = [
    'v1:gdacs/events',
    `v1:gdacs/geometry/${encodeURIComponent(GEOM)}`,
    'v1:jtwc/storms',
    'v1:jtwc/warning/wp1126',
    'v1:nhc/adeck/al012026',
    'v1:nhc/adeck/ep052026',
    /* ==> THE SHIPS SLOT IS THE ATCF FILENAME'S ID, NOT THE APP'S. <== The app
     * holds `al012026`; the file is `AL0126` — upper case, two-digit year. The
     * cron and the route build that string independently, because a Worker
     * cannot import a Pages Function, and tools/test-kv-keys.mjs asserts the
     * two land on the same answer. Frozen here as well so a change to either
     * one has to be made deliberately in both places. */
    'v1:nhc/ships/AL0126',
    'v1:nhc/ships/EP0526',
    'v1:nhc/advisory/MIATCPAT1',
    'v1:nhc/advisory/MIATCPEP2',
    'v1:nhc/storms',
    /* The current season's index (§58.3). The per-storm b-decks are
     * deliberately NOT here, and their absence is the assertion: fanning out to
     * fourteen of them on a five-minute cron is 4,032 requests a day at a
     * government server for a feature nobody has opened yet. */
    'v1:seasons/live',
    'v1:tcgp/storms',
    /* TWO KEYS FROM ONE FETCH, and the SECOND one is the memory that decides
     * whether an empty outlook layer is an all-clear or an outage. */
    'v1:nhc/genesis/areas',
    'v1:nhc/genesis/areas/last-good',
    'v1:nhc/outlook/atlantic',
    'v1:nhc/outlook/epacific',
    /* ==> WARMED WITH NO `store` GATE, UNLIKE GENESIS ABOVE. <== An empty flood
     * list is the ordinary truthful answer — most hours no weather office in
     * the country has a flood product out — so holding it is correct. Genesis
     * refuses an empty answer because there "no areas" is more often a failed
     * parse than a quiet ocean. */
    'v1:nws/flood',
    /* ONE KEY FOR ALL OF SURGE, AND THE SINGULARITY IS THE ASSERTION. Every
     * other per-storm product below fans out to a key per storm. Surge does
     * not, because the Peak Storm Surge service is queried whole and filtered
     * on the client — a per-storm key here would have to be built from a
     * POSITION, and a position is not a stable identifier: the storm moves
     * between this cycle and the reader's tap, the two keys stop matching, and
     * the warm loop runs forever writing bytes nobody reads while every count
     * in this summary stays green. If a second surge key ever appears in this
     * list, that is what has happened. */
    'v1:nhc/surge',
    /* TWO KEYS FROM ONE DECK ID, and the pair is the assertion. The guidance
     * body and the analysed-history body come off the same upstream file and
     * must never share a key — a storm's past served as guidance would draw
     * its history across the map as a five-day forecast. */
    'v1:tcgp/adeck/wp112026/models',
    'v1:tcgp/adeck/wp112026/carq',
  ].sort();
  ok('first cycle: exactly the expected keys', keys, EXPECTED_KEYS);

  /* AFTER the set is frozen, never before — the count is derived from it. */
  ok('first cycle: every expected key written, and no others',
    summary.written === EXPECTED_KEYS.length,
    `written=${summary.written} expected=${EXPECTED_KEYS.length} derived=${summary.derived}`);

  console.log('  ✓ first cycle wrote:');
  for (const k of keys) console.log(`      ${k}`);

  ok('every key carries a fetchedAt stamp',
    [...kv.store.values()].every((v) => v.metadata && v.metadata.fetchedAt));
  ok('every key carries a hash',
    [...kv.store.values()].every((v) => v.metadata && v.metadata.hash));

  /* ==> AND NOTHING ELSE. <== A second "when did the content change" stamp was
   * built and removed the same day: nothing read it, and the half-built version
   * of it reached the client and put a false "feed delayed" banner over a
   * healthy relay. Asserted so it cannot quietly come back. */
  ok('metadata carries NO second stamp',
    [...kv.store.values()].every((v) => Object.keys(v.metadata).sort().join() === 'fetchedAt,hash'),
    'one stamp, one hash — a field nobody reads is the X-Landfall-Empty mistake');

  /* The bypass header is what makes a warm cycle actually reach the source. */
  ok('the Worker sends its requests to SITE_ORIGIN',
    requested.includes('/api/nhc/storms') && requested.includes('/api/gdacs/events'));
}

/* --- 3. A SECOND CYCLE RE-STAMPS EVEN THOUGH NOTHING CHANGED. ------------
 *
 * ===> THIS IS THE WHOLE FIX, AND IT IS ONE ASSERTION. <===
 * The stamp must move on EVERY successful cycle, changed bytes or not. It
 * means "when did we last reach upstream", and two things ask exactly that:
 * `kvRead`, deciding whether the warm copy is current, and the client's status
 * strip, deciding whether to say the feed is delayed.
 *
 * A stamp that only moved on a content change broke both. A 6-hourly advisory
 * against a 5-minute window was judged stale ~98% of the time so the store was
 * bypassed; and a quiet ocean's unchanging `{"activeStorms":[]}` reached the
 * client looking like ~72 consecutive failed refreshes, putting a "feed
 * delayed" banner over a healthy relay. If this assertion ever fails, both of
 * those are back. */
{
  const beforeStamps = new Map(
    [...kv.store.entries()].map(([k, v]) => [k, v.metadata.fetchedAt])
  );

  await new Promise((r) => setTimeout(r, 5)); // so a moved stamp is detectable
  const summary = await warm(env(kv));

  ok('second cycle: zero CONTENT writes on unchanged bodies', summary.written === 0,
    `written=${summary.written} — "how much weather happened" depends on this`);
  ok('second cycle: everything reported restamped',
    summary.restamped === EXPECTED_KEYS.length,
    `restamped=${summary.restamped} expected=${EXPECTED_KEYS.length}`);

  ok('an UNCHANGED body still moves the stamp',
    [...kv.store.entries()].every(
      ([k, v]) => v.metadata.fetchedAt !== beforeStamps.get(k)
    ),
    'a calm ocean is not an outage — if this holds still, the client cries wolf');

  console.log(`  ✓ second cycle: 0 content writes, ${EXPECTED_KEYS.length} restamped, every stamp moved`);
}

/* --- 4. A CHANGED BODY IS REPORTED AS A WRITE, NOT A RE-STAMP. ----------- */
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

  /* The hash is what separates the two, and that split is the only thing
   * write-if-changed still buys now that every key is put regardless. Without
   * it the cycle summary stops answering "how much weather happened". */
  ok('every other key is restamped, not written',
    summary.restamped === EXPECTED_KEYS.length - 1,
    `restamped=${summary.restamped}`);

  console.log(`  ✓ changed content: 1 write, ${EXPECTED_KEYS.length - 1} restamped — the split still reads`);
}

/* --- 4a. A HELD OUTLOOK IS NOT WARMED, AND THAT ABSENCE IS THE CLOCK. -----
 *
 * ==> THIS IS THE ONE ASSERTION IN THIS FILE WHOSE FAILURE IS SILENT AND
 * PERMANENT. <==
 *
 * When NHC's outlook layer answers 200 with nothing, the relay serves the last
 * real answer instead — the areas it saw an hour ago, stamped with their own
 * age. That hold is supposed to lapse after one outlook cycle, so a genuine
 * all-clear can still get through.
 *
 * `kv.js` re-stamps `fetchedAt` on EVERY cycle whether the bytes changed or
 * not, deliberately, for reasons written up in that file. So if a held body
 * were written back here, the held answer would restamp its own age every five
 * minutes: it would never grow older, HELD_SECONDS would never elapse, and the
 * app would show those areas until somebody noticed months later. Nothing
 * would error. Every count in the summary would look healthy. It would read
 * exactly like the feature working.
 *
 * The hold's clock IS the absence of these writes. That is what this pins.
 * ------------------------------------------------------------------------- */
{
  const GENESIS = '/api/nhc/genesis?part=areas';
  const before = {
    main: kv.store.get('v1:nhc/genesis/areas').metadata.fetchedAt,
    lastGood: kv.store.get('v1:nhc/genesis/areas/last-good').metadata.fetchedAt,
  };

  /* The route now says: NHC answered empty, so this body is remembered, not
   * current. Exactly the headers functions/api/nhc/genesis.js puts on the
   * wire when the held branch fires. */
  ROUTE_HEADERS[GENESIS] = {
    'X-Landfall-Genesis-Areas': '2',
    'X-Landfall-Held': 'upstream-empty',
    'X-Landfall-Stale': 'true',
  };

  await new Promise((r) => setTimeout(r, 5)); // a moved stamp would be detectable
  const summary = await warm(env(kv));

  ok('a held outlook is withheld from BOTH keys', summary.withheldPaths, [
    'nhc/genesis/areas',
    'nhc/genesis/areas/last-good',
  ]);
  ok('the memory does not restamp itself — this is the whole clock',
    kv.store.get('v1:nhc/genesis/areas/last-good').metadata.fetchedAt === before.lastGood,
    'if this moves, HELD_SECONDS never elapses and the hold becomes permanent');
  ok('and neither does the main key',
    kv.store.get('v1:nhc/genesis/areas').metadata.fetchedAt === before.main);
  ok('a withheld write is not a failure', summary.failed === 0);
  ok('and not a skip — a skip is an empty body, this is a full one we chose not to store',
    summary.skipped === 0, `skipped=${summary.skipped}`);
  /* Two keys withheld (the genesis pair), so the rest of the cycle is the
   * frozen set minus those two. Derived, not typed — see EXPECTED_KEYS. */
  ok('the rest of the cycle is untouched',
    summary.restamped === EXPECTED_KEYS.length - 2,
    `restamped=${summary.restamped} expected=${EXPECTED_KEYS.length - 2}`);

  /* AND A GENUINE ALL-CLEAR MUST STILL REACH THE STORE. Zero areas, no held
   * marker: NHC really is watching nothing, which is the correct answer for
   * most of the year. The main key takes it; the last-good memory must not,
   * or it would remember having no memory and the next outage would have
   * nothing to hold. */
  ROUTE_HEADERS[GENESIS] = { 'X-Landfall-Genesis-Areas': '0' };
  ROUTE_BODIES[GENESIS] = JSON.stringify({ type: 'FeatureCollection', features: [] });

  await new Promise((r) => setTimeout(r, 5));
  const allClear = await warm(env(kv));

  ok('a true all-clear IS warmed', allClear.withheldPaths, ['nhc/genesis/areas/last-good']);
  ok('the main key takes the all-clear',
    kv.store.get('v1:nhc/genesis/areas').metadata.fetchedAt !== before.main);
  ok('the last-good memory still holds the areas it saw',
    JSON.parse(kv.store.get('v1:nhc/genesis/areas/last-good').value).features.length === 2);

  console.log('  ✓ held outlook: withheld from both keys, and the memory keeps its age');
}

/* --- 4b. AN EMPTY BODY IS SKIPPED, AND THE SUMMARY SAYS WHICH ONE. -------
 *
 * A route answering 200 with nothing is refused storage — caching an empty
 * payload globally is worse than one colo missing. But refusing to store it
 * means that key silently keeps whatever it held last, and a bare `skipped: 1`
 * across nineteen keys does not say which one went dark. `skippedPaths` is
 * what makes that number actionable, exactly as `failures` does for a throw. */
{
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname + new URL(String(url)).search;
    /* A LEAF route, deliberately. Emptying a LIST feed would also collapse
     * everything derived from it, and this case is about the skip being named
     * — not about a cascade. */
    if (path === '/api/jtwc/warning?product=wp1126') return new Response('');
    return new Response(bodyFor(path));
  };

  const summary = await warm(env(kv));

  ok('an empty body is skipped, not stored', summary.skipped === 1,
    `skipped=${summary.skipped}`);
  ok('the skipped entry is NAMED', summary.skippedPaths, ['jtwc/warning/wp1126']);
  ok('a skip is not counted as a failure', summary.failed === 0,
    `failed=${summary.failed} — a 200 with an empty body is not a throw`);
  ok('a skip does not fail the cycle', summary.ok === true);
  console.log('  ✓ empty body: skipped, named, and the cycle carries on');

  globalThis.fetch = original;
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
