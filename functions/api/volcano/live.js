/**
 * /api/volcano/live — what is erupting on Earth right now, from three feeds.
 *
 * SIX UPSTREAM FETCHES BEHIND ONE ROUTE. Cloudflare's free-tier subrequest cap
 * is 50, so six is not close to anything.
 *
 *   1    bom.gov.au Volc_ash_recent.shtml   EIGHT VAAC centres, 7 days, full text
 *   2-4  tgftp fvps01/02/04.nzkl            WELLINGTON — the centre BoM omits
 *   5    volcano.si.edu WeeklyVolcanoRSS     global weekly, all activity types
 *   6    volcanoes.usgs.gov HANS             US alert levels
 *
 * WHY THIS IS ONE ROUTE AND NOT THREE, when §4.3 says keep the relay dumb: the
 * NHC/GDACS pattern relays per source and merges in the browser because those
 * are two views of the SAME storms. These are three feeds with three different
 * definitions of "active" that need dedupe, close-detection and an age filter
 * before any of it means anything — real logic, which belongs in one place and
 * must not run three times on a phone at boot. The BoM page alone carries ~83
 * advisories; shipping that to a handset to be parsed there would be the
 * performance lens losing an argument it should win. The cost is one failure
 * surface, and it is paid for by PER-SOURCE STATE IN THE PAYLOAD (_union.js).
 *
 * ==> TRAP 1: CACHE-BUST EVERY UPSTREAM FETCH. <== Measured on three
 * independent government weather hosts 2026-07-30. A bare fetch of the BoM
 * page returned advisories 29 DAYS OLD; the same URL with a cache-busting
 * parameter returned one 83 minutes old. Same failure on ospo.noaa.gov (6 days)
 * and JMA (24 days). **Without this the relay serves month-old ash during an
 * eruption and every health check passes** — a §5 silence bug with a plausible
 * face on it.
 *
 * ==> TRAP 2: THE WEEKLY RSS NEEDS A BROWSER-SHAPED User-Agent. <== A bare
 * server fetch gets 403. This is the original reason this layer is a relay at
 * all, and it is the same reason /api/jtwc/warning sends a UA.
 *
 * ==> TRAP 3: HANS MUST NOT BE CACHE-BUSTED WITH A QUERY PARAMETER. <== It
 * routes on the path, so `?cb=...` becomes part of the action name and the
 * service answers **HTTP 200 with an error body** — the failure shape that
 * looks exactly like a healthy fetch of an empty, calm United States. Header
 * only, and `_union.js` refuses a non-array body outright.
 *
 * NO KV WARM CACHE ON THIS ROUTE, DELIBERATELY. Every other relay route reads
 * the cron Worker's KV copy (§17 Pass B), and this one does not: the cron runs
 * every five minutes, and warming six government weather hosts on that cadence
 * is ~1,700 fetches a day for data that changes a few times a day. Ash
 * advisories land in hours. Colo cache plus serve-stale plus upstream is the
 * right shape here, and adding a warm read that nothing writes would be dead
 * code pretending to be an optimisation. Revisit if this layer ever gets
 * enough traffic for the per-colo miss rate to matter.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED (§3) apart from its two siblings under this directory. The
 * VOLCANO tuning block is mirrored below rather than imported, and
 * tools/test-vaa.mjs asserts the mirror agrees with config/constants.js —
 * same arrangement, and same reason, as worker/src/sources.js and the KV keys.
 */

import { parseStream, stripToText } from './_vaa.js';
import { buildPayload, parseWeekly, parseAlerts } from './_union.js';

/**
 * ==> A MIRROR OF config/constants.js's VOLCANO BLOCK, AND THE MIRROR IS
 * ASSERTED. <== Pages Functions cannot import from the app (§3), so the
 * alternative to duplicating these five numbers is hardcoding them at the
 * three call sites, which is the same duplication with nowhere to check it.
 * `tools/test-vaa.mjs` reads both files and fails if they disagree — the
 * arrangement `tools/test-kv-keys.mjs` already uses for the KV key shapes.
 * **If you change a number here, change it there.**
 */
const VOLCANO = Object.freeze({
  ash: Object.freeze({
    freshSeconds: 30 * 60,
    staleSeconds: 6 * 60 * 60,
    advisoryMaxAgeHours: 24,
    exerciseStatus: Object.freeze(['EXER', 'TEST']),
    flightLevelToFeet: 100,
  }),
  alerts: Object.freeze({ freshSeconds: 15 * 60, staleSeconds: 6 * 60 * 60 }),
  weekly: Object.freeze({ freshSeconds: 6 * 60 * 60, staleSeconds: 10 * 24 * 60 * 60 }),
  state: Object.freeze({
    ok: 'ok',
    stale: 'stale',
    clear: 'clear',
    unavailable: 'unavailable',
  }),
});

const UPSTREAM = Object.freeze({
  vaacRecent: 'https://www.bom.gov.au/products/Volc_ash_recent.shtml',
  vaacWellington: Object.freeze([
    'https://tgftp.nws.noaa.gov/data/raw/fv/fvps01.nzkl..txt',
    'https://tgftp.nws.noaa.gov/data/raw/fv/fvps02.nzkl..txt',
    'https://tgftp.nws.noaa.gov/data/raw/fv/fvps04.nzkl..txt',
  ]),
  weekly: 'https://volcano.si.edu/news/WeeklyVolcanoRSS.xml',
  alerts: 'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes',
});

/** Our own identity, as on every other relay route. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/**
 * ==> AND THE ONE UA THAT IS NOT OURS. <== volcano.si.edu answers 403 to a
 * bare server fetch and 200 to a browser-shaped one. Sending a browser string
 * is not something to do casually — it is a claim about what we are — so it is
 * confined to the single host that requires it, and the honest identifier is
 * appended rather than hidden, so a Smithsonian log reader can still see who
 * this is and where to complain.
 */
const WEEKLY_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 ' +
  'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** Per-fetch timeout. A single slow government host must not hold the whole
 *  route open — the other five channels are still worth serving, and a
 *  channel that times out becomes `unavailable`, which is a real answer. */
const FETCH_TIMEOUT_MS = 8000;

/** The freshness window of the ROUTE is the tightest of the three channels.
 *  Serving a 30-minute-old ash reading is the point; serving a 30-minute-old
 *  weekly report costs nothing because it changes on Thursdays. */
const FRESH_SECONDS = VOLCANO.ash.freshSeconds;
const STALE_SECONDS = VOLCANO.ash.staleSeconds;

const jsonHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});

/** Cache-busting parameter. Time-based, at the freshness granularity that
 *  matters — a value that changed per request would make the colo cache
 *  useless, and a value that never changed would reintroduce the trap. */
const bust = (url, nowMs) => {
  const u = new URL(url);
  u.searchParams.set('cb', String(Math.floor(nowMs / 1000)));
  return u.toString();
};

/**
 * One upstream fetch. Never throws: returns `{ok: false, error}` instead,
 * because a dead channel is a REPORTABLE STATE and not an exception — the
 * whole design is that two live channels still reach the client while the
 * third is down (§5, "one source down must not blind the other").
 */
async function pull(url, { headers = {}, bustQuery = true, nowMs, as = 'text' } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(bustQuery ? bust(url, nowMs) : url, {
      signal: ctl.signal,
      headers: {
        'User-Agent': USER_AGENT,
        /* Belt and braces with the query parameter. Government weather hosts
         * sit behind caches that honour one, the other, or neither. */
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        ...headers,
      },
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    if (as === 'json') {
      /* A JSON body that will not parse is an upstream fault, and it must not
       * become an empty result. */
      try {
        return { ok: true, json: await r.json() };
      } catch {
        return { ok: false, error: 'body is not JSON' };
      }
    }
    return { ok: true, text: await r.text() };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'timeout' : 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const freshKey = new Request('https://landfall-relay.internal/volcano/live/fresh');
  const lastGoodKey = new Request('https://landfall-relay.internal/volcano/live/last-good');

  const hit = await cache.match(freshKey);
  if (hit) return hit;

  const nowMs = Date.now();

  /* ==> ALL SIX IN PARALLEL, AND `allSettled` IS THE WHOLE POINT. <== One
   * unreachable host must cost the other five nothing. `pull()` already
   * refuses to throw, so a rejection here would mean a bug in this file
   * rather than an upstream failure — it is still handled, because the
   * alternative to handling it is a 500 that takes three healthy channels
   * down with it. */
  const [bom, w1, w2, w3, weeklyRes, alertsRes] = await Promise.all([
    pull(UPSTREAM.vaacRecent, { nowMs }),
    ...UPSTREAM.vaacWellington.map((u) => pull(u, { nowMs })),
    pull(UPSTREAM.weekly, { nowMs, headers: { 'User-Agent': WEEKLY_USER_AGENT } }),
    /* No query parameter — see TRAP 3 in the header. */
    pull(UPSTREAM.alerts, { nowMs, bustQuery: false, as: 'json' }),
  ]);

  /* --- the ash channel --------------------------------------------------
   * BoM and the Wellington slots are ONE channel with two transports, not two
   * channels. They overlap on purpose (BoM has seven days of history; the raw
   * slots are latest-only and cover the centre BoM omits), and the dedupe on
   * GVP-number-plus-DTG in _vaa.js is what makes reading both safe.
   *
   * ==> THE CHANNEL SURVIVES BoM BEING DOWN, AND THAT IS NOT COSMETIC. <==
   * Ambae is inside Wellington's area and is one of the volcanoes with live
   * activity right now. If BoM were the only transport and it failed, the ash
   * channel would go `unavailable` for the whole planet; if Wellington's slots
   * are the only ones answering, we still see Vanuatu. Any one of the four
   * answering is a live channel. */
  const wellington = [w1, w2, w3];
  const ashParts = [];
  if (bom.ok) ashParts.push(stripToText(bom.text));
  for (const w of wellington) if (w.ok) ashParts.push(w.text);

  const ashTransportOk = bom.ok || wellington.some((w) => w.ok);
  const ashChannel = ashTransportOk
    ? {
        ok: true,
        fetchedAt: new Date(nowMs).toISOString(),
        parsed: parseStream(ashParts.join('\n'), {
          exerciseStatus: VOLCANO.ash.exerciseStatus,
          flightLevelToFeet: VOLCANO.ash.flightLevelToFeet,
        }),
        /** Which transports answered, ==> AND WHY THE FAILED ONES DID NOT.
         *  <== The first version of this carried booleans only, and the first
         *  live deploy came back `bom: false` with the reason nowhere in the
         *  payload — so the ash channel was silently running on three small
         *  Pacific bulletin slots while reporting `state: ok`, and there was
         *  no way to tell from the outside whether BoM was 403ing, timing out
         *  or blocking the datacenter. That is this project's own §5 rule
         *  ("name every soft-fail; errors surface near their source") broken
         *  by the file that exists to enforce it. The error string is small
         *  and it is the difference between a diagnosable degradation and a
         *  mystery.
         *
         *  A CHANNEL RUNNING ON WELLINGTON ALONE COVERS VANUATU, TONGA AND
         *  THE KERMADECS AND NOTHING ELSE. It is `ok` because it is genuinely
         *  answering, and it is also 3% of the world — which is exactly why
         *  `centres` sits beside it. */
        transports: {
          bom: bom.ok,
          bomError: bom.ok ? null : String(bom.error || 'unknown'),
          wellington: wellington.map((w) => w.ok),
          wellingtonErrors: wellington.map((w) => (w.ok ? null : String(w.error || 'unknown'))),
        },
      }
    : { ok: false, error: `ash transports down (bom: ${bom.error})` };

  const weeklyChannel = weeklyRes.ok
    ? { ok: true, fetchedAt: new Date(nowMs).toISOString(), parsed: parseWeekly(weeklyRes.text) }
    : { ok: false, error: weeklyRes.error };

  const parsedAlerts = alertsRes.ok ? parseAlerts(alertsRes.json) : null;
  const alertsChannel = parsedAlerts
    ? { ok: true, fetchedAt: new Date(nowMs).toISOString(), parsed: parsedAlerts }
    : {
        ok: false,
        /* A 200 carrying `{"error": ...}` lands here, not in the empty case.
         * `parseAlerts` returning null IS that detection. */
        error: alertsRes.ok ? 'HANS answered 200 with a non-array body' : alertsRes.error,
      };

  const payload = buildPayload(
    { ash: ashChannel, weekly: weeklyChannel, alerts: alertsChannel },
    VOLCANO,
    nowMs
  );
  if (ashChannel.ok) payload.sources.ash.transports = ashChannel.transports;

  const body = JSON.stringify(payload);
  const anyChannelUp = ashChannel.ok || weeklyChannel.ok || alertsChannel.ok;

  /* ==> A PAYLOAD WITH EVERY CHANNEL DOWN IS NEVER CACHED AS LAST-GOOD. <==
   * Caching it would mean serving "everything is unavailable" for six hours
   * after the world came back, and — worse — it would overwrite a last-good
   * copy that still had real advisories in it. Stale data with a visible
   * timestamp beats a blank screen (§5); stale data with three dead channels
   * in it beats nothing at all. */
  const headers = jsonHeaders({ 'X-Landfall-Fetched-At': payload.fetchedAt });

  if (anyChannelUp) {
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
  }

  /* Everything is down. Serve the last good copy, FLAGGED, so the client can
   * say "this is from 40 minutes ago" instead of "there are no volcanoes". */
  const stale = await cache.match(lastGoodKey);
  if (stale) {
    const staleBody = await stale.text();
    return new Response(staleBody, {
      headers: jsonHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Stale': 'true',
      }),
    });
  }

  /* No upstream, no last-good. ==> STILL RETURN THE PAYLOAD, WITH ITS THREE
   * `unavailable` CHANNELS, AND STILL 200. <== A 502 with an error body would
   * tell the client "the relay failed" and nothing about WHICH source failed,
   * and the client would have to invent the three states this payload already
   * states correctly. There is no all-clear anywhere in it. */
  return new Response(body, {
    headers: jsonHeaders({
      'X-Landfall-Fetched-At': payload.fetchedAt,
      'X-Landfall-All-Sources-Down': 'true',
    }),
  });
}
