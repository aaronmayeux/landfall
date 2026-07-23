/**
 * track-forecast.js — forecast track. Baseline, on selection (SPEC §7).
 *
 * SOLID and bright: the forecast is the question everyone opened the panel
 * to answer, so it carries the confident line. The past track is the dotted
 * one. Forecast uncertainty is the cone's job, not the line's.
 */

import { STORM_GEO } from '../../config/tokens.js';
import { ZOOM } from '../../config/constants.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-track-forecast';
const AMB_SOURCE = 'amb-track-forecast';
const EMPTY = { type: 'FeatureCollection', features: [] };

registerLayer({
  key: 'forecastTrack',
  type: 'baseline',
  order: 30,

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;
    /* Ambient forecast tracks from the regional band (§9). */
    map.addSource(AMB_SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(
      { id: 'amb-track-forecast', type: 'line', source: AMB_SOURCE, minzoom: ZOOM.ambientGeometry,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': STORM_GEO.trackForecast,
                 'line-width': STORM_GEO.trackForecastWidth } },
      beforeId
    );
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

  updateAmbient(map, features) {
    map.getSource(AMB_SOURCE)?.setData({ type: 'FeatureCollection', features });
  },
});
