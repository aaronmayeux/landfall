/**
 * volcano-3d.js — REAL MOUNTAINS AT MAP ZOOM. A MapLibre custom layer, drawn
 * with THREE, in MapLibre's own GL context.
 *
 * PROTOTYPE CODE. Not wired into the app.
 *
 * ==> THIS IS THE THIRD AND LAST RUNG OF THE VOLCANO LADDER. <==
 *
 *   Three pips + limb silhouettes   z2.0 → z3.8   proto/volcano-marks.js
 *   MapLibre circles                z2.4 → z6.2   proto/volcano-map.js
 *   Real geometry, this file        z5.0 → up
 *
 * The circle fades out underneath these as they fade in, across
 * `VOLCANO.map3d.handoff`. Aaron's call 2026-07-30: a dot and a mountain for
 * the same volcano at the same time is two marks for one thing.
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
 * vertex shader because a shader cannot import; this layer runs the JavaScript
 * original on the CPU, once, at startup. So a caldera notches identically in
 * both renderers with no second opinion to keep in sync.
 *
 * ==> NO SHADER IS WRITTEN HERE AT ALL, AND THAT IS DELIBERATE. <== The
 * tempting version bends one geometry per instance in a vertex shader, the way
 * `proto/volcano-marks.js` does, which is right on the globe where 1,196
 * volcanoes are on screen at once. Down here a viewport holds a handful, so
 * five plain lathed geometries and ten instanced draws cost nothing and there
 * is no second copy of the profile maths to drift.
 *
 * ==> LIGHT IS BAKED INTO THE VERTEX COLOURS ONCE. <== Every mountain here is
 * axis-aligned and lit by the same fixed sun, so per-frame lighting would
 * compute the same answer for every instance forever. The unit geometries
 * carry their own shading as vertex colour and the material needs no lights,
 * which also means no shader compilation surprises on a phone GPU.
 *
 * `THREE` and `maplibregl` are CDN globals, same as `world-deep.js`.
 *
 * Imports: config/ and lib/ only.
 */

import { VOLCANO } from '../config/constants.js';
import { EDIFICE_FAMILIES, volcanoProfile } from '../lib/volcano-shape.js';
import {
  isEdifice,
  volcanoDimensions,
  inflationAt,
  edificeOpacityAt,
} from '../lib/volcano-dimensions.js';

const M3 = VOLCANO.map3d;
const SHAPES = VOLCANO.shapes.families;

const LAYER_ID = 'volcano-3d';

/* ---------------------------------------------------------------- geometry */

/**
 * One family's unit mountain: base radius 1 at the origin, summit height 1,
 * lathed around the Z axis.
 *
 * ==> Z IS UP HERE, NOT Y. <== A MapLibre custom layer works in mercator
 * coordinates with altitude on Z, so building around Y and rotating later is
 * one more transform to get wrong. THREE's own `LatheGeometry` lathes around Y
 * and is therefore not used.
 *
 * `elongate` and `narrow` stretch the fissure into a ridge. They are applied
 * here rather than per instance because they belong to the SHAPE — every
 * fissure is the same shape, only the size differs.
 *
 * @param {object} spec one entry of `VOLCANO.shapes.families`
 * @returns {object} a THREE.BufferGeometry with baked vertex colours
 */
function buildUnitGeometry(spec) {
  const radial = M3.radialSegments;
  const steps = M3.profileSegments;

  const pos = [];
  const col = [];
  const idx = [];

  const light = M3.light;
  const lightLen = Math.hypot(light[0], light[1], light[2]) || 1;
  const lx = light[0] / lightLen;
  const ly = light[1] / lightLen;
  const lz = light[2] / lightLen;

  /* Rings from base to summit. `volcanoProfile` is the ONLY source of r and h;
   * nothing below reinterprets it. */
  const rings = [];
  for (let i = 0; i <= steps; i++) {
    const v = i / steps;
    rings.push(volcanoProfile(v, spec));
  }

  for (let i = 0; i <= steps; i++) {
    const ring = rings[i];
    /* The surface normal in the profile plane, from the slope between this ring
     * and its neighbour. At the ends we borrow the adjacent segment rather than
     * differencing against a point that is not there. */
    const a = rings[Math.max(0, i - 1)];
    const b = rings[Math.min(steps, i + 1)];
    const dr = b.r - a.r;
    const dh = b.h - a.h;
    /* Outward normal of a surface of revolution: (dh, -dr) in the (radial, up)
     * plane, normalised. A flank that rises steeply has a mostly-sideways
     * normal, which is what makes the lit side read. */
    const nl = Math.hypot(dr, dh) || 1;
    const nRad = dh / nl;
    const nUp = -dr / nl;

    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const cx = Math.cos(th);
      const cy = Math.sin(th);

      pos.push(ring.r * cx * spec.elongate, ring.r * cy * spec.narrow, ring.h);

      /* Fixed-light shading, baked. Ambient keeps the shadowed flank from
       * reading as a hole punched in the map — the same failure
       * `VOLCANO.shapes.ambient` guards against on the globe. */
      const nx = nRad * cx;
      const ny = nRad * cy;
      const d = nx * lx + ny * ly + nUp * lz;
      const shade = M3.ambient + (1 - M3.ambient) * Math.max(0, d);
      col.push(shade, shade, shade);
    }
  }

  const stride = radial + 1;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * stride + j;
      const b = a + stride;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

/* ------------------------------------------------------------------- layer */

/**
 * Attach the 3D volcano layer to a MapLibre map.
 *
 * @param {object} map a MapLibre `Map`
 * @returns {object} handle with `setField`, `setVisible`, `dispose`
 */
export function createVolcano3dLayer(map) {
  let wanted = true;
  let added = false;
  let field = null;

  let renderer = null;
  let scene = null;
  let camera = null;
  /** family -> { quiet: InstancedMesh, live: InstancedMesh } */
  let buckets = null;
  let geometries = null;
  let matQuiet = null;
  let matLive = null;

  /** Zoom the instance matrices were last computed for. Inflation is a function
   *  of zoom, so they go stale the moment it changes. */
  let builtForZoom = -1;
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

  const dummy = { matrix: null };

  function buildScene() {
    scene = new THREE.Scene();
    camera = new THREE.Camera();

    matQuiet = new THREE.MeshBasicMaterial({
      color: new THREE.Color(M3.color),
      vertexColors: true,
      transparent: true,
      opacity: 0,
      /* ==> NO DEPTH, IN EITHER DIRECTION. <== Writing depth would let this
       * layer occlude MapLibre content drawn after it; testing against
       * MapLibre's depth buffer would let a basemap fill cut a mountain in
       * half. Painter's order inside our own scene is enough because these are
       * translucent and, at these zooms, almost never overlap. `FrontSide` is
       * what stops a volcano showing its own inside through itself. */
      depthTest: false,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    matLive = matQuiet.clone();
    matLive.color = new THREE.Color(M3.eruptingColor);

    geometries = {};
    buckets = {};
    for (const fam of EDIFICE_FAMILIES) {
      const spec = SHAPES[fam];
      if (!spec) continue;
      geometries[fam] = buildUnitGeometry(spec);
      buckets[fam] = { quiet: null, live: null };
    }

    dummy.matrix = new THREE.Matrix4();
  }

  /** Grow a bucket's mesh to hold `n` instances, reusing it when it already
   *  can. Capacity doubles rather than tracking the exact count, so a field
   *  that grows by one does not reallocate ten buffers. */
  function ensureMesh(fam, state, n) {
    const b = buckets[fam];
    const existing = b[state];
    if (existing && existing.instanceMatrix.count >= n) return existing;
    if (existing) {
      scene.remove(existing);
      existing.dispose();
    }
    const cap = Math.max(8, 1 << Math.ceil(Math.log2(Math.max(1, n))));
    const mesh = new THREE.InstancedMesh(
      geometries[fam],
      state === 'live' ? matLive : matQuiet,
      cap
    );
    mesh.frustumCulled = false;
    scene.add(mesh);
    b[state] = mesh;
    return mesh;
  }

  /**
   * Recompute every instance matrix for the current zoom.
   *
   * ==> THE SPACE THIS MATRIX LIVES IN IS ANISOTROPIC AND THAT IS THE WHOLE
   * TRICK. <== MapLibre hands a custom layer a matrix that expects X and Y in
   * mercator units (0..1 across the world) and Z in METRES. So a volcano's
   * width has to be converted through `meterInMercatorCoordinateUnits()` — a
   * number that depends on latitude — while its height passes straight through.
   * Scaling all three axes by the same figure would squash every volcano
   * flatter the further it sits from the equator.
   */
  function rebuild(zoom) {
    if (!field || !field.marks) return;

    const inflate = inflationAt(zoom);
    const counts = {};
    for (const fam of EDIFICE_FAMILIES) counts[fam] = { quiet: 0, live: 0 };

    /* Count first so each mesh is sized once. */
    const drawn = [];
    for (const m of field.marks) {
      if (!isEdifice(m)) continue;
      if (!counts[m.family]) continue;
      if (drawn.length >= M3.maxInstances) break;
      drawn.push(m);
      counts[m.family][m.erupting ? 'live' : 'quiet']++;
    }

    for (const fam of EDIFICE_FAMILIES) {
      if (!buckets[fam]) continue;
      for (const state of ['quiet', 'live']) {
        const n = counts[fam][state];
        if (n === 0) {
          if (buckets[fam][state]) buckets[fam][state].count = 0;
          continue;
        }
        ensureMesh(fam, state, n).count = n;
      }
    }

    const cursor = {};
    for (const fam of EDIFICE_FAMILIES) cursor[fam] = { quiet: 0, live: 0 };

    for (const m of drawn) {
      const state = m.erupting ? 'live' : 'quiet';
      const mesh = buckets[m.family] && buckets[m.family][state];
      if (!mesh) continue;

      const mc = maplibregl.MercatorCoordinate.fromLngLat({ lng: m.lon, lat: m.lat }, 0);
      const mpu = mc.meterInMercatorCoordinateUnits();
      const { relief, radius } = volcanoDimensions(m);

      const wide = radius * inflate * mpu;
      const tall = relief * inflate * M3.vertical;

      dummy.matrix.makeScale(wide, wide, tall);
      dummy.matrix.setPosition(mc.x, mc.y, 0);
      mesh.setMatrixAt(cursor[m.family][state]++, dummy.matrix);
    }

    for (const fam of EDIFICE_FAMILIES) {
      if (!buckets[fam]) continue;
      for (const state of ['quiet', 'live']) {
        const mesh = buckets[fam][state];
        if (mesh) mesh.instanceMatrix.needsUpdate = true;
      }
    }

    builtForZoom = zoom;
    drawnCount = drawn.length;
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
        /* ==> MUST NOT CLEAR. <== MapLibre has already drawn the basemap into
         * this exact buffer. A clear here paints over it. */
        renderer.autoClear = false;
        buildScene();
        if (field) rebuild(_map.getZoom());
      } catch (e) {
        renderer = null;
        glFailed = true;
        console.error('volcano-3d: could not start on MapLibre\u2019s GL context \u2014 no mountains will draw:', e);
      }
    },

    render(gl, args) {
      renderedOnce = true;
      if (!renderer) return;
      /* MapLibre 5 passes an options object; older builds passed the matrix
       * itself. Accept either rather than assuming, and say so once if neither
       * arrives — a custom layer that silently draws nothing is exactly the
       * failure SPEC.md §5 is about. */
      const matrix =
        args && args.defaultProjectionData
          ? args.defaultProjectionData.mainMatrix
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

      if (zoom !== builtForZoom) rebuild(zoom);

      matQuiet.opacity = M3.opacity * alpha;
      matLive.opacity = M3.eruptingOpacity * alpha;

      camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix);

      /* THREE and MapLibre share one GL context and disagree about almost every
       * piece of its state. `resetState` is what stops THREE inheriting
       * MapLibre's bindings; MapLibre calls its own `setDirty` after we return,
       * which handles the other direction. */
      renderer.resetState();
      renderer.render(scene, camera);
    },
  };

  function add() {
    if (added || !map.isStyleLoaded()) return;
    map.addLayer(layer);
    added = true;
    applyVisible();
  }

  function applyVisible() {
    if (!added) return;
    map.setLayoutProperty(LAYER_ID, 'visibility', wanted ? 'visible' : 'none');
  }

  /* A style reload drops every layer, with no warning that it happened.
   * `style.load` rather than `styledata` because the latter also fires on every
   * source data change, and this only ever needs to run once per style. */
  map.on('style.load', () => {
    if (map.getLayer(LAYER_ID)) return;
    added = false;
    add();
  });

  const handle = {
    setField(f) {
      field = f;
      builtForZoom = -1;
      if (!added) add();
      if (scene) rebuild(map.getZoom());
      map.triggerRepaint();
    },

    setVisible(on) {
      wanted = !!on;
      applyVisible();
      map.triggerRepaint();
    },

    /**
     * A one-line state readout for the prototype's stats bar.
     *
     * Deliberately terse and deliberately DIFFERENT per failure. Reading it:
     *   `off`    the layer was never added to the style
     *   `gl!`    THREE could not start on MapLibre's context
     *   `hidden` the Volcanoes toggle is off
     *   `idle`   added, but MapLibre has never called render() on it
     *   `mtx!`   render() ran but MapLibre handed over no projection matrix
     *   `z<5.0`  below the handoff, so nothing should be drawn yet — correct,
     *            not broken
     *   `12 @0.55` twelve mountains at that opacity, i.e. working
     */
    status() {
      if (glFailed) return 'gl!';
      if (!added) return 'off';
      if (!wanted) return 'hidden';
      if (!renderedOnce) return 'idle';
      if (warnedNoMatrix) return 'mtx!';
      const z = map.getZoom();
      const a = edificeOpacityAt(z);
      if (a <= 0) return 'z<' + M3.handoff[0].toFixed(1);
      if (!field || !field.marks) return 'nodata';
      if (drawnCount === 0) return 'n0';
      return drawnCount + ' @' + a.toFixed(2);
    },

    dispose() {
      if (added && map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      added = false;
      if (geometries) for (const g of Object.values(geometries)) g.dispose();
      if (matQuiet) matQuiet.dispose();
      if (matLive) matLive.dispose();
      geometries = null;
      buckets = null;
      scene = null;
      field = null;
    },
  };

  add();
  return handle;
}
