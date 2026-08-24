/**
 * near-home.js — how close a storm actually came to a place.
 * SPEC-SEASONS-BUILD.md §57.19, §57.35 fault 2.
 *
 * ==> MEASURED AGAINST THE LINE, NOT THE POINTS, AND THAT IS THE WHOLE FILE.
 * <== HURDAT2 records a position every six hours. A storm moving 20 mph covers
 * 120 miles in that gap, so a fast mover can pass clean over a 100-mile circle
 * without one recorded position landing inside it. A points-only answer says
 * "no storm has ever come near you" and looks exactly like a working feature.
 * Hurricane Hugo, AL111989, is the fixture that proves it: `tools/test-near-home.mjs`
 * runs the same track both ways and the two answers differ by hundreds of miles.
 *
 * ==> IT IS COMPUTED ONCE, AT INDEX TIME, AND THE SLIDER NEVER SEES GEOMETRY.
 * <== 175 years is roughly 3,300 storms and 87,000 segments. Re-measuring that
 * on every pixel of a slider drag would freeze the app. `indexNearHome` runs
 * one pass in the download Worker and stores a single number per storm; the
 * slider then filters a few thousand numbers, which is instant and stays
 * instant however far back the archive goes.
 *
 * ==> THE ARITHMETIC IS 3D VECTORS, WHICH IS WHY THE DATELINE CANNOT REACH IT.
 * <== A storm crossing the antimeridian has neighbouring longitudes 359°
 * apart on paper. Anything reasoning in degrees has to know about that; a unit
 * vector on a sphere does not — 179.9E and 179.2W are simply two points close
 * together, and the cross-track formula gives the right answer with no seam
 * case at all. `lon` (the published value) is what this file reads, never
 * `lonU`, because the unwrapped form exists for DRAWING and running it through
 * a trig function past ±180 would be asking for the wrong thing twice.
 *
 * The vectors are built here rather than taken from `lib/geo.js`, whose
 * `lonLatToVec3` returns a `THREE.Vector3` — importing a 3D renderer into the
 * indexer would put it in the download Worker and in every plain-node test.
 *
 * Imports config/ and lib/geo.js (pure trig only). No DOM, no network, no map.
 */

import { SEASONS } from '../config/constants.js';
import { DEG, EARTH_RADIUS_NM, greatCircleNm } from './geo.js';

/** Nautical miles in one statute mile. The slider speaks miles because a
 *  reader does; everything measured speaks nautical miles because the rest of
 *  this app does. One conversion, in one place. */
export const NM_PER_MI = 0.868976;

export const miToNm = (mi) => mi * NM_PER_MI;
export const nmToMi = (nm) => nm / NM_PER_MI;

/* ---------------------------------------------------------------------------
 * SPHERE ARITHMETIC — plain arrays, no renderer
 * ------------------------------------------------------------------------- */

/** [lon, lat] in degrees → a unit vector. Any consistent axis convention works
 *  here; only angles between vectors are ever read out. */
function unitVec(lon, lat) {
  const la = lat * DEG;
  const lo = lon * DEG;
  const c = Math.cos(la);
  return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function norm(v) {
  const m = Math.hypot(v[0], v[1], v[2]);
  return m === 0 ? null : [v[0] / m, v[1] / m, v[2] / m];
}

/** Angle between two unit vectors, radians. `atan2` of the cross and dot
 *  magnitudes rather than `acos`, which loses all its precision for the small
 *  angles this file spends most of its time in. */
function angle(a, b) {
  const c = cross(a, b);
  return Math.atan2(Math.hypot(c[0], c[1], c[2]), dot(a, b));
}

/**
 * Shortest distance from a point to the great-circle SEGMENT a→b, in nautical
 * miles, plus where on the segment the closest approach happened.
 *
 * The point is projected onto the plane of the great circle through a and b.
 * If that projection falls between them, the cross-track distance is the
 * answer and the foot of the perpendicular is the place. If it falls outside —
 * the storm was heading away before it got level with the house — the answer
 * is whichever endpoint is nearer, because the segment stops there.
 *
 * @returns {{nm:number, lon:number, lat:number, t:number}} `t` is 0 at a, 1 at
 *   b, and tells the caller whether the closest approach was at a record or
 *   between two of them.
 */
export function pointToSegmentNm(pLon, pLat, aLon, aLat, bLon, bLat) {
  const p = unitVec(pLon, pLat);
  const a = unitVec(aLon, aLat);
  const b = unitVec(bLon, bLat);

  const n = norm(cross(a, b));
  const dA = greatCircleNm(pLon, pLat, aLon, aLat);
  const dB = greatCircleNm(pLon, pLat, bLon, bLat);

  /* a and b coincident (or antipodal): there is no segment, only a point. The
   * files do repeat a position across a stationary storm, so this is real. */
  if (!n) {
    return dA <= dB
      ? { nm: dA, lon: aLon, lat: aLat, t: 0 }
      : { nm: dB, lon: bLon, lat: bLat, t: 1 };
  }

  /* The foot of the perpendicular: p with its out-of-plane component removed. */
  const foot = norm([
    p[0] - dot(p, n) * n[0],
    p[1] - dot(p, n) * n[1],
    p[2] - dot(p, n) * n[2],
  ]);
  if (!foot) {
    return dA <= dB
      ? { nm: dA, lon: aLon, lat: aLat, t: 0 }
      : { nm: dB, lon: bLon, lat: bLat, t: 1 };
  }

  const ab = angle(a, b);
  const aF = angle(a, foot);
  const fB = angle(foot, b);

  /* Between a and b iff walking a → foot → b is no longer than walking a → b.
   * The tolerance absorbs floating point only; it is far tighter than any real
   * six-hour storm step. */
  const inside = aF + fB <= ab + 1e-9;

  if (!inside) {
    return dA <= dB
      ? { nm: dA, lon: aLon, lat: aLat, t: 0 }
      : { nm: dB, lon: bLon, lat: bLat, t: 1 };
  }

  const crossTrack = Math.abs(Math.asin(Math.max(-1, Math.min(1, dot(p, n)))));
  const lat = Math.asin(Math.max(-1, Math.min(1, foot[2]))) / DEG;
  const lon = Math.atan2(foot[1], foot[0]) / DEG;

  return {
    nm: crossTrack * EARTH_RADIUS_NM,
    lon,
    lat,
    t: ab === 0 ? 0 : aF / ab,
  };
}

/* ---------------------------------------------------------------------------
 * ONE STORM
 * ------------------------------------------------------------------------- */

/**
 * The closest this storm ever came to `home`, and what it was doing then.
 *
 * @param {object} storm     a normalised storm from `lib/hurdat.js`
 * @param {{lon:number, lat:number}} home
 * @param {object} [opts]
 * @param {boolean} [opts.measureSegments]  false measures RECORDS ONLY, which
 *   is the wrong answer. It exists so the test suite can demonstrate that, and
 *   `SEASONS.nearHomeMeasureSegments` is the app's setting — never false.
 * @returns {{nm, mi, time, windKt, status, lon, lat, betweenRecords}|null}
 */
export function closestApproach(storm, home, { measureSegments = SEASONS.nearHomeMeasureSegments } = {}) {
  const pts = storm?.points;
  if (!pts?.length || !Number.isFinite(home?.lon) || !Number.isFinite(home?.lat)) return null;

  let best = null;

  /* Every record, as a floor. Even in segment mode this runs, because a
   * segment's endpoints are records and the answer must never be worse than
   * the naive one. */
  for (const p of pts) {
    const nm = greatCircleNm(home.lon, home.lat, p.lon, p.lat);
    if (!best || nm < best.nm) {
      best = { nm, point: p, lon: p.lon, lat: p.lat, betweenRecords: false };
    }
  }

  if (measureSegments) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];

      /* Latitude-only reject, and it is EXACT rather than approximate: a degree
       * of latitude is 60 nm everywhere, no longitude, no seam, no frames. A
       * segment whose whole latitude band sits further from home than the best
       * answer so far cannot beat it. */
      const loLat = Math.min(a.lat, b.lat);
      const hiLat = Math.max(a.lat, b.lat);
      const latGap = home.lat > hiLat ? home.lat - hiLat
        : home.lat < loLat ? loLat - home.lat : 0;
      if (latGap * SEASONS.nmPerDegreeLat >= best.nm) continue;

      const hit = pointToSegmentNm(home.lon, home.lat, a.lon, a.lat, b.lon, b.lat);
      if (hit.nm < best.nm) {
        /* ==> THE WIND IS TAKEN FROM A RECORD, NEVER INTERPOLATED. <== The
         * PLACE between two records is geometry and is defensible. A wind speed
         * halfway between two published ones is a number NOAA never wrote, and
         * §57.22's honesty line cannot cover an invented figure. So the nearer
         * bracketing record supplies the strength, and `betweenRecords` says
         * the position did not come from it. */
        const nearer = hit.t < 0.5 ? a : b;
        best = {
          nm: hit.nm,
          point: nearer,
          lon: hit.lon,
          lat: hit.lat,
          betweenRecords: hit.t > 0 && hit.t < 1,
        };
      }
    }
  }

  if (!best) return null;
  return {
    nm: best.nm,
    mi: nmToMi(best.nm),
    time: best.point.time,
    windKt: best.point.windKt,
    status: best.point.status,
    lon: best.lon,
    lat: best.lat,
    betweenRecords: best.betweenRecords,
  };
}

/* ---------------------------------------------------------------------------
 * THE INDEX
 * ------------------------------------------------------------------------- */

/**
 * One pass over every storm, producing the small array the slider filters.
 *
 * ==> HOME MOVING INVALIDATES ALL OF IT. <== The whole index is a function of
 * one coordinate pair, so it is recomputed rather than patched when the house
 * moves. That is cheap by design: nothing here reads geometry twice.
 */
export function indexNearHome(storms, home) {
  const out = [];
  for (const s of storms || []) {
    const near = closestApproach(s, home);
    if (!near) continue;
    out.push({
      id: s.id,
      name: s.name,
      year: s.year,
      basin: s.basin,
      nm: near.nm,
      mi: near.mi,
      time: near.time,
      windKt: near.windKt,
      status: near.status,
      betweenRecords: near.betweenRecords,
    });
  }
  out.sort((a, b) => a.nm - b.nm);
  return out;
}

/** Everything in the index within `radiusMi`, nearest first. Pure filtering of
 *  precomputed numbers — this is what the slider calls, and it touches no
 *  geometry at all. */
export function within(index, radiusMi) {
  const limit = miToNm(radiusMi);
  return (index || []).filter((e) => e.nm <= limit);
}

export const __internals = { unitVec, dot, cross, norm, angle };
