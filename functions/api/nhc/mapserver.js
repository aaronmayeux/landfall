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
 * ===> AND IT IS DELIBERATELY *NOT* PRE-WARMED INTO KV. READ THIS BEFORE
 *      "FINISHING" PASS B BY ADDING IT. <===
 * Every other warmed route is keyed by a string the storm list hands over
 * whole — a storm id, a bin number, a product name, a published URL. This one
 * is keyed by a LAYER ID, and a layer id is the output of §4's block math:
 * `blockStart[basin] + (slot - 1) * 26`, then a resolve-by-NAME pass over the
 * service's own layer list against the `MAPSERVER.layerName` patterns. That
 * math and those patterns live in `config/constants.js` and
 * `data/nhc-mapserver.js`, which a Worker in a separate deploy CANNOT IMPORT
 * (§3, no bundler). Warming this route means a second copy of the fiddliest
 * arithmetic in the project, in a runtime that never renders anything, where
 * a drift between the copies would silently point a confident cone at the
 * wrong storm — §7's "wrong-but-plausible layer" failure, which already cost
 * a day once and looks like nothing is broken.
 *
 * The colo cache alone already takes this from per-reader to per-colo, which
 * is the ~30x that mattered. The remaining 300x is not worth buying with a
 * duplicated block calculation. If it ever becomes worth it, the honest way
 * is to have the WORKER call this route rather than reimplement it.
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
 * ARCGIS ERRORS ARE FORWARDED, NOT CONVERTED, AND THAT IS LOAD-BEARING.
 * ArcGIS reports failures as HTTP 200 with an `error` body, and
 * `data/nhc-mapserver.js` DEPENDS on seeing that body: its `fetchLayer` catch
 * retries unfiltered when the stormid clause is rejected, which is what keeps
 * layers alive when ArcGIS refuses the filter for reasons it declines to
 * name. Turning an ArcGIS error into a 502 here would delete that fallback
 * from a distance and the symptom would be layers going quietly missing. The
 * body goes back verbatim; it is simply never CACHED.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED on purpose (§3). The numbers below mirror SPEC §4's cache
 * table; that table is the truth.
 */

const UPSTREAM =
  'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';

/** ATCF storm id: two letters, six digits (`al012026`). The same shape
 *  `adeck.js` validates, and the only thing that reaches the WHERE clause. */
const STORM_ID_RE = /^[a-z]{2}\d{6}$/;

/** Layer ids are small non-negative integers. §4's block math tops out well
 *  under this (CP block 264 + eight slots + 25 offsets ≈ 497); the bound
 *  exists to reject junk before a request is made, not to predict NOAA's
 *  slot count. An id past the end of the service is ArcGIS's 200-with-error,
 *  which is forwarded like any other. */
const MAX_LAYER_ID = 999;

/** SPEC §4 cache table: per-storm GEOMETRY, so it takes the GDACS geometry
 *  row's numbers — same role, same argument. Geometry already lags the storm
 *  feed by 3¾–6¾ h (§4, confirmed live), so 30 minutes on top is noise. */
const QUERY_FRESH_SECONDS = 30 * 60;
const QUERY_STALE_SECONDS = 12 * 60 * 60;

/** The service's layer LIST. `MAPSERVER.metadataTtl` holds this 24 h in
 *  browser memory, but that cache dies with the tab, so this route's real job
 *  is the first load of every session. Six hours rather than the client's
 *  twenty-four: a NOAA service redeploy propagates within a quarter of a day
 *  instead of a full one, and nothing is gained by an edge copy that outlives
 *  the belief behind it. */
const META_FRESH_SECONDS = 6 * 60 * 60;
const META_STALE_SECONDS = 24 * 60 * 60;

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
  if (url.searchParams.get('meta') === '1') {
    return {
      slot: 'meta',
      target: `${UPSTREAM}?f=json`,
      fresh: META_FRESH_SECONDS,
      stale: META_STALE_SECONDS,
    };
  }

  const rawLayer = url.searchParams.get('layer');
  if (rawLayer == null) return null;
  if (!/^\d{1,3}$/.test(rawLayer)) return null;
  const layer = parseInt(rawLayer, 10);
  if (!(layer >= 0 && layer <= MAX_LAYER_ID)) return null;

  /* Two filter modes and nothing else. `storm` is the normal path; `all=1` is
   * the client's documented unfiltered retry (data/nhc-mapserver.js), which
   * exists because ArcGIS's stock rejection names no field and sniffing the
   * message for one silently killed every layer whose clause was refused. */
  const storm = String(url.searchParams.get('storm') || '').toLowerCase().trim();
  let where;
  let filterSlot;
  if (url.searchParams.get('all') === '1') {
    where = '1=1';
    filterSlot = 'all';
  } else if (STORM_ID_RE.test(storm)) {
    where = `UPPER(stormid)='${storm.toUpperCase()}'`;
    filterSlot = storm;
  } else {
    return null;
  }

  const params = new URLSearchParams({
    where,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  });

  return {
    slot: `${layer}/${filterSlot}`,
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
        detail: 'expected meta=1, or layer=<id> with storm=<al012026> or all=1',
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

    /* ArcGIS's 200-with-error. Forwarded verbatim so the client's unfiltered
     * retry still fires (see the header), and deliberately NOT cached — a
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
    const cacheable =
      plan.slot === 'meta'
        ? Array.isArray(parsed && parsed.layers)
        : parsed && parsed.type === 'FeatureCollection';

    if (!cacheable) {
      return new Response(body, {
        headers: baseHeaders({ 'X-Landfall-Upstream': 'unexpected-shape' }),
      });
    }

    context.waitUntil(
      Promise.all([
        cache.put(
          freshKey,
          new Response(body, {
            headers: { ...headers, 'Cache-Control': `s-maxage=${plan.fresh}` },
          })
        ),
        cache.put(
          lastGoodKey,
          new Response(body, {
            headers: { ...headers, 'Cache-Control': `s-maxage=${plan.stale}` },
          })
        ),
      ])
    );

    return new Response(body, { headers });
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
