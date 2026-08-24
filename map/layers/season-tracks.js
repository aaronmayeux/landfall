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
 * ==> STEP 6 IS WHERE THAT QUESTION IS ACTUALLY ANSWERED. <== Focus-and-dim,
 * name labels along the tracks and the landfall marks all arrive there, and
 * focus-and-dim is the first archive behaviour that genuinely resembles
 * selection. This file is the floor it gets built on, not a stand-in for it.
 *
 * WHAT IT DRAWS TODAY: one line per ticked storm, coloured by the storm's PEAK
 * category so a reader can see at a glance which year had the monsters in it.
 * Nothing else. Step 5's whole done-condition is that ticking a storm puts it
 * on the globe and unticking takes it off.
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
 * Imports config/ and lib/. Owns its own source and layer; no engine, no state
 * beyond what MapLibre holds.
 */

import { STORM_GEO } from '../../config/tokens.js';
import { categoryColor } from '../../lib/category.js';

const SOURCE = 'season-tracks';
const LAYER = 'season-tracks';
const EMPTY = { type: 'FeatureCollection', features: [] };

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
      },
    },
    beforeId
  );
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

/** Take everything off. Leaving the archive, and the failure path inside it. */
export function clearSeasonTracks(map) {
  map?.getSource?.(SOURCE)?.setData(EMPTY);
}

export const __internals = { trackColor, trackFeature };
