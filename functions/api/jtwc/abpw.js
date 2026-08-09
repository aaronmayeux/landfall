/**
 * /api/jtwc/abpw — the Significant Tropical Weather Advisory, forwarded.
 * SPEC §45.3.
 *
 * Forward-and-cache only, the same dumb sibling of `/api/jtwc/storms` that
 * `warning.js` is next door. Parsing lives in `lib/abpw.js`, in the browser.
 *
 * WHY IT EXISTS: `www.metoc.navy.mil` returns `Access-Control-Allow-Origin:
 * null` (measured 2026-07-25), so the browser cannot fetch this directly.
 * Same reason as every other relay here.
 *
 * WHY THIS PRODUCT AND NOT A BETTER ONE. It is the only genesis product found
 * outside NHC that carries a probability at all. RSMC Nadi, Météo-France La
 * Réunion and IMD publish narrative bulletins with no structured formation
 * odds, so there is nothing better to reach for — this is not a placeholder
 * for something we intend to replace.
 *
 * IT IS NOT A `warning.js` PRODUCT AND CANNOT BE ONE. That route's
 * `PRODUCT_RE` is `/^[a-z]{2}\d{4}$/`, which excludes the area advisories
 * (`abpw`, `abio`) BY CONSTRUCTION rather than by accident — it builds a path
 * from a query parameter and the pattern is the guard. This file takes no
 * parameters at all, which is the cheapest possible version of that guard.
 *
 * THE BULLETIN'S OWN HEADER IS THE TIMESTAMP. `ABPW10 PGTW 081500` carries the
 * issue time, and that is what the app ages it by — never the fetch time,
 * which is the device's clock wearing a disguise (§17.7, no third clocks).
 * `X-Landfall-Fetched-At` below says when WE got it, which is a different fact
 * and is used only for relay staleness.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED on purpose (§3).
 */

const UPSTREAM = 'https://www.metoc.navy.mil/jtwc/products/abpwweb.txt';

/** Mirrors `CACHE.abpwFresh`. Same window as the NHC outlook so the two halves
 *  of one watch list can never be served from wildly different moments. */
const FRESH_SECONDS = 15 * 60;

/** Serve-stale on upstream failure. The bulletin states its own date-time
 *  group, so a stale one is readable AS stale without decoration from us (§5)
 *  — and `GENESIS.ABPW.maxAge` refuses it client-side past a day regardless. */
const STALE_SECONDS = 9 * 60 * 60;

const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

const textHeaders = (extra = {}) => ({
  'Content-Type': 'text/plain; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  ...extra,
});

const errorJson = (obj, status) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });

export async function onRequestGet(context) {
  const cache = caches.default;
  const freshKey = new Request('https://landfall-relay.internal/jtwc/abpw/fresh');
  const lastGoodKey = new Request('https://landfall-relay.internal/jtwc/abpw/last-good');

  const hit = await cache.match(freshKey);
  if (hit) {
    return new Response(await hit.text(), {
      headers: textHeaders({
        'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
      }),
    });
  }

  let upstreamError;
  try {
    const r = await fetch(UPSTREAM, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain' },
    });
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
    const body = await r.text();

    /* REFUSE TO CACHE SOMETHING THAT IS NOT THIS BULLETIN. JTWC serves an HTML
     * error page rather than a 404 when a product is unavailable, and caching
     * that for fifteen minutes turns one bad fetch into fifteen minutes of the
     * app believing the Western Pacific is quiet. The check is the product's
     * own mandatory WMO header, not a guess at the error page's shape — the
     * same argument `warning.js` makes with `SUBJ/`. */
    if (!/^ABPW\d{2}\s+\w{4}\s+\d{6}/m.test(body)) {
      throw new Error('not an ABPW bulletin');
    }

    const headers = textHeaders({
      'X-Landfall-Fetched-At': new Date().toISOString(),
    });

    context.waitUntil(
      Promise.all([
        cache.put(freshKey, new Response(body, {
          headers: { ...headers, 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
        })),
        cache.put(lastGoodKey, new Response(body, {
          headers: { ...headers, 'Cache-Control': `s-maxage=${STALE_SECONDS}` },
        })),
      ])
    );

    return new Response(body, { headers });
  } catch (e) {
    upstreamError = e;
  }

  const stale = await cache.match(lastGoodKey);
  if (stale) {
    return new Response(await stale.text(), {
      headers: textHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Stale': 'true',
      }),
    });
  }

  return errorJson(
    {
      error: 'abpw_unreachable',
      detail: String((upstreamError && upstreamError.message) || upstreamError),
    },
    502
  );
}
