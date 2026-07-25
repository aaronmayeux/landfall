/**
 * main.js — WIRING ONLY.
 *
 * SPEC §12: "main.js  wiring only." No globe logic, no fade math, no parsing —
 * those live in map/ and data/. This file stands the pieces up and points them
 * at each other.
 *
 * The model: MapLibre owns the one zoom and the one camera. The Three.js clear
 * globe (map/globe3d.js) is a pure overlay slaved to it, crossfading out as
 * you zoom in. Phase 2 adds the data spine: store.js polls NHC (via the relay)
 * and GDACS (direct), merges client-side, and everything on screen — markers,
 * the storm list, the status strip, the 3D cage — SUBSCRIBES to it.
 */

import { DARK, FONT, SIZE, SPACE } from './config/tokens.js';
import {
  createGlobe,
  attachIdleRotation,
  attachKeyboard,
  attachEscape,
  recenter,
  flyToStorm,
  flyToPoint,
} from './map/globe.js';
import { setGraticuleVisible } from './map/graticule.js';
import { setAdminVisible } from './map/style-dark.js';
import { setStatus, sourceHealthMessage } from './ui/status.js';
import { createGlobe3d } from './map/globe3d.js';
import { addStormMarkers, stormAtPoint } from './map/markers.js';
import { createDrawer } from './ui/drawer.js';
import { createStormsView } from './ui/view-storms.js';
import { createStormDetailView } from './ui/view-storm-detail.js';
import { createHomeView } from './ui/view-home.js';
import { createLayersView } from './ui/view-layers.js';
import { createSettingsView } from './ui/view-settings.js';
import { createFirstRun } from './ui/first-run.js';
import {
  isInstalled,
  canPromptInstall,
  needsManualInstall,
  onInstallReady,
  requestInstall,
} from './pwa.js';
import { createHomeMarker } from './map/marker-home.js';
import { createProvisionalPin } from './map/pin-provisional.js';
import { createLayerEngine } from './map/layers/index.js';
import { fetchStormGeometry, geometryLagged } from './data/nhc-mapserver.js';
import { fetchGdacsGeometry } from './data/gdacs-geometry.js';
import { getGeometry, putGeometry, evictGeometry } from './data/cache.js';
import { warmGeometry } from './data/warm.js';
import { warmModelTracks, getAdeck, evictAdeck } from './data/adeck.js';
import { tracksToFeatures } from './lib/adeck.js';
import { settingValue, subscribeSettings } from './data/settings-prefs.js';
import { buildMeshPoints } from './map/storm-mesh.js';
import { startPolling, subscribe, refresh, overallStatus } from './data/store.js';
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
  modelOn,
  modelChecked,
  modelsOnCount,
  setModel,
} from './data/layer-prefs.js';
import { LAYER_TOGGLES, LAYER_PAIRS, isLive } from './config/layers.js';
import {
  subscribeHome,
  getHome,
  distanceTo,
  closestApproach,
  motionTrend,
  filterByScope,
  availableScopes,
} from './data/home.js';
import { resolveSystem } from './lib/units.js';

/** Push tokens.js values into CSS custom properties. CSS can't import a JS
 *  module, so the <style> block in index.html holds first-paint fallbacks and
 *  this overwrites them from the real source. tokens.js stays the one truth. */
function applyTokens() {
  const r = document.documentElement.style;
  r.setProperty('--ocean', DARK.ocean);
  r.setProperty('--space', DARK.space);
  r.setProperty('--space-near', DARK.spaceNear);
  r.setProperty('--space-far', DARK.spaceFar);
  r.setProperty('--text-primary', DARK.textPrimary);
  r.setProperty('--text-secondary', DARK.textSecondary);
  r.setProperty('--text-muted', DARK.textMuted);
  r.setProperty('--glass', DARK.glass);
  r.setProperty('--glass-raised', DARK.glassRaised);
  r.setProperty('--glass-border', DARK.glassBorder);
  r.setProperty('--glass-shadow', DARK.glassShadow);
  r.setProperty('--focus-ring', DARK.focusRing);
  r.setProperty('--error', DARK.error);
  r.setProperty('--stale', DARK.stale);
  r.setProperty('--font-ui', FONT.ui);
  r.setProperty('--font-numeric', FONT.numeric);
  r.setProperty('--touch-target', SIZE.touchTarget);
  r.setProperty('--radius', SIZE.radius);
  r.setProperty('--radius-large', SIZE.radiusLarge);
  r.setProperty('--space-tight', SPACE.tight);
  r.setProperty('--space-snug', SPACE.snug);
  r.setProperty('--space-base', SPACE.base);
  r.setProperty('--space-comfy', SPACE.comfy);
}

/* --- status strip precedence -------------------------------------------------
 * One strip, several claimants. Explicit order, not last-handler-wins:
 *   tile error  >  feed outage / stale  >  quiet
 */
function makeStatusArbiter() {
  let tileError = false;
  let feed = null; // {message, tone} | null

  const render = () => {
    if (tileError) return setStatus('Basemap tiles are not loading', 'error');
    if (feed) return setStatus(feed.message, feed.tone);
    setStatus(null);
  };

  return {
    tileError() { tileError = true; render(); },
    feedHealth(msg) { feed = msg; render(); },
  };
}

/* NOTE: no pmtiles protocol registration here anymore. The R2 basemap is
 * plain tile URLs into the Pages Function tile proxy (SPEC §11); the client
 * never reads the .pmtiles format. A proxy failure surfaces through the
 * ordinary map error path -> status.tileError(). */

function boot() {
  applyTokens();

  /* Two engines: MapLibre on #globe (the input surface, hidden behind at
   * opacity 0 in space), the Three.js clear globe overlay on #gl (pointer-
   * events:none, purely visual). */
  const globeEl = document.getElementById('globe');
  const map = createGlobe(globeEl);
  const g3d = createGlobe3d(document.getElementById('gl'), map, {
    mapEl: globeEl,
    spaceEl: document.getElementById('spacebg'),
  });

  const idle = attachIdleRotation(map);
  /* The container, not the inner canvas — it carries role="application", the
   * aria-label, and the focus ring (SPEC §10). */
  attachKeyboard(map, globeEl);

  /* --- Phase 4: selection = fly + detail panel + per-storm geometry -------- */

  const engine = createLayerEngine(map);
  let styleReady = false; // engine may only touch the style after style.load
  let selected = null;    // the storm the geometry pipeline is serving
  let selectedBundle = null; // its geometry, held so model tracks can re-push
  let geometrySeq = 0;    // stale-response guard: last selection wins
  /* Declared HERE, not at the store subscription below: subscribeHome fires
   * its callback IMMEDIATELY at registration (data/home.js), and that
   * callback reads this. Declaring it later puts the first fire in the
   * temporal dead zone — a boot crash, not a subtle bug. */
  let lastFullState = null;

  /* Layer state lives in data/layer-prefs.js — persistence, exclusive-pair
   * enforcement, and the rule that an unshipped layer can never be switched
   * on. main.js only APPLIES it to the map. Two hand-rolled localStorage
   * functions and a loose `let graticuleOn` used to live here; sixteen layers
   * on that pattern is a drift bug waiting to happen (§12). */

  /** One-shot flyTo OFFSET from the DRAWER's REAL box (§16: center the storm
   *  on the visible globe area). offsetWidth/Height ignore the slide
   *  transform, so the values are stable mid-animation, and there is no
   *  duplicated 340px/60vh constant to drift from the CSS. Offset semantics:
   *  where the target center lands relative to container center — the left
   *  rail pushes the storm right by half the rail; the bottom sheet pushes
   *  it up by half the sheet. (Persistent `padding` is FORBIDDEN — it
   *  desyncs the two globes; see the scar-tissue note on flyToStorm.) */
  function panelOffset() {
    const { width, height } = drawer.box();
    return window.matchMedia('(min-width: 720px)').matches
      ? [width / 2, 0]
      : [0, -height / 2];
  }

  /** Selection: tap a dot, tap a row, Enter on a focused row — identical
   *  (§16). The drawer swaps to the detail view and the camera flies
   *  TOGETHER, not sequentially. */
  function selectStorm(storm) {
    /* Selection can come from the drawer (off-canvas), so the idle drift
     * never sees a gesture — interrupt it explicitly or its per-frame
     * setCenter stomps the flyTo. Also resets the auto-rotate clock, as any
     * interaction does. */
    idle.interrupt();
    selected = storm;
    selectedBundle = null;
    /* The row describes the SELECTED storm's guidance, so it has to be
     * recomputed the moment the selection changes — before any fetch, so a
     * cache hit shows its state instantly rather than flashing "loading". */
    refreshModelStatus();
    drawer.push('detail', storm);
    flyToStorm(map, storm, { offset: panelOffset() });
    loadGeometry(storm);
  }

  /** The geometry pipeline: cache → fetch → layers + panel. Every exit path
   *  checks `seq` so a slow response for storm A never paints over storm B. */
  async function loadGeometry(storm, { retry = false } = {}) {
    const seq = ++geometrySeq;

    /* Both sources have geometry now (§14's both-sources rule). They return
     * the SAME bundle shape, so everything downstream — layers, panel — is
     * source-blind and this is the only place that has to know the
     * difference. */
    const fetchGeometry =
      storm.source === 'gdacs' ? fetchGdacsGeometry : fetchStormGeometry;

    if (storm.source !== 'nhc' && storm.source !== 'gdacs') {
      /* An unknown source is nothing to draw, not an error — the panel's
       * `can` branches say why. */
      if (styleReady) engine.clearSelection();
      detailView.setGeometry({
        state: 'ok',
        bundle: { layers: {}, forecast: [], stamp: { advisnum: null, filedate: null } },
        lagged: false,
      });
      return;
    }

    const key = storm.advisoryKey;
    /* Failures are cached so a dead layer never refetches per render — and
     * re-selection (or the Retry button) clears them: the toggle is the
     * recovery (§5/§7). A NEW advisory needs no eviction at all; the key
     * itself changes. */
    const cached = getGeometry(key);
    if (cached?.error || retry) evictGeometry(key);
    let bundle = !retry && cached && !cached.error ? cached : null;

    if (!bundle) {
      detailView.setGeometry({ state: 'loading' });
      try {
        bundle = await fetchGeometry(storm);
        putGeometry(key, bundle);
      } catch (e) {
        console.warn('[landfall] storm geometry failed:', e?.message || e);
        putGeometry(key, { error: e?.message || 'failed' });
        if (seq !== geometrySeq) return;
        if (styleReady) engine.clearSelection();
        detailView.setGeometry({ state: 'error', error: e?.message || 'failed' });
        return;
      }
    }

    if (seq !== geometrySeq) return; // user moved on while we fetched
    /* The apply step is guarded separately from the fetch: an exception in a
     * layer's update (bad geometry, style edge case) must degrade to a NAMED
     * error, not strand the panel at "loading" forever with an unhandled
     * rejection only a desktop console would ever see. */
    selectedBundle = bundle;
    try {
      if (styleReady) {
        engine.setBundle(storm, withModelTracks(storm, bundle));
        applyLayerState();
      }
    } catch (e) {
      console.error('[landfall] applying geometry to layers failed:', e);
      if (styleReady) engine.clearSelection();
      detailView.setGeometry({ state: 'error', error: `draw failed: ${e?.message || e}` });
      return;
    }
    detailView.setGeometry({
      state: 'ok',
      bundle,
      lagged: geometryLagged(storm.observedAt, bundle.stamp),
    });
  }

  /* --- Phase 6 step 5: model guidance tracks -------------------------------
   *
   * The a-deck is fetched and cached by data/adeck.js on its OWN schedule
   * (warmed for every storm while the layer is on), so it lands independently
   * of the MapServer geometry bundle. The map layer, though, reads a bundle
   * slot like every other layer — that is what keeps map/ from importing
   * data/ (§12) and what let the layer register without touching the engine.
   *
   * This function is the join: it hands the engine a bundle with the warmed
   * tracks folded in as one more slot. A SHALLOW COPY, never a mutation — the
   * bundle is a cached object shared with the ambient collections and the
   * cage's ridge builder, and writing into it would leak model tracks into
   * surfaces that never asked for them.
   * ---------------------------------------------------------------------- */
  function withModelTracks(storm, bundle) {
    if (!bundle) return bundle;
    const result = getAdeck(storm.advisoryKey);
    /* Nothing warmed yet is `none` rather than an omission: the slot must
     * exist so the layer's own `status === 'ok'` test resolves to a clean
     * empty rather than reading `undefined` off a missing key. */
    const slot =
      result?.status === 'ok'
        ? {
            status: 'ok',
            /* Filtered by the user's selection HERE rather than in a style
             * expression — see the note in lib/adeck.js. */
            fc: tracksToFeatures(result.tracks, modelOn),
            error: null,
          }
        : { status: result?.status === 'unavailable' ? 'unavailable' : 'none', fc: null, error: result?.error || null };
    return { ...bundle, layers: { ...bundle.layers, modelTracks: slot } };
  }

  /** Re-apply the selected storm's geometry after something OTHER than a new
   *  bundle changed what should be drawn — a deck landing, or the user
   *  changing which models are on. One path, so the map cannot end up showing
   *  a selection state nothing produced. */
  function repushSelected() {
    if (!styleReady || !selected || !selectedBundle) return;
    engine.setBundle(selected, withModelTracks(selected, selectedBundle));
  }

  /**
   * Per-layer runtime status for the Layers view (§7: every row shows its own
   * state). Model tracks is the first layer to actually populate this — the
   * machinery has been built and unexercised since the panel landed.
   *
   * Keyed by PREF key, not engine key, because that is what the row is.
   */
  let layerStatus = {};

  /** The model-tracks row's state, derived from the SELECTED storm's deck.
   *
   * DERIVED FROM ONE STORM ON PURPOSE. Decks are warmed for every storm, but
   * the layer draws the selected one, so a row reporting an aggregate ("2 of
   * 9 failed") would describe something the user cannot see. The row answers
   * "is the thing in front of me working".
   */
  function refreshModelStatus() {
    const next = { ...layerStatus };
    delete next.modelTracks;

    if (toggleOn('modelTracks') && selected) {
      const r = getAdeck(selected.advisoryKey);
      if (!r) {
        next.modelTracks = { state: 'loading' };
      } else if (r.status === 'unavailable') {
        next.modelTracks = { state: 'error', message: 'Model guidance unavailable — tap to retry' };
      } else if (r.status === 'unsupported') {
        /* GDACS. NOT an error and NOT a retry — the source has no such data
         * and never will (§14's standing exception). */
        next.modelTracks = { state: 'empty', message: `No model guidance published for ${selected.name}` };
      } else if (r.status === 'none') {
        next.modelTracks = { state: 'empty', message: 'No guidance published for this storm yet' };
      }
    }

    layerStatus = next;
    layersView.refresh();
  }

  const status = makeStatusArbiter();
  map.on('error', (e) => {
    console.warn('[landfall] map error', e?.error || e);
    status.tileError();
  });

  /* --- the drawer and its views ------------------------------------------- */
  /* Views read home and layer state through injected façades rather than
   * importing data/ themselves — ui/ must not depend on data/ directly
   * (SPEC §12, one-directional imports). main.js owns the wiring. */
  const homeApi = {
    get: getHome,
    distanceTo,
    motionTrend,
    filterByScope,
    availableScopes,
  };

  const drawer = createDrawer({ root: document.getElementById('drawer') });

  const stormsView = createStormsView({
    pill: document.getElementById('storm-pill'),
    onSelect: selectStorm,
    onRetry: () => refresh(),
    home: homeApi,
  });

  /** What is currently drawn for the selected storm, in human words — the
   *  detail view's Layers shortcut shows this so the row is informative
   *  rather than a bare navigation stub. */
  function activeLayerLabels() {
    const out = [];
    for (const p of LAYER_PAIRS) {
      const v = pairValue(p.id);
      const opt = p.options.find((o) => o.value === v);
      /* 'off' segments name nothing — an imagery pair set to Off has no
       * layer to report, and listing "Off" would read as a drawn layer. */
      if (opt && opt.key && isLive(opt)) out.push(opt.label);
    }
    for (const t of LAYER_TOGGLES) {
      if (toggleOn(t.key)) out.push(t.label);
    }
    return out;
  }

  const detailView = createStormDetailView({
    home: { get: getHome, distanceTo, closestApproach },
    /* The one lateral move in the app: Layers opened FROM a storm keeps that
     * storm on the stack, so Back returns to it rather than to the list. */
    onOpenLayers: () => drawer.push('layers'),
    activeLayerLabels,
    onRetryGeometry: (storm) => loadGeometry(storm, { retry: true }),
  });
  detailView.setChromeRefresh(() => drawer.refreshChrome());

  const layersView = createLayersView({
    prefs: {
      get: getLayers,
      pairValue,
      toggleOn,
      setPair,
      setToggle: setLayerPref,
      resetLayers,
      isDefault: layersAreDefault,
      subscribe: subscribeLayers,
      pairLiveOptions,
      modelChecked,
      modelsOnCount,
      setModel,
    },
    /* Model tracks is the first layer to fetch anything of its own, so this
     * finally carries real state — the row machinery has been built and
     * unexercised since the panel landed (§7). */
    getLayerStatus: () => layerStatus,
    onRetry: (key) => {
      if (key === 'modelTracks') {
        /* Re-toggling an errored row means TRY AGAIN (§7 — the toggle IS the
         * recovery). Dropping the cached failure is what makes the warm loop
         * refetch instead of serving the same error back. */
        if (selected) evictAdeck(selected.advisoryKey);
        refreshModelStatus();
        warmModelTracks(lastStorms, onDeckLanded);
        return;
      }
      if (selected) loadGeometry(selected, { retry: true });
    },
  });

  const settingsView = createSettingsView({
    /* Names the CURRENT behaviour — units follow the device until the
     * override is built. "Coming soon" is not actionable; this is. */
    unitSystem: () => resolveSystem(null),
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
  });

  const provisionalPin = createProvisionalPin(map);

  const homeView = createHomeView({
    onPreview: (lonlat, { zoom } = {}) => {
      idle.interrupt();
      provisionalPin.show(lonlat);
      flyToPoint(map, lonlat, { zoom });
    },
    getProvisional: () => provisionalPin.get(),
    onCancelPreview: () => provisionalPin.hide(),
    onCommit: () => {
      /* subscribeHome below pushes the new position into the marker — no
       * second update call here, so there is exactly one path that moves it. */
    },
    /* Home is set; the flow this view exists for is finished. */
    onDone: () => drawer.close(),
  });

  for (const v of [stormsView, detailView, layersView, homeView, settingsView]) {
    drawer.register(v);
  }

  /* One subscription owns everything that reacts to home changing, whatever
   * caused it: the view, a cleared home, or a future settings screen. */
  subscribeHome((home) => {
    applyHomeMarker(home);
    /* Setting or clearing home changes the scope filter's availability, the
     * sort order, and every distance on screen — so the list needs a full
     * rebuild, not a patch. */
    stormsView.homeChanged();
    /* The detail view's home block appears/disappears with home itself. */
    if (lastFullState) detailView.update(lastFullState);
  });

  /** The home marker is a LAYER now (§7, Reference group), so it draws only
   *  when both a home exists AND its toggle is on. The marker itself has no
   *  visibility concept — setHome(null) clears it — so the gate lives here
   *  rather than adding a second way to hide the same thing. */
  function applyHomeMarker(home = getHome()) {
    homeMarker.setHome(toggleOn('homeMarker') ? home : null);
  }

  /** ONE recenter behavior for both entrances (the button and Esc-twice):
   *  recenter is "back to the globe", so it ends the selection too. Closing
   *  the drawer deliberately leaves the geometry drawn (you dismissed it to
   *  look at the map, §16); this is the explicit way off that state. */
  function recenterAndClear() {
    if (drawer.isOpen()) drawer.close();
    geometrySeq++; // cancel any in-flight geometry response
    selected = null;
    selectedBundle = null;
    if (styleReady) engine.clearSelection();
    refreshModelStatus();
    recenter(map);
  }

  /* Escape, once, at the document level (SPEC §10, §13). ONE contract, and
   * with the drawer it finally has one claimant instead of three: step BACK
   * if there is somewhere to go, otherwise close the drawer, otherwise
   * recenter. Back-before-close matters — Esc from Layers-opened-from-a-storm
   * should return to that storm, the same as the back button, rather than
   * dismissing the whole drawer and losing the reading position. */
  attachEscape(map, {
    isPanelOpen: () => drawer.isOpen(),
    closePanel: () => {
      if (!drawer.back()) drawer.close();
    },
    onRecenter: recenterAndClear,
  });

  /* --- markers + data spine ----------------------------------------------- */
  let markers = null;
  let lastStorms = [];

  /** One deck landed during a warm pass. Only the SELECTED storm's deck
   *  changes anything on screen — the rest are warmed so that selecting them
   *  later is instant rather than a spinner (§9's ambient-geometry argument,
   *  applied to a fetch the user did not ask for yet). */
  function onDeckLanded(storm) {
    if (!selected || storm.id !== selected.id) return;
    repushSelected();
    refreshModelStatus();
  }

  /** Warm every storm's deck, but ONLY while the layer is on: fetching
   *  megabytes for a layer nobody switched on is pure data spend on a phone,
   *  and this one ships off. */
  function warmDecksIfOn() {
    if (!toggleOn('modelTracks') || !lastStorms.length) return;
    warmModelTracks(lastStorms, onDeckLanded);
  }

  /** Push the whole layer state onto the map. ONE function, called on every
   *  change, rather than a handler per layer — a per-layer path is how the
   *  graticule ended up with a different mechanism from the forecast times. */
  function applyLayerState() {
    if (!styleReady) return;
    setGraticuleVisible(map, toggleOn('graticule'));
    /* Basemap furniture rides the same one-call path as the graticule —
     * these are style layers, not engine layers, so they have no toggle
     * key the engine would recognise. */
    setAdminVisible(map, { stateNames: toggleOn('stateNames'), cities: toggleOn('cities') });
    /* The engine's key differs from the pref key, so the manifest states the
     * mapping rather than the two being assumed identical. */
    for (const t of LAYER_TOGGLES) {
      if (t.engineKey) engine.setToggle(t.engineKey, toggleOn(t.key));
    }
    /* Exclusive pairs, same shape: every pair pushed on every change rather
     * than a handler per pair. A pair with no layer built yet simply matches
     * no definition in the engine and costs one no-op loop. */
    for (const p of LAYER_PAIRS) {
      engine.setPair(p.id, pairValue(p.id));
    }
  }

  /* style.load, NOT load: 'load' waits on basemap tiles, and a basemap outage
   * must never block the storm layer — live storms drawing on a failed
   * basemap beats no storms at all (SPEC §5: one source down must not blind
   * the other). Our style is inline, so style.load fires regardless of tiles.
   * globe.js's own style.load handler registered first, so the graticule
   * layers exist by the time this one runs. */
  map.once('style.load', () => {
    markers = addStormMarkers(map);
    markers.update(lastStorms);

    /* Selection layers attach AFTER the markers so the beforeId anchor
     * ('storm-dot-planet') exists and the geometry stacks under the dots —
     * severity color stays on top (§6). Same style.load-not-load rule as the
     * markers: a basemap outage must never blind the storm layers (§5). */
    styleReady = true;
    engine.attach();
    applyLayerState();
    /* A selection made before the style was ready replays from cache. */
    if (selected) loadGeometry(selected);

    /* Tap/click a storm dot — same action as a list row (SPEC §16). The 44 px
     * hit box lives in stormAtPoint; cursor feedback rides layer hover.
     * Tapping empty ocean CLOSES the drawer (§16) — the camera and the
     * drawn geometry hold. */
    map.on('click', (e) => {
      const id = stormAtPoint(map, e.point);
      const storm = id && lastStorms.find((s) => s.id === id);
      if (storm) selectStorm(storm);
      else if (drawer.isOpen()) drawer.close();
    });
    /* Cursor feedback. Bound to the layers stormAtPoint actually queries —
     * it used to ride `storm-glyph`, which no longer exists. `mouseenter`
     * needs a layer that is present, so each is bound only if it is there;
     * the forecast layers are created by the layer engine on style load and
     * may not exist on the very first frame.
     *
     * `(hover: hover)` in spirit, not in code: MapLibre simply never fires
     * these on a touch-only device, so no device sniffing is needed and the
     * touch path is untouched (§10). */
    for (const id of ['storm-dot-planet', 'sel-fpoints', 'amb-fpoints']) {
      if (!map.getLayer(id)) continue;
      map.on('mouseenter', id, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', id, () => {
        map.getCanvas().style.cursor = '';
      });
    }
  });

  /* Layer state drives the map, the home marker, and the detail view's
   * shortcut summary. One subscription, fired immediately at registration,
   * so the initial state applies without a separate boot call. */
  subscribeLayers(() => {
    applyLayerState();
    applyHomeMarker();
    detailView.layersChanged();
    /* Switching model tracks on starts the warm; changing WHICH models are on
     * redraws from data already here. Both land through this one
     * subscription, so there is exactly one path from a layer choice to
     * pixels — the same rule the rest of applyLayerState follows. */
    warmDecksIfOn();
    repushSelected();
    refreshModelStatus();
  });

  /**
   * Push the current storms into the 3D cage.
   *
   * Called from THREE places, which is why it is a function and not four
   * inline lines: a new storm list, a geometry bundle landing (the ridge's
   * data arrives later than the storms it belongs to), and the mesh-height
   * setting changing. All three must produce the same cage.
   *
   * On outage it passes null, which makes the heightfield HOLD its last shape
   * and desaturate — never flatten to a fake all-clear (SPEC §5).
   */
  function refreshCage() {
    const state = lastFullState;
    if (!state) return;
    const overall = overallStatus(state);
    if (overall === 'loading') return;
    const pts =
      overall === 'unavailable'
        ? null
        : buildMeshPoints({
            storms: state.storms,
            mode: settingValue('meshHeight'),
            /* The warm cache is the ridge's only source of track data. A miss
             * is normal and honest — the storm keeps its live-fix peak until
             * its bundle lands, at which point the callback above calls back
             * in here (map/storm-mesh.js). */
            bundleFor: (s) => getGeometry(s.advisoryKey),
          });
    g3d.heightfield.setStormPoints(overall === 'ok' ? 'ok' : overall, pts);
  }

  /* The mesh-height setting changes what the cage draws and nothing else, so
   * it gets its own subscription rather than riding the layer state. Fires
   * immediately at registration; `refreshCage` no-ops until the first storm
   * list has arrived. */
  subscribeSettings(refreshCage);

  /* One subscription fans out to every surface. The store fires immediately
   * with current state, so late-arriving surfaces don't wait for a poll. */
  subscribe((state) => {
    lastStorms = state.storms;
    lastFullState = state;
    if (markers) markers.update(state.storms);
    stormsView.update(state);
    status.feedHealth(sourceHealthMessage(state.sources));

    /* The detail view refreshes in place (or goes ghost — its call).
     * If a poll delivered a NEW ADVISORY for the selected storm, refetch its
     * geometry: the cache key is the advisoryKey, so this is the
     * self-invalidation §7 promises, not a special case. */
    detailView.update(state);
    const cur = detailView.current();
    if (
      selected && cur && cur.id === selected.id &&
      cur.advisoryKey !== selected.advisoryKey
    ) {
      selected = cur;
      loadGeometry(cur);
    } else if (cur && selected && cur.id === selected.id) {
      selected = cur; // same advisory, fresher object — keep them aligned
    }

    /* WARM the geometry for every NHC storm (§9): tracks and cones are
     * ambient ladder detail, so they draw without anyone tapping anything,
     * and selection becomes a cache hit instead of a spinner. Incremental —
     * each bundle paints as it lands rather than waiting for the slowest
     * storm. Prune first so a dissolved storm's cone never lingers as
     * confident ambient detail. Cheap on repeat emits: warmGeometry is
     * cache-first and skips anything already resolved for its current
     * advisory. */
    engine.ambientPrune(new Set(state.storms.map((s) => s.id)));
    warmGeometry(state.storms, (storm, bundle) => {
      engine.ambientBundle(storm, bundle);
      /* AND REBUILD THE CAGE. Bundles land asynchronously, minutes after the
       * storm list that triggered them, so without this the ridge would only
       * appear on the NEXT poll — or never, for a storm whose geometry
       * arrived after the last one. Cheap: recomputing the cage target is one
       * pass over the nodes, not a fetch. No-op in `current` mode, which
       * reads no bundles at all. */
      refreshCage();
    });

    /* Model decks warm alongside the geometry. Separate call, not folded into
     * warmGeometry: geometry is warmed unconditionally because every storm
     * draws a track, while decks are warmed only while their layer is on. */
    warmDecksIfOn();

    refreshCage();
  });

  startPolling();

  // Lift the boot veil once the clear globe has a frame on glass.
  requestAnimationFrame(() => {
    document.getElementById('veil').dataset.lifted = 'true';
  });

  /* --- controls -----------------------------------------------------------
   * Each cluster button ENTERS its view as a fresh root (drawer.go clears the
   * history), or closes the drawer if that view is already showing — so the
   * button that opened a thing also dismisses it. Storms and Layers are peers;
   * Home and Settings are configuration you arrive at and leave.
   * ---------------------------------------------------------------------- */
  const CLUSTER = [
    ['btn-storms', 'storms'],
    ['btn-layers', 'layers'],
    ['btn-home', 'home'],
    ['btn-settings', 'settings'],
  ];

  for (const [id, viewId] of CLUSTER) {
    const btn = document.getElementById(id);
    btn.addEventListener('click', () => {
      if (drawer.isOpen() && drawer.currentId() === viewId) drawer.close();
      else drawer.go(viewId, undefined, { from: btn });
    });
  }

  /** aria-expanded on each cluster button tracks whether ITS view is the one
   *  showing — a screen reader should not hear "expanded" on Layers because
   *  the drawer happens to be open on Home. */
  function syncClusterAria() {
    const cur = drawer.isOpen() ? drawer.currentId() : null;
    for (const [id, viewId] of CLUSTER) {
      document
        .getElementById(id)
        .setAttribute('aria-expanded', String(cur === viewId));
    }
  }
  /* The drawer changes view from several places — row taps, back, Escape, the
   * detail view's Layers link — so it REPORTS changes rather than each caller
   * remembering to sync. One callback beats five call sites, one of which
   * would eventually be missed. */
  drawer.onChange(syncClusterAria);

  document
    .getElementById('btn-recenter')
    .addEventListener('click', recenterAndClear);

  /* First-run nudges: set-your-home, then the install hint once home exists.
   * One-time each; all state and rules live in ui/first-run.js. */
  createFirstRun({
    host: document.getElementById('nudge-host'),
    onOpenHome: () =>
      drawer.go('home', undefined, { from: document.getElementById('btn-home') }),
    install: { isInstalled, canPromptInstall, needsManualInstall, onInstallReady, requestInstall },
  });

  /* The narrow-width pill opens the storm list. */
  document.getElementById('storm-pill').addEventListener('click', () => {
    drawer.go('storms', undefined, {
      from: document.getElementById('btn-storms'),
    });
  });

  /* NOTHING OPEN ON LAUNCH, at any width. §16's "first launch" sketch had the
   * storm list open on wide screens on the grounds that there is room and it
   * is the primary navigation. On glass that was wrong: the globe is the
   * product, and opening a rail over it on arrival buries the thing the user
   * came to look at behind a list they did not ask for. The Storms control
   * and the pill are both one tap away.
   *
   * The pill is the narrow-width entry point and shows itself; wide screens
   * hide it by CSS and use the control cluster. */
  syncClusterAria();

  /* --- resize ------------------------------------------------------------ */
  window.addEventListener('resize', () => {
    g3d.resize();
    map.resize();
  });

  /* The console seam. The merge and every feed decision run CLIENT-SIDE
   * precisely so they can be poked on a phone plugged into a laptop (SPEC §4)
   * — this handle is that debuggability, not leftover scaffolding. */
  window.__landfall = {
    map,
    g3d,
    getState: () => ({ storms: lastStorms }),
  };

}

boot();
