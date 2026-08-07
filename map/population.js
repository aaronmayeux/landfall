/**
 * population.js — THE POPULATION HEAT LAYER (SPEC §7, Reference group).
 *
 * Where people are, drawn as a field rather than as dots. One hue, rising
 * intensity. It answers "is that stretch of coast the storm is aimed at empty
 * or is it Tampa" without needing a label on anything.
 *
 * ==> THIS IS NOT AN ENGINE LAYER AND DOES NOT REGISTER WITH map/layers/. <==
 * That registry exists for per-storm geometry: it merges bundles, splits
 * ambient from selected, and keys everything off a storm id. Population has no
 * storm, no bundle and no selection — it is basemap furniture, in the same
 * bucket as the graticule, and it follows the graticule's shape exactly:
 * `add…` once at style.load, `set…Visible` from main.js's one applyLayerState
 * call. A per-layer mechanism of its own is how the graticule and the forecast
 * times drifted apart, and that is not being repeated here.
 *
 * DATA ARRIVES SEPARATELY FROM CREATION. `addPopulationLayer` builds the
 * source and layer immediately with nothing in them, and `setPopulationTowns`
 * fills them in when data/population.js has the file. That order is deliberate:
 * a theme change tears the whole style down and rebuilds it, and the rebuild
 * must not depend on a fetch. The layer comes back empty and is refilled from
 * the array already in memory — no second request, no gap.
 *
 * WHY A HEATMAP LAYER AND NOT CIRCLES. Circles would be honest about the data
 * being points, and would also read as 107,464 map pins. The question is
 * density, density is a field, and MapLibre's heatmap is the one layer type
 * that turns points into a field on the GPU without us shipping a raster.
 *
 * Imports: config/constants.js, config/tokens.js, config/theme.js. No data/,
 * no ui/ — towns arrive through setPopulationTowns the same way storms arrive
 * at map/imagery.js through update().
 */

import { POPULATION } from '../config/constants.js';
import { OPACITY } from '../config/tokens.js';
import { palette } from '../config/theme.js';

export const POPULATION_SOURCE_ID = 'population';
export const POPULATION_LAYER_ID = 'population-heat';

/**
 * ==> THE HEAT GOES UNDER EVERYTHING THE STORM DRAWS. <== It is context, and
 * context that obscures a cone has stopped being context. The coastline is the
 * one thing it may sit above: a warm patch is meaningless unless you can see
 * which piece of land it is on, and a coast hairline read through 72% violet
 * is still a coast hairline.
 *
 * Named rather than passed in, for the same reason the graticule names its
 * own anchor: the insertion point is a fact about where this layer belongs in
 * the stack, not a decision each caller should get to make differently.
 */
const INSERT_BEFORE = 'coast-core';

const EMPTY = Object.freeze({ type: 'FeatureCollection', features: [] });

/** Last towns handed over, so a style rebuild can refill without refetching. */
let lastTowns = null;

/** Build the zoom→value ramp MapLibre wants from a table of stops. */
function byZoom(stops, pick) {
  const out = ['interpolate', ['linear'], ['zoom']];
  for (const s of stops) out.push(s.zoom, pick(s));
  return out;
}

/**
 * Turn the flat [lon, lat, pop, …] array into a FeatureCollection.
 *
 * ==> THIS IS THE ONLY PLACE THAT BUILDS 107,464 OBJECTS AND IT RUNS ONLY WHEN
 * THE LAYER IS SWITCHED ON. <== The headcount in the storm drawer walks the
 * flat numbers directly and never comes through here, which is the entire
 * reason the shipped file is a flat array rather than GeoJSON: the cheaper
 * reader is also the one that runs during a tap.
 *
 * `w` is precomputed rather than left to a MapLibre expression. The weight is
 * a log, MapLibre has no log operator that works on a data-driven property
 * without a chain of `ln`/`/` wrappers, and doing the arithmetic once at load
 * beats doing it per feature per frame.
 */
function toFeatureCollection(flat) {
  const { weightMinLog, weightMaxLog } = POPULATION;
  const span = weightMaxLog - weightMinLog;
  const features = new Array(flat.length / 3);
  for (let i = 0, n = 0; i < flat.length; i += 3, n += 1) {
    const pop = flat[i + 2];
    /* Clamped, not trusted. A future rebuild with a bigger source would
     * otherwise push weights past 1 and quietly flatten the top of the ramp. */
    let w = (Math.log10(pop) - weightMinLog) / span;
    if (w < 0) w = 0; else if (w > 1) w = 1;
    features[n] = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [flat[i], flat[i + 1]] },
      properties: { p: pop, w },
    };
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Create the source and layer. Idempotent, and safe to call again after a
 * theme change has torn the style down.
 */
export function addPopulationLayer(map) {
  if (map.getSource(POPULATION_SOURCE_ID)) return;

  map.addSource(POPULATION_SOURCE_ID, {
    type: 'geojson',
    data: lastTowns ? toFeatureCollection(lastTowns) : EMPTY,
    /* Points only, no shared edges, so simplification has nothing to gain and
     * everything to lose — at tolerance the default would drop coincident
     * towns, which in a dense city is most of them. */
    tolerance: 0,
    buffer: 0,
  });

  const pal = palette();

  const before = map.getLayer(INSERT_BEFORE) ? INSERT_BEFORE : undefined;

  map.addLayer(
    {
      id: POPULATION_LAYER_ID,
      type: 'heatmap',
      source: POPULATION_SOURCE_ID,
      /* Ships off. The manifest says so too; both are needed, because the
       * manifest decides the SWITCH and this decides what the map does before
       * the first applyLayerState lands. */
      layout: { visibility: 'none' },
      /**
       * ==> THE ZOOM FLOOR IS A `step`, NOT AN `interpolate`. <== A town either
       * contributes or it does not; there is no half a town. Interpolating a
       * population threshold would put every place near the boundary at a
       * fractional weight and make the whole field shimmer as you zoom.
       */
      filter: [
        '>=',
        ['get', 'p'],
        ['step', ['zoom'], POPULATION.heatFloor[0].pop,
          ...POPULATION.heatFloor.slice(1).flatMap((s) => [s.zoom, s.pop])],
      ],
      paint: {
        'heatmap-weight': ['get', 'w'],
        'heatmap-radius': byZoom(POPULATION.heatRadius, (s) => s.px),
        /**
         * ==> STOP ZERO MUST BE FULLY TRANSPARENT OR THE LAYER TINTS THE
         * OCEAN. <== `heatmap-density` is zero across every pixel no town
         * reaches, which is most of the planet. A visible colour at density 0
         * paints the entire globe, including the sea, and reads as a broken
         * basemap rather than as a population map.
         *
         * The low stop is held slightly above zero so the fade out of a small
         * town is quick rather than a wide dim halo — a halo the size of a
         * county around a village is a claim about where people are.
         */
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0, 'rgba(0,0,0,0)',
          0.08, pal.populationLow,
          0.45, pal.populationMid,
          1, pal.populationHigh,
        ],
        /* Left at 1. Intensity multiplies density before the ramp, so turning
         * it up is a second, invisible way of changing the colour ramp — two
         * dials for one effect is how a tuning session stops converging. The
         * ramp stops are the dial. */
        'heatmap-intensity': 1,
        'heatmap-opacity': OPACITY.populationHeat,
      },
    },
    before
  );
}

/** Hand over the town list. Safe before the layer exists — it is remembered
 *  and applied by the next `addPopulationLayer`. */
export function setPopulationTowns(map, flat) {
  lastTowns = flat || null;
  const src = map?.getSource?.(POPULATION_SOURCE_ID);
  if (!src) return;
  src.setData(lastTowns ? toFeatureCollection(lastTowns) : EMPTY);
}

/** Show or hide. Matches setGraticuleVisible exactly. */
export function setPopulationVisible(map, visible) {
  if (map.getLayer(POPULATION_LAYER_ID)) {
    map.setLayoutProperty(POPULATION_LAYER_ID, 'visibility', visible ? 'visible' : 'none');
  }
}
