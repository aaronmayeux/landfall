/**
 * water-shader.js — THE TWO GLSL PROGRAMS FOR THE SEA, AND NOTHING ELSE.
 *
 * ==> WHY THEY ARE NOT IN THE RENDERER. <== `proto/volcano-3d.js` passed the
 * §12 line ceiling when the shoreline cut landed. These two strings are ~100
 * lines of a language that is not JavaScript, they have no dependencies beyond
 * one constant, and nothing else in the renderer reads them — which makes them
 * the cleanest cut available rather than the most convenient one.
 *
 * The water is the ONE thing on this layer that changes every frame, and that
 * is the whole reason it has a shader at all: baking a wave would mean
 * rewriting and re-uploading thousands of vertices per frame, where the GPU
 * does the same arithmetic for free. The rule the mountains follow is "do not
 * recompute per frame what is constant per field" — it was never "no shaders",
 * and a moving surface is the case it does not cover.
 *
 * Exports two strings. No THREE, no DOM.
 */

import { VOLCANO } from '../config/constants.js';

const WAVE = VOLCANO.map3d.water.wave;


/**
 * ==> THE SEA'S TROUGH IS PINNED AT SEA LEVEL, NOT CENTRED ON IT, AND THAT IS
 * LOAD-BEARING RATHER THAN COSMETIC. <== `volcanoBaseM()` places a seamount's
 * foot so that its summit lands at exactly `elev * vertical` — still under
 * water, with depth exaggerated by the same factor as height, so a seamount
 * cannot break the surface BY ARITHMETIC rather than by a clamp. Ahyi's summit
 * is 55 m down, which is 220 m in exaggerated space; a wave swinging +/-480 m
 * about zero would put a trough below it and pop the peak through the sea
 * roughly twice a second. Offsetting by +1 puts the surface in [0, 2A], so the
 * lowest the sea ever gets is exactly sea level and the invariant survives the
 * motion. The cost is that mean sea level sits one amplitude high, which at a
 * scale where the mountain under it is 20 km across is not visible.
 *
 * ==> AND THE CRESTS BRIGHTEN, WHICH IS WHAT MAKES THE MOTION READ AT ALL.
 * <== This map is mostly seen from above; at 60 degrees of tilt a 1 km swell on
 * a 20 km sheet is about a pixel of vertical movement. The lift MULTIPLIES the
 * baked alpha rather than adding to it, so the rim fade that stops the sheet
 * reading as a puddle survives — a crest at the rim is still transparent.
 *
 * NO BACKTICKS IN THESE TWO BLOCKS: they are inside a JS template literal.
 */
/**
 * ==> THE TWO SHADERS SHARE `train()`, BECAUSE IT WAS WRITTEN OUT TWICE. <==
 * Three lines, one definition, no behaviour change.
 *
 * NO BACKTICKS ANYWHERE BELOW: every one of these blocks is inside a JS
 * template literal, and one backtick ends the shader mid-function.
 */
const WATER_COMMON = `
float train(vec2 dir, float len, float speed, vec2 p) {
  float k = 6.2831853 / len;
  return sin(k * dot(dir, p) - k * speed * uTime);
}
`;

export const WATER_VERT = `
uniform float uTime;
uniform float uAmp;
uniform vec2 uLenD;
uniform vec2 uSpeedD;
uniform vec2 uDirD0;
uniform vec2 uDirD1;
attribute vec4 aColor;
/** This vertex in GLOBAL metres, so two clusters whose seas overlap share one
 *  continuous wave instead of each restarting at its own origin. */
attribute vec2 aWave;
varying vec4 vColor;
varying vec2 vWave;
` + WATER_COMMON + `
void main() {
  /* ==> ONLY THE LONG TRAINS BEND THE SURFACE. <== The short one is lit per
   * fragment below, where it costs nothing and cannot alias. Asking the grid to
   * carry it measured 289,487 vertices across the drawn set, for a flat sheet.
   * See wave.displaceCount.
   *
   * ==> AND THIS PASS IS DELIBERATELY NOT WARPED, THOUGH THE FRAGMENT PASS IS.
   * <== That looks like an inconsistency and is not. The warp compresses the
   * wave locally by up to its gradient — 43% at the shipped numbers — which
   * would take this grid from exactly 3.0 samples per wavelength to about 1.7,
   * under Nyquist, and a travelling wave sampled under Nyquist renders as a
   * STANDING zigzag. Surviving it means roughly tripling the water vertices.
   *
   * It buys nothing, because THIS SURFACE IS UNLIT. There are no normals and
   * one flat shade, so displacing it produces no shading whatsoever — only a
   * few pixels of parallax at the rim. Every visible thing about the wave
   * happens in the fragment shader. So the two passes disagree about where a
   * crest is by up to one warp amplitude, and there is nothing on screen that
   * can show it. If the sea ever gets a normal, this stops being true and the
   * grid has to be re-costed before the warp moves in here. */
  float h = (train(uDirD0, uLenD.x, uSpeedD.x, aWave)
           + train(uDirD1, uLenD.y, uSpeedD.y, aWave)) * 0.5;

  vec3 pos = position;
  pos.z += (h + 1.0) * uAmp;

  vColor = aColor;
  vWave = aWave;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

/**
 * ==> THE SHORELINE IS DECIDED HERE, BY LOOKING AT THE PICTURE UNDERNEATH.
 * <== `uMask` is a copy of the framebuffer taken by `proto/basemap-mask.js`
 * after MapLibre painted the ocean and before it painted anything else, so
 * every pixel in it is either the sea's colour or the land's. This fragment
 * samples the pixel directly beneath itself and asks which of the two it is
 * nearer to.
 *
 * `gl_FragCoord.xy` is in framebuffer pixels from the bottom-left, and the
 * copy was taken from the same origin at the same size with no flip, so
 * `gl_FragCoord.xy / uResolution` is an exact one-texel-to-one-fragment
 * lookup. Nothing is being approximated or resampled.
 *
 * ==> IT IS A RATIO, NOT A TOLERANCE, AND THAT IS WHY IT SURVIVES A RECOLOUR.
 * <== Comparing against a fixed distance would need re-tuning for every theme
 * and every world. Asking which anchor is NEARER needs no number at all —
 * `shore.softness` only sets how wide the uncertain band around the halfway
 * point is, which is what turns MapLibre's own antialiased coast pixel into a
 * soft edge instead of a staircase.
 *
 * ==> AND A PIXEL IT CANNOT IDENTIFY GETS NO WATER. <== `shore.maxDistance`
 * rejects anything far from BOTH anchors. Nothing but the basemap draws under
 * this layer today, so it never fires — it is there so that the day something
 * else does, the sea disappears rather than being painted confidently across
 * something unrecognised.
 *
 * NO BACKTICKS.
 */
export const WATER_FRAG = `
uniform float uFade;
uniform float uTime;
uniform float uCrest;
uniform vec3 uCrestRgb;
uniform float uCrestMix;
uniform float uSharp;
/** x = warp wavelength in metres, y = warp amplitude in metres. */
uniform vec2 uWarp;
uniform vec3 uLen;
uniform vec3 uSpeed;
uniform vec2 uDir0;
uniform vec2 uDir1;
uniform vec2 uDir2;
uniform sampler2D uMask;
uniform vec2 uResolution;
uniform float uMaskReady;
uniform vec3 uSeaRgb;
uniform vec3 uLandRgb;
uniform float uShoreSoft;
uniform float uShoreMax;
uniform float uDebugMask;
varying vec4 vColor;
varying vec2 vWave;
` + WATER_COMMON + `
/** ==> THE SAMPLING GRID IS BENT, AND WITHOUT THIS THE SEA IS A LATTICE. <==
 *  Three trains at fixed headings sum to something strictly periodic, and on
 *  glass that reads as a QUILT — a regular field of identical comma-shaped
 *  strokes, which is the one thing water never looks like. Adding trains or
 *  picking more awkward wavelengths only makes the repeat LONGER; it is still
 *  a repeat, and one sheet is not big enough for that to help.
 *
 *  Bending WHERE each train is sampled removes it outright: the crest lines
 *  wander along a long slow contour instead of running dead straight, so no
 *  two stretches of sea look alike out of the same three sines.
 *
 *  STATIC IN WORLD SPACE, no time term — a drifting warp deforms the pattern
 *  as well as moving it, which reads as the sea swimming rather than flowing.
 *  The 1.37 is simply not a round ratio, so the two axes of the bend do not
 *  line up into a grid of their own.
 *
 *  ==> AMPLITUDE x WAVENUMBER MUST STAY UNDER 1. <== Above that the bend's own
 *  gradient exceeds one and the grid folds through itself, which shows up as
 *  hard pinch lines rather than as texture. See wave.warpAmpM.
 *
 *  ==> IT IS IN THIS PASS ONLY. <== The vertex shader says why. */
vec2 warp(vec2 p) {
  float k = 6.2831853 / uWarp.x;
  return p + uWarp.y * vec2(sin(p.y * k), sin(p.x * k * 1.37));
}

/** 1 where the basemap beneath this pixel is sea, 0 where it is land, ramped
 *  between. Returns 1 with no mask rather than 0: a missing photograph should
 *  cost the shoreline cut, never the whole sea. */
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
  /* ==> THE CRESTS ARE LIT HERE, NOT IN THE GEOMETRY, AND THIS IS WHAT MAKES
   * THE SEA READ AS A SEA. <== Seen from above — which is most of this map — a
   * kilometre of swell on a twenty-kilometre sheet is about a pixel of vertical
   * movement. Brightness is the channel that actually carries the motion, and
   * per fragment it has no resolution limit, so all three trains run here
   * including the short one the grid cannot hold.
   *
   * vWave interpolates exactly across a flat sheet, so this is the true world
   * position of the pixel rather than an approximation.
   *
   * It MULTIPLIES the baked alpha rather than adding to it, so the rim fade
   * that stops the sheet reading as a puddle survives — a crest at the rim is
   * still transparent. */
  vec2 p = warp(vWave);
  float h = (train(uDir0, uLen.x, uSpeed.x, p)
           + train(uDir1, uLen.y, uSpeed.y, p)
           + train(uDir2, uLen.z, uSpeed.z, p)) / 3.0;

  float wet = wetness();

  /* ==> THE MASK CAN BE LOOKED AT DIRECTLY, AND THAT IS NOT A LUXURY. <== The
   * previous three attempts each shipped to a phone before anybody could see
   * whether the MASK was right, so a wrong cut and a wrong wiring looked
   * identical from the passenger seat. Here the whole sheet paints flat —
   * cyan where the shader believes there is sea, red where it believes there
   * is land — over the real map. If that edge does not sit on the coastline,
   * the mask is wrong; if it does and the water still spills, the fault is
   * downstream of this line. Ten seconds, and the two failures separate. */
  if (uDebugMask > 0.5) {
    gl_FragColor = vec4(mix(vec3(1.0, 0.16, 0.24), vec3(0.10, 0.95, 1.0), wet), 0.85);
    return;
  }

  /* ==> THE CREST CHANGES COLOUR, NOT ONLY OPACITY, AND WITHOUT THAT THE SEA
   * LOOKS STILL. <== Until 2026-07-31 this line painted vColor.rgb flat and let
   * alpha carry the whole wave. Over a near-black ocean a fifth more opacity of
   * a dark violet is about four thousandths of luminance — the motion was
   * mathematically present and could not be seen. Both channels now move
   * together: a crest is paler AND more opaque, which is what a lit water
   * surface actually does.
   *
   * It rides max(h, 0.0) exactly as the alpha lift does, off the same h, so
   * the bright pixels and the opaque pixels are the same pixels by construction
   * rather than by two curves that could drift. Troughs are left alone — a
   * surface darker than the sea it sits in reads as a hole, not as a wave.
   *
   * ==> AND IT IS SHARPENED, WHICH IS HALF OF WHY IT READS AS WATER. <== The
   * raw sum of three sines spends as much area near its peak as near its
   * trough, so an unsharpened highlight is a broad soft blob and the sea looks
   * like quilted fabric. Real water is mostly flat with narrow bright crests.
   * uSharp is the exponent that buys that: it costs one pow and it also cuts
   * the total lit area, which is what keeps the crests from competing with the
   * coastline. It is why uCrestMix is set higher than it would otherwise be —
   * moving one without the other changes the overall brightness of the sea. */
  float crest = pow(max(h, 0.0), uSharp);
  vec3 rgb = mix(vColor.rgb, uCrestRgb, crest * uCrestMix);

  float a = vColor.a * (1.0 + crest * uCrest) * wet;
  gl_FragColor = vec4(rgb, clamp(a, 0.0, 1.0) * uFade);
}
`;