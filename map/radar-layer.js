/**
 * radar-layer.js — live radar as a MapLibre tile layer (SPEC §4.9).
 *
 * ==> IT IS A LAYER, NOT A DISC, AND THAT IS THE WHOLE FILE. <==
 *
 * Radar used to live in map/imagery.js as one more disc alongside satellite:
 * one image per storm, centred on the eye, sized to the Cloud radius slider,
 * feathered at the rim. It looked bad and the reason was structural. Satellite
 * comes from a WMS — ask for a rectangle, get one picture — so a disc is the
 * natural shape there and 768 px across 1800 km is a real 2.3 km/px.
 * RainViewer is a TILE PYRAMID. Asking a tile pyramid for one picture caps the
 * pixel budget at 512 however large the area, so a wider view was always a
 * blurrier one: at the slider's maximum, one 512 px image across roughly
 * 4,300 km, about 8.5 km/px, against the 1.2 km/px RainViewer's own site draws
 * at the same zoom. Not tunable — the radius slider was a quality TAX.
 *
 * A raster tile source hands the problem to MapLibre, which already solves it
 * for the basemap: it asks for exactly the tiles the viewport needs at the zoom
 * it is drawing. The clarity matches RainViewer's site because it is what
 * RainViewer's site does.
 *
 * WHAT THAT DELETED, and it is most of what was here: the zoom picker, the disc
 * box, the rim fraction, the canvas pixel pass, the per-storm frame cache and
 * the per-storm retry ladder. This file has no canvas in it at all.
 *
 * ==> AND WHAT IT COST, WHICH IS THE PART TO READ TWICE. <== The old disc
 * measured its own alpha to tell a blank frame from an absent one, and that
 * measurement is gone with the canvas. Nothing here can see whether a tile has
 * rain in it. So the COVERAGE MASK is no longer a second opinion — it is the
 * only thing standing between an empty screen and an all-clear over ground
 * nobody is watching, which is the §5 failure this layer keeps finding new
 * roads to. `data/radar-coverage.js` owns it, and `report()` below is written
 * so that no combination of answers can produce a reassuring sentence.
 *
 * Imports: config/, lib/, data/. No store, no UI.
 */

import { IMAGERY, POLL } from '../config/constants.js';
import { IMAGERY_OPACITY } from '../config/tokens.js';
import { radarTilesTemplate, radarFramesUrl, radarBounds } from '../lib/imagery.js';
import { radarCoverage, radarCoverageMessage } from '../data/radar-coverage.js';

/* ==> ONE SOURCE PER BOUNDING BOX, AND THERE CAN BE TWO. <== MapLibre's
 * `bounds` is a plain [w,s,e,n] and cannot cross ±180, so a set of storms
 * straddling the dateline needs two boxes to stay tight — see `radarBounds`.
 * Indexing the ids is the whole of the machinery that needs. */
const sourceId = (i) => `radar-tiles-${i}`;
const layerId = (i) => `radar-tiles-layer-${i}`;

/** Same anchor the satellite discs use: imagery draws ABOVE the land fill and
 *  BELOW the coastline glow, so cloud under the land polygon makes an eyewall
 *  vanish exactly as it comes ashore (§4.9). */
const BEFORE_ID = 'coast-glow';

/**
 * @param {object} map MapLibre map
 * @param {{ onStatus?: (row: object|null) => void }} opts
 */
export function createRadarLayer(map, { onStatus } = {}) {
  let on = false;
  let destroyed = false;
  let frame = null;
  let timer = null;
  let storms = [];
  let failure = null;
  let loading = false;

  /**
   * Retires work in flight.
   *
   * Same device as map/imagery.js's, and needed for the same reason: turning
   * the layer off and on again while a frame lookup is outstanding must not let
   * the old answer install a source into a map that has moved on. Every async
   * path re-checks this after every await.
   */
  let generation = 0;

  /* --- the source ------------------------------------------------------------ */

  /** The boxes currently installed, as a string, so a storm that has merely
   *  drifted does not tear the layer down and refetch everything. */
  let installedKey = '';
  let installedCount = 0;

  /**
   * Put the tile source(s) on the map.
   *
   * ==> `bounds` AND `minzoom` ARE NOT OPTIMISATIONS. THEY ARE THE FIX FOR AN
   * OUTAGE. <== The first tile build had neither, and on a globe MapLibre shows
   * a whole hemisphere at once — so it requested the entire world pyramid, z0
   * through z7, and re-requested on every pan. Cloudflare answered 429 to the
   * whole origin, which took SATELLITE down too, because both go through
   * `/api/`. Anything that widens these is re-opening that.
   *
   * REBUILT ONLY WHEN THE BOXES ACTUALLY CHANGE. `bounds` is fixed at source
   * construction in MapLibre — `setTiles` cannot move it — so a new box means a
   * teardown. Keyed on the rounded boxes so ordinary storm drift, which arrives
   * every poll, changes nothing and keeps the decoded tiles on screen.
   */
  function install(tiles, boxes) {
    const key = boxes.map((b) => b.map((n) => n.toFixed(1)).join(',')).join('|');

    if (key === installedKey && installedCount) {
      /* Same ground, new frame: swap the tiles under every box and keep what is
       * already drawn until the replacement for each tile arrives. */
      for (let i = 0; i < installedCount; i++) {
        const existing = map.getSource(sourceId(i));
        if (existing) existing.setTiles([tiles]);
      }
      return;
    }

    teardown();
    installedKey = key;
    installedCount = boxes.length;

    const before = map.getLayer(BEFORE_ID) ? BEFORE_ID : undefined;
    boxes.forEach((bounds, i) => {
      map.addSource(sourceId(i), {
        type: 'raster',
        tiles: [tiles],
        /* 256 against 512 px images is the retina trick, not a mismatch: the
         * tile is laid out at 256 CSS px, so a 512 px image is one image pixel
         * per device pixel on a 2x screen. */
        tileSize: IMAGERY.radar.tileSize,
        /* ==> DECLARED SO MAPLIBRE OVERZOOMS INSTEAD OF ASKING FOR NOTHING. <==
         * Above z7 RainViewer has no tiles. Without this, zooming in past it
         * requests addresses that do not exist and the layer goes blank at close
         * range — which over a storm reads as no rain. With it, MapLibre
         * stretches the z7 tile, which is honest: that IS the finest data. */
        maxzoom: IMAGERY.radar.maxTileZoom,
        /* Below this a radar tile spans 45° and its echoes are invisible
         * specks, so a whole-planet view asks for nothing at all. */
        minzoom: IMAGERY.radar.minTileZoom,
        bounds,
        attribution: '',
      });

      map.addLayer(
        {
          id: layerId(i),
          type: 'raster',
          source: sourceId(i),
          minzoom: IMAGERY.radar.minTileZoom,
          paint: {
            'raster-opacity': IMAGERY_OPACITY,
            /* Radar is not feathered per-pixel — there is no rim — so
             * MapLibre's own cross-fade is the only one, and it is wanted here.
             * It makes a frame change a dissolve rather than a flicker. */
            'raster-fade-duration': 300,
            'raster-resampling': 'linear',
          },
        },
        before,
      );
    });
  }

  function teardown() {
    for (let i = 0; i < installedCount; i++) {
      if (map.getLayer(layerId(i))) map.removeLayer(layerId(i));
      if (map.getSource(sourceId(i))) map.removeSource(sourceId(i));
    }
    installedKey = '';
    installedCount = 0;
  }

  /* --- throttling ------------------------------------------------------------
   *
   * ==> A RATE LIMIT DOES NOT ANNOUNCE ITSELF. <== It arrives as dozens of
   * identical 429s while the map goes on drawing whichever tiles it already
   * had — a PARTIAL rain field presented as a whole one, which over a storm is
   * §5's silent-wrong-answer. So the failures are counted, and past a threshold
   * the layer hides itself and says what happened.
   *
   * Listened for here rather than in main.js's handler because that one is
   * about the BASEMAP and deliberately ignores every other source (see the note
   * on BASEMAP_SOURCE). Each layer owns its own row; this is radar owning its.
   * ------------------------------------------------------------------------ */
  let tileFailures = 0;

  function onMapError(e) {
    if (!on || !e?.sourceId || !String(e.sourceId).startsWith('radar-tiles')) return;
    tileFailures++;
    if (tileFailures === IMAGERY.radar.maxTileFailures) {
      /* Torn down rather than left half-drawn. Reported once, on the crossing,
       * so a continuing flood does not re-render the row per tile. */
      teardown();
      failure = 'throttled';
      report();
    }
  }

  map.on('error', onMapError);

  /* --- the frame ------------------------------------------------------------- */

  async function loadFrame() {
    const gen = generation;
    loading = !frame;
    report();

    let next;
    try {
      const res = await fetch(radarFramesUrl(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      next = await res.json();
    } catch (e) {
      if (gen !== generation || destroyed) return;
      loading = false;
      /* ==> A REFRESH THAT FAILS LEAVES THE LAST FRAME ON SCREEN. <== §5's rule
       * that stale data with a visible label beats a blank screen, applied to a
       * ten-minute product. The row says so; the pixels stay. Only a FIRST load
       * failing means there is nothing to look at. */
      failure = frame ? 'refresh' : 'first';
      report();
      return;
    }

    if (gen !== generation || destroyed) return;

    const path = next && typeof next.frame === 'string' ? next.frame : '';
    if (!path) {
      loading = false;
      failure = frame ? 'refresh' : 'first';
      report();
      return;
    }

    loading = false;
    failure = null;
    frame = path;

    /* ==> NO STORMS, NO TILES. <== Radar is clipped to what is being tracked,
     * so an empty list is not "draw it everywhere" — it is draw nothing. The
     * row says so rather than leaving a blank map to be read as no rain. */
    const boxes = radarBounds(storms);
    if (!boxes.length) {
      teardown();
      report();
      return;
    }

    tileFailures = 0;
    install(radarTilesTemplate(frame, IMAGERY.radar.requestPx), boxes);
    report();
  }

  /* --- coverage -------------------------------------------------------------- */

  /**
   * Ask the mask about every storm on screen, then re-report.
   *
   * ==> ASKED ABOUT THE STORMS, NOT ABOUT THE VIEWPORT. <== The layer is global
   * now, so "is there radar on screen" is a question about wherever the user
   * happens to be looking, which is not what the row is for. The row exists to
   * answer "is the app hiding a gap from me about a storm I am tracking", and
   * that is per storm.
   *
   * Fire-and-forget and never throws: `radarCoverage` resolves to one of three
   * states and swallows its own failures, precisely so no caller has to wrap a
   * safety-wording question in a try/catch it might one day forget.
   */
  const verdicts = new Map();

  function refreshCoverage() {
    const gen = generation;
    for (const s of storms) {
      radarCoverage(s.lat, s.lon).then((verdict) => {
        if (gen !== generation || destroyed) return;
        verdicts.set(s.id, verdict);
        report();
      });
    }
  }

  /* --- status ---------------------------------------------------------------- */

  function report() {
    if (!onStatus) return;
    if (!on) return onStatus(null);

    if (loading) return onStatus({ state: 'loading' });

    if (failure === 'first') {
      return onStatus({ state: 'error', message: 'Radar unavailable — tap to retry' });
    }
    if (failure === 'refresh') {
      /* Named as a STALENESS problem rather than an outage, because that is
       * what it is: there are real pixels on screen and they are a real
       * picture, just not the newest one. Calling this "unavailable" over a
       * visible radar image would be its own kind of lying. */
      return onStatus({ state: 'error', message: 'Radar has stopped updating — tap to retry' });
    }
    if (failure === 'throttled') {
      /* The layer is TORN DOWN by the time this renders, deliberately. Half a
       * rain field with no caveat is worse than none with one. */
      return onStatus({ state: 'error', message: 'Radar is being rate limited — tap to retry' });
    }
    /* Clipped to the storms, so nothing tracked means nothing drawn. Said out
     * loud: an empty map with radar switched on would otherwise read as a
     * clear sky over the whole planet. */
    if (!storms.length) {
      return onStatus({ state: 'empty', message: 'Radar follows the storms — none are being tracked' });
    }

    /* ==> THE COVERAGE SENTENCE, AND IT IS THE ONLY THING THIS ROW SAYS WHEN
     * NOTHING IS BROKEN. <== A working radar layer needs no commentary; the
     * pixels are the message. The one thing the pixels CANNOT say is that they
     * are absent because nobody is looking, so that is the one thing said here. */
    const message = radarCoverageMessage(storms.map((s) => verdicts.get(s.id) ?? null));
    return onStatus(message ? { state: 'empty', message } : null);
  }

  /* --- cadence --------------------------------------------------------------- */

  function startTimer() {
    stopTimer();
    if (!on) return;
    timer = setInterval(loadFrame, POLL.imagery);
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function onVisibility() {
    if (document.hidden) {
      stopTimer();
      return;
    }
    if (on) {
      /* Coming back should show current weather, not whatever was on screen
       * when the tab was backgrounded. */
      loadFrame();
      startTimer();
    }
  }

  document.addEventListener('visibilitychange', onVisibility);

  /* --- public surface --------------------------------------------------------- */

  return {
    show(list) {
      storms = list || [];
      if (on) {
        refreshCoverage();
        return;
      }
      on = true;
      generation++;
      failure = null;
      /* The frame is deliberately NOT kept across an off/on cycle. It could be
       * up to ten minutes old, and re-showing the layer is exactly the moment
       * somebody wants to know what is happening now. */
      frame = null;
      loadFrame();
      refreshCoverage();
      startTimer();
    },

    hide() {
      if (!on) return;
      on = false;
      generation++;
      stopTimer();
      teardown();
      tileFailures = 0;
      frame = null;
      failure = null;
      loading = false;
      report();
    },

    /** A new storm list arrived. The TILES do not care — the layer is global —
     *  but the coverage sentence does, because it is per storm. */
    update(list) {
      storms = list || [];
      if (!on) return;
      /* The BOXES follow the storms, so a new list can mean new ground to
       * fetch — unlike the tiles themselves, which only change with the frame.
       * `install` keys on the rounded boxes, so ordinary drift is a no-op and
       * only a real move rebuilds. */
      if (frame) {
        const boxes = radarBounds(storms);
        if (!boxes.length) teardown();
        else install(radarTilesTemplate(frame, IMAGERY.radar.requestPx), boxes);
      }
      /* Verdicts for storms that have left go with them. Left behind, they
       * would keep voting in a sentence about a set they are not in — and since
       * that sentence is worst-case-first, a stale 'none' would keep raising a
       * gap warning about a storm that has dissolved. */
      const live = new Set(storms.map((s) => s.id));
      for (const id of [...verdicts.keys()]) if (!live.has(id)) verdicts.delete(id);
      refreshCoverage();
      report();
    },

    /** Re-tapping an errored row means retry (§7) — the segment IS the
     *  recovery, there is no second button. */
    retry() {
      if (!on) return;
      generation++;
      failure = null;
      /* Cleared, or a layer that has already been throttled once can never come
       * back — the very next tile would re-trip the threshold. */
      tileFailures = 0;
      frame = null;
      loadFrame();
      refreshCoverage();
    },

    destroy() {
      destroyed = true;
      generation++;
      stopTimer();
      document.removeEventListener('visibilitychange', onVisibility);
      map.off('error', onMapError);
      teardown();
      verdicts.clear();
    },

    /** Testing seam — the frame path currently installed, or null. */
    _frame: () => frame,
  };
}
