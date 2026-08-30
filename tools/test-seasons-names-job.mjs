/**
 * test-seasons-names-job.mjs — the job that commits to `main` unattended.
 * §57.18a, §57.30 step 5b.
 *
 * ==> `tools/seasons-names.mjs` IS THE ONLY THING IN THIS REPO THAT CAN CHANGE
 * WHAT NAMES A READER SEES WITHOUT A HUMAN LOOKING. <== It runs monthly, it
 * writes `lib/season-names-data.js`, and it pushes to main. Its parser has its
 * own suite; this one is about everything AROUND the parser — the refusals,
 * the merge, and the decision to commit — because those are the parts that,
 * if wrong, are wrong silently and forever.
 *
 * ==> IT RUNS THE REAL SCRIPT, IN A REAL DIRECTORY, WITH NO NETWORK. <== The
 * job takes `SEASONS_NAMES_HTML` and reads a local file instead of fetching,
 * which is what makes an end-to-end test possible inside the wall at all. Each
 * case builds a throwaway repo root out of the real `lib/` and the real
 * mirrored b-decks, so nothing here is a stub.
 *
 * Zero dependencies, plain node. Takes a few seconds — it spawns node once per
 * case on purpose, because a job that only works when imported is not the job.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const JOB = join(HERE, 'seasons-names.mjs');
const PAGE = join(ROOT, 'samples', 'nhc-names', 'aboutnames-2026-08-24.shtml');
const HTML = readFileSync(PAGE, 'utf8');

let pass = 0;
const fails = [];
const ok = (what, cond) => { if (cond) pass++; else fails.push(what); };
const eq = (what, got, want) => ok(
  `${what}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`,
  JSON.stringify(got) === JSON.stringify(want));

const scratch = [];

/** A throwaway repo root carrying only what the job touches. */
function makeRoot(html, existingData = null, existingCp = null) {
  const dir = mkdtempSync(join(tmpdir(), 'names-job-'));
  scratch.push(dir);
  mkdirSync(join(dir, 'lib'), { recursive: true });
  cpSync(join(ROOT, 'lib'), join(dir, 'lib'), { recursive: true });
  /* `lib/hurdat.js` imports the constants block, so the throwaway root needs
   * it too. Copied rather than stubbed — a stub would let the job pass here
   * and fail on the runner. */
  cpSync(join(ROOT, 'config'), join(dir, 'config'), { recursive: true });
  rmSync(join(dir, 'lib', 'season-names-data.js'), { force: true });
  if (existingData) writeFileSync(join(dir, 'lib', 'season-names-data.js'), existingData, 'utf8');
  /* ==> THE JOB WRITES TWO FILES NOW AND THE "NO NEWS" CASE NEEDS BOTH. <==
   * Seeding only the rosters left the Central Pacific file missing, so the
   * second run legitimately had something to write and asked to commit —
   * which read as the no-news rule having rotted when it had not. */
  mkdirSync(join(dir, 'tools'), { recursive: true });
  if (existingCp) writeFileSync(join(dir, 'tools', 'cpacific-lists.mjs'), existingCp, 'utf8');
  cpSync(join(ROOT, 'samples', 'seasons-live'), join(dir, 'samples', 'seasons-live'),
    { recursive: true });
  writeFileSync(join(dir, 'page.shtml'), html, 'utf8');
  return dir;
}

/** Run the real job against that root. Never throws — the exit code is data. */
function run(dir) {
  const report = join(dir, 'report');
  let code = 0;
  try {
    execFileSync(process.execPath, [JOB, dir, report], {
      env: { ...process.env, SEASONS_NAMES_HTML: join(dir, 'page.shtml') },
      stdio: 'pipe',
    });
  } catch (err) {
    code = err.status ?? 1;
  }
  const read = (f) => (existsSync(join(report, f)) ? readFileSync(join(report, f), 'utf8') : '');
  return {
    code,
    decision: read('decision.txt').trim(),
    summary: read('summary.md'),
    data: existsSync(join(dir, 'lib', 'season-names-data.js'))
      ? readFileSync(join(dir, 'lib', 'season-names-data.js'), 'utf8')
      : null,
    cp: existsSync(join(dir, 'tools', 'cpacific-lists.mjs'))
      ? readFileSync(join(dir, 'tools', 'cpacific-lists.mjs'), 'utf8')
      : null,
  };
}

/* ---------------------------------------------------------------------------
 * 1. THE GOOD PAGE WRITES A FILE.
 * ------------------------------------------------------------------------ */

const first = makeRoot(HTML);
const r1 = run(first);

eq('a good page exits clean', r1.code, 0);
eq('and asks to commit', r1.decision, 'commit');
ok('and writes the data file', typeof r1.data === 'string');
ok('with twelve lists in it',
  ((r1.data || '').match(/^\s+20\d\d: \[/gm) || []).length === 12);
ok('and it is marked generated',
  (r1.data || '').includes('GENERATED. DO NOT EDIT BY HAND'));
ok('the mirror check ran and matched',
  r1.summary.includes('spent names match the page position for position'));

/* ==> THE CENTRAL PACIFIC LISTS COME OFF THE SAME PAGE AND LAND IN tools/.
 * <== §12: nothing the app draws reads them, so shipping them beside the
 * rosters would post 48 names to every phone to answer a question only a
 * runner asks. `tools/seasons-retired.mjs` is the only reader. */
ok('and writes the Central Pacific lists', typeof r1.cp === 'string');
{
  const mod = await import(join(first, 'tools', 'cpacific-lists.mjs'));
  eq('four lists', mod.CPACIFIC_LISTS.length, 4);
  eq('twelve names on each', mod.CPACIFIC_LISTS.map((l) => l.length), [12, 12, 12, 12]);
  eq('forty-eight names in service', mod.CPACIFIC_IN_SERVICE.length, 48);
  ok('and they are frozen', Object.isFrozen(mod.CPACIFIC_LISTS));
  ok('the asterisk marking this season\'s first name is stripped',
    mod.CPACIFIC_IN_SERVICE.includes('LALA') && !mod.CPACIFIC_IN_SERVICE.some((n) => n.includes('*')));
}

/* The generated file must be a module the app can actually import. */
{
  const mod = await import(join(first, 'lib', 'season-names-data.js'));
  eq('the generated module exports the table',
    Object.keys(mod.NAME_ROSTERS).sort(), ['atlantic', 'epacific']);
  eq('with the 2026 Atlantic list intact', mod.NAME_ROSTERS.atlantic[2026].length, 21);
  ok('and it is frozen', Object.isFrozen(mod.NAME_ROSTERS));
}

/* ---------------------------------------------------------------------------
 * 2. RUNNING AGAIN ON THE SAME PAGE MUST NOT COMMIT.
 *
 * ==> A MONTHLY COMMIT ON NO NEWS IS NOT HARMLESS. <== Every push to main
 * fires a Cloudflare Pages build against a cap of 500 a month and churns the
 * service worker for every reader. The generated header carries a timestamp,
 * so this only works if the comparison ignores it — which is exactly the kind
 * of thing that rots quietly.
 * ------------------------------------------------------------------------ */

const second = makeRoot(HTML, r1.data, r1.cp);
const r2 = run(second);
eq('the same page a month later exits clean', r2.code, 0);
eq('and does NOT ask to commit', r2.decision, 'skip');
ok('and says why', r2.summary.includes('already holds'));

/* ---------------------------------------------------------------------------
 * 3. THE MERGE NEVER LOSES A YEAR.
 *
 * NOAA's window rolls forward. Next February the page will lead with 2027 and
 * 2026 will be gone from it — but 2026 is the season whose ghosts were on
 * screen last week, and dropping it is a regression a reader would see.
 * ------------------------------------------------------------------------ */

{
  /* A page with an extra year already held: pretend the repo carries 2025. */
  const held = r1.data.replace(
    "  atlantic: {\n    2026: [",
    "  atlantic: {\n    2025: [\n      'ANDREA', 'BARRY', 'CHANTAL'\n    ],\n    2026: [");
  const dir = makeRoot(HTML, held);
  const r = run(dir);
  eq('a run over a table holding an older year exits clean', r.code, 0);
  ok('and the older year survives', r.data.includes("2025: ["));
  ok('and the year it just read is still there', r.data.includes("2026: ["));
}

/* ---------------------------------------------------------------------------
 * 4. THE REFUSALS. Nothing is written and the job goes red.
 * ------------------------------------------------------------------------ */

function refuses(what, html, expect) {
  const dir = makeRoot(html);
  const r = run(dir);
  ok(`${what}: exits non-zero`, r.code !== 0);
  ok(`${what}: writes no data file`, r.data === null);
  eq(`${what}: does not ask to commit`, r.decision, 'skip');
  if (expect) ok(`${what}: says why (${expect})`, r.summary.includes(expect));
}

refuses('a page that is not the page', '<html>404 not found</html>', 'too small to be it');

refuses('a page missing a name',
  HTML.replace('Bertha<br>\n', ''), 'REFUSED');

/* ==> THE GATE THE PARSER CANNOT PROVIDE. <== A well-formed list of the wrong
 * names passes every structural check there is. Swapping two names NOAA has
 * already spent this season is what a misread column looks like, and only the
 * b-decks can catch it. */
refuses('a page whose spent names disagree with NOAA\'s own b-decks',
  HTML.replace('Arthur<br>\nBertha<br>', 'Bertha<br>\nArthur<br>'),
  'storm 1 was named ARTHUR');

refuses('a page whose column points at a header that is not there',
  HTML.replace('<td headers="b1">', '<td headers="b9">'), 'does not exist');

/* ---------------------------------------------------------------------------
 * 5. A MISSING MIRROR IS A REFUSAL, NOT A SHRUG.
 *
 * If `samples/seasons-live/` ever goes away, the only check that can catch a
 * wrong name goes with it. Writing anyway would be the job quietly downgrading
 * itself to a scraper — which is the thing the whole design exists to avoid.
 * ------------------------------------------------------------------------ */

{
  const dir = makeRoot(HTML);
  rmSync(join(dir, 'samples', 'seasons-live'), { recursive: true, force: true });
  const r = run(dir);
  ok('no mirrored b-decks means no write', r.data === null);
  ok('and the job goes red', r.code !== 0);
  ok('and says so plainly', r.summary.includes('samples/seasons-live/ is missing'));
}

/* ------------------------------------------------------------------------ */

for (const d of scratch) rmSync(d, { recursive: true, force: true });

if (fails.length) {
  console.error(`\n✗ test-seasons-names-job: ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`✓ test-seasons-names-job: ${pass} assertions`);
