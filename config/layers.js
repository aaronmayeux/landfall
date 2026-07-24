/**
 * layers.js — THE LAYER MANIFEST (SPEC §7).
 *
 * The layer system takes an arbitrary number of layers; there is no cap.
 * Every layer the app can draw is declared HERE, once, and three things read
 * this list: the Layers view (what rows to draw), data/layer-prefs.js (what
 * state to persist and which toggles are mutually exclusive), and main.js
 * (what to hand the render engine). Adding a layer later means adding an
 * entry — never editing the panel, the prefs store, or the engine.
 *
 * WHY A MANIFEST RATHER THAN LAYER FILES DECLARING THEMSELVES:
 * map/layers/*.js already self-register with the RENDER engine, and that
 * stays true. But the panel must show rows for layers that are not built yet
 * — §7's "rows dim, they never disappear": a missing toggle looks like a bug,
 * a dimmed one with a reason is information. A row for an unbuilt layer has
 * no file to register it, so the inventory cannot live in the render layer.
 *
 * THREE TYPES (§7):
 *   'baseline'  — always drawn, no toggle. Listed here for completeness only;
 *                 the panel does not render rows for these.
 *   'pair'      — mutually exclusive siblings fighting for the same map space.
 *                 Rendered as a SEGMENTED CONTROL, never two switches: two
 *                 switches imply both-on is possible.
 *   'additive'  — an independent on/off.
 *
 * `phase` is honesty, not scheduling. A layer whose phase has not shipped
 * renders dimmed with `note` as its reason, and cannot be toggled.
 *
 * Imports: nothing.
 */

/** Panel groups, in render order (§7's three-group sketch). */
export const LAYER_GROUP = Object.freeze({
  STORM: 'storm',
  IMAGERY: 'imagery',
  REFERENCE: 'reference',
});

export const GROUP_LABEL = Object.freeze({
  [LAYER_GROUP.STORM]: 'Storm detail',
  [LAYER_GROUP.IMAGERY]: 'Imagery',
  [LAYER_GROUP.REFERENCE]: 'Reference',
});

/** Which phases have actually shipped. A layer at or below this is live;
 *  above it renders dimmed with its note. ONE place to bump when a step
 *  lands, so no row can claim to work before its data source exists. */
export const SHIPPED_THROUGH = 4;

/**
 * Layers that shipped AHEAD of their phase completing.
 *
 * A phase is not one delivery. Phase 6 is six separate layers arriving over
 * as many passes, so a single `SHIPPED_THROUGH` number cannot describe it:
 * bumping it to 6 the day the wind field lands would also un-dim surge,
 * model tracks, and advisory text, every one of which would then present a
 * working control that draws nothing — the exact §5 failure the dimming
 * exists to prevent.
 *
 * So: the number covers whole finished phases, this set covers early
 * arrivals within an unfinished one. A key here is live regardless of phase.
 *
 * WHEN PHASE 6 IS DONE, bump SHIPPED_THROUGH to 6 and empty this set. It is
 * a bridge, not a permanent second mechanism.
 */
export const SHIPPED_EARLY = Object.freeze(
  new Set([
    /* Phase 6 step 2 — BOTH SOURCES, confirmed on a phone 2026-07-24. §14's
     * both-sources rule is satisfied for this layer: NHC draws a swept
     * envelope, GDACS draws its own published corridor, and the control
     * means the same thing on either. */
    'windCurrent',
    'windSwath',
  ])
);

/* --- exclusive pairs (§7) ---------------------------------------------------
 * Each pair is a segmented control. `neither` gives the group an explicit Off
 * segment — satellite/radar needs one because neither-on is its NORMAL state,
 * unlike the other two pairs where one sibling is always drawn.
 * ------------------------------------------------------------------------ */

export const LAYER_PAIRS = Object.freeze([
  Object.freeze({
    id: 'windField',
    group: LAYER_GROUP.STORM,
    label: 'Wind field',
    neither: false,
    default: 'current',
    options: Object.freeze([
      Object.freeze({ value: 'current', label: 'Current', key: 'windCurrent', phase: 6 }),
      Object.freeze({ value: 'swath', label: 'Full track', key: 'windSwath', phase: 6 }),
    ]),
    /* NO NOTE, deliberately. This used to read "Wind bands are NHC-only for
     * now" and that stopped being true on 2026-07-24, when GDACS bands were
     * confirmed on a phone across all three thresholds. A standing caveat
     * that has been overtaken is worse than none: it tells the user a
     * working layer is broken. Restore a note here only if a source
     * genuinely stops drawing. */
  }),
  Object.freeze({
    id: 'coastal',
    group: LAYER_GROUP.STORM,
    label: 'Coastal',
    neither: false,
    default: 'watchWarning',
    options: Object.freeze([
      Object.freeze({ value: 'watchWarning', label: 'Watch/warning', key: 'watchWarning', phase: 4 }),
      Object.freeze({ value: 'surge', label: 'Surge', key: 'surge', phase: 6 }),
    ]),
    /* Half of this pair is live and half is not, so the note names the part
     * that is missing rather than dimming a working control. */
    note: 'Surge arrives with the surge step.',
  }),
  Object.freeze({
    id: 'imagery',
    group: LAYER_GROUP.IMAGERY,
    label: 'Imagery',
    neither: true,
    default: 'off',
    options: Object.freeze([
      Object.freeze({ value: 'off', label: 'Off', key: null, phase: 1 }),
      Object.freeze({ value: 'satellite', label: 'Satellite', key: 'satellite', phase: 7 }),
      Object.freeze({ value: 'radar', label: 'Radar', key: 'radar', phase: 7 }),
    ]),
    note: 'Satellite and radar arrive in the imagery phase.',
  }),
]);

/* --- additive toggles ---------------------------------------------------- */

export const LAYER_TOGGLES = Object.freeze([
  Object.freeze({
    key: 'forecastTimes',
    group: LAYER_GROUP.STORM,
    label: 'Forecast times',
    /* DEFAULT ON (§7): "when does it get here" is the second question after
     * "how bad is it", and a cone without times is just a shape. The toggle
     * exists for decluttering, not because times are optional. */
    default: true,
    phase: 4,
    /* Pure RENDER toggle — the times ride along in the forecast points
     * GeoJSON already being fetched, so this row can never go amber. */
    fetches: false,
    /* The engine key this drives (map/layers/points-forecast.js). Differs
     * from the pref key, so the mapping is explicit rather than assumed. */
    engineKey: 'forecastPoints',
  }),
  Object.freeze({
    key: 'modelTracks',
    group: LAYER_GROUP.STORM,
    label: 'Model tracks',
    default: false,
    phase: 6,
    fetches: true,
    note: 'Arrives with the model tracks step.',
    /* Expands IN PLACE to a per-model selector (§7) — never a second panel,
     * because §16 allows one view at a time and there is no stack to push. */
    expands: true,
  }),
  Object.freeze({
    key: 'advisoryText',
    group: LAYER_GROUP.STORM,
    label: 'Advisory text',
    default: false,
    phase: 6,
    fetches: true,
    note: 'Arrives with the advisory text step.',
  }),
  Object.freeze({
    key: 'homeMarker',
    group: LAYER_GROUP.REFERENCE,
    label: 'Home marker',
    default: true,
    phase: 3,
    fetches: false,
  }),
  Object.freeze({
    key: 'graticule',
    group: LAYER_GROUP.REFERENCE,
    label: 'Graticule',
    /* Ships OFF (§7): the 3D cage is the planet-band look, so the grid is
     * reference rather than decoration. */
    default: false,
    phase: 1,
    fetches: false,
  }),
]);

/* --- baseline layers (no toggles; inventory completeness only) ------------ */

export const LAYER_BASELINE = Object.freeze([
  Object.freeze({ key: 'stormMarkers', label: 'Storm markers', phase: 2 }),
  Object.freeze({ key: 'cone', label: 'Cone of uncertainty', phase: 4 }),
  Object.freeze({ key: 'pastTrack', label: 'Past track', phase: 4 }),
  Object.freeze({ key: 'forecastTrack', label: 'Forecast track', phase: 4 }),
  Object.freeze({ key: 'forecastPoints', label: 'Forecast points', phase: 4 }),
]);

/* --- helpers -------------------------------------------------------------- */

/**
 * Has this layer shipped? The one place the question is asked.
 *
 * Takes the LAYER ENTRY, not a bare phase number, because the answer now
 * depends on the key as well: a layer named in SHIPPED_EARLY is live even
 * though its phase has not finished. Passing the whole entry also removes a
 * footgun — a bare `phase` and a whole entry would both have "worked" if
 * this took either, and one of them would silently be wrong.
 */
export const isLive = (entry) => {
  if (!entry) return false;
  if (entry.key && SHIPPED_EARLY.has(entry.key)) return true;
  return (entry.phase ?? 99) <= SHIPPED_THROUGH;
};

/** A pair is interactive only if MORE THAN ONE of its options is live —
 *  a segmented control with one usable segment is not a choice (the same
 *  reasoning that hides the scope filter with fewer than two scopes, §16). */
export function pairLiveOptions(pair) {
  return pair.options.filter((o) => isLive(o));
}

/** Groups in panel order, each with its pairs and toggles resolved. The view
 *  renders whatever this returns — it holds no inventory of its own. */
export function layerGroups() {
  return [LAYER_GROUP.STORM, LAYER_GROUP.IMAGERY, LAYER_GROUP.REFERENCE].map(
    (id) => ({
      id,
      label: GROUP_LABEL[id],
      pairs: LAYER_PAIRS.filter((p) => p.group === id),
      toggles: LAYER_TOGGLES.filter((t) => t.group === id),
    })
  );
}

/** Default state for everything, used at first run and by Reset to defaults. */
export function defaultLayerState() {
  const out = {};
  for (const p of LAYER_PAIRS) out[p.id] = p.default;
  for (const t of LAYER_TOGGLES) out[t.key] = t.default;
  return out;
}
