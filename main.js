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

import { resolveMode, setThemeMode, subscribeThemeChange } from './config/theme.js';
import {
  createGlobe,
  attachIdleRotation,
  attachKeyboard,
  attachEscape,
} from './map/globe.js';
import { setGraticuleVisible } from './map/graticule.js';
import {
  addPopulationLayer,
  setPopulationTowns,
  setPopulationVisible,
} from './map/population.js';
import { loadTowns, townsOrNull } from './data/population.js';
import { getHome } from './data/home.js';
/* The three Pass-1 extractions. `app/` is the composition layer: it may import
 * from anywhere, and nothing imports FROM it except this file (§12). */
import { applyTokens, createThemeSwitch } from './app/theme-switch.js';
import { createBundlePipeline } from './app/bundle-pipeline.js';
import { createViews, panelOffsetFor, recenterTarget } from './app/views.js';
import { anySourceResolved, createSourceReporter } from './app/source-status.js';
import { createViewControl } from './map/view-control.js';
import { setAdminVisible } from './map/style.js';
import { setStatus, sourceHealthMessage, TONE } from './ui/status.js';
import { createGlobe3d } from './map/globe3d.js';
import { addStormMarkers, stormAtPoint } from './map/markers.js';
import { addStormImagery } from './map/imagery.js';
import { createBoot } from './ui/boot.js';
import { watchKeyboardInset } from './ui/keyboard.js';
import { createFirstRun } from './ui/first-run.js';
import { clusterAction } from './ui/drawer.js';
/* THE FLAG ONLY. `lib/archive-mode.js` imports nothing and is a few dozen
 * lines; the archive ITSELF is behind a dynamic import below (§57.35 fault 4)
 * and no part of `seasons/` is on the boot path. */
import { isArchive } from './lib/archive-mode.js';
import {
  isInstalled,
  canPromptInstall,
  needsManualInstall,
  onInstallReady,
  requestInstall,
} from './pwa.js';
import { createLayerEngine } from './map/layers/index.js';
import { fetchSurgeFixture, fixtureAdvisory, FIXTURE_STORM_ID } from './data/surge.js';
import {
  setGenesisAreas,
  rethemeGenesis,
  genesisAtPoint,
  GENESIS_HIT_LAYERS,
} from './map/layers/genesis.js';
import { setFloodAlerts, rethemeFlood, floodAtPoint, FLOOD_LAYER_IDS } from './map/layers/flood.js';
/* ==> ON THE BOOT PATH, AND THAT IS THE ONE EXCEPTION IN THIS FEATURE. <==
 * Everything else in Seasons is behind a dynamic import (§57.35 fault 4). This
 * is not, because the layer has to be added while the style is installing —
 * the same `style.load` window every other layer takes — and a source added
 * later cannot be slotted beneath the storm markers. It is one small module
 * with no state, and it draws nothing until the archive hands it storms. */
import {
  ensureSeasonTracks, setSeasonTracks, clearSeasonTracks,
  setSeasonTrackFocus, seasonStormAtPoint,
} from './map/layers/season-tracks.js';
import {
  ensureSeasonPoints, setSeasonPoints, clearSeasonPoints, setSeasonPointFocus,
} from './map/layers/season-points.js';
import {
  ensureSeasonSwath, setSeasonSwathSet, clearSeasonSwath, setSeasonSwathFocus,
} from './map/layers/season-swath.js';
import {
  ensureSeasonHead, setSeasonHead, clearSeasonHead, setSeasonHeadFocus,
} from './map/layers/season-head.js';
/* The archive's ridge and its camera. Both are pure — one turns a ticked
 * season into cage points, the other into a flight — and both are reached only
 * through the `archiveGlobe` facade below, because `seasons/` never imports
 * `map/` (§12). §57.21c. */
import {
  buildSeasonMeshPoints, seasonGlyphs, seasonGlyphAtPoint,
} from './map/season-mesh.js';
import { flyToArchiveEntry, flyToArchiveStorm } from './map/season-frame.js';
import { loadFloodAlerts, evictFlood } from './data/flood.js';
/* The geometry fetchers, the geometry cache and the pure bundle decorators all
 * left with app/bundle-pipeline.js. What stays here is what the CAGE and the
 * ambient deck push still read directly. */
import { getGeometry } from './data/cache.js';
import { warmGeometry } from './data/warm.js';
import { warmModelTracks } from './data/adeck.js';
import { warmShips } from './data/ships.js';
import { isEnded, reportingStormIds } from './lib/lifecycle.js';
import { endedBundle } from './data/lifecycle.js';
import { backfillEndedTracks } from './data/ended-track.js';
import { IMAGERY, TAP } from './config/constants.js';
import { SIZE } from './config/tokens.js';
/* ==> THE FURNITURE'S REAL BOXES, FOR THE ARCHIVE'S "TAP OUTSIDE THE SHEET"
 * RULE. §57.21d. <== The same measurement the home marker dodges chrome with;
 * borrowed rather than rewritten, because a second copy of it would drift the
 * day the drawer changed shape and the symptom would be one surface dismissing
 * itself at the wrong moment. */
import {
  measureChrome, occludedByChrome, TAP_BLOCKING_SELECTORS,
} from './map/chrome-avoid.js';
import { settingValue, subscribeSettings } from './data/settings-prefs.js';
import { buildMeshPoints } from './map/storm-mesh.js';
import { startPolling, subscribe, refresh, overallStatus } from './data/store.js';
/* Wired here and nowhere else — telemetry is never imported by a render path
 * (§17 A5). main.js is wiring, which is exactly what this is. */
import { startTelemetry, reportSource, setSessionSnapshot } from './lib/telemetry.js';
/* The two halves of the per-visit summary. telemetry.js deliberately does NOT
 * import these — main.js joins them and hands the result over as a callback,
 * so a fault in either can never take error reporting down with it. */
import { startPerf, mark as perfMark, noteWebglLoss, snapshot as perfSnapshot } from './lib/perf.js';
import { snapshot as usageSnapshot } from './lib/usage.js';
/* The one module that must work when nothing else does — see its header on
 * why it imports nothing, not even tokens. */
import { hasWebGL, showBootFailure } from './ui/boot-failure.js';
import { pairValue, toggleOn, setPair, subscribeLayers } from './data/layer-prefs.js';
import { LAYER_TOGGLES, LAYER_PAIRS } from './config/layers.js';

/* --- status strip precedence -------------------------------------------------
 * One strip, several claimants. Explicit order, not last-handler-wins:
 *   feed OUTAGE  >  tile error  >  feed delayed  >  quiet
 *
 * ==> THE ORDER USED TO PUT TILES FIRST, AND OFFLINE IS WHERE THAT BROKE. <==
 * `tools/offline-check.mjs` cut the network and the app said "Basemap tiles are
 * not loading" — true, and the least important true thing available. Both
 * feeds were also gone, so the one sentence the strip had to spend was spent on
 * the decoration instead of on the fact that there is no storm data at all.
 * A dead basemap still leaves a globe with coastlines on it; a dead feed leaves
 * an empty ocean that looks exactly like calm weather. That is §5's whole
 * point, and the ranking was pointed away from it.
 *
 * DELAYED stays BELOW the tile error on purpose. "Showing last good data" means
 * the app is working and the numbers are a few hours old — genuinely less
 * urgent than a basemap that is not drawing. Only a full outage outranks tiles.
 *
 * ==> AND `tileError` WAS A ONE-WAY LATCH. <== Nothing ever set it back to
 * false, so one rejected tile at any point in a session pinned that message on
 * screen for the rest of it — and under the old order that ALSO silenced every
 * feed outage that happened afterwards. The header on `map.on('error')` below
 * already named the latch as the hazard it is; only the trigger got narrowed at
 * the time, not the latch itself. `tilesRecovered()` is the missing half.
 */
/** The basemap's source id, as `map/style.js` names it. The status strip's tile
 *  message is about THIS source and no other — see the note on `map.on('error')`
 *  for the bug that came of not checking. */
const BASEMAP_SOURCE = 'basemap';

function makeStatusArbiter() {
  let tileError = false;
  let feed = null; // {message, tone} | null

  const render = () => {
    if (feed && feed.tone === TONE.ERROR) return setStatus(feed.message, feed.tone);
    if (tileError) return setStatus('Basemap tiles are not loading', TONE.ERROR);
    if (feed) return setStatus(feed.message, feed.tone);
    setStatus(null);
  };

  return {
    tileError() {
      if (tileError) return;
      tileError = true;
      render();
    },
    /* Called from a MapLibre event that fires many times a second while tiles
     * stream in. The flag read is the entire hot path when nothing is wrong. */
    tilesRecovered() {
      if (!tileError) return;
      tileError = false;
      render();
    },
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

  /* Perf observation starts in the same breath, and for the same reason.
   * `buffered: true` backfills entries the browser has ALREADY recorded, but
   * only the ones it still holds — register this late and the earliest paint
   * entries are gone, which are precisely the ones that explain a slow first
   * load. Like telemetry, it cannot throw and cannot block. */
  startPerf();

  /* ==> THE VENDORED LIBRARIES HAVE FINISHED RUNNING. <==
   * This line is a measurement, not an action, and WHERE it sits is the whole
   * of its meaning. index.html loads MapLibre and Three as `defer`red classic
   * scripts, which the browser guarantees to run in document order before any
   * module — so by the time this function is reached, 1.5 MB of library has
   * already been fetched, compiled and executed, and none of the app's own
   * work has begun.
   *
   * It therefore cuts the largest unexplained stage of the load in half.
   * `fcp` -> here is the browser digesting the libraries; here -> `globe` is
   * us building the map. Those have different fixes and the single number
   * that used to span both could not tell them apart.
   *
   * Moving this call moves the boundary and silently changes what every
   * number derived from it means. It belongs at the top of boot, immediately
   * after the observer that records it, and nowhere else. */
  perfMark('scripts');

  /* How the one-per-visit summary gets assembled, handed over as a callback
   * rather than an import so lib/telemetry.js keeps its config-only
   * dependencies. Read exactly once, when the visit ends. */
  setSessionSnapshot(() => ({ ...perfSnapshot(), ...usageSnapshot() }));

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
  /* Wired FIRST, before either engine is constructed. Its stuck-timer has to
   * be running while the slow part happens — started after createGlobe() it
   * would never fire on the boot it exists to describe. */
  const boot = createBoot();

  const globeEl = document.getElementById('globe');
  /* Opens on YOUR HOUSE if one is set, the lower 48 if not — the same call the
   * recenter control uses, so "where the camera rests" has exactly one answer
   * in the codebase instead of two that can drift apart. Read straight from
   * localStorage (getHome is synchronous), so the first painted frame is
   * already right: no flash of the US followed by a jump. Zoom is untouched —
   * still the space floor. */
  const map = createGlobe(globeEl, recenterTarget(getHome()));
  const g3d = createGlobe3d(document.getElementById('gl'), map, {
    mapEl: globeEl,
    spaceEl: document.getElementById('spacebg'),
    glowEl: document.getElementById('glow'),
    rimEl: document.getElementById('rim'),
  });

  /* ==> WEBGL CONTEXT LOSS, ON BOTH CANVASES. <==
   * iOS Safari takes WebGL contexts away under memory pressure, and when it
   * does, a globe app looks from the outside exactly like "it was slow" while
   * actually being "the graphics card was removed mid-session". That is the
   * leading hypothesis for the iPhone-heavy slow tail in the 2026-07-27
   * numbers, and it is unfalsifiable without this listener.
   *
   * Passive: these must never delay the browser's own recovery handling, and
   * noteWebglLoss does nothing but set a flag. */
  try {
    map.getCanvas?.()?.addEventListener('webglcontextlost', noteWebglLoss, { passive: true });
    document
      .getElementById('gl')
      ?.addEventListener('webglcontextlost', noteWebglLoss, { passive: true });
  } catch {
    /* no listener means no field, never a failed boot */
  }

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

  /* ==> THE ARCHIVE FLAG GOES IN AT CONSTRUCTION, NOT AT EACH PUSH. §57.21c.
   * <== Every road that puts a LIVE storm's track, cone, wind field or model
   * guidance onto the globe ends at `engine.ambientBundle` or
   * `engine.setBundle`, and there are five of them in this file. Push 1 gated
   * one and the other four went on repainting this week's weather over
   * whatever year the reader had open — the loudest being the palette
   * repaint, which fires the moment the archive forces sepia.
   *
   * A predicate rather than an import, because `map/layers/registry.js`
   * imports nothing on purpose. It asks the question fresh on every call:
   * these pushes are asynchronous and a captured answer would be the state of
   * the world at the moment a fetch STARTED, which is the exact mistake the
   * `warmGeometry` callback already documents further down. */
  const engine = createLayerEngine(map, { painting: () => !isArchive() });
  let styleReady = false; // engine may only touch the style after style.load
  /* Declared HERE, not at the store subscription below: `createViews` below
   * registers the home subscription, which data/home.js fires IMMEDIATELY at
   * registration, and its callback reads this through the `fullState` getter.
   * Declaring it later puts that first fire in the temporal dead zone — a boot
   * crash, not a subtle bug. */
  let lastFullState = null;

  /* ==> THE GEOMETRY PIPELINE (app/bundle-pipeline.js). <==
   *
   * `selected`, its held bundle and the stale-response sequence guard used to
   * be three more `let`s in this closure, which is exactly why the decoration
   * order they feed could never be tested. They live in there now and the only
   * doors are `select` / `retarget` / `clear` / `load`.
   *
   * CONSTRUCTED HERE, RIGHT AFTER THE ENGINE, and everything it needs that
   * does not exist yet arrives as a GETTER. `detailView` and `lastStorms` are
   * both declared further down; passing them by value would either force this
   * line down the file (and with it every caller) or read them in the temporal
   * dead zone. `applyLayerState` is a function declaration, so it is already
   * initialised whatever order the file is written in.
   *
   * `styleReady` STAYS OWNED HERE for the same reason it does with the theme
   * switch: deciding when the app may touch a style is this file's job. */
  const pipeline = createBundlePipeline({
    engine,
    isStyleReady: () => styleReady,
    storms: () => lastStorms,
    detail: () => detailView,
    applyLayerState,
  });

  /* Layer state lives in data/layer-prefs.js — persistence, exclusive-pair
   * enforcement, and the rule that an unshipped layer can never be switched
   * on. main.js only APPLIES it to the map. Two hand-rolled localStorage
   * functions and a loose `let graticuleOn` used to live here; sixteen layers
   * on that pattern is a drift bug waiting to happen (§12). */

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
   *
   * ==> AND IT HAS TO BE THE *BASEMAP'S* SOURCE, WHICH THIS DID NOT CHECK. <==
   *
   * Narrowing to "any source" was only ever half the fix. The map has several
   * sources: the basemap, one image source per satellite disc, and — since
   * radar became a tile layer — a radar source streaming thirty tiles a
   * viewport. A failure in ANY of them raised a banner that names the BASEMAP
   * specifically, which is the same false-and-specific message this comment was
   * written about, arriving through a different door.
   *
   * Aaron caught it on glass: radar tiles loading put "Basemap tiles are not
   * loading" on screen in red while the basemap was drawing perfectly. The
   * satellite discs could always have done the same thing; radar just made it
   * constant instead of occasional.
   *
   * EVERY OTHER SOURCE ALREADY OWNS ITS OWN ROW. `map/imagery.js` and
   * `map/radar-layer.js` both report through `setImageryStatus`, in their own
   * words, with re-tapping the segment as the retry. A second, wronger sentence
   * about the same failure in a different part of the screen helps nobody.
   */
  map.on('error', (e) => {
    console.warn('[landfall] map error', e?.error || e);
    if (e?.sourceId === BASEMAP_SOURCE) status.tileError();
  });

  /* The other half of the latch. MapLibre has no "recovered" event, so the
   * evidence has to be inferred — and the first attempt at inferring it was
   * wrong in the dangerous direction. `isSourceLoaded` alone CLEARED THE
   * MESSAGE WHILE THE NETWORK WAS CUT (caught by tools/offline-check.mjs): a
   * source with nothing left in flight reports itself loaded whether it
   * fetched anything or not, so "not loading" got erased in the one situation
   * where it was true.
   *
   * `e.tile` is the difference. Its presence means this event is about a
   * specific tile changing state rather than the source as a whole, which is
   * the closest thing MapLibre offers to "bytes arrived".
   *
   * ==> HALF-VERIFIED, AND HONEST ABOUT WHICH HALF. <== That it no longer
   * false-clears offline is proven by the check. That it DOES clear when a
   * flaky basemap comes back has not been seen — the sandbox has no route to
   * OpenFreeMap, so there is no healthy tile to observe. Worst case if the
   * inference is still too narrow is the old behaviour: the message sticks.
   * Judge it on glass by killing wifi, waiting for the message, and turning
   * wifi back on.
   *
   * Fires many times a second while tiles stream. The arbiter early-returns on
   * a boolean, so the cost when nothing is wrong is one property read. */
  map.on('sourcedata', (e) => {
    /* Same source filter as the error half, and for a sharper reason: a radar
     * tile arriving is not evidence that the BASEMAP came back. Without this,
     * one healthy radar tile would clear a genuine basemap outage message. */
    if (e?.sourceId === BASEMAP_SOURCE && e?.tile && e?.isSourceLoaded) status.tilesRecovered();
  });

  /* ==> THE DRAWER, THE FIVE VIEWS AND THE HOME MARKER (app/views.js). <==
   *
   * Two hundred and sixty lines of injected façades and callback plumbing used
   * to sit here. They are knotted together by CONSTRUCTION ORDER rather than
   * by logic — the layer-status store is built from a callback into the Layers
   * view, the drawer registers all five, the home subscription reads two of
   * them — and inside this closure that knot was invisible because every name
   * was simply in scope.
   *
   * CONSTRUCTED HERE, right after the pipeline it is handed. Everything it
   * needs that does not exist yet arrives as a GETTER (`lastStorms`,
   * `lastFullState`, `imagery`), the same rule that kept the pipeline split
   * from moving boot order. `warmDecksIfOn` is a function declaration, so it is
   * already initialised whatever order this file is written in — and handing
   * the warm ITSELF rather than its callback is what keeps the ended-storm
   * exclusion in exactly one place.
   *
   * The three ordering contracts that were buried in here — selection,
   * recenter, and the model-family mapping — are exported from that file and
   * asserted by `tools/test-views.mjs`. */
  const views = createViews({
    map,
    idle,
    pipeline,
    storms: () => lastStorms,
    fullState: () => lastFullState,
    imagery: () => imagery,
    warmDecks: warmDecksIfOn,
    warmShips: warmShipsIfOn,
    /* Both archive doors land here. A function DECLARATION below, so it is
     * initialised whatever order this file is written in — the same rule
     * `warmDecksIfOn` follows. */
    onOpenSeasons: enterSeasons,
  });
  const { drawer, stormsView, detailView, areaDetailView, layersView, homeMarker } = views;
  const { homeDashView } = views;
  const { selectStorm, selectArea, tapFloodAlert, recenterAndClear, refreshLayerStatus,
    applyHomeMarker } = views;

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
    if (b && !b.error) engine.ambientBundle(storm, pipeline.forMap(storm, b));
    const sel = pipeline.selected();
    if (sel && storm.id === sel.id) pipeline.repushSelected();

    refreshLayerStatus();
  }

  /** Warm every storm's deck, but ONLY while the layer is on: fetching
   *  megabytes for a layer nobody switched on is pure data spend on a phone,
   *  and this one ships off. */
  function warmDecksIfOn() {
    if (!toggleOn('modelTracks')) return;
    /* Ended storms are excluded for the same reason they are excluded from
     * geometry warming: their a-deck is gone from the ATCF directory, so every
     * poll would spend a request to be told nothing and data/adeck.js would
     * record a source failure for a storm that has simply finished. */
    const warmable = lastStorms.filter((s) => !isEnded(s));
    if (!warmable.length) return;
    warmModelTracks(warmable, onDeckLanded);
  }

  /** One SHIPS run landed. The ribbon draws AMBIENTLY, like guidance, so every
   *  run changes the map and is pushed to whichever presentation owns that
   *  storm. Incremental on purpose: each storm's cone colors as its run
   *  arrives rather than the whole set waiting on the slowest fetch. */
  function onShipsLanded(storm) {
    if (!styleReady) return;
    /* BOTH presentations, always. The engine holds its own copy of every
     * storm's bundle for the ambient merge and excludes whichever storm is
     * selected, so updating only the selection leaves that storm's ambient
     * copy uncolored — and the map looks right until you deselect. That
     * exact bug shipped once on model guidance; it is written down in
     * `onDeckLanded` above and this is the second layer it applies to. */
    const b = getGeometry(storm.id);
    if (b && !b.error) engine.ambientBundle(storm, pipeline.forMap(storm, b));
    const sel = pipeline.selected();
    if (sel && storm.id === sel.id) pipeline.repushSelected();

    refreshLayerStatus();
  }

  /** Warm every storm's SHIPS run, but ONLY while the layer is on — same gate
   *  and same reasoning as the decks above, and this layer also ships off.
   *
   *  ENDED STORMS ARE EXCLUDED for the same reason: an ended storm has no
   *  current run, so every poll would spend a request to be told nothing and
   *  data/ships.js would record a source failure for a storm that has simply
   *  finished. */
  function warmShipsIfOn() {
    if (!toggleOn('environment')) return;
    const warmable = lastStorms.filter((s) => !isEnded(s));
    if (!warmable.length) return;
    warmShips(warmable, onShipsLanded);
  }

  /**
   * Fetch the town list if we do not have it, and push it at the map when it
   * lands. Cheap to call repeatedly — data/population.js dedupes both the
   * completed array and the in-flight request.
   *
   * ==> THE CALLBACK PUSHES DATA, IT DOES NOT PUSH VISIBILITY. <== Someone can
   * switch the layer on and off again inside the download window. Re-asserting
   * visibility here would switch it back on under them; setting the data is
   * always correct regardless of what the switch is doing by then.
   */
  function ensurePopulation() {
    loadTowns(() => {
      const flat = townsOrNull();
      if (flat && styleReady) setPopulationTowns(map, flat);
    });
  }

  /** Fetch the national flood list and push it, if the switch is on (§48.21).
   *
   *  ==> GATED ON THE SWITCH, LIKE POPULATION AND UNLIKE EVERY FEED. <== There
   *  is no warm loop and no poll here. A reader who never turns the row on
   *  never asks the relay for this list, which is the whole reason the layer
   *  defaults off.
   *
   *  ==> AN OUTAGE MUST NOT PUSH AN EMPTY ARRAY. <== `setFloodAlerts(map, [])`
   *  draws a clean globe, and a clean globe is the correct picture for "nothing
   *  is in force" and a lie for "the list did not load". The layer's own header
   *  says never to call it with `[]` to stand for a failure; this is the caller
   *  that has to honour it. The words go up through the layer status row. */
  function ensureFlood() {
    loadFloodAlerts().then((slot) => {
      /* ==> THE SLOT GOES UP WHETHER OR NOT THE MAP LAYER IS ON (§56.17). <==
       * It used to be fetched only for the globe, so the `Flooding` section —
       * which §56.7 put on BOTH screens permanently — read a slot nothing ever
       * filled and printed "Checking flood alerts…" forever. A section that
       * renders every time but can only get data through an unrelated map
       * switch is broken by construction, and the sentence it printed was §5's
       * worst: a claim that a request is in flight when none is.
       *
       * ==> THE MAP PUSH STAYS GATED, AND THAT IS THE WHOLE COST ARGUMENT.
       * <== The list is small JSON the section needs anyway. Pushing it into a
       * MapLibre source is county-scale geometry crossing into the worker to
       * be tiled and parsed, which is real work for a layer nobody switched
       * on. Turning the switch on re-enters this function and pushes then. */
      /* The words go up FIRST and unconditionally — the row is the only place
       * an outage can be said out loud, and returning early on a failure below
       * would leave it saying whatever it said last. */
      /* ==> THE DRAWER READS THE SAME SLOT THE GLOBE DREW FROM, AND ONE CALL
       * SETS BOTH. <== Two fetches would be two answers either side of a
       * fifteen-minute cache boundary, and a panel counting nineteen alerts
       * over a map drawing eleven is the kind of disagreement that costs a
       * reader their trust in both. `layerStatus` lives in app/views.js and is
       * NOT in scope here — writing to it directly is what took the whole
       * layer-apply path down; see `setFloodSlot` there. */
      views.setFloodSlot(slot);
      /* ==> THE SWITCH IS NO LONGER CHECKED HERE, BECAUSE THE GATE MOVED INTO
       * THE LAYER (§56.5, Slice A). <== Handing the list over is one
       * assignment; the expensive half — matching it against this storm's track
       * and writing county-scale geometry into a MapLibre source — sits behind
       * the layer's own `visible` gate and is not paid by anyone who left the
       * row off. What this buys is that the list is already in hand the moment
       * somebody flips the switch, so `setVisible` can draw immediately instead
       * of leaving a dead control until the next poll. */
      /* ==> AND NOT ONTO THE ARCHIVE GLOBE. <== This is a promise chain, so it
       * can land seconds after it was started — including after somebody
       * pressed a door. `liveGlobe.show()` re-enters this function on the way
       * out, and the answer is still in `loadFloodAlerts`'s cache, so nothing
       * is lost by declining here. */
      if (slot.state !== 'ok' || !styleReady || isArchive()) return;
      setFloodAlerts(map, slot.alerts);
    });
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
    /* Population is furniture too, but it is the one piece that has to fetch
     * before it can draw. Visibility is pushed unconditionally so switching
     * OFF works with no data present; the fetch is kicked only when on. */
    setPopulationVisible(map, toggleOn('population'));
    if (toggleOn('population')) ensurePopulation();
    /* The engine's key differs from the pref key, so the manifest states the
     * mapping rather than the two being assumed identical. */
    for (const t of LAYER_TOGGLES) {
      if (t.engineKey) engine.setToggle(t.engineKey, toggleOn(t.key));
    }
    /* ==> UNCONDITIONAL NOW, AND THE `else` THAT USED TO BLANK IT IS GONE
     * (§56.17). <== Visibility is pushed by the engine loop above, so
     * switching the layer OFF still works with no data present. What changed
     * is that the FETCH is no longer the switch's to gate: the `Flooding`
     * section renders on both screens every time, so the list is simply what
     * that section costs. The layer status row is still cleared correctly on
     * the way through — `setFloodSlot` passes the switch's real state to
     * `layerStatus.setFloodAlerts`, which drops the row whenever it is off, so
     * an outage sentence cannot survive under a switch nobody has touched.
     *
     * Calling this on every layer change is free: `loadFloodAlerts` holds one
     * answer per client TTL and folds concurrent callers into one request. */
    ensureFlood();
    /* ==> GENESIS IS THE ONE LAYER THAT DRAWS IN BOTH ENGINES, SO ITS TOGGLE
     *     HAS TO REACH BOTH. <== The loop above only speaks to MapLibre layer
     * ids; the planet-band glyphs live in the 3D globe. Without this line,
     * switching the row off removed the hatched patches and left the triangles
     * on screen — a control that half works, which reads as a bug rather than
     * as a second layer. Not guarded on `styleReady`: the 3D engine exists
     * from boot, and this whole function already returns early without it. */
    g3d.watchMarks.setVisible(toggleOn('genesis'));
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
   * `on`, NOT `once`, AND IT STAYS `on` EVEN THOUGH THE CALLER THAT NEEDED IT
   * IS GONE. A theme change used to call `map.setStyle`, which threw away
   * every source and layer the app had added and fired `style.load` again;
   * with `once` the second style would have come up as a bare basemap — no
   * storm dots, no cone, no track, a live hurricane silently missing because
   * someone switched to light mode. Theming is `map.setGlobalState` now and
   * never replaces the style, so in the shipped app this fires exactly once.
   *
   * `on` is kept because `once` would encode "the style is only ever built
   * here" as a fact, and it is not one — it is a property of today's callers.
   * The cost of `on` is zero; the cost of `once` is that the next thing to
   * replace a style fails the way described above, silently.
   *
   * SO THIS FUNCTION MUST STILL BE SAFE TO RUN MORE THAN ONCE. Everything in
   * it either creates a source/layer (which a restyle would have just deleted,
   * so there is nothing to collide with) or pushes state back into one.
   * Nothing in here registers a map event listener — those are one-time, and
   * they live below.
   * ---------------------------------------------------------------------- */
  function installOnStyle() {
    markers = addStormMarkers(map);
    markers.update(lastStorms);

    /* Imagery attaches with the markers and BEFORE the geometry engine, so its
     * raster sits at the bottom of everything the app draws — above the
     * basemap's land fill, below the coastline glow and every track and cone
     * (§13 draw order). */
    /* Population heat installs BEFORE imagery and the markers, because it is
     * the bottom of the app's own stack — it anchors to 'coast-core' and
     * everything else anchors above that. It comes up empty; the towns are
     * pushed in by ensurePopulation() whenever they land, including on a
     * restyle, when this rebuild is exactly what needs refilling. */
    addPopulationLayer(map);
    setPopulationTowns(map, townsOrNull());

    imagery = addStormImagery(map, { onStatus: (row) => views.setImageryStatus(row) });
    imagery.update(lastStorms.filter((s) => !isEnded(s)));
    /* Apply whatever the sliders were left on before the map existed. The
     * subscription below fires immediately too, but it may have fired while
     * `imagery` was still null. */
    pushImageryTuning();

    /* Selection layers attach AFTER the markers so the beforeId anchor
     * ('storm-dot-planet') exists and the geometry stacks under the dots —
     * severity color stays on top (§6). Same style.load-not-load rule as the
     * markers: a basemap outage must never blind the storm layers (§5). */
    styleReady = true;
    /* THE GLOBE IS NOW TOUCHABLE. Not "the page painted" — the moment the map
     * style is installed and input does something. mark() keeps the first
     * value, so a later restyle re-running this cannot overwrite the real
     * boot number. */
    perfMark('globe');
    /* THE BOOT SCREEN LEAVES HERE, on exactly the milestone above and not on a
     * timer of its own. "Touchable" is the honest moment to hand over: the map
     * is installed and input does something. Waiting for storms would hold a
     * splash over a working globe during a slow feed, and the app already has
     * an honest way to say the oceans are still being checked. */
    boot.done();
    engine.attach();
    /* AFTER `engine.attach()`, so the archive's tracks sit beneath everything
     * the engine added and beneath the storm dots — step 6 puts landfall marks
     * and name labels on top of them, and a layer added later cannot get back
     * underneath. It draws nothing until somebody opens the archive. */
    const archiveAnchor = map.getLayer('storm-dot-planet') ? 'storm-dot-planet' : undefined;
    /* ==> THE FOOTPRINT GOES IN FIRST, SO IT IS THE BOTTOM OF THE ARCHIVE'S
     * OWN STACK. <== It is a wash ABOUT a track, so the track has to sit on
     * top of it — a 1.75 px line under a translucent fill is a line the reader
     * cannot follow, and following it is the whole job of the archive globe.
     * Same "insert directly beneath layer X" mechanic as the two below. */
    ensureSeasonSwath(map, archiveAnchor);
    ensureSeasonTracks(map, archiveAnchor);
    /* ==> THE DOTS GO IN UNDER THE NAMES, NOT UNDER THE STORM DOTS. <== The
     * archive's own stack, bottom to top, is track line → dots → name labels,
     * and MapLibre only understands "insert directly beneath layer X".
     * Anchoring the dots to the name layer is what keeps a selected storm's
     * fixes ON its track rather than under it, while leaving the name — the
     * thing that identifies which storm this is — on top of everything. */
    ensureSeasonPoints(map, map.getLayer('season-track-name') ? 'season-track-name' : archiveAnchor);
    /* ==> THE CLOCK'S HEAD GOES IN LAST, SO IT IS THE TOP OF THE ARCHIVE'S OWN
     * STACK. §57.67 slice E. <== Anchored back to `archiveAnchor` rather than to
     * a season layer: MapLibre inserts directly beneath the layer it is given,
     * so the last thing inserted before the same anchor sits above everything
     * inserted before it. The head is the storm's position at the moment on
     * screen and nothing in the archive has a better claim to be over it. */
    ensureSeasonHead(map, archiveAnchor);
    applyLayerState();

    /* ==> THE MILTON SURGE FIXTURE, IF THIS PAGE ASKED FOR IT. <== Inert in
     * the shipping app: `fixtureAdvisory()` reads a global that only
     * surge/boot.js sets, and only on `?surge=milton`.
     *
     * It rides the AMBIENT path with a synthetic storm id rather than a
     * selection, because there is no storm — Milton is a fixture for one
     * layer, not a replay, so nothing is in the store to select. The engine
     * merges ambient features per layer key, so the surge layer picks these
     * up through exactly the code a real storm's surge would. */
    if (fixtureAdvisory()) {
      fetchSurgeFixture(fixtureAdvisory())
        .then(({ fc, dropped }) => {
          if (dropped) console.warn(`[landfall] surge fixture: ${dropped} features dropped`);
          engine.ambientBundle(
            { id: FIXTURE_STORM_ID },
            { layers: { surge: { status: 'ok', fc, error: null } } }
          );
        })
        .catch((e) => console.error('[landfall] surge fixture failed:', e?.message || e));
    }

    /* GENESIS REPLAYS TOO, and it has to be here rather than left to the next
     * poll. The store fires its subscription immediately at registration and
     * every 30 minutes after; the areas can therefore have landed a long time
     * before `style.load`, and the push above the poll is guarded on
     * `styleReady`. Without this line a slow basemap would come up with a
     * correct watch list in the drawer and a bare ocean beside it, for up to
     * half an hour — the list and the globe disagreeing, which is the exact
     * thing polling both on one tick was meant to prevent. */
    if (lastFullState?.genesis?.status !== 'unavailable') {
      setGenesisAreas(map, lastFullState?.genesis?.areas || []);
    }

    /* A selection made before the style was ready replays from cache. On a
     * RESTYLE this is what puts the open storm's cone and track back. */
    const sel = pipeline.selected();
    if (sel) pipeline.load(sel);
    /* AND SO DOES EVERY OTHER STORM. Geometry warmed before `style.load` is
     * sitting in the cache with nothing on screen — the ambient painter
     * declined it because the style was not ready yet. This is the other half
     * of that guard: without it, a cold start where the feed beats the basemap
     * leaves every unselected storm's cone and track missing until the next
     * poll, and a storm whose geometry arrived in that window would never
     * paint at all. Cheap — it reads bundles already in memory. */
    pipeline.repushAmbient();
  }

  map.on('style.load', installOnStyle);

  /* --- one-time input wiring ------------------------------------------------
   * OUTSIDE the style.load handler, deliberately. These are listeners on the
   * MAP, not on the style, so they survive setStyle — and registering them
   * inside a handler that now runs on every theme change would stack a second
   * copy of every one of them each time, which is how a single tap ends up
   * selecting a storm twice.
   * ---------------------------------------------------------------------- */

  /* ==> HOW LONG THE LAST PRESS ON THE GLOBE LASTED. §57.21d. <==
   *
   * MapLibre already refuses to fire `click` once the pointer has MOVED
   * `TAP.movePx` or more between down and up — that is `clickTolerance`, and
   * it is passed from `config/constants.js` in `map/globe.js`. So everything
   * hanging off `map.on('click')` gets movement discrimination outright and
   * the app needs exactly one movement threshold rather than two that have to
   * agree.
   *
   * WHAT MAPLIBRE DOES NOT GATE ON IS TIME. A press held still for a second —
   * a drag the globe declined to follow, or a thumb resting on the glass while
   * its owner reads the sheet — arrives as an ordinary click. That must not
   * minimise the sheet somebody was trying to pan the globe behind.
   *
   * ON THE CANVAS CONTAINER, WHICH IS WHAT MAKES IT HONEST. A press on the
   * drawer or the archive's bar never touches this element, so the clock only
   * ever measures presses on the globe itself.
   *
   * POINTER EVENTS, NOT `touchstart` PLUS `mousedown` (§13). One path for a
   * finger, a mouse and a stylus, and no device sniffing. Multi-touch simply
   * re-stamps the clock per pointer, which costs nothing: a pinch moves, so
   * MapLibre has already declined to call it a click. */
  let pressStartedAt = 0;
  map.getCanvasContainer().addEventListener(
    'pointerdown',
    () => { pressStartedAt = performance.now(); },
    { passive: true }
  );

  /**
   * A tap landed on the archive's globe and resolved to nothing. §57.21d.
   *
   * ==> IT DOES WHATEVER IS IN FRONT OF IT, AND THAT IS TWO ANSWERS RATHER
   * THAN ONE. <== Aaron on glass, 2026-08-25.
   *
   *   SHEET UP   -> minimise it.
   *   SHEET DOWN -> clear the focus, every track back to even.
   *
   * ==> THE FIRST VERSION HAD ONLY THE FIRST HALF AND THAT SHIPPED A DEAD
   * GESTURE. <== It opened `if (!drawer.isOpen()) return;`, so with the sheet
   * already down a tap on empty water did NOTHING AT ALL — not minimise,
   * because there was nothing to minimise, and not un-focus, because that had
   * just been removed in favour of the roster. The only road left to an
   * un-dimmed globe was the bar, then the board, then the row: three presses
   * to undo one. The rule was read as "the roster owns un-focus" without
   * anybody checking what the gesture did in the state where there is no sheet.
   *
   * ==> AND IT IS STILL ONE TAP, ONE VISIBLE OUTCOME, WHICH IS THE WHOLE
   * REASON (b) WAS CHOSEN OVER (a). <== The two answers are in different
   * STATES, not in one gesture. From "sheet up with a storm focused" it is two
   * taps to a clean globe and they escalate outward — deal with the sheet,
   * then the globe underneath it — rather than both happening at once, which
   * is the thing readers report as a glitch.
   *
   * ==> AND ONLY IF THIS WAS ACTUALLY A TAP. <== See the clock above for why
   * duration is asked and movement is not. Both answers are behind that gate:
   * a failed drag must not un-focus a storm any more than it may dismiss a
   * sheet.
   *
   * ==> "OUTSIDE THE DRAWER" IS MEASURED, NEVER A HEIGHT. <==
   * `map/chrome-avoid.js` reads the furniture's real boxes off the DOM, which
   * is what lets one rule cover both shapes the drawer takes: docked to the
   * bottom on a phone, so outside it means above it; docked left on a wide
   * screen, so outside it means beside it. A hardcoded height would have been
   * wrong on the second one and wrong again the moment `--seasons-sheet-h`
   * moved (§57.21b).
   *
   * ==> PADDED BY HALF A TOUCH TARGET, AND THE SLOP IS THE POINT. <== A thumb
   * aimed at the drawer's own top edge lands a few pixels above it, and
   * minimising the sheet is the destructive answer to that. Inside the slop
   * strip the tap does nothing at all, which is the right failure: a press
   * that achieves nothing costs one more press, and a press that dismisses the
   * sheet somebody was reaching into costs them the sheet.
   *
   * ==> THE FURNITURE IS MEASURED THE SAME WAY WITH THE SHEET DOWN, AND THAT
   * MATTERS FOR THE UN-FOCUS TOO. <== `#drawer[data-open="true"]` simply
   * stops matching, so the sheet's old box is gone from the list — but the
   * archive's bar and the control cluster are still in it, and a press on
   * either must not quietly un-focus a storm behind them.
   *
   * THE MEASUREMENT IS TAKEN HERE RATHER THAN HELD. It is one
   * `getBoundingClientRect` pass on a handful of elements, on a tap — not in a
   * frame loop — and the boxes move whenever the year steps or the window
   * turns, so a cached copy would be wrong exactly when it mattered.
   */
  function tapOnEmptyArchiveWater(e) {
    if (performance.now() - pressStartedAt > TAP.maxMs) return;
    const slop = parseInt(SIZE.touchTarget, 10) / 2;
    if (occludedByChrome(e.point.x, e.point.y, measureChrome(slop, TAP_BLOCKING_SELECTORS))) {
      return;
    }
    if (drawer.isOpen()) drawer.close();
    else focusSeasonStormNow(null);
  }

  /* Tap/click a storm dot — same action as a list row (SPEC §16). The 44 px
   * hit box lives in stormAtPoint; cursor feedback rides layer hover.
   * Tapping empty ocean CLOSES the drawer (§16) — the camera and the
   * drawn geometry hold. */
  map.on('click', (e) => {
    /* ==> THE ARCHIVE ANSWERS FIRST AND RETURNS EITHER WAY. <== Inside
     * Seasons the globe is a different world: there are no live storm dots,
     * no watched areas and no flood chips on it, and every branch below this
     * one is about a layer the archive deliberately hides. Falling through
     * would mean a tap on empty parchment running three `queryRenderedFeatures`
     * calls looking for things that are not there, and — worse — closing the
     * drawer, which in the archive is the reader's only way back out.
     *
     * ==> AND INSIDE IT THERE IS ONE ORDERED LIST, WRITTEN ONCE. §57.21d. <==
     * Glyph, then track, then empty water. NOW.md called this out as one piece
     * of work rather than two, and the order is the argument: without the
     * glyph test in front, a tap on a hurricane glyph resolves to nothing and
     * falls through to the empty-water branch — which would minimise the sheet
     * on the exact gesture that is supposed to open the storm.
     *
     * The two hit-tests do not compete. The glyph answers only at the space
     * floor, where it is at full strength (`SEASONS.glyphTapMaxPhase`), and
     * the track owns every zoom from there in. Nothing is lost at the seam
     * because the glyph is stamped on the track's own first fix.
     *
     * ==> AND BOTH HIT-TESTS NOW LEAD TO THE SAME PLACE: THE STORM'S PANEL,
     * WITH THE CAMERA ON ITS FIRST FIX. §57.21e. <== Aaron's call, 2026-08-28.
     * The track used only to brighten, which made ONE mark on this globe mean
     * two different things depending on how far in the reader had zoomed —
     * open the storm out at the space floor, merely light it once the glyph
     * had faded. That is the seam reading as a bug rather than as a handover.
     * The order below survives because it is about WHICH STORM the pixels
     * resolve to, not about what happens next; the answer to that is one
     * answer now. */
    if (isArchive()) {
      const glyphId = seasonGlyphAtPoint(map, e.point, seasonGlyphList);
      if (glyphId) {
        openSeasonStormNow(glyphId);
        return;
      }

      const trackId = seasonStormAtPoint(map, e.point);
      if (trackId) {
        openSeasonStormNow(trackId);
        return;
      }

      /* ==> EMPTY WATER ANSWERS WHATEVER IS IN FRONT OF IT: THE SHEET IF IT IS
       * UP, THE FOCUS IF IT IS DOWN. <== Aaron's call, 2026-08-25, and the
       * correction to it on glass the same day. The rule and the reason it is
       * two answers rather than one are on the function itself. */
      tapOnEmptyArchiveWater(e);
      return;
    }

    /* HOME IS ASKED FIRST. The glyph takes no pointer events so that a drag
     * starting on it still spins the globe (map/marker-home.js), which means
     * its taps arrive here instead. Ahead of the storm test because the house
     * is drawn ON TOP: what is visibly in front should win, and a storm dot
     * under the house is still reachable from the list. */
    if (homeMarker.hitTest(e.point)) {
      homeMarker.activateMarker();
      return;
    }
    const id = stormAtPoint(map, e.point);
    const storm = id && lastStorms.find((s) => s.id === id);
    if (storm) {
      selectStorm(storm);
      return;
    }

    /* ==> FLOOD CHIPS GO AFTER STORMS AND BEFORE GENESIS, AND THE ORDER IS THE
     * SAME RULE THE TWO BRANCHES ABOVE STATE: WHAT IS VISIBLY IN FRONT WINS.
     * <== A chip is a deliberate 24 px mark; a watched area is a soft patch
     * hundreds of miles across drawn below everything. Testing genesis first
     * would let the patch underneath swallow a tap aimed at a chip sitting on
     * top of it, which is the exact failure the storm/genesis order already
     * exists to prevent. Storms still win over both — a storm dot is the one
     * thing on this globe that must never lose a tap.
     *
     * ==> AND THIS COSTS NOTHING WHEN THE SWITCH IS OFF, WHICH IS THE WHOLE
     * PERFORMANCE ARGUMENT FOR PUTTING A FOURTH HIT TEST HERE. <== Every tap
     * on the globe already runs three `queryRenderedFeatures` calls, including
     * the taps on empty ocean whose only job is closing the drawer. A fourth
     * paid by every reader would be a real cost for a layer most never turn on.
     * `floodAtPoint` asks the layer's own `visible` flag on its first line and
     * returns, so for those readers this branch is one boolean read. */
    if (tapFloodAlert(floodAtPoint(map, e.point))) return;

    /* ==> GENESIS IS TESTED AFTER STORMS, ALWAYS. <== A watched area is drawn
     * BELOW every storm layer (§45.4) and it is enormous — hundreds of miles
     * across — so a storm sitting inside or beside one would lose its tap to
     * the patch underneath it if this ran first. What is visibly in front
     * wins, the same rule the home marker states two branches up. */
    const areaId = genesisAtPoint(map, e.point);
    const area = areaId && lastFullState?.genesis?.areas?.find((a) => a.id === areaId);
    if (area) {
      selectArea(area);
      return;
    }

    if (drawer.isOpen()) drawer.close();
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
  /* ==> THE FLOOD CHIP IS IN THIS LIST NOW, BECAUSE SLICE C MADE IT TAPPABLE.
   * <== A mark that opens a panel and does not change the cursor reads as
   * decoration on a desktop, and a reader who never learns it is pressable
   * never presses it. `FLOOD_LAYER_IDS` is spread rather than the chip named
   * on its own: the fill and the outline are not hit-tested, but hovering them
   * is hovering the same alert, and a cursor that changed over the mark and
   * not over the shape it belongs to would be the fussier answer. */
  for (const id of ['storm-dot-planet', 'sel-fpoints', 'amb-fpoints',
                    ...GENESIS_HIT_LAYERS, ...FLOOD_LAYER_IDS]) {
    map.on('mouseenter', id, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', id, () => {
      map.getCanvas().style.cursor = '';
    });
  }

  /* --- THEME ---------------------------------------------------------------
   * The switch itself lives in app/theme-switch.js; this is the wiring. It
   * needs both engines and the layer engine, which is why it cannot be
   * constructed until here — `applyTokens` ran at the very top of boot,
   * before either engine existed, because the chrome half needs nothing but
   * the DOM.
   *
   * `styleReady` IS NO LONGER PART OF THIS, and that is the point of the change
   * underneath it. The switch used to throw the basemap style away and report
   * that it had, so this file could drop the flag and re-raise it on the next
   * `style.load`; it now repaints the basemap with `map.setGlobalState` and the
   * layer list is never disturbed. The style is never not ready, so there is no
   * `engine` to invalidate and no `onStyleRebuild` to answer. `styleReady`
   * still exists and is still owned here — it is what gates the engine before
   * the FIRST `style.load` — it simply has nothing to do with theming.
   * ---------------------------------------------------------------------- */
  const theme = createThemeSwitch({
    map,
    g3d,
    prefersLight,
    /* MODEL GUIDANCE IS THE ONE MAP COLOR A THEME FLIP CANNOT REPAINT. The
     * line reads `['get', '_color']` — the color belongs to each FEATURE,
     * resolved by `modelColor()` when the guidance was pushed, so there is no
     * paint property holding it and nothing for global state to change. The
     * fix is to push the same bundles again; they are already in memory, so it
     * is a re-render and not a fetch. This used to happen by accident, as part
     * of the full `style.load` reinstall a `setStyle` triggered. */
    onRepushGuidance: () => {
      pipeline.repushSelected();
      pipeline.repushAmbient();
      /* GENESIS IS THE THIRD OF THESE AND THE LAST ONE ALLOWED. Its patch
       * colors are baked into the features for the same reason the guidance
       * lines' are — a paint property holding both a `global-state` ref and a
       * `['get']` resolves to BLACK rather than throwing (map/theme-state.js,
       * rule 1b). Free: the areas are already in memory. app/theme-switch.js
       * sets three as the ceiling for this list; a fourth is the signal to
       * build the real repaint path rather than to add a line here. */
      rethemeGenesis(map);
      /* ==> NOT A FOURTH ENTRY IN THE SENSE THE NOTE ABOVE WARNS ABOUT. <== The
       * ceiling is on FEATURE RE-PUSHES — rebuilding a whole collection to
       * change a hue. Flood alerts (§48.21) read the note and took the other
       * road: two colours, a `['case']` paint expression with no `global-state`
       * in it, and a retheme that is two `setPaintProperty` calls touching no
       * geometry at all. If a FIFTH layer wants to bake colours into features,
       * that is still the signal to build the real repaint path. */
      rethemeFlood(map);
    },
  });

  /* Follow the SETTING. One subscription: whether the theme changed, the units
   * changed, or a slider moved, `apply` re-resolves and returns immediately
   * unless the live mode actually differs. Cheaper than a dedicated theme
   * store and impossible to get out of step with one. The OS listener is wired
   * inside the switch, beside the resolution it feeds. */
  subscribeSettings(theme.apply);

  /* THE MODEL PICKER'S SWATCHES ARE THEMED, so the panel has to redraw when the
   * theme does. Guidance colors are the one §6-adjacent set that changes with
   * the theme (config/tokens.js explains why), and the swatch comes from the
   * same `modelColor()` the lines do — but a panel already on screen holds the
   * old hexes in its markup. The map re-bakes its own features through
   * installOnStyle; this is the other half. First consumer of
   * `subscribeThemeChange`, which existed with none. */
  subscribeThemeChange(() => layersView.refresh());

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
    /* Same rule, same subscription: switching Environment on starts its warm,
     * and the repush below is what turns an already-warmed run into color. */
    warmShipsIfOn();
    pipeline.repushSelected();
    pipeline.repushAmbient();
    refreshLayerStatus();
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
    /* ==> NOT WHILE THE ARCHIVE IS OPEN. <== The cage is the live storms'
     * ridge, and a poll landing behind the sepia globe would push it back onto
     * a world that is supposed to have nothing on it. `liveGlobe.show()`
     * calls this again on the way out, off `lastFullState`, which is still
     * being kept current the whole time. */
    if (isArchive()) return;
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
            /* The warm cache is the ridge's source of track data for a LIVE
             * storm. A miss is normal and honest — the storm keeps its live-fix
             * peak until its bundle lands, at which point the callback above
             * calls back in here (map/storm-mesh.js).
             *
             * ==> AN ENDED STORM COMES FROM THE REGISTRY, and this fallback was
             * MISSING when §5's ended state shipped. `repushAmbient` and the
             * warm loop both got it; the cage did not, so after a RELOAD an
             * ended storm drew its track on the map and stayed perfectly flat on
             * the globe — the trail and the ridge disagreeing about the same
             * storm, which reads as a rendering bug rather than as a state.
             *
             * In-session it looked fine, which is why it survived review: the
             * warm cache still held the geometry from when the storm was alive.
             * Only a reload — the exact case the registry is persisted FOR —
             * exposed it. */
            bundleFor: (s) => (isEnded(s) ? endedBundle(s.id) : getGeometry(s.id)),
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
    homeDashView.unitsChanged();
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

  /* Only TRANSITIONS are sent, never the steady state — the rule and the
   * reasoning live in app/source-status.js, out here where a test can reach
   * them. This is the wiring: the reporter is handed the one function that
   * knows where a telemetry event goes. */
  const sourceReporter = createSourceReporter(reportSource);

  /* One subscription fans out to every surface. The store fires immediately
   * with current state, so late-arriving surfaces don't wait for a poll. */
  subscribe((state) => {
    lastStorms = state.storms;
    lastFullState = state;

    /* ==> THE ARCHIVE GATE, AND IT IS ON THE GLOBE PUSHES ONLY. <== Polling
     * carries on behind the archive — stopping it would mean leaving into a
     * stale app and waiting a whole cycle for it to catch up — and the panels
     * and the telemetry below carry on with it, so a source outage that starts
     * while somebody is reading 2005 is still counted and still on the status
     * strip when they come back.
     *
     * What must NOT happen is the poll painting live storms onto a globe that
     * is supposed to have nothing on it. `liveGlobe.show()` re-pushes all four
     * of these from `lastFullState` on the way out.
     *
     * ==> AND NOTHING HERE IS "CLEARED" BY PUSHING AN EMPTY ARRAY. <== An
     * empty push to the watched-area layer is exactly what a genuine all-clear
     * looks like, so `liveGlobe.hide()` owns the emptying and this only
     * declines to undo it. */
    const live = !isArchive();

    if (markers && live) markers.update(state.storms);

    /* ==> THE WATCH LIST GOES TO THE GLOBE HERE, AND ONLY WHEN THE ANSWER IS
     *     A REAL ONE. <== (§45.)
     *
     * `status === 'unavailable'` is deliberately NOT pushed as an empty array.
     * An empty push draws an empty ocean, and an empty ocean is what
     * `none_matched` looks like — so an outage would render as an all-clear,
     * which is the single failure this whole feature exists to prevent. On an
     * outage the previous patches HOLD, exactly as a storm's last-good
     * geometry does, and the drawer section and the status strip carry the
     * outage in words. There is no such thing as drawing an outage.
     *
     * Guarded on `styleReady` for the same reason every other push here is:
     * the source does not exist until the layer engine has attached. */
    if (live && styleReady && state.genesis?.status !== 'unavailable') {
      setGenesisAreas(map, state.genesis?.areas || []);
    }

    /* ==> AND TO THE 3D GLOBE, WHICH IS THE ONE THAT IS ACTUALLY ON SCREEN
     *     WHEN THE APP OPENS. <== (§45.4.)
     *
     * MapLibre's canvas is at opacity 0 at the space floor, so the push above
     * is invisible at the boot zoom. The rings are what a watched area looks
     * like out there, and they hand over to the patch on the crossfade.
     *
     * NOT GUARDED ON `styleReady`: the 3D engine exists from boot and owns its
     * own buffers, unlike the MapLibre source which does not exist until the
     * style loads. Same `unavailable` rule though — an outage holds the last
     * marks rather than clearing them, because a cleared globe is what
     * `none_matched` looks like. */
    if (live && state.genesis?.status !== 'unavailable') {
      g3d.watchMarks.setAreas(state.genesis?.areas || []);
    }
    /* ==> ENDED STORMS GET NO IMAGERY. <==
     *
     * Satellite and radar are LIVE-CONDITIONS overlays. Anchoring one to the
     * last known position of a storm that finished thirty hours ago paints
     * current cloud tops over a dead coordinate and invites the reader to read
     * the two as one thing — the storm is still there, look at it. That is a
     * sharper version of the contradiction the silence pass already flagged
     * (live Himawari over a frozen track), and where silence could live with it
     * because the storm might still be out there, this one cannot: the agency
     * has said it is finished.
     *
     * It also stops paying for tiles on a storm nobody is tracking. */
    if (imagery && live) imagery.update(state.storms.filter((s) => !isEnded(s)));

    /* ==> THE TWO MILESTONES THAT SPLIT THE BLAME. <==
     * `data` is the first moment ANY source left `loading`, whatever it
     * resolved to — an empty basin is a real and fast answer, and treating
     * "no storms" as "still waiting" would make a healthy quiet day look like
     * a hang. `storms` is the first frame with something actually on screen.
     *
     * globe -> data is the network and upstream. data -> storms is ours.
     * Without both, a slow load is one number nobody can act on. */
    if (anySourceResolved(state.sources)) perfMark('data');
    /* `live` here too: the mark means "the first frame with a storm actually on
     * screen", and a deep link into the archive puts the app past this line
     * with an empty globe. Marking it there would put a fast, meaningless
     * number into the boot staircase. */
    if (markers && live && state.storms?.length) perfMark('storms');
    stormsView.update(state);
    /* The home dashboard re-picks its threat storm on every poll — the one
     * bearing down can change between advisories, and the whole screen is
     * about that pick. It no-ops when it is not on screen. */
    homeDashView.update(state);
    /* The area panel republishes its own figures when a poll lands. It holds
     * the last known numbers for an area that has left the outlook rather
     * than blanking under someone reading it — see its `update`. */
    areaDetailView.update(state);
    status.feedHealth(sourceHealthMessage(state.sources));

    /* TELEMETRY: a source CHANGING state, never its current state (§17 A5). */
    sourceReporter.update(state.sources);

    /* The detail view refreshes in place (or goes ghost — its call), and the
     * pipeline is then pointed at the same fresh object the panel is holding:
     * a new advisory (or a new JTWC warning) refetches its geometry, an
     * unchanged one just keeps the two copies from drifting apart. The test
     * for "changed" is `needsRefetch` in app/bundle-pipeline.js — the same key
     * the geometry cache itself uses, which is what makes it §7's promised
     * self-invalidation rather than a special case. */
    detailView.update(state);
    pipeline.reconcile(detailView.current());

    /* WARM the geometry for every NHC storm (§9): tracks and cones are
     * ambient ladder detail, so they draw without anyone tapping anything,
     * and selection becomes a cache hit instead of a spinner. Incremental —
     * each bundle paints as it lands rather than waiting for the slowest
     * storm. Prune first so a dissolved storm's cone never lingers as
     * confident ambient detail. Cheap on repeat emits: warmGeometry is
     * cache-first and skips anything already resolved for its current
     * advisory. */
    /* ==> THE FIXTURE'S ID RIDES ALONG OR THE PRUNE EATS IT. <== This drops
     * any ambient bundle whose storm has left the feed, and it runs on every
     * poll. The Milton surge fixture is not a storm and is not in `state.storms`,
     * so without this it painted at boot and vanished at the first poll —
     * indistinguishable, on a phone, from a layer that never drew at all.
     * Inert in the shipping app: `fixtureAdvisory()` is null there. */
    const liveIds = new Set(state.storms.map((s) => s.id));
    if (fixtureAdvisory()) liveIds.add(FIXTURE_STORM_ID);
    engine.ambientPrune(liveIds);

    /* ==> ENDED STORMS ARE PUSHED, NEVER WARMED. <==
     *
     * Warming them would fetch geometry that no longer exists — NHC's bin is
     * flushed, GDACS's event archived — and data/warm.js reads an empty answer
     * as a source problem, so a finished storm would keep an outage row alive in
     * the Layers view every poll for 24 hours. It would also spend a request per
     * storm per poll to learn nothing.
     *
     * They still need pushing, because their bundle comes from the registry
     * rather than the warm cache, and nothing else on this path would ever hand
     * it to the engine. The cage rebuild below covers them: `refreshCage` runs
     * unconditionally at the end of this emit. */
    const ended = state.storms.filter((s) => isEnded(s));
    const warmable = state.storms.filter((s) => !isEnded(s));
    /* ==> `live` HERE TOO, AND THIS IS THE PUSH THAT UNDID THE ARCHIVE EVERY
     * CYCLE. §57.21c. <== `liveGlobe.hide()` prunes the ambient bundles on the
     * way in; this loop put a finished storm's track straight back on the next
     * poll, so even a correct entry lasted at most one cycle. The storms keep
     * arriving and `lastFullState` keeps them — what stops is the PAINTING. */
    if (styleReady && live) {
      for (const s of ended) {
        const b = endedBundle(s.id);
        if (b && !b.error) engine.ambientBundle(s, pipeline.forMap(s, b));
      }
    }

    /* ==> AND THE ONE EXCEPTION TO "NEVER WARMED", WHICH IS NOT A WARM. <==
     *
     * A storm that ended by going QUIET is still in its source's list — that is
     * what a lapse means — so unlike a declared or absent one it still has
     * publishable geometry sitting there. A device that arrived after the storm
     * went quiet has an empty track and can never fill it any other way; see
     * data/ended-track.js for the measurement.
     *
     * NOT AWAITED. It runs beside the push above rather than in front of it, so
     * a slow payload cannot delay drawing the storms already on screen. A repair
     * writes through the lifecycle listeners and comes back round as a normal
     * store emit, which is why nothing here has to handle the result. */
    backfillEndedTracks(ended);

    warmGeometry(warmable, (storm, bundle) => {
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
      /* ==> AND THE ARCHIVE GATE, WHICH IS ASKED HERE RATHER THAN READ OFF
       * `live` ABOVE. §57.21c. <== This callback fires when a bundle lands,
       * which can be minutes after the emit that started the warm — long
       * enough for somebody to have pressed a door in between. `live` is the
       * answer from the moment the fetch STARTED, and using it would paint a
       * cone onto a sepia globe on the strength of a question asked before the
       * reader was even in there. `isArchive()` is the answer now.
       *
       * ==> THE FETCH IS NOT GATED, ONLY THE PAINT. <== Warming carries on
       * behind the archive on purpose, so `liveGlobe.show()` has a full cache
       * to repush from and leaving lands on current weather rather than on a
       * globe that has to fill itself in over the next poll.
       *
       * `refreshCage()` below goes with it: it rebuilds the LIVE cage from
       * `lastStorms`, which in here would flatten the season's ridge and put
       * this week's mountains up in its place. */
      if (isArchive()) return;
      /* Decorated on the way in, so a storm whose deck warmed FIRST does not
       * have its guidance wiped when its geometry lands afterwards. The two
       * warm loops run independently and either can finish first. */
      engine.ambientBundle(storm, pipeline.forMap(storm, bundle));
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
    warmShipsIfOn();

    refreshCage();
  });

  /* ==> THE FLOOD LIST IS ASKED FOR HERE TOO, OUTSIDE THE MAP'S CONTROL
   * (§56.17). <== `applyLayerState()` also calls this, but it returns early
   * until the style is installed — so a basemap outage would leave the
   * `Flooding` section on both screens sitting at "Checking flood alerts…"
   * with nothing coming, which is the exact sentence §56.17 exists to delete.
   * §5's rule is that one source going down must never blind another, and the
   * flood relay has nothing to do with the tile host. Duplicate calls cost
   * nothing: `loadFloodAlerts` holds one answer per client TTL. */
  ensureFlood();

  /* =========================================================================
   * PAST STORMS — the archive globe (§57.16, §57.30 step 4).
   *
   * ==> ONLY THREE THINGS ABOUT IT ARE ON THE BOOT PATH: the flag, the two
   * door rows, and the function below. <== Everything else — the bar, the deep
   * link, the palette forcing, the exit — is behind `await import(...)` and is
   * fetched the first time somebody presses a door (§57.35 fault 4). Every
   * import in every file ships to every visitor, and taxing every boot forever
   * for a feature most sessions never open is the cost that audit exists to
   * stop.
   * ====================================================================== */

  /**
   * What the archive needs the LIVE app to do, and nothing more.
   *
   * ==> INJECTED RATHER THAN IMPORTED, SO `seasons/` NEVER REACHES INTO `map/`
   * OR `data/`. <== The storm dots, the watched areas, the imagery and the 3D
   * cage are all owned here; the archive only knows they should be off. That
   * keeps the import direction one-way (§12) and — the part that matters more
   * — it means the list of things the archive hides is written down in exactly
   * one place. A layer added to the globe next month that nobody adds here
   * shows up ON the archive globe, which is a bug you can SEE, rather than
   * hiding somewhere in a module that imported the wrong thing.
   *
   * `show()` re-pushes from `lastFullState`, which the poll keeps current the
   * whole time the archive is open — so leaving lands on the CURRENT weather,
   * not on the weather from the moment of entry.
   */
  /**
   * The archive's own geometry. Same injection shape and same reason as
   * `liveGlobe` below: `seasons/` never imports `map/` (§12), so this file
   * owns HOW a track is drawn and the archive owns WHEN.
   *
   * ==> THE SOURCE IS ADDED AT `style.load`, NOT ON FIRST ENTRY. <== MapLibre
   * inserts a layer relative to one already in the style, and by the time
   * somebody presses a door the marker anchor is buried under everything the
   * engine added. Adding it with the rest is what keeps the archive's tracks
   * BENEATH the storm dots that step 6 will put on top of them.
   */
  /**
   * Where the archive's hurricane glyphs are right now. §57.21d.
   *
   * ==> IT LIVES BESIDE THE FACADE THAT FILLS IT, NOT NEAR THE TAP HANDLER
   * THAT READS IT. <== `setTracks` and `clearTracks` are the only two writers
   * and they are the mirror of each other; putting the declaration between
   * them is what makes a future third writer obvious.
   */
  let seasonGlyphList = [];

  const archiveGlobe = {
    /**
     * @param {Array} selected the ticked storms
     * @param {Map<string, object>|null} [cut] the season clock's answer for
     *   each of them at one moment, from `clockFrameAt`. §57.67 slice C.
     *   Omitted or null, every storm draws its whole life, which is what the
     *   archive does whenever the clock is not engaged.
     */
    setTracks(selected, cut = null) {
      if (!styleReady) return;
      /* ==> THE TIPS COME BACK OUT OF THE TRACKS AND GO STRAIGHT INTO THE HEAD.
       * §57.67 slice E. <== The head stands on the last vertex of the drawn
       * trail rather than on the clock's own interpolated position (§57.67e), so
       * it needs an answer only the push that drew the trail has. Carried
       * forward in one expression, it cannot be a step behind. */
      const tips = setSeasonTracks(map, selected, cut);
      /* ==> ONE CALL FROM THE ARCHIVE'S POINT OF VIEW, TWO SOURCES UNDERNEATH,
       * AND THAT SPLIT STAYS ON THIS SIDE OF THE INJECTION. <== The board
       * knows one thing: which storms are ticked. Handing it a `setPoints` of
       * its own would mean a second call it could forget to make, and a globe
       * showing tracks with no dot on a one-record storm is a silent wrong
       * answer rather than a visible one. */
      setSeasonPoints(map, selected, cut);
      /* THE FOOTPRINT ONLY REMEMBERS THE SET HERE; it draws nothing until
       * something is focused (§57.26a). Handed the same list for the same
       * reason as the marks — one call the board cannot forget to make.
       *
       * ==> AND THE CUT, WHICH IT DID NOT TAKE AT SLICE B. <== That was named
       * a known gap at the time (§57.67e) because widening slice B would have
       * put a third layer in one commit. Slice C is the first slice where a
       * reader can focus a storm mid-scrub, so it is where the gap is paid: all
       * three archive layers now read one moment or none of them do. */
      setSeasonSwathSet(map, selected, cut);
      /* ==> AND THE HEAD, WHICH DRAWS ONLY WHILE THE CLOCK IS ENGAGED. <== With
       * no cut there is no current moment for a mark to stand at, so it pushes
       * an empty set rather than branching here — the same shape every other
       * call on this list keeps. */
      setSeasonHead(map, selected, cut, tips);
      /* ==> AND THE 3D CAGE, WHICH IS THE ONE PIECE OF THIS THAT IS NOT
       * MAPLIBRE. §57.21c. <== The archive globe was flat until now: entering
       * calls `liveGlobe.hide()`, which flattens the ridge on purpose, and
       * nothing ever put anything back. So a ticked season had tracks, dots
       * and names at close zoom and NOTHING at all out at the space floor,
       * where the cage and its glyphs are the whole globe.
       *
       * NOT GUARDED ON `styleReady`, unlike the three calls above. The 3D
       * engine exists from boot and owns its own buffers; it is the MapLibre
       * sources that do not exist until the style installs. Same split the
       * poll's own watched-area pushes make.
       *
       * `'ok'` rather than a state read from anywhere: this is not a feed. The
       * storms are in memory, parsed out of a file that already arrived, so
       * there is no outage for the cage to desaturate over. Whether the season
       * could be read at all is the roster's question and it answers it in
       * words. */
      g3d.heightfield.setStormPoints('ok', buildSeasonMeshPoints(selected));
      /* ==> AND WHERE EACH OF THOSE GLYPHS IS, FOR THE TAP HANDLER. §57.21d.
       * <== Built here rather than in the tap path because it changes only
       * when the ticked set changes, which is rare, while a tap can happen at
       * any moment — and the alternative is asking the board for its entries
       * inside a click handler, which would put a `seasons/` call on the one
       * path that has to answer within a frame. `setTracks` is already the
       * single call the board cannot forget to make, so this rides it for the
       * same reason the dots and the footprint do.
       *
       * NOT GUARDED ON `styleReady`, like the cage above it: this is a plain
       * array, not a MapLibre source. The hit-test that reads it asks the map
       * for a projection and answers null when there is nothing to project. */
      seasonGlyphList = seasonGlyphs(selected);
    },
    /** Which storm the reader has opened in full detail; null puts them all
     *  back evenly. §57.21 item 2. */
    setFocus(id) {
      if (!styleReady) return;
      setSeasonTrackFocus(map, id);
      /* ==> TWO OF THE THREE REBUILD RATHER THAN REPAINT. <== The tracks swap
       * a paint property over geometry MapLibre already holds. The dots and
       * the footprint hold at most one storm's shapes, so a selection change
       * IS new data for both. Measured at 12-13 ms a storm for the footprint,
       * which is what makes that affordable on the archive's most frequent
       * interaction; the dots are forty features and cost less again. */
      setSeasonPointFocus(map, id);
      setSeasonSwathFocus(map, id);
      /* A repaint, like the tracks — one paint property over a handful of
       * features MapLibre already holds. */
      setSeasonHeadFocus(map, id);
    },
    clearTracks() {
      if (!styleReady) return;
      clearSeasonTracks(map);
      clearSeasonPoints(map);
      clearSeasonSwath(map);
      clearSeasonHead(map);
      /* ==> AND THE RIDGE COMES DOWN WITH THEM. §57.21c. <== `setTracks` put
       * it up and this is its mirror. Without it, leaving the archive keeps
       * 1935's mountains standing until `liveGlobe.show()`'s `refreshCage()`
       * lands — and that is a frame of the wrong world on the way out, which
       * is exactly what the ordering in `seasons/index.js`'s `leave()` is
       * arranged to avoid everywhere else.
       *
       * NOT GUARDED ON `styleReady` in its own right — the guard above covers
       * the whole method — but note it does not need one: the 3D engine owns
       * its own buffers and exists from boot. */
      g3d.heightfield.setStormPoints('ok', []);
      /* The mirror of `setTracks`. A held list would leave a tap on empty
       * parchment opening a storm off a globe that no longer draws it. */
      seasonGlyphList = [];
    },

    /**
     * Point the camera at the archive on the way in. §57.21c, item 5.
     *
     * ==> THE MEASUREMENTS ARE TAKEN HERE, AT CALL TIME, AND NOT IN
     * `map/season-frame.js`. <== That file is pure arithmetic and testable
     * without a browser; this is the composition root and it is the only side
     * of the wall that is allowed to touch the DOM. `seasons/` calls it and
     * never learns that a drawer has a height (§12).
     *
     * `idle.interrupt()` first, or the resting globe's per-frame `setCenter`
     * stomps the flight — the same reason `frameHome` in `app/views.js` does
     * it, and the archive's globe is idling by definition because nobody has
     * touched it yet.
     */
    flyToEntry({ from, basin }) {
      idle.interrupt();
      return flyToArchiveEntry(map, {
        from,
        basin,
        home: getHome(),
        offset: archiveOffset(),
      });
    },

    /**
     * Frame one storm above the sheet. §57.21c, item 4.
     *
     * Takes POINTS rather than a storm or an id: `seasons/` owns the roster
     * and `map/` owns the camera, and a list of coordinates is the smallest
     * thing that crosses between them.
     */
    flyToStorm(points) {
      idle.interrupt();
      return flyToArchiveStorm(map, points, { offset: archiveOffset() });
    },
  };

  /**
   * Which storms the live app is still drawing in colour, for the archive.
   * §57.21c.
   *
   * ==> IT IS THE LIVE GLOBE'S OWN GREYING RULE, NOT A SECOND OPINION. <==
   * Aaron's call, 2026-08-25. `reportingStormIds` is built on the same
   * `noCurrentReading` that turns a storm dot grey out there — ended, or
   * silent past §5's threshold — so the archive takes that verdict rather than
   * running its own clock over the b-deck. A reader who watched Iselle go grey
   * on the live globe opens 2026 and finds her drawn as history, because those
   * are the same fact.
   *
   * ==> NULL RATHER THAN AN EMPTY SET WHEN THE FEED HAS NEVER ANSWERED. <==
   * §5. A deep link into `?season=2026` runs this before the first poll has
   * landed, and "no storms" and "we have not been told" are the same empty
   * list with opposite meanings. The board falls back to the b-deck age test
   * on null; handing it an empty set instead would say, confidently and
   * wrongly, that every storm this year has finished.
   */
  const liveRunningIds = () => {
    if (!lastFullState) return null;
    return reportingStormIds(lastStorms || []);
  };

  /**
   * Where a flight's centre should land while the archive's sheet is up.
   * §57.21c.
   *
   * ==> THE SAME MEASUREMENT EVERY OTHER FLIGHT IN THE APP MAKES, THROUGH THE
   * SAME FUNCTION. <== `panelOffsetFor` is `app/views.js`'s, and the reason to
   * borrow it rather than write a second one is that the archive's board is
   * the same drawer element as every other panel — a second copy of this
   * arithmetic would drift the day the breakpoint moves and the symptom would
   * be the archive alone framing storms behind its own sheet.
   *
   * ==> MEASURED AT CALL TIME, NOT HELD. <== `offsetHeight` ignores the slide
   * transform, so it is stable mid-animation; and both callers open or have
   * already opened the drawer, so "where will the sheet be" is the right
   * question. The board's height changes with the year (that is push 2's
   * item 1), so a cached number would be wrong the moment somebody stepped
   * the year.
   */
  const archiveOffset = () =>
    panelOffsetFor({
      ...drawer.box(),
      wide: window.matchMedia('(min-width: 720px)').matches,
    });

  const liveGlobe = {
    hide() {
      markers?.update([]);
      /* Guarded on `styleReady` for the same reason every other push to this
       * layer is: the source does not exist until the style has installed. */
      if (styleReady) setGenesisAreas(map, []);
      g3d.watchMarks.setAreas([]);
      imagery?.update([]);
      /* The cage flattens rather than holding its last shape. It is the one
       * surface here that is a HEIGHT rather than a mark, and a ridge left
       * standing over an empty sepia globe reads as a rendering fault. */
      g3d.heightfield.setStormPoints('ok', []);
      /* Flood polygons are US ground truth about this week's water. Nothing
       * about them belongs over 1935. */
      if (styleReady) setFloodAlerts(map, []);
      /* ==> AND THE AMBIENT GEOMETRY, WHICH IS THE HALF THIS FUNCTION MISSED
       * FOR AS LONG AS THE ARCHIVE HAS EXISTED. §57.21c. <==
       *
       * Everything above is a MARK: a dot, a patch, a picture, a height. The
       * ambient bundles are the LINES — every live storm's past track, its
       * cone, its wind field and its model guidance — and they belong to the
       * layer engine rather than to any of the handles above, so emptying all
       * five left them drawn. The result was 2005's sepia roster underneath
       * this week's cones, in any year the reader opened.
       *
       * `ambientPrune(new Set())` rather than a push of empty collections: it
       * drops every bundle AND runs each layer's `forget` hook, which is what
       * clears the coastal band caches that would otherwise hold their last
       * shapes. An empty push would leave those behind.
       *
       * SAFE TO DO ON THE WAY IN BECAUSE `show()` HAS A REAL WAY BACK. The
       * bundles live in the geometry cache and the ended-storm registry, not
       * in the engine, so `repushAmbient()` rebuilds them from memory without
       * a fetch — and it is the same restore path `style.load` already uses,
       * which is a road known to work rather than one written for this. */
      engine.ambientPrune(new Set());
    },
    show() {
      const state = lastFullState;
      markers?.update(lastStorms || []);
      if (state && styleReady && state.genesis?.status !== 'unavailable') {
        setGenesisAreas(map, state.genesis?.areas || []);
      }
      if (state && state.genesis?.status !== 'unavailable') {
        g3d.watchMarks.setAreas(state.genesis?.areas || []);
      }
      if (state) imagery?.update(state.storms.filter((st) => !isEnded(st)));
      refreshCage();
      /* The flood layer refills itself from its own cache — `ensureFlood` holds
       * one answer per TTL, so this is a re-push and not a fetch. */
      ensureFlood();
      /* ==> AND THE LINES COME BACK. <== The mirror of the prune in `hide()`.
       * Reads the geometry cache and the ended-storm registry, both of which
       * the poll has kept current the whole time the archive was open — so a
       * reader who spent twenty minutes in 1935 leaves onto this afternoon's
       * cones rather than onto the ones that were up when they went in. */
      pipeline.repushAmbient();
    },
  };

  /**
   * The loaded Seasons module, once a door has been pressed.
   *
   * ==> A STASHED REFERENCE RATHER THAN A SECOND `import()`, BECAUSE THE
   * CALLER IS A TAP HANDLER. <== Repeating the dynamic import inside the click
   * path would make focusing a track an async operation with a network hop in
   * the failure case, on a module that is by definition already loaded — you
   * cannot tap an archive track without having opened the archive. Null until
   * then, and the one caller below simply does nothing while it is.
   */
  let seasonsMod = null;

  /**
   * A tap on open water cleared the focus, every track back to even. §57.21e.
   *
   * ==> ONLY EVER CALLED WITH NULL NOW, AND IT KEEPS THE ID PARAMETER ANYWAY.
   * <== The track branch above used to call this with a storm; §57.21e sent it
   * to `openSeasonStormNow` instead, which leaves the clear as the one caller.
   * Narrowing the signature to `clearSeasonFocus()` would be a rename across
   * the wall into `seasons/` for no behaviour, and the export on the other side
   * is documented as taking "an id, or null for all of them evenly" — so the
   * shape stays and this comment carries the fact.
   *
   * ==> IT GOES TO THE BOARD, NOT STRAIGHT TO THE GLOBE. <== Clearing the
   * focus here would even out the tracks while the roster went on showing a
   * row still lit, and the roster is the thing the reader believes about what
   * is selected (`map/layers/season-tracks.js` makes the same argument about
   * ticking). The board owns focus; it tells the globe. One direction.
   */
  function focusSeasonStormNow(id) {
    seasonsMod?.focusSeasonStorm?.(id ?? null);
  }

  /**
   * A tap on the archive's globe chose a storm — glyph or track. §57.21d,
   * §57.21e.
   *
   * ==> BOTH HIT-TESTS COME HERE, AND THAT IS THE POINT OF §57.21e. <== The
   * globe is owned here and the archive is owned over there, so a tap has to
   * come back up. What it lands on is `seasons/index.js`'s `openSeasonStorm`,
   * which is the very function the roster row's chevron runs — so a glyph tap,
   * a track tap and a chevron press are ONE behaviour rather than three that
   * look alike today. The panel's own `onOpen` ticks and focuses the storm on
   * the way in, so the brightening the track tap used to do by itself is not
   * lost; it now arrives with the sheet and the flight.
   */
  function openSeasonStormNow(id) {
    seasonsMod?.openSeasonStorm?.(id);
  }

  /**
   * Open the archive. Both door rows call this; so does a `?season=` link.
   *
   * A FUNCTION DECLARATION, so it is initialised whatever order this file is
   * written in — `createViews` above is handed it by name, hundreds of lines
   * earlier. The same rule `warmDecksIfOn` follows.
   *
   * ==> A FAILED IMPORT SAYS SO. <== The module is fetched over the network on
   * first press, so a reader on a bad connection can press a door and get
   * nothing at all. That is the silence §5 forbids, and it is the exact shape
   * of failure a dynamic import introduces — so the catch puts a real sentence
   * on the status strip rather than a console line nobody sees.
   */
  function enterSeasons(fromEl) {
    /* ==> WHICH DOOR WAS PRESSED, READ OFF THE ELEMENT ITSELF. §57.21c item 5.
     * <== §57.16 already stamps `data-door` on the two rows — the one under
     * the live storm list and the one at the foot of the home dashboard — and
     * this is the first thing to read it. The archive's camera opens on the
     * BASIN from the storm list and on HOME from the dashboard, because those
     * two readers were looking at different things a moment ago.
     *
     * Optional chaining the whole way down: a deep link passes no element at
     * all, and `undefined` is a case `map/season-frame.js` already answers. */
    const from = fromEl?.dataset?.door || null;
    import('./seasons/index.js')
      .then((mod) => {
        seasonsMod = mod;
        mod.openSeasons({
          liveGlobe,
          archiveGlobe,
          drawer,
          recenterAndClear,
          liveRunningIds,
          from,
          fromUrl: false,
          returnFocusTo: fromEl || null,
        });
      })
      .catch((e) => {
        console.error('[landfall] Past storms did not load:', e);
        setStatus('Past storms did not load. Check your connection and try again.', TONE.ERROR);
      });
  }

  /* ==> A `?season=` LINK OPENS STRAIGHT INTO IT. <== §57.16. The check is a
   * presence test rather than a parse, deliberately: `seasons/deep-link.js`
   * does the validating and it must not be on the boot path either, so the
   * cheapest possible question is asked here and the module decides what the
   * answer means — including whether the year is one the record actually has.
   *
   * AFTER `startPolling` below would be wrong: the first poll would paint the
   * live globe and the archive would then empty it, which is a visible flash
   * of the wrong world on the one load that asked for the other one. */
  if (new URLSearchParams(location.search).has('season')) {
    import('./seasons/index.js')
      .then((mod) => {
        seasonsMod = mod;
        mod.openSeasons({
          liveGlobe, archiveGlobe, drawer, recenterAndClear, liveRunningIds, fromUrl: true,
        });
      })
      .catch((e) => {
        console.error('[landfall] Past storms did not load:', e);
        setStatus('That link points at Past storms, which did not load.', TONE.ERROR);
      });
  }

  startPolling();

  // Lift the boot veil once the clear globe has a frame on glass.
  requestAnimationFrame(() => {
    document.getElementById('veil').dataset.lifted = 'true';
  });

  /* --- controls -----------------------------------------------------------
   * WHAT A CLUSTER PRESS MEANS IS `clusterAction`, IN ui/drawer.js, AND NOT
   * HERE. Four outcomes — close, go, push, swap — chosen from what is already
   * on screen. Storms and Home are destinations and always start fresh; Layers
   * and Settings are side trips and land on top of whatever you were reading,
   * so Back returns to it. The full reasoning is at the head of that file; the
   * table of all four cases is tools/test-drawer-nav.mjs.
   *
   * ==> IT LIVES THERE BECAUSE IT COULD NOT BE TESTED HERE. <== This runs
   * inside boot()'s closure with a live map and a real DOM, so the rule was
   * unassertable — and its failure mode is silent. A `go` where a `push`
   * belonged does not throw; it drops the Back button, which is exactly the
   * bug that hid in this loop for a month.
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
      /* ==> INSIDE THE ARCHIVE, STORMS MEANS THE ARCHIVE'S OWN DRAWER. §57.37,
       * §57.38b. <== It used to be hidden in here, because opening the LIVE
       * storm list over a sepia globe lists storms that are not drawn (§5).
       * Step 5 gave it a job about the world on screen instead: it reopens the
       * archive's ladder at the rung the reader left. Home and Layers stay
       * hidden — neither has an archive equivalent to be given.
       *
       * The archive answers for itself and says whether it did, rather than
       * this file testing a mode flag: `seasons/` owns what its controls mean,
       * and a `false` here is the ordinary live-globe case. */
      if (viewId === 'storms' && seasonsMod?.reopenArchiveDrawer?.()) return;
      const act = clusterAction(viewId, {
        open: drawer.isOpen(),
        currentId: drawer.currentId(),
      });
      if (act === 'close') drawer.close();
      else if (act === 'go') drawer.go(viewId, undefined, { from: btn });
      else drawer.push(viewId, undefined, { from: btn, replaceTop: act === 'swap' });
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

  /* The compass/crosshair button. Owns its own DOM and its own bearing state
   * (map/view-control.js); this hands it the two jobs it can do. */
  createViewControl({
    map,
    onRecenter: recenterAndClear,
    onInterrupt: () => idle.interrupt(),
  });

  /* First-run nudges: set-your-home, then the install hint once home exists.
   * One-time each; all state and rules live in ui/first-run.js. */
  createFirstRun({
    host: document.getElementById('nudge-host'),
    /* STRAIGHT TO THE SETUP FLOW, not to the dashboard. This nudge exists for
     * a reader who has no home yet, and its entire ask is "set one" — landing
     * them on a dashboard that can only say "set a home" would make the nudge
     * cost two taps to do the one thing it is for. */
    onOpenHome: () =>
      drawer.go('home-setup', undefined, { from: document.getElementById('btn-home') }),
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
    /* The drawer, so a browser check can navigate the app the way a finger
     * does rather than by showing a hidden host directly. tools/
     * drawer-scroll-check.mjs asserts that entering a view resets its scroll,
     * and that reset lives inside `enter()` — a check that poked the DOM would
     * step around the exact line it is there to verify. */
    drawer,
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
