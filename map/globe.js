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
 * The zoom where the globe's FULL diameter fits the viewport's short side —
 * capped at DIVE.zSpace so wide screens keep their tuned framing. MapLibre's
 * globe renders with screen radius ≈ worldSize / 2π = 512·2^z / 2π px, so the
 * fit zoom is log2(2π·targetRadius / 512). Derived from the viewport, never
 * from device class (SPEC §10) — a narrow desktop window gets the same
 * framing as a phone, and that is correct.
 */
export function spaceFloorZoom() {
  const minDim = Math.min(window.innerWidth, window.innerHeight);
  const targetRadius = (minDim / 2) * DIVE.fitFraction;
  const zFit = Math.log2((2 * Math.PI * targetRadius) / 512);
  return Math.min(DIVE.zSpace, zFit);
}

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
     * and +/- all drive this one zoom; there is no dive button. The floor is
     * viewport-derived (see spaceFloorZoom) so the whole planet is visible at
     * rest on a narrow screen. */
    zoom: spaceFloorZoom(),
    minZoom: spaceFloorZoom(),
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

/**
 * Returns { interrupt, detach }. `interrupt()` stops the drift NOW and re-arms
 * the resume timer — the canvas gestures below call it, and so must ANY
 * programmatic camera move (storm selection lives in a panel, off-canvas):
 * the drift's per-frame setCenter stomps a running flyTo, which on the first
 * live deploy made list selection dead once the globe started drifting.
 */
export function attachIdleRotation(map) {
  if (prefersReducedMotion()) return { interrupt: () => {}, detach: () => {} };

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

  return {
    interrupt,
    detach: () => {
      stop();
      clearTimeout(resumeTimer);
      for (const e of events) target.removeEventListener(e, interrupt);
      document.removeEventListener('visibilitychange', onVisibility);
    },
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

export function attachKeyboard(map) {
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
      /* Escape is deliberately NOT handled here. It is a global contract
       * (SPEC §10: close, then recenter) and lived on the canvas only, so it
       * did nothing unless focus happened to be on the map. attachEscape()
       * below owns it at the document level for every focus location. */
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
 * Escape is ONE contract (SPEC §10): close what's open, else recenter.
 *
 * It listens on the document because Escape must work from anywhere — with
 * focus on a control, on the canvas, or on a panel row. Previously the canvas
 * and the storm panel each had their own Escape listener, so pressing it with
 * focus on (say) the zoom control did nothing at all: two half-contracts on
 * two elements instead of one contract on the app.
 *
 * Ordering is deliberate and NOT last-handler-wins: an open panel absorbs the
 * first Escape, the second recenters. Escape should never yank the camera out
 * from under someone who was only trying to dismiss a panel.
 *
 * @param {object} map
 * @param {object} opts
 * @param {() => boolean} opts.isPanelOpen - true when any panel is open.
 * @param {() => void} opts.closePanel - closes the open panel.
 * @returns {() => void} detach
 */
export function attachEscape(map, { isPanelOpen, closePanel } = {}) {
  const handler = (e) => {
    if (e.key !== 'Escape') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isPanelOpen?.()) closePanel?.();
    else recenter(map);
    e.preventDefault();
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}

/**
 * Flies the camera back out to space (zSpace). Bound to Esc (SPEC §10) and the
 * recenter control (§16) — with zoom as the single control, "recenter" is how
 * you rise out of the map without scrolling all the way back.
 */
export function recenter(map, { center = GLOBE.fallbackCenter } = {}) {
  const instant = prefersReducedMotion();
  const opts = { center, zoom: spaceFloorZoom(), bearing: 0 };
  if (instant) map.jumpTo(opts);
  else map.easeTo({ ...opts, duration: DURATION.flyTo, easing: easeOutQuint });
}

/**
 * Flies the camera to a storm (SPEC §16 selection). Under reduce-motion the
 * 1.4 s travel becomes an instant jump — exactly what that setting exists for.
 * The Phase 4 detail panel adds `padding` here so the camera centers on the
 * VISIBLE globe area rather than the viewport; today no panel covers the map
 * at fly time, so there is nothing to offset yet.
 */
export function flyToStorm(map, storm) {
  const opts = { center: [storm.lon, storm.lat], zoom: GLOBE.flyToZoom, bearing: 0 };
  if (prefersReducedMotion()) map.jumpTo(opts);
  else map.flyTo({ ...opts, speed: GLOBE.flyToSpeed, curve: GLOBE.flyToCurve });
}
