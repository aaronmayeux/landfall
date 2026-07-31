/**
 * volcano-water.js — THE SEA OVER A CLUSTER'S SEAMOUNTS.
 *
 * A flat translucent sheet at z = 0, reaching `water.spread` times each
 * seamount's base radius, faded out at its rim and cut off at the shore.
 *
 * ==> WHY IT IS ITS OWN FILE. <== It was the tail of `lib/volcano-ridge.js`
 * until that file passed the §12 line ceiling. It is also not the same KIND of
 * thing: a ridge is a heightfield sampled from a silhouette, and this is a flat
 * plane with an alpha mask on it. The two share a grid convention and nothing
 * else.
 *
 * ==> IT IS A SEPARATE MESH FROM THE MOUNTAINS, BECAUSE TWO SURFACES SIT OVER
 * THE SAME GROUND. <== A heightfield is single-valued by definition; water
 * above a mountain is the one thing it cannot express. The renderer draws this
 * after the mountains with depth WRITING off, so the sea covers the peak below
 * it without occluding anything else.
 *
 * ==> IT DOES NOT KNOW WHERE THE SHORE IS, AND THAT IS A KNOWN HOLE. <== A
 * custom layer paints over the basemap unconditionally, so a sheet near a
 * coast runs across whatever island MapLibre drew underneath. A CPU
 * point-in-polygon cut was tried on 2026-07-31 and REVERTED — see NOW.md. The
 * replacement is a GPU mask and it is not built.
 *
 * ==> AND IT DOES NOT END, IT FADES. <== Clipped hard to a footprint a water
 * plane reads as a puddle with a rim, which is worse than no water at all.
 * Drawing the sea across the whole viewport instead was considered and rejected
 * (SPEC-GLOBES.md §42.1.4c): it would lie on top of MapLibre's own water
 * polygons, which is two renderers drawing one ocean.
 *
 * ==> THE WAVE IS NOT IN HERE, AND IT NO LONGER TOUCHES THIS GRID AT ALL. <==
 * Every train, every slope and every lighting term is a fragment shader in
 * `proto/water-shader.js`. This file bakes what is constant per field. What it
 * owes the shader is `aWave`: each vertex's position in GLOBAL metres, so the
 * wave pattern is continuous across two clusters whose seas overlap instead of
 * restarting at every cluster's own origin.
 *
 * No lighting, no normals — a flat plane lit by a fixed overhead-ish sun is one
 * constant shade, so computing it per vertex would be thousands of evaluations
 * of the same answer. The wave's brightening rides the alpha the shader is
 * handed, not a recomputed shade.
 *
 * No THREE, no DOM, no MapLibre. `tools/test-volcano-water.mjs` asserts it
 * without a browser.
 */

import { VOLCANO } from '../config/constants.js';
import { smoothstep01 } from './volcano-variation.js';

const M3 = VOLCANO.map3d;
const WATER = M3.water;

/** Metres per degree of latitude. Spherical earth; over a cluster tens of km
 *  across the difference from the real ellipsoid is far below one grid cell.
 *  Same constant and same reasoning as `lib/volcano-ridge.js`. */
const M_PER_DEG_LAT = 111320;

const WATER_RGB = hexToRgb(WATER.color);

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/**
 * The sea over one cluster's seamounts.
 *
 * @param {object[]} subs the SUBMARINE members of one cluster, in local metres
 * @param {number} lon0 the cluster centre, for the global-metre wave anchor
 * @param {number} lat0 the cluster centre
 * @returns {object|null} `{positions, colors, wave, indices}`
 */
export function buildWater(subs, lon0, lat0) {
  if (!subs || subs.length === 0) return null;

  /* The sea's extent, not the mountain's: every seamount's own reach. */
  let minE = Infinity;
  let maxE = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;
  let smallest = Infinity;
  for (const m of subs) {
    const reach = m.radius * WATER.spread;
    minE = Math.min(minE, m.e - reach);
    maxE = Math.max(maxE, m.e + reach);
    minN = Math.min(minN, m.n - reach);
    maxN = Math.max(maxN, m.n + reach);
    smallest = Math.min(smallest, m.radius);
  }

  /* ==> ONE RULE SETS THE SPACING NOW, AND IT IS THE RIM FADE. <== There used
   * to be a second, absolute rule: the cell could never be coarser than the
   * shortest DISPLACING wavelength divided by a Nyquist floor, because the
   * vertex shader raised this grid and a travelling wave sampled too coarsely
   * renders as a standing zigzag.
   *
   * That rule is gone with the displacement. The surface is a flat plane and
   * every wave lives in the fragment shader, where resolution is the screen's
   * and this grid's spacing is irrelevant to it. What is LEFT for the grid to
   * carry is the alpha ramp at the sheet's edge — which scales with the
   * seamount, which is what `cellsPerRadius` already tracks.
   *
   * The saving is real and it lands on exactly the sheets that were worst off:
   * a wide sea was being held to a wavelength fixed in metres regardless of how
   * big it was. Nothing about a small sheet changes. */
  let cell = smallest / WATER.cellsPerRadius;
  const width = maxE - minE;
  const depth = maxN - minN;
  const cells = (width / cell + 1) * (depth / cell + 1);
  /* The SEA's ceiling, not the ridge's — see `water.maxCells`. Sharing one
   * coarsened every wide sheet straight back past the floor above. */
  if (cells > WATER.maxCells) cell *= Math.sqrt(cells / WATER.maxCells);

  const nx = Math.max(2, Math.ceil(width / cell) + 1);
  const ny = Math.max(2, Math.ceil(depth / cell) + 1);
  const dx = width / (nx - 1);
  const dy = depth / (ny - 1);
  const count = nx * ny;

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  const wave = new Float32Array(count * 2);
  const wet = new Float64Array(count);
  const indices = [];

  /* The cluster centre in global metres. Equirectangular about its own
   * latitude, which is all a wave phase needs — it is continuous and locally
   * true to scale, and nothing downstream measures a distance with it. */
  const cosLat = Math.cos((lat0 * Math.PI) / 180) || 1e-6;
  const originE = lon0 * M_PER_DEG_LAT * cosLat;
  const originN = lat0 * M_PER_DEG_LAT;

  for (let j = 0; j < ny; j++) {
    const y = minN + j * dy;
    for (let i = 0; i < nx; i++) {
      const x = minE + i * dx;
      const idx = j * nx + i;

      /* How far INSIDE the nearest seamount's reach this node sits, 0 at the
       * rim and 1 at a summit. The deepest wins, so two overlapping seas merge
       * into one sheet rather than double-painting their shared water. */
      let deepest = 0;
      for (const m of subs) {
        const reach = m.radius * WATER.spread;
        const d = Math.hypot(x - m.e, y - m.n);
        if (d >= reach) continue;
        const inside = 1 - d / reach;
        if (inside > deepest) deepest = inside;
      }
      wet[idx] = deepest;

      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = 0;

      wave[idx * 2] = originE + x;
      wave[idx * 2 + 1] = originN + y;

      colors[idx * 4] = WATER_RGB[0];
      colors[idx * 4 + 1] = WATER_RGB[1];
      colors[idx * 4 + 2] = WATER_RGB[2];
      /* ==> THE RIM FADE ALONE, NOT THE SHEET'S OPACITY. <== The two used to be
       * multiplied together here, which was right while GL did all the
       * blending. It is wrong now: with the scene copy available the shader
       * mixes the water over the refracted background BY HAND, so it needs the
       * body's opacity as its own number and this channel to mean only "how far
       * into the sheet is this vertex". Baking them together would apply the
       * opacity twice — once in the mix and once in the blend. */
      colors[idx * 4 + 3] = smoothstep01(deepest / WATER.edgeFade);
    }
  }

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d2 = c + 1;
      if (wet[a] <= 0 && wet[b] <= 0 && wet[c] <= 0 && wet[d2] <= 0) continue;
      indices.push(a, c, b, b, c, d2);
    }
  }

  return indices.length ? { positions, colors, wave, indices } : null;
}
