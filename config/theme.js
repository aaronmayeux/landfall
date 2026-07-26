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
 * ------------------------------------------------------------------------- */

import { DARK, LIGHT } from './tokens.js';

/** The three values the SETTING can hold. `AUTO` follows the device. */
export const THEME = Object.freeze({
  AUTO:  'auto',
  DARK:  'dark',
  LIGHT: 'light',
});

/** The two values the RESOLVED MODE can hold. */
export const MODE = Object.freeze({
  DARK:  'dark',
  LIGHT: 'light',
});

const PALETTES = Object.freeze({
  [MODE.DARK]:  DARK,
  [MODE.LIGHT]: LIGHT,
});

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
  if (next !== MODE.DARK && next !== MODE.LIGHT) return false;
  if (next === mode) return false;
  mode = next;
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
  return true;
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
