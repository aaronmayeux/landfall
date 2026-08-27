/**
 * seasons-wall.mjs — the Wall of Years index, built on the runner.
 * SPEC-SEASONS-BUILD.md §57.29, §57.36, §57.30 step 14.
 *
 * ==> THE WALL IS 175 ROWS AND IT CANNOT AFFORD TO OPEN 175 FILES. <== The
 * per-season slices (`seasons-slice.mjs`) made opening ONE year cheap — 14 KB
 * and 14 ms. The wall asks a different question: it needs one line about every
 * season at once, and fetching 252 season files to draw one screen would be
 * 252 requests before a single dot appeared.
 *
 * So the runner reduces every storm in the archive to the four facts the wall's
 * controls actually need, once, and the browser fetches the result as a single
 * small file.
 *
 * ==> THE SEVEN FIELDS ARE THE SEVEN THE CONTROLS NEED, AND NOTHING ELSE IS
 * CARRIED. <== §57.36 names seven category chips, a landfall toggle, five sort
 * keys, and a collapsed set of thresholds on duration, pressure and ACE.
 * Working backwards from those, one storm is:
 *
 *     [peakCategory, madeLandfall, ace, peakWindKt, days, pressureMb, name]
 *
 * Dates and positions are still absent on purpose. They belong to the season
 * file, which is what a reader downloads when they tap a year.
 *
 * ==> AND THE SIZE WAS MEASURED BEFORE THE SHAPE WAS CHOSEN, ON THE REAL FILES
 * IN THIS REPO. <== Both basins, 3,266 storms. Printed by `--measure`; do not
 * copy this table forward, re-derive it.
 *
 *   | category only               |  8,827 B raw |  2,286 B gzipped |
 *   | + landfall flag             | 21,891 B raw |  3,159 B gzipped |
 *   | + ACE + peak wind           | 45,992 B raw | 10,388 B gzipped |
 *   | + days alive                | 57,794 B raw | 14,128 B gzipped |
 *   | + lowest pressure           | 72,641 B raw | 17,803 B gzipped |
 *   | + name            (SHIPPED) | 93,107 B raw | 24,277 B gzipped |
 *
 * ==> THE LAST 15 KB WAS BOUGHT, NOT SPENT BY ACCIDENT. <== The first four
 * columns cover the chips, the landfall toggle and every sort key. The last
 * three exist only for §57.36's COLLAPSED filters, and the alternative was
 * dropping three controls rather than saving bytes — a wall that cannot answer
 * "which storms lasted a fortnight" is a smaller feature, not a cheaper one.
 * The narrow versions above are kept for the same reason they always were: the
 * cheap-looking option was the expensive one, because it forces three controls
 * to go and fetch something else.
 *
 * ==> ACE IS ROUNDED TO ONE DECIMAL AND THAT IS A SIZE DECISION WITH A LIMIT
 * ON IT. <== Full precision runs to fourteen digits per storm and the wall
 * shows ACE to one. Rounding at write time rather than at paint time keeps the
 * file small; rounding any HARDER would start to change which season sorts
 * above which, so 0.1 is the floor rather than a preference.
 *
 * ==> A SEASON WITH NO STORMS IS AN EMPTY ARRAY, NEVER A MISSING KEY. <== §5.
 * The wall draws a hairline for a genuinely quiet year and says so; a year that
 * is simply absent from this file is a different fact and the reader has to be
 * able to tell them apart. `fillGaps` puts an empty array against every year
 * between the first and last season a basin holds, so an absent key can only
 * ever mean the file itself is wrong.
 *
 * RUNNER-ONLY, like `seasons-slice.mjs`, and for the same reason: every import
 * in every file ships to every visitor (§12, no build step), and a phone has no
 * use for the code that decides how a server reduces a file.
 *
 * Zero dependencies. Imports the app's own parser and the app's own derived
 * facts, so what is written here is what the browser would have computed.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseHurdat2 } from '../lib/hurdat.js';
import { stormFacts } from '../lib/season-facts.js';
import { stormRow } from '../lib/wall-index.js';

/** Where the browser fetches it. One file, not one per basin: the wall's basin
 *  switch is a tap and re-fetching on every tap would make the cheaper control
 *  feel slower than the expensive one. */
export const WALL_FILE = 'seasons/wall.json';

/** Field positions, named once so nothing below indexes a raw array and
 *  quietly reads the wrong column. The browser has the same four names in
 *  `lib/wall-index.js` and the two must not drift. */
export const CAT = 0, LANDFALL = 1, ACE = 2, PEAK_KT = 3;
export const DAYS = 4, PRESSURE_MB = 5, NAME = 6;

/** One decimal place. See the header — this is a floor, not a preference. */
const ACE_DP = 10;

/** ==> THE MAPPING ITSELF LIVES IN `lib/wall-index.js`, NOT HERE. <== The
 *  browser builds the LIVE season's row at read time (§57.36 — the season in
 *  progress is not in HURDAT2 and never can be until NOAA reviews it), so the
 *  storm-to-four-columns rule has a second caller. Two copies of it is one dot
 *  the wrong colour for the current year, with nothing on screen saying so, so
 *  the runner borrows the app's version rather than keeping its own.
 *
 *  Re-exported under the old name because the suite and the header both talk
 *  about `wallStorm`, and renaming a thing is not the change being made here. */
export const wallStorm = stormRow;

/**
 * Every year between the first and last a basin holds gets a key.
 *
 * See the header: an empty array is a quiet year and a missing key is a broken
 * file, and the wall says different things about them. Without this the two are
 * indistinguishable, and the failure looks exactly like history.
 */
export function fillGaps(years) {
  const nums = Object.keys(years).map(Number).filter(Number.isFinite);
  if (!nums.length) return years;
  const first = Math.min(...nums);
  const last = Math.max(...nums);
  const out = {};
  for (let y = first; y <= last; y++) out[String(y)] = years[String(y)] || [];
  return out;
}

/**
 * One basin's rows, from the whole-basin HURDAT2 text.
 *
 * ==> THE CENTRAL PACIFIC RIDES IN THE EAST PACIFIC FILE AND MUST NOT
 * OVERWRITE IT. <== NOAA publishes CP storms inside the EP file, and a
 * generator that keyed on `basin` + `year` would write one over the other. The
 * mockup's first generator did exactly that and 82 CP storms vanished — the
 * 2024 East Pacific drew as a SINGLE dot, which reads as an extraordinarily
 * quiet year rather than as a bug. Keying on YEAR alone merges them, which is
 * what §57.18b already does in the app.
 *
 * ==> ORDER IS CHRONOLOGICAL BY FIRST FIX AND THAT IS LOAD-BEARING. <== §57.36
 * forbids sorting the dots inside a row: the strip reads left to right as the
 * season happened, and a row sorted by strength has June somewhere in the
 * middle and cannot be compared to the row above it.
 */
export function basinRows(text) {
  const parsed = parseHurdat2(String(text ?? ''));
  const storms = parsed?.storms || [];

  const rows = {};
  for (const storm of storms) {
    const facts = stormFacts(storm);
    if (!facts || !Number.isFinite(facts.year)) continue;
    const key = String(facts.year);
    (rows[key] || (rows[key] = [])).push({ at: facts.firstTime, row: wallStorm(facts) });
  }

  const out = {};
  for (const [year, list] of Object.entries(rows)) {
    list.sort((a, b) => a.at - b.at);
    out[year] = list.map((e) => e.row);
  }
  return fillGaps(out);
}

/**
 * The whole file, from the season index the slicer already wrote.
 *
 * ==> IT READS `seasons/index.json` RATHER THAN GUESSING FILENAMES. <== The
 * revision stamp is part of every basin file's name (§57.35 FIX 11) and the
 * index is the one place that knows which revision is actually on disk. A
 * generator that globbed the directory would pick up an older revision left
 * behind by a failed download and describe a history that is not the one being
 * served.
 *
 * @param {string} root       repo root
 * @param {object} index      the parsed `seasons/index.json`
 * @param {string} generatedAt
 */
export function buildWall(root, index, { generatedAt }) {
  const basins = {};
  for (const [key, entry] of Object.entries(index?.basins || {})) {
    const name = String(entry?.file || '').split('/').pop();
    if (!name) continue;
    const path = join(root, 'seasons/data', name);
    if (!existsSync(path)) continue;
    basins[key] = {
      label: entry.label,
      revision: entry.revision,
      firstSeason: entry.firstSeason,
      lastSeason: entry.lastSeason,
      years: basinRows(readFileSync(path, 'utf8')),
    };
  }
  return {
    generatedAt,
    /* §57.11 — the same flag the season index carries, for the same reason.
     * HURDAT2 is the reviewed record; the season in progress is not in here
     * at all, and a reader has to be able to tell which they are looking at. */
    provisional: false,
    fields: ['category', 'landfall', 'ace', 'peakWindKt', 'days', 'pressureMb', 'name'],
    basins,
  };
}

/**
 * Write it, and say whether anything actually changed.
 *
 * Compared WITHOUT its timestamp, or every run commits an empty diff — the
 * fault `seasons-mirror` shipped and a runner caught (SPEC-OPS.md §18.7 rule
 * 4), and the season index guards against the same way.
 */
export function syncWall(root, index, { generatedAt }) {
  const path = join(root, WALL_FILE);
  const next = `${JSON.stringify(buildWall(root, index, { generatedAt }))}\n`;
  const prev = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (stripStamp(prev) === stripStamp(next)) return { ok: true, written: false, bytes: next.length };
  writeFileSync(path, next);
  return { ok: true, written: true, bytes: next.length };
}

const stripStamp = (text) => {
  if (text == null) return null;
  try {
    const o = JSON.parse(text);
    delete o.generatedAt;
    return JSON.stringify(o);
  } catch { return text; }
};

/* --- run it by hand -------------------------------------------------------
 * `node tools/seasons-wall.mjs` writes the file. `--measure` prints the three
 * candidate sizes the header quotes, so that table can be re-derived rather
 * than trusted.
 * ------------------------------------------------------------------------ */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { gzipSync } = await import('node:zlib');
  const root = process.cwd();
  const index = JSON.parse(readFileSync(join(root, 'seasons/index.json'), 'utf8'));

  if (process.argv.includes('--measure')) {
    const wall = buildWall(root, index, { generatedAt: '' });
    const narrow = {}, mid = {}, four = {}, five = {}, six = {};
    for (const [k, b] of Object.entries(wall.basins)) {
      narrow[k] = {}; mid[k] = {}; four[k] = {}; five[k] = {}; six[k] = {};
      for (const [y, list] of Object.entries(b.years)) {
        narrow[k][y] = list.map((s) => s[CAT]);
        mid[k][y] = list.map((s) => [s[CAT], s[LANDFALL]]);
        four[k][y] = list.map((s) => s.slice(0, 4));
        five[k][y] = list.map((s) => s.slice(0, 5));
        six[k][y] = list.map((s) => s.slice(0, 6));
      }
    }
    const size = (o) => {
      const j = JSON.stringify(o);
      return `${j.length.toLocaleString()} B raw / ${gzipSync(j, { level: 9 }).length.toLocaleString()} B gzipped`;
    };
    let storms = 0;
    for (const b of Object.values(wall.basins)) for (const l of Object.values(b.years)) storms += l.length;
    console.log(`storms: ${storms.toLocaleString()}`);
    console.log(`category only              : ${size(narrow)}`);
    console.log(`+ landfall flag            : ${size(mid)}`);
    console.log(`+ ACE + peak wind          : ${size(four)}`);
    console.log(`+ days alive               : ${size(five)}`);
    console.log(`+ lowest pressure          : ${size(six)}`);
    const full = {};
    for (const [k, b] of Object.entries(wall.basins)) full[k] = b.years;
    console.log(`+ name           (SHIPPED) : ${size(full)}`);
  } else {
    const r = syncWall(root, index, { generatedAt: new Date().toISOString() });
    console.log(r.written ? `wrote ${WALL_FILE} (${r.bytes.toLocaleString()} B)` : `${WALL_FILE} unchanged`);
  }
}
