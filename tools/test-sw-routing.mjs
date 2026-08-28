#!/usr/bin/env node
/**
 * test-sw-routing.mjs — which cache strategy a URL gets, and the guard that
 * stops a cache-first path serving a 404 page forever.
 *
 * ===> THIS SUITE EXISTS BECAUSE `sw.js` HAD NO TEST AT ALL. <===
 * It is the one file in the repo that can outlive its own fix: a service
 * worker decides what a returning visitor sees BEFORE any of the app's code
 * runs, and a wrong answer here is not a crash — it is a browser confidently
 * serving something old or something wrong. That already happened once, when
 * cache-first stored Cloudflare's HTML fallback under a vendor `.js` filename
 * and black-screened the app until VERSION was bumped by hand.
 *
 * Adding `/seasons/data/` to the cache-first list on 2026-08-24 pointed that
 * same loaded gun at a second file type. The season files are `.txt`, and
 * `typeMatchesUrl()`'s extension list did not include `txt` — so a season file
 * missing for one deploy would have been replaced, permanently, by the
 * index.html fallback page. Worse than the vendor case, because there is no
 * MIME error: the parser would simply find no storms and the archive would
 * look EMPTY rather than broken. §5's shape again — a confident wrong answer.
 *
 * HOW IT TESTS THE REAL FILE. `sw.js` is a classic worker script, not an ES
 * module, so it cannot be imported. It is read from disk and run in a VM with
 * a fake `self`, and the actual shipped functions are pulled back out. That
 * means this suite fails when the real routing changes, which is the only
 * version worth having — a test that re-implements the regex would pass
 * against a broken worker.
 *
 * WHAT IT CANNOT TELL YOU: whether a real browser installs the worker, whether
 * offline actually works, or whether the cache survives a VERSION bump. That
 * needs a phone with airplane mode on. This is the routing decision, in
 * isolation.
 *
 * Zero dependencies (§12). Run: node tools/test-sw-routing.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'sw.js'), 'utf8');

/* A `self` that records the listeners rather than running them — the fetch
 * handler needs a live FetchEvent and a CacheStorage to do anything, and what
 * is under test is the decision it makes, not the plumbing it makes it with. */
const listeners = {};
const sandbox = {
  self: {
    addEventListener: (name, fn) => { listeners[name] = fn; },
    location: { origin: 'https://landfall.getgravitate.app' },
    skipWaiting: () => {},
    clients: { claim: () => {} },
  },
  caches: { open: async () => ({ addAll: async () => {}, put: async () => {} }), keys: async () => [], match: async () => undefined, delete: async () => {} },
  fetch: async () => { throw new Error('no network in this test'); },
  URL,
  console,
};
vm.createContext(sandbox);
/* The shipped file, VERBATIM, plus one appended line that only reads. `const`
 * at the top of a VM script does not become a property of the sandbox, so
 * there is no other way to reach the real values — and re-typing them here
 * would be a test of this file rather than of `sw.js`. */
vm.runInContext(
  `${source}\n;globalThis.__sw = { PRECACHE, BYPASS_PATHS, IMMUTABLE_PATHS, typeMatchesUrl };`,
  sandbox,
  { filename: 'sw.js' },
);

let passed = 0;
const failures = [];
function ok(label, cond) {
  if (cond) { passed++; return; }
  failures.push(label);
  console.error(`  ✗ ${label}`);
}
function eq(label, actual, expected) {
  ok(`${label} (got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)})`, actual === expected);
}

/* --- the three path lists, read out of the running worker ----------------- */
const { PRECACHE, BYPASS_PATHS, IMMUTABLE_PATHS, typeMatchesUrl } = sandbox.__sw;

/* If a rename happened, say so in words rather than dying on a TypeError six
 * assertions later — the failure this suite exists to catch is subtle enough
 * without its own reporting being cryptic. */
for (const [name, value] of Object.entries({ PRECACHE, BYPASS_PATHS, IMMUTABLE_PATHS, typeMatchesUrl })) {
  if (value === undefined) {
    console.error(`✗ sw.js no longer defines \`${name}\` — this suite is testing nothing until that is fixed`);
    process.exit(1);
  }
}

console.log('\nprecache — the install-time floor');
{
  ok('precache is a short hand-written floor, not a file list', PRECACHE.length <= 5);
  ok(
    'NOTHING under seasons/data/ is precached — 22 MB of history must never be an install cost',
    !PRECACHE.some((p) => p.includes('seasons/data')),
  );
  ok(
    'and nothing else large sneaks in either — every entry is the shell, the manifest or an icon',
    PRECACHE.every((p) => p === './' || /manifest|icon/.test(p)),
  );
}

console.log('\nrouting — which strategy a path gets');
{
  const strategy = (pathname) => {
    if (BYPASS_PATHS.some((p) => pathname.startsWith(p))) return 'bypass';
    if (IMMUTABLE_PATHS.some((p) => pathname.startsWith(p))) return 'cache-first';
    return 'network-first';
  };

  eq('live storm data is never touched', strategy('/api/storms'), 'bypass');
  eq('the tile proxy is never touched', strategy('/tiles/3/2/1.pbf'), 'bypass');
  eq('vendored libraries are cache-first', strategy('/vendor/three-0.128.0.min.js'), 'cache-first');
  eq(
    'settled history is cache-first — the revision stamp is in the filename',
    strategy('/seasons/data/hurdat2-atlantic-2025-02272026.txt'),
    'cache-first',
  );
  eq(
    'a single sliced season too',
    strategy('/seasons/data/atlantic-1935-02272026.txt'),
    'cache-first',
  );
  eq(
    'but the pointer that NAMES those files must revalidate',
    strategy('/seasons/index.json'),
    'network-first',
  );
  eq('and the feature code beside it must revalidate', strategy('/seasons/index.js'), 'network-first');
  eq('ordinary modules are network-first', strategy('/lib/hurdat.js'), 'network-first');
  eq('the shell is network-first', strategy('/index.html'), 'network-first');
}

console.log('\nthe fallback-page guard — what stops a 404 becoming permanent');
{
  const res = (contentType) => ({ headers: { get: () => contentType } });
  const html = res('text/html; charset=utf-8');
  const HOST = 'https://landfall.getgravitate.app';

  ok(
    'an HTML answer for a season .txt is REFUSED — this is the whole reason txt is in the list',
    typeMatchesUrl(html, `${HOST}/seasons/data/hurdat2-atlantic-2025-02272026.txt`) === false,
  );
  ok(
    'an HTML answer for a vendor .js is refused — the original black screen',
    typeMatchesUrl(html, `${HOST}/vendor/maplibre-gl-5.6.0.js`) === false,
  );
  ok(
    /* ==> `seasons/data/` HOLDS A SECOND FILE TYPE SINCE §57.7a. <== The
     * computed landfalls are `.json` under a CACHE-FIRST, immutable path.
     * A cache-first path is where a transient 404 answered with the app shell
     * becomes permanent, so the guard has to refuse HTML for this shape too —
     * and it is a different extension under the same path from the `.txt`
     * above, which is exactly the pairing nothing else in the repo checks. */
    'an HTML answer for a computed-landfalls .json is refused',
    typeMatchesUrl(html, `${HOST}/seasons/data/atlantic-landfalls-02272026.json`) === false,
  );
  ok(
    /* ==> AND A THIRD FILE TYPE SINCE §57.7b. <== The land mask is
     * `landmask-*.bin.gz` under the same cache-first, immutable path.
     * `lib/land-mask.js` checks its magic bytes, so an HTML page in its place
     * throws rather than answering wrongly — but on a cache-first path a bad
     * answer is never re-fetched, so it would throw FOREVER and the running
     * season would silently lose its landfalls until someone cleared the
     * cache. Loud-but-permanent is still the wrong outcome. */
    'an HTML answer for the land mask .gz is refused',
    typeMatchesUrl(html, `${HOST}/seasons/data/landmask-v5.1.2-0.02.bin.gz`) === false,
  );
  ok(
    'and real gzip bytes for it are accepted',
    typeMatchesUrl(res('application/gzip'), `${HOST}/seasons/data/landmask-v5.1.2-0.02.bin.gz`) === true,
  );
  ok(
    'and real JSON for it is accepted',
    typeMatchesUrl(res('application/json'), `${HOST}/seasons/data/atlantic-landfalls-02272026.json`) === true,
  );
  ok(
    'an HTML answer for the index .json is refused',
    typeMatchesUrl(html, `${HOST}/seasons/index.json`) === false,
  );
  ok(
    'plain text for a .txt is accepted',
    typeMatchesUrl(res('text/plain'), `${HOST}/seasons/data/atlantic-1935-02272026.txt`) === true,
  );
  ok(
    'and an octet-stream .txt is accepted too — the guard only rejects HTML',
    typeMatchesUrl(res('application/octet-stream'), `${HOST}/seasons/data/atlantic-1935-02272026.txt`) === true,
  );
  ok(
    'HTML for a navigation is fine — that IS the shell',
    typeMatchesUrl(html, `${HOST}/`) === true,
  );
  ok(
    'a query string does not smuggle a bad answer past the guard',
    typeMatchesUrl(html, `${HOST}/seasons/data/atlantic-1935-02272026.txt?v=2`) === false,
  );
}

console.log('\nevery cache-first path has its file type guarded');
{
  /* The rule this asserts is the one that is easy to break by hand: adding a
   * path to IMMUTABLE_PATHS without adding its extension to typeMatchesUrl.
   * Checked by BEHAVIOUR — feed the guard an HTML answer for a real filename
   * from each cache-first path and require a refusal. */
  const sampleFor = {
    '/vendor/': 'maplibre-gl-5.6.0.js',
    '/seasons/data/': 'hurdat2-atlantic-2025-02272026.txt',
  };
  for (const path of IMMUTABLE_PATHS) {
    const sample = sampleFor[path];
    ok(
      `${path} has a sample filename in this test — a new cache-first path needs one added here`,
      !!sample,
    );
    if (!sample) continue;
    ok(
      `${path} refuses an HTML fallback page`,
      typeMatchesUrl({ headers: { get: () => 'text/html' } }, `https://landfall.getgravitate.app${path}${sample}`) === false,
    );
  }
}

/* --- report --------------------------------------------------------------- */
console.log('');
if (failures.length) {
  console.error(`✗ ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`✓ ${passed} assertions passed`);
console.log('  (routing only — it cannot tell you the worker installs, or that offline works on a phone)');
