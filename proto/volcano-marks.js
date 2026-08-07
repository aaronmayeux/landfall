/**
 * volcano-marks.js — Phase F's pixels. Two layers, and both are one draw call.
 *
 * PROTOTYPE CODE. Not wired into the app.
 *
 * ==> A VOLCANO IS THE PLANET'S OWN SKIN PUSHED UP (§42.1), AND FROM SPACE IT
 * IS STILL A PIP. <== Those are not in conflict; §42.1.3 is where they meet.
 * At the space floor 1 px is about 30 km, so even a wildly exaggerated
 * mountain is a couple of pixels there, and 135 legible silhouettes would fuse
 * into a smear across Java, Japan and Kamchatka. So:
 *
 *   PIPS       flat symbols, fixed screen size. The from-space read, confirmed
 *              on a phone in Phase E. NEVER LEAVES.
 *   EDIFICES   real lathed geometry in globe radii, lit by this world's own
 *              fixed light. Fades in as you descend, on `VOLCANO.shapes.shapeIn`.
 *
 * ==> THE EDIFICE IS ADDED TO THE PIP, NEVER SWAPPED FOR IT, AND THAT IS A
 * CORRECTION RATHER THAN A PREFERENCE. <== Phase F first shipped them as a
 * CROSSFADE — the mark retiring as the silhouette arrived. On a phone that made
 * the middle of the globe emptier than Phase E had been: a mountain seen from
 * straight overhead is a couple of pixels of nothing, so a hundred volcanoes
 * traded a mark you could see for a shape you could not. Only the submarine
 * rings and the volcanic fields survived, because they never handed over.
 * Every volcano keeps its mark at every zoom now, and the silhouette is what
 * grows on top of it near the limb where a profile can actually be seen.
 *
 * ==> WHAT REAL GEOMETRY BUYS, STATED PLAINLY SO NOBODY IS SURPRISED ON GLASS.
 * <== On a sphere, only a ring near the limb shows a profile at all — the
 * middle of the disc is looking straight down a volcano's throat. So this buys
 * a planet whose EDGE goes lumpy as you descend, not a legend you can read
 * shapes off. Aaron's call 2026-07-30, made knowing that. If it ever needs
 * walking back the fallback is leaning the geometry toward the camera, which is
 * one number, not a rebuild.
 *
 * ==> TWO SETS NEVER GET AN EDIFICE (§42.1.4). <== Submarine volcanoes keep
 * Phase E's hollow ring — Ahyi is erupting 55 m under water and a cone
 * sticking out of the Pacific for it would be this layer's first lie; the
 * dimple is Phase G. Volcanic fields and clusters keep a flat mark, because a
 * single cone for "West Eifel Volcanic Field" is a fabrication. Both keep
 * their pip at full strength through the dive instead of fading into a
 * mountain that does not exist.
 *
 * ==> DEPTH IS CLEARED BEFORE THE EDIFICES DRAW, AND THAT IS DELIBERATE. <==
 * The glass orb is the one layer on this world that WRITES depth, at radius
 * 1.0. Volcanoes sit at 1.05, so without a clear every far-side mountain would
 * be clipped by the planet while the dot field beside it carries on showing
 * through — one layer disagreeing with every other about which hemisphere you
 * can see. The clear also gives the mesh a clean buffer to sort ITSELF in,
 * which is what stops the back of a cone painting over its own front. The
 * edifices draw last, so clearing depth there costs nothing after them.
 *
 * `THREE` is a CDN global, same as `world-deep.js`.
 * Imports: config/constants.js, lib/volcano-shape.js and
 * lib/volcano-dimensions.js. No DOM.
 */

import { VOLCANO } from '../config/volcano.js';
import { FAMILY, EDIFICE_FAMILIES } from '../lib/volcano-shape.js';
import { markSizeRank } from '../lib/volcano-dimensions.js';

const M = VOLCANO.marks;
const SH = VOLCANO.shapes;

/* ========================================================================= *
 * THE PIPS — Phase E's layer, unchanged in look, with one attribute added.
 * ========================================================================= */

const PIP_VERT = `
uniform float uRadius;
/** Point size in DEVICE pixels, resolved per mark on the CPU. */
attribute float aSize;
attribute float aErupt;
attribute float aSub;
/** Severity 0..1. Drives the GLOW now that radius ranks footprint. */
attribute float aSev;
uniform float uGlowPad;
varying float vFacing;
varying float vErupt;
varying float vSub;
/** How far the mark's own edge sits inside the sprite, 0..1. Without a halo it
 *  is 1 and the sprite IS the mark; with one the fragment shader needs this to
 *  keep every mark-relative term measuring the mark rather than the padding. */
varying float vCore;
varying float vGlow;

void main() {
  vErupt = aErupt;
  vSub = aSub;

  /* ==> ERUPTING PINS AT FULL GLOW RATHER THAN RANKING. <== §42.1.1: live
   * state outranks history everywhere the two disagree, so the gold set gets
   * the maximum halo instead of a score out of the catalog. */
  vGlow = mix(clamp(aSev, 0.0, 1.0), 1.0, aErupt);
  vec3 n = normalize(position);
  vec4 mv = modelViewMatrix * vec4(n * uRadius, 1.0);

  /* Which way this mark faces. Positive is the near side of the glass;
   * negative means we are looking at it THROUGH the planet. Same read the dot
   * field uses, and the reason neither needs the depth buffer. */
  vec3 nView = normalize(normalMatrix * n);
  vFacing = dot(nView, normalize(-mv.xyz));

  gl_Position = projectionMatrix * mv;
  /* ==> NO DIVIDE BY DISTANCE. <== The dots shrink with distance because they
   * are a medium and the medium recedes. A pip is a symbol: perspective-scaled
   * it is sub-pixel at the space floor, which is the distance this layer most
   * needs to read from. Fixed screen size is the whole difference. */
  /* ==> THE SPRITE GROWS, THE MARK DOES NOT. <== vCore carries the ratio to
   * the fragment shader so the dot stays exactly the size aSize asked for and
   * only the halo occupies the extra room. Growing the mark itself would be
   * severity going back into radius, which is footprint's channel.
   *
   * ==> AND THIS IS THE ONE NUMBER THAT COULD HIT A DRIVER LIMIT. <== An
   * erupting pip is 10 CSS px, so on a 3x phone it was already 30 device px and
   * is now up to 78. ALIASED_POINT_SIZE_RANGE is 255+ on most mobile GPUs and
   * 63 on a few old ones, and a driver that clamps will square off the halo
   * rather than error. If erupting pips look CUT OFF on a phone, that is this,
   * and the fix is marks.glowPad, not the pixel ramp. */
  gl_PointSize = aSize * (1.0 + uGlowPad * vGlow);
  vCore = 1.0 / (1.0 + uGlowPad * vGlow);
}
`;

const PIP_FRAG = `
uniform vec3 uQuiet;
uniform vec3 uErupt;
uniform float uQuietAlpha;
uniform float uEruptAlpha;
uniform float uFade;
uniform float uFarFade;
uniform float uRingInner;
uniform float uGlowAlpha;
varying float vFacing;
varying float vErupt;
varying float vSub;
varying float vCore;
varying float vGlow;

void main() {
  /* 0 at the centre, 1 at the edge of the SPRITE — which is larger than the
   * mark whenever this pip carries a halo. */
  float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (r > 1.0) discard;

  /* 0 at the centre, 1 at the edge of the MARK. Everything that describes the
   * mark measures this; only the halo below measures the sprite. */
  float rm = r / vCore;

  /* Soft outer edge. The band is wide enough to read as a smooth pip at 3.5 px
   * and narrow enough not to eat a 10 px one. */
  float a = smoothstep(1.0, 0.82, rm);

  /* SUBMARINE: punch the middle out. The inner edge gets its own soft band, or
   * the hole crawls with aliasing at small sizes — which on a 3.5 px ring is
   * most of the mark. */
  if (vSub > 0.5) {
    a *= smoothstep(uRingInner - 0.18, uRingInner + 0.02, rm);
  }

  /* Far-side marks stay visible and drop right back, the way this world's dots
   * and the shipped globe's far continents do. The band around zero is the
   * limb, where a mark is edge-on. */
  float near = smoothstep(-0.12, 0.12, vFacing);
  float vis = mix(uFarFade, 1.0, near);

  /* ==> SEVERITY IS A HALO, BECAUSE RADIUS MEANS FOOTPRINT AND LIGHTNESS
   * FAILED ON GLASS. <== The lightness ramp this replaces was invisible on a
   * phone: two strengths of one cyan, inside a dot 3.5 px across, already at
   * 0.72 alpha. A halo puts the ranking OUTSIDE the mark, where there is room
   * for it, without touching the mark's size or its hue. NO BACKTICKS IN THIS
   * BLOCK: it is inside a JS template literal and a backtick ends the shader.
   *
   * The falloff runs from the mark's edge to the sprite's, squared so it is
   * tight against the dot rather than a flat disc of fog. The plain ratio
   * avoids smoothstep's undefined case when the two edges meet, which is
   * exactly what a zero-severity mark has. */
  float t = clamp((r - vCore) / max(1.0 - vCore, 1e-4), 0.0, 1.0);
  float halo = (1.0 - t) * (1.0 - t);

  vec3 col = mix(uQuiet, uErupt, vErupt);
  float alpha = mix(uQuietAlpha, uEruptAlpha, vErupt);

  /* ==> 1.0 - a IS WHAT KEEPS THIS A RANKING AND NOT A SIZE. <== It confines
   * the halo to outside the mark's own coverage, so a glowing pip can never
   * brighten its own centre and read as a bigger, closer dot. */
  float glowA = uGlowAlpha * vGlow * halo * (1.0 - a);

  gl_FragColor = vec4(col, (alpha * a + glowA) * vis * uFade);
}
`;

/* ========================================================================= *
 * THE EDIFICES — five silhouettes out of one lathe, bent per instance.
 * ========================================================================= */

/**
 * ==> SIX SHAPES OUT OF ONE GEOMETRY, AND THE PROFILE IS THE WHOLE TRICK. <==
 * The template is a lathe of unit base radius and unit height. Every vertex
 * carries an angle around the axis and a parameter `v` running 0 at the base to
 * 1 at the summit; the shader evaluates radius and height from `v` and five
 * per-instance numbers. Changing family costs no geometry and no draw call.
 *
 * `rim` below 1 is what makes a caldera: past it the profile turns inward and
 * DOWN into the crater instead of continuing up. Every other family sets
 * `rim = 1`, so the crater term is multiplied by zero and costs one mix.
 */
const EDIFICE_VERT = `
uniform float uRadius;
/** vec3(long axis, height, short axis), in globe radii. */
attribute vec3 aScale;
/** vec4(flankPow, heightPow, topR, rim). */
attribute vec4 aProfile;
attribute float aNotch;
attribute float aErupt;
varying vec3 vNormal;
varying float vFacing;
varying float vErupt;

/** Radius and height of the profile at v, in the unit template's own space. */
vec2 profileAt(float v) {
  float rim = aProfile.w;
  float topR = aProfile.z;

  /* Up the flank. Clamped at the rim so the crater term takes over cleanly
   * rather than the flank continuing to climb underneath it. */
  /* pow(0.0, x) is UNDEFINED in GLSL and returns NaN on some drivers, and both
   * ends of this profile hit zero — the base at t=0 and the summit at t=1. The
   * floor is far below a pixel at any zoom and it is the difference between a
   * mountain and a spray of infinities. */
  float t = min(v / max(rim, 1e-4), 1.0);
  float rr = pow(max(1.0 - t, 1e-5), aProfile.x) * (1.0 - topR) + topR;
  float hh = pow(max(t, 1e-5), aProfile.y);

  /* Into the crater. c is 0 everywhere for a family with no rim, so this is
   * branchless rather than conditional. The floor converges to the axis so the
   * lathe closes on itself instead of leaving a hole in the crater. */
  float c = (rim >= 1.0) ? 0.0 : clamp((v - rim) / max(1.0 - rim, 1e-4), 0.0, 1.0);
  rr = mix(rr, 0.0, c);
  hh = hh - aNotch * c;

  return vec2(rr, hh);
}

void main() {
  vErupt = aErupt;

  /* The template stores the direction around the axis in xz and v in y. The
   * apex vertex stores a zero direction, which is what caps the summit. */
  vec2 dir = position.xz;
  float v = position.y;

  vec2 p = profileAt(v);
  vec3 local = vec3(dir.x * p.x, p.y, dir.y * p.x) * aScale;

  /* NORMAL BY FINITE DIFFERENCE ALONG THE PROFILE. Analytic would mean a
   * second derivative per family and a second thing to keep in step with the
   * first; the profile is cheap enough to evaluate twice.
   *
   * ==> CENTRAL, NOT FORWARD, AND THAT IS NOT A REFINEMENT. <== A forward
   * difference at the summit samples v and v again — the clamp makes them the
   * same point — so the tangent is the zero vector and normalize() hands the
   * GPU a NaN on the one ring every volcano has. */
  vec2 pa = profileAt(max(v - 0.03, 0.0));
  vec2 pb = profileAt(min(v + 0.03, 1.0));
  vec2 tang = pb - pa;
  /* A profile flat over the whole sample window would be the same NaN by
   * another route. Nothing in the five families does it; the guard is one
   * instruction and the failure mode is a hole in the planet. */
  if (dot(tang, tang) < 1e-12) tang = vec2(0.0, 1.0);
  vec2 n2 = normalize(vec2(tang.y, -tang.x));
  vec3 nLocal = vec3(dir.x * n2.x, n2.y, dir.y * n2.x);
  /* The apex has no direction to lean, so it points straight up the axis. */
  nLocal = mix(vec3(0.0, 1.0, 0.0), nLocal, step(0.001, length(dir)));
  /* DIVIDING BY THE SCALE IS THE INVERSE-TRANSPOSE for a pure diagonal scale,
   * and it is why the fissure's stretched flanks light correctly instead of
   * shading like the cone they were before the stretch. */
  nLocal = normalize(nLocal / aScale);

  /* instanceMatrix is rigid — rotation onto the surface, then translation to
   * the point on the shell. All the scaling happened above, so the rotation is
   * orthonormal and safe to use on the normal directly. */
  mat3 rot = mat3(instanceMatrix);
  vec3 world = (instanceMatrix * vec4(local, 1.0)).xyz;
  /* The instance sits on the unit sphere; the shell radius is a uniform so the
   * height slider does not have to rebuild every matrix. */
  vec3 base = normalize(rot * vec3(0.0, 1.0, 0.0));
  world += base * (uRadius - 1.0);

  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  vNormal = normalize(normalMatrix * (rot * nLocal));

  /* Facing is the GROUND's facing, not this vertex's — a mountain is near-side
   * or far-side as a whole, and shading its own back face into the far-side
   * fade would make every summit look punctured. */
  vec3 upView = normalize(normalMatrix * base);
  vFacing = dot(upView, normalize(-mv.xyz));

  gl_Position = projectionMatrix * mv;
}
`;

const EDIFICE_FRAG = `
uniform vec3 uQuiet;
uniform vec3 uErupt;
uniform float uQuietAlpha;
uniform float uEruptAlpha;
uniform float uFade;
uniform float uShape;
uniform float uFarFade;
uniform float uAmbient;
uniform vec3 uLightDir;
varying vec3 vNormal;
varying float vFacing;
varying float vErupt;

void main() {
  /* ==> THE LIGHT IS FIXED IN VIEW SPACE, WHICH IS WHY THE PLANET TURNS UNDER
   * IT. <== Same call the land sheet and the plate seams make, so a volcano is
   * lit by the same sweep as the ground it stands on rather than looking like
   * a decal from another scene. */
  float k = dot(normalize(vNormal), normalize(uLightDir)) * 0.5 + 0.5;
  float shade = mix(uAmbient, 1.0, k);

  float near = smoothstep(-0.12, 0.12, vFacing);
  float vis = mix(uFarFade, 1.0, near);

  vec3 col = mix(uQuiet, uErupt, vErupt) * shade;
  float alpha = mix(uQuietAlpha, uEruptAlpha, vErupt);
  gl_FragColor = vec4(col, alpha * vis * uFade * uShape);
}
`;

/**
 * The lathe template. One geometry, reused by every instance.
 *
 * Vertices carry the direction around the axis in xz and `v` in y; the last
 * vertex is the apex, with a zero direction, and a fan closes the summit onto
 * it. Nothing here knows about any family — the shader does all the bending.
 */
function buildTemplate(radial, profile) {
  const pos = [];
  const idx = [];
  for (let j = 0; j <= profile; j++) {
    const v = j / profile;
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      pos.push(Math.cos(a), v, Math.sin(a));
    }
  }
  const apex = pos.length / 3;
  pos.push(0, 1, 0);

  const ring = radial + 1;
  for (let j = 0; j < profile; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * ring + i;
      const b = a + 1;
      const c = a + ring;
      const d = c + 1;
      /* Wound so the OUTSIDE is the front face — `side: FrontSide` then halves
       * the fragments and drops every interior triangle. */
      idx.push(a, c, b, b, c, d);
    }
  }
  const top = profile * ring;
  for (let i = 0; i < radial; i++) idx.push(top + i, apex, top + i + 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

/* ========================================================================= *
 * THE LAYER
 * ========================================================================= */

/**
 * Build the volcano layer.
 *
 * @param {object} opts
 * @param {number} [opts.pixelRatio=1] device pixels per CSS pixel. The pip
 *   sizes in `VOLCANO.marks` are CSS px and `gl_PointSize` is device px —
 *   without this every pip is a third of its intended size on a 3x phone,
 *   which is exactly the class of bug that only shows up on glass.
 * @param {number} [opts.radius] where the layer sits. Defaults to the caller's
 *   shell plane so the pips are coplanar with the dots and the land sheet.
 * @param {number[]} [opts.lightDir] the world's fixed light, so a volcano is
 *   lit by the same sweep as the ground it stands on.
 */
export function createVolcanoMarks({ pixelRatio = 1, radius = 1.05, lightDir = [0.75, 0.5, 0.3] } = {}) {
  const group = new THREE.Group();
  let pips = null;
  let pipGeo = null;
  let edifices = null;
  let edificeGeo = null;
  let dpr = pixelRatio;
  let wanted = true;
  /** The last fade the world handed down. Held because a rebuild can land
   *  mid-dive — the relay resolving while the camera is already descending —
   *  and a fresh layer that ignores it would pop back to full strength under a
   *  map that has nearly taken the screen. */
  let fade = 1;
  let shape = 0;
  /** The last field handed in, kept so a pixel-ratio or radius change can
   *  rebuild without a refetch. */
  let held = null;
  /** Debug: force one of every family onto the globe. Off in normal use. */
  let showcase = false;

  const template = buildTemplate(SH.radialSegments, SH.profileSegments);

  const pipMat = new THREE.ShaderMaterial({
    vertexShader: PIP_VERT,
    fragmentShader: PIP_FRAG,
    uniforms: {
      uRadius: { value: radius },
      uQuiet: { value: new THREE.Color(M.quietColor) },
      uErupt: { value: new THREE.Color(M.eruptingColor) },
      uQuietAlpha: { value: M.quietOpacity },
      uEruptAlpha: { value: M.eruptingOpacity },
      uFade: { value: 1 },
      uFarFade: { value: M.farSideFade },
      uRingInner: { value: M.submarineRingInner },
      uGlowPad: { value: M.glowPad },
      uGlowAlpha: { value: M.glowOpacity },
    },
    transparent: true,
    /* Depth OFF, matching the dot field: which side of the planet a pip is on
     * is decided by its facing in the shader, not by the depth buffer, so the
     * far-side pips show THROUGH the glass instead of being clipped by it. */
    depthTest: false,
    depthWrite: false,
  });

  const edificeMat = new THREE.ShaderMaterial({
    vertexShader: EDIFICE_VERT,
    fragmentShader: EDIFICE_FRAG,
    uniforms: {
      uRadius: { value: radius },
      uQuiet: { value: new THREE.Color(M.quietColor) },
      uErupt: { value: new THREE.Color(M.eruptingColor) },
      uQuietAlpha: { value: M.quietOpacity },
      uEruptAlpha: { value: M.eruptingOpacity },
      uFade: { value: 1 },
      uShape: { value: 0 },
      uFarFade: { value: M.farSideFade },
      uAmbient: { value: SH.ambient },
      uLightDir: { value: new THREE.Vector3().fromArray(lightDir).normalize() },
    },
    transparent: true,
    /* ==> DEPTH ON HERE, AND CLEARED FIRST. <== On for self-sorting: a caldera
     * is not convex and mountains overlap each other in Kamchatka, so without
     * a depth buffer the back of a shape paints over its own front. Cleared
     * because the glass orb writes depth at radius 1.0 and would otherwise
     * clip every far-side mountain while the dots beside them carry on showing
     * through. See `onBeforeRender` below. */
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });

  function toVec(lon, lat, r) {
    const la = (lat * Math.PI) / 180;
    const lo = (lon * Math.PI) / 180;
    const c = Math.cos(la);
    return [r * c * Math.sin(lo), r * Math.sin(la), r * c * Math.cos(lo)];
  }

  /**
   * How tall this volcano stands, 0..1 of `SH.maxHeight`.
   *
   * ==> THE SAME CURVE SHAPE THE STORM CAGE USES FOR WIND (§42.1.3). <== A
   * floor so the median volcano is visible, a ceiling so the 6,879 m outlier
   * is not a needle, a square root between. A single multiplier cannot satisfy
   * both ends: whatever factor makes the tallest sane leaves the median at
   * half a pixel.
   */
  function liftFor(elev) {
    const span = SH.elevPeakM - SH.elevFloorM;
    const t = clamp01((Number(elev) - SH.elevFloorM) / (span || 1));
    return SH.minLift + (1 - SH.minLift) * Math.pow(t, SH.curve);
  }

  /** Does this mark get a mountain, or is it one of §42.1.4's two flat sets? */
  function familyFor(mark, index) {
    if (mark.submarine) return null;
    let fam = mark.family;
    /* DEBUG ONLY. Zero fissures and one dome sit in the quiet tier, so four of
     * the five silhouettes would otherwise never be seen without waiting for
     * the right volcano to erupt. "Looks fine" on one family is not a pass. */
    if (showcase) fam = EDIFICE_FAMILIES[index % EDIFICE_FAMILIES.length];
    if (fam === FAMILY.field) return null;
    return SH.families[fam] || null;
  }

  function rebuild() {
    disposeLayers();
    const marks = (held && held.marks) || [];
    if (!marks.length) return;

    buildPips(marks);
    buildEdifices(marks);
  }

  function buildPips(marks) {
    const pos = new Float32Array(marks.length * 3);
    const size = new Float32Array(marks.length);
    const erupt = new Float32Array(marks.length);
    const sub = new Float32Array(marks.length);
    const sev = new Float32Array(marks.length);

    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      /* Unit sphere. The radius is a uniform so the whole layer can be moved
       * off the shell plane with one number rather than a rebuild. */
      const v = toVec(m.lon, m.lat, 1);
      pos[i * 3] = v[0];
      pos[i * 3 + 1] = v[1];
      pos[i * 3 + 2] = v[2];
      /* ==> THE QUIET RADIUS RANKS MODELLED FOOTPRINT NOW, NOT THE SEVERITY
       * SCORE. AARON'S CALL 2026-07-30. <== `markSizeRank()` is the same log
       * curve `proto/volcano-map.js` reads, so the pip and the circle rank one
       * volcano identically across z2.4–z3.8 where both are on screen. Severity
       * moved to `aSev` below and comes out as lightness.
       *
       * ==> THE ERUPTING SIZE IS STILL FIXED AND STILL IGNORES BOTH. <== Live
       * state outranks everything the catalog remembers — §42.1.1's rule — and
       * a live lava dome is not less urgent than a live shield for being
       * smaller. */
      const cssPx = m.erupting
        ? M.eruptingPx
        : M.quietMinPx + (M.quietMaxPx - M.quietMinPx) * clamp01(markSizeRank(m));
      size[i] = cssPx * dpr;
      erupt[i] = m.erupting ? 1 : 0;
      sub[i] = m.submarine ? 1 : 0;
      sev[i] = clamp01(m.sev);
    }

    pipGeo = new THREE.BufferGeometry();
    pipGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pipGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    pipGeo.setAttribute('aErupt', new THREE.BufferAttribute(erupt, 1));
    pipGeo.setAttribute('aSub', new THREE.BufferAttribute(sub, 1));
    pipGeo.setAttribute('aSev', new THREE.BufferAttribute(sev, 1));
    pips = new THREE.Points(pipGeo, pipMat);
    /* ==> ABOVE THE DOT FIELD, WHICH IS AT 3, AND THAT IS THE WHOLE POINT OF
     * THIS NUMBER. <== It shipped at 2 in Phase E — ordered against the plate
     * seams at 1 and never checked against the dots, which draw LAST and
     * therefore ON TOP. 90,000 dots at 0.95 opacity painting over the layer is
     * not a subtle degradation. */
    pips.renderOrder = 4;
    pips.visible = wanted && fade > 0;
    group.add(pips);
  }

  function buildEdifices(marks) {
    /* Which marks get a mountain, in the order the field handed them over —
     * which is erupting LAST, so a live eruption blends over a dormant
     * neighbour rather than under it. */
    const build = [];
    for (let i = 0; i < marks.length; i++) {
      const spec = familyFor(marks[i], i);
      if (spec) build.push({ m: marks[i], spec });
    }
    if (!build.length) return;

    const n = build.length;
    const scale = new Float32Array(n * 3);
    const profile = new Float32Array(n * 4);
    const notch = new Float32Array(n);
    const erupt = new Float32Array(n);

    edificeGeo = template.clone();
    edifices = new THREE.InstancedMesh(edificeGeo, edificeMat, n);

    const up = new THREE.Vector3();
    const east = new THREE.Vector3();
    const north = new THREE.Vector3();
    const polar = new THREE.Vector3(0, 1, 0);
    const mat = new THREE.Matrix4();

    for (let i = 0; i < n; i++) {
      const { m, spec } = build[i];
      const h = SH.maxHeight * liftFor(m.elev);
      const w = h * spec.ratio;
      scale[i * 3] = w * spec.elongate;
      scale[i * 3 + 1] = h;
      scale[i * 3 + 2] = w * spec.narrow;
      profile[i * 4] = spec.flankPow;
      profile[i * 4 + 1] = spec.heightPow;
      profile[i * 4 + 2] = spec.topR;
      profile[i * 4 + 3] = spec.rim;
      notch[i] = spec.notch;
      erupt[i] = m.erupting ? 1 : 0;

      /* STAND IT ON THE GROUND. Local +Y is the surface normal; local +X runs
       * east, which is the axis the fissure ridge lies along (there is no rift
       * bearing in the catalog — see `VOLCANO.shapes.families`). */
      const v = toVec(m.lon, m.lat, 1);
      up.set(v[0], v[1], v[2]).normalize();
      east.crossVectors(polar, up);
      /* Exactly at a pole the cross product collapses; nothing in the catalog
       * sits there, and a guess is cheaper than a NaN reaching the GPU. */
      if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
      east.normalize();
      north.crossVectors(up, east).normalize();
      mat.makeBasis(east, up, north);
      mat.setPosition(up.x, up.y, up.z);
      edifices.setMatrixAt(i, mat);
    }

    edificeGeo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scale, 3));
    edificeGeo.setAttribute('aProfile', new THREE.InstancedBufferAttribute(profile, 4));
    edificeGeo.setAttribute('aNotch', new THREE.InstancedBufferAttribute(notch, 1));
    edificeGeo.setAttribute('aErupt', new THREE.InstancedBufferAttribute(erupt, 1));
    edifices.instanceMatrix.needsUpdate = true;
    /* The bounding sphere is the template's, which knows nothing about where
     * the instances went, so leaving culling on would pop the whole layer out
     * at the wrong moment. */
    edifices.frustumCulled = false;
    /* Above the pips, and LAST of everything on this world. */
    edifices.renderOrder = 5;
    /* ==> THE DEPTH CLEAR. <== Explained at the top of this file: the glass orb
     * writes depth and would clip the far hemisphere. Nothing draws after this,
     * so the clear costs a buffer wipe and nothing else. */
    edifices.onBeforeRender = (renderer) => renderer.clearDepth();
    edifices.visible = wanted && fade > 0 && shape > 0;
    group.add(edifices);
  }

  function disposeLayers() {
    if (pips) group.remove(pips);
    if (pipGeo) pipGeo.dispose();
    if (edifices) group.remove(edifices);
    if (edificeGeo) edificeGeo.dispose();
    pips = null;
    pipGeo = null;
    edifices = null;
    edificeGeo = null;
  }

  function applyVisibility() {
    if (pips) pips.visible = wanted && fade > 0;
    /* Hidden outright once it would draw nothing, so the draw call goes away
     * rather than a fully transparent pass still being paid for — including at
     * the space floor, where the layer is pips only. */
    if (edifices) edifices.visible = wanted && fade > 0 && shape > 0;
  }

  return {
    group,

    /** Hand in a loaded field (`loadVolcanoField()`'s return). Safe to call
     *  again — it rebuilds. */
    setField(field) {
      held = field;
      rebuild();
    },

    /** Device pixels per CSS pixel. Rebuilds, because the pip sizes are baked
     *  into the attribute rather than multiplied in the shader — one buffer
     *  write on a display change against a multiply on every mark every
     *  frame. */
    setPixelRatio(r) {
      if (!(r > 0) || r === dpr) return;
      dpr = r;
      rebuild();
    },

    setVisible(on) {
      wanted = !!on;
      applyVisibility();
    },

    /** How far the layer floats above the glass. A uniform on both materials,
     *  so the height slider does not rebuild 135 instance matrices. */
    setRadius(r) {
      pipMat.uniforms.uRadius.value = r;
      edificeMat.uniforms.uRadius.value = r;
    },

    /**
     * DEBUG — force one of every silhouette onto the globe.
     *
     * The quiet tier is 100 cones, 13 calderas, 12 shields, one dome and NO
     * fissures, so four of the five shapes are otherwise unjudgeable without
     * waiting for the right volcano to erupt. This assigns families round-robin
     * so all five are on screen at once. It is a LIE about the data and it is
     * never on by default.
     */
    setShowcase(on) {
      const next = !!on;
      if (next === showcase) return;
      showcase = next;
      rebuild();
    },

    /**
     * Fade out as MapLibre takes the screen, and resolve shape on the way down.
     *
     * ==> THE NODE BAND, WITH THE DOT FIELD, AND NOT THE LAND BAND. <== A mark
     * is this world's answer to a node on the shipped globe's cage — a symbol
     * floating on the shell — so it leaves when the shell does. On the land
     * band it would outlive the dots it sits among and hang over a street map,
     * which is the specific thing `world-deep.js` fixed for its seams.
     *
     * @param {number} nodeFade 1 at space, 0 once the map owns the screen
     * @param {number} [p] raw dive phase, 0 at the space floor to 1 at handoff.
     *   Drives the pip-to-edifice crossfade (`VOLCANO.shapes.shapeIn`). Omitted
     *   means "stay as you are", so a caller that has not been updated cannot
     *   silently pin the layer flat.
     */
    setFade(nodeFade, p) {
      fade = nodeFade;
      pipMat.uniforms.uFade.value = nodeFade;
      edificeMat.uniforms.uFade.value = nodeFade;
      if (typeof p === 'number') {
        shape = smoothstep(p, SH.shapeIn[0], SH.shapeIn[1]);
        edificeMat.uniforms.uShape.value = shape;
      }
      applyVisibility();
    },

    /** Nothing animates in Phase F either. Stated rather than omitted: an
     *  erupting volcano reading as inert is a live question, and the answer
     *  scoped for it is the Phase H plume rather than a pulse — a pulse is a
     *  standing frame cost on a world that otherwise rests, and it is a
     *  placeholder for something already on the list. */
    wantsFrames() {
      return false;
    },

    dispose() {
      disposeLayers();
      template.dispose();
      pipMat.dispose();
      edificeMat.dispose();
      group.clear();
      held = null;
    },
  };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(x, a, b) {
  const t = clamp01((x - a) / (b - a || 1));
  return t * t * (3 - 2 * t);
}
