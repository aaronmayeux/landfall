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
 * ==> GHOSTS ARE THE CURRENT YEAR ONLY, AND THEIR ABSENCE IS SILENT. <==
 * Aaron's call, 2026-08-24, reaffirmed when the rosters stopped being typed by
 * hand. `lib/season-names-data.js` now carries six years ahead and accumulates
 * past ones, so the rule is enforced by the year this view hands to
 * `rosterFor` — not by the data being thin. A settled year has no ghost rows
 * and says nothing about names remaining. That is the honest shape: for a
 * finished season the names it used already answer "how far did it get", and
 * 2005 running past its list says it louder than blank rows would.
 *
 * ==> A SEASON WITH NO STORMS AND A SEASON WE COULD NOT REACH GET DIFFERENT
 * SENTENCES. <== §5, and it is the whole reason this view has three states
 * rather than an empty list. The Atlantic genuinely recorded two storms in
 * 1914; NOAA's file being unreachable is a different fact, and an archive that
 * drew both as a blank roster would be telling a reader a quiet year happened
 * when the truth is we do not know.
 *
 * ==> THERE ARE TWO ROADS TO A SEASON AND THIS VIEW IS WHERE THEY MEET. <==
 * §57.30 step 5b. A settled year is one static file in this repo; the year
 * currently running is two KV-backed routes and a different parser
 * (`data/seasons-live.js`, §58). Both arrive as injected facades and both hand
 * back the same shape, so everything below the load branch is one path — but
 * the branch itself is real and the reader is told which record they are
 * looking at, because §57.11 requires it.
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
 * Imports config/, lib/ and its own siblings. Never data/ or map/ — the fetch
 * and the globe both arrive as injected facades (§12).
 */

import { stormFacts, seasonFacts } from '../lib/season-facts.js';
import { rosterFor } from '../lib/season-names.js';
import {
  basinHasLive, isLiveSeason, liveYearOf, yearsFor as yearsForBasin,
} from '../lib/season-years.js';
import {
  esc, entriesMatching, filtersFor, filtersHtml, footprintNoteHtml,
  indexFailedHtml, liveDownHtml, pickerHtml, scoreHtml, seasonRosterHtml,
  waitingHtml,
} from './seasons-board-markup.js';

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
 */
export function createSeasonsBoardView({ seasons, live, onSelection, onFocus, onWhere }) {
  let host = null;
  let bodyEl = null;

  /* --- state ---------------------------------------------------------------
   * All of it is this view's own. Nothing here is read by anybody else, and
   * the globe learns about changes through `onSelection` rather than by
   * reaching in.
   * ---------------------------------------------------------------------- */

  /** `loading` | `ok` | `unavailable` — the index, not a season. */
  let indexState = 'loading';
  let index = null;
  let indexReason = '';

  let basin = null;
  let year = null;

  /** The season in progress, or null when the live routes could not be
   *  reached. Held whole rather than as a bare year, because the board also
   *  needs its storm list and its staleness. */
  let liveIndex = null;
  /** Why the live routes could not be reached, for the sentence that says so.
   *  Empty when they were. */
  let liveReason = '';
  /** A second attempt at the live index is in the air. Its own flag rather
   *  than reusing `seasonState`, because the season on screen is fine and
   *  must not blink while this happens. */
  let liveRetrying = false;

  /** `loading` | `ok` | `unavailable`, for the season currently chosen. */
  let seasonState = 'loading';
  let seasonReason = '';
  /** `[{ storm, facts }]`, chronological, as parsed. */
  let entries = [];
  let score = null;
  let roster = null;
  /** True while the chosen year is the one still running. */
  let provisional = false;
  /** Storms the live index listed that would not load. Zero on a settled
   *  year, which cannot have any — its storms come in one file. */
  let unreadable = 0;

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

  /** Bumped on every season load, so a slow fetch that lands after the reader
   *  has moved on cannot paint the wrong year over the right one. */
  let loadToken = 0;

  /* --- which years exist --------------------------------------------------
   * The rule itself is `lib/season-years.js` — the settled index answers for
   * every year NOAA has reviewed, the live one adds at most one on top, and
   * both the picker and the load path ask the same question so they can never
   * disagree about which years are choosable. Moved out when this file crossed
   * §12's ceiling for the third seasons pass running; the four functions there
   * read only the two indexes, which is what made them the cut that costs
   * nothing. These are the bindings that hand them this board's state.
   * ---------------------------------------------------------------------- */

  const yearDeps = () => ({ seasonsIn: seasons.seasonsIn, index, liveIndex });

  const liveYear = () => liveYearOf(liveIndex);
  const yearsFor = (b) => yearsForBasin(yearDeps(), b);
  const isLive = (b, y) => isLiveSeason(yearDeps(), b, y);

  /* --- selection ---------------------------------------------------------- */

  function selectedEntries() {
    return entries.filter((e) => ticked.has(e.storm.id));
  }

  function pushSelection() {
    onSelection?.(selectedEntries());
  }

  /* --- selection -----------------------------------------------------------
   * §57.21 item 2. Three entry points — Enter on a row, a tap on the globe,
   * and clearing — and all three go through `setFocus`, so the roster and the
   * map can never disagree about which storm is open.
   * ---------------------------------------------------------------------- */

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
     * visible track for a highlight nobody can see. */
    const next = id && ticked.has(id) ? id : null;
    if (next === focused) return;
    focused = next;
    paintFocus();
    onFocus?.(focused);
  }

  function paintFocus() {
    if (!bodyEl) return;

    for (const row of bodyEl.querySelectorAll('.seasons-row[data-row]')) {
      const on = focused != null && row.dataset.row === focused;
      row.classList.toggle('seasons-row-focus', on);
      /* `aria-current` rather than `aria-selected`: nothing here is a listbox,
       * and this is the ordinary meaning — the one item in a set the reader is
       * currently on. Removed rather than set to "false", which some screen
       * readers announce. */
      if (on) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    }

    /* ==> AND WHY THE FOCUSED STORM HAS NO WIND FOOTPRINT, WHERE THAT IS THE
     * CASE. <== §57.25 rule 2, §57.26a. Three quarters of the archive has no
     * wind field, so for most of what a reader opens this sentence IS step
     * 6b — the footprint layer draws the focused storm and nothing else, so
     * the presence and the absence are both discovered by the same tap.
     *
     * Written into a slot that is always in the markup: selection moves on
     * every tap on the globe, and rebuilding the roster here would cost the
     * reader their scroll position and their focus ring. `entries`
     * rather than the filtered rows, because a storm can stay focused while
     * the filter narrows past it (`onChange` documents that case) and the
     * sentence must not vanish while its track is still bright. */
    const slot = bodyEl.querySelector('.seasons-footprint');
    if (slot) {
      const e = focused ? entries.find((x) => x.storm.id === focused) : null;
      slot.innerHTML = footprintNoteHtml(e);
    }
  }

  /* --- loading ------------------------------------------------------------ */

  async function loadIndexOnce() {
    /* ==> BOTH INDEXES ARE ASKED FOR AT ONCE AND ONLY ONE OF THEM IS ALLOWED
     * TO STOP THE SCREEN. <== The settled index is a static file in this repo
     * and without it there are no years at all; the live one is two network
     * hops to NOAA and its failure costs exactly one year off the top of the
     * list. Awaiting them in sequence would have made a slow live route delay
     * an archive that does not need it. */
    const [settled, liveRes] = await Promise.all([
      seasons.loadIndex(),
      live.loadLiveIndex(),
    ]);

    /* ==> A LIVE INDEX THAT FAILED IS NULL, AND THE BOARD SAYS SO WHERE IT
     * MATTERS. <== §5. Silently dropping 2026 off the picker would leave a
     * reader unable to tell "the current season is unreachable" from "there
     * is no current season", and those are different facts. The sentence is
     * on the roster rather than the picker, because a missing OPTION is not a
     * place a reader looks for an explanation. */
    liveIndex = liveRes?.status === 'ok' ? liveRes : null;
    liveReason = liveRes?.status === 'ok' ? '' : (liveRes?.reason || '');

    if (settled.status !== 'ok') {
      indexState = 'unavailable';
      indexReason = settled.reason || '';
      render();
      return;
    }
    index = settled.index;
    indexState = 'ok';

    /* Default to the first basin the index lists. */
    const first = seasons.basinsIn(index)[0] || null;
    if (basin == null) basin = first;

    /* ==> AND THE DEFAULT YEAR IS THE SEASON IN PROGRESS. <== Aaron's call,
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
     * reader's one attempt on a 404. */
    const years = yearsFor(basin);
    if (year == null || !years.includes(year)) year = years[0] ?? null;

    render();
    loadSeasonNow();
  }

  /**
   * Ask for the season in progress again, and nothing else.
   *
   * ==> IT DOES NOT TOUCH THE SEASON ON SCREEN. <== The reader is looking at a
   * settled year that loaded perfectly; reloading it to recover a different
   * failure would blank a working roster to fix something else. All this can
   * change is whether one more option appears in the picker, so all it
   * re-renders is the board around the same year.
   */
  async function retryLive() {
    if (liveRetrying) return;
    liveRetrying = true;
    render();

    const res = await live.loadLiveIndex();
    liveRetrying = false;
    liveIndex = res?.status === 'ok' ? res : null;
    liveReason = res?.status === 'ok' ? '' : (res?.reason || '');
    render();
  }

  async function loadSeasonNow() {
    if (indexState !== 'ok' || basin == null || year == null) return;

    const token = ++loadToken;
    const wasLive = isLive(basin, year);
    seasonState = 'loading';
    entries = [];
    score = null;
    roster = null;
    unreadable = 0;
    provisional = wasLive;
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
    render();

    /* ==> THE BRANCH, AND IT IS THE ONLY ONE. <== Everything after this reads
     * one shape, so a rule about rosters or filters or selection cannot end up
     * written twice with a difference in it. */
    const res = wasLive
      ? await live.loadLiveSeason(liveIndex, basin, year)
      : await seasons.loadSeason(index, basin, year);
    if (token !== loadToken) return; /* the reader moved on */

    if (res.status !== 'ok') {
      seasonState = 'unavailable';
      seasonReason = res.reason || '';
      render();
      return;
    }

    entries = res.storms.map((storm) => ({ storm, facts: stormFacts(storm) }))
      .filter((e) => e.facts);
    score = seasonFacts(res.storms, { year, basin });
    unreadable = res.unreadable || 0;

    /* ==> THE FOURTH ARGUMENT IS THE GHOSTS-ARE-THIS-SEASON-ONLY RULE, AND IT
     * IS THE LIVE INDEX RATHER THAN THE CLOCK. <== `lib/season-names.js` is
     * clock-free by design so the suite can pin any year it likes. Step 5a
     * read `new Date().getUTCFullYear()` here because there was nothing better
     * to read; there is now. NHC seeds the new year's b-deck directory when it
     * seeds it, so on 1 January a reader's phone says 2027 and the season in
     * progress is still 2026 — and ghosts belong to the season, not to the
     * calendar. Null when there is no live season, which is fail-closed:
     * no ghosts rather than the wrong ones. */
    roster = rosterFor(
      basin, year,
      entries.map((e) => e.storm.name).filter(Boolean),
      liveYear()
    );
    seasonState = 'ok';
    render();
  }

  function announceWhere() {
    onWhere?.(
      indexState === 'ok' && basin && year
        ? { basin, year, label: `${year} · ${seasons.basinLabel(index, basin)}` }
        : null
    );
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
    return seasonRosterHtml({
      state: seasonState,
      reason: seasonReason,
      year,
      provisional,
      rows: entriesMatching(entries, filter),
      anyEntries: entries.length > 0,
      ticked,
      ghosts: filter === 'all' ? roster : null,
    });
  }

  function render() {
    if (!bodyEl) return;

    if (indexState === 'loading') {
      bodyEl.innerHTML = waitingHtml('Opening the archive…');
      return;
    }

    if (indexState === 'unavailable') {
      bodyEl.innerHTML = indexFailedHtml();
      return;
    }

    /* ==> EACH PIECE IS BUILT BEFORE THE TEMPLATE, NOT INSIDE IT. <== Partly
     * readability, and partly because `tools/css-orphan-check.mjs` scans
     * template literals for the classes this app emits — a method call sitting
     * inside one reads as a class name to it, and it reported `.basinsIn` and
     * `.basinLabel` as dead CSS. A checker that can be confused by formatting
     * is one whose next real finding gets waved through as noise. */
    const picker = pickerHtml({
      basins: seasons.basinsIn(index),
      labelFor: (b) => seasons.basinLabel(index, b),
      basin,
      years: yearsFor(basin),
      year,
      liveYear: liveYear(),
    });

    const scorecard = scoreHtml({
      score,
      roster,
      provisional,
      unreadable,
      stale: Boolean(provisional && liveIndex?.stale),
    });

    const filters = filtersHtml({ filters: filtersFor(provisional), filter });

    bodyEl.innerHTML = `
      ${picker}
      ${liveDownHtml({
        hasLive: basinHasLive(basin),
        retrying: liveRetrying,
        reason: liveReason,
      })}
      ${scorecard}
      ${filters}
      ${rosterHtml()}`;

    /* ==> THE FOCUS IS RE-APPLIED AFTER EVERY REBUILD, BECAUSE THE ROWS ARE
     * NEW NODES. <== `innerHTML` throws away the elements carrying the focus
     * class and puts fresh ones in their place. A filter change is the case
     * that shows it: the reader focuses Katrina, switches to Majors, and
     * without this her row comes back unmarked while the globe still has her
     * bright — the panel and the map disagreeing, which is the one thing this
     * view is careful about everywhere else. */
    paintFocus();
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
      const years = yearsFor(basin);
      if (!years.includes(year)) year = years[0] ?? null;
      loadSeasonNow();
      return;
    }

    const step = e.target.closest('[data-step]');
    if (step) {
      const years = yearsFor(basin);
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
      /* The globe is NOT touched. A filter narrows what the roster shows; it
       * does not un-choose a storm the reader deliberately ticked, and a
       * ticked storm vanishing off the globe because a filter moved would be
       * the panel and the map disagreeing about what is selected. */
      render();
      return;
    }

    if (e.target.closest('.seasons-retry')) {
      /* Checked FIRST, because it is the narrower case. This button sits on a
       * board whose settled index loaded fine and whose season is on screen,
       * so both branches below would have run and neither would have asked
       * for the thing that actually failed. */
      if (e.target.closest('[data-retry="live"]')) {
        retryLive();
        return;
      }
      if (indexState === 'unavailable') {
        indexState = 'loading';
        render();
        loadIndexOnce();
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

    const box = e.target.closest('[data-storm]');
    if (box) {
      const id = box.dataset.storm;
      if (box.checked) ticked.add(id); else ticked.delete(id);
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

    mount(el) {
      host = el;
      host.innerHTML = '<div class="drawer-body" id="seasons-board-body"></div>';
      bodyEl = host.querySelector('#seasons-board-body');
      bodyEl.addEventListener('click', onClick);
      bodyEl.addEventListener('change', onChange);
      bodyEl.addEventListener('keydown', onKeydown);
      render();
      loadIndexOnce();
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
