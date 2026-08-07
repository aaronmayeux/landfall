/**
 * /api/imagery/radar — the relay's radar job (SPEC §4).
 *
 * Forward-and-cache ONLY, same contract as every other route here: no parsing,
 * no compositing, no per-storm logic.
 *
 * WHY RADAR NEEDS THIS AND SATELLITE DOES NOT. Measured 2026-07-25 from the
 * deployed site: every satellite vendor Landfall uses (NASA GIBS, EUMETSAT)
 * sends `Access-Control-Allow-Origin: *`, so the browser can fetch and read
 * those pixels directly. NOAA's radar ImageServer sends NO CORS header at all,
 * and the client has to READ the pixels (it feathers the disc's rim), which a
 * tainted cross-origin image forbids. So this one hop exists, and only this one.
 *
 * ALSO MEASURED, AND THE SPEC WAS STALE: `nowcoast.noaa.gov` IS GONE. It
 * answers 403 through a CDN error page. The service lives on
 * mapservices.weather.noaa.gov and SPEC §4's "NOAA nowCOAST" naming has been
 * corrected to match.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED on purpose — importing config/constants.js would couple a
 * static site to a bundler step we do not have and must never have (§3).
 */

const UPSTREAM =
  'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer/exportImage';

/**
 * SPEC §4 cache table: imagery has a 5-minute source cadence, so a 5-minute
 * edge cache never serves a poll its own previous copy while still collapsing
 * the several storms on screen into one upstream request.
 */
const FRESH_SECONDS = 5 * 60;

/** NOAA servers 403 requests with no User-Agent. Identify ourselves plainly. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** The one image size the client asks for. Anything else is a caller bug or
 *  someone poking at the endpoint; either way it gets clamped rather than
 *  forwarded, so this cannot be used to bill NOAA for arbitrary renders. */
const MAX_PX = 1024;

const fail = (status, message) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const bbox = url.searchParams.get('bbox') || '';
  const px = Math.min(parseInt(url.searchParams.get('px') || '512', 10) || 512, MAX_PX);

  /* STRICT INPUT, DELIBERATELY. Four finite numbers and nothing else — this
   * route must not become a general-purpose proxy someone can point at an
   * arbitrary host, and a regex is the whole guard. */
  const parts = bbox.split(',');
  if (parts.length !== 4 || parts.some((n) => !/^-?\d+(\.\d+)?$/.test(n.trim()))) {
    return fail(400, 'bbox must be four numbers in EPSG:3857');
  }

  const upstream = new URL(UPSTREAM);
  const p = upstream.searchParams;
  p.set('bbox', parts.map((n) => n.trim()).join(','));
  p.set('bboxSR', '3857');
  p.set('imageSR', '3857');
  p.set('size', `${px},${px}`);
  /* PNG32 — a true transparent PNG. The service already keys no-echo areas
   * transparent, which is why radar needs no knockout on the client. */
  p.set('format', 'png32');
  p.set('transparent', 'true');
  p.set('f', 'image');

  const cache = caches.default;
  const cacheKey = new Request(upstream.toString(), { method: 'GET' });
  /* ==> THIS ROUTE HANDS BACK ITS CACHE ENTRY VERBATIM ON PURPOSE. <== Every
   * data route rebuilds instead, to stop an INTERNAL `s-maxage` reaching
   * Cloudflare's public edge (`SPEC-OPS.md` §17.7). Two reasons this one is
   * different, and both have to hold:
   *   1. The directive here is `public, max-age=...`, written for the BROWSER,
   *      not `s-maxage`, written for the cache slot. It is meant to be seen.
   *   2. The body is PNG bytes. Rebuilding a data route costs one `text()`;
   *      doing that to an image would decode binary as UTF-8 and corrupt it.
   * A radar frame is also the same frame for everyone who asks in the same
   * five minutes, so an edge that holds it is saving NOAA a request, not
   * hiding a stale timestamp behind a third clock. */
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstream.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/png' },
    });
  } catch (e) {
    return fail(502, 'radar service did not respond');
  }

  if (!upstreamResponse.ok) return fail(502, `radar service returned ${upstreamResponse.status}`);

  /* Refuse to cache a non-image. ArcGIS answers some failures with a JSON
   * error body and a 200 status, and caching that as "radar" for five minutes
   * would put an error document where the weather should be. */
  const type = upstreamResponse.headers.get('content-type') || '';
  if (!/^image\//i.test(type)) return fail(502, 'radar service returned a non-image');

  const body = await upstreamResponse.arrayBuffer();
  const out = new Response(body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': `public, max-age=${FRESH_SECONDS}`,
      /* The client reads these pixels to feather the disc's rim, so the image
       * must be untainted. This header is the reason this route exists. */
      'Access-Control-Allow-Origin': '*',
    },
  });

  context.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}
