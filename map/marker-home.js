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
import { DEG, smoothstep } from '../lib/geo.js';
import { houseSvg, pointerParts } from './glyph-home.js';
import {
  nearFaceCos,
  surfaceNormalScreen,
  altitudeInRadii,
  measureGlobeRadiusPx,
  edgePoint,
  screenDir,
} from './marker-home-geometry.js';
import {
  OCCLUDING_SELECTORS,
  measureChrome,
  occludedByChrome,
  avoidChrome,
} from './chrome-avoid.js';

export const STATE = Object.freeze({
  ON_GLOBE: 'on_globe',
  OVER_LIMB: 'over_limb',
  OFF_SCREEN: 'off_screen',
});

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
  /* Two rect sets from ONE pass of the DOM, because the two questions need
   * different padding: `pointer` is the gap the pointer keeps from chrome,
   * `occlusion` is the tighter test for "is the marker actually visible."
   * Measuring twice would double the layout reads for no benefit. */
  const chromeCache = { frame: -1, pointer: [], occlusion: [] };
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

  /* --- the per-frame update ----------------------------------------------
   *
   * Split three ways so each piece has one job:
   *   readFrame()   measure the camera and the chrome, decide nothing
   *   drawOnGlobe() the ON_GLOBE branch — anchor, tether, floating glyph
   *   drawPointer() the OVER_LIMB / OFF_SCREEN branches — edge or limb pointer
   * update() is then just the state decision plus a call to one of the two.
   *
   * Every one of these runs inside MapLibre's render event. Transform and
   * opacity only; the single layout read (chrome) is cached per frame.
   * -------------------------------------------------------------------- */

  /**
   * Everything measured from the camera and the DOM this frame. Pure
   * measurement — no decisions, no writes. Returns null on an unmeasurable
   * frame, which tells the caller to hold everything as-is.
   */
  function readFrame() {
    const { lon, lat } = current.home;
    const c = map.getCenter();
    const zoom = map.getZoom();

    const cos = nearFaceCos(c.lng, c.lat, lon, lat);
    const R = radiusPx(c.lng, c.lat);
    if (!R) return null; // unmeasurable frame — hold everything as-is

    /* MapLibre rolls its content by bearing; the surface normal has to roll
     * with it or the tether tilts the moment the user two-finger-rotates. */
    const bearing = map.getBearing() * DEG;

    const centerPt = map.project([c.lng, c.lat]);
    const homePt = map.project([lon, lat]);

    const w = map.getCanvas().clientWidth;
    const h = map.getCanvas().clientHeight;

    /* Measure chrome ONCE per frame, before the visibility decision — both the
     * occlusion test and the pointer's placement need it, and
     * getBoundingClientRect is a layout read that must not happen twice in a
     * render loop. */
    if (chromeCache.frame !== frameId) {
      chromeCache.frame = frameId;
      chromeCache.pointer = measureChrome(HOME.pointerChromeClearancePx);
      chromeCache.occlusion = measureChrome(
        HOME.occlusionPaddingPx,
        OCCLUDING_SELECTORS
      );
    }

    /* The screen-radial direction from the projected globe centre out to home.
     * Both branches need it: ON_GLOBE lifts the glyph along it, the pointer
     * branches aim along it. Computing it once here is what keeps the two in
     * agreement — they used to derive it separately with different epsilons. */
    /* minLen 0.5, not 1: the ON_GLOBE branch treats anything under 1px from
     * the projected centre as degenerate (it fades the tether there anyway via
     * the overhead deadzone), but the pointer branch historically normalised
     * down to 0.5px. Keeping the looser threshold means `len` is still exact
     * and each branch applies its own cutoff — drawOnGlobe tests `len > 1`
     * itself below. */
    const radial = screenDir(centerPt.x, centerPt.y, homePt.x, homePt.y, 0.5);

    const inBounds =
      homePt.x >= 0 && homePt.x <= w && homePt.y >= 0 && homePt.y <= h;

    /* THE MARKER FLOATS ABOVE ITS ANCHOR, so the thing the user looks for is
     * the glyph, not the surface point. Test the glyph's position for
     * occlusion — testing the anchor would keep the marker "visible" while the
     * house itself sat behind a panel. */
    const liftGuessPx = altitudeInRadii(zoom) * R;
    const guessLift = Math.min(liftGuessPx, HOME.tetherMaxPx);
    const glyphX = homePt.x + radial.ux * guessLift;
    const glyphY = homePt.y + radial.uy * guessLift;

    /* Hidden behind the drawer, the control cluster, or the status chip counts
     * as NOT VISIBLE, even though it is inside the viewport. Both the anchor
     * and the glyph must be clear — either one buried means the user cannot
     * read the marker. */
    const hiddenByChrome =
      occludedByChrome(glyphX, glyphY, chromeCache.occlusion) ||
      occludedByChrome(homePt.x, homePt.y, chromeCache.occlusion);

    return {
      lon,
      lat,
      c,
      zoom,
      cos,
      R,
      bearing,
      centerPt,
      homePt,
      w,
      h,
      radial,
      inViewport: inBounds && !hiddenByChrome,
    };
  }

  /**
   * ON_GLOBE: the marker sits at altitude above its anchor, joined by a tether
   * that follows the surface normal.
   */
  function drawOnGlobe(f) {
    /* Altitude in px = altitude in earth radii × the globe's pixel radius.
     * This is the line that makes it "move with the radius of the earth". */
    const altPx = altitudeInRadii(f.zoom) * f.R;

    /* THE TETHER IS PERPENDICULAR TO THE SURFACE — it follows the outward
     * surface normal, projected to screen. `foreshorten` is how much of that
     * normal is visible from this angle: 1 at the limb (normal lies in the
     * screen plane, full length) down to 0 directly overhead (normal points
     * at the camera, nothing to draw). Multiplying by it is what fixes the
     * "locked angle window" — the old code drew full length everywhere. */
    const n = surfaceNormalScreen(f.c.lng, f.c.lat, f.lon, f.lat, f.bearing);

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
    if (f.radial.len > 1) {
      dirX = f.radial.ux;
      dirY = f.radial.uy;
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
    const centreRatio = f.radial.len / f.R;
    const overhead = smoothstep(
      centreRatio,
      HOME.overheadDeadzone,
      HOME.overheadDeadzone + HOME.overheadFadeBand
    );

    /* Below the deadzone the marker sits centred on its anchor — from
     * straight above there is no visible altitude, and that is honest.
     * `lift` blends the marker home rather than snapping it. */
    const lift = drawnAlt * overhead;
    const floatX = f.homePt.x + dirX * lift;
    const floatY = f.homePt.y + dirY * lift;

    anchor.style.transform = `translate(${f.homePt.x}px, ${f.homePt.y}px)`;
    glyph.style.transform = `translate(${floatX}px, ${floatY}px)`;

    if (lift < 1) {
      tether.style.opacity = '0';
    } else {
      const angle = Math.atan2(f.homePt.y - floatY, f.homePt.x - floatX);
      tether.style.opacity = String(overhead);
      tether.style.transform =
        `translate(${floatX}px, ${floatY}px)` +
        ` rotate(${angle - Math.PI / 2}rad)` +
        ` scaleY(${lift})` +
        ` translateX(${-HOME.tetherWidthPx / 2}px)`;
    }
  }

  /**
   * OVER_LIMB / OFF_SCREEN: home is not drawable in place, so an edge pointer
   * stands in for it.
   *
   * Two different anchors, and choosing between them is the whole reason
   * OFF_SCREEN exists as a separate state:
   *
   *   OVER_LIMB  home is behind the planet. The limb is the meaningful edge,
   *              and riding it keeps the pointer attached to the Earth.
   *   OFF_SCREEN home is on the near face but past the viewport edge, which
   *              happens constantly once zoomed in. The limb may not even be
   *              on screen, so the viewport edge is the only honest anchor.
   */
  function drawPointer(f, overLimb) {
    /* Screen-space direction from the globe centre toward home. For a far-side
     * point, project() still returns a position — MapLibre projects through the
     * globe — and its DIRECTION from centre is exactly the great-circle bearing
     * we want. That is the "shortest distance to home" Aaron described. */
    const ux = f.radial.ux;
    const uy = f.radial.uy;

    const margin = HOME.pointerEdgeMarginPx;

    /* Where the limb crossing WOULD land, and whether that point is actually
     * on screen. When the whole globe is in frame the limb is well inside the
     * viewport, and THAT is where the pointer belongs — hugging the screen edge
     * in that situation detaches it from the planet. */
    const limbR = f.R + HOME.pointerLimbInsetPx;
    const limbX = f.centerPt.x + ux * limbR;
    const limbY = f.centerPt.y + uy * limbR;
    const limbOnScreen =
      limbX >= margin && limbX <= f.w - margin &&
      limbY >= margin && limbY <= f.h - margin;

    let px;
    let py;

    if (overLimb && limbOnScreen) {
      /* Ride the actual limb. NOT clamped to the viewport — clamping here is
       * what dragged the pointer to the screen edge with the globe's
       * silhouette in plain view. */
      px = limbX;
      py = limbY;
    } else {
      const edge = edgePoint(ux, uy, f.w, f.h, margin);
      px = edge.x;
      py = edge.y;
    }

    /* Walk around on-screen chrome, using the wider pointer clearance measured
     * at the top of this frame. */
    const safe = avoidChrome(px, py, chromeCache.pointer, {
      min: margin,
      maxX: f.w - margin,
      maxY: f.h - margin,
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

  function update() {
    if (!current.home || !current.visible) return;
    frameId++;

    const f = readFrame();
    if (!f) return; // unmeasurable frame — hold everything as-is

    /* WHAT DECIDES THE HANDOFF: the anchor's angle past the limb, plus grace.
     *
     * The marker is a DOM overlay, so the planet never actually occludes the
     * glyph — it stays fully drawn as it floats out past the silhouette. What
     * makes it "disappear over the horizon" is setState fading the whole
     * onGlobe group. So the question is purely WHEN to fade, and the answer is
     * a delay measured from the anchor's limb crossing.
     *
     * HOME.handoffGraceDeg is how far past the limb the anchor travels before
     * the swap. The glyph is lifted outward, toward the limb, so it clears the
     * rim well before the anchor reaches it; the grace is what lets it finish
     * sailing out instead of being cut off mid-exit. Zero reproduces a swap at
     * the exact limb crossing; the old behaviour was NEGATIVE grace, firing
     * four degrees early, which is what read as premature. */
    const graceBand = Math.sin(HOME.handoffGraceDeg * DEG);
    const onNearFace = f.cos > 0;
    const anchorPastLimb = f.cos <= -graceBand;

    if (!anchorPastLimb && f.inViewport) {
      setState(STATE.ON_GLOBE);
      drawOnGlobe(f);
      return;
    }

    /* OVER_LIMB vs OFF_SCREEN asks a different question — is home behind the
     * planet, or merely past the screen edge — and it turns on the true near/
     * far side, not on the grace band. A point one degree onto the far side is
     * OVER_LIMB even while the grace period is still running. */
    setState(onNearFace ? STATE.OFF_SCREEN : STATE.OVER_LIMB);
    drawPointer(f, !onNearFace);
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
