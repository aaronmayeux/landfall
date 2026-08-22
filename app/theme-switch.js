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
 *   `createThemeSwitch()`  the ENGINES. The 3D globe's materials carry baked
 *                    color and need real code; the basemap needs one call.
 *                    Needs the map, so it cannot exist until the map does.
 *
 * ORDER IS THE ORDER THE USER SEES: chrome first (a variable rewrite,
 * effectively instant), then the 3D globe, then the basemap.
 *
 * ==> THE BASEMAP USED TO BE THE SLOW ONE AND IS NOW THE FAST ONE. <== It was
 * a full `setStyle` teardown and reinstall; it is a `setGlobalState` call. The
 * remaining cost of a theme flip is the 3D globe's land texture, which
 * `map/globe3d.js` handles with the same draft-then-upgrade it uses at boot.
 *
 * Not `config/theme.js` — that file is the pure palette and mode resolution
 * and is imported by tools/contrast-check.mjs, so it must stay DOM-free. This
 * file is the application of it.
 *
 * Imports: config/ and map/. Nothing imports this except main.js.
 */

import { FONT, SIZE, SPACE, WIND_BAND_COLOR } from '../config/tokens.js';
import { palette, resolveMode, setThemeMode, themeMode } from '../config/theme.js';
import { themeState } from '../map/theme-state.js';
import { rethemePopulation } from '../map/population.js';
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
  r.setProperty('--scroll-thumb', P.scrollThumb);
  r.setProperty('--scroll-thumb-hover', P.scrollThumbHover);
  r.setProperty('--hover', P.hover);
  r.setProperty('--focus-ring', P.focusRing);
  r.setProperty('--seg-active', P.segActive);
  r.setProperty('--seg-active-edge', P.segActiveEdge);
  r.setProperty('--switch-on', P.switchOn);
  r.setProperty('--install-cta', P.installCta);
  r.setProperty('--install-cta-ink', P.installCtaInk);
  r.setProperty('--install-cta-edge', P.installCtaEdge);
  r.setProperty('--error', P.error);
  r.setProperty('--stale', P.stale);
  r.setProperty('--home-band-fill', P.homeBandFill);
  r.setProperty('--home-band-edge', P.homeBandEdge);

  /* ==> THE HOME LINE ITSELF, AND IT WAS BLACK TOO. <== `ui/chart-home.js`
   * draws the reader's own house as a bold line in the coastline's cyan and
   * labels it "home" in the same color. Both read the `--coast-glow` custom property, which
   * nothing declared, so the single most important reference on the chart —
   * the line everything else is measured against — rendered black on a dark
   * panel and simply was not there. Found by the sweep in
   * tools/test-css-vars.mjs, not by looking: on the mockup page it was fine,
   * and on a phone it is an absence rather than a wrong color, which is the
   * hardest kind of thing to notice.
   *
   * THEMED, unlike the wind bands: it is the coastline's own color and it
   * moves with the palette (§9), so it comes off `palette()` and not a fixed
   * contract. */
  r.setProperty('--coast-glow', P.coastGlow);

  /* THE ENVIRONMENT RAMP (§47.11), SO THE LEGEND CANNOT DRIFT FROM THE MAP.
   * The legend bar is a CSS gradient across these three, and the cone slices
   * are colored by walking the same three in lib/cone-ribbon.js. One source,
   * two surfaces — the alternative is three hexes typed into panels.css that
   * are right on the day they are typed and silently wrong after any retune.
   *
   * THEMED, so the bar repaints with the globe: the light theme's ramp is not
   * the dark one lightened and its hostile end is the DAYLIGHT sea, so a fixed
   * gradient would be inverted rather than merely off. */
  /* ==> THE NAMES ARE THE KNOTS, NOT THE ARRAY INDICES. <== `lo` is -15 kt,
   * `mid` is 0, `hi` is +15 and `out` is +40, and each has meant that since the
   * legend existed. The palette gained a stop BELOW `lo` (§47.5's symmetry
   * fix), so the indices all shifted by one while the meanings did not — which
   * is exactly why the names are worth keeping still. */
  r.setProperty('--env-ramp-floor', P.geo.envRamp[0]);
  r.setProperty('--env-ramp-lo', P.geo.envRamp[1]);
  r.setProperty('--env-ramp-mid', P.geo.envRamp[2]);
  r.setProperty('--env-ramp-hi', P.geo.envRamp[3]);
  /* ==> THE OUTER STOPS, AND PUBLISHING THEM IS NOT OPTIONAL. <== §47.4
   * extended the ramp past +15 kt and §47.5 made it symmetric so 0 kt sits in
   * the middle. A legend bar drawn from fewer stops would be a key to a scale
   * the map stopped using — it would show the cone's brightest hour as a colour
   * the cone no longer paints there, and put `Balanced` in the wrong place. The
   * bar's knots are spaced to match in ui/panels.css. */
  r.setProperty('--env-ramp-out', P.geo.envRamp[4]);

  /* ==> THE WIND BANDS, AND THEY WERE MISSING FOR THE WHOLE LIFE OF THE CHART.
   * <== `ui/chart-home.js` fills its 34/50/64 kt bands from the
   * `--kt34`/`--kt50`/`--kt64` custom properties. Nothing defined them. An unresolvable `var()` in an SVG
   * presentation attribute does not warn and does not fall back — `fill`
   * reverts to its initial value, which is BLACK — so the home dashboard's
   * hero rendered three black shapes on a dark globe and said nothing.
   *
   * IT WAS INVISIBLE FOR A SPECIFIC REASON WORTH REMEMBERING: the only place
   * the chart could be seen was `mockups/home-corridor.html`, which declares
   * these three in its own `:root` because it is a standalone page. The mockup
   * was therefore the one context where the bug could not appear, and it was
   * the only context anyone looked at.
   *
   * NOT THEMED, DELIBERATELY. §6 fixes the wind-band hues in both themes, so
   * they come off WIND_BAND_COLOR rather than the palette — and they are set
   * here rather than typed into index.html so the contract has exactly one
   * source. */
  r.setProperty('--kt34', WIND_BAND_COLOR.KT34);
  r.setProperty('--kt50', WIND_BAND_COLOR.KT50);
  r.setProperty('--kt64', WIND_BAND_COLOR.KT64);
  r.setProperty('--ok', P.ok);
  r.setProperty('--dim', P.dim);
  r.setProperty('--font-ui', FONT.ui);
  r.setProperty('--font-numeric', FONT.numeric);
  r.setProperty('--touch-target', SIZE.touchTarget);
  r.setProperty('--glass-blur', SIZE.glassBlur);
  r.setProperty('--glass-blur-raised', SIZE.glassBlurRaised);
  r.setProperty('--pill-inset', SIZE.pillInset);
  r.setProperty('--pill-mark', SIZE.pillMark);

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
   * address bar — takes its color from this meta. Left on the dark ocean it
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
 * @param {MediaQueryList|null} deps.prefersLight
 * @param {() => void} deps.onRepushGuidance  re-push the model guidance, whose
 *   colors are baked into the FEATURES and so cannot be reached by any paint
 *   property. main.js owns the pipeline; this file only knows when.
 */
export function createThemeSwitch({ map, g3d, prefersLight, onRepushGuidance }) {
  function apply() {
    if (!setThemeMode(resolveMode(settingValue('theme'), !!prefersLight?.matches))) return;

    applyTokens();
    g3d.retheme();

    /* ==> THE BASEMAP IS REPAINTED, NOT REBUILT, AND THAT IS THE WHOLE CHANGE.
     *
     * This was `map.setStyle(buildStyle(), { diff: false })` — throw the entire
     * style away, let main.js reinstall the app's storm layers on the
     * `style.load` that followed, and eat the flash. Thirteen hex values, paid
     * for with a full basemap teardown.
     *
     * `map/style.js` now writes every themed color as a `global-state`
     * reference, so those thirteen values live in one place MapLibre can be
     * handed directly. It re-evaluates the paint properties that read them and
     * repaints. The layer list is never touched, which is what makes this both
     * fast and safe.
     *
     * THREE THINGS DISAPPEARED WITH THE setStyle CALL, and none of them is
     * missing — they were all bookkeeping for the teardown:
     *   - `engine.invalidate()`: setStyle deleted the engine's layers, so the
     *     engine had to be told to stop believing it was attached. Nothing
     *     deletes them now.
     *   - `onStyleRebuild()`: main.js's "the style is ready" flag had to be
     *     dropped and re-raised. The style is never not ready.
     *   - the `style.load` reinstall: there is nothing to reinstall.
     *
     * THE APP'S OWN LAYERS MOVED TOO, and they had to. `installOnStyle` in
     * main.js is what used to re-bake the cones, tracks, forecast dots and
     * storm markers with the new palette, and it only ran because `setStyle`
     * fired `style.load` again. Delete the setStyle and leave those layers
     * where they were and the light theme comes up with a dark cone on it —
     * so `map/theme-state.js` covers them as well. Twenty-eight keys, the
     * whole map.
     *
     * ==> `setGlobalStateProperty`, ONE KEY AT A TIME. THERE IS NO
     * `map.setGlobalState`. <==
     *
     * That method exists on the STYLE, not on the Map, and it takes the
     * `{ key: { default } }` shape a stylesheet uses rather than a flat map.
     * Calling `map.setGlobalState(...)` is a TypeError — which is exactly what
     * shipped on 2026-08-08. It threw here, so the two repaints below never
     * ran either, and the symptom on glass was "the map keeps its old colors
     * until I reload". The chrome and the 3D globe rethemed because they had
     * already happened, three lines up.
     *
     * `Map.setGlobalStateProperty(key, value)` is the public one, and it is the
     * public one for a reason: it writes the value AND calls `map._update(true)`,
     * which marks the style dirty so the paint properties reading that key are
     * re-evaluated on the next frame. The Style method does neither.
     *
     * TWENTY-EIGHT CALLS IS NOT TWENTY-EIGHT REPAINTS. `_update` sets two
     * booleans and requests one frame; the frame coalesces. And the internal
     * `_findGlobalStateAffectedSources` only reloads a SOURCE when the key is
     * read by a LAYOUT property or a filter — ours are all paint, so no tile is
     * re-requested. That is the same rule as the "only paint colors belong in
     * state" note in map/theme-state.js, arriving from the other direction.
     *
     * A no-op is free: the method returns early when the value has not moved. */
    for (const [key, value] of Object.entries(themeState())) {
      map.setGlobalStateProperty(key, value);
    }

    /* --- THE TWO THINGS A PAINT PROPERTY CANNOT REACH ---------------------
     * Both are documented at length in map/theme-state.js. In short: the
     * population ramp's stops carry per-stop alpha and bake into a texture,
     * and the model guidance's color is a property of each FEATURE rather
     * than of the layer. Neither is a color MapLibre can be handed.
     *
     * They are called HERE, together, so the list of exceptions is two lines
     * in one place. If it ever grows past three, the mechanism is wrong. */
    rethemePopulation(map);
    onRepushGuidance?.();
  }

  /* Follow the OS while the app is open, but ONLY for someone who chose to
   * follow it. `apply` re-resolves the stored preference, so an explicit Dark
   * or Light simply returns false from setThemeMode and nothing happens. */
  prefersLight?.addEventListener?.('change', apply);

  return { apply };
}
