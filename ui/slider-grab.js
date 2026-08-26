/**
 * slider-grab.js — a range slider moves only when you GRAB ITS THUMB.
 *
 * ==> THE PROBLEM. <==
 *
 * `<input type="range">` commits a value on the PRESS, before any movement,
 * anywhere along its track. On a desktop that is a feature: click the track,
 * the thumb jumps there. Inside a settings sheet you scroll with your thumb it
 * is a trap — the finger comes down on a slider on its way past, and the
 * setting changes. `touch-action: pan-y` does not save you: it decides who
 * gets the DRAG, and the damage was already done on the touch down.
 *
 * ==> WHAT THIS DOES. <==
 *
 * On pointer down it works out where the thumb currently is and how wide it
 * is, and if the press landed outside that circle (plus `SLIDER.grabSlopPx`)
 * it refuses the whole gesture. Track presses do nothing at all now. Grabbing
 * the thumb behaves exactly as it always did — this file gets out of the way
 * completely and the native control does the dragging.
 *
 * ==> WHY IT IS BELT AND BRACES. <==
 *
 * `preventDefault()` on `pointerdown` stops the native manipulation in the
 * engines that route sliders through pointer events, and the `mousedown`
 * handler covers the ones that do not. But engine behaviour here is not
 * uniform and cannot be tested from this sandbox, so there is a third guard:
 * if a value change escapes anyway, the `input` listener puts the old value
 * back and swallows the event in the CAPTURE phase, before the settings view's
 * own delegated listener on the same host can hear it. Worst case the thumb
 * flickers for a frame; the stored setting never moves.
 *
 * ==> WHAT IT DELIBERATELY DOES NOT TOUCH. <==
 *
 *  - THE KEYBOARD. Arrows, Home/End and PageUp/Down produce `input` events
 *    with no pointer gesture in flight, so the guard is inert for them. A
 *    keyboard user gets finer control than a finger does, which is the right
 *    way round.
 *  - SCROLLING. `preventDefault()` on `pointerdown` does not cancel a scroll —
 *    only `touch-action` can, and panels.css still says `pan-y`. Refusing the
 *    press is what LETS the scroll happen.
 *  - FOCUS. A refused press would normally also swallow the focus a click
 *    gives, and a control you cannot get back to is worse than a stray drag.
 *    So a refused press focuses the slider anyway: press the track, nothing
 *    moves, then arrow keys work. `:focus-visible` keeps the ring off for
 *    touch.
 *
 * NOT RIGHT-TO-LEFT AWARE. The thumb is assumed to travel left-to-right. The
 * app has no RTL layout; if it ever grows one this is one line.
 *
 * NO TEARDOWN. Drawer views mount once and are kept for the life of the app
 * (ui/drawer.js), so there is nothing to unhook. A `dispose()` nobody could
 * call would be dead code dressed as cleanup.
 *
 * Imports: config/constants.js only.
 */

import { SLIDER } from '../config/constants.js';

const SELECTOR = 'input[type="range"]';

/**
 * The thumb's drawn diameter, read from the SAME custom property panels.css
 * sizes it with. `(pointer: coarse)` raises that property on the control, so
 * a finger's bigger thumb automatically becomes a bigger grab zone — one
 * number, two languages, no chance of drift.
 */
function thumbWidth(el) {
  const raw = getComputedStyle(el).getPropertyValue('--slider-thumb');
  const px = parseFloat(raw);
  return Number.isFinite(px) && px > 0 ? px : SLIDER.thumbFallbackPx;
}

/**
 * How far the thumb's CENTRE sits from the control's left edge, in pixels.
 *
 * ==> THE THUMB DOES NOT TRAVEL THE FULL WIDTH. <== Its centre stops half a
 * thumb in from each end, or the circle would hang off the edge. So the travel
 * is the box width less one WHOLE thumb, and the value's fraction runs across
 * that, offset by half a thumb.
 *
 * Getting that wrong is not a subtle error: using the full width instead would
 * put the computed centre most of a thumb past the real one at the top of the
 * range, and the slider would refuse to be grabbed at its own maximum. Pure
 * and exported precisely so tools/test-slider-grab.mjs can pin the ends.
 *
 * @param {{width:number, thumb:number, min:number, max:number, value:number}} m
 */
export function thumbCenterOffset({ width, thumb, min, max, value }) {
  const span = max - min;
  const fraction =
    span > 0 && Number.isFinite(value)
      ? Math.min(1, Math.max(0, (value - min) / span))
      : 0;
  const travel = Math.max(0, width - thumb);
  return thumb / 2 + fraction * travel;
}

/** The same point in client coordinates, for a live element. */
function thumbCenterX(el, thumb) {
  const box = el.getBoundingClientRect();
  return (
    box.left +
    thumbCenterOffset({
      width: box.width,
      thumb,
      min: Number(el.min),
      max: Number(el.max),
      value: Number(el.value),
    })
  );
}

/**
 * Require a thumb grab for every range input inside `root`, now and for any
 * added later — the listeners are delegated, so markup built after this call
 * is covered too.
 *
 * Safe to call twice on the same element; the second call is a no-op.
 */
export function requireThumbGrab(root) {
  if (!root || root.dataset.sliderGrab === 'true') return;

  /* ==> NO `window`, NO GESTURE TO REFUSE. <== This whole file is about a
   * pointer coming down on a track, and it binds a `pointerup` listener on
   * `window` to know when one has finished. Somewhere without one is somewhere
   * with no pointers at all — a suite driving a stand-in DOM, which is how
   * `tools/test-seasons-board.mjs` mounts a board.
   *
   * ==> IT IS GUARDED AT THIS DOOR RATHER THAN AT EACH CALLER, AND THAT IS THE
   * POINT. <== Settings has armed this since 2026-07-25 and never met the case;
   * the archive's radius slider (§57.19) is the second caller and met it on the
   * first run, throwing a `ReferenceError` that took the whole board's suite
   * down. A guard in the board would have fixed the board and left the same
   * trap for the third caller. */
  if (typeof window === 'undefined') return;

  root.dataset.sliderGrab = 'true';

  /** The slider whose current gesture was refused, and the value it held when
   *  the press landed. Null whenever no gesture is being refused. Only one
   *  pointer can be pressing one slider at a time in any real interaction, so
   *  one slot is enough. */
  let refused = null;

  function sliderFor(event) {
    const el = event.target?.closest?.(SELECTOR);
    return el && root.contains(el) && !el.disabled ? el : null;
  }

  function onPointerDown(event) {
    refused = null;
    const el = sliderFor(event);
    if (!el) return;

    const width = thumbWidth(el);
    const reach = width / 2 + SLIDER.grabSlopPx;
    if (Math.abs(event.clientX - thumbCenterX(el, width)) <= reach) return;

    refused = { el, value: el.value };
    event.preventDefault();
    if (document.activeElement !== el) el.focus({ preventScroll: true });
  }

  /* Pointer down always fires before mouse down, so the decision above is
   * already made by the time this runs. This exists purely because
   * preventing the pointer event does not reliably prevent the mouse one. */
  function onMouseDown(event) {
    if (refused && event.target === refused.el) event.preventDefault();
  }

  function onPointerUp() {
    refused = null;
  }

  /* CAPTURE phase, on the same host the settings view listens to. Capture on
   * an ancestor runs before the target, and stopping propagation there means
   * the view's own bubble-phase listener never hears the event — so the store
   * is never told about a value the user did not intend to set. */
  function onInput(event) {
    if (!refused || event.target !== refused.el) return;
    event.stopPropagation();
    event.stopImmediatePropagation();
    refused.el.value = refused.value;
  }

  root.addEventListener('pointerdown', onPointerDown, true);
  root.addEventListener('mousedown', onMouseDown, true);
  root.addEventListener('input', onInput, true);
  /* On the window, not the root: a refused press gets no pointer capture, so
   * the release can be reported anywhere — including outside the drawer. */
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerUp, true);
}
