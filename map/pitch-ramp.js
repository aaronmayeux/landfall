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

import { TILT } from '../config/tilt.js';

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
 * ==> PITCH IS WRITTEN STRAIGHT INTO THE TRANSFORM, ON EVERY `move`, AND THE
 * REASON THAT IS SAFE IS FOUR FACTS READ OUT OF THE 5.6 BUNDLE. <==
 *
 * The problem this replaces was real. `Map.setPitch` is `jumpTo({pitch})` and
 * `jumpTo`'s first statement is `this.stop()`, which aborts whatever camera
 * motion is in progress — during a pinch, that motion IS the pinch. The first
 * version wrote pitch on every `zoom` event and cancelled the gesture on every
 * frame of it: reported on glass as having to lift both fingers and re-pinch
 * over and over to crawl through the tilt band. The second version dodged it by
 * writing once on `zoomend`, which worked and cost the thing tilt is for — the
 * lean arrived after the movement instead of during it, on its own 420 ms
 * clock, while every other fade in the dive tracks zoom instantly. That is
 * Aaron's report that some things tilt back out of step with each other.
 *
 * What makes the continuous version possible is that `stop()` is the ONLY
 * problem, and it belongs to the camera API rather than to writing pitch:
 *
 * 1. `Transform.setPitch(deg)` clamps to min/max, stores the radians and calls
 *    `_calcMatrices()`. No `stop()`, no events, nothing to abort.
 * 2. Strip `stop()` and the event firing out of `jumpTo` and that call is
 *    literally all that is left of it.
 * 3. `Map._getTransformForUpdate()` returns a CLONE only when terrain or a
 *    `transformCameraUpdate` hook is present. This app has neither, so it
 *    returns the live transform and so does `map.transform`.
 * 4. The gesture handlers apply DELTAS to that same live transform every frame
 *    — `panDelta`, `zoomDelta`, `pitchDelta` — never an absolute pitch. So a
 *    pitch written between two frames is added to, not overwritten.
 *
 * `flyTo` is the one other writer and it does not fight either: it sets
 * `_pitching` from `'pitch' in options`, and storm selection does not pass one,
 * so a flight drives zoom while this drives pitch on the same transform.
 *
 * ==> IT IS A PRIVATE FIELD AND THAT IS SAID OUT LOUD. <== `map.transform` is
 * not public API. The bundle is vendored and pinned, so it cannot move under
 * us, but an engine upgrade is the moment to re-read all four facts. If the
 * write is not there at all the ramp says so once and falls back to the
 * `zoomend` path rather than silently never tilting — a layer that draws
 * pancakes forever with no signal is exactly SPEC.md §5's failure.
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

  /** Is the direct write available? Resolved once, per map. */
  const tf = map.transform;
  const direct = !!(tf && typeof tf.setPitch === 'function');
  if (!direct) {
    console.warn(
      'pitch-ramp: MapLibre’s transform has no setPitch — tilt will arrive after ' +
        'each zoom instead of during it. Check the vendored bundle.'
    );
  }

  function apply() {
    const want = pitchAt(map.getZoom());
    /* Small enough that the lean is continuous to the eye, large enough that a
     * frame which did not really change zoom does not recompute four matrices
     * for a hundredth of a degree. */
    if (Math.abs(want - applied) < 0.05) return;
    applied = want;
    if (direct) {
      map.transform.setPitch(want);
      /* The transform is live, so the frame MapLibre is already about to draw
       * will read this. The nudge is for the case where nothing else has asked
       * for one — the tail of an eased move, or a programmatic setZoom. */
      map.triggerRepaint();
      return;
    }
    /* FALLBACK ONLY. `easeTo` calls `stop()`, so this is safe only after the
     * zoom has ended and there is no gesture left to abort. */
    map.easeTo({ pitch: want, duration: TILT.settleMs });
  }

  /* A style reload resets the projection to whatever the stylesheet declares,
   * so this re-runs per load rather than once ever. */
  function applyProjection() {
    map.setProjection(flattenProjection());
    apply();
  }

  /* ==> `move`, NOT `zoom`. <== `move` covers pan, pinch, wheel, keyboard and
   * every frame of an eased or flown camera, which is the whole set of ways
   * zoom can change. `zoom` would miss the tail of an inertial pan that crosses
   * the band. The fallback path listens on `zoomend` instead, because it CANNOT
   * be driven continuously without killing the gesture. */
  const ev = direct ? 'move' : 'zoomend';
  map.on(ev, apply);

  /* Registered synchronously in the same tick as the map's construction, so the
   * first `style.load` cannot already have fired — the same reasoning
   * `proto/shell.js` states for its own handlers. Registered AFTER
   * `createGlobe()`'s handler, so this overrides its `{type: 'globe'}`. */
  map.on('style.load', applyProjection);

  return {
    dispose() {
      map.off(ev, apply);
      map.off('style.load', applyProjection);
      map.setPitch(0);
    },
  };
}
