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
import { kmlFromKmz } from './_kmz.js';
import { parseGtwoKml, toAreaCollection } from './_gtwo-kml.js';

/**
 * ==> THE OUTLOOK COMES FROM THE KMZ NOW, NOT FROM GIS LAYER 3. <==
 *
 * Not a fallback and not a second opinion — the SAME forecaster run, published
 * on a different path and published better. Proven before it was switched:
 * `tools/gtwo-compare.mjs` runs both against all 72 hourly snapshots on the
 * archive branch and they agree on every area, every vertex and every
 * probability, worst disagreement 4.5e-10 degrees. The issue stamp matches to
 * the minute every hour.
 *
 * WHAT THE SWAP BUYS, and why it is a swap rather than an addition. The KMZ
 * carries three things layer 3 does not publish at all: NHC's own name for
 * each area, the forecaster's paragraph attached to the shape it describes,
 * and a disturbance number joining an area to its current-position point.
 * Running BOTH sources to get them would need a matcher between prose and
 * polygons — the exact thing `lib/outlook.js` refuses to do and the `GENESIS`
 * block in config/constants.js records as unsafe — plus three new failure
 * states, for two text fields. One source per fact.
 *
 * ==> AND IT SAYS THE ALL-CLEAR IN WORDS. <== The whole held apparatus below
 * exists because an empty FeatureCollection is UNSTAMPED: "NHC is watching
 * nothing" and "NHC's layer is broken" are the same bytes. This document is
 * not. A quiet basin arrives carrying `Tropical cyclone formation is not
 * expected` and an issue time, which is a fact rather than an absence.
 *
 * THAT APPARATUS IS DELIBERATELY LEFT STANDING ANYWAY, and this is a judgement
 * worth stating rather than a leftover. It now fires on a narrower and more
 * honest trigger — see `parseBasinDocument` — and it still covers the one case
 * the new source can produce that nobody has seen: a document with no areas
 * AND no all-clear sentence. Retiring 250 lines of measured failure handling
 * in the same pass that changes where the bytes come from is two changes
 * wearing one commit, in season. It goes when something has watched the new
 * source through a real outage.
 */

/** The two basin documents. ONE PRODUCT, PUBLISHED PER BASIN — layer 3
 *  answered both from a single query, and this does not, which is the only
 *  structural difference the swap introduces. See `fetchBasins`. */
const KMZ_URL = Object.freeze({
  atlantic: 'https://www.nhc.noaa.gov/xgtwo/gtwo_atl.kmz',
  epacific: 'https://www.nhc.noaa.gov/xgtwo/gtwo_pac.kmz',
});

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

/** How many areas are in a body, or `null` if it cannot be read.
 *
 *  ==> AN EMPTY ANSWER IS NEVER SERVED OUT OF A CACHE, AND THIS IS WHAT
 *      DECIDES IT. <== MEASURED on the archive branch, 2026-08-11 13:22Z and
 *  again at 15:06Z: this route answered 42 bytes of empty FeatureCollection
 *  with `X-Landfall-Cache: kv` on it and no held marker, while NHC's own
 *  bulletin and its public graphic both listed five areas.
 *
 *  The held branch below was not broken. IT WAS NEVER REACHED. Requests are
 *  answered colo-first, then KV, then upstream — and the entire remembering
 *  mechanism lives in the third step. The cron re-stamps the KV copy every
 *  five minutes whether the bytes changed or not (deliberately —
 *  `worker/src/kv.js` argues it), so once ONE empty answer lands in the warm
 *  store it is never more than five minutes old, is always judged fresh, and
 *  short-circuits every request ahead of the code that would have held. A
 *  single empty cycle that got through poisons the whole outage.
 *
 *  So an empty body found in either cache is stepped over rather than served,
 *  and the emptiness is re-decided against the memory on every request.
 *
 *  THE COST, STATED: while NHC is genuinely watching nothing, every request
 *  goes to NOAA rather than answering from the store. At one user and a
 *  30-minute poll that is a couple of fetches an hour on top of the cron, and
 *  it is the direction §5 requires — a false all-clear is the one failure
 *  worth paying to avoid. A populated answer still serves from cache exactly
 *  as before, which is every request that matters for load.
 *
 *  A body that will not parse counts as unreadable, NOT as empty: it was a
 *  real answer once, and treating "we cannot read it" as "there is nothing
 *  there" is the same conflation this whole route exists to refuse. */
function featureCount(body) {
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed?.features) ? parsed.features.length : null;
  } catch {
    return null;
  }
}

/** The parts this route will serve. A closed table, so no caller text ever
 *  reaches an upstream URL or a cache key — the same rule `mapserver.js`
 *  applies to its bin.
 *
 *  ==> THERE IS NO SECOND PART ANY MORE, AND THAT IS THE POINT. <== It was
 *  going to be `anchors`, carrying GIS layer 2's label points, and it never
 *  shipped: real bytes (2026-08-09) showed three points against five polygons
 *  with attributes matching one polygon while sitting inside another —
 *  unmatchable, and a wrong match would print one area's probability on
 *  another area's shape. THE KMZ PUBLISHES THAT JOIN. Every placemark carries
 *  its disturbance number, so the point and the polygon arrive already paired
 *  and there is nothing left for a second part to fetch. The parameter stays
 *  because the wire contract and the KV keys are shaped around it. */
const PARTS = { areas: true };

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

/**
 * ==> HOW LONG THE MEMORY IS STILL OFFERED AFTER THE WINDOW ABOVE HAS PASSED.
 * <== Twenty-four hours, and the word OFFERED is doing the work.
 *
 * Past `HELD_SECONDS` a forecaster has had a turn and published nothing, so an
 * empty layer is normally simply true and this route says so — that has not
 * changed and must not. But it is not ALWAYS true: on 2026-08-11 the layer was
 * wrong for hours while NHC's own prose listed three Atlantic areas, and six
 * hours is not a long outage for a public GIS service.
 *
 * ==> THIS ROUTE CANNOT TELL THOSE APART AND DOES NOT TRY. <== Separating them
 * means reading a paragraph of forecaster prose, and §4 is explicit that a
 * relay moves payloads and does not interpret them — every Pages Function here
 * imports nothing but its `_`-prefixed siblings, deliberately (§3). Parsing a
 * bulletin in the edge would put a second implementation of that judgement on
 * the far side of a deploy boundary from `lib/outlook.js`, which is the exact
 * drift `worker/src/sources.js` refuses to commit.
 *
 * So the split is: THE ROUTE REMEMBERS, THE BROWSER DECIDES. Between
 * `HELD_SECONDS` and here, the last real answer is served with a DIFFERENT
 * marker — `upstream-empty-lapsed` — which `data/genesis.js` treats as an
 * offer rather than an instruction. It draws those areas only when the text
 * outlook independently says the layer is wrong, and drops them otherwise. A
 * client that has never heard of the marker ignores it and behaves exactly as
 * this route behaved before, which is the correct way to be wrong.
 *
 * WHY 24 AND NOT 48. `KEY_TTL_SECONDS` is 48 hours, so the memory physically
 * survives that long and the ceiling is a judgement, not a limit. A day is
 * four outlook cycles: long enough to ride out any layer outage anyone would
 * call an outage, short enough that a genesis area — a forecast about the next
 * few days — has not become a historical note.
 */
const HELD_LAPSED_SECONDS = 24 * 60 * 60;

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


  /* ==> ONE PRODUCT, TWO DOCUMENTS, AND EITHER ONE MISSING IS AN OUTAGE. <==
   * Layer 3 answered both basins from a single query; the KMZ is published per
   * basin, so this is two fetches where there was one. Serving the half that
   * answered would mean the app quietly showing an Atlantic-only outlook that
   * looks exactly like a complete one, which is §5's false all-clear wearing a
   * different hat — a Pacific area at 80% would simply not be there, with
   * nothing on screen to say so. So a failure in either basin fails the whole
   * request and falls through to the memory below, which is precisely what a
   * single failed query did before. Both documents come from the same NHC host
   * behind the same CloudFront distribution, so the two are correlated in
   * practice rather than independent. */
  async function fetchBasins() {
    const out = [];
    for (const [basin, url] of Object.entries(KMZ_URL)) {
      const r = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.google-earth.kmz' },
      });
      if (!r.ok) throw new Error(`upstream HTTP ${r.status} for the ${basin} outlook`);

      const kml = await kmlFromKmz(new Uint8Array(await r.arrayBuffer()));
      const parsed = parseGtwoKml(kml);
      if (parsed.state !== 'ok') throw new Error(`the ${basin} outlook was unreadable: ${parsed.reason}`);

      /* THE DOCUMENT MUST NAME THE BASIN WE ASKED FOR. If NHC ever moves a
       * filename, serving the Atlantic twice would double-count one ocean and
       * silently empty the other — an error that produces a perfectly
       * well-formed answer, which is the kind this project keeps having. */
      if (parsed.basin !== basin) {
        throw new Error(`the ${basin} outlook document says it is ${parsed.basin || 'unnamed'}`);
      }
      out.push(parsed);
    }
    return out;
  }

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
  /* An empty stored copy is stepped over — see `featureCount`. The body has to
   * be read to know, and a Response body can only be read once, so it is read
   * here and reused below rather than fetched twice. */
  const hitBody = hit ? await hit.text() : null;
  if (hit && featureCount(hitBody) !== 0) {
    return new Response(hitBody, {
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
  /* ==> AND THIS IS THE ONE THAT ACTUALLY SHIPPED THE FALSE ALL-CLEAR. <== The
   * warm store is written by the cron and re-stamped every five minutes, so an
   * empty copy in here never ages out on its own and would answer every
   * request for the rest of the outage. See `featureCount`. */
  const warmCount = warm && warm.fresh ? featureCount(warm.body) : null;
  if (warm && warm.fresh && warmCount !== 0) {
    const headers = baseHeaders({
      'X-Landfall-Fetched-At': warm.fetchedAt || '',
      'X-Landfall-Genesis-Part': part,
      /* THE COUNT IS STATED ON THIS PATH TOO, and it was not before. Nothing
       * reads it today — the cron bypasses every cache, so its write gate only
       * ever sees the upstream branch's headers. It matters the day that
       * bypass silently stops working (a mismatched `WARM_KEY` does not fail,
       * it just gets answered from here), because a gate reading `> 0` off an
       * absent header refuses forever and the memory is never written again.
       * That is exactly the failure that left `last-good` empty, and a header
       * that costs nothing should not be the thing that hides it twice. */
      [AREA_COUNT_HEADER]: warmCount == null ? '' : String(warmCount),
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
    const documents = await fetchBasins();

    /* Both basins into the one FeatureCollection layer 3 used to answer with,
     * so nothing downstream of this route changes shape. */
    const features = documents.flatMap((doc) => toAreaCollection(doc).features);
    const body = JSON.stringify({ type: 'FeatureCollection', features });
    const areaCount = features.length;

    const headers = baseHeaders({
      'X-Landfall-Fetched-At': new Date().toISOString(),
      'X-Landfall-Genesis-Part': part,
      [AREA_COUNT_HEADER]: String(areaCount),
      [CACHE_PATH_HEADER]: CACHE_PATH.UPSTREAM,
    });

    /* ==> WHAT "EMPTY" NOW MEANS, AND WHY IT IS NARROWER THAN IT WAS. <==
     *
     * Under layer 3 this was simply `features.length === 0`, because that was
     * the only thing an empty FeatureCollection could tell you. The KMZ tells
     * you more: a quiet basin's document CARRIES A SENTENCE saying formation
     * is not expected, and a dated sentence from the forecaster is a fact
     * rather than an absence.
     *
     * So a basin is only ambiguous when it has no areas AND does not say why.
     * Every quiet basin in the 72-hour archive window said why, so this is
     * expected never to fire — which is exactly why it is worth keeping.
     * Nobody has watched this source through an outage yet, and the failure it
     * guards against is the one §5 ranks worst.
     *
     * THE PRACTICAL EFFECT OF NARROWING IT: a genuine all-clear now shows
     * immediately instead of being held for up to six hours behind remembered
     * areas. That six hours was the price of not being able to tell the two
     * apart. We can tell them apart now, so it is not owed.
     */
    const ambiguous = documents.some((doc) => doc.areas.length === 0 && !doc.formationNotExpected);

    /* ==> AND THIS IS THE OTHER HALF OF THE SAME WORD, KEPT SEPARATE ON
     * PURPOSE. <== `ambiguous` decides whether to hold. `noAreas` decides what
     * may be written to a cache, and it is UNCHANGED from what layer 3 did: an
     * answer with nothing in it is never stored as fresh and never stored as
     * last-good. Rolling the two together is what the swap makes tempting and
     * it would quietly change two behaviours at once — a stated all-clear
     * would start being served out of the caches, and `lastGoodKey` would
     * start holding bodies with no areas in them, which is the one thing that
     * key promises never to hold. Both may be worth doing. Neither is this
     * pass's job, and `featureCount` above still steps over an empty body
     * wherever it finds one, exactly as it did yesterday. */
    const noAreas = features.length === 0;

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
    if (ambiguous) {
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

      const kvHeld = await kvRead(context.env, kvLastGoodPathFor(part), HELD_LAPSED_SECONDS);
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

      if (held && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < HELD_LAPSED_SECONDS * 1000) {
        /* ==> WHICH OF THE TWO WINDOWS THIS MEMORY FALLS IN, AND THEY MEAN
         * DIFFERENT THINGS TO THE READER. <==
         *
         * Inside `HELD_SECONDS` the hold is ASSERTED: the shape of the drop is
         * the evidence, because a real all-clear arrives one area at a time
         * and this one fell off a cliff in a single step (measured, see the
         * constant). The client draws these.
         *
         * Past it the hold is only OFFERED. A full outlook cycle of emptiness
         * is normally simply true, so these areas are NOT drawn on this
         * route's say-so — `data/genesis.js` draws them only when NHC's own
         * text outlook independently says the layer is wrong, and drops them
         * otherwise. This route cannot read a bulletin and does not try; see
         * `HELD_LAPSED_SECONDS` for why that split is where it is.
         *
         * A CLIENT THAT HAS NEVER HEARD OF THE SECOND MARKER IGNORES IT and
         * behaves exactly as it did before this branch existed — it looks for
         * `upstream-empty` and finds something else. That is the correct way
         * for a new wire value to be wrong. */
        const lapsed = ageMs >= HELD_SECONDS * 1000;

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
          'X-Landfall-Held': lapsed ? 'upstream-empty-lapsed' : 'upstream-empty',
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
      /* No memory at all, or a memory older than a full DAY. Past that even a
       * confirmed layer outage is too old to draw a forecast about the next
       * few days from, so the empty answer is the honest one and falls through
       * to be served and cached normally. */
    }

    /* ==> AN EMPTY ANSWER IS NO LONGER STORED HERE EITHER. <== It used to be,
     * to spare upstream fifteen minutes of re-queries. It cannot be served any
     * more (see `featureCount`), so storing it only leaves a body in the slot
     * that every future request has to read and step over. The saving it was
     * bought for is gone; the cost of keeping it is a cache entry that lies
     * about being useful. */
    const writes = noAreas
      ? []
      : [
          cache.put(
            freshKey,
            new Response(body, {
              headers: { ...headers, 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
            })
          ),
        ];
    if (!noAreas) {
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
