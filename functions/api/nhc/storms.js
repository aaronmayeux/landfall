/**
 * /api/nhc/storms — the relay's first job (SPEC §4).
 *
 * Forward-and-cache ONLY. The app merges NHC and GDACS client-side; this
 * function must stay dumb — no parsing, no merging, no per-storm logic. It
 * exists for exactly one reason: www.nhc.noaa.gov sends no CORS header, so the
 * browser cannot fetch CurrentStorms.json directly (verified in-browser
 * 2026-07-22).
 *
 * Cloudflare Pages Functions run in their own workerd runtime, separate from
 * the app bundle, so this file is SELF-CONTAINED on purpose — importing
 * config/constants.js would couple the deploy of a static site to a bundler
 * step we otherwise don't have. The two numbers below mirror SPEC §4's cache
 * table; if that table changes, change them here too (the table is the truth).
 */

import { kvRead, isWarmRequest } from '../_kv-cache.js';

const UPSTREAM = 'https://www.nhc.noaa.gov/CurrentStorms.json';

/** The KV path the cron Worker warms this route under (SPEC §17 Pass B).
 *  Must match `worker/src/sources.js` — tools/test-kv-keys.mjs asserts it. */
const KV_PATH = 'nhc/storms';

/** SPEC §4 cache table: 30 min, matching the GDACS list.
 *
 *  WIDENED FROM 5 MIN 2026-08-01, ALONGSIDE ITS SIBLING AND FOR THE SIBLING'S
 *  REASON. `gdacs/events.js` carries the full account; the short version is
 *  that a 5-minute window refilled by a 5-minute cron expires exactly as its
 *  replacement is due, and every request landing in that gap goes to the
 *  origin. On GDACS that cost 20 s and timed the client out. On NOAA it never
 *  bit, because CurrentStorms.json is small and close — which made this the
 *  same loaded gun, pointed at a season when it matters most.
 *
 *  NHC re-issues on a 6-hourly advisory cycle with intermediates between. 30
 *  min is well inside that, and the 5-minute cron means the copy served is
 *  0-5 minutes old in practice. Serving a poll its own previous copy — the
 *  thing the old number prevented — costs nothing. */
const FRESH_SECONDS = 30 * 60;

/** Serve-stale window on upstream failure: ~1.5x advisory cadence, the same
 *  9 h the client's last-good cache uses. Stale + timestamp beats blank. */
const STALE_SECONDS = 9 * 60 * 60;

/** NOAA servers 403 requests with no User-Agent. Identify ourselves plainly. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** How long this route will wait on nhc.noaa.gov before answering from cache
 *  instead.
 *
 *  ==> ADDED FOR PARITY, NOT BECAUSE NOAA WAS EVER MEASURED SLOW. <== This
 *  route carried the wider cache window from the 2026-08-01 DOLPHIN-26 fix but
 *  not the two behaviours that came with it, on the reasoning that a working
 *  path in hurricane season is not where to prove a pattern. That reasoning
 *  had a shelf life and it has expired: the gap was the same loaded gun, and
 *  the parity rule says both sources get every data behaviour.
 *
 *  `fetch()` with no signal has no deadline. The client hangs up at
 *  POLL.fetchTimeout; without a budget this function would keep holding the
 *  line long after nobody was listening, with a usable cached copy one
 *  `cache.match` away. 10 s is Aaron's stated ceiling for how long a storm may
 *  take to appear, and it matches `gdacs/events.js` deliberately — one number,
 *  both sources.
 *
 *  It only ever applies on a genuine cold miss. Every other path now answers
 *  from cache immediately and refreshes behind the response. */
const UPSTREAM_BUDGET_MS = 10 * 1000;

const baseHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});

/**
 * WHICH OF THE FIVE PATHS BELOW ANSWERED. One word, on every response.
 *
 * ==> IT EXISTS BECAUSE A FOUR-DAY-OLD TIMESTAMP COST TWO SESSIONS. <==
 * `X-Landfall-Fetched-At` says WHEN the copy was pulled and says nothing about
 * WHERE it came from, and those are different questions the moment anything
 * goes wrong. A stamp an hour old is routine off the last-good slot and alarming
 * off a fresh upstream fetch; from the header alone the two are identical. Every
 * diagnosis of this route so far has been an inference about which branch ran.
 * Now it is stated.
 *
 * Costs one header on a response that already carries eight.
 */
const PATH = Object.freeze({
  /** L1, this colo's 30-minute slot. */
  FRESH: 'fresh',
  /** L2, the globally warmed KV copy, inside its freshness window. */
  KV: 'kv',
  /** L1's 9-hour slot, served immediately with a refresh behind it. */
  LAST_GOOD: 'last-good',
  /** The KV copy declined as too old, served anyway rather than blank (§5). */
  KV_STALE: 'kv-stale',
  /** A real fetch to NOAA just happened. */
  UPSTREAM: 'upstream',
});

/** Fetch CurrentStorms.json and write both cache slots. Returns the body, or
 *  throws. Shared by the blocking cold-miss path and the background refresh so
 *  there is ONE definition of "what a successful pull does" — splitting those
 *  two without sharing the writes is how a background refresh quietly stops
 *  populating last-good. Mirrors `gdacs/events.js`'s helper of the same name. */
async function pullUpstream(context, cache, freshKey, lastGoodKey) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_BUDGET_MS);
  let body;
  try {
    const r = await fetch(UPSTREAM, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
    body = await r.text();
  } finally {
    clearTimeout(timer);
  }

  /* Refuse to cache non-JSON (an upstream error page would otherwise be served
   * as "storm data" for the whole fresh window). Parse to check, forward as
   * text. */
  JSON.parse(body);

  const fetchedAt = new Date().toISOString();
  const headers = baseHeaders({
    'X-Landfall-Fetched-At': fetchedAt,
    'X-Landfall-Cache': PATH.UPSTREAM,
  });

  await Promise.all([
    cache.put(
      freshKey,
      new Response(body, {
        headers: { ...headers, 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
      })
    ),
    cache.put(
      lastGoodKey,
      new Response(body, {
        headers: { ...headers, 'Cache-Control': `s-maxage=${STALE_SECONDS}` },
      })
    ),
  ]);

  return { body, headers };
}

export async function onRequestGet(context) {
  const cache = caches.default;

  /* Two cache slots: FRESH (5 min, the normal path) and LAST-GOOD (9 h, only
   * read when upstream fails). Synthetic keys — they name the slot, nothing
   * routes to them. */
  const freshKey = new Request('https://landfall-relay.internal/nhc/storms/fresh');
  const lastGoodKey = new Request('https://landfall-relay.internal/nhc/storms/last-good');

  /* SPEC §17 Pass B — three levels: this colo's cache, then the globally
   * warmed KV copy, then upstream. The cron Worker skips the first two so a
   * warm cycle actually reaches the source (functions/api/_kv-cache.js). */
  const warming = isWarmRequest(context.request, context.env);

  /* A warm cycle skips every cache, including the serve-then-refresh path
   * below: a warm request answered from cache would never pull anything and
   * the Worker would spend forever re-confirming its own last answer. */
  if (warming) {
    const { body, headers } = await pullUpstream(context, cache, freshKey, lastGoodKey);
    return new Response(body, { headers });
  }

  /* ===================================================================
   * L1 HIT — AND THE RESPONSE IS REBUILT, NEVER HANDED BACK AS STORED.
   * ===================================================================
   *
   * ==> `return hit` LET A BAD TIMESTAMP OUTLIVE ITS OWN FIX BY HALF AN
   *     HOUR. MEASURED LIVE 2026-08-07, NOT REASONED ABOUT. <==
   *
   * The slot Responses above are stored with `Cache-Control: s-maxage=1800`,
   * because that is how `caches.default` is told how long to keep them.
   * Returning one verbatim published that directive to the PUBLIC internet, and
   * Cloudflare's front-line cache honoured it: `Cf-Cache-Status: HIT` on a URL
   * the browser had never requested, answering from a snapshot taken half an
   * hour earlier without the Function running at all. A wrong stamp shipped at
   * 18:48 was still being served at 19:12, ten minutes after the fix for it was
   * committed and deployed.
   *
   * ==> AND THE CLIENT CANNOT ESCAPE IT. <== The request that proved this sent
   * `Cache-Control: no-cache` AND `Pragma: no-cache` and got a 24-minute-old
   * HIT regardless — Cloudflare's edge ignores request-side no-cache. So
   * `data/relay.js`'s `cache: 'no-store'` binds the browser and nothing beyond
   * it. There is no client-side recovery from this; it has to not happen.
   *
   * ==> THE ARITHMETIC IS WHY IT MATTERS EVEN WHEN NOTHING IS BROKEN. <==
   * Three independent clocks were stacking on the age of the stamp a phone
   * receives: KV is judged fresh up to FRESH_SECONDS old, that already-old stamp
   * is then copied onto a slot with a NEW FRESH_SECONDS lifetime, and the edge
   * cache added a third. 30 + 30 + 30 = 90 minutes, which is exactly
   * `RELAY_AGE.delayedAfter`. The app could cry wolf in normal steady-state
   * operation with every part of the pipeline healthy. Removing the third clock
   * puts the ceiling back at 60 and restores a real margin.
   *
   * Rebuilding costs one `text()` and carries the only header worth keeping. */
  const hit = await cache.match(freshKey);
  if (hit) {
    return new Response(await hit.text(), {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Cache': PATH.FRESH,
      }),
    });
  }

  const warm = await kvRead(context.env, KV_PATH, FRESH_SECONDS);
  if (warm && warm.fresh) {
    const headers = baseHeaders({
      'X-Landfall-Fetched-At': warm.fetchedAt || '',
      'X-Landfall-Cache': PATH.KV,
    });
    context.waitUntil(
      cache.put(
        freshKey,
        new Response(warm.body, {
          headers: { ...headers, 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
        })
      )
    );
    return new Response(warm.body, { headers });
  }

  /* ===================================================================
   * SERVE WHAT WE HAVE, THEN GO GET THE UPDATE.
   * ===================================================================
   *
   * Everything above is a HIT on something current. Reaching here means the
   * current copies have aged out — which is a reason to REFRESH, and used to
   * be treated here as a reason to WAIT. Those are not the same thing, and on
   * the GDACS side conflating them is what put a red banner over a live
   * Category 5 for four days.
   *
   * An expired copy of a feed that re-issues every six hours is not wrong. It
   * is a few minutes behind, it carries its own timestamp saying so, and it is
   * available in about a tenth of a second. Handing that over immediately and
   * pulling the update behind the response means the reader sees the storm now
   * and the next reader sees the newer one — instead of the reader seeing
   * nothing while we go and find out.
   *
   * `waitUntil` keeps the refresh alive after the response is sent, so it
   * costs the reader nothing. The one case that still blocks is the case with
   * genuinely nothing to show, and that one is on a 10-second leash. */
  const stale = await cache.match(lastGoodKey);
  if (stale) {
    const body = await stale.text();
    context.waitUntil(
      pullUpstream(context, cache, freshKey, lastGoodKey).catch(() => {})
    );
    return new Response(body, {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Stale': 'true',
        'X-Landfall-Cache': PATH.LAST_GOOD,
      }),
    });
  }

  /* Then the warm copy declined above as too old. Older than this route's
   * fresh window is not the same as useless — it is stale, and stale with a
   * visible timestamp beats a blank screen (§5). */
  if (warm) {
    context.waitUntil(
      pullUpstream(context, cache, freshKey, lastGoodKey).catch(() => {})
    );
    return new Response(warm.body, {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': warm.fetchedAt || '',
        'X-Landfall-Stale': 'true',
        'X-Landfall-Cache': PATH.KV_STALE,
      }),
    });
  }

  /* COLD MISS. Nothing anywhere — a colo that has never served this route and
   * a KV store that has never been warmed. This is the only path that makes
   * anyone wait, and it waits at most UPSTREAM_BUDGET_MS. */
  try {
    const { body, headers } = await pullUpstream(context, cache, freshKey, lastGoodKey);
    return new Response(body, { headers });
  } catch (e) {
    /* Nothing cached anywhere and upstream down or too slow: an honest 502.
     * The client's status strip turns this into "NHC is not responding" —
     * never raw text like this (§5). */
    return new Response(
      JSON.stringify({
        error: 'nhc_unreachable',
        detail: String((e && e.message) || e),
      }),
      { status: 502, headers: baseHeaders() }
    );
  }
}
