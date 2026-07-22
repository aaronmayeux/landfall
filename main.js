/**
 * main.js — WIRING ONLY.
 *
 * SPEC §12: "main.js  wiring only — target under 100 lines."
 *
 * If logic starts accumulating here, it belongs in the module that owns its
 * concern. Never bolt onto main.js for convenience.
 */

import { DARK, FONT, SIZE, SPACE } from './config/tokens.js';
import { TILES } from './config/constants.js';
import {
  createGlobe,
  runOpeningSequence,
  attachIdleRotation,
  attachKeyboard,
  recenter,
  markVisit,
} from './map/globe.js';
import { setGraticuleVisible } from './map/graticule.js';
import { setStatus } from './ui/status.js';

/**
 * Pushes tokens.js values into CSS custom properties.
 *
 * CSS cannot import a JS module, so without this the palette would live in two
 * places and drift. The <style> block in index.html holds first-paint
 * fallbacks; this overwrites them from the real source.
 */
function applyTokens() {
  const r = document.documentElement.style;
  r.setProperty('--ocean', DARK.ocean);
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

  const map = createGlobe(document.getElementById('globe'));

  /* The nodal mesh is now the planet-band identity (SPEC §9, as-built), so the
   * lat/long graticule ships OFF by default — it stays a toggle for when the
   * equator/tropics reference is wanted, but two grids at planet zoom is noise.
   */
  let graticuleOn = false;

  /* Phase 1 has no data layer, so the only failure that can surface is the
   * basemap itself. Named in human language, never raw exception text.
   *
   * An error OUTRANKS the placeholder notice below and is sticky — once tiles
   * have failed, the strip must not fall back to a cheerier message on the
   * next successful event. Precedence is explicit, not a side effect of which
   * handler happened to fire last. */
  let tileError = false;
  map.on('error', (e) => {
    console.warn('[landfall] map error', e?.error || e);
    tileError = true;
    setStatus('Basemap tiles are not loading', 'error');
  });

  map.once('load', () => {
    document.getElementById('veil').dataset.lifted = 'true';

    /* Graticule is added visible in style.load; honor the off-by-default state
     * here, once its layers exist. */
    setGraticuleVisible(map, graticuleOn);
    document
      .getElementById('btn-graticule')
      .setAttribute('aria-pressed', String(graticuleOn));

    runOpeningSequence(map, {
      onSettled: () => {
        attachIdleRotation(map);
        markVisit();
      },
    });

    if (!TILES.useR2 && !tileError) {
      setStatus('Placeholder basemap — R2 tiles not yet built', 'stale');
    }
  });

  attachKeyboard(map, { onEscape: () => recenter(map) });

  document
    .getElementById('btn-recenter')
    .addEventListener('click', () => recenter(map));

  const gratBtn = document.getElementById('btn-graticule');
  gratBtn.addEventListener('click', () => {
    graticuleOn = !graticuleOn;
    setGraticuleVisible(map, graticuleOn);
    gratBtn.setAttribute('aria-pressed', String(graticuleOn));
  });

  /* Exposed for console poking during Phase 1 bring-up. Remove in Phase 2
   * once there is a real store to inspect instead. */
  window.__landfall = { map };
}

boot();
