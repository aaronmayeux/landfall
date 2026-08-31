/**
 * clock-playback.js — the thing that wakes up ten times a second. §57.23,
 * §57.67 slice D.
 *
 * ==> IT KNOWS ABOUT TIME AND NOTHING ELSE. <== No position, no span, no
 * storms, no DOM. It answers one question — how long has it been since the last
 * time I asked you — and hands that number to whoever asked for it, until they
 * say stop. `seasons/clock-control.js` is what turns that number into a moment.
 *
 * ==> IT IS ITS OWN FILE BECAUSE §12's CEILING SAID SO, AND THE SEAM IT FOUND
 * WAS A REAL ONE. <== Adding playback took `clock-control.js` to 719 lines and
 * `doc-check` refused it. The cut was not arbitrary: scheduling and position
 * are two concerns that share exactly one number between them, they fail in
 * completely different ways — a stuck timer versus a season running at the
 * wrong pace — and slice E adds a moving glyph to the position side without
 * touching this side at all.
 *
 * Imports one constant helper and nothing else.
 */

import { stepRealMs } from '../lib/season-clock.js';

/**
 * ==> A CHAIN OF `setTimeout`, NOT A `setInterval`, AND THE DIFFERENCE MATTERS
 * ON A PHONE. <== Each tick ends in new geometry being pushed into three
 * MapLibre sources, and `setInterval` fires whether or not the last one has
 * finished — so a device that cannot keep up accumulates a backlog of work it
 * will never catch up on, which is how a slow app becomes a stuck one. The next
 * wake-up is scheduled only after the current tick's work is done, so a slow
 * phone simply runs at fewer steps a second. That is §57.35 fault 3's own
 * instruction: if the numbers say no, the fallback is fewer steps, never a
 * smaller feature.
 *
 * ==> AND THE TICK IS HANDED ELAPSED TIME RATHER THAN A COUNT. <== §57.67c. The
 * promise is `SEASONS.clockDaysPerSecond` — a day of storm time per second of
 * real time — and that is a promise about the wall clock. A loop that advanced
 * by a constant on every wake-up would keep it only while every wake-up was
 * punctual, and browser timers are not: a busy main thread, a mid-drag repaint
 * or a background tab all deliver a late one, and the season would then run
 * slow by however late they were, cumulatively, with nothing on screen saying
 * so. The reverted attempt's whole failure was a unit going unnoticed; the
 * defence is to measure rather than to count.
 *
 * @param {object} opts
 * @param {(realMs:number) => void} opts.onTick
 *   Called with the real milliseconds since the previous tick. It may call
 *   `stop()` from inside itself — reaching the end of the timeline does — and
 *   no further tick is scheduled if it does.
 * @param {() => number} [opts.now]  monotonic real milliseconds.
 * @param {(fn:Function, ms:number) => any} [opts.setTimer]
 * @param {(handle:any) => void} [opts.clearTimer]
 * @returns {{start:()=>void, stop:()=>void, running:()=>boolean}}
 */
export function createPlayhead({
  onTick,
  /* `performance.now` rather than `Date.now`, because it is monotonic: a system
   * clock correction mid-playback would otherwise hand the loop a negative or
   * an enormous elapsed time and jump the season. The fallback is for an
   * environment without it, not for a browser. */
  now = () => (typeof performance !== 'undefined' && performance.now
    ? performance.now() : Date.now()),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
} = {}) {
  let running = false;
  let timer = null;
  let last = 0;

  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule() {
    cancel();
    timer = setTimer(fire, stepRealMs());
  }

  function fire() {
    timer = null;
    if (!running) return;
    const t = now();
    /* Guarded rather than trusted. A negative elapsed time would run the season
     * BACKWARDS, which reads as the app being broken rather than as a clock
     * being odd. */
    const elapsed = Math.max(0, t - last);
    /* ==> STAMPED BEFORE THE WORK, NEVER AFTER IT. <== `onTick` pushes geometry
     * at three map layers and that takes real milliseconds. Stamping after it
     * would drop every one of those on the floor: the next tick would report
     * only the gap between the end of one piece of work and the start of the
     * next, and the season would run SLOW by exactly the cost of drawing it —
     * worst on the phones least able to afford it, which is the shape of bug
     * that reads as "the app feels sluggish" rather than as a wrong number.
     * Stamped here, no real time is unaccounted for. */
    last = t;
    onTick?.(elapsed);
    /* `onTick` is allowed to stop us — reaching the end of the timeline does
     * exactly that — so this is asked again rather than assumed. */
    if (running) schedule();
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = now();
      schedule();
    },

    stop() {
      if (!running) return;
      running = false;
      cancel();
    },

    running: () => running,
  };
}
