/**
 * gdacs-surge-coast.js — modelled coastal flooding, painted onto the coast.
 * SPEC §51.4. Joins the `coastal` pair's SURGE segment; `surge.js` is the NHC
 * half of that same segment.
 *
 * ==> WHY THIS IS NOT A SECOND SWITCH. <== Aaron's call for CAP applies
 * unchanged here: a reader who taps "Surge" means surge, and a second segment
 * reading "global surge" would be asking them to know which agency models
 * their coast before they can turn on the thing that tells them. One control,
 * two sources behind it — which is the rule the whole app runs on.
 *
 * ==> THE INPUT IS POINTS, AND EVERY METRE OF COAST PAINTED AROUND ONE IS
 *     OURS RATHER THAN THE MODEL'S. <== This is the honest difference from
 * `surge.js` and it sets the corridor width. NHC publishes a REACH — a named
 * stretch of coast that IS the subject of the forecast — so `coast-band.js`
 * fattening a breakpoint chord is reconstructing geometry NHC meant. GDACS
 * publishes a TOWN with a height. There is no reach; there is a point and a
 * number. So `GDACS_SURGE.bandHalfWidthKm` is 5 km rather than surge's 8 or
 * watch/warning's 50 — enough to reach the shoreline the town sits on, and not
 * enough to make a claim about the next bay.
 *
 * ==> AND NOTHING IS INTERPOLATED BETWEEN TOWNS. <== The first design drew a
 * continuous ramp along the coast from one town's height to the next. It was
 * rejected before it was written: Hookena reads 0.17 m and Hilo 0.13 m, and
 * they are 100 km apart on opposite sides of one island. Painting the coast
 * between them states a forecast the JRC never made for ground it never ran
 * on, which is the one thing this app may not do (§5). A town paints its own
 * shoreline and the gaps stay empty, because the gaps ARE empty.
 *
 * ==> IT USES ITS OWN RAMP AND MAY NEVER USE NHC'S. <== `GDACS_SURGE_RAMP`,
 * teal through magenta, against surge's blue through purple. The reason is in
 * `GDACS_SURGE` and it is not aesthetic: NHC's bottom rung is "up to 3 ft"
 * ≈ 0.91 m and every height this product has ever published is below it, so
 * on the shared ramp every storm outside America would be the same blue for
 * ever and a reader would learn a falsehood from the globe. A different hue
 * family also stops the two being mistaken for one scale, which matters more
 * because the datums have not been confirmed to match (§51.1).
 *
 * ==> IT DOES NOT USE `map/coast-band-cache.js`, FOR CAP'S REASON. <== That
 * cache is keyed per storm and stamped by ADVISORY NUMBER, because NHC
 * geometry is replaced advisory by advisory. This payload has no advisory
 * number — it is an aggregate across every bulletin the storm has issued — so
 * bolting it on would mean inventing half its key. The select is memoized here
 * instead, on the two things that genuinely invalidate it: the town set and
 * the coastline generation.
 *
 * ==> ONE FETCH, TWO SURFACES. <== `data/gdacs-surge.js` memoizes per storm
 * and the home dashboard reads the same memo, so the section and the coast
 * cannot show two different answers for one storm — the shape of bug §48.10
 * spends a section on for rainfall.
 *
 * Imports: config/, lib/, data/, map/ siblings. No DOM beyond the map.
 */

import { COAST_BAND, GDACS_SURGE } from '../../config/constants.js';
import { surgeColor, surgeRung, gdacsEventIdOf } from '../../lib/surge-locations.js';
import { areaSelect } from '../coast-band.js';
import { coastRings, coastGeneration } from '../coast-source.js';
import { loadGdacsSurge } from '../../data/gdacs-surge.js';
import { lineLayers } from './watch-warning.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-gdacs-surge';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** The towns currently painted, so `moveend` can re-select them against
 *  coastline that has since loaded. Held rather than re-derived: the storm and
 *  its town list are not reachable from an event handler. */
let held = null; // { places }

/** Off unless the reader has the coastal pair on SURGE. Defaulted to the
 *  manifest's value (`watchWarning`), so this starts silent and only speaks
 *  when the segment is actually chosen. */
let segment = 'watchWarning';
const drawingOff = () => segment !== 'surge';

/* ---------------------------------------------------------------------------
 * THE SELECT MEMO — the same construction cap-coast.js uses and for the same
 * reason: `moveend` fires this, and between two coastline generations with the
 * same town set the select returns identical features.
 * ------------------------------------------------------------------------ */
let memo = null; // { sig, generation, fc }

/** What the painted set is, as a string. Position AND height: a rerun that
 *  moves a town's number is a different statement, and the name alone would
 *  hold the old one. */
const signature = (places) =>
  places.map((p) => `${p.city}:${p.lat},${p.lon}:${p.heightM}`).sort().join('|');

/** A point → the smallest ring `areaBand` can work with.
 *
 *  ==> THE SQUARE IS A FORMALITY AND THE CORRIDOR IS THE REACH. <== A point
 *  has no area, and `areaSelect` takes rings. `GDACS_SURGE.pointRingDeg` keeps
 *  this shape negligible so that what actually decides how much coast is
 *  selected is the pad — one number, named for what it does, rather than a
 *  reach that is secretly the sum of two. */
function ringAround(lon, lat) {
  const d = GDACS_SURGE.pointRingDeg;
  return [[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]];
}

/**
 * Towns → painted coast runs.
 *
 * ==> A TOWN WITH NO READABLE HEIGHT IS NOT PAINTED, AND IT IS NOT AN ERROR.
 * <== The same rule `cap-coast.js` applies to an alert with no stated
 * severity. Painting it in a neutral colour would assert "this coast floods"
 * at a confidence the row does not carry, and the relay has already dropped
 * the sentinel rows, so reaching this is a schema change rather than a
 * routine absence.
 *
 * ==> AND A TOWN WITH NO COAST IN ITS CORRIDOR PRODUCES NOTHING, WITH NO
 * FALLBACK. <== `surge.js` keeps NHC's delivered geometry when a reach fails
 * to band, because official geometry is not ours to discard. There is nothing
 * equivalent here: the delivered geometry is a POINT, and a dot in the sea off
 * a coastline we could not load is not a lesser version of the answer, it is a
 * different and worse claim. No coast means no feature, which the section
 * beside it words honestly.
 */
function decorated(map, places) {
  const rings = coastRings(map);
  const features = [];

  for (const p of places) {
    const color = surgeColor(p.heightM);
    if (!color) continue;

    const { runs } = areaSelect(ringAround(p.lon, p.lat), rings, GDACS_SURGE.bandHalfWidthKm);
    if (!runs.length) continue;

    features.push({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: runs },
      properties: {
        /* `_banded` is the filter `lineLayers` draws on (map/coast-fallback.js
         * IS_BANDED). True unconditionally, because — as above — there is no
         * unsnapped fallback in this path for it to distinguish. */
        _banded: true,
        _color: color,
        /* ==> DEEPEST ON TOP. <== `line-sort-key` on the shared layers. Two
         * towns 3.7 km apart share coastline at this corridor width — measured,
         * Shomushon and Marasu on Saipan — and where two heights overlap the
         * reader must see the deeper one. That is the same §6 safety contract
         * `surge.js` enforces with `fill-sort-key`. */
        _sev: surgeRung(p.heightM),
        _surgeCity: p.city,
        _surgeHeightM: p.heightM,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

function paintFor(map, places) {
  const sig = signature(places);
  const generation = coastGeneration(map);
  if (memo && memo.sig === sig && memo.generation === generation) return memo.fc;
  const fc = decorated(map, places);
  memo = { sig, generation, fc };
  return fc;
}

const repaint = (map) => {
  map.getSource(SOURCE)?.setData(
    held && !drawingOff() ? paintFor(map, held.places) : EMPTY
  );
};

const blank = (map) => {
  held = null;
  memo = null;
  map.getSource(SOURCE)?.setData(EMPTY);
};

registerLayer({
  key: 'gdacsSurge',
  type: 'pair',
  pairId: 'coastal',
  /* 39 — immediately ABOVE `surge.js`'s 38 and below `watch-warning.js`'s 40.
   * The two surge sources never overlap in practice: a storm in an NHC basin
   * reaches this app without a GDACS event id at all (§51.5), so this layer
   * has nothing to paint there. Where they somehow did, NHC's is the official
   * warning and the more precise statement about that coast, so it must not be
   * buried — which is why this sits under the watch/warning stripe and why the
   * gap to it is left free. */
  order: 39,

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    for (const layer of lineLayers('sel-gdacs-surge', SOURCE, null)) {
      map.addLayer(layer, beforeId);
    }

    /* Coast vertices arrive as tiles load, so a settled camera can paint coast
     * the previous select could not see. Debounced on the constant both other
     * coastal layers use — one pinch fires several moveends and they must
     * collapse into one select. */
    let timer = null;
    map.on('moveend', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        /* THE SEGMENT IS CHECKED WHEN THIS RUNS, not when it was scheduled. A
         * tap on Watch/warning easily lands inside the debounce, and a
         * re-select does not consult the source it overwrites. */
        if (drawingOff()) return;
        repaint(map);
      }, COAST_BAND.reselectDebounceMs);
    });
  },

  /**
   * ==> ASYNC AND IT FETCHES ITS OWN DATA, LIKE `cap-coast.js`. <== This is not
   * per-storm geometry from the storm's own source, so it is not in the
   * bundle: it is a separate GDACS export reached by event id, and
   * `data/gdacs-surge.js` memoizes it for an hour. The call below is free once
   * the home dashboard has already made it, which is the point — one fetch,
   * one answer, two surfaces.
   *
   * The engine does not await this, so every path guards against the reader
   * having moved on.
   */
  update(map, storm) {
    const wanted = storm.id;
    const eventId = gdacsEventIdOf(storm);

    /* No event id is not an outage — it is a storm this source cannot be asked
     * about at all (§51.5). An empty source is a layer's only honest response
     * to a question it cannot put. */
    if (!eventId) { blank(map); return; }

    loadGdacsSurge(eventId).then((res) => {
      if (wanted !== storm.id) return;

      /* NOT AN OUTAGE HERE EITHER. `data/gdacs-surge.js` already separated
       * `unavailable` from `none_matched` and the home SECTION is where that
       * distinction is worded (§51.3). A layer cannot draw "we do not know",
       * and drawing an approximation of it would be worse than drawing
       * nothing. */
      const places = res?.status === 'ok' && Array.isArray(res.payload?.places)
        ? res.payload.places
        : [];

      if (!places.length) { blank(map); return; }

      held = { places };
      memo = null;
      repaint(map);
    });
  },

  clear(map) {
    blank(map);
  },

  /* No ambient half, for `cap-coast.js`'s reason: the ambient collection is
   * every warmed storm at once, and this layer's data is fetched per storm
   * rather than carried in a bundle. Merging them would mean a fetch per
   * warmed storm to paint coast behind a storm nobody opened. */

  setPair(map, value) {
    if (value === segment) return false;
    segment = value;
    repaint(map);
    /* FALSE: no ambient collection for the engine to re-merge, and the one
     * source this owns is written above from data already in hand. */
    return false;
  },
});
