/**
 * volcano-ridge.js — A CORDILLERA IS ONE RIDGE WITH PEAKS ON IT, NOT A ROW OF
 * SEPARATE CONES.
 *
 * ==> WHY THIS FILE EXISTS AT ALL. <== A 3.5 km stratovolcano models about
 * 31 km across (`lib/volcano-dimensions.js`), and volcanoes along an arc sit
 * 15–25 km apart. So their footprints genuinely intersect — that is not a
 * drawing artefact, it is the geography. Drawing each one as its own closed
 * shape put 126 hard-edged silhouettes over the top of each other and read as
 * a smear of stamped coins. Real overlapping mountains do not have edges where
 * they meet; they have a saddle.
 *
 * So volcanoes whose footprints intersect are gathered into a CLUSTER, and a
 * cluster is sampled as one continuous heightfield. Two mountains 20 km apart
 * become one ridge with two summits and a col between them.
 *
 * ==> `volcanoProfile()` IS STILL THE ONLY SILHOUETTE, AND THIS FILE DOES NOT
 * REIMPLEMENT IT. <== That function is parameterised the way a lathe wants —
 * "at this fraction up the profile, what is the radius and the height". A
 * heightfield wants the inverse — "at this distance from the axis, how high is
 * the ground". `profileTable()` below INVERTS the same function into a lookup
 * table per family. It is one silhouette read two ways, not two silhouettes.
 *
 * ==> SMOOTH MAX, NEVER A SUM, AND NEVER A PLAIN MAX. <== A sum makes two
 * overlapping volcanoes taller than either of them, which is a fabrication. A
 * plain max is correct at the summits but leaves a visible crease along the
 * line where the two footprints cross. The blend below returns the exact
 * maximum wherever the two differ by more than `saddle`, so summits keep their
 * true height, and rounds the join where they are close.
 *
 * ==> AND A HEIGHTFIELD BUILT FROM A RADIAL PROFILE IS A SURFACE OF
 * REVOLUTION, WHICH MADE EVERY CONE THE SAME OBJECT. <== `lib/volcano-
 * variation.js` bends the radius by BEARING before the profile lookup, seeded
 * from each volcano's own catalog number, so no two mountains are the same
 * shape and the normals this file already computes have something to shade.
 * It adds no samples and no triangles, and it may never reach past a
 * volcano's true footprint.
 *
 * ==> THE SEA IS NOT IN HERE. <== `lib/volcano-water.js` builds the sheet over
 * a cluster's seamounts. It is a flat plane with an alpha mask, not a
 * heightfield sampled from a silhouette, and it left this file when the line
 * ceiling bound. `buildRidge` still calls it so a caller gets one object back,
 * and it keeps `subs` on that object so the sea can be recut against a moved
 * shoreline without resampling the mountain.
 *
 * No THREE, no DOM, no MapLibre. Everything here is plain numbers in metres,
 * so `tools/test-volcano-ridge.mjs` can assert all of it without a browser —
 * which is the whole reason the maths is not in the renderer. The sandbox has
 * no Chromium and every bug this feature has had was found by reading or
 * asserting, never by reasoning about what the code probably did.
 */

import { VOLCANO } from '../config/constants.js';
import { volcanoProfile } from './volcano-shape.js';
import { volcanoDimensions, volcanoBaseM } from './volcano-dimensions.js';
import { buildWater } from './volcano-water.js';
import {
  volcanoVariation,
  warpRadius,
  breachHeight,
  smoothstep01,
} from './volcano-variation.js';

const M3 = VOLCANO.map3d;
const R = M3.ridge;
const SHAPES = VOLCANO.shapes.families;

/** Metres per degree of latitude. Spherical earth; over a cluster tens of km
 *  across the difference from the real ellipsoid is far below one grid cell. */
const M_PER_DEG_LAT = 111320;

/* -------------------------------------------------------------- the profile */

/**
 * ==> THE INVERSION, AND IT IS SINGLE-VALUED FOR EVERY FAMILY. <==
 *
 * `volcanoProfile(v, spec)` walks v from 0 at the base to 1 at the summit and
 * returns a radius and a height on a unit template. Radius DECREASES all the
 * way up for all five families — including the caldera, whose crater term only
 * shrinks the radius further past the rim — so a given distance from the axis
 * corresponds to exactly one point on the profile and the inversion is a plain
 * lookup rather than a root find.
 *
 * The table is stored with radius ASCENDING (summit first, base last) so a
 * lookup walks outward from the axis.
 *
 * @param {object} spec one entry of `VOLCANO.shapes.families`
 * @param {number} [steps] samples up the profile
 * @returns {{q: Float64Array, h: Float64Array}} q is radius ÷ base radius,
 *   h is height ÷ full height, both 0..1
 */
export function profileTable(spec, steps) {
  const n = Math.max(4, steps || R.tableSteps);
  const q = new Float64Array(n + 1);
  const h = new Float64Array(n + 1);

  /* Walk DOWN from the summit so the table comes out radius-ascending without
   * a second pass. */
  for (let i = 0; i <= n; i++) {
    const v = 1 - i / n;
    const p = volcanoProfile(v, spec);
    q[i] = p.r;
    h[i] = p.h;
  }
  return { q, h };
}

/**
 * Height at a distance from the axis, on the unit template.
 *
 * Inside the summit radius the profile has run out — a cone's `topR` is 0.04,
 * not 0 — so the top is flat at its own last height rather than extrapolated
 * to a spike. Outside the base radius the ground is flat and this returns
 * exactly 0, which is what lets the mesh be trimmed at the footprint edge
 * instead of carrying a large invisible skirt.
 *
 * @param {{q: Float64Array, h: Float64Array}} table from `profileTable`
 * @param {number} frac distance from the axis ÷ base radius
 * @returns {number} 0..1
 */
export function heightFrac(table, frac) {
  const { q, h } = table;
  const n = q.length - 1;
  if (!(frac > q[0])) return h[0];
  if (frac >= q[n]) return 0;

  /* Linear scan outward. The table is short and this is called once per grid
   * node per member, so a binary search buys nothing measurable and costs a
   * correctness surface. */
  for (let i = 1; i <= n; i++) {
    if (frac <= q[i]) {
      const span = q[i] - q[i - 1];
      const t = span > 1e-12 ? (frac - q[i - 1]) / span : 0;
      return h[i - 1] + (h[i] - h[i - 1]) * t;
    }
  }
  return 0;
}

/** One table per family, built once. */
const TABLES = (() => {
  const out = {};
  for (const fam of Object.keys(SHAPES)) out[fam] = profileTable(SHAPES[fam]);
  return out;
})();

/* --------------------------------------------------------------- the blend */

/**
 * ==> SMOOTH MAXIMUM. EXACT AT THE PEAKS, ROUNDED AT THE JOIN. <==
 *
 * Where the two values differ by more than `k` this returns the larger one
 * EXACTLY — so a summit is never inflated by a neighbour it happens to sit
 * near, and `smax` degrades to `max` for mountains that do not really meet.
 * Where they are close it lifts the join by up to `k / 4`, which is the saddle.
 *
 * @param {number} a
 * @param {number} b
 * @param {number} k blend width, in the same units as a and b
 * @returns {number}
 */
export function smax(a, b, k) {
  if (!(k > 0)) return Math.max(a, b);
  const d = (a - b) / k;
  if (d >= 1) return a;
  if (d <= -1) return b;
  const t = 0.5 + 0.5 * d;
  return a * t + b * (1 - t) + k * t * (1 - t);
}

/** Reduce a list with `smax`, largest first so the result does not depend on
 *  the order the catalog happened to be in. */
function smaxAll(values, k) {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  values.sort((x, y) => y - x);
  let acc = values[0];
  for (let i = 1; i < values.length; i++) acc = smax(acc, values[i], k);
  return acc;
}

/* ------------------------------------------------------------ the clusters */

/** Shortest signed longitude difference, so a cluster straddling the
 *  antimeridian (the Kurils, Fiji, the Aleutians) does not come apart. */
function lonDelta(a, b) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/**
 * A drawable volcano reduced to the numbers this file needs: where it is, how
 * wide its base is and how tall it stands, all in metres.
 *
 * ==> HEIGHT CARRIES `vertical` AND WIDTH DOES NOT, WHICH IS THE STATED LIE
 * (§42.1.4b). <== The footprint is TRUE — that is what a true footprint means
 * and it is what `fill-extrusion` could not have. Height is exaggerated,
 * deliberately, because a truthful stratovolcano is four and a half times
 * wider than it is tall and reads as a swell rather than a mountain.
 *
 * @param {object} mark one entry of `loadVolcanoField().marks`
 * @returns {object} member record in metres
 */
export function ridgeMember(mark) {
  const { relief, radius } = volcanoDimensions(mark);
  return {
    lon: mark.lon,
    lat: mark.lat,
    family: mark.family,
    erupting: !!mark.erupting,
    submarine: !!mark.submarine,
    /** ==> THE GVP CATALOG NUMBER, AND IT IS THE WHOLE SEED. <== Every
     *  volcano gets its own shape from `lib/volcano-variation.js` and gets the
     *  SAME one on every reload and every device, because the seed is a
     *  property of the volcano rather than of the session. A mountain that
     *  reshuffles when you refresh is worse than one that looks like its
     *  neighbour. Falls back to a constant so a mark with no number is a
     *  plain unvaried mountain rather than a crash. */
    seed: Number(mark.n) || 1,
    radius,
    height: relief * M3.vertical,
    /* ==> THE FOOT, EXAGGERATED BY THE SAME FACTOR AS THE HEIGHT, WHICH IS
     * WHAT KEEPS A SEAMOUNT UNDER WATER. <== 0 on land, negative below it. The
     * summit therefore lands at `baseZ + height` = `elev * vertical`, still
     * negative and still under the plane the sea is drawn on. Exaggerating the
     * height while leaving the foot at 0 is the bug this line exists to make
     * impossible. */
    baseZ: volcanoBaseM(mark) * M3.vertical,
  };
}

/**
 * Gather volcanoes whose footprints intersect into clusters.
 *
 * ==> CLUSTERED AT TRUE SCALE, WHICH IS THE ONLY SCALE THERE IS NOW. <==
 * `map3d.inflate` was a uniform zoom-driven multiplier and it was deleted
 * 2026-07-30. While it existed, clustering read TRUE radii while the screen
 * drew them five times wider, so the pairs that visibly collided were exactly
 * the pairs this function decided were not neighbours — that was the cause of
 * the camera-dependent depth seams, not a side effect of them. With no zoom
 * term left anywhere in the draw scale, membership is fixed at build time and
 * no mesh is ever rebuilt during a pinch.
 *
 * ==> A SEAMOUNT AND A LAND VOLCANO CAN LAND IN ONE CLUSTER AND THAT IS
 * CORRECT. <== A coastal arc really does have both. `buildRidge` blends their
 * two foot planes rather than assuming one.
 *
 * @param {object[]} members from `ridgeMember`
 * @returns {object[][]} clusters, each a list of members
 */
export function clusterMembers(members) {
  const n = members.length;
  const parent = new Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;

  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  for (let i = 0; i < n; i++) {
    const a = members[i];
    const cosLat = Math.cos((a.lat * Math.PI) / 180) || 1e-6;
    for (let j = i + 1; j < n; j++) {
      const b = members[j];
      const dNorth = (b.lat - a.lat) * M_PER_DEG_LAT;
      const dEast = lonDelta(b.lon, a.lon) * M_PER_DEG_LAT * cosLat;
      const reach = (a.radius + b.radius) * R.clusterPad;
      /* Squared, to keep a square root out of an O(n²) loop. */
      if (dNorth * dNorth + dEast * dEast <= reach * reach) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(members[i]);
  }
  return [...groups.values()];
}

/* ------------------------------------------------------------- the surface */

/** `#rrggbb` to 0..1 components, so this file needs no THREE.Color. */
function rgbOf(hex) {
  const s = String(hex).replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16) / 255,
    parseInt(s.slice(2, 4), 16) / 255,
    parseInt(s.slice(4, 6), 16) / 255,
  ];
}

const QUIET_RGB = rgbOf(M3.color);
const LIVE_RGB = rgbOf(M3.eruptingColor);

/**
 * Sample one cluster as a continuous heightfield and return plain arrays a
 * renderer can hand straight to the GPU.
 *
 * Positions are METRES relative to the cluster's own centre, with Z up and ZERO
 * AT SEA LEVEL. The caller places the cluster with one uniform scale and one
 * translation, and since `inflate` was deleted there is no zoom term in either,
 * so the placement is computed once and never again.
 *
 * ==> Z IS SIGNED NOW, AND THAT IS WHAT SEAMOUNTS COST. <== It used to be
 * height above the map and could never be negative, so "is this node inside a
 * footprint" and "is this node above zero" were the same question and the code
 * asked the second one. A submarine volcano is entirely below zero, so the mesh
 * would have been trimmed away completely. Coverage is tracked explicitly.
 *
 * ==> COLOUR AND ALPHA ARE BAKED PER VERTEX, WHICH IS WHAT LETS A MERGED
 * CLUSTER HOLD BOTH STATES. <== One mesh cannot carry two materials, and a
 * cluster can easily contain one erupting volcano and four quiet ones. So the
 * gold is blended in by how much an erupting member actually contributes to
 * the ground at that point: an erupting summit is gold, its own flanks fade to
 * white, and the quiet mountain sharing its ridge stays white. That is more
 * honest than colouring a whole ridge by its liveliest member.
 *
 * ==> AND THE ALPHA RAMP AT THE BOTTOM IS WHAT KILLS THE STAMPED-COIN READ.
 * <== A hard rim where the geometry meets the basemap is exactly what made
 * these look like discs laid on the map. Opacity ramps in over the bottom
 * `ridge.softBase` of each point's OWN local mountain height, so the surface
 * emerges from the map rather than being cut out of it.
 *
 * @param {object[]} cluster members from `ridgeMember`
 * @returns {object|null} `{lon, lat, positions, colors, indices, peak, extent}`
 */
export function buildRidge(cluster, landMask) {
  if (!cluster || cluster.length === 0) return null;

  /* Centre on the first member and average the offsets, so a cluster spanning
   * the antimeridian averages correctly instead of landing in Africa. */
  const base = cluster[0];
  const cosBase = Math.cos((base.lat * Math.PI) / 180) || 1e-6;
  let sumE = 0;
  let sumN = 0;
  for (const m of cluster) {
    sumE += lonDelta(m.lon, base.lon) * M_PER_DEG_LAT * cosBase;
    sumN += (m.lat - base.lat) * M_PER_DEG_LAT;
  }
  const cE = sumE / cluster.length;
  const cN = sumN / cluster.length;
  const lat0 = base.lat + cN / M_PER_DEG_LAT;
  const lon0 = base.lon + cE / (M_PER_DEG_LAT * cosBase);

  /* Members in metres relative to that centre. */
  const local = cluster.map((m) => ({
    e: lonDelta(m.lon, base.lon) * M_PER_DEG_LAT * cosBase - cE,
    n: (m.lat - base.lat) * M_PER_DEG_LAT - cN,
    radius: m.radius,
    height: m.height,
    baseZ: m.baseZ || 0,
    erupting: m.erupting,
    submarine: !!m.submarine,
    table: TABLES[m.family] || TABLES.cone,
    /* ==> ONE SHAPE PER VOLCANO, BUILT ONCE PER CLUSTER RATHER THAN PER NODE.
     * <== The coefficients are a few dozen multiplies and one 256-sample scan
     * for the outline maximum; the grid below asks for them thousands of
     * times. */
    vary: volcanoVariation(m.seed, SHAPES[m.family] || SHAPES.cone),
    /* The profile's own height at the axis — the crater floor on a caldera and
     * the summit on everything else. `breachHeight` measures the rim from it,
     * which is what confines the breach to the rim and leaves the floor and
     * the lower flank alone. */
    floorFrac: (TABLES[m.family] || TABLES.cone).h[0],
  }));

  const anySubmarine = local.some((m) => m.submarine);

  let minE = Infinity;
  let maxE = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;
  let smallest = Infinity;
  let peak = 0;
  for (const m of local) {
    minE = Math.min(minE, m.e - m.radius);
    maxE = Math.max(maxE, m.e + m.radius);
    minN = Math.min(minN, m.n - m.radius);
    maxN = Math.max(maxN, m.n + m.radius);
    smallest = Math.min(smallest, m.radius);
    peak = Math.max(peak, m.height);
  }

  /* Resolution is set by the SMALLEST member, so a dome sharing a ridge with a
   * shield is still sampled finely enough to be a dome. The cap is what stops
   * a long arc from becoming an enormous grid. */
  let cell = smallest / R.cellsPerRadius;
  const width = maxE - minE;
  const depth = maxN - minN;
  const cells = (width / cell + 1) * (depth / cell + 1);
  if (cells > R.maxCells) cell *= Math.sqrt(cells / R.maxCells);

  const nx = Math.max(2, Math.ceil(width / cell) + 1);
  const ny = Math.max(2, Math.ceil(depth / cell) + 1);
  const dx = width / (nx - 1);
  const dy = depth / (ny - 1);

  const count = nx * ny;
  /** The SURFACE, in metres, signed. Zero is sea level and the plane the map
   *  itself is on; a seamount's whole mesh sits below it. */
  const surf = new Float64Array(count);
  /** How much of the ground here is owed to something erupting, 0..1. Measured
   *  on RISE ABOVE OWN FOOT rather than on absolute height, because absolute
   *  height is negative under water and a ratio of two negative numbers means
   *  nothing. On land the two are identical. */
  const liveFrac = new Float64Array(count);
  const localPeak = new Float64Array(count);
  /** The foot the tallest contributor here stands on. The opacity ramp is
   *  measured from THIS rather than from zero, so "the surface emerges from the
   *  ground" still means the ground it is actually standing on when that ground
   *  is 3 km under water. */
  const localBase = new Float64Array(count);
  /** How far inside the nearest footprint rim this node sits, as a fraction of
   *  that member's base radius. Used to hide the grid staircase — see below. */
  const inset = new Float64Array(count);
  const covered = new Uint8Array(count);

  const k = peak * R.saddle;
  const contrib = [];

  for (let j = 0; j < ny; j++) {
    const y = minN + j * dy;
    for (let i = 0; i < nx; i++) {
      const x = minE + i * dx;
      contrib.length = 0;
      let lp = 0;
      let lb = 0;
      let deepest = 0;
      let maxRise = 0;
      let maxRiseLive = 0;
      /* ==> A SMOOTH BASE PLANE OVER THE WHOLE GRID, NOT JUST UNDER THE
       * FOOTPRINTS. <== Nodes outside every footprint still need a height, and
       * before seamounts existed that height was always 0 because every foot
       * was at 0. A cluster holding both a coastal cone (foot at 0) and a
       * seamount (foot 12 km down after exaggeration) would put a sheer wall
       * between them at the first node neither covers. Inverse-square distance
       * weighting is continuous everywhere by construction, and for an
       * all-land cluster every term is 0 so it collapses to exactly the old
       * behaviour. */
      let wSum = 0;
      let wBase = 0;
      for (const m of local) {
        const de = x - m.e;
        const dn = y - m.n;
        const d = Math.hypot(de, dn);
        const q = d / m.radius;
        /* ==> ONLY PAID FOR BY CLUSTERS THAT HAVE A SEAFLOOR. <== For an
         * all-land cluster every foot is at 0, so the blend can only ever
         * return 0 and computing it would be two multiplies and a divide per
         * member per node for a constant. Measured: with this guard the whole
         * 240-volcano build is where it was before seamounts existed; without
         * it, half again as long. That cost lands on a phone, once, at the
         * moment the field arrives. */
        if (anySubmarine) {
          const w = 1 / (1 + q * q);
          wSum += w;
          wBase += w * m.baseZ;
        }
        if (d >= m.radius) continue;

        /* ==> THIS IS WHERE A MOUNTAIN STOPS BEING A SURFACE OF REVOLUTION.
         * <== `heightFrac` asks "at this distance from the axis, how high",
         * and it never asked which DIRECTION — so every cone in the drawn set
         * was geometrically the same object. `warpRadius` bends the radius by
         * bearing before the lookup and `breachHeight` cuts one sector of a
         * crater rim after it; both are seeded from the volcano's own catalog
         * number, and neither adds a sample or a triangle
         * (`lib/volcano-variation.js`).
         *
         * The bearing is the node's own offset over its distance — a cosine
         * and a sine the loop already has, so there is no trigonometry here.
         * At the axis itself there is no bearing at all, so the node is left
         * unvaried; it is one node per summit and the profile is flat there. */
        let qv = q;
        let cosT = 1;
        let sinT = 0;
        if (d > 1e-9) {
          cosT = de / d;
          sinT = dn / d;
          qv = warpRadius(m.vary, q, cosT, sinT);
        }
        const hf = breachHeight(m.vary, heightFrac(m.table, qv), m.floorFrac, cosT, sinT);
        const rise = m.height * hf;
        if (rise <= 0) continue;
        contrib.push(m.baseZ + rise);
        if (rise > maxRise) maxRise = rise;
        if (m.erupting && rise > maxRiseLive) maxRiseLive = rise;
        if (m.height > lp) {
          lp = m.height;
          lb = m.baseZ;
        }
        /* ==> THE EDGE FADE MEASURES FROM THE VARIED RIM, NOT THE TRUE ONE.
         * <== `inset` exists to hide the grid staircase along a footprint's
         * edge, and after variation that edge is wherever the warped profile
         * runs out — which is inside the true radius by a different amount on
         * every bearing. Fed the unvaried `q` it would fade the wrong ring and
         * the dashed fringe would come straight back. */
        if (1 - qv > deepest) deepest = 1 - qv;
      }
      const idx = j * nx + i;
      const smoothBase = wSum > 0 ? wBase / wSum : 0;
      if (contrib.length) {
        covered[idx] = 1;
        surf[idx] = smaxAll(contrib, k);
        localPeak[idx] = lp;
        localBase[idx] = lb;
      } else {
        surf[idx] = smoothBase;
        localBase[idx] = smoothBase;
      }
      liveFrac[idx] = maxRise > 1e-9 ? Math.min(1, maxRiseLive / maxRise) : 0;
      inset[idx] = deepest;
    }
  }

  /* ---- vertices ---------------------------------------------------------- */

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);

  const light = M3.light;
  const ll = Math.hypot(light[0], light[1], light[2]) || 1;
  const lx = light[0] / ll;
  const ly = light[1] / ll;
  const lz = light[2] / ll;

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i;
      const h = surf[idx];

      positions[idx * 3] = minE + i * dx;
      positions[idx * 3 + 1] = minN + j * dy;
      positions[idx * 3 + 2] = h;

      /* Central differences give the surface normal. At the grid edge the
       * neighbour that is not there is replaced by this node, which is a
       * one-sided difference rather than a wrap onto the far side. */
      const hL = surf[j * nx + Math.max(0, i - 1)];
      const hR = surf[j * nx + Math.min(nx - 1, i + 1)];
      const hD = surf[Math.max(0, j - 1) * nx + i];
      const hU = surf[Math.min(ny - 1, j + 1) * nx + i];
      const spanX = (Math.min(nx - 1, i + 1) - Math.max(0, i - 1)) * dx || dx;
      const spanY = (Math.min(ny - 1, j + 1) - Math.max(0, j - 1)) * dy || dy;
      const gx = -(hR - hL) / spanX;
      const gy = -(hU - hD) / spanY;
      const nlen = Math.hypot(gx, gy, 1);
      const d = (gx / nlen) * lx + (gy / nlen) * ly + (1 / nlen) * lz;
      const shade = M3.ambient + (1 - M3.ambient) * Math.max(0, d);

      /* How much of the ground here is owed to something that is erupting. */
      const f = liveFrac[idx];
      colors[idx * 4] = shade * (QUIET_RGB[0] + (LIVE_RGB[0] - QUIET_RGB[0]) * f);
      colors[idx * 4 + 1] = shade * (QUIET_RGB[1] + (LIVE_RGB[1] - QUIET_RGB[1]) * f);
      colors[idx * 4 + 2] = shade * (QUIET_RGB[2] + (LIVE_RGB[2] - QUIET_RGB[2]) * f);

      const opaque = M3.opacity + (M3.eruptingOpacity - M3.opacity) * f;
      const rise = h - localBase[idx];
      const foot = Math.max(localPeak[idx] * R.softBase, 1e-6);
      /* ==> TWO RAMPS, AND THEY RAMP ON DIFFERENT THINGS ON PURPOSE. <==
       * `softBase` ramps on HEIGHT, so the surface emerges from the map rather
       * than being cut out of it. `edgeFade` ramps on RADIUS, and it is there
       * to hide a defect: the mesh is trimmed at whole grid cells, so a
       * footprint's true edge is a staircase, reported on glass as a dashed
       * stair-stepped fringe. The height ramp did not hide it because one cell
       * in from the rim a tall cone already stands clearly visible. */
      colors[idx * 4 + 3] =
        opaque * smoothstep01(rise / foot) * smoothstep01(inset[idx] / R.edgeFade);
    }
  }

  /* ---- faces, trimmed at the footprint edge ------------------------------ */

  /* ==> QUADS WITH NOTHING IN THEM ARE NOT EMITTED, AND THAT IS NOT AN
   * OPTIMISATION. <== It is what makes the mesh END at the footprint, where
   * the alpha ramp has reached zero. Emitting the flat ground outside every
   * volcano would put a large fully-transparent sheet over the basemap that
   * still writes depth (§42.1.4b's depth pass), and a transparent sheet that
   * occludes is the worst of both. */
  const indices = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d2 = c + 1;
      if (!covered[a] && !covered[b] && !covered[c] && !covered[d2]) continue;
      indices.push(a, c, b, b, c, d2);
    }
  }

  return {
    lon: lon0,
    lat: lat0,
    positions,
    colors,
    indices,
    /** ==> KEPT SO THE SEA CAN BE REBUILT WITHOUT THE MOUNTAIN. <== The
     *  coastline the sea is cut against is tile state and changes as the map
     *  pans, while the heightfield never does. Rebuilding a whole cluster to
     *  move a shoreline would put a 130–290 ms build on the pan path for no
     *  reason. `proto/volcano-3d.js` holds these and calls `buildWater` again
     *  on its own. */
    subs: local.filter((m) => m.submarine),
    water: buildWater(local.filter((m) => m.submarine), lon0, lat0, landMask),
    peak,
    extent: Math.max(width, depth),
    members: cluster.length,
  };
}

/**
 * Every drawable volcano, gathered and sampled. The one call a renderer makes.
 *
 * @param {object[]} marks already filtered to edifices by the caller
 * @param {object} [landMask] from `lib/land-mask.js`, so the sea sheets stop
 *   at the shore. Omitted means the coastline is UNKNOWN rather than absent —
 *   `lib/volcano-water.js` states what that falls back to and why.
 * @returns {object[]} ridges from `buildRidge`
 */
export function buildRidges(marks, landMask) {
  const members = (marks || []).map(ridgeMember);
  return clusterMembers(members)
    .map((cluster) => buildRidge(cluster, landMask))
    .filter(Boolean);
}
