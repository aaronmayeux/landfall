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

import { FONT, SIZE, SPACE } from './config/tokens.js';
import { palette, resolveMode, setThemeMode, themeMode } from './config/theme.js';
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
import { buildStyle, setAdminVisible } from './map/style.js';
import { setStatus, sourceHealthMessage } from './ui/status.js';
import { createGlobe3d } from './map/globe3d.js';
import { addStormMarkers, stormAtPoint } from './map/markers.js';
import { addStormImagery } from './map/imagery.js';
import { createDrawer } from './ui/drawer.js';
import { watchKeyboardInset } from './ui/keyboard.js';
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
import {
  getGeometry,
  getGeometryRecord,
  putGeometry,
  evictGeometry,
  geometryNeedsFetch,
} from './data/cache.js';
import { warmGeometry } from './data/warm.js';
import { warmModelTracks, getAdeck, evictAdeck } from './data/adeck.js';
import { fetchAdvisory } from './data/advisory.js';
import { tracksToFeatures } from './lib/adeck.js';
import { isSilent, silenceBundle } from './lib/silence.js';
import { smoothTracks } from './lib/trackline.js';
import { IMAGERY, GLOBE, MODEL_FAMILY } from './config/constants.js';
import { settingValue, subscribeSettings } from './data/settings-prefs.js';
import { buildMeshPoints } from './map/storm-mesh.js';
import { startPolling, subscribe, refresh, overallStatus } from './data/store.js';
/* Wired here and nowhere else — telemetry is never imported by a render path
 * (§17 A5). main.js is wiring, which is exactly what this is. */
import { startTelemetry, reportSource } from './lib/telemetry.js';
/* The one module that must work when nothing else does — see its header on
 * why it imports nothing, not even tokens. */
import { hasWebGL, showBootFailure } from './ui/boot-failure.js';
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
  modelsOnInFamily,
} from './data/layer-prefs.js';
import { LAYER_TOGGLES, LAYER_PAIRS, isLive, modelSelectorGroups } from './config/layers.js';
import {
  subscribeHome,
  getHome,
  distanceTo,
  closestApproach,
  motionTrend,
} from './data/home.js';
import { resolveSystem } from './lib/units.js';

/**
 * THE ONE ANSWER TO "WHICH UNITS". Every view is handed THIS function, not its
 * own copy of the question — two surfaces resolving the preference separately
 * is how a drawer ends up showing miles above kilometres.
 *
 * `resolveSystem` collapses the stored `auto` against the device locale at
 * call time, so a stored preference of AUTO keeps following the device rather
 * than being frozen to whatever it meant on first run.
 */
const unitSystem = () => resolveSystem(settingValue('units'));

/**
 * Push the LIVE PALETTE into CSS custom properties.
 *
 * CSS cannot import a JS module, so the <style> block in index.html holds
 * first-paint fallbacks and this overwrites them from the real source.
 * tokens.js stays the one truth.
 *
 * RE-RUN ON EVERY THEME CHANGE, and that is what makes light mode almost free
 * on the DOM side: every panel, drawer, list row and button is already written
 * against these variables, so rewriting them here repaints the entire chrome
 * with no per-component work. The map and the 3D globe are the parts that need
 * real code (see applyTheme below); the interface is just this function.
 *
 * `color-scheme` goes with them. It is what tells the browser to render form
 * controls, scrollbars, and the overscroll gutter in the matching theme — miss
 * it and a light app gets dark scrollbars.
 */
function applyTokens() {
  const P = palette();
  const r = document.documentElement.style;
  r.setProperty('--ocean', P.ocean);
  r.setProperty('--space', P.space);
  r.setProperty('--space-near', P.spaceNear);
  r.setProperty('--space-far', P.spaceFar);
  r.setProperty('--text-primary', P.textPrimary);
  r.setProperty('--text-secondary', P.textSecondary);
  r.setProperty('--text-muted', P.textMuted);
  r.setProperty('--glass', P.glass);
  r.setProperty('--glass-raised', P.glassRaised);
  r.setProperty('--glass-border', P.glassBorder);
  r.setProperty('--glass-shadow', P.glassShadow);
  r.setProperty('--focus-ring', P.focusRing);
  r.setProperty('--seg-active', P.segActive);
  r.setProperty('--seg-active-edge', P.segActiveEdge);
  r.setProperty('--install-cta', P.installCta);
  r.setProperty('--install-cta-ink', P.installCtaInk);
  r.setProperty('--error', P.error);
  r.setProperty('--stale', P.stale);
  r.setProperty('--ok', P.ok);
  r.setProperty('--dim', P.dim);
  r.setProperty('--font-ui', FONT.ui);
  r.setProperty('--font-numeric', FONT.numeric);
  r.setProperty('--touch-target', SIZE.touchTarget);
  r.setProperty('--radius', SIZE.radius);
  r.setProperty('--radius-large', SIZE.radiusLarge);
  r.setProperty('--space-tight', SPACE.tight);
  r.setProperty('--space-snug', SPACE.snug);
  r.setProperty('--space-base', SPACE.base);
  r.setProperty('--space-comfy', SPACE.comfy);

  document.documentElement.dataset.theme = themeMode();
  document.documentElement.style.colorScheme = themeMode();

  /* The browser UI around the app — the iOS status bar area and the Android
   * address bar — takes its colour from this meta. Left on the dark ocean it
   * would frame a daylight globe in a black band. */
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', P.ocean);
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
  /* FIRST LINE OF BOOT, before applyTokens and before either engine starts.
   * An error thrown during setup is exactly the error worth hearing about,
   * and a listener registered afterwards would miss it. It cannot throw and
   * cannot block — see lib/telemetry.js. */
  startTelemetry();

  /* THEME BEFORE PAINT, AND BEFORE EITHER ENGINE EXISTS.
   *
   * Order matters more here than anywhere else in boot. `applyTokens` reads
   * the live palette, `createGlobe` bakes the live palette into a MapLibre
   * style object, and `createGlobe3d` bakes it into Three.js materials and a
   * 4096-wide land texture. Resolve after any of those and the app comes up
   * half-themed — the classic version is a light interface floating over a
   * night-sky globe, because the style was built one line too early.
   *
   * `matchMedia` lives here and not in config/theme.js so that module stays
   * DOM-free and importable by tools/contrast-check.mjs. */
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)');
  setThemeMode(resolveMode(settingValue('theme'), !!prefersLight?.matches));

  applyTokens();

  /* The on-screen keyboard's height, published as a CSS variable for the
   * drawer to lift itself by. Started here, at the composition root, because
   * it is a property of the WINDOW rather than of any one view — and started
   * before the drawer exists so the variable is never briefly undefined. */
  watchKeyboardInset();

  /* Two engines: MapLibre on #globe (the input surface, hidden behind at
   * opacity 0 in space), the Three.js clear globe overlay on #gl (pointer-
   * events:none, purely visual). */
  const globeEl = document.getElementById('globe');
  const map = createGlobe(globeEl);
  const g3d = createGlobe3d(document.getElementById('gl'), map, {
    mapEl: globeEl,
    spaceEl: document.getElementById('spacebg'),
  });

  /* Idle drift, tuned from Settings. The initial config is read here rather
   * than waiting for the subscription so the first frame already obeys the
   * user's choice — subscribeSettings fires immediately below and would too,
   * but a drift that starts and then stops a tick later is a visible flinch. */
  const idle = attachIdleRotation(map, {
    config: {
      enabled: settingValue('autoRotate'),
      degPerSecond: settingValue('autoRotateSpeed'),
      resumeDelayMs: settingValue('autoRotateDelaySec') * 1000,
    },
  });
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

    /* THE CACHE IS KEYED BY STORM, NOT BY ADVISORY (data/cache.js). It holds
     * each storm's BEST geometry and refuses to let an empty or failed fetch
     * replace it, which is what keeps a cone on screen when NOAA moves a
     * storm's bin before publishing the new bin's data. `geometryNeedsFetch`
     * owns the "is this worth asking again?" question — including the retry
     * window that stops an empty answer from settling in until the next
     * advisory.
     *
     * Retry (the button, and re-selection after a failure) drops the storm
     * outright so the next fetch is real and its answer is believed. */
    const wantFetch = retry || geometryNeedsFetch(storm.id, storm.advisoryKey);
    if (retry) evictGeometry(storm.id);

    let bundle = wantFetch ? null : getGeometry(storm.id);
    if (bundle?.error) bundle = null;

    if (!bundle) {
      /* Only show the spinner when there is nothing to look at. If the storm
       * already has geometry from an earlier advisory, it stays on the map
       * while the newer one is fetched — a §5 blank-then-repaint is a worse
       * answer than a slightly old shape that never flickers. */
      const held = retry ? null : getGeometry(storm.id);
      if (!held || held.error) detailView.setGeometry({ state: 'loading' });

      try {
        const fetched = await fetchGeometry(storm);
        bundle = putGeometry(storm.id, fetched, storm.advisoryKey);
      } catch (e) {
        console.warn('[landfall] storm geometry failed:', e?.message || e);
        bundle = putGeometry(storm.id, { error: e?.message || 'failed' }, storm.advisoryKey);
      }

      if (bundle?.error) {
        if (seq !== geometrySeq) return;
        if (styleReady) engine.clearSelection();
        detailView.setGeometry({ state: 'error', error: bundle.error });
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
        engine.setBundle(storm, forMap(storm, bundle));
        applyLayerState();
      }
    } catch (e) {
      console.error('[landfall] applying geometry to layers failed:', e);
      if (styleReady) engine.clearSelection();
      detailView.setGeometry({ state: 'error', error: `draw failed: ${e?.message || e}` });
      return;
    }
    /* `held` says the geometry on screen is NOT this advisory's — we asked,
     * the source had nothing newer to give, and the cache kept what it had.
     * That is a different fact from `lagged` (geometry routinely trails the
     * feed by a few hours and that is normal, silent, and expected), so the
     * panel gets both and says different things about them. Conflating the
     * two would either cry wolf every advisory or stay silent through a
     * basin change — §5's asymmetry, either direction. */
    const rec = getGeometryRecord(storm.id);
    /* THE PANEL GETS THE SAME BUNDLE THE MAP DOES — silenced if the storm is.
     * The panel reads `bundle.forecast` for closest approach and reads the
     * watch/warning and wind slots for its own sections, so handing it the raw
     * bundle here would draw a hidden cone's numbers in text beside a map that
     * no longer has it. Same object, same story, both surfaces. */
    detailView.setGeometry({
      state: 'ok',
      bundle: isSilent(storm) ? silenceBundle(bundle) : bundle,
      lagged: geometryLagged(storm.observedAt, bundle.stamp),
      held: !!rec?.bundle && rec.bundleKey !== storm.advisoryKey,
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

  /* --- the one gate every bundle passes through before it is drawn ---------
   *
   * THREE decorations, in a fixed order, and the order is the whole point.
   *
   * 1. Model tracks are folded in FIRST so that silencing can then take them
   *    straight back out. Reversing it would let a warmed a-deck paint
   *    five-day guidance across a storm nobody has published a fix for since
   *    yesterday — the exact confident-future problem the silence rule exists
   *    to remove, arriving through the one slot that does not come from the
   *    geometry fetch.
   *
   * 2. Silencing.
   *
   * 3. Track smoothing runs LAST, on whatever survived. A silent storm has no
   *    forecast track left, so it gets a smoothed history and no connector —
   *    which is right, because the leg joining the two is a claim about where
   *    the storm is NOW. Smooth before silencing and that connector would
   *    outlive the forecast it was reaching for.
   *
   * EVERY path to the map goes through here — selection, re-push, ambient
   * warm, and the cold-start repush. There is deliberately no way to hand the
   * engine a raw bundle: a silenced storm that draws its cone on one path and
   * not another is worse than one that draws it on all of them, because the
   * inconsistency is what nobody would think to check. The same now holds for
   * a storm whose track curves when selected and goes back to facets when it
   * rejoins ambient.
   * ---------------------------------------------------------------------- */
  function forMap(storm, bundle) {
    const decorated = withModelTracks(storm, bundle);
    return smoothTracks(
      isSilent(storm) ? silenceBundle(decorated) : decorated,
      storm?.name || storm?.id || 'storm'
    );
  }

  /** Re-apply the selected storm's geometry after something OTHER than a new
   *  bundle changed what should be drawn — a deck landing, or the user
   *  changing which models are on. One path, so the map cannot end up showing
   *  a selection state nothing produced. */
  function repushSelected() {
    if (!styleReady || !selected || !selectedBundle) return;
    engine.setBundle(selected, forMap(selected, selectedBundle));
  }

  /** The same, for every OTHER storm on the map. Model tracks draw ambiently,
   *  so a deck landing or a model being switched off has to reach the whole
   *  set — not just whatever is selected. Reads the warmed geometry back out
   *  of the cache rather than holding a second copy of it. */
  function repushAmbient() {
    if (!styleReady) return;
    for (const s of lastStorms) {
      const b = getGeometry(s.id);
      if (b && !b.error) engine.ambientBundle(s, forMap(s, b));
    }
  }

  /**
   * Per-layer runtime status for the Layers view (§7: every row shows its own
   * state). Model tracks is the first layer to actually populate this — the
   * machinery has been built and unexercised since the panel landed.
   *
   * Keyed by PREF key, not engine key, because that is what the row is.
   */
  let layerStatus = {};

  /**
   * The model-tracks row's state.
   *
   * WHEN A STORM IS SELECTED the row describes THAT storm — it is the one the
   * user is looking at, and "guidance for Fausto has not been published yet"
   * is a far more useful sentence than any count.
   *
   * WITH NOTHING SELECTED the row describes the WHOLE SET, because that is
   * what the layer is now drawing. It reports a problem only when the problem
   * is total: some storms having no guidance while others do is the normal
   * state of a basin, not a fault, and an amber row every time a new
   * depression forms would train the user to ignore the one that matters.
   */
  function refreshModelStatus() {
    const next = { ...layerStatus };
    delete next.modelTracks;

    if (toggleOn('modelTracks')) {
      next.modelTracks = selected
        ? statusForOne(getAdeck(selected.advisoryKey))
        : statusForAll();
      if (!next.modelTracks) delete next.modelTracks;
    }

    layerStatus = next;
    layersView.refresh();
  }

  /**
   * The imagery row's state, pushed up from map/imagery.js.
   *
   * Same shape as the model-tracks row above and for the same reason: it
   * reports the WHOLE SET and only goes amber when the failure is total. One
   * storm outside radar coverage while three others draw is the normal state
   * of a basin, not a fault.
   */
  function setImageryStatus(next) {
    const merged = { ...layerStatus };
    if (next) merged.imagery = next;
    else delete merged.imagery;
    layerStatus = merged;
    layersView.refresh();
  }

  /** One storm's deck → a row state, or null when there is nothing to say. */
  function statusForOne(r) {
    if (!r) return { state: 'loading' };
    if (r.status === 'unavailable') {
      return { state: 'error', message: 'Model guidance unavailable — tap to retry' };
    }
    /* NOT an error and NOT a retry — but ALSO not "no models forecast this
     * storm", which is what this used to say. The models cover the whole
     * planet; what varies is whether anyone FILES a deck we can read. NOAA
     * covers al/ep/cp and UCAR's TCGP covers wp/io/sh (§15), so this now
     * fires only for the handful of basins neither files — South Atlantic,
     * Mediterranean. The wording names the coverage gap rather than inventing
     * a data gap. `name` is deliberately unused — naming the storm made it
     * read as a fact about that storm rather than about the source. */
    if (r.status === 'unsupported') {
      return { state: 'empty', message: "Guidance isn't published for this basin" };
    }
    if (r.status === 'none') {
      return { state: 'empty', message: 'No guidance published for this storm yet' };
    }
    return null;
  }

  /** The whole map's state. Only speaks up when EVERY storm agrees.
   *
   * ==> THIS FILTERED TO NHC STORMS, AND THAT WENT FROM TRUE TO SILENT <==
   * It read `lastStorms.filter((s) => s.source === 'nhc')` and bailed when
   * that was empty, on the reasoning that the row's standing "NHC storms only"
   * caveat already said everything true. That caveat is gone (2026-07-26) and
   * TCGP now supplies guidance for GDACS storms — so with only a typhoon on
   * screen this returned null and the row said NOTHING AT ALL. Not loading,
   * not empty, not an error: no state, whatever was actually happening
   * underneath.
   *
   * That is §5's forbidden state reached by deletion rather than by a bug. A
   * filter that was a correct description of coverage became a silence the
   * moment coverage changed, and nothing failed to announce it.
   *
   * The lesson is the reusable part: WHEN A COVERAGE LIMIT DISAPPEARS, THE
   * CODE THAT QUIETLY ASSUMED IT DOES NOT ANNOUNCE ITSELF. Every place that
   * filtered on the old limit has to be found by hand.
   */
  function statusForAll() {
    /* Both sources can carry guidance now. A storm from neither is left out
     * because there is genuinely nothing to report about it. */
    const candidates = lastStorms.filter(
      (s) => s.source === 'nhc' || s.source === 'gdacs'
    );
    if (!candidates.length) return null;

    const results = candidates.map((s) => getAdeck(s.advisoryKey));
    if (results.some((r) => r?.status === 'ok')) return null; // something is drawing
    if (results.some((r) => !r)) return { state: 'loading' };
    if (results.every((r) => r.status === 'unavailable')) {
      return { state: 'error', message: 'Model guidance unavailable — tap to retry' };
    }
    /* Every storm up is in a basin no source files a deck for — a coverage
     * statement, and one that offers no retry because none would help. */
    if (results.every((r) => r.status === 'unsupported')) {
      return { state: 'empty', message: "Guidance isn't published for these basins" };
    }
    return { state: 'empty', message: 'No guidance published for the current storms' };
  }

  const status = makeStatusArbiter();

  /**
   * MapLibre's `error` event is not a tile event. It is EVERY error the map
   * can have — a rejected tile request, yes, but also a style validation
   * failure, a bad expression, a missing sprite.
   *
   * THIS USED TO CALL status.tileError() FOR ALL OF THEM, and on 2026-07-26 a
   * layer with an undefined paint value (a bad find-and-replace in the light
   * mode pass) put "Basemap tiles are not loading" permanently on screen while
   * the tiles were loading perfectly. The banner is a latch — one call and it
   * never clears — so a single unrelated error at boot pinned a false outage
   * message on the app for the whole session.
   *
   * That is the §5 failure mode pointed the other way: not silence during an
   * outage, but an outage announced during normal operation. A user told the
   * basemap is down has been told something specific and false, and the next
   * time it IS down they have no reason to believe it.
   *
   * So: only a SOURCE error is a source error. MapLibre sets `sourceId` on the
   * event when the failure belongs to a source or one of its tiles (verified
   * on glass — a real fetch failure arrives as sourceId "basemap"); everything
   * else is our own bug and belongs in the console, where a bug belongs, not
   * in a status strip written for someone watching a hurricane.
   */
  map.on('error', (e) => {
    console.warn('[landfall] map error', e?.error || e);
    if (e?.sourceId) status.tileError();
  });

  /* --- the drawer and its views ------------------------------------------- */
  /* Views read home and layer state through injected façades rather than
   * importing data/ themselves — ui/ must not depend on data/ directly
   * (SPEC §12, one-directional imports). main.js owns the wiring. */
  const homeApi = {
    get: getHome,
    distanceTo,
    motionTrend,
  };

  const drawer = createDrawer({ root: document.getElementById('drawer') });

  const stormsView = createStormsView({
    pill: document.getElementById('storm-pill'),
    onSelect: selectStorm,
    onRetry: () => refresh(),
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
    onRetryGeometry: (storm) => loadGeometry(storm, { retry: true }),
    /* The advisory-text facade. ui/ never imports data/ (§12), and this is
     * deliberately the whole of it: the view awaits a record and renders one
     * of four states. No fetching, no caching, no source branching up there. */
    loadAdvisory: (storm, opts) => fetchAdvisory(storm, opts),
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
      modelsOnInFamily,
      setModel,
      /* WHICH MODEL GROUPS THE PICKER SHOWS IS A FUNCTION OF WHAT IS ON
       * SCREEN, so it is computed here — the layers view has no storm list
       * and should not grow one for this.
       *
       * NHC storms take NOAA's models; everything else takes TCGP's. That
       * mapping is safe because data/merge.js already drops GDACS copies of
       * storms inside NHC's basins, so a non-NHC storm here is genuinely
       * outside NOAA's a-deck coverage.
       *
       * With no storms up this passes an empty set and the config shows
       * BOTH groups rather than none — a selector that vanishes reads as a
       * broken panel. */
      modelSelectorGroups: () => modelSelectorGroups(
        new Set((lastStorms || []).map(
          (s) => (s?.source === 'nhc' ? MODEL_FAMILY.NHC : MODEL_FAMILY.GLOBAL)
        ))
      ),
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
      if (key === 'imagery') {
        /* Tapping the live segment of an errored imagery row means retry —
         * the segment IS the recovery, same rule as the toggles. Clearing the
         * failure flags is what lets the refetch happen instead of the module
         * serving its cached failure straight back. */
        imagery?.retry();
        return;
      }
      if (selected) loadGeometry(selected, { retry: true });
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
   *  look at the map, §16); this is the explicit way off that state.
   *
   *  IT GOES TO YOUR HOUSE IF YOU HAVE ONE. "Back out" used to mean a fixed
   *  mid-Atlantic view, which on glass is a screen of open water with the
   *  coastline you care about off the edge. Home is the reference point the
   *  whole app is built around — every distance, every closest approach — so
   *  it is also the right place for the camera to come to rest. Without a
   *  home it falls back to GLOBE.fallbackCenter, which is now the contiguous
   *  United States rather than the ocean. */
  function recenterAndClear() {
    if (drawer.isOpen()) drawer.close();
    geometrySeq++; // cancel any in-flight geometry response
    selected = null;
    selectedBundle = null;
    if (styleReady) engine.clearSelection();
    refreshModelStatus();
    idle.interrupt(); // or the drift's per-frame setCenter stomps the easeTo
    const home = getHome();
    recenter(map, home ? { center: [home.lon, home.lat] } : undefined);
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
  /* Imagery is a map/ module wired here rather than a registry layer: it needs
   * storm POSITIONS to address a request and draws one raster source per
   * storm, neither of which the geometry engine's feature-merging contract
   * describes. Same shape as markers — main.js pushes storms in. */
  let imagery = null;
  let lastStorms = [];

  /** One deck landed during a warm pass. Guidance draws ambiently, so EVERY
   *  deck changes the map — it is pushed to whichever presentation owns that
   *  storm. Incremental on purpose: each storm's lines appear as its deck
   *  arrives rather than the whole set waiting on the slowest fetch. */
  function onDeckLanded(storm) {
    if (!styleReady) return;

    /* BOTH presentations, always — not one or the other.
     *
     * The engine holds its own copy of every storm's bundle for the ambient
     * merge, and excludes whichever storm is selected. Updating only the
     * SELECTION when the selected storm's deck lands leaves that storm's
     * ambient copy without its guidance, and the map looks right until you
     * deselect — at which point the storm rejoins ambient and its lines
     * silently vanish. Caught headless 2026-07-25.
     *
     * The ambient push is harmless while the storm is selected (the engine
     * filters it out of the merge), so there is no branch to get wrong. */
    const b = getGeometry(storm.id);
    if (b && !b.error) engine.ambientBundle(storm, forMap(storm, b));
    if (selected && storm.id === selected.id) repushSelected();

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
    /* Imagery is the one pair the geometry engine does not own, so it is
     * pushed on the same one-call path rather than through a handler of its
     * own — the rule that keeps the graticule and the forecast times from
     * drifting apart applies here too. */
    if (imagery) imagery.setMode(pairValue('imagery'));
  }

  /* --- style.load: install everything the app draws ------------------------
   *
   * style.load, NOT load: 'load' waits on basemap tiles, and a basemap outage
   * must never block the storm layer — live storms drawing on a failed
   * basemap beats no storms at all (SPEC §5: one source down must not blind
   * the other). Our style is inline, so style.load fires regardless of tiles.
   * globe.js's own style.load handler registered first, so the graticule
   * layers exist by the time this one runs.
   *
   * `on`, NOT `once`, AND THAT IS THE WHOLE REASON THIS IS A NAMED FUNCTION.
   * A theme change calls map.setStyle with a freshly-built style object, which
   * throws away every source and layer the app added and fires style.load
   * again. With `once` the second style would come up as a bare basemap: no
   * storm dots, no cone, no track — a live hurricane silently missing from the
   * map because someone switched to light mode.
   *
   * SO THIS FUNCTION MUST BE SAFE TO RUN MORE THAN ONCE. Everything in it
   * either creates a source/layer (which setStyle just deleted, so there is
   * nothing to collide with) or pushes state back into one. Nothing in here
   * registers a map event listener — those are one-time, and they live below.
   * ---------------------------------------------------------------------- */
  function installOnStyle() {
    markers = addStormMarkers(map);
    markers.update(lastStorms);

    /* Imagery attaches with the markers and BEFORE the geometry engine, so its
     * raster sits at the bottom of everything the app draws — above the
     * basemap's land fill, below the coastline glow and every track and cone
     * (§13 draw order). */
    imagery = addStormImagery(map, { onStatus: setImageryStatus });
    imagery.update(lastStorms);
    /* Apply whatever the sliders were left on before the map existed. The
     * subscription below fires immediately too, but it may have fired while
     * `imagery` was still null. */
    pushImageryTuning();

    /* Selection layers attach AFTER the markers so the beforeId anchor
     * ('storm-dot-planet') exists and the geometry stacks under the dots —
     * severity color stays on top (§6). Same style.load-not-load rule as the
     * markers: a basemap outage must never blind the storm layers (§5). */
    styleReady = true;
    engine.attach();
    applyLayerState();
    /* A selection made before the style was ready replays from cache. On a
     * RESTYLE this is what puts the open storm's cone and track back. */
    if (selected) loadGeometry(selected);
    /* AND SO DOES EVERY OTHER STORM. Geometry warmed before `style.load` is
     * sitting in the cache with nothing on screen — the ambient painter
     * declined it because the style was not ready yet. This is the other half
     * of that guard: without it, a cold start where the feed beats the basemap
     * leaves every unselected storm's cone and track missing until the next
     * poll, and a storm whose geometry arrived in that window would never
     * paint at all. Cheap — it reads bundles already in memory. */
    repushAmbient();
  }

  map.on('style.load', installOnStyle);

  /* --- one-time input wiring ------------------------------------------------
   * OUTSIDE the style.load handler, deliberately. These are listeners on the
   * MAP, not on the style, so they survive setStyle — and registering them
   * inside a handler that now runs on every theme change would stack a second
   * copy of every one of them each time, which is how a single tap ends up
   * selecting a storm twice.
   * ---------------------------------------------------------------------- */

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

  /* Cursor feedback. Bound to the layers stormAtPoint actually queries.
   *
   * NO `getLayer` GUARD, and that is correct rather than sloppy: MapLibre's
   * delegated listener filters its layer list through `getLayer` at EVENT
   * time (verified in vendor/maplibre-gl-5.6.0.js, `_createDelegatedListener`),
   * so naming a layer that does not exist yet — or that a restyle has just
   * deleted and not yet recreated — is harmless. Guarding here instead would
   * mean skipping the binding forever because of one early frame.
   *
   * `(hover: hover)` in spirit, not in code: MapLibre simply never fires
   * these on a touch-only device, so no device sniffing is needed and the
   * touch path is untouched (§10). */
  for (const id of ['storm-dot-planet', 'sel-fpoints', 'amb-fpoints']) {
    map.on('mouseenter', id, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', id, () => {
      map.getCanvas().style.cursor = '';
    });
  }

  /* --- THEME ---------------------------------------------------------------
   * One function owns the whole switch, and the order in it is the order the
   * user sees: chrome first (a CSS variable rewrite, effectively instant),
   * then the 3D globe, then the basemap restyle, which is the slow one.
   * ---------------------------------------------------------------------- */

  /**
   * Re-resolve the preference and, if the live mode actually changed, repaint
   * everything that carries colour.
   *
   * ONLY EVER HANDLES CHANGES. The boot-time resolution happens at the top of
   * boot(), before anything is built — see the note there. `setThemeMode`
   * returns false when the resolved mode is already live, which is what makes
   * this cheap to call from both the settings subscription (fires on EVERY
   * setting change, not just this one) and the OS listener.
   */
  function applyTheme() {
    if (!setThemeMode(resolveMode(settingValue('theme'), !!prefersLight?.matches))) return;

    applyTokens();
    g3d.retheme();

    /* THE BASEMAP IS REBUILT, NOT REPAINTED. Walking every layer with
     * setPaintProperty would mean a second list of every themed property in
     * the app, kept in step with style.js by hand — the exact drift §12 says
     * to design out. A style object is plain data; building a new one and
     * handing it over is one call, and installOnStyle above puts the app's own
     * layers back on the style.load that follows.
     *
     * `diff: false` because the two styles differ in nearly every paint
     * property; the diff would be larger than the style. `engine.invalidate()`
     * FIRST — setStyle deletes the engine's layers, and an engine that still
     * thinks it is attached would decline to rebuild them. */
    engine.invalidate();
    styleReady = false;
    map.setStyle(buildStyle(), { diff: false });
  }

  /* Follow the OS while the app is open, but ONLY for someone who chose to
   * follow it. applyTheme re-resolves the stored preference, so an explicit
   * Dark or Light simply returns false from setThemeMode and nothing happens. */
  prefersLight?.addEventListener?.('change', () => applyTheme());

  /* And follow the SETTING. One subscription, same function: whether the theme
   * changed, the units changed, or a slider moved, applyTheme re-resolves and
   * returns immediately unless the live mode actually differs. Cheaper than a
   * dedicated theme store and impossible to get out of step with one. */
  subscribeSettings(applyTheme);

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
    repushAmbient();
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
            bundleFor: (s) => getGeometry(s.id),
          });
    g3d.heightfield.setStormPoints(overall === 'ok' ? 'ok' : overall, pts);
  }

  /* The mesh-height setting changes what the cage draws and nothing else, so
   * it gets its own subscription rather than riding the layer state. Fires
   * immediately at registration; `refreshCage` no-ops until the first storm
   * list has arrived. */
  subscribeSettings(refreshCage);

  /* --- settings -> everything that reads them ------------------------------
   *
   * ONE subscription per CONCERN, not one per setting and not one giant
   * handler. Each block below re-applies from the store rather than acting on
   * a diff, so it does not matter which setting actually changed — the same
   * rule applyLayerState follows, and the reason the graticule and the
   * forecast times could never drift apart.
   *
   * The change-detection is deliberately crude: these are cheap idempotent
   * pushes (a config object, two view rebuilds that only run when the view is
   * visible), and a settings change is a human tapping a control, not a
   * per-frame event. Tracking previous values to avoid a redundant rebuild
   * would be more state than the thing it saves.
   * ---------------------------------------------------------------------- */

  /* Idle drift. Delay is stored in SECONDS because that is what the slider
   * shows; the multiply happens HERE, once, at the single seam between the
   * store's unit and the loop's. */
  subscribeSettings(() => {
    idle.setConfig({
      enabled: settingValue('autoRotate'),
      degPerSecond: settingValue('autoRotateSpeed'),
      resumeDelayMs: settingValue('autoRotateDelaySec') * 1000,
    });
  });

  /* Units. Every figure in the storm list and the detail panel is formatted
   * through the injected resolver, so both are stale the instant this changes
   * and both have to rebuild. Each view no-ops when it is not on screen. */
  subscribeSettings(() => {
    stormsView.unitsChanged();
    detailView.unitsChanged();
  });

  /* --- imagery sliders -> the map (§4, §16) ---------------------------------
   * THE DEBOUNCE LIVES HERE, not in the view and not in map/imagery.js.
   *
   * The view must fire on `input` so the readout tracks the thumb — on a phone
   * `change` does not arrive until the finger lifts, and a number that only
   * updates after you let go is useless for aiming. So a single drag emits
   * dozens of settings changes, and this is the one place that knows what each
   * one COSTS: a fade change repaints cached frames, a radius change refetches
   * every disc from NASA. Neither should run per pixel of thumb travel.
   *
   * `imagery.setTuning` ignores no-op changes, so a settle that lands on the
   * value already in effect is free.
   * ---------------------------------------------------------------------- */
  let tuningTimer = null;
  function pushImageryTuning() {
    imagery?.setTuning({
      radiusKm: settingValue('imageryRadiusKm'),
      fadeWidth: settingValue('imageryFade'),
    });
  }
  subscribeSettings(() => {
    if (!imagery) return;
    clearTimeout(tuningTimer);
    tuningTimer = setTimeout(pushImageryTuning, IMAGERY.tuning.settleMs);
  });

  /* Last reported status per source, so only TRANSITIONS are sent. Seeded
   * empty: the store's fire-on-subscribe delivers the boot state, and
   * 'loading' -> 'ok' on first load is a real transition worth one event —
   * it is the cheapest possible confirmation that the app works at all for
   * somebody who is not Aaron. */
  const lastSourceStatus = Object.create(null);

  function reportSourceChanges(sources) {
    if (!sources) return;
    for (const [name, src] of Object.entries(sources)) {
      const status = src?.status;
      if (!status || lastSourceStatus[name] === status) continue;
      lastSourceStatus[name] = status;
      reportSource(name, status, src?.error);
    }
  }

  /* One subscription fans out to every surface. The store fires immediately
   * with current state, so late-arriving surfaces don't wait for a poll. */
  subscribe((state) => {
    lastStorms = state.storms;
    lastFullState = state;
    if (markers) markers.update(state.storms);
    if (imagery) imagery.update(state.storms);
    stormsView.update(state);
    status.feedHealth(sourceHealthMessage(state.sources));

    /* TELEMETRY: report a source CHANGING state, never its current state
     * (§17 A5). The store fires on every poll, so reporting unconditionally
     * would send "nhc is still down" every five minutes and bury the moment
     * it broke under a hundred copies of itself. The transition is the event;
     * the steady state is not news. */
    reportSourceChanges(state.sources);

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
      /* THE STYLE GUARD IS NOT OPTIONAL. The feed can land before the basemap
       * does on a cold start, and `engine.ambientBundle` reaches straight into
       * MapLibre, which throws "Style is not done loading." if asked early.
       * Every other engine call in this file is already guarded this way; this
       * one was not, and the exception was landing in warm.js's fetch catch
       * where it read as a dead endpoint (see paint() there).
       *
       * Skipping is safe ONLY because style.load calls repushAmbient() — the
       * bundle is cached, so it paints a moment later from there. Remove that
       * call and this guard turns a loud exception into missing cones, which
       * is worse. */
      if (!styleReady) return;
      /* Decorated on the way in, so a storm whose deck warmed FIRST does not
       * have its guidance wiped when its geometry lands afterwards. The two
       * warm loops run independently and either can finish first. */
      engine.ambientBundle(storm, forMap(storm, bundle));
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

  /* --- the view control: compass when rotated, crosshair when upright ------
   *
   * One button doing the more useful of two jobs, decided by the camera's
   * bearing. See the markup note in index.html for why it morphs rather than
   * appearing and disappearing.
   *
   * The needle is redrawn on MapLibre's own `rotate` event rather than on a
   * rAF loop of its own: a separate loop drifts out of phase with the map and
   * the needle visibly lags the globe under the user's fingers — the same
   * scar the home marker carries (map/marker-home.js). One transform on one
   * cached element, no layout reads.
   * ---------------------------------------------------------------------- */
  const viewBtn = document.getElementById('btn-recenter');
  const viewAim = viewBtn.querySelector('.view-aim');
  /* NULL, NOT FALSE. The sync below early-returns when the mode has not
   * changed — which is the whole point, since it runs on every frame of every
   * camera move. Seeding this with `false` made the very first call a no-op,
   * so the button kept the placeholder aria-label baked into index.html and
   * only ever got the accurate one after the user had rotated the globe and
   * come back. Caught in Chrome 2026-07-25. A third value that can never
   * equal either real state guarantees the first sync writes. */
  let offNorth = null;

  function syncViewControl() {
    const bearing = map.getBearing();
    /* North on SCREEN is at minus the camera's bearing — bearing is the
     * direction the camera faces, so the needle counter-rotates. */
    if (viewAim) viewAim.style.transform = `rotate(${-bearing}deg)`;

    const next = Math.abs(bearing) > GLOBE.northTolerance;
    if (next === offNorth) return; // nothing but the needle moved
    offNorth = next;
    viewBtn.dataset.mode = next ? 'north' : 'recenter';
    /* The accessible name has to track the behaviour or a screen-reader user
     * is told "recenter" and gets a rotation, which is worse than no label. */
    viewBtn.setAttribute(
      'aria-label',
      next
        ? 'Turn the globe back to north'
        : 'Recenter the globe on your home and zoom back out'
    );
  }

  map.on('rotate', syncViewControl);
  /* `rotate` does not fire for an easeTo that only changes bearing on some
   * paths, and it never fires at boot. `move` covers both and costs one
   * cheap comparison per frame the camera is already moving. */
  map.on('move', syncViewControl);
  syncViewControl();

  viewBtn.addEventListener('click', () => {
    if (offNorth) {
      /* JUST THE BEARING. Someone who rotated the globe to read a track at an
       * angle wants it upright again — not to be thrown back into space and
       * lose the storm they were reading. That is what the crosshair is for,
       * and it is one more tap away the moment this lands at north. */
      idle.interrupt();
      map.easeTo({ bearing: 0 });
      return;
    }
    recenterAndClear();
  });

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

/* ==> BOOT IS GUARDED. IT USED TO BE A BARE CALL. <==
 *
 * A throw in here — a library that did not load, a WebGL context the browser
 * refused — left a BLACK SCREEN and a console message no ordinary person will
 * ever read. §5 forbids exactly that for every feed and every layer in this
 * app, and did not apply to the app's own startup, which is the worst place
 * to have the gap: a dead feed still leaves an app that can explain itself; a
 * dead boot leaves nothing at all.
 *
 * Found on a real device (Brave on Android, 2026-07-25) where the same build
 * ran fine on macOS and iOS — the black screen was identical to a deploy
 * failure, so it cost a round of diagnosis that a one-line message would have
 * answered outright.
 *
 * The check runs BEFORE boot as well as around it, so the common cause gets
 * named rather than surfacing as an opaque throw from inside MapLibre. */
try {
  if (!hasWebGL()) {
    showBootFailure(new Error('webgl_unavailable'));
  } else {
    boot();
  }
} catch (e) {
  showBootFailure(e);
}
