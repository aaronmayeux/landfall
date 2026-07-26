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

/** SPEC §4 cache table: matches the NHC storm list row at 5 min. These are the
 *  two list feeds behind the same 30-minute client poll, and a list feed that
 *  is fresher than its sibling just means the merge sees two different
 *  moments. Same number, same reason: well under the poll, so a poll never
 *  gets served its own previous copy. */
const FRESH_SECONDS = 5 * 60;

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

export async function onRequestGet(context) {
  const cache = caches.default;

  /* L1, per-colo. Synthetic keys — they name the slot, nothing routes to them. */
  const freshKey = new Request('https://landfall-relay.internal/gdacs/events/fresh');
  const lastGoodKey = new Request('https://landfall-relay.internal/gdacs/events/last-good');

  /* The cron Worker skips L1 and L2 so a warm cycle actually reaches the
   * source, rather than re-confirming its own previous answer forever. */
  const warming = isWarmRequest(context.request, context.env);

  const hit = warming ? null : await cache.match(freshKey);
  if (hit) return hit;

  /* L2, global. Written by the cron Worker, never by us (§17 Pass B's
   * load-bearing rule — see functions/api/_kv-cache.js). */
  const warm = warming ? null : await kvRead(context.env, KV_PATH, FRESH_SECONDS);
  if (warm && warm.fresh) {
    const headers = baseHeaders({ 'X-Landfall-Fetched-At': warm.fetchedAt || '' });
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

  /* L3, the safety valve. Unchanged from what a browser used to do directly. */
  let upstreamError;
  try {
    const r = await fetch(UPSTREAM, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
    const body = await r.text();

    /* Refuse to cache non-JSON — an upstream error page served as "the storm
     * list" for five minutes fails somewhere far away from here. Parse to
     * check, forward as text. */
    JSON.parse(body);

    const fetchedAt = new Date().toISOString();
    const headers = baseHeaders({ 'X-Landfall-Fetched-At': fetchedAt });

    context.waitUntil(
      Promise.all([
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
      ])
    );

    return new Response(body, { headers });
  } catch (e) {
    upstreamError = e;
  }

  /* Upstream failed. Prefer this colo's last-good; then the warm copy we
   * already declined as too old, which is better than nothing and now says so
   * with its own timestamp (§5). */
  const stale = await cache.match(lastGoodKey);
  if (stale) {
    const body = await stale.text();
    return new Response(body, {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Stale': 'true',
      }),
    });
  }
  if (warm) {
    return new Response(warm.body, {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': warm.fetchedAt || '',
        'X-Landfall-Stale': 'true',
      }),
    });
  }

  /* Nothing cached anywhere and upstream down: an honest 502. The client's
   * status strip turns this into "GDACS is not responding" — never raw text
   * like this (§5). */
  return new Response(
    JSON.stringify({
      error: 'gdacs_unreachable',
      detail: String((upstreamError && upstreamError.message) || upstreamError),
    }),
    { status: 502, headers: baseHeaders() }
  );
}
