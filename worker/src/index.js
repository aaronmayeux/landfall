/**
 * index.js — the cron Worker. SPEC §17 Pass B, the origin collapse.
 *
 * WHAT IT IS FOR, in one paragraph. Every relay route caches in
 * `caches.default`, which is PER-DATACENTER. Cloudflare has 300+ colos, so
 * `s-maxage=300` never meant "NOAA is fetched once per five minutes" — it
 * meant up to ~300 times per five minutes, at one user and at a hundred
 * thousand alike, and the first visitor in every region ate a full round trip
 * to NOAA. This Worker fetches each feed ONCE globally on a schedule and puts
 * it in KV; the Pages Functions read KV. Origin fetches drop from ~300 per
 * interval to 1, forever, at any traffic level.
 *
 * ===> WHY THIS IS A SEPARATE WORKER AND NOT PART OF PAGES. <===
 * MEASURED against Cloudflare's own Pages-to-Workers migration guide,
 * 2026-07-25: **Cron Triggers are supported on Workers and unsupported on
 * Pages.** Migrating the whole Pages project to Workers to get a scheduler
 * would put a deployment that currently works at risk for one feature. So:
 * one small standalone Worker beside the Pages project, both binding the SAME
 * KV namespace. Pages supports KV bindings; that is all it needs to.
 *
 * ===> AND WHY IT CANNOT TAKE THE APP DOWN. <===
 * The lesson from the Analytics Engine failure two days before this was
 * written (§17): one unusable binding took down ALL `/api/` routes, because
 * Pages Functions publish as a single Worker and a binding that cannot resolve
 * fails the whole deploy. This Worker is a separate deploy — it cannot fail
 * the Pages build, cannot block a fix during a storm, and if it dies entirely
 * every route falls back to fetching upstream exactly as it did before Pass B.
 * **Landfall's ability to ship a fix during a storm must never depend on an
 * infrastructure feature.** That rule cost a day; it is honoured structurally
 * here rather than remembered.
 *
 * WHAT IT DOES, in order:
 *   1. warm the three fixed list feeds
 *   2. read those lists back, derive the per-storm product URLs
 *   3. warm those, bounded and concurrency-limited
 *   4. write only what CHANGED (worker/src/kv.js)
 *
 * It fetches OUR OWN relay routes rather than the upstream sources — see the
 * header of worker/src/sources.js, that decision is the load-bearing one.
 */

import { LIST_FEEDS, nhcDerived, jtwcDerived, gdacsDerived, tcgpDerived } from './sources.js';
import { loadHashes, writeIfChanged } from './kv.js';

/* ---------------------------------------------------------------------------
 * TUNING — every behavioural constant, defined before the logic that uses it
 * (§ project instructions). No unexplained numbers.
 * ------------------------------------------------------------------------- */

/** Parallel fetches against our own origin. Six is polite to the Pages
 *  project and fast enough that a full fan-out over a busy season finishes in
 *  a few seconds — well inside a cron invocation's budget. Higher buys
 *  nothing: the slow part is the upstream fetch behind each route, and those
 *  hit four different providers who each rate-limit separately. */
const CONCURRENCY = 6;

/** Per-request abort. Generous, because a cold route behind this is doing a
 *  real upstream fetch — GDACS geometry has measured 1.3-1.5 s and its
 *  legendary slow days are the reason it is cached at all. A request past
 *  this is a failure, and a failure here costs nothing: the entry keeps its
 *  previous value and the next cycle tries again in five minutes. */
const FETCH_TIMEOUT_MS = 25 * 1000;

/** Hard ceiling on derived entries per cycle. A runaway upstream — a feed
 *  that suddenly lists four hundred systems, a parser change on their end —
 *  must not turn into four hundred KV writes and four hundred requests
 *  against the sources. The active global basins have peaked at 8-9 storms at
 *  once (§4), each contributing at most three derived products, so 64 is
 *  roughly 2.5x the realistic worst case: high enough never to bite in
 *  practice, low enough to bound the bill if something upstream goes strange.
 *  IT IS LOGGED WHEN IT TRIPS — a silent cap reads as "we warmed everything"
 *  when we did not. */
const MAX_DERIVED = 64;

/* ------------------------------------------------------------------------- */

const withTimeout = async (url, init) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Fetch one of our own relay routes, bypassing its caches.
 *
 * ===> THE BYPASS HEADER IS WHY THIS WORKS AT ALL. <===
 * Without it the Worker's request is an ordinary one: the route answers from
 * its colo cache or from the KV copy the PREVIOUS cycle wrote, we store what
 * we were already storing, and the warm loop confirms its own last answer
 * forever while never once contacting the source. At a 5-minute cron against a
 * 5-minute fresh window this is not a corner case — it is the boundary the
 * schedule lands on every single time.
 *
 * It is gated on a shared secret because an ungated cache-bypass is a lever
 * any stranger can pull to drive uncached traffic straight through us at NOAA
 * — the open-proxy problem §17 A2 closed on the inspect routes, reopened on
 * the feeds themselves. No secret configured means no bypass is possible: the
 * routes simply never honour the header, and the worst case is a warm loop
 * that goes quiet rather than a hole.
 */
async function fetchRoute(env, route) {
  const base = String(env.SITE_ORIGIN || '').replace(/\/+$/, '');
  if (!base) throw new Error('SITE_ORIGIN is not set');

  const headers = { 'User-Agent': 'Landfall-Warm/1.0 (+https://landfall.getgravitate.app)' };
  if (env.WARM_KEY) headers['X-Landfall-Warm'] = env.WARM_KEY;

  const r = await withTimeout(`${base}${route}`, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  /* THE HEADERS COME BACK TOO, because one entry decides whether to store
   * itself by reading them. The genesis outlook says on the wire whether it is
   * serving a HELD body and how many areas are in it, and writing a held body
   * back would restamp its own age forever — `worker/src/sources.js` has the
   * argument. Every other entry ignores this and is unaffected. */

  /* ===> DID THE ROUTE ACTUALLY HONOUR THE BYPASS? <===
   * A mismatched WARM_KEY does not fail. The route answers 200 from the KV
   * copy the PREVIOUS cycle wrote, we store what we already stored, and every
   * number in the summary looks perfectly healthy while the loop confirms its
   * own last answer forever and the source is never contacted again.
   *
   * `X-Landfall-Fetched-At` distinguishes the two without a single change to
   * the routes: on an upstream fetch it is stamped NOW; served from KV it
   * carries the OLD stamp. So a stamp older than a minute means the request
   * was answered from cache — the bypass was refused, and the whole warm loop
   * is decorative. Reported per entry and counted in the summary, because the
   * one thing this loop must never be is quietly ineffective (§5).
   *
   * `unknown` is honest, not a pass: /api/jtwc/storms carries its fetchedAt in
   * the JSON body rather than a header, so there is nothing here to read. */
  const stamp = r.headers.get('X-Landfall-Fetched-At');
  const stampedMs = stamp ? Date.parse(stamp) : NaN;
  const bypassed = Number.isFinite(stampedMs)
    ? Date.now() - stampedMs < 60 * 1000
    : 'unknown';

  return { body: await r.text(), headers: r.headers, bypassed };
}

/** Run tasks with a fixed number of workers. Same shape as the mapLimit in
 *  functions/api/jtwc/storms.js, for the same reason: unbounded Promise.all
 *  over a list whose length comes from a feed is a fan-out with no ceiling. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        out[i] = { error: (e && e.message) || String(e) };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * One warm cycle. Returns a summary — it is what the manual trigger renders
 * and what the scheduled run logs.
 *
 * NOTHING HERE THROWS ON A PARTIAL FAILURE. A dead GDACS must not stop the
 * NHC feeds from being warmed; each entry is an independent slot, exactly as
 * §5 requires of every async surface in the app. The summary names what
 * failed so a bad cycle is visible in the log rather than inferred from a
 * store that stopped moving.
 */
export async function warm(env) {
  const kv = env.LANDFALL_CACHE;
  if (!kv || typeof kv.put !== 'function') {
    /* Named plainly rather than thrown into a stack trace nobody reads. A
     * binding is either there or the whole point of this Worker is absent —
     * there is no partial version of it. */
    return { ok: false, error: 'LANDFALL_CACHE binding is missing or is not a KV namespace' };
  }

  const hashes = await loadHashes(kv);
  const counts = { written: 0, restamped: 0, skipped: 0, failed: 0 };
  const failures = [];

  /* ==> A SKIP IS NAMED, NOT JUST COUNTED. <==
   * A skipped entry is a route that answered 200 with an EMPTY body, so
   * `writeIfChanged` refused to store it — the right call, since caching
   * nothing globally is worse than one colo missing. But refusing to store it
   * means that key keeps whatever it held last and quietly stops tracking the
   * world, and `skipped: 1` in a summary does not say WHICH of nineteen keys
   * that is. A number you cannot act on is the same silence §5 is organised
   * against, one level up: the cycle looks healthy and one feed is dark.
   * Named exactly as `failures` already is, for the same reason. */
  const skipped = [];

  /* ==> A WITHHELD WRITE IS NAMED, FOR THE SAME REASON A SKIP IS. <==
   * An entry can decline its own write when the route says it is serving a
   * REMEMBERED answer rather than a fresh one — see the genesis entry in
   * `sources.js`. That refusal is correct and is how the hold eventually
   * lapses, but it means a key deliberately stopped being re-stamped, and a
   * cycle summary that did not say so would report a perfectly healthy run
   * while a feed sat frozen. `withheld: 1` with no name is the same silence
   * §5 is organised against, one level up. */
  const withheld = [];

  const bodies = new Map();

  const bypass = { reachedSource: 0, servedFromCache: [], unknown: 0 };

  const store = async (entry) => {
    let got;
    try {
      got = await fetchRoute(env, entry.route);
    } catch (e) {
      counts.failed++;
      failures.push(`${entry.path}: ${(e && e.message) || e}`);
      return;
    }

    if (got.bypassed === true) bypass.reachedSource++;
    else if (got.bypassed === false) bypass.servedFromCache.push(entry.path);
    else bypass.unknown++;

    bodies.set(entry.path, got.body);

    /* No gate means write, which is every entry but one. A gate that says no
     * leaves the key exactly as it was, ageing. */
    if (entry.store && !entry.store(got.headers)) {
      withheld.push(entry.path);
    } else {
      const result = await writeIfChanged(kv, entry.path, got.body, hashes);
      counts[result]++;
      if (result === 'skipped') skipped.push(entry.path);
    }

    /* A SECOND KEY OFF THE SAME FETCH, on a stricter gate. `nhc/genesis/areas`
     * takes any answer NHC actually gave, including a genuine all-clear;
     * `.../last-good` takes only the ones that had areas in them, because it
     * exists to answer "when did NHC last publish areas" and an empty body
     * would make it remember having no memory. One request, two questions. */
    if (entry.lastGood) {
      if (entry.lastGood.store(got.headers)) {
        const result = await writeIfChanged(kv, entry.lastGood.path, got.body, hashes);
        counts[result]++;
        if (result === 'skipped') skipped.push(entry.lastGood.path);
      } else {
        withheld.push(entry.lastGood.path);
      }
    }
  };

  /* ---- 1. the fixed list feeds ---- */
  await mapLimit(LIST_FEEDS, CONCURRENCY, store);

  /* ---- 2. derive per-storm work from what came back ---- */
  const parse = (path) => {
    const body = bodies.get(path);
    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  };

  let derived = [
    ...nhcDerived(parse('nhc/storms') || {}),
    ...jtwcDerived(parse('jtwc/storms') || {}),
    ...gdacsDerived(parse('gdacs/events') || {}),
    ...tcgpDerived(parse('tcgp/storms') || {}),
  ];

  /* Deduplicate before capping. Two feeds can name the same product — JTWC's
   * index and a GDACS event both point at the same Pacific storm — and
   * warming a key twice in one cycle is a wasted request and a wasted write. */
  const seen = new Set();
  derived = derived.filter((d) => (seen.has(d.path) ? false : (seen.add(d.path), true)));

  const dropped = Math.max(0, derived.length - MAX_DERIVED);
  if (dropped > 0) {
    console.log(
      `[landfall-warm] derived cap hit: warming ${MAX_DERIVED} of ${derived.length} entries, ` +
        `${dropped} NOT warmed this cycle`
    );
    derived = derived.slice(0, MAX_DERIVED);
  }

  /* ---- 3. warm them ---- */
  await mapLimit(derived, CONCURRENCY, store);

  /* A cycle that stored everything successfully but never reached a source is
   * a FAILING cycle wearing a passing summary. Say so in one plain sentence,
   * at the top, rather than leaving it to be inferred from counters. */
  const warning = bypass.servedFromCache.length
    ? 'BYPASS REFUSED on ' + bypass.servedFromCache.length + ' route(s) — WARM_KEY ' +
      'likely missing or mismatched on the Pages project. The warm loop is ' +
      're-confirming its own previous answer and NOT contacting the sources.'
    : null;

  return {
    ok: true,
    ...(warning ? { warning, servedFromCache: bypass.servedFromCache } : {}),
    lists: LIST_FEEDS.length,
    derived: derived.length,
    dropped,
    ...counts,
    reachedSource: bypass.reachedSource,
    bypassUnknown: bypass.unknown,
    failures,
    /* Empty on a healthy cycle, exactly like `failures`. Present always rather
     * than conditionally, so its absence never has to be distinguished from
     * an older build that could not report it. */
    skippedPaths: skipped,
    /* Same contract as `skippedPaths`: always present, empty on an ordinary
     * cycle. A non-empty list here is not a fault — it says the genesis outlook
     * is being HELD, which is the relay working. It is only alarming if it
     * stays non-empty past HELD_SECONDS, at which point the route will have
     * stopped honouring the memory anyway and the app is showing a real
     * all-clear again. */
    withheldPaths: withheld,
  };
}

export default {
  /**
   * The scheduled entry. Cadence is set in wrangler.toml, not here — a
   * schedule written in two places drifts.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      warm(env).then((summary) => {
        /* Console logs reach Cloudflare's real-time Worker logs with zero
         * configuration, which is the same fallback sink §17 A5 settled on
         * after Analytics Engine turned out to need an entitlement. A
         * diagnostics feature must never be a prerequisite. */
        console.log('[landfall-warm]', JSON.stringify(summary));
      })
    );
  },

  /**
   * A manual trigger, gated. `GET /warm?key=<WARM_KEY>`.
   *
   * Worth the fifteen lines: without it, checking whether a change to this
   * Worker actually works means deploying and waiting up to five minutes to
   * read a log, which is how a debugging session turns into an afternoon.
   *
   * FAILS CLOSED and answers 404 rather than 403 for everything else, which
   * is the identical posture `functions/api/_inspect-guard.js` settled on:
   * a 403 advertises that something is there. With no WARM_KEY set, nothing
   * can reach this — including us.
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = env.WARM_KEY;
    const notFound = new Response('Not found', { status: 404 });

    if (!key) return notFound;
    if (url.pathname !== '/warm') return notFound;
    if (url.searchParams.get('key') !== key) return notFound;

    const summary = await warm(env);
    return new Response(JSON.stringify(summary, null, 2), {
      status: summary.ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  },
};
