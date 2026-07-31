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
 * ==> AND IT DOES NOT END, IT FADES. <== Clipped hard to a footprint a water
 * plane reads as a puddle with a rim, which is worse than no water at all.
 * Drawing the sea across the whole viewport instead was considered and rejected
 * (SPEC-GLOBES.md §42.1.4c): it would lie on top of MapLibre's own water
 * polygons, which is two renderers drawing one ocean.
 *
 * ==> THE WAVE IS NOT IN HERE. <== Displacement and crest brightening are a
 * vertex shader in `proto/volcano-3d.js`, because they change every frame and
 * everything this file bakes is computed once per field. What this file owes
 * the shader is `aWave`: each vertex's position in GLOBAL metres, so the wave
 * pattern is continuous across two clusters whose seas overlap instead of
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
const WAVE = WATER.wave;

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
 * @param {object} [landMask] from `lib/land-mask.js`. Omitted or null means
 *   the coastline is UNKNOWN, which is not the same as "no land" — see the
 *   note on `landFactors` below.
 * @returns {object|null} `{positions, colors, wave, indices}`
 */
export function buildWater(subs, lon0, lat0, landMask) {
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

  /* ==> TWO RULES SET THE SPACING AND THE FINER ONE WINS. <== The first scales
   * with the seamount, so a small one still gets enough samples across its own
   * rim fade. The second is absolute, because the wavelengths are in metres and
   * do not shrink with the mountain — without it a wide sheet keeps the same
   * vertex count, the spacing grows past the shortest train it has to carry,
   * and the sea reads as a standing zigzag instead of moving. Measured on the
   * real catalog: the widest sheet ran 1.2 samples per wave before this.
   *
   * Only the DISPLACING trains are counted. The rest of the wave never touches
   * a vertex — it is lit per fragment, where resolution is free — and demanding
   * grid for it cost 289,487 vertices across the drawn set, more than the
   * mountains underneath. */
  const displacing = WAVE.lengthsM.slice(0, WAVE.displaceCount);
  const waveCell = Math.min(...displacing) / WAVE.minSamplesPerWave;
  let cell = Math.min(smallest / WATER.cellsPerRadius, waveCell);
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

  const sea = landFactors(landMask, {
    nx, ny, dx, dy, minE, minN, lon0, lat0, cosLat,
  });

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
      /* ==> THE LAND FACTOR MULTIPLIES `wet`, NOT JUST THE ALPHA. <== `wet`
       * is what decides below whether a quad is emitted at all, so folding
       * the shore in here deletes the triangles under an island as well as
       * making them transparent. A fully transparent quad still costs a
       * fragment. */
      deepest *= sea[idx];
      wet[idx] = deepest;

      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = 0;

      wave[idx * 2] = originE + x;
      wave[idx * 2 + 1] = originN + y;

      colors[idx * 4] = WATER_RGB[0];
      colors[idx * 4 + 1] = WATER_RGB[1];
      colors[idx * 4 + 2] = WATER_RGB[2];
      colors[idx * 4 + 3] = WATER.opacity * smoothstep01(deepest / WATER.edgeFade);
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

/**
 * Per-node sea fraction: 1 in open water, 0 on land, ramped between.
 *
 * ==> NO MASK MEANS UNKNOWN, AND UNKNOWN DRAWS THE SEA. <== When the basemap
 * has not answered yet we do not know where land is. The choice is between a
 * sea that spills slightly onto a coast and no sea at all over a seamount that
 * is genuinely under water, and the second is the bigger lie — it would delete
 * the one feature that tells you Ahyi is submarine. So the honest fallback is
 * the old behaviour, and the caller rebuilds when the coastline arrives.
 *
 * ==> THE BLUR IS WHY THIS IS A SEPARATE PASS. <== A binary test on a grid a
 * kilometre a side makes a diagonal coast into a staircase. Two box passes
 * over the binary result turn the steps into a beach, and it costs one build,
 * not one frame. `water.shoreFeatherCells` is the radius.
 */
function landFactors(landMask, g) {
  const { nx, ny, dx, dy, minE, minN, lon0, lat0, cosLat } = g;
  const count = nx * ny;
  const out = new Float64Array(count);

  if (!landMask || typeof landMask.landAt !== 'function') {
    out.fill(1);
    return out;
  }

  /* Local metres back to lon/lat, the inverse of the projection
   * `lib/volcano-ridge.js` used to place these members. */
  for (let j = 0; j < ny; j++) {
    const lat = lat0 + (minN + j * dy) / M_PER_DEG_LAT;
    for (let i = 0; i < nx; i++) {
      const lon = lon0 + (minE + i * dx) / (M_PER_DEG_LAT * cosLat);
      out[j * nx + i] = landMask.landAt(lon, lat) ? 0 : 1;
    }
  }

  const r = Math.max(0, Math.round(WATER.shoreFeatherCells));
  if (r === 0) return out;

  /* Separable box blur, radius r, twice — two box passes approximate a
   * gaussian closely enough for a beach and cost two linear scans. */
  const tmp = new Float64Array(count);
  for (let pass = 0; pass < 2; pass++) {
    boxBlurRows(out, tmp, nx, ny, r);
    boxBlurCols(tmp, out, nx, ny, r);
  }
  return out;
}

function boxBlurRows(src, dst, nx, ny, r) {
  for (let j = 0; j < ny; j++) {
    const row = j * nx;
    for (let i = 0; i < nx; i++) {
      let sum = 0;
      let n = 0;
      const lo = Math.max(0, i - r);
      const hi = Math.min(nx - 1, i + r);
      for (let k = lo; k <= hi; k++) {
        sum += src[row + k];
        n++;
      }
      dst[row + i] = sum / n;
    }
  }
}

function boxBlurCols(src, dst, nx, ny, r) {
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      let sum = 0;
      let n = 0;
      const lo = Math.max(0, j - r);
      const hi = Math.min(ny - 1, j + r);
      for (let k = lo; k <= hi; k++) {
        sum += src[k * nx + i];
        n++;
      }
      dst[j * nx + i] = sum / n;
    }
  }
}
