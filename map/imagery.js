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
import { discBox, discUrl, inRadarCoverage, radarUrl, satelliteForLon } from '../lib/imagery.js';
import {
  clearFrames,
  evictFrame,
  getFrame,
  isCurrent as frameIsCurrent,
  putFrame,
} from '../lib/imagery-cache.js';
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
  /** stormId -> { lat, lon, urlLive, urlPrev, blob, req, busy, failed, empty,
   *  noColour }. NO `satId` — which bird a frame came from belongs to the
   *  REQUEST that fetched it, not to the disc; holding it here is what let a
   *  radar frame inherit a satellite's palette. */
  const discs = new Map();

  let mode = 'off';
  let timer = null;
  let lastStorms = [];
  let destroyed = false;

  /* ==> THE GENERATION COUNTER, AND WHY THE FILE WAS BROKEN WITHOUT IT <==
   *
   * A frame takes a few hundred milliseconds to arrive. `mode` is read at the
   * moment it LANDS, not the moment it was asked for, so every toggle left
   * in-flight requests behind that finished under whoever came next. Measured
   * headless 2026-07-26 against this module, both directions:
   *
   *   satellite -> radar   the satellite frame landed while mode was 'radar',
   *                        took the radar branch (feather only, NO colour
   *                        knockout) and was drawn as the radar disc. A raw
   *                        vendor square on the globe, labelled radar.
   *   radar -> satellite   the radar frame landed under 'satellite' and went
   *                        through the chroma knockout with NO satellite entry
   *                        attached — the pass logged its bird as `?`.
   *
   * Worse, `setMode` tore down every disc record and built fresh ones under the
   * SAME storm ids, so a stale request's `discs.has(id)` check passed against a
   * record that was not its own. It then wrote `failed` / `empty` / `noColour`
   * onto the orphan it still held, where `report()` cannot see them — so the
   * row described state that had nothing to do with what was on screen.
   *
   * The fix is a request identity, not a longer check. Every fetch pins the
   * generation, the mode, the satellite and the box it was addressed to, and
   * everything downstream reads THE REQUEST rather than live module state. A
   * request whose generation has passed, or whose record has been replaced,
   * drops its bytes and draws nothing.
   *
   * Bumped by setMode. Nothing else needs to: a single disc dropped by
   * `update()` is caught by the record-identity check instead. */
  let generation = 0;

  /* Renders are SERIALISED, because there is one canvas for every disc and
   * `renderFrame` holds it across `await canvas.toBlob(...)`.
   *
   * Chromium snapshots the bitmap when toBlob is CALLED, so overlapping renders
   * happen to survive today — but that is a spec footnote propping up a data
   * race, and up to twelve discs refresh at once. One chain costs nothing (the
   * pass is a few milliseconds) and removes the assumption entirely. The canvas
   * stays shared, which is the point: a 768² buffer per storm per refresh is
   * exactly the garbage that shows up as a stutter on a phone. */
  let renderChain = Promise.resolve();
  function serialised(fn) {
    const run = renderChain.then(fn, fn);
    /* Swallowed on the CHAIN only — `run` keeps its rejection so the caller's
     * try/catch still sees a real failure. Without this one bad frame would
     * poison every render after it. */
    renderChain = run.then(() => {}, () => {});
    return run;
  }

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

    /* --- HOW OLD IS WHAT I AM LOOKING AT ------------------------------------
     * Aaron's ask, and the row shows it whenever frames are drawing rather than
     * only once they are old: "fresh" and "we have no idea" look identical when
     * the only signal is the absence of a warning.
     *
     * THE OLDEST FRAME ON SCREEN, NOT THE NEWEST. The row reports the WHOLE SET
     * (see the note at the top of this function) and with a dozen discs their
     * ages differ. "Downloaded 14 min ago" when one disc is old and three are
     * current is pessimistic; "just now" when one is fourteen minutes behind
     * hides the stale one. Only one of those two errors can mislead someone
     * about the weather.
     *
     * ==> A TIMESTAMP GOES UP, NOT A SENTENCE, AND THAT IS NOT A STYLE CHOICE.
     * This function runs on events — a fetch finishing, a mode changing, a poll
     * — and the poll is five minutes apart. A string formatted here would be
     * frozen at whatever it said when the frame landed, so a frame fetched four
     * minutes ago would still read "just now" (formatAge flips at two) until
     * something unrelated happened to call report(). Opening the Layers panel
     * re-renders the row but cannot re-derive a sentence somebody else already
     * baked. So the view formats at render, which is what lib/time.js's header
     * asks for and what view-storm-detail already does with `observedAt`.
     *
     * `state: 'info'` and not 'empty': the row is working and this is a
     * qualification, not a fault. The view renders it quiet, below error and
     * empty and above the standing coverage caveat. */
    const stamps = rows.map((d) => d.fetchedAt).filter((t) => Number.isFinite(t));
    if (stamps.length) {
      return onStatus({ state: 'info', at: Math.min(...stamps) });
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
      /* The request `blob` was fetched under — mode, satellite, and the box it
       * was addressed to. A repaint has to re-run against the SAME request or
       * it would key a radar frame with a satellite's palette, or draw an old
       * box's pixels at a new box's corners. */
      req: null,
      /* When `blob` was DOWNLOADED — never when the picture was taken. We send
       * no TIME parameter (IMAGERY_SENDS_NO_TIME) so the vendor never tells us
       * the frame's own time, and cross-origin CORS would not have let us read
       * `Date` or `Age` even before the relay. The row says "Downloaded" for
       * exactly this reason: claiming to know the observation time would be a
       * confident wrong answer, which §5 rates worse than no answer. */
      fetchedAt: null,
      busy: false, failed: false, empty: false, noColour: false,
    };
    discs.set(id, rec);
    return rec;
  }

  /** Is this request still the one the app is waiting for?
   *
   *  TWO QUESTIONS, AND BOTH ARE NEEDED. The generation catches a mode change;
   *  the record identity catches a disc that was dropped and rebuilt under the
   *  same storm id, which a generation check alone reads as still-valid. That
   *  second case is the one that put satellite frames under the radar segment. */
  const isCurrent = (id, rec, req) =>
    !destroyed && req.gen === generation && discs.get(id) === rec;

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

  /**
   * Address one request, and describe it completely.
   *
   * RETURNS THE REQUEST RATHER THAN MUTATING THE RECORD. It used to write
   * `rec.satId` as a side effect, which is precisely how a radar frame reached
   * the colour knockout with no bird attached: the radar branch never set it, so
   * a stale record still carried whatever (or nothing) a previous mode had left
   * there. Everything the render needs now travels WITH the request — mode,
   * bird, and the exact box the bytes describe — so no later change to module
   * state can reinterpret bytes that were fetched under different terms.
   *
   * Returns null when this storm has no imagery to ask for.
   */
  function addressRequest(storm) {
    const req = {
      gen: generation,
      mode,
      satId: null,
      lat: storm.lat,
      lon: storm.lon,
      /* PINNED, and this is the second bug it fixes. The corners used to be
       * recomputed from `rec.lat/rec.lon` at DRAW time while the bbox came from
       * `storm.lat/lon` at REQUEST time — and `update()` can move the record in
       * between. A storm that moved mid-fetch had its frame drawn at
       * coordinates the image does not describe. */
      radiusKm: tuning.radiusKm,
      url: null,
    };

    if (mode === 'radar') {
      if (!inRadarCoverage(storm.lat, storm.lon)) return null;
      const { bbox } = discBox(storm.lat, storm.lon, req.radiusKm);
      req.url = radarUrl(bbox, IMAGERY.requestPx);
      return req;
    }

    const sat = satelliteForLon(storm.lon);
    if (!sat) return null;
    req.satId = sat.id;
    const { bbox } = discBox(storm.lat, storm.lon, req.radiusKm);
    req.url = discUrl(sat, bbox);
    return req;
  }

  /**
   * Run one vendor frame through the pass and put it on the map.
   *
   * SPLIT OUT OF THE FETCH so a fade change can re-run it against the cached
   * blob with no network at all. Everything from the decode down is identical
   * whether the bytes just arrived or have been sitting in `rec.blob` — and
   * two copies of a pixel pipeline is exactly how one of them goes stale.
   */
  async function renderFrame(id, rec, blob, req) {
    const bmp = await createImageBitmap(blob);
    /* Checked against THE REQUEST, not against live module state. A frame whose
     * mode has been switched away from, or whose disc was rebuilt underneath it,
     * is thrown away here rather than painted with somebody else's palette. */
    if (!isCurrent(id, rec, req)) {
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
    if (req.mode === 'satellite') {
      const sat = SATELLITES.find((s) => s.id === req.satId);
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
    if (!isCurrent(id, rec, req) || !out) return;

    const next = URL.createObjectURL(out);
    /* THE REQUEST'S OWN BOX. Re-deriving this from the record would draw these
     * pixels wherever the storm has moved to since, which is a picture of one
     * place presented as another. */
    drawFrame(id, next, discBox(req.lat, req.lon, req.radiusKm).corners);

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
      if (!rec.blob || !rec.req || rec.busy) continue;
      try {
        /* The CACHED request, re-stamped to now. Mode, bird and box must stay
         * the ones the bytes were fetched under; only the generation moves, so
         * this repaint counts as current. The fade itself is read live inside
         * the pass — that is the whole reason a repaint exists. */
        await serialised(() => renderFrame(id, rec, rec.blob, { ...rec.req, gen: generation }));
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

    const req = addressRequest(storm);
    if (!req) {
      /* Outside coverage. Say so — never leave the last frame sitting under a
       * storm it does not describe, and never draw a blank raster, which
       * reads as clear sky (§5). */
      rec.empty = true;
      rec.failed = false;
      clearDisc(rec, storm.id);
      report();
      return;
    }

    /* ==> PAINT WHAT WE ALREADY HAVE, FIRST, BEFORE ANY NETWORK. <==
     *
     * The frame cache is keyed on the request URL, not on the disc, so a toggle
     * away and back finds the bytes it fetched a moment ago instead of asking
     * for them again. This is the whole answer to Aaron's "it looks to be
     * redownloading the image again" — it was, every time.
     *
     * SERVED SYNCHRONOUSLY-ISH AND THEN POSSIBLY REFRESHED, which is §5's rule
     * about stale data beating a blank screen applied to a five-minute product:
     * something true and labelled is on screen within a frame, and a newer one
     * replaces it when it lands. `getFrame` refuses anything past
     * `maxServeAge`, so this can never paint an hour-old sky as current.
     *
     * `rec.busy` is deliberately NOT set for this path. It is the "a network
     * request is outstanding" flag, and a cache hit is not one — setting it
     * would make the row read `loading` while a complete picture was already
     * drawn. */
    const cached = getFrame(req.url);
    if (cached) {
      rec.blob = cached.blob;
      rec.req = req;
      rec.fetchedAt = cached.fetchedAt;
      try {
        await serialised(() => renderFrame(storm.id, rec, cached.blob, req));
      } catch {
        /* A cached frame that will not decode is not worth reporting: the fetch
         * below replaces it either way, and the bytes are dropped so a later
         * repaint cannot try the same broken blob again. */
        evictFrame(req.url);
        rec.blob = null;
        rec.req = null;
      }
      if (!isCurrent(storm.id, rec, req)) return;
      /* CURRENT ENOUGH IS THE END OF THE STORY. The poll timer owns how often
       * frames are replaced (POLL.imagery), so refetching something younger
       * than one poll interval would be asking the same question twice. */
      if (frameIsCurrent(req.url)) {
        rec.failed = false;
        report();
        return;
      }
      report();
    }

    rec.busy = true;
    report();

    try {
      const res = await fetch(req.url, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      /* THE REQUEST HAS TO STILL BE WANTED. This check used to ask only
       * `discs.has(id)`, which a rebuilt record answers yes to — so a frame
       * from a mode the user had already left went on to be drawn, and wrote
       * its verdict onto a record nobody reads. */
      if (!isCurrent(storm.id, rec, req)) return;
      rec.blob = blob;
      rec.req = req;
      /* Stamped and cached BEFORE the render. The bytes are good regardless of
       * whether the pixel pass then succeeds, and a render that throws must not
       * cost the next toggle another download. */
      rec.fetchedAt = Date.now();
      putFrame(req.url, blob, rec.fetchedAt);
      await serialised(() => renderFrame(storm.id, rec, blob, req));
      /* Guarded on the way OUT too: the render above spans two awaits, and a
       * toggle landing inside them means this verdict is about a frame that
       * was correctly discarded. Writing `failed = false` for it would clear a
       * fault the current request may genuinely have. */
      if (isCurrent(storm.id, rec, req)) rec.failed = false;
    } catch {
      /* No raw exception text anywhere near the user (§5). The row says what
       * broke in human language; re-tapping the segment is the retry.
       *
       * A SUPERSEDED REQUEST REPORTS NOTHING. Its failure is not the current
       * segment's failure, and an amber row for a mode the user has already
       * left is the §5 silence bug inverted — noise where there is no fault. */
      if (!isCurrent(storm.id, rec, req)) return;
      rec.failed = true;
      /* Clear the greyscale reading with it — it described a frame we no
       * longer have, and a stale flag would report the wrong fault. The cached
       * blob goes too: it was addressed to a box we may no longer be drawing,
       * and repainting it would put old weather under a moved storm. */
      rec.noColour = false;
      rec.blob = null;
      rec.req = null;
      rec.fetchedAt = null;
    } finally {
      /* `busy` is bookkeeping on THIS record and is always released, current or
       * not — an orphan left busy forever would block nothing, but a record
       * that is still live and stuck busy would never refresh again. */
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
     * later repaint draw old weather under a moved storm.
     *
     * The CACHE entry is left alone: it is keyed by the request, and that box is
     * still honestly what that URL returns. If the storm wanders back, or the
     * radius slider comes back to where it was, the frame is still good. */
    rec.blob = null;
    rec.req = null;
    rec.fetchedAt = null;
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
      /* NORMALISED BEFORE THE COMPARE. `next === mode` against the raw value
       * meant an unrecognised segment (or a second push of 'off' spelled any
       * other way) tore down every disc and refetched the set to arrive at the
       * state it was already in. main.js pushes this on EVERY layer change. */
      const want = next === 'satellite' || next === 'radar' ? next : 'off';
      if (want === mode) return;
      mode = want;
      /* Everything already in flight is now answering a question nobody asked.
       * One increment retires all of it — see the note on `generation`. */
      generation++;
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
     *  recovery, there is no second button.
     *
     *  THE CACHED FRAME IS EVICTED FIRST, and without that this button would
     *  stop working the day the cache landed: a retry that answers from cache
     *  hands back the bytes already on screen and reports success, which is a
     *  control that looks like it worked and did nothing. Same reason
     *  data/cache.js's `evictGeometry` exists on the re-selection path. */
    retry() {
      for (const d of discs.values()) {
        d.failed = false;
        if (d.req?.url) evictFrame(d.req.url);
      }
      refreshAll();
    },

    destroy() {
      destroyed = true;
      stopTimer();
      document.removeEventListener('visibilitychange', onVisibility);
      dropAll();
      /* The frames go with the instance. They are keyed by request rather than
       * by disc precisely so they outlive a disc — but not the map that was
       * drawing them, or a restyle would leak a set of frames per theme change. */
      clearFrames();
    },
  };
}
