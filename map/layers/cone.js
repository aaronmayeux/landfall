/**
 * cone.js — cone of uncertainty. Baseline, on selection (SPEC §7).
 *
 * Deliberately a neutral veil, not a category-colored shape: severity rides
 * the glyph and the forecast points (§6); the cone's job is extent.
 * Selection overrides the zoom ladder (§9) — you asked for it, it draws at
 * any zoom.
 */

import { STORM_GEO } from '../../config/tokens.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-cone';
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
});
