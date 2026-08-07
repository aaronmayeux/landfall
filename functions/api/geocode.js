/**
 * /api/geocode — Mapbox address search, proxied (SPEC §8).
 *
 * WHY THIS EXISTS AT ALL: a Mapbox token in a static client bundle is a public
 * token. Anyone can view-source it, and a stolen geocoding key bills until
 * somebody notices. The token lives in Pages environment variables and is read
 * here, server-side, where the browser can't see it.
 *
 * Like the NHC relay, this file does not reach into the BROWSER app — Pages
 * Functions run in their own workerd runtime, so importing config/constants.js
 * would couple a static deploy to a bundler step we don't have. Numbers
 * duplicated from the constants file are marked; that file is the truth. It
 * does import its sibling `_rate-limit.js`, which is server code and shares the
 * runtime.
 *
 * This function stays DUMB in the same way the NHC relay does: forward, cache,
 * trim. No scoring, no re-ranking, no "did you mean" logic. The client decides
 * what to show.
 *
 * SETUP: set MAPBOX_TOKEN in Cloudflare Pages → Settings → Environment
 * variables, for both Production and Preview. It is never in the repo.
 */

import { underRateLimit } from './_rate-limit.js';

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
 * across colos.
 *
 * ==> AND IT IS THE ONLY LEVER THAT EXISTS. Corrected 2026-07-26. <==
 * This block used to point the scale pass at "a Durable Object or the
 * Cloudflare Rate Limiting rules." BOTH of those turned out to be closed
 * doors, and the next reader should not spend an afternoon rediscovering it:
 *
 * - **Cloudflare Rate Limiting rules are ZONE-SCOPED and getgravitate.app is
 *   NOT a Cloudflare zone** — it is registered at Namecheap and reaches Pages
 *   by CNAME (SPEC §3). There is no zone to attach a rule to, and moving the
 *   nameservers to get one is rejected in SPEC §17.
 * - **Mapbox HAS NO SPENDING CAP.** Confirmed against Mapbox's own billing
 *   docs 2026-07-26: past the free tier, service does not stop — billing
 *   simply begins, and there are no configurable usage alerts. So there is no
 *   backstop underneath this counter. It is not the first line of defence; it
 *   is the only one.
 *
 * The per-colo undercount is an AGGREGATE undercount, and that distinction is
 * what makes this adequate: a single abuser's requests land in one or two
 * colos, so per-IP counting works close to as intended against exactly the
 * threat this exists for. It is distributed abuse it cannot see, and a hobby
 * hurricane map is not that target.
 *
 * The emergency lever is not in this file: DELETE `MAPBOX_TOKEN` from the
 * Pages environment variables. Search degrades to `geocode_not_configured`
 * (a handled state, not a crash) and the other two ways to set home —
 * geolocation and drop-a-pin — keep working.
 * -------------------------------------------------------------------------- */

/* The COUNTING lives in ./_rate-limit.js now — this file no longer carries its
 * own copy. It was the only implementation until /api/ got a middleware gate,
 * and two hand-maintained limiters are two limiters that drift. What stays here
 * is the BUDGET, because it is a different budget for a different reason: the
 * middleware protects upstream load, this protects a Mapbox bill.
 *
 * `name: 'geocode'` keeps the two counts separate. A geocode request is metered
 * by both, and that is correct — it costs Aaron twice. */
const GEOCODE_RATE = {
  name: 'geocode',
  windowSeconds: 60,
  maxRequests: 15,
};

/* `maxRequests` above was lowered 30 -> 15 on 2026-07-26, ahead of the public
 * launch, and is affordable ONLY because the cache lookup happens first (see
 * the handler). It counts BILLABLE lookups, not requests — a real person typing
 * one address debounced at 250ms spends 3-8 of these, and every repeat of a
 * query anyone has searched in the last 30 days costs zero against it. */

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

  /* ==> THE CACHE IS CHECKED BEFORE THE RATE LIMIT, AND THE ORDER IS THE
   *     WHOLE POINT. Changed 2026-07-26. <==
   *
   * It used to be the other way round, which meant a lookup that cost NOTHING
   * — already cached, never touching Mapbox — still burned a slot in the
   * caller's budget. That is the wrong thing to meter. The limiter exists to
   * protect a BILL, so it must count the requests that generate one.
   *
   * It matters most for the people least able to explain it: everyone behind
   * one mobile carrier's NAT shares a single CF-Connecting-IP, so during a
   * traffic spike a dozen strangers on the same network spend one budget
   * between them. Metering cache hits would have thrown 429s at real people
   * searching real addresses while Mapbox was never contacted at all.
   *
   * The inverse case is fine: someone hammering the SAME query forever is
   * served from cache forever and never costs a cent. Someone hammering
   * DISTINCT queries is exactly who the limiter is for, and they still hit it
   * on the first uncached one.
   *
   * Cache key is the normalized query alone — not the caller's IP, or every
   * user would pay for their own copy of the same lookup. */
  const cacheKey = new Request(
    `https://landfall-relay.internal/geocode/${encodeURIComponent(q.toLowerCase())}`
  );
  const cache = caches.default;

  /* ==> THIS ROUTE PUBLISHES ITS `s-maxage` TO THE PUBLIC EDGE ON PURPOSE, AND
   *     IT IS THE ONLY DATA ROUTE THAT DOES. <==
   *
   * Every other relay route rebuilds its cache hit specifically to STOP that
   * directive reaching Cloudflare's front-line cache, because a weather feed
   * that the edge is allowed to hold has a third invisible clock stacked on
   * how old its data can be (`SPEC-OPS.md` §17.7).
   *
   * A geocode result has no such clock. "1600 Pennsylvania Ave" resolves to the
   * same point next month as it does today, which is why CACHE_SECONDS is
   * THIRTY DAYS rather than minutes — there is no staleness to leak. And the
   * upside is real money: a request the edge answers never runs this function,
   * so it never reaches the Mapbox lookup that gets billed, and never spends
   * one of the fifteen the rate limiter allows.
   *
   * ==> THE TEST THAT DECIDES THIS, IF THE QUESTION IS EVER REOPENED: does the
   *     answer change on its own over time? <== For a storm, a radar frame, or
   *     an advisory, yes, and the edge must not hold it. For an address, no.
   */
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const budget = await underRateLimit(request, GEOCODE_RATE);
  if (!budget.ok) {
    return fail(429, 'rate_limited', `Try again in ${budget.retryAfter}s.`);
  }

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
