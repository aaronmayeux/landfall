/**
 * settings-prefs.js — THE ONE OWNER OF DISPLAY SETTINGS (SPEC §16).
 *
 * Display preferences that are not layer choices. Today that is exactly one
 * thing: whether the cage lifts over each storm's current position only, or
 * follows its whole track (§9).
 *
 * WHY THIS IS NOT IN data/layer-prefs.js. That store enforces two rules this
 * one must not: an unshipped LAYER can never be switched on, and exclusive
 * pairs are validated against the layer manifest. A display setting has no
 * phase and no manifest. Bolting it onto the layer store would mean either
 * inventing a fake layer entry for it or adding an escape hatch through the
 * guard that store exists to provide — and a guard with an exception is not a
 * guard.
 *
 * THE DUPLICATION IS DELIBERATE AND FLAGGED. The guarded-localStorage /
 * subscribe / emit shape below is the same shape layer-prefs.js uses. Two
 * copies is the honest cost of keeping the two guarantees separate; a THIRD
 * preference store is the moment to extract a shared factory (§12), not
 * before. Written plainly here so that extraction is mechanical when it comes.
 *
 * Imports: config/ only. No DOM, ever (§12).
 */

import { STORAGE_KEY } from '../config/constants.js';

/* ---------------------------------------------------------------------------
 * THE SETTINGS
 *
 * Each entry names its legal values and its default. Anything stored that is
 * not in `values` is rejected on read — a hand-edited localStorage, or a
 * value written by a future build, must never put a surface into a state it
 * has no code path for.
 * ------------------------------------------------------------------------- */

export const MESH_HEIGHT = Object.freeze({
  /** Lift the cage over each storm's current position only. */
  CURRENT: 'current',
  /** Lift it along the whole track — past positions trailing, forecast
   *  positions running ahead, each at its own intensity. */
  TRACK: 'track',
});

const DEFS = Object.freeze({
  /* DEFAULTS TO CURRENT, deliberately. The ridge is more information on the
   * screen at all times, and more is not automatically better on a globe that
   * has to stay readable at a glance on a phone in bad weather. It is opt-in
   * until it has been lived with during a real storm. */
  meshHeight: Object.freeze({
    values: Object.freeze([MESH_HEIGHT.CURRENT, MESH_HEIGHT.TRACK]),
    fallback: MESH_HEIGHT.CURRENT,
  }),
});

const listeners = new Set();
let state = load();

/* --- persistence ----------------------------------------------------------
 * Storage can throw (private mode, quota, disabled). Every access is guarded:
 * a device that cannot persist still gets working settings for the session.
 * ------------------------------------------------------------------------ */

function readRaw() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY.settings)) || {};
  } catch {
    return {};
  }
}

function writeRaw(next) {
  try {
    localStorage.setItem(STORAGE_KEY.settings, JSON.stringify(next));
  } catch {
    /* Session-only. The control still works; the choice just will not survive
     * a reload. Silently degrading is correct HERE because nothing on the map
     * is wrong — only the memory of a preference is lost. */
  }
}

/** Defaults for every key, then stored values merged over the top, then
 *  anything illegal thrown out. A partial or corrupt record can never leave a
 *  setting undefined. */
function load() {
  const stored = readRaw();
  const out = {};
  for (const [key, def] of Object.entries(DEFS)) {
    const v = stored[key];
    out[key] = def.values.includes(v) ? v : def.fallback;
  }
  return out;
}

function emit() {
  for (const fn of listeners) {
    try {
      fn(get());
    } catch (e) {
      /* One bad subscriber must not stop the others from updating — the same
       * contract layer-prefs.js keeps, for the same reason (§5). */
      console.warn('[landfall] settings subscriber failed:', e);
    }
  }
}

/* --- public --------------------------------------------------------------- */

/** A frozen snapshot. Callers cannot mutate the store by accident. */
export function get() {
  return Object.freeze({ ...state });
}

/** Current value of one setting. */
export function settingValue(key) {
  return state[key];
}

/** The legal values for one setting, in display order — so a control asks the
 *  state layer what to render rather than hardcoding its own list and drifting
 *  out of step with what `set()` will actually accept. */
export function settingOptions(key) {
  return DEFS[key] ? [...DEFS[key].values] : [];
}

/**
 * Set one setting. Returns true if the value was accepted.
 * Rejects unknown keys and illegal values — the control should not offer
 * them, and this is the guarantee behind that convention.
 */
export function setSetting(key, value) {
  const def = DEFS[key];
  if (!def || !def.values.includes(value)) return false;
  if (state[key] === value) return true;
  state = { ...state, [key]: value };
  writeRaw(state);
  emit();
  return true;
}

/**
 * Subscribe to settings. Fires IMMEDIATELY with current state so a
 * late-arriving surface never waits for the first change — the same contract
 * data/store.js, data/home.js and data/layer-prefs.js use, so every
 * subscriber in the app behaves the same way.
 */
export function subscribeSettings(fn) {
  listeners.add(fn);
  try {
    fn(get());
  } catch (e) {
    console.warn('[landfall] settings subscriber failed on registration:', e);
  }
  return () => listeners.delete(fn);
}
