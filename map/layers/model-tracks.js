/**
 * model-tracks.js — model guidance "spaghetti". ADDITIVE (SPEC §7).
 *
 * WHAT IT ANSWERS, and it is a different question from every other layer
 * here: not "where is the storm going" — the cone answers that — but "how
 * much do the forecasters' own tools disagree about it". Five lines in a
 * tight bundle and five lines fanning across a thousand miles produce the
 * SAME official cone, and until this layer the two were indistinguishable on
 * screen. That gap is the reason the layer exists.
 *
 * AMBIENT ON EVERY STORM, like the wind field and the cone.
 *
 * The first build drew the selected storm only, on the arithmetic: five models
 * across a nine-storm season is forty-five crossing lines. Aaron switched it
 * on glass the same day — **a layer the user turned on and then has to tap a
 * storm to see is not a layer, it is a detail popup wearing a toggle.** The
 * toggle is a statement about the whole map, and the wind field settled this
 * exact argument once already.
 *
 * The forty-five-line worry is real and unmeasured, not wrong — it is just
 * not a reason to make the control lie in the meantime. If it turns the map
 * to soup with a full basin up, the fix is a floor keyed off `ZOOM`, one
 * constant, the same escape hatch §14 names for the wind field. Measure it
 * before building it.
 *
 * The two presentations RENDER IDENTICALLY. Selection changes which source a
 * storm's lines ride and nothing about how they look, so this is a data split
 * and never a visual difference.
 *
 * DASHED, ALWAYS, AND THAT IS THE GRAMMAR (§7). The forecast track is the
 * solid confident line and the past track is dotted; guidance is dashed and
 * thinner than both. A model track is not a forecast — it is one input to
 * one. Drawing it at the forecast's weight would promote a raw model run to
 * the status of NHC's judgement, which is a lie about authority, and the kind
 * that reads as authoritative precisely because it looks official.
 *
 * DRAWN UNDER THE TRACKS AND THE POINTS. Official geometry outranks derived
 * geometry, always (§13) — when a model line crosses the forecast track, the
 * forecast track is the one that stays whole.
 *
 * Imports: config/ and siblings only. NEVER data/ (§12, one-directional
 * imports) — the tracks arrive through the bundle like every other layer's
 * geometry, so this file has no idea a relay exists.
 */

import { STORM_GEO } from '../../config/tokens.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-model-tracks';
const AMB_SOURCE = 'amb-model-tracks';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** Additive toggles are applied through `setVisible`, which the engine may
 *  call before or after the first bundle arrives. Held so the two orders
 *  produce the same result — a layer whose visibility depends on which
 *  message landed first is a bug that only shows up on a slow connection. */
let visible = false;

/** Paint for one source. BOTH presentations use this, so ambient and selected
 *  cannot drift into looking different — the same guarantee wind-field.js
 *  gets from its shared `bandLayers`. */
function lineLayer(id, source) {
  return {
    id,
    type: 'line',
    source,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      /* Starts hidden: the layer ships OFF (§7 manifest), and creating it
       * visible would flash every model for one frame on any device slow
       * enough for the first `setVisible` to land after style load. */
      visibility: 'none',
    },
    paint: {
      /* Baked per feature in lib/adeck.js — see the note there on why this
       * is not a `match` expression over model codes. */
      'line-color': ['get', '_color'],
      'line-width': STORM_GEO.modelLineWidth,
      'line-opacity': STORM_GEO.modelLineOpacity,
      'line-dasharray': STORM_GEO.modelDash,
    },
  };
}

registerLayer({
  /* The bundle slot this reads. main.js fills it from the warmed a-deck
   * cache, so the slot behaves exactly like a MapServer layer's from here. */
  key: 'modelTracks',
  type: 'additive',

  /* Above the cone's veil (10) and the wind bands (15), below the past and
   * forecast tracks (20, 30). Guidance is context around the official track,
   * never over it. */
  order: 18,

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;
    map.addSource(AMB_SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(lineLayer(AMB_SOURCE, AMB_SOURCE), beforeId);
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(lineLayer(SOURCE, SOURCE), beforeId);
  },

  update(map, storm, bundle) {
    const slot = bundle?.layers?.modelTracks;
    map.getSource(SOURCE)?.setData(slot?.status === 'ok' ? slot.fc : EMPTY);
  },

  clear(map) {
    map.getSource(SOURCE)?.setData(EMPTY);
  },

  /** Every warmed storm's guidance except the selected one's — the engine
   *  merges the features and excludes the selection so nothing double-draws. */
  updateAmbient(map, features) {
    map.getSource(AMB_SOURCE)?.setData({ type: 'FeatureCollection', features });
  },

  /** BOTH layers, always together. Toggling one and not the other is how a
   *  layer ends up half-drawn — the selected storm's guidance visible and
   *  every other storm's silently missing, which reads as "no other model
   *  disagrees" rather than as a bug (§5). */
  setVisible(map, on) {
    visible = !!on;
    for (const id of [AMB_SOURCE, SOURCE]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  },
});
