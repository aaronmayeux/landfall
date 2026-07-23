/**
 * track-past.js — past track. Baseline, on selection (SPEC §7).
 *
 * Dotted and dim: observed history is context, drawn quieter than the
 * forecast. The grammar is deliberate and inverted from the usual reading —
 * the forecast gets the solid, confident line because it is what the app is
 * for; uncertainty rides the cone (see track-forecast.js, tokens STORM_GEO).
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
    /* Ambient past tracks from the regional band (§9). All ambient storm
     * geometry shares ONE band floor so the set arrives together — a lone
     * past track two zoom levels ahead of everything else read as a bug. */
    map.addSource(AMB_SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(
      { id: 'amb-track-past', type: 'line', source: AMB_SOURCE, minzoom: ZOOM.regional,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': STORM_GEO.trackPast, 'line-width': STORM_GEO.trackPastWidth,
                 'line-dasharray': [...STORM_GEO.trackPastDash] } },
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
          'line-dasharray': [...STORM_GEO.trackPastDash],
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
