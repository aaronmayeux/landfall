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
 * THE FILL IS THE THIRD READER OF THAT SAME ONE SIGNAL. Every cage triangle
 * with at least one storm-lit corner carries a low wash of the storm's color
 * (SPEC §9). It shares the nodes' POSITION BUFFER OUTRIGHT — not a copy — so it
 * is not a flat patch painted on the globe, it is the lattice's own surface,
 * tenting up over a storm with the very nodes that carry it. There is nothing
 * to keep in sync because there is only one buffer.
 *
 * The fill's alpha rides the same interpolation trick as the edges: a triangle
 * with one lit corner and two dark ones fades to nothing across itself. Filling
 * whole triangles at a flat opacity instead would ring every storm with a
 * jagged triangular fringe — the exact hard edge the color band exists to avoid.
 *
 * The storm INPUT is a seam: `setStormPoints(state, pts)`, fed by main.js from
 * map/storm-mesh.js. In `current` mode that is one weighted point per storm at
 * its live fix. In `track` mode it is the storm's past and forecast positions
 * too, each at its own intensity — and the promise this file made when the
 * seam was designed held: the elevation and color code did not change. Only
 * two things did, both recorded at their call sites: every point now carries a
 * `head` flag so the surface GLYPHS stay one-per-storm, and the influence loop
 * rejects distant points on a dot product because the list got twenty times
 * longer.
 *
 * `THREE` is a CDN global. Imports: config/ only.
 */

import { DIVE } from '../config/constants.js';
import { palette } from '../config/theme.js';

/* ---------------------------------------------------------------------------
 * Icosphere — a geodesic sphere by recursive triangle subdivision. Returns the
 * unit-vector vertices, the deduped edge list (the cage is the edges), and the
 * faces those edges were derived FROM (the storm-lit fill is the faces).
 *
 * The faces were always built here — deriving the edge list is the only reason
 * this function subdivides at all — and were simply dropped on the way out
 * until the fill needed them. Winding is outward on all 20 base faces and the
 * subdivision preserves it, which is what lets the fill render FrontSide.
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
  return { verts, edges, faces };
}

/** Deterministic per-vertex jitter, so a storm-free cage has faint organic
 *  unevenness instead of reading as a dead-flat wireframe. Hash, not random —
 *  the same planet every load. */
const frac = (x) => x - Math.floor(x);

/** Cosine of the influence cutoff angle. DERIVED from the sigma and the
 *  cutoff count, never hand-typed (§12: the constants file holds sources,
 *  anything downstream is arithmetic on them) — so widening `stormSigma`
 *  widens the reject radius with it and the two cannot drift apart. */
const COS_CUTOFF = Math.cos(DIVE.influenceCutoffSigma * DIVE.stormSigma);

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
 *   fillGeometry: THREE.BufferGeometry,   // Mesh — storm-lit triangles, RGBA
 *                                         //   colors, SHARES nodeGeometry's
 *                                         //   position attribute
 *   nodeCount: number,
 *   setStormPoints: (state: string, pts: Array<{dir: THREE.Vector3, sev: number, color: string, head?: boolean}>) => void,
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

  /** Weighted storm points:
   *  {dir: unit Vector3, sev: 0..1, color: '#rrggbb', head: boolean}.
   *  One per storm in `current` mode; the whole track in `track` mode. `head`
   *  marks the live fix — the only point that draws a surface glyph. */
  let stormPoints = [];
  const curLift = new Array(N).fill(0); // animated toward target
  const tgtLift = new Array(N).fill(0); // recomputed whenever storms change
  let state = 'loading';
  let stateCb = null;

  /* Color channel. `restColor` is the calm cage; `tgtColor[i]` is the color the
   * winning storm pulls node i toward. A node with zero lift renders as
   * restColor regardless of what tgtColor holds, so a storm moving away fades
   * its tint out through the SAME ease as its height. */
  const mutedColor = new THREE.Color(palette().meshMuted);
  const mutedNodeColor = new THREE.Color(palette().nodeMuted);
  const tgtColor = ico.verts.map(() => new THREE.Color(palette().mesh));
  /* The cage colour a node holds when NO storm has ever claimed it. Kept as a
   * value rather than re-read, because `retheme()` needs to tell an unclaimed
   * node from one holding a real §6 category colour — the first should follow
   * the theme, the second must not be touched. */
  let unclaimedTint = new THREE.Color(palette().mesh);
  const scratch = new THREE.Color();

  /** Nearest-storm influence at a direction: how much it lifts, and WHICH storm
   *  won. The winner owns the node's color as well as its height — one storm,
   *  one node, no blending between two storms' categories (a node halfway
   *  between a Cat 1 and a Cat 5 must not invent an orange that means nothing). */
  const influenceAt = (v) => {
    let m = 0;
    let winner = null;
    for (const sp of stormPoints) {
      /* CHEAP REJECT FIRST. `angleTo` is a dot product followed by an `acos`,
       * and `acos` is the expensive half. Beyond the cutoff the Gaussian
       * evaluates to less than the cage's own base unevenness, so the answer
       * is "nothing" and we can reach it with three multiplies.
       *
       * This existed as pure headroom when the list held one point per storm.
       * Following whole tracks multiplies the point count by ~20 and every
       * node was measuring its angle to every position on the planet,
       * including storms in the other hemisphere. */
      const dot = v.x * sp.dir.x + v.y * sp.dir.y + v.z * sp.dir.z;
      if (dot < COS_CUTOFF) continue;
      const d = Math.acos(dot > 1 ? 1 : dot);
      const f = Math.exp(-(d * d) / (2 * DIVE.stormSigma * DIVE.stormSigma));
      const c = sp.sev * f;
      /* STRICTLY greater, so on an exact tie the FIRST point entered wins.
       * map/storm-mesh.js enters each storm's live fix ahead of its track
       * beads for exactly this reason — a forecast point at tau 0 can tie the
       * head, and the winner owns the node's color. */
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
      /* HEAD POINTS ONLY. Every point in the list lifts and tints the cage,
       * but only a storm's LIVE FIX draws a glyph on the surface. When the
       * cage follows whole tracks (map/storm-mesh.js) the list carries ~20
       * positions per storm, and stamping a spiral on each would draw one
       * storm as twenty — not a cosmetic problem but a false count of live
       * systems, which is the §5 failure wearing a symbol.
       *
       * The filter is on an EXPLICIT flag rather than on position or index,
       * so the ridge can grow, thin, or reorder without ever changing how
       * many glyphs appear.
       *
       * Tested `!== false`, not truthy: a caller that omits the flag entirely
       * gets the old behaviour (every point draws) rather than a globe with
       * no storm glyphs at all. A missing flag must not silently erase the
       * storms. */
      const pts = stormPoints.filter((p) => p.head !== false && (p.dir.y >= 0) === wantNorth);
      const arr = new Float32Array(pts.length * 3);
      const col = new Float32Array(pts.length * 3);
      for (let i = 0; i < pts.length; i++) {
        const d = pts[i].dir;
        arr[i * 3] = d.x * DIVE.stormDotRadius;
        arr[i * 3 + 1] = d.y * DIVE.stormDotRadius;
        arr[i * 3 + 2] = d.z * DIVE.stormDotRadius;
        const planetDot = palette().stormPlanetDot;
        scratch.set(outage ? planetDot : pts[i].color || planetDot);
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

  /* The storm-lit fill. THE SAME position attribute object the nodes ride —
   * assigned, not copied — indexed into the icosphere's triangles. One upload
   * serves both geometries, and the fill deforms with the lift for free.
   *
   * FOUR-component color, because this one needs alpha. Three.js turns
   * per-vertex alpha on automatically when the color attribute carries 4 values
   * instead of 3 (confirmed against the pinned r128 source — it keys on
   * `attributes.color.itemSize === 4`, nothing to declare).
   *
   * The index is built ONCE and never rebuilt. Storms moving rewrites colors
   * and alphas; which triangles exist never changes, because an unlit triangle
   * is not absent, it is transparent.
   *
   * The bounding sphere is pinned to the worst case a node can ever reach
   * rather than recomputed each settle frame: lift is large enough (cageRadius
   * through stormAmp) that a stale auto-computed sphere could frustum-cull the
   * fill at the limb mid-storm. Fixed, correct, and free. */
  const fillCol = new Float32Array(N * 4);
  const fillIdx = new Uint16Array(ico.faces.length * 3);
  for (let f = 0; f < ico.faces.length; f++) {
    fillIdx[f * 3] = ico.faces[f][0];
    fillIdx[f * 3 + 1] = ico.faces[f][1];
    fillIdx[f * 3 + 2] = ico.faces[f][2];
  }
  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute('position', nodeGeometry.attributes.position);
  fillGeometry.setAttribute('color', new THREE.BufferAttribute(fillCol, 4));
  fillGeometry.setIndex(new THREE.BufferAttribute(fillIdx, 1));
  fillGeometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, 0, 0),
    DIVE.cageRadius * (1 + DIVE.baseLump + DIVE.stormAmp)
  );

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
  const restDim = new THREE.Color(palette().mesh).multiplyScalar(palette().meshRestDim);
  const restNodeDim = new THREE.Color(palette().node).multiplyScalar(palette().meshRestDim);

  /** THE INK A STORM COLOUR IS PUSHED TOWARD IN THE LIGHT THEME, AND HOW FAR.
   *
   *  `geo.glyphHalo` rather than a black of its own: that token is already the
   *  app's answer to "what colour separates a severity fill from a pale
   *  background", it is the ink the glyph and the forecast dot are outlined in,
   *  and reusing it means a storm's cage peak, its glyph outline and its dot
   *  ring are all pointed at the same darkness. A second near-black here would
   *  be a §12 duplicate that drifts.
   *
   *  `deepen` is 0 in dark, so `deepInk` is mixed at zero strength and the dark
   *  theme's arithmetic is bit-for-bit what it was. */
  const deepInk = new THREE.Color(palette().geo.glyphHalo);
  let deepen = palette().meshStormDeepen;

  /** Smooth 0..1 ramp with zero derivative at both ends — no visible seam where
   *  the fade band meets flat cyan or full storm color. */
  const smoothstep = (x, a, b) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  /** HOW LIT node i is, 0..1: nothing below the color onset, everything at full
   *  storm color. ONE definition, read by the cage tint, the node tint, and the
   *  fill alpha — so "which nodes belong to a storm" cannot be answered two
   *  different ways by two different layers. If a node is tinted, its triangles
   *  fill; if it isn't, they don't. Extracted the moment the fill became the
   *  second caller (SPEC §12 — any pattern used twice gets extracted). */
  const litAmount = (i) => smoothstep(curLift[i], DIVE.stormColorOnset, DIVE.stormColorFull);

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
    const t = litAmount(i) * palette().meshStormMix;
    scratch.copy(tgtColor[i]);
    /* DEEPEN BEFORE THE LERP, NOT AFTER. Applied to the TARGET, the resting
     * grey end of the ramp is untouched and only the storm end moves — which is
     * the whole intent. Applied to the RESULT it would drag the calm cage
     * toward ink too, and the light theme would gain a dirty lattice everywhere
     * no storm is. Zero-cost in dark, where `deepen` is 0. */
    if (deepen > 0) scratch.lerp(deepInk, deepen);
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
      /* Fill takes the CAGE's resolved color, not the node's — the wash lies
       * inside the lines that bound it and must never out-saturate them. Its
       * alpha is the raw lit ramp, so a corner no storm reached contributes
       * nothing and the fill dies out exactly where the tint does. Outage grey
       * arrives here automatically: dcCage is already muted by resolveColor,
       * while the alpha keeps the held shape visible (SPEC §5 — hold the shape,
       * drop the color). */
      fillCol[n * 4] = dcCage[n].r;
      fillCol[n * 4 + 1] = dcCage[n].g;
      fillCol[n * 4 + 2] = dcCage[n].b;
      fillCol[n * 4 + 3] = litAmount(n);
    }
    nodeGeometry.attributes.position.needsUpdate = true;
    nodeGeometry.attributes.color.needsUpdate = true;
    fillGeometry.attributes.color.needsUpdate = true;
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

  /**
   * Re-read every cached colour after a theme change, then repaint.
   *
   * The cage's colours are THREE.Color OBJECTS built once and mutated per
   * frame — that is the whole reason the settle loop is cheap — so unlike the
   * MapLibre layers, which are rebuilt wholesale by setStyle, these have to be
   * told. A theme change is a rare, user-initiated event; a full rebuild of
   * ~7,680 edges is a single frame's work and is the honest thing to do.
   *
   * A node holding a REAL storm's category colour keeps it: §6 colours do not
   * change with the theme, and overwriting them here would drop the tint off
   * every lit peak until the next 30-minute poll landed.
   */
  function retheme() {
    const P = palette();
    mutedColor.set(P.meshMuted);
    mutedNodeColor.set(P.nodeMuted);
    restDim.set(P.mesh).multiplyScalar(P.meshRestDim);
    restNodeDim.set(P.node).multiplyScalar(P.meshRestDim);
    deepInk.set(P.geo.glyphHalo);
    deepen = P.meshStormDeepen;

    const wasUnclaimed = unclaimedTint.getHex();
    for (const c of tgtColor) {
      if (c.getHex() === wasUnclaimed) c.set(P.mesh);
    }
    unclaimedTint = new THREE.Color(P.mesh);

    rebuildMesh();
    rebuildStormDots();
  }

  return {
    cageGeometry,
    nodeGeometry,
    fillGeometry,
    stormDotGeometryN,
    stormDotGeometryS,
    nodeCount: N,
    setStormPoints,
    tick,
    retheme,
    onState: (cb) => {
      stateCb = cb;
    },
    getState: () => state,
  };
}
