/**
 * /api/imagery/radar-coverage — where RainViewer HAS radars (SPEC §4, §4.9).
 *
 * ==> THIS ROUTE IS WHY SINGLE-SOURCE RADAR IS SAFE. <==
 *
 * A radar frame with nothing in it is a fully transparent PNG. So is a radar
 * frame over an ocean nobody watches. They are the same bytes, and the app
 * cannot tell them apart from the image alone — which means that without this
 * route, every blank frame is an ambiguity, and drawing an ambiguity as an
 * all-clear over a live cyclone is the §5 failure this project treats as the
 * worst thing it can ship.
 *
 * NOAA's answer to the same question was a bounding box in `config/constants.js`
 * — a hand-written rectangle that claimed to describe a radar network. It was
 * wrong in both directions at once (Genevieve sat inside it a thousand miles
 * from the nearest radar) and it had no southern hemisphere in it at all. It is
 * deleted. The service publishes a MASK of where its radars actually are, and
 * the service is the only honest authority on that.
 *
 * THE MASK IS INVERTED FROM WHAT YOU EXPECT: transparent means radar coverage
 * EXISTS; opaque black means it does not. Measured — a Japan box came back 19%
 * black, a Congo box 100%, open Pacific 100%.
 *
 * This is geography, not weather. It changes when a country joins or leaves the
 * composite, which RainViewer says is rare, so it is a cache-once asset rather
 * than a per-poll one.
 *
 * Self-contained for the same §3 reason as every route here. Values mirrored in
 * `IMAGERY.radar` and `CACHE.radarCoverageFresh`, guarded by
 * tools/test-relay-mirrors.mjs.
 */

/** The mask host. HARDCODED, unlike the frame route, which reads its host from
 *  the index — and deliberately: the mask needs no index, so hardcoding is what
 *  keeps this a single hop instead of two. If RainViewer ever moves the host,
 *  this route fails, and a failed mask is the "could not tell" state the client
 *  already handles. That is the correct failure, so it needs no fallback. */
const HOST = 'https://tilecache.rainviewer.com';

/** Mirrors `CACHE.radarCoverageFresh`. A day, on data that changes when a
 *  national network joins the composite. Being a day stale means a newly-added
 *  country reads as uncovered for one more day, on a screen that says so
 *  plainly rather than pretending. */
const FRESH_SECONDS = 24 * 60 * 60;

const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

const SIZES = new Set([256, 512]);
const MAX_Z = 7;

const fail = (status, message) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });

const num = (s) => (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN);

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const lat = num(url.searchParams.get('lat') || '');
  const lon = num(url.searchParams.get('lon') || '');
  const z = num(url.searchParams.get('z') || '');
  const px = num(url.searchParams.get('px') || '512');

  if (!Number.isFinite(lat) || lat < -85 || lat > 85) return fail(400, 'lat must be a number between -85 and 85');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return fail(400, 'lon must be a number between -180 and 180');
  if (!Number.isInteger(z) || z < 0 || z > MAX_Z) return fail(400, `z must be a whole number between 0 and ${MAX_Z}`);
  if (!SIZES.has(px)) return fail(400, 'px must be 256 or 512');

  /* `{path}/{version}/{size}/{z}/{lat}/{lon}/{color}/{options}.png`. The two
   * zeros either side are the mask's version and its colour scheme — a mask has
   * one of each, so they are literals rather than parameters. */
  const upstream = `${HOST}/v2/coverage/0/${px}/${z}/${lat}/${lon}/0/0_0.png`;

  const cache = caches.default;
  const cacheKey = new Request(upstream, { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstream, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/png' },
    });
  } catch (e) {
    return fail(502, 'radar coverage did not respond');
  }

  if (!upstreamResponse.ok) return fail(502, `radar coverage returned ${upstreamResponse.status}`);

  const type = upstreamResponse.headers.get('content-type') || '';
  if (!/^image\//i.test(type)) return fail(502, 'radar coverage returned a non-image');

  const body = await upstreamResponse.arrayBuffer();
  const out = new Response(body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': `public, max-age=${FRESH_SECONDS}`,
      /* The client reads these pixels — counting opaque ones is the whole
       * point of the mask — so the image must be untainted. */
      'Access-Control-Allow-Origin': '*',
    },
  });

  context.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}
