/**
 * /api/nws/zone?ids=HIZ023,PAZ017 — the boundaries NWS draws for its own
 * forecast zones and counties. §56.4.
 *
 * ==> THIS EXISTS BECAUSE A FLOOD WATCH ARRIVES WITH NO SHAPE. <== §48.21
 * measured it and §56.4 is the consequence: a watch is issued for a LIST OF
 * ZONES, not for a box a forecaster drew, so it carries `geometry: null`. Since
 * §56.3 made the match a distance from the storm's track, a shapeless watch
 * cannot be drawn AND cannot be matched — there is nothing to measure from.
 * The zones it names are the only route back to a shape.
 *
 * ==> AND THE SHAPE IT COMES BACK WITH IS NWS's OWN. <== §48.21 forbids giving
 * a shapeless watch a shape — no centroid, no circle, nothing invented. That
 * rule is not bent here. Fetching the boundary the agency itself publishes for
 * a zone it itself named is the opposite of drawing one.
 *
 * ==> WHY IT IS NOT PART OF /api/nws/flood. <== Two facts with two lifetimes.
 * The alert list stops being true in minutes — a flash flood warning outlives
 * neither a poll nor a coffee — and is held for fifteen. A zone boundary last
 * moved in April: NWS serves it with `max-age=2592000`, thirty days, and this
 * route holds it exactly that long. Merging them would either re-fetch
 * boundaries every fifteen minutes or serve an hour-old alert list. The client
 * joins them; that is `data/flood.js`'s job and it is cheap.
 *
 * ==> A PARTIAL ANSWER IS ALLOWED HERE, AND IT IS THE ONE PLACE IN §48 THAT IS.
 * <== `/api/nws/flood` uses `Promise.all` on purpose: a half-fetched ALERT LIST
 * is an all-clear over a flooding county. This is not a list of hazards, it is
 * a lookup of boundaries, and one zone NWS declines to serve must not cost the
 * other twenty-two theirs. So every id is settled independently and the ones
 * that failed come back BY NAME under `missing`. §56.4's rule downstream: a
 * watch whose zones did not resolve is SAID AND NOT DRAWN, never dropped and
 * never given a substitute shape.
 *
 * Pages Functions run in their own workerd runtime with no access to this
 * project's config (§4.13), so the numbers below mirror `RAIN` and `CACHE` by
 * hand and say so, exactly as the sibling routes do.
 */

import { CACHE_PATH, CACHE_PATH_HEADER } from '../_cache-path.js';

const ZONES = 'https://api.weather.gov/zones';

/** ==> NWS ANSWERS 403 WITHOUT A CONTACT IN THE USER-AGENT. <== The same
 *  string §48.13's probe measured working, and the same one
 *  `functions/api/nws/flood.js` and `functions/api/nws/rainfall.js` send.
 *  Three copies because a Pages Function cannot import from another (§4.13);
 *  `tools/test-relay-mirrors.mjs` is what keeps them honest. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app, andy@getgravitate.app)';

/** Hand-copied from `lib/zones.js`, which is where the rule lives. `OHZ011` is
 *  a forecast zone and `OHC011` is a county, and they are served from
 *  DIFFERENT PATHS — feeding one to the other's path builds a URL that 404s.
 *  `tools/test-relay-mirrors.mjs` fails when these two copies drift. */
const UGC_FORECAST_ZONE = /^[A-Z]{2}Z\d{3}$/;
const UGC_COUNTY = /^[A-Z]{2}C\d{3}$/;

/** Mirrors `RAIN.zonesPerRequest`. A cap, not a budget: each id is one upstream
 *  request on a cold miss, so uncapped this route turns one call to us into
 *  hundreds at somebody else's server. Enforced HERE and not only on the client
 *  because anyone can call this URL. */
const MAX_IDS = 40;

/** Mirrors `RAIN.zoneWireDecimals`. Four places is ~11 m; NWS publishes six.
 *  ==> A ROUNDING, NOT A SIMPLIFICATION. <== Every vertex still travels and no
 *  ring changes shape — the boundary stays NWS's, which is the whole reason
 *  §56.4 permits fetching it. */
const WIRE_DECIMALS = 4;

/* --------------------------------------------------------------------------
 * CACHE — mirrors `CACHE.zoneFresh`, and it is the longest hold in this app.
 *
 * ==> THIRTY DAYS IS NWS's OWN NUMBER, NOT A GUESS. <== Measured on the
 * captured responses, 2026-08-23: every zone answered
 * `cache-control: public, max-age=2592000` with a `last-modified` of
 * 2026-04-16 — four months old. A county line is not weather.
 *
 * ==> AND THE CACHE IS PER ZONE, NOT PER REQUEST. <== Two watches naming
 * overlapping zones, or one reader asking for four and another for twenty,
 * would otherwise share nothing. Keyed on the id alone, the second caller pays
 * for only what the first did not already fetch.
 * ----------------------------------------------------------------------- */
const FRESH_SECONDS = 30 * 24 * 60 * 60;

const UPSTREAM_TIMEOUT_MS = 10_000;

const jsonHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  /* The phone caches nothing at the HTTP layer: our URL names a SET of zones,
   * so a browser holding a saved copy of one id list has no way to answer a
   * different one. The holding that matters happens at the edge, per zone, and
   * in `data/zones.js` in memory. */
  'Cache-Control': 'no-store',
  ...extra,
});

const json = (obj, status, extra) =>
  new Response(JSON.stringify(obj), { status, headers: jsonHeaders(extra) });

/** `/zones/forecast/OHZ011` or `/zones/county/OHC011`, or null for anything
 *  that is neither. A caller-supplied id NEVER reaches a URL unchecked — this
 *  route would otherwise be an open proxy for arbitrary api.weather.gov paths. */
const zoneUrl = (id) => {
  if (UGC_FORECAST_ZONE.test(id)) return `${ZONES}/forecast/${id}`;
  if (UGC_COUNTY.test(id)) return `${ZONES}/county/${id}`;
  return null;
};

/**
 * Round every coordinate in a GeoJSON geometry to `WIRE_DECIMALS`.
 *
 * ==> RECURSIVE OVER THE NESTING, NOT OVER A KNOWN DEPTH. <== A zone comes back
 * as a Polygon or a MultiPolygon depending on whether it has offshore islands;
 * both were in the captured set. Writing a loop per type is two code paths for
 * one arithmetic operation and the second one is the one that never gets read.
 */
const roundCoords = (c) =>
  typeof c[0] === 'number'
    ? [Number(c[0].toFixed(WIRE_DECIMALS)), Number(c[1].toFixed(WIRE_DECIMALS))]
    : c.map(roundCoords);

/**
 * One upstream zone document → the four fields this app has any use for.
 *
 * ==> THE UPSTREAM IS ENORMOUS AND ALMOST NONE OF IT IS THE BOUNDARY. <==
 * Measured on the capture: `HIZ023` is **229,320 bytes** as served and its
 * geometry is **46,870** of them — the rest is pretty-printing, a list of every
 * observation station in the zone, forecast office URLs and effective dates.
 * Same projection rule `/api/nws/rainfall` follows for the same reason.
 *
 * Returns null when the body carries no geometry, which is a real answer: the
 * collection endpoint returns exactly that (see the probe note in §56.4).
 *
 * Pure: no fetch, no cache, no clock. Exported so `tools/test-zones.mjs` can
 * run it over the archived boundaries, which is the only part of this file a
 * sandbox can stand on.
 */
export function projectZone(body) {
  const g = body?.geometry;
  const t = g?.type;
  if (t !== 'Polygon' && t !== 'MultiPolygon') return null;

  const p = body?.properties || {};
  return {
    /* The zone's own name — `Kona`, `Culpeper`. The watch's `areaDesc` already
     * carries these, but it carries them as one semicolon-separated string with
     * no state in it (§56.2), and this is the version that can be matched to a
     * code. */
    name: p.name || null,
    /* ==> THE STATE, WHICH IS THE OTHER HALF OF WHY THE CODES ARE KEPT. <==
     * `areaDesc` names zones and never a state, so without this a reader in
     * Ohio cannot tell whether `Madison` is theirs. */
    state: p.state || null,
    geometry: { type: t, coordinates: roundCoords(g.coordinates) },
  };
}

async function pull(id) {
  const url = zoneUrl(id);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`zone HTTP ${r.status}`);
    const projected = projectZone(await r.json());
    if (!projected) throw new Error('zone carried no boundary');
    return projected;
  } finally {
    clearTimeout(timer);
  }
}

/** One zone, from the edge cache if it is there and from NWS if it is not.
 *  Never throws: a failure comes back as a reason so the caller can name the
 *  id in `missing` rather than losing it. */
async function resolve(cache, context, id) {
  const key = new Request(`https://landfall-relay.internal/nws/zone/${id}`);

  const hit = await cache.match(key);
  if (hit) return { id, zone: await hit.json(), cached: true };

  try {
    const zone = await pull(id);
    const text = JSON.stringify(zone);
    context.waitUntil(cache.put(key, new Response(text, {
      headers: { ...jsonHeaders(), 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
    })));
    return { id, zone, cached: false };
  } catch (e) {
    return { id, error: String(e?.message || e) };
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const raw = (url.searchParams.get('ids') || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (!raw.length) return json({ error: 'ids_required' }, 400);
  if (raw.length > MAX_IDS) return json({ error: 'too_many_ids', max: MAX_IDS }, 400);

  /* ==> IDS IN NO KNOWN SHAPE ARE REFUSED BEFORE ANY FETCH, AND REPORTED BY
   * NAME. <== They can never produce a URL (`zoneUrl` returns null), and
   * counting them as upstream failures would blame NWS for our own caller. */
  const ids = [];
  const missing = [];
  for (const id of [...new Set(raw)]) {
    if (zoneUrl(id)) ids.push(id);
    else missing.push({ id, reason: 'not_a_zone_code' });
  }

  const cache = caches.default;
  const settled = await Promise.all(ids.map((id) => resolve(cache, context, id)));

  const zones = {};
  let fromCache = 0;
  for (const r of settled) {
    if (r.zone) {
      zones[r.id] = r.zone;
      if (r.cached) fromCache++;
    } else {
      missing.push({ id: r.id, reason: r.error });
    }
  }

  return json({
    status: 'ok',
    zones,
    /* ==> NAMED, NOT COUNTED. <== The caller has to be able to say WHICH watch
     * it could not place, and a bare count cannot do that. §5. */
    missing,
  }, 200, {
    [CACHE_PATH_HEADER]: fromCache === ids.length ? CACHE_PATH.FRESH : CACHE_PATH.UPSTREAM,
  });
}
