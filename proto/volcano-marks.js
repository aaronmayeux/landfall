/**
 * volcano-marks.js — Phase E's pixels. Flat symbols, one draw call.
 *
 * PROTOTYPE CODE. Not wired into the app.
 *
 * ==> THESE ARE MARKS, NOT MOUNTAINS, AND THAT IS A PHASE BOUNDARY RATHER THAN
 * A SHORTCUT. <== SPEC-GLOBES §42.1 says a volcano is the planet's own skin
 * pushed up — same material as the land sheet, catching the same light. That is
 * Phase F, an `InstancedMesh` with a per-instance shape family. Marks ship
 * first, alone, because a bad phone screen carrying both at once has two
 * possible causes and no way to tell them apart.
 *
 * WHAT SEPARATES THE TWO SETS, IN THREE CHANNELS RATHER THAN ONE:
 *
 *   quiet     cool cyan · small, ramped by severity · 72% opacity
 *   erupting  pale gold · fixed and larger        · full opacity
 *
 * Three channels because colour alone loses — an erupting volcano stands ON a
 * plate boundary, which on this world is a bright orange line, and a hot mark
 * on a hot line is one blob. See `VOLCANO.marks` for why the gold is yellow
 * rather than orange and why it sits off the end of the USGS shaking ramp.
 *
 * SUBMARINE VOLCANOES DRAW AS A HOLLOW RING. §42.1.4: 110 sit below sea level
 * and a cone sticking out of the Pacific for a seamount 1,800 m down is simply
 * false. The Phase G answer is a sunken dimple with the glow UNDER the shell;
 * a ring is the cheapest treatment that is honestly not a mountain in the
 * meantime, and it costs one attribute and one branch. Ahyi is erupting 55 m
 * under water today, so a gold ring on the first screen is CORRECT and a gold
 * disc there would be this layer's first lie.
 *
 * `THREE` is a CDN global, same as `world-deep.js`.
 * Imports: config/constants.js only.
 */

import { VOLCANO } from '../config/constants.js';

const M = VOLCANO.marks;

const MARK_VERT = `
uniform float uRadius;
/** Point size in DEVICE pixels, resolved per mark on the CPU. */
attribute float aSize;
attribute float aErupt;
attribute float aSub;
varying float vFacing;
varying float vErupt;
varying float vSub;

void main() {
  vErupt = aErupt;
  vSub = aSub;
  vec3 n = normalize(position);
  vec4 mv = modelViewMatrix * vec4(n * uRadius, 1.0);

  /* Which way this mark faces. Positive is the near side of the glass;
   * negative means we are looking at it THROUGH the planet. Same read the dot
   * field uses, and the reason neither needs the depth buffer. */
  vec3 nView = normalize(normalMatrix * n);
  vFacing = dot(nView, normalize(-mv.xyz));

  gl_Position = projectionMatrix * mv;
  /* ==> NO DIVIDE BY DISTANCE. <== The dots shrink with distance because they
   * are a medium and the medium recedes. A mark is a symbol: perspective-scaled
   * it is sub-pixel at the space floor, which is the distance this layer most
   * needs to read from. Fixed screen size is the whole difference. */
  gl_PointSize = aSize;
}
`;

const MARK_FRAG = `
uniform vec3 uQuiet;
uniform vec3 uErupt;
uniform float uQuietAlpha;
uniform float uEruptAlpha;
uniform float uFade;
uniform float uFarFade;
uniform float uRingInner;
varying float vFacing;
varying float vErupt;
varying float vSub;

void main() {
  /* 0 at the centre, 1 at the edge of the inscribed circle. */
  float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (r > 1.0) discard;

  /* Soft outer edge. The band is wide enough to read as a smooth pip at 3.5 px
   * and narrow enough not to eat a 10 px one. */
  float a = smoothstep(1.0, 0.82, r);

  /* SUBMARINE: punch the middle out. The inner edge gets its own soft band, or
   * the hole crawls with aliasing at small sizes — which on a 3.5 px ring is
   * most of the mark. */
  if (vSub > 0.5) {
    a *= smoothstep(uRingInner - 0.18, uRingInner + 0.02, r);
  }

  /* Far-side marks stay visible and drop right back, the way this world's dots
   * and the shipped globe's far continents do. The band around zero is the
   * limb, where a mark is edge-on. */
  float near = smoothstep(-0.12, 0.12, vFacing);
  float vis = mix(uFarFade, 1.0, near);

  vec3 col = mix(uQuiet, uErupt, vErupt);
  float alpha = mix(uQuietAlpha, uEruptAlpha, vErupt);
  gl_FragColor = vec4(col, alpha * a * vis * uFade);
}
`;

/**
 * Build the mark layer.
 *
 * @param {object} opts
 * @param {number} [opts.pixelRatio=1] device pixels per CSS pixel. The sizes in
 *   `VOLCANO.marks` are CSS px, and `gl_PointSize` is device px — without this
 *   every mark is a third of its intended size on a 3x phone, which is exactly
 *   the class of bug that only shows up on glass.
 * @param {number} [opts.radius] where the marks sit. Defaults to the caller's
 *   shell plane so they are coplanar with the dots and the land sheet.
 */
export function createVolcanoMarks({ pixelRatio = 1, radius = 1.05 } = {}) {
  const group = new THREE.Group();
  let points = null;
  let geo = null;
  let dpr = pixelRatio;
  let wanted = true;
  /** The last fade the world handed down. Held because a rebuild can land
   *  mid-dive — the relay resolving while the camera is already descending —
   *  and a fresh point cloud that ignores it would pop back to full strength
   *  under a map that has nearly taken the screen. */
  let fade = 1;
  /** The last field handed in, kept so a pixel-ratio change can rebuild sizes
   *  without a refetch. */
  let held = null;

  const mat = new THREE.ShaderMaterial({
    vertexShader: MARK_VERT,
    fragmentShader: MARK_FRAG,
    uniforms: {
      uRadius: { value: radius },
      uQuiet: { value: new THREE.Color(M.quietColor) },
      uErupt: { value: new THREE.Color(M.eruptingColor) },
      uQuietAlpha: { value: M.quietOpacity },
      uEruptAlpha: { value: M.eruptingOpacity },
      uFade: { value: 1 },
      uFarFade: { value: M.farSideFade },
      uRingInner: { value: M.submarineRingInner },
    },
    transparent: true,
    /* Depth OFF, matching the dot field: which side of the planet a mark is on
     * is decided by its facing in the shader, not by the depth buffer, so the
     * far-side marks show THROUGH the glass instead of being clipped by it. */
    depthTest: false,
    depthWrite: false,
  });

  function toVec(lon, lat, r) {
    const la = (lat * Math.PI) / 180;
    const lo = (lon * Math.PI) / 180;
    const c = Math.cos(la);
    return [r * c * Math.sin(lo), r * Math.sin(la), r * c * Math.cos(lo)];
  }

  function rebuild() {
    if (points) {
      group.remove(points);
      points = null;
    }
    if (geo) {
      geo.dispose();
      geo = null;
    }
    const marks = (held && held.marks) || [];
    if (!marks.length) return;

    const pos = new Float32Array(marks.length * 3);
    const size = new Float32Array(marks.length);
    const erupt = new Float32Array(marks.length);
    const sub = new Float32Array(marks.length);

    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      /* Unit sphere. The radius is a uniform so the whole layer can be moved
       * off the shell plane with one number rather than a rebuild. */
      const v = toVec(m.lon, m.lat, 1);
      pos[i * 3] = v[0];
      pos[i * 3 + 1] = v[1];
      pos[i * 3 + 2] = v[2];
      /* ==> THE ERUPTING SIZE IS FIXED AND IGNORES THE SEVERITY SCORE. <== The
       * score ranks the QUIET (`lib/volcano-severity.js`). Great Sitkin scores
       * 0.240 and is erupting today; sizing it below an idle Etna would invert
       * the one rule §42.1.1 spends a whole block establishing. */
      const cssPx = m.erupting
        ? M.eruptingPx
        : M.quietMinPx + (M.quietMaxPx - M.quietMinPx) * clamp01(m.sev);
      size[i] = cssPx * dpr;
      erupt[i] = m.erupting ? 1 : 0;
      sub[i] = m.submarine ? 1 : 0;
    }

    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aErupt', new THREE.BufferAttribute(erupt, 1));
    geo.setAttribute('aSub', new THREE.BufferAttribute(sub, 1));
    points = new THREE.Points(geo, mat);
    /* ==> ABOVE THE DOT FIELD, WHICH IS AT 3, AND THAT IS THE WHOLE POINT OF
     * THIS NUMBER. <== It shipped at 2 — ordered against the plate seams at 1
     * and never checked against the dots, which draw LAST and therefore ON TOP.
     * 90,000 dots at 0.95 opacity painting over the layer is not a subtle
     * degradation. Depth testing is off for every layer on this world, so
     * render order is the ONLY thing deciding overlap here: any new layer has
     * to be placed against the dots, not against whatever it sits nearest. */
    points.renderOrder = 4;
    points.visible = wanted && fade > 0;
    group.add(points);
  }

  return {
    group,

    /** Hand in a loaded field (`loadVolcanoField()`'s return). Safe to call
     *  again — it rebuilds. */
    setField(field) {
      held = field;
      rebuild();
    },

    /** Device pixels per CSS pixel. Rebuilds, because the sizes are baked into
     *  the attribute rather than multiplied in the shader — one buffer write on
     *  a display change against a multiply on every mark every frame. */
    setPixelRatio(r) {
      if (!(r > 0) || r === dpr) return;
      dpr = r;
      rebuild();
    },

    setVisible(on) {
      wanted = !!on;
      if (points) points.visible = wanted && fade > 0;
    },

    /** How far the marks float above the glass. */
    setRadius(r) {
      mat.uniforms.uRadius.value = r;
    },

    /**
     * Fade out as MapLibre takes the screen.
     *
     * ==> THE NODE BAND, WITH THE DOT FIELD, AND NOT THE LAND BAND. <== A mark
     * is this world's answer to a node on the shipped globe's cage — a symbol
     * floating on the shell — so it leaves when the shell does. On the land
     * band it would outlive the dots it sits among and hang over a street map,
     * which is the specific thing `world-deep.js` fixed for its seams.
     *
     * @param {number} nodeFade 1 at space, 0 once the map owns the screen
     */
    setFade(nodeFade) {
      fade = nodeFade;
      mat.uniforms.uFade.value = nodeFade;
      /* Hidden outright once invisible so the draw call goes away rather than
       * a fully transparent pass still being paid for. */
      if (points) points.visible = wanted && nodeFade > 0;
    },

    /** Nothing animates in Phase E. Stated rather than omitted: an erupting
     *  mark reading as inert is a known open question for the glass pass, and
     *  whoever adds a pulse has to flip this and pay for a standing frame cost
     *  on a world that currently rests. */
    wantsFrames() {
      return false;
    },

    dispose() {
      if (points) group.remove(points);
      if (geo) geo.dispose();
      mat.dispose();
      group.clear();
      points = null;
      geo = null;
      held = null;
    },
  };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
