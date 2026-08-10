/**
 * limb-glow.js — STORM LIGHT ON THE BACKDROP.
 *
 * Each storm throws soft coloured light onto the space backdrop behind the
 * globe. Spin the planet and the colours sweep across the background with it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN CANVAS BELOW MAPLIBRE, AND NOT PART OF THE THREE SCENE.
 *
 * The obvious build is a few additive sprites inside the existing Three scene.
 * It does not work here, for a reason specific to this app's layer order
 * (index.html): `#spacebg` is a CSS gradient, `#globe` (MapLibre) sits above
 * it, and `#gl` (Three) sits above that. So the Three canvas composites ONTO
 * the backdrop with plain source-over — WebGL can paint over the gradient but
 * can never add light into it, and in the light theme it can never multiply
 * into it either. Anything drawn up there is painting on top of the map.
 *
 * Moving the backdrop into WebGL to fix that inverts the dive crossfade:
 * `#spacebg` is BELOW MapLibre today, which is exactly what lets MapLibre fade
 * up and cover it. A WebGL-owned backdrop would be fading out ON TOP of the
 * map, washing it out for the whole handoff.
 *
 * So the light gets its own thin layer BETWEEN the backdrop and MapLibre, and
 * the BROWSER does the blend via `mix-blend-mode`. That buys three things at
 * once:
 *
 *   1. Real `multiply` against the real gradient in the light theme, without
 *      this file owning or duplicating the gradient. Reconstructing a CSS
 *      `radial-gradient(120% 120% at 42% 30%, ...)` in shader maths means
 *      keeping two engines' idea of the viewport in sync forever, and getting
 *      it subtly wrong is invisible until someone rotates their phone.
 *   2. Free occlusion on the dive — MapLibre fades up over this layer exactly
 *      as it already does over `#spacebg`. No new fade path to get wrong.
 *   3. Free occlusion by the GLOBE, because the Three canvas paints above it.
 *      Opaque continents cover the light behind them, the transparent ocean
 *      lets it through. That is the physically right read, and it costs zero:
 *      it falls out of the z-order that was already there.
 *
 * ---------------------------------------------------------------------------
 * IT IS A 2D CANVAS, DELIBERATELY, AND A SMALL ONE.
 *
 * A third WebGL context on a low-tier Android is a real risk — MapLibre and
 * Three are already holding two, and losing one is a black screen. Nothing
 * here needs a shader: soft blobs are the lowest-frequency image there is, so
 * the canvas renders at a FRACTION of screen size (GLOW.pixelScale) and CSS
 * scales it up. The browser's bilinear filtering is not a cost we pay to hide
 * the low resolution — it is free extra smoothing on an image whose entire
 * job is to be smooth.
 *
 * That is also why the count cap is generous where a sprite budget could not
 * be: at a quarter scale, eight overlapping radial fills cover a fraction of
 * the pixels the same effect would touch on the real framebuffer.
 *
 * ---------------------------------------------------------------------------
 * TWO BLENDS, AND BOTH THEMES ARE REAL PHYSICS.
 *
 * Blobs blend with EACH OTHER inside the canvas, and the canvas blends with
 * the backdrop underneath. Both switch with the theme:
 *
 *   dark   `lighter` inside, `screen` outside     — emitted light. Two storms
 *          overlapping get brighter and their hues mix.
 *   light  `multiply` inside, `multiply` outside  — coloured glass. Two storms
 *          overlapping stack like filters: deeper, more saturated, never
 *          washed out.
 *
 * Additive is the one thing a pale backdrop cannot show — there is no headroom
 * above near-white — so the light theme does not attempt it. Multiplying a
 * category colour into mid-grey darkens AND saturates, which is what makes it
 * read as an effect rather than a smudge. Same positions, same intensities,
 * one flag. It is the same call the far-side land and the cage nodes already
 * make in map/globe3d.js, for the same reason.
 *
 * TRANSPARENT IS THE IDENTITY FOR BOTH `screen` AND `multiply`, which is why
 * the canvas is simply cleared and never painted with a base colour. Where
 * there are no storms, the backdrop is untouched, in either theme.
 *
 * Imports: config/ only. `THREE` is a global. Knows nothing about storms —
 * globe3d.js hands it points, a camera and a fade.
 */

import { GLOW } from '../config/constants.js';
import { fx, isLight } from '../config/theme.js';

/* Reused across frames — a Vector3 per storm per frame is garbage the phone
 * has to collect during the exact gesture this effect exists to decorate. */
const _hit = new THREE.Vector3();
const _view = new THREE.Vector3();
const _eye = new THREE.Vector3();

/** Smoothstep on an already-normalised 0..1 t. */
function smoothstep(t) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * '#rrggbb' -> 'r,g,b', darkened by `deepen`.
 *
 * ==> DARKENING IS WHY THE LIGHT THEME IS VISIBLE AT ALL, AND RAISING THE
 * ALPHA IS NOT. <==
 *
 * In the light theme the blob is a MULTIPLY filter, so what reaches the eye is
 * the storm colour mixed with white by the alpha. Category greens and blues
 * are already pale, and multiplying pale by light grey is very nearly light
 * grey — so turning the alpha up just walks the backdrop toward that same pale
 * colour and still reads as nothing. Deepening the colour instead gives a
 * filter with something to subtract: a saturated dark green stains grey
 * visibly where a pale one cannot.
 *
 * HUE IS UNTOUCHED — every channel scales by the same factor — so a green
 * storm still throws green. Only the value moves. `deepen` is 1.0 in the dark
 * theme, where the blob ADDS light and darkening it would be exactly wrong.
 */
function rgbOf(hex, deepen = 1) {
  const h = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  const n = parseInt(h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h, 16);
  if (!Number.isFinite(n)) return '255,255,255';
  const k = deepen > 0 ? deepen : 1;
  return (
    `${Math.round(((n >> 16) & 255) * k)},` +
    `${Math.round(((n >> 8) & 255) * k)},` +
    `${Math.round((n & 255) * k)}`
  );
}

/**
 * @param {HTMLCanvasElement} canvas  - the #glow canvas
 * @param {object} opts
 * @param {() => Array} opts.getStormPoints  - heightfield's live point list
 * @param {() => string} opts.getState       - heightfield's feed state
 */
export function createLimbGlow(canvas, { getStormPoints, getState } = {}) {
  const ctx = canvas.getContext('2d');
  let cssW = 1;
  let cssH = 1;
  let painted = false; // was anything drawn last frame? skips redundant clears
  let lastOpacity = null; // only touch the style when the number actually moves

  /* The globe group only ever rotates about the origin, so one scratch matrix
   * covers every frame. Allocated once, on purpose: this runs inside the
   * gesture the effect exists to decorate. */
  const _inv = new THREE.Matrix4();

  /** The dive fade, on its own band — see GLOW.fade for why it is not shared
   *  with the cage's. Smoothstep, matching every other fade in the app. */
  function fadeCurve(p) {
    const [a, b] = GLOW.fade;
    if (p <= a) return 0;
    if (p >= b) return 1;
    return smoothstep((p - a) / (b - a));
  }

  function setOpacity(v) {
    if (v === lastOpacity) return;
    lastOpacity = v;
    canvas.style.opacity = String(v);
  }

  /* ==> THE TWO BLEND MODES ARE SET IN ONE PLACE, AND THAT IS NOT TIDINESS.
   * <== Resizing a canvas resets its context state, so `resize` has to restore
   * the composite op — and when it did so with its own copy of the ternary,
   * boot order hid a broken `retheme` completely: resize ran last and set the
   * right value anyway. The bug only appeared on a LIVE theme toggle, which is
   * the one path no boot-time check walks. Both readings come from here now,
   * so there is one thing to get wrong instead of two that must agree. */
  function retheme() {
    const light = isLight();
    canvas.style.mixBlendMode = light ? 'multiply' : 'screen';
    ctx.globalCompositeOperation = light ? 'multiply' : 'lighter';
  }

  function resize() {
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    /* Deliberately NOT devicePixelRatio. The image is soft by construction, so
     * buffer size is chosen for the SHAPE, not the screen — a phone and a
     * desktop draw the same number of pixels here. The floor stops a very
     * narrow window from quantising the falloff into visible steps. */
    canvas.width = Math.max(GLOW.minBufferPx, Math.round(cssW * GLOW.pixelScale));
    canvas.height = Math.max(GLOW.minBufferPx, Math.round(cssH * GLOW.pixelScale));
    retheme(); // resizing a canvas resets its context state, including the mode
    painted = false;
  }

  function clear() {
    if (!painted) return;
    /* `clearRect` ignores globalCompositeOperation, so the mode set in
     * retheme() survives and does not need restoring every frame. */
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    painted = false;
  }

  /**
   * Paint one frame.
   *
   * @param {object} f
   * @param {THREE.Group}  f.group     - the globe group (carries the rotation)
   * @param {THREE.Camera} f.camera
   * @param {number} f.radiusPx        - the globe's on-screen radius, px
   * @param {number} f.p               - dive phase 0..1
   */
  function update({ group, camera, radiusPx, p }) {
    /* Handed off to the flat map, or the feed is down. An outage must not
     * light the sky: a globe that knows nothing has to LOOK like it knows
     * nothing (SPEC §5). The cage already goes grey; this simply goes out. */
    const fade = fx().glow * (1 - fadeCurve(p));
    if (fade <= 0 || getState?.() === 'unavailable') {
      setOpacity(0);
      clear();
      return;
    }

    const pts = getStormPoints?.() || [];
    const sx = canvas.width / cssW;
    const sy = canvas.height / cssH;
    const deepen = fx().glowDeepen;

    /* The eye direction in GLOBE space. A lamp bolted to the globe's skin aims
     * straight OUT along its own direction vector, so comparing the two is the
     * whole "is this storm pointed at the backdrop or at me" test. Doing it in
     * globe space means the group's rotation is already accounted for. */
    _eye
      .copy(camera.position)
      .applyMatrix4(_inv.copy(group.matrixWorld).invert())
      .normalize();

    /* Where the globe's centre lands on screen. The occlusion test below is a
     * distance from this point, and it is the same for every storm, so it is
     * computed once rather than per light. */
    _hit.set(0, 0, 0).applyMatrix4(group.matrixWorld).project(camera);
    const cx = (_hit.x * 0.5 + 0.5) * cssW * sx;
    const cy = (1 - (_hit.y * 0.5 + 0.5)) * cssH * sy;
    const rInner = radiusPx * GLOW.rimInner * Math.min(sx, sy);
    const rOuter = radiusPx * GLOW.rimOuter * Math.min(sx, sy);

    clear();

    let drawn = 0;
    for (let i = 0; i < pts.length && drawn < GLOW.maxLights; i++) {
      const pt = pts[i];
      if (!pt || pt.head !== true) continue; // one light per storm, not per track point
      if (!(pt.sev > 0)) continue;

      /* ==> IS THE LAMP POINTED AT THE WALL, OR AT YOU? <==
       *
       * A storm is a lamp on the globe's skin aiming straight outward. Light
       * only lands on the backdrop if that aim has a component AWAY from the
       * camera. A storm facing you lights nothing — its beam goes between you
       * and the globe, and there is no surface there to catch it.
       *
       * This is the rule the first cut got wrong. It drew each light at the
       * storm's own screen position, which is a halo around a lamp, not light
       * falling on a wall — so it read as the mesh glowing rather than as the
       * background being lit. */
      const away = -(pt.dir.x * _eye.x + pt.dir.y * _eye.y + pt.dir.z * _eye.z);
      if (away <= 0) continue;

      /* ==> WHERE THE BEAM LANDS: THE SAME DIRECTION, FURTHER OUT. <==
       *
       * The backdrop is a curved shell around the globe, `GLOW.wallRadius`
       * globe-radii out. A radial lamp fires along its own radius, so the
       * point it strikes on a concentric shell is simply its direction scaled
       * up — no ray/surface intersection to solve.
       *
       * A FLAT wall was the first thing tried and it is wrong for a reason
       * worth keeping: at the limb the beam runs parallel to a flat plane and
       * either misses it entirely or strikes it a hundred radii off-screen.
       * The limb is exactly where this effect lives, so the surface has to
       * curve around with the globe. */
      _hit.copy(pt.dir).multiplyScalar(GLOW.wallRadius).applyMatrix4(group.matrixWorld);
      _view.copy(_hit).applyMatrix4(camera.matrixWorldInverse);

      /* BEHIND THE CAMERA IS NOT A SMALL ERROR, IT IS A MIRRORED ONE. The
       * perspective divide flips sign past the eye plane, so an unguarded
       * project() puts the light on the exact OPPOSITE side of the screen at
       * full brightness. */
      if (_view.z > -GLOW.nearGuard) continue;

      _hit.project(camera);
      const px = (_hit.x * 0.5 + 0.5) * cssW * sx;
      const py = (1 - (_hit.y * 0.5 + 0.5)) * cssH * sy;
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;

      /* ==> THE GLOBE IS IN THE WAY. <==
       *
       * A storm pointed STRAIGHT back lands its light directly behind the
       * planet, where the planet hides it. Fading across the rim rather than
       * clipping at it is what makes a light swell as its storm rotates past
       * the limb and die as it goes deeper behind, instead of popping.
       *
       * Together with `away`, this is what confines the effect to a band: away
       * is zero at the limb and grows as a storm rotates behind, clearance is
       * full outside the disc and falls as the landing point slides inward.
       * Their product peaks just past the limb, which is the sweep. */
      const d = Math.hypot(px - cx, py - cy);
      if (d <= rInner) continue;
      const clearance = d >= rOuter ? 1 : smoothstep((d - rInner) / (rOuter - rInner));

      const r =
        radiusPx *
        GLOW.radiusScale *
        (GLOW.radiusFloor + (1 - GLOW.radiusFloor) * pt.sev) *
        Math.min(sx, sy);
      if (!(r > 0)) continue;
      if (px < -r || py < -r || px > canvas.width + r || py > canvas.height + r) continue;

      const a = Math.min(1, pt.sev * away * clearance * GLOW.intensity);
      if (a <= 0) continue;

      const rgb = rgbOf(pt.color, deepen);
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      /* Three stops, not two. A straight linear ramp to zero reads as a disc
       * with a soft edge; the extra mid stop is what makes it read as light
       * falling off. The alpha reaches zero at the rim in both themes, which
       * is the identity for `lighter` AND for `multiply` — so the blob has no
       * edge to catch the eye in either. */
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(GLOW.coreStop, `rgba(${rgb},${a * GLOW.coreAlpha})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();

      painted = true;
      drawn++;
    }

    setOpacity(painted ? fade : 0);
  }

  retheme();
  resize();

  return { update, resize, retheme, clear, canvas };
}
