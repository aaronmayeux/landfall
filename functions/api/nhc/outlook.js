/**
 * /api/nhc/outlook?basin=atlantic|epacific — the Tropical Weather Outlook, in
 * words. SPEC-DATA §45.9.
 *
 * ==> THIS IS THE SECOND OPINION ON THE ROUTE NEXT DOOR. <== `genesis.js`
 * relays NHC's GIS layer 3, which on 2026-08-11 answered `{"features":[]}` for
 * two hours while this bulletin — same forecaster, same desk, same schedule —
 * listed three Atlantic areas, one of them at 70% over seven days. An empty
 * FeatureCollection is unstamped, so nothing downstream could tell "NHC is
 * watching nothing" from "NHC's layer is broken". This product tells them
 * apart, and `lib/outlook.js` is what reads it.
 *
 * ==> FORWARD-AND-CACHE, WITH EXACTLY ONE THING DONE TO THE BYTES. <== §4's
 * rule is that a relay moves a payload and does not interpret it, and this
 * route holds to that: it extracts the bulletin from the `<pre>` block NHC
 * wraps it in and forwards the text verbatim. That is unwrapping a transport,
 * not parsing weather — no area, no percentage and no date is read here. Every
 * meteorological judgement lives in `lib/outlook.js`, in the browser, in one
 * implementation. Same split as `jtwc/abpw.js` and `lib/abpw.js` next door.
 *
 * ==> WHY THE SCRAPED PAGE AND NOT A RAW FEED, TODAY. <==
 * A plain-text feed exists at `tgftp.nws.noaa.gov` and was measured current on
 * 2026-08-11. It is not used YET, deliberately: the `.shtml` pages are what
 * `tools/archive-fetch.mjs` has been capturing, so they are the only bytes
 * this project has verified for BOTH basins over time, and the raw paths are
 * now archived beside them so the switch can be made on evidence instead of on
 * a good first impression.
 *
 * That caution is not theoretical. `www.nhc.noaa.gov/ftp/pub/forecasts/
 * discussion/MIATWOAT` — the other obvious raw candidate, on NHC's own host —
 * was serving a TWO-MONTH-OLD bulletin on 2026-08-11, plain text, HTTP 200,
 * indistinguishable from a healthy source by every signal except the issue
 * time inside the body. A source we trust to contradict another source is
 * exactly the one to be slow about.
 *
 * `lib/outlook.js` anchors on the WMO header line, so it reads a scraped page
 * and a raw feed identically and switching upstream changes nothing but the
 * URL and the extractor below.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED apart from the two shared relay helpers (§3).
 */

import { kvRead, isWarmRequest } from '../_kv-cache.js';
import { CACHE_PATH, CACHE_PATH_HEADER } from '../_cache-path.js';

/** A closed table, so no caller text ever reaches a URL or a cache key — the
 *  same rule `genesis.js` and `mapserver.js` apply to their parameters. */
const BASINS = {
  atlantic: 'https://www.nhc.noaa.gov/text/MIATWOAT.shtml?text',
  epacific: 'https://www.nhc.noaa.gov/text/MIATWOEP.shtml?text',
};

/** Mirrors `CACHE.outlookFresh`. Same window as the genesis layer so the two
 *  halves of one comparison can never be served from wildly different moments
 *  — a fifteen-minute skew between them would produce a `layer-broken` verdict
 *  out of nothing but cache timing. */
const FRESH_SECONDS = 15 * 60;

/** Serve-stale on upstream failure. The bulletin states its own issue time, so
 *  a stale one is readable AS stale without decoration from us — and
 *  `OUTLOOK.maxAgeMs` refuses it client-side past twelve hours regardless,
 *  which is the check that actually protects the comparison. */
const STALE_SECONDS = 9 * 60 * 60;

const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

const kvPathFor = (basin) => `nhc/outlook/${basin}`;

const textHeaders = (extra = {}) => ({
  'Content-Type': 'text/plain; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  /* `no-store` aimed at the BROWSER. This URL names no advisory and no time,
   * so it is byte-identical forever; without an explicit instruction a browser
   * invents a lifetime and answers from disk, which fails silently and looks
   * exactly like fresh data. The colo copies are written with their own
   * `s-maxage` below. Same reasoning as genesis.js. */
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
 * Pull the bulletin out of the page.
 *
 * NHC serves the product inside a single `<pre>` block with an "en Español"
 * anchor above it and a bare sequence number below that. Tags are stripped and
 * the five entities HTML actually requires are unescaped; nothing else is
 * touched, and in particular **line breaks and column widths are preserved**,
 * because the parser downstream reads this line by line.
 *
 * ==> AN EXTRACTION THAT FINDS NOTHING RETURNS NULL, NOT AN EMPTY STRING. <==
 * Empty string is the shape that gets read as "the outlook says nothing",
 * which is the false all-clear this entire feature exists to prevent, arriving
 * through the back door. Null is refused by the caller and becomes a 502.
 */
function extractBulletin(html) {
  const m = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(html);
  if (!m) return null;

  const text = m[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    /* `&amp;` LAST, or `&amp;lt;` decodes twice into a tag. */
    .replace(/&amp;/g, '&');

  return text.trim() ? text : null;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const basin = String(url.searchParams.get('basin') || 'atlantic').toLowerCase();

  if (!Object.prototype.hasOwnProperty.call(BASINS, basin)) {
    /* A 400, not a 502: a bad request, not a dead source. `data/relay.js` only
     * retries 5xx (§4), so this correctly never retries. */
    return errorJson(
      { error: 'bad_outlook_basin', detail: 'basin must be atlantic or epacific' },
      400
    );
  }

  const cache = caches.default;
  const freshKey = new Request(`https://landfall-relay.internal/nhc/outlook/${basin}/fresh`);
  const lastGoodKey = new Request(`https://landfall-relay.internal/nhc/outlook/${basin}/last-good`);

  /* The cron Worker skips every cache so a warm cycle actually reaches NHC
   * instead of re-confirming its own previous answer forever. */
  const warming = isWarmRequest(context.request, context.env);

  const hit = warming ? null : await cache.match(freshKey);
  if (hit) {
    return new Response(await hit.text(), {
      headers: textHeaders({
        'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Outlook-Basin': basin,
        [CACHE_PATH_HEADER]: CACHE_PATH.FRESH,
      }),
    });
  }

  const warm = warming ? null : await kvRead(context.env, kvPathFor(basin), FRESH_SECONDS);
  if (warm && warm.fresh) {
    const headers = textHeaders({
      'X-Landfall-Fetched-At': warm.fetchedAt || '',
      'X-Landfall-Outlook-Basin': basin,
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
    const r = await fetch(BASINS[basin], {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain' },
    });
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);

    const bulletin = extractBulletin(await r.text());
    /* ==> A PAGE WITH NO BULLETIN IN IT IS A FAILURE, NOT AN EMPTY OUTLOOK.
     * <== NHC redesigning this page, or an error page served at 200, must
     * never reach the client as a readable product with nothing in it. Thrown
     * so it falls through to last-good below — an old real bulletin, refused
     * on age client-side, beats a blank one that parses. */
    if (!bulletin) throw new Error('no bulletin found in the page');

    const headers = textHeaders({
      'X-Landfall-Fetched-At': new Date().toISOString(),
      'X-Landfall-Outlook-Basin': basin,
      [CACHE_PATH_HEADER]: CACHE_PATH.UPSTREAM,
    });

    context.waitUntil(
      Promise.all([
        cache.put(
          freshKey,
          new Response(bulletin, {
            headers: { ...headers, 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
          })
        ),
        cache.put(
          lastGoodKey,
          new Response(bulletin, {
            headers: { ...headers, 'Cache-Control': `s-maxage=${STALE_SECONDS}` },
          })
        ),
      ])
    );

    return new Response(bulletin, { headers });
  } catch (e) {
    upstreamError = e;
  }

  const stale = await cache.match(lastGoodKey);
  if (stale) {
    return new Response(await stale.text(), {
      headers: textHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Outlook-Basin': basin,
        'X-Landfall-Stale': 'true',
        [CACHE_PATH_HEADER]: CACHE_PATH.LAST_GOOD,
      }),
    });
  }

  /* THE KV COPY, EVEN THOUGH IT WAS JUDGED TOO OLD TO SERVE FRESH. Stale plus
   * a visible age beats nothing (§5), and the bulletin carries its own issue
   * time so the client can age it honestly without trusting this header. */
  const warmStale = await kvRead(context.env, kvPathFor(basin), FRESH_SECONDS);
  if (warmStale) {
    return new Response(warmStale.body, {
      headers: textHeaders({
        'X-Landfall-Fetched-At': warmStale.fetchedAt || '',
        'X-Landfall-Outlook-Basin': basin,
        'X-Landfall-Stale': 'true',
        [CACHE_PATH_HEADER]: CACHE_PATH.KV_STALE,
      }),
    });
  }

  return errorJson(
    {
      error: 'outlook_unreachable',
      detail: String((upstreamError && upstreamError.message) || upstreamError),
    },
    502
  );
}
