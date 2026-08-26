/**
 * season-clock.js — what a season looks like at one moment in time. §57.23,
 * §57.30 step 10.
 *
 * ==> IT IS ARITHMETIC AND NOTHING ELSE. NO DOM, NO MAP, NO TIMER. <== The
 * clock is three separable things and this is the one that can be proven
 * right: given a storm and a moment, where had it got to. `seasons/clock-
 * engine.js` owns WHEN the moment advances and `map/layers/` owns what a
 * reader sees. Splitting it this way is what lets the hard part be tested
 * without a browser, which matters more here than usual — the sandbox cannot
 * open the basemap, so anything that needs the map cannot be checked at all
 * until it reaches Aaron's phone.
 *
 * ==> THE CURVE IS BUILT ONCE PER STORM AND CUT MANY TIMES. <== §57.35 fault 3
 * names running Catmull-Rom over a track every frame as the thing that will
 * sink the frame rate, and it is right: a long-lived storm is 400 vertices and
 * the clock steps ten times a second. `buildTimeline` is the expensive half and
 * it runs once; `cutTimeline` is a binary search and a slice.
 *
 * ==> AND A VERTEX'S TIME IS INTERPOLATED, NOT INVENTED. <== The smoothed curve
 * passes through every recorded fix (that is what `smoothPathIndexed`'s `index`
 * is for), so the vertices BETWEEN two fixes get times spread evenly across the
 * six hours those two fixes span. That is an assumption — a storm does not move
 * at a constant speed between observations — and it is the only assumption the
 * record supports. It is also the same one the drawn line already makes about
 * position, so the dot and the track can never disagree about where the storm
 * was.
 *
 * ==> IT READS `lonU`, LIKE EVERY OTHER ARCHIVE LAYER. <== `lib/hurdat.js`
 * carries both: `lon` is what NOAA published, inside ±180, and `lonU` is
 * continuous across the antimeridian. A clock built on `lon` would send a
 * west-Pacific storm's head dot flying the long way round the planet on the
 * one step where it crosses the seam.
 *
 * Imports config/ and lib/. Nothing imports back.
 */

import { SEASONS } from '../config/constants.js';
import { smoothPathIndexed } from './trackline.js';

/** A finite number, and not the `null` that a missing fix leaves behind. */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * One storm, ready to be cut at any moment.
 *
 * Returns null for a storm with nothing to draw over time — no points, or no
 * two points carrying a usable position AND a usable timestamp. That is not an
 * error: a 19th-century single sighting is a real record and it genuinely has
 * no duration. `map/layers/season-points.js` already gives it a standing dot,
 * and the clock leaves it alone rather than inventing a life for it.
 *
 * @param {object} storm  a parsed HURDAT2 / b-deck storm
 * @param {number} [maxVertices]
 * @returns {{coords:Array<[number,number]>, times:number[],
 *            startMs:number, endMs:number}|null}
 */
export function buildTimeline(storm, maxVertices = SEASONS.trackMaxVertices) {
  const usable = (storm?.points || []).filter(
    (p) => num(p?.lat) !== null && num(p?.lonU) !== null && num(p?.time) !== null
  );
  if (usable.length < 2) return null;

  const { curve, index, kept } = smoothPathIndexed(
    usable.map((p) => [p.lonU, p.lat]),
    maxVertices
  );
  if (!Array.isArray(curve) || curve.length < 2) return null;

  /* ==> THE ANCHORS ARE THE FIXES THAT SURVIVED SMOOTHING, IN ORDER. <== Two
   * fixes at the same position — a stalled storm, which is common — are merged
   * into one vertex by `dedupe`, so `kept` is shorter than `usable` and the
   * times have to be read THROUGH it. Reading them off `usable` directly is
   * the bug this whole `kept` business exists to stop, and it would only show
   * on storms that stall. */
  const anchorAt = [];
  const anchorTime = [];
  for (let j = 0; j < kept.length && j < index.length; j++) {
    const at = index[j];
    const t = usable[kept[j]]?.time;
    if (!Number.isInteger(at) || at < 0 || at >= curve.length || num(t) === null) continue;
    /* Monotonic or dropped. A record whose timestamps go backwards would
     * otherwise produce a curve that plays in two directions at once, and the
     * archive does contain revised storms. */
    if (anchorAt.length && (at <= anchorAt[anchorAt.length - 1] || t < anchorTime[anchorTime.length - 1])) continue;
    anchorAt.push(at);
    anchorTime.push(t);
  }
  if (anchorAt.length < 2) return null;

  /* ==> `spline` ALREADY ANCHORS THE LAST VERTEX, SO THERE IS NOTHING TO
   * PATCH ON THE END. <== It pushes the final point outside its leg loop and
   * pushes the matching offset into `index` first, so the last anchor is
   * always `curve.length - 1`. This file used to add a defensive extra anchor
   * for the case where it was not; a mutation run found the branch could never
   * execute, and `tools/season-clock-cost.mjs` measured a tail gap of zero on
   * all seven archived storms. Deleted rather than left in and untested (§12).
   * If `spline`'s ending ever changes, `buildTimeline`'s own assertion that
   * every vertex carries a time is what will report it. */

  const times = new Array(curve.length);
  for (let seg = 0; seg < anchorAt.length - 1; seg++) {
    const a0 = anchorAt[seg];
    const a1 = anchorAt[seg + 1];
    const t0 = anchorTime[seg];
    const t1 = anchorTime[seg + 1];
    const span = a1 - a0;
    for (let v = a0; v < a1; v++) {
      times[v] = span > 0 ? t0 + ((t1 - t0) * (v - a0)) / span : t0;
    }
  }
  /* Anything before the first anchor or after the last is clamped rather than
   * left undefined — `spline`'s phantom ends mean vertex 0 is always the first
   * fix, but a future change to the curve must not be able to leave a hole in
   * here that reads as `undefined < cut` and silently draws nothing. */
  for (let v = 0; v < times.length; v++) {
    if (num(times[v]) === null) times[v] = v < anchorAt[0] ? anchorTime[0] : anchorTime[anchorTime.length - 1];
  }

  return { coords: curve, times, startMs: times[0], endMs: times[times.length - 1] };
}

/**
 * How much of this track had happened by `cutMs`.
 *
 * Three answers, and they are three different states rather than shades of one
 * (§5): the storm has not formed yet, it is running, or it is over. The globe
 * draws each differently — nothing, a growing line with a bright head, a
 * complete line with no head — so collapsing "not yet" and "over" into "no
 * head" would put an unborn storm's full track on screen.
 *
 * @param {object|null} timeline  from `buildTimeline`
 * @param {number} cutMs
 * @returns {{state:'unborn'|'running'|'ended', coords:Array, head:[number,number]|null}}
 */
export function cutTimeline(timeline, cutMs) {
  const none = { state: 'unborn', coords: [], head: null };
  if (!timeline?.coords?.length || num(cutMs) === null) return none;

  const { coords, times } = timeline;
  if (cutMs < times[0]) return none;
  if (cutMs >= times[times.length - 1]) {
    return { state: 'ended', coords, head: null };
  }

  /* Binary search for the last vertex at or before the cut. Linear would be
   * fine for one storm and is not fine for thirty of them ten times a second,
   * which is the load this file was written against. */
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= cutMs) lo = mid; else hi = mid - 1;
  }

  /* ==> THE HEAD IS INTERPOLATED BETWEEN VERTICES AND THE TRAIL ENDS AT IT.
   * <== So the dot sits exactly on the end of its own line at every step
   * rather than running ahead of it or lagging behind — the two are the same
   * point, computed once. Without this the dot visibly detaches at 8-12 steps
   * a second, which is the cadence §57.35 fault 3 asks for. */
  const t0 = times[lo];
  const t1 = times[lo + 1];
  const f = t1 > t0 ? (cutMs - t0) / (t1 - t0) : 0;
  const a = coords[lo];
  const b = coords[lo + 1];
  const head = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

  return { state: 'running', coords: [...coords.slice(0, lo + 1), head], head };
}

/**
 * The clock's beginning and end.
 *
 * ==> IT IS THE TICKED STORMS' OWN SPAN, NOT THE SEASON'S. <== Aaron's call,
 * 2026-08-26. A season runs June to January and four ticked storms might all
 * live inside three weeks of September, so a clock spanning the calendar year
 * would be ninety percent empty globe with a date crawling across it. Running
 * only over what is actually drawn means every second of playback has
 * something in it.
 *
 * The cost, written down because it is real: ticking a fifth storm can move
 * both ends of the timeline, so the scrub bar's scale changes under the
 * reader. That is the honest trade for not watching an empty ocean, and it is
 * only noticeable while paused.
 *
 * @param {Array<{timeline:object|null}>} tracks
 * @returns {{startMs:number, endMs:number}|null}  null when nothing is drawn
 */
export function clockSpan(tracks = []) {
  let startMs = null;
  let endMs = null;
  for (const t of tracks) {
    const tl = t?.timeline;
    if (!tl || num(tl.startMs) === null || num(tl.endMs) === null) continue;
    if (startMs === null || tl.startMs < startMs) startMs = tl.startMs;
    if (endMs === null || tl.endMs > endMs) endMs = tl.endMs;
  }
  if (startMs === null || endMs === null) return null;
  /* A single-fix span is a real possibility — one storm, ticked, whose whole
   * record is six hours. A zero-width clock would divide by zero in the scrub
   * bar, so it is refused here rather than guarded in three places. */
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

/**
 * How far the clock moves in one step, in milliseconds of storm time.
 *
 * ==> THE STEP IS THE PRODUCT OF TWO SEPARATE DIALS AND THEY MEAN DIFFERENT
 * THINGS. <== `daysPerSecond` is how fast the season reads — a taste question,
 * Aaron's. `stepsPerSecond` is how often MapLibre is handed new geometry — a
 * cost question, and the one §57.35 fault 3 caps. Multiplying them here keeps
 * anybody from "speeding up playback" by raising the step rate, which would
 * change the price rather than the pace.
 */
export function msPerStep(daysPerSecond, stepsPerSecond) {
  const dps = num(daysPerSecond);
  const sps = num(stepsPerSecond);
  if (dps === null || sps === null || sps <= 0) return 0;
  return (dps * 86400000) / sps;
}

/**
 * A fingerprint of what the trail geometry currently is.
 *
 * ==> IT SKIPS A TRAIL PUSH WHEN NOTHING CROSSED A VERTEX — AND HOW OFTEN
 * THAT IS DEPENDS ENTIRELY ON HOW MANY STORMS ARE TICKED. <== §57.35 fault 3
 * asks for the trail to grow in chunks. This is the mechanism, and the honest
 * account of what it buys, counted off the real 2005 file by
 * `tools/season-clock-cost.mjs`:
 *
 *   one storm     100% of steps push — the guard saves NOTHING
 *   four storms    55%              — 45% skipped
 *   whole season   69%              — 31% skipped
 *
 * A single 325-vertex track played at a day a second crosses about six
 * vertices per step, so it is always changing. What makes the guard worth
 * having is that most storms in a ticked set are unborn or already over at any
 * given moment, and those contribute an unchanged fingerprint. **It is a
 * saving on quiet steps, not a general reduction in push rate**, and the
 * earlier version of this comment claimed otherwise.
 *
 * It counts VERTICES rather than hashing coordinates. The head moves within a
 * segment on every step and a coordinate hash would therefore always differ,
 * which would make this a very expensive way to always say yes.
 *
 * The head dots are a separate, tiny source and are pushed unconditionally —
 * that is the half that has to move smoothly.
 */
export function trailFingerprint(cuts = []) {
  let out = '';
  for (const c of cuts) out += `${c?.id || ''}:${c?.state || ''}:${c?.coords?.length || 0}|`;
  return out;
}
