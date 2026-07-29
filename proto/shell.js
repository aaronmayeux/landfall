/**
 * shell.js — the prototype's shared machine: one renderer, one camera, one set
 * of controls, and a switcher between worlds.
 *
 * PROTOTYPE CODE. Not wired into the app.
 *
 * Worlds swap their contents; they never swap the machine drawing them. Each
 * world hands back a `spin` group (turns with the planet) and a `fixed` group
 * (does not — the atmosphere is lit from a fixed direction), plus a dispose()
 * that must give every buffer and texture back. Switching worlds repeatedly in
 * one session is the known way to leak, so the switch tears down every time
 * rather than hiding things.
 *
 * NOTE ON THE BUTTONS: the shipped switcher is not a button bar (SPEC-GLOBES
 * §39.2 — the other worlds are simply present out at the space floor, and the
 * switch happens there and nowhere else). Three buttons is a prototype
 * affordance so the globes can be compared in two taps.
 *
 * `THREE` is a CDN-style global loaded from vendor/.
 * Imports: proto/ only.
 */

import { buildLandMask } from './land-mask.js';
import { createRippleField } from './ripple-field.js';
import { createAirWorld } from './world-air.js';
import { createSeaWorld } from './world-sea.js';

const VIEW = {
  fov: 42,
  distMin: 1.6,
  distMax: 7.5,
  distStart: 3.05,
  /** Out at this distance the planet is roughly 200px tall on a phone — the
   *  "from space" read the specs are written against. */
  idleSpin: 0.0016,
  dragSpin: 0.005,
  keySpin: 0.06,
  keyDolly: 0.18,
  starCount: 1400,
  starRadius: 40,
};

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ setup */

const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(VIEW.fov, 1, 0.1, 200);
let dist = VIEW.distStart;
camera.position.set(0, 0, dist);

/* Stars belong to the shell, not to any one world — every globe is in the same
 * sky. */
const starGeo = new THREE.BufferGeometry();
{
  const p = [];
  for (let i = 0; i < VIEW.starCount; i++) {
    const y = 1 - ((i + 0.5) * 2) / VIEW.starCount;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963 + Math.sin(i) * 3.7;
    p.push(
      Math.cos(th) * r * VIEW.starRadius,
      y * VIEW.starRadius,
      Math.sin(th) * r * VIEW.starRadius
    );
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
}
const stars = new THREE.Points(
  starGeo,
  new THREE.PointsMaterial({ color: 0x9fb6cc, size: 0.16, transparent: true, opacity: 0.75 })
);
scene.add(stars);

/* An invisible ball we shoot rays at, so a tap anywhere on the planet turns
 * into a real longitude and latitude. */
const pickSphere = new THREE.Mesh(
  new THREE.SphereGeometry(1, 32, 24),
  new THREE.MeshBasicMaterial({ visible: false })
);
scene.add(pickSphere);

const raycaster = new THREE.Raycaster();
raycaster.params.Points = { threshold: 0.02 };

/* ------------------------------------------------------- data + the worlds */

const status = $('status');
function say(state, text) {
  status.textContent = text;
  status.dataset.state = state;
}

say('loading', 'Building land mask…');
const mask = buildLandMask({ width: 1024, height: 512 });

const ripples = createRippleField();

let world = null;
let worldId = null;

function makeWorld(id) {
  if (id === 'air') return createAirWorld({ mask, ripples, onStatus: say });
  if (id === 'sea') return createSeaWorld({ ripples });
  return null;
}

/** How big the planet is on screen right now, in CSS pixels of radius. */
function globePxRadius() {
  const h = renderer.domElement.clientHeight || window.innerHeight;
  const halfFov = (VIEW.fov * Math.PI) / 360;
  const ang = Math.asin(Math.min(0.999, 1 / dist));
  return (ang / halfFov) * (h / 2);
}

function switchTo(id) {
  if (id === worldId) return;
  if (world) {
    scene.remove(world.spin);
    scene.remove(world.fixed);
    world.dispose();
  }
  world = makeWorld(id);
  worldId = id;
  scene.add(world.spin);
  scene.add(world.fixed);
  if (world.setSpacing) applySpacing();
  else $('dots').textContent = '—';
  if (world.setRim) world.setRim($('rim').value);
  if (world.setDotHeight) world.setDotHeight(Number($('height').value));
  if (world.setSeamsVisible) world.setSeamsVisible($('seams').checked);

  for (const b of document.querySelectorAll('[data-world]')) {
    b.setAttribute('aria-pressed', String(b.dataset.world === id));
  }
  $('airOnly').hidden = id !== 'air';
  if (id === 'sea') say('ok', 'Sea — the globe Landfall ships today');
}

/* --------------------------------------------------------------- controls */

function applySpacing() {
  if (!world || !world.setSpacing) return;
  const px = Number($('spacing').value);
  $('spacingVal').textContent = px + ' px';
  const n = world.setSpacing(px, globePxRadius());
  $('dots').textContent = n.toLocaleString();
}

$('spacing').addEventListener('input', applySpacing);

$('speed').addEventListener('change', (e) => {
  ripples.config.timeScale = Number(e.target.value);
});
/* Take the control's starting value too, not only its changes. */
ripples.config.timeScale = Number($('speed').value);

$('rim').addEventListener('change', (e) => {
  if (world && world.setRim) world.setRim(e.target.value);
});

$('height').addEventListener('input', (e) => {
  $('heightVal').textContent = Number(e.target.value).toFixed(3);
  if (world && world.setDotHeight) world.setDotHeight(Number(e.target.value));
});

$('seams').addEventListener('change', (e) => {
  if (world && world.setSeamsVisible) world.setSeamsVisible(e.target.checked);
});

for (const b of document.querySelectorAll('[data-world]')) {
  b.addEventListener('click', () => switchTo(b.dataset.world));
}

$('fire').addEventListener('click', () => fireAt(0, 0));
$('reset').addEventListener('click', () => {
  ripples.clear();
  spinY = 0;
  spinX = 0;
  dist = VIEW.distStart;
});

$('panelToggle').addEventListener('click', () => {
  const p = $('panel');
  const open = p.hasAttribute('hidden');
  if (open) p.removeAttribute('hidden');
  else p.setAttribute('hidden', '');
  $('panelToggle').setAttribute('aria-expanded', String(open));
});

/* ------------------------------------------------------------------ input */

let spinY = 0;
let spinX = 0;
let dragging = false;
let moved = 0;
let lx = 0;
let ly = 0;
let lastTouch = 0;
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Screen point -> a wave at that spot on the planet. ndcX/ndcY in -1..1. */
function fireAt(ndcX, ndcY) {
  pickSphere.quaternion.setFromEuler(new THREE.Euler(spinX, spinY, 0, 'YXZ'));
  pickSphere.updateMatrixWorld(true);
  raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
  const hit = raycaster.intersectObject(pickSphere, false)[0];
  if (!hit) return false;
  const p = pickSphere.worldToLocal(hit.point.clone()).normalize();
  const lat = (Math.asin(Math.max(-1, Math.min(1, p.y))) * 180) / Math.PI;
  const lon = (Math.atan2(p.x, p.z) * 180) / Math.PI;
  ripples.fire({ lon, lat, mag: 7.2, depthKm: 12 });
  say('ok', 'Wave fired at ' + lon.toFixed(1) + '°, ' + lat.toFixed(1) + '°');
  return true;
}

/* Every live finger / pointer, so two of them can pinch. */
const pointers = new Map();
let pinchDist = 0;

function pinchSpan() {
  const p = [...pointers.values()];
  return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
}

canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  if (pointers.size === 2) {
    pinchDist = pinchSpan();
    dragging = false;
  } else if (pointers.size === 1) {
    dragging = true;
    moved = 0;
    lx = e.clientX;
    ly = e.clientY;
  }
  lastTouch = performance.now();
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  lastTouch = performance.now();

  /* Two fingers: pinch to zoom. Spreading them apart brings the planet closer. */
  if (pointers.size >= 2) {
    const d = pinchSpan();
    if (pinchDist > 0 && d > 0) {
      dist = Math.max(VIEW.distMin, Math.min(VIEW.distMax, dist * (pinchDist / d)));
      applySpacing();
    }
    pinchDist = d;
    return;
  }

  if (!dragging) return;
  const dx = e.clientX - lx;
  const dy = e.clientY - ly;
  lx = e.clientX;
  ly = e.clientY;
  moved += Math.abs(dx) + Math.abs(dy);
  spinY += dx * VIEW.dragSpin;
  /* MINUS, not plus. Dragging DOWN pulls the surface toward you, which brings
   * the north pole into view. Adding here tipped it the wrong way. */
  spinX = Math.max(-1.2, Math.min(1.2, spinX - dy * VIEW.dragSpin));
});

function releasePointer(e) {
  const had = pointers.size;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (had === 1 && dragging) {
    dragging = false;
    /* A tap that did not travel is a tap, not a drag. */
    if (moved < 6) {
      const r = canvas.getBoundingClientRect();
      fireAt(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    }
  }
  if (pointers.size === 1) {
    const only = [...pointers.values()][0];
    lx = only.x;
    ly = only.y;
    moved = 999; // coming out of a pinch is never a tap
    dragging = true;
  }
  lastTouch = performance.now();
}
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    dist = Math.max(VIEW.distMin, Math.min(VIEW.distMax, dist * (1 + e.deltaY * 0.0012)));
    applySpacing();
  },
  { passive: false }
);

window.addEventListener('keydown', (e) => {
  /* Bail only for the keys the focused control actually needs, so a keyboard
   * user who has just tabbed to a button can still spin the planet. */
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  if (tag === 'button' && (e.key === 'Enter' || e.key === ' ')) return;
  let used = true;
  switch (e.key) {
    case 'ArrowLeft': spinY -= VIEW.keySpin; break;
    case 'ArrowRight': spinY += VIEW.keySpin; break;
    case 'ArrowUp': spinX = Math.min(1.2, spinX + VIEW.keySpin); break;
    case 'ArrowDown': spinX = Math.max(-1.2, spinX - VIEW.keySpin); break;
    case '+': case '=': dist = Math.max(VIEW.distMin, dist - VIEW.keyDolly); applySpacing(); break;
    case '-': case '_': dist = Math.min(VIEW.distMax, dist + VIEW.keyDolly); applySpacing(); break;
    case 'Enter': fireAt(0, 0); break;
    case 'Escape': ripples.clear(); spinX = 0; spinY = 0; dist = VIEW.distStart; applySpacing(); break;
    case '1': break; // Land is stubbed
    case '2': switchTo('air'); break;
    case '3': switchTo('sea'); break;
    default: used = false;
  }
  if (used) {
    e.preventDefault();
    lastTouch = performance.now();
  }
});

/* ------------------------------------------------------------------- loop */

/* Size from the CANVAS BOX, never from window.innerWidth.
 *
 * ==> THIS IS WHAT BROKE THE PHONE. <== renderer.setSize(w, h, false) writes
 * the canvas's width/height ATTRIBUTES, and for a canvas those are its
 * intrinsic size. At a device pixel ratio of 2 the element's CSS box became
 * twice the viewport, pinned top-left, so the phone showed the top-left
 * quarter blown up. A 1x desktop monitor happened to match and looked fine.
 * The CSS now pins the element to 100% of the viewport in both directions, and
 * the size we hand three.js comes from the element itself. */
function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  applySpacing();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);

let frames = 0;
let fpsClock = performance.now();
let last = performance.now();

function loop(now) {
  const dt = (now - last) / 16.67;
  last = now;

  if (!dragging && !reduceMotion && now - lastTouch > 1200) spinY += VIEW.idleSpin * dt;

  camera.position.set(0, 0, dist);
  camera.lookAt(0, 0, 0);

  if (world) {
    world.spin.rotation.set(spinX, spinY, 0, 'YXZ');
    world.update(Date.now(), renderer.domElement.height / 2);
  }
  stars.rotation.y = spinY * 0.12;

  renderer.render(scene, camera);

  frames++;
  if (now - fpsClock >= 500) {
    $('fps').textContent = Math.round((frames * 1000) / (now - fpsClock));
    $('waves').textContent = String(ripples.liveCount);
    $('radius').textContent = Math.round(globePxRadius());
    frames = 0;
    fpsClock = now;
  }
  requestAnimationFrame(loop);
}

resize();
switchTo('air');
requestAnimationFrame(loop);
