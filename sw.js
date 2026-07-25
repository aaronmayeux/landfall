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
 * v1 cache holds unpkg entries for URLs the app will never request again. */
const VERSION = 'v2';
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
 * were never eligible and still are not. */
const IMMUTABLE_PATHS = ['/vendor/'];

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

/* Version-pinned vendor files: a URL that can never mean something new is safe
 * to serve from cache forever. */
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) {
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
    const res = await fetch(req);
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
