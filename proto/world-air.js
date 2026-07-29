/**
 * world-air.js — the dot-matrix glass globe.
 *
 * PROTOTYPE CODE. Not wired into the app.
 *
 * THE ORB IS THE PLANET. The glass sphere sits at radius 1.0, its edge is the
 * planet's edge, and THE GLASS IS ITS OWN LIGHT — the two-tone lives on the
 * ball's front face, so the coloured edge sits exactly on the silhouette. There
 * is no shell, no halo and nothing to size. The dots float above the glass on
 * the same plane as the shipped node mesh.
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
 * `THREE` is a CDN global, same as map/globe3d.js.
 * Imports: proto/, config/constants.js and lib/geo.js.
 */

import { DIVE, GLOBE } from '../config/constants.js';
import { AIR_WORLD } from '../config/worlds/air.js';
import { smoothstep } from '../lib/geo.js';

/** Dots are placed by a golden-angle spiral, NOT a latitude/longitude grid.
 *  A lat/lon grid bunches points at the poles and thins them at the equator,
 *  so Greenland turns to mush while Brazil looks sparse. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const AIR = {
  /** The glass orb. This is the planet — its limb is the planet's limb. */
  orbRadius: 1.0,
  /** Dots float on the SAME PLANE AS THE NODE MESH in the shipped globe.
   *  Imported, not copied, so the two can never drift apart. 1.4% above the
   *  surface read as paint; 6.5% reads as a shell standing off the glass, which
   *  is the whole point of the look. */
  dotRadius: DIVE.cageRadius,
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
  /** How far the land sheet floats above the glass. Must stay under dotRadius
   *  or the continents punch through the dots that are supposed to hover on
   *  top of them. */
  /** Sphere subdivision for the land sheet. The mask is 1024x512, so past
   *  roughly this the coastline stops getting sharper and the triangles are
   *  just cost. One draw call either way. */
  fillSegments: 128,
  fillRadius: 1.05,
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
uniform float uScale;
uniform float uRadius;
varying float vGlow;
varying float vFacing;

void main() {
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
  gl_PointSize = uSize * (1.0 + w * 0.55) * uScale / max(0.001, -mv.z);
}
`;

const DOT_FRAG = `
uniform vec3 uDot;
uniform vec3 uHot;
uniform float uOpacity;
uniform float uFarFade;
varying float vGlow;
varying float vFacing;

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

  vec3 col = mix(uDot, uHot, vGlow);
  gl_FragColor = vec4(col, uOpacity * vis * edge * (0.55 + 0.45 * vGlow));
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

const SEAM_VERT = `
uniform float uRadius;
varying vec3 vN;

void main() {
  vec3 n = normalize(position);
  vN = normalize(normalMatrix * n);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(n * uRadius, 1.0);
}
`;

const SEAM_FRAG =
  GLOW_TINT +
  `
uniform float uOpacity;
varying vec3 vN;

void main() {
  gl_FragColor = vec4(glowTint(vN), uOpacity);
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
export function createAirWorld({ mask, ripples, onStatus = () => {} }) {
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
  const orbGeo = track(new THREE.SphereGeometry(AIR.orbRadius, 96, 64));
  const orbMat = track(
    new THREE.ShaderMaterial({
      vertexShader: GLASS_VERT,
      fragmentShader: GLASS_FRAG,
      uniforms: {
        uBase: { value: new THREE.Color(AIR.colors.glass) },
        uCold: { value: new THREE.Color() },
        uWarm: { value: new THREE.Color() },
        uLightDir: { value: new THREE.Vector3().fromArray(AIR.lightDir).normalize() },
        uPower: { value: AIR.edgePower },
        uIntensity: { value: AIR.edgeIntensity },
        uOpacity: { value: AIR.glassOpacity },
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
  const fillGeo = track(maskSphere(AIR.fillSegments));
  const fillMat = track(
    new THREE.ShaderMaterial({
      vertexShader: FILL_VERT,
      fragmentShader: FILL_FRAG,
      uniforms: {
        uMask: { value: fillTex },
        uRadius: { value: AIR.fillRadius },
        uCold: { value: new THREE.Color() },
        uWarm: { value: new THREE.Color() },
        uLightDir: { value: new THREE.Vector3().fromArray(AIR.lightDir).normalize() },
        uTint: { value: AIR.fillTint },
        uOpacity: { value: AIR.fillOpacity },
        uFarFade: { value: AIR.farSideFade },
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

  /** @param {string} key one of AIR.rims */
  function setRim(key) {
    const p = AIR.rims[key] || AIR.rims[AIR.defaultRim];
    /* BOTH, every time. The sheet reads the pair live, so a palette change
     * re-tints the planet — and a setter that updated only the orb would leave
     * a surface lit by the previous palette with nothing on screen naming which
     * was stale.
     *
     * ==> THE SEAMS ARE NO LONGER IN THIS LIST, AND THAT IS THE POINT. <== They
     * were, and it made them a violet line network laid over an orchid
     * coastline — the same family, so on the map you could not tell which was
     * which. They now hold `AIR_WORLD.plates`, the app's own glow cyan, set
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
        uScale: { value: 600 },
        uRadius: { value: AIR.dotRadius },
        uDot: { value: new THREE.Color(AIR.colors.dot) },
        uHot: { value: new THREE.Color(AIR.colors.dotHot) },
        uOpacity: { value: AIR.dotOpacity },
        uFarFade: { value: AIR.farSideFade },
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
    const total = Math.max(
      AIR.minDots,
      Math.min(AIR.maxDots, Math.round(areaPx / perPoint))
    );

    const pos = [];
    for (let i = 0; i < total; i++) {
      const y = 1 - ((i + 0.5) * 2) / total;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = i * GOLDEN_ANGLE;
      const x = Math.cos(th) * r;
      const z = Math.sin(th) * r;
      const lat = (Math.asin(y) * 180) / Math.PI;
      const lon = (Math.atan2(x, z) * 180) / Math.PI;
      if (mask.isLand(lon, lat)) pos.push(x, y, z);
    }

    if (dots) {
      spin.remove(dots);
      dotGeo.dispose();
    }
    dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    dots = new THREE.Points(dotGeo, dotMat);
    dots.frustumCulled = false;
    dots.renderOrder = 3;
    spin.add(dots);
    dotCount = pos.length / 3;

    /* Spacing in world units on a unit sphere is just spacing-in-pixels over
     * the planet's pixel radius. Dot size and wave lift both derive from it, so
     * the look holds together at every density. */
    const spacingWorld = spacingPx / Math.max(1, globePxRadius);
    dotMat.uniforms.uSize.value = spacingWorld * AIR.dotFraction;
    dotMat.uniforms.uLift.value = spacingWorld * AIR.liftFraction;

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
  let fillBase = AIR.fillOpacity;
  let seamGeo = null;
  const seamMat = track(
    new THREE.ShaderMaterial({
      vertexShader: SEAM_VERT,
      fragmentShader: SEAM_FRAG,
      uniforms: {
        uRadius: { value: AIR.seamRadius },
        uCold: { value: new THREE.Color() },
        uWarm: { value: new THREE.Color() },
        uLightDir: { value: new THREE.Vector3().fromArray(AIR.lightDir).normalize() },
        uTint: { value: AIR.seamTint },
        uOpacity: { value: AIR.seamOpacity },
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
   * with (`config/worlds/air.js`), fed in as the material's cold/warm pair — so
   * the seams still sweep with the light like every other surface on this
   * globe, they are just a different metal. Identical colours in both renderers
   * is what stops the lines changing hue partway through the dive. */
  seamMat.uniforms.uCold.value.set(AIR_WORLD.plates.glow);
  seamMat.uniforms.uWarm.value.set(AIR_WORLD.plates.core);

  /* CALLED HERE, NOT BESIDE ITS DEFINITION. setRim writes into the orb and the
   * sheet, both declared above this line and below the definition — calling it
   * any earlier is a temporal-dead-zone crash on boot rather than a subtle
   * bug. */
  setRim(AIR.defaultRim);

  onStatus('loading', 'Plate boundaries loading…');
  fetch(GLOBE.plateBoundariesUrl)
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then((gj) => {
      const pts = [];
      let lines = 0;
      for (const f of gj.features || []) {
        const g = f.geometry;
        if (!g) continue;
        const parts = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
        for (const c of parts) {
          if (!Array.isArray(c) || c.length < 2) continue;
          lines++;
          for (let i = 0; i < c.length - 1; i++) {
            /* Skip the segment that jumps the antimeridian — otherwise it draws
             * a straight line right through the middle of the planet. */
            if (Math.abs(c[i][0] - c[i + 1][0]) > 180) continue;
            pts.push(...toVec(c[i][0], c[i][1], AIR.seamRadius));
            pts.push(...toVec(c[i + 1][0], c[i + 1][1], AIR.seamRadius));
          }
        }
      }
      if (!lines) {
        onStatus('empty', 'Plate boundaries: file loaded, no lines in it');
        return;
      }
      seamGeo = new THREE.BufferGeometry();
      seamGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      seams = new THREE.LineSegments(seamGeo, seamMat);
      seams.renderOrder = 1;
      spin.add(seams);
      onStatus('ok', lines + ' plate boundaries');
    })
    .catch((e) => {
      onStatus('error', 'Plate boundaries unavailable — ' + e.message);
    });

  return {
    id: 'air',
    spin,
    fixed,

    setSpacing,
    setRim,

    /** How far the dot shell floats above the glass. */
    setDotHeight(r) {
      dotMat.uniforms.uRadius.value = r;
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
      dotMat.uniforms.uOpacity.value = AIR.dotOpacity * nodeF;
      /* ==> THE SEAMS LEAVE ON THE LAND BAND, WITH THE COASTLINE. <== They rode
       * the CAGE band until MapLibre grew plate lines of its own, and that is
       * how they vanished: cage runs to p 0.62 — about z3.9 — and below it
       * there was nothing drawing plate boundaries at all, so they got sharper
       * as the planet grew and then simply stopped. Now the same feature exists
       * in both renderers and this is a HANDOFF, so it uses the handoff's own
       * band: `land` is what `map/globe3d.js` fades its coastline on, and it
       * ends exactly where `mapIn` brings MapLibre to full. */
      seamMat.uniforms.uOpacity.value = AIR.seamOpacity * landF;
      /* The sheet IS this world's land, so it leaves on the land band with the
       * glass rather than with the dots. `fillBase` rather than the constant,
       * so a dive does not silently undo whatever the opacity slider was set
       * to — the same trap seamsWanted exists to close. */
      fillMat.uniforms.uOpacity.value = fillBase * landF;
      fill.visible = landF > 0;
      orbMat.uniforms.uOpacity.value = AIR.glassOpacity * landF;
      orbMat.uniforms.uIntensity.value = AIR.edgeIntensity * landF;
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
    },

    dispose() {
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
