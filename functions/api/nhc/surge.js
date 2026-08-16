/**
 * /api/nhc/surge — NHC's Peak Storm Surge inundation forecast, relayed.
 * SPEC-DATA.md §4.8.
 *
 * ===> THIS ROUTE TAKES NO PARAMETERS, AND THAT IS THE WHOLE DESIGN. <===
 * Every earlier plan for it — and the HA integration this project descends
 * from — filtered by an envelope around one storm's position, because the
 * Peak Storm Surge service has no `stormid` field and a spatial box is the
 * only per-storm filter available. `data/surge.js` still carries
 * `fetchSurgeLive(lat, lng)` from that era.
 *
 * A POSITION IN THE QUERY MEANS A POSITION IN THE CACHE KEY, AND THAT IS THE
 * ONE THING THE WARMING SYSTEM CANNOT DO. The cron Worker derives its keys
 * from the storm list; the client derives its request from the storm it has in
 * hand. Both start from `CurrentStorms.json`, so they agree — until a storm
 * moves between the cron's cycle and the reader's tap, or one of them rounds
 * `-160` to `-160.0`, at which point the reader misses every key the writer
 * wrote and the cron warms bytes nobody ever asks for. Both sides stay green
 * while nothing is ever served warm. `worker/src/sources.js` has three long
 * comments about exactly this failure on three other routes; it is the single
 * most repeated bug in the relay layer.
 *
 * So there is nothing to key on. One request, one global key, one payload
 * carrying everything NHC currently publishes, warmed unconditionally beside
 * the storm list. THE ENVELOPE MOVES TO THE CLIENT, where it is arithmetic on
 * bytes already in memory rather than a cache dimension.
 *
 * MEASURED BEFORE IT WAS CHOSEN: Hurricane Milton's published surge, at this
 * exact `maxAllowableOffset`, is ~300 KB per advisory across 460 features
 * (`samples/milton-al142024/surge/`). Milton is the worst case this product
 * has — a major Gulf event with the whole west Florida coast under it. Sending
 * that whole to a phone, once, gzipped, and filtering locally is cheaper than
 * one relay round trip per storm, and it means a second storm costs nothing.
 *
 * ===> WHY IT WAS UNWIRED UNTIL NOW, AND WHY THAT COST SOMETHING. <===
 * `data/surge.js` shipped a renderer, a normalizer and a colour ramp judged on
 * glass against the Milton fixture, with the live fetch deliberately throwing
 * because "there has been no such storm since the layer was built". Tropical
 * Storm Lala published surge over Oahu and Kauai on 2026-08-16 and the app
 * showed nothing, because nothing was watching this service.
 *
 * A session then checked whether the data existed and got it BACKWARDS: the
 * layer's published `extent` on the ArcGIS service page read as the Gulf of
 * Mexico, and that was taken as proof there was nothing near Hawaii. ArcGIS
 * stores that extent on the table DEFINITION and does not recompute it as rows
 * change, so it can describe the previous storm indefinitely. Only the
 * features answer. The archive captures them unfiltered now
 * (`tools/archive-fetch.mjs`) so the question is never re-asked from metadata.
 *
 * ===> BOTH LAYERS, ALWAYS. <=== Layer 2 is the filled inundation bands; layer
 * 1 is the coastal reaches — "Suwannee River, FL to Yankeetown, FL...3-5 ft".
 * On Milton the lines are roughly half the product. A route that fetched only
 * the polygons would drop half the forecast, which is a §5 lie about a
 * coastline, and it would do it invisibly. They are merged into one
 * FeatureCollection here so the client has one thing to hold; `kind` is
 * derived downstream from the geometry type, not from which query it came
 * from.
 *
 * ARCGIS ERRORS ARE FORWARDED, NOT CONVERTED — the same rule `mapserver.js`
 * follows next door. ArcGIS reports failure as HTTP 200 with an `error` body,
 * and the client depends on seeing that body to mark the layer `unavailable`
 * rather than empty. Such a body is never CACHED.
 *
 * AN EMPTY ANSWER IS A REAL ANSWER HERE, unlike genesis. Most of the year NHC
 * forecasts surge nowhere, and `{"features":[]}` is that statement. It is
 * cached on the normal clock. The client turns "answered, nothing within this
 * storm's envelope" into `none_matched` and "did not answer" into
 * `unavailable`, and §5 requires those never to look alike.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED on purpose (§3). The numbers below mirror SPEC §4's cache
 * table and `CACHE.surgeFresh` in config/constants.js; if they change, they
 * change in both places on purpose.
 */

import { kvRead, isWarmRequest } from '../_kv-cache.js';
import { CACHE_PATH, CACHE_PATH_HEADER } from '../_cache-path.js';

const UPSTREAM =
  'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/' +
  'NHC_PeakStormSurge/MapServer';

/** The two layers that carry forecast, and the order they are merged in.
 *
 *  ==> LAYER 0 (`Points`) IS NOT HERE AND ITS ABSENCE IS DELIBERATE. <== It
 *  carries NHC's own label anchors. The same shape was tried on genesis
 *  (layer 2 there) and the real bytes showed fewer points than polygons, with
 *  attributes matching one shape while sitting inside another — unmatchable,
 *  and a wrong match prints one reach's depth on another reach's coast. The
 *  place name already rides on each feature's own `name`. */
const LAYERS = [
  { id: 2, what: 'polygons' }, // filled inundation bands
  { id: 1, what: 'lines' }, //    coastal reaches
];

/** Server-side generalization, asked of ArcGIS as `maxAllowableOffset` so the
 *  bytes are never sent at all. MIRRORS `SURGE.offsetDeg` in
 *  config/constants.js, which carries the measurement that chose it — 0.005
 *  was shipped once and rejected on glass, because on a narrow winding channel
 *  it is the SHAPE that shows, not the area. It also matches what
 *  `.github/scripts/milton-surge-shape.mjs` built the fixture at, so the
 *  fixture is never prettier than production. tools/test-relay-mirrors.mjs
 *  asserts the two numbers agree. */
const OFFSET_DEG = 0.001;

/** The KV path the cron warms this route under. Fixed — there is no parameter
 *  to vary it. tools/test-kv-keys.mjs asserts the writer and this file agree. */
const KV_PATH = 'nhc/surge';

/** Mirrors `CACHE.surgeFresh`. The product republishes with each advisory —
 *  every 6 hours, every 3 when a storm is near shore — so 15 minutes is
 *  comfortably inside one publication cycle and comfortably under the client
 *  poll, meaning a poll is never handed the copy it fetched last time. */
const FRESH_SECONDS = 15 * 60;

/** Serve-stale on upstream failure. 1.5x the slowest publication cycle, the
 *  same rule every other route here uses. A nine-hour-old surge forecast with
 *  its age stated beats a blank coastline (§5). */
const STALE_SECONDS = 9 * 60 * 60;

/** NOAA servers 403 requests with no User-Agent. Identify ourselves plainly. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

const jsonHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});

const errorJson = (obj, status) =>
  new Response(JSON.stringify(obj), { status, headers: jsonHeaders() });

/** How many surge features are in the body being served, stated on the wire.
 *
 *  ==> IT EXISTS SO THE CRON WORKER NEVER HAS TO PARSE THE PAYLOAD. <== That
 *  Worker's whole identity is "fetch a URL and store the bytes"; the moment it
 *  opens a FeatureCollection to judge the answer there are two implementations
 *  of that judgement on opposite sides of a deploy boundary. The route already
 *  knows the number, so it says it, and a session reading the archive's
 *  headers can see at a glance whether a quiet coastline was quiet upstream. */
const FEATURE_COUNT_HEADER = 'X-Landfall-Surge-Features';

/** One layer, as GeoJSON features.
 *
 *  ==> AN ARCGIS `error` BODY IS THROWN, NOT RETURNED. <== It arrives with
 *  HTTP 200, so an unchecked caller merges zero features and publishes a
 *  silent all-clear for that half of the product. Throwing sends the whole
 *  request down the stale path, which is the honest answer: we did not get one.
 */
async function fetchLayer(id) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: String(OFFSET_DEG),
    f: 'geojson',
  });
  const r = await fetch(`${UPSTREAM}/${id}/query?${params}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`layer ${id}: upstream HTTP ${r.status}`);

  const text = await r.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`layer ${id}: upstream did not return JSON`);
  }
  if (parsed && parsed.error) {
    const detail = (parsed.error && parsed.error.message) || 'arcgis error';
    throw new Error(`layer ${id}: ${detail}`);
  }
  if (!parsed || !Array.isArray(parsed.features)) {
    throw new Error(`layer ${id}: not a FeatureCollection`);
  }
  return parsed.features;
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const freshKey = new Request('https://landfall-relay.internal/nhc/surge/fresh');
  const lastGoodKey = new Request('https://landfall-relay.internal/nhc/surge/last-good');

  const warming = isWarmRequest(context.request, context.env);

  /* THE HIT IS REBUILT, NEVER HANDED BACK AS STORED. The slot copies below
   * carry `Cache-Control: s-maxage=...` because that is how `caches.default`
   * is told how long to keep them; returning one verbatim published that
   * instruction to the public internet and Cloudflare's own edge honoured it.
   * Measured live on the storm list, 2026-08-07. SPEC-OPS.md §17.7. */
  const hit = warming ? null : await cache.match(freshKey);
  if (hit) {
    return new Response(await hit.text(), {
      headers: jsonHeaders({
        'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
        [FEATURE_COUNT_HEADER]: hit.headers.get(FEATURE_COUNT_HEADER) || '',
        [CACHE_PATH_HEADER]: CACHE_PATH.FRESH,
      }),
    });
  }

  const kvPath = KV_PATH;
  const warm = warming ? null : await kvRead(context.env, kvPath, FRESH_SECONDS);
  if (warm && warm.fresh) {
    const headers = jsonHeaders({
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

  let upstreamError;
  try {
    /* BOTH LAYERS OR NEITHER. `Promise.all` rejects on the first failure, and
     * that is the behaviour wanted: half the surge product is not a partial
     * success, it is a coastline told a wrong story with no marker on it. */
    const perLayer = await Promise.all(LAYERS.map((l) => fetchLayer(l.id)));
    const features = perLayer.flat();

    const body = JSON.stringify({ type: 'FeatureCollection', features });
    const fetchedAt = new Date().toISOString();
    const headers = jsonHeaders({
      'X-Landfall-Fetched-At': fetchedAt,
      [FEATURE_COUNT_HEADER]: String(features.length),
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
    return new Response(await stale.text(), {
      headers: jsonHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        [FEATURE_COUNT_HEADER]: stale.headers.get(FEATURE_COUNT_HEADER) || '',
        'X-Landfall-Stale': 'true',
        [CACHE_PATH_HEADER]: CACHE_PATH.LAST_GOOD,
      }),
    });
  }

  /* Then the warm copy declined above as too old. The client stamps what it
   * draws with the age it was given, so a stale forecast reads AS stale rather
   * than being withheld (§5). */
  if (warm) {
    return new Response(warm.body, {
      headers: jsonHeaders({
        'X-Landfall-Fetched-At': warm.fetchedAt || '',
        'X-Landfall-Stale': 'true',
        [CACHE_PATH_HEADER]: CACHE_PATH.KV_STALE,
      }),
    });
  }

  return errorJson(
    { error: 'surge_unreachable', detail: String((upstreamError && upstreamError.message) || upstreamError) },
    502
  );
}
