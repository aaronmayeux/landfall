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
import { TILES } from './config/constants.js';
import {
  createGlobe,
  attachIdleRotation,
  attachKeyboard,
  attachEscape,
  recenter,
  flyToStorm,
} from './map/globe.js';
import { setGraticuleVisible } from './map/graticule.js';
import { setStatus, sourceHealthMessage } from './ui/status.js';
import { createGlobe3d } from './map/globe3d.js';
import { sevFromKt } from './map/heightfield.js';
import { addStormMarkers, stormAtPoint } from './map/markers.js';
import { createStormsPanel } from './ui/panel-storms.js';
import { startPolling, subscribe, refresh, overallStatus } from './data/store.js';
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
  r.setProperty('--mesh', DARK.mesh);
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
 *   tile error  >  feed outage / stale  >  placeholder-basemap notice  > quiet
 */
function makeStatusArbiter() {
  let tileError = false;
  let pmtilesMissing = false;
  let feed = null; // {message, tone} | null
  let mapLoaded = false;

  const render = () => {
    if (pmtilesMissing) {
      return setStatus('Basemap could not start — reload to try again', 'error');
    }
    if (tileError) return setStatus('Basemap tiles are not loading', 'error');
    if (feed) return setStatus(feed.message, feed.tone);
    if (mapLoaded && !TILES.useR2) {
      return setStatus('Placeholder basemap — R2 tiles not yet built', 'stale');
    }
    setStatus(null);
  };

  return {
    tileError() { tileError = true; render(); },
    pmtilesMissing() { pmtilesMissing = true; render(); },
    feedHealth(msg) { feed = msg; render(); },
    mapLoaded() { mapLoaded = true; render(); },
  };
}

/* --- pmtiles protocol --------------------------------------------------------
 * MapLibre has no native `pmtiles://` scheme. style-dark.js builds one for the
 * R2 basemap, so the protocol must be registered BEFORE createGlobe() parses
 * the style — after is too late, the source has already failed to resolve.
 *
 * Registered unconditionally rather than behind TILES.useR2, so that flipping
 * that flag stays a genuine one-line change with no second edit here.
 *
 * If the CDN script failed, say so on the strip rather than dying silently at
 * style load with an unknown-protocol error nobody can read.
 */
function registerPmtiles() {
  if (!TILES.useR2) return true;
  if (typeof pmtiles === 'undefined') {
    console.warn('[landfall] pmtiles library missing; R2 basemap cannot load');
    return false;
  }
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  return true;
}

function boot() {
  applyTokens();

  const pmtilesReady = registerPmtiles();

  /* Two engines: MapLibre on #globe (the input surface, hidden behind at
   * opacity 0 in space), the Three.js clear globe overlay on #gl (pointer-
   * events:none, purely visual). */
  const map = createGlobe(document.getElementById('globe'));
  const g3d = createGlobe3d(document.getElementById('gl'), map, {
    mapEl: document.getElementById('globe'),
    spaceEl: document.getElementById('spacebg'),
  });

  const idle = attachIdleRotation(map);
  attachKeyboard(map);

  /* Selection comes from panels (off-canvas), so the drift never sees the
   * gesture — interrupt it explicitly or its per-frame setCenter stomps the
   * flyTo. Also resets the auto-rotate clock, as any interaction does. */
  const selectStorm = (storm) => {
    idle.interrupt();
    flyToStorm(map, storm);
  };

  const status = makeStatusArbiter();
  if (!pmtilesReady) status.pmtilesMissing();
  map.on('error', (e) => {
    console.warn('[landfall] map error', e?.error || e);
    status.tileError();
  });

  /* --- the storm list panel (the accessibility surface) ------------------- */
  const panel = createStormsPanel({
    root: document.getElementById('panel-storms'),
    pill: document.getElementById('storm-pill'),
    toggleButton: document.getElementById('btn-storms'),
    onSelect: selectStorm,
    onRetry: () => refresh(),
  });

  /* Escape, once, at the document level: close the panel if open, else
   * recenter (SPEC §10). Attached here because it needs the panel. */
  attachEscape(map, {
    isPanelOpen: () => panel.isOpen(),
    closePanel: () => panel.close(),
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
    status.mapLoaded();

    markers = addStormMarkers(map);
    markers.update(lastStorms);

    /* Tap/click a storm dot — same action as a list row (SPEC §16). The 44 px
     * hit box lives in stormAtPoint; cursor feedback rides layer hover. */
    map.on('click', (e) => {
      const id = stormAtPoint(map, e.point);
      const storm = id && lastStorms.find((s) => s.id === id);
      if (storm) selectStorm(storm);
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
    if (markers) markers.update(state.storms);
    panel.update(state);
    status.feedHealth(sourceHealthMessage(state.sources));

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
    .addEventListener('click', () => recenter(map));

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
  window.__landfall = { map, g3d, getState: () => ({ storms: lastStorms }) };
}

boot();
