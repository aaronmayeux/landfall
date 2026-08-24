#!/usr/bin/env node
/**
 * test-seasons-slice.mjs — cutting HURDAT2 into seasons without losing a storm.
 * Drives `tools/seasons-slice.mjs`. SPEC-SEASONS-BUILD.md §57.24, §57.35 FIX 12,
 * SPEC-OPS.md §18.8.
 *
 * ==> DRIVEN BY REAL BYTES, INCLUDING TWO WHOLE REAL SEASONS. <==
 * `samples/seasons/seasons/al-2005.txt` and `al-2021.txt` are NOAA's own cuts
 * of the 2005 and 2021 Atlantic seasons, and the individual storm files beside
 * them cover every era in the record — 1851, 1932's east longitude, 1935's
 * unnamed Labor Day storm, 1971's missing intensity, 1989, 1992, 2005, 2021.
 * Concatenating those into one file makes a source that spans 170 years with
 * awkward storms at both ends, which is a harder thing to cut correctly than
 * anything anybody would invent.
 *
 * WHAT THIS FILE IS ACTUALLY GUARDING
 *
 * 1. **A LOST STORM IS INVISIBLE.** A cut that drops the last storm of a year
 *    produces a season page that is simply quieter than it should be, and
 *    nothing on screen says so. `verifySlices` is the only thing standing
 *    between that and a reader, so the mutations below are all shapes of "lose
 *    something quietly" rather than shapes of "throw".
 * 2. **THE VERBATIM RULE.** The slicer must not filter invests out. The app's
 *    parser already does that (§57.13) and one rule in two files is one rule
 *    that will disagree with itself.
 * 3. **THE SWEEP.** A new revision must remove the old revision's cuts. §57.34
 *    rule 3 — replaced, never accumulated — and a directory holding two
 *    revisions of 2005 is a directory where the index picks one at random.
 *
 * Zero dependencies. `node tools/test-seasons-slice.mjs`
 */

import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseHurdat2 } from '../lib/hurdat.js';
import {
  seasonFileName, sliceMatcher, sliceSeasons, syncSlices, verifySlices,
} from './seasons-slice.mjs';

let passed = 0;
const failures = [];
const ok = (label, cond) => { if (cond) passed++; else failures.push(label); };
const eq = (label, got, want) =>
  ok(`${label} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`,
    JSON.stringify(got) === JSON.stringify(want));

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const s2005 = read('../samples/seasons/seasons/al-2005.txt');
const s2021 = read('../samples/seasons/seasons/al-2021.txt');

/* Every era in one file: 1851, 1852, 1932 (east longitude), 1935 (unnamed),
 * 1955, 1971 (no assigned intensity), 1989, 1992, then two whole seasons. */
const STORM_FILES = [
  'al011851.txt', 'al011852.txt', 'al041932.txt', 'al031935.txt',
  'al091955.txt', 'al021971.txt', 'al111989.txt', 'al041992.txt',
];
const storms = STORM_FILES.map((n) => read(`../samples/seasons/storms/${n}`));
const wide = `${storms.join('')}${s2005}${s2021}`;

/* ===========================================================================
 * THE CUT — every season in, nothing invented
 * ========================================================================= */

{
  const { seasons, faults } = sliceSeasons(wide);
  eq('a 170-year source cuts with no faults', faults, []);
  eq('every season in the source has a cut',
    [...seasons.keys()].sort((a, b) => a - b),
    [1851, 1852, 1932, 1935, 1955, 1971, 1989, 1992, 2005, 2021]);

  /* The single-storm years hold exactly their one storm; the two whole seasons
   * hold what NOAA published. Counted off the real bytes, never typed. */
  const count = (year) => parseHurdat2(seasons.get(year)).storms.length;
  eq('1851 holds one storm', count(1851), 1);
  eq('1935 holds one storm', count(1935), 1);
  eq('2005 holds every storm of 2005', count(2005), parseHurdat2(s2005).storms.length);
  eq('2021 holds every storm of 2021', count(2021), parseHurdat2(s2021).storms.length);

  ok('every cut ends in a newline',
    [...seasons.values()].every((body) => body.endsWith('\n')));

  /* The cut is a SUBSTRING of the source with nothing rewritten. Whitespace
   * survives, field order survives, NOAA's own spacing survives. */
  const body2021 = seasons.get(2021);
  ok('the 2021 cut is the source bytes, not a re-rendering',
    s2021.split('\n').filter((l) => l.trim()).every((l) => body2021.includes(l)));
}

/* ===========================================================================
 * THE VERBATIM RULE — invests stay in the cut, and the parser drops them
 * ========================================================================= */

{
  /* A real invest header, in NOAA's own shape, dropped into a real season.
   * §57.13: 90-99 are invests and the app must not show them. The SLICER must
   * still carry them, or the filter exists in two places. */
  const invest = 'AL932005,  INVEST     ,      1,\n20050601, 0000,  , TD, 12.0N,  60.0W,  25, 1010, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999,\n';
  const { seasons } = sliceSeasons(`${invest}${s2005}`);
  ok('the invest is carried into the cut verbatim', seasons.get(2005).includes('AL932005'));
  eq('and the app parser drops it, exactly as it drops it from the whole file',
    parseHurdat2(seasons.get(2005)).storms.filter((s) => s.id === 'AL932005').length, 0);
}

/* ===========================================================================
 * THE VERIFY — the gate that makes a lost storm loud
 * ========================================================================= */

{
  const { seasons } = sliceSeasons(wide);
  const verdict = verifySlices(wide, seasons);
  ok('honest cuts verify', verdict.ok === true && verdict.reason === null);
  eq('and it counts what it checked', verdict.seasons, 10);
  eq('storm count matches the whole file', verdict.storms, parseHurdat2(wide).storms.length);
}

{
  /* MUTATION 1 — a season goes missing entirely. */
  const { seasons } = sliceSeasons(wide);
  seasons.delete(1992);
  const v = verifySlices(wide, seasons);
  ok('a missing season is refused', v.ok === false);
  ok('and it says which one', String(v.reason).includes('1992'));
}

{
  /* MUTATION 2 — the last storm of a season is dropped. THE ONE THAT MATTERS:
   * this is what a boundary bug looks like, and it is silent everywhere else. */
  const { seasons } = sliceSeasons(wide);
  const body = seasons.get(2005);
  const parsed = parseHurdat2(body);
  const lastId = parsed.storms[parsed.storms.length - 1].id;
  const cutAt = body.indexOf(`${lastId},`);
  seasons.set(2005, body.slice(0, cutAt));
  const v = verifySlices(wide, seasons);
  ok('a season missing its last storm is refused', v.ok === false);
  ok('and it names the season and the storm', String(v.reason).includes('2005') && String(v.reason).includes(lastId));
}

{
  /* MUTATION 3a — a row inside a storm is dropped. The storm's own header
   * declares how many rows follow it, so the parser catches this before any
   * comparison does — which is worth asserting rather than assuming. */
  const { seasons } = sliceSeasons(wide);
  const lines = seasons.get(2021).split('\n');
  lines.splice(5, 1);
  seasons.set(2021, lines.join('\n'));
  const v = verifySlices(wide, seasons);
  ok('a dropped track row is refused', v.ok === false);
  ok('and the declared row count is what catches it',
    String(v.reason).includes('2021') && String(v.reason).includes('row_count_mismatch'));
}

{
  /* MUTATION 3b — a NUMBER inside a row changes. Right storms, right row
   * count, wrong track. Nothing but the field-by-field comparison can see
   * this, and it is the shape a re-encoding bug would take. */
  const { seasons } = sliceSeasons(wide);
  const lines = seasons.get(2021).split('\n');
  const at = lines.findIndex((l) => l.split(',').length > 4);
  const fields = lines[at].split(',');
  fields[6] = '  17';
  lines[at] = fields.join(',');
  seasons.set(2021, lines.join('\n'));
  const v = verifySlices(wide, seasons);
  ok('a changed wind speed is refused', v.ok === false);
  ok('and it says the storms are the same but the numbers are not',
    String(v.reason).includes('same storms'));
}

{
  /* MUTATION 4 — a storm files under the wrong year. */
  const { seasons } = sliceSeasons(wide);
  seasons.set(1990, seasons.get(1989));
  const v = verifySlices(wide, seasons);
  ok('a season the file does not contain is refused', v.ok === false);
}

/* ===========================================================================
 * BAD SOURCE — reported, never guessed at
 * ========================================================================= */

{
  const { faults } = sliceSeasons(`NOT-A-STORM, JUNK, 3,\n${s2021}`);
  eq('an unreadable header is one fault', faults.length, 1);
  eq('and it is named as such', faults[0].kind, 'bad_header');
}

{
  /* A data row before any header. There is no year to file it under and
   * guessing one is how a storm ends up in the wrong century. */
  const rows = s2021.split('\n');
  const orphan = rows.find((l) => l.split(',').length > 4);
  const { faults } = sliceSeasons(`${orphan}\n${s2021}`);
  ok('a row with no storm above it is a fault',
    faults.some((f) => f.kind === 'orphan_row'));
}

/* ===========================================================================
 * NAMING — the revision travels with the season
 * ========================================================================= */

{
  eq('a season file names its basin, year and revision',
    seasonFileName('atlantic', 2005, '02272026'), 'atlantic-2005-02272026.txt');

  const m = sliceMatcher('atlantic');
  ok('the matcher finds a slice', m.test('atlantic-2005-02272026.txt'));
  /* ==> IT MUST NOT MATCH THE WHOLE FILE. <== They share a directory, and a
   * matcher that caught both would have the sweep below delete the basin. */
  ok('and never the whole basin file', !m.test('hurdat2-atlantic-2025-02272026.txt'));
  ok('and never the other basin', !m.test('epacific-2005-02272026.txt'));
}

/* ===========================================================================
 * THE SWEEP — one revision on disk, never two
 * ========================================================================= */

{
  const dir = mkdtempSync(join(tmpdir(), 'seasons-slice-'));

  const first = syncSlices(dir, 'atlantic', '02272026', wide);
  ok('a first run writes', first.ok === true);
  eq('one file per season', first.written, 10);
  eq('nothing to remove', first.removed, 0);
  eq('and the index maps year to filename',
    first.seasons[2005], 'atlantic-2005-02272026.txt');

  const again = syncSlices(dir, 'atlantic', '02272026', wide);
  ok('a second run with the same bytes writes nothing', again.ok === true);
  eq('nothing written', again.written, 0);
  eq('nothing removed', again.removed, 0);

  /* NOAA republishes. Every cut must move to the new name and the old ones
   * must go — §57.34 rule 3. */
  const revised = syncSlices(dir, 'atlantic', '03152026', wide);
  ok('a new revision writes', revised.ok === true);
  eq('every season is rewritten under the new stamp', revised.written, 10);
  eq('and every old cut is swept', revised.removed, 10);

  const left = readdirSync(dir).filter((n) => sliceMatcher('atlantic').test(n));
  eq('exactly one revision is left on disk', left.length, 10);
  ok('and it is the new one', left.every((n) => n.includes('03152026')));

  /* A season NOAA stops publishing is swept too, and the whole file shrinking
   * is the only way that happens. */
  const narrower = syncSlices(dir, 'atlantic', '03152026', s2021);
  ok('a narrower file writes', narrower.ok === true);
  eq('and the seasons no longer in it are removed', narrower.removed, 9);
}

{
  /* ==> A BAD CUT WRITES NOTHING AT ALL. <== A directory half-swept against a
   * file that could not be verified is a history with a hole in it. */
  const dir = mkdtempSync(join(tmpdir(), 'seasons-slice-bad-'));
  writeFileSync(join(dir, 'atlantic-2005-01012020.txt'), 'held\n');
  const broken = `${wide}\nAL0X2021, GARBAGE, 2,\n`;
  const v = syncSlices(dir, 'atlantic', '02272026', broken);
  ok('a source that cannot be cut is refused', v.ok === false);
  eq('nothing was written', v.written, 0);
  eq('nothing was removed', v.removed, 0);
  eq('and the file already there is untouched',
    readFileSync(join(dir, 'atlantic-2005-01012020.txt'), 'utf8'), 'held\n');
}

{
  /* ==> AND A SOURCE THAT CUTS CLEANLY BUT DOES NOT VERIFY MUST ALSO WRITE
   * NOTHING. <== This is a different door into the same room, and the first
   * version of this suite did not have it: the case above is caught by the
   * CUT, so removing the verify gate entirely left the suite green. A header
   * whose declared row count is a lie cuts perfectly and parses badly, which
   * is exactly the shape a truncated download takes. */
  const dir = mkdtempSync(join(tmpdir(), 'seasons-slice-unverified-'));
  writeFileSync(join(dir, 'atlantic-2021-01012020.txt'), 'held\n');

  const lines = s2021.split('\n');
  const header = lines.findIndex((l) => l.split(',').length <= 4);
  const fields = lines[header].split(',');
  fields[2] = ' 999';
  lines[header] = fields.join(',');
  const lying = lines.join('\n');

  eq('it still cuts without a fault', sliceSeasons(lying).faults, []);
  ok('and the verify catches it', verifySlices(lying, sliceSeasons(lying).seasons).ok === false);

  const v = syncSlices(dir, 'atlantic', '02272026', lying);
  ok('so nothing is written', v.ok === false && v.written === 0);
  eq('nothing is removed', v.removed, 0);
  eq('and what was already there survives',
    readdirSync(dir).filter((n) => sliceMatcher('atlantic').test(n)),
    ['atlantic-2021-01012020.txt']);
}

/* ========================================================================= */

console.log(`\ntest-seasons-slice: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
