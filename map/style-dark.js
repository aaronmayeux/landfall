/**
 * style-dark.js — the MapLibre style JSON for the night-sky globe.
 *
 * SPEC §9 visual direction: LIT VOLUMETRIC GLOBE, NOT A WIREFRAME SKELETON.
 *   - Land is FILLED. Filled land against dark ocean reads as a globe and
 *     gives storm dots and cones something solid to sit on.
 *   - Glowing coastline edges ride on top of the fills — the same line drawn
 *     twice: wide/dim/blurred underneath, thin/bright on top. MapLibre's
 *     `line-blur` does the third pass's job.
 *   - Depth fade: line opacity and width driven by zoom, so distant coastlines
 *     are faint threads and near ones are crisp.
 *
 * ---------------------------------------------------------------------------
 * TWO SCHEMAS, INVERTED APPROACHES. This is the whole complexity of this file.
 *
 * OpenMapTiles (what OpenFreeMap serves) has NO land polygon layer. Its
 * `landcover` layer is surface MATERIAL — glaciers, wood, grass — not
 * landmass. Land is simply the absence of water. So:
 *     background = LAND, `water` fill drawn ON TOP = ocean.
 *     Coastline = the edge of the ocean polygon.
 *
 * Protomaps has a real `earth` layer. So:
 *     background = OCEAN, `earth` fill drawn on top = land.
 *     Coastline = the edge of the land polygon.
 *
 * Getting this backwards paints the entire globe ocean-colored and leaves
 * only ice sheets visible — that was the first deploy. Verified against
 * openmaptiles.org/schema, 2026-07-22.
 * ---------------------------------------------------------------------------
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

    projection: { type: 'globe' },

    light: {
      anchor: 'map',
      color: '#FFFFFF',
      intensity: 0.15,
    },

    /** Atmosphere: thin rim light at the horizon (SPEC §9).
     *
     *  These blend values are deliberately LOW. The first deploy used
     *  fog-ground-blend 0.55 / horizon-fog-blend 0.72, which bled the fog
     *  color across the entire sphere face and produced a lit blue planet
     *  instead of a night-sky globe. The rim should be a thin edge, not a
     *  wash. */
    sky: {
      'sky-color': DARK.skyHigh,
      'horizon-color': DARK.atmosphere,
      'fog-color': DARK.skyLow,
      'fog-ground-blend': 0.02,
      'horizon-fog-blend': 0.12,
      'sky-horizon-blend': 0.6,
      'atmosphere-blend': byZoom([
        [ZOOM.planet, 0.5],
        [ZOOM.basin, 0.18],
        [ZOOM.regional, 0.0],
      ]),
    },

    layers: useR2 ? protomapsLayers() : openMapTilesLayers(),
  };
}

/* ---------------------------------------------------------------------------
 * OPENMAPTILES (OpenFreeMap) — land is the background, ocean drawn on top.
 * ------------------------------------------------------------------------- */
function openMapTilesLayers() {
  const OCEAN_ONLY = ['==', ['get', 'class'], 'ocean'];

  return [
    /** Background IS the land. Every pixel starts as land and the ocean is
     *  painted over it. There is no land polygon on this schema. */
    {
      id: 'land',
      type: 'background',
      paint: {
        'background-color': byZoom([
          [ZOOM.planet, DARK.land],
          [ZOOM.local, DARK.landHigh],
        ]),
      },
    },

    /** Ocean — `class=ocean` only. Lakes and rivers are excluded here and get
     *  their own layer below, because at planet zoom every pond in Finland is
     *  noise but the Atlantic is the entire point. */
    {
      id: 'ocean',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'water',
      filter: OCEAN_ONLY,
      paint: {
        'fill-color': DARK.ocean,
        'fill-opacity': OPACITY.landFill,
        'fill-antialias': true,
      },
    },

    /** Inland water — lakes, rivers. Fades in at the basin band so the Great
     *  Lakes don't read as land once you have committed to a region. */
    {
      id: 'water-inland',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'water',
      filter: ['!=', ['get', 'class'], 'ocean'],
      minzoom: ZOOM.basin,
      paint: {
        'fill-color': DARK.ocean,
        'fill-opacity': byZoom([
          [ZOOM.basin, 0],
          [ZOOM.regional, 0.9],
        ]),
      },
    },

    /* The coast IS the ocean polygon's edge on this schema. */
    coastGlowLayer('water', OCEAN_ONLY),
    coastCoreLayer('water', OCEAN_ONLY),
  ];
}

/* ---------------------------------------------------------------------------
 * PROTOMAPS (R2, once built) — ocean is the background, land drawn on top.
 * ------------------------------------------------------------------------- */
function protomapsLayers() {
  return [
    {
      id: 'ocean',
      type: 'background',
      paint: { 'background-color': DARK.ocean },
    },
    {
      id: 'land',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'earth',
      paint: {
        'fill-color': byZoom([
          [ZOOM.planet, DARK.land],
          [ZOOM.local, DARK.landHigh],
        ]),
        'fill-opacity': OPACITY.landFill,
        'fill-antialias': true,
      },
    },
    {
      id: 'water-inland',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'water',
      minzoom: ZOOM.basin,
      paint: {
        'fill-color': DARK.ocean,
        'fill-opacity': byZoom([
          [ZOOM.basin, 0],
          [ZOOM.regional, 0.9],
        ]),
      },
    },
    /* The coast IS the land polygon's edge on this schema. */
    coastGlowLayer('earth', null),
    coastCoreLayer('earth', null),
  ];
}

/* ---------------------------------------------------------------------------
 * Shared coastline builders — THE SIGNATURE ELEMENT.
 *
 * Both schemas draw the identical two-pass glow against different source
 * layers, so it is extracted (SPEC §12: any pattern used twice gets
 * extracted). Wide dim blurred underlay, thin bright core on top.
 *
 * DEPTH FADE lives here: opacity AND width are zoom-driven, so distant
 * coastlines are faint threads and near ones are crisp. This is what stops
 * the globe looking like a flat map that happens to be round.
 * ------------------------------------------------------------------------- */

function coastGlowLayer(sourceLayer, filter) {
  const layer = {
    id: 'coast-glow',
    type: 'line',
    source: 'basemap',
    'source-layer': sourceLayer,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
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
  };
  if (filter) layer.filter = filter;
  return layer;
}

function coastCoreLayer(sourceLayer, filter) {
  const layer = {
    id: 'coast-core',
    type: 'line',
    source: 'basemap',
    'source-layer': sourceLayer,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': DARK.coastGlow,
      'line-width': byZoom([
        [ZOOM.planet, SIZE.coastWidthCore * 0.65],
        [ZOOM.basin, SIZE.coastWidthCore],
        [ZOOM.local, SIZE.coastWidthCore * 1.9],
      ]),
      'line-opacity': byZoom([
        [ZOOM.planet, 0.42],
        [ZOOM.basin, 0.72],
        [ZOOM.regional, OPACITY.coastCore],
      ]),
    },
  };
  if (filter) layer.filter = filter;
  return layer;
}

/**
 * Layer id that the graticule must insert BENEATH.
 *
 * Draw order from SPEC §13, bottom to top:
 *   imagery -> land fill -> graticule -> coastline glow -> ...
 *
 * The graticule sits UNDER the coast, always. It is reference, not content,
 * and a grid line crossing over a glowing coastline reads as an error.
 */
export const GRATICULE_INSERT_BEFORE = 'coast-glow';
