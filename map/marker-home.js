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

/** The marker glyph: a ring with a solid centre. Deliberately NOT a map pin —
 *  a pin's point implies it is stuck INTO the surface, which is the opposite of
 *  the floating read. A ring hovering over its own shadow reads as suspended. */
function markerSvg(px) {
  return `
<svg viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true" focusable="false">
  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/>
  <circle cx="12" cy="12" r="3.2" fill="currentColor"/>
</svg>`;
}

/** The pointer: a chevron. It is rotated per frame to aim along the great
 *  circle toward home. */
function pointerSvg(px) {
  return `
<svg viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true" focusable="false">
  <circle cx="12" cy="12" r="10.5" fill="var(--glass-raised)" stroke="currentColor" stroke-width="1.4"/>
  <path d="M12 5.5 L16.5 14 L12 11.6 L7.5 14 Z" fill="currentColor"/>
</svg>`;
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
  glyph.innerHTML = markerSvg(HOME.markerPx);

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

  /* The chevron lives in an inner span so the bob can transform IT while the
   * button itself carries the position transform. Two transforms, two
   * elements, no matrix maths per frame. */
  const pointerGlyph = el('span', 'home-pointer-glyph', pointer);
  pointerGlyph.style.display = 'block';
  pointerGlyph.style.pointerEvents = 'none';
  pointerGlyph.innerHTML = pointerSvg(HOME.pointerPx);

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
      /* --- ON_GLOBE: marker at altitude, tether to the surface ------------ */
      setState(STATE.ON_GLOBE);

      /* Altitude in px = altitude in earth radii × the globe's pixel radius.
       * This is the line that makes it "move with the radius of the earth". */
      const altPx = altitudeInRadii(zoom) * R;

      /* Direction to lift: radially OUTWARD from the globe's centre on screen.
       * At the centre of the disc that is undefined, so lift straight up —
       * which is also what looks right for a marker directly under the camera. */
      let dx = homePt.x - centerPt.x;
      let dy = homePt.y - centerPt.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.5) {
        dx = 0;
        dy = -1;
      } else {
        dx /= len;
        dy /= len;
      }

      const floatX = homePt.x + dx * altPx;
      const floatY = homePt.y + dy * altPx;

      anchor.style.transform = `translate(${homePt.x}px, ${homePt.y}px)`;
      glyph.style.transform = `translate(${floatX}px, ${floatY}px)`;

      /* Tether: rotate to point from the marker back to the anchor, and scaleY
       * to span the gap. transformOrigin is the top, so it grows downward from
       * the glyph toward the surface. */
      const angle = Math.atan2(homePt.y - floatY, homePt.x - floatX);
      tether.style.transform =
        `translate(${floatX}px, ${floatY}px)` +
        ` rotate(${angle - Math.PI / 2}rad)` +
        ` scaleY(${Math.max(1, altPx)})` +
        ` translateX(${-HOME.tetherWidthPx / 2}px)`;
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

    if (!onNearFace || cos <= limbBand) {
      setState(STATE.OVER_LIMB);
      /* Ride the limb: centre + (globe radius + inset) along the direction to
       * home. The limb radius on screen is the globe's projected silhouette,
       * which for our purposes is the measured radius. */
      const rr = R + HOME.pointerLimbInsetPx;
      px = centerPt.x + ux * rr;
      py = centerPt.y + uy * rr;
    } else {
      setState(STATE.OFF_SCREEN);
      /* Project the direction onto the viewport rectangle: march from the
       * screen centre along (ux,uy) until hitting an edge. */
      const cx = w / 2;
      const cy = h / 2;
      const m = HOME.pointerEdgeMarginPx;
      const tx = ux > 0 ? (w - m - cx) / ux : ux < 0 ? (m - cx) / ux : Infinity;
      const ty = uy > 0 ? (h - m - cy) / uy : uy < 0 ? (m - cy) / uy : Infinity;
      const t = Math.min(tx, ty);
      px = cx + ux * t;
      py = cy + uy * t;
    }

    /* Clamp inside the safe margin regardless of which branch produced the
     * point. On a phone the corners are exactly where the OS eats gestures,
     * and the limb crossing can land there when home is nearly straight down
     * (SPEC §10). */
    const m = HOME.pointerEdgeMarginPx;
    px = Math.max(m, Math.min(w - m, px));
    py = Math.max(m, Math.min(h - m, py));

    /* The bob: OUTWARD along the pointing axis, not vertically. A vertical bob
     * on a curved rim reads wrong at the sides of the globe. Reduce-motion
     * kills it entirely — this is decoration carrying a little information,
     * and under reduce-motion the position alone still carries it. */
    let bob = 0;
    if (!prefersReducedMotion()) {
      const phase = (performance.now() % HOME.bobPeriodMs) / HOME.bobPeriodMs;
      bob = Math.sin(phase * Math.PI * 2) * HOME.bobAmplitudePx;
    }

    pointer.style.transform = `translate(${px + ux * bob}px, ${py + uy * bob}px)`;
    /* Rotate the chevron to aim along the direction to home. The SVG points
     * "up" at rest, hence the +90°. */
    const deg = (Math.atan2(uy, ux) * 180) / Math.PI + 90;
    pointerGlyph.style.transform = `rotate(${deg}deg)`;
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
    if (prefersReducedMotion()) return;
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
