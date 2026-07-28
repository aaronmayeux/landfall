/**
 * theme-switch.js — dark/light, everywhere it lands.
 *
 * Two halves, and they are separate on purpose:
 *
 *   `applyTokens()`  the CHROME. Rewrites the CSS variables the whole
 *                    interface is already written against, so every panel,
 *                    row and button repaints with no per-component work.
 *                    Needs nothing but the DOM, which is why boot can call it
 *                    before either rendering engine exists.
 *
 *   `createThemeSwitch()`  the ENGINES. The 3D globe's materials and the
 *                    basemap style carry baked colour and need real code.
 *                    Needs the map, so it cannot exist until the map does.
 *
 * ORDER IS THE ORDER THE USER SEES: chrome first (a variable rewrite,
 * effectively instant), then the 3D globe, then the basemap restyle, which is
 * the slow one.
 *
 * Not `config/theme.js` — that file is the pure palette and mode resolution
 * and is imported by tools/contrast-check.mjs, so it must stay DOM-free. This
 * file is the application of it.
 *
 * Imports: config/ and map/. Nothing imports this except main.js.
 */

import { FONT, SIZE, SPACE } from '../config/tokens.js';
import { palette, resolveMode, setThemeMode, themeMode } from '../config/theme.js';
import { buildStyle } from '../map/style.js';
import { settingValue } from '../data/settings-prefs.js';

/**
 * Every themed CSS variable, plus the two browser-level hints that go with
 * them.
 *
 * `color-scheme` is what tells the browser to render form controls,
 * scrollbars and the overscroll gutter in the matching theme — miss it and a
 * light app gets dark scrollbars.
 */
export function applyTokens() {
  const P = palette();
  const r = document.documentElement.style;
  r.setProperty('--ocean', P.ocean);
  r.setProperty('--space', P.space);
  r.setProperty('--space-near', P.spaceNear);
  r.setProperty('--space-far', P.spaceFar);
  r.setProperty('--text-primary', P.textPrimary);
  r.setProperty('--text-secondary', P.textSecondary);
  r.setProperty('--text-muted', P.textMuted);
  r.setProperty('--glass', P.glass);
  r.setProperty('--glass-raised', P.glassRaised);
  r.setProperty('--glass-border', P.glassBorder);
  r.setProperty('--glass-shadow', P.glassShadow);
  r.setProperty('--focus-ring', P.focusRing);
  r.setProperty('--seg-active', P.segActive);
  r.setProperty('--seg-active-edge', P.segActiveEdge);
  r.setProperty('--install-cta', P.installCta);
  r.setProperty('--install-cta-ink', P.installCtaInk);
  r.setProperty('--error', P.error);
  r.setProperty('--stale', P.stale);
  r.setProperty('--ok', P.ok);
  r.setProperty('--dim', P.dim);
  r.setProperty('--font-ui', FONT.ui);
  r.setProperty('--font-numeric', FONT.numeric);
  r.setProperty('--touch-target', SIZE.touchTarget);

  /* TWO PAIRS, DELIBERATELY NAMED APART. The chrome's ring is 2px against a
   * glass panel; the globe's is thicker and inset because it has to read
   * against a lit ocean at the very edge of the viewport. They shared the
   * `--focus-ring-*` prefix until 2026-07-28, which made a globe-only value
   * look like the app-wide one and left every button hardcoding its own 2px
   * instead of reading a token. */
  r.setProperty('--focus-ring-width', SIZE.focusRingWidth);
  r.setProperty('--focus-ring-offset', SIZE.focusRingOffset);
  r.setProperty('--globe-ring-width', SIZE.globeRingWidth);
  r.setProperty('--globe-ring-inset', SIZE.globeRingInset);
  r.setProperty('--globe-ring-radius', SIZE.globeRingRadius);

  r.setProperty('--radius', SIZE.radius);
  r.setProperty('--radius-large', SIZE.radiusLarge);
  r.setProperty('--space-tight', SPACE.tight);
  r.setProperty('--space-snug', SPACE.snug);
  r.setProperty('--space-base', SPACE.base);
  r.setProperty('--space-comfy', SPACE.comfy);

  document.documentElement.dataset.theme = themeMode();
  document.documentElement.style.colorScheme = themeMode();

  /* The browser UI around the app — the iOS status bar area and the Android
   * address bar — takes its colour from this meta. Left on the dark ocean it
   * would frame a daylight globe in a black band. */
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', P.ocean);
}

/**
 * The live theme switch.
 *
 * ONLY EVER HANDLES CHANGES. The boot-time resolution happens before anything
 * is built (see the note at the top of boot) — `setThemeMode` returns false
 * when the resolved mode is already live, which is what makes `apply()` cheap
 * to call from both the settings subscription (which fires on EVERY setting
 * change, not just this one) and the OS listener.
 *
 * @param {object} deps
 * @param {object} deps.map  the MapLibre map
 * @param {object} deps.g3d  the Three.js globe overlay
 * @param {object} deps.engine  the layer engine, invalidated before a restyle
 * @param {MediaQueryList|null} deps.prefersLight
 * @param {() => void} deps.onStyleRebuild  fired when the style is thrown away,
 *   so the caller can drop its own "the style is ready" flag. Ownership of that
 *   flag stays in main.js — this file must not be the one deciding when the
 *   app may touch the style again.
 */
export function createThemeSwitch({ map, g3d, engine, prefersLight, onStyleRebuild }) {
  function apply() {
    if (!setThemeMode(resolveMode(settingValue('theme'), !!prefersLight?.matches))) return;

    applyTokens();
    g3d.retheme();

    /* THE BASEMAP IS REBUILT, NOT REPAINTED. Walking every layer with
     * setPaintProperty would mean a second list of every themed property in
     * the app, kept in step with map/style.js by hand — the exact drift §12
     * says to design out. A style object is plain data; building a new one and
     * handing it over is one call, and main.js's installOnStyle puts the app's
     * own layers back on the style.load that follows.
     *
     * `diff: false` because the two styles differ in nearly every paint
     * property; the diff would be larger than the style. `engine.invalidate()`
     * FIRST — setStyle deletes the engine's layers, and an engine that still
     * thinks it is attached would decline to rebuild them. */
    engine.invalidate();
    onStyleRebuild?.();
    map.setStyle(buildStyle(), { diff: false });
  }

  /* Follow the OS while the app is open, but ONLY for someone who chose to
   * follow it. `apply` re-resolves the stored preference, so an explicit Dark
   * or Light simply returns false from setThemeMode and nothing happens. */
  prefersLight?.addEventListener?.('change', apply);

  return { apply };
}
