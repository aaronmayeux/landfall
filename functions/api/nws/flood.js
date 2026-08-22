/**
 * /api/nws/flood — every NWS flood alert in force, with the shapes. §48.21.
 *
 * ==> THIS IS THE FIRST ROUTE IN §48 THAT KEEPS A POLYGON, AND THAT REVERSES
 * A DECISION §48.7 MADE ON PURPOSE. <== The point route strips `description`,
 * `instruction` and the geometry because that is the entire 55 KB and none of
 * it reached a sentence. Here the geometry IS the feature: this is the only
 * thing in §48 that can be drawn, so the bytes that route exists to drop are
 * the bytes this one exists to carry. The text still goes.
 *
 * ==> AND IT IS NOT THE SAME QUESTION THE POINT ROUTE ASKS. <==
 * `/api/nws/rainfall` asks "what is in force at this house". This asks "what
 * is in force anywhere", because a map layer is not about anybody's house.
 * One national answer, one cache key, shared by every reader — the alternative
 * is a query per storm returning overlapping subsets of one list.
 *
 * ==> WARNINGS CARRY POLYGONS AND WATCHES DO NOT. <== Measured on the captured
 * Hilo set (`samples/rain/alerts-hilo-hi.json`), which is real NWS bytes:
 *
 *   Flash Flood Warning   Polygon, 346 bytes,  1 zone
 *   Hurricane Warning     Polygon, 1142 bytes, 1 zone
 *   Flood Watch           geometry: null,     17 zones
 *   High Surf Warning     geometry: null,      7 zones
 *
 * A warning is issued for a drawn box; a watch is issued for a list of forecast
 * zones and its shape lives behind seventeen more requests. So both are fetched
 * and both reach the drawer's list, and only the ones that can be drawn are
 * offered to the globe. That split is stated in the payload rather than left
 * for the client to infer from a null.
 *
 * ==> TWO UPSTREAM CALLS, NOT ONE UNFILTERED ONE. <== `/alerts/active` with no
 * filter returns every hazard in the United States — fire weather, marine, heat
 * — and the flood family is a small fraction of it. Asking for the two events
 * by name means the upstream does the filtering and the bytes never cross the
 * wire. **The event names are NWS's own product names and are matched exactly**;
 * `RAIN.alertEventMatch` on the client is a substring test over what comes back,
 * which is the belt to this braces.
 *
 * ==> THE VOLUME HAS NEVER BEEN MEASURED AND THE ARCHIVE NOW MEASURES IT. <==
 * The per-feature shape was known before this file existed. The row COUNT on an
 * active day was not, and nothing in a sandbox can reach api.weather.gov. Both
 * queries are archived hourly (`tools/archive-fetch.mjs`) so the first tuning
 * pass reads bytes instead of guessing.
 *
 * Pages Functions run in their own workerd runtime with no access to this
 * project's config (§4.13), so the numbers below mirror `RAIN` by hand and say
 * so, exactly as the sibling routes do.
 */

import { CACHE_PATH, CACHE_PATH_HEADER } from '../_cache-path.js';

const ALERTS = 'https://api.weather.gov/alerts/active';

/** ==> NWS ANSWERS 403 WITHOUT A CONTACT IN THE USER-AGENT. <== The same
 *  string §48.13's probe measured working, and the same one
 *  `functions/api/nws/rainfall.js` sends. Two copies because a Pages Function
 *  cannot import from another (§4.13); `tools/relay-mirrors.mjs` is what keeps
 *  them honest. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app, andy@getgravitate.app)';

/** The two products, by NWS's own exact names.
 *
 *  ==> DELIBERATELY NOT A SUBSTRING SEARCH ON \"Flood\". <== That would also
 *  pull Coastal Flood Advisory, Lakeshore Flood Warning and Hydrologic Outlook,
 *  which are real products about different water. Coastal flooding already has
 *  its own section (§51) and its own source, and a Hydrologic Outlook is not a
 *  thing in force. Adding an event here is a decision; discovering one through
 *  a wildcard is an accident. */
const EVENTS = Object.freeze([
  'Flash Flood Warning',
  'Flood Warning',
  'Flood Watch',
]);

/** Which of them can be drawn. Everything else rides the list only.
 *
 *  ==> THIS IS A STATEMENT ABOUT NWS'S PRODUCTS, NOT ABOUT OUR PARSER. <== A
 *  warning is issued for a polygon the forecaster drew. A watch is issued for a
 *  list of zones, and its shape is seventeen more requests away. If a watch
 *  ever arrives carrying real geometry, the payload will say so on that row and
 *  this list stops being the authority — see `drawable` below, which reads the
 *  feature rather than this table. */
const USUALLY_DRAWN = Object.freeze(['Flash Flood Warning', 'Flood Warning']);

/* --------------------------------------------------------------------------
 * CACHE
 *
 * ==> FIFTEEN MINUTES, AND IT IS THE SAME FIFTEEN §48.7 SETS FOR THE SAME
 * REASON. <== A flash flood warning is routinely shorter-lived than one poll:
 * the captured Hilo warning expired 52 minutes after it was issued. A longer
 * hold would let this route claim an expired warning is still in force, which
 * on a hazard layer is the §5 failure with a shape drawn over it. Expiry is
 * filtered AGAIN at render on the client, which is the belt to these braces.
 *
 * ==> AND THERE IS NO LAST-GOOD. <== Every other route in this app holds its
 * previous answer, because a stale forecast beats a blank section. This one
 * must not: an expired flood warning is not a stale reading of a live fact, it
 * is a shape on a map saying somebody is in danger who is not. Same reasoning
 * §50.5 gives for the CAP list, which also refuses to hold.
 * ----------------------------------------------------------------------- */
const FRESH_SECONDS = 15 * 60;

const UPSTREAM_TIMEOUT_MS = 10_000;

const jsonHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  ...extra,
});

const json = (obj, status, extra) =>
  new Response(JSON.stringify(obj), { status, headers: jsonHeaders(extra) });

/**
 * Does this feature carry a shape we can draw?
 *
 * ==> IT READS THE FEATURE, NEVER THE EVENT NAME. <== `USUALLY_DRAWN` records
 * what has been measured; this decides. A Flood Watch that one day arrives with
 * a real polygon gets drawn without anybody editing a table, and a Flash Flood
 * Warning that arrives without one is honestly reported as undrawable rather
 * than silently vanishing off the globe with the layer switched on.
 */
const drawable = (f) => {
  const t = f?.geometry?.type;
  return t === 'Polygon' || t === 'MultiPolygon';
};

/**
 * The upstream feature collection → the body this route serves.
 *
 * ==> SEPARATED FROM THE FETCHING SO IT CAN BE TESTED AGAINST REAL BYTES. <==
 * `tools/test-flood.mjs` runs it over `samples/rain/alerts-hilo-hi.json`, which
 * is a genuine NWS response carrying both shapes — a warning with a polygon and
 * a watch without one. A Pages Function is not reachable from a sandbox and
 * neither is its upstream, so this function is the only part of this file any
 * test can stand on.
 *
 * Pure: no fetch, no cache, no clock.
 */
export function projectFlood(collections) {
  const rows = [];
  let drawn = 0;

  for (const body of collections || []) {
    for (const f of body?.features || []) {
      const p = f?.properties || {};
      const canDraw = drawable(f);
      if (canDraw) drawn++;

      rows.push({
        /* The alert's own id, so a client can key on it. Two of these queries
         * can return the same row when NWS reclassifies a product mid-flight,
         * and a list that shows it twice looks like two floods. */
        id: p.id || null,
        event: p.event || null,
        /* WHERE IT APPLIES, WHOLE AND UNSHORTENED (§48.20). The reader is
         * hunting for their own zone in this list. */
        areaDesc: p.areaDesc || null,
        severity: p.severity || null,
        urgency: p.urgency || null,
        onset: p.onset || null,
        expires: p.expires || null,
        ends: p.ends || null,
        /* ==> THE ONLY FIELD IN §48 THAT IS A SHAPE. <== Null is a real answer
         * here and it means "issued for zones rather than for a box", which is
         * every Flood Watch ever captured. The client renders those in the list
         * and keeps them off the globe. */
        geometry: canDraw ? f.geometry : null,
        /* Stated rather than left to be inferred from the null above, because
         * "we could not draw it" and "there was nothing to draw" are different
         * facts and only one of them is about the source. */
        drawable: canDraw,
      });
    }
  }

  return {
    status: 'ok',
    /* THE TWO COUNTS THE DRAWER'S SENTENCE NEEDS, computed here where the whole
     * list is in hand. A count of alerts is not a count of shapes, and a layer
     * that draws eleven of nineteen must be able to say so (§5). */
    total: rows.length,
    drawable: drawn,
    alerts: rows,
  };
}

async function pull(event) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const r = await fetch(`${ALERTS}?event=${encodeURIComponent(event)}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`alerts HTTP ${r.status} for ${event}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const key = new Request('https://landfall-relay.internal/nws/flood');

  const hit = await cache.match(key);
  if (hit) {
    return json(await hit.json(), 200, {
      'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
      [CACHE_PATH_HEADER]: CACHE_PATH.FRESH,
    });
  }

  try {
    const fetchedAt = new Date().toISOString();
    /* ==> ONE FAILING EVENT FAILS THE WHOLE REQUEST, AND THAT IS DELIBERATE.
     * <== `Promise.all` rather than `allSettled`. A partial answer here is a
     * map missing warnings it does not know are missing — an all-clear over a
     * flooding county, assembled out of a 500. The client has an `unavailable`
     * state and a Retry; this route's job is to make sure it reaches them. */
    const bodies = await Promise.all(EVENTS.map(pull));
    const body = { ...projectFlood(bodies), fetchedAt };
    const text = JSON.stringify(body);

    const headers = {
      'X-Landfall-Fetched-At': fetchedAt,
      [CACHE_PATH_HEADER]: CACHE_PATH.UPSTREAM,
    };

    context.waitUntil(cache.put(key, new Response(text, {
      headers: { ...jsonHeaders(headers), 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
    })));

    return json(body, 200, headers);
  } catch (e) {
    /* NO LAST-GOOD TO FALL BACK ON, ON PURPOSE — see the cache note above.
     * Codes, never prose: the client is the layer with the context to write a
     * sentence (§4.3). */
    return json(
      { error: 'flood_unreachable', detail: String(e?.message || e) },
      502
    );
  }
}
