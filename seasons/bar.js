/**
 * bar.js — the bar along the bottom that says which globe you are standing on.
 *
 * §57.16. Same shape and same job as the replay scrubber's bar: you are never
 * in doubt about which world is on screen, and the way out is always visible.
 *
 * ==> IT ALSO CARRIES THE HONEST LINE ABOUT AN EMPTY GLOBE, AND THAT IS NOT
 * DECORATION. <== Right now the archive globe has nothing on it, because the
 * year picker is the next step. An unexplained empty globe is the silence §5
 * forbids — it looks exactly like a feature that is broken, and §57.1 rule 11
 * says absent UI is explained, never silently missing. So the bar says what is
 * not built yet, in words, and step 5 replaces that sentence with a year.
 *
 * THE LEAVE BUTTON IS A REAL BUTTON, TABBABLE, AT THE TOUCH MINIMUM. Leaving
 * is the one action in this whole mode that must never be gesture-only: a
 * reader who cannot find the way out of a sepia globe with no storms on it
 * will assume the app broke and close it.
 *
 * NO HARDCODED COLOUR AND NO PIXEL LITERAL. Every value is a custom property
 * already published by `applyTokens`, which is also what makes the bar go
 * sepia on its own the moment the palette is forced — it is written against
 * the same variables as every panel.
 *
 * Imports nothing. It is DOM only; `seasons/index.js` owns when it exists.
 */

/** What the reader calls this. Aaron's call 2026-08-24: the FEATURE is named
 *  Seasons in the spec and in these filenames, and what a reader sees says
 *  Past Storms — one name on screen, on both doors and here. */
export const ARCHIVE_LABEL = 'Past storms';

/**
 * Build the bar. Not mounted — the caller decides when it goes on screen.
 *
 * @param {object} opts
 * @param {() => void} opts.onLeave  pressed, or activated by keyboard.
 * @returns {{el:HTMLElement, mount:()=>void, unmount:()=>void,
 *            focusLeave:()=>void, setDetail:(text:string)=>void}}
 */
export function createSeasonsBar({ onLeave }) {
  const el = document.createElement('div');
  el.id = 'seasons-bar';
  /* A landmark rather than a status: it is a place with a control in it, and
   * it does not announce itself on every change the way `role="status"`
   * would. The label names the mode so a screen-reader user arriving by Tab
   * hears which globe they are on before they hear the button. */
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', ARCHIVE_LABEL);

  const where = document.createElement('p');
  where.className = 'seasons-bar-where';

  const mark = document.createElement('span');
  mark.className = 'seasons-bar-mark';
  mark.textContent = ARCHIVE_LABEL;

  const detail = document.createElement('span');
  detail.className = 'seasons-bar-detail';

  where.append(mark, detail);

  const leave = document.createElement('button');
  leave.type = 'button';
  leave.className = 'seasons-leave';
  leave.textContent = 'Leave';
  /* The visible word is already "Leave"; the label says leave WHAT, because
   * out of context a button called Leave is a button called nothing. */
  leave.setAttribute('aria-label', `Leave ${ARCHIVE_LABEL.toLowerCase()}`);
  leave.addEventListener('click', () => onLeave?.());

  el.append(where, leave);

  return {
    el,

    mount() {
      document.body.appendChild(el);
      /* The attribute is what shifts the drawer and the control cluster up off
       * the bar (seasons.css). It lives on <html> rather than on the bar so
       * the rules that read it do not have to be siblings of it. */
      document.documentElement.setAttribute('data-seasons', 'on');
    },

    unmount() {
      document.documentElement.removeAttribute('data-seasons');
      el.remove();
    },

    /** §13 — a keyboard user must land somewhere they can see. Entering the
     *  archive closes the drawer, which would otherwise drop focus onto the
     *  document body with nothing on screen to explain where they are. */
    focusLeave() {
      try {
        leave.focus();
      } catch {
        /* A detached or hidden button is not worth an exception here. */
      }
    },

    /** The sentence beside the name. Step 5 puts a year and a basin here. */
    setDetail(text) {
      detail.textContent = text || '';
      detail.hidden = !text;
    },
  };
}
