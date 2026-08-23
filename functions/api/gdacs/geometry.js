/**
 * /api/gdacs/geometry — the relay's second job (SPEC §4).
 *
 * WHY THIS EXISTS, and it is NOT a CORS problem. GDACS sends a CORS header and
 * the browser can fetch it directly — which is exactly what the app did until
 * now. The reason is SIZE and DISTANCE: a per-event payload is 180-400 kB from
 * a European server, pulled fresh on every load, while the NHC storms beside it
 * come back from small US-hosted queries almost instantly. On glass that read
 * as "the GDACS storm loads slow." SPEC §4 has specified this cache since the
 * beginning and listed its TTLs in the cache table; the route was simply never
 * built, and three constants in config/constants.js were wired to nothing.
 *
 * Forward-and-cache ONLY, like every relay route. No parsing, no merging, no
 * per-storm logic — the app merges and parses client-side so the fiddly rules
 * stay debuggable on a phone.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED on purpose — importing config/constants.js would couple a
 * static site to a bundler step we do not have. The numbers below mirror
 * SPEC §4's cache table; that table is the truth.
 *
 * THE URL IS PASSED IN, NOT CONSTRUCTED — and that needs a guard.
 * SPEC §4: every GDACS event publishes its own `url.geometry`, and reading it
 * off the feed is strictly better than assembling our own (if GDACS moves the
 * endpoint, a published link keeps working while a constructed one breaks
 * silently). So the client hands us the published URL. Accepting an arbitrary
 * URL and fetching it server-side would make this an OPEN PROXY that anyone
 * could point at anything, so the URL is validated hard below: https only,
 * host exactly www.gdacs.org, path exactly the geometry endpoint. Anything
 * else is refused without being fetched.
 */

import { kvRead, isWarmRequest } from '../_kv-cache.js';
import { CACHE_PATH } from '../_cache-path.js';

/** SPEC §4 cache table: GDACS geometry fresh for 30 min. */
const FRESH_SECONDS = 30 * 60;

/** How long a last-good copy is kept and may be served, flagged stale.
 *
 *  SPEC §4's prose is the authority here: "A six-hour-old cone is roughly
 *  right and infinitely better than a 90-second spinner on a phone. Past
 *  twelve hours it is genuinely misleading — drop it and show `unavailable`
 *  rather than a stale shape." Twelve hours is therefore the serve ceiling,
 *  and past it the client gets an honest failure instead of an old shape. */
const STALE_SECONDS = 12 * 60 * 60;

/**
 * How long this route will wait on gdacs.org before giving up on it.
 *
 * ==> WITHOUT THIS, EVERY FALLBACK BELOW IS UNREACHABLE. <== Measured on
 * 2026-08-23. GDACS was intermittently taking longer than thirty seconds to
 * answer; this route held the line to Europe with no cap, and the CLIENT's own
 * `POLL.fetchTimeout` (30 s, config/constants.js) fired first. The phone logged
 * `storm geometry failed: timeout`, drew nothing for SAUDEL-26 and NARRA-26,
 * and every non-US storm on the globe lost its cone, its track and its wind
 * field — while the last-good copy this function already knows how to serve sat
 * one `cache.match` away, in code that could never run because nobody was still
 * listening when execution reached it. A safety net below a floor nobody falls
 * through is not a safety net.
 *
 * ==> IT IS THE SAME BUG AS DOLPHIN-26, ON THE ROUTE THAT DID NOT GET THE FIX.
 * <== SPEC-DATA §4 records the 2026-08-01 outage: an uncached GDACS trip
 * measured ~20 s against a 20 s client abort, and a Super Typhoon was missing
 * from a hurricane tracker while every layer of the cache worked as designed.
 * That fix went into `gdacs/events.js` and `nhc/storms.js` — the two STORM
 * LISTS — under the parity rule that no data behaviour is finished until both
 * sources have it. The rule was read as being about SOURCES; this is a third
 * route, on a source that already had it, and it was missed. The shapes are as
 * load-bearing as the list: a storm you can see in the list and cannot see on
 * the map is not a storm this app has told you about.
 *
 * TEN SECONDS, AND IT IS `gdacs/events.js`'s NUMBER RATHER THAN A NEW ONE —
 * Aaron's stated ceiling for how long a storm may take to appear. Two files
 * cannot import one constant here (Pages Functions, no bundler), so this
 * mirrors that value by hand and says so, exactly as the cache numbers above
 * mirror SPEC §4's table.
 *
 * ==> RAISING THE CLIENT'S PATIENCE IS THE WRONG FIX AND THE CONSTANT SAYS SO.
 * <== `POLL.fetchTimeout`'s own comment: "If a feed is ever seen reaching 30 s,
 * raising this again is the wrong move: it means a route lost its cache, and
 * the route is where to look." This is the route.
 */
const UPSTREAM_BUDGET_MS = 10 * 1000;

/** Identify the app honestly to a public-good endpoint (SPEC §15 scale pass). */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** The ONLY host and path this route will fetch. */
const ALLOWED_HOST = 'www.gdacs.org';
const ALLOWED_PATH = '/gdacsapi/api/polygons/getgeometry';

const baseHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});

/**
 * Validate the caller's URL and return it, or null.
 *
 * Fails CLOSED on anything unexpected — a malformed URL, a different host, a
 * different path, a non-https scheme. Returning null means "refused", and the
 * caller answers 400 without ever making a request.
 */
function safeUpstream(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.hostname !== ALLOWED_HOST) return null;
  if (u.pathname !== ALLOWED_PATH) return null;
  return u.toString();
}

export async function onRequestGet(context) {
  const upstream = safeUpstream(new URL(context.request.url).searchParams.get('url'));
  if (!upstream) {
    return new Response(
      JSON.stringify({ error: 'gdacs_url_rejected' }),
      { status: 400, headers: baseHeaders() }
    );
  }

  const cache = caches.default;

  /* Keyed on the validated upstream URL, so eventid and episodeid key the
   * cache for free — a new episode is a new URL and self-invalidates, exactly
   * like the client's per-(storm, advisory) key. Synthetic hosts name the
   * slot; nothing routes to them. */
  const slot = encodeURIComponent(upstream);
  const freshKey = new Request(`https://landfall-relay.internal/gdacs/geometry/fresh/${slot}`);
  const lastGoodKey = new Request(`https://landfall-relay.internal/gdacs/geometry/last-good/${slot}`);

  /* SPEC §17 Pass B. The KV path is keyed on the SAME normalised upstream URL
   * as the colo slot above — worker/src/sources.js runs the published GDACS
   * link through `new URL()` exactly as safeUpstream() does here, because two
   * spellings of the same URL are two different keys and the reader would
   * miss every entry the writer creates. */
  const warming = isWarmRequest(context.request, context.env);
  const kvPath = `gdacs/geometry/${slot}`;

  /* REBUILT, NEVER RETURNED AS STORED. The slot Response carries
   * `Cache-Control: s-maxage=...` for `caches.default`'s benefit; handing it
   * back verbatim publishes that to the internet and Cloudflare's edge caches
   * the whole response, stamp included, for another full window. Measured on
   * the NHC storm list 2026-08-07 — that file carries the account. */
  const hit = warming ? null : await cache.match(freshKey);
  if (hit) {
    return new Response(await hit.text(), {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Cache': CACHE_PATH.FRESH,
      }),
    });
  }

  const warm = warming ? null : await kvRead(context.env, kvPath, FRESH_SECONDS);
  if (warm && warm.fresh) {
    const headers = baseHeaders({
      'X-Landfall-Fetched-At': warm.fetchedAt || '',
      'X-Landfall-Cache': CACHE_PATH.KV,
    });
    context.waitUntil(
      cache.put(
        freshKey,
        new Response(warm.body, {
          headers: { ...headers, 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
        })
      )
    );
    return new Response(warm.body, { headers });
  }

  let upstreamError;
  /* ==> THE ABORT IS SET UP OUTSIDE THE `try` AND CLEARED IN `finally`. <== A
   * timer left running holds the invocation alive after the response has been
   * returned, and a controller created inside the `try` cannot be cleaned up by
   * a `catch` that may run before it exists. Same shape as
   * `gdacs/events.js`'s `pullUpstream()`, deliberately — two spellings of one
   * mechanism is how the two drift apart. */
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_BUDGET_MS);
  try {
    const r = await fetch(upstream, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
    const body = await r.text();

    /* Refuse to cache non-JSON. An upstream error page cached for 30 minutes
     * would be served as "storm geometry" and fail somewhere far away from
     * here. Parse to check, forward as text. */
    JSON.parse(body);

    const fetchedAt = new Date().toISOString();
    const headers = baseHeaders({
      'X-Landfall-Fetched-At': fetchedAt,
      'X-Landfall-Cache': CACHE_PATH.UPSTREAM,
    });

    context.waitUntil(
      Promise.all([
        cache.put(
          freshKey,
          new Response(body, {
            headers: { ...headers, 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
          })
        ),
        cache.put(
          lastGoodKey,
          new Response(body, {
            headers: { ...headers, 'Cache-Control': `s-maxage=${STALE_SECONDS}` },
          })
        ),
      ])
    );

    return new Response(body, { headers });
  } catch (e) {
    upstreamError = e;
  } finally {
    clearTimeout(timer);
  }

  /* Upstream failed. Serve last-good flagged stale — the client shows it with
   * its age (SPEC §5: stale + visible timestamp beats a blank screen). Past
   * STALE_SECONDS the entry is gone from the cache entirely, so this misses
   * and the client gets the honest failure below. */
  const stale = await cache.match(lastGoodKey);
  if (stale) {
    const body = await stale.text();
    return new Response(body, {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Stale': 'true',
        'X-Landfall-Cache': CACHE_PATH.LAST_GOOD,
      }),
    });
  }

  /* Then the warm copy declined above as too old. §4's prose sets the ceiling
   * and it still governs: a six-hour-old cone is roughly right and infinitely
   * better than a spinner; past twelve hours it is genuinely misleading. The
   * cron refreshes every five minutes, so a warm copy this route rejected as
   * unfresh is minutes old in practice — an outage, not a relic. */
  if (warm) {
    return new Response(warm.body, {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': warm.fetchedAt || '',
        'X-Landfall-Stale': 'true',
        'X-Landfall-Cache': CACHE_PATH.KV_STALE,
      }),
    });
  }

  /* Nothing cached and upstream down: an honest 502. The client turns this
   * into "GDACS is not responding" — never raw text like this (SPEC §5). */
  return new Response(
    JSON.stringify({
      error: 'gdacs_unreachable',
      detail: String(upstreamError?.message || upstreamError),
    }),
    { status: 502, headers: baseHeaders() }
  );
}
