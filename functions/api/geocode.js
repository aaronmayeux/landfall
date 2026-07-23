/**
 * /api/geocode — Mapbox address search, proxied (SPEC §8).
 *
 * WHY THIS EXISTS AT ALL: a Mapbox token in a static client bundle is a public
 * token. Anyone can view-source it, and a stolen geocoding key bills until
 * somebody notices. The token lives in Pages environment variables and is read
 * here, server-side, where the browser can't see it.
 *
 * Like the NHC relay, this file is SELF-CONTAINED on purpose — Pages Functions
 * run in their own workerd runtime, so importing config/constants.js would
 * couple a static deploy to a bundler step we don't have. Numbers duplicated
 * from the constants file are marked; that file is the truth.
 *
 * This function stays DUMB in the same way the NHC relay does: forward, cache,
 * trim. No scoring, no re-ranking, no "did you mean" logic. The client decides
 * what to show.
 *
 * SETUP: set MAPBOX_TOKEN in Cloudflare Pages → Settings → Environment
 * variables, for both Production and Preview. It is never in the repo.
 */

const UPSTREAM = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

/** Mirrors GEOCODE.maxResults in config/constants.js. */
const MAX_RESULTS = 5;

/** Mirrors GEOCODE.minChars. Enforced server-side too: the client debounce is
 *  a cost control, but anyone can call this endpoint directly. */
const MIN_CHARS = 3;

/** Hard cap on query length. Mapbox's own limit is 256; refusing early keeps a
 *  pathological 10 KB query from ever reaching a billed API. */
const MAX_QUERY_CHARS = 256;

/** Geocoding results are effectively static — an address does not move. A long
 *  cache is the single biggest lever on cost, so this is deliberately much
 *  longer than any storm-data TTL. 30 days. */
const CACHE_SECONDS = 30 * 24 * 60 * 60;

/* --- rate limiting -----------------------------------------------------------
 * Without this, /api/geocode is a free geocoder for whoever finds it, billed
 * to Aaron. Cache-based counter keyed by IP: crude, no Durable Object, no KV
 * binding to configure. It resets on a rolling window and it can undercount
 * across colos — that is an acceptable trade for a solo-user app. It stops
 * casual abuse, not a determined attacker.
 *
 * NOTE FOR THE SCALE PASS: if Landfall goes properly public this wants a real
 * rate limiter (Durable Object or the Cloudflare Rate Limiting rules), because
 * per-colo cache counters get multiplied by the number of colos.
 * -------------------------------------------------------------------------- */

const RATE_WINDOW_SECONDS = 60;
const RATE_MAX_REQUESTS = 30;

const baseHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});

/** The client turns these codes into human sentences. The relay never sends
 *  prose — SPEC §5: errors surface near their source in human language, and
 *  "near their source" means the UI layer that has the context, not here. */
const fail = (status, code, detail) =>
  new Response(
    JSON.stringify({ error: code, detail: detail || undefined }),
    { status, headers: baseHeaders() }
  );

async function underRateLimit(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const cache = caches.default;
  const bucket = Math.floor(Date.now() / (RATE_WINDOW_SECONDS * 1000));
  const key = new Request(
    `https://landfall-relay.internal/ratelimit/geocode/${encodeURIComponent(ip)}/${bucket}`
  );

  const hit = await cache.match(key);
  const count = hit ? parseInt(await hit.text(), 10) || 0 : 0;
  if (count >= RATE_MAX_REQUESTS) return false;

  await cache.put(
    key,
    new Response(String(count + 1), {
      headers: { 'Cache-Control': `s-maxage=${RATE_WINDOW_SECONDS}` },
    })
  );
  return true;
}

/** Mapbox returns a large feature object per result. Trim to what the confirm
 *  step actually needs: a label to show, a point to fly to, and the accuracy
 *  signal that decides how loudly we push "drag to adjust".
 *
 * `relevance` is Mapbox's 0-1 match score. `accuracy` (on address results)
 * says whether the point is a rooftop, an interpolated street position, or a
 * postcode centroid — which is exactly the distinction between "your house"
 * and "your zip code," and the user needs to feel that difference. */
function trimFeature(f) {
  const [lon, lat] = f.center || [];
  return {
    id: f.id,
    label: f.place_name,
    lon,
    lat,
    relevance: typeof f.relevance === 'number' ? f.relevance : null,
    accuracy: f.properties?.accuracy || null,
    type: Array.isArray(f.place_type) ? f.place_type[0] : null,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const token = env.MAPBOX_TOKEN;
  if (!token) {
    /* Misconfiguration, not an outage. Distinct code so the client can say
     * "address search isn't set up" rather than "Mapbox is down" — one of
     * those is Aaron's problem to fix and the other isn't. */
    return fail(503, 'geocode_not_configured');
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();

  if (q.length < MIN_CHARS) return fail(400, 'query_too_short');
  if (q.length > MAX_QUERY_CHARS) return fail(400, 'query_too_long');

  if (!(await underRateLimit(request))) {
    return fail(429, 'rate_limited');
  }

  /* Cache key is the normalized query alone — not the caller's IP, or every
   * user would pay for their own copy of the same lookup. */
  const cacheKey = new Request(
    `https://landfall-relay.internal/geocode/${encodeURIComponent(q.toLowerCase())}`
  );
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const upstream = new URL(`${UPSTREAM}/${encodeURIComponent(q)}.json`);
  upstream.searchParams.set('access_token', token);
  upstream.searchParams.set('limit', String(MAX_RESULTS));
  upstream.searchParams.set('autocomplete', 'true');
  /* Addresses, places, and postcodes — not POIs. Home is where someone lives;
   * offering them a coffee shop as a home location is noise. */
  upstream.searchParams.set('types', 'address,place,postcode,locality,neighborhood');

  try {
    const r = await fetch(upstream.toString(), {
      headers: { Accept: 'application/json' },
    });

    if (r.status === 401 || r.status === 403) {
      /* Bad or revoked token. Again distinct from an outage — this one means
       * go look at the Mapbox dashboard. Never forward Mapbox's body: it can
       * echo the token back in an error message. */
      return fail(502, 'geocode_auth_failed');
    }
    if (r.status === 429) return fail(429, 'geocode_quota_exceeded');
    if (!r.ok) return fail(502, 'geocode_upstream_error', `HTTP ${r.status}`);

    const data = await r.json();
    const results = (data.features || []).map(trimFeature).filter(
      (f) => Number.isFinite(f.lon) && Number.isFinite(f.lat)
    );

    const body = JSON.stringify({ query: q, results });
    const headers = baseHeaders({ 'Cache-Control': `s-maxage=${CACHE_SECONDS}` });

    /* Only cache non-empty results. A zero-result response for a half-typed
     * address should not be pinned for 30 days — the next character makes it
     * a real query. */
    if (results.length) {
      context.waitUntil(cache.put(cacheKey, new Response(body, { headers })));
    }

    return new Response(body, { headers });
  } catch (e) {
    return fail(502, 'geocode_unreachable', String(e?.message || e));
  }
}
