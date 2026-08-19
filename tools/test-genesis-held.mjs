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
 *
 * ==> THE UPSTREAM IS THE KMZ PAIR NOW, NOT GIS LAYER 3. <== Same product,
 * different path, proven identical across 72 archived hours by
 * `tools/gtwo-compare.mjs`. Everything this suite is about — which body goes
 * out, with which headers, for each combination of upstream answer and memory
 * — is unchanged by that, which is why the sections below are untouched.
 *
 * THE EXPECTED BODIES ARE COMPUTED BY THE SAME PARSER THE ROUTE USES, and that
 * is deliberate rather than lazy. Hand-copying the FeatureCollection would
 * pin 600 vertices of NHC geometry into this file and make it fail every time
 * a forecaster redraws a shape, which would be a test about NHC's opinions.
 * What is under test here is the DECISION. The parse itself is pinned hard,
 * against the same bytes, in `tools/test-gtwo-kml.mjs`.
 * ------------------------------------------------------------------------- */

const { parseGtwoKml, toAreaCollection } = await import('../functions/api/nhc/_gtwo-kml.js');
const { kmlFromKmz } = await import('../functions/api/nhc/_kmz.js');

const kmzFixture = (n) =>
  Buffer.from(fs.readFileSync(path.join(ROOT, 'samples/genesis/gtwo', n), 'utf8').trim(), 'base64');

/** Two watched areas in the East Pacific, 19 Aug 05:25Z. */
const KMZ_PACIFIC = kmzFixture('epacific.kmz.b64');
/** The Atlantic the same hour: nothing being watched, and SAYING SO. */
const KMZ_ATLANTIC_CLEAR = kmzFixture('atlantic.kmz.b64');

/**
 * ==> THE ONE DOCUMENT NHC HAS NEVER PUBLISHED, AND THE REASON THE HELD
 * MACHINERY IS STILL HERE. <== No areas and no all-clear sentence: the KMZ
 * doing what layer 3 did every time, saying nothing and explaining nothing.
 * Every quiet basin in the 72-hour archive window carried the sentence, so
 * this shape is synthetic — built by deleting the sentence from real bytes,
 * which is the smallest lie that produces the case.
 */
/**
 * A QUIET EAST PACIFIC, SYNTHESISED, and the reason it has to be. Every one of
 * the 72 archived hours had two Pacific areas on the board, so the archive
 * contains no real Pacific all-clear to copy. This is the Atlantic's genuine
 * all-clear with the basin words swapped — the sentence, the stamp and the
 * structure are NHC's, and only the ocean is ours.
 */
const KMZ_PACIFIC_CLEAR = await (async () => {
  const kml = (await kmlFromKmz(KMZ_ATLANTIC_CLEAR))
    .replace(/North Atlantic basin/g, 'eastern North Pacific basin');
  return zipOneFile('gtwo_pac.kml', kml);
})();

const KMZ_ATLANTIC_SILENT = await (async () => {
  const kml = (await kmlFromKmz(KMZ_ATLANTIC_CLEAR))
    .replace(/formation is not expected/gi, 'the outlook is being prepared');
  return zipOneFile('gtwo_atl.kml', kml);
})();

/**
 * A KML string → a one-entry zip, stored uncompressed.
 *
 * STORED RATHER THAN DEFLATED because `_kmz.js` supports both and this needs
 * no dependency to build. The DEFLATE path — which is what NHC actually
 * publishes — is exercised by the two real fixtures above, so both branches of
 * the reader are covered by the suite as a whole.
 */
function zipOneFile(name, text) {
  const nameBytes = Buffer.from(name, 'utf8');
  const data = Buffer.from(text, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);          // version needed
  local.writeUInt16LE(0, 6);           // flags — bit 3 clear, sizes are here
  local.writeUInt16LE(0, 8);           // method 0, stored
  local.writeUInt32LE(0, 14);          // crc, not read by _kmz.js
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  return Buffer.concat([local, nameBytes, data]);
}

/** What the route serves for a given pair of documents — atlantic first, then
 *  east Pacific, which is the order `KMZ_URL` declares them in. */
async function expectedBody(...kmzs) {
  const features = [];
  for (const kmz of kmzs) {
    features.push(...toAreaCollection(parseGtwoKml(await kmlFromKmz(kmz))).features);
  }
  return JSON.stringify({ type: 'FeatureCollection', features });
}

/** Two areas on the board — the state everything below calls POPULATED. */
const POPULATED = await expectedBody(KMZ_ATLANTIC_CLEAR, KMZ_PACIFIC);

/** Nothing anywhere. Under layer 3 this was 42 unstamped bytes; it is the same
 *  42 bytes on the wire now, and the difference is that upstream EXPLAINED
 *  itself, so the route believes it instead of holding. */
const EMPTY = await expectedBody(KMZ_ATLANTIC_CLEAR, KMZ_PACIFIC_CLEAR);

/**
 * ==> THE SAME 42 BYTES, FOR A COMPLETELY DIFFERENT REASON, AND THIS IS THE
 * DISTINCTION THE SWAP BOUGHT. <== `EMPTY` above is upstream saying "nothing
 * is being watched" in a dated sentence. This is upstream saying nothing at
 * all — no areas, no explanation — which is what layer 3 said EVERY time,
 * including on 2026-08-11 when it was wrong.
 *
 * On the wire the two are byte-identical. The route can tell them apart
 * because it read the documents, and every held section below feeds it THIS
 * one, because holding is now a response to ambiguity rather than to
 * emptiness.
 */
const AMBIGUOUS_MARKER = { ambiguous: true };
/** Selecting the fixture pair is by IDENTITY, because the two states produce
 *  the same string and a value comparison could not tell them apart — which is
 *  the whole point being tested. `AMBIGUOUS` is a marker on the way in; what
 *  comes back out is `EMPTY`, byte for byte. */
const AMBIGUOUS = AMBIGUOUS_MARKER;

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

/**
 * Install a fake edge.
 *
 * `upstreamBody` names the ANSWER wanted, and the fixtures that produce it are
 * looked up here — so every section below reads exactly as it did when this
 * route talked to ArcGIS, and the swap is invisible to them. Passing
 * `upstreamKmz` directly is the escape hatch for the cases that are about the
 * bytes rather than the decision.
 */
function install({ upstreamBody, upstreamKmz, upstreamStatus = 200 }) {
  const cache = makeCache();
  globalThis.caches = { default: cache };
  upstreamCalls = 0;

  const pair = upstreamKmz
    || (upstreamBody === POPULATED ? [KMZ_ATLANTIC_CLEAR, KMZ_PACIFIC]
      : upstreamBody === AMBIGUOUS_MARKER ? [KMZ_ATLANTIC_SILENT, KMZ_PACIFIC_CLEAR]
        : [KMZ_ATLANTIC_CLEAR, KMZ_PACIFIC_CLEAR]);

  /* The route fetches the two basin documents in declaration order and always
   * both, so the stub cycles through the pair. `upstreamCalls` ticks once per
   * REQUEST rather than once per document, so every "did this touch NHC at
   * all" check below still counts what it counted before the swap. */
  let served = 0;
  globalThis.fetch = async () => {
    const body = pair[served % 2];
    if (served % 2 === 0) upstreamCalls++;
    served++;
    return new Response(body, {
      status: upstreamStatus,
      headers: { 'Content-Type': 'application/vnd.google-earth.kmz' },
    });
  };
  return cache;
}

/**
 * Point the stub at a basin document that has no areas AND does not say why —
 * upstream going quiet without explaining, which is the only thing that still
 * makes this route hold. Used by the sections that seed a real answer first
 * and then watch the outlook fall over.
 */
function goAmbiguous() {
  const pair = [KMZ_ATLANTIC_SILENT, KMZ_PACIFIC_CLEAR];
  let served = 0;
  globalThis.fetch = async () => new Response(pair[served++ % 2], { status: 200 });
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
  ok(JSON.parse(r.body).features.length === 2, 'all three areas survive');
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
  goAmbiguous();

  const r = await read(await onRequestGet(ctx()));

  ok(
    JSON.parse(r.body).features.length === 2,
    'THE HEADLINE: the remembered areas are still served when the outlook goes quiet — ' +
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
  goAmbiguous();
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
  goAmbiguous();

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
    JSON.parse(r.body).features.length === 2,
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
  goAmbiguous();

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
  install({ upstreamBody: AMBIGUOUS });
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
  ok(r.areas === '2', 'and the count describes the body being sent, for the writer\u2019s gate');
}

section('The global memory expires on the same clock as the local one');

{
  install({ upstreamBody: AMBIGUOUS });
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
    JSON.parse(r.body).features.length === 2,
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
  const cache = install({ upstreamBody: AMBIGUOUS });
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
  install({ upstreamBody: AMBIGUOUS });
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

section('A document we cannot read is an outage, never an empty sky');

/* ==> THIS SECTION REPLACED THE ARCGIS ONE, AND THE SHAPE OF THE ANSWER
 * CHANGED WITH THE SOURCE. <== Layer 3 reported failure as HTTP 200 with an
 * `error` body, so the route forwarded those bytes verbatim for the client to
 * recognise. NHC's web path has no such convention: a bad answer is a bad
 * answer — a 404, a page of HTML, a zip with no KML in it. So the route
 * REFUSES it rather than forwarding it, and refusing means falling into the
 * memory below, which is strictly better than what ArcGIS allowed.
 *
 * WHAT MUST NOT CHANGE is the thing both versions are about: garbage upstream
 * may never turn into a FeatureCollection with no features in it, because that
 * is a published all-clear over a source that never answered (§45.5). */

{
  const notAZip = Buffer.from('<html><body>404 Not Found</body></html>', 'utf8');
  const cache = install({ upstreamKmz: [notAZip, notAZip] });
  const r = await read(await onRequestGet(ctx()));

  ok(
    r.status === 502,
    `AN UNREADABLE UPSTREAM IS A FAILURE, NOT AN ANSWER — got ${r.status}`
  );
  ok(
    !/"features":\[\]/.test(r.body),
    'and emphatically NOT an empty FeatureCollection, which is the one wrong '
    + 'answer that looks exactly like a healthy quiet season'
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
}

section('A document that names the wrong basin is refused, not counted twice');

/* ==> THE FAILURE THAT WOULD PRODUCE A PERFECTLY WELL-FORMED LIE. <== The two
 * basins are separate files on NHC's web server. If a filename ever moves and
 * one URL starts answering with the other basin's document, the route would
 * merge the Atlantic with itself: a complete-looking outlook with every
 * Pacific area silently absent. Nothing downstream could see it. So each
 * document is required to name the basin it was asked for. */

{
  const cache = install({ upstreamKmz: [KMZ_ATLANTIC_CLEAR, KMZ_ATLANTIC_CLEAR] });
  const r = await read(await onRequestGet(ctx()));
  ok(r.status === 502, `the same document twice is refused — got ${r.status}`);
  ok(
    cache.store.get('https://landfall-relay.internal/nhc/genesis/areas/last-good') == null,
    'and half an ocean is never remembered as a good answer'
  );
}

section('A stated all-clear is believed at once, with a fresh memory in hand');

/* ==> THE THING THE SWAP ACTUALLY BOUGHT, PINNED SO IT CANNOT BE LOST. <==
 * Under layer 3 this case was unreachable: an empty answer minutes after a
 * real one was held for up to six hours, because an empty FeatureCollection
 * carries nothing to distinguish a genuine all-clear from a broken layer. The
 * KMZ carries a dated sentence saying formation is not expected, so the
 * distinction is published and the six hours are not owed.
 *
 * THE SAME MEMORY, THE SAME MINUTE, THE OPPOSITE ANSWER from the section
 * above — the ONLY difference is whether upstream explained itself. */

{
  const cache = install({ upstreamBody: POPULATED });
  await onRequestGet(ctx());
  cache.store.delete('https://landfall-relay.internal/nhc/genesis/areas/fresh');

  /* Upstream now says, in words, that it is watching nothing. */
  let served = 0;
  const clear = [KMZ_ATLANTIC_CLEAR, KMZ_PACIFIC_CLEAR];
  globalThis.fetch = async () => new Response(clear[served++ % 2], { status: 200 });

  const r = await read(await onRequestGet(ctx()));

  ok(r.body === EMPTY, 'the all-clear goes out, not the areas from ten seconds ago');
  ok(r.stale !== 'true', 'and it is not dressed up as stale');
  ok(
    r.held == null || r.held === '',
    `nor held — the source explained itself, so there is nothing to hold for. Got ${JSON.stringify(r.held)}`
  );

  /* ==> AND IT MUST NOT ERASE THE MEMORY OF HAVING HAD AREAS. <== `lastGoodKey`
   * answers exactly one question — "when did NHC last publish areas" — so a
   * body with none in it may never land there, however well explained it is.
   * The temptation the swap creates is to govern that write with `ambiguous`,
   * which now reads false for a stated all-clear; the route keeps a separate
   * `noAreas` for this line precisely so the two cannot be collapsed. Without
   * this assertion that collapse passes every other check in this suite, and
   * the next genuine outage would find the memory holding an all-clear. */
  const lg = cache.store.get('https://landfall-relay.internal/nhc/genesis/areas/last-good');
  const remembered = lg ? JSON.parse(await lg.clone().text()) : null;
  ok(
    remembered && remembered.features.length === 2,
    'the memory of having had areas survives an all-clear — got '
      + `${remembered ? remembered.features.length : 'nothing'}`
  );
}

section('An unstamped global memory is not a memory');

{
  install({ upstreamBody: AMBIGUOUS });
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
  goAmbiguous();
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

section('An empty warm copy is stepped over, not served — the 13:22Z case');

/* ==> THE BUG THIS PINS WAS LIVE FOR AT LEAST TWO HOURS AND LOOKED FINE. <==
 * MEASURED on the archive branch, 2026-08-11 at 13:22Z and again at 15:06Z:
 * this route answered 42 bytes of empty FeatureCollection carrying
 * `X-Landfall-Cache: kv`, no `X-Landfall-Held` and no `X-Landfall-Stale`,
 * while NHC's own bulletin listed five areas and its public graphic drew them.
 *
 * Every branch below the KV read was correct and none of it ran. The cron
 * re-stamps the warm copy every five minutes whether the bytes changed or not,
 * so an empty answer that lands there is permanently "fresh" and answers ahead
 * of the remembering. ONE empty cycle that got through poisoned the entire
 * outage. */
{
  install({ upstreamBody: AMBIGUOUS });
  const env = {
    LANDFALL_CACHE: makeKv({
      [KV_MAIN]: { body: EMPTY, fetchedAt: minsAgo(1) },
      [KV_LAST_GOOD]: { body: POPULATED, fetchedAt: minsAgo(90) },
    }),
  };
  const r = await read(await onRequestGet(ctx(env)));
  ok(r.body === POPULATED, 'the remembered areas go out, not the fresh empty copy');
  ok(r.held === 'upstream-empty', 'and they are marked as held');
  ok(r.path !== 'kv', 'the warm copy did not answer this request');
  ok(upstreamCalls === 1, 'NHC was asked, because an empty answer is re-decided every time');
}

section('An empty local copy is stepped over too, and is never stored');

/* ==> TWO SEPARATE GUARDS, AND THEY ARE DELIBERATELY TESTED SEPARATELY. <==
 * The colo slot is not stored with an empty body any more AND an empty body
 * found there is not served. Either one alone prevents the freeze, so a test
 * that only drove requests end to end would pass with either guard deleted —
 * exactly the assertion-that-cannot-fail this project has shipped twice. Each
 * is pinned against a state built by hand instead.
 *
 * FIRST: an empty body IS in the slot — put there by an older deploy, or by a
 * colo that saw the all-clear before the memory arrived. It must be stepped
 * over. */
{
  const cache = install({ upstreamBody: AMBIGUOUS });
  cache.store.set(
    'https://landfall-relay.internal/nhc/genesis/areas/fresh',
    new Response(EMPTY, { headers: { 'X-Landfall-Fetched-At': new Date().toISOString() } })
  );
  const env = {
    LANDFALL_CACHE: makeKv({ [KV_LAST_GOOD]: { body: POPULATED, fetchedAt: minsAgo(90) } }),
  };
  const r = await read(await onRequestGet(ctx(env)));
  ok(r.body === POPULATED, 'a stored empty local copy does not answer either');
  ok(r.held === 'upstream-empty', 'the memory is consulted instead');
}

/* SECOND: nothing empty goes into the slot in the first place. */
{
  const cache = install({ upstreamBody: AMBIGUOUS });
  const env = { LANDFALL_CACHE: makeKv({}) };
  const r = await read(await onRequestGet(ctx(env)));
  ok(r.body === EMPTY, 'with no memory at all, a true all-clear still gets through');
  ok(r.areas === '0', 'and says zero areas on the wire');
  ok(
    !cache.store.has('https://landfall-relay.internal/nhc/genesis/areas/fresh'),
    'and it is not written to the local slot, where it could only be stepped over later'
  );
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
  /* ==> THE SECTION IS PART OF THE LAYER, AND THE TOGGLE HAD ONLY HALF ITS
   * JOB. <== Seen on glass 2026-08-11: turning `genesis` off cleared the
   * patches from the globe and left the rows in the drawer. A control that
   * removes a thing from one surface and not the other reads as broken — and
   * the drawer then claims the app is watching areas the map was told to hide. */
  ok(
    /if \(!toggleOn\('genesis'\)\) \{/.test(v),
    'the watch section checks the layer toggle before it renders anything'
  );
  ok(
    v.indexOf("if (!toggleOn('genesis'))") < v.indexOf("if (g.status === 'loading')"),
    'AND IT CHECKS IT FIRST. "The reader closed this surface" outranks every '
    + 'other reason the section might speak, including an outage — otherwise a '
    + 'hidden section still shouts on a bad day'
  );
  /* ==> A TOGGLE FLIP IS NOT A STATE UPDATE. <== `update()` is driven by the
   * data store and flipping a switch changes no data, so without a
   * subscription the rows survive until the next poll — up to thirty minutes.
   * A toggle that takes half an hour is a toggle that does not work. */
  ok(
    /subscribeLayers\(\(\) => \{[\s\S]{0,120}renderWatch\(lastState\)/.test(v),
    'and a toggle flip redraws the section immediately rather than waiting for '
    + 'the next poll'
  );
  ok(
    /toggleOn\('genesis'\) \? \(state\.genesis\?\.areas\?\.length \?\? 0\) : 0/.test(v),
    'the headline pill also stops counting areas the reader has hidden, so it '
    + 'never points at a section that is gone'
  );
  /* ==> AND `overall()` DELIBERATELY DOES NOT READ THE TOGGLE. <== Whether
   * anything is out there is a fact about the ocean, not about a switch.
   * Hiding the layer must never promote the app to `clear`. */
  ok(
    /if \(\(state\.genesis\?\.areas\?\.length \?\? 0\) > 0\) return 'ok';/.test(v),
    'HIDING A LAYER MUST NOT EARN AN ALL-CLEAR. The status ladder still counts '
    + 'real areas whether or not they are on screen — whether anything is out '
    + 'there is a fact about the ocean, not about a switch'
  );
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
