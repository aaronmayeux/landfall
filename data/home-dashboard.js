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
import { categoryFromKt } from '../lib/category.js';
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

    /** EVERY storm that was in the running, best first, so a reader can step
     *  through them against their own house.
     *
     *  ONE RANKING, NOT TWO. The home drawer's storm switcher offers exactly
     *  this list in exactly this order, which means the storm the drawer opens
     *  on is always the first chip. A switcher with its own sort would put a
     *  second opinion about what matters on the same screen as this one, and
     *  the two would drift the first time either was corrected (§12).
     *
     *  Ended storms are absent for the same reason `storm` above never is one:
     *  an agency that has issued its final advisory is not bearing down on
     *  anybody, and a grey dot does not belong in a threat ranking. They are
     *  still reachable from the storm list, which is where a finished storm
     *  belongs. */
    ranked: scored.map((s) => s.storm),
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
 * @param {'loading'|'ok'|'error'} [o.trackState]
 *   ==> WHY AN EMPTY CURVE IS NOT ENOUGH ON ITS OWN. <==
 *   `forecast: []` used to arrive from FOUR different situations — the fetch
 *   is still in flight, the fetch failed, the source publishes no tracks, and
 *   the source answered with nothing — and this function could not tell them
 *   apart, so all four came out as `pending` and the chip said "Checking…"
 *   forever. Seen on glass 2026-08-13 on Hernan, whose advisory 002 published
 *   a position and nothing else: the storm's own detail panel said "No
 *   forecast track in this advisory" while the home drawer beside it claimed
 *   to still be working on it. Omitting this argument is treated as
 *   `'loading'`, which is the only safe default — a caller that has not been
 *   taught to report cannot be assumed to have finished.
 */
export function buildHomeDashboard({
  storm, forecast, radii, home = getHome(), now = Date.now(), trackState = 'loading',
} = {}) {
  if (!home) return { ok: false, unavailable: 'no-home' };
  if (!storm) return { ok: false, unavailable: 'no-storm' };

  const curve = Array.isArray(forecast) ? forecast : [];
  const hasCurve = curve.length > 0;

  /* ==> WHY THERE IS NO CURVE, DECIDED ONCE. <==
   *
   * Four situations, four different sentences, and every one of them was
   * being printed as "Working out where it goes next…" before this existed.
   * Order matters and it is the §5 order: what the SOURCE can do outranks
   * what happened on the wire, because "this source never publishes a track"
   * stays true through a hundred successful fetches.
   *
   * `null` when there IS a curve — a caller reading this field can treat
   * non-null as "no forecast figures on this screen" without a second test. */
  const noCurveReason = hasCurve
    ? null
    : storm.can?.forecastPoints === false ? 'source-publishes-no-track'
    : trackState === 'loading' ? 'no-track-loaded'
    : trackState === 'error' ? 'track-fetch-failed'
    /* Answered, and answered with nothing. The distinction that Hernan's
     * advisory 002 needed: NHC had a position for him and no track at all,
     * which is a real published fact and not a hole in our data. */
    : 'no-track-published';

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
    /* ==> A PASS THAT IS HAPPENING NOW HAS NO FORECAST ERROR, AND SAYING "0.0
     * MILES" IS WORSE THAN SAYING NOTHING. <== The table tapers linearly to
     * zero at zero hours, which is right as arithmetic and false as a
     * sentence: it rendered "two-thirds of past NHC forecasts landed within
     * 0.0 mi of that" about a storm already overhead. There is no forecast
     * left to put a band on — the position is observed, not predicted, and
     * the advisory carries its own POSITION ACCURATE WITHIN line for that.
     * Found on Ida's Advisory 17, where she is inland and the nearest point
     * is now. */
    if (nm != null && nm > 0) {
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
    } else if (nm != null) {
      bandUnavailable = 'pass-is-now';
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
  /* ==> AND IT CARRIES ITS OWN CATEGORY. <== The strength strip colours each
   * figure by the category it represents (§6 — severity is read off colour).
   * `Now` and `When it's closest` both had one to hand and `Strongest` did
   * not, so it alone rendered plain white beside two coloured numbers, which
   * reads as "this one is different" rather than as "nobody wrote it down".
   * It comes from the same place as the wind on either branch — the storm's
   * present reading, or the winning forecast point — so it can never disagree
   * with the number it sits under. Null stays null: a point with no
   * classification gets no colour rather than a borrowed one. */
  let peak = null;
  if (Number.isFinite(storm.windKt)) {
    peak = {
      windKt: storm.windKt,
      category: storm.category ?? null,
      time: storm.observedAt || null,
      when: 'now',
    };
  }
  for (const p of curve) {
    if (!Number.isFinite(p.windKt)) continue;
    if (!peak || p.windKt > peak.windKt) {
      peak = {
        windKt: p.windKt,
        category: p.category ?? null,
        time: p.time || null,
        when: 'forecast',
      };
    }
  }

  /* WHAT THE HEADLINE SENTENCE IS ALLOWED TO SAY. Compared against the wind
   * NOW, not against the peak — "stronger when it reaches you than it is right
   * now" is the comparison a reader is actually making, and it survives a
   * storm whose peak is somewhere in the middle of the track.
   *
   * The deadband is HOME_DASH.peakDeltaKt and it is doing real work: NHC's own
   * published intensity error is around 15 kt per forecast day, so a change
   * under HOME_DASH.peakDeltaKt between two points on one curve is not a
   * trend — the number is written once, above, and not spelled out again
   * here, because the prose and the value had already drifted apart. A label
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
  /* ==> 'at' AND null WERE BOTH BEING PRINTED AS "before the pass". <== The
   * view fell through to the same words for three different facts: the peak
   * lands before the pass, the peak lands ON the pass, and nobody knows when
   * the peak is. Two of those are not "before". They have their own sentences
   * now — this is a correctness fix wearing a copy change. */

  const nearRing = hasCurve ? nearRingWindow(storm, curve, home, { now }) : null;

  /* --- WHAT THE STORM ITSELF DOES, AND WHEN ------------------------------
   *
   * ==> THE FORECAST CARRIES A CLASSIFICATION PER HOUR AND NOTHING READ IT.
   * <== Every point on the curve knows what class NHC expects the storm to be
   * at that hour, and until now the only thing the home screen did with it was
   * colour a dot. So "it becomes a hurricane nine hours before it reaches you"
   * — a published fact, on the one screen that is supposed to say what happens
   * and when — was nowhere on it.
   *
   * ==> POINT TIMES, NOT INTERPOLATED ONES, AND THAT IS A DELIBERATE CHOICE
   * WITH A COST. <== The corridor interpolates: it crosses a NUMBER (a
   * distance, a wind radius) between two published samples, and a number
   * between two numbers is arithmetic. A CLASSIFICATION is not. NHC states
   * "hurricane" at a forecast hour; it states nothing whatever about the hours
   * between, and manufacturing the minute a storm crosses into a class would
   * be inventing a call the agency did not make (§5).
   *
   * THE COST IS THAT THESE ROWS RUN LATE — up to one forecast interval, so as
   * much as twelve hours out at long range. That is acceptable HERE and would
   * not be for the wind rows: these are about the storm, and the question "when
   * does dangerous wind reach my house" is answered by the corridor, which does
   * interpolate and does carry its own earlier-than-forecast hedge.
   *
   * ONLY AHEAD OF THE CLOCK, and only relative to what the storm IS now: a
   * storm already at hurricane strength gets no row telling it will become one.
   */
  const milestones = [];
  if (hasCurve) {
    const baseline = Number.isFinite(storm.category) ? storm.category : null;
    for (const level of HOME_DASH.classMilestones) {
      /* `null` category means the source could not say — never a crossing.
       * Treating unknown as "below" would announce a storm becoming a
       * hurricane every time one forecast hour happened to omit the field. */
      let prev = baseline;
      for (const p of curve) {
        const cat = Number.isFinite(p.category) ? p.category : null;
        const ms = p.time ? Date.parse(p.time) : NaN;
        if (cat == null || prev == null || !Number.isFinite(ms)) {
          if (cat != null) prev = cat;
          continue;
        }
        const was = prev >= level;
        const is = cat >= level;
        if (was !== is && ms >= now) {
          milestones.push({
            kind: 'class',
            at: ms,
            level,
            /** Which way it crossed. The copy differs, not just the wording:
             *  strengthening names the class being entered, weakening names
             *  the class being fallen back to. */
            direction: is ? 'up' : 'down',
            category: cat,
            windKt: Number.isFinite(p.windKt) ? p.windKt : null,
          });
        }
        prev = cat;
      }
    }
  }

  /* ==> A STORM CAN CROSS TWO STEPS BETWEEN ONE PAIR OF FORECAST HOURS. <==
   * Measured on a synthetic curve going Cat 2 to depression in one six-hour
   * gap: the walk emitted "weakens to a tropical storm" AND "weakens to a
   * depression" at the same minute, which reads as the rail stuttering rather
   * than as a storm falling apart quickly.
   *
   * Only one of them describes where the storm ENDS UP, and that is the row
   * worth having: the deepest step for a collapse, the highest for a rapid
   * intensification. The intermediate crossing is real and is not news — the
   * reader learns "it is a depression now", not "it passed through tropical
   * storm on the way". */
  const byTime = new Map();
  for (const m of milestones) {
    const key = `${m.at}:${m.direction}`;
    const held = byTime.get(key);
    if (
      !held ||
      (m.direction === 'up' ? m.level > held.level : m.level < held.level)
    ) {
      byTime.set(key, m);
    }
  }
  const classMilestones = [...byTime.values()];

  /* THE PEAK IS A MILESTONE TOO, and it is the one that carries the number.
   * Only when it is still AHEAD — `when: 'now'` means the storm has already
   * peaked, which is a fact about the past and has no place on a countdown. */
  if (peak?.when === 'forecast' && peak.time) {
    const peakMs = Date.parse(peak.time);
    if (Number.isFinite(peakMs) && peakMs >= now) {
      const clash = classMilestones.some(
        (m) => Math.abs(m.at - peakMs) < HOME_DASH.peakMergeHours * MS_PER_HOUR
      );
      if (!clash) {
        classMilestones.push({
          kind: 'peak',
          at: peakMs,
          windKt: peak.windKt,
          category: categoryFromKt(peak.windKt),
        });
      }
    }
  }
  classMilestones.sort((a, b) => a.at - b.at);

  /* THE CORRIDOR — what actually reaches the house. Needs the published
   * quadrant radii as well as the track, so it is the one figure here that
   * can be absent while everything else is present: a bundle carrying a
   * forecast but no wind radii is normal for a weak or distant storm. */
  const corridor = hasCurve && (radii || []).length
    ? buildCorridor({ storm, forecast: curve, radii, home, now })
    : { ok: false, unavailable: hasCurve ? 'no-radii' : 'no-track', samples: [] };

  /* ==> THE STAGE. <== What the chip beside the storm's name says, and the one
   * word on this screen that has to be true at a glance.
   *
   * IT USED TO BE TWO WORDS FROM THE STORM LIST'S PICK — 'Bearing down' when
   * dead reckoning said closing, 'Nearest' otherwise. `Nearest` was a shrug
   * covering four unrelated situations: a storm sitting still, a storm past
   * 1,500 nm, a storm closing by less than the deadband, and EVERY GDACS
   * storm, because GDACS publishes no heading and the app could not tell "not
   * closing" from "cannot say". A cyclone bearing straight down on the house
   * wore the same word as one parked half an ocean away.
   *
   * WHY IT LIVES HERE AND NOT IN pickThreatStorm. The list ranks storms that
   * carry only a current position; only the dashboard has walked the track and
   * the wind fields, and every interesting rung below is a question about
   * those. `pending` is what the chip says before geometry arrives — deliberate
   * and honest, rather than showing a confident word and correcting it.
   *
   * ORDER IS THE RULE: most immediate first, first match wins. Nothing here is
   * inferred — each rung is a fact the bundle already holds. */
  const stage = (() => {
    /* ==> `pending` USED TO SWALLOW ALL FOUR NO-CURVE CASES. <== It is now
     * only the one it was always documented as: the fetch is genuinely still
     * running. The other three are rungs of their own, because a chip that
     * says "Checking…" about a question that has already been answered is
     * exactly the §5 failure this app is written against — and it is worse
     * than a static one now that the dots move. */
    if (!hasCurve) {
      return noCurveReason === 'no-track-loaded' ? 'pending'
        : noCurveReason === 'track-fetch-failed' ? 'track-failed'
        : 'no-track';
    }

    const w = corridor?.ok ? corridor.worst : null;
    const windows = w ? corridor.forecast[w].windows : [];
    const onHouseNow = windows.some(
      ([a, b]) => Date.parse(a) <= now && (!b || Date.parse(b) >= now)
    );
    if (onHouseNow) return 'wind-here';

    const cpaMs = approach?.time ? Date.parse(approach.time) : NaN;
    const cpaHours = Number.isFinite(cpaMs) ? (cpaMs - now) / MS_PER_HOUR : null;
    /* ==> "PASSING YOU NOW" HAS TO BE NEAR YOU AS WELL AS NOW. <== The first
     * cut asked only about the clock, and a storm whose nearest point on the
     * remaining track is 111 nm away and happening this minute wore "Passing
     * you now". Timing alone is not proximity. Both of the pass rungs are
     * gated on the same near ring the countdown already uses, so a storm that
     * was never close cannot claim to have just been. */
    const nearPass = approach && approach.nm <= HOME_DASH.nearRingNm;
    if (nearPass && cpaHours != null && Math.abs(cpaHours) <= 1) return 'overhead';
    /* ==> `afterCpaHours` FINALLY HAS A READER. <== It was declared with a
     * written intent — "after the storm is by, 'closest pass 4 hours ago' is
     * still the useful sentence" — and nothing in the app had ever referenced
     * it. That intent is exactly the difference between the hour after the eye
     * goes by, when the back half of the storm is still on you, and two days
     * later. Two rungs, not one. */
    if (nearPass && cpaHours != null && cpaHours < -1) {
      return cpaHours >= -HOME_DASH.afterCpaHours ? 'just-passed' : 'past';
    }

    const firstWind = windows.length ? Date.parse(windows[0][0]) : NaN;
    if (Number.isFinite(firstWind)) {
      const h = (firstWind - now) / MS_PER_HOUR;
      if (h <= HOME_DASH.imminentHours) return 'imminent';
      return 'bearing-down';
    }

    /* No wind forecast to reach the house at all. The remaining rungs are
     * about the CENTRE, and they are ordered by how much we can honestly
     * claim: no heading beats not-relevant beats receding. */
    if (!Number.isFinite(storm.headingDeg) || !Number.isFinite(storm.speedKt)) {
      return 'track-unknown';
    }
    if (approach && approach.relevant === false) return 'far-off';
    if (trend === 'receding') return 'past';
    return 'closing';
  })();

  return {
    ok: true,
    storm,
    home,
    now,

    /** Which rung of the ladder this storm is on, for the chip and for any
     *  sentence that has to change tense with it. See the block above. */
    stage,

    /**
     * ==> NOTHING THIS STORM DOES REACHES THIS HOUSE. <==
     *
     * The one boolean the view forks its whole layout on, and it exists
     * because the home drawer was built for a single job — a storm that could
     * hit you — and ran that machinery regardless. Closest pass, strength at
     * the pass, the arrival trend, the wind countdown, the 100-mile ring: all
     * of it is approach machinery, and pointed at a cyclone in the Philippine
     * Sea it produces sentences that are each arithmetically true and together
     * absurd. Seen on glass 2026-08-11 on PEILOU-26, 5,529 nm out: "At the
     * pass 23 mph", "It weakens on the way in", "Never comes within 100 mi of
     * you" — a reassurance about a storm that was never a candidate.
     *
     * TRUE ONLY WHEN THE TRACK HAS ARRIVED AND SAYS SO. `far-off` is the rung
     * that means the geometry was walked, no wind field reaches the house, and
     * `closestApproach` judged the whole remaining track irrelevant. A storm
     * still on `pending` is not far, it is unmeasured, and collapsing the
     * screen for it would hide figures that are about to appear.
     *
     * NOT A DISTANCE TEST HERE. The threshold lives in APPROACH.relevanceNm
     * and is applied once, where the track is walked. A second comparison at
     * this level is how two parts of one screen come to disagree about whether
     * the same storm matters.
     */
    far: stage === 'far-off',

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

    /** What the STORM does and when, ahead of the clock: crossings of the
     *  three named classification steps, plus the forecast peak. Ordered.
     *  Empty array, never null — a storm with a flat forecast has no
     *  milestones, which is a real answer and not a missing one. */
    milestones: classMilestones,

    /** The curve itself, for the chart. Empty array, never null — a chart with
     *  nothing to draw is a different render path from a chart that was handed
     *  a null and threw. */
    curve,

    /** WHY there is no forecast-derived figure, when there isn't one. The view
     *  turns each of these into a different sentence, per §5. `null` here means
     *  everything that could be computed was. Decided once, at the top of this
     *  function — see `noCurveReason` and the comment above it. */
    unavailable: noCurveReason,

    /* Same rule as data/home.js: the figures and the advisory they came from
     * are one object, so no caller can render the numbers without their age. */
    observedAt: storm.observedAt || null,
    advisoryKey: storm.advisoryKey || null,
  };
}

/** Re-exported so a caller needs one import for the whole dashboard, and so
 *  the relevance threshold cannot be restated somewhere else. */
export { APPROACH };
