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
import { SIZE } from '../config/tokens.js';
import { palette, isLight, fx } from '../config/theme.js';
import { lonLatToVec3, smoothstep } from '../lib/geo.js';
import { divePhase, followMap, radiusPxAt } from './globe-follow.js';
import { RINGS } from './coastline.js';
import { createHeightfield } from './heightfield.js';
import { createLimbGlow } from './limb-glow.js';
import { spiralCanvas } from './glyph.js';
import { createWatchMarks } from './watch-marks.js';

const R = 1.0; // unit globe

/**
 * @param {HTMLCanvasElement} canvas   - the #gl canvas
 * @param {maplibregl.Map} map         - the MapLibre map this overlay tracks
 * @param {object} opts
 * @param {HTMLElement} opts.mapEl      - MapLibre container (#globe), fades UP
 * @param {HTMLElement} opts.spaceEl    - space background (#spacebg), fades OUT
 * @param {HTMLCanvasElement} opts.glowEl - storm-light layer (#glow), below the
 *                                          map; see map/limb-glow.js
 */
export function createGlobe3d(canvas, map, { mapEl, spaceEl, glowEl } = {}) {
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
   *     globe reads as glass and the far continents show through.
   *
   *     SIZED BY THE CALLER, because this runs twice: a cheap draft so the
   *     globe can appear at all, then the full size once the app is idle. See
   *     DIVE.landW / landDraftW for the arithmetic behind both numbers, and
   *     `scheduleLandUpgrade` below for the swap. ---------------------------- */
  function landTexture(W, H) {
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
  /* The DRAFT. The globe boots on this so it can appear at all; the full-size
   * texture replaces it about a second later (scheduleLandUpgrade, below). */
  const landTex = landTexture(DIVE.landDraftW, DIVE.landDraftH);

  const matLandFront = new THREE.MeshBasicMaterial({
    map: landTex, transparent: true, opacity: fx().land3dFront,
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
    map: landTex, transparent: true, opacity: fx().land3dBack,
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

  /* --- THE LAND TEXTURE UPGRADE -------------------------------------------
   *
   * Both land materials share ONE texture, which is the whole reason this is
   * a function rather than a loop at each call site: disposing inside a loop
   * over the two materials disposes the same texture twice and leaks nothing
   * but confusion. Dispose once, after both have let go of it.
   */
  function applyLandTexture(tex) {
    const old = matLandFront.map;
    for (const m of [matLandFront, matLandBack]) {
      m.map = tex;
      m.needsUpdate = true;
    }
    if (old && old !== tex) old.dispose();
  }

  /* Which land texture is current. Bumped by every request to build one, so a
   * build that finishes AFTER a newer one was asked for knows to throw itself
   * away — the case being guarded is a theme switch landing mid-upgrade, where
   * the in-flight build would otherwise repaint the globe in the old palette.
   *
   * NOTE for whoever adds a dispose()/teardown to this module (the world
   * switcher will need one): call `cancelUpgrade?.()` there, or a pending
   * build fires into a dead scene. */
  let landGen = 0;
  let cancelUpgrade = null;

  /** Build the full-size land texture once the app has settled, and swap it
   *  in. Cancels any upgrade already pending, so a burst of theme switches
   *  costs one full-size build rather than one per switch. */
  function scheduleLandUpgrade() {
    const gen = ++landGen;
    cancelUpgrade?.();
    const run = () => {
      cancelUpgrade = null;
      if (gen !== landGen) return; // a newer request superseded this one
      applyLandTexture(landTexture(DIVE.landW, DIVE.landH));
      map.triggerRepaint();
    };
    /* requestIdleCallback where it exists (Safari does not implement it), with
     * its timeout set to the same delay so the upgrade lands on a predictable
     * schedule either way. The canceller is kept as a closure rather than a
     * raw handle because the two schedulers hand back ids from different
     * namespaces and guessing which one you hold is how this goes wrong. */
    if (typeof requestIdleCallback === 'function') {
      const h = requestIdleCallback(run, { timeout: DIVE.landUpgradeDelay });
      cancelUpgrade = () => { cancelIdleCallback(h); cancelUpgrade = null; };
    } else {
      const h = setTimeout(run, DIVE.landUpgradeDelay);
      cancelUpgrade = () => { clearTimeout(h); cancelUpgrade = null; };
    }
  }

  scheduleLandUpgrade();

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
    color: new THREE.Color(palette().coast3d), transparent: true, opacity: fx().coast3d,
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
    vertexColors: true, color: 0xffffff, transparent: true, opacity: fx().cage,
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
    vertexColors: true, color: 0xffffff, transparent: true, opacity: fx().meshFill,
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
    transparent: true, opacity: fx().node, depthTest: true, depthWrite: false,
    blending: isLight() ? THREE.NormalBlending : THREE.AdditiveBlending,
    sizeAttenuation: true, fog: true,
  });
  const nodes = new THREE.Points(heightfield.nodeGeometry, matNodes);
  nodes.renderOrder = 3;
  globe.add(nodes);

  /* Storm glyphs on the surface (SPEC §9 planet band) — the app's own logo
   * mark, in the SAME category color. Per-storm color rides the geometry's
   * color attribute, so a basin holding a TS and a Cat 4 draws both true hues
   * in one call per hemisphere. heightfield.js swaps those colors to grey
   * during a feed outage.
   * Hemisphere split (spiral rotation flips at the equator): two Points, two
   * textures, one material recipe. depthTest ON: a glyph on the far hemisphere
   * hides behind the globe like a position should. Sprites are drawn white so
   * the vertex color tints them without muddying.
   *
   * ==> `sizeAttenuation: false` — THE GLYPH IS A FIXED NUMBER OF SCREEN
   * PIXELS, AND THAT IS DELIBERATE. <== With attenuation ON the sprite was
   * sized in WORLD units, and the camera distance is recomputed each frame from
   * MapLibre's on-screen globe radius (map/globe-follow.js) — so the mark grew
   * with every zoom step, roughly doubling per level. That put it tiny at the
   * space floor, where the whole planet is on screen and a storm most needs
   * finding, and enormous by the time it faded out. A storm marker is a LABEL,
   * not a footprint: it says "a cyclone is here", never "the cyclone is this
   * big". It should read the same at every altitude, and the wind field and the
   * cone are what carry actual extent.
   *
   * The cage nodes keep their attenuation. They ARE geometry — a lattice
   * sitting on the sphere — and a lattice whose spacing changes with zoom while
   * its dots do not would come apart. */
  const stormDotMat = (dir) =>
    new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(spiralCanvas(SIZE.glyphTexturePx, '#FFFFFF', dir)),
      vertexColors: true, color: 0xffffff,
      size: SIZE.stormDot3dPx, transparent: true, opacity: fx().stormDot3d,
      depthTest: true, depthWrite: false, sizeAttenuation: false, fog: true,
    });
  const matStormDotsN = stormDotMat(1);
  const matStormDotsS = stormDotMat(-1);
  const stormDotsN = new THREE.Points(heightfield.stormDotGeometryN, matStormDotsN);
  const stormDotsS = new THREE.Points(heightfield.stormDotGeometryS, matStormDotsS);
  stormDotsN.renderOrder = 2;
  stormDotsS.renderOrder = 2;
  globe.add(stormDotsN);
  globe.add(stormDotsS);

  /* ==> WATCHED AREAS GET A MARK OUT HERE TOO (§45.4). <==
   *
   * MapLibre's canvas is at opacity 0 at the space floor, so `layers/genesis.js`
   * draws nothing at the zoom the app OPENS AT. Without this, a day with no
   * storms and five watched areas opened on an empty planet with the answer two
   * pinches away. Dashed rings, deliberately not spirals and deliberately not
   * filled dots — see map/watch-marks.js for why each of those is forbidden.
   *
   * It does NOT touch the heightfield. The cage lifting means "a storm is
   * here", and a maybe must never make that claim; these are flat marks on the
   * same shell as the storm glyphs and the mesh underneath them is unmoved. */
  const watchMarks = createWatchMarks(THREE, { palette });
  for (const o of watchMarks.objects) globe.add(o);

  /* ==> STORM LIGHT ON THE BACKDROP (map/limb-glow.js). <==
   *
   * NOT part of this scene, and that is the whole design — it draws onto its
   * own 2D canvas BELOW MapLibre so the browser can blend it with the CSS
   * gradient. Anything drawn up here composites OVER the backdrop and can
   * never add light into it. The full reasoning is in that file's header.
   *
   * It reads the SAME point list the cage's elevation reads, so a storm that
   * lifts the lattice is the storm that lights the sky, by construction. */
  const limbGlow = glowEl
    ? createLimbGlow(glowEl, {
        getStormPoints: heightfield.getStormPoints,
        getState: heightfield.getState,
      })
    : null;

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
    /* Bound once per frame rather than seven times. `fx()` is a property read,
     * not a computation, but this runs on every render and the local also makes
     * it obvious that all seven values come from ONE theme — a frame that read
     * four dark numbers and three light ones would be a tearing bug nobody
     * would think to look for. */
    const F = fx();
    matNodes.opacity = F.node * (1 - smoothstep(p, ...DIVE.fade.nodes));
    /* Storm glyphs hand off on the same band as the nodes — MapLibre's own
     * grey dots are fading in underneath as these fade out. */
    const dotFade = F.stormDot3d * (1 - smoothstep(p, ...DIVE.fade.nodes));
    matStormDotsN.opacity = dotFade;
    matStormDotsS.opacity = dotFade;
    /* THE SAME BAND, AND THAT IS THE WHOLE HANDOFF. The ring leaves exactly as
     * the hatched patch arrives underneath it — no gap where a watched area is
     * invisible, and no band where both are at full strength claiming the same
     * spot twice. Both curves are complements of one `p`. */
    watchMarks.setFade(p, smoothstep);
    const cageFade = 1 - smoothstep(p, ...DIVE.fade.cage);
    matCage.opacity = F.cage * cageFade;
    /* The fill leaves WITH the lattice it belongs to. On any other schedule you
     * get colored triangles hanging over a MapLibre map that has already taken
     * over, or bare lines over a wash that outlived them. */
    matFill.opacity = F.meshFill * cageFade;
    const landF = 1 - smoothstep(p, ...DIVE.fade.land);
    matLandFront.opacity = F.land3dFront * landF;
    matLandBack.opacity = F.land3dBack * landF;
    matCoast.opacity = F.coast3d * landF;
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
      /* The glow lives on its own canvas, so `renderer.clear()` does not touch
       * it. Told explicitly, or the last frame's light stays burnt onto the
       * backdrop for the whole time the flat map is up. */
      limbGlow?.update({ group: globe, camera, radiusPx: 0, p: 1 });
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

    /* AFTER the render, and using the SAME camera state this frame drew with.
     * The globe's on-screen radius comes out of the distance match rather than
     * being measured again: `matchDistance` is the inverse of that measurement
     * (map/globe-follow.js), so this is MapLibre's own number arrived at
     * without a second `project()` round-trip per frame. */
    limbGlow?.update({
      group: globe,
      camera,
      radiusPx: radiusPxAt(dist),
      p,
    });

    if (moving) map.triggerRepaint(); // keep frames coming while the cage settles
  }

  map.on('render', update);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    limbGlow?.resize(); // its buffer is sized off the viewport too
    map.triggerRepaint(); // repaint the overlay at the new size
  }
  resize();

  /**
   * Repaint the 3D globe for a new theme.
   *
   * THE LAND TEXTURE IS REDRAWN, not tinted. It is a 4096x2048 canvas with the
   * continents filled in the theme's land color and the ocean left
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

    /* The rings carry a BAKED halo like the storm glyph does, so their
     * textures are rasterised per theme and have to be re-made here. Their ink
     * is a vertex color and needs nothing. */
    watchMarks.retheme();

    /* Same draft-then-upgrade as boot, for the same reason: the full-size
     * rasterise-and-upload is 713 ms, and spending it inline here freezes the
     * app on the frame someone taps the theme toggle — the one moment they are
     * watching for a response. The draft answers the tap immediately and the
     * full size arrives behind it. */
    applyLandTexture(landTexture(DIVE.landDraftW, DIVE.landDraftH));
    scheduleLandUpgrade();

    for (const [m, c] of [[matLandBack, null], [matCoast, P.coast3d], [matNodes, null]]) {
      m.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
      if (c) m.color.set(c);
      m.needsUpdate = true;
    }

    /* THE STORM GLYPH SPRITES CARRY A BAKED-IN HALO. `spiralCanvas` draws the
     * spiral onto a canvas with `glyphHalo` as its drop shadow (map/glyph.js),
     * so the halo color is fixed at the moment the texture is rasterised —
     * a texture made in the dark theme keeps its dark-ocean halo forever. The
     * only honest fix is to redraw them. */
    for (const [m, dir] of [[matStormDotsN, 1], [matStormDotsS, -1]]) {
      m.map?.dispose();
      m.map = new THREE.CanvasTexture(spiralCanvas(SIZE.glyphTexturePx, '#FFFFFF', dir));
      m.needsUpdate = true;
    }

    heightfield.retheme();

    /* The backdrop light flips MECHANISM, not just numbers — `screen` over a
     * night sky, `multiply` over a daylight one — for exactly the reason the
     * far-side land does above. Same call, one layer down. */
    limbGlow?.retheme();

    map.triggerRepaint();
  }

  return { canvas, heightfield, watchMarks, limbGlow, resize, retheme };
}
