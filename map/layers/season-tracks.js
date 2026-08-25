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
 * dimmed to a ghost when some other storm is focused (§57.21 item 2). Landfall
 * marks and one-record storms are the sibling file, `season-marks.js`.
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
import { ZOOM } from '../../config/constants.js';
import { categoryColor } from '../../lib/category.js';
import { stormDisplayName } from '../../lib/season-names.js';
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
  const coords = (storm?.points || [])
    .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lonU))
    .map((p) => [p.lonU, p.lat]);

  if (coords.length < 2) return null;

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
        'line-color': ['get', 'color'],
        /* The archive's tracks are the SUBJECT of the screen, not context, so
         * they take the forecast's confident width rather than the dotted past
         * track's. Nothing on this globe is a forecast — there is no second
         * line for them to be quieter than. */
        'line-width': STORM_GEO.trackForecastWidth,
        'line-opacity': focusOpacity(focusId),
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
        'text-letter-spacing': 0.08,
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
 * What the NAMES draw at, which is not what the tracks draw at.
 *
 * ==> WITH A STORM FOCUSED, EVERY OTHER NAME GOES TO ZERO RATHER THAN TO THE
 * GHOST VALUE. <== This looks like an inconsistency and it is the opposite.
 * Text is not geometry: a dimmed line is a legible ghost, a dimmed word is
 * illegible AND still occupies its space in MapLibre's collision index — so
 * the faded names would go on winning placement fights against the one name
 * the reader actually asked for, and the focused storm could end up as the
 * only unlabelled track on screen. Taking them out entirely means the focused
 * name always places, and it reads as the right thing too: focus means "just
 * this one".
 */
function nameOpacity(id) {
  return focusOpacity(id, ARCHIVE_GEO.focusedOpacity, 0);
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
export function setSeasonTracks(map, selected = []) {
  const src = map?.getSource?.(SOURCE);
  if (!src) return;

  const features = [];
  for (const entry of selected) {
    const f = trackFeature(entry?.storm, entry?.facts);
    if (f) features.push(f);
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
  map.setPaintProperty(LAYER, 'line-opacity', focusOpacity(focusId));
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
  map?.getSource?.(SOURCE)?.setData(EMPTY);
  if (map?.getLayer?.(LAYER)) {
    map.setPaintProperty(LAYER, 'line-opacity', focusOpacity(null));
  }
  if (map?.getLayer?.(LAYER_NAME)) {
    map.setPaintProperty(LAYER_NAME, 'text-opacity', nameOpacity(null));
  }
}

export const __internals = {
  trackColor,
  trackFeature,
  nameOpacity,
  focus: () => focusId,
};
