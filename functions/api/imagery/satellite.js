/**
 * /api/imagery/satellite — the relay's satellite job (SPEC §4).
 *
 * Forward-and-cache ONLY, same contract as every other route here: no parsing,
 * no compositing, no per-storm logic. Sibling of ./radar.js and deliberately
 * shaped like it.
 *
 * ==> THIS ROUTE DID NOT EXIST UNTIL 2026-07-26, AND THE REASON IT DOES NOW IS
 *     NOT CORS <==
 *
 * Every satellite vendor Landfall uses sends `Access-Control-Allow-Origin: *`,
 * so the browser always COULD read those pixels directly, and did. That is why
 * radar had a relay and satellite did not, and the reasoning was sound. What
 * changed is a measurement, taken from the deployed site on 2026-07-26:
 *
 *   NASA GIBS sends `Cache-Control: max-age=0, no-store, no-cache,
 *   must-revalidate`, plus `Expires: Thu, 1 Jan 1970`, plus `Pragma: no-cache`.
 *
 * A triple-belt refusal to be cached. So every toggle, every poll, every
 * re-selection re-downloaded the full frame — 826 KB measured on one disc — and
 * GIBS is SLOW AND WILDLY VARIABLE: four identical back-to-back requests
 * returned in 2523 ms, 11785 ms, 30728 ms and 779 ms. Thirty seconds to see a
 * hurricane for the first time, and no client-side cache can ever fix a first
 * view.
 *
 * Behind this route we own the headers, so `max-age=300` makes the browser
 * cache work, and `caches.default` collapses every reader and every storm on
 * screen into one upstream request per box per five minutes. The edge cache is
 * the part that helps a COLD start, which is the half of the problem the client
 * cache cannot touch.
 *
 * A second measurement worth recording, because it argues the same way: two of
 * those four requests returned 826100 bytes and two returned 826635. GIBS
 * serves different frames on consecutive requests, so refetching can hand back
 * an OLDER frame than the one already on screen. Fewer upstream requests is not
 * only cheaper here, it is more stable.
 *
 * NO CLIENT FALLBACK TO GIBS DIRECT. Aaron's call and the right one: a second
 * path exercised once a month has quietly rotted by the time it is needed, and
 * it would make a relay outage invisible — the app would simply go slow again
 * with nothing on screen to say why. One path, and a failure here surfaces on
 * the imagery row where re-tapping the segment is the retry (§5, §7).
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED on purpose — importing config/constants.js would couple a
 * static site to a bundler step we do not have and must never have (§3).
 */

/**
 * ==> A HAND-MAINTAINED MIRROR OF `SATELLITES` IN config/constants.js. <==
 *
 * This is the real cost of the self-contained rule above and it is named rather
 * than buried: two copies of the endpoint/layer/version facts, and nothing
 * checks that they agree. If a bird is added, renamed, or repointed in
 * `config/constants.js`, IT MUST BE CHANGED HERE TOO or that bird 400s.
 * `radar.js` accepts the same tradeoff for its one `UPSTREAM` constant.
 *
 * Kept as narrow as possible — id, endpoint, layer, WMS version, nothing else.
 * Everything the CLIENT needs to know about a satellite (longitude ownership,
 * whether it is colour-enhanced, the grey anchors) stays in the config where it
 * is documented; none of it belongs in a forwarding hop.
 *
 * IT IS ALSO THE ALLOWLIST, which is the second reason it is a table and not a
 * pass-through parameter. An `endpoint` the caller could supply would make this
 * an open proxy pointed at anything — the same rule radar.js states about its
 * bbox regex, applied to the host.
 */
const BIRDS = {
  'goes-east': {
    endpoint: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi',
    layer: 'GOES-East_ABI_Band13_Clean_Infrared',
    wms: '1.1.1',
  },
  'goes-west': {
    endpoint: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi',
    layer: 'GOES-West_ABI_Band13_Clean_Infrared',
    wms: '1.1.1',
  },
  himawari: {
    endpoint: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi',
    layer: 'Himawari_AHI_Band13_Clean_Infrared',
    wms: '1.1.1',
  },
  'meteosat-iodc': {
    endpoint: 'https://view.eumetsat.int/geoserver/ows',
    layer: 'msg_iodc:ir108',
    wms: '1.3.0',
  },
};

/**
 * SPEC §4 cache table: imagery has a 5-minute source cadence, so a 5-minute
 * edge cache never serves a poll its own previous copy while still collapsing
 * the several storms on screen into one upstream request. Same number as radar,
 * for the same reason.
 */
const FRESH_SECONDS = 5 * 60;

/**
 * Upstream deadline.
 *
 * RADAR HAS NO EQUIVALENT AND THIS ONE NEEDS IT: GIBS was measured at 30.7
 * seconds on one of four identical requests. Without a deadline that request
 * occupies a Function invocation until the platform kills it, and the client
 * sees a hang rather than a fault. 20 s matches POLL.fetchTimeout in the app's
 * own config — a request slower than that IS a timeout, and timeouts are
 * retryable (§5).
 */
const UPSTREAM_TIMEOUT_MS = 20 * 1000;

/** Some upstreams 403 requests with no User-Agent. Identify ourselves plainly. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** The one image size the client asks for. Anything else is a caller bug or
 *  someone poking at the endpoint; either way it gets clamped rather than
 *  forwarded, so this cannot be used to bill NASA for arbitrary renders. */
const MAX_PX = 1024;

const fail = (status, message) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const satId = (url.searchParams.get('sat') || '').trim();
  const bbox = url.searchParams.get('bbox') || '';
  const px = Math.min(parseInt(url.searchParams.get('px') || '512', 10) || 512, MAX_PX);

  const bird = Object.prototype.hasOwnProperty.call(BIRDS, satId) ? BIRDS[satId] : null;
  if (!bird) return fail(400, 'unknown satellite');

  /* STRICT INPUT, DELIBERATELY. Four finite numbers and nothing else — this
   * route must not become a general-purpose proxy someone can point at an
   * arbitrary host, and a regex is the whole guard. Copied in shape from
   * radar.js so the two routes cannot drift on their validation. */
  const parts = bbox.split(',');
  if (parts.length !== 4 || parts.some((n) => !/^-?\d+(\.\d+)?$/.test(n.trim()))) {
    return fail(400, 'bbox must be four numbers in EPSG:3857');
  }

  const upstream = new URL(bird.endpoint);
  const p = upstream.searchParams;
  p.set('SERVICE', 'WMS');
  p.set('VERSION', bird.wms);
  p.set('REQUEST', 'GetMap');
  p.set('LAYERS', bird.layer);
  /* WMS 1.1.1 spells the projection SRS and 1.3.0 spells it CRS. Both are here
   * because both vendors are. */
  p.set(bird.wms === '1.3.0' ? 'CRS' : 'SRS', 'EPSG:3857');
  p.set('BBOX', parts.map((n) => n.trim()).join(','));
  p.set('WIDTH', String(px));
  p.set('HEIGHT', String(px));
  /* PNG, NEVER JPEG. Inherited and still true: JPEG ringing near the black end
   * keys as coloured halos once the knockout runs over it. */
  p.set('FORMAT', 'image/png');
  p.set('TRANSPARENT', 'true');
  p.set('STYLES', '');
  /* NO TIME PARAMETER, EVER — see IMAGERY_SENDS_NO_TIME in the app's config.
   * Asking GIBS for a specific timestamp returns blank frames unpredictably.
   * The server knows which frame is its newest complete one and we do not. */

  const cache = caches.default;
  const cacheKey = new Request(upstream.toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstream.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/png' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (e) {
    /* One message for both a refusal and a timeout, on purpose: from the
     * client's side they are the same fault with the same recovery, and §5
     * wants human language rather than a taxonomy. */
    return fail(502, 'satellite service did not respond in time');
  }

  if (!upstreamResponse.ok) {
    return fail(502, `satellite service returned ${upstreamResponse.status}`);
  }

  /* Refuse to cache a non-image. A WMS server answers failures with an XML
   * ServiceException — GIBS does it with a 200 status — and caching that as
   * "satellite" for five minutes would put an error document where the weather
   * should be. Exactly the trap ArcGIS sets for radar.js, different markup. */
  const type = upstreamResponse.headers.get('content-type') || '';
  if (!/^image\//i.test(type)) return fail(502, 'satellite service returned a non-image');

  const body = await upstreamResponse.arrayBuffer();
  const out = new Response(body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': `public, max-age=${FRESH_SECONDS}`,
      /* Same-origin now, so this is belt-and-braces rather than load-bearing
       * the way it is on radar.js — kept so the two routes read identically. */
      'Access-Control-Allow-Origin': '*',
      /* The client reads these pixels to run the knockout and feather the rim.
       * Same-origin makes that fine on its own; this is here so
       * `transferSize` and `encodedBodySize` are readable in
       * PerformanceResourceTiming. Cross-origin opacity reporting those as 0 is
       * what made an earlier probe of GIBS look like a cache hit when it was a
       * full download — this is the header that stops that happening again. */
      'Timing-Allow-Origin': '*',
    },
  });

  context.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}
