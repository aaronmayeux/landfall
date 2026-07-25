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

import { MODEL_TRACKS, STORAGE_KEY } from '../config/constants.js';
import {
  LAYER_PAIRS,
  LAYER_TOGGLES,
  MODEL_PREF_KEY,
  defaultLayerState,
  defaultModelState,
  isLive,
  pairLiveOptions,
} from '../config/layers.js';

/** Every legal per-model pref name, from the one manifest. TVCN and HCCA
 *  share `consensus`, so this is a Set of prefs and not of techs. */
const MODEL_PREFS = new Set(MODEL_TRACKS.techs.map((m) => m.pref));

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

  /* WHICH MODELS DRAW — a SUB-CHOICE of the model-tracks layer, so it lives
   * inside this record rather than in a store of its own. data/settings-prefs
   * says a third preference store is the moment to extract a shared factory
   * (§12); inventing one for state whose rightful owner already exists would
   * spend that refactor on nothing.
   *
   * NESTED, and everything below that touches state has to know it. The
   * alternative was flattening these into `model.avno` keys alongside the
   * layer keys, which reads fine until `defaultLayerState()` and the manifest
   * loops have to start skipping some keys by prefix — a shape you cannot see
   * from the data. One explicitly nested object is honest about being a
   * different kind of thing. */
  const models = defaultModelState();
  const storedModels = stored[MODEL_PREF_KEY];
  if (storedModels && typeof storedModels === 'object') {
    for (const pref of MODEL_PREFS) {
      /* Unknown prefs are dropped rather than carried: a model removed from
       * the shortlist must not leave a dead switch persisted forever. */
      if (typeof storedModels[pref] === 'boolean') models[pref] = storedModels[pref];
    }
  }
  out[MODEL_PREF_KEY] = models;

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

/* --- per-model selection (§7: the model-tracks row expands in place) ------- */

/**
 * Is one model drawn?
 *
 * Gated on the model-tracks layer itself, not just the model's own switch: if
 * the layer is off or unshipped, no model is drawn, and answering otherwise
 * would let a caller draw a line the user cannot see a control for. The same
 * read-side enforcement `toggleOn` uses.
 */
export function modelOn(pref) {
  if (!toggleOn('modelTracks')) return false;
  return !!state[MODEL_PREF_KEY]?.[pref];
}

/** The raw per-model switches, ignoring whether the layer is on — the
 *  SELECTOR needs this, because its rows must render checked while the user
 *  is looking at them regardless of the parent toggle's state. */
export function modelChecked(pref) {
  return !!state[MODEL_PREF_KEY]?.[pref];
}

/** How many models are switched on. The selector disables the last remaining
 *  one rather than letting a tap be silently refused (see setModel). */
export function modelsOnCount() {
  const models = state[MODEL_PREF_KEY] || {};
  return Object.keys(models).filter((k) => models[k]).length;
}

/**
 * Set one model on or off. Returns true if accepted.
 *
 * REFUSES TO TURN THE LAST ONE OFF. A model-tracks layer switched ON with
 * every model switched OFF draws nothing — a control in a state that looks
 * enabled and produces silence, which is §5's failure wearing two switches.
 * The user who wants nothing drawn has the parent toggle for exactly that,
 * and it says what it does.
 */
export function setModel(pref, on) {
  if (!MODEL_PREFS.has(pref)) return false;
  const models = state[MODEL_PREF_KEY] || {};
  const next = !!on;
  if (!!models[pref] === next) return true;
  if (!next && Object.keys(models).filter((k) => models[k]).length <= 1) return false;
  commit({ ...state, [MODEL_PREF_KEY]: { ...models, [pref]: next } });
  return true;
}

/** Reset to defaults (§7 — "after toggling six things during a landfall you
 *  will want it"). Defaults are already phase-safe by construction. */
export function resetLayers() {
  commit({ ...defaultLayerState(), [MODEL_PREF_KEY]: defaultModelState() });
}

/** True when the current state differs from defaults — the Reset control
 *  uses it to disable itself rather than disappear, so the affordance stays
 *  discoverable (§7: rows dim, they never vanish). */
export function isDefault() {
  const d = defaultLayerState();
  /* The model sub-object needs its own compare: a shallow `===` on two
   * freshly-built objects is always false, which would have left Reset
   * permanently enabled and looking like the app had unsaved state. */
  const models = state[MODEL_PREF_KEY] || {};
  const dm = defaultModelState();
  const modelsMatch = Object.keys(dm).every((k) => !!dm[k] === !!models[k]);
  return (
    modelsMatch &&
    Object.keys(d).every((k) => k === MODEL_PREF_KEY || d[k] === state[k])
  );
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
