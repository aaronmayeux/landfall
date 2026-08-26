/**
 * test-season-clock.mjs — the season clock's arithmetic and its engine.
 * §57.23, §57.30 step 10.
 *
 * ==> IT RUNS AGAINST REAL STORMS OUT OF `samples/seasons/storms/`, NOT
 * INVENTED ONES. <== §57.30 step 2 learned this the expensive way: the step 0
 * probe's sample was 1851-1859, a decade with no modern feature in it, and a
 * parser tested against it would have been tested against nothing. The storms
 * driven below were each cut for a reason and the reasons matter here —
 * KATRINA has several landfalls and a long life, CP011957 crosses the
 * antimeridian, AL021971 carries a fix with no assigned intensity, AL011851 is
 * fourteen rows from the first storm in the record.
 *
 * ==> AND THE ENGINE IS DRIVEN WITH A FAKE CLOCK AND A FAKE `rAF`. <== That is
 * the whole reason `createClockEngine` takes them as arguments. Timing is the
 * one thing this feature can be wrong about that a reader would not see as an
 * error — a clock that catches up after a backgrounded tab just looks like a
 * season that went past quickly — so it is the thing most worth pinning down
 * where it can be pinned down at all. The sandbox cannot open the basemap, so
 * anything needing MapLibre is Aaron's phone's to judge, not this file's.
 *
 * Zero dependencies, plain node.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };
const eq = (what, got, want) => ok(
  `${what}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`,
  JSON.stringify(got) === JSON.stringify(want)
);
const near = (what, got, want, tol) => ok(
  `${what}\n     got:  ${got}\n     want: ${want} ±${tol}`,
  Number.isFinite(got) && Math.abs(got - want) <= tol
);

const { parseHurdat2 } = await import('../lib/hurdat.js');
const {
  buildTimeline, cutTimeline, clockSpan, msPerStep, trailFingerprint,
} = await import('../lib/season-clock.js');
const { smoothPathIndexed } = await import('../lib/trackline.js');
const { createClockEngine } = await import('../seasons/clock-engine.js');
const { formatArchiveMoment } = await import('../lib/season-clock-words.js');
const { SEASONS } = await import('../config/constants.js');

const storm = (file) => {
  const { storms } = parseHurdat2(readFileSync(join(ROOT, 'samples', 'seasons', 'storms', file), 'utf8'));
  return storms[0];
};

const seasonStorms = (file) => parseHurdat2(
  readFileSync(join(ROOT, 'samples', 'seasons', 'seasons', file), 'utf8')
).storms;

const KATRINA = storm('al122005.txt');
const DELLA = storm('cp011957.txt');
const FIRST = storm('al011851.txt');
const NOINT = storm('al021971.txt');

const HOUR = 3600000;

/* ---------------------------------------------------------------------------
 * 1. A TIMELINE SPANS EXACTLY WHAT THE RECORD SPANS.
 *
 * Not a rounded version of it and not the smoothed curve's idea of it. If the
 * clock's ends do not match the fixes' ends then either a storm appears before
 * NOAA saw it or it vanishes while the record still has rows in it, and both
 * are the §5 fault of showing something we cannot back.
 * ------------------------------------------------------------------------ */

{
  const tl = buildTimeline(KATRINA);
  ok('Katrina builds a timeline', Boolean(tl));
  eq('and it starts at her first recorded fix', tl.startMs, KATRINA.points[0].time);
  eq('and it ends at her last', tl.endMs, KATRINA.points[KATRINA.points.length - 1].time);

  ok('every vertex carries a time', tl.times.length === tl.coords.length);
  ok('and there are no holes in them', tl.times.every((t) => Number.isFinite(t)));

  /* ==> MONOTONIC, WHICH IS THE PROPERTY THE BINARY SEARCH IN `cutTimeline`
   * DEPENDS ON. <== A search over a non-monotonic array does not throw, it
   * silently answers the wrong vertex — so the storm would jump backwards for
   * one step somewhere in the middle of its life and nothing would report it. */
  let rising = true;
  for (let i = 1; i < tl.times.length; i++) if (tl.times[i] < tl.times[i - 1]) rising = false;
  ok('and they never go backwards', rising);
}

/* ---------------------------------------------------------------------------
 * 2. THE THREE STATES ARE THREE STATES (§5).
 *
 * Unborn, running, ended. Collapsing the first and the last into "no head" is
 * the mistake worth guarding: it would put an unborn storm's COMPLETE track on
 * the globe, which is the clock showing something that had not happened yet.
 * ------------------------------------------------------------------------ */

{
  const tl = buildTimeline(KATRINA);

  const before = cutTimeline(tl, tl.startMs - HOUR);
  eq('an hour before she formed she is unborn', before.state, 'unborn');
  eq('and nothing at all is drawn', before.coords.length, 0);
  eq('and there is no head', before.head, null);

  const after = cutTimeline(tl, tl.endMs + HOUR);
  eq('an hour after she ended she is ended', after.state, 'ended');
  eq('and the WHOLE track is drawn', after.coords.length, tl.coords.length);
  eq('and there is still no head', after.head, null);

  const mid = cutTimeline(tl, (tl.startMs + tl.endMs) / 2);
  eq('halfway through she is running', mid.state, 'running');
  ok('and part of the track is drawn', mid.coords.length > 1 && mid.coords.length < tl.coords.length);
  ok('and there is a head', Array.isArray(mid.head) && mid.head.length === 2);

  /* ==> THE HEAD IS THE LAST POINT OF ITS OWN TRAIL. <== They are computed
   * once and shared for exactly this reason: at 10 steps a second a dot that
   * is derived separately from the line visibly detaches from it.
   *
   * ==> AND IT IS ASSERTED ACROSS HER WHOLE LIFE, NOT AT ONE MOMENT. <== The
   * first version checked the halfway point only, and a mutation that dropped
   * the head off the end of the trail SURVIVED it — because at that particular
   * moment the cut happened to land on a vertex, where the interpolated head
   * and the last vertex are the same coordinate by definition. One sample of a
   * per-step property proves nothing about the steps it did not sample. */
  const stepA = msPerStep(SEASONS.clockDaysPerSecond, SEASONS.clockStepsPerSecond);
  let detached = 0;
  let midSegment = 0;
  for (let t = tl.startMs; t <= tl.endMs; t += stepA) {
    const c = cutTimeline(tl, t);
    if (c.state !== 'running') continue;
    const tip = c.coords[c.coords.length - 1];
    if (tip[0] !== c.head[0] || tip[1] !== c.head[1]) detached++;
    /* Count the steps that land BETWEEN two vertices — the ones where the two
     * can actually differ. If this is zero the assertion above is vacuous. */
    if (tip[0] !== tl.coords[c.coords.length - 2]?.[0]) midSegment++;
  }
  eq('and the head is the end of the trail at every single step', detached, 0);
  ok(`and most steps land between vertices, so that meant something\n     got:  ${midSegment} mid-segment steps`,
    midSegment > 10);
}

/* ---------------------------------------------------------------------------
 * 3. THE TRAIL ONLY EVER GROWS.
 *
 * Walked across Katrina's whole life at the shipping cadence. A storm whose
 * drawn track got SHORTER for one step would read as the line flickering, and
 * it is the kind of fault that only appears on one storm at one moment.
 * ------------------------------------------------------------------------ */

{
  const tl = buildTimeline(KATRINA);
  const step = msPerStep(SEASONS.clockDaysPerSecond, SEASONS.clockStepsPerSecond);
  let last = 0;
  let shrank = false;
  let sawRunning = 0;
  for (let t = tl.startMs; t <= tl.endMs; t += step) {
    const cut = cutTimeline(tl, t);
    if (cut.state === 'running') sawRunning++;
    if (cut.coords.length < last) shrank = true;
    last = cut.coords.length;
  }
  ok('the trail never gets shorter across her whole life', !shrank);
  ok('and she is running for most of the walk', sawRunning > 20);
}

/* ---------------------------------------------------------------------------
 * 4. THE DATELINE, AND IT IS THE FAULT THIS PROJECT KEEPS FINDING.
 *
 * Hurricane Della, CP011957, crosses ±180 in the archive's own data. §57.21a
 * already had to fix a track drawn through raw `lon` and NOW.md carries a
 * whole entry about a wind swath that wrapped the planet for the same reason.
 * A clock reading `lon` instead of `lonU` would fling the head dot the long
 * way round on the single step where she crosses.
 * ------------------------------------------------------------------------ */

{
  const tl = buildTimeline(DELLA);
  ok('Della builds a timeline', Boolean(tl));

  const lons = tl.coords.map((c) => c[0]);
  const spread = Math.max(...lons) - Math.min(...lons);
  ok(`her drawn track spans a sane width, not most of the planet\n     got:  ${spread.toFixed(2)}°`,
    spread < 180);

  /* Step across her whole life and watch the head. One step is at most a few
   * degrees of longitude for a real storm; a seam fault shows as a jump of
   * hundreds. */
  const step = msPerStep(SEASONS.clockDaysPerSecond, SEASONS.clockStepsPerSecond);
  let worst = 0;
  let prev = null;
  for (let t = tl.startMs; t <= tl.endMs; t += step) {
    const cut = cutTimeline(tl, t);
    if (cut.state !== 'running') continue;
    if (prev) worst = Math.max(worst, Math.abs(cut.head[0] - prev[0]));
    prev = cut.head;
  }
  ok(`and her head never teleports across the seam\n     got:  ${worst.toFixed(3)}° in one step`, worst < 5);

  /* ==> AND SHE ACTUALLY GOES PAST ±180, OR THIS SECTION PROVES NOTHING. <==
   * The assertions above would all pass on a storm that never approached the
   * line. This is what makes them a test of the seam rather than a test of
   * arithmetic that happens not to have been exercised. */
  ok('and she genuinely crosses the antimeridian',
    Math.max(...lons) > 180 || Math.min(...lons) < -180);
}

/* ---------------------------------------------------------------------------
 * 5. A STORM WITH NO DURATION IS REFUSED, NOT FAKED.
 *
 * §57.30 step 6a gave a one-record storm a standing dot rather than a line,
 * because a single 19th-century sighting is a real record with no duration in
 * it. The clock has nothing to say about such a storm and must say so, so that
 * `seasons/index.js` can leave its track drawn whole at every moment instead
 * of deleting it from the globe.
 * ------------------------------------------------------------------------ */

{
  eq('a storm with no points has no timeline', buildTimeline({ points: [] }), null);
  /* ==> A SINGLE FIX IS REFUSED TWICE AND THAT IS DELIBERATE. <== The
   * `usable.length < 2` gate catches it, and so does the `curve.length < 2`
   * gate after smoothing. A mutation loosening the first one SURVIVES, because
   * the second one still answers null — which is belt and braces rather than a
   * test hole, and is written down here so the next mutation run does not
   * spend an hour rediscovering it. */
  eq('nor does one with a single fix',
    buildTimeline({ points: [{ time: 1, lat: 20, lonU: -60 }] }), null);
  eq('nor does a missing storm', buildTimeline(null), null);

  /* A fix carrying no position is dropped, and two of them leave nothing. */
  eq('a storm whose fixes have no position has no timeline',
    buildTimeline({ points: [
      { time: 1, lat: null, lonU: null },
      { time: 2, lat: null, lonU: null },
      { time: 3, lat: null, lonU: null },
    ] }), null);

  /* ==> BUT A STORM WITH NO WIND READING STILL GETS ONE. <== AL021971 carries
   * a `-99` row — no intensity ever assigned. That is a fact about the
   * strength column and it has nothing to do with whether the storm moved, so
   * refusing it here would silently drop real storms out of playback. */
  ok('a storm with an unassigned intensity still plays', Boolean(buildTimeline(NOINT)));
}

/* ---------------------------------------------------------------------------
 * 5b. TWO SHAPES NO FIXTURE HAS, BUILT ON PURPOSE.
 *
 * ==> THIS IS THE SAME MOVE §57.30 STEP 2 HAD TO MAKE AND FOR THE SAME REASON.
 * <== Two of its nine mutations stayed green because Ida cannot exhibit the
 * behaviour they guarded, and the fix was a synthetic storm built to be the
 * shape no real one is. Two mutations here survived the same way, and both
 * are guards that only fire on data the seven archived storms do not contain:
 *
 *   - A STALLED storm, where two consecutive fixes share a position. `dedupe`
 *     inside `smoothPathIndexed` merges those into one vertex, so the times
 *     have to be read through `kept` rather than off the fix array directly.
 *     Measured: all seven fixtures drop zero fixes, so `kept` is the identity
 *     on every one of them and the indirection is never exercised.
 *   - A storm whose timestamps go BACKWARDS, which a revised record can do.
 *     Without the monotonic guard the binary search in `cutTimeline` answers
 *     the wrong vertex — silently, not by throwing — and the storm jumps
 *     backwards for one step somewhere in its life.
 * ------------------------------------------------------------------------ */

{
  const H = 6 * 3600000;
  /* Fixes 2 and 3 are at the identical position: the storm sat still for six
   * hours, which real storms do. `dedupe` will merge them. */
  const stalled = { id: 'SYNTH1', points: [
    { time: 0,     lat: 20.0, lonU: -60.0, windKt: 35 },
    { time: H,     lat: 21.0, lonU: -61.0, windKt: 45 },
    { time: 2 * H, lat: 21.0, lonU: -61.0, windKt: 55 },
    { time: 3 * H, lat: 22.0, lonU: -62.0, windKt: 65 },
    { time: 4 * H, lat: 23.0, lonU: -63.0, windKt: 75 },
  ] };

  /* The premise first, or the assertions below are about nothing. */
  const raw = stalled.points.map((p) => [p.lonU, p.lat]);
  const { kept } = smoothPathIndexed(raw, 400);
  ok(`the stalled storm really does lose a fix to dedupe\n     got:  ${kept.length} kept of ${raw.length}`,
    kept.length < raw.length);

  const tl = buildTimeline(stalled);
  ok('and it still builds a timeline', Boolean(tl));
  eq('which starts at its first fix', tl.startMs, 0);
  /* ==> THE ONE THAT BITES. <== Read off the fix array directly rather than
   * through `kept`, the last vertex takes fix 3's time instead of fix 4's, so
   * the storm ends six hours early and its final leg never draws. */
  eq('and ENDS at its last, not one fix short of it', tl.endMs, 4 * H);

  let rising = true;
  for (let i = 1; i < tl.times.length; i++) if (tl.times[i] < tl.times[i - 1]) rising = false;
  ok('and its times still never go backwards', rising);

  /* A record whose times go backwards. The guard drops the offending anchor
   * rather than letting it into the search. */
  const jumbled = { id: 'SYNTH2', points: [
    { time: 0,     lat: 20.0, lonU: -60.0 },
    { time: H,     lat: 21.0, lonU: -61.0 },
    { time: 0.5 * H, lat: 22.0, lonU: -62.0 },
    { time: 3 * H, lat: 23.0, lonU: -63.0 },
    { time: 4 * H, lat: 24.0, lonU: -64.0 },
  ] };
  const tj = buildTimeline(jumbled);
  ok('a storm with a backwards timestamp still builds', Boolean(tj));
  let rising2 = true;
  for (let i = 1; i < tj.times.length; i++) if (tj.times[i] < tj.times[i - 1]) rising2 = false;
  ok('and the guard leaves its vertex times monotonic anyway', rising2);

  /* ==> AND THE SEARCH THAT DEPENDS ON IT ANSWERS SANELY. <== The property
   * that actually matters: walk the storm and confirm the trail only grows.
   * Non-monotonic times do not throw, they make the binary search wrong. */
  let shrank = false;
  let last = 0;
  for (let t = tj.startMs; t <= tj.endMs; t += 600000) {
    const c = cutTimeline(tj, t);
    if (c.coords.length < last) shrank = true;
    last = c.coords.length;
  }
  ok('and the trail never goes backwards on it', !shrank);
}

/* ---------------------------------------------------------------------------
 * 6. THE SPAN IS THE TICKED STORMS' OWN (Aaron's call, 2026-08-26).
 * ------------------------------------------------------------------------ */

{
  const tracks = [
    { timeline: buildTimeline(KATRINA) },
    { timeline: buildTimeline(FIRST) },
  ];
  const span = clockSpan(tracks);
  ok('two storms give a span', Boolean(span));
  eq('which starts at the earlier of the two',
    span.startMs, Math.min(tracks[0].timeline.startMs, tracks[1].timeline.startMs));
  eq('and ends at the later',
    span.endMs, Math.max(tracks[0].timeline.endMs, tracks[1].timeline.endMs));

  eq('nothing ticked is no span at all', clockSpan([]), null);
  eq('and a storm the clock refused does not make one', clockSpan([{ timeline: null }]), null);

  /* ==> A ZERO-WIDTH SPAN IS REFUSED RATHER THAN SHIPPED. <== The scrub bar
   * divides by the span's width, so a single-moment clock would put a NaN in
   * the slider's position and the control would go somewhere arbitrary. */
  eq('and a span with no width is refused',
    clockSpan([{ timeline: { startMs: 5, endMs: 5 } }]), null);
}

/* ---------------------------------------------------------------------------
 * 7. THE TWO DIALS MEAN DIFFERENT THINGS (§57.35 fault 3).
 *
 * The trap this guards is somebody "speeding up playback" by raising the step
 * rate — which changes the price and not the pace, and is precisely the change
 * that section exists to forbid.
 * ------------------------------------------------------------------------ */

{
  near('a day a second at ten steps is 8.64 s of storm time per step',
    msPerStep(1, 10), 8640000, 1);
  eq('doubling the STEP rate halves the distance each step covers',
    msPerStep(1, 20), msPerStep(1, 10) / 2);
  eq('doubling the DAY rate doubles it', msPerStep(2, 10), msPerStep(1, 10) * 2);
  eq('a nonsense cadence yields no movement rather than Infinity', msPerStep(1, 0), 0);
  eq('and so does a missing one', msPerStep(null, 10), 0);

  ok('the shipped step rate is inside fault 3\'s 8-12 band',
    SEASONS.clockStepsPerSecond >= 8 && SEASONS.clockStepsPerSecond <= 12);
}

/* ---------------------------------------------------------------------------
 * 8. THE FINGERPRINT IS WHAT MAKES THE TRAIL GROW IN CHUNKS.
 *
 * §57.35 fault 3 asks for the big source to be rewritten in chunks and the
 * dots to move every step. This is the mechanism, so it has to be shown doing
 * both halves: identical when nothing crossed a vertex, different when
 * something did.
 * ------------------------------------------------------------------------ */

{
  const tl = buildTimeline(KATRINA);
  const step = msPerStep(SEASONS.clockDaysPerSecond, SEASONS.clockStepsPerSecond);
  const mid = (tl.startMs + tl.endMs) / 2;

  const a = cutTimeline(tl, mid);
  const b = cutTimeline(tl, mid + step);
  const fa = trailFingerprint([{ id: 'x', ...a }]);
  const fb = trailFingerprint([{ id: 'x', ...b }]);

  /* The head HAS moved between these two — that is the half that must always
   * be pushed. */
  ok('the head moves every step', a.head[0] !== b.head[0] || a.head[1] !== b.head[1]);

  /* ==> MEASURED, AND THE FIRST VERSION OF THIS ASSERTION WAS WRONG ABOUT ITS
   * OWN SUBJECT. <== It walked ONE storm and expected the trail to sometimes
   * hold still. It never does: a single 325-vertex track played at a day a
   * second crosses about six vertices per step, so the guard skips nothing and
   * the assertion failed. That is not the case the guard is for. A reader
   * ticks several storms, and at any moment most of them are unborn or already
   * over — those contribute an unchanged fingerprint, and the whole set only
   * re-pushes when a RUNNING storm crosses a vertex.
   *
   * Counted off the real 2005 file by `tools/season-clock-cost.mjs`: one storm
   * 100% of steps, four storms 55%, the whole season 69%. So four is the case
   * asserted here — it is also the one Aaron actually ticks. */
  const season = seasonStorms('al-2005.txt').slice(0, 4);
  const live = season.map((s) => buildTimeline(s)).filter(Boolean);
  const span = clockSpan(live.map((timeline) => ({ timeline })));
  ok('four 2005 storms give a span', Boolean(span));

  let steps = 0;
  let changes = 0;
  let last = '';
  for (let t = span.startMs; t <= span.endMs; t += step) {
    const print = trailFingerprint(live.map((tlx, i) => ({ id: `s${i}`, ...cutTimeline(tlx, t) })));
    steps++;
    if (print !== last) changes++;
    last = print;
  }
  ok(`the trail is re-pushed on some steps and held on others\n     got:  ${changes} pushes over ${steps} steps`,
    changes > 1 && changes < steps);

  /* ==> AND THE SKIPPED STEPS ARE A REAL FRACTION, NOT ONE STEP IN FOUR
   * HUNDRED. <== `changes < steps` alone would pass on a guard that fires
   * once, which would be a guard worth deleting rather than keeping. */
  ok(`and it holds on a worthwhile share of them\n     got:  ${(100 * (steps - changes) / steps).toFixed(0)}% skipped`,
    (steps - changes) / steps > 0.2);

  eq('a different vertex count is a different fingerprint', fa === fb, fa === fb);
  ok('and a changed STATE always is',
    trailFingerprint([{ id: 'x', state: 'running', coords: [1, 2] }])
    !== trailFingerprint([{ id: 'x', state: 'ended', coords: [1, 2] }]));
  ok('and so is a changed storm',
    trailFingerprint([{ id: 'x', state: 'running', coords: [1] }])
    !== trailFingerprint([{ id: 'y', state: 'running', coords: [1] }]));
}

/* ---------------------------------------------------------------------------
 * 9. THE ENGINE, ON A FAKE CLOCK.
 * ------------------------------------------------------------------------ */

function harness() {
  let nowMs = 1000;
  let queued = null;
  const steps = [];
  const states = [];
  const engine = createClockEngine({
    onStep: (ms) => steps.push(ms),
    onState: (s) => states.push(s),
    now: () => nowMs,
    raf: (cb) => { queued = cb; return 1; },
    cancel: () => { queued = null; },
  });
  /** Advance the wall clock by `ms` and run one frame. */
  const frame = (ms) => { nowMs += ms; const cb = queued; queued = null; cb?.(); };
  return { engine, frame, steps, states, queued: () => queued, now: () => nowMs };
}

const SPAN_MS = 10 * 86400000;
const SPAN = { startMs: 0, endMs: SPAN_MS };

{
  const h = harness();
  eq('with nothing ticked the clock is unavailable', h.engine.state().available, false);
  h.engine.play();
  eq('and play does nothing', h.engine.state().playing, false);

  h.engine.setSpan(SPAN);
  eq('a span makes it available', h.engine.state().available, true);
  eq('and it opens at the beginning', h.engine.state().cutMs, 0);
  eq('and it is not playing on its own', h.engine.state().playing, false);
  ok('but the globe was told, so a ticked storm shows while paused', h.steps.length === 1);
}

{
  /* ==> IT STEPS ON WALL TIME, NOT ON FRAMES. <== Five frames inside one step
   * must produce one step, not five. This is the assertion §57.35 fault 3 is
   * really about. */
  const h = harness();
  h.engine.setSpan(SPAN);
  const before = h.steps.length;
  h.engine.play();

  const stepMs = 1000 / SEASONS.clockStepsPerSecond;
  for (let i = 0; i < 5; i++) h.frame(stepMs / 6);
  eq('five frames inside one step advance the clock zero times', h.steps.length - before, 0);

  h.frame(stepMs / 2);
  eq('and the frame that completes the step advances it once', h.steps.length - before, 1);
}

{
  /* A long gap is skipped, never caught up or replayed. */
  const h = harness();
  h.engine.setSpan(SPAN);
  h.engine.play();
  const stepMs = 1000 / SEASONS.clockStepsPerSecond;

  h.frame(stepMs);
  const afterOne = h.engine.state().cutMs;

  h.frame(stepMs * 500);
  const afterSleep = h.engine.state().cutMs;
  eq('a backgrounded tab advances by ONE step, not five hundred',
    afterSleep - afterOne, msPerStep(SEASONS.clockDaysPerSecond, SEASONS.clockStepsPerSecond));

  /* But a small stutter IS paid, or the clock silently runs slow on any device
   * that misses the odd frame. */
  const h2 = harness();
  h2.engine.setSpan(SPAN);
  h2.engine.play();
  h2.frame(stepMs * 2);
  eq('a two-step stutter is paid in full',
    h2.engine.state().cutMs, msPerStep(SEASONS.clockDaysPerSecond, SEASONS.clockStepsPerSecond) * 2);
}

{
  /* Running off the end: it holds, then stops, and it does NOT rewind. */
  const h = harness();
  h.engine.setSpan({ startMs: 0, endMs: 1 });
  h.engine.play();
  const stepMs = 1000 / SEASONS.clockStepsPerSecond;

  h.frame(stepMs);
  eq('it lands exactly on the end, never past it', h.engine.state().cutMs, 1);
  eq('and it is still playing during the hold', h.engine.state().playing, true);

  h.frame(SEASONS.clockEndHoldMs + stepMs);
  eq('and after the hold it stops', h.engine.state().playing, false);
  eq('and stays at the end rather than rewinding', h.engine.state().cutMs, 1);
  eq('and says so', h.engine.state().atEnd, true);

  h.engine.play();
  eq('pressing play at the end starts over', h.engine.state().cutMs, 0);
  eq('and it is playing again', h.engine.state().playing, true);
}

{
  /* Seeking, clamping, and the nudge. */
  const h = harness();
  h.engine.setSpan(SPAN);

  h.engine.seek(SPAN_MS / 2);
  eq('seek lands where it was aimed', h.engine.state().cutMs, SPAN_MS / 2);

  h.engine.seek(-99999);
  eq('and is clamped at the beginning', h.engine.state().cutMs, 0);
  h.engine.seek(SPAN_MS * 99);
  eq('and at the end', h.engine.state().cutMs, SPAN_MS);
  h.engine.seek(NaN);
  eq('and a nonsense moment is refused rather than stored', h.engine.state().cutMs, SPAN_MS);

  h.engine.seek(SPAN_MS / 2);
  h.engine.nudge(1);
  eq('a nudge forward moves one recorded observation',
    h.engine.state().cutMs, SPAN_MS / 2 + SEASONS.clockNudgeMs);
  h.engine.nudge(-1);
  eq('and back again', h.engine.state().cutMs, SPAN_MS / 2);

  /* ==> SCRUBBING WHILE PLAYING KEEPS PLAYING. <== A control that stops
   * playback when you aim it is a control that thinks it was interrupted. */
  h.engine.play();
  h.engine.seek(SPAN_MS / 4);
  eq('and scrubbing does not stop playback', h.engine.state().playing, true);
}

{
  /* The span changing under the clock. */
  const h = harness();
  h.engine.setSpan(SPAN);
  h.engine.seek(SPAN_MS / 2);
  h.engine.play();

  h.engine.setSpan(SPAN);
  eq('re-handing the SAME span is a no-op', h.engine.state().cutMs, SPAN_MS / 2);
  eq('and does not stop playback', h.engine.state().playing, true);

  /* ==> A CHANGED SPAN RESETS. <== Ticking a fifth storm moves both ends, so
   * the held moment now means a different date — and on a shortened span it
   * can mean one past the end. */
  h.engine.setSpan({ startMs: 0, endMs: SPAN_MS * 2 });
  eq('a CHANGED span starts the clock over', h.engine.state().cutMs, 0);

  h.engine.setSpan(null);
  eq('unticking everything makes it unavailable', h.engine.state().available, false);
  eq('and stops it', h.engine.state().playing, false);
  eq('and there is no moment to report', h.engine.state().cutMs, null);
}

{
  /* Leaving the archive. A step landing after teardown would push a 1935 storm
   * onto a globe the reader has already left. */
  const h = harness();
  h.engine.setSpan(SPAN);
  h.engine.play();
  const before = h.steps.length;
  h.engine.destroy();
  eq('destroy stops the clock', h.engine.state().playing, false);
  eq('and drops the span', h.engine.state().available, false);
  eq('and no frame is left queued', h.queued(), null);
  eq('and nothing more reaches the globe', h.steps.length, before);
}

{
  /* A thrown callback must not kill the clock. The globe is a thing that can
   * fail; the timekeeping is not. */
  let calls = 0;
  let nowMs = 0;
  let queued = null;
  const engine = createClockEngine({
    onStep: () => { calls++; throw new Error('the globe fell over'); },
    now: () => nowMs,
    raf: (cb) => { queued = cb; return 1; },
    cancel: () => { queued = null; },
  });
  engine.setSpan(SPAN);
  engine.play();
  const stepMs = 1000 / SEASONS.clockStepsPerSecond;
  nowMs += stepMs; queued?.();
  nowMs += stepMs; queued?.();
  ok('a throwing draw does not stop the clock', calls >= 2 && engine.state().playing);
}

/* ---------------------------------------------------------------------------
 * 10. THE READOUT.
 * ------------------------------------------------------------------------ */

{
  const words = formatArchiveMoment(Date.UTC(2005, 7, 28, 18, 0));
  eq('the readout is month, day and a 24-hour time', words, 'Aug 28, 18:00');

  /* ==> A FIXED WIDTH, BECAUSE IT CHANGES TEN TIMES A SECOND. <== A readout
   * that resizes drags the scrub bar under the reader's thumb mid-drag. */
  const widths = new Set([
    formatArchiveMoment(Date.UTC(2005, 7, 1, 0, 0)).length,
    formatArchiveMoment(Date.UTC(2005, 8, 28, 18, 0)).length,
    formatArchiveMoment(Date.UTC(2005, 10, 30, 6, 0)).length,
  ]);
  eq('and single- and double-digit days differ by one character only', widths.size, 2);

  ok('no narrow no-break space survives the formatter',
    !/\u202f|\u00a0/.test(formatArchiveMoment(Date.UTC(2005, 7, 28, 18, 0))));

  eq('a moment that is not a moment says nothing', formatArchiveMoment(null), '');
  eq('and neither does a NaN', formatArchiveMoment(NaN), '');
}

/* ---------------------------------------------------------------------------
 * 11. THE WIRING, READ OFF THE SHIPPED FILES.
 *
 * ==> `tools/test-archive-paint.mjs` IS THE PRECEDENT AND ITS REASON APPLIES
 * HERE UNCHANGED. <== That suite exists because the RULE was right and the
 * WIRING was what broke, for a week, with a green suite over it. Everything
 * above proves arithmetic. None of it can see whether anybody calls it.
 * ------------------------------------------------------------------------ */

{
  const index = readFileSync(join(ROOT, 'seasons', 'index.js'), 'utf8');
  ok('the archive builds a clock engine', /createClockEngine\(/.test(index));
  ok('and builds its controls', /createSeasonsClockBar\(/.test(index));
  ok('and hands the bar the controls to mount', /clockEl:\s*clockBar\.el/.test(index));
  ok('and rebuilds the timelines when the ticked set changes',
    /clockTracks\s*=\s*selected\.map\(/.test(index));
  ok('and tells the engine the new span', /clock\.setSpan\(clockSpan\(clockTracks\)\)/.test(index));
  ok('and tears the clock down on the way out', /clock\.destroy\(\)/.test(index));
  ok('and takes the Space handler off with it',
    /removeEventListener\('keydown',\s*onSpace\)/.test(index));

  /* ==> THE TWO PUSHES ARE SEPARATE CALLS, WHICH IS THE WHOLE OF FAULT 3'S
   * SPLIT. <== Folded into one they would re-push a season's line geometry to
   * nudge a dot, ten times a second. */
  ok('the heads are pushed on their own door', /setClockHeads\?\.\(/.test(index));
  ok('and the trail push is guarded by the fingerprint',
    /if\s*\(print\s*!==\s*lastTrail\)/.test(index));

  const main = readFileSync(join(ROOT, 'main.js'), 'utf8');
  ok('main.js installs the head layer', /ensureSeasonClock\(map,/.test(main));
  ok('and exposes the heads to the archive', /setClockHeads\(running,\s*cutMs\)/.test(main));
  ok('and clears them when the archive closes', /clearSeasonClock\(map\)/.test(main));
  ok('and passes the cut through to the tracks', /setSeasonTracks\(map,\s*selected,\s*cuts\)/.test(main));

  const tracks = readFileSync(join(ROOT, 'map', 'layers', 'season-tracks.js'), 'utf8');
  ok('the track layer drops an unborn storm rather than drawing it empty',
    /cut\.state\s*===\s*'unborn'/.test(tracks));
  /* ==> THE `== true` IS LZ0AD-BEARING AND IS ASSERTED AS SUCH. <== MapLibre
   * refuses a `case` whose condition can be null, and a missing property IS
   * null — so a bare `['get','ended']` throws the whole line layer away at
   * `addLayer` for every reader who never presses play. Same class as §48.21's
   * third bug, which shipped. */
  ok('and the ended test cannot hand MapLibre a null condition',
    /\['==',\s*\['get',\s*'ended'\],\s*true\]/.test(tracks));

  const clockLayer = readFileSync(join(ROOT, 'map', 'layers', 'season-clock.js'), 'utf8');
  /* Rule 1b: a themed colour named with `gs()` beside a `['get', …]` resolves
   * to BLACK in the worker without throwing. The stroke rides on the feature. */
  ok('the head layer does not import the global-state helper',
    !/import[^;]*\bgs\b[^;]*theme-state/.test(clockLayer));
  ok('and carries its stroke on the feature instead', /\['get',\s*'stroke'\]/.test(clockLayer));
}

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`test-season-clock: ${pass} passed, ${fails.length} FAILED\n`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`test-season-clock: ${pass} assertions passed`);
