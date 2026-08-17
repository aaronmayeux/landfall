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
import { createViews, recenterTarget } from './app/views.js';
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
/* The geometry fetchers, the geometry cache and the pure bundle decorators all
 * left with app/bundle-pipeline.js. What stays here is what the CAGE and the
 * ambient deck push still read directly. */
import { getGeometry } from './data/cache.js';
import { warmGeometry } from './data/warm.js';
import { warmModelTracks } from './data/adeck.js';
import { warmShips } from './data/ships.js';
import { isEnded } from './lib/lifecycle.js';
import { endedBundle } from './data/lifecycle.js';
import { backfillEndedTracks } from './data/ended-track.js';
import { IMAGERY, GLOBE } from './config/constants.js';
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

  const engine = createLayerEngine(map);
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
   */
  map.on('error', (e) => {
    console.warn('[landfall] map error', e?.error || e);
    if (e?.sourceId) status.tileError();
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
    if (e?.sourceId && e?.tile && e?.isSourceLoaded) status.tilesRecovered();
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
  });
  const { drawer, stormsView, detailView, areaDetailView, layersView, homeMarker } = views;
  const { homeDashView } = views;
  const { selectStorm, selectArea, recenterAndClear, refreshLayerStatus, applyHomeMarker } = views;

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
          /* ==> AND POINT THE CAMERA AT IT. <== 2026-08-16. The globe opens
           * whereever the reader left it — for a Hawaii storm, half a planet
           * from Milton's Florida coast. The fixture painted correctly, off
           * screen, under a banner announcing 14 areas, and that was read as
           * the layer being broken. A harness whose subject is not in frame
           * is not a harness. Centre only, no zoom change: how surge reads at
           * the reader's own zoom is exactly what is being judged. */
          const lons = [];
          const lats = [];
          for (const f of fc.features) {
            const stack = [f.geometry?.coordinates];
            while (stack.length) {
              const n = stack.pop();
              if (!Array.isArray(n)) continue;
              if (typeof n[0] === 'number' && typeof n[1] === 'number') {
                lons.push(n[0]); lats.push(n[1]);
              } else for (const c of n) stack.push(c);
            }
          }
          if (lons.length) {
            map.flyTo({
              center: [
                (Math.min(...lons) + Math.max(...lons)) / 2,
                (Math.min(...lats) + Math.max(...lats)) / 2,
              ],
              speed: GLOBE.flyToSpeed,
              curve: GLOBE.flyToCurve,
            });
          }
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

  /* Tap/click a storm dot — same action as a list row (SPEC §16). The 44 px
   * hit box lives in stormAtPoint; cursor feedback rides layer hover.
   * Tapping empty ocean CLOSES the drawer (§16) — the camera and the
   * drawn geometry hold. */
  map.on('click', (e) => {
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
  for (const id of ['storm-dot-planet', 'sel-fpoints', 'amb-fpoints', ...GENESIS_HIT_LAYERS]) {
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
    if (markers) markers.update(state.storms);

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
    if (styleReady && state.genesis?.status !== 'unavailable') {
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
    if (state.genesis?.status !== 'unavailable') {
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
    if (imagery) imagery.update(state.storms.filter((s) => !isEnded(s)));

    /* ==> THE TWO MILESTONES THAT SPLIT THE BLAME. <==
     * `data` is the first moment ANY source left `loading`, whatever it
     * resolved to — an empty basin is a real and fast answer, and treating
     * "no storms" as "still waiting" would make a healthy quiet day look like
     * a hang. `storms` is the first frame with something actually on screen.
     *
     * globe -> data is the network and upstream. data -> storms is ours.
     * Without both, a slow load is one number nobody can act on. */
    if (anySourceResolved(state.sources)) perfMark('data');
    if (markers && state.storms?.length) perfMark('storms');
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
    if (styleReady) {
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
