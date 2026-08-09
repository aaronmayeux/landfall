/**
 * home-corridor.js — how far each wind threshold reaches TOWARD home, over time.
 *
 * ==> THE ONE CHART THAT ANSWERS THE QUESTION THE APP CLAIMS TO ANSWER. <==
 *
 * Everything else on the home screen is about where the storm's CENTRE goes.
 * The centre is not what hurts anybody. This module measures the distance from
 * home to the nearest EDGE of each wind field — 34, 50 and 64 knots — at every
 * step along the forecast, and finds when each of those edges crosses the
 * house.
 *
 * WHY IT MATTERS, MEASURED ON A REAL STORM. Bertha's Advisory 10, against a
 * New Orleans home: at every one of NHC's published 12-hourly forecast points
 * the 34 kt edge misses the house by at least 17 nm. Interpolate along the
 * track and it crosses the house for two and a half hours. The published
 * points alone say "no tropical-storm winds here" and that is wrong — the same
 * class of error as snapping a ring crossing to a sample, and for the same
 * reason: a boundary sampled every twelve hours is a boundary you will miss.
 *
 * ==> A WIND FIELD IS NOT A CIRCLE, AND TREATING IT AS ONE INVERTS THE ANSWER.
 * <== Bertha's 34 kt winds reached 100 nm southeast and 40 nm northwest of the
 * same centre. New Orleans sat northwest — her narrow flank — which is the
 * only reason a 48 nm pass produced two hours of wind instead of six. A
 * mean-radius model would have got that backwards. So every reach here is
 * measured along the bearing that actually points at the house, blended
 * between quadrant centres by `radiusAtBearing` (the same function the drawn
 * swath uses, so the picture and the number cannot disagree).
 *
 * WHAT IS OURS AND NOT NHC'S — read this before rendering anything from here.
 * `earliest` composes two separate NHC products: their track-error circle and
 * their wind radii. Shifting the whole wind field toward home by the track
 * error is how a forecaster reasons, but NHC publishes no such figure. It is
 * therefore returned as a SEPARATE FIELD with its own name, never merged into
 * the forecast arrival, and the UI states it as a range and never as a time.
 *
 * Imports: config/, lib/ and data/home.js. No UI, no map, no fetching.
 */

import { HOME_DASH } from '../config/constants.js';
import { greatCircleNm, bearingDeg, densifyTrack } from '../lib/geo.js';
import { radiusAtBearing } from '../lib/windswath.js';
import { coneErrorNm } from '../lib/cone-error.js';
import { getHome } from './home.js';

const MS_PER_HOUR = 3_600_000;

/** Ascending, because a reader meets them in this order and because the
 *  bands nest: 64 kt is inside 50, which is inside 34. */
export const THRESHOLDS = Object.freeze([34, 50, 64]);

/* ---------------------------------------------------------------------------
 * SAMPLING
 * ------------------------------------------------------------------------- */

/**
 * Walk the track and, at every sample, measure the distance from home to the
 * storm centre and to the nearest edge of each published wind field.
 *
 * RADII ARE INTERPOLATED BETWEEN FORECAST HOURS, QUADRANT BY QUADRANT, and
 * only where BOTH ends publish that threshold. A threshold that stops being
 * published has stopped: NHC saying nothing about 50 kt winds at tau 45 is a
 * statement that there are none, not a gap to be bridged from tau 33. Fading
 * one out would draw wind the source did not forecast (§5).
 *
 * Returns `[{h, nm, reach: {34: nm|null, 50: …, 64: …}, gap: {…}, coneNm}]`
 * where `reach` is how far that field extends toward home and `gap` is how far
 * home is from its edge — negative meaning home is INSIDE it.
 */
export function sampleCorridor({ storm, forecast, radii, home = getHome(), now = Date.now() }) {
  if (!home || !storm || !Array.isArray(forecast) || forecast.length === 0) return [];

  /* Quadrant sets keyed by tau, so a track point can find its own radii. */
  const byTau = new Map();
  for (const r of radii || []) {
    if (!byTau.has(r.tau)) byTau.set(r.tau, {});
    byTau.get(r.tau)[r.kt] = { ne: r.ne, se: r.se, sw: r.sw, nw: r.nw };
  }

  const points = [
    { lon: storm.lon, lat: storm.lat, time: storm.observedAt, tau: 0 },
    ...forecast,
  ].filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat) && p.time);
  if (points.length < 2) return [];

  /* densifyTrack carries `t` — the fractional index along the input array —
   * which is exactly what is needed to interpolate the radii of the two
   * bracketing points rather than snapping to the nearer one. */
  const walked = densifyTrack(points, 12);
  const out = [];

  for (const w of walked) {
    const ms = Date.parse(w.time);
    if (!Number.isFinite(ms)) continue;

    const nm = greatCircleNm(home.lon, home.lat, w.lon, w.lat);
    /* FROM THE STORM TOWARD HOME. The inverse bearing would read the radius
     * on the far side of the storm — the quadrant pointing away from the
     * house — which on an asymmetric field is the wrong number entirely and
     * looks completely plausible. */
    const brg = bearingDeg(w.lon, w.lat, home.lon, home.lat);

    const i = Math.floor(w.t);
    const f = w.t - i;
    const a = byTau.get(points[i]?.tau);
    /* ==> NO `|| a` FALLBACK HERE, AND THAT ABSENCE IS LOAD-BEARING. <==
     * It was there, and it smeared the last published radii across every
     * later leg: Bertha's 34 kt field stops at tau 45, and the corridor was
     * carrying it out to tau 57 — drawing tropical-storm winds through hours
     * NHC forecast none for. The values even LOOKED right, because the
     * bearing keeps changing so the reach kept moving. Caught by a mutation
     * run, not by review. A tau that published nothing published nothing. */
    const b = byTau.get(points[i + 1]?.tau);

    const reach = {};
    const gap = {};
    for (const kt of THRESHOLDS) {
      const qa = a?.[kt];
      const qb = b?.[kt];
      let r = null;
      if (qa && qb) {
        r = radiusAtBearing(
          {
            ne: qa.ne + (qb.ne - qa.ne) * f,
            se: qa.se + (qb.se - qa.se) * f,
            sw: qa.sw + (qb.sw - qa.sw) * f,
            nw: qa.nw + (qb.nw - qa.nw) * f,
          },
          brg
        );
      } else if (qa && f === 0) {
        r = radiusAtBearing(qa, brg);
      }
      reach[kt] = r;
      gap[kt] = r == null ? null : nm - r;
    }

    out.push({
      h: (ms - now) / MS_PER_HOUR,
      time: w.time,
      nm,
      brg,
      reach,
      gap,
      coneNm: coneErrorNm(Math.max(0, (ms - now) / MS_PER_HOUR), storm.basin),
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * CROSSINGS
 * ------------------------------------------------------------------------- */

/**
 * When does a gap series cross zero, and for how long is it under?
 *
 * INTERPOLATED, NOT SNAPPED, and the direction of that error is the reason.
 * A sample can only be found inside a boundary after the boundary is already
 * behind it, so snapping always reports an arrival LATE — and "you have
 * another hour" is the one direction a preparation figure must never be wrong
 * in. Same rule as the near-ring window in data/home-dashboard.js.
 *
 * Returns `null` when the threshold is never published, and an object with
 * `everInside: false` when it is published and simply never reaches. Those are
 * different facts and the screen says different things about them.
 */
export function crossings(samples, key = 'gap', kt = 34) {
  const pts = samples.filter((s) => s[key]?.[kt] != null);
  if (pts.length === 0) return null;

  const windows = [];
  let open = null;
  let prev = null;

  const at = (a, b) => {
    const ga = a[key][kt];
    const gb = b[key][kt];
    const ta = Date.parse(a.time);
    const tb = Date.parse(b.time);
    if (!Number.isFinite(ta) || !Number.isFinite(tb) || ga === gb) return b.time;
    const f = Math.min(1, Math.max(0, ga / (ga - gb)));
    return new Date(ta + (tb - ta) * f).toISOString();
  };

  for (const s of pts) {
    const inside = s[key][kt] <= 0;
    if (prev && inside !== (prev[key][kt] <= 0)) {
      if (inside) open = at(prev, s);
      else if (open) { windows.push([open, at(prev, s)]); open = null; }
    } else if (!prev && inside) {
      open = s.time; // already inside at the first sample
    }
    prev = s;
  }
  /* ==> STILL INSIDE WHEN THE PUBLISHED SERIES ENDS. <==
   *
   * Found by a fabricated Cat 3, not by Bertha — her 34 kt field outlives her
   * approach, so this branch never fired on the only real storm available.
   * The synthetic case publishes 64 kt radii to tau 24 and none after, with
   * home still inside at the last one.
   *
   * The window is CLOSED at that last published moment and flagged, rather
   * than left null. Leaving it null produced `totalHours: 0` beside
   * `everInside: true` — a contradiction that renders as "hurricane-force
   * winds reach your home for under an hour", which is the worst of both
   * readings.
   *
   * Closing there slightly UNDERSTATES the duration, and understating how
   * long dangerous wind lasts is the unsafe direction — so `openEnded` says
   * the end time is a floor, and the UI words it "through at least" rather
   * than "eases at". A threshold vanishing from later forecast hours does
   * mean NHC forecasts no more of it (spec-parameter §37.5, the same rule
   * that makes a published zero real data); what it does not pin is the
   * minute it stopped. */
  let openEnded = false;
  if (open) {
    windows.push([open, pts[pts.length - 1].time]);
    openEnded = true;
  }

  const deepest = pts.reduce((m, s) => (s[key][kt] < m[key][kt] ? s : m), pts[0]);

  return {
    kt,
    everInside: windows.length > 0,
    windows,
    /** True when the last window was closed by the forecast running out of
     *  published radii rather than by the field leaving. The end time is a
     *  FLOOR, and any sentence built on it has to say so. */
    openEnded,
    /** Closest the edge gets, nm. Negative means it passed over the house;
     *  positive means this is the margin by which it missed. */
    closestGapNm: deepest[key][kt],
    closestAt: deepest.time,
    totalHours: windows.reduce(
      (sum, [a, b]) => sum + (b ? (Date.parse(b) - Date.parse(a)) / MS_PER_HOUR : 0),
      0
    ),
  };
}

/* ---------------------------------------------------------------------------
 * THE WHOLE CORRIDOR
 * ------------------------------------------------------------------------- */

/**
 * Everything the corridor chart and its sentences need.
 *
 * `earliest` IS OURS AND IS LABELLED AS SUCH. It re-runs the crossing test
 * with every wind field pulled toward home by NHC's two-thirds track error at
 * that hour — the honest reading of "the centre could be this much closer, so
 * the wind could reach you this much sooner". Both inputs are NHC's; the
 * composition is not, and it is the only figure on the home screen that
 * neither agency publishes. It is kept in its own key so no renderer can show
 * it without having asked for it by name.
 */
export function buildCorridor({ storm, forecast, radii, home = getHome(), now = Date.now() } = {}) {
  const samples = sampleCorridor({ storm, forecast, radii, home, now });
  if (samples.length === 0) {
    return { ok: false, unavailable: (radii || []).length ? 'no-track' : 'no-radii', samples: [] };
  }

  /* The pessimistic twin: same geometry, wind fields shifted toward the house
   * by the track error. Stored under `gapEarly` so `crossings` can walk it
   * with the identical code path — one implementation, two readings. */
  for (const s of samples) {
    s.gapEarly = {};
    for (const kt of THRESHOLDS) {
      s.gapEarly[kt] = s.gap[kt] == null ? null : s.gap[kt] - (s.coneNm ?? 0);
    }
  }

  /* ==> NO PUBLISHED FIELD IS "WE CANNOT SAY", NOT "NOTHING REACHES YOU". <==
   * sampleCorridor happily walks a track with no radii at all and returns a
   * full set of samples whose every reach is null. Left alone that lands in
   * the caller as a healthy corridor with nothing in it, and the screen says
   * "no tropical-storm winds reach your home" about a storm whose wind field
   * we never received. That is the §5 failure this whole module is supposed
   * to be on the right side of, and it was live until a test asked. */
  const published = THRESHOLDS.filter((kt) => samples.some((s) => s.reach[kt] != null));
  if (published.length === 0) {
    return { ok: false, unavailable: 'no-radii', samples: [] };
  }

  const forecastCross = {};
  const earliest = {};
  for (const kt of THRESHOLDS) {
    forecastCross[kt] = crossings(samples, 'gap', kt);
    earliest[kt] = crossings(samples, 'gapEarly', kt);
  }

  /* The strongest threshold that reaches the house at all — the one the
   * headline is about. Null when none of them do, which is a real answer. */
  const worst = [...THRESHOLDS].reverse().find((kt) => forecastCross[kt]?.everInside) ?? null;

  return {
    ok: true,
    samples,
    /** Per threshold, from NHC's published forecast alone. */
    forecast: forecastCross,
    /** Per threshold, with the track error applied. OURS, not NHC's. */
    earliest,
    worst,
    /** Which thresholds the source published at all, so the chart draws a
     *  band for a real field and stays silent about the rest. An empty
     *  three-band frame reads as three fields of zero. Never empty — that
     *  case returns `ok: false` above. */
    published,
    home,
    now,
    observedAt: storm.observedAt || null,
  };
}

/** Should this threshold's band be drawn at all?
 *
 *  A BAND FOR A FIELD THAT NEVER COMES NEAR IS NOISE. Most storms, most of the
 *  time, are nowhere near anybody's house, and three nested translucent bands
 *  hugging the top of the frame say nothing while making the two useful lines
 *  harder to read. Drawn when the field is published AND its edge comes within
 *  the near ring of home at some point — the same threshold the countdown
 *  already uses, so the chart and the list agree about what counts as near. */
export function bandVisible(corridor, kt) {
  if (!corridor?.ok || !corridor.published.includes(kt)) return false;
  const c = corridor.forecast[kt];
  if (!c) return false;
  return c.everInside || c.closestGapNm <= HOME_DASH.nearRingNm;
}
