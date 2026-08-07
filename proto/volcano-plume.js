/**
 * volcano-plume.js — ASH COLUMNS OVER THE ERUPTING MOUNTAINS AT MAP ZOOM.
 *
 * PROTOTYPE CODE. Not wired into the app.
 *
 * ==> A SEPARATE MESH WITH A SEPARATE MATERIAL, FOR THE REASON LAVA IS. <==
 * `proto/volcano-3d.js` says in its own header that the mountains have NO
 * shader — light and colour are baked into vertex colours on the CPU so there
 * is nothing to fail to compile on a phone GPU. A billboard has to be turned
 * to face the viewer, which is a vertex program by definition. So this feature
 * carries its own: if it fails, the console says so, `status()` says so, and
 * every mountain in the app is untouched.
 *
 * The maths is not here. `lib/volcano-plume.js` owns both the height
 * arithmetic and the stack layout, has no THREE in it, and is asserted headless
 * by `tools/test-volcano-plume.mjs`. This file turns arrays into a mesh, sets
 * two uniforms, and does nothing else.
 *
 * ==> ONE UNIFORM DOES ALL THE BILLBOARDING, AND IT IS A BEARING RATHER THAN A
 * CAMERA. <== The usual screen-facing billboard needs the camera's position,
 * which in this layer is genuinely awkward to get: THREE's camera here is an
 * identity camera carrying MapLibre's whole matrix as its projection, so
 * "view space" is mercator space and the standard trick does not apply. It is
 * also the WRONG effect. A column of smoke must never roll when the map is
 * pitched; it may only spin about its own vertical axis. That is a cylindrical
 * billboard, it needs nothing but the map's bearing, and the bearing is one
 * number MapLibre hands over for free.
 *
 * ==> IT DRAWS INTO THE TERRAIN'S SCENE, NOT THE SEA'S. <== A column has to be
 * hidden by the far side of its own mountain when the camera tilts, which means
 * depth-testing against terrain already drawn. The sea is a second pass over a
 * framebuffer copy so it can refract what lies under it; smoke has no business
 * in that picture and would be refracted by the ocean if it were.
 *
 * `THREE` is a CDN global, same as the rest of `proto/`.
 *
 * Imports: config/ and lib/ only.
 */

import { VOLCANO } from '../config/volcano.js';
import { buildPlumeColumns } from '../lib/volcano-plume.js';

const P = VOLCANO.map3d.plume;

function rgbOf(hex) {
  const s = String(hex).replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16) / 255,
    parseInt(s.slice(2, 4), 16) / 255,
    parseInt(s.slice(4, 6), 16) / 255,
  ];
}

/* Resolved once on the CPU and handed in as uniforms — parsing hex in a shader
 * is not a thing, and doing it per build would be two string parses for an
 * answer frozen in the constants file. */
const BASE_RGB = rgbOf(P.base);
const TOP_RGB = rgbOf(P.top);

/**
 * ==> THE WHOLE BILLBOARD IS THESE SIX LINES, AND THE CROSS PRODUCT IS THE
 * TRICK. <== `uFace` points horizontally from the volcano toward the viewer.
 * The quad's sideways axis is that vector turned ninety degrees in the
 * horizontal plane, so the quad always presents its full width to the camera
 * while staying perfectly upright. Its vertical axis is the world's own up,
 * never the camera's — which is exactly the difference between a column of
 * smoke and a sticker that tips over when the map is pitched.
 *
 * The boil is a sideways sway on the same axis, so it costs one sine and no
 * extra geometry. It rides `aRise` so the top of the column wanders more than
 * the vent does, which is both what a real plume does and what stops the whole
 * stack sliding as one rigid object.
 */
const PLUME_VERT = `
  uniform vec2 uFace;
  uniform float uTime;
  uniform float uBoilAmp;
  attribute vec2 aOff;
  attribute vec2 aHalf;
  attribute float aRise;
  attribute float aAlpha;
  attribute float aSeed;
  varying vec2 vOff;
  varying float vRise;
  varying float vAlpha;
  void main() {
    vOff = aOff;
    vRise = aRise;
    vAlpha = aAlpha;

    vec2 right = vec2(-uFace.y, uFace.x);
    float sway = sin(uTime + aSeed) * uBoilAmp * aHalf.x * aRise;

    vec3 p = position;
    p.xy += right * (aOff.x * aHalf.x + sway);
    p.z += aOff.y * aHalf.y;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

/**
 * ==> EVERY HONESTY RULE IS ALREADY IN `aAlpha` AND NONE OF THEM IS IN HERE.
 * <== Whether this column has a published height, and therefore whether it
 * tapers away at the top or stops dead, is decided in `lib/volcano-plume.js`
 * and baked into a vertex attribute. The fragment shader knows nothing about
 * advisories. That is deliberate: a rule that lives in GLSL cannot be asserted
 * by a test, and this layer's rules are the part that must not drift.
 *
 * The only thing computed per pixel is the soft edge — a radial falloff inside
 * each quad, which is what turns a stack of squares into a column of smoke.
 * Squared rather than linear because a linear falloff leaves a visible disc
 * edge where two quads overlap.
 */
const PLUME_FRAG = `
  precision mediump float;
  uniform vec3 uBase;
  uniform vec3 uTop;
  uniform float uFade;
  varying vec2 vOff;
  varying float vRise;
  varying float vAlpha;
  void main() {
    float r2 = dot(vOff, vOff);
    if (r2 > 1.0) discard;
    float soft = 1.0 - r2;
    soft *= soft;

    vec3 rgb = mix(uBase, uTop, vRise);
    gl_FragColor = vec4(rgb, vAlpha * soft * uFade);
  }
`;

/**
 * Create the plume layer inside an existing THREE scene.
 *
 * @param {object} scene the TERRAIN scene, so columns depth-test against rock
 * @returns {object} handle with `rebuild`, `setFade`, `setBearing`, `tick`,
 *   `count`, `broken`, `dispose`
 */
export function createPlumeLayer(scene) {
  let material = null;
  let failed = false;
  let meshes = [];
  let columns = 0;

  function ensureMaterial() {
    if (material || failed) return material;
    try {
      material = new THREE.ShaderMaterial({
        vertexShader: PLUME_VERT,
        fragmentShader: PLUME_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uFade: { value: 0 },
          uBoilAmp: { value: P.boilAmp },
          /* Straight up-screen until the first frame sets it from the real
           * bearing. A wrong facing for one frame is invisible; a null uniform
           * is a black screen. */
          uFace: { value: new THREE.Vector2(0, -1) },
          uBase: { value: new THREE.Vector3().fromArray(BASE_RGB) },
          uTop: { value: new THREE.Vector3().fromArray(TOP_RGB) },
        },
        transparent: true,
        /* ==> TESTS AGAINST THE MOUNTAINS, WRITES NOTHING. <== A column must be
         * hidden by a ridge in front of it, so it tests. It must NOT write,
         * because twelve overlapping transparent quads writing depth would
         * each occlude the ones behind them and the column would render as a
         * stack of hard-edged discs — which is what this feature looks like
         * when it goes wrong. */
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    } catch (e) {
      failed = true;
      material = null;
      console.error('volcano-plume: shader would not build — no ash columns will draw:', e);
    }
    return material;
  }

  function clear() {
    for (const m of meshes) {
      scene.remove(m);
      m.geometry.dispose();
    }
    meshes = [];
    columns = 0;
  }

  /**
   * Rebuild every column from the current ridges. Runs on a field change only
   * — never on zoom, never per frame.
   *
   * ==> THE MATRIX IS PASSED IN RATHER THAN READ OFF THE RIDGE. <== The ridge
   * comes from `lib/volcano-ridge.js`, which knows nothing about MapLibre or
   * Mercator and must not start to. The caller has already placed the
   * mountain; it hands the same matrix here, so a column can never drift off
   * the summit it belongs to.
   *
   * @param {{ridge: object, matrix: object}[]} entries placed clusters
   */
  function rebuild(entries) {
    clear();
    if (!entries || entries.length === 0) return;
    const mat = ensureMaterial();
    if (!mat) return;

    for (const { ridge: r, matrix } of entries) {
      const col = buildPlumeColumns(r);
      if (!col) continue;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(col.positions, 3));
      geo.setAttribute('aOff', new THREE.Float32BufferAttribute(col.offs, 2));
      geo.setAttribute('aHalf', new THREE.Float32BufferAttribute(col.halfs, 2));
      geo.setAttribute('aRise', new THREE.Float32BufferAttribute(col.rises, 1));
      geo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(col.alphas, 1));
      geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(col.seeds, 1));
      geo.setIndex(col.indices);

      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      /* ==> AFTER THE TERRAIN AND AFTER THE LAVA. <== Both of those are
       * transparent too, and THREE sorts transparent objects by distance —
       * which for a column standing ON a mountain is a coin toss that lands
       * differently as the camera moves. Stated rather than inferred. Lava is
       * 1; smoke rises above everything, so it is 2. */
      mesh.renderOrder = 2;
      mesh.matrix.copy(matrix);
      scene.add(mesh);
      meshes.push(mesh);
      columns += col.columns;
    }
  }

  return {
    rebuild,
    /** Zoom fade, shared with the mountains so a column arrives and leaves with
     *  the geometry it stands on rather than floating in on its own schedule. */
    setFade(alpha) {
      if (material) material.uniforms.uFade.value = alpha;
    },
    /**
     * Turn every column to face the viewer.
     *
     * ==> BEARING IS THE COMPASS DIRECTION THAT IS UP-SCREEN, SO THE CAMERA IS
     * IN THE OPPOSITE ONE. <== At bearing 0 north is up, which puts the camera
     * to the SOUTH of whatever it is looking at. A compass bearing θ is the
     * unit vector `(sin θ, cos θ)` in the local east/north frame, so the
     * direction from the volcano toward the viewer is that vector negated.
     * Getting this backwards is invisible on a symmetrical column and shows up
     * the instant the boil sways the wrong way, so it is written out.
     *
     * @param {number} deg the map's bearing in degrees
     */
    setBearing(deg) {
      if (!material) return;
      const r = (deg * Math.PI) / 180;
      material.uniforms.uFace.value.set(-Math.sin(r), -Math.cos(r));
    },
    /** @param {number} seconds wall time since the layer started */
    tick(seconds) {
      if (material) material.uniforms.uTime.value = seconds * P.boilHz * Math.PI * 2;
    },
    /** How many volcanoes are drawing a column, not how many meshes exist —
     *  one cluster can hold several erupting volcanoes. */
    get count() {
      return columns;
    },
    /** ==> "NO COLUMNS" HAS TWO CAUSES AND THEY MUST NOT LOOK THE SAME. <== A
     *  shader that would not build and a week with no ash advisories anywhere
     *  both draw nothing at all. The second is an ordinary week; the first is
     *  a bug that would otherwise be completely invisible. SPEC.md §5. */
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
