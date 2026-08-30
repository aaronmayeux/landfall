#!/usr/bin/env node
/**
 * test-retired-lookup.mjs — the join between a storm and the retired names.
 * SPEC-SEASONS-BUILD.md §57.52.
 *
 * ==> IT DRIVES THE REAL `seasons/wall.json` AND THE REAL HURDAT2 FILES, NOT A
 * FIXTURE. <== The whole value of this join is that it is right about 3,266
 * specific storms, and a fabricated pair cannot show a basin prefix that
 * disagrees with itself. The two faults this file exists to keep out were both
 * found by real bytes: the Pacific union, and INIKI filed under an `EP` id.
 *
 * Zero dependencies. Run: node tools/test-retired-lookup.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { retirementFor, retiredPredicateFor, __internals } from '../data/retired-lookup.js';
import {
  RETIRED_ATLANTIC, RETIRED_EPACIFIC, RETIRED_CPACIFIC,
  RETIRED_BY_DESCRIPTION, RETIRED_UNSURE,
} from '../data/retired-names.js';
import { NAME } from '../lib/wall-index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const fail = [];
const ok = (what, cond) => { if (cond) pass++; else fail.push(what); };
const eq = (what, got, want) => ok(`${what} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`,
  JSON.stringify(got) === JSON.stringify(want));

const wall = JSON.parse(readFileSync(join(ROOT, 'seasons/wall.json'), 'utf8'));

/* ---------------------------------------------------------------------------
 * 1. THE JOIN IS NAME PLUS YEAR
 * ------------------------------------------------------------------------- */

/* ==> THE ONE ASSERTION THIS WHOLE FILE IS FOR. <== Ida 2021 is retired and
 * Ida 2009 is not. A name-only join marks both, and it reads perfectly. */
ok('Ida 2021 is retired', retirementFor('IDA', 2021, 'AL')?.kind === 'name');
ok('Ida 2009 is NOT', retirementFor('IDA', 2009, 'AL') === null);
ok('Florence 1953 is NOT (its name went in 2018)', retirementFor('FLORENCE', 1953, 'AL') === null);
ok('Florence 2018 is', retirementFor('FLORENCE', 2018, 'AL')?.kind === 'name');

/* ==> AND THE TWO THAT RUN BACKWARDS. <== Carol 1965 and Edna 1968 carry names
 * withdrawn for the 1954 storms, so "it was retired LATER" is not a safe
 * reading of a name-only miss and no sentence may imply one. */
ok('Carol 1965 gets nothing', retirementFor('CAROL', 1965, 'AL') === null);
ok('Edna 1968 gets nothing', retirementFor('EDNA', 1968, 'AL') === null);

/* How wrong a name-only join would be, measured rather than asserted from
 * memory. If this number moves, the archive changed and the claim in §57.52
 * needs re-measuring with it. */
const byName = new Set(RETIRED_ATLANTIC.map(([n]) => n));
let nameOnlyHits = 0;
let pairHits = 0;
for (const [yk, list] of Object.entries(wall.basins.atlantic.years)) {
  const year = Number(yk);
  for (const s of list) {
    if (!s[NAME]) continue;
    if (byName.has(s[NAME])) nameOnlyHits++;
    if (retirementFor(s[NAME], year, 'AL')) pairHits++;
  }
}
eq('the Atlantic name+year join', pairHits, 100);
eq('a name-only join would mark this many', nameOnlyHits, 249);
ok('so a name-only chip is wrong about 149 Atlantic storms', nameOnlyHits - pairHits === 149);

/* ---------------------------------------------------------------------------
 * 2. THE PACIFIC IS ONE POOL, AND THE RECORD IS WHY
 * ------------------------------------------------------------------------- */

/* ==> THESE FOUR ARE THE REGRESSION. <== Three carry a `CP` id and one carries
 * an `EP` id, so neither prefix alone finds all four. INIKI under `EP` is the
 * case that broke the first build of this file. */
ok('IOKE 2006 under its own CP prefix', retirementFor('IOKE', 2006, 'CP')?.kind === 'name');
ok('INIKI 1992 under an EP prefix', retirementFor('INIKI', 1992, 'EP')?.kind === 'name');
ok('IWA 1982 under CP', retirementFor('IWA', 1982, 'CP')?.kind === 'name');
ok('PAKA 1997 under CP', retirementFor('PAKA', 1997, 'CP')?.kind === 'name');
/* And the same four resolve whichever Pacific prefix they are asked under, so
 * a future revision that re-files one of them cannot silently drop it. */
for (const [n, y] of [['IOKE', 2006], ['INIKI', 1992], ['IWA', 1982], ['PAKA', 1997]]) {
  ok(`${n} resolves under EP and under CP alike`,
    !!retirementFor(n, y, 'EP') && !!retirementFor(n, y, 'CP'));
}

/* ==> WHAT MAKES THE UNION SAFE, ASSERTED RATHER THAN ASSUMED. <== If a
 * `NAME|YEAR` ever appeared in both Pacific lists, one desk's retirement would
 * be claimable by the other and the union would stop being free. */
const epKeys = new Set(RETIRED_EPACIFIC.map(([n, y]) => `${n}|${y}`));
eq('no name+year is in both Pacific lists',
  RETIRED_CPACIFIC.filter(([n, y]) => epKeys.has(`${n}|${y}`)), []);

/* ==> THE OCEANS STAY APART. <== A name retired in one is routinely in service
 * in the other, and collapsing them is the failure the basin key exists to
 * prevent. */
ok('an Atlantic retirement is not a Pacific one', retirementFor('KATRINA', 2005, 'EP') === null);
ok('a Pacific retirement is not an Atlantic one', retirementFor('PATRICIA', 2015, 'AL') === null);
ok('an unknown basin answers null', retirementFor('KATRINA', 2005, 'ZZ') === null);
ok('no basin at all answers null', retirementFor('KATRINA', 2005, null) === null);

/* ---------------------------------------------------------------------------
 * 3. THE GREEK PAIR IS A DIFFERENT KIND OF FACT
 * ------------------------------------------------------------------------- */

eq('Eta is retired by DESCRIPTION', retirementFor('ETA', 2020, 'AL')?.kind, 'description');
eq('Iota is too', retirementFor('IOTA', 2020, 'AL')?.kind, 'description');
/* ==> AND THE OTHER SEVEN GREEK LETTERS OF 2020 ARE NOT RETIRED AT ALL. <==
 * §57.51. Without the exclusion each earns a confidently wrong sentence. */
for (const g of ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON', 'ZETA', 'THETA']) {
  ok(`${g} 2020 is not retired`, retirementFor(g, 2020, 'AL') === null);
}
/* 2005 spent six Greek names and retired none of them. */
for (const g of ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON', 'ZETA']) {
  ok(`${g} 2005 is not retired`, retirementFor(g, 2005, 'AL') === null);
}
/* ==> AND THEY MUST NOT LEAK INTO THE ORDINARY LIST. <== If a future
 * generator folds the pair into `RETIRED_ATLANTIC` to simplify itself, the
 * lookup still has to reach for the description branch first. */
ok('the pair is not in RETIRED_ATLANTIC',
  !RETIRED_ATLANTIC.some(([n, y]) => (n === 'ETA' || n === 'IOTA') && y === 2020));
eq('and both are in RETIRED_BY_DESCRIPTION', RETIRED_BY_DESCRIPTION.length, 2);

/* ---------------------------------------------------------------------------
 * 4. AN UNCERTAIN YEAR IS FLAGGED, NOT SWALLOWED
 * ------------------------------------------------------------------------- */

/* Carol and Edna were each retired, brought back, and retired again, and
 * NOAA's own table lists the later year. The name IS withdrawn; which storm
 * earned it is not settled — so the clause carrying the year drops. */
eq('Carol 1954 is retired but not dated to this storm',
  retirementFor('CAROL', 1954, 'AL'), { kind: 'name', datedToThisStorm: false });
eq('Edna 1954 the same',
  retirementFor('EDNA', 1954, 'AL'), { kind: 'name', datedToThisStorm: false });
eq('John 2024, single low-quality source',
  retirementFor('JOHN', 2024, 'EP'), { kind: 'name', datedToThisStorm: false });
eq('and Katrina IS dated to its storm',
  retirementFor('KATRINA', 2005, 'AL'), { kind: 'name', datedToThisStorm: true });
/* Every flagged key names a real entry, or the flag is dead code that would
 * never fire and nobody would notice. */
for (const k of Object.keys(RETIRED_UNSURE)) {
  const [n, y] = k.split('|');
  ok(`${k} is a real entry in some basin`,
    ['AL', 'EP', 'CP'].some((b) => retirementFor(n, Number(y), b) !== null));
}

/* ---------------------------------------------------------------------------
 * 5. NOTHING EVER ANSWERS "NOT RETIRED"
 * ------------------------------------------------------------------------- */

/* ==> §5, AND IT IS A SHAPE ASSERTION RATHER THAN A VALUE ONE. <== Below a
 * basin's floor the frozen historic block answers and nothing in the data
 * separates "no name from this year was withdrawn" from "this era was never
 * assessed". The lookup must therefore have no way to SAY the negative — a
 * caller can only get a fact or a null, and null is not a claim. */
const shapes = new Set();
for (const [basin, key] of [['atlantic', 'AL'], ['epacific', 'EP']]) {
  for (const [yk, list] of Object.entries(wall.basins[basin].years)) {
    for (const s of list) {
      const r = retirementFor(s[NAME], Number(yk), key);
      shapes.add(r === null ? 'null' : `${r.kind}:${typeof r.datedToThisStorm}`);
    }
  }
}
eq('every answer over the whole archive is null or a fact',
  [...shapes].sort(), ['description:boolean', 'name:boolean', 'null']);
ok('an unnamed storm answers null', retirementFor('', 2005, 'AL') === null);
ok('a null name answers null', retirementFor(null, 2005, 'AL') === null);
ok('a non-finite year answers null', retirementFor('KATRINA', NaN, 'AL') === null);

/* ---------------------------------------------------------------------------
 * 6. THE WALL PREDICATE
 * ------------------------------------------------------------------------- */

const atl = retiredPredicateFor('atlantic');
const pac = retiredPredicateFor('epacific');

ok('the wall predicate joins on name and year', atl('IDA', 2021) && !atl('IDA', 2009));
ok('and it counts the Greek pair', atl('ETA', 2020) && atl('IOTA', 2020));
ok('but not the other seven', !atl('ZETA', 2020) && !atl('THETA', 2020));
ok('the Pacific bucket reaches the central Pacific', pac('IOKE', 2006) && pac('INIKI', 1992));
ok('and does not reach the Atlantic', !pac('KATRINA', 2005));
ok('an unknown bucket matches nothing', retiredPredicateFor('nope')('KATRINA', 2005) === false);
ok('an unnamed storm matches nothing', !atl('', 2005) && !atl(null, 2005));

/* The totals the wall actually draws, measured off the shipped file. */
const counted = (basin, pred, key) => {
  let n = 0;
  for (const [yk, list] of Object.entries(wall.basins[basin].years)) {
    for (const s of list) if (pred(s[NAME], Number(yk))) n++;
  }
  return n;
};
const atlN = counted('atlantic', atl);
const pacN = counted('epacific', pac);
eq('Atlantic storms carrying a bar', atlN, 100);
eq('Pacific storms carrying a bar', pacN, 22);
eq('and 122 across the archive', atlN + pacN, 122);

/* ==> EVERY LIST ENTRY POINTS AT A REAL STORM. <== An entry that silently
 * matches nothing is indistinguishable from a typo, which is the reason
 * `RETIRED_NEVER_USED` exists as a separate export rather than as a row with a
 * year nobody can join. */
const orphans = [];
for (const [basin, list] of [['atlantic', RETIRED_ATLANTIC], ['epacific', RETIRED_EPACIFIC], ['epacific', RETIRED_CPACIFIC]]) {
  for (const [n, y] of list) {
    const row = wall.basins[basin].years[String(y)] || [];
    if (!row.some((s) => s[NAME] === n)) orphans.push(`${n} ${y}`);
  }
}
eq('no list entry is an orphan', orphans, []);

/* ---------------------------------------------------------------------------
 * 7. THE INDEX IS BUILT ONCE, NOT PER STORM
 * ------------------------------------------------------------------------- */

/* The predicate runs 2,004 times per repaint on the Atlantic. This asserts the
 * shape that keeps it free rather than the timing, which would be flaky. */
ok('the predicate closes over a prebuilt set',
  typeof atl === 'function' && atl.length === 2);
eq('the Pacific pool is EP and CP', __internals.BASIN_POOL.EP, ['EP', 'CP']);
/* ==> AND `CP` HAS TO BE THE SAME POOL, WHICH NO REAL STORM CAN DEMONSTRATE.
 * <== Every central Pacific retirement in the record today happens to be in
 * `RETIRED_CPACIFIC`, so narrowing the `CP` pool to `['CP']` changes no answer
 * about any storm that exists and a mutation of it survived every assertion in
 * this file. The direction it breaks is a CP-prefixed storm whose retirement
 * NHC filed under the east Pacific — the mirror of the INIKI fault, which did
 * happen. This is asserted on the shape because the data cannot yet be asked. */
eq('and CP is the same pool as EP', __internals.BASIN_POOL.CP, __internals.BASIN_POOL.EP);
eq('and the Atlantic pool is itself alone', __internals.BASIN_POOL.AL, ['AL']);
eq('the wall buckets agree with the pools',
  __internals.WALL_BASINS.epacific, __internals.BASIN_POOL.EP);

/* ---------------------------------------------------------------------------
 * 8. THE RECORD ITSELF, WHICH IS THE THING THAT MOVED UNDER US ONCE
 * ------------------------------------------------------------------------- */

/* ==> THE FOUR HAWAII STORMS ARE READ OUT OF THE REAL FILES. <== This is the
 * assertion that would have caught the INIKI fault before it was written: it
 * proves the prefixes genuinely disagree, so nobody "simplifies" the pool back
 * to one basin on the strength of the comment alone. */
const prefixes = {};
for (const f of readdirSync(join(ROOT, 'seasons/data'))) {
  if (!f.endsWith('.txt')) continue;
  const text = readFileSync(join(ROOT, 'seasons/data', f), 'utf8');
  for (const n of ['IWA', 'INIKI', 'IOKE', 'PAKA']) {
    const m = text.match(new RegExp(`^([A-Z]{2})\\d{6}, *${n},`, 'm'));
    if (m) prefixes[n] = m[1];
  }
}
eq('IWA is filed under CP', prefixes.IWA, 'CP');
eq('IOKE is filed under CP', prefixes.IOKE, 'CP');
eq('PAKA is filed under CP', prefixes.PAKA, 'CP');
eq('but INIKI is filed under EP, which is why the pool is a union', prefixes.INIKI, 'EP');

/* ------------------------------------------------------------------------- */

if (fail.length) {
  console.error(`✗ ${fail.length} failed of ${pass + fail.length}`);
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ retired-names lookup: ${pass} checks — 122 storms joined on name+year `
  + `across ${Object.keys(wall.basins).length} basins, the Pacific pool unioned, `
  + `the Greek pair kept apart, and no negative answer possible`);
