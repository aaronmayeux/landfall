/**
 * seasons-live.js — the season still running. §57.30 step 5b, §58.1, §58.2.
 *
 * ==> IT IS A SECOND ROAD TO THE SAME SCREEN, AND THAT IS WHY IT IS A SECOND
 * FILE. <== `data/seasons.js` reads a settled year: one static file in this
 * repo, immutable, revised once a year. This reads the year currently
 * happening: two KV-backed routes, one small ATCF b-deck per storm, a
 * different parser, and an answer that changes every six hours. The two share
 * a shape at the board's door and nothing else, and folding them into one
 * module would have made every guard in it ask "which kind of year is this?"
 *
 * ==> THE SEASON IS READ OFF THE FILENAMES, NEVER OFF THE CLOCK. <== The route
 * derives its `years` from the b-deck directory listing, and this module
 * carries that through untouched. A reader opening the app on 1 January must
 * not be told the new season has started because their phone says so — NHC
 * seeds the new year's directory when it seeds it, and until then the season
 * in progress is the old one. Every year comparison in the feature keys on
 * this rather than on `new Date()`.
 *
 * ==> ONE STORM PER REQUEST, AND THEY ARE NOT WARMED. <== §58.3 says why: a
 * five-minute cron fanning out to fourteen b-decks is 4,032 requests a day at
 * a public government server for a feature nobody may open. Seasons is opt-in
 * and the browser's own cache does the repeat work, so these are rare and
 * bursty rather than constant. The concurrency cap is in `SEASONS` and it is
 * about the reader's phone as much as about NOAA's server: fifteen parallel
 * requests on a cell connection is fifteen slow requests, not one fast one.
 *
 * ==> A STORM THAT WILL NOT LOAD IS COUNTED, NEVER DROPPED. <== §5. The index
 * says fifteen and twelve arrive: the honest screen says twelve and names the
 * gap, because a season quietly three storms short looks exactly like a season
 * that had twelve. That count rides back with the storms rather than being
 * logged and forgotten.
 *
 * Imports config/ and lib/. No DOM, no map.
 */

import { SEASONS } from '../config/constants.js';
import { parseBdeck } from '../lib/hurdat.js';

/** Which storms this year has so far. Warmed by the cron (§58.1). */
const LIVE_URL = '/api/seasons/live';

/** One storm's b-deck, verbatim (§58.2). */
const STORM_URL = '/api/seasons/storm?id=';

/** Cloudflare sets this on a stored answer it could not refresh (§4.13). */
const STALE_HEADER = 'X-Landfall-Stale';

/** One in-flight or settled promise per key, so two callers asking for the
 *  same thing at once make one request. Failures fall out of the map so a
 *  retry is a real retry — a rejected promise left in a cache turns one bad
 *  moment on a train into a permanently broken season. */
const inflight = new Map();

function once(key, make) {
  if (inflight.has(key)) return inflight.get(key);
  const p = make().catch((e) => {
    inflight.delete(key);
    throw e;
  });
  inflight.set(key, p);
  return p;
}

/**
 * Which storms the current season has so far.
 *
 * @returns {Promise<
 *   {status:'ok', year:number|null, years:number[], storms:Array,
 *    stale:boolean, fetchedAt:string}
 *   | {status:'unavailable', reason:string}
 * >}
 *
 * ==> `year` IS THE NEWEST THE LISTING KNOWS ABOUT, AND IT IS THE FEATURE'S
 * DEFINITION OF "NOW". <== The route reports every year it saw because a
 * directory in early January legitimately holds two; the board needs one
 * number to compare a chosen season against, and the newest is the season in
 * progress by construction. Null when the listing named none, which is a
 * shape NHC has never published and is treated as "there is no live season"
 * rather than guessed at.
 */
export function loadLiveIndex() {
  return once(LIVE_URL, async () => {
    const res = await fetch(LIVE_URL, { credentials: 'omit' });
    if (!res.ok) throw new Error(`the current season answered ${res.status}`);
    const body = await res.json();
    return {
      body,
      stale: String(res.headers.get(STALE_HEADER) || '') === 'true',
      fetchedAt: res.headers.get('X-Landfall-Fetched-At') || '',
    };
  })
    .then(({ body, stale, fetchedAt }) => {
      const years = (Array.isArray(body?.years) ? body.years : [])
        .map(Number).filter(Number.isFinite);
      return {
        status: 'ok',
        year: years.length ? Math.max(...years) : null,
        years,
        storms: Array.isArray(body?.storms) ? body.storms : [],
        stale,
        fetchedAt,
      };
    })
    .catch((e) => ({ status: 'unavailable', reason: String(e?.message || e) }));
}

/**
 * Which of the live index's storms belong to a basin the archive shows.
 *
 * ==> THE CENTRAL PACIFIC RIDES WITH THE EAST PACIFIC, AND THAT IS NOAA'S OWN
 * FILING RATHER THAN OUR TIDYING. <== Measured in this repo's settled files:
 * `epacific-2024` carries CP012024 and `epacific-2025` carries CP012025 and
 * CP022025. The reviewed record puts them in one file under one heading, so
 * splitting them here would make the season in progress disagree with every
 * year behind it — and Lala and Moke would fall off the board entirely.
 */
export function liveStormsIn(liveIndex, basin, year) {
  const tokens = SEASONS.liveBasins[basin];
  if (!tokens) return [];
  return (liveIndex?.storms || []).filter(
    (s) => tokens.includes(String(s?.basin || '').toUpperCase())
      && Number(s?.year) === Number(year)
  );
}

/** One storm's track. The bytes are NHC's, unaltered; `lib/hurdat.js` reads
 *  them here in the browser, where they can be debugged on a phone (§58.2). */
function loadStorm(id) {
  const url = STORM_URL + encodeURIComponent(id);
  return once(url, async () => {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`${id} answered ${res.status}`);
    return res.text();
  }).then((text) => parseBdeck(text, { id }));
}

/**
 * Run `jobs` a few at a time. A plain `Promise.all` over fifteen b-decks opens
 * fifteen connections at once, which on a phone is fifteen slow ones rather
 * than one fast one, and is impolite at a government server besides.
 */
async function pooled(items, limit, run) {
  const out = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await run(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * One season in progress, in the shape `data/seasons.js` hands back for a
 * settled year.
 *
 * @param {object} liveIndex  from `loadLiveIndex`
 * @param {string} basin      `atlantic` or `epacific`, as `seasons/index.json` keys them
 * @param {number} year
 * @returns {Promise<
 *   {status:'ok', storms:Array, faults:Array, unreadable:number,
 *    year:number, basin:string, provisional:true}
 *   | {status:'unavailable', reason:string, year:number, basin:string}
 * >}
 *
 * ==> AN EMPTY BASIN IS `ok`, NOT `unavailable`. <== A season that has not had
 * an Atlantic storm yet is a real and ordinary answer in June, and it is the
 * distinction §5 exists to protect: "the season is quiet so far" and "we could
 * not reach NHC" must never draw the same blank list. This function only fails
 * when the storms it was told about could not be fetched AT ALL — one that
 * loads and one that does not is a partial answer, and partial answers are
 * served with the gap named.
 */
export async function loadLiveSeason(liveIndex, basin, year) {
  const wanted = liveStormsIn(liveIndex, basin, year);

  if (!wanted.length) {
    return {
      status: 'ok', storms: [], faults: [], unreadable: 0,
      year, basin, provisional: true,
    };
  }

  const results = await pooled(
    wanted, SEASONS.liveFetchConcurrency,
    (s) => loadStorm(s.id).catch((e) => ({ storm: null, faults: [], error: e }))
  );

  const storms = [];
  const faults = [];
  let unreadable = 0;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r?.storm) {
      unreadable++;
      /* Named rather than swallowed. The console is where the next session
       * finds out WHICH storm and why; the reader gets the count. */
      if (r?.error) console.warn(`[landfall] ${wanted[i].id} could not be read:`, r.error);
      continue;
    }
    storms.push(r.storm);
    for (const f of r.faults) faults.push({ ...f, storm: wanted[i].id });
  }

  /* ==> EVERY STORM FAILING IS AN OUTAGE, NOT A QUIET SEASON. <== The index
   * said there were storms and not one of them arrived: the record has not
   * gone quiet, the road to it has. Reporting `ok` with an empty list here
   * would be the all-clear-during-an-outage bug in its purest form. */
  if (!storms.length) {
    return {
      status: 'unavailable',
      reason: `none of the ${wanted.length} storms this season could be read`,
      year,
      basin,
    };
  }

  /* Chronological, by when each storm began — the order the season happened
   * in, which is the order §57.18 says the roster IS. The b-decks arrive in
   * storm-number order, which is nearly the same and not reliably so. */
  storms.sort((a, b) => (a.points[0]?.time ?? 0) - (b.points[0]?.time ?? 0));

  return { status: 'ok', storms, faults, unreadable, year, basin, provisional: true };
}

/** Drop everything held. For tests, and for the retry path — a season the
 *  reader asks for again should be a real second attempt. */
export function clearLiveCache() {
  inflight.clear();
}
