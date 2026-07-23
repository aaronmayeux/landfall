/**
 * main.js — WIRING ONLY.
 *
 * SPEC §12: "main.js  wiring only." If logic starts accumulating here, it
 * belongs in the module that owns its concern. Never bolt onto main.js.
 *
 * The over-100-line target yields to the hybrid: this file now stands up TWO
 * engines (the 3D clear globe in front, MapLibre behind), hands the dive both,
 * and routes input by mode. Every line here is wiring — no globe logic, no dive
 * math, no geometry. Those live in map/globe3d.js, map/dive.js, map/globe.js.
 */

import { DARK, FONT, SIZE, SPACE } from './config/tokens.js';
import { TILES } from './config/constants.js';
import {
  createGlobe,
  attachIdleRotation,
  attachKeyboard,
  recenter,
  markVisit,
  isWarmLoad,
} from './map/globe.js';
import { setGraticuleVisible } from './map/graticule.js';
import { setStatus } from './ui/status.js';
import { createGlobe3d } from './map/globe3d.js';
import { attachGdacsSeverity } from './map/heightfield.js';
import { createDive } from './map/dive.js';

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

/** Radians per arrow-key press when aiming the globe in space (SPEC §10 — the
 *  keyboard path for the touch/mouse "drag to aim"). */
const AIM_STEP = 0.12;

function boot() {
  applyTokens();

  /* Two engines. MapLibre on #globe (hidden behind, opacity 0); the Three.js
   * clear globe on #gl (the entry). */
  const map = createGlobe(document.getElementById('globe'));
  const g3d = createGlobe3d(document.getElementById('gl'));

  /* Feed the storm heightfield. This is the temporary GDACS seam; Phase 2's
   * data layer replaces the SOURCE, not the heightfield (SPEC §15 item 3). */
  attachGdacsSeverity(g3d.heightfield);

  let graticuleOn = false;
  let idleDetach = null;

  const dive = createDive(map, g3d, {
    mapEl: document.getElementById('globe'),
    spaceEl: document.getElementById('spacebg'),
    onEnterMap: () => {
      document.body.dataset.mode = 'map';
      if (!idleDetach) idleDetach = attachIdleRotation(map);
    },
    onEnterSpace: () => {
      document.body.dataset.mode = 'space';
      if (idleDetach) {
        idleDetach();
        idleDetach = null;
      }
    },
  });

  /* Phase 1 has no data layer, so the only failure that can surface is the
   * basemap. Named in human language; an error OUTRANKS the placeholder notice
   * and is sticky (precedence is explicit, not last-handler-wins). */
  let tileError = false;
  map.on('error', (e) => {
    console.warn('[landfall] map error', e?.error || e);
    tileError = true;
    setStatus('Basemap tiles are not loading', 'error');
  });

  map.once('load', () => {
    dive.solveFraming(); // derive MapLibre's start zoom from the 3D framing
    setGraticuleVisible(map, graticuleOn);
    document
      .getElementById('btn-graticule')
      .setAttribute('aria-pressed', String(graticuleOn));
    if (!TILES.useR2 && !tileError) {
      setStatus('Placeholder basemap — R2 tiles not yet built', 'stale');
    }
  });

  /* Start the 3D globe, play the arrival fly-in unless it's a warm load (the
   * fly-in self-skips under reduce-motion), then lift the veil once a frame is
   * on glass. */
  g3d.start();
  if (!isWarmLoad()) g3d.startArrival();
  markVisit();
  requestAnimationFrame(() => {
    document.getElementById('veil').dataset.lifted = 'true';
  });

  /* --- controls ---------------------------------------------------------- */
  document
    .getElementById('btn-dive')
    .addEventListener('click', () => dive.start(g3d.getCenterLonLat()));
  document.getElementById('btn-back').addEventListener('click', () => dive.reverse());
  document
    .getElementById('btn-recenter')
    .addEventListener('click', () => recenter(map));

  const gratBtn = document.getElementById('btn-graticule');
  gratBtn.addEventListener('click', () => {
    graticuleOn = !graticuleOn;
    setGraticuleVisible(map, graticuleOn);
    gratBtn.setAttribute('aria-pressed', String(graticuleOn));
  });

  /* --- keyboard ---------------------------------------------------------- *
   * Map mode: MapLibre's replacement handler (arrows pan, +/- zoom, Esc
   * recenters) lives on the map canvas. Space mode: arrows AIM the 3D globe and
   * Enter dives — routed here because the 3D canvas is aria-hidden and the dive
   * button holds focus. */
  attachKeyboard(map, { onEscape: () => recenter(map) });
  window.addEventListener('keydown', (e) => {
    if (g3d.getMode() !== 'space' || e.metaKey || e.ctrlKey || e.altKey) return;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':  g3d.rotateBy(-AIM_STEP, 0); break;
      case 'ArrowRight': g3d.rotateBy(AIM_STEP, 0); break;
      case 'ArrowUp':    g3d.rotateBy(0, -AIM_STEP); break;
      case 'ArrowDown':  g3d.rotateBy(0, AIM_STEP); break;
      case 'Enter':
      case '+':
      case '=':          dive.start(g3d.getCenterLonLat()); break;
      default:           handled = false;
    }
    if (handled) e.preventDefault();
  });

  /* --- resize ------------------------------------------------------------ */
  window.addEventListener('resize', () => {
    g3d.resize();
    map.resize();
    if (g3d.getMode() === 'space' && map.loaded()) dive.solveFraming();
  });

  /* Exposed for console poking during bring-up. Remove in Phase 2. */
  window.__landfall = { map, g3d, dive };
}

boot();
