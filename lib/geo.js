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

/* EXPORTED because `lib/flood.js`'s box-to-box lower bound is the same
 * haversine with the gaps substituted in, and a second copy of this number
 * would be a bound computed on a different sphere from the distance it is
 * supposed to bound — which is exactly the way a reject test starts dropping
 * things it should not. §56.18. */
export const EARTH_RADIUS_NM = 3440.065;

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

/**
 * How far a point lies AHEAD of an origin along a stated heading, in nautical
 * miles. Negative means behind.
 *
 * ==> THIS IS ONE NUMBER AND IT LIVES HERE BECAUSE TWO FILES ASK FOR IT. <==
 * §7.14. `lib/forecast-now.js` uses it to decide which forecast hours the storm
 * has already driven past, and `lib/windswath.js` asks the identical question
 * about the identical hours when it builds the swath timeline. Two copies of
 * this is how the track line drops a forecast hour and the wind swath keeps it,
 * which draws a corridor that folds back around a track that does not.
 *
 * A SCALAR PROJECTION ON A LOCAL TANGENT PLANE, which is the right frame and
 * not a shortcut: the separations this is asked about are tens to a couple of
 * hundred nautical miles, where the sphere is flat to well under the ~6 nm
 * grid NHC rounds its positions to. Curvature would be false precision on
 * numbers that arrive rounded to a tenth of a degree.
 *
 * NOT A DISTANCE, AND THE SIGN IS THE WHOLE POINT. `greatCircleNm` above
 * answers "how far apart" and can never answer "which side" — a forecast hour
 * 43 nm behind the storm and one 43 nm ahead of it are the same number to it,
 * and only one of them is still a forecast.
 *
 * SEAM-SAFE. The longitude difference is wrapped into (−180, 180] before it is
 * scaled, so a storm at 179.8°E measured against a point at 179.9°W is 0.3°
 * apart and not 359.7°.
 *
 * @param {number} lon0  origin longitude — the storm's current position
 * @param {number} lat0  origin latitude
 * @param {number} lon   the point being tested
 * @param {number} lat
 * @param {number} headingDeg  direction of travel, compass degrees from north
 * @returns {number|null} nautical miles along the heading, or null if any
 *          input is unreadable. Null is NOT zero: a caller that cannot get an
 *          answer must not act as though the answer was "exactly abeam".
 */
export function alongTrackNm(lon0, lat0, lon, lat, headingDeg) {
  const n = (v) => (Number.isFinite(v) ? Number(v) : null);
  const a = n(lon0); const b = n(lat0); const c = n(lon); const d = n(lat);
  const h = n(headingDeg);
  if (a == null || b == null || c == null || d == null || h == null) return null;

  let dl = (c - a) % 360;
  if (dl > 180) dl -= 360;
  if (dl < -180) dl += 360;

  /* Nautical miles east and north. 1° of latitude is 60 nm everywhere; 1° of
   * longitude shrinks with the cosine, taken at the ORIGIN's latitude because
   * that is where the storm is and the answer is about the storm. */
  const east = dl * 60 * Math.cos(b * DEG);
  const north = (d - b) * 60;

  /* Compass degrees run clockwise from north, so the unit vector along the
   * heading is (sin, cos) and not the (cos, sin) of ordinary maths. Getting
   * this backwards mirrors every answer about the north-east diagonal, which
   * is exactly where recurving storms live. */
  return east * Math.sin(h * DEG) + north * Math.cos(h * DEG);
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
