/**
 * world-deep.js — the dot-matrix glass globe.
 *
 * PROTOTYPE CODE. Not wired into the app.
 *
 * THE ORB IS THE PLANET. The glass sphere sits at radius 1.0, its edge is the
 * planet's edge, and THE GLASS IS ITS OWN LIGHT — the two-tone lives on the
 * ball's front face, so the coloured edge sits exactly on the silhouette. There
 * is no shell, no halo and nothing to size. The dots float above the glass on
 * one plane they share with the land sheet.
 *
 * The glass read is lifted straight from map/globe3d.js, which already solved
 * it: the near hemisphere draws normally, the far hemisphere is faint and
 * ADDED rather than painted over, so the far side shows through as light
 * instead of as a dark wash. Same trick, applied to dots instead of land fill —
 * except one point cloud can do both, because a dot knows which way it faces.
 *
 * The dots are not decoration a wave gets drawn on top of — the dots ARE the
 * wave. Ten waves at once cost exactly what none cost. Lift and brightness both
 * come from the same number, so a dot that rises is always a dot that brightens.
 *
 * THE FIELD COVERS THE WHOLE PLANET, land and water at the same spacing and the
 * same brightness, as ONE point cloud carrying a per-dot land/sea flag. That is
 * not a cosmetic addition: the dots are the wave medium, and a medium that stops
 * at the coast is a wave with a bug. The flag stays because the sea is where a
 * second layer would modulate the field — see the sea block in AIR below.
 *
 * `THREE` is a CDN global, same as map/globe3d.js.
 * Imports: proto/, config/constants.js and lib/geo.js.
 */

import { DIVE } from '../config/constants.js';
import { DEEP_WORLD } from '../config/worlds/deep.js';
import { prefersReducedMotion } from '../config/motion.js';
import { smoothstep } from '../lib/geo.js';
import { arcLengths } from '../lib/plate-lines.js';
import { loadPlateLines } from '../map/plate-seams.js';

/** Dots are placed by a golden-angle spiral, NOT a latitude/longitude grid.
 *  A lat/lon grid bunches points at the poles and thins them at the equator,
 *  so Greenland turns to mush while Brazil looks sparse. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const DEEP = {
  /** The glass orb. This is the planet — its limb is the planet's limb. */
  orbRadius: 1.0,
  /** ==> THE DOTS AND THE LAND SHEET SHARE ONE PLANE, AND IT IS NO LONGER THE
   *  CAGE PLANE. <== They used to be 1.065 (`DIVE.cageRadius`, imported so the
   *  dot shell and the shipped globe's node mesh could not drift) and 1.050.
   *  Both are 1.050 now, chosen on glass 2026-07-29 — the shell reads as
   *  standing off the glass at 5% just as it does at 6.5%, and the continents
   *  and their dots being coplanar is what stops the sheet reading as a
   *  separate object sliding under the field.
   *
   *  The cage link is deliberately CUT, not accidentally lost: this is a look
   *  number for this world now, not a shared plane, and the two are free to
   *  disagree. `shellRadius` is one constant so the sheet and the dots still
   *  cannot drift from EACH OTHER, which is the pairing that matters here. */
  shellRadius: 1.05,
  /** Plate seams sit on the glass itself. */
  seamRadius: 1.004,
  /** How tightly the lit edge hugs the limb. Lower = the colour washes further
   *  across the face of the glass. */
  edgePower: 2.6,
  edgeIntensity: 1.5,

  /** Dot diameter as a fraction of the spacing between dots. */
  dotFraction: 0.44,
  minDots: 2000,
  maxDots: 90000,
  /** Fraction of a dot's spacing that a full-strength wave lifts it. */
  liftFraction: 1.6,

  /* ---- THE SEA DOTS ------------------------------------------------------
   * The field covers the water too. It has to: the dots ARE the wave medium,
   * and a medium that stops at the coast is a ripple with a bug — a quake off
   * Japan has to send something across the Pacific.
   *
   * ==> THE DEFAULT IS PARITY: ONE UNIFORM FIELD OVER THE WHOLE PLANET. <==
   * The first pass shipped the sea deliberately sparser and dimmer, on the
   * reasoning that the ocean is 71% of the ball and the only thing ever drawing
   * a coastline was the CONTRAST between dots and empty glass. On glass that
   * reasoning lost: the continents still read at parity, because the land sheet
   * underneath is doing that job, and one even field reads as a made object
   * where two densities read as an effect. Confirmed 2026-07-29.
   *
   * THE THREE KNOBS STAY, at parity values, and they are the thing to reach for
   * if the coastlines ever stop reading — sparser, smaller, dimmer, in that
   * order of effect. They are not dead code: the sea is where drought and sea
   * state would modulate the field if either lands.
   */
  /** Sea spacing as a MULTIPLE of the land spacing, never its own pixel
   *  number — one slider still owns density and the two fields cannot drift.
   *  At exactly 1 the two passes generate the SAME spiral and split it between
   *  them, so the seam at the coast is perfect rather than merely close. */
  oceanSpacingMultiple: 1,
  /** Sea dot diameter as a fraction of the LAND spacing, not of its own. Sized
   *  off its own spacing a sparser sea dot would also be a BIGGER one, and the
   *  water would out-shout the continents it is supposed to sit behind. */
  oceanSizeFraction: 0.44,
  /** How bright a sea dot is against a land dot. */
  oceanBrightness: 1,

  /** How much of the far hemisphere shows through the glass. Same idea as
   *  OPACITY.land3dBack in the shipped globe. */
  farSideFade: 0.15,
  /** How opaque the glass is. Lower lets more starfield through. */
  glassOpacity: 0.88,

  /* ---- THE LAND SHEET (§ the floating fill) -----------------------------
   * A translucent white sheet of the continents, floating between the glass and
   * the dots. It is NOT painted on the glass, on purpose.
   *
   * ==> AND THAT IS NORMALLY HOW YOU GET A DOUBLE RIM. <== The note above
   * GLASS_FRAG is the whole story: a shell is brightest at ITS OWN edge, so any
   * lit surface floating off the ball rings at its own radius and you see two
   * silhouettes. The fix here is not to move it back down — it is that this
   * sheet takes NO limb term at all. Its colour comes only from the light
   * DIRECTION, the same `k` the glass uses, so the tint sweeps across the
   * continents as the planet turns and nothing brightens at the edge. Float it
   * as high as you like; it cannot draw a hoop, because nothing tells it where
   * its own edge is.
   */
  /** Sphere subdivision for the land sheet. The mask is 1024x512, so past
   *  roughly this the coastline stops getting sharper and the triangles are
   *  just cost. One draw call either way. */
  fillSegments: 128,
  fillOpacity: 0.3,
  /** How much of the orb's glow the white sheet picks up. 0 = flat white,
   *  1 = the glow colour itself with no white left in it. */
  fillTint: 0.55,
  /** Plate seams take the same treatment at their own strength — they read as
   *  drawn lines rather than as a veil, so they carry more colour. */
  seamTint: 0.8,

  colors: {
    /* ---- ALL DERIVED FROM THE ULTRAVIOLET PAIR. -------------------------
     * cold 0x3311AA, warm 0xC64BE8. Nothing below is an independent choice:
     * each one is that pair pushed light or dark, so the whole planet reads as
     * one object lit one way instead of four things that happen to be nearby.
     * If the rim pair changes, the sheet and the seams follow it on their own
     * (they read uCold/uWarm live); these three fixed values do not, and that
     * is the seam to watch if another palette is ever promoted. */

    /** The glass itself: the cold violet taken almost to black, so the unlit
     *  face is still violet rather than a neutral charcoal. */
    glass: 0x070314,
    /** A dot at rest: white walked a few steps toward the warm end. */
    dot: 0xECE4F8,
    /** A dot at the crest of a wave. Near white with the warm hue still in it,
     *  so a peak reads as the same light getting brighter. */
    dotHot: 0xFDF2FF,
  },

  /** Rim pairs. Each one deliberately avoids the fixed hazard ramps in SPEC.md
   *  §6 — no Saffir-Simpson hue, no watch/warning hue, nothing sitting on the
   *  USGS shaking scale. `ember` is the reference image's own blue-and-orange,
   *  kept only for comparison. */
  rims: {
    ultraviolet: { name: 'Ultraviolet', cold: 0x3311aa, warm: 0xc64be8 },
    aurora: { name: 'Aurora', cold: 0x0b6e5f, warm: 0x6fe3b0 },
    quartz: { name: 'Rose quartz', cold: 0x4a2e7a, warm: 0xe86aa8 },
    sodium: { name: 'Sodium', cold: 0x1a2e6e, warm: 0xf2e6b0 },
    ember: { name: 'Ember (reference)', cold: 0x0055ff, warm: 0xff5500 },
  },
  defaultRim: 'ultraviolet',

  dotOpacity: 0.95,
  seamOpacity: 0.45,

  /** THE SHIMMER (SEAM_FRAG). How much of the near-white `hot` colour a crest
   *  reaches, how many wave crests fit into a degree of seam, and how fast they
   *  travel along it.
   *
   *  ==> AND IT IS OFF ENTIRELY UNDER REDUCE-MOTION. <== Not dampened, off. A
   *  continuously glowing, travelling light is close to the centre of what that
   *  preference is asking to be spared, and unlike the globe's idle drift there
   *  is no information in it — the seams say exactly the same thing standing
   *  still. `SIZE.stormDot3dPx`-style dampening would be the wrong answer here:
   *  half a shimmer is still a shimmer. Read once at build time rather than per
   *  frame; the OS setting changing mid-session is not worth a listener on a
   *  prototype, and a world rebuild picks it up.
   *
   *  ==> SUBTLE ON PURPOSE, AND `shimmer` IS THE ONE TO TURN DOWN FIRST. <== At
   *  1.0 the crests hit full white and the seam network reads as a string of
   *  fairy lights — which is a decoration, and this globe's seams are the one
   *  place a fixed hazard ramp is nearly in reach (`config/worlds/deep.js`). At
   *  0.55 a crest lands well short of the top pass MapLibre draws, so the two
   *  renderers still agree about how bright a seam gets.
   *
   *  `shimmerScale` is in radians per degree of arc: 0.55 puts a crest roughly
   *  every 11° of boundary, which at the space floor is a few crests visible per
   *  major seam — enough to read as movement, few enough not to strobe.
   *
   *  `shimmerSpeed` is radians per second, so a crest travels about 2°/s of arc.
   *  DELIBERATELY SLOWER THAN IT WANTS TO BE: rock is not water. Anything past
   *  about 4 read as a scanning line rather than as heat moving.
   *
   *  NONE OF THESE THREE HAS BEEN SEEN ON A PHONE. */
  shimmer: prefersReducedMotion() ? 0 : 0.95,
  shimmerScale: 0.7,
  shimmerSpeed: 1.6,
  /** Crest sharpness. LOWER IS MORE VISIBLE, which is counter-intuitive enough
   *  to be worth stating: the exponent is applied to a 0..1 wave, so raising it
   *  squeezes the bright part into a shorter and shorter fraction of the seam.
   *  At 3 the crests were brief flecks — correct for "mostly cooling crust", and
   *  reported on glass as too subtle to see. At 1.8 the bright part is a
   *  travelling band rather than a spark, while the troughs still spend most of
   *  their length at the base colour. Push toward 1 for a plain sine, which
   *  reads as a lighting artefact rather than as heat. */
  shimmerSharpness: 1.8,
  /** How much the crest lifts OPACITY as well as colour. Both together read as
   *  brightness; colour alone reads as a paint job and opacity alone reads as the
   *  line breaking up. */
  shimmerLift: 1.1,
  /** Where the light comes from, in world space, so the warm edge stays put
   *  instead of swimming around as the planet turns. Up and to the right. */
  lightDir: [0.75, 0.5, 0.3],
};

const DOT_VERT = `
#define MAX_RIPPLES 8
uniform vec3 uOrigins[MAX_RIPPLES];
uniform vec3 uParams[MAX_RIPPLES];
uniform int  uCount;
uniform float uLift;
uniform float uSize;
uniform float uSizeOcean;
uniform float uScale;
uniform float uRadius;
/** 0 on land, 1 on water. One point cloud, two fields — a second THREE.Points
 *  would be a second draw call for a difference two mix() calls can carry. */
attribute float aOcean;
varying float vGlow;
varying float vFacing;
varying float vOcean;

void main() {
  vOcean = aOcean;
  vec3 n = normalize(position);
  float w = 0.0;
  for (int i = 0; i < MAX_RIPPLES; i++) {
    if (i >= uCount) break;
    float d = acos(clamp(dot(n, uOrigins[i]), -1.0, 1.0));
    float t = (d - uParams[i].x) / uParams[i].z;
    w += uParams[i].y * exp(-t * t);
  }
  w = clamp(w, 0.0, 1.0);
  vGlow = w;

  vec3 p = n * (uRadius + w * uLift);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);

  /* Which way does this dot face? Positive means it is on the near side of the
   * glass; negative means we are looking at it THROUGH the planet. */
  vec3 nView = normalize(normalMatrix * n);
  vFacing = dot(nView, normalize(-mv.xyz));

  gl_Position = projectionMatrix * mv;
  /* THE LIFT IS DELIBERATELY NOT SCALED BY FIELD. Both fields rise by the same
   * world distance, so a ripple crossing a coastline keeps one wave height
   * instead of stepping up as it hits the water. */
  float size = mix(uSize, uSizeOcean, aOcean);
  gl_PointSize = size * (1.0 + w * 0.55) * uScale / max(0.001, -mv.z);
}
`;

const DOT_FRAG = `
uniform vec3 uDot;
uniform vec3 uHot;
uniform float uOpacity;
uniform float uFarFade;
uniform float uOceanDim;
varying float vGlow;
varying float vFacing;
varying float vOcean;

void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float r2 = dot(c, c);
  if (r2 > 0.25) discard;
  float edge = smoothstep(0.25, 0.08, r2);

  /* Far-side dots stay visible but drop right back, the way the shipped globe
   * shows its far continents through the glass. The band around zero is the
   * limb, where a dot is edge-on. */
  float near = smoothstep(-0.12, 0.12, vFacing);
  float vis = mix(uFarFade, 1.0, near);

  /* Sea dots are the same colour, only dimmer — this is one material, not two
   * looks. A wave crest still goes to uHot on water, so a ripple reads as the
   * same light travelling rather than as two effects handing off at the coast. */
  float field = mix(1.0, uOceanDim, vOcean);

  vec3 col = mix(uDot, uHot, vGlow);
  gl_FragColor = vec4(col, uOpacity * vis * edge * field * (0.55 + 0.45 * vGlow));
}
`;

/* ==> THE ONE PLACE THE GLOW COLOUR IS DECIDED FOR ANYTHING THAT IS NOT THE
 * GLASS ITSELF. <== The land sheet and the plate seams both take their colour
 * from the orb's light, and they are two surfaces, so this is a shared function
 * rather than the same four lines written twice. If they ever disagreed about
 * where the light is, the sheet and the seams would tint in different
 * directions on the same planet and there would be nothing on screen to tell
 * you which was wrong.
 *
 * IT DELIBERATELY HAS NO LIMB TERM. See the fillRadius note above — the absence
 * of one is what lets these float off the ball without ringing at their own
 * edge. Compare GLASS_FRAG, which DOES take a limb term, because the glass's
 * own edge is the planet's edge and is the one silhouette allowed to light up.
 *
 * `n` is the VIEW-space normal, matching GLASS_FRAG: the light stays put in the
 * sky and the planet turns underneath it, so a continent sweeps cold-to-warm as
 * it comes round. A world-space light would turn with the land and the colour
 * would never move. */
const GLOW_TINT = `
uniform vec3 uCold;
uniform vec3 uWarm;
uniform vec3 uLightDir;
uniform float uTint;

vec3 glowTint(vec3 n) {
  float k = dot(normalize(n), normalize(uLightDir)) * 0.5 + 0.5;
  vec3 lit = mix(uCold, uWarm, smoothstep(0.30, 0.95, k));
  /* White FIRST, glow mixed into it — a translucent sheet that picks the colour
   * up, not a coloured sheet that happens to be pale. */
  return mix(vec3(1.0), lit, uTint);
}
`;

/* Geometry is built at unit radius and pushed out here, so the height slider
 * moves the sheet without rebuilding a single buffer. */
const FILL_VERT = `
uniform float uRadius;
varying vec2 vUv;
varying vec3 vN;
varying float vFacing;

void main() {
  vUv = uv;
  vec3 n = normalize(position);
  vec4 mv = modelViewMatrix * vec4(n * uRadius, 1.0);
  vN = normalize(normalMatrix * n);
  vFacing = dot(vN, normalize(-mv.xyz));
  gl_Position = projectionMatrix * mv;
}
`;

const FILL_FRAG =
  GLOW_TINT +
  `
uniform sampler2D uMask;
uniform float uOpacity;
uniform float uFarFade;
varying vec2 vUv;
varying vec3 vN;
varying float vFacing;

void main() {
  /* The mask is the land canvas land-mask.js already built for the dots —
   * white on land, black at sea. Ocean is DISCARDED, not blended: the empty
   * half of the planet then costs nothing, which is what makes a full-sphere
   * transparent sheet affordable at all. */
  if (texture2D(uMask, vUv).r < 0.5) discard;

  /* Far-side continents drop right back, exactly as the dots do — same
   * constant, same curve, so the sheet and the dot field agree about which
   * hemisphere you are looking through. */
  float near = smoothstep(-0.12, 0.12, vFacing);
  float vis = mix(uFarFade, 1.0, near);

  gl_FragColor = vec4(glowTint(vN), uOpacity * vis);
}
`;

/* `aArc` is DISTANCE ALONG THE SEAM, in degrees, accumulated per boundary as the
 * geometry is built. It is what makes the shimmer TRAVEL rather than pulse: a
 * wave in a per-vertex coordinate moves along the line, and a wave in time alone
 * makes every seam on the planet brighten and dim together, which reads as the
 * screen flickering rather than as rock glowing. */
const SEAM_VERT = `
uniform float uRadius;
attribute float aArc;
varying vec3 vN;
varying float vArc;

void main() {
  vec3 n = normalize(position);
  vN = normalize(normalMatrix * n);
  vArc = aArc;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(n * uRadius, 1.0);
}
`;

/* ==> THE SHIMMER, AND IT LIVES HERE AND NOWHERE ELSE. <==
 *
 * MapLibre's copy of these seams is deliberately STATIC (see the note in
 * `map/style.js plateLayers`): animating a paint property means a full map
 * redraw every frame, forever. Up here the renderer is already drawing, the
 * seams are 1 px lines, and a couple of sines in their fragment shader is as
 * close to free as an effect gets. So Deep shimmers from space and holds still
 * once you are down on the map. Aaron's call, 2026-07-30.
 *
 * TWO WAVES AT INCOMMENSURATE FREQUENCIES, travelling opposite ways. One sine is
 * a metronome — you see the period within about two seconds and it stops reading
 * as heat. Two that never line up read as turbulence. The frequencies are
 * deliberately not a neat ratio.
 *
 * CRESTS ARE SHARP, TROUGHS ARE LONG. `pow(max(0, wave), 3)` spends most of the
 * seam's length at its base colour and lifts brief bright flecks out of it,
 * which is what molten rock actually looks like: mostly cooling crust with hot
 * cracks moving through it. A plain sine gives an even ripple that reads as a
 * lighting artefact.
 *
 * THE CREST GOES TO `uHot`, THE SAME NEAR-WHITE MAPLIBRE'S TOP PASS USES. That
 * is the one place these two renderers' magma stacks meet: MapLibre gets its
 * white core as a third line layer, and up here — where a line is one pixel wide
 * and cannot BE stacked — the same colour arrives as the shimmer's crest
 * instead. Same three colours, two different ways of spending them. */
const SEAM_FRAG =
  GLOW_TINT +
  `
uniform vec3 uHot;
uniform float uOpacity;
uniform float uTime;
uniform float uShimmer;
uniform float uShimmerScale;
uniform float uShimmerSpeed;
uniform float uShimmerSharpness;
uniform float uShimmerLift;
varying vec3 vN;
varying float vArc;

void main() {
  float a = sin(vArc * uShimmerScale - uTime * uShimmerSpeed);
  float b = sin(vArc * uShimmerScale * 0.37 + uTime * uShimmerSpeed * 0.63);
  float crest = pow(max(0.0, a * 0.65 + b * 0.35), uShimmerSharpness);
  float k = crest * uShimmer;

  /* Opacity lifts WITH the colour, not instead of it. A crest that only changed
   * hue would read as a paint job; one that only changed opacity would read as
   * the line breaking up. Both together read as brightness. */
  gl_FragColor = vec4(mix(glowTint(vN), uHot, k), uOpacity * (1.0 + k * uShimmerLift));
}
`;

const GLASS_VERT = `
varying vec3 vN;
varying vec3 vView;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

/* The colour is a property of THE GLASS, not of anything around it.
 *
 * ==> THIS IS WHY EVERY EARLIER VERSION DREW A HOOP. <== They were all separate
 * shells, and a shell is brightest at its OWN edge — so it rings at whatever
 * radius it sits at, and no amount of resizing walks that ring onto the planet.
 * Lighting the ball's own front face instead puts the bright edge exactly at
 * the silhouette, which IS the globe's diameter and the diameter the plate
 * boundaries are drawn on. There is nothing left to size. */
const GLASS_FRAG = `
uniform vec3 uBase;
uniform vec3 uCold;
uniform vec3 uWarm;
uniform vec3 uLightDir;
uniform float uPower;
uniform float uIntensity;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vView;

void main() {
  /* 1 exactly at the limb, 0 straight down the middle of the disc. */
  float f = 1.0 - abs(dot(normalize(vN), normalize(vView)));
  f = pow(clamp(f, 0.0, 1.0), uPower);

  /* The mix runs off the VIEW-space normal, not the world one. The orb turns,
   * so a world-space light would turn with it and the warm side would swim
   * around the planet. In view space the light stays where it is in the sky. */
  float k = dot(normalize(vN), normalize(uLightDir)) * 0.5 + 0.5;
  vec3 lit = mix(uCold, uWarm, smoothstep(0.30, 0.95, k));

  gl_FragColor = vec4(uBase + lit * f * uIntensity, uOpacity);
}
`;

/**
 * @param {object} deps
 * @param {{isLand:(lon:number,lat:number)=>boolean}} deps.mask
 * @param {object} deps.ripples  a ripple field from proto/ripple-field.js
 * @param {(state:string, text:string)=>void} [deps.onStatus]
 */
/**
 * @param {object} opts
 * @param {object} [opts.volcanoes] a `createVolcanoMarks()` layer, or nothing.
 *   ==> PASSED IN RATHER THAN BUILT HERE, AND THAT IS THE SAME CALL `ripples`
 *   MAKES. <== This world owns its scene graph and its fade curves; it does not
 *   own the volcano layer's data, its lifetime, or its fetch. Building it here
 *   would put a network call inside a world constructor and make the layer
 *   unreachable from any other world — and §42.1 already says volcanoes live in
 *   their own file precisely because this one is past the size trigger.
 */
export function createDeepWorld({ mask, ripples, volcanoes = null, onStatus = () => {} }) {
  /** Turns with the planet. */
  const spin = new THREE.Group();
  /** Does NOT turn — the atmosphere is lit from a fixed direction. */
  const fixed = new THREE.Group();

  const disposables = [];
  const track = (o) => {
    disposables.push(o);
    return o;
  };

  /* ---- the glass orb: this IS the planet, and it is its own light ---- */
  const orbGeo = track(new THREE.SphereGeometry(DEEP.orbRadius, 96, 64));
  const orbMat = track(
    new THREE.ShaderMaterial({
      vertexShader: GLASS_VERT,
      fragmentShader: GLASS_FRAG,
      uniforms: {
        uBase: { value: new THREE.Color(DEEP.colors.glass) },
        uCold: { value: new THREE.Color() },
        uWarm: { value: new THREE.Color() },
        uLightDir: { value: new THREE.Vector3().fromArray(DEEP.lightDir).normalize() },
        uPower: { value: DEEP.edgePower },
        uIntensity: { value: DEEP.edgeIntensity },
        uOpacity: { value: DEEP.glassOpacity },
      },
      side: THREE.FrontSide,
      transparent: true,
      /* Depth ON and WRITING: the far-side plate seams still have to hide
       * behind the glass, the way the shipped globe's cage does. */
      depthTest: true,
      depthWrite: true,
    })
  );
  const orb = new THREE.Mesh(orbGeo, orbMat);
  orb.renderOrder = 0;
  spin.add(orb);

  /* ---- the land sheet: continents floating between glass and dots ------ */

  /** A unit sphere carrying EQUIRECTANGULAR uvs, so the land mask maps onto it
   *  with no guesswork. THREE.SphereGeometry's own uv seam does not line up
   *  with the mask's longitude convention, and chasing that offset is how you
   *  end up with Africa in the Pacific — this builds the mapping explicitly
   *  from the same lon/lat the mask was rasterised on. */
  function maskSphere(seg) {
    const pos = [];
    const uv = [];
    const idx = [];
    for (let iy = 0; iy <= seg; iy++) {
      const lat = 90 - 180 * (iy / seg);
      for (let ix = 0; ix <= seg; ix++) {
        const lon = -180 + 360 * (ix / seg);
        const v = toVec(lon, lat, 1);
        pos.push(v[0], v[1], v[2]);
        /* v is (lat+90)/180 and NOT (90-lat)/180 because a CanvasTexture is
         * flipped on load — v = 0 is the BOTTOM of the canvas, which is the
         * south pole. Same pairing map/globe3d.js uses against the same
         * rasterisation. */
        uv.push((lon + 180) / 360, (lat + 90) / 180);
      }
    }
    for (let iy = 0; iy < seg; iy++) {
      for (let ix = 0; ix < seg; ix++) {
        const a = iy * (seg + 1) + ix;
        const b = a + 1;
        const c = a + (seg + 1);
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  /* THE MASK CANVAS IS ALREADY IN MEMORY. land-mask.js rasterised it at startup
   * for the dot field and hands its canvas back, so the sheet costs no second
   * rasterise and nothing downloaded. For contrast, the shipped globe spends
   * ~511 ms in texImage2D on a 4096x2048 land texture on every cold load; this
   * is 1024x512 and already paid for. */
  const fillTex = track(new THREE.CanvasTexture(mask.canvas));
  const fillGeo = track(maskSphere(DEEP.fillSegments));
  const fillMat = track(
    new THREE.ShaderMaterial({
      vertexShader: FILL_VERT,
      fragmentShader: FILL_FRAG,
      uniforms: {
        uMask: { value: fillTex },
        uRadius: { value: DEEP.shellRadius },
        uCold: { value: new THREE.Color() },
        uWarm: { value: new THREE.Color() },
        uLightDir: { value: new THREE.Vector3().fromArray(DEEP.lightDir).normalize() },
        uTint: { value: DEEP.fillTint },
        uOpacity: { value: DEEP.fillOpacity },
        uFarFade: { value: DEEP.farSideFade },
      },
      side: THREE.DoubleSide,
      transparent: true,
      /* Depth OFF for the same reason the dots have it off: which side of the
       * planet a fragment is on is decided by its facing in the shader, not by
       * the depth buffer, so the far continents can glow through the glass
       * instead of being clipped by it. Writing depth here would also punch the
       * seams out from under the sheet. */
      depthTest: false,
      depthWrite: false,
    })
  );
  const fill = new THREE.Mesh(fillGeo, fillMat);
  /* Painted in the order the layers physically sit: glass, seams, sheet, dots.
   * No sorting trick, so nothing has to be re-reasoned if a radius moves. */
  fill.renderOrder = 2;
  spin.add(fill);

  /** @param {string} key one of DEEP.rims */
  function setRim(key) {
    const p = DEEP.rims[key] || DEEP.rims[DEEP.defaultRim];
    /* BOTH, every time. The sheet reads the pair live, so a palette change
     * re-tints the planet — and a setter that updated only the orb would leave
     * a surface lit by the previous palette with nothing on screen naming which
     * was stale.
     *
     * ==> THE SEAMS ARE NO LONGER IN THIS LIST, AND THAT IS THE POINT. <== They
     * were, and it made them a violet line network laid over an orchid
     * coastline — the same family, so on the map you could not tell which was
     * which. They now hold `DEEP_WORLD.plates`, the app's own glow cyan, set
     * once below and never touched by the rim. Adding them back here is how the
     * two networks become indistinguishable again. */
    for (const m of [orbMat, fillMat]) {
      m.uniforms.uCold.value.setHex(p.cold);
      m.uniforms.uWarm.value.setHex(p.warm);
    }
  }

  /* ---- the dots -------------------------------------------------------- */
  const dotMat = track(
    new THREE.ShaderMaterial({
      vertexShader: DOT_VERT,
      fragmentShader: DOT_FRAG,
      uniforms: {
        uOrigins: { value: ripples.origins },
        uParams: { value: ripples.params },
        uCount: { value: 0 },
        uLift: { value: 0.02 },
        uSize: { value: 0.006 },
        uSizeOcean: { value: 0.006 },
        uScale: { value: 600 },
        uRadius: { value: DEEP.shellRadius },
        uDot: { value: new THREE.Color(DEEP.colors.dot) },
        uHot: { value: new THREE.Color(DEEP.colors.dotHot) },
        uOpacity: { value: DEEP.dotOpacity },
        uFarFade: { value: DEEP.farSideFade },
        uOceanDim: { value: DEEP.oceanBrightness },
      },
      transparent: true,
      /* Depth OFF: the far-side dots must show THROUGH the glass. Which side a
       * dot is on is decided by its facing in the shader, not by the depth
       * buffer — same read as the shipped globe's far continents. */
      depthTest: false,
      depthWrite: false,
    })
  );

  let dotGeo = null;
  let dots = null;
  let dotCount = 0;
  let landCount = 0;
  let oceanCount = 0;

  /* Live because the panel drives them; the multiple forces a rebuild, the
   * brightness is one uniform and is free to drag. */
  let oceanMultiple = DEEP.oceanSpacingMultiple;
  let oceanWanted = true;

  /**
   * Rebuild the dot field for a given on-screen spacing.
   * @param {number} spacingPx     gap between neighbouring dots, in CSS pixels
   * @param {number} globePxRadius how big the planet is right now, in CSS pixels
   */
  function setSpacing(spacingPx, globePxRadius) {
    /* How many points fit on the ball at this spacing, packed in a honeycomb:
     * each point owns about 0.866 * spacing^2 of surface. */
    const areaPx = 4 * Math.PI * globePxRadius * globePxRadius;
    const perPoint = 0.866 * spacingPx * spacingPx;
    const landTotal = Math.max(
      DEEP.minDots,
      Math.min(DEEP.maxDots, Math.round(areaPx / perPoint))
    );

    /* ==> THE SEA COUNT IS DERIVED FROM THE LAND COUNT, NOT RECOMPUTED FROM
     * ITS OWN SPACING. <== Spacing scales as the square root of density, so
     * dividing by the multiple squared is the same wider spacing — with one
     * difference that matters: run through the clamps a second time and at the
     * extremes both fields hit `minDots` or `maxDots` and land on the SAME
     * density, which is precisely the case where the continents vanish. This
     * way "further apart" is structural and cannot be clamped away. */
    const oceanTotal = oceanWanted
      ? Math.round(landTotal / Math.max(1, oceanMultiple * oceanMultiple))
      : 0;

    const pos = [];
    const kind = [];

    /* One golden-angle spiral over the whole ball, keeping the points that
     * belong to this field. Two passes, two totals, one buffer. */
    const lay = (total, wantLand, flag) => {
      let kept = 0;
      for (let i = 0; i < total; i++) {
        const y = 1 - ((i + 0.5) * 2) / total;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const th = i * GOLDEN_ANGLE;
        const x = Math.cos(th) * r;
        const z = Math.sin(th) * r;
        const lat = (Math.asin(y) * 180) / Math.PI;
        const lon = (Math.atan2(x, z) * 180) / Math.PI;
        if (mask.isLand(lon, lat) !== wantLand) continue;
        pos.push(x, y, z);
        kind.push(flag);
        kept++;
      }
      return kept;
    };

    landCount = lay(landTotal, true, 0);
    oceanCount = oceanTotal > 0 ? lay(oceanTotal, false, 1) : 0;

    if (dots) {
      spin.remove(dots);
      dotGeo.dispose();
    }
    dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    dotGeo.setAttribute('aOcean', new THREE.Float32BufferAttribute(kind, 1));
    dots = new THREE.Points(dotGeo, dotMat);
    dots.frustumCulled = false;
    dots.renderOrder = 3;
    spin.add(dots);
    dotCount = pos.length / 3;

    /* Spacing in world units on a unit sphere is just spacing-in-pixels over
     * the planet's pixel radius. Dot size and wave lift both derive from it, so
     * the look holds together at every density. */
    const spacingWorld = spacingPx / Math.max(1, globePxRadius);
    dotMat.uniforms.uSize.value = spacingWorld * DEEP.dotFraction;
    dotMat.uniforms.uSizeOcean.value = spacingWorld * DEEP.oceanSizeFraction;
    dotMat.uniforms.uLift.value = spacingWorld * DEEP.liftFraction;

    return dotCount;
  }

  /* ---- plate boundaries ------------------------------------------------ */
  let seams = null;
  /** What the SEAMS TOGGLE wants. Kept apart from `seams.visible`, which the
   *  dive fade also drives — without this, flying in and back out silently
   *  turns the checkbox's answer into 'on'. */
  let seamsWanted = true;
  /** What the OPACITY SLIDER wants, kept apart from the live uniform, which the
   *  dive fade also drives. Same reason as seamsWanted. */
  let fillBase = DEEP.fillOpacity;
  let seamGeo = null;
  const seamMat = track(
    new THREE.ShaderMaterial({
      vertexShader: SEAM_VERT,
      fragmentShader: SEAM_FRAG,
      uniforms: {
        uRadius: { value: DEEP.seamRadius },
        uCold: { value: new THREE.Color() },
        uWarm: { value: new THREE.Color() },
        uHot: { value: new THREE.Color() },
        uLightDir: { value: new THREE.Vector3().fromArray(DEEP.lightDir).normalize() },
        uTint: { value: DEEP.seamTint },
        uOpacity: { value: DEEP.seamOpacity },
        uTime: { value: 0 },
        uShimmer: { value: DEEP.shimmer },
        uShimmerScale: { value: DEEP.shimmerScale },
        uShimmerSpeed: { value: DEEP.shimmerSpeed },
        uShimmerSharpness: { value: DEEP.shimmerSharpness },
        uShimmerLift: { value: DEEP.shimmerLift },
      },
      transparent: true,
      /* Depth ON so the far-side seams hide behind the glass instead of drawing
       * straight through the planet — the same call globe3d.js makes for its
       * cage, and the reason the sphere reads as a solid object. */
      depthTest: true,
      depthWrite: false,
    })
  );

  function toVec(lon, lat, r) {
    const la = (lat * Math.PI) / 180;
    const lo = (lon * Math.PI) / 180;
    const c = Math.cos(la);
    return [r * c * Math.sin(lo), r * Math.sin(la), r * c * Math.cos(lo)];
  }

  /* THE SEAM PAIR, SET ONCE. Same two colours MapLibre paints the plate lines
   * with (`config/worlds/deep.js`), fed in as the material's cold/warm pair — so
   * the seams still sweep with the light like every other surface on this
   * globe, they are just a different metal. Identical colours in both renderers
   * is what stops the lines changing hue partway through the dive. */
  seamMat.uniforms.uCold.value.set(DEEP_WORLD.plates.glow);
  seamMat.uniforms.uWarm.value.set(DEEP_WORLD.plates.core);
  /* THE THIRD COLOUR ARRIVES AS THE SHIMMER'S CREST, NOT AS A THIRD LINE. Down
   * on the map the near-white core is a third stacked line layer; a WebGL line
   * is one pixel wide and cannot be stacked, so up here the same colour is what
   * a crest reaches instead. Both renderers spend the same three colours. */
  seamMat.uniforms.uHot.value.set(DEEP_WORLD.plates.hot);

  /* CALLED HERE, NOT BESIDE ITS DEFINITION. setRim writes into the orb and the
   * sheet, both declared above this line and below the definition — calling it
   * any earlier is a temporal-dead-zone crash on boot rather than a subtle
   * bug. */
  setRim(DEEP.defaultRim);

  /* ==> THE SAME GEOMETRY MAPLIBRE DRAWS, FROM THE SAME CALL. <== This used to
   * fetch and parse the raw PB2002 file here, in parallel with MapLibre fetching
   * it separately for its own source, and each built its own line geometry. Two
   * readers of one file is fine; two INDEPENDENT constructions of one shape is
   * not, because these seams are pixel-locked to MapLibre's through the dive and
   * nothing would tell you when the two drifted apart.
   *
   * `map/plate-seams.js` owns the single fetch and `lib/plate-lines.js` the
   * single construction — already smoothed with the storm tracks' own curve, and
   * already split at the antimeridian, which is why the guard that used to live
   * in this loop is gone rather than duplicated.
   *
   * The status callback still belongs to this world, because what a person sees
   * when the file does not arrive is a §5 question about THIS screen. */
  /* THE MARKS TURN WITH THE PLANET, so they go in `spin` — a volcano is a
   * place on the ground, not a fixed light like the atmosphere. Added here,
   * after the seams, so it is above them in the group order; `renderOrder` on
   * the points is what actually decides the overlap, since depth testing is off
   * for both layers. */
  if (volcanoes) spin.add(volcanoes.group);

  onStatus('loading', 'Plate boundaries loading…');
  loadPlateLines()
    .then(({ seams: fc, stats }) => {
      if (!stats.boundaries) {
        onStatus('empty', 'Plate boundaries: file loaded, no lines in it');
        return;
      }
      const pts = [];
      /* ARC LENGTH ALONG EACH BOUNDARY, in degrees, restarting at every one.
       * SEAM_FRAG's shimmer is a wave in this, so it travels along a seam instead
       * of pulsing the whole network in step. Restarting per boundary is right
       * rather than lazy: a global running total would make one continuous wave
       * train crossing unrelated seams, and the crests would line up across
       * boundaries that have nothing to do with each other. */
      const arcs = [];
      for (const f of fc.features) {
        const c = f.geometry.coordinates;
        /* THE SAME MEASURE THE LABEL ANCHORS USE (`lib/plate-lines.js`), imported
         * rather than re-derived. A second copy of "distance along a boundary"
         * would be a second thing to keep in step with the first. */
        const arc = arcLengths(c);
        for (let i = 0; i < c.length - 1; i++) {
          pts.push(...toVec(c[i][0], c[i][1], DEEP.seamRadius));
          pts.push(...toVec(c[i + 1][0], c[i + 1][1], DEEP.seamRadius));
          arcs.push(arc[i], arc[i + 1]);
        }
      }
      seamGeo = new THREE.BufferGeometry();
      seamGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      seamGeo.setAttribute('aArc', new THREE.Float32BufferAttribute(arcs, 1));
      seams = new THREE.LineSegments(seamGeo, seamMat);
      seams.renderOrder = 1;
      spin.add(seams);
      onStatus('ok', stats.boundaries + ' plate boundaries');
    })
    .catch((e) => {
      onStatus('error', 'Plate boundaries unavailable — ' + e.message);
    });

  return {
    id: 'deep',
    spin,
    fixed,

    setSpacing,
    setRim,

    /** How far the dot shell floats above the glass. */
    setDotHeight(r) {
      dotMat.uniforms.uRadius.value = r;
    },

    /** How the field splits, for the readout. Land first — it is the one whose
     *  count decides whether the phone is going to be happy. */
    counts() {
      return { land: landCount, ocean: oceanCount, total: dotCount };
    },

    /** Sea spacing as a multiple of land spacing. REBUILDS — the caller has to
     *  follow this with setSpacing(), same as moving the spacing slider. */
    setOceanSpacing(mult) {
      oceanMultiple = Math.max(1, mult);
    },

    /** Sea dots on or off. Also a rebuild — off means the points are not in the
     *  buffer at all, so "off" measures as genuinely cheaper rather than as a
     *  fully transparent pass still being paid for. */
    setOceanVisible(on) {
      oceanWanted = !!on;
    },

    /** How bright a sea dot is against a land dot. One uniform, free to drag. */
    setOceanBrightness(b) {
      dotMat.uniforms.uOceanDim.value = b;
    },

    /** How far the land sheet floats above the glass. */
    setFillHeight(r) {
      fillMat.uniforms.uRadius.value = r;
    },

    setFillOpacity(o) {
      fillMat.uniforms.uOpacity.value = o;
      fillBase = o;
    },

    /** How much orb glow the white sheet picks up, 0 (flat white) to 1. */
    setFillTint(t) {
      fillMat.uniforms.uTint.value = t;
    },

    setSeamsVisible(on) {
      if (seams) seams.visible = on;
      seamsWanted = on;
    },

    /**
     * Fade this world out as MapLibre takes the screen.
     *
     * @param {number} p dive phase, 0 (space) to 1 (map owns the screen)
     *
     * EACH LAYER LEAVES ON THE CURVE ITS SHIPPED COUNTERPART LEAVES ON, so the
     * prototype's handoff reads like the app's rather than like a dissolve.
     * The dots and the seams are this world's answer to the cage and its nodes,
     * so they go on the node/cage bands; the glass sphere is its land, so it
     * goes on the land band and clears out early — a glass ball still hanging
     * over a street map is the thing that looks broken.
     */
    setFade(p) {
      const nodeF = 1 - smoothstep(p, ...DIVE.fade.nodes);
      const landF = 1 - smoothstep(p, ...DIVE.fade.land);
      dotMat.uniforms.uOpacity.value = DEEP.dotOpacity * nodeF;
      /* THE MARKS RIDE THE NODE BAND WITH THE DOTS, not the land band with the
       * seams. Reasoning is on `setFade` in `proto/volcano-marks.js`: a mark is
       * this world's answer to a cage node, and on the land band it would
       * outlive the shell it floats on.
       *
       * RAW `p` GOES WITH IT because the volcano layer has a SECOND thing on
       * this axis: the flat pips cross-fade into real edifices as you descend
       * (§42.1.3, `VOLCANO.shapes.shapeIn`). That band is its own, deliberately
       * not one of `DIVE.fade`'s — those describe when a layer LEAVES, and this
       * one describes when a layer changes what it is. */
      if (volcanoes) volcanoes.setFade(nodeF, p);
      /* ==> THE SEAMS LEAVE ON THE LAND BAND, WITH THE COASTLINE. <== They rode
       * the CAGE band until MapLibre grew plate lines of its own, and that is
       * how they vanished: cage runs to p 0.62 — about z3.9 — and below it
       * there was nothing drawing plate boundaries at all, so they got sharper
       * as the planet grew and then simply stopped. Now the same feature exists
       * in both renderers and this is a HANDOFF, so it uses the handoff's own
       * band: `land` is what `map/globe3d.js` fades its coastline on, and it
       * ends exactly where `mapIn` brings MapLibre to full. */
      seamMat.uniforms.uOpacity.value = DEEP.seamOpacity * landF;
      /* The sheet IS this world's land, so it leaves on the land band with the
       * glass rather than with the dots. `fillBase` rather than the constant,
       * so a dive does not silently undo whatever the opacity slider was set
       * to — the same trap seamsWanted exists to close. */
      fillMat.uniforms.uOpacity.value = fillBase * landF;
      fill.visible = landF > 0;
      orbMat.uniforms.uOpacity.value = DEEP.glassOpacity * landF;
      orbMat.uniforms.uIntensity.value = DEEP.edgeIntensity * landF;
      /* Hiding outright once invisible saves the draw call rather than paying
       * for a fully transparent pass — the one budget §40.1 says binds. */
      if (seams) seams.visible = seamsWanted && landF > 0;
      orb.visible = landF > 0;
    },

    /** Called once a frame. `pxScale` is half the drawing buffer height, which
     *  is what turns a world-unit dot size into pixels. */
    update(nowMs, pxScale) {
      dotMat.uniforms.uCount.value = ripples.update(nowMs);
      dotMat.uniforms.uScale.value = pxScale;
      /* SECONDS, AND REDUCED, because `nowMs` is a wall clock. Feeding epoch
       * milliseconds straight into a sine is a number near 1.8e12 inside a
       * float32 uniform, where the spacing between representable values is
       * bigger than the wave — the shimmer would freeze, or step. Modulo keeps
       * it small; the period is a multiple of 2*PI/uShimmerSpeed's slowest
       * component so the wrap is not a visible jump. */
      seamMat.uniforms.uTime.value = (nowMs % 3600000) / 1000;
    },

    /** Does anything on this world need a frame while nothing is moving?
     *
     * ==> THE SHIMMER IS THE FIRST EFFECT IN THIS APP THAT IS TRUE AT REST. <==
     * Ripples are transient and ask for frames while they live (`ripples
     * .liveCount`); smoke, dust and moving water will all be like the shimmer
     * instead — continuous, and therefore a standing cost rather than an event.
     * `proto/shell.js` reads this to decide whether to run its own animation
     * loop, and the reason it runs its OWN rather than calling
     * `map.triggerRepaint()` is that a repaint redraws the whole MapLibre map,
     * every frame, including at the space floor where it is fully transparent.
     *
     * FALSE ONCE THE SEAMS ARE GONE, so diving down onto the map stops the loop
     * rather than animating something nobody can see. */
    wantsFrames() {
      return Boolean(seams && seams.visible && DEEP.shimmer > 0);
    },

    dispose() {
      /* DETACHED, NOT DISPOSED. The mark layer outlives this world — it holds a
       * fetched field, and a world switch to Sky and back must not cost a
       * second round trip to the relay. Whoever created it disposes it. */
      if (volcanoes) spin.remove(volcanoes.group);
      spin.remove(fill);
      if (dots) spin.remove(dots);
      if (dotGeo) dotGeo.dispose();
      if (seams) spin.remove(seams);
      if (seamGeo) seamGeo.dispose();
      for (const d of disposables) d.dispose();
      spin.clear();
      fixed.clear();
    },
  };
}
