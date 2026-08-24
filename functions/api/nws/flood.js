/**
 * /api/nws/flood — every NWS flood alert in force, with the shapes. §48.21.
 *
 * ==> THIS IS THE FIRST ROUTE IN §48 THAT KEEPS A POLYGON, AND THAT REVERSES
 * A DECISION §48.7 MADE ON PURPOSE. <== The point route strips `description`,
 * `instruction` and the geometry because that is the entire 55 KB and none of
 * it reached a sentence. Here the geometry IS the feature: this is the only
 * thing in §48 that can be drawn, so the bytes that route exists to drop are
 * the bytes this one exists to carry. The text still goes.
 *
 * ==> AND IT IS NOT THE SAME QUESTION THE POINT ROUTE ASKS. <==
 * `/api/nws/rainfall` asks "what is in force at this house". This asks "what
 * is in force anywhere", because a map layer is not about anybody's house.
 * One national answer, one cache key, shared by every reader — the alternative
 * is a query per storm returning overlapping subsets of one list.
 *
 * ==> WARNINGS CARRY POLYGONS AND WATCHES DO NOT. <== Measured on the captured
 * Hilo set (`samples/rain/alerts-hilo-hi.json`), which is real NWS bytes:
 *
 *   Flash Flood Warning   Polygon, 346 bytes,  1 zone
 *   Hurricane Warning     Polygon, 1142 bytes, 1 zone
 *   Flood Watch           geometry: null,     17 zones
 *   High Surf Warning     geometry: null,      7 zones
 *
 * A warning is issued for a drawn box; a watch is issued for a list of forecast
 * zones and arrives with no shape at all. Both are fetched, both reach the
 * drawer's list, and the split is stated in the payload rather than left for
 * the client to infer from a null.
 *
 * ==> AND SINCE §56.4 THE NULL IS NO LONGER THE END OF THE STORY. <== The zone
 * codes this route now keeps are resolved to real boundaries by
 * `/api/nws/zone`, and `data/flood.js` joins the two. So a watch usually ends
 * up drawable after all — but not here, and not on this row. What this route
 * says is what NWS said.
 *
 * ==> TWO UPSTREAM CALLS, NOT ONE UNFILTERED ONE. <== `/alerts/active` with no
 * filter returns every hazard in the United States — fire weather, marine, heat
 * — and the flood family is a small fraction of it. Asking for the two events
 * by name means the upstream does the filtering and the bytes never cross the
 * wire. **The event names are NWS's own product names and are matched exactly**;
 * `RAIN.alertEventMatch` on the client is a substring test over what comes back,
 * which is the belt to this braces.
 *
 * ==> THE VOLUME HAS NEVER BEEN MEASURED AND THE ARCHIVE NOW MEASURES IT. <==
 * The per-feature shape was known before this file existed. The row COUNT on an
 * active day was not, and nothing in a sandbox can reach api.weather.gov. Both
 * queries are archived hourly (`tools/archive-fetch.mjs`) so the first tuning
 * pass reads bytes instead of guessing.
 *
 * Pages Functions run in their own workerd runtime with no access to this
 * project's config (§4.13), so the numbers below mirror `RAIN` by hand and say
 * so, exactly as the sibling routes do.
 */

import { kvRead, isWarmRequest } from '../_kv-cache.js';
import { CACHE_PATH, CACHE_PATH_HEADER } from '../_cache-path.js';

const ALERTS = 'https://api.weather.gov/alerts/active';

/** ==> NWS ANSWERS 403 WITHOUT A CONTACT IN THE USER-AGENT. <== The same
 *  string §48.13's probe measured working, and the same one
 *  `functions/api/nws/rainfall.js` sends. Two copies because a Pages Function
 *  cannot import from another (§4.13); `tools/test-relay-mirrors.mjs` is what keeps
 *  them honest. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app, andy@getgravitate.app)';

/** The two products, by NWS's own exact names.
 *
 *  ==> DELIBERATELY NOT A SUBSTRING SEARCH ON \"Flood\". <== That would also
 *  pull Coastal Flood Advisory, Lakeshore Flood Warning and Hydrologic Outlook,
 *  which are real products about different water. Coastal flooding already has
 *  its own section (§51) and its own source, and a Hydrologic Outlook is not a
 *  thing in force. Adding an event here is a decision; discovering one through
 *  a wildcard is an accident. */
const EVENTS = Object.freeze([
  'Flash Flood Warning',
  'Flood Warning',
  'Flood Watch',
]);

/* --------------------------------------------------------------------------
 * THE ZONE CODES, AND WHY THIS ROUTE STOPPED THROWING THEM AWAY
 *
 * ==> A WATCH'S ZONE LIST IS THE ONLY ROUTE BACK TO A SHAPE, AND THE ONLY
 * PLACE ITS STATE IS WRITTEN DOWN. <== §56.2 measured both. `geometry` is null
 * on every Flood Watch ever captured, so §56.3's distance-from-the-track match
 * has nothing to measure against; the zones NWS names are what a boundary can
 * be resolved from. And `areaDesc` reads `Cuyahoga; Lake; Geauga; …` with no
 * state anywhere in it, so `OHZ011` is the only thing in the payload that says
 * Ohio.
 *
 * This route used to drop the field. Recovering it downstream is impossible —
 * the client never sees the upstream body — so it is kept here and split here.
 *
 * ==> TWO PATTERNS, HAND-COPIED FROM `lib/zones.js`. <== A Pages Function
 * cannot import from `lib/` (§4.13) and this project has no bundler. So the
 * rule is written down twice on opposite sides of a wire, exactly like the
 * cache windows and the model codes this file's siblings mirror, and
 * `tools/test-relay-mirrors.mjs` fails when the two copies stop agreeing.
 * Change one, change both.
 *
 * ==> `Z` AND `C` ARE DIFFERENT GEOGRAPHIES. <== `OHZ011` is a forecast zone
 * and `OHC011` is a county, served from different paths. Feeding a county code
 * to the forecast path builds a URL that 404s, and that 404 is indistinguishable
 * from a zone NWS genuinely does not publish — so they are split rather than
 * lumped, and the counties are REPORTED rather than dropped.
 * ----------------------------------------------------------------------- */
const UGC_FORECAST_ZONE = /^[A-Z]{2}Z\d{3}$/;
const UGC_COUNTY = /^[A-Z]{2}C\d{3}$/;

/**
 * One alert's `geocode.UGC` array, split into the two geographies.
 *
 * ==> SORTED AND DEDUPLICATED, BECAUSE CACHE KEYS GET BUILT FROM THIS. <== An
 * unsorted list re-keys every zone the moment NWS reorders its array, and two
 * neighbouring offices routinely name the same zone in one hour.
 *
 * Mirrors `splitUgc` in `lib/zones.js`.
 */
const splitUgc = (codes) => {
  const forecast = new Set();
  const county = new Set();
  let malformed = 0;

  for (const raw of codes || []) {
    const ugc = String(raw ?? '').trim().toUpperCase();
    if (!ugc) continue;
    if (UGC_FORECAST_ZONE.test(ugc)) forecast.add(ugc);
    else if (UGC_COUNTY.test(ugc)) county.add(ugc);
    else malformed++;
  }

  return { forecast: [...forecast].sort(), county: [...county].sort(), malformed };
};

/* --------------------------------------------------------------------------
 * CACHE
 *
 * ==> FIFTEEN MINUTES, AND IT IS THE SAME FIFTEEN §48.7 SETS FOR THE SAME
 * REASON. <== A flash flood warning is routinely shorter-lived than one poll:
 * the captured Hilo warning expired 52 minutes after it was issued. A longer
 * hold would let this route claim an expired warning is still in force, which
 * on a hazard layer is the §5 failure with a shape drawn over it. Expiry is
 * filtered AGAIN at render on the client, which is the belt to these braces.
 *
 * ==> AND THERE IS NO LAST-GOOD. <== Every other route in this app holds its
 * previous answer, because a stale forecast beats a blank section. This one
 * must not: an expired flood warning is not a stale reading of a live fact, it
 * is a shape on a map saying somebody is in danger who is not. Same reasoning
 * §50.5 gives for the CAP list, which also refuses to hold.
 * ----------------------------------------------------------------------- */
const FRESH_SECONDS = 15 * 60;

/**
 * The KV path the cron Worker warms this route under (SPEC §17 Pass B).
 * Must match `worker/src/sources.js` — tools/test-kv-keys.mjs asserts it.
 *
 * ==> THIS ROUTE WAS WARMED FOR WEEKS AND READ NONE OF IT. <== It was added to
 * `LIST_FEEDS` when §56.17 made the Flooding section render for everybody, so
 * the cron fetched it and wrote it every five minutes — and this file never
 * imported `kvRead` at all. Every byte was stored and read by nothing. The
 * route still worked, falling through to its colo cache and to weather.gov, so
 * there was no symptom and the warm loop reported perfect health. Found
 * 2026-08-24 by the completeness check in `tools/test-kv-keys.mjs`.
 *
 * ==> AND IT READS KV AT ONE LEVEL ONLY. THERE IS NO `KV_STALE` HERE AND
 * THERE MUST NOT BE. <== Every other KV-backed route in this app falls back to
 * a warmed copy judged too old, because a stale forecast beats a blank section.
 * This route already refuses that for its own colo cache — the note above says
 * why, and it is the whole reason there is no last-good slot: an expired flood
 * warning is not a stale reading of a live fact, it is a shape on a map telling
 * somebody they are in danger when they are not. **A KV copy nine hours old is
 * that same expired warning arriving by a different road.** Adding the fallback
 * "for consistency with the other routes" would reintroduce, globally, exactly
 * what this file deleted locally.
 */
const KV_PATH = 'nws/flood';

const UPSTREAM_TIMEOUT_MS = 10_000;

const jsonHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  ...extra,
});

const json = (obj, status, extra) =>
  new Response(JSON.stringify(obj), { status, headers: jsonHeaders(extra) });

/**
 * Does this feature carry a shape we can draw?
 *
 * ==> IT READS THE FEATURE, NEVER THE EVENT NAME. <== There used to be a table
 * of the products that usually carry a polygon, kept beside this as a record of
 * what had been measured. It was deleted in §56.4: nothing consulted it, and a
 * table naming which products can be drawn is exactly the thing that goes
 * quietly out of date. A Flood Watch that one day arrives with a real polygon
 * gets drawn without anybody editing anything, and a Flash Flood Warning that
 * arrives without one is honestly reported as undrawable rather than silently
 * vanishing off the globe with the layer switched on.
 */
const drawable = (f) => {
  const t = f?.geometry?.type;
  return t === 'Polygon' || t === 'MultiPolygon';
};

/**
 * The upstream feature collection → the body this route serves.
 *
 * ==> SEPARATED FROM THE FETCHING SO IT CAN BE TESTED AGAINST REAL BYTES. <==
 * `tools/test-flood.mjs` runs it over `samples/rain/alerts-hilo-hi.json`, which
 * is a genuine NWS response carrying both shapes — a warning with a polygon and
 * a watch without one. A Pages Function is not reachable from a sandbox and
 * neither is its upstream, so this function is the only part of this file any
 * test can stand on.
 *
 * Pure: no fetch, no cache, no clock.
 */
export function projectFlood(collections) {
  const rows = [];
  let drawn = 0;
  let ugcUnread = 0;

  for (const body of collections || []) {
    for (const f of body?.features || []) {
      const p = f?.properties || {};
      const canDraw = drawable(f);
      if (canDraw) drawn++;

      const ugc = splitUgc(p?.geocode?.UGC);
      ugcUnread += ugc.malformed;

      rows.push({
        /* The alert's own id, so a client can key on it. Two of these queries
         * can return the same row when NWS reclassifies a product mid-flight,
         * and a list that shows it twice looks like two floods. */
        id: p.id || null,
        event: p.event || null,
        /* ==> WHO ISSUED IT, AND IT IS ONE SHORT STRING RATHER THAN A CHANGE OF
         * HEART ABOUT THIS PROJECTION. <== §56.6 used to promise the office and
         * then record that it could not be shown, because this route did not
         * carry it. Measured on the archived national bytes: `NWS Grand
         * Junction CO`, `NWS Honolulu HI` — about twenty bytes an alert against
         * the ~1,900 of `description` and `instruction` this route still drops.
         * It matters because a flood warning is somebody's professional
         * judgement about a specific valley, and naming them is the difference
         * between a fact with an author and a number from a machine. */
        senderName: p.senderName || null,
        /* WHERE IT APPLIES, WHOLE AND UNSHORTENED (§56.7). The reader is
         * hunting for their own zone in this list. */
        areaDesc: p.areaDesc || null,
        severity: p.severity || null,
        urgency: p.urgency || null,
        onset: p.onset || null,
        expires: p.expires || null,
        ends: p.ends || null,
        /* ==> THE ONLY FIELD IN §48 THAT IS A SHAPE. <== Null is a real answer
         * here and it means "issued for zones rather than for a box", which is
         * every Flood Watch ever captured. The client renders those in the list
         * and keeps them off the globe. */
        geometry: canDraw ? f.geometry : null,
        /* Stated rather than left to be inferred from the null above, because
         * "we could not draw it" and "there was nothing to draw" are different
         * facts and only one of them is about the source. */
        drawable: canDraw,
        /* ==> THE ZONES THIS ALERT NAMES, KEPT BECAUSE NOTHING DOWNSTREAM CAN
         * RECOVER THEM. <== §56.4. On a watch this is the only route back to a
         * shape and the only place the state is written; on a warning it is
         * usually the one zone the drawn box sits in. Empty is a real answer
         * and means the alert named none, never that this route dropped them. */
        zones: ugc.forecast,
        /* Counties are a DIFFERENT geography served from a different path, and
         * they are carried rather than dropped so the hour that proves this
         * feature has to handle them is readable instead of silent. */
        counties: ugc.county,
      });
    }
  }

  return {
    status: 'ok',
    /* THE TWO COUNTS THE DRAWER'S SENTENCE NEEDS, computed here where the whole
     * list is in hand. A count of alerts is not a count of shapes, and a layer
     * that draws eleven of nineteen must be able to say so (§5). */
    total: rows.length,
    drawable: drawn,
    /* ==> A COUNT OF CODES THIS ROUTE COULD NOT READ, AND IT IS HERE SO A FEED
     * THAT CHANGES SHAPE CANNOT LOOK LIKE A QUIET DAY. <== §5. Zero is the
     * normal answer. Anything else means NWS is publishing UGC codes in a form
     * neither pattern above matches, and every zone in them is being skipped —
     * which without this number is indistinguishable from an alert that named
     * no zones at all. */
    ugcUnread,
    alerts: rows,
  };
}

async function pull(event) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const r = await fetch(`${ALERTS}?event=${encodeURIComponent(event)}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`alerts HTTP ${r.status} for ${event}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const key = new Request('https://landfall-relay.internal/nws/flood');

  /* SPEC §17 Pass B — colo cache, then the globally warmed KV copy, then
   * upstream. The cron Worker skips the first two, or it would store what it
   * already stored and weather.gov would never be contacted again. */
  const warming = isWarmRequest(context.request, context.env);

  const hit = warming ? null : await cache.match(key);
  if (hit) {
    return json(await hit.json(), 200, {
      'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
      [CACHE_PATH_HEADER]: CACHE_PATH.FRESH,
    });
  }

  /* FRESH ONLY. See KV_PATH above: there is no stale tier on this route by
   * design, and a warmed copy past its window is declined here exactly as the
   * colo copy would be. */
  const warm = warming ? null : await kvRead(context.env, KV_PATH, FRESH_SECONDS);
  if (warm && warm.fresh) {
    const headers = {
      'X-Landfall-Fetched-At': warm.fetchedAt || '',
      [CACHE_PATH_HEADER]: CACHE_PATH.KV,
    };
    context.waitUntil(cache.put(key, new Response(warm.body, {
      headers: { ...jsonHeaders(headers), 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
    })));
    return new Response(warm.body, { headers: jsonHeaders(headers) });
  }

  try {
    const fetchedAt = new Date().toISOString();
    /* ==> ONE FAILING EVENT FAILS THE WHOLE REQUEST, AND THAT IS DELIBERATE.
     * <== `Promise.all` rather than `allSettled`. A partial answer here is a
     * map missing warnings it does not know are missing — an all-clear over a
     * flooding county, assembled out of a 500. The client has an `unavailable`
     * state and a Retry; this route's job is to make sure it reaches them. */
    const bodies = await Promise.all(EVENTS.map(pull));
    const body = { ...projectFlood(bodies), fetchedAt };
    const text = JSON.stringify(body);

    const headers = {
      'X-Landfall-Fetched-At': fetchedAt,
      [CACHE_PATH_HEADER]: CACHE_PATH.UPSTREAM,
    };

    context.waitUntil(cache.put(key, new Response(text, {
      headers: { ...jsonHeaders(headers), 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
    })));

    return json(body, 200, headers);
  } catch (e) {
    /* NO LAST-GOOD TO FALL BACK ON, ON PURPOSE — see the cache note above.
     * Codes, never prose: the client is the layer with the context to write a
     * sentence (§4.3). */
    return json(
      { error: 'flood_unreachable', detail: String(e?.message || e) },
      502
    );
  }
}
