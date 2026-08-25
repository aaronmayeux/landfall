/**
 * seasons.js — getting a year's storms off the wire. §57.30 step 5, §58.2.
 *
 * ==> ONE SEASON IS A SMALL STATIC FILE AND THAT IS THE WHOLE DESIGN. <== The
 * monthly runner cuts each HURDAT2 basin into one file per year (§57.35 FIX 12,
 * `SPEC-OPS.md` §18.8), so opening 2005 costs 13.5 KB over the wire — measured,
 * gzipped, against the 119 KB the file is on disk — and about 14 ms of parsing.
 * The whole-basin file still exists for step 9's since-1851 index, which is now
 * its only reader — step 8's offline download was the other one and was deleted
 * on 2026-08-25 (§57.30). Nothing on THIS path ever touches it.
 *
 * ==> EVERY FILENAME CARRIES NOAA'S REVISION STAMP, SO NOTHING HERE BUSTS A
 * CACHE. <== `atlantic-2005-02272026.txt` is immutable for a year by `_headers`
 * and may be: NOAA revises seasons it has already published, and a revision
 * lands as a NEW filename that `index.json` starts pointing at. The index is
 * the one mutable file in the feature and it is fetched `no-cache`, which is
 * why this module always resolves a year THROUGH the index rather than
 * assembling a filename itself. A built filename would be a guess that works
 * for eleven months and then serves a 404 on the whole archive.
 *
 * ==> THREE STATES, ALWAYS, AND `empty` IS NOT ONE OF THEM HERE. <== §5. This
 * module answers `ok`, `unavailable` or throws nothing at all — a season with
 * no storms in it is a real and ordinary answer (the Atlantic had two in 1914)
 * and it comes back as `ok` with an empty list. The distinction the reader
 * needs is between "we could not reach the record" and "the record says this
 * year was quiet", and collapsing those is exactly the all-clear-during-an-
 * outage bug §5 exists to forbid.
 *
 * CACHED IN MEMORY FOR THE SESSION, and deliberately not beyond it. A reader
 * flipping between 2004 and 2005 should pay once; a reader who closes the tab
 * gets the durable half from the browser's own HTTP cache, because every one of
 * these URLs is immutable. **Seasons keeps no store of its own on the device and
 * is not going to** — §57.30 step 8 was deleted on 2026-08-25 and §57.34 rules 5
 * and 6 went with it.
 *
 * Imports config/ and lib/. No DOM, no map.
 */

import { parseHurdat2 } from '../lib/hurdat.js';

/** The index of every season we hold. Mutable on the server, `no-cache` in
 *  `_headers`, and the only door to a filename. */
const INDEX_URL = '/seasons/index.json';

/** One in-flight or settled promise per key, so two callers asking for the
 *  same year at once make one request. Keyed by URL for the season files and
 *  by a constant for the index. */
const inflight = new Map();

/** Fetch once, share the answer, and let a FAILURE fall out of the map so a
 *  retry is a real retry. A rejected promise left in a cache turns one bad
 *  moment on a train into a permanently broken year. */
function once(key, make) {
  if (inflight.has(key)) return inflight.get(key);
  const p = make().catch((e) => {
    inflight.delete(key);
    throw e;
  });
  inflight.set(key, p);
  return p;
}

async function getText(url) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

/**
 * The archive index — which basins exist, and which years each one holds.
 *
 * @returns {Promise<{status:'ok', index:object} | {status:'unavailable', reason:string}>}
 */
export function loadIndex() {
  return once(INDEX_URL, async () => {
    const res = await fetch(INDEX_URL, { credentials: 'omit', cache: 'no-cache' });
    if (!res.ok) throw new Error(`the archive index answered ${res.status}`);
    return res.json();
  })
    .then((index) => ({ status: 'ok', index }))
    .catch((e) => ({ status: 'unavailable', reason: String(e?.message || e) }));
}

/**
 * Which years a basin holds, newest first, straight off the index.
 * Returns an empty array for a basin the index does not carry.
 */
export function seasonsIn(index, basin) {
  const seasons = index?.basins?.[basin]?.seasons;
  if (!seasons) return [];
  return Object.keys(seasons)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
}

/** The basins the index carries, in the order it lists them. */
export function basinsIn(index) {
  return Object.keys(index?.basins || {});
}

/** A basin's display name — `Atlantic`, `East Pacific` — from the index rather
 *  than from a table here, so the runner owns the wording. */
export function basinLabel(index, basin) {
  return index?.basins?.[basin]?.label || basin;
}

/**
 * One season's storms.
 *
 * @param {object} index  from `loadIndex`
 * @param {string} basin
 * @param {number} year
 * @returns {Promise<
 *   {status:'ok', storms:Array, faults:Array, year:number, basin:string}
 *   | {status:'unavailable', reason:string, year:number, basin:string}
 * >}
 *
 * ==> PARSE FAULTS TRAVEL WITH THE STORMS RATHER THAN FAILING THE YEAR. <==
 * `parseHurdat2` returns them instead of throwing, precisely so one unreadable
 * row cannot lose a whole season. They are carried up so the board can say a
 * year is INCOMPLETE, which is a different sentence from a year being missing
 * and a different one again from a year being quiet.
 */
export function loadSeason(index, basin, year) {
  const dir = index?.dir || '/seasons/data';
  const file = index?.basins?.[basin]?.seasons?.[String(year)];

  /* Not a network failure, and it must not be reported as one. The index is
   * the authority on which years exist, so a year missing from it is a year
   * the archive genuinely does not hold. */
  if (!file) {
    return Promise.resolve({
      status: 'unavailable',
      reason: 'not_in_index',
      year,
      basin,
    });
  }

  const url = `${dir}/${file}`;
  return once(url, () => getText(url))
    .then((text) => {
      const { storms, faults } = parseHurdat2(text);
      return { status: 'ok', storms, faults, year, basin };
    })
    .catch((e) => ({
      status: 'unavailable',
      reason: String(e?.message || e),
      year,
      basin,
    }));
}

/** Drop everything held. For tests, and for a future Settings control — this
 *  module is the only thing in Seasons holding bytes in memory today. */
export function clearSeasonCache() {
  inflight.clear();
}
