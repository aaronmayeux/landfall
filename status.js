/**
 * style-dark.js — the MapLibre style JSON for the night-sky globe.
 *
 * SPEC §9 visual direction: LIT VOLUMETRIC GLOBE, NOT A WIREFRAME SKELETON.
 *   - Land is FILLED. Filled land against dark ocean reads as a globe and
 *     gives storm dots and cones something solid to sit on.
 *   - Glowing coastline edges ride on top of the fills — the same line drawn
 *     three times: wide/dim/blurred underneath, thin/bright on top.
 *   - Depth fade: line opacity and width driven by zoom, so distant coastlines
 *     are faint threads and near ones are crisp.
 *
 * Imports only from config/. Nothing in map/ imports from ui/ — ever.
 */

import { DARK, SIZE, OPACITY } from '../config/tokens.js';
import { ZOOM, TILES } from '../config/constants.js';

/**
 * Zoom-driven interpolation helper.
 *
 * DERIVE, NEVER HAND-TUNE TWICE (SPEC §12). Every depth-fade ramp in this file
 * is expressed against the ZOOM band floors, so moving a band in constants.js
 * moves the visuals with it. Nothing here restates a zoom number.
 */
const byZoom = (stops) => ['interpolate', ['linear'], ['zoom'], ...stops.flat()];

/**
 * Builds the style object.
 *
 * @param {object} opts
 * @param {boolean} opts.useR2 - true once the .pmtiles file is uploaded.
 * @returns {object} A MapLibre GL style specification.
 */
export function buildDarkStyle({ useR2 = TILES.useR2 } = {}) {
  const names = useR2 ? TILES.layerNames.protomaps : TILES.layerNames.openfreemap;

  const sources = useR2
    ? {
        basemap: {
          type: 'vector',
          url: `pmtiles://${TILES.r2Base}/${TILES.r2File}`,
          attribution: '© OpenStreetMap contributors, © Protomaps',
        },
      }
    : {
        basemap: {
          type: 'vector',
          url: TILES.openFreeMapStyle,
          attribution: '© OpenStreetMap contributors, © OpenFreeMap',
        },
      };

  return {
    version: 8,
    name: 'Landfall Dark',
    /** Glyphs are needed for any text layer. Phase 1 draws no labels, but the
     *  graticule degree markers in a later phase will, and a style without a
     *  glyph endpoint fails loudly the moment one is added. */
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources,

    /** The sphere itself, behind every layer. This is what you see where
     *  there is no land — the ocean. */
    projection: { type: 'globe' },

    light: {
      anchor: 'map',
      color: '#FFFFFF',
      intensity: 0.15,
    },

    /** Atmosphere: thin rim light at the horizon (SPEC §9). MapLibre's sky
     *  layer handles the gradient; `horizon-blend` is what makes the limb
     *  glow rather than ending in a hard edge. */
    sky: {
      'sky-color': DARK.skyHigh,
      'horizon-color': DARK.atmosphere,
      'fog-color': DARK.skyLow,
      'fog-ground-blend': 0.55,
      'horizon-fog-blend': 0.72,
      'sky-horizon-blend': 0.85,
      'atmosphere-blend': byZoom([
        [ZOOM.planet, 0.9],
        [ZOOM.regional, 0.35],
        [ZOOM.max, 0.0],
      ]),
    },

    layers: [
      /* --------------------------------------------------------------------
       * 1. OCEAN — the base. Everything sits on this.
       * ------------------------------------------------------------------ */
      {
        id: 'ocean',
        type: 'background',
        paint: {
          'background-color': DARK.ocean,
        },
      },

      /* --------------------------------------------------------------------
       * 2. LAND FILL
       *
       * Solid, not translucent. Storm dots and cones need something to sit on.
       * Land fill values are chosen AGAINST the §6 storm colors, never the
       * reverse — a yellow Cat 1 dot over dark ocean is fine; over a lit
       * landmass it may not be. That audit is SPEC §15 item 2 and has not
       * happened yet.
       *
       * Subtle zoom lift: land brightens slightly as you descend, so the
       * planet band reads as a dark globe and the local band reads as a map.
       * ------------------------------------------------------------------ */
      {
        id: 'land',
        type: 'fill',
        source: 'basemap',
        'source-layer': names.land,
        paint: {
          'fill-color': byZoom([
            [ZOOM.planet, DARK.land],
            [ZOOM.local, DARK.landHigh],
          ]),
          'fill-opacity': OPACITY.landFill,
          'fill-antialias': true,
        },
      },

      /* --------------------------------------------------------------------
       * 3. INLAND WATER
       *
       * Lakes and wide rivers cut back to ocean color so the Great Lakes
       * don't read as land. Only appears once there is enough detail to
       * matter — at planet zoom it's noise.
       * ------------------------------------------------------------------ */
      {
        id: 'water-inland',
        type: 'fill',
        source: 'basemap',
        'source-layer': names.water,
        minzoom: ZOOM.basin,
        paint: {
          'fill-color': DARK.ocean,
          'fill-opacity': byZoom([
            [ZOOM.basin, 0],
            [ZOOM.regional, 0.85],
          ]),
        },
      },

      /* --------------------------------------------------------------------
       * 4-5. COASTLINE — THE SIGNATURE ELEMENT
       *
       * The same line drawn twice (SPEC §9 calls for three passes; two blur
       * layers plus a core is the third). MapLibre has no line-blur, so the
       * glow is faked with a wide low-opacity stroke under a thin bright one.
       * That reads as glow at every zoom and costs one extra draw call.
       *
       * DEPTH FADE: opacity AND width are zoom-driven, so distant coastlines
       * are faint threads and near ones are crisp. This is what stops the
       * globe looking like a flat map that happens to be round.
       * ------------------------------------------------------------------ */
      {
        id: 'coast-glow',
        type: 'line',
        source: 'basemap',
        'source-layer': names.land,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': DARK.coastGlowSoft,
          'line-width': byZoom([
            [ZOOM.planet, SIZE.coastWidthGlow * 0.6],
            [ZOOM.basin, SIZE.coastWidthGlow],
            [ZOOM.local, SIZE.coastWidthGlow * 1.6],
          ]),
          'line-opacity': byZoom([
            [ZOOM.planet, OPACITY.coastGlow * 0.7],
            [ZOOM.regional, OPACITY.coastGlow],
            [ZOOM.max, OPACITY.coastGlow * 0.8],
          ]),
          'line-blur': byZoom([
            [ZOOM.planet, 2],
            [ZOOM.local, 5],
          ]),
        },
      },
      {
        id: 'coast-core',
        type: 'line',
        source: 'basemap',
        'source-layer': names.land,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': DARK.coastGlow,
          'line-width': byZoom([
            [ZOOM.planet, SIZE.coastWidthCore * 0.65],
            [ZOOM.basin, SIZE.coastWidthCore],
            [ZOOM.local, SIZE.coastWidthCore * 1.9],
          ]),
          /** Distant coasts are faint threads — this ramp is the whole
           *  "depth" of the depth fade. */
          'line-opacity': byZoom([
            [ZOOM.planet, 0.42],
            [ZOOM.basin, 0.72],
            [ZOOM.regional, OPACITY.coastCore],
          ]),
        },
      },
    ],
  };
}

/**
 * Layer ids that the graticule must insert BENEATH.
 *
 * Draw order from SPEC §13, bottom to top:
 *   imagery -> land fill -> graticule -> coastline glow -> ...
 *
 * The graticule sits UNDER the coast, always. It is reference, not content,
 * and a grid line crossing over a glowing coastline reads as an error.
 */
export const GRATICULE_INSERT_BEFORE = 'coast-glow';
