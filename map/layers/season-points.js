/**
 * season-points.js — the archive globe's DOTS. §57.21 item 3, §57.30 step 6.
 *
 * Two kinds of dot, one source, and they are here together because they are the
 * same kind of thing — a single moment on a finished storm — while the tracks
 * next door are lines.
 *
 * ==> 1. EVERY RECORDED POSITION OF THE SELECTED STORM. <== When the reader
 * opens one storm in full detail it gets a Saffir-Simpson dot at each fix NOAA
 * published, drawn exactly the way the live globe draws a forecast point: the
 * same radius, the same dark ring, the same one- or two-character code inside,
 * and the same wider white ring on the earliest point. That is not a
 * resemblance, it is the same tokens — `STORM_GEO.pointRadius` and friends —
 * so the two globes cannot drift apart.
 *
 * **The colour is the category AT THAT MOMENT, not the storm's peak.** The
 * track carries peak (see `season-tracks.js` for why), and once one storm is
 * selected its LINE stops carrying category at all and switches to the neutral
 * forecast ink — so the dots become the only thing telling the intensity story,
 * which is the live globe's own division of labour. Katrina reads Cat 1 over
 * Florida, Cat 5 in the Gulf and Cat 3 at the Louisiana coast, which is what
 * actually happened.
 *
 * ==> AND THEY EXIST ONLY FOR THE SELECTED STORM, WHICH IS A MEASUREMENT AND
 * NOT A PREFERENCE. <== 2005 has 28 storms averaging about 40 fixes each. Over
 * eleven hundred ten-pixel discs is not a season, it is a smear that hides the
 * very lines it annotates. Bounding them to the one storm the reader asked
 * about is what makes them affordable AND legible — the same bound, and the
 * same reasoning, that `season-swath.js` already uses for the wind footprint.
 *
 * ==> 2. ONE-RECORD STORMS, WHICH WOULD OTHERWISE VANISH. <== `trackFeature` in
 * `season-tracks.js` needs two points to make a line and returns null below
 * that, so a storm with a single observation — real, and common in the 19th
 * century, where the record is one sighting from a passing ship — would be
 * ticked by the reader and do nothing at all. Silence that looks like "nothing
 * there" is the §5 failure this project cares most about.
 *
 * ==> AND THIS ONE IS DRAWN WHETHER OR NOT THE STORM IS SELECTED. <== That is
 * the whole difference between the two kinds. A per-fix dot is DETAIL, so it
 * waits to be asked for; a one-record dot is the storm's ENTIRE presence on the
 * globe, so withholding it until selection would mean a ticked storm that draws
 * nothing — which is the silence again, arriving through a new door.
 *
 * ==> LANDFALL PINS USED TO LIVE HERE AND ARE GONE. <== Aaron's call,
 * 2026-08-25. They were the archive's one mark in a non-category ink, and on
 * glass they read as clutter over a globe already full of Saffir-Simpson hues.
 * NOAA's `L` records are not lost — `lib/season-facts.js` still reads them, the
 * roster row still marks a storm that made one, and the Landfalls filter still
 * works. What is gone is the pin. Do not re-add it without a glass call saying
 * so; `geo.landfallRing` was retired with it and would have to come back too.
 *
 * Imports config/, lib/ and one sibling. Its own source, its own three layers.
 */

import { ARCHIVE_GEO, STORM_GEO } from '../../config/tokens.js';
import { palette } from '../../config/theme.js';
import { categoryColor, categoryDotCode, categoryFromKt } from '../../lib/category.js';
import { gs } from '../theme-state.js';
import { focusOpacity } from './season-focus.js';

const SOURCE = 'season-points';
const LAYER_ONE = 'season-point-one';
const LAYER_FIX = 'season-point-fix';
const LAYER_CODE = 'season-point-code';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** Which storm is open in full detail. Held for the same reason
 *  `season-tracks.js` holds its copy: a layer rebuilt after a style install
 *  must come back showing the CURRENT selection rather than the default one. */
let focusId = null;

/** The last set the board pushed.
 *
 *  ==> THIS FILE HAS TO REMEMBER, WHERE THE TRACKS DO NOT, BECAUSE SELECTION
 *  CHANGES ITS DATA RATHER THAN ITS PAINT. <== A track's focus is one opacity
 *  swap over geometry MapLibre already holds. A per-fix dot does not EXIST
 *  until its storm is selected, so a selection change means new features — and
 *  the only way to build them without the board pushing twice is to keep the
 *  set. `season-swath.js` keeps its own for the identical reason. */
let lastSet = [];

/**
 * One dot.
 *
 * `id` is the STORM's id and not the fix's, deliberately — it is what the focus
 * expression matches on, so a one-record storm's dot dims with the tracks
 * around it as one object. Nothing in this app selects an individual fix.
 */
function pointFeature({ id, kind, lat, lon, color, code = '', first = false }) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { id, kind, color, _code: code, _first: first },
  };
}

/**
 * The category at one fix, graded from the wind the record carries.
 *
 * ==> `'tropical'` IS PASSED UNCONDITIONALLY, WHICH IS A KNOWN SIMPLIFICATION
 * RATHER THAN AN OVERSIGHT. <== HURDAT2's status column distinguishes `EX`
 * (extratropical) and `LO` from the cyclone codes, and §6 says a non-tropical
 * system must not wear a Saffir-Simpson hue. Mapping those codes onto natures
 * is a real change with its own glass call, and it would have to move the track
 * colour and the peak figure with it or the row and the globe would disagree.
 * Until then this matches what `season-tracks.js` and `lib/season-facts.js`
 * already do, so the three cannot drift. The visible cost is that a storm's
 * extratropical tail draws in the hue of its wind rather than a duller one.
 */
function gradeAt(windKt) {
  const cat = Number.isFinite(windKt) ? categoryFromKt(windKt) : null;
  return {
    /* `categoryColor` answers with the ungraded hue rather than nothing when
     * the record carries no wind — which happens all through the 19th century
     * — so this can never resolve to a missing paint property. Same guarantee
     * the track colour carries. */
    color: categoryColor(cat, 'tropical', null),
    /* Empty rather than a guessed code where there is no earned reading. The
     * dot's colour still carries §6; the circle is simply blank. */
    code: categoryDotCode(cat, 'tropical'),
  };
}

/**
 * Every dot for one storm.
 *
 * ==> LONGITUDE. A DOT USES `lon`, NOT `lonU`. <== This is the one place in the
 * archive where the unwrapped longitude is the WRONG answer, and it is worth
 * stating because the sibling file argues the opposite at length. A LINE needs
 * continuity — drawn through raw longitudes it travels the long way round the
 * planet when a storm crosses the seam. A POINT has no neighbours and nothing
 * to be continuous with, so feeding it the published value means the dot is
 * where NOAA said it was, full stop.
 */
function pointsForStorm(storm, selected) {
  const out = [];
  const id = storm?.id;
  if (!id) return out;

  const drawable = (storm.points || [])
    .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));

  /* THE ONE-RECORD CASE FIRST, and it is `< 2` rather than `=== 1` so that a
   * storm whose only points are unreadable is treated the same way: something
   * was ticked, so something must appear. It returns immediately — a storm
   * with one fix must never draw both kinds of dot on top of each other. */
  if (drawable.length < 2) {
    if (drawable.length === 1) {
      const g = gradeAt(drawable[0].windKt);
      out.push(pointFeature({
        id, kind: 'one', lat: drawable[0].lat, lon: drawable[0].lon, color: g.color,
      }));
    }
    return out;
  }

  if (!selected) return out;

  for (let i = 0; i < drawable.length; i++) {
    const p = drawable[i];
    const g = gradeAt(p.windKt);
    out.push(pointFeature({
      id,
      kind: 'fix',
      lat: p.lat,
      lon: p.lon,
      color: g.color,
      code: g.code,
      /* The earliest fix wears the white wider ring, and the job it does here
       * is the job it does on the live globe: DIRECTION. A chain of dots
       * reading TD → 3 → 3 → TD has no start and no end to the eye, and on a
       * 19th-century track there is no forecast cone to say which way round it
       * runs. `drawable` is in file order, which HURDAT2 publishes
       * chronologically. */
      first: i === 0,
    }));
  }

  return out;
}

/**
 * The ink that is baked rather than named, and re-baked on every push.
 *
 * ==> RULE 1b, AND A SECOND TRAP UNDER IT. <== `map/theme-state.js`: a paint
 * property holding both a `global-state` reference and a `['get', …]` is
 * evaluated in the worker, which never receives the global state, and resolves
 * to BLACK without throwing. This one reads `['get','_first']`, so it may not
 * name a state key.
 *
 * The second trap is WHEN. These layers are installed at `style.load`, long
 * before anybody presses a door — so a value baked at install time would be the
 * DARK palette's, and the archive is always sepia. Re-baking on every push and
 * every selection change means the value is read from inside the archive, where
 * the forced palette is the one on screen.
 */
function paintInks(map) {
  if (!map?.getLayer?.(LAYER_FIX)) return;
  const P = palette();
  map.setPaintProperty(LAYER_FIX, 'circle-stroke-color', [
    'case', ['get', '_first'], P.geo.pointStrokeFirst, P.geo.pointStroke,
  ]);
}

/**
 * Attach the layers. Idempotent, same as the tracks.
 *
 * @param {object} map
 * @param {string} [beforeId] draw beneath this layer
 */
export function ensureSeasonPoints(map, beforeId) {
  if (!map || map.getSource(SOURCE)) return;

  map.addSource(SOURCE, { type: 'geojson', data: EMPTY });

  /* The quiet one first, so a one-record dot can never sit over a selected
   * storm's fix where a season happens to put them close together. */
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
      id: LAYER_FIX,
      type: 'circle',
      source: SOURCE,
      filter: ['==', ['get', 'kind'], 'fix'],
      paint: {
        'circle-radius': STORM_GEO.pointRadius,
        'circle-color': ['get', 'color'],
        /* NO FOCUS EXPRESSION ON THESE, and it is not an omission. A fix only
         * exists while its storm is selected, so there is nothing for it to be
         * dimmed against — every feature in this layer belongs to the one storm
         * the reader is looking at.
         *
         * `circle-stroke-color` is set by `paintInks`, not here; see above for
         * why it cannot be a literal at install time. */
        'circle-stroke-width': [
          'case',
          ['get', '_first'], STORM_GEO.pointStrokeWidthFirst,
          STORM_GEO.pointStrokeWidth,
        ],
      },
    },
    beforeId
  );

  /* The code inside the dot. A separate symbol layer for the same reason the
   * live globe's is: it belongs to ITS point and must never be moved or dropped
   * by collision, or a dot would show a neighbour's category. */
  map.addLayer(
    {
      id: LAYER_CODE,
      type: 'symbol',
      source: SOURCE,
      filter: ['==', ['get', 'kind'], 'fix'],
      layout: {
        'text-field': ['get', '_code'],
        'text-font': ['Noto Sans Regular'],
        'text-size': STORM_GEO.pointCodeSize,
        'text-anchor': 'center',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      /* A CONSTANT `gs()`, which is allowed: this expression reads no feature
       * data, so it is evaluated on the main thread where the state exists. */
      paint: { 'text-color': gs('geoPointCodeColor') },
    },
    beforeId
  );

  paintInks(map);
}

/** Build the whole feature set from the remembered list and the selection. */
function push(map) {
  const src = map?.getSource?.(SOURCE);
  if (!src) return;

  const features = [];
  for (const entry of lastSet) {
    const id = entry?.storm?.id;
    features.push(...pointsForStorm(entry?.storm, Boolean(id) && id === focusId));
  }

  src.setData({ type: 'FeatureCollection', features });
  paintInks(map);
}

/**
 * Draw exactly these storms' dots and nothing else. Whole-set push, same
 * contract as the tracks — unticking is this call with a shorter list.
 *
 * @param {object} map
 * @param {Array<{storm:object, facts:object}>} selected
 */
export function setSeasonPoints(map, selected = []) {
  lastSet = Array.isArray(selected) ? selected : [];
  push(map);
}

/**
 * The reader opened one storm in full detail, or closed it.
 *
 * ==> IT REBUILDS RATHER THAN REPAINTS, WHICH THE TRACKS NEXT DOOR DO NOT. <==
 * A per-fix dot does not exist until its storm is selected, so this genuinely
 * is new data. The cost is bounded by the same thing that makes the feature
 * affordable at all: one storm's fixes, forty-odd features, not a season's
 * eleven hundred.
 *
 * @param {object} map
 * @param {string|null} id
 */
export function setSeasonPointFocus(map, id = null) {
  focusId = id || null;
  if (map?.getLayer?.(LAYER_ONE)) {
    map.setPaintProperty(LAYER_ONE, 'circle-opacity', focusOpacity(focusId));
  }
  push(map);
}

/** Leaving the archive. Drops the dots, the remembered set and the selection
 *  together — a reader who leaves with Katrina open and comes back to 1935 must
 *  not find one arbitrary storm's fixes on screen. */
export function clearSeasonPoints(map) {
  focusId = null;
  lastSet = [];
  map?.getSource?.(SOURCE)?.setData(EMPTY);
  if (map?.getLayer?.(LAYER_ONE)) {
    map.setPaintProperty(LAYER_ONE, 'circle-opacity', focusOpacity(null));
  }
}

export const __internals = {
  pointsForStorm,
  gradeAt,
  focus: () => focusId,
  setSize: () => lastSet.length,
};
