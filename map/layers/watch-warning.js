/**
 * watch-warning.js — watch/warning coastal paint. EXCLUSIVE PAIR A of
 * `coastal` (§7); surge bands join as segment B when that step lands.
 *
 * ==> THIS LAYER SPENT ITS WHOLE LIFE IGNORING ITS OWN CONTROL <==
 *
 * It registered as `type: 'baseline'` with no `pairId` and no `setPair`, while
 * the manifest had declared a `coastal` pair around it since Phase 4. So
 * `engine.setPair('coastal', …)` looped every definition, matched none, and
 * returned — the stripe drew whatever the segment said, including nothing.
 * Aaron reported the Coastal row as "not built yet" on 2026-07-26, which is
 * exactly what a control that drives nothing looks like from the outside.
 *
 * The engine never had to change: it reads `pairId` and calls `setPair`, and the
 * §7 contract has always been "adding a layer means adding a file." What was
 * missing was this file holding up its end. Two fields and a hook.
 *
 * NOTE THE FAILURE MODE, because it is the one this project keeps meeting: no
 * error anywhere. The layer worked, the manifest was right, the engine was
 * right, and the wire between them did not exist — the same shape as the
 * model-tracks `engineKey` bug (see config/layers.js) where a switch flipped,
 * data loaded, features built, and the map layer stayed hidden.
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

/** Which segment is showing: 'off' | 'watchWarning' | 'surge'. The manifest
 *  default is 'watchWarning'; held here so geometry arriving before the first
 *  pref sync paints rather than sitting invisible. */
let segment = 'watchWarning';

/** Draw nothing at all? Read by every path that writes to a source, INCLUDING
 *  the `moveend` re-select — a debounced timer that fires after the user
 *  switches Off would otherwise repaint the stripe from `lastSelected` and put
 *  the layer back on a map that had switched it away. */
const drawingOff = () => segment !== 'watchWarning';

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
  /* The engine merges ambient features by THIS key. It stays 'watchWarning'
   * through every segment — unlike the wind field, whose two halves read two
   * different bundle slots, this pair's other half (surge) has no data source
   * yet and Off reads none by definition. `setPair` gates the DRAWING instead
   * of re-pointing the key, which is the honest shape for a pair whose
   * segments are not two views of the same fetch. */
  key: 'watchWarning',
  type: 'pair',
  pairId: 'coastal',
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
        /* THE SEGMENT IS CHECKED INSIDE THE TIMER, not when it was scheduled.
         * This fires up to `reselectDebounceMs` after the camera settles, which
         * is easily long enough for a tap on Off to land in between — and a
         * re-select does not consult the sources it overwrites. Without this,
         * switching Off and then nudging the globe repaints the stripe. */
        if (drawingOff()) return;
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
    /* HELD EVEN WHILE OFF. This is the geometry and its band cache, not the
     * drawing — keeping it means switching back on repaints instantly from work
     * already done rather than re-selecting against whatever tiles are loaded
     * at that moment, which can only be worse (the same reasoning `clear()`
     * gives for not dropping the cache on deselect). */
    lastSelected =
      slot?.status === 'ok' ? { key: storm.id, fc: slot.fc, stamp } : null;
    map.getSource(SOURCE)?.setData(
      lastSelected && !drawingOff() ? decorated(map, storm.id, slot.fc, stamp) : EMPTY
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
      drawingOff() ? EMPTY : decorated(map, 'ambient', { features }, `n${features?.length || 0}`)
    );
  },

  /**
   * The pair hook — the wire that did not exist until 2026-07-26.
   *
   * GATES DRAWING RATHER THAN RE-POINTING `key`, which is the opposite of what
   * wind-field.js does, and the difference is real: the wind field's two
   * segments are two slots of one bundle that was already fetched, so switching
   * is a re-read. Here, Off has nothing to read and surge has no source at all,
   * so there is no slot to point at. Pretending otherwise would mean inventing a
   * sentinel key for a pair that does not work that way.
   *
   * Both sources are written explicitly rather than left to the engine's
   * re-merge. Ambient WOULD clear itself (`recomputeAmbient` calls
   * `updateAmbient` unconditionally), but the SELECTED source would not: nothing
   * re-runs `update()` on a segment change, so the open storm's stripe would sit
   * on the map after the user switched it off. Writing both is one line and
   * removes the asymmetry.
   *
   * `surge` is accepted and draws nothing — the manifest keeps that segment
   * dimmed so it cannot be reached today, and this must not paint watch/warning
   * geometry under a label reading Surge if it ever is.
   */
  setPair(map, value) {
    /* FALSE = nothing moved, so the engine must NOT re-merge ambient. main.js
     * pushes every pair on every layer change and every selection; treating
     * those no-ops as changes is what made one tap re-derive the coastal band
     * three times (registry.js setPair). */
    if (value === segment) return false;
    segment = value;
    map.getSource(SOURCE)?.setData(
      lastSelected && !drawingOff()
        ? decorated(map, lastSelected.key, lastSelected.fc, lastSelected.stamp)
        : EMPTY
    );
    map.getSource(AMB_SOURCE)?.setData(
      lastAmbient && !drawingOff()
        ? decorated(map, 'ambient', { features: lastAmbient }, `n${lastAmbient.length}`)
        : EMPTY
    );
    /* FALSE EVEN THOUGH THE SEGMENT MOVED, and that is not a contradiction:
     * the engine recomputes ambient so that a pair member reading a NEW bundle
     * slot gets the right merge (wind-field.js does exactly that). This layer's
     * `key` never moves — Off and Surge have no slot to point at, which is why
     * the hook gates drawing instead — and both sources are written above from
     * data already in hand. A re-merge would hand `updateAmbient` the identical
     * feature list and re-derive the coastal band for it. Same pixels, one more
     * band select. */
    return false;
  },
});
