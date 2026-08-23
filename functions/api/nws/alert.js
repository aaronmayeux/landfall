/**
 * /api/nws/alert?id=… — ONE flood alert's own prose. §56.6.
 *
 * ==> THIS ROUTE EXISTS SO THE LIST DOES NOT HAVE TO CARRY THE PROSE, AND THAT
 * IS §56.6's OWN INSTRUCTION. <== `/api/nws/flood` drops `description` and
 * `instruction` from every alert; that projection takes 34,369 stored bytes to
 * 2,607 and a suite asserts the ratio. Measured on the archived national bytes,
 * the text is about 900 bytes of description and 100–750 of instruction PER
 * ALERT — so putting it back on the list would put roughly two kilobytes per
 * alert on every phone, on every poll, for a field most readers never open.
 *
 * **A reader who taps one chip wants one alert's words.** That is what this
 * serves: one alert, fetched when a panel opens, and never before.
 *
 * ==> THE INSTRUCTION IS THE HALF THAT MATTERS AND THE APP HAS NEVER SHOWN IT.
 * <== NWS writes the actionable sentence there — *This is a life threatening
 * situation*, *Turn around, don't drown*, *monitor later forecasts and be
 * prepared to take action*. Until now this app could tell a reader when a flood
 * warning expired and not what to do about it, which is the wrong half of a
 * hazard product to have.
 *
 * ==> THE ID IS VALIDATED BEFORE IT IS EVER PUT IN A URL. <== This is the only
 * route in the app that builds an upstream URL out of something the client
 * sent. An unchecked id is a request forgery: `?id=../../something` or an
 * absolute URL would make this function fetch whatever the caller named, using
 * our User-Agent, from inside Cloudflare's network. So the id must match NWS's
 * own CAP URN shape exactly, and anything else is refused before any fetch
 * happens. This is a solo project and that is not a reason to leave it open.
 *
 * ==> THE CACHE IS AN HOUR RATHER THAN THE LIST'S FIFTEEN MINUTES, AND THE
 * DIFFERENCE IS NOT AN OVERSIGHT. <== A CAP URN carries a content hash
 * (`urn:oid:2.49.0.1.840.0.<sha>.001.1`): a corrected or extended alert is
 * issued under a NEW id rather than mutating an old one. So the prose behind
 * one id is IMMUTABLE, and the fifteen-minute window the list needs — which
 * exists because an alert can EXPIRE inside it — does not apply to text that
 * cannot change. Whether the alert is still in force is the list's question and
 * the list still answers it every fifteen minutes.
 *
 * Pages Functions run in their own workerd runtime with no access to this
 * project's config (§4.13), so the User-Agent below is hand-copied from its
 * siblings and `tools/test-relay-mirrors.mjs` is what keeps the copies honest.
 */

import { CACHE_PATH, CACHE_PATH_HEADER } from '../_cache-path.js';

const ALERT = 'https://api.weather.gov/alerts';

/** ==> NWS ANSWERS 403 WITHOUT A CONTACT IN THE USER-AGENT. <== Hand-copied
 *  from `functions/api/nws/flood.js`; a Pages Function cannot import from
 *  another (§4.13). `tools/test-relay-mirrors.mjs` fails when they drift. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app, andy@getgravitate.app)';

/**
 * NWS's CAP URN, exactly.
 *
 * ==> ANCHORED AT BOTH ENDS, AND THE ANCHORS ARE THE WHOLE POINT. <== An
 * unanchored test passes on `https://evil.example/x?ok=urn:oid:2.49.0.1.840.0.aa.1.1`
 * and this function would then fetch it. `2.49.0.1.840.0` is the United States'
 * own OID branch, so even a valid CAP URN from another country is refused —
 * this route serves NWS products and nothing else.
 *
 * Verified against the archived national bytes:
 *   urn:oid:2.49.0.1.840.0.122acb9734e30164f2d052a3bc93b6de43cc7dd1.001.1
 */
const CAP_URN = /^urn:oid:2\.49\.0\.1\.840\.0\.[0-9a-f]{8,64}\.\d{1,3}\.\d{1,3}$/;

const FRESH_SECONDS = 60 * 60;

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
 * NWS's prose → the two fields this route serves.
 *
 * ==> THE LINE WRAPPING IS UNDONE AND THE PARAGRAPHS ARE KEPT. <== NWS wraps
 * these to about 66 columns for teletype, so a single newline is a wrap and a
 * blank line is a real paragraph break. Rendered raw into a phone-width panel
 * the text comes out ragged, with breaks in the middle of sentences that look
 * like the app is broken. Joining single newlines and keeping doubles gives
 * back the paragraphs the forecaster actually wrote.
 *
 * ==> AND NOT ONE WORD IS SUMMARISED, SHORTENED OR REPHRASED. <== §5's rule
 * carried into prose: a paraphrase of a hazard instruction is a hazard
 * instruction this app wrote. Whitespace is the only thing touched.
 *
 * ==> THE BULLET LINES ARE LEFT ALONE. <== `* Until 9:15 PM MDT` and
 * `* Flash Flooding caused by heavy rain` are a list NWS formatted on purpose,
 * and joining those wraps would run the list into one paragraph.
 *
 * Pure: no fetch, no clock. `tools/test-flood-alert.mjs` runs it over the
 * archived bytes.
 */
export function unwrapNws(text) {
  if (typeof text !== 'string' || !text) return null;

  return text
    .split(/\n\s*\n/)
    .map((para) =>
      para
        .split('\n')
        /* A line that STARTS a bullet keeps its own break; a line that
         * continues one is a wrap like any other. */
        .reduce((acc, line) => {
          const t = line.trim();
          if (!t) return acc;
          if (!acc.length || /^\*/.test(t)) acc.push(t);
          else acc[acc.length - 1] += ` ${t}`;
          return acc;
        }, [])
        .join('\n')
    )
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n\n') || null;
}

/**
 * One upstream alert body → the body this route serves.
 *
 * ==> IT CARRIES FOUR FIELDS AND NOT THE WHOLE ALERT. <== Everything else the
 * panel shows already travelled on the list, and serving it twice is two copies
 * of one fact that can disagree — the list's is the one the map was drawn from,
 * so the list's is the one that wins.
 *
 * Pure. `tools/test-flood-alert.mjs` runs it over the archived bytes.
 */
export function projectAlert(body) {
  const p = body?.properties || {};
  return {
    status: 'ok',
    id: p.id || null,
    /* What is happening. */
    description: unwrapNws(p.description),
    /* ==> WHAT TO DO ABOUT IT, WHICH IS THE FIELD THIS WHOLE ROUTE IS FOR. <==
     * Null is a real answer: not every product carries one. */
    instruction: unwrapNws(p.instruction),
    /* Also on the list, and repeated here for exactly one reason: this body is
     * what a test can stand on, and an office that disagreed between the two
     * would otherwise only be visible on glass. */
    senderName: p.senderName || null,
  };
}

export async function onRequestGet(context) {
  const id = new URL(context.request.url).searchParams.get('id') || '';

  /* ==> REFUSED BEFORE ANY FETCH, AND THE ERROR IS A CODE RATHER THAN PROSE.
   * <== The client is the layer with the context to write a sentence (§4.3). */
  if (!CAP_URN.test(id)) {
    return json({ error: 'bad_alert_id' }, 400);
  }

  const cache = caches.default;
  const key = new Request(`https://landfall-relay.internal/nws/alert/${id}`);

  const hit = await cache.match(key);
  if (hit) {
    return json(await hit.json(), 200, {
      'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
      [CACHE_PATH_HEADER]: CACHE_PATH.FRESH,
    });
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const fetchedAt = new Date().toISOString();
    const r = await fetch(`${ALERT}/${encodeURIComponent(id)}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
      signal: ctl.signal,
    });

    /* ==> A 404 IS A DIFFERENT FACT FROM AN OUTAGE AND GETS ITS OWN CODE. <==
     * NWS drops an alert from its store once it has been expired a while, so a
     * reader with a panel open across that moment gets a genuine "this is gone"
     * rather than "we could not reach the weather service". One is worth a
     * Retry and the other is not (§5). */
    if (r.status === 404) return json({ error: 'alert_gone' }, 404);
    if (!r.ok) throw new Error(`alert HTTP ${r.status}`);

    const body = { ...projectAlert(await r.json()), fetchedAt };
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
    return json({ error: 'alert_unreachable', detail: String(e?.message || e) }, 502);
  } finally {
    clearTimeout(timer);
  }
}
