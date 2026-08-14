/**
 * views.js — the drawer, the five views, and the home marker.
 *
 * §12: `app/` is the composition layer. It may import from anywhere; nothing
 * imports from it except main.js. This file reaches `ui/` (all five views and
 * the drawer), `map/` (the home marker, the provisional pin, the camera),
 * `data/` (home, layer prefs, the advisory fetch, the a-deck cache) and
 * `config/` — four layers at once, which is exactly what `app/` exists for.
 *
 * ==> WHY THIS IS ITS OWN FILE <==
 * The views are knotted together by CONSTRUCTION ORDER rather than by logic:
 * `layerStatus` is built from a callback into `layersView`, the pipeline is
 * handed `() => detailView`, the drawer registers all five, and the cluster
 * aria hangs off `drawer.onChange`. Inside boot()'s closure that knot was
 * invisible — every name was just in scope. Out here the knot has to be
 * written down, which is the point.
 *
 * ==> THE THREE ORDERING CONTRACTS ARE EXPORTED SEPARATELY AND TESTED. <==
 * `runSelect`, `runRecenter` and `familiesForStorms` were inline sequences
 * nothing could reach. Two of them are load-bearing ORDERS — get `runSelect`
 * wrong and the drawer shows the previous storm's advisory (the bug that cost
 * a session in the Phase 6 step 6 work); get `runRecenter` wrong and a
 * selection ends in one place while still drawn in another. They take their
 * collaborators as an argument bag so `tools/test-views.mjs` can drive them
 * with recorders and assert the sequence directly, the same way
 * `test-bundle-pipeline.mjs` asserts the decoration order.
 *
 * WHAT THIS FILE OWNS: the drawer, the five views, the home marker, the
 * provisional pin, and the per-layer status store the Layers panel reads.
 *
 * WHAT IT DOES NOT OWN: the storm list, the full store state, the imagery
 * module and the geometry pipeline. All four have readers all over main.js
 * and two of them do not exist yet when this is constructed, so they arrive as
 * GETTERS — the same pattern that kept pass 2 from moving boot order.
 */

import { flyToStorm, flyToPoint, recenter } from '../map/globe.js';
import { homeFrame } from '../map/home-frame.js';
import { setGenesisSelection } from '../map/layers/genesis.js';
import { GENESIS } from '../config/constants.js';
import { createHomeMarker } from '../map/marker-home.js';
import { createProvisionalPin } from '../map/pin-provisional.js';
import { waterAt } from '../map/water-at.js';
import { createDrawer } from '../ui/drawer.js';
import { createStormsView } from '../ui/view-storms.js';
import { createStormDetailView } from '../ui/view-storm-detail.js';
import { createAreaDetailView } from '../ui/view-area-detail.js';
import { createHomeSetupView } from '../ui/view-home-setup.js';
import { createHomeDashboardView } from '../ui/view-home.js';
import { createLayersView } from '../ui/view-layers.js';
import { createSettingsView } from '../ui/view-settings.js';
import { createLayerStatus } from './layer-status.js';
import { motionHeading } from '../lib/heading.js';
import {
  subscribeHome,
  getHome,
  distanceTo,
  closestApproach,
} from '../data/home.js';
import {
  get as getLayers,
  pairValue,
  toggleOn,
  setPair,
  setToggle as setLayerPref,
  resetLayers,
  isDefault as layersAreDefault,
  subscribeLayers,
  pairLiveOptions,
  modelChecked,
  modelsOnCount,
  setModel,
  modelsOnInFamily,
} from '../data/layer-prefs.js';
import { modelSelectorGroups } from '../config/layers.js';
import { getAdeck, evictAdeck } from '../data/adeck.js';
import { getGeometry } from '../data/cache.js';
import { fetchAdvisory } from '../data/advisory.js';
import { refresh } from '../data/store.js';
import { settingValue } from '../data/settings-prefs.js';
import { resolveSystem } from '../lib/units.js';
import { count as countAction } from '../lib/usage.js';
import { MODEL_FAMILY } from '../config/constants.js';
import {
  isInstalled,
  canPromptInstall,
  needsManualInstall,
  onInstallReady,
  requestInstall,
} from '../pwa.js';

/**
 * THE ONE ANSWER TO "WHICH UNITS". Every view is handed THIS function, not its
 * own copy of the question — two surfaces resolving the preference separately
 * is how a drawer ends up showing miles above kilometres. It lives here now
 * because every consumer of it is a view.
 *
 * `resolveSystem` collapses the stored `auto` against the device locale at
 * call time, so a stored preference of AUTO keeps following the device rather
 * than being frozen to whatever it meant on first run.
 */
const unitSystem = () => resolveSystem(settingValue('units'));

/* ---------------------------------------------------------------------------
 * THE PURE PARTS — no DOM, no map, no store. Exported so they can be tested.
 * ------------------------------------------------------------------------- */

/**
 * One-shot flyTo OFFSET from the DRAWER's REAL box (§16: center the storm on
 * the visible globe area). Offset semantics: where the target center lands
 * relative to container center — the left rail pushes the storm right by half
 * the rail; the bottom sheet pushes it up by half the sheet.
 *
 * Persistent `padding` is FORBIDDEN — it desyncs the two globes; see the
 * scar-tissue note on flyToStorm.
 *
 * @param {{width:number, height:number, wide:boolean}} box
 * @returns {[number, number]}
 */
export function panelOffsetFor({ width = 0, height = 0, wide = false } = {}) {
  return wide ? [width / 2, 0] : [0, -height / 2];
}

/**
 * WHICH MODEL FAMILIES ARE ON SCREEN — the input to the picker's group list.
 *
 * NHC storms take NOAA's models; everything else takes TCGP's. That mapping is
 * safe because data/merge.js already drops GDACS copies of storms inside NHC's
 * basins, so a non-NHC storm here is genuinely outside NOAA's a-deck coverage.
 *
 * With no storms up this returns an EMPTY set, which `modelSelectorGroups`
 * reads as "show both groups" rather than none — a selector that vanishes
 * reads as a broken panel (§5: absence is never silent).
 *
 * @param {Array|null|undefined} storms
 * @returns {Set<string>}
 */
export function familiesForStorms(storms) {
  return new Set(
    (storms || []).map((s) => (s?.source === 'nhc' ? MODEL_FAMILY.NHC : MODEL_FAMILY.GLOBAL))
  );
}

/**
 * Where recenter puts the camera.
 *
 * IT GOES TO YOUR HOUSE IF YOU HAVE ONE. "Back out" used to mean a fixed
 * mid-Atlantic view, which on glass is a screen of open water with the
 * coastline you care about off the edge. Home is the reference point the whole
 * app is built around — every distance, every closest approach — so it is also
 * the right place for the camera to come to rest. `undefined` hands the
 * decision back to map/globe.js, whose fallback is the contiguous United
 * States rather than the ocean.
 *
 * @param {{lon:number, lat:number}|null} home
 * @returns {{center:[number,number]}|undefined}
 */
export function recenterTarget(home) {
  return home ? { center: [home.lon, home.lat] } : undefined;
}

/**
 * SELECTION — tap a dot, tap a row, Enter on a focused row. All identical
 * (§16). The drawer swaps to the detail view and the camera flies TOGETHER,
 * not sequentially.
 *
 * ==> THE ORDER OF THESE SIX CALLS IS LOAD-BEARING. <==
 * The selection is recorded, the guidance row is recomputed, the drawer is
 * pushed with the storm, and only THEN does a fetch start. Start the fetch
 * first and its synchronous `setGeometry({state:'loading'})` reaches the detail
 * view before the view has been entered with this storm — which is the exact
 * seam that produced the drawer's one-storm-behind advisory bug.
 *
 * The row is recomputed BEFORE any fetch so a cache hit shows its state
 * instantly rather than flashing "loading".
 *
 * @param {object} storm
 * @param {{count:Function, idle:object, pipeline:object, drawer:object,
 *          fly:Function, refreshModelStatus:Function}} deps
 */
/**
 * ONE watched area selected, from any of the three input paths (§45).
 *
 * ==> IT IS NOT `runSelect` WITH A DIFFERENT ARGUMENT, AND IT MUST NOT BECOME
 *     ONE. <== `runSelect` calls `pipeline.select` and `pipeline.load`, which
 * ask the geometry pipeline for a storm's cone, track, wind radii and watches
 * by advisory bin. A watched area HAS NO BIN — it has no advisory, because
 * nothing has formed to advise on. Routing an area through that path would
 * send a request for geometry that cannot exist and mark a healthy layer
 * unavailable when it came back empty.
 *
 * So this does the four things that DO apply: interrupt the drift, mark the
 * patch as picked, push the panel, fly the camera.
 */
export function runSelectArea(area, { count, idle, drawer, flyArea, markArea }) {
  /* Counted in one place for the same reason storm selection is: three
   * entrances (a patch on the globe, a row in the drawer, Enter on a focused
   * row) and one increment. Never which area. */
  count('area_select');
  idle.interrupt();
  markArea(area.id);
  drawer.push('area', area);
  flyArea(area);
}

export function runSelect(storm, { count, idle, pipeline, drawer, fly, refreshModelStatus }) {
  /* THE CORE LOOP, COUNTED IN ONE PLACE. Every route into selection — a dot on
   * the globe, a row in the list, Enter on a focused row — arrives here, which
   * is exactly why the count belongs here and not at the three call sites. A
   * plain increment: never which storm. */
  count('storm_select');
  /* Selection can come from the drawer (off-canvas), so the idle drift never
   * sees a gesture — interrupt it explicitly or its per-frame setCenter stomps
   * the flyTo. Also resets the auto-rotate clock, as any interaction does. */
  idle.interrupt();
  pipeline.select(storm);
  refreshModelStatus();
  drawer.push('detail', storm);
  fly(storm);
  pipeline.load(storm);
}

/**
 * POINT EVERYTHING AT A STORM WITHOUT NAVIGATING TO IT.
 *
 * ==> `runSelect` MINUS THE DRAWER PUSH, AND THAT IS THE ONLY DIFFERENCE. <==
 * The home dashboard's stepper needs the camera and the drawn geometry to
 * follow it while the reader stays on the dashboard — the whole point of that
 * screen is one storm against one house, and pushing the detail panel on every
 * chevron press would throw them off it on the first step.
 *
 * IT SHARES `runSelect`'S ORDER FOR THE SAME REASON: record the selection,
 * recompute the guidance row, and only then start a fetch. The row is
 * recomputed before any fetch so a cache hit shows its state instantly rather
 * than flashing "loading".
 *
 * COUNTED AS A SELECTION, because that is what it is — geometry drawn, camera
 * moved, one storm chosen out of many. A plain increment; never which storm.
 *
 * @param {object} storm
 * @param {{count:Function, idle:object, pipeline:object, fly:Function,
 *          refreshModelStatus:Function}} deps
 */
export function runFocus(storm, { count, idle, pipeline, fly, refreshModelStatus }) {
  count('storm_select');
  /* The chevron lives in the drawer, off-canvas, so the idle drift never sees
   * a gesture — interrupt it explicitly or its per-frame setCenter stomps the
   * flyTo. Same trap runSelect documents. */
  idle.interrupt();
  pipeline.select(storm);
  refreshModelStatus();
  fly(storm);
  pipeline.load(storm);
}

/**
 * ONE recenter behavior for both entrances (the button and Esc-twice):
 * recenter is "back to the globe", so it ends the selection too. Closing the
 * drawer deliberately leaves the geometry drawn (you dismissed it to look at
 * the map, §16); this is the explicit way off that state.
 *
 * `pipeline.clear()` cancels any in-flight geometry response, drops the held
 * bundle AND clears the drawn selection in one call, because a selection ended
 * in one place and still drawn in another is the half-state nobody checks for.
 *
 * @param {{count:Function, drawer:object, pipeline:object,
 *          refreshModelStatus:Function, idle:object, goHome:Function}} deps
 */
export function runRecenter({ count, drawer, pipeline, refreshModelStatus, idle, goHome }) {
  count('recenter');
  if (drawer.isOpen()) drawer.close();
  pipeline.clear();
  refreshModelStatus();
  idle.interrupt(); // or the drift's per-frame setCenter stomps the easeTo
  goHome();
}

/* ---------------------------------------------------------------------------
 * THE COMPOSITION
 * ------------------------------------------------------------------------- */

/**
 * @param {object} deps
 * @param {object} deps.map          MapLibre map
 * @param {object} deps.idle         the idle-drift handle from attachIdleRotation
 * @param {object} deps.pipeline     app/bundle-pipeline.js
 * @param {Function} deps.storms     () => the current storm list
 * @param {Function} deps.fullState  () => the last full store state, or null
 * @param {Function} deps.imagery    () => map/imagery.js, or null before style.load
 * @param {Function} deps.warmDecks   warm every eligible storm's model deck
 */
export function createViews({ map, idle, pipeline, storms, fullState, imagery, warmDecks }) {
  /* Views read home and layer state through injected façades rather than
   * importing data/ themselves — ui/ must not depend on data/ directly
   * (SPEC §12, one-directional imports). This file owns the wiring. */
  const homeApi = {
    get: getHome,
    distanceTo,

    /**
     * CLOSEST APPROACH FOR A LIST ROW, OFF THE WARM CACHE — no fetch.
     *
     * ==> THIS IS THE ONE HOME-RELATIVE FACT BOTH SOURCES CAN ANSWER. <== The
     * row's old trend word came from `motionTrend`, which needs `headingDeg`
     * and `speedKt` — fields GDACS never publishes. So every unmatched GDACS
     * storm showed no trend at all, and the column meant something different
     * depending on which agency happened to be warning. A track's OWN minimum
     * has no such asymmetry: `data/gdacs-points.js` emits the same
     * `{lon, lat, time, windKt, tau}` shape `data/nhc-mapserver.js` does, so
     * this answers identically for a hurricane off Florida and a typhoon east
     * of Japan.
     *
     * NOTHING IS FETCHED HERE. `data/warm.js` already pulls geometry for every
     * live storm on every poll, both sources — the bundle is sitting in
     * data/cache.js by the time anybody scrolls the list. Measured 2026-08-10:
     * `closestApproach` costs 0.2 ms per storm, so a fifteen-storm list pays
     * ~3 ms per render. That is why this is not memoized.
     *
     * FIVE STATES, BECAUSE FOUR OF THEM ARE DIFFERENT SILENCES (§5). The row
     * shows a trajectory only for `ok`; the other four render nothing there
     * and the detail panel carries the reason. `pending` in particular is not
     * a failure — it is the ordinary half-second before the warm lands, and
     * dressing it as one would put an error on every row at boot.
     *
     * @returns {{state:'ok'|'pending'|'none'|'unavailable'|'unsupported'} & object|null}
     */
    approachTo(storm) {
      if (!storm || !getHome()) return null;
      /* Asked before the cache, because it is a fact about the SOURCE rather
       * than about our fetching. GDACS answers true here; only a source that
       * publishes no track at all lands in this branch. */
      if (storm.can?.forecastPoints === false) return { state: 'unsupported' };

      const bundle = getGeometry(storm.id);
      if (!bundle) return { state: 'pending' };
      if (bundle.error) return { state: 'unavailable' };

      /* An ENDED or SILENT storm reaches here with a deliberately emptied
       * bundle (app/bundle-pipeline.js), so it lands in `none` and the row
       * says nothing about where it is going. That is the correct answer:
       * there is no live forecast to project. */
      const forecast = Array.isArray(bundle.forecast) ? bundle.forecast : [];
      if (!forecast.length) return { state: 'none' };

      const ca = closestApproach({ ...storm, forecast });
      return ca ? { state: 'ok', ...ca } : { state: 'none' };
    },
  };

  /**
   * WHICH WAY EACH STORM IS TRAVELLING, for the list's arrow (SPEC-UI §16.4).
   *
   * ==> NOT PART OF `homeApi`, AND THE SEPARATION IS THE POINT. <== Everything
   * on that object is a fact about the storm RELATIVE TO A HOUSE and returns
   * null without one. A heading is a fact about the storm alone: it is the
   * same number for a reader in New Orleans and a reader in Guam, and it is
   * still the right answer for someone who has never set a home. Folding it in
   * there would have made the arrow disappear on the setup screen for no
   * reason anybody could have found later.
   *
   * SAME CACHE, NO FETCH, same reasoning as `approachTo` above — data/warm.js
   * has already pulled geometry for every live storm by the time anybody
   * scrolls the list, and the walk is bounded to MOTION.maxProbePoints so the
   * per-row cost is a handful of great-circle distances.
   */
  const motionApi = {
    headingOf(storm) {
      if (!storm) return null;
      const bundle = getGeometry(storm.id);
      /* An ENDED or SILENT storm arrives here with a deliberately emptied
       * bundle (app/bundle-pipeline.js), so it falls back to whatever motion
       * the agency published in its last advisory and to no arrow at all when
       * there was none. Correct either way: the last published heading is a
       * true statement about the last fix, and the row already says the
       * updates have stopped. */
      return motionHeading(storm, bundle?.forecast || null);
    },
  };

  const drawer = createDrawer({ root: document.getElementById('drawer') });

  /* Per-layer runtime status for the Layers view (§7: every row shows its own
   * state). The decisions live in app/layer-status.js, where they can be
   * tested — two §5 silences got through while they were closure-bound.
   *
   * Built from a callback into `layersView`, which does not exist for another
   * eighty lines. Lazy by being an arrow, which is the same trick that keeps
   * the whole knot from needing a construction order nobody can change. */
  const layerStatus = createLayerStatus(() => layersView.refresh());

  /** Recompute the model-guidance row. Everything it needs is passed in; that
   *  module has no business knowing where storms come from. */
  function refreshModelStatus() {
    layerStatus.refreshModelTracks({
      on: toggleOn('modelTracks'),
      selected: pipeline.selected(),
      storms: storms(),
      deckFor: getAdeck,
    });
  }

  /* `offsetWidth/Height` ignore the slide transform, so the measurement is
   * stable mid-animation, and there is no duplicated 340px/60vh constant to
   * drift from the CSS. */
  const panelOffset = () =>
    panelOffsetFor({
      ...drawer.box(),
      wide: window.matchMedia('(min-width: 720px)').matches,
    });

  /**
   * ==> THE SAME OFFSET, BUT ONLY IF A DRAWER IS ACTUALLY UP. <==
   *
   * `panelOffset` above measures the drawer whether it is on screen or slid
   * away, and that is correct for its callers: every one of them opens the
   * drawer in the same breath, so they are asking "where will the sheet be".
   *
   * A flight that opens nothing is asking a different question — "where is the
   * sheet right now" — and for that a closed drawer must contribute zero, or
   * the camera shoves home up into the top half of an empty screen for a panel
   * nobody can see.
   */
  const openPanelOffset = () => (drawer.isOpen() ? panelOffset() : [0, 0]);

  /**
   * Where the camera goes when the Home drawer opens: framed on the HOUSE AND
   * THE STORM TOGETHER, sharing the space above the sheet. The reasoning, the
   * antimeridian handling, and what happens when the pair is too far apart to
   * frame are all in map/home-frame.js.
   *
   * THE OFFSET IS THE SAME ONE EVERY OTHER FLIGHT USES, so the pair's midpoint
   * lands in the visible strip rather than behind the sheet that just opened —
   * and `visibleStrip` subtracts the same drawer box again when choosing the
   * zoom, so the two agree about how much globe there is. Those two have to be
   * read together: the offset decides WHERE the centre sits, the strip decides
   * how much has to fit around it, and a change to one without the other puts
   * an end of the pair under the panel.
   */
  const frameHome = (storm) => {
    const frame = homeFrame({
      home: getHome(),
      storm,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      drawerBox: {
        ...drawer.box(),
        wide: window.matchMedia('(min-width: 720px)').matches,
      },
    });
    if (!frame) return; // no home set — nothing to frame against, nothing moves
    idle.interrupt(); // or the drift's per-frame setCenter stomps the flight
    flyToPoint(map, frame.center, { zoom: frame.zoom, offset: panelOffset() });
  };

  const selectDeps = {
    count: countAction,
    idle,
    pipeline,
    drawer,
    fly: (storm) => flyToStorm(map, storm, { offset: panelOffset() }),
    refreshModelStatus,
  };
  const selectStorm = (storm) => runSelect(storm, selectDeps);
  /* Same deps minus the drawer — the caller is already in a drawer view and
   * means to stay there. */
  const focusStorm = (storm) => runFocus(storm, selectDeps);

  const recenterDeps = {
    count: countAction,
    drawer,
    pipeline,
    refreshModelStatus,
    idle,
    goHome: () => recenter(map, recenterTarget(getHome())),
  };
  const recenterAndClear = () => runRecenter(recenterDeps);

  /* --- the five views ------------------------------------------------------ */

  const areaDetailView = createAreaDetailView();

  /** Fly to a watched area.
   *
   *  `flyToPoint`, NOT `flyToStorm`, AND AT A WIDER ZOOM. A storm is a point
   *  and `GLOBE.flyToZoom` frames it. A development region is 8-22° across
   *  (measured on the live outlook, 2026-08-09) — arriving at storm zoom puts
   *  the camera inside the patch, where a soft hatch fills the screen and
   *  reads as a rendering fault rather than as a region. `GENESIS.flyToZoom`
   *  frames the whole shape with its coastline. */
  const flyArea = (area) =>
    flyToPoint(map, area.centroid, {
      zoom: GENESIS.flyToZoom,
      /* ==> THE SAME OFFSET A STORM GETS. <== Selecting an area opens the
       * drawer over the map, so the target has to land in the VISIBLE globe
       * area rather than the centre of the viewport. Without this it flew
       * centred and arrived behind the drawer on a phone, where the panel
       * takes the bottom 60% — the area was on screen and under your thumb.
       * Caught on glass 2026-08-09; it looked right on a desktop the whole
       * time, because at wide widths the drawer is a side rail and the
       * horizontal offset it wants is much smaller. */
      offset: panelOffset(),
    });

  /** Mark the patch as picked. Fill and edge weight step up; the HUE never
   *  moves, so risk can never be inferred from selection state. */
  const markArea = (id) => setGenesisSelection(map, id);

  const selectArea = (area) =>
    runSelectArea(area, {
      count: countAction,
      idle,
      drawer,
      flyArea,
      markArea,
    });

  const stormsView = createStormsView({
    pill: document.getElementById('storm-pill'),
    onSelect: selectStorm,
    onSelectArea: selectArea,
    onRetry: () => {
      countAction('retry');
      return refresh();
    },
    home: homeApi,
    motion: motionApi,
    units: unitSystem,
  });

  /* `activeLayerLabels` lived here and is GONE (2026-07-25). It fed the storm
   * detail panel's Layers shortcut with a summary of what was drawn; the
   * shortcut was removed because Layers has one door — the floating button,
   * which is on screen the whole time that panel is open. Deleted rather than
   * left behind: a function nothing calls is a function that rots. */

  const detailView = createStormDetailView({
    home: { get: getHome, distanceTo, closestApproach },
    units: unitSystem,
    /* THE STEPPER READS THE LIST'S ORDER, IT DOES NOT RECOMPUTE IT. Passed as
     * a function, not an array: the list re-sorts on every poll and on every
     * home change, and a captured snapshot would step through an order that
     * stopped being true minutes ago. `stormsView` is built above this, so
     * the reference is live by the time anything can press a chevron. */
    siblings: () => stormsView.orderedStorms(),
    /* EXACTLY WHAT A LIST ROW DOES. Stepping is selecting — the camera flies,
     * the geometry loads, the guidance row recomputes — and `drawer.push`
     * re-enters this same view with the new storm rather than stacking a
     * second copy, so Back still lands where the reader came in. */
    onStep: (storm) => selectStorm(storm),
    onRetryGeometry: (storm) => {
      countAction('retry');
      return pipeline.load(storm, { retry: true });
    },
    /* The advisory-text facade. ui/ never imports data/ (§12), and this is
     * deliberately the whole of it: the view awaits a record and renders one
     * of four states. No fetching, no caching, no source branching up there. */
    /* Counted here because the detail view only calls this when the advisory
     * section is actually opened — it is the deepest read the app offers, and
     * the clearest signal that somebody wanted the words and not just the
     * picture. */
    loadAdvisory: (storm, opts) => {
      countAction('advisory_open');
      return fetchAdvisory(storm, opts);
    },
  });
  detailView.setChromeRefresh(() => drawer.refreshChrome());

  const layersView = createLayersView({
    prefs: {
      get: getLayers,
      pairValue,
      toggleOn,
      /* ==> COUNTED AT THE VIEW BOUNDARY, NOT INSIDE THE PREFS MODULE. <==
       * data/layer-prefs.js is also driven by boot, by restyles, and by the
       * exclusive-pair enforcement calling itself — counting in there would
       * report the app's own housekeeping as user activity. Only what arrives
       * through the Layers UI is a person doing something, and this object is
       * exactly that boundary. Spread args so a signature change upstream
       * cannot silently drop a parameter here. */
      setPair: (...args) => {
        countAction('layer_pair');
        return setPair(...args);
      },
      setToggle: (...args) => {
        countAction('layer_toggle');
        return setLayerPref(...args);
      },
      resetLayers: (...args) => {
        countAction('layer_reset');
        return resetLayers(...args);
      },
      isDefault: layersAreDefault,
      subscribe: subscribeLayers,
      pairLiveOptions,
      modelChecked,
      modelsOnCount,
      modelsOnInFamily,
      setModel: (...args) => {
        countAction('model_toggle');
        return setModel(...args);
      },
      /* WHICH MODEL GROUPS THE PICKER SHOWS IS A FUNCTION OF WHAT IS ON
       * SCREEN, so it is computed here — the layers view has no storm list
       * and should not grow one for this. The mapping and its empty case are
       * `familiesForStorms` above, where a test can reach them. */
      modelSelectorGroups: () => modelSelectorGroups(familiesForStorms(storms())),
    },
    /* Model tracks is the first layer to fetch anything of its own, so this
     * finally carries real state — the row machinery has been built and
     * unexercised since the panel landed (§7). */
    getLayerStatus: () => layerStatus.value(),
    onRetry: (key) => {
      if (key === 'modelTracks') {
        /* Re-toggling an errored row means TRY AGAIN (§7 — the toggle IS the
         * recovery). Dropping the cached failure is what makes the warm loop
         * refetch instead of serving the same error back.
         *
         * ==> THIS CALLS THE SAME WARM main.js CALLS, NOT warmModelTracks. <==
         * The warm loop excludes ENDED storms — their a-deck is gone from the
         * ATCF directory, so warming one spends a request to be told nothing
         * and records a source failure for a storm that has simply finished.
         * Reaching for the raw fetcher here made this the one path that did NOT
         * know that rule, and a rule with one exception is not a rule. */
        const sel = pipeline.selected();
        if (sel) evictAdeck(sel.advisoryKey);
        refreshModelStatus();
        warmDecks();
        return;
      }
      if (key === 'imagery') {
        /* Tapping the live segment of an errored imagery row means retry —
         * the segment IS the recovery, same rule as the toggles. Clearing the
         * failure flags is what lets the refetch happen instead of the module
         * serving its cached failure straight back. */
        imagery()?.retry();
        return;
      }
      const sel = pipeline.selected();
      if (sel) pipeline.load(sel, { retry: true });
    },
  });

  const settingsView = createSettingsView({
    /* What AUTO currently means, for the explanatory line under the control.
     * Deliberately `resolveSystem(null)` — the DEVICE's answer, ignoring the
     * stored preference — because the sentence it feeds is "your device is set
     * to X", and passing the preference in would make it say "your device is
     * set to" whatever the user just overrode it with. */
    resolvedUnits: () => resolveSystem(null),
    /* The SAME install seam the first-run nudge uses (ui/first-run.js), not a
     * second one. The nudge is one-time by design and never returns; Settings
     * is the permanent door for anyone who dismissed it or whose browser
     * announced installability after the moment had passed. One seam, two
     * surfaces — a second install path would drift from this one. */
    install: {
      isInstalled,
      canPromptInstall,
      needsManualInstall,
      onInstallReady,
      requestInstall,
    },
  });

  /* --- home: marker, provisional pin, setup panel ------------------------- */

  /* The marker is a DOM overlay driven by MapLibre's projection, so it works
   * across BOTH engines and the whole crossfade — see marker-home.js. */
  const homeMarker = createHomeMarker(map, {
    /* NOT the map's canvas container: #globe is faded to opacity 0 by the dive
     * at the planet band, and opacity on a parent hides everything inside it.
     * Same trap the attribution control fell into (see index.html). */
    container: document.getElementById('home-layer-host'),
    /* Tapping the off-screen pointer brings home into view. Zoom is left
     * alone deliberately: the user picked that zoom, and the pointer's job is
     * "rotate the globe to home", not "take me somewhere else". */
    onPointerActivate: (home) => {
      idle.interrupt();
      /* ==> `openPanelOffset`, NOT `panelOffset`. <== This tap opens nothing.
       * If a drawer happens to be up, home has to land in the strip beside or
       * above it; if nothing is open, the whole viewport is the strip and the
       * offset must be zero. `panelOffset` cannot answer that — it measures the
       * drawer whether or not it is on screen. */
      flyToPoint(map, home, { offset: openPanelOffset() });
    },
    /* ==> TAPPING THE HOUSE IS A HOME BUTTON PRESS, AND NOTHING ELSE. <==
     *
     * It moves no camera of its own. It opens the Home dashboard, and the
     * dashboard's own opening flight frames the house together with the storm
     * it is about (§9.16) — the same answer you get from the Home button in
     * the control cluster, because it is the same code path.
     *
     * TWO RICHER VERSIONS OF THIS WERE BUILT AND BOTH WERE WRONG. The first
     * committed to `GLOBE.homeZoom` and suppressed the drawer's framing
     * flight, so the house tap was the one entrance to Home that never showed
     * you the storm. The second made it a two-stage gesture — house first,
     * pair on a second tap — which answered that but put two meanings on one
     * control and made "what happens when I press this" depend on invisible
     * state. Aaron judged both on glass. A control with one meaning beats a
     * clever one, and the recenter crosshair already exists for anyone who
     * wants the camera on their house and nothing else.
     *
     * DEFERRED TO THE NEXT FRAME, deliberately. `drawer.go` moves focus into
     * the drawer, and doing that inside the marker's own click handler steals
     * focus from the button mid-activation — a keyboard user pressing Enter on
     * the house would land somewhere they did not ask to be. */
    onMarkerActivate: () => {
      idle.interrupt();
      requestAnimationFrame(() => {
        drawer.go('home', undefined, { from: document.getElementById('btn-home') });
      });
    },
  });

  const provisionalPin = createProvisionalPin(map);

  const homeSetupView = createHomeSetupView({
    onPreview: (lonlat, { zoom, onMove } = {}) => {
      idle.interrupt();
      provisionalPin.show(lonlat, { onChange: onMove });
      /* `zoom` undefined means KEEP the current zoom — that is the drop-a-pin
       * path, where the pin is already at the centre of the view the user
       * framed and pulling the camera would move the ground under it. */
      flyToPoint(map, lonlat, { zoom });
    },
    getProvisional: () => provisionalPin.get(),
    /* Where the drop-a-pin button puts the pin. Read at tap time, never
     * cached — the user may have spun the globe since the view opened. */
    getViewCenter: () => {
      const c = map.getCenter();
      return { lon: c.lng, lat: c.lat };
    },
    /* IS THIS POINT ON WATER — asked of the basemap that is already drawn, not
     * of the geocoder, which has no marine data and answers "nothing here" for
     * the open Atlantic and the Sahara alike. Injected for the same reason
     * `getViewCenter` is: ui/ never imports map/ (§12). */
    probeWater: (lonlat) => waterAt(map, lonlat),
    onCancelPreview: () => provisionalPin.hide(),
    onCommit: () => {
      /* subscribeHome below pushes the new position into the marker — no
       * second update call here, so there is exactly one path that moves it. */
    },
    /* Home is set; the flow this view exists for is finished. Counted at
     * completion rather than on every keystroke of the search box, and it
     * records ONLY THAT IT HAPPENED — never the place. Home coordinates do
     * not leave the device, and this is exactly the kind of field where that
     * promise would get broken by accident. */
    onDone: () => {
      countAction('home_set');
      /* ==> BACK TO THE DASHBOARD, NOT OUT OF THE DRAWER. <== Setting a home
       * used to be the end of the interaction because there was nothing to
       * return to. Now there is, and it is the thing the user was trying to
       * reach: closing here would drop them on the globe and make them tap
       * the same button again to see what they just unlocked. */
      if (drawer.canGoBack()) drawer.back();
      else drawer.go('home', undefined, { from: document.getElementById('btn-home') });
    },
  });

  /* THE DASHBOARD OWNS THE `home` ROUTE; the setup flow above is `home-setup`
   * and is pushed onto it, so Back lands where you came from. */
  const homeDashView = createHomeDashboardView({
    units: () => unitSystem(),
    onEditHome: () => drawer.push('home-setup'),
    /* Tapping the storm's name is a request to GO to it — camera, cone, the
     * detail panel. That is `selectStorm`, exactly as a list row does, so
     * there is one selection path and not a second one that forgets a step. */
    onOpenStorm: (storm) => selectStorm(storm),
    /* Stepping with a chevron is a request to LOOK at it, not to go to it.
     * Same selection, same camera flight, same drawn cone — minus the drawer
     * push, so the reader stays on the dashboard they are stepping through. */
    onFocusStorm: (storm) => focusStorm(storm),
    /* Cache-first geometry with NO camera move and NO selection. See the long
     * note on `warm` in app/bundle-pipeline.js for why this is not `load`. */
    warmGeometry: (storm) => pipeline.warm(storm),
    /* Opening the drawer frames the house against the storm it is about.
     * `frameHome` owns the whole decision, including declining to move. */
    onFrameHome: ({ storm }) => frameHome(storm),
  });

  /* ==> AFTER `homeDashView` EXISTS, AND THAT IS NOT A STYLE POINT. <== This
   * sat beside `detailView.setChromeRefresh` eighty lines up, which is before
   * the const is initialised — a temporal dead zone throw that took the whole
   * boot down with "Landfall could not start". Nothing static caught it: every
   * module parsed, every import resolved, and all 46 suites passed, because the
   * failure only exists once this function actually runs. A browser check did.
   *
   * The dashboard titles itself with a STORM now (SPEC-UI §16.5), so its header
   * goes stale on the same polls its body does — a category change moves the
   * swatch, and a re-pick moves the whole name. */
  homeDashView.setChromeRefresh(() => drawer.refreshChrome());

  for (const v of [stormsView, detailView, areaDetailView, layersView,
                   homeDashView, homeSetupView, settingsView]) {
    drawer.register(v);
  }

  /** The home marker is a LAYER now (§7, Reference group), so it draws only
   *  when both a home exists AND its toggle is on. The marker itself has no
   *  visibility concept — setHome(null) clears it — so the gate lives here
   *  rather than adding a second way to hide the same thing. */
  function applyHomeMarker(home = getHome()) {
    homeMarker.setHome(toggleOn('homeMarker') ? home : null);
  }

  /* One subscription owns everything that reacts to home changing, whatever
   * caused it: the view, a cleared home, or a future settings screen.
   *
   * REGISTERED LAST, and that is not cosmetic: data/home.js fires the callback
   * IMMEDIATELY at registration, and the callback reads the marker and both
   * views. Register it earlier in this function and the first fire lands in
   * the temporal dead zone — a boot crash, not a subtle bug. */
  subscribeHome((home) => {
    applyHomeMarker(home);
    /* The dashboard IS a home-relative screen — every figure on it moves. */
    homeDashView.homeChanged();
    /* Setting or clearing home changes the scope filter's availability, the
     * sort order, and every distance on screen — so the list needs a full
     * rebuild, not a patch. */
    stormsView.homeChanged();
    /* The detail view's home block appears/disappears with home itself. */
    const state = fullState();
    if (state) detailView.update(state);
  });

  /* `settingsView`, `homeSetupView` and `provisionalPin` are deliberately NOT
   * returned. Nothing outside this file talks to them — they are reached
   * through the drawer and through the callbacks above — and returning a
   * handle nobody holds is an invitation to start wiring around the drawer.
   *
   * `homeDashView` IS returned, and only because main.js has to drive it on
   * every poll and on a units change, exactly as it drives the storm list. */
  return {
    drawer,
    stormsView,
    homeDashView,
    detailView,
    areaDetailView,
    layersView,
    homeMarker,
    selectStorm,
    selectArea,
    recenterAndClear,
    refreshModelStatus,
    applyHomeMarker,
    /** map/imagery.js reports its row state through here (installOnStyle). */
    setImageryStatus: (row) => layerStatus.setImagery(row),
  };
}
