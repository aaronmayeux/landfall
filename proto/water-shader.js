/**
 * water-shader.js — THE TWO GLSL PROGRAMS FOR THE SEA, AND NOTHING ELSE.
 *
 * ==> WHY THEY ARE NOT IN THE RENDERER. <== `proto/volcano-3d.js` passed the
 * §12 line ceiling when the shoreline cut landed. These are ~150 lines of a
 * language that is not JavaScript, they have no dependencies at all, and
 * nothing else in the renderer reads them.
 *
 * ---------------------------------------------------------------------------
 * ==> THE SURFACE IS FLAT, AND EVERYTHING YOU SEE IS LIGHT. <==
 *
 * This used to displace the sheet's vertices with two wave trains and then
 * paint a lighter colour where a third said the wave was high. It read as a
 * sticker with stripes on it, and the reason is that there was no optical
 * relationship between the camera, the light and the surface: brightness was a
 * function of HEIGHT, where in the real world it is a function of SLOPE seen
 * from a particular direction.
 *
 * So the geometry is now a flat plane and the waves exist only here, as a
 * NORMAL — the direction the surface faces at each pixel, computed exactly by
 * differentiating the same sines rather than by sampling neighbours. Three
 * things fall out of that normal, and together they are what a viewer reads as
 * water:
 *
 *   REFRACTION   the scene underneath is sampled at an offset, so the seamount
 *                and the seabed wobble. This is the strongest cue of the three
 *                on this map, because the camera mostly looks DOWN, which is
 *                exactly when you see THROUGH water rather than off it.
 *   SPECULAR     a glint where the surface tilts to bounce the layer's fixed
 *                sun toward the camera. The same sun the mountains are lit by,
 *                read from the same constant, so the two cannot disagree.
 *   FRESNEL      water is transparent looking straight down and reflective at
 *                grazing angles. THIS IS THE WEAKEST OF THE THREE HERE and it
 *                is nobody's fault: the camera tops out at 60 degrees of tilt,
 *                where real water reflects about 5% of what hits it. It gets
 *                dramatic past 75. What saves it is that a WAVE FACE tilted
 *                toward the camera adds its own slope to the angle, so the
 *                glancing patches are local rather than global. Fresnel here is
 *                a modulation on the wave, not a horizon effect.
 *
 * ==> AND DROPPING THE DISPLACEMENT MADE TWO OLD PROBLEMS DISAPPEAR RATHER
 * THAN GET FIXED. <== The grid no longer has to resolve any wavelength, so the
 * Nyquist floor that forced `minSamplesPerWave` is gone and the mesh is free to
 * be coarse. And "a seamount can never break the surface" stops being an
 * arithmetic argument about a wave offset and becomes true by construction,
 * because the surface is a plane at exactly zero.
 *
 * NO BACKTICKS ANYWHERE BELOW: every block here is inside a JS template
 * literal, and one backtick ends the shader mid-function.
 *
 * Exports two strings. No THREE, no DOM.
 */


/**
 * ==> THE VERTEX PASS HAS ONE JOB LEFT. <== Put the plane on screen and hand
 * two values across. Every train, every derivative and every lighting term
 * lives in the fragment pass, where resolution is free and a coarse mesh costs
 * nothing.
 */
export const WATER_VERT = `
attribute vec4 aColor;
/** This vertex in GLOBAL metres, so two clusters whose seas overlap share one
 *  continuous wave instead of each restarting at its own origin. */
attribute vec2 aWave;
varying vec4 vColor;
varying vec2 vWave;

void main() {
  vColor = aColor;
  vWave = aWave;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;


/**
 * ==> TWO TEXTURES, TWO DIFFERENT QUESTIONS, AND THEY MUST NOT BE MERGED. <==
 *
 * `uMask` is a copy of the framebuffer taken by `proto/basemap-mask.js` from
 * its own layer LOW in the style — after MapLibre painted the ocean and before
 * it painted a single line or label. Every pixel in it is either the sea's
 * colour or the land's, and that is the whole reason the shoreline test works:
 * it asks which of two known colours a pixel is nearer to. Put anything else in
 * that picture — a coastline glow, an orange plate seam — and the test punches
 * holes through the sea wherever one crosses.
 *
 * `uScene` is a SECOND copy, taken by `proto/scene-copy.js` from inside this
 * layer, after the mountains have drawn and before the water does. It is a
 * picture of the world as it will appear under the sea, and it exists to be
 * refracted. It is useless for the shoreline test — it has mountains in it —
 * and the mask is useless for refraction, because refracting a two-colour
 * stencil produces a wobbling coastline and nothing else.
 *
 * ==> AND WITH `uScene` THE COMPOSITE IS OURS, NOT THE BLENDER'S. <== Sampling
 * the background AND letting GL alpha-blend over that same background would
 * count it twice. So when the scene copy is available this shader mixes the
 * water over it by hand and hands back the sheet's RIM FADE alone as alpha —
 * which makes the sheet's edge a fade from refracted to un-refracted rather
 * than a fade to nothing. Before the first copy lands there is no background to
 * mix with, so it falls back to ordinary alpha blending and looks like the old
 * sea for one frame.
 *
 * NO BACKTICKS.
 */
export const WATER_FRAG = `
uniform float uFade;
uniform float uTime;
uniform float uOpacity;

uniform vec3 uCrestRgb;
uniform float uCrestMix;
uniform float uCrestSharp;

uniform vec3 uLen;
uniform vec3 uSpeed;
uniform vec2 uDir0;
uniform vec2 uDir1;
uniform vec2 uDir2;
uniform vec3 uAmp;
/** x = warp wavelength in metres, y = warp amplitude in metres. */
uniform vec2 uWarp;

uniform vec3 uHalf;
uniform float uSpecular;
uniform float uShine;
uniform float uRefractPx;

uniform sampler2D uMask;
uniform sampler2D uScene;
uniform float uSceneReady;
uniform vec2 uResolution;
uniform float uMaskReady;
uniform vec3 uSeaRgb;
uniform vec3 uLandRgb;
uniform float uShoreSoft;
uniform float uShoreMax;
uniform float uDebugMask;

varying vec4 vColor;
varying vec2 vWave;

/** ==> THE SAMPLING GRID IS BENT, AND WITHOUT THIS THE SEA IS A LATTICE. <==
 *  Three trains at fixed headings sum to something strictly periodic, and on
 *  glass that reads as a QUILT — a regular field of identical strokes, which is
 *  the one thing water never looks like. Adding trains or picking more awkward
 *  wavelengths only makes the repeat LONGER; it is still a repeat, and one
 *  sheet is not big enough for that to help. Bending WHERE each train is
 *  sampled removes it outright.
 *
 *  Static in world space, no time term — a drifting warp deforms the pattern as
 *  well as moving it, which reads as the sea swimming rather than flowing. The
 *  1.37 is simply not a round ratio, so the two axes of the bend do not line up
 *  into a grid of their own.
 *
 *  ==> AMPLITUDE x WAVENUMBER MUST STAY UNDER 1. <== Above that the bend's own
 *  gradient exceeds one and the grid folds through itself, which shows up as
 *  hard pinch lines rather than as texture. See wave.warpAmpM. */
vec2 warp(vec2 p) {
  float k = 6.2831853 / uWarp.x;
  return p + uWarp.y * vec2(sin(p.y * k), sin(p.x * k * 1.37));
}

/** Height and slope of all three trains at one point, in one pass.
 *
 *  ==> THE SLOPE IS A DERIVATIVE, NOT A DIFFERENCE OF NEIGHBOURS. <== The
 *  surface is a sum of sines and nobody has to guess at its gradient: the
 *  derivative of sin is cos, at an angle this function has already computed.
 *  That is exact, costs one extra cos per train, and needs no
 *  finite-difference epsilon to tune and no dFdx — which is an EXTENSION in
 *  WebGL1 and would have to be requested before it could be used at all.
 *
 *  Returns (height, dH/dx, dH/dy). Height is the mean of the three so it stays
 *  in [-1, 1] whatever the amplitudes; the slopes carry metres per metre.
 *
 *  ==> THE WARP'S OWN CHAIN-RULE TERM IS DELIBERATELY DROPPED. <== Strictly the
 *  slope should be multiplied by the warp's Jacobian, which differs from 1 by
 *  up to the warp's gradient. Carrying it means four more trig calls to nudge
 *  the STRENGTH of a highlight that is already scaled by an eyeballed constant.
 *  What it would fix is not visible; what it costs is. */
vec3 waves(vec2 p) {
  float h = 0.0;
  vec2 g = vec2(0.0);

  float k0 = 6.2831853 / uLen.x;
  float a0 = k0 * dot(uDir0, p) - k0 * uSpeed.x * uTime;
  h += sin(a0);
  g += uDir0 * (uAmp.x * k0 * cos(a0));

  float k1 = 6.2831853 / uLen.y;
  float a1 = k1 * dot(uDir1, p) - k1 * uSpeed.y * uTime;
  h += sin(a1);
  g += uDir1 * (uAmp.y * k1 * cos(a1));

  float k2 = 6.2831853 / uLen.z;
  float a2 = k2 * dot(uDir2, p) - k2 * uSpeed.z * uTime;
  h += sin(a2);
  g += uDir2 * (uAmp.z * k2 * cos(a2));

  return vec3(h / 3.0, g);
}

/** 1 where the basemap beneath this pixel is sea, 0 where it is land, ramped
 *  between. Returns 1 with no mask rather than 0: a missing photograph should
 *  cost the shoreline cut, never the whole sea.
 *
 *  ==> IT READS THE UNDISTORTED PIXEL, ON PURPOSE. <== Refracting the shoreline
 *  test as well as the picture would let the sea creep inland wherever a wave
 *  leaned the right way, which is the exact failure this cut exists to prevent.
 *  The waterline may WOBBLE later as a deliberate effect; it may not wobble as
 *  a side effect of something else. */
float wetness() {
  if (uMaskReady < 0.5) return 1.0;
  vec3 px = texture2D(uMask, gl_FragCoord.xy / uResolution).rgb;
  float dSea = distance(px, uSeaRgb);
  float dLand = distance(px, uLandRgb);
  if (min(dSea, dLand) > uShoreMax) return 0.0;
  float r = dSea / (dSea + dLand + 0.00001);
  return 1.0 - smoothstep(0.5 - uShoreSoft, 0.5 + uShoreSoft, r);
}

void main() {
  vec2 p = warp(vWave);
  vec3 w = waves(p);
  float wet = wetness();

  /* ==> THE MASK CAN BE LOOKED AT DIRECTLY, AND THAT IS NOT A LUXURY. <== The
   * three shoreline attempts before this one each shipped to a phone before
   * anybody could see whether the MASK was right, so a wrong cut and a wrong
   * wiring looked identical from the passenger seat. Here the whole sheet
   * paints flat — cyan where the shader believes there is sea, red where it
   * believes there is land — over the real map. If that edge does not sit on
   * the coastline the mask is wrong; if it does and the water still spills, the
   * fault is downstream of this line. */
  if (uDebugMask > 0.5) {
    gl_FragColor = vec4(mix(vec3(1.0, 0.16, 0.24), vec3(0.10, 0.95, 1.0), wet), 0.85);
    return;
  }

  /* ==> THE NORMAL, AND THERE IS NO EXAGGERATION FACTOR ON IT ANY MORE. <== A
   * slope multiplier of 4 sat here (a uniform, now deleted), set from a peak
   * measured on ONE train instead of the three summed. The real sum was 0.742,
   * which is 37 degrees, so the surface was being rendered at 71 — a wall — and
   * every term below then behaved correctly on nonsense. The slopes arriving
   * here are now the true ones, with each train given an amplitude derived from
   * its own wavelength so all three are equally steep. */
  vec3 N = normalize(vec3(-w.y, -w.z, 1.0));

  /* ==> THE GLINT DOES NOT KNOW WHERE THE CAMERA IS, AND THAT IS DELIBERATE.
   * <== uHalf is folded on the CPU from the fixed sun and a straight-down eye,
   * so this is a pure function of the surface normal. A view-dependent version
   * shipped first and was wrong twice: the whole sea re-patterned every time
   * the globe was rotated, and it disagreed with the mountains beside it, which
   * have never had a view term. A map's relief is lit from a fixed direction
   * regardless of which way north points, for exactly that reason.
   *
   * ==> FRESNEL WENT WITH IT, RATHER THAN BEING FAKED. <== Fresnel is by
   * definition a function of the angle between the surface and the EYE. With no
   * eye in the lighting there is nothing for it to be a function of, and a
   * constant called fresnel that is really a slope ramp is a lie in the code.
   * What it was doing — brightening tilted faces — the glint already does, and
   * having two additive near-white terms is what blew the sea out to opaque. */
  float spec = pow(max(dot(N, uHalf), 0.0), uShine) * uSpecular;

  /* The crest tint rides the wave's HEIGHT while the glint and the refraction
   * ride its SLOPE. Colour belongs to the top of a wave, light to its face. */
  float crest = pow(max(w.x, 0.0), uCrestSharp);
  vec3 lit = mix(vColor.rgb, uCrestRgb, crest * uCrestMix) + uCrestRgb * spec;

  float rim = clamp(vColor.a, 0.0, 1.0) * wet * uFade;

  if (uSceneReady > 0.5) {
    /* ==> REFRACTION — THE SCENE UNDERNEATH, SAMPLED WHERE THE SURFACE SENDS
     * THE EYE. <== Offset in PIXELS, converted to texture space here, so how
     * far things wobble does not change with the size of the phone. */
    vec2 uv = gl_FragCoord.xy / uResolution + N.xy * (uRefractPx / uResolution);
    uv = clamp(uv, vec2(0.0), vec2(1.0));
    vec3 under = texture2D(uScene, uv).rgb;
    /* ==> THE COVERAGE IS A CONSTANT AND MUST STAY ONE. <== It was
     * uOpacity + sheen * (1 - uOpacity) — more opaque where the surface was
     * more reflective, which is true of real water and which drove this term to
     * 1.0 on every wave face. The refraction was computed and then mixed
     * completely out, and the sea lost all of its transparency. Whatever the
     * light does, the water covers what is under it by exactly uOpacity. */
    gl_FragColor = vec4(mix(under, lit, uOpacity), rim);
  } else {
    gl_FragColor = vec4(lit, rim * uOpacity);
  }
}
`;
