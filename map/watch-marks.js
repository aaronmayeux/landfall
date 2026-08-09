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
 * ==> THE MARK IS THE PATCH, IN MINIATURE. <==
 *
 * Same irregular blob, same dashed edge, same diagonal hatch as the real area
 * carries at close zoom. Diving in is a DISSOLVE rather than a swap — the
 * glyph does not hand over to another symbol, it becomes itself at full size.
 *
 * It was a plain dashed ring first. Honest, and bland: nothing about a bare
 * circle says weather, and on glass it read as a selection halo. The lozenge
 * says "an area" before it says anything else. Aaron's call, 2026-08-09.
 *
 * NOT A SPIRAL — the spiral is the app's own mark and it means a cyclone.
 * NOT A FILLED DOT — a filled dot means a storm of a known strength on the
 * Saffir-Simpson ramp (§6), and this is the absence of a storm.
 *
 * ==> RISK RIDES COLOUR AND HATCH COUNT. NEVER SIZE. <== A shape on a map
 * means EXTENT. The NHC patches beside these are real published polygons whose
 * size genuinely says how big the area is, so if a glyph's size meant
 * LIKELIHOOD instead, one visual channel would carry two meanings on one globe
 * and the natural read — bigger mark, bigger area — would be wrong.
 *
 * So: three textures, one per risk word, differing in HATCH COUNT — the same
 * second channel `GENESIS_GEO.hatchGap` carries on the patches, expressed the
 * only way it can be at 30 px. Drawn white and tinted per feature by a vertex
 * colour, exactly as the storm glyph is.
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
import { watchGlyphCanvas } from './glyph.js';
import { lonLatToVec3 } from '../lib/geo.js';

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
      size: SIZE.watchGlyph3dPx,
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
      const cv = watchGlyphCanvas(
        SIZE.watchTexturePx,
        GENESIS_GEO.glyphHatchLines[g.risk],
        halo
      );
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

        /* ==> `lonLatToVec3`, THE APP'S OWN. NEVER A SECOND COPY OF THIS MATH.
         *     <==
         *
         * The first version of this line rolled its own spherical conversion —
         * the textbook `phi/theta` form — and it put every ring NINETY DEGREES
         * EAST of where it belonged. Central Pacific at 147°W drew at 57°W, in
         * the Atlantic; East Pacific at 114°W drew at 24°W, also the Atlantic.
         * On glass that read as three Atlantic rings over two Atlantic
         * patches, which is a count that cannot happen and is the only reason
         * it was caught.
         *
         * `map/globe-follow.js` says this in as many words — its measurement
         * and its three signs were extracted specifically so nothing would
         * hand-roll a second, wrong copy. This file did it anyway. The globe's
         * axis convention (+Y north, prime meridian facing +Z) is not the
         * textbook one, and any formula that looks right in the abstract is
         * wrong here.
         *
         * Same radius as the storm glyphs, so both marks share one shell and
         * neither floats above or sinks below the other. */
        const v = lonLatToVec3(lon, lat, DIVE.stormDotRadius);
        pos[i * 3] = v.x;
        pos[i * 3 + 1] = v.y;
        pos[i * 3 + 2] = v.z;

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
