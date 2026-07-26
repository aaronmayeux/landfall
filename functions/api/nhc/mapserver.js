/**
 * /api/nhc/mapserver — NHC's tropical MapServer, relayed. SPEC §17 Pass B (B1).
 *
 * ===> THIS ROUTE DID NOT EXIST BEFORE PASS B, AND THAT WAS THE OTHER HOLE. <===
 * `data/nhc-mapserver.js` fetched `mapservices.weather.noaa.gov` DIRECTLY from
 * the browser — one metadata call plus NINE layer queries per selected storm,
 * per reader. CORS-open, so it worked, so nobody looked again (the same
 * mistake, in the same week, as the GDACS event list next door in
 * `functions/api/gdacs/events.js` — read that header, the reasoning is one
 * reasoning). Ten thousand readers tapping storms on a shared link is ninety
 * thousand ArcGIS queries from ten thousand client IPs with no shared cache
 * anywhere in the path.
 *
 * Relaying it collapses that to one query per layer per colo per 30 minutes.
 *
 * ===> THE UPSTREAM IS THE *SUMMARY* SERVICE NOW, AND THAT IS LOAD-BEARING.
 *      2026-07-26. <===
 * `NHC_tropical_weather` slices the same nine products into per-storm blocks
 * of 26 layers, addressed by arithmetic on the feed's bin number.
 * `NHC_tropical_weather_summary` is those nine products with every storm in
 * ONE set of layers, keyed by `binnumber`. The block service went blank for
 * Hurricane Fausto the moment he crossed 140°W — the feed moved his bin to
 * CP1, the CP1 block was empty, and his geometry sat in EP1 where nothing was
 * looking. The summary service had the new advisory under the new bin
 * immediately. `data/nhc-mapserver.js` carries the full measurement.
 *
 * THAT ALSO DELETED THIS ROUTE'S `meta=1` MODE. It existed to serve the
 * service's layer LIST, which the client cached for a day and used to resolve
 * layer ids by name inside a block. With fixed layer ids there is nothing to
 * resolve, so the mode is gone rather than left dangling. The long comment
 * that used to live here about why this route is deliberately NOT pre-warmed
 * into KV went with it: the argument was that warming would mean duplicating
 * the block math in a Worker that cannot import it, and there is no block math
 * any more. Warming this route is now a plain question of whether it is worth
 * it, not a correctness trap.
 *
 * ===> `all=1` IS GONE AND MUST NOT COME BACK. <===
 * The client used to answer a refused clause by re-querying unfiltered. On the
 * block service that was safe — a block layer only ever holds one storm. On
 * the summary service `1=1` returns EVERY ACTIVE STORM, so the old fallback
 * would now hand one storm's panel three storms' cones. There is exactly one
 * filter mode here on purpose.
 *
 * THE WHERE CLAUSE IS BUILT HERE, NOT PASSED IN, and that is the same shape
 * as every other parameterized relay route rather than a new exception:
 * `advisory.js` takes a bin and builds `MIATCP{bin}`, `warning.js` takes a
 * product name and builds a path, `adeck.js` takes a storm id and builds a
 * filename. Each validates a shape and constructs the upstream itself.
 * Accepting a caller-supplied `where` string would make this an arbitrary
 * query proxy into a federal ArcGIS service — the open-proxy problem §17 A2
 * closed on the inspect routes, reopened on a bigger endpoint.
 *
 * ARCGIS ERRORS ARE FORWARDED, NOT CONVERTED. ArcGIS reports failures as HTTP
 * 200 with an `error` body, and the client depends on seeing that body to mark
 * the layer `unavailable` rather than empty. The body goes back verbatim; it
 * is simply never CACHED.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED on purpose (§3). The numbers below mirror SPEC §4's cache
 * table; that table is the truth.
 */

const UPSTREAM =
  'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer';

/** Bin number: two letters and a digit (`AT2`, `EP1`, `CP1`). The same shape
 *  `advisory.js` and `worker/src/sources.js` already validate, and now the
 *  ONLY thing that reaches the WHERE clause. */
const BIN_RE = /^[A-Z]{2}\d$/;

/** Layer ids are small non-negative integers. The summary service tops out at
 *  34; the bound exists to reject junk before a request is made, not to
 *  predict NOAA's layer count. An id past the end of the service is ArcGIS's
 *  200-with-error, which is forwarded like any other. */
const MAX_LAYER_ID = 999;

/**
 * GEOMETRY SIMPLIFICATION — the single biggest thing this route does for a
 * phone, and the reason it is applied HERE rather than client-side: it is a
 * query parameter, so the bytes are never sent at all.
 *
 * `maxAllowableOffset` is in the output spatial reference's units, and outSR
 * is 4326, so this is DEGREES. 0.01° ≈ 1.1 km — far below what a wind-radii
 * quadrant arc or a forecast cone edge means at any zoom this app renders,
 * and far below the precision NHC's own published radii imply (they are issued
 * in whole nautical miles per quadrant).
 *
 * MEASURED on Fausto, 2026-07-26, one storm, one load:
 *     past wind radii   993 KB → 78 KB
 *     forecast radii    205 KB → 16 KB
 *     forecast cone      87 KB → 1.5 KB
 *   total per storm    1.29 MB → 96 KB
 *
 * ONLY THE POLYGON AND LINE LAYERS ARE LISTED. Simplification is a no-op on
 * point geometry, so forecast points (5) and past points (10) are absent by
 * design — listing them would imply a saving that does not exist and invite
 * someone to "fix" the omission. Past points in particular feed the swath
 * envelope's join and must stay exact.
 */
const SIMPLIFY_DEGREES = 0.01;
const SIMPLIFY_LAYERS = new Set([6, 7, 11, 13, 15, 16]);

/** SPEC §4 cache table: per-storm GEOMETRY, so it takes the GDACS geometry
 *  row's numbers — same role, same argument. Geometry already lags the storm
 *  feed by 3¾–6¾ h (§4, confirmed live), so 30 minutes on top is noise. */
const QUERY_FRESH_SECONDS = 30 * 60;
const QUERY_STALE_SECONDS = 12 * 60 * 60;

/**
 * AN EMPTY ANSWER IS CACHED FOR MINUTES, NOT HALF AN HOUR.
 *
 * On the block service an empty layer was routine and permanent — a retired
 * storm's block stays flushed. On the summary service an empty answer for a
 * VALID bin means one of two things, and both are transient: the bin was
 * created by an advisory whose geometry has not published yet (measured
 * 2026-07-26: 21 minutes and counting after Fausto's bin moved to CP1), or the
 * storm has just been retired and the feed has not caught up. Holding "nothing
 * here" for thirty minutes turns a publication gap into a half-hour outage for
 * every reader on that colo.
 *
 * Deliberately matched to CACHE.geometryRetryMs in config/constants.js, which
 * is how long the CLIENT waits before asking again. If these two drift, one
 * side spends the whole window re-reading the other's cached nothing. */
const EMPTY_FRESH_SECONDS = 5 * 60;

/** NOAA servers 403 requests with no User-Agent. Identify ourselves plainly. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

const baseHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});

const errorJson = (obj, status) =>
  new Response(JSON.stringify(obj), { status, headers: baseHeaders() });

/**
 * Resolve the request into { slot, target, fresh, stale }, or null when the
 * parameters do not describe something this route is willing to fetch.
 *
 * `slot` names the cache entry and is built ONLY from values that have already
 * passed their pattern, so it can never carry caller text into a cache key.
 */
function resolveTarget(url) {
  const rawLayer = url.searchParams.get('layer');
  if (rawLayer == null) return null;
  if (!/^\d{1,3}$/.test(rawLayer)) return null;
  const layer = parseInt(rawLayer, 10);
  if (!(layer >= 0 && layer <= MAX_LAYER_ID)) return null;

  /* ONE filter mode. See the `all=1` note in the header for why there is not
   * a second one, and `data/nhc-mapserver.js` for why `binnumber` rather than
   * `stormid`: every layer on this service carries the bin, only four carry a
   * storm id, and those four disagree with each other about its case. */
  const bin = String(url.searchParams.get('bin') || '').toUpperCase().trim();
  if (!BIN_RE.test(bin)) return null;

  const params = new URLSearchParams({
    where: `binnumber='${bin}'`,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  });
  if (SIMPLIFY_LAYERS.has(layer)) {
    params.set('maxAllowableOffset', String(SIMPLIFY_DEGREES));
  }

  return {
    slot: `${layer}/bin-${bin}`,
    target: `${UPSTREAM}/${layer}/query?${params}`,
    fresh: QUERY_FRESH_SECONDS,
    stale: QUERY_STALE_SECONDS,
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const plan = resolveTarget(url);
  if (!plan) {
    /* A 400, not a 502: a bad request, not a dead source. data/relay.js only
     * retries 5xx (§4), so this correctly never retries. */
    return errorJson(
      {
        error: 'bad_mapserver_request',
        detail: 'expected layer=<id> with bin=<AT2>',
      },
      400
    );
  }

  const cache = caches.default;
  const slot = encodeURIComponent(plan.slot);
  const freshKey = new Request(`https://landfall-relay.internal/nhc/mapserver/${slot}/fresh`);
  const lastGoodKey = new Request(`https://landfall-relay.internal/nhc/mapserver/${slot}/last-good`);

  const hit = await cache.match(freshKey);
  if (hit) return hit;

  let upstreamError;
  try {
    const r = await fetch(plan.target, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
    const body = await r.text();

    /* Parse to CLASSIFY, forward as text. Three outcomes, and only one of
     * them is cacheable. */
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error('upstream returned non-JSON');
    }

    const fetchedAt = new Date().toISOString();
    const headers = baseHeaders({ 'X-Landfall-Fetched-At': fetchedAt });

    /* ArcGIS's 200-with-error. Forwarded verbatim so the client can mark the
     * layer `unavailable` rather than empty, and deliberately NOT cached — a
     * cached rejection would turn one refused clause into thirty minutes of a
     * storm having no cone. */
    if (parsed && parsed.error) {
      return new Response(body, {
        headers: baseHeaders({ 'X-Landfall-Upstream': 'arcgis-error' }),
      });
    }

    /* Anything that is neither an error nor a usable payload is a surprise.
     * Forward it — the client already refuses what it cannot read — but do
     * not store it. */
    if (!(parsed && parsed.type === 'FeatureCollection')) {
      return new Response(body, {
        headers: baseHeaders({ 'X-Landfall-Upstream': 'unexpected-shape' }),
      });
    }

    /* An empty FeatureCollection is a real answer and gets cached, but on the
     * short clock (see EMPTY_FRESH_SECONDS) and never as last-good: serving a
     * remembered nothing when upstream is down is strictly worse than serving
     * the last real geometry we saw. */
    const empty = !(Array.isArray(parsed.features) && parsed.features.length);
    const fresh = empty ? EMPTY_FRESH_SECONDS : plan.fresh;

    const writes = [
      cache.put(
        freshKey,
        new Response(body, {
          headers: { ...headers, 'Cache-Control': `s-maxage=${fresh}` },
        })
      ),
    ];
    if (!empty) {
      writes.push(
        cache.put(
          lastGoodKey,
          new Response(body, {
            headers: { ...headers, 'Cache-Control': `s-maxage=${plan.stale}` },
          })
        )
      );
    }
    context.waitUntil(Promise.all(writes));

    return new Response(body, {
      headers: empty ? { ...headers, 'X-Landfall-Empty': 'true' } : headers,
    });
  } catch (e) {
    upstreamError = e;
  }

  /* Upstream failed. Serve last-good flagged stale — a six-hour-old cone is
   * the right shape in the right ocean and beats a blank layer (§5). */
  const stale = await cache.match(lastGoodKey);
  if (stale) {
    const body = await stale.text();
    return new Response(body, {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Stale': 'true',
      }),
    });
  }

  return errorJson(
    {
      error: 'mapserver_unreachable',
      detail: String((upstreamError && upstreamError.message) || upstreamError),
    },
    502
  );
}
