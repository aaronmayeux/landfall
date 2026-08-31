/**
 * clock-control.js — the archive's season clock, as a control. §57.23,
 * §57.67 slices C and D.
 *
 * ==> SLICE C BUILT THE POSITION. SLICE D MAKES IT MOVE ON ITS OWN. <== The
 * button in the control cluster and the slider in the bottom pill are slice C
 * and are unchanged in what they DRIVE: the moment goes to `lib/season-
 * clock.js`, the cut goes to the globe, and dragging still works exactly as it
 * did. What is new here is a timer that advances the same position, a
 * play/pause control over it, and Space.
 *
 * That split is the whole reason step 10 is being built in slices. The
 * 2026-08-26 attempt put the engine, the controls, the globe cut, the colouring
 * and the keyboard into one commit, reached Aaron's phone as an empty world,
 * and went back whole — three defects with nothing to bisect. `lib/season-
 * clock.js` (slice A) and `map/layers/season-cut.js` (slice B) are each proven
 * on their own with no browser, and slice C's scrubber was confirmed on glass
 * before a single line of timer was written. So if the clock is wrong now, the
 * suspect is the twenty lines below that schedule and advance, and nothing
 * underneath them.
 *
 * ==> AARON'S CALL, 2026-08-31, AND IT MOVES ONE THING OUT OF §57.67a. <== The
 * play control lives in the FAB and ONLY the scrubber goes in the pill. §57.67a
 * call 2 had put both in the pill; a 390px pill holding a play button, a slider
 * and a date is three things fighting over one lozenge, and the slider is the
 * one that needs the width.
 *
 * ==> AND THE FAB CHANGES MEANING EXACTLY ONCE, WHICH IS HERE. <== In slice C
 * it was an on/off switch — ▶ off, ■ on — because there was nothing to pause.
 * It is now ▶/⏸, and "leave the clock" has moved to a ✕ in the pill beside the
 * scrubber. §57.67g said this would happen in the commit that introduces
 * motion, and `tools/test-season-clock-control.mjs` asserted slice C's answer
 * explicitly so the change would show up in this diff rather than slipping
 * through silently.
 *
 * ==> THE PILL IS A SECOND ELEMENT, NOT `#seasons-status-pill` WEARING A
 * SLIDER. <== That element is a `<button>` — pressing it toggles the archive's
 * drawer — and a range input cannot live inside a button at all. So this one
 * takes the same slot on the same edge with the same geometry, and the caption
 * hides while it is up. The archive already has two pills for exactly this
 * reason (§57.38b): one element cannot be in two places saying two things, and
 * it cannot be two things in one place either.
 *
 * ==> AND IT OWNS ITS OWN CREATION AND REMOVAL. <== §57.67b. `ui/view-seasons-
 * board.js` is over a thousand lines and `seasons/index.js` is over eight
 * hundred, both past §12's ceiling. The wiring in `seasons/index.js` is a
 * handful of lines: build it, hand it the ticked set when that changes, ask it
 * for a cut, tear it down on the way out.
 *
 * Imports `config/`, `lib/season-clock.js`, `seasons/clock-playback.js` and one
 * formatter. DOM only; no map, no data, no network.
 */

import { SEASONS } from '../config/constants.js';
import { createPlayhead } from './clock-playback.js';
import { clockSpan, clockFrameAt, toStormMs } from '../lib/season-clock.js';
import { utcStamp } from '../ui/season-markup-bits.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The attribute every "the clock is engaged" rule in `seasons.css` hangs off,
 *  including the one that takes the caption pill off screen. On the root
 *  element rather than on a wrapper, because the two pills are siblings of the
 *  body and neither can reach the other. */
const ROOT_FLAG = 'data-seasons-clock';

/**
 * Where on the timeline a slider position lands.
 *
 * ==> THE SLIDER'S NUMBER IS A FRACTION OF THE SPAN, NEVER A DATE. <==
 * `clockSpan` answers the TICKED STORMS' own window rather than the calendar
 * year (§57.67c), so both ends move whenever the reader ticks or unticks
 * something. A slider holding a moment would then mean a different date on the
 * new timeline without anything having moved on screen. Holding a fraction and
 * resolving it against the current span is what keeps the two honest.
 *
 * @param {{from:number, spanMs:number}|null} span
 * @param {number} value  the slider's own whole number, 0..clockScrubSteps
 * @returns {number} epoch ms
 */
export function momentAt(span, value) {
  if (!span || !Number.isFinite(span.from) || !Number.isFinite(span.spanMs)) return NaN;
  const steps = SEASONS.clockScrubSteps;
  const v = Math.max(0, Math.min(Number.isFinite(value) ? value : 0, steps));
  return span.from + (span.spanMs * v) / steps;
}

/**
 * What the pill says at one moment, or what it says instead when it cannot say
 * a date.
 *
 * ==> A TIMELINE WITH NO MOMENT ON IT STILL SPEAKS. <== §5. `utcStamp` answers
 * null for a stamp JavaScript's clock cannot render — which is a real outcome,
 * not a hypothetical: §57.50 records one corrupt timestamp taking a whole
 * drawer down through `Intl.format`. An empty pill over a globe that has just
 * emptied itself would be the reverted build's silence with a slider next to
 * it.
 *
 * @param {number} at  epoch ms
 * @returns {string}
 */
export function readoutFor(at) {
  return utcStamp(at) || 'Somewhere in this season';
}

/**
 * Build the control. Not mounted — the caller decides when it goes on screen,
 * exactly as the two pills do.
 *
 * ==> THE CLOCK HAS EXACTLY TWO DEPENDENCIES ON THE WORLD OUTSIDE THIS FILE:
 * WHAT TIME IT IS, AND BEING WOKEN LATER. <== Both are arguments with real
 * defaults, so the app passes nothing and the suite passes a clock it controls.
 * That is not testing scaffolding for its own sake — a playback loop asserted
 * by waiting on a real timer is a suite that is slow, flaky, and unable to say
 * anything about what one second of storm time is worth. §57.67c exists because
 * the reverted attempt got that arithmetic wrong in a way nothing could see;
 * the only way to see it is to drive it.
 *
 * @param {object} opts
 * @param {() => void} opts.onScrub  the cut changed; push the globe again.
 * @param {() => number} [opts.now]  monotonic real milliseconds.
 * @param {(fn:Function, ms:number) => any} [opts.setTimer]
 * @param {(handle:any) => void} [opts.clearTimer]
 * @returns {{
 *   mount:()=>void, unmount:()=>void,
 *   setEntries:(entries:Array)=>void,
 *   cut:()=>Map<string,object>|null,
 *   engaged:()=>boolean, playing:()=>boolean,
 * }}
 */
export function createSeasonClock({
  onScrub,
  /* `performance.now` rather than `Date.now`, because it is monotonic: a
   * system clock correction mid-playback would otherwise hand the loop a
   * negative or enormous elapsed time and jump the season. The fallback is for
   * an environment without it, not for a browser. */
  now = () => (typeof performance !== 'undefined' && performance.now
    ? performance.now() : Date.now()),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
} = {}) {
  /** The ticked storms, as the board last reported them. */
  let entries = [];
  /** Their own window, from `clockSpan`, or null when none of them has a
   *  usable fix. */
  let span = null;
  /** Whether the clock is on screen at all — the pill up, a cut being handed
   *  to the globe. Slice C's one flag; playing is now a separate question. */
  let on = false;
  /** The slider's position, resolved against the current span into a moment.
   *
   *  ==> IT IS A FLOAT HERE AND A WHOLE NUMBER ON THE SLIDER, AND THAT IS
   *  DELIBERATE. <== `<input type="range">` deals in whole steps, and rounding
   *  the position itself on every tick would throw away the remainder ten times
   *  a second — a season would run measurably slow, and slower on a longer
   *  timeline than on a short one. The rounding happens once, on the way to the
   *  element, where it costs nothing. */
  let value = 0;
  /** The ids the last `setEntries` carried, joined, so a push that did not
   *  actually change the set does not reset a reader's position. Every
   *  `pushSelection` in the board today IS a real change; this is one string
   *  compare against a repaint path being added later. */
  let signature = '';

  /* ---------------------------------------------------------------- the FAB */

  const fab = document.createElement('button');
  fab.id = 'btn-season-clock';
  /* ==> IT IS A CLUSTER BUTTON, NOT A NEW KIND OF FLOATING CONTROL. <== The
   * five buttons in `#controls` are already floating action buttons — same
   * 44px target, same glass, same focus ring, same hover-capability rule. A
   * second styling vocabulary for a sixth button would be two answers to one
   * question, and this one has to sit in that stack anyway (Aaron's call 1:
   * above the location button). So it takes `.control` and adds one rule of
   * its own, for the on state. */
  fab.className = 'control';
  fab.type = 'button';
  fab.setAttribute('aria-pressed', 'false');

  /* ==> TWO WHOLE `<svg>` ELEMENTS, NOT TWO SHAPES INSIDE ONE. <== Both marks
   * live in the button at once and cross-fade on opacity, which is
   * `.control-view`'s pattern next door and is there for a measured reason:
   * swapping `innerHTML` rebuilds the SVG, and a rebuild is a parse and a layer
   * promotion on every press. Two static children cost nothing (§9 — transform
   * and opacity only).
   *
   * It has to be two SVGs rather than one holding a `<path>` and a `<rect>`,
   * because the stacking is done with CSS grid on the BUTTON and grid does not
   * lay out the children of an `<svg>` — SVG content is positioned by SVG's own
   * rules, so `grid-area` on a path is inert. `.control` is already
   * `display: grid`, so this costs no extra box. */
  /* ==> STROKED LINE ART AT 1.7, NOT A SOLID FILL, AND GLASS IS WHY. <== The
   * first version filled both marks. On Aaron's phone, 2026-08-31, they read as
   * a different SIZE and a different COLOUR from the four buttons under them,
   * and that is one cause rather than two: a solid shape at `--text-secondary`
   * carries far more ink than 1.7px line art at the same colour, so it looks
   * both bigger and brighter while measuring smaller.
   *
   * index.html says this outright about the rail and the first version ignored
   * it — the app's own spiral is THE ONE FILLED ICON THERE AND IT EARNS IT,
   * because it is identity rather than an instruction. Play and stop are verbs,
   * like recentre, home, layers and settings, so they are drawn the way verbs
   * are drawn here. */
  const stroked = (cls) => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    /* Optional: only the cross-fading marks need a name, because only they are
     * addressed individually. Naming the ✕ would be a class with no rule. */
    if (cls) svg.setAttribute('class', cls);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    return svg;
  };

  /* ==> AND BOTH ARE CENTRED ON (12,12), WHICH THE TRIANGLE WAS NOT. <== Its
   * old bounding box ran 8.5 to 18, so its middle sat at 13.25 and it rode
   * about a pixel right of every other glyph in the column. Round joins add the
   * same margin on all four sides, so a symmetric box stays symmetric.
   *
   * The ink also spans 4.5 to 19.5 now rather than 5.5 to 18.5, which is the
   * band the rest of the cluster occupies: crosshair 2-22, home 4-20, layers
   * 3.5-20.5, gear 2.97-21.03. Measured off index.html rather than eyeballed. */
  const playSvg = stroked('clock-play');
  const playMark = document.createElementNS(SVG_NS, 'path');
  playMark.setAttribute('d', 'M6.5 4.5 L17.5 12 L6.5 19.5 Z');
  playSvg.append(playMark);

  /* ==> IT IS A PAUSE MARK NOW AND IT WAS A STOP SQUARE IN SLICE C, WHICH IS
   * THE ONE MEANING CHANGE §57.67g BUDGETED FOR. <== A square says the clock
   * goes away and the whole season comes back; two bars say it stands still
   * where it is. Slice C had no timer to hold a position, so the first was
   * true; now the second is, and "the clock goes away" has its own control.
   *
   * ==> AND IT IS FILLED, WHICH IS THE CLUSTER'S ONE EXCEPTION AND IS AARON'S
   * CALL ON GLASS, 2026-08-31. §57.67n HAS THE MEASUREMENTS. <== It shipped as
   * two strokes at the cluster's own 1.7 and read as two hairs. Every other
   * verb in the rail is a CLOSED outline, so its stroke draws a shape with an
   * INSIDE; two bare lines have no inside, which is why the same weight works
   * everywhere else and fails here. Outlining the bars does not survive 20px.
   * **If it reads heavy in the column later, the dial is the bar WIDTH, not the
   * fill** — going back to strokes puts the hairlines back.
   *
   * Two `<rect>` children of ONE svg rather than two svgs, because the grid
   * stacking is on the BUTTON: these two bars are one mark and have to
   * cross-fade together. Same 4.5-to-19.5 band as the triangle and centred on
   * x=12, so the column does not jump between two sizes when it is pressed. */
  const pauseSvg = document.createElementNS(SVG_NS, 'svg');
  pauseSvg.setAttribute('class', 'clock-pause');
  pauseSvg.setAttribute('viewBox', '0 0 24 24');
  pauseSvg.setAttribute('fill', 'currentColor');
  pauseSvg.setAttribute('aria-hidden', 'true');
  for (const x of ['6.25', '13.25']) {
    const bar = document.createElementNS(SVG_NS, 'rect');
    bar.setAttribute('x', x);
    bar.setAttribute('y', '4.5');
    bar.setAttribute('width', '4.5');
    bar.setAttribute('height', '15');
    /* Half the width: a capsule, not a rounded rectangle. */
    bar.setAttribute('rx', '2.25');
    pauseSvg.append(bar);
  }

  fab.append(playSvg, pauseSvg);
  fab.addEventListener('click', () => toggle());

  /* --------------------------------------------------------------- the pill */

  const pill = document.createElement('div');
  pill.id = 'seasons-clock-pill';
  /* Not a `<button>` and not a `<form>`. It is a container holding a label and
   * a control; giving it a role would mean announcing something about the pill
   * itself, and there is nothing about the pill to announce. */
  pill.hidden = true;

  const dateEl = document.createElement('span');
  dateEl.className = 'seasons-clock-date';
  /* ==> `aria-live` IS DELIBERATELY ABSENT. <== The date changes on every step
   * of a drag. A live region would queue a hundred announcements for one
   * gesture and bury whatever the reader was actually listening to. The slider
   * carries the same value in `aria-valuetext`, which is announced ONCE when
   * the reader stops moving it — which is the moment they want it. */

  const range = document.createElement('input');
  /* ==> `.slider` IS THE APP'S ONE RANGE-INPUT TREATMENT AND THIS IS ITS SECOND
   * USE, NOT A SECOND VERSION OF IT. <== The track, the thumb, the bigger thumb
   * on a coarse pointer and the focus ring are all decided once in
   * `ui/panels.css`. `.seasons-clock-range` changes exactly two things and both
   * are about where this one lives — see the rule in `seasons.css`. Two plain
   * literals rather than a template, because `tools/markup-scan.mjs` reads
   * class names only where it can see them. */
  range.className = 'slider seasons-clock-range';
  range.type = 'range';
  range.min = '0';
  range.max = String(SEASONS.clockScrubSteps);
  range.step = '1';
  range.value = '0';
  range.setAttribute('aria-label', 'Scrub through the season');
  /* ==> IT IS NOT ARMED WITH `requireThumbGrab`, AND THAT IS A DECISION RATHER
   * THAN AN OMISSION. <== That rule exists because a slider inside a sheet you
   * scroll past commits a value on the press, so a finger travelling over one
   * changes a setting nobody touched. This pill is fixed over the globe with
   * nothing to scroll past it, and a press on the track jumping to that moment
   * is the behaviour a scrubber is supposed to have. Arming it here would make
   * the one control this slice exists for harder to use in exchange for
   * preventing a gesture that cannot happen. */
  range.addEventListener('input', () => {
    value = Number(range.value);
    paint();
    onScrub?.();
  });

  /* ==> "LEAVE THE CLOCK" IS ITS OWN CONTROL NOW, AND IT HAS TO BE. <== In
   * slice C a second press of the FAB put the whole season back. The FAB is a
   * play/pause button now, so without this there would be no way out of the
   * clock at all except unticking every storm — a mode with no door.
   *
   * ==> IT REUSES `.drawer-close`'s TREATMENT RATHER THAN BEING A SEVENTH KIND
   * OF BUTTON. <== That rule in `ui/panels.css` is already the app's answer to
   * "a 44px icon button with no chrome": the target, the transparent
   * background, the muted ink, the hover-capability rule and the focus ring are
   * all decided there. `.seasons-clock-leave` is added to that selector group
   * rather than copied out of it, so the two cannot drift.
   *
   * The ✕ path is the drawer header's own, character for character. Two glyphs
   * meaning "close" that are drawn a pixel apart is the kind of difference a
   * reader feels without being able to name. */
  const leaveBtn = document.createElement('button');
  leaveBtn.className = 'seasons-clock-leave';
  leaveBtn.type = 'button';
  leaveBtn.setAttribute('aria-label', 'Leave the season clock');
  const leaveSvg = stroked();
  const leaveMark = document.createElementNS(SVG_NS, 'path');
  leaveMark.setAttribute('d', 'M6 6l12 12M18 6L6 18');
  leaveSvg.append(leaveMark);
  leaveBtn.append(leaveSvg);
  leaveBtn.addEventListener('click', () => disengage());

  /* ==> THE ✕ SITS ON THE SLIDER'S ROW, NOT THE DATE'S, AND THAT IS FREE
   * HEIGHT. <== `.slider` is already `--touch-target` tall, so a 44px button
   * beside it adds nothing to the pill. On the date's line it would have made
   * a 16px line of text into a 44px one and taken 28px of globe for a button
   * that is pressed once.
   *
   * It costs the track about 52px of the 326 the pill has inside its padding
   * on a 390px phone, which leaves roughly 274 — still wider than the 270
   * §57.67g rejected `--pill-inset` for, and that 270 had to hold the date as
   * well. */
  const row = document.createElement('div');
  row.className = 'seasons-clock-row';
  row.append(range, leaveBtn);

  pill.append(dateEl, row);

  /* ------------------------------------------------------------------ state */

  /** The moment the slider is currently pointing at. */
  function at() {
    return momentAt(span, value);
  }

  /** Whether there is anything for the clock to run over at all. A season with
   *  nothing ticked has no timeline, and `clockSpan` answers null when none of
   *  the ticked storms carries a usable fix. */
  function usable() {
    return entries.length > 0 && !!span;
  }

  /** What the slider element itself should be showing. The one place the
   *  position stops being a float. */
  function sliderValue() {
    return String(Math.round(Math.max(0, Math.min(value, SEASONS.clockScrubSteps))));
  }

  /** Redraw the control from the state. Never touches the globe — `onScrub` is
   *  the only thing that does, and only its callers decide when. */
  function paint() {
    /* ==> THE FAB IS ON SCREEN ONLY WHEN STORMS ARE. §57.67a call 1. <== A
     * reader who has ticked nothing must not see a control that would do
     * nothing. `hidden` rather than an opacity fade, because it has to leave
     * the TAB ORDER too — the same trap §13 records the closed drawer hitting
     * and the archive's two suppressed cluster buttons avoiding. */
    fab.hidden = !usable();
    /* ==> TWO FLAGS, BECAUSE THEY SAY TWO DIFFERENT THINGS. <== `data-on` is
     * "the clock is on screen" and carries the background fill; `data-playing`
     * is "the timer is running" and swaps the mark. Engaged-and-paused is an
     * ordinary state — it is what a reader is in the whole time they are
     * dragging the scrubber — and a single flag could not describe it. */
    const running = playhead.running();
    fab.setAttribute('aria-pressed', running ? 'true' : 'false');
    fab.setAttribute('aria-label', running ? 'Pause the season clock' : 'Play the season');
    if (on) fab.setAttribute('data-on', 'true'); else fab.removeAttribute('data-on');
    if (running) fab.setAttribute('data-playing', 'true');
    else fab.removeAttribute('data-playing');

    pill.hidden = !on;
    if (!on) return;

    const words = readoutFor(at());
    dateEl.textContent = words;
    /* A bare "437" is the slider's own number and means nothing to anybody.
     * The same rule the roster's near-home slider already follows. */
    range.setAttribute('aria-valuetext', words);
    const shown = sliderValue();
    if (range.value !== shown) range.value = shown;
  }

  /* ---------------------------------------------------------- the playhead */

  /**
   * ==> THE POSITION MOVES BY REAL ELAPSED TIME, NOT BY A FIXED AMOUNT PER
   * TICK. <== `seasons/clock-playback.js` owns the waking up and says how long
   * it has actually been; this converts that through the one named ratio.
   * `toStormMs` is the only function in the app permitted to apply it
   * (`lib/season-clock.js`), which is the whole architecture the reverted
   * attempt's unit conflation bought.
   *
   * @param {number} realMs  wall-clock milliseconds since the last tick
   */
  function advance(realMs) {
    const steps = SEASONS.clockScrubSteps;
    /* A timeline with no length cannot be advanced along. `clockSpan` floors
     * the span at `clockMinSpanDays` precisely so this cannot happen, so this
     * is a guard against the span going away underneath a running timer —
     * every ticked storm unticked between two wake-ups — rather than against
     * the arithmetic. */
    if (!span || !(span.spanMs > 0)) { pause(); return; }

    value = Math.min(steps, value + (toStormMs(realMs) / span.spanMs) * steps);

    /* ==> IT PLAYS TO THE END AND STOPS THERE. IT DOES NOT LOOP. <== §57.23's
     * whole claim is that the season ACCUMULATES in front of you, so the last
     * frame — every ticked storm's complete track, drawn at once — is the
     * thing the three minutes were spent earning. Wiping it back to an empty
     * globe and starting again would throw that away every three minutes, and
     * §57.23 is explicit that unstoppable motion is a migraine for some
     * readers. The button goes back to ▶ and a press starts the season over.
     */
    if (value >= steps) {
      value = steps;
      /* `stop` before the paint, or the button would be drawn still saying
       * ⏸ over a clock that has finished. */
      playhead.stop();
      paint();
      onScrub?.();
      return;
    }

    paint();
    onScrub?.();
  }

  const playhead = createPlayhead({
    onTick: advance, now, setTimer, clearTimer,
  });

  function play() {
    if (!usable()) return;
    if (!on) engage();
    /* Pressing ▶ at the end of the timeline starts the season over, because
     * there is nowhere else for it to go and a button that does nothing is
     * worse than one that does the obvious thing. */
    if (value >= SEASONS.clockScrubSteps) value = 0;
    playhead.start();
    paint();
    onScrub?.();
  }

  function pause() {
    if (!playhead.running()) return;
    playhead.stop();
    /* No `onScrub`. Pausing does not move the moment, so the globe is already
     * showing the right thing and a push here would be a full re-cut of every
     * ticked storm for no change at all. */
    paint();
  }

  /* ------------------------------------------------------------- the state */

  function engage() {
    if (!usable()) return;
    on = true;
    /* ==> IT STARTS AT THE TIMELINE'S OWN FIRST MOMENT, AND THAT IS NOT QUITE
     * "EMPTY". <== Measured rather than assumed, 2026-08-31: `clockSpan`'s
     * `from` IS the earliest ticked storm's first fix, and `stormStateAt` calls
     * a storm `unborn` only BEFORE that fix — so at position 0 the storm which
     * opens the timeline stands on its first recorded position and every other
     * ticked storm is unborn and draws nothing.
     *
     * That is the honest answer and it is why it is not adjusted. Backing the
     * left end off to a moment before the record would give a genuinely blank
     * globe at the cost of a date nobody ever wrote down. One dot on the first
     * thing that happened is what the record actually claims, and §57.23's
     * accumulation still reads: everything else fills in from there. */
    value = 0;
    document.documentElement.setAttribute(ROOT_FLAG, 'on');
    /* ==> IT PAINTS NOTHING AND PUSHES NOTHING, WHICH IT DID IN SLICE C. <==
     * Every road into the clock now goes through `play()`, and that one paints
     * and pushes on its way out. Leaving them here as well would hand the
     * globe two full re-cuts of every ticked storm for one press — invisible,
     * because the second is identical to the first, and paid on the frame a
     * reader is already asking the most of. */
  }

  function disengage() {
    if (!on) return;
    pause();
    on = false;
    /* ==> IT DOES NOT RESET THE POSITION, AND THAT IS NOT AN OMISSION. <==
     * `engage` does, and `engage` is on the only road back in — `play` is the
     * single entry point and it engages before it starts. A second reset here
     * was written first and a mutation proved it dead: deleting it left every
     * assertion green, because a position held while the clock is DOWN is a
     * position nothing can read. `cut()` answers null, the pill is hidden, and
     * the slider is off screen. Two owners for "start over" is how the two
     * drift apart later. */
    document.documentElement.removeAttribute(ROOT_FLAG);
    paint();
    onScrub?.();
  }

  /** The FAB. ==> IT IS PLAY/PAUSE NOW AND NOT ON/OFF. <== A press with the
   *  clock down engages it AND starts it, because that is what a play triangle
   *  promises; the way back out is the ✕ in the pill. */
  function toggle() {
    if (playhead.running()) pause(); else play();
  }

  /* ------------------------------------------------------- outside the pill */

  /**
   * ==> SPACE PLAYS AND PAUSES, AND IT IS THE SAME PRESS AS THE BUTTON. §57.23.
   * <== One function behind both, so the keyboard cannot drift into being a
   * second, slightly different clock — the failure §57.37's two halves of the
   * drawer toggle record.
   *
   * ==> IT STANDS DOWN WHEN THE READER IS ON A CONTROL OR IN A FIELD, AND BOTH
   * HALVES OF THAT ARE REAL. <== Space on a focused `<button>` already fires a
   * click, so handling it here as well would toggle the clock twice for one
   * press and land back where it started — with the FAB itself being the most
   * likely thing to have focus, since pressing it is how the reader got here.
   * And `ui/home-search.js` has a text field: a reader typing a place name
   * with two words must get a space rather than a season.
   *
   * The `<input type="range">` is deliberately in that list too. Space does
   * nothing to a range natively, but a reader who has tabbed to the scrubber is
   * driving the position by hand and the arrow keys are theirs — swallowing
   * Space from under them to start playback would move the thing they are
   * holding.
   */
  function onKeydown(e) {
    if (!e) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== ' ' && e.key !== 'Spacebar' && e.code !== 'Space') return;
    const tag = String(e.target?.tagName || '').toLowerCase();
    if (tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.target?.isContentEditable) return;
    if (!usable()) return;
    e.preventDefault?.();
    toggle();
  }

  /**
   * ==> THE CLOCK PAUSES WHEN THE PAGE GOES AWAY, AND THAT IS THE PRICE OF
   * PACING ON REAL TIME. <== `advance` converts however long it has actually
   * been, which is the right answer while somebody is watching and the wrong
   * one the moment they are not: a phone locked for five minutes is five
   * storm-months, so the reader unlocks it to find the season already over and
   * no idea why. Browsers also throttle a hidden page's timers to about once a
   * second, so the alternative is not smooth playback in the background — it is
   * a slideshow nobody can see, spending battery on a globe that is not on
   * screen (§9).
   *
   * ==> AND IT IS A PAUSE RATHER THAN A CATCH-UP CAP, ON PURPOSE. <== Capping
   * how much one tick may advance would need a number nothing in this sandbox
   * can measure, and it would half-solve the same problem: the season would
   * still crawl forward while nobody watched. One mechanism, no magic figure.
   * If a real phone shows a jump this does not cover, the cap is the dial.
   *
   * There is no auto-resume. Coming back to a clock that is standing still with
   * ▶ showing is a state the reader can see and undo; coming back to one that
   * silently restarted is a screen that did something while they were gone.
   */
  function onVisibility() {
    if (document.visibilityState === 'hidden') pause();
  }

  return {
    mount() {
      /* ==> FIRST IN THE CLUSTER, WHICH IS ABOVE EVERYTHING ELSE IN IT. <==
       * Aaron's call 1. `#controls` is a column flex container and DOM order is
       * both the visual order and the tab order — nothing positions those
       * buttons by index — so prepending puts the play control at the top of
       * the stack and first in the keyboard walk in one move. In the archive
       * the stack under it is recentre, storms, settings; home and layers are
       * suppressed (§57.37).
       *
       * A missing `#controls` is not an error worth throwing over: the pill
       * still mounts and the clock is simply unreachable, which is no worse
       * than the archive without this slice. */
      document.getElementById('controls')?.prepend(fab);
      document.body.appendChild(pill);
      /* ==> BOTH OF THESE ARE ON THE DOCUMENT AND BOTH COME OFF IN `unmount`.
       * <== Space has to work with focus anywhere — on the globe, on a roster
       * row, on nothing at all — which is `attachEscape`'s argument in
       * `map/globe.js` for exactly the same reason. A listener bound to the
       * pill would only work once the reader had already found the pill.
       *
       * Optional-called because the archive's suites drive this against a
       * stand-in document, and a component that threw on mount for want of an
       * event system would read as broken rather than as unscaffolded. */
      document.addEventListener?.('keydown', onKeydown);
      document.addEventListener?.('visibilitychange', onVisibility);
      paint();
    },

    unmount() {
      /* ==> THE ROOT FLAG COMES OFF HERE AND NOT ONLY IN `disengage`. <==
       * Leaving the archive with the clock engaged would otherwise leave
       * `data-seasons-clock="on"` on the document, and with it the rule that
       * hides the LIVE app's furniture. `seasons/index.js` tears this down
       * before it removes `data-seasons`, so the two come off in the order
       * they went on. */
      /* ==> THE TIMER DIES FIRST, AND IT IS THE ONE THING HERE THAT OUTLIVES
       * THE ELEMENTS. <== A pending `setTimeout` holds this whole closure
       * alive; left running it would wake up after the reader had left the
       * archive and push a historical cut at a live globe that has been shown
       * again. Removing the button is not what stops the clock — this is. */
      playhead.stop();
      document.removeEventListener?.('keydown', onKeydown);
      document.removeEventListener?.('visibilitychange', onVisibility);
      on = false;
      document.documentElement.removeAttribute(ROOT_FLAG);
      fab.remove();
      pill.remove();
    },

    /**
     * The board's ticked set changed.
     *
     * ==> A CHANGE TO THE SET RESETS THE MOMENT, AND THE COST IS REAL. <==
     * §57.67c: the timeline is the ticked storms' own window, so ticking a
     * fifth storm moves both ends and a held position would silently mean a
     * different date. Carrying it across is the only alternative and it is
     * worse — the slider would sit still while the date under it jumped. So
     * ticking mid-scrub sends the reader back to the start of the new
     * timeline, which is at least a thing they can see happen.
     */
    setEntries(list) {
      entries = Array.isArray(list) ? list : [];
      span = clockSpan(entries);

      const next = entries.map((e) => e?.storm?.id ?? '?').join('|');
      if (next !== signature) {
        signature = next;
        value = 0;
      }

      /* Nothing left to run over — the reader unticked the last storm, or
       * stepped to a year and emptied the globe. The clock cannot stay engaged
       * over an empty timeline, and leaving the pill up would be a scrubber
       * with nothing behind it. */
      if (!usable() && on) {
        disengage();
        return;
      }
      paint();
    },

    /**
     * The cut for this moment, or null when the clock is not engaged.
     *
     * ==> NULL IS NOT A STATE, IT IS THE ABSENCE OF ONE. <== `season-cut.js`
     * answers "all of it" to a missing cut and `tools/test-season-cut.mjs`
     * proves that is byte-identical to the archive before the clock existed.
     * So a caller never has to ask whether the clock is on; it asks for a cut
     * and pushes whatever it gets.
     */
    cut() {
      if (!on || !span) return null;
      const frame = clockFrameAt(entries, at());
      const map = new Map();
      for (const s of frame.storms) if (s.id) map.set(s.id, s.state);
      return map;
    },

    engaged() {
      return on;
    },

    /** Whether the timer is running. Separate from `engaged` because
     *  engaged-and-paused is the state a reader is in while they drag. */
    playing() {
      return playhead.running();
    },
  };
}
