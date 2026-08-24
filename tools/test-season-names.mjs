/**
 * test-season-names.mjs — the ghost roster. §57.18, §57.30 step 5.
 *
 * ==> THE POINT OF THIS SUITE IS THAT A MISTYPED NAME CANNOT REACH A SCREEN.
 * <== `lib/season-names.js` is hand-typed from NHC's own PDFs, which makes it
 * the one file in this feature whose contents cannot be derived from anything
 * we fetch. So it is checked against something we DO fetch: the real ATCF
 * b-decks on the `seasons-live` branch, which carry the name NOAA actually
 * assigned to each storm, in the order it assigned them.
 *
 * ==> AND THAT CHECK ONLY COVERS THE NAMES ALREADY SPENT. <== Nothing on Earth
 * can verify an UNUSED name until a storm takes it — that is what makes it a
 * ghost. This suite therefore proves the head of each list and the SHAPE of
 * the rest (count, ordering, no duplicates, no lowercase), and the source of
 * truth for the tail is NHC's file and the provenance note in the module.
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

const ATL = namesFor('atlantic', 2026);
const EPAC = namesFor('epacific', 2026);

ok('the Atlantic 2026 roster exists', Array.isArray(ATL));
ok('the East Pacific 2026 roster exists', Array.isArray(EPAC));

/* NHC publishes 21 for the Atlantic — Q, U, X, Y and Z are unused — and 24 for
 * the East Pacific, which does use X, Y and Z. A list that has quietly gained
 * or lost an entry is the single most likely way this file goes wrong. */
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
  eq(`${label}: initials are in alphabetical order`,
    letters, [...letters].sort());
  ok(`${label}: one name per letter`, new Set(letters).size === letters.length);
}

eq('the Atlantic skips Q, U, X, Y and Z',
  ['Q', 'U', 'X', 'Y', 'Z'].filter((c) => ATL.some((n) => n[0] === c)), []);

/* ---------------------------------------------------------------------------
 * 2. UNKNOWN YEARS AND BASINS ANSWER NULL, NEVER LAST YEAR'S LIST.
 *
 * ==> THIS IS THE ASSERTION THAT MATTERS MOST IN TWELVE MONTHS. <== The lists
 * rotate every six years with retired names swapped out, so 2026's list is not
 * 2027's. When the season turns over and nobody has typed the new one, the
 * board must lose its ghosts rather than print names that were never issued.
 * ------------------------------------------------------------------------ */

eq('next season answers null until somebody adds it', namesFor('atlantic', 2027), null);
eq('a settled season answers null — ghosts are the current year only',
  namesFor('atlantic', 2005), null);
eq('a year before the record answers null', namesFor('atlantic', 1851), null);

/* §57.12, and it is measured rather than recalled: the Central Pacific ran
 * HONE in 2024, IONA and KELI in 2025, LALA and MOKE in 2026 — one continuous
 * list across three seasons. "The 2026 Central Pacific names" has no answer,
 * so a roster there would be inventing a structure the basin does not have. */
eq('the Central Pacific has no annual roster', namesFor('cpacific', 2026), null);
eq('an unknown basin answers null', namesFor('westpacific', 2026), null);
ok('hasRoster agrees with namesFor', hasRoster('atlantic', 2026) === true
  && hasRoster('atlantic', 2027) === false
  && hasRoster('westpacific', 2026) === false);

eq('a null roster produces no ghost object at all',
  rosterFor('atlantic', 2027, ['ARTHUR']), null);

/* ---------------------------------------------------------------------------
 * 3. GHOSTS — membership, not an index.
 * ------------------------------------------------------------------------ */

{
  const r = rosterFor('atlantic', 2026, ['ARTHUR', 'BERTHA', 'CRISTOBAL']);
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
  const r = rosterFor('atlantic', 2026, ['ARTHUR', 'CRISTOBAL']);
  ok('a name skipped in the middle is still a ghost', r.ghosts.includes('BERTHA'));
  eq('and the count reflects it', r.ghosts.length, 19);
}

{
  const r = rosterFor('atlantic', 2026, ATL);
  eq('a season that spends every name has no ghosts', r.ghosts, []);
  ok('and it says so', r.reachedEnd === true);
}

{
  /* The supplemental list, which replaced the Greek alphabet in 2021 — or a
   * typo in this repo. Both need saying; neither may be swallowed (§5). */
  const r = rosterFor('atlantic', 2026, [...ATL, 'ADRIA']);
  eq('a name past the end of the list is reported', r.offList, ['ADRIA']);
  ok('and it is not counted as a ghost', !r.ghosts.includes('ADRIA'));
}

{
  const r = rosterFor('atlantic', 2026, ['arthur', ' Bertha ', 'ARTHUR']);
  eq('case and padding do not matter', r.used, ['ARTHUR', 'BERTHA']);
  eq('and a repeat is counted once', r.ghosts.length, 19);
}

eq('no storms yet means every name is a ghost',
  rosterFor('atlantic', 2026, []).ghosts.length, 21);

/* ---------------------------------------------------------------------------
 * 4. THE REAL BYTES — every name this season has actually spent.
 *
 * ==> THIS IS THE ONLY ASSERTION HERE THAT COULD CATCH A TYPO. <== Everything
 * above proves the list is well formed; a well-formed list of wrong names
 * passes all of it. These are NOAA's own b-decks.
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
    const roster = namesFor(basin, 2026);
    const used = files.map(nameOf);

    ok(`${basin}: every mirrored storm has a name`, used.every(Boolean));

    /* ==> POSITION BY POSITION, NOT MEMBERSHIP. <== NOAA hands names out in
     * order, so storm N carries roster entry N. Checking only that the name is
     * SOMEWHERE on the list would pass a roster with two entries swapped, and a
     * swapped pair is exactly what a transcription error looks like. */
    used.forEach((name, i) => {
      eq(`${basin}: storm ${i + 1} is roster position ${i + 1}`, name, roster[i]);
    });

    /* And the ghosts that fall out of it are the rest of the list, in order. */
    const r = rosterFor(basin, 2026, used);
    eq(`${basin}: ghosts are exactly the unspent tail`,
      r.ghosts, roster.slice(used.length));
    eq(`${basin}: nothing the season used is off-list`, r.offList, []);
  }
}

/* ---------------------------------------------------------------------------
 * 5. THE FILE HOLDS THE CURRENT YEAR AND NOTHING ELSE.
 *
 * A guard against the obvious future mistake: adding 2027 beside 2026 and
 * leaving both, so a reader in 2027 sees last year's ghosts on this year's
 * board. Ghosts are the CURRENT season — one year per basin, no more.
 * ------------------------------------------------------------------------ */

for (const [basin, byYear] of Object.entries(__internals.ROSTERS)) {
  const years = Object.keys(byYear);
  eq(`${basin} carries exactly one season`, years.length, 1);
}

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} assertions pass — the roster matches NOAA's own b-decks`);
