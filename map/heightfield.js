/**
 * heightfield.js — the geodesic cage, its storm-severity elevation, and its
 * storm-severity COLOR.
 *
 * This owns the cage's GEOMETRY and how it deforms: an icosphere of nodes
 * joined by edges, each node lifted above the globe by the severity of the
 * nearest storm (SPEC §9 — "severity read as node elevation, the cage peaks
 * over storms"). globe3d.js wraps the geometries this produces in Three
 * materials and adds them to the scene; it does not know how they move.
 *
 * ELEVATION AND COLOR ARE ONE SIGNAL. Each node holds a single 0..1 lift from
 * the nearest storm. That number raises the node AND blends its color from the
 * resting cyan toward that storm's category color. They read from the same
 * array, so a tall node is always a colored node — they cannot drift apart.
 *
 * The soft edge falloff is free: the cage is LineSegments with a per-vertex
 * color attribute, so the GPU interpolates along every segment. An edge from an
 * unaffected node (cyan) to a lifted node (category color) renders as a smooth
 * gradient with no shader and no extra draw call.
 *
 * The storm INPUT is a seam: `setStormPoints(state, pts)`. It is fed by
 * main.js from the Phase 2 data store (one weighted point per storm at its
 * current fix, carrying its category color). The full-track comet-tail later
 * feeds the SAME seam and neither the elevation nor the color code changes
 * (SPEC §15 item 3: data plumbing, not a rewrite — the tail is just more
 * points).
 *
 * `THREE` is a CDN global. Imports: config/ only.
 */

import { DIVE } from '../config/constants.js';
import { DARK } from '../config/tokens.js';

/* ---------------------------------------------------------------------------
 * Icosphere — a geodesic sphere by recursive triangle subdivision. Returns the
 * unit-vector vertices and the deduped edge list (the cage is the edges).
 * ------------------------------------------------------------------------- */
function icosphere(detail) {
  const t = (1 + Math.sqrt(5)) / 2;
  const base = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const verts = base.map((v) => new THREE.Vector3(v[0], v[1], v[2]).normalize());
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const cache = {};
  const mid = (a, b) => {
    const k = a < b ? a + '_' + b : b + '_' + a;
    if (cache[k] != null) return cache[k];
    verts.push(verts[a].clone().add(verts[b]).normalize());
    cache[k] = verts.length - 1;
    return cache[k];
  };
  for (let d = 0; d < detail; d++) {
    const nf = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = nf;
  }
  const seen = {};
  const edges = [];
  for (const f of faces) {
    const pairs = [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]];
    for (const [i, j] of pairs) {
      const k = i < j ? i + '_' + j : j + '_' + i;
      if (!seen[k]) {
        seen[k] = 1;
        edges.push([i, j]);
      }
    }
  }
  return { verts, edges };
}

/** Deterministic per-vertex jitter, so a storm-free cage has faint organic
 *  unevenness instead of reading as a dead-flat wireframe. Hash, not random —
 *  the same planet every load. */
const frac = (x) => x - Math.floor(x);

/** Wind (KNOTS — the app's storage unit, SPEC §8) → a 0..1 lift. Mirrors
 *  CATEGORY_THRESHOLD_KT: TS force is the floor, Cat 5 is full lift, and a
 *  small minimum keeps even a weak storm reading as a bump. Unknown wind gets
 *  the minimum — a storm with no intensity still exists. Visual ramp for the
 *  cage — NOT a category. */
export function sevFromKt(kt) {
  if (kt == null || !isFinite(kt)) return DIVE.sevMinLift;
  const t = Math.max(0, Math.min(1, (kt - DIVE.sevFloorKt) / (DIVE.sevPeakKt - DIVE.sevFloorKt)));
  /* Perceptual curve + floor (see DIVE.sevCurve rationale): every real storm
   * clears the cage's noise floor; ordering is preserved. */
  return DIVE.sevMinLift + (1 - DIVE.sevMinLift) * Math.pow(t, DIVE.sevCurve);
}

/**
 * Builds the cage/node geometry and the elevation engine that drives it.
 *
 * @returns {{
 *   cageGeometry: THREE.BufferGeometry,   // LineSegments — edges, pos + color
 *   nodeGeometry: THREE.BufferGeometry,   // Points — the glowing LEDs
 *   nodeCount: number,
 *   setStormPoints: (state: string, pts: Array<{dir: THREE.Vector3, sev: number, color: string}>) => void,
 *   tick: (dtFrames: number) => void,     // ease heights toward target each frame
 *   onState: (cb: (state: string) => void) => void,   // for material recolor
 *   getState: () => string,
 * }}
 */
export function createHeightfield() {
  const ico = icosphere(DIVE.geoDetail);
  const N = ico.verts.length;

  const baseLump = ico.verts.map(
    (v) =>
      (frac(Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453) *
        2 -
        1) *
      DIVE.baseLump
  );

  /** Weighted storm points: {dir: unit Vector3, sev: 0..1, color: '#rrggbb'}.
   *  One per storm today (current fix); the whole track later, SAME code. */
  let stormPoints = [];
  const curLift = new Array(N).fill(0); // animated toward target
  const tgtLift = new Array(N).fill(0); // recomputed whenever storms change
  let state = 'loading';
  let stateCb = null;

  /* Color channel. `restColor` is the calm cage; `tgtColor[i]` is the color the
   * winning storm pulls node i toward. A node with zero lift renders as
   * restColor regardless of what tgtColor holds, so a storm moving away fades
   * its tint out through the SAME ease as its height. */
  const mutedColor = new THREE.Color(DARK.meshMuted);
  const mutedNodeColor = new THREE.Color(DARK.nodeMuted);
  const tgtColor = ico.verts.map(() => new THREE.Color(DARK.mesh));
  const scratch = new THREE.Color();

  /** Nearest-storm influence at a direction: how much it lifts, and WHICH storm
   *  won. The winner owns the node's color as well as its height — one storm,
   *  one node, no blending between two storms' categories (a node halfway
   *  between a Cat 1 and a Cat 5 must not invent an orange that means nothing). */
  const influenceAt = (v) => {
    let m = 0;
    let winner = null;
    for (const sp of stormPoints) {
      const d = v.angleTo(sp.dir);
      const f = Math.exp(-(d * d) / (2 * DIVE.stormSigma * DIVE.stormSigma));
      const c = sp.sev * f;
      if (c > m) {
        m = c;
        winner = sp;
      }
    }
    return { lift: m, winner };
  };

  const nodeVec = (i) =>
    ico.verts[i]
      .clone()
      .multiplyScalar(DIVE.cageRadius * (1 + baseLump[i] + DIVE.stormAmp * curLift[i]));

  /* Storm glyph sprites on the globe surface (SPEC §9 planet band: the two-arm
   * spiral in its category color, matching MapLibre). SPLIT BY HEMISPHERE
   * because the spiral's rotation flips at the equator and a Points material
   * carries exactly one texture — two geometries, two textures, same everything
   * else. Each carries a COLOR attribute so a mixed-severity basin renders in
   * one draw call per hemisphere instead of one Points object per storm.
   * Rebuilt on every setStormPoints — storm counts are tiny (~15 peak). */
  const stormDotGeometryN = new THREE.BufferGeometry();
  const stormDotGeometryS = new THREE.BufferGeometry();
  for (const geo of [stormDotGeometryN, stormDotGeometryS]) {
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
  }

  function rebuildStormDots() {
    /* An outage holds the last SHAPE but must never show live category color —
     * a stale red glyph reads as a confirmed Cat 4 that nobody confirmed
     * (SPEC §5). Grey is the honest color for "we don't know right now." */
    const outage = state === 'unavailable';
    for (const [geo, wantNorth] of [[stormDotGeometryN, true], [stormDotGeometryS, false]]) {
      const pts = stormPoints.filter((p) => (p.dir.y >= 0) === wantNorth);
      const arr = new Float32Array(pts.length * 3);
      const col = new Float32Array(pts.length * 3);
      for (let i = 0; i < pts.length; i++) {
        const d = pts[i].dir;
        arr[i * 3] = d.x * DIVE.stormDotRadius;
        arr[i * 3 + 1] = d.y * DIVE.stormDotRadius;
        arr[i * 3 + 2] = d.z * DIVE.stormDotRadius;
        scratch.set(outage ? DARK.stormPlanetDot : pts[i].color || DARK.stormPlanetDot);
        col[i * 3] = scratch.r;
        col[i * 3 + 1] = scratch.g;
        col[i * 3 + 2] = scratch.b;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.computeBoundingSphere();
    }
  }

  /* Geometry: one node per vertex, one line segment (two endpoints) per edge.
   * Each carries a parallel COLOR buffer. On the cage every segment gets its two
   * endpoints' colors and the GPU fades between them — that interpolation is
   * the soft storm-color falloff, and it costs nothing. */
  const nodePos = new Float32Array(N * 3);
  const nodeCol = new Float32Array(N * 3);
  const edgePos = new Float32Array(ico.edges.length * 6);
  const edgeCol = new Float32Array(ico.edges.length * 6);
  const nodeGeometry = new THREE.BufferGeometry();
  nodeGeometry.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
  nodeGeometry.setAttribute('color', new THREE.BufferAttribute(nodeCol, 3));
  const cageGeometry = new THREE.BufferGeometry();
  cageGeometry.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
  cageGeometry.setAttribute('color', new THREE.BufferAttribute(edgeCol, 3));

  const dv = ico.verts.map((_, i) => nodeVec(i));
  /* Per-node resolved colors, recomputed each settle frame alongside position.
   * Two arrays because cage edges and nodes rest at different brightnesses but
   * arrive at the SAME category color at full lift. */
  const dcCage = ico.verts.map(() => new THREE.Color());
  const dcNode = ico.verts.map(() => new THREE.Color());

  /* Pre-dimmed resting colors. The calm lattice is pushed toward the background
   * so the storm-colored peaks are the only fully-lit thing on the globe. Done
   * on the COLOR, not the material opacity, because opacity is uniform across
   * the draw call and would dim the peaks equally — defeating the point. */
  const restDim = new THREE.Color(DARK.mesh).multiplyScalar(DARK.meshRestDim);
  const restNodeDim = new THREE.Color(DARK.node).multiplyScalar(DARK.meshRestDim);

  /** Smooth 0..1 ramp with zero derivative at both ends — no visible seam where
   *  the fade band meets flat cyan or full storm color. */
  const smoothstep = (x, a, b) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  /** Resolve node i's color from its CURRENT (animated) lift. Blending from the
   *  rest color means the tint eases in and out with the height automatically —
   *  there is no separate color animation to keep in sync. During an outage the
   *  muted greys stand in for both ends, so a held shape can't show live color.
   *
   *  The lift is remapped through a THRESHOLD BAND, not a curve: below
   *  `stormColorOnset` the node is pure (dimmed) cyan, above `stormColorFull` it
   *  is the storm's exact category color, and the gradient exists only between.
   *  That keeps the whole raised region saturated and confines the fade to about
   *  one ring of nodes at its outer edge, instead of smearing tint across flat
   *  lattice the storm never lifted. */
  function resolveColor(i) {
    if (state === 'unavailable') {
      dcCage[i].copy(mutedColor);
      dcNode[i].copy(mutedNodeColor);
      return;
    }
    const t =
      smoothstep(curLift[i], DIVE.stormColorOnset, DIVE.stormColorFull) *
      DARK.meshStormMix;
    scratch.copy(tgtColor[i]);
    dcCage[i].copy(restDim).lerp(scratch, t);
    dcNode[i].copy(restNodeDim).lerp(scratch, t);
  }

  function rebuildMesh() {
    for (let i = 0; i < N; i++) {
      dv[i] = nodeVec(i);
      resolveColor(i);
    }
    for (let n = 0; n < N; n++) {
      nodePos[n * 3] = dv[n].x;
      nodePos[n * 3 + 1] = dv[n].y;
      nodePos[n * 3 + 2] = dv[n].z;
      nodeCol[n * 3] = dcNode[n].r;
      nodeCol[n * 3 + 1] = dcNode[n].g;
      nodeCol[n * 3 + 2] = dcNode[n].b;
    }
    nodeGeometry.attributes.position.needsUpdate = true;
    nodeGeometry.attributes.color.needsUpdate = true;
    for (let k = 0; k < ico.edges.length; k++) {
      const ia = ico.edges[k][0];
      const ib = ico.edges[k][1];
      const a = dv[ia];
      const b = dv[ib];
      edgePos[k * 6] = a.x;
      edgePos[k * 6 + 1] = a.y;
      edgePos[k * 6 + 2] = a.z;
      edgePos[k * 6 + 3] = b.x;
      edgePos[k * 6 + 4] = b.y;
      edgePos[k * 6 + 5] = b.z;
      /* The two endpoint colors. Everything between them is the GPU's linear
       * interpolation — the storm color bleeding out along the lattice instead
       * of stopping at a hard edge. */
      const ca = dcCage[ia];
      const cb = dcCage[ib];
      edgeCol[k * 6] = ca.r;
      edgeCol[k * 6 + 1] = ca.g;
      edgeCol[k * 6 + 2] = ca.b;
      edgeCol[k * 6 + 3] = cb.r;
      edgeCol[k * 6 + 4] = cb.g;
      edgeCol[k * 6 + 5] = cb.b;
    }
    cageGeometry.attributes.position.needsUpdate = true;
    cageGeometry.attributes.color.needsUpdate = true;
  }
  rebuildMesh(); // fill the buffers at the base (storm-free) shape

  const recomputeTarget = () => {
    for (let i = 0; i < N; i++) {
      const { lift, winner } = influenceAt(ico.verts[i]);
      tgtLift[i] = lift;
      /* Hold the last color when no storm wins: the node's lift is easing to 0
       * anyway, so it fades to rest through the height ease. Overwriting to
       * cyan here would snap the tint off a node that is still visibly tall. */
      if (winner && winner.color) tgtColor[i].set(winner.color);
    }
  };

  function tick(dtFrames) {
    let moving = false;
    for (let i = 0; i < N; i++) {
      const d = tgtLift[i] - curLift[i];
      if (Math.abs(d) > 1e-4) {
        curLift[i] += d * Math.min(1, DIVE.liftEase * dtFrames);
        moving = true;
      }
    }
    if (moving) rebuildMesh();
    return moving; // caller keeps requesting frames while the cage is settling
  }

  function setStormPoints(nextState, pts) {
    const prev = state;
    state = nextState;
    if (nextState === 'ok' || nextState === 'clear') {
      stormPoints = pts || [];
      recomputeTarget();
      rebuildStormDots();
    }
    /* On 'unavailable' we HOLD the last shape (do not recompute to flat) — a
     * quiet globe during an outage must never read as a confident all-clear
     * (SPEC §5). But the COLOR must drop to muted grey immediately, or a held
     * peak keeps showing a category color the feed can no longer vouch for.
     * Crossing INTO or OUT OF an outage repaints both channels at the current
     * heights; the shape itself is untouched. */
    if (prev !== state && (prev === 'unavailable' || state === 'unavailable')) {
      rebuildMesh();
      rebuildStormDots();
    }
    if (stateCb) stateCb(state);
  }

  return {
    cageGeometry,
    nodeGeometry,
    stormDotGeometryN,
    stormDotGeometryS,
    nodeCount: N,
    setStormPoints,
    tick,
    onState: (cb) => {
      stateCb = cb;
    },
    getState: () => state,
  };
}
