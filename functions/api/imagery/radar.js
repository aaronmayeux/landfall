/**
 * /api/imagery/radar — the relay's radar job (SPEC §4, §4.9).
 *
 * Forward-and-cache ONLY, same contract as every other route here: no parsing
 * beyond finding the newest frame, no compositing, no per-storm logic.
 *
 * ==> THE UPSTREAM CHANGED, AND SO DID THE REASON THIS ROUTE EXISTS. <==
 *
 * It used to forward to NOAA's `radar_base_reflectivity_time` ImageServer,
 * whose defining property was that it sent NO CORS header — the client has to
 * READ these pixels (it feathers the disc's rim) and a tainted cross-origin
 * image forbids that, so the hop was mandatory. RainViewer sends CORS on both
 * of its hosts (measured 2026-08-19 from a real browser), so that argument is
 * simply gone and any comment repeating it is wrong.
 *
 * TWO ARGUMENTS CARRY THE ROUTE NOW, and both have to hold:
 *
 *   1. CSP. Fetching direct means adding TWO origins to `connect-src`, which
 *      today is `'self' blob: data: https://tiles.openfreemap.org
 *      https://cloudflareinsights.com` and which this project charges for.
 *      A Pages Function keeps it untouched.
 *   2. RainViewer's terms ask for aggressive caching and say plainly that an
 *      abusive IP gets blocked. One upstream request per frame shared by every
 *      visitor is the right way to treat a free service with no SLA; one per
 *      device is not.
 *
 * WHAT NOAA DID NOT COST AND THIS DOES: a second hop. The tile path is
 * unguessable — it carries a hash that changes every ten minutes — so the
 * 818-byte frame list has to be read before an image can be addressed. At the
 * edge that is one cheap shared request, which is a third argument for the
 * relay rather than a mark against it.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED on purpose — importing config/constants.js would couple a
 * static site to a bundler step we do not have and must never have (§3). The
 * hand-copied values below are guarded by tools/test-relay-mirrors.mjs.
 */

/** The frame index. 818 bytes, `Cache-Control: no-cache`, lists 13 frames on
 *  600-second steps spanning two hours. Its `host` field is authoritative for
 *  where the tiles live, so nothing here hardcodes a tile host. */
const INDEX_URL = 'https://api.rainviewer.com/public/weather-maps.json';

/**
 * SPEC §4.9 cache table. Mirrors `CACHE.radarFresh`.
 *
 * TEN MINUTES BECAUSE THE SOURCE PUBLISHES ON TEN, not because ten is a round
 * number. The old NOAA route said five, matching a five-minute source. A cache
 * shorter than the cadence asks twice for bytes that cannot have changed.
 */
const FRESH_SECONDS = 10 * 60;

/** How long the edge holds the frame INDEX. Much shorter than a frame, because
 *  this is the thing that discovers a new frame exists — but not zero, so a
 *  dozen storms on one screen share one lookup rather than each making their
 *  own. */
const INDEX_FRESH_SECONDS = 60;

/** Mirrors `IMAGERY.radar.colorScheme` / `.smooth` / `.snow`.
 *
 *  ==> SMOOTH IS 0 AND MUST STAY 0. <== With `smooth=1` an open-Pacific frame
 *  containing NO radar coverage at all came back 10 KB with muddy blended
 *  colour and a non-zero kept fraction; at `smooth=0` the same request was
 *  1,096 bytes and a kept fraction of exactly 0. The client reads ALPHA to
 *  decide whether a frame has anything in it, and blur invents alpha outside
 *  the data — so a smoothed tile puts a blank raster over a live storm and
 *  leaves the status row silent, which is the §5 failure this layer keeps
 *  finding new roads to. */
const COLOR_SCHEME = 2;
const SMOOTH = 0;
const SNOW = 0;

/** Identify ourselves plainly. RainViewer publishes no rate limit but does say
 *  it blocks abuse, and an anonymous flood is what gets blocked. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** RainViewer serves 256 or 512 and nothing else. Anything else is a caller bug
 *  or somebody poking at the endpoint; either way it is clamped rather than
 *  forwarded. */
const SIZES = new Set([256, 512]);

/** Documented maximum zoom. Above this the service has nothing to serve. */
const MAX_Z = 7;

const fail = (status, message) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });

/** Four finite numbers and nothing else. This route must not become a
 *  general-purpose proxy someone can point at an arbitrary host, and the guard
 *  is the whole defence — there is no allowlist downstream, because the
 *  upstream URL is assembled here from a host the INDEX gave us. */
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

  const cache = caches.default;

  /* ==> KEYED ON OUR OWN PARAMETERS, NOT ON THE UPSTREAM URL. <==
   *
   * Every other route here keys on the address it forwards to, which is the
   * obvious thing and would be wrong here: the upstream path carries a hash
   * that changes every ten minutes, so an upstream key would mean fetching the
   * index on EVERY request just to discover which key to look under — the exact
   * cost the cache exists to avoid.
   *
   * Keying on (lat, lon, z, px) with a ten-minute lifetime rolls onto the new
   * frame on its own, because the entry expires on the same cadence the source
   * publishes. The most it can be behind is one frame, on a product that is
   * already 355 seconds old when it appears. */
  const canonical = new URL(url.origin + url.pathname);
  canonical.searchParams.set('lat', String(lat));
  canonical.searchParams.set('lon', String(lon));
  canonical.searchParams.set('z', String(z));
  canonical.searchParams.set('px', String(px));
  const cacheKey = new Request(canonical.toString(), { method: 'GET' });

  /* ==> THIS ROUTE HANDS BACK ITS CACHE ENTRY VERBATIM ON PURPOSE. <== Every
   * data route rebuilds instead, to stop an INTERNAL `s-maxage` reaching
   * Cloudflare's public edge (`SPEC-OPS.md` §17.7). Two reasons this one is
   * different, and both still hold after the upstream swap:
   *   1. The directive here is `public, max-age=...`, written for the BROWSER,
   *      not `s-maxage`, written for the cache slot. It is meant to be seen.
   *   2. The body is PNG bytes. Rebuilding a data route costs one `text()`;
   *      doing that to an image would decode binary as UTF-8 and corrupt it. */
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let frame;
  try {
    frame = await newestFrame(cache, context);
  } catch (e) {
    return fail(502, e && e.message ? e.message : 'radar frame list did not respond');
  }

  const upstream = `${frame.host}${frame.path}/${px}/${z}/${lat}/${lon}/${COLOR_SCHEME}/${SMOOTH}_${SNOW}.png`;

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstream, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/png' },
    });
  } catch (e) {
    return fail(502, 'radar service did not respond');
  }

  if (!upstreamResponse.ok) return fail(502, `radar service returned ${upstreamResponse.status}`);

  /* Refuse to cache a non-image, same as the NOAA route did and for the same
   * reason: a service that answers a failure with a 200 and a text body would
   * otherwise put an error document where the weather should be, for ten
   * minutes, for everybody. */
  const type = upstreamResponse.headers.get('content-type') || '';
  if (!/^image\//i.test(type)) return fail(502, 'radar service returned a non-image');

  const body = await upstreamResponse.arrayBuffer();
  const out = new Response(body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': `public, max-age=${FRESH_SECONDS}`,
      /* The client reads these pixels to feather the disc's rim. RainViewer
       * would allow that directly; going through us, this header is what keeps
       * it true. */
      'Access-Control-Allow-Origin': '*',
    },
  });

  context.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

/**
 * The newest published radar frame — its host and its path.
 *
 * `radar.past` is ordered oldest-first and the last entry is the newest
 * published frame. `radar.nowcast` is deliberately IGNORED: it is a forecast of
 * where the rain will be, and this layer's entire job is showing where the rain
 * IS. Drawing a prediction under a label that says "radar" is a §5
 * confidently-wrong answer, not a bonus feature.
 *
 * THROWS RATHER THAN GUESSING. If the shape ever changes, the caller returns a
 * 502 with a human sentence and the app's status row says radar is unavailable
 * — which is true. Falling back to a hardcoded tile path would draw whatever
 * happened to be at that address, which could be two hours old with nothing on
 * screen to say so.
 */
async function newestFrame(cache, context) {
  const indexKey = new Request(INDEX_URL, { method: 'GET' });
  let res = await cache.match(indexKey);

  if (!res) {
    const fetched = await fetch(INDEX_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!fetched.ok) throw new Error(`radar frame list returned ${fetched.status}`);
    /* Rebuilt, not stored verbatim — the opposite of the image path above, and
     * for §17.7's reason: the source sends `Cache-Control: no-cache`, and
     * storing that would mean this lookup never caches at all. */
    const text = await fetched.text();
    res = new Response(text, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${INDEX_FRESH_SECONDS}`,
      },
    });
    context.waitUntil(cache.put(indexKey, res.clone()));
  }

  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error('radar frame list was not JSON');
  }

  const host = json && typeof json.host === 'string' ? json.host : '';
  const past = json && json.radar && Array.isArray(json.radar.past) ? json.radar.past : [];
  const newest = past.length ? past[past.length - 1] : null;

  if (!host || !newest || typeof newest.path !== 'string') {
    throw new Error('radar frame list had no usable frame');
  }
  /* The host comes off the wire and is pasted into a URL we then fetch, so it
   * gets checked rather than trusted. A compromised or simply changed index
   * must not be able to turn this route into a proxy for an arbitrary origin. */
  if (!/^https:\/\/[a-z0-9.-]+\.rainviewer\.com$/.test(host)) {
    throw new Error('radar frame list named an unexpected host');
  }
  if (!/^\/[A-Za-z0-9/_-]+$/.test(newest.path)) {
    throw new Error('radar frame list named an unexpected path');
  }

  return { host, path: newest.path };
}
