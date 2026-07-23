/**
 * registry.js — the selection-layer engine (SPEC §7).
 *
 * The layer system takes an arbitrary number of layers; there is no cap.
 * Each layer lives in its own file, declares its own type, and registers
 * itself here at import time. ADDING A LAYER LATER MEANS ADDING A FILE,
 * never editing this engine — that is the contract.
 *
 * A layer definition:
 *   {
 *     key:    'cone',                 // matches the geometry bundle slot
 *     type:   'baseline'|'additive',  // exclusive pairs arrive in Phase 6
 *     order:  10,                     // z-order among selection layers,
 *                                     // low = drawn first (bottom)
 *     ensure(map, beforeId),          // create sources/layers, idempotent
 *     update(map, storm, bundle),     // new selection or new geometry
 *     clear(map),                     // selection closed — empty the data
 *     setVisible?(map, on),           // additive toggle hook
 *   }
 *
 * The engine owns lifecycle only: it attaches definitions in z-order beneath
 * the storm markers, fans a geometry bundle out to them, and clears them.
 * What each layer draws is entirely its own business.
 *
 * Imports: nothing (definitions import config/lib themselves).
 */

const defs = [];

export function registerLayer(def) {
  defs.push(def);
  defs.sort((a, b) => a.order - b.order);
}

/** The selection overlay sits UNDER the storm dots — the glyph is the storm,
 *  the geometry is context, and a cone over a dot would mute the severity
 *  color that carries the whole design (§6). */
const MARKER_ANCHOR = 'storm-dot-planet';

export function createLayerEngine(map) {
  let attached = false;

  function attach() {
    if (attached) return;
    const beforeId = map.getLayer(MARKER_ANCHOR) ? MARKER_ANCHOR : undefined;
    for (const d of defs) d.ensure(map, beforeId);
    attached = true;
  }

  return {
    /** Call once the style exists (style.load — never `load`; a basemap
     *  outage must not blind the storm layers, SPEC §5/§12). */
    attach,

    /** Fan a geometry bundle out to every registered layer. */
    setBundle(storm, bundle) {
      attach();
      for (const d of defs) d.update(map, storm, bundle);
    },

    /** Selection closed — every layer empties. Cheap: sources keep their
     *  ids, setData([]) only. */
    clearAll() {
      if (!attached) return;
      for (const d of defs) d.clear(map);
    },

    /** Additive toggles (forecast time labels today). */
    setToggle(key, on) {
      attach();
      for (const d of defs) {
        if (d.key === key && d.setVisible) d.setVisible(map, on);
      }
    },
  };
}
