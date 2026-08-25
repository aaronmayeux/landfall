/**
 * test-archive-tap.mjs — what a tap on the archive's globe means. §57.21d.
 *
 * The sibling suite `test-season-glyph-tap.mjs` owns the glyph hit-test
 * itself. This one owns the THIRD branch and the rules around it: when a tap
 * on empty water minimises the sheet, when it must not, and the two numbers
 * that separate a tap from the start of a drag.
 *
 * ==> THE DECISION IS RECONSTRUCTED FROM THE SHIPPED PARTS, NOT REIMPLEMENTED.
 * <== `minimiseArchiveSheet` lives inside `main.js`'s closure and cannot be
 * imported, so this suite drives the real `measureChrome` and
 * `occludedByChrome` — the two functions that actually decide "outside the
 * furniture" — against a stand-in DOM, and then READS `main.js` to prove the
 * shipped branch asks the same questions in the same order. A behavioural
 * suite alone would pass just as happily against a `main.js` that never calls
 * any of it, which is exactly how push 1 of this feature shipped green
 * (§57.21c).
 *
 * Zero dependencies, plain node.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };
const eq = (what, got, want) => ok(
  `${what} (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`,
  Object.is(got, want)
);

/* --- a stand-in DOM ----------------------------------------------------------
 * `measureChrome` wants `document.querySelectorAll`, a computed style and a
 * bounding rect. Nothing else. Giving it those is a smaller lie than stubbing
 * `measureChrome` itself would be — the padding arithmetic and the visibility
 * rule are both real code here, and both have been wrong before.
 * -------------------------------------------------------------------------- */

const SCREEN = { w: 390, h: 844 };

/** One element, as `measureChrome` needs to see it. */
function el(sel, rect, { opacity = '1', display = 'block' } = {}) {
  return {
    sel,
    getBoundingClientRect: () => ({
      left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      width: rect.right - rect.left, height: rect.bottom - rect.top,
    }),
    _style: { opacity, display, visibility: 'visible' },
  };
}

let stage = [];
globalThis.document = {
  querySelectorAll: (sel) => stage.filter((e) => e.sel === sel),
};
globalThis.getComputedStyle = (node) => node._style;

const {
  measureChrome, occludedByChrome, TAP_BLOCKING_SELECTORS,
} = await import('../map/chrome-avoid.js');
const { TAP } = await import('../config/constants.js');
const { SIZE } = await import('../config/tokens.js');

const SLOP = parseInt(SIZE.touchTarget, 10) / 2;

/* The archive on a phone: sheet docked to the bottom at 66vh, the bar under
 * it. Numbers are the real shapes those two take, not round ones. */
const BAR_H = 44 + 8 * 2; /* one touch target and its padding — seasons.css */
const SHEET_H = Math.round(SCREEN.h * 0.66);
const PHONE = () => [
  el('#drawer[data-open="true"]', {
    left: 0, right: SCREEN.w,
    top: SCREEN.h - BAR_H - SHEET_H, bottom: SCREEN.h - BAR_H,
  }),
  el('#seasons-bar', { left: 0, right: SCREEN.w, top: SCREEN.h - BAR_H, bottom: SCREEN.h }),
  el('#controls', { left: SCREEN.w - 60, right: SCREEN.w - 8, top: 100, bottom: 260 }),
];

/** The shipped decision, minus the parts that need a live map. */
const outsideFurniture = (x, y) =>
  !occludedByChrome(x, y, measureChrome(SLOP, TAP_BLOCKING_SELECTORS));

/* --- a phone: outside means ABOVE -------------------------------------------- */

stage = PHONE();

{
  const sheetTop = SCREEN.h - BAR_H - SHEET_H;

  ok('a tap high on the globe is outside the furniture',
    outsideFurniture(SCREEN.w / 2, 120));

  ok('a tap in the middle of the sheet is not',
    !outsideFurniture(SCREEN.w / 2, sheetTop + 100));

  ok('a tap in the archive bar is not — that is the way out',
    !outsideFurniture(SCREEN.w / 2, SCREEN.h - BAR_H / 2));

  /* ==> THE SLOP STRIP, WHICH IS THE WHOLE REASON THE PADDING IS THERE. <== A
   * thumb aimed at the sheet's own top edge lands a few pixels above it, and
   * minimising is the destructive answer to that miss. */
  ok('a tap just above the sheet is inside the slop and does nothing',
    !outsideFurniture(SCREEN.w / 2, sheetTop - 4));

  ok('  and a tap a whole touch target above it is a real tap on the globe',
    outsideFurniture(SCREEN.w / 2, sheetTop - SLOP - 4));

  ok('the control cluster blocks a tap too, or the sheet dismisses under a button',
    !outsideFurniture(SCREEN.w - 30, 180));
}

/* --- a wide screen: outside means BESIDE -------------------------------------
 * ==> THIS IS THE CASE A HARDCODED HEIGHT WOULD HAVE GOT WRONG. <== On a wide
 * window the drawer docks LEFT, so "above the drawer" is meaningless and the
 * only workable rule is "outside its measured box".
 * -------------------------------------------------------------------------- */

{
  const RAIL_W = 300;
  stage = [
    el('#drawer[data-open="true"]', { left: 0, right: RAIL_W, top: 0, bottom: 900 }),
    el('#seasons-bar', { left: 0, right: 1440, top: 900, bottom: 960 }),
  ];

  ok('a tap on the globe beside a left-docked rail counts as outside',
    outsideFurniture(900, 400));

  ok('  and a tap inside the rail does not, at the same height',
    !outsideFurniture(150, 400));

  ok('  and the strip just right of the rail is slop, not globe',
    !outsideFurniture(RAIL_W + 4, 400));
}

/* --- a faded control is not furniture ----------------------------------------
 * On a phone the control cluster steps aside when the drawer opens — opacity
 * 0, pointer-events none — but it is still laid out and still has a box. If
 * `measureChrome`'s visibility rule stopped working, a tap on plainly open
 * globe would silently do nothing.
 * -------------------------------------------------------------------------- */

{
  stage = [
    el('#drawer[data-open="true"]', { left: 0, right: SCREEN.w, top: 500, bottom: 800 }),
    el('#controls', { left: 300, right: 380, top: 100, bottom: 260 }, { opacity: '0' }),
  ];
  ok('a tap where a faded-out control is laid out still reaches the globe',
    outsideFurniture(340, 180));
}

/* --- a closed drawer is not an obstacle --------------------------------------
 * The selector carries `[data-open="true"]`, so a closed drawer is not
 * returned at all. Nothing to minimise, and nothing blocking either.
 * -------------------------------------------------------------------------- */

{
  stage = [
    el('#drawer', { left: 0, right: SCREEN.w, top: 500, bottom: 800 }),
    el('#seasons-bar', { left: 0, right: SCREEN.w, top: 800, bottom: 844 }),
  ];
  ok('a closed drawer blocks nothing — the selector asks for data-open',
    outsideFurniture(SCREEN.w / 2, 600));
}

/* --- the two numbers ---------------------------------------------------------- */

ok('the movement threshold is a real number of pixels',
  Number.isFinite(TAP.movePx) && TAP.movePx > 0);

ok('the duration threshold is past any tap and short of any rest',
  Number.isFinite(TAP.maxMs) && TAP.maxMs >= 200 && TAP.maxMs <= 1000);

{
  /* ==> ONE MOVEMENT THRESHOLD IN THE APP, NOT TWO. <== MapLibre refuses to
   * fire `click` once the pointer has moved `clickTolerance`, so the map is
   * handed our number rather than us writing a second test beside its one. If
   * this stops being wired, the constant becomes decoration and the real
   * threshold silently reverts to MapLibre's default. */
  const globeJs = readFileSync(join(ROOT, 'map/globe.js'), 'utf8');
  ok('the map is built with our movement threshold',
    /clickTolerance:\s*TAP\.movePx/.test(globeJs));
}

/* --- the shipped branch asks the same questions, in order --------------------- */

const mainJs = readFileSync(join(ROOT, 'main.js'), 'utf8');

/* ==> THE BRANCH IS CUT OUT FIRST, AND THE FIRST VERSION OF THIS SUITE DID
 * NOT DO THAT. <== Searching the whole file for `minimiseArchiveSheet(e)`
 * found the FUNCTION DEFINITION, which sits above the click handler — so the
 * ordering assertion compared a definition against a call and failed on
 * correct code. Everything below reads only the archive branch itself. */
const archiveBranch = (() => {
  const from = mainJs.indexOf('if (isArchive()) {');
  /* The branch ends where the next one begins — the home marker, which is the
   * first test on the LIVE globe's side of the early return. */
  const to = mainJs.indexOf('homeMarker.hitTest(e.point)', from);
  ok('the archive branch and the branch after it were both found',
    from > 0 && to > from);
  return mainJs.slice(from, to);
})();

{
  const glyph = archiveBranch.indexOf('seasonGlyphAtPoint(map, e.point, seasonGlyphList)');
  const track = archiveBranch.indexOf('seasonStormAtPoint(map, e.point)');
  const water = archiveBranch.indexOf('minimiseArchiveSheet(e);');

  ok('the archive branch is one ordered list: glyph, track, empty water',
    glyph > 0 && track > glyph && water > track);
}

ok('the minimise refuses a press that lasted longer than a tap',
  /performance\.now\(\)\s*-\s*pressStartedAt\s*>\s*TAP\.maxMs/.test(mainJs));

ok('the press clock is stamped on pointerdown, not on touchstart or mousedown (§13)',
  /addEventListener\(\s*\n?\s*'pointerdown'/.test(mainJs)
  && !/addEventListener\('touchstart'/.test(mainJs));

ok('the press clock listens on the map canvas, so drawer presses never reach it',
  /getCanvasContainer\(\)\.addEventListener\(/.test(mainJs));

ok('the minimise measures the furniture rather than reading a height',
  /measureChrome\(slop, TAP_BLOCKING_SELECTORS\)/.test(mainJs));

ok('  and pads it by half a touch target',
  /const slop = parseInt\(SIZE\.touchTarget, 10\) \/ 2/.test(mainJs));

ok('the minimise does nothing when the sheet is already down',
  /function minimiseArchiveSheet[\s\S]{0,200}if \(!drawer\.isOpen\(\)\) return;/.test(mainJs));

/* ==> AND EMPTY WATER NO LONGER CLEARS THE FOCUS. <== Aaron's (b), 2026-08-25.
 * The old behaviour was `focusSeasonStormNow(null)` on that branch, and one
 * gesture with two visible outcomes is what readers report as a glitch. This
 * asserts the removal rather than the addition, because a version that did
 * BOTH would pass every assertion above. */
{
  ok('a tap on empty water does not also clear the focus',
    !/focusSeasonStormNow\(null\)/.test(archiveBranch));
  ok('  while a tap on a track still focuses one',
    /focusSeasonStormNow\(trackId\)/.test(archiveBranch));
  ok('  and a tap on a glyph OPENS rather than focuses',
    /openSeasonStormNow\(glyphId\)/.test(archiveBranch));
}

/* --- Escape still minimises --------------------------------------------------
 * §13. Not built in this pass and that is the finding: `attachEscape` is one
 * global contract and `close()` on a view that minimises IS the minimise
 * (§57.21b). Asserted so it cannot quietly go while nobody is looking at it.
 * -------------------------------------------------------------------------- */

{
  const globeJs = readFileSync(join(ROOT, 'map/globe.js'), 'utf8');
  ok('Escape closes an open panel before it touches the camera',
    /if \(isPanelOpen\?\.\(\)\) closePanel\?\.\(\);/.test(globeJs));

  const drawerJs = readFileSync(join(ROOT, 'ui/drawer.js'), 'utf8');
  ok('and for a view that minimises, close IS the minimise',
    /minimises/.test(drawerJs) && /closeBtn\.setAttribute\('aria-label', minimise \?/.test(drawerJs));

  const board = readFileSync(join(ROOT, 'ui/view-seasons-board.js'), 'utf8');
  ok('  and the seasons board is such a view',
    /minimises:\s*true/.test(board));
}

/* --- report ------------------------------------------------------------------ */

console.log(`\ntest-archive-tap: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL  ${f}`);
process.exit(fails.length ? 1 : 0);
