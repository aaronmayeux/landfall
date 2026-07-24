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
import { ZOOM, TILES, ADMIN } from '../config/constants.js';

/**
 * Zoom-driven interpolation helper.
 *
 * DERIVE, NEVER HAND-TUNE TWICE (SPEC §12). Every depth-fade ramp in this file
 * is expressed against the ZOOM band floors, so moving a band in constants.js
 * moves the visuals with it. Nothing here restates a zoom number.
 */
export const byZoom = (stops) => ['interpolate', ['linear'], ['zoom'], ...stops.flat()];

/**
 * Builds the style object.
 *
 * @param {object} opts
 * @param {boolean} opts.useR2 - true = Protomaps via the tile proxy (live);
 *   false = OpenFreeMap fallback.
 * @returns {object} A MapLibre GL style specification.
 */
export function buildDarkStyle({ useR2 = TILES.useR2 } = {}) {
  const sources = useR2
    ? {
        basemap: {
          type: 'vector',
          /* Ordinary tile URLs into the Pages Function tile proxy — the
           * client no longer speaks pmtiles:// or touches the bucket.
           * maxzoom tells MapLibre to overzoom z8 data past z8 instead of
           * requesting tiles that don't exist. */
          tiles: [TILES.tilesUrl],
          maxzoom: TILES.sourceMaxzoom,
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

    /** Intensity 0 — FLAT, evenly lit sphere, no directional shading.
     *
     *  MapLibre's `light` shades the globe like a lit ball, which read as a
     *  day/night terminator: a dark limb and a lit face, with a soft gradient
     *  between. It looked like a solar terminator without being one — the
     *  direction is fixed to the map, so it never corresponded to the actual
     *  time of day anywhere. A globe that implies information it does not have
     *  is worse than a flat one. The whole sphere is now lit identically and
     *  the only thing that varies across it is real data. */
    light: {
      anchor: 'map',
      color: '#FFFFFF',
      intensity: 0,
    },

    /** Atmosphere: OFF. `atmosphere-blend` 0 at every zoom.
     *
     *  This — not `light` — is what produced the day/night shading. On the globe
     *  projection MapLibre's atmosphere does not merely paint a rim: it darkens
     *  the sphere away from the camera-facing center, which reads as a lit face
     *  and a dark limb. Upstream confirms it (maplibre-gl-js discussion #5240:
     *  atmosphere-blend 0 is the documented way to remove the "night effect",
     *  and setting `light` alone does NOT fix it), and the PR that added the
     *  feature was itself motivated by the default obscuring the map.
     *
     *  The shading was never a real terminator — nothing here knows the subsolar
     *  point — so it implied a time of day it could not possibly have. A globe
     *  that implies information it does not have is worse than a flat one.
     *
     *  The earlier tuning pass here lowered fog-ground-blend and
     *  horizon-fog-blend from 0.55/0.72, which reduced the wash but left the
     *  darkening, because those knobs control the FOG, not the atmosphere.
     *  Those low values are kept: they still shape the thin horizon edge.
     *
     *  The rim light at the limb now comes from the 3D clear globe's own
     *  atmosphere (DARK.atmosphere, §2), which is under our control and does not
     *  shade the sphere face. */
    sky: {
      'sky-color': DARK.skyHigh,
      'horizon-color': DARK.atmosphere,
      'fog-color': DARK.skyLow,
      'fog-ground-blend': 0.02,
      'horizon-fog-blend': 0.12,
      'sky-horizon-blend': 0.6,
      'atmosphere-blend': 0,
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
      /** On this schema land IS the background, so it can't be faded by
       *  opacity (there is nothing behind it but the page). Faint continents at
       *  the planet band are done with COLOR instead: near-ocean at planet so
       *  the mesh is the hero, resolving to solid `land` by the regional band
       *  as the mesh dissolves away. */
      paint: {
        'background-color': byZoom([
          [ZOOM.planet, DARK.landFaint],
          [ZOOM.regional, DARK.land],
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

    /* Borders sit UNDER the coast — the same rule the graticule follows. A
     * reference line crossing over a glowing coastline reads as an error. */
    ...adminLineLayers(),

    /* The coast IS the ocean polygon's edge on this schema. */
    coastGlowLayer('water', OCEAN_ONLY),
    coastCoreLayer('water', OCEAN_ONLY),

    /* Names go OVER everything on the basemap: a label buried under a
     * coastline is not a label. Storm layers are added on top of this whole
     * style later and beat these on collision automatically — see the
     * placement-order note below. */
    ...placeLabelLayers(),
  ];
}

/* ---------------------------------------------------------------------------
 * ADMINISTRATIVE FURNITURE (SPEC §11) — borders and place names.
 *
 * OpenMapTiles carries both in layers we were already downloading and simply
 * not drawing: `boundary` (lines, keyed by `admin_level`) and `place` (points,
 * keyed by `class` and `rank`). Nothing new is fetched.
 *
 * OPENMAPTILES ONLY. The Protomaps path (TILES.useR2) has its own boundary
 * schema and does NOT get these — §11's standing warning is that the two
 * schemas share layer names but not layer meanings, and guessing cost a broken
 * deploy once already. If R2 is ever revived, these need writing again against
 * that schema, not copying.
 * ------------------------------------------------------------------------- */

/** Text field with a sane fallback chain. OpenMapTiles has emitted the English
 *  name as both `name:en` (current) and `name_en` (older builds), and neither
 *  is guaranteed for every feature — a place with no English name still has a
 *  local `name`, and a label in the local language beats no label at all. */
const NAME_FIELD = ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name']];

/** Borders that run out to sea. The same layer carries maritime boundaries,
 *  and on a hurricane map a confident line striking out across open water
 *  beside a forecast cone reads as though it MEANS something. It does not.
 *  Stripped everywhere. */
const NOT_MARITIME = ['!=', ['get', 'maritime'], 1];

/** Tribal / aboriginal lands. The `boundary` layer holds administrative
 *  borders as LINESTRINGS **and aboriginal lands as POLYGONS** — same layer,
 *  different thing. A line layer handed a polygon draws its outline, so these
 *  arrived as borders and carved Oklahoma into pieces (reported on glass
 *  2026-07-24).
 *
 *  Two independent guards, because they fail differently. `geometry-type` is
 *  structural and cannot be defeated by a schema build that names things
 *  differently; the `class` check is explicit and catches the case where a
 *  build DOES emit these as lines. Neither is redundant with the other. */
const LINES_ONLY = ['==', ['geometry-type'], 'LineString'];
const NOT_ABORIGINAL = ['!=', ['get', 'class'], 'aboriginal_lands'];

/** Layer ids, named once. The toggles below and `setAdminVisible` both address
 *  these layers by id, and a typo in a string literal would fail SILENTLY —
 *  `map.getLayer('admin-sate')` returns undefined and the toggle just does
 *  nothing. Naming them removes that whole failure mode.
 *
 *  Country borders are deliberately NOT toggleable. They are a handful of
 *  quiet lines that never clutter anything, and turning off "States" should
 *  drop the state divisions without also erasing the US/Mexico border. */
export const ADMIN_LAYER = Object.freeze({
  country: 'admin-country',
  stateLine: 'admin-state',
  stateName: 'place-state',
  city: 'place-city',
});

/** Show/hide the toggleable admin layers. Same shape as `setGraticuleVisible`
 *  DELIBERATELY — §12: one mechanism for basemap visibility, not a second one
 *  that drifts. `getLayer` guards because the Protomaps path never creates
 *  these, so a call with `useR2` on must be a no-op rather than a throw.
 *
 *  "States" covers the LINE and the NAME together. They answer one question —
 *  which state is this — and a control that turned off the divisions while
 *  leaving the names floating over unbounded land would be worse than either. */
export function setAdminVisible(map, { states, cities }) {
  const apply = (id, on) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  };
  apply(ADMIN_LAYER.stateLine, states);
  apply(ADMIN_LAYER.stateName, states);
  apply(ADMIN_LAYER.city, cities);
}

/** An EXACT admin level, and the feature must actually carry one.
 *
 *  THE `has` GUARD IS LOAD-BEARING — it is not defensive noise. `to-number` on
 *  a MISSING property returns 0, not null, so the original `admin_level <= 2`
 *  filter was silently true for every boundary feature that had no admin_level
 *  at all. That is exactly how the aboriginal-lands polygons (which carry no
 *  admin_level) came through drawn as national borders. Verified against the
 *  MapLibre style-spec evaluator, not reasoned about.
 *
 *  Matching EXACTLY rather than `<=` closes the same hole a second way: 0 can
 *  never equal 2 or 4. Anything the schema adds later has to be asked for by
 *  name instead of arriving through an open-ended comparison. */
const atLevel = (level) => [
  'all',
  ['has', 'admin_level'],
  ['==', ['to-number', ['get', 'admin_level']], level],
];

function adminLineLayers() {
  return [
    /** National borders. Drawn beneath state lines so that where the two
     *  coincide — the whole northern and southern US border — the stronger
     *  line is the one on top. */
    {
      id: ADMIN_LAYER.country,
      type: 'line',
      source: 'basemap',
      'source-layer': 'boundary',
      minzoom: ADMIN.countryLineIn,
      filter: ['all', atLevel(ADMIN.levelCountry), NOT_MARITIME, LINES_ONLY, NOT_ABORIGINAL],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': DARK.adminCountry,
        'line-width': SIZE.adminLineWidthCountry,
        'line-opacity': byZoom([
          [ADMIN.countryLineIn, 0],
          [ADMIN.countryLineIn + ADMIN.fadeSpan, 1],
        ]),
      },
    },

    /** State and province divides. The mark that answers "which state is this
     *  heading for" — a question nothing else on this map could answer. */
    {
      id: ADMIN_LAYER.stateLine,
      type: 'line',
      source: 'basemap',
      'source-layer': 'boundary',
      minzoom: ADMIN.stateLineIn,
      filter: ['all', atLevel(ADMIN.levelState), NOT_MARITIME, LINES_ONLY, NOT_ABORIGINAL],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': DARK.adminState,
        'line-width': SIZE.adminLineWidth,
        'line-opacity': byZoom([
          [ADMIN.stateLineIn, 0],
          [ADMIN.stateLineIn + ADMIN.fadeSpan, 1],
        ]),
      },
    },
  ];
}

/* ---------------------------------------------------------------------------
 * PLACE NAMES.
 *
 * COLLISION ORDER IS LOAD-BEARING AND IT IS FREE — verified against the pinned
 * MapLibre 5.6 source, not assumed. `PauseablePlacement` starts at
 * `order.length - 1` and counts DOWN, so symbols in the TOP layer are placed
 * first and win every collision beneath them. Storm names and forecast labels
 * are added on top of this style, so they beat these labels automatically and
 * need no sort keys, no z-order juggling, and no coordination.
 *
 * WITHIN a layer, `symbol-sort-key` decides. Both layers sort on the schema's
 * own `rank` (1 = most important), so when a crowded basin cannot fit every
 * label it is the small places that fall out and the big ones that survive.
 * That is also why city labels need no per-zoom rank ladder: one filter admits
 * every ranked city and collision does the thinning, at every zoom, for free.
 *
 * NO CITY DOTS, deliberately. This map is already carrying storm glyphs,
 * forecast points, and the home marker — all dots, all meaning something
 * specific. A city dot would be a fourth kind of dot that means "a place
 * exists here," and at a glance on a phone it would be read as storm data.
 * The label alone is enough to navigate by.
 * ------------------------------------------------------------------------- */
function placeLabelLayers() {
  return [
    /** State and province names. Uppercase and letterspaced — the same
     *  treatment the storm name gets, one notch quieter, because an area label
     *  should read as a region rather than as a point. */
    {
      id: ADMIN_LAYER.stateName,
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'place',
      minzoom: ADMIN.stateNameIn,
      filter: ['in', ['get', 'class'], ['literal', ['state', 'province']]],
      layout: {
        'text-field': NAME_FIELD,
        'text-font': ['Noto Sans Regular'],
        'text-size': SIZE.stateLabelPx,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.14,
        'text-max-width': 7,
        'symbol-sort-key': ['to-number', ['coalesce', ['get', 'rank'], 99]],
      },
      paint: {
        'text-color': DARK.textState,
        'text-halo-color': DARK.land,
        'text-halo-width': SIZE.placeLabelHaloPx,
        'text-opacity': byZoom([
          [ADMIN.stateNameIn, 0],
          [ADMIN.stateNameIn + ADMIN.fadeSpan, 1],
        ]),
      },
    },

    /** Major cities. `rank` is the whole filter: the schema ranks notable
     *  places 1..10 and leaves everything else UNRANKED, so requiring a rank
     *  is what makes "major" a real category instead of an arbitrary cutoff.
     *  `has` guards the comparison — `to-number` on a missing rank would throw
     *  and take the layer with it. */
    {
      id: ADMIN_LAYER.city,
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'place',
      minzoom: ADMIN.cityIn,
      filter: [
        'all',
        ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        ['has', 'rank'],
        ['<=', ['to-number', ['get', 'rank']], ADMIN.cityRankMax],
      ],
      layout: {
        'text-field': NAME_FIELD,
        'text-font': ['Noto Sans Regular'],
        'text-size': SIZE.placeLabelPx,
        'text-max-width': 8,
        'symbol-sort-key': ['to-number', ['get', 'rank']],
      },
      paint: {
        'text-color': DARK.textPlace,
        'text-halo-color': DARK.ocean,
        'text-halo-width': SIZE.placeLabelHaloPx,
        'text-opacity': byZoom([
          [ADMIN.cityIn, 0],
          [ADMIN.cityIn + ADMIN.fadeSpan, 1],
        ]),
      },
    },
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
      /** Land is a real polygon here, so faint continents at the planet band
       *  are an honest OPACITY fade: continents dissolve in up to full by the
       *  regional band as the mesh dissolves out (SPEC §9, as-built). */
      paint: {
        'fill-color': byZoom([
          [ZOOM.planet, DARK.land],
          [ZOOM.local, DARK.landHigh],
        ]),
        'fill-opacity': byZoom([
          [ZOOM.planet, OPACITY.landFillPlanet],
          [ZOOM.regional, OPACITY.landFill],
        ]),
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
