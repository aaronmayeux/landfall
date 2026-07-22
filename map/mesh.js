/**
 * mesh.js — the FBC333 nodal network. The planet-zoom "coolness" layer.
 *
 * SPEC §9 visual direction (as-built): at the OUTERMOST zoom the globe is a
 * glowing amber network — irregular nodes joined into an organic mesh — laid
 * over faint continents. It is the playful entry state, not an information
 * surface: storms show here as uniform grey position dots, category color
 * arriving only as you zoom in and this mesh dissolves away.
 *
 * Two things make this correct rather than merely present:
 *
 * 1. IT FADES OUT BY THE BASIN BAND. Nodes and lines interpolate to zero
 *    opacity by ZOOM.basin, and the layers carry a maxzoom so they stop
 *    rendering entirely past it. The mesh is never in the way of real data.
 *
 * 2. EDGES ARE GREAT-CIRCLE DENSIFIED. A line between two points on a globe,
 *    drawn from two vertices, cuts a chord THROUGH the sphere. Every edge here
 *    is subdivided along its great circle so it sits ON the surface — the same
 *    lesson the graticule learned.
 *
 * The point set is DETERMINISTIC (seeded PRNG), so the network is a stable
 * identity rather than a shape that reshuffles on every reload.
 *
 * Imports only from config/. No DOM beyond the map handle.
 */

import { DARK, OPACITY, SIZE } from '../config/tokens.js';
import { ZOOM, MESH } from '../config/constants.js';

export const MESH_SOURCE_ID = 'mesh';
export const MESH_LAYER_LINES = 'mesh-lines';
export const MESH_LAYER_NODES = 'mesh-nodes';

/* ---------------------------------------------------------------------------
 * Seeded PRNG (mulberry32). Deterministic so the mesh is the same every load.
 * Math.random would reshuffle the network on every visit — the entry animation
 * should feel like the same planet each time, not a new one.
 * ------------------------------------------------------------------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------------------
 * Sphere <-> lat/lon helpers. Points live as 3D unit vectors internally so
 * "nearest" is an honest angular distance and edges can be slerped.
 * ------------------------------------------------------------------------- */
const DEG = Math.PI / 180;

function toVec(lat, lon) {
  const la = lat * DEG;
  const lo = lon * DEG;
  const c = Math.cos(la);
  return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
}

function toLatLon(v) {
  const lat = Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG;
  const lon = Math.atan2(v[1], v[0]) / DEG;
  return [lon, lat]; // GeoJSON order
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function normalize(v) {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}

/** Spherical linear interpolation between two unit vectors. */
function slerp(a, b, t) {
  let d = Math.max(-1, Math.min(1, dot(a, b)));
  const omega = Math.acos(d);
  const so = Math.sin(omega);
  if (so < 1e-6) return a; // coincident — nothing to interpolate
  const k0 = Math.sin((1 - t) * omega) / so;
  const k1 = Math.sin(t * omega) / so;
  return [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1];
}

/**
 * Builds the mesh as a single GeoJSON FeatureCollection: LineString edges
 * (property `w` — line width) and Point nodes (property `r` — radius). One
 * source, two layers; the circle layer takes the points, the line layer the
 * lines.
 *
 * @param {object} opts
 * @param {number} opts.count      - node count (capped for frame budget)
 * @param {number} opts.neighbors  - edges per node (nearest-neighbour degree)
 * @param {number} opts.seed       - PRNG seed
 * @param {number} opts.densifyDeg - vertex spacing along each edge's arc
 * @returns {object} GeoJSON FeatureCollection
 */
export function buildMesh({
  count = MESH.nodeCount,
  neighbors = MESH.neighbors,
  seed = MESH.seed,
  densifyDeg = MESH.edgeDensifyDeg,
} = {}) {
  const rand = mulberry32(seed);

  /* Uniform random points on the sphere. Irregular by nature — this is what
   * gives the organic, asymmetric read the reference images have, without a
   * Delaunay library and its build step. */
  const verts = [];
  for (let i = 0; i < count; i++) {
    const z = 2 * rand() - 1;
    const phi = 2 * Math.PI * rand();
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    verts.push([r * Math.cos(phi), r * Math.sin(phi), z]);
  }

  /* Nearest-neighbour edges. O(n^2) is nothing at this node count and needs no
   * spatial index. Undirected edges deduped by an ordered key. */
  const edgeKeys = new Set();
  const edges = [];
  const degree = new Array(count).fill(0);

  for (let i = 0; i < count; i++) {
    const near = [];
    for (let j = 0; j < count; j++) {
      if (j === i) continue;
      near.push([j, dot(verts[i], verts[j])]); // larger dot = closer
    }
    near.sort((a, b) => b[1] - a[1]);
    for (let n = 0; n < neighbors && n < near.length; n++) {
      const j = near[n][0];
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push([i, j]);
      degree[i]++;
      degree[j]++;
    }
  }

  const features = [];

  /* Edges — great-circle densified so they curve with the globe. */
  for (const [i, j] of edges) {
    const a = verts[i];
    const b = verts[j];
    const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / DEG;
    const steps = Math.max(2, Math.ceil(angleDeg / densifyDeg));
    const coords = [];
    for (let s = 0; s <= steps; s++) {
      coords.push(toLatLon(normalize(slerp(a, b, s / steps))));
    }
    const w = MESH.lineWidthMin + rand() * (MESH.lineWidthMax - MESH.lineWidthMin);
    features.push({
      type: 'Feature',
      properties: { w: Number(w.toFixed(3)) },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }

  /* Nodes — radius nudged by how connected they are, so busy junctions read a
   * touch brighter. Cheap organic texture, not a second tuning knob. */
  const maxDeg = Math.max(1, ...degree);
  for (let i = 0; i < count; i++) {
    const t = degree[i] / maxDeg;
    const r = SIZE.meshNodeRadius * (0.7 + 0.6 * t);
    features.push({
      type: 'Feature',
      properties: { r: Number(r.toFixed(2)) },
      geometry: { type: 'Point', coordinates: toLatLon(verts[i]) },
    });
  }

  return { type: 'FeatureCollection', features };
}

/**
 * Adds the mesh source and its two layers to a live map.
 *
 * Inserted at the TOP of the current stack: at the planet band the mesh is the
 * hero, glowing over the faint globe. It self-hides on zoom (opacity to zero by
 * ZOOM.basin, plus a maxzoom), so it never fights real content. When storm dots
 * land in Phase 2 they insert ABOVE these layers (see MESH_LAYER_NODES) — the
 * grey position dots must sit on top of the network.
 *
 * @param {maplibregl.Map} map
 */
export function addMesh(map) {
  if (map.getSource(MESH_SOURCE_ID)) return;

  map.addSource(MESH_SOURCE_ID, { type: 'geojson', data: buildMesh() });

  const byZoom = (stops) => ['interpolate', ['linear'], ['zoom'], ...stops.flat()];

  /* Peak opacity at the planet band, gone by the basin band. The layers also
   * carry maxzoom = ZOOM.basin so they cost nothing once you have descended. */
  map.addLayer({
    id: MESH_LAYER_LINES,
    type: 'line',
    source: MESH_SOURCE_ID,
    filter: ['==', ['geometry-type'], 'LineString'],
    maxzoom: ZOOM.basin,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': DARK.mesh,
      /* Per-edge width, set at generation. Randomised texture a uniform grid
       * can't give (SPEC directive: vary line weight). */
      'line-width': ['get', 'w'],
      'line-blur': SIZE.meshLineBlur,
      'line-opacity': byZoom([
        [ZOOM.planet, OPACITY.meshLine],
        [ZOOM.basin, 0],
      ]),
    },
  });

  /* Emissive LED nodes. Solid amber core, soft fixed blur for the glow. */
  map.addLayer({
    id: MESH_LAYER_NODES,
    type: 'circle',
    source: MESH_SOURCE_ID,
    filter: ['==', ['geometry-type'], 'Point'],
    maxzoom: ZOOM.basin,
    paint: {
      'circle-color': DARK.mesh,
      'circle-radius': ['get', 'r'],
      'circle-blur': SIZE.meshNodeBlur,
      'circle-opacity': byZoom([
        [ZOOM.planet, OPACITY.meshNode],
        [ZOOM.basin, 0],
      ]),
    },
  });
}

/**
 * Toggle for the mesh, kept for parity with the other additive layers even
 * though it is on by default and self-hides on zoom. Uses `visibility` so the
 * source stays warm.
 *
 * @param {maplibregl.Map} map
 * @param {boolean} visible
 */
export function setMeshVisible(map, visible) {
  const v = visible ? 'visible' : 'none';
  for (const id of [MESH_LAYER_LINES, MESH_LAYER_NODES]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  }
}
