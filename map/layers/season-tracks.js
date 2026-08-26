/**
 * season-tracks.js — the archive globe's tracks. §57.30 step 5, §57.21.
 *
 * ==> IT DOES NOT GO THROUGH `registry.js`, AND THAT IS DELIBERATE RATHER THAN
 * LAZY. <== The layer engine is built around a live feed: one bundle per warmed
 * storm, a SELECTED storm whose geometry is excluded from the ambient set, and
 * a `forget` hook for storms that leave the feed. The archive has none of those
 * — a 1935 season is a fixed set of finished tracks that arrive all at once and
 * never change. Pushing them through the engine would mean inventing bundles
 * and a selection for a screen that has neither, which is the shape of code
 * that looks reused and is actually two systems wearing one name.
 *
 * ==> STEP 6 ANSWERED THAT QUESTION AND THE ANSWER DID NOT CHANGE. <==
 * Focus-and-dim is the archive's version of selection and it turned out to be
 * ONE PAINT PROPERTY, not a bundle, not a store and not a `forget` hook: the
 * whole set is pushed as before and MapLibre is told which id is bright. That
 * is a fraction of what the engine does, so the engine still buys nothing.
 *
 * WHAT IT DRAWS: one line per ticked storm, coloured by the storm's PEAK
 * category so a reader can see at a glance which year had the monsters in it,
 * with the storm's NAME set along the line (§57.21 item 1) and the whole thing
 * dimmed to a ghost when some other storm is focused (§57.21 item 2). The dots
 * — per-fix on the selected storm, and the standing dot a one-record storm gets
 * instead of a line — are the sibling file, `season-points.js`.
 *
 * ==> THE NAME IS SET ALONG THE LINE BY MAPLIBRE, NOT PLACED BY
 * `map/layers/name-placement.js`. <== §57.21 pointed at that module and it is
 * the wrong tool, which is worth writing down so nobody "fixes" this back.
 * That file solves a different problem: where a name sits BESIDE a moving
 * storm's position dot, chosen in screen space against the forecast geometry
 * it must not cross. An archive track has no position dot, no forecast and no
 * current moment — it is a finished curve, and MapLibre sets text along a
 * curve natively with its own collision handling. Ten names on ten tracks
 * therefore never overlap, for free, and the archive gets a better result out
 * of less code than the port would have been.
 *
 * ==> THE COLOUR IS BAKED INTO EVERY FEATURE, NEVER LEFT TO A FALLBACK. <==
 * `0d` in NOW.md is an open bug where something resolves a colour to `null`
 * dozens of times a load, and the audit that chased it walked all twelve
 * `['get', <colour>]` paint properties in `map/`. This adds a thirteenth, so it
 * carries its own guarantee: `trackColor()` below has no path that returns
 * null or undefined, and the feature is built with the colour already in it.
 * A storm with no wind reading anywhere in the file — which is real, and common
 * before 1886 — gets the ungraded hue rather than a missing property.
 *
 * ==> THE SELECTED STORM'S LINE CHANGES INK, NOT WIDTH. <== A storm the reader
 * has opened in full detail wears `geo.trackForecast` — the same confident ink
 * the live globe uses for a forecast leg — and gains a category-coloured dot at
 * every recorded position (`season-points.js`). The category is then carried by
 * the DOTS, which is exactly the live globe's own division of labour: a neutral
 * line, coloured points. Peak-category ink stays on every OTHER track, where it
 * is still the only thing saying which storm was the monster.
 *
 * ==> AND THE INK IS BAKED FROM `palette()` RATHER THAN READ WITH `gs()`. <==
 * `map/theme-state.js` rule 1b: a paint property holding both a `global-state`
 * reference and a `['get', …]` is evaluated in the worker, which never receives
 * the global state, and resolves the colour to BLACK without throwing. This
 * expression reads `['get','id']`, so it may not name a state key. Baking is
 * honest here rather than a workaround: the archive FORCES sepia for as long as
 * it is open (`seasons/index.js`), so there is no theme change to miss — and
 * the ink only ever enters the expression through `setSeasonTrackFocus`, which
 * can only run inside the archive. At style install, with nothing selected, the
 * expression is a bare `['get','color']` and carries no baked ink at all.
 *
 * ==> THE TRACKS ARE SMOOTHED WITH THE APP'S OWN CURVE. <== `smoothPath` from
 * `lib/trackline.js`, which is the same centripetal Catmull-Rom every live
 * track and the cone are drawn through — so an archive track and a live one
 * curve identically rather than the archive showing a hard corner at every
 * six-hourly fix. It takes the smaller `SEASONS.trackMaxVertices` budget: a
 * season can put thirty tracks on screen where the live globe has one.
 *
 * ==> AND THE RESULT IS MEMOISED PER STORM. <== Ticking is a whole-set push, so
 * without this every tick re-splines every storm already on the globe. The memo
 * is PRUNED to the ids in each push rather than grown, so browsing ten seasons
 * in one visit holds one season's curves, not ten.
 *
 * ==> AND IT DRAWS `lonU`, NOT `lon`. <== `lib/hurdat.js` carries both on every
 * point: `lon` is what NOAA published, inside ±180, and `lonU` is the
 * continuous one that may run past the antimeridian. A line drawn through raw
 * longitudes travels the long way round the planet the moment a storm crosses
 * the seam — which is exactly the fault that made Lala's wind swath a green
 * ring around the globe this week. Hurricane Della, CP011957, does it in the
 * archive's own data.
 *
 * Imports config/, lib/ and one sibling. Owns its own source and layers; no
 * engine, and the only state it keeps is which storm is focused — which it
 * keeps because MapLibre has nowhere to put it.
 */

import { ARCHIVE_GEO, SIZE, STORM_GEO } from '../../config/tokens.js';
import { palette } from '../../config/theme.js';
import { SEASONS, ZOOM } from '../../config/constants.js';
import { categoryColor } from '../../lib/category.js';
import { stormDisplayName } from '../../lib/season-names.js';
import { smoothPath } from '../../lib/trackline.js';
import { gs } from '../theme-state.js';
import { focusOpacity } from './season-focus.js';

const SOURCE = 'season-tracks';
const LAYER = 'season-tracks';
const LAYER_NAME = 'season-track-name';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** The storm the reader is looking at, or null for "all of them evenly".
 *
 *  ==> MODULE STATE, WHICH THIS FILE PREVIOUSLY HAD NONE OF, AND THE REASON IS
 *  THAT A LAYER CAN BE REBUILT UNDER IT. <== `ensureSeasonTracks` runs again
 *  after a style install, and a layer added fresh would come back at full
 *  strength with a storm still focused. Holding the id here means `ensure`
 *  paints the CURRENT truth rather than the default one. Cleared by
 *  `clearSeasonTracks`, which is the leave path. */
let focusId = null;

/** Is a clock cut currently being drawn. Module state for the same reason
 *  `focusId` above is: the opacity expression is installed at `ensure` time
 *  and swapped on focus, and neither of those knows whether somebody has
 *  pressed play. Flipped by `setSeasonTracks` and cleared on the way out. */
let clocked = false;

/** Smoothed coordinates, keyed on storm id. See the header: ticking is a
 *  whole-set push, so this is what stops every tick re-splining every storm
 *  already on the globe. Pruned to the pushed set on every push, so it can
 *  never hold more than what is currently drawn. */
const curves = new Map();

/**
 * The hue for a whole track: the storm's strongest moment.
 *
 * Peak rather than per-segment, and that is a real choice. A track coloured
 * segment by segment is the truer picture and it is also a rainbow — every
 * storm starts blue and ends blue, so four of them on one globe read as four
 * identical smears. Peak makes the strong ones legible from across the screen,
 * which is what §57.21 asks the archive globe to do. Per-segment belongs to the
 * detail panel, where there is room to read it.
 */
function trackColor(facts) {
  /* `TROPICAL` is the nature every HURDAT2 storm has by construction — the
   * file is the tropical-cyclone database. Passing it explicitly rather than
   * relying on a default keeps this honest if `categoryColor`'s signature ever
   * grows a third meaning. */
  return categoryColor(facts?.peakCategory ?? null, 'tropical', null);
}

/**
 * One storm's line.
 *
 * Returns null for a track too short to be a line. A single-point storm is
 * real — some 19th-century entries are one observation — and MapLibre rejects
 * a LineString with one coordinate, so it is dropped here with the reason
 * visible rather than thrown at the renderer. Step 6 gives it a dot.
 */
function trackFeature(storm, facts) {
  const raw = (storm?.points || [])
    .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lonU))
    .map((p) => [p.lonU, p.lat]);

  if (raw.length < 2) return null;

  /* `smoothPath` returns fewer than three points UNCHANGED rather than padded,
   * so a two-fix storm stays the straight segment it genuinely is. */
  let coords = curves.get(storm.id);
  if (!coords) {
    coords = smoothPath(raw, SEASONS.trackMaxVertices);
    curves.set(storm.id, coords);
  }

  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: {
      id: storm.id,
      name: storm.name || null,
      /* What the LABEL says, which is not always what NOAA wrote in the name
       * column. §57.14: an unnamed storm is called by its number rather than
       * left blank, and the rule is `lib/season-names.js`'s so that a track on
       * the globe and its row in the roster can never disagree. `name` above
       * stays the raw value — the suite reads it, and it is the honest answer
       * to "did this storm have a name". */
      label: stormDisplayName(storm),
      color: trackColor(facts),
    },
  };
}

/**
 * Attach the layer. Idempotent — the archive can be entered and left many
 * times in one session and the source outlives all of it.
 *
 * @param {object} map        MapLibre map
 * @param {string} [beforeId] draw beneath this layer, so storm markers and
 *                            labels stay on top when step 6 adds them
 */
export function ensureSeasonTracks(map, beforeId) {
  if (!map || map.getSource(SOURCE)) return;

  map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
  map.addLayer(
    {
      id: LAYER,
      type: 'line',
      source: SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': lineColor(focusId),
        /* The archive's tracks are the SUBJECT of the screen, not context, so
         * they take the forecast's confident width rather than the dotted past
         * track's. Nothing on this globe is a forecast — there is no second
         * line for them to be quieter than. */
        'line-width': STORM_GEO.trackForecastWidth,
        'line-opacity': lineOpacity(focusId),
      },
    },
    beforeId
  );

  /* ==> THE NAMES, AND THEY ARE A SECOND LAYER ON THE SAME SOURCE. <== One
   * source means the label can never draw for a storm whose line is not there:
   * they are the same feature. Added AFTER the line and before the same
   * anchor, so it sits immediately above its own track — MapLibre inserts each
   * layer directly beneath `beforeId`, so insertion order is bottom-up. */
  map.addLayer(
    {
      id: LAYER_NAME,
      type: 'symbol',
      source: SOURCE,
      /* Same floor as the live globe's storm names (§9: no labels at z0–2).
       * A season with thirty tracks at planet distance is a knot of lines; the
       * names would be a solid block of text over it, and MapLibre would drop
       * most of them to collision anyway — which is worse than not asking,
       * because WHICH ones survive would be arbitrary. */
      minzoom: ZOOM.basin,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ARCHIVE_GEO.nameSize,
        /* ==> ALONG THE LINE, WHICH IS THE WHOLE REASON THIS IS NOT A PORT OF
         * `name-placement.js`. <== See the note at the top of the file. */
        'symbol-placement': 'line',
        'symbol-spacing': ARCHIVE_GEO.nameRepeatPx,
        'text-transform': 'uppercase',
        'text-letter-spacing': ARCHIVE_GEO.nameTrackingEm,
        /* Left at MapLibre's defaults — overlap NOT allowed, placement NOT
         * ignored — so its collision engine hides a name rather than stacking
         * two. That is the behaviour being bought here. The live globe sets
         * both to true on its position GLYPH and not on its name, for the same
         * reason: a glyph must never be dropped, a name may be. */
      },
      paint: {
        'text-color': gs('geoStormLabelColor'),
        'text-halo-color': gs('geoStormLabelHalo'),
        'text-halo-width': ARCHIVE_GEO.nameHaloWidth,
        'text-opacity': nameOpacity(focusId),
      },
    },
    beforeId
  );
}

/**
 * What a TRACK draws at, which is focus and one more thing.
 *
 * ==> A STORM THAT HAS ALREADY FINISHED, WHILE THE CLOCK IS STILL RUNNING ON
 * THE OTHERS, DROPS BACK. §57.23. <== The season is meant to accumulate on the
 * globe, so a dead storm's line stays — but at full strength a busy September
 * would drown the two or three storms actually moving, which is the thing the
 * reader is watching.
 *
 * ==> IT IS ONE STATIC EXPRESSION AND IT COSTS NOTHING WHEN THE CLOCK IS OFF.
 * <== `ended` is stamped on the feature by `setSeasonTracks` only when a cut
 * is supplied, so with the clock stopped the test is against a property that
 * is never present and every track takes the focus answer unchanged. That is
 * what lets this be installed once at `ensure` rather than swapped on every
 * step — a paint call ten times a second to say something that has not changed
 * is exactly the cost §57.35 fault 3 is about.
 *
 * ==> `['==', ..., true]` RATHER THAN A BARE `['get']`. <== MapLibre's `case`
 * wants a boolean and a missing property reads as `null`, which it refuses at
 * validation time rather than treating as false — so the bare form would throw
 * the whole layer away at `addLayer` on every reader who never presses play.
 * That is the same class of fault as §48.21's third bug, which shipped.
 */
function lineOpacity(id) {
  /* ==> WITH NO CLOCK RUNNING THIS IS THE BARE FOCUS ANSWER, WHICH IS A PLAIN
   * NUMBER WHEN NOTHING IS FOCUSED. <== `tools/test-season-tracks.mjs` asserts
   * exactly that and it caught this file wrapping every reader in an
   * expression for a feature most of them never start. `focusOpacity`'s own
   * note has the reason: an expression is evaluated per feature per frame, and
   * "nobody has tapped anything with the clock stopped" is where most of the
   * time in the archive is spent. So the wrap is added only once a cut is
   * actually in play. */
  if (!clocked) return focusOpacity(id);
  return ['case', ['==', ['get', 'ended'], true], ARCHIVE_GEO.clockEndedOpacity, focusOpacity(id)];
}

/**
 * The ink for every line, given which storm is open in full detail.
 *
 * Nothing selected is a bare `['get','color']` — every track wears its own peak
 * category, which is the archive's default reading and the whole point of §6 on
 * this screen. With one storm selected, that one switches to the live globe's
 * forecast ink and the rest keep theirs; see the header for why the ink is
 * baked rather than named, and why baking is safe here specifically.
 *
 * ==> IT IS `['case']` AND NOT `['match']`, for the same reason `circle-stroke-
 * color` next door is. <== A `match` on the result of an `==` is a shape
 * MapLibre accepts and reads inconsistently across versions; `case` takes the
 * boolean directly.
 */
function lineColor(id) {
  if (!id) return ['get', 'color'];
  return ['case', ['==', ['get', 'id'], id], palette().geo.trackForecast, ['get', 'color']];
}

/**
 * What the NAMES draw at, which is not what the tracks draw at.
 *
 * ==> WITH A STORM SELECTED, EVERY NAME ON THIS LAYER GOES TO ZERO — INCLUDING
 * THE SELECTED STORM'S OWN. <== Two different reasons stacked on one number.
 *
 * The OTHER names go dark because text is not geometry: a dimmed line is a
 * legible ghost, a dimmed word is illegible AND still occupies its space in
 * MapLibre's collision index, so the faded names would go on winning placement
 * fights against the one name the reader actually asked for.
 *
 * The SELECTED storm's name goes dark because it is drawn somewhere else —
 * `season-points.js` puts it beside the storm's first dot, placed in screen
 * space against the track it must not cross (Aaron's call, 2026-08-25). Drawn
 * in both places it would be the same word twice on one storm.
 *
 * So this is `0` rather than an expression the moment anything is selected,
 * which is also cheaper: nothing for MapLibre to evaluate per feature.
 */
function nameOpacity(id) {
  return id ? 0 : ARCHIVE_GEO.focusedOpacity;
}

/**
 * Draw exactly these storms and nothing else.
 *
 * ==> IT IS A WHOLE-SET PUSH, NOT AN ADD AND A REMOVE. <== Unticking a storm
 * is the same call as ticking one, with a shorter list. Two paths would be two
 * places for the globe to drift out of step with the roster's checkboxes, and
 * the roster is the thing the reader believes.
 *
 * An empty list clears the layer, and here that is unambiguous — a reader who
 * has ticked nothing HAS nothing selected. This is not the §5 empty-push trap
 * that `liveGlobe.hide()` documents, because there is no third state hiding
 * behind it: the archive's storms are already downloaded, so an empty globe
 * cannot mean "the source failed".
 *
 * @param {object} map
 * @param {Array<{storm:object, facts:object}>} selected
 */
export function setSeasonTracks(map, selected = [], cuts = null) {
  const src = map?.getSource?.(SOURCE);
  if (!src) return;

  /* ==> A CHANGE OF CLOCK STATE REPAINTS, AND IT HAPPENS TWICE PER PLAYBACK
   * RATHER THAN TEN TIMES A SECOND. <== The expression itself does not depend
   * on the moment, only on whether there IS one, so this fires once when the
   * clock starts and once when it stops. */
  const nowClocked = Boolean(cuts);
  if (nowClocked !== clocked) {
    clocked = nowClocked;
    if (map?.getLayer?.(LAYER)) map.setPaintProperty(LAYER, 'line-opacity', lineOpacity(focusId));
  }

  const features = [];
  const live = new Set();
  for (const entry of selected) {
    const f = trackFeature(entry?.storm, entry?.facts);
    if (entry?.storm?.id) live.add(entry.storm.id);
    if (!f) continue;

    /* ==> THE CLOCK SHORTENS THIS LINE; IT DOES NOT DRAW A SECOND ONE.
     * §57.23. <== `map/layers/season-clock.js`'s header has the whole
     * argument. The short version: the name along the line, the focus
     * dimming, the peak-category ink and the 44 px tap target all already
     * live on this feature, and a parallel clock line layer means each of
     * them either gets duplicated or quietly stops working the moment
     * somebody presses play.
     *
     * `cuts` null is the clock switched off and is the ordinary state — the
     * whole feature is one `if` away from not existing. A storm the cut says
     * is UNBORN is dropped entirely rather than drawn empty: MapLibre accepts
     * a one-coordinate LineString as data and renders nothing, so an empty
     * line would be a feature that answers taps and carries a name over a
     * storm that has not happened yet. */
    const cut = cuts?.get?.(entry?.storm?.id);
    if (cut) {
      if (cut.state === 'unborn' || !(cut.coords?.length >= 2)) continue;
      f.geometry = { type: 'LineString', coordinates: cut.coords };
      /* What a FINISHED storm looks like while others are still running
       * (§57.23: the season accumulates). Read by the paint expression rather
       * than applied here, because opacity is a paint property and stamping
       * it on the feature would mean re-pushing to change it. */
      f.properties.ended = cut.state === 'ended';
    }
    features.push(f);
  }

  /* PRUNE, so the memo holds what is drawn and nothing else. A reader browsing
   * a dozen seasons in one visit would otherwise accumulate every curve of
   * every storm they ever ticked. */
  for (const id of curves.keys()) {
    if (!live.has(id)) curves.delete(id);
  }

  src.setData({ type: 'FeatureCollection', features });
}

/**
 * Brighten one storm and drop the rest to a ghost. `null` puts them all back.
 *
 * ==> IT REPAINTS. IT DOES NOT RE-PUSH. <== The data is untouched, so this
 * costs a paint-property swap rather than a re-tile of the source — see the
 * note in `season-focus.js`. The focused track is NOT reordered to the top of
 * the draw list either, and that is a choice: reordering means re-pushing,
 * which is the thing being avoided, and at 0.2 opacity a ghost crossing over
 * a full-strength line is not what anybody is looking at.
 *
 * @param {object} map
 * @param {string|null} id
 */
export function setSeasonTrackFocus(map, id = null) {
  focusId = id || null;
  if (!map?.getLayer?.(LAYER)) return;
  map.setPaintProperty(LAYER, 'line-opacity', lineOpacity(focusId));
  /* Rebuilt rather than left alone, because the ink is baked at call time —
   * which is also what guarantees the sepia value is read, since this can only
   * run inside the archive. */
  map.setPaintProperty(LAYER, 'line-color', lineColor(focusId));
  if (map.getLayer(LAYER_NAME)) {
    map.setPaintProperty(LAYER_NAME, 'text-opacity', nameOpacity(focusId));
  }
}

/**
 * Which storm's track is under this point, or null.
 *
 * The same 44 px box `map/markers.js` uses on the live globe (§13), for the
 * same reason: a track is a 1.75 px line and a thumb is not a pixel. Asking
 * for the box rather than the point is what makes a track tappable at all.
 *
 * ==> IT ASKS THE LINE LAYER AND NOT THE NAME LAYER. <== A name is a label
 * ABOUT a track rather than the track itself, and including it would make the
 * word a bigger target than the line — so a tap aimed at a crossing storm
 * would select whichever name happened to be lying over it.
 */
export function seasonStormAtPoint(map, point) {
  if (!map?.getLayer?.(LAYER)) return null;

  const half = parseInt(SIZE.touchTarget, 10) / 2;
  const box = [
    [point.x - half, point.y - half],
    [point.x + half, point.y + half],
  ];

  const hits = map.queryRenderedFeatures(box, { layers: [LAYER] });
  for (const h of hits) {
    if (h.properties?.id) return h.properties.id;
  }
  return null;
}

/** Take everything off. Leaving the archive, and the failure path inside it.
 *
 *  ==> THE FOCUS GOES WITH IT. <== A reader who leaves the archive with Katrina
 *  focused and comes back to 1935 must not find one arbitrary 1935 storm bright
 *  and the rest ghosted, which is what a held id would do the moment a new
 *  season's ids failed to match it. */
export function clearSeasonTracks(map) {
  focusId = null;
  clocked = false;
  curves.clear();
  map?.getSource?.(SOURCE)?.setData(EMPTY);
  if (map?.getLayer?.(LAYER)) {
    map.setPaintProperty(LAYER, 'line-opacity', lineOpacity(null));
    map.setPaintProperty(LAYER, 'line-color', lineColor(null));
  }
  if (map?.getLayer?.(LAYER_NAME)) {
    map.setPaintProperty(LAYER_NAME, 'text-opacity', nameOpacity(null));
  }
}

export const __internals = {
  trackColor,
  lineOpacity,
  trackFeature,
  nameOpacity,
  lineColor,
  focus: () => focusId,
  clocked: () => clocked,
  curveCount: () => curves.size,
};
