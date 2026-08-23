#!/usr/bin/env node
/**
 * perf-select.mjs — WHAT TAPPING A STORM COSTS. SPEC-FLOOD-PLAN §56.16.
 *
 * ==> THIS APP HAD NO INTERACTION MEASUREMENT AT ALL, AND THAT IS WHY PHASE 5
 * SHIPPED SLOW. <== `perf-audit.mjs` measures BOOT — modules, waves, first
 * paint. Every gate in this repo tests CORRECTNESS. Nothing anywhere timed the
 * thing Aaron actually felt on 2026-08-23: tapping a storm on the globe and
 * stepping between storms in the drawers. A whole phase was built, pushed,
 * patched twice and reverted because the only numbers available described a
 * sandbox with no browser in it.
 *
 * ==> IT MEASURES THE WORST BLOCK, NOT THE AVERAGE. <== A selection that runs
 * at 60fps and drops one 250 ms frame reads as a stutter and averages to
 * something respectable. `worstTaskMs` is the single longest main-thread block
 * during one selection, and it is the number that corresponds to "it feels
 * sticky". `toDetailMs` — the wall clock to the panel appearing — is reported
 * for context and is deliberately NOT the headline: the panel can arrive
 * promptly while the thread stays jammed behind it, which is exactly the shape
 * of the Phase 5 regression.
 *
 * ==> IT DRIVES `?replay=ida`, SO IT DOES NOT DEPEND ON THE WEATHER. <== A gate
 * that only runs when a storm happens to be live is a gate that is off most of
 * the year. The replay reads `samples/ida-al092021/` off disk, so the storm,
 * its track and its geometry are identical on every run and two numbers taken a
 * month apart are comparable.
 *
 * ==> IT TAPS A ROW, RATHER THAN POKING A FUNCTION. <== The row in the storms
 * list is a real entrance to `runSelect` — the same one a finger uses — so what
 * is measured includes the drawer work, not just the map work. Calling a
 * selection function directly would measure the half that was never the
 * problem.
 *
 * ==> IT NEEDS A REAL BROWSER AND THE BASEMAP, SO IT RUNS ON CI AND NOWHERE
 * ELSE. <== ==> AND THE REASON IS THE TILE HOST, NOT THE BROWSER. <== This line
 * used to say the sandbox has no chromium. It has one — build 1194, at
 * `/opt/pw-browsers` — and `boot-smoke.mjs` runs in there and passes. What the
 * sandbox cannot reach is `tiles.openfreemap.org`, so `isStyleLoaded()` never
 * turns true and the hard failure below fires every time. **That is this file
 * working, not this file being broken: do not stub the basemap to get a number
 * out of it.** An invented environment produces a confident figure about
 * nothing, which is the mistake this file exists to prevent.
 *
 * Needs the static server in the SAME shell command:
 *   bash tools/with-server.sh node tools/perf-select.mjs
 *   bash tools/with-server.sh node tools/perf-select.mjs --check
 *
 * Without `--check` it measures and prints. With `--check` it also fails over
 * any budget in tools/perf-budgets.json that is not null.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

import { INSTRUMENT } from './perf-instrument.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_BASE = 'http://127.0.0.1:8099/';

/** Deterministic storm, off local samples. See the header. */
const URL = `${URL_BASE}?replay=ida`;

/** How many selections to time. The FIRST is thrown away — it pays for lazy
 *  module evaluation and a cold drawer mount that a reader pays once per
 *  session, not once per tap. What is reported is the steady state. */
const RUNS = 6;
const WARMUP = 1;

/** How long after the tap to keep counting long tasks. A selection kicks a
 *  fetch and a geometry push that can land well after the panel appears, and
 *  work that lands 900 ms later is still work the reader feels. */
const WINDOW_MS = 1500;

const CHECK = process.argv.includes('--check');

let failures = 0;
const ok = (label) => console.log(`  ✓ ${label}`);
const fail = (label, detail) => {
  failures++;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
};

const budgets = JSON.parse(readFileSync(path.join(ROOT, 'tools/perf-budgets.json'), 'utf8'));

/* ---------------------------------------------------------------------------
 * THE PAGE HALF
 *
 * Kept as strings with no closure over node, the same discipline
 * `perf-instrument.mjs` explains at length: a page function that references a
 * node variable is a mistake the linter cannot see.
 * ------------------------------------------------------------------------- */

/** Long tasks that started at or after `since`, summarised. */
const TASKS_SINCE = `(since) => {
  const t = (window.__audit && window.__audit.longTasks) || [];
  const mine = t.filter((e) => e.start >= since);
  return {
    blockedMs: Math.round(mine.reduce((a, e) => a + e.dur, 0)),
    worstTaskMs: Math.round(mine.reduce((a, e) => Math.max(a, e.dur), 0)),
    count: mine.length,
  };
}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
await page.addInitScript(INSTRUMENT);

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));

console.log('\nBoot');
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

/* ==> THE MAP HAS TO HAVE BUILT, OR NOTHING BELOW MEANS ANYTHING. <== This is
 * the trap `perf-audit.mjs` fell into: it printed "STYLE NEVER LOADED — the map
 * numbers below are meaningless" and then checked those same numbers against a
 * budget and passed them. A run that cannot see the map is a FAILED run, not a
 * fast one. */
const styleLoaded = await page
  .waitForFunction(
    () => !!(window.__landfall && window.__landfall.map && window.__landfall.map.isStyleLoaded()),
    null,
    { timeout: 45_000 }
  )
  .then(() => true)
  .catch(() => false);

if (!styleLoaded) {
  fail(
    'the map style loaded',
    'The map never built, so no number from this run describes the app.\n' +
      '      On CI that means the basemap host was unreachable or the style failed.\n' +
      '      This is a hard failure on purpose — a run that cannot see the map must\n' +
      '      never report a fast time.'
  );
  await browser.close();
  console.log(`\n✗ perf-select: ${failures} failure(s)\n`);
  process.exit(1);
}
ok('the map style loaded');

/* The replay's storm has to actually be in the list, or the tap below measures
 * nothing and would otherwise report an impressively small number. */
const rowsReady = await page
  .waitForSelector('.storm-row', { timeout: 45_000, state: 'attached' })
  .then(() => true)
  .catch(() => false);

if (!rowsReady) {
  fail(
    'the replay produced a storm to tap',
    '`?replay=ida` reads samples/ida-al092021/ off disk, so this failing means\n' +
      '      the replay itself is broken rather than the weather being quiet.'
  );
  await browser.close();
  console.log(`\n✗ perf-select: ${failures} failure(s)\n`);
  process.exit(1);
}
ok('the replay produced a storm to tap');

/* Let boot settle so the first timed run is not measuring the tail of it. */
await page.waitForTimeout(3000);

/* ---------------------------------------------------------------------------
 * THE MEASUREMENT
 * ------------------------------------------------------------------------- */

console.log('\nSelecting a storm');

const samples = [];

for (let i = 0; i < RUNS; i++) {
  /* Back to the list. `go` enters a view as a fresh root, which is the state a
   * reader is in when they tap a storm from the list — and it means run N+1
   * starts where run N started rather than from wherever the last one left the
   * drawer. */
  await page.evaluate(() => window.__landfall?.drawer?.go?.('storms'));
  await page.waitForTimeout(400);

  const t0 = await page.evaluate(() => performance.now());

  await page.click('.storm-row', { timeout: 10_000 });

  /* The panel being on screen. `data-view` is written by the drawer itself on
   * entry, so this reads the app's own statement rather than guessing from
   * markup. */
  const shown = await page
    .waitForFunction(
      () => document.getElementById('drawer')?.dataset?.view === 'detail',
      null,
      { timeout: 15_000 }
    )
    .then(() => true)
    .catch(() => false);

  const toDetailMs = shown ? Math.round(await page.evaluate((t) => performance.now() - t, t0)) : null;

  /* Keep counting after the panel appears — see WINDOW_MS. */
  await page.waitForTimeout(WINDOW_MS);

  const tasks = await page.evaluate(`(${TASKS_SINCE})(${t0})`);

  samples.push({ toDetailMs, ...tasks, shown });
}

await browser.close();

/* ---------------------------------------------------------------------------
 * THE REPORT
 * ------------------------------------------------------------------------- */

const timed = samples.slice(WARMUP);
const missed = timed.filter((s) => !s.shown).length;

if (missed) {
  fail(`${missed} of ${timed.length} taps never opened the detail panel`,
    'A tap that did nothing is not a fast tap.');
}

const med = (list) => {
  const v = [...list].sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};
const max = (list) => list.reduce((a, b) => Math.max(a, b), 0);

const result = {
  runs: timed.length,
  warmupDiscarded: WARMUP,
  windowMs: WINDOW_MS,
  /* ==> THE WORST OF THE WORST, NOT THE MEDIAN OF IT. <== One bad selection in
   * six is one bad selection a reader will hit. */
  worstTaskMs: max(timed.map((s) => s.worstTaskMs)),
  blockedMs: med(timed.map((s) => s.blockedMs)),
  toDetailMs: med(timed.filter((s) => s.shown).map((s) => s.toDetailMs)),
  longTaskCount: med(timed.map((s) => s.count)),
  firstRun: samples[0],
  perRun: timed,
};

console.log('\nResult');
console.log(`  worst single block   ${result.worstTaskMs} ms   <- the number that feels like lag`);
console.log(`  blocked per select   ${result.blockedMs} ms (median, over ${WINDOW_MS} ms)`);
console.log(`  tap to panel         ${result.toDetailMs} ms (median)`);
console.log(`  long tasks           ${result.longTaskCount} (median)`);
console.log(`  first run, discarded ${JSON.stringify(result.firstRun)}`);

if (pageErrors.length) {
  console.log(`\n  note: ${pageErrors.length} uncaught page error(s) during the run`);
  for (const e of pageErrors.slice(0, 3)) console.log(`    ${e}`);
}

console.log('\nPaste into NOW.md:');
console.log(
  `  perf-select on \`?replay=ida\`: worst block ${result.worstTaskMs} ms, ` +
    `blocked ${result.blockedMs} ms/select, tap-to-panel ${result.toDetailMs} ms`
);

/* ---------------------------------------------------------------------------
 * THE GATE
 * ------------------------------------------------------------------------- */

if (CHECK) {
  console.log('\nAgainst the budgets');
  const keys = ['worstTaskMs', 'blockedMs', 'toDetailMs'];
  let checked = 0;

  for (const k of keys) {
    const budget = budgets[k];
    if (budget == null) {
      console.log(`  — ${k}: no budget set, measured ${result[k]} ms`);
      continue;
    }
    checked++;
    if (result[k] <= budget) ok(`${k} ${result[k]} ms is within ${budget} ms`);
    else fail(`${k} ${result[k]} ms is over the ${budget} ms budget`);
  }

  /* ==> AN UNSET BUDGET IS NOT A PASS AND IS NOT A FAILURE EITHER. <== It is
   * the gate telling you it is not armed yet. Saying so loudly is the whole
   * difference between a check that protects the app and a green tick that
   * means nothing — the shape `token-check` already uses. */
  if (!checked) {
    console.log(
      '\n  !! NO BUDGETS ARE SET, so this gate cannot fail and is not protecting\n' +
        '     anything yet. Fill tools/perf-budgets.json from the numbers above.'
    );
  }
}

console.log(
  failures === 0
    ? '\n✓ perf-select: measured\n'
    : `\n✗ perf-select: ${failures} failure(s)\n`
);
process.exit(failures === 0 ? 0 : 1);
