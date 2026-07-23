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
  /* How far past the limb a point at this altitude can still be seen. */
  const horizonGain = Math.acos(1 / (1 + Math.max(0, altRadii)));
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
