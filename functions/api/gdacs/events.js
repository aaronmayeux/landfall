/**
 * /api/gdacs/events — the GDACS event list, relayed. SPEC §17 Pass B (B1).
 *
 * ===> THIS ROUTE DID NOT EXIST BEFORE PASS B, AND THAT WAS THE HOLE. <===
 * `data/gdacs.js` fetched `geteventlist/EVENTS4APP` DIRECTLY from the browser
 * for the app's whole life, because GDACS sends a CORS header and the fetch
 * simply worked (§4's CORS ground truth, verified in-browser 2026-07-22).
 * "It works from the browser" answered the wrong question. At one user it is
 * one request every thirty minutes. On a shared link during a landfall it is
 * one request every thirty minutes PER PHONE, from ten thousand client IPs,
 * with no shared cache anywhere in the path — a firehose pointed at a
 * public-good European endpoint, and one that §17 Pass B's origin collapse
 * could not have helped, because none of that traffic ever passed through
 * anything we control.
 *
 * The lesson is worth keeping and it is not really about GDACS: **CORS-open
 * is a permission, not a capacity plan.** The reason to relay a feed is
 * whichever comes first — the browser can't reach it, or we can't responsibly
 * point a crowd at it. The second reason arrived late and was never checked
 * against the endpoints that had already passed the first.
 *
 * Forward-and-cache ONLY, like every relay route (§4). No parsing, no
 * merging, no per-event logic — `data/gdacs.js` still normalizes every field
 * client-side, unchanged, so the fiddly severity and timestamp rules stay
 * debuggable on a phone plugged into a laptop.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, separate from
 * the app bundle, so this file is SELF-CONTAINED on purpose — importing
 * config/constants.js would couple a static deploy to a bundler step this
 * project does not have (§3). The numbers below mirror SPEC §4's cache table;
 * that table is the truth.
 */

import { kvRead, isWarmRequest } from '../_kv-cache.js';
import { CACHE_PATH } from '../_cache-path.js';

/**
 * THE CYCLONE-ONLY LIST, NOT `EVENTS4APP` — changed 2026-07-26 after a live
 * storm went missing from the app.
 *
 * `EVENTS4APP` is every hazard type in one payload, HARD-CAPPED AT 100
 * FEATURES. On 2026-07-24 that cap held four tropical cyclones and the app was
 * fine. On 2026-07-26 wildfire season filled 93 of the 100 slots and the list
 * came back holding TWO cyclones — both East Pacific, both dropped by
 * `data/merge.js` as NHC's to report. Typhoon Noul, sitting off Hong Kong on
 * an Orange alert at episode 13, was simply off the end of the list. GDACS was
 * up, the relay was healthy, every cache layer did its job, and the West
 * Pacific rendered empty.
 *
 * **A list feed that can be crowded out by an unrelated hazard is not a list
 * of storms, it is a list of recent events that sometimes contains storms.**
 * `SEARCH?eventlist=TC` is cyclones only, so nothing non-cyclone can displace
 * one no matter how bad a fire season gets. Field parity with `EVENTS4APP` was
 * diffed key-for-key on the live payload — identical property sets, `url.geometry`
 * included — so `data/gdacs.js` normalizes it unchanged. SPEC §4 had flagged
 * this variant since 2026-07-24 carrying a `[VERIFY] field parity` note; this
 * is that verification, cashed in two days late.
 *
 * THE `alertlevel` PARAMETER IS LOAD-BEARING AND ITS BEHAVIOUR IS ODD. Without
 * it the endpoint returns 20 rows; with it, 100. The 20-row form was measured
 * MISSING two live storms (Fausto, Genevieve) that the 100-row form carries,
 * so the short list is filtered by something GDACS does not document and
 * cannot be trusted to be complete. Naming all three alert levels is not a
 * filter here — it is how you ask for the unabridged list. Do not "simplify"
 * this URL by dropping it.
 *
 * THE ARCHIVE COMES WITH IT. Unlike `EVENTS4APP`, this list carries dead
 * storms — 100 rows reach back roughly a year. `data/gdacs.js` drops anything
 * whose `iscurrent` is not "true", and `worker/src/sources.js` applies the
 * same filter before deriving geometry keys. The relay itself stays dumb and
 * forwards all 100 rows verbatim, like every other route.
 */
const UPSTREAM =
  'https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH' +
  '?eventlist=TC&alertlevel=Green;Orange;Red';

/** The KV path the cron Worker warms this route under (§17 Pass B). Must match
 *  `worker/src/sources.js` — `tools/test-kv-keys.mjs` asserts that it does. */
const KV_PATH = 'gdacs/events';

/** SPEC §4 cache table: 30 min, matching `gdacs/geometry.js` beside it.
 *
 * ==> IT WAS 5 MINUTES, AND THAT NUMBER TIMED THE APP OUT FOR FOUR DAYS. <==
 * Measured 2026-08-01, with Super Typhoon DOLPHIN-26 live in the West Pacific
 * and missing from the app entirely. The old value was justified as "well
 * under the client's 30-minute poll, so a poll never gets served its own
 * previous copy" — true, and answering a question nobody was asking. Serving a
 * poll its own previous copy is HARMLESS. What is not harmless is what the
 * tight window actually bought:
 *
 *   - the warm Worker's cron is `*​/5 * * * *`, the SAME five minutes, so the
 *     KV copy reached its expiry at the exact moment its replacement was due.
 *     Cron triggers drift. Every request landing in that gap judged the warm
 *     copy too old, skipped it, and went to gdacs.org in Europe.
 *   - that trip MEASURED ~20 s uncached, against a client abort at 20 s
 *     (POLL.fetchTimeout). Four attempts, four aborts, then the §5 unavailable
 *     banner — on a feed that was healthy the whole time.
 *
 * THE NUMBER WAS WRONG BY TWO ORDERS OF MAGNITUDE AGAINST THE SOURCE IT
 * GUARDS. GDACS re-issues a cyclone roughly every six hours: DOLPHIN-26 went
 * from episode 2 to episode 21 over five days. Treating a six-minute-old copy
 * as unusable, to go wait twenty seconds for bytes that last changed this
 * morning, is a freshness rule with no freshness in it.
 *
 * 30 min is still six times faster than the feed moves, and with the 5-minute
 * cron the copy actually served is 0-5 minutes old. A cadence must be FASTER
 * than the window it refills, never equal to it. */
const FRESH_SECONDS = 30 * 60;

/** Serve-stale window on upstream failure: ~1.5x advisory cadence, the same
 *  9 h as the NHC list and the service worker's last-good. Stale + a visible
 *  timestamp beats a blank screen (§5). */
const STALE_SECONDS = 9 * 60 * 60;

/** Identify the app honestly to a public-good endpoint (§17). */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

const baseHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});

/** How long this route will wait on gdacs.org before giving up and answering
 *  from cache instead.
 *
 *  ==> THE ROUTE USED TO WAIT FOREVER, AND NOBODY WAS LISTENING. <==
 *  `fetch()` with no signal has no deadline. The client aborts at
 *  POLL.fetchTimeout, so on 2026-08-01 the shape of the failure was: the app
 *  hangs up at 20 s, this function keeps patiently holding the line to Europe,
 *  and a perfectly good cached copy sits one `cache.match` away, unread. A
 *  server chasing a perfect answer past the point anyone can receive it is not
 *  being careful, it is being useless.
 *
 *  10 s is Aaron's stated ceiling for how long a storm may take to appear.
 *  This budget only ever applies on a genuine cold miss — nothing in L1, L2 or
 *  last-good — because every other path now answers from cache immediately and
 *  refreshes behind the response. */
const UPSTREAM_BUDGET_MS = 10 * 1000;

/** Fetch the list from gdacs.org and write both cache slots. Returns the body,
 *  or throws. Shared by the blocking cold-miss path and the background refresh
 *  so there is ONE definition of "what a successful pull does" — the two used
 *  to be one code path because there was only one, and splitting them without
 *  splitting the writes is how a background refresh quietly stops populating
 *  last-good. */
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

  /* Refuse to cache non-JSON — an upstream error page served as "the storm
   * list" fails somewhere far away from here. Parse to check, forward as
   * text. */
  JSON.parse(body);

  const fetchedAt = new Date().toISOString();
  const headers = baseHeaders({
    'X-Landfall-Fetched-At': fetchedAt,
    'X-Landfall-Cache': CACHE_PATH.UPSTREAM,
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

  /* L1, per-colo. Synthetic keys — they name the slot, nothing routes to them. */
  const freshKey = new Request('https://landfall-relay.internal/gdacs/events/fresh');
  const lastGoodKey = new Request('https://landfall-relay.internal/gdacs/events/last-good');

  /* The cron Worker skips every cache so a warm cycle actually reaches the
   * source, rather than re-confirming its own previous answer forever. It also
   * skips the serve-then-refresh path below for the same reason: a warm cycle
   * that returned cache would never pull anything. */
  const warming = isWarmRequest(context.request, context.env);

  if (warming) {
    const { body, headers } = await pullUpstream(context, cache, freshKey, lastGoodKey);
    return new Response(body, { headers });
  }

  /* REBUILT, NEVER RETURNED AS STORED. The slot Response carries
   * `Cache-Control: s-maxage=...` so `caches.default` knows how long to keep
   * it; handing that back verbatim publishes the directive to the internet and
   * Cloudflare's edge caches the whole response, stamp included, for another
   * full window. Measured on the NHC sibling 2026-08-07 — that file carries the
   * account and the arithmetic. */
  const hit = await cache.match(freshKey);
  if (hit) {
    return new Response(await hit.text(), {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Cache': CACHE_PATH.FRESH,
      }),
    });
  }

  /* L2, global. Written by the cron Worker, never by us (§17 Pass B's
   * load-bearing rule — see functions/api/_kv-cache.js). */
  const warm = await kvRead(context.env, KV_PATH, FRESH_SECONDS);
  if (warm && warm.fresh) {
    const headers = baseHeaders({
      'X-Landfall-Fetched-At': warm.fetchedAt || '',
      'X-Landfall-Cache': CACHE_PATH.KV,
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
   * current copies have aged out — which is a reason to REFRESH, and was being
   * treated as a reason to WAIT. Those are not the same thing, and conflating
   * them is what put a red banner over a live Category 5.
   *
   * An expired copy of a feed that re-issues every six hours is not wrong. It
   * is a few minutes behind, it carries its own timestamp saying so, and it is
   * available in about a tenth of a second. Handing that over immediately and
   * pulling the update behind the response means the reader sees the storm now
   * and the next reader sees the newer one — instead of the reader seeing
   * nothing while we go and find out.
   *
   * `waitUntil` keeps the refresh alive after the response is sent, so this
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
        'X-Landfall-Cache': CACHE_PATH.LAST_GOOD,
      }),
    });
  }

  if (warm) {
    context.waitUntil(
      pullUpstream(context, cache, freshKey, lastGoodKey).catch(() => {})
    );
    return new Response(warm.body, {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': warm.fetchedAt || '',
        'X-Landfall-Stale': 'true',
        'X-Landfall-Cache': CACHE_PATH.KV_STALE,
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
     * The client's status strip turns this into "GDACS is not responding" —
     * never raw text like this (§5). */
    return new Response(
      JSON.stringify({
        error: 'gdacs_unreachable',
        detail: String((e && e.message) || e),
      }),
      { status: 502, headers: baseHeaders() }
    );
  }
}
