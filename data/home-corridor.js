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
import { coneErrorNm, coneSeasonOfStorm } from '../lib/cone-error.js';
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

  /* ==> A FORECAST POINT OLDER THAN THE STORM'S POSITION IS NOT A FORECAST.
   * <== NHC's tau 0 is the SYNOPTIC ANALYSIS, and an advisory is issued up to
   * three hours after it — so on every intermediate advisory the first
   * "forecast" point is timestamped BEFORE the position the same advisory
   * reports. Walked as given, the track then runs three hours backwards from
   * now and forwards again over the same span: the same stretch drawn twice,
   * a flat spur where the two meet, and — because the window is measured from
   * the first sample — geometry rendered outside the axis. Measured on Ida's
   * Advisory 7A: fifteen samples at negative time, down to -3.00 h, and a
   * chart that painted to x=19.9 in a plot starting at x=30.
   *
   * THE FIX IS THE RULE THE REST OF THE SCREEN ALREADY FOLLOWS (§8): past
   * points are skipped and the current position is the one deliberate
   * exception, because it is the anchor. Dropping the stale POINT costs
   * nothing — the radii are keyed by tau, not by point, so tau 0's wind field
   * is still there for the current position, which already carries tau 0.
   *
   * A point with no readable time is KEPT. Unknown is not past, and dropping
   * it would silently shorten the track (§5).
   *
   * SPEC-UI §8 named this behaviour of NHC's and nothing acted on it. Bertha
   * could not show it: her fixture's taus are transcribed from issuance, so
   * her tau 0 and her position are the same instant. */
  const anchorMs = storm.observedAt ? Date.parse(storm.observedAt) : NaN;
  const ahead = (p) => {
    if (!Number.isFinite(anchorMs) || !p.time) return true;
    const t = Date.parse(p.time);
    return !Number.isFinite(t) || t > anchorMs;
  };

  const points = [
    { lon: storm.lon, lat: storm.lat, time: storm.observedAt, tau: 0 },
    ...forecast.filter(ahead),
  ].filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat) && p.time);
  if (points.length < 2) return [];

  /* densifyTrack carries `t` — the fractional index along the input array —
   * which is exactly what is needed to interpolate the radii of the two
   * bracketing points rather than snapping to the nearer one. */
  const walked = densifyTrack(points, 12);
  /* Read once rather than per sample — it is a property of the storm, not of
   * the hour, and `earliest` is built from it at every step. */
  const season = coneSeasonOfStorm(storm);
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
      coneNm: coneErrorNm(Math.max(0, (ms - now) / MS_PER_HOUR), storm.basin, season),
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
 * THE PAST ARM (§49.9)
 * ------------------------------------------------------------------------- */

/**
 * The same measurement, backwards: how far each wind field reached toward home
 * at every ANALYSED hour of the storm's life so far.
 *
 * ==> WHY THIS IS SEPARATE FROM sampleCorridor AND NOT A FLAG ON IT. <== The
 * forecast walk is keyed on `tau` and anchored to the storm's current
 * position; this one is keyed on an instant and anchored to nothing, because
 * every point on it is a measurement. Threading a mode through one function
 * would put four `if (past)` branches inside the block that decides whether a
 * threshold was published, which is the block a §5 failure hides in.
 *
 * ==> A MEASUREMENT IS NOT A FORECAST AND CARRIES NO CONE. <== There is
 * deliberately no `coneNm` on these samples and no `gapEarly` built from them.
 * NHC's track-error circle describes how wrong a FORECAST tends to be; drawn
 * around a position the storm was analysed at it is fabricated uncertainty,
 * the same rule §49.2 already applies to the past closest pass.
 *
 * Returns the same `{h, time, nm, brg, reach, gap}` shape the forward samples
 * carry, so `crossings()` walks it with no changes and the chart plots it with
 * one `X`/`Y` pair.
 */
export function samplePastCorridor({ past, pastRadii, home = getHome(), now = Date.now() }) {
  if (!home || !Array.isArray(past) || past.length === 0) return [];

  /* Quadrant sets keyed by the instant they were analysed at. */
  const byTime = new Map();
  for (const r of pastRadii || []) {
    if (!r?.time) continue;
    const ms = Date.parse(r.time);
    if (!Number.isFinite(ms)) continue;
    if (!byTime.has(ms)) byTime.set(ms, {});
    byTime.get(ms)[r.kt] = { ne: r.ne, se: r.se, sw: r.sw, nw: r.nw };
  }
  if (byTime.size === 0) return [];

  /* ==> A FIX STAMPED AHEAD OF THE CLOCK IS NOT HISTORY. <== Same rule
   * `closestPassed` and the chart's past series already apply: an observed
   * position in the future is a source error, and a wind field hung on one
   * would draw "this already happened" to the right of `now`. */
  const points = past
    .filter((p) => Number.isFinite(p?.lon) && Number.isFinite(p?.lat) && p.time)
    .filter((p) => {
      const t = Date.parse(p.time);
      return Number.isFinite(t) && t <= now;
    });
  if (points.length < 2) return [];

  const walked = densifyTrack(points, 12);
  const out = [];

  for (const w of walked) {
    const ms = Date.parse(w.time);
    if (!Number.isFinite(ms)) continue;

    const nm = greatCircleNm(home.lon, home.lat, w.lon, w.lat);
    const brg = bearingDeg(w.lon, w.lat, home.lon, home.lat);

    const i = Math.floor(w.t);
    const f = w.t - i;
    const ta = points[i]?.time ? Date.parse(points[i].time) : NaN;
    const tb = points[i + 1]?.time ? Date.parse(points[i + 1].time) : NaN;
    const a = byTime.get(ta);
    /* ==> NO FALLBACK TO `a`, FOR THE REASON THE FORWARD WALK LEARNED. <== A
     * threshold that stops being published has stopped. Carrying the last
     * analysed field forward across an hour NHC published nothing for would
     * draw wind nobody measured, and it would look right because the bearing
     * keeps changing. Same rule, same absence, stated twice on purpose. */
    const b = byTime.get(tb);

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

    out.push({ h: (ms - now) / MS_PER_HOUR, time: w.time, nm, brg, reach, gap });
  }
  return out;
}

/**
 * Everything the past arm's sentence needs: which thresholds were measured,
 * when each was on the house, and how far back the app can honestly speak.
 *
 * ==> THE HORIZON IS PART OF THE ANSWER, NOT A FOOTNOTE. <== NHC's past wind
 * field and NHC's past track do not have to reach back equally far, and when
 * the field is the shorter of the two, "no wind reached you" is only true back
 * to where the field starts. `coveredFrom` is that instant, and any sentence
 * claiming nothing reached the house has to be able to say it (§49.9's
 * `[DECIDE]`). Silence there would be an all-clear about hours nobody measured.
 */
export function buildPastCorridor({ past, pastRadii, home = getHome(), now = Date.now() } = {}) {
  const samples = samplePastCorridor({ past, pastRadii, home, now });
  if (samples.length === 0) return null;

  const published = THRESHOLDS.filter((kt) => samples.some((s) => s.reach[kt] != null));
  if (published.length === 0) return null;

  const cross = {};
  for (const kt of THRESHOLDS) cross[kt] = crossings(samples, 'gap', kt);

  /* The strongest field that was actually ON the house — what the past-tense
   * sentence is about. Null is a real answer: it means the storm's wind was
   * measured and it missed. */
  const worst = [...THRESHOLDS].reverse().find((kt) => cross[kt]?.everInside) ?? null;

  /* The first sample carrying any measured field. Samples before it exist —
   * the track reaches further back than the wind field — and they are honestly
   * unmeasured rather than clear. */
  const first = samples.find((s) => THRESHOLDS.some((kt) => s.reach[kt] != null));

  /* ==> AN UNMEASURED HOUR ONLY MATTERS IF THE STORM COULD HAVE REACHED YOU IN
   * IT. <== Almost every storm has one: NHC publishes no wind radii while a
   * system is a depression, so the observed track essentially always starts
   * before the wind field does. Ida's gap is six hours, with the storm 600 nm
   * away in the Caribbean. Hedging every storm's sentence for that is the
   * furniture §48.5 warns about — a caveat printed so often it stops being
   * read, on the one sentence that most needs reading.
   *
   * So the question asked is narrower and answerable: during the unmeasured
   * stretch, was the storm ever close enough that its wind COULD have been on
   * the house? The yardstick is the storm's OWN largest measured 34 kt reach
   * toward this home. A system that never threw tropical-storm wind further
   * than 90 nm cannot have put any on a house 600 nm away, whatever nobody
   * measured. Self-calibrating, so there is no constant to guess at, and
   * generous in the safe direction — the biggest field a storm ever had is
   * larger than the one it had while it was still a depression. */
  let maxReach = 0;
  for (const s of samples) if (s.reach[34] != null) maxReach = Math.max(maxReach, s.reach[34]);
  const firstMs = first ? Date.parse(first.time) : Infinity;
  const partial = !!first && samples.some(
    (s) => Date.parse(s.time) < firstMs && s.nm <= maxReach
  );

  return {
    samples,
    published,
    cross,
    worst,
    /** ISO instant of the earliest measured wind field. A sentence about what
     *  did NOT reach the house is only true back to here. */
    coveredFrom: first?.time || null,
    /** True when the wind field starts later than the observed track AND the
     *  storm was close enough during the gap for the missing hours to matter.
     *  This is the flag that makes a sentence say its own horizon out loud. */
    partial,
    /** The largest measured 34 kt reach toward this home, nm. The yardstick
     *  `partial` is judged against, returned so a test can state it rather
     *  than recompute it. */
    maxReachNm: maxReach,
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
export function buildCorridor({
  storm, forecast, radii, past, pastRadii, home = getHome(), now = Date.now(),
} = {}) {
  /* ==> BUILT FIRST, BECAUSE IT DECIDES WHETHER AN ABSENT FORECAST IS FATAL.
   * <== NHC stops issuing wind radii late in a storm's life — Ida's Advisory
   * 19 publishes none — and this function used to return `ok: false` for that,
   * which made `homeChart` return an empty string, which is why a storm that
   * had just gone over the house was the one storm with no picture at all. The
   * past arm is a complete answer to "did dangerous wind reach me" on its own. */
  const pastArm = buildPastCorridor({ past, pastRadii, home, now });

  const samples = sampleCorridor({ storm, forecast, radii, home, now });
  if (samples.length === 0) {
    if (pastArm) return pastOnly(pastArm, home, now, storm, (radii || []).length ? 'no-track' : 'no-radii');
    return { ok: false, unavailable: (radii || []).length ? 'no-track' : 'no-radii', samples: [], past: null };
  }

  /* The pessimistic twin: same geometry, wind fields shifted toward the house
   * by the track error. Stored under `gapEarly` so `crossings` can walk it
   * with the identical code path — one implementation, two readings. */
  /* ==> NO ERROR TABLE, NO HEDGE — AND THAT IS NOT THE SAME AS A ZERO ONE.
   * <== `coneErrorNm` returns null for every basin NHC does not forecast (see
   * CONE_CIRCLE_BASIN: the west Pacific, both Indian oceans, the south
   * Pacific, Australia), because lending them the Atlantic's numbers would be
   * fabricating an error bar and signing NHC's name to it. This line read
   * `s.coneNm ?? 0`, which quietly turned that refusal into a shift of zero —
   * so `gapEarly` came out IDENTICAL to `gap`, `crossings` found the same
   * windows in both, and the screen would have drawn the dashed
   * earliest-arrival line exactly on top of the band edge it is supposed to
   * hedge, plus a Timeline row saying wind could start at the moment it
   * already says it starts.
   *
   * Nothing on an NHC storm moves: all three of NHC's basins have tables, so
   * `coneNm` is never null there and this is the same arithmetic it always
   * was. It only fires on the storms that reached this function for the first
   * time in §49.16. */
  for (const s of samples) {
    s.gapEarly = {};
    for (const kt of THRESHOLDS) {
      s.gapEarly[kt] = s.gap[kt] == null || s.coneNm == null ? null : s.gap[kt] - s.coneNm;
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
    if (pastArm) return pastOnly(pastArm, home, now, storm, 'no-radii');
    return { ok: false, unavailable: 'no-radii', samples: [], past: null };
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

  /* ==> AND THE STRONGEST ONE THAT IS ON THE HOUSE AT THIS MINUTE, WHICH IS
   * NOT THE SAME QUESTION. <== The ladder and the sentence both used to ask
   * whether `worst`'s window contained `now`, which silently means "is the
   * WORST wind here yet". On a storm whose 34 kt field arrived three hours ago
   * and whose 64 kt core is still five hours out, the honest answer to "is
   * wind on my house" is yes and the answer that was computed was no — so the
   * chip read *Hours away* while tropical-storm-force wind was blowing, and
   * the sentence stayed in the future tense through the stretch this screen
   * exists for. Reproduced on Ida's Advisory 014 read three hours after issue,
   * which is an ordinary polling state, not an edge case.
   *
   * Kept as a THRESHOLD rather than a boolean, because every caller needs to
   * name which wind it is talking about. A sentence that says "wind is on your
   * house now" while `worst` is 64 kt would be promising a hurricane. */
  const here = [...THRESHOLDS].reverse().find((kt) =>
    (forecastCross[kt]?.windows || []).some(
      ([a, b]) => Date.parse(a) <= now && (!b || Date.parse(b) >= now)
    )
  ) ?? null;

  /* ==> HAS ANY WIND ALREADY ARRIVED, ON THIS FORECAST? <== Separate from
   * `here`, because a window that opened AND closed before now is still wind
   * that reached the house — and a screen that then says "no wind has reached
   * you" is contradicting its own rail two inches lower. */
  const begun = THRESHOLDS.some((kt) =>
    (forecastCross[kt]?.windows || []).some(([a]) => Date.parse(a) <= now)
  );

  return {
    ok: true,
    /** True when NHC published a FORECAST wind field to walk. False on a
     *  past-only corridor, where `worst`, `forecast` and `earliest` say
     *  nothing and any sentence reading them would be inventing an all-clear.
     *  Every renderer that touches the forward figures tests this. */
    forwardOk: true,
    samples,
    /** Per threshold, from NHC's published forecast alone. */
    forecast: forecastCross,
    /** Per threshold, with the track error applied. OURS, not NHC's. */
    earliest,
    worst,

    /** The strongest threshold whose forecast window contains `now`, or null.
     *  What "is wind on my house" actually means, as opposed to "is the WORST
     *  wind here yet" — see the block above for the storm that made the
     *  difference matter. */
    here,

    /** True when any threshold's window opened at or before `now`. A window
     *  that has already opened AND closed still counts: that is wind which
     *  reached the house, and a sentence denying it contradicts the rail. */
    begun,

    /** The wind that ALREADY reached the house (§49.9), or null when the
     *  source published no past wind field — which for GDACS is always, and
     *  is a fact about GDACS rather than a failure of ours. */
    past: pastArm,
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

/**
 * A corridor built from the past arm alone.
 *
 * ==> IT IS `ok`, AND EVERY FORWARD FIGURE ON IT IS EMPTY ON PURPOSE. <== The
 * screen has a real answer to give — dangerous wind reached this house, here
 * is when it started and when it lifted — so returning `ok: false` and drawing
 * nothing is the §5 failure, not the safe option. But `worst` is null and
 * `forecast` is empty, and a renderer that reads those without checking
 * `forwardOk` would print "no tropical-storm wind reaches you" about a storm
 * whose forecast wind field was never published. That sentence would be an
 * all-clear derived from an absence, which is the exact thing §49.9 exists to
 * delete. Hence `forwardOk: false` and `unavailable` kept populated: the
 * reason the forward half is missing survives into the view.
 */
function pastOnly(pastArm, home, now, storm, why) {
  return {
    ok: true,
    forwardOk: false,
    unavailable: why,
    samples: [],
    forecast: { 34: null, 50: null, 64: null },
    earliest: { 34: null, 50: null, 64: null },
    worst: null,
    /* Nobody published a forecast wind field, so there is no forecast window
     * to be inside of and none to have opened. Both are absences, not falses
     * about the weather, and `forwardOk` is what says which. */
    here: null,
    begun: false,
    published: [],
    past: pastArm,
    home,
    now,
    observedAt: storm?.observedAt || null,
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
