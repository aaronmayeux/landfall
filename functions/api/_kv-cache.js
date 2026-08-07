/**
 * _kv-cache.js — the READ side of SPEC §17 Pass B's origin collapse.
 *
 * THE PROBLEM THIS EXISTS FOR. Every relay route caches in `caches.default`,
 * which is PER-DATACENTER. Cloudflare has 300+ colos, so `s-maxage=300` never
 * meant "NOAA is fetched once per five minutes" — it meant up to ~300 times
 * per five minutes, and that was true at one user and would stay true at a
 * hundred thousand. It also means the FIRST visitor in every region eats a
 * full round trip to NOAA: exactly the person arriving on a shared link
 * during a storm.
 *
 * THE FIX. One standalone cron Worker (`worker/`) fetches each feed ONCE
 * globally and writes it to a KV namespace. Every Pages Function reads that
 * namespace instead of reaching upstream. Origin fetches drop from ~300 per
 * interval to 1, forever, at any traffic level.
 *
 * ===> PAGES FUNCTIONS NEVER WRITE TO KV. THIS IS THE LOAD-BEARING RULE. <===
 * If a Function wrote its upstream result back, 300 colos would each write the
 * same key and we would have rebuilt the exact write storm this pass exists to
 * delete — only now with a bill attached. Reads are cheap and bounded; writes
 * are the metered thing. The cron Worker is the ONLY writer, which is what
 * makes the write budget a number you can calculate in advance instead of a
 * function of traffic. There is no `kvWrite` in this file on purpose.
 *
 * THE THREE-LEVEL READ, and each level earns its place:
 *   L1  caches.default   per-colo, free, absorbs repeat hits inside one region
 *   L2  KV               global, written by the cron, single-digit ms at edge
 *   L3  upstream         THE SAFETY VALVE — see below
 *
 * ===> L3 IS NOT A FALLBACK, IT IS THE REASON THIS IS SAFE TO DEPLOY. <===
 * Every route keeps its original upstream path completely intact. If the KV
 * binding is absent, if the namespace is empty, if the cron Worker was never
 * deployed, if the cron silently stopped three days ago — every route degrades
 * to EXACTLY today's behaviour rather than going dark. That is why this pass
 * can ship before the Worker is running, and why a Worker outage is a
 * performance regression instead of an outage.
 *
 * A missing binding must not cost a user anything (§17 A5's rule, and the
 * opposite of the inspect guard's fail-closed, deliberately): `kvRead` returns
 * null on an absent binding, a malformed binding, or a thrown KV call, and the
 * caller cannot tell the difference between that and a cache miss.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED like every other file under functions/ — it imports nothing
 * (§3). The KEY SHAPES it documents are duplicated in `worker/src/sources.js`,
 * which is the writer. That duplication is forced by the two runtimes being
 * separate deploys, and `tools/test-kv-keys.mjs` asserts the two agree.
 */

/**
 * The binding name, stated once. Both the Pages project and the cron Worker
 * bind the SAME namespace under this name.
 *
 * NAMING IT HERE RATHER THAN INLINE is not tidiness: a typo'd binding name
 * does not throw, it reads as `undefined`, and `kvRead` then returns null
 * forever while every route quietly falls through to upstream. The whole pass
 * would appear to deploy successfully and do nothing at all. One constant
 * means one place to check against the dashboard.
 */
export const KV_BINDING = 'LANDFALL_CACHE';

/**
 * The key namespace prefix. Bumping this invalidates EVERY warmed entry at
 * once — the equivalent of `sw.js`'s VERSION bump, and reserved for the same
 * situation: the stored shape changed, or something poisoned the store and
 * waiting it out is not acceptable.
 */
export const KV_PREFIX = 'v1';

/** Build a namespaced key from a route-shaped path. `nhc/storms` → `v1:nhc/storms`. */
export const kvKey = (path) => `${KV_PREFIX}:${path}`;

/**
 * Is this the cron Worker warming us, and may it skip both caches?
 *
 * ===> WITHOUT THIS, THE WARM LOOP CONFIRMS ITS OWN LAST ANSWER FOREVER. <===
 * The Worker warms by requesting these routes (see worker/src/sources.js for
 * why it calls us instead of NOAA). An ordinary request is answered from the
 * colo cache, or from the KV copy the PREVIOUS cycle wrote — so the Worker
 * would store what it already stored, the source would never be contacted
 * again, and every dashboard would report a healthy warm loop over a store
 * that had quietly stopped tracking the world. At a 5-minute cron against a
 * 5-minute fresh window that is not an edge case; it is the boundary every
 * single cycle lands on.
 *
 * ===> AND WHY IT IS GATED RATHER THAN A PLAIN HEADER. <===
 * A cache bypass anybody can ask for is a lever a stranger pulls to drive
 * uncached traffic straight through us at NOAA, at whatever rate they like,
 * under our User-Agent. That is precisely the open-proxy relationship §17 A2
 * closed on the inspect routes; leaving it open on the FEEDS would be the
 * same hole on a bigger endpoint. So it costs a shared secret.
 *
 * FAILS CLOSED, unlike `kvRead` next door, and the asymmetry is deliberate
 * and worth stating: a missing KV binding must cost a user nothing (fall
 * through to upstream, §17 A5's rule), but a missing WARM_KEY must not hand
 * out a bypass to everyone (§17 A2's rule). A cache is a convenience; a gate
 * is a gate. With no key set, nothing can bypass — including the Worker,
 * whose warm loop then goes quiet and visibly stops writing rather than
 * opening a hole.
 *
 * Timing-safe comparison is NOT used here on purpose. The compared value is a
 * long random string with no structure to walk, the endpoint is a public
 * cache-bypass rather than an authentication boundary, and a constant-time
 * compare hand-rolled in a hot request path is a more likely source of bugs
 * than the attack it prevents. Named so the next reader knows it was a
 * decision and not an oversight.
 */
export function isWarmRequest(request, env) {
  const key = env && env.WARM_KEY;
  if (!key || typeof key !== 'string') return false;
  return request.headers.get('X-Landfall-Warm') === key;
}

/**
 * Resolve the KV binding, or null when it is not usable.
 *
 * The `typeof` check is not paranoia. A Pages environment VARIABLE and a KV
 * BINDING with the same name are both reachable as `env.LANDFALL_CACHE`, and
 * a variable is a string — calling `.getWithMetadata` on it throws a
 * TypeError inside a request. Confirming the shape rather than the presence
 * turns a misconfigured dashboard into a silent fallback to upstream, which
 * is the correct failure for this file.
 */
export function kvBinding(env) {
  const kv = env && env[KV_BINDING];
  return kv && typeof kv.getWithMetadata === 'function' ? kv : null;
}

/**
 * Read one warmed entry.
 *
 * @param {object} env             the Function's environment
 * @param {string} path            route-shaped path, e.g. `nhc/advisory/MIATCPAT2`
 * @param {number} freshSeconds    the route's own FRESH window, in seconds
 * @returns {Promise<null | {body: string, fetchedAt: string|null, fresh: boolean}>}
 *
 * `fresh` is the caller's whole decision:
 *
 *   fresh === true    serve it. The cron wrote it inside this route's own
 *                     freshness window, so it is as current as an upstream
 *                     fetch would be and cost a single-digit-millisecond edge
 *                     read instead of a transatlantic round trip.
 *
 *   fresh === false   DO NOT SERVE IT YET. Something is wrong upstream of us
 *                     — the cron is behind, or dead. Go to upstream exactly as
 *                     if KV had missed, and keep this copy in hand as
 *                     last-good for when upstream fails too. A warm store is
 *                     not permission to stop checking; §5's rule is stale data
 *                     WITH a visible timestamp, and the timestamp only means
 *                     something if we tried to beat it first.
 *
 * ===> `fetchedAt` MEANS "WHEN DID WE LAST REACH UPSTREAM". <===
 * The writer re-stamps it every successful cycle, changed bytes or not
 * (worker/src/kv.js has the account). That is the same question this window
 * asks, and the same question the client's status strip asks of
 * `X-Landfall-Fetched-At` — so one field genuinely serves all three, and there
 * is deliberately no second "when did the content change" stamp. One was built
 * and removed the same day for having no reader.
 *
 * A stamp refreshed only on a content change is the wrong ruler and it fails
 * in both directions: a 6-hourly advisory against a 5-minute window is judged
 * stale ~98% of the time so the store gets bypassed, and a quiet ocean's
 * unchanging `{"activeStorms":[]}` reaches the client looking like ~72
 * consecutive failed refreshes. **A calm ocean is not an outage.**
 *
 * AN ENTRY WITH NO `fetchedAt` IS TREATED AS STALE, NOT AS FRESH. An unstamped
 * value cannot be aged, and defaulting an unknown age to "current" is the §5
 * failure this whole app is organised against — absence read as safety. The
 * only writer stamps every entry, so an unstamped one means something wrote
 * this namespace that should not have.
 */
export async function kvRead(env, path, freshSeconds) {
  const kv = kvBinding(env);
  if (!kv) return null;

  let got;
  try {
    got = await kv.getWithMetadata(kvKey(path), { type: 'text' });
  } catch {
    /* A KV read that throws is a miss. Never let the cache layer be the thing
     * that breaks a request — upstream is right there and still works. */
    return null;
  }
  if (got == null || got.value == null) return null;

  const fetchedAt = got.metadata && got.metadata.fetchedAt ? String(got.metadata.fetchedAt) : null;
  const stampedMs = fetchedAt ? Date.parse(fetchedAt) : NaN;
  const ageMs = Number.isFinite(stampedMs) ? Date.now() - stampedMs : NaN;

  /* A NEGATIVE AGE IS NOT FRESH EITHER. Clock skew between the Worker that
   * wrote and the colo that reads can put `fetchedAt` slightly in the future;
   * a small negative age is normal and harmless. A LARGE one means the stamp
   * is wrong, and a wrong stamp is exactly what must not be trusted. One
   * minute of tolerance covers skew without accepting a garbage timestamp. */
  const SKEW_TOLERANCE_MS = 60 * 1000;
  const fresh =
    Number.isFinite(ageMs) && ageMs > -SKEW_TOLERANCE_MS && ageMs < freshSeconds * 1000;

  return { body: got.value, fetchedAt, fresh };
}
