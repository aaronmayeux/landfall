/**
 * pill.js — the small pill at the top of the archive globe. §57.37, §57.38.
 *
 * ==> IT NAMES WHERE THE TAP LANDS, NOT WHERE THE READER IS STANDING. <==
 * Aaron's call, 2026-08-28, and it overruled a proposal that had the pill read
 * `Past storms · 2005 · Atlantic`. That version named the CURRENT place and
 * left the action unlabelled — a pill you press to find out what it does.
 *
 * The app already settled this grammar in `ui/drawer.js`: every back control
 * is a left chevron PLUS its destination in words, because a bare `‹` was
 * indistinguishable from the storm stepper's chevron on glass (2026-08-12) and
 * because an icon cannot answer "back to WHAT". Leaving the archive is going
 * up a level to the live globe, so it takes the back grammar rather than an X.
 * An X means dismiss, and a reader who presses one expecting to leave and
 * finds themselves still in 2005 has been told the wrong thing by the icon.
 *
 * ==> `Live storms` MIRRORS `Past storms` DELIBERATELY. <== That is the word
 * on both doors into the archive and in the drawer's own heading, so the pair
 * reads as one axis rather than as two unrelated labels.
 *
 * ==> AND IT IS THE ONLY WAY OUT, WHICH IS WHY IT IS A REAL BUTTON. <== Escape
 * steps the drawer back and closes it; it never leaves the archive. So this is
 * the single control between a reader and a sepia globe they cannot get off,
 * and it is tabbable, answers Enter and Space with no key handling of our own,
 * and sits at the touch minimum (§13).
 *
 * NO HARDCODED COLOUR AND NO PIXEL LITERAL — every value is a custom property
 * `applyTokens` already publishes, which is what makes the pill go sepia on
 * its own the moment the palette is forced.
 *
 * Imports nothing. DOM only; `seasons/index.js` owns when it exists.
 */

/** What the live globe is called on the way back to it. The archive's own
 *  label is `Past storms` (`seasons/bar.js`), and these two are a pair — if
 *  one is reworded the other has to move with it. */
export const LIVE_LABEL = 'Live storms';

/** The chevron's path, lifted from `ui/drawer.js`'s back button so the two
 *  cannot drift into being two slightly different chevrons. */
const CHEVRON_D = 'M15 5l-7 7 7 7';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Build the pill. Not mounted — the caller decides when it goes on screen.
 *
 * @param {object} opts
 * @param {() => void} opts.onLeave  pressed, or activated by keyboard.
 * @returns {{el:HTMLElement, mount:()=>void, unmount:()=>void, focus:()=>void}}
 */
export function createSeasonsPill({ onLeave }) {
  const el = document.createElement('button');
  el.id = 'seasons-pill';
  el.type = 'button';
  /* ==> NO CLASS ON THE ROOT, AND THAT IS DELIBERATE. <== It is styled by its
   * id, the way `#storm-pill` is, because it needs to outrank a bare id rule
   * and to sit at a z-index above the drawer and the control cluster. A class
   * beside the id would be a second name for one element with no rule behind
   * it — `tools/css-orphan-check.mjs` says so, and it is right: a class that
   * styles nothing renders at the browser's defaults if anything ever starts
   * relying on it.
   *
   * The two INNER classes are real and carry rules. They are plain literals,
   * never folded into a template or a ternary, because `tools/markup-scan.mjs`
   * reads class names only where it can see them. `seasons/bar.js` carries the
   * same note for the same reason. */
  /* The visible words are `Live storms`, which says the destination but not
   * that this is a way BACK. Spelled out here rather than on screen: the
   * chevron carries that for a sighted reader in less space than a word. */
  el.setAttribute('aria-label', `Back to the live globe — ${LIVE_LABEL}`);

  /* `createElementNS` rather than `innerHTML`: an SVG built by assigning
   * markup is a string this file cannot be checked against, and the archive's
   * suites run against a stand-in DOM that has no HTML parser in it. */
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'seasons-pill-chevron');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  /* The label above already says everything this glyph says. Announcing it
   * twice is a screen reader reading the button's name and then describing
   * its decoration. */
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', CHEVRON_D);
  svg.append(path);

  const text = document.createElement('span');
  text.className = 'seasons-pill-text';
  text.textContent = LIVE_LABEL;

  el.append(svg, text);
  el.addEventListener('click', () => onLeave?.());

  return {
    el,

    mount() {
      document.body.appendChild(el);
    },

    unmount() {
      el.remove();
    },

    /** §13 — somewhere visible for a keyboard user to land. Not called on
     *  entry today: the drawer opens with the archive and lands focus on the
     *  wall, which is what a reader came here to use, and two things fighting
     *  for the caret is worse than either. It exists for the failure path,
     *  where the drawer did not open and this pill is the only thing on
     *  screen. */
    focus() {
      try {
        el.focus();
      } catch {
        /* A detached or hidden button is not worth an exception here. */
      }
    },
  };
}
