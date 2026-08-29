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
import { LABEL_PLACEMENT } from '../../config/constants.js';
import { palette } from '../../config/theme.js';
import { categoryColor, categoryDotCode, categoryFromKt } from '../../lib/category.js';
import { stormDisplayName } from '../../lib/season-names.js';
import { firstCycloneTime, natureAt, statusDotCode } from '../../lib/season-nature.js';
import { gs } from '../theme-state.js';
import { focusOpacity } from './season-focus.js';
import { placeName } from './name-placement.js';

const SOURCE = 'season-points';
const LAYER_ONE = 'season-point-one';
const LAYER_FIX = 'season-point-fix';
const LAYER_CODE = 'season-point-code';
const LAYER_NAME = 'season-point-name';
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
function pointFeature({ id, kind, lat, lon, color, code = '', first = false, small = false }) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { id, kind, color, _code: code, _first: first, _small: small },
  };
}

/**
 * The reading at one fix: what kind of system it was, what colour that is, and
 * what letters go inside the circle.
 *
 * ==> IT READS THE STATUS COLUMN NOW, AND UNTIL 2026-08-29 IT READ ONLY THE
 * WIND. <== §57.7f. Aaron opened Beryl 2018 and found a chain of green `TS`
 * dots across Dominica and Puerto Rico under a panel correctly saying she never
 * came ashore. **Her wind never dropped — she was 45 kt at Dominica. What she
 * lost was her structure**, which is the one thing a wind number cannot tell
 * you and the status column can. She is coded `DB` for every one of those
 * crossings.
 *
 * The old comment here called passing `'tropical'` unconditionally "a known
 * simplification" whose cost was "an extratropical tail draws in the hue of its
 * wind rather than a duller one." Measured, the cost was 12,355 fixes across
 * 1,440 storms wearing a cyclone's letters, and 687 of them wearing a
 * Saffir-Simpson NUMBER on an `EX` or `LO` fix. A hue is a preference; letters
 * that contradict the sentence below them are a §5 failure.
 *
 * Three readings, and the vocabulary is `lib/category.js`'s existing one:
 *
 *   - **tropical** — graded exactly as before. Nothing about a real cyclone's
 *     dot changed, which is what keeps this off the glass for most storms.
 *   - **post-tropical** — `stormEnded`, full size, with the record's own
 *     letters. Sandy approaching New Jersey must not shrink away; she was still
 *     lethal.
 *   - **remnant** — `stormEnded`, small and blank. Never a storm, nothing to
 *     say about it.
 *
 * ==> BOTH NON-CYCLONE READINGS ARE THE SAME GREY, AND SIZE IS WHAT SEPARATES
 * THEM. <== Aaron's call, 2026-08-29, after the first attempt used the teal
 * `PREGENESIS_COLOR` for one and the brick `CATEGORY_COLOR.GENERIC` for the
 * other: the teal read too close to the `TD` blue and the brick read as a
 * strong storm. Neither system has a severity to claim, so neither gets a hue
 * that implies one — `stormEnded` is the app's existing "this had a colour and
 * no longer has one", already defined in all three palettes.
 */
function gradeAt(windKt, status = null, bornAt = null, time = null) {
  const nature = natureAt(status, time, bornAt);
  /* ==> A CATEGORY IS COMPUTED ONLY FOR A CYCLONE. <== `categoryColor` and
   * `categoryDotCode` both refuse a non-categorizable nature anyway, so this is
   * belt and braces — but it also means the number never exists to be leaked by
   * a later caller reading `cat` for something else. */
  const cat = nature === 'tropical' && Number.isFinite(windKt)
    ? categoryFromKt(windKt) : null;
  if (nature === 'tropical') {
    return {
      nature,
      small: false,
      /* `categoryColor` answers with the ungraded hue rather than nothing when
       * the record carries no wind — which happens all through the 19th century
       * — so this can never resolve to a missing paint property. Same guarantee
       * the track colour carries. */
      color: categoryColor(cat, nature, null),
      code: categoryDotCode(cat, nature),
    };
  }
  /* ==> THE GREY IS RESOLVED HERE, AT BUILD TIME, AND THAT IS DELIBERATE. <==
   * `stormEnded` is palette-scoped, so the obvious spelling is a `gs()` in the
   * layer's paint. That would put a global-state reference in the same
   * expression as `['get', 'color']` — the shape `SPEC-MAP.md` rule 1b forbids
   * and the one the colour-null hunt went looking for. `palette()` is a
   * question asked at paint time, and this file already rebuilds its features
   * when the mode changes, so reading it here is both correct and cheap. */
  return {
    nature,
    small: nature === 'remnant',
    color: palette().stormEnded,
    code: nature === 'post-tropical' ? statusDotCode(status) : '',
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

  /* ==> COMPUTED ONCE OVER THE WHOLE TRACK, NOT PER DOT. <== §57.7f. Whether a
   * fix is post-tropical or merely pre-genesis depends on when the storm FIRST
   * became a cyclone, which is a fact about the storm rather than about the
   * fix. Read from `storm.points` rather than from `drawable` so that dropping
   * an unreadable position cannot move the birth moment. */
  const bornAt = firstCycloneTime(storm.points || []);

  /* THE ONE-RECORD CASE FIRST, and it is `< 2` rather than `=== 1` so that a
   * storm whose only points are unreadable is treated the same way: something
   * was ticked, so something must appear. It returns immediately — a storm
   * with one fix must never draw both kinds of dot on top of each other. */
  if (drawable.length < 2) {
    if (drawable.length === 1) {
      const p0 = drawable[0];
      const g = gradeAt(p0.windKt, p0.status, bornAt, p0.time);
      /* ==> IT TAKES THE COLOUR BUT NOT THE SMALL SIZE. <== §57.7g. A one-record
       * dot is already its own smaller radius (`onePointRadius`) and it is the
       * storm's ENTIRE presence on the globe — shrinking it again for being a
       * `DB` would work against the §5 reason this kind of dot exists at all.
       * The grey still says what it was. */
      out.push(pointFeature({
        id, kind: 'one', lat: drawable[0].lat, lon: drawable[0].lon, color: g.color,
      }));
    }
    return out;
  }

  if (!selected) return out;

  for (let i = 0; i < drawable.length; i++) {
    const p = drawable[i];
    const g = gradeAt(p.windKt, p.status, bornAt, p.time);
    out.push(pointFeature({
      id,
      kind: 'fix',
      lat: p.lat,
      lon: p.lon,
      color: g.color,
      code: g.code,
      small: g.small,
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

/* ---------------------------------------------------------------------------
 * ==> THE SELECTED STORM'S NAME MOVES OFF ITS LINE AND ONTO ITS FIRST DOT. <==
 *
 * Aaron's call, 2026-08-25. Everything else keeps the name set ALONG the track
 * by MapLibre, which is right for a bare curve — but a selected storm is no
 * longer a bare curve, and a name lying along a chain of forty dots reads as
 * running through them.
 *
 * ==> AND THIS REVERSES `season-tracks.js`'s ARGUMENT ABOUT `name-placement.js`
 * RATHER THAN IGNORING IT. <== That file says at length that the module is the
 * wrong tool here, because it solves "where a name sits BESIDE a moving storm's
 * position dot, chosen in screen space against the forecast geometry it must
 * not cross" — and an archive track had no dot. **It has one now.** The
 * precondition the argument rested on is exactly what this pass added, so the
 * module became the right tool the moment the dots appeared. The argument is
 * still correct for every UNSELECTED track, which is why those still set their
 * names along the line.
 *
 * ==> PLACEMENT IS SCREEN-SPACE, SO IT HAS TO BE RECOMPUTED WHEN THE CAMERA
 * MOVES. <== Same debounce and same constant as the live globe's
 * (`LABEL_PLACEMENT.recomputeDebounceMs`), and the same reason: projecting a
 * track and running the collision search is far too much to do per frame. It is
 * cheap here in a way it is not on the live globe, because there is at most one
 * storm's worth of points and only while something is selected — with nothing
 * selected there are no fixes and the pass returns immediately.
 * ------------------------------------------------------------------------- */

/** Below the dot — MapLibre's `top` anchor puts the TOP of the text on the
 *  anchor point, which is easy to read backwards. It is the placement this app
 *  has always used, so a name that cannot be placed anywhere degrades to the
 *  familiar answer rather than to something new (`name-placement.js`). It is
 *  also what a stub with no `project` gets, so the name still draws. */
const NAME_ANCHOR_DEFAULT = 'top';
const NAME_OFFSET_DEFAULT = Object.freeze([0, 1]);

let placeTimer = null;

/**
 * Put the selected storm's name beside its first dot.
 *
 * Mutates the `_first` feature in place, before `setData` — one push, not two.
 *
 * @param {object} map
 * @param {Array<object>} features  the set about to be pushed
 */
function stampName(map, features) {
  const fixes = features.filter((f) => f.properties.kind === 'fix');
  const i = fixes.findIndex((f) => f.properties._first);
  if (i < 0) return;

  const storm = lastSet.find((e) => e?.storm?.id === fixes[i].properties.id)?.storm;
  const name = storm ? stormDisplayName(storm) : '';
  if (!name) return;

  const first = fixes[i];
  first.properties._name = name;
  first.properties._nameAnchor = NAME_ANCHOR_DEFAULT;
  first.properties._nameOffset = [...NAME_OFFSET_DEFAULT];

  /* No camera, no screen space, no placement — the default stands and the name
   * still draws. A suite's stand-in map has no `project`, and neither does a
   * style that has not installed yet. */
  if (typeof map?.project !== 'function') return;

  let pts;
  try {
    pts = fixes.map((f) => {
      const p = map.project(f.geometry.coordinates);
      return { x: p.x, y: p.y };
    });
  } catch {
    /* A projection that throws mid-camera-move is not worth an exception here;
     * the default placement is already on the feature. */
    return;
  }

  const placed = placeName(pts, {
    anchorIndex: i,
    /* Uppercase and tracked, the same as the live globe's — see
     * `LABEL_PLACEMENT.nameCharEm`. Measured against the size this name is
     * actually DRAWN at, which is the archive's own and one point smaller. */
    widthPx: name.length * LABEL_PLACEMENT.nameCharEm * ARCHIVE_GEO.nameSize,
    heightPx: LABEL_PLACEMENT.nameLineEm * ARCHIVE_GEO.nameSize,
    /* Clearance from the dot's CENTRE. The first dot wears the wider ring, so
     * this reads `pointStrokeWidthFirst` rather than the ordinary stroke — the
     * name hangs off that dot and no other. */
    clearPx: STORM_GEO.pointRadius + STORM_GEO.pointStrokeWidthFirst
      + ARCHIVE_GEO.nameGapPx,
  });
  if (!placed) return;

  first.properties._nameAnchor = placed.anchor;
  /* `text-offset` is in ems of the label's own size. */
  first.properties._nameOffset = [
    placed.offsetPx[0] / ARCHIVE_GEO.nameSize,
    placed.offsetPx[1] / ARCHIVE_GEO.nameSize,
  ];
}

/** Re-place after the camera settles. Guarded on there being a selection at
 *  all, so panning an archive globe with nothing open costs one comparison. */
function scheduleName(map) {
  if (!focusId) return;
  clearTimeout(placeTimer);
  placeTimer = setTimeout(() => {
    placeTimer = null;
    push(map);
  }, LABEL_PLACEMENT.recomputeDebounceMs);
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
        /* ==> TWO RADII, AND THE EXPRESSION READS ONLY FEATURE DATA. <== §57.7g.
         * Both values are literal numbers off `config/tokens.js`, so there is
         * no `gs()` sharing this expression with a `['get', ...]` — the shape
         * rule 1b forbids. A system that was never a storm draws small and
         * blank; a cyclone and a post-tropical system both draw full size. */
        'circle-radius': [
          'case', ['get', '_small'], ARCHIVE_GEO.remnantPointRadius, STORM_GEO.pointRadius,
        ],
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

  /* ==> THE NAME, ON THE FIRST DOT. <== Filtered to the earliest fix, so there
   * is exactly one per selected storm and it can never appear on an unselected
   * track — those still set their names along the line (`season-tracks.js`).
   *
   * `text-anchor` and `text-offset` are BOTH genuinely data-driven in MapLibre
   * 5.6.0 and both are read per feature here, which is the arrangement
   * `map/markers.js` proved on the live globe. **`text-variable-anchor` must
   * stay absent:** setting it makes MapLibre choose the anchor itself and
   * silently ignore ours, which looks like the placement search failing.
   *
   * `text-allow-overlap` is left at MapLibre's default of FALSE, unlike the
   * code inside the dot. The code belongs to its circle and must never move;
   * the name is a label ABOUT the storm and may be dropped rather than stacked
   * on something. Same rule the along-the-line name follows. */
  map.addLayer(
    {
      id: LAYER_NAME,
      type: 'symbol',
      source: SOURCE,
      filter: ['all', ['==', ['get', 'kind'], 'fix'], ['get', '_first']],
      layout: {
        'text-field': ['get', '_name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ARCHIVE_GEO.nameSize,
        'text-transform': 'uppercase',
        'text-letter-spacing': ARCHIVE_GEO.nameTrackingEm,
        'text-anchor': ['get', '_nameAnchor'],
        'text-offset': ['get', '_nameOffset'],
      },
      paint: {
        'text-color': gs('geoStormLabelColor'),
        'text-halo-color': gs('geoStormLabelHalo'),
        'text-halo-width': ARCHIVE_GEO.nameHaloWidth,
      },
    },
    beforeId
  );

  /* Placement is screen-space, so the camera invalidates it. Bound here rather
   * than in `main.js` because `ensure` runs once for the life of the page —
   * the early return at the top is what makes that true — so there is exactly
   * one listener and nothing to tear down. */
  map.on?.('moveend', () => scheduleName(map));

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

  stampName(map, features);

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
