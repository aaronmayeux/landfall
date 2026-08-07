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
 * ==> WHERE THIS LAYER SITS IS THE WHOLE ANSWER TO TWO SEPARATE COMPLAINTS.
 * <== The sea must cover the heat. Lakes and rivers must NOT. Those pull in
 * opposite directions and the first build got both of them wrong at once.
 *
 * The order is now, bottom to top:
 *
 *     ocean fill  ->  inland water fill  ->  HEAT  ->  sea mask  ->  coast
 *
 * INLAND WATER ENDS UP UNDER THE HEAT, which is the fix for what Aaron saw:
 * Lake Biwa and the Great Lakes were being punched out as black holes in the
 * population field. That was never our mask — our mask is ocean-only. It was
 * the BASEMAP'S OWN `water-inland` layer, which is drawn at 0.9 opacity and
 * therefore lands in the translucent pass, and which sat above the heat
 * because the heat had been inserted below all of the water. A lake painted
 * over a population field reads as water on top of people. Population is
 * translucent and goes over the lake instead.
 *
 * THE SEA STILL GETS A MASK, and it has to be our own layer above the heat
 * rather than the basemap's ocean below it. ==> A FULLY OPAQUE FILL CANNOT
 * OCCLUDE A HEATMAP. <== Opaque fills render in MapLibre's opaque pass, which
 * runs before a heatmap composites its density texture in the translucent
 * pass with depth testing off. Measured, not reasoned: with the basemap ocean
 * above the heat and the layer order confirmed correct, 3,491 heat pixels
 * still showed through the sea; the same fill at `fill-opacity: 0.999` dropped
 * it to zero. That fraction is load-bearing and it is why the value is not 1.
 *
 * ==> AND ON WHY THE COASTLINE ITSELF CANNOT DO THE CLIPPING. <== Aaron asked
 * the obvious question: we already draw a cyan coastline, so why not clip with
 * it. Because it is a LINE. `coast-glow` and `coast-core` are `line` layers
 * over baked coastline geometry, and a line has no inside — there is no side
 * of it for a renderer to fill. Masking needs an area, and on this basemap the
 * only area that means "sea" is the water polygon. The coastline and the mask
 * are drawn from the same shorelines, so they agree; one is just the outline
 * and the other is the region.
 *
 * The mask reads the basemap's own water source, so there is no second copy of
 * the coastline to drift out of step, and it sits below the coast glow and the
 * plate seams — masking above those would erase plate boundaries, which are
 * mostly oceanic.
 *
 * ==> THE DEPENDENCY ON BASEMAP STRUCTURE IS CHECKED AT RUNTIME. <== The
 * Protomaps path (`TILES.useR2`, currently off) is built the other way round —
 * ocean is the background and there is no sea polygon to mask with. Same layer
 * id, opposite meaning. So the code tests the ocean layer's TYPE, and when
 * there is nothing to clip with it draws uncut rather than not at all.
 */
const OCEAN_LAYER = 'ocean';
const INLAND_WATER_LAYER = 'water-inland';
const FALLBACK_ANCHOR = 'coast-core';

export const POPULATION_MASK_LAYER_ID = 'population-water-mask';

/** Is the basemap built so that a sea polygon can mask us? */
function canClip(map) {
  const ocean = map.getLayer(OCEAN_LAYER);
  /* A `fill` means the sea is painted over the land and can mask us. A
   * `background` means the sea is underneath everything and cannot. */
  return Boolean(ocean && ocean.type === 'fill');
}

/**
 * The id of the layer that sits immediately above the basemap's water.
 *
 * ==> THIS IS COMPUTED FROM THE LIVE STYLE, NOT HARDCODED, BECAUSE THE EXACT
 * NEIGHBOUR IS NOT THE POINT. <== What matters is the POSITION: above every
 * water fill, below everything structural. Naming whichever layer happens to
 * be next would break the moment one is inserted between them, and it would
 * break silently — the population would simply start reading as underwater
 * again, which is the bug this function exists to fix.
 */
function aboveWater(map) {
  const layers = map.getStyle()?.layers || [];
  let last = -1;
  for (let i = 0; i < layers.length; i += 1) {
    if (layers[i].id === OCEAN_LAYER || layers[i].id === INLAND_WATER_LAYER) last = i;
  }
  if (last >= 0 && last + 1 < layers.length) return layers[last + 1].id;
  return map.getLayer(FALLBACK_ANCHOR) ? FALLBACK_ANCHOR : undefined;
}

const EMPTY = Object.freeze({ type: 'FeatureCollection', features: [] });

/** Last towns handed over, so a style rebuild can refill without refetching. */
let lastTowns = null;

/**
 * Attach an alpha to a six-digit hex colour, as eight-digit hex.
 *
 * MapLibre's colour parser accepts `#RRGGBBAA`, which lets the ramp carry its
 * own transparency without the theme needing a second, parallel set of
 * translucent tokens that could drift out of step with the opaque ones.
 */
function withAlpha(hex, a) {
  const byte = Math.round(Math.max(0, Math.min(1, a)) * 255);
  return `${hex}${byte.toString(16).padStart(2, '0')}`;
}

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
  const { weightMinLog, weightMaxLog, weightFloor } = POPULATION;
  const span = weightMaxLog - weightMinLog;
  const features = new Array(flat.length / 3);
  for (let i = 0, n = 0; i < flat.length; i += 3, n += 1) {
    const pop = flat[i + 2];
    const lp = Math.log10(pop);
    /* Clamped, not trusted. A future rebuild with a bigger source would
     * otherwise push weights past 1 and quietly flatten the top of the ramp. */
    let w = (lp - weightMinLog) / span;
    if (w < 0) w = 0; else if (w > 1) w = 1;
    features[n] = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [flat[i], flat[i + 1]] },
      /* `lp` rides along because the ZOOM FADE needs to compare a town against
       * a sliding threshold, and that comparison happens per frame in a
       * MapLibre expression. Recomputing a log there — for every town, every
       * frame — to save eight bytes a feature would be the wrong trade. */
      properties: { p: pop, w: weightFloor + (1 - weightFloor) * w, lp },
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

  /* The mask goes in first, directly above the basemap's water, so the heat
   * has something adjacent to sit under. Both end up above every water fill. */
  const clip = canClip(map);
  const anchor = aboveWater(map);
  if (clip) {
    map.addLayer(
      {
        id: POPULATION_MASK_LAYER_ID,
        type: 'fill',
        source: 'basemap',
        'source-layer': 'water',
        /* ==> OCEAN ONLY, AND THE OMISSION IS THE POINT. <== Lakes and rivers
         * are deliberately not masked: the heat draws over them, translucent,
         * so a city on a lakeshore reads as a city on a lakeshore rather than
         * as a hole. */
        filter: ['==', ['get', 'class'], 'ocean'],
        layout: { visibility: 'none' },
        paint: {
          'fill-color': pal.ocean,
          /* ==> NOT 1, AND THAT IS THE WHOLE TRICK. <== At exactly 1 MapLibre
           * routes this into the opaque pass, which runs before the heatmap
           * composites and therefore cannot cover it. A hair under 1 puts it
           * in the translucent pass, in layer order, after the heat. The
           * difference is invisible; the difference is also the feature. */
          'fill-opacity': 0.999,
          'fill-antialias': true,
        },
      },
      anchor
    );
  }

  /* Directly beneath the mask when there is one; otherwise still above the
   * water, so lakes never paint over the field. */
  const before = clip ? POPULATION_MASK_LAYER_ID : anchor;

  /**
   * The zoom fade, as one composite expression.
   *
   * At each zoom stop the town's own weight is multiplied by how far it has
   * come through its fade: 0 at the threshold, 1 a `fadeWidthLog` above it.
   * MapLibre interpolates BETWEEN the stops, so the threshold slides
   * continuously and a town crosses it over many frames rather than one.
   *
   * `min`/`max` rather than a clamp helper — the expression language has the
   * two and not the one, and hand-rolling it keeps this readable next to the
   * constants table it implements.
   */
  const fadedWeight = ['interpolate', ['linear'], ['zoom']];
  for (const stop of POPULATION.fadeThresholdLog) {
    fadedWeight.push(stop.zoom, [
      '*',
      ['get', 'w'],
      ['min', 1, ['max', 0,
        ['/', ['-', ['get', 'lp'], stop.log], POPULATION.fadeWidthLog]]],
    ]);
  }

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
       * ==> THE FILTER IS A PERFORMANCE GUARD, NOT THE ZOOM GATE. <== It used
       * to be the gate, and that is what made towns pop. Every threshold here
       * sits at or below the lowest value the fade reaches in that zoom range,
       * so a town is always already at weight zero by the time it is admitted.
       * See `POPULATION.filterFloor` for why these are one row ahead.
       */
      filter: [
        '>=',
        ['get', 'p'],
        ['step', ['zoom'], POPULATION.filterFloor[0].pop,
          ...POPULATION.filterFloor.slice(1).flatMap((f) => [f.zoom, f.pop])],
      ],
      paint: {
        'heatmap-weight': fadedWeight,
        'heatmap-radius': byZoom(POPULATION.heatRadius, (s) => s.px),
        /**
         * ==> STOP ZERO MUST BE FULLY TRANSPARENT OR THE LAYER TINTS THE
         * OCEAN. <== `heatmap-density` is zero across every pixel no town
         * reaches, which is most of the planet. A visible colour at density 0
         * paints the whole globe and reads as a broken basemap.
         *
         * ==> AND THE TOE IS LONG ON PURPOSE. <== The first ramp went from
         * transparent to a solid colour across four percent of the range,
         * which put a visible rim on every blob — the layer read as a field of
         * discs rather than as density. The alpha now climbs across the bottom
         * THIRD of the range, so the outside of a city dissolves instead of
         * ending. Alpha is carried in eight-digit hex rather than a second set
         * of tokens: the ramp shape is a property of this layer, the colours
         * are a property of the theme, and mixing them would put half the
         * design in the wrong file.
         */
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0, withAlpha(pal.populationLow, 0),
          0.05, withAlpha(pal.populationLow, 0.14),
          0.14, withAlpha(pal.populationLow, 0.42),
          0.30, withAlpha(pal.populationMid, 0.72),
          0.58, withAlpha(pal.populationMid, 1),
          1, withAlpha(pal.populationHigh, 1),
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

/**
 * Show or hide. Both layers move together, because a water mask left on with
 * the heat switched off would be an invisible extra draw over the whole ocean
 * every frame — free-looking and not free.
 */
export function setPopulationVisible(map, visible) {
  const v = visible ? 'visible' : 'none';
  for (const id of [POPULATION_LAYER_ID, POPULATION_MASK_LAYER_ID]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  }
}
