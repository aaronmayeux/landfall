/**
 * seasons-slice.mjs — cut HURDAT2 into one file per season.
 * SPEC-SEASONS-BUILD.md §57.24, §57.35 FIX 12. SPEC-OPS.md §18.8.
 *
 * ==> WHY THIS EXISTS. <== §57.35 FAULT 1 is right that re-parsing 6.75 MB on
 * every open is unaffordable, and the fix it prescribed — download the whole
 * basin, parse it once in a Worker, keep it in IndexedDB — was a large piece of
 * machinery. Cutting the file into seasons on the RUNNER makes the whole
 * question disappear for the ordinary case: opening 2005 fetches 119 KB (14 KB
 * over the wire, measured on the real bytes) and parses in single-digit
 * milliseconds, on any thread, with nothing stored.
 *
 * ==> AND IT ENDED UP TAKING THAT MACHINERY WITH IT. <== 2026-08-25: step 8 —
 * the download gate, IndexedDB, the eviction state and offline — was deleted
 * outright (§57.30), and this slicing is half the reason it could be. A gate
 * exists to stand between a reader and a cost, and there is no cost left on the
 * ordinary path.
 *
 * The whole-basin file is NOT deleted by this. It is still what step 9's
 * "how many storms have passed within 100 miles since 1851" needs, and step 9
 * is now its only reader.
 *
 * ==> THE SLICES ARE A VERBATIM CUT AND NOTHING IS EDITORIALISED. <== Lines go
 * out exactly as NOAA wrote them, invests and test numbers included. The app's
 * parser drops those (§57.13) and it is the same parser either way, so the
 * filter lives in exactly one place. A slicer that "helpfully" removed them
 * would be a second, silent copy of that rule.
 *
 * ==> AND EVERY SLICE IS PROVED AGAINST THE WHOLE FILE BEFORE ANY OF IT IS
 * WRITTEN. <== `verifySlices` parses the source, parses every cut, and compares
 * the resulting storms field by field. A slicer that loses a storm at a
 * boundary would be invisible — a year that quietly holds 30 storms instead of
 * 31 looks exactly like a quiet year, which is the §5 failure this feature is
 * most exposed to.
 *
 * RUNNER-ONLY, and that is why it is in `tools/` rather than `lib/`. Every
 * import in every file ships to every visitor (§12, no build step); a phone has
 * no use for the code that decides how a server cuts a file up.
 *
 * Zero dependencies. Imports the app's own parser, so a cut that passes here is
 * a cut the browser can read.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseHurdat2, parseStormId } from '../lib/hurdat.js';
import { SEASONS } from '../config/constants.js';

/**
 * The served filename for one season.
 *
 * ==> THE REVISION IS IN THE NAME FOR THE SAME REASON THE WHOLE FILE CARRIES
 * IT. <== §57.35 FIX 11. NOAA republishes seasons it has already published —
 * five revisions of the 2022 Atlantic file in the real directory — and every
 * file under `seasons/data/` is served `immutable`, so a name that can mean two
 * different things is a browser holding the wrong one forever.
 *
 * Flat, in the same directory as the whole file, so the existing `_headers`
 * rule covers it and nothing new has to be remembered by hand.
 */
export const seasonFileName = (basinKey, season, revision) =>
  `${basinKey}-${season}-${revision}.txt`;

/** Matches a slice belonging to a basin, whatever its season or revision. Used
 *  to sweep out the previous revision's cuts — §57.34 rule 3, replaced and
 *  never accumulated. Cannot match the whole file, which starts `hurdat2-`. */
export const sliceMatcher = (basinKey) =>
  new RegExp(`^${basinKey}-(\\d{4})-([0-9a-z]+)\\.txt$`, 'i');

/**
 * Cut a HURDAT2 file into one text per season.
 *
 * The only thing that distinguishes a header row from a data row is its field
 * count (§57.4), and that is deliberately the dumbest possible test — a change
 * in the DATA columns must not be able to break the splitter.
 *
 * @param {string} text
 * @returns {{seasons: Map<number,string>, faults: Array}}
 */
export function sliceSeasons(text) {
  const seasons = new Map();
  const faults = [];
  const lines = String(text ?? '').split('\n');

  let year = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const fields = line.split(',');
    if (fields.length <= SEASONS.hurdatHeaderFields) {
      const parsed = parseStormId(fields[0].trim().toUpperCase());
      if (!parsed) {
        /* Reported, never guessed at. The caller refuses the whole basin on
         * any fault rather than writing a file with a hole in it. */
        faults.push({ kind: 'bad_header', line: i + 1, text: line.slice(0, 80) });
        year = null;
        continue;
      }
      year = parsed.year;
    }

    if (year == null) {
      faults.push({ kind: 'orphan_row', line: i + 1, text: line.slice(0, 80) });
      continue;
    }

    const held = seasons.get(year);
    seasons.set(year, held == null ? line : `${held}\n${line}`);
  }

  /* Every file ends with a newline. A slice that does not is a slice whose last
   * row joins the next thing anybody concatenates it with. */
  for (const [y, body] of seasons) seasons.set(y, `${body}\n`);

  return { seasons, faults };
}

/**
 * Prove the cuts say exactly what the whole file says.
 *
 * ==> THIS IS THE GATE, AND IT COMPARES PARSED STORMS RATHER THAN BYTES. <==
 * Comparing bytes would only prove the cut is a substring. Comparing what the
 * app's own parser makes of each side proves the thing that actually matters:
 * that a reader opening 2005 sees the same 31 storms, with the same points, as
 * a reader who downloaded the whole basin.
 *
 * @param {string} text  the whole basin file
 * @param {Map<number,string>} seasons  the cuts
 * @returns {{ok: boolean, reason: string|null, seasons: number, storms: number}}
 */
export function verifySlices(text, seasons) {
  const whole = parseHurdat2(text);
  if (whole.faults.length) {
    const kinds = [...new Set(whole.faults.map((f) => f.kind))].join(', ');
    return { ok: false, reason: `the source file parses with faults: ${kinds}`, seasons: 0, storms: 0 };
  }

  const byYear = new Map();
  for (const storm of whole.storms) {
    if (!byYear.has(storm.year)) byYear.set(storm.year, []);
    byYear.get(storm.year).push(storm);
  }

  for (const year of byYear.keys()) {
    if (!seasons.has(year)) {
      return { ok: false, reason: `season ${year} is in the file and has no slice`, seasons: 0, storms: 0 };
    }
  }

  let storms = 0;
  for (const [year, body] of seasons) {
    const cut = parseHurdat2(body);
    if (cut.faults.length) {
      const kinds = [...new Set(cut.faults.map((f) => f.kind))].join(', ');
      return { ok: false, reason: `the ${year} slice parses with faults: ${kinds}`, seasons: 0, storms: 0 };
    }
    const expected = byYear.get(year) || [];
    if (JSON.stringify(cut.storms) !== JSON.stringify(expected)) {
      /* Say WHICH storm, or the next person reading this line has 2,004 of
       * them to look through. */
      const a = cut.storms.map((s) => s.id).join(' ');
      const b = expected.map((s) => s.id).join(' ');
      const where = a === b ? 'same storms, different numbers in them' : `slice has [${a}], file has [${b}]`;
      return { ok: false, reason: `the ${year} slice disagrees with the file — ${where}`, seasons: 0, storms: 0 };
    }
    storms += cut.storms.length;
  }

  return { ok: true, reason: null, seasons: seasons.size, storms };
}

/**
 * Make what is on disk match what the basin file says, and report what moved.
 *
 * ==> IT RUNS WHETHER OR NOT THE BASIN FILE CHANGED, AND THAT IS THE POINT.
 * <== The whole file is usually `unchanged` — NOAA republishes once a year —
 * so a slicer that only ran on a fresh download would never produce anything
 * on any ordinary month. This reconciles instead: missing cuts are written,
 * cuts from a superseded revision are swept, and a run with nothing to do
 * writes nothing and reports zero.
 *
 * ==> NOTHING IS WRITTEN OR DELETED IF THE VERIFY FAILS. <== A half-swept
 * directory is a history with a hole in it, and a hole in this feature looks
 * exactly like a quiet year.
 *
 * @param {string} dir  absolute path to `seasons/data`
 * @param {string} basinKey
 * @param {string} revision  NOAA's stamp for the file being cut
 * @param {string} text  the whole basin file
 * @returns {{ok:boolean, reason:string|null, seasons:object, written:number,
 *            removed:number, storms:number}}
 */
export function syncSlices(dir, basinKey, revision, text) {
  const cut = sliceSeasons(text);
  if (cut.faults.length) {
    const kinds = [...new Set(cut.faults.map((f) => f.kind))].join(', ');
    return { ok: false, reason: `could not cut the file: ${kinds}`, seasons: {}, written: 0, removed: 0, storms: 0 };
  }

  const verdict = verifySlices(text, cut.seasons);
  if (!verdict.ok) {
    return { ok: false, reason: verdict.reason, seasons: {}, written: 0, removed: 0, storms: 0 };
  }

  mkdirSync(dir, { recursive: true });

  const wanted = new Map();
  for (const [year, body] of cut.seasons) {
    wanted.set(seasonFileName(basinKey, year, revision), { year, body });
  }

  const matcher = sliceMatcher(basinKey);
  let removed = 0;
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    if (!matcher.test(name)) continue;
    if (wanted.has(name)) continue;
    /* Either a previous revision, or a season NOAA no longer publishes. Both
     * are the same instruction: it is not part of the record we now hold. */
    rmSync(join(dir, name));
    removed++;
  }

  let written = 0;
  const seasons = {};
  for (const [name, { year, body }] of wanted) {
    const path = join(dir, name);
    const held = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (held !== body) {
      writeFileSync(path, body);
      written++;
    }
    seasons[year] = name;
  }

  return { ok: true, reason: null, seasons, written, removed, storms: verdict.storms };
}
