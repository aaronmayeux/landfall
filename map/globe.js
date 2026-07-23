/**
 * globe.js — map initialization, the opening sequence, and idle rotation.
 *
 * This file owns the CAMERA. It does not know about storms, panels, or data.
 * Nothing here imports from ui/ or data/ — that is what keeps SPEC §12's
 * one-directional import rule true.
 *
 * Imports: config/ and map/ only.
 */

import { GLOBE, ZOOM, DIVE, STORAGE_KEY } from '../config/constants.js';
import { INTRO, DURATION, prefersReducedMotion } from '../config/motion.js';
import { buildDarkStyle } from './style-dark.js';
import { addGraticule } from './graticule.js';

/**
 * Creates the globe.
 *
 * @param {HTMLElement} container
 * @returns {maplibregl.Map}
 */
export function createGlobe(container) {
  const map = new maplibregl.Map({
    container,
    style: buildDarkStyle(),
    center: GLOBE.fallbackCenter,
    /* Placeholder start zoom — the map is hidden behind the 3D globe until the
     * dive, and dive.solveFraming() overwrites this on load with the zoom whose
     * globe radius matches the 3D framing. */
    zoom: DIVE.mapStartZoom,
    minZoom: ZOOM.min,
    maxZoom: ZOOM.max,
    /** MapLibre's own attribution control is added explicitly below so it can
     *  be positioned away from the thumb zone. */
    attributionControl: false,
    /** Keyboard handling is REPLACED, not disabled — see attachKeyboard().
     *  MapLibre's defaults don't match SPEC §10's bindings. */
    keyboard: false,
    /** Two-finger pinch AND rotate on touch (SPEC §10). */
    touchZoomRotate: true,
    touchPitch: false,
    /** No tilt on the globe. A tilted sphere is disorienting and buys nothing
     *  for storm data — this is a map of positions, not a flight sim. */
    pitchWithRotate: false,
    dragRotate: true,
    /** Renders at device pixel ratio but caps it. An iPhone at DPR 3 renders
     *  9x the pixels of DPR 1 for a globe that is mostly flat color — that is
     *  frame budget spent on nothing. Performance lens overrides. */
    maxPixelRatio: 2,
    /** Do not fetch tiles the camera is about to leave. */
    fadeDuration: DURATION.base,
  });

  map.addControl(
    new maplibregl.AttributionControl({ compact: true }),
    'bottom-left'
  );

  map.on('style.load', () => {
    /* The planet-band "hero" is now the Three.js clear globe in FRONT of this
     * map (SPEC §2), not a MapLibre layer — the old flat nodal mesh retired
     * with map/mesh.js. MapLibre owns the basin band inward. Graticule inserts
     * beneath the coast; storm dots (Phase 2) insert above it. */
    addGraticule(map);
    map.setProjection({ type: 'globe' });
  });

  return map;
}

/* ---------------------------------------------------------------------------
 * WARM LOAD (SPEC §9)
 *
 * The entry's arrival fly-in (the 3D globe falling in from a distance, in
 * globe3d.startArrival) is skipped on a warm load — someone checking twice
 * during a landfall must not sit through it twice. main.js reads isWarmLoad()
 * to decide whether to play the arrival. These helpers are map-agnostic
 * localStorage; they live here because globe.js already owns the visit key.
 *
 * (The old MapLibre camera opening-sequence retired with the hybrid: the dive
 * from the 3D globe IS the entry into the map now — SPEC §2.)
 * ------------------------------------------------------------------------- */

/**
 * Was the app opened recently enough that the intro would be an annoyance?
 * @returns {boolean}
 */
export function isWarmLoad() {
  try {
    const last = Number(localStorage.getItem(STORAGE_KEY.lastVisit));
    if (!last) return false;
    return Date.now() - last < INTRO.warmLoadWindow;
  } catch {
    /* Private browsing, storage disabled, quota — none of which should stop
     * the app. A failed read means "cold," which is the safe default. */
    return false;
  }
}

export function markVisit() {
  try {
    localStorage.setItem(STORAGE_KEY.lastVisit, String(Date.now()));
  } catch {
    /* Non-fatal. The intro simply plays every time. */
  }
}

/** Matches EASE.settle's curve in JS form, for recenter()'s MapLibre easeTo.
 *  MapLibre takes a function, CSS takes a bezier string; this is the same shape
 *  expressed twice because the two APIs demand different types — not a second
 *  tuning. */
const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

/* ---------------------------------------------------------------------------
 * IDLE ROTATION (SPEC §9)
 *
 * Gentle auto-rotate when untouched. Stops INSTANTLY on interaction.
 * Disabled when OS reduce-motion is set.
 *
 * Uses requestAnimationFrame with a delta-time step rather than a fixed
 * per-frame increment — a fixed increment makes the globe spin at different
 * speeds on 60 Hz and 120 Hz displays.
 *
 * Pauses when the page is hidden. No background work, ever.
 * ------------------------------------------------------------------------- */

export function attachIdleRotation(map) {
  if (prefersReducedMotion()) return () => {};

  let raf = null;
  let resumeTimer = null;
  let lastFrame = 0;
  let running = false;

  const step = (now) => {
    if (!running) return;
    const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
    lastFrame = now;
    const deg = GLOBE.idleRotateDegPerSecond * dt;
    /* setCenter, not easeTo — this is a continuous drift, and stacking eased
     * transitions every frame would fight itself and burn battery. */
    const c = map.getCenter();
    map.setCenter([c.lng - deg, c.lat]);
    raf = requestAnimationFrame(step);
  };

  const start = () => {
    if (running || document.hidden) return;
    running = true;
    lastFrame = 0;
    raf = requestAnimationFrame(step);
  };

  const stop = () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  };

  const interrupt = () => {
    stop();
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(start, GLOBE.idleResumeDelay);
  };

  const target = map.getCanvasContainer();
  const events = ['pointerdown', 'wheel', 'keydown', 'touchstart'];
  for (const e of events) target.addEventListener(e, interrupt, { passive: true });

  /* Page visibility: stop dead when hidden, resume on return. */
  const onVisibility = () => (document.hidden ? stop() : interrupt());
  document.addEventListener('visibilitychange', onVisibility);

  interrupt(); // arm the first resume rather than starting immediately

  return () => {
    stop();
    clearTimeout(resumeTimer);
    for (const e of events) target.removeEventListener(e, interrupt);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/* ---------------------------------------------------------------------------
 * KEYBOARD (SPEC §10)
 *
 * Arrows pan, +/- zoom, Esc recenters. Tab cycles storms and Enter selects —
 * those live on the storm list, which is Phase 2, because the list IS the
 * accessibility surface. The canvas is aria-hidden.
 *
 * MapLibre's built-in keyboard handler is disabled in createGlobe() because
 * its bindings don't match the spec's. This is the replacement, not an
 * addition — two handlers would double every pan.
 * ------------------------------------------------------------------------- */

const PAN_STEP_PX = 120;
const ZOOM_STEP = 0.5;

export function attachKeyboard(map, { onEscape } = {}) {
  const canvas = map.getCanvas();
  /* The canvas must be focusable for keyboard input to reach it at all. */
  canvas.setAttribute('tabindex', '0');

  const handler = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':  map.panBy([-PAN_STEP_PX, 0]); break;
      case 'ArrowRight': map.panBy([PAN_STEP_PX, 0]); break;
      case 'ArrowUp':    map.panBy([0, -PAN_STEP_PX]); break;
      case 'ArrowDown':  map.panBy([0, PAN_STEP_PX]); break;
      case '+':
      case '=':          map.zoomTo(map.getZoom() + ZOOM_STEP); break;
      case '-':
      case '_':          map.zoomTo(map.getZoom() - ZOOM_STEP); break;
      case 'Escape':     onEscape?.(); break;
      default:           handled = false;
    }
    /* Only swallow the event if we acted on it. Swallowing Tab would trap
     * keyboard users on the canvas, which is the exact opposite of the goal. */
    if (handled) e.preventDefault();
  };

  canvas.addEventListener('keydown', handler);
  return () => canvas.removeEventListener('keydown', handler);
}

/**
 * Returns the camera to the resting view. Bound to Esc (twice) per SPEC §10
 * and to the recenter control in §16.
 */
export function recenter(map, { center = GLOBE.fallbackCenter } = {}) {
  const instant = prefersReducedMotion();
  const opts = { center, zoom: ZOOM.introRest, bearing: 0 };
  if (instant) map.jumpTo(opts);
  else map.easeTo({ ...opts, duration: DURATION.flyTo, easing: easeOutQuint });
}
