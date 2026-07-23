/**
 * globe3d.js — the Three.js clear globe. The planet-band entry engine (SPEC §2).
 *
 * A see-through sphere: charcoal land on the near hemisphere, the far continents
 * dimmed through the clear ocean, grey coastlines, and the cyan geodesic cage
 * whose nodes rise with storm severity.
 *
 * It is a PURE OVERLAY slaved to MapLibre. There is no dive button and no
 * separate space/map "modes": MapLibre owns the one zoom (scroll, pinch, +/-)
 * and the one camera (drag to pan). Every frame the clear globe mirrors
 * MapLibre's center + bearing, matches its own camera distance to MapLibre's
 * measured on-screen globe radius so the two are pixel-locked, and fades itself
 * out as you zoom from zSpace toward zHandoff. Zoom all the way in and it is
 * gone; MapLibre is all that's left. Zoom back out and it crossfades in again.
 *
 * This means all input is MapLibre's (the #gl canvas is pointer-events:none) —
 * which is exactly why scroll-to-zoom and drag-to-pan "just work" everywhere.
 *
 * `THREE` is a CDN global. Imports: config/, lib/, and map/heightfield.js only.
 * Never imports ui/ or data/.
 */

import { DIVE } from '../config/constants.js';
import { DARK, OPACITY, SIZE } from '../config/tokens.js';
import { DEG, lonLatToVec3, destPoint, clamp01, smoothstep } from '../lib/geo.js';
import { RINGS } from './coastline.js';
import { createHeightfield } from './heightfield.js';
import { spiralCanvas } from './glyph.js';

const R = 1.0; // unit globe

/**
 * @param {HTMLCanvasElement} canvas   - the #gl canvas
 * @param {maplibregl.Map} map         - the MapLibre map this overlay tracks
 * @param {object} opts
 * @param {HTMLElement} opts.mapEl      - MapLibre container (#globe), fades UP
 * @param {HTMLElement} opts.spaceEl    - space background (#spacebg), fades OUT
 */
export function createGlobe3d(canvas, map, { mapEl, spaceEl } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(DARK.space), 2.5, 5.0);
  const camera = new THREE.PerspectiveCamera(DIVE.fov, 1, 0.1, 100);
  camera.position.set(0, 0, DIVE.spaceDistance);

  const globe = new THREE.Group();
  scene.add(globe);

  /* --- charcoal land fill: rasterize the rings to an equirectangular texture,
   *     drape it on a lat/lon sphere. Ocean stays transparent so the clear
   *     globe reads as glass and the far continents show through. ------------ */
  function landTexture() {
    const W = 4096;
    const H = 2048;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const x = cv.getContext('2d');
    x.clearRect(0, 0, W, H);
    x.fillStyle = DARK.land3d;

    const drawRing = (r, shift) => {
      let off = 0;
      let prev = null;
      x.beginPath();
      for (let i = 0; i < r.length; i++) {
        const lon = r[i][0];
        const lat = r[i][1];
        if (prev !== null) {
          if (lon - prev > 180) off -= 360;
          else if (lon - prev < -180) off += 360;
        }
        prev = lon; // unwrap antimeridian jumps
        const px = ((lon + off + shift + 180) / 360) * W;
        const py = ((90 - lat) / 180) * H;
        if (i === 0) x.moveTo(px, py);
        else x.lineTo(px, py);
      }
      x.closePath();
      x.fill();
    };

    for (const r of RINGS) {
      drawRing(r, 0);
      drawRing(r, 360);
      drawRing(r, -360);
    }
    const capY = ((90 - DIVE.poleCap) / 180) * H;
    x.fillRect(0, capY, W, H - capY);

    const t = new THREE.CanvasTexture(cv);
    t.needsUpdate = true;
    return t;
  }

  function fillSphere() {
    const seg = 128;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let iy = 0; iy <= seg; iy++) {
      const lat = 90 - 180 * (iy / seg);
      for (let ix = 0; ix <= seg; ix++) {
        const lon = -180 + 360 * (ix / seg);
        const v = lonLatToVec3(lon, lat, R * 0.999);
        pos.push(v.x, v.y, v.z);
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

  const landGeo = fillSphere();
  const landTex = landTexture();

  const matLandFront = new THREE.MeshBasicMaterial({
    map: landTex, transparent: true, opacity: OPACITY.land3dFront,
    alphaTest: 0.5, side: THREE.FrontSide, depthTest: true, depthWrite: true, fog: true,
  });
  const landFront = new THREE.Mesh(landGeo, matLandFront);
  landFront.renderOrder = 0;
  globe.add(landFront);

  const matLandBack = new THREE.MeshBasicMaterial({
    map: landTex, transparent: true, opacity: OPACITY.land3dBack,
    alphaTest: 0.5, side: THREE.BackSide, depthTest: true, depthWrite: false, fog: true,
  });
  const landBack = new THREE.Mesh(landGeo, matLandBack);
  landBack.renderOrder = 1;
  globe.add(landBack);

  const lp = [];
  for (const ring of RINGS) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = lonLatToVec3(ring[i][0], ring[i][1], R);
      const b = lonLatToVec3(ring[i + 1][0], ring[i + 1][1], R);
      lp.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  const matCoast = new THREE.LineBasicMaterial({
    color: new THREE.Color(DARK.coast3d), transparent: true, opacity: OPACITY.coast3d,
    depthTest: true, depthWrite: false, fog: true,
  });
  const coast = new THREE.LineSegments(lg, matCoast);
  coast.renderOrder = 1;
  globe.add(coast);

  /* --- geodesic cage + storm heightfield (geometry owned by heightfield) --- */
  const heightfield = createHeightfield();

  /* vertexColors: the cage's color lives in the geometry, one value per node,
   * written by heightfield.js from the same lift that raises it. The GPU fades
   * between each segment's two endpoints, so storm color bleeds along the
   * lattice instead of stopping at a hard edge. `color` stays white — it is a
   * multiplier over the vertex colors, and anything else would tint them.
   *
   * depthTest ON: the far-side lattice hides behind the near-side continents
   * instead of showing through them. It was off, which drew the whole cage over
   * everything and let you read the back of the globe straight through South
   * America — the sphere stopped looking like a solid object. Land writes depth
   * on its FRONT face only, and its ocean pixels are discarded by alphaTest, so
   * the far cage still shows through open water. That is the intended read: a
   * clear globe where the LANDMASSES are opaque, not a wireframe ball. */
  const matCage = new THREE.LineBasicMaterial({
    vertexColors: true, color: 0xffffff, transparent: true, opacity: OPACITY.cage,
    depthTest: true, depthWrite: false, fog: true,
  });
  const cage = new THREE.LineSegments(heightfield.cageGeometry, matCage);
  cage.renderOrder = 2;
  globe.add(cage);

  function glowTex() {
    const s = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const x = cv.getContext('2d');
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(cv);
  }
  /* Same contract as the cage: per-node color from the geometry. The nodes rest
   * a step brighter than the edges they ride (DARK.node vs DARK.mesh) and both
   * arrive at the same category color at full lift.
   *
   * depthTest ON, matching the cage — nodes and the edges joining them must
   * occlude together, or the lattice comes apart at the limb with lit points
   * floating over continents whose edges have already been hidden. Additive
   * blending stays: it is what makes them read as LEDs rather than flat dots,
   * and with depthWrite off they still accumulate correctly against each other. */
  const matNodes = new THREE.PointsMaterial({
    map: glowTex(), vertexColors: true, color: 0xffffff, size: SIZE.node3dSize,
    transparent: true, opacity: OPACITY.node, depthTest: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: true,
  });
  const nodes = new THREE.Points(heightfield.nodeGeometry, matNodes);
  nodes.renderOrder = 3;
  globe.add(nodes);

  /* Storm glyphs on the surface (SPEC §9 planet band) — the SAME two-arm spiral
   * MapLibre stamps, in the SAME category color. Per-storm color rides the
   * geometry's color attribute, so a basin holding a TS and a Cat 4 draws both
   * true hues in one call per hemisphere. heightfield.js swaps those colors to
   * grey during a feed outage.
   * Hemisphere split (spiral rotation flips at the equator): two Points, two
   * textures, one material recipe. depthTest ON: a glyph on the far hemisphere
   * hides behind the globe like a position should. Sprites are drawn white so
   * the vertex color tints them without muddying. */
  const stormDotMat = (dir) =>
    new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(spiralCanvas(128, '#FFFFFF', dir)),
      vertexColors: true, color: 0xffffff,
      size: SIZE.stormDot3dSize, transparent: true, opacity: OPACITY.stormDot3d,
      depthTest: true, depthWrite: false, sizeAttenuation: true, fog: true,
    });
  const matStormDotsN = stormDotMat(1);
  const matStormDotsS = stormDotMat(-1);
  const stormDotsN = new THREE.Points(heightfield.stormDotGeometryN, matStormDotsN);
  const stormDotsS = new THREE.Points(heightfield.stormDotGeometryS, matStormDotsS);
  stormDotsN.renderOrder = 2;
  stormDotsS.renderOrder = 2;
  globe.add(stormDotsN);
  globe.add(stormDotsS);

  /* Outage recolor now lives in the GEOMETRY, not here: heightfield.js writes
   * muted grey into every node's color the moment the feed goes unavailable and
   * restores live colors when it returns. Materials stay white multipliers —
   * setting a material color here would tint the whole cage and defeat the
   * per-node severity color. All this handler still owes is a repaint, so the
   * recolor and the severity settle animate even if the map is idle. */
  heightfield.onState(() => {
    map.triggerRepaint();
  });

  /* --- geometry match: keep the clear globe pixel-locked to MapLibre --------
   * Measured near the screen CENTER — a small arc that stays on the near face
   * and on-screen at EVERY zoom. The old 80° baseline flew off the far side of
   * the globe once you zoomed in, so project() returned garbage and the overlay
   * stopped tracking. Near-center it is valid throughout the crossfade. */
  const MEASURE_DEG = 5;
  function measureRadiusPx(lon, lat) {
    const pc = map.project([lon, lat]);
    const p2 = map.project(destPoint(lon, lat, 90, MEASURE_DEG));
    const dist = Math.hypot(p2.x - pc.x, p2.y - pc.y);
    return dist / Math.sin(MEASURE_DEG * DEG);
  }
  /* rMl is MapLibre's NEAR-CENTER scale (px per radian of arc at the screen
   * center — what measureRadiusPx returns), not its limb radius. Match the
   * Three globe's near-center scale to it: f·R/(d−R) = rMl → d = R(1 + f/rMl).
   * The old silhouette formula (sqrt(1+(f/rMl)²)) sized the LIMB to a
   * near-center number, which on a perspective globe overshoots — it made the
   * clear globe read ~30% larger than MapLibre. Matching the scale where you
   * look is what locks them. DIVE.scale stays as a fine-tune knob. */
  function matchDistance(rMl) {
    const H = window.innerHeight;
    const f = H / 2 / Math.tan((DIVE.fov * DEG) / 2);
    return R * (1 + f / rMl) * DIVE.scale;
  }

  /* --- fades: everything the crossfade touches, driven by p (0..1) -------- */
  function applyFade(p) {
    matNodes.opacity = OPACITY.node * (1 - smoothstep(p, ...DIVE.fade.nodes));
    /* Storm glyphs hand off on the same band as the nodes — MapLibre's own
     * grey dots are fading in underneath as these fade out. */
    const dotFade = OPACITY.stormDot3d * (1 - smoothstep(p, ...DIVE.fade.nodes));
    matStormDotsN.opacity = dotFade;
    matStormDotsS.opacity = dotFade;
    matCage.opacity = OPACITY.cage * (1 - smoothstep(p, ...DIVE.fade.cage));
    const landF = 1 - smoothstep(p, ...DIVE.fade.land);
    matLandFront.opacity = OPACITY.land3dFront * landF;
    matLandBack.opacity = OPACITY.land3dBack * landF;
    matCoast.opacity = OPACITY.coast3d * landF;
    if (mapEl) mapEl.style.opacity = String(smoothstep(p, ...DIVE.fade.mapIn));
    if (spaceEl) spaceEl.style.opacity = String(1 - smoothstep(p, ...DIVE.fade.spaceOut));
  }

  /* --- render, SYNCED to MapLibre -----------------------------------------
   * We paint the clear globe inside MapLibre's own 'render' event — right after
   * MapLibre paints, reading the exact camera state it just drew. THIS is what
   * locks the two globes together: a separate rAF drifts out of phase, reads a
   * stale size, and the overlay lags / flickers / snaps. No separate loop. */
  let last = performance.now();
  let lastDist = DIVE.spaceDistance;

  function update() {
    const now = performance.now();
    const dt = Math.min(4, (now - last) / 16.67);
    last = now;

    const z = map.getZoom();
    const p = clamp01((z - DIVE.zSpace) / (DIVE.zHandoff - DIVE.zSpace));
    const moving = heightfield.tick(dt);

    // Fully handed off — clear the overlay so no stale globe shows over the map.
    if (p >= 1) {
      applyFade(1);
      renderer.clear();
      if (moving) map.triggerRepaint();
      return;
    }

    // Mirror MapLibre's view: center orients the globe, bearing rolls the camera.
    const c = map.getCenter();
    globe.rotation.set(c.lat * DEG, -c.lng * DEG, 0);
    const b = map.getBearing() * DEG;

    let dist = lastDist;
    /* No map.loaded() gate: project() works off the style transform, which
     * exists from the first frame — and gating on loaded() meant slow (or
     * failed) TILES held the overlay at the desktop-tuned fallback distance,
     * oversizing the globe on a phone whose floor zoom sits below zSpace.
     * The try/catch already absorbs any pre-first-frame throw. */
    try {
      const d = matchDistance(measureRadiusPx(c.lng, c.lat));
      if (isFinite(d) && d > R) dist = d; // ignore a bad frame rather than jump
    } catch {
      /* hold last */
    }
    lastDist = dist;

    // Fog tracks the camera so the FAR hemisphere dims consistently at any
    // distance. Fixed fog planes went black when the camera pulled back.
    scene.fog.near = Math.max(0.05, dist - R * 1.15);
    scene.fog.far = dist + R * 1.7;

    /* Bearing: roll the camera the same way MapLibre rolls its content. The
     * original sign (sin(-b)) rolled the overlay OPPOSITE to a two-finger
     * twist — found on a phone, where rotate is a primary gesture. Verified
     * against MapLibre side-by-side at bearing 40. */
    camera.up.set(Math.sin(b), Math.cos(b), 0);
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);

    applyFade(p);
    renderer.render(scene, camera);

    if (moving) map.triggerRepaint(); // keep frames coming while the cage settles
  }

  map.on('render', update);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    map.triggerRepaint(); // repaint the overlay at the new size
  }
  resize();

  return { canvas, heightfield, resize };
}
