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
import { OPACITY, SIZE } from '../config/tokens.js';
import { palette, isLight } from '../config/theme.js';
import { lonLatToVec3, smoothstep } from '../lib/geo.js';
import { divePhase, followMap } from './globe-follow.js';
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
  scene.fog = new THREE.Fog(new THREE.Color(palette().space), 2.5, 5.0);
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
    x.fillStyle = palette().land3d;

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

  /* FAR-SIDE LAND IS ADDITIVE, and that is the whole fix for storm tracks being
   * swallowed on the back of the globe.
   *
   * The #gl canvas sits ABOVE MapLibre (z-index 2 over 1), so every pixel this
   * file draws composites over the map. With NormalBlending that made this
   * surface destructive: scene.fog blends fragments toward `space` (near-black in dark,
   * near-black) by distance, and `transparent` + opacity 0.60 then painted that
   * near-black over MapLibre at 60% alpha. The far continents were not "dim
   * land seen through glass" — they were a dark wash whose strength varied with
   * depth, heaviest at the limb. Storm tracks crossing the far hemisphere got
   * progressively darker the further back they went.
   *
   * AdditiveBlending can only ADD light to what is underneath. The far
   * continents still render — Aaron wants to see them through the clear globe —
   * but as a faint glow layered onto the map instead of a wash over it. A
   * bright track underneath stays bright because nothing can subtract from it.
   * Fog stops being a problem for the same reason: fogging toward near-black
   * now means "add almost nothing," which is a natural distance falloff.
   *
   * This is the same reason the cage and nodes never caused this bug — matNodes
   * has been additive all along, which is why the yellow lattice crosses storm
   * dots without eating them.
   *
   * Opacity drops 0.60 -> 0.35 to compensate: additive over a dark basemap
   * reads brighter than normal blending at the same number. */
  const matLandBack = new THREE.MeshBasicMaterial({
    map: landTex, transparent: true, opacity: OPACITY.land3dBack,
    alphaTest: 0.5, side: THREE.BackSide, depthTest: true, depthWrite: false,
    /* Additive ONLY on a dark sky. Additive over the light theme's pale sky
     * saturates the far hemisphere to white — see retheme() at the bottom of
     * this file for the full reasoning. Set at construction as well as in
     * retheme so a boot straight into light mode is already correct. */
    blending: isLight() ? THREE.NormalBlending : THREE.AdditiveBlending, fog: true,
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
  /* Additive for the same reason as matLandBack above: this is ONE LineSegments
   * covering both hemispheres, so the far-side coast was painting fogged
   * near-black over MapLibre at 55% alpha alongside the land it edges. The
   * source color (#8A97A4) is a light grey, so additive turns it into a faint
   * bright coastline rather than a dark one — which is the read we want on a
   * dark map anyway. Opacity is unchanged: these are thin lines, not a fill. */
  const matCoast = new THREE.LineBasicMaterial({
    color: new THREE.Color(palette().coast3d), transparent: true, opacity: OPACITY.coast3d,
    depthTest: true, depthWrite: false,
    blending: isLight() ? THREE.NormalBlending : THREE.AdditiveBlending, fog: true,
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
   * clear globe where the LANDMASSES are opaque, not a wireframe ball.
   *
   * THE LIMIT OF THAT, worth knowing before you debug anything that looks like
   * an overlap: depth testing here is entirely INTERNAL to Three.js. MapLibre
   * renders to its own canvas with its own depth buffer, so nothing in this
   * file can occlude — or be occluded by — storm tracks, cones, or points.
   * renderOrder and depthWrite are inert across that boundary.
   *
   * But the lever is BLENDING, not just opacity. This canvas composites over
   * MapLibre, so a NormalBlending surface paints its color over the map and can
   * DARKEN it; an AdditiveBlending surface can only add light and cannot hide
   * anything beneath it. Far-side land and coast are additive for exactly that
   * reason (see matLandBack). Check a surface's blending before you touch the
   * DIVE.fade timings — fade controls WHEN something is present, blending
   * controls whether its presence is destructive. */
  const matCage = new THREE.LineBasicMaterial({
    vertexColors: true, color: 0xffffff, transparent: true, opacity: OPACITY.cage,
    depthTest: true, depthWrite: false, fog: true,
  });
  const cage = new THREE.LineSegments(heightfield.cageGeometry, matCage);
  cage.renderOrder = 2;
  globe.add(cage);

  /* The storm-lit fill (SPEC §9): a low wash inside every cage triangle holding
   * at least one storm-lifted corner, so a storm reads as a presence in an area
   * and not only as a spike. Geometry, color, and alpha all belong to
   * heightfield.js — this file only decides how it is painted.
   *
   * NORMAL blending, deliberately NOT the additive the nodes use. Additive is
   * what makes a node read as an LED, but this covers area rather than points,
   * and additive over the lit near continents would bloom into haze exactly
   * where the map still has to be readable. `color: 0xffffff` is a multiplier
   * of one — the real color is per-corner.
   *
   * renderOrder 1, with the other surface-level translucent layers and BELOW
   * the cage: the lattice and its nodes must read on top of the wash, not
   * through it. depthWrite off for the same reason the cage has it off — the
   * fill rides the very points the cage is drawn from, and a fill that wrote
   * depth would occlude its own lattice.
   *
   * FrontSide: the icosphere winds outward (verified — all 20 base faces, and
   * subdivision preserves it), so back faces are the inside of the dome. */
  const matFill = new THREE.MeshBasicMaterial({
    vertexColors: true, color: 0xffffff, transparent: true, opacity: OPACITY.meshFill,
    side: THREE.FrontSide, depthTest: true, depthWrite: false, fog: true,
  });
  const fill = new THREE.Mesh(heightfield.fillGeometry, matFill);
  fill.renderOrder = 1;
  globe.add(fill);

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
   * a step brighter than the edges they ride (`node` vs `mesh`) and both
   * arrive at the same category color at full lift.
   *
   * depthTest ON, matching the cage — nodes and the edges joining them must
   * occlude together, or the lattice comes apart at the limb with lit points
   * floating over continents whose edges have already been hidden.
   *
   * ADDITIVE ON A DARK SKY ONLY. Additive is what makes these read as LEDs, and
   * with depthWrite off they accumulate correctly against each other — but an
   * LED is a thing that EMITS, and nothing emits visibly against daylight. In
   * the light theme the nodes are dark teal and additive would add almost
   * nothing to a pale sky: the signal would vanish. Normal blending paints them
   * ON the globe instead, which is the correct read for a dark mark on a bright
   * surface. Same call the far-side land makes, for the same reason. */
  const matNodes = new THREE.PointsMaterial({
    map: glowTex(), vertexColors: true, color: 0xffffff, size: SIZE.node3dSize,
    transparent: true, opacity: OPACITY.node, depthTest: true, depthWrite: false,
    blending: isLight() ? THREE.NormalBlending : THREE.AdditiveBlending,
    sizeAttenuation: true, fog: true,
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
   * The measurement, the distance formula and the three signs all live in
   * map/globe-follow.js now. They were extracted so the three-worlds prototype
   * could import them instead of hand-rolling a second, wrong copy — see that
   * file's header. Nothing about the behaviour changed in the move. */

  /* --- fades: everything the crossfade touches, driven by p (0..1) -------- */
  function applyFade(p) {
    matNodes.opacity = OPACITY.node * (1 - smoothstep(p, ...DIVE.fade.nodes));
    /* Storm glyphs hand off on the same band as the nodes — MapLibre's own
     * grey dots are fading in underneath as these fade out. */
    const dotFade = OPACITY.stormDot3d * (1 - smoothstep(p, ...DIVE.fade.nodes));
    matStormDotsN.opacity = dotFade;
    matStormDotsS.opacity = dotFade;
    const cageFade = 1 - smoothstep(p, ...DIVE.fade.cage);
    matCage.opacity = OPACITY.cage * cageFade;
    /* The fill leaves WITH the lattice it belongs to. On any other schedule you
     * get colored triangles hanging over a MapLibre map that has already taken
     * over, or bare lines over a wash that outlived them. */
    matFill.opacity = OPACITY.meshFill * cageFade;
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

    const p = divePhase(map.getZoom());
    const moving = heightfield.tick(dt);

    // Fully handed off — clear the overlay so no stale globe shows over the map.
    if (p >= 1) {
      applyFade(1);
      renderer.clear();
      if (moving) map.triggerRepaint();
      return;
    }

    /* Mirror MapLibre's view: centre orients the globe, bearing rolls the
     * camera, and the on-screen size sets the distance. All three signs and the
     * measurement live in map/globe-follow.js. */
    const dist = followMap(map, { group: globe, camera, lastDist });
    lastDist = dist;

    // Fog tracks the camera so the FAR hemisphere dims consistently at any
    // distance. Fixed fog planes went black when the camera pulled back.
    scene.fog.near = Math.max(0.05, dist - R * 1.15);
    scene.fog.far = dist + R * 1.7;

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

  /**
   * Repaint the 3D globe for a new theme.
   *
   * THE LAND TEXTURE IS REDRAWN, not tinted. It is a 4096x2048 canvas with the
   * continents filled in the theme's land colour and the ocean left
   * transparent, so there is no tint that turns a night-charcoal landmass into
   * a daylight one. Regenerating it costs a few milliseconds ONCE, on a
   * deliberate user action — cheap in the only place it is ever spent.
   *
   * ADDITIVE BLENDING IS WHY THE FAR HEMISPHERE NEEDS WATCHING HERE. matLandBack
   * and matCoast can only ADD light (see their notes above), which is the right
   * read on a dark sky and the wrong one on a bright sky — additive over a pale
   * background saturates to white. Both flip to normal blending in the light
   * theme, where "behind the glass" means slightly darker, not slightly
   * brighter. This is the one place the two themes need different mechanics
   * rather than different numbers.
   */
  function retheme() {
    const P = palette();
    const light = isLight();

    scene.fog.color.set(P.space);

    const tex = landTexture();
    for (const m of [matLandFront, matLandBack]) {
      m.map?.dispose();
      m.map = tex;
      m.needsUpdate = true;
    }
    for (const [m, c] of [[matLandBack, null], [matCoast, P.coast3d], [matNodes, null]]) {
      m.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
      if (c) m.color.set(c);
      m.needsUpdate = true;
    }

    /* THE STORM GLYPH SPRITES CARRY A BAKED-IN HALO. `spiralCanvas` draws the
     * spiral onto a canvas with `glyphHalo` as its drop shadow (map/glyph.js),
     * so the halo colour is fixed at the moment the texture is rasterised —
     * a texture made in the dark theme keeps its dark-ocean halo forever. The
     * only honest fix is to redraw them. */
    for (const [m, dir] of [[matStormDotsN, 1], [matStormDotsS, -1]]) {
      m.map?.dispose();
      m.map = new THREE.CanvasTexture(spiralCanvas(128, '#FFFFFF', dir));
      m.needsUpdate = true;
    }

    heightfield.retheme();
    map.triggerRepaint();
  }

  return { canvas, heightfield, resize, retheme };
}
