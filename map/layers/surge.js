/**
 * surge.js — peak storm surge. EXCLUSIVE PAIR B of `coastal` (§7);
 * watch-warning.js is segment A.
 *
 * ==> THE CARTOGRAPHY HERE IS INHERITED, MEASURED AND HARD-WON. <== Five
 * decisions below came off the HA project's v0.2.7 surge rework, where each
 * was tried the other way first and rejected on glass. They are restated with
 * their reasons so nobody re-runs the experiment:
 *
 * 1. OPAQUE FILLS, NOT TRANSLUCENT. Half-transparent bands stacked into mud
 *    wherever two overlapped. Depth comes from PAINT ORDER, not alpha.
 * 2. WORST SEVERITY ON TOP, via `fill-sort-key`. Where a red area overlaps a
 *    blue one the reader must see red — that is the §6 safety contract, and
 *    with opaque fills the sort key is the only thing enforcing it.
 * 3. EACH BAND STROKED IN ITS OWN FILL COLOUR. A round-joined stroke dilates
 *    every shape by half its width, so hairline inlets read as ribbons and
 *    scattered speckles merge into contiguous patches. A km or two of honest
 *    exaggeration — the same trade NHC's own public surge map makes.
 * 4. UNDER THE COASTLINE, OVER THE LAND. Flooded area paints over land but the
 *    shoreline still draws through it, so the coast stays readable. `order`
 *    below is what puts it there.
 * 5. HOLES ARE KEPT. The HA project dropped interior rings because every
 *    pocket of high ground punched one and it read as splattered paint — but
 *    that was the INUNDATION product at street resolution. Measured on
 *    Milton's peak-surge fixture: two interior rings in the entire 22-advisory
 *    archive. There is nothing here to drop, and dropping rings by reflex is
 *    how a layer vanishes when a source winds its rings the other way.
 *
 * ==> AND ONE THING THAT IS NOT INHERITED, BECAUSE NOTHING KNEW IT. <== Surge
 * is not bands only. Every advisory carries coastal LINES beside the polygons,
 * carrying their own colour and depth — roughly half the features. They are
 * drawn as strokes rather than fills, closer to the watch/warning stripe than
 * to a band, because that is what they are: a reach of coast with a forecast
 * depth, not an area of water.
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

function decorated(map, key, fc, stamp) {
  const all = fc?.features || [];
  const reaches = all.filter((f) => f.properties?.kind === 'line');
  const areas = all.filter((f) => f.properties?.kind !== 'line');
  if (!reaches.length) return { type: 'FeatureCollection', features: areas };
  const { features } = bandFor(map, bandKey(key), reaches, stamp, SURGE.bandHalfWidthKm);
  return { type: 'FeatureCollection', features: [...areas, ...features] };
}

function surgeLayers(id, source, minzoom) {
  const zoomFloor = minzoom != null ? { minzoom } : {};
  const color = colorExpression();
  return [
    {
      id: `${id}-fill`,
      type: 'fill',
      source,
      ...zoomFloor,
      filter: isPolygon,
      layout: { 'fill-sort-key': ['get', 'severity'] },
      paint: {
        'fill-color': color,
        /* Opaque. See decision 1 in the header before lowering this. */
        'fill-opacity': OPACITY.surgeFill,
      },
    },
    {
      /* The dilation stroke — decision 3. Same colour as its fill, so it reads
       * as the band being fatter rather than as an outlined shape. */
      id: `${id}-edge`,
      type: 'line',
      source,
      ...zoomFloor,
      filter: isPolygon,
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'severity'] },
      paint: {
        'line-color': color,
        'line-width': OPACITY.surgeDilatePx,
        'line-opacity': OPACITY.surgeFill,
      },
    },
    {
      /* Coastal reaches. Thicker than the band edge because they carry the
       * whole message on their own — there is no fill under them. */
      id: `${id}-reach`,
      type: 'line',
      source,
      ...zoomFloor,
      filter: isLine,
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'severity'] },
      paint: {
        'line-color': color,
        'line-width': OPACITY.surgeReachPx,
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
