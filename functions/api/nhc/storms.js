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
 *  thing the old number prevented — costs nothing.
 *
 *  NOT CHANGED HERE: the serve-then-refresh behaviour and the upstream time
 *  budget that `gdacs/events.js` now has. This route has never been measured
 *  slow, and a working path in hurricane season is not the place to prove a
 *  pattern. Logged in NOW.md as the outstanding half. */
const FRESH_SECONDS = 30 * 60;

/** Serve-stale window on upstream failure: ~1.5x advisory cadence, the same
 *  9 h the client's last-good cache uses. Stale + timestamp beats blank. */
const STALE_SECONDS = 9 * 60 * 60;

/** NOAA servers 403 requests with no User-Agent. Identify ourselves plainly. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

const baseHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});

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

  const hit = warming ? null : await cache.match(freshKey);
  if (hit) return hit;

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

  let upstreamError;
  try {
    const r = await fetch(UPSTREAM, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
    const body = await r.text();

    /* Refuse to cache non-JSON (an upstream error page would otherwise be
     * served as "storm data" for 5 minutes). Parse to check, forward as text. */
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

  /* Upstream failed. Serve last-good flagged stale — the client shows it with
   * its age (SPEC §5: stale + visible timestamp beats a blank screen). */
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

  /* Then the warm copy we declined above as too old. Older than this route's
   * fresh window is not the same as useless — it is stale, and stale with a
   * visible timestamp beats a blank screen (§5). */
  if (warm) {
    return new Response(warm.body, {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': warm.fetchedAt || '',
        'X-Landfall-Stale': 'true',
      }),
    });
  }

  /* Nothing cached and upstream down: an honest 502. The client's status
   * strip turns this into "NHC is not responding" — never raw text like this. */
  return new Response(
    JSON.stringify({ error: 'nhc_unreachable', detail: String(upstreamError?.message || upstreamError) }),
    { status: 502, headers: baseHeaders() }
  );
}
