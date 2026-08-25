/**
 * seasons-board-paint.js — the three things the season board changes on the
 * rows that are ALREADY on screen. §57.21a, §57.21b items 4 and 6.
 *
 * ==> IT IS A SPLIT ALONG PATCH VERSUS STATE, AND IT IS THE THIRD CUT THIS
 * FILE'S PARENT HAS TAKEN. <== `ui/view-seasons-board.js` crossed §12's ~700
 * line ceiling for the fourth seasons pass running. The two earlier cuts moved
 * MARKUP out (`ui/seasons-board-markup.js`); this one moves the other side of
 * the same idea — what happens to markup that is already in the document.
 *
 * ==> THE BOARD PATCHES RATHER THAN RE-RENDERS FOR ONE REASON, AND EVERY
 * FUNCTION HERE EXISTS BECAUSE OF IT. <== `render()` rebuilds the roster with
 * one `innerHTML` write, which throws away the reader's scroll position and
 * their keyboard focus ring. Selection moves on every tap on a track and a
 * tick moves on every tap on a row — the two most frequent interactions in the
 * feature — so both are applied to the existing nodes instead.
 *
 * ==> TOLD, NEVER READING. <== Same contract as the markup file: every
 * function is handed the facts it needs and reads no module state, no clock
 * and no globals beyond the element it was given. The board decides what is
 * true; this decides what that looks like on nodes that already exist.
 *
 * Imports its own sibling for one sentence and nothing else. No network, no
 * clock, no `config/`.
 */

import { footprintNoteHtml } from './seasons-board-markup.js';

/**
 * Bring one row into view, and no further than it has to.
 *
 * ==> `block: 'nearest'` IS WHAT MAKES THIS SAFE TO CALL FROM A REPAINT. <== A
 * row already on screen is not moved at all, so `paintFocus` can run on every
 * render without ever yanking the list out from under a reader's thumb.
 *
 * ==> REDUCED MOTION IS ASKED, NOT ASSUMED. <== §9. A smooth scroll across a
 * 28-row roster is a long animation, and exactly the kind of movement the OS
 * setting exists to switch off. The whole read is wrapped rather than the
 * call, because `matchMedia` is absent in the stand-in DOM the suites use.
 */
function scrollRowIntoView(row) {
  if (typeof row?.scrollIntoView !== 'function') return;
  let reduce = false;
  try {
    reduce = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch { /* no matchMedia here; the default is the safe one */ }
  row.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
}

/**
 * Which row is the open storm, and the sentence that goes with it.
 *
 * ==> THE MARKED ROW IS ALSO BROUGHT INTO VIEW, AND THAT IS §57.21b ITEM 6.
 * <== A tap on a track marked the row and did not scroll to it. With a 28-row
 * roster the marked row is usually off-screen, so the globe lit a storm up and
 * the panel looked like nothing had happened — the panel and the map
 * disagreeing, which is the one failure this whole view is careful about.
 *
 * ==> AND WHY THE OPEN STORM HAS NO WIND FOOTPRINT, WHERE THAT IS THE CASE.
 * <== §57.25 rule 2, §57.26a. Three quarters of the archive has no wind field,
 * so for most of what a reader opens that sentence IS step 6b — the footprint
 * layer draws the open storm and nothing else, so the presence and the absence
 * are discovered by the same tap. It is written into a slot that is always in
 * the markup, for the same patch-not-rebuild reason as everything else here.
 *
 * @param {Element} bodyEl   the board's scroller
 * @param {string|null} focusedId  the open storm's id, or null
 * @param {{storm:object,facts:object}|null} entry  that storm, for the
 *   sentence. The board passes it from the WHOLE season rather than the
 *   filtered rows: a storm can stay open while a filter narrows past it, and
 *   the sentence must not vanish while its track is still bright.
 */
export function paintFocus(bodyEl, focusedId, entry) {
  if (!bodyEl) return;

  for (const row of bodyEl.querySelectorAll('.seasons-row[data-row]')) {
    const on = focusedId != null && row.dataset.row === focusedId;
    row.classList.toggle('seasons-row-focus', on);
    /* Guarded on `on` rather than run for every row, because a row is a fresh
     * node after every rebuild and scrolling to each in turn would land on the
     * last one. */
    if (on) scrollRowIntoView(row);
    /* `aria-current` rather than `aria-selected`: nothing here is a listbox,
     * and this is the ordinary meaning — the one item in a set the reader is
     * currently on. Removed rather than set to "false", which some screen
     * readers announce. */
    if (on) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');
  }

  const slot = bodyEl.querySelector('.seasons-footprint');
  if (slot) slot.innerHTML = footprintNoteHtml(focusedId ? entry : null);
}

/**
 * The master checkbox's three states. §57.21b item 4.
 *
 * ==> IT HAS TO BE SET IN CODE BECAUSE `indeterminate` IS A PROPERTY AND NOT
 * AN ATTRIBUTE. <== There is no way to write it in markup at all, so every
 * path that changes what is ticked has to come back through here: a rebuild, a
 * single tick, a press of the master box itself. That is also why a rebuild
 * alone is not enough — the roster comes back with `checked` restored from the
 * markup and the middle state silently lost, which on glass is an EMPTY box
 * over a globe with tracks on it.
 *
 * `aria-checked="mixed"` is written in the markup as well, because it IS an
 * attribute and the markup can count. The two are kept in step by both being
 * derived from the same tally rather than from each other.
 *
 * @param {Element} bodyEl  the board's scroller
 * @param {number} shown    rows currently on the list, AFTER the filter
 * @param {number} on       how many of those are ticked
 */
export function paintCheckAll(bodyEl, shown, on) {
  if (!bodyEl) return;
  const box = bodyEl.querySelector('[data-check-all]');
  if (!box) return;
  box.checked = shown > 0 && on === shown;
  box.indeterminate = on > 0 && on < shown;
  box.setAttribute('aria-checked', box.indeterminate ? 'mixed' : String(box.checked));
}
