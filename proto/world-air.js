/**
 * world-air.js — the dot-matrix glass globe.
 *
 * PROTOTYPE CODE. Not wired into the app.
 *
 * A dark glass ball with the landmasses floating above it as a field of small
 * dots, a two-tone glow at the edge, and the tectonic plate boundaries drawn as
 * glowing seams.
 *
 * The dots are not decoration a wave gets drawn on top of — the dots ARE the
 * wave. One point cloud, one draw call, and the ripple is a few lines of maths
 * inside the dot's own shader, so ten waves at once cost exactly what none cost.
 *
 * Height and brightness both come from the SAME number. A dot that lifts is a
 * dot that brightens, always, by construction.
 *
 * `THREE` is a CDN global, same as map/globe3d.js.
 * Imports: proto/ only.
 */

/** Dots are placed by a golden-angle spiral, NOT a latitude/longitude grid.
 *  A lat/lon grid bunches points together at the poles and thins them at the
 *  equator, so Greenland turns to mush while Brazil looks sparse. The spiral
 *  spaces them near-evenly everywhere for the same cost. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const AIR = {
  /** Radius of the solid ball the dots float above. Just under 1 so it hides
   *  the dots on the far side without z-fighting them. */
  ballRadius: 0.992,
  /** Radius of the atmosphere shell. */
  shellRadius: 1.085,
  /** Plate seams sit a hair above the ball so they are never swallowed by it. */
  seamRadius: 1.001,

  /** Dot diameter as a fraction of the spacing between dots. */
  dotFraction: 0.44,
  /** Safety rails on how many dots we will ever build. */
  minDots: 2000,
  maxDots: 90000,
  /** Fraction of a dot's spacing that a full-strength wave lifts it. */
  liftFraction: 1.6,

  colors: {
    ball: 0x05080f,
    dot: 0xdfeaf5,
    dotHot: 0xffffff,
    seam: 0x2f6f8f,
    /** Cold rim — the recommended pair. Nothing else in the app uses these. */
    rimCold: 0x1f4fd8,
    rimWarm: 0x7b3fe4,
    /** Reference rim — matches the inspiration image. Warm side collides with
     *  the USGS shaking ramp, which is why it is a toggle and not the default. */
    refCold: 0x0055ff,
    refWarm: 0xff5500,
  },

  dotOpacity: 0.92,
  seamOpacity: 0.5,
  rimPower: 3.0,
  rimIntensity: 1.15,
  /** Where the light comes from, in world space, so the warm edge stays put
   *  instead of swimming around as the planet turns. Up and to the right. */
  lightDir: [0.75, 0.55, 0.35],
};

const DOT_VERT = `
#define MAX_RIPPLES 8
uniform vec3 uOrigins[MAX_RIPPLES];
uniform vec3 uParams[MAX_RIPPLES];
uniform int  uCount;
uniform float uLift;
uniform float uSize;
uniform float uScale;
varying float vGlow;

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

  vec3 p = position + n * (w * uLift);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (1.0 + w * 0.55) * uScale / max(0.001, -mv.z);
}
`;

const DOT_FRAG = `
uniform vec3 uDot;
uniform vec3 uHot;
uniform float uOpacity;
varying float vGlow;

void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float r2 = dot(c, c);
  if (r2 > 0.25) discard;
  float edge = smoothstep(0.25, 0.08, r2);
  vec3 col = mix(uDot, uHot, vGlow);
  gl_FragColor = vec4(col, uOpacity * edge * (0.5 + 0.5 * vGlow));
}
`;

const RIM_VERT = `
varying vec3 vN;
varying vec3 vView;
varying vec3 vWorldN;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  vWorldN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * mv;
}
`;

const RIM_FRAG = `
uniform vec3 uCold;
uniform vec3 uWarm;
uniform vec3 uLightDir;
uniform float uPower;
uniform float uIntensity;
varying vec3 vN;
varying vec3 vView;
varying vec3 vWorldN;

void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vView)));
  f = pow(clamp(f, 0.0, 1.0), uPower);
  float t = dot(normalize(vWorldN), normalize(uLightDir)) * 0.5 + 0.5;
  vec3 col = mix(uCold, uWarm, smoothstep(0.42, 0.95, t));
  gl_FragColor = vec4(col, f * uIntensity);
}
`;

/**
 * @param {object} deps
 * @param {{isLand:(lon:number,lat:number)=>boolean}} deps.mask
 * @param {object} deps.ripples  a ripple field from proto/ripple-field.js
 * @param {(state:string, text:string)=>void} [deps.onStatus] told about data loads
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

  /* ---- the glass ball ------------------------------------------------- */
  const ballGeo = track(new THREE.SphereGeometry(AIR.ballRadius, 64, 48));
  const ballMat = track(new THREE.MeshBasicMaterial({ color: AIR.colors.ball }));
  spin.add(new THREE.Mesh(ballGeo, ballMat));

  /* ---- the atmosphere rim --------------------------------------------- */
  const shellGeo = track(new THREE.SphereGeometry(AIR.shellRadius, 64, 48));
  const shellMat = track(
    new THREE.ShaderMaterial({
      vertexShader: RIM_VERT,
      fragmentShader: RIM_FRAG,
      uniforms: {
        uCold: { value: new THREE.Color(AIR.colors.rimCold) },
        uWarm: { value: new THREE.Color(AIR.colors.rimWarm) },
        uLightDir: { value: new THREE.Vector3().fromArray(AIR.lightDir).normalize() },
        uPower: { value: AIR.rimPower },
        uIntensity: { value: AIR.rimIntensity },
      },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  fixed.add(new THREE.Mesh(shellGeo, shellMat));

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
        uDot: { value: new THREE.Color(AIR.colors.dot) },
        uHot: { value: new THREE.Color(AIR.colors.dotHot) },
        uOpacity: { value: AIR.dotOpacity },
      },
      transparent: true,
      depthWrite: false,
    })
  );

  let dotGeo = null;
  let dots = null;
  let dotCount = 0;

  /**
   * Rebuild the dot field for a given on-screen spacing.
   * @param {number} spacingPx   gap between neighbouring dots, in CSS pixels
   * @param {number} globePxRadius  how big the planet currently is, in CSS pixels
   */
  function setSpacing(spacingPx, globePxRadius) {
    /* How many points fit on the ball at this spacing, if you pack them in a
     * honeycomb: each point owns about 0.866 * spacing^2 of surface. */
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
  let seamGeo = null;
  const seamMat = track(
    new THREE.LineBasicMaterial({
      color: AIR.colors.seam,
      transparent: true,
      opacity: AIR.seamOpacity,
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
      spin.add(seams);
      onStatus('ok', lines + ' plate boundaries');
    })
    .catch((e) => {
      onStatus('error', 'Plate boundaries unavailable — ' + e.message);
    });

  /* ---- the bits the shell drives -------------------------------------- */
  return {
    id: 'air',
    spin,
    fixed,

    setSpacing,
    get dotCount() {
      return dotCount;
    },

    /** Swap between the recommended cold rim and the reference orange one. */
    setRim(useReference) {
      const c = AIR.colors;
      shellMat.uniforms.uCold.value.setHex(useReference ? c.refCold : c.rimCold);
      shellMat.uniforms.uWarm.value.setHex(useReference ? c.refWarm : c.rimWarm);
    },

    setSeamsVisible(on) {
      if (seams) seams.visible = on;
    },

    /** Called once a frame. `pxScale` is the drawing buffer height over two,
     *  which is what turns a world-unit dot size into pixels. */
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
