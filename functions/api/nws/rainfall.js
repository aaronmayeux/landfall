/**
 * /api/nws/rainfall?lat=19.72&lon=-155.09 — how much rain is coming to a
 * point. §48.3, §48.5, §48.6, §48.7.
 *
 * ==> 99% OF THE UPSTREAM PAYLOAD IS WASTE AND THIS ROUTE MUST NOT SHIP IT.
 * <== Hilo's grid is 130,885 bytes on the wire and its
 * `quantitativePrecipitation` is 1,223 of them — under one percent. The other
 * 67 keys are humidity, apparent temperature, heat index, dewpoint, wind and
 * so on, none of which this app has any use for; `relativeHumidity` alone is
 * 8,679 bytes, seven times the field we came for. The alerts response is
 * worse in absolute terms: 55,236 bytes at Hilo, nearly all of it the alerts'
 * full text and their polygons.
 *
 * ==> AND THE UPSTREAM IS TWO HOPS. <== `/points/{lat},{lon}` does not carry
 * the forecast; it carries the URL OF the forecast. A browser doing this
 * itself pays two round trips before it has a number, plus a third for alerts.
 *
 * ==> THIS IS A PROJECTION, NOT LOGIC (§4.3). <== It picks fields and it drops
 * fields. No summing, no unit conversion, no rounding, no deciding which
 * alerts matter — all of which stay in `lib/rainfall.js` where they are
 * testable against captured bytes with no browser. The one thing that looks
 * like a decision, mapping a 404 and a 400 to the same `not_covered`, is
 * transport: two upstream routes spelling one fact two ways (§48.5).
 *
 * Pages Functions run in their own workerd runtime with no access to this
 * project's config (§4.13), so the numbers below mirror `RAIN` and §4.13's
 * table by hand and say so, exactly as the SHIPS and GDACS routes do.
 */

import { CACHE_PATH, CACHE_PATH_HEADER } from '../_cache-path.js';

const POINTS = 'https://api.weather.gov/points';
const ALERTS = 'https://api.weather.gov/alerts/active';

/** ==> NWS ANSWERS 403 WITHOUT A CONTACT IN THE USER-AGENT. <== Their API
 *  terms ask for one and their edge enforces it. This is the exact string the
 *  §48.13 probe measured working against all eight points. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app, andy@getgravitate.app)';

/** Mirrors `RAIN.wireDecimals`. Enforced HERE as well as on the client,
 *  because a caller can hit this route directly and there is no reason for
 *  this service to ever hold a coordinate finer than the grid it is asking
 *  about. ~1.1 km, inside a ~2.5 km NWS cell. */
const WIRE_DECIMALS = 2;

/* --------------------------------------------------------------------------
 * CACHE, mirroring §4.13 by hand.
 *
 * ==> THE FRESH WINDOW IS SET BY THE ALERTS, NOT BY THE GRID. <== The grid
 * itself updates a few times a day — Honolulu's `updateTime` read 21:11Z
 * against Houston's 00:20Z — so on the rainfall numbers alone this could be
 * cached for hours. It cannot be, because the same payload carries what is in
 * force, and a flash flood warning is routinely shorter-lived than one poll:
 * Hilo's expired 52 minutes after it was issued. Fifteen minutes is the
 * longest window where a held answer cannot silently outlive a warning by
 * much, and expiry is filtered AGAIN at render time on the client, which is
 * the belt to this braces.
 *
 * LAST-GOOD 6 H. A rainfall forecast six hours old is still a rainfall
 * forecast and beats a blank section (§5); its own `updateTime` travels in the
 * payload so it can be read AS old.
 *
 * NOT COVERED 24 H. Being outside NWS's forecast area is a durable fact about
 * a place, not a failure, and re-asking every fifteen minutes to be told the
 * same thing is pure spend. Not permanent either — coverage boundaries do move.
 * ----------------------------------------------------------------------- */
const FRESH_SECONDS = 15 * 60;
const STALE_SECONDS = 6 * 60 * 60;
const NOT_COVERED_SECONDS = 24 * 60 * 60;

/** A cold miss cannot outlast the reader's patience (§4.13). Three hops share
 *  this budget, so it is per-hop rather than per-request. */
const UPSTREAM_TIMEOUT_MS = 10_000;

const jsonHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  /* The phone caches nothing: our URL names no advisory and no issue time, so
   * a browser holding a saved copy has no way to tell it has gone off. */
  'Cache-Control': 'no-store',
  ...extra,
});

const json = (obj, status, extra) =>
  new Response(JSON.stringify(obj), { status, headers: jsonHeaders(extra) });

/** ==> THE TWO SHAPES OF "NO" ARE ONE FACT (§48.5). <== `/points` says a place
 *  is outside coverage with a 404 and `problems/InvalidPoint`; `/alerts` says
 *  the same thing about the same place with a **400** and
 *  `problems/InvalidParameter`. Matching on status alone would make one of
 *  them an error and put a Retry button under a house in the Bahamas that will
 *  never get an answer. The `problems/` URI is the stable half — these two
 *  responses already prove the status is not. */
const OUT_OF_BOUNDS = /problems\/(InvalidPoint|InvalidParameter)/;

async function getJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json,application/json' },
      signal: ctl.signal,
    });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* left null; handled by the caller */ }
    return { ok: r.ok, status: r.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/** `19.7241` -> `19.72`, as a string, so the number that goes upstream and the
 *  number that keys the cache are the same characters. */
const round = (n) => Number(n).toFixed(WIRE_DECIMALS);

/**
 * Every alert, stripped to what a section can render.
 *
 * ==> IT DOES NOT FILTER BY EVENT, AND §48.6 STILL HOLDS. <== Which events
 * reach the screen is a decision about which SECTION owns a fact — the
 * hurricane warning belongs to `In effect` — and that decision lives in
 * `lib/rainfall.js` beside the sentence it governs. What is done here is the
 * part that has to be done here: dropping `description`, `instruction` and the
 * polygon, which is the entire 55 KB. The five stripped alerts at Hilo come to
 * a few hundred bytes, so passing all of them costs nothing and keeps this
 * route a projection.
 */
export const stripAlerts = (body) =>
  (body?.features || []).map((f) => {
    const p = f?.properties || {};
    return {
      event: p.event || null,
      /* ==> WHERE IT APPLIES, IN THE AGENCY'S OWN WORDS (§56.7). <== The
       * zone list NWS writes: `Hawaii in Hawaii, HI` on the Flash Flood
       * Warning, a thirteen-zone semicolon list on the Flood Watch. A warning
       * with no area attached asks the reader to assume it is about them,
       * which on the flood family is the one assumption worth not making.
       *
       * NOT TRUNCATED HERE AND NOT TRUNCATED DOWNSTREAM. The reader is looking
       * for their OWN zone in this list and we do not know which one that is,
       * so dropping the tail is how you hide it from them. Measured on the
       * captured set: 20 bytes on the warning, 307 on the watch, and the 694
       * byte one is a Tropical Cyclone Local Statement that never reaches the
       * flood filter. The whole point of this projection is the 55 KB of
       * `description`, `instruction` and polygon it drops; a few hundred bytes
       * of place names is not what makes it worth doing. */
      areaDesc: p.areaDesc || null,
      severity: p.severity || null,
      urgency: p.urgency || null,
      headline: p.headline || null,
      onset: p.onset || null,
      expires: p.expires || null,
      ends: p.ends || null,
    };
  });

/**
 * The three upstream bodies → the body this route serves.
 *
 * ==> SEPARATED FROM THE FETCHING SO IT CAN BE TESTED AGAINST REAL BYTES. <==
 * `tools/test-rainfall.mjs` runs this over the captured grids under
 * `samples/rain/`, which is the only way the projection itself is ever
 * exercised — a Pages Function is not reachable from the sandbox and its
 * upstream is not reachable either. Pure: no fetch, no cache, no clock.
 */
export function projectPoint({ point, grid, alerts, alertsOk }) {
  const rel = point?.properties?.relativeLocation?.properties || {};
  const qpf = grid?.properties?.quantitativePrecipitation;

  /* ==> A FAILED ALERTS HOP NEVER FAILS THE REQUEST. <== The number is the
   * bigger half of this section and it is already in hand. `alerts: null`
   * says "not known", which the client renders as its own sentence rather
   * than as the absence of a warning — an empty array would be a claim that
   * nothing is in force, which is the §5 failure this app is built against. */
  return {
    status: 'ok',
    office: point?.properties?.gridId || null,
    /* The nearest named place to the point, as NWS itself names it. It is
     * what lets the section say WHOSE forecast this is — the whole of §48.10's
     * risk is a reader on Maui comparing "3 inches" here against "8 to 12
     * inches across eastern Maui" in the storm drawer. */
    place: rel.city && rel.state ? `${rel.city}, ${rel.state}` : null,
    updateTime: grid?.properties?.updateTime || null,
    uom: qpf?.uom || null,
    values: qpf?.values || null,
    alerts: alertsOk ? stripAlerts(alerts) : null,
  };
}

/** The three hops. Returns the body this route serves, or throws. */
async function pull(lat, lon) {
  const point = await getJson(`${POINTS}/${lat},${lon}`);

  if (!point.ok) {
    if (point.status === 404 && OUT_OF_BOUNDS.test(JSON.stringify(point.body || ''))) {
      return { covered: false, body: { status: 'not_covered' } };
    }
    throw new Error(`points HTTP ${point.status}`);
  }

  const gridUrl = point.body?.properties?.forecastGridData;
  if (!gridUrl) {
    /* A 200 that resolves no grid is not a place outside coverage — it is a
     * shape we do not understand, and saying "not forecast here" about it
     * would be a confident lie about somebody's house. */
    throw new Error('points answered without a grid URL');
  }

  /* ==> ALERTS ARE FETCHED ALONGSIDE THE GRID, NOT AFTER IT. <== They are
   * independent of each other and the reader is waiting on both. */
  const [grid, alerts] = await Promise.all([
    getJson(gridUrl),
    getJson(`${ALERTS}?point=${lat},${lon}`).catch(() => ({ ok: false, status: 0, body: null })),
  ]);

  if (!grid.ok) throw new Error(`grid HTTP ${grid.status}`);

  /* An out-of-bounds alerts answer is not a failed hop — it is the SAME fact
   * the points route reports as a 404, arriving as a 400 (§48.5). Nothing is
   * in force at a place NWS does not cover, so that is an empty list rather
   * than an unknown one. */
  const alertsOk =
    alerts.ok ||
    (alerts.status === 400 && OUT_OF_BOUNDS.test(JSON.stringify(alerts.body || '')));

  return {
    covered: true,
    body: projectPoint({
      point: point.body,
      grid: grid.body,
      alerts: alerts.ok ? alerts.body : null,
      alertsOk,
    }),
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return json({ error: 'bad_point', detail: 'lat and lon must be a real coordinate' }, 400);
  }

  const qLat = round(lat);
  const qLon = round(lon);

  const cache = caches.default;
  const key = `https://landfall-relay.internal/nws/rainfall/${qLat},${qLon}`;
  const freshKey = new Request(`${key}/fresh`);
  const lastGoodKey = new Request(`${key}/last-good`);

  /* THE HIT IS REBUILT, NEVER HANDED BACK AS STORED. The stored copy carries
   * `Cache-Control: s-maxage=...` because that is how `caches.default` is told
   * how long to keep it; returning it verbatim publishes that instruction to
   * the public internet, and Cloudflare's own edge honours it (§17.7). */
  const hit = await cache.match(freshKey);
  if (hit) {
    return json(await hit.json(), 200, {
      'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
      [CACHE_PATH_HEADER]: CACHE_PATH.FRESH,
    });
  }

  let upstreamError;
  try {
    const { covered, body } = await pull(qLat, qLon);
    const fetchedAt = new Date().toISOString();
    const text = JSON.stringify(body);
    const seconds = covered ? FRESH_SECONDS : NOT_COVERED_SECONDS;
    const headers = {
      'X-Landfall-Fetched-At': fetchedAt,
      [CACHE_PATH_HEADER]: CACHE_PATH.UPSTREAM,
    };

    const stores = [
      cache.put(freshKey, new Response(text, {
        headers: { ...jsonHeaders(headers), 'Cache-Control': `s-maxage=${seconds}` },
      })),
    ];
    /* ==> A REMEMBERED "NOT COVERED" IS NEVER LAST-GOOD. <== It would then
     * outlive a real answer by six hours on the day coverage arrives, and it
     * is the one answer whose staleness a reader cannot see — there is no
     * timestamp on an absence. */
    if (covered) {
      stores.push(cache.put(lastGoodKey, new Response(text, {
        headers: { ...jsonHeaders(headers), 'Cache-Control': `s-maxage=${STALE_SECONDS}` },
      })));
    }
    context.waitUntil(Promise.all(stores));

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
   * sentence (§4.3). */
  return json(
    { error: 'rainfall_unreachable', detail: String(upstreamError?.message || upstreamError) },
    502
  );
}
