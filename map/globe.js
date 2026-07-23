/**
 * globe.js — map initialization, the opening sequence, and idle rotation.
 *
 * This file owns the CAMERA. It does not know about storms, panels, or data.
 * Nothing here imports from ui/ or data/ — that is what keeps SPEC §12's
 * one-directional import rule true.
 *
 * Imports: config/ and map/ only.
 */

import { GLOBE, ZOOM, DIVE } from '../config/constants.js';
import { DURATION, prefersReducedMotion } from '../config/motion.js';
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
    /* Start in "space": the 3D globe fills the screen and MapLibre is hidden
     * behind it. minZoom IS the space floor — you can't zoom out past it, and
     * zooming IN from here crossfades into the map (SPEC §2). Scroll, pinch,
     * and +/- all drive this one zoom; there is no dive button. */
    zoom: DIVE.zSpace,
    minZoom: DIVE.zSpace,
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
    /* Only drift while zoomed out (in/near space). Auto-panning at street zoom
     * is disorienting, so idle rotation is a planet-band affordance only. */
    const c = map.getCenter();
    if (map.getZoom() < DIVE.zHandoff) map.setCenter([c.lng - deg, c.lat]);
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
 * Flies the camera back out to space (zSpace). Bound to Esc (SPEC §10) and the
 * recenter control (§16) — with zoom as the single control, "recenter" is how
 * you rise out of the map without scrolling all the way back.
 */
export function recenter(map, { center = GLOBE.fallbackCenter } = {}) {
  const instant = prefersReducedMotion();
  const opts = { center, zoom: DIVE.zSpace, bearing: 0 };
  if (instant) map.jumpTo(opts);
  else map.easeTo({ ...opts, duration: DURATION.flyTo, easing: easeOutQuint });
}
