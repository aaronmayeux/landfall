/**
 * seasons-board-selection.js — what is ticked, what is open, and who to tell.
 * SPEC-SEASONS-BUILD.md §57.21 item 2, §57.21c. SPEC.md §12's sixth cut out of
 * `ui/view-seasons-board.js`.
 *
 * ==> THE STATE MOVED WITH THE CODE, AND THAT IS THE WHOLE TEST A CUT HAS TO
 * PASS. <== `ticked` and `focused` live here now, not in the view. That is what
 * makes this a cut rather than a relocation: the board no longer holds two
 * pieces of state it then hands back through a getter, and nothing outside this
 * file can put the roster and the globe into disagreement about which storm is
 * open. `ui/seasons-board-loading.js` was cut on the same test — what was
 * FETCHED went there, whole.
 *
 * ==> WHAT WAS NOT CUT, AND WHY THE OBVIOUS SEAM WAS THE WRONG ONE. <== SPEC.md
 * §12 named the INPUT handlers for five passes running, calling them "roughly
 * 300 lines of event routing" over "six actions that already exist". Measured
 * on 2026-08-25: the input block is 288 lines of which about FIFTEEN are
 * dispatch, and three of the ten actions exist as functions. Lifting the
 * routing moves nothing; extracting the actions first is a rewrite of the
 * handlers. The seam was named without being measured. Do not take it on the
 * strength of that row alone.
 *
 * ==> THREE ENTRY POINTS, ONE DOOR. <== Enter on a row, a tap on a drawn track,
 * and clearing. All three go through `setFocus`, which refuses an id that is
 * not DRAWN — so the roster and the map cannot disagree about which storm is
 * bright, including in the refusal.
 *
 * ==> IT DECIDES WHAT IS TRUE, NEVER WHAT IS ON SCREEN. <== Turning a decision
 * into a change on a row already painted is `ui/seasons-board-paint.js`. The
 * two functions here that call into it are bindings, not painters.
 *
 * Imports lib/ and its own siblings. Never data/ or map/ — every fact about the
 * live feed, the season and the DOM arrives as an injected getter (§12).
 */

import { isStillRunning } from '../lib/season-facts.js';
import { entriesMatching } from './seasons-board-markup.js';
import { paintCheckAll, paintFocus } from './seasons-board-paint.js';

/**
 * @param {object} opts  every one of these is a GETTER rather than a value.
 *   The board is mounted once and kept for the life of the app, so a value
 *   captured here would be answering with the season, the filter, the house or
 *   the body element that existed at construction — none of which survive a
 *   year change, a units change or a remount.
 * @param {() => Array} opts.entries          the loaded season, live copy.
 * @param {() => boolean} opts.provisional    is this the season in progress.
 * @param {() => (Element|null)} opts.bodyEl  the scroller, for the paint calls.
 * @param {() => (Set<string>|null)} [opts.liveRunningIds]  §57.21c.
 * @param {() => string} opts.filter          which filter the reader chose.
 * @param {() => (object|null)} opts.near     the house and the circle, or null.
 * @param {(selected:Array) => void} [opts.onSelection]  the globe redraws.
 * @param {(id:string|null) => void} [opts.onFocus]      which storm is bright.
 * @param {() => void} opts.announce          the bar counts what is drawn.
 */
export function createSeasonsBoardSelection({
  entries, provisional, bodyEl, liveRunningIds,
  filter, near, onSelection, onFocus, announce,
}) {
  /** Storm ids the reader has ticked. Survives a filter change on purpose —
   *  switching to Majors and back must not silently wipe the globe. */
  const ticked = new Set();

  /** The one storm the reader has opened in full detail, or null. §57.21
   *  item 2.
   *
   *  ==> IT IS ALWAYS A STORM THAT IS ALSO TICKED, AND NOTHING ENFORCES THAT
   *  BUT THE PATHS BELOW. <== A selected storm that is not on the globe would
   *  dim every visible track in favour of one nobody can see, which reads as
   *  the archive breaking. There are exactly three ways it is set — Enter on a
   *  ticked row, a tap on a drawn track, and clearing — and none of them can
   *  produce an unticked selection. A fourth would have to keep that promise
   *  itself.
   *
   *  ==> TICKING IS NO LONGER ONE OF THEM. <== It was, until 2026-08-25. See
   *  `onChange` for what that cost on glass. */
  let focused = null;

  /**
   * The storms in this season that are still happening. §57.21c.
   *
   * ==> RECOMPUTED PER READ RATHER THAN HELD, BECAUSE IT GOES STALE ON ITS OWN.
   * <== This is an answer about the live feed and the clock, not about the
   * file: a storm that was running when the season loaded can have its final
   * advisory filed while somebody is still looking at the roster, and nothing
   * on this screen would change. Every caller here runs at paint time or at
   * tap time, so asking then is asking at the only moment the answer is worth
   * anything — and it costs one set lookup per row.
   *
   * ==> WHAT IT DOES NOT DO IS REPAINT ITSELF. <== The archive does not
   * subscribe to the live poll, so a storm that finishes while the board is on
   * screen moves from `– active` to drawable on the next thing that renders —
   * a year change, a filter, a tick. Accepted rather than overlooked: wiring
   * the poll into the archive to repaint a date cell would mean the live app
   * reaching into a world it is deliberately walled out of (§57.2), and the
   * window is minutes on a surface nobody is watching for that transition.
   *
   * A settled year returns an empty set on the first comparison inside the
   * predicate, so the ordinary case pays almost nothing.
   */
  function activeIds() {
    const isProvisional = provisional();
    const out = new Set();
    if (!isProvisional) return out;

    /* ==> THE LIVE APP IS ASKED FIRST, BECAUSE IT IS THE ONE ALREADY SHOWING
     * THE READER AN ANSWER. §57.21c. <== A storm greyed out on the live globe
     * is finished as far as this globe is concerned; anything still in colour
     * is still happening and stays off the sepia record. One predicate, both
     * worlds, the same way `categoryFromKt` grades a Cat 3 in 1935 and today.
     *
     * `liveRunning` is a lowercased ATCF id set; the roster's ids are the same
     * strings out of the b-deck filename. */
    const liveRunning = liveRunningIds?.() ?? null;
    if (liveRunning) {
      for (const e of entries()) {
        if (liveRunning.has(String(e.storm.id).toLowerCase())) out.add(e.storm.id);
      }
      return out;
    }

    /* ==> AND THE FALLBACK IS FOR ONE CASE ONLY: THE LIVE FEED HAS NEVER
     * ANSWERED. <== Not "answered with no storms" — that is a real answer and
     * it means nothing is running. This is a deep link straight into the
     * archive, or a first poll still in flight, or every source down. The
     * honest reading of "we cannot ask" is not "everything is finished", which
     * would draw a storm currently out there as settled history with nothing
     * on screen saying so (§5). The age of the last b-deck row is a worse
     * answer than the live app's and a much better one than silence. */
    for (const e of entries()) {
      if (isStillRunning(e.facts, { provisional: isProvisional })) out.add(e.storm.id);
    }
    return out;
  }

  /**
   * What the globe draws: the ticked storms, minus any that are still running.
   *
   * ==> THE FILTER IS HERE AND NOT ONLY ON THE CHECKBOX, AND THAT IS NOT BELT
   * AND BRACES. <== The box being disabled stops a reader ticking a running
   * storm; it does nothing about one that was ticked while it was finished, or
   * about `showStorm`, which ticks on the panel's behalf. And the storm can
   * change state under a tick that is already set — the archive can be open for
   * an hour. This is the single place that decides what reaches the sepia
   * globe, so there is one rule rather than three that have to agree.
   */
  function selectedEntries() {
    const active = activeIds();
    return entries().filter(
      (e) => ticked.has(e.storm.id) && !active.has(e.storm.id)
    );
  }

  function pushSelection() {
    onSelection?.(selectedEntries());
    /* The bar carries the count of what is drawn, so every push is also an
     * announcement. §57.21b item 8. */
    announce();
  }

  /**
   * Move the highlight, tell the globe, and repaint the rows.
   *
   * ==> THE ROWS ARE PATCHED, NOT RE-RENDERED. <== `render()` rebuilds the
   * whole roster, which loses the scroll position and the keyboard focus ring
   * — the same reason ticking a checkbox does not re-render (see `onChange`).
   * Focus moves on every tap on the globe, so a wholesale rebuild here would
   * be the most disruptive thing in the feature attached to its most frequent
   * interaction.
   */
  function setFocus(id) {
    /* An id nobody has ticked is refused rather than honoured. The globe only
     * draws ticked storms, so focusing one that is not there would ghost every
     * visible track for a highlight nobody can see.
     *
     * ==> AND "TICKED" IS NOT QUITE THE TEST. THE TEST IS "DRAWN". <== §57.21c
     * takes a running storm off the archive globe whatever its tick says, so
     * the refusal has to ask the same question `selectedEntries` does or Enter
     * on such a row would ghost the whole year for an invisible highlight. */
    const drawn = id && selectedEntries().some((e) => e.storm.id === id);
    const next = drawn ? id : null;
    if (next === focused) return;
    focused = next;
    paintFocusNow();
    onFocus?.(focused);
    /* The bar names the open storm, so it has to hear about this. §57.21b
     * item 8. */
    announce();
  }

  /** The open storm, out of the WHOLE season rather than the filtered rows —
   *  a storm can stay open while a filter narrows past it and the footprint
   *  sentence must not vanish while its track is still bright. */
  function paintFocusNow() {
    const all = entries();
    paintFocus(bodyEl(), focused, focused ? all.find((x) => x.storm.id === focused) : null);
  }

  /** The master box counts the FILTERED list against the ticks, which is the
   *  spreadsheet's rule — under Majors it speaks for the majors. */
  function paintCheckAllNow() {
    /* DRAWABLE rows, matching `seasonRosterHtml`. A running storm's box is
     * disabled, so counting it here would leave the master box permanently
     * short of full — see the note beside `drawable` in the markup. */
    const active = activeIds();
    const shown = entriesMatching(entries(), filter(), near())
      .filter((x) => !active.has(x.storm.id));
    paintCheckAll(bodyEl(), shown.length,
      shown.reduce((n, x) => n + (ticked.has(x.storm.id) ? 1 : 0), 0));
  }

  return {
    /** ==> THE SET ITSELF, NOT A COPY. <== Every caller in the view reads it
     *  with `.has`, `.add`, `.delete`, `.clear` and `.size`, and handing back
     *  the live object is what let this cut land without touching one of those
     *  lines. A clone would have needed fifteen call sites rewritten to prove
     *  nothing changed, which is the opposite of what a move is for. */
    ticked,

    /** `focused` is a primitive, so it cannot be shared the way the Set is —
     *  a copy would go stale the moment anything moved the highlight. Five
     *  places in the view read it and all five ask. */
    focusedId: () => focused,

    activeIds,
    selectedEntries,
    pushSelection,
    setFocus,
    paintFocus: paintFocusNow,
    paintCheckAll: paintCheckAllNow,
  };
}
