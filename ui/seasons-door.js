/**
 * seasons-door.js — the way IN to the archive, built once and used twice.
 *
 * §57.16. Two doors, both in places you already are: a permanent row at the
 * bottom of the storms list, and a row on the home dashboard. Not a fifth
 * floating button — five buttons in a corner is a lot on a phone, and a
 * cluster button would imply you can hop into the archive mid-storm and come
 * straight back, which is not true: the whole globe changes underneath you.
 *
 * ==> ONE FILE BECAUSE THE ALTERNATIVE IS TWO OVERSIZED FILES GETTING BIGGER.
 * <== `ui/view-storms.js` and `ui/view-home.js` are both over §12's ceiling
 * already. A row built in each of them is the same markup, the same styles and
 * the same label written twice, in the two files least able to afford it — and
 * the two copies drift the first time the wording changes.
 *
 * ==> AND IT IS THE ONLY PART OF SEASONS ON THE BOOT PATH. <== Everything else
 * is behind `await import('./seasons/index.js')` (§57.35 fault 4). This file
 * imports nothing at all, so the cost of the feature to somebody who never
 * opens it is one small module and two rows of markup.
 *
 * NO TELEMETRY CALL HERE, DELIBERATELY. `lib/usage.js` drops an unlisted
 * action name in silence and its ACTIONS names are D1 columns, so counting a
 * door press means an `ALTER TABLE` on `sessions` — a separate change with a
 * migration in it, not a line smuggled into a UI file.
 */

/** What the reader calls the feature. Aaron's call 2026-08-24 — the spec name
 *  is Seasons, the screen says Past storms, and this is the only place the
 *  screen version is written down. */
const DOOR_LABEL = 'Past storms';

/** The subtitle. It states the SCOPE, which is the reason to press it: a row
 *  saying only "Past storms" could be last week. */
const DOOR_NOTE = 'Every storm since 1851';

/**
 * Build a door row.
 *
 * @param {object} opts
 * @param {'storms'|'home'} opts.from   which door this is. Written to the DOM
 *   as `data-door` so a check can tell them apart, and so step 9 — when the
 *   home door starts opening with the near-home filter already applied — has
 *   somewhere to hang the difference without a second component.
 * @param {(el:HTMLElement) => void} opts.onOpen  handed the button itself, so
 *   the caller can return focus to it on the way out (§13).
 * @returns {HTMLElement} the row, not yet in the document.
 */
export function createSeasonsDoor({ from, onOpen }) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'seasons-door';
  el.dataset.door = from;

  const label = document.createElement('span');
  label.className = 'seasons-door-label';
  label.textContent = DOOR_LABEL;

  const note = document.createElement('span');
  note.className = 'seasons-door-note';
  note.textContent = DOOR_NOTE;

  /* A chevron, because the row LEAVES this panel rather than expanding inside
   * it. `aria-hidden` — the button's own text already says what it does, and
   * a screen reader announcing "right-pointing angle bracket" is noise. */
  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('class', 'seasons-door-chevron');
  chevron.setAttribute('viewBox', '0 0 24 24');
  chevron.setAttribute('fill', 'none');
  chevron.setAttribute('stroke', 'currentColor');
  chevron.setAttribute('stroke-width', '1.7');
  chevron.setAttribute('stroke-linecap', 'round');
  chevron.setAttribute('stroke-linejoin', 'round');
  chevron.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M9 5l7 7-7 7');
  chevron.appendChild(path);

  const text = document.createElement('span');
  text.className = 'seasons-door-text';
  text.append(label, note);

  el.append(text, chevron);
  el.addEventListener('click', () => onOpen?.(el));

  /**
   * Replace the subtitle with something better.
   *
   * ==> THE DEFAULT IS A SCOPE LINE AND THE REPLACEMENT IS AN ANSWER. <==
   * §57.19. *"Every storm since 1851"* says why the archive is worth opening;
   * *"143 storms have passed within 120 mi since 1851"* says why THIS reader's
   * archive is, which is the same job done with their house in it. Same slot,
   * same height, no change to the dashboard's layout.
   *
   * ==> AN EMPTY STRING IS REFUSED RATHER THAN HONOURED. <== A caller with
   * nothing to say must leave the scope line standing, and the way that goes
   * wrong is a failure path handing this `''` and blanking a subtitle that was
   * true. The door is a hook: it has no third state and must not grow one.
   *
   * ==> AND IT STAYS ON THE ELEMENT ACROSS A DASHBOARD REDRAW. <== The door is
   * built once and re-attached by `ui/view-home.js`'s `afterRender`, so this
   * survives the `innerHTML` wipe the same way its click listener does — which
   * is why the sentence can be worked out once, several seconds in, rather than
   * on every poll.
   */
  el.setNote = (sentence) => {
    if (typeof sentence === 'string' && sentence.trim()) note.textContent = sentence;
  };

  return el;
}
