#!/usr/bin/env node
/**
 * test-season-clock-control.mjs — the archive's season clock, as a control.
 * SPEC-SEASONS-BUILD.md §57.23, §57.67 slice C.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-season-clock-control.mjs`.
 *
 * ==> WHAT THIS SUITE CAN PROVE AND WHAT IT CANNOT. <== It drives the real
 * component against `tools/markup-dom.mjs`, so it can say what elements exist,
 * where they were attached, what they are labelled, which of them is hidden,
 * and — the part that matters — what cut the globe would be handed at a given
 * slider position. It says NOTHING about layout, about whether a two-row pill
 * fits a 390px phone, or about how a drag feels. Those are Aaron's, on glass,
 * and §57.67b is explicit that slice C is the first slice with a glass call in
 * it at all.
 *
 * ==> EVERY EXPECTATION IS COMPUTED OFF THE REAL SEASON FILES. <== Same rule
 * slices A and B were gated by, and for the same reason: a timeline typed from
 * memory would be a suite agreeing with whatever the code happened to do. The
 * storms here are Katrina 2005, Ida 2021 and AL011851 — the thinnest entry in
 * the whole record, one observation, which is what exercises the minimum-span
 * floor rather than a hypothetical.
 *
 * ==> AND THE ASSERTION THIS FILE EXISTS FOR IS THAT NOTHING MOVES WHEN THE
 * CLOCK IS OFF. <== The archive shipped without a clock and has to go on
 * behaving that way for a reader who never presses the button. `cut()` answers
 * null whenever the control is not engaged, and `map/layers/season-cut.js`
 * answers "all of it" to a null cut — so "the clock is off" is not a state any
 * layer has to know about. Section 1 is that.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
process.chdir(ROOT);

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };
const eq = (what, got, want) => ok(
  `${what}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`,
  JSON.stringify(got) === JSON.stringify(want)
);
const section = (n) => console.log(`\n  ${n}`);

const { El, installMarkupDocument } = await import('./markup-dom.mjs');
const restore = installMarkupDocument();

const { parseHurdat2 } = await import('../lib/hurdat.js');
const { SEASONS } = await import('../config/constants.js');
const { clockSpan, stormStateAt } = await import('../lib/season-clock.js');
const {
  createSeasonClock, momentAt, readoutFor,
} = await import('../seasons/clock-control.js');

const one = (f) => parseHurdat2(readFileSync(`samples/seasons/storms/${f}.txt`, 'utf8')).storms[0];
const seasonOf = (basin, year) => {
  const index = JSON.parse(readFileSync(join(ROOT, 'seasons', 'index.json'), 'utf8'));
  const file = index.basins[basin].seasons[String(year)];
  return parseHurdat2(readFileSync(join(ROOT, 'seasons', 'data', file), 'utf8')).storms;
};

const katrina = seasonOf('atlantic', 2005).find((s) => s.id === 'AL122005');
const ida = one('al092021');
/* ==> BOTH OF THESE WERE FOUND BY SCANNING THE ARCHIVE, NOT REMEMBERED. <== See
 * the note on section 6. `AL021971` is a sample already in the repo; `AL021851`
 * is read out of the shipped 1851 season file rather than copied into a new
 * fixture, which is the same road `tools/test-season-cut.mjs` takes to a real
 * season. */
const short = one('al021971');
const single = seasonOf('atlantic', 1851).find((s) => s.id === 'AL021851');

const entry = (storm) => ({ storm });
const STEPS = SEASONS.clockScrubSteps;

/** Where on the slider a given moment falls. The inverse of `momentAt`, and it
 *  is here rather than in the app because nothing in the app needs it — a
 *  suite that typed the expected positions instead would be agreeing with
 *  whatever the code happened to do. */
const momentFraction = (span, at) => ((at - span.from) / span.spanMs) * STEPS;

/** A fresh document with a control cluster in it, the way the real page has
 *  one. Returned rather than shared, because these tests mount and unmount and
 *  a leftover button would make the next section's count wrong. */
function stage() {
  const body = globalThis.document.body;
  body.children = [];
  globalThis.document.documentElement.attrs = {};

  const controls = new El('nav');
  controls.setAttribute('id', 'controls');
  const existing = new El('button');
  existing.setAttribute('id', 'btn-recenter');
  controls.append(existing);
  body.append(controls);
  controls.parent = body;

  return { body, controls };
}

const fab = () => globalThis.document.getElementById('btn-season-clock');
const pill = () => globalThis.document.getElementById('seasons-clock-pill');
const range = () => pill()?.querySelector('.seasons-clock-range') || null;
const dateEl = () => pill()?.querySelector('.seasons-clock-date') || null;
const leaveBtn = () => pill()?.querySelector('.seasons-clock-leave') || null;
const press = (el) => el.fire('click', el);
const rootFlag = () => globalThis.document.documentElement.getAttribute('data-seasons-clock');

/** Move the slider the way a thumb or an arrow key would: set the value, then
 *  fire the event the control actually listens for. Reaching past the listener
 *  and poking internals would test the suite's idea of scrubbing. */
function scrub(v) {
  const r = range();
  r.value = String(v);
  r.fire('input', r);
}

/* ---------------------------------------------------------------------------
 * ==> THE SUITE OWNS THE CLOCK'S SENSE OF TIME, AND EVERY SECTION USES IT.
 * §57.67 slice D. <==
 *
 * Two reasons, and the second is the one that would bite.
 *
 * FIRST: a playback loop asserted by waiting on a real timer is slow, flaky,
 * and cannot say anything about what one second of storm time is worth — which
 * is the exact arithmetic §57.67c records the reverted attempt getting wrong in
 * a way nothing could see. Driving it is the only way to see it.
 *
 * SECOND: with a real `setTimeout`, every section that presses the FAB would
 * leave a live wake-up behind holding this whole module alive, and it would
 * fire AFTER `restore()` has taken the stand-in document away — a throw with no
 * section name on it, in a suite that had already printed a pass. A clock that
 * never moves unless this file moves it cannot do that.
 * ------------------------------------------------------------------------ */
function fakeTime() {
  let t = 0;
  let next = 1;
  let lag = 0;
  const queue = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = next++; queue.push({ id, at: t + ms, fn }); return id; },
    clearTimer: (id) => {
      const i = queue.findIndex((q) => q.id === id);
      if (i !== -1) queue.splice(i, 1);
    },

    /** ==> THE NEXT WAKE-UP ARRIVES LATE, WHICH IS THE ORDINARY CASE AND NOT
     *  THE EXOTIC ONE. <== A busy main thread, a mid-drag repaint, a phone in
     *  a low-power mode: browser timers are a floor, never a promise. Without
     *  a way to say so here, a loop that advanced by a constant per tick would
     *  pass every assertion in this file and run the season slow on a real
     *  device, with nothing on screen admitting it. */
    lateNext(ms) { lag = ms; },

    /** Real time passes, and whatever was due along the way happens in order. */
    run(ms) {
      const end = t + ms;
      for (;;) {
        const due = queue.filter((q) => q.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        queue.splice(queue.indexOf(due), 1);
        t = due.at + lag;
        lag = 0;
        due.fn();
      }
      t = Math.max(t, end);
    },
    pending: () => queue.length,
    reset() { t = 0; next = 1; lag = 0; queue.length = 0; },
  };
}

const time = fakeTime();
const newClock = (opts = {}) => createSeasonClock({
  ...opts, now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer,
});

/* ---------------------------------------------------------------------------
 * 1. WITH THE CLOCK OFF, THERE IS NO CUT — the assertion the slice earns
 * ------------------------------------------------------------------------ */
section('1. the clock off');
{
  stage();
  let pushes = 0;
  const clock = newClock({ onScrub: () => { pushes++; } });
  clock.mount();

  eq('==> A READER WHO HAS TICKED NOTHING NEVER SEES THE CONTROL. §57.67a call '
    + '1. <== A button that would do nothing is worse than no button, and '
    + '`hidden` rather than an opacity fade because it has to leave the TAB '
    + 'ORDER too (§13)', fab().hidden, true);
  eq('and the pill is not up either', pill().hidden, true);
  eq('==> AND `cut()` IS NULL, WHICH IS NOT A STATE. <== `season-cut.js` '
    + 'answers "all of it" to a null cut, so no layer has to ask whether a '
    + 'clock exists', clock.cut(), null);
  eq('nothing has been pushed to the globe', pushes, 0);

  clock.setEntries([entry(katrina), entry(ida)]);
  eq('with storms drawn the control appears', fab().hidden, false);
  eq('but it is still off until it is pressed', clock.engaged(), false);
  eq('so there is still no cut', clock.cut(), null);
  eq('and the pill is still down', pill().hidden, true);
  eq('and the root carries no flag, so the caption pill is untouched',
    rootFlag(), null);

  clock.unmount();
}

/* ---------------------------------------------------------------------------
 * 2. MOUNTING — where the two pieces go
 * ------------------------------------------------------------------------ */
section('2. where it mounts');
{
  const { body, controls } = stage();
  const clock = newClock({});
  clock.mount();

  eq('==> THE PLAY CONTROL IS FIRST IN THE CLUSTER, WHICH IS BOTH THE TOP OF '
    + 'THE STACK AND THE FRONT OF THE TAB ORDER. <== Aaron\'s call 1: above the '
    + 'location button. `#controls` is a column flex container and nothing '
    + 'positions those buttons by index, so DOM order is the only thing that '
    + 'decides either — one `prepend` moves both together',
  controls.children.map((c) => c.attrs.id), ['btn-season-clock', 'btn-recenter']);

  ok('it carries `.control`, so the 44px target, the glass, the focus ring and '
    + 'the press scale all arrive from the cluster rather than from a second '
    + 'styling vocabulary for one button',
  fab().classList.contains('control'));

  ok('the pill is on the body, not inside the cluster — it is a lozenge on the '
    + 'bottom edge and the cluster is a column on the right',
  body.children.includes(pill()));

  eq('the scrubber reuses `.slider`, which is the app\'s one range-input '
    + 'treatment, and adds its own name for the two rules that differ',
    range().className, 'slider seasons-clock-range');

  eq('==> AND THE SLIDER\'S RESOLUTION IS THE CONSTANT, NEVER A LITERAL. <== '
    + '`SEASONS.clockScrubSteps`, which is also what one arrow-key press moves',
  [range().min, range().max, range().step], ['0', String(STEPS), '1']);

  /* ==> BOTH MARKS ARE DRAWN THE WAY THE REST OF THE CLUSTER IS, AND THIS IS A
   * GLASS FAULT TURNED INTO A RULE. <== The first version filled them. On
   * Aaron's phone, 2026-08-31, they read as a different size AND a different
   * colour from the four buttons under them — one cause, not two: a solid shape
   * at `--text-secondary` carries far more ink than 1.7px line art at the same
   * colour, so it looks bigger and brighter while measuring smaller.
   *
   * The expected values are READ OUT OF index.html rather than typed, so this
   * tracks the cluster instead of pinning a number beside it. If the rail ever
   * moves to a different weight, this asks the clock to move with it rather
   * than failing for having been left behind. */
  {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const wanted = /stroke-width="([0-9.]+)"/.exec(
      html.slice(html.indexOf('id="btn-home"'))
    )?.[1];
    ok(`the cluster draws its verbs at stroke-width ${wanted}`, wanted === '1.7');

    const playMark = fab().children.find((c) => c.classList.contains('clock-play'));
    eq('.clock-play is stroked line art at the cluster\'s own weight, not a fill',
      [playMark.getAttribute('fill'), playMark.getAttribute('stroke'),
        playMark.getAttribute('stroke-width')],
      ['none', 'currentColor', wanted]);

    /* ==> AND THE PAUSE MARK IS THE ONE EXCEPTION, WHICH IS AARON'S CALL ON
     * GLASS RATHER THAN A DRIFT. <== §57.67n. It shipped as two stroked lines
     * at 1.7 and he rejected them on a phone: "the two singular thin lines look
     * cheap". Every other verb in the rail is a CLOSED outline, so its stroke
     * draws a shape with an inside; two bare lines have no inside, and the same
     * weight that reads as a glyph everywhere else reads as two hairs here.
     * Outlining the bars instead does not work at 20px — a 4.5-unit bar is
     * 3.75px wide and a 1.7-unit stroke eats 1.4px from each side. */
    const pauseMark = fab().children.find((c) => c.classList.contains('clock-pause'));
    eq('.clock-pause is filled and carries no stroke at all',
      [pauseMark.getAttribute('fill'), pauseMark.getAttribute('stroke')],
      ['currentColor', null]);
    eq('==> BOTH MARKS STILL SPAN THE SAME 4.5-TO-19.5 BAND AND BOTH ARE '
      + 'CENTRED ON x=12, SO THE COLUMN CANNOT JUMP BETWEEN TWO SIZES WHEN THE '
      + 'BUTTON IS PRESSED. <== The bars are read off the element rather than '
      + 'typed, so a later nudge to the geometry has to move both or turn this '
      + 'red',
    pauseMark.children.map((r) => [
      Number(r.getAttribute('x')), Number(r.getAttribute('y')),
      Number(r.getAttribute('x')) + Number(r.getAttribute('width')),
      Number(r.getAttribute('y')) + Number(r.getAttribute('height')),
    ]).reduce((a, b) => [
      Math.min(a[0], b[0]), Math.min(a[1], b[1]),
      Math.max(a[2], b[2]), Math.max(a[3], b[3]),
    ]),
    [6.25, 4.5, 17.75, 19.5]);
    eq('and the ends are semicircular — half the width, which is a capsule '
      + 'rather than a merely soft rectangle',
    pauseMark.children.map((r) => Number(r.getAttribute('rx')) * 2
      === Number(r.getAttribute('width'))), [true, true]);
  }

  /* ==> AND THE WAY OUT IS ITS OWN CONTROL NOW. §57.67 slice D. <== In slice C
   * a second press of the FAB put the whole season back. The FAB is play/pause
   * from here on, so without this the clock would be a mode with no door — the
   * only way out would be unticking every storm. */
  ok('the pill carries a leave control as well as the scrubber', leaveBtn() !== null);
  eq('it is on the SCRUBBER\'s row rather than the date\'s, where `.slider` is '
    + 'already 44px tall so it costs the pill no height at all',
  leaveBtn().parent.className, 'seasons-clock-row');
  eq('and it says what it does, because it is an icon',
    leaveBtn().getAttribute('aria-label'), 'Leave the season clock');

  clock.unmount();
  eq('unmounting takes the button out of the cluster',
    controls.children.map((c) => c.attrs.id), ['btn-recenter']);
  eq('and the pill off the body', pill(), null);
}

/* ---------------------------------------------------------------------------
 * 2b. LEAVING THE ARCHIVE WITH THE CLOCK STILL RUNNING
 * ------------------------------------------------------------------------ */
section('2b. leaving mid-clock');
{
  stage();
  const clock = newClock({});
  clock.mount();
  clock.setEntries([entry(katrina)]);
  fab().fire('click', fab());
  eq('engaged, and the root is flagged', rootFlag(), 'on');

  clock.unmount();
  eq('==> THE FLAG COMES OFF ON UNMOUNT, NOT ONLY ON A SECOND PRESS. <== It is '
    + 'what hides the archive\'s caption pill; left on the document it would go '
    + 'on hiding a surface from inside a world nobody is in any more. '
    + '`seasons/index.js` tears this down BEFORE it removes `data-seasons`, so '
    + 'the two come off in the order they went on', rootFlag(), null);
  eq('and the clock no longer thinks it is running', clock.engaged(), false);
}

/* ---------------------------------------------------------------------------
 * 3. ENGAGING — the globe empties, and it is not silence
 * ------------------------------------------------------------------------ */
section('3. engaging');
{
  stage();
  let pushes = 0;
  const clock = newClock({ onScrub: () => { pushes++; } });
  clock.mount();
  clock.setEntries([entry(katrina)]);

  fab().fire('click', fab());

  eq('pressing it engages the clock', clock.engaged(), true);
  eq('the pill comes up', pill().hidden, false);
  eq('==> AND THE ROOT IS FLAGGED, WHICH IS WHAT TAKES THE CAPTION PILL OFF '
    + 'SCREEN. <== They are the same slot on the same edge. The caption is a '
    + '`<button>` and a range input cannot live inside one, so the scrubber '
    + 'could never have been that element wearing a slider (§57.38b)',
  rootFlag(), 'on');
  eq('the globe is asked to redraw exactly once', pushes, 1);
  eq('==> AND PRESSING IT STARTS THE CLOCK, NOT JUST THE PILL. §57.67 slice D. '
    + '<== A play triangle that engaged a scrubber and then stood there would '
    + 'be promising something it does not do', clock.playing(), true);
  eq('the button says what a second press would do',
    fab().getAttribute('aria-pressed'), 'true');
  eq('and its label changes with it, because a screen reader gets no icon',
    fab().getAttribute('aria-label'), 'Pause the season clock');
  eq('==> TWO FLAGS, BECAUSE THEY SAY TWO DIFFERENT THINGS. <== `data-on` is '
    + '"the clock is on screen" and carries the background fill; '
    + '`data-playing` is "the timer is running" and swaps the mark. '
    + 'Engaged-and-paused is an ordinary state — it is what a reader is in the '
    + 'whole time they are dragging — and one flag could not describe it',
  [fab().getAttribute('data-on'), fab().getAttribute('data-playing')],
  ['true', 'true']);

  const span = clockSpan([entry(katrina)]);
  const cut = clock.cut();
  eq('the cut names every ticked storm', [...cut.keys()], [katrina.id]);
  eq('==> IT STARTS AT THE TIMELINE\'S OWN FIRST MOMENT, WHICH IS THE STORM\'S '
    + 'FIRST RECORDED POSITION AND NOTHING MORE. <== `clockSpan`\'s `from` IS '
    + 'the earliest ticked storm\'s first fix, so the storm that OPENS the '
    + 'timeline stands on one dot here rather than being unborn. Backing the '
    + 'left end off to get a genuinely blank globe would buy that with a date '
    + 'nobody ever wrote down',
  [cut.get(katrina.id).phase, cut.get(katrina.id).drawnFixes], ['running', 1]);
  eq('and the moment is exactly the timeline\'s left end',
    momentAt(span, 0), katrina.points[0].time);

  eq('==> AN EMPTY-LOOKING GLOBE IS NOT SILENCE HERE, AND THIS IS WHY. §5. <== '
    + 'The pill is on screen in the same breath naming the moment, so the '
    + 'reader is looking at an answered question rather than an unanswered one',
  dateEl().textContent, readoutFor(span.from));

  press(fab());
  eq('==> A SECOND PRESS PAUSES. IT DOES NOT LEAVE. <== That is the one meaning '
    + 'change slice D makes, and §57.67i asserted slice C\'s answer explicitly '
    + 'so it would show up in this diff rather than slipping through',
  clock.playing(), false);
  eq('the clock is still engaged and the pill is still up',
    [clock.engaged(), pill().hidden], [true, false]);
  eq('the mark goes back to the triangle', fab().getAttribute('data-playing'), null);
  eq('but the fill stays, because the clock has not gone anywhere',
    fab().getAttribute('data-on'), 'true');
  ok('and the cut is still there — a pause holds a moment', clock.cut() !== null);
  eq('==> PAUSING DOES NOT PUSH THE GLOBE. <== The moment did not move, so a '
    + 'push would be a full re-cut of every ticked storm for no change at all, '
    + 'paid on the frame the reader is already asking the most of',
  pushes, 1);

  press(leaveBtn());
  eq('==> THE ✕ IN THE PILL IS THE WAY OUT NOW. <== Without it the clock would '
    + 'be a mode with no door', clock.engaged(), false);
  eq('the pill goes down', pill().hidden, true);
  eq('the flag comes off, so the caption returns', rootFlag(), null);
  eq('and the cut goes with it, which is what redraws the whole season',
    clock.cut(), null);
  eq('leaving pushed the globe once, because the moment DID move — back to all '
    + 'of it', pushes, 2);
  clock.unmount();
}

/* ---------------------------------------------------------------------------
 * 3b. PAUSING HOLDS, LEAVING STARTS OVER
 *
 * ==> THIS SECTION EXISTS BECAUSE A MUTATION SURVIVED WITHOUT IT. <== Deleting
 * the position reset inside `engage` left the suite green, because every test
 * above engages a clock whose slider is ALREADY at zero — so the assertion was
 * of a value that was never going to be anything else. Found on 2026-08-31 by
 * mutation, which is the third time in three slices that the thing the run
 * caught was a fault in the test rather than in the code (§57.67d, §57.67f).
 * ------------------------------------------------------------------------ */
section('3b. pausing holds, leaving starts over');
{
  stage();
  const clock = newClock({});
  clock.mount();
  clock.setEntries([entry(katrina)]);

  press(fab());
  scrub(STEPS / 2);
  const midway = clock.cut().get(katrina.id).drawnFixes;
  ok('mid-season', midway > 1);

  press(fab());
  press(fab());
  eq('==> A PAUSE HOLDS ITS PLACE, WHICH IS THE WHOLE DIFFERENCE BETWEEN THIS '
    + 'BUTTON AND SLICE C\'s. <== A control drawn as ⏸ that came back at the '
    + 'start would be a stop wearing the wrong mark. §57.67i asserted the '
    + 'opposite answer while the button said STOP, so this line is where the '
    + 'meaning change actually lands',
  range().value, String(STEPS / 2));
  eq('and the globe is exactly where it was left',
    clock.cut().get(katrina.id).drawnFixes, midway);

  press(leaveBtn());
  press(fab());
  eq('==> LEAVING AND PRESSING PLAY AGAIN IS A NEW RUN OF THE SEASON. <== The '
    + 'FAB says ▶, and ▶ over a season that is not on screen can only mean '
    + 'from the beginning. The pause button is what holds a position; the ✕ '
    + 'puts the whole thing away',
  range().value, '0');
  eq('so the globe is back at the first fix',
    clock.cut().get(katrina.id).drawnFixes, 1);
  clock.unmount();
}

/* ---------------------------------------------------------------------------
 * 4. SCRUBBING — the slider is a fraction, never a date
 * ------------------------------------------------------------------------ */
section('4. scrubbing');
{
  stage();
  let pushes = 0;
  const clock = newClock({ onScrub: () => { pushes++; } });
  clock.mount();
  clock.setEntries([entry(katrina)]);
  fab().fire('click', fab());
  pushes = 0;

  const span = clockSpan([entry(katrina)]);

  scrub(STEPS / 2);
  eq('a drag pushes the globe', pushes, 1);
  const mid = span.from + span.spanMs / 2;
  eq('==> THE SLIDER\'S NUMBER IS A FRACTION OF THE SPAN. <== `clockSpan` '
    + 'answers the TICKED STORMS\' own window rather than the calendar year '
    + '(§57.67c), so holding a moment instead would mean a different date the '
    + 'instant anything was ticked',
  momentAt(span, STEPS / 2), mid);
  eq('and the readout is that moment in UTC, because a storm\'s own time zone '
    + 'is not knowable and the reader\'s is the wrong one',
  dateEl().textContent, readoutFor(mid));
  eq('==> THE SAME WORDS GO IN `aria-valuetext`, BECAUSE "500" IS THE '
    + 'SLIDER\'S OWN NUMBER AND MEANS NOTHING. <== It is announced once when '
    + 'the reader stops moving, which is when they want it — an `aria-live` '
    + 'region would queue a hundred announcements for one drag',
  range().getAttribute('aria-valuetext'), readoutFor(mid));

  const halfway = clock.cut().get(katrina.id);
  const direct = stormStateAt(katrina, mid);
  eq('the cut is exactly what the engine says, with no second opinion in '
    + 'between — this file positions, `lib/season-clock.js` decides',
  [halfway.phase, halfway.drawnFixes, halfway.legFraction],
  [direct.phase, direct.drawnFixes, direct.legFraction]);

  scrub(STEPS);
  eq('dragged to the end, the storm has ended and its whole track is drawn',
    [clock.cut().get(katrina.id).phase, clock.cut().get(katrina.id).drawnFixes],
    ['ended', katrina.points.length]);

  scrub(0);
  eq('and back to the start only her first fix is there — the clock is a '
    + 'position, not a ratchet',
  clock.cut().get(katrina.id).drawnFixes, 1);

  /* A whole number outside the range is what a stray `setAttribute` or a
   * future keyboard path could produce, and `momentAt` clamps rather than
   * running off the end of the timeline. */
  ok('a position past either end is clamped to the timeline',
    momentAt(span, STEPS * 3) === span.from + span.spanMs
    && momentAt(span, -50) === span.from);

  scrub(STEPS * 3);
  eq('==> AND THE ELEMENT IS PUT BACK INSIDE THE RANGE RATHER THAN LEFT '
    + 'SHOWING IT. <== Clamping the MOMENT and leaving the thumb off the end '
    + 'would be the control and the globe disagreeing, which is the one '
    + 'failure this whole screen is careful about — the date would stop at the '
    + 'end of the season while the slider went on claiming there was more',
  range().value, String(STEPS));
  eq('and the globe is at the end with it',
    clock.cut().get(katrina.id).phase, 'ended');
  clock.unmount();
}

/* ---------------------------------------------------------------------------
 * 5. THE SET CHANGING UNDER THE CLOCK — the cost §57.67c named
 * ------------------------------------------------------------------------ */
section('5. the set changing');
{
  stage();
  const clock = newClock({});
  clock.mount();
  clock.setEntries([entry(katrina)]);
  fab().fire('click', fab());
  scrub(STEPS / 2);

  const before = clock.cut().get(katrina.id).drawnFixes;
  ok('mid-scrub, part of Katrina has happened', before > 0);

  clock.setEntries([entry(katrina), entry(ida)]);
  eq('==> TICKING A SECOND STORM SENDS THE READER BACK TO THE START, AND THE '
    + 'COST IS REAL. <== §57.67c: the timeline is the ticked storms\' OWN '
    + 'window, so a new storm moves both of its ends. Carrying the position '
    + 'across is the only alternative and it is worse — the slider would sit '
    + 'still while the date under it jumped',
  range().value, '0');
  eq('==> SO THE STORM THAT NOW OPENS THE TIMELINE IS BACK TO ONE DOT AND THE '
    + 'OTHER IS UNBORN. <== Katrina is August 2005 and Ida is August 2021, so '
    + 'ticking the two together builds a timeline sixteen years wide — which '
    + 'is exactly the cost §57.67c names and accepts',
  [...clock.cut().values()].map((s) => s.phase), ['running', 'unborn']);
  eq('and the clock is still engaged — a tick is not a reason to leave it',
    clock.engaged(), true);

  /* ==> A PUSH THAT DID NOT CHANGE THE SET MUST NOT MOVE THE READER. <== Every
   * `pushSelection` in `ui/view-seasons-board.js` today IS a real change, so
   * this is one string compare standing between a repaint path added later and
   * a scrubber that jumps back to the start whenever anything repaints. */
  scrub(STEPS / 4);
  const held = range().value;
  clock.setEntries([entry(katrina), entry(ida)]);
  eq('the same set pushed again leaves the position alone', range().value, held);

  clock.setEntries([]);
  eq('==> UNTICKING THE LAST STORM PUTS THE CLOCK AWAY. <== A scrubber over an '
    + 'empty timeline is a control with nothing behind it, and the FAB would '
    + 'be a button that does nothing', clock.engaged(), false);
  eq('the pill goes down with it', pill().hidden, true);
  eq('the button goes back into hiding', fab().hidden, true);
  eq('and the root flag comes off, so the caption pill returns', rootFlag(), null);
  clock.unmount();
}

/* ---------------------------------------------------------------------------
 * 6. THE SHORTEST THINGS IN THE RECORD — the minimum-span floor
 *
 * ==> THE FIRST VERSION OF THIS SECTION NAMED THE WRONG STORM, WHICH IS THE
 * PART WORTH KEEPING. <== It used AL011851 on the strength of §57.67d calling
 * it "the thinnest entry in the record". Measured 2026-08-31: AL011851 is
 * FOURTEEN fixes over three days, so it clears the two-day floor comfortably
 * and the assertion was driving the ordinary path while claiming to drive the
 * edge one. It read perfectly and it proved nothing — §12's failure exactly,
 * and the same shape slices A and B each found once in their own suites.
 *
 * Both storms below were found by scanning rather than remembered. Across the
 * whole shipped archive — 3,266 storms — 275 span less than two days and 32
 * are a single observation.
 * ------------------------------------------------------------------------ */
section('6. the shortest things in the record');
{
  stage();
  const clock = newClock({});
  clock.mount();

  const floorMs = SEASONS.clockMinSpanDays * 86_400_000;

  /* -- 6a. a real storm shorter than the floor -------------------------- */

  eq('AL021971 is five fixes across one day, which is under the floor and is '
    + 'the ordinary case rather than the edge one',
  [short.points.length, short.points.at(-1).time - short.points[0].time],
  [5, 86_400_000]);

  clock.setEntries([entry(short)]);
  eq('the control offers itself for it like any other storm', fab().hidden, false);
  fab().fire('click', fab());

  eq('==> ITS SPAN IS WIDENED TO THE FLOOR AROUND ITS OWN MIDDLE. <== A '
    + 'timeline shorter than a drag is one the reader cannot land on; widening '
    + 'symmetrically rather than padding the end is what keeps the storm in '
    + 'the MIDDLE of the scrubber',
  clockSpan([entry(short)]).spanMs, floorMs);

  scrub(0);
  eq('at the left end it has not happened yet, because the timeline now starts '
    + 'before it does', clock.cut().get(short.id).phase, 'unborn');
  scrub(STEPS / 2);
  eq('and the middle of the scrubber is the middle of the storm',
    clock.cut().get(short.id).phase, 'running');
  scrub(STEPS);
  eq('the right end is past the end of it', clock.cut().get(short.id).phase, 'ended');

  /* -- 6b. one observation, which spans nothing at all ------------------ */

  eq('AL021851 is a single observation, and 32 storms in the archive are',
    single.points.length, 1);

  clock.setEntries([entry(single)]);
  eq('==> A SPAN OF ZERO DIVIDES BY ZERO ON THE FIRST DRAG, AND THIS IS THE '
    + 'FLOOR THAT STOPS IT. <== Ticking one of these is an ordinary thing to '
    + 'do — single-observation entries run all through the 19th century',
  clockSpan([entry(single)]).spanMs, floorMs);

  scrub(STEPS / 2);
  eq('the one moment somebody wrote down sits in the middle of the scrubber, '
    + 'where it reads as an observation rather than as a storm that stopped '
    + 'being reported', clock.cut().get(single.id).phase, 'ended');
  ok('and the readout says a date rather than nothing (§5)',
    dateEl().textContent.length > 0);

  clock.unmount();
}

/* ---------------------------------------------------------------------------
 * 7. THE FAILURE PATHS — nothing here is allowed to throw
 * ------------------------------------------------------------------------ */
section('7. failure paths');
{
  /* A page with no `#controls` is not a real page, but it is what a mount that
   * ran too early would find. The pill still goes up and the clock is simply
   * unreachable, which is no worse than the archive without this slice. */
  globalThis.document.body.children = [];
  const clock = newClock({});
  clock.mount();
  ok('a missing control cluster is not a crash', pill() !== null);
  clock.unmount();

  stage();
  const c2 = newClock({});
  c2.mount();
  /* `setEntries` before anything is ticked, and with junk. Both are reachable:
   * the board pushes an empty set on every year change (`ui/view-seasons-
   * board.js`), and `safely` upstream would swallow a throw here into silence
   * rather than into an error anybody sees. */
  c2.setEntries(null);
  c2.setEntries([{}, { storm: null }]);
  eq('a set with no usable storm in it leaves the control hidden',
    fab().hidden, true);
  eq('and answers no cut', c2.cut(), null);

  eq('==> AND A MOMENT THAT CANNOT BE RENDERED STILL SAYS SOMETHING. <== '
    + '`utcStamp` answers null for a stamp JavaScript\'s clock cannot format, '
    + 'which §57.50 records taking a whole drawer down once. An empty pill '
    + 'over a globe that has just emptied itself would be silence',
  readoutFor(NaN), 'Somewhere in this season');
  eq('and a null span has no moment on it at all', Number.isNaN(momentAt(null, 5)), true);

  c2.unmount();
  ok('unmounting twice is a no-op, not a throw', (() => { c2.unmount(); return true; })());
}

/* ---------------------------------------------------------------------------
 * 8. PLAYBACK — a day a second, and it is measured rather than counted
 *
 * ==> THIS IS THE SECTION SLICE D EXISTS TO EARN, AND IT IS DRIVEN ON THE ONE
 * STORM WHOSE TIMELINE IS A ROUND NUMBER. <== §57.67c records the reverted
 * attempt pacing on real elapsed milliseconds and dividing by a storm-time step
 * of 8,640,000, so it owed its first step after two and a half HOURS of
 * somebody sitting there. Both quantities were milliseconds, the arithmetic was
 * right in isolation, and nothing in the language, the tests or the console
 * said a word.
 *
 * AL021971 is five fixes across exactly one day, so `clockMinSpanDays` widens
 * it to exactly two — which makes one real second exactly half the timeline and
 * turns the whole sentence into an integer a reader could check by eye. No
 * tolerance, no rounding slack, no threshold anybody chose.
 * ------------------------------------------------------------------------ */
section('8. playback — a day a second');
{
  time.reset();
  stage();
  let pushes = 0;
  const clock = newClock({ onScrub: () => { pushes++; } });
  clock.mount();
  clock.setEntries([entry(short)]);

  const span = clockSpan([entry(short)]);
  eq('AL021971 is under the floor, so her timeline is exactly two days and one '
    + 'real second is exactly half of it', span.spanMs, 2 * 86_400_000);

  press(fab());
  eq('the FAB starts it, because that is what a play triangle promises',
    clock.playing(), true);
  pushes = 0;

  time.run(1000);

  eq('==> ONE REAL SECOND IS ONE STORM DAY. <== `SEASONS.clockDaysPerSecond`, '
    + 'as the integer it works out to on this timeline. Reversing the division '
    + 'inside `toStormMs` turns this line red, which is the whole reason that '
    + 'ratio lives in one named place',
  range().value, '500');
  eq('and the readout is saying that same moment out loud',
    dateEl().textContent, readoutFor(span.from + 86_400_000));
  eq('==> IT STEPPED TEN TIMES, NOT SIXTY. §57.35 fault 3. <== `setData` is a '
    + 'fresh parse and re-index in the map worker every time it is called, and '
    + 'sixty of those a second will not hold frame rate on a phone. '
    + '`clockStepsPerSecond` is the dial and this is it being spent',
  pushes, 10);

  /* -- 8b. a late wake-up does not slow the season ---------------------- */

  press(leaveBtn());
  press(fab());
  pushes = 0;

  /* One tick, delivered 400ms after it was due — five times its interval. */
  time.lateNext(400);
  time.run(100);

  eq('==> THE SEASON IS PACED BY THE CLOCK, NOT BY THE TICK COUNT. <== One '
    + 'wake-up arriving 400ms late has to be worth 500ms of storm time, '
    + 'because a day a second is a promise about the WALL CLOCK. A loop adding '
    + 'a constant per tick would put this at 50 and would run slow by however '
    + 'late its wake-ups were, cumulatively, with nothing on screen saying so',
  range().value, '250');
  eq('and it was still one step, not five — the clock caught up, it did not '
    + 'replay', pushes, 1);

  /* -- 8c. the position is a float, and rounding it per tick is the trap -- */

  press(leaveBtn());
  clock.setEntries([entry(katrina)]);
  const span2005 = clockSpan([entry(katrina)]);
  press(fab());
  time.run(1000);

  const oneDay = span2005.from + 86_400_000;
  eq('==> KATRINA\'s TIMELINE IS SEVEN AND A HALF DAYS, SO ONE REAL SECOND IS '
    + 'NOT A WHOLE NUMBER OF STEPS. <== A step is 13.33 of them, and rounding '
    + 'the position on every tick rather than only on the way to the slider '
    + 'turns that into 13 — the season arrives 130 steps in instead of 133, '
    + 'having run half a percent fast for no reason anybody could see',
  range().value, String(Math.round(momentFraction(span2005, oneDay))));
  eq('and the readout agrees, because the moment is derived from the position '
    + 'rather than kept beside it', dateEl().textContent, readoutFor(oneDay));

  /* -- 8d. and on a long timeline that same rounding freezes the clock ---- */

  press(leaveBtn());
  clock.setEntries([entry(katrina), entry(ida)]);
  const wide = clockSpan([entry(katrina), entry(ida)]);
  eq('Katrina is 2005 and Ida is 2021, so ticking the two together builds a '
    + 'timeline sixteen years wide — which is the cost §57.67c names and '
    + 'accepts', Math.round(wide.spanMs / 86_400_000), 5856);

  press(fab());
  time.run(60_000);

  eq('==> AND THIS IS WHERE ROUNDING PER TICK STOPS BEING A HALF-PERCENT AND '
    + 'STARTS BEING A DEAD CLOCK. <== One step of this timeline is 5.9 days, so '
    + 'one tick of playback is 0.017 of a step. Rounded, every tick is zero and '
    + 'the position NEVER LEAVES THE START — a full minute of pressing play and '
    + 'watching an empty globe, with the button correctly showing ⏸ the whole '
    + 'time. Held as a float it is where it should be',
  range().value, String(Math.round(momentFraction(wide, wide.from + 60 * 86_400_000))));
  ok('which is somewhere rather than nowhere', Number(range().value) > 0);

  clock.unmount();
}

/* ---------------------------------------------------------------------------
 * 9. THE END OF THE TIMELINE — it stops there, and it does not loop
 * ------------------------------------------------------------------------ */
section('9. the end of the timeline');
{
  time.reset();
  stage();
  const clock = newClock({});
  clock.mount();
  clock.setEntries([entry(short)]);
  press(fab());

  /* Two real seconds is the whole two-day timeline. */
  time.run(2000);

  eq('==> IT PLAYS TO THE END AND STOPS THERE. IT DOES NOT LOOP. <== §57.23\'s '
    + 'whole claim is that the season ACCUMULATES in front of you, so the last '
    + 'frame — every ticked storm\'s complete track, drawn at once — is what '
    + 'the run was spent earning. Wiping it back to an empty globe every three '
    + 'minutes would throw that away, and §57.23 is explicit that motion which '
    + 'never stops is a migraine for some readers',
  [range().value, clock.playing()], ['1000', false]);
  eq('the storm has ended and its whole track is drawn',
    [clock.cut().get(short.id).phase, clock.cut().get(short.id).drawnFixes],
    ['ended', short.points.length]);
  eq('the clock is still engaged, so the reader is looking at a finished '
    + 'season rather than at a globe that closed itself', clock.engaged(), true);
  eq('==> AND NOTHING IS STILL SCHEDULED. <== A wake-up left pending after the '
    + 'end would hold this whole closure alive and fire over whatever came '
    + 'next', time.pending(), 0);

  time.run(5000);
  eq('so more time passing changes nothing at all', range().value, '1000');

  press(fab());
  eq('==> AND ▶ AT THE END STARTS THE SEASON OVER. <== There is nowhere else '
    + 'for it to go, and a button that does nothing is worse than one that '
    + 'does the obvious thing', [range().value, clock.playing()], ['0', true]);

  clock.unmount();
}

/* ---------------------------------------------------------------------------
 * 10. SPACE — §57.23's keyboard line, and the three places it stands down
 * ------------------------------------------------------------------------ */
section('10. space plays and pauses');
{
  time.reset();
  stage();
  const clock = newClock({});
  clock.mount();
  clock.setEntries([entry(katrina)]);

  /* On the DOCUMENT, not on the pill: Space has to work with focus anywhere —
   * on the globe, on a roster row, on nothing at all — which is `attachEscape`'s
   * argument in `map/globe.js` for the same reason. A listener on the pill
   * would only work once the reader had already found the pill. */
  const key = (init) => globalThis.document.fire('keydown', { target: new El('div'), ...init });

  key({ key: ' ' });
  eq('space plays', clock.playing(), true);
  key({ key: ' ' });
  eq('and space pauses, which is the same press as the button — one function '
    + 'behind both, so the keyboard cannot drift into being a second, slightly '
    + 'different clock', clock.playing(), false);

  key({ key: 'k' });
  eq('no other key does anything', clock.playing(), false);
  key({ key: ' ', ctrlKey: true });
  eq('and a modifier means somebody else\'s shortcut', clock.playing(), false);

  key({ key: ' ', target: fab() });
  eq('==> SPACE ON THE BUTTON ITSELF IS LEFT ALONE, AND THIS IS THE ONE THAT '
    + 'WOULD HAVE BITTEN. <== Space on a focused `<button>` already fires a '
    + 'click, so handling it here as well would toggle the clock twice for one '
    + 'press and land back where it started — with the FAB the single most '
    + 'likely thing to have focus, since pressing it is how the reader got here',
  clock.playing(), false);

  key({ key: ' ', target: range() });
  eq('and a reader who has tabbed to the scrubber is driving it by hand; the '
    + 'arrow keys are theirs and Space must not move what they are holding',
    clock.playing(), false);

  key({ key: ' ', target: new El('input') });
  eq('==> AND A TEXT FIELD GETS A SPACE. <== `ui/home-search.js` has one, and a '
    + 'reader typing a place name with two words in it must not start a season',
  clock.playing(), false);

  clock.unmount();
  key({ key: ' ' });
  eq('==> THE LISTENER COMES OFF WITH THE ARCHIVE. <== It is on the document, '
    + 'so left bound it would go on answering Space from inside a world nobody '
    + 'is in — over the LIVE globe, with no pill on screen to explain it',
  clock.playing(), false);
}

/* ---------------------------------------------------------------------------
 * 11. THE PAGE GOING AWAY, AND THE TIMER GOING WITH IT
 * ------------------------------------------------------------------------ */
section('11. the page going away');
{
  time.reset();
  stage();
  const clock = newClock({});
  clock.mount();
  clock.setEntries([entry(katrina)]);
  press(fab());
  eq('a wake-up is pending', time.pending(), 1);

  globalThis.document.visibilityState = 'hidden';
  globalThis.document.fire('visibilitychange');

  eq('==> THE CLOCK PAUSES WHEN THE PAGE GOES AWAY, AND THAT IS THE PRICE OF '
    + 'PACING ON REAL TIME. <== `advance` converts however long it has actually '
    + 'been, which is right while somebody is watching and wrong the moment '
    + 'they are not: a phone locked for five minutes is five storm-months, so '
    + 'the reader unlocks it to find the season over and no idea why',
  clock.playing(), false);
  eq('and nothing is left ticking behind a screen nobody can see (§9)',
    time.pending(), 0);
  eq('but it has not LEFT — the pill is up and the moment is held, so coming '
    + 'back is a press rather than a fresh start', pill().hidden, false);

  globalThis.document.visibilityState = 'visible';
  globalThis.document.fire('visibilitychange');
  eq('==> AND IT DOES NOT RESUME BY ITSELF. <== Coming back to a clock standing '
    + 'still with ▶ showing is a state the reader can see and undo; coming back '
    + 'to one that silently restarted is a screen that did something while they '
    + 'were gone', clock.playing(), false);

  press(fab());
  eq('it is running again', [clock.playing(), time.pending()], [true, 1]);

  clock.unmount();
  eq('==> UNMOUNTING KILLS THE TIMER, AND THAT IS THE ONE THING HERE THAT '
    + 'OUTLIVES THE ELEMENTS. <== A pending wake-up holds the whole component '
    + 'alive; left running it would fire after the reader had left the archive '
    + 'and push a historical cut at a live globe that has been shown again. '
    + 'Removing the button is not what stops the clock — this is',
  time.pending(), 0);
  eq('and the clock knows it is not running', clock.playing(), false);
}

/* ------------------------------------------------------------------------ */

restore();

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions pass — the season clock's FAB, its scrubber, `
  + 'and a day of storm time for every second of real time');
