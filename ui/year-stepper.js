/**
 * year-stepper.js — `−  2005  +`, pinned directly under the archive drawer's
 * header. SPEC-SEASONS-BUILD.md §57.39a.
 *
 * ==> IT USED TO BE A FULL-WIDTH ROW INSIDE THE SCROLLER AND THAT ROW WAS TWO
 * FAULTS. <== Aaron on glass, 2026-08-28. A bordered `−` box pinned to the
 * sheet's left edge and a `+` box pinned to the right, with the year between
 * them — while the header one line above ALREADY said the same four digits.
 *
 *   1. THE YEAR WAS PRINTED TWICE, one line apart, at the same size. The old
 *      `pickerHtml` argued the repetition bought the control its own meaning.
 *      On a phone it reads as the screen stuttering.
 *   2. THE BUTTONS SAT UNDER THE CHROME. `−` landed a thumb's width below the
 *      drawer's Back chevron and `+` below the close X. That is the exact
 *      layout `ui/storm-stepper.js` was rebuilt to escape on 2026-08-12, and
 *      the consequence is the same and still asymmetric: press `+` instead of
 *      X and you step a year, press X instead of `+` and you are out.
 *
 * ==> THE SHAPE IS KARINA'S PANEL, AND THAT IS AARON'S CALL, 2026-08-28. <==
 * He pointed at the live storm drawer and asked why the archive could not do
 * what it already does: a subject in the header, a tight centred stepper on
 * its own pinned line under it. So the header names the BASIN — `Atlantic` —
 * and this is the row beneath. The duplication goes because the two lines now
 * say different things, which is exactly why it never looked wrong there.
 *
 * ==> PINNED, NOT SCROLLED, AND THAT IS THE PART WITH A HISTORY. <== It is a
 * sibling of `.drawer-body` rather than its first child, the same position
 * `ui/storm-stepper.js` takes in the two live drawers. §57.21b item 1 is the
 * reason it matters here specifically: the one control on this screen a reader
 * uses repeatedly must not move under the thumb between presses, and a row
 * inside a scroller moves the moment the roster is longer or shorter than the
 * last one. `--seasons-sheet-h` was measured to hold the sheet still; this
 * holds the control still even while the reader is scrolling the roster.
 *
 * ==> THE GLYPHS ARE `−` AND `+`, NOT CHEVRONS, AND THAT IS ALSO AARON'S CALL.
 * <== The live stepper uses chevrons because nothing sits beside it. Here the
 * Back button's own `‹` is one line up and a little to the left, and two of
 * the same glyph at the same size on adjacent lines is fault 2 above coming
 * back by proximity rather than by position.
 *
 * ==> IT IS THE SAME SHAPE AS `ui/storm-stepper.js` AND DELIBERATELY NOT THE
 * SAME MODULE. <== What differs is every rule underneath: the live one WRAPS
 * (storm 7 steps to storm 1) and this one STOPS, because 1851 has no earlier
 * season and pretending it does would land the reader at 2026 from a `−`
 * press. The live one HIDES below two storms; this one never hides, because
 * the archive always holds at least one season and a picker that vanished
 * would leave a reader with no way to a neighbouring year. And its middle slot
 * is the SUBJECT (`2005`) rather than a position (`2 of 7`). Three different
 * rules and about eleven shared lines is not a component, it is a coincidence
 * of shape — merging them would mean one file with a `wrap` flag, a `hide`
 * flag and two label modes, which is two controls wearing one name.
 *
 * ==> THE BUTTONS ARE BUILT ONCE AND NEVER REPLACED. <== Same reason as the
 * storm stepper: they survive their own activation. A press steps the year,
 * which re-pushes the view, which re-renders the drawer's chrome — and a
 * rebuilt button means focus lands on a detached node and gets dumped every
 * single press. Only text, labels and the disabled state are rewritten.
 *
 * Imports: nothing. The caller injects the year list and the step.
 */

/** What the slot says when there is no year yet — the index is still on its
 *  way, or a bad `?season=` was dropped. A word rather than a dash: the body
 *  is already saying "Opening the archive…", and `—` over it reads as a fault
 *  rather than as a wait. */
const NO_YEAR = 'No season';

/**
 * @param {object} o
 * @param {() => number[]} o.years  every season the archive holds for the basin
 *        on screen, NEWEST FIRST — the order `loading.yearsFor` returns. A
 *        FUNCTION, not an array: the basin can change under this control and a
 *        captured list would step through the other ocean's record.
 * @param {() => (number|null)} o.year  the season on screen right now.
 * @param {(year:number) => void} o.onStep  what a press means.
 * @returns {{el:HTMLElement, render:Function, takeFocus:Function}}
 */
export function createYearStepper({ years, year, onStep }) {
  /* ==> BUILT NODE BY NODE, NOT OUT OF AN `innerHTML` STRING. <== The three
   * elements have to persist anyway — that is the whole reason the buttons
   * survive their own activation — so a string that is immediately parsed and
   * then queried back out buys nothing, and it costs the component a
   * dependency on `querySelector` and on HTML escaping. It also costs the
   * suites: `tools/test-archive-mode.mjs` drives the real archive against a
   * deliberately tiny element stub with no parser in it, and a factory that
   * queried its own markup threw on mount there. A control this small should
   * work against the smallest DOM that can hold it. */
  const el = document.createElement('div');
  el.className = 'seasons-year';

  const make = (dir, glyph) => {
    const b = document.createElement('button');
    b.className = 'seasons-step';
    b.type = 'button';
    b.dataset.step = dir;
    b.textContent = glyph;
    return b;
  };

  const buttons = { older: make('older', '−'), newer: make('newer', '+') };
  const nowEl = document.createElement('span');
  nowEl.className = 'seasons-year-now';

  el.append(buttons.older, nowEl, buttons.newer);

  const arrow = (dir) => buttons[dir];

  /** Where each button goes right now. Held rather than re-derived in the click
   *  handler, so a button can never announce one year and navigate to another. */
  let targets = { older: null, newer: null };

  /** Set on press, consumed by takeFocus(). */
  let pendingFocus = null;

  /* ==> ITS OWN LISTENER, BECAUSE IT IS OUTSIDE THE VIEW'S BODY. <== The board
   * binds one delegated click handler to `#seasons-board-body` and every other
   * control on the screen is inside it. This row is pinned as a SIBLING of
   * that body so it does not scroll, which puts it out of that listener's
   * reach — a control wired the old way would be dead. */
  el.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-step]');
    if (!btn || btn.disabled) return;
    const target = targets[btn.dataset.step];
    if (target == null) return;
    pendingFocus = btn.dataset.step;
    onStep?.(target);
  });

  /**
   * Recompute the year, both destinations and both disabled states.
   *
   * ==> DISABLED AT THE ENDS, NEVER HIDDEN. <== §7. 1851 is the oldest Atlantic
   * season and 1949 the oldest Pacific one, so one end of the record always
   * has a dead direction — and a button that disappears there would make the
   * row change shape as the reader walks into it, on the one control they are
   * pressing repeatedly.
   */
  function render() {
    const list = (years?.() || []).filter(Number.isFinite);
    const y = year?.();
    const i = list.indexOf(y);

    /* Older is DOWN a newest-first list, so "the previous season" is the next
     * index along. `i < 0` covers both the no-year states — the index has not
     * landed, or it landed without this year — and disables both ends, which
     * is correct: there is nothing to step from. */
    targets = i < 0
      ? { older: null, newer: null }
      : { older: list[i + 1] ?? null, newer: list[i - 1] ?? null };

    nowEl.textContent = Number.isFinite(y) ? String(y) : NO_YEAR;

    for (const [dir, none] of [['older', 'No earlier season'], ['newer', 'No later season']]) {
      const btn = arrow(dir);
      const to = targets[dir];
      btn.disabled = to == null;
      btn.setAttribute('aria-disabled', String(to == null));
      btn.setAttribute('aria-label', to == null ? none : `Go to ${to}`);
    }
  }

  /**
   * The button that was just pressed, or null.
   *
   * ONE-SHOT, same as the storm stepper's: a press re-pushes the view and
   * `ui/drawer.js` then asks the view where focus belongs. Handing back the
   * button under the reader's thumb means walking the record by keyboard is
   * one press per year instead of a trip through the tab order each time.
   * Arriving any other way — a row on the wall, a deep link — falls through to
   * the view's own answer.
   */
  function takeFocus() {
    if (!pendingFocus) return null;
    const btn = arrow(pendingFocus);
    pendingFocus = null;
    return btn?.disabled ? null : btn;
  }

  /** The first end that can still be pressed, for the view's `focus()`. Putting
   *  focus on a disabled control is putting it nowhere (§13), and at 1851 the
   *  `−` is disabled. */
  function firstEnabled() {
    return [arrow('older'), arrow('newer')].find((b) => b && !b.disabled) || null;
  }

  render();
  return { el, render, takeFocus, firstEnabled };
}
