/**
 * _middleware.js — one gate in front of every /api/ route.
 *
 * Cloudflare Pages runs this before any handler under `functions/api/`, so it
 * is the only place a rule can be written once and be true for all of them.
 * The underscore keeps it from being a route itself.
 *
 * ==> WHY THE RELAY NEEDS A LIMIT AT ALL. <==
 * Every /api/ route is a proxy pointed at somebody else's public-good server —
 * NHC, GDACS, JTWC, NOAA's map services. §17 is explicit that pointing public
 * traffic at those endpoints through our relay is a different relationship than
 * one person polling for himself. An unbounded relay means a stranger's runaway
 * loop arrives at NOAA wearing our name, and the first anyone hears about it is
 * a block. The KV cache in front of most routes blunts this, but a caller
 * hammering DISTINCT paths misses the cache every time — which is exactly the
 * caller worth stopping.
 *
 * The second reason is closer to home: Pages Functions requests count against a
 * Workers quota, and the quota belongs to Aaron.
 *
 * ==> WHY IT IS NOT A ZONE RULE OR THE RATE-LIMIT BINDING. <==
 * Neither exists here. There is no Cloudflare zone on this account (Domains is
 * empty), so zone-level rate limiting is not an option; and the Workers
 * rate-limit binding is not supported for Pages Functions. See `_rate-limit.js`
 * for what is used instead and, more importantly, for what it does NOT
 * guarantee — it is per-colo and approximate, and describing it as a global
 * limit would be a lie in a file people trust.
 *
 * ==> THE REFUSAL IS THE APP'S OWN SHAPE, NOT CLOUDFLARE'S 429 PAGE. <==
 * This is the payoff of doing it in code, and it is the reason this is better
 * than the dashboard rule it replaces. A generic 429 HTML page reaches
 * data/relay.js as an unparseable body and surfaces as a mystery outage. A
 * `{ error: 'rate_limited' }` JSON body is the same shape every other failure
 * in this directory returns, so the status strip and the layer drawer say
 * something true with a retry attached (§5).
 *
 * Imports: ./_rate-limit.js only.
 */

import { underRateLimit } from './_rate-limit.js';

/* ===> TUNING. <===
 * These live here rather than in config/constants.js for the same reason
 * sw.js's do: this is a separate runtime from the browser app, and the existing
 * convention under functions/ is that server constants sit in the server file
 * (see geocode.js). Importing the app's constants module into every Function
 * bundle to share five numbers is the wrong trade.
 *
 * THE NUMBER IS SET FOR A HUMAN WITH THE APP OPEN, NOT FOR A CROWD. Normal use
 * is a poll every few minutes plus a burst when a storm is selected — call it
 * a few dozen requests a minute at the very worst, on the first load of a busy
 * basin. 120/min leaves several times that as headroom and still stops a loop
 * dead. It is deliberately generous: a false 429 during a hurricane is a much
 * worse bug than a slow one.
 *
 * WATCH THIS ON MOBILE NETWORKS. Everyone behind one carrier's NAT shares a
 * single CF-Connecting-IP, so a real crowd on one network can look like one
 * abusive caller. If 429s ever show up in telemetry without a matching traffic
 * spike, that is the cause, and the answer is to raise the number — not to
 * start keying on anything more identifying than an IP. */
const RATE = {
  windowSeconds: 60,
  maxRequests: 120,
  name: 'api',
};

/** The refusal, in the same shape every route in this directory uses. */
function rateLimited(retryAfter) {
  return new Response(
    JSON.stringify({
      error: 'rate_limited',
      detail: `Too many requests. Try again in ${retryAfter}s.`,
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        /* The standard header, so a well-behaved client backs off correctly
         * without having to understand our JSON. */
        'Retry-After': String(retryAfter),
        /* A refusal is about this caller right now and must never be held by a
         * shared cache and replayed at somebody else. */
        'Cache-Control': 'no-store',
      },
    }
  );
}

export async function onRequest(context) {
  const { request, next } = context;

  /* CORS preflights carry no credentials and do no upstream work; metering them
   * would spend a caller's budget on the browser's own bookkeeping. */
  if (request.method === 'OPTIONS') return next();

  const verdict = await underRateLimit(request, RATE);
  if (!verdict.ok) return rateLimited(verdict.retryAfter);

  return next();
}
