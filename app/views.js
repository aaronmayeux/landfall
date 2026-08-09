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
import { setGenesisSelection } from '../map/layers/genesis.js';
import { GENESIS } from '../config/constants.js';
import { createHomeMarker } from '../map/marker-home.js';
import { createProvisionalPin } from '../map/pin-provisional.js';
import { createDrawer } from '../ui/drawer.js';
import { createStormsView } from '../ui/view-storms.js';
import { createStormDetailView } from '../ui/view-storm-detail.js';
import { createAreaDetailView } from '../ui/view-area-detail.js';
import { createHomeView } from '../ui/view-home.js';
import { createLayersView } from '../ui/view-layers.js';
import { createSettingsView } from '../ui/view-settings.js';
import { createLayerStatus } from './layer-status.js';
import {
  subscribeHome,
  getHome,
  distanceTo,
  closestApproach,
  motionTrend,
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
import { fetchAdvisory } from '../data/advisory.js';
import { refresh } from '../data/store.js';
import { settingValue } from '../data/settings-prefs.js';
import { resolveSystem } from '../lib/units.js';
import { count as countAction } from '../lib/usage.js';
import { GLOBE, MODEL_FAMILY } from '../config/constants.js';
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
    motionTrend,
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

  const selectDeps = {
    count: countAction,
    idle,
    pipeline,
    drawer,
    fly: (storm) => flyToStorm(map, storm, { offset: panelOffset() }),
    refreshModelStatus,
  };
  const selectStorm = (storm) => runSelect(storm, selectDeps);

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
    flyToPoint(map, area.centroid, { zoom: GENESIS.flyToZoom });

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
      flyToPoint(map, home);
    },
    /* Tapping the ON-GLOBE marker is a DIFFERENT request and gets a different
     * answer. The pointer means "home is somewhere off screen, show me where"
     * — a rotation. The house sitting on the globe in front of you means "take
     * me to my house", and answering that without changing zoom would be a
     * flight to a place already on screen, i.e. nothing visibly happening.
     * So this one commits to GLOBE.homeZoom. */
    onMarkerActivate: (home) => {
      idle.interrupt();
      flyToPoint(map, home, { zoom: GLOBE.homeZoom });
    },
  });

  const provisionalPin = createProvisionalPin(map);

  const homeView = createHomeView({
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
      drawer.close();
    },
  });

  for (const v of [stormsView, detailView, areaDetailView, layersView, homeView, settingsView]) {
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
    /* Setting or clearing home changes the scope filter's availability, the
     * sort order, and every distance on screen — so the list needs a full
     * rebuild, not a patch. */
    stormsView.homeChanged();
    /* The detail view's home block appears/disappears with home itself. */
    const state = fullState();
    if (state) detailView.update(state);
  });

  /* `settingsView`, `homeView` and `provisionalPin` are deliberately NOT
   * returned. Nothing outside this file talks to them — they are reached
   * through the drawer and through the callbacks above — and returning a
   * handle nobody holds is an invitation to start wiring around the drawer. */
  return {
    drawer,
    stormsView,
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
