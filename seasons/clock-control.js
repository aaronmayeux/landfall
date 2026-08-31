/**
 * clock-control.js — the archive's season clock, as a control. §57.23,
 * §57.67 slice C.
 *
 * ==> WHAT THIS SLICE IS AND, MORE IMPORTANTLY, WHAT IT IS NOT. <== It is a
 * button in the control cluster and a slider in the bottom pill. Drag the
 * slider and the season grows and shrinks under a date readout. **There is no
 * timer in this file and no animation loop anywhere in it.** Slice D adds
 * those, driving the same position this one already proves.
 *
 * That split is the whole reason step 10 is being built in slices. The
 * 2026-08-26 attempt put the engine, the controls, the globe cut, the colouring
 * and the keyboard into one commit, reached Aaron's phone as an empty world,
 * and went back whole — three defects with nothing to bisect. `lib/season-
 * clock.js` (slice A) and `map/layers/season-cut.js` (slice B) are each already
 * proven on their own with no browser. This is the first slice that can be
 * wrong on glass, and if it is, the two under it are not suspects.
 *
 * ==> AARON'S CALL, 2026-08-31, AND IT MOVES ONE THING OUT OF §57.67a. <== The
 * play control lives in the FAB and ONLY the scrubber goes in the pill. §57.67a
 * call 2 had put both in the pill; a 390px pill holding a play button, a slider
 * and a date is three things fighting over one lozenge, and the slider is the
 * one that needs the width.
 *
 * **So in this slice the FAB is an on/off switch — ▶ off, ■ on — because there
 * is nothing yet to pause.** Slice D turns that same button into ▶/⏸ and moves
 * "leave the clock" to a control in the pill. That is one button changing
 * meaning once, in the commit that introduces motion; the alternative was
 * shipping a FAB here that does nothing after its first press.
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
 * Imports `config/`, `lib/season-clock.js` and one formatter. DOM only; no map,
 * no data, no network.
 */

import { SEASONS } from '../config/constants.js';
import { clockSpan, clockFrameAt } from '../lib/season-clock.js';
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
 * @param {object} opts
 * @param {() => void} opts.onScrub  the cut changed; push the globe again.
 * @returns {{
 *   mount:()=>void, unmount:()=>void,
 *   setEntries:(entries:Array)=>void,
 *   cut:()=>Map<string,object>|null,
 *   engaged:()=>boolean,
 * }}
 */
export function createSeasonClock({ onScrub } = {}) {
  /** The ticked storms, as the board last reported them. */
  let entries = [];
  /** Their own window, from `clockSpan`, or null when none of them has a
   *  usable fix. */
  let span = null;
  /** Whether the reader has pressed the FAB. */
  let on = false;
  /** The slider's position, held as its own whole number so that re-resolving
   *  it against a new span is the only thing that has to happen when the
   *  ticked set changes. */
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
  const playSvg = document.createElementNS(SVG_NS, 'svg');
  playSvg.setAttribute('class', 'clock-play');
  playSvg.setAttribute('viewBox', '0 0 24 24');
  playSvg.setAttribute('aria-hidden', 'true');
  const playMark = document.createElementNS(SVG_NS, 'path');
  playMark.setAttribute('d', 'M8.5 5.5 L18 12 L8.5 18.5 Z');
  playMark.setAttribute('fill', 'currentColor');
  playSvg.append(playMark);

  const stopSvg = document.createElementNS(SVG_NS, 'svg');
  stopSvg.setAttribute('class', 'clock-stop');
  stopSvg.setAttribute('viewBox', '0 0 24 24');
  stopSvg.setAttribute('aria-hidden', 'true');
  const stopMark = document.createElementNS(SVG_NS, 'rect');
  stopMark.setAttribute('x', '7');
  stopMark.setAttribute('y', '7');
  stopMark.setAttribute('width', '10');
  stopMark.setAttribute('height', '10');
  stopMark.setAttribute('rx', '1.5');
  stopMark.setAttribute('fill', 'currentColor');
  stopSvg.append(stopMark);

  fab.append(playSvg, stopSvg);
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

  pill.append(dateEl, range);

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

  /** Redraw the control from the state. Never touches the globe — `onScrub` is
   *  the only thing that does, and only its callers decide when. */
  function paint() {
    /* ==> THE FAB IS ON SCREEN ONLY WHEN STORMS ARE. §57.67a call 1. <== A
     * reader who has ticked nothing must not see a control that would do
     * nothing. `hidden` rather than an opacity fade, because it has to leave
     * the TAB ORDER too — the same trap §13 records the closed drawer hitting
     * and the archive's two suppressed cluster buttons avoiding. */
    fab.hidden = !usable();
    fab.setAttribute('aria-pressed', on ? 'true' : 'false');
    fab.setAttribute('aria-label', on ? 'Stop the season clock' : 'Play the season');
    if (on) fab.setAttribute('data-on', 'true'); else fab.removeAttribute('data-on');

    pill.hidden = !on;
    if (!on) return;

    const words = readoutFor(at());
    dateEl.textContent = words;
    /* A bare "437" is the slider's own number and means nothing to anybody.
     * The same rule the roster's near-home slider already follows. */
    range.setAttribute('aria-valuetext', words);
    if (range.value !== String(value)) range.value = String(value);
  }

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
    paint();
    onScrub?.();
  }

  function disengage() {
    if (!on) return;
    on = false;
    document.documentElement.removeAttribute(ROOT_FLAG);
    paint();
    onScrub?.();
  }

  function toggle() {
    if (on) disengage(); else engage();
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
      paint();
    },

    unmount() {
      /* ==> THE ROOT FLAG COMES OFF HERE AND NOT ONLY IN `disengage`. <==
       * Leaving the archive with the clock engaged would otherwise leave
       * `data-seasons-clock="on"` on the document, and with it the rule that
       * hides the LIVE app's furniture. `seasons/index.js` tears this down
       * before it removes `data-seasons`, so the two come off in the order
       * they went on. */
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
  };
}
