/**
 * cone.js — cone of uncertainty. Baseline, on selection (SPEC §7).
 *
 * Deliberately a neutral veil, not a category-colored shape: severity rides
 * the glyph and the forecast points (§6); the cone's job is extent.
 * Selection overrides the zoom ladder (§9) — you asked for it, it draws at
 * any zoom.
 */

import { STORM_GEO } from '../../config/tokens.js';
import { ZOOM } from '../../config/constants.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-cone';
const AMB_SOURCE = 'amb-cone';
const EMPTY = { type: 'FeatureCollection', features: [] };

function setData(map, fc) {
  map.getSource(SOURCE)?.setData(fc || EMPTY);
}

registerLayer({
  key: 'cone',
  type: 'baseline',
  order: 10, // bottom of the selection stack — everything reads over the veil

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;
    /* Ambient cones for every warmed storm, gated by the ladder (§9:
     * regional band). Same tokens as the selected cone — ambient is the
     * NORMAL presentation, selection just ignores the ladder. */
    map.addSource(AMB_SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(
      { id: 'amb-cone-fill', type: 'fill', source: AMB_SOURCE, minzoom: ZOOM.ambientGeometry,
        paint: { 'fill-color': STORM_GEO.coneFill, 'fill-opacity': STORM_GEO.coneFillOpacity } },
      beforeId
    );
    map.addLayer(
      { id: 'amb-cone-line', type: 'line', source: AMB_SOURCE, minzoom: ZOOM.ambientGeometry,
        paint: { 'line-color': STORM_GEO.coneLine, 'line-opacity': STORM_GEO.coneLineOpacity,
                 'line-width': STORM_GEO.coneLineWidth } },
      beforeId
    );
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(
      {
        id: 'sel-cone-fill',
        type: 'fill',
        source: SOURCE,
        paint: {
          'fill-color': STORM_GEO.coneFill,
          'fill-opacity': STORM_GEO.coneFillOpacity,
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
          'line-color': STORM_GEO.coneLine,
          'line-opacity': STORM_GEO.coneLineOpacity,
          'line-width': STORM_GEO.coneLineWidth,
        },
      },
      beforeId
    );
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
});
