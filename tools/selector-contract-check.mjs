/**
 * selector-contract-check.mjs — a selector a check queries is a contract with
 * the markup, exactly as a stylesheet rule is.
 *
 *   node tools/selector-contract-check.mjs
 *
 * ==> WHY THIS EXISTS. <== On 2026-08-14 the home setup screen's three controls
 * were rebuilt (e8a81fb) and `.home-drop` stopped existing.
 * `tools/headless-check.mjs` was still querying it, so it crashed on a null in
 * CI minutes after the push (fixed in bae54d1).
 *
 * THAT FAILURE IS THE BAD KIND AND IT IS WHY THIS IS A GATE. A check that
 * queries a dead selector does not report that the app is broken. It falls over
 * on its own null, in a job named after the app, and it reads IDENTICALLY
 * whether the app regressed or was merely rearranged — so the first move is
 * always to go looking for a bug that is not there. §5's rule about silence,
 * applied to the test suite.
 *
 * The sweep that followed found four more live ones and two false alarms, and
 * the two false alarms are why this file is shaped the way it is rather than
 * being three lines inside css-orphan-check.
 *
 * ==> WHY NOT A THIRD DIRECTION IN css-orphan-check.mjs. <== That file is built
 * on one premise stated in its own comments: `tools/` is NOT the app, so it
 * never counts as an emitter. That premise is right for the style question and
 * it is the opposite of what is needed here. Bolting this on would leave one
 * file treating `tools/` two contradictory ways depending on which loop you are
 * reading. They are also different questions for different readers: that one
 * asks whether the APP looks right, this one asks whether the SUITE still tests
 * anything. The shared reading is in `markup-scan.mjs` so neither can drift.
 *
 * ==> THREE WAYS A SELECTOR IS LEGITIMATE, AND ALL THREE ARE REAL. <==
 *
 *   1. THE APP EMITS IT.        The ordinary case.
 *   2. THE CHECK EMITS IT.      `area-shot.mjs` builds its own preview page and
 *                               styles `.frame` twenty lines above where it
 *                               queries it; `home-figs-check.mjs` builds its
 *                               whole fixture out of `.home-figs-*`. Those
 *                               files are talking to themselves. A gate that
 *                               did not know this would fail every fixture in
 *                               the directory and be deleted within a week.
 *   3. IT IS ASSERTED ABSENT.   `headless-check.mjs` proves the model group
 *                               headings and the scope filter STAY removed.
 *                               Matching nothing is the pass condition. See
 *                               PROVEN_ABSENT.
 *
 * ==> AND ONE WAY THE ABSENT LIST GOES WRONG, WHICH IS CHECKED. <== If a name
 * in PROVEN_ABSENT turns up in the app again, the entry has become a lie and
 * the removal it was guarding has been undone. That is reported as a failure —
 * and it catches the regression even if the feature comes back in a file the
 * original check never visits, which the original assertion cannot do.
 *
 * A KNOWN HOLE, STATED RATHER THAN PRETENDED AWAY. PROVEN_ABSENT is an escape
 * hatch and a future session that wants green can bury a real phantom in it.
 * The only defence is that an entry takes a written reason naming the check and
 * what it guards, and that reason is read by whoever adds the next one. Same
 * bargain as HOOKS in css-orphan-check.
 *
 * NOT COVERED: `[data-*]` attribute selectors, which are the third contract
 * shape in this codebase (`[data-toggle="cities"]`, `[data-storm-id]`). Nobody
 * has measured how noisy that direction would be, so it is not claimed here.
 */

import {
  walk,
  readFile,
  emittedClasses,
  emittedIds,
  selfDefinedNames,
  selectorLiterals,
  idSelectorLiterals,
  namesIn,
  isInterpolated,
  codeOnly,
} from './markup-scan.mjs';

/* ==> SELECTORS A CHECK IS SUPPOSED TO FIND NOTHING WITH. <== Each entry is a
 * removal being held down: the assertion passes BECAUSE the name is gone, so
 * this gate must not call it a phantom. An entry takes the check that owns it
 * and the removal it guards, because the next reader's real question is "is
 * this still true", and only the reason answers it. */
const PROVEN_ABSENT = new Map([
  [
    'model-group-head',
    'headless-check.mjs asserts the model group headings STAY gone (removed in 538f6a3) — ' +
      'a match is the failure, so no match is the point',
  ],
  [
    'scope-filter',
    'headless-check.mjs asserts the storm-list scope filter STAYS out of the DOM ' +
      '(removed in 538f6a3) — a match is the failure',
  ],
  [
    'seasons-lf',
    'test-seasons-board.mjs section 13 asserts the roster\'s old landfall GLYPH stays gone '
      + '(§57.53 moved the mark onto the swatch as a ::after) — a match is the failure, '
      + 'because a surviving span would draw the triangle twice',
  ],
]);

const files = walk('.');

/* What the shipped app puts on screen. Classes and ids both: a dead id
 * selector is the same silence as a dead class one, and it has already cost
 * this project a feature — `map/chrome-avoid.js` went on naming `#panel-storms`
 * and `#panel-home` after both panels became one `#drawer`, so the home marker
 * could not see the sheet at all and nothing raised a word about it. */
const appClasses = emittedClasses(files);
const appIds = emittedIds(files);
const appHas = (name) =>
  name.startsWith('#') ? appIds.has(name.slice(1)) : appClasses.has(name);

const problems = [];
const notes = [];

/* ------------------------------------------------------ the checks in tools/ */
let scanned = 0;
let skipped = 0;

for (const f of files) {
  if (!f.startsWith('tools/') || !/\.mjs$/.test(f)) continue;
  if (f === 'tools/selector-contract-check.mjs' || f === 'tools/markup-scan.mjs') continue;
  const raw = readFile(f);
  const own = selfDefinedNames(raw);

  /* Classes AND ids at a query call, then ids again anywhere in the file —
   * see the note in markup-scan.mjs for why those two scopes differ. A literal
   * caught by both is deduped by `seen`. */
  const seen = new Set();
  const consider = (selector, line, how) => {
    if (isInterpolated(selector)) {
      skipped++;
      return;
    }
    for (const name of namesIn(selector)) {
      if (appHas(name)) continue;
      if (own.has(name)) continue;
      if (PROVEN_ABSENT.has(name.replace(/^#/, ''))) continue;
      const key = name + '@' + line;
      if (seen.has(key)) continue;
      seen.add(key);
      problems.push(
        `  FAIL  [phantom] ${f}:${line} ${how} \`${selector}\` — ` +
          `nothing in the app emits ${name}`
      );
    }
  };

  for (const { selector, line } of selectorLiterals(raw)) {
    scanned++;
    consider(selector, line, 'queries');
  }
  for (const { selector, line } of idSelectorLiterals(raw)) {
    scanned++;
    consider(selector, line, 'names');
  }
}

/* ------------------------------- and the same question asked of the app code */
/* css-orphan-check already covers the CLASS half of this for app code. Ids were
 * the uncovered half, and the one that actually shipped a bug. */
for (const f of files) {
  if (!/\.(js|html)$/.test(f)) continue;
  if (f.startsWith('tools/') || f.startsWith('functions/')) continue;
  const raw = readFile(f);
  const own = selfDefinedNames(raw);
  const code = codeOnly(raw);
  const seen = new Set();
  const flag = (id, line, how) => {
    if (appIds.has(id) || own.has('#' + id) || seen.has(id)) return;
    seen.add(id);
    problems.push(
      `  FAIL  [phantom] ${f}:${line} ${how} #${id} and nothing in the app sets that id`
    );
  };
  for (const { selector, line } of idSelectorLiterals(raw)) {
    if (isInterpolated(selector)) continue;
    for (const n of namesIn(selector)) if (n.startsWith('#')) flag(n.slice(1), line, 'names');
  }
  for (const m of code.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g))
    flag(m[1], code.slice(0, m.index).split('\n').length, 'asks getElementById for');
}

/* ------------------------------------- an absent name that has come back home */
for (const [name, reason] of PROVEN_ABSENT) {
  if (appClasses.has(name)) {
    problems.push(
      `  FAIL  [returned] .${name} is listed as proven-absent but the app emits it again ` +
        `(${[...appClasses.get(name)].join(', ')}) — the removal it guarded has been undone, ` +
        `or the entry is stale. Reason on file: ${reason}`
    );
  }
}

/* --------------------------------------------------------------------- report */
for (const p of problems) console.log(p);
for (const n of notes) console.log(n);

if (problems.length) {
  console.log(
    `\n${problems.length} broken selector contract${problems.length === 1 ? '' : 's'}.\n` +
      `A check that queries a name nothing emits does not report the app is broken — it\n` +
      `falls over on its own null, and that reads the same whether the app regressed or\n` +
      `was merely rearranged. Point it at the name the markup uses now. If the check is\n` +
      `PROVING the name is gone, add it to PROVEN_ABSENT with a reason.`
  );
  process.exit(1);
}

console.log(
  `\n  ok    every selector still names something — ` +
    `${scanned} selector${scanned === 1 ? '' : 's'} in tools/ checked, ` +
    `${skipped} built at runtime and skipped, ` +
    `${appClasses.size} classes and ${appIds.size} ids emitted by the app, ` +
    `${PROVEN_ABSENT.size} asserted absent`
);
