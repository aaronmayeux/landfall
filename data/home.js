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

import { greatCircleNm } from '../lib/geo.js';
import { STORAGE_KEY, APPROACH } from '../config/constants.js';
import { DEG, destPoint } from '../lib/geo.js';
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

/* greatCircleNm now lives in lib/geo.js — pure geometry, two readers.
 * Re-exported so every existing caller here is untouched. */
export { greatCircleNm };

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
 * BOTH SOURCES FILL IT NOW. This used to say "GDACS storms never will" have a
 * forecast track, which was inherited and wrong: GDACS publishes timestamped
 * centre dots and they are parsed in data/gdacs-points.js. The UI still
 * branches on `storm.can.forecastPoints`, which is now true for both sources.
 *
 * ONE DIFFERENCE THAT MATTERS HERE: GDACS publishes no per-point wind, so
 * every forecast point except the analysis one arrives with `windKt: null`.
 * That is handled below — a closest approach still reports distance and time
 * and simply has no wind to state, which is honest rather than degraded.
 *
 * DELIBERATELY SIMPLE: it walks the forecast points and finds the minimum,
 * interpolating linearly between consecutive points. It does NOT do a proper
 * great-circle minimisation.
 *
 * That is the right call, and the reason is worth writing down so nobody
 * "fixes" it later: NHC's 72-hour track error averages well over 100 nm. A
 * sub-mile refinement of the geometry is invisible under an error bar that
 * large. Interpolating between 12-hour forecast points is already finer than
 * the data justifies. MEASURED 2026-07-24 against a 4,000-step true
 * great-circle search on a close-pass track: 0.2 nm and under one minute of
 * disagreement. The shortcut is not where the error lives.
 *
 * WHERE THE ERROR ACTUALLY LIVED — three rules this now enforces, because a
 * correct minimum is not the same thing as a true sentence:
 *
 * 1. THE PAST IS NOT AN APPROACH. Neither source's track starts at "now".
 *    GDACS splits past from forecast at the advisory ISSUE time, and NHC's
 *    tau 0 is the synoptic analysis up to 3 h behind issuance — on top of
 *    which the advisory itself may be hours old. Points already behind the
 *    clock are therefore skipped. The CURRENT POSITION is the one exception
 *    and the deliberate anchor: a storm at its nearest point right now must
 *    report now, not its first forecast hour.
 *
 * 2. FAR AWAY IS NOT NEAR. See APPROACH.relevanceNm — `relevant` is false
 *    beyond it. It no longer decides WHETHER anything is reported, only which
 *    true sentence fits; a storm drifting across the line changes a few words
 *    rather than the whole meaning.
 *
 * 3. NEAREST IS NOT THE SAME AS CLOSING. `trend` is a statement about the
 *    TRACK: 'closing' means the forecast beats the current position by more
 *    than the deadband, 'receding' means it never does. Crossed with
 *    `relevant`, that gives the panel its three sentences — an approach with a
 *    time, a storm that never gets closer than it already is, and a storm that
 *    closes a little but is never near home. "Closest approach" over a
 *    departing storm is the §5 failure in miniature: accurate pixels, wrong
 *    meaning.
 *
 * Returns null when there is no home or no forecast track — a storm with only
 * a current position gets a distance and no closest approach, which is honest.
 * Note the difference between that null and `relevant: false`: the first is
 * "we cannot say", the second is "we can, and the answer is nothing". The UI
 * says different things for them.
 */
export function closestApproach(storm, home = getHome(), now = Date.now()) {
  if (!home || !storm) return null;

  /* No forecast track on this storm — its geometry has not arrived, or the
   * source published nothing usable for it. Honestly "no closest approach
   * available", NOT a zero. */
  const track = Array.isArray(storm.forecast) ? storm.forecast : null;
  if (!track || track.length === 0) return null;

  /* Include the current position as the t=0 point: a storm already at its
   * nearest point should report "now", not its first forecast hour. */
  const points = [
    { lon: storm.lon, lat: storm.lat, time: storm.observedAt },
    ...track,
  ].filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));

  if (points.length === 0) return null;

  /* A candidate already behind the clock is history, not a forecast. A
   * candidate whose time we cannot read is KEPT: unknown is not past, and
   * dropping it would silently shorten the track (§5). */
  const isPast = (t) => {
    if (t == null) return false;
    const ms = typeof t === 'number' ? t : Date.parse(t);
    return Number.isFinite(ms) && ms < now;
  };

  let best = null;

  /* `anchor` is the current-position exemption from the past filter — it is
   * the only point that is SUPPOSED to be behind the clock. */
  const consider = (lon, lat, time, windKt, anchor = false) => {
    if (!anchor && isPast(time)) return;
    const nm = greatCircleNm(home.lon, home.lat, lon, lat);
    if (!best || nm < best.nm) {
      best = { nm, lon, lat, time: time || null, windKt: windKt ?? null };
    }
  };

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    consider(p.lon, p.lat, p.time, p.windKt, i === 0);

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

  /* Where the storm is RIGHT NOW, always — the baseline every judgement below
   * is made against, and a figure the panel shows in its own right. */
  const nowNm = greatCircleNm(home.lon, home.lat, storm.lon, storm.lat);

  /* THE ONE TEST, and it is deliberately a statement about the TRACK rather
   * than about the clock: does the forecast ever bring this storm closer than
   * it is right now? That is exactly what the panel's words claim, so it is
   * what gets measured. Lead time is NOT part of it — a minimum forty minutes
   * out is still a real minimum, and formatUntil already renders anything
   * inside two minutes as "now". Tying the test to a clock threshold only
   * created a case where the app had a true minimum and no sentence for it. */
  const closerAhead = nowNm - best.nm >= APPROACH.minGainNm;

  return {
    nm: best.nm,
    time: best.time,
    windKt: best.windKt,
    bearing: bearingDeg(home.lon, home.lat, best.lon, best.lat),

    /** Distance at the current position, for the caller that wants to show
     *  the pair rather than make the reader subtract two numbers. */
    nowNm,

    /** 'closing' | 'receding'. NEVER null — a track exists, so this question
     *  always has an answer. Pure direction: 'receding' means the track never
     *  beats the current position by more than the deadband. Contrast
     *  motionTrend() below, which can honestly return null because its inputs
     *  may be missing. */
    trend: closerAhead ? 'closing' : 'receding',

    /** false when the nearest point is beyond APPROACH.relevanceNm.
     *
     *  ORTHOGONAL TO `trend`, and the panel needs both because the two
     *  combinations of "closing" produce different true sentences. A storm
     *  closing from 400 nm is approaching. A typhoon closing from 7,315 nm to
     *  7,085 nm is also closing — over the top of the planet, because the
     *  great circle from Louisiana to the West Pacific crosses Alaska — and
     *  calling that an approach is the §5 failure this whole block exists to
     *  prevent. Same flag, different sentence. */
    relevant: best.nm <= APPROACH.relevanceNm,

    /* Same rule as distanceTo: the figure and the advisory it came from are
     * one object. A closest approach computed from a stale advisory is a
     * stale closest approach, and the UI must be able to say so. */
    observedAt: storm.observedAt || null,
    advisoryKey: storm.advisoryKey || null,
  };
}

/**
 * Closing or receding, from the storm's OWN published motion — no forecast
 * track required.
 *
 * WHY THIS EXISTS ALONGSIDE closestApproach(). The storm list is a glance
 * surface and holds no geometry: forecast tracks are fetched per storm, on
 * selection, so a list of eight storms has eight positions and no tracks.
 * Dead reckoning from `headingDeg` and `speedKt` is the only trend a row can
 * afford, and it is enough for the one word a row has space for.
 *
 * NULL IS A REAL ANSWER HERE, and it is returned in four cases: no home, no
 * published motion, a stationary storm, and a storm too far away for the
 * question to mean anything. GDACS publishes neither heading nor speed
 * (data/gdacs.js), so every GDACS row lands in the second case and shows no
 * trend word at all. That asymmetry is deliberate — inventing a direction for
 * a source that publishes none is exactly the fabrication §5 forbids, and a
 * missing word reads as "not stated" while a wrong one reads as fact.
 */
export function motionTrend(storm, home = getHome()) {
  if (!home || !storm) return null;
  if (!Number.isFinite(storm.lon) || !Number.isFinite(storm.lat)) return null;
  if (!Number.isFinite(storm.headingDeg) || !Number.isFinite(storm.speedKt)) return null;

  /* Stationary. A heading with no speed behind it points nowhere, and NHC
   * does publish drifting systems at 0 kt. */
  if (storm.speedKt <= 0) return null;

  const nowNm = greatCircleNm(home.lon, home.lat, storm.lon, storm.lat);
  if (nowNm > APPROACH.relevanceNm) return null;

  /* Project along the great circle. One nautical mile is one minute of arc by
   * definition, so nm/60 is the arc in degrees — which is why the whole app
   * stores distance in nm and this line needs no conversion constant. */
  const arcDeg = (storm.speedKt * APPROACH.trendProbeHours) / 60;
  const [lon2, lat2] = destPoint(storm.lon, storm.lat, storm.headingDeg, arcDeg);
  const thenNm = greatCircleNm(home.lon, home.lat, lon2, lat2);

  /* Inside the deadband the storm is passing broadside, and the row would
   * flip between "closing" and "receding" on successive polls. No word is
   * better than a word that changes while you are reading it. */
  if (Math.abs(thenNm - nowNm) < APPROACH.minGainNm) return null;

  return thenNm < nowNm ? 'closing' : 'receding';
}

/* THE SCOPE FILTER LIVED HERE. Retired 2026-07-25 with the control it fed —
 * `availableScopes` and `filterByScope` are gone, along with `SCOPE` and
 * `SCOPE_RADIUS_NM` in config/constants.js. Deleted rather than commented out
 * or left as unused exports (§12): the storm list has never held more than
 * nine rows, so filtering it saved nobody any work, and dead exports are how a
 * module keeps promising an API nothing calls.
 *
 * `homeBasin` below SURVIVES — it is still the honest answer to "which basin
 * is home in", and the sort order and the detail view both ask. */

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
