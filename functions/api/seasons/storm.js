/**
 * /api/seasons/storm?id=al012026 — one storm's working best track, verbatim.
 * SPEC-SEASONS-BUILD.md §57.4a, §57.13, §57.30 step 3b. SPEC-DATA.md §58.
 *
 * WHAT IT SERVES. NHC's own ATCF b-deck file, unaltered — the same bytes
 * `tools/seasons-mirror.mjs` puts on the `seasons-live` branch every hour, and
 * the same bytes NOAA will later fold into HURDAT2. `lib/hurdat.js` parses it
 * in the browser. **Nothing is parsed here on purpose**: this route is a pipe,
 * and a second ATCF reader on the other side of a deploy boundary is the drift
 * this project has already paid for once (§4.3).
 *
 * ==> IT TAKES AN IDENTIFIER FROM A QUERY STRING AND BUILDS AN UPSTREAM URL
 * OUT OF IT. THAT IS THE DANGEROUS PART OF THIS FILE. <== There is exactly one
 * other route in this app that does that — `functions/api/nws/alert.js` — and
 * its header carries the argument in full. The short version: the id must match
 * `./_ids.js`'s pattern **anchored at both ends** or it is refused before any
 * fetch happens. Unanchored, `https://evil.example/?ok=al012026` passes a
 * `.test()` and this function then fetches it from inside Cloudflare's network,
 * under our User-Agent, with whatever that buys an attacker. The refusal cases
 * are asserted in `tools/test-seasons-ids.mjs` and the anchors are verified by
 * removing them and watching the suite go red.
 *
 * ==> AND THE FILTER IS PART OF THE GUARD, NOT A COURTESY. <== An id must also
 * be a REAL storm number. Invest numbers 90-99 are reused several times inside
 * one season, so serving `al922026` would hand a reader a file that means three
 * different systems on three different days with nothing saying which.
 *
 * ==> THIS ROUTE IS DELIBERATELY NOT WARMED INTO KV, AND THAT IS A DECISION
 * WITH A REASON. <== §57.30 step 3b reads as though the whole season should be
 * pulled into KV. Warming fourteen b-decks on a five-minute cron is 4,032
 * requests a day at a public government server for a feature nobody has opened
 * yet — impolite, and it buys nothing here that the per-colo cache does not
 * already buy. Seasons is opt-in and downloads once (§57.24), so per-storm
 * fetches are rare and bursty rather than constant. **The season INDEX is
 * warmed** (`live.js`), because that is the one request every reader makes.
 * If Seasons ever becomes a thing people open cold, this is the dial.
 */

import { CACHE_PATH, CACHE_PATH_HEADER } from '../_cache-path.js';
import { isRealStorm, filenameFromId } from './_ids.js';

const BTK = 'https://ftp.nhc.noaa.gov/atcf/btk';

/** Be identifiable in NOAA's logs, same string as every other relay here. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/* --------------------------------------------------------------------------
 * CACHE, mirroring §4.13 by hand.
 *
 * FRESH 15 MINUTES. A b-deck gains a row when an advisory lands — six-hourly
 * with intermediates between — so fifteen minutes is well inside a cycle and
 * means a reader stepping through a season's storms pays one upstream fetch
 * each rather than one per tap. It is deliberately not five: §4.13 bans a
 * fresh window equal to the cron cadence, and although nothing warms this
 * route today (see the header), a number that would break on the day somebody
 * adds it is a trap left lying about.
 *
 * LAST-GOOD 9 H. A best track nine hours old is still a best track and beats a
 * blank storm (§5). Its own last row carries a timestamp, so it can be read AS
 * old by anyone who looks.
 * ----------------------------------------------------------------------- */
const FRESH_SECONDS = 15 * 60;
const STALE_SECONDS = 9 * 60 * 60;

const TIMEOUT_MS = 15_000;

const textHeaders = (extra = {}) => ({
  'Content-Type': 'text/plain; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});

const jsonError = (obj, status) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const id = String(url.searchParams.get('id') || '').toLowerCase();

  /* ==> REFUSED BEFORE ANY FETCH. <== Nothing below this line runs on an id
   * this app did not recognise, which is the whole point of the check. */
  if (!isRealStorm(id)) {
    return jsonError(
      { error: 'bad_storm_id', detail: 'id must be an ATCF storm id in an NHC basin, e.g. al012026' },
      400
    );
  }

  const file = filenameFromId(id);
  const cache = caches.default;
  const key = `https://landfall-relay.internal/seasons/storm/${id}`;
  const freshKey = new Request(`${key}/fresh`);
  const lastGoodKey = new Request(`${key}/last-good`);

  /* THE HIT IS REBUILT, NEVER HANDED BACK AS STORED (§17.7). */
  const hit = await cache.match(freshKey);
  if (hit) {
    return new Response(await hit.text(), {
      headers: textHeaders({
        'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
        [CACHE_PATH_HEADER]: CACHE_PATH.FRESH,
      }),
    });
  }

  let upstreamError;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let r;
    try {
      r = await fetch(`${BTK}/${file}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    /* ==> A 404 IS AN ANSWER, NOT A FAILURE, AND IT MUST NOT BE CACHED AS ONE.
     * <== A storm that has not formed yet has no file. That is true right up
     * until the moment it stops being true, sometimes within the hour, so this
     * is reported and never stored — a remembered "no such storm" would outlive
     * the storm's own genesis. */
    if (r.status === 404) {
      return jsonError({ error: 'no_such_storm', detail: `NHC has no ${file}` }, 404);
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    const text = await r.text();

    /* An empty 200 is not a storm with no rows; it is a server having a bad
     * day. Storing it globally would blank a real track for everyone. */
    if (!text.trim()) throw new Error('the b-deck came back empty');

    const fetchedAt = new Date().toISOString();
    const headers = {
      'X-Landfall-Fetched-At': fetchedAt,
      [CACHE_PATH_HEADER]: CACHE_PATH.UPSTREAM,
    };

    context.waitUntil(Promise.all([
      cache.put(freshKey, new Response(text, {
        headers: { ...textHeaders(headers), 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
      })),
      cache.put(lastGoodKey, new Response(text, {
        headers: { ...textHeaders(headers), 'Cache-Control': `s-maxage=${STALE_SECONDS}` },
      })),
    ]));

    return new Response(text, { headers: textHeaders(headers) });
  } catch (e) {
    upstreamError = e;
  }

  const stale = await cache.match(lastGoodKey);
  if (stale) {
    return new Response(await stale.text(), {
      headers: textHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Stale': 'true',
        [CACHE_PATH_HEADER]: CACHE_PATH.LAST_GOOD,
      }),
    });
  }

  return jsonError(
    { error: 'storm_unreachable', detail: String(upstreamError?.message || upstreamError) },
    502
  );
}
