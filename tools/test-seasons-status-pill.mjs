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

import { pillDetail } from '../seasons/status-pill.js';

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

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} assertions pass — the archive's bottom pill says which state it is in`);
