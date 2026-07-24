/**
 * layer-prefs.js — THE ONE OWNER OF LAYER STATE (SPEC §7).
 *
 * Layer choices persist per device; STORM SELECTION DOES NOT (§7) — reopening
 * the app restores your layers and drops you on the globe, not on yesterday's
 * dissipated storm. That asymmetry is why layer state lives here, in its own
 * store, rather than riding along with the selection.
 *
 * WHY THIS FILE EXISTS AT ALL: before it, the single shipped toggle (forecast
 * times) was read and written by two hand-rolled functions inside main.js, and
 * the graticule's state lived in a local `let` next to them. Two layers, two
 * different mechanisms, neither persisted the same way. Sixteen layers on that
 * pattern is a drift bug waiting to happen — §12: any pattern used twice gets
 * extracted before the second use.
 *
 * EXCLUSIVE PAIRS ARE ENFORCED HERE, not in the UI. A segmented control that
 * merely LOOKS single-choice is a rendering convention; state that cannot hold
 * two siblings at once is a guarantee. The panel asks for a value, this file
 * decides what is legal.
 *
 * UNSHIPPED LAYERS CANNOT BE TURNED ON. A stored pref from a future build (or
 * a hand-edited localStorage) must not switch on a layer whose data source
 * does not exist — that would show a toggle claiming to draw something that
 * silently draws nothing, which is the §5 "never ship silence on failure"
 * failure wearing a control.
 *
 * Imports: config/ only. No DOM, ever (§12).
 */

import { STORAGE_KEY } from '../config/constants.js';
import {
  LAYER_PAIRS,
  LAYER_TOGGLES,
  defaultLayerState,
  isLive,
  pairLiveOptions,
} from '../config/layers.js';

const listeners = new Set();
let state = load();

/* --- persistence ----------------------------------------------------------
 * Storage can throw (private mode, quota, disabled). Every access is guarded:
 * a device that cannot persist still gets working toggles for the session.
 * ------------------------------------------------------------------------ */

function readRaw() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY.layers)) || {};
  } catch {
    return {};
  }
}

function writeRaw(next) {
  try {
    localStorage.setItem(STORAGE_KEY.layers, JSON.stringify(next));
  } catch {
    /* Session-only. The toggles still work; they just will not survive a
     * reload. Silently degrading is correct HERE because nothing on the map
     * is wrong — only the memory of a preference is lost. */
  }
}

/** Merge stored values over defaults, rejecting anything illegal. Defaults
 *  fill every gap, so a partial or corrupt record can never leave a layer
 *  undefined. */
function load() {
  const stored = readRaw();
  const out = defaultLayerState();

  for (const pair of LAYER_PAIRS) {
    const v = stored[pair.id];
    if (typeof v !== 'string') continue;
    const opt = pair.options.find((o) => o.value === v);
    /* Reject an unknown value, and reject a known one whose phase has not
     * shipped — see the header note. Falls through to the default. */
    if (opt && isLive(opt)) out[pair.id] = v;
  }

  for (const t of LAYER_TOGGLES) {
    const v = stored[t.key];
    if (typeof v !== 'boolean') continue;
    /* An unshipped layer may be stored OFF (harmless) but never ON. */
    if (v && !isLive(t)) continue;
    out[t.key] = v;
  }

  return out;
}

function emit() {
  for (const fn of listeners) {
    try {
      fn(get());
    } catch (e) {
      /* One bad subscriber must not stop the others from updating — a layer
       * left un-drawn because an unrelated listener threw is the kind of
       * silent partial render §5 forbids. */
      console.warn('[landfall] layer-prefs subscriber failed:', e);
    }
  }
}

function commit(next) {
  state = next;
  writeRaw(state);
  emit();
}

/* --- public --------------------------------------------------------------- */

/** A frozen snapshot. Callers cannot mutate the store by accident. */
export function get() {
  return Object.freeze({ ...state });
}

/** Current value of one exclusive pair ('current' | 'swath' | 'off' | ...). */
export function pairValue(pairId) {
  return state[pairId];
}

/** Is an additive toggle on? Always false for an unshipped layer, whatever
 *  is stored — the guarantee is enforced on read as well as on write, so a
 *  caller can trust this without checking the phase itself. */
export function toggleOn(key) {
  const def = LAYER_TOGGLES.find((t) => t.key === key);
  if (!def || !isLive(def)) return false;
  return !!state[key];
}

/**
 * Set an exclusive pair. Returns true if the value was accepted.
 * Rejects unknown values and unshipped options — the control should not
 * offer them, and this is the guarantee behind that convention.
 */
export function setPair(pairId, value) {
  const pair = LAYER_PAIRS.find((p) => p.id === pairId);
  if (!pair) return false;
  const opt = pair.options.find((o) => o.value === value);
  if (!opt || !isLive(opt)) return false;
  if (state[pairId] === value) return true;
  commit({ ...state, [pairId]: value });
  return true;
}

/** Set an additive toggle. Returns true if accepted. */
export function setToggle(key, on) {
  const def = LAYER_TOGGLES.find((t) => t.key === key);
  if (!def) return false;
  if (on && !isLive(def)) return false;
  const next = !!on;
  if (state[key] === next) return true;
  commit({ ...state, [key]: next });
  return true;
}

/** Reset to defaults (§7 — "after toggling six things during a landfall you
 *  will want it"). Defaults are already phase-safe by construction. */
export function resetLayers() {
  commit(defaultLayerState());
}

/** True when the current state differs from defaults — the Reset control
 *  uses it to disable itself rather than disappear, so the affordance stays
 *  discoverable (§7: rows dim, they never vanish). */
export function isDefault() {
  const d = defaultLayerState();
  return Object.keys(d).every((k) => d[k] === state[k]);
}

/**
 * Subscribe to layer state. Fires IMMEDIATELY with current state so a
 * late-arriving surface never waits for the first change — the same contract
 * data/store.js and data/home.js use, so every subscriber in the app behaves
 * the same way.
 */
export function subscribeLayers(fn) {
  listeners.add(fn);
  try {
    fn(get());
  } catch (e) {
    console.warn('[landfall] layer-prefs subscriber failed on registration:', e);
  }
  return () => listeners.delete(fn);
}

/** Which of a pair's options may actually be offered. Re-exported so the view
 *  asks the state layer rather than reaching into config itself. */
export { pairLiveOptions };
