/**
 * limb-rim.js — THE GLASS RIM AT THE HORIZON (SPEC-MAP.md §9.17).
 *
 * A soft ring painted exactly on MapLibre's limb once MapLibre owns the
 * picture: an edge all the way round, plus a stronger arc on one side so it
 * reads as light catching curved glass rather than as an outline somebody
 * drew.
 *
 * ---------------------------------------------------------------------------
 * WHY THE HORIZON HAS NOTHING ON IT WITHOUT THIS.
 *
 * Three separate facts stack up, and the first two are MapLibre's:
 *
 *   1. MapLibre paints NOTHING outside the sphere. The atmosphere pass is off
 *      (§9.6 — it is a full scattering pass with a fake sun that also darkens
 *      the disc, which is the terminator this app refuses to imply), and with
 *      it off nothing else fills those pixels.
 *   2. The whole `sky` block in map/style.js is INERT on the globe projection.
 *      MapLibre forces the sky's blend factor to 1 in globe mode, which fades
 *      `sky-color` / `horizon-color` / `fog-color` to fully transparent, and
 *      zeroes the fog opacity as well. Seven style properties, none of which
 *      reach a pixel.
 *   3. So the pixel just outside the limb is the CSS backdrop and the pixel
 *      just inside it is the sea — and in the light theme those are the SAME
 *      HEX. `space` is set to `ocean` exactly, on purpose, so that the 3D
 *      globe's own limb is the only edge (config/tokens.js). Once the 3D globe
 *      has faded there is no such limb, and the planet dissolves into the page.
 *
 * On a wide monitor the limb is still on screen long after the handoff. Bisected
 * against the live layer in a real browser: this rim switches off at z5.65 on a
 * 3440x1440 viewport, z4.67 on 1920x1080, z4.31 on 1512x945, and z3.02 on a
 * 390x844 phone — where it only appears from about z2.5, because below that the
 * 3D globe still owns the picture. That wide-screen band is what this layer
 * exists for, and it is why a phone pays almost nothing for it.
 *
 * ---------------------------------------------------------------------------
 * ==> WHERE THE RING GOES IS ASKED, NEVER DERIVED. <==
 *
 * The radius comes from `limbRadiusPx()` in map/marker-home-geometry.js, which
 * bisects on MapLibre's own `isLocationOccluded` for the exact arc where the
 * renderer stops drawing. That is not a tidiness choice — the obvious closed
 * form is wrong here, and wrong in a way that grows:
 *
 *   THE 3D GLOBE'S SILHOUETTE IS NOT MAPLIBRE'S. map/globe-follow.js matches the
 *   two globes at the CENTRE of the screen, which is correct and was itself a
 *   fix for an earlier overshoot — but the Three camera runs at DIVE.fov (42
 *   degrees) and MapLibre's at its own default (36.87), and two lenses matched
 *   in the middle do not agree at the edge, by more the further in you go.
 *
 *   AND THE CLOSED FORM IS ALSO 4% OUT, FOR A REASON NOBODY HAS RUN DOWN. On a
 *   900-tall viewport the rendered limb is at 487 px at zoom 3 and 794 px at
 *   zoom 4; radius = worldSize/2pi with MapLibre's field of view says 465 and
 *   761. Swept against the live transform, the projected radius peaks at the
 *   exact arc where the occlusion flag flips and `limbRadiusPx` returns that
 *   same number to a tenth of a pixel — so the ORACLE is right and one of the
 *   formula's two inputs is not what it is assumed to be. It does not matter
 *   which, because nothing here uses the formula. It is written down so the
 *   next session does not derive it and believe the answer.
 *
 * The bisection is 18 clipping-plane dot products and two projections per
 * frame, which is cheaper than one of this layer's own gradient fills. It is
 * NOT cached: a cache here would be keyed on the camera, and this only paints
 * on MapLibre's render event, which is to say only when the camera moved.
 *
 * ---------------------------------------------------------------------------
 * TWO FILLS, AND THE SECOND ONE IS NOT AN APPROXIMATION.
 *
 *   RING   a radial gradient reaching INWARD from the limb: nothing at the
 *          inner end, the sea deepening as it turns away (`oceanDeep`), then
 *          the rim itself hard against the edge (`atmosphere`).
 *   ARC    the same annulus filled with a LINEAR gradient of `atmosphereDeep`
 *          along the light direction, composited `source-atop` so it can only
 *          recolour the ring and never add ink of its own.
 *
 * A linear gradient across a ring IS an angular one, exactly. On a circle of
 * radius r the screen-space normal at angle t is (cos t, sin t), so the shading
 * term dot(normal, light) is cos(t - tLight) — and that is precisely what a
 * linear gradient along the light direction evaluates to at the point
 * (cx + r cos t, cy + r sin t). The 2D canvas has no conic gradient and does
 * not need one; there is no error term being tolerated here.
 *
 * ==> AND THE ARC SITS ON OPPOSITE SIDES IN THE TWO THEMES. <==
 * Dark: the lit side of a limb against a night sky is the BRIGHTER side, so
 * the arc goes toward the light. Light: you cannot make a highlight on
 * near-white paper — every attempt to add light to this backdrop has come back
 * off glass as a smudge — but a near-white ball reads as a ball because of the
 * shading that gathers on the side AWAY from the light. So the arc flips. One
 * sign, two themes, and `tools/test-limb-rim.mjs` pins it in both.
 *
 * ---------------------------------------------------------------------------
 * IT HANDS OFF FROM THE CAGE, ON THE CAGE'S OWN BAND.
 *
 * The 3D cage is the last thing with an outer silhouette during the dive, so
 * the rim rises on exactly `DIVE.fade.cage` as the cage falls on it. There is
 * never a moment with two edges and never a moment with none, and because both
 * read the same constant they cannot drift apart. Do not give this its own
 * band — that is the drift.
 *
 * ---------------------------------------------------------------------------
 * A 2D CANVAS, LIKE map/limb-glow.js, AND FOR THE SAME REASON: a third WebGL
 * context on a low-tier Android is a real risk when MapLibre and Three are
 * already holding two. Unlike that layer this one is drawn at 1:1 CSS pixels
 * rather than at a fraction — an edge is the one thing here with high-frequency
 * detail to lose, so it cannot be blurred back afterwards. Only the annulus is
 * ever touched, so the painted area is a band, not a screen.
 *
 * Imports config/, and map/marker-home-geometry.js for the one measurement.
 * Knows nothing about storms, and touches no WebGL.
 */

import { DIVE, RIM } from '../config/constants.js';
import { palette, fx, isLight } from '../config/theme.js';
import { smoothstep } from '../lib/geo.js';
import { limbRadiusPx } from './marker-home-geometry.js';

/** '#rrggbb' -> 'r,g,b' for building rgba() strings without re-parsing. */
function rgbOf(hex) {
  const h = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  const n = parseInt(h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h, 16);
  if (!Number.isFinite(n)) return '255,255,255';
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/**
 * @param {HTMLCanvasElement} canvas - the #rim canvas
 * @param {maplibregl.Map} map       - the map whose limb this rides on
 */
export function createLimbRim(canvas, map) {
  const ctx = canvas.getContext('2d');

  let cssW = 1;
  let cssH = 1;
  let painted = false; // was anything drawn last frame? skips redundant clears
  let lastOpacity = null; // only touch the style when the number actually moves
  let ink = { base: '', deep: '', sea: '' };

  function retheme() {
    const P = palette();
    ink = {
      base: rgbOf(P.atmosphere),
      deep: rgbOf(P.atmosphereDeep),
      sea: rgbOf(P.oceanDeep),
    };
  }

  function resize() {
    cssW = Math.max(1, window.innerWidth);
    cssH = Math.max(1, window.innerHeight);
    /* 1:1 CSS pixels, NOT devicePixelRatio. A retina buffer here is four times
     * the memory and four times the fill for an edge that is already soft on
     * its outer side; the inner edge lands within a CSS pixel either way. The
     * opposite call from map/limb-glow.js, which draws at a FIFTH scale — that
     * layer is soft everywhere and this one is not. */
    canvas.width = cssW;
    canvas.height = cssH;
    painted = false;
  }

  function clear() {
    if (!painted) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    painted = false;
  }

  function setOpacity(v) {
    if (v === lastOpacity) return;
    lastOpacity = v;
    canvas.style.opacity = String(v);
  }

  /**
   * MapLibre's limb radius on screen, in CSS px, or 0 if there is not one.
   *
   * Returns 0 on the flat transform and on any frame the projection refuses —
   * `limbRadiusPx` answers null for both, and a null must not become a zero
   * that a later comparison silently treats as "tiny globe".
   */
  function measure() {
    const c = map.getCenter?.();
    if (!c) return 0;
    /* The probe direction does not matter — with no tilt the limb is a circle
     * (map/globe.js sets `pitchWithRotate: false` and `touchPitch: false`), so
     * every bearing gives the same radius. A plain latitude offset is chosen
     * over a great-circle walk because it cannot fail near a pole: clamped, it
     * is still a different point from the centre, which is all the bisection
     * needs. */
    const lat = c.lat >= 0 ? c.lat - RIM.probeDeg : c.lat + RIM.probeDeg;
    const r = limbRadiusPx(map, c.lng, c.lat, c.lng, lat);
    return Number.isFinite(r) && r > 0 ? r : 0;
  }

  /**
   * Paint one frame.
   *
   * @param {object} f
   * @param {number} f.p  dive phase 0..1, from map/globe-follow.js
   */
  function update({ p }) {
    /* ==> THE HANDOFF FROM THE CAGE, AND THE CONSTANT IS SHARED ON PURPOSE.
     * <== The cage's opacity is `1 - smoothstep(p, ...DIVE.fade.cage)`, so this
     * is exactly its complement: the rim arrives at the rate the last 3D edge
     * leaves. Two readings of one band, which is one thing to get wrong instead
     * of two that must agree. */
    const dive = smoothstep(p, ...DIVE.fade.cage);
    if (dive <= 0) {
      setOpacity(0);
      clear();
      return;
    }

    const r = measure();
    if (r < RIM.minRadiusPx) {
      setOpacity(0);
      clear();
      return;
    }

    /* With the globe centred — which it is at every zoom, because MapLibre puts
     * the map centre at the viewport centre and there is no tilt — the limb
     * circle has left the screen entirely once its radius passes the
     * half-diagonal. Fade it out on the way rather than switching it off, or a
     * slow zoom pops the corners. */
    const halfDiag = Math.hypot(cssW / 2, cssH / 2);
    const spanOfScreen = r / halfDiag;
    const [near, far] = RIM.offScreen;
    const onScreen =
      spanOfScreen <= near
        ? 1
        : spanOfScreen >= far
          ? 0
          : 1 - smoothstep(spanOfScreen, near, far);
    if (onScreen <= 0) {
      setOpacity(0);
      clear();
      return;
    }

    const alpha = RIM.intensity * fx().rim;
    if (!(alpha > 0)) {
      setOpacity(0);
      clear();
      return;
    }

    const cx = cssW / 2;
    const cy = cssH / 2;
    /* ==> THE HIGHLIGHT IS ON THE PLANET, NOT AROUND IT. <== The reach goes
     * INWARD from the limb and scales with the ball; `bleedPx` is the couple of
     * pixels of softening on the outside and is not a bloom. See RIM's header
     * for the version that straddled the edge and read as a hoop. */
    const reach = Math.min(RIM.reachMaxPx, Math.max(RIM.reachMinPx, r * RIM.reachFrac));
    const rIn = Math.max(0, r - reach);
    const rOut = r + RIM.bleedPx;
    /* Where the limb itself falls between the two ends of the gradient. The
     * peak has to sit HERE and not at a round number, or the brightest line of
     * the ring is not the edge of the planet — which is the one thing this
     * layer is claiming to show. */
    const edge = (r - rIn) / (rOut - rIn);

    clear();

    /* The annulus, drawn once and reused by both fills. Even-odd with the two
     * circles is what keeps the rasteriser inside the band instead of walking
     * the whole viewport for a ring a few dozen pixels wide. */
    const band = () => {
      ctx.beginPath();
      ctx.arc(cx, cy, rOut, 0, Math.PI * 2);
      ctx.arc(cx, cy, rIn, 0, Math.PI * 2, true);
    };

    /* --- 1. the highlight on the limb ------------------------------------ */
    const g = ctx.createRadialGradient(cx, cy, rIn, cx, cy, rOut);
    /* Running OUTWARD from the inner end to the edge: nothing, then the sea
     * deepening as it turns away, then the rim itself. The two shoulder stops
     * sit well below a straight ramp, so the light is concentrated hard against
     * the silhouette rather than spread evenly across a band. */
    g.addColorStop(0, `rgba(${ink.sea},0)`);
    g.addColorStop(edge * RIM.tailStop, `rgba(${ink.sea},${alpha * RIM.tailAlpha})`);
    g.addColorStop(edge * RIM.shoulderStop, `rgba(${ink.base},${alpha * RIM.shoulderAlpha})`);
    /* The limb. */
    g.addColorStop(edge, `rgba(${ink.base},${alpha})`);
    /* And out. This is `bleedPx` wide — the softening on a hard edge, not a
     * halo. Anything that reads as a glow OUTSIDE the planet is the hoop this
     * profile exists to avoid. */
    g.addColorStop(1, `rgba(${ink.base},0)`);
    ctx.fillStyle = g;
    band();
    ctx.fill('evenodd');

    /* --- 2. the lit arc --------------------------------------------------- */
    /* The unit vector from the viewport centre toward the backdrop gradient's
     * own light source (RIM.lightAt mirrors the literal in index.html), so the
     * ring and the sky can never disagree about where the light is. */
    let lx = RIM.lightAt[0] - 0.5;
    let ly = RIM.lightAt[1] - 0.5;
    const llen = Math.hypot(lx, ly) || 1;
    lx /= llen;
    ly /= llen;
    /* ==> THE FLIP, AND IT IS THE WHOLE DIFFERENCE BETWEEN THE THEMES. <==
     * On a night sky the limb is brightest where the light strikes it. On
     * daylight paper there is no headroom above near-white, so the ring reads
     * instead through the shading that gathers on the far side. Same geometry,
     * opposite end. */
    const side = isLight() ? -1 : 1;
    const ax = cx + lx * rOut * side;
    const ay = cy + ly * rOut * side;
    const bx = cx - lx * rOut * side;
    const by = cy - ly * rOut * side;

    const gl = ctx.createLinearGradient(ax, ay, bx, by);
    gl.addColorStop(0, `rgba(${ink.deep},${RIM.glare})`);
    gl.addColorStop(0.5, `rgba(${ink.deep},${RIM.glareMid})`);
    gl.addColorStop(1, `rgba(${ink.deep},0)`);
    ctx.fillStyle = gl;

    /* ==> `source-atop`, AND IT IS WHAT STOPS THE ARC PUTTING A HARD EDGE BACK
     * ON THE INSIDE OF THE RING. <==
     *
     * This pass is a LINEAR gradient, so it varies around the circle and is
     * dead flat ACROSS the band — it has no falloff of its own. Painted with
     * plain alpha it lays a slab of even ink over the whole width and cuts
     * square at `rIn`, which is exactly what shipped and exactly what came back
     * off glass: "you still aren't fading in the inner edge, the inside
     * diameter." The base ring underneath was fading correctly the whole time;
     * the arc was covering it up.
     *
     * `source-atop` composites the arc ONLY where the ring already is, and
     * weighted by how much ring is there. The arithmetic is worth stating
     * because it is the whole reason this is one composite flag rather than a
     * masking pass: the result's alpha is the DESTINATION's, untouched, and the
     * colour lerps from the ring's to the arc's by the arc's own alpha. So the
     * radial falloff is the base's, always, and the arc can only change what
     * COLOUR the ring is at each point — never how much ink is there.
     *
     * That makes it structurally impossible for this pass to paint where the
     * ring does not, which is the invariant `tools/test-limb-rim.mjs` pins.
     * A masking pass would have cost a third fill of the same annulus to buy
     * the same guarantee.
     *
     * The arc's alphas are therefore NOT scaled by `alpha` any more — they are
     * a mix fraction now, not an ink quantity, and multiplying them by the
     * layer's strength would have made the arc weakest exactly where the ring
     * is strongest. */
    ctx.globalCompositeOperation = 'source-atop';
    band();
    ctx.fill('evenodd');
    ctx.globalCompositeOperation = 'source-over';

    painted = true;
    setOpacity(dive * onScreen);
  }

  retheme();
  resize();

  return { update, resize, retheme, clear, canvas };
}
