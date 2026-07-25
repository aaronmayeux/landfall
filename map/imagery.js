/**
 * imagery.js — satellite and radar discs on the globe (SPEC §4, §7).
 *
 * ONE DISC PER STORM, feathered to nothing at its rim, drawn for every storm
 * in the feed rather than only the selected one. Same rule the wind field
 * follows: a layer the user switched on and forgot should not silently apply
 * to one storm.
 *
 * ==> WHY THIS LIVES IN map/ AND NOT IN map/layers/ <==
 *
 * The selection-layer engine (map/layers/registry.js) exists for GEOMETRY that
 * arrives in a per-storm bundle: it merges GeoJSON features across warmed
 * storms and hands each layer definition a feature list. Imagery has no
 * features. It needs each storm's POSITION to address a request, and it draws
 * one raster source per storm instead of one merged collection. Registering it
 * there would mean widening the engine's contract for a single caller — and
 * that contract ("adding a layer means adding a file, never editing the
 * engine") is worth more than the tidiness of having every layer in one folder.
 *
 * So it follows markers.js instead: a map/ module that takes storms in through
 * update(), owns its own sources, and is wired by main.js. Imports point
 * downward only — config/, lib/, map/ siblings. Never ui/, never data/.
 *
 * ==> WHERE IT SITS IN THE STACK <==
 *
 * ABOVE the basemap's land fill, BELOW the coastline glow and every piece of
 * storm geometry. SPEC §13 used to put imagery under the land fill, inherited
 * from a different set of tradeoffs; Aaron changed it and the reason is the
 * whole app: at landfall — the moment this thing exists for — cloud painted
 * under the land polygon means the eyewall vanishes exactly as it comes ashore.
 * Continuous cloud across the coast is the point. The spec now says so.
 */

import { IMAGERY, POLL, SATELLITES } from '../config/constants.js';
import { IMAGERY_OPACITY } from '../config/tokens.js';
import { discBox, discUrl, inRadarCoverage, satelliteForLon } from '../lib/imagery.js';
import { paintDisc } from '../lib/imagery-paint.js';

/** Draw beneath the coastline glow. Named, not positional: if the style ever
 *  loses this layer the disc still draws (on top) rather than throwing. */
const BEFORE_ID = 'coast-glow';

const sourceId = (id) => `imagery-src-${id}`;
const layerId = (id) => `imagery-lyr-${id}`;

/* THERE IS NO PLACEHOLDER IMAGE, AND THAT IS THE SECOND ATTEMPT.
 *
 * The first version created each disc's source immediately against a 1x1
 * transparent PNG so the first real frame could arrive as an update rather
 * than as a source add. MapLibre answered with
 * `InvalidStateError: The source image could not be decoded`, once per storm,
 * caught in a headless run against a stubbed feed. The data URL was malformed
 * — its IDAT inflates to three bytes where a 1x1 RGBA frame needs five — and
 * a hand-typed base64 blob is exactly the kind of asset nobody ever reads.
 *
 * Swapping in a correct one would have worked and would have left a fake
 * image in the codebase forever. So the source is CREATED WHEN THE FIRST REAL
 * FRAME LANDS instead, and a disc with nothing to show has no map objects at
 * all. Fewer moving parts, no placeholder to get wrong, and a layer that
 * exists only when it is drawing something true.
 */

export function addStormImagery(map, { onStatus } = {}) {
  /** stormId -> { lat, lon, satId, urlLive, urlPrev, busy, failed, empty } */
  const discs = new Map();

  let mode = 'off';
  let timer = null;
  let lastStorms = [];
  let destroyed = false;

  /* LIVE TUNING, pushed in from main.js (SPEC §16 sliders). Defaults are the
   * config values; Settings overrides them per device.
   *
   * PUSHED, NOT IMPORTED. map/ never reads data/ — the import arrow points one
   * way (§12) and this module already takes storms in the same way. */
  let tuning = { radiusKm: IMAGERY.discRadiusKm, fadeWidth: IMAGERY.fadeWidth };

  /* One canvas for every disc, reused. Allocating a 512x512 buffer per storm
   * per refresh is exactly the kind of garbage that shows up as a stutter on
   * a phone, and the pass is synchronous so reuse is safe. */
  const canvas = document.createElement('canvas');
  canvas.width = IMAGERY.requestPx;
  canvas.height = IMAGERY.requestPx;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  /* --- status ---------------------------------------------------------------
   * The row reports the WHOLE SET, and only reports a problem when the problem
   * is total. Some storms having no imagery while others do is normal — a
   * storm can sit outside radar coverage while three others are fine — and an
   * amber row every time that happens trains the user to ignore the one that
   * matters. Same reasoning main.js applies to model tracks.
   * ---------------------------------------------------------------------- */
  function report() {
    if (!onStatus) return;
    if (mode === 'off') return onStatus(null);

    const rows = [...discs.values()];
    if (!rows.length) return onStatus(null);

    if (rows.some((d) => d.busy) && !rows.some((d) => d.urlLive)) {
      return onStatus({ state: 'loading' });
    }
    if (rows.every((d) => d.failed)) {
      return onStatus({
        state: 'error',
        message:
          mode === 'radar'
            ? 'Radar unavailable — tap to retry'
            : 'Satellite unavailable — tap to retry',
      });
    }
    /* The frame arrived and the colour knockout had nothing to key on. Named
     * plainly, because the alternative is a blank disc over a live storm
     * reading as clear sky (§5). No retry offered — refetching a greyscale
     * product returns another greyscale product; the fix is a config change,
     * not a button. */
    if (rows.some((d) => d.noColour)) {
      return onStatus({
        state: 'empty',
        message: 'Satellite sent a grey frame — the colour filter has nothing to keep',
      });
    }
    /* NOT an error, and §5 is emphatic about the difference. "This storm is
     * outside radar range" is a true, useful sentence; offering a retry for it
     * would be a button that cannot work. */
    if (rows.every((d) => d.empty)) {
      return onStatus({
        state: 'empty',
        message:
          mode === 'radar'
            ? 'No radar coverage for these storms'
            : 'No satellite coverage for these storms',
      });
    }
    onStatus(null);
  }

  /* --- sources --------------------------------------------------------------- */

  /** Track a storm. Creates NO map objects — see the note above. */
  function ensureDisc(storm) {
    const id = storm.id;
    if (discs.has(id)) return discs.get(id);
    const rec = {
      lat: storm.lat, lon: storm.lon,
      urlLive: null, urlPrev: null,
      /* The vendor's raw PNG, kept so a FADE change can repaint locally
       * instead of refetching. A slider drag would otherwise be four or five
       * round trips to NASA per storm, and the rim is a client-side effect
       * that never needed new bytes to begin with.
       *
       * Bounded by maxDiscs (12). Compressed PNGs, not decoded buffers —
       * roughly half a megabyte each at 768px against the ~2.3 MB a decoded
       * RGBA frame would cost. Dropped with the disc. */
      blob: null,
      busy: false, failed: false, empty: false, noColour: false,
    };
    discs.set(id, rec);
    return rec;
  }

  /** Put a finished frame on the map, creating the source and layer the first
   *  time this disc has anything to draw. */
  function drawFrame(id, url, corners) {
    const existing = map.getSource(sourceId(id));
    if (existing) {
      existing.updateImage({ url, coordinates: corners });
      if (map.getLayer(layerId(id))) {
        map.setLayoutProperty(layerId(id), 'visibility', 'visible');
      }
      return true;
    }

    map.addSource(sourceId(id), { type: 'image', url, coordinates: corners });
    const before = map.getLayer(BEFORE_ID) ? BEFORE_ID : undefined;
    map.addLayer(
      {
        id: layerId(id),
        type: 'raster',
        source: sourceId(id),
        paint: {
          'raster-opacity': IMAGERY_OPACITY,
          /* The disc is already feathered per-pixel; MapLibre's own fade
           * would only add a second, differently-timed one. */
          'raster-fade-duration': 0,
          /* The knockout leaves hard-won soft edges. Resampling them with a
           * nearest-neighbour filter would put stairsteps back. */
          'raster-resampling': 'linear',
        },
      },
      before,
    );
    return true;
  }

  function dropDisc(id) {
    const rec = discs.get(id);
    if (rec) {
      if (rec.urlLive) URL.revokeObjectURL(rec.urlLive);
      if (rec.urlPrev) URL.revokeObjectURL(rec.urlPrev);
    }
    if (map.getLayer(layerId(id))) map.removeLayer(layerId(id));
    if (map.getSource(sourceId(id))) map.removeSource(sourceId(id));
    discs.delete(id);
  }

  function dropAll() {
    for (const id of [...discs.keys()]) dropDisc(id);
  }

  /* --- fetch + paint ---------------------------------------------------------
   * The satellite vendors all send Access-Control-Allow-Origin: * (measured
   * 2026-07-25), so the browser may read their pixels directly and no relay is
   * needed. Radar's host sends NO CORS header, which is the entire reason
   * /api/imagery/radar exists. That asymmetry is measured, not assumed.
   * ------------------------------------------------------------------------ */

  function requestUrl(rec, storm) {
    if (mode === 'radar') {
      if (!inRadarCoverage(storm.lat, storm.lon)) return null;
      const { bbox } = discBox(storm.lat, storm.lon, tuning.radiusKm);
      const u = new URL(IMAGERY.radar.relay, location.origin);
      u.searchParams.set('bbox', bbox);
      u.searchParams.set('px', String(IMAGERY.requestPx));
      return u.toString();
    }
    const sat = satelliteForLon(storm.lon);
    if (!sat) return null;
    rec.satId = sat.id;
    const { bbox } = discBox(storm.lat, storm.lon, tuning.radiusKm);
    return discUrl(sat, bbox);
  }

  /**
   * Run one vendor frame through the pass and put it on the map.
   *
   * SPLIT OUT OF THE FETCH so a fade change can re-run it against the cached
   * blob with no network at all. Everything from the decode down is identical
   * whether the bytes just arrived or have been sitting in `rec.blob` — and
   * two copies of a pixel pipeline is exactly how one of them goes stale.
   */
  async function renderFrame(id, rec, blob) {
    const bmp = await createImageBitmap(blob);
    if (destroyed || !discs.has(id)) {
      bmp.close?.();
      return;
    }

    const px = IMAGERY.requestPx;
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(bmp, 0, 0, px, px);
    bmp.close?.();

    const img = ctx.getImageData(0, 0, px, px);
    let keptFraction = 1;
    let noColour = false;
    if (mode === 'satellite') {
      const sat = SATELLITES.find((s) => s.id === rec.satId);
      const stats = paintDisc(img, sat, { fadeWidth: tuning.fadeWidth });
      keptFraction = stats.keptFraction;
      /* THE GREYSCALE TRAP, now narrowed to the case that is actually a
       * fault. A vendor we KNOW is greyscale (Meteosat) took the brightness
       * knockout and drew fine — nothing to report. A vendor we believe is
       * colour-enhanced sending a frame with no colour in it means the chroma
       * key had nothing to key on and the disc is empty, which over a live
       * cyclone reads as clear sky: the §5 failure, and the worst thing this
       * app can draw. `stats.enhanced` is what the pass actually used, so
       * this can never drift from the branch it is describing. */
      noColour = stats.enhanced && stats.chromaMax < IMAGERY.greyscaleChroma;
    } else {
      /* Radar arrives already keyed transparent by the service, so it needs
       * no knockout — only the rim feather, so it sits on the globe the same
       * way the satellite disc does. */
      featherOnly(img, tuning.fadeWidth);
    }
    ctx.putImageData(img, 0, 0);

    const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (destroyed || !discs.has(id) || !out) return;

    const next = URL.createObjectURL(out);
    drawFrame(id, next, discBox(rec.lat, rec.lon, tuning.radiusKm).corners);

    /* Object-URL lifecycle, one generation of grace. Revoking the URL we just
     * replaced can kill an image MapLibre has not finished loading, so the one
     * before it is released instead — bounded at two per disc, not a leak. */
    if (rec.urlPrev) URL.revokeObjectURL(rec.urlPrev);
    rec.urlPrev = rec.urlLive;
    rec.urlLive = next;
    rec.noColour = noColour;
    /* A disc with essentially nothing kept is a genuinely clear sky, not a
     * failure — PROVIDED the frame had colour in it to begin with. When it did
     * not, `noColour` is the honest answer and this must not quietly claim the
     * sky is clear. */
    rec.empty = !noColour && keptFraction < 0.005;
  }

  /**
   * Repaint every disc from its cached vendor frame. No network.
   *
   * This is what makes the fade slider usable: the rim is a client-side effect,
   * so changing it never needed new bytes. Dragging it otherwise meant four or
   * five round trips to NASA per storm per drag, which is both slow and rude.
   */
  async function repaintAll() {
    if (mode === 'off') return;
    for (const [id, rec] of [...discs.entries()]) {
      if (!rec.blob || rec.busy) continue;
      try {
        await renderFrame(id, rec, rec.blob);
      } catch {
        /* A repaint that fails leaves the PREVIOUS frame on screen, which is
         * still true weather at a slightly different rim. Nothing to report:
         * the next poll re-runs the whole path and will surface a real fault
         * if there is one. */
      }
    }
    report();
  }

  async function loadDisc(storm) {
    const rec = discs.get(storm.id);
    if (!rec || rec.busy) return;

    const url = requestUrl(rec, storm);
    if (!url) {
      /* Outside coverage. Say so — never leave the last frame sitting under a
       * storm it does not describe, and never draw a blank raster, which
       * reads as clear sky (§5). */
      rec.empty = true;
      rec.failed = false;
      clearDisc(rec, storm.id);
      report();
      return;
    }

    rec.busy = true;
    report();

    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (destroyed || !discs.has(storm.id)) return;
      rec.blob = blob;
      await renderFrame(storm.id, rec, blob);
      rec.failed = false;
    } catch {
      /* No raw exception text anywhere near the user (§5). The row says what
       * broke in human language; re-tapping the segment is the retry. */
      rec.failed = true;
      /* Clear the greyscale reading with it — it described a frame we no
       * longer have, and a stale flag would report the wrong fault. The cached
       * blob goes too: it was addressed to a box we may no longer be drawing,
       * and repainting it would put old weather under a moved storm. */
      rec.noColour = false;
      rec.blob = null;
    } finally {
      rec.busy = false;
      report();
    }
  }

  /** Hide one disc without tearing it down — used when a storm moves out of
   *  coverage. HIDDEN, not blanked: a layer switched to `visibility: none`
   *  draws nothing and costs nothing, where a blank image is a texture upload
   *  that renders as clear sky, which §5 forbids. The next frame turns it
   *  back on. */
  function clearDisc(rec, id) {
    if (map.getLayer(layerId(id))) {
      map.setLayoutProperty(layerId(id), 'visibility', 'none');
    }
    if (rec.urlLive) URL.revokeObjectURL(rec.urlLive);
    if (rec.urlPrev) URL.revokeObjectURL(rec.urlPrev);
    rec.urlLive = null;
    rec.urlPrev = null;
    /* The frame described a box this storm has left. Keeping it would let a
     * later repaint draw old weather under a moved storm. */
    rec.blob = null;
  }

  /** The rim feather on its own, for imagery that needs no colour work. Takes
   *  the SAME live fade width as the satellite path, so both kinds of disc
   *  blend into the globe identically and one slider moves both. */
  function featherOnly(img, fadeWidth) {
    const d = img.data;
    const w = img.width;
    const h = img.height;
    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    const rim = Math.min(cx, cy);
    const inner = rim * (1 - fadeWidth);
    for (let y = 0, i = 0; y < h; y++) {
      const dy = y - cy;
      for (let x = 0; x < w; x++, i += 4) {
        if (d[i + 3] === 0) continue;
        const dx = x - cx;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= rim) {
          d[i + 3] = 0;
        } else if (dist > inner) {
          const t = (dist - inner) / (rim - inner);
          d[i + 3] = (d[i + 3] * (1 - t * t * (3 - 2 * t))) | 0;
        }
      }
    }
  }

  /* --- refresh cadence -------------------------------------------------------
   * SPEC §4: imagery frames are fetched ONLY while an imagery layer is on, and
   * NEVER while the page is hidden. Aaron's ask for this phase is exactly this
   * and no more — if the globe is left on screen, newer frames arrive on their
   * own. Playback and scrubbing are v2.0.
   * ------------------------------------------------------------------------ */

  function refreshAll() {
    if (mode === 'off' || document.hidden) return;
    for (const storm of lastStorms.slice(0, IMAGERY.maxDiscs)) loadDisc(storm);
  }

  function startTimer() {
    stopTimer();
    if (mode === 'off') return;
    timer = setInterval(refreshAll, POLL.imagery);
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
    if (mode !== 'off') {
      /* Coming back to the app should show current weather, not whatever was
       * on screen when it was backgrounded. */
      refreshAll();
      startTimer();
    }
  }

  document.addEventListener('visibilitychange', onVisibility);

  /* --- public surface -------------------------------------------------------- */

  return {
    /**
     * Live tuning from Settings (§16). Ignores anything that did not actually
     * change, because both sliders fire continuously while dragging.
     *
     * THE TWO DIALS COST DIFFERENT THINGS, and that asymmetry is the whole
     * reason this is one method with a branch rather than two:
     *
     *   fade    a client-side rim effect. Repaints from the cached vendor
     *           frames. NO NETWORK AT ALL — drag it as fast as you like.
     *   radius  changes the BBOX in the request. There is no way to widen a
     *           picture we were never sent, so this refetches every disc. The
     *           caller debounces it (main.js) so a drag is one round of
     *           requests at the end, not one per pixel of travel.
     */
    setTuning(next = {}) {
      const radiusKm = Number.isFinite(next.radiusKm) ? next.radiusKm : tuning.radiusKm;
      const fadeWidth = Number.isFinite(next.fadeWidth) ? next.fadeWidth : tuning.fadeWidth;
      const radiusChanged = radiusKm !== tuning.radiusKm;
      const fadeChanged = fadeWidth !== tuning.fadeWidth;
      if (!radiusChanged && !fadeChanged) return;

      tuning = { radiusKm, fadeWidth };
      if (mode === 'off') return;
      if (radiusChanged) refreshAll();
      else repaintAll();
    },

    /** The imagery pair's segment: 'off' | 'satellite' | 'radar'. */
    setMode(next) {
      if (next === mode) return;
      mode = next === 'satellite' || next === 'radar' ? next : 'off';
      dropAll();
      if (mode === 'off') {
        stopTimer();
        report();
        return;
      }
      for (const storm of lastStorms.slice(0, IMAGERY.maxDiscs)) {
        ensureDisc(storm);
        loadDisc(storm);
      }
      startTimer();
      report();
    },

    /** A new storm list arrived. Discs follow the feed: a storm that leaves
     *  takes its imagery with it, the same way a dissolved storm's cone is
     *  pruned rather than left as confident ambient detail (§7). */
    update(storms) {
      lastStorms = (storms || []).filter((s) => Number.isFinite(s?.lat) && Number.isFinite(s?.lon));
      if (mode === 'off') return;

      const wanted = new Set(lastStorms.slice(0, IMAGERY.maxDiscs).map((s) => s.id));
      for (const id of [...discs.keys()]) if (!wanted.has(id)) dropDisc(id);

      for (const storm of lastStorms.slice(0, IMAGERY.maxDiscs)) {
        const had = discs.has(storm.id);
        const rec = ensureDisc(storm);
        /* A storm that MOVED needs its box re-addressed, not just refetched —
         * the source's corner coordinates are part of the request. */
        const moved = had && (rec.lat !== storm.lat || rec.lon !== storm.lon);
        rec.lat = storm.lat;
        rec.lon = storm.lon;
        if (!had || moved) loadDisc(storm);
      }
      report();
    },

    /** Re-tapping an errored row means retry (§7) — the segment IS the
     *  recovery, there is no second button. */
    retry() {
      for (const d of discs.values()) d.failed = false;
      refreshAll();
    },

    destroy() {
      destroyed = true;
      stopTimer();
      document.removeEventListener('visibilitychange', onVisibility);
      dropAll();
    },
  };
}
