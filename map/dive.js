/**
 * dive.js — the lockstep transition between the 3D clear globe and MapLibre.
 *
 * One continuous zoom drives BOTH engines (SPEC §2). MapLibre jumps through the
 * zoom range while the Three camera distance is recomputed EACH FRAME from
 * MapLibre's measured on-screen globe radius, so the two globes stay pixel-
 * aligned — it reads as a single fall from space into the map. Meanwhile the
 * land/cage/nodes fade, the map fades up, and the space background fades out,
 * on the choreography in DIVE.fade.
 *
 * Owns none of the geometry: it reads the fade handle globe3d hands it and
 * touches the MapLibre map. Under reduce-motion the whole thing collapses to an
 * instant cut (SPEC §9 / REDUCED.instantCamera) — a 1.7 s fall is exactly what
 * reduce-motion exists to prevent.
 *
 * Imports: config/ and lib/ only. The map, the globe3d handle, the DOM layers,
 * and the enter/exit callbacks are all passed in by main.js (wiring).
 */

import { DIVE } from '../config/constants.js';
import { DURATION, prefersReducedMotion } from '../config/motion.js';
import { DEG, destPoint, clamp01, smoothstep } from '../lib/geo.js';

const R = 1.0; // unit globe, matches globe3d

/**
 * @param {maplibregl.Map} map
 * @param {ReturnType<import('./globe3d.js').createGlobe3d>} g3d
 * @param {object} opts
 * @param {HTMLElement} opts.mapEl   - the MapLibre container (#globe), fades UP
 * @param {HTMLElement} opts.spaceEl - the space background (#spacebg), fades OUT
 * @param {() => void} [opts.onEnterMap]   - fired once the dive lands in the map
 * @param {() => void} [opts.onEnterSpace] - fired once a rise lands back in space
 */
export function createDive(map, g3d, { mapEl, spaceEl, onEnterMap, onEnterSpace } = {}) {
  const { camera, mats, rest } = g3d.fade;
  let z0 = DIVE.mapStartZoom; // solveFraming() overwrites this from the framing
  let anim = null; // { dir: 1 | -1, t0, center }

  /* --- geometry match: how big is MapLibre's globe on screen right now? ---- */
  function measureRadiusPx(lon, lat) {
    const pc = map.project([lon, lat]);
    const d2 = destPoint(lon, lat, 90, 80);
    const p2 = map.project(d2);
    const dist = Math.hypot(p2.x - pc.x, p2.y - pc.y);
    return dist / Math.sin(80 * DEG);
  }
  function matchDistance(rMl) {
    const H = window.innerHeight;
    const f = H / 2 / Math.tan((DIVE.fov * DEG) / 2);
    return R * Math.sqrt(1 + (f / rMl) * (f / rMl)) * DIVE.scale;
  }

  /* --- the shared progress function: p in [0,1] drives everything --------- */
  function applyProgress(p, center) {
    // one continuous zoom, eased, drives both engines
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // easeInOut
    const z = z0 + (DIVE.mapEndZoom - z0) * e;
    map.jumpTo({ center, zoom: z, bearing: 0, pitch: 0 });

    if (p < DIVE.followUntil) {
      camera.position.z = matchDistance(measureRadiusPx(center[0], center[1]));
    }

    // nodes + cage LINGER then fade; land holds under them a beat longer
    mats.nodes.opacity = rest.nodes * (1 - smoothstep(p, ...DIVE.fade.nodes));
    mats.cage.opacity = rest.cage * (1 - smoothstep(p, ...DIVE.fade.cage));
    const landF = 1 - smoothstep(p, ...DIVE.fade.land);
    mats.landFront.opacity = rest.landFront * landF;
    mats.landBack.opacity = rest.landBack * landF;
    mats.coast.opacity = rest.coast * landF;

    if (mapEl) mapEl.style.opacity = String(smoothstep(p, ...DIVE.fade.mapIn));
    if (spaceEl) spaceEl.style.opacity = String(1 - smoothstep(p, ...DIVE.fade.spaceOut));
  }

  /* --- landing / departure ------------------------------------------------ */
  function landInMap() {
    g3d.setMode('map');
    if (mapEl) mapEl.style.pointerEvents = 'auto';
    g3d.canvas.style.pointerEvents = 'none';
    g3d.setDiveDriver(null);
    anim = null;
    onEnterMap?.();
  }
  function landInSpace(center) {
    g3d.setMode('space');
    camera.position.z = DIVE.spaceDistance;
    if (mapEl) mapEl.style.pointerEvents = 'none';
    g3d.canvas.style.pointerEvents = 'auto';
    g3d.setDiveDriver(null);
    anim = null;
    onEnterSpace?.(center);
  }

  function step(now) {
    if (!anim) return;
    const raw = clamp01((now - anim.t0) / DURATION.dive);
    const p = anim.dir > 0 ? raw : 1 - raw;
    applyProgress(p, anim.center);
    if (raw >= 1) {
      if (anim.dir > 0) landInMap();
      else landInSpace(anim.center);
    }
  }

  /* --- public: forward dive ---------------------------------------------- */
  function start(center) {
    if (anim || g3d.getMode() !== 'space') return;
    if (prefersReducedMotion()) {
      applyProgress(1, center); // instant cut, no animation
      landInMap();
      return;
    }
    g3d.setMode('diving');
    anim = { dir: 1, t0: performance.now(), center };
    g3d.setDiveDriver(step);
  }

  /* --- public: rise back to space ---------------------------------------- */
  function reverse() {
    if (anim || g3d.getMode() !== 'map') return;
    const c = map.getCenter();
    const center = [c.lng, c.lat];
    g3d.faceLonLat(center[0], center[1]); // line the globe up with the map view
    if (prefersReducedMotion()) {
      applyProgress(0, center);
      landInSpace(center);
      return;
    }
    g3d.setMode('rising');
    anim = { dir: -1, t0: performance.now(), center };
    g3d.setDiveDriver(step);
  }

  /* --- derive MapLibre's start zoom from the 3D framing (SPEC §2) ---------- *
   * Bisection: find the zoom whose measured globe radius matches the Three
   * camera at spaceDistance, so the dive starts pixel-aligned. Runs on map load
   * and on resize while still in space. */
  function solveFraming() {
    const H = window.innerHeight;
    const f = H / 2 / Math.tan((DIVE.fov * DEG) / 2);
    const targetR =
      f / Math.sqrt((DIVE.spaceDistance / (R * DIVE.scale)) ** 2 - 1);
    let lo = 0.3;
    let hi = 5.0;
    for (let it = 0; it < 24; it++) {
      const mid = (lo + hi) / 2;
      map.jumpTo({ center: [0, 0], zoom: mid });
      if (measureRadiusPx(0, 0) < targetR) lo = mid;
      else hi = mid;
    }
    z0 = Math.round(((lo + hi) / 2) * 1000) / 1000;
    map.jumpTo({ center: [0, 0], zoom: z0 });
    camera.position.z = DIVE.spaceDistance;
  }

  return {
    start,
    reverse,
    solveFraming,
    isAnimating: () => anim !== null,
  };
}
