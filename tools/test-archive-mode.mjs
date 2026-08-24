#!/usr/bin/env node
/**
 * test-archive-mode.mjs — Past storms: the flag, the wall, the link, the doors,
 * and getting back out. §57.16, §57.30 step 4.
 *
 * ZERO DEPENDENCIES, like every other suite here. No browser and no network:
 * the DOM below is a lookup table that is honest about being one, and the only
 * thing it has to be good enough for is a handful of `createElement` calls, an
 * append, and one attribute on `<html>`.
 *
 * ==> THE ASSERTION THIS FILE EXISTS FOR IS THE THIRD SECTION. <== On
 * 2026-08-10 Hurricane Ida turned up as a grey ended storm on the LIVE app,
 * days after a 2021 replay, because `data/lifecycle.js` saved her exactly as
 * designed and had no idea the storm was five years old. Seasons opens that
 * same door on 175 years of storms. Every other section here is worth having;
 * that one is the reason §57.2 lists this as the rule the feature is most
 * likely to break.
 *
 * WHAT IT CANNOT PROVE: that the globe actually empties, that the sepia
 * palette looks right, or that the bar clears the drawer at phone width. Those
 * are `map`, `glass` and `glass` respectively.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
/** `show` keeps a fake DOM node out of a message — the nodes hold a `parent`
 *  back-reference, so JSON.stringify on one is a circular-structure throw that
 *  takes the whole suite down at the FIRST failure rather than reporting it. */
const show = (v) => (v && typeof v === 'object' && v.tagName ? `<${v.tagName.toLowerCase()}>` : JSON.stringify(v));
const eq = (a, b, m) => ok(Object.is(a, b), `${m} (got ${show(a)}, want ${show(b)})`);
const same = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const section = (n) => console.log(`\n  ${n}`);

/* =========================================================================
 * THE SMALLEST DOM `seasons/` CAN RUN AGAINST.
 *
 * It is installed BEFORE any import, because `ui/seasons-door.js` and
 * `seasons/bar.js` call `document.createElement` inside their factories and
 * `config/theme.js` is imported by the entry point.
 * ====================================================================== */
function fakeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    className: '',
    id: '',
    type: '',
    hidden: false,
    textContent: '',
    dataset: {},
    attrs: {},
    children: [],
    parent: null,
    focused: 0,
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    removeAttribute(k) { delete this.attrs[k]; },
    append(...kids) { for (const k of kids) { this.children.push(k); k.parent = this; } },
    appendChild(kid) { this.append(kid); return kid; },
    prepend(kid) { this.children.unshift(kid); kid.parent = this; },
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    focus() { this.focused += 1; },
    /** Fire the handler the component actually registered. */
    click() { for (const fn of this.listeners.click || []) fn({ target: this }); },
    /** Depth-first search by class, for the assertions below. */
    find(cls) {
      for (const c of this.children) {
        if (c.className === cls) return c;
        const hit = c.find?.(cls);
        if (hit) return hit;
      }
      return null;
    },
  };
  return el;
}

const docEl = fakeEl('html');
/* `applyTokens` writes ~40 custom properties onto <html>. Recorded rather than
 * discarded — section 7 asserts that it ran at all. */
docEl.style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
const body = fakeEl('body');
globalThis.document = {
  documentElement: docEl,
  body,
  createElement: (t) => fakeEl(t),
  createElementNS: (_ns, t) => fakeEl(t),
  querySelector: () => null,
};
globalThis.location = { search: '', pathname: '/', hash: '' };
globalThis.history = { state: null, replaceState(_s, _t, url) { this.lastUrl = url; } };
/* config/theme.js and data/lifecycle.js both reach for storage at import. */
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};

const archive = await import('../lib/archive-mode.js');
const deepLink = await import('../seasons/deep-link.js');
const { createSeasonsDoor } = await import('../ui/seasons-door.js');
const { createSeasonsBar } = await import('../seasons/bar.js');
const theme = await import('../config/theme.js');
const { openSeasons } = await import('../seasons/index.js');
const lifecycle = await import('../data/lifecycle.js');
const { SEASONS } = await import('../config/constants.js');
const { createThemeSwitch } = await import('../app/theme-switch.js');

/* =========================================================================
 * 1. THE FLAG
 * ====================================================================== */
section('the flag is one answer, and it tells its subscribers');

eq(archive.isArchive(), false, 'the app starts on the live globe');
let heard = [];
const stopA = archive.subscribeArchive((on) => heard.push(on));
archive.subscribeArchive(() => { throw new Error('bad subscriber'); });
let alsoHeard = 0;
archive.subscribeArchive(() => { alsoHeard += 1; });
/* The throw above is deliberate and its warning is expected output, not a
 * finding — quieted so a real one is visible in a CI log. */
const noisyWarn = console.warn;
console.warn = () => {};

eq(archive.setArchive(true), true, 'entering moves the flag');
eq(archive.isArchive(), true, 'and the flag says so');
eq(archive.setArchive(true), false, 'entering twice is not a second change');
same(heard, [true], 'the subscriber heard exactly one entry');
/* ==> A THROWING SUBSCRIBER MUST NOT STOP THE ONES AFTER IT. <== A
 * half-entered archive — sepia sky with live storms still on it — is worse
 * than a failed entry, which is the contract config/theme.js already keeps. */
eq(alsoHeard, 1, 'a subscriber after a throwing one still ran');

eq(archive.setArchive(false), true, 'leaving moves it back');
eq(archive.setArchive(false), false, 'leaving twice is not a second change');
console.warn = noisyWarn;
stopA();
archive._resetArchiveMode();

/* =========================================================================
 * 2. THE DEEP LINK
 * ====================================================================== */
section('?season= is validated, and a bad year is not an empty season');

same(deepLink.parse('', 2026), null, 'no parameter is no state');
eq(deepLink.reasonFor('', 2026), 'absent', 'and it reports as absent, not as an error');

same(deepLink.parse('?season=2005', 2026), { season: 2005, storms: [] }, 'a plain year');
same(deepLink.parse('?season=2005&storms=katrina,rita,wilma', 2026),
  { season: 2005, storms: ['katrina', 'rita', 'wilma'] }, 'a year and a list');

/* ==> THE ONE THAT IS §5 RATHER THAN PARSING. <== A year outside the record
 * has to be distinguishable from a quiet season, because the globe underneath
 * is empty either way and only the words can tell them apart. */
same(deepLink.parse('?season=1066', 2026), null, '1066 is before the record');
eq(deepLink.reasonFor('?season=1066', 2026), 'out-of-range', 'and it says WHY');
eq(deepLink.reasonFor('?season=banana', 2026), 'malformed', 'a non-year says something else again');
eq(deepLink.reasonFor('?season=', 2026), 'malformed',
  'an empty value is written-and-wrong, not absent — somebody built that URL');
eq(deepLink.reasonFor(`?season=${SEASONS.firstSeason}`, 2026), 'ok', 'the first season itself is legal');

/* The future ceiling. A link made on 31 December in one timezone is opened on
 * 1 January in another, so next year is legal and the year after is not. */
eq(deepLink.reasonFor('?season=2027', 2026), 'ok', 'next year is inside the ceiling');
eq(deepLink.reasonFor('?season=2028', 2026), 'out-of-range', 'the year after is not');

/* The list is cleaned rather than trusted. */
same(deepLink.parse('?season=2005&storms=Katrina,,katrina, RITA ,<script>', 2026).storms,
  ['katrina', 'rita'], 'lowercased, trimmed, deduped, and rubbish dropped');
const many = Array.from({ length: SEASONS.deepLinkMaxStorms + 10 }, (_, i) => `s${i}`).join(',');
eq(deepLink.parse(`?season=2005&storms=${many}`, 2026).storms.length, SEASONS.deepLinkMaxStorms,
  'the list is capped');

/* ==> OTHER PARAMETERS SURVIVE A ROUND TRIP. <== `?replay=ida` is the one that
 * matters: entering the archive from a replay page and coming back out must
 * land on the replay, not on the live app. */
eq(deepLink.toSearch({ season: 2005 }, '?replay=ida'), '?replay=ida&season=2005',
  'the replay parameter is kept on the way in');
eq(deepLink.toSearch({ season: null }, '?replay=ida&season=2005&storms=katrina'), '?replay=ida',
  'and the archive parameters are the only ones removed on the way out');
eq(deepLink.toSearch({ season: null }, ''), '', 'the live app has a clean URL');

/* =========================================================================
 * 3. ==> THE WALL. HISTORY MUST NOT WRITE INTO LIVE STORAGE. (§57.2.) <==
 * ====================================================================== */
section('the ended-storm store refuses to persist while the archive is open');

const KEY = (await import('../config/constants.js')).STORAGE_KEY.ended;

function liveStorm(id, at) {
  return {
    id, name: id.toUpperCase(), source: 'nhc',
    lat: 25, lon: -80, windKt: 65, observedAt: at,
  };
}

lifecycle.resetLifecycle();
storage.clear();
archive._resetArchiveMode();

/* A baseline first: the store DOES write when the app is live. Without this
 * the section below would pass just as well against a store that never writes
 * at all, which is the shape §12 calls worse than no test. */
lifecycle.observeSource('nhc', [liveStorm('al012026', Date.now())]);
ok(storage.has(KEY), 'live: observing a storm persists the registry');

storage.clear();
archive.setArchive(true);
lifecycle.observeSource('nhc', [liveStorm('al022026', Date.now())]);
ok(!storage.has(KEY),
  '==> ARCHIVE: the same call writes NOTHING. This is the Ida bug, walled off.');

archive.setArchive(false);
lifecycle.observeSource('nhc', [liveStorm('al032026', Date.now())]);
ok(storage.has(KEY), 'and leaving puts the store back to work');

lifecycle.resetLifecycle();
storage.clear();
archive._resetArchiveMode();

/* =========================================================================
 * 4. THE DOORS
 * ====================================================================== */
section('two doors, one row builder, and the button is handed back');

let openedFrom = null;
const doorStorms = createSeasonsDoor({ from: 'storms', onOpen: (el) => { openedFrom = el; } });
const doorHome = createSeasonsDoor({ from: 'home', onOpen: () => {} });

eq(doorStorms.tagName, 'BUTTON', 'a door is a real button');
eq(doorStorms.type, 'button', 'and not a submit');
eq(doorStorms.dataset.door, 'storms', 'it knows which door it is');
eq(doorHome.dataset.door, 'home', 'and so does the other one');
ok(doorStorms.find('seasons-door-label')?.textContent === doorHome.find('seasons-door-label')?.textContent,
  'both doors say the same thing — one name for one feature');
ok(/1851/.test(doorStorms.find('seasons-door-note')?.textContent || ''),
  'the note states the scope, which is the reason to press it');

doorStorms.click();
eq(openedFrom, doorStorms,
  '==> THE HANDLER IS HANDED THE BUTTON, so focus can come back to it (§13)');

/* =========================================================================
 * 5. GETTING IN, AND GETTING OUT
 * ====================================================================== */
section('entering and leaving, and everything undone in reverse');

function harness() {
  const calls = [];
  return {
    calls,
    liveGlobe: {
      hide: () => calls.push('hide'),
      show: () => calls.push('show'),
    },
    drawer: { close: () => calls.push('drawer.close'), isOpen: () => false },
    recenterAndClear: () => calls.push('recenter'),
  };
}

theme.setThemeMode(theme.MODE.DARK);
const h = harness();
const opener = fakeEl('button');
const handle = openSeasons({ ...h, returnFocusTo: opener });

eq(archive.isArchive(), true, 'the flag is up');
eq(theme.forcedMode(), theme.MODE.SEPIA, 'the palette is forced to sepia');
eq(theme.isLight(), false, 'and sepia is still a dark-ground palette');
ok(h.calls.includes('hide'), 'the live globe was emptied');
ok(h.calls.includes('drawer.close'), 'the live drawer was closed');
ok(h.calls.includes('recenter'), 'and the selection was dropped');
eq(docEl.getAttribute('data-seasons'), 'on', 'the chrome knows to move up off the bar');
ok(body.children.some((c) => c.id === 'seasons-bar'), 'the bar is on screen');

const bar = body.children.find((c) => c.id === 'seasons-bar');
const leaveBtn = bar.children.find((c) => c.className === 'seasons-leave');
ok(leaveBtn && leaveBtn.focused > 0,
  '==> FOCUS LANDS ON THE WAY OUT (§13), not on the document body');
ok(/not built yet/.test(bar.find('seasons-bar-detail')?.textContent || ''),
  '==> AN EMPTY GLOBE SAYS WHY IT IS EMPTY. An unexplained one reads as broken (§5)');

/* Pressing a door while already in is somebody pressing what they are looking
 * at. It must not build a second bar. */
openSeasons(harness());
eq(body.children.filter((c) => c.id === 'seasons-bar').length, 1, 'no second bar');

/* ==> A SETTINGS CHANGE MADE INSIDE THE ARCHIVE IS THE THEME YOU GET BACK.
 * <== `createThemeSwitch.apply()` runs on EVERY settings change, not just a
 * theme one, so without this rule changing any unrelated setting while the
 * archive is open would drop the sepia globe back to the live palette. */
theme.setThemeMode(theme.MODE.LIGHT);
eq(theme.themeMode(), theme.MODE.SEPIA, 'the archive keeps the screen');

handle.leave();
eq(archive.isArchive(), false, 'the flag is down');
eq(theme.forcedMode(), null, 'nothing is forced any more');
eq(theme.themeMode(), theme.MODE.LIGHT,
  '==> AND IT RESTORED THE PREFERENCE SET WHILE INSIDE, not the one from entry');
ok(h.calls.includes('show'), 'the live globe came back');
eq(docEl.getAttribute('data-seasons'), null, 'the chrome attribute is gone');
ok(!body.children.some((c) => c.id === 'seasons-bar'), 'and so is the bar');
ok(opener.focused > 0, 'focus went back to the row that opened it (§13)');

/* A leave path runs from a button AND from an error route, potentially both.
 * One that threw on the second call would strand somebody in sepia. */
handle.leave();
eq(archive.isArchive(), false, 'leaving twice is safe');

/* =========================================================================
 * 6. A FAILED ENTRY LEAVES
 * ====================================================================== */
section('a throw part-way in does not strand anybody on a sepia empty globe');

theme.setThemeMode(theme.MODE.DARK);
const bad = harness();
bad.liveGlobe.hide = () => { throw new Error('the globe exploded'); };
const quietError = console.error;
console.error = () => {};
const quietWarn = console.warn;
console.warn = () => {};
openSeasons(bad);
console.error = quietError;
console.warn = quietWarn;

/* `hide` is called through the same guard every other teardown step uses, so a
 * throw there is warned about and stepped over rather than aborting entry.
 * What must be true either way is that the app is in ONE of the two states and
 * never between them. */
const stranded = archive.isArchive() && !body.children.some((c) => c.id === 'seasons-bar');
ok(!stranded, '==> NEVER: flag up, no bar, no way out short of a reload');

if (archive.isArchive()) {
  const { leaveSeasons } = await import('../seasons/index.js');
  leaveSeasons();
}
eq(archive.isArchive(), false, 'and it can always be left');
eq(theme.forcedMode(), null, 'with the palette released');

/* =========================================================================
 * 7. ==> FORCING A PALETTE HAS TO ACTUALLY REPAINT. <==
 *
 * This is the bug step 4 found rather than one it introduced. Every repaint in
 * `app/theme-switch.js` used to sit inside `apply()`, behind
 * `if (!setThemeMode(...)) return;` — and `forceMode` does NOT go through
 * `setThemeMode`, because a forced mode has to outrank the stored preference.
 * So entering the archive would have changed `palette()` and repainted
 * NOTHING: the chrome, the 3D globe and the basemap all keeping the live
 * colours, on a globe that had just emptied itself.
 *
 * It fails silently and it looks like a Seasons bug rather than a theme one,
 * which is why it is asserted here rather than left to glass.
 * ====================================================================== */
section('a forced palette repaints the chrome, the globe and the basemap');

theme.setThemeMode(theme.MODE.DARK);
const painted = { state: 0, retheme: 0, guidance: 0 };
const fakeMap = {
  setGlobalStateProperty: () => { painted.state += 1; },
  getStyle: () => ({ layers: [] }),
  getLayer: () => null,
  setPaintProperty: () => {},
};
createThemeSwitch({
  map: fakeMap,
  g3d: { retheme: () => { painted.retheme += 1; } },
  prefersLight: null,
  onRepushGuidance: () => { painted.guidance += 1; },
});

eq(painted.retheme, 0, 'registering a switch repaints nothing (subscribe does not fire)');

const before = { ...painted };
theme.forceMode(theme.MODE.SEPIA);
ok(painted.retheme > before.retheme, 'forcing sepia rethemes the 3D globe');
ok(painted.state > before.state, 'and pushes the basemap colours');
ok(painted.guidance > before.guidance, 'and re-pushes the model guidance');
ok(Object.keys(docEl.style.props).length > 0, 'and rewrote the chrome variables');

const mid = { ...painted };
theme.releaseMode();
ok(painted.retheme > mid.retheme, 'and LEAVING repaints too — the half that is easy to miss');

const still = { ...painted };
theme.forceMode(theme.MODE.DARK);
eq(painted.retheme, still.retheme, 'forcing the mode that is already live repaints nothing');
theme.releaseMode();

/* ---------------------------------------------------------------------- */
if (failures.length) {
  console.log(`\n✗ ${failures.length} failed, ${pass} passed\n`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} archive-mode assertions pass\n`);
