/**
 * style.js — the MapLibre style JSON for the globe, in whichever theme is live.
 *
 * WAS style-dark.js. It stopped being dark-only when light mode landed.
 *
 * ---------------------------------------------------------------------------
 * ==> A THEME CHANGE NO LONGER REBUILDS THIS STYLE. IT SETS TWENTY-SEVEN
 * COLOURS.
 *
 * Every themed colour below is `gs('key')` — a `["to-color", ["global-state",
 * "key"]]` expression — and the style's top-level `state` block declares them.
 * So do the layers the app adds imperatively at `style.load`; the list is
 * shared, and `map/theme-state.js` owns it. Flipping the theme is
 * a walk of `map.setGlobalStateProperty()` and nothing else: MapLibre
 * re-evaluates the paint properties that reference the changed keys and
 * repaints. No style teardown, no layers removed and re-added, no tile
 * re-request, no flash.
 *
 * WHAT THIS REPLACED, AND WHY IT HAD TO GO. The old path was
 * `map.setStyle(buildStyle(), { diff: false })`. `diff: false` was not a
 * pessimisation, it was load-bearing: the app adds its own storm layers to the
 * live style imperatively, MapLibre's differ compares the CURRENT style (which
 * has them) against the NEW one (which does not), and a true diff would have
 * emitted removeLayer for every one of them and never put them back. So the
 * whole style got thrown away and main.js reinstalled the app's layers on the
 * `style.load` that followed. That is a basemap teardown, a full re-layout and
 * a visible flash, to change twenty-seven hex values.
 *
 * Global state sidesteps it completely because it never touches the layer list.
 *
 * ONLY PAINT COLOURS BELONG IN STATE. A global-state reference in a LAYOUT
 * property makes a change re-layout every tile, which is the expensive thing
 * this exists to avoid. Everything in `state` today is a colour in a paint
 * property or in `sky`, and it should stay that way.
 *
 * THIS FILE NO LONGER RESOLVES A PALETTE AT ALL — `tools/token-check.mjs`
 * fails the build on a single `palette()` call in it. The one call the basemap
 * path makes is inside `themeState()`, and it exists only to fill in the
 * style's DEFAULTS, because a style has to be correct the instant it is
 * installed and before anyone has called `setGlobalState`. After that the
 * defaults are never read again.
 * ---------------------------------------------------------------------------
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

import { SIZE, OPACITY } from '../config/tokens.js';
import { gs, stateBlock } from './theme-state.js';
import { ZOOM, TILES, ADMIN } from '../config/constants.js';

/** The empty state both plate sources start in. Frozen and shared: MapLibre
 *  copies source data on install, so one instance is safe and it makes "this
 *  source has not been filled yet" a single identifiable thing. */
const EMPTY_FC = Object.freeze({ type: 'FeatureCollection', features: [] });

/** The plate LABEL source's id. Named once and exported because
 *  `map/plate-seams.js` pushes data into it and a typo in a string literal
 *  would fail silently — `map.getSource()` returns undefined and nothing draws.
 *  The seam source is plain `'plates'`, which predates this file's involvement. */
export const PLATE_LABEL_SOURCE = 'plate-labels';

/**
 * ADMINISTRATIVE FURNITURE, PER WORLD (SPEC-GLOBES.md §38.1).
 *
 * ==> THE DEFAULTS ARE THE SHIPPED APP'S EXACT BEHAVIOUR. <== Sky passes no
 * `admin` block, gets this object, and nothing about the name ladder changes.
 * That is the whole safety argument for adding the knob: a world that says
 * nothing cannot be broken by a world that says something.
 *
 * `stateLines` / `stateNames` — Deep switches both off. On a map whose subject
 *   is plate boundaries, a provincial border is a line of the same weight
 *   meaning something incomparably smaller, and the plate seams already cross
 *   it everywhere. Clutter, in Aaron's word, and he is right.
 *
 * `sustainCountryNames` — and this one is FORCED by the two above, not a
 *   separate taste. `ADMIN.nameLadder` fades country names out at z5 because
 *   state names have taken over by then; delete state names and that fade
 *   leaves a nameless map from z5 to where cities arrive at z6.4. The ladder's
 *   own stated invariant is that at least one name is on screen at every zoom,
 *   so a world dropping a rung has to lengthen the one below it. Sustained,
 *   country names hold from `countryIn` to the top of the zoom range.
 */
const ADMIN_DEFAULTS = Object.freeze({
  stateLines: true,
  stateNames: true,
  sustainCountryNames: false,
});

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
 * @param {object|null} opts.palette - A WORLD's basemap palette overrides
 *   (SPEC-GLOBES.md §38.1, `config/worlds/`). Omitted or null = the app's own
 *   theme palette, which is what the shipped app passes and therefore what it
 *   still gets, unchanged.
 * @param {{glow: string, core: string, hot: string, text: string}|null}
 *   opts.plates - A world's plate boundary colours, or null for a world that
 *   draws none. Part of the world's LAYER MANIFEST: passing colours is what
 *   turns the layers on, so there is no second flag that can disagree with them.
 * @param {object|null} opts.admin - A world's ADMINISTRATIVE FURNITURE
 *   overrides (`config/worlds/`). Omitted or null = the app's own ladder, which
 *   is what the shipped app passes and therefore what it still gets, byte for
 *   byte. See `ADMIN_DEFAULTS` for the three keys and what each one costs.
 * @returns {object} A MapLibre GL style specification.
 */
export function buildStyle({
  useR2 = TILES.useR2,
  palette: world = null,
  plates = null,
  admin = null,
  plateLayers = null,
  plateLabelLayers = null,
} = {}) {
  const A = admin ? { ...ADMIN_DEFAULTS, ...admin } : ADMIN_DEFAULTS;
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

  /* THE PLATE SEAMS ARE TWO MORE SOURCES, and only when a world asks for them.
   *
   * ==> THEY START EMPTY, AND THAT IS THE CHANGE. <== The seam source used to
   * point MapLibre straight at `GLOBE.plateBoundariesUrl` and let it fetch for
   * itself. It cannot any more: what gets drawn is no longer what is in the file
   * — it is the smoothed, named, side-displaced geometry `lib/plate-lines.js`
   * derives from it, and the Three globe draws the SAME derived geometry so the
   * two stay pixel-locked through the dive. One fetch, one build, two renderers.
   * `map/plate-seams.js` owns that and pushes the result in on `style.load`.
   *
   * An empty FeatureCollection rather than a missing source, so every layer
   * below is valid from the first frame and there is nothing to add later — a
   * layer referring to an absent source is a silently dropped layer.
   *
   * Declared inside the style rather than added imperatively, so a `setStyle` on
   * a world switch carries the declarations and only the data needs re-pushing. */
  if (plates) {
    sources.plates = { type: 'geojson', data: EMPTY_FC };
    sources[PLATE_LABEL_SOURCE] = { type: 'geojson', data: EMPTY_FC };
  }

  return {
    version: 8,
    name: 'Landfall Dark',

    /** EVERY THEMED COLOUR THE MAP DRAWS, AND THE ONLY PLACE A VALUE APPEARS.
     *  The basemap and the app's own storm layers both reference these through
     *  `gs()`; `map/theme-state.js` owns the list. These are only the DEFAULTS,
     *  so the style is correct the instant it is installed — after that
     *  `setGlobalState` is the only thing that writes them.
     *
     *  (The `landfall:seaColor` / `landfall:landColor` metadata pair that used
     *  to sit here went with the Deep rip. It published the two colours the
     *  shore mask compared against, and `proto/basemap-mask.js` — its only
     *  reader — no longer exists.) */
    state: stateBlock(world),

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
     *  atmosphere (`atmosphere`, §2), which is under our control and does not
     *  shade the sphere face. */
    sky: {
      'sky-color': gs('skyHigh'),
      'horizon-color': gs('atmosphere'),
      'fog-color': gs('skyLow'),
      'fog-ground-blend': 0.02,
      'horizon-fog-blend': 0.12,
      'sky-horizon-blend': 0.6,
      'atmosphere-blend': 0,
    },

    /* ==> NO BUILDER TAKES A PALETTE ANY MORE, AND THE RULE THAT SAID THEY
     * MUST STILL HOLDS — IT MOVED. <==
     *
     * Every builder used to call `palette()` for itself until 2026-07-29,
     * which is invisible and correct right up until a WORLD overrides the
     * basemap: the override reached the sky and nothing else, and the globe
     * kept 18 of its 21 colours blue. The fix was to resolve once and pass the
     * result down. Global state resolves that same problem harder: there is
     * now exactly one place a colour can come from and it is not a value at
     * all, it is a key. A builder CANNOT hold a stale palette because no
     * builder holds a palette.
     *
     * This file no longer imports `palette()` at all — the one call lives in
     * `map/theme-state.js` — so a builder cannot quietly reintroduce one and
     * start baking colours back in. `tools/token-check.mjs` holds every `gs()`
     * key in map/ against both palettes and against THEME_STATE, in both
     * directions. */
    layers: useR2
      ? protomapsLayers(plates, A, plateLayers)
      : openMapTilesLayers(plates, A, plateLayers, plateLabelLayers),
  };
}

/* ---------------------------------------------------------------------------
 * OPENMAPTILES (OpenFreeMap) — land is the background, ocean drawn on top.
 * ------------------------------------------------------------------------- */
function openMapTilesLayers(plates, A, plateLayers, plateLabelLayers) {
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
          [ZOOM.planet, gs('landFaint')],
          [ZOOM.regional, gs('land')],
          [ZOOM.local, gs('landHigh')],
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
        'fill-color': gs('ocean'),
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
        'fill-color': gs('ocean'),
        'fill-opacity': byZoom([
          [ZOOM.basin, 0],
          [ZOOM.regional, 0.9],
        ]),
      },
    },

    /* Borders sit UNDER the coast — the same rule the graticule follows. A
     * reference line crossing over a glowing coastline reads as an error. */
    ...adminLineLayers(A),

    ...(plateLayers ? plateLayers(plates) : []),

    /* Plate NAMES are not here. They are text, so they go with the other text
     * at the end of `placeLabelLayers` — which is also where their collision
     * order against the country names gets decided. See the note there. */

    /* The coast IS the ocean polygon's edge on this schema. */
    coastGlowLayer('water', OCEAN_ONLY),
    coastCoreLayer('water', OCEAN_ONLY),

    /* Names go OVER everything on the basemap: a label buried under a
     * coastline is not a label. Storm layers are added on top of this whole
     * style later and beat these on collision automatically — see the
     * placement-order note below. */
    ...placeLabelLayers(A, plates, plateLabelLayers),
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

/** THE WORD THE MAP ALREADY SAID. OpenMapTiles' English names for a lot of Asia
 *  carry the administrative noun glued on — "Shimane Prefecture", "Jilin
 *  Province", "Gangwon State". At the size these are set, that wraps to two
 *  lines and doubles the label's footprint to say something the reader already
 *  knew from the fact that it is a region on a map. Korea's own provinces come
 *  through as bare names ("Chagang", "Ryanggang") and read fine beside them,
 *  which is the proof the word is carrying nothing.
 *
 *  ONLY THE THREE BELOW, and only as a TRAILING word. Reported on glass
 *  2026-08-07 with all three visible in one frame.
 *
 *  Two words were deliberately LEFT OUT. "Region" and "Territory" are load
 *  bearing in real names — Australia's Northern Territory becomes "Northern",
 *  which is not a place. Stripping is only safe where no region is named for
 *  the noun alone, and the exceptions list below is the escape hatch for the
 *  one common counter-example to "State". */
const ADMIN_SUFFIXES = Object.freeze([' Prefecture', ' Province', ' State']);

/** Names that keep their suffix because the suffix IS the name. South Africa's
 *  Free State would otherwise render as "FREE". Compared against the raw name
 *  before any stripping happens. */
const ADMIN_SUFFIX_KEEP = Object.freeze(['Free State']);

/** Builds the text-field expression: `name` with a trailing admin noun removed.
 *
 *  `let`/`var` is not a style flourish here. Every clause below reads the name
 *  three times, and inlining `NAME_FIELD` into each would put a dozen copies of
 *  a three-deep coalesce into an expression MapLibre evaluates once per label
 *  per tile. Bind it once, read the variable.
 *
 *  ==> THE `> 0` GUARD IS NOT BELT AND BRACES. IT IS THE WHOLE THING. <==
 *  The end-of-string test is `index-of === length - suffixLength`, and
 *  `index-of` returns **-1** when the suffix is absent. For a name exactly one
 *  character SHORTER than the suffix, that difference is also -1, the test
 *  passes on a word that does not contain the suffix at all, and `slice(0, -1)`
 *  quietly eats the last letter. " State" is six characters, so this turned
 *  TEXAS into TEXA and IOWA into IOW. Caught by running the real names through
 *  the official expression parser before shipping; it would have looked like a
 *  typo on glass and sent somebody hunting in the tile data.
 *
 *  The `coalesce ... ''` is the same class of problem: a feature with no name
 *  in any of the three fields binds `null`, and `length` on null is a hard
 *  expression error that takes the whole layer down, not a blank label.
 *
 *  Clauses are FLAT rather than chained — a name has at most one of these
 *  words, so testing each against the original keeps the expression linear
 *  instead of nesting it into an exponential blowup. */
function withoutAdminSuffix(field) {
  const name = ['var', 'adminName'];
  const clauses = [];
  for (const suffix of ADMIN_SUFFIXES) {
    clauses.push(
      [
        'all',
        ['>', ['index-of', suffix, name], 0],
        ['==', ['index-of', suffix, name], ['-', ['length', name], suffix.length]],
      ],
      ['slice', name, 0, ['index-of', suffix, name]]
    );
  }
  return [
    'let',
    'adminName',
    ['coalesce', field, ''],
    [
      'case',
      ['in', name, ['literal', [...ADMIN_SUFFIX_KEEP]]], name,
      ...clauses,
      name,
    ],
  ];
}

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
 *  `map.getLayer('place-sate')` returns undefined and the toggle just does
 *  nothing. Naming them removes that whole failure mode.
 *
 *  THREE OF THESE FIVE HAVE NO TOGGLE. Both border LINES are structural —
 *  hairlines that cost nothing visually and answer "which state is this" by
 *  their existence; switching them off would delete information and buy back
 *  almost no pixels.
 *
 *  COUNTRY NAMES have no toggle either, and that is the one exception to
 *  "text is what toggles". They are not decoration, they are a RUNG on the
 *  name ladder: for roughly one zoom level they are the only label on the
 *  map, and removing them would leave a bare unnamed globe in exactly the
 *  band the ladder exists to fill. A control whose off state breaks the
 *  design's own invariant should not exist.
 *
 *  ==> AND ONE OF THESE FIVE LAYERS IS NOW OPTIONAL, WHICH THE TOGGLE ABOVE
 *  DOES NOT KNOW. <== A world can decline state names entirely
 *  (`ADMIN_DEFAULTS`), and Deep does. `setAdminVisible` is already safe about it
 *  — it guards on `getLayer`, so the call is a no-op rather than a throw — but
 *  SAFE IS NOT THE SAME AS HONEST: whoever wires Deep into the real drawer has
 *  to hide the "state names" switch on that world, or ship a control that
 *  silently does nothing (§5). Not built here because there is no caller yet;
 *  the prototype has no drawer. Flagged in NOW.md so it is not discovered on a
 *  phone. */
export const ADMIN_LAYER = Object.freeze({
  countryLine: 'admin-country',
  stateLine: 'admin-state',
  countryName: 'place-country',
  stateName: 'place-state',
  city: 'place-city',
});

/** Show/hide the toggleable admin layers — the NAME layers, and only those.
 *  Same shape as `setGraticuleVisible` DELIBERATELY: §12, one mechanism for
 *  basemap visibility rather than a second one that drifts from the first.
 *  `getLayer` guards because the Protomaps path never creates these, so a call
 *  with `useR2` on must be a no-op rather than a throw. */
export function setAdminVisible(map, { stateNames, cities }) {
  const apply = (id, on) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  };
  apply(ADMIN_LAYER.stateName, stateNames);
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

/**
 * A WORLD THAT SAYS NO GETS NO LAYER, rather than a hidden one.
 *
 * `setAdminVisible` hides a layer by setting `visibility: none`, which is right
 * for a user's toggle — the layer is still there and the toggle can put it back.
 * A world declining a whole class of furniture is a different statement: nothing
 * should ever turn Deep's state borders on, so MapLibre should not be laying
 * them out, filtering them, or holding their glyphs. Absent, not invisible.
 */
function adminLineLayers(A) {
  return [
    /** National borders. Drawn beneath state lines so that where the two
     *  coincide — the whole northern and southern US border — the stronger
     *  line is the one on top. */
    {
      id: ADMIN_LAYER.countryLine,
      type: 'line',
      source: 'basemap',
      'source-layer': 'boundary',
      minzoom: ADMIN.countryLineIn,
      filter: ['all', atLevel(ADMIN.levelCountry), NOT_MARITIME, LINES_ONLY, NOT_ABORIGINAL],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': gs('adminCountry'),
        'line-width': SIZE.adminLineWidthCountry,
        'line-opacity': byZoom([
          [ADMIN.countryLineIn, 0],
          [ADMIN.countryLineIn + ADMIN.fadeSpan, 1],
        ]),
      },
    },

    /** State and province divides. The mark that answers "which state is this
     *  heading for" — a question nothing else on this map could answer, and a
     *  question Deep never asks. */
    ...(A.stateLines
      ? [
          {
            id: ADMIN_LAYER.stateLine,
            type: 'line',
            source: 'basemap',
            'source-layer': 'boundary',
            minzoom: ADMIN.stateLineIn,
            filter: ['all', atLevel(ADMIN.levelState), NOT_MARITIME, LINES_ONLY, NOT_ABORIGINAL],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': gs('adminState'),
              'line-width': SIZE.adminLineWidth,
              'line-opacity': byZoom([
                [ADMIN.stateLineIn, 0],
                [ADMIN.stateLineIn + ADMIN.fadeSpan, 1],
              ]),
            },
          },
        ]
      : []),
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
function placeLabelLayers(A, plates, plateLabelLayers) {
  /** UP, HOLD, DOWN — the shipped ladder. The rise overlaps the cage's last
   *  third; the fall begins AFTER state names have already started rising, so
   *  the two are briefly on screen together rather than swapping. */
  const countryFade = byZoom([
    [ADMIN.nameLadder.countryIn[0], 0],
    [ADMIN.nameLadder.countryIn[1], 1],
    [ADMIN.nameLadder.countryOut[0], 1],
    [ADMIN.nameLadder.countryOut[1], 0],
  ]);

  /** UP AND STAY UP — for a world with no state names to hand over to. The rise
   *  is IDENTICAL, deliberately: a world changes when a rung ENDS, never when it
   *  begins, so the two ladders are indistinguishable until the handoff would
   *  have happened and there is no moment where Deep's country names appear at a
   *  different time from Sky's. */
  const countrySustain = byZoom([
    [ADMIN.nameLadder.countryIn[0], 0],
    [ADMIN.nameLadder.countryIn[1], 1],
  ]);

  return [
    /** Country names. On the shipped ladder they exist for ONE PURPOSE: to fill
     *  the window between the node mesh clearing and state names arriving, so
     *  the globe is never a nameless shape. In and then straight back out —
     *  `maxzoom` retires the layer at the exact zoom its opacity reaches zero,
     *  so past the handoff MapLibre stops laying out text nobody can see.
     *
     *  SUSTAINED, THEY BECOME THE WHOLE LADDER, and the `maxzoom` has to go with
     *  the fade — leaving it in place would retire the layer at z5 no matter
     *  what the opacity ramp said, which is the same bug in a different
     *  property and would be invisible in the constants. */
    {
      id: ADMIN_LAYER.countryName,
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'place',
      minzoom: ADMIN.nameLadder.countryIn[0],
      ...(A.sustainCountryNames ? {} : { maxzoom: ADMIN.nameLadder.countryOut[1] }),
      filter: ['==', ['get', 'class'], 'country'],
      layout: {
        'text-field': NAME_FIELD,
        'text-font': ['Noto Sans Regular'],
        'text-size': SIZE.countryLabelPx,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.16,
        'text-max-width': 8,
        'symbol-sort-key': ['to-number', ['coalesce', ['get', 'rank'], 99]],
      },
      paint: {
        'text-color': gs('textCountry'),
        'text-halo-color': gs('land'),
        'text-halo-width': SIZE.placeLabelHaloPx,
        'text-opacity': A.sustainCountryNames ? countrySustain : countryFade,
      },
    },

    /** Major cities. `rank` is the whole filter: the schema ranks notable
     *  places 1..10 and leaves everything else UNRANKED, so requiring a rank
     *  is what makes "major" a real category instead of an arbitrary cutoff.
     *  `has` guards the comparison — `to-number` on a missing rank would throw
     *  and take the layer with it.
     *
     *  ==> PLACED ABOVE STATE NAMES ON PURPOSE (2026-08-07). <== MapLibre lays
     *  symbols out from the top layer down and first placed wins, so this is
     *  what guarantees a town keeps its label on a crowded coast even with a
     *  bold state name crossing the same ground. The full reasoning is on the
     *  state block below; the short version is that the two only share the
     *  screen while the state name is already leaving. */
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
        'text-color': gs('textPlace'),
        'text-halo-color': gs('ocean'),
        'text-halo-width': SIZE.placeLabelHaloPx,
        'text-opacity': byZoom([
          [ADMIN.cityIn, 0],
          [ADMIN.cityIn + ADMIN.fadeSpan, 1],
        ]),
      },
    },

    /** State and province names. THE LOUDEST PLACE LABEL ON THE MAP, and that
     *  is the decision (2026-08-07): same colour and same ocean halo as a city
     *  name — one ink for "a place" — but BOLD, uppercase, letterspaced and a
     *  size up. Colour is doing no work here; weight and case carry the whole
     *  difference, which is what keeps a state reading as a REGION and a city
     *  as a POINT even at a glance on a phone.
     *
     *  The letterspacing is not decoration. Caps set tight are a solid brick;
     *  0.14 is what makes "MISSISSIPPI" scan as a word.
     *
     *  ==> DRAWN BELOW CITIES, SO A CITY WINS EVERY COLLISION. <== That order
     *  was the other way round for about an hour on 2026-08-07 and it cost city
     *  labels on a crowded coast. It reads backwards — the loudest label
     *  yielding to the quietest — and it is right: from `stateIn` to `cityIn`
     *  there are no cities to lose to, so a state never yields while it is the
     *  label that matters; past `cityIn` it is on its way out anyway, and the
     *  name somebody is navigating by is the town.
     *
     *  Rises BEFORE country names start to leave, and falls AFTER city names
     *  start to arrive. Both ends overlap their neighbour — that is the ladder.
     *  `maxzoom` retires the layer at the exact zoom the fade reaches nothing,
     *  the same pairing country names use; leaving it off would have MapLibre
     *  laying out invisible text for every zoom past 7.4. */
    ...(A.stateNames
      ? [
          {
            id: ADMIN_LAYER.stateName,
            type: 'symbol',
            source: 'basemap',
            'source-layer': 'place',
            minzoom: ADMIN.nameLadder.stateIn[0],
            maxzoom: ADMIN.nameLadder.stateOut[1],
            filter: ['in', ['get', 'class'], ['literal', ['state', 'province']]],
            layout: {
              /* The ONLY layer that strips the trailing admin noun. Country
               * names never carry one and city names are points, not regions —
               * "Prefecture" is a state-level problem and the fix stays there
               * rather than becoming a global rule that quietly rewrites every
               * label on the map. */
              'text-field': withoutAdminSuffix(NAME_FIELD),
              /* The ONE bold fontstack in the app. Verified present on the
               * OpenFreeMap glyph server (`glyphs` above) — its own shipped
               * styles use it. A fontstack that 404s does not fall back, it
               * draws nothing, so this name is not a thing to guess at. */
              'text-font': ['Noto Sans Bold'],
              'text-size': SIZE.stateLabelPx,
              'text-transform': 'uppercase',
              'text-letter-spacing': 0.14,
              'text-max-width': 7,
              'symbol-sort-key': ['to-number', ['coalesce', ['get', 'rank'], 99]],
            },
            paint: {
              /* Deliberately IDENTICAL to the city layer below — same ink,
               * same halo colour, same halo width. There is no `textState`
               * token any more; it was retired when the two labels merged
               * onto one colour. */
              'text-color': gs('textPlace'),
              'text-halo-color': gs('ocean'),
              'text-halo-width': SIZE.placeLabelHaloPx,
              'text-opacity': byZoom([
                [ADMIN.nameLadder.stateIn[0], 0],
                [ADMIN.nameLadder.stateIn[1], 1],
                [ADMIN.nameLadder.stateOut[0], 1],
                [ADMIN.nameLadder.stateOut[1], 0],
              ]),
            },
          },
        ]
      : []),

    /* PLATE NAMES ARE LAST IN THIS LIST, AND THE ORDER IS THE DECISION.
     *
     * MapLibre places symbols from the TOP layer down, and whoever is placed
     * first wins every collision below (see the note at the head of this
     * section). Last in the array is bottom-most, so a plate name YIELDS to a
     * country name, a state name and a city name — every time, at every zoom.
     *
     * That is the right way round even on the globe whose whole subject is
     * plates. A country name tells you where you are looking; a plate name tells
     * you what you are looking at, and there are always several copies of it
     * along the seam, so losing one to Ecuador costs nothing. Losing "ECUADOR"
     * to a repeat of "NAZCA" would cost the thing you were navigating by. */
    ...(plateLabelLayers ? plateLabelLayers(plates) : []),
  ];
}

/* ---------------------------------------------------------------------------
 * PROTOMAPS (R2, once built) — ocean is the background, land drawn on top.
 * ------------------------------------------------------------------------- */
function protomapsLayers(plates, A, plateLayers) {
  return [
    {
      id: 'ocean',
      type: 'background',
      paint: { 'background-color': gs('ocean') },
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
          [ZOOM.planet, gs('land')],
          [ZOOM.local, gs('landHigh')],
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
        'fill-color': gs('ocean'),
        'fill-opacity': byZoom([
          [ZOOM.basin, 0],
          [ZOOM.regional, 0.9],
        ]),
      },
    },
    /* The coast IS the land polygon's edge on this schema. */
    ...(plateLayers ? plateLayers(plates) : []),

    /* Plate NAMES are not here. They are text, so they go with the other text
     * at the end of `placeLabelLayers` — which is also where their collision
     * order against the country names gets decided. See the note there. */

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


/**
 * THE COASTLINE'S WIDTH CURVES, EXTRACTED — because a second caller appeared.
 *
 * map/layers/watch-warning.js paints the warning stripe as THE COASTLINE
 * RESTROKED, so it needs the coast's own zoom curve rather than a width of its
 * own. It had a width of its own (a flat 8 px) and that is exactly how the
 * stripe ended up five times the width of the line it was covering; see
 * `SIZE.stripeCoreScale`. Both callers now read these, so the depth fade
 * cannot be inherited by only one of them.
 *
 * `scale` multiplies the whole curve. 1 is the coastline itself.
 */
export const coastCoreWidth = (scale = 1) =>
  byZoom([
    [ZOOM.planet, SIZE.coastWidthCore * 0.65 * scale],
    [ZOOM.basin, SIZE.coastWidthCore * scale],
    [ZOOM.local, SIZE.coastWidthCore * 1.9 * scale],
  ]);

export const coastGlowWidth = (scale = 1) =>
  byZoom([
    [ZOOM.planet, SIZE.coastWidthGlow * 0.6 * scale],
    [ZOOM.basin, SIZE.coastWidthGlow * scale],
    [ZOOM.local, SIZE.coastWidthGlow * 1.6 * scale],
  ]);

/** The coast glow's blur, on the same terms. A warning stripe that replaces
 *  the halo has to replace its softness too — a hard-edged underlay at glow
 *  width is a second stripe, not a halo. */
export const coastGlowBlur = () =>
  byZoom([
    [ZOOM.planet, 2],
    [ZOOM.local, 5],
  ]);

function coastGlowLayer(sourceLayer, filter) {
  const layer = {
    id: 'coast-glow',
    type: 'line',
    source: 'basemap',
    'source-layer': sourceLayer,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': gs('coastGlowSoft'),
      'line-width': coastGlowWidth(),
      'line-opacity': byZoom([
        [ZOOM.planet, OPACITY.coastGlow * 0.7],
        [ZOOM.regional, OPACITY.coastGlow],
        [ZOOM.max, OPACITY.coastGlow * 0.8],
      ]),
      'line-blur': coastGlowBlur(),
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
      'line-color': gs('coastGlow'),
      'line-width': coastCoreWidth(),
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
