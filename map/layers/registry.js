/**
 * registry.js — the selection- and ambient-layer engine (SPEC §7, §9).
 *
 * The layer system takes an arbitrary number of layers; there is no cap.
 * Each layer lives in its own file, declares its own type, and registers
 * itself here at import time. ADDING A LAYER LATER MEANS ADDING A FILE,
 * never editing this engine — that is the contract.
 *
 * TWO PRESENTATIONS OF THE SAME GEOMETRY (§9 zoom ladder):
 *  - AMBIENT: every warmed storm's geometry, no tap required.
 *  - SELECTED: the tapped storm's geometry.
 *  The selected storm is EXCLUDED from the ambient collections so its
 *  geometry never draws twice.
 *
 * THE TWO PRESENTATIONS NOW RENDER IDENTICALLY. Selection used to override
 * a zoom ladder that held ambient geometry back to z4; ambient line and
 * point geometry no longer carries a floor at all, because the MapLibre
 * crossfade (GLOBE3D zSpace..zHandoff) is the real gate — the canvas is
 * transparent in deep space, so geometry materializes with the map instead
 * of popping at a threshold. Selection therefore changes WHICH SOURCE a
 * storm's features ride and nothing about when they draw.
 *
 * ZOOM.ambientGeometry still gates the two layers that genuinely need a
 * hard floor: forecast time labels and the watch/warning coastal stripe.
 * Text and stripes read badly at partial opacity over the cage; lines and
 * dots do not.
 *
 * A layer definition:
 *   {
 *     key:    'cone',                 // matches the geometry bundle slot
 *     type:   'baseline'|'additive',
 *     order:  10,                     // z-order, low = bottom
 *     ensure(map, beforeId),          // create sources/layers, idempotent
 *     update(map, storm, bundle),     // the SELECTED storm changed
 *     clear(map),                     // selection closed — empty sel data
 *     updateAmbient?(map, features),  // ambient feature set changed
 *     setVisible?(map, on),           // additive toggle hook
 *   }
 *
 * Imports: nothing (definitions import config/lib themselves).
 */

const defs = [];

export function registerLayer(def) {
  defs.push(def);
  defs.sort((a, b) => a.order - b.order);
}

/** The overlays sit UNDER the storm dots — the glyph is the storm, the
 *  geometry is context, and a cone over a dot would mute the severity color
 *  that carries the whole design (§6). */
const MARKER_ANCHOR = 'storm-dot-planet';

export function createLayerEngine(map) {
  let attached = false;
  const ambient = new Map(); // stormId -> geometry bundle
  let selectedId = null;

  function attach() {
    if (attached) return;
    const beforeId = map.getLayer(MARKER_ANCHOR) ? MARKER_ANCHOR : undefined;
    for (const d of defs) d.ensure(map, beforeId);
    attached = true;
    recomputeAmbient();
  }

  /** Merge every warmed bundle's features for one layer key, excluding the
   *  selected storm (its features ride the selection layers at full zoom
   *  range — ambient would double-draw them). */
  function ambientFeatures(key) {
    const out = [];
    for (const [id, bundle] of ambient) {
      if (id === selectedId) continue;
      const slot = bundle?.layers?.[key];
      if (slot?.status === 'ok' && slot.fc?.features) out.push(...slot.fc.features);
    }
    return out;
  }

  function recomputeAmbient() {
    if (!attached) return;
    for (const d of defs) {
      if (d.updateAmbient) d.updateAmbient(map, ambientFeatures(d.key));
    }
  }

  return {
    /** Call once the style exists (style.load — never `load`; a basemap
     *  outage must not blind the storm layers, SPEC §5/§12). */
    attach,

    /** A warmed bundle arrived (or refreshed) for one storm. */
    ambientBundle(storm, bundle) {
      ambient.set(storm.id, bundle);
      recomputeAmbient();
    },

    /** Drop ambient geometry for storms no longer in the feed — a dissolved
     *  storm's cone must not linger as confident ambient detail. */
    ambientPrune(liveIds) {
      let changed = false;
      for (const id of [...ambient.keys()]) {
        if (!liveIds.has(id)) { ambient.delete(id); changed = true; }
      }
      if (changed) recomputeAmbient();
    },

    /** The SELECTED storm's bundle — full set, any zoom. */
    setBundle(storm, bundle) {
      attach();
      selectedId = storm.id;
      for (const d of defs) d.update(map, storm, bundle);
      recomputeAmbient(); // selected storm leaves the ambient collections
    },

    /** Selection closed. Ambient stays — it is ladder-governed detail, not
     *  selection state. The formerly-selected storm rejoins ambient. */
    clearSelection() {
      if (!attached) return;
      selectedId = null;
      for (const d of defs) d.clear(map);
      recomputeAmbient();
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
