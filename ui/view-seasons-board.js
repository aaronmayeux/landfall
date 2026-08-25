/**
 * view-seasons-board.js — the season board. §57.18, §57.19, §57.30 step 5.
 *
 * ==> IT IS A VIEW INSIDE THE ONE DRAWER, NOT A SECOND PANEL. <== §16 says
 * there is exactly one panel element on screen and everything else is a view
 * inside it. Building the archive its own sheet would have meant a second
 * focus trap, a second scroll container, a second set of sheet-or-rail
 * breakpoints and a second Escape rule — four chances to drift out of step
 * with the panel every other screen in this app uses. It registers late,
 * from `seasons/index.js`, so nothing about it is on the boot path.
 *
 * ==> THE ROSTER IS CHRONOLOGICAL, AND THE ORDER IS THE POINT. <== §57.18.
 * Names are handed out in order, so the list a season used IS the order it
 * happened in, and how far down the alphabet the names reach is how far the
 * season got. Nobody should ever "tidy" this by sorting it by strength.
 *
 * ==> A SEASON WITH NO STORMS AND A SEASON WE COULD NOT REACH GET DIFFERENT
 * SENTENCES. <== §5, and it is the whole reason this view has three states
 * rather than an empty list. The Atlantic genuinely recorded two storms in
 * 1914; NOAA's file being unreachable is a different fact, and an archive that
 * drew both as a blank roster would be telling a reader a quiet year happened
 * when the truth is we do not know.
 *
 * ==> THE TWO ROADS TO A SEASON MEET IN `ui/seasons-board-loading.js`, NOT
 * HERE. <== §57.30 step 5b. Both hand back the same shape, so nothing below is
 * branched on which record it is looking at.
 *
 * ==> AND THE SEASON IN PROGRESS SHOWS NO LANDFALL FIGURE AT ALL. <== Measured
 * on the real 2026 b-decks: the working best track carries no landfall marker,
 * because NOAA writes those into the reviewed record it publishes the
 * following spring. `Landfalls: 0` on a screen would read as "nothing reached
 * land this year", which is a claim the data cannot support, so the cell is a
 * dash and the note says why (`ui/seasons-board-markup.js`). Computing our own
 * is decided (§57.7) and is not this step.
 *
 * ==> TICKING A STORM ALSO FOCUSES IT, AND THAT IS THE WHOLE OF STEP 6'S
 * INTERACTION DESIGN. <== §57.21 item 2. It has to work by thumb, by mouse and
 * by keyboard (§13), and it must not put a second control on every roster row
 * — that is clutter on a phone for a list running to forty rows. A pointer
 * selects by tapping the track on the globe and clears by tapping open water;
 * a keyboard uses Enter on the row, which toggles.
 *
 * ==> TICKING USED TO SELECT, AND IT COST EXACTLY WHAT WAS PREDICTED. <==
 * Aaron, 2026-08-25: tick four storms to compare them and only the last is
 * bright, with the other three ghosted. `Show all evenly` was the way back and
 * it is gone with the coupling that needed it.
 *
 * WHAT IS NOT HERE, ON PURPOSE: the wind field is step 6b; the detail panel is
 * step 7; the near-home slider is step 9 and is why §57.19's fourth filter is
 * absent from the three below rather than present and dead.
 *
 * ==> AND THE FETCHING IS NOT HERE EITHER, SINCE 2026-08-25. <== SPEC.md §12's
 * fifth cut out of this file. `ui/seasons-board-loading.js` holds every index,
 * every season and every failure reason; what is left here is what the reader
 * CHOSE — the basin, the year, the filter, the ticks and the open storm — plus
 * the render where the two halves meet.
 *
 * Imports config/, lib/ and its own siblings. Never data/ or map/ — the fetch
 * and the globe both arrive as injected facades (§12).
 */

import { stormDisplayName } from '../lib/season-names.js';
import { isStillRunning } from '../lib/season-facts.js';
import { basinHasLive } from '../lib/season-years.js';
import { createSeasonsBoardLoading } from './seasons-board-loading.js';
import {
  entriesMatching, filtersFor, filtersHtml, indexFailedHtml, liveDownHtml,
  pickerHtml, scoreHtml, seasonRosterHtml, waitingHtml,
} from './seasons-board-markup.js';
import { paintCheckAll, paintFocus, paintTick } from './seasons-board-paint.js';


/**
 * @param {object} opts
 * @param {object} opts.seasons  injected fetch facade for SETTLED years —
 *   `loadIndex`, `loadSeason`, `seasonsIn`, `basinsIn`, `basinLabel`. `ui/`
 *   never imports `data/` (§12), the same shape every other panel takes.
 * @param {object} opts.live  injected facade for the season in progress —
 *   `loadLiveIndex`, `loadLiveSeason`, `clearLiveCache`. Separate rather than
 *   folded in, because the two read completely different sources and a single
 *   facade would hide which one a failure came from.
 * @param {(selected:Array<{storm:object,facts:object}>) => void} opts.onSelection
 *   ticked storms changed — the globe redraws from the whole set.
 * @param {(id:string|null) => void} opts.onFocus
 *   which storm is bright, or null for all of them evenly. Separate from
 *   `onSelection` because it is a repaint and that is a rebuild (§57.21).
 * @param {(where:{basin:string,year:number,label:string}|null) => void} opts.onWhere
 *   the bar's sentence. Called whenever the year or basin settles.
 * @param {(id:string) => void} [opts.onOpenStorm]
 *   a row's chevron was pressed. §57.22b. The board does not open the panel
 *   itself — it does not know the drawer exists — it says which storm and
 *   `seasons/index.js` pushes the view.
 */
export function createSeasonsBoardView({
  seasons, live, onSelection, onFocus, onWhere, onOpenStorm,
}) {
  let host = null;
  let bodyEl = null;

  /* --- state ---------------------------------------------------------------
   * ==> WHAT IS LEFT HERE IS WHAT THE READER CHOSE. <== Aaron's line,
   * 2026-08-25, and it is the boundary the fifth cut was made on. Every piece
   * of state that describes something FETCHED — which years exist, whether the
   * index arrived, what the season contained — lives in
   * `ui/seasons-board-loading.js`. What is below is the four choices a reader
   * makes with their thumb, and they meet the fetched half in exactly one
   * place: the render that reads both.
   *
   * All of it is this view's own. Nothing here is read by anybody else, and
   * the globe learns about changes through `onSelection` rather than by
   * reaching in.
   * ---------------------------------------------------------------------- */

  let basin = null;
  let year = null;

  let filter = 'all';
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

  /* --- the fetched half ---------------------------------------------------
   * `ui/seasons-board-loading.js` holds every index, every season and every
   * failure reason, plus the year rules that read them. It is handed the same
   * two facades this view was given, and three hooks back: the redraw, the
   * moment the years become knowable, and the moment a season is replaced.
   * Those three are the only places a load touches a choice, and each one
   * runs at exactly the point in the sequence the single function used to.
   * ---------------------------------------------------------------------- */

  const loading = createSeasonsBoardLoading({
    seasons,
    live,
    render: () => render(),
    onIndexReady: () => onIndexReady(),
    onSeasonChanging: (provisional) => onSeasonChanging(provisional),
  });

  /** Which season to fetch is `basin` and `year`, and both are choices this
   *  view owns — so every caller below asks through here rather than the
   *  loading file reading state it does not hold. */
  const loadSeasonNow = () => loading.loadSeason(basin, year);

  /* --- selection -----------------------------------------------------------
   * §57.21 item 2. Three entry points — Enter on a row, a tap on the globe,
   * and clearing — and all three go through `setFocus`, so the roster and the
   * map can never disagree about which storm is open.
   *
   * ==> WHAT THIS SECTION DECIDES, AND WHAT IT DOES NOT. <== It owns what is
   * TRUE: which storm is open, which are ticked, who needs telling. Turning
   * that into changes on rows that are already on screen is
   * `ui/seasons-board-paint.js`, which took the cut when this file crossed
   * §12's ceiling for the fourth seasons pass running. The two functions below
   * that end in `Now` are the bindings that hand it this board's state.
   * ---------------------------------------------------------------------- */

  /**
   * The storms in this season that are still happening. §57.21c.
   *
   * ==> RECOMPUTED PER READ RATHER THAN HELD, BECAUSE IT GOES STALE ON ITS OWN.
   * <== `isStillRunning` is an answer about the clock, not about the file: a
   * storm that was running when the season loaded is finished twelve hours
   * later without anything on this screen changing. Every caller here runs at
   * paint time or at tap time, so asking then is asking at the only moment the
   * answer is worth anything — and it costs one subtraction per row.
   *
   * A settled year returns an empty set on the first comparison inside the
   * predicate, so the ordinary case pays almost nothing.
   */
  function activeIds() {
    const provisional = loading.state().provisional;
    const out = new Set();
    if (!provisional) return out;
    for (const e of loading.entries()) {
      if (isStillRunning(e.facts, { provisional })) out.add(e.storm.id);
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
    return loading.entries().filter(
      (e) => ticked.has(e.storm.id) && !active.has(e.storm.id)
    );
  }

  function pushSelection() {
    onSelection?.(selectedEntries());
    /* The bar carries the count of what is drawn, so every push is also an
     * announcement. §57.21b item 8. */
    announceWhere();
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
    announceWhere();
  }

  /** The open storm, out of the WHOLE season rather than the filtered rows —
   *  a storm can stay open while a filter narrows past it and the footprint
   *  sentence must not vanish while its track is still bright. */
  function paintFocusNow() {
    const entries = loading.entries();
    paintFocus(bodyEl, focused, focused ? entries.find((x) => x.storm.id === focused) : null);
  }

  /** The master box counts the FILTERED list against the ticks, which is the
   *  spreadsheet's rule — under Majors it speaks for the majors. */
  function paintCheckAllNow() {
    /* DRAWABLE rows, matching `seasonRosterHtml`. A running storm's box is
     * disabled, so counting it here would leave the master box permanently
     * short of full — see the note beside `drawable` in the markup. */
    const active = activeIds();
    const shown = entriesMatching(loading.entries(), filter)
      .filter((x) => !active.has(x.storm.id));
    paintCheckAll(bodyEl, shown.length,
      shown.reduce((n, x) => n + (ticked.has(x.storm.id) ? 1 : 0), 0));
  }

  /* --- the two hooks the loading file calls back on -------------------------
   * Both are moments where a FETCH has to touch a CHOICE. They are here rather
   * than in `ui/seasons-board-loading.js` because the choice is what they
   * change, and each one runs at exactly the point in the sequence the single
   * load function used to run it.
   * ---------------------------------------------------------------------- */

  /**
   * The settled index has landed, so the years are knowable — pick one.
   *
   * ==> AND THE DEFAULT YEAR IS THE SEASON IN PROGRESS. <== Aaron's call,
   * 2026-08-24. It is the newest year and the one a reader most likely came
   * for, and on the Atlantic it is three small files — cheaper than the
   * 14 KB a busy settled season costs. `yearsFor` already puts it first, so
   * this is the same "newest year" rule step 5a shipped rather than a second
   * one.
   *
   * ==> A REQUESTED YEAR THE ARCHIVE DOES NOT HOLD IS DROPPED, NOT DRAWN.
   * <== `setSeason` may have been handed a year before this ran. It is a
   * number the link parser accepted, which is not the same as a season this
   * basin has — the Pacific record only opens in 1949, so `?season=1900`
   * is a real Atlantic year with no Pacific half. Falling back to the newest
   * is right; silently loading a file that is not there would spend the
   * reader's one attempt on a 404.
   */
  function onIndexReady() {
    /* Default to the first basin the index lists. */
    const first = seasons.basinsIn(loading.index())[0] || null;
    if (basin == null) basin = first;

    const years = loading.yearsFor(basin);
    if (year == null || !years.includes(year)) year = years[0] ?? null;

    render();
    loadSeasonNow();
  }

  /**
   * A new season is about to be fetched. Everything the reader had chosen
   * about the one that is leaving goes now.
   */
  function onSeasonChanging(provisional) {
    /* The filter travels with the season and one of them may not exist on the
     * next. Falling back to `all` rather than refusing the year: the reader
     * asked for the season, not for the filter. */
    if (!filtersFor(provisional).some((f) => f.id === filter)) filter = 'all';
    /* The globe empties the moment the year changes, before the new one
     * arrives. Leaving 2005's tracks up while 1935 loads would put a year on
     * the bar that the globe is not showing. */
    ticked.clear();
    pushSelection();
    /* And the focus goes with them. It is an id from the old season, and ids
     * do not repeat across years — so left standing it would ghost every track
     * in the new one in favour of a storm that is not in it. */
    setFocus(null);
    announceWhere();
  }

  /**
   * What the bar says. §57.21b item 8.
   *
   * ==> IT CARRIES THREE FACTS NOW, NOT ONE, AND THE BAR TURNS THEM INTO A
   * SENTENCE. <== The year and basin were enough while the bar was only a
   * label; it is an info bar now, and the two things a reader cannot see from
   * the globe alone are how many storms are drawn and which one they have
   * open. The wording lives in `seasons/bar.js` — this function reports facts
   * and never a phrase, so there is one place to change what the bar says.
   *
   * ==> AND IT IS CALLED FROM FOUR PLACES RATHER THAN ONE. <== The season
   * settling, a tick, a selection, and re-entry. A bar that updated only on a
   * year change would say `3 shown` over a globe with none on it the moment
   * anybody unticked something.
   */
  function announceWhere() {
    if (!(loading.indexState() === 'ok' && basin && year)) {
      onWhere?.(null);
      return;
    }
    const entries = loading.entries();
    const open = focused ? entries.find((e) => e.storm.id === focused) : null;
    onWhere?.({
      basin,
      year,
      label: `${year} · ${seasons.basinLabel(loading.index(), basin)}`,
      shown: selectedEntries().length,
      openName: open ? stormDisplayName(open.storm) : '',
    });
  }

  /* --- markup -------------------------------------------------------------
   * Rebuilt wholesale on state change, like the Layers view: the shape is
   * small and static and one render path cannot drift from a patch path. The
   * SCROLLER is built once and never replaced, which is what stops the panel
   * snapping to the top every time a checkbox moves.
   * ---------------------------------------------------------------------- */

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
      year,
      provisional: s.provisional,
      rows: entriesMatching(entries, filter),
      anyEntries: entries.length > 0,
      ticked,
      ghosts: filter === 'all' ? s.roster : null,
      /* §57.21c. The row uses it for the disabled box and the `– active` date;
       * the master box uses it to count only what can be drawn. */
      activeIds: activeIds(),
    });
  }

  function render() {
    if (!bodyEl) return;

    /* ==> ONE BUNDLE PER REDRAW, NOT A DOZEN GETTERS THREADED THROUGH THE
     * TEMPLATE. <== Everything below that describes what ARRIVED comes off
     * this one read of `ui/seasons-board-loading.js`; everything that
     * describes what the reader CHOSE is still a local. That is the seam of
     * the fifth cut, and this function is the only place the two halves meet. */
    const s = loading.state();

    if (s.indexState === 'loading') {
      bodyEl.innerHTML = waitingHtml('Opening the archive…');
      return;
    }

    if (s.indexState === 'unavailable') {
      bodyEl.innerHTML = indexFailedHtml();
      return;
    }

    /* ==> EACH PIECE IS BUILT BEFORE THE TEMPLATE, NOT INSIDE IT. <== Partly
     * readability, and partly because `tools/css-orphan-check.mjs` scans
     * template literals for the classes this app emits — a method call sitting
     * inside one reads as a class name to it, and it reported `.basinsIn` and
     * `.basinLabel` as dead CSS. A checker that can be confused by formatting
     * is one whose next real finding gets waved through as noise. */
    const idx = loading.index();
    const picker = pickerHtml({
      basins: seasons.basinsIn(idx),
      labelFor: (b) => seasons.basinLabel(idx, b),
      basin,
      years: loading.yearsFor(basin),
      year,
      liveYear: loading.liveYear(),
    });

    const scorecard = scoreHtml({
      score: s.score,
      roster: s.roster,
      provisional: s.provisional,
      unreadable: s.unreadable,
      stale: Boolean(s.provisional && s.liveStale),
    });

    const filters = filtersHtml({ filters: filtersFor(s.provisional), filter });

    /* Hoisted out of the template for the reason above, and it is no longer
     * optional: `s.liveRetrying` inside a template literal reads to
     * `tools/css-orphan-check.mjs` as a class called `liveRetrying`. */
    const liveDown = liveDownHtml({
      hasLive: basinHasLive(basin),
      retrying: s.liveRetrying,
      reason: s.liveReason,
    });

    const roster = rosterHtml();

    bodyEl.innerHTML = `
      ${picker}
      ${liveDown}
      ${scorecard}
      ${filters}
      ${roster}`;

    /* ==> THE FOCUS IS RE-APPLIED AFTER EVERY REBUILD, BECAUSE THE ROWS ARE
     * NEW NODES. <== `innerHTML` throws away the elements carrying the focus
     * class and puts fresh ones in their place. A filter change is the case
     * that shows it: the reader focuses Katrina, switches to Majors, and
     * without this her row comes back unmarked while the globe still has her
     * bright — the panel and the map disagreeing, which is the one thing this
     * view is careful about everywhere else. */
    paintFocusNow();
    /* Same reason, and the one state `innerHTML` genuinely cannot carry. */
    paintCheckAllNow();
  }

  /* --- input --------------------------------------------------------------
   * ONE DELEGATED LISTENER PER EVENT TYPE, on the scroller, so a wholesale
   * re-render cannot leave a handler bound to a discarded node. Every control
   * below is a real <button>, <select> or <input>, so tap, click and keyboard
   * are the same path and none of this branches on device (§13).
   * ---------------------------------------------------------------------- */

  function onClick(e) {
    const basinBtn = e.target.closest('[data-basin]');
    if (basinBtn) {
      const next = basinBtn.dataset.basin;
      if (next === basin) return;
      basin = next;
      /* Hold the year across a basin change when the other basin has it. The
       * Pacific record opens in 1949, so 1900 has no Pacific half — falling
       * back to that basin's newest year is better than refusing the switch.
       * `yearsFor` rather than the settled list, so switching basins inside
       * the season in progress stays inside it. */
      const years = loading.yearsFor(basin);
      if (!years.includes(year)) year = years[0] ?? null;
      loadSeasonNow();
      return;
    }

    const step = e.target.closest('[data-step]');
    if (step) {
      const years = loading.yearsFor(basin);
      const i = years.indexOf(year);
      const next = step.dataset.step === 'older' ? years[i + 1] : years[i - 1];
      if (next == null) return;
      year = next;
      loadSeasonNow();
      return;
    }

    const filterBtn = e.target.closest('[data-filter]');
    if (filterBtn) {
      if (filterBtn.dataset.filter === filter) return;
      filter = filterBtn.dataset.filter;
      /* ==> AND THE GLOBE EMPTIES WITH IT. <== Aaron's call, 2026-08-25, and it
       * REVERSES what this comment used to argue. The old rule was that a
       * filter narrows what the roster SHOWS and must not un-choose a storm
       * the reader deliberately ticked. What that produced on glass was a
       * globe carrying storms the list in front of you does not contain —
       * switch to Majors and three tropical storms stay drawn with no row to
       * point at, which is the same panel-and-map disagreement the old rule
       * was written to prevent, arriving from the other side.
       *
       * ==> THE CLEARING HAS TO BE VISIBLE, WHICH IS WHY IT IS A PUSH AND NOT
       * A QUIET RESET. <== The globe empties in the same frame the roster
       * changes. A silent wipe that took effect on the next poll would be
       * indistinguishable from the tracks having failed to draw.
       *
       * The selection goes first: `setFocus` refuses an id nobody has ticked,
       * so with the set already cleared it can only resolve to null. */
      ticked.clear();
      setFocus(null);
      pushSelection();
      render();
      return;
    }

    /* ==> A TAP ANYWHERE ON THE ROW OPENS THAT STORM'S PANEL. §57.22b. <==
     * Aaron on glass, 2026-08-25. The row used to be a `<label>` that ticked
     * and the chevron alone opened; he wants the row to open. So the swatch,
     * the text and the chevron are now ONE button and the tick box is a 44px
     * label beside it.
     *
     * It does NOT tick or focus here. Both happen, but on the way IN to the
     * panel (`showStorm`, called from the panel's own `onEnter`), so there is
     * exactly one path that makes the globe agree with the panel and it runs
     * whether the reader arrived by this row, by Back, or by a deep link.
     *
     * ==> AND THE SELECTOR IS SCOPED TO A CLASS, WHICH IS THE FIX FOR THE
     * FAULT THAT KILLED STEP 7 THE FIRST TIME. <== It read
     * `closest('[data-open]')`. **`#drawer` itself carries `data-open`** —
     * `ui/drawer.js` publishes the sheet's open state there and
     * `ui/panels.css` styles off it — and this board's body is INSIDE
     * `#drawer`. So every click anywhere in this drawer that no earlier branch
     * claimed walked up past the roster and matched THE SHEET, handing this
     * line `dataset.open === "true"`. The board then asked to open a storm
     * called `true` and the panel answered *"That storm is not in this
     * season."*
     *
     * That is Aaron's report of 2026-08-25 — *"pretty much anywhere I touch
     * closes the drawer or does something I don't intend"* — reproduced, and
     * the first cause for it anybody has been able to point at. The roster row
     * and the years split were both suspected for a day and both were
     * innocent.
     *
     * **A BARE ATTRIBUTE SELECTOR IN A DELEGATED HANDLER IS A QUERY AGAINST
     * EVERY ANCESTOR UP TO THE DOCUMENT**, and this view has six more of them.
     * `tools/test-seasons-board.mjs` drives a click on inert roster text with
     * the real drawer chrome above it, which is the only shape that catches
     * this class of fault. */
    const openBtn = e.target.closest('.seasons-open');
    if (openBtn) {
      onOpenStorm?.(openBtn.dataset.open);
      return;
    }

    if (e.target.closest('.seasons-retry')) {
      /* Checked FIRST, because it is the narrower case. This button sits on a
       * board whose settled index loaded fine and whose season is on screen,
       * so both branches below would have run and neither would have asked
       * for the thing that actually failed. */
      if (e.target.closest('[data-retry="live"]')) {
        loading.retryLive();
        return;
      }
      if (loading.indexState() === 'unavailable') {
        loading.retryIndex();
      } else {
        loadSeasonNow();
      }
    }
  }

  /**
   * ==> ENTER ON A TICKED ROW OPENS THAT STORM IN FULL DETAIL, AND TOGGLES.
   * <== §13 asks every action for a thumb, a mouse and a keyboard path. Since
   * ticking stopped selecting, a pointer selects by tapping the track on the
   * globe — which a keyboard cannot do at all, and a feature that exists only
   * as a gesture does not exist for keyboard users.
   *
   * ==> ENTER RATHER THAN A SECOND BUTTON ON THE ROW, AND THAT IS A DELIBERATE
   * AVOIDANCE. <== A chevron beside each row is the more discoverable control
   * and it is also exactly the markup step 7 added before glass reported every
   * tap target in this drawer misbehaving (NOW.md). The cause of that is still
   * unknown, so this pass does not re-introduce the shape while it is under
   * suspicion. Enter costs no markup at all: Tab already lands on the row's
   * checkbox and Space already ticks it, and a native checkbox does nothing
   * with Enter in any browser — so there is nothing to collide with.
   *
   * ==> IT TOGGLES, WHICH IS ALSO THE KEYBOARD'S WAY BACK OUT. <== A pointer
   * clears the selection by tapping open water. Enter on the storm that is
   * already open is the same escape without reaching for the globe, and it
   * keeps the whole interaction on one key rather than needing a second.
   */
  function onKeydown(e) {
    if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.altKey) return;
    const box = e.target.closest('[data-storm]');
    if (!box) return;
    const id = box.dataset.storm;
    if (!ticked.has(id)) return;
    /* Swallowed so the keypress cannot also reach the drawer or the globe's
     * own Escape-and-arrows contract behind it. */
    e.preventDefault();
    setFocus(focused === id ? null : id);
  }

  function onChange(e) {
    const select = e.target.closest('.seasons-select');
    if (select) {
      const next = Number(select.value);
      if (!Number.isFinite(next) || next === year) return;
      year = next;
      loadSeasonNow();
      return;
    }

    /* ==> THE MASTER BOX, AND IT ANSWERS BEFORE THE PER-STORM ONE. §57.21b
     * item 4. <== It carries no `data-storm`, so the order is not strictly
     * load-bearing — but it is the narrower case and reading it first is what
     * stops a future rename quietly falling through into the storm branch.
     *
     * ==> IT WORKS ON THE FILTERED LIST, WHICH IS THE SPREADSHEET'S RULE. <==
     * Under Majors it ticks the majors and nothing else. Reaching past the
     * filter would put storms on the globe the roster is not showing.
     *
     * ==> FULL MEANS CLEAR, ANYTHING ELSE MEANS FILL. <== The native box's own
     * `checked` cannot be trusted here: the browser flips it on click, and
     * from the indeterminate state it flips it to `true`, which happens to
     * agree with us. Recomputing from the roster is what makes the three
     * states behave the same way from every direction.
     *
     * ==> AND UNTICKING EVERYTHING TAKES THE SELECTION WITH IT. <== `setFocus`
     * refuses an id nobody has ticked, so a focus left standing would ghost
     * every remaining track in favour of a storm that is not on the globe. */
    if (e.target.closest('[data-check-all]')) {
      /* The same drawable list the box is counting, so pressing it can actually
       * reach "full". Ticking a running storm here would be a tick the globe
       * declines, which is a control that appears to do nothing. §57.21c. */
      const active = activeIds();
      const shown = entriesMatching(loading.entries(), filter)
        .filter((x) => !active.has(x.storm.id));
      const full = shown.length > 0 && shown.every((x) => ticked.has(x.storm.id));
      for (const x of shown) {
        if (full) ticked.delete(x.storm.id); else ticked.add(x.storm.id);
      }
      if (focused && !ticked.has(focused)) setFocus(null);
      pushSelection();
      /* A rebuild rather than a patch, and this is the one tick path that
       * earns it: every row's box has just changed, so there is nothing to
       * preserve that a patch would be preserving. */
      render();
      return;
    }

    const box = e.target.closest('[data-storm]');
    if (box) {
      const id = box.dataset.storm;
      if (box.checked) ticked.add(id); else ticked.delete(id);
      /* The master box above has three states and one of them has just
       * changed. Patched rather than rebuilt — the reader's thumb is on a row
       * in the list this would replace. */
      paintCheckAllNow();
      /* No re-render. The checkbox has already drawn itself and rebuilding the
       * list under a thumb mid-tap is how a roster loses its scroll position
       * and its focus ring at once. */
      pushSelection();
      /* ==> TICKING DOES NOT SELECT, AND THAT IS THE WHOLE POINT OF THE SPLIT.
       * <== Aaron's call, 2026-08-25. It used to: ticking a storm focused it,
       * so a reader comparing four storms of 2005 ticked four and watched
       * three of them drop to ghosts, with the last one they happened to touch
       * arbitrarily bright. Checking now means "put this on the globe" and
       * nothing else — four ticks give four tracks, all equal.
       *
       * ==> UNTICKING THE SELECTED STORM STILL CLEARS THE SELECTION, AND THAT
       * IS NOT THE OLD COUPLING COMING BACK. <== `setFocus` refuses an id
       * nobody has ticked, so leaving this out would mean a selection pointing
       * at a storm no longer on the globe: every remaining track ghosted in
       * favour of one nobody can see. */
      if (!box.checked && focused === id) setFocus(null);
    }
  }

  return {
    id: 'seasons-board',
    title: 'Past storms',

    /* ==> THE HEADER'S X IS A MINIMISE CHEVRON HERE, AND NOWHERE ELSE. §57.21b
     * item 8. <== Closing this board does not leave the archive — the globe
     * stays sepia and the bar stays on screen as the way back in. An X says
     * "done with this", which is not what the button does. The flag is read by
     * `ui/drawer.js`; every other view leaves it unset and keeps its X. */
    minimises: true,

    mount(el) {
      host = el;
      host.innerHTML = '<div class="drawer-body" id="seasons-board-body"></div>';
      bodyEl = host.querySelector('#seasons-board-body');
      bodyEl.addEventListener('click', onClick);
      bodyEl.addEventListener('change', onChange);
      bodyEl.addEventListener('keydown', onKeydown);
      render();
      loading.loadIndexOnce();
    },

    onEnter() {
      /* Re-announce on every entry. The reader may have closed the board and
       * come back, and the bar must still name the year the globe is showing. */
      announceWhere();
      render();
    },

    /** First stop is the year, because choosing a year is why anyone opens
     *  this. Not the Back button, and not the first storm. */
    focus() {
      return bodyEl?.querySelector('.seasons-select');
    },

    /**
     * Open on a particular year — a `?season=` link, and nothing else today.
     *
     * ==> IT IS ASKED FOR, NOT IMPOSED, AND THAT IS WHY IT TAKES EFFECT IN TWO
     * PLACES. <== Entry calls this BEFORE the index has arrived, so there is
     * no list of years yet to check the request against. The year is held and
     * `loadIndexOnce` honours it once it knows which years exist — and drops
     * it if the archive does not hold that one, rather than opening on a
     * season that is not there. `seasons/deep-link.js` has already proved the
     * year is a plausible number; only the index knows if it is a real season.
     */
    setSeason(y) {
      if (Number.isFinite(y)) year = y;
    },

    /**
     * A tap on the globe chose a storm, or chose open water.
     *
     * The globe's way in, routed through `seasons/index.js`. It is the same
     * `setFocus` the tick uses, so there is one path and the roster cannot
     * end up disagreeing with the map about which storm is bright — including
     * the refusal: a tap that somehow resolves to an unticked storm clears
     * the focus rather than lighting something invisible.
     */
    setFocus(id) {
      setFocus(id);
    },

    /**
     * The storm detail panel opened on this storm — make the globe agree.
     * §57.22b.
     *
     * ==> `setFocus` REFUSES AN ID NOBODY HAS TICKED, AND THAT REFUSAL IS BUG
     * THREE. <== The first version of step 7 routed the panel's `onOpen`
     * straight at `setFocus`, which for an unticked storm resolves to null and
     * does nothing. The reader would have got a panel full of Katrina's
     * figures over a globe with no Katrina on it — the panel and the map
     * disagreeing, which is the one failure this whole view is careful about,
     * arriving through the door built to prevent it.
     *
     * So opening TICKS FIRST. That is not §57.21a's coupling coming back:
     * that rule says ticking must not select, and this is the other direction
     * — the globe shows what the panel is about. The reader can untick it
     * again the moment they are back on the roster.
     *
     * ==> THE ROW IS PATCHED, NOT RE-RENDERED. <== The reader is about to come
     * Back to this list and it must still be where they left it.
     */
    showStorm(id) {
      if (!id || !loading.entries().some((e) => e.storm.id === id)) return;
      /* ==> A RUNNING STORM OPENS ITS PANEL AND DOES NOT TOUCH THE GLOBE.
       * §57.21c. <== The panel is a page of figures about a storm on the
       * roster and it stays reachable. What must not happen is the tick and
       * the focus: the tick is refused by `selectedEntries` anyway, and the
       * focus would then ghost every visible track in favour of a storm that
       * is deliberately not on this globe — the panel and the map disagreeing,
       * which is the failure this view is careful about everywhere else. */
      if (activeIds().has(id)) return;
      if (!ticked.has(id)) {
        ticked.add(id);
        paintTick(bodyEl, id, true);
        paintCheckAllNow();
        pushSelection();
      }
      setFocus(id);
    },

    /**
     * The season this board currently holds, for the detail panel.
     *
     * ==> A FUNCTION THE PANEL CALLS, NOT AN ARRAY IT KEEPS. <== The board
     * reloads `entries` on every year change, so a captured array would leave
     * the panel describing last year's storm under this year's heading. The
     * live copy is returned rather than a clone because the panel only reads
     * it — cloning a season on every render to defend against a mutation
     * nobody makes would cost more than it protects.
     */
    currentEntries() {
      return loading.entries();
    },

    /** Leaving the archive entirely — drop the globe's tracks and forget the
     *  ticks, so a second visit does not open with a stale selection. */
    reset() {
      ticked.clear();
      /* AFTER the clear and BEFORE the push, because `setFocus` refuses an id
       * nobody has ticked — with the set already empty it can only resolve to
       * null, which is the state a fresh visit has to start in. */
      setFocus(null);
      pushSelection();
    },
  };
}
