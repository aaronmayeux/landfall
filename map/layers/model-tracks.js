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
 * SELECTED STORM ONLY — the one place this deliberately departs from the wind
 * field, which draws ambiently on every storm.
 *
 * The argument for ambient does apply here in principle: a layer the user set
 * and forgot should not silently apply to one storm. It loses to arithmetic.
 * Five models across a nine-storm season is forty-five lines crossing each
 * other over a globe on a phone, which is not a busier map, it is a map with
 * no information left in it. Guidance is inherently a per-storm reading, and
 * the ONE storm the user is looking at is the storm they are asking about.
 *
 * The implementation states that rather than asserting it: this file
 * registers no `updateAmbient` hook at all. The engine calls what exists, so
 * the absence of the function IS the decision — there is no flag to flip
 * accidentally and no ambient source sitting empty and confusing.
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
const EMPTY = { type: 'FeatureCollection', features: [] };

/** Additive toggles are applied through `setVisible`, which the engine may
 *  call before or after the first bundle arrives. Held so the two orders
 *  produce the same result — a layer whose visibility depends on which
 *  message landed first is a bug that only shows up on a slow connection. */
let visible = false;

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
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer(
      {
        id: SOURCE,
        type: 'line',
        source: SOURCE,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          /* Starts hidden: the layer ships OFF (§7 manifest), and creating it
           * visible would flash every model for one frame on any device slow
           * enough for the first `setVisible` to land after style load. */
          visibility: 'none',
        },
        paint: {
          /* Baked per feature in lib/adeck.js — see the note there on why
           * this is not a `match` expression over model codes. */
          'line-color': ['get', '_color'],
          'line-width': STORM_GEO.modelLineWidth,
          'line-opacity': STORM_GEO.modelLineOpacity,
          'line-dasharray': STORM_GEO.modelDash,
        },
      },
      beforeId
    );
  },

  update(map, storm, bundle) {
    const slot = bundle?.layers?.modelTracks;
    map.getSource(SOURCE)?.setData(slot?.status === 'ok' ? slot.fc : EMPTY);
  },

  clear(map) {
    map.getSource(SOURCE)?.setData(EMPTY);
  },

  /* NO updateAmbient — see the header. The absence is the decision. */

  setVisible(map, on) {
    visible = !!on;
    if (map.getLayer(SOURCE)) {
      map.setLayoutProperty(SOURCE, 'visibility', visible ? 'visible' : 'none');
    }
  },
});
