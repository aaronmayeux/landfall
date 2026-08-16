/**
 * environment.js — the cone, filled by what the environment is worth to the
 * storm. SPEC §47.4, §47.5, §47.9. ADDITIVE, default OFF.
 *
 * The slices arrive already built and already colored (lib/cone-ribbon.js,
 * folded into the bundle by app/bundle-pipeline.js). This file draws them and
 * nothing else — it decides no color, reads no SHIPS field, and holds no
 * threshold.
 *
 * ==> `fill-antialias: false`, AND IT IS THE WHOLE REASON THIS LOOKS RIGHT.
 * <== §47.5 states the failure and the mockup hit it: per-slice transparency
 * paints every shared edge twice and the cone comes out looking like corduroy.
 * The mockup's fix was an SVG group carrying the opacity, which MapLibre has
 * no equivalent of — `fill-opacity` is per layer, and adjacent translucent
 * polygons in ONE fill layer blend against each other at their shared edge
 * either way.
 *
 * So the slices share their vertices EXACTLY — no overlap, built from the same
 * rib points — and antialiasing is switched off, which is what stops MapLibre
 * drawing a feathered edge on each polygon and leaving a hairline seam where
 * two of them meet. Opacity then lives on the layer, once, and cannot stack.
 *
 * ==> IT IS DRAWN ABOVE THE CONE FILL, NOT INSTEAD OF IT. <== §47.6: where the
 * ribbon stops, the cone reverts to its plain fill, and a run that publishes
 * nothing drawable past hour 0 is 6% of the season. Keeping the plain veil
 * underneath is what makes that free — the cone is one shape whose front half
 * is colored, rather than two shapes that have to be clipped against each
 * other. The veil is 0.08, so what shows through under a slice is negligible.
 *
 * ONE PRESENTATION, NOT TWO. Every other geometry layer carries an ambient
 * source and a selection source; this one is ambient only. Both would be
 * identical here — the ribbon is not a selection detail, it is the same
 * statement about every storm that has a run — and the engine's ambient merge
 * already excludes nothing this layer would want back. `update` and `clear`
 * exist because the engine calls them; they are no-ops on purpose, and a
 * comment beats a missing method that throws.
 */

import { ENV_RIBBON } from '../../config/constants.js';
import { registerLayer } from './registry.js';

const SOURCE = 'env-ribbon';
const LAYER = 'env-ribbon-fill';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** Held across `ensure` for the same reason cone.js holds its own: the engine
 *  may call `setVisible` before or after the layer exists, and a layer whose
 *  visibility depends on which message landed first is a bug that only shows
 *  up on a slow connection.
 *
 *  Seeded FALSE because this layer ships off — the opposite of the cone. */
let visible = false;

function applyVisibility(map) {
  if (map.getLayer(LAYER)) {
    map.setLayoutProperty(LAYER, 'visibility', visible ? 'visible' : 'none');
  }
}

registerLayer({
  key: 'environment',
  type: 'additive',

  /* JUST ABOVE THE CONE VEIL (10) AND BELOW EVERYTHING ELSE. The ribbon
   * replaces what the veil says about the front half of the cone, so it has to
   * sit on top of it — and every line, dot and label on the map still has to
   * read over the result, so it sits under all of them. */
  order: 11,

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(
      {
        id: LAYER,
        type: 'fill',
        source: SOURCE,
        paint: {
          /* Resolved per feature against the active palette. It CANNOT be a
           * themed expression: a paint property holding both a `global-state`
           * reference and a `['get']` evaluates in the worker, which is never
           * sent the state, and resolves to BLACK in both themes without
           * throwing (map/theme-state.js, rule 1b). A theme change re-pushes
           * every bundle, which rebuilds these colors. */
          'fill-color': ['get', '_color'],
          'fill-opacity': ENV_RIBBON.fillOpacity,
          'fill-antialias': false,
        },
      },
      beforeId
    );
    applyVisibility(map);
  },

  /* The selected storm's ribbon rides the ambient collection like every other
   * storm's — see the note at the top on why there is one presentation. */
  update() {},
  clear() {},

  updateAmbient(map, features) {
    map.getSource(SOURCE)?.setData({ type: 'FeatureCollection', features });
  },

  /** The additive toggle. `visibility`, not source-clearing: re-enabling costs
   *  nothing and the geometry stays warm, exactly as the cone does. */
  setVisible(map, on) {
    visible = !!on;
    applyVisibility(map);
  },
});
