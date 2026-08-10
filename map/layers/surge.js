/**
 * surge.js — peak storm surge. EXCLUSIVE PAIR B of `coastal` (§7);
 * watch-warning.js is segment A.
 *
 * ==> ONE TRANSPARENCY, AND NOTHING OVERLAPS ANYTHING. <== Aaron's rule, and
 * it overrides most of what this layer inherited from the HA project. Every
 * piece of surge paint draws at OPACITY.surgeFill exactly once. Two washes of
 * the same colour stacked read as a darker patch that means nothing, and they
 * land exactly on the boundaries where the eye is trying to read severity.
 *
 * WHAT THAT DELETED, in order of how hard each was to give up:
 *   - the fill's dilation/edge stroke, which was the only gap-bridging the
 *     layer had. The dry pockets inside Tampa Bay and Charlotte Harbor come
 *     back. A stroke sitting on its own fill IS the overlap; there is no
 *     version of this that keeps both.
 *   - the reach's blurred glow pass, so a reach is one flat 5 px line rather
 *     than a bright core inside a halo.
 *   - opacity 1, which the HA project used because ITS bands stacked into mud.
 *     They do not stack here: measured on advisory 017, NHC's surge polygons
 *     overlap each other across 0.00% of painted area. That measurement is
 *     what makes a flat wash safe.
 *
 * WHAT SURVIVES FROM THE INHERITED CARTOGRAPHY:
 *   - worst severity on top, via `fill-sort-key`. Free, and the §6 contract's
 *     only guarantee if a future storm does publish overlapping areas.
 *   - under the coastline, over the land, so the shoreline reads through.
 *   - holes kept. Milton's whole archive has two interior rings; dropping
 *     rings by reflex is how a layer vanishes when a source winds them the
 *     other way.
 *
 * THE ONE OVERLAP LEFT, NAMED RATHER THAN HIDDEN: a coastal reach crossing a
 * filled area. 6 of 107 reach vertices at advisory 017, about 5.6%. Removing
 * it would mean clipping NHC's published lines against NHC's published
 * polygons, which is editing the forecast to tidy the picture.
 *
 * ==> AND THE REACHES ARE PAINTED ONTO THE REAL COASTLINE, NOT DRAWN AS
 *     DELIVERED. <== NHC publishes them as BREAKPOINTS — named coastal points
 * joined by straight lines — so drawn raw, a reach around a bay renders as a
 * chord slicing across open water. Seen on glass at Charlotte Harbor: a dead
 * straight purple diagonal across the sea, a mile off any shore.
 *
 * That is the identical problem `map/coast-band.js` was built for, on the
 * identical source shape, so it is the identical fix: buffer the published
 * line into a corridor, select every loaded coast segment inside it, paint
 * those. Best-effort — a reach with no coast in its corridor keeps NHC's
 * delivered geometry rather than vanishing, because official geometry is not
 * ours to discard (§5).
 *
 * ==> THE CORRIDOR IS NARROWER THAN WATCH/WARNING'S AND THAT IS DELIBERATE.
 *     <== `SURGE.bandHalfWidthKm` (20) against `COAST_BAND.halfWidthKm` (50).
 * A warning covers an AREA, so over-inclusion is correct and every bay inside
 * it is warned. Surge reaches are adjacent and carry DIFFERENT DEPTHS, so a
 * wide corridor paints a 10-15 ft forecast onto a coast NHC gave 3-5 ft.
 *
 * ONLY THE REACHES ARE BANDED. The polygons are areas NHC drew itself; they
 * are not breakpoint chords and there is nothing to snap them to.
 */

import { SURGE_RAMP, OPACITY } from '../../config/tokens.js';
import { SURGE, ZOOM, COAST_BAND } from '../../config/constants.js';
import { bandFor, bandMissingFor } from '../coast-band-cache.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-surge';
const AMB_SOURCE = 'amb-surge';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** Which segment of the `coastal` pair is showing. The manifest default is
 *  'watchWarning', so this layer starts silent and only paints once the reader
 *  asks for it. */
let segment = 'watchWarning';
/* Held as {key, fc, stamp} rather than a bare collection, because the band has
 * to be RE-SELECTED against newly loaded coastline on moveend and the geometry
 * is not reachable from an event handler. */
let lastSelected = null;
let lastAmbient = null;

const drawingOff = () => segment !== 'surge';

/** Colour by severity index — a `match` on the colour word, baked from
 *  `SURGE_RAMP` so the ramp stays the single definition.
 *
 *  ==> BAKED, NOT READ FROM GLOBAL STATE. <== A `gs()` inside an expression
 *  that also reads feature data is evaluated in MapLibre's worker, which never
 *  receives the global state, and `to-color` of the missing value is BLACK —
 *  silently, in both themes. That is the bug that made the forecast ring black
 *  for three deploys (map/theme-state.js, enforced by
 *  tools/test-app-layer-state.mjs). Surge colours are the §6 fixed contract and
 *  identical in both palettes, so there is nothing to theme here anyway. */
function colorExpression() {
  const stops = [];
  SURGE.colors.forEach((name, i) => stops.push(name, SURGE_RAMP[i].color));
  return ['match', ['get', 'color'], ...stops, SURGE_RAMP[0].color];
}

const isPolygon = ['==', ['get', 'kind'], 'polygon'];
const isLine = ['==', ['get', 'kind'], 'line'];

/** Paint the reaches onto the loaded coastline; leave the areas alone.
 *
 *  `key` scopes the band cache and `stamp` invalidates it when a new advisory
 *  replaces the geometry — a band selected for a superseded forecast is a
 *  wrong depth on a real coast. */
/** ==> THE CACHE KEY IS NAMESPACED, AND WITHOUT THIS TWO LAYERS COLLIDE. <==
 *  watch-warning.js bands its own ambient collection under the bare key
 *  'ambient'. So does this layer. One would overwrite the other's band — the
 *  reaches painted in warning colours, or silently absent — and nothing would
 *  error. */
const bandKey = (key) => `surge:${key}`;

/* ---------------------------------------------------------------------------
 * THE COASTLINE STEPS BACK WHILE SURGE IS SHOWING
 *
 * See OPACITY.surgeCoastDim for why this is the honest fix rather than more
 * paint on the surge layer.
 *
 * THE ORIGINAL EXPRESSION IS SAVED, NOT RE-DERIVED. Both coast layers carry a
 * ZOOM RAMP for opacity, not a number, so dimming means wrapping it in a
 * multiply — and restoring means putting the exact expression back. Rebuilding
 * it here would be a second copy of map/style.js's ramp, drifting from the
 * first the moment either is touched (§12). Saving also makes repeated
 * toggling safe: without it, each dim would wrap the previous wrap and the
 * coast would fade further every time the segment moved.
 * ------------------------------------------------------------------------- */
/** EXPORTED FOR ITS SUITE, and that is a real reason rather than a test seam
 *  bolted on: nesting a wrap or failing to restore is silent — the coast just
 *  gets dimmer every time the segment moves, or stays dim forever — and
 *  neither shows up in any other check. tools/test-surge.mjs drives it with a
 *  stub map. */
const COAST_LAYERS = ['coast-glow', 'coast-core'];
const savedCoastOpacity = new Map();
let coastDimmed = false;

export function dimCoast(map, on) {
  if (on === coastDimmed) return;
  for (const id of COAST_LAYERS) {
    /* A basemap that failed to load has no coast layers, and surge must still
     * draw — an outage in the reference layer is not a reason to hide the
     * hazard (§5). */
    if (!map.getLayer(id)) continue;
    if (!savedCoastOpacity.has(id)) {
      savedCoastOpacity.set(id, map.getPaintProperty(id, 'line-opacity'));
    }
    const original = savedCoastOpacity.get(id);
    map.setPaintProperty(
      id,
      'line-opacity',
      on && original !== undefined ? ['*', original, OPACITY.surgeCoastDim] : original
    );
  }
  coastDimmed = on;
}

function decorated(map, key, fc, stamp) {
  const all = fc?.features || [];
  const reaches = all.filter((f) => f.properties?.kind === 'line');
  const areas = all.filter((f) => f.properties?.kind !== 'line');
  if (!reaches.length) return { type: 'FeatureCollection', features: areas };
  const { features } = bandFor(map, bandKey(key), reaches, stamp, SURGE.bandHalfWidthKm);
  return { type: 'FeatureCollection', features: [...areas, ...features] };
}

/** EXPORTED FOR ITS SUITE. The one-wash contract in OPACITY.surgeFill is a
 *  promise about the LAYER LIST — how many there are and what each paints —
 *  and nothing else in the repo can see that list. */
export function surgeLayersForTest(id, source, minzoom) {
  return surgeLayers(id, source, minzoom);
}

function surgeLayers(id, source, minzoom) {
  const zoomFloor = minzoom != null ? { minzoom } : {};
  const color = colorExpression();
  return [
    {
      /* ==> ONE LAYER PER GEOMETRY KIND, AND NOTHING DRAWS TWICE. <== No edge
       * stroke on the fill, no glow under the reach. Every earlier version had
       * both, and both were the same mistake: a second wash of the same colour
       * over the first, so the boundary of every area and the centre of every
       * reach came out darker than the middle of the water. See
       * OPACITY.surgeFill for what removing the edge stroke cost. */
      id: `${id}-fill`,
      type: 'fill',
      source,
      ...zoomFloor,
      filter: isPolygon,
      /* Severity still sorts, and it still matters even though NHC's areas do
       * not overlap (0.00% of painted area at advisory 017, measured): the
       * sort key costs nothing and is the §6 safety contract's only guarantee
       * if a future storm DOES publish overlapping areas. */
      layout: { 'fill-sort-key': ['get', 'severity'] },
      paint: {
        'fill-color': color,
        'fill-opacity': OPACITY.surgeFill,
        /* NO `fill-outline-color`. It is drawn within this layer but still
         * composites over the fill, which is the exact seam this pass exists
         * to remove. Adjacent areas of different severity are separated by
         * their COLOUR — which is what the §6 ramp is for. */
        'fill-antialias': true,
      },
    },
    {
      id: `${id}-reach`,
      type: 'line',
      source,
      ...zoomFloor,
      filter: isLine,
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'severity'] },
      paint: {
        'line-color': color,
        'line-width': OPACITY.surgeReachPx,
        /* THE SAME NUMBER AS THE FILL. Not a value that happens to match —
         * the same token, so the two cannot drift apart. */
        'line-opacity': OPACITY.surgeFill,
      },
    },
  ];
}

registerLayer({
  key: 'surge',
  type: 'pair',
  pairId: 'coastal',
  /* 38 — immediately under watch-warning's 40, so an active Hurricane Warning
   * still strokes the coast on top of the water it warns about. */
  order: 38,

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;
    map.addSource(AMB_SOURCE, { type: 'geojson', data: EMPTY });
    for (const layer of surgeLayers('amb-surge', AMB_SOURCE, ZOOM.ambientGeometry)) {
      map.addLayer(layer, beforeId);
    }
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    for (const layer of surgeLayers('sel-surge', SOURCE, null)) {
      map.addLayer(layer, beforeId);
    }

    /* Coast vertices arrive as tiles load and each zoom holds its own band, so
     * a settled camera is either REFINING a band already on screen or painting
     * one for the first time at this zoom. Those want different latencies —
     * the same reasoning, and the same debounce, as watch-warning.js. */
    let timer = null;
    const reselect = () => {
      /* THE SEGMENT IS CHECKED HERE, not when this was scheduled: a debounced
       * run easily outlives a tap on Off, and a re-select does not consult the
       * sources it overwrites. */
      if (drawingOff()) return;
      if (lastSelected) {
        map.getSource(SOURCE)?.setData(
          decorated(map, lastSelected.key, lastSelected.fc, lastSelected.stamp)
        );
      }
      if (lastAmbient) {
        map.getSource(AMB_SOURCE)?.setData(
          decorated(map, 'ambient', lastAmbient, `n${lastAmbient.features.length}`)
        );
      }
    };
    map.on('moveend', () => {
      clearTimeout(timer);
      const keys = [lastSelected?.key, lastAmbient ? 'ambient' : null]
        .filter(Boolean).map(bandKey);
      if (keys.length && bandMissingFor(map, keys)) { reselect(); return; }
      timer = setTimeout(reselect, COAST_BAND.reselectDebounceMs);
    });
  },

  update(map, storm, bundle) {
    const slot = bundle.layers?.surge;
    /* HELD EVEN WHILE OFF, same reasoning as the watch/warning stripe: this is
     * the geometry, not the drawing, and keeping it means switching back on
     * repaints from work already done. */
    const stamp = String(bundle.stamp?.advisnum || bundle.stamp?.filedate || '');
    lastSelected = slot?.status === 'ok' ? { key: storm.id, fc: slot.fc, stamp } : null;
    map.getSource(SOURCE)?.setData(
      lastSelected && !drawingOff()
        ? decorated(map, storm.id, slot.fc, stamp)
        : EMPTY
    );
  },

  clear(map) {
    lastSelected = null;
    map.getSource(SOURCE)?.setData(EMPTY);
    /* The coast is NOT restored here. Deselecting a storm does not turn the
     * segment off — the ambient surge for every other storm is still on the
     * map, and brightening the coastline back up under it would undo the fix
     * for as long as nothing was selected. `setPair` owns this. */
  },

  updateAmbient(map, features) {
    lastAmbient = features?.length ? { type: 'FeatureCollection', features } : null;
    map.getSource(AMB_SOURCE)?.setData(
      lastAmbient && !drawingOff()
        ? decorated(map, 'ambient', lastAmbient, `n${features.length}`)
        : EMPTY
    );
  },

  /** Gates DRAWING rather than re-pointing `key` — the same shape
   *  watch-warning.js uses, and for the same reason: Off has no slot to read.
   *  Returns false so the engine does not re-merge ambient; both sources are
   *  written here from data already in hand. */
  setPair(map, value) {
    if (value === segment) return false;
    segment = value;
    dimCoast(map, !drawingOff());
    map.getSource(SOURCE)?.setData(
      lastSelected && !drawingOff()
        ? decorated(map, lastSelected.key, lastSelected.fc, lastSelected.stamp)
        : EMPTY
    );
    map.getSource(AMB_SOURCE)?.setData(
      lastAmbient && !drawingOff()
        ? decorated(map, 'ambient', lastAmbient, `n${lastAmbient.features.length}`)
        : EMPTY
    );
    return false;
  },
});
