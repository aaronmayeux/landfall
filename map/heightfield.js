/**
 * heightfield.js — the geodesic cage and its storm-severity elevation.
 *
 * This owns the amber network's GEOMETRY and how it deforms: an icosphere of
 * nodes joined by edges, each node lifted above the globe by the severity of
 * the nearest storm (SPEC §9 — "severity read as node elevation, the cage
 * peaks over storms"). globe3d.js wraps the two geometries this produces in
 * Three materials and adds them to the scene; it does not know how they move.
 *
 * The storm INPUT is a seam: `setStormPoints(state, pts)`. Today the only
 * source is `attachGdacsSeverity()` at the bottom of this file — a direct
 * GDACS fetch of the current fix, no relay. When Phase 2 builds the real data
 * layer (NHC-grade intensity, full track), it feeds the SAME seam and the
 * elevation code does not change (SPEC §15 item 3: this is data plumbing, not
 * a rewrite — the full comet-tail is just more points).
 *
 * `THREE` is a CDN global. Imports: config/ and lib/ only.
 */

import { DIVE } from '../config/constants.js';
import { POLL } from '../config/constants.js';
import { ENDPOINT } from '../config/constants.js';
import { lonLatToVec3 } from '../lib/geo.js';

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

/** Wind (km/h, GDACS `severity`) → a 0..1 lift. Mirrors CATEGORY_THRESHOLD_KT:
 *  TS force is the floor, Cat 5 is full lift, and a small minimum keeps even a
 *  weak storm reading as a bump. Visual ramp for the cage — NOT a category. */
function sevFromKmh(kmh) {
  const kt = kmh / 1.852;
  const t = (kt - DIVE.sevFloorKt) / (DIVE.sevPeakKt - DIVE.sevFloorKt);
  return Math.max(DIVE.sevMinLift, Math.min(1, t));
}

/**
 * Builds the cage/node geometry and the elevation engine that drives it.
 *
 * @returns {{
 *   cageGeometry: THREE.BufferGeometry,   // LineSegments — the amber edges
 *   nodeGeometry: THREE.BufferGeometry,   // Points — the glowing LEDs
 *   nodeCount: number,
 *   setStormPoints: (state: string, pts: Array<{dir: THREE.Vector3, sev: number}>) => void,
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

  /** Weighted storm points: {dir: unit Vector3, sev: 0..1}. One per storm today
   *  (current fix); the whole track later, SAME code. */
  let stormPoints = [];
  const curLift = new Array(N).fill(0); // animated toward target
  const tgtLift = new Array(N).fill(0); // recomputed whenever storms change
  let state = 'loading';
  let stateCb = null;

  const liftAt = (v) => {
    let m = 0;
    for (const sp of stormPoints) {
      const d = v.angleTo(sp.dir);
      const f = Math.exp(-(d * d) / (2 * DIVE.stormSigma * DIVE.stormSigma));
      const c = sp.sev * f;
      if (c > m) m = c;
    }
    return m;
  };

  const nodeVec = (i) =>
    ico.verts[i]
      .clone()
      .multiplyScalar(DIVE.cageRadius * (1 + baseLump[i] + DIVE.stormAmp * curLift[i]));

  /* Geometry: one node per vertex, one line segment (two endpoints) per edge. */
  const nodePos = new Float32Array(N * 3);
  const edgePos = new Float32Array(ico.edges.length * 6);
  const nodeGeometry = new THREE.BufferGeometry();
  nodeGeometry.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
  const cageGeometry = new THREE.BufferGeometry();
  cageGeometry.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));

  const dv = ico.verts.map((_, i) => nodeVec(i));

  function rebuildMesh() {
    for (let i = 0; i < N; i++) dv[i] = nodeVec(i);
    for (let n = 0; n < N; n++) {
      nodePos[n * 3] = dv[n].x;
      nodePos[n * 3 + 1] = dv[n].y;
      nodePos[n * 3 + 2] = dv[n].z;
    }
    nodeGeometry.attributes.position.needsUpdate = true;
    for (let k = 0; k < ico.edges.length; k++) {
      const a = dv[ico.edges[k][0]];
      const b = dv[ico.edges[k][1]];
      edgePos[k * 6] = a.x;
      edgePos[k * 6 + 1] = a.y;
      edgePos[k * 6 + 2] = a.z;
      edgePos[k * 6 + 3] = b.x;
      edgePos[k * 6 + 4] = b.y;
      edgePos[k * 6 + 5] = b.z;
    }
    cageGeometry.attributes.position.needsUpdate = true;
  }
  rebuildMesh(); // fill the buffers at the base (storm-free) shape

  const recomputeTarget = () => {
    for (let i = 0; i < N; i++) tgtLift[i] = liftAt(ico.verts[i]);
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
    state = nextState;
    if (nextState === 'ok' || nextState === 'clear') {
      stormPoints = pts || [];
      recomputeTarget();
    }
    /* On 'unavailable' we HOLD the last shape (do not recompute to flat) — a
     * quiet globe during an outage must never read as a confident all-clear
     * (SPEC §5). globe3d desaturates the cage on this state instead. */
    if (stateCb) stateCb(state);
  }

  return {
    cageGeometry,
    nodeGeometry,
    nodeCount: N,
    setStormPoints,
    tick,
    onState: (cb) => {
      stateCb = cb;
    },
    getState: () => state,
    _sevFromKmh: sevFromKmh, // exposed for the data seam below
  };
}

/* ---------------------------------------------------------------------------
 * TEMPORARY DATA SOURCE — GDACS current-fix severity, direct fetch, no relay.
 *
 * This is the seam's stand-in until Phase 2's data layer exists. It is the ONE
 * place that knows about GDACS; everything above is source-agnostic. Polls only
 * while the page is visible (SPEC §4: no background work). Returns a detach fn.
 * ------------------------------------------------------------------------- */
export function attachGdacsSeverity(hf) {
  let timer = null;

  async function fetchStorms() {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const r = await fetch(ENDPOINT.gdacsEventList, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const feats = (j && j.features) || [];
      const pts = [];
      for (const feat of feats) {
        const pr = feat.properties || {};
        if ((pr.eventtype || '') !== 'TC') continue;
        const g = feat.geometry || {};
        const c = g.coordinates || [pr.longitude, pr.latitude];
        const sd = pr.severitydata || {};
        const sev = +sd.severity || 0;
        if (c && c.length >= 2 && isFinite(+c[0]) && isFinite(+c[1])) {
          pts.push({
            dir: lonLatToVec3(+c[0], +c[1], 1).normalize(),
            sev: hf._sevFromKmh(sev),
          });
        }
      }
      hf.setStormPoints(pts.length ? 'ok' : 'clear', pts);
    } catch (e) {
      console.warn('[landfall] storm severity feed unavailable:', e.message);
      hf.setStormPoints('unavailable', null);
    }
  }

  fetchStorms();
  timer = setInterval(fetchStorms, POLL.storms);
  const onVisible = () => {
    if (!document.hidden) fetchStorms();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
