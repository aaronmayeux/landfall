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
import { setStatus, sourceHealthMessage } from './ui/status.js';
import { createGlobe3d } from './map/globe3d.js';
import { sevFromKt } from './map/heightfield.js';
import { categoryColor } from './lib/category.js';
import { addStormMarkers, stormAtPoint } from './map/markers.js';
import { createDrawer } from './ui/drawer.js';
import { createStormsView } from './ui/view-storms.js';
import { createStormDetailView } from './ui/view-storm-detail.js';
import { createHomeView } from './ui/view-home.js';
import { createLayersView } from './ui/view-layers.js';
import { createSettingsView } from './ui/view-settings.js';
import { createHomeMarker } from './map/marker-home.js';
import { createProvisionalPin } from './map/pin-provisional.js';
import { createLayerEngine } from './map/layers/index.js';
import { fetchStormGeometry, geometryLagged } from './data/nhc-mapserver.js';
import { getGeometry, putGeometry, evictGeometry } from './data/cache.js';
import { warmGeometry } from './data/warm.js';
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
} from './data/layer-prefs.js';
import { LAYER_TOGGLES, LAYER_PAIRS, isLive } from './config/layers.js';
import {
  subscribeHome,
  getHome,
  distanceTo,
  closestApproach,
  filterByScope,
  availableScopes,
} from './data/home.js';
import { resolveSystem } from './lib/units.js';
import { lonLatToVec3 } from './lib/geo.js';

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
    drawer.push('detail', storm);
    flyToStorm(map, storm, { offset: panelOffset() });
    loadGeometry(storm);
  }

  /** The geometry pipeline: cache → fetch → layers + panel. Every exit path
   *  checks `seq` so a slow response for storm A never paints over storm B. */
  async function loadGeometry(storm, { retry = false } = {}) {
    const seq = ++geometrySeq;

    if (storm.source !== 'nhc') {
      /* GDACS per-event geometry (wind bands) is Phase 6. Nothing to draw is
       * `none`, not an error — the panel's `can` branches say why. */
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
        bundle = await fetchStormGeometry(storm);
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
    try {
      if (styleReady) {
        engine.setBundle(storm, bundle);
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
    },
    /* No layer currently fetches anything of its own — the two live toggles
     * are pure render switches (§7). This returns empty until the fetching
     * layers land, at which point their status flows in here rather than the
     * rows growing their own error handling. */
    getLayerStatus: () => ({}),
    onRetry: () => {
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
    if (styleReady) engine.clearSelection();
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

  /** Push the whole layer state onto the map. ONE function, called on every
   *  change, rather than a handler per layer — a per-layer path is how the
   *  graticule ended up with a different mechanism from the forecast times. */
  function applyLayerState() {
    if (!styleReady) return;
    setGraticuleVisible(map, toggleOn('graticule'));
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
    map.on('mouseenter', 'storm-glyph', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'storm-glyph', () => {
      map.getCanvas().style.cursor = '';
    });
  });

  /* Layer state drives the map, the home marker, and the detail view's
   * shortcut summary. One subscription, fired immediately at registration,
   * so the initial state applies without a separate boot call. */
  subscribeLayers(() => {
    applyLayerState();
    applyHomeMarker();
    detailView.layersChanged();
  });

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
    warmGeometry(state.storms, (storm, bundle) => engine.ambientBundle(storm, bundle));

    /* The 3D cage reads severity as elevation. On outage it HOLDS its shape
     * and desaturates — never flattens to a fake all-clear (SPEC §5). */
    const overall = overallStatus(state);
    if (overall !== 'loading') {
      const pts =
        overall === 'unavailable'
          ? null
          : state.storms.map((s) => ({
              dir: lonLatToVec3(s.lon, s.lat, 1).normalize(),
              sev: sevFromKt(s.windKt),
              /* The SAME color MapLibre stamps on this storm's glyph
               * (map/markers.js). One severity color per storm across both
               * engines — it tints the planet-band glyph AND the cage nodes it
               * lifts, so height and hue tell one story. */
              color: categoryColor(s.category, s.nature),
            }));
      g3d.heightfield.setStormPoints(overall === 'ok' ? 'ok' : overall, pts);
    }
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
