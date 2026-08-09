/**
 * /api/nhc/surge — NHC's Peak Storm Surge polygons, relayed. SPEC §4.8, §8.
 *
 * ==> THIS SERVICE HAS NO STORM ID. THAT IS THE WHOLE REASON THIS ROUTE IS NOT
 *     JUST ANOTHER MODE OF /api/nhc/mapserver. <==
 * `NHC_PeakStormSurge` is one Points/Lines/Polygons trio serving EVERY active
 * storm at once. There is no `stormid` column and no `binnumber` column to
 * filter on, so the filter is SPATIAL: an envelope around the storm's current
 * position. Every other geometry route in this app keys a cache entry on a
 * storm; this one keys it on a PLACE, and pretending otherwise would give two
 * storms in the same basin each other's surge.
 *
 * ==> THE CACHE KEY IS A ROUNDED STORM POSITION, AND THE CLIENT ROUNDS IT. <==
 * `?lon=-89&lat=28`. Whole degrees, so the key moves only after 60 nm of storm
 * travel while the envelope stays 12 degrees deep — nothing near the edge is
 * lost, and a fleet of readers watching one storm share one upstream fetch
 * instead of minting a key per advisory position. The client
 * (`data/surge.js`) does the rounding; this route REJECTS anything that is not
 * already an integer rather than rounding it itself, because a route that
 * quietly accepts `-89.4137` would happily cache 10,000 keys for one storm and
 * nothing would look wrong.
 *
 * ==> AND IT IS WHY HOME'S COORDINATES ARE NOT IN THIS URL. <==
 * A tight envelope around the user's house would be a smaller query and a
 * faster answer. It would also put somebody's home address into a request, a
 * relay log and a SHARED CACHE KEY. Home is device-local (§8, §17). The
 * envelope is centred on the storm, the whole band set comes back, and the
 * point-in-band test happens on the phone. Do not "optimise" this.
 *
 * `maxAllowableOffset` is 0.005 degrees here rather than the 0.01 the storm
 * geometry uses (§4.8). Surge bands are the finest geometry NHC publishes —
 * they follow individual bay shores — and at 0.01 the inner reaches close up.
 * ~550 m, still an order of magnitude below what the map draws.
 *
 * Everything below the query construction is the same shape as
 * `functions/api/nhc/mapserver.js`: fresh key, last-good key, ArcGIS's
 * 200-with-error forwarded but never cached, empty answers cached on a short
 * clock, `no-store` to the browser. Read that file's header for the reasoning;
 * it is one reasoning and it is not repeated here.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED on purpose (§3).
 */

const UPSTREAM =
  'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_PeakStormSurge/MapServer';

/** Polygon layer. §4.8, confirmed against the live service 2026-08-09:
 *  0 Points, 1 Lines, 2 Polygons. */
const POLYGON_LAYER = 2;

/** Envelope half-width, degrees. Mirrors HOME_THREAT.surgeEnvelopeDeg in
 *  config/constants.js — the client and the relay must agree about how much
 *  ocean a cache key covers, and this file cannot import that one. */
const ENVELOPE_DEG = 12;

/** ~550 m. Fine enough for a bay shore, coarse enough to halve the bytes. */
const SIMPLIFY_DEGREES = 0.005;

const QUERY_FRESH_SECONDS = 30 * 60;
const QUERY_STALE_SECONDS = 12 * 60 * 60;

/** An empty answer means "no surge product published near this position", and
 *  that flips the moment a storm threatens a coast. Matched to
 *  CACHE.geometryRetryMs on the client, same as the mapserver route. */
const EMPTY_FRESH_SECONDS = 5 * 60;

const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

const baseHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  ...extra,
});

const errorJson = (obj, status) =>
  new Response(JSON.stringify(obj), { status, headers: baseHeaders() });

/** Integer degrees only — see the cache-key note in the header. A leading `-`
 *  and up to three digits; nothing else, so no exponent, no decimal, no space. */
const INT_RE = /^-?\d{1,3}$/;

function resolveTarget(url) {
  const rawLon = url.searchParams.get('lon');
  const rawLat = url.searchParams.get('lat');
  if (!INT_RE.test(rawLon || '') || !INT_RE.test(rawLat || '')) return null;

  const lon = parseInt(rawLon, 10);
  const lat = parseInt(rawLat, 10);
  if (!(lon >= -180 && lon <= 180) || !(lat >= -90 && lat <= 90)) return null;

  /* The envelope is CLAMPED IN LATITUDE and NOT in longitude. Latitude past
   * the poles is not a place; longitude past the antimeridian is, and ArcGIS
   * accepts an xmin below -180 as the wrap it is. Clamping longitude would cut
   * the envelope in half for a storm sitting on the date line. */
  const envelope = {
    xmin: lon - ENVELOPE_DEG,
    ymin: Math.max(-90, lat - ENVELOPE_DEG),
    xmax: lon + ENVELOPE_DEG,
    ymax: Math.min(90, lat + ENVELOPE_DEG),
    spatialReference: { wkid: 4326 },
  };

  const params = new URLSearchParams({
    where: '1=1',
    geometry: JSON.stringify(envelope),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: String(SIMPLIFY_DEGREES),
    f: 'geojson',
  });

  return {
    /* Built only from values that already passed INT_RE, so no caller text can
     * reach a cache key. */
    slot: `poly/${lon}/${lat}`,
    target: `${UPSTREAM}/${POLYGON_LAYER}/query?${params}`,
    fresh: QUERY_FRESH_SECONDS,
    stale: QUERY_STALE_SECONDS,
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const plan = resolveTarget(url);
  if (!plan) {
    /* 400, not 502: a bad request, not a dead source. data/relay.js retries
     * only 5xx and 429 (§4), so this correctly never retries. */
    return errorJson(
      { error: 'bad_surge_request', detail: 'expected integer lon and lat' },
      400
    );
  }

  const cache = caches.default;
  const slot = encodeURIComponent(plan.slot);
  const freshKey = new Request(`https://landfall-relay.internal/nhc/surge/${slot}/fresh`);
  const lastGoodKey = new Request(`https://landfall-relay.internal/nhc/surge/${slot}/last-good`);

  const hit = await cache.match(freshKey);
  if (hit) {
    return new Response(await hit.text(), {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Cache': 'fresh',
      }),
    });
  }

  let upstreamError;
  try {
    const r = await fetch(plan.target, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
    const body = await r.text();

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error('upstream returned non-JSON');
    }

    const fetchedAt = new Date().toISOString();
    const headers = baseHeaders({ 'X-Landfall-Fetched-At': fetchedAt, 'X-Landfall-Cache': 'miss' });

    /* ArcGIS reports failure as HTTP 200 with an `error` body. Forwarded so
     * the client can mark the slot `unavailable` rather than empty, and never
     * cached — a cached rejection is half an hour of a coast with no surge. */
    if (parsed && parsed.error) {
      return new Response(body, {
        headers: baseHeaders({ 'X-Landfall-Upstream': 'arcgis-error' }),
      });
    }

    if (!(parsed && parsed.type === 'FeatureCollection')) {
      return new Response(body, {
        headers: baseHeaders({ 'X-Landfall-Upstream': 'unexpected-shape' }),
      });
    }

    const empty = !(Array.isArray(parsed.features) && parsed.features.length);
    const fresh = empty ? EMPTY_FRESH_SECONDS : plan.fresh;

    const writes = [
      cache.put(
        freshKey,
        new Response(body, { headers: { ...headers, 'Cache-Control': `s-maxage=${fresh}` } })
      ),
    ];
    if (!empty) {
      writes.push(
        cache.put(
          lastGoodKey,
          new Response(body, { headers: { ...headers, 'Cache-Control': `s-maxage=${plan.stale}` } })
        )
      );
    }
    context.waitUntil(Promise.all(writes));

    return new Response(body, { headers });
  } catch (e) {
    upstreamError = e;
  }

  /* ==> LAST-GOOD SURGE IS SERVED, AND IT IS FLAGGED. <== A six-hour-old surge
   * footprint is the right water in the right bays from an older advisory,
   * which beats a blank panel for somebody deciding whether to leave (§5). The
   * `X-Landfall-Stale` header is what lets the panel say which it is. */
  const stale = await cache.match(lastGoodKey);
  if (stale) {
    return new Response(await stale.text(), {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Stale': 'true',
        'X-Landfall-Cache': 'last-good',
      }),
    });
  }

  return errorJson(
    {
      error: 'surge_unreachable',
      detail: String((upstreamError && upstreamError.message) || upstreamError),
    },
    502
  );
}
