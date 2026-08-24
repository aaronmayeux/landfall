/**
 * /api/seasons/live — which storms the CURRENT season has so far.
 * SPEC-SEASONS-BUILD.md §57.3, §57.13, §57.30 step 3b. SPEC-DATA.md §58.
 *
 * WHAT IT IS FOR. Seasons draws settled years out of the two HURDAT2 files
 * committed to this repo (`seasons/data/`, §58.2). Those files stop at the last
 * REVIEWED season — NOAA republishes them once a year, in February — so the
 * year currently happening is in neither of them. NOAA does publish it, as one
 * small ATCF b-deck per storm, and this route is the door to that directory.
 *
 * ==> IT IS AN INDEX, NOT A TRACK. <== It answers "which storms exist" and
 * nothing else. `/api/seasons/storm?id=al012026` hands back one storm's bytes.
 * Two routes rather than one because they cache on completely different clocks:
 * a season gains a storm a few times a year, and a storm gains a row every few
 * hours.
 *
 * ==> A PROJECTION, NOT LOGIC (§4.3). <== It reads a directory listing, applies
 * §57.13's storm-number filter, and reports what it dropped. It does not parse
 * a track, derive a category, or decide what a season MEANS. `lib/hurdat.js`
 * owns all of that, in the browser, where it can be debugged on a phone.
 *
 * ==> AND IT MUST AGREE WITH THE MIRROR, BYTE FOR BYTE, ON WHAT COUNTS. <==
 * `tools/seasons-mirror.mjs` walks the same directory every hour and stores the
 * same files onto the `seasons-live` branch. If the two disagree about which
 * files are real storms, a reader comparing this route against
 * `git show origin/seasons-live:manifest.json` sees two different seasons and
 * has no way to tell which one is wrong. Both apply the same rule; the mirror
 * imports it from `lib/hurdat.js` and this route carries the forced second copy
 * in `./_ids.js`, which `tools/test-seasons-ids.mjs` holds against the first.
 *
 * Pages Functions run in their own workerd runtime with no access to this
 * project's config (§4.13), so the numbers below mirror `SEASONS` and §4.13's
 * table by hand and say so, exactly as the rainfall and GDACS routes do.
 */

import { kvRead, isWarmRequest } from '../_kv-cache.js';
import { CACHE_PATH, CACHE_PATH_HEADER } from '../_cache-path.js';
import { indexFromListing } from './_ids.js';

/** NHC's live ATCF best-track directory. Current season only, one small file
 *  per system. The same URL `tools/seasons-mirror.mjs` walks. */
const BTK_INDEX = 'https://ftp.nhc.noaa.gov/atcf/btk/';

/** Be identifiable in NOAA's logs, same string as every other relay here. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** The KV path the cron Worker warms this route under (SPEC §17 Pass B).
 *  Must match `worker/src/sources.js` — tools/test-kv-keys.mjs asserts it. */
const KV_PATH = 'seasons/live';

/* --------------------------------------------------------------------------
 * CACHE, mirroring §4.13 by hand.
 *
 * FRESH 30 MINUTES. This payload changes when a season GAINS OR LOSES A STORM,
 * which happens a handful of times a year — not when a storm gains a row, which
 * is the other route's problem. Half an hour is far shorter than it needs to
 * be and is chosen for the §4.13 rule rather than for the data: it must not
 * equal the cron's own five-minute cadence, or the warmed entry ages out of its
 * window before the next cycle refreshes it and every colo falls through to
 * NOAA — the warm store paid for and bypassed. That collision is banned in
 * capitals and this is the sixth route written to avoid it.
 *
 * LAST-GOOD 9 H, the same window every other relay in this project uses. A
 * season index nine hours old is still a correct list of storms; NOAA being
 * down is not a reason to tell a reader the season is empty (§5).
 * ----------------------------------------------------------------------- */
const FRESH_SECONDS = 30 * 60;
const STALE_SECONDS = 9 * 60 * 60;

/** A cold miss cannot outlast the reader's patience (§4.13). One hop, and
 *  ftp.nhc.noaa.gov has measured slow on its bad days. */
const TIMEOUT_MS = 15_000;

const baseHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: baseHeaders(extra) });

async function getText(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const freshKey = new Request('https://landfall-relay.internal/seasons/live/fresh');
  const lastGoodKey = new Request('https://landfall-relay.internal/seasons/live/last-good');

  const warming = isWarmRequest(context.request, context.env);

  /* THE HIT IS REBUILT, NEVER HANDED BACK AS STORED (§17.7). The slot copies
   * carry `Cache-Control: s-maxage=...` because that is how `caches.default` is
   * told how long to keep them; returning one verbatim publishes that
   * instruction to the public internet and Cloudflare's own edge honours it. */
  const hit = warming ? null : await cache.match(freshKey);
  if (hit) {
    return new Response(await hit.text(), {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
        [CACHE_PATH_HEADER]: CACHE_PATH.FRESH,
      }),
    });
  }

  const warm = warming ? null : await kvRead(context.env, KV_PATH, FRESH_SECONDS);
  if (warm && warm.fresh) {
    const headers = baseHeaders({
      'X-Landfall-Fetched-At': warm.fetchedAt || '',
      [CACHE_PATH_HEADER]: CACHE_PATH.KV,
    });
    context.waitUntil(
      cache.put(freshKey, new Response(warm.body, {
        headers: { ...headers, 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
      }))
    );
    return new Response(warm.body, { headers });
  }

  let upstreamError;
  try {
    const listing = await getText(BTK_INDEX);
    const { listed, storms, skipped } = indexFromListing(listing);

    /* ==> A DIRECTORY THAT LISTS NOTHING IS A FAILURE, NOT AN EMPTY SEASON.
     * <== NHC's index has never been empty — the previous season's files stay
     * until the new one is seeded — so zero listed `.dat` files means the page
     * we got was not the page we asked for: a redirect, an error page, a
     * restyle we cannot read. Caching that globally would tell every reader on
     * Earth that no storm has ever happened this year. It falls through to
     * last-good instead, which is what §5 asks for.
     *
     * ZERO REAL STORMS OUT OF A NON-EMPTY LISTING IS DIFFERENT and is served:
     * in January that is simply true. */
    if (listed === 0) throw new Error('the b-deck directory listed no .dat files');

    const body = {
      status: 'ok',
      /* THE SEASON IS READ OFF THE FILENAMES, NEVER OFF THE CLOCK. A run on
       * 1 January must not decide the directory is showing it the new year. */
      years: [...new Set(storms.map((s) => s.year))].sort((a, b) => a - b),
      source: 'atcf',
      /* §57.11 — the app must be able to say WHICH record it is showing, and
       * it cannot say it if the shape does not carry it. These are working
       * best tracks, not the reviewed database. */
      provisional: true,
      listed,
      storms,
      skipped,
    };

    const fetchedAt = new Date().toISOString();
    const text = JSON.stringify(body);
    const headers = {
      'X-Landfall-Fetched-At': fetchedAt,
      [CACHE_PATH_HEADER]: CACHE_PATH.UPSTREAM,
    };

    context.waitUntil(Promise.all([
      cache.put(freshKey, new Response(text, {
        headers: { ...baseHeaders(headers), 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
      })),
      cache.put(lastGoodKey, new Response(text, {
        headers: { ...baseHeaders(headers), 'Cache-Control': `s-maxage=${STALE_SECONDS}` },
      })),
    ]));

    return new Response(text, { headers: baseHeaders(headers) });
  } catch (e) {
    upstreamError = e;
  }

  const stale = warming ? null : await cache.match(lastGoodKey);
  if (stale) {
    return new Response(await stale.text(), {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Stale': 'true',
        [CACHE_PATH_HEADER]: CACHE_PATH.LAST_GOOD,
      }),
    });
  }

  const kvStale = warming ? null : await kvRead(context.env, KV_PATH, STALE_SECONDS);
  if (kvStale) {
    return new Response(kvStale.body, {
      headers: baseHeaders({
        'X-Landfall-Fetched-At': kvStale.fetchedAt || '',
        'X-Landfall-Stale': 'true',
        [CACHE_PATH_HEADER]: CACHE_PATH.KV_STALE,
      }),
    });
  }

  /* Codes, never prose — the client is the layer with the context to write a
   * sentence (§4.3). And never an empty list: "we could not see" and "there
   * were no storms" are different facts and this app does not conflate them. */
  return json(
    { error: 'seasons_unreachable', detail: String(upstreamError?.message || upstreamError) },
    502
  );
}
