/**
 * seasons-board-render.js — the board's markup, assembled. §57.18, §57.19,
 * §57.21b. SPEC.md §12's seventh cut out of `ui/view-seasons-board.js`.
 *
 * ==> IT READS AND NEVER WRITES STATE, WHICH IS WHY THIS ONE COULD MOVE WITH A
 * WIDE BAG. <== The sixth cut (`ui/seasons-board-selection.js`) had to take its
 * state with it, because state handed over a getter leaves a knot in two files
 * instead of one. Nothing here holds state or changes any: every value arrives
 * as a getter, is read once per redraw, and the only things written are
 * `innerHTML` and the two paints that put back what `innerHTML` cannot carry.
 * A read bag can be as wide as it needs to be — reads have nothing to drift
 * out of step with.
 *
 * ==> REBUILT WHOLESALE, LIKE THE LAYERS VIEW. <== The shape is small and
 * static and one render path cannot drift from a patch path. The SCROLLER is
 * built once and never replaced, which is what stops the panel snapping to the
 * top every time a checkbox moves.
 *
 * ==> THE TWO PAINTS AT THE END ARE NOT TIDINESS. <== `innerHTML` throws away
 * the elements carrying the focus class and the master box's middle state and
 * puts fresh ones in their place, so both have to be re-applied or the roster
 * silently stops agreeing with the globe. They are handed in rather than
 * imported, because deciding WHAT is focused belongs to
 * `ui/seasons-board-selection.js` and this file must not be a second opinion.
 *
 * Imports lib/ and its own siblings. Never data/ or map/ (§12).
 */

import { basinHasLive } from '../lib/season-years.js';
import {
  entriesMatching, filtersFor, filtersHtml, pickerHtml, seasonRosterHtml,
} from './seasons-board-markup.js';
import {
  indexFailedHtml, liveDownHtml, scoreHtml, waitingHtml,
} from './seasons-board-furniture.js';
import { NEAR_HOME_FILTER, radiusSliderHtml } from './seasons-near-home.js';
import { requireThumbGrab } from './slider-grab.js';

/**
 * @param {object} opts  all getters, for the reason in
 *   `ui/seasons-board-selection.js`: the board is mounted once and kept for the
 *   life of the app, so a value captured here would be answering with the
 *   season, the year, the house or the body element that existed at
 *   construction. `ticked` is the exception and is passed straight through — it
 *   is a Set, so the live object IS the current answer.
 * @param {() => (Element|null)} opts.bodyEl   the drawer body this writes into.
 * @param {object} opts.loading                `ui/seasons-board-loading.js`.
 * @param {() => (string|null)} opts.basin
 * @param {() => (number|null)} opts.year
 * @param {() => string} opts.filter
 * @param {() => number} opts.radius
 * @param {() => (object|null)} opts.home
 * @param {() => string} opts.system
 * @param {() => (object|null)} opts.near      the house and the circle, or null.
 * @param {() => string} opts.radiusWords      the circle in the reader's words.
 * @param {() => Set<string>} opts.activeIds   still-running storms. §57.21c.
 * @param {Set<string>} opts.ticked            the live Set, not a copy.
 * @param {() => void} opts.paintFocus
 * @param {() => void} opts.paintCheckAll
 */
export function createSeasonsBoardRender({
  bodyEl, loading, basin, year, filter, radius,
  home, system, near, radiusWords, activeIds, ticked,
  paintFocus, paintCheckAll,
}) {
  function rosterHtml() {
    /* ==> TOLD WHAT TO DRAW, NEVER WHAT THE STATE IS. <== This function is
     * now four lines because the markup went to `seasons-board-markup.js`
     * when §12's ceiling was crossed a second time — the same cut
     * `liveDownHtml` took, and for the same reason: assembling a roster is
     * markup work that happened to be living in the state file. What is left
     * here is the two decisions the VIEW owns and the markup must not make.
     *
     * ==> GHOSTS ARE A WHOLE-SEASON FACT AND A NARROWED LIST IS NOT THE PLACE
     * FOR THEM. <== Step 5a's rule. "Eighteen names are still unused" is about
     * the season, and printing it under a Majors list would put an unfiltered
     * claim at the foot of a filtered one. `null` rather than a flag (§57.18a).
     */
    const entries = loading.entries();
    const s = loading.state();
    return seasonRosterHtml({
      state: s.seasonState,
      reason: s.seasonReason,
      year: year(),
      provisional: s.provisional,
      rows: entriesMatching(entries, filter(), near()),
      anyEntries: entries.length > 0,
      ticked,
      ghosts: filter() === 'all' ? s.roster : null,
      /* §57.21c. The row uses it for the disabled box and the `– active` date;
       * the master box uses it to count only what can be drawn. */
      activeIds: activeIds(),
      /* §57.19. The row prints how close its storm came; the empty state names
       * the circle that came back with nothing in it. Both are handed the
       * house and the units rather than reading them, so this file stays the
       * only place that decides what is current. */
      home: home(),
      system: system(),
      filter: filter(),
      radiusWords: radiusWords(),
    });
  }

  function render() {
    const body = bodyEl();
    if (!body) return;

    /* ==> ONE BUNDLE PER REDRAW, NOT A DOZEN GETTERS THREADED THROUGH THE
     * TEMPLATE. <== Everything below that describes what ARRIVED comes off
     * this one read of `ui/seasons-board-loading.js`; everything that
     * describes what the reader CHOSE is still a local. That is the seam of
     * the fifth cut, and this function is the only place the two halves meet. */
    const s = loading.state();

    if (s.indexState === 'loading') {
      body.innerHTML = waitingHtml('Opening the archive…');
      return;
    }

    if (s.indexState === 'unavailable') {
      body.innerHTML = indexFailedHtml();
      return;
    }

    /* ==> EACH PIECE IS BUILT BEFORE THE TEMPLATE, NOT INSIDE IT. <== Partly
     * readability, and partly because `tools/css-orphan-check.mjs` scans
     * template literals for the classes this app emits — a method call sitting
     * inside one reads as a class name to it, and it reported `.basinsIn` and
     * `.basinLabel` as dead CSS. A checker that can be confused by formatting
     * is one whose next real finding gets waved through as noise. */
    const picker = pickerHtml({
      years: loading.yearsFor(basin()),
      year: year(),
    });

    const scorecard = scoreHtml({
      score: s.score,
      roster: s.roster,
      provisional: s.provisional,
      unreadable: s.unreadable,
      stale: Boolean(s.provisional && s.liveStale),
    });

    const filters = filtersHtml({
      filters: filtersFor(s.provisional, home()),
      filter: filter(),
    });

    /* ==> THE SLIDER APPEARS WITH THE FILTER AND NOT BEFORE. <== §57.19 calls
     * it "revealed" by the choice, and that is the plainer statement: a control
     * greyed out under the other three filters would be furniture explaining
     * itself. Hoisted out of the template for the same reason everything else
     * here is — `tools/css-orphan-check.mjs` reads a method call inside a
     * template literal as a class name. */
    const radiusSlider = filter() === NEAR_HOME_FILTER
      ? radiusSliderHtml(radius(), system())
      : '';

    /* Hoisted out of the template for the reason above, and it is no longer
     * optional: `s.liveRetrying` inside a template literal reads to
     * `tools/css-orphan-check.mjs` as a class called `liveRetrying`. */
    const liveDown = liveDownHtml({
      hasLive: basinHasLive(basin()),
      retrying: s.liveRetrying,
      reason: s.liveReason,
    });

    const roster = rosterHtml();

    /* ==> THE ROSTER GETS A WRAPPER, AND IT IS LOAD-BEARING RATHER THAN TIDY.
     * <== A radius drag has to change the list without touching the control the
     * reader's thumb is on: replace the whole body and the range input is a new
     * node mid-gesture, so the drag ends on an element that no longer exists.
     * `repaintRoster` swaps the contents of this one div instead, which leaves
     * the picker, the filters and the slider exactly where they were. */
    body.innerHTML = `
      ${picker}
      ${liveDown}
      ${scorecard}
      ${filters}
      ${radiusSlider}
      <div class="seasons-roster-slot">${roster}</div>`;

    /* ==> THE THUMB-GRAB RULE IS ARMED AFTER EVERY REBUILD, BECAUSE THE INPUT
     * IS A NEW NODE. <== `ui/slider-grab.js` marks the ROOT it has armed, and
     * the root here is the scroller — which survives — so this is one cheap
     * check on the ordinary redraw rather than a rebind. The rule itself is
     * not optional on this screen: this is a slider inside a sheet a reader
     * scrolls with their thumb, which is exactly the trap that file exists for,
     * and a stray press would silently change which storms are on the globe. */
    requireThumbGrab(body);

    /* ==> THE FOCUS IS RE-APPLIED AFTER EVERY REBUILD, BECAUSE THE ROWS ARE
     * NEW NODES. <== `innerHTML` throws away the elements carrying the focus
     * class and puts fresh ones in their place. A filter change is the case
     * that shows it: the reader focuses Katrina, switches to Majors, and
     * without this her row comes back unmarked while the globe still has her
     * bright — the panel and the map disagreeing, which is the one thing this
     * view is careful about everywhere else. */
    paintFocus();
    /* Same reason, and the one state `innerHTML` genuinely cannot carry. */
    paintCheckAll();
  }

  return { render, rosterHtml };
}
