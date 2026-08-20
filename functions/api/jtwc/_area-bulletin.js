/**
 * _area-bulletin.js — the forward-and-cache body behind `/api/jtwc/abpw` and
 * `/api/jtwc/abio`. SPEC §45.3.
 *
 * JTWC publishes exactly two Significant Tropical Weather Advisories, one per
 * hemisphere-pair of oceans, and they are the same document with the ocean
 * names swapped. Rather than two near-identical route files, the behaviour
 * lives here and each route calls it with a frozen descriptor.
 *
 * ==> NEITHER ROUTE TAKES A PARAMETER, AND THAT IS THE GUARD. <== The sibling
 * `warning.js` builds a path out of a query string and needs `PRODUCT_RE` to
 * police it. These two build nothing: the upstream URL is a constant chosen by
 * which file was addressed, so there is no input to sanitize. Keep it that
 * way — a `?product=` parameter here would put the guard back on the to-do
 * list for no benefit.
 *
 * WHY A RELAY AT ALL: `www.metoc.navy.mil` returns `Access-Control-Allow-Origin:
 * null` (measured 2026-07-25), so the browser cannot fetch these directly.
 *
 * THE BULLETIN'S OWN HEADER IS THE TIMESTAMP. `ABPW10 PGTW 081500` and
 * `ABIO10 PGTW 191800` both carry the issue time, and that is what the app
 * ages them by — never the fetch time, which is the device's clock wearing a
 * disguise (§17.7, no third clocks). `X-Landfall-Fetched-At` says when WE got
 * it, which is a different fact and is used only for relay staleness.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED on purpose (§3) — no import of config/constants.js.
 */

/** Mirrors `CACHE.abpwFresh`. Same window as the NHC outlook so the halves of
 *  one watch list can never be served from wildly different moments — and the
 *  SAME window for both bulletins, so the Pacific and the Indian Ocean cannot
 *  disagree about what time it is either. */
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

/**
 * @param {object} context — the Pages Functions context.
 * @param {{slug:string, upstream:string, headerRe:RegExp, label:string}} product
 */
export async function serveAreaBulletin(context, product) {
  const cache = caches.default;
  const freshKey = new Request(`https://landfall-relay.internal/jtwc/${product.slug}/fresh`);
  const lastGoodKey = new Request(`https://landfall-relay.internal/jtwc/${product.slug}/last-good`);

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
    const r = await fetch(product.upstream, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain' },
    });
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
    const body = await r.text();

    /* REFUSE TO CACHE SOMETHING THAT IS NOT THIS BULLETIN. JTWC serves an HTML
     * error page rather than a 404 when a product is unavailable, and caching
     * that for fifteen minutes turns one bad fetch into fifteen minutes of the
     * app believing an ocean is quiet. The check is the product's own
     * mandatory WMO header, not a guess at the error page's shape — the same
     * argument `warning.js` makes with `SUBJ/`.
     *
     * ==> AND IT IS PER-PRODUCT, NOT SHARED. <== A pattern loose enough to
     * accept either bulletin would let `abioweb.txt` be cached under the
     * Pacific's key on a day JTWC crossed its own wires, and the app would
     * then report the Indian Ocean's disturbances as Pacific ones with no
     * error anywhere. Each route asserts the header it asked for. */
    if (!product.headerRe.test(body)) {
      throw new Error(`not an ${product.label} bulletin`);
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
      error: `${product.slug}_unreachable`,
      detail: String((upstreamError && upstreamError.message) || upstreamError),
    },
    502
  );
}
