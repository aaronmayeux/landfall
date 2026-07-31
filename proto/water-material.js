/**
 * water-material.js — THE SEA'S `ShaderMaterial`, AND EVERY CONSTANT IT FOLDS.
 *
 * PROTOTYPE CODE. Not wired into the app.
 *
 * ==> THIS FILE EXISTS BECAUSE `proto/volcano-3d.js` CROSSED §12's CEILING. <==
 * The GLSL already lives in `proto/water-shader.js`; what stayed behind was the
 * hundred lines that hand that program its uniforms, which is a second complete
 * description of the sea sitting inside the file that owns the MOUNTAINS. The
 * split is structural — no behaviour moved with it, and the material this
 * returns is byte-for-byte the one that was built inline.
 *
 * **The derived constants moved too, and that is the point.** `WAVE_AMPS`,
 * `WAVE_DIRS`, `WAVE_HALF` and `MICRO_DRIFT` are each one line of trigonometry
 * folded once at module load so it is never paid per frame. They are inputs to
 * this material and to nothing else, so leaving them behind would have left the
 * reasoning for the sea in one file and the sea in another.
 *
 * `WAVE.steepness` does NOT move: `volcano-3d.js` reads it to decide whether
 * the sea is asking MapLibre for a frame, which is a question about the LAYER
 * rather than about the material.
 *
 * `THREE` is a CDN global, same as the rest of `proto/`.
 *
 * Imports: config/ and its own shader and noise modules.
 */

import { VOLCANO } from '../config/constants.js';
import { WATER_VERT, WATER_FRAG } from './water-shader.js';
import { createMicroSlopeTexture } from './water-noise.js';

const WATER = VOLCANO.map3d.water;
const WAVE = WATER.wave;
const LIGHT = VOLCANO.map3d.light;

/**
 * ==> PER-TRAIN AMPLITUDE, DERIVED FROM ONE STEEPNESS AND EACH WAVELENGTH. <==
 * A wave's slope is its amplitude over its wavelength, so a single amplitude
 * shared across wavelengths of 9000, 5200 and 2300 m makes the shortest train
 * four times the steepest — which is what let the finest ripple dominate every
 * normal and render the sea as one corrugation with two faint ones beneath it.
 *
 * `wave.steepness` is the peak slope ONE train contributes, and the amplitude
 * that produces it falls straight out: slope peaks at `A * k`, so `A = s / k`.
 * Derived rather than hand-set three times, which means changing a wavelength
 * can no longer silently change how steep the sea is (§12).
 */
const WAVE_AMPS = WAVE.lengthsM.map((len) => (WAVE.steepness * len) / (2 * Math.PI));

/** The two micro-detail drift velocities as (east, north) metres per second,
 *  resolved once from a speed and a heading each. Same reasoning as
 *  `WAVE_DIRS`: frozen constants, so doing the trigonometry per frame would be
 *  four trig calls for an answer that cannot change. */
const MICRO_DRIFT = WAVE.micro.driftDeg.flatMap((deg, i) => {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r) * WAVE.micro.driftMps[i], Math.cos(r) * WAVE.micro.driftMps[i]];
});

/**
 * ==> THE BLINN-PHONG HALF-VECTOR, FOLDED ONCE, BECAUSE NEITHER HALF OF IT
 * MOVES. <== The sun is fixed (`map3d.light`, the mountains' own) and the eye
 * is treated as straight down, so the glint is a pure function of the surface
 * normal and this vector is a constant for the life of the layer.
 *
 * ==> A VIEW-DEPENDENT VERSION SHIPPED FIRST AND WAS WRONG TWICE. <== It tracked
 * `map.getPitch()` and `map.getBearing()`, which is what a real highlight does,
 * and on a map that meant the entire sea re-patterned every time the globe was
 * spun — Aaron: *"it does this when I rotate around. I don't think it needs to
 * rotate."* It also disagreed with the mountains standing in it, which have
 * never had a view term at all. **Hillshading on a map is lit from a fixed
 * direction regardless of rotation** precisely so relief reads the same
 * whichever way north points; this is that rule, applied to water.
 *
 * The fresnel term went with it rather than being faked: fresnel is by
 * definition an angle to the EYE, and with no eye in the lighting a constant
 * named for it would be a slope ramp wearing a physicist's coat.
 */
const WAVE_HALF = (() => {
  const n = Math.hypot(LIGHT[0], LIGHT[1], LIGHT[2]) || 1;
  const h = [LIGHT[0] / n, LIGHT[1] / n, LIGHT[2] / n + 1];
  const hn = Math.hypot(h[0], h[1], h[2]) || 1;
  return [h[0] / hn, h[1] / hn, h[2] / hn];
})();

/** The three wave headings as unit vectors in the local east/north frame.
 *  Resolved once at module load — they are frozen constants, and doing the
 *  trigonometry per frame would be three sines and three cosines for an answer
 *  that cannot change. */
const WAVE_DIRS = WAVE.headingsDeg.map((deg) => {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
});

/**
 * The sea's material, built once with the scene.
 *
 * ==> BUILT LAZILY RATHER THAN AT MODULE LOAD. <== It touches `THREE` and,
 * through the micro-slope texture, `document`. The headless tests stand this
 * whole layer up against a stub map to prove it survives an unloaded style, and
 * a `new THREE.ShaderMaterial()` at import time would take that away.
 *
 * @returns {object} a THREE `ShaderMaterial`
 */
export function createWaterMaterial() {
  /* ==> THE SEA IS A SECOND MATERIAL AND IT MUST NOT WRITE DEPTH. <== The
   * water sheet lies at z = 0 with a seamount entirely below it, so it has to
   * pass the depth test (it does — it is nearer the camera than the peak it
   * covers) without writing, or it would occlude the next ridge drawn behind
   * it. `renderOrder` 1 on every water mesh puts the whole sea after the whole
   * set of mountains, so THREE's per-object distance sort cannot interleave
   * them and leave one seamount showing through its own ocean.
   *
   * `side: DoubleSide` because a plane seen from a 60° camera is edge-on
   * nowhere but its winding is a coin flip once the map is rotated. */
  /* ==> `aColor`, NOT `color`, AND THE RENAME IS NOT COSMETIC. <== THREE
   * injects its own `color` attribute declaration into a ShaderMaterial when
   * `vertexColors` is set, and it declares it vec3. This sheet's colour is
   * vec4 — the alpha IS the rim fade — so sharing the name is a redeclaration
   * with the wrong arity, which fails at compile time on some drivers and
   * silently drops the alpha on others. The mountains keep the built-in name
   * because they use a stock material that expects it. */
  return new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uFade: { value: 0 },
      /* The sheet's own opacity, a uniform rather than baked into the vertex
       * alpha, because the shader mixes over the refracted scene BY HAND and
       * needs the two numbers apart. `lib/volcano-water.js` says why. */
      uOpacity: { value: WATER.opacity },

      /* ==> THE THREE TRAINS, AND THERE IS NO LONGER A DISPLACING SUBSET.
       * <== A second, shorter list used to live here for the vertex pass.
       * The surface is flat now; all three trains are read once, per pixel,
       * for both the height and the slope. */
      uLen: { value: new THREE.Vector3().fromArray(WAVE.lengthsM) },
      uSpeed: { value: new THREE.Vector3().fromArray(WAVE.speedMps) },
      uDir0: { value: new THREE.Vector2().fromArray(WAVE_DIRS[0]) },
      uDir1: { value: new THREE.Vector2().fromArray(WAVE_DIRS[1]) },
      uDir2: { value: new THREE.Vector2().fromArray(WAVE_DIRS[2]) },
      uAmp: { value: new THREE.Vector3().fromArray(WAVE_AMPS) },
      /* ==> THE FINE DETAIL. <== Built lazily with the rest of the scene, not
       * at module load: this touches `document` and `THREE`, and the headless
       * tests stand this whole layer up with a stub map to prove it survives
       * an unloaded style. Scales are 1/tile-width so the shader multiplies
       * rather than divides per pixel. */
      uMicro: { value: createMicroSlopeTexture() },
      uMicroScale: {
        value: new THREE.Vector2(1 / WAVE.micro.tileM[0], 1 / WAVE.micro.tileM[1]),
      },
      uMicroDrift: { value: new THREE.Vector4().fromArray(MICRO_DRIFT) },
      uMicroAmp: { value: WAVE.micro.strength },
      /* The sampling warp that stops the three trains reading as a lattice.
       * Packed as one vec2 because the two numbers are meaningless apart —
       * the fold check on `warpAmpM` is a statement about the pair. */
      uWarp: { value: new THREE.Vector2(WAVE.warpLengthM, WAVE.warpAmpM) },

      /* ==> THE CREST TINT. <== `THREE.Color` rather than a third hand-rolled
       * hex parser in this repo. On r128 that is a plain divide-by-255 with
       * no colour management, which is exactly the scale
       * `lib/volcano-water.js` bakes the body colour at — so body and crest
       * are in one space and the shader's `mix()` is meaningful. THAT
       * EQUIVALENCE IS AN r128 FACT: the engine jump on the backlog turns
       * THREE.Color into an sRGB→linear conversion, and this line has to be
       * checked then. */
      uCrestRgb: { value: new THREE.Color(WAVE.crestColor) },
      uCrestMix: { value: WAVE.crestMix },
      uCrestSharp: { value: WAVE.crestSharpness },

      /* ==> THE OPTICS, AND NONE OF THEM MOVE. <== The half-vector is folded
       * once from the mountains' own sun and a straight-down eye, so the sea
       * and the rock standing in it are lit identically and neither reacts to
       * the camera. See `WAVE_HALF` for why that is deliberate. */
      uHalf: { value: new THREE.Vector3().fromArray(WAVE_HALF) },
      uSpecular: { value: WAVE.specular },
      uShine: { value: WAVE.shininess },
      uRefractPx: { value: WAVE.refractPx },

      /* ==> TWO PHOTOGRAPHS OF THE FRAMEBUFFER, TAKEN AT DIFFERENT MOMENTS
       * FOR DIFFERENT REASONS. <== `uMask` is the two-colour basemap the
       * shoreline test needs; `uScene` is the full picture including the
       * mountains, which is what refraction bends. The shader will not let
       * them be swapped — one has mountains in it and the other must not.
       * Both start null; THREE binds a default empty texture for a null
       * sampler, and the two READY flags keep the shader on its fallback
       * paths until a real photograph exists. */
      uMask: { value: null },
      uMaskReady: { value: 0 },
      uScene: { value: null },
      uSceneReady: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uSeaRgb: { value: new THREE.Vector3() },
      uLandRgb: { value: new THREE.Vector3() },
      uShoreSoft: { value: WATER.shore.softness },
      uShoreMax: { value: WATER.shore.maxDistance },
      uDebugMask: { value: 0 },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
