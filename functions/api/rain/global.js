/**
 * /api/rain/global?lat=14.60&lon=120.98 — how much rain is coming to a point
 * ANYWHERE. §48.14, §48.15.
 *
 * ==> THIS ROUTE EXISTS SO THAT `lib/rainfall.js` NEVER LEARNS THERE ARE TWO
 *     SOURCES. <== That is the entire design and it is worth stating before
 * anything else. Open-Meteo publishes parallel arrays — a list of ISO times
 * and a list of numbers, positionally paired — while NWS publishes a list of
 * `{ validTime, value }` objects where `validTime` is an interval. Those are
 * the SAME FACT in two packagings, and the packaging is a transport concern.
 * So it is normalised HERE, into the exact shape `/api/nws/rainfall` already
 * serves, and every line of arithmetic, every window, every sentence and every
 * test downstream is untouched. The alternative — a second parser in
 * `lib/rainfall.js` — means two code paths that must agree about what an inch
 * is, and they would drift.
 *
 * ==> THE UNITS ARE ALREADY RIGHT AND THAT IS LUCK, NOT DESIGN. <== §48.4
 * records that NWS's `quantitativePrecipitation` reads `wmoUnit:mm` at every
 * point ever probed, including the American ones. Open-Meteo's
 * `hourly_units.precipitation` reads `mm`. Same unit, so there is no
 * conversion here — but the field IS READ rather than assumed, exactly as
 * §48.4 requires, and an unrecognised one is an answer rather than a guess.
 *
 * ==> CORS IS OPEN AND WE RELAY ANYWAY. <== Measured 2026-08-19 with a real
 * `Origin` header from landfall.getgravitate.app: `access-control-allow-origin:
 * *`. A browser could call this itself. Three reasons it does not:
 *
 *   1. THE QUOTA IS INVISIBLE. The free tier's daily ceiling is a number on a
 *      documentation page and the response carries no `x-ratelimit-*` header
 *      at all. Nothing can be measured at runtime, so the only defence is to
 *      make fewer calls — which needs a shared cache, which needs a server.
 *   2. THE COORDINATE IS SOMEBODY'S HOUSE. Behind this route it reaches one
 *      third party from one server; in front of it, it reaches them from the
 *      reader's own IP.
 *   3. ONE CSP. Adding a second origin to the connect-src for one feature is a
 *      permanent widening of what this app is allowed to talk to.
 *
 * ==> WHAT IT DOES NOT HAVE, AND SAYS SO. <== There are no flood warnings
 * here. Open-Meteo publishes weather, not what an agency has in force, and no
 * global equivalent of `/alerts/active` exists that this project has found.
 * `alerts: null` is the same signal the NWS route sends when its alerts hop
 * fails — so `provider` travels beside it, and `ui/rain-home.js` writes two
 * different sentences from it. "Could not be checked just now" is retryable
 * and wrong here; "not available for this location" is the truth and is not.
 *
 * Pages Functions run in their own workerd runtime with no access to this
 * project's config (§4.13), so the numbers below mirror `RAIN` and
 * `ENDPOINT.openMeteoForecast` by hand and say so, exactly as the NWS, SHIPS
 * and GDACS routes do.
 */

import { CACHE_PATH, CACHE_PATH_HEADER } from '../_cache-path.js';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';

/** Mirrors `RAIN.wireDecimals`. Enforced here as well as on the client for the
 *  reason the NWS route gives: a caller can reach this directly, and there is
 *  no reason for this service to hold a coordinate finer than the model grid
 *  it is asking about. */
const WIRE_DECIMALS = 2;

/** Mirrors `RAIN.windowHours` (120) expressed in whole days, which is the only
 *  unit this API takes. Asking for more than the section can show is paid for
 *  in bytes by every reader and shown to none of them. */
const FORECAST_DAYS = 5;

/* --------------------------------------------------------------------------
 * CACHE
 *
 * ==> LONGER THAN THE NWS ROUTE'S FIFTEEN MINUTES, AND THE REASON IS WHAT IS
 * MISSING FROM THIS PAYLOAD. <== That window is set by flood warnings, which
 * travel in the NWS body and routinely expire inside an hour. Nothing in this
 * body expires. What is left is a numerical weather model, and the global
 * models behind this one are rerun a few times a day. An hour cannot go far
 * wrong, and it is the difference between one upstream call per hour per
 * neighbourhood and four — against a daily ceiling nothing can measure.
 *
 * LAST-GOOD 6 H, matching the NWS route exactly. A six-hour-old rainfall
 * forecast is still a rainfall forecast and beats a blank section (§5).
 * ----------------------------------------------------------------------- */
const FRESH_SECONDS = 60 * 60;
const STALE_SECONDS = 6 * 60 * 60;

const UPSTREAM_TIMEOUT_MS = 10_000;

/** The unit strings this route knows how to state as millimetres. A short list
 *  with no fallback, for §48.4's reason: an unrecognised code means the API
 *  changed, and a plausible number is worse than an admission. */
const TO_MM = Object.freeze({ mm: 1, cm: 10, inch: 25.4 });

const jsonHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  ...extra,
});

const json = (obj, status, extra) =>
  new Response(JSON.stringify(obj), { status, headers: jsonHeaders(extra) });

const round = (n) => Number(n).toFixed(WIRE_DECIMALS);

/**
 * Open-Meteo's body → the body `/api/nws/rainfall` serves.
 *
 * ==> SEPARATED FROM THE FETCHING SO IT CAN BE TESTED AGAINST REAL BYTES. <==
 * `tools/test-rain-global.mjs` runs this over the archived Manila capture,
 * which is the only way this projection is ever exercised — a Pages Function
 * is not reachable from the sandbox and neither is its upstream.
 *
 * ==> THE INTERVAL IS BUILT, NOT COPIED, AND IT IS BUILT TO NWS'S GRAMMAR.
 * <== §48.4: `validTime` is an instant, a solidus, and an ISO 8601 duration.
 * Open-Meteo sends a bare local-naked timestamp (`2026-08-19T00:00`) on a base
 * this route pins to UTC by asking for `timezone=UTC`, and every value covers
 * exactly one hour. So the interval this emits is
 * `2026-08-19T00:00:00+00:00/PT1H` — which `parseInterval()` already reads,
 * with no new code and no new test of its own.
 *
 * ==> A NULL IN THE SERIES IS DROPPED, NOT ZEROED. <== The archived Manila
 * capture carried 72 values and no nulls, so this has never fired — but a
 * missing hour is an hour we do not know about, and summing it as zero would
 * quietly shrink a total. Dropping it makes the block absent, which
 * `windowBlocks` already handles as a gap rather than as a dry hour.
 *
 * Pure: no fetch, no cache, no clock.
 */
export function projectOpenMeteo({ body, place = null, fetchedAt = null }) {
  const unit = String(body?.hourly_units?.precipitation || '');
  const factor = TO_MM[unit.toLowerCase()];

  const times = body?.hourly?.time;
  const rain = body?.hourly?.precipitation;

  if (!Array.isArray(times) || !Array.isArray(rain) || times.length === 0) {
    /* A 200 with no series in it is not a place outside coverage — this model
     * covers the whole planet — so it cannot be `not_covered`. It is a shape
     * we do not understand, and the client's `unreadable` sentence is the
     * honest one. Emitting an empty `values` array would be read downstream as
     * "no rain forecast here", which is a claim nobody made. */
    return { status: 'ok', provider: 'open-meteo', place, updateTime: fetchedAt, uom: null, values: null, alerts: null };
  }

  if (!factor) {
    return { status: 'ok', provider: 'open-meteo', place, updateTime: fetchedAt, uom: unit || null, values: null, alerts: null };
  }

  const values = [];
  const n = Math.min(times.length, rain.length);
  for (let i = 0; i < n; i++) {
    const v = rain[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    values.push({ validTime: `${times[i]}:00+00:00/PT1H`, value: v * factor });
  }

  return {
    status: 'ok',
    /* ==> THE ONE FIELD THE NWS ROUTE DOES NOT SEND, AND THE SECTION READS IT.
     * <== §48.16. Everything else here is deliberately identical; this is what
     * lets one section write two provenance lines and two different sentences
     * about warnings without knowing anything else about where it came from. */
    provider: 'open-meteo',
    /* ==> THE COORDINATE THE MODEL ACTUALLY ANSWERED FOR, NOT THE ONE ASKED.
     * <== Measured: 14.5995/120.9842 went up and 14.586995/121.002785 came
     * back — Open-Meteo snaps to its own grid. NWS names its nearest town for
     * §48.10's reason, and the same reason applies here: a reader comparing
     * this against a storm advisory needs to know WHERE it is a forecast for.
     * There is no name in this payload, so the coordinate is what there is. */
    gridLat: Number.isFinite(body?.latitude) ? body.latitude : null,
    gridLon: Number.isFinite(body?.longitude) ? body.longitude : null,
    place,
    /* The model's own run time is not published in this response. The fetch
     * time is what there is, and it is stated as such rather than dressed up
     * as an `updateTime` we read from the source. */
    updateTime: fetchedAt,
    uom: 'wmoUnit:mm',
    values,
    /* NOT AN OUTAGE. There is no flood-warning source here at all, and the
     * `provider` field above is how the section tells that apart from the NWS
     * route's failed alerts hop (§5). */
    alerts: null,
  };
}

async function pull(lat, lon, fetchedAt) {
  const url =
    `${FORECAST}?latitude=${lat}&longitude=${lon}` +
    `&hourly=precipitation&forecast_days=${FORECAST_DAYS}&timezone=UTC`;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`open-meteo HTTP ${r.status}`);
    const body = await r.json();
    return projectOpenMeteo({ body, fetchedAt });
  } finally {
    clearTimeout(timer);
  }
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
  const key = `https://landfall-relay.internal/rain/global/${qLat},${qLon}`;
  const freshKey = new Request(`${key}/fresh`);
  const lastGoodKey = new Request(`${key}/last-good`);

  /* THE HIT IS REBUILT, NEVER HANDED BACK AS STORED (§17.7) — the stored copy
   * carries the `s-maxage` that tells `caches.default` how long to keep it,
   * and returning it verbatim publishes that instruction to the internet. */
  const hit = await cache.match(freshKey);
  if (hit) {
    return json(await hit.json(), 200, {
      'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
      [CACHE_PATH_HEADER]: CACHE_PATH.FRESH,
    });
  }

  let upstreamError;
  try {
    const fetchedAt = new Date().toISOString();
    const body = await pull(qLat, qLon, fetchedAt);
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
   * sentence (§4.3). */
  return json(
    { error: 'rainfall_unreachable', detail: String(upstreamError?.message || upstreamError) },
    502
  );
}
