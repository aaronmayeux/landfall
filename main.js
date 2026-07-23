/**
 * main.js — WIRING ONLY.
 *
 * SPEC §12: "main.js  wiring only." No globe logic, no fade math — those live in
 * map/globe3d.js and map/globe.js.
 *
 * The model: MapLibre owns the one zoom and the one camera. The Three.js clear
 * globe (map/globe3d.js) is a pure overlay slaved to it, crossfading out as you
 * zoom in. So input is all MapLibre's — scroll/pinch/+ zoom, drag pans, arrows
 * pan, Esc flies back to space. There is no dive button and no modes to route.
 */

import { DARK, FONT, SIZE, SPACE } from './config/tokens.js';
import { TILES } from './config/constants.js';
import {
  createGlobe,
  attachIdleRotation,
  attachKeyboard,
  recenter,
} from './map/globe.js';
import { setGraticuleVisible } from './map/graticule.js';
import { setStatus } from './ui/status.js';
import { createGlobe3d } from './map/globe3d.js';
import { attachGdacsSeverity } from './map/heightfield.js';

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

function boot() {
  applyTokens();

  /* Two engines: MapLibre on #globe (the input surface, hidden behind at
   * opacity 0 in space), the Three.js clear globe overlay on #gl (pointer-
   * events:none, purely visual). */
  const map = createGlobe(document.getElementById('globe'));
  const g3d = createGlobe3d(document.getElementById('gl'), map, {
    mapEl: document.getElementById('globe'),
    spaceEl: document.getElementById('spacebg'),
  });

  /* Feed the storm heightfield. Temporary GDACS seam; Phase 2's data layer
   * replaces the SOURCE, not the heightfield (SPEC §15 item 3). */
  attachGdacsSeverity(g3d.heightfield);

  /* Idle drift (stops on interaction, only spins while zoomed out) and the
   * keyboard bindings both live on the map — the one input surface. */
  attachIdleRotation(map);
  attachKeyboard(map, { onEscape: () => recenter(map) });

  /* Phase 1 has no data layer, so the only failure that can surface is the
   * basemap. Named in human language; an error OUTRANKS the placeholder notice
   * and is sticky (precedence is explicit, not last-handler-wins). */
  let graticuleOn = false;
  let tileError = false;
  map.on('error', (e) => {
    console.warn('[landfall] map error', e?.error || e);
    tileError = true;
    setStatus('Basemap tiles are not loading', 'error');
  });

  map.once('load', () => {
    setGraticuleVisible(map, graticuleOn);
    document
      .getElementById('btn-graticule')
      .setAttribute('aria-pressed', String(graticuleOn));
    if (!TILES.useR2 && !tileError) {
      setStatus('Placeholder basemap — R2 tiles not yet built', 'stale');
    }
  });

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

  /* Exposed for console poking during bring-up. Remove in Phase 2. */
  window.__landfall = { map, g3d };
}

boot();
