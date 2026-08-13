/**
 * theme-state.js — the colours MapLibre holds, and the only way to name one.
 *
 * ==> THE POINT OF THIS FILE: A THEME CHANGE MUST NOT REBUILD ANYTHING. <==
 *
 * MapLibre 5's GLOBAL STATE is a small bag of values the style can reference
 * from inside a paint property. Change one with `map.setGlobalStateProperty()`
 * — NOT `setGlobalState`, which is the Style's and repaints nothing — and
 * MapLibre re-evaluates the properties that read it and repaints. It does not
 * touch the layer list, the sources, or the tiles.
 *
 * Every themed colour the map draws is therefore written as `gs('key')` rather
 * than as a hex, and `themeState()` is what fills the bag. Flipping dark to
 * light is one call.
 *
 * WHAT THIS REPLACED. `map.setStyle(buildStyle(), { diff: false })` — the whole
 * basemap thrown away and rebuilt, the app's own storm layers deleted with it
 * and reinstalled on the `style.load` that followed. A full teardown, a
 * re-layout and a visible flash, to change twenty-seven hex values.
 *
 * ---------------------------------------------------------------------------
 * TWO RULES FOR ADDING TO THIS FILE.
 *
 * 1. ONLY PAINT COLOURS. A `global-state` reference in a LAYOUT property makes
 *    every change re-layout every tile, which is the expensive thing this
 *    exists to avoid. If a themed value ever needs to reach a layout property,
 *    that is a different mechanism and a different conversation.
 *
 * 1b. ==> AND NEVER IN AN EXPRESSION THAT ALSO READS FEATURE DATA. <== This is
 *    the rule that was learned the hard way. MapLibre evaluates a DATA-DRIVEN
 *    paint property — one containing `['get', …]`, `['feature-state', …]` and
 *    friends — in the WORKER, and the worker is never sent the global state.
 *    `Style._findGlobalStateAffectedSources` will not save you either: it only
 *    reloads a source when the key is read by a LAYOUT property or a filter
 *    (`getLayoutAffectingGlobalStateRefs` walks `_unevaluatedLayout` and
 *    nothing else), so a paint ref never reaches a worker at all.
 *
 *    IT DOES NOT THROW. `to-color` of a missing value is BLACK, in both themes,
 *    forever. That shipped once, on the white ring marking each storm's first
 *    forecast dot, and the tell was that the `circle-stroke-width` beside it —
 *    the same `case` on the same `_first`, with plain numbers in its branches —
 *    worked perfectly.
 *
 *    The way out is not a cleverer expression. Either the colour is genuinely
 *    theme-independent, in which case bake it from `palette()` and assert the
 *    two palettes agree, or it is not, in which case it needs a real repaint
 *    path like the two exceptions above. `tools/test-theme-state.mjs` fails the
 *    build on any expression holding both a `global-state` and a feature read.
 *
 * 2. THE NAME MATCHES THE PALETTE. A state key called `seaColour` pointing at
 *    `P.ocean` is one rename away from a silent bug. The nested `geo.*` values
 *    flatten to `geoCamelCase` because a state key cannot hold a dot, and that
 *    is the only transformation allowed.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT HERE, AND WHY. Two themed things on the map cannot
 * be expressed as a global-state colour, so they keep an explicit repaint:
 *
 *   - THE POPULATION HEAT RAMP (`map/population.js`). `heatmap-color` is an
 *     interpolate over `heatmap-density` whose stops are rgba() values with
 *     per-stop ALPHA, composited from a palette hex at build time. There is no
 *     honest way to write "this palette colour at 42% alpha" as an expression
 *     without decomposing and reassembling the channels, and MapLibre bakes the
 *     ramp into a 256px texture rather than evaluating it per pixel. It
 *     rethemes with `setPaintProperty`.
 *
 *   - MODEL TRACK COLOURS (`map/layers/model-tracks.js`). The line reads
 *     `['get', '_color']` — the colour is a property of each FEATURE, resolved
 *     when the guidance is pushed. Nothing about that is a paint property, so
 *     nothing in this file can reach it; it rethemes by re-pushing the data,
 *     which is free because the bundles are already in memory.
 *
 * And one thing that is not an exception so much as a HARD LIMIT — see the
 * second rule below.
 *
 * Both are named in `app/theme-switch.js` where they are called, so the list of
 * exceptions exists in exactly one place and is two items long. If it grows,
 * that is the signal that the mechanism is wrong, not that the list needs
 * another entry.
 *
 * Imports config/ only. Everything in map/ may import this; it imports nothing
 * from map/.
 */

import { palette } from '../config/theme.js';

/* ---------------------------------------------------------------------------
 * THE CONTRACT: state key -> palette path.
 *
 * This object IS the agreement between `gs()` and `setGlobalState`. A key
 * referenced by `gs()` but missing here is never published, so the paint
 * property reads `undefined` — which in MapLibre is not an error and not a
 * warning, it is a SILENTLY REJECTED LAYER. The first anyone knows is a hole in
 * the globe on a phone, which is the outage class `tools/token-check.mjs` was
 * written for. That tool walks this map and every `gs('...')` call in map/ and
 * fails the build on either half being wrong.
 * ------------------------------------------------------------------------- */
export const THEME_STATE = Object.freeze({
  /* --- basemap: the globe body, its furniture, and the sky --------------- */
  ocean:             'ocean',
  land:              'land',
  landHigh:          'landHigh',
  landFaint:         'landFaint',
  coastGlow:         'coastGlow',
  coastGlowSoft:     'coastGlowSoft',
  adminCountry:      'adminCountry',
  adminState:        'adminState',
  textCountry:       'textCountry',
  textPlace:         'textPlace',
  skyHigh:           'skyHigh',
  skyLow:            'skyLow',
  atmosphere:        'atmosphere',

  /* --- the app's own layers ---------------------------------------------
   * The reference lines (graticule), the storm marks, and the selected
   * storm's geometry. These used to be re-baked by rebuilding the entire
   * style; they are now the same one call as the basemap. */
  graticuleMajor:    'graticuleMajor',
  stormPlanetDot:    'stormPlanetDot',
  stormEnded:        'stormEnded',
  geoConeFill:       'geo.coneFill',
  geoConeLine:       'geo.coneLine',
  geoTrackForecast:  'geo.trackForecast',
  geoTrackPast:      'geo.trackPast',
  geoLabelColor:     'geo.labelColor',
  geoLabelHalo:      'geo.labelHalo',
  geoPointCodeColor: 'geo.pointCodeColor',
  geoPointStroke:    'geo.pointStroke',
  geoStormLabelHalo: 'geo.stormLabelHalo',
  geoStormLabelColor: 'geo.stormLabelColor',
  geoEndedMark:      'geo.endedMark',
});

/** Every legal state key, for the tools and the tests. */
export const STATE_KEYS = Object.freeze(Object.keys(THEME_STATE));

/**
 * Reference a themed colour from inside a paint property.
 *
 * `to-color` IS REQUIRED, not decoration. `global-state` returns an untyped
 * value, and MapLibre's expression parser needs a Color to place one inside an
 * `interpolate` or a `case` — which several of the properties are. Wrapping
 * every use identically means there is no "this one needed the cast and that
 * one didn't" to remember, and no way to get it wrong on the eighth.
 */
export const gs = (key) => ['to-color', ['global-state', key]];

/**
 * The live value of every themed key, in the shape `setGlobalState` wants.
 *
 * Reads `palette()` at CALL TIME, like everything else that paints — never
 * hoisted, never cached (see config/theme.js).
 *
 * `world` layers a basemap override on top, the same way `buildStyle` does.
 * The two must agree or a world would install with one set of colours and
 * repaint with another on the next theme flip.
 */
export function themeState(world = null) {
  const live = palette();
  const P = world ? { ...live, ...world } : live;
  const out = {};
  for (const [key, path] of Object.entries(THEME_STATE)) {
    const dot = path.indexOf('.');
    out[key] = dot === -1 ? P[path] : P[path.slice(0, dot)][path.slice(dot + 1)];
  }
  return out;
}

/** The same values in the shape a STYLE's top-level `state` block wants, which
 *  is the one place MapLibre asks for `{ key: { default } }` instead of a flat
 *  map. Only ever the INITIAL values — a style has to be correct the instant it
 *  is installed, before anyone has called `setGlobalState`. After that the
 *  defaults are never read again. */
export function stateBlock(world = null) {
  const out = {};
  for (const [k, v] of Object.entries(themeState(world))) out[k] = { default: v };
  return out;
}
