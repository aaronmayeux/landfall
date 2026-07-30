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
 * ==> IT WRITES PITCH ON `zoom`, NOT ON `render`. <== A `render` handler fires
 * every frame and `setPitch` invalidates the transform, so writing pitch there
 * is a self-sustaining repaint loop on a phone — the same trap
 * `attachIdleRotation` is already being audited for. `zoom` fires only while
 * the zoom is actually changing, and pitch is a function of zoom alone.
 *
 * ==> AND IT SKIPS WRITES UNDER A THRESHOLD. <== A pinch delivers many small
 * zoom deltas; below a tenth of a degree the pitch change is invisible and the
 * write is pure cost.
 *
 * @param {object} map a MapLibre `Map`
 * @returns {object} handle with `dispose()`
 */
export function attachPitchRamp(map) {
  let applied = -1;

  function apply() {
    const want = pitchAt(map.getZoom());
    if (Math.abs(want - applied) < 0.1) return;
    applied = want;
    map.setPitch(want);
  }

  /* The projection band is a style-level property, so it has to be re-set after
   * any style reload — the same trap `proto/volcano-map.js` guards against for
   * its source and layer. */
  function applyProjection() {
    map.setProjection(flattenProjection());
  }

  map.on('zoom', apply);
  map.on('styledata', applyProjection);

  applyProjection();
  apply();

  return {
    dispose() {
      map.off('zoom', apply);
      map.off('styledata', applyProjection);
      map.setPitch(0);
    },
  };
}
