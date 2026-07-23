/**
 * points-forecast.js — Saffir-Simpson-colored forecast points (baseline, on
 * selection) plus their date/time labels (additive toggle, DEFAULT ON — a
 * cone without times is just a shape, SPEC §7).
 *
 * Color comes from NHC's own per-point `ssnum` — REPORTED, never derived
 * (§7, confirmed live). ssnum 1–5 maps straight onto Cat 1–5. Below
 * hurricane strength ssnum is 0 and `tcdvlp` ("Tropical Depression" /
 * "Tropical Storm") says which sub-hurricane color applies; anything
 * unrecognized gets the §6 generic hue rather than a guessed severity.
 *
 * Labels show `datelbl` VERBATIM ("1:00 PM Thu") — NHC pre-formats it, no
 * date math here. The toggle gates whether times draw; the zoom ladder gates
 * when (labels from the regional band, §7 — toggle-on below z5 draws
 * nothing, silently; the ladder is doing its job). The points themselves are
 * requested detail and ignore the ladder (§9).
 */

import { STORM_GEO, CATEGORY_COLOR } from '../../config/tokens.js';
import { ZOOM } from '../../config/constants.js';
import { categoryColor } from '../../lib/category.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-fpoints';
const EMPTY = { type: 'FeatureCollection', features: [] };

function pointColor(p) {
  const ss = p?.ssnum;
  /* Our normalized category index is 0=TD, 1=TS, 2..6=Cat1..5 — so a
   * reported Saffir-Simpson number n maps to index n+1. */
  if (Number.isFinite(ss) && ss >= 1 && ss <= 5) return categoryColor(ss + 1, 'tropical');
  const dv = String(p?.tcdvlp || '').toLowerCase();
  if (dv.includes('depression')) return categoryColor(0, 'tropical');
  if (dv.includes('storm')) return categoryColor(1, 'tropical');
  return CATEGORY_COLOR.GENERIC;
}

function decorated(fc) {
  return {
    type: 'FeatureCollection',
    features: (fc?.features || [])
      .filter((f) => f.geometry?.type === 'Point')
      .map((f) => ({
        ...f,
        properties: { ...f.properties, _color: pointColor(f.properties) },
      })),
  };
}

registerLayer({
  key: 'forecastPoints',
  type: 'baseline', // the labels sub-layer is the additive part
  order: 50, // top of the selection stack, under the storm glyph itself

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(
      {
        id: 'sel-fpoints',
        type: 'circle',
        source: SOURCE,
        paint: {
          'circle-color': ['get', '_color'],
          'circle-radius': STORM_GEO.pointRadius,
          'circle-stroke-color': STORM_GEO.pointStroke,
          'circle-stroke-width': STORM_GEO.pointStrokeWidth,
        },
      },
      beforeId
    );
    map.addLayer(
      {
        id: 'sel-fpoints-time',
        type: 'symbol',
        source: SOURCE,
        minzoom: ZOOM.regional, // the ladder gates WHEN (§7)
        layout: {
          'text-field': ['get', 'datelbl'],
          'text-font': ['Noto Sans Regular'],
          'text-size': STORM_GEO.labelSize,
          'text-offset': [0, -STORM_GEO.labelOffsetEm],
          'text-anchor': 'bottom',
          /* Colliding labels may hide — never the points. Same rule as the
           * storm name vs glyph split in map/markers.js. */
          'text-optional': true,
        },
        paint: {
          'text-color': STORM_GEO.labelColor,
          'text-halo-color': STORM_GEO.labelHalo,
          'text-halo-width': STORM_GEO.labelHaloWidth,
        },
      },
      beforeId
    );
  },

  update(map, storm, bundle) {
    const slot = bundle.layers.forecastPoints;
    map.getSource(SOURCE)?.setData(slot?.status === 'ok' ? decorated(slot.fc) : EMPTY);
  },

  clear(map) {
    map.getSource(SOURCE)?.setData(EMPTY);
  },

  /** The additive half: the time-label toggle (persisted by the caller). */
  setVisible(map, on) {
    if (map.getLayer('sel-fpoints-time')) {
      map.setLayoutProperty('sel-fpoints-time', 'visibility', on ? 'visible' : 'none');
    }
  },
});
