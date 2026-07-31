/**
 * volcano-3d.js — REAL MOUNTAINS AT MAP ZOOM. A MapLibre custom layer, drawn
 * with THREE, in MapLibre's own GL context.
 *
 * PROTOTYPE CODE. Not wired into the app.
 *
 * ==> THIS IS THE THIRD AND LAST RUNG OF THE VOLCANO LADDER. <==
 *
 *   Three pips + limb silhouettes   z2.0 → z3.8   proto/volcano-marks.js
 *   MapLibre circles                z2.4 → z7.8   proto/volcano-map.js
 *   Real geometry, this file        z7.0 → up
 *
 * The circle fades out underneath these as they fade in, across
 * `VOLCANO.map3d.handoff`. Aaron's call 2026-07-30: a dot and a mountain for
 * the same volcano at the same time is two marks for one thing.
 *
 * ==> A CORDILLERA IS ONE RIDGE, NOT A ROW OF CONES, AND THAT IS WHY THIS FILE
 * NO LONGER DRAWS ONE MESH PER VOLCANO. <== Arc volcanoes sit 15–25 km apart
 * with 31 km footprints, so they genuinely overlap. One closed shape each gave
 * 126 hard rims crossing one another and read as a smear of stamped coins.
 * Volcanoes whose footprints intersect are now sampled as ONE continuous
 * heightfield with a saddle between the summits — `lib/volcano-ridge.js`, which
 * has no THREE in it and is asserted without a browser.
 *
 * ==> WHAT MAKES THIS WORK WHERE `fill-extrusion` FAILED, IN ONE LINE EACH.
 * <== It failed on glass 2026-07-30 for two reasons (SPEC-GLOBES §42.1.4a).
 * The camera can tilt now (`map/pitch-ramp.js`), so geometry is not seen
 * straight down its own throat. And the footprint is TRUE rather than sized to
 * hit a pixel target, so it cannot blow up at high zoom — Masaya's caldera is
 * about 10 km across here, which is what it is. Neither of those is tuning.
 *
 * ==> THE PROFILE IS NOT REIMPLEMENTED HERE, AND THAT IS THE POINT OF THE
 * FILE SPLIT. <== `volcanoProfile()` in `lib/volcano-shape.js` is the only
 * place the silhouette maths lives. The 3D globe runs a GLSL copy of it in a
 * vertex shader because a shader cannot import; `lib/volcano-ridge.js` inverts
 * the same JavaScript original into a radius-to-height table. One silhouette
 * read two ways, never two silhouettes.
 *
 * ==> THE MOUNTAINS HAVE NO SHADER, AND THE SEA HAS EXACTLY ONE. <== Light,
 * colour and the soft base of a ridge are all baked into vertex colours on the
 * CPU when it is built, so there is nothing to fail to compile on a phone GPU
 * and nothing recomputed per frame. Zoom changes touch one matrix per ridge.
 * The sea's two programs and the reasoning for them are in
 * `proto/water-shader.js`.
 *
 * ==> THE SEA STOPS AT THE SHORE, AND WHAT TELLS IT IS A PHOTOGRAPH OF THE
 * BASEMAP. <== `proto/basemap-mask.js` copies the framebuffer after MapLibre
 * has painted the ocean and before it paints anything else; the water shader
 * samples that copy under each fragment and draws only where the pixel beneath
 * is the ocean's colour. Three earlier attempts rebuilt a coastline out of the
 * vector tile data and all three were reverted — read that file's header before
 * touching this, because the reason they failed is the reason this works.
 *
 * `THREE` and `maplibregl` are CDN globals, same as `world-deep.js`.
 *
 * Imports: config/, lib/, and its own shader and mask modules.
 */

import { VOLCANO } from '../config/constants.js';
import { isEdifice, edificeOpacityAt } from '../lib/volcano-dimensions.js';
import { buildRidges } from '../lib/volcano-ridge.js';
import { WATER_VERT, WATER_FRAG } from './water-shader.js';
import { createBasemapMask } from './basemap-mask.js';

const M3 = VOLCANO.map3d;
const WATER = M3.water;
const WAVE = WATER.wave;

const LAYER_ID = 'volcano-3d';

/** ==> THE VERTEX SHADER IS WRITTEN FOR EXACTLY TWO DISPLACING TRAINS. <== The
 *  uniforms are vec2 and the average divides by two, so raising
 *  `wave.displaceCount` without editing the shader would silently drop the
 *  extra train rather than fail — the shader would keep working and the
 *  constant would be a lie. Say so once, loudly, at load. */
const DISPLACE = 2;
if (WAVE.displaceCount !== DISPLACE) {
  console.warn(
    'volcano-3d: wave.displaceCount is ' + WAVE.displaceCount + ' but the water vertex shader ' +
    'implements ' + DISPLACE + '. The extra trains will not move the surface. ' +
    'Edit WATER_VERT in proto/water-shader.js.'
  );
}

/** The three wave headings as unit vectors in the local east/north frame.
 *  Resolved once at module load — they are frozen constants, and doing the
 *  trigonometry per frame would be three sines and three cosines for an answer
 *  that cannot change. */
const WAVE_DIRS = WAVE.headingsDeg.map((deg) => {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
});

/**
 * Attach the 3D volcano layer to a MapLibre map.
 *
 * @param {object} map a MapLibre `Map`
 * @returns {object} handle with `setField`, `setVisible`, `dispose`
 */
export function createVolcano3dLayer(map) {
  let wanted = true;
  let added = false;
  let styleReady = false;
  let field = null;

  let renderer = null;
  let scene = null;
  let camera = null;
  let material = null;
  let waterMat = null;

  /** ==> THE SHORE MASK IS CREATED HERE BUT LIVES LOWER IN THE STYLE. <== It
   *  adds its own MapLibre layer, below the coastlines and the plate seams, so
   *  the picture it captures is only land and sea. It is handed a GETTER for
   *  the renderer rather than the renderer itself because its layer is added
   *  before this one's and may therefore run first. */
  const shore = createBasemapMask(map, () => renderer);
  /** Paint the mask itself instead of the sea. Off unless the prototype's
   *  debug switch turns it on. */
  let maskDebug = false;
  /** One entry per cluster: `{mesh, water}`. `water` is null unless the cluster
   *  holds at least one submarine volcano. */
  let ridges = [];

  let warnedNoMatrix = false;

  /* ==> THE LAYER REPORTS ON ITSELF, BECAUSE NOTHING ELSE CAN SEE IT. <== This
   * draws inside MapLibre's own GL context, below the zoom where
   * `proto/shell.js`'s frame loop returns early, on a phone with no console in
   * reach. Every distinct way it can fail to draw gets a distinct word, so
   * "I see no volcanoes" resolves to a reading rather than a guess (SPEC.md
   * §5). `off` is not `gl!` is not `z<5` is not `n0`. */
  let renderedOnce = false;
  let glFailed = false;
  let drawnCount = 0;
  let ridgeCount = 0;
  let waterCount = 0;
  /** Is the sea moving, and therefore is this layer asking MapLibre for a frame
   *  every frame? Resolved in `render()` and reported by `status()`, because a
   *  continuous repaint is the most expensive thing this layer can do and it
   *  must never be something you have to read the source to discover. */
  let animating = false;
  /** Wall-clock origin for the wave. Taken once so the swell's speed is in
   *  seconds rather than in frames. */
  const startedAt = performance.now();

  function buildScene() {
    scene = new THREE.Scene();
    camera = new THREE.Camera();

    /* ==> ONE MATERIAL, BECAUSE A MERGED RIDGE CAN HOLD BOTH STATES. <== The
     * old version had a quiet mesh and an erupting mesh per family, which
     * cannot survive a cluster containing one erupting volcano and four quiet
     * ones. Colour AND per-vertex alpha are baked into the geometry instead:
     * white where the ground is owed to something quiet, gold where it is owed
     * to something erupting, fading between along the flank they share.
     *
     * `vertexColors` picks up alpha only when the colour attribute has FOUR
     * components — read out of the r128 bundle, where `vertexAlphas` is set
     * from `geometry.attributes.color.itemSize === 4`. With three it silently
     * ignores the alpha and every mountain draws at full strength, which is
     * exactly the kind of quiet wrongness this feature keeps producing.
     *
     * `opacity` here carries ONLY the zoom handoff fade; everything else is in
     * the vertex alpha and multiplies with it. */
    material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      /* ==> DEPTH IS BACK ON, AND IT TESTS ONLY AGAINST US. <== It was off
       * because "at these zooms they almost never overlap", which the merged
       * ridges have now disproven outright — an arc overlaps constantly.
       * Testing against MAPLIBRE's depth buffer would still be meaningless:
       * its 2D layers write a thin per-layer slice, not geometric depth, so a
       * basemap fill would cut a mountain in half. `render()` clears depth
       * first, so the buffer contains nothing but our own mountains and this
       * test is strictly self-against-self.
       *
       * A heightfield is single-valued, so a ridge cannot overlap ITSELF — the
       * only thing depth resolves here is one ridge in front of another, which
       * is exactly what it is good at and what painter's order got wrong. */
      depthTest: true,
      depthWrite: true,
      side: THREE.FrontSide,
    });

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
    waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        uTime: { value: 0 },
        /* Metres, exaggerated by the same factor the terrain is, so the sea and
         * the mountain under it stay in one vertical space. */
        uAmp: { value: WAVE.amplitudeM * M3.vertical },
        uCrest: { value: WAVE.crestLift },
        /* The crest's own colour and how far a full crest goes toward it.
         * Constant for the life of the material — the sea's palette never
         * changes at runtime, so these are set once here rather than pushed
         * per frame in render() with the things that actually move.
         *
         * `THREE.Color` rather than a fourth hand-rolled hex parser (this repo
         * already has two). On r128 it is a plain divide-by-255 with no colour
         * management, which is exactly the scale `lib/volcano-water.js` bakes
         * the body colour at — so the body and the crest are in one space and
         * the `mix()` in the shader is meaningful. THAT EQUIVALENCE IS AN
         * r128 FACT: the engine jump on the backlog turns THREE.Color into an
         * sRGB→linear conversion, and this line has to be checked then. */
        uCrestRgb: { value: new THREE.Color(WAVE.crestColor) },
        uCrestMix: { value: WAVE.crestMix },
        uSharp: { value: WAVE.crestSharpness },
        /* The sampling warp that stops the three trains reading as a lattice.
         * Packed as one vec2 because the two numbers are meaningless apart —
         * the fold check on `warpAmpM` is a statement about the pair. Read by
         * BOTH shaders: they must sample the same bent grid or the bright
         * pixels stop sitting on the raised ones. */
        uWarp: { value: new THREE.Vector2(WAVE.warpLengthM, WAVE.warpAmpM) },
        /* All three trains for the lighting pass. */
        uLen: { value: new THREE.Vector3().fromArray(WAVE.lengthsM) },
        uSpeed: { value: new THREE.Vector3().fromArray(WAVE.speedMps) },
        uDir0: { value: new THREE.Vector2().fromArray(WAVE_DIRS[0]) },
        uDir1: { value: new THREE.Vector2().fromArray(WAVE_DIRS[1]) },
        uDir2: { value: new THREE.Vector2().fromArray(WAVE_DIRS[2]) },
        /* The displacing subset, longest-first, for the geometry pass. Sliced
         * from the same arrays so the two passes cannot describe two different
         * seas. */
        uLenD: { value: new THREE.Vector2().fromArray(WAVE.lengthsM.slice(0, DISPLACE)) },
        uSpeedD: { value: new THREE.Vector2().fromArray(WAVE.speedMps.slice(0, DISPLACE)) },
        uDirD0: { value: new THREE.Vector2().fromArray(WAVE_DIRS[0]) },
        uDirD1: { value: new THREE.Vector2().fromArray(WAVE_DIRS[1]) },
        uFade: { value: 0 },

        /* ==> THE SHORELINE CUT. <== The mask builds its texture lazily, on the
         * first frame that wants a capture, so `uMask` starts null and is
         * pushed in `render()` along with everything else that can move. THREE
         * binds a default empty texture for a null sampler, and `uMaskReady` is
         * 0 until there is a real photograph, so the sea simply draws uncut
         * until then. */
        uMask: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uMaskReady: { value: 0 },
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

  /** Drop every ridge mesh and its geometry. Called on a new field and on
   *  dispose; geometry is per-cluster and not shared, so nothing survives. */
  function clearRidges() {
    for (const r of ridges) {
      if (scene) scene.remove(r.mesh);
      r.mesh.geometry.dispose();
      if (r.water) {
        if (scene) scene.remove(r.water);
        r.water.geometry.dispose();
      }
    }
    ridges = [];
    drawnCount = 0;
    ridgeCount = 0;
    waterCount = 0;
  }

  /**
   * Build every cluster's mesh. Runs on a field change ONLY, never on zoom.
   *
   * The geometry is in metres relative to each cluster's own centre, so the
   * only thing zoom changes is one uniform scale per ridge — which is
   * `inflate`'s rule holding structurally rather than by discipline.
   */
  /**
   * One sea sheet as a THREE mesh, or null when the cluster has no seamount.
   *
   * Shared by the first build and by every shoreline rebuild so the two cannot
   * drift — a sea created two ways is a sea that eventually gets drawn at two
   * render orders.
   */
  function waterMeshFor(w, matrix) {
    if (!w) return null;
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute('position', new THREE.Float32BufferAttribute(w.positions, 3));
    wgeo.setAttribute('aColor', new THREE.Float32BufferAttribute(w.colors, 4));
    wgeo.setAttribute('aWave', new THREE.Float32BufferAttribute(w.wave, 2));
    wgeo.setIndex(w.indices);
    const mesh = new THREE.Mesh(wgeo, waterMat);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    /* `renderOrder` 1 on every water mesh puts the whole sea after the whole
     * terrain — see the material's own note on why that ordering matters. */
    mesh.renderOrder = 1;
    mesh.matrix.copy(matrix);
    return mesh;
  }

  function build() {
    clearRidges();
    if (!field || !field.marks || !scene) return;

    const drawable = [];
    for (const m of field.marks) {
      if (!isEdifice(m)) continue;
      if (drawable.length >= M3.maxDrawn) break;
      drawable.push(m);
    }

    for (const r of buildRidges(drawable)) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(r.positions, 3));
      /* FOUR components. Three silently drops the soft base — see above. */
      geo.setAttribute('color', new THREE.Float32BufferAttribute(r.colors, 4));
      geo.setIndex(r.indices);

      const mesh = new THREE.Mesh(geo, material);
      /* Placed by hand every time zoom moves; THREE must not recompute it from
       * position/quaternion/scale behind us. */
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      scene.add(mesh);

      /* ==> PLACED ONCE, HERE, AND NEVER TOUCHED AGAIN. <== Since `inflate`
       * was deleted there is no zoom term in the scale at all — one metre is
       * one metre, and MapLibre's own matrix carries the zoom. Mercator
       * coordinates do not move with zoom either. So this matrix is correct
       * for every frame at every zoom, and `render()` has no per-frame work
       * beyond setting the fade opacity. */
      const mc = maplibregl.MercatorCoordinate.fromLngLat({ lng: r.lon, lat: r.lat }, 0);
      const s = mc.meterInMercatorCoordinateUnits();
      mesh.matrix.makeScale(s, s, s);
      mesh.matrix.setPosition(mc.x, mc.y, 0);

      /* The sea over this cluster's seamounts, placed by the SAME matrix — it
       * is the same grid in the same metres, so anything that moved one and not
       * the other would be a bug waiting to happen. */
      const water = waterMeshFor(r.water, mesh.matrix);
      if (water) {
        scene.add(water);
        waterCount++;
      }

      ridges.push({ mesh, water });
      drawnCount += r.members;
    }
    ridgeCount = ridges.length;
  }

  const layer = {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '3d',

    onAdd(_map, gl) {
      /* ==> A FAILURE HERE MUST NOT TAKE THE APP DOWN WITH IT. <== `onAdd` runs
       * inside MapLibre's `addLayer`, so an exception escaping it lands in the
       * middle of a style update. Sharing a GL context between THREE and
       * MapLibre is the least certain thing in this file, and the cost of
       * getting it wrong should be "no mountains, and a line in the console
       * saying so" rather than a dark screen — SPEC.md §5, a failure that
       * looks different from an absence. */
      try {
        renderer = new THREE.WebGLRenderer({
          canvas: _map.getCanvas(),
          context: gl,
          antialias: true,
        });
        /* ==> MUST NOT CLEAR COLOUR. <== MapLibre has already drawn the
         * basemap into this exact buffer. A colour clear here paints over it.
         * Depth is cleared explicitly in `render()` and that is different. */
        renderer.autoClear = false;
        buildScene();
        if (field) build();
      } catch (e) {
        renderer = null;
        glFailed = true;
        console.error('volcano-3d: could not start on MapLibre\u2019s GL context \u2014 no mountains will draw:', e);
      }
    },

    render(gl, args) {
      renderedOnce = true;
      if (!renderer || !wanted) return;
      /* MapLibre 5 passes an options object; older builds passed the matrix
       * itself. Accept either rather than assuming, and say so once if neither
       * arrives — a custom layer that silently draws nothing is exactly the
       * failure SPEC.md §5 is about. */
      /* ==> `fallbackMatrix`, NOT `mainMatrix`, AND THE DIFFERENCE IS A WHOLE
       * COORDINATE SYSTEM. <== While MapLibre is anywhere in its globe→mercator
       * blend, `mainMatrix` is the GLOBE matrix and expects positions on a unit
       * sphere; geometry in mercator units lands nowhere. `fallbackMatrix` is
       * the plain mercator matrix on both transforms — on the mercator one the
       * two are literally the same object, and on the blended one MapLibre sets
       * the fallback from the mercator transform precisely so a caller can
       * reach it. So this is the same matrix wherever it matters and the right
       * one where it does not.
       *
       * `handoff` keeps this layer above `TILT.flatten` anyway, so in practice
       * the blend is finished before anything draws. This is the guard for when
       * one of those two numbers moves and the other does not. */
      const matrix =
        args && args.defaultProjectionData
          ? args.defaultProjectionData.fallbackMatrix || args.defaultProjectionData.mainMatrix
          : args;
      if (!matrix) {
        if (!warnedNoMatrix) {
          warnedNoMatrix = true;
          console.warn('volcano-3d: no projection matrix from MapLibre — layer will not draw');
        }
        return;
      }

      const zoom = map.getZoom();
      const alpha = edificeOpacityAt(zoom);
      if (alpha <= 0) return;
      if (ridges.length === 0) return;

      material.opacity = alpha;
      waterMat.uniforms.uFade.value = alpha;
      camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix);

      /* ==> THE MASK IS ONLY PAID FOR WHILE THERE IS SEA TO CUT. <== It is a
       * full-screen copy; a map with no seamounts in the drawn set must not
       * fund one. Told here rather than at build time because the zoom fade
       * above is what decides whether the sea is on screen at all.
       *
       * It takes effect on the NEXT frame — the mask's layer sits lower in the
       * style and has already run by the time this line executes. That costs
       * one frame of sea drawn uncut when the water first appears, which is
       * invisible, and it is the honest direction to be wrong in: the
       * alternative is one frame with no sea at all. */
      shore.setActive(waterCount > 0);
      waterMat.uniforms.uMask.value = shore.texture;
      waterMat.uniforms.uResolution.value.set(shore.width, shore.height);
      waterMat.uniforms.uMaskReady.value = shore.ready ? 1 : 0;
      waterMat.uniforms.uSeaRgb.value.fromArray(shore.sea);
      waterMat.uniforms.uLandRgb.value.fromArray(shore.land);
      waterMat.uniforms.uDebugMask.value = maskDebug ? 1 : 0;

      /* ==> THE WAVE CLOCK IS WALL TIME, NOT A FRAME COUNTER. <== A counter
       * ties the swell's speed to the frame rate, so the sea would run slow on
       * the phone that is struggling and fast on the one that is not — the
       * device most likely to look wrong being the one it looks wrongest on.
       * Seconds since the layer started, so the float stays small enough for a
       * mediump GPU to keep its precision. */
      animating = WAVE.amplitudeM > 0 && waterCount > 0;
      if (animating) waterMat.uniforms.uTime.value = (performance.now() - startedAt) / 1000;

      /* THREE and MapLibre share one GL context and disagree about almost every
       * piece of its state. `resetState` is what stops THREE inheriting
       * MapLibre's bindings; MapLibre calls its own `setDirty` after we return,
       * which handles the other direction. */
      renderer.resetState();

      /* ==> THE MASK MUST BE SET BEFORE THE CLEAR, AND `clearDepth()` DOES NOT
       * DO IT FOR YOU. <== Read out of the r128 bundle: `clearDepth()` is a
       * bare `gl.clear(DEPTH_BUFFER_BIT)` with no state handling at all, and
       * clearing the depth buffer is a SILENT NO-OP while the depth mask is
       * false. MapLibre leaves it false for its own translucent passes, so
       * clearing without this line would do nothing, our mountains would test
       * against MapLibre's per-layer depth slices, and the failure would look
       * like mountains randomly cut in half rather than like a bug.
       *
       * `resetState()` above nulls THREE's cached mask, so this always issues
       * a real `gl.depthMask` call rather than being swallowed by the cache. */
      renderer.state.buffers.depth.setMask(true);
      renderer.clearDepth();

      renderer.render(scene, camera);

      /* ==> THIS LINE IS THE ENTIRE COST OF MOVING WATER, AND IT IS A FULL MAP
       * REPAINT. <== A custom layer draws only when MapLibre draws, so the only
       * way to animate is to ask for another frame — which redraws the basemap,
       * every tile and every layer, not just this sheet. `proto/shell.js` names
       * moving water as one of the effects that should wait on a measurement of
       * what that costs; Aaron chose to build first and judge on the phone.
       *
       * So it is gated as tightly as it can be, and every clause has already
       * run above: the layer is visible, the zoom fade is non-zero, at least
       * one ridge exists, and at least one water sheet was actually built. A
       * map with no seamounts in the drawn set never asks for a frame. Setting
       * `wave.amplitudeM` to 0 turns the repaint off with the motion, rather
       * than leaving a still sea quietly costing a repaint per frame. */
      if (animating) map.triggerRepaint();
    },
  };

  /**
   * ==> DO NOT GATE THIS ON `map.isStyleLoaded()`. IT IS NOT THE TEST IT LOOKS
   * LIKE, AND USING IT HERE MEANT THE LAYER WAS NEVER ADDED AT ALL. <==
   *
   * `Style.loaded()` returns false unless `_loaded` is set AND there are no
   * pending source updates AND **every source cache has finished fetching its
   * tiles** AND the image manager is loaded. Inside a `style.load` handler none
   * of the last three hold — the sources have only just been created. So the
   * gate rejected the one call that was ever going to succeed, `added` stayed
   * false forever, and the readout said `off`.
   *
   * What `addLayer` actually requires is `_checkLoaded()`, i.e. `_loaded`
   * alone — and `_loaded` is set at the top of the same function that fires
   * `style.load` at the bottom. So the honest gate is "has style.load fired",
   * which is what `styleReady` is. `proto/volcano-map.js` carries the same
   * gate now, for the same reason.
   */
  function add() {
    if (added || !styleReady) return;
    map.addLayer(layer);
    added = true;
  }

  /* A style reload drops every layer, with no warning that it happened.
   * `style.load` rather than `styledata` because the latter also fires on every
   * source data change, and this only ever needs to run once per style. */
  map.on('style.load', () => {
    styleReady = true;
    if (map.getLayer(LAYER_ID)) return;
    added = false;
    add();
  });

  const handle = {
    setField(f) {
      field = f;
      if (!added) add();
      if (scene) build();
      map.triggerRepaint();
    },

    setVisible(on) {
      wanted = !!on;
      /* ==> NOT `setLayoutProperty`. <== A custom layer is built with an empty
       * layout property spec, so driving its visibility through the style is at
       * best an extra API surface to be wrong about. `render()` reads `wanted`
       * directly, which cannot fail and needs no style to be loaded. */
      map.triggerRepaint();
    },

    /**
     * Paint the shore mask itself instead of the sea — cyan where the shader
     * believes there is water, red where it believes there is land, flat over
     * the real map. This is how you tell "the mask is cutting in the wrong
     * place" apart from "the mask is right and something else is wrong", which
     * three shipped attempts could not.
     */
    setMaskDebug(on) {
      maskDebug = !!on;
      map.triggerRepaint();
    },

    /**
     * A one-line state readout for the prototype's stats bar.
     *
     * Deliberately terse and deliberately DIFFERENT per failure. Reading it:
     *   `wait`   `style.load` has not fired yet
     *   `off`    style.load fired but the layer still is not in it
     *   `gl!`    THREE could not start on MapLibre's context
     *   `hidden` the Volcanoes toggle is off
     *   `idle`   added, but MapLibre has never called render() on it
     *   `mtx!`   render() ran but MapLibre handed over no projection matrix
     *   `z<5.4`  below the handoff, so nothing should be drawn yet — correct,
     *            not broken
     *   `nodata` no field handed in
     *   `n0`     a field arrived and produced no ridges at all
     *   `62/9~2* @0.55` sixty-two mountains in nine ridges, two of which have
     *            a sea over them. The second number is what says the clustering
     *            is doing something — equal to the first means nothing merged —
     *            and the third says the water built.
     *   `*`      the sea is MOVING, and this layer is therefore asking MapLibre
     *            for a repaint every frame. The most expensive state this layer
     *            has, so it is the one that gets a mark of its own — a `~2`
     *            with no star is water that built and is not animating, which
     *            is a different thing from no water at all.
     */
    status() {
      if (glFailed) return 'gl!';
      if (!styleReady) return 'wait';
      if (!added) return 'off';
      if (!wanted) return 'hidden';
      if (!renderedOnce) return 'idle';
      if (warnedNoMatrix) return 'mtx!';
      const z = map.getZoom();
      const a = edificeOpacityAt(z);
      if (a <= 0) return 'z<' + M3.handoff[0].toFixed(1);
      if (!field || !field.marks) return 'nodata';
      if (ridgeCount === 0) return 'n0';
      /* The third number is how many of those ridges have a sea over them. A
       * `~0` while seamounts are on screen is the one-word version of "the
       * water never got built" and it is a different failure from `n0`. */
      const moving = animating ? '*' : '';
      /* The shore mask's own word, and only when there is sea for it to cut —
       * see `proto/basemap-mask.js` `status()` for the vocabulary. Its failure
       * is not this layer's failure: the sea still draws, it just draws over
       * the islands, and that has to look different on the readout from a sea
       * that never built. */
      const cut = waterCount > 0 ? ' ' + shore.status() : '';
      return drawnCount + '/' + ridgeCount + '~' + waterCount + moving + cut + ' @' + a.toFixed(2);
    },

    dispose() {
      if (added && map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      added = false;
      clearRidges();
      if (material) material.dispose();
      if (waterMat) waterMat.dispose();
      material = null;
      waterMat = null;
      scene = null;
      field = null;
    },
  };

  add();
  return handle;
}
