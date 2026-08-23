#!/usr/bin/env node
/**
 * constants-toc.mjs — keeps the grouped table of contents at the head of
 * `config/constants.js` true.
 *
 * WHY THIS EXISTS RATHER THAN A SPLIT. `config/constants.js` is 63 blocks in
 * one file, and finding the right one was the only real complaint against it.
 * The obvious fix — split it into eight files — was measured and rejected:
 * every block in it is read by the SHIPPED app (`tools/module-graph.mjs` says
 * so, which is §12's own test), so a split moves the same bytes into more
 * files, and because eight blocks reference each other it needs a shared base
 * file underneath, which is an extra module WAVE — a full network round trip on
 * a phone, 100-300ms on cell, bought for nothing a user can see.
 *
 * So: the grouping without the split. The groups below are the same ones a
 * split would have produced. They are a map, not a boundary.
 *
 * ===> NO LINE NUMBERS, DELIBERATELY. <=== `SPEC-INDEX.md` carries line ranges
 * because a spec section is 300 lines of prose you cannot search for. A
 * constant has a NAME, and searching the name lands on it exactly. Line numbers
 * here would go stale on every edit to the file and turn an ordinary comment
 * change into a failed push, which is how a check trains people to ignore it.
 *
 * WHAT THE CHECK ACTUALLY CATCHES: a block added, removed, or renamed without
 * being classified. That is the only way this list can lie, and it fires
 * exactly then.
 *
 * Run `node tools/constants-toc.mjs` to rewrite the block.
 * Run `node tools/constants-toc.mjs --check` to fail if it is stale.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = path.join(ROOT, 'config/constants.js');

const BEGIN = '/* ==> TABLE OF CONTENTS';
const END = ' * ==> END TABLE OF CONTENTS <== */';

/**
 * The groups, in the order they appear in the file, each with the one sentence
 * that says what belongs in it. ==> A GROUP'S SENTENCE IS THE ADMISSION TEST.
 * <== If a new block does not fit any of them, it either needs a new group or
 * it does not belong in this file at all (§12: an off-path block is bytes every
 * visitor pays for and nobody uses).
 */
const GROUPS = [
  ['TIMING, POLLING AND FRESHNESS',
   'when we ask, how long an answer stays good, and when quiet becomes a fault',
   ['ADVISORY_CADENCE', 'BOOT', 'POLL', 'RETRYABLE_STATUS', 'CACHE', 'FRESHNESS',
    'RELAY_AGE', 'SILENCE', 'GEOMETRY_LAG_THRESHOLD']],

  ['WHERE THE DATA COMES FROM',
   'the addresses and the shapes of the feeds behind them',
   ['ENDPOINT', 'MAPSERVER', 'TILES', 'GDACS_GEOMETRY', 'SATELLITES',
    'IMAGERY_SENDS_NO_TIME']],

  ['THE CAMERA AND THE GLOBE',
   'zoom ladder, dive, idle motion, and what the sphere itself does',
   ['ZOOM', 'GLOBE', 'DIVE', 'GLOW', 'RIM', 'MOTION', 'APPROACH']],

  ['MAP FURNITURE',
   'borders, place names and label placement — everything under the storms',
   ['ADMIN', 'LABEL_PLACEMENT', 'COAST_BAND', 'SIMPLIFY']],

  ['STORM SCIENCE AND UNITS',
   'the numbers meteorology fixes, not numbers we chose',
   ['UNITS', 'CATEGORY_THRESHOLD_KT', 'CATEGORY_TOP_KT', 'JTWC_WIND',
    'CONE_CIRCLE_NM_2021', 'CONE_CIRCLE_NM_2026', 'CONE_CIRCLE_BY_SEASON',
    'CONE_CIRCLE_SEASON_LATEST', 'CONE_CIRCLE_BASIN']],

  ['DRAWING A STORM',
   'track line, cone, wind swath, glyph — the geometry of one storm on the map',
   ['MESH_TRACK', 'FORECAST_NOW', 'TRACK_LINE', 'CONE_SWEEP', 'CONE_CURVE',
    'RING_POLISH', 'WIND_SWEEP', 'BAND_MERGE']],

  ['FEATURES WITH THEIR OWN SECTION',
   'each of these owns a spec section and a piece of the drawer',
   ['OUTLOOK', 'GENESIS', 'SURGE', 'GDACS_SURGE', 'CAP', 'RAIN', 'ENDED', 'IMAGERY', 'ENV_RIBBON',
    'ENV_HEALTH', 'MODEL_GROUP', 'MODEL_FAMILY', 'MODEL_TRACKS', 'ADVISORY_TEXT',
    'POPULATION']],

  ['HOME',
   'the house on the map and the dashboard that reads from it',
   ['HOME', 'HOME_DASH', 'GEOCODE']],

  ['THE INTERFACE ITSELF',
   'what the app remembers, and how it answers a finger or a key',
   ['STORAGE_KEY', 'FIRST_RUN', 'KEYBOARD', 'SLIDER']],

  ['WATCHING OURSELVES',
   'frame budget and the anonymous numbers that say whether it held',
   ['PERF', 'TELEMETRY']],
];

/* ------------------------------------------------------------------------- */

const src = fs.readFileSync(FILE, 'utf8');
const exported = [...src.matchAll(/^export const (\w+)/gm)].map((m) => m[1]);

const classified = new Set(GROUPS.flatMap(([, , names]) => names));

const missing = exported.filter((n) => !classified.has(n));
const phantom = [...classified].filter((n) => !exported.includes(n));

if (missing.length || phantom.length) {
  console.error('\nconfig/constants.js and the table of contents disagree.\n');
  for (const n of missing) {
    console.error(`  ✗ ${n} is exported but is in no group.`);
  }
  for (const n of phantom) {
    console.error(`  ✗ ${n} is listed in a group but is not exported any more.`);
  }
  console.error('\nEvery block belongs to exactly one group. Put it in the group whose');
  console.error('sentence describes it, in tools/constants-toc.mjs, then re-run this.');
  console.error('If it fits none of them, that is the file telling you it does not');
  console.error('belong here (SPEC §12).\n');
  process.exit(1);
}

/** The block, wrapped so no line runs past 79 columns. */
function render() {
  const out = [];
  out.push(BEGIN + ' — ' + exported.length + ' blocks, ten groups <==');
  out.push(' *');
  out.push(' * A map, not a boundary — everything below lives in THIS file. Search the');
  out.push(' * name to land on it. Generated by tools/constants-toc.mjs; the pre-push');
  out.push(' * hook fails if a block is added, removed or renamed without landing in a');
  out.push(' * group here.');
  for (const [title, blurb, names] of GROUPS) {
    out.push(' *');
    out.push(` * ${title}`);
    out.push(` *   ${blurb}`);
    let line = ' *  ';
    for (const n of names) {
      if ((line + ' ' + n).length > 78) { out.push(line); line = ' *  '; }
      line += ' ' + n;
    }
    if (line.trim() !== '*') out.push(line);
  }
  out.push(' *');
  out.push(END);
  return out.join('\n');
}

const block = render();
const begin = src.indexOf(BEGIN);
const finish = src.indexOf(END);

let next;
if (begin !== -1 && finish !== -1) {
  next = src.slice(0, begin) + block + src.slice(finish + END.length);
} else {
  /* First install: place it directly after the file's own header comment. */
  const after = src.indexOf('*/') + 2;
  next = src.slice(0, after) + '\n\n' + block + src.slice(after);
}

if (process.argv.includes('--check')) {
  if (next !== src) {
    console.error('\nThe table of contents in config/constants.js is stale.');
    console.error('Run: node tools/constants-toc.mjs\n');
    process.exit(1);
  }
  console.log(`✓ config/constants.js table of contents is current — ${exported.length} blocks in ten groups`);
  process.exit(0);
}

fs.writeFileSync(FILE, next);
console.log(`✓ wrote the table of contents — ${exported.length} blocks in ten groups`);
