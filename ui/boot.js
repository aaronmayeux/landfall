/**
 * boot.js — the boot screen's two jobs: get out of the way, or say why it can't.
 *
 * The screen itself is static markup at the top of index.html, so it is on
 * screen before this module exists. Nothing here is on the paint path; this
 * only decides WHEN it leaves.
 *
 * ==> WHY A SPINNER NEEDS A FAILURE STATE. <==
 * §5 says never ship silence on failure. A spinner is the easiest silence in
 * the app to ship by accident: it looks like progress forever, so a user on a
 * dead connection watches an animation that means nothing and has no way to
 * tell it apart from a slow one. After `BOOT.stuckAfter` this says so plainly
 * and offers the one action that can help.
 *
 * It does NOT hide itself on the timer. A stuck boot screen that vanishes
 * leaves a black page, which is worse than a stuck boot screen that explains
 * itself.
 *
 * Imports: config/ only. No DOM beyond its own element.
 */

import { BOOT } from '../config/constants.js';

/**
 * Wire the boot screen.
 *
 * @returns {{ done: () => void }} `done()` dismisses it. Idempotent — the
 *          globe can become ready before or after the stuck timer fires, and
 *          calling this twice must not restart the fade.
 */
export function createBoot() {
  const el = document.getElementById('boot');
  const note = document.getElementById('boot-note');
  if (!el) return { done() {} };

  let finished = false;
  let removeTimer = null;

  const stuck = setTimeout(() => {
    if (finished || !note) return;
    /* Deliberately not an error color and not an apology. At this point we do
     * not know that anything is broken — a slow network looks identical from
     * here — so it reports what is true (this is taking longer than it should)
     * and offers the action that helps if it is stuck. */
    note.textContent = 'This is taking longer than usual. ';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Reload';
    retry.addEventListener('click', () => location.reload());
    note.appendChild(document.createElement('br'));
    note.appendChild(retry);
    note.dataset.visible = 'true';
  }, BOOT.stuckAfter);

  return {
    done() {
      if (finished) return;
      finished = true;
      clearTimeout(stuck);
      el.dataset.done = 'true';
      /* REMOVED, not left at opacity 0. A full-screen element that stays in
       * the tree is a compositor layer over every frame the globe draws, for
       * the rest of the session — the exact cost this app cannot pay (§Perf).
       * The delay is the fade's own duration, read from the element rather
       * than duplicated here as a number. */
      const ms = parseFloat(getComputedStyle(el).transitionDuration) * 1000;
      removeTimer = setTimeout(() => el.remove(), (ms || 0) + 50);
    },
    /** For tests and teardown; the app itself never calls this. */
    destroy() {
      clearTimeout(stuck);
      if (removeTimer) clearTimeout(removeTimer);
    },
  };
}
