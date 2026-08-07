/**
 * tilt.js — THE CAMERA LEAN, AND THE PROJECTION FLATTEN THAT RIDES WITH IT.
 *
 * A verbatim move out of `config/constants.js`. No value changed.
 *
 * Same reason as `config/volcano.js` and `config/plate-line.js`, and this is
 * the last of that family: `constants.js` is imported by nearly every module,
 * there is no build step to shake out an unused import (SPEC.md §2), and this
 * block is read by exactly one file that the shipped app never loads.
 *
 * ==> IT IS NOT DEAD CODE AND MUST NOT BE DELETED. <== `map/pitch-ramp.js` is
 * its only reader, and `proto/shell.js` imports that — so `proto-worlds.html`
 * breaks if either goes. NOW.md carried a note proposing exactly that deletion
 * and it was wrong; this header exists so the next person does not have to
 * rediscover it. `tools/module-graph.mjs` is the check.
 */


/**
 * ==> PITCH WAS DISABLED APP-WIDE AND THE REASON IS STILL TRUE WHERE IT WAS
 * WRITTEN. <== `map/globe.js` sets `touchPitch: false` and
 * `pitchWithRotate: false` — "a tilted sphere is disorienting and buys nothing
 * for storm data." That is about a SPHERE. Below the handoff there is no
 * sphere: the Three globe is cleared and MapLibre is a flat map, where tilt is
 * the ordinary thing maps do. Both gesture handlers stay off; this ramp is
 * programmatic only, so nothing the user can grab has changed.
 *
 * ==> `zStart` HAS A HARD FLOOR AND IT IS MEASURED, NOT CHOSEN. <== The Three
 * globe mirrors MapLibre through `map/globe-follow.js`, which plants its camera
 * on +Z looking at the origin and has no concept of pitch. Tilt anywhere the 3D
 * globe is VISIBLE pulls the two planets apart. Visible ends at dive phase
 * 0.62 — the last of `DIVE.fade.cage` — which is z3.86. Anything below that is
 * a desync bug, so `zStart` sits above it with room to spare.
 *
 * ==> AND THE PROJECTION FLATTENS ON THE SAME BAND, WHICH IS THE OTHER HALF.
 * <== MapLibre's `{type: 'globe'}` is sugar for an interpolation from
 * vertical-perspective to mercator between z11 and z12 — read out of the 5.6
 * bundle, not remembered. Two things want that band moved down here: a custom
 * layer is only guaranteed a plain mercator matrix once the globe transform
 * has finished blending, and a curved basemap under a tilted camera at z8 is a
 * warped map nobody asked for. `flatten` replaces the built-in band.
 */
export const TILT = Object.freeze({
  /** Where the camera starts to lean. Floor is z3.86 (see above) and this is
   *  deliberately not at the floor. */
  zStart: 4.2,

  /** Where it reaches `maxDeg` and stops. Chosen so there is real tilt by the
   *  time `VOLCANO.map3d.handoff` finishes and the circles are gone. */
  zFull: 6.6,

  /** ==> THIS NUMBER IS HALF OF WHETHER A VOLCANO READS AS A MOUNTAIN. <== A
   *  cone's summit clears the ellipse its own base projects to only when
   *  `height / baseRadius > 1 / tan(pitch)`, so a shallower camera demands a
   *  taller mountain and vice versa. At 55° the bar is 0.700; at 60° it is
   *  0.577, which is what lets `VOLCANO.map3d.vertical` stay at 4.0 rather
   *  than climbing into spire territory to compensate.
   *
   *  60 is MapLibre's own default `maxPitch` and this now sits exactly on it,
   *  so there is no headroom left here — the next move is `vertical`, not
   *  this. Asserted in `tools/test-volcano-map3d.mjs`. */
  maxDeg: 60,

  /** ==> FALLBACK ONLY NOW, AND KEPT BECAUSE THE FALLBACK IS A SAFETY NET
   *  RATHER THAN DEAD CODE. <== Pitch follows zoom continuously as of
   *  2026-07-31: `map/pitch-ramp.js` writes `map.transform.setPitch()` directly,
   *  which is what `jumpTo` does minus the `stop()` that was aborting the pinch.
   *  This duration is only used if that private write is ever missing — the ramp
   *  says so in the console and reverts to easing in after `zoomend`, which is
   *  how it behaved until then. */
  settleMs: 420,

  /** Globe → mercator blend band, replacing MapLibre's built-in z11→z12.
   *  Completes before `VOLCANO.map3d.handoff` finishes so the mountains never
   *  draw against a partly-curved transform. */
  flatten: Object.freeze([4.2, 5.4]),
});

