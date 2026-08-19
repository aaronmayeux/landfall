/**
 * /api/cap/alerts — tropical-cyclone alerts issued by national agencies
 * worldwide, forwarded. SPEC §50.
 *
 * WHAT THIS IS. Esri's CAP Connector republishes what the WMO Alert Hub
 * aggregates — every member country's official alerts — as an ordinary ArcGIS
 * feature service. This route asks it for the tropical-cyclone ones and
 * forwards the answer. Parsing and wording live in `lib/cap.js`, in the
 * browser; this file is the same dumb forwarder `jtwc/abpw.js` is.
 *
 * ==> IT ASKS FOR ATTRIBUTES AND REFUSES THE GEOMETRY, ON PURPOSE. <== §50.2.
 * MEASURED on the archive branch, 2026-08-19: the same query WITH shapes was
 * 281,336 bytes for THREE features, because a CAP area is whatever the issuing
 * country drew and Costa Rica drew its own coastline at 6,585 points. The
 * attributes-only form of the same query was 8,015 bytes for five rows. We
 * paint none of it (§50.1), so the shapes are pure weight and are not asked
 * for.
 *
 * ==> AND THAT IS WHY THERE IS NO SPATIAL FILTER HERE. <== The obvious design
 * is to ask the service which alerts intersect a storm's box and let the
 * server do the matching. It would work, and it would be one round trip PER
 * STORM OPENED for a feed whose entire global contents measured 8 KB. One
 * cached list shared by every storm and every reader is cheaper than that, and
 * the matching it moves onto our side is a country-code comparison that
 * `lib/cap.js` can be tested against offline.
 *
 * WHY A RELAY AT ALL: the service is CORS-open, so this is for load and for
 * caching, not for access — the same reason `/api/gdacs/events` exists. It
 * also means the query string lives in ONE place instead of in every client.
 *
 * ==> AN EMPTY ANSWER IS THE COMMON CASE AND IS TRUE. <== Most hours no
 * country anywhere has a cyclone alert in force, and `{"features":[]}` is that
 * statement, not a fault. It is cached on the normal clock. This is the
 * genesis route's situation and NOT its danger: §45's emptiness could be read
 * as "no storm is forming", so that route holds the last non-empty answer.
 * Here an empty list means "no agency has published one", the section says
 * exactly that, and nothing downstream infers anything about a storm from it.
 * Holding would make this route claim an expired alert is still in force,
 * which is the worse lie of the two.
 *
 * A COLO CACHE RATHER THAN THE WARM KV STORE, deliberately. §45's route needed
 * global KV because a cold colo made its held branch unreachable — the hold is
 * the whole feature there. Nothing is held here, so a cold colo costs one
 * upstream fetch of 8 KB and nothing else.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED on purpose (§3). The numbers below mirror `CACHE.capFresh` in
 * config/constants.js; if they change, they change in both places on purpose.
 */

/** The alert types worth asking for. `LIKE` rather than `=` because the
 *  `event` field is the issuing agency's own words in its own language, so
 *  there is no closed vocabulary to match against — "Tropical Cyclone Alert",
 *  "Fin de Influencia de Onda Tropical" and "storm surge" are all real
 *  observed values from three different countries.
 *
 *  ==> `Storm Surge` IS IN HERE AND IT COSTS US NON-TROPICAL ROWS. <== The
 *  archived run returned two Environment Canada storm-surge warnings for the
 *  YUKON coastline — Arctic, no cyclone within thousands of kilometres. They
 *  match because surge is surge whatever pushed it. Dropping the term would
 *  lose a real storm-surge warning during a real hurricane, so it stays, and
 *  the country match in `lib/cap.js` is what keeps Yukon out of a Philippine
 *  storm's panel. */
const WHERE = [
  "event LIKE '%Cyclone%'",
  "event LIKE '%Typhoon%'",
  "event LIKE '%Hurricane%'",
  "event LIKE '%Tropical%'",
  "event LIKE '%Storm Surge%'",
].join(' OR ');

/** The fields the section renders, and no others. `language` is here because
 *  §50.4 labels text we are NOT translating; `areaDesc` because the agency's
 *  own description of where is the only honest substitute for a shape we
 *  refuse to download. */
const OUT_FIELDS = [
  'event', 'headline', 'severity', 'urgency', 'certainty',
  'senderName', 'countryCode', 'areaDesc',
  'effective', 'expires', 'sent', 'language',
].join(',');

const UPSTREAM =
  'https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/CAP_Alerts_Feed/FeatureServer/0/query' +
  `?where=${encodeURIComponent(WHERE)}` +
  `&outFields=${encodeURIComponent(OUT_FIELDS)}` +
  '&returnGeometry=false' +
  '&orderByFields=sent+DESC' +
  '&resultRecordCount=100' +
  '&f=json';

/** Mirrors `CACHE.capFresh`. Alerts are issued on human timescales and carry
 *  their own expiry, so the reader can see for themselves how current one is
 *  — this window only needs to be short enough that a NEW alert appears within
 *  a poll or two. */
const FRESH_SECONDS = 10 * 60;

/** Serve-stale on upstream failure. Shorter than most routes here BECAUSE
 *  EVERY ROW CARRIES AN EXPIRY: a six-hour-old alert list is mostly a list of
 *  things that have expired, and `lib/cap.js` drops those, so a long stale
 *  window buys an increasingly empty answer that still claims to be an answer.
 *  Past this the section says unavailable, which is the truth. */
const STALE_SECONDS = 2 * 60 * 60;

const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** How many rows are in the body being served, stated on the wire — the same
 *  argument `nhc/genesis.js` makes for its area count: a reader of the logs
 *  should not have to open the payload to learn whether it was empty. */
const ROW_COUNT_HEADER = 'X-Landfall-Cap-Rows';

const jsonHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  ...extra,
});

const errorJson = (obj, status) =>
  new Response(JSON.stringify(obj), { status, headers: jsonHeaders() });

/** Row count, or `null` when the body cannot be read as this service's answer.
 *  Used only for the header — the decision to cache is made below and is
 *  deliberately NOT conditional on the count (see the emptiness note above). */
function rowCount(body) {
  try {
    const j = JSON.parse(body);
    return Array.isArray(j.features) ? j.features.length : null;
  } catch {
    return null;
  }
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const freshKey = new Request('https://landfall-relay.internal/cap/alerts/fresh');
  const lastGoodKey = new Request('https://landfall-relay.internal/cap/alerts/last-good');

  const hit = await cache.match(freshKey);
  if (hit) {
    const body = await hit.text();
    return new Response(body, {
      headers: jsonHeaders({
        'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Cache': 'colo',
        [ROW_COUNT_HEADER]: String(rowCount(body) ?? ''),
      }),
    });
  }

  let upstreamError;
  try {
    const r = await fetch(UPSTREAM, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
    const body = await r.text();

    /* ==> ARCGIS REPORTS FAILURE AS HTTP 200 WITH AN `error` BODY. <== The
     * genesis route learned this the expensive way: read as a feature list, a
     * REFUSED QUERY becomes an empty one, and an empty one here renders as
     * "no agency has issued an alert" — a false all-clear built out of a
     * server error. Caching it would hold that lie for ten minutes.
     *
     * The body is forwarded verbatim in that case rather than swallowed, so
     * `data/cap.js` can say unavailable for the real reason. */
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error('upstream body was not JSON');
    }
    if (parsed && parsed.error) {
      return new Response(body, {
        status: 502,
        headers: jsonHeaders({ 'X-Landfall-Cap-Refused': 'true' }),
      });
    }
    if (!parsed || !Array.isArray(parsed.features)) {
      throw new Error('upstream body was not a feature list');
    }

    const headers = jsonHeaders({
      'X-Landfall-Fetched-At': new Date().toISOString(),
      [ROW_COUNT_HEADER]: String(parsed.features.length),
    });

    context.waitUntil(
      Promise.all([
        cache.put(freshKey, new Response(body, {
          headers: { ...headers, 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
        })),
        cache.put(lastGoodKey, new Response(body, {
          headers: { ...headers, 'Cache-Control': `s-maxage=${STALE_SECONDS}` },
        })),
      ])
    );

    return new Response(body, { headers });
  } catch (e) {
    upstreamError = e;
  }

  const stale = await cache.match(lastGoodKey);
  if (stale) {
    const body = await stale.text();
    return new Response(body, {
      headers: jsonHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Stale': 'true',
        [ROW_COUNT_HEADER]: String(rowCount(body) ?? ''),
      }),
    });
  }

  return errorJson(
    {
      error: 'cap_unreachable',
      detail: String((upstreamError && upstreamError.message) || upstreamError),
    },
    502
  );
}
