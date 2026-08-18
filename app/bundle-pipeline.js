/**
 * bundle-pipeline.js — EVERY path from a geometry bundle to the map.
 *
 * §12: `app/` is the composition layer. It may import from anywhere; nothing
 * imports from it except main.js. This file reaches `data/` (the cache, the
 * two fetchers, the ended-storm registry), `lib/` (the pure decorators) and is
 * handed the map engine and the detail view — three layers at once, which is
 * exactly what `app/` exists for.
 *
 * ==> WHY THIS IS ITS OWN FILE <==
 * It lived inside boot()'s closure sharing `selected`, `selectedBundle`,
 * `geometrySeq`, `styleReady` and `lastStorms` with everything else in there,
 * which is why nothing in it could be tested. The DECORATION ORDER in
 * `forMap` is the load-bearing rule in the whole app for silenced and ended
 * storms — get it backwards and a warmed a-deck paints five-day guidance
 * across a storm nobody has published a fix for since yesterday — and until
 * this file existed there was no way to write an assertion about it.
 * `tools/test-bundle-pipeline.mjs` now does.
 *
 * ==> `forMap` DOES NOT MOVE TO `lib/`, EVEN THOUGH IT IS NEARLY PURE. <==
 * It is the ordering contract, and its whole value is sitting next to the two
 * functions that call it. Separated from them, the order gets reversed by
 * somebody who does not know why it matters.
 *
 * WHAT THIS FILE OWNS: `selected`, `selectedBundle` and the sequence guard.
 * Those three are the pipeline's own business and nothing outside should be
 * able to write them — the four verbs below (`select`, `retarget`, `clear`,
 * `load`) are the only doors.
 *
 * WHAT IT DOES NOT OWN: `styleReady` and the storm list. Both have a dozen
 * readers in main.js and `styleReady` is reset by the theme switch, so both
 * arrive as getters.
 */

import { fetchStormGeometry, geometryLagged } from '../data/nhc-mapserver.js';
import { fetchGdacsGeometry } from '../data/gdacs-geometry.js';
import {
  getGeometry,
  getGeometryRecord,
  putGeometry,
  evictGeometry,
  geometryNeedsFetch,
  geometryKeyOf,
} from '../data/cache.js';
import { getAdeck } from '../data/adeck.js';
import { getShips } from '../data/ships.js';
import { modelOn as isModelOn, toggleOn } from '../data/layer-prefs.js';
import { palette } from '../config/theme.js';
import { CACHE } from '../config/constants.js';
import { buildRibbon } from '../lib/cone-ribbon.js';
import { endedBundle } from '../data/lifecycle.js';
import { tracksToFeatures } from '../lib/adeck.js';
import { isSilent } from '../lib/silence.js';
import { isEnded } from '../lib/lifecycle.js';
import { withoutFuture } from '../lib/future-slots.js';
import { smoothTracks } from '../lib/trackline.js';
import { smoothCone } from '../lib/cone-smooth.js';

/* ---------------------------------------------------------------------------
 * THE DECORATORS — pure, and injected rather than reaching for their own
 * imports, so a test can drive them with a fixed deck and a fixed model
 * selection instead of whatever is in localStorage.
 * ------------------------------------------------------------------------- */

/* --- Phase 6 step 5: model guidance tracks -------------------------------
 *
 * The a-deck is fetched and cached by data/adeck.js on its OWN schedule
 * (warmed for every storm while the layer is on), so it lands independently of
 * the MapServer geometry bundle. The map layer, though, reads a bundle slot
 * like every other layer — that is what keeps map/ from importing data/ (§12)
 * and what let the layer register without touching the engine.
 *
 * This function is the join: it hands the engine a bundle with the warmed
 * tracks folded in as one more slot. A SHALLOW COPY, never a mutation — the
 * bundle is a cached object shared with the ambient collections and the cage's
 * ridge builder, and writing into it would leak model tracks into surfaces
 * that never asked for them.
 *
 * @param {object} storm
 * @param {object|null} bundle
 * @param {{deckFor: Function, modelOn: Function}} deps
 * ---------------------------------------------------------------------- */
export function withModelTracks(storm, bundle, { deckFor, modelOn }) {
  if (!bundle) return bundle;
  const result = deckFor(storm.advisoryKey);
  /* Nothing warmed yet is `none` rather than an omission: the slot must exist
   * so the layer's own `status === 'ok'` test resolves to a clean empty rather
   * than reading `undefined` off a missing key. */
  const slot =
    result?.status === 'ok'
      ? {
          status: 'ok',
          /* Filtered by the user's selection HERE rather than in a style
           * expression — see the note in lib/adeck.js. */
          fc: tracksToFeatures(result.tracks, modelOn),
          error: null,
        }
      : {
          status: result?.status === 'unavailable' ? 'unavailable' : 'none',
          fc: null,
          error: result?.error || null,
        };
  return { ...bundle, layers: { ...bundle.layers, modelTracks: slot } };
}

/* --- §47: the environment ribbon -----------------------------------------
 *
 * The same join as model guidance, one slot along. The SHIPS run is fetched
 * and cached by data/ships.js on its own schedule, so it lands independently
 * of the geometry bundle; the map layer reads a bundle slot like every other
 * layer, which is what keeps map/ from importing data/.
 *
 * ==> IT MUST RUN AFTER `smoothCone`, AND THAT IS NOT A PREFERENCE. <== The
 * slices are built from the stations the cone REBUILD is assembled from, and
 * those only exist once the rebuild has run. Called before it, this would find
 * no ribs on every storm and silently draw nothing at all — a failure that
 * looks exactly like a basin SHIPS does not cover.
 *
 * ==> THE COLOR IS RESOLVED HERE, AGAINST THE ACTIVE PALETTE. <== It cannot
 * be a paint property: an expression holding both a themed `global-state`
 * reference and a `['get']` resolves to BLACK, silently, in both themes
 * (map/theme-state.js, rule 1b). Baking it per feature is what model guidance
 * and the genesis patches already do, and it costs nothing to retheme —
 * main.js's `onRepushGuidance` re-pushes every bundle, which runs this again
 * against the new palette. NO fourth entry on that file's exceptions list.
 *
 * A SHALLOW COPY, never a mutation — the bundle is a cached object shared with
 * the ambient collections and the cage's ridge builder.
 *
 * @param {object} storm
 * @param {object|null} bundle
 * @param {{shipsFor: Function, ribbonOn: Function}} deps
 * ---------------------------------------------------------------------- */
export function withEnvRibbon(storm, bundle, { shipsFor, ribbonOn }) {
  if (!bundle) return bundle;

  /* OFF MEANS NOT BUILT, not built-and-hidden. The layer ships off, so on the
   * common path this is the whole cost of the feature: one boolean per bundle.
   * The slot is still written, because a layer reading `undefined` off a
   * missing key is the bug the model-tracks slot documents. */
  if (!ribbonOn()) {
    return { ...bundle, layers: { ...bundle.layers, environment: OFF_SLOT } };
  }

  const result = shipsFor(storm?.advisoryKey);
  const built = buildRibbon({
    ribs: bundle.layers?.cone?.ribs || null,
    caps: bundle.layers?.cone?.caps || null,
    forecast: bundle.forecast || [],
    run: result?.status === 'ok' ? result.run : shipsStatusToRun(result),
    stops: palette().geo.envRamp,
    /* The sea the forecast line has to stay visible against. Resolved HERE
     * with the ramp, for the same reason and in the same breath — see the note
     * above on why color is baked per feature rather than left to a paint
     * expression. The line takes the cone's own ramp and is lifted only where
     * it would dissolve into this (lib/cone-ribbon.js `liftToLegible`). */
    sea: palette().ocean,
  });

  const slot =
    built.status === 'ok'
      ? { status: 'ok', fc: { type: 'FeatureCollection', features: built.features },
          reason: null, fromHr: built.fromHr, toHr: built.toHr, error: null }
      : { status: 'none', fc: null, reason: built.reason, fromHr: null, toHr: null,
          error: result?.error || null };

  return { ...bundle, layers: { ...bundle.layers, environment: slot } };
}

const OFF_SLOT = Object.freeze({
  status: 'none', fc: null, reason: 'off', fromHr: null, toHr: null, error: null,
});

/**
 * data/ships.js's four states, in the shape lib/cone-ribbon.js reads.
 *
 * The two files speak different vocabularies on purpose: `data/ships.js` names
 * what the FETCH found, `lib/cone-ribbon.js` names what the RELAY answered,
 * and the relay's own words are what the parser and the route already use.
 * This is the one seam between them, so there is exactly one place the two
 * vocabularies meet rather than one of them leaking across three files.
 */
function shipsStatusToRun(result) {
  if (!result) return null;                                    // nothing warmed yet
  if (result.status === 'basin') return { status: 'basin_not_covered' };
  if (result.status === 'no_run') return { status: 'no_run_published' };
  return { status: 'unavailable' };
}

/* --- the one gate every bundle passes through before it is drawn ---------
 *
 * THREE decorations, in a fixed order, and the order is the whole point.
 *
 * 1. Model tracks are folded in FIRST so that the future-slot emptying can
 *    then take them straight back out. Reversing it would let a warmed a-deck
 *    paint five-day guidance across a storm nobody has published a fix for
 *    since yesterday — the exact confident-future problem this rule exists to
 *    remove, arriving through the one slot that does not come from the
 *    geometry fetch.
 *
 * 2. Dropping the future, for a storm that is SILENT or ENDED. One test, one
 *    call, no ordering between them: both states want the identical geometry
 *    and the difference between them is entirely in what the app SAYS
 *    (lib/silence.js vs lib/lifecycle.js). Two branches doing the same thing
 *    here is how one of them later gets a slot the other does not.
 *
 * 3. Track smoothing runs LAST, on whatever survived. Such a storm has no
 *    forecast track left, so it gets a smoothed history and no connector to a
 *    forecast — which is right, because the leg joining those two is a claim
 *    about where the storm is going. It DOES get a leg to its last known
 *    position, which is a different claim entirely and one the source made:
 *    that is where the storm was when somebody last looked, and it is where the
 *    grey X is drawn. Without it the trail stops short of its own mark with
 *    open water in between. Smooth first and the forecast connector would
 *    outlive the forecast it was reaching for.
 *
 * 4. Cone smoothing rides alongside the track smoothing, and the ORDER
 *    BETWEEN THOSE TWO DOES NOT MATTER — they touch different slots and
 *    neither reads the other's output. It is written after because the cone is
 *    drawn under the track, and because a silenced storm has already lost its
 *    cone by then, so this is a no-op on exactly the storms that should not
 *    have one. Both use the same curve (lib/catmullrom.js): the cone and the
 *    track inside it must round identically or the veil reads as leaving its
 *    own track's shoulder.
 *
 * 5. The environment ribbon runs LAST, and unlike (4) its order is NOT free.
 *    It slices the cone the rebuild produced, so it must see the rebuild's
 *    output. Run before it and there would be no stations on any storm and the
 *    layer would draw nothing at all — which looks exactly like a basin SHIPS
 *    does not cover, and would therefore have been reported as one.
 *
 *    A SILENCED OR ENDED STORM HAS ALREADY LOST ITS CONE by the time this
 *    runs, so it gets no ribbon either. That is right rather than incidental:
 *    the ribbon is a statement about a forecast, and the whole point of (2) is
 *    that a storm nobody is analysing has no forecast to make statements about.
 *
 * EVERY path to the map goes through here — selection, re-push, ambient warm,
 * the ended-storm push, and the cold-start repush. There is deliberately no
 * way to hand the engine a raw bundle: a storm that draws its cone on one path
 * and not another is worse than one that draws it on all of them, because the
 * inconsistency is what nobody would think to check. The same now holds for a
 * storm whose track curves when selected and goes back to facets when it
 * rejoins ambient — and, since 2026-08-08, for its cone.
 * ---------------------------------------------------------------------- */
export function forMap(storm, bundle, deps) {
  const decorated = withModelTracks(storm, bundle, deps);
  /* ONE TEST, READ TWICE. The same condition decides both that the future goes
   * and that the track needs an anchor, because they are the same fact: nobody
   * is publishing a position for this storm, so the newest one we hold is the
   * last one there will be. Splitting it into two tests is how they later
   * disagree and a track reaches for a mark that is not drawn. */
  const noReading = isSilent(storm) || isEnded(storm);
  const label = storm?.name || storm?.id || 'storm';
  return withEnvRibbon(
    storm,
    smoothCone(
      smoothTracks(
        noReading ? withoutFuture(decorated) : decorated,
        label,
        noReading ? [storm?.lon, storm?.lat] : null
      ),
      label
    ),
    deps
  );
}

/**
 * Did a poll deliver a NEW ADVISORY for the storm we are already serving?
 *
 * `geometryKeyOf` is the same key the cache itself uses (data/cache.js), so
 * this is the self-invalidation §7 promises rather than a special case.
 * Comparing `advisoryKey` here while the cache compared something else would
 * have been two answers to one question — and it would miss a new JTWC
 * warning, which changes the winds stamped on a GDACS storm's track points
 * without changing its advisory number at all.
 *
 * False for two DIFFERENT storms: that is a selection change, not a refresh,
 * and it comes in through `select`.
 */
export function needsRefetch(prev, next) {
  if (!prev || !next || prev.id !== next.id) return false;
  return geometryKeyOf(prev) !== geometryKeyOf(next);
}

/* ---------------------------------------------------------------------------
 * THE PIPELINE
 * ------------------------------------------------------------------------- */

/**
 * @param {object} deps
 * @param {object} deps.engine            map/layers/index.js — the layer engine
 * @param {() => boolean} deps.isStyleReady  may we touch the MapLibre style yet
 * @param {() => Array} deps.storms       every storm currently held
 * @param {() => object} deps.detail      the storm detail view (created later
 *                                        in boot than this factory, hence a
 *                                        getter rather than the object)
 * @param {() => void} deps.applyLayerState  push the whole layer state onto the map
 */
export function createBundlePipeline({
  engine,
  isStyleReady,
  storms,
  detail,
  applyLayerState,
}) {
  let selected = null;       // the storm the geometry pipeline is serving
  let selectedBundle = null; // its geometry, held so model tracks can re-push
  let geometrySeq = 0;       // stale-response guard: last selection wins

  /* The live decorators, with the real deck lookup and the real model
   * selection bound in. Everything above is pure; this is the one seam. */
  const deps = {
    deckFor: getAdeck,
    modelOn: isModelOn,
    shipsFor: getShips,
    ribbonOn: () => toggleOn('environment'),
  };
  /* ==> WHY THE RIBBON'S BUILD OUTCOME IS REMEMBERED HERE AND NOWHERE ELSE.
   * <== §47.9. The Environment row in the Layers panel used to be computed
   * from the SHIPS FETCH alone, so it could only ever name the four ways the
   * DATA comes up empty. The ribbon has two more ways to come up empty that
   * have nothing to do with the data — `no_ribs` (the cone rebuild declined,
   * so there are no stations to slice) and `nothing_drawable` (the run's hours
   * do not reach the cone) — and for both of those the row said NOTHING. On
   * glass that is a ribbon appearing and disappearing between advisories with
   * no explanation anywhere, which is the §5 silence this app is not allowed
   * to ship. Reported by Aaron 2026-08-18.
   *
   * `lib/cone-ribbon.js` already NAMES both, and `withEnvRibbon` already
   * writes the name into the bundle slot. Nothing read it. This is the reader.
   *
   * ==> IT HANGS OFF `decorate`, NOT OFF `forMap`. <== `forMap` is a pure
   * function with a suite asserting it, and every path to the map — selection,
   * re-push, ambient warm, ended-storm push, cold-start repush — goes through
   * THIS wrapper (main.js reaches for `pipeline.forMap`, which is this). So
   * the record is written wherever a ribbon is built and the pure function
   * stays pure.
   *
   * Bounded, like every cache in this project, and by the same number the
   * geometry cache uses: one entry per storm the app can hold at once. */
  const ribbonReasons = new Map(); // stormId -> the slot's `reason`, or null

  const decorate = (storm, bundle) => {
    const out = forMap(storm, bundle, deps);
    const id = storm?.id;
    if (id) {
      /* Delete-then-set so insertion order is recency, which is what makes the
       * eviction below an LRU rather than a first-in queue. */
      ribbonReasons.delete(id);
      ribbonReasons.set(id, out?.layers?.environment?.reason ?? null);
      while (ribbonReasons.size > CACHE.geometryLruStorms) {
        ribbonReasons.delete(ribbonReasons.keys().next().value);
      }
    }
    return out;
  };

  /** The geometry pipeline: cache → fetch → layers + panel. Every exit path
   *  checks `seq` so a slow response for storm A never paints over storm B. */
  async function load(storm, { retry = false } = {}) {
    const seq = ++geometrySeq;

    /* Both sources have geometry now (§14's both-sources rule). They return
     * the SAME bundle shape, so everything downstream — layers, panel — is
     * source-blind and this is the only place that has to know the
     * difference. */
    const fetchGeometry =
      storm.source === 'gdacs' ? fetchGdacsGeometry : fetchStormGeometry;

    /* ==> AN ENDED STORM IS NEVER FETCHED. IT IS SERVED FROM THE REGISTRY. <==
     *
     * Not an optimization — a correctness gate, and it fails in three ways
     * without it:
     *
     *   1. THE FETCH RETURNS NOTHING, because the storm is out of both feeds.
     *      NHC's bin is flushed and GDACS's event is archived. An empty answer
     *      lands in the cache as an attempt and the panel goes to `error` with a
     *      Retry button, so the reader gets "we couldn't load this" for a storm
     *      that loaded fine — blaming the network for a storm that ended.
     *   2. IT COSTS A ROUND TRIP PER SELECTION to learn that, on the one storm
     *      guaranteed to have nothing to learn.
     *   3. ON A COLD START THE ONLY COPY OF THIS STORM'S TRACK IS IN
     *      localStorage. `endedBundle` prefers the in-memory bundle when the
     *      session still has it and falls back to the persisted skeleton, so the
     *      track survives a reload — which is the whole reason it is persisted.
     *
     * `forMap` still runs on it, so the empty forward-looking slots go through
     * exactly the same gate every other storm's do. */
    if (isEnded(storm)) {
      const bundle = endedBundle(storm.id) || { layers: {}, forecast: [], past: [], stamp: null };
      selectedBundle = bundle;
      if (isStyleReady()) {
        engine.setBundle(storm, decorate(storm, bundle));
        applyLayerState();
      }
      detail().setGeometry({ state: 'ok', bundle, lagged: false });
      return;
    }

    if (storm.source !== 'nhc' && storm.source !== 'gdacs') {
      /* An unknown source is nothing to draw, not an error — the panel's
       * `can` branches say why. */
      if (isStyleReady()) engine.clearSelection();
      detail().setGeometry({
        state: 'ok',
        bundle: { layers: {}, forecast: [], past: [], stamp: { advisnum: null, filedate: null } },
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
    const wantFetch = retry || geometryNeedsFetch(storm.id, geometryKeyOf(storm));
    if (retry) evictGeometry(storm.id);

    let bundle = wantFetch ? null : getGeometry(storm.id);
    if (bundle?.error) bundle = null;

    if (!bundle) {
      /* Only show the spinner when there is nothing to look at. If the storm
       * already has geometry from an earlier advisory, it stays on the map
       * while the newer one is fetched — a §5 blank-then-repaint is a worse
       * answer than a slightly old shape that never flickers. */
      const held = retry ? null : getGeometry(storm.id);
      if (!held || held.error) detail().setGeometry({ state: 'loading' });

      try {
        const fetched = await fetchGeometry(storm);
        bundle = putGeometry(storm.id, fetched, geometryKeyOf(storm));
      } catch (e) {
        console.warn('[landfall] storm geometry failed:', e?.message || e);
        bundle = putGeometry(storm.id, { error: e?.message || 'failed' }, geometryKeyOf(storm));
      }

      if (bundle?.error) {
        if (seq !== geometrySeq) return;
        if (isStyleReady()) engine.clearSelection();
        detail().setGeometry({ state: 'error', error: bundle.error });
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
      if (isStyleReady()) {
        engine.setBundle(storm, decorate(storm, bundle));
        applyLayerState();
      }
    } catch (e) {
      console.error('[landfall] applying geometry to layers failed:', e);
      if (isStyleReady()) engine.clearSelection();
      detail().setGeometry({ state: 'error', error: `draw failed: ${e?.message || e}` });
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
    detail().setGeometry({
      state: 'ok',
      bundle: isSilent(storm) || isEnded(storm) ? withoutFuture(bundle) : bundle,
      lagged: geometryLagged(storm.observedAt, bundle.stamp),
      held: !!rec?.bundle && rec.bundleKey !== geometryKeyOf(storm),
    });
  }

  return {
    /** The storm the pipeline is serving, or null. */
    selected: () => selected,

    /** A NEW selection. The held bundle goes with it — it belongs to the old
     *  storm and re-pushing it under the new one would draw the wrong cone. */
    select(storm) {
      selected = storm;
      selectedBundle = null;
    },

    /** The SAME storm, as a fresher object off a poll. Keeps the pipeline and
     *  the detail view pointing at one object rather than two copies that
     *  drift apart. Does not touch the bundle: the geometry is still valid. */
    retarget(storm) {
      selected = storm;
    },

    /**
     * End the selection outright — recenter, and Esc's second press.
     *
     * The sequence bump CANCELS ANY IN-FLIGHT RESPONSE, so a fetch that lands
     * after this cannot repaint a storm the user has walked away from.
     *
     * Clearing the engine lives in here rather than at the call site: it is
     * one more place that would have to remember the style guard, and a
     * selection cleared in the pipeline but still drawn on the map is exactly
     * the kind of half-state nobody thinks to check for.
     */
    clear() {
      geometrySeq++;
      selected = null;
      selectedBundle = null;
      if (isStyleReady()) engine.clearSelection();
    },

    load,

    /**
     * Geometry for a storm the user has NOT selected — cache first, fetch if
     * the cache cannot answer, and nothing drawn either way.
     *
     * ==> WHY THIS IS NOT `load`, AND WHY IT DOES NOT SELECT. <==
     * The home dashboard is about one house and one storm bearing down on it,
     * and it is worthless without that storm's forecast curve — the closest
     * approach, the strength at the pass, the band, all of it comes off the
     * track. But `load` is the SELECTION pipeline: it sets the map's bundle,
     * applies the layer state, and pushes into the detail panel, and every
     * caller of it also flies the camera. Routing the dashboard through it
     * would mean opening the Home drawer yanks the globe to a storm somewhere
     * else in the ocean and quietly replaces whatever the user was looking at.
     * Someone checking their house has not asked to go anywhere.
     *
     * SO THIS TOUCHES NOTHING. No `selected`, no `selectedBundle`, no
     * sequence bump, no engine call, no detail push. It reads and fills the
     * same cache `load` uses, so a later selection of that storm is instant
     * rather than a second round trip, and the two can never hold different
     * geometry for one storm.
     *
     * ENDED AND UNKNOWN-SOURCE STORMS ARE ANSWERED FROM THE REGISTRY, exactly
     * as `load` does, for exactly the reasons written out up there — an ended
     * storm is not fetched, ever.
     *
     * FAILURE IS REPORTED, NEVER SWALLOWED (§5). The resolved value is
     * `{ state, bundle, error }` and the dashboard turns each state into a
     * different sentence. A rejected promise here would surface as a home
     * screen stuck on "loading" with the reason only visible in a console.
     *
     * @returns {Promise<{state:'ok'|'error', bundle:object|null, error:string|null}>}
     */
    async warm(storm) {
      if (!storm) return { state: 'error', bundle: null, error: 'no storm' };

      if (isEnded(storm)) {
        const bundle = endedBundle(storm.id) || { layers: {}, forecast: [], past: [], stamp: null };
        return { state: 'ok', bundle, error: null };
      }
      if (storm.source !== 'nhc' && storm.source !== 'gdacs') {
        return {
          state: 'ok',
          bundle: { layers: {}, forecast: [], past: [], stamp: { advisnum: null, filedate: null } },
          error: null,
        };
      }

      const held = getGeometry(storm.id);
      const fresh = !geometryNeedsFetch(storm.id, geometryKeyOf(storm));
      if (held && !held.error && fresh) return { state: 'ok', bundle: held, error: null };

      const fetchGeometry =
        storm.source === 'gdacs' ? fetchGdacsGeometry : fetchStormGeometry;

      let bundle;
      try {
        const fetched = await fetchGeometry(storm);
        bundle = putGeometry(storm.id, fetched, geometryKeyOf(storm));
      } catch (e) {
        console.warn('[landfall] home: warming geometry failed:', e?.message || e);
        bundle = putGeometry(storm.id, { error: e?.message || 'failed' }, geometryKeyOf(storm));
      }

      /* A FAILED FETCH DOES NOT DISCARD WHAT WE ALREADY HAD. The cache refuses
       * to let an error replace a good bundle, so an older advisory's track
       * still answers — stale geometry with its age on it beats a blank
       * dashboard, and the view stamps it. */
      if (bundle?.error) {
        return held && !held.error
          ? { state: 'ok', bundle: held, error: null }
          : { state: 'error', bundle: null, error: bundle.error };
      }
      return { state: 'ok', bundle, error: null };
    },

    /**
     * A poll landed. Keep the selection aligned with it, and refetch if the
     * advisory (or the JTWC warning behind it) actually moved.
     *
     * The object is adopted in BOTH cases — same advisory or new one. Holding
     * the older copy would leave every later `geometryKeyOf` comparison
     * measuring against a storm that no longer exists in the feed.
     */
    reconcile(current) {
      if (!current || !selected || current.id !== selected.id) return;
      const refetch = needsRefetch(selected, current);
      selected = current;
      if (refetch) load(current);
    },

    /** The decorator, for the two callers that already hold a bundle and only
     *  need it dressed: the ended-storm push and a landed a-deck. */
    forMap: decorate,

    /** Why this storm's ribbon drew nothing the last time it was built, or
     *  `null` if it drew. `undefined` means this storm has never been through
     *  the decorator, which is a different fact again — app/layer-status.js
     *  only ever speaks on the two reasons it recognises, so an unknown storm
     *  can never produce a sentence. */
    ribbonReasonFor: (stormId) => ribbonReasons.get(stormId),

    /** Re-apply the selected storm's geometry after something OTHER than a new
     *  bundle changed what should be drawn — a deck landing, or the user
     *  changing which models are on. One path, so the map cannot end up showing
     *  a selection state nothing produced. */
    repushSelected() {
      if (!isStyleReady() || !selected || !selectedBundle) return;
      engine.setBundle(selected, decorate(selected, selectedBundle));
    },

    /** The same, for every OTHER storm on the map. Model tracks draw ambiently,
     *  so a deck landing or a model being switched off has to reach the whole
     *  set — not just whatever is selected. Reads the warmed geometry back out
     *  of the cache rather than holding a second copy of it. */
    repushAmbient() {
      if (!isStyleReady()) return;
      for (const s of storms()) {
        /* An ended storm's geometry comes out of the registry, not the cache —
         * on a cold start the cache has never held it and never will (see the
         * gate in `load`). Without this an ended storm drew its grey head and
         * nothing else after a reload: the track it exists to show was in
         * localStorage the whole time and nothing on the ambient path asked. */
        const b = isEnded(s) ? endedBundle(s.id) : getGeometry(s.id);
        if (b && !b.error) engine.ambientBundle(s, decorate(s, b));
      }
    },
  };
}
