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

const UPSTREAM = 'https://www.nhc.noaa.gov/CurrentStorms.json';

/** SPEC §4 cache table: NHC storm list fresh for 5 min — well under the
 *  client's 30-min poll, so a poll never gets served its own previous copy. */
const FRESH_SECONDS = 5 * 60;

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

  const hit = await cache.match(freshKey);
  if (hit) return hit;

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

  /* Nothing cached and upstream down: an honest 502. The client's status
   * strip turns this into "NHC is not responding" — never raw text like this. */
  return new Response(
    JSON.stringify({ error: 'nhc_unreachable', detail: String(upstreamError?.message || upstreamError) }),
    { status: 502, headers: baseHeaders() }
  );
}
