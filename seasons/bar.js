/**
 * bar.js — the bar along the bottom that says which globe you are standing on.
 *
 * §57.16. Same shape and same job as the replay scrubber's bar: you are never
 * in doubt about which world is on screen, and the way out is always visible.
 *
 * ==> IT NAMES THE SEASON, AND THAT SENTENCE IS ALSO A DOOR. <== `2005 ·
 * Atlantic` beside the mode, and pressing it reopens the board. Closing the
 * board leaves an archive globe whose only chrome is this bar — the storms,
 * home and layers buttons are all hidden in here (§57.16a) — so the bar is
 * the one place the way back can live without adding new furniture.
 *
 * It still carries a real reason when a deep link named a year outside the
 * record: an empty globe with nothing said about it is the silence §5 forbids,
 * and only words can tell a typo from a genuinely quiet season.
 *
 * ==> THE LEAVE BUTTON HAS GONE, AND SO HAS THIS FILE'S CLAIM ON `data-seasons`.
 * <== Step 6, 2026-08-28. Getting out of the archive is `seasons/pill.js` at
 * the TOP of the globe now — a chevron and the destination in words, which is
 * the grammar `ui/drawer.js` already uses for every other back control. There
 * is exactly one way out and it is not in here.
 *
 * The layout attribute moved with it, to `seasons/index.js`, which owns the
 * session. It was in this file's `mount`/`unmount` only because the bar
 * happened to be the first thing on screen — and every rule it drives (the
 * sheet's height, the three hidden cluster buttons, the control cluster's
 * offset) outlives the bar. Step 5 deletes this file; none of that may go
 * with it.
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
 * The sentence beside the name. §57.21b item 8.
 *
 * ==> THE BAR IS WHERE SELECTION GETS DISCOVERED, WHICH IS WHY THE MIDDLE
 * STATE CARRIES A HINT. <== §57.21a made selecting a deliberate act — tap a
 * track, or press Enter on a ticked row — and NOTHING on screen says a track
 * is tappable. A reader who never learns that never sees a single storm's
 * dots, which is most of what step 6 built.
 *
 * ==> AND ZERO GETS ITS OWN WORDS, OR THE BAR IS A TITLE BAR AGAIN. <== A bar
 * reading `2005 · Atlantic` over an empty globe states a fact the reader can
 * already see and answers nothing. `tick a storm to draw it` is the one thing
 * they need to know at that moment, and it is the state every visit starts in.
 *
 * ==> THE OPEN STORM'S NAME REPLACES THE COUNT RATHER THAN JOINING IT. <==
 * `2005 · Atlantic · 4 shown · Katrina` is four facts on a line that is one
 * line tall on a 390px phone. Once a storm is open it is the subject, and the
 * count is answerable by looking at the globe.
 *
 * PURE, and exported so a suite can drive it without a DOM.
 *
 * @param {object|null} where  `{ label, shown, openName }` from the board, or
 *   null before a season has settled.
 * @returns {string} the sentence, or '' when there is nothing true to say yet.
 */
export function barDetail(where) {
  if (!where?.label) return '';
  if (where.openName) return `${where.label} · ${where.openName}`;
  if (where.shown > 0) {
    return `${where.label} · ${where.shown} shown · tap a track for detail`;
  }
  return `${where.label} · tick a storm to draw it`;
}

/**
 * Build the bar. Not mounted — the caller decides when it goes on screen.
 *
 * @param {object} opts
 * @param {() => void} [opts.onOpenBoard]  the reader wants the board back.
 * @returns {{el:HTMLElement, mount:()=>void, unmount:()=>void,
 *            setDetail:(text:string)=>void}}
 */
export function createSeasonsBar({ onOpenBoard } = {}) {
  const el = document.createElement('div');
  el.id = 'seasons-bar';
  /* A landmark rather than a status: it is a place with a control in it, and
   * it does not announce itself on every change the way `role="status"`
   * would. The label names the mode so a screen-reader user arriving by Tab
   * hears which globe they are on before they hear the button. */
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', ARCHIVE_LABEL);

  /* ==> THE SENTENCE NAMING THE YEAR IS ALSO THE WAY BACK TO THE BOARD. <==
   * §57.30 step 5. Closing the board leaves an archive globe with nothing on
   * screen but this bar — and the three cluster buttons are hidden in here
   * (§57.16a), so without this there is no way back to the year picker short
   * of leaving and re-entering. Reusing the text rather than adding a third
   * control keeps the bar at two buttons: where you are, and out.
   *
   * A real <button>, so it is tabbable and answers Enter and Space with no
   * key handling of our own — tap, click and keyboard on one path (§13). */
  const where = document.createElement(onOpenBoard ? 'button' : 'p');
  where.className = 'seasons-bar-where';
  if (onOpenBoard) {
    /* `classList.add` with a plain literal rather than folding the name into a
     * ternary on `className`. `tools/markup-scan.mjs` reads both forms but only
     * when the class name is a literal it can see — a conditional expression
     * hides it, and `selector-contract-check.mjs` then reports every check that
     * queries this class as pointing at nothing the app emits. It caught this
     * one. Same reason `class="..."` containing `${` is skipped whole. */
    where.classList.add('seasons-bar-open');
    where.type = 'button';
    where.addEventListener('click', () => onOpenBoard());
  }

  const mark = document.createElement('span');
  mark.className = 'seasons-bar-mark';
  mark.textContent = ARCHIVE_LABEL;

  const detail = document.createElement('span');
  detail.className = 'seasons-bar-detail';

  where.append(mark, detail);

  el.append(where);

  return {
    el,

    mount() {
      document.body.appendChild(el);
    },

    unmount() {
      el.remove();
    },

    /** The sentence beside the name — `2005 · Atlantic` once a season is
     *  chosen, or a real reason when a link named a year the record does not
     *  have. Never a leftover apology about something not being built. */
    setDetail(text) {
      detail.textContent = text || '';
      detail.hidden = !text;
    },
  };
}
