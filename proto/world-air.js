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

import { DIVE } from '../config/constants.js';
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

  colors: {
    glass: 0x060a12,
    dot: 0xdfeaf5,
    dotHot: 0xffffff,
    seam: 0x2f6f8f,
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

  /** @param {string} key one of AIR.rims */
  function setRim(key) {
    const p = AIR.rims[key] || AIR.rims[AIR.defaultRim];
    orbMat.uniforms.uCold.value.setHex(p.cold);
    orbMat.uniforms.uWarm.value.setHex(p.warm);
  }
  setRim(AIR.defaultRim);

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
  let seamGeo = null;
  const seamMat = track(
    new THREE.LineBasicMaterial({
      color: AIR.colors.seam,
      transparent: true,
      opacity: AIR.seamOpacity,
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

  onStatus('loading', 'Plate boundaries loading…');
  fetch('assets/hazards/plate-boundaries.geojson')
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
      seams.renderOrder = 2;
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
      const cageF = 1 - smoothstep(p, ...DIVE.fade.cage);
      const landF = 1 - smoothstep(p, ...DIVE.fade.land);
      dotMat.uniforms.uOpacity.value = AIR.dotOpacity * nodeF;
      seamMat.opacity = AIR.seamOpacity * cageF;
      orbMat.uniforms.uOpacity.value = AIR.glassOpacity * landF;
      orbMat.uniforms.uIntensity.value = AIR.edgeIntensity * landF;
      /* Hiding outright once invisible saves the draw call rather than paying
       * for a fully transparent pass — the one budget §40.1 says binds. */
      if (seams) seams.visible = seamsWanted && cageF > 0;
      orb.visible = landF > 0;
    },

    /** Called once a frame. `pxScale` is half the drawing buffer height, which
     *  is what turns a world-unit dot size into pixels. */
    update(nowMs, pxScale) {
      dotMat.uniforms.uCount.value = ripples.update(nowMs);
      dotMat.uniforms.uScale.value = pxScale;
    },

    dispose() {
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
