/**
 * volcano-lava.js — INCANDESCENT FLOWS ON THE MOUNTAINS AT MAP ZOOM.
 *
 * PROTOTYPE CODE. Not wired into the app.
 *
 * ==> A SEPARATE MESH WITH A SEPARATE MATERIAL, AND THAT IS THE POINT OF THE
 * FILE. <== `proto/volcano-3d.js` says in its own header that the mountains
 * have NO shader — light and colour are baked into vertex colours on the CPU
 * so there is nothing to fail to compile on a phone GPU. Lava needs a shader
 * to crawl. Putting one on the terrain material would put every mountain in
 * the app behind a program that might not compile, to animate a feature that
 * appears on about five of them. So lava carries its own program on its own
 * geometry: if it fails, the console says so and the mountains are untouched.
 *
 * The maths is not here. `lib/volcano-flow.js` owns the tracing and the ribbon
 * geometry and has no THREE in it, so the model is asserted headless by
 * `tools/test-volcano-flow.mjs`. This file turns arrays into a mesh and picks
 * the moment to draw it, and that is all it does.
 *
 * ==> IT DRAWS INTO THE TERRAIN'S SCENE, NOT THE SEA'S. <== Lava must be
 * hidden by the far side of its own mountain when the camera tilts, which
 * means depth-testing against terrain that has already been drawn. The sea is
 * rendered in a second pass after a framebuffer copy precisely so it can
 * refract what is under it; lava has no business in that picture and would be
 * refracted by the sea if it were.
 *
 * `THREE` is a CDN global, same as the rest of `proto/`.
 *
 * Imports: config/ and lib/ only.
 */

import { VOLCANO } from '../config/constants.js';
import { traceFlows, buildFlowRibbons } from '../lib/volcano-flow.js';

const L = VOLCANO.map3d.lava;

function rgbOf(hex) {
  const s = String(hex).replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16) / 255,
    parseInt(s.slice(2, 4), 16) / 255,
    parseInt(s.slice(4, 6), 16) / 255,
  ];
}

/* ==> THE RAMP IS RESOLVED ONCE, ON THE CPU, AND HANDED IN AS THREE UNIFORMS.
 * <== Parsing hex in a shader is not a thing, and doing it per build would be
 * three string parses for an answer frozen in the constants file. */
const VENT_RGB = rgbOf(L.vent);
const MID_RGB = rgbOf(L.mid);
const TOE_RGB = rgbOf(L.toe);

const LAVA_VERT = `
  attribute float aT;
  varying float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * ==> TWO THINGS ARE HAPPENING PER FRAGMENT AND ONLY ONE OF THEM MOVES. <==
 * The crust is a fixed temperature ramp along the flow: white-hot at the vent,
 * through orange, to a dull red within a short distance — which is what real
 * lava does, and it is why `midAt` is small. On top of that a few bright bands
 * travel down the flow, which is the crust cracking open rather than the rock
 * itself sliding. Only the bands read the clock.
 *
 * The fade at the very end is not decoration either: a ribbon that stops dead
 * reads as a cut, and the flow has already widened there, so the two together
 * give a toe that spreads and cools instead of being snipped off.
 */
const LAVA_FRAG = `
  precision mediump float;
  uniform vec3 uVent;
  uniform vec3 uMid;
  uniform vec3 uToe;
  uniform float uMidAt;
  uniform float uTime;
  uniform float uBands;
  uniform float uGlow;
  uniform float uFade;
  varying float vT;

  void main() {
    vec3 crust = vT < uMidAt
      ? mix(uVent, uMid, vT / max(uMidAt, 1e-4))
      : mix(uMid, uToe, (vT - uMidAt) / max(1.0 - uMidAt, 1e-4));

    float band = fract(vT * uBands - uTime);
    /* A sharp leading edge and a long tail: a crack opens fast and closes
     * slowly. A symmetric pulse reads as a barber pole. */
    float pulse = pow(1.0 - band, 3.0);
    vec3 lit = mix(crust, uVent, pulse * uGlow);

    /* Opaque along the body, easing off over the last of the toe. */
    float a = smoothstep(1.0, 0.82, vT);
    gl_FragColor = vec4(lit, a * uFade);
  }
`;

/**
 * A lava layer that lives inside another custom layer's render pass.
 *
 * The caller owns the GL context, the camera and the scene; this owns the
 * geometry, the material and the clock.
 *
 * @param {object} scene the TERRAIN scene, so lava depth-tests against mountains
 * @returns {object} handle with `rebuild`, `setFade`, `tick`, `count`, `dispose`
 */
export function createLavaLayer(scene) {
  let material = null;
  const meshes = [];
  let failed = false;

  function ensureMaterial() {
    if (material || failed) return material;
    try {
      material = new THREE.ShaderMaterial({
        vertexShader: LAVA_VERT,
        fragmentShader: LAVA_FRAG,
        uniforms: {
          uVent: { value: new THREE.Vector3().fromArray(VENT_RGB) },
          uMid: { value: new THREE.Vector3().fromArray(MID_RGB) },
          uToe: { value: new THREE.Vector3().fromArray(TOE_RGB) },
          uMidAt: { value: L.midAt },
          uTime: { value: 0 },
          uBands: { value: L.bands },
          uGlow: { value: L.glow },
          uFade: { value: 1 },
        },
        transparent: true,
        /* ==> TESTS AGAINST TERRAIN, WRITES NOTHING. <== Lava must disappear
         * behind the shoulder of its own mountain, so it tests. It must not
         * occlude the flows crossing behind it or the sea beyond, and it is a
         * thin sheet floating a few tens of metres off a surface, so writing
         * depth would make it fight both. */
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    } catch (e) {
      failed = true;
      material = null;
      console.error('volcano-lava: shader would not build — mountains are unaffected, no lava will draw:', e);
    }
    return material;
  }

  function clear() {
    for (const m of meshes) {
      scene.remove(m);
      m.geometry.dispose();
    }
    meshes.length = 0;
  }

  /**
   * Rebuild every flow from the current ridges. Runs on a field change only —
   * never on zoom, never per frame.
   *
   * ==> THE MATRIX IS PASSED IN RATHER THAN READ OFF THE RIDGE. <== The ridge
   * is the output of `lib/volcano-ridge.js`, which knows nothing about
   * MapLibre or Mercator and must not start to. The caller has already placed
   * the mountain; it hands the same matrix here.
   *
   * @param {{ridge: object, matrix: object}[]} entries placed clusters
   */
  function rebuild(entries) {
    clear();
    if (!entries || entries.length === 0) return;
    const mat = ensureMaterial();
    if (!mat) return;

    for (const { ridge: r, matrix } of entries) {
      const flows = traceFlows(r);
      if (flows.length === 0) continue;
      const ribbon = buildFlowRibbons(flows);
      if (!ribbon) continue;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(ribbon.positions, 3));
      geo.setAttribute('aT', new THREE.Float32BufferAttribute(ribbon.ts, 1));
      geo.setIndex(ribbon.indices);

      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      /* ==> AFTER THE TERRAIN, INSIDE THE SAME SCENE. <== Both materials are
       * transparent, and THREE sorts transparent objects back to front by
       * distance — which for a ribbon lying ON a mountain is a coin toss that
       * lands differently as the camera moves. Stated explicitly instead. */
      mesh.renderOrder = 1;
      /* ==> THE MOUNTAIN'S OWN MATRIX, NOT A SECOND ONE BUILT TO MATCH. <==
       * Same metres, same centre, same scale. Anything that placed these
       * separately would eventually let lava slide across its own mountain. */
      mesh.matrix.copy(matrix);
      scene.add(mesh);
      meshes.push(mesh);
    }
  }

  return {
    rebuild,
    /** Zoom fade, shared with the mountains so lava arrives and leaves with
     *  the geometry it sits on rather than floating in on its own schedule. */
    setFade(alpha) {
      if (material) material.uniforms.uFade.value = alpha;
    },
    /** @param {number} seconds wall time since the layer started */
    tick(seconds) {
      if (material) material.uniforms.uTime.value = seconds * L.crawlHz;
    },
    get count() {
      return meshes.length;
    },
    /** ==> "NO LAVA" HAS TWO CAUSES AND THEY MUST NOT LOOK THE SAME. <== The
     *  shader failing to build and nothing erupting lava this week both draw
     *  zero flows. The second is the normal case; the first is a bug that
     *  would otherwise be invisible. SPEC.md §5. */
    get broken() {
      return failed;
    },
    dispose() {
      clear();
      if (material) material.dispose();
      material = null;
    },
  };
}
