/**
 * wind-field.js — wind field / wind swath. EXCLUSIVE PAIR (SPEC §7).
 *
 * How big is the storm, not just where is it. The dot gives position and the
 * cone gives future position; neither says how far out the dangerous wind
 * actually reaches. A Cat 2 spanning 300 nm and a Cat 2 spanning 60 nm are
 * different problems and looked identical until this layer.
 *
 * TWO SEGMENTS, ONE MAP SPACE — which is exactly why they are a pair and not
 * two switches (§7):
 *   current — the bands around where the storm is NOW.
 *   swath   — forecast radii along the whole track: the total area that sees
 *             each threshold over the forecast period. This is the one that
 *             answers "does it reach me".
 * Both draw the same three thresholds in the same §6 colors, so a user who
 * switches segments is changing WHEN, never WHAT.
 *
 * AMBIENT ON EVERY STORM, not just the selected one. A layer the user sets
 * and forgets should not silently apply to one storm — Aaron's call, and the
 * right one: a wind field that appears only on tap reads as a detail popup,
 * not a layer. Same identical-presentation rule the cone follows.
 *
 * NESTING IS THE WHOLE POINT and it is what makes the paint tricky: the three
 * polygons overlap by construction (the 64 kt core sits inside the 50, which
 * sits inside the 34), so fills COMPOUND. Tokens are tuned for the stacked
 * result, not for one band alone — see STORM_GEO.windFillOpacity.
 *
 * NO ZOOM FLOOR, matching the cone and tracks: the MapLibre crossfade is the
 * real gate. If several storms turn the map to soup on glass, a floor keyed
 * off ZOOM is the intended fix (§14) — one constant, not a rewrite.
 */

import { STORM_GEO } from '../../config/tokens.js';
import { windThresholdFromProps, windColor, windSortKey } from '../../lib/wind.js';
import { smoothFeature } from '../../lib/smooth.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-wind';
const AMB_SOURCE = 'amb-wind';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** Which segment is showing. The pair's default (§7 manifest) is 'current';
 *  held here so a bundle arriving before the first pref sync still draws the
 *  right half rather than nothing. */
let segment = 'current';

/** The bundle slot each segment reads. The pair value and the geometry key
 *  are deliberately the same words, but the mapping is stated rather than
 *  assumed — the same reason the additive toggles carry `engineKey`. */
const SLOT = Object.freeze({ current: 'windCurrent', swath: 'windSwath' });

/** Last data seen, so a segment switch can redraw without refetching. The
 *  bundle is not reachable from the pref subscription, so it is held. */
let lastSelectedBundle = null;
let lastAmbientBundles = null; // features, already merged by the engine

/**
 * Tag each polygon with its §6 color and severity order, and smooth the
 * swath's staircase edges.
 *
 * A feature whose threshold cannot be identified is DROPPED, not drawn in a
 * fallback hue: an unlabelled band in the wrong green would misreport
 * severity, and these colors are the fixed safety contract. Dropping is
 * visible (a missing ring) where a wrong color is invisible (a plausible
 * lie).
 *
 * SMOOTHING APPLIES TO THE SWATH ONLY. The current-position field is a
 * quadrant shape whose corners are REAL — NHC reports four radii and the
 * corners are where they meet, so rounding them would invent a shape the
 * forecaster did not draw. The swath's corners are rasterization artifacts
 * (SPEC §7, confirmed on glass). Same colors, same layer, opposite treatment,
 * because one outline is data and the other is a grid trace.
 */
function decorated(features, { smooth }) {
  const out = [];
  for (const f of features || []) {
    const kt = windThresholdFromProps(f.properties);
    const color = windColor(kt);
    if (!color) continue;
    const shaped = smooth ? smoothFeature(f) : f;
    out.push({
      ...shaped,
      properties: { ...f.properties, _wkt: kt, _wcolor: color, _wsev: windSortKey(kt) },
    });
  }
  return { type: 'FeatureCollection', features: out };
}

/** Fill + outline for one source. Both presentations use this, so ambient and
 *  selected can never drift into looking different. */
function bandLayers(id, source) {
  return [
    {
      id: `${id}-fill`,
      type: 'fill',
      source,
      layout: { 'fill-sort-key': ['get', '_wsev'] },
      paint: {
        'fill-color': ['get', '_wcolor'],
        'fill-opacity': STORM_GEO.windFillOpacity,
      },
    },
    {
      id: `${id}-line`,
      type: 'line',
      source,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['get', '_wsev'],
      },
      paint: {
        'line-color': ['get', '_wcolor'],
        'line-width': STORM_GEO.windLineWidth,
        'line-opacity': STORM_GEO.windLineOpacity,
      },
    },
  ];
}

/** Only the swath is rasterized, so only the swath is smoothed.
 *
 *  CURRENTLY OFF. Smoothing was built against "Past Cumulative Wind Swath",
 *  which the layer patterns were resolving to by mistake — that layer IS a
 *  raster trace, hence the staircase. The correct layer ("Forecast Wind
 *  Radii") is per-forecast-hour quadrant polygons whose corners are real,
 *  like the advisory field's. Smoothing those would round genuine data.
 *
 *  Left as a flag rather than deleted because the question is unmeasured:
 *  /api/nhc/inspect?layer=16&geom=1 reports an axis-aligned edge share, and
 *  a share near 1.0 would mean this layer is rasterized too and the flag
 *  should come back on. Flip it after reading that number, not before. */
const smoothingOn = () => false;

function drawSelected(map) {
  const slot = lastSelectedBundle?.layers?.[SLOT[segment]];
  const fc =
    slot?.status === 'ok'
      ? decorated(slot.fc?.features, { smooth: smoothingOn() })
      : EMPTY;
  map.getSource(SOURCE)?.setData(fc);
}

function drawAmbient(map) {
  map
    .getSource(AMB_SOURCE)
    ?.setData(decorated(lastAmbientBundles, { smooth: smoothingOn() }));
}

registerLayer({
  /* The engine merges ambient features by THIS key, so it names the slot the
   * current segment reads. `setPair` below re-points it when the segment
   * changes, which is what makes one registration serve both halves. */
  key: SLOT.current,
  type: 'pair',
  pairId: 'windField',

  /* Under the cone (10) would bury the bands beneath the veil; above the
   * tracks would cover the forecast line the user is following. Between
   * them: context that reads as area, with the tracks still drawn on top. */
  order: 15,

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;
    map.addSource(AMB_SOURCE, { type: 'geojson', data: EMPTY });
    for (const l of bandLayers('amb-wind', AMB_SOURCE)) map.addLayer(l, beforeId);
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    for (const l of bandLayers('sel-wind', SOURCE)) map.addLayer(l, beforeId);
  },

  update(map, storm, bundle) {
    lastSelectedBundle = bundle;
    drawSelected(map);
  },

  clear(map) {
    lastSelectedBundle = null;
    map.getSource(SOURCE)?.setData(EMPTY);
  },

  updateAmbient(map, features) {
    lastAmbientBundles = features;
    drawAmbient(map);
  },

  /**
   * The pair hook. Switching segments changes which bundle slot is read —
   * no refetch, because both slots were fetched together with the cone.
   * The engine re-merges ambient against the new key.
   */
  setPair(map, value) {
    if (!SLOT[value] || value === segment) return;
    segment = value;
    this.key = SLOT[value];
    drawSelected(map);
  },
});
