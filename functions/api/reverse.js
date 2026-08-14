/**
 * /api/reverse — Mapbox REVERSE geocoding, proxied (SPEC §8).
 *
 * The mirror image of ./geocode.js: that one turns typing into a point, this
 * one turns a point into a name. Everything structural about it — the token
 * living server-side, the 30-day edge cache, the separate rate budget, the
 * refusal to forward Mapbox's own error bodies — is the same for the same
 * reasons, and those reasons are written out at length in geocode.js rather
 * than copied here.
 *
 * ==> WHY IT EXISTS AT ALL. <== A home set by dropping a pin carried NO name,
 * so the app printed `29.301, -94.798` at the top of the dashboard forever.
 * Coordinates are true and unreadable. This is the one call that turns the
 * point a finger put on a globe into "Galveston, Texas, United States".
 *
 * ==> IT DOES NOT ANSWER "IS THIS WATER". <== Mapbox has no marine gazetteer;
 * a point in the open Atlantic simply matches no polygon and comes back with
 * nothing. That is `none_matched` and it is NOT the same as "over water" —
 * the middle of the Sahara answers identically. The land/water question is
 * decided on the client against the basemap we have already drawn
 * (`map/water-at.js`), because that is the source that actually knows.
 *
 * SETUP: shares MAPBOX_TOKEN with /api/geocode. Nothing new to configure.
 */

import { underRateLimit } from './_rate-limit.js';

const UPSTREAM = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

/** Same 30 days as forward search, for the same reason: a town does not move.
 *  This is the single biggest lever on what this endpoint costs. */
const CACHE_SECONDS = 30 * 24 * 60 * 60;

/** Coordinates are rounded to this many decimals BEFORE they become a cache
 *  key. Three decimals is about 100 m, which is far finer than the smallest
 *  thing this returns (a town), so rounding never changes the answer — it just
 *  stops two taps a metre apart from being two billed lookups. It is also the
 *  precision the confirm step already prints, so the key and the screen agree.
 *
 *  ==> AND IT IS THE PRIVACY POSTURE, NOT ONLY A COST ONE. <== §8 says home
 *  coordinates never leave the device. This endpoint is the one exception in
 *  the whole app and it is a deliberate, user-initiated one — so it sends the
 *  coarsest number that can still answer the question, stores no association
 *  between the point and anybody, and the cache key is the point alone with no
 *  caller identity mixed in. */
const KEY_DECIMALS = 3;

/**
 * ==> WHAT WE ASK FOR, AND WHAT IS DELIBERATELY MISSING FROM THE LIST. <==
 *
 * `place,locality,region,country` — the town, its region, its country. NOT
 * `address` and NOT `poi`. Somebody who dropped a pin in a field does not want
 * to be told they live at the nearest street number, and a rooftop-accurate
 * answer to a deliberately approximate question is a confident lie. The town
 * is the honest resolution of a dragged pin.
 *
 * `neighborhood` is out for the same reason in the other direction: it is
 * finer than the pin's accuracy and it makes the label longer without making
 * it more useful.
 */
const TYPES = 'place,locality,region,country';

const baseHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});

/** Codes, never prose. The client owns the sentences (SPEC §5). */
const fail = (status, code, detail) =>
  new Response(
    JSON.stringify({ error: code, detail: detail || undefined }),
    { status, headers: baseHeaders() }
  );

/** Its own budget, separate from forward search. They are billed separately
 *  and they are abused differently: a forward search is many requests for one
 *  intent, a reverse is one request per intent. Six a minute is more than
 *  anybody dragging a pin can generate at the client's settle delay, and it is
 *  a cheap ceiling on a scripted sweep of the ocean. */
const REVERSE_RATE = {
  name: 'reverse',
  windowSeconds: 60,
  maxRequests: 6,
};

/** Mapbox returns the whole containment chain, most specific first. We want
 *  the most specific one and its `place_name`, which already reads as
 *  "Galveston, Texas, United States" — the chain assembled by somebody who
 *  knows how addresses are written in that country, which is not a thing to
 *  reimplement here.
 *
 *  CAPPED AT THREE COMMA-PARTS. Some countries return five or six, and the
 *  label lands in a single ellipsised line on a phone — past three parts the
 *  extra ones are what gets cut anyway, so cutting them here means the visible
 *  part is the useful part rather than a truncated preamble. */
function labelOf(features) {
  const f = features[0];
  if (!f) return null;
  const full = String(f.place_name || f.text || '').trim();
  if (!full) return null;
  const parts = full.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.slice(0, 3).join(', ') || null;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const token = env.MAPBOX_TOKEN;
  if (!token) return fail(503, 'reverse_not_configured');

  const url = new URL(request.url);
  const lon = Number(url.searchParams.get('lon'));
  const lat = Number(url.searchParams.get('lat'));

  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return fail(400, 'bad_coordinates');
  }

  const qLon = lon.toFixed(KEY_DECIMALS);
  const qLat = lat.toFixed(KEY_DECIMALS);

  /* Cache BEFORE rate limit, exactly as in geocode.js — the limiter exists to
   * protect a bill, so it must only count lookups that generate one. The long
   * note on why that ordering matters for people sharing a carrier NAT is in
   * that file and applies here unchanged. */
  const cacheKey = new Request(
    `https://landfall-relay.internal/reverse/${qLon},${qLat}`
  );
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const budget = await underRateLimit(request, REVERSE_RATE);
  if (!budget.ok) {
    return fail(429, 'rate_limited', `Try again in ${budget.retryAfter}s.`);
  }

  const upstream = new URL(`${UPSTREAM}/${qLon},${qLat}.json`);
  upstream.searchParams.set('access_token', token);
  upstream.searchParams.set('types', TYPES);
  upstream.searchParams.set('limit', '1');

  try {
    const r = await fetch(upstream.toString(), {
      headers: { Accept: 'application/json' },
    });

    /* Never forward Mapbox's body — it can echo the token back inside an
     * error message. Codes only. */
    if (r.status === 401 || r.status === 403) return fail(502, 'reverse_auth_failed');
    if (r.status === 429) return fail(429, 'reverse_quota_exceeded');
    if (!r.ok) return fail(502, 'reverse_upstream_error', `HTTP ${r.status}`);

    const data = await r.json();
    const label = labelOf(Array.isArray(data.features) ? data.features : []);

    const body = JSON.stringify({ lon: Number(qLon), lat: Number(qLat), label });
    const headers = baseHeaders({ 'Cache-Control': `s-maxage=${CACHE_SECONDS}` });

    /* ==> AN EMPTY ANSWER IS CACHED HERE, AND THAT IS THE OPPOSITE OF WHAT
     *     geocode.js DOES. <== There, a zero-result response usually means a
     *     half-typed query that the next keystroke turns into a real one, so
     *     pinning it for thirty days would be pinning a transient state.
     *
     *     Here there is no next keystroke. A point in the middle of the
     *     Atlantic has no name today and will have no name in thirty days —
     *     "nothing" IS the durable, correct answer, and it is exactly the one
     *     worth never paying for twice. Somebody dragging a pin around open
     *     water would otherwise generate a billed lookup per settle. */
    context.waitUntil(cache.put(cacheKey, new Response(body, { headers })));

    return new Response(body, { headers });
  } catch (e) {
    return fail(502, 'reverse_unreachable', String(e?.message || e));
  }
}
