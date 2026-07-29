/**
 * shell.js — the prototype's shared machine: the app's real map, the app's real
 * camera, the app's real input, and a switcher between worlds.
 *
 * PROTOTYPE CODE. Not wired into the app.
 *
 * ==> IT USED TO HAND-ROLL ITS OWN DRAG, PINCH AND KEYS, AND THAT WAS THE BUG.
 * The shipped globe has no input code at all to copy — `map/globe3d.js` sets
 * its canvas to pointer-events:none and MapLibre underneath owns every gesture.
 * So this file grew its own, and its own got the vertical drag backwards, got
 * the arrow keys backwards, had no two-finger twist, no momentum, no pinch
 * anchor, and spun the planet about the screen's vertical instead of its own
 * pole. It did not feel like Landfall because it was not Landfall.
 *
 * It now boots the SAME MapLibre map the app boots, through the same
 * `createGlobe()`, and mirrors it through the same `followMap()`. There is no
 * input code in this file. Zoom, pan, twist, momentum, keyboard and the dive
 * crossfade all behave identically to the app because they ARE the app's.
 *
 * Worlds swap their contents; they never swap the machine drawing them. Each
 * world hands back a `spin` group (turns with the planet), a `fixed` group (does
 * not — the atmosphere is lit from a fixed direction), a `setFade()` for the
 * dive, and a `dispose()` that must give every buffer and texture back.
 * Switching worlds repeatedly in one session is the known way to leak, so the
 * switch tears down every time rather than hiding things.
 *
 * NOTE ON THE BUTTONS: the shipped switcher is not a button bar (SPEC-GLOBES
 * §39.2 — the other worlds are simply present out at the space floor, and the
 * switch happens there and nowhere else). Three buttons is a prototype
 * affordance so the globes can be compared in two taps.
 *
 * `THREE` and `maplibregl` are CDN-style globals loaded from vendor/.
 * Imports: proto/, plus config/, lib/ and map/ for the shared camera and input.
 */

import { DIVE } from '../config/constants.js';
import { AIR_WORLD } from '../config/worlds/air.js';
import { SEA_WORLD } from '../config/worlds/sea.js';
import { smoothstep } from '../lib/geo.js';
import {
  createGlobe,
  attachKeyboard,
  attachEscape,
  attachIdleRotation,
  recenter,
} from '../map/globe.js';
import { divePhase, followMap } from '../map/globe-follow.js';
import { buildStyle } from '../map/style.js';
import { setGraticuleVisible } from '../map/graticule.js';

import { buildLandMask } from './land-mask.js';
import { createRippleField } from './ripple-field.js';
import { createAirWorld } from './world-air.js';
import { createSeaWorld } from './world-sea.js';

/* ---------------------------------------------------------------------------
 * Prototype-only tuning. Everything the APP owns — field of view, the dive
 * band, the space distance, the idle drift — comes from config/constants.js
 * through the imports above and is deliberately NOT restated here. A copy of a
 * shipped number is a copy that drifts, and this file has the scars.
 * ------------------------------------------------------------------------- */
const PROTO = Object.freeze({
  starCount: 1400,
  starRadius: 40,
  starOpacity: 0.75,

  /**
   * How much the planet's on-screen radius must change before the dot field is
   * rebuilt, as a fraction.
   *
   * ==> THIS IS A FRAME-BUDGET GUARD, NOT A NICETY. <== Rebuilding the field
   * allocates a fresh BufferGeometry and re-tests every candidate point against
   * the land mask. The old prototype got away with doing that on every wheel
   * tick because a wheel tick is discrete; MapLibre's zoom is continuous and
   * inertial, so an unguarded rebuild would fire on every frame of every pinch.
   */
  rebuildThreshold: 0.08,
});

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ status */

const statusEl = $('status');
function say(state, text) {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

/* ------------------------------------------------- the map: input + camera */

/* THE WORLDS, AS DESCRIPTORS. Each one owns its basemap palette and its layer
 * manifest (SPEC-GLOBES.md §38.1). Land is stubbed and has no entry — asking
 * for it is a no-op rather than a branch. */
const WORLDS = Object.freeze({ air: AIR_WORLD, sea: SEA_WORLD });

/** Which world the page opens on. One name, used by both the first style and
 *  the first `switchTo`, so the two can never disagree. */
const OPENS_ON = 'air';

/* THE MAP IS THE INPUT SURFACE AND THE CAMERA, exactly as in the app: it starts
 * at opacity 0 behind the Three globe and fades up as you dive into it.
 *
 * It is built WITH the opening world's palette rather than restyled a moment
 * later. A `setStyle` at boot costs a second TileJSON round trip on a page that
 * already takes ~4 s to show a globe, and the space floor would hide the flash
 * so nobody would ever notice the waste. */
const mapEl = $('map');
const spaceEl = $('spacebg');
const map = createGlobe(mapEl, { palette: WORLDS[OPENS_ON].map });

/** Which world's palette is currently installed on the map. Tracked so that
 *  switching to the world already showing does not rebuild the style. */
let styledWorld = OPENS_ON;

/* THE LAYER MANIFEST IS RE-APPLIED ON EVERY STYLE LOAD, AND IT HAS TO BE.
 * `setStyle` throws away every layer, and `globe.js`'s own `style.load`
 * handler puts the graticule straight back — visible. That handler was
 * registered inside `createGlobe()` above, so it runs FIRST and this runs
 * after it, which is the same ordering `main.js` already relies on.
 *
 * No defensive "if the style is already loaded" branch: this registration is
 * synchronous in the same tick as the map's construction, so the first
 * `style.load` cannot have fired yet. */
map.on('style.load', () => {
  const w = WORLDS[styledWorld];
  if (w) setGraticuleVisible(map, w.graticule);
});

attachKeyboard(map, mapEl);

const idle = attachIdleRotation(map);

/* --------------------------------------------------------- Three: the view */

const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(DIVE.fov, 1, 0.1, 200);
camera.position.set(0, 0, DIVE.spaceDistance);

/* Stars belong to the shell, not to any one world — every globe is in the same
 * sky. They do NOT turn with the planet: the camera orbits, the sky does not. */
const starGeo = new THREE.BufferGeometry();
{
  const p = [];
  for (let i = 0; i < PROTO.starCount; i++) {
    const y = 1 - ((i + 0.5) * 2) / PROTO.starCount;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963 + Math.sin(i) * 3.7;
    p.push(
      Math.cos(th) * r * PROTO.starRadius,
      y * PROTO.starRadius,
      Math.sin(th) * r * PROTO.starRadius
    );
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
}
const starMat = new THREE.PointsMaterial({
  color: 0x9fb6cc,
  size: 0.16,
  transparent: true,
  opacity: PROTO.starOpacity,
});
scene.add(new THREE.Points(starGeo, starMat));

/* ------------------------------------------------------- data + the worlds */

say('loading', 'Building land mask…');
const mask = buildLandMask({ width: 1024, height: 512 });

const ripples = createRippleField();

let world = null;
let worldId = null;
let lastDist = DIVE.spaceDistance;
let builtAtRadius = 0;

function makeWorld(id) {
  if (id === 'air') return createAirWorld({ mask, ripples, onStatus: say });
  if (id === 'sea') return createSeaWorld({ ripples });
  return null;
}

/**
 * How big the planet is on screen right now, in CSS pixels of radius.
 *
 * Derived from the camera distance `followMap()` just took FROM MapLibre, so it
 * tracks the real zoom rather than a number this file invented. Same meaning as
 * before — the dot-spacing slider still reads in screen pixels.
 */
function globePxRadius() {
  const h = canvas.clientHeight || window.innerHeight;
  const halfFov = (DIVE.fov * Math.PI) / 360;
  const ang = Math.asin(Math.min(0.999, 1 / lastDist));
  return (ang / halfFov) * (h / 2);
}

/**
 * THE BASEMAP IS PART OF THE WORLD, so it changes with it — in both
 * directions. Air paints the map ultraviolet; Sea puts the app's own blue
 * back. Sea is not a special case doing nothing, it is a world asking for the
 * theme palette (`config/worlds/sea.js`).
 *
 * `diff: false` for the same reason `app/theme-switch.js` uses it: the two
 * styles differ in nearly every paint property, so the diff would be larger
 * than the style. This is the SLOW step of a world switch and §38.3 puts it
 * last for exactly that reason — it is the one the user waits on.
 */
function applyWorldBasemap(id) {
  const w = WORLDS[id];
  if (!w || id === styledWorld) return;
  styledWorld = id;
  map.setStyle(buildStyle({ palette: w.map }), { diff: false });
}

function switchTo(id) {
  if (id === worldId) return;
  applyWorldBasemap(id);
  if (world) {
    scene.remove(world.spin);
    scene.remove(world.fixed);
    world.dispose();
  }
  world = makeWorld(id);
  worldId = id;
  scene.add(world.spin);
  scene.add(world.fixed);
  builtAtRadius = 0; // force a rebuild for the new world
  if (world.setSpacing) applySpacing(true);
  else $('dots').textContent = '—';
  if (world.setRim) world.setRim($('rim').value);
  if (world.setDotHeight) world.setDotHeight(Number($('height').value));
  if (world.setSeamsVisible) world.setSeamsVisible($('seams').checked);
  if (world.setFillHeight) world.setFillHeight(Number($('fillH').value));
  if (world.setFillOpacity) world.setFillOpacity(Number($('fillO').value));
  if (world.setFillTint) world.setFillTint(Number($('fillT').value));

  for (const b of document.querySelectorAll('[data-world]')) {
    b.setAttribute('aria-pressed', String(b.dataset.world === id));
  }
  $('airOnly').hidden = id !== 'air';
  if (id === 'sea') say('ok', 'Sea — the globe Landfall ships today');
  map.triggerRepaint();
}

/* --------------------------------------------------------------- controls */

/** @param {boolean} force rebuild even if the planet has barely changed size */
function applySpacing(force) {
  if (!world || !world.setSpacing) return;
  const r = globePxRadius();
  if (!force && builtAtRadius > 0) {
    const change = Math.abs(r - builtAtRadius) / builtAtRadius;
    if (change < PROTO.rebuildThreshold) return;
  }
  const px = Number($('spacing').value);
  $('spacingVal').textContent = px + ' px';
  const n = world.setSpacing(px, r);
  builtAtRadius = r;
  $('dots').textContent = n.toLocaleString();
}

$('spacing').addEventListener('input', () => {
  applySpacing(true);
  map.triggerRepaint();
});

$('speed').addEventListener('change', (e) => {
  ripples.config.timeScale = Number(e.target.value);
});
/* Take the control's starting value too, not only its changes. */
ripples.config.timeScale = Number($('speed').value);

$('rim').addEventListener('change', (e) => {
  if (world && world.setRim) world.setRim(e.target.value);
  map.triggerRepaint();
});

$('height').addEventListener('input', (e) => {
  $('heightVal').textContent = Number(e.target.value).toFixed(3);
  if (world && world.setDotHeight) world.setDotHeight(Number(e.target.value));
  map.triggerRepaint();
});

/* The three land-sheet knobs. All of them write a single uniform, so none of
 * them rebuilds anything and all three are safe to drag continuously. */
for (const [id, valId, method, digits] of [
  ['fillH', 'fillHVal', 'setFillHeight', 3],
  ['fillO', 'fillOVal', 'setFillOpacity', 2],
  ['fillT', 'fillTVal', 'setFillTint', 2],
]) {
  $(id).addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $(valId).textContent = v.toFixed(digits);
    if (world && world[method]) world[method](v);
    map.triggerRepaint();
  });
}

$('seams').addEventListener('change', (e) => {
  if (world && world.setSeamsVisible) world.setSeamsVisible(e.target.checked);
  map.triggerRepaint();
});

for (const b of document.querySelectorAll('[data-world]')) {
  b.addEventListener('click', () => switchTo(b.dataset.world));
}

/** Put a wave at a real longitude and latitude. */
function fireAt(lon, lat) {
  ripples.fire({ lon, lat, mag: 7.2, depthKm: 12 });
  say('ok', 'Wave fired at ' + lon.toFixed(1) + '°, ' + lat.toFixed(1) + '°');
  map.triggerRepaint();
}

/* THE TAP PATH IS MAPLIBRE'S. It already knows a tap from a drag, and in globe
 * projection it hands back a real longitude and latitude — so the invisible
 * pick-sphere and the raycaster this file used to carry are both gone. */
map.on('click', (e) => fireAt(e.lngLat.lng, e.lngLat.lat));

$('fire').addEventListener('click', () => {
  const c = map.getCenter();
  fireAt(c.lng, c.lat);
});

$('reset').addEventListener('click', () => {
  ripples.clear();
  recenter(map);
});

const panel = $('panel');
const panelOpen = () => !panel.hasAttribute('hidden');
const closePanel = () => {
  panel.setAttribute('hidden', '');
  $('panelToggle').setAttribute('aria-expanded', 'false');
};

$('panelToggle').addEventListener('click', () => {
  if (panelOpen()) closePanel();
  else {
    panel.removeAttribute('hidden');
    $('panelToggle').setAttribute('aria-expanded', 'true');
  }
});

/* Escape is the app's one contract: close what's open, else fly back to space.
 * Clearing the waves rides along with the recenter — this is a prototype and
 * "put it back how it was" means both. */
attachEscape(map, {
  isPanelOpen: panelOpen,
  closePanel,
  onRecenter: () => {
    ripples.clear();
    recenter(map);
  },
});

/* The ONLY keys this file owns. Arrows, +/− and Escape belong to the app's own
 * handlers above and are deliberately not touched here — two handlers on one
 * key is how you get a globe that pans twice per press. */
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

  let used = true;
  switch (e.key) {
    case 'f':
    case 'F': {
      const c = map.getCenter();
      fireAt(c.lng, c.lat);
      break;
    }
    case '1': break; // Land is stubbed
    case '2': switchTo('air'); break;
    case '3': switchTo('sea'); break;
    default: used = false;
  }
  if (used) {
    e.preventDefault();
    idle.interrupt();
  }
});

/* ------------------------------------------------------------------- loop */

/* PAINTED INSIDE MAPLIBRE'S OWN 'render' EVENT, never a separate rAF. This is
 * what locks the two globes together: a separate loop drifts out of phase,
 * reads a stale camera, and the overlay lags, flickers and snaps. Same call the
 * shipped globe makes, for the same reason.
 *
 * It also means frames stop when nothing is moving, which is the app's
 * behaviour and the whole reason it does not cook a phone at rest. The FPS
 * readout therefore only means something WHILE something is moving. */
let frames = 0;
let fpsClock = performance.now();

function frame() {
  const p = divePhase(map.getZoom());

  /* Fully handed off — clear the overlay so no stale globe hangs over the map. */
  if (p >= 1) {
    if (spaceEl) spaceEl.style.opacity = '0';
    if (mapEl) mapEl.style.opacity = '1';
    renderer.clear();
    return;
  }

  lastDist = followMap(map, { group: world ? world.spin : null, camera, lastDist });

  /* The dot field is sized in SCREEN pixels, so it has to be re-derived as the
   * planet grows through the dive. Guarded — see PROTO.rebuildThreshold. */
  applySpacing(false);

  /* Everything fades on the app's own curves so the prototype's handoff reads
   * exactly like the app's. Stars leave with the space background. */
  const spaceFade = 1 - smoothstep(p, ...DIVE.fade.spaceOut);
  starMat.opacity = PROTO.starOpacity * spaceFade;
  if (spaceEl) spaceEl.style.opacity = String(spaceFade);
  if (mapEl) mapEl.style.opacity = String(smoothstep(p, ...DIVE.fade.mapIn));

  if (world) {
    if (world.setFade) world.setFade(p);
    world.update(Date.now(), renderer.domElement.height / 2);
  }

  renderer.render(scene, camera);

  /* Keep frames coming only while there is something to animate. */
  if (ripples.liveCount) map.triggerRepaint();

  frames++;
  const now = performance.now();
  if (now - fpsClock >= 500) {
    $('fps').textContent = Math.round((frames * 1000) / (now - fpsClock));
    $('waves').textContent = String(ripples.liveCount);
    $('radius').textContent = Math.round(globePxRadius());
    frames = 0;
    fpsClock = now;
  }
}

map.on('render', frame);

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
  applySpacing(true);
  map.triggerRepaint();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);

resize();
switchTo('air');
map.triggerRepaint();
