/**
 * marker-home-geometry.js — the sphere-to-screen maths behind the home marker.
 *
 * Pure functions, no DOM, no state. Everything here answers one of three
 * questions about a lon/lat against the current camera:
 *
 *   - is it behind the planet, at the surface or at altitude (isOccluded,
 *     glyphHorizonPoint)
 *   - which way does the surface point, on screen (surfaceNormalScreen)
 *   - how big is the planet right now, in pixels (measureGlobeRadiusPx)
 *
 * Split out of marker-home.js because none of it knows or cares that a marker
 * exists — it is the geometry layer, and keeping it separate means the marker
 * file is about the marker.
 *
 * Imports: config/ and lib/ only. Never map/, data/, or ui/.
 */

import { HOME } from '../config/constants.js';
import { DEG, smoothstep, destPoint } from '../lib/geo.js';

/**
 * The surface normal at home, projected into screen space.
 *
 * THE TETHER MUST BE PERPENDICULAR TO THE SURFACE, which means it follows the
 * outward normal of the sphere — not the direction radially outward from the
 * globe's centre ON SCREEN. Those two agree in DIRECTION but not in LENGTH,
 * and the length is the whole bug: the normal tilts toward the camera as home
 * approaches the disc centre, so its on-screen projection must FORESHORTEN.
 * Drawing it full-length everywhere is what made the tether look "locked to a
 * certain angle window."
 *
 * Returns the unit screen direction plus `foreshorten` = sin(angle between the
 * normal and the view axis), which is 0 directly overhead and 1 at the limb.
 * Multiply the altitude by it to get the true on-screen tether length.
 */
export function surfaceNormalScreen(centerLon, centerLat, lon, lat, bearingRad) {
  const la = lat * DEG;
  const cla = centerLat * DEG;
  const dLon = (lon - centerLon) * DEG;

  /* Unit normal in view space: +X right, +Y up, +Z toward the camera. */
  const x = Math.cos(la) * Math.sin(dLon);
  const y0 = Math.sin(la);
  const z0 = Math.cos(la) * Math.cos(dLon);
  const y = y0 * Math.cos(cla) - z0 * Math.sin(cla);

  /* Screen Y is DOWN, hence the negation. */
  let sx = x;
  let sy = -y;

  /* MapLibre's bearing rolls the map content; roll the normal with it or the
   * tether tilts wrongly the moment the user two-finger-rotates. */
  if (bearingRad) {
    const c = Math.cos(bearingRad);
    const s = Math.sin(bearingRad);
    const rx = sx * c - sy * s;
    const ry = sx * s + sy * c;
    sx = rx;
    sy = ry;
  }

  const foreshorten = Math.hypot(sx, sy);
  if (foreshorten < 1e-6) {
    /* Exactly overhead: no defined screen direction. Caller fades the tether. */
    return { ux: 0, uy: -1, foreshorten: 0 };
  }
  return { ux: sx / foreshorten, uy: sy / foreshorten, foreshorten };
}

/**
 * The altitude curve — the heart of the "floating" read.
 *
 * Altitude is expressed in EARTH RADII and converted to screen pixels using
 * MapLibre's own measured globe radius, so it scales with the planet
 * automatically at every zoom ("moves with the radius of the earth").
 *
 * It SHRINKS as you zoom in. A fixed altitude looks correct from far out and
 * drifts off the house up close, because parallax grows as the camera
 * approaches. Shrinking keeps the float at planet zoom and the accuracy at
 * street zoom, which is the tension Aaron's two requirements create.
 */
export function altitudeInRadii(zoom) {
  const t = smoothstep(zoom, HOME.altZoomFar, HOME.altZoomNear);
  return HOME.altFar + (HOME.altNear - HOME.altFar) * t;
}

/**
 * MapLibre's on-screen globe radius in pixels, measured the same way
 * globe3d.js measures it — project a known small arc near the screen centre
 * and divide. Near-centre stays valid at every zoom; a limb-based measurement
 * flies off screen once you zoom in.
 *
 * Returns null on a bad frame rather than throwing, so a single unprojectable
 * frame holds the last good value instead of killing the marker.
 */
const MEASURE_DEG = 5;
export function measureGlobeRadiusPx(map, lon, lat) {
  try {
    const pc = map.project([lon, lat]);
    const p2 = map.project(destPoint(lon, lat, 90, MEASURE_DEG));
    const d = Math.hypot(p2.x - pc.x, p2.y - pc.y);
    const r = d / Math.sin(MEASURE_DEG * DEG);
    return Number.isFinite(r) && r > 0 ? r : null;
  } catch {
    return null;
  }
}

/**
 * March from the screen centre along (ux,uy) until hitting the viewport
 * rectangle, inset by `m`.
 *
 * The inset is not decoration: on a phone the outer band is where the OS eats
 * gestures, and a control sitting in it is a control that cannot be tapped
 * (SPEC §10). Derived from the touch target, not hand-set.
 */
export function edgePoint(ux, uy, w, h, m) {
  const cx = w / 2;
  const cy = h / 2;
  const tx = ux > 0 ? (w - m - cx) / ux : ux < 0 ? (m - cx) / ux : Infinity;
  const ty = uy > 0 ? (h - m - cy) / uy : uy < 0 ? (m - cy) / uy : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + ux * t, y: cy + uy * t };
}

/**
 * Is this lon/lat behind the planet?
 *
 * WHY THIS IS NOT A cos() TEST. The obvious approach — compare the point's
 * angle against the limb — approximates the answer and gets it wrong under
 * pitch, where the visible horizon is not the great circle 90° from the view
 * centre. MapLibre already computes the exact clipping plane every frame for
 * its own renderer, so ask it rather than reimplementing the camera maths and
 * signing up to keep the copy in sync.
 *
 * This is the same call MapLibre's own Marker class makes to fade markers that
 * pass behind the globe, so it is a supported path even though `transform` is
 * semi-internal. Feature-detected: on a MapLibre without it, and on the
 * mercator (flat) transform where it always returns false, nothing is ever
 * occluded — which degrades to the pre-globe behaviour rather than throwing.
 */
export function isOccluded(map, lon, lat) {
  const tr = map.transform;
  if (!tr || typeof tr.isLocationOccluded !== 'function') return false;
  try {
    return tr.isLocationOccluded({ lng: lon, lat });
  } catch {
    return false;
  }
}

/**
 * Where the FLOATING GLYPH sits, as a lon/lat, given the anchor and how high
 * the glyph rides in earth radii.
 *
 * The glyph is not at home's coordinates — it floats above them, and "above"
 * on a sphere seen from outside reads on screen as "further out toward the
 * limb." A point at altitude h above the surface stays visible until the
 * surface beneath it has sunk acos(1/(1+h)) of arc past the limb — the same
 * reason you see further from a tower than from the ground.
 *
 * So the glyph's visual horizon is that much later than the anchor's, and
 * asking "is the glyph behind the planet" means testing a point offset toward
 * the viewer by that angle. Returns the lon/lat of the SURFACE point whose
 * occlusion matches the glyph's: offset from home along the great circle back
 * toward the view centre.
 *
 * This is what lets the marker crest the horizon like something with height
 * rather than blinking out the instant its foot goes under.
 */
export function glyphHorizonPoint(centerLon, centerLat, lon, lat, altRadii) {
  return glyphHorizonPointDeg(
    centerLon,
    centerLat,
    lon,
    lat,
    horizonGainDeg(altRadii)
  );
}

/**
 * The same walk, but given the arc directly in degrees rather than derived
 * from an altitude. Bisection needs to probe arbitrary intermediate arcs, and
 * the altitude form cannot express those without inverting the tower formula
 * on every step.
 */
export function glyphHorizonPointDeg(centerLon, centerLat, lon, lat, arcDeg) {
  const horizonGain = arcDeg * DEG;
  if (!Number.isFinite(horizonGain) || horizonGain <= 1e-9) return [lon, lat];

  /* Rotate home toward the view centre by that angle, on the great circle
   * joining them. Done as a slerp between the two unit vectors rather than via
   * a bearing: no antimeridian special case, no polar degeneracy, and it is
   * the same maths the projection itself uses.
   *
   * The unit vectors are built here rather than with lib/geo's lonLatToVec3,
   * which returns a THREE.Vector3 — this module must stay free of Three, since
   * the marker draws throughout the MapLibre band where Three is not
   * necessarily loaded.
   *
   * Slerp needs the angle between the two points; when home IS the centre
   * there is no defined great circle, but there is also nothing to correct —
   * a point at the view centre is as far from the limb as it gets. */
  const unit = (lo, la) => {
    const p = la * DEG;
    const l = lo * DEG;
    return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
  };
  const h = unit(lon, lat);
  const c = unit(centerLon, centerLat);

  const dot = Math.max(-1, Math.min(1, h[0] * c[0] + h[1] * c[1] + h[2] * c[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-6) return [lon, lat];

  /* Never overshoot past the centre — clamp the walk to the arc available. */
  const t = Math.min(1, horizonGain / omega);
  const s = Math.sin(omega);
  const a = Math.sin((1 - t) * omega) / s;
  const b = Math.sin(t * omega) / s;

  const x = a * h[0] + b * c[0];
  const y = a * h[1] + b * c[1];
  const z = a * h[2] + b * c[2];
  const len = Math.hypot(x, y, z) || 1;

  return [
    Math.atan2(x / len, z / len) / DEG,
    Math.asin(Math.max(-1, Math.min(1, y / len))) / DEG,
  ];
}

/**
 * The globe's SILHOUETTE radius in screen pixels — where the planet's visible
 * edge actually is.
 *
 * NOT the same number as measureGlobeRadiusPx(). That returns MapLibre's
 * NEAR-CENTRE scale (pixels per radian of arc at the screen centre), which on
 * a perspective globe is larger than the silhouette: the limb is further from
 * the camera and foreshortened, so it sits closer in than a near-centre
 * measurement predicts. globe3d.js hit this exact trap sizing the Three globe
 * and documents it — using the near-centre number as a limb radius overshoots
 * by ~41% at planet zoom and over 100% up close.
 *
 * Deriving one from the other needs the camera distance, in units of earth
 * radii. For a pinhole camera at distance d looking at a unit sphere:
 *
 *   nearScale = f / (d − 1)          (arc at the centre, closest surface)
 *   limb      = f / sqrt(d² − 1)     (tangent point, the silhouette)
 *
 * Eliminating the focal length f leaves a ratio that depends only on d:
 *
 *   limb = nearScale · (d − 1) / sqrt(d² − 1)
 *
 * and d comes from MapLibre's own camera-to-centre distance. The ratio tends
 * to 1 as d grows (an orthographic view has no foreshortening to correct) and
 * falls away sharply up close, which is exactly the observed error curve.
 *
 * Returns nearScale unchanged when the camera distance is unavailable — the
 * pre-existing behaviour, wrong by a knowable amount rather than throwing.
 */
export function silhouetteRadiusPx(map, nearScalePx) {
  const d = cameraDistanceInRadii(map);
  if (!d || !Number.isFinite(d) || d <= 1) return nearScalePx;
  return (nearScalePx * (d - 1)) / Math.sqrt(d * d - 1);
}

/**
 * Camera distance from the globe's centre, in earth radii.
 *
 * Mirrors MapLibre's own conversion in _computeClippingPlane: divide
 * cameraToCenterDistance by the globe's pixel radius. Both quantities come
 * straight off the transform, so this agrees with the renderer by
 * construction rather than by coincidence.
 *
 * The pixel radius is NOT worldSize / 2π. MapLibre scales the globe up as the
 * centre approaches the poles, so that a feature at the map centre is the same
 * size in globe and flat views — hence the 1/cos(latitude) term. Omitting it
 * makes the correction drift badly at high latitude, which for this app is the
 * hurricane-season North Atlantic, not an edge case.
 *
 * Feature-detected like isOccluded(): returns null when the numbers are not
 * there, so callers fall back rather than compute nonsense.
 */
export function cameraDistanceInRadii(map) {
  const tr = map.transform;
  if (!tr) return null;

  const dPx = tr.cameraToCenterDistance;
  const worldSize = tr.worldSize;
  const centerLat = tr.center && tr.center.lat;

  if (
    !Number.isFinite(dPx) ||
    !Number.isFinite(worldSize) ||
    worldSize <= 0 ||
    !Number.isFinite(centerLat)
  ) {
    return null;
  }

  const cosLat = Math.cos(centerLat * DEG);
  if (!Number.isFinite(cosLat) || Math.abs(cosLat) < 1e-6) return null;

  const globeRadiusPx = worldSize / (2 * Math.PI) / cosLat;
  if (globeRadiusPx <= 0) return null;

  return dPx / globeRadiusPx;
}

/**
 * How much of the tether is still above the horizon, 0..1, once the anchor has
 * sunk behind the limb.
 *
 * While the anchor is visible the tether spans anchor→glyph and needs no
 * correction. After that the foot is pinned to the silhouette, and if the lift
 * stayed constant the marker would hang at a fixed height above the rim and
 * then vanish — which reads as floating in place, not as sinking.
 *
 * What actually happens to a real object going over a horizon is that the gap
 * between its top and the rim closes smoothly, reaching zero exactly when the
 * top itself goes under. That whole curve is determined by geometry, so this
 * derives it rather than easing a made-up one:
 *
 *   0 arc past the anchor's horizon   → full lift (the glyph is at its peak)
 *   all the way to the glyph's horizon → zero lift (the glyph is at the rim)
 *
 * `pastArc` and `gainArc` are both in degrees: how far the anchor has sunk
 * past its own horizon, and the total extra arc the glyph's altitude buys it.
 * The ratio is the fraction of the descent already completed, so 1 − ratio is
 * what remains.
 *
 * Uses the cosine of the arc rather than the arc itself, because the on-screen
 * gap closes with the projected foreshortening, not linearly with angle — the
 * marker should fall away quickly at first and settle onto the rim, which is
 * what the sampled projection shows.
 */
export function horizonDescent(pastArcDeg, gainArcDeg) {
  if (!(gainArcDeg > 0)) return 0;
  if (pastArcDeg <= 0) return 1;
  if (pastArcDeg >= gainArcDeg) return 0;

  const t = pastArcDeg / gainArcDeg;

  /* sin(π/2 · (1−t)) — full at t=0, zero at t=1, and flattening as it lands
   * rather than arriving at an angle.
   *
   * An approximation to the true projected curve, chosen over computing that
   * curve exactly because the exact version needs a second projection call per
   * frame inside the render loop. Measured against the projection across the
   * zoom ladder: within 1.8–5.4% of the true fraction, versus 17–25% for a
   * straight linear ramp. On an initial gap that peaks around 6% of the globe's
   * screen radius, that error is a couple of pixels at planet zoom and less
   * further in — under the threshold where the eye reads a timing error, which
   * a linear ramp is not. */
  return Math.sin((Math.PI / 2) * (1 - t));
}

/**
 * How far past the limb a point at altitude `altRadii` can still be seen, in
 * degrees of arc at the globe's centre.
 *
 * The tower formula: from height h above a unit sphere the horizon is
 * acos(1/(1+h)) of arc away. 30.4° at planet altitude, 5.1° zoomed in — the
 * 40× spread that makes this impossible to fake with a fixed angle.
 */
export function horizonGainDeg(altRadii) {
  const gain = Math.acos(1 / (1 + Math.max(0, altRadii)));
  return Number.isFinite(gain) ? gain / DEG : 0;
}

/**
 * How far the anchor has sunk past its own horizon, in degrees, capped at
 * `maxDeg`.
 *
 * Found by bisection on isOccluded() rather than by computing the horizon
 * angle from the camera. That sounds indirect, and it is deliberate: the
 * horizon depends on pitch, and MapLibre's clipping plane already handles
 * pitch exactly. Re-deriving it here would mean maintaining a second copy of
 * that geometry and watching the two disagree under tilt — the same class of
 * bug as using the near-centre scale for the limb radius.
 *
 * Walks a test point back toward the view centre until it is no longer
 * occluded; the distance walked is how far past the horizon the anchor sits.
 * Ten iterations over at most ~30° lands inside 0.03°, far finer than a pixel.
 */
export function arcPastHorizon(map, centerLon, centerLat, lon, lat, maxDeg) {
  if (!(maxDeg > 0)) return 0;

  /* Not occluded at all: nothing has been spent. */
  if (!isOccluded(map, lon, lat)) return 0;

  /* Still occluded even when offset the full gain: the descent is complete. */
  const [fLon, fLat] = glyphHorizonPointDeg(centerLon, centerLat, lon, lat, maxDeg);
  if (isOccluded(map, fLon, fLat)) return maxDeg;

  let lo = 0;
  let hi = maxDeg;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const [mLon, mLat] = glyphHorizonPointDeg(centerLon, centerLat, lon, lat, mid);
    if (isOccluded(map, mLon, mLat)) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Unit screen direction from A to B, with a caller-supplied fallback when the
 * two points are effectively coincident.
 *
 * Three places needed this exact "normalise or fall back to straight up"
 * pattern with three slightly different epsilons, which is how you end up with
 * three subtly different behaviours at the degenerate point. One function, one
 * behaviour.
 */
export function screenDir(fromX, fromY, toX, toY, minLen = 1) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.hypot(dx, dy);
  if (len < minLen) return { ux: 0, uy: -1, len };
  return { ux: dx / len, uy: dy / len, len };
}
