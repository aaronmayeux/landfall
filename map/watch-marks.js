/**
 * watch-marks.js — watched areas at the planet band (SPEC §45.4).
 *
 * ==> WHY THIS EXISTS AT ALL: `map/layers/genesis.js` DRAWS INTO MAPLIBRE, AND
 *     MAPLIBRE'S CANVAS IS AT OPACITY 0 WHEN THE APP OPENS. <==
 *
 * The app boots at `spaceFloorZoom()`, capped at `DIVE.zSpace`, where
 * `divePhase` is 0 and `globe3d.js` sets `mapEl.style.opacity` to 0. Storms are
 * visible out there because the 3D engine draws its own glyphs. Genesis had
 * none, so on a day with no storms and five watched areas the app opened on an
 * empty planet with the answer two pinches away — §45.1's failure wearing a
 * different hat. Found on glass 2026-08-09.
 *
 * ==> A DASHED RING, AND EVERY PART OF THAT IS LOAD-BEARING. <==
 *
 * NOT A SPIRAL — the spiral is the app's own mark and it means a cyclone.
 * NOT A FILLED DOT — a filled dot means a storm of a known strength on the
 * Saffir-Simpson ramp (§6), and this is the absence of a storm.
 * DASHED, AND OPEN — the same statement the patch's dashed outline makes at
 * close zoom. As you dive in, the ring fades out and the patch's own dashed
 * edge fades up in its place: one idea drawn at two scales, rather than two
 * unrelated marks that happen to share a colour.
 *
 * ==> RISK RIDES COLOUR AND DASH TIGHTNESS. NEVER SIZE. <== A circle on a map
 * means EXTENT. The NHC patches beside these rings are real published polygons
 * whose size genuinely says how big the area is, so if a ring's size meant
 * LIKELIHOOD instead, one visual channel would carry two meanings on one globe
 * and the natural read — bigger ring, bigger area — would be wrong. JTWC also
 * publishes no percentage at all, so the only numbers available to scale by
 * would be `GENESIS.orderWeight`, which are ours, exist for sorting, and are
 * forbidden from reaching the screen (§45.3). Aaron's call, 2026-08-09, after
 * asking for exactly that and hearing the argument against it.
 *
 * So: three textures, one per risk word, differing in DASH COUNT — tighter
 * dashes for higher risk, the same second channel the hatch density carries on
 * the patches. Drawn white and tinted per feature by a vertex colour, exactly
 * as the storm glyph is.
 *
 * `sizeAttenuation: false` for the same reason the storm glyph uses it: the
 * camera distance is recomputed every frame from MapLibre's on-screen radius,
 * so a world-sized sprite would double per zoom level. This mark is a LABEL —
 * "something is being watched here" — never a footprint.
 *
 * Imports config/ and lib/. Takes THREE as an argument rather than importing
 * it: `index.html` loads the vendored build by relative path and this module
 * must not care where it came from.
 */

import { DIVE } from '../config/constants.js';
import { SIZE, GENESIS_GEO } from '../config/tokens.js';
import { genesisColor, normalizeRisk } from '../lib/genesis.js';
import { watchRingCanvas } from './glyph.js';

const RISKS = ['LOW', 'MEDIUM', 'HIGH'];

/**
 * Build the planet-band marks.
 *
 * @param {object} THREE   the vendored Three.js namespace
 * @param {object} opts
 * @param {() => object} opts.palette  the live theme's table
 * @returns {{objects: object[], setAreas: Function, setFade: Function,
 *            retheme: Function}}
 */
export function createWatchMarks(THREE, { palette }) {
  const scratch = new THREE.Color();

  /* ONE POINTS OBJECT PER RISK LEVEL, because a Points material carries
   * exactly one texture and the three rings differ in their dash pattern. The
   * same reason the storm glyph is split by hemisphere. Three draw calls for a
   * layer that has never had more than a handful of features is not a budget
   * anyone will notice.
   *
   * NO HEMISPHERE SPLIT HERE — a ring is symmetric, so there is no rotation to
   * flip at the equator. */
  const groups = RISKS.map((risk) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));

    const material = new THREE.PointsMaterial({
      vertexColors: true,
      color: 0xffffff,
      size: SIZE.watchRing3dPx,
      transparent: true,
      opacity: 0,
      /* depthTest ON: a ring on the far hemisphere hides behind the globe, the
       * way a position should. */
      depthTest: true,
      depthWrite: false,
      sizeAttenuation: false,
      fog: true,
    });

    const points = new THREE.Points(geometry, material);
    /* BELOW THE STORM GLYPHS (renderOrder 2). A maybe never draws over a
     * certainty — the same rule `order: 0` states on the MapLibre side. */
    points.renderOrder = 1;
    return { risk, geometry, material, points };
  });

  function makeTextures() {
    /* ==> `palette().geo.glyphHalo`, NOT `palette().glyphHalo`. <== The first
     * spelling is `undefined` in both themes and the `??` swallowed it into
     * the ocean colour — a halo the exact shade of the background, which is no
     * halo at all, and it would have looked merely "a bit thin" on glass
     * rather than wrong. `tools/token-check.mjs` caught it; that tool exists
     * for precisely this shape of mistake. */
    const halo = palette().geo.glyphHalo;
    for (const g of groups) {
      const cv = watchRingCanvas(SIZE.watchTexturePx, GENESIS_GEO.ringDashes[g.risk], halo);
      const next = cv ? new THREE.CanvasTexture(cv) : null;
      /* Dispose before replacing, or a theme flip leaks one texture per risk
       * level per toggle. */
      g.material.map?.dispose?.();
      g.material.map = next;
      g.material.needsUpdate = true;
    }
  }
  makeTextures();

  /**
   * The current watch list.
   *
   * EVERY AREA GETS A MARK, INCLUDING THE JTWC ONES. That is half the point of
   * this file: a JTWC system publishes a position and no polygon, so before
   * this it drew nothing at any zoom — tap the row, fly there, see an empty
   * ocean. It has a position, and a position is exactly what a ring needs.
   */
  function setAreas(areas) {
    const list = Array.isArray(areas) ? areas : [];
    for (const g of groups) {
      const mine = list.filter(
        (a) => normalizeRisk(a.globeRisk ?? a.risk) === g.risk && a.centroid
      );
      const pos = new Float32Array(mine.length * 3);
      const col = new Float32Array(mine.length * 3);
      for (let i = 0; i < mine.length; i++) {
        const { lon, lat } = mine[i].centroid;
        /* Same radius the storm glyphs sit at, so the two marks share a shell
         * and neither can float above or sink below the other. */
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lon + 180) * (Math.PI / 180);
        const R = DIVE.stormDotRadius;
        pos[i * 3] = -R * Math.sin(phi) * Math.cos(theta);
        pos[i * 3 + 1] = R * Math.cos(phi);
        pos[i * 3 + 2] = R * Math.sin(phi) * Math.sin(theta);

        scratch.set(genesisColor(g.risk));
        col[i * 3] = scratch.r;
        col[i * 3 + 1] = scratch.g;
        col[i * 3 + 2] = scratch.b;
      }
      g.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.geometry.attributes.position.needsUpdate = true;
      g.geometry.attributes.color.needsUpdate = true;
      g.geometry.setDrawRange(0, mine.length);
      g.geometry.computeBoundingSphere();
    }
  }

  /**
   * The crossfade.
   *
   * ==> THE SAME BAND THE STORM GLYPHS USE, AND THAT IS THE WHOLE DESIGN. <==
   * `DIVE.fade.nodes` is what carries the storm glyph out as MapLibre's own
   * marks fade in underneath. Genesis rides it identically, so the ring leaves
   * exactly as the hatched patch arrives — there is no gap where a watched
   * area is invisible, and no band where a ring and a patch are both at full
   * strength claiming the same spot twice. The handoff is automatic because
   * both curves are complements of one number.
   */
  function setFade(p, smoothstep) {
    const o = 1 - smoothstep(p, ...DIVE.fade.nodes);
    for (const g of groups) g.material.opacity = o;
  }

  /** Re-rasterise the halo for the live theme. The ink is tinted per feature
   *  by the vertex colour and needs nothing here; the baked halo does. */
  function retheme() {
    makeTextures();
  }

  return {
    objects: groups.map((g) => g.points),
    setAreas,
    setFade,
    retheme,
  };
}
