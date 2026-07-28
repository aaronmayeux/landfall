/**
 * /api/tcgp/adeck?storm=wp112026 — model guidance for the basins NOAA does
 * not publish (SPEC §4, §15).
 *
 * Forward-and-cache ONLY. Parsing lives in lib/adeck.js, in the browser, the
 * same as its NHC sibling. This function must stay dumb.
 *
 * ==> WHY IT EXISTS <==
 * `ftp.nhc.noaa.gov/atcf/aid_public/` serves `al`/`ep`/`cp` and nothing else,
 * so every West Pacific typhoon and Indian Ocean cyclone in the app drew no
 * guidance at all. UCAR's Tropical Cyclone Guidance Project publishes ATCF
 * a-decks for those basins. Measured 2026-07-26 on Noul (`wp112026`): 1.49 MB,
 * 15,299 rows, 87 model codes, zero unparsed rows, newest cycle the same day.
 *
 * ==> WHAT WE KEEP, AND WHY IT IS THREE ROWS AND NOT FIVE <==
 * NONE of the five NHC codes appear in a West Pacific deck. Confirmed by
 * reading one: no TVCN, no HCCA, no AVNO, no UKX, no HFSA. The deck is
 * dominated by ENSEMBLE MEMBERS — one model run twenty or thirty times from
 * slightly different starting conditions — from three centres:
 *
 *   AP01..AP30 + AC00 + AEMN   American  (GEFS)
 *   NP01..NP20 + NC00 + NEMN   US Navy   (NAVGEM)
 *   CP01..CP20 + CC00 + CEMN   Canadian  (GEPS)
 *
 * We keep the three `*EMN` rows: each is that centre's OWN published mean of
 * its own ensemble. Computing our own average from the members would be a
 * second answer to a question the source has already answered, free to
 * disagree with the plots TCGP publishes beside it.
 *
 * DELIBERATELY EXCLUDED, each for its own reason — this list is the argument,
 * so do not extend it without adding one:
 *   - `CARQ` is NOT A FORECAST. It is the storm's own analysed history and
 *     its forecast hours are NEGATIVE (measured: -24..0). Drawn as guidance it
 *     would paint the past as a prediction.
 *   - `CHIP`, `CHP2`..`CHP7` are MIT's CHIPS — an INTENSITY model. TCGP's own
 *     contributors page says it pulls CHIPS for intensity forecasts. Their
 *     positions are not a track product.
 *   - `UKM` (UKMET) is a single run with no ensemble, and its newest cycle ran
 *     12 h behind everything else in the deck. Aaron's call, 2026-07-26: not
 *     shown. A fourth line of a different kind, arriving late, would read as a
 *     peer of the three means and is not one.
 *   - `CMC` and `NGX` are the Canadian and Navy DETERMINISTIC runs — the same
 *     two centres already represented by CEMN and NEMN. Two lines per centre
 *     is noise, and the mean is the better of the pair for track.
 *   - The ~76 individual ensemble members. Shown as spaghetti they are the
 *     truest picture of spread, and that was the alternative build; Aaron
 *     chose three averages. If that is ever revisited the members are one
 *     constant away, and `?full=1` shows them today.
 *
 * The filter cuts roughly 97% — 1.49 MB down to about 460 rows — which is
 * what makes warming these decks on a phone defensible at all.
 *
 * ==> THE HOST IS A BETA URL, AND THAT IS A KNOWN RISK <==
 * TCGP's long-standing production host still serves storm pages, but its
 * current-storms index froze on 26 May 2026 and reports "no current storms"
 * in every basin while three were live. The host below was updated the same
 * hour it was read. So the fresh data is behind a path containing
 * `hurricanes-beta`, on a host named `verif.rap.ucar.edu`. If this route
 * starts 404ing everywhere at once, THAT is the first thing to check — and
 * the failure is honest either way, because a dead upstream here becomes
 * `unavailable` on the row rather than silence.
 *
 * ==> UCAR SAYS THIS IS NOT AN OPERATIONAL SERVICE <==
 * Their own guidelines state the site is not maintained 24/7 and may go down
 * without warning. That is not a disclaimer question, it is an ENGINEERING
 * one: this source will be unavailable sometimes, more often than NOAA, and
 * §5 requires that to look different from "no models are forecasting this
 * storm". The `none` / `unavailable` split below is that difference.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED on purpose — importing config/constants.js would couple a
 * static deploy to a bundler step this project does not have (§3).
 *
 * ==> NOT WARMED BY THE CRON WORKER YET. STATED, NOT HIDDEN. <==
 * `worker/src/sources.js` is untouched, so this route is colo-cached only —
 * the per-datacentre problem §17 Pass B exists to solve. That is acceptable
 * while it is one person's app and unacceptable before a busy season. The KV
 * read below is already wired, so warming this is a change on the worker side
 * alone whenever it is worth doing.
 */

import { kvRead, isWarmRequest } from '../_kv-cache.js';

const BASE = 'https://verif.rap.ucar.edu/jntweb/hurricanes-beta/realtime/plots';

/** SPEC §4 cache table: model a-decks fresh for 15 min, matching NHC's. TCGP
 *  publishes on the 6-hourly model cycle, so this is well inside one. */
const FRESH_SECONDS = 15 * 60;

/** Serve-stale window on upstream failure — longer than NHC's 9 h because
 *  this upstream is explicitly not operational. A day-old deck carrying its
 *  own visible cycle stamp still beats a blank layer (§5). */
const STALE_SECONDS = 18 * 60 * 60;

/** Be identifiable in UCAR's logs, same as every other relay. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/**
 * Basin code → TCGP's folder segment. EVERY ONE READ OFF A LIVE URL
 * 2026-07-26, not guessed from the basin's English name.
 *
 * Only the three NHC does not cover. `al`/`ep`/`cp` are absent deliberately:
 * the app has an authoritative deck for those from NOAA, and a second source
 * for the same storm is a way for two answers to disagree in front of a user.
 */
const BASIN_FOLDER = Object.freeze({
  wp: 'northwestpacific',
  io: 'northindian',
  sh: 'southernhemisphere',
});

/** `wp|io|sh` + two digits + a four-digit year, and NOTHING else reaches the
 *  upstream URL. A path built from a query parameter gets an allowlist, not an
 *  escape — `..%2f` cannot survive a pattern admitting eight known characters. */
const STORM_ID = /^(wp|io|sh)(\d{2})(\d{4})$/;

/**
 * The three we draw, DUPLICATED FROM config/constants.js
 * (`MODEL_TRACKS.techsGlobal`) because this runtime cannot import the app
 * bundle. constants.js is the truth and this mirrors it.
 *
 * IF A MODEL IS ADDED THERE AND NOT HERE the app asks for guidance the relay
 * has already thrown away, and the row draws nothing while looking healthy —
 * §5's silent failure. `?full=1` is what makes that diagnosable in one
 * request instead of a day.
 */
const KEEP_TECHS = new Set(['AEMN', 'NEMN', 'CEMN']);

/* ==> `?carq=1` — THE STORM'S OWN ANALYSED HISTORY, AND NOT GUIDANCE. <========
 *
 * `CARQ` is the one tech in this file deliberately excluded from KEEP_TECHS
 * that we nonetheless want, for a completely different purpose. Its forecast
 * hours are NEGATIVE (measured live: -24..0), so every row describes where the
 * storm HAS BEEN and how strong it WAS — which is exactly the number a GDACS
 * past bead has never had. GDACS publishes no wind for its own history, so
 * those beads fall back to the middle of a three-word class and stand a full
 * category too tall (map/storm-mesh.js).
 *
 * IT IS A SEPARATE MODE, NOT AN ADDITION TO KEEP_TECHS, and that separation is
 * the whole safety argument. Merged into the guidance response these rows would
 * reach map/layers/model-tracks.js, which draws what it is given — painting a
 * storm's past across the map as a five-day prediction. Two questions, two
 * answers, no chance of one arriving where the other was expected.
 *
 * Cheap: a handful of rows per cycle against the ~15,300 in a full deck, and
 * cached on the same terms as the guidance response rather than being a
 * debugging escape like `?full=1`. */
const CARQ_TECHS = new Set(['CARQ']);

/** Column 4 (zero-based) of an ATCF row is the model code. */
const TECH_COLUMN = 4;

const baseHeaders = (extra = {}) => ({
  'Content-Type': 'text/plain; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});

/**
 * Keep only the rows the app draws. Row ORDER and row CONTENT are untouched —
 * this deletes lines, it does not rewrite them, so what the client parses is
 * byte-identical to what UCAR published for those models.
 *
 * Walks to the fifth comma rather than splitting: a full split of 15,299 rows
 * allocates fifteen thousand throwaway arrays for five fields.
 */
function filterTechs(text, keep = KEEP_TECHS) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let start = 0;
    let col = 0;
    let end = -1;
    while (col <= TECH_COLUMN) {
      const comma = line.indexOf(',', start);
      if (comma === -1) { end = col === TECH_COLUMN ? line.length : -1; break; }
      if (col === TECH_COLUMN) { end = comma; break; }
      start = comma + 1;
      col += 1;
    }
    if (end === -1) continue;
    if (keep.has(line.slice(start, end).trim())) out.push(line);
  }
  return out.join('\n');
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const storm = String(url.searchParams.get('storm') || '').toLowerCase().trim();

  const match = STORM_ID.exec(storm);
  if (!match) {
    /* A 400, not a 502: a bad request is not a dead source, and the client
     * must not retry it (data/relay.js only retries 5xx — §4). */
    return new Response(
      JSON.stringify({ error: 'bad_storm_id' }),
      { status: 400, headers: baseHeaders({ 'Content-Type': 'application/json; charset=utf-8' }) }
    );
  }

  /* The diagnostic escape. Unfiltered decks are 1.5 MB, so this form is
   * deliberately NOT cached — it is a debugging read, not a path the app
   * takes, and caching it would spend the edge's quota on bytes nothing
   * renders. */
  const full = url.searchParams.get('full') === '1';

  /* The analysed-history mode. Keyed SEPARATELY at every cache layer below —
   * one URL must never be able to answer with the other's body, which is the
   * failure that would put a storm's past on the map as guidance. */
  const carq = url.searchParams.get('carq') === '1';
  const variant = carq ? 'carq' : 'models';

  const [, basin, , year] = match;
  const upstream = `${BASE}/${BASIN_FOLDER[basin]}/${year}/${storm}/a${storm}.dat`;

  const cache = caches.default;
  const freshKey = new Request(
    `https://landfall-relay.internal/tcgp/adeck/${storm}/${variant}/fresh`
  );
  const lastGoodKey = new Request(
    `https://landfall-relay.internal/tcgp/adeck/${storm}/${variant}/last-good`
  );

  const warming = isWarmRequest(context.request, context.env);
  const kvPath = `tcgp/adeck/${storm}/${variant}`;

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
    const r = await fetch(upstream, { headers: { 'User-Agent': USER_AGENT } });

    /* A MISSING DECK IS NOT AN ERROR, and this distinction is the whole §5
     * three-state rule. A storm that just formed, or an invest TCGP has not
     * opened a page for, answers 404. That is `none` — the client must say
     * "no guidance published yet", never "the source is down", and certainly
     * never draw nothing in silence. */
    if (r.status === 404) {
      return new Response('', {
        headers: baseHeaders({
          'X-Landfall-Adeck': 'none',
          'Cache-Control': `s-maxage=${FRESH_SECONDS}`,
        }),
      });
    }
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);

    /* NOT GUNZIPPED, unlike NHC's. Measured: TCGP serves a bare `.dat`, no
     * gzip magic number, 1,487,364 bytes of plain text. If that ever changes
     * the validator below fails closed rather than caching binary as guidance. */
    const raw = await r.text();

    /* Refuse to cache something that is not a deck. UCAR serving an outage
     * page would otherwise become "model guidance" for fifteen minutes, and a
     * parser handed HTML returns [] — which renders as a confident "no models
     * available" (§5's silence-on-failure).
     *
     * CHECKED BEFORE FILTERING, ON THE RAW BYTES. Filtering an error page
     * yields an empty string, which would sail past this test and cache as a
     * legitimately empty deck. */
    if (!/^[A-Z]{2},/m.test(raw)) throw new Error('upstream body is not an a-deck');

    if (full) {
      return new Response(raw, {
        headers: baseHeaders({ 'X-Landfall-Adeck': 'unfiltered' }),
      });
    }

    const body = filterTechs(raw, carq ? CARQ_TECHS : KEEP_TECHS);
    const fetchedAt = new Date().toISOString();
    const headers = baseHeaders({
      'X-Landfall-Fetched-At': fetchedAt,
      /* Names which question this body answers, so a mis-keyed cache shows up
       * as a wrong label rather than as a storm's past drawn as a forecast. */
      'X-Landfall-Adeck': variant,
    });

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
    JSON.stringify({
      error: 'adeck_unreachable',
      detail: String(upstreamError?.message || upstreamError),
    }),
    { status: 502, headers: baseHeaders({ 'Content-Type': 'application/json; charset=utf-8' }) }
  );
}
