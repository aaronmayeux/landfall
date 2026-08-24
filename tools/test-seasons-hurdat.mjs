#!/usr/bin/env node
/**
 * test-seasons-hurdat.mjs — picking NOAA's newest HURDAT2 file, and refusing a
 * bad one. Drives `tools/seasons-hurdat.mjs`. SPEC-OPS.md §18.8, §57.34 rule 3,
 * §57.35 FIX 11.
 *
 * ==> RUN AGAINST THE REAL DIRECTORY LISTING, NOT AN INVENTED ONE. <==
 * `samples/seasons/listings/hurdat-directory-2026-08-24.html` is the page NOAA
 * served on 2026-08-24, captured by the step 0 probe. Forty-one files, five
 * revisions of one season, two naming lineages and four PDFs — a listing this
 * awkward is not something anybody would think to invent, which is the whole
 * argument for testing against real bytes.
 *
 * THE THREE THINGS THIS FILE EXISTS FOR
 *
 * 1. **THE ALPHABETICAL TRAP.** The probe's first run read a file two seasons
 *    stale by sorting the directory, and the test below PROVES the trap is
 *    still in the real listing rather than trusting that story: it asserts that
 *    a naive sort lands on `hurdat2-atl-1851-2023-042624.txt` and that the
 *    picker does not.
 * 2. **THE TIE-BREAK.** Five revisions of the 2022 Atlantic season, in two
 *    different date widths. This is the case §57.35 FIX 11 did not account for
 *    and the reason the revision stamp is now in the output filename.
 * 3. **THE GUARD.** A truncated or malformed file must be refused rather than
 *    committed over 175 good seasons. Driven with real storms from
 *    `samples/seasons/`, deliberately damaged.
 *
 * Zero dependencies. `node tools/test-seasons-hurdat.mjs`
 */

import { readFileSync } from 'node:fs';

import {
  hrefs, revisionRank, pickFiles, outputName, judge, buildIndex, BASINS,
} from './seasons-hurdat.mjs';

let passed = 0;
const failures = [];
const ok = (label, cond) => { if (cond) passed++; else failures.push(label); };
const eq = (label, got, want) =>
  ok(`${label} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`,
    JSON.stringify(got) === JSON.stringify(want));

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const listing = read('../samples/seasons/listings/hurdat-directory-2026-08-24.html');

/* ===========================================================================
 * THE REVISION STAMP — two widths, and one of them has a letter on it
 * ========================================================================= */

eq('8-digit MMDDYYYY', revisionRank('02272026'), (2026 * 10000 + 227) * 100);
eq('6-digit MMDDYY', revisionRank('052425'), (2025 * 10000 + 524) * 100);
ok('a letter suffix breaks a same-day tie upward',
  revisionRank('043021a') > revisionRank('043021'));
ok('February 2026 outranks May 2023 across the two widths',
  revisionRank('02272026') > revisionRank('050423'));
ok('the same date in two widths ranks equal',
  revisionRank('04072023') === revisionRank('040723'));
eq('a stamp that is not a date is refused', revisionRank('notadate'), null);
eq('month 13 is refused', revisionRank('132026'), null);
eq('day 00 is refused', revisionRank('020026'), null);
eq('an empty stamp is refused', revisionRank(''), null);
eq('a 7-digit stamp is refused', revisionRank('0227202'), null);

/* ===========================================================================
 * THE PICK — against the real listing
 * ========================================================================= */

const { chosen, counts, unplaced, listed } = pickFiles(listing);

ok(`the listing has files in it (${listed})`, listed > 40);
eq('Atlantic pick', chosen.atlantic.name, 'hurdat2-1851-2025-02272026.txt');
eq('Atlantic last season', chosen.atlantic.lastSeason, 2025);
eq('Atlantic first season', chosen.atlantic.firstSeason, 1851);
eq('E/C Pacific pick', chosen.epacific.name, 'hurdat2-nepac-1949-2025-02272026.txt');
eq('E/C Pacific last season', chosen.epacific.lastSeason, 2025);
eq('E/C Pacific first season', chosen.epacific.firstSeason, 1949);

/* ==> THE TRAP IS STILL IN THE REAL LISTING. <== Without this assertion the one
 * above proves nothing: a picker that happened to sort correctly would pass it.
 * `hurdat2-atl-…` sorts after `hurdat2-1851-…` because `a` sorts after `1`, and
 * that one character is the entire step 0 bug. */
const atlanticIsh = hrefs(listing)
  .map((h) => h.split('/').pop())
  .filter((n) => /^hurdat2-(?!nepac|format)/i.test(n) && n.endsWith('.txt'))
  .sort();
eq('a naive sort really does land on a stale file',
  atlanticIsh[atlanticIsh.length - 1], 'hurdat2-atl-1851-2023-042624.txt');
ok('the picker does not', chosen.atlantic.name !== atlanticIsh[atlanticIsh.length - 1]);

/* ==> THE PACIFIC PATTERN MUST NOT SWALLOW AN ATLANTIC FILE OR VICE VERSA. <==
 * `nepac` is not four digits, so it cannot match the Atlantic pattern; asserted
 * rather than reasoned about, because the two patterns differ by one token. */
ok('the Atlantic pattern rejects a nepac name',
  !BASINS[0].pattern.test('hurdat2-nepac-1949-2025-02272026.txt'));
ok('the Pacific pattern rejects an Atlantic name',
  !BASINS[1].pattern.test('hurdat2-1851-2025-02272026.txt'));
ok('neither pattern matches a format PDF',
  BASINS.every((b) => !b.pattern.test('hurdat2-format-atlantic.pdf')));
ok('neither pattern matches the no-season-range file',
  BASINS.every((b) => !b.pattern.test('hurdat2-atl-02052024.txt')));

/* ==> A NAMING CHANGE IS REPORTED, NEVER ABSORBED. <== If NOAA renames these
 * files every pattern stops matching, the job finds nothing, and without this
 * it reports a cheerful "nothing changed" every month forever. The two `atl`
 * files are the live proof that the reporting path actually fires. */
ok('the two atl-lineage files are reported as unplaced',
  unplaced.some((u) => u.name === 'hurdat2-atl-1851-2023-042624.txt') &&
  unplaced.some((u) => u.name === 'hurdat2-atl-02052024.txt'));
ok('every unplaced file says why',
  unplaced.every((u) => typeof u.why === 'string' && u.why.length > 5));
ok('a format PDF is not reported as unplaced',
  !unplaced.some((u) => u.name.endsWith('.pdf')));

/* ===========================================================================
 * THE TIE-BREAK — five revisions of one season, in two date widths
 * ========================================================================= */

const TIED = `
  <a href="hurdat2-1851-2022-04042023.txt">x</a>
  <a href="hurdat2-1851-2022-04072023.txt">x</a>
  <a href="hurdat2-1851-2022-040723.txt">x</a>
  <a href="hurdat2-1851-2022-042723.txt">x</a>
  <a href="hurdat2-1851-2022-050423.txt">x</a>
`;
eq('the newest revision of a tied season wins',
  pickFiles(TIED).chosen.atlantic.name, 'hurdat2-1851-2022-050423.txt');
eq('five candidates were considered', pickFiles(TIED).counts.atlantic, 5);

/* ==> AND THIS IS WHY THE REVISION IS IN THE OUTPUT FILENAME. <== §57.35 FIX 11
 * said the SEASON in the filename is the cache bust. These five files are all
 * season 2022, so under that rule every one of them writes to the same URL —
 * and that URL is served `immutable`, so a browser that fetched the April
 * revision keeps it forever and never sees the May correction. */
const names2022 = ['04042023', '050423'].map((r) => outputName('atlantic', 2022, r));
ok('two revisions of one season produce two different filenames',
  names2022[0] !== names2022[1]);
ok('the season is still in the filename', names2022.every((n) => n.includes('-2022-')));

/* A season with no candidates at all is null, not a crash and not a guess. */
eq('no candidates means no pick', pickFiles('<a href="readme.txt">x</a>').chosen.atlantic, null);
eq('an empty page means no pick', pickFiles('').chosen.epacific, null);

/* ==> AN UNREADABLE REVISION STAMP IS DROPPED AND REPORTED, NEVER RANKED ZERO.
 * <== THIS BLOCK EXISTS BECAUSE THE SUITE WITHOUT IT PASSED WITH THE RULE
 * DELETED. Ranking an unparseable stamp as zero looks harmless — it just loses
 * every tie — and on the day NOAA changes the stamp format it means the NEWEST
 * season's file is silently ranked below every older one and never chosen,
 * with nothing in the report saying so. Dropping it produces the same pick and
 * a loud line in the summary, which is the difference that matters.
 *
 * The shape below is that day: the 2026 file has a stamp nothing can read, and
 * 2025 is the last one that parses. */
const FUTURE_FORMAT = `
  <a href="hurdat2-1851-2025-02272026.txt">x</a>
  <a href="hurdat2-1851-2026-rev7.txt">x</a>
`;
const ff = pickFiles(FUTURE_FORMAT);
eq('an unreadable stamp does not win its season',
  ff.chosen.atlantic.name, 'hurdat2-1851-2025-02272026.txt');
ok('and it is reported rather than absorbed',
  ff.unplaced.some((u) => u.name === 'hurdat2-1851-2026-rev7.txt' && /stamp/i.test(u.why)));
eq('it is not counted as a candidate either', ff.counts.atlantic, 1);

/* ===========================================================================
 * THE GUARD — real storms, deliberately damaged
 * ========================================================================= */

const ida = read('../samples/seasons/storms/al092021.txt');
const katrina = read('../samples/seasons/storms/al122005.txt');
const clean = `${ida}\n${katrina}`;

const good = judge(clean, { stormFloor: 2 });
ok('a clean file passes', good.ok === true);
eq('and counts its storms', good.storms, 2);
eq('with no faults', good.faults, 0);

/* TRUNCATION. The header declares a row count; cutting the file mid-storm makes
 * `parseHurdat2` report `row_count_mismatch`. This is the check rather than a
 * byte-size comparison, because the file grows every year and there is no size
 * that means "complete". */
const truncated = clean.slice(0, Math.floor(clean.length * 0.6));
const cut = judge(truncated, { stormFloor: 0 });
ok('a truncated file is refused', cut.ok === false);
ok('and the reason names the fault', /fault/i.test(cut.reason || ''));

/* A REDIRECT TO AN ERROR PAGE. The likeliest real failure, and the one that
 * would otherwise commit an HTML page over 6.8 MB of history. */
const errorPage = judge('<!DOCTYPE html><h1>503 Service Unavailable</h1>', { stormFloor: 0 });
ok('an HTML error page is refused', errorPage.ok === false);

/* THE REGRESSION TEST, which is the strong one: HURDAT2 only ever grows. A
 * reanalysis changes a storm's numbers; it does not delete a hurricane from
 * history. Fewer storms than last time means we would be holding less of the
 * record than we already have. */
const fewer = judge(ida, { previousText: clean });
ok('a file with fewer storms than the one it replaces is refused', fewer.ok === false);
ok('and the reason gives both counts', /\b1\b[\s\S]*\b2\b/.test(fewer.reason || ''));

const same = judge(clean, { previousText: clean });
ok('the same file again is accepted', same.ok === true);
const more = judge(`${clean}\n${read('../samples/seasons/storms/al041992.txt')}`,
  { previousText: clean });
ok('a file with one more storm is accepted', more.ok === true);

/* THE FLOOR only guards a FIRST run, when there is nothing to compare against. */
const underFloor = judge(clean, { stormFloor: 1500 });
ok('a first run under the floor is refused', underFloor.ok === false);
ok('and the reason names the floor', /floor/i.test(underFloor.reason || ''));
ok('the shipped floors sit well under the measured counts — Atlantic',
  BASINS[0].stormFloor < 2004 && BASINS[0].stormFloor > 1000);
ok('the shipped floors sit well under the measured counts — E/C Pacific',
  BASINS[1].stormFloor < 1262 && BASINS[1].stormFloor > 500);

/* ==> A PREVIOUS FILE BEATS THE FLOOR, NOT THE OTHER WAY ROUND. <== Once there
 * is something to compare against, the floor is not consulted at all — it is a
 * cruder version of the same question and having both fire would mean a file
 * could be refused for being smaller than a number nobody measured. */
ok('with a previous file, the floor is not consulted',
  judge(clean, { previousText: ida, stormFloor: 1500 }).ok === true);

/* ===========================================================================
 * THE INDEX — the one mutable file pointing at immutable ones
 * ========================================================================= */

const index = buildIndex(
  { atlantic: { file: '/seasons/data/hurdat2-atlantic-2025-02272026.txt', lastSeason: 2025 } },
  { generatedAt: '2026-08-24T00:00:00.000Z' }
);
eq('the index says it is the reviewed record', index.provisional, false);
ok('the index names the file the app fetches',
  index.basins.atlantic.file.startsWith('/seasons/data/'));
ok('the index does not live under data/', !index.basins.atlantic.file.startsWith('/data/'));

/* ------------------------------------------------------------------------ */

if (failures.length) {
  console.log(`FAIL  test-seasons-hurdat — ${failures.length} of ${passed + failures.length}`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`ok    test-seasons-hurdat — ${passed} assertions`);
