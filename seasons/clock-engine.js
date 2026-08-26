/**
 * clock-engine.js — the thing that ticks. §57.23, §57.30 step 10.
 *
 * ==> IT KNOWS WHAT TIME IT IS AND NOTHING ELSE. <== No DOM, no map, no
 * knowledge of storms beyond the span it was handed. `lib/season-clock.js`
 * works out what a moment LOOKS like; `ui/seasons-clock-bar.js` shows the
 * controls; `seasons/index.js` wires the three together. Three files rather
 * than one because the pieces fail differently: this one can only be wrong
 * about timing, and timing is the part a suite can drive without a browser by
 * handing it a fake clock.
 *
 * ==> IT STEPS ON WALL TIME, NOT ON FRAMES. §57.35 fault 3. <== The loop is
 * `requestAnimationFrame` because that is the only way to stop cleanly when a
 * tab is hidden, but a frame does NOT mean a step: the callback checks how much
 * real time has gone by and does nothing at all unless a whole step is owed.
 * At 60 fps and 10 steps a second that is five frames out of six doing
 * nothing, which is the point — the expensive work is handing MapLibre new
 * geometry, and it happens ten times a second rather than sixty.
 *
 * ==> A LONG GAP IS SKIPPED, NEVER CAUGHT UP. <== Backgrounding the tab, or a
 * device sleeping, leaves `rAF` unpaid for minutes. Advancing the clock by the
 * missed time would fast-forward the season past everything the reader wanted
 * to see; running the missed steps one by one would lock the phone solid on
 * the frame it woke up. So a gap longer than `catchUpSteps` steps is treated
 * as a pause: the clock resumes from where it was.
 *
 * ==> AND IT NEVER STARTS ON ITS OWN. <== Nothing here moves until somebody
 * presses play, which is also why there is no reduced-motion branch in this
 * file: the setting exists to stop motion nobody asked for, and there is none.
 * Aaron's call, 2026-08-26.
 *
 * Imports config/ and lib/ only.
 */

import { SEASONS } from '../config/constants.js';
import { msPerStep } from '../lib/season-clock.js';

/** How many steps' worth of missed time is a stutter to be absorbed rather
 *  than a sleep to be skipped. Three is about a third of a second at the
 *  shipping cadence — long enough to ride out a slow frame or a garbage
 *  collection, short enough that a backgrounded tab is never mistaken for one. */
const CATCH_UP_STEPS = 3;

/**
 * @param {object} opts
 * @param {(cutMs:number) => void} opts.onStep    the globe redraws
 * @param {(state:object) => void} [opts.onState] the controls redraw
 * @param {() => number} [opts.now]               injectable, for suites
 * @param {(cb:Function) => number} [opts.raf]    injectable, for suites
 * @param {(id:number) => void} [opts.cancel]
 */
export function createClockEngine({ onStep, onState, now, raf, cancel } = {}) {
  const clock = now || (() => Date.now());
  const schedule = raf || ((cb) => globalThis.requestAnimationFrame?.(cb));
  const unschedule = cancel || ((id) => globalThis.cancelAnimationFrame?.(id));

  /** The span the clock runs over, or null when nothing is ticked. Replaced
   *  wholesale on every selection change — see `setSpan`. */
  let span = null;
  /** Where the clock is, in storm time. Null means "at the beginning", which
   *  is not the same as `span.startMs`: a null survives a span change and
   *  keeps meaning the beginning, where a copied number would suddenly mean
   *  a moment in the middle of a differently-sized season. */
  let cutMs = null;
  let playing = false;
  let frame = null;
  let lastTickMs = 0;
  /** Set when playback runs off the end. Held rather than acted on so the last
   *  frame stays on screen for `clockEndHoldMs` before the clock stops — see
   *  the constant. */
  let endedAtMs = 0;

  const stepMs = () => msPerStep(SEASONS.clockDaysPerSecond, SEASONS.clockStepsPerSecond);
  const at = () => (cutMs === null ? span?.startMs ?? 0 : cutMs);

  function state() {
    return {
      available: Boolean(span),
      playing,
      startMs: span?.startMs ?? null,
      endMs: span?.endMs ?? null,
      cutMs: span ? at() : null,
      /* ==> `atEnd` IS ITS OWN FACT AND NOT `cutMs === endMs`. <== The bar
       * needs to know whether pressing play would resume or restart, and after
       * a scrub to the last pixel those two are the same number while the
       * reader has NOT watched the season. Keeping it separate means the
       * button's label is about what the reader did, not about a coordinate. */
      atEnd: Boolean(span) && at() >= span.endMs,
    };
  }

  const announce = () => { try { onState?.(state()); } catch { /* the controls are not worth an exception */ } };

  function emit() {
    if (!span) return;
    try { onStep?.(at()); } catch { /* a bad frame must not stop the clock */ }
  }

  function loop() {
    frame = null;
    if (!playing || !span) return;

    const wall = clock();
    /* ==> TWO STEPS, TWO UNITS, AND CONFLATING THEM IS THE BUG THIS PROJECT
     * KEEPS SHIPPING. <== `wallStep` is how often a step is DUE, in real
     * milliseconds. `stormStep` is how far the clock MOVES when one is, in
     * milliseconds of 2005. They differ by five orders of magnitude, and the
     * first version of this loop divided elapsed wall time by `stormStep` —
     * which needs two and a half hours of real time to owe a single step, so
     * the clock simply never moved. Nothing about it looked wrong: both are
     * milliseconds, both come from the same constants block, and the
     * arithmetic is correct in isolation. `tools/test-season-clock.mjs`
     * caught it by driving the engine on a fake clock and asking how far it
     * had got. CLAUDE.md's rule about computing figures rather than writing
     * them is the same rule one level up. */
    const wallStep = SEASONS.clockStepsPerSecond > 0 ? 1000 / SEASONS.clockStepsPerSecond : 0;
    const stormStep = stepMs();
    const owed = wallStep > 0 ? Math.floor((wall - lastTickMs) / wallStep) : 0;

    if (owed > 0) {
      /* The gap rule, above. Beyond the catch-up window the missed time is
       * discarded rather than played or skipped through. */
      const moves = owed > CATCH_UP_STEPS ? 1 : owed;
      lastTickMs = wall;

      const next = at() + stormStep * moves;
      if (next >= span.endMs) {
        cutMs = span.endMs;
        emit();
        if (!endedAtMs) { endedAtMs = wall; announce(); }
        else if (wall - endedAtMs >= SEASONS.clockEndHoldMs) { playing = false; announce(); return; }
      } else {
        cutMs = next;
        emit();
      }
    }

    frame = schedule(loop);
  }

  function start() {
    if (frame === null && playing) {
      lastTickMs = clock();
      frame = schedule(loop);
    }
  }

  function stop() {
    if (frame !== null) { unschedule(frame); frame = null; }
  }

  return {
    state,

    /**
     * The clock now runs over this span. Called on every selection change.
     *
     * ==> A CHANGED SPAN RESETS THE CLOCK RATHER THAN CLAMPING IT. <== Aaron's
     * call was that the clock covers the TICKED storms' own span, so ticking a
     * fifth storm can move both ends of the timeline. Carrying the old moment
     * across means the same wall position now points at a different date, and
     * on a shortened span it can point past the end — so a reader who ticks
     * one more storm mid-playback would see the clock jump somewhere
     * arbitrary. Starting over is honest and it is one press to get back.
     *
     * An unchanged span is a no-op, which matters: `onSelection` fires on
     * filter changes and focus changes too, and resetting the clock because
     * somebody narrowed the roster to Majors would be a bug.
     */
    setSpan(next) {
      const same = span && next && span.startMs === next.startMs && span.endMs === next.endMs;
      if (same) return;
      span = next && Number.isFinite(next.startMs) && Number.isFinite(next.endMs) && next.endMs > next.startMs
        ? { startMs: next.startMs, endMs: next.endMs }
        : null;
      cutMs = null;
      endedAtMs = 0;
      if (!span && playing) { playing = false; stop(); }
      announce();
      /* ==> IT DOES NOT DRAW. §57.23's first line: STATIC TRACKS ARE THE
       * DEFAULT. <== This used to `emit()` here, which put the globe under the
       * clock the instant a span existed — at the opening moment, where every
       * storm is unborn or one vertex old. Ticking four storms therefore drew
       * an empty world. The caller pushes whole tracks on every tick and the
       * clock takes over only once somebody engages it. */
    },

    play() {
      if (!span || playing) return;
      /* At the end, play means play AGAIN. Nothing else in this app has a
       * separate restart control and adding one for a clock nobody has watched
       * twice would be furniture. */
      if (at() >= span.endMs) cutMs = span.startMs;
      endedAtMs = 0;
      playing = true;
      /* ==> THE FIRST DRAW HAPPENS ON THE PRESS, NOT ON THE FIRST STEP. <==
       * Until the reader engages, the globe is showing WHOLE tracks (§57.23's
       * default). Waiting for the loop to owe a step would leave the finished
       * season on screen for a tenth of a second and then snap it back to the
       * beginning, which reads as a stutter on the one press this feature is
       * about. */
      emit();
      announce();
      start();
    },

    pause() {
      if (!playing) return;
      playing = false;
      endedAtMs = 0;
      stop();
      announce();
    },

    toggle() { if (playing) this.pause(); else this.play(); },

    /**
     * Put the clock at this moment. The scrub bar and the arrow keys.
     *
     * ==> SCRUBBING WHILE PLAYING KEEPS PLAYING. <== Dragging to a moment and
     * having playback stop is the behaviour of a control that thinks it was
     * interrupted. This one was aimed.
     */
    seek(ms) {
      if (!span || !Number.isFinite(ms)) return;
      cutMs = Math.min(span.endMs, Math.max(span.startMs, ms));
      endedAtMs = 0;
      /* The wall clock is re-based, or the step owed from before the scrub is
       * paid immediately after it and the clock lurches forward. */
      lastTickMs = clock();
      emit();
      announce();
    },

    /** One recorded observation forward or back. §13's keyboard path. */
    nudge(dir) {
      if (!span) return;
      this.seek(at() + SEASONS.clockNudgeMs * (dir < 0 ? -1 : 1));
    },

    /** Leaving the archive. Everything goes, including the span, so a reader
     *  who comes back to a different year cannot find last year's clock still
     *  holding a moment that does not exist in it. */
    destroy() {
      playing = false;
      stop();
      span = null;
      cutMs = null;
      endedAtMs = 0;
    },
  };
}
