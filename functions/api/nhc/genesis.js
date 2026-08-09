/**
 * /api/nhc/genesis?part=areas — NHC's two- and seven-day outlook, relayed.
 * SPEC §45.
 *
 * THE QUESTION THIS ANSWERS IS THE ONE THE APP GETS ASKED MOST AND COULD NOT
 * ANSWER: where might the next one start, and when. Genesis is not forecastable
 * months out — seasonal outlooks say how many, never where. Inside seven days
 * it is, and NHC publishes it as a polygon with a percentage on it.
 *
 * SAME SERVICE THE CONE COMES FROM, DIFFERENT SERVICE OBJECT. `mapserver.js`
 * next door talks to `NHC_tropical_weather_summary` and filters by `binnumber`
 * — a genesis area has no bin, because it is not a storm and has no advisory.
 * So this is its own route rather than another mode on that one: bolting a
 * bin-less branch onto a route whose entire contract is "one filter mode, and
 * `all=1` must not come back" is how that route's open-query problem gets
 * reopened by accident.
 *
 * ONE PART TODAY: `part=areas`, layer 3, the polygons — each carrying BOTH
 * horizons, so the two-day and seven-day answers come from a single query.
 * The parameter exists rather than being hardcoded because layer 2 was meant
 * to be the second part and may yet be; see the note on `PARTS`.
 *
 * WHAT MAKES THIS DIFFERENT FROM EVERY OTHER RELAY HERE: AN EMPTY ANSWER IS
 * THE COMMON CASE AND IS FULLY MEANINGFUL. Most of the year NHC is watching
 * nothing, and `{"features":[]}` is that statement. It is cached on the normal
 * clock, not the short one — there is no publication gap to wait out, because
 * the outlook is a standing product that is always current. Compare
 * `mapserver.js`, where empty means "the geometry has not published yet" and
 * is held for five minutes precisely because it is expected to change.
 *
 * The CLIENT is what must not conflate the two: `none_matched` (answered, no
 * areas) and `unavailable` (did not answer) are different states in §45.5 and
 * `lib/genesis.js` keeps them apart.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED on purpose (§3). The numbers below mirror SPEC §4's cache
 * table and `CACHE.genesisFresh` in config/constants.js; if they change, they
 * change in both places on purpose.
 */

const UPSTREAM =
  'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';

/** The parts this route will fetch, and the layer each maps to. A closed
 *  table, so no caller text ever reaches a layer id or a cache key — the same
 *  rule `mapserver.js` applies to its bin.
 *
 *  ==> LAYER 2 IS NOT IN THIS TABLE, AND ITS ABSENCE IS DELIBERATE. <== It was
 *  going to be `anchors`, carrying NHC's own label points. Real bytes
 *  (2026-08-09) showed three points against five polygons, with attributes
 *  that match one polygon while sitting inside another — unmatchable, and a
 *  wrong match would print one area's probability on another area's shape.
 *  The label is drawn at our own centroid instead. Full measurement in
 *  `GENESIS.anchorLayer`'s note in config/constants.js. The archive still
 *  snapshots layer 2 as evidence; if NHC ever publishes one point per area,
 *  this is where the mode comes back, with fresh bytes behind it. */
const PARTS = {
  areas: 3, // Seven-Day: Potential Development Region (polygon)
};

/** Mirrors `CACHE.genesisFresh`. Comfortably under the 30-minute client poll,
 *  so a poll is never handed the copy it fetched last time. */
const FRESH_SECONDS = 15 * 60;

/** Serve-stale on upstream failure. The outlook republishes roughly 6-hourly,
 *  so 1.5x that is the same rule used everywhere else — and a six-hour-old
 *  watch area in the right ocean beats a blank layer under an all-clear (§5). */
const STALE_SECONDS = 9 * 60 * 60;

/** NOAA servers 403 requests with no User-Agent. Identify ourselves plainly. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/* `no-store` is aimed at the BROWSER, not at Cloudflare — the colo copies are
 * written by `cache.put()` below with their own `s-maxage`. This route's URL
 * names no advisory and no bin, so it is byte-identical forever; without an
 * explicit instruction a browser invents a lifetime and answers from disk.
 * That failure is silent and looks like fresh data. See mapserver.js. */
const baseHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  ...extra,
});

const errorJson = (obj, status) =>
  new Response(JSON.stringify(obj), { status, headers: baseHeaders() });

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const part = String(url.searchParams.get('part') || 'areas').toLowerCase();

  if (!Object.prototype.hasOwnProperty.call(PARTS, part)) {
    /* A 400, not a 502: a bad request, not a dead source. data/relay.js only
     * retries 5xx (§4), so this correctly never retries. */
    return errorJson(
      { error: 'bad_genesis_part', detail: 'part must be areas' },
      400
    );
  }

  const layer = PARTS[part];

  /* `where=1=1` IS SAFE HERE AND IS NOT THE THING mapserver.js FORBIDS. That
   * route refuses an unfiltered query because its upstream holds every active
   * storm and one storm's panel would get three storms' cones. This layer
   * holds nothing but genesis areas, there is no per-feature owner to filter
   * by, and "all of them" is precisely the question. The clause is built here
   * and never accepted from a caller either way. */
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  });

  const cache = caches.default;
  const freshKey = new Request(`https://landfall-relay.internal/nhc/genesis/${part}/fresh`);
  const lastGoodKey = new Request(`https://landfall-relay.internal/nhc/genesis/${part}/last-good`);

  /* Rebuilt, never handed back as stored — a stored copy carries `s-maxage`,
   * which Cloudflare's own edge then honours and serves without this function
   * running at all. Measured live 2026-08-07, SPEC-OPS §17.7. */
  const hit = await cache.match(freshKey);
  if (hit) {
    return new Response(await hit.text(), {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Genesis-Part': part,
      }),
    });
  }

  let upstreamError;
  try {
    const r = await fetch(`${UPSTREAM}/${layer}/query?${params}`, {
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

    const headers = baseHeaders({
      'X-Landfall-Fetched-At': new Date().toISOString(),
      'X-Landfall-Genesis-Part': part,
    });

    /* ArcGIS reports failure as HTTP 200 with an `error` body. Forwarded
     * verbatim so the client can mark this `unavailable` rather than empty —
     * which for THIS layer is the difference between "we could not ask" and
     * "nothing is being watched", the exact confusion §45.5 exists to stop.
     * Never cached: a cached rejection is hours of a false all-clear. */
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

    /* AN EMPTY OUTLOOK IS CACHED LIKE ANY OTHER ANSWER. See the header note:
     * "nothing is being watched" is the normal state for most of the year and
     * is a real, current statement, not a publication gap. It IS still refused
     * as last-good, for the one reason that never changes — serving a
     * remembered nothing while upstream is down would put an all-clear on
     * screen that nobody currently stands behind. */
    const empty = !(Array.isArray(parsed.features) && parsed.features.length);

    const writes = [
      cache.put(
        freshKey,
        new Response(body, {
          headers: { ...headers, 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
        })
      ),
    ];
    if (!empty) {
      writes.push(
        cache.put(
          lastGoodKey,
          new Response(body, {
            headers: { ...headers, 'Cache-Control': `s-maxage=${STALE_SECONDS}` },
          })
        )
      );
    }
    context.waitUntil(Promise.all(writes));

    return new Response(body, { headers });
  } catch (e) {
    upstreamError = e;
  }

  const stale = await cache.match(lastGoodKey);
  if (stale) {
    return new Response(await stale.text(), {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Genesis-Part': part,
        'X-Landfall-Stale': 'true',
      }),
    });
  }

  return errorJson(
    {
      error: 'genesis_unreachable',
      detail: String((upstreamError && upstreamError.message) || upstreamError),
    },
    502
  );
}
