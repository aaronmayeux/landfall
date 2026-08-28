#!/usr/bin/env node
/**
 * test-seasons-status-pill.mjs — the words along the bottom of the archive globe.
 * §57.21b item 8.
 *
 *   node tools/test-seasons-status-pill.mjs
 *
 * ==> THE BAR STOPPED BEING A LABEL AND BECAME THE ONLY PLACE SELECTION IS
 * DISCOVERABLE. <== §57.21a made opening a storm a deliberate act — tap its
 * track, or press Enter on its ticked row — and nothing anywhere else on
 * screen says a track can be tapped. A reader who never learns that never sees
 * a single storm's per-fix dots, which is most of what step 6 built.
 *
 * ==> AND `2005 · Atlantic` OVER AN EMPTY GLOBE IS A TITLE BAR. <== It states
 * a fact the reader can already see and answers nothing. Zero drawn is the
 * state every visit STARTS in, so it is the one that most needs its own words.
 *
 * `pillDetail` is pure — facts in, a sentence out — which is why this suite
 * needs no DOM at all. The board reports what is true and the pill owns how it
 * is said, so there is exactly one place to change the wording.
 *
 * Zero dependencies, plain node.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pillDetail } from '../seasons/status-pill.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };
const eq = (what, got, want) => ok(
  `${what}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`,
  got === want
);

const WHERE = { label: '2005 · Atlantic', shown: 0, openName: '' };

/* ---------------------------------------------------------------------------
 * 1. NOTHING TO SAY YET.
 *
 * The pill mounts before the board has read a byte. An invented sentence in
 * that gap would be the app claiming a year it has not loaded.
 * ------------------------------------------------------------------------ */

eq('no season yet means no sentence', pillDetail(null), '');
eq('and neither does a where with no label', pillDetail({ shown: 3 }), '');

/* ---------------------------------------------------------------------------
 * 2. AN EMPTY GLOBE SAYS WHAT TO DO ABOUT IT.
 * ------------------------------------------------------------------------ */

eq('==> ZERO DRAWN GETS ITS OWN WORDS, OR THE BAR IS A TITLE BAR <==',
  pillDetail(WHERE), '2005 · Atlantic · tick a storm to draw it');

ok('and it never reads as a count of nothing',
  !/0 shown/.test(pillDetail(WHERE)));

/* ---------------------------------------------------------------------------
 * 3. TRACKS DRAWN, NONE OPEN — THE HINT.
 *
 * ==> THIS IS THE STATE THE HINT EXISTS FOR. <== The reader has storms on the
 * globe and no way of knowing they can be tapped.
 * ------------------------------------------------------------------------ */

eq('a drawn set is counted, and the way in is spelled out',
  pillDetail({ ...WHERE, shown: 3 }),
  '2005 · Atlantic · 3 shown · tap a track for detail');

eq('one storm is still counted the same way — plurality is on the noun, and '
  + '"1 shown" is what the roster would say too',
pillDetail({ ...WHERE, shown: 1 }),
'2005 · Atlantic · 1 shown · tap a track for detail');

/* ---------------------------------------------------------------------------
 * 4. A STORM IS OPEN — IT IS THE SUBJECT.
 *
 * ==> THE NAME REPLACES THE COUNT RATHER THAN JOINING IT. <== Four facts on a
 * line that is one line tall on a 390px phone is a line nobody reads. Once a
 * storm is open it IS the subject, and how many others are drawn is answerable
 * by looking at the globe.
 * ------------------------------------------------------------------------ */

eq('the open storm is named',
  pillDetail({ label: '2005 · Atlantic', shown: 4, openName: 'KATRINA' }),
  '2005 · Atlantic · KATRINA');

ok('and the hint stands down, because it has been taken',
  !/tap a track/.test(pillDetail({ label: '2005 · Atlantic', shown: 4, openName: 'KATRINA' })));

ok('the count stands down with it',
  !/shown/.test(pillDetail({ label: '2005 · Atlantic', shown: 4, openName: 'KATRINA' })));

/* ==> AN UNNAMED STORM STILL HAS A DISPLAY FORM, AND THE BAR USES IT. <==
 * §57.14. The board names it through `stormDisplayName`, the same route the
 * roster row takes — a pill calling a storm something the row beside it does
 * not is the panel disagreeing with itself. */
eq('an unnamed storm reads the way its row does',
  pillDetail({ label: '1935 · Atlantic', shown: 1, openName: 'Storm 3' }),
  '1935 · Atlantic · Storm 3');

/* ---------------------------------------------------------------------------
 * 5. EVERY STATE NAMES THE YEAR.
 *
 * §57.11 — the app must always be able to say WHICH record it is showing, and
 * on a closed board this pill is the only thing on screen that can.
 * ------------------------------------------------------------------------ */

for (const w of [
  WHERE,
  { ...WHERE, shown: 2 },
  { ...WHERE, shown: 2, openName: 'RITA' },
]) {
  ok(`the year and basin survive every state (shown=${w.shown}, open=${w.openName || 'none'})`,
    pillDetail(w).startsWith('2005 · Atlantic'));
}

/* --------------------------------------------------------------------------
 * THE WALL IS ITS OWN STATE, AND THIS IS THE SECTION THE BUG WALKED PAST.
 *
 * ==> THE PILL WAS EMPTY ON THE ARCHIVE'S FIRST SCREEN AND EVERY SUITE WAS
 * GREEN. <== Glass, 2026-08-28. Step 5 wired only the BOARD's report, so
 * entering the archive — which lands on the wall — left the pill with nothing
 * to say. Both halves of that were untested: the words, and whether anybody
 * called them.
 * ------------------------------------------------------------------------ */

eq('the wall names the basin and what to do next',
  pillDetail({ label: 'Atlantic', rung: 'wall' }),
  'Atlantic · tap a year to open it');

ok('and it does NOT borrow the board\'s sentence about ticking a storm',
  !/tick a storm/.test(pillDetail({ label: 'Atlantic', rung: 'wall' })));

ok('  which would name a roster the reader cannot see from the wall',
  !/shown/.test(pillDetail({ label: 'Atlantic', rung: 'wall' })));

/* ==> AND A BLUNT INSTRUMENT FOR THE HALF THAT HAD NO SYMPTOM. <== The words
 * being right is worth nothing if nothing calls them, and that is exactly the
 * shape this bug took — a reporter wired at one end only. The same instrument
 * `tools/test-kv-keys.mjs` had to grow for the same reason. */
const indexJs = readFileSync(join(ROOT, 'seasons/index.js'), 'utf8');
const wallBlock = indexJs.slice(indexJs.indexOf('wallView = createSeasonsWallView'));
ok('==> THE WALL ACTUALLY REPORTS TO THE PILL <==',
  /statusPill\?\.setDetail/.test(wallBlock.slice(0, wallBlock.indexOf('\n  });'))));

/* --------------------------------------------------------------------------
 * TWO CSS FACTS THE ELEMENT CANNOT ENFORCE ABOUT ITSELF.
 * ------------------------------------------------------------------------ */

const css = readFileSync(join(ROOT, 'seasons/seasons.css'), 'utf8');

/* ==> `hidden` LOSES TO AN ID RULE'S `display`, AND THAT SHIPPED. <== Glass,
 * 2026-08-28: the pill rendered as an empty capsule over the globe. The
 * property was being set correctly the whole time; the browser's own
 * `[hidden] { display: none }` is a bare element selector and an id beats it. */
ok('==> THE PILL\'S HIDDEN STATE IS DECLARED, NOT ASSUMED <==',
  /#seasons-status-pill\[hidden\]\s*\{\s*display:\s*none/.test(css));

/* ==> AND IT SITS UNDER THE DRAWER. <== It painted THROUGH the open sheet,
 * because it and `#drawer` were both at 30 and stylesheet order broke the tie
 * in the pill's favour. Anything below the drawer's 30 is correct; the number
 * is asserted as a RANGE rather than a literal so a future re-layer does not
 * fail this for moving it to 25. */
const z = Number(/#seasons-status-pill\s*\{[^}]*z-index:\s*(\d+)/s.exec(css)?.[1]);
ok(`==> AND IT IS LAYERED BELOW THE DRAWER'S 30 (z=${z}) <==`, z > 0 && z < 30);

/* --------------------------------------------------------------------------
 * BOTH PILLS SHOW AT EVERY WIDTH, AND BOTH CENTRE ON THE SAME MIDDLE.
 *
 * Aaron, 2026-08-28. The wide-screen hide came off both together — the archive
 * pill had copied it from `#storm-pill`, whose own reason ("the rail is open
 * by default") had already stopped being true.
 * ------------------------------------------------------------------------ */

const panels = readFileSync(join(ROOT, 'ui/panels.css'), 'utf8');

ok('==> NEITHER PILL IS HIDDEN ON A WIDE SCREEN ANY MORE <==',
  !/#storm-pill\s*\{\s*display:\s*none/.test(panels)
  && !/#seasons-status-pill\s*\{\s*display:\s*none\s*;?\s*\}/.test(css));

/* ==> THE SHIFT IS ONE NUMBER READ BY BOTH, NOT TWO THAT AGREE TODAY. <== A
 * pill centred on the VIEWPORT with the rail out sits inside it at the narrow
 * end of desktop, so both move by half the rail — and if they ever moved by
 * different amounts they would sit at two different middles on one screen. */
for (const [name, sheet] of [['the live pill', panels], ['the archive pill', css]]) {
  ok(`${name} centres on --pill-shift rather than a bare 50%`,
    /left:\s*calc\(50%\s*\+\s*var\(--pill-shift/.test(sheet));
}

ok('and the shift is published once, by the drawer\'s own stylesheet',
  /--pill-shift:\s*0px/.test(panels)
  && /html\[data-drawer="open"\][^}]*--pill-shift:\s*calc\(var\(--rail-w\)\s*\/\s*2\)/s.test(panels));

/* ==> AND THE DRAWER HAS TO PUBLISH ITS STATE WHERE THE LIVE PILL CAN READ IT.
 * <== `#storm-pill` sits BEFORE `#drawer` in index.html and CSS has no
 * backwards sibling combinator, so the rule hangs off `<html>` instead. If
 * that attribute stops being written the pill silently stops moving and sits
 * under the rail — no error, just a half-buried caption. */
const drawerJs = readFileSync(join(ROOT, 'ui/drawer.js'), 'utf8');
ok('==> AND THE DRAWER PUBLISHES ITS OPEN STATE ON <html> <==',
  /documentElement\.dataset\.drawer\s*=/.test(drawerJs));

/* The live pill stopped outranking the drawer at the same time — same fault
 * the archive pill had, and it was reachable on a phone through Layers,
 * Settings or Home, none of which hide it. */
const liveZ = Number(/#storm-pill\s*\{[^}]*z-index:\s*(\d+)/s.exec(panels)?.[1]);
ok(`and the live pill is under the drawer too (z=${liveZ})`,
  liveZ > 0 && liveZ < 30);

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} assertions pass — the archive's bottom pill says which state it is in`);
