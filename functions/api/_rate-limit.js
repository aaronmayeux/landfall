/**
 * _rate-limit.js — per-IP request counting for the relay. One implementation.
 *
 * The leading underscore is Cloudflare's "not a route" marker, same as
 * `_kv-cache.js` and `_inspect-guard.js`. It is imported, never fetched.
 *
 * ==> WHY THIS IS NOT THE WORKERS RATE-LIMIT BINDING. <==
 * The plan said it would be. It cannot be: the rate-limit binding is not in
 * Cloudflare's supported-bindings list for PAGES Functions (checked against
 * their own docs — Pages supports KV, D1, R2, Durable Objects, Hyperdrive,
 * Vectorize, Analytics Engine, service bindings, and env vars; rate limiting is
 * not among them). Neither is a zone rule an option: this account has no
 * Cloudflare zone at all, which is what pushed rate limiting into code in the
 * first place.
 *
 * ==> SO IT COUNTS IN `caches.default`, AND THAT IS NOT A NEW IDEA HERE. <==
 * `functions/api/geocode.js` has been doing exactly this since it shipped, to
 * protect a Mapbox bill. This file is that code lifted out unchanged in
 * behaviour, because the second caller is the moment a pattern gets extracted
 * (§Design) and because two copies of a limiter drift into two different
 * limiters.
 *
 * ==> WHAT IT IS AND IS NOT. READ THIS BEFORE TRUSTING IT. <==
 * `caches.default` is PER-COLO. A client spread across many Cloudflare data
 * centres gets a separate budget in each one, so this is not a global limit and
 * must not be described as one. It is a blunt instrument against the realistic
 * case — one script hammering one endpoint from one place — and it is honest
 * about being that.
 *
 * It is also approximate under concurrency: read-then-write is not atomic, so
 * simultaneous requests can both read the same count and both be allowed. The
 * fix would be a Durable Object, which is a deployed Worker, a binding, and a
 * per-request round trip to a single instance. For a personal app protecting
 * public-good endpoints from a runaway loop, counting slightly low is fine and
 * the complexity is not (§Solo-user context).
 *
 * ==> IT FAILS OPEN, DELIBERATELY. <==
 * If the cache API throws, the request is ALLOWED. A limiter that blanks the
 * app when its own storage hiccups has turned a protection into an outage —
 * the same trade lib/telemetry.js and lib/perf.js make. The thing being
 * protected here is upstream load and a quota, not user data; the cost of
 * letting one request through is a rounding error, and the cost of refusing a
 * real one during a storm is not.
 *
 * Imports: nothing.
 */

/** Counter keys live on an internal hostname that is never actually fetched —
 *  `caches.default` only needs a well-formed URL to key on. */
const KEY_ORIGIN = 'https://landfall-relay.internal/ratelimit';

/**
 * Count one request and say whether it is within budget.
 *
 * @param {Request} request
 * @param {object} opts
 * @param {string} opts.name            budget name; separate names, separate budgets
 * @param {number} opts.windowSeconds   length of the fixed window
 * @param {number} opts.maxRequests     requests allowed per window per IP
 * @returns {Promise<{ok: boolean, retryAfter: number}>}
 */
export async function underRateLimit(request, { name, windowSeconds, maxRequests }) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const cache = caches.default;
    /* FIXED windows, not a sliding one. A sliding window needs the timestamps
     * of individual requests; a fixed one needs a single integer, which is the
     * difference between one cache entry and many. The known cost is that a
     * caller can spend a full budget at the end of one window and another at
     * the start of the next — a 2x burst at the seam. Acceptable for a limit
     * whose job is stopping a loop, not shaping traffic. */
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = new Request(`${KEY_ORIGIN}/${name}/${encodeURIComponent(ip)}/${bucket}`);

    const hit = await cache.match(key);
    const count = hit ? parseInt(await hit.text(), 10) || 0 : 0;

    if (count >= maxRequests) {
      /* Seconds until this window rolls over — a real number, so the client can
       * wait exactly as long as it has to rather than guessing. */
      const endsAt = (bucket + 1) * windowSeconds * 1000;
      return { ok: false, retryAfter: Math.max(1, Math.ceil((endsAt - Date.now()) / 1000)) };
    }

    await cache.put(
      key,
      new Response(String(count + 1), {
        headers: { 'Cache-Control': `s-maxage=${windowSeconds}` },
      })
    );
    return { ok: true, retryAfter: 0 };
  } catch {
    return { ok: true, retryAfter: 0 };
  }
}
