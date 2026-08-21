/**
 * limb-glow.js — STORM LIGHT ON THE BACKDROP.
 *
 * Each storm throws soft colored light onto the space backdrop behind the
 * globe. Spin the planet and the colors sweep across the background with it.
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
 * scales it up.
 *
 * ==> THE UPSCALE IS NOT FREE SMOOTHING. THIS FILE CLAIMED IT WAS, AND THAT
 * CLAIM WAS THE WEAVE. <== An 8-bit alpha channel holds about 41 distinct
 * values at the shipped strength, so the falloff quantises into contour bands
 * inside the small buffer, and bilinear magnification stretches each band
 * boundary into a straight facet along the texel grid — a fine crosshatch, on
 * an image whose entire job is to be smooth. Aaron caught it on glass,
 * 2026-08-21. Resolution cannot fix it, because the band COUNT is set by alpha
 * depth rather than by pixel count; a bigger buffer only makes the weave finer.
 * The smoothing is done by a CSS blur on `#glow` (`--glow-blur`), which acts
 * after the magnification, where the artifact is made. `pixelScale` is free to
 * go down to pay for that blur.
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
 *   light  `multiply` inside, `multiply` outside  — colored glass. Two storms
 *          overlapping stack like filters: deeper, more saturated, never
 *          washed out.
 *
 * Additive is the one thing a pale backdrop cannot show — there is no headroom
 * above near-white — so the light theme does not attempt it. Multiplying a
 * category color into mid-grey darkens AND saturates, which is what makes it
 * read as an effect rather than a smudge. Same positions, same intensities,
 * one flag. It is the same call the far-side land and the cage nodes already
 * make in map/globe3d.js, for the same reason.
 *
 * TRANSPARENT IS THE IDENTITY FOR BOTH `screen` AND `multiply`, which is why
 * the canvas is simply cleared and never painted with a base color. Where
 * there are no storms, the backdrop is untouched, in either theme.
 *
 * Imports: config/ and map/glow-lights.js, which turns the cage's point list
 * into the light list this file paints. `THREE` is a global. Knows nothing
 * about storms — globe3d.js hands it points, a camera and a fade.
 */

import { GLOW } from '../config/constants.js';
import { buildLights } from './glow-lights.js';
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
 * '#rrggbb' -> 'r,g,b', with `saturate` (0..1) pushing it toward full chroma.
 *
 * ==> THE LIGHT THEME NEEDS SATURATION, NOT DARKNESS, AND THE FIRST TWO
 * ATTEMPTS BOTH GOT THIS BACKWARDS. <==
 *
 * Attempt one raised the alpha on the raw category color and was invisible.
 * Attempt two DARKENED the color so a multiply filter had something to
 * subtract, and Aaron's verdict on glass was immediate: "a dark smudge". Both
 * were right about the mechanism and wrong about the goal — anything that
 * lowers the backdrop's brightness reads as dirt or shadow, because that is
 * what a dark patch on a bright surface IS. Light cannot be made out of less
 * light.
 *
 * `mix-blend-mode: color` is the way out (see retheme). It takes the hue and
 * saturation from here and keeps the BACKDROP'S OWN brightness, so the gradient
 * is tinted rather than dimmed and nothing can ever go muddy.
 *
 * The consequence for this function is that the color's VALUE is discarded
 * downstream — only its hue and chroma survive. So pushing toward full
 * saturation costs nothing and is the only thing that makes the tint strong:
 * the §6 category ramp runs pale, and a pale source under `color` blending is
 * a pale tint. Mapping the channels so the darkest hits 0 and the brightest
 * hits 255 is full chroma at the same hue.
 */
function rgbOf(hex, saturate = 0) {
  const h = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  const n = parseInt(h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h, 16);
  if (!Number.isFinite(n)) return '255,255,255';
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  if (saturate <= 0) return `${r},${g},${b}`;
  const lo = Math.min(r, g, b);
  const hi = Math.max(r, g, b);
  if (hi === lo) return `${r},${g},${b}`; // a true grey has no hue to push
  const span = hi - lo;
  const pull = (c) => Math.round(c + saturate * (((c - lo) / span) * 255 - c));
  return `${pull(r)},${pull(g)},${pull(b)}`;
}


/**
 * @param {HTMLCanvasElement} canvas  - the #glow canvas
 * @param {object} opts
 * @param {() => Array} opts.getStormPoints  - heightfield's live point list
 * @param {() => string} opts.getState       - heightfield's feed state
 */
export function createLimbGlow(canvas, { getStormPoints, getState } = {}) {
  const ctx = canvas.getContext('2d');

  /* ==> ONE SCRATCH BUFFER, AND IT IS WHAT MAKES A STORM'S LIGHT INDEPENDENT
   * OF ITS CATEGORY. <==
   *
   * A storm's runs are drawn HERE first, blending with each other under plain
   * `source-over`, and the finished storm is then blitted onto the real canvas
   * as one image. So a storm contributes one storm's worth of light no matter
   * how many colors its ridge wears, and storms still stack with each other on
   * the main canvas under whichever operator the theme wants.
   *
   * ==> WHY IT IS NOT ENOUGH TO JUST STOP USING `lighter`. <== Additive was
   * the loud version of the bug — six runs at 0.16 alpha summed to 0.96, a
   * near-white hot spot over exactly the tallest part of the cage. But plain
   * `source-over` still accumulates, just more politely: the same six runs land
   * at 0.65. Four times a lone depression's light is still "brighter because it
   * got stronger", which is the thing Aaron asked for the light NOT to say
   * (2026-08-21). Only compositing the storm as a UNIT removes it.
   *
   * Same buffer size as the real canvas, same fifth-scale economics. `resize`
   * keeps them in step; nothing else may write to it. */
  const scratch =
    typeof document !== 'undefined' && document.createElement
      ? document.createElement('canvas')
      : null;
  const sctx = scratch ? scratch.getContext('2d') : null;

  let cssW = 1;
  let cssH = 1;
  let painted = false; // was anything drawn last frame? skips redundant clears
  let lastOpacity = null; // only touch the style when the number actually moves
  let lightsSrc = null; // the point array the light list below was built from
  let lights = [];

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
    /* ==> `color` IN LIGHT, NOT `multiply`. <==
     *
     * `multiply` can only ever darken, and a dark patch on a bright surface
     * reads as a smudge no matter how carefully its color is chosen — which
     * is exactly what shipped and exactly what came back off glass. `color`
     * takes the hue and saturation from this canvas and keeps the BACKDROP'S
     * OWN luminosity, so the gradient is tinted in place. It cannot darken,
     * so it cannot go muddy; the failure mode at the wrong strength is
     * "too colorful", which is a number, not a mechanism.
     *
     * Dark keeps `screen`, which is correct there and which Aaron has signed
     * off on glass. Do not unify these — the two themes need different
     * OPERATORS, not different values, and that is the whole point.
     *
     * ==> BLOBS STACK WITH PLAIN `source-over` IN LIGHT. THEY USED TO
     * `multiply`, AND MULTIPLY WAS WHY EVERYTHING LOOKED YELLOW. <==
     *
     * The old argument was that multiply deepens chroma where two storms
     * overlap, and chroma is the only channel `color` blending reads. True for
     * two blobs of the SAME hue and false — badly — for two of different ones,
     * because multiply is per-channel arithmetic with no idea what a hue is:
     *
     *   Cat 1 yellow saturates to (255,212,0). Multiplying by it leaves red
     *   and green essentially untouched and drives blue to ZERO. Yellow cannot
     *   be attenuated by anything else in the §6 ramp, so every overlap drifts
     *   warm and the blues and greens are erased.
     *
     *   Worse, it INVENTS colors. Yellow x TD blue is (0,140,0) — a green that
     *   is nowhere on the cage. A backdrop showing a hue no storm has is the
     *   same class of error as §5's silence: the picture states something the
     *   data does not.
     *
     * `source-over` is ordinary alpha blending, so an overlap lands BETWEEN
     * the two colors in proportion to how much of each is there. That is what
     * two lights on a wall actually do, it cannot manufacture a third hue, and
     * no color in the ramp gets special treatment. Aaron on glass, 2026-08-18.
     *
     * The cost is honest and small: two opposite hues at equal strength blend
     * toward neutral and tint weakly under `color`. That reads as "two
     * different storms are here", which is true. */
    canvas.style.mixBlendMode = light ? 'color' : 'screen';
    ctx.globalCompositeOperation = light ? 'source-over' : 'lighter';
    /* ==> THE SCRATCH IS ALWAYS `source-over`, IN BOTH THEMES, AND IT IS SET
     * HERE RATHER THAN LEFT TO THE DEFAULT. <== It happens to BE the default,
     * which is exactly why it has to be written down: a rule that holds only
     * because nobody touched it is a rule no test can see and no future edit
     * has to respect. This is the operator that makes a storm's own color runs
     * blend instead of sum, so it is load-bearing in a way the theme's
     * between-storm operator is not — it does not vary, and it may not. */
    if (sctx) sctx.globalCompositeOperation = 'source-over';
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
    if (scratch) {
      scratch.width = canvas.width;
      scratch.height = canvas.height;
    }
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
    /* Memoised on the array IDENTITY, which is safe because the heightfield
     * REPLACES `stormPoints` wholesale on every poll rather than mutating it
     * (map/heightfield.js `setStormPoints`). The split is pure and the list
     * changes maybe twice an hour; recomputing it per frame would be doing
     * ~1,500 string comparisons inside the gesture this effect decorates. */
    if (pts !== lightsSrc) {
      lightsSrc = pts;
      lights = buildLights(pts);
    }

    const sx = canvas.width / cssW;
    const sy = canvas.height / cssH;
    /* One bind, not three reads per storm — `fx()` is a property lookup and
     * this loop runs inside the gesture the effect exists to decorate. */
    const F = fx();
    const saturate = F.glowSaturate;
    const gain = F.glowGain;
    const spread = F.glowSpread;

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

    /* Insertion-ordered, so storms composite in the order `buildLights` found
     * them and the picture does not reshuffle between frames. Rebuilt each
     * frame rather than kept: a light's alpha depends on the camera, so last
     * frame's buckets are stale by definition. */
    const byStorm = new Map();
    const peakOf = new Map();

    let drawn = 0;
    for (let i = 0; i < lights.length && drawn < GLOW.maxLights; i++) {
      const pt = lights[i];

      /* ==> EVERY LIVE STORM LIGHTS THE BACKDROP. THE AIM WEIGHTS IT, IT DOES
       * NOT GATE IT. <==
       *
       * A storm is a lamp on the globe's skin aiming straight outward, and the
       * shell it lights curves all the way around — so there is nowhere a lamp
       * can point where NOTHING is lit. `aim` runs -1 (pointed at you) through
       * 0 (at the limb) to +1 (pointed straight away), and it decides how much
       * of the beam lands on backdrop the camera can see, not whether any of
       * it does.
       *
       * ==> THIS REPLACES A HARD CULL AT `aim <= 0`, AND THE CULL WAS THE BUG.
       * <== A storm on the near side of the planet threw no light at all, so a
       * Cat 4 sitting in plain view on the front of the globe lit nothing
       * while a weaker storm at the edge glowed. Aaron caught it on glass,
       * 2026-08-18. The rule the original cull was defending is still here and
       * still right — the light belongs on the WALL, at `wallRadius`, never at
       * the storm's own screen position — but a near-side lamp still throws
       * its beam past the planet onto the shell, further out and to the same
       * side, which is where this puts it.
       *
       * `GLOW.frontGain` is what a lamp pointed straight at you is worth
       * against one pointed straight away. Below 1 on purpose: the limb sweep
       * is still the hero and a front-lit storm is the quieter half of the
       * effect.
       *
       * `behind` is the aim's positive half, and it drives the SMEAR only. A
       * near-side light is a round pool because its beam is not grazing the
       * shell — the stretch is a fact about the geometry, not a decoration
       * that should apply everywhere. */
      const aim = -(pt.dir.x * _eye.x + pt.dir.y * _eye.y + pt.dir.z * _eye.z);
      const behind = aim > 0 ? aim : 0;
      const face = GLOW.frontGain + (1 - GLOW.frontGain) * (aim * 0.5 + 0.5);

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

      /* ==> THE GLOBE IS IN FRONT OF IT, NOT INSTEAD OF IT. <==
       *
       * A storm pointed straight back lands its light directly behind the
       * planet. The planet covers the MIDDLE of that light — it does not
       * delete it. The blob is over a globe radius across, so its outer falloff
       * still spills past the silhouette all the way round, and in the dark
       * theme the ocean is translucent, so what is left shines THROUGH the
       * planet as well.
       *
       * ==> THIS REPLACES A HARD CULL AT `d <= rInner`, AND THE CULL WAS THE
       * OTHER HALF OF THE BUG. <== The light did not fade as its storm rotated
       * behind the globe; it fell off a cliff and vanished, which is exactly
       * what Aaron reported on glass, 2026-08-18.
       *
       * `GLOW.rimFloor` is what survives once the landing point is fully
       * inside the disc. It is not 1: a light straight behind the planet IS
       * more hidden than one out in open sky, and keeping that difference is
       * what stops the effect flattening into a permanent ring. It is not 0
       * either, and that is the fix.
       *
       * The occlusion of the covered part costs nothing and is not done here —
       * the Three canvas paints above this one, so opaque continents hide the
       * light behind them and the clear ocean lets it through, for free, out
       * of the z-order that was already there (see the header). */
      const d = Math.hypot(px - cx, py - cy);
      const clearance =
        d >= rOuter
          ? 1
          : GLOW.rimFloor +
            (1 - GLOW.rimFloor) * smoothstep((d - rInner) / (rOuter - rInner));

      /* `spread` and `gain` are the theme's multipliers on the two dials that
       * actually change the look (see LIGHT.fx.glowGain). Both are exactly 1
       * in dark, so this is the shipped dark maths untouched — light needs a
       * stronger version of the same effect and the canvas opacity has no
       * headroom left to give it.
       *
       * ==> SIZE IS HOW MUCH CAGE WEARS THIS COLOR. IT USED TO BE SEVERITY.
       * <== `weight` is the number of beads in the run (see buildLights), so a
       * storm that held Cat 1 for three days throws a wide Cat 1 light and one
       * that touched Cat 4 for six hours throws a small red one. That is
       * Aaron's rule — "one color shouldn't overpower the others unless there
       * is just more of it" — and it is the ONLY channel left that can make one
       * color louder than another. */
      const r =
        radiusPx *
        GLOW.radiusScale * spread *
        (GLOW.radiusFloor +
          (1 - GLOW.radiusFloor) * Math.min(1, pt.weight / GLOW.runFull)) *
        Math.min(sx, sy);
      if (!(r > 0)) continue;

      /* ==> BRIGHTNESS DOES NOT TOUCH SEVERITY, AND THAT IS THE POINT. <==
       * It used to be multiplied by `pt.sev`, which said the same thing the
       * cage's ELEVATION already says and says louder — so a depression's
       * light was too faint to find next to a hurricane's, on top of the
       * category ramp's own luminance spread. Every color now shines at the
       * same strength and only geometry — where the storm is aimed, and how
       * much planet is in the way — moves it. */
      const a = Math.min(1, face * clearance * GLOW.intensity * gain);
      if (a <= 0) continue;

      /* ==> THE SMEAR: LIGHT ON A CURVED WALL IS AN ARC, NOT A DISC. <==
       *
       * A round pool of light is what you get on a flat wall hit square on.
       * This wall curves away in every direction, and the further past the
       * limb a storm has rotated the more GRAZING its beam is — so the patch
       * it throws stretches ALONG the curve and thins across it. That
       * stretching is most of what separates "light falling on a surface
       * behind the globe" from "a blob parked near the globe".
       *
       * Tangential, not radial: the major axis runs perpendicular to the line
       * from the globe's centre, so the light lies along the rim as an arc
       * that follows the silhouette. Stretching the other way would read as a
       * beam pointing at the viewer, which is the one thing this geometry says
       * cannot be happening.
       *
       * `behind` drives it — the aim's POSITIVE half only, so a storm at the
       * limb throws a round pool and grows into a smear as it rotates behind,
       * the elongation animating through the sweep for free off a number that
       * was already being computed. A near-side storm gets no smear at all,
       * which is right: its beam meets the shell head-on rather than grazing
       * it, so there is no curve for the patch to stretch along.
       *
       * The radial squash is not decoration. Stretching alone inflates the lit
       * area, and area is brightness once the falloffs overlap; thinning it
       * across the curve keeps a smeared light roughly as strong as a round
       * one instead of blooming as it elongates. */
      const stretch = 1 + GLOW.smear * behind;
      const squash = 1 - GLOW.squash * behind;
      const rMax = r * Math.max(stretch, squash);
      if (px < -rMax || py < -rMax || px > canvas.width + rMax || py > canvas.height + rMax) {
        continue;
      }

      /* NOT DRAWN YET. Everything above is per-BLOB geometry; what a blob is
       * finally worth depends on the brightest blob its STORM has, which is not
       * known until the whole list has been walked. See the compositing pass
       * below. */
      const bucket = byStorm.get(pt.storm);
      const rec = {
        px, py, r, stretch, squash, a,
        rot: Math.atan2(py - cy, px - cx) + Math.PI / 2,
        rgb: rgbOf(pt.color, saturate),
      };
      if (bucket) bucket.push(rec);
      else byStorm.set(pt.storm, [rec]);
      if (a > (peakOf.get(pt.storm) || 0)) peakOf.set(pt.storm, a);

      drawn++;
    }

    /* ==> ONE STORM, ONE STORM'S WORTH OF LIGHT. <==
     *
     * Each storm's runs go into the scratch buffer first, scaled so the
     * brightest of them is fully opaque there, and the finished storm is then
     * blitted onto the real canvas at that peak alpha. Two consequences, and
     * both are the point:
     *
     *   - Runs of ONE storm blend instead of summing, so a ridge that crossed
     *     six categories is exactly as bright as one that never left
     *     depression. The relative weighting between a storm's own runs
     *     survives, because each keeps its share of the storm's peak.
     *   - Runs of DIFFERENT storms still meet under the theme's operator on the
     *     main canvas — additive in dark, plain alpha in light. Two lights on a
     *     wall really are brighter than one, and unlike the case above that is
     *     a true statement about how many systems are out there.
     *
     * No scratch canvas (a non-browser host) falls back to painting straight
     * onto the main one. The picture is the old, stacking one; nothing throws. */
    for (const [storm, recs] of byStorm) {
      const peak = peakOf.get(storm) || 0;
      if (!(peak > 0)) continue;
      const target = sctx || ctx;
      if (sctx) sctx.clearRect(0, 0, scratch.width, scratch.height);

      for (const rec of recs) {
        /* Drawn in a rotated, scaled space so one radial gradient renders as an
         * ellipse. A canvas gradient cannot be elliptical on its own, and the
         * alternative — many stacked circles along an arc — is the overdraw
         * this whole layer is built to avoid. */
        target.save();
        target.translate(rec.px, rec.py);
        target.rotate(rec.rot);
        target.scale(rec.stretch, rec.squash);

        /* On the scratch the storm's peak is normalised to 1 and the blit
         * carries the real strength. That is not just tidiness: an 8-bit alpha
         * channel holds ~41 distinct values at `GLOW.intensity`, and drawing
         * the falloff at full range before scaling it down is the difference
         * between contouring in the buffer and contouring at composite time. */
        const a = sctx ? rec.a / peak : rec.a;
        const g = target.createRadialGradient(0, 0, 0, 0, 0, rec.r);
        /* ==> FLAT-TOPPED, NOT PEAKED — SEE GLOW.plateauStop. <== A bright
         * centre that fades outward is what a SOURCE looks like, and the eye
         * finds it every time. Holding the alpha essentially level across the
         * inner `plateauStop` leaves no centre to find; `coreStop` then rolls
         * the shoulder off so the tail does not read as a disc with a soft
         * edge. The alpha still reaches zero at the rim, which is the identity
         * for `lighter` AND for `color`, so there is no edge in either theme. */
        g.addColorStop(0, `rgba(${rec.rgb},${a})`);
        g.addColorStop(GLOW.plateauStop, `rgba(${rec.rgb},${a * GLOW.plateauAlpha})`);
        g.addColorStop(GLOW.coreStop, `rgba(${rec.rgb},${a * GLOW.coreAlpha})`);
        g.addColorStop(1, `rgba(${rec.rgb},0)`);
        target.fillStyle = g;
        target.beginPath();
        target.arc(0, 0, rec.r, 0, Math.PI * 2);
        target.fill();
        target.restore();
      }

      if (sctx) {
        /* The theme's operator lives on `ctx` and is what makes storms stack
         * with each other; `globalAlpha` is restored because it is context
         * state that `clearRect` does NOT reset. */
        ctx.globalAlpha = peak;
        ctx.drawImage(scratch, 0, 0);
        ctx.globalAlpha = 1;
      }
      painted = true;
    }

    setOpacity(painted ? fade : 0);
  }

  retheme();
  resize();

  return { update, resize, retheme, clear, canvas };
}
