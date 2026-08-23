/**
 * flood.js — every NWS flood alert in force in the United States, painted on
 * the globe. SPEC-FLOOD-PLAN.md §56.5.
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
 * ==> IT DRAWS THE WHOLE COUNTRY, AND NO SELECTION IS INVOLVED ANYWHERE. <==
 * 2026-08-23, Aaron's call on glass: *"I had to select a storm. I don't want to
 * have to. It should draw on the map like any other layer."* Slice A had made it
 * per-storm; this reverses that, and the reversal is a NET DELETION — the
 * corridor match, the memo, the held storm and the held bundle are all gone from
 * this file.
 *
 * ==> THE ARGUMENT SLICE A WAS BUILT ON WAS WEAKER THAN IT LOOKED, AND HERE IS
 * WHY, SO NOBODY REVERSES IT BACK. <== §56.1 called the national draw a
 * contradiction: the toggle sits in the `Storm detail` group and the layer
 * painted Ohio under a Hawaii storm. But `map/layers/genesis.js` is in that same
 * group and draws every watched area on Earth with nothing selected. A map-wide
 * layer in that group is already what ships, so the group was never the problem
 * and does not move.
 *
 * ==> AND IT RETIRES A RISK RATHER THAN TAKING ONE ON. <== This header used to
 * record that drawing green shapes only inside one storm's corridor tells the
 * reader *this storm did this*, in pictures, where there is no sentence to hedge
 * with — and an NWS flood alert names no storm (§48.21, §50.3). Aaron accepted
 * that knowingly on 2026-08-22. Drawing the nation makes no claim about any
 * storm at all, so the risk is gone rather than mitigated.
 *
 * **THE DRAWER'S `Flooding` SECTION IS STILL PER-STORM AND STILL RIGHT.** It
 * counts what comes within `RAIN.floodCorridorNm` of that storm's track (§56.3),
 * so the globe now shows MORE shapes than the section counts. Two different
 * questions — *where is flooding* and *what is near this storm* — and both
 * answers are true. Nothing in that section claims the globe is showing its set.
 *
 * ==> WATCHES DRAW, AND THAT IS PHASE 4'S DOING. <== A Flood Watch arrives with
 * `geometry: null` and a list of forecast zones instead of a drawn box. Those
 * zones are resolved and joined on in `data/flood.js` (§56.4), so a watch
 * reaching this file has real boundaries. What still cannot be drawn is a watch
 * whose boundaries did not come back — it is counted and said in words, never
 * given a shape we invented.
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
 * whole on 2026-08-23 because it made storm selection drag (§56.15). Going
 * national answers the whole of that, because it takes this layer OFF THE
 * SELECTION PATH ENTIRELY:
 *
 * **FAULT 1 — THE ENGINE CALLS `update()` ON EVERY DEFINITION ON EVERY
 * `setBundle`, VISIBLE OR NOT.** `update()` here is a no-op. There is nothing
 * per-storm left to hold, so a selection cannot cost this layer anything whether
 * the switch is on or off.
 *
 * **FAULT 2 — A POLL RE-PUSHING AN UNCHANGED BUNDLE REPEATED ALL OF IT.** There
 * is no bundle. `repushSelected()` reaches `update()`, which returns.
 *
 * **FAULT 3 — THE INTERIOR-POINT SEARCH IS THE ONE PIECE OF ARITHMETIC BIG
 * ENOUGH TO BE FELT ALONE.** About 8 ms on a single 1,970-vertex forecast zone
 * in this sandbox, which is a FLOOR for a phone and never a measurement of one.
 * It is cached per alert id in `lib/flood-features.js`, so the national set is
 * searched once each and never again — see that file for why the id is a safe
 * key.
 *
 * **THE VOLUME WAS MEASURED, NOT ASSUMED.** Off the archive branch on
 * 2026-08-23: **17 alerts nationally, 16 drawable, 112 vertices between them.**
 * The frozen quiet-day capture in `samples/flood/` is 36 alerts and 289
 * vertices. The expensive shapes are resolved WATCH zones — one Hawaii zone is
 * 1,970 vertices on its own — and a busy national watch day is the case to
 * re-measure before tuning anything here. `git show
 * origin/archive:latest/relay-nws-flood.json`.
 *
 * ==> NO NUMBER IN THIS COMMENT CLAIMS THIS IS FAST. <== Nothing in the sandbox
 * can measure it: the basemap host is blocked, so MapLibre never finishes
 * building and `perf-select` hard-fails by design. This is a structural
 * argument about work not done, not a measurement, and the measurement comes
 * off CI or off Aaron's phone (`CLAUDE.md`).
 *
 * Imports: config/, lib/, and map/ siblings. No DOM beyond the map and the one
 * canvas the chip images are drawn on.
 */

import {
  FLOOD_COLOR,
  FLOOD_COLOR_LIGHT,
  FLOOD_GEO,
  OPACITY,
  STORM_GEO,
} from '../../config/tokens.js';
import { FLOOD, ZOOM } from '../../config/constants.js';
import { DURATION } from '../../config/motion.js';
import { isLight } from '../../config/theme.js';
import { createPointCache, floodSources, pointForAlert, trimPointCache }
  from '../../lib/flood-features.js';
/* ==> THE CHIP IS A FILE OF ITS OWN NOW, AND SO IS `map/`'s ONLY EDGE INTO
 * `ui/`. <== This file crossed §12's 700-line ceiling on Slice B; SPEC.md's
 * inventory named the cut twice and it grew both times. Slice C took it first
 * and on its own, so the move carries no behaviour with it. Four functions come
 * back across: one that uploads the textures and three paint expressions. */
import {
  chipExpr,
  countHaloExpr,
  countInkExpr,
  ensureChipImages,
} from './flood-chip.js';
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

let visible = false;

/* --- the interior-point cache ----------------------------------------------
 *
 * Where a chip goes inside its own polygon is a fact about the ALERT and about
 * nothing else, so the answer is computed once per alert id and kept for as
 * long as that alert is in the list. Nothing in this layer's lifecycle can
 * invalidate one — there is no selection here to change.
 *
 * ==> THE CORRIDOR MEMO THAT USED TO SIT BESIDE THIS IS GONE, AND SO IS
 * EVERYTHING IT MEMOIZED. <== It existed because §56.15's fault 2 was a poll
 * re-pushing an unchanged storm bundle and repeating the corridor match. There
 * is no bundle and no match here any more. See the header.
 * -------------------------------------------------------------------------- */
const pointCache = createPointCache();

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
 * Put the current answer on the map.
 *
 * ==> EVERY EXPENSIVE THING THIS FILE DOES IS BEHIND THIS FUNCTION, AND THIS
 * FUNCTION RETURNS IMMEDIATELY WHEN THE LAYER IS OFF. <== The switch is off by
 * default, so most readers never pay for the interior-point search or for
 * pushing county-scale geometry into MapLibre. `setVisible` pushes on turn-on so
 * the control still answers under the finger (§56.15).
 *
 * ==> THERE ARE ONLY TWO CALLERS NOW: A FETCH LANDING, AND THE SWITCH BEING
 * FLIPPED. <== Selecting a storm no longer reaches this function at all, which
 * is the whole of what going national bought.
 */
function push(map) {
  if (!visible) return;
  const src = map.getSource(SOURCE);
  if (!src) return;
  const pts = map.getSource(POINT_SOURCE);

  /* ==> ONE WALK, TWO SOURCES. <== §56.5. Two sources fed from two places is the
   * split that drifts, and every way it can drift looks fine on screen: a shape
   * with no chip over it is invisible below `ZOOM.floodFadeIn`, which is exactly
   * where the chip is the only thing carrying the layer, and a chip with no shape
   * under it is a marker claiming a hazard whose extent this app cannot draw.
   *
   * An empty `lastAlerts` produces two empty collections and draws nothing, which
   * is the truthful answer for a country with no flood product out — and is NOT
   * the truthful answer for an outage. See `setFloodAlerts` below. */
  const built = floodSources(lastAlerts, Date.now(), pointCache);
  src.setData(built.shapes);
  pts?.setData(built.points);

  /* AFTER the push and not before, so the cache is never emptied on the frame
   * that is about to read it. */
  trimPointCache(pointCache, FLOOD.pointCacheMax);

  /* ==> A NEW SOURCE MEANS NEW CLUSTER IDS, SO A HELD ONE IS MEANINGLESS. <==
   * MapLibre assigns cluster ids when it indexes, and a poll re-indexes. Left
   * alone, a stale id would either match nothing (harmless) or match a
   * DIFFERENT pile (a chip missing with nothing saying so). Cleared on every
   * push, which is the only moment the ids can change. */
  showFloodClusters(map);
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
          /* ==> A SHORT FADE RATHER THAN A CUT, AND IT IS THE ONLY TIMING IN
           * THIS LAYER. <== A tapped cluster drops to opacity 0 the instant the
           * tap is handled (see `hideFloodCluster`). A hard cut at that moment
           * reads as a dropped frame; `DURATION.instant` (90ms) is the tier this
           * app already uses for immediate feedback — a press state, a focus
           * ring — which is exactly what this is. Opacity only
           * — §10's rule about animating transform and opacity and nothing
           * else. */
          'icon-opacity-transition': { duration: DURATION.instant },
          'text-opacity-transition': { duration: DURATION.instant },
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

  /* ==> BOTH HOOKS ARE NO-OPS, AND DELIBERATELY PRESENT RATHER THAN ABSENT.
   * <== The engine calls `update` on every definition when a storm is selected
   * and `clear` on every definition when the selection closes; a definition
   * missing them throws and takes the whole engine down with it, every storm
   * layer included (`map/layers/genesis.js` records that failure).
   *
   * ==> AND THIS IS WHERE §56.15's FAULTS 1 AND 2 GO TO DIE. <== Fault 1 was the
   * engine calling `update()` for every definition on every `setBundle`,
   * visible or not, so a reader who never found the switch paid the full corridor
   * match on every selection to draw nothing. Fault 2 was a poll re-pushing an
   * unchanged bundle and repeating all of it. An empty function cannot do either.
   * A selection now costs this layer NOTHING, on or off.
   *
   * They take no arguments on purpose: a parameter here is an invitation for the
   * next session to start holding a storm again. `map/layers/genesis.js` is the
   * same shape for the same reason — a watched area is not owned by any storm
   * either. */
  update() {},
  clear() {},

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

/** Test seam — the module holds the alert list, the switch and the cache across
 *  calls. */
export function resetFloodLayer() {
  lastAlerts = [];
  visible = false;
  hiddenCluster = null;
  pointCache.points.clear();
  pointCache.runs = 0;
}

/** Test seam — how many interior-point searches have actually run.
 *
 *  ==> IT COUNTS THE WORK, BECAUSE THE OBVIOUS TEST OF A CACHE CANNOT FAIL. <==
 *  Asserting that two pushes put the same chips on the map passes with the cache
 *  deleted, since recomputing gives the same answer. §12's rule is that a test
 *  agreeing with the bug is worse than no test. Nothing in the app reads this.
 *
 *  ==> `floodMatchRuns` USED TO SIT BESIDE IT AND IS GONE WITH THE CORRIDOR
 *  MATCH. <== That seam counted a memo this file no longer has, because the
 *  layer no longer matches anything to a storm. */
export function floodPointRuns() {
  return pointCache.runs;
}

/* ===========================================================================
 * TAPPING (§56.6)
 *
 * ==> THE HIT TEST ASKS THE LAYER'S OWN SWITCH FIRST, AND THAT IS THE WHOLE
 * PERFORMANCE STORY OF SLICE C. <== `main.js` already runs up to three hit
 * tests on every tap of the globe — the house, the storm dots, the watched
 * areas — and every one of them is a `queryRenderedFeatures` against a tile
 * index on the frame a finger went down. A fourth would be paid by every
 * reader on every tap, including the taps on empty ocean whose only job is
 * closing the drawer, and paid hardest by the readers who never turn this
 * layer on at all. `visible` is false by default, so for them this returns on
 * its first line and costs one boolean read.
 *
 * ==> ONLY THE CHIP IS QUERIED, NOT THE POLYGONS. <== The same rule
 * `map/layers/genesis.js` states: the fill, the outline and the chip all
 * describe the same alert, so naming more than one turns one tap into three
 * hits to deduplicate for no gain. The polygon is also the wrong TARGET —
 * counties are enormous, they ramp in only past `ZOOM.floodFadeIn`, and a
 * county-sized tap area sitting under the storm dots would start eating taps
 * meant for the water. The chip is the mark this layer asks to be tapped.
 * ======================================================================== */

/**
 * What is under this point, if anything this layer owns.
 *
 * @returns {{kind:'alert', id:string}
 *          |{kind:'cluster', clusterId:number, lon:number, lat:number}
 *          |null}
 *
 * ==> IT RETURNS AN ID AND NEVER THE ALERT, MIRRORING `stormAtPoint` AND
 * `genesisAtPoint`. <== A feature's properties are a COPY, baked into a tile
 * when the source was last written. Handing that copy to a panel means the
 * panel can be reading last poll's expiry under a reader who is deciding
 * whether to move. The caller looks the id up in the live list instead, which
 * is the only place the answer is current.
 *
 * A SMALL BOX RATHER THAN A BARE POINT, AND DELIBERATELY NOT THE FULL 44 px.
 * §10's touch target is what `FLOOD.clusterRadiusPx` already enforces on the
 * SOURCE: anything closer together than a fingertip has been merged into one
 * chip, so by the time a chip is on screen it is a distinct place. Padding the
 * query out to 44 here would put two neighbouring chips inside one box and let
 * the winner be whichever MapLibre listed first — an arbitrary answer to a
 * deliberate tap. `genesisAtPoint` reasons its way to the same 8 px from the
 * opposite direction.
 */
export function floodAtPoint(map, point) {
  if (!visible) return null;
  if (!map.getLayer?.(CHIP)) return null;

  const pad = FLOOD.chipHitPadPx;
  const box = [
    [point.x - pad, point.y - pad],
    [point.x + pad, point.y + pad],
  ];
  const hits = map.queryRenderedFeatures(box, { layers: [CHIP] });

  for (const h of hits) {
    const p = h.properties || {};
    /* ==> A CLUSTER IS TESTED FIRST BECAUSE IT CAN CARRY BOTH SHAPES OF
     * PROPERTY. <== MapLibre's cluster features carry `point_count` and
     * `cluster_id` and NONE of the accumulated members' own fields, but a
     * `_id` left over from an earlier read of the same variable would send a
     * pile of fifteen warnings to a panel about one. Asking the question that
     * can only be true of a cluster first makes that unreachable. */
    if (p.point_count) {
      const c = h.geometry?.coordinates;
      if (!Array.isArray(c)) continue;
      return { kind: 'cluster', clusterId: p.cluster_id, lon: c[0], lat: c[1] };
    }
    if (p._id) return { kind: 'alert', id: p._id };
  }
  return null;
}

/**
 * One alert out of the national list, by id.
 *
 * ==> THE LIST IS NATIONAL AND THE DRAWER'S `Flooding` SECTION IS NOT, SO THIS
 * IS THE ONLY LOOKUP THAT ANSWERS FOR EVERY CHIP ON THE GLOBE. <== That
 * section counts what comes within `RAIN.floodCorridorNm` of the selected
 * storm's track (§56.3); the globe paints the country. Tapping a chip over
 * Ohio while a Hawaii storm is selected is an ordinary thing to do, and
 * looking that alert up in the storm's matched subset would find nothing and
 * open an empty panel. Both answers are true — they are answers to different
 * questions — and this is the one that matches what was tapped.
 */
export function floodAlertById(id) {
  if (!id) return null;
  return lastAlerts.find((a) => a.id === id) || null;
}

/**
 * How far in a cluster has to be zoomed before it comes apart.
 *
 * ==> THE ANSWER LIVES IN THE WORKER, SO THIS IS A PROMISE. <== MapLibre keeps
 * the cluster index off the main thread; `getClusterExpansionZoom` posts a
 * message and resolves. That is a feature rather than a nuisance — the
 * arithmetic that decides the zoom is not run on the frame the finger lifted.
 *
 * ==> AND THE CAMERA MOVE IS NOT DONE HERE. <== `map/globe.js` owns every
 * camera travel in this app so the reduce-motion contract lives in one place
 * (§10). A layer reaching for `easeTo` would be a second one, and the first
 * thing it would get wrong is the reader who has asked their phone for less
 * motion. This returns a number and `app/views.js` flies.
 *
 * @returns {Promise<number|null>} null when the source or the cluster is gone —
 *   a poll can land between the tap and the answer.
 */
/**
 * Where the chip for one alert sits, so the panel can fly to it.
 *
 * ==> THE SAME POINT THE CHIP WAS DRAWN AT, FROM THE SAME CACHE. <== A second
 * way of answering "where is this alert" is a second answer that can disagree
 * with the first, and the reader would land beside the mark rather than on it.
 * A cache miss — the switch has been off all session, so nothing has been drawn
 * — computes it and keeps it, exactly as a push would.
 */
export function floodAlertPoint(alert) {
  if (!alert?.geometry) return null;
  return pointForAlert(alert, pointCache);
}

/* ---------------------------------------------------------------------------
 * THE TAPPED CLUSTER GETS OUT OF THE WAY (§56.6)
 *
 * ==> A CLUSTER STAYS PAINTED FOR THE WHOLE FLIGHT AND ONLY BREAKS APART ON
 * ARRIVAL, AND THAT LOOKS BROKEN. <== Aaron on a phone, 2026-08-23. MapLibre
 * recomputes which points merge when the ZOOM lands, so the chip reading "8"
 * rides the camera all the way in and pops into eight chips at the end. The
 * reader has pressed something and watched it not respond.
 *
 * ==> IT IS AN OPACITY WRITE AND NOTHING ELSE. <== No source rewrite, no
 * filter change, no re-tiling — those are the expensive operations on this
 * layer and every one of them would cost a frame at exactly the moment the
 * camera starts moving. `setPaintProperty` on two opacity properties is a
 * uniform update.
 *
 * ==> ONLY THE TAPPED CLUSTER FADES. <== Hiding the whole chip layer for the
 * duration would flicker every other alert on screen, which is a worse fault
 * than the one being fixed.
 *
 * ==> AND IT MUST COME BACK NO MATTER HOW THE FLIGHT ENDS. <== The reader can
 * grab the globe mid-flight; the cluster can already be at max zoom and never
 * split; the poll can replace the whole source underneath. If any of those left
 * a chip hidden, this layer would have invented a way for a hazard marker to
 * vanish silently, which is §5 with a map over it. `showFloodClusters` is
 * called from `moveend` — which fires on an interrupted flight too — and again
 * on every push.
 * ------------------------------------------------------------------------ */

/** The cluster currently faded out, or null. */
let hiddenCluster = null;

/** Opacity for the chip and its numeral: 0 for the tapped cluster, 1 for
 *  everything else. A plain 1 when nothing is hidden, so the common case is a
 *  constant rather than an expression MapLibre has to evaluate per feature. */
const chipOpacityExpr = () =>
  hiddenCluster == null
    ? 1
    : ['case', ['==', ['get', 'cluster_id'], hiddenCluster], 0, 1];

function applyChipOpacity(map) {
  if (!map.getLayer?.(CHIP)) return;
  const expr = chipOpacityExpr();
  map.setPaintProperty(CHIP, 'icon-opacity', expr);
  map.setPaintProperty(CHIP, 'text-opacity', expr);
}

/**
 * Fade the tapped cluster out. Called the instant the tap is handled, before
 * the camera is asked to do anything.
 */
export function hideFloodCluster(map, clusterId) {
  if (!Number.isFinite(clusterId)) return;
  hiddenCluster = clusterId;
  applyChipOpacity(map);
}

/** Put every chip back. Safe to call when nothing is hidden — the early return
 *  means an idle `moveend` costs one comparison rather than two paint writes. */
export function showFloodClusters(map) {
  if (hiddenCluster == null) return;
  hiddenCluster = null;
  applyChipOpacity(map);
}

export function floodClusterZoom(map, clusterId) {
  const src = map.getSource?.(POINT_SOURCE);
  if (!src?.getClusterExpansionZoom) return Promise.resolve(null);
  return Promise.resolve(src.getClusterExpansionZoom(clusterId)).catch(() => null);
}
