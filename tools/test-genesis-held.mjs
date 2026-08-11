#!/usr/bin/env node
/**
 * test-genesis-held.mjs — an empty outlook layer is not an all-clear.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-genesis-held.mjs`.
 *
 * ==> THIS SUITE EXISTS BECAUSE THE APP SHIPPED A FALSE ALL-CLEAR. <==
 *
 * 2026-08-11, measured three ways within twenty minutes of each other:
 *
 *   NHC text product (ABNT20 KNHC 101744)  three Atlantic areas, one at 60%
 *   NHC public GTWO graphic                three Atlantic areas, one RED
 *   NHC GIS layer 3, which we read         {"count": 0}
 *
 * Landfall rendered the third one and said "Nothing being watched right now"
 * while the National Hurricane Center was publishing a high-chance development
 * area. The source was up. It answered 200. It was simply wrong.
 *
 * THE STRUCTURAL REASON IT COULD NOT BE CAUGHT DOWNSTREAM: an empty
 * FeatureCollection is UNSTAMPED. A populated response carries `idp_source`
 * ("gtwo_areas_202608101750") and `idp_filedate`; an empty one carries
 * nothing at all. So "NHC is watching nothing" and "NHC's layer is broken"
 * are byte-identical, and no parser, no matter how careful, can separate them.
 * The only thing that distinguishes them is what was on the wire an hour ago.
 *
 * So the relay remembers, and this suite pins the remembering.
 *
 * WHAT IT CANNOT PROVE: that Cloudflare's `caches.default` behaves the way the
 * fake below does under real edge conditions. The cache is stubbed. What is
 * proven is the DECISION — which body goes out, with which headers, for each
 * combination of upstream answer and memory.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { onRequestGet } = await import('../functions/api/nhc/genesis.js');

/* ---------------------------------------------------------------------------
 * FIXTURES — the real bytes, from origin/archive.
 * ------------------------------------------------------------------------- */

/** Three Atlantic + three Pacific areas, verbatim shape from the 17:50Z
 *  issuance. Trimmed to properties: the held decision never reads geometry. */
const POPULATED = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { basin: 'Atlantic', prob2day: '20%', risk2day: 'Low', prob7day: '60%', risk7day: 'Medium', idp_source: 'gtwo_areas_202608101750' }, geometry: null },
    { type: 'Feature', properties: { basin: 'Atlantic', prob2day: '10%', risk2day: 'Low', prob7day: '10%', risk7day: 'Low', idp_source: 'gtwo_areas_202608101750' }, geometry: null },
    { type: 'Feature', properties: { basin: 'Pacific', prob2day: '50%', risk2day: 'Medium', prob7day: '90%', risk7day: 'High', idp_source: 'gtwo_areas_202608101750' }, geometry: null },
  ],
});

/** EXACTLY what layer 3 returned at 02:17Z. Forty-two bytes, no stamp. */
const EMPTY = '{"type":"FeatureCollection","features":[]}';

/* --- a fake Cloudflare cache and fetch ------------------------------------ */

function makeCache() {
  const store = new Map();
  return {
    store,
    async match(req) {
      const r = store.get(req.url);
      return r ? r.clone() : undefined;
    },
    async put(req, res) {
      store.set(req.url, res.clone());
    },
  };
}

function install({ upstreamBody, upstreamStatus = 200 }) {
  const cache = makeCache();
  globalThis.caches = { default: cache };
  upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls++;
    return new Response(upstreamBody, {
      status: upstreamStatus,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return cache;
}

/** Counted, because two of the checks below are about a request that must NOT
 *  happen: a warm KV copy has to be served without touching NHC, and a warm
 *  cycle has to touch NHC every time. */
let upstreamCalls = 0;

/* --- a fake KV namespace -------------------------------------------------- *
 *
 * ==> THIS IS THE MEMORY THAT WAS MISSING, AND ITS ABSENCE IS WHY THE FIX
 * SHIPPED AND DID NOT WORK. <== `caches.default` above is per-datacentre.
 * MEASURED on the archive branch: at 04:26Z on 2026-08-11, ninety minutes
 * AFTER the held branch went live, this route served 42 bytes of empty
 * FeatureCollection with no held marker on it, while NHC's own text product
 * listed three Atlantic areas and one of them at 70%. The logic was right and
 * the colo it ran in had never seen a real answer, so there was nothing to
 * hold. Everything below drives the route with the colo cache COLD, which is
 * the state most of the 300+ colos are in most of the time.
 *
 * Shaped like the real binding: `getWithMetadata` returning `{value, metadata}`
 * and nothing else, because that is the whole surface `_kv-cache.js` uses. */
function makeKv(entries = {}) {
  return {
    store: new Map(Object.entries(entries)),
    async getWithMetadata(key) {
      const e = this.store.get(key);
      return e ? { value: e.body, metadata: { fetchedAt: e.fetchedAt } } : { value: null };
    },
  };
}

const KV_LAST_GOOD = 'v1:nhc/genesis/areas/last-good';

const minsAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();

const ctx = (env) => ({
  request: {
    url: 'https://landfall.getgravitate.app/api/nhc/genesis?part=areas',
    headers: { get: (k) => (env && env.__warmHeader && k === 'X-Landfall-Warm' ? env.WARM_KEY : null) },
  },
  env,
  waitUntil: (p) => p,
});

const read = async (res) => ({
  status: res.status,
  body: await res.text(),
  stale: res.headers.get('X-Landfall-Stale'),
  held: res.headers.get('X-Landfall-Held'),
  fetchedAt: res.headers.get('X-Landfall-Fetched-At'),
  areas: res.headers.get('X-Landfall-Genesis-Areas'),
  path: res.headers.get('X-Landfall-Cache'),
  upstream: res.headers.get('X-Landfall-Upstream'),
});

/* ---------------------------------------------------------------------------
 * 1. THE ORDINARY PATH IS UNCHANGED
 * ------------------------------------------------------------------------- */

section('A populated answer passes straight through');

{
  install({ upstreamBody: POPULATED });
  const r = await read(await onRequestGet(ctx()));
  ok(r.body === POPULATED, 'a populated response is returned verbatim');
  ok(r.stale !== 'true', 'and is NOT marked stale');
  ok(r.held == null || r.held === '', 'and is NOT marked held');
  ok(JSON.parse(r.body).features.length === 3, 'all three areas survive');
}

section('An empty answer with NO memory is believed — a real all-clear');

{
  install({ upstreamBody: EMPTY });
  const r = await read(await onRequestGet(ctx()));
  ok(r.body === EMPTY, 'with nothing remembered, empty is served as-is');
  ok(r.stale !== 'true', 'and is not dressed up as stale');
  /* THE ALL-CLEAR MUST STILL BE REACHABLE. Most of the year NHC watches
   * nothing, and a fix for a false all-clear that makes a TRUE one impossible
   * has just moved the lie. */
  ok(JSON.parse(r.body).features.length === 0, 'a genuine all-clear still gets through');
}

/* ---------------------------------------------------------------------------
 * 2. THE NIGHT THIS WAS WRITTEN FOR
 * ------------------------------------------------------------------------- */

section('Six areas, then zero — the 2026-08-11 transition');

{
  /* First poll: the 17:50Z outlook lands and is remembered. */
  const cache = install({ upstreamBody: POPULATED });
  await onRequestGet(ctx());

  /* ==> THE REMEMBERED STAMP IS PINNED TO A KNOWN VALUE, AND IT HAS TO BE.
   * <== The first version of this asserted only that the held response
   * carried something ISO-shaped, which is true of `new Date().toISOString()`
   * as well — so a mutation stamping the held body with NOW passed. The whole
   * point of the branch is that the age is the OLD one; the test has to be
   * able to see the difference. */
  const KNOWN = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  const lgKey = 'https://landfall-relay.internal/nhc/genesis/areas/last-good';
  const lg = cache.store.get(lgKey);
  cache.store.set(
    lgKey,
    new Response(await lg.clone().text(), { headers: { 'X-Landfall-Fetched-At': KNOWN } })
  );

  /* Second poll: NHC's layer answers 200 with nothing. Drop the fresh copy so
   * the request actually reaches upstream, exactly as it would fifteen
   * minutes later. */
  cache.store.delete('https://landfall-relay.internal/nhc/genesis/areas/fresh');
  globalThis.fetch = async () => new Response(EMPTY, { status: 200 });

  const r = await read(await onRequestGet(ctx()));

  ok(
    JSON.parse(r.body).features.length === 3,
    'THE HEADLINE: the three areas are still served when the layer goes empty — ' +
      `got ${JSON.parse(r.body).features.length}`
  );
  ok(r.stale === 'true', 'and the response says it is stale');
  ok(r.held === 'upstream-empty', 'and says WHY it is being held');
  ok(
    r.fetchedAt === KNOWN,
    'and carries the ORIGINAL fetch time, not the moment it was re-served — ' +
      'the client can only say "from 90 minutes ago" if this is the old stamp. ' +
      `Expected ${KNOWN}, got ${r.fetchedAt}`
  );
}

section('The caveat survives the next fifteen minutes of cache hits');

{
  const cache = install({ upstreamBody: POPULATED });
  await onRequestGet(ctx());
  cache.store.delete('https://landfall-relay.internal/nhc/genesis/areas/fresh');
  globalThis.fetch = async () => new Response(EMPTY, { status: 200 });
  const first = await read(await onRequestGet(ctx()));

  /* Now a plain cache hit — no upstream call at all. */
  globalThis.fetch = async () => {
    throw new Error('upstream must not be called on a fresh hit');
  };
  const second = await read(await onRequestGet(ctx()));

  ok(second.body === first.body, 'the cache hit serves the same held body');
  ok(
    second.stale === 'true' && second.held === 'upstream-empty',
    'AND KEEPS THE MARKERS. A caveat that survives one request and evaporates ' +
      'for the next fifteen minutes is worse than no caveat at all'
  );
  ok(second.fetchedAt === first.fetchedAt, 'the age does not reset on a cache hit');
}

section('Past one outlook cycle, the emptiness is believed');

{
  const cache = install({ upstreamBody: POPULATED });
  await onRequestGet(ctx());

  /* Age the remembered answer past HELD_SECONDS by rewriting its stamp. A
   * forecaster has had a full turn and published nothing. */
  const key = 'https://landfall-relay.internal/nhc/genesis/areas/last-good';
  const old = cache.store.get(key);
  const oldBody = await old.clone().text();
  cache.store.set(
    key,
    new Response(oldBody, {
      headers: {
        'X-Landfall-Fetched-At': new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
      },
    })
  );
  cache.store.delete('https://landfall-relay.internal/nhc/genesis/areas/fresh');
  globalThis.fetch = async () => new Response(EMPTY, { status: 200 });

  const r = await read(await onRequestGet(ctx()));
  /* ==> PAST SIX HOURS THE MEMORY IS OFFERED, NOT ASSERTED, AND THE MARKER IS
   * THE WHOLE DIFFERENCE. <== It used to be dropped here and the empty answer
   * served, which was right while nothing could tell a broken layer from an
   * empty sky. `lib/outlook.js` can now, so the route stops deciding: it hands
   * over the memory under a name that means "only if you have a reason", and
   * `data/genesis.js` drops it unless a bulletin says the layer is wrong.
   *
   * THE ALL-CLEAR IS STILL REACHABLE. It moved one file, from the edge to the
   * browser — proven in `tools/test-genesis.mjs`, where a lapsed hold with no
   * supporting bulletin comes out `none_matched`. */
  ok(
    r.held === 'upstream-empty-lapsed',
    `seven hours on, the memory is OFFERED under its own marker, not asserted — got ${JSON.stringify(r.held)}`
  );
  ok(
    JSON.parse(r.body).features.length === 3,
    'the areas ride along so the client CAN draw them if the text outlook '
    + 'backs it — a marker with no payload behind it decides nothing'
  );
  ok(
    r.held !== 'upstream-empty',
    'AND IT IS NOT THE ASSERTED MARKER. A client that has never heard of '
    + '`-lapsed` must fall through to the old behaviour, not be handed a '
    + 'six-hour-rule answer wearing the six-hour rule\u2019s name'
  );
}

section('Past a full day even a remembered answer is let go');

{
  const cache = install({ upstreamBody: POPULATED });
  await onRequestGet(ctx());
  const key = 'https://landfall-relay.internal/nhc/genesis/areas/last-good';
  const old25 = cache.store.get(key);
  const body25 = await old25.clone().text();
  cache.store.set(
    key,
    new Response(body25, {
      headers: {
        'X-Landfall-Fetched-At': new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      },
    })
  );
  cache.store.delete('https://landfall-relay.internal/nhc/genesis/areas/fresh');
  globalThis.fetch = async () => new Response(EMPTY, { status: 200 });

  const r = await read(await onRequestGet(ctx()));
  ok(
    r.body === EMPTY,
    'a day on, the memory is neither asserted nor offered — a genesis area is a '
    + 'forecast about the next few days and a day-old one is a historical note'
  );
  ok(r.held == null || r.held === '', 'with no marker on it at all');
}

/* ---------------------------------------------------------------------------
 * 2b. THE GLOBAL MEMORY — the half that was missing.
 *
 * Everything in section 2 drives the route with a WARM COLO. That is the happy
 * datacentre, and it is the minority. These run with the colo cache cold and
 * the memory only in KV, which is the shape of the request that actually
 * shipped a false all-clear on 2026-08-11.
 * ------------------------------------------------------------------------- */

const KV_MAIN = 'v1:nhc/genesis/areas';

section('A cold colo with a warm global memory holds — this is the 04:26Z case');

{
  install({ upstreamBody: EMPTY });
  const env = {
    LANDFALL_CACHE: makeKv({
      [KV_LAST_GOOD]: { body: POPULATED, fetchedAt: minsAgo(95) },
    }),
  };
  const r = await read(await onRequestGet(ctx(env)));
  ok(r.body === POPULATED, 'the areas come back even though this colo never saw them');
  ok(r.stale === 'true', 'and they are marked stale');
  ok(r.held === 'upstream-empty', 'and marked held, so the client can say the layer stopped');
  /* NOT `startsWith` on a prefix, and NOT tolerant of a missing stamp. Both
   * shortcuts pass against a route that stamps `now()`, which is the exact
   * mutation this assertion exists to catch — and one of this suite's earlier
   * assertions shipped with that hole in it. The age is measured. */
  const heldAgeMin = (Date.now() - Date.parse(r.fetchedAt)) / 60000;
  ok(heldAgeMin > 90 && heldAgeMin < 100,
    `stamped when NHC last answered (~95 min ago), not now — got ${Math.round(heldAgeMin)} min`);
  ok(r.areas === '3', 'and the count describes the body being sent, for the writer\u2019s gate');
}

section('The global memory expires on the same clock as the local one');

{
  install({ upstreamBody: EMPTY });
  const env = {
    LANDFALL_CACHE: makeKv({
      [KV_LAST_GOOD]: { body: POPULATED, fetchedAt: minsAgo(7 * 60) },
    }),
  };
  const r = await read(await onRequestGet(ctx(env)));
  ok(
    r.held === 'upstream-empty-lapsed',
    'the global memory crosses the same boundary as the local one and gets the '
    + `same marker — got ${JSON.stringify(r.held)}`
  );
  ok(
    JSON.parse(r.body).features.length === 3,
    'carrying its areas, for the client to accept or drop on the evidence'
  );
}

/* ---------------------------------------------------------------------------
 * THE GUARDS A MUTATION RUN FOUND NAKED
 *
 * ==> THREE OF THIS SUITE'S ASSERTIONS WERE PROVING SOMETHING ELSE. <== Found
 * by breaking `functions/api/nhc/genesis.js` one guard at a time and
 * re-running: three mutations left every assertion green. All three are §5
 * failures — each one turns a remembered answer or a refused query into
 * something that reads as an empty sky.
 * ------------------------------------------------------------------------- */

section('An empty answer never becomes the memory of having had areas');

{
  const cache = install({ upstreamBody: EMPTY });
  await onRequestGet(ctx());
  const stored = cache.store.get('https://landfall-relay.internal/nhc/genesis/areas/last-good');
  ok(
    stored == null,
    'AN EMPTY ANSWER IS REFUSED AS LAST-GOOD. That key answers exactly one '
    + 'question — when did NHC last publish AREAS — and an empty body in it '
    + 'would make the memory remember having no memory: a held response '
    + 'serving zero areas while wearing a held badge, which is a false '
    + 'all-clear with a caveat attached'
  );
}

{
  /* And the same on the other side of the wire: the cron's gate reads the
   * count header, so the two halves have to agree about what "good" means. */
  const src = fs.readFileSync('worker/src/sources.js', 'utf8');
  ok(
    /lastGood:[\s\S]{0,400}Number\(h\.get\('X-Landfall-Genesis-Areas'\)\) > 0/.test(src),
    'and the cron refuses to write it globally for the same reason, off the '
    + 'count the route states on the wire'
  );
}

section('A memory stamped in the future is not a fresh memory');

{
  install({ upstreamBody: EMPTY });
  const env = {
    LANDFALL_CACHE: makeKv({
      [KV_LAST_GOOD]: { body: POPULATED, fetchedAt: minsAgo(-6 * 60) },
    }),
  };
  const r = await read(await onRequestGet(ctx(env)));
  ok(
    r.body === EMPTY,
    'A NEGATIVE AGE IS NOT A YOUNG AGE. A stamp six hours in the future passes '
    + 'every "is it older than" test there is, and a memory that can never '
    + 'grow old is a hold that never lapses — the exact freeze the writer\u2019s '
    + 'withhold gate exists to prevent, arriving through the other door'
  );
}

section('ArcGIS reports failure as 200 with an error body, and it is forwarded');

{
  const ARCGIS_ERROR = JSON.stringify({ error: { code: 400, message: 'Invalid query' } });
  const cache = install({ upstreamBody: ARCGIS_ERROR });
  const r = await read(await onRequestGet(ctx()));
  ok(
    r.body === ARCGIS_ERROR,
    'THE ERROR BODY IS FORWARDED VERBATIM so `data/genesis.js` can call it '
    + '`unavailable`. Read as a FeatureCollection with no features it becomes '
    + 'a published all-clear over a query that was refused'
  );
  ok(
    cache.store.get('https://landfall-relay.internal/nhc/genesis/areas/fresh') == null,
    'AND IT IS NEVER CACHED. A cached rejection is fifteen minutes of a false '
    + 'all-clear that nothing upstream can correct'
  );
  ok(
    cache.store.get('https://landfall-relay.internal/nhc/genesis/areas/last-good') == null,
    'nor remembered as a good answer'
  );
  /* ==> AND IT IS NAMED AS AN ARCGIS REFUSAL, NOT AS AN ODD SHAPE. <== Without
   * this line the assertions above pass with the whole `parsed.error` branch
   * deleted: an error body has no `type`, so the unexpected-shape guard a few
   * lines down catches it and forwards the same bytes uncached. The two guards
   * overlap, which is defence in depth and is also how a branch gets quietly
   * removed. The HEADER is the only observable difference, so it is the thing
   * asserted — a session staring at a response can tell "NOAA refused the
   * query" from "NOAA sent something we do not recognise", and those call for
   * different next steps. */
  ok(
    r.upstream === 'arcgis-error',
    `and named as a refusal rather than as an unrecognised shape — got ${JSON.stringify(r.upstream)}`
  );
}

section('An unstamped global memory is not a memory');

{
  install({ upstreamBody: EMPTY });
  const env = { LANDFALL_CACHE: makeKv({ [KV_LAST_GOOD]: { body: POPULATED, fetchedAt: null } }) };
  const r = await read(await onRequestGet(ctx(env)));
  /* An entry whose age cannot be computed must not be treated as recent.
   * Defaulting an unknown age to "current" is the §5 failure this whole route
   * exists to prevent, and it would make the hold permanent.
   *
   * ==> STATED HONESTLY: THIS ONE IS DEFENCE IN DEPTH, NOT A CATCH. <== It was
   * mutation-checked like every other assertion here and it PASSED against the
   * mutation. Breaking the `Number.isFinite(kvMs)` test in the route changes
   * nothing observable, because an unstamped entry then produces an infinite
   * age and is refused a line later by the window check instead. The two
   * guards overlap on purpose and either alone is sufficient.
   *
   * It is kept because it pins the BEHAVIOUR — an unstamped memory is never
   * held on — which stays true however the route is rewritten. It is labelled
   * because an assertion that cannot fail, presented as coverage, is worse
   * than no assertion: it is the thing that made two of this project's suites
   * green over live bugs. */
  ok(r.body === EMPTY, 'an entry with no timestamp cannot be aged, so it is not held on');
}

section('When both memories exist, the newer one wins');

{
  const cache = install({ upstreamBody: POPULATED });
  const env = {
    LANDFALL_CACHE: makeKv({
      [KV_LAST_GOOD]: { body: POPULATED, fetchedAt: minsAgo(300) },
    }),
  };
  /* One real answer, so the colo now remembers something NEWER than KV. */
  await onRequestGet(ctx(env));
  globalThis.fetch = async () => new Response(EMPTY, { status: 200 });
  cache.store.delete('https://landfall-relay.internal/nhc/genesis/areas/fresh');

  const r = await read(await onRequestGet(ctx(env)));
  ok(r.held === 'upstream-empty', 'still held');
  ok(
    Date.now() - Date.parse(r.fetchedAt) < 60 * 1000,
    'and stamped from the fresher colo copy, not the five-hour-old KV one'
  );
}

section('A fresh global copy is served without touching NHC');

{
  install({ upstreamBody: POPULATED });
  const env = {
    LANDFALL_CACHE: makeKv({ [KV_MAIN]: { body: POPULATED, fetchedAt: minsAgo(2) } }),
  };
  const r = await read(await onRequestGet(ctx(env)));
  ok(r.body === POPULATED, 'the warmed copy answers');
  ok(r.path === 'kv', 'and says so on the wire');
  ok(upstreamCalls === 0, 'and NHC was not contacted — this is the origin collapse');
}

section('A warm cycle reaches NHC every time, or the loop confirms itself forever');

{
  install({ upstreamBody: POPULATED });
  const env = {
    WARM_KEY: 'secret',
    __warmHeader: true,
    LANDFALL_CACHE: makeKv({ [KV_MAIN]: { body: POPULATED, fetchedAt: minsAgo(1) } }),
  };
  await onRequestGet(ctx(env));
  ok(upstreamCalls === 1, 'the warm request skips the fresh colo slot and the KV copy');
}

/* ---------------------------------------------------------------------------
 * 3. THE CLIENT AND THE SENTENCE
 * ------------------------------------------------------------------------- */

section('The client marks held, and the section says so');

{
  const g = fs.readFileSync('data/genesis.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/held:\s*!!extra\.held/.test(g), 'slot() carries `held` — it drops anything it does not name');
  /* ==> IT READS THE RELAY'S MARKER NOW INSTEAD OF GUESSING FROM `relayStale`.
   * <== `relayStale` is set by BOTH of the relay's remembering paths — upstream
   * refused, and upstream answered empty — and only the second is "the layer
   * has stopped publishing". The old inference printed a sentence about a
   * specific fault whenever NHC merely went down. */
  ok(
    /const held = !!relayHeld && areas\.length > 0/.test(g),
    'a held answer is flagged from the WIRE MARKER, not inferred from staleness'
  );
  ok(
    !/held:\s*relayStale && areas\.length/.test(g),
    'and the old inference is gone, not left beside it — two sources of one '
    + 'fact is how they drift apart'
  );
  ok(
    /relayHeld === OUTLOOK\.heldLapsedMarker/.test(g),
    'and the two markers are told apart, because an offered hold and an '
    + 'asserted one license different behaviour'
  );
  ok(
    !/status:\s*'unavailable'[\s\S]{0,80}held/.test(g),
    'held does NOT become unavailable — that would blank the very patches this keeps on screen'
  );

  const v = fs.readFileSync('ui/view-storms.js', 'utf8');
  /* ==> THE COUNT AND THE SENTENCE UNDER IT CONTRADICTED EACH OTHER ON GLASS.
   * <== Seen 2026-08-11: "BEING WATCHED 1" directly above "NHC's forecasters
   * are describing 5 areas". Both numbers were true — one counts what can be
   * DRAWN, the other what is being WATCHED — and side by side they read as a
   * bug. The header answers the question its own words ask. */
  ok(
    /const watchCount =/.test(v) && /watch-count">\$\{watchCount\}/.test(v),
    'the watch count is computed, not just the length of the drawable list'
  );
  ok(
    /proseSays && arb\.textCount > 0 \? arb\.textCount \+ areas\.length/.test(v),
    'and it includes the areas only the forecaster can see, so the header '
    + 'never undercounts the sentence beneath it'
  );
  /* ==> AMBER FOR A STOPPED CLOCK, RED FOR A SILENT SOURCE. <== `.list-error`
   * means "something broke, look at this". A layer answering promptly with
   * nothing, while we can say exactly what should be there, is not that. */
  ok(
    /tone: proseSays \? 'held' : 'error'/.test(v),
    'a layer contradicted by its own forecaster reads as a stopped clock, not '
    + 'as a failure — and a source that says nothing at all still reads red'
  );
  ok(
    /list-\$\{n\.tone\}/.test(v),
    'and the tone reaches the class name rather than being computed and dropped'
  );
  ok(/heldNote/.test(v), 'the section builds a held note');
  ok(
    /stopped publishing/.test(v),
    'and says the layer stopped publishing, rather than implying the areas are current'
  );
  ok(/list-held/.test(v), 'the note has its own class, separate from list-error');

  const css = fs.readFileSync('ui/panels.css', 'utf8');
  ok(
    /\.list-held\s*\{\s*color:\s*var\(--stale\)/.test(css),
    '.list-held is amber (a stopped clock), never --error (a failed request)'
  );
}

/* ------------------------------------------------------------------------- */

if (failures.length) {
  console.log(`\n✗ ${failures.length} failed\n`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed\n`);
