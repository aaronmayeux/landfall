/**
 * home-dashboard.js — every figure the home dashboard states, in one place.
 *
 * THE DASHBOARD ANSWERS ONE QUESTION: "is this storm going to affect me, how
 * badly, and when?" This file computes the answer. It renders nothing and
 * fetches nothing, so every sentence on that screen can be tested against a
 * real advisory with no browser and no network (tools/test-home.mjs).
 *
 * WHY IT IS NOT IN data/home.js. That file owns the home LOCATION — reading
 * it, writing it, publishing changes, and the three geometry-free figures the
 * storm list and the detail panel have always used. This file owns one SCREEN's
 * derived content, it is the only caller of half of what it computes, and
 * bolting it on would take home.js past the ~700-line split line (§12) while
 * making the location store depend on a view's editorial choices.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE, restated because it is the whole job:
 *
 *   ==> A TRUE NUMBER UNDER A FALSE IMPRESSION IS THE FAILURE. <==
 *
 * "Closest pass 36 miles south" is arithmetically correct and can still leave
 * someone unprepared, because NHC's own two-thirds error circle at that lead
 * time is 40 miles — the band reaches the house. So no closest-approach figure
 * leaves here without its band, and every figure that cannot be computed comes
 * back null with a REASON rather than a zero, a dash, or a plausible guess.
 *
 * EVERY RETURN CARRIES ITS ADVISORY TIMESTAMP, for the same reason data/home.js
 * does it: "closest pass in 14 hours" from a six-hour-old advisory is a
 * different sentence than the same words from a fresh one, and this is the one
 * screen where somebody may make a real decision.
 *
 * Imports: config/, lib/, and data/home.js. No UI, no map, no fetching.
 */

import { APPROACH, HOME_DASH } from '../config/constants.js';
import { greatCircleNm, bearingDeg, densifyTrack } from '../lib/geo.js';
import { coneErrorNm, hasConeError, coneSeasonOfStorm, coneSeasonUsed } from '../lib/cone-error.js';
import { isEnded } from '../lib/lifecycle.js';
import { buildCorridor } from './home-corridor.js';
import { distanceTo, closestApproach, motionTrend, getHome } from './home.js';

const MS_PER_HOUR = 3_600_000;

/* ---------------------------------------------------------------------------
 * THE THREAT PICK — which single storm the dashboard is about
 * ------------------------------------------------------------------------- */

/**
 * The one storm bearing down on home, or null when nothing is.
 *
 * PORTED FROM THE HA INTEGRATION'S `_threat_key`, and ported at that altitude
 * on purpose: like the storm list, this runs over storms that carry only a
 * current position. Forecast geometry is fetched per storm on selection, so a
 * list of eight storms has eight positions and no tracks, and any ranking that
 * needed a track could not run at all.
 *
 * TWO KEYS, IN THIS ORDER:
 *   1. CLOSING BEATS NEAR. A storm 600 nm away and closing matters more than
 *      one 300 nm away and leaving. `motionTrend` is richer than HA's raw
 *      within-90-degrees test: it projects along the great circle with a
 *      deadband, so a storm passing broadside does not flicker between the
 *      two groups on successive polls.
 *   2. THEN NEAREST, by present great-circle distance.
 *
 * THIS IS A GLOBAL PICK and is deliberately NOT the storm list's ordering.
 * The list groups by basin so it reads as a map of the world's weather; the
 * dashboard is about one house, and a basin boundary means nothing to it.
 *
 * GDACS STORMS CAN NEVER WIN THE FIRST KEY, and that asymmetry is honest
 * rather than a bug to paper over. GDACS publishes no heading, so
 * `motionTrend` returns null for every one of them and they rank on distance
 * alone. Inventing a heading so they could compete is the fabrication §5
 * forbids. The consequence is real and worth knowing: a GDACS storm genuinely
 * bearing down can be out-ranked by a closer NHC storm that is leaving.
 *
 * ENDED STORMS ARE NEVER THE THREAT. A storm whose agency has issued its final
 * advisory is not bearing down on anybody, and its last position would
 * otherwise sit at the top of this ranking for the whole grey grace period.
 */
export function pickThreatStorm(storms, home = getHome()) {
  if (!home || !Array.isArray(storms) || storms.length === 0) return null;

  const scored = [];
  for (const storm of storms) {
    if (!storm || isEnded(storm)) continue;
    const d = distanceTo(storm, home);
    if (!d) continue;
    scored.push({
      storm,
      closing: motionTrend(storm, home) === 'closing',
      nm: d.nm,
    });
  }
  if (scored.length === 0) return null;

  scored.sort((a, b) => (a.closing === b.closing ? a.nm - b.nm : a.closing ? -1 : 1));
  const top = scored[0];

  return {
    storm: top.storm,
    /** WHY this one won, so the screen can say "bearing down" or fall back to
     *  "nearest" rather than implying a threat the ranking did not find. */
    why: top.closing ? 'closing' : 'nearest',
    nm: top.nm,
    /** How many storms were in the running. The dashboard's calm state says
     *  "three cyclones are active worldwide" and this is where that comes
     *  from — a count of storms considered, not of storms shown. */
    considered: scored.length,
  };
}

/* ---------------------------------------------------------------------------
 * SAMPLING THE INTENSITY CURVE
 * ------------------------------------------------------------------------- */

/**
 * What the storm is forecast to be at one instant, read off the curve.
 *
 * THE CURVE IS NHC-ONLY AND THIS RETURNS NULL WITHOUT IT. GDACS publishes
 * timestamped centre positions but no per-point wind, so a GDACS storm gets a
 * closest approach with a distance and a time and NO strength — which is the
 * honest shape of that answer, not a degraded one.
 *
 * LINEAR BETWEEN THE TWO BRACKETING POINTS, matching densifyTrack, so the wind
 * this returns agrees with the one closestApproach() already computed. A test
 * asserts they agree; if they ever diverge, one of the two is interpolating
 * differently and the screen would show two different winds for one moment.
 *
 * CATEGORY IS NOT INTERPOLATED. It is taken from whichever bracketing point is
 * nearer in time, because a category is a LABEL, not a quantity: there is no
 * such thing as being 40% of the way from a Cat 2 to a Cat 3, and averaging
 * the two indices would silently mint a category NHC never published. The
 * interpolated WIND is the continuous quantity; the category is the nearest
 * published statement about it.
 *
 * Outside the curve's span it returns null rather than clamping to an end
 * point. A forecast has a horizon and past it there is nothing to say.
 */
export function sampleCurveAt(curve, timeMs) {
  if (!Array.isArray(curve) || curve.length === 0 || !Number.isFinite(timeMs)) return null;

  const pts = curve
    .filter((p) => p && p.time != null && Number.isFinite(Date.parse(p.time)))
    .map((p) => ({ ...p, ms: Date.parse(p.time) }))
    .sort((a, b) => a.ms - b.ms);
  if (pts.length === 0) return null;

  if (timeMs < pts[0].ms || timeMs > pts[pts.length - 1].ms) return null;

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    if (timeMs === a.ms) return read(a, a, 0);
    const b = pts[i + 1];
    if (!b) break;
    if (timeMs < b.ms) {
      const f = (timeMs - a.ms) / (b.ms - a.ms);
      return read(a, b, f);
    }
  }
  return null;

  function read(a, b, f) {
    const near = f < 0.5 ? a : b;
    const lerp = (x, y) =>
      Number.isFinite(x) && Number.isFinite(y) ? x + (y - x) * f : null;
    return {
      windKt: lerp(a.windKt, b.windKt),
      gustKt: lerp(a.gustKt, b.gustKt),
      /* Nearest published point, never a blended index — see the note above. */
      category: near.category ?? null,
      categorySource: near.categorySource ?? null,
      stormType: near.stormType ?? null,
      /** 'point' when the instant landed exactly on a published forecast hour,
       *  'interpolated' when it fell between two. A reader is entitled to know
       *  which, and the difference is the whole provenance argument. */
      source: f === 0 || f === 1 ? 'point' : 'interpolated',
    };
  }
}

/* ---------------------------------------------------------------------------
 * THE NEAR RING — "when does it come inside 100 miles"
 * ------------------------------------------------------------------------- */

/**
 * When the forecast track first crosses inside the near ring, and when it
 * leaves again.
 *
 * WHY A RING AT ALL, GIVEN THAT WINDS-AT-HOME IS THE REAL ANSWER. It is not a
 * substitute for the wind windows and does not become one when they land in
 * Phase B — "when does it get near" and "when do I feel it" are different
 * questions, and the first one can be answered from a track alone, today, for
 * both sources. The ring is an editorial threshold and HOME_DASH.nearRingNm
 * says so.
 *
 * Returns null when there is no usable track. Otherwise always an object, and
 * `everInside` is the field that matters: false is a real, useful answer
 * ("this never comes within 100 miles of you") and must not be confused with
 * null ("we cannot say").
 *
 * ALREADY INSIDE IS ITS OWN CASE. `enter` comes back null with
 * `insideNow: true`, because "comes inside 100 miles at 6 AM" is wrong for a
 * storm that is already there — the useful figure then is only when it leaves.
 *
 * A TRACK THAT ENDS WHILE STILL INSIDE reports `exit: null` with
 * `leavesWithinForecast: false`. The forecast ran out; the storm did not
 * leave. Reporting the last forecast hour as an exit time would be inventing
 * a departure NHC never published.
 */
export function nearRingWindow(storm, forecast, home = getHome(), {
  ringNm = HOME_DASH.nearRingNm,
  now = Date.now(),
} = {}) {
  if (!home || !storm) return null;
  const track = Array.isArray(forecast) ? forecast : null;
  if (!track || track.length === 0) return null;

  const points = [
    { lon: storm.lon, lat: storm.lat, time: storm.observedAt },
    ...track,
  ].filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
  if (points.length < 2) return null;

  const walked = densifyTrack(points);

  /* ==> THE CROSSING IS INTERPOLATED, NOT SNAPPED TO A SAMPLE, AND THE
   * DIRECTION OF THAT ERROR IS WHY. <==
   *
   * The first draft reported the first sample found INSIDE the ring. On
   * Bertha that put the crossing at 12:00Z when the track actually crosses at
   * 10:51Z — sixty-nine minutes LATE. Every error of that kind runs the same
   * way, because a sample can only be found inside after the boundary is
   * already behind it, and "you have another hour" is the one direction a
   * preparation figure must never be wrong in.
   *
   * Straight-line interpolation on distance between the two bracketing
   * samples removes it. Distance along a leg is not exactly linear, but over
   * a 90-minute sample gap the curvature is negligible against a forecast
   * whose own two-thirds error at this range is tens of miles — and unlike
   * the snap, the residual error is not biased late. */
  const cross = (a, b, da, db) => {
    const ta = a.time != null ? Date.parse(a.time) : NaN;
    const tb = b.time != null ? Date.parse(b.time) : NaN;
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return b.time || null;
    const span = da - db;
    if (!Number.isFinite(span) || span === 0) return b.time || null;
    const f = Math.min(1, Math.max(0, (da - ringNm) / span));
    return new Date(ta + (tb - ta) * f).toISOString();
  };

  let enter = null;
  let exit = null;
  let everInside = false;
  let prev = null;
  let prevNm = NaN;

  for (let i = 0; i < walked.length; i++) {
    const p = walked[i];
    const nm = greatCircleNm(home.lon, home.lat, p.lon, p.lat);
    const inside = nm <= ringNm;
    if (inside) everInside = true;

    /* Only crossings AHEAD of the clock are reported. The first sample is the
     * present position and is the baseline, never an event. */
    if (prev !== null && inside !== (prevNm <= ringNm)) {
      const when = cross(prev, p, prevNm, nm);
      const ms = when != null ? Date.parse(when) : NaN;
      const ahead = !Number.isFinite(ms) || ms >= now;
      if (inside && ahead && enter === null) enter = when;
      if (!inside && ahead && exit === null && everInside) exit = when;
    }
    prev = p;
    prevNm = nm;
  }

  const insideNow = greatCircleNm(home.lon, home.lat, points[0].lon, points[0].lat) <= ringNm;

  return {
    ringNm,
    everInside,
    insideNow,
    enter: insideNow ? null : enter,
    exit,
    /** false means the forecast horizon arrived while the storm was still
     *  inside the ring — NOT that it stays forever. */
    leavesWithinForecast: exit != null,
    observedAt: storm.observedAt || null,
  };
}

/* ---------------------------------------------------------------------------
 * THE WHOLE DASHBOARD
 * ------------------------------------------------------------------------- */

/**
 * Every figure the home dashboard renders, from one storm and one home.
 *
 * ONE CALL, ONE OBJECT, and the view does no arithmetic of its own. That is
 * not tidiness: the moment a view computes "peak minus arrival" inline, the
 * threshold that decides whether to say "weakening" stops being a constant
 * anybody can find and the sentence stops being testable.
 *
 * EVERY FIELD IS NULLABLE AND NULL ALWAYS MEANS "WE CANNOT SAY". Where the
 * reason matters, it is named in `unavailable` — the view turns those into
 * sentences, and §5 requires that "the source doesn't publish this",
 * "the fetch failed" and "the answer is genuinely nothing" read differently.
 *
 * @param {object}   o
 * @param {object}   o.storm      normalized storm (SPEC §4)
 * @param {Array}    o.forecast   normalized forecast curve, or [] / null
 * @param {Array}    o.radii      published quadrant radii per tau, or [] / null
 * @param {object}   o.home
 * @param {number}   o.now
 */
export function buildHomeDashboard({
  storm, forecast, radii, home = getHome(), now = Date.now(),
} = {}) {
  if (!home) return { ok: false, unavailable: 'no-home' };
  if (!storm) return { ok: false, unavailable: 'no-storm' };

  const curve = Array.isArray(forecast) ? forecast : [];
  const hasCurve = curve.length > 0;

  const distance = distanceTo(storm, home);
  const trend = motionTrend(storm, home);
  /* closestApproach() reads the track off `storm.forecast` — the storm object
   * in the store is PURE and never carries geometry, so the curve is decorated
   * onto a copy here rather than mutating the store's object. Passing `storm`
   * bare returns null and looks exactly like a storm with no forecast. */
  const approach = hasCurve ? closestApproach({ ...storm, forecast: curve }, home, now) : null;

  /* --- the band, and the two ways it can be absent ------------------------
   * A missing band and a basin with no published table are different facts.
   * The first is "we have no closest approach to attach one to"; the second
   * is "NHC does not publish error statistics for this ocean", which is a
   * sentence the screen should be able to say out loud rather than silently
   * dropping a line. */
  let band = null;
  let bandUnavailable = null;
  if (!hasConeError(storm.basin)) {
    bandUnavailable = 'no-published-error-table';
  } else if (approach?.time) {
    const hours = (Date.parse(approach.time) - now) / MS_PER_HOUR;
    /* THE STORM'S OWN SEASON, not the newest table on file. Ida is 2021 and
     * her cone is measurably wider than 2026's at every hour that matters. */
    const season = coneSeasonOfStorm(storm);
    const nm = coneErrorNm(hours, storm.basin, season);
    if (nm != null) {
      band = {
        nm,
        hours,
        /** Does the two-thirds circle reach the house? This is the single
         *  most useful boolean on the screen and the reason the band exists:
         *  when it is true, "closest pass 36 miles away" and "it could come
         *  straight over you" are both true at once, and only saying the
         *  first one is the §5 failure. */
        reachesHome: approach.nm <= nm,
        /** The honest span, nautical miles, floored at zero — a distance
         *  cannot be negative and "minus 8 miles away" is nonsense. */
        loNm: Math.max(0, approach.nm - nm),
        hiNm: approach.nm + nm,
        basin: storm.basin,
        /** Which season's published table this radius came from. Carried so a
         *  figure measured against a table that is not the storm's own season
         *  can be seen rather than inferred — the same reason every home
         *  figure carries its advisory timestamp (§8). */
        tableSeason: coneSeasonUsed(season),
        tableIsStormsOwnSeason: coneSeasonUsed(season) === season,
        /** Named in the return so a renderer cannot describe it as anything
         *  other than what it is. Two thirds, not ninety-five percent. */
        confidence: 'two-thirds',
      };
    }
  }

  /* --- strength at the closest pass -------------------------------------- */
  const atClosest = approach?.time ? sampleCurveAt(curve, Date.parse(approach.time)) : null;

  /* --- the peak, and where it sits relative to the pass -------------------
   * The peak is taken over the FORECAST plus the storm's present wind, because
   * a storm at its strongest right now has already peaked and the curve alone
   * would miss it — which is exactly Bertha's case: 50 kt now against a 45 kt
   * forecast maximum. Reading only the curve would have said "peaks in nine
   * hours" about a storm that is weakening. */
  let peak = null;
  if (Number.isFinite(storm.windKt)) {
    peak = { windKt: storm.windKt, time: storm.observedAt || null, when: 'now' };
  }
  for (const p of curve) {
    if (!Number.isFinite(p.windKt)) continue;
    if (!peak || p.windKt > peak.windKt) {
      peak = { windKt: p.windKt, time: p.time || null, when: 'forecast' };
    }
  }

  /* WHAT THE HEADLINE SENTENCE IS ALLOWED TO SAY. Compared against the wind
   * NOW, not against the peak — "stronger when it reaches you than it is right
   * now" is the comparison a reader is actually making, and it survives a
   * storm whose peak is somewhere in the middle of the track.
   *
   * The deadband is HOME_DASH.peakDeltaKt and it is doing real work: NHC's own
   * published intensity error is around 15 kt per forecast day, so a 3 kt
   * difference between two points on one curve is not a trend, and a label
   * that flips between advisories is worse than no label. */
  let arrivalTrend = null;
  if (Number.isFinite(atClosest?.windKt) && Number.isFinite(storm.windKt)) {
    const d = atClosest.windKt - storm.windKt;
    arrivalTrend =
      d >= HOME_DASH.peakDeltaKt ? 'strengthening'
      : d <= -HOME_DASH.peakDeltaKt ? 'weakening'
      : 'steady';
  }

  /** Is the forecast peak before, at, or after the closest pass? A separate
   *  question from arrivalTrend, and the one that answers "have I already seen
   *  the worst of it". Null when either moment has no time. */
  let peakWhen = null;
  if (peak?.time && approach?.time) {
    const dp = Date.parse(peak.time) - Date.parse(approach.time);
    peakWhen = Math.abs(dp) < MS_PER_HOUR ? 'at' : dp < 0 ? 'before' : 'after';
  }

  const nearRing = hasCurve ? nearRingWindow(storm, curve, home, { now }) : null;

  /* THE CORRIDOR — what actually reaches the house. Needs the published
   * quadrant radii as well as the track, so it is the one figure here that
   * can be absent while everything else is present: a bundle carrying a
   * forecast but no wind radii is normal for a weak or distant storm. */
  const corridor = hasCurve && (radii || []).length
    ? buildCorridor({ storm, forecast: curve, radii, home, now })
    : { ok: false, unavailable: hasCurve ? 'no-radii' : 'no-track', samples: [] };

  return {
    ok: true,
    storm,
    home,
    now,

    distance,
    trend,
    approach,
    band,
    bandUnavailable,
    atClosest,
    peak,
    arrivalTrend,
    peakWhen,
    nearRing,
    corridor,

    /** The curve itself, for the chart. Empty array, never null — a chart with
     *  nothing to draw is a different render path from a chart that was handed
     *  a null and threw. */
    curve,

    /** WHY there is no forecast-derived figure, when there isn't one. The view
     *  turns each of these into a different sentence, per §5. `null` here with
     *  `hasCurve` true means everything that could be computed was. */
    unavailable: hasCurve
      ? null
      : storm.can?.forecastPoints === false
        ? 'source-publishes-no-track'
        : 'no-track-loaded',

    /* Same rule as data/home.js: the figures and the advisory they came from
     * are one object, so no caller can render the numbers without their age. */
    observedAt: storm.observedAt || null,
    advisoryKey: storm.advisoryKey || null,
  };
}

/** Re-exported so a caller needs one import for the whole dashboard, and so
 *  the relevance threshold cannot be restated somewhere else. */
export { APPROACH };
