/**
 * test-season-names.mjs — the ghost roster. §57.18, §57.18a, §57.30 step 5b.
 *
 * ==> THE POINT OF THIS SUITE IS THAT A WRONG NAME CANNOT REACH A SCREEN. <==
 * The rosters used to be typed by hand and this file existed to catch a typo.
 * They are generated now (`tools/seasons-names.mjs`, from NHC's own names
 * page), which changes what can go wrong but not the question: the check is
 * still against something we FETCH — the real ATCF b-decks on the
 * `seasons-live` branch, which carry the name NOAA actually assigned to each
 * storm, in the order it assigned them.
 *
 * ==> AND THAT CHECK ONLY COVERS THE NAMES ALREADY SPENT. <== Nothing on Earth
 * can verify an UNUSED name until a storm takes it — that is what makes it a
 * ghost. This suite proves the head of each list and the SHAPE of the rest
 * (count, ordering, no duplicates, no lowercase). The parser that produced the
 * tail has its own suite, `tools/test-seasons-names-parse.mjs`, which runs
 * against the exact archived bytes of the page.
 *
 * ==> THE SECOND JOB OF THIS FILE IS THE CURRENT-SEASON GATE, AND IT IS NEW.
 * <== `lib/season-names-data.js` now holds six years ahead and accumulates
 * past ones. Aaron's rule has not changed: ghosts are the season in progress
 * only. So the rule can no longer be enforced by the data being thin, and
 * section 5 below is the thing enforcing it instead.
 *
 * The mirrored samples live in `samples/seasons-live/`, cut from the branch so
 * this suite runs with no network — the sandbox cannot reach NOAA and a test
 * that needs the internet is a test that does not run.
 *
 * Zero dependencies, plain node.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const { namesFor, hasRoster, rosterFor, __internals } =
  await import('../lib/season-names.js');
const { parseBdeck } = await import('../lib/hurdat.js');

/** The season in progress, PINNED. Never `new Date()` — a suite whose result
 *  changes on New Year's Eve is a suite nobody can trust in January. */
const NOW = 2026;

let pass = 0;
const fails = [];

function eq(what, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return; }
  fails.push(`${what}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`);
}

function ok(what, cond) {
  if (cond) { pass++; return; }
  fails.push(what);
}

/* ---------------------------------------------------------------------------
 * 1. SHAPE — what NHC publishes, held against what this repo carries.
 * ------------------------------------------------------------------------ */

const ATL = namesFor('atlantic', NOW);
const EPAC = namesFor('epacific', NOW);

ok('the Atlantic 2026 roster exists', Array.isArray(ATL));
ok('the East Pacific 2026 roster exists', Array.isArray(EPAC));

/* NHC publishes 21 for the Atlantic — Q, U, X, Y and Z are unused — and 24 for
 * the East Pacific, which does use X, Y and Z. A list that has quietly gained
 * or lost an entry is the single most likely way the generator goes wrong. */
eq('the Atlantic list is 21 names', ATL.length, 21);
eq('the East Pacific list is 24 names', EPAC.length, 24);

for (const [label, list] of [['Atlantic', ATL], ['East Pacific', EPAC]]) {
  ok(`${label}: every name is upper case`, list.every((n) => n === n.toUpperCase()));
  ok(`${label}: no duplicates`, new Set(list).size === list.length);
  ok(`${label}: no blanks or stray whitespace`,
    list.every((n) => n.length > 0 && n === n.trim()));
  /* Alphabetical by first letter, which is how the naming system works and
   * therefore how "how far down the list did the season get" is legible at
   * all. A list out of order would put ghosts in the wrong place. */
  const letters = list.map((n) => n[0]);
  eq(`${label}: initials are in alphabetical order`, letters, [...letters].sort());
  ok(`${label}: one name per letter`, new Set(letters).size === letters.length);
}

eq('the Atlantic skips Q, U, X, Y and Z',
  ['Q', 'U', 'X', 'Y', 'Z'].filter((c) => ATL.some((n) => n[0] === c)), []);

/* ---------------------------------------------------------------------------
 * 2. WHAT THE TABLE HOLDS, AND WHAT IT MUST NEVER HOLD.
 *
 * ==> THE GENERATOR MUST NEVER LOSE A YEAR. <== NOAA's window rolls forward
 * every year, so a job that replaced the table instead of merging into it
 * would quietly drop the season that just ended — the one season whose ghosts
 * were still on screen last week.
 * ------------------------------------------------------------------------ */

for (const basin of ['atlantic', 'epacific']) {
  const years = Object.keys(__internals.ROSTERS[basin] || {}).map(Number).sort((a, b) => a - b);
  ok(`${basin} carries at least the six years NOAA publishes`, years.length >= 6);
  ok(`${basin} carries the season in progress`, years.includes(NOW));
  for (let i = 1; i < years.length; i++) {
    ok(`${basin}: ${years[i - 1]} and ${years[i]} are consecutive`, years[i] === years[i - 1] + 1);
  }
}

/* §57.12, and it is measured rather than recalled: the Central Pacific ran
 * HONE in 2024, IONA and KELI in 2025, LALA and MOKE in 2026 — one continuous
 * list across three seasons. "The 2026 Central Pacific names" has no answer,
 * so a roster there would be inventing a structure the basin does not have. */
eq('only the two basins with an annual list are in the table',
  Object.keys(__internals.ROSTERS).sort(), ['atlantic', 'epacific']);
eq('the Central Pacific has no annual roster', namesFor('cpacific', NOW), null);
eq('an unknown basin answers null', namesFor('westpacific', NOW), null);
eq('a year before the record answers null', namesFor('atlantic', 1851), null);

/* ---------------------------------------------------------------------------
 * 3. GHOSTS — membership, not an index.
 * ------------------------------------------------------------------------ */

{
  const r = rosterFor('atlantic', NOW, ['ARTHUR', 'BERTHA', 'CRISTOBAL'], NOW);
  eq('three used leaves eighteen ghosts', r.ghosts.length, 18);
  eq('the first ghost is the next name up', r.ghosts[0], 'DOLLY');
  eq('the last ghost is the last name on the list',
    r.ghosts[r.ghosts.length - 1], 'WILFRED');
  eq('used comes back in roster order', r.used, ['ARTHUR', 'BERTHA', 'CRISTOBAL']);
  eq('nothing is off-list', r.offList, []);
  ok('the season has not run out of names', r.reachedEnd === false);
}

{
  /* ==> A SKIPPED NAME STAYS A GHOST. <== Counting forward from the last name
   * used would quietly delete it, and this is the assertion that stops anybody
   * "simplifying" membership into an index. */
  const r = rosterFor('atlantic', NOW, ['ARTHUR', 'CRISTOBAL'], NOW);
  ok('a name skipped in the middle is still a ghost', r.ghosts.includes('BERTHA'));
  eq('and the count reflects it', r.ghosts.length, 19);
}

{
  const r = rosterFor('atlantic', NOW, ATL, NOW);
  eq('a season that spends every name has no ghosts', r.ghosts, []);
  ok('and it says so', r.reachedEnd === true);
}

{
  /* The supplemental list, which replaced the Greek alphabet in 2021 — or a
   * generated list that is wrong. Both need saying; neither may be swallowed
   * (§5). */
  const r = rosterFor('atlantic', NOW, [...ATL, 'ADRIA'], NOW);
  eq('a name past the end of the list is reported', r.offList, ['ADRIA']);
  ok('and it is not counted as a ghost', !r.ghosts.includes('ADRIA'));
}

{
  const r = rosterFor('atlantic', NOW, ['arthur', ' Bertha ', 'ARTHUR'], NOW);
  eq('case and padding do not matter', r.used, ['ARTHUR', 'BERTHA']);
  eq('and a repeat is counted once', r.ghosts.length, 19);
}

eq('no storms yet means every name is a ghost',
  rosterFor('atlantic', NOW, [], NOW).ghosts.length, 21);

/* ---------------------------------------------------------------------------
 * 4. THE REAL BYTES — every name this season has actually spent.
 *
 * ==> THIS IS THE ONLY ASSERTION HERE THAT COULD CATCH A WRONG NAME. <==
 * Everything above proves the list is well formed; a well-formed list of wrong
 * names passes all of it. These are NOAA's own b-decks.
 * ------------------------------------------------------------------------ */

const MIRROR = join(ROOT, 'samples', 'seasons-live');

if (!existsSync(MIRROR)) {
  fails.push(
    `samples/seasons-live/ is missing — the roster has NOT been checked against real bytes.\n` +
    `     Cut it from the branch:  git show origin/seasons-live:btk/2026/bal012026.dat`
  );
} else {
  /* Storm number -> the name NOAA assigned, read out of the b-deck rather than
   * out of the filename. `parseBdeck` is the parser the app ships. */
  function nameOf(file) {
    const text = readFileSync(join(MIRROR, file), 'utf8');
    const { storm } = parseBdeck(text, { id: file.replace(/^b|\.dat$/g, '').toUpperCase() });
    return storm?.name || null;
  }

  const CASES = [
    ['atlantic', ['bal012026.dat', 'bal022026.dat', 'bal032026.dat']],
    ['epacific', [
      'bep012026.dat', 'bep022026.dat', 'bep032026.dat', 'bep042026.dat',
      'bep052026.dat', 'bep062026.dat', 'bep072026.dat', 'bep082026.dat',
      'bep092026.dat',
    ]],
  ];

  for (const [basin, files] of CASES) {
    const roster = namesFor(basin, NOW);
    const used = files.map(nameOf);

    ok(`${basin}: every mirrored storm has a name`, used.every(Boolean));

    /* ==> POSITION BY POSITION, NOT MEMBERSHIP. <== NOAA hands names out in
     * order, so storm N carries roster entry N. Checking only that the name is
     * SOMEWHERE on the list would pass a roster with two entries swapped, and a
     * swapped pair is exactly what a misread column looks like. */
    used.forEach((name, i) => {
      eq(`${basin}: storm ${i + 1} is roster position ${i + 1}`, name, roster[i]);
    });

    /* And the ghosts that fall out of it are the rest of the list, in order. */
    const r = rosterFor(basin, NOW, used, NOW);
    eq(`${basin}: ghosts are exactly the unspent tail`,
      r.ghosts, roster.slice(used.length));
    eq(`${basin}: nothing the season used is off-list`, r.offList, []);
  }
}

/* ---------------------------------------------------------------------------
 * 5. THE CURRENT-SEASON GATE. AARON'S RULE, AND THE DATA NO LONGER ENFORCES IT.
 *
 * ==> THIS IS THE ASSERTION THAT MATTERS MOST IN TWELVE MONTHS. <== The table
 * holds 2027 through 2031 today and will hold 2026 forever. A view that asks
 * for a settled or a future season must get nothing — not a plausible list of
 * names that were never issued to the storms it is looking at.
 * ------------------------------------------------------------------------ */

ok('the table really does hold the years being refused below',
  Array.isArray(namesFor('atlantic', 2027)) && Array.isArray(namesFor('atlantic', 2031)));

eq('next season is refused even though we hold it',
  rosterFor('atlantic', 2027, ['ANA'], NOW), null);
eq('the season just ended is refused once the year turns',
  rosterFor('atlantic', 2026, ['ARTHUR'], 2027), null);
eq('a settled season is refused', rosterFor('atlantic', 2005, [], NOW), null);
eq('a year we do not hold is refused', rosterFor('atlantic', 1851, [], 1851), null);

/* ==> FAIL CLOSED. <== A caller that forgets to say what year it is loses its
 * ghost rows. The alternative — defaulting to something — is how last season's
 * names end up beside this season's storms. */
eq('no current year given means no roster', rosterFor('atlantic', NOW, ['ARTHUR']), null);
eq('and a nonsense current year is not a wildcard',
  rosterFor('atlantic', NOW, ['ARTHUR'], NaN), null);

ok('hasRoster carries the same gate',
  hasRoster('atlantic', NOW, NOW) === true
  && hasRoster('atlantic', 2027, NOW) === false
  && hasRoster('atlantic', NOW, 2027) === false
  && hasRoster('westpacific', NOW, NOW) === false);

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} assertions pass — the roster matches NOAA's own b-decks`);
