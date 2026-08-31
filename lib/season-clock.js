/**
 * season-clock.js — where every ticked storm was at a given moment. §57.23,
 * §57.67 slice A.
 *
 * ==> NOTHING IN HERE DRAWS, TIMES ANYTHING, OR TOUCHES THE DOM. <== It is
 * arithmetic over a set of finished tracks: hand it the storms the reader has
 * ticked and a moment, and it answers where each of them was, how strong, what
 * it was being called at the time, which way it was travelling, and how much of
 * its track had happened yet. The scrubber, the play loop, the map layer and
 * the 3D head are all separate files and all of them ask this one.
 *
 * ==> THAT SEPARATION IS THE WHOLE POINT AND IT IS A RESPONSE TO A REVERT. <==
 * Step 10 was built once, on 2026-08-26, as a single commit holding the engine,
 * the controls, the globe cut, the colouring and the keyboard. It reached
 * Aaron's phone showing an empty world, one round of fixes did not fix it, and
 * the lot was reverted. Three defects had landed together with nothing to
 * bisect. This file is the piece that can be proven right on its own, with no
 * browser and no glass call, so that when something does go wrong later it is
 * not one of the suspects.
 *
 * ==> AND ONE OF THOSE THREE DEFECTS WAS IN HERE, IN A FORM NOTHING COULD SEE.
 * <== The old loop paced itself on real elapsed milliseconds and divided by a
 * storm-time step of 8,640,000. Both quantities are milliseconds, the division
 * is correct in isolation, and the result was that the clock owed its first
 * step after two and a half hours of somebody watching a still globe. The units
 * are the only thing that disagreed and no language, test or console message
 * says a word about units. So the conversion is ONE named ratio below, applied
 * in exactly two functions, and the suite asserts the round trip in both
 * directions.
 *
 * WHAT IT DOES NOT DO, DELIBERATELY:
 *
 * - **No colour.** It answers `nature` and `category`; what those look like is
 *   a palette question and the palette is forced sepia inside the archive
 *   (`seasons/index.js`). A hex resolved in here would be resolved at the wrong
 *   time by the wrong file, which is the shape `SPEC-MAP.md` rule 1b warns
 *   about.
 * - **No smoothing.** The curve through a storm's fixes is cached per storm by
 *   `map/layers/season-tracks.js` and it never changes as the clock runs
 *   (§57.35 fault 3). This file answers in RAW FIX INDICES, which is the one
 *   coordinate system both the raw points and the smoothed curve can agree on.
 * - **No timer.** `stepRealMs()` says how often a caller should ask; the asking
 *   is the caller's business.
 *
 * Imports `config/`, `lib/geo.js`, `lib/category.js` and `lib/season-nature.js`
 * only. One direction, no cycles (§12).
 */

import { SEASONS } from '../config/constants.js';
import { bearingDeg } from './geo.js';
import { categoryFromKt } from './category.js';
import { firstCycloneTime, natureAt } from './season-nature.js';

/** One day in milliseconds. Written once rather than as `86400000` at four
 *  call sites, because a mistyped zero in one of them is exactly the class of
 *  fault this file exists to have caught. */
const DAY_MS = 86_400_000;

/**
 * ==> THE ONE PLACE REAL TIME AND STORM TIME MEET. <==
 *
 * How many milliseconds of storm time one millisecond of real time buys. At
 * `clockDaysPerSecond: 1` that is 86,400 — a real second is a storm day.
 *
 * Every conversion in this app goes through `toStormMs` / `toRealMs` below,
 * and those two are the only functions permitted to touch this number. That is
 * not tidiness: the reverted attempt's bug was a division written inline with
 * the operands the wrong way round, and a division written inline is invisible.
 * A named function with a named unit in its name is not.
 */
const STORM_MS_PER_REAL_MS = (SEASONS.clockDaysPerSecond * DAY_MS) / 1000;

/**
 * Real milliseconds elapsed → storm milliseconds advanced.
 *
 * @param {number} realMs  wall-clock milliseconds, e.g. from `performance.now()`
 * @returns {number} milliseconds of storm time
 */
export function toStormMs(realMs) {
  return Number.isFinite(realMs) ? realMs * STORM_MS_PER_REAL_MS : 0;
}

/**
 * Storm milliseconds → how long they take to play, in real milliseconds.
 *
 * The inverse of `toStormMs`, and it exists so the scrubber can say how long a
 * season takes to watch without any caller re-deriving the ratio.
 *
 * @param {number} stormMs
 * @returns {number} wall-clock milliseconds
 */
export function toRealMs(stormMs) {
  return Number.isFinite(stormMs) ? stormMs / STORM_MS_PER_REAL_MS : 0;
}

/**
 * How often the play loop should ask this file for a new answer, in real
 * milliseconds. §57.35 fault 3 — discrete steps, never per frame.
 *
 * @returns {number}
 */
export function stepRealMs() {
  return 1000 / SEASONS.clockStepsPerSecond;
}

/**
 * The fixes a clock can use out of one storm.
 *
 * ==> IT FILTERS ON `lonU` RATHER THAN `lon`, LIKE EVERY OTHER SEASONS
 * CONSUMER. <== `lonU` is the continuous longitude `lib/hurdat.js` fills in, so
 * a storm crossing the antimeridian carries on past ±180 instead of snapping
 * back. Interpolating between the wrapped values would send the head the long
 * way round the planet at the seam — the same failure `SPEC-MAP.md` §7.12
 * fault 3 records the wind swath having, and it costs nothing to not repeat.
 *
 * ==> AND IT SORTS RATHER THAN TRUSTING THE ORDER. <== HURDAT2 is written in
 * order and the parser preserves it, so this is normally a no-op. It is here
 * because everything below assumes time increases, and an assumption that is
 * true by convention rather than by construction is the kind that holds until
 * a second source arrives — step 13 brings IBTrACS through this same shape.
 */
function usableFixes(storm) {
  const pts = (storm?.points || []).filter((p) => (
    Number.isFinite(p?.lat) && Number.isFinite(p?.lonU) && Number.isFinite(p?.time)
  ));
  return pts.slice().sort((a, b) => a.time - b.time);
}

/**
 * The window the timeline covers, over the storms the reader has ticked.
 *
 * ==> IT IS THE TICKED STORMS' OWN SPAN, NOT THE CALENDAR YEAR. <== Aaron's
 * call, 2026-08-26, kept from the reverted attempt because it was right and was
 * never the reason that build failed. Four storms living inside three weeks of
 * September would otherwise mean a timeline that is ninety percent empty ocean
 * with a date crawling across it.
 *
 * **The cost of that, accepted then and still true: ticking a fifth storm moves
 * both ends**, so a moment held on the old timeline means a different date on
 * the new one. The caller resets rather than carrying it across.
 *
 * @param {Array<{storm:object}>} entries  the roster's ticked set
 * @returns {{from:number, to:number, spanMs:number, realMs:number}|null}
 *   `null` when nothing ticked has a usable fix in it.
 */
export function clockSpan(entries = []) {
  let from = Infinity;
  let to = -Infinity;

  for (const entry of entries) {
    const pts = usableFixes(entry?.storm);
    if (!pts.length) continue;
    if (pts[0].time < from) from = pts[0].time;
    if (pts[pts.length - 1].time > to) to = pts[pts.length - 1].time;
  }

  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;

  /* ==> A SPAN SHORTER THAN THE FLOOR IS WIDENED AROUND ITS OWN MIDDLE. <==
   * A one-fix storm spans zero milliseconds, and a timeline with no length
   * divides by zero on the first drag. That is not an edge case in this
   * archive: single-observation entries run all through the 19th century, and
   * ticking exactly one of them is an ordinary thing for a reader to do.
   *
   * Widening symmetrically rather than padding the end is what puts that single
   * observation in the MIDDLE of the scrubber, where it reads as one moment
   * somebody wrote down. Pinned to the left edge it would read as a storm that
   * started and then stopped being reported, which is a different claim. */
  const floor = SEASONS.clockMinSpanDays * DAY_MS;
  if (to - from < floor) {
    const mid = (from + to) / 2;
    from = mid - floor / 2;
    to = mid + floor / 2;
  }

  const spanMs = to - from;
  return { from, to, spanMs, realMs: toRealMs(spanMs) };
}

/**
 * Linear interpolation, guarded against a zero-length leg.
 *
 * Two fixes sharing a timestamp are real — ATCF puts one line per wind
 * threshold and `lib/hurdat.js` merges them, but a merge that fails leaves two
 * — and `(t - a) / 0` is `Infinity`, which propagates into a position off the
 * planet with nothing thrown.
 */
function lerp(a, b, f) {
  if (!Number.isFinite(a)) return Number.isFinite(b) ? b : null;
  if (!Number.isFinite(b)) return a;
  return a + (b - a) * f;
}

/**
 * Grade one moment the same way the globe's dots grade a fix.
 *
 * ==> IT ANSWERS `nature` AND `category`, NEVER A COLOUR. <== See the file
 * header. `map/layers/season-points.js` turns exactly this pair into a hue and
 * a two-character code, and the head glyph will do the same with the same pair,
 * so the two can never disagree about what a storm WAS while disagreeing about
 * how to draw it.
 *
 * ==> THE STATUS COMES FROM THE FIX BEHIND THE HEAD AND IS NEVER
 * INTERPOLATED. <== `HU` half way to `EX` is not a thing. §57.7g settled that a
 * dot is graded from the status column rather than from the wind, and a status
 * holds until the record says otherwise — so a head between two fixes carries
 * the earlier one's label while its wind slides toward the later one's number.
 * That is what the record actually claims.
 */
function gradeMoment(windKt, status, time, bornAt) {
  const nature = natureAt(status, time, bornAt);
  const category = nature === 'tropical' && Number.isFinite(windKt)
    ? categoryFromKt(windKt)
    : null;
  return { nature, category };
}

/**
 * Which way a cyclone at this latitude turns, as a sign a renderer can spin by.
 *
 * `+1` counter-clockwise, `-1` clockwise. Northern-hemisphere cyclones rotate
 * counter-clockwise and southern-hemisphere ones clockwise, which is Coriolis
 * and is not negotiable by anything in the file.
 *
 * ==> IT IS HERE BECAUSE STEP 13 BRINGS THE SOUTHERN HEMISPHERE. <== Every
 * storm in this archive today is Atlantic or East Pacific, so every one of them
 * is `+1` and a hardcoded direction would look correct for as long as that is
 * true. IBTrACS ends it, and a glyph spinning backwards over Australia is the
 * kind of wrong that only somebody who knows storms would catch.
 */
function spinSign(lat) {
  return lat < 0 ? -1 : 1;
}

/**
 * Where one storm was at one moment.
 *
 * ==> THE ANSWER IS IN RAW FIX INDICES, NOT IN A FRACTION OF THE DRAWN CURVE.
 * <== `drawnFixes` is how many recorded positions have happened, and
 * `legFraction` is how far between that one and the next the moment sits. The
 * track layer holds a smoothed curve of up to 400 vertices built from those
 * same fixes and knows which vertex came from which fix, so it can cut its
 * cached curve without rebuilding it — which is §57.35 fault 3's rule about
 * never re-smoothing per step. Answering in a fraction of the curve instead
 * would tie this file to a smoothing budget it has no business knowing about.
 *
 * @param {object} storm  a parsed HURDAT2 storm
 * @param {number} t      the moment, epoch ms
 * @returns {{
 *   phase: 'absent'|'unborn'|'running'|'ended',
 *   drawnFixes: number, legFraction: number,
 *   lon: number|null, lat: number|null,
 *   windKt: number|null, status: string|null,
 *   nature: string|null, category: number|null,
 *   headingDeg: number|null, spin: number|null,
 * }}
 */
export function stormStateAt(storm, t) {
  const none = {
    phase: 'absent',
    drawnFixes: 0,
    legFraction: 0,
    lon: null,
    lat: null,
    windKt: null,
    status: null,
    nature: null,
    category: null,
    headingDeg: null,
    spin: null,
  };

  const pts = usableFixes(storm);
  if (!pts.length || !Number.isFinite(t)) return none;

  const bornAt = firstCycloneTime(pts);
  const last = pts[pts.length - 1];

  /* ==> BEFORE THE FIRST FIX THE STORM DRAWS NOTHING AT ALL. <== Not a dot at
   * its birthplace, not a one-vertex stub. §57.23's accumulation only means
   * something if the globe genuinely starts empty, and the reverted attempt's
   * empty world was partly this: it handed the globe a two-point stub and
   * three unborn storms and the reader saw a blank sepia sphere with `4 shown`
   * written under it. */
  if (t < pts[0].time) return { ...none, phase: 'unborn' };

  /* ==> AFTER THE LAST FIX THE WHOLE TRACK STAYS AND THE HEAD GOES. <== The
   * ghost trail persisting is the feature (§57.23), and a head left standing on
   * the final fix would say the storm is still there. `drawnFixes` is the full
   * count so the line is complete; the position fields stay filled because the
   * panel and the readout still want to know where it ended, and `phase` is
   * what a renderer keys the glyph off. */
  if (t >= last.time) {
    const grade = gradeMoment(last.windKt, last.status, last.time, bornAt);
    const prev = pts.length > 1 ? pts[pts.length - 2] : null;
    return {
      phase: 'ended',
      drawnFixes: pts.length,
      legFraction: 0,
      lon: last.lonU,
      lat: last.lat,
      windKt: Number.isFinite(last.windKt) ? last.windKt : null,
      status: last.status || null,
      nature: grade.nature,
      category: grade.category,
      headingDeg: prev ? bearingDeg(prev.lonU, prev.lat, last.lonU, last.lat) : null,
      spin: spinSign(last.lat),
    };
  }

  /* The leg the moment falls inside. A linear scan rather than a binary search:
   * a HURDAT2 storm is a few dozen fixes and the caller asks ten times a
   * second for a handful of storms, so this is a few hundred comparisons a
   * second against the map worker's re-index — measure before optimising it. */
  let i = 0;
  while (i + 1 < pts.length && pts[i + 1].time <= t) i++;

  const a = pts[i];
  const b = pts[i + 1];
  const legMs = b.time - a.time;
  /* ==> THE ZERO GUARD IS UNREACHABLE TODAY AND IS KEPT ANYWAY, WHICH IS ONLY
   * DEFENSIBLE BECAUSE IT SAYS SO. <== The scan above walks past every fix at
   * or before the moment, so the fix it stops on cannot share a timestamp with
   * the next one — `legMs` is always positive given a sorted list. Deleting
   * this check leaves `tools/test-season-clock.mjs` green, which was measured
   * on 2026-08-31 rather than assumed, and no test in this repo covers it.
   *
   * It stays as a floor under step 13: IBTrACS carries twelve agencies'
   * opinions of one storm (§57.31) and a merge that leaves two rows on one
   * timestamp with a different sort order reaches this line. `(t - a) / 0` is
   * `Infinity`, which propagates into a position off the planet with nothing
   * thrown — the silent kind. One comparison is the right price for that. */
  const f = legMs > 0 ? (t - a.time) / legMs : 0;

  const windKt = lerp(a.windKt, b.windKt, f);
  const grade = gradeMoment(windKt, a.status, t, bornAt);

  return {
    phase: 'running',
    /* `i + 1` fixes are behind the head: fix 0 through fix `i` inclusive. */
    drawnFixes: i + 1,
    legFraction: f,
    lon: lerp(a.lonU, b.lonU, f),
    lat: lerp(a.lat, b.lat, f),
    windKt: Number.isFinite(windKt) ? windKt : null,
    status: a.status || null,
    nature: grade.nature,
    category: grade.category,
    headingDeg: bearingDeg(a.lonU, a.lat, b.lonU, b.lat),
    spin: spinSign(a.lat),
  };
}

/**
 * Every ticked storm's grade at every one of its own fixes.
 *
 * ==> THIS IS WHAT MAKES A TRACK CHANGE COLOUR ALONG ITS LENGTH. <== Aaron's
 * call, 2026-08-31: while the clock is engaged the track behind the head is
 * Saffir-Simpson coloured at the correct timestamps rather than painted in one
 * peak hue.
 *
 * ==> AND IT IS A REVERSAL OF A DECISION THAT IS STILL CORRECT, WHICH IS WORTH
 * NAMING RATHER THAN QUIETLY OVERWRITING. <== `map/layers/season-tracks.js`
 * colours a whole track by its PEAK and its comment explains why: per-segment
 * is the truer picture and it is also a rainbow, because every storm starts
 * blue and ends blue, so four of them on one globe read as four identical
 * smears. That argument is about a STATIC globe showing four finished storms at
 * once, and it still holds there. The clock is a different screen — one moment,
 * usually one or two storms growing, and the reader is watching a storm change
 * rather than comparing four of them. **Peak stays the default and per-fix is
 * what the clock switches on**, so neither answer has to be wrong.
 *
 * @param {object} storm
 * @returns {Array<{time:number, nature:string, category:number|null}>}
 *   one entry per usable fix, in time order.
 */
export function stormGrades(storm) {
  const pts = usableFixes(storm);
  if (!pts.length) return [];
  const bornAt = firstCycloneTime(pts);
  return pts.map((p) => ({
    time: p.time,
    ...gradeMoment(p.windKt, p.status, p.time, bornAt),
  }));
}

/**
 * The whole globe at one moment: every ticked storm's state, keyed by id.
 *
 * ==> ONE CALL RATHER THAN A LOOP AT EVERY CALL SITE, FOR THE REASON
 * `setTracks` IS ONE CALL. <== `main.js`'s archive facade already documents it:
 * the moment a screen has to make two calls to stay consistent, it can make
 * one and be silently wrong. The tracks, the heads and the date readout all
 * read one frame.
 *
 * ==> STORMS WITH NO USABLE FIX ARE STILL IN THE ANSWER, AS `absent`. <== A
 * caller iterating this and a caller iterating the ticked set must not get
 * different lengths — that difference is how a storm ends up drawn with nobody
 * responsible for erasing it.
 *
 * @param {Array<{storm:object}>} entries
 * @param {number} t
 * @returns {{at:number, storms:Array<{id:string, entry:object, state:object}>}}
 */
export function clockFrameAt(entries = [], t) {
  return {
    at: t,
    storms: entries.map((entry) => ({
      id: entry?.storm?.id ?? null,
      entry,
      state: stormStateAt(entry?.storm, t),
    })),
  };
}

export const __internals = {
  STORM_MS_PER_REAL_MS,
  DAY_MS,
  usableFixes,
  gradeMoment,
  spinSign,
  lerp,
};
