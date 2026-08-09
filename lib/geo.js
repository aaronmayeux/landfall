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

/* ---------------------------------------------------------------------------
 * DISTANCE ON THE SPHERE
 *
 * MOVED HERE FROM data/home.js on 2026-07-28, when the JTWC wind join became
 * the second caller (§12: any pattern used twice gets extracted before the
 * second use). `data/home.js` re-exports both so its own call sites and their
 * comments are untouched.
 *
 * Haversine, on a spherical earth. The original note is worth keeping: the
 * flattening error is a fraction of a percent, and against distances measured
 * in hundreds of miles that is noise. Vincenty would be false precision.
 * ------------------------------------------------------------------------- */

const EARTH_RADIUS_NM = 3440.065;

/** Great-circle distance between two lon/lat points, in nautical miles. */
export function greatCircleNm(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_NM * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from point 1 to point 2, in degrees clockwise from north.
 *  The off-screen pointer needs this to know which way to point, and the
 *  detail panel uses it for "220 mi to your SW". */
export function bearingDeg(lon1, lat1, lon2, lat2) {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dl = (lon2 - lon1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/* ---------------------------------------------------------------------------
 * WALKING A TRACK
 *
 * EXTRACTED FROM closestApproach() 2026-08-09, when the home dashboard's
 * near-ring window became the second caller (§12: any pattern used twice gets
 * extracted before the second use). Two copies of a track walker is how the
 * closest-approach time and the "comes inside 100 miles" time drift apart by
 * a rounding step and then disagree on screen, which reads as a bug in both.
 *
 * BEHAVIOUR IS UNCHANGED FROM THE ORIGINAL, deliberately and verifiably:
 * SUBDIVISIONS defaults to the 8 it has always been, and the pinned Bertha
 * figures in tools/test-home.mjs were measured BEFORE this extraction.
 * ------------------------------------------------------------------------- */

/** The subdivision count closestApproach() has always used. On a 12-hour
 *  forecast leg that is a sample every ~90 minutes — finer than the forecast's
 *  own resolution, which is the point at which more samples stop buying
 *  anything real. */
export const TRACK_SUBDIVISIONS = 8;

/**
 * Fill in the gaps between consecutive track points, so the minimum of a leg
 * is findable when it falls BETWEEN two published forecast hours — which it
 * usually does, because a storm passing offshore is nearest halfway through a
 * 12-hour leg.
 *
 * Yields every input point followed by `subdivisions - 1` interpolated ones,
 * then the final input point. Each carries `{lon, lat, time, windKt, t}` where
 * `t` is the fraction along the WHOLE array (0..points.length-1) — a caller
 * that needs to know which leg a sample came from can floor it.
 *
 * LINEAR IN LON/LAT, NOT ALONG THE GREAT CIRCLE, and that is the right call
 * rather than a shortcut: over a 12-hour storm leg, a few degrees at most, the
 * difference is far below NHC's own track error. Measured 2026-07-24 against a
 * 4,000-step true great-circle search: 0.2 nm and under one minute.
 *
 * THE DATELINE IS HANDLED, and it has to be — a west Pacific storm crossing
 * 180° would otherwise interpolate the long way round the planet and report a
 * closest approach somewhere over Africa. The shorter way is always taken.
 *
 * `time` and `windKt` interpolate only when BOTH ends have them; otherwise the
 * sample carries null rather than a value invented from one end.
 */
export function densifyTrack(points, subdivisions = TRACK_SUBDIVISIONS) {
  const out = [];
  if (!Array.isArray(points) || points.length === 0) return out;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    out.push({ ...p, t: i, interpolated: false });

    const next = points[i + 1];
    if (!next) break;

    const tPrev = p.time != null ? Date.parse(p.time) : NaN;
    const tNext = next.time != null ? Date.parse(next.time) : NaN;

    for (let s = 1; s < subdivisions; s++) {
      const f = s / subdivisions;

      let dLon = next.lon - p.lon;
      if (dLon > 180) dLon -= 360;
      if (dLon < -180) dLon += 360;

      out.push({
        lon: p.lon + dLon * f,
        lat: p.lat + (next.lat - p.lat) * f,
        time:
          Number.isFinite(tPrev) && Number.isFinite(tNext)
            ? new Date(tPrev + (tNext - tPrev) * f).toISOString()
            : null,
        windKt:
          Number.isFinite(p.windKt) && Number.isFinite(next.windKt)
            ? p.windKt + (next.windKt - p.windKt) * f
            : null,
        t: i + f,
        interpolated: true,
      });
    }
  }
  return out;
}

/** Clamp to [0,1]. Used by every fade and progress curve. */
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Smoothstep from `a`→`b`, clamped. The one easing shape the dive's fades use. */
export function smoothstep(p, a, b) {
  const t = clamp01((p - a) / (b - a));
  return t * t * (3 - 2 * t);
}
