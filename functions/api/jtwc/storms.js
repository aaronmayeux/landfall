/**
 * /api/jtwc/storms — which storms JTWC is warning on right now, by NAME.
 *
 * WHY THIS EXISTS AT ALL. Phase 6 step 6 renders advisory text, and GDACS —
 * the app's only source outside the NHC basins — publishes none. That was
 * checked in four places on 2026-07-25 and the findings are recorded in
 * functions/api/jtwc/inspect.js next door: the event list carries a one-line
 * blurb, `geteventdata` has no narrative field at any depth, `documents` and
 * `additionalinfos` are both EMPTY OBJECTS, and `report.aspx` is eight
 * headings of tables. What GDACS does carry is `source: "JTWC"` — and JTWC
 * publishes the text. Without this route, every storm outside the Atlantic
 * and the eastern Pacific reads "no advisory text exists," which is a much
 * bigger and more wrong claim than the truth (§5, and the same false-claim
 * mistake step 5 shipped and had to correct).
 *
 * THIS IS A BOUNDED EXCEPTION TO §4's "THE RELAY STAYS DUMB", the second one
 * in the project after the a-deck filter. Recorded plainly, because an
 * unexplained exception is how a rule quietly dies.
 *
 * WHAT FORCED IT. GDACS gives a NAME ("NOUL-26") and no designation — its
 * `sourceid`, the field that would carry one, is an EMPTY STRING. JTWC's
 * product URL gives a DESIGNATION ("wp1126") and no name. The only place the
 * two meet is inside each warning's own header line:
 *
 *     SUBJ/TYPHOON 11W (NOUL) WARNING NR 008//
 *
 * The RSS itself cannot close the gap — measured, after a first parse got it
 * wrong: it carries ONE ITEM PER REGION ("Current Northwest Pacific/North
 * Indian Ocean* Tropical Systems"), listing several storms' products at once,
 * with no per-storm titles, no anchors, and no description text.
 *
 * So resolving a name means reading every active warning. Doing that in the
 * browser is up to eight cross-origin round trips — all of which come through
 * this relay anyway, because JTWC sends no CORS header (measured:
 * `Access-Control-Allow-Origin: null`) — on a phone, at the moment a user
 * taps a storm. Doing it here is one cached call for every storm and every
 * reader at once.
 *
 * WHY IT DOES NOT VIOLATE THE RULE'S INTENT. §4 keeps the relay dumb so the
 * parts that get TWEAKED stay debuggable on a phone plugged into a laptop —
 * the merge, the chronology, the intensity reads. This builds a lookup table
 * of four literal fields off one fixed header line. It interprets nothing and
 * renders nothing. The warning TEXT the reader actually sees is fetched raw
 * through /api/jtwc/warning and parsed in lib/advisory.js, in the browser,
 * like every other product in this app.
 *
 * THE DUPLICATED REGEX IS DELIBERATE AND GUARDED. `parseSubject` below is the
 * same match as `parseJtwcWarning` in lib/advisory.js, and it has to be — a
 * Pages Function runs in its own workerd runtime and cannot import the app
 * bundle (§3). Both are exported, and tools/test-advisory.mjs asserts they
 * agree on the same corpus. A copy nobody checks is how the two drift; a copy
 * with a test that fails when they disagree is just a copy.
 */

const HOST = 'https://www.metoc.navy.mil';
const RSS = `${HOST}/jtwc/rss/jtwc.rss`;

/** Be identifiable in the Navy's logs, same as the other relays. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/**
 * Storm warnings are `{basin}{nn}{yy}web.txt` — `wp1126web.txt`.
 *
 * This pattern also does the FILTERING, which is worth stating because it
 * looks like it does not. The RSS additionally links `abpwweb.txt` and
 * `abioweb.txt`, the Significant Tropical Weather Advisories — area bulletins
 * about disturbances that are not yet storms and have no designation. They
 * fail the four-digit requirement and drop out here rather than needing a
 * denylist that would go stale.
 */
const PRODUCT_RE = /\/products\/([a-z]{2}\d{4})web\.txt/gi;

/** How many warnings to read at once. JTWC has run three concurrent storms
 *  today and peaks around a dozen worldwide; six at a time finishes in one or
 *  two rounds without opening a dozen sockets to a government host. */
const CONCURRENCY = 6;

/** Hard ceiling on products read per call. A runaway feed must not turn one
 *  request into ninety upstream fetches. Well above any real storm count. */
const MAX_PRODUCTS = 20;

/** Fresh window. JTWC warns every 6 h with intermediates; 15 min is well
 *  inside a cycle and means selecting six storms in a row costs one index. */
const FRESH_SECONDS = 15 * 60;

/** Serve-stale window on upstream failure: ~1.5x advisory cadence, the same
 *  9 h every other relay in this project uses. */
const STALE_SECONDS = 9 * 60 * 60;

const TIMEOUT_MS = 15000;

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...extra,
    },
  });

/**
 * The identity line of a JTWC warning.
 *
 *   SUBJ/TYPHOON 11W (NOUL) WARNING NR 008//
 *   SUBJ/TROPICAL DEPRESSION 12W WARNING NR 001//     ← unnamed, no parens
 *
 * MUST STAY IDENTICAL to parseJtwcWarning in lib/advisory.js. Exported so
 * tools/test-advisory.mjs can hold the two against the same corpus.
 */
export function parseSubject(text) {
  const m = String(text || '').match(
    /SUBJ\/\s*([A-Z][A-Z '.-]*?)\s+(\d{2}[A-Z])\s*(?:\(([^)]*)\))?\s*WARNING\s+NR\s*(\d+)/i
  );
  if (!m) return null;
  const name = m[3] ? m[3].trim() : null;
  return {
    kind: m[1].trim(),
    designation: m[2].toUpperCase(),
    name: name || null,
    warningNumber: m[4] || null,
  };
}

async function getText(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain,application/xml,*/*' },
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Bounded-concurrency map. No dependencies, and no all-or-nothing: one dead
 *  product must not cost the other five their place in the index. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i]); } catch { out[i] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const freshKey = new Request('https://landfall-relay.internal/jtwc/storms/fresh');
  const lastGoodKey = new Request('https://landfall-relay.internal/jtwc/storms/last-good');

  const hit = await cache.match(freshKey);
  if (hit) return hit;

  let upstreamError;
  try {
    const rss = await getText(RSS);

    const pubDate = (rss.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate\s*>/i) || [])[1] || null;

    const keys = [...new Set([...rss.matchAll(PRODUCT_RE)].map((m) => m[1].toLowerCase()))]
      .slice(0, MAX_PRODUCTS);

    const parsed = await mapLimit(keys, CONCURRENCY, async (key) => {
      const text = await getText(`${HOST}/jtwc/products/${key}web.txt`);
      const subj = parseSubject(text);
      if (!subj) return null;
      return { ...subj, product: key };
    });

    const storms = parsed.filter(Boolean);

    /* THREE STATES, NOT TWO (§5). `clear` is JTWC genuinely warning on
     * nothing — a quiet ocean, which happens for months at a time. `partial`
     * is products listed that would not read or would not parse, which is a
     * DEGRADED index: a storm may be missing from it and the panel must not
     * say "no warning exists" on the strength of a list that is short. The
     * client distinguishes these; a boolean could not. */
    const state = keys.length === 0
      ? 'clear'
      : storms.length < keys.length
        ? 'partial'
        : 'ok';

    const body = JSON.stringify({
      state,
      /* THE FEED'S OWN AGE, separate from ours. A JTWC RSS frozen for three
       * weeks and a JTWC RSS with no storms in it look identical downstream,
       * and only one of them means "quiet ocean". */
      pubDate: pubDate ? pubDate.trim() : null,
      fetchedAt: new Date().toISOString(),
      productsListed: keys.length,
      storms,
    });

    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    };

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
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Landfall-Stale': 'true',
      },
    });
  }

  return json(
    { state: 'unavailable', detail: String(upstreamError?.message || upstreamError) },
    502
  );
}
