/**
 * volcano-map.js — the volcano layer, drawn by MapLibre, for the zooms the
 * Three globe never reaches.
 *
 * PROTOTYPE CODE. Not wired into the app.
 *
 * ==> THIS IS A HANDOFF, NOT A SECOND FEATURE. <== `proto/volcano-marks.js`
 * owns the layer from the space floor down to about z3.8, where the Three globe
 * fades out with its dots; below `DIVE.zHandoff` the renderer is cleared
 * entirely and there is no 3D scene at all. Volcanoes that vanish exactly as
 * you get close enough to see them is backwards, so the same marks are handed
 * to MapLibre and drawn again in its own projection.
 *
 * THE LADDER, and the bands overlap on purpose — a hard switch between two ways
 * of drawing one volcano is a pop, and this app already fixed that once for the
 * plate seams:
 *
 *   Three pips + limb silhouettes   z2.0 → z3.8
 *   circles                         z2.4 → z8.0
 *   extrusions                      z5.5 → up
 *
 * ==> EVERY FADE IS A ZOOM EXPRESSION, NOT A FRAME CALLBACK. <== MapLibre
 * interpolates these itself on the GPU. Driving them from the render loop would
 * be a per-frame style write on a phone, for a curve MapLibre already knows how
 * to walk.
 *
 * Imports: config/constants.js and lib/volcano-extrusion.js. No THREE.
 */

import { VOLCANO } from '../config/constants.js';
import { buildVolcanoExtrusions, buildVolcanoPoints } from '../lib/volcano-extrusion.js';

const M = VOLCANO.marks;
const EX = VOLCANO.extrusion;

const SRC_POINTS = 'volcano-points';
const SRC_RINGS = 'volcano-rings';
const LAYER_CIRCLE = 'volcano-circle';
const LAYER_EXTRUDE = 'volcano-extrude';

const EMPTY = Object.freeze({ type: 'FeatureCollection', features: [] });


/* ==> A ZOOM EXPRESSION MAY ONLY BE THE INPUT TO A TOP-LEVEL `step` OR
 * `interpolate`, AND GETTING THAT WRONG THROWS ON STYLE LOAD. <== The obvious
 * shape for "this value, faded by zoom" is `['*', <value>, <zoom curve>]` and
 * MapLibre rejects it outright — the zoom curve has to be the OUTERMOST thing,
 * with the data-driven part living in its output values. It is the difference
 * between a layer and a console error nobody on a phone will ever see, so the
 * paint blocks are built by these two functions and asserted by
 * `tools/test-volcano-paint.mjs` rather than written inline and hoped over.
 */

/** Quiet or erupting, from the same constants the 3D globe reads. A volcano
 *  must not change colour because it changed renderer. */
const BY_STATE = (quiet, live) => ['case', ['==', ['get', 'erupting'], 1], live, quiet];

/**
 * The flat mark. Carries the layer from where the Three pips leave to where the
 * extrusions are big enough to read, and carries the two sets that NEVER
 * extrude — submarine volcanoes and volcanic fields (§42.1.4) — the whole way.
 */
export function circlePaint() {
  /* ==> SUBMARINE VOLCANOES ARE HOLLOW HERE TOO. <== The globe draws them as a
   * ring because a mountain sticking out of the Pacific for a seamount is a
   * lie. No fill and a stroke is the same statement in MapLibre's vocabulary.
   * Ahyi is erupting 55 m under water and must not read as land at any zoom. */
  const isSub = ['==', ['get', 'submarine'], 1];
  const fillA = ['case', isSub, 0, BY_STATE(M.quietOpacity, M.eruptingOpacity)];
  const strokeA = ['case', isSub, BY_STATE(M.quietOpacity, M.eruptingOpacity), 0];

  return {
    'circle-color': BY_STATE(M.quietColor, M.eruptingColor),
    /* Erupting is a fixed size and ignores severity, because the score ranks
     * the QUIET (§42.1.1). Great Sitkin scores 0.240 and is erupting today;
     * sizing it below an idle Etna would invert that rule. */
    'circle-radius': [
      'case',
      ['==', ['get', 'erupting'], 1],
      EX.circleEruptingPx,
      ['interpolate', ['linear'], ['get', 'sev'], 0, EX.circleMinPx, 1, EX.circleMaxPx],
    ],
    'circle-opacity': zoomEnvelope(fillA),
    'circle-stroke-width': ['case', isSub, 2, 0],
    'circle-stroke-color': BY_STATE(M.quietColor, M.eruptingColor),
    'circle-stroke-opacity': zoomEnvelope(strokeA),
  };
}

/** In over one band, hold, then out over another — with the data-driven value
 *  as the OUTPUT rather than a factor multiplied onto the result. */
function zoomEnvelope(value) {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    EX.circleIn[0], 0,
    EX.circleIn[1], value,
    EX.circleOut[0], value,
    EX.circleOut[1], 0,
  ];
}

/**
 * The extruded volcano. Stacked annuli, each standing from the ground to its
 * own height, so the stack reads as a stepped cone. Terraced rather than
 * smooth, which is the cost of using MapLibre's own 3D instead of a custom
 * layer — at this size it reads as a contour model rather than as a mistake.
 */
export function extrudePaint() {
  /* ==> THE VERTICAL EXAGGERATION LIVES HERE, NOT IN THE GEOMETRY. <== `hM` is
   * the ring's true height in metres. A volcano is a symbol at z5 and a place
   * at z11, and one multiplier cannot serve both: true height at z5 is a
   * barely-raised disc, and z5's multiplier at z11 swallows the city. Retuning
   * this changes nothing on disk. */
  const height = ['interpolate', ['linear'], ['zoom']];
  for (const [zoom, mult] of EX.heightExaggeration) {
    height.push(zoom, ['*', ['get', 'hM'], mult]);
  }

  return {
    'fill-extrusion-color': BY_STATE(M.quietColor, M.eruptingColor),
    'fill-extrusion-height': height,
    'fill-extrusion-base': 0,
    /* Not data-driven at all, so the opacity is baked straight into the curve's
     * output values rather than multiplied onto it. */
    'fill-extrusion-opacity': [
      'interpolate',
      ['linear'],
      ['zoom'],
      EX.extrudeIn[0], 0,
      EX.extrudeIn[1], EX.opacity,
    ],
  };
}

/**
 * Attach the volcano layers to a MapLibre map.
 *
 * @param {object} map a MapLibre `Map`
 * @returns {object} a handle with `setField`, `setVisible` and `dispose`
 */
export function createVolcanoMapLayers(map) {
  let wanted = true;
  let added = false;

  function add() {
    if (added || !map.isStyleLoaded()) return;

    map.addSource(SRC_POINTS, { type: 'geojson', data: EMPTY });
    map.addSource(SRC_RINGS, { type: 'geojson', data: EMPTY });

    map.addLayer({ id: LAYER_CIRCLE, type: 'circle', source: SRC_POINTS, paint: circlePaint() });
    map.addLayer({ id: LAYER_EXTRUDE, type: 'fill-extrusion', source: SRC_RINGS, paint: extrudePaint() });

    added = true;
    applyVisible();
  }

  function applyVisible() {
    if (!added) return;
    const v = wanted ? 'visible' : 'none';
    map.setLayoutProperty(LAYER_CIRCLE, 'visibility', v);
    map.setLayoutProperty(LAYER_EXTRUDE, 'visibility', v);
  }

  /* A style reload drops every source and layer this file added, and MapLibre
   * gives no warning that it happened — the layer would simply be gone. */
  let last = null;
  map.on('styledata', () => {
    if (map.getSource(SRC_POINTS)) return;
    added = false;
    add();
    if (last) handle.setField(last);
  });

  const handle = {
    /**
     * Hand in a loaded field (`loadVolcanoField()`'s return).
     *
     * ==> BUILT ONCE, ON THE WAY IN, NOT PER FRAME. <== 135 volcanoes at six
     * rings each is about 800 polygons; regenerating that on a zoom change
     * would be a main-thread stall every time the camera moved.
     */
    setField(field) {
      last = field;
      if (!added) {
        add();
        if (!added) return;
      }
      const marks = (field && field.marks) || [];
      map.getSource(SRC_POINTS).setData(buildVolcanoPoints(marks));
      map.getSource(SRC_RINGS).setData(buildVolcanoExtrusions(marks));
    },

    setVisible(on) {
      wanted = !!on;
      applyVisible();
    },

    dispose() {
      if (!added) return;
      for (const id of [LAYER_CIRCLE, LAYER_EXTRUDE]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of [SRC_POINTS, SRC_RINGS]) {
        if (map.getSource(id)) map.removeSource(id);
      }
      added = false;
      last = null;
    },
  };

  add();
  return handle;
}
