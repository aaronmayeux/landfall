/**
 * season-swath.js — the archive globe's wind footprint. §57.26, §57.27,
 * §57.30 step 6b.
 *
 * The ground that ever saw 34, 50 or 64 knot wind over the storm's whole life,
 * as one merged outline per threshold. `lib/season-windswath.js` builds the
 * shapes; this file draws them.
 *
 * ==> IT DRAWS THE FOCUSED STORM AND NOTHING ELSE. THAT IS THE DESIGN, NOT A
 * LIMITATION. <== Aaron's call, 2026-08-24. Three nested corridors per storm
 * across four ticked storms is twelve translucent shapes piling on each other,
 * and compounding translucent fills is the look he rejected outright when the
 * live swath was built — it is the first thing `lib/windswath.js`'s header
 * says. So the footprint is a "tell me about this one" fact rather than an
 * at-a-glance one, and it rides the interaction §57.21 already calls the most
 * important in the feature.
 *
 * **The cost is real and is not hidden:** with nothing focused, nothing draws,
 * so a reader who never taps a track never sees a footprint. What makes that
 * acceptable is that the same tap is what the roster's sentence is about —
 * `ui/view-seasons-board.js` says why a storm has no footprint at the moment
 * it is focused, so the absence and the presence are discovered by one action.
 * **If it turns out to be undiscoverable on glass, the fix is the roster
 * saying so, not drawing all of them.**
 *
 * ==> AND IT IS THE ONE SEASON LAYER THAT REBUILDS ON FOCUS RATHER THAN
 * REPAINTING. <== `season-tracks.js` and `season-marks.js` push every ticked
 * storm once and then swap a paint property, precisely because focus moves on
 * every tap and a `setData` re-tiles the source in the worker. This file
 * cannot do that: it holds at most one storm's shapes at a time, so a focus
 * change IS new data. Measured 2026-08-24 on the real season files — Katrina
 * is 12 ms and 1,363 vertices, Ida 13 ms and 1,645. Building the whole 2005
 * season instead would be 297 ms and 34,575 vertices, which is the second
 * reason this draws one storm rather than all of them.
 *
 * ==> NO THRESHOLD FALLBACK COLOUR. <== A band whose threshold cannot be read
 * is DROPPED rather than drawn in a default hue, the same rule
 * `map/layers/wind-field.js` follows: these are §6's fixed safety colours, and
 * a missing ring is visible where a wrong colour is a plausible lie. In
 * practice nothing is dropped — the builder writes `properties.radii` from
 * `WIND_KT` itself — and the guard stays because the alternative failure is
 * silent.
 *
 * Imports config/, lib/ and nothing from the layer engine — same reasoning as
 * `season-tracks.js`: a fixed set of finished shapes has no bundles, no feed
 * and no `forget` hook for the engine to manage.
 */

import { ARCHIVE_GEO } from '../../config/tokens.js';
import { buildSeasonSwath } from '../../lib/season-windswath.js';
import { windThresholdFromProps, windColor, windSortKey } from '../../lib/wind.js';

const SOURCE = 'season-swath';
const LAYER_FILL = 'season-swath-fill';
const LAYER_LINE = 'season-swath-line';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** The storms currently ticked, keyed by id, so a focus change can build
 *  without the board handing the whole set back. Replaced wholesale by
 *  `setSeasonSwathSet`, exactly as the sibling layers' sources are. */
let byId = new Map();

/** Which storm's footprint is on screen, or null. Held for the same reason the
 *  sibling layers hold their focus id: `ensure` runs again after a style
 *  install and must come back showing the CURRENT truth. */
let focusId = null;

/**
 * Tag each band with its §6 colour and its draw order.
 *
 * `fill-sort-key` puts the widest band underneath so the 64 kt core is not
 * buried by the 34 kt wash sitting on top of it — the nesting is the whole
 * point of drawing three, and it only reads if they stack in severity order.
 */
function decorated(features) {
  const out = [];
  for (const f of features || []) {
    const kt = windThresholdFromProps(f.properties);
    const color = windColor(kt);
    if (!color) continue;
    out.push({
      ...f,
      properties: { ...f.properties, _wkt: kt, _wcolor: color, _wsev: windSortKey(kt) },
    });
  }
  return { type: 'FeatureCollection', features: out };
}

/**
 * Attach the layers. Idempotent — the archive is entered and left many times
 * in one session and the source outlives all of it.
 *
 * @param {object} map
 * @param {string} [beforeId] draw beneath this layer, so the tracks and the
 *   landfall marks stay on top of the wash that is about them
 */
export function ensureSeasonSwath(map, beforeId) {
  if (!map || map.getSource(SOURCE)) return;

  map.addSource(SOURCE, { type: 'geojson', data: EMPTY });

  map.addLayer(
    {
      id: LAYER_FILL,
      type: 'fill',
      source: SOURCE,
      layout: { 'fill-sort-key': ['get', '_wsev'] },
      paint: {
        'fill-color': ['get', '_wcolor'],
        'fill-opacity': ARCHIVE_GEO.swathFillOpacity,
      },
    },
    beforeId
  );

  map.addLayer(
    {
      id: LAYER_LINE,
      type: 'line',
      source: SOURCE,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['get', '_wsev'],
      },
      paint: {
        'line-color': ['get', '_wcolor'],
        'line-width': ARCHIVE_GEO.swathLineWidth,
        'line-opacity': ARCHIVE_GEO.swathLineOpacity,
      },
    },
    beforeId
  );
}

/**
 * Remember which storms are ticked. Draws nothing on its own.
 *
 * ==> THE SET AND THE FOCUS ARRIVE SEPARATELY BECAUSE THEY CHANGE AT DIFFERENT
 * RATES. <== Ticking happens a few times a session; focus moves on every tap
 * on a track. Folding them into one call would mean rebuilding a footprint
 * every time the roster changed for any reason.
 *
 * A storm that leaves the set while focused takes its footprint with it —
 * unticking is how a reader says "not this one", and leaving the shapes up
 * would be the globe disagreeing with the roster.
 *
 * @param {object} map
 * @param {Array<{storm:object}>} selected
 */
export function setSeasonSwathSet(map, selected = []) {
  byId = new Map();
  for (const entry of selected) {
    const s = entry?.storm;
    if (s?.id) byId.set(s.id, s);
  }
  if (focusId && !byId.has(focusId)) focusId = null;
  drawFocused(map);
}

/**
 * Show this storm's footprint, or clear it.
 *
 * @param {object} map
 * @param {string|null} id
 */
export function setSeasonSwathFocus(map, id = null) {
  focusId = id && byId.has(id) ? id : null;
  drawFocused(map);
}

function drawFocused(map) {
  const src = map?.getSource?.(SOURCE);
  if (!src) return;

  const storm = focusId ? byId.get(focusId) : null;
  if (!storm) {
    src.setData(EMPTY);
    return;
  }

  /* ==> A THROW IN HERE MUST NOT TAKE THE FOCUS TAP WITH IT. <== The sweep is
   * a lot of geometry and this is the archive's most frequent interaction; a
   * storm whose corridor will not build has to leave the track focused and the
   * roster correct, with no footprint, rather than leaving the reader unable
   * to select anything. The console names it because a footprint that silently
   * never appears is indistinguishable from one this storm never had — which
   * is the exact distinction §57.25 spends words on. */
  let features = [];
  try {
    features = buildSeasonSwath(storm);
  } catch (err) {
    console.warn('[landfall] season swath could not be built', storm.id, err);
    features = [];
  }

  src.setData(decorated(features));
}

/** Leaving the archive. Drops the shapes, the set and the focus together. */
export function clearSeasonSwath(map) {
  byId = new Map();
  focusId = null;
  map?.getSource?.(SOURCE)?.setData(EMPTY);
}

export const __internals = { decorated, focus: () => focusId, size: () => byId.size };
