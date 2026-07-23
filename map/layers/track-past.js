/**
 * track-past.js — past track. Baseline, on selection (SPEC §7).
 *
 * Solid and dim: observed history is context, drawn quieter than the
 * forecast. The solid/dashed pair is the visual grammar — solid happened,
 * dashed hasn't (see track-forecast.js).
 */

import { STORM_GEO } from '../../config/tokens.js';
import { ZOOM } from '../../config/constants.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-track-past';
const AMB_SOURCE = 'amb-track-past';
const EMPTY = { type: 'FeatureCollection', features: [] };

registerLayer({
  key: 'pastTrack',
  type: 'baseline',
  order: 20,

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;
    /* Ambient past tracks from the basin band (§9 — history arrives with
     * names and category color, before cones do). */
    map.addSource(AMB_SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(
      { id: 'amb-track-past', type: 'line', source: AMB_SOURCE, minzoom: ZOOM.basin,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': STORM_GEO.trackPast, 'line-width': STORM_GEO.trackPastWidth } },
      beforeId
    );
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(
      {
        id: 'sel-track-past',
        type: 'line',
        source: SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': STORM_GEO.trackPast,
          'line-width': STORM_GEO.trackPastWidth,
        },
      },
      beforeId
    );
  },

  update(map, storm, bundle) {
    map.getSource(SOURCE)?.setData(bundle.layers.pastTrack?.fc || EMPTY);
  },

  clear(map) {
    map.getSource(SOURCE)?.setData(EMPTY);
  },

  updateAmbient(map, features) {
    map.getSource(AMB_SOURCE)?.setData({ type: 'FeatureCollection', features });
  },
});
