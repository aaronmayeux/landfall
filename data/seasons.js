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
import { rankingsFileName } from '../lib/rankings.js';

/** The index of every season we hold. Mutable on the server, `no-cache` in
 *  `_headers`, and the only door to a filename. */
const INDEX_URL = '/seasons/index.json';

/** Every season reduced to four numbers a storm, for the wall. §57.36. Written
 *  by `tools/seasons-wall.mjs`; `no-cache` in `_headers` for the same reason
 *  the index is — the name carries no revision stamp. */
const WALL_URL = '/seasons/wall.json';

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
 * The Wall of Years index — one line about every season at once. §57.36.
 *
 * ==> IT IS A SECOND FILE RATHER THAN A SECTION OF THE FIRST, AND THAT IS A
 * BOOT-COST DECISION. <== `index.json` is 12 KB and is fetched the moment
 * anybody enters the archive, because nothing can happen without a filename.
 * The wall index is 46 KB, and folding it in would put those 46 KB in front of
 * every reader who came to look at one year through a deep link. Two files
 * means the wall's cost is paid by the wall.
 *
 * ==> IT IS `no-cache` FOR THE SAME REASON THE INDEX IS. <== The filename
 * carries no revision stamp, so it is the one file under `/seasons/` that can
 * change meaning without changing name. `_headers` says so; this says so too,
 * because a rule that lives only in a server config is a rule nothing in this
 * repo can test.
 *
 * @returns {Promise<{status:'ok', wall:object} | {status:'unavailable', reason:string}>}
 */
export function loadWall() {
  return once(WALL_URL, async () => {
    const res = await fetch(WALL_URL, { credentials: 'omit', cache: 'no-cache' });
    if (!res.ok) throw new Error(`the wall of years answered ${res.status}`);
    return res.json();
  })
    .then((wall) => ({ status: 'ok', wall }))
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
  return Promise.all([
    once(url, () => getText(url)),
    loadLandfalls(index, basin),
    loadPlaces(index, basin),
    /* ==> IT RIDES IN THE SAME BREATH AS THE SEASON RATHER THAN ARRIVING
     * AFTER IT, AND THE REASON IS THE SAME ONE THE PLACES FILE HAS. <== This
     * panel paints instantly and completely today; a rank appearing a beat
     * later would make eight sections shuffle. It is 3.8 KB gzipped and
     * `once()` holds it for the session, so it is one round trip on the first
     * year a reader opens and free on all 174 others. */
    loadRankings(index),
  ])
    .then(([text, marks, places, rankings]) => {
      const { storms, faults } = parseHurdat2(text);
      /* ==> THE COMPUTED LANDFALLS ARE ATTACHED HERE, AT THE PARSE BOUNDARY,
       * AND THAT IS THE WHOLE WIRING. <== §57.7a. `stormFacts` reads
       * `landfallsComputed` off the storm, so the board, the roster, the
       * detail panel and the globe all get our answer without one of them
       * learning that a second file exists. A seam anywhere further in would
       * mean every consumer taking a new argument. */
      if (marks) for (const storm of storms) storm.landfallsComputed = marks[storm.id] || [];
      /* ==> `null` AND `{}` MEAN DIFFERENT THINGS HERE AND THE PARAGRAPH READS
       * BOTH. <== §5, §57.41. `null` is "the sidecar is not on screen, so
       * nobody looked" and the story then says nothing about where the storm
       * was born. `{}` is "the basin was walked and this storm had nothing
       * inside the cap", which is what open water looks like and IS sayable.
       * Collapsing the two would print "out over open water" under a storm
       * that formed in the Gulf of Mexico on a day this file 404'd. */
      for (const storm of storms) storm.places = places ? (places[storm.id] || {}) : null;
      /* Not attached to each storm: it is a table ABOUT the archive rather
       * than a fact about a storm, and 3,266 copies of one pointer would
       * invite somebody to treat it as per-storm data. */
      return { status: 'ok', storms, faults, year, basin, rankings };
    })
    .catch((e) => ({
      status: 'unavailable',
      reason: String(e?.message || e),
      year,
      basin,
    }));
}

/**
 * The landfalls we computed ourselves, for a whole basin.
 *
 * ==> ONE FILE PER BASIN RATHER THAN ONE PER SEASON, AND THE ARITHMETIC IS
 * WHY. <== Per season it would be about 1 KB, which is cheaper for a reader
 * who opens exactly one year — but it is a SECOND round trip on every year
 * opened, and the archive is a screen people step through. Per basin is 36 KB
 * gzipped once, shared by all 175 years, and `immutable` for a year because
 * the revision stamp is in the filename.
 *
 * ==> A FAILURE HERE MUST NOT LOSE THE SEASON. <== §5, and it is the reason
 * this resolves to `null` rather than rejecting. The storms are the thing the
 * reader asked for; the landfalls are an improvement on a fact the season file
 * already carries in NOAA's sparser form. Losing the year because a 36 KB
 * companion 404'd would be the tail wagging the dog, so `stormFacts` falls
 * back to NOAA's `L` markers and `landfallSource` says which is on screen.
 *
 * @returns {Promise<object|null>}  storm id -> landfall list, or null
 */
export function loadLandfalls(index, basin) {
  const dir = index?.dir || '/seasons/data';
  const revision = index?.basins?.[basin]?.revision;
  if (!revision) return Promise.resolve(null);

  const url = `${dir}/${basin}-landfalls-${revision}.json`;
  return once(url, async () => {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`landfalls answered ${res.status}`);
    return res.json();
  })
    .then((payload) => payload?.storms || null)
    .catch(() => null);
}

/**
 * The names for every spot the archive points at, for a whole basin. §57.40,
 * §57.42 Tier 2 item 1.
 *
 * ==> A SECOND FILE RATHER THAN A FIELD ON THE FIRST, AND THAT IS A FAILURE
 * DECISION. <== §57.42. Two runner jobs must never write one file, and losing
 * the names must not take the landfalls with it. A landfall is a FACT about the
 * storm; a name is what we call the spot it happened at. The panel degrades to
 * coordinates without one and loses nothing it can prove.
 *
 * ==> AND IT COSTS 38.5 KB GZIPPED ON THE ATLANTIC, WHICH IS MORE THAN §57.42
 * ESTIMATED. <== Measured 2026-08-29 on the real file: 234 KB raw, 38.5 KB
 * gzipped, against an estimate of 12-15 KB. The estimate counted the 2,537
 * landfall marks and not the genesis place on every one of 3,266 storms, which
 * is the clause §57.41 never drops. It rides in the same `Promise.all` as the
 * season text rather than arriving late, because the archive panel paints
 * instantly and completely today and a paragraph appearing a beat afterwards
 * would make the whole panel twitch. **The lever if that cost is ever judged
 * too high is deferring this one fetch until a storm panel opens** — nothing on
 * the roster or the globe reads it.
 *
 * ==> A FAILURE HERE MUST NOT LOSE THE SEASON, SAME AS THE LANDFALLS. <== §5.
 * It resolves to `null`, and `null` travels all the way to the paragraph, where
 * it means "nobody looked" rather than "there was nothing there".
 *
 * @returns {Promise<object|null>}  storm id -> `{genesis, landfalls, stall}`, or null
 */
export function loadPlaces(index, basin) {
  const dir = index?.dir || '/seasons/data';
  const revision = index?.basins?.[basin]?.revision;
  if (!revision) return Promise.resolve(null);

  const url = `${dir}/${basin}-places-${revision}.json`;
  return once(url, async () => {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`places answered ${res.status}`);
    return res.json();
  })
    .then((payload) => payload?.storms || null)
    .catch(() => null);
}

/**
 * Where every storm stands against the whole archive. §57.44, §57.42 Tier 1
 * item 11.
 *
 * ==> IT IS ONE FILE FOR ALL BASINS, WHICH IS WHY IT IS NOT KEYED ON ONE. <==
 * The landfalls and the places are per-basin because a fact about a storm
 * belongs to that storm's basin. A RANK is a comparison, and the comparison
 * this feature exists to make crosses basins — so the file carries every
 * scope, and its name is derived from every contributing basin's revision
 * rather than from one of them. `rankingsFileName` in `lib/rankings.js` does
 * that derivation and the runner does it with the same function.
 *
 * ==> IT IS DERIVED RATHER THAN LOOKED UP IN THE INDEX, AND THAT IS THE
 * TWO-WRITERS RULE. <== §57.40a. `index.json` belongs to the mirror job. A
 * rankings job that added its own filename to it would be a second writer of
 * one file, and the failure is a lost edit nothing detects.
 *
 * ==> A FAILURE HERE MUST NOT LOSE THE SEASON, SAME AS THE OTHER TWO. <== §5.
 * It resolves to `null`, the panel simply has no `Where it ranks` section, and
 * every other figure on it is unaffected. A rank is the least load-bearing
 * thing on that screen: losing 175 years of history because a 4 KB companion
 * 404'd would be the tail wagging the dog.
 *
 * @returns {Promise<object|null>}  the scope table, or null
 */
export function loadRankings(index) {
  const dir = index?.dir || '/seasons/data';
  const { file } = rankingsFileName(index?.basins || {});
  if (!file) return Promise.resolve(null);

  const url = `${dir}/${file}`;
  return once(url, async () => {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`rankings answered ${res.status}`);
    return res.json();
  })
    .then((payload) => (payload?.scopes ? payload : null))
    .catch(() => null);
}

/** Drop everything held. For tests, and for a future Settings control — this
 *  module is the only thing in Seasons holding bytes in memory today. */
export function clearSeasonCache() {
  inflight.clear();
}
