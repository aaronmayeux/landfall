/**
 * watch-warning.js — watch/warning coastal stripe. Baseline, on selection
 * for Phase 4; becomes exclusive-pair A with surge bands in Phase 6 (§7).
 *
 * Colors are the §6 fixed contract, per feature via lib/watchwarning.js.
 * A feature with no recognizable code draws in the generic hue rather than
 * a wrong severity color.
 *
 * Segments are TRACED against the drawn coastline (map/coast-trace.js) so a
 * warning covering a bay follows the bay instead of chording across open
 * water. Tracing is best-effort: any segment that cannot be traced
 * confidently keeps NHC's delivered geometry, flagged `_traced: false` —
 * official geometry isn't ours to curve.
 *
 * Traces go through map/coast-trace-cache.js, which keeps the BEST result per
 * storm. Coast vertices come from loaded tiles, so a naive re-trace would let
 * the stripe visibly degrade as you zoom out; the cache makes it one-way.
 */

import { STORM_GEO, CATEGORY_COLOR } from '../../config/tokens.js';
import { ZOOM, COAST_TRACE } from '../../config/constants.js';
import { wwCodeFromProps, wwColor } from '../../lib/watchwarning.js';
import { tracedFor } from '../coast-trace-cache.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-ww';
const AMB_SOURCE = 'amb-ww';
const EMPTY = { type: 'FeatureCollection', features: [] };

/* What was last applied, so `moveend` can re-trace it against newly loaded
 * coastline. Held rather than re-derived: the geometry bundle is not
 * reachable from an event handler. */
let lastSelected = null; // { key, fc, stamp }
let lastAmbient = null;  // features array

/** Trace, then paint. `key` scopes the trace cache; `stamp` invalidates it
 *  when a new advisory replaces the geometry. */
function decorated(map, key, fc, stamp) {
  const { features } = tracedFor(map, key, fc?.features, stamp);
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

    /* Coast vertices arrive as tiles load, so the trace made at selection
     * time is often against a partly-loaded coast. Re-trace once the camera
     * settles and let the cache keep whichever result is better. Debounced —
     * a pinch fires several moveends in a row on a phone. */
    let timer = null;
    map.on('moveend', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (lastSelected) {
          map.getSource(SOURCE)?.setData(
            decorated(map, lastSelected.key, lastSelected.fc, lastSelected.stamp)
          );
        }
        if (lastAmbient) {
          map.getSource(AMB_SOURCE)?.setData(
            decorated(map, 'ambient', { features: lastAmbient }, `n${lastAmbient.length}`)
          );
        }
      }, COAST_TRACE.retraceDebounceMs);
    });
  },

  update(map, storm, bundle) {
    const slot = bundle.layers.watchWarning;
    /* Keyed by storm so each storm keeps its own best trace, stamped by
     * advisory identity so new geometry discards the old trace however good
     * it was — a trace of a superseded warning is a wrong warning. */
    const stamp = String(bundle.stamp?.advisnum || bundle.stamp?.filedate || '');
    lastSelected =
      slot?.status === 'ok' ? { key: storm.id, fc: slot.fc, stamp } : null;
    map.getSource(SOURCE)?.setData(
      lastSelected ? decorated(map, storm.id, slot.fc, stamp) : EMPTY
    );
  },

  clear(map) {
    /* The trace cache is NOT cleared here. The formerly-selected storm
     * rejoins the ambient collection (registry.js) and its trace is still
     * valid work — throwing it away would re-trace from scratch against
     * whatever tiles happen to be loaded, which can only be worse. */
    lastSelected = null;
    map.getSource(SOURCE)?.setData(EMPTY);
  },

  updateAmbient(map, features) {
    /* One shared key: ambient is a merged multi-storm collection that
     * changes whenever any storm warms or the selection moves, so per-storm
     * keying would not survive the merge. The stamp is the feature count —
     * crude, but it changes exactly when the collection does, which is the
     * only thing invalidation needs here. */
    lastAmbient = features?.length ? features : null;
    map.getSource(AMB_SOURCE)?.setData(
      decorated(map, 'ambient', { features }, `n${features?.length || 0}`)
    );
  },
});
