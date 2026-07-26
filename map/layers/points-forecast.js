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

import { STORM_GEO } from '../../config/tokens.js';
import { palette } from '../../config/theme.js';
import { ZOOM, LABEL_PLACEMENT } from '../../config/constants.js';
import { formatClockDay } from '../../lib/time.js';
import { trackPointReading } from '../../lib/track-point.js';
import { placeSpokes } from './label-placement.js';
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

function decorated(fc) {
  return {
    type: 'FeatureCollection',
    features: (fc?.features || [])
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
            /* [x, y] in EMS. A real 2D vector, so the label can sit on a
             * true diagonal rather than snapping to an axis. */
            _o: [0, 0],
            _hide: false,
          },
        };
      }),
  };
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

/** Pixel spoke vector → ems, the unit `text-offset` takes. Y is NOT flipped:
 *  both screen space and text-offset put positive Y downward. */
const toEm = (px) => px / STORM_GEO.labelSize;

function applyPlacement(map, sourceId, fc) {
  if (!fc?.features?.length) return;
  const out = fc.features.map((f) => ({ ...f, properties: { ...f.properties } }));

  const { groups, orphans } = groupByStorm(out);

  /* An unattributable point has no track to ride, so it gets no spoke. Hidden
   * beats placed-at-a-guess: a label sitting on a tangent borrowed from
   * another storm looks authoritative and is wrong. */
  for (const f of orphans) {
    f.properties._o = [0, 0];
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
    const placed = placeSpokes(pts);
    group.forEach((f, i) => {
      const noLbl = !f.properties._lbl;
      const pl = placed[i];
      if (pl) {
        f.properties._o = [toEm(pl.ox), toEm(pl.oy)];
        f.properties._hide = pl.hidden || noLbl;
      } else if (noLbl) {
        f.properties._hide = true;
      }
    });
  }

  map.getSource(sourceId)?.setData({ type: 'FeatureCollection', features: out });
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
      /* A real 2D offset vector in ems, anchored at the label's CENTRE so
       * the vector points from the dot's centre straight out along the
       * spoke — see the header note on why the other properties cannot do
       * this. `text-offset` is disabled by `text-radial-offset`, so that
       * property must stay absent. */
      'text-offset': ['get', '_o'],
      'text-anchor': 'center',
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
      'text-color': palette().geo.labelColor,
      'text-halo-color': palette().geo.labelHalo,
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
    paint: { 'text-color': palette().geo.pointCodeColor },
  };
}

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
      'circle-stroke-color': palette().geo.pointStroke,
      'circle-stroke-width': STORM_GEO.pointStrokeWidth,
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
    let timer = null;
    map.on('moveend', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (lastAmbient) applyPlacement(map, AMB_SOURCE, lastAmbient);
        if (lastSelected) applyPlacement(map, SOURCE, lastSelected);
      }, LABEL_PLACEMENT.recomputeDebounceMs);
    });
  },

  update(map, storm, bundle) {
    const slot = bundle.layers.forecastPoints;
    lastSelected = slot?.status === 'ok' ? decorated(slot.fc) : null;
    map.getSource(SOURCE)?.setData(lastSelected || EMPTY);
    if (lastSelected) applyPlacement(map, SOURCE, lastSelected);
  },

  clear(map) {
    lastSelected = null;
    map.getSource(SOURCE)?.setData(EMPTY);
  },

  updateAmbient(map, features) {
    lastAmbient = decorated({ features });
    map.getSource(AMB_SOURCE)?.setData(lastAmbient);
    applyPlacement(map, AMB_SOURCE, lastAmbient);
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
