/**
 * globe3d.js — the Three.js clear globe. The planet-band entry engine (SPEC §2).
 *
 * A see-through sphere: charcoal land on the near hemisphere, the far continents
 * dimmed through the clear ocean, grey coastlines, and the amber geodesic cage
 * whose nodes rise with storm severity.
 *
 * It is a PURE OVERLAY slaved to MapLibre. There is no dive button and no
 * separate space/map "modes": MapLibre owns the one zoom (scroll, pinch, +/-)
 * and the one camera (drag to pan). Every frame the clear globe mirrors
 * MapLibre's center + bearing, matches its own camera distance to MapLibre's
 * measured on-screen globe radius so the two are pixel-locked, and fades itself
 * out as you zoom from zSpace toward zHandoff. Zoom all the way in and it is
 * gone; MapLibre is all that's left. Zoom back out and it crossfades in again.
 *
 * This means all input is MapLibre's (the #gl canvas is pointer-events:none) —
 * which is exactly why scroll-to-zoom and drag-to-pan "just work" everywhere.
 *
 * `THREE` is a CDN global. Imports: config/, lib/, and map/heightfield.js only.
 * Never imports ui/ or data/.
 */

import { DIVE } from '../config/constants.js';
import { DARK, OPACITY, SIZE } from '../config/tokens.js';
import { DEG, lonLatToVec3, destPoint, clamp01, smoothstep } from '../lib/geo.js';
import { RINGS } from './coastline.js';
import { createHeightfield } from './heightfield.js';

const R = 1.0; // unit globe

/**
 * @param {HTMLCanvasElement} canvas   - the #gl canvas
 * @param {maplibregl.Map} map         - the MapLibre map this overlay tracks
 * @param {object} opts
 * @param {HTMLElement} opts.mapEl      - MapLibre container (#globe), fades UP
 * @param {HTMLElement} opts.spaceEl    - space background (#spacebg), fades OUT
 */
export function createGlobe3d(canvas, map, { mapEl, spaceEl } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(DARK.space), 2.5, 5.0);
  const camera = new THREE.PerspectiveCamera(DIVE.fov, 1, 0.1, 100);
  camera.position.set(0, 0, DIVE.spaceDistance);

  const globe = new THREE.Group();
  scene.add(globe);

  /* --- charcoal land fill: rasterize the rings to an equirectangular texture,
   *     drape it on a lat/lon sphere. Ocean stays transparent so the clear
   *     globe reads as glass and the far continents show through. ------------ */
  function landTexture() {
    const W = 4096;
    const H = 2048;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const x = cv.getContext('2d');
    x.clearRect(0, 0, W, H);
    x.fillStyle = DARK.land3d;

    const drawRing = (r, shift) => {
      let off = 0;
      let prev = null;
      x.beginPath();
      for (let i = 0; i < r.length; i++) {
        const lon = r[i][0];
        const lat = r[i][1];
        if (prev !== null) {
          if (lon - prev > 180) off -= 360;
          else if (lon - prev < -180) off += 360;
        }
        prev = lon; // unwrap antimeridian jumps
        const px = ((lon + off + shift + 180) / 360) * W;
        const py = ((90 - lat) / 180) * H;
        if (i === 0) x.moveTo(px, py);
        else x.lineTo(px, py);
      }
      x.closePath();
      x.fill();
    };

    for (const r of RINGS) {
      drawRing(r, 0);
      drawRing(r, 360);
      drawRing(r, -360);
    }
    const capY = ((90 - DIVE.poleCap) / 180) * H;
    x.fillRect(0, capY, W, H - capY);

    const t = new THREE.CanvasTexture(cv);
    t.needsUpdate = true;
    return t;
  }

  function fillSphere() {
    const seg = 128;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let iy = 0; iy <= seg; iy++) {
      const lat = 90 - 180 * (iy / seg);
      for (let ix = 0; ix <= seg; ix++) {
        const lon = -180 + 360 * (ix / seg);
        const v = lonLatToVec3(lon, lat, R * 0.999);
        pos.push(v.x, v.y, v.z);
        uv.push((lon + 180) / 360, (lat + 90) / 180);
      }
    }
    for (let iy = 0; iy < seg; iy++) {
      for (let ix = 0; ix < seg; ix++) {
        const a = iy * (seg + 1) + ix;
        const b = a + 1;
        const c = a + (seg + 1);
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  const landGeo = fillSphere();
  const landTex = landTexture();

  const matLandFront = new THREE.MeshBasicMaterial({
    map: landTex, transparent: true, opacity: OPACITY.land3dFront,
    alphaTest: 0.5, side: THREE.FrontSide, depthTest: true, depthWrite: true, fog: true,
  });
  const landFront = new THREE.Mesh(landGeo, matLandFront);
  landFront.renderOrder = 0;
  globe.add(landFront);

  const matLandBack = new THREE.MeshBasicMaterial({
    map: landTex, transparent: true, opacity: OPACITY.land3dBack,
    alphaTest: 0.5, side: THREE.BackSide, depthTest: true, depthWrite: false, fog: true,
  });
  const landBack = new THREE.Mesh(landGeo, matLandBack);
  landBack.renderOrder = 1;
  globe.add(landBack);

  const lp = [];
  for (const ring of RINGS) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = lonLatToVec3(ring[i][0], ring[i][1], R);
      const b = lonLatToVec3(ring[i + 1][0], ring[i + 1][1], R);
      lp.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  const matCoast = new THREE.LineBasicMaterial({
    color: new THREE.Color(DARK.coast3d), transparent: true, opacity: OPACITY.coast3d,
    depthTest: true, depthWrite: false, fog: true,
  });
  const coast = new THREE.LineSegments(lg, matCoast);
  coast.renderOrder = 1;
  globe.add(coast);

  /* --- geodesic cage + storm heightfield (geometry owned by heightfield) --- */
  const heightfield = createHeightfield();

  const matCage = new THREE.LineBasicMaterial({
    color: new THREE.Color(DARK.mesh), transparent: true, opacity: OPACITY.cage,
    depthTest: false, depthWrite: false, fog: true,
  });
  const cage = new THREE.LineSegments(heightfield.cageGeometry, matCage);
  cage.renderOrder = 2;
  globe.add(cage);

  function glowTex() {
    const s = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const x = cv.getContext('2d');
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(cv);
  }
  const matNodes = new THREE.PointsMaterial({
    map: glowTex(), color: new THREE.Color(DARK.mesh), size: SIZE.node3dSize,
    transparent: true, opacity: OPACITY.node, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: true,
  });
  const nodes = new THREE.Points(heightfield.nodeGeometry, matNodes);
  nodes.renderOrder = 3;
  globe.add(nodes);

  // outage recolor: amber = live signal, desaturated = no signal (hold shape)
  heightfield.onState((state) => {
    const live = state !== 'unavailable';
    matCage.color.set(live ? DARK.mesh : DARK.meshMuted);
    matNodes.color.set(live ? DARK.mesh : DARK.nodeMuted);
  });

  /* --- geometry match: keep the 3D globe pixel-locked to MapLibre ---------- */
  function measureRadiusPx(lon, lat) {
    const pc = map.project([lon, lat]);
    const d2 = destPoint(lon, lat, 90, 80);
    const p2 = map.project(d2);
    const dist = Math.hypot(p2.x - pc.x, p2.y - pc.y);
    return dist / Math.sin(80 * DEG);
  }
  function matchDistance(rMl) {
    const H = window.innerHeight;
    const f = H / 2 / Math.tan((DIVE.fov * DEG) / 2);
    return R * Math.sqrt(1 + (f / rMl) * (f / rMl)) * DIVE.scale;
  }

  /* --- fades: everything the crossfade touches, driven by p (0..1) -------- */
  function applyFade(p) {
    matNodes.opacity = OPACITY.node * (1 - smoothstep(p, ...DIVE.fade.nodes));
    matCage.opacity = OPACITY.cage * (1 - smoothstep(p, ...DIVE.fade.cage));
    const landF = 1 - smoothstep(p, ...DIVE.fade.land);
    matLandFront.opacity = OPACITY.land3dFront * landF;
    matLandBack.opacity = OPACITY.land3dBack * landF;
    matCoast.opacity = OPACITY.coast3d * landF;
    if (mapEl) mapEl.style.opacity = String(smoothstep(p, ...DIVE.fade.mapIn));
    if (spaceEl) spaceEl.style.opacity = String(1 - smoothstep(p, ...DIVE.fade.spaceOut));
  }

  /* --- the render loop: runs only while the clear globe is visible -------- */
  let rafId = null;
  let running = false;
  let last = performance.now();

  function frame(now) {
    if (!running) return;
    const dt = (now - last) / 16.67;
    last = now;

    const z = map.getZoom();
    const p = clamp01((z - DIVE.zSpace) / (DIVE.zHandoff - DIVE.zSpace));

    // mirror MapLibre's view: center orients the globe, bearing rolls the camera
    const c = map.getCenter();
    globe.rotation.set(c.lat * DEG, -c.lng * DEG, 0);
    const b = map.getBearing() * DEG;
    let dist = DIVE.spaceDistance;
    if (map.loaded()) {
      try {
        dist = matchDistance(measureRadiusPx(c.lng, c.lat));
      } catch {
        /* project() can throw before the first real frame; fall back. */
      }
    }
    camera.up.set(Math.sin(-b), Math.cos(-b), 0);
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);

    heightfield.tick(dt);
    applyFade(p);
    renderer.render(scene, camera);

    // Fully handed off to MapLibre — stop rather than render an invisible globe.
    if (p >= 1) {
      running = false;
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running || document.hidden) return;
    running = true;
    last = performance.now();
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  // Re-arm when zooming back out of the map, and pause when the page is hidden.
  map.on('zoom', () => {
    if (!running && !document.hidden && map.getZoom() < DIVE.zHandoff) start();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (map.getZoom() < DIVE.zHandoff) start();
  });

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!running && map.getZoom() < DIVE.zHandoff) start(); // redraw after a resize
  }
  resize();

  return { canvas, heightfield, resize, start, stop };
}
