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
 *     type:   'baseline'|'additive'|'pair',
 *     pairId: 'windField',            // pair members only — matches the manifest
 *     order:  10,                     // z-order, low = bottom
 *     ensure(map, beforeId),          // create sources/layers, idempotent
 *     update(map, storm, bundle),     // the SELECTED storm changed
 *     clear(map),                     // selection closed — empty sel data
 *     updateAmbient?(map, features),  // ambient feature set changed
 *     setVisible?(map, on),           // additive toggle hook
 *     setPair?(map, value),           // exclusive-pair segment hook
 *   }
 *
 * A PAIR MEMBER MAY CHANGE ITS OWN `key`. Both segments of a pair are one
 * definition reading different bundle slots, so `key` names the slot in play
 * rather than being fixed at registration — see the setPair note below.
 *
 * Imports: nothing (definitions import config/lib themselves).
 */

const defs = [];

export function registerLayer(def) {
  defs.push(def);
  defs.sort((a, b) => a.order - b.order);
}

/** The overlays sit UNDER the storm's hit target and its name label.
 *
 *  This used to read "the glyph is the storm, the geometry is context" and
 *  justified keeping cones off the spiral. THE MAPLIBRE SPIRAL IS RETIRED
 *  (2026-07-24) — the 3D node mesh owns it, and drawing it in both engines
 *  put two copies on screen through the whole crossfade band. At map zooms
 *  the GEOMETRY IS NOW THE STORM: track, cone, wind field, and the forecast
 *  points whose first dot sits on the current position carrying the category
 *  color and code. `storm-dot-planet` survives as a transparent hit target,
 *  so the anchor still keeps overlays below selection and labels. */
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

    /**
     * Forget that we ever attached, so the next `attach()` rebuilds every
     * layer from scratch.
     *
     * THE ONE CALLER IS A THEME CHANGE. `map.setStyle` replaces the entire
     * style object, which takes every source and layer this engine added with
     * it — but `attached` is a flag in JS, not a fact about the map, so it
     * would still say true and `attach()` would return early, leaving the
     * storm geometry gone from a map that thinks it is drawn. Silently. That
     * is a §5 failure of the worst kind: a live storm not on screen.
     *
     * Ambient bundles and the selected id are KEPT. They are data, not
     * drawing, and re-fetching them for a colour change would be a network
     * round trip to redraw something already in memory.
     */
    invalidate() {
      attached = false;
    },

    /** A warmed bundle arrived (or refreshed) for one storm.
     *
     *  Attaches like every other public entry point. Without this,
     *  `recomputeAmbient()` returns early when geometry arrives before the
     *  first selection and the bundle sits stored but undrawn until
     *  something else attaches. In practice main.js attaches on style.load
     *  so the window is small — but "small window" is how a layer that only
     *  ever draws ambiently (the wind field) would come up blank on a fast
     *  feed, and the store would look correct while the map stayed empty. */
    ambientBundle(storm, bundle) {
      attach();
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

    /**
     * Exclusive pairs (§7). A pair layer owns BOTH segments in one
     * definition rather than registering twice — two definitions would mean
     * two sources drawing into the same map space, and keeping exactly one
     * of them empty is precisely the "looks single-choice" convention that
     * data/layer-prefs.js exists to replace with a guarantee.
     *
     * A pair member may change its `key` when the segment switches (it names
     * the bundle slot being read), so ambient is recomputed AFTER the hook —
     * the merge must run against the new key, not the old one.
     */
    setPair(pairId, value) {
      attach();
      let changed = false;
      for (const d of defs) {
        if (d.pairId === pairId && d.setPair) {
          d.setPair(map, value);
          changed = true;
        }
      }
      if (changed) recomputeAmbient();
    },
  };
}
