/**
 * settings-prefs.js — THE ONE OWNER OF DISPLAY SETTINGS (SPEC §16).
 *
 * Display preferences that are not layer choices:
 *   - `meshHeight` — whether the cage lifts over each storm's current position
 *     only, or follows its whole track (§9).
 *   - `imageryRadiusKm` / `imageryFade` — the size and edge softness of the
 *     satellite disc drawn around each eye (§4).
 *
 * TWO KINDS OF SETTING LIVE HERE, enumerated and numeric-range, and they share
 * one table and one setter. Splitting them would mean two copies of the
 * load-sanitise-persist-emit rules, and the second copy is where the drift
 * starts.
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

import { IMAGERY, STORAGE_KEY, UNITS, GLOBE } from '../config/constants.js';

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
  /* DEFAULTS TO FULL TRACK as of 2026-07-25. It shipped defaulting to CURRENT
   * on the reasoning that the ridge is more on screen at all times and more is
   * not automatically better. Lived with through a real basin, the opposite is
   * true: a lone spike says how strong a storm is and nothing about where it
   * came from or where it is going, which is the question people actually
   * have. The whole-track ridge answers both at a glance, and the spiral still
   * marks the present position so nothing is ambiguous. */
  meshHeight: Object.freeze({
    values: Object.freeze([MESH_HEIGHT.CURRENT, MESH_HEIGHT.TRACK]),
    fallback: MESH_HEIGHT.TRACK,
  }),

  /**
   * UNITS — auto, imperial, or metric.
   *
   * AUTO IS THE DEFAULT AND IS A REAL VALUE, not a synonym for one of the
   * other two. It is stored as `auto` and resolved against the device locale
   * at every render (lib/units.js `resolveSystem`), so a phone that travels,
   * or a browser whose locale changes, follows along without the stored
   * preference going stale and silently wrong.
   *
   * The override exists because auto alone breaks for the American living
   * abroad and a setting alone is a chore for everyone else (§8).
   */
  units: Object.freeze({
    values: Object.freeze([UNITS.AUTO, UNITS.IMPERIAL, UNITS.METRIC]),
    fallback: UNITS.AUTO,
  }),

  /* --- IDLE ROTATION (§9) ---------------------------------------------------
   * These were fixed constants in GLOBE. They are settings now because the
   * right answer is personal: the drift is what makes the globe feel alive to
   * one person and what makes it feel like it will not sit still to another,
   * and neither is wrong. The constants stay as the DEFAULTS — the tuning file
   * still owns what "sensible" means, this store owns what the user chose. */

  /** Whether the globe drifts at all when untouched. */
  autoRotate: Object.freeze({
    values: Object.freeze([true, false]),
    fallback: true,
  }),

  /** Drift speed, degrees of longitude per second. */
  autoRotateSpeed: Object.freeze({
    range: GLOBE.autoRotateSpeedRange,
    fallback: GLOBE.idleRotateDegPerSecond,
  }),

  /** How long after your last interaction the drift resumes, in SECONDS.
   *  Stored in seconds rather than the milliseconds the loop uses, because
   *  the slider and its readout are in seconds and a store that holds one unit
   *  while its control shows another is a conversion waiting to be forgotten
   *  at one of the two call sites. main.js multiplies once. */
  autoRotateDelaySec: Object.freeze({
    range: GLOBE.autoRotateDelayRange,
    fallback: GLOBE.idleResumeDelay / 1000,
  }),

  /* --- NUMERIC RANGES (the two imagery sliders, SPEC §4/§16) ---------------
   * A `range` entry validates by min/max/step instead of by membership. The
   * two kinds live in one table on purpose: `setSetting` stays the only way to
   * change anything, and `load()` stays the only place a stored value is
   * sanitised. A separate numeric store would be a second set of those rules
   * to keep in step.
   *
   * BOUNDS AND DEFAULTS COME FROM config/constants.js, never typed here. The
   * app's tuning numbers live in one file (§Tuning); this store decides
   * PERSISTENCE, not what a sensible radius is.
   * --------------------------------------------------------------------- */

  /** Radius of each storm's imagery disc, in km. */
  imageryRadiusKm: Object.freeze({
    range: IMAGERY.tuning.radiusKm,
    fallback: IMAGERY.discRadiusKm,
  }),

  /** How much of that radius fades out at the rim, as a fraction. Stored as
   *  the FADE WIDTH — the number the slider shows — not as where the fade
   *  begins. lib/imagery-paint.js converts once. */
  imageryFade: Object.freeze({
    range: IMAGERY.tuning.fade,
    fallback: IMAGERY.fadeWidth,
  }),
});

/* CHANGING A DEFAULT DOES NOT CHANGE ANYONE'S CURRENT SETTING, and that is
 * correct rather than a limitation. `load()` merges stored values OVER the
 * defaults, so a device that has ever opened Settings — or ever touched a
 * slider — keeps what it chose. New defaults reach new installs and anyone who
 * taps Reset. If a default ever needs to be forced onto existing devices, that
 * is a migration with a version stamp, not a change to this table. */

/** Snap to the nearest legal step and clamp to the range. A slider cannot
 *  produce an off-step value, but a hand-edited localStorage can, and a value
 *  half a step off would render a control that never sits where it was put. */
function quantise(n, { min, max, step }) {
  if (!Number.isFinite(n)) return null;
  const clamped = n < min ? min : n > max ? max : n;
  const snapped = min + Math.round((clamped - min) / step) * step;
  /* Steps like 0.01 do not survive repeated addition in binary floating point.
   * Rounding to the step's own precision is what keeps 0.42 from becoming
   * 0.42000000000000004 and failing its own equality check on the next read. */
  const decimals = (String(step).split('.')[1] || '').length;
  return Number(snapped.toFixed(decimals));
}

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
    if (def.range) {
      const q = quantise(typeof v === 'number' ? v : Number(v), def.range);
      out[key] = q == null ? def.fallback : q;
    } else {
      out[key] = def.values.includes(v) ? v : def.fallback;
    }
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
  return DEFS[key]?.values ? [...DEFS[key].values] : [];
}

/** `{min, max, step}` for a numeric setting, or null for an enumerated one —
 *  so a slider asks the state layer for its own bounds rather than typing a
 *  second copy that can drift out of step with what `set()` will accept. The
 *  same contract `settingOptions` keeps for segmented controls. */
export function settingRange(key) {
  return DEFS[key]?.range ? { ...DEFS[key].range } : null;
}

/** The shipped default for one setting. Exposed so a Reset button can be
 *  honestly disabled when there is nothing to reset, WITHOUT the view typing a
 *  second copy of the default and drifting from this one. */
export function settingDefault(key) {
  return DEFS[key]?.fallback;
}

/** Back to the shipped default. Returns true if anything changed — a Reset on
 *  an untouched setting must not fire a repaint. */
export function resetSetting(key) {
  const def = DEFS[key];
  if (!def) return false;
  return setSetting(key, def.fallback);
}

/**
 * Set one setting. Returns true if the value was accepted.
 *
 * Enumerated settings reject anything outside their value list. Numeric ones
 * are SNAPPED AND CLAMPED rather than rejected: a slider dragged to the end
 * should land on the end, not silently do nothing, and an out-of-range number
 * is a caller bug the user should not have to feel.
 */
export function setSetting(key, value) {
  const def = DEFS[key];
  if (!def) return false;

  let next = value;
  if (def.range) {
    next = quantise(typeof value === 'number' ? value : Number(value), def.range);
    if (next == null) return false;
  } else if (!def.values.includes(value)) {
    return false;
  }

  if (state[key] === next) return true;
  state = { ...state, [key]: next };
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
