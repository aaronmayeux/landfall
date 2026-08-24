/**
 * theme.js — THE ONE OWNER OF WHICH PALETTE IS LIVE.
 *
 * Every file that used to `import { DARK }` now asks this module for the
 * ACTIVE palette instead. That is the whole job: one question, one answer,
 * asked at paint time rather than baked in at import time.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS IN config/ AND HAS NO DOM IN IT.
 *
 * config/ imports nothing but config/ (§12). This module holds STATE and
 * ANSWERS A QUESTION; it does not decide what the user's device prefers and
 * it does not read a preference store. main.js owns both of those — it reads
 * the stored setting, watches `prefers-color-scheme`, and calls
 * `setThemeMode()` with the resolved answer.
 *
 * That split is deliberate. If this module reached into data/settings-prefs.js
 * it would be config/ importing data/, which is a cycle waiting to happen, and
 * if it called `matchMedia` it would be a config file that cannot be imported
 * by a test runner or by tools/contrast-check.mjs.
 *
 * ---------------------------------------------------------------------------
 * AUTO IS RESOLVED, NEVER STORED HERE.
 *
 * `AUTO` is a legal PREFERENCE (see data/settings-prefs.js) but never a legal
 * MODE. By the time a value reaches `setThemeMode` it is 'dark' or 'light' and
 * nothing else — so no drawing code ever has to ask "and what does auto mean
 * right now". A device whose OS theme flips while the app is open follows
 * along because main.js re-resolves and calls back in, not because anything
 * down here re-reads the world.
 *
 * ---------------------------------------------------------------------------
 * SEPIA IS A FORCED MODE, AND IT IS THE OPPOSITE OF A SETTING.
 *
 * `SEPIA` is a legal MODE but never a legal PREFERENCE. It has no entry in
 * data/settings-prefs.js and must never get one. A view that owns a whole
 * visual world — Seasons, and so far only Seasons — calls `forceMode` on the
 * way in and `releaseMode` on the way out.
 *
 * `forceMode` remembers what was live and `releaseMode` puts it back, so the
 * user's own dark/light/auto preference survives a visit to the archive
 * untouched. This module never reads or writes that preference, and forcing a
 * mode does not change it — which is the whole point. Otherwise somebody opens
 * Seasons once and is stuck in sepia on the live globe.
 *
 * `isLight()` stays FALSE in sepia, and that is correct rather than
 * convenient: sepia is a dark-ground palette, and every caller of `isLight()`
 * is asking "is the ground pale", not "which of two themes is this".
 * ------------------------------------------------------------------------- */

import { DARK, LIGHT, SEPIA } from './tokens.js';

/** The three values the SETTING can hold. `AUTO` follows the device. */
export const THEME = Object.freeze({
  AUTO:  'auto',
  DARK:  'dark',
  LIGHT: 'light',
});

/** The values the RESOLVED MODE can hold.
 *
 *  DARK and LIGHT are the two a preference can resolve to. SEPIA is only ever
 *  reached through `forceMode` — `resolveMode` never returns it and
 *  `setThemeMode` refuses it, so no settings write and no OS theme flip can
 *  land the app here by accident. */
export const MODE = Object.freeze({
  DARK:  'dark',
  LIGHT: 'light',
  SEPIA: 'sepia',
});

const PALETTES = Object.freeze({
  [MODE.DARK]:  DARK,
  [MODE.LIGHT]: LIGHT,
  [MODE.SEPIA]: SEPIA,
});

/** The modes a stored preference is allowed to resolve to. Sepia is not one. */
const SELECTABLE = Object.freeze([MODE.DARK, MODE.LIGHT]);

/** The modes `forceMode` will accept. A view forcing 'dark' is legal and
 *  pointless; a view forcing something misspelled must not silently succeed. */
const FORCEABLE = Object.freeze([MODE.DARK, MODE.LIGHT, MODE.SEPIA]);

/* DARK IS THE FLOOR, not just the default. It is what the palette resolves to
 * before main.js has resolved anything, which means the very first frame of a
 * cold boot is the night-sky globe — the app's identity, and the thing a
 * shared link should open on (SPEC §9). A light-mode device gets exactly one
 * frame of this before main.js switches it, and that frame is behind the
 * pre-paint script in index.html anyway. */
let mode = MODE.DARK;

const listeners = new Set();

/**
 * THE ACTIVE PALETTE. Call it, don't cache it.
 *
 * `const P = palette()` held at module scope is the one way to get this wrong:
 * it freezes whatever the theme was when the file was first imported, and the
 * bug shows up as one stubbornly dark layer in an otherwise light app. Call
 * it inside the function that paints.
 */
export function palette() {
  return PALETTES[mode];
}

/**
 * THE ACTIVE THREE.JS MATERIAL OPACITIES. Same contract as `palette()` — call
 * it, don't cache it.
 *
 * Its own function rather than `palette().fx` at the call site for one reason:
 * `map/globe3d.js` reads these seven numbers fourteen times across material
 * construction and the per-frame fade, and a bare `.fx` is the kind of thing
 * that gets hoisted to a module-scope `const FX` on a tidying pass. Naming it
 * like `palette()` makes it look like what it is — a question asked at paint
 * time, not a constant.
 */
export function fx() {
  return PALETTES[mode].fx;
}

/** Resolved mode, 'dark' or 'light'. Never 'auto'. */
export function themeMode() {
  return mode;
}

export function isLight() {
  return mode === MODE.LIGHT;
}

/**
 * Collapse a stored preference against what the device says.
 *
 * `prefersLight` is passed IN rather than read here — see the header. main.js
 * gets it from `matchMedia('(prefers-color-scheme: light)')`.
 *
 * Anything unrecognised resolves to dark. A hand-edited localStorage or a
 * value written by a future build must land somewhere real, and dark is the
 * floor.
 */
export function resolveMode(pref, prefersLight) {
  if (pref === THEME.LIGHT) return MODE.LIGHT;
  if (pref === THEME.DARK) return MODE.DARK;
  return prefersLight ? MODE.LIGHT : MODE.DARK;
}

/**
 * Switch the live palette. Returns true if it actually changed — callers
 * repaint on true and do nothing on false, so a settings write that resolves
 * to the same mode never costs a map restyle.
 */
export function setThemeMode(next) {
  if (!SELECTABLE.includes(next)) return false;

  /* ==> A FORCED MODE OUTRANKS A SETTINGS WRITE, AND THIS LINE IS WHY. <==
   * `createThemeSwitch`'s `apply()` runs on EVERY settings change, not just a
   * theme one, and on every OS theme flip. Without this, changing any unrelated
   * setting while Seasons is open would drop the archive globe back to the live
   * palette mid-session. The forced mode is remembered and restored instead —
   * see `releaseMode`. */
  if (forced !== null) {
    restore = next;
    return false;
  }

  if (next === mode) return false;
  mode = next;
  announce();
  return true;
}

/** Tell every subscriber the palette moved. Extracted so `setThemeMode`,
 *  `forceMode` and `releaseMode` all speak the same way — three copies of this
 *  loop is three places for the try/catch contract below to be forgotten. */
function announce() {
  for (const fn of listeners) {
    try {
      fn(palette(), mode);
    } catch (e) {
      /* One bad subscriber must not stop the others from repainting — a
       * half-themed app is worse than a failed theme change (§5). The same
       * contract data/store.js and data/settings-prefs.js keep. */
      console.warn('[landfall] theme subscriber failed:', e);
    }
  }
}

/* WHICH MODE IS BEING FORCED, and what to go back to when it is released.
 * `forced === null` is the ordinary state and the only one in which
 * `setThemeMode` can move the palette. */
let forced = null;
let restore = null;

/**
 * Force a palette for as long as a view owns the screen. Returns true if the
 * palette actually moved.
 *
 * ==> DOES NOT TOUCH THE STORED PREFERENCE, AND MUST NOT. <== This module
 * cannot reach data/settings-prefs.js and that is deliberate (see the header).
 * Forcing is a runtime override with a lifetime; a preference is the user's.
 *
 * Forcing twice is legal — the second call replaces the first and the ORIGINAL
 * restore target is kept, so a view that forces sepia, then forces it again on
 * a re-entry, still releases back to the theme the user actually chose.
 */
export function forceMode(next) {
  if (!FORCEABLE.includes(next)) return false;
  if (forced === null) restore = mode;
  forced = next;
  if (next === mode) return false;
  mode = next;
  announce();
  return true;
}

/**
 * Give the screen back. Returns true if the palette actually moved.
 *
 * Restores whatever was live when `forceMode` was first called, INCLUDING any
 * settings change or OS theme flip that happened while the view was open —
 * `setThemeMode` kept `restore` current the whole time rather than being
 * ignored outright.
 *
 * Safe to call when nothing is forced. A view's teardown path runs on error
 * routes too, and a release that throws on a double-call is a way to leave
 * somebody in sepia forever.
 */
export function releaseMode() {
  if (forced === null) return false;
  const back = restore ?? MODE.DARK;
  forced = null;
  restore = null;
  if (back === mode) return false;
  mode = back;
  announce();
  return true;
}

/** Which mode is currently being forced, or null. For the view that owns the
 *  forcing and for tests — nothing else should need to ask. */
export function forcedMode() {
  return forced;
}

/**
 * Subscribe to theme changes.
 *
 * DOES NOT FIRE ON REGISTRATION, and that is the opposite of every other
 * subscribe in the app — deliberately. The other stores fire immediately
 * because a late-arriving surface needs the current state. A theme subscriber
 * is a REPAINT, and everything that registers one has just painted itself
 * with `palette()` on the line above. Firing here would mean every surface
 * repaints itself once at boot for nothing, on the one device where that
 * costs a frame.
 */
export function subscribeThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
