/**
 * marker-home.js — the floating home marker and its off-screen pointer (SPEC §8).
 *
 * WHAT AARON ASKED FOR, in his words: the marker should "feel like it's
 * floating above the globe, above the node lattice," stay visible at all zooms,
 * and "move with the radius of the earth." When home goes off screen, the
 * marker slides to the edge of the globe at the shortest distance to home and
 * points at it, with a slight bob.
 *
 * WHY THIS IS A DOM OVERLAY AND NOT A THREE.JS OBJECT
 * There are two engines: the Three.js clear globe at wide zoom and MapLibre
 * underneath, crossfading between them (DIVE). A marker built in Three would
 * vanish at the handoff; one built as a MapLibre symbol layer would be missing
 * for the whole planet band and could not sit ABOVE the surface at all —
 * MapLibre has no altitude. So the marker is a DOM overlay positioned from
 * MapLibre's projection, which is valid at EVERY zoom because MapLibre owns the
 * one camera that both engines mirror (see globe3d.js). One marker, one code
 * path, no engine handoff to get wrong.
 *
 * THE THREE STATES (see HOME in config/constants.js):
 *   ON_GLOBE   marker at altitude + tether, no pointer
 *   OVER_LIMB  home is behind the planet — pointer rides the limb, bobbing
 *   OFF_SCREEN home is on the near face but outside the viewport — pointer at
 *              the viewport edge
 *
 * ANIMATION BUDGET: transform and opacity only, every frame, no exceptions.
 * This runs inside MapLibre's render event on a phone that is already
 * compositing a globe. Nothing here reads layout, nothing here touches width,
 * height, top, or left.
 *
 * Imports: config/ and lib/. Never data/ or ui/ — main.js pushes home in.
 */

import { HOME } from '../config/constants.js';
import { DARK, SIZE, Z } from '../config/tokens.js';
import { DURATION, EASE, prefersReducedMotion } from '../config/motion.js';
import { DEG, smoothstep, destPoint } from '../lib/geo.js';
import { houseSvg, pointerParts } from './glyph-home.js';

export const STATE = Object.freeze({
  ON_GLOBE: 'on_globe',
  OVER_LIMB: 'over_limb',
  OFF_SCREEN: 'off_screen',
});

/* ---------------------------------------------------------------------------
 * GEOMETRY
 * ------------------------------------------------------------------------- */

/**
 * Is home on the near hemisphere?
 *
 * Dot product of the home direction against the direction from the globe's
 * centre to the camera. On MapLibre's globe the camera looks at the map centre,
 * so the centre point IS the near-face direction. Positive dot = near face.
 *
 * Returns the cosine, not a boolean, because the crossfade needs to know HOW
 * near the limb we are, not just which side.
 */
function nearFaceCos(centerLon, centerLat, lon, lat) {
  const a = centerLat * DEG;
  const b = lat * DEG;
  const dLon = (lon - centerLon) * DEG;
  return Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(dLon);
}

/**
 * The surface normal at home, projected into screen space.
 *
 * THE TETHER MUST BE PERPENDICULAR TO THE SURFACE, which means it follows the
 * outward normal of the sphere — not the direction radially outward from the
 * globe's centre ON SCREEN. Those two agree in DIRECTION but not in LENGTH,
 * and the length is the whole bug: the normal tilts toward the camera as home
 * approaches the disc centre, so its on-screen projection must FORESHORTEN.
 * Drawing it full-length everywhere is what made the tether look "locked to a
 * certain angle window."
 *
 * Returns the unit screen direction plus `foreshorten` = sin(angle between the
 * normal and the view axis), which is 0 directly overhead and 1 at the limb.
 * Multiply the altitude by it to get the true on-screen tether length.
 */
function surfaceNormalScreen(centerLon, centerLat, lon, lat, bearingRad) {
  const la = lat * DEG;
  const cla = centerLat * DEG;
  const dLon = (lon - centerLon) * DEG;

  /* Unit normal in view space: +X right, +Y up, +Z toward the camera. */
  const x = Math.cos(la) * Math.sin(dLon);
  const y0 = Math.sin(la);
  const z0 = Math.cos(la) * Math.cos(dLon);
  const y = y0 * Math.cos(cla) - z0 * Math.sin(cla);

  /* Screen Y is DOWN, hence the negation. */
  let sx = x;
  let sy = -y;

  /* MapLibre's bearing rolls the map content; roll the normal with it or the
   * tether tilts wrongly the moment the user two-finger-rotates. */
  if (bearingRad) {
    const c = Math.cos(bearingRad);
    const s = Math.sin(bearingRad);
    const rx = sx * c - sy * s;
    const ry = sx * s + sy * c;
    sx = rx;
    sy = ry;
  }

  const foreshorten = Math.hypot(sx, sy);
  if (foreshorten < 1e-6) {
    /* Exactly overhead: no defined screen direction. Caller fades the tether. */
    return { ux: 0, uy: -1, foreshorten: 0 };
  }
  return { ux: sx / foreshorten, uy: sy / foreshorten, foreshorten };
}

/**
 * The altitude curve — the heart of the "floating" read.
 *
 * Altitude is expressed in EARTH RADII and converted to screen pixels using
 * MapLibre's own measured globe radius, so it scales with the planet
 * automatically at every zoom ("moves with the radius of the earth").
 *
 * It SHRINKS as you zoom in. A fixed altitude looks correct from far out and
 * drifts off the house up close, because parallax grows as the camera
 * approaches. Shrinking keeps the float at planet zoom and the accuracy at
 * street zoom, which is the tension Aaron's two requirements create.
 */
function altitudeInRadii(zoom) {
  const t = smoothstep(zoom, HOME.altZoomFar, HOME.altZoomNear);
  return HOME.altFar + (HOME.altNear - HOME.altFar) * t;
}

/**
 * MapLibre's on-screen globe radius in pixels, measured the same way
 * globe3d.js measures it — project a known small arc near the screen centre
 * and divide. Near-centre stays valid at every zoom; a limb-based measurement
 * flies off screen once you zoom in.
 *
 * Returns null on a bad frame rather than throwing, so a single unprojectable
 * frame holds the last good value instead of killing the marker.
 */
const MEASURE_DEG = 5;
function measureGlobeRadiusPx(map, lon, lat) {
  try {
    const pc = map.project([lon, lat]);
    const p2 = map.project(destPoint(lon, lat, 90, MEASURE_DEG));
    const d = Math.hypot(p2.x - pc.x, p2.y - pc.y);
    const r = d / Math.sin(MEASURE_DEG * DEG);
    return Number.isFinite(r) && r > 0 ? r : null;
  } catch {
    return null;
  }
}

/**
 * March from the screen centre along (ux,uy) until hitting the viewport
 * rectangle, inset by `m`.
 *
 * The inset is not decoration: on a phone the outer band is where the OS eats
 * gestures, and a control sitting in it is a control that cannot be tapped
 * (SPEC §10). Derived from the touch target, not hand-set.
 */
function edgePoint(ux, uy, w, h, m) {
  const cx = w / 2;
  const cy = h / 2;
  const tx = ux > 0 ? (w - m - cx) / ux : ux < 0 ? (m - cx) / ux : Infinity;
  const ty = uy > 0 ? (h - m - cy) / uy : uy < 0 ? (m - cy) / uy : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + ux * t, y: cy + uy * t };
}

/* ---------------------------------------------------------------------------
 * DOM
 *
 * Built once, mutated per frame. Creating elements inside a render loop is how
 * you drop frames — every element here exists from construction and is only
 * ever moved with transform or faded with opacity.
 * ------------------------------------------------------------------------- */

function el(tag, className, parent) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (parent) parent.appendChild(n);
  return n;
}

/* ---------------------------------------------------------------------------
 * THE MARKER
 * ------------------------------------------------------------------------- */

export function createHomeMarker(map, { container, onPointerActivate } = {}) {
  const root = el('div', 'home-layer', container || map.getCanvasContainer());
  root.style.position = 'absolute';
  root.style.inset = '0';
  root.style.pointerEvents = 'none';
  root.style.zIndex = String(Z.controlCluster - 1);

  /* --- on-globe marker: anchor dot, tether, floating glyph ---------------- */
  const onGlobe = el('div', 'home-on-globe', root);
  onGlobe.style.position = 'absolute';
  onGlobe.style.inset = '0';
  onGlobe.style.opacity = '0';
  onGlobe.style.transition = `opacity ${DURATION.base}ms ${EASE.swap}`;

  /* The tether is a 1px-wide div scaled with transform — NOT a div whose
   * height is set per frame, which would trigger layout every single frame.
   * scaleY on a fixed 1px element is a compositor-only operation. */
  const tether = el('div', 'home-tether', onGlobe);
  tether.style.position = 'absolute';
  tether.style.left = '0';
  tether.style.top = '0';
  tether.style.width = `${HOME.tetherWidthPx}px`;
  tether.style.height = '1px';
  tether.style.transformOrigin = '50% 0';
  tether.style.background = `linear-gradient(to bottom,
    color-mix(in srgb, ${DARK.textPrimary} ${HOME.tetherOpacityTop * 100}%, transparent),
    color-mix(in srgb, ${DARK.textPrimary} ${HOME.tetherOpacityBase * 100}%, transparent))`;

  const anchor = el('div', 'home-anchor', onGlobe);
  anchor.style.position = 'absolute';
  anchor.style.left = '0';
  anchor.style.top = '0';
  anchor.style.width = `${HOME.anchorPx}px`;
  anchor.style.height = `${HOME.anchorPx}px`;
  anchor.style.marginLeft = `${-HOME.anchorPx / 2}px`;
  anchor.style.marginTop = `${-HOME.anchorPx / 2}px`;
  anchor.style.borderRadius = '50%';
  anchor.style.background = DARK.textPrimary;
  anchor.style.opacity = '0.55';

  const glyph = el('div', 'home-glyph', onGlobe);
  glyph.style.position = 'absolute';
  glyph.style.left = '0';
  glyph.style.top = '0';
  glyph.style.color = DARK.textPrimary;
  glyph.style.marginLeft = `${-HOME.markerPx / 2}px`;
  glyph.style.marginTop = `${-HOME.markerPx / 2}px`;
  glyph.innerHTML = houseSvg(HOME.markerPx);

  /* --- off-screen pointer ------------------------------------------------- */
  /* A real <button>: it is interactive (tap to bring home into view), so it is
   * a button, not a div with a click handler. That is what gets it keyboard
   * focus, Enter/Space activation, and a screen-reader role for free. */
  const pointer = el('button', 'home-pointer', root);
  pointer.type = 'button';
  pointer.style.position = 'absolute';
  pointer.style.left = '0';
  pointer.style.top = '0';
  pointer.style.opacity = '0';
  pointer.style.color = DARK.textPrimary;
  pointer.style.background = 'transparent';
  pointer.style.border = '0';
  pointer.style.padding = '0';
  pointer.style.cursor = 'pointer';
  /* Hit area is the full touch target even though the glyph is smaller
   * (SPEC §10: a control may LOOK smaller, its hit area never is). */
  const hit = parseInt(SIZE.touchTarget, 10);
  pointer.style.width = `${hit}px`;
  pointer.style.height = `${hit}px`;
  pointer.style.marginLeft = `${-hit / 2}px`;
  pointer.style.marginTop = `${-hit / 2}px`;
  pointer.style.display = 'grid';
  pointer.style.placeItems = 'center';
  pointer.style.transition = `opacity ${DURATION.base}ms ${EASE.swap}`;
  pointer.setAttribute('aria-label', 'Home is off screen — bring it into view');

  /* The pointer is THREE stacked layers, and the split is deliberate:
   *   ring    — static backdrop
   *   aim     — the chevron; this is the ONLY part that rotates to point
   *   house   — the same house as the marker, and it must stay UPRIGHT.
   * Rotating the whole assembly would tip the house over, which reads as a
   * falling building rather than a home. The bob translates the wrapper, so
   * each element carries exactly one transform and no matrix maths per frame. */
  const pointerGlyph = el('span', 'home-pointer-glyph', pointer);
  pointerGlyph.style.display = 'block';
  pointerGlyph.style.pointerEvents = 'none';

  const parts = pointerParts(HOME.pointerPx);
  pointerGlyph.innerHTML = parts.ring + parts.chevron;

  const pointerHouse = el('span', 'home-pointer-house', pointerGlyph);
  pointerHouse.innerHTML = houseSvg(parts.housePx, { solid: true });

  /* The chevron element, cached — it is the only thing rotated per frame. */
  const pointerAim = pointerGlyph.querySelector('.pointer-aim');

  pointer.addEventListener('click', () => {
    if (onPointerActivate && current.home) onPointerActivate(current.home);
  });

  /* --- state -------------------------------------------------------------- */
  const current = {
    home: null,
    state: null,
    visible: false,
    lastRadiusPx: null,
  };

  /** Screen-space fallback radius when a frame can't be measured. Holding the
   *  last good value beats guessing — the marker freezes for one frame instead
   *  of jumping across the screen. */
  const radiusPx = (centerLon, centerLat) => {
    const r = measureGlobeRadiusPx(map, centerLon, centerLat);
    if (r !== null) current.lastRadiusPx = r;
    return current.lastRadiusPx;
  };

  function setState(next) {
    if (current.state === next) return;
    current.state = next;
    const showMarker = next === STATE.ON_GLOBE;
    onGlobe.style.opacity = showMarker ? '1' : '0';
    pointer.style.opacity = showMarker ? '0' : '1';
    /* A hidden pointer must leave the tab order entirely — a focusable control
     * you cannot see is a keyboard trap (the same scar as the closed panel,
     * SPEC §13). */
    pointer.disabled = showMarker;
    pointer.style.pointerEvents = showMarker ? 'none' : 'auto';
  }

  /* --- the per-frame update ---------------------------------------------- */

  function update() {
    if (!current.home || !current.visible) return;

    const { lon, lat } = current.home;
    const c = map.getCenter();
    const zoom = map.getZoom();

    const cos = nearFaceCos(c.lng, c.lat, lon, lat);
    const R = radiusPx(c.lng, c.lat);
    if (!R) return; // unmeasurable frame — hold everything as-is

    /* MapLibre rolls its content by bearing; the surface normal has to roll
     * with it or the tether tilts the moment the user two-finger-rotates. */
    const bearing = map.getBearing() * DEG;

    const centerPt = map.project([c.lng, c.lat]);
    const homePt = map.project([lon, lat]);

    const w = map.getCanvas().clientWidth;
    const h = map.getCanvas().clientHeight;

    const inViewport =
      homePt.x >= 0 && homePt.x <= w && homePt.y >= 0 && homePt.y <= h;

    /* The handoff band: within HOME.handoffDeg of the limb, crossfade rather
     * than snap. cos of the limb is 0, so the band is a small cosine window. */
    const limbBand = Math.sin(HOME.handoffDeg * DEG);
    const onNearFace = cos > 0;

    if (onNearFace && inViewport && cos > limbBand) {
      /* --- ON_GLOBE: marker at altitude, tether along the surface normal -- */
      setState(STATE.ON_GLOBE);

      /* Altitude in px = altitude in earth radii × the globe's pixel radius.
       * This is the line that makes it "move with the radius of the earth". */
      const altPx = altitudeInRadii(zoom) * R;

      /* THE TETHER IS PERPENDICULAR TO THE SURFACE — it follows the outward
       * surface normal, projected to screen. `foreshorten` is how much of that
       * normal is visible from this angle: 1 at the limb (normal lies in the
       * screen plane, full length) down to 0 directly overhead (normal points
       * at the camera, nothing to draw). Multiplying by it is what fixes the
       * "locked angle window" — the old code drew full length everywhere. */
      const n = surfaceNormalScreen(c.lng, c.lat, lon, lat, bearing);
      const visibleAlt = altPx * n.foreshorten;

      /* Directly overhead: the normal has no screen direction, so the tether
       * has nothing to point along and sub-pixel noise spins it. Fade it out
       * across a band instead of snapping, and let the marker settle centred
       * over its anchor — which is the honest picture from straight above. */
      const overhead = smoothstep(
        n.foreshorten,
        HOME.overheadDeadzone,
        HOME.overheadDeadzone + HOME.overheadFadeBand
      );

      const floatX = homePt.x + n.ux * visibleAlt * overhead;
      const floatY = homePt.y + n.uy * visibleAlt * overhead;

      anchor.style.transform = `translate(${homePt.x}px, ${homePt.y}px)`;
      glyph.style.transform = `translate(${floatX}px, ${floatY}px)`;

      /* Tether spans marker → anchor along that same normal. Below the
       * deadzone it is invisible, so skip the trig entirely. */
      const span = Math.hypot(homePt.x - floatX, homePt.y - floatY);
      if (overhead <= 0.001 || span < 1) {
        tether.style.opacity = '0';
      } else {
        const angle = Math.atan2(homePt.y - floatY, homePt.x - floatX);
        tether.style.opacity = String(overhead);
        tether.style.transform =
          `translate(${floatX}px, ${floatY}px)` +
          ` rotate(${angle - Math.PI / 2}rad)` +
          ` scaleY(${span})` +
          ` translateX(${-HOME.tetherWidthPx / 2}px)`;
      }
      return;
    }

    /* --- pointer states ---------------------------------------------------
     * Two different anchors, and choosing between them is the whole reason
     * OFF_SCREEN exists as a separate state:
     *
     *   OVER_LIMB  home is behind the planet. The limb is the meaningful edge,
     *              and riding it keeps the pointer attached to the Earth.
     *   OFF_SCREEN home is on the near face but past the viewport edge, which
     *              happens constantly once zoomed in. The limb may not even be
     *              on screen, so the viewport edge is the only honest anchor.
     * -------------------------------------------------------------------- */

    /* Screen-space direction from the globe centre toward home. For a far-side
     * point, project() still returns a position — MapLibre projects through the
     * globe — and its DIRECTION from centre is exactly the great-circle bearing
     * we want. That is the "shortest distance to home" Aaron described. */
    let ux = homePt.x - centerPt.x;
    let uy = homePt.y - centerPt.y;
    const ulen = Math.hypot(ux, uy);
    if (ulen < 0.5) {
      ux = 0;
      uy = -1;
    } else {
      ux /= ulen;
      uy /= ulen;
    }

    let px;
    let py;

    const margin = HOME.pointerEdgeMarginPx;

    /* Where the limb crossing WOULD land, and whether that point is actually
     * on screen. When the whole globe is in frame the limb is well inside the
     * viewport, and THAT is where the pointer belongs — hugging the screen
     * edge in that situation detaches it from the planet, which is the bug
     * Aaron saw. */
    const limbR = R + HOME.pointerLimbInsetPx;
    const limbX = centerPt.x + ux * limbR;
    const limbY = centerPt.y + uy * limbR;
    const limbOnScreen =
      limbX >= margin && limbX <= w - margin &&
      limbY >= margin && limbY <= h - margin;

    if (!onNearFace || cos <= limbBand) {
      setState(STATE.OVER_LIMB);

      if (limbOnScreen) {
        /* Ride the actual limb. NOT clamped to the viewport — clamping here is
         * exactly what dragged the pointer out to the screen edge even when the
         * globe's silhouette was sitting in plain view. */
        px = limbX;
        py = limbY;
      } else {
        /* The limb itself is off screen (zoomed in far enough that the globe
         * overflows the viewport). Fall back to the viewport edge, because the
         * limb is not a place the user can see. */
        const edge = edgePoint(ux, uy, w, h, margin);
        px = edge.x;
        py = edge.y;
      }
    } else {
      setState(STATE.OFF_SCREEN);
      /* Near face but outside the viewport — the viewport edge is the only
       * honest anchor. */
      const edge = edgePoint(ux, uy, w, h, margin);
      px = edge.x;
      py = edge.y;
    }

    /* The bob: OUTWARD along the pointing axis, not vertically. A vertical bob
     * on a curved rim reads wrong at the sides of the globe.
     *
     * Reduce-motion DAMPENS rather than kills it. A ~5 px local oscillation on
     * a 44 px control is not the large-area parallax that preference exists to
     * prevent, and the movement is what makes an off-screen indicator findable
     * against a busy globe. Killing it outright also made the bob look broken
     * on any machine with the OS setting on — which is how this was found. */
    const phase = (performance.now() % HOME.bobPeriodMs) / HOME.bobPeriodMs;
    const amp = prefersReducedMotion()
      ? HOME.bobAmplitudePx * HOME.bobReducedScale
      : HOME.bobAmplitudePx;
    const bob = Math.sin(phase * Math.PI * 2) * amp;

    pointer.style.transform = `translate(${px + ux * bob}px, ${py + uy * bob}px)`;

    /* ONLY the chevron rotates. The house inside it stays upright — rotating
     * the whole assembly tips the house over, which reads as a falling
     * building rather than a home. The SVG's chevron points "up" at rest,
     * hence the +90°. */
    const deg = (Math.atan2(uy, ux) * 180) / Math.PI + 90;
    if (pointerAim) pointerAim.style.transform = `rotate(${deg}deg)`;
  }

  /* Painting inside MapLibre's render event, exactly like globe3d.js — a
   * separate rAF drifts out of phase with the map and the marker visibly lags
   * the globe under it. */
  map.on('render', update);

  /* The bob needs frames even when the map is idle. Only ask for them when a
   * pointer is actually on screen AND motion is allowed — an idle globe with
   * no pointer must not be kept awake, that is battery for nothing. */
  let raf = null;
  function pump() {
    raf = null;
    if (!current.visible || current.state === STATE.ON_GLOBE) return;
    map.triggerRepaint();
    raf = requestAnimationFrame(pump);
  }
  function ensurePump() {
    if (raf === null && current.visible && current.state !== STATE.ON_GLOBE) {
      raf = requestAnimationFrame(pump);
    }
  }

  return {
    /** Push the current home in. Null clears the marker entirely. */
    setHome(home) {
      current.home = home && Number.isFinite(home.lon) ? home : null;
      current.visible = !!current.home;
      root.style.display = current.visible ? '' : 'none';
      if (current.visible) {
        current.state = null; // force a state re-evaluation on the next frame
        update();
        ensurePump();
      } else {
        pointer.disabled = true;
      }
      map.triggerRepaint();
    },

    /** Current visibility state, for the panel's "home is off screen" copy. */
    getState() {
      return current.state;
    },

    destroy() {
      map.off('render', update);
      if (raf !== null) cancelAnimationFrame(raf);
      root.remove();
    },
  };
}
