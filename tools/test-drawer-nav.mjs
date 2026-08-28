#!/usr/bin/env node
/**
 * test-drawer-nav.mjs — the drawer's navigation model, which had no test at
 * all until 2026-08-21 and shipped a month-old lie because of it.
 *
 * ZERO DEPENDENCIES, like every other suite here.
 *
 * ==> WHY THIS SUITE EXISTS. <== SPEC-UI §16 stated `storms → detail → layers,
 * back ⇒ that storm's detail` as as-built behaviour. It was not. The detail
 * panel's own Layers shortcut was deleted on 2026-07-25, leaving the floating
 * Layers button as the only door, and that button called `go`, which throws
 * the history away. So the route was documented in three files and reachable
 * from nowhere.
 *
 * NOTHING WOULD HAVE CAUGHT IT. Every module parsed, every import resolved,
 * all 76 suites passed, and the app worked — it just quietly had no Back
 * button on a screen the spec said had one. A `go` where a `push` belonged
 * does not throw. That is the shape of failure this file is for: navigation
 * bugs have no error state, they only show up as a reader ending up somewhere
 * they did not ask to be.
 *
 * FOUR THINGS ARE ASSERTED, and each is a decision that cost a session:
 *
 *   1. `clusterAction` — all four outcomes, from every starting state. This is
 *      a pure function precisely so it can be stated as a table here; inside
 *      main.js's boot closure it was unassertable.
 *   2. THE STACK HAS A CEILING. Four buttons in a corner that always push is a
 *      stack a reader can grow all afternoon and then have to unwind one press
 *      at a time. `swap` is what caps it at three.
 *   3. THE BACK BUTTON NAMES THE STORM, not the word "Storm". `backLabelFor`
 *      beats `titleFor`, and `titleFor` is NOT called when it does — that
 *      function has side effects and must not be run to label a button.
 *   4. FOCUS RETURNS TO THE CONTROL THAT PUT YOU HERE (§13), which is now a
 *      per-step fact rather than one variable, because Layers pushes from its
 *      own button on top of a storm opened from another one.
 *
 * THE DOM STUB below is a lookup table, honestly. `createDrawer` writes one
 * innerHTML string and then queries six known selectors out of it; nothing
 * here parses HTML. It says nothing about layout, focus rings, or whether the
 * header actually fits — tools/drawer-head-check.mjs runs in a browser for
 * that, and the rest is glass.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

/* --- the smallest DOM createDrawer can run against ------------------------ */

const noop = () => {};

function stubEl(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    hidden: false,
    innerHTML: '',
    textContent: '',
    scrollTop: 0,
    dataset: {},
    attrs: {},
    children: [],
    focusCount: 0,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    appendChild(c) { this.children.push(c); return c; },
    /* ==> LISTENERS ARE RECORDED RATHER THAN DROPPED. <== They were `noop`
     * while every control in this header was a button the suite could reach by
     * calling the drawer's own API. The whole HEADER became a press target for
     * a minimising view (§57.21b), and there is no API for "the reader tapped
     * the bar" — so a stand-in that swallowed the listener would let that
     * behaviour be deleted with the suite still green, which §12 calls worse
     * than no test. */
    addEventListener(type, fn) {
      (this.on ||= {})[type] ||= [];
      this.on[type].push(fn);
    },
    fire(type, e = {}) { for (const fn of (this.on?.[type] || [])) fn(e); },
    /* Enough of one for `e.target.closest('button')`. A press that lands on a
     * real control has to be left alone, and the default here is the ordinary
     * case: a press on the bar itself, which is on no button at all. */
    closest: () => null,
    querySelectorAll: () => [],
    focus() { this.focusCount++; lastFocused = this; },
  };
  return el;
}

/** What `root.querySelector` answers after the header string is written. The
 *  seven names are the drawer's contract with its own markup; if one is
 *  renamed in drawer.js and not here, this suite throws on a null rather than
 *  passing silently, which is the right way round — and it did exactly that
 *  when `.drawer-head` was added, which is why this list is seven now. */
function drawerRoot() {
  const parts = {
    '.drawer-back': stubEl('button'),
    '.drawer-back-text': stubEl('span'),
    '.drawer-eyebrow': stubEl('span'),
    '.drawer-close': stubEl('button'),
    '#drawer-title': stubEl('div'),
    /* The header itself. A view that MINIMISES dismisses on a press anywhere
     * across it (§57.21b), so the drawer binds a listener here. */
    '.drawer-head': stubEl('header'),
    '#drawer-views': stubEl('div'),
  };
  const root = stubEl('aside');
  root.querySelector = (sel) => {
    const hit = parts[sel];
    if (!hit) throw new Error(`[test-drawer-nav] unstubbed selector: ${sel}`);
    return hit;
  };
  root.parts = parts;
  return root;
}

let lastFocused = null;

/* ==> `documentElement` IS REAL ENOUGH TO READ AN ATTRIBUTE OFF. <== The
 * drawer publishes its open state at the root as well as on its own element,
 * because `#storm-pill` sits BEFORE `#drawer` in the markup and CSS cannot
 * select backwards past a sibling. A stub without this made the drawer throw
 * on every navigation — and the right fix was here rather than a guard in the
 * app: `document.documentElement` cannot be absent in a browser, so guarding
 * it would only have hidden the next stub that forgot it. */
const docEl = stubEl('html');
globalThis.document = {
  documentElement: docEl,
  createElement: (tag) => stubEl(tag),
  addEventListener: noop,
  getElementById: () => null,
};

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { createDrawer, clusterAction, SIDE_TRIP_VIEWS } =
  await import('../ui/drawer.js');

/* --- 1. clusterAction ------------------------------------------------------
 * The whole rule as a table. Read the third column as the sentence it is: a
 * destination always starts over; a side trip lands on top of what you were
 * reading; a side trip onto another side trip is a change of mind, not a step.
 * -------------------------------------------------------------------------- */
section('clusterAction — what a press of each corner button means');

const CASES = [
  // [pressed,     open,  currentId,   expected, why]
  ['storms',   false, null,        'go',    'drawer shut: every button opens its view as a root'],
  ['layers',   false, null,        'go',    'a side trip pressed with nothing open has nothing to sit on top of'],
  ['settings', false, null,        'go',    'same for Settings'],

  ['storms',   true,  'storms',    'close', 'the button that opened a view also dismisses it'],
  ['layers',   true,  'layers',    'close', 'and that holds for the side trips too'],

  ['layers',   true,  'detail',    'push',  '==> THE ONE THIS SUITE EXISTS FOR. <== Layers from a storm is a side trip and the storm survives it'],
  ['layers',   true,  'storms',    'push',  'the same from the list — Back returns to the list'],
  ['layers',   true,  'home',      'push',  'and from the dashboard'],
  ['settings', true,  'detail',    'push',  'Settings is a side trip on the same terms as Layers'],
  ['settings', true,  'home-setup','push',  'onto a pushed view as well — the stack is a stack, not two levels'],

  ['layers',   true,  'settings',  'swap',  'side trip onto side trip REPLACES: one change of mind, and Back stays one press'],
  ['settings', true,  'layers',    'swap',  'symmetric, or the ceiling depends on which order you pressed them'],

  ['storms',   true,  'detail',    'go',    'Storms is a DESTINATION: pressing it means "show me the list", not "keep the storm underneath"'],
  ['home',     true,  'detail',    'go',    '==> AND HOME MUST NOT PUSH. <== Pressing Home is a fresh ask (the dashboard forgets which storm you stepped to), and a pushed Home loses its eyebrow — the header would name a storm with nothing saying which drawer you are in'],
  ['home',     true,  'layers',    'go',    'still a destination even when what is open is a side trip'],
  ['storms',   true,  'home',      'go',    'two destinations never stack on each other'],
];

for (const [pressed, open, currentId, expected, why] of CASES) {
  const got = clusterAction(pressed, { open, currentId });
  ok(got === expected,
    `press ${pressed} while ${open ? `open on ${currentId}` : 'shut'} => ${expected} (got ${got}) — ${why}`);
}

ok(SIDE_TRIP_VIEWS.has('layers') && SIDE_TRIP_VIEWS.has('settings'),
  'the side trips are Layers and Settings');
ok(!SIDE_TRIP_VIEWS.has('home') && !SIDE_TRIP_VIEWS.has('storms')
   && !SIDE_TRIP_VIEWS.has('detail'),
  '==> AND NOTHING ELSE IS ONE. <== Adding `home` here would look like tidiness and would silently take the dashboard\'s fresh-start behaviour and its eyebrow with it');

/* --- a real drawer, for everything below ---------------------------------- */

/** The shape every view in this suite starts from. Lifted out of `rig` when
 *  the minimising-header cases needed to register one AFTER the rig was
 *  built. */
const plainViewDef = (id, title) => ({ id, title, mount: noop, onEnter: noop });

function rig() {
  const root = drawerRoot();
  const drawer = createDrawer({ root });
  const seen = [];

  const plainView = (id, title) => ({ ...plainViewDef(id, title),
    onEnter: (arg, opts) => seen.push({ id, arg, fresh: opts.fresh }) });

  drawer.register(plainView('storms', 'Storms'));
  drawer.register(plainView('layers', 'Layers'));
  drawer.register(plainView('settings', 'Settings'));
  drawer.register({
    ...plainView('home', 'Home'),
    /* The dashboard titles itself with the storm and puts its own name in the
     * lead slot. Both are reproduced because the eyebrow rule is exactly what
     * a pushed Home would break. */
    titleFor: () => stubEl('div'),
    eyebrow: () => 'Home',
  });
  drawer.register({
    ...plainView('detail', 'Storm'),
    titleFor: (s) => { titleForCalls.push(s?.id ?? null); return stubEl('div'); },
    backLabelFor: (s) => s?.name || null,
  });

  return { root, drawer, seen, parts: root.parts };
}

let titleForCalls = [];

/* --- 2. the stack and its ceiling ----------------------------------------- */
section('the history stack — the documented route, and the ceiling on it');

{
  const { drawer, parts } = rig();
  const erin = { id: 'al052026', name: 'Hurricane Erin' };

  drawer.go('storms', undefined, { from: stubEl('button') });
  ok(!drawer.canGoBack(), 'a root has nowhere to go back to');
  ok(parts['.drawer-back'].hidden, 'and the button is hidden, not merely blank');

  drawer.push('detail', erin);
  ok(drawer.canGoBack(), 'the storm sits on top of the list');

  drawer.push('layers', undefined, { from: stubEl('button') });
  ok(drawer.currentId() === 'layers', 'Layers is showing');
  ok(drawer.canGoBack(), '==> AND BACK EXISTS, WHICH IS THE WHOLE FIX. <== This was `go` until 2026-08-21 and the storm was gone');

  drawer.back();
  ok(drawer.currentId() === 'detail' && drawer.currentArg() === erin,
    'Back lands on THAT STORM\'s detail, not on the list — SPEC-UI §16, finally true');

  drawer.back();
  ok(drawer.currentId() === 'storms', 'and one more press is the list');
  ok(!drawer.canGoBack(), 'which is the bottom');
  ok(drawer.back() === false, 'Back at the bottom is a no-op and REPORTS it — Escape reads this return value to decide between stepping back and dismissing');
}

{
  const { drawer } = rig();
  drawer.go('storms');
  drawer.push('detail', { id: 'x', name: 'Storm X' });
  drawer.push('layers', undefined, { replaceTop: false });
  drawer.push('settings', undefined, { replaceTop: true });

  ok(drawer.currentId() === 'settings', 'Settings replaced Layers');
  drawer.back();
  ok(drawer.currentId() === 'detail',
    '==> ONE PRESS BACK TO THE STORM, NOT TWO. <== Without the swap, four corner buttons that all push is a stack with no ceiling');
}

{
  const { drawer } = rig();
  /* A side trip pressed with the drawer SHUT is a root. Then the other side
   * trip swaps it — and swapping the only entry must not leave an empty stack
   * or a back button pointing at nothing. */
  drawer.go('layers');
  drawer.push('settings', undefined, { replaceTop: true });
  ok(drawer.currentId() === 'settings' && !drawer.canGoBack(),
    'swapping the ROOT leaves a root: you came from nowhere, so there is nowhere to go back to');
}

{
  const { drawer } = rig();
  drawer.go('storms');
  drawer.push('detail', { id: 'a', name: 'A' });
  drawer.push('detail', { id: 'b', name: 'B' });
  ok(drawer.currentArg().id === 'b', 're-pushing the current view swaps its argument');
  drawer.back();
  ok(drawer.currentId() === 'storms',
    'and does NOT stack, or Back would walk through the same panel twice');
}

/* --- 3. the back label ---------------------------------------------------- */
section('the back button carries the previous view\'s NAME');

{
  const { drawer, parts } = rig();
  drawer.go('storms');
  drawer.push('detail', { id: 'al052026', name: 'Hurricane Erin' });
  ok(parts['.drawer-back-text'].textContent === 'Storms',
    'from a storm, Back reads "Storms" — the list, not whichever storm is on screen');

  titleForCalls = [];
  drawer.push('layers');
  ok(parts['.drawer-back-text'].textContent === 'Hurricane Erin',
    '==> FROM LAYERS IT NAMES THE STORM. <== It read "Storm" before `backLabelFor`, which does not say WHICH storm survived the side trip — the entire promise of the side trip');
  ok(parts['.drawer-back'].getAttribute('aria-label') === 'Back to Hurricane Erin',
    'and the screen reader hears the same sentence the sighted reader does');
  ok(titleForCalls.length === 0,
    '==> AND `titleFor` WAS NOT CALLED TO GET IT. <== That function ASSIGNS the detail panel\'s storm from its argument and builds a whole identity node; running it to label a button reaches into a view that is not on screen to produce a string');
}

{
  const { drawer, parts } = rig();
  drawer.go('home');
  ok(parts['.drawer-eyebrow'].hidden === false
     && parts['.drawer-eyebrow'].textContent === 'Home',
    'as a ROOT the dashboard puts its own name in the lead slot, because its title is a storm');

  drawer.push('layers');
  drawer.back();
  ok(parts['.drawer-back'].hidden && parts['.drawer-eyebrow'].textContent === 'Home',
    'and it comes BACK when the side trip is popped — the eyebrow and the back button share one slot and must never both be in it');
}

/* --- 4. focus return (§13) ------------------------------------------------ */
section('focus returns to the control that put you where you are');

{
  const { drawer } = rig();
  const stormsBtn = stubEl('button');
  const layersBtn = stubEl('button');

  drawer.go('storms', undefined, { from: stormsBtn });
  drawer.push('detail', { id: 'a', name: 'A' });   // a row tap: no button
  drawer.push('layers', undefined, { from: layersBtn });

  lastFocused = null;
  drawer.close();
  ok(lastFocused === layersBtn,
    '==> THE SIDE TRIP\'S OWN BUTTON. <== Closing from Layers must not dump focus on the Storms button three steps down; the reader pressed Layers last');
}

{
  const { drawer } = rig();
  const stormsBtn = stubEl('button');
  drawer.go('storms', undefined, { from: stormsBtn });
  drawer.push('detail', { id: 'a', name: 'A' });   // no `from` at all

  lastFocused = null;
  drawer.close();
  ok(lastFocused === stormsBtn,
    'a step opened by a ROW TAP has no button of its own, so the lookup walks DOWN to the nearest one that does rather than dropping focus at the top of the document');
}

{
  const { drawer } = rig();
  drawer.go('storms');
  lastFocused = null;
  drawer.close({ restoreFocus: false });
  ok(lastFocused === null, 'and a caller can opt out when it is moving focus itself');
}

/* --- 5. `fresh` is still only `go` ---------------------------------------- */
section('`fresh` — the difference between opening a view and returning to one');

{
  const { drawer, seen } = rig();
  drawer.go('home');
  ok(seen.at(-1).fresh === true, 'a destination press is a fresh ask: the dashboard starts over');

  drawer.push('layers');
  drawer.back();
  ok(seen.at(-1).id === 'home' && seen.at(-1).fresh === false,
    '==> BUT COMING BACK FROM A SIDE TRIP IS THE SAME VISIT CONTINUING. <== The dashboard must land on the storm the reader had stepped to, not re-rank from scratch');
}

/* --- 6. the hidden cluster leaves the tab order --------------------------- */
section('the control cluster behind an open sheet is UNTABBABLE, not just invisible');

/**
 * ==> A CSS FACT, ASSERTED FROM A NODE SUITE, AND THE LIMITS ARE STATED. <==
 * This proves the DECLARATION exists. It cannot prove the cascade resolves the
 * way the file reads, cannot prove the delay lines up with the fade, and cannot
 * prove a real Tab press stops there — that is a browser, and this app's
 * browser checks cannot load the real page because the basemap is blocked from
 * the sandbox. So it is a floor, not a ceiling.
 *
 * IT IS WORTH HAVING ANYWAY BECAUSE THE BUG IT GUARDS IS INVISIBLE FROM BOTH
 * SIDES. `opacity: 0` plus `pointer-events: none` looks completely correct to
 * anyone reading the rule and to anyone looking at the screen: the buttons are
 * gone. They were still in the tab order and still in the accessibility tree,
 * so a keyboard user with a storm open could Tab out of the sheet into an
 * invisible Layers button and press it, and a screen reader read all four
 * aloud. Nothing about that surfaces on glass unless you happen to be doing a
 * keyboard pass at phone width with the drawer open, which is what §13 already
 * exists to stop anyone having to remember.
 */
const panelsCss = readFileSync(path.join(ROOT, 'ui/panels.css'), 'utf8');

/** The body of the first rule whose selector contains `needle`. */
function ruleBody(css, needle) {
  const at = css.indexOf(needle);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return open < 0 || close < 0 ? null : css.slice(open + 1, close);
}

const openCluster = ruleBody(panelsCss, '#drawer[data-open="true"] ~ #controls');
ok(openCluster !== null,
  'the rule that hides the cluster behind an open sheet still exists — if this selector was renamed, everything below it is testing nothing');
ok(/visibility:\s*hidden/.test(openCluster || ''),
  '==> AND IT SETS `visibility: hidden`. <== opacity and pointer-events hide four buttons from a finger and a mouse and leave every one of them focusable; this is the same §13 rule the closed drawer itself was fixed for');
ok(/visibility\s+0s\s+linear\s+var\(--duration-base\)/.test(openCluster || ''),
  'flipped AFTER the fade, not during it — the buttons stay visible while they slide away and go untabbable on arrival, which is why this is not just `display: none`');

const baseCluster = ruleBody(panelsCss, '\n  #controls {');
ok(/visibility:\s*visible/.test(baseCluster || '')
   && /visibility\s+0s\s+linear\s+0s/.test(baseCluster || ''),
  'and coming BACK is instant, so the cluster is focusable the moment it starts moving rather than a quarter-second after it arrives');


/* --- one header, one X ----------------------------------------------------
 *
 * ==> THIS SECTION USED TO ASSERT THE OPPOSITE. <== §57.21b items 5 and 6 gave
 * the archive's drawer a minimise CHEVRON and a header that dismissed on a
 * press anywhere across it. Aaron reversed both on glass, 2026-08-28: the
 * hover highlight that advertised the press read as wrong, and the press could
 * not stay without it — a surface that dismisses on a tap and gives no sign it
 * will is the hidden gesture §13 forbids. What is asserted now is that no view
 * can opt out of the X.
 * ------------------------------------------------------------------------ */
section('every header is a title and an X, and a press across it does nothing');

{
  const { drawer, parts } = rig();
  drawer.register(plainViewDef('archive', 'Past storms'));

  drawer.go('storms', undefined, { from: stubEl('button') });
  parts['.drawer-head'].fire('click', { target: stubEl('span') });
  ok(drawer.isOpen(),
    'a press across an ordinary view\'s header does nothing');

  drawer.go('archive', undefined, { from: stubEl('button') });
  parts['.drawer-head'].fire('click', { target: stubEl('span') });
  ok(drawer.isOpen(),
    '==> AND NEITHER DOES A PRESS ON THE ARCHIVE\'S <== — that is the reversal');
}

/* --- report -------------------------------------------------------------- */
if (failures.length) {
  console.log(`\n✗ ${failures.length} failed:`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (the model and the stack — whether the header FITS is tools/drawer-head-check.mjs, and how it feels is glass)');
