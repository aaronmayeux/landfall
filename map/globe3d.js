/**
 * globe3d.js — the Three.js clear globe. The planet-band entry engine (SPEC §2).
 *
 * A see-through sphere: charcoal land on the near hemisphere, the far continents
 * dimmed through the clear ocean, grey coastlines, and the amber geodesic cage
 * whose nodes rise with storm severity. It sits IN FRONT of the MapLibre globe
 * (which loads lazily behind it) until the dive crossfades one into the other.
 *
 * This file owns the Three SCENE, the CAMERA, the render loop, and space-mode
 * interaction. It does NOT own the dive — dive.js drives that through the
 * `fade` handle and `setDiveDriver`. It does not own storm elevation —
 * heightfield.js does, and this file only wears the geometry the heightfield
 * produces and recolors it on an outage.
 *
 * `THREE` is a CDN global (same pattern as `maplibregl`). Imports: config/,
 * lib/, and map/heightfield.js only. Never imports ui/ or data/.
 */

import { DIVE } from '../config/constants.js';
import { DARK, OPACITY, SIZE } from '../config/tokens.js';
import { INTRO } from '../config/motion.js';
import { prefersReducedMotion } from '../config/motion.js';
import { DEG, lonLatToVec3, vec3ToLonLat, clamp01 } from '../lib/geo.js';
import { RINGS } from './coastline.js';
import { createHeightfield } from './heightfield.js';

/** Idle drift speed in space, radians per ~60fps frame. Gentle — a resting
 *  planet, not a spin. Matches the feel of the MapLibre idle rotation. */
const IDLE_SPIN = 0.0016;

/** How far back the arrival fly-in starts, as a multiple of the resting camera
 *  distance — the globe falls in from here to spaceDistance (SPEC §9 opening). */
const ARRIVAL_START_MUL = 1.9;

export function createGlobe3d(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(DARK.space), 2.5, 5.0);
  const camera = new THREE.PerspectiveCamera(DIVE.fov, 1, 0.1, 100);
  camera.position.set(0, 0, DIVE.spaceDistance);

  const globe = new THREE.Group();
  scene.add(globe);
  const R = 1.0;

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

    // each ring plus wrapped copies so antimeridian-crossing land fills both edges
    for (const r of RINGS) {
      drawRing(r, 0);
      drawRing(r, 360);
      drawRing(r, -360);
    }
    // close the south pole: below POLE_CAP the only land is Antarctica
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
        const v = lonLatToVec3(lon, lat, R * 0.999); // just inside the coast lines
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

  // NEAR continents: solid. alphaTest keeps the ocean clear AND makes only land
  // write depth, so the far side is occluded behind front land but visible
  // through front ocean.
  const matLandFront = new THREE.MeshBasicMaterial({
    map: landTex,
    transparent: true,
    opacity: OPACITY.land3dFront,
    alphaTest: 0.5,
    side: THREE.FrontSide,
    depthTest: true,
    depthWrite: true,
    fog: true,
  });
  const landFront = new THREE.Mesh(landGeo, matLandFront);
  landFront.renderOrder = 0;
  globe.add(landFront);

  // FAR continents: dimmed, seen through the clear ocean.
  const matLandBack = new THREE.MeshBasicMaterial({
    map: landTex,
    transparent: true,
    opacity: OPACITY.land3dBack,
    alphaTest: 0.5,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: false,
    fog: true,
  });
  const landBack = new THREE.Mesh(landGeo, matLandBack);
  landBack.renderOrder = 1;
  globe.add(landBack);

  // grey coastline edge riding on the fill
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
    color: new THREE.Color(DARK.coast3d),
    transparent: true,
    opacity: OPACITY.coast3d,
    depthTest: true,
    depthWrite: false,
    fog: true,
  });
  const coast = new THREE.LineSegments(lg, matCoast);
  coast.renderOrder = 1;
  globe.add(coast);

  /* --- the geodesic cage + storm heightfield (geometry owned by heightfield) - */
  const heightfield = createHeightfield();

  const matCage = new THREE.LineBasicMaterial({
    color: new THREE.Color(DARK.mesh),
    transparent: true,
    opacity: OPACITY.cage,
    depthTest: false,
    depthWrite: false,
    fog: true,
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
    map: glowTex(),
    color: new THREE.Color(DARK.mesh),
    size: SIZE.node3dSize,
    transparent: true,
    opacity: OPACITY.node,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    fog: true,
  });
  const nodes = new THREE.Points(heightfield.nodeGeometry, matNodes);
  nodes.renderOrder = 3;
  globe.add(nodes);

  // outage recolor: amber = live signal, desaturated = no signal (hold shape)
  heightfield.onState((state) => {
    if (state === 'unavailable') {
      matCage.color.set(DARK.meshMuted);
      matNodes.color.set(DARK.nodeMuted);
    } else {
      matCage.color.set(DARK.mesh);
      matNodes.color.set(DARK.mesh);
    }
  });

  /* --- space-mode interaction: drag to aim ------------------------------- */
  let mode = 'space'; // 'space' | 'diving' | 'map' | 'rising'
  let dragging = false;
  let lx = 0;
  let ly = 0;

  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'space') return;
    dragging = true;
    lx = e.clientX;
    ly = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    globe.rotation.y += (e.clientX - lx) * 0.005;
    globe.rotation.x = Math.max(-1.2, Math.min(1.2, globe.rotation.x + (e.clientY - ly) * 0.005));
    lx = e.clientX;
    ly = e.clientY;
  });
  const endDrag = () => (dragging = false);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  /** Keyboard aim (SPEC §10 — every gesture needs a keyboard path). Arrow keys
   *  in space mode rotate the globe by a fixed step. */
  function rotateBy(dx, dy) {
    if (mode !== 'space') return;
    globe.rotation.y += dx;
    globe.rotation.x = Math.max(-1.2, Math.min(1.2, globe.rotation.x + dy));
  }

  /** The lon/lat currently facing the camera — where a dive would land. */
  function getCenterLonLat() {
    const v = new THREE.Vector3(0, 0, 1).applyQuaternion(globe.quaternion.clone().invert());
    return vec3ToLonLat(v);
  }
  /** Point a given lon/lat at the camera (used to line the globe up with the
   *  MapLibre center before a rise-back-to-space). */
  function faceLonLat(lon, lat) {
    globe.rotation.set(lat * DEG, -lon * DEG, 0);
  }

  /* --- arrival fly-in (SPEC §9): the globe falls in from a distance -------- */
  let arrival = null; // { t0, resolve }
  function startArrival() {
    if (prefersReducedMotion()) {
      camera.position.z = DIVE.spaceDistance;
      return Promise.resolve();
    }
    camera.position.z = DIVE.spaceDistance * ARRIVAL_START_MUL;
    return new Promise((resolve) => {
      arrival = { t0: performance.now(), resolve };
    });
  }

  /* --- the single render loop -------------------------------------------- */
  let diveDriver = null;
  let last = performance.now();
  let rafId = null;
  let running = false;
  const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

  function frame(now) {
    if (!running) return;
    const dt = (now - last) / 16.67;
    last = now;

    if (arrival && mode === 'space') {
      const p = clamp01((now - arrival.t0) / INTRO.duration);
      const e = easeOutQuint(p);
      camera.position.z =
        DIVE.spaceDistance * (ARRIVAL_START_MUL - (ARRIVAL_START_MUL - 1) * e);
      globe.rotation.y += IDLE_SPIN * dt * (1 - e); // a little extra spin, easing out
      if (p >= 1) {
        camera.position.z = DIVE.spaceDistance;
        arrival.resolve();
        arrival = null;
      }
    } else if (mode === 'space' && !dragging && !prefersReducedMotion()) {
      globe.rotation.y += IDLE_SPIN * dt;
    }

    heightfield.tick(dt);

    if (diveDriver) diveDriver(now);

    renderer.render(scene, camera);

    // In steady map mode the Three globe is faded out and MapLibre owns the
    // screen — stop rendering rather than run two engines for an invisible frame.
    if (mode === 'map' && !diveDriver) {
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

  // Pause when hidden — no background work, ever (SPEC §4). Resume only if we
  // are not already parked in steady map mode.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (mode !== 'map') start();
  });

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  return {
    canvas,
    camera,
    heightfield,
    start,
    stop,
    resize,
    rotateBy,
    getCenterLonLat,
    faceLonLat,
    startArrival,
    getMode: () => mode,
    setMode: (m) => {
      mode = m;
      if (m !== 'space') arrival = null; // a dive mid-arrival cancels it cleanly
      if (m !== 'map') start(); // re-arm the loop for space/diving/rising
    },
    setDiveDriver: (fn) => {
      diveDriver = fn;
      if (fn) start();
    },
    /** Everything the dive fades, in one handle so dive.js imports no Three. */
    fade: {
      camera,
      mats: { landFront: matLandFront, landBack: matLandBack, coast: matCoast, cage: matCage, nodes: matNodes },
      rest: {
        landFront: OPACITY.land3dFront,
        landBack: OPACITY.land3dBack,
        coast: OPACITY.coast3d,
        cage: OPACITY.cage,
        nodes: OPACITY.node,
      },
    },
  };
}
