/**
 * world-sky.js — the clear globe with the geodesic cage. This is Landfall today.
 *
 * PROTOTYPE CODE. Not wired into the app. Lifted from proto-globe.html so the
 * world switcher has a real second globe to switch to, with the inline coastline
 * blob swapped out for the shipped map/coastline.js.
 *
 * It also consumes the SAME ripple field as the dot world, but draws it a
 * completely different way — cage nodes rise and brighten instead of dots. That
 * is the portability claim being demonstrated rather than asserted: the wave is
 * data, and each world decides what a wave looks like.
 *
 * `THREE` is a CDN global.
 * Imports: map/coastline.js, config/constants.js and lib/geo.js.
 */

import { RINGS } from '../map/coastline.js';
import { DIVE } from '../config/constants.js';
import { smoothstep } from '../lib/geo.js';

export const SKY = {
  cageRadius: 1.065,
  cageDetail: 3,
  /** How lumpy the resting cage is. */
  restAmplitude: 0.05,
  /** How far a full-strength wave lifts a node, on top of its resting height. */
  waveAmplitude: 0.11,
  nodeSize: 0.075,
  colors: {
    coast: 0x8fe0f2,
    cage: 0xfbc333,
    node: 0xfbc333,
  },
  coastOpacity: 0.6,
  cageOpacity: 0.38,
};

function toVec(lon, lat, r) {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  const c = Math.cos(la);
  return new THREE.Vector3(r * c * Math.sin(lo), r * Math.sin(la), r * c * Math.cos(lo));
}

/** Subdivided icosahedron — the cage's vertices and edges. */
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

function glowTexture() {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,240,200,1)');
  g.addColorStop(0.3, 'rgba(251,195,51,0.9)');
  g.addColorStop(1, 'rgba(251,195,51,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}

const frac = (x) => x - Math.floor(x);

/**
 * @param {object} deps
 * @param {object} deps.ripples  the same ripple field the dot world uses
 */
export function createSkyWorld({ ripples }) {
  const spin = new THREE.Group();
  const fixed = new THREE.Group();
  const disposables = [];
  const track = (o) => {
    disposables.push(o);
    return o;
  };

  /* ---- coastlines on the clear sphere, front and back both visible ---- */
  const lp = [];
  for (const ring of RINGS) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = toVec(ring[i][0], ring[i][1], 1);
      const b = toVec(ring[i + 1][0], ring[i + 1][1], 1);
      lp.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const landGeo = track(new THREE.BufferGeometry());
  landGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  const landMat = track(
    new THREE.LineBasicMaterial({
      color: SKY.colors.coast,
      transparent: true,
      opacity: SKY.coastOpacity,
      depthTest: false,
      depthWrite: false,
    })
  );
  const land = new THREE.LineSegments(landGeo, landMat);
  land.renderOrder = 1;
  spin.add(land);

  /* ---- the cage ------------------------------------------------------- */
  const ico = icosphere(SKY.cageDetail);
  /** Each node's resting height, and its unit direction, kept apart so a wave
   *  can add to the resting height without destroying it. */
  const dirs = ico.verts.map((v) => v.clone());
  const rest = ico.verts.map((v) => {
    const h = frac(Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453);
    return SKY.cageRadius * (1 + SKY.restAmplitude * (h * 2 - 1));
  });

  const edgeGeo = track(new THREE.BufferGeometry());
  const edgePos = new Float32Array(ico.edges.length * 6);
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
  const edgeMat = track(
    new THREE.LineBasicMaterial({
      color: SKY.colors.cage,
      transparent: true,
      opacity: SKY.cageOpacity,
      depthTest: false,
      depthWrite: false,
    })
  );
  const cage = new THREE.LineSegments(edgeGeo, edgeMat);
  cage.renderOrder = 2;
  spin.add(cage);

  const nodeGeo = track(new THREE.BufferGeometry());
  const nodePos = new Float32Array(dirs.length * 3);
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
  const nodeTex = track(glowTexture());
  const nodeMat = track(
    new THREE.PointsMaterial({
      map: nodeTex,
      color: SKY.colors.node,
      size: SKY.nodeSize,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
  );
  const nodes = new THREE.Points(nodeGeo, nodeMat);
  nodes.renderOrder = 3;
  spin.add(nodes);

  /** Write node and edge positions for the current wave state. */
  function layout() {
    const heights = new Array(dirs.length);
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      const w = ripples.count ? ripples.sampleAt(d.x, d.y, d.z) : 0;
      heights[i] = rest[i] + w * SKY.waveAmplitude;
      nodePos[i * 3] = d.x * heights[i];
      nodePos[i * 3 + 1] = d.y * heights[i];
      nodePos[i * 3 + 2] = d.z * heights[i];
    }
    for (let k = 0; k < ico.edges.length; k++) {
      const a = ico.edges[k][0];
      const b = ico.edges[k][1];
      edgePos[k * 6] = nodePos[a * 3];
      edgePos[k * 6 + 1] = nodePos[a * 3 + 1];
      edgePos[k * 6 + 2] = nodePos[a * 3 + 2];
      edgePos[k * 6 + 3] = nodePos[b * 3];
      edgePos[k * 6 + 4] = nodePos[b * 3 + 1];
      edgePos[k * 6 + 5] = nodePos[b * 3 + 2];
    }
    nodeGeo.attributes.position.needsUpdate = true;
    edgeGeo.attributes.position.needsUpdate = true;
  }
  layout();

  return {
    id: 'sky',
    spin,
    fixed,

    /**
     * Fade this world out as MapLibre takes the screen.
     *
     * @param {number} p dive phase, 0 (space) to 1 (map owns the screen)
     *
     * These are the SAME THREE BANDS map/globe3d.js uses for the same three
     * things — nodes, cage, land — because this world is that globe. If the
     * prototype's handoff ever looks different from the app's, this is not
     * where the difference is.
     */
    setFade(p) {
      const nodeF = 1 - smoothstep(p, ...DIVE.fade.nodes);
      const cageF = 1 - smoothstep(p, ...DIVE.fade.cage);
      const landF = 1 - smoothstep(p, ...DIVE.fade.land);
      nodeMat.opacity = nodeF;
      edgeMat.opacity = SKY.cageOpacity * cageF;
      landMat.opacity = SKY.coastOpacity * landF;
      nodes.visible = nodeF > 0;
      cage.visible = cageF > 0;
      land.visible = landF > 0;
    },

    update(nowMs) {
      ripples.update(nowMs);
      layout();
    },

    dispose() {
      for (const d of disposables) d.dispose();
      spin.clear();
      fixed.clear();
    },
  };
}
