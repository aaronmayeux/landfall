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
 * 1. WITH THE CLOCK OFF, THERE IS NO CUT — the assertion the slice earns
 * ------------------------------------------------------------------------ */
section('1. the clock off');
{
  stage();
  let pushes = 0;
  const clock = createSeasonClock({ onScrub: () => { pushes++; } });
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
  const clock = createSeasonClock({});
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
  const clock = createSeasonClock({});
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
  const clock = createSeasonClock({ onScrub: () => { pushes++; } });
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
  eq('the button says what a second press would do',
    fab().getAttribute('aria-pressed'), 'true');
  eq('and its label changes with it, because a screen reader gets no icon',
    fab().getAttribute('aria-label'), 'Stop the season clock');
  eq('==> IN THIS SLICE IT IS AN ON/OFF SWITCH, NOT A PLAY/PAUSE. <== There is '
    + 'nothing to pause yet — slice D adds the timer and turns this same '
    + 'button into ▶/⏸. `data-on` is what the stop mark cross-fades on',
  fab().getAttribute('data-on'), 'true');

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

  fab().fire('click', fab());
  eq('a second press puts everything back', clock.engaged(), false);
  eq('the pill goes down', pill().hidden, true);
  eq('the flag comes off, so the caption returns', rootFlag(), null);
  eq('and the cut goes with it, which is what redraws the whole season',
    clock.cut(), null);
  eq('both presses pushed the globe', pushes, 2);
}

/* ---------------------------------------------------------------------------
 * 3b. STOPPING AND STARTING AGAIN
 *
 * ==> THIS SECTION EXISTS BECAUSE A MUTATION SURVIVED WITHOUT IT. <== Deleting
 * the position reset inside `engage` left the suite green, because every test
 * above engages a clock whose slider is ALREADY at zero — so the assertion was
 * of a value that was never going to be anything else. Found on 2026-08-31 by
 * mutation, which is the third time in three slices that the thing the run
 * caught was a fault in the test rather than in the code (§57.67d, §57.67f).
 * ------------------------------------------------------------------------ */
section('3b. stopping and starting again');
{
  stage();
  const clock = createSeasonClock({});
  clock.mount();
  clock.setEntries([entry(katrina)]);

  fab().fire('click', fab());
  scrub(STEPS / 2);
  ok('mid-season', clock.cut().get(katrina.id).drawnFixes > 1);

  fab().fire('click', fab());
  fab().fire('click', fab());
  eq('==> IN THIS SLICE THE BUTTON SAYS STOP, SO STARTING AGAIN STARTS OVER '
    + 'RATHER THAN RESUMING. <== A control labelled `Stop the season clock` '
    + 'that came back where it left off would be a pause wearing the wrong '
    + 'word. Slice D introduces a real pause and that one has to resume — '
    + 'which is why this is asserted now, so the change is visible then',
  range().value, '0');
  eq('and the globe is back at the first fix',
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
  const clock = createSeasonClock({ onScrub: () => { pushes++; } });
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
}

/* ---------------------------------------------------------------------------
 * 5. THE SET CHANGING UNDER THE CLOCK — the cost §57.67c named
 * ------------------------------------------------------------------------ */
section('5. the set changing');
{
  stage();
  const clock = createSeasonClock({});
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
  const clock = createSeasonClock({});
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
  const clock = createSeasonClock({});
  clock.mount();
  ok('a missing control cluster is not a crash', pill() !== null);
  clock.unmount();

  stage();
  const c2 = createSeasonClock({});
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

/* ------------------------------------------------------------------------ */

restore();

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions pass — the season clock's FAB and scrubber, `
  + 'and the moment it starts on');
