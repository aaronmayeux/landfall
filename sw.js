/**
 * sw.js — the service worker. Installability + offline shell (SPEC §14 Phase 5).
 *
 * WHAT IT DOES, in one breath: app code is NETWORK-FIRST (fresh when online,
 * cached copy when not), pinned CDN libraries are CACHE-FIRST (version-pinned
 * URLs never change), and DATA IS NEVER TOUCHED — /api/, NOAA, GDACS, tiles
 * and fonts all pass straight through to the network and the app's own §5
 * failure states.
 *
 * WHY NETWORK-FIRST AND NOT STALE-WHILE-REVALIDATE for our own code: the
 * roadmap's shorthand said SWR, but SWR serves the OLD copy first and updates
 * behind it — on this project that guarantees "pushed the fix, phone still
 * shows the bug" on every single deploy-and-check loop. Network-first costs
 * nothing while online (the network was being hit anyway) and keeps the deploy
 * loop honest. The cache is a FALLBACK, not a speed layer. Deviation recorded
 * in SPEC §14.
 *
 * WHY DATA IS EXCLUDED: caching storm data here would hand the app stale
 * advisories with no timestamp semantics — store.js owns freshness, staleness
 * banding, and the unavailable/none_matched/clear distinction (§5). A cache
 * this low in the stack cannot tell "stale but shown honestly" from "stale
 * and lying". `/tiles/` is excluded for a different reason: it is the dormant
 * R2 tile proxy (§3), and runtime-caching tiles is unbounded quota growth.
 *
 * `/seasons/data/` IS NOT AN EXCEPTION TO THAT RULE — IT IS A DIFFERENT KIND
 * OF THING. Those files are NOAA's settled history: 1851 through last season,
 * with the revision stamp in the filename. There is no such thing as a stale
 * copy of a file that can never change, so none of the freshness reasoning
 * above applies. It is cache-first for the same reason `/vendor/` is (§58.4).
 *
 * WHY NO PRECACHED FILE LIST: no build step means any hand-maintained module
 * list WILL go stale (the same argument SPEC makes about documentation). The
 * runtime cache captures every file the app actually loads, on the first load
 * the worker controls — offline therefore works from the SECOND visit on,
 * which for an installed app means: install, open once, offline works.
 *
 * CONSTANTS LIVE HERE, not in config/constants.js — a service worker is a
 * separate JS context that cannot import the app's ES modules. Deliberate
 * §"Tuning" deviation, contained to this file.
 *
 * BUMP `VERSION` to invalidate every cached asset at once. Not needed for
 * routine deploys (network-first refreshes organically); it is the hammer for
 * a poisoned cache.
 */

/* v2: the CDN libraries moved to same-origin ./vendor/ (SPEC §17 A3), so every
 * v1 cache holds unpkg entries for URLs the app will never request again.
 *
 * v3: PURGES A POISONED CACHE. v2 stored Cloudflare's HTML fallback page under
 * the vendor .js filenames during the window those files were missing from the
 * repo, then served it forever — see typeMatchesUrl() below for the mechanism.
 * Every v2 cache is therefore suspect and is dropped wholesale on activate.
 * This is the "hammer for a poisoned cache" this constant was documented for;
 * it is the first time it has been needed. */
const VERSION = 'v3';
const CACHE = `landfall-${VERSION}`;

/* The floor: enough to boot offline even if the first controlled load never
 * happens. Everything else is captured at runtime. */
const PRECACHE = [
  './',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
];

/* Same-origin path prefixes the worker must never intercept. */
const BYPASS_PATHS = ['/api/', '/tiles/'];

/* Same-origin path prefixes eligible for cache-first. `./vendor/` holds the
 * pinned MapLibre and Three builds (SPEC §17 A3); the VERSION IS IN EACH
 * FILENAME, so one of these URLs can never mean something new — the same
 * property that made the old unpkg URLs safe to cache forever, now on our own
 * origin. A library bump changes the filename, so it simply misses and
 * refetches; no invalidation needed.
 *
 * NO CROSS-ORIGIN HOST IS CACHE-FIRST ANY MORE. openfreemap, NOAA and GDACS
 * were never eligible and still are not.
 *
 * `/seasons/data/` EARNS THE SAME TREATMENT FOR THE SAME REASON. Those are
 * NOAA's HURDAT2 files and their filenames carry both the last season and
 * NOAA's revision stamp — `hurdat2-atlantic-2025-02272026.txt` — so one of
 * these URLs can never mean something new either. `_headers` already serves
 * them `immutable` for a year; without this entry they fell into
 * networkFirst(), which fetches with `cache: 'no-cache'` and would have forced
 * a revalidation round trip on every load of a file the HTTP layer had just
 * been told to keep forever. THE WORKER WAS ABOUT TO OVERRIDE THE HEADER. It
 * also means the archive works offline, which is the whole point of holding
 * 22 MB of history on our own origin rather than proxying NOAA.
 *
 * ==> THE `.txt` IN typeMatchesUrl() BELOW IS PART OF THIS ENTRY, NOT A
 * SEPARATE TIDY-UP. <== Cache-first is what turns a transient 404 into a
 * permanent one, and that guard is the only thing standing between a
 * momentarily-missing season file and an HTML fallback page served as history
 * forever. Adding a path here without adding its file extension there is a
 * loaded gun. */
const IMMUTABLE_PATHS = ['/vendor/', '/seasons/data/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  /* Cross-origin is now entirely untouched: tiles, fonts, imagery and the
   * upstream feeds all get the browser default. Nothing we load from another
   * origin is version-pinned any more. */
  if (!sameOrigin) return;

  if (BYPASS_PATHS.some((p) => url.pathname.startsWith(p))) return;

  if (IMMUTABLE_PATHS.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(cacheFirst(req));
    return;
  }

  event.respondWith(networkFirst(req));
});

/**
 * Is this response actually the KIND of thing the URL asked for?
 *
 * ==> THIS GUARD EXISTS BECAUSE ITS ABSENCE BLACK-SCREENED THE APP. <==
 * When `vendor/` was briefly missing from the repo, `/vendor/maplibre-gl.js`
 * did not fail — Cloudflare Pages answered it with the `index.html` FALLBACK,
 * as HTML, and `res.ok` was true. So cacheFirst stored an HTML page under a
 * `.js` filename and, because this path is deliberately "immutable, serve
 * from cache forever", kept serving it after the real file was deployed.
 * The browser then refused to execute it ("MIME type ('text/html') is not
 * executable"), `maplibregl` was undefined, and the globe never built.
 *
 * **A CACHE-FIRST PATH TURNS A TRANSIENT 404 INTO A PERMANENT ONE.** The
 * server was fixed within minutes; the poisoned cache would have outlived
 * every future deploy, because the whole point of cache-first is never
 * asking again. That is a far worse failure than the missing file, and it is
 * the §5 shape once more: a confident wrong answer beats no answer at being
 * hard to notice.
 *
 * The rule: an HTML response for a .js or .css request is a fallback page,
 * never the asset. Refuse to cache it and refuse to serve it.
 *
 * ==> `.txt` IS IN THE LIST BECAUSE `/seasons/data/` IS NOW CACHE-FIRST. <==
 * The season files are the only plain-text assets the app fetches, and they
 * are the exact shape this guard was written for: a large file, requested
 * rarely, on a path that never asks twice. Cloudflare Pages answers a missing
 * one with `index.html` at 200, so without `txt` here a browser that opened
 * the archive during a bad deploy would hold an HTML page as the 1851-2025
 * Atlantic record and never look again — and unlike the vendor case there is
 * no MIME error to make it obvious, just a parser finding no storms and the
 * archive looking empty rather than broken.
 */
function typeMatchesUrl(res, url) {
  const type = (res.headers.get('Content-Type') || '').toLowerCase();
  if (!type.includes('text/html')) return true;
  return !/\.(js|css|mjs|json|txt|png|webmanifest)$/i.test(new URL(url).pathname);
}

/* Version-pinned vendor files: a URL that can never mean something new is safe
 * to serve from cache forever — PROVIDED what we cached is really the file. */
async function cacheFirst(req) {
  const cached = await caches.match(req);
  /* Validate on the way OUT as well as the way in. An already-poisoned cache
   * from a previous worker version is exactly the case that needs this, and
   * bumping VERSION alone would only help browsers that get as far as
   * activating the new worker. */
  if (cached && typeMatchesUrl(cached, req.url)) return cached;

  const res = await fetch(req);
  if (res.ok && typeMatchesUrl(res, req.url)) {
    const cache = await caches.open(CACHE);
    cache.put(req, res.clone());
  }
  return res;
}

/* Our own code: the network is the truth; the cache is what offline gets.
 * A navigation with no exact cache entry falls back to the shell — the app
 * is a single page, so './' answers every route. */
async function networkFirst(req) {
  try {
    /* ===> `cache: 'no-cache'` IS LOAD-BEARING. THIS FUNCTION WAS LYING. <===
     * A plain fetch() consults the browser's own HTTP cache first. Our modules
     * were served with no Cache-Control header at all (measured on the live
     * site), so the browser was free to invent a lifetime and answer from disk
     * — and this function would return that stale copy believing it had just
     * come from the network. The whole "network-first keeps the deploy loop
     * honest" argument at the top of this file was false for any module the
     * browser had decided to hold.
     *
     * That is how the app ran a MIXED VERSION: index.html is pinned no-cache
     * in _headers, so the shell was always fresh and free to import stale
     * modules beneath it. Seen live as an ended storm drawn grey in the list
     * and pink at full height on the globe.
     *
     * `no-cache` forces a revalidation, not a re-download: with an ETag the
     * answer is a 304 and almost no bytes. `_headers` now sets the same
     * directive on those modules, and the two are deliberate belt AND braces —
     * the header binds a well-behaved cache, this binds the fetch itself.
     *
     * NAVIGATIONS ARE EXEMPT ON PURPOSE. Passing an init object makes fetch
     * construct a new Request from `req`, and a Request whose mode is
     * `navigate` cannot be constructed that way — it throws. index.html
     * already carries no-cache in _headers, so navigations were never the
     * hole. */
    const res = await fetch(req, req.mode === 'navigate' ? undefined : { cache: 'no-cache' });
    if (res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const shell = await caches.match('./');
      if (shell) return shell;
    }
    throw err;
  }
}
