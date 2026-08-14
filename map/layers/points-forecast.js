/**
 * points-forecast.js — Saffir-Simpson-colored forecast points with their
 * classification code drawn inside, plus date/time labels on a spoke
 * (SPEC §7).
 *
 * Color comes from NHC's own per-point `ssnum` — REPORTED, never derived
 * (§7, confirmed live). ssnum 1–5 maps straight onto Cat 1–5. Below
 * hurricane strength ssnum is 0 and `tcdvlp` ("Tropical Depression" /
 * "Tropical Storm") says which sub-hurricane color applies; anything
 * unrecognized gets the §6 generic hue rather than a guessed severity. The
 * same reading drives the code drawn inside the dot, so color and text can
 * never disagree.
 *
 * LABELS ARE AMBIENT (warm), not selection-only. They show DEVICE-LOCAL
 * time formatted from the parsed `_time` (annotated in data/nhc-mapserver.js
 * from `validtime` + `advdate` — SPEC §7). NHC's `datelbl` is never
 * rendered: it is basin-local with no zone marker, which shipped a Hawaii
 * clock to viewers in other zones. A point whose time does not parse shows
 * NO label. The toggle still gates whether times draw at all; the zoom
 * ladder gates when.
 *
 * PLACEMENT IS OURS, NOT MapLibre'S.
 * Each label rides the normal to the track at its point — a spoke on a
 * wheel — and the whole run's arrangement is chosen at once so the labels
 * stay on one side wherever the geometry allows. MapLibre cannot express
 * that, so label-placement.js computes an offset per feature and MapLibre
 * just draws it.
 *
 * HOW THE OFFSET REACHES MapLibre — SETTLED, but three attempts failed
 * first. Recorded so nobody repeats them:
 *   - `text-translate` does NOT support data-driven styling at all. A
 *     `['get']` there is silently ignored and every label sits on its point.
 *   - `['array','number',2,[['get','_ox'],['get','_oy']]]` on `text-offset`
 *     is INVALID — the array-constructor form cannot take expressions as
 *     elements. An invalid expression takes the WHOLE LAYER down, which is
 *     how this first shipped rendering no labels at all.
 *   - `text-radial-offset` + `text-anchor` validates and draws, but
 *     radial-offset only pushes along ONE axis: the spec states the text's
 *     nearest edge is placed N ems out, outward in X for a left/right anchor
 *     and outward in Y for top/bottom. A diagonal anchor does not give a
 *     diagonal push, so every label snapped to straight above or below its
 *     dot — the spoke was gone.
 *
 * CURRENT STATE: `'text-offset': ['get', '_o']` with `_o` a plain `[x, y]`
 * ems array and `text-anchor: 'center'`. `text-offset` IS genuinely
 * data-driven (property-type `data-driven`, parameters `["zoom","feature"]`,
 * read from the spec object itself), the expression validates, the layer
 * draws, and the placement module emits true diagonals.
 *
 * THE TRANSPORT IS NOT THE PROBLEM AND NEVER WAS.
 * Read live off the source with two storms up, `_o` arrived as a real JS
 * array of two finite numbers, including true diagonals ([-2.34, 0.34],
 * [-0.22, 2.35]). So all four long-standing suspects are DEAD: `_o` survives
 * `setData` intact, no Y flip is needed, and neither the globe projection nor
 * the em conversion is implicated. The transport works and placement emits
 * spokes. Do not re-investigate those four.
 *
 * A REAL BUG WAS FOUND AND FIXED HERE, BUT IT WAS NOT THE CAUSE EITHER.
 * Placement grouped by storm on `stormId ?? STORMID ?? '_'`, and NHC's 5-day
 * points layer publishes NEITHER. Every point from every storm landed in the
 * one fallback bucket and was placed as a single track: measured with Bertha
 * (AL 2, 3 points) and Fausto (EP 6, 9 points) live, twelve points in one
 * list, so the tangent at the seam between them was a chord drawn across an
 * ocean. That is genuinely wrong and is now fixed — keyed on `basin` +
 * `stormnum`, confirmed off a live feature. `stormname` is NOT safe (it
 * carries intensity: "Tropical Storm Bertha" becomes "Hurricane Bertha");
 * `idp_source` holds the full ATCF id but changes every advisory, so it is
 * the fallback only.
 *
 * WHAT THE REMAINING FAULT ACTUALLY WAS (2026-07-26).
 * The vectors were right, the transport was right, and the grouping fix was
 * right. What was wrong was the COLLISION HANDLING inside
 * label-placement.js: it placed labels one at a time and flipped each one
 * that hit the label before it, which on a due-west track produced
 * up-down-up-down all the way along. Measured seven side changes in eight
 * labels. It read as noise and was easy to mistake for a broken offset.
 *
 * The angle of the track on screen decides everything, and that is the
 * variable every previous investigation held constant. A diagonal track
 * staircases its labels and they all sit happily on one side — which is why
 * Aaron's 2026-07-26 photo, a recurving East Pacific storm, looked correct
 * while a westward storm did not. Full account in label-placement.js.
 *
 * WHY OFFLINE VALIDATION KEPT MISSING IT. Every isolation test fed ONE
 * synthetic track, always the same one, so the one variable that mattered
 * never varied. `tools/test-label-placement.mjs` now sweeps track ANGLE and
 * dot SPACING, because a fixture that cannot reproduce the failure is not a
 * test. Reading live feature properties killed four standing suspects in one
 * step before that. Measure the running app first, then vary the input that
 * the app varies.
 *
 * Unattributable points are hidden rather than placed off a borrowed
 * neighbour, and each track is sorted by `tau` so placeSpokes' documented
 * track-order precondition is guaranteed instead of assumed.
 *
 * The old static `labelOffsetEm` token is retired; the spoke replaces it.
 *
 * Placement is screen-space, so it is recomputed on `moveend` (debounced)
 * rather than per frame: on a globe on a phone, per-frame placement is the
 * frame budget gone. Labels settle when the camera does.
 *
 * Imports: config, lib, and label-placement (one direction, no cycle).
 */

import { STORM_GEO, SIZE } from '../../config/tokens.js';
import { palette } from '../../config/theme.js';
import { gs } from '../theme-state.js';
import { ZOOM, LABEL_PLACEMENT } from '../../config/constants.js';
import { formatClockDay } from '../../lib/time.js';
import { trackPointReading } from '../../lib/track-point.js';
import { placeSpokes } from './label-placement.js';
import { placeName } from './name-placement.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-fpoints';
const AMB_SOURCE = 'amb-fpoints';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** Last data handed to each source, kept so a camera move can re-place the
 *  labels without waiting for the next poll. */
let lastAmbient = null;
let lastSelected = null;

/* The category reading MOVED to lib/track-point.js (SPEC §12) when the cage
 * ridge became its second caller. Same function, same precedence rules; it is
 * imported above rather than kept here so a dot and the ridge beneath it can
 * never disagree about the same storm at the same hour. */

/* The dot's color-and-code reading MOVED to lib/track-point.js alongside the
 * category reading, for the same reason and in the same pass: the cage ridge
 * (map/storm-mesh.js) now lifts from these exact positions, so a third surface
 * would otherwise form a fourth opinion about the same storm at the same hour.
 * Imported as `trackPointReading` above — it returns `index` as well, which
 * this file does not need and the ridge does. */

/**
 * Stamp `_first` on the earliest forecast point of EACH STORM.
 *
 * ==> PER STORM, NEVER PER COLLECTION. <== The ambient source carries every
 * live storm's points in one FeatureCollection, so `features[0]` would mark
 * one dot on one storm and leave every other track unmarked — and which storm
 * won would depend on upstream ordering. This reuses `stormKey`, the same
 * grouping that fixed the label-spoke bug for the same reason.
 *
 * ORDERING MATCHES applyPlacement'S, DELIBERATELY: lowest finite `tau` wins,
 * and a group with no finite `tau` anywhere falls back to arrival order. If
 * these two ever disagreed, the white ring would sit on one dot while the
 * label spokes fanned out from another, which is worse than either choice.
 * GDACS points carry no `tau`, so the fallback is the live path for that
 * source rather than a defensive branch nothing exercises.
 *
 * An UNATTRIBUTABLE point gets no ring. Same rule as its label: a mark that
 * says "the storm starts here" is a claim, and a point we cannot tie to a
 * storm cannot support it. Better an unmarked track than a confident lie
 * about which way it is going.
 *
 * @param {Array} features Decorated features, mutated in place.
 */
export function stampFirst(features) {
  /** stormKey -> the feature currently winning, and its tau. */
  const best = new Map();

  for (const f of features) {
    const key = stormKey(f.properties);
    if (key == null) continue;

    const tau = f.properties?.tau;
    const cur = best.get(key);
    if (!cur) { best.set(key, { f, tau }); continue; }

    const a = Number.isFinite(tau) ? tau : null;
    const b = Number.isFinite(cur.tau) ? cur.tau : null;
    /* A real hour beats no hour; two real hours compare; two missing hours
     * keep whichever arrived first, which is arrival order. */
    if (a != null && (b == null || a < b)) best.set(key, { f, tau });
  }

  for (const { f } of best.values()) f.properties._first = true;
}

function decorated(fc) {
  const features = (fc?.features || [])
    .filter((f) => f.geometry?.type === 'Point')
    .map((f) => {
        const { color, code } = trackPointReading(f.properties);
        return {
          ...f,
          properties: {
            ...f.properties,
            _color: color,
            _code: code,
            /* Placement fills these in. They must exist up front or the
             * first paint reads null through ['get', ...]. */
            /* [x, 0] in EMS, along the TEXT's own x axis — which rotates
             * with `_rot`, so this is a distance out along the spoke and
             * not a screen-space vector. */
            _o: [0, 0],
            /* Degrees clockwise, straight to `text-rotate`. */
            _rot: 0,
            /* Which end of the text sits against the dot. */
            _anchor: 'left',
            /* HIDDEN UNTIL PLACED, which is the inverse of what this used to
             * be. Ambient placement is now deferred onto the debounced path
             * (see schedulePlacement), so between the data landing and the
             * placement running these labels have no spoke — and a default of
             * `false` would draw the whole set stacked on top of their own
             * dots for that window. The dots and their category codes carry no
             * filter and appear immediately; only the time text waits. */
            _hide: true,
            /* FALSE UP FRONT, for the reason `_o`/`_rot` are set up front: a
             * `['get','_first']` reading undefined on the first paint would
             * make the `case` expression fall to its default anyway, but only
             * by accident. Stated defaults beat lucky ones. Overwritten on
             * exactly one feature per storm by stampFirst below. */
            _first: false,
          },
        };
      });

  stampFirst(features);
  return { type: 'FeatureCollection', features };
}

/* ---------------------------------------------------------------------------
 * Spoke placement, recomputed when the camera settles.
 *
 * Features are grouped by storm before placing: a spoke's angle comes from
 * its NEIGHBOURS along that storm's track, so mixing two storms into one
 * ordered list would derive a tangent across the gap between them.
 *
 * THE KEY IS NHC'S OWN FIELDS, MEASURED — not a guessed camelCase id.
 * This grouped on `stormId ?? STORMID`, neither of which NHC's 5-day points
 * layer publishes. Every point therefore fell into one bucket and both live
 * storms were placed as a single track: measured 2026-07-23 on Bertha (AL,
 * 2) and Fausto (EP, 6), where the tangent at the seam between them was a
 * chord across an ocean and the resulting normals collapsed onto the screen
 * axes. That IS the label-spoke bug — not the globe projection, not
 * `text-offset`, not the em conversion. The offsets were real 2D vectors the
 * whole time; they were computed from the wrong neighbours.
 *
 * `basin` + `stormnum` ("AL"/2) is the stable pair: it survives a storm
 * changing intensity, which `stormname` does not ("Tropical Storm Bertha"
 * becomes "Hurricane Bertha"). `idp_source` carries the full ATCF id and is
 * the fallback, but it changes every advisory, so it is second choice.
 * ------------------------------------------------------------------------- */

/** Stable per-storm key, or null when this feature cannot be attributed. */
function stormKey(props) {
  /* AN EXPLICIT KEY WINS. The fields below are NHC's, and a source that
   * publishes none of them would have every one of its points treated as
   * unattributable and hidden — a whole source's labels silently gone, which
   * is the failure this function's own orphan rule is designed to cause on
   * purpose for genuinely unidentifiable points. GDACS stamps its storm id
   * at parse time, so it is identified rather than guessed at. */
  if (props?._stormKey) return String(props._stormKey);

  const basin = props?.basin;
  const num = props?.stormnum;
  if (basin != null && num != null) return `${basin}${num}`;
  if (props?.idp_source != null) return String(props.idp_source);
  return null;
}

/**
 * Group features by storm. Unattributable features are returned SEPARATELY
 * rather than swept into a shared bucket: one shared bucket is what produced
 * the cross-storm tangent above. A label with no derivable spoke is left
 * unplaced (§5 — no silent invention), never placed off a neighbour that
 * belongs to a different storm.
 *
 * @returns {{groups: Map, orphans: Array}}
 */
function groupByStorm(features) {
  const groups = new Map();
  const orphans = [];
  for (const f of features) {
    const key = stormKey(f.properties);
    if (key == null) { orphans.push(f); continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  return { groups, orphans };
}

/** Pixels → ems, the unit `text-offset` takes. */
const toEm = (px) => px / STORM_GEO.labelSize;

/* ---------------------------------------------------------------------------
 * THE STORM'S OWN NAME — CHOSEN HERE, DRAWN IN markers.js.
 *
 * ==> THE SPLIT IS FORCED BY THE IMPORT RULE, AND THE RULE IS RIGHT. <== The
 * name LAYER belongs to the `storms` source, which is markers.js's. But this
 * file is the only one that projects the forecast geometry, so it is the only
 * one that knows which way the track is actually DRAWN on screen — and the
 * heading NHC reports is not a usable stand-in for that (the measurement is in
 * name-placement.js's header). `map/layers/*` must never import markers.js;
 * markers.js may import from here. So the flow runs one way: this file
 * computes the anchor and offset, markers.js subscribes and re-stamps them as
 * data-driven layout.
 *
 * AND THE ORDER INSIDE THIS FILE IS ALSO ONE WAY: name first, off the raw
 * geometry, then the time labels routed around the box it landed in. The name
 * outranks the timestamps and never yields to them, so the two can never end
 * up chasing each other around the same dot.
 * ------------------------------------------------------------------------- */

/** sourceId -> Map(stormId -> { anchor, offsetEm }). Two sources because the
 *  ambient and selected passes run independently; they compute the same
 *  answer for a storm in both, since they place the same projected points. */
const namePlacements = new Map();
const nameListeners = new Set();

/**
 * Subscribe to name placement changes. Called by map/markers.js, which owns
 * the layer this feeds. Fires only when something actually MOVED — a camera
 * nudge that leaves every name on the same side must not cost a `setData` on
 * the storm source for nothing.
 *
 * @returns {() => void} unsubscribe
 */
export function onNamePlacement(fn) {
  nameListeners.add(fn);
  return () => nameListeners.delete(fn);
}

/**
 * Where this storm's name should sit, or null if placement has not run for it
 * yet (first paint, a storm with no forecast points, an unattributable track).
 * A null answer is not a failure — the caller falls back to below the dot,
 * which is where the name lived before any of this existed.
 */
export function namePlacementFor(stormId) {
  if (stormId == null) return null;
  const key = String(stormId);
  for (const m of namePlacements.values()) {
    const hit = m.get(key);
    if (hit) return hit;
  }
  return null;
}

/** Drop a source's placements when it goes empty. Without this a deselected
 *  storm's name would keep the anchor it was given while it was on screen —
 *  and if it is still drawn as an ambient storm, that anchor was computed
 *  from geometry the map is no longer showing. */
function forgetNames(sourceId) {
  if (!namePlacements.get(sourceId)?.size) return;
  namePlacements.delete(sourceId);
  for (const fn of nameListeners) fn();
}

/** Cheap equality so a no-op pass does not wake markers.js up. */
function samePlacements(a, b) {
  if (!a || a.size !== b.size) return false;
  for (const [k, v] of b) {
    const p = a.get(k);
    if (!p || p.anchor !== v.anchor) return false;
    if (p.offsetEm[0] !== v.offsetEm[0] || p.offsetEm[1] !== v.offsetEm[1]) return false;
  }
  return true;
}

/**
 * Pick a spot for one storm's name and hand back both halves of the answer:
 * what markers.js needs to draw it, and the screen box the time labels have to
 * stay out of.
 *
 * ==> EVERY NUMBER IS READ FROM THE TOKENS THE NAME IS ACTUALLY DRAWN WITH,
 * NOT RESTATED. <== A name that moves and a keep-out box that does not is
 * worse than no keep-out box at all — the timestamps would be spread around a
 * rectangle that is not where the text is.
 *
 * ==> AND IT HANGS OFF THE FIRST POINT, WHICH IS THE STORM'S POSITION. <== At
 * the zoom where names appear, a live storm's position dot IS its tau-0
 * forecast point (the same fact the ended-storm mark is built on). `_first` is
 * already stamped on exactly that feature by `stampFirst`, so there is no
 * second notion of "where the storm is" to fall out of step with the one the
 * rest of this file uses.
 *
 * Returns null when there is no name to place — an unattributed track, or a
 * source that publishes no name. Null is not a bug: nothing is drawn there, so
 * there is nothing for the timestamps to avoid and nothing for markers to move.
 */
function nameFor(group, pts) {
  const i = group.findIndex((f) => f.properties?._first);
  if (i < 0) return null;
  const props = group[i].properties;
  const name = props?._stormName;
  if (!name || !pts[i]) return null;

  const placed = placeName(pts, {
    anchorIndex: i,
    /* Uppercase, tracked — see LABEL_PLACEMENT.nameCharEm. */
    widthPx: name.length * LABEL_PLACEMENT.nameCharEm * SIZE.stormLabelPx,
    heightPx: LABEL_PLACEMENT.nameLineEm * SIZE.stormLabelPx,
    /* Clearance from the dot's EDGE, expressed from its centre. The same
     * three tokens markers.js used to bake into its fixed offset. */
    clearPx:
      STORM_GEO.pointRadius + STORM_GEO.pointStrokeWidth + SIZE.stormLabelGapPx,
  });
  if (!placed) return null;

  /* `_stormId` is stamped by both data sources at parse time and IS the id
   * markers.js keys its features on. The grouping key above is not — it is
   * `basin`+`stormnum` for NHC, which the storm source has never heard of. */
  const id = props._stormId ?? props._stormKey;
  return {
    id: id == null ? null : String(id),
    anchor: placed.anchor,
    /* `text-offset` is in ems of the label's own size. */
    offsetEm: [
      placed.offsetPx[0] / SIZE.stormLabelPx,
      placed.offsetPx[1] / SIZE.stormLabelPx,
    ],
    rect: placed.rect,
  };
}

function applyPlacement(map, sourceId, fc) {
  if (!fc?.features?.length) return;
  const out = fc.features.map((f) => ({ ...f, properties: { ...f.properties } }));

  const { groups, orphans } = groupByStorm(out);

  /* Rebuilt from scratch every pass rather than patched, so a storm that
   * loses its forecast points drops out instead of leaving markers.js holding
   * an anchor derived from geometry that is no longer on the map. */
  const names = new Map();

  /* An unattributable point has no track to ride, so it gets no spoke. Hidden
   * beats placed-at-a-guess: a label sitting on a tangent borrowed from
   * another storm looks authoritative and is wrong. */
  for (const f of orphans) {
    f.properties._o = [0, 0];
    f.properties._rot = 0;
    f.properties._anchor = 'left';
    f.properties._hide = true;
  }

  for (const group of groups.values()) {
    /* TRACK ORDER IS A PRECONDITION of placeSpokes — the tangent comes from
     * pts[i-1] and pts[i+1], so an out-of-order list derives it from the
     * wrong neighbours. NHC delivers points in order today; sorting by `tau`
     * (forecast hour) makes that a guarantee rather than a dependency on
     * upstream ordering. Points without `tau` keep their relative position
     * at the end rather than jumping to the front. */
    group.sort((a, b) => {
      const ta = a.properties?.tau;
      const tb = b.properties?.tau;
      if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
      if (!Number.isFinite(ta)) return 1;
      if (!Number.isFinite(tb)) return -1;
      return ta - tb;
    });

    const pts = group.map((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const pt = map.project([lon, lat]);
      /* Device-local text from the parsed UTC `_time` (annotated in the data
       * layer from `validtime` + `advdate`). `datelbl` MUST NOT render — it
       * is basin-local with no zone marker, so an East Pacific storm would
       * put a Hawaii clock on every viewer's screen (SPEC §7). A point whose
       * time did not parse gets NO label rather than a wrong one — a visible
       * gap is the honest outcome. */
      const lbl = formatClockDay(f.properties._time) || '';
      f.properties._lbl = lbl;
      return { x: pt.x, y: pt.y, text: lbl };
    });
    /* NAME FIRST, THEN THE TIMES AROUND IT. Not a tie-break — an order. */
    const name = nameFor(group, pts);
    if (name?.id) names.set(name.id, { anchor: name.anchor, offsetEm: name.offsetEm });

    const placed = placeSpokes(pts, { nameRect: name?.rect ?? null });
    group.forEach((f, i) => {
      const noLbl = !f.properties._lbl;
      const pl = placed[i];
      if (pl) {
        f.properties._o = [toEm(pl.offPx), 0];
        f.properties._rot = pl.rotDeg;
        f.properties._anchor = pl.anchor;
        f.properties._hide = pl.hidden || noLbl;
      } else if (noLbl) {
        f.properties._hide = true;
      }
    });
  }

  map.getSource(sourceId)?.setData({ type: 'FeatureCollection', features: out });

  /* Tell markers.js, but only if a name actually moved. Placement reruns on
   * every settled camera move, and the overwhelmingly common outcome is that
   * every name stays exactly where it was — waking the storm source for that
   * would put a `setData` on the end of every pan (§ performance lens). */
  if (!samePlacements(namePlacements.get(sourceId), names)) {
    namePlacements.set(sourceId, names);
    for (const fn of nameListeners) fn();
  }
}

/* ---------------------------------------------------------------------------
 * ONE DEBOUNCED PLACEMENT PATH, SHARED BY THE CAMERA AND THE DATA.
 *
 * Placement projects every forecast point of every warmed storm and runs the
 * collision search over the result. That was already too expensive to do per
 * camera frame — hence the moveend debounce this hoists out of `ensure`.
 *
 * What was missed is that `updateAmbient` ran the same work SYNCHRONOUSLY, and
 * the layer engine calls it on every ambient re-merge: a storm warming, a
 * selection opening or closing, a layer pref changing. On a tap it ran inside
 * the click handler, which is where it showed up as INP.
 *
 * The ambient set is context, not the thing being tapped, so it rides the
 * timer. THE SELECTED STORM STILL PLACES IMMEDIATELY — it is one storm's worth
 * of points and it is the thing the user just asked for; making it wait would
 * trade a measurement for a worse-feeling app, which §12's overriding lens
 * settles the other way round.
 * ------------------------------------------------------------------------- */

let placeTimer = null;

/** Re-place both sources once the dust settles. Every caller shares the one
 *  timer, so a camera move landing on top of a data change costs one pass. */
function schedulePlacement(map) {
  clearTimeout(placeTimer);
  placeTimer = setTimeout(() => {
    placeTimer = null;
    if (lastAmbient) applyPlacement(map, AMB_SOURCE, lastAmbient);
    if (lastSelected) applyPlacement(map, SOURCE, lastSelected);
  }, LABEL_PLACEMENT.recomputeDebounceMs);
}

/** The shared symbol config for a time-label layer. Built once so the
 *  ambient and selected layers cannot drift apart (§12: any pattern used
 *  twice gets extracted). */
function timeLabelLayer(id, source) {
  return {
    id,
    type: 'symbol',
    source,
    /* The ONE piece of forecast-point rendering that keeps a zoom floor,
     * and it applies to ambient AND selected alike — dots and tracks now
     * fade up with the map, but text needs a hard floor or it ghosts in
     * unreadably over the cage during the crossfade. */
    minzoom: ZOOM.ambientGeometry,
    filter: ['!', ['get', '_hide']],
    layout: {
      'text-field': ['get', '_lbl'],
      'text-font': ['Noto Sans Regular'],
      'text-size': STORM_GEO.labelSize,
      /* THE SPOKE. The text is ROTATED onto the normal to the track and
       * anchored at the end nearest the dot, so the line of text starts
       * just outside the dot and runs outward — it points back at the
       * dot's centre the way a spoke points at a hub.
       *
       * The offset is along the TEXT's own x axis, and MapLibre applies
       * the rotation to glyph positions that already include the offset
       * (verified in the bundled 5.6.0 source), so [g, 0] means "g out
       * along the spoke" rather than "g to the right of the screen".
       *
       * `text-anchor` flips to `right` with a negated offset whenever the
       * spoke points leftward, which is what keeps the text from drawing
       * mirrored. `text-radial-offset` must stay absent — it disables
       * `text-offset` outright. */
      'text-offset': ['get', '_o'],
      'text-anchor': ['get', '_anchor'],
      'text-rotate': ['get', '_rot'],
      /* Rotate in SCREEN space. Placement is computed from `map.project()`,
       * so the angles are screen angles; `map` alignment would re-rotate
       * them by the camera bearing on top of that. */
      'text-rotation-alignment': 'viewport',
      /* A wrapped label would break the geometry above, which assumes one
       * line. The default 10-em wrap is close enough to a long label to be
       * worth ruling out rather than trusting. */
      'text-max-width': 30,
      /* Placement already resolved the collisions on the spoke; anything it
       * could not fit is filtered out above, so MapLibre must not second-
       * guess the result by dropping more. */
      'text-allow-overlap': true,
      /* ignore-placement stays FALSE (changed from true, 2026-07-24, when
       * basemap city names arrived). The two flags are independent: allow-
       * overlap keeps this label DRAWING no matter what, while ignore-
       * placement false puts it in the collision index so it BLOCKS things
       * beneath it. Without that, a city name would happily render underneath
       * a forecast time and both would be unreadable. This cannot cause a
       * forecast label to disappear — allow-overlap above already guarantees
       * it draws. */
      'text-ignore-placement': false,
    },
    paint: {
      'text-color': gs('geoLabelColor'),
      'text-halo-color': gs('geoLabelHalo'),
      'text-halo-width': STORM_GEO.labelHaloWidth,
    },
  };
}

/** The code drawn inside a dot. It belongs to its point: it must never be
 *  moved or dropped by collision, or a dot would show a neighbour's
 *  category. */
function codeLayer(id, source) {
  return {
    id,
    type: 'symbol',
    source,
    layout: {
      'text-field': ['get', '_code'],
      'text-font': ['Noto Sans Regular'],
      'text-size': STORM_GEO.pointCodeSize,
      'text-anchor': 'center',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': gs('geoPointCodeColor') },
  };
}

/* ==> THERE IS NO DARK CASING UNDER THE FIRST DOT'S WHITE RING, AND THERE WAS
 * ONE FOR EXACTLY ONE COMMIT. <==
 *
 * The reasoning was that white needs something to be white against, and on the
 * greyscale light theme the ring measures 1.72:1 over the sea and 1.13:1 over
 * the near-white land. So a near-black disc 1.5 px wider went underneath.
 *
 * On glass that made the dot read as BLACK-RINGED, in both themes. Obvious in
 * hindsight: the outermost edge is what the eye calls "the stroke", and the
 * casing put a dark band outside the white one. In the dark theme it was worse
 * than pointless — the casing is the same near-black every other dot already
 * wears as its ring, so the marked dot stopped looking marked.
 *
 * Aaron's call, and it is a glass call, so it outranks the measurement. The
 * ring is `geo.pointStrokeFirst` — #FFFFFF, both themes, nothing under it.
 *
 * IF THE RING EVER NEEDS MORE PRESENCE, the honest lever is the BACKGROUND, not
 * another layer on top of the dot: a slightly deeper `LIGHT.ocean` or `land`
 * buys it back everywhere at once. Do not re-add a casing. */

/* No zoom floor on the dots or their codes: the MapLibre crossfade gates
 * them, so ambient and selected points behave identically. The code rides
 * its dot — gating one without the other would draw a bare dot. The TIME
 * labels are the exception and keep ZOOM.ambientGeometry (see
 * timeLabelLayer): a wall of text ghosting in at partial opacity over the
 * cage is unreadable, and that is a text problem, not a geometry one. */
function circleLayer(id, source) {
  return {
    id,
    type: 'circle',
    source,
    paint: {
      'circle-color': ['get', '_color'],
      'circle-radius': STORM_GEO.pointRadius,
      /* THE EARLIEST POINT OF EACH STORM WEARS A WHITE, WIDER RING, and the
       * job it does is DIRECTION. A track reading 1 → 2 → 2 → 1 has no start
       * and no end to the eye, so without this the reader has to already know
       * which way cyclones travel in that basin to tell the forecast from the
       * history. `_first` is stamped per storm in decorated(); see stampFirst.
       *
       * `['case', ...]` and not `['match', ...]`: the property is a boolean,
       * and `match` on a boolean is a shape MapLibre accepts and then reads
       * inconsistently across versions. `case` takes the boolean directly. */
      /* ==> BAKED FROM `palette()`, NOT `gs()`, AND THIS IS THE ONE PLACE IN
       * THE APP WHERE THAT IS THE RIGHT ANSWER. <==
       *
       * MapLibre evaluates a DATA-DRIVEN paint property in the WORKER — this
       * one is data-driven because `['get','_first']` is in it — and the
       * worker is never sent the global state. `Style._findGlobalStateAffected
       * Sources` only reloads a source when the key is read by a LAYOUT
       * property or a filter (`getLayoutAffectingGlobalStateRefs` walks
       * `_unevaluatedLayout` and nothing else), so a paint ref never gets
       * there either.
       *
       * The result is not an error. `to-color` of a missing value resolves to
       * BLACK, in both themes, permanently — which is exactly what shipped:
       * the ring below rendered black while `circle-stroke-width` two
       * properties down, an identical `case` on the same `_first` with plain
       * NUMBERS in its branches, worked perfectly. That asymmetry is the tell.
       *
       * ==> THE RULE, WHICH IS SHARPER THAN "ONLY PAINT COLOURS": A `gs()`
       * REFERENCE MUST NOT APPEAR IN AN EXPRESSION THAT ALSO READS FEATURE
       * DATA. <== Every other `gs()` in the app is constant, evaluated on the
       * main thread where the state exists, which is why the rest of the theme
       * switch works. `tools/test-theme-state.mjs` now fails the build on any
       * expression holding both.
       *
       * Baking is honest here rather than a workaround, because these two inks
       * are IDENTICAL IN BOTH THEMES by design — see the note on
       * DARK.geo.pointStroke. There is nothing to retheme. `test-first-point`
       * asserts they stay identical, so if anyone ever makes them differ they
       * are told, here, that this property cannot simply read global state. */
      'circle-stroke-color': [
        'case',
        ['get', '_first'], palette().geo.pointStrokeFirst,
        palette().geo.pointStroke,
      ],
      'circle-stroke-width': [
        'case',
        ['get', '_first'], STORM_GEO.pointStrokeWidthFirst,
        STORM_GEO.pointStrokeWidth,
      ],
    },
  };
}

registerLayer({
  key: 'forecastPoints',
  type: 'baseline', // the labels sub-layer is the additive part
  order: 50, // top of the selection stack, under the storm glyph itself

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;

    /* Ambient points, codes, AND time labels, all from the one ambient
     * floor (§9). Labels used to be selection-only on the grounds that
     * `datelbl` on every point of every storm is a wall of text — the spoke
     * placement is the answer to that: it thins by hiding what genuinely
     * cannot fit, rather than withholding the whole layer. */
    map.addSource(AMB_SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(circleLayer('amb-fpoints', AMB_SOURCE), beforeId);
    map.addLayer(codeLayer('amb-fpoints-code', AMB_SOURCE), beforeId);
    map.addLayer(timeLabelLayer('amb-fpoints-time', AMB_SOURCE), beforeId);

    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(circleLayer('sel-fpoints', SOURCE), beforeId);
    map.addLayer(codeLayer('sel-fpoints-code', SOURCE), beforeId);
    map.addLayer(timeLabelLayer('sel-fpoints-time', SOURCE), beforeId);

    /* One listener for both sources. Debounced because a pinch fires several
     * moveends in a row on a phone (LABEL_PLACEMENT.recomputeDebounceMs). */
    map.on('moveend', () => schedulePlacement(map));
  },

  update(map, storm, bundle) {
    const slot = bundle.layers.forecastPoints;
    const built = slot?.status === 'ok' ? decorated(slot.fc) : null;
    /* An `ok` slot carrying no points is the same as no slot for drawing
     * purposes, and holding it would leave `applyPlacement` — which returns
     * early on an empty collection — as the only writer, so the previous
     * storm's dots would stay on the map. */
    lastSelected = built?.features?.length ? built : null;
    /* PLACED FIRST, THEN SET — one `setData` instead of two. The old order
     * wrote the unplaced collection, then wrote it again placed, which cost a
     * second source update and (now that labels default to hidden) would flash
     * the text off and back on. `applyPlacement` does the write. */
    if (lastSelected) applyPlacement(map, SOURCE, lastSelected);
    else { map.getSource(SOURCE)?.setData(EMPTY); forgetNames(SOURCE); }
  },

  clear(map) {
    lastSelected = null;
    map.getSource(SOURCE)?.setData(EMPTY);
    forgetNames(SOURCE);
  },

  updateAmbient(map, features) {
    lastAmbient = decorated({ features });
    /* Dots and codes now, text when the timer fires. Nothing is withheld that
     * the user can act on — the label is a forecast HOUR, and an hour that
     * arrives a tenth of a second after its dot is not a §5 silence. */
    map.getSource(AMB_SOURCE)?.setData(lastAmbient);
    schedulePlacement(map);
  },

  /** The additive half: the time-label toggle (persisted by the caller).
   *  Covers BOTH presentations — ambient labels are the normal case now, so
   *  a toggle that only silenced the selected storm would read as broken. */
  setVisible(map, on) {
    for (const id of ['sel-fpoints-time', 'amb-fpoints-time']) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      }
    }
  },
});
