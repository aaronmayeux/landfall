/**
 * loading-dots.js — the three dots at the end of "Checking…" actually move.
 *
 * ==> WHY THIS EXISTS. <==
 * Every waiting sentence in the app ended in a static "…". On glass that is
 * indistinguishable from a sentence that has finished and simply trails off,
 * so a reader looking at "Checking…" has no way to tell a live fetch from a
 * screen that has quietly given up. The pill already had a turning mark for
 * exactly this reason; the words did not. Now they do, everywhere, in one
 * shape — a sequential fade across three dots, left to right.
 *
 * ==> THE ELLIPSIS CHARACTER IS RESERVED. <==
 * `…` at the END of a user-facing string means "still working" and nothing
 * else. It is not a truncation marker (that is CSS `text-overflow`) and not a
 * dramatic pause. Every one of these helpers keys off a trailing `…`, so a
 * string that borrows the character for another job will start blinking.
 *
 * ==> OPACITY ONLY (SPEC lens 4). <==
 * The keyframes in panels.css animate `opacity` and nothing else. No width, no
 * transform, no layout — three inline spans fading on a phone that is already
 * driving MapLibre must cost effectively nothing. Timing is
 * `--duration-pulse`, restated from DURATION.pulse in config/motion.js.
 *
 * ==> ARIA-HIDDEN, DELIBERATELY. <==
 * A screen reader gets "Checking" and stops. Three separate `<i>.</i>` nodes
 * announced individually would be three meaningless periods, and the dots
 * carry no information a sighted reader does not already have from the word.
 *
 * Two shapes because the app has two kinds of call site: string templates that
 * end up in `innerHTML`, and nodes written with `textContent`. Both produce
 * the same markup so one CSS rule covers everything.
 *
 * Imports nothing. Ever — every view file has its own local `esc`, and this
 * must not become the reason they grow a shared dependency.
 */

/** The markup, for template literals. Sits OUTSIDE whatever `esc()` the call
 *  site uses — it is trusted markup this file wrote, not user text. */
export const DOTS = '<span class="dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>';

/**
 * Swap a trailing `…` in an ALREADY-ESCAPED html string for the animated dots.
 *
 * Escaping never produces a `…`, so running this after `esc()` is safe and is
 * the order every caller uses. Strings that do not end in one come back
 * untouched, which is what lets a single call site cover both "Loading…" and
 * "Vendor unavailable — tap to retry" without branching.
 *
 * @param {string} html already-escaped text
 * @returns {string} html, with the ellipsis animated if there was one
 */
export function dotted(html) {
  const s = String(html);
  return s.endsWith('…') ? s.slice(0, -1) + DOTS : s;
}

/**
 * The same three dots as a DOM node, for the `textContent` call sites — the
 * storm pill's label and the home-setup search status. Those write text into
 * an element rather than building html, and appending a node is how they stay
 * that way instead of growing an `innerHTML` for three periods.
 *
 * @returns {HTMLElement}
 */
export function dotsEl() {
  const span = document.createElement('span');
  span.className = 'dots';
  span.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('i');
    dot.textContent = '.';
    span.appendChild(dot);
  }
  return span;
}

/**
 * Write `text` into `node`, animating a trailing `…` if there is one.
 *
 * The one-liner both `textContent` callers wanted. Replaces the node's
 * children outright, exactly as `textContent = ...` did.
 *
 * @param {Node} node
 * @param {string} text
 */
export function setDottedText(node, text) {
  const s = String(text);
  if (!s.endsWith('…')) {
    node.textContent = s;
    return;
  }
  node.replaceChildren(document.createTextNode(s.slice(0, -1)), dotsEl());
}
