/**
 * volcano-map.js — the volcano MARK, drawn by MapLibre, for the zooms the
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
 *   Three pips + limb silhouettes   z2.0 → z3.8
 *   MapLibre circles, this file     z2.4 → z6.2
 *   Real geometry                   z5.4 → up    proto/volcano-3d.js
 *
 * ==> THE MARK IS A BRIDGE NOW, NOT A DESTINATION. <== `proto/volcano-3d.js`
 * draws true-scale mountains from z5, and the circle fades out underneath them
 * — Aaron's call 2026-07-30, that a dot and a mountain for the same volcano at
 * the same time is two marks for one thing.
 *
 * Nothing in THIS file draws a volcano's shape and nothing should; the split
 * between a mark and a mountain is the whole reason there are two files.
 * `fill-extrusion` was built here once and rejected on glass; SPEC-GLOBES
 * §42.1.4a carries what that ruled out and §42.1.4b carries what replaced it.
 *
 * ==> EVERY FADE IS A ZOOM EXPRESSION, NOT A FRAME CALLBACK. <== MapLibre
 * interpolates these itself on the GPU. Driving them from the render loop would
 * be a per-frame style write on a phone, for a curve MapLibre already knows how
 * to walk.
 *
 * Imports: config/constants.js only. No THREE.
 */

import { VOLCANO } from '../config/constants.js';

const M = VOLCANO.marks;
const MM = VOLCANO.mapMarks;

const SRC_POINTS = 'volcano-points';
const LAYER_CIRCLE = 'volcano-circle';

const EMPTY = Object.freeze({ type: 'FeatureCollection', features: [] });

/* ==> A ZOOM EXPRESSION MAY ONLY BE THE INPUT TO A TOP-LEVEL `step` OR
 * `interpolate`, AND GETTING THAT WRONG THROWS ON STYLE LOAD. <== The obvious
 * shape for "this value, faded by zoom" is `['*', <value>, <zoom curve>]` and
 * MapLibre rejects it outright — the zoom curve has to be the OUTERMOST thing,
 * with the data-driven part living in its output values. It is the difference
 * between a layer and a console error nobody on a phone will ever see, so the
 * paint block is built by a function and asserted by
 * `tools/test-volcano-paint.mjs` rather than written inline and hoped over.
 */

/** Quiet or erupting, from the same constants the 3D globe reads. A volcano
 *  must not change colour because it changed renderer. */
const byState = (quiet, live) => ['case', ['==', ['get', 'erupting'], 1], live, quiet];

/**
 * Fades in under the Three pips — and, for anything that becomes a mountain,
 * back out again under `proto/volcano-3d.js`.
 *
 * ==> THE FADE-OUT IS CONDITIONAL AND THAT CONDITION IS §42.1.4 MEETING §5.
 * <== Submarine volcanoes and volcanic fields never get an edifice: a cone for
 * a seamount 1,800 m down is false, and one for "West Eifel Volcanic Field" is
 * a fabrication. They have no mountain to hand off TO, so fading their circle
 * out would simply delete them from the map — silence, for the two sets least
 * able to afford it. They hold their mark at full strength all the way in.
 *
 * Everything else hands over across `VOLCANO.map3d.handoff`, read off the same
 * constant the geometry reads so the two curves cannot drift apart and leave a
 * zoom band with neither a dot nor a mountain in it.
 */
function zoomCurve(value) {
  const [inA, inB] = MM.circleIn;
  const [outA, outB] = VOLCANO.map3d.handoff;
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    inA,
    0,
    inB,
    value,
    outA,
    value,
    /* Only a mountain surrenders its mark. */
    outB,
    ['case', KEEPS_MARK, value, 0],
  ];
}

/** The two sets that keep their flat mark forever (§42.1.4). Written once and
 *  used by every paint property, so one of them cannot be forgotten in one
 *  place and remembered in another. */
const KEEPS_MARK = [
  'any',
  ['==', ['get', 'submarine'], 1],
  ['==', ['get', 'family'], 'field'],
];

/**
 * The flat mark's paint. Exported so the expression rules above can be
 * asserted without a browser.
 */
export function circlePaint() {
  /* ==> SUBMARINE VOLCANOES ARE HOLLOW HERE TOO. <== The globe draws them as a
   * ring because a mountain sticking out of the Pacific for a seamount is a
   * lie. No fill and a stroke is the same statement in MapLibre's vocabulary.
   * Ahyi is erupting 55 m under water and must not read as land at any zoom. */
  const isSub = ['==', ['get', 'submarine'], 1];
  const opacity = byState(M.quietOpacity, M.eruptingOpacity);

  return {
    'circle-color': byState(M.quietColor, M.eruptingColor),
    /* Erupting is a fixed size and ignores severity, because the score ranks
     * the QUIET (§42.1.1). Great Sitkin scores 0.240 and is erupting today;
     * sizing it below an idle Etna would invert that rule. */
    'circle-radius': [
      'case',
      ['==', ['get', 'erupting'], 1],
      MM.circleEruptingPx,
      ['interpolate', ['linear'], ['get', 'sev'], 0, MM.circleMinPx, 1, MM.circleMaxPx],
    ],
    'circle-opacity': zoomCurve(['case', isSub, 0, opacity]),
    'circle-stroke-width': ['case', isSub, 2, 0],
    'circle-stroke-color': byState(M.quietColor, M.eruptingColor),
    'circle-stroke-opacity': zoomCurve(['case', isSub, opacity, 0]),
  };
}

/** Every volcano as a point — including the submarine ones and the fields,
 *  which is the whole reason this layer takes all of them rather than only the
 *  ones some other layer declined to draw. */
export function buildVolcanoPoints(marks) {
  return {
    type: 'FeatureCollection',
    features: (marks || []).map((m) => ({
      type: 'Feature',
      properties: {
        n: m.n,
        name: m.name,
        sev: m.sev,
        erupting: m.erupting ? 1 : 0,
        submarine: m.submarine ? 1 : 0,
        family: m.family,
      },
      geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
    })),
  };
}

/**
 * Attach the volcano mark layer to a MapLibre map.
 *
 * @param {object} map a MapLibre `Map`
 * @returns {object} a handle with `setField`, `setVisible` and `dispose`
 */
export function createVolcanoMapLayers(map) {
  let wanted = true;
  let added = false;
  let styleReady = false;
  let last = null;

  /**
   * ==> `map.isStyleLoaded()` IS NOT "DOES A STYLE EXIST", AND THIS FILE USED
   * IT AS THAT GATE FOR MONTHS. <== It survived on luck, and the luck ran out:
   * Aaron reported no volcano dots at all below z5.4.
   *
   * `Style.loaded()` requires `_loaded` AND no pending source updates AND
   * **every source cache to have finished fetching its tiles** AND the image
   * manager to be loaded. None of the last three is true inside a `style.load`
   * handler, which is the only moment this layer is going to be added. What
   * `addSource`/`addLayer` actually need is `_checkLoaded()` — `_loaded`
   * alone — and that is set at the top of the same function that fires
   * `style.load` at the bottom.
   *
   * The old version papered over it with a `styledata` listener that retried
   * until an attempt happened to land after the tiles arrived. That is luck,
   * not design, it was written down as such in `proto/volcano-3d.js`, and it
   * is the exact bug that made the 3D layer invisible for a deploy. The honest
   * gate is "has style.load fired", and both files now use it.
   */
  function add() {
    if (added || !styleReady) return;
    map.addSource(SRC_POINTS, { type: 'geojson', data: EMPTY });
    map.addLayer({ id: LAYER_CIRCLE, type: 'circle', source: SRC_POINTS, paint: circlePaint() });
    added = true;
    applyVisible();
  }

  function applyVisible() {
    if (!added) return;
    map.setLayoutProperty(LAYER_CIRCLE, 'visibility', wanted ? 'visible' : 'none');
  }

  /* A style reload drops every source and layer this file added, and MapLibre
   * gives no warning that it happened — the layer would simply be gone.
   * `style.load` fires again on a reload and is the same gate as the first
   * add, so one listener covers both. */
  map.on('style.load', () => {
    styleReady = true;
    if (map.getSource(SRC_POINTS)) return;
    added = false;
    add();
    if (last) handle.setField(last);
  });

  const handle = {
    /** Hand in a loaded field (`loadVolcanoField()`'s return). */
    setField(field) {
      last = field;
      if (!added) {
        add();
        if (!added) return;
      }
      map.getSource(SRC_POINTS).setData(buildVolcanoPoints((field && field.marks) || []));
    },

    setVisible(on) {
      wanted = !!on;
      applyVisible();
    },

    dispose() {
      if (!added) return;
      if (map.getLayer(LAYER_CIRCLE)) map.removeLayer(LAYER_CIRCLE);
      if (map.getSource(SRC_POINTS)) map.removeSource(SRC_POINTS);
      added = false;
      last = null;
    },
  };

  add();
  return handle;
}
