/**
 * geo.js — pure geometry helpers shared across the map layer.
 *
 * These are the small conversions that would otherwise be copy-pasted between
 * globe3d.js and heightfield.js — extracted here the first time a second file
 * needed them (SPEC §12: any pattern used twice gets extracted).
 *
 * `THREE` is a global from the CDN script (the same pattern as `maplibregl`
 * in globe.js), not an ES import — so these run in the browser, where THREE is
 * present. Imports nothing. Ever.
 */

/** Degrees → radians. The one place this magic number lives. */
export const DEG = Math.PI / 180;

/** Longitude/latitude → a point on a sphere of radius `r`, in the 3D globe's
 *  own axis convention: +Y is the north pole, the prime meridian faces +Z.
 *  This is the exact convention the clear globe and its cage are built in, so
 *  storm positions and land vertices land in the same frame. */
export function lonLatToVec3(lon, lat, r = 1) {
  const la = lat * DEG;
  const lo = lon * DEG;
  return new THREE.Vector3(
    r * Math.cos(la) * Math.sin(lo),
    r * Math.sin(la),
    r * Math.cos(la) * Math.cos(lo)
  );
}

/** Inverse of lonLatToVec3 for a unit vector already in globe space. */
export function vec3ToLonLat(v) {
  const lat = Math.asin(Math.max(-1, Math.min(1, v.y))) / DEG;
  const lon = Math.atan2(v.x, v.z) / DEG;
  return [lon, lat];
}

/** Great-circle destination point: start at (lon,lat), travel `dd` degrees of
 *  arc along bearing `brng`. Pure lon/lat trig, no globe state — the dive uses
 *  it to measure MapLibre's on-screen globe radius by projecting a known arc. */
export function destPoint(lon, lat, brng, dd) {
  const p1 = lat * DEG;
  const l1 = lon * DEG;
  const dl = dd * DEG;
  const th = brng * DEG;
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(dl) + Math.cos(p1) * Math.sin(dl) * Math.cos(th)
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(th) * Math.sin(dl) * Math.cos(p1),
      Math.cos(dl) - Math.sin(p1) * Math.sin(p2)
    );
  return [l2 / DEG, p2 / DEG];
}

/** Clamp to [0,1]. Used by every fade and progress curve. */
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Smoothstep from `a`→`b`, clamped. The one easing shape the dive's fades use. */
export function smoothstep(p, a, b) {
  const t = clamp01((p - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/* ---------------------------------------------------------------------------
 * GREAT-CIRCLE DISTANCE
 *
 * MOVED HERE FROM data/home.js (2026-07-26) when model tracks became its
 * second reader. It is pure spherical geometry and never belonged in a module
 * about the user's saved location; `data/home.js` re-exports it so no existing
 * caller changed.
 *
 * Earth's mean radius in NM. The Earth is an oblate spheroid and a sphere is
 * wrong by up to ~0.5%; on a 72-hour forecast track whose error is measured in
 * hundreds of miles, that is noise. Vincenty would be false precision.
 * ------------------------------------------------------------------------- */

const EARTH_RADIUS_NM = 3440.065;
const DEG_TO_RAD = Math.PI / 180;

export function greatCircleNm(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_NM * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}
