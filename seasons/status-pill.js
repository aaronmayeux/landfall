/**
 * status-pill.js — the pill along the BOTTOM of the archive globe. §57.38.
 *
 * ==> THE ARCHIVE HAS TWO PILLS AND THEY ARE DIFFERENT THINGS. <== Aaron's
 * call, 2026-08-26, and step 5 is where it finally lands. `seasons/pill.js`
 * sits at the TOP, says `‹ Live storms`, and is the way out. This one sits at
 * the BOTTOM and says what is currently drawn. One element cannot be in two
 * places saying two things, which is why there are two files.
 *
 * ==> IT IS A SECOND ELEMENT RATHER THAN THE LIVE `#storm-pill` REPURPOSED,
 * AND THAT IS A CORRECTION TO STEP 6 AS MUCH AS A CHOICE. <== §57.38 says the
 * existing pill "stays at the bottom and goes on saying what is currently
 * drawn". Step 6 hid it instead — right diagnosis, cheap half of the fix. The
 * reason it is not simply un-hidden is that `ui/view-storms.js` rewrites that
 * element's text, its busy state and its error tone ON EVERY POLL, open drawer
 * or not. Sharing it would mean the archive inheriting `data-tone="error"`
 * because GDACS is down — a red pill about today, under 1935's tracks, which
 * is the exact §5 confusion step 6 was right to remove. It would be the same
 * element in name only.
 *
 * ==> IT IS THE BAR'S SENTENCE, WORD FOR WORD, IN THE HOME IT WAS DESIGNED
 * FOR. <== `seasons/bar.js` is deleted at step 5 and `barDetail` moved here
 * unchanged. The words were always meant to end up in a bottom pill; the bar
 * was just the surface that existed first.
 *
 * ==> IT SITS UNDER THE DRAWER, NOT OVER IT, AND THAT IS THE WHOLE POINT OF
 * DELETING THE BAR. <== The bar pushed every sheet in the app up by its own
 * height (`--seasons-bar-h`, now gone) so it could stay visible. A pill at the
 * same z-index as `#storm-pill` costs no layout at all and hands that strip of
 * screen back to the globe on every archive view. The price is that it is only
 * on screen once the sheet is minimised — which is exactly the state the
 * archive's chrome exists for, and while the sheet is open the drawer's own
 * heading is already naming the year.
 *
 * ==> WHAT DOES NOT LIVE HERE: A BAD LINK'S REASON. <== `?season=1066` matters
 * at the moment of arrival, and at that moment the drawer is open covering
 * this pill. That sentence is on the wall instead (`ui/view-seasons-wall.js`),
 * which is the screen a bad link actually lands on.
 *
 * NO HARDCODED COLOUR AND NO PIXEL LITERAL — every value is a custom property
 * `applyTokens` already publishes, which is what makes the pill go sepia on
 * its own the moment the palette is forced.
 *
 * Imports nothing. DOM only; `seasons/index.js` owns when it exists.
 */

/**
 * What the pill says. §57.21b item 8, moved from `seasons/bar.js` unchanged.
 *
 * ==> THIS IS WHERE SELECTION GETS DISCOVERED, WHICH IS WHY THE MIDDLE STATE
 * CARRIES A HINT. <== §57.21a made selecting a deliberate act — tap a track,
 * or press Enter on a ticked row — and NOTHING else on screen says a track is
 * tappable. A reader who never learns that never sees a single storm's dots,
 * which is most of what step 6b built.
 *
 * ==> AND ZERO GETS ITS OWN WORDS, OR THIS IS A TITLE BAR. <== A pill reading
 * `2005 · Atlantic` over an empty globe states a fact the reader can already
 * see and answers nothing. `tick a storm to draw it` is the one thing they
 * need at that moment, and it is the state every visit starts in.
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
export function pillDetail(where) {
  if (!where?.label) return '';
  if (where.openName) return `${where.label} · ${where.openName}`;
  if (where.shown > 0) {
    return `${where.label} · ${where.shown} shown · tap a track for detail`;
  }
  return `${where.label} · tick a storm to draw it`;
}

/**
 * Build the pill. Not mounted — the caller decides when it goes on screen.
 *
 * ==> IT IS A REAL BUTTON AND PRESSING IT TOGGLES THE DRAWER. <== The bar's
 * sentence did the same and Aaron confirmed it on glass 2026-08-25, after the
 * open-only version turned out to be a one-way door. A `<button>` is tabbable
 * and answers Enter and Space with no key handling of our own, so tap, click
 * and keyboard are one path (§13).
 *
 * ==> IT HIDES WHEN THERE IS NOTHING TRUE TO SAY, RATHER THAN SHOWING AN EMPTY
 * PILL. <== That is not §5 silence: the only moment it is empty is before the
 * index has been read, when the drawer is open on top of it saying so in its
 * own words. An empty glass lozenge floating over the globe would be a control
 * with no label, which is worse than no control.
 *
 * @param {object} opts
 * @param {() => void} [opts.onToggleBoard]  pressed, or activated by keyboard.
 * @returns {{el:HTMLElement, mount:()=>void, unmount:()=>void,
 *            setDetail:(text:string)=>void}}
 */
export function createSeasonsStatusPill({ onToggleBoard } = {}) {
  const el = document.createElement('button');
  el.id = 'seasons-status-pill';
  el.type = 'button';
  /* ==> NO CLASS ON THE ROOT, AND THAT IS DELIBERATE. <== Styled by its id the
   * way `#storm-pill` and `#seasons-pill` are, because it has to outrank a
   * bare id rule. A class beside the id would be a second name for one element
   * with no rule behind it — `tools/css-orphan-check.mjs` says so, and it is
   * right. The one INNER class is real and carries a rule, and it is a plain
   * literal because `tools/markup-scan.mjs` reads class names only where it
   * can see them. */
  el.setAttribute('aria-label', 'What is drawn on the archive globe');
  /* Hidden until it has a sentence. `hidden` rather than a data attribute:
   * this needs to leave the TAB ORDER too, or a keyboard user walks into an
   * unlabelled button (§13). */
  el.hidden = true;

  const text = document.createElement('span');
  text.className = 'seasons-status-text';
  el.append(text);

  if (onToggleBoard) el.addEventListener('click', () => onToggleBoard());

  return {
    el,

    mount() {
      document.body.appendChild(el);
    },

    unmount() {
      el.remove();
    },

    /** The sentence — `2005 · Atlantic · 3 shown · tap a track for detail`,
     *  or the storm's name once one is open. Never a leftover apology about
     *  something not being built. */
    setDetail(detail) {
      text.textContent = detail || '';
      el.hidden = !detail;
    },
  };
}
