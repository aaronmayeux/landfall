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

import { kvRead, isWarmRequest } from '../_kv-cache.js';
import { CACHE_PATH, CACHE_PATH_HEADER } from '../_cache-path.js';

const HOST = 'https://www.nhc.noaa.gov';

/** The three per-storm text products, by AWIPS product code. TCM is the coded
 *  forecast advisory — reachable, not rendered. */
const KIND = Object.freeze({
  TCP: 'TCP', // public advisory — plain language, the one the panel shows
  TCD: 'TCD', // forecaster discussion
  TCM: 'TCM', // forecast advisory — coded
});

/**
 * The ISSUING OFFICE prefix, which is NOT always Miami.
 *
 * ==> THIS WAS HARDCODED TO `MIA` AND IT BROKE THE CENTRAL PACIFIC ENTIRELY.
 *
 * The slot is `<office><product><bin>`, and the office is the WMO node that
 * issues the product, not the agency that owns the app's data model. Atlantic
 * and East Pacific products come from Miami; **Central Pacific products come
 * from CPHC Honolulu and use `HFO`.** With `MIA` hardcoded, every CP bin built
 * `MIATCPCP1`, which does not exist, so the upstream 404'd and this route
 * returned 502 for the whole life of the feature.
 *
 * MEASURED 2026-07-28, both URLs, not reasoned:
 *   MIATCPCP1 -> 404
 *   HFOTCPCP1 -> "WTPA31 PHFO 280235 / TCPCP1 / BULLETIN /
 *                 Tropical Storm Fausto Advisory Number 37 /
 *                 NWS Central Pacific Hurricane Center Honolulu HI"
 *   HFOTCDCP1 -> the matching discussion, so the office applies to every kind
 *
 * WHAT IT COST, beyond the missing panel text: §5's ended state reads the final
 * public advisory to detect a DECLARED ending, so a Central Pacific storm could
 * never be declared over — it would silently fall through to the slower
 * absence path. Fausto is in CP1 right now, which is how this surfaced.
 *
 * NOTE the product itself may say "Issued by NWS National Hurricane Center
 * Miami FL" — NHC covers for CPHC at times. The FILE prefix stays `HFO`
 * regardless, because it names the WMO originating node, not who typed it.
 */
function officeFor(bin) {
  return bin.startsWith('CP') ? 'HFO' : 'MIA';
}

/** Bin numbers are two letters and a digit: `AT2`, `EP1`, `CP1`. This is a
 *  path built from a query parameter, so the allowed shape is an explicit
 *  pattern rather than an escape — nothing else reaches the upstream URL. */
const BIN_RE = /^[A-Z]{2}\d$/;

/**
 * SPEC §4 cache table. Advisories issue every 6 h with intermediates as often
 * as every 2 h.
 *
 * ==> IT WAS 5 MINUTES AGAINST A 5-MINUTE CRON, WHICH IS THE COLLISION §4.13
 * BANS IN CAPITALS. <== An entry that expires on the same beat the warmer runs
 * is a coin flip: land a moment early and the warm request refreshes nothing,
 * land a moment late and the first real reader pays the upstream round trip on
 * a route that exists to have been warmed already. §4.13 is named for
 * DOLPHIN-26, where exactly this produced an intermittent cold read nobody
 * could reproduce.
 *
 * FOUR MINUTES, NOT SIX. The window has to be SHORTER than the cron interval,
 * not longer — a longer one leaves the entry alive when the warmer arrives and
 * the same coin flip happens with the sides swapped. A minute of headroom is
 * enough to absorb the warmer running late without ever outliving it.
 */
const FRESH_SECONDS = 4 * 60;

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
  const slot = `${officeFor(bin)}${prefix}${bin}`;
  const freshKey = new Request(`https://landfall-relay.internal/nhc/advisory/${slot}/fresh`);
  const lastGoodKey = new Request(`https://landfall-relay.internal/nhc/advisory/${slot}/last-good`);

  /* SPEC §17 Pass B. The KV path mirrors the cache SLOT, so the cron Worker —
   * which only knows a bin number — and this route, which computed the slot
   * from a bin and a kind, land on the same string. ONLY TCP IS WARMED: it is
   * the product the panel shows. TCD and TCM stay reachable and simply miss
   * KV, which costs one upstream fetch on a surface almost nobody opens. */
  const warming = isWarmRequest(context.request, context.env);
  const kvPath = `nhc/advisory/${slot}`;

  /* THE HIT IS REBUILT, NEVER HANDED BACK AS STORED. The slot copies below are
   * written with `Cache-Control: s-maxage=...` because that is how
   * `caches.default` is told how long to keep them; returning one verbatim
   * published that instruction to the public internet, and Cloudflare's own
   * edge honoured it. Measured live on the storm list, 2026-08-07.
   * `SPEC-OPS.md` §17.7. */
  const hit = warming ? null : await cache.match(freshKey);
  if (hit) {
    return new Response(await hit.text(), {
      headers: textHeaders({
        'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Product': slot,
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
      [CACHE_PATH_HEADER]: CACHE_PATH.UPSTREAM,
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
        [CACHE_PATH_HEADER]: CACHE_PATH.LAST_GOOD,
      }),
    });
  }

  /* Then the warm copy declined above as too old. An advisory states its own
   * date and time in its header, so a reader can always see how old what they
   * are reading is — a stale product is readable AS stale with no decoration
   * from us (§5). */
  if (warm) {
    return new Response(warm.body, {
      headers: textHeaders({
        'X-Landfall-Fetched-At': warm.fetchedAt || '',
        'X-Landfall-Product': slot,
        'X-Landfall-Stale': 'true',
        [CACHE_PATH_HEADER]: CACHE_PATH.KV_STALE,
      }),
    });
  }

  return errorJson(
    { error: 'advisory_unreachable', detail: String(upstreamError?.message || upstreamError) },
    502
  );
}
