/**
 * /api/nhc/advisory?bin=EP1 — the relay's third job (SPEC §4).
 *
 * Forward-and-cache ONLY. The `<pre>` extraction lives in lib/advisory.js, in
 * the browser, for the same reason the a-deck parse and the NHC/GDACS merge
 * do: it can be poked on a phone plugged into a laptop. This function stays
 * dumb — it fetches a page and hands it over.
 *
 * WHY IT EXISTS: www.nhc.noaa.gov sends no CORS header, same as the storm
 * list. Nothing more interesting than that.
 *
 * IT DOES NOT STRIP THE HTML, and that is a decision rather than laziness.
 * The page is ~26 kB and the product inside it is ~2 kB, so extracting here
 * would cut the payload thirteenfold — a real argument on a phone during a
 * hurricane, and the same shape of argument that earned the a-deck relay its
 * bounded exception. It loses anyway, for two reasons:
 *   1. Cloudflare compresses the response on the wire. The page is repetitive
 *      boilerplate — it gzips to a fraction of its size, so the saving is a
 *      few kB rather than 24, against a fetch that happens once per storm per
 *      advisory and only when the reader expands the section.
 *   2. The a-deck exception was forced by WARMING — every storm, unprompted,
 *      megabytes. This fetch is user-initiated and singular. Nothing forces
 *      it, and an exception with no forcing reason is how the rule dies.
 * If the payload ever does bite on glass, the fix is measuring it first.
 *
 * THE URL IS BUILT HERE, NOT TAKEN FROM THE FEED, and this one matters.
 * `publicAdvisory.url` in CurrentStorms.json points at the bare slot page
 * `/text/MIATCPEP1.shtml`. Fetched 2026-07-25, that page returned
 * **Post-Tropical Cyclone Amanda, Advisory 22, issued June 7** — a storm six
 * weeks dead — while the feed alongside it said Fausto. Rendering that under
 * a live storm's name is the §5 failure with the worst blast radius on this
 * panel. The `/text/refresh/` path returns the current product, and its
 * timestamp segment is a CACHE-BUSTER, not a selector: `000000` and `999999`
 * both returned the live advisory (measured, both storms).
 *
 * Cloudflare Pages Functions run in their own workerd runtime, separate from
 * the app bundle, so this file is SELF-CONTAINED on purpose — importing
 * config/constants.js would couple a static deploy to a bundler step this
 * project does not have (§3).
 */

const HOST = 'https://www.nhc.noaa.gov';

/** The three per-storm text products, by WMO prefix. TCM is the coded
 *  forecast advisory — reachable, not rendered. */
const KIND = Object.freeze({
  TCP: 'MIATCP', // public advisory — plain language, the one the panel shows
  TCD: 'MIATCD', // forecaster discussion
  TCM: 'MIATCM', // forecast advisory — coded
});

/** Bin numbers are two letters and a digit: `AT2`, `EP1`, `CP1`. This is a
 *  path built from a query parameter, so the allowed shape is an explicit
 *  pattern rather than an escape — nothing else reaches the upstream URL. */
const BIN_RE = /^[A-Z]{2}\d$/;

/** SPEC §4 cache table. Advisories issue every 6 h with intermediates as
 *  often as every 2 h; 5 min matches the storm list and means a reader
 *  reopening the section never waits on a second round trip. */
const FRESH_SECONDS = 5 * 60;

/** Serve-stale window on upstream failure: ~1.5x advisory cadence. A stale
 *  advisory shown with its own issuance line beats a blank panel (§5) — and
 *  the product states its own date and time in its header, so a reader can
 *  always see how old what they are reading is. */
const STALE_SECONDS = 9 * 60 * 60;

/** NOAA servers 403 requests with no User-Agent. Identify ourselves plainly. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

const textHeaders = (extra = {}) => ({
  'Content-Type': 'text/html; charset=utf-8',
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
  const bin = String(url.searchParams.get('bin') || '').toUpperCase();
  const kind = String(url.searchParams.get('kind') || 'TCP').toUpperCase();

  if (!BIN_RE.test(bin)) {
    return errorJson({ error: 'bad_bin', detail: 'bin must look like EP1 or AT2' }, 400);
  }
  const prefix = KIND[kind];
  if (!prefix) {
    return errorJson(
      { error: 'bad_kind', detail: `kind must be one of ${Object.keys(KIND).join(', ')}` },
      400
    );
  }

  const cache = caches.default;
  const slot = `${prefix}${bin}`;
  const freshKey = new Request(`https://landfall-relay.internal/nhc/advisory/${slot}/fresh`);
  const lastGoodKey = new Request(`https://landfall-relay.internal/nhc/advisory/${slot}/last-good`);

  const hit = await cache.match(freshKey);
  if (hit) return hit;

  /* The cache-buster. Its VALUE is irrelevant to what comes back — measured —
   * so it is the clock rather than an advisory time, which keeps this
   * function from needing to know anything about the storm. */
  const bust = String(Date.now()).slice(-6);
  const target = `${HOST}/text/refresh/${slot}+shtml/${bust}.shtml`;

  let upstreamError;
  try {
    const r = await fetch(target, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    });
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
    const body = await r.text();

    /* Refuse to cache a page with no product in it. The client's extractor
     * would return null and the panel would name the failure correctly
     * either way — but caching a dud for five minutes turns one bad fetch
     * into five minutes of a storm having no advisory. Cheapest possible
     * check, and it is the same tag the extractor looks for. */
    if (!/<pre\b/i.test(body)) throw new Error('no product block in page');

    const fetchedAt = new Date().toISOString();
    const headers = textHeaders({
      'X-Landfall-Fetched-At': fetchedAt,
      'X-Landfall-Product': slot,
    });

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

  const stale = await cache.match(lastGoodKey);
  if (stale) {
    const body = await stale.text();
    return new Response(body, {
      headers: textHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Product': slot,
        'X-Landfall-Stale': 'true',
      }),
    });
  }

  return errorJson(
    { error: 'advisory_unreachable', detail: String(upstreamError?.message || upstreamError) },
    502
  );
}
