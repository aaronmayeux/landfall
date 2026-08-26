/**
 * seasons-clock-bar.js — the clock's controls. §57.23, §57.30 step 10.
 *
 * ==> IT FOLDS INTO THE BAR THAT IS ALREADY THERE RATHER THAN ADDING A STRIP.
 * <== Aaron's call, 2026-08-26. The archive globe's only chrome is
 * `seasons/bar.js` — the storms, home and layers buttons are all hidden inside
 * this mode (§57.16a) — and a second horizontal strip on a 390 px phone costs
 * globe, which is the whole screen. So the controls sit in the bar the reader
 * is already reading, on their own line beneath the sentence.
 *
 * ==> IT IS A `<button>` AND AN `<input type="range">`, WHICH IS WHY THERE IS
 * ALMOST NO KEY HANDLING IN HERE. <== §13 wants tap, click and keyboard on one
 * path. A real button answers Enter and Space for free; a real range answers
 * arrows, Home and End for free, and announces itself to a screen reader with
 * a value and a range without being told. Building either out of a `div` means
 * writing all of that by hand and getting some of it wrong. The ONE key this
 * file handles is Space-to-play from elsewhere in the bar, and it is handled
 * because §57.23 asks for it.
 *
 * ==> THE DATE IS THE CONTROL'S ONLY OUTPUT AND IT IS A FIXED WIDTH. <== A
 * readout that resizes as the month name changes drags the scrub bar left and
 * right underneath the reader's thumb while they are dragging it, which is the
 * kind of fault that reads as the app being broken. `font-variant-numeric` and
 * a min-width in the stylesheet hold it still.
 *
 * NO HARDCODED COLOUR AND NO PIXEL LITERAL, same as the bar it lives in: every
 * value is a custom property `applyTokens` already publishes, which is also
 * what makes these controls go sepia on their own when the palette is forced.
 *
 * Imports lib/ only. It is DOM plus one formatter; `seasons/index.js` owns
 * when it exists and the engine owns what it says.
 */

import { formatArchiveMoment } from '../lib/season-clock-words.js';

/**
 * Build the controls. Not mounted — the caller decides where they go.
 *
 * @param {object} opts
 * @param {() => void} opts.onToggle        play or pause
 * @param {(ms:number) => void} opts.onSeek  the reader aimed at a moment
 * @returns {{el:HTMLElement, setState:(s:object)=>void, handleKey:(e:KeyboardEvent)=>boolean}}
 */
export function createSeasonsClockBar({ onToggle, onSeek }) {
  const el = document.createElement('div');
  el.className = 'seasons-clock';
  /* A group rather than a region: it is a cluster of controls inside the bar's
   * own landmark, not a second place to navigate to. */
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Season clock');

  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'seasons-clock-play';
  play.addEventListener('click', () => onToggle?.());

  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.className = 'seasons-clock-scrub';
  /* ==> THE RANGE IS 0-1000 STEPS AND NOT MILLISECONDS. <== A range whose max
   * is an epoch timestamp is a control with 1.7 trillion positions in it,
   * which browsers handle by quantising somewhere nobody chose. A thousand
   * steps across a season is finer than a phone screen can resolve and finer
   * than the six-hourly data underneath it, so nothing is lost. */
  scrub.min = '0';
  scrub.max = '1000';
  scrub.step = '1';
  scrub.setAttribute('aria-label', 'Scrub through the season');

  const readout = document.createElement('span');
  readout.className = 'seasons-clock-date';
  /* It changes ten times a second while playing. `role="status"` would make a
   * screen reader announce every one of them, which is unusable — so the live
   * value is carried by the RANGE's own `aria-valuetext` instead, which is
   * announced only when the reader moves it. */
  readout.setAttribute('aria-hidden', 'true');

  el.append(play, scrub, readout);

  /** The span the scrub bar is currently mapped onto. Held so the input's
   *  0-1000 position can be turned back into a moment without asking the
   *  engine, which would be a circular call from inside its own event. */
  let startMs = null;
  let endMs = null;

  scrub.addEventListener('input', () => {
    if (startMs === null || endMs === null) return;
    const f = Number(scrub.value) / 1000;
    onSeek?.(startMs + (endMs - startMs) * f);
  });

  return {
    el,

    /**
     * Redraw from the engine's state. Called on every step, so it does as
     * little as possible: two text writes and one attribute.
     *
     * ==> THE SCRUB POSITION IS NOT WRITTEN WHILE THE READER IS HOLDING IT.
     * <== Writing `value` on an input the thumb is on fights the drag — the
     * control jumps back to the engine's idea of the moment between the
     * `input` event and the engine answering. `document.activeElement` is the
     * cheap honest test for "this is the thing being driven".
     */
    setState(s) {
      const on = Boolean(s?.available);
      el.hidden = !on;
      /* ==> THE BAR HAS TO GET TALLER, AND THE DRAWER READS THAT OFF <html>.
       * <== `--seasons-bar-h` is what the drawer and the control cluster sit
       * above, and neither is a sibling of this element — so the fact that a
       * second row exists is published as an attribute, exactly as
       * `seasons/bar.js` publishes `data-seasons`. Without it the controls
       * draw and the drawer sits on top of them, which `tools/css-orphan-
       * check.mjs` caught before glass did.
       *
       * Written on every state change rather than only on the transition: it
       * is one attribute set to the value it already has, which costs nothing
       * and cannot drift out of step with `el.hidden`. */
      if (on) document.documentElement.setAttribute('data-seasons-clock', 'on');
      else document.documentElement.removeAttribute('data-seasons-clock');
      if (!on) { startMs = null; endMs = null; return; }

      startMs = s.startMs;
      endMs = s.endMs;

      const label = s.playing ? 'Pause' : (s.atEnd ? 'Play again' : 'Play');
      play.textContent = label;
      play.setAttribute('aria-label', `${label} the season clock`);
      /* `aria-pressed` rather than a second button: it is one control with two
       * states, and a screen reader is told which one it is in. */
      play.setAttribute('aria-pressed', s.playing ? 'true' : 'false');

      const words = formatArchiveMoment(s.cutMs);
      readout.textContent = words;
      scrub.setAttribute('aria-valuetext', words);

      if (document.activeElement !== scrub) {
        const span = endMs - startMs;
        scrub.value = String(span > 0 ? Math.round(((s.cutMs - startMs) / span) * 1000) : 0);
      }
    },

    /**
     * Space plays and pauses. §57.23.
     *
     * ==> IT REFUSES WHEN THE READER IS ON A CONTROL THAT ALREADY USES SPACE.
     * <== Space on the scrub bar, the Leave button or a roster checkbox means
     * what those controls mean, and stealing it would break the ordinary
     * keyboard path to save one keystroke on the clock. Returns whether it
     * acted, so the caller knows whether to swallow the event.
     */
    handleKey(e) {
      if (!e || e.key !== ' ' || e.repeat) return false;
      if (el.hidden) return false;
      const t = e.target;
      const tag = t?.tagName?.toLowerCase?.();
      if (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea') return false;
      if (t?.isContentEditable) return false;
      onToggle?.();
      return true;
    },
  };
}
