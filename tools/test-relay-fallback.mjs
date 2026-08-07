#!/usr/bin/env node
/**
 * test-relay-fallback.mjs — the three-level read in every relay route.
 *
 * WHY THIS EXISTS. SPEC §17 Pass B put a KV layer between the relay routes and
 * their upstreams. The whole pass is safe to deploy for exactly one reason:
 * **every route still falls back to fetching upstream, so a missing binding, an
 * empty namespace, or a dead cron Worker is a performance regression and not an
 * outage.** That claim is load-bearing and it was, until this file, a claim.
 *
 * ===> AND IT IS THE CLAIM MOST LIKELY TO BE FALSE WITHOUT ANYONE NOTICING. <===
 * Every other Pass B failure is loud or measurable. This one is not. If a route
 * throws when `env.LANDFALL_CACHE` is undefined, nothing breaks in the sandbox,
 * nothing breaks in a preview deploy with the binding set, and nothing breaks in
 * production until the one moment it matters — a binding removed, a namespace
 * deleted, a Preview environment nobody configured. The app would go dark on the
 * deploy nobody is watching, which is the same shape as the CSP risk §17 A4
 * shipped report-only to avoid.
 *
 * SO IT IS TESTED WITHOUT WRANGLER AND WITHOUT A NETWORK. Each route's exported
 * `onRequestGet` is imported and called directly with a fake `context`: a stub
 * `caches.default`, a stub `fetch`, and whatever `env` the case is about. That
 * is the real code path, not a re-implementation of it — the thing the last two
 * §17 bugs both turned out to need.
 *
 * FOUR CASES PER ROUTE:
 *   1. NO KV BINDING AT ALL      -> upstream is called, 200, real body
 *   2. FRESH KV ENTRY            -> served from KV, upstream NEVER called
 *   3. STALE KV + UPSTREAM DOWN  -> served from KV, flagged X-Landfall-Stale
 *   4. WARM BYPASS HEADER        -> KV skipped, upstream called (the cron path)
 *
 * Case 2 is the pass working. Case 1 and 3 are the pass being SAFE. Case 4 is
 * the warm loop not confirming its own last answer forever.
 *
 * Zero dependencies (§12). Run: node tools/test-relay-fallback.mjs
 */

import { gzipSync } from 'node:zlib';

/* ---------------------------------------------------------------------------
 * FIXTURES — the smallest body each route will agree to cache.
 *
 * Each one satisfies that route's own "refuse to cache a dud" guard, which is
 * the point: they are shaped by what the routes actually check for, so a guard
 * getting stricter fails here rather than in production.
 * ------------------------------------------------------------------------- */

const RSS = `<rss><channel><pubDate>Sat, 25 Jul 2026 06:00:00 GMT</pubDate>
<item><link>https://www.metoc.navy.mil/jtwc/products/wp1126web.txt</link></item>
</channel></rss>`;

const WARNING = 'SUBJ/TYPHOON 11W (NOUL) WARNING NR 008//\nRMKS/\n1. WARNING POSITION...\n';

const BODIES = {
  'https://www.nhc.noaa.gov/CurrentStorms.json': '{"activeStorms":[{"id":"al012026","binNumber":"AT1"}]}',
  /* Prefix-matched by bodyFor(), so the query string the route appends does not
   * need repeating here — but the PATH does, and it changed on 2026-07-26 when
   * the relay moved off EVENTS4APP. A stale key here does not fail loudly: it
   * silently stops matching, the stub returns null, and every GDACS case in
   * this file starts testing the upstream-is-down path instead of the one it
   * was written for. */
  'https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH': '{"features":[]}',
  'https://www.gdacs.org/gdacsapi/api/polygons/getgeometry': '{"type":"FeatureCollection","features":[]}',
  'https://www.metoc.navy.mil/jtwc/rss/jtwc.rss': RSS,
  'https://www.metoc.navy.mil/jtwc/products/wp1126web.txt': WARNING,
  'https://www.nhc.noaa.gov/text/refresh': '<html><body><pre>BULLETIN\nHURRICANE BERTHA</pre></body></html>',
  'https://ftp.nhc.noaa.gov/atcf/aid_public/': 'AL, 01, 2026072506, 03, AVNO, 000, 250N, 0750W, 65, 985\n',
};

/** The upstream body for a URL, or null when nothing here matches it. */
function bodyFor(url) {
  for (const [prefix, body] of Object.entries(BODIES)) {
    if (url.startsWith(prefix)) return body;
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * STUBS
 * ------------------------------------------------------------------------- */

/** A cache that never hits. L1 is not what this file is about — every case
 *  here is specifically about what happens on a colo MISS, which is the state
 *  a first visitor in a region is always in and the one Pass B exists for. */
const emptyCache = () => ({
  match: async () => null,
  put: async () => {},
});

/** A KV namespace holding one entry, stamped however the case needs it.
 *
 * ===> `ageSeconds` AGES `verifiedAt`, AND `fetchedAt` IS PINNED ANCIENT. <===
 * That asymmetry is the assertion, not a shortcut. Freshness is judged on
 * "when did the cron last check", so a 30-day-old CONTENT stamp beside a
 * seconds-old CHECK stamp must read as FRESH — that is the whole two-field
 * fix, and it is exactly the shape of a quiet ocean or a 6-hourly advisory.
 * If any of these cases ever starts failing on the fetchedAt value, someone
 * has wired freshness back onto the wrong field. */
const ANCIENT = new Date('2020-01-01T00:00:00.000Z').toISOString();

const fakeKv = (path, body, ageSeconds) => ({
  getWithMetadata: async (key) => {
    if (key !== `v1:${path}`) return { value: null, metadata: null };
    return {
      value: body,
      metadata: {
        verifiedAt: new Date(Date.now() - ageSeconds * 1000).toISOString(),
        fetchedAt: ANCIENT,
        hash: 'x',
      },
    };
  },
});

/** The same namespace as an OLD writer left it: one stamp only. Proves the
 *  deploy seam — Pages new, Worker not yet redeployed — behaves exactly as it
 *  did before rather than treating the whole store as unstamped and dark. */
const legacyKv = (path, body, ageSeconds) => ({
  getWithMetadata: async (key) => {
    if (key !== `v1:${path}`) return { value: null, metadata: null };
    return {
      value: body,
      metadata: { fetchedAt: new Date(Date.now() - ageSeconds * 1000).toISOString(), hash: 'x' },
    };
  },
});

let upstreamCalls = 0;

/** `mode: 'down'` makes every upstream fetch fail, which is how case 3 proves
 *  the stale KV copy is what came back rather than a lucky live fetch. */
function installFetch(mode) {
  upstreamCalls = 0;
  globalThis.fetch = async (url) => {
    const href = String(url);
    upstreamCalls++;
    if (mode === 'down') throw new Error('simulated upstream failure');

    const body = bodyFor(href);
    if (body == null) return new Response('not found', { status: 404 });

    /* The a-deck arrives gzipped and the route pipes it through a
     * DecompressionStream, so the stub has to actually gzip. A plain string
     * would fail inside the route rather than exercising it. */
    if (href.includes('/atcf/aid_public/')) {
      return new Response(gzipSync(Buffer.from(body)), { status: 200 });
    }
    return new Response(body, { status: 200 });
  };
}

const ctx = (url, env, headers = {}) => ({
  request: new Request(url, { headers }),
  env,
  waitUntil: () => {},
});

/* ---------------------------------------------------------------------------
 * THE ROUTES UNDER TEST
 * ------------------------------------------------------------------------- */

const GEOM_URL = 'https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1000123';

const ROUTES = [
  {
    name: 'nhc/storms',
    module: '../functions/api/nhc/storms.js',
    url: 'https://landfall.test/api/nhc/storms',
    kvPath: 'nhc/storms',
    warmBody: '{"activeStorms":[]}',
    freshSeconds: 5 * 60,
  },
  {
    name: 'gdacs/events',
    module: '../functions/api/gdacs/events.js',
    url: 'https://landfall.test/api/gdacs/events',
    kvPath: 'gdacs/events',
    warmBody: '{"features":[{"warm":true}]}',
    freshSeconds: 5 * 60,
  },
  {
    name: 'jtwc/storms',
    module: '../functions/api/jtwc/storms.js',
    url: 'https://landfall.test/api/jtwc/storms',
    kvPath: 'jtwc/storms',
    warmBody: '{"state":"ok","storms":[{"product":"wp1126"}]}',
    freshSeconds: 15 * 60,
  },
  {
    name: 'gdacs/geometry',
    module: '../functions/api/gdacs/geometry.js',
    url: `https://landfall.test/api/gdacs/geometry?url=${encodeURIComponent(GEOM_URL)}`,
    kvPath: `gdacs/geometry/${encodeURIComponent(new URL(GEOM_URL).toString())}`,
    warmBody: '{"type":"FeatureCollection","features":[{"warm":true}]}',
    freshSeconds: 30 * 60,
  },
  {
    name: 'nhc/advisory',
    module: '../functions/api/nhc/advisory.js',
    url: 'https://landfall.test/api/nhc/advisory?bin=AT1',
    kvPath: 'nhc/advisory/MIATCPAT1',
    warmBody: '<html><pre>WARM ADVISORY</pre></html>',
    freshSeconds: 5 * 60,
  },
  {
    name: 'jtwc/warning',
    module: '../functions/api/jtwc/warning.js',
    url: 'https://landfall.test/api/jtwc/warning?product=wp1126',
    kvPath: 'jtwc/warning/wp1126',
    warmBody: 'SUBJ/WARM WARNING NR 001//',
    freshSeconds: 15 * 60,
  },
  {
    name: 'nhc/adeck',
    module: '../functions/api/nhc/adeck.js',
    url: 'https://landfall.test/api/nhc/adeck?storm=al012026',
    kvPath: 'nhc/adeck/al012026',
    /* Deliberately NOT the upstream fixture. The first draft reused it, the
     * filtered upstream body came back byte-identical, and case 4's "body is
     * not the KV copy" assertion failed on a fixture collision rather than on
     * anything real. A negative assertion is only as good as the two things
     * being distinguishable — make them distinguishable. */
    warmBody: 'AL, 99, 2026010100, 03, UKX,  000, 100N, 0100W, 30, 1000',
    freshSeconds: 15 * 60,
  },
];

/* ------------------------------------------------------------------------- */

let failures = 0;
const ok = (label, cond, detail = '') => {
  if (cond) return;
  failures++;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
};

globalThis.caches = { default: emptyCache() };

for (const route of ROUTES) {
  const { onRequestGet } = await import(route.module);
  console.log(`\n${route.name}`);

  /* --- 1. NO KV BINDING. The safety valve. ------------------------------- */
  installFetch('up');
  let res = await onRequestGet(ctx(route.url, {}));
  ok(`${route.name}: no KV binding -> 200 from upstream`, res.status === 200, `got ${res.status}`);
  ok(`${route.name}: no KV binding -> upstream actually called`, upstreamCalls > 0);
  console.log('  ✓ no KV binding: falls through to upstream');

  /* --- 2. FRESH KV. The pass working. ------------------------------------ */
  installFetch('up');
  res = await onRequestGet(
    ctx(route.url, { LANDFALL_CACHE: fakeKv(route.kvPath, route.warmBody, 1) })
  );
  const warmText = await res.text();
  ok(`${route.name}: fresh KV -> body served from KV`, warmText === route.warmBody,
    `got ${JSON.stringify(warmText.slice(0, 60))}`);
  ok(`${route.name}: fresh KV -> upstream NOT called`, upstreamCalls === 0,
    `upstream was called ${upstreamCalls}x`);
  console.log('  ✓ fresh KV: served from the edge, upstream untouched');
  console.log('    (fetchedAt on that entry is dated 2020 — freshness read verifiedAt)');

  /* --- 2b. THE DEPLOY SEAM. An entry the OLD writer left behind. ----------
   * Pages and the cron Worker are separate deploys and can land in either
   * order. In the window between them this file is new and every stored entry
   * still carries `fetchedAt` alone. That must behave exactly as it did
   * before — not go dark because the field it now prefers is absent. */
  installFetch('up');
  res = await onRequestGet(
    ctx(route.url, { LANDFALL_CACHE: legacyKv(route.kvPath, route.warmBody, 1) })
  );
  ok(`${route.name}: legacy single-stamp entry -> still served from KV`,
    (await res.text()) === route.warmBody,
    'the two deploys must be able to land in either order');
  ok(`${route.name}: legacy single-stamp entry -> upstream NOT called`, upstreamCalls === 0);

  installFetch('down');
  res = await onRequestGet(
    ctx(route.url, {
      LANDFALL_CACHE: legacyKv(route.kvPath, route.warmBody, route.freshSeconds + 3600),
    })
  );
  ok(`${route.name}: legacy entry past its window -> still flagged stale`,
    res.headers.get('X-Landfall-Stale') === 'true');
  console.log('  ✓ deploy seam: old single-stamp entries behave exactly as before');

  /* --- 3. STALE KV + UPSTREAM DOWN. Stale beats blank (§5). --------------- */
  installFetch('down');
  res = await onRequestGet(
    ctx(route.url, {
      LANDFALL_CACHE: fakeKv(route.kvPath, route.warmBody, route.freshSeconds + 3600),
    })
  );
  ok(`${route.name}: stale KV + dead upstream -> 200, not 502`, res.status === 200,
    `got ${res.status}`);
  ok(`${route.name}: stale KV -> flagged stale`, res.headers.get('X-Landfall-Stale') === 'true');
  ok(`${route.name}: stale KV -> body is the stored copy`, (await res.text()) === route.warmBody);
  console.log('  ✓ stale KV + dead upstream: stale copy, honestly flagged');

  /* --- 4. WARM BYPASS. The cron path. ------------------------------------ */
  installFetch('up');
  res = await onRequestGet(
    ctx(
      route.url,
      { LANDFALL_CACHE: fakeKv(route.kvPath, route.warmBody, 1), WARM_KEY: 'secret' },
      { 'X-Landfall-Warm': 'secret' }
    )
  );
  ok(`${route.name}: warm bypass -> upstream called despite a fresh KV entry`, upstreamCalls > 0,
    'the warm loop would re-confirm its own previous answer forever');
  ok(`${route.name}: warm bypass -> body is NOT the KV copy`,
    (await res.text()) !== route.warmBody);
  console.log('  ✓ warm bypass: reaches the source');

  /* --- 4b. A BYPASS HEADER WITH THE WRONG KEY IS IGNORED. ----------------- */
  installFetch('up');
  res = await onRequestGet(
    ctx(
      route.url,
      { LANDFALL_CACHE: fakeKv(route.kvPath, route.warmBody, 1), WARM_KEY: 'secret' },
      { 'X-Landfall-Warm': 'guess' }
    )
  );
  ok(`${route.name}: wrong warm key -> bypass refused, KV still served`, upstreamCalls === 0,
    'an ungated bypass is a lever a stranger pulls to drive traffic at NOAA');
  console.log('  ✓ wrong warm key: bypass refused');
}

/* A route with NO WARM_KEY configured must not honour the header at all —
 * fail closed, the same posture functions/api/_inspect-guard.js settled on. */
{
  installFetch('up');
  const { onRequestGet } = await import('../functions/api/nhc/storms.js');
  const res = await onRequestGet(
    ctx(
      'https://landfall.test/api/nhc/storms',
      { LANDFALL_CACHE: fakeKv('nhc/storms', '{"activeStorms":[]}', 1) },
      { 'X-Landfall-Warm': 'anything' }
    )
  );
  ok('no WARM_KEY set -> bypass impossible for anyone', upstreamCalls === 0);
  ok('no WARM_KEY set -> KV still served normally', (await res.text()) === '{"activeStorms":[]}');
  console.log('\n✓ no WARM_KEY configured: nobody can bypass, including us');
}

if (failures) {
  console.error(`\n${failures} relay fallback failure(s).\n`);
  process.exit(1);
}
console.log(`\n✓ all ${ROUTES.length} relay routes: KV when warm, upstream when not, stale when neither`);
