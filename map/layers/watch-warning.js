/**
 * watch-warning.js — watch/warning coastal paint. Baseline, on selection
 * for Phase 4; becomes exclusive-pair A with surge bands in Phase 6 (§7).
 *
 * Colors are the §6 fixed contract, per feature via lib/watchwarning.js.
 * A feature with no recognizable code draws in the generic hue rather than
 * a wrong severity color.
 *
 * Segments are painted onto the drawn coastline by WIDE-BAND SELECT
 * (map/coast-band.js): the breakpoint line is buffered into a generous
 * corridor and every loaded coast segment inside it is painted the warning
 * color — bays, inlets, and barrier islands included, on purpose. Painting
 * is best-effort: a feature with no coast in its corridor keeps NHC's
 * delivered geometry, flagged `_banded: false` — official geometry isn't
 * ours to curve.
 *
 * Selects go through map/coast-band-cache.js, which keeps the BEST result
 * per storm. Coast vertices come from loaded tiles, so a naive re-select
 * would let the paint visibly degrade as you zoom out; the cache makes it
 * one-way.
 *
 * Overlapping products stack by severity via `line-sort-key` (a Hurricane
 * Watch atop a Tropical Storm Warning paints the same coast; the severer
 * color must win the pixels — §6 safety contract).
 */

import { STORM_GEO, CATEGORY_COLOR } from '../../config/tokens.js';
import { ZOOM, COAST_BAND } from '../../config/constants.js';
import { wwCodeFromProps, wwColor, wwSortKey } from '../../lib/watchwarning.js';
import { bandFor } from '../coast-band-cache.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-ww';
const AMB_SOURCE = 'amb-ww';
const EMPTY = { type: 'FeatureCollection', features: [] };

/* What was last applied, so `moveend` can re-select it against newly loaded
 * coastline. Held rather than re-derived: the geometry bundle is not
 * reachable from an event handler. */
let lastSelected = null; // { key, fc, stamp }
let lastAmbient = null;  // features array

/** Band-select, then paint. `key` scopes the cache; `stamp` invalidates it
 *  when a new advisory replaces the geometry. */
function decorated(map, key, fc, stamp) {
  const { features } = bandFor(map, key, fc?.features, stamp);
  return {
    type: 'FeatureCollection',
    features: features.map((f) => {
      const code = wwCodeFromProps(f.properties);
      return {
        ...f,
        properties: {
          ...f.properties,
          _color: wwColor(code) || CATEGORY_COLOR.GENERIC,
          _sev: wwSortKey(code),
        },
      };
    }),
  };
}

/** Shared paint/layout for the ambient and selected stripes — the two must
 *  read identically, and severity stacking applies to both. One solid
 *  stroke: a glow underlay shipped here once and was killed on glass
 *  2026-07-24 — at the 8px core width the line needs no help being found,
 *  and the blur made the paint look less precise than it is. */
function lineLayers(id, source, minzoom) {
  return [
    {
      id: `${id}-core`,
      type: 'line',
      source,
      ...(minzoom != null ? { minzoom } : {}),
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['get', '_sev'],
      },
      paint: {
        'line-color': ['get', '_color'],
        'line-width': STORM_GEO.stripeWidth,
        'line-opacity': STORM_GEO.stripeOpacity,
      },
    },
  ];
}

registerLayer({
  key: 'watchWarning',
  type: 'baseline',
  order: 40,

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;
    /* Ambient paint from the regional band (§9). ALL ambient storm geometry
     * shares one band floor so the set arrives together. */
    map.addSource(AMB_SOURCE, { type: 'geojson', data: EMPTY });
    for (const layer of lineLayers('amb-ww', AMB_SOURCE, ZOOM.ambientGeometry)) {
      map.addLayer(layer, beforeId);
    }
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    /* One solid stroke: reads as the coastline itself restroked in the
     * warning color. */
    for (const layer of lineLayers('sel-ww', SOURCE, null)) {
      map.addLayer(layer, beforeId);
    }

    /* Coast vertices arrive as tiles load, so the select made at selection
     * time is often against a partly-loaded coast. Re-select once the camera
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
      }, COAST_BAND.reselectDebounceMs);
    });
  },

  update(map, storm, bundle) {
    const slot = bundle.layers.watchWarning;
    /* Keyed by storm so each storm keeps its own best select, stamped by
     * advisory identity so new geometry discards the old band however good
     * it was — a band for a superseded warning is a wrong warning. */
    const stamp = String(bundle.stamp?.advisnum || bundle.stamp?.filedate || '');
    lastSelected =
      slot?.status === 'ok' ? { key: storm.id, fc: slot.fc, stamp } : null;
    map.getSource(SOURCE)?.setData(
      lastSelected ? decorated(map, storm.id, slot.fc, stamp) : EMPTY
    );
  },

  clear(map) {
    /* The band cache is NOT cleared here. The formerly-selected storm
     * rejoins the ambient collection (registry.js) and its band is still
     * valid work — throwing it away would re-select from scratch against
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
