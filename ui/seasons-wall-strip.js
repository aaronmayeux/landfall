/**
 * seasons-wall-strip.js — how wide a wall strip is, and the dot size that fits.
 *
 * ==> IT WAS CUT OUT OF `ui/view-seasons-wall.js` WHEN THAT FILE CROSSED §12's
 * 700-LINE CEILING. <== NOW.md's standing note is that the seasons files grow
 * on every pass and the next pass should expect to cut rather than be
 * surprised; this is that cut, taken rather than documented as an exception.
 *
 * ==> AND THESE TWO ARE THE RIGHT PAIR TO GO. <== They are the file's only
 * geometry — measure the strip, decide the dot — and they are the only part of
 * it that touches no state beyond what it is handed. Everything else in that
 * file is either markup assembly over the view's own closure or an event
 * handler, neither of which crosses a file boundary cheaply.
 *
 * THEY TAKE WHAT THEY NEED AS ARGUMENTS RATHER THAN CLOSING OVER THE VIEW.
 * One direction of import (§12): this file knows nothing about the view.
 */
import { dotSizeFor } from '../lib/wall-index.js';

/** Where a strip's width comes from when the element has not been laid out
 *  yet — first paint, or a hidden host. `dotSizeFor` clamps whatever it gets,
 *  so a wrong guess here is a dot one pixel out for one frame, never a broken
 *  row. Measured from the real sheet at 390px: 32px of padding, a 42px year
 *  column, two 8px gaps and a 46px count column. */
const FALLBACK_STRIP_PX = 390 - 32 - 42 - 16 - 46;

/**
 * How wide a strip actually is, measured rather than assumed.
 *
 *  ==> IT MEASURES THE STRIP THAT IS ALREADY ON SCREEN, WHICH IS THE WHOLE
 *  RESIZE BUG. <== Aaron on glass, 2026-08-26: the dots were one size on
 *  first open and a smaller one after coming back from a season. He was
 *  right and it was not a trick of the eye. This runs while the NEXT render
 *  is still being assembled, so on the very first paint there is no strip to
 *  measure and it fell back to a guessed width — then every later render
 *  measured the real one and got a different answer. Two sizes, decided by
 *  whether the reader had been here before.
 *
 *  The fix is not a better guess. It is `settleDotSize` below: paint, then
 *  measure, then correct — and the correction is a custom property rather
 *  than a re-render, so it cannot cost 175 rows of markup. */
export function stripPx(bodyEl) {
  /* Measured inside `.wall`, never on the pinned row: that row carries an
   * extra column for its note, so its strip is narrower and sizing the whole
   * basin off it would shrink all 175 rows to fit a row that is not part of
   * the record. */
  const slot = bodyEl?.querySelector('.wall .wall-strip-slot');
  const measured = slot?.getBoundingClientRect?.()?.width;
  return Number.isFinite(measured) && measured > 0 ? measured : FALLBACK_STRIP_PX;
}

/**
 * Correct the dot size once the browser has actually laid the strip out.
 *
 * ==> THE SIZE IS A CUSTOM PROPERTY, SO THIS COSTS ONE STYLE WRITE. <== The
 * markup carries no pixel figures at all; every dot reads `--wall-dot` and
 * `--wall-dot-gap` off the container. So correcting a strip that turned out
 * to be 300px rather than the guessed 254 is two `setProperty` calls, not a
 * rebuild of every row — which matters because this runs on every entry.
 *
 * ==> ONE FRAME, AND ONE CORRECTION. <== `requestAnimationFrame` puts this
 * after layout. It deliberately does not loop: the dot size does not change
 * the strip's width — the slot is a `1fr` grid track and takes what is left
 * over whatever is inside it — so one pass converges. A loop here would be a
 * measure-write-measure cycle on a scrolling list, which is the frame budget
 * gone.
 */
export function settleDotSize({ bodyEl, wall, basin, status }) {
  if (status !== 'ok' || !basin) return;
  const raf = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
  raf(() => {
    /* ==> THE SIZE GOES ON THE BODY, NOT ON `.wall`, AND THAT WAS A REAL
     * BUG. <== Aaron on glass, 2026-08-26: the pinned 2026 row's dots were
     * visibly bigger than every row under it. The pinned row sits ABOVE the
     * `.wall` container — it is not part of the record — so a property set
     * on `.wall` never reached it and it fell through to the stylesheet's
     * default while the 175 rows below used the computed size. Two dot sizes
     * on one screen, which is the one thing a wall drawn to a single scale
     * must never show. The body is the nearest ancestor of both. */
    if (!bodyEl?.style?.setProperty) return;
    const { size, gap } = dotSizeFor(wall, basin, stripPx(bodyEl));
    bodyEl.style.setProperty('--wall-dot', `${size}px`);
    bodyEl.style.setProperty('--wall-dot-gap', `${gap}px`);
  });
}
