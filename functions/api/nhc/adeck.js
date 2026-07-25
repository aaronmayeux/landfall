/**
 * /api/nhc/adeck?storm=al052026 — the relay's second job (SPEC §4).
 *
 * Forward-and-cache ONLY. Parsing lives in lib/adeck.js, in the browser, where
 * it can be poked on a phone plugged into a laptop — the same reason the
 * NHC/GDACS merge is client-side (§4). This function must stay dumb.
 *
 * WHY IT EXISTS: `ftp.nhc.noaa.gov` sends no CORS header, so the browser
 * cannot fetch the deck directly. Same reason as /api/nhc/storms.
 *
 * IT DOES TWO THINGS BEYOND FORWARDING, AND THE SECOND ONE BENDS A SETTLED
 * RULE — so both are argued here rather than assumed.
 *
 * 1. IT GUNZIPS. The upstream file is `a<storm>.dat.gz` — a gzip FILE, not a
 *    gzip-encoded response, so no browser transparently inflates it.
 *    Decompressing here keeps the client free of a decompression path (and of
 *    the fallback that path would need on any engine missing
 *    DecompressionStream). Cloudflare re-compresses the text on the wire, so
 *    the phone still receives it compressed.
 *
 * 2. IT DROPS ROWS WHOSE MODEL CODE IS NOT ONE OF THE FIVE WE DRAW. §4 settles
 *    that the relay stays dumb, and this is a deliberate, bounded exception to
 *    that — recorded because an unexplained exception is how a rule quietly
 *    dies.
 *
 *    WHAT FORCED IT: decks are warmed for EVERY storm, not fetched for the
 *    selected one (Aaron, 2026-07-25 — selection should be instant, not a
 *    spinner). A busy season runs eight or nine concurrent NHC storms. A deck
 *    carries roughly a hundred model codes and runs to a few MB of text, so
 *    warming all of them unfiltered is megabytes over a cell network during a
 *    hurricane, which is precisely the phone this project's overriding lens
 *    exists to protect. Filtering to the shortlist cuts about 95%.
 *
 *    WHY IT DOES NOT VIOLATE THE RULE'S INTENT: §4 keeps the relay dumb so the
 *    MERGE stays debuggable on a phone plugged into a laptop — the
 *    NHC-beats-GDACS rules, the chronology rebuilds, the things tweaked often.
 *    An allowlist of five literal strings interprets nothing and decides
 *    nothing. Every real judgement — which cycle each model is on, what counts
 *    as stale, where to clip the back half, how to read tenths-of-a-degree
 *    coordinates — still runs in lib/adeck.js in the browser.
 *
 *    AND THE ESCAPE HATCH IS THE POINT: `?full=1` returns the deck unfiltered.
 *    When the next question needs the real bytes, they are one URL away, the
 *    same standing answer `/api/nhc/inspect` gives (§12). A filter with no way
 *    to see past it is the version of this that would have been a mistake.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, separate from
 * the app bundle, so this file is SELF-CONTAINED on purpose — importing
 * config/constants.js would couple a static deploy to a bundler step this
 * project does not have (§3). The numbers below mirror SPEC §4's cache table;
 * that table is the truth.
 */

import { kvRead, isWarmRequest } from '../_kv-cache.js';

const UPSTREAM = 'https://ftp.nhc.noaa.gov/atcf/aid_public/';

/** SPEC §4 cache table: model a-decks fresh for 15 min. Model cycles are
 *  6-hourly, so this is comfortably inside one cycle and a user toggling the
 *  layer on and off never re-pulls megabytes. */
const FRESH_SECONDS = 15 * 60;

/** Serve-stale window on upstream failure. A stale deck plus its visible
 *  cycle stamp beats a blank layer (§5) — and the client shows the cycle. */
const STALE_SECONDS = 9 * 60 * 60;

/** NOAA servers 403 requests with no User-Agent. Identify ourselves plainly. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** Storm ids are `al|ep|cp` + two digits + a four-digit year, and NOTHING
 *  else reaches the upstream URL. This is a path built from a query
 *  parameter, so the allowed shape is an explicit allowlist rather than an
 *  escape: `..%2f` and friends cannot survive a pattern that only admits
 *  eight known characters. */
const STORM_ID = /^(al|ep|cp)\d{2}\d{4}$/;

/**
 * The five model codes the app draws, DUPLICATED FROM config/constants.js
 * (`MODEL_TRACKS.techs`) because this runtime cannot import the app bundle.
 *
 * The duplication is the same one /api/nhc/storms carries for its cache
 * numbers, and it is load-bearing in the same way: constants.js is the truth
 * and this list mirrors it. IF A MODEL IS ADDED THERE AND NOT HERE, the app
 * will ask for a model the relay has already thrown away and the row will
 * draw nothing while looking healthy — §5's silent failure. The `?full=1`
 * escape below is what makes that diagnosable in one request instead of a
 * day.
 */
const KEEP_TECHS = new Set(['TVCN', 'HCCA', 'AVNO', 'UKX', 'HFSA']);

/** Column 4 (zero-based) of an ATCF row is the model code. */
const TECH_COLUMN = 4;

const baseHeaders = (extra = {}) => ({
  'Content-Type': 'text/plain; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});

/** Gzip bytes → text, using the runtime's own streaming inflater. */
async function gunzip(response) {
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

/**
 * Keep only the rows the app draws. Row ORDER and row CONTENT are untouched —
 * this deletes lines, it does not rewrite them, so what the client parses is
 * byte-identical to what NOAA published for those models.
 */
function filterTechs(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    /* Split only as far as the tech column. A full split of every row in a
     * multi-MB deck allocates tens of thousands of throwaway arrays; this
     * walks to the fifth comma and stops. */
    let start = 0;
    let col = 0;
    let end = -1;
    while (col <= TECH_COLUMN) {
      const comma = line.indexOf(',', start);
      if (comma === -1) { end = col === TECH_COLUMN ? line.length : -1; break; }
      if (col === TECH_COLUMN) { end = comma; break; }
      start = comma + 1;
      col++;
    }
    if (end === -1) continue;
    if (KEEP_TECHS.has(line.slice(start, end).trim())) out.push(line);
  }
  return out.join('\n');
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const storm = String(url.searchParams.get('storm') || '').toLowerCase().trim();

  if (!STORM_ID.test(storm)) {
    /* A 400, not a 502: this is a bad request, not a dead source, and the
     * client must not retry it (data/relay.js only retries 5xx — §4). */
    return new Response(
      JSON.stringify({ error: 'bad_storm_id' }),
      { status: 400, headers: baseHeaders({ 'Content-Type': 'application/json; charset=utf-8' }) }
    );
  }

  /* The diagnostic escape (see the header). Unfiltered decks are big, so this
   * form is deliberately NOT cached — it is a debugging read, not a path the
   * app takes, and caching it would spend the edge's quota on bytes nothing
   * renders. */
  const full = url.searchParams.get('full') === '1';

  const cache = caches.default;
  /* Two slots, per storm: FRESH (15 min, the normal path) and LAST-GOOD (9 h,
   * read only when upstream fails). Synthetic keys — they name the slot,
   * nothing routes to them. */
  const freshKey = new Request(`https://landfall-relay.internal/nhc/adeck/${storm}/fresh`);
  const lastGoodKey = new Request(`https://landfall-relay.internal/nhc/adeck/${storm}/last-good`);

  /* SPEC §17 Pass B. `full` already bypasses the cache — the unfiltered deck
   * is a debugging read, not a path the app takes — and it bypasses KV for
   * the same reason. What the cron warms is the FILTERED body, because that
   * is what the route serves and what every reader wants. */
  const warming = isWarmRequest(context.request, context.env);
  const kvPath = `nhc/adeck/${storm}`;

  const hit = full || warming ? null : await cache.match(freshKey);
  if (hit) return hit;

  const warm = full || warming ? null : await kvRead(context.env, kvPath, FRESH_SECONDS);
  if (warm && warm.fresh) {
    const headers = baseHeaders({ 'X-Landfall-Fetched-At': warm.fetchedAt || '' });
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
    const r = await fetch(`${UPSTREAM}a${storm}.dat.gz`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    /* A MISSING DECK IS NOT AN ERROR, AND THIS DISTINCTION IS THE WHOLE §5
     * THREE-STATE RULE. A storm that has just formed has no guidance run
     * against it yet, and NOAA answers 404. That is `none`, not `unavailable`
     * — the client must say "no guidance published yet", never "the source
     * is down", and certainly never draw nothing in silence. */
    if (r.status === 404) {
      return new Response('', {
        headers: baseHeaders({
          'X-Landfall-Adeck': 'none',
          'Cache-Control': `s-maxage=${FRESH_SECONDS}`,
        }),
      });
    }
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);

    const raw = await gunzip(r);

    /* Refuse to cache something that is not a deck. An upstream error page
     * would otherwise be served as "model guidance" for fifteen minutes, and
     * a parser handed HTML returns [] — which renders as a confident "no
     * models available" (§5's silence-on-failure). One real row is enough:
     * every ATCF line starts with a two-letter basin and a comma.
     *
     * CHECKED BEFORE FILTERING, ON THE RAW BYTES. Filtering an error page
     * yields an empty string, which would sail past this test and cache as a
     * legitimately empty deck — the validator has to see what NOAA actually
     * sent. */
    if (!/^[A-Z]{2},/m.test(raw)) throw new Error('upstream body is not an a-deck');

    if (full) {
      return new Response(raw, {
        headers: baseHeaders({ 'X-Landfall-Adeck': 'unfiltered' }),
      });
    }

    const body = filterTechs(raw);
    const fetchedAt = new Date().toISOString();
    const headers = baseHeaders({ 'X-Landfall-Fetched-At': fetchedAt });

    context.waitUntil(
      Promise.all([
        cache.put(
          freshKey,
          new Response(body, { headers: { ...headers, 'Cache-Control': `s-maxage=${FRESH_SECONDS}` } })
        ),
        cache.put(
          lastGoodKey,
          new Response(body, { headers: { ...headers, 'Cache-Control': `s-maxage=${STALE_SECONDS}` } })
        ),
      ])
    );

    return new Response(body, { headers });
  } catch (e) {
    upstreamError = e;
  }

  /* Upstream failed. Serve last-good flagged stale — the client shows it with
   * its cycle stamp (§5: stale plus a visible timestamp beats a blank). */
  const stale = await cache.match(lastGoodKey);
  if (stale) {
    const body = await stale.text();
    return new Response(body, {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Stale': 'true',
      }),
    });
  }

  /* Then the warm copy declined above as too old. The client shows the deck's
   * own cycle stamp, so a stale one is visibly stale (§5).
   *
   * A STORM WITH NO DECK YET IS NEVER WARMED, AND THAT IS CORRECT. NOAA
   * answers 404 for a storm no guidance has run against — the route returns
   * `X-Landfall-Adeck: none` with an empty body, and worker/src/kv.js refuses
   * to store an empty body. So a new storm keeps checking upstream every
   * cycle instead of caching "nothing exists", which is exactly the moment
   * the answer is about to change. */
  if (warm) {
    return new Response(warm.body, {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': warm.fetchedAt || '',
        'X-Landfall-Stale': 'true',
      }),
    });
  }

  /* Nothing cached and upstream down: an honest 502. The Layers row turns
   * this into "Model tracks unavailable — tap to retry", never raw text. */
  return new Response(
    JSON.stringify({ error: 'adeck_unreachable', detail: String(upstreamError?.message || upstreamError) }),
    { status: 502, headers: baseHeaders({ 'Content-Type': 'application/json; charset=utf-8' }) }
  );
}
