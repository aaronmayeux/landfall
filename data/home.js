/**
 * home.js — the home location and everything derived from it (SPEC §8).
 *
 * Home is a REFERENCE POINT, not a feature. Four things depend on it: the
 * storm-list sort order, the scope filter, the opening sequence's resting
 * position, and the detail panel's home block.
 *
 * TWO RULES THIS FILE ENFORCES STRUCTURALLY, because both have burned projects
 * before and neither survives as a convention:
 *
 * 1. EVERY DERIVED FIGURE CARRIES ITS ADVISORY TIMESTAMP. "Closest approach in
 *    14 hours" from a six-hour-old advisory is a different sentence than the
 *    same words from a fresh one, and this is the one screen where somebody
 *    may make a real decision. So `distanceTo` and `closestApproach` return an
 *    object with `observedAt` on it. There is no way to get the number
 *    without the timestamp, because they are the same return value.
 *
 * 2. HOME IS DEVICE-LOCAL. localStorage only. No accounts, no server-side user
 *    data, ever. Someone's house coordinates are the most sensitive thing this
 *    app touches and they never leave the phone.
 *
 * Geometry-free half only (Phase 3). Wind-arrival, exposure timeline, and
 * surge-at-home need forecast wind radii and the Peak Storm Surge service and
 * land in Phase 6 (SPEC §8).
 *
 * Imports: config/ and lib/ only. No UI, no map.
 */

import { STORAGE_KEY, SCOPE, SCOPE_RADIUS_NM } from '../config/constants.js';
import { DEG } from '../lib/geo.js';
import { basinFromPosition } from '../lib/basin.js';

/* ---------------------------------------------------------------------------
 * GREAT-CIRCLE DISTANCE
 *
 * Haversine, in nautical miles. NM because that is NHC's native unit and what
 * the whole app stores — converting here would violate the convert-at-render
 * rule and put rounding drift into a threshold comparison.
 *
 * Earth's mean radius in NM. The Earth is an oblate spheroid and a sphere is
 * wrong by up to ~0.5%; on a 72-hour forecast track whose error is measured in
 * hundreds of miles, that is noise. Vincenty would be false precision.
 * ------------------------------------------------------------------------- */

const EARTH_RADIUS_NM = 3440.065;

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
 * PERSISTENCE
 *
 * localStorage can throw — Safari private mode, storage quota, a user who
 * disabled site data. None of those are worth a blank screen, so every access
 * is wrapped and failure degrades to "no home set" rather than an exception.
 * ------------------------------------------------------------------------- */

/** Shape stored on disk. `source` is kept because it changes what we can say
 *  to the user later: a geolocation fix can be re-taken silently, a manually
 *  dragged pin must never be silently overwritten — the user placed it. */
function isValidHome(h) {
  return (
    h &&
    typeof h === 'object' &&
    Number.isFinite(h.lon) &&
    Number.isFinite(h.lat) &&
    Math.abs(h.lat) <= 90 &&
    Math.abs(h.lon) <= 180
  );
}

let cached; // undefined = not yet read from disk, null = genuinely no home

export function getHome() {
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY.home);
    const parsed = raw ? JSON.parse(raw) : null;
    cached = isValidHome(parsed) ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function hasHome() {
  return getHome() !== null;
}

/** Persist. `label` is what the user sees ("Home" or the matched address);
 *  `source` is 'geolocation' | 'address' | 'pin'. */
export function setHome({ lon, lat, label, source }) {
  const home = {
    lon,
    lat,
    label: label || null,
    source: source || 'pin',
    setAt: new Date().toISOString(),
  };
  if (!isValidHome(home)) throw new Error('invalid home coordinates');

  cached = home;
  try {
    localStorage.setItem(STORAGE_KEY.home, JSON.stringify(home));
  } catch {
    /* Storage unavailable. Home still works for this session — it is in
     * `cached` — it just won't survive a reload. Silently degrading is right
     * here: the alternative is refusing to let someone set a home at all. */
  }
  notify();
  return home;
}

export function clearHome() {
  cached = null;
  try {
    localStorage.removeItem(STORAGE_KEY.home);
  } catch {
    /* nothing to do */
  }
  notify();
}

/* --- subscription ------------------------------------------------------------
 * Same pattern as data/store.js: one subscribe, fan out. Fires immediately with
 * current state so a late-mounting surface doesn't wait for a change.
 * -------------------------------------------------------------------------- */

const listeners = new Set();

function notify() {
  const h = getHome();
  for (const fn of listeners) {
    try {
      fn(h);
    } catch (e) {
      console.warn('[landfall] home listener threw', e);
    }
  }
}

export function subscribeHome(fn) {
  listeners.add(fn);
  fn(getHome());
  return () => listeners.delete(fn);
}

/* ---------------------------------------------------------------------------
 * GEOLOCATION
 *
 * NEVER called on first launch (SPEC §8). A permission dialog before someone
 * knows what the app is gets denied, and iOS makes that hard to undo. This runs
 * only from an explicit "use my location" tap.
 * ------------------------------------------------------------------------- */

const GEO_MESSAGES = Object.freeze({
  1: 'Location permission was denied. Search for an address or drop a pin instead.',
  2: 'Your device couldn’t get a location fix. Search for an address or drop a pin.',
  3: 'Getting your location took too long. Search for an address or drop a pin.',
});

/** Resolves to {lon, lat, accuracyM} or rejects with a human message already
 *  attached — no raw GeolocationPositionError reaches the UI (SPEC §5). */
export function locateMe({ timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This device can’t share a location. Search for an address instead.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lon: pos.coords.longitude,
          lat: pos.coords.latitude,
          accuracyM: pos.coords.accuracy,
        }),
      (err) =>
        reject(
          new Error(
            GEO_MESSAGES[err?.code] ||
              'Couldn’t get your location. Search for an address or drop a pin.'
          )
        ),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}

/* ---------------------------------------------------------------------------
 * DERIVED FIGURES — each carries its advisory timestamp
 * ------------------------------------------------------------------------- */

/** Straight-line distance from home to a storm's CURRENT position.
 *  Returns null when there is no home — callers render the no-home state
 *  rather than a zero. */
export function distanceTo(storm, home = getHome()) {
  if (!home || !storm || !Number.isFinite(storm.lon) || !Number.isFinite(storm.lat)) {
    return null;
  }
  return {
    nm: greatCircleNm(home.lon, home.lat, storm.lon, storm.lat),
    bearing: bearingDeg(home.lon, home.lat, storm.lon, storm.lat),
    /* When this fix was VALID (the normalized model's `observedAt`), plus the
     * advisory it came from. Not optional, not a separate lookup — same
     * object, so the number cannot be rendered without its age. */
    observedAt: storm.observedAt || null,
    advisoryKey: storm.advisoryKey || null,
  };
}

/**
 * Closest approach along the forecast track.
 *
 * PHASE BOUNDARY — READ THIS BEFORE WIRING IT UP:
 * The normalized storm object (SPEC §4) has NO forecast track field yet.
 * Forecast points arrive in Phase 4 from the MapServer GeoJSON, alongside the
 * cone. This function is written against the shape they will land in — an
 * array of {lon, lat, time, windKt} on `storm.forecast` — and returns null
 * until that field exists.
 *
 * That is deliberate and it is NOT dead code: `storm.can.forecastPoints`
 * already exists in the model and already tells us which storms will ever have
 * a track (GDACS storms never will). The UI branches on `can.forecastPoints`,
 * so it shows the right absent-state today and lights up in Phase 4 with no
 * change here. Writing the fallback path now and the real path later is the
 * "hand-tune twice" failure SPEC §12 forbids.
 *
 * DELIBERATELY SIMPLE: it walks the forecast points and finds the minimum,
 * interpolating linearly between consecutive points. It does NOT do a proper
 * great-circle minimisation.
 *
 * That is the right call, and the reason is worth writing down so nobody
 * "fixes" it later: NHC's 72-hour track error averages well over 100 nm. A
 * sub-mile refinement of the geometry is invisible under an error bar that
 * large. Interpolating between 12-hour forecast points is already finer than
 * the data justifies.
 *
 * Returns null when there is no home or no forecast track — a storm with only
 * a current position gets a distance and no closest approach, which is honest.
 */
export function closestApproach(storm, home = getHome()) {
  if (!home || !storm) return null;

  /* No forecast track on this storm — either the source never publishes one
   * (GDACS: can.forecastPoints === false) or Phase 4 hasn't landed yet. Both
   * are honestly "no closest approach available", NOT a zero. */
  const track = Array.isArray(storm.forecast) ? storm.forecast : null;
  if (!track || track.length === 0) return null;

  /* Include the current position as the t=0 point: a storm already at its
   * nearest point should report "now", not its first forecast hour. */
  const points = [
    { lon: storm.lon, lat: storm.lat, time: storm.observedAt },
    ...track,
  ].filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));

  if (points.length === 0) return null;

  let best = null;

  const consider = (lon, lat, time, windKt) => {
    const nm = greatCircleNm(home.lon, home.lat, lon, lat);
    if (!best || nm < best.nm) {
      best = { nm, lon, lat, time: time || null, windKt: windKt ?? null };
    }
  };

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    consider(p.lon, p.lat, p.time, p.windKt);

    /* Sample between this point and the next. The minimum of a track segment
     * is frequently BETWEEN two forecast points, not at one of them — a storm
     * passing offshore is nearest halfway through a 12-hour leg. Sampling at
     * a fixed subdivision is cheap and captures that.
     *
     * SUBDIVISIONS is a tuning constant, not a magic number: 8 puts a sample
     * every ~90 minutes on a 12-hour leg, which is finer than the forecast's
     * own resolution. */
    const next = points[i + 1];
    if (!next) continue;

    const SUBDIVISIONS = 8;
    const t0 = next.time ? Date.parse(next.time) : NaN;
    const tPrev = p.time ? Date.parse(p.time) : NaN;

    for (let s = 1; s < SUBDIVISIONS; s++) {
      const f = s / SUBDIVISIONS;
      /* Linear interpolation in lon/lat. Over a 12-hour storm leg (a few
       * degrees at most) the difference from a true great-circle interpolation
       * is far below the forecast error. Longitude wrap is handled by taking
       * the shorter way around the dateline. */
      let dLon = next.lon - p.lon;
      if (dLon > 180) dLon -= 360;
      if (dLon < -180) dLon += 360;

      const lon = p.lon + dLon * f;
      const lat = p.lat + (next.lat - p.lat) * f;
      const time =
        Number.isFinite(t0) && Number.isFinite(tPrev)
          ? new Date(tPrev + (t0 - tPrev) * f).toISOString()
          : null;
      const windKt =
        Number.isFinite(p.windKt) && Number.isFinite(next.windKt)
          ? p.windKt + (next.windKt - p.windKt) * f
          : null;

      consider(lon, lat, time, windKt);
    }
  }

  if (!best) return null;

  return {
    nm: best.nm,
    time: best.time,
    windKt: best.windKt,
    bearing: bearingDeg(home.lon, home.lat, best.lon, best.lat),
    /* Same rule as distanceTo: the figure and the advisory it came from are
     * one object. A closest approach computed from a stale advisory is a
     * stale closest approach, and the UI must be able to say so. */
    observedAt: storm.observedAt || null,
    advisoryKey: storm.advisoryKey || null,
  };
}

/* ---------------------------------------------------------------------------
 * SCOPE FILTER (SPEC §16)
 *
 * Two of the three scopes need home. With no home set, only ALL is meaningful
 * — and per §16 the others are ABSENT, not disabled.
 * ------------------------------------------------------------------------- */

export function availableScopes(home = getHome()) {
  return home ? [SCOPE.ALL, SCOPE.BASIN, SCOPE.RADIUS] : [SCOPE.ALL];
}

/** Filter a storm list by scope. Unknown scope falls through to ALL rather
 *  than returning nothing — showing every storm is a safe failure, showing
 *  none during a hurricane is not (SPEC §5). */
export function filterByScope(storms, scope, home = getHome(), radiusNm = SCOPE_RADIUS_NM) {
  if (!home || scope === SCOPE.ALL || !scope) return storms;

  if (scope === SCOPE.BASIN) {
    const basin = homeBasin(home);
    return basin ? storms.filter((s) => s.basin === basin) : storms;
  }

  if (scope === SCOPE.RADIUS) {
    return storms.filter((s) => {
      const d = distanceTo(s, home);
      return d && d.nm <= radiusNm;
    });
  }

  return storms;
}

/** Which basin home sits in.
 *
 *  Delegates to lib/basin.js rather than carrying its own boxes — that file
 *  already owns the basin boundaries for GDACS storms with no published basin,
 *  and two sets of boundary constants would drift apart the first time one got
 *  corrected (SPEC §12: any pattern used twice gets extracted).
 *
 *  Note this answers "which basin is this POINT in", which for a coastal home
 *  is the adjacent ocean. Someone inland gets whichever basin their longitude
 *  band falls in, which is the right answer for a filter — a Houston resident
 *  wants Atlantic storms. */
export function homeBasin(home = getHome()) {
  return home ? basinFromPosition(home.lon, home.lat) : null;
}
