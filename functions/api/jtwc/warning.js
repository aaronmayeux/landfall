/**
 * /api/jtwc/warning?product=wp1126 — one JTWC warning, forwarded.
 *
 * Forward-and-cache ONLY, the dumb sibling of /api/jtwc/storms next door.
 * That route builds the name lookup and argues its own exception to §4; this
 * one does nothing but fetch a text file and hand it over. Parsing lives in
 * lib/advisory.js, in the browser.
 *
 * WHY IT EXISTS: measured 2026-07-25, `www.metoc.navy.mil` returns
 * `Access-Control-Allow-Origin: null` — no CORS header, so the browser cannot
 * fetch the warning directly. Same reason as every other relay here.
 *
 * NOTHING TO EXTRACT. Unlike NHC's `.shtml`, the JTWC product is genuinely
 * plain text: `Content-Type: text/plain`, ~4 kB, 97 lines, and
 * `looksLikeHtml: false` from the probe. It goes to the client as it came.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file
 * is SELF-CONTAINED on purpose (§3).
 */

import { kvRead, isWarmRequest } from '../_kv-cache.js';
import { CACHE_PATH, CACHE_PATH_HEADER } from '../_cache-path.js';

const HOST = 'https://www.metoc.navy.mil';

/** `wp1126` — two letters, four digits, nothing else. This is a path built
 *  from a query parameter, so the allowed shape is an explicit pattern. It
 *  also excludes the area advisories (`abpw`, `abio`) by construction. */
const PRODUCT_RE = /^[a-z]{2}\d{4}$/;

/** Fresh window, matching the index that names these products. A reader
 *  reopening the section inside a warning cycle never waits twice. */
const FRESH_SECONDS = 15 * 60;

/** Serve-stale on upstream failure: ~1.5x advisory cadence, as everywhere
 *  else. The warning states its own date-time group in its header, so a
 *  stale one is readable AS stale without any decoration from us (§5). */
const STALE_SECONDS = 9 * 60 * 60;

const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

const textHeaders = (extra = {}) => ({
  'Content-Type': 'text/plain; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});

const errorJson = (obj, status) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const product = String(url.searchParams.get('product') || '').toLowerCase();

  if (!PRODUCT_RE.test(product)) {
    return errorJson(
      { error: 'bad_product', detail: 'product must look like wp1126' },
      400
    );
  }

  const cache = caches.default;
  const freshKey = new Request(`https://landfall-relay.internal/jtwc/warning/${product}/fresh`);
  const lastGoodKey = new Request(`https://landfall-relay.internal/jtwc/warning/${product}/last-good`);

  /* SPEC §17 Pass B. Warmed by the cron under the same product designation
   * that keys the colo slot above. */
  const warming = isWarmRequest(context.request, context.env);
  const kvPath = `jtwc/warning/${product}`;

  /* THE HIT IS REBUILT, NEVER HANDED BACK AS STORED. The slot copies below are
   * written with `Cache-Control: s-maxage=...` because that is how
   * `caches.default` is told how long to keep them — returning one verbatim
   * published that instruction to the public internet, where Cloudflare's own
   * edge honoured it and served the body again without this function running at
   * all. Measured live on the storm list, 2026-08-07; every route here carried
   * the identical shape. `SPEC-OPS.md` §17.7. */
  const hit = warming ? null : await cache.match(freshKey);
  if (hit) {
    return new Response(await hit.text(), {
      headers: textHeaders({
        'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Product': product,
        [CACHE_PATH_HEADER]: CACHE_PATH.FRESH,
      }),
    });
  }

  const warm = warming ? null : await kvRead(context.env, kvPath, FRESH_SECONDS);
  if (warm && warm.fresh) {
    const headers = textHeaders({
      'X-Landfall-Fetched-At': warm.fetchedAt || '',
      [CACHE_PATH_HEADER]: CACHE_PATH.KV,
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

  let upstreamError;
  try {
    const r = await fetch(`${HOST}/jtwc/products/${product}web.txt`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain' },
    });
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
    const body = await r.text();

    /* Refuse to cache something that is not a warning. JTWC serves an HTML
     * error page on a retired product rather than a 404, and caching that as
     * "the advisory" for fifteen minutes turns one bad fetch into fifteen
     * minutes of a storm reading wrong. The check is the product's own
     * mandatory header line, not a guess at the error page's shape. */
    if (!/SUBJ\//i.test(body)) throw new Error('not a warning product');

    const headers = textHeaders({
      'X-Landfall-Fetched-At': new Date().toISOString(),
      'X-Landfall-Product': product,
      [CACHE_PATH_HEADER]: CACHE_PATH.UPSTREAM,
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
    const body = await stale.text();
    return new Response(body, {
      headers: textHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Product': product,
        'X-Landfall-Stale': 'true',
        [CACHE_PATH_HEADER]: CACHE_PATH.LAST_GOOD,
      }),
    });
  }

  /* Then the warm copy declined above as too old. The warning states its own
   * date-time group in its header, so a stale one is readable AS stale (§5). */
  if (warm) {
    return new Response(warm.body, {
      headers: textHeaders({
        'X-Landfall-Fetched-At': warm.fetchedAt || '',
        'X-Landfall-Product': product,
        'X-Landfall-Stale': 'true',
        [CACHE_PATH_HEADER]: CACHE_PATH.KV_STALE,
      }),
    });
  }

  return errorJson(
    { error: 'warning_unreachable', detail: String(upstreamError?.message || upstreamError) },
    502
  );
}
