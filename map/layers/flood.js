/**
 * flood.js — the selected storm's NWS flood alerts, painted on the globe.
 * SPEC-FLOOD-PLAN.md §56.5. Slice A.
 *
 * ==> THIS IS THE FIRST DRAWN THING IN §48, AND IT REOPENS A CLOSED QUESTION
 * ON NEW EVIDENCE. <== §48.1 says flatly that rainfall has no map layer and
 * that this is a decision rather than a gap, because **NHC publishes no
 * rainfall geometry** — checked against their own GIS index, where every other
 * hazard has a product and rainfall has none. That is still true and nothing
 * here contradicts it. What changed is that a flood warning is a DIFFERENT
 * PRODUCT from a DIFFERENT AGENCY: NWS issues it for a polygon a forecaster
 * drew, and that polygon travels in the alert.
 *
 * ==> IT DRAWS ONE STORM'S ALERTS NOW, NOT THE WHOLE COUNTRY. <== The national
 * draw is deleted. §56.1 recorded that the old behaviour contradicted its own
 * manifest entry — the toggle sits in the `Storm detail` group and the layer
 * painted Ohio under a Hawaii storm — and this is the phase that resolves it in
 * favour of the manifest. What draws is what `lib/flood.js` measures to within
 * `RAIN.floodCorridorNm` of this storm's whole track, past and forecast, which
 * is the same corridor the drawer's `Flooding` section counts (§56.3). One
 * rule, two surfaces, so the map and the sentence cannot disagree.
 *
 * ==> AND THIS IS THE ONE PLACE THE PLAN ACCEPTS A RISK IT CANNOT WORD AWAY.
 * <== Drawing shapes only inside one storm's corridor tells the reader *this
 * storm did this*, in pictures, where there is no sentence to hedge with — and
 * an NWS flood alert names no storm (§48.21, §50.3). The mitigation is that the
 * layer draws only while that storm is selected, so the drawer's wording is on
 * screen at the same moment as the shapes. **Aaron made this call knowingly on
 * 2026-08-22.** It is written here so a later session finds the decision rather
 * than the smell.
 *
 * ==> WATCHES DRAW NOW, AND THAT IS PHASE 4'S DOING RATHER THAN THIS ONE'S.
 * <== This header used to say warnings draw and watches cannot, because a Flood
 * Watch arrives with `geometry: null` and a list of forecast zones instead of a
 * drawn box. Those zones are resolved and joined on in `data/flood.js` now
 * (§56.4), so a watch reaching this file has real boundaries. What still cannot
 * be drawn is a watch whose boundaries did not come back — it is counted and
 * said in words, never given a shape we invented.
 *
 * ==> ONLY WHAT IS IN FORCE PAINTS. <== `inForce()` filters by each row's own
 * expiry at RENDER, not only at fetch. The captured Hilo warning ran 52
 * minutes; a payload held even three minutes can contain one that has run out,
 * and an expired warning drawn on a map tells somebody they are in danger when
 * they are not.
 *
 * ==> GREEN, BECAUSE EVERY OTHER HUE ON THIS GLOBE IS SPOKEN FOR. <== Saffir-
 * Simpson owns the dots and NHC's watch/warning palette owns the coast, and
 * both are fixed and unthemeable (§4.7). NWS draws flood warnings green on its
 * own maps, so this agrees with the agency rather than minting a third
 * vocabulary. See `FLOOD_COLOR` in config/tokens.js.
 *
 * ------------------------------------------------------------------------
 * WHAT THIS FILE IS SHAPED BY, AND IT IS NOT AESTHETICS
 * ------------------------------------------------------------------------
 *
 * The first attempt at this phase was built, pushed, patched twice and reverted
 * whole on 2026-08-23 because it made storm selection drag (§56.15). Two of the
 * three faults were structural and both are designed out here rather than
 * patched later:
 *
 * **FAULT 1 — THE ENGINE CALLS `update()` ON EVERY DEFINITION ON EVERY
 * `setBundle`, VISIBLE OR NOT.** This layer is off by default, so a reader who
 * never finds the switch was paying the full corridor match on every selection
 * and every poll in order to draw nothing. `update()` here stores two
 * references and returns when the layer is off. The match runs behind
 * `push()`, which no caller reaches while `visible` is false.
 *
 * **AND THE OTHER HALF OF THAT GATE IS `setVisible` PUSHING ON TURN-ON.**
 * Without it the switch appears dead until the next poll, which is a control
 * that half works — worse than the cost it saved.
 *
 * **FAULT 2 — A POLL RE-PUSHING AN UNCHANGED BUNDLE REPEATED ALL OF IT.**
 * `repushSelected()` fires on every poll touching the selected storm, on a
 * theme change and on a restyle. So the match is memoized — and **keyed on the
 * bundle and the alert list themselves, never on anything derived from them**.
 * That is the specific trap §56.15 names: `trackSamples(trackChains(...))`
 * builds a new array on every call, so an identity test against samples
 * compares a fresh copy with the one just made and never hits.
 *
 * **THE CLOCK IS DELIBERATELY NOT IN THAT KEY.** What is memoized is the
 * GEOMETRIC match — which alerts come near this track — and that answer does
 * not change as the minutes pass. Expiry is applied at render, every push, by
 * `floodFeatures`. Putting the clock in the key would miss on every tick and
 * memoize nothing; leaving expiry out of the render would draw a warning that
 * had run out.
 *
 * ==> NO NUMBER IN THIS COMMENT CLAIMS THIS IS FAST. <== Nothing in the sandbox
 * can measure it: the basemap host is blocked, so MapLibre never finishes
 * building and `perf-select` hard-fails by design. This is a structural
 * argument about work not done, not a measurement, and the measurement comes
 * off CI or off Aaron's phone (`CLAUDE.md`).
 *
 * Imports: config/, lib/, and map/ siblings. No DOM beyond the map.
 */

import { FLOOD_COLOR, FLOOD_COLOR_LIGHT, OPACITY, STORM_GEO } from '../../config/tokens.js';
import { ZOOM } from '../../config/constants.js';
import { isLight } from '../../config/theme.js';
import { alertsNearTrack, inForce, trackChains, trackSamples } from '../../lib/flood.js';
import { registerLayer } from './registry.js';

const SOURCE = 'flood-alerts';
const FILL = 'flood-alert-fill';
const LINE = 'flood-alert-line';

export const FLOOD_LAYER_IDS = Object.freeze([FILL, LINE]);

const EMPTY = Object.freeze({ type: 'FeatureCollection', features: [] });

/** The national list, as `main.js` last fetched it. Held so turning the switch
 *  on can draw immediately rather than waiting for a poll. */
let lastAlerts = [];

/** The selected storm's geometry bundle, and the storm it belongs to. Stored
 *  whether or not the layer is on — two assignments, so the off case stays
 *  free — and read only by `push()`. */
let heldBundle = null;
let heldStorm = null;

let visible = false;

/* --- the memo (§56.15 fault 2) ---------------------------------------------
 *
 * Keyed on the two INPUT objects by identity. The bundle is replaced when the
 * storm's geometry actually changes and the alert list when the fetch actually
 * returns, so a re-push of an unchanged selection hits and a real change
 * misses. Anything derived — samples above all — is rebuilt on every call and
 * would never match itself.
 * -------------------------------------------------------------------------- */
let memoBundle = null;
let memoAlerts = null;
let memoMatched = null;

/** How many times the corridor match has actually RUN — incremented only on a
 *  memo miss.
 *
 *  ==> IT EXISTS BECAUSE THE OBVIOUS TEST OF A MEMO CANNOT FAIL. <== Asserting
 *  that two pushes of the same bundle produce the same feature count passes
 *  whether or not the memo is there, since recomputing gives the same answer.
 *  §12's rule is that a test agreeing with the bug is worse than no test, so
 *  the suite counts the work instead of its result. */
let matchRuns = 0;

/** The alerts within the corridor of the held storm's track.
 *
 *  ==> IT MATCHES THE WHOLE LIST, EXPIRED ROWS INCLUDED, AND FILTERS AT RENDER.
 *  <== See the header: keeping the clock out of the key is what makes the memo
 *  hit at all. Matching a handful of rows that have already run out costs one
 *  distance test each and is paid once per bundle, where re-matching every
 *  poll would be paid forever. */
function matchedAlerts() {
  if (memoBundle === heldBundle && memoAlerts === lastAlerts) return memoMatched;

  const layers = heldBundle?.layers;
  /* THE SAME TWO SLOTS THE DRAWER MEASURES (§56.3), so the shapes on the globe
   * and the count in the `Flooding` section come from one rule. A storm with
   * only one half still gets an answer: a newly named system has no past track
   * worth the name, an ended one has no forecast, and `lib/flood.js` returns
   * `no_track` only when NEITHER carries a line. */
  const samples = trackSamples(
    trackChains(layers?.pastTrack?.fc || null, layers?.forecastTrack?.fc || null)
  );
  matchRuns++;
  const hit = alertsNearTrack(lastAlerts, samples);

  /* `no_track` and `none_matched` both draw nothing HERE and are different
   * facts (§5). The distinction is not lost — it is made in words by the
   * drawer's section and by the layer status row, which are the surfaces that
   * can say something. A map cannot draw the difference between "nothing is
   * near" and "there was nothing to measure". */
  memoMatched = hit.state === 'ok' ? hit.alerts : [];
  memoBundle = heldBundle;
  memoAlerts = lastAlerts;
  return memoMatched;
}

function forgetMemo() {
  memoBundle = null;
  memoAlerts = null;
  memoMatched = null;
}

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
 * The zoom ramp (§56.5). A county-scale polygon is under about twelve pixels
 * below `ZOOM.floodFadeIn` and reads as dirt rather than as a place.
 *
 * ==> IT RAMPS OPACITY RATHER THAN FLIPPING `visibility`, SO CROSSING THE LINE
 * COSTS NOTHING. <== The features sit in the source either way; only what
 * MapLibre paints changes. Swapping visibility on zoom would re-tile the source
 * every time a reader crossed the threshold, which is the kind of per-frame
 * cost this phase exists to avoid.
 */
const rampTo = (peak) => [
  'interpolate',
  ['linear'],
  ['zoom'],
  ZOOM.floodFadeIn, 0,
  ZOOM.floodFull, peak,
];

/**
 * The matched alerts, in force at `nowMs`, as GeoJSON features.
 *
 * ==> AN ALERT WITH NO GEOMETRY IS SKIPPED, NEVER DEFAULTED. <== Giving one a
 * shape — a zone centroid, a circle, anything — would be this app drawing a
 * boundary NWS did not draw, which is the §5 fabrication in its most literal
 * form. `alertsNearTrack` has already counted these as `unplaceable` so the
 * drawer can say they exist.
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

/**
 * Put the current answer on the map.
 *
 * ==> EVERY EXPENSIVE THING THIS FILE DOES IS BEHIND THIS FUNCTION, AND THIS
 * FUNCTION RETURNS IMMEDIATELY WHEN THE LAYER IS OFF. <== That is fault 1 of
 * §56.15 closed at the only point it can be closed at — the engine will keep
 * calling `update()` for every definition on every `setBundle`, because that is
 * its contract, so the gate has to live here.
 */
function push(map) {
  if (!visible) return;
  const src = map.getSource(SOURCE);
  if (!src) return;
  if (!heldStorm || !heldBundle) {
    src.setData(EMPTY);
    return;
  }
  src.setData(floodFeatures(matchedAlerts(), Date.now()));
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
          /* WEAK ON PURPOSE, and ramped. These polygons sit over land, and land
           * is where the coastline, the place labels and the storm's own track
           * all live. A flood warning has to be visible without making the
           * geography under it unreadable — the reader still needs to know
           * WHICH county. */
          'fill-opacity': rampTo(OPACITY.floodFill),
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
          /* `STORM_GEO` and not `Z`: the outline's WIDTH is drawn geometry,
           * which is what that table holds — `Z` is the stacking order. Reading
           * `Z.floodLineWidth` resolved to `undefined`, MapLibre rejected the
           * whole layer at addLayer time with `number expected, undefined
           * found`, and the polygons never drew. Caught by
           * `tools/boot-smoke.mjs`, the only gate here that watches the map's
           * own error channel. */
          'line-width': STORM_GEO.floodLineWidth,
          'line-opacity': rampTo(OPACITY.floodLine),
        },
      },
      beforeId
    );

    /* The switch may already be on when the style reloads — a theme change
     * tears every layer down and rebuilds it, and a layer that came back
     * visible-by-default would flash on for a reader who had turned it off. */
    applyVisibility(map);
  },

  /**
   * The selected storm changed, or its bundle was re-pushed.
   *
   * ==> TWO ASSIGNMENTS AND A RETURN WHEN THE LAYER IS OFF. <== §56.15 fault 1.
   * The engine calls this for every definition on every `setBundle` — every
   * selection and every poll — so this is the hot path for a feature most
   * readers never switch on.
   */
  update(map, storm, bundle) {
    heldStorm = storm || null;
    heldBundle = bundle || null;
    if (!visible) return;
    push(map);
  },

  /** Selection closed. §56.5: with no storm selected this layer draws nothing,
   *  and the status row is what says why — an empty map with no explanation is
   *  its own bug. */
  clear(map) {
    heldStorm = null;
    heldBundle = null;
    forgetMemo();
    if (!visible) return;
    map.getSource(SOURCE)?.setData(EMPTY);
  },

  /* NO `updateAmbient`, AND IT IS LOAD-BEARING. The engine's ambient merge
   * collects features from every warmed storm BUNDLE under this key. No bundle
   * has a `floodAlerts` slot, so implementing it would hand this layer an empty
   * array every time any storm's geometry arrived and blank the map. This layer
   * is per-SELECTION by design (§56.5); ambient would be the national draw
   * coming back through the side door. */

  /**
   * ==> THE SECOND HALF OF THE VISIBILITY GATE, AND WITHOUT IT THE SWITCH LOOKS
   * BROKEN. <== `update()` skips the work while the layer is off, so by the
   * time somebody turns it on there is nothing in the source. Pushing here is
   * what makes the control respond under the finger instead of at the next
   * poll.
   *
   * The early return matters as much: `main.js` pushes EVERY toggle through
   * `applyLayerState()` on every layer change and every selection, so this is
   * called constantly with a value that has not moved.
   */
  setVisible(map, on) {
    const next = !!on;
    if (next === visible) return;
    visible = next;
    applyVisibility(map);
    if (visible) push(map);
  },
});

function applyVisibility(map) {
  for (const id of FLOOD_LAYER_IDS) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

/**
 * Hand the layer the national alert list. `main.js` calls this whenever its
 * fetch resolves.
 *
 * ==> IT IS NO LONGER GATED BY THE CALLER, BECAUSE THE GATE MOVED IN HERE. <==
 * Storing the list is one assignment; the expense is the match and the source
 * write, and both sit behind `push()`. Handing it over unconditionally means
 * the list is already in hand the moment somebody flips the switch.
 *
 * ==> AN EMPTY ARRAY DRAWS NOTHING, AND THAT IS HONEST FOR EXACTLY ONE OF THE
 * THREE STATES. <== `ok` with nothing in force is an empty globe and true —
 * most hours no weather office in the country has a flood product out.
 * `unavailable` is ALSO an empty globe and is NOT honest on its own: there is
 * no such thing as drawing an outage. Never call this with `[]` to stand for a
 * failure without the words going up in the layer status row too.
 */
export function setFloodAlerts(map, alerts) {
  lastAlerts = Array.isArray(alerts) ? alerts : [];
  push(map);
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

/** Test seam — the module holds selection state across calls. */
export function resetFloodLayer() {
  lastAlerts = [];
  heldBundle = null;
  heldStorm = null;
  visible = false;
  matchRuns = 0;
  forgetMemo();
}

/** Test seam — how many times the corridor match has actually run. See
 *  `matchRuns`. Nothing in the app reads this. */
export function floodMatchRuns() {
  return matchRuns;
}
