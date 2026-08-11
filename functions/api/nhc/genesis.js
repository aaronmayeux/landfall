/**
 * /api/nhc/genesis?part=areas — NHC's two- and seven-day outlook, relayed.
 * SPEC §45.
 *
 * THE QUESTION THIS ANSWERS IS THE ONE THE APP GETS ASKED MOST AND COULD NOT
 * ANSWER: where might the next one start, and when. Genesis is not forecastable
 * months out — seasonal outlooks say how many, never where. Inside seven days
 * it is, and NHC publishes it as a polygon with a percentage on it.
 *
 * SAME SERVICE THE CONE COMES FROM, DIFFERENT SERVICE OBJECT. `mapserver.js`
 * next door talks to `NHC_tropical_weather_summary` and filters by `binnumber`
 * — a genesis area has no bin, because it is not a storm and has no advisory.
 * So this is its own route rather than another mode on that one: bolting a
 * bin-less branch onto a route whose entire contract is "one filter mode, and
 * `all=1` must not come back" is how that route's open-query problem gets
 * reopened by accident.
 *
 * ONE PART TODAY: `part=areas`, layer 3, the polygons — each carrying BOTH
 * horizons, so the two-day and seven-day answers come from a single query.
 * The parameter exists rather than being hardcoded because layer 2 was meant
 * to be the second part and may yet be; see the note on `PARTS`.
 *
 * WHAT MAKES THIS DIFFERENT FROM EVERY OTHER RELAY HERE: AN EMPTY ANSWER IS
 * THE COMMON CASE AND IS FULLY MEANINGFUL. Most of the year NHC is watching
 * nothing, and `{"features":[]}` is that statement. It is cached on the normal
 * clock, not the short one — there is no publication gap to wait out, because
 * the outlook is a standing product that is always current. Compare
 * `mapserver.js`, where empty means "the geometry has not published yet" and
 * is held for five minutes precisely because it is expected to change.
 *
 * The CLIENT is what must not conflate the two: `none_matched` (answered, no
 * areas) and `unavailable` (did not answer) are different states in §45.5 and
 * `lib/genesis.js` keeps them apart.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED on purpose (§3). The numbers below mirror SPEC §4's cache
 * table and `CACHE.genesisFresh` in config/constants.js; if they change, they
 * change in both places on purpose.
 */

import { kvRead, isWarmRequest } from '../_kv-cache.js';
import { CACHE_PATH, CACHE_PATH_HEADER } from '../_cache-path.js';

const UPSTREAM =
  'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';

/* ===========================================================================
 * ==> THE MEMORY THAT MAKES THE HELD BRANCH WORK IS PER-DATACENTRE, AND THAT
 *     IS WHY THE FIX BELOW BARELY FIRED. <==
 *
 * MEASURED, on the archive branch. The held branch shipped at 02:48Z on
 * 2026-08-11. At 04:26Z — an hour and a half LATER, with NHC's own text
 * product still listing three Atlantic areas and one of them at 70% — this
 * route answered 42 bytes of empty FeatureCollection with no `X-Landfall-Held`
 * and no `X-Landfall-Stale` on it. A false all-clear, in production, after the
 * fix for false all-clears.
 *
 * Nothing was wrong with the logic. `caches.default` is ONE COPY PER COLO and
 * Cloudflare has 300+ of them, so "the last real answer" existed only in
 * datacentres that had recently served a real answer. Every genesis fetch in
 * the archive shows a live upstream timestamp, meaning that colo missed on
 * every single request — its memory was empty, so there was nothing to hold
 * and the emptiness passed through as truth. **With one user in one place,
 * most colos are cold most of the time.** A memory that is empty everywhere it
 * is asked is not a memory.
 *
 * So the memory is GLOBAL now. Two keys, warmed by the cron Worker:
 *
 *   nhc/genesis/areas            what the layer last said — including a
 *                                genuine all-clear, which is a real answer
 *   nhc/genesis/areas/last-good  the last answer that actually HAD areas
 *
 * ==> AND THE WORKER REFUSES TO WRITE EITHER WHILE WE ARE HOLDING. <== That
 * refusal is not tidiness, it is the whole clock. `worker/src/kv.js` re-stamps
 * `fetchedAt` on every cycle whether the bytes changed or not, so if a held
 * body were written back, the held answer would restamp itself as current
 * every five minutes, `ageMs` would never grow, and HELD_SECONDS would mean
 * "hold forever" — the app could never return to a true all-clear. Instead the
 * keys simply stop being written while upstream is empty, their age grows on
 * its own, and after one outlook cycle the hold lapses exactly as intended.
 * The gate is driven by the two headers below; `worker/src/sources.js` carries
 * the other half.
 * ======================================================================== */

/** The KV paths the cron warms this route under. `part` is a closed table
 *  (see PARTS), so nothing a caller types ever reaches a key.
 *  tools/test-kv-keys.mjs asserts the writer and this file agree. */
const kvPathFor = (part) => `nhc/genesis/${part}`;
const kvLastGoodPathFor = (part) => `nhc/genesis/${part}/last-good`;

/** How many areas are in the body being served, stated on the wire.
 *
 *  ==> IT EXISTS SO THE WRITER NEVER HAS TO PARSE THE PAYLOAD. <== The cron
 *  Worker's whole identity is "fetch a URL and store the bytes"; the moment it
 *  opens a FeatureCollection to decide whether this counts as a good answer,
 *  there are two implementations of that judgement on opposite sides of a
 *  deploy boundary, which is precisely the drift `worker/src/sources.js` was
 *  written to avoid. The route already knows the number. It says it.
 *
 *  DELIBERATELY NOT CALLED `X-Landfall-Empty`. That name belongs to a header
 *  this project once wrote and never read, and reusing it would make the
 *  backlog entry about it ambiguous forever. A count also answers more
 *  questions than a boolean, at the same price. */
const AREA_COUNT_HEADER = 'X-Landfall-Genesis-Areas';

/** The parts this route will fetch, and the layer each maps to. A closed
 *  table, so no caller text ever reaches a layer id or a cache key — the same
 *  rule `mapserver.js` applies to its bin.
 *
 *  ==> LAYER 2 IS NOT IN THIS TABLE, AND ITS ABSENCE IS DELIBERATE. <== It was
 *  going to be `anchors`, carrying NHC's own label points. Real bytes
 *  (2026-08-09) showed three points against five polygons, with attributes
 *  that match one polygon while sitting inside another — unmatchable, and a
 *  wrong match would print one area's probability on another area's shape.
 *  The label is drawn at our own centroid instead. Full measurement in
 *  `GENESIS.anchorLayer`'s note in config/constants.js. The archive still
 *  snapshots layer 2 as evidence; if NHC ever publishes one point per area,
 *  this is where the mode comes back, with fresh bytes behind it. */
const PARTS = {
  areas: 3, // Seven-Day: Potential Development Region (polygon)
};

/** Mirrors `CACHE.genesisFresh`. Comfortably under the 30-minute client poll,
 *  so a poll is never handed the copy it fetched last time. */
const FRESH_SECONDS = 15 * 60;

/** Serve-stale on upstream failure. The outlook republishes roughly 6-hourly,
 *  so 1.5x that is the same rule used everywhere else — and a six-hour-old
 *  watch area in the right ocean beats a blank layer under an all-clear (§5). */
const STALE_SECONDS = 9 * 60 * 60;

/**
 * ==> HOW LONG AN EMPTY ANSWER IS TREATED AS A GAP RATHER THAN AN ALL-CLEAR.
 * <== One outlook cycle. The Tropical Weather Outlook is issued every six
 * hours, so if the layer is still empty a full cycle after it had areas, a
 * forecaster has had a turn and published nothing, and the emptiness is real.
 *
 * MEASURED, NOT ASSUMED — 2026-08-11, and this constant exists because of it.
 * NHC's layer 3 went from six areas to `{"count":0}` between 23:41Z and 02:17Z
 * while NHC's OWN text product and public graphic both still listed three
 * Atlantic areas, one of them red. Landfall rendered that as "Nothing being
 * watched": a false all-clear, in season, produced by a source that was up,
 * answering 200, and simply wrong.
 *
 * The archive's 72-hour window across that period never once shows the layer
 * legitimately dropping to zero — it ran 3, 5, 6 areas continuously for 33
 * hours and then fell off a cliff in a single step. A real all-clear arrives
 * by areas expiring one at a time.
 *
 * THE COST OF THIS CONSTANT, STATED PLAINLY: for up to six hours after NHC
 * genuinely clears the board, the app shows the last areas labelled with their
 * age instead of a clean all-clear. That is the direction to be wrong in — §5
 * ranks a false all-clear as the one failure worth paying to avoid.
 */
const HELD_SECONDS = 6 * 60 * 60;

/** NOAA servers 403 requests with no User-Agent. Identify ourselves plainly. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/* `no-store` is aimed at the BROWSER, not at Cloudflare — the colo copies are
 * written by `cache.put()` below with their own `s-maxage`. This route's URL
 * names no advisory and no bin, so it is byte-identical forever; without an
 * explicit instruction a browser invents a lifetime and answers from disk.
 * That failure is silent and looks like fresh data. See mapserver.js. */
const baseHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  ...extra,
});

const errorJson = (obj, status) =>
  new Response(JSON.stringify(obj), { status, headers: baseHeaders() });

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const part = String(url.searchParams.get('part') || 'areas').toLowerCase();

  if (!Object.prototype.hasOwnProperty.call(PARTS, part)) {
    /* A 400, not a 502: a bad request, not a dead source. data/relay.js only
     * retries 5xx (§4), so this correctly never retries. */
    return errorJson(
      { error: 'bad_genesis_part', detail: 'part must be areas' },
      400
    );
  }

  const layer = PARTS[part];

  /* `where=1=1` IS SAFE HERE AND IS NOT THE THING mapserver.js FORBIDS. That
   * route refuses an unfiltered query because its upstream holds every active
   * storm and one storm's panel would get three storms' cones. This layer
   * holds nothing but genesis areas, there is no per-feature owner to filter
   * by, and "all of them" is precisely the question. The clause is built here
   * and never accepted from a caller either way. */
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  });

  const cache = caches.default;
  const freshKey = new Request(`https://landfall-relay.internal/nhc/genesis/${part}/fresh`);
  const lastGoodKey = new Request(`https://landfall-relay.internal/nhc/genesis/${part}/last-good`);

  /* The cron Worker skips every cache so a warm cycle actually reaches NHC
   * rather than re-confirming its own previous answer forever. THIS ROUTE HAD
   * NO SUCH BRANCH, which is why it could not be warmed at all: an ordinary
   * request is answered from the colo slot, so the Worker would have stored
   * what it already stored and the loop would have looked healthy over a store
   * that never tracked the world. The held branch below still runs on a warm
   * request — that is how the Worker learns we are holding, and the header it
   * reads is what stops it writing. */
  const warming = isWarmRequest(context.request, context.env);

  /* Rebuilt, never handed back as stored — a stored copy carries `s-maxage`,
   * which Cloudflare's own edge then honours and serves without this function
   * running at all. Measured live 2026-08-07, SPEC-OPS §17.7. */
  const hit = warming ? null : await cache.match(freshKey);
  if (hit) {
    return new Response(await hit.text(), {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Genesis-Part': part,
        /* ==> THE HELD MARKERS RIDE THE CACHE HIT TOO. <== A held answer is
         * stored under this key like any other, and without these two lines
         * the first request after upstream went empty said "these areas are
         * from an hour ago" and the next fifteen minutes of requests served
         * the same body claiming to be current. A caveat that survives one
         * request and then evaporates is worse than no caveat. */
        ...(hit.headers.get('X-Landfall-Stale') === 'true'
          ? {
              'X-Landfall-Stale': 'true',
              'X-Landfall-Held': hit.headers.get('X-Landfall-Held') || '',
            }
          : {}),
        [AREA_COUNT_HEADER]: hit.headers.get(AREA_COUNT_HEADER) || '',
        [CACHE_PATH_HEADER]: CACHE_PATH.FRESH,
      }),
    });
  }

  /* L2, global. Written by the cron Worker, never by us — §17 Pass B's
   * load-bearing rule, and `functions/api/_kv-cache.js` argues it at length.
   *
   * A HELD BODY NEVER REACHES THIS KEY, so anything read here is an answer NHC
   * actually gave. See the block at the top of this file for why that matters:
   * a held body warmed back into KV would restamp its own age every five
   * minutes and the hold would never lapse. */
  const warm = warming ? null : await kvRead(context.env, kvPathFor(part), FRESH_SECONDS);
  if (warm && warm.fresh) {
    const headers = baseHeaders({
      'X-Landfall-Fetched-At': warm.fetchedAt || '',
      'X-Landfall-Genesis-Part': part,
      [CACHE_PATH_HEADER]: CACHE_PATH.KV,
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
  try {
    const r = await fetch(`${UPSTREAM}/${layer}/query?${params}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
    const body = await r.text();

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error('upstream returned non-JSON');
    }

    const areaCount = Array.isArray(parsed?.features) ? parsed.features.length : 0;

    const headers = baseHeaders({
      'X-Landfall-Fetched-At': new Date().toISOString(),
      'X-Landfall-Genesis-Part': part,
      [AREA_COUNT_HEADER]: String(areaCount),
      [CACHE_PATH_HEADER]: CACHE_PATH.UPSTREAM,
    });

    /* ArcGIS reports failure as HTTP 200 with an `error` body. Forwarded
     * verbatim so the client can mark this `unavailable` rather than empty —
     * which for THIS layer is the difference between "we could not ask" and
     * "nothing is being watched", the exact confusion §45.5 exists to stop.
     * Never cached: a cached rejection is hours of a false all-clear. */
    if (parsed && parsed.error) {
      return new Response(body, {
        headers: baseHeaders({ 'X-Landfall-Upstream': 'arcgis-error' }),
      });
    }

    if (!(parsed && parsed.type === 'FeatureCollection')) {
      return new Response(body, {
        headers: baseHeaders({ 'X-Landfall-Upstream': 'unexpected-shape' }),
      });
    }

    /* AN EMPTY OUTLOOK IS CACHED LIKE ANY OTHER ANSWER, AND IT IS STILL
     * REFUSED AS LAST-GOOD — so `lastGoodKey` only ever holds a response that
     * actually had areas in it. That is what makes the branch below possible. */
    const empty = !(Array.isArray(parsed.features) && parsed.features.length);

    /* ==> UPSTREAM ANSWERED, AND ANSWERED NOTHING, AND WE SAW AREAS RECENTLY.
     * <== This is the branch that exists because 2026-08-11 happened. See
     * HELD_SECONDS above for the measurement.
     *
     * An empty FeatureCollection is UNSTAMPED — no `idp_source`, no
     * `idp_filedate`, nothing — so from the bytes alone "NHC is watching
     * nothing" and "NHC's layer is broken" are IDENTICAL. Nobody downstream
     * can tell them apart, because there is nothing in the payload to tell
     * them apart WITH. The only thing that distinguishes them is what we saw
     * an hour ago, and this route is the one place that remembers.
     *
     * So: inside one outlook cycle of a real answer, an empty one is treated
     * as a gap and the last real answer is served with its own age and a
     * marker saying so. Past that, the emptiness is believed and passes
     * straight through as a genuine all-clear.
     *
     * IT IS CACHED AS THE FRESH COPY, not returned around the cache. Otherwise
     * every poll for the next fifteen minutes re-queries upstream, and worse,
     * the answer would flip between held and empty depending on which copy
     * answered. */
    if (empty) {
      /* ==> TWO MEMORIES, AND THE NEWER ONE WINS. <==
       *
       * The colo slot is free, is already here, and in a datacentre that has
       * been serving real answers it is the freshest thing available. It is
       * also empty in most of the 300+ colos most of the time, which is the
       * whole reason the KV copy exists (see the top of this file).
       *
       * Neither is a superset of the other, so both are read and the newer
       * stamp is used. Reading only KV would throw away a colo answer that is
       * minutes newer than the last warm cycle; reading only the colo is what
       * shipped a false all-clear ninety minutes after the fix for false
       * all-clears.
       *
       * `HELD_SECONDS` is then applied to whichever won, exactly as before —
       * one outlook cycle, measured, and the branch below is unchanged. */
      const coloHeld = await cache.match(lastGoodKey);
      const coloAt = coloHeld ? coloHeld.headers.get('X-Landfall-Fetched-At') : null;

      const kvHeld = await kvRead(context.env, kvLastGoodPathFor(part), HELD_SECONDS);
      const kvAt = kvHeld ? kvHeld.fetchedAt : null;

      const coloMs = coloAt ? Date.parse(coloAt) : NaN;
      const kvMs = kvAt ? Date.parse(kvAt) : NaN;
      /* An UNSTAMPED memory is not usable — its age cannot be computed, and
       * `_kv-cache.js` already refuses to call an unstamped entry fresh for
       * the same reason. Defaulting an unknown age to "recent" is the §5
       * failure this whole route is organised against. */
      const useKv =
        Number.isFinite(kvMs) && (!Number.isFinite(coloMs) || kvMs > coloMs);

      const held = useKv ? kvHeld : coloHeld;
      const heldAt = useKv ? kvAt : coloAt;
      const ageMs = heldAt ? Date.now() - Date.parse(heldAt) : Infinity;

      if (held && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < HELD_SECONDS * 1000) {
        const heldBody = useKv ? held.body : await held.text();
        /* Counted off the body rather than carried in the memory's own headers,
         * because the two memories store their metadata differently — a colo
         * Response has headers, a KV entry has `fetchedAt` and nothing else.
         * One number, derived one way, whichever side won. */
        let heldCount = 0;
        try {
          const hp = JSON.parse(heldBody);
          heldCount = Array.isArray(hp?.features) ? hp.features.length : 0;
        } catch {
          /* A memory that will not parse is not a memory worth counting. It is
           * still served — it was a real answer once — and the count says 0,
           * which is the honest thing to say about bytes we cannot read. */
        }
        const heldHeaders = baseHeaders({
          /* THE ORIGINAL FETCH TIME, NOT NOW. Every figure in this body was
           * true then, and the client's whole ability to say "from 3 hrs ago"
           * rests on this line being the old timestamp. */
          'X-Landfall-Fetched-At': heldAt,
          'X-Landfall-Genesis-Part': part,
          'X-Landfall-Stale': 'true',
          'X-Landfall-Held': 'upstream-empty',
          /* THE COUNT DESCRIBES THE BODY BEING SENT, NOT THE ONE UPSTREAM GAVE.
           * Upstream gave zero; what is going out is the remembered answer, and
           * every other reader of this header — the Worker's write gate, the
           * inspect route, whoever is staring at a curl — is asking about the
           * bytes in their hand. `X-Landfall-Held` is what says upstream was
           * empty, and it is on this response for exactly that reason. */
          [AREA_COUNT_HEADER]: String(heldCount),
          [CACHE_PATH_HEADER]: useKv ? CACHE_PATH.KV_STALE : CACHE_PATH.LAST_GOOD,
        });
        context.waitUntil(
          cache.put(
            freshKey,
            new Response(heldBody, {
              headers: { ...heldHeaders, 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
            })
          )
        );
        return new Response(heldBody, { headers: heldHeaders });
      }
      /* No memory, or the memory is older than a full outlook cycle. The
       * empty answer is the honest one and falls through to be served and
       * cached normally. */
    }

    const writes = [
      cache.put(
        freshKey,
        new Response(body, {
          headers: { ...headers, 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
        })
      ),
    ];
    if (!empty) {
      writes.push(
        cache.put(
          lastGoodKey,
          new Response(body, {
            headers: { ...headers, 'Cache-Control': `s-maxage=${STALE_SECONDS}` },
          })
        )
      );
    }
    context.waitUntil(Promise.all(writes));

    return new Response(body, { headers });
  } catch (e) {
    upstreamError = e;
  }

  const stale = await cache.match(lastGoodKey);
  if (stale) {
    return new Response(await stale.text(), {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Genesis-Part': part,
        'X-Landfall-Stale': 'true',
        [AREA_COUNT_HEADER]: stale.headers.get(AREA_COUNT_HEADER) || '',
        [CACHE_PATH_HEADER]: CACHE_PATH.LAST_GOOD,
      }),
    });
  }

  return errorJson(
    {
      error: 'genesis_unreachable',
      detail: String((upstreamError && upstreamError.message) || upstreamError),
    },
    502
  );
}
