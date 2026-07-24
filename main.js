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
import { STORAGE_KEY } from './config/constants.js';
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
import { createStormsPanel } from './ui/panel-storms.js';
import { createStormDetailPanel } from './ui/panel-storm-detail.js';
import { createHomePanel } from './ui/panel-home.js';
import { createHomeMarker } from './map/marker-home.js';
import { createProvisionalPin } from './map/pin-provisional.js';
import { createLayerEngine } from './map/layers/index.js';
import { fetchStormGeometry, geometryLagged } from './data/nhc-mapserver.js';
import { getGeometry, putGeometry, evictGeometry } from './data/cache.js';
import { warmGeometry } from './data/warm.js';
import { startPolling, subscribe, refresh, overallStatus } from './data/store.js';
import {
  subscribeHome,
  getHome,
  distanceTo,
  closestApproach,
  filterByScope,
  availableScopes,
} from './data/home.js';
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

  /** Forecast time labels: additive toggle, DEFAULT ON (§7 — a cone without
   *  times is just a shape). Persisted per device under STORAGE_KEY.layers. */
  function readLayerPrefs() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY.layers)) || {}; }
    catch { return {}; }
  }
  function forecastTimesOn() {
    return readLayerPrefs().forecastTimes !== false;
  }
  function writeForecastTimes(on) {
    try {
      localStorage.setItem(
        STORAGE_KEY.layers,
        JSON.stringify({ ...readLayerPrefs(), forecastTimes: on })
      );
    } catch { /* storage unavailable — the toggle still works this session */ }
  }

  /** One-shot flyTo OFFSET from the panel's REAL box (§16: center the storm
   *  on the visible globe area). offsetWidth/Height ignore the slide
   *  transform, so the values are stable mid-animation, and there is no
   *  duplicated 340px/60vh constant to drift from the CSS. Offset semantics:
   *  where the target center lands relative to container center — the left
   *  rail pushes the storm right by half the rail; the bottom sheet pushes
   *  it up by half the sheet. (Persistent `padding` is FORBIDDEN — it
   *  desyncs the two globes; see the scar-tissue note on flyToStorm.) */
  function panelOffset() {
    const el = document.getElementById('panel-detail');
    return window.matchMedia('(min-width: 720px)').matches
      ? [(el.offsetWidth || 0) / 2, 0]
      : [0, -(el.offsetHeight || 0) / 2];
  }

  /** Selection: tap a dot, tap a row, Enter on a focused row — identical
   *  (§16). Panel opens and camera flies TOGETHER, not sequentially. */
  function selectStorm(storm) {
    /* Selection can come from panels (off-canvas), so the idle drift never
     * sees a gesture — interrupt it explicitly or its per-frame setCenter
     * stomps the flyTo. Also resets the auto-rotate clock, as any
     * interaction does. */
    idle.interrupt();
    selected = storm;
    if (panel.isOpen()) panel.close();
    if (homePanel.isOpen()) homePanel.close();
    detailPanel.open(storm);
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
      detailPanel.setGeometry({
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
      detailPanel.setGeometry({ state: 'loading' });
      try {
        bundle = await fetchStormGeometry(storm);
        putGeometry(key, bundle);
      } catch (e) {
        console.warn('[landfall] storm geometry failed:', e?.message || e);
        putGeometry(key, { error: e?.message || 'failed' });
        if (seq !== geometrySeq) return;
        if (styleReady) engine.clearSelection();
        detailPanel.setGeometry({ state: 'error', error: e?.message || 'failed' });
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
        engine.setToggle('forecastPoints', forecastTimesOn());
      }
    } catch (e) {
      console.error('[landfall] applying geometry to layers failed:', e);
      if (styleReady) engine.clearSelection();
      detailPanel.setGeometry({ state: 'error', error: `draw failed: ${e?.message || e}` });
      return;
    }
    detailPanel.setGeometry({
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

  /* --- the storm list panel (the accessibility surface) ------------------- */
  /* The storm panel reads home through this injected façade rather than
   * importing data/home.js itself — ui/ must not depend on data/ directly
   * (SPEC §12, one-directional imports). main.js owns the wiring. */
  const homeApi = {
    get: getHome,
    distanceTo,
    filterByScope,
    availableScopes,
  };

  const panel = createStormsPanel({
    root: document.getElementById('panel-storms'),
    pill: document.getElementById('storm-pill'),
    toggleButton: document.getElementById('btn-storms'),
    onSelect: selectStorm,
    onRetry: () => refresh(),
    home: homeApi,
  });

  /* Storm detail replaces the LIST in the same slot (§16). ui/ never imports
   * data/ — home reads and the geometry lifecycle arrive through injection,
   * same one-directional-imports pattern as the storms panel. */
  const detailPanel = createStormDetailPanel({
    root: document.getElementById('panel-detail'),
    onBack: () => {
      detailPanel.close();
      panel.open(); // back-to-list is a motion everyone already knows
    },
    home: { get: getHome, distanceTo, closestApproach },
    onToggleForecastTimes: (on) => {
      writeForecastTimes(on);
      if (styleReady) engine.setToggle('forecastPoints', on);
    },
    getForecastTimesOn: forecastTimesOn,
    onRetryGeometry: (storm) => loadGeometry(storm, { retry: true }),
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

  const homePanel = createHomePanel({
    root: document.getElementById('panel-home'),
    toggleButton: document.getElementById('btn-home'),
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
  });

  /* One subscription owns everything that reacts to home changing, whatever
   * caused it: the panel, a cleared home, or a future settings screen. */
  subscribeHome((home) => {
    homeMarker.setHome(home);
    /* Setting or clearing home changes the scope filter's availability, the
     * sort order, and every distance on screen — so the list needs a full
     * rebuild, not a patch. */
    panel.homeChanged();
    /* The detail panel's home block appears/disappears with home itself. */
    if (lastFullState) detailPanel.update(lastFullState);
  });

  /** ONE recenter behavior for both entrances (the button and Esc-twice):
   *  recenter is "back to the globe", so it ends the selection too. Closing
   *  a panel deliberately leaves the geometry drawn (you dismissed the panel
   *  to look at it, §16); this is the explicit way off that state. */
  function recenterAndClear() {
    if (detailPanel.isOpen()) detailPanel.close();
    geometrySeq++; // cancel any in-flight geometry response
    selected = null;
    if (styleReady) engine.clearSelection();
    recenter(map);
  }

  /* Escape, once, at the document level: close the panel if open, else
   * recenter (SPEC §10). Attached here because it needs the panels.
   * Three claimants now, still ONE contract (SPEC §13). Esc on the detail
   * panel closes it OUTRIGHT — not back to the list; the camera and the
   * drawn geometry hold, which is what lets you dismiss a panel to look at
   * the map underneath it (§16). Esc again recenters. */
  attachEscape(map, {
    isPanelOpen: () =>
      panel.isOpen() || homePanel.isOpen() || detailPanel.isOpen(),
    closePanel: () => {
      if (detailPanel.isOpen()) detailPanel.close();
      else if (homePanel.isOpen()) homePanel.close();
      else panel.close();
    },
    onRecenter: recenterAndClear,
  });

  /* --- markers + data spine ----------------------------------------------- */
  let markers = null;
  let lastStorms = [];
  let graticuleOn = false;

  /* style.load, NOT load: 'load' waits on basemap tiles, and a basemap outage
   * must never block the storm layer — live storms drawing on a failed
   * basemap beats no storms at all (SPEC §5: one source down must not blind
   * the other). Our style is inline, so style.load fires regardless of tiles.
   * globe.js's own style.load handler registered first, so the graticule
   * layers exist by the time this one runs. */
  map.once('style.load', () => {
    setGraticuleVisible(map, graticuleOn);
    document
      .getElementById('btn-graticule')
      .setAttribute('aria-pressed', String(graticuleOn));
    markers = addStormMarkers(map);
    markers.update(lastStorms);

    /* Selection layers attach AFTER the markers so the beforeId anchor
     * ('storm-dot-planet') exists and the geometry stacks under the dots —
     * severity color stays on top (§6). Same style.load-not-load rule as the
     * markers: a basemap outage must never blind the storm layers (§5). */
    styleReady = true;
    engine.attach();
    engine.setToggle('forecastPoints', forecastTimesOn());
    /* A selection made before the style was ready replays from cache. */
    if (detailPanel.isOpen() && selected) loadGeometry(selected);

    /* Tap/click a storm dot — same action as a list row (SPEC §16). The 44 px
     * hit box lives in stormAtPoint; cursor feedback rides layer hover.
     * Tapping empty ocean CLOSES the detail panel (§16) — the camera and the
     * drawn geometry hold. */
    map.on('click', (e) => {
      const id = stormAtPoint(map, e.point);
      const storm = id && lastStorms.find((s) => s.id === id);
      if (storm) selectStorm(storm);
      else if (detailPanel.isOpen()) detailPanel.close();
    });
    map.on('mouseenter', 'storm-glyph', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'storm-glyph', () => {
      map.getCanvas().style.cursor = '';
    });
  });

  /* One subscription fans out to every surface. The store fires immediately
   * with current state, so late-arriving surfaces don't wait for a poll. */
  subscribe((state) => {
    lastStorms = state.storms;
    lastFullState = state;
    if (markers) markers.update(state.storms);
    panel.update(state);
    status.feedHealth(sourceHealthMessage(state.sources));

    /* The open detail panel refreshes in place (or goes ghost — its call).
     * If a poll delivered a NEW ADVISORY for the selected storm, refetch its
     * geometry: the cache key is the advisoryKey, so this is the
     * self-invalidation §7 promises, not a special case. */
    detailPanel.update(state);
    const cur = detailPanel.current();
    if (
      detailPanel.isOpen() &&
      cur && selected &&
      cur.id === selected.id &&
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

  /* --- controls ---------------------------------------------------------- */
  document
    .getElementById('btn-recenter')
    .addEventListener('click', recenterAndClear);

  const gratBtn = document.getElementById('btn-graticule');
  gratBtn.addEventListener('click', () => {
    graticuleOn = !graticuleOn;
    setGraticuleVisible(map, graticuleOn);
    gratBtn.setAttribute('aria-pressed', String(graticuleOn));
  });

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
