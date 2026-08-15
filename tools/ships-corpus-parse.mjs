#!/usr/bin/env node
/**
 * ships-corpus-parse.mjs — run the parser over a whole swept season.
 *
 * WHY THIS EXISTS SEPARATELY FROM tools/test-ships.mjs. The twelve fixtures in
 * `samples/ships/` are the regression suite and they run on every push. They
 * are also, deliberately, twelve files chosen by hand — they span the season's
 * extremes rather than its bulk, and a parser can pass all twelve and still
 * meet something in the other 353 that stops it dead.
 *
 * THE CORPUS CANNOT LIVE IN main. Every file in `main` ships to every visitor
 * (§2, no build step), and six megabytes of text no browser will ever read has
 * no business there — so the sweep publishes to its own branch and the whole
 * season is only ever present inside the `ships-corpus` workflow run that
 * fetched it. This script is the ONE moment the parser and the whole season
 * are in the same place, which is why the check has to happen here or nowhere.
 *
 * WHAT IT ASSERTS. Every file parses. Not "most", not "a sample" — a single
 * throw fails the job, because a file the parser cannot read is a storm whose
 * cone would silently lose its environment. It also reports the shape of what
 * it found, so a future season that drifts is visible as a change in the
 * numbers rather than only as a crash.
 *
 * Zero dependencies. Run: node tools/ships-corpus-parse.mjs <corpus-dir>
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseShips, SHIPS_RECONCILE_TOLERANCE_KT } from '../functions/api/nhc/_ships-parse.js';

const DIR = process.argv[2];
if (!DIR) {
  console.error('usage: node tools/ships-corpus-parse.mjs <corpus-dir>');
  process.exit(2);
}

const filesDir = path.join(DIR, 'files');
const names = readdirSync(filesDir)
  .filter((f) => f.endsWith('_ships.txt'))
  .sort();

if (names.length === 0) {
  console.error(`no SHIPS files under ${filesDir} — the sweep produced nothing to check`);
  process.exit(1);
}

const failed = [];
let worstResidual = 0;
let drawableNone = 0;
let zeroTail = 0;
let liveTail = 0;
let interiorGaps = 0;
const basins = {};

for (const name of names) {
  let run;
  try {
    run = parseShips(readFileSync(path.join(filesDir, name), 'utf8'));
  } catch (e) {
    failed.push(`${name}: ${e.code || 'threw'} — ${e.detail || e.message}`);
    continue;
  }

  basins[run.basin] = (basins[run.basin] || 0) + 1;
  if (run.drawableHours === 0) drawableNone++;
  for (let i = 0; i < run.hours.length; i++) {
    worstResidual = Math.max(worstResidual, Math.abs(run.residualKt[i]));
  }

  /* Truncation must stay trailing. An interior gap would mean the drawable
   * window is no longer one clean run and §47.2's claim has gone stale. */
  for (const arr of [run.lat, run.vNoLandKt]) {
    let seenNull = false;
    for (const v of arr) {
      if (v === null) seenNull = true;
      else if (seenNull) {
        interiorGaps++;
        break;
      }
    }
  }

  /* The two shapes past the end of the wind forecast, counted so §47.2's
   * "a zero is not an end-of-forecast signal" stays a measured claim. */
  if (run.lastWindHr !== null && run.lastWindHr < 168) {
    const tail = run.hours.map((h, i) => [h, i]).filter(([h]) => h > run.lastWindHr);
    const live = tail.some(([, i]) => run.totalChangeKt[i] !== 0 || run.environmentKt[i] !== 0);
    if (live) liveTail++;
    else zeroTail++;
  }
}

console.log(`\nSHIPS corpus parse — ${names.length} files`);
console.log(`  basins                      ${JSON.stringify(basins)}`);
console.log(`  worst reconciliation residual ${worstResidual} kt (limit ${SHIPS_RECONCILE_TOLERANCE_KT})`);
console.log(`  files with nothing drawable   ${drawableNone}`);
console.log(`  short forecasts, zero tail    ${zeroTail}`);
console.log(`  short forecasts, live tail    ${liveTail}   <- why a zero means nothing on its own`);
console.log(`  interior truncation gaps      ${interiorGaps}   <- §47.2 says this must be 0`);

if (failed.length) {
  console.error(`\n${failed.length} file(s) did not parse:\n`);
  for (const f of failed.slice(0, 40)) console.error(`  ✗ ${f}`);
  if (failed.length > 40) console.error(`  ... and ${failed.length - 40} more`);
  console.error(
    '\nA file the parser cannot read is a storm whose cone silently loses its\n' +
      'environment. Fix the parser against the failing file, promote it to\n' +
      'samples/ships/ as a fixture, and add its case to tools/test-ships.mjs.\n'
  );
  process.exit(1);
}

if (interiorGaps > 0) {
  console.error(
    `\n${interiorGaps} file(s) truncate with an INTERIOR gap. §47.2 states truncation is\n` +
      'always trailing and the drawable window is one clean run. That is no longer\n' +
      'true, and the layer needs to handle scattered hours before this passes again.\n'
  );
  process.exit(1);
}

console.log(`\nAll ${names.length} files parse.\n`);
