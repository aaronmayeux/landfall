/**
 * season-reports.js — does this storm have a written report, and where is it?
 * §57.22, §57.22a, §57.30 step 7.
 *
 * ==> IT IS A LOOKUP AND NEVER A CONSTRUCTED URL, AND THAT IS THE WHOLE POINT
 * OF THE FILE. <== §57.22a measured NHC's archive: 510 of 534 report filenames
 * follow `AL122005_Katrina.pdf`, and the 24 that do not break in two systematic
 * ways — a storm that crossed basins carries BOTH ids, and an unnamed storm is
 * written with its number spelled out where we hold `UNNAMED`. Building a URL
 * from a storm id is right most of the time, and **a link that is right most of
 * the time is worse than no link at all**: a dead one looks exactly like a live
 * one until somebody presses it, in the one panel whose entire job is
 * historical accuracy.
 *
 * `tools/tcr-index.mjs` reads NHC's own pages monthly and writes
 * `seasons/reports.json`. Every entry in it was read or was matched to exactly
 * one storm; ambiguous rows were dropped rather than guessed at.
 *
 * ==> THREE STATES, AND THE THIRD IS THE ONE THAT MATTERS. <== §5.
 *
 *   `has`     — there is a report and here is where.
 *   `none`    — the index loaded and this storm is not in it. A real answer:
 *               most storms have no report, and for anything before 1958 none
 *               was ever written.
 *   `unknown` — the index could not be reached. **NOT the same as `none`**, and
 *               collapsing them would put "no report was written for this
 *               storm" on screen about a storm whose report exists and which
 *               we simply failed to look up. That is the all-clear-during-an-
 *               outage bug in miniature, and the panel says something different
 *               for each.
 *
 * ==> FETCHED ON FIRST ASK, NEVER ON ENTRY. <== The archive already loads a
 * season, a name roster and a globe's worth of geometry when somebody opens a
 * year. This is ~40 KB that only matters once a reader opens one storm's panel,
 * so it rides that tap rather than the door.
 *
 * Imports nothing. No DOM, no map, no clock.
 */

/** Mutable on the server and `no-cache` in `_headers` — a monthly job rewrites
 *  it whenever NOAA publishes a report, and a copy held for a year would say
 *  "no report" about one that now exists. */
const URL_PATH = '/seasons/reports.json';

/** One in-flight or settled promise, so a reader opening three panels quickly
 *  makes one request. A FAILURE falls out of here on purpose, so the next ask
 *  is a real retry rather than a replay of one bad moment on a train. */
let inflight = null;

/** The parsed index, or null. Held for the session and not beyond it — the
 *  browser's own HTTP cache does the durable half. */
let index = null;

async function load() {
  if (index) return index;
  if (!inflight) {
    inflight = (async () => {
      const res = await fetch(URL_PATH, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`reports.json ${res.status}`);
      const json = await res.json();
      if (!json || typeof json.reports !== 'object') throw new Error('reports.json has no reports');
      index = json;
      return json;
    })().catch((err) => {
      inflight = null;
      throw err;
    });
  }
  return inflight;
}

/**
 * The report for one storm.
 *
 * @param {string} id  an ATCF storm id, e.g. `AL122005`
 * @returns {Promise<{state:'has', url:string, via:string}
 *                  | {state:'none'}
 *                  | {state:'unknown', reason:string}>}
 */
export async function reportFor(id) {
  if (!id) return { state: 'none' };
  let json;
  try {
    json = await load();
  } catch (err) {
    /* ==> THE INDEX BEING UNREACHABLE IS NOT EVIDENCE THAT NO REPORT EXISTS.
     * <== The caller must be able to tell these apart, so the reason travels
     * with the state rather than being swallowed into a falsy answer. */
    return { state: 'unknown', reason: String(err?.message || err) };
  }

  const hit = json.reports[id];
  if (!hit || !hit.u) return { state: 'none' };

  /* The origin is stored once at the top of the file rather than on every one
   * of ~1,200 rows, which is most of the file's size. */
  return { state: 'has', url: `${json.origin || ''}${hit.u}`, via: hit.via || 'id' };
}

/** Drop the held copy. The leave path, so a session that spans a deploy does
 *  not hold a index the server has since replaced. */
export function forgetReports() {
  index = null;
  inflight = null;
}
