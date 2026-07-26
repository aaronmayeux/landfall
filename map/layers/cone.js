/**
 * cone.js — cone of uncertainty. ADDITIVE, default ON (SPEC §7).
 *
 * Deliberately a neutral veil, not a category-colored shape: severity rides
 * the glyph and the forecast points (§6); the cone's job is extent.
 * Neither presentation carries a zoom floor: the MapLibre crossfade is the
 * gate for both, so a cone fades up with the map whether or not its storm
 * was tapped.
 *
 * WAS BASELINE — NO SWITCH AT ALL — UNTIL 2026-07-25. It defaults on and
 * always will; what earned it a toggle is the AMBIENT presentation. One cone
 * is the answer to "where is this going". Six overlapping translucent cones
 * are a milky film over the coastline you are trying to read the track
 * against. See the manifest entry in config/layers.js.
 */

import { STORM_GEO } from '../../config/tokens.js';
import { palette } from '../../config/theme.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-cone';
const AMB_SOURCE = 'amb-cone';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** Every layer id this definition owns — both presentations, fill and line.
 *  Listed once so `setVisible` cannot miss one and leave, say, the ambient
 *  outline drawn over a hidden fill. */
const LAYER_IDS = ['amb-cone-fill', 'amb-cone-line', 'sel-cone-fill', 'sel-cone-line'];

/** Held across `ensure`, for the same reason model-tracks.js holds its own:
 *  the engine may call `setVisible` before or after the layers exist, and a
 *  layer whose visibility depends on which message landed first is a bug that
 *  only shows up on a slow connection.
 *
 *  Seeded TRUE because this layer ships on — the opposite of model tracks. A
 *  false seed would blank every cone for the frames between style load and the
 *  first `applyLayerState`, which is a visible flash of the app's most
 *  important shape going missing. */
let visible = true;

function setData(map, fc) {
  map.getSource(SOURCE)?.setData(fc || EMPTY);
}

registerLayer({
  key: 'cone',
  type: 'additive',
  order: 10, // bottom of the selection stack — everything reads over the veil

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;
    /* Ambient cones for every warmed storm. NO zoom floor: the MapLibre
     * crossfade (GLOBE3D zSpace..zHandoff) already gates this — the whole
     * canvas is transparent in deep space, so the cone materializes with the
     * map instead of popping at a threshold. Same tokens as the selected
     * cone, and now the same gating too: ambient and selected are identical
     * presentations of the same geometry. */
    map.addSource(AMB_SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(
      { id: 'amb-cone-fill', type: 'fill', source: AMB_SOURCE,
        paint: { 'fill-color': palette().geo.coneFill, 'fill-opacity': palette().geo.coneFillOpacity } },
      beforeId
    );
    map.addLayer(
      { id: 'amb-cone-line', type: 'line', source: AMB_SOURCE,
        paint: { 'line-color': palette().geo.coneLine, 'line-opacity': palette().geo.coneLineOpacity,
                 'line-width': palette().geo.coneLineWidth } },
      beforeId
    );
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(
      {
        id: 'sel-cone-fill',
        type: 'fill',
        source: SOURCE,
        paint: {
          'fill-color': palette().geo.coneFill,
          'fill-opacity': palette().geo.coneFillOpacity,
        },
      },
      beforeId
    );
    map.addLayer(
      {
        id: 'sel-cone-line',
        type: 'line',
        source: SOURCE,
        paint: {
          'line-color': palette().geo.coneLine,
          'line-opacity': palette().geo.coneLineOpacity,
          'line-width': palette().geo.coneLineWidth,
        },
      },
      beforeId
    );

    /* Apply whatever visibility was last asked for. The engine may have called
     * setVisible before these layers existed (see the note on `visible`), and
     * without this that call would be silently lost. */
    for (const id of LAYER_IDS) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  },

  update(map, storm, bundle) {
    setData(map, bundle.layers.cone?.fc);
  },

  clear(map) {
    setData(map, null);
  },

  updateAmbient(map, features) {
    map.getSource(AMB_SOURCE)?.setData({ type: 'FeatureCollection', features });
  },

  /** The additive toggle. `visibility`, not source-clearing: re-enabling costs
   *  nothing and the geometry stays warm, exactly as the graticule does. */
  setVisible(map, on) {
    visible = !!on;
    for (const id of LAYER_IDS) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  },
});
