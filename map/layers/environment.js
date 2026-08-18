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
 * ==> TWO PRESENTATIONS, LIKE EVERY OTHER GEOMETRY LAYER, AND THE FIRST
 * VERSION SHIPPED WITH ONLY ONE. <== It carried an ambient source alone, on
 * the reasoning that both would be identical here — the ribbon is the same
 * statement about every storm that has a run, not a selection detail — and
 * that the ambient merge excludes nothing this layer would want back.
 *
 * THE MERGE EXCLUDES EXACTLY ONE THING: THE SELECTED STORM. `registry.js`
 * `ambientFeatures` skips it by design, because its geometry rides the
 * selection sources and would otherwise draw twice. With `update` a no-op,
 * tapping a storm therefore ERASED ITS OWN RIBBON — the cone went back to
 * plain veil at the moment the reader opened the drawer to read about it,
 * and came back when they closed it. Every unselected storm kept its color,
 * which is what made it read as a caching fault rather than as this.
 *
 * Both presentations are identical in paint and differ only in which source
 * they read, exactly as cone.js does. The alternative — teaching the engine
 * to stop excluding this one layer — would put a per-layer special case in
 * the one file §7 says never changes when a layer is added.
 */

import { ENV_RIBBON } from '../../config/constants.js';
import { STORM_GEO } from '../../config/tokens.js';
import { registerLayer } from './registry.js';

const SEL_SOURCE = 'sel-env-ribbon';
const AMB_SOURCE = 'amb-env-ribbon';
const SEL_LINE_SOURCE = 'sel-env-track';
const AMB_LINE_SOURCE = 'amb-env-track';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** Every layer id this file owns, ACROSS BOTH REGISTRATIONS. Listed once so
 *  `setVisible` cannot miss one and leave half the ribbon drawn under a
 *  switched-off row — the same reason cone.js keeps its own list, and the
 *  reason the forecast line's ids are in here rather than in a second list
 *  the toggle would have to remember to call. */
const LAYER_IDS = [
  'amb-env-ribbon-fill', 'sel-env-ribbon-fill',
  'amb-env-track', 'sel-env-track',
];

/** One collection carries slices and centreline segments (lib/cone-ribbon.js).
 *  Split at the source rather than with a MapLibre `filter`: a filter still
 *  ships every polygon to the line layer's worker to be thrown away, and the
 *  ribbon is the heaviest per-storm collection the app builds. */
const ofKind = (features, kind) =>
  (features || []).filter((f) => f?.properties?._kind === kind);

const fcOfKind = (fc, kind) => ({
  type: 'FeatureCollection',
  features: ofKind(fc?.features, kind),
});

/** Held across `ensure` for the same reason cone.js holds its own: the engine
 *  may call `setVisible` before or after the layers exist, and a layer whose
 *  visibility depends on which message landed first is a bug that only shows
 *  up on a slow connection.
 *
 *  Seeded FALSE because this layer ships off — the opposite of the cone. */
let visible = false;

function applyVisibility(map) {
  for (const id of LAYER_IDS) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

/** One fill layer's definition. Both presentations are the same paint on a
 *  different source, so they are built from one place — two copies of this
 *  object is how the selected ribbon later drifts a shade off the ambient one
 *  and nobody can see why. */
const fillLayer = (id, source) => ({
  id,
  type: 'fill',
  source,
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
});

registerLayer({
  key: 'environment',
  type: 'additive',

  /* JUST ABOVE THE CONE VEIL (10) AND BELOW EVERYTHING ELSE. The ribbon
   * replaces what the veil says about the front half of the cone, so it has to
   * sit on top of it — and every line, dot and label on the map still has to
   * read over the result, so it sits under all of them. */
  order: 11,

  ensure(map, beforeId) {
    if (map.getSource(AMB_SOURCE)) return;
    map.addSource(AMB_SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(fillLayer('amb-env-ribbon-fill', AMB_SOURCE), beforeId);
    map.addSource(SEL_SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(fillLayer('sel-env-ribbon-fill', SEL_SOURCE), beforeId);
    /* Apply whatever visibility was last asked for. The engine may have called
     * setVisible before these layers existed (see the note on `visible`), and
     * without this that call would be silently lost. */
    applyVisibility(map);
  },

  /** The tapped storm. Its features leave the ambient merge the moment it is
   *  selected, so without this its cone loses the color it had a frame ago. */
  update(map, storm, bundle) {
    const fc = bundle?.layers?.environment?.fc;
    map.getSource(SEL_SOURCE)?.setData(fc ? fcOfKind(fc, 'slice') : EMPTY);
  },

  clear(map) {
    map.getSource(SEL_SOURCE)?.setData(EMPTY);
  },

  updateAmbient(map, features) {
    map.getSource(AMB_SOURCE)?.setData({
      type: 'FeatureCollection',
      features: ofKind(features, 'slice'),
    });
  },

  /** The additive toggle. `visibility`, not source-clearing: re-enabling costs
   *  nothing and the geometry stays warm, exactly as the cone does. */
  setVisible(map, on) {
    visible = !!on;
    applyVisibility(map);
  },
});

/* ===========================================================================
 * THE FORECAST LINE, CARRYING THE SAME NUMBER — §47.5.
 *
 * ==> A SECOND `registerLayer` CALL WITH THE SAME `key`, AND THAT IS THE
 * WHOLE TRICK. <== The engine dispatches by key: `setToggle` calls
 * `setVisible` on EVERY definition whose key matches, `setBundle` calls
 * `update` on all of them, and `ambientFeatures(d.key)` merges the same slot
 * for both. So the ribbon's one toggle, one bundle slot and one ambient merge
 * drive two definitions sitting at two different heights, with no special case
 * anywhere in registry.js — which §7 says never changes when a layer is added.
 *
 * IT HAS TO BE A SEPARATE REGISTRATION BECAUSE OF `order`. `ensure` is handed
 * ONE `beforeId`, so a definition's layers land in one z-band. The fill has to
 * sit under the plain cone's edge and every line on the map (11); the line has
 * to sit ON TOP of the white forecast track it recolors (30). One definition
 * cannot be in two places.
 *
 * ==> IT DOES NOT REPLACE THE WHITE TRACK, IT COVERS IT, AND IT IS NARROWER
 * THAN NOTHING. <== `STORM_GEO.trackForecastWidth`, exactly — the same 1.75 px
 * the line already is. The track does not get fatter when the environment is
 * switched on, which was Aaron's call on 2026-08-16 and is why the LEGIBILITY
 * FLOOR lives in the color instead (lib/cone-ribbon.js `liftToLegible`). The white
 * line underneath is not decoration either: where the run stops short of the
 * cone (§47.6 — 86 files in the season lost their positions before +120 h) the
 * colored segments simply end, and the white track continues from there. The
 * line stops being colored at exactly the hour the fill stops being colored,
 * with no third thing to keep in step.
 * ======================================================================== */

const trackLayer = (id, source) => ({
  id,
  type: 'line',
  source,
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: {
    /* Per feature, never a themed expression — see the note on the fill's
     * `fill-color` above, and map/theme-state.js rule 1b. */
    'line-color': ['get', '_color'],
    'line-width': STORM_GEO.trackForecastWidth,
  },
});

registerLayer({
  key: 'environment',
  type: 'additive',

  /* ABOVE THE FORECAST TRACK (30) AND BELOW THE FORECAST DOTS. The dots carry
   * category color and a classification code and are the one thing on the
   * track that must never be painted over. */
  order: 31,

  ensure(map, beforeId) {
    if (map.getSource(AMB_LINE_SOURCE)) return;
    map.addSource(AMB_LINE_SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(trackLayer('amb-env-track', AMB_LINE_SOURCE), beforeId);
    map.addSource(SEL_LINE_SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(trackLayer('sel-env-track', SEL_LINE_SOURCE), beforeId);
    applyVisibility(map);
  },

  update(map, storm, bundle) {
    const fc = bundle?.layers?.environment?.fc;
    map.getSource(SEL_LINE_SOURCE)?.setData(fc ? fcOfKind(fc, 'line') : EMPTY);
  },

  clear(map) {
    map.getSource(SEL_LINE_SOURCE)?.setData(EMPTY);
  },

  updateAmbient(map, features) {
    map.getSource(AMB_LINE_SOURCE)?.setData({
      type: 'FeatureCollection',
      features: ofKind(features, 'line'),
    });
  },

  /* `LAYER_IDS` already covers this definition's two layers, so the toggle
   * reaching either registration switches all four. Deliberately not a no-op:
   * whichever one the engine calls first, the answer is the same. */
  setVisible(map, on) {
    visible = !!on;
    applyVisibility(map);
  },
});
