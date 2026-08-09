/**
 * globe-follow.js — HOW A THREE.JS CAMERA FOLLOWS MAPLIBRE. One copy, shared.
 *
 * ==> WHY THIS FILE EXISTS. <==
 * MapLibre owns the camera and every gesture (SPEC §2, §10). Anything drawn in
 * Three.js on top of it is a passenger: it reads MapLibre's centre, bearing and
 * on-screen size each frame and copies them. That copy is fiddly — three signs,
 * a projection measurement and a distance formula, each of which has been wrong
 * at least once and each of which was found on a phone, not in code review.
 *
 * It used to live inside `globe3d.js`'s closure, which meant the three-worlds
 * prototype could not reach it and hand-rolled its own drag/pinch/keys instead.
 * That copy got the vertical drag backwards, got the arrow keys backwards, had
 * no two-finger twist, no momentum and no pinch anchor — a whole second input
 * model that felt nothing like the app. Extracting this is what stops that
 * happening again: there is now one answer to "which way is up", and both
 * globes import it.
 *
 * NOTHING HERE READS OR WRITES THE DOM, and nothing here needs THREE. It only
 * calls methods on the camera object it is handed, so it stays testable and it
 * cannot drag a rendering engine into a caller that does not have one.
 *
 * Imports: config/ and lib/ only.
 */

import { DIVE } from '../config/constants.js';
import { DEG, destPoint, clamp01 } from '../lib/geo.js';

/** The unit globe every Three overlay in this app is built on. */
const R = 1.0;

/**
 * The arc, in degrees, used to measure MapLibre's on-screen scale.
 *
 * MEASURED NEAR THE SCREEN CENTRE, and small on purpose — a small arc stays on
 * the near face and on-screen at EVERY zoom. An earlier 80° baseline flew off
 * the far side of the globe once you zoomed in, so `project()` returned garbage
 * and the overlay stopped tracking mid-dive.
 */
const MEASURE_DEG = 5;

/**
 * MapLibre's near-centre scale: screen pixels per radian of arc at the point
 * you are actually looking at.
 *
 * NOT the globe's limb radius. The two differ on a perspective globe and
 * confusing them is what made the clear globe read ~30% too large — see
 * `matchDistance` below.
 *
 * @param {object} map    a MapLibre map
 * @param {number} lon
 * @param {number} lat
 * @returns {number} pixels per radian
 */
export function measureRadiusPx(map, lon, lat) {
  const pc = map.project([lon, lat]);
  const p2 = map.project(destPoint(lon, lat, 90, MEASURE_DEG));
  const d = Math.hypot(p2.x - pc.x, p2.y - pc.y);
  return d / Math.sin(MEASURE_DEG * DEG);
}

/**
 * Camera distance (in globe radii) that makes a Three globe the same on-screen
 * size as MapLibre's.
 *
 * Match the Three globe's NEAR-CENTRE scale to MapLibre's near-centre scale:
 *   f·R / (d − R) = rMl   →   d = R(1 + f/rMl)
 *
 * THE OLD SILHOUETTE FORMULA — sqrt(1 + (f/rMl)²) — SIZED THE LIMB TO A
 * NEAR-CENTRE NUMBER, which on a perspective globe overshoots. Matching the
 * scale where you are looking is what locks the two together.
 *
 * `DIVE.scale` stays as a fine-tune knob and is 1.0 when they are pixel-locked.
 *
 * @param {number} rMl  from measureRadiusPx()
 * @returns {number} distance in globe radii
 */
export function matchDistance(rMl) {
  const H = window.innerHeight;
  const f = H / 2 / Math.tan((DIVE.fov * DEG) / 2);
  return R * (1 + f / rMl) * DIVE.scale;
}

/**
 * MapLibre's own latitude ceiling. Used here ONLY as a divide-by-zero guard:
 * the normalisation below divides by cos(lat), which is 0 at the pole. The
 * camera cannot legally get there — MapLibre clamps the centre to this
 * latitude itself — so clamping to the same number means this function can
 * never be the thing that produces an Infinity.
 */
const LAT_CEILING = 85.051129;

/**
 * MapLibre's zoom, normalised to the number it would report at the equator.
 *
 * ==> WHY THIS EXISTS, AND WHY EVERY `DIVE` COMPARISON MUST USE IT. <==
 *
 * On the globe projection MapLibre draws the planet at a pixel radius of
 * `worldSize / (2π · cos(latitude))`, so at a FIXED zoom number the globe
 * swells as the centre approaches a pole. MapLibre hides that by silently
 * rewriting the zoom on every camera move — `handleMapControlsPan`,
 * `handleJumpToCenterZoom` (which is where `map.setCenter` lands),
 * `handleEaseTo` and `handleFlyTo` all end with
 * `setZoom(oldZoom + log2(cos(newLat) / cos(oldLat)))`. The picture keeps its
 * scale; the NUMBER moves. Equator to 60° is a full zoom level, equator to
 * 75° is nearly two.
 *
 * That is fine for MapLibre — the number it wants is a Mercator ground scale,
 * and ground scale genuinely does change with latitude. It is wrong for
 * anything that asks "how far into the dive are we", because the dive is
 * about APPARENT SIZE and the apparent size did not change. The crossfade band
 * is only three zoom levels wide (`zSpace`..`zHandoff`), so a one-level
 * latitude swing slid it by a THIRD — spin toward a pole and the cage, the
 * nodes, the storm glyphs and the basemap's opacity all moved, with no gesture
 * behind it.
 *
 * Undoing MapLibre's term restores a number that means the same thing at every
 * latitude. `divePhase` and every `DIVE.z*` comparison take THIS, never
 * `map.getZoom()` raw.
 *
 * @param {object} map  a MapLibre map
 * @returns {number} zoom as it would read with the same view at the equator
 */
export function equatorZoom(map) {
  const lat = Math.min(Math.abs(map.getCenter().lat), LAT_CEILING);
  return map.getZoom() - Math.log2(Math.cos(lat * DEG));
}

/**
 * Where we are in the dive, 0 (deep space) to 1 (MapLibre owns the screen).
 *
 * Everything that crossfades — materials, the basemap's opacity, the space
 * background — is a curve on this one number, so they can never disagree about
 * how far in you are.
 *
 * @param {number} zoom  from equatorZoom(map) — NOT map.getZoom() raw, or
 *                       the whole crossfade drifts with latitude
 * @returns {number} 0..1
 */
export function divePhase(zoom) {
  return clamp01((zoom - DIVE.zSpace) / (DIVE.zHandoff - DIVE.zSpace));
}

/**
 * Point a Three camera and a globe group at whatever MapLibre is showing.
 *
 * ==> THE THREE SIGNS, AND ALL THREE HAVE BEEN WRONG. <==
 *
 * 1. `rotation.x = +latitude`. Pan north and the north pole tips toward you.
 * 2. `rotation.y = −longitude`. Drag right and the surface goes right, which is
 *    grab-and-drag and is what MapLibre does underneath.
 * 3. `camera.up = (sin b, cos b)`. The ORIGINAL `sin(−b)` rolled the overlay
 *    OPPOSITE to a two-finger twist. Found on a phone, where rotate is a
 *    primary gesture; verified against MapLibre side by side at bearing 40.
 *
 * DEFAULT EULER ORDER ('XYZ') IS LOAD-BEARING. It applies the longitude spin
 * FIRST and the latitude tilt SECOND, so the planet turns about its own pole
 * and the poles stay put on screen. Order 'YXZ' spins it about the screen's
 * vertical instead, and the whole thing reads as unmoored — that is exactly the
 * bug the prototype had.
 *
 * A BAD FRAME IS HELD, NOT JUMPED. `project()` can throw before MapLibre's
 * first paint; when it does we keep the previous distance rather than snapping
 * the globe to a fallback and back again.
 *
 * @param {object} map                a MapLibre map
 * @param {object} opts
 * @param {object} [opts.group]       Three group holding the planet — rotated
 * @param {object} opts.camera        Three PerspectiveCamera — moved
 * @param {number} [opts.lastDist]    previous distance, held on a bad frame
 * @returns {number} the distance used this frame; feed it back in as lastDist
 */
export function followMap(map, { group, camera, lastDist = DIVE.spaceDistance }) {
  const c = map.getCenter();
  if (group) group.rotation.set(c.lat * DEG, -c.lng * DEG, 0);

  let dist = lastDist;
  /* No map.loaded() gate: project() works off the style transform, which exists
   * from the first frame — and gating on loaded() meant slow (or failed) TILES
   * held the overlay at the desktop-tuned fallback distance, oversizing the
   * globe on a phone whose floor zoom sits below zSpace. */
  try {
    const d = matchDistance(measureRadiusPx(map, c.lng, c.lat));
    if (isFinite(d) && d > R) dist = d;
  } catch {
    /* hold last */
  }

  const b = map.getBearing() * DEG;
  camera.up.set(Math.sin(b), Math.cos(b), 0);
  camera.position.set(0, 0, dist);
  camera.lookAt(0, 0, 0);

  return dist;
}
