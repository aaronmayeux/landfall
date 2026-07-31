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
  attribute float aU;
  varying float vT;
  varying float vU;
  void main() {
    vT = aT;
    vU = aU;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * ==> THE FIRST SHADER DREW STRIPES ACROSS THE FLOW AND IT WAS A BARBER POLE.
 * <== Aaron on glass: *"the bands of color are perpendicular to the flow. The
 * bands should be parallel to the flow and trace the path."* He is right and
 * the cause was structural rather than a bad constant — the geometry emitted
 * only `aT`, distance ALONG the flow, so the one thing the shader could vary
 * brightness on was distance, and varying on distance necessarily draws bands
 * at right angles to travel. `aU` (across the flow) is what makes lengthwise
 * structure possible at all.
 *
 * ==> AND LENGTHWISE IS WHAT LAVA ACTUALLY LOOKS LIKE. <== An active flow is a
 * channel: dark chilled levees along both edges, a bright incandescent stream
 * down the middle, and cracks in the crust that run WITH the direction of
 * travel because that is the direction the crust is being pulled apart. Three
 * terms below, in that order.
 *
 * Motion is still along the flow — the streaks travel downhill — but they are
 * now streaks rather than rungs, so the movement reads as flowing rather than
 * as a conveyor belt.
 */
const LAVA_FRAG = `
  precision mediump float;
  uniform vec3 uVent;
  uniform vec3 uMid;
  uniform vec3 uToe;
  uniform float uMidAt;
  uniform float uTime;
  uniform float uStreaks;
  uniform float uGlow;
  uniform float uLevee;
  uniform float uFade;
  varying float vT;
  varying float vU;

  void main() {
    /* Temperature along the flow: white-hot at the vent, dull red crust by the
     * toe. Unchanged and it was never the problem. */
    vec3 crust = vT < uMidAt
      ? mix(uVent, uMid, vT / max(uMidAt, 1e-4))
      : mix(uMid, uToe, (vT - uMidAt) / max(1.0 - uMidAt, 1e-4));

    float edge = abs(vU);

    /* 1. LEVEES. The edges of a flow chill against cold ground and go dark
     *    first, which is also what stops the ribbon reading as a flat panel:
     *    a panel has uniform brightness right up to a hard border. */
    float levee = mix(1.0, 1.0 - uLevee, smoothstep(0.45, 1.0, edge));

    /* 2. THE CHANNEL. Brightest down the centre line where the stream is still
     *    moving and has not skinned over. */
    float channel = 1.0 - smoothstep(0.0, 0.7, edge);

    /* 3. LENGTHWISE CRACKS, travelling downhill. Varying on vU puts them
     *    PARALLEL to travel; scrolling on vT is what moves them. The two used
     *    to be the same axis, which is the whole bug. */
    float crack = fract(vU * uStreaks + sin(vT * 3.0) * 0.5 - uTime);
    float hot = pow(1.0 - abs(crack * 2.0 - 1.0), 3.0);

    vec3 lit = crust * levee;
    lit = mix(lit, uVent, clamp(channel * uGlow + hot * uGlow * 0.6, 0.0, 1.0));

    /* Soften both ends so the geometry taper is not the only thing ending the
     * flow — a hard alpha edge on a tapered tip still reads as cut. */
    float a = smoothstep(0.0, 0.06, vT) * smoothstep(1.0, 0.86, vT);
    /* And feather the long edges, so the silhouette is not a drawn outline. */
    a *= 1.0 - smoothstep(0.82, 1.0, edge);
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
          uStreaks: { value: L.streaks },
          uGlow: { value: L.glow },
          uLevee: { value: L.levee },
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
      geo.setAttribute('aU', new THREE.Float32BufferAttribute(ribbon.us, 1));
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
