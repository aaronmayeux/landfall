/**
 * season-marks.js — the archive globe's POINTS. §57.21 item 3, §57.30 step 6.
 *
 * Two marks, one source, and they are here together because they are the same
 * kind of thing — a single moment on a finished storm — while the tracks next
 * door are lines.
 *
 * ==> 1. LANDFALL MARKS, WHICH ARE MEANT TO BE THE MOST CONFIDENT THING ON
 * THIS GLOBE. <== NOAA writes an `L` into the reviewed best track at the exact
 * record where the centre crossed a coast. That is not our arithmetic, not an
 * interpolation and not a nearest-shore guess — it is the flag the people who
 * reviewed the season put there. The app is called Landfall. Nothing else the
 * archive draws is that specific, so nothing else may look heavier: these get
 * a ring in an ink that is not a category colour (`geo.landfallRing`), which
 * makes them the one mark the eye picks out of a globe full of Saffir-Simpson
 * hues.
 *
 * **The fill is the strength AT THE COAST, not the storm's peak.** The track
 * carries peak (see `season-tracks.js` for why); a landfall carries what
 * actually arrived. Katrina peaked at Cat 5 over open water and came ashore in
 * Louisiana at Cat 3, and drawing that mark magenta would be the app stating
 * something false about the thing it is named after.
 *
 * ==> 2. ONE-RECORD STORMS, WHICH USED TO VANISH. <== `trackFeature` in
 * `season-tracks.js` needs two points to make a line and returns null below
 * that, so a storm with a single observation — real, and common in the 19th
 * century, where the record is one sighting from a passing ship — was ticked
 * by the reader and did nothing at all. Silence that looks like "nothing
 * there" is the §5 failure this project cares most about. It gets a small
 * plain dot: no ring, so it can never be mistaken for a landfall.
 *
 * ==> WHY NOT ALSO A DOT PER OBSERVATION ON EVERY TRACK. <== Because a season
 * is not a storm. 2005 has 28 storms averaging about 40 records each — over a
 * thousand dots — and the line already carries where the storm went. The live
 * globe draws forecast points because there are at most five of them and each
 * one is a claim about a specific hour. Per-record detail belongs to the
 * detail panel, which is step 7.
 *
 * Imports config/, lib/ and one sibling. Its own source, its own two layers.
 */

import { ARCHIVE_GEO } from '../../config/tokens.js';
import { categoryColor } from '../../lib/category.js';
import { gs } from '../theme-state.js';
import { focusOpacity } from './season-focus.js';

const SOURCE = 'season-marks';
const LAYER_ONE = 'season-mark-one';
const LAYER_LANDFALL = 'season-mark-landfall';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** Which storm is bright. Held for the same reason `season-tracks.js` holds
 *  its copy: a layer rebuilt after a style install must come back showing the
 *  CURRENT focus rather than the default one. */
let focusId = null;

/**
 * One mark.
 *
 * `id` is the STORM's id and not the mark's, deliberately — it is what the
 * focus expression matches on, so a storm's three landfall marks brighten and
 * dim with its track as one object. There is nothing in this app that selects
 * an individual landfall; step 7's detail panel lists them.
 */
function markFeature({ id, kind, lat, lon, color }) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { id, kind, color },
  };
}

/**
 * Every mark for one storm: its landfalls, or a dot if it is a single record.
 *
 * ==> LONGITUDE. A LANDFALL MARK USES `lon`, NOT `lonU`. <== This is the one
 * place in the archive where the unwrapped longitude is the WRONG answer, and
 * it is worth stating because the sibling file argues the opposite at length.
 * A LINE needs continuity — drawn through raw longitudes it travels the long
 * way round the planet when a storm crosses the seam. A POINT has no
 * neighbours and nothing to be continuous with, and MapLibre places 190°E
 * correctly only because it happens to normalise; feeding it the published
 * value means the mark is where NOAA said it was, full stop. The one-record
 * dot takes `lon` for the same reason.
 */
function marksForStorm(storm, facts) {
  const out = [];
  const id = storm?.id;
  if (!id) return out;

  for (const lf of facts?.landfalls || []) {
    if (!Number.isFinite(lf?.lat) || !Number.isFinite(lf?.lon)) continue;
    out.push(markFeature({
      id,
      kind: 'landfall',
      lat: lf.lat,
      lon: lf.lon,
      /* The category AT the coast. Null where the record carries no wind —
       * which happens in the 19th century — and `categoryColor` answers with
       * the ungraded hue rather than nothing, so this can never resolve to a
       * missing paint property. Same guarantee the track colour carries. */
      color: categoryColor(lf.category ?? null, 'tropical', null),
    }));
  }

  /* The one-record case, and it is `< 2` rather than `=== 1` so that a storm
   * whose only points are unreadable is treated the same way: something was
   * ticked, so something must appear. */
  const drawable = (storm.points || [])
    .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
  if (drawable.length === 1) {
    out.push(markFeature({
      id,
      kind: 'one',
      lat: drawable[0].lat,
      lon: drawable[0].lon,
      color: categoryColor(facts?.peakCategory ?? null, 'tropical', null),
    }));
  }

  return out;
}

/**
 * Attach both layers. Idempotent, same as the tracks.
 *
 * @param {object} map
 * @param {string} [beforeId] draw beneath this layer
 */
export function ensureSeasonMarks(map, beforeId) {
  if (!map || map.getSource(SOURCE)) return;

  map.addSource(SOURCE, { type: 'geojson', data: EMPTY });

  /* The quiet one first, so a landfall mark is never hidden under a
   * one-record dot where a season happens to put them close together. */
  map.addLayer(
    {
      id: LAYER_ONE,
      type: 'circle',
      source: SOURCE,
      filter: ['==', ['get', 'kind'], 'one'],
      paint: {
        'circle-radius': ARCHIVE_GEO.onePointRadius,
        'circle-color': ['get', 'color'],
        'circle-opacity': focusOpacity(focusId),
      },
    },
    beforeId
  );

  map.addLayer(
    {
      id: LAYER_LANDFALL,
      type: 'circle',
      source: SOURCE,
      filter: ['==', ['get', 'kind'], 'landfall'],
      paint: {
        'circle-radius': ARCHIVE_GEO.landfallRadius,
        'circle-color': ['get', 'color'],
        'circle-stroke-width': ARCHIVE_GEO.landfallStrokeWidth,
        /* ==> THE RING IS A THEMED COLOUR AND THE FILL IS A FEATURE READ, AND
         * THEY ARE SEPARATE PROPERTIES ON PURPOSE. <== `map/theme-state.js`
         * rule 1b: a single paint property holding BOTH a `global-state`
         * reference and a `['get', …]` is evaluated in the worker, which never
         * receives the global state, and resolves the colour to black without
         * throwing. Split across two properties, as here, neither one mixes. */
        'circle-stroke-color': gs('geoLandfallRing'),
        'circle-opacity': focusOpacity(focusId),
        'circle-stroke-opacity': focusOpacity(focusId),
      },
    },
    beforeId
  );
}

/**
 * Draw exactly these storms' marks and nothing else. Whole-set push, same
 * contract as the tracks — unticking is this call with a shorter list.
 *
 * @param {object} map
 * @param {Array<{storm:object, facts:object}>} selected
 */
export function setSeasonMarks(map, selected = []) {
  const src = map?.getSource?.(SOURCE);
  if (!src) return;

  const features = [];
  for (const entry of selected) {
    features.push(...marksForStorm(entry?.storm, entry?.facts));
  }

  src.setData({ type: 'FeatureCollection', features });
}

/** Brighten one storm's marks, ghost the rest. Mirrors the tracks exactly, and
 *  has to: a full-strength landfall pin sitting on a ghosted track reads as a
 *  rendering fault rather than as emphasis. */
export function setSeasonMarkFocus(map, id = null) {
  focusId = id || null;
  const op = focusOpacity(focusId);
  for (const layer of [LAYER_ONE, LAYER_LANDFALL]) {
    if (!map?.getLayer?.(layer)) continue;
    map.setPaintProperty(layer, 'circle-opacity', op);
    if (layer === LAYER_LANDFALL) {
      map.setPaintProperty(layer, 'circle-stroke-opacity', op);
    }
  }
}

/** Leaving the archive. Drops the marks and the focus together. */
export function clearSeasonMarks(map) {
  focusId = null;
  map?.getSource?.(SOURCE)?.setData(EMPTY);
  setSeasonMarkFocus(map, null);
}

export const __internals = { marksForStorm, focus: () => focusId };
