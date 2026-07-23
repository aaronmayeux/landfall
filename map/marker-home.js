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
import { DARK, SIZE } from '../config/tokens.js';
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
 * CHROME AVOIDANCE
 *
 * The pointer shares the screen with the control cluster, the storm pill, the
 * status strip, and whichever panel is open. Sliding under any of them makes it
 * both unreadable and untappable, so it walks AROUND them.
 *
 * Obstacles are MEASURED from the live DOM rather than hardcoded, because they
 * move: safe-area insets differ per device, the pill hides when the panel
 * opens, the panel docks left when wide and bottom when narrow. A table of
 * coordinates here would be wrong on the first phone that isn't Aaron's.
 * ------------------------------------------------------------------------- */

const CHROME_SELECTORS = [
  '#controls',
  '#storm-pill:not([data-hidden="true"])',
  '#status .chip[data-visible="true"]',
  '#panel-storms[data-open="true"]',
  '#panel-home[data-open="true"]',
  '#attrib-host',
];

/** Rects of everything currently on screen that the pointer must dodge.
 *
 *  getBoundingClientRect() is a layout read, which is normally forbidden in a
 *  render loop — so this is called at most once per animation frame and the
 *  result is cached (see `chromeCache` in the marker). Chrome does not move
 *  between frames except on resize or a panel toggle. */
function measureChrome(pad) {
  const rects = [];
  for (const sel of CHROME_SELECTORS) {
    for (const node of document.querySelectorAll(sel)) {
      const r = node.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      rects.push({
        left: r.left - pad,
        right: r.right + pad,
        top: r.top - pad,
        bottom: r.bottom + pad,
      });
    }
  }
  return rects;
}

const inRect = (x, y, r) =>
  x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

/**
 * Slide a point out of any obstacle it has landed in.
 *
 * Pushes along the axis of SHALLOWEST penetration — the shortest move that
 * clears the obstacle, which keeps the pointer as close as possible to the
 * direction it is trying to indicate. Repeated a few times because escaping one
 * rect can land inside a neighbour (the control cluster is a column of them).
 *
 * Deliberately NOT a general solver: a handful of axis-aligned rects, a few
 * passes, done. Anything cleverer is complexity nobody asked for.
 */
function avoidChrome(x, y, rects, bounds) {
  /* A hair past the edge, so the escaped point is strictly OUTSIDE rather than
   * exactly on the boundary (where the next pass would find it inside again). */
  const EPS = 0.5;

  const clampX = (v) => Math.max(bounds.min, Math.min(bounds.maxX, v));
  const clampY = (v) => Math.max(bounds.min, Math.min(bounds.maxY, v));

  let px = x;
  let py = y;

  for (let pass = 0; pass < 6; pass++) {
    let moved = false;

    for (const r of rects) {
      if (!inRect(px, py, r)) continue;

      /* Four ways out, cheapest first. Each is CLAMPED to the viewport before
       * being considered, because an escape that lands under the OS gesture
       * band is not an escape — and clamping afterwards (the first attempt)
       * silently pushed the point straight back inside the obstacle it had
       * just left. Candidates that survive clamping without re-entering the
       * rect are the only real options. */
      const candidates = [
        { x: clampX(r.left - EPS), y: py, cost: px - r.left },
        { x: clampX(r.right + EPS), y: py, cost: r.right - px },
        { x: px, y: clampY(r.top - EPS), cost: py - r.top },
        { x: px, y: clampY(r.bottom + EPS), cost: r.bottom - py },
      ].filter((c) => !inRect(c.x, c.y, r));

      if (candidates.length === 0) {
        /* Boxed in on every side — the obstacle spans the usable viewport in
         * both axes. Nothing sensible to do; leave the point and let the
         * caller's own clamp have the last word. */
        continue;
      }

      candidates.sort((a, b) => a.cost - b.cost);
      px = candidates[0].x;
      py = candidates[0].y;
      moved = true;
    }

    if (!moved) break;
  }

  return { x: clampX(px), y: clampY(py) };
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
  /* Host defaults to the map's canvas container ONLY as a fallback. Callers
   * should pass #home-layer-host: #globe's opacity is animated from 0 by the
   * dive, and opacity on a parent fades everything inside it — mounting here
   * made the marker invisible at the planet band. */
  const root = el('div', 'home-layer', container || map.getCanvasContainer());
  root.style.position = 'absolute';
  root.style.inset = '0';
  root.style.pointerEvents = 'none';

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
  pointer.style.transition = `opacity ${DURATION.base}ms ${EASE.swap}`;
  pointer.setAttribute('aria-label', 'Home is off screen — bring it into view');

  const parts = pointerParts(HOME.pointerPx);

  /* Hit area spans BOTH marks plus the axis gap between them, so the whole
   * assembly is one target rather than two small ones with a dead zone in the
   * middle. Never below the 44 px minimum (SPEC §10). */
  const hitW = Math.max(
    parseInt(SIZE.touchTarget, 10),
    parts.housePx + HOME.pointerAxisGapPx + parts.arrowPx
  );
  pointer.style.width = `${hitW}px`;
  pointer.style.height = `${hitW}px`;
  pointer.style.marginLeft = `${-hitW / 2}px`;
  pointer.style.marginTop = `${-hitW / 2}px`;

  /* TWO marks on ONE axis, each absolutely positioned at the assembly's centre
   * and pushed along that axis by its own transform. No enclosing circle — the
   * ring in the first pass read as a third, separate object.
   *
   * The house is offset AWAY from home and the arrow TOWARD it, so the reading
   * order outward is: house, arrow, home. Each element carries exactly one
   * transform per frame; no matrix maths, no layout reads. */
  const pointerHouse = el('span', 'home-pointer-house', pointer);
  pointerHouse.innerHTML = houseSvg(parts.housePx, { solid: true });

  const pointerArrow = el('span', 'home-pointer-arrow', pointer);
  pointerArrow.innerHTML = parts.arrow;

  /* Cached — the arrow's inner svg is the only thing rotated per frame. */
  const pointerAim = pointerArrow.querySelector('.pointer-aim');

  pointer.addEventListener('click', () => {
    if (onPointerActivate && current.home) onPointerActivate(current.home);
  });

  /* --- state -------------------------------------------------------------- */

  /* Chrome rects are measured at most ONCE per frame. getBoundingClientRect is
   * a layout read; doing it per obstacle per frame inside MapLibre's render
   * event is exactly the kind of thing that drops frames on a mid-range phone.
   * Chrome only moves on resize or a panel toggle, both of which bump the
   * frame counter naturally on the next paint. */
  const chromeCache = { frame: -1, rects: [] };
  let frameId = 0;

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
    frameId++;

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

      /* THE DRAWN TETHER LENGTH IS NOT THE TRUE PROJECTED ALTITUDE.
       *
       * The true value is altPx × foreshorten, and it is geometrically right
       * and product-wrong: past the basin band home sits within a degree or two
       * of the view centre almost every frame, foreshorten collapses toward
       * zero, and the tether disappears — the marker then reads as sitting flat
       * ON the globe, which is the exact opposite of the whole design.
       *
       * The tether is an AFFORDANCE. Its job is to keep saying "this mark
       * floats above THAT point" at every zoom. So: take the true projected
       * length, then clamp it into a visible band. Foreshortening still shapes
       * the response — it just can no longer shrink the tether out of
       * existence. */
      /* Direction fallback: when the normal's screen projection is degenerate
       * (essentially overhead) its ux/uy are noise. The screen-radial direction
       * from the projected globe centre is stable there and agrees with the
       * normal everywhere else, so prefer it whenever it is well-defined. */
      let dirX = n.ux;
      let dirY = n.uy;
      const radialLen = Math.hypot(homePt.x - centerPt.x, homePt.y - centerPt.y);
      if (radialLen > 1) {
        dirX = (homePt.x - centerPt.x) / radialLen;
        dirY = (homePt.y - centerPt.y) / radialLen;
      }

      const trueAlt = altPx * n.foreshorten;
      const drawnAlt = Math.min(
        HOME.tetherMaxPx,
        Math.max(HOME.tetherMinPx, trueAlt)
      );

      /* The genuinely degenerate case is different from "short": directly
       * overhead the normal points at the lens and there is NO screen
       * direction to draw along, so sub-pixel noise spins it (measured 26.6°
       * of swing per 0.1° of camera move). There, and only there, fade out.
       *
       * Measured in SCREEN space — the anchor's pixel distance from the
       * projected globe centre, over the globe's pixel radius. An ANGULAR
       * threshold (the first attempt) breaks at high zoom, where the whole
       * visible map is narrower than the deadzone and the tether never draws.
       * This ratio is scale-free: both terms grow together. */
      const centreDistPx = Math.hypot(homePt.x - centerPt.x, homePt.y - centerPt.y);
      const centreRatio = centreDistPx / R;
      const overhead = smoothstep(
        centreRatio,
        HOME.overheadDeadzone,
        HOME.overheadDeadzone + HOME.overheadFadeBand
      );

      /* Below the deadzone the marker sits centred on its anchor — from
       * straight above there is no visible altitude, and that is honest.
       * `lift` blends the marker home rather than snapping it. */
      const lift = drawnAlt * overhead;
      const floatX = homePt.x + dirX * lift;
      const floatY = homePt.y + dirY * lift;

      anchor.style.transform = `translate(${homePt.x}px, ${homePt.y}px)`;
      glyph.style.transform = `translate(${floatX}px, ${floatY}px)`;

      if (lift < 1) {
        tether.style.opacity = '0';
      } else {
        const angle = Math.atan2(homePt.y - floatY, homePt.x - floatX);
        tether.style.opacity = String(overhead);
        tether.style.transform =
          `translate(${floatX}px, ${floatY}px)` +
          ` rotate(${angle - Math.PI / 2}rad)` +
          ` scaleY(${lift})` +
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
     * viewport, and THAT is where the pointer belongs — hugging the screen edge
     * in that situation detaches it from the planet. */
    const limbR = R + HOME.pointerLimbInsetPx;
    const limbX = centerPt.x + ux * limbR;
    const limbY = centerPt.y + uy * limbR;
    const limbOnScreen =
      limbX >= margin && limbX <= w - margin &&
      limbY >= margin && limbY <= h - margin;

    let px;
    let py;

    if (!onNearFace || cos <= limbBand) {
      setState(STATE.OVER_LIMB);
      if (limbOnScreen) {
        /* Ride the actual limb. NOT clamped to the viewport — clamping here is
         * what dragged the pointer to the screen edge with the globe's
         * silhouette in plain view. */
        px = limbX;
        py = limbY;
      } else {
        const edge = edgePoint(ux, uy, w, h, margin);
        px = edge.x;
        py = edge.y;
      }
    } else {
      setState(STATE.OFF_SCREEN);
      const edge = edgePoint(ux, uy, w, h, margin);
      px = edge.x;
      py = edge.y;
    }

    /* Walk around on-screen chrome. Measured once per frame and cached — a
     * getBoundingClientRect per obstacle per frame would be a layout read in
     * the render loop, which is exactly what the frame budget forbids. */
    if (chromeCache.frame !== frameId) {
      chromeCache.frame = frameId;
      chromeCache.rects = measureChrome(HOME.pointerChromeClearancePx);
    }
    const safe = avoidChrome(px, py, chromeCache.rects, {
      min: margin,
      maxX: w - margin,
      maxY: h - margin,
    });
    px = safe.x;
    py = safe.y;

    /* The bob: OUTWARD along the pointing axis, not vertically. A vertical bob
     * on a curved rim reads wrong at the sides of the globe.
     *
     * Reduce-motion DAMPENS rather than kills it. A few px of local travel on a
     * 44 px control is not the large-area parallax that preference guards
     * against, and the movement is what makes an off-screen indicator findable
     * against a busy globe. */
    const phase = (performance.now() % HOME.bobPeriodMs) / HOME.bobPeriodMs;
    const amp = prefersReducedMotion()
      ? HOME.bobAmplitudePx * HOME.bobReducedScale
      : HOME.bobAmplitudePx;
    const bob = Math.sin(phase * Math.PI * 2) * amp;

    pointer.style.transform = `translate(${px + ux * bob}px, ${py + uy * bob}px)`;

    /* THE TWO MARKS SIT ON ONE IMAGINARY LINE running from the house, through
     * the arrow, out to the real home location. So the arrow is pushed TOWARD
     * home (+u) and the house AWAY from it (−u): reading outward gives house,
     * arrow, home. Putting the house on home's side would place it between the
     * viewer and the direction it is claiming. */
    const half = HOME.pointerAxisGapPx / 2;
    pointerArrow.style.transform = `translate(${ux * half}px, ${uy * half}px)`;
    pointerHouse.style.transform = `translate(${-ux * half}px, ${-uy * half}px)`;

    /* ONLY the arrow rotates. The house stays upright — a rotated house reads
     * as a falling building. The arrowhead points up at rest, hence +90°. */
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
