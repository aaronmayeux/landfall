/**
 * flood.js — NWS flood alerts, painted on the globe. SPEC §48.21.
 *
 * ==> THIS IS THE FIRST DRAWN THING IN §48, AND IT REOPENS A CLOSED QUESTION
 * ON NEW EVIDENCE. <== §48.1 says flatly that rainfall has no map layer and
 * that this is a decision rather than a gap, because **NHC publishes no
 * rainfall geometry** — checked against their own GIS index, where every other
 * hazard has a product and rainfall has none. That is still true and nothing
 * here contradicts it. What changed is that a flood warning is a DIFFERENT
 * PRODUCT from a DIFFERENT AGENCY: NWS issues it for a polygon a forecaster
 * drew, and that polygon travels in the alert. §48.1's finding was about NHC's
 * rainfall forecast; this is NWS's statement about water on the ground.
 *
 * ==> WARNINGS DRAW AND WATCHES DO NOT, AND THAT IS THE SOURCE'S DOING. <==
 * Measured on real NWS bytes (`samples/rain/alerts-hilo-hi.json`): a Flash
 * Flood Warning carries a 346-byte polygon; a Flood Watch carries
 * `geometry: null` and seventeen zone URLs, because watches are issued for
 * forecast zones rather than for a drawn box. Resolving those would be
 * seventeen more requests per watch. So watches ride the drawer's list and stay
 * off the globe, and **the count says so** — a layer that draws eleven of
 * nineteen while a sentence claims nineteen is on screen is the §5 failure with
 * a shape over it.
 *
 * ==> IT DRAWS EVERY FLOOD ALERT IN THE COUNTRY, NOT ONE STORM'S. <== The
 * toggle is a global additive switch, the same kind `genesis` is, and it asks
 * "what flood alerts are in force" — a question with no storm in it and
 * therefore no causal claim to get wrong. The per-storm question — which of
 * these fall inside THIS storm's cone — is answered in the drawer, in words,
 * where §48.21's wording rule can be enforced on a sentence. Two surfaces, two
 * questions, and the one that cannot be worded carefully is the one that never
 * mentions a storm.
 *
 * ==> ONLY WHAT IS IN FORCE PAINTS. <== `lib/flood.js` `inForce()` filters by
 * each row's own expiry at RENDER, not only at fetch. The captured Hilo warning
 * ran 52 minutes; a payload held even three minutes can contain one that has
 * run out, and an expired warning drawn on a map tells somebody they are in
 * danger when they are not. Same reason nothing here or in the relay keeps a
 * last-good copy.
 *
 * ==> GREEN, BECAUSE EVERY OTHER HUE ON THIS GLOBE IS SPOKEN FOR. <== Saffir-
 * Simpson owns the dots and NHC's watch/warning palette owns the coast, and
 * both are fixed and unthemeable (§4.7). NWS draws flood warnings green on its
 * own maps, so this agrees with the agency rather than minting a third
 * vocabulary. See `FLOOD_COLOR` in config/tokens.js.
 *
 * Imports: config/, lib/, data/ and map/ siblings. No DOM beyond the map.
 */

/* `STORM_GEO` and not `Z`: the outline's WIDTH is drawn geometry, which is what
 * that table holds — `Z` is the stacking order. Reading `Z.floodLineWidth`
 * resolved to `undefined`, MapLibre rejected the whole layer at addLayer time
 * with `number expected, undefined found`, and the polygons never drew. Caught
 * by `tools/boot-smoke.mjs`, which is the only gate in this repo that watches
 * the map's own error channel. */
import { FLOOD_COLOR, FLOOD_COLOR_LIGHT, OPACITY, STORM_GEO } from '../../config/tokens.js';
import { isLight } from '../../config/theme.js';
import { inForce } from '../../lib/flood.js';
import { registerLayer } from './registry.js';

const SOURCE = 'flood-alerts';
const FILL = 'flood-alert-fill';
const LINE = 'flood-alert-line';

export const FLOOD_LAYER_IDS = Object.freeze([FILL, LINE]);

const EMPTY = Object.freeze({ type: 'FeatureCollection', features: [] });

/** Held so a theme change or a visibility flip can re-push without refetching.
 *  The alert list is small and already in memory; asking the relay again to
 *  change a colour would be a network round trip for a repaint. */
let lastAlerts = [];
let lastNow = 0;
let visible = false;

/**
 * The two-colour paint expression for the current theme.
 *
 * ==> THE COLOUR IS A PAINT EXPRESSION HERE, NOT BAKED INTO THE FEATURES, AND
 * THAT DEPARTS FROM `genesis` ON PURPOSE. <== That layer bakes its hues in and
 * re-pushes its whole feature set on a theme change. `main.js` lists three such
 * re-pushes and says in as many words that three is the ceiling and **a fourth
 * is the signal to build the real repaint path rather than to add a line
 * there.** This layer is that fourth, so it takes the other road: it has
 * exactly TWO colours, so a theme change is `setPaintProperty` twice rather
 * than a rebuild of every polygon.
 *
 * ==> IT IS SAFE FROM THE RULE-1b TRAP, AND THE REASON IS THAT THERE IS NO
 * `global-state` IN IT. <== `map/theme-state.js` records that a paint property
 * holding BOTH a `global-state` reference and a feature read resolves to black
 * rather than throwing. This expression reads one feature property and
 * substitutes two literal hex strings resolved in JavaScript before the
 * expression is built — no state reference anywhere in it.
 */
const colorExpr = () => {
  const P = isLight() ? FLOOD_COLOR_LIGHT : FLOOD_COLOR;
  /* A warning is a thing happening; a watch is a thing that might. Severity
   * cannot separate them — both are `Severe` — so the shade does, exactly as
   * §48.6 makes urgency do it in the list. */
  return ['case', ['get', '_watch'], P.WATCH, P.WARNING];
};

/**
 * The drawable alerts as GeoJSON features.
 *
 * ==> AN ALERT WITH NO GEOMETRY IS SKIPPED, NEVER DEFAULTED. <== A watch has no
 * shape. Giving it one — a zone centroid, a circle, anything — would be this
 * app drawing a boundary NWS did not draw, which is the §5 fabrication in its
 * most literal form.
 */
export function floodFeatures(alerts, nowMs) {
  const out = [];

  for (const a of inForce(alerts, nowMs)) {
    if (!a.geometry) continue;
    out.push({
      type: 'Feature',
      geometry: a.geometry,
      properties: {
        _id: a.id || null,
        _event: a.event || null,
        _watch: /watch/i.test(a.event || ''),
      },
    });
  }
  return { type: 'FeatureCollection', features: out };
}

registerLayer({
  key: 'floodAlerts',
  type: 'additive',
  /* ==> ABOVE GENESIS, BELOW THE SELECTION STACK. <== A flood warning is a
   * thing that IS happening, so it outranks a watched area that might become a
   * storm. It sits under the cone and the track because those are the storm
   * itself and this is ground truth beneath it — and because a translucent
   * green wash over a track would make the track harder to read, which is the
   * one line on this globe that must stay legible. */
  order: 5,

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;

    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });

    map.addLayer(
      {
        id: FILL,
        type: 'fill',
        source: SOURCE,
        paint: {
          'fill-color': colorExpr(),
          /* WEAK ON PURPOSE. These polygons sit over land, and land is where
           * the coastline, the place labels and the storm's own track all live.
           * A flood warning has to be visible without making the geography
           * under it unreadable — the reader still needs to know WHICH county. */
          'fill-opacity': OPACITY.floodFill,
        },
      },
      beforeId
    );

    map.addLayer(
      {
        id: LINE,
        type: 'line',
        source: SOURCE,
        paint: {
          'line-color': colorExpr(),
          'line-width': STORM_GEO.floodLineWidth,
          'line-opacity': OPACITY.floodLine,
        },
      },
      beforeId
    );

    /* The switch may already be on when the style reloads — a theme change
     * tears every layer down and rebuilds it, and a layer that came back
     * visible-by-default would flash on for a reader who had turned it off. */
    for (const id of FLOOD_LAYER_IDS) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  },

  /* NO-OPS, AND DELIBERATELY PRESENT. The engine calls `update` on every
   * definition when a storm is selected and `clear` on every definition when
   * the selection closes. A flood warning is not owned by a storm — that is the
   * whole of §48.21's attribution problem — so both are empty with a reason
   * rather than absent and throwing. */
  update() {},
  clear() {},

  /* NO `updateAmbient` EITHER, AND IT IS LOAD-BEARING. The engine's ambient
   * merge collects features from every warmed storm BUNDLE under this key. No
   * bundle has a `floodAlerts` slot, so implementing it would hand this layer
   * an empty array every time any storm's geometry arrived and blank the map.
   * Data comes in through `setFloodAlerts` instead. */

  setVisible(map, on) {
    visible = !!on;
    for (const id of FLOOD_LAYER_IDS) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  },
});

/**
 * Push the current alert list onto the globe.
 *
 * ==> AN EMPTY ARRAY DRAWS NOTHING, AND THAT IS HONEST FOR EXACTLY ONE OF THE
 * THREE STATES. <== `ok` with nothing in force is an empty globe and true —
 * most hours no weather office in the country has a flood product out.
 * `unavailable` is ALSO an empty globe and is NOT honest on its own: there is
 * no such thing as drawing an outage. Never call this with `[]` to stand for a
 * failure without the words going up in the layer status row too.
 */
export function setFloodAlerts(map, alerts, { now = Date.now() } = {}) {
  lastAlerts = Array.isArray(alerts) ? alerts : [];
  lastNow = now;
  map.getSource(SOURCE)?.setData(floodFeatures(lastAlerts, lastNow));
}

/**
 * Recolour after a theme change. TWO PAINT WRITES, NOT A FEATURE REBUILD.
 *
 * See `colorExpr` for why this layer does not join `main.js`'s re-push list —
 * that list is explicitly capped at three, and this is what the cap was telling
 * the next layer to do instead.
 */
export function rethemeFlood(map) {
  const expr = colorExpr();
  if (map.getLayer(FILL)) map.setPaintProperty(FILL, 'fill-color', expr);
  if (map.getLayer(LINE)) map.setPaintProperty(LINE, 'line-color', expr);
}
