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
    /* Real enough for `add` and `contains`, which is all `seasons/bar.js`
     * uses. It writes through to `className` deliberately: every assertion in
     * this suite reads that string, and a classList that kept its own private
     * set would let the two drift — the element would report one set of
     * classes to the app and another to the test. */
    classList: {
      add(...names) {
        const cur = el.className ? el.className.split(/\s+/) : [];
        for (const n of names) if (!cur.includes(n)) cur.push(n);
        el.className = cur.join(' ');
      },
      contains(n) { return el.className.split(/\s+/).includes(n); },
    },
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
    /* ==> THE BOARD IS A VIEW IN THE ONE DRAWER (§16), SO THE DRAWER IS NOW
     * OPENED RATHER THAN CLOSED ON ENTRY. <== Step 4 closed it, because there
     * was nothing to put in it. `register` is recorded so the suite can prove
     * it happens exactly once across many entries — called twice it leaves an
     * orphaned host and a live listener bound to it. */
    drawer: {
      register: (def) => { calls.push(`drawer.register:${def.id}`); registered.push(def); },
      go: (id) => calls.push(`drawer.go:${id}`),
      close: () => calls.push('drawer.close'),
      isOpen: () => false,
    },
    archiveGlobe: {
      setTracks: (sel) => calls.push(`tracks:${sel.length}`),
      clearTracks: () => calls.push('tracks.clear'),
    },
    recenterAndClear: () => calls.push('recenter'),
  };
}

/** Every view definition the archive registered, across every entry. */
const registered = [];

theme.setThemeMode(theme.MODE.DARK);
const h = harness();
const opener = fakeEl('button');
const handle = openSeasons({ ...h, returnFocusTo: opener });

eq(archive.isArchive(), true, 'the flag is up');
eq(theme.forcedMode(), theme.MODE.SEPIA, 'the palette is forced to sepia');
eq(theme.isLight(), false, 'and sepia is still a dark-ground palette');
ok(h.calls.includes('hide'), 'the live globe was emptied');
ok(h.calls.includes('drawer.go:seasons-board'),
  '==> THE BOARD OPENS ON ENTRY. <== §57.30 step 5. The archive globe is no '
  + 'longer empty, so the drawer is navigated rather than closed');
ok(h.calls.includes('recenter'), 'and the live selection was dropped');
/* ==> COUNTED PER VIEW ID, NOT IN TOTAL. <== This read `=== 1` until step 7
 * added the storm detail panel beside the board, and the total went to two —
 * which is correct and made the assertion fail. The guard's real teeth were
 * never about the total: `drawer.register` appends a host element and stores
 * it under the view's id, so calling it twice for the SAME id leaves an
 * orphaned host in the DOM and a live listener bound to it. The archive can be
 * entered and left many times in one page load, so that is a real risk and
 * this is what catches it. */
{
  const perId = {};
  for (const c of h.calls) {
    if (!c.startsWith('drawer.register:')) continue;
    const id = c.slice('drawer.register:'.length);
    perId[id] = (perId[id] || 0) + 1;
  }
  ok(Object.values(perId).every((n) => n === 1),
    `no view is registered twice (${JSON.stringify(perId)})`);
  ok(perId['seasons-board'] === 1, 'the board is registered, exactly once');
  ok(perId['season-detail'] === 1,
    '==> AND SO IS THE STORM PANEL. <== §57.22. A view the drawer does not '
    + 'know is a `push` that silently does nothing, which is the fault this '
    + "file already caught the board having");
}
eq(docEl.getAttribute('data-seasons'), 'on', 'the chrome knows to move up off the bar');
ok(body.children.some((c) => c.id === 'seasons-bar'), 'the bar is on screen');

const bar = body.children.find((c) => c.id === 'seasons-bar');
const leaveBtn = bar.children.find((c) => c.className === 'seasons-leave');
ok(!!leaveBtn, 'the way out is on screen and is a real button');

/* ==> FOCUS IS THE DRAWER'S JOB NOW, AND THAT IS THE POINT OF PUTTING THE
 * BOARD INSIDE IT (§13). <== Step 4 focused the Leave button by hand, because
 * closing the drawer would otherwise have dropped focus onto the document body
 * with nothing on screen to explain where the reader was. The drawer opens on
 * entry now and lands focus on the board's own `focus()` — the year picker,
 * which is what a reader came here to use. Focusing Leave as well would be two
 * things fighting for the caret. */
ok(!leaveBtn.focused,
  'entry no longer grabs focus by hand — the drawer owns it');

/* ==> THE APOLOGY IS GONE, AND ITS SLOT NOW CARRIES A FACT. <== §57.16a said
 * step 5 DELETES that sentence rather than editing it: a leftover "not built
 * yet" beside a working year picker is worse than the silence it replaced. */
const detail = bar.find('seasons-bar-detail')?.textContent || '';
ok(!/not built yet/.test(detail),
  '==> THE \'NOT BUILT YET\' SENTENCE IS DELETED, NOT EDITED (§57.16a)');

/* And the sentence is a BUTTON now, because closing the board over an archive
 * globe would otherwise leave no way back to the year picker — the storms,
 * home and layers buttons are all hidden in here (§57.16a). */
const where = bar.children.find((c) => (c.className || '').includes('seasons-bar-open'));
ok(!!where, '==> THE BAR\'S SENTENCE IS THE WAY BACK TO THE BOARD <==');
ok(where.tagName === 'BUTTON',
  'and it is a real button, so it is tabbable and answers Enter (§13)');

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

/* ==> THE ARCHIVE'S OWN TRACKS COME OFF, AND THEY COME OFF FIRST. <== §57.30
 * step 5. Leaving with 1935 still drawn puts a historical season over today's
 * storms — one frame of two worlds at once, and it is the frame a reader sees
 * on the way OUT, where there is nothing left to explain it. */
ok(h.calls.includes('tracks.clear'),
  '==> THE ARCHIVE GLOBE IS EMPTIED ON THE WAY OUT <==');
ok(h.calls.indexOf('tracks.clear') < h.calls.indexOf('show'),
  'and before the live storms come back, never after');

eq(docEl.getAttribute('data-seasons'), null, 'the chrome attribute is gone');
ok(!body.children.some((c) => c.id === 'seasons-bar'), 'and so is the bar');
ok(opener.focused > 0, 'focus went back to the row that opened it (§13)');

/* A leave path runs from a button AND from an error route, potentially both.
 * One that threw on the second call would strand somebody in sepia. */
handle.leave();
eq(archive.isArchive(), false, 'leaving twice is safe');

/* ==> RE-ENTERING MUST NOT REGISTER A SECOND BOARD. <== `drawer.register`
 * appends a host element and stores it under the view's id; called twice it
 * leaves an orphaned host in the DOM with a live listener bound to it, and the
 * reader sees the older one. The archive is entered and left freely, so this
 * is an ordinary path rather than an edge case — and a mutation removing the
 * guard passed the whole suite until this existed. */
const second = harness();
const handle2 = openSeasons(second);
eq(second.calls.filter((c) => c.startsWith('drawer.register')).length, 0,
  '==> A SECOND ENTRY REGISTERS NOTHING — the board is built once per load <==');
ok(second.calls.includes('drawer.go:seasons-board'),
  'but it is still navigated to, so the reader lands on the board again');
/* ==> ONE OF EACH, ACROSS EVERY ENTRY IN THE WHOLE PAGE LOAD. <== Step 7 made
 * this two views rather than one, so it is asserted by id: the count that
 * matters is that no id appears twice, not that the total is any particular
 * number. A second copy of either would mean an orphaned host and a live
 * listener bound to a dead element. */
{
  const ids = registered.map((v) => v.id).sort();
  same(ids, ['season-detail', 'seasons-board'],
    'exactly one board and one storm panel have ever been built, across both entries');
}
handle2.leave();

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
