#!/usr/bin/env node
/**
 * test-seasons-pill.mjs — the only way out of the archive. §57.37, §57.38.
 *
 *   node tools/test-seasons-pill.mjs
 *
 * ==> THIS CONTROL IS THE WHOLE OF THE EXIT, AND THAT IS WHY IT HAS ITS OWN
 * SUITE. <== `attachEscape` in main.js steps the drawer back and then closes
 * it; it never leaves the archive, and `leaveSeasons()` has no caller. So a
 * pill that renders without a handler, or renders its chevron and forgets its
 * words, is a reader on a sepia globe whose only remaining move is a reload.
 *
 * ==> AND THE WORDS ARE THE ASSERTION, NOT DECORATION. <== Aaron's call,
 * 2026-08-28: it names where the tap LANDS rather than where the reader is
 * standing, because a bare chevron cannot answer "back to what" — the fault
 * `ui/drawer.js` records costing a glass pass on 2026-08-12. A pill reading
 * `Past storms` would be the version that was rejected, and it would look
 * completely correct.
 *
 * Zero dependencies, plain node. The DOM below is a lookup table and is honest
 * about being one: `createElement`, `createElementNS`, `append`, one listener.
 */

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };
const eq = (what, got, want) => ok(
  `${what}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`,
  got === want
);

/* ---------------------------------------------------------------------------
 * THE SMALLEST DOM `seasons/pill.js` CAN RUN AGAINST.
 * ------------------------------------------------------------------------ */
function fakeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    className: '',
    id: '',
    type: '',
    textContent: '',
    attrs: {},
    children: [],
    parent: null,
    focused: 0,
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    append(...kids) { for (const k of kids) { this.children.push(k); k.parent = this; } },
    appendChild(kid) { this.append(kid); return kid; },
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    focus() { this.focused += 1; },
    click() { for (const fn of this.listeners.click || []) fn({ target: this }); },
    find(cls) {
      for (const c of this.children) {
        if (c.className === cls || c.getAttribute?.('class') === cls) return c;
        const hit = c.find?.(cls);
        if (hit) return hit;
      }
      return null;
    },
  };
  return el;
}

const body = fakeEl('body');
globalThis.document = {
  body,
  createElement: (t) => fakeEl(t),
  createElementNS: (_ns, t) => fakeEl(t),
};

const { createSeasonsPill, LIVE_LABEL } = await import('../seasons/pill.js');

/* ---------------------------------------------------------------------------
 * 1. IT IS A REAL BUTTON.
 *
 * §13 — tap, click and keyboard on ONE path. A `<div>` with a click listener
 * is a control a keyboard user cannot reach, and this is the one control in
 * the whole mode where that means stranded rather than inconvenienced.
 * ------------------------------------------------------------------------ */

const leaves = [];
const pill = createSeasonsPill({ onLeave: () => leaves.push(1) });

eq('the way out is a real button', pill.el.tagName, 'BUTTON');
eq('and it is typed, so it cannot submit anything', pill.el.type, 'button');
eq('with the id the tap-blocking set names', pill.el.id, 'seasons-pill');

/* ---------------------------------------------------------------------------
 * 2. IT NAMES THE DESTINATION.
 *
 * ==> THE ASSERTION THIS FILE EXISTS FOR. <== Naming the current place instead
 * would leave the action unlabelled, and the pill would look perfect.
 * ------------------------------------------------------------------------ */

const text = pill.el.find('seasons-pill-text');
ok('the words are on screen, not only in the label', !!text);
eq('==> AND THEY NAME WHERE THE TAP LANDS <==', text?.textContent, 'Live storms');
eq('which is the exported label, so nothing can say it twice differently',
  text?.textContent, LIVE_LABEL);

ok('==> IT IS NOT THE NAME OF THE PLACE THE READER IS ALREADY IN <==',
  !/past storms/i.test(text?.textContent || ''));

/* ---------------------------------------------------------------------------
 * 3. THE CHEVRON IS DECORATION AND SAYS SO.
 *
 * The button's own label already carries the meaning. A chevron announced as
 * well is a screen reader reading the control's name and then describing its
 * ornament.
 * ------------------------------------------------------------------------ */

const chevron = pill.el.find('seasons-pill-chevron');
ok('there is a chevron', !!chevron);
eq('and it is a chevron rather than a letter', chevron?.tagName, 'SVG');
eq('hidden from the accessibility tree', chevron?.getAttribute('aria-hidden'), 'true');
ok('drawn as a path rather than left empty',
  (chevron?.children || []).some((c) => c.tagName === 'PATH' && c.getAttribute('d')));

/* ==> AND IT IS THE SAME CHEVRON `ui/drawer.js` DRAWS. <== Two slightly
 * different back arrows on one screen is the ambiguity that grammar exists to
 * remove. Read off the shipped module rather than restated here, or this
 * assertion is a copy agreeing with a copy. */
{
  const fs = await import('node:fs');
  const drawerJs = fs.readFileSync('ui/drawer.js', 'utf8');
  const pillJs = fs.readFileSync('seasons/pill.js', 'utf8');
  const d = pillJs.match(/CHEVRON_D\s*=\s*'([^']+)'/)?.[1];
  ok('the pill declares a chevron path', !!d);
  ok('==> AND IT IS THE ONE THE DRAWER\'S BACK BUTTON USES <==',
    !!d && drawerJs.includes(d));
}

/* ---------------------------------------------------------------------------
 * 4. THE LABEL SAYS IT IS A WAY BACK.
 *
 * `Live storms` alone names a destination but not that pressing it goes there.
 * A sighted reader gets that from the chevron; a screen-reader user gets it
 * from here or not at all.
 * ------------------------------------------------------------------------ */

const label = pill.el.getAttribute('aria-label') || '';
ok('the label exists', !!label);
ok('==> AND IT SAYS BACK, WHICH THE VISIBLE WORDS DO NOT <==', /back/i.test(label));
ok('and it names the live globe rather than a bare direction',
  /live globe/i.test(label));

/* ---------------------------------------------------------------------------
 * 5. PRESSING IT ACTUALLY LEAVES.
 *
 * ==> A PILL WIRED TO NOTHING IS PIXEL-IDENTICAL TO A WORKING ONE. <== Every
 * assertion above passes over a button with no listener on it.
 * ------------------------------------------------------------------------ */

eq('nothing has happened yet', leaves.length, 0);
pill.el.click();
eq('==> PRESSING IT LEAVES <==', leaves.length, 1);
pill.el.click();
eq('and it is not a one-shot — a second press asks again', leaves.length, 2);

/* A pill built with no handler must not throw. `leave()` runs from a button
 * and from the error route, and a throw here would strand somebody in sepia. */
{
  const bare = createSeasonsPill({});
  let threw = false;
  try { bare.el.click(); } catch { threw = true; }
  ok('a pill with no handler is inert rather than explosive', !threw);
}

/* ---------------------------------------------------------------------------
 * 6. MOUNT AND UNMOUNT ARE SYMMETRICAL.
 *
 * Leaving runs entry backwards. A pill left behind on the live globe is a
 * button offering to take you somewhere you already are.
 * ------------------------------------------------------------------------ */

eq('not on screen until mounted', body.children.length, 0);
pill.mount();
eq('mounting puts it on screen', body.children.length, 1);
pill.unmount();
eq('==> AND UNMOUNTING TAKES IT OFF AGAIN <==', body.children.length, 0);

/* Unmounting twice happens: `leave()` guards against re-entry but the error
 * route can reach it from a half-built session. */
{
  let threw = false;
  try { pill.unmount(); } catch { threw = true; }
  ok('unmounting twice is safe', !threw);
}

/* ---------------------------------------------------------------------------
 * 7. IT CAN TAKE FOCUS.
 *
 * Not used on entry — the drawer opens with the archive and lands focus on the
 * wall, which is what a reader came for. This exists for the path where the
 * drawer did not open and the pill is the only thing on screen.
 * ------------------------------------------------------------------------ */

eq('nothing has focused it', pill.el.focused, 0);
pill.focus();
eq('and it takes focus when asked', pill.el.focused, 1);

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} assertions pass — the archive has exactly one way out and it says where it goes`);
