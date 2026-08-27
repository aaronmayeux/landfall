/**
 * test-wall-filter.mjs — the Wall of Years' filters, sort and honesty numbers.
 * SPEC-SEASONS-BUILD.md §57.36, §57.30 step 3.
 *
 * ==> IT RUNS AGAINST THE REAL `seasons/wall.json`, NOT A FIXTURE. <== The
 * numbers §57.36 argues from are measurements off that file — 13 Category 5s
 * across 115 pre-satellite seasons against 32 across 60 since, and 142 of 175
 * Atlantic rows emptied by a Category 5 filter. A fixture would let those
 * numbers drift out of the spec without anything noticing; asserting them
 * against the shipped file means a regenerated archive that changes them turns
 * this red and the spec gets corrected.
 *
 * ==> EVERY SECTION BELOW WAS MUTATION-CHECKED. <== §12 — a test that passes on
 * the same wrong assumption as the bug is worse than no test. The mutations
 * that were run and confirmed to bite are named beside the sections they cover.
 *
 *   node tools/test-wall-filter.mjs
 */

import { readFileSync } from 'node:fs';

import { SEASONS } from '../config/constants.js';
import { ACE, CAT, DAYS, LANDFALL, PRESSURE_MB, aggregate, rowsFor, stormRow } from '../lib/wall-index.js';
import {
  CATEGORY_INDEXES, categoriesNarrowed, emptyFilter, eraSplit, filterPhrase,
  isFiltered, isTimeline, keepFor, sortFigure, sortRows, sortValue,
} from '../lib/wall-filter.js';
import { catProse } from '../ui/seasons-wall-markup.js';

let passed = 0;
const failures = [];
const ok = (what, cond) => {
  if (cond) { passed++; console.log(`  ok    ${what}`); }
  else { failures.push(what); console.log(`  FAIL  ${what}`); }
};
const eq = (what, got, want) => ok(`${what} — got ${JSON.stringify(got)}`,
  JSON.stringify(got) === JSON.stringify(want));
const section = (t) => console.log(`\n${t}`);

const wall = JSON.parse(readFileSync(new URL('../seasons/wall.json', import.meta.url), 'utf8'));

/** Category 5 is index 6 — `lib/category.js` grades 0 = TD, 1 = TS, 2..6 =
 *  Cat 1..5. Named here because reading `6` as "Category 6" is the single
 *  easiest mistake to make against this file, and a session already made it. */
const CAT5 = 6;
const CAT3 = 4;

const catFilter = (...cats) => ({ ...emptyFilter(), cats: new Set(cats) });

/* ---------------------------------------------------------------------------
 * 1. WHAT COUNTS AS FILTERED
 *
 * MUTATION RUN: `categoriesNarrowed` returning `f.cats.size <= 7` rather than
 * `< 7`. Turns the whole screen "filtered" with nothing narrowed — the count
 * column would show `31 of 31` on every row and the undercount line would sit
 * over an unfiltered wall. Confirmed red.
 * ------------------------------------------------------------------------- */
section('1. Nothing narrowed is not the same as narrowed to everything');

ok('a fresh filter has every chip checked',
  emptyFilter().cats.size === CATEGORY_INDEXES.length);
ok('and is not filtered', !isFiltered(emptyFilter()));
ok('all seven chips checked is not narrowed', !categoriesNarrowed(emptyFilter()));
ok('six chips is narrowed', categoriesNarrowed(catFilter(0, 1, 2, 3, 4, 5)));
ok('the landfall toggle alone counts as filtered',
  isFiltered({ ...emptyFilter(), landfall: true }));
ok('a threshold alone counts as filtered',
  isFiltered({ ...emptyFilter(), minDays: 10 }));
ok('and an unfiltered wall builds NO predicate at all', keepFor(emptyFilter()) === null);

/* ==> EVERY CHIP IS A FRESH SET, OR ONE TAP EDITS THE DEFAULT FOR THE SESSION.
 * <== A frozen module-level default would be written through on the first tap
 * and every later `emptyFilter()` would come back already narrowed. */
const a = emptyFilter();
a.cats.delete(CAT5);
ok('emptyFilter hands out a fresh set each time',
  emptyFilter().cats.size === CATEGORY_INDEXES.length);

/* ---------------------------------------------------------------------------
 * 2. THE PREDICATE, AGAINST THE REAL ARCHIVE
 *
 * MUTATION RUN: the pressure test flipped from `<=` to `>=`. Every storm with
 * a reading passes "below 950 mb" and the strongest storms drop out. Red.
 * MUTATION RUN: the ungraded-category branch changed to let a `null` category
 * through any chip set. Red on section 3's count.
 * ------------------------------------------------------------------------- */
section('2. Each filter selects what it says it selects');

const atl = wall.basins.atlantic.years;
const allStorms = Object.values(atl).flat();

const survives = (f) => allStorms.filter(keepFor(f) || (() => true));

eq('Category 5 selects exactly the Cat 5 storms',
  survives(catFilter(CAT5)).length,
  allStorms.filter((s) => s[CAT] === CAT5).length);

ok('and every one of them really is a Cat 5',
  survives(catFilter(CAT5)).every((s) => s[CAT] === CAT5));

ok('three chips select the union of the three',
  survives(catFilter(CAT3, 5, CAT5)).every((s) => [CAT3, 5, CAT5].includes(s[CAT])));

ok('the landfall toggle keeps only storms that came ashore',
  survives({ ...emptyFilter(), landfall: true }).every((s) => s[LANDFALL] === 1));

ok('and it stacks with the chips rather than replacing them',
  survives({ ...catFilter(CAT5), landfall: true })
    .every((s) => s[CAT] === CAT5 && s[LANDFALL] === 1));

ok('a duration floor keeps only storms that lasted at least that long',
  survives({ ...emptyFilter(), minDays: 14 }).every((s) => s[DAYS] >= 14));

ok('==> AND A PRESSURE FILTER IS A CEILING, BECAUSE LOWER IS STRONGER <==',
  survives({ ...emptyFilter(), maxPressureMb: 950 }).every((s) => s[PRESSURE_MB] <= 950));

ok('an ACE floor keeps only storms at or above it',
  survives({ ...emptyFilter(), minAce: 20 }).every((s) => s[ACE] >= 20));

/* ==> §5 THROUGH A PREDICATE: WHAT WAS NEVER MEASURED IS NOT ZERO. <==
 * 1,258 of the 3,266 storms in this archive carry no central pressure at all,
 * almost all of them before aircraft reconnaissance. Sweeping them into "below
 * 950 mb" on a stand-in figure would put the whole 19th century under a filter
 * on the strength of a reading nobody took. */
section('3. What was never measured is excluded, never counted as nought');

const noPressure = allStorms.filter((s) => s[PRESSURE_MB] == null);
ok(`the archive really does hold unmeasured pressures (${noPressure.length})`,
  noPressure.length > 0);
ok('and none of them survives a pressure filter',
  survives({ ...emptyFilter(), maxPressureMb: 1000 }).every((s) => s[PRESSURE_MB] != null));

const noAce = allStorms.filter((s) => s[ACE] == null);
ok(`the archive really does hold unmeasured ACE (${noAce.length})`, noAce.length > 0);
ok('and none of them survives an ACE floor of zero-point-one',
  survives({ ...emptyFilter(), minAce: 0.1 }).every((s) => s[ACE] != null));

/* An ungraded storm cannot be claimed for a chip. The shipped archive happens
 * to grade every storm, so this is asserted on a constructed row rather than
 * skipped — the day a parser change lets a null through is the day it matters,
 * and that day must not be the first time anybody asks. */
const ungraded = [null, 0, null, null, 5, null, ''];
ok('an ungraded storm fails a category filter', !keepFor(catFilter(CAT5))(ungraded));
ok('and is still on an unfiltered wall', keepFor(emptyFilter()) === null);

/* ---------------------------------------------------------------------------
 * 3b. THE PER-ROW AGGREGATE
 *
 * ==> THIS SECTION EXISTS BECAUSE A MUTATION SURVIVED WITHOUT IT. <== Changing
 * `aggregate` to add unmeasurable ACE as zero left every assertion green, and
 * the reason is subtle enough to be worth writing down: adding nought does not
 * move the SUM, so a season with some unmeasured storms looks identical either
 * way. The difference only shows on a row where NOTHING was measurable — which
 * no whole season in the archive is, but which a FILTER produces the moment it
 * narrows a season down to a storm with no ACE. That row would then sort as the
 * quietest on record rather than as unknown. §5, exactly.
 * ------------------------------------------------------------------------- */
section('3b. A row whose storms were never measured has no figure, not a zero');

const storm = (cat, lf, ace) => [cat, lf, ace, null, null, null, ''];

const someMeasured = aggregate([storm(CAT5, 1, 4), storm(2, 0, null), storm(3, 1, 6)]);
eq('measurable ACE sums and the unmeasurable is skipped', someMeasured.ace, 10);
ok('and the row counts as measured', someMeasured.aceMeasured);
eq('the strongest is the highest grade present', someMeasured.strongest, CAT5);
eq('and landfalls counts the storms that came ashore', someMeasured.landfalls, 2);

const noneMeasured = aggregate([storm(2, 0, null), storm(3, 1, null)]);
eq('==> A ROW WITH NOTHING MEASURABLE HAS NO ACE AT ALL <==', noneMeasured.ace, null);
ok('and says so rather than reporting nought', noneMeasured.aceMeasured === false);
eq('an empty row has no ACE either', aggregate([]).ace, null);
eq('and nothing graded', aggregate([]).strongest, -1);

/* ==> AND AN UNGRADED STORM DOES NOT RAISE `strongest` TO A TROPICAL
 * DEPRESSION. <== A second surviving mutation, and this one is a JavaScript
 * trap rather than an oversight: `null > -1` is TRUE, because null coerces to
 * zero. So dropping the `Number.isFinite` guard makes a season whose only
 * surviving storm was never graded report its strongest as a TD — a grade the
 * record never gave it (§6), from a comparison that looks harmless. */
eq('==> AN UNGRADED STORM STAYS UNGRADED, IT DOES NOT BECOME A TD <==',
  aggregate([storm(null, 0, null)]).strongest, -1);
eq('and it does not drag a real grade down either',
  aggregate([storm(null, 0, null), storm(3, 0, 1)]).strongest, 3);

/* ==> THE SAME RULE ONE LAYER DOWN, IN THE ROW THE GENERATOR WRITES. <== A
 * third surviving mutation: `stormRow` filling a missing pressure with a
 * sea-level stand-in passed every suite in the repo. It would have put the
 * whole pre-reconnaissance record — 1,258 storms — inside a "below 1000 mb"
 * filter on a reading nobody took. */
eq('a storm with no pressure reading writes null, never a stand-in',
  stormRow({ peakCategory: 3, landfalls: [], ace: 1, peakWindKt: 90, lifespanHours: 24 })[PRESSURE_MB],
  null);
eq('and a real reading is carried through untouched',
  stormRow({
    peakCategory: 3, landfalls: [], ace: 1, peakWindKt: 90,
    lifespanHours: 24, lowestPressureMb: 902,
  })[PRESSURE_MB], 902);

/* And the consequence, through the comparator: unknown must not win "least
 * ACE first". This is the assertion the surviving mutation was hiding from. */
const unknownRow = { year: 1900, shown: [], total: 1, ...noneMeasured, pre: true };
const knownRow = { year: 2000, shown: [], total: 1, ...someMeasured, pre: false };
eq('so least-ACE-first does not present an unmeasured season as the quietest',
  sortRows([unknownRow, knownRow], 'ace', 'asc').map((r) => r.year), [2000, 1900]);

/* ---------------------------------------------------------------------------
 * 4. ==> FILTER FIRST, THEN SORT WHAT SURVIVES. <==
 *
 * This is the rule §57.36 says the whole screen rests on, and Aaron's own
 * example is the test case.
 *
 * MUTATION RUN: `sortValue('count')` reading `row.total` instead of
 * `row.shown.length`. 2005 still tops the list (it has the most Cat 5s AND the
 * most storms), so the first assertion below stayed green — 1932 against 1933
 * is what catches it, because they tie on Cat 5s and differ hugely on totals.
 * That near-miss is why the second assertion exists.
 * ------------------------------------------------------------------------- */
section('4. Every sort key is computed over the FILTERED set');

const cat5Rows = rowsFor(wall, 'atlantic', keepFor(catFilter(CAT5)));
const byCount = sortRows(cat5Rows, 'count', 'desc');

eq('filtered to Cat 5 and sorted by count, 2005 leads with four',
  [byCount[0].year, byCount[0].shown.length], [2005, 4]);
eq('then 2025 with three', [byCount[1].year, byCount[1].shown.length], [2025, 3]);

/* ==> THE ASSERTION THAT ACTUALLY CATCHES A SEASON-TOTAL COUNT. <== 1932 had
 * 15 storms and 1933 had 21, and both had two Category 5s. Under the rule they
 * tie and break by year, newest first; under a season-total count 1933 would
 * jump ahead of every other two-Cat-5 season on the strength of storms the
 * filter was asked to ignore. */
const twos = byCount.filter((r) => r.shown.length === 2).map((r) => r.year);
eq('seasons tied on Cat 5s stay in year order, newest first',
  twos, [...twos].sort((x, y) => y - x));
ok('and 1932 is not ranked below 1933 for having had fewer storms overall',
  twos.indexOf(1933) < twos.indexOf(1932));

ok('the strongest key reads the filtered maximum',
  cat5Rows.filter((r) => r.shown.length).every((r) => r.strongest === CAT5));

const lfRows = rowsFor(wall, 'atlantic', keepFor({ ...emptyFilter(), landfall: true }));
ok('the landfall count equals the number of surviving storms under a landfall filter',
  lfRows.every((r) => r.landfalls === r.shown.length));

/* ---------------------------------------------------------------------------
 * 5. THE COMPARATOR
 *
 * MUTATION RUN: unmeasurable ACE sorted as `-Infinity` rather than last. Under
 * "least ACE first" a season nobody could measure is presented as the quietest
 * on record. Red.
 * MUTATION RUN: the year tiebreak removed and the sort left to its stability.
 * Red on section 4's tie assertion.
 * ------------------------------------------------------------------------- */
section('5. Unknown sinks to the bottom in BOTH directions, and ties break by year');

const mk = (year, ace, aceMeasured = true) => ({
  year, shown: [], total: 0, strongest: -1, landfalls: 0, ace, aceMeasured, pre: false,
});
const mixed = [mk(2000, 5), mk(1990, null, false), mk(2010, 1)];

eq('most ACE first puts the unmeasurable last',
  sortRows(mixed, 'ace', 'desc').map((r) => r.year), [2000, 2010, 1990]);
eq('==> AND LEAST ACE FIRST PUTS IT LAST TOO, NOT FIRST <==',
  sortRows(mixed, 'ace', 'asc').map((r) => r.year), [2010, 2000, 1990]);

eq('rows tied on a key come back newest first',
  sortRows([mk(1990, 3), mk(2010, 3), mk(2000, 3)], 'ace', 'asc').map((r) => r.year),
  [2010, 2000, 1990]);

eq('sortValue reads the shown count, never the total',
  sortValue({ ...mk(2005, 0), shown: [1, 2], total: 31 }, 'count'), 2);

ok('sortRows leaves its input alone', (() => {
  const src = [mk(1990, 1), mk(2010, 9)];
  const before = src.map((r) => r.year).join();
  sortRows(src, 'ace', 'desc');
  return src.map((r) => r.year).join() === before;
})());

ok('only the year key is a timeline', isTimeline('year') && !isTimeline('count'));
ok('and every key the control offers is one this file knows',
  SEASONS.wallSortKeys.every((k) => sortValue(mk(2000, 1), k) !== undefined));

/* ---------------------------------------------------------------------------
 * 6. ==> THE UNDERCOUNT, IN THE NUMBERS §57.36 QUOTES. <==
 *
 * These reproduce the spec's own table off the shipped file. If a regenerated
 * archive moves them, this goes red and §57.36 gets corrected rather than
 * quietly becoming fiction.
 * ------------------------------------------------------------------------- */
section('6. The pre-satellite split reproduces the spec exactly');

const split = eraSplit(cat5Rows);
eq('13 Category 5s across 115 pre-satellite seasons',
  [split.preStorms, split.preSeasons], [13, 115]);
eq('32 across 60 seasons since 1966',
  [split.postStorms, split.postSeasons], [32, 60]);
eq('which is 0.11 a year against 0.53',
  [Math.round(split.preRate * 100) / 100, Math.round(split.postRate * 100) / 100],
  [0.11, 0.53]);
ok(`nearly five times the rate (${Math.round(split.ratio * 10) / 10})`,
  split.ratio > 4.5 && split.ratio < 5.2);
eq('and the boundary is the one constant', split.from, SEASONS.satelliteEraFrom);

/* And the case the spec calls the sharpest: sorted by count, almost the whole
 * leaderboard is modern. This is the screen that would state a climate claim. */
const top20 = byCount.slice(0, 20).filter((r) => r.shown.length > 0);
ok(`only 3 of the top 20 Cat 5 seasons are pre-satellite (${top20.filter((r) => r.pre).length})`,
  top20.filter((r) => r.pre).length === 3);

/* A basin with no older era makes no comparison rather than dividing by zero. */
eq('an era with no seasons yields no rate',
  eraSplit([mk(2010, 1)]).preRate, null);
eq('and no ratio', eraSplit([mk(2010, 1)]).ratio, null);

/* ---------------------------------------------------------------------------
 * 7. THE FILTER, IN WORDS
 *
 * MUTATION RUN: `filterPhrase` returning the chips in Set insertion order
 * rather than chip order. Ticking 5 then 3 read as "Category 5 or 3", which
 * does not match the row of chips on screen. Red.
 * ------------------------------------------------------------------------- */
section('7. The collapsed tail can name what it is hiding');

/* ==> THE APP'S OWN PROSE LABEL, IMPORTED RATHER THAN RE-TYPED. <== A local
 * stand-in would let this section stay green while the shipped wording drifted,
 * which is the exact failure §12 calls worse than no test. */
const label = catProse;

eq('an unfiltered wall says "storm"', filterPhrase(emptyFilter(), { catLabel: label }), 'storm');
eq('one chip names that category',
  filterPhrase(catFilter(CAT5), { catLabel: label }), 'Category 5');
eq('==> THREE CHIPS READ AS ONE PHRASE, NOT AS THREE FULL LABELS <==',
  filterPhrase(catFilter(CAT3, 5, CAT5), { catLabel: label }), 'Category 3, 4 or 5');
/* And a mixed selection has no shared word, so nothing is collapsed and
 * nothing is reworded to look as though it does. */
eq('a mixed selection names each in full',
  filterPhrase(catFilter(1, CAT5), { catLabel: label }), 'tropical storm or Category 5');
eq('==> AND THEY READ IN CHIP ORDER, NOT IN THE ORDER THEY WERE TICKED <==',
  filterPhrase({ ...emptyFilter(), cats: new Set([CAT5, CAT3]) }, { catLabel: label }),
  'Category 3 or 5');
eq('the landfall toggle qualifies the noun',
  filterPhrase({ ...catFilter(CAT5), landfall: true }, { catLabel: label }),
  'landfalling Category 5');
eq('the landfall toggle alone still reads',
  filterPhrase({ ...emptyFilter(), landfall: true }, { catLabel: label }),
  'landfalling storm');
eq('a threshold becomes a clause',
  filterPhrase({ ...emptyFilter(), minDays: 10 }, { catLabel: label }),
  'storm lasting 10 days or more');
eq('and thresholds join with "and"',
  filterPhrase({ ...emptyFilter(), minDays: 10, maxPressureMb: 950 }, { catLabel: label }),
  'storm lasting 10 days or more and below 950 mb');
eq('a half-day threshold keeps its decimal',
  filterPhrase({ ...emptyFilter(), minDays: 10.5 }, { catLabel: label }),
  'storm lasting 10.5 days or more');

/* ---------------------------------------------------------------------------
 * 8. THE FIGURE COLUMN
 *
 * MUTATION RUN: `sortFigure` returning a figure for `year` and `count`. The
 * extra column appears on the ordinary wall, permanently narrowing the strip
 * for a number already drawn twice. Red.
 * ------------------------------------------------------------------------- */
section('8. Sorting by a number puts it on screen, and only then');

ok('year draws no extra column', sortFigure(mk(2005, 9), 'year', { catLabel: label }) === null);
ok('count draws no extra column', sortFigure(mk(2005, 9), 'count', { catLabel: label }) === null);
eq('ACE draws its own figure',
  sortFigure(mk(2005, 18.75), 'ace', { catLabel: label }).value, '18.8');
eq('==> AND UNMEASURED ACE IS A DASH, NEVER A NOUGHT <==',
  sortFigure(mk(2005, null, false), 'ace', { catLabel: label }).value, '—');
eq('landfalls draws its count',
  sortFigure({ ...mk(2005, 1), landfalls: 7 }, 'landfalls', { catLabel: label }).value, '7');
eq('strongest draws the category',
  sortFigure({ ...mk(2005, 1), strongest: CAT5 }, 'strongest', { catLabel: label }).value,
  'Category 5');
eq('and a season with nothing graded says so rather than showing a category',
  sortFigure({ ...mk(2005, 1), strongest: -1 }, 'strongest', { catLabel: label }).value, '—');

/* ---------------------------------------------------------------------------
 * 9. THE NUMBER THAT DECIDES WHETHER THE TAIL COLLAPSES
 * ------------------------------------------------------------------------- */
section('9. A tight filter empties most of the wall, and that is the normal case');

eq('filtering the Atlantic to Category 5 empties 142 of 175 rows',
  [cat5Rows.filter((r) => r.shown.length === 0).length, cat5Rows.length], [142, 175]);

/* ==> AND EVERY SEASON IN THE RECORD HOLDS STORMS. <== Measured 2026-08-26.
 * This is why the hairline row and the tally's "with none" half had never once
 * rendered before step 3 — a filter is the only thing that can produce an
 * empty row, and that makes "no storms recorded" the WRONG sentence for one. */
for (const b of Object.keys(wall.basins)) {
  const rows = rowsFor(wall, b);
  ok(`every ${b} season on record holds at least one storm`,
    rows.every((r) => r.shown.length > 0));
}

console.log(`\ntest-wall-filter: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
