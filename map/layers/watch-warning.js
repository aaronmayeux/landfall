/**
 * watch-warning.js — watch/warning coastal stripe. Baseline, on selection
 * for Phase 4; becomes exclusive-pair A with surge bands in Phase 6 (§7).
 *
 * Colors are the §6 fixed contract, per feature via lib/watchwarning.js —
 * the TCWW code is found by scanning property VALUES (the probe never
 * recorded the field name; the codes are the stable contract). A feature
 * with no recognizable code draws in the generic hue rather than a wrong
 * severity color.
 *
 * Segments pass through map/coast-trace.js, which today returns them
 * UNTRACED (see the reasoning there). The stripe is NHC's own delivered
 * geometry either way — official geometry isn't ours to curve.
 */

import { STORM_GEO, CATEGORY_COLOR } from '../../config/tokens.js';
import { ZOOM } from '../../config/constants.js';
import { wwCodeFromProps, wwColor } from '../../lib/watchwarning.js';
import { traceSegments } from '../coast-trace.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-ww';
const AMB_SOURCE = 'amb-ww';
const EMPTY = { type: 'FeatureCollection', features: [] };

function decorated(fc) {
  const { features } = traceSegments(fc?.features);
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        _color: wwColor(wwCodeFromProps(f.properties)) || CATEGORY_COLOR.GENERIC,
      },
    })),
  };
}

registerLayer({
  key: 'watchWarning',
  type: 'baseline',
  order: 40,

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;
    /* Ambient stripes from the regional band (§9). ALL ambient storm
     * geometry shares one band floor so the set arrives together. NOTE: the
     * stripe is still untraced (§7 as-built), so at z5 it may chord across
     * bays before the coast resolves — verify on glass; if it reads badly
     * the fix is tracing, not moving this floor back up. */
    map.addSource(AMB_SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(
      { id: 'amb-ww-glow', type: 'line', source: AMB_SOURCE, minzoom: ZOOM.ambientGeometry,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', '_color'], 'line-width': STORM_GEO.stripeGlowWidth,
                 'line-opacity': STORM_GEO.stripeGlowOpacity,
                 'line-blur': STORM_GEO.stripeGlowWidth / 2 } },
      beforeId
    );
    map.addLayer(
      { id: 'amb-ww-core', type: 'line', source: AMB_SOURCE, minzoom: ZOOM.ambientGeometry,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', '_color'], 'line-width': STORM_GEO.stripeWidth,
                 'line-opacity': STORM_GEO.stripeOpacity } },
      beforeId
    );
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    /* Wide soft underlay + solid core: reads as coastal shading at a
     * glance, and the underlay keeps thin warning runs findable at z5. */
    map.addLayer(
      {
        id: 'sel-ww-glow',
        type: 'line',
        source: SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', '_color'],
          'line-width': STORM_GEO.stripeGlowWidth,
          'line-opacity': STORM_GEO.stripeGlowOpacity,
          'line-blur': STORM_GEO.stripeGlowWidth / 2,
        },
      },
      beforeId
    );
    map.addLayer(
      {
        id: 'sel-ww-core',
        type: 'line',
        source: SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', '_color'],
          'line-width': STORM_GEO.stripeWidth,
          'line-opacity': STORM_GEO.stripeOpacity,
        },
      },
      beforeId
    );
  },

  update(map, storm, bundle) {
    const slot = bundle.layers.watchWarning;
    map.getSource(SOURCE)?.setData(slot?.status === 'ok' ? decorated(slot.fc) : EMPTY);
  },

  clear(map) {
    map.getSource(SOURCE)?.setData(EMPTY);
  },

  updateAmbient(map, features) {
    map.getSource(AMB_SOURCE)?.setData(decorated({ features }));
  },
});
