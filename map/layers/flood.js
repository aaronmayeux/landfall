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
 * `floodSources`. Putting the clock in the key would miss on every tick and
 * memoize nothing; leaving expiry out of the render would draw a warning that
 * had run out.
 *
 * **FAULT 3 — SLICE B ADDS THE ONE PIECE OF ARITHMETIC BIG ENOUGH TO BE FELT
 * ON ITS OWN, SO IT IS CACHED BEFORE IT IS EVER PAID TWICE.** The chip needs a
 * point guaranteed to sit INSIDE its own polygon, and that search costs about
 * 8 ms on a single 1,970-vertex forecast zone in this sandbox — which is a
 * FLOOR for a phone, never a measurement of one. The first attempt ran the
 * whole set on every push. Here the answer is cached per alert id and the
 * expiry filter runs over the cached answers, so a re-push costs a Map lookup
 * per alert. See `lib/flood-features.js` for why the id is a safe key.
 *
 * ==> NO NUMBER IN THIS COMMENT CLAIMS THIS IS FAST. <== Nothing in the sandbox
 * can measure it: the basemap host is blocked, so MapLibre never finishes
 * building and `perf-select` hard-fails by design. This is a structural
 * argument about work not done, not a measurement, and the measurement comes
 * off CI or off Aaron's phone (`CLAUDE.md`).
 *
 * ==> WHAT SLICE B DELIBERATELY DOES NOT TOUCH. <== The polygon zoom ramp, the
 * corridor memo and the visibility gate all shipped in Slice A and Slice A has
 * not been judged on glass. Changing any of them here would make the two pushes
 * impossible to tell apart on a phone, which is the exact failure §56.15
 * records. Tapping — the detail panel, the cluster split, the rows becoming
 * buttons — is Slice C and is not here either.
 *
 * Imports: config/, lib/, and map/ siblings. No DOM beyond the map and the one
 * canvas the chip images are drawn on.
 */

import {
  DARK,
  FLOOD_COLOR,
  FLOOD_COLOR_LIGHT,
  FLOOD_GEO,
  LIGHT,
  OPACITY,
  STORM_GEO,
} from '../../config/tokens.js';
import { FLOOD, ZOOM } from '../../config/constants.js';
import { isLight } from '../../config/theme.js';
import { alertsNearTrack, trackChains, trackSamples } from '../../lib/flood.js';
import { createPointCache, floodSources, trimPointCache } from '../../lib/flood-features.js';
import { registerLayer } from './registry.js';

const SOURCE = 'flood-alerts';
const POINT_SOURCE = 'flood-alert-points';
const FILL = 'flood-alert-fill';
const LINE = 'flood-alert-line';
const CHIP = 'flood-alert-chip';

export const FLOOD_LAYER_IDS = Object.freeze([FILL, LINE, CHIP]);

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

/* --- the interior-point cache (Slice B) -------------------------------------
 *
 * A SECOND cache with a different key and a different lifetime, and the two are
 * not merged on purpose. The memo above answers "which alerts are near THIS
 * storm" and dies when the storm changes. This one answers "where inside its
 * own polygon does this alert's chip go", which is a fact about the alert and
 * about nothing else — so it survives every selection, and stepping between
 * four storms pays for each shared alert once rather than four times.
 * -------------------------------------------------------------------------- */
const pointCache = createPointCache();

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

/* ---------------------------------------------------------------------------
 * THE CHIP (Slice B)
 *
 * ==> IT IS A ROUNDED SQUARE AND IT MUST NEVER BECOME A CIRCLE. <== The rule is
 * `GENESIS_GEO`'s, stated there and inherited here: a storm in this app IS a
 * filled dot with a spiral and a halo, and that equation is the whole
 * legibility of the globe. Genesis obeys it by having no point marker at all. A
 * flood alert cannot do that — a mark at a point is the only thing that
 * survives §56.2's pixel table at planet distance, where the polygon is under
 * twelve pixels — so it obeys the rule the other way, by not being round. A
 * reader who has learnt "round means a storm" is never asked to unlearn it, and
 * the distinction still holds for somebody who cannot tell the green from the
 * orange.
 *
 * FOUR IMAGES: warning and watch, times two themes, pre-added under stable
 * names. Pre-adding both themes means a theme flip is a layout-property write
 * and never an `addImage` — a texture upload on the frame the reader is looking
 * at is the thing `map/layers/genesis.js` learnt to avoid.
 * ------------------------------------------------------------------------- */

const chipName = (watch, light) =>
  `flood-chip-${watch ? 'watch' : 'warning'}-${light ? 'light' : 'dark'}`;

/**
 * One chip, drawn at 2x.
 *
 * ==> NO DOM, NO CHIP, AND THAT IS A DEGRADE RATHER THAN A FAILURE. <== The
 * headless suites drive the layer engine with a stub map and no `document` at
 * all. `map/layers/genesis.js` records what happens when a layer throws in
 * `ensure`: the WHOLE engine goes down, every storm layer with it. Returning
 * null costs the chips and nothing else — the polygons are ordinary paint and
 * still draw, so an alert is still a green shape on the map. That is the right
 * trade for a texture upload that cannot happen.
 */
function chipImage(fill, stroke) {
  if (typeof document === 'undefined' || !document.createElement) return null;

  const scale = 2;
  const size = FLOOD_GEO.chipSizePx * scale;
  const r = FLOOD_GEO.chipRadiusPx * scale;
  const w = FLOOD_GEO.chipStrokeWidth * scale;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  /* Inset by half the stroke so the border is drawn INSIDE the tile. A stroke
   * centred on the path spills half its width past the edge and the canvas
   * clips it, which shows up as a chip with two crisp sides and two soft ones. */
  const a = w / 2;
  const b = size - w / 2;

  ctx.beginPath();
  ctx.moveTo(a + r, a);
  ctx.lineTo(b - r, a);
  ctx.quadraticCurveTo(b, a, b, a + r);
  ctx.lineTo(b, b - r);
  ctx.quadraticCurveTo(b, b, b - r, b);
  ctx.lineTo(a + r, b);
  ctx.quadraticCurveTo(a, b, a, b - r);
  ctx.lineTo(a, a + r);
  ctx.quadraticCurveTo(a, a, a + r, a);
  ctx.closePath();

  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = w;
  ctx.strokeStyle = stroke;
  ctx.stroke();

  return { data: ctx.getImageData(0, 0, size, size), pixelRatio: scale };
}

/** Add all four chips if they are not already there. Idempotent: `ensure` may
 *  run more than once and `hasImage` is the cheap guard. */
function ensureChipImages(map) {
  for (const light of [false, true]) {
    const colors = light ? FLOOD_COLOR_LIGHT : FLOOD_COLOR;
    /* THE OUTLINE INK IS THE THEME'S LABEL HALO, WHICH IS THE INK THIS APP
     * ALREADY USES FOR "SEPARATE THIS MARK FROM THE MAP UNDER IT" — dark in the
     * dark theme, near-white in the light one. Borrowing it rather than minting
     * a fifth hex means the chip tracks any future change to how marks are
     * separated from the basemap.
     *
     * ==> BOTH PALETTES ARE READ BY NAME, NOT THROUGH `palette()`. <== That
     * function answers for the ACTIVE theme only, and this loop is building the
     * images for BOTH so a theme flip never has to upload a texture. */
    const stroke = (light ? LIGHT : DARK).geo.labelHalo;
    for (const watch of [false, true]) {
      const name = chipName(watch, light);
      if (map.hasImage?.(name)) continue;
      const img = chipImage(watch ? colors.WATCH : colors.WARNING, stroke);
      if (img) map.addImage(name, img.data, { pixelRatio: img.pixelRatio });
    }
  }
}

/**
 * Is this feature a WARNING rather than a watch? One expression, read by the
 * chip image, the count's ink and the count's halo, so the three can never
 * disagree about which thing is on screen.
 *
 * ==> A CLUSTER IS A WARNING IF IT HOLDS EVEN ONE. <== The more urgent member
 * is what the reader has to know is in there; a cluster that looked like a
 * watch while hiding a warning would be this layer understating a hazard.
 */
const isWarningExpr = () => [
  'case',
  ['has', 'point_count'],
  ['>', ['get', 'warnings'], 0],
  ['!', ['get', '_watch']],
];

/** Which chip image a feature wants, for the active theme. */
const chipExpr = () => {
  const light = isLight();
  return ['case', isWarningExpr(), chipName(false, light), chipName(true, light)];
};

/**
 * The cluster count's ink, and it is NOT one colour.
 *
 * ==> ONE INK FOR ALL FOUR CHIPS FAILS WCAG AA ON EXACTLY ONE OF THEM, AND THAT
 * ONE IS REACHABLE. <== Computed rather than eyeballed — contrast ratios for
 * the theme's dark ink (#0B1420) and light ink (#F6F6F4) against each of the
 * four chip fills:
 *
 *   dark theme  / warning #3FBF6F   dark 7.83   light 2.18
 *   dark theme  / watch   #2A7A4A   dark 3.51   light 4.87
 *   light theme / warning #1E7A45   dark 3.46   light 4.94
 *   light theme / watch   #14532E   dark 2.03   light 8.41
 *
 * The first draft used the theme's label halo everywhere, which is the dark ink
 * on the dark theme — 3.51 on a watch cluster, under AA's 4.5 for text this
 * size, and a watch-only cluster is an ordinary thing to have on screen.
 * Picking per chip clears 4.5 on all four. §10, and
 * `tools/test-flood-features.mjs` recomputes the whole table so a hue change
 * cannot quietly drop one under the line.
 */
const countInkExpr = () => {
  const light = isLight();
  /* Only the dark theme's BRIGHT warning green wants the dark ink; the other
   * three greens are dark enough that the light ink wins. */
  const onWarning = light ? LIGHT.geo.labelHalo : DARK.geo.labelHalo;
  const onWatch = LIGHT.geo.labelHalo;
  return ['case', isWarningExpr(), onWarning, onWatch];
};

/** The count's halo is the chip it is sitting on, so the glyph edge stays clean
 *  where it crosses the chip's own border. */
const countHaloExpr = () => {
  const C = isLight() ? FLOOD_COLOR_LIGHT : FLOOD_COLOR;
  return ['case', isWarningExpr(), C.WARNING, C.WATCH];
};

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
  const pts = map.getSource(POINT_SOURCE);

  if (!heldStorm || !heldBundle) {
    src.setData(EMPTY);
    pts?.setData(EMPTY);
    return;
  }

  /* ==> ONE WALK, TWO SOURCES, AND THE EMPTY CASE ABOVE CLEARS BOTH. <== §56.5.
   * Two sources fed from two places is the split that drifts, and every way it
   * can drift looks fine on screen: a shape with no chip over it is invisible
   * below `ZOOM.floodFadeIn`, which is exactly where the chip is the only thing
   * carrying the layer, and a chip with no shape under it is a marker claiming a
   * hazard whose extent this app cannot draw. */
  const built = floodSources(matchedAlerts(), Date.now(), pointCache);
  src.setData(built.shapes);
  pts?.setData(built.points);

  /* AFTER the push and not before, so the cache is never emptied on the frame
   * that is about to read it. */
  trimPointCache(pointCache, FLOOD.pointCacheMax);
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

    ensureChipImages(map);

    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });

    /* ==> CLUSTERING IS A SOURCE OPTION, WHICH IS WHY THIS CANNOT SHARE THE ONE
     * ABOVE. <== MapLibre clusters `Point` geometry only, so the chips cannot
     * ride the polygon source the way a plain symbol layer could.
     *
     * `clusterProperties` is how a cluster knows what is inside it: MapLibre
     * drops every feature property on merge unless it is told to accumulate one.
     * `warnings` counts the non-watches, so the chip expression can ask whether
     * the pile holds anything happening now. */
    map.addSource(POINT_SOURCE, {
      type: 'geojson',
      data: EMPTY,
      cluster: true,
      clusterRadius: FLOOD.clusterRadiusPx,
      clusterMaxZoom: FLOOD.clusterMaxZoom,
      clusterProperties: {
        warnings: ['+', ['case', ['get', '_watch'], 0, 1]],
      },
    });

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

    map.addLayer(
      {
        id: CHIP,
        type: 'symbol',
        source: POINT_SOURCE,
        /* ==> NO ZOOM GATE, AND THAT IS THE WHOLE JOB. <== The polygons ramp in
         * from `ZOOM.floodFadeIn` because below it they are specks. The chip is
         * what answers at that distance — a scatter of counted marks is the
         * honest read of "eleven alerts, most of them here", a picture the
         * polygons genuinely cannot draw at six pixels across. */
        layout: {
          'icon-image': chipExpr(),
          /* ==> OVERLAP ALLOWED, AND §56.2 IS THE LINE THAT BOUGHT IT. <== With
           * collision on, MapLibre silently drops the icons it cannot place —
           * measured at 11 drawn for 14 alerts with the reader sitting right on
           * top of the pile at z7, so it does not resolve by zooming in.
           * Clustering has already merged everything genuinely too close to tap
           * apart, so anything still on screen is a distinct place and must
           * draw. A hazard mark dropped with nothing saying so is §5's silence
           * with a map over it. */
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': [
            'case',
            ['has', 'point_count'],
            ['get', 'point_count_abbreviated'],
            '',
          ],
          'text-font': ['Noto Sans Bold'],
          'text-size': FLOOD_GEO.countSize,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          /* Per-chip, and `countInkExpr` carries the measured reason. */
          'text-color': countInkExpr(),
          'text-halo-color': countHaloExpr(),
          'text-halo-width': FLOOD_GEO.countHaloWidth,
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
    /* ==> AND THE CHIPS WITH THEM. <== Emptying only the polygons would leave a
     * scatter of counted marks over a globe with no storm selected — the layer's
     * OWN answer to "which alerts belong to this storm" surviving the storm
     * going away. The point cache is NOT cleared: it holds where a chip goes,
     * which is a fact about the alert and stays true across selections. */
    map.getSource(POINT_SOURCE)?.setData(EMPTY);
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
 * Recolour after a theme change. PAINT AND LAYOUT WRITES, NOT A FEATURE
 * REBUILD.
 *
 * See `colorExpr` for why this layer does not join `main.js`'s re-push list —
 * that list is explicitly capped at three, and this is what the cap was telling
 * the next layer to do instead.
 *
 * ==> THE CHIP SWAPS TO AN IMAGE THAT IS ALREADY UPLOADED. <== All four were
 * added at `ensure`, so this is a name change on an existing texture rather
 * than an `addImage` on the frame the reader is looking at. That is the whole
 * reason both themes are built up front.
 */
export function rethemeFlood(map) {
  const expr = colorExpr();
  if (map.getLayer(FILL)) map.setPaintProperty(FILL, 'fill-color', expr);
  if (map.getLayer(LINE)) map.setPaintProperty(LINE, 'line-color', expr);
  if (map.getLayer(CHIP)) {
    map.setLayoutProperty(CHIP, 'icon-image', chipExpr());
    map.setPaintProperty(CHIP, 'text-color', countInkExpr());
    map.setPaintProperty(CHIP, 'text-halo-color', countHaloExpr());
  }
}

/** Test seam — the module holds selection state across calls. */
export function resetFloodLayer() {
  lastAlerts = [];
  heldBundle = null;
  heldStorm = null;
  visible = false;
  matchRuns = 0;
  forgetMemo();
  pointCache.points.clear();
  pointCache.runs = 0;
}

/** Test seam — how many times the corridor match has actually run. See
 *  `matchRuns`. Nothing in the app reads this. */
export function floodMatchRuns() {
  return matchRuns;
}

/** Test seam — how many interior-point searches have actually run.
 *
 *  ==> SAME REASON AS `floodMatchRuns`, AND A SHARPER ONE. <== The obvious
 *  assertion about a cache — that two pushes put the same chips on the map —
 *  passes with the cache deleted, because recomputing gives the same answer.
 *  This counts the WORK. Nothing in the app reads it. */
export function floodPointRuns() {
  return pointCache.runs;
}
