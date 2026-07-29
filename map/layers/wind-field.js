/**
 * wind-field.js — wind field / wind swath. EXCLUSIVE PAIR (SPEC §7).
 *
 * How big is the storm, not just where is it. The dot gives position and the
 * cone gives future position; neither says how far out the dangerous wind
 * actually reaches. A Cat 2 spanning 300 nm and a Cat 2 spanning 60 nm are
 * different problems and looked identical until this layer.
 *
 * TWO SEGMENTS, ONE MAP SPACE — which is exactly why they are a pair and not
 * two switches (§7):
 *   current — the bands around where the storm is NOW.
 *   swath   — forecast radii along the whole track: the total area that sees
 *             each threshold over the forecast period. This is the one that
 *             answers "does it reach me".
 * Both draw the same three thresholds in the same §6 colors, so a user who
 * switches segments is changing WHEN, never WHAT.
 *
 * AMBIENT ON EVERY STORM, not just the selected one. A layer the user sets
 * and forgets should not silently apply to one storm — Aaron's call, and the
 * right one: a wind field that appears only on tap reads as a detail popup,
 * not a layer. Same identical-presentation rule the cone follows.
 *
 * NESTING IS THE WHOLE POINT and it is what makes the paint tricky: the three
 * polygons overlap by construction (the 64 kt core sits inside the 50, which
 * sits inside the 34), so fills COMPOUND. Tokens are tuned for the stacked
 * result, not for one band alone — see STORM_GEO.windFillOpacity.
 *
 * NO ZOOM FLOOR, matching the cone and tracks: the MapLibre crossfade is the
 * real gate. If several storms turn the map to soup on glass, a floor keyed
 * off ZOOM is the intended fix (§14) — one constant, not a rewrite.
 */

import { STORM_GEO } from '../../config/tokens.js';
import { windThresholdFromProps, windColor, windSortKey } from '../../lib/wind.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-wind';
const AMB_SOURCE = 'amb-wind';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** Which segment is showing: 'off' | 'current' | 'swath'. The pair's default
 *  (§7 manifest) is 'current'; held here so a bundle arriving before the first
 *  pref sync still draws the right half rather than nothing. */
let segment = 'current';

/** The bundle slot each segment reads. The pair value and the geometry key
 *  are deliberately the same words, but the mapping is stated rather than
 *  assumed — the same reason the additive toggles carry `engineKey`.
 *
 *  OFF IS A REAL ENTRY POINTING AT A SLOT NO BUNDLE HAS. That is what makes it
 *  need no branch anywhere else in this file: the engine merges ambient features
 *  by `key`, `drawSelected` reads the bundle by `key`, and both come up empty
 *  against a name nothing publishes. A sentinel rather than `undefined` or null
 *  so the value is greppable and a stray lookup cannot silently mean "the whole
 *  layers object". */
const OFF_SLOT = '__windOff';
const SLOT = Object.freeze({ off: OFF_SLOT, current: 'windCurrent', swath: 'windSwath' });

/** Last data seen, so a segment switch can redraw without refetching. The
 *  bundle is not reachable from the pref subscription, so it is held. */
let lastSelectedBundle = null;
let lastAmbientBundles = null; // features, already merged by the engine

/**
 * Tag each polygon with its §6 color and severity order.
 *
 * A feature whose threshold cannot be identified is DROPPED, not drawn in a
 * fallback hue: an unlabelled band in the wrong green would misreport
 * severity, and these colors are the fixed safety contract. Dropping is
 * visible (a missing ring) where a wrong color is invisible (a plausible
 * lie).
 *
 * NO SMOOTHING, and none is needed. Both layers this file draws — Advisory
 * Wind Field (+13) and Forecast Wind Radii (+12) — are quadrant polygons
 * whose corners are REAL data, and both measured clean of rasterization.
 * The staircase that once justified a smoothing pass belonged to Past
 * Cumulative Wind Swath (+9), a layer the app drew only by a resolver bug
 * and draws no more: measured 2026-07-24 (layer 143, live), 100% of its
 * edges are axis-aligned. lib/smooth.js retired with that finding — SPEC
 * §14 keeps the method lessons.
 */
function decorated(features) {
  const out = [];
  for (const f of features || []) {
    const kt = windThresholdFromProps(f.properties);
    const color = windColor(kt);
    if (!color) continue;
    out.push({
      ...f,
      properties: { ...f.properties, _wkt: kt, _wcolor: color, _wsev: windSortKey(kt) },
    });
  }
  return { type: 'FeatureCollection', features: out };
}

/** Fill + outline for one source. Both presentations use this, so ambient and
 *  selected can never drift into looking different. */
function bandLayers(id, source) {
  return [
    {
      id: `${id}-fill`,
      type: 'fill',
      source,
      layout: { 'fill-sort-key': ['get', '_wsev'] },
      paint: {
        'fill-color': ['get', '_wcolor'],
        'fill-opacity': STORM_GEO.windFillOpacity,
      },
    },
    {
      id: `${id}-line`,
      type: 'line',
      source,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['get', '_wsev'],
      },
      paint: {
        'line-color': ['get', '_wcolor'],
        'line-width': STORM_GEO.windLineWidth,
        'line-opacity': STORM_GEO.windLineOpacity,
      },
    },
  ];
}

function drawSelected(map) {
  const slot = lastSelectedBundle?.layers?.[SLOT[segment]];
  const fc = slot?.status === 'ok' ? decorated(slot.fc?.features) : EMPTY;
  map.getSource(SOURCE)?.setData(fc);
}

function drawAmbient(map) {
  map.getSource(AMB_SOURCE)?.setData(decorated(lastAmbientBundles));
}

registerLayer({
  /* The engine merges ambient features by THIS key, so it names the slot the
   * current segment reads. `setPair` below re-points it when the segment
   * changes, which is what makes one registration serve both halves. */
  key: SLOT.current,
  type: 'pair',
  pairId: 'windField',

  /* Under the cone (10) would bury the bands beneath the veil; above the
   * tracks would cover the forecast line the user is following. Between
   * them: context that reads as area, with the tracks still drawn on top. */
  order: 15,

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;
    map.addSource(AMB_SOURCE, { type: 'geojson', data: EMPTY });
    for (const l of bandLayers('amb-wind', AMB_SOURCE)) map.addLayer(l, beforeId);
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    for (const l of bandLayers('sel-wind', SOURCE)) map.addLayer(l, beforeId);
  },

  update(map, storm, bundle) {
    lastSelectedBundle = bundle;
    drawSelected(map);
  },

  clear(map) {
    lastSelectedBundle = null;
    map.getSource(SOURCE)?.setData(EMPTY);
  },

  updateAmbient(map, features) {
    lastAmbientBundles = features;
    drawAmbient(map);
  },

  /**
   * The pair hook. Switching segments changes which bundle slot is read —
   * no refetch, because both slots were fetched together with the cone.
   * The engine re-merges ambient against the new key.
   *
   * OFF NEEDS NO SPECIAL CASE HERE, and that is worth stating because it looks
   * like an omission. `drawSelected` reads the bundle by `SLOT[segment]` and
   * gets nothing for the Off sentinel; the engine then calls `updateAmbient`
   * unconditionally with whatever `ambientFeatures(this.key)` merged, which for
   * the sentinel is an empty list. Both sources empty themselves through the
   * paths they already had. Verified by reading registry.js rather than
   * assumed — `recomputeAmbient` loops every definition that owns the hook, not
   * only the ones the merge found features for.
   */
  setPair(map, value) {
    if (!SLOT[value] || value === segment) return false;
    segment = value;
    this.key = SLOT[value];
    drawSelected(map);
    /* TRUE = the engine must re-merge ambient. `key` just moved to a different
     * bundle slot, so the merge has to run against the new one. A false answer
     * above is what keeps a no-op push from recomputing the whole ambient set
     * (registry.js setPair). */
    return true;
  },
});
