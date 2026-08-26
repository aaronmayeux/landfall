/**
 * near-home-size.mjs — what the whole-basin near-home pass actually costs.
 * SPEC-SEASONS-BUILD.md §57.19a, §57.35 fault 2.
 *
 * ==> IT EXISTS BECAUSE §57.19a HAD A NUMBER IN IT THAT WAS TYPED RATHER THAN
 * COMPUTED, AND THE TYPED ONE WAS WRONG BY ABOUT DOUBLE. <== CLAUDE.md's first
 * rule is that any figure ending up inside a sentence is produced by running
 * code against the real file. The stored-answer size in that table was not, and
 * it read perfectly at 10-65 KB while the truth was 19-131 KB. Nothing about it
 * invited a second look. Run this and quote what prints.
 *
 * ==> WHAT IT MEASURES AND WHAT IT CANNOT. <== Bytes on disk, bytes over the
 * wire, the parse, the near-home pass and the size of the answer that gets
 * kept — all real, all off the files in this repo. **The phone is not in here
 * and cannot be.** CLAUDE.md: a millisecond figure from node is evidence about
 * node. The parse and the pass both run in a Worker on a device whose CPU this
 * sandbox knows nothing about, so the phone multiple in §57.19a is an
 * extrapolation and is labelled as one.
 *
 * ==> THE GZIP FIGURE IS AN APPROXIMATION OF CLOUDFLARE, NOT A MEASUREMENT OF
 * IT. <== We compress locally at level 9; Cloudflare picks its own level and
 * may serve brotli, which is usually smaller. So this is the pessimistic end of
 * what a reader downloads, which is the right direction for a number used to
 * decide whether to ask their permission.
 *
 *   node tools/near-home-size.mjs
 *
 * Reads the repo. No network — the whole-basin files are committed (§57.35
 * FIX 6, the phone never talks to NOAA).
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { parseHurdat2 } from '../lib/hurdat.js';
import { indexNearHome, within } from '../lib/near-home.js';
import { SEASONS } from '../config/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'seasons', 'data');

/** ==> THE WHOLE-BASIN FILES ARE THE ONES PREFIXED `hurdat2-`. <== §57.35
 *  FIX 12 slices every season into its own file in the same directory, so the
 *  directory is ~180 per-season files and two whole-basin ones. Matching on the
 *  prefix rather than counting is what keeps this correct as seasons are added. */
const wholeBasin = () => fs.readdirSync(DATA)
  .filter((f) => f.startsWith('hurdat2-') && f.endsWith('.txt'))
  .sort()
  .map((f) => path.join(DATA, f));

/** ==> THREE HOUSES, CHOSEN TO SPAN THE ANSWER RATHER THAN TO LOOK GOOD. <==
 *  Miami is the busiest coastline in the record, New Orleans the canonical
 *  case (§57.19's Katrina finding), and Honolulu is a Pacific house whose
 *  answer is an order of magnitude smaller — the spread is the point, because
 *  a single house would make the stored size look like one number. */
const HOUSES = [
  ['New Orleans', { lon: -90.0715, lat: 29.9511 }],
  ['Miami', { lon: -80.1918, lat: 25.7617 }],
  ['Honolulu', { lon: -157.8583, lat: 21.3069 }],
];

/** Decimal MB throughout, and stated. §57.19a once carried 10.65 (binary) and
 *  0.94 (decimal) in the same sentence, which is two unit systems one comma
 *  apart. Over-the-wire figures are quoted in decimal by every host and every
 *  browser devtools panel, so decimal wins and binary goes. */
const mb = (bytes) => (bytes / 1e6).toFixed(2);
const kb = (bytes) => Math.round(bytes / 1024);

/** Median of five, not a single run — a first pass pays for a cold JIT and
 *  reporting it as the cost would overstate every device. */
function medianMs(fn, runs = 5) {
  const times = [];
  let last;
  for (let i = 0; i < runs; i += 1) {
    const t = performance.now();
    last = fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return { ms: times[Math.floor(runs / 2)], value: last };
}

function main() {
  const files = wholeBasin();
  if (!files.length) {
    console.error('no whole-basin files in seasons/data — nothing to measure');
    process.exit(1);
  }

  let raw = 0;
  let gz = 0;
  const texts = [];
  for (const f of files) {
    const buf = fs.readFileSync(f);
    raw += buf.length;
    gz += zlib.gzipSync(buf, { level: 9 }).length;
    texts.push(buf.toString('utf8'));
  }

  const { ms: parseMs, value: storms } = medianMs(
    () => texts.flatMap((t) => parseHurdat2(t).storms ?? [])
  );

  let positions = 0;
  /* `points`, and it is read off the parser rather than remembered: the first
   * version of this tool guessed `track` and printed `0 positions` beside a
   * correct storm count, which is exactly the shape of wrong number this file
   * exists to prevent. */
  for (const s of storms) positions += (s.points ?? []).length;
  const segments = positions - storms.length;

  console.log('');
  console.log('WHOLE-BASIN NEAR-HOME PASS — measured, not estimated');
  console.log('');
  for (const f of files) {
    console.log(`  ${path.basename(f)}  ${mb(fs.statSync(f).size)} MB`);
  }
  console.log('');
  console.log(`  on disk           ${raw} bytes = ${mb(raw)} MB`);
  console.log(`  over the wire     ${gz} bytes = ${mb(gz)} MB  (gzip -9, local)`);
  console.log(`  the archive       ${storms.length} storms · ${positions} positions · ${segments} segments`);
  console.log(`  parse             ${Math.round(parseMs)} ms  <== ON THIS CPU. Not a phone.`);
  console.log('');
  console.log('  the pass, and the answer that is KEPT:');
  for (const [name, home] of HOUSES) {
    const { ms, value: full } = medianMs(() => indexNearHome(storms, home));
    const kept = within(full, SEASONS.nearHomeKeepMi);
    const bytes = Buffer.byteLength(JSON.stringify(kept));
    console.log(
      `    ${name.padEnd(12)} ${String(Math.round(ms)).padStart(3)} ms`
      + ` · ${String(kept.length).padStart(4)} entries within ${SEASONS.nearHomeKeepMi} mi`
      + ` · ${String(kb(bytes)).padStart(3)} KB stored`
    );
  }
  console.log('');
  console.log('  Every figure above is this machine. The phone multiple in');
  console.log('  §57.19a is an extrapolation and says so.');
  console.log('');
}

main();
