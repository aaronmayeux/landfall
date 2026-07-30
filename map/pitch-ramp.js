/**
 * pitch-ramp.js — THE CAMERA LEANS AS YOU DESCEND, AND ONLY ONCE THE GLOBE IS
 * GONE.
 *
 * ==> WHY THIS IS ALLOWED WHEN `map/globe.js` SAYS NO TILT. <== That file
 * disables `touchPitch` and `pitchWithRotate` because "a tilted sphere is
 * disorienting and buys nothing for storm data." Every word of that is still
 * true and nothing here changes it: both gesture handlers stay off, so there
 * is no way for a finger or a mouse to tilt anything. This is a programmatic
 * ramp that only operates BELOW the handoff, where there is no sphere — the
 * Three renderer has been cleared and MapLibre is a flat map, and a flat map
 * that leans is the ordinary thing maps do.
 *
 * ==> THE FLOOR IS MEASURED AND IT IS NOT NEGOTIABLE. <== `map/globe-follow.js`
 * drives the Three camera from MapLibre's, and it plants that camera on +Z
 * looking at the origin — it has no concept of pitch and never will, because
 * the 3D globe is a sphere seen from outside. Tilt while the 3D globe is
 * VISIBLE and the two planets come apart on screen. Visible ends at dive phase
 * 0.62 (the tail of `DIVE.fade.cage`), which is z3.86. `TILT.zStart` sits above
 * that. Do not lower it without re-reading `DIVE.fade`.
 *
 * ==> IT ALSO MOVES THE GLOBE→MERCATOR BLEND, AND THAT IS DELIBERATE. <==
 * MapLibre's `{type: 'globe'}` is shorthand for interpolating from
 * vertical-perspective to mercator between z11 and z12 — that pair was read out
 * of the vendored 5.6 bundle, not remembered. Left alone, the basemap is still
 * a partly-curved globe at z8 while the camera is leaning at 55°, which is a
 * warped map; and a MapLibre custom layer is only handed a plain mercator
 * matrix once that blend has finished. `TILT.flatten` moves the band down onto
 * the handoff, which fixes both.
 *
 * NOT WIRED INTO THE LIVE APP. `proto/shell.js` calls it. Adopting it in
 * `map/globe.js` is one line, after it has been seen on a phone.
 *
 * Imports: config/ only. No DOM, no THREE.
 */

import { TILT } from '../config/constants.js';

/** Smoothstep, so the lean has no corner at either end. */
function ease(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/**
 * The pitch this zoom should be at, in degrees.
 *
 * Exported and pure so `tools/test-volcano-map3d.mjs` can assert the floor
 * without a browser — the one property that matters here is that it returns
 * exactly 0 anywhere the 3D globe can still be seen.
 *
 * @param {number} zoom  map.getZoom()
 * @returns {number} degrees, 0..TILT.maxDeg
 */
export function pitchAt(zoom) {
  if (!(zoom > TILT.zStart)) return 0;
  return TILT.maxDeg * ease((zoom - TILT.zStart) / (TILT.zFull - TILT.zStart));
}

/**
 * The projection spec that replaces MapLibre's built-in globe band.
 *
 * `setProjection` takes an interpolation expression directly; `'globe'` is
 * merely the name of one particular expression. Same mechanism, different
 * numbers.
 *
 * @returns {object} a MapLibre projection spec
 */
export function flattenProjection() {
  const [z0, z1] = TILT.flatten;
  return {
    type: ['interpolate', ['linear'], ['zoom'], z0, 'vertical-perspective', z1, 'mercator'],
  };
}

/**
 * Attach the ramp to a map.
 *
 * ==> IT WRITES PITCH ON `zoomend`, NEVER ON `zoom`, AND THAT IS NOT A STYLE
 * PREFERENCE. <== `Map.setPitch` is `jumpTo({pitch})`, and `jumpTo`'s FIRST
 * STATEMENT is `this.stop()` — read out of the vendored bundle, not
 * remembered. `stop()` aborts whatever camera motion is in progress, and during
 * a pinch that motion IS the pinch. The first version wrote pitch on every
 * `zoom` event and so cancelled the gesture on every frame of it: reported on
 * glass as having to lift both fingers and re-pinch over and over to crawl
 * through the tilt band, then smooth again once past it. Scroll and keyboard
 * zoom run their own easing and would have broken identically.
 *
 * So pitch is written ONCE, after the zoom has come to rest — inertia
 * included, because `zoomend` fires after inertia finishes — and it eases in
 * over `TILT.settleMs` so the arrival is a movement rather than a jump.
 *
 * ==> THE PROJECTION IS SET ON `style.load` AND NOWHERE ELSE. TWO SEPARATE
 * THINGS BREAK IF IT IS NOT, AND BOTH BROKE. <==
 *
 * **`setProjection` THROWS BEFORE THE STYLE HAS LOADED.** MapLibre's
 * `Style.setProjection` opens with `_checkLoaded()`, which raises "Style is not
 * done loading." Calling it in the same tick as the map's construction throws
 * out of whatever module is attaching this — which took the whole Deep world
 * down, because nothing after the attach call ever ran. `map/globe.js` already
 * sets its own projection inside a `style.load` handler for exactly this
 * reason and this now matches it.
 *
 * **AND `styledata` IS THE WRONG EVENT, BECAUSE `setProjection` FIRES IT.**
 * MapLibre's own guard against redundant work is
 * `if (this.projection.name === e.type) return` — it compares a NAME STRING to
 * `type`. `type` here is an interpolation expression, i.e. an array, which can
 * never equal a string, so the guard never fires and every call rebuilds the
 * projection. A `styledata` handler that calls `setProjection` therefore
 * re-triggers itself forever. `style.load` fires once per style and is not
 * raised by `setProjection`.
 *
 * @param {object} map a MapLibre `Map`
 * @returns {object} handle with `dispose()`
 */
export function attachPitchRamp(map) {
  let applied = 0;

  function apply() {
    const want = pitchAt(map.getZoom());
    if (Math.abs(want - applied) < 0.1) return;
    applied = want;
    /* `easeTo` calls `stop()` too. That is harmless HERE and only here: the
     * zoom has already ended, so there is no gesture left to abort. */
    map.easeTo({ pitch: want, duration: TILT.settleMs });
  }

  /* A style reload resets the projection to whatever the stylesheet declares,
   * so this re-runs per load rather than once ever. */
  function applyProjection() {
    map.setProjection(flattenProjection());
    apply();
  }

  map.on('zoomend', apply);

  /* Registered synchronously in the same tick as the map's construction, so the
   * first `style.load` cannot already have fired — the same reasoning
   * `proto/shell.js` states for its own handlers. Registered AFTER
   * `createGlobe()`'s handler, so this overrides its `{type: 'globe'}`. */
  map.on('style.load', applyProjection);

  return {
    dispose() {
      map.off('zoom', apply);
      map.off('style.load', applyProjection);
      map.setPitch(0);
    },
  };
}
