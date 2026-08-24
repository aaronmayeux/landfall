/**
 * test-seasons-names-parse.mjs — the parser that keeps the rosters current.
 * §57.12, §57.18a, §57.30 step 5b.
 *
 * ==> IT RUNS AGAINST REAL ARCHIVED BYTES, NOT A HAND-WRITTEN SNIPPET. <==
 * `samples/nhc-names/aboutnames-2026-08-24.shtml` is the exact 31 KB an Actions
 * runner pulled from NHC. A fixture invented to match the parser proves only
 * that the parser matches itself; this one can disagree with it.
 *
 * ==> AND THE HALF THAT MATTERS IS THE REFUSALS. <== The parser's job is not
 * really to read a good page — it is to REFUSE a bad one, because a silently
 * misread page puts wrong names on a screen and nothing downstream can tell.
 * So most of what follows damages the real bytes in a specific way and checks
 * that the fault is named.
 *
 * Zero dependencies, plain node, no network.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const { parseNamesPage, ATLANTIC_LETTERS, EPACIFIC_LETTERS } =
  await import('./seasons-names-parse.mjs');

const HTML = readFileSync(
  join(ROOT, 'samples', 'nhc-names', 'aboutnames-2026-08-24.shtml'), 'utf8');

let pass = 0;
const fails = [];
const ok = (what, cond) => { if (cond) pass++; else fails.push(what); };
const eq = (what, got, want) => ok(
  `${what}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`,
  JSON.stringify(got) === JSON.stringify(want));

/** Every fault message joined, so a test can ask "was this complained about". */
const complained = (faults, about) => faults.some((f) => f.includes(about));

/* ---------------------------------------------------------------------------
 * 1. THE GOOD PAGE.
 * ------------------------------------------------------------------------ */

const good = parseNamesPage(HTML);

eq('the real page parses with no faults at all', good.faults, []);
eq('two basins and only two', Object.keys(good.rosters).sort(), ['atlantic', 'epacific']);

for (const basin of ['atlantic', 'epacific']) {
  eq(`${basin} carries the six years NOAA publishes`,
    Object.keys(good.rosters[basin]).map(Number).sort((a, b) => a - b),
    [2026, 2027, 2028, 2029, 2030, 2031]);
}

/* The one thing that can be checked against something other than this file:
 * the 2026 lists were transcribed by hand from NHC's PDFs before this parser
 * existed, and verified then against our own mirrored b-decks. If the parser
 * disagrees with that transcription, one of the two is wrong. */
eq('atlantic 2026 reads exactly as it was once typed by hand',
  good.rosters.atlantic[2026], [
    'ARTHUR', 'BERTHA', 'CRISTOBAL', 'DOLLY', 'EDOUARD', 'FAY', 'GONZALO',
    'HANNA', 'ISAIAS', 'JOSEPHINE', 'KYLE', 'LEAH', 'MARCO', 'NANA', 'OMAR',
    'PAULETTE', 'RENE', 'SALLY', 'TEDDY', 'VICKY', 'WILFRED']);
eq('epacific 2026 reads exactly as it was once typed by hand',
  good.rosters.epacific[2026], [
    'AMANDA', 'BORIS', 'CRISTINA', 'DOUGLAS', 'ELIDA', 'FAUSTO', 'GENEVIEVE',
    'HERNAN', 'ISELLE', 'JULIO', 'KARINA', 'LOWELL', 'MARIE', 'NORBERT',
    'ODALYS', 'POLO', 'RACHEL', 'SIMON', 'TRUDY', 'VANCE', 'WINNIE',
    'XAVIER', 'YOLANDA', 'ZEKE']);

for (const [basin, letters] of [['atlantic', ATLANTIC_LETTERS], ['epacific', EPACIFIC_LETTERS]]) {
  for (const [year, names] of Object.entries(good.rosters[basin])) {
    eq(`${basin} ${year} has ${letters.length} names`, names.length, letters.length);
    eq(`${basin} ${year} initials run ${letters}`, names.map((n) => n[0]).join(''), letters);
    ok(`${basin} ${year} is all upper case`, names.every((n) => n === n.toUpperCase()));
    ok(`${basin} ${year} has no repeats`, new Set(names).size === names.length);
  }
}

/* §57.12. The Central Pacific table is on the page and must never become a
 * roster — its four lists run across season boundaries. */
ok('the Central Pacific never becomes a basin here', !('cpacific' in good.rosters));
ok('nor does anything else', Object.keys(good.rosters).length === 2);

/* ---------------------------------------------------------------------------
 * 2. THE REFUSALS. Each one damages the real page in one specific way.
 *
 * ==> EVERY CASE BELOW WAS RUN AGAINST THE UNDAMAGED PAGE FIRST AND PRODUCED
 * NO FAULT. <== That is what makes them mutations rather than decoration: the
 * assertion fails if the guard is removed, and it also fails if the guard is
 * so broad it fires on a good page.
 * ------------------------------------------------------------------------ */

{
  /* A name deleted. This is the shape of NOAA quietly dropping a row, and it
   * is the one that would silently shorten a season's list. */
  const broken = HTML.replace('Bertha<br>\n', '');
  const r = parseNamesPage(broken);
  ok('a missing name is caught by the count', complained(r.faults, 'atlantic 2026: 20 names'));
  ok('and by the initials', complained(r.faults, 'initials read'));
}

{
  /* A column header that is no longer a year — what a restyle looks like. */
  const broken = HTML.replace('<th id="a1">2026</th>', '<th id="a1">Current</th>');
  const r = parseNamesPage(broken);
  ok('a header that is not a year is refused',
    complained(r.faults, 'is headed "Current"'));
  ok('and that column is not written under some other year',
    !(2026 in (r.rosters.atlantic || {})));
}

{
  /* ==> THE ONE THAT MATTERS MOST. <== A cell pointing at a header that is not
   * there. If the parser fell back to counting columns, this would silently
   * file the 2026 names under 2027 and every ghost row after would be wrong. */
  const broken = HTML.replace('<td headers="a1">', '<td headers="a9">');
  const r = parseNamesPage(broken);
  ok('a column pointing at a header that does not exist is refused',
    complained(r.faults, 'names a header that does not exist'));
  ok('and no list is filed under a guessed year',
    !(2026 in (r.rosters.atlantic || {})));
}

{
  /* A missing <br>, which runs two names together. Splitting on whitespace
   * instead would have hidden this completely. */
  const broken = HTML.replace('Arthur<br>\nBertha', 'Arthur\nBertha');
  const r = parseNamesPage(broken);
  ok('two names run together is refused', complained(r.faults, 'ARTHUR BERTHA'));
}

{
  /* The basin anchor gone. */
  const broken = HTML.replace('<a name="enp"></a>', '');
  const r = parseNamesPage(broken);
  ok('a missing basin section is named',
    complained(r.faults, 'epacific: no <a name="enp">'));
}

{
  /* Central Pacific removed — not used, but its absence means the page has
   * been restructured enough that nothing here should be trusted. */
  const broken = HTML.replace('<a name="cnp"></a>', '');
  const r = parseNamesPage(broken);
  ok('losing the Central Pacific section is reported',
    complained(r.faults, 'the page has been restructured'));
}

{
  /* A year skipped in the header row. NOAA publishes a consecutive window; a
   * gap means a header was misread, and a misread header is how a list lands
   * on the wrong season. */
  const broken = HTML.replace('<th id="a3">2028</th>', '<th id="a3">2030</th>');
  const r = parseNamesPage(broken);
  ok('a gap in the years is refused', complained(r.faults, 'years jump from 2027 to 2029'));
  ok('and the duplicate year is named', complained(r.faults, '2030 appears twice'));
}

{
  /* Something that is not a name at all. */
  const broken = HTML.replace('Dolly<br>', 'Dolly 2<br>');
  const r = parseNamesPage(broken);
  ok('a name with a digit in it is refused', complained(r.faults, '"DOLLY 2" is not a name'));
}

{
  const r = parseNamesPage('');
  ok('an empty page produces faults rather than empty rosters', r.faults.length >= 2);
  const html = parseNamesPage('<html><body>the site is down</body></html>');
  ok('an error page produces faults too', html.faults.length >= 2);
}

/* ---------------------------------------------------------------------------
 * Report.
 * ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n✗ test-seasons-names-parse: ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`✓ test-seasons-names-parse: ${pass} assertions`);
