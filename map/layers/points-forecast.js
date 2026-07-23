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
 * LABELS ARE AMBIENT (warm), not selection-only. They show `datelbl`
 * VERBATIM ("1:00 PM Thu") — NHC pre-formats it, no date math here. The
 * toggle still gates whether times draw at all; the zoom ladder gates when.
 *
 * PLACEMENT IS OURS, NOT MapLibre'S.
 * Each label rides the normal to the track at its point — a spoke on a
 * wheel — with the side chosen to keep a run together and the split evened
 * out when some must flip. MapLibre cannot express that, so
 * label-placement.js computes an offset per feature and MapLibre just draws
 * it.
 *
 * WHY `text-offset` AND NOT `text-translate` (checked against the style
 * spec, MapLibre GL JS 5.6): `text-translate` does NOT support data-driven
 * styling — a `['get', ...]` there is silently ignored, which would have
 * left every label sitting on its point. `text-offset` DOES support it, but
 * its units are EMS, not pixels, so placement's pixel offsets are divided by
 * the font size on the way out (labelOffsetEm is retired; the spoke replaces
 * it).
 *
 * Placement is screen-space, so it is recomputed on `moveend` (debounced)
 * rather than per frame: on a globe on a phone, per-frame placement is the
 * frame budget gone. Labels settle when the camera does.
 *
 * Imports: config, lib, and label-placement (one direction, no cycle).
 */

import { STORM_GEO, CATEGORY_COLOR } from '../../config/tokens.js';
import { ZOOM, LABEL_PLACEMENT } from '../../config/constants.js';
import { categoryColor, categoryDotCode } from '../../lib/category.js';
import { placeSpokes } from './label-placement.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-fpoints';
const AMB_SOURCE = 'amb-fpoints';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** Last data handed to each source, kept so a camera move can re-place the
 *  labels without waiting for the next poll. */
let lastAmbient = null;
let lastSelected = null;

/** Our normalized category index is 0=TD, 1=TS, 2..6=Cat1..5. A reported
 *  Saffir-Simpson number n maps to index n+1. Null when NHC gives us
 *  nothing we can honestly read. */
function categoryIndex(p) {
  const ss = p?.ssnum;
  if (Number.isFinite(ss) && ss >= 1 && ss <= 5) return ss + 1;
  const dv = String(p?.tcdvlp || '').toLowerCase();
  if (dv.includes('depression')) return 0;
  if (dv.includes('storm')) return 1;
  return null;
}

function decorated(fc) {
  return {
    type: 'FeatureCollection',
    features: (fc?.features || [])
      .filter((f) => f.geometry?.type === 'Point')
      .map((f) => {
        const idx = categoryIndex(f.properties);
        return {
          ...f,
          properties: {
            ...f.properties,
            _color: idx == null ? CATEGORY_COLOR.GENERIC : categoryColor(idx, 'tropical'),
            _code: idx == null ? '' : categoryDotCode(idx, 'tropical'),
            /* Placement fills these in. They must exist up front or the
             * first paint reads null through ['get', ...]. */
            _ox: 0,
            _oy: 0,
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
 * ------------------------------------------------------------------------- */

function groupByStorm(features) {
  const groups = new Map();
  for (const f of features) {
    const key = f.properties?.stormId ?? f.properties?.STORMID ?? '_';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  return groups;
}

/** Pixel offsets → ems, because that is the unit `text-offset` takes. */
const toEm = (px) => px / STORM_GEO.labelSize;

function applyPlacement(map, sourceId, fc) {
  if (!fc?.features?.length) return;
  const out = fc.features.map((f) => ({ ...f, properties: { ...f.properties } }));

  for (const group of groupByStorm(out).values()) {
    const pts = group.map((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const pt = map.project([lon, lat]);
      return { x: pt.x, y: pt.y, text: String(f.properties.datelbl || '') };
    });
    const placed = placeSpokes(pts);
    group.forEach((f, i) => {
      const pl = placed[i];
      if (!pl) return;
      f.properties._ox = toEm(pl.ox);
      f.properties._oy = toEm(pl.oy);
      f.properties._hide = pl.hidden;
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
    minzoom: ZOOM.ambientGeometry, // the ladder gates WHEN (§7)
    filter: ['!', ['get', '_hide']],
    layout: {
      'text-field': ['get', 'datelbl'],
      'text-font': ['Noto Sans Regular'],
      'text-size': STORM_GEO.labelSize,
      /* Ems, not pixels — see the header note. */
      'text-offset': ['array', 'number', 2, [['get', '_ox'], ['get', '_oy']]],
      'text-anchor': 'center',
      /* Placement already resolved the collisions on the spoke; anything it
       * could not fit is filtered out above, so MapLibre must not second-
       * guess the result by dropping more. */
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': STORM_GEO.labelColor,
      'text-halo-color': STORM_GEO.labelHalo,
      'text-halo-width': STORM_GEO.labelHaloWidth,
    },
  };
}

/** The code drawn inside a dot. It belongs to its point: it must never be
 *  moved or dropped by collision, or a dot would show a neighbour's
 *  category. */
function codeLayer(id, source, gated) {
  const def = {
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
    paint: { 'text-color': STORM_GEO.pointCodeColor },
  };
  if (gated) def.minzoom = ZOOM.ambientGeometry;
  return def;
}

function circleLayer(id, source, gated) {
  const def = {
    id,
    type: 'circle',
    source,
    paint: {
      'circle-color': ['get', '_color'],
      'circle-radius': STORM_GEO.pointRadius,
      'circle-stroke-color': STORM_GEO.pointStroke,
      'circle-stroke-width': STORM_GEO.pointStrokeWidth,
    },
  };
  if (gated) def.minzoom = ZOOM.ambientGeometry;
  return def;
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
    map.addLayer(circleLayer('amb-fpoints', AMB_SOURCE, true), beforeId);
    map.addLayer(codeLayer('amb-fpoints-code', AMB_SOURCE, true), beforeId);
    map.addLayer(timeLabelLayer('amb-fpoints-time', AMB_SOURCE), beforeId);

    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(circleLayer('sel-fpoints', SOURCE, false), beforeId);
    map.addLayer(codeLayer('sel-fpoints-code', SOURCE, false), beforeId);
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
