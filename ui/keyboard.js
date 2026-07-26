/**
 * keyboard.js — the on-screen keyboard's footprint, published as a CSS variable.
 *
 * THE PROBLEM THIS SOLVES. On a phone the drawer is a bottom sheet:
 * `position: fixed; bottom: 0` (panels.css). Fixed elements are positioned
 * against the LAYOUT viewport, and iOS does not shrink the layout viewport when
 * the keyboard comes up — it only shrinks the VISUAL viewport. So the sheet
 * stays welded to the bottom of the screen and the keyboard slides up on top of
 * it. Tap the address box and you are typing into something you cannot see.
 *
 * `interactive-widget=resizes-content` in the viewport meta fixes this on
 * Chrome for Android and does nothing at all on iOS, which is most of the
 * phones this app is for. So we measure it ourselves.
 *
 * WHAT IT PUBLISHES: one custom property, `--keyboard-inset` — how many pixels
 * of the layout viewport the keyboard is covering, measured from the bottom,
 * and `0px` when it is down. CSS owns the response. This file owns only the
 * number, which keeps the animation and the layout rules in panels.css where
 * the rest of the sheet's behaviour already lives (§12). Anything that needs
 * to REACT rather than restyle subscribes with onKeyboardInset().
 *
 * THE SHEET MOVES ON TRANSFORM. panels.css lifts it with translateY, never
 * with `bottom`, so the keyboard opening costs a composite and not a layout on
 * every frame of the keyboard's own animation (§9, lens 4).
 *
 * Imports: config/ only. Never map/, never data/.
 */

import { KEYBOARD } from '../config/constants.js';

let stop = null;
let inset = 0;

/** Subscribers to the inset changing. A Set, so unsubscribing is exact. */
const listeners = new Set();

/**
 * Be told when the keyboard opens, closes, or changes size (it does — swapping
 * to the emoji panel or an autocomplete bar resizes it).
 *
 * WHY ANYONE NEEDS THIS RATHER THAN A `focus` LISTENER. The drawer focuses a
 * view's first control the moment the view opens, so on a phone the Home view
 * arrives with the address box ALREADY focused and the keyboard on its way up.
 * There is no second focus event to hang anything off — tapping a field that
 * is already focused fires nothing at all — and the one focus event that did
 * fire happened before the keyboard had moved, when the screen was still a
 * different shape. The keyboard arriving is the event that matters, so this is
 * the event to listen to.
 *
 * @param {(px:number) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onKeyboardInset(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The keyboard's current height in pixels. 0 when it is down. */
export const keyboardInset = () => inset;

/**
 * Start watching. Idempotent — calling it twice returns the same teardown and
 * does not double-bind.
 *
 * @returns {() => void} teardown
 */
export function watchKeyboardInset() {
  if (stop) return stop;

  const root = document.documentElement;

  const publish = (px) => {
    /* Nothing moved, say nothing. The visual viewport fires several events per
     * keyboard animation and most of them report the same number twice; a
     * write to a custom property invalidates style for the whole document. */
    if (px === inset) return;
    inset = px;
    root.style.setProperty('--keyboard-inset', `${px}px`);

    /* One bad subscriber must not stop the others, and must never take the
     * measurement loop down with it. */
    for (const fn of listeners) {
      try { fn(px); } catch (e) { console.warn('[landfall] keyboard subscriber failed:', e); }
    }
  };

  const vv = window.visualViewport;

  /* No visualViewport means no way to measure, so publish the honest answer —
   * zero — and leave the sheet where it is. Every browser this app supports has
   * it; this is the graceful-failure path, not a real branch. */
  if (!vv) {
    stop = () => {};
    return stop;
  }

  let raf = 0;

  const measure = () => {
    raf = 0;
    /* The gap between the bottom of what the user can SEE and the bottom of
     * what a fixed element is glued to. offsetTop is in there because Safari
     * will itself scroll the visual viewport within the layout viewport while
     * trying to reveal a focused field, and ignoring that makes the sheet
     * overshoot by exactly that much. */
    const covered = Math.round(window.innerHeight - (vv.height + vv.offsetTop));

    /* A THRESHOLD, NOT A ZERO TEST. The visual viewport also shrinks when
     * Safari's address bar expands on scroll — tens of pixels, no keyboard
     * involved. Lifting the sheet for that would make it twitch while someone
     * is reading. Below the floor, the answer is "no keyboard". */
    publish(covered >= KEYBOARD.minInsetPx ? covered : 0);
  };

  /* Coalesced to one measurement per frame. iOS fires resize and scroll
   * together, several times, through the keyboard's own animation. */
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(measure);
  };

  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  measure();

  stop = () => {
    vv.removeEventListener('resize', schedule);
    vv.removeEventListener('scroll', schedule);
    if (raf) cancelAnimationFrame(raf);
    publish(0);
    stop = null;
  };
  return stop;
}

/**
 * Scroll an element to the top of whatever is scrolling it, twice: once now,
 * and once after the keyboard has finished coming up.
 *
 * WHY TWICE. The keyboard reports its size in stages while it animates, so the
 * first call lands against a sheet that is still changing shape. A quarter of
 * a second later the sheet is short and lifted and the same call means
 * something different. One scroll gets it wrong on one of the two; both is
 * cheap, and the second one is invisible because it is a few pixels.
 *
 * `block: 'start'` rather than 'nearest' deliberately: the point is not merely
 * to make the input visible, it is to put the input at the TOP of the sheet so
 * the results list that appears under it is on screen too. panels.css adds the
 * scroll room that makes reaching the top possible while the keyboard is up.
 *
 * @param {Element|null} el
 */
export function revealAboveKeyboard(el) {
  if (!el) return;

  /* A smooth scroll is motion. Honour the setting (§15). */
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const run = () => {
    try {
      el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    } catch {
      /* Older Safari wants the boolean form. Not worth a capability probe. */
      el.scrollIntoView(true);
    }
  };

  requestAnimationFrame(run);
  setTimeout(run, KEYBOARD.settleMs);
}
