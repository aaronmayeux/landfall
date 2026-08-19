/**
 * /api/cap/shapes?ids=1234,1235 — the warning AREAS for alerts already on
 * screen. SPEC §50.10.
 *
 * WHY THIS IS A SECOND ROUTE AND NOT A FLAG ON THE FIRST. `alerts.js` is the
 * text feed: small, shared by every reader and every storm, cached as one
 * body. Geometry is none of those things — it is large, it is wanted only for
 * the handful of alerts a reader has actually surfaced, and it is the half
 * that can go wrong on size. Bolting `returnGeometry=true` onto the shared
 * list would make every reader pay for shapes nobody painted.
 *
 * ==> THE MEASUREMENT THAT FORCED THE SIMPLIFICATION. <== Archive branch,
 * 2026-08-19: the same query WITH shapes was 281,336 bytes for THREE features,
 * because a CAP area is whatever the issuing country drew and Costa Rica drew
 * its own coastline at 6,585 points. Unsimplified geometry is not shippable to
 * a phone, and that measurement is why this route exists rather than a flag.
 *
 * ==> WHAT `maxAllowableOffset` COSTS US, AND WHY IT COSTS NOTHING HERE. <==
 * The service generalises the outline to the given tolerance, so a national
 * boundary drawn at survey precision comes back as a coarse outline. That
 * would matter if we painted the polygon. WE DO NOT — the polygon is only ever
 * used to ask the basemap coastline which of ITS vertices fall inside, and the
 * painted line is the coastline's own geometry at the coastline's own detail.
 * The area is a question, not an answer, so a question asked to the nearest
 * few kilometres selects the same coast.
 *
 * ==> AND THAT IS ALSO WHY THE TOLERANCE IS SMALLER THAN THE PAD. <== §50.11's
 * dilation deliberately reaches BEYOND the published area to catch coastline
 * the agency's outline undershoots. A simplification tolerance larger than
 * that pad would make the two fight — the generaliser cutting corners the pad
 * is trying to restore — so it is set well inside it.
 *
 * A COLD MISS COSTS ONE UPSTREAM FETCH. Cached per id-set, because a reader
 * opening the same storm twice wants the same shapes, and two readers watching
 * one storm want the identical set.
 *
 * Cloudflare Pages Functions run in their own workerd runtime with no access
 * to this project's config (§3), so the numbers below mirror `CAP` in
 * config/constants.js by hand and say so.
 */

import { CACHE_PATH, CACHE_PATH_HEADER } from '../_cache-path.js';

const SERVICE =
  'https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services' +
  '/CAP_Alerts_Feed/FeatureServer/0/query';

/** Mirrors `CAP.shapeToleranceDeg`. Degrees, the units this service's
 *  `maxAllowableOffset` takes when `outSR` is 4326. ~1.1 km at the equator —
 *  a fifth of §50.11's dilation pad, so simplification can never eat the
 *  reach the pad is there to provide. */
const TOLERANCE_DEG = 0.01;

/** ==> A CEILING ON HOW MANY SHAPES ONE REQUEST CAN ASK FOR. <== The ids come
 *  off a list the client already holds, so this is not a guess about demand —
 *  the whole global cyclone feed measured between one and five rows across a
 *  full day. Twenty is far above anything observed and still bounds what a
 *  crafted URL can make this route fetch. */
const MAX_IDS = 20;

/** Mirrors `CACHE.capFresh`. An alert's AREA does not change while the alert
 *  is in force — an agency redrawing it republishes with a new row — so this
 *  could be far longer than the text feed's window. It is not, deliberately:
 *  a shape held longer than the alert that justifies it is a shape that can
 *  outlive its own warning, and matching the text route means the two can
 *  never disagree about what is in force. */
const FRESH_SECONDS = 10 * 60;

/** Serve-stale. Shorter than the text route's two hours, because a stale
 *  SHAPE has no visible timestamp on it — a reader can see an old alert is
 *  old from its own expiry, but a coastline stripe carries no such mark. */
const STALE_SECONDS = 30 * 60;

const UPSTREAM_TIMEOUT_MS = 10_000;

const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

const jsonHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  ...extra,
});

const json = (obj, status, extra) =>
  new Response(JSON.stringify(obj), { status, headers: jsonHeaders(extra) });

/**
 * `?ids=12,7,12` -> `[7, 12]`.
 *
 * SORTED AND DEDUPED SO THE CACHE KEY IS THE SET, not the order somebody
 * happened to type it in. Two readers asking for the same three alerts in
 * different orders should share one cached body rather than fill the colo
 * with permutations of one answer.
 *
 * Integers only, and the parse is strict: these are pasted straight into a
 * `WHERE ... IN (...)` clause upstream, and a value that is not a bare number
 * has no business reaching it.
 */
export function parseIds(raw) {
  const seen = new Set();
  for (const part of String(raw || '').split(',')) {
    const t = part.trim();
    if (!/^\d+$/.test(t)) continue;
    seen.add(Number(t));
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * The service's answer -> the body this route serves.
 *
 * ==> A PROJECTION, AND THE ONLY ATTRIBUTE IT KEEPS IS THE JOIN KEY. <== §4.3.
 * Everything a reader sees about an alert already arrived on the text route
 * and is already in hand on the client; repeating it here would mean two
 * copies of one alert's severity travelling separately, free to disagree after
 * a poll lands between them. The client joins on the id and reads the rest
 * from the alert it already has.
 *
 * Separated from the fetching so `tools/test-cap.mjs` can run it over captured
 * bytes with no network — a Pages Function is not reachable from the sandbox
 * and neither is its upstream.
 */
export function projectShapes(body) {
  const features = [];
  for (const f of body?.features || []) {
    const id = f?.attributes?.OBJECTID;
    const g = f?.geometry;
    if (typeof id !== 'number' || !g) continue;

    /* ==> ESRI RINGS ARE NOT GeoJSON POLYGONS AND THE DIFFERENCE IS SILENT.
     * <== `f=json` returns `{rings: [...]}` with outer rings clockwise and
     * holes counter-clockwise, all in one flat list — no nesting to say which
     * hole belongs to which outer ring. GeoJSON nests them and winds the other
     * way. Nothing throws if the two are confused; the shape just comes out
     * wrong, which for a warning area means selecting the wrong coast.
     *
     * We ask for `f=json` rather than `f=geojson` ANYWAY, because the point-in
     * -area test downstream (§50.11) treats every ring as a boundary and cares
     * about neither nesting nor winding — an even-odd crossing count gives
     * holes for free. So the flat list IS the useful form here, and converting
     * it to GeoJSON would be work done only to be undone.
     */
    const rings = Array.isArray(g.rings) ? g.rings : null;
    if (!rings || !rings.length) continue;

    features.push({ id, rings });
  }
  return { status: 'ok', features };
}

async function pull(ids) {
  const where = `OBJECTID IN (${ids.join(',')})`;
  const url =
    `${SERVICE}?where=${encodeURIComponent(where)}` +
    '&outFields=' + encodeURIComponent('OBJECTID') +
    '&returnGeometry=true' +
    '&outSR=4326' +
    `&maxAllowableOffset=${TOLERANCE_DEG}` +
    /* ==> GEOMETRY PRECISION IS A REAL SAVING, NOT TIDINESS. <== The service
     * ships coordinates at full double precision by default — 17 characters
     * per number where 8 carry every metre that matters. Four decimals is
     * ~11 m, an order of magnitude finer than the tolerance above, so this
     * cannot move a vertex the simplification did not already move. */
    '&geometryPrecision=4' +
    '&f=json';

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
    const text = await r.text();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('upstream body was not JSON');
    }
    /* ==> ARCGIS REPORTS FAILURE AS HTTP 200 WITH AN `error` BODY. <== The
     * genesis route learned this the expensive way. Read as a feature list a
     * refused query becomes an empty one, and an empty one here paints no
     * coast at all — a warning silently missing from the map, which is the §5
     * failure with the worst consequence in the app. */
    if (parsed && parsed.error) {
      throw new Error(`upstream refused: ${parsed.error?.message || 'no message'}`);
    }
    if (!parsed || !Array.isArray(parsed.features)) {
      throw new Error('upstream body was not a feature list');
    }
    return projectShapes(parsed);
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const ids = parseIds(url.searchParams.get('ids'));

  if (!ids.length) {
    return json({ error: 'no_ids', detail: 'ids must be one or more row numbers' }, 400);
  }
  if (ids.length > MAX_IDS) {
    return json(
      { error: 'too_many_ids', detail: `at most ${MAX_IDS} shapes per request` },
      400
    );
  }

  const cache = caches.default;
  const key = `https://landfall-relay.internal/cap/shapes/${ids.join(',')}`;
  const freshKey = new Request(`${key}/fresh`);
  const lastGoodKey = new Request(`${key}/last-good`);

  /* THE HIT IS REBUILT, NEVER HANDED BACK AS STORED — the stored copy carries
   * an `s-maxage` that is how `caches.default` is told how long to keep it,
   * and returning it verbatim publishes that instruction to the public
   * internet where Cloudflare's own edge honours it (§17.7). */
  const hit = await cache.match(freshKey);
  if (hit) {
    return json(await hit.json(), 200, {
      'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
      [CACHE_PATH_HEADER]: CACHE_PATH.FRESH,
    });
  }

  let upstreamError;
  try {
    const body = await pull(ids);
    const fetchedAt = new Date().toISOString();
    const text = JSON.stringify(body);
    const headers = {
      'X-Landfall-Fetched-At': fetchedAt,
      [CACHE_PATH_HEADER]: CACHE_PATH.UPSTREAM,
    };

    context.waitUntil(Promise.all([
      cache.put(freshKey, new Response(text, {
        headers: { ...jsonHeaders(headers), 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
      })),
      cache.put(lastGoodKey, new Response(text, {
        headers: { ...jsonHeaders(headers), 'Cache-Control': `s-maxage=${STALE_SECONDS}` },
      })),
    ]));

    return json(body, 200, headers);
  } catch (e) {
    upstreamError = e;
  }

  const stale = await cache.match(lastGoodKey);
  if (stale) {
    return json(await stale.json(), 200, {
      'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
      'X-Landfall-Stale': 'true',
      [CACHE_PATH_HEADER]: CACHE_PATH.LAST_GOOD,
    });
  }

  /* Codes, never prose — the client is the layer with the context to write a
   * sentence (§4.3), and here the sentence has to say the coast is unpainted
   * rather than unwarned. */
  return json(
    { error: 'cap_shapes_unreachable', detail: String(upstreamError?.message || upstreamError) },
    502
  );
}
