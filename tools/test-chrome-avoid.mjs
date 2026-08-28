#!/usr/bin/env node
/**
 * test-chrome-avoid.mjs — the rectangle maths behind keeping overlays out from
 * under the UI, and the one thing about it that rotted silently for weeks.
 *
 * ZERO DEPENDENCIES, like every other suite here.
 *
 * ==> THE FIRST GROUP IS THE REASON THIS FILE EXISTS. <==
 *
 * `map/chrome-avoid.js` names the chrome it dodges with CSS selectors. Those
 * are a contract with markup that lives in a completely different file, and
 * nothing in JavaScript checks it: `querySelectorAll` on a selector that
 * matches nothing returns an empty list and no error. So when `#panel-storms`
 * and `#panel-home` were replaced by the single `#drawer` element, both lists
 * here kept naming the dead ids, the drawer stopped counting as something that
 * hides the home marker AND as something the pointer must avoid, and the house
 * slid under an open sheet with no pointer ever appearing. Every other check in
 * this repo passed the whole time — check-syntax parses it fine, css-orphan
 * compares classes not ids, and no browser suite covers the marker.
 *
 * The gate below is deliberately crude: pull every `#id` out of both selector
 * lists and require it to appear in index.html. It cannot prove the selector
 * matches at the right moment; it CAN prove the element still exists, which is
 * the whole of what went wrong.
 *
 * The rest is `avoidChrome` and `occludedByChrome` as pure geometry — no DOM,
 * no map, no camera. They are exported precisely so they can be reached here.
 *
 * MUTATION-TESTED (§12): each assertion below was watched going red with its
 * rule removed. Notes on how are inline where it is not obvious.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

const {
  avoidChrome, occludedByChrome,
  CHROME_SELECTORS, OCCLUDING_SELECTORS, TAP_BLOCKING_SELECTORS,
} =
  await import('../map/chrome-avoid.js');

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/* --------------------------------------------------------------------------
 * 1. THE SELECTORS STILL POINT AT SOMETHING
 * ------------------------------------------------------------------------ */
console.log('\nchrome selectors match real markup');

const markup = fs.readFileSync('index.html', 'utf8');

/** Every `#id` mentioned anywhere in a selector list. `#status .chip[...]`
 *  yields `status`; the chip itself is built by JS and cannot be checked from
 *  markup, which is honest — this gate covers the ids that live in the page. */
const idsIn = (selectors) => {
  const ids = new Set();
  for (const sel of selectors) {
    for (const m of sel.matchAll(/#([A-Za-z][\w-]*)/g)) ids.add(m[1]);
  }
  return [...ids];
};

const allIds = new Set([...idsIn(CHROME_SELECTORS), ...idsIn(OCCLUDING_SELECTORS)]);

for (const id of allIds) {
  /* Mutation test: change one entry in CHROME_SELECTORS back to
   * `#panel-storms[data-open="true"]` and this goes red for that id. */
  check(
    `#${id} exists in index.html`,
    markup.includes(`id="${id}"`),
    'no element in index.html carries this id — the selector matches nothing and fails silently'
  );
}

/* The drawer specifically, because it is the one that broke and the one whose
 * absence is invisible on every other check. */
check(
  'the open drawer is an obstacle',
  CHROME_SELECTORS.some((s) => s.startsWith('#drawer')),
  'nothing in CHROME_SELECTORS targets #drawer'
);
check(
  'the open drawer hides what is under it',
  OCCLUDING_SELECTORS.some((s) => s.startsWith('#drawer')),
  'nothing in OCCLUDING_SELECTORS targets #drawer'
);

/* --------------------------------------------------------------------------
 * THE TAP-BLOCKING SET, AND THE TWO IDS THAT LIVE IN DIFFERENT FILES.
 * §57.21d. The archive minimises its sheet on a tap that lands outside the
 * furniture, and this is the list it measures. Two of its four ids are in
 * index.html and were checked in the loop above; the two `#seasons-` ones are
 * created at runtime by seasons/pill.js and seasons/status-pill.js, because
 * the archive's furniture must not be on the boot path. Each selector is still
 * a contract, just with a different file — so each is checked against its own
 * file rather than excused.
 *
 * `#seasons-bar` was here until step 5 deleted it; `#seasons-status-pill` took
 * its place on the list for the same reason it was on it — a press on a
 * control must never also register as a tap on the globe underneath.
 * ------------------------------------------------------------------------ */

const RUNTIME_EMITTED = [
  ['#seasons-pill', 'seasons-pill', 'seasons/pill.js'],
  ['#seasons-status-pill', 'seasons-status-pill', 'seasons/status-pill.js'],
];

for (const [selector, id, file] of RUNTIME_EMITTED) {
  check(
    `${selector} is in the tap-blocking set`,
    TAP_BLOCKING_SELECTORS.includes(selector),
    'a tap could be answered through the archive\'s own furniture'
  );
  check(
    `and ${file} is the file that emits that id`,
    new RegExp(`\\.id\\s*=\\s*'${id}'`).test(fs.readFileSync(file, 'utf8')),
    `nothing sets id="${id}" — the selector matches nothing and fails silently`
  );
}
check(
  'the open drawer blocks a tap',
  TAP_BLOCKING_SELECTORS.some((s) => s.startsWith('#drawer')),
  'nothing in TAP_BLOCKING_SELECTORS targets #drawer — the sheet would dismiss on a tap inside itself'
);
/* Every id in the tap set that index.html DOES carry still has to be real.
 * The runtime-emitted ones are named above and skipped here rather than
 * silently exempted by a looser rule. */
const RUNTIME_IDS = RUNTIME_EMITTED.map(([, id]) => id);
for (const id of idsIn(TAP_BLOCKING_SELECTORS)) {
  if (RUNTIME_IDS.includes(id)) continue;
  check(
    `#${id} exists in index.html (tap-blocking set)`,
    markup.includes(`id="${id}"`),
    'no element in index.html carries this id'
  );
}

/* The occluding set must stay a SUBSET of the avoidance set. The attribution
 * button is something an overlay must not cover but must not be banished by;
 * a stray addition to the occluding list is how a marker starts disappearing
 * behind a 20 px corner control. */
check(
  'occluding set is a subset of the avoidance set',
  OCCLUDING_SELECTORS.every((s) => CHROME_SELECTORS.includes(s)),
  OCCLUDING_SELECTORS.filter((s) => !CHROME_SELECTORS.includes(s)).join(', ')
);

/* --------------------------------------------------------------------------
 * 2. A BOTTOM SHEET PUSHES AN OVERLAY UP, NOT SIDEWAYS
 * ------------------------------------------------------------------------ */
console.log('\na full-width bottom sheet');

/* A 390x844 phone with a 60vh sheet: the sheet spans the full width from
 * y=338 down. Padded rects are what measureChrome hands over, so these are
 * already inflated by the clearance. */
const W = 390;
const H = 844;
const MARGIN = 16;
const bounds = { min: MARGIN, maxX: W - MARGIN, maxY: H - MARGIN };
const sheet = { left: -20, right: W + 20, top: 318, bottom: H + 20 };

const underSheet = avoidChrome(200, 700, [sheet], bounds);
check(
  'a point inside the sheet ends up above it',
  underSheet.y < sheet.top,
  `y=${underSheet.y}, sheet top=${sheet.top}`
);
/* THE X MUST NOT MOVE. This is the whole difference between "park the pointer
 * above the house" and "fling it at the screen edge". The sheet spans the full
 * width, so both sideways escapes clamp back inside it and are rejected,
 * leaving only up. Mutation test: drop the `.filter(c => !inRect(...))` in
 * avoidChrome and this goes red — the point lands at x=16. */
check(
  'it does not drift sideways on the way out',
  underSheet.x === 200,
  `x=${underSheet.x}, expected 200`
);

check(
  'a point above the sheet is left alone',
  avoidChrome(200, 100, [sheet], bounds).y === 100
);

check('a point under the sheet reads as hidden', occludedByChrome(200, 700, [sheet]));
check('a point above it does not', !occludedByChrome(200, 100, [sheet]));

/* --------------------------------------------------------------------------
 * 3. THE FAB CLUSTER STILL PUSHES SIDEWAYS
 * ------------------------------------------------------------------------ */
console.log('\nthe control cluster');

/* A column of buttons down the right edge — the shallowest way out is left,
 * because the right escape clamps off the viewport and re-enters the rect. */
const fabs = { left: W - 84, right: W + 20, top: 300, bottom: 520 };
const offFabs = avoidChrome(W - 40, 400, [fabs], bounds);
check(
  'a point on the FAB column is pushed left of it',
  offFabs.x < fabs.left,
  `x=${offFabs.x}, cluster left=${fabs.left}`
);
check('its y is untouched', offFabs.y === 400, `y=${offFabs.y}`);

/* BOTH AT ONCE — sheet up, FABs right. This is the drawer-open case on a
 * phone and the point has to clear both, not ping-pong between them. */
const both = avoidChrome(W - 40, 700, [sheet, fabs], bounds);
check(
  'a point caught by both clears both',
  !occludedByChrome(both.x, both.y, [sheet]) &&
    !occludedByChrome(both.x, both.y, [fabs]),
  `landed at ${both.x},${both.y}`
);

/* --------------------------------------------------------------------------
 * 4. NOTHING ESCAPES OFF THE SCREEN
 * ------------------------------------------------------------------------ */
console.log('\nthe safe margin holds');

/* An obstacle covering the entire usable viewport: there is no honest answer,
 * and the contract is that the point still comes back inside the margins
 * rather than somewhere off the glass where the OS eats the gesture (§10). */
const everything = { left: -50, right: W + 50, top: -50, bottom: H + 50 };
const boxed = avoidChrome(200, 400, [everything], bounds);
check(
  'a boxed-in point stays within the safe margins',
  boxed.x >= MARGIN && boxed.x <= W - MARGIN &&
    boxed.y >= MARGIN && boxed.y <= H - MARGIN,
  `${boxed.x},${boxed.y}`
);

/* A sheet that reaches past the top of the screen cannot be escaped upward
 * without leaving the glass, so the clamp has the last word. */
const tallSheet = { left: -20, right: W + 20, top: -20, bottom: 600 };
const clamped = avoidChrome(200, 300, [tallSheet], bounds);
check(
  'an inescapable sheet still leaves the point on screen',
  clamped.y >= MARGIN && clamped.y <= H - MARGIN,
  `y=${clamped.y}`
);

/* --------------------------------------------------------------------------
 * done
 * ------------------------------------------------------------------------ */
console.log('');
if (failures) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
console.log('all chrome-avoid checks passed');
