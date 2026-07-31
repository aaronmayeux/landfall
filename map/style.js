/**
 * style.js — the MapLibre style JSON for the globe, in whichever theme is live.
 *
 * WAS style-dark.js. It stopped being dark-only when light mode landed: every
 * colour below now comes from `palette()` at BUILD TIME, and a theme change
 * rebuilds the whole style object and hands it to map.setStyle (see main.js).
 * A MapLibre style is a plain data structure — rebuilding it is cheap, and it
 * is far simpler than walking every layer with setPaintProperty and hoping the
 * list stayed complete.
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
import { palette } from '../config/theme.js';
import { ZOOM, TILES, ADMIN, PLATE_LINE } from '../config/constants.js';

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
} = {}) {
  const A = admin ? { ...ADMIN_DEFAULTS, ...admin } : ADMIN_DEFAULTS;
  /* The live palette, read fresh on every build — a theme change rebuilds
   * this whole style object. Never hoisted to module scope (see theme.js).
   *
   * A WORLD LAYERS OVER IT RATHER THAN REPLACING IT, and that is a safety
   * property, not a convenience. A world states only the colours it changes,
   * so a key added to this file later resolves to the app's value instead of
   * `undefined` — which in a MapLibre paint property is not an error, it is a
   * silently rejected layer (see tools/token-check.mjs for the outage that
   * taught us). `tools/token-check.mjs` separately asserts that every world
   * covers every key read below, so "resolves to blue" is caught at check
   * time rather than looked at on a phone. */
  const themed = palette();
  const P = world ? { ...themed, ...world } : themed;
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

    /** ==> THE TWO COLOURS THE SHORE MASK COMPARES AGAINST, PUBLISHED HERE
     *  BECAUSE THIS IS WHERE THEY ARE RESOLVED. <== `proto/basemap-mask.js`
     *  decides where the sea stops by asking, per pixel, whether the basemap
     *  underneath is the ocean's colour or the land's. It has to be the SAME
     *  pair the basemap was actually painted with, and after a world layers its
     *  overrides on top of the theme that pair only exists inside this
     *  function. Handing it to the mask through a separate wiring call would be
     *  a second place to keep in step by hand — and a world switch that changed
     *  the palette without telling the mask would cut the shoreline in the
     *  wrong place with nothing on screen saying why.
     *
     *  `land` is `landHigh` and not the zoom ramp: the mask only exists above
     *  `VOLCANO.map3d.handoff`, which starts at `ZOOM.local` — the ramp's last
     *  stop. So this is exact in the range where it is read, not an
     *  approximation of it.
     *
     *  A style's `metadata` is free-form by spec and MapLibre carries it
     *  through untouched. */
    metadata: {
      'landfall:seaColor': P.ocean,
      'landfall:landColor': P.landHigh,
    },
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
      'sky-color': P.skyHigh,
      'horizon-color': P.atmosphere,
      'fog-color': P.skyLow,
      'fog-ground-blend': 0.02,
      'horizon-fog-blend': 0.12,
      'sky-horizon-blend': 0.6,
      'atmosphere-blend': 0,
    },

    /* THE PALETTE IS HANDED DOWN, NEVER RE-RESOLVED. Every builder below took
     * its own `palette()` until 2026-07-29, which is invisible and correct
     * right up until a WORLD overrides the basemap: the override reached the
     * sky and nothing else, and the globe kept 18 of its 21 colours blue.
     * A parameter makes the dependency visible in the signature, and
     * `tools/token-check.mjs` asserts this file holds exactly ONE `palette()`
     * call so a seventh builder cannot quietly reintroduce it. */
    layers: useR2 ? protomapsLayers(P, plates, A) : openMapTilesLayers(P, plates, A),
  };
}

/* ---------------------------------------------------------------------------
 * OPENMAPTILES (OpenFreeMap) — land is the background, ocean drawn on top.
 * ------------------------------------------------------------------------- */
function openMapTilesLayers(P, plates, A) {
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
          [ZOOM.planet, P.landFaint],
          [ZOOM.regional, P.land],
          [ZOOM.local, P.landHigh],
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
        'fill-color': P.ocean,
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
        'fill-color': P.ocean,
        'fill-opacity': byZoom([
          [ZOOM.basin, 0],
          [ZOOM.regional, 0.9],
        ]),
      },
    },

    /* Borders sit UNDER the coast — the same rule the graticule follows. A
     * reference line crossing over a glowing coastline reads as an error. */
    ...adminLineLayers(P, A),

    ...plateLayers(plates),

    /* Plate NAMES are not here. They are text, so they go with the other text
     * at the end of `placeLabelLayers` — which is also where their collision
     * order against the country names gets decided. See the note there. */

    /* The coast IS the ocean polygon's edge on this schema. */
    coastGlowLayer(P, 'water', OCEAN_ONLY),
    coastCoreLayer(P, 'water', OCEAN_ONLY),

    /* Names go OVER everything on the basemap: a label buried under a
     * coastline is not a label. Storm layers are added on top of this whole
     * style later and beat these on collision automatically — see the
     * placement-order note below. */
    ...placeLabelLayers(P, A, plates),
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
function adminLineLayers(P, A) {
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
        'line-color': P.adminCountry,
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
              'line-color': P.adminState,
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
function placeLabelLayers(P, A, plates) {
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
        'text-color': P.textCountry,
        'text-halo-color': P.land,
        'text-halo-width': SIZE.placeLabelHaloPx,
        'text-opacity': A.sustainCountryNames ? countrySustain : countryFade,
      },
    },

    /** State and province names. Uppercase and letterspaced — the same
     *  treatment the storm name gets, one notch quieter, because an area label
     *  should read as a region rather than as a point. Begins rising BEFORE
     *  country names start to leave — the overlap is the point. */
    ...(A.stateNames
      ? [
          {
            id: ADMIN_LAYER.stateName,
            type: 'symbol',
            source: 'basemap',
            'source-layer': 'place',
            minzoom: ADMIN.nameLadder.stateIn[0],
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
              'text-color': P.textState,
              'text-halo-color': P.land,
              'text-halo-width': SIZE.placeLabelHaloPx,
              'text-opacity': byZoom([
                [ADMIN.nameLadder.stateIn[0], 0],
                [ADMIN.nameLadder.stateIn[1], 1],
              ]),
            },
          },
        ]
      : []),

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
        'text-color': P.textPlace,
        'text-halo-color': P.ocean,
        'text-halo-width': SIZE.placeLabelHaloPx,
        'text-opacity': byZoom([
          [ADMIN.cityIn, 0],
          [ADMIN.cityIn + ADMIN.fadeSpan, 1],
        ]),
      },
    },

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
    ...plateLabelLayers(plates),
  ];
}

/* ---------------------------------------------------------------------------
 * PROTOMAPS (R2, once built) — ocean is the background, land drawn on top.
 * ------------------------------------------------------------------------- */
function protomapsLayers(P, plates, A) {
  return [
    {
      id: 'ocean',
      type: 'background',
      paint: { 'background-color': P.ocean },
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
          [ZOOM.planet, P.land],
          [ZOOM.local, P.landHigh],
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
        'fill-color': P.ocean,
        'fill-opacity': byZoom([
          [ZOOM.basin, 0],
          [ZOOM.regional, 0.9],
        ]),
      },
    },
    /* The coast IS the land polygon's edge on this schema. */
    ...plateLayers(plates),

    /* Plate NAMES are not here. They are text, so they go with the other text
     * at the end of `placeLabelLayers` — which is also where their collision
     * order against the country names gets decided. See the note there. */

    coastGlowLayer(P, 'earth', null),
    coastCoreLayer(P, 'earth', null),
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

/* ---------------------------------------------------------------------------
 * PLATE BOUNDARIES (SPEC-GLOBES.md §43.2) — MAGMA. Three passes, and the third
 * one is what turns an orange line into molten rock.
 *
 * ==> THIS EXISTS BECAUSE THE THREE GLOBE'S SEAMS CANNOT REACH THE GROUND. <==
 * They faded out on `DIVE.fade.cage` and nothing down here replaced them, so
 * plate boundaries were visible from the space floor to about z3.9 and then
 * simply gone for the rest of the zoom range. The fix is the one the coastline
 * has always used: the SAME feature exists in BOTH renderers, pixel-locked by
 * `map/globe-follow.js`, and the crossfade hands one to the other. Three's
 * copy now leaves on `DIVE.fade.land` alongside the coastline it is paired
 * with, exactly where these come up to full.
 *
 * ---------------------------------------------------------------------------
 * WHY THREE LAYERS AND NOT A BLOOM PASS. This is the whole technique.
 *
 * Hot things do not glow evenly. A magma seam is a near-white core inside a
 * bright orange body inside a wide dim red spread, and stacking three passes
 * from widest-and-dimmest to thinnest-and-brightest is how you draw that. It
 * shipped with only the outer two, which is an orange line with a hint of
 * warmth behind it — the near-white core is the layer that says "this is hotter
 * than anything else on the map".
 *
 * A POST-PROCESS BLOOM WAS THE OTHER OPTION AND IT IS DISQUALIFIED ON MOBILE.
 * Arm measure their own bloom pipeline at ~3 ms a frame at full resolution —
 * roughly a fifth of the entire 16.6 ms budget — because a blur has to read
 * pixels from outside its own tile, which breaks the tile-local memory
 * behaviour that makes phone GPUs efficient at all. Their published
 * alternatives are baking the glow into a texture and using camera-facing glow
 * geometry, and a widened blurred line layer IS the second one. The cheap way
 * and the vendor-recommended way are the same way here, which is rare enough
 * to be worth saying out loud.
 *
 * NOTHING ANIMATES. A shimmer would sell this hard and it stays out of MapLibre
 * on purpose: animating a paint property means calling `setPaintProperty` every
 * frame, and every one of those frames makes MapLibre redraw the whole map. The
 * app is idle-cheap today precisely because that does not happen. Deep DOES
 * shimmer its seams — in the Three shader, from space, where the renderer is
 * already drawing every frame and the effect is nearly free (see
 * `proto/world-deep.js` SEAM_FRAG). Decided 2026-07-30.
 *
 * ---------------------------------------------------------------------------
 * BENEATH THE COASTLINE, for the reason the borders and the graticule are:
 * a reference line crossing OVER a glowing coastline reads as an error. No
 * world currently draws both these and the graticule, so their relative order
 * is undecided rather than wrong — decide it when one does.
 *
 * TOLD APART FROM THE COAST BY THREE THINGS, NOT ONE. Hue is the loud one, but
 * width and opacity carry it for anyone who cannot use the hue. See the note on
 * `SIZE.plateWidthScale`.
 *
 * ==> AND THE HOT CORE IS THE ONE THING HERE THAT COULD COLLIDE WITH A FIXED
 * HAZARD RAMP. <== This globe's own hazard is earthquakes, and USGS MMI runs
 * `#ffaa00` → `#fd0000`. The core is deliberately a near-WHITE rather than a
 * brighter orange, so it sits off the end of that ramp instead of on top of it.
 * The rule that actually protects this, from `config/worlds/deep.js`: quake
 * severity on Deep is size and ripple strength, never hue.
 * ------------------------------------------------------------------------- */

function plateLayers(plates) {
  if (!plates) return [];
  /** One pass's width at one zoom step. Every plate width in the file goes
   *  through here, so the three passes share a base and a floor and the
   *  stair-step between them is exactly `SIZE.plateStack`.
   *
   *  FLOORED, AND IT STAYS FLOORED EVEN THOUGH NOTHING IS NEAR IT TODAY.
   *  `plateWidthScale` is a multiplier someone retunes on glass, and at 0.7 the
   *  core's planet-band stop came out at 0.63 px — a line MapLibre draws
   *  perfectly and nobody can see. The guard costs nothing at 2.8 and is the
   *  whole difference at the next value someone tries. Depth fade therefore
   *  lives in the opacity ramps as well as the widths. */
  const plateW = (mult, zoomStep) =>
    Math.max(SIZE.hairlineFloor, SIZE.coastWidthCore * SIZE.plateWidthScale * mult * zoomStep);
  return [
    /** THE OUTER HEAT — wide, heavily blurred, low opacity. Not a line: the
     *  light a hot line throws onto the rock around it. This is the layer that
     *  makes the seam read as a source of light rather than a stroke. */
    {
      id: 'plate-glow',
      type: 'line',
      source: 'plates',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': plates.glow,
        /* ==> WIDTH COMES FROM `SIZE.plateStack`, NOT FROM THE COAST GLOW. <==
         * It used to derive from `coastWidthGlow`, which put it at almost exactly
         * the same width as the body pass below — three layers at two widths,
         * which reads as one line. The stack ratios are stated in one place now
         * so the steps cannot drift back together. */
        'line-width': byZoom([
          [ZOOM.planet, plateW(SIZE.plateStack.heat, 0.6)],
          [ZOOM.basin, plateW(SIZE.plateStack.heat, 1)],
          [ZOOM.local, plateW(SIZE.plateStack.heat, 1.6)],
        ]),
        'line-opacity': byZoom([
          [ZOOM.planet, OPACITY.plateGlow * 0.7],
          [ZOOM.regional, OPACITY.plateGlow],
          [ZOOM.max, OPACITY.plateGlow * 0.8],
        ]),
        /* MORE BLUR THAN THE COAST GETS, AND MORE THAN THIS USED TO HAVE. A
         * boundary is a diffuse deformation zone; the softness is the honest
         * part of the picture, not the decoration. */
        'line-blur': byZoom([
          [ZOOM.planet, 3],
          [ZOOM.local, 9],
        ]),
      },
    },

    /** THE MAGMA BODY — the layer that was called the core until there was a
     *  real core above it. Bright orange, lightly blurred so it bleeds into the
     *  outer heat instead of ending on an edge. */
    {
      id: 'plate-core',
      type: 'line',
      source: 'plates',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': plates.core,
        'line-width': byZoom([
          [ZOOM.planet, plateW(SIZE.plateStack.body, 0.6)],
          [ZOOM.basin, plateW(SIZE.plateStack.body, 1)],
          [ZOOM.local, plateW(SIZE.plateStack.body, 1.6)],
        ]),
        'line-opacity': byZoom([
          [ZOOM.planet, OPACITY.plateCore * 0.44],
          [ZOOM.basin, OPACITY.plateCore * 0.76],
          [ZOOM.regional, OPACITY.plateCore],
        ]),
        'line-blur': byZoom([
          [ZOOM.planet, 1],
          [ZOOM.local, 4],
        ]),
      },
    },

    /** THE SUPERHEATED CORE — thin, unblurred, full strength, near-white.
     *
     *  NO BLUR AT ALL, deliberately: a blurred core is just a second body layer,
     *  and the whole reason this reads as heat is the hard bright line inside
     *  the soft one. Kept NARROWER than the body at every zoom by construction
     *  — the widths derive from the same coast width so they cannot cross — and
     *  floored like the body, since a sub-pixel white line is anti-aliased down
     *  to nothing and this is the layer whose absence is most obvious.
     *
     *  IT ARRIVES LAST. At the planet band a 1 px white line on a 12 px orange
     *  band would be the brightest thing on a globe you are still orienting on,
     *  and the seam network would out-shout the coastline. The opacity ramp
     *  holds it back until the basin band, where you have committed to looking
     *  at plates. */
    {
      id: 'plate-hot',
      type: 'line',
      source: 'plates',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': plates.hot,
        'line-width': byZoom([
          [ZOOM.planet, plateW(SIZE.plateStack.hot, 0.75)],
          [ZOOM.basin, plateW(SIZE.plateStack.hot, 1)],
          [ZOOM.local, plateW(SIZE.plateStack.hot, 1.5)],
        ]),
        'line-opacity': byZoom([
          [ZOOM.planet, OPACITY.plateHot * 0.25],
          [ZOOM.basin, OPACITY.plateHot * 0.8],
          [ZOOM.regional, OPACITY.plateHot],
        ]),
      },
    },
  ];
}

/* ---------------------------------------------------------------------------
 * PLATE NAMES — one on each side of every seam, bending along it.
 *
 * ==> THE SIDE IS CARRIED BY THE GEOMETRY, NOT BY `text-offset`. <== The full
 * reasoning is in `lib/plate-lines.js`, and the short version is that MapLibre
 * flips a line label end-for-end when it would otherwise read upside down, and
 * the flip takes `text-offset` with it — so a pixel-constant offset puts the
 * Pacific plate over California as soon as you turn the globe. `plate-labels`
 * therefore holds lines that are ALREADY displaced to one side or the other,
 * each carrying only its own plate's name, and these layers add no offset at
 * all. Measured against real MapLibre 5.6.0 before it was built this way.
 *
 * TWO LAYERS, ONE PER DISPLACEMENT BAND. A geographic displacement is not
 * pixel-constant, so the source carries a `far` copy and a `near` copy and
 * these crossfade between them around `PLATE_LINE.labelBand`. Both layers are
 * otherwise identical, which is why they are built by one function.
 *
 * THE TIER LADDER IS WHAT MAKES THIS LEGIBLE. Fifty-two plates all labelling at
 * the planet band is fifty-two labels the collision pass throws away, and which
 * ones survive is an accident of placement order. `tier` ranks each plate by how
 * much boundary it owns, `symbol-sort-key` makes the big ones win every
 * collision, and the per-tier opacity ramp keeps fragments off the screen until
 * there is room. Aaron's requirement was a name visible at any zoom AND any
 * rotation; the repeat spacing is the other half of that — several candidates
 * per seam means turning the globe swaps which copy you see rather than losing
 * the name.
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * TWO ZOOM RAMPS, ONE EXPRESSION — AND MAPLIBRE INSISTS.
 *
 * A plate label's opacity is the product of two zoom curves: its TIER's arrival
 * ramp, and its displacement BAND's crossfade. The obvious way to write that is
 * `['*', bandRamp, tierRamp]`, and MapLibre rejects it outright:
 *
 *   layers[11].paint.text-opacity: Only one zoom-based "step" or "interpolate"
 *   subexpression may be used in an expression.
 *
 * ==> AND THE FAILURE IS NOT LOCAL. <== An invalid paint property does not
 * disable one layer, it rejects the whole STYLE — `style.load` never fires,
 * `getStyle()` stays undefined, and the map draws absolutely nothing. Caught in
 * a headless run rather than on a phone, which is the entire reason that harness
 * exists; on glass it would have presented as "the prototype is blank".
 *
 * SO THE PRODUCT IS COMPUTED HERE, IN JAVASCRIPT, and handed over as a single
 * zoom ramp whose stop VALUES vary by tier. One `interpolate` over zoom, with a
 * `case` on the feature's own tier at each stop — which is MapLibre's supported
 * zoom-and-property composite form, and the only shape that expresses this.
 *
 * SAMPLED AT EVERY BREAKPOINT OF BOTH CURVES, so the result is exact wherever
 * either curve turns. Between two breakpoints the true product is quadratic
 * (both ramps moving at once) and this draws it straight; the error peaks at a
 * few percent of an opacity nobody is measuring.
 * ------------------------------------------------------------------------- */

/** Linear 0 to 1 from `a` to `b`, clamped — the shape every ramp in this file
 *  has, evaluated in JS rather than by MapLibre. */
const ramp = (z, a, b) => Math.max(0, Math.min(1, (z - a) / (b - a)));

/* ---------------------------------------------------------------------------
 * PLATE NAMES — the two plates of a seam, PAIRED at one point on it.
 *
 * ==> `line-center`, NOT `line`. THIS IS THE WHOLE PLACEMENT DECISION. <== With
 * `symbol-placement: 'line'` MapLibre repeats a label every `symbol-spacing`
 * pixels along its line and each side is placed independently. On glass that gave
 * five copies of AFRICA down the Mid-Atlantic Ridge with no relationship between
 * the two sides, so reading a boundary meant hunting for its other name.
 *
 * `line-center` places exactly ONE label per feature, at the centre of that
 * feature's line. So `lib/plate-lines.js` hands over short windows of the curve —
 * one per side, both centred on the same anchor point — and the two names land
 * opposite each other across the seam and read as a pair in one glance. Density
 * is then a property of how many anchors exist (`PLATE_LINE.labelBands`), which
 * is a number in the constants file rather than an emergent property of a pixel
 * spacing.
 *
 * THREE LAYERS, ONE PER DISPLACEMENT BAND. A geographic displacement is not
 * pixel-constant (see `lib/plate-lines.js` for why the pixel-constant mechanism
 * cannot be used at all), so each band carries its own offset, window length and
 * anchor spacing, and they crossfade. All three layers are otherwise identical,
 * which is why one function builds them.
 *
 * THE TIER LADDER IS WHAT MAKES THIS LEGIBLE. Fifty-two plates all labelling at
 * the planet band is fifty-two labels the collision pass throws away, and which
 * ones survive is an accident of placement order. `tier` ranks each plate by how
 * much boundary it owns, `symbol-sort-key` makes the big ones win every
 * collision, and the per-tier opacity ramp keeps fragments off the screen until
 * there is room.
 * ------------------------------------------------------------------------- */

function plateLabelLayers(plates) {
  if (!plates) return [];

  const half = PLATE_LINE.bandOverlap / 2;
  const bands = PLATE_LINE.labelBands;

  /** A band's own fade, driven by the SHARED handover zooms.
   *
   *  ==> BOTH SIDES OF A HANDOVER READ THE SAME NUMBER, AND THAT IS THE FIX. <==
   *  Each band used to carry its own `from` and `to`, so the outgoing band faded
   *  out around ITS edge while the incoming one faded in around a different one
   *  0.2 away — at z3.75 the two summed to 1.12 and every plate name was drawn
   *  one and a bit times over. Reading `bands[i-1].until` for the rise and
   *  `bands[i].until` for the fall makes the two ramps exact complements by
   *  construction rather than by two constants agreeing.
   *
   *  The first band never fades in and the last never fades out, so the bottom
   *  and top of the zoom range are covered rather than dark. */
  const bandAt = (z, i) => {
    const inRamp = i === 0 ? 1 : ramp(z, bands[i - 1].until - half, bands[i - 1].until + half);
    const outRamp =
      i === bands.length - 1 ? 1 : 1 - ramp(z, bands[i].until - half, bands[i].until + half);
    return Math.min(inRamp, outRamp);
  };

  /** A tier's own arrival: nothing before `tierIn`, full `tierFade` later. */
  const tierAt = (tier, z) =>
    ramp(z, PLATE_LINE.tierIn[tier], PLATE_LINE.tierIn[tier] + PLATE_LINE.tierFade);

  /** Every zoom at which any curve changes direction, plus the ends of the
   *  range. Deduped and sorted, so moving a constant moves the sample points
   *  with it and nothing here restates a zoom. */
  const breakpoints = [
    ZOOM.min,
    ...[1, 2, 3].flatMap((t) => [PLATE_LINE.tierIn[t], PLATE_LINE.tierIn[t] + PLATE_LINE.tierFade]),
    ...bands.filter((b) => b.until !== undefined).flatMap((b) => [b.until - half, b.until + half]),
    ZOOM.max,
  ]
    .filter((z) => z >= ZOOM.min && z <= ZOOM.max)
    .filter((z, i, a) => a.indexOf(z) === i)
    .sort((a, b) => a - b);

  return bands.map((band, i) => ({
    id: `plate-name-${band.id}`,
    type: 'symbol',
    source: PLATE_LABEL_SOURCE,
    filter: ['==', ['get', 'band'], band.id],
    /* ==> EACH BAND IS CONFINED TO ITS OWN ZOOM WINDOW, AND THAT IS A COLLISION
     * FIX, NOT AN OPTIMISATION. <== All three layers first shared one `minzoom`
     * of `tierIn[1]`, on the reasoning that the opacity ramps decide what is
     * visible. They do — and MapLibre still PLACES a symbol whose opacity is
     * zero. Measured at z4.4: nine invisible `near`-band Africa labels were laid
     * out and, because `near` is the topmost of the three layers and placement
     * runs top-down, they won every collision against the `mid` labels that were
     * actually on screen. The visible band was being crowded out by two bands
     * nobody could see.
     *
     * `maxzoom` is left OFF the last band so it survives to `ZOOM.max` — a
     * `maxzoom` equal to the top of the range would hide the layer exactly at the
     * top zoom, which is a subtle way to lose every plate name at full zoom. */
    minzoom: i === 0 ? ZOOM.min : Math.max(ZOOM.min, bands[i - 1].until - half),
    ...(i === bands.length - 1 ? {} : { maxzoom: Math.min(ZOOM.max, band.until + half) }),
    layout: {
      'text-field': ['get', 'plate'],
      'text-font': ['Noto Sans Regular'],
      'text-size': SIZE.plateLabelPx,
      /* THE SAME VOICE THE COUNTRY NAMES USE — uppercase and letterspaced —
       * because a plate is an area, and an area label should read as a region
       * rather than as a point. One notch wider than the country tracking, so
       * the two kinds of region label are distinguishable without a second
       * colour doing all the work. */
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.2,
      /* ONE LABEL, AT THE MIDDLE OF ITS WINDOW. See the note above — this single
       * word is what pairs the two names and what stops them repeating. */
      'symbol-placement': 'line-center',
      'text-max-angle': PLATE_LINE.labelMaxAngle,
      /* A plate name never wraps. On a line, a second line of text would sit
       * across the seam the first line is supposed to sit beside. */
      'text-max-width': 30,
      /* Lower sorts first and therefore wins collisions: tier 1 beats tier 3. */
      'symbol-sort-key': ['to-number', ['coalesce', ['get', 'tier'], 9]],
      /* ==> NO COLLISION PADDING, BECAUSE THE PAIR HAS TO SIT CLOSE. <== The two
       * names of a seam are deliberately only tens of pixels apart — that
       * closeness is the whole point, it is what lets you read both in one
       * glance. MapLibre's default 2 px of padding on each box is enough, at that
       * separation, to make the pair collide with ITSELF and drop one half. A
       * half-labelled boundary is worse than an unlabelled one: it reads as a
       * statement about the plate that got the name. */
      'text-padding': 0,
    },
    paint: {
      'text-color': plates.text,
      /* HALOED IN THE OCEAN COLOUR, not in the land colour the place labels
       * use. A seam runs through both, and it spends most of its length at sea. */
      'text-halo-color': plates.textHalo,
      'text-halo-width': SIZE.plateLabelHaloPx,
      'text-opacity': byZoom(
        breakpoints.map((z) => [
          z,
          [
            'case',
            ['==', ['get', 'tier'], 1],
            tierAt(1, z) * bandAt(z, i),
            ['==', ['get', 'tier'], 2],
            tierAt(2, z) * bandAt(z, i),
            tierAt(3, z) * bandAt(z, i),
          ],
        ])
      ),
    },
  }));
}

function coastGlowLayer(P, sourceLayer, filter) {
  const layer = {
    id: 'coast-glow',
    type: 'line',
    source: 'basemap',
    'source-layer': sourceLayer,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': P.coastGlowSoft,
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

function coastCoreLayer(P, sourceLayer, filter) {
  const layer = {
    id: 'coast-core',
    type: 'line',
    source: 'basemap',
    'source-layer': sourceLayer,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': P.coastGlow,
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
