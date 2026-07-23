/**
 * track-forecast.js — forecast track. Baseline, on selection (SPEC §7).
 *
 * Dashed = not yet happened. Brighter than the past track: the forecast is
 * the question everyone opened the panel to answer.
 */

import { STORM_GEO } from '../../config/tokens.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-track-forecast';
const EMPTY = { type: 'FeatureCollection', features: [] };

registerLayer({
  key: 'forecastTrack',
  type: 'baseline',
  order: 30,

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(
      {
        id: 'sel-track-forecast',
        type: 'line',
        source: SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': STORM_GEO.trackForecast,
          'line-width': STORM_GEO.trackForecastWidth,
          'line-dasharray': [...STORM_GEO.trackForecastDash],
        },
      },
      beforeId
    );
  },

  update(map, storm, bundle) {
    map.getSource(SOURCE)?.setData(bundle.layers.forecastTrack?.fc || EMPTY);
  },

  clear(map) {
    map.getSource(SOURCE)?.setData(EMPTY);
  },
});
