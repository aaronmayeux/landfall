/**
 * /api/volcano/inspect — READ-ONLY probe into why BoM refuses the ash relay.
 *
 * WHY THIS EXISTS. Same reason as its four siblings under functions/api/*:
 * the cloud sandbox has NO SOCKET EGRESS — `curl` returns 000 for every
 * volcano and VAAC host tried, twelve for twelve — while the deployed site
 * reaches all of them. So the only place this question can be asked is here.
 *
 * THE SPECIFIC QUESTION, and it is narrow on purpose. `/api/volcano/live`
 * reported `transports.bomError: "HTTP 403"` on a fresh execution at
 * 2026-07-30T04:52:39Z. BoM is not slow and it is not misrouting — it is
 * ACTIVELY REFUSING US, and a 403 string cannot say which of three things it
 * is refusing:
 *
 *   1  our User-Agent — `Landfall/1.0 (+url)` is bot-shaped, and BoM's own
 *      robots.txt already discriminates per agent, hard-blocking some by name
 *      and giving Googlebot/Bingbot different rules including one about query
 *      parameters. A site that discriminates by agent in robots very often
 *      discriminates by agent at its edge.
 *   2  the `Cache-Control: no-cache` + `Pragma: no-cache` REQUEST headers that
 *      `live.js`'s `pull()` sends to every upstream. Some government CDN
 *      configurations refuse a no-cache request outright.
 *   3  datacenter egress, which no header defeats.
 *
 * ==> TWO CANDIDATES ARE ALREADY DEAD AND MUST NOT BE RE-PROBED. <== The
 * 8-second timeout is not it: a 403 is an answer, not a silence. And the
 * `?cb=` cache-buster on a `.shtml` is not it either — the same URL WITH the
 * parameter was fetched successfully out-of-band on 2026-07-30 and returned a
 * page stamped two minutes old with all eight centre headings present. The
 * cache-buster stays: it is the thing defeating the 29-day stale-page trap
 * documented in `live.js`, and giving it up to chase a dead lead would trade a
 * diagnosable 403 for a silent month-old-ash bug.
 *
 * WHY THE 403 BODY IS THE POINT. A WAF says who it is. "Access Denied" plus a
 * reference number identifies the vendor, and the response headers name the
 * cache in front of the origin. That is the difference between "BoM refuses
 * bots" (fixable with one header) and "BoM refuses this network" (not fixable,
 * and the tgftp fallback becomes primary). So this route reports the refusal
 * TEXT, not just its number.
 *
 * ==> SEQUENTIAL, NOT PARALLEL, AND THAT IS THE WHOLE VALIDITY OF THE TEST.
 * <== Six concurrent requests from one address to one government host is
 * itself a thing an edge can refuse, and if it did, every variant would come
 * back 403 and the report would read "nothing works" — a confounded answer
 * that looks exactly like the datacenter-block verdict. Since we already know
 * the failure is a fast 403 rather than a timeout, the variants return
 * quickly, so serialising them costs little and buys a result that means
 * something.
 *
 * SAFE TO LEAVE DEPLOYED, on the same terms as the other four. It:
 *   - only ever GETs from two hardcoded hosts, `www.bom.gov.au` and `tgftp`,
 *   - takes no URL, no host and no path from the caller — this is NOT a proxy,
 *   - writes nothing, anywhere, and caches nothing,
 *   - needs `INSPECT_KEY`, and refuses with a 404 without it (§17 A2).
 *
 * USAGE:
 *   /api/volcano/inspect?key=<INSPECT_KEY>          → the six BoM variants
 *   /api/volcano/inspect?key=...&tgftp=1            → also probe the fallback
 *
 * DELETE THIS ROUTE ONCE THE ASH TRANSPORT IS SETTLED. It answers one
 * question. Its four siblings earned permanence by answering standing
 * questions about feeds the app reads continuously; this one is a bisect, and
 * a bisect left deployed becomes a thing nobody remembers the purpose of.
 */

import { guardInspect } from '../_inspect-guard.js';

/** The one page under test. Fixed, not caller-supplied. */
const BOM_URL = 'https://www.bom.gov.au/products/Volc_ash_recent.shtml';

/** The fallback host, probed only on request. Its three `fvps*` slots are
 *  already known-good from the Worker — `live.js` reports
 *  `wellington: [true, true, true]` — so what is NOT yet known is whether the
 *  DIRECTORY LISTING is readable, which is what promoting tgftp to primary for
 *  all nine centres would depend on. */
const TGFTP_DIR = 'https://tgftp.nws.noaa.gov/data/raw/fv/';

/** Byte-identical to `live.js`. If these drift the probe stops testing
 *  production and starts testing itself. */
const LANDFALL_UA = 'Landfall/1.0 (+https://landfall.getgravitate.app)';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 ' +
  'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** How much refusal text to keep. A WAF block page states its case in the
 *  first paragraph; anything past that is boilerplate and markup. */
const BODY_SAMPLE = 700;

/** Response headers worth reporting. A cache or WAF in front of an origin
 *  names itself in these, and the vendor is half the diagnosis. */
const HEADERS_OF_INTEREST = Object.freeze([
  'server',
  'via',
  'x-cache',
  'x-cache-hits',
  'age',
  'content-type',
  'content-length',
  'cf-ray',
  'x-akamai-transformed',
  'x-iinfo',
  'set-cookie',
  'x-frame-options',
  'retry-after',
]);

/**
 * The six variants, ordered so the first is production EXACTLY as it runs
 * today. That ordering matters: if variant `a` succeeds, the 403 is
 * intermittent and every conclusion drawn from a single reading is worthless,
 * which is a finding in itself and one worth learning first.
 */
const VARIANTS = Object.freeze([
  {
    id: 'a-production',
    what: 'exactly what live.js sends today',
    ua: LANDFALL_UA,
    bust: true,
    noCacheHeaders: true,
    timeoutMs: 8000,
  },
  {
    id: 'b-browser-ua',
    what: 'production, but a browser-shaped User-Agent',
    ua: BROWSER_UA,
    bust: true,
    noCacheHeaders: true,
    timeoutMs: 8000,
  },
  {
    id: 'c-no-cache-headers-dropped',
    what: 'production, but without Cache-Control/Pragma no-cache',
    ua: LANDFALL_UA,
    bust: true,
    noCacheHeaders: false,
    timeoutMs: 8000,
  },
  {
    id: 'd-browser-plain',
    what: 'browser UA, no cache-buster, no no-cache headers',
    ua: BROWSER_UA,
    bust: false,
    noCacheHeaders: false,
    timeoutMs: 8000,
  },
  {
    id: 'e-no-headers-at-all',
    what: 'bare fetch — whatever the runtime sends by default',
    ua: null,
    bust: false,
    noCacheHeaders: false,
    timeoutMs: 8000,
  },
  {
    id: 'f-production-long-timeout',
    what: 'production with a 20s timeout, to retire the slow-page theory for good',
    ua: LANDFALL_UA,
    bust: true,
    noCacheHeaders: true,
    timeoutMs: 20000,
  },
]);

const json = (obj) =>
  new Response(JSON.stringify(obj, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      /* Never cached, at any layer. A cached diagnostic is a diagnostic that
       * answers a question you asked ten minutes ago. */
      'Cache-Control': 'no-store',
    },
  });

/** Same cache-buster shape `live.js` uses, at request granularity here because
 *  a probe has no colo cache to protect. */
const bust = (url) => {
  const u = new URL(url);
  u.searchParams.set('cb', String(Date.now()));
  return u.toString();
};

/** The page states its own age near the top. Finding it proves we got the
 *  real document rather than a plausible-looking cached or block page —
 *  the stale-cache trap wearing a 200. */
const stamp = (text) => {
  const m = /(\d{2}:\d{2})\s*UTC,\s*(\d{2}\/\d{2}\/\d{4})/.exec(text);
  return m ? m[0] : null;
};

async function probe({ url, ua, bustQuery, noCacheHeaders, timeoutMs }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const headers = {};
  if (ua) headers['User-Agent'] = ua;
  if (noCacheHeaders) {
    headers['Cache-Control'] = 'no-cache';
    headers.Pragma = 'no-cache';
  }
  try {
    const r = await fetch(bustQuery ? bust(url) : url, { signal: ctl.signal, headers });
    const text = await r.text();
    const seen = {};
    for (const h of HEADERS_OF_INTEREST) {
      const v = r.headers.get(h);
      if (v !== null) seen[h] = v;
    }
    return {
      status: r.status,
      ok: r.ok,
      bytes: text.length,
      /* Three cheap questions of the body: is it the advisory page, does it
       * say how old it is, and — if it is a refusal — what does the refusal
       * actually say. */
      looksLikeAdvisoryPage: /VA\s+ADVISORY|VAAC/i.test(text),
      pageStamp: stamp(text),
      headers: seen,
      bodySample: text.slice(0, BODY_SAMPLE),
    };
  } catch (e) {
    return {
      status: null,
      ok: false,
      error: e && e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String(e?.message || e),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn the six readings into one sentence, because a table of status codes is
 * where a diagnosis stalls. Every branch here names the FIX, not just the
 * cause — the point of the probe is to end with a decision.
 */
function verdict(results) {
  const by = (id) => results.find((r) => r.variant === id)?.result || {};
  const good = (r) => r.ok && r.looksLikeAdvisoryPage;

  const a = by('a-production');
  const b = by('b-browser-ua');
  const c = by('c-no-cache-headers-dropped');
  const d = by('d-browser-plain');
  const e = by('e-no-headers-at-all');

  if (good(a)) {
    return (
      'Production request SUCCEEDED here. The 403 is intermittent or ' +
      'rate-based, not a flat refusal — do not fix a header on the strength ' +
      'of one reading. Re-run this probe several times before changing ' +
      'anything, and treat a retry-with-backoff as the likely shape.'
    );
  }
  if (good(b) && !good(c)) {
    return (
      'THE USER-AGENT IS THE CAUSE. A browser-shaped UA is accepted where ' +
      'ours is refused, and dropping the no-cache headers alone does not ' +
      'help. Fix: send a browser-shaped UA to bom.gov.au only, with the ' +
      'honest Landfall identifier appended — the same arrangement, and the ' +
      'same reasoning, already used for volcano.si.edu.'
    );
  }
  if (good(c) && !good(b)) {
    return (
      'THE no-cache REQUEST HEADERS ARE THE CAUSE. BoM refuses them and ' +
      'accepts our own User-Agent. Fix: drop Cache-Control/Pragma for ' +
      'bom.gov.au only and keep the ?cb= parameter, which is independently ' +
      'proven to defeat the stale-page trap.'
    );
  }
  if (good(b) && good(c)) {
    return (
      'BOTH the UA and the no-cache headers independently unblock the fetch, ' +
      'so either alone is sufficient. Prefer dropping the no-cache headers: ' +
      'it keeps our honest identifier in BoM logs and claims nothing about ' +
      'what we are.'
    );
  }
  if (good(d) || good(e)) {
    return (
      'Only the plainest variants succeed, so the refusal is triggered by ' +
      'some combination of what we add rather than by the network. Compare ' +
      'the successful variants field by field below and remove the trigger.'
    );
  }
  return (
    'EVERY VARIANT REFUSED. No header combination reaches BoM from this ' +
    'runtime, which points at the network rather than the request — read the ' +
    'bodySample and the server/x-iinfo headers to identify the WAF and ' +
    'confirm. If that holds, BoM is not fixable from a Worker and the honest ' +
    'path is promoting the tgftp fv* slots to primary for all nine centres, ' +
    'accepting the loss of seven days of history and saying so in the payload.'
  );
}

export async function onRequestGet(context) {
  const denied = guardInspect(context);
  if (denied) return denied;

  const url = new URL(context.request.url);

  const results = [];
  for (const v of VARIANTS) {
    /* Awaited in sequence deliberately — see the header. */
    // eslint-disable-next-line no-await-in-loop
    const result = await probe({
      url: BOM_URL,
      ua: v.ua,
      bustQuery: v.bust,
      noCacheHeaders: v.noCacheHeaders,
      timeoutMs: v.timeoutMs,
    });
    results.push({ variant: v.id, what: v.what, result });
  }

  const payload = {
    question: 'Why does bom.gov.au answer HTTP 403 to the ash relay?',
    target: BOM_URL,
    ranAt: new Date().toISOString(),
    alreadyRuledOut: [
      'the 8s timeout — a 403 is an answer, not a silence',
      'the ?cb= parameter on a .shtml — the same URL with it fetched fine ' +
        'out-of-band on 2026-07-30, page stamped two minutes old, all eight ' +
        'centre headings present',
    ],
    verdict: verdict(results),
    results,
  };

  if (url.searchParams.get('tgftp') === '1') {
    payload.fallback = {
      target: TGFTP_DIR,
      why:
        'The three fvps* slots are already known-good from the Worker. What ' +
        'is unknown is whether the directory listing is readable, which is ' +
        'what promoting tgftp to primary for all nine centres depends on.',
      result: await probe({
        url: TGFTP_DIR,
        ua: LANDFALL_UA,
        bustQuery: false,
        noCacheHeaders: true,
        timeoutMs: 8000,
      }),
    };
  }

  return json(payload);
}
