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

/** A 1x1 fully transparent PNG. A MapLibre image source must be created with
 *  SOME url, and creating it empty-but-invisible lets the disc's first real
 *  frame arrive as an update rather than as a source add — no layer churn
 *  mid-flight, no flash of a half-built source. */
const BLANK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export function addStormImagery(map, { onStatus } = {}) {
  /** stormId -> { lat, lon, satId, urlLive, urlPrev, busy, failed, empty } */
  const discs = new Map();

  let mode = 'off';
  let timer = null;
  let lastStorms = [];
  let destroyed = false;

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

  function ensureDisc(storm) {
    const id = storm.id;
    if (discs.has(id)) return discs.get(id);

    const rec = { lat: storm.lat, lon: storm.lon, urlLive: null, urlPrev: null, busy: false, failed: false, empty: false };
    discs.set(id, rec);

    const { corners } = discBox(storm.lat, storm.lon);
    if (!map.getSource(sourceId(id))) {
      map.addSource(sourceId(id), { type: 'image', url: BLANK, coordinates: corners });
    }
    if (!map.getLayer(layerId(id))) {
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
    }
    return rec;
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
      const { bbox } = discBox(storm.lat, storm.lon);
      const u = new URL(IMAGERY.radar.relay, location.origin);
      u.searchParams.set('bbox', bbox);
      u.searchParams.set('px', String(IMAGERY.requestPx));
      return u.toString();
    }
    const sat = satelliteForLon(storm.lon);
    if (!sat) return null;
    rec.satId = sat.id;
    const { bbox } = discBox(storm.lat, storm.lon);
    return discUrl(sat, bbox);
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
      const bmp = await createImageBitmap(blob);
      if (destroyed || !discs.has(storm.id)) return;

      const px = IMAGERY.requestPx;
      ctx.clearRect(0, 0, px, px);
      ctx.drawImage(bmp, 0, 0, px, px);
      bmp.close?.();

      const img = ctx.getImageData(0, 0, px, px);
      let coldFraction = 1;
      if (mode === 'satellite') {
        const sat = SATELLITES.find((s) => s.id === rec.satId);
        coldFraction = paintDisc(img, sat).coldFraction;
      } else {
        /* Radar arrives already keyed transparent by the service, so it needs
         * no knockout — only the rim feather, so it sits on the globe the same
         * way the satellite disc does. */
        featherOnly(img);
      }
      ctx.putImageData(img, 0, 0);

      const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (destroyed || !discs.has(storm.id) || !out) return;

      const next = URL.createObjectURL(out);
      const src = map.getSource(sourceId(storm.id));
      if (!src) {
        URL.revokeObjectURL(next);
        return;
      }
      src.updateImage({ url: next, coordinates: discBox(storm.lat, storm.lon).corners });

      /* Object-URL lifecycle, one generation of grace. Revoking the URL we
       * just replaced can kill an image MapLibre has not finished loading, so
       * the one before it is released instead — bounded at two per disc, which
       * is not a leak. */
      if (rec.urlPrev) URL.revokeObjectURL(rec.urlPrev);
      rec.urlPrev = rec.urlLive;
      rec.urlLive = next;
      rec.failed = false;
      /* A disc with essentially nothing cold in it is a genuinely clear sky,
       * not a failure. It still draws — the faint warm cloud is real. */
      rec.empty = coldFraction < 0.005;
    } catch {
      /* No raw exception text anywhere near the user (§5). The row says what
       * broke in human language; re-tapping the segment is the retry. */
      rec.failed = true;
    } finally {
      rec.busy = false;
      report();
    }
  }

  /** Blank one disc without removing its layer — used when a storm moves out
   *  of coverage. Keeping the layer means the next refresh is an update. */
  function clearDisc(rec, id) {
    const src = map.getSource(sourceId(id));
    if (src) src.updateImage({ url: BLANK });
    if (rec.urlLive) URL.revokeObjectURL(rec.urlLive);
    if (rec.urlPrev) URL.revokeObjectURL(rec.urlPrev);
    rec.urlLive = null;
    rec.urlPrev = null;
  }

  /** The rim feather on its own, for imagery that needs no colour work. Shares
   *  IMAGERY.featherStart with the satellite path so both discs blend into the
   *  globe identically — one constant, one look. */
  function featherOnly(img) {
    const d = img.data;
    const w = img.width;
    const h = img.height;
    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    const rim = Math.min(cx, cy);
    const inner = rim * IMAGERY.featherStart;
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
