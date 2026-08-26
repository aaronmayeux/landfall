/**
 * near-home-index.js — how close every storm since 1851 came to this house.
 * SPEC-SEASONS-BUILD.md §57.19, §57.35 faults 1, 2 and 4, §57.30 step 9.
 *
 * ==> THIS IS THE ONLY THING IN THE APP THAT READS A WHOLE BASIN. <== §57.35
 * names two shapes and this is the second one. Browsing a year is a 14 KB
 * per-season file that parses in 14 ms and needs none of this. Answering *"how
 * many storms have passed within 120 miles since 1851"* is every season at
 * once and cannot be answered a year at a time, which is the reason the
 * whole-basin files survived step 8's deletion.
 *
 * MEASURED, on the real files in this repo:
 *
 *   3,266 storms · 87,631 positions · 84,365 segments
 *   10.65 MB of text  ->  0.94 MB over the wire, compressed
 *   parse 570 ms on a desktop CPU — call it two to three seconds on a phone
 *   the near-home pass itself, 50–100 ms
 *   the answer that is KEPT, 10–65 KB depending on where you live
 *
 * Those five numbers are the whole design. The download and the parse are big
 * enough that they must not happen on the main thread and must not happen on
 * boot; the answer is small enough to store, which means they need not happen
 * twice.
 *
 * ==> SO IT RUNS ONCE PER HOUSE, NOT ONCE PER VISIT. <== The result is written
 * to `STORAGE_KEY.nearHome` against the coordinates it was computed for and
 * the revision of the files it was computed from. Move house, or let NOAA
 * publish a corrected record, and it recomputes. Otherwise a reader pays the
 * megabyte exactly once, ever.
 *
 * ==> AND IT IS NOT ON THE BOOT PATH. <== §57.35 fault 4. Nothing imports this
 * file statically: `ui/near-home-standing.js` reaches it through
 * `await import(...)` several seconds after the app has drawn. A visitor who
 * never sets a home never loads a line of it.
 *
 * ==> THERE IS NO MAIN-THREAD FALLBACK, ON PURPOSE. <== A browser with no Web
 * Worker gets no standing line. The alternative is running a two-to-three
 * second parse in front of a globe that is trying to hold frame rate, to fill
 * in one sentence at the foot of a dashboard — which is §57.35 FAULT 1
 * happening deliberately. A missing sentence costs a reader nothing; a frozen
 * app costs them the storm they opened the app for.
 *
 * ==> A FAILURE IS SILENT AT THE DOOR AND LOUD IN THE CONSOLE. <== This is the
 * one place in this feature where §5's "never ship silence" resolves the other
 * way, and §57.35 FIX 8's surviving sentence is why: what this fills in is a
 * hook, not an answer somebody asked for. If it cannot be computed, the archive
 * door keeps the words it already had — which are true — rather than gaining an
 * apology for a question nobody put. What it must NEVER do is report zero,
 * because "no storm has ever come near you" and "we could not work it out" are
 * different facts and this feature's whole subject is absence.
 *
 * Imports config/ and lib/. Reads localStorage and starts a Worker; no DOM.
 */

import { STORAGE_KEY } from '../config/constants.js';
import { loadIndex, basinsIn } from './seasons.js';

/** The worker's URL, relative to the DOCUMENT rather than to this module —
 *  which is what `new Worker` wants and is why it is written out rather than
 *  derived from `import.meta.url`. It is same-origin, so `worker-src 'self'`
 *  in `_headers` already covers it. */
const WORKER_URL = '/seasons/near-home-worker.js';

/* ---------------------------------------------------------------------------
 * THE STORED RECORD — the rules, with no storage in them
 * ------------------------------------------------------------------------- */

/**
 * Which files this answer was computed from, as one string.
 *
 * ==> IT IS THE REVISION STAMPS, NOT THE SEASON. <== §57.30 step 3b's
 * correction. NOAA revises seasons it has already published — the real
 * directory carries five revisions of the 2022 Atlantic file — and a corrected
 * record can move a storm across the reader's radius. Keying on the year alone
 * would leave a house holding an answer computed from a file NOAA has since
 * withdrawn, with nothing on screen saying so.
 */
export function revisionOf(index) {
  const basins = basinsIn(index);
  if (!basins.length) return null;
  return basins
    .map((b) => `${b}:${index?.basins?.[b]?.revision ?? '?'}`)
    .sort()
    .join('|');
}

/** The first season the archive holds, across every basin in it. Read rather
 *  than typed, so "since 1851" cannot outlive the files that make it true. */
export function firstSeasonOf(index) {
  let first = null;
  for (const b of basinsIn(index)) {
    const y = index?.basins?.[b]?.firstSeason;
    if (Number.isFinite(y) && (first == null || y < first)) first = y;
  }
  return first;
}

/**
 * Is this stored answer still the answer?
 *
 * ==> THE HOME COMPARISON IS EXACT, WITH NO TOLERANCE. <== A threshold would
 * need a number, and the honest number is "how far can a house move before the
 * answer changes", which depends on where the house is and which storms are
 * near it — there isn't one. `data/home.js` writes the coordinate once when
 * the reader sets it and it round-trips through JSON unchanged, so exact
 * equality never fires spuriously. The cost of being wrong is one recomputation
 * nobody sees.
 */
export function recordMatches(record, home, revision) {
  if (!record || !Array.isArray(record.index)) return false;
  if (record.rev !== revision) return false;
  return record.home?.lon === home?.lon && record.home?.lat === home?.lat;
}

/* ---------------------------------------------------------------------------
 * STORAGE — guarded, because it can throw
 * ------------------------------------------------------------------------- */

/** Safari private mode throws on both of these, and a quota-exceeded write
 *  throws on the second. Every road out is "act as though there was nothing
 *  stored", which for a recomputable cache is exactly right. */
function readRecord() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY.nearHome) || 'null');
  } catch {
    return null;
  }
}

function writeRecord(record) {
  try {
    localStorage.setItem(STORAGE_KEY.nearHome, JSON.stringify(record));
  } catch {
    /* ==> A FAILED WRITE IS NOT A FAILED ANSWER. <== The index is already in
     * memory and the sentence will be drawn from it. All that is lost is the
     * saving on the next visit, which is a slower path rather than a wrong
     * one — and a reader whose storage is full has bigger problems than one
     * line at the foot of a dashboard. */
  }
}

/** Throw the stored answer away. The reader moved house, or asked us to. */
export function forget() {
  try {
    localStorage.removeItem(STORAGE_KEY.nearHome);
  } catch { /* nothing stored is the state we wanted anyway */ }
  held = null;
}

/* ---------------------------------------------------------------------------
 * THE PASS
 * ------------------------------------------------------------------------- */

/** Held for the life of the page once computed, so a reader who drags the
 *  slider, leaves the archive and comes back does not re-read storage each
 *  time. §57.35 FIX 7 permits exactly this one resident thing: a few hundred
 *  numbers, not a season of geometry. */
let held = null;

/** One flight at a time. Two callers arriving together — the dashboard's
 *  standing line and an archive opened straight afterwards — must produce one
 *  download between them, not two. */
let inFlight = null;

/**
 * Run the whole-basin pass in a worker.
 *
 * `spawn` is injectable so the suite can drive the message contract without a
 * Worker, which this sandbox cannot start. It is NOT a fallback: production
 * has exactly one implementation and there is no second code path to drift.
 */
function runPass({ files, home, spawn }) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = spawn();
    } catch (err) {
      resolve({ ok: false, reason: `worker refused to start: ${err?.message || err}` });
      return;
    }
    if (!worker) {
      resolve({ ok: false, reason: 'this browser has no Web Worker' });
      return;
    }

    const done = (result) => {
      /* Terminated on EVERY road out, including the error ones. A worker left
       * running holds its parsed archive — tens of megabytes of heap — on a
       * device that will kill the tab for less (§57.35 FIX 7). */
      try { worker.terminate(); } catch { /* already gone */ }
      resolve(result);
    };

    worker.onmessage = (e) => done(e.data || { ok: false, reason: 'the worker said nothing' });
    /* The worker posts its own failures, so this only fires for the ones it
     * could not catch — a syntax error in a module it imports, most likely.
     * Handled anyway: an unhandled `onerror` is a promise that never settles,
     * and the caller would wait forever for a sentence that is never coming. */
    worker.onerror = (err) => done({ ok: false, reason: String(err?.message || 'the worker failed') });

    /* ==> POSTED LAST, AFTER BOTH HANDLERS ARE BOUND. <== A worker that
     * answers or throws before its listeners exist is a promise that never
     * settles. Vanishingly unlikely against a 0.94 MB download, and free to
     * make impossible. */
    worker.postMessage({ files, home });
  });
}

const defaultSpawn = () => (typeof Worker === 'function'
  ? new Worker(WORKER_URL, { type: 'module' })
  : null);

/**
 * The near-home index for this house, from storage or from a fresh pass.
 *
 * @param {{lon:number, lat:number}} home
 * @param {object} [opts]
 * @param {Function} [opts.spawn]  test seam; see `runPass`
 * @returns {Promise<{state:string, index:Array, firstSeason:number|null, reason?:string}>}
 *   `state` is `'ok'`, `'no-home'`, or `'unavailable'` — three states, never a
 *   silent empty array (§5).
 */
export async function ensureIndex(home, { spawn = defaultSpawn } = {}) {
  if (!Number.isFinite(home?.lon) || !Number.isFinite(home?.lat)) {
    return { state: 'no-home', index: [], firstSeason: null };
  }

  if (held && recordMatches(held, home, held.rev)) {
    return { state: 'ok', index: held.index, firstSeason: held.first };
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    let index;
    try {
      index = await loadIndex();
    } catch (err) {
      return { state: 'unavailable', index: [], firstSeason: null, reason: String(err?.message || err) };
    }

    const rev = revisionOf(index);
    const first = firstSeasonOf(index);

    /* Storage is read AFTER the index, because the index is what says whether
     * a stored answer is still current. Reading it first and trusting it would
     * be trusting a revision stamp against nothing. The index itself is served
     * from our own origin and is small; the service worker already holds it. */
    const stored = readRecord();
    if (recordMatches(stored, home, rev)) {
      held = stored;
      return { state: 'ok', index: stored.index, firstSeason: stored.first ?? first };
    }

    const files = basinsIn(index)
      .map((b) => ({ basin: b, url: index?.basins?.[b]?.file }))
      .filter((f) => typeof f.url === 'string' && f.url);

    if (!files.length) {
      return { state: 'unavailable', index: [], firstSeason: first, reason: 'the archive index names no basin files' };
    }

    const out = await runPass({ files, home, spawn });
    if (!out?.ok) {
      return { state: 'unavailable', index: [], firstSeason: first, reason: out?.reason || 'the pass failed' };
    }

    held = { home: { lon: home.lon, lat: home.lat }, rev, first, index: out.index };
    writeRecord(held);
    return { state: 'ok', index: held.index, firstSeason: first };
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export const __internals = { WORKER_URL, runPass, readRecord, writeRecord };
