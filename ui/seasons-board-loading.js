/**
 * seasons-board-loading.js — what the season board has FETCHED. §57.18, §57.19.
 *
 * ==> IT IS THE FIFTH CUT OUT OF `ui/view-seasons-board.js`, AND IT IS THE ONE
 * THAT ROW NAMED FOUR PASSES AGO. <== SPEC.md §12. That file has grown on every
 * seasons pass; `lib/season-years.js` took the year rules, `seasons-board-
 * markup.js` took the markup twice and `seasons-board-paint.js` took the three
 * functions that change rows already on screen. This is the block that was
 * named next and deferred three times, each time for the same good reason: it
 * was never worth riding into a push that also changed behaviour, because then
 * a break could be either.
 *
 * ==> SO IT CARRIES NO BEHAVIOUR CHANGE AT ALL. <== Same awaits in the same
 * order, same `Promise.all`, same token check, same points at which the board
 * redraws. That is the whole point of the pass: if anything broke, it was the
 * move.
 *
 * ==> THE BOUNDARY: THIS FILE OWNS WHAT WAS FETCHED, THE VIEW OWNS WHAT IS
 * SELECTED. <== Aaron's line, 2026-08-25. Everything here describes something
 * that came off the wire — which years exist, which season is on screen,
 * whether it arrived, what it contained. `basin`, `year`, `ticked`, `focused`
 * and `filter` are the reader's choices and stay in the view. They meet in
 * exactly one place, the render that reads both.
 *
 * ==> AND THE DEPENDENCY RUNS ONE WAY. <== The view imports this; this imports
 * nothing of the view's. Where a load has to touch a choice — the default year
 * on first arrival, and dropping the ticks when the year changes — it calls a
 * hook the view handed in, in the same position in the sequence the single
 * function used to run it. A cycle here would mean the split is in the wrong
 * place (§12).
 *
 * ==> THERE ARE TWO ROADS TO A SEASON AND THIS FILE IS WHERE THEY MEET. <==
 * §57.30 step 5b. A settled year is one static file in this repo; the year
 * currently running is two KV-backed routes and a different parser
 * (`data/seasons-live.js`, §58). Both arrive as injected facades and both hand
 * back the same shape, so everything the board does with a season is one path
 * — but the branch itself is real and the reader is told which record they are
 * looking at, because §57.11 requires it. The paragraph moved here with the
 * branch on 2026-08-25; it used to head the board.
 *
 * ==> GHOSTS ARE THE CURRENT YEAR ONLY, AND THEIR ABSENCE IS SILENT. <==
 * Aaron's call, 2026-08-24, reaffirmed when the rosters stopped being typed by
 * hand. `lib/season-names-data.js` now carries six years ahead and accumulates
 * past ones, so the rule is enforced by the year handed to `rosterFor` below —
 * not by the data being thin. A settled year has no ghost rows and says
 * nothing about names remaining. That is the honest shape: for a finished
 * season the names it used already answer "how far did it get", and 2005
 * running past its list says it louder than blank rows would.
 *
 * Imports `lib/` only. Never `data/` — the fetch arrives as an injected facade,
 * the same shape the board takes it in (§12).
 */

import {
  isLiveSeason, liveYearOf, yearsFor as yearsForBasin,
} from '../lib/season-years.js';
import { stormFacts, seasonFacts } from '../lib/season-facts.js';
import { rosterFor } from '../lib/season-names.js';


/**
 * @param {object} opts
 * @param {object} opts.seasons  injected fetch facade for SETTLED years —
 *   `loadIndex`, `loadSeason`, `seasonsIn`. The board hands its own facade
 *   straight through rather than this file reaching for `data/`.
 * @param {object} opts.live  injected facade for the season in progress —
 *   `loadLiveIndex`, `loadLiveSeason`.
 * @param {() => void} opts.render  redraw the board. Called at exactly the
 *   points the one big function used to call it, and nowhere else.
 * @param {() => void} opts.onIndexReady
 *   the settled index has landed and the years are knowable. The VIEW picks
 *   the basin and the year here, because both are choices, and then asks for
 *   the season. Not done in this file: a default year is what the reader sees
 *   first, which is a selection question wearing a loading question's clothes.
 * @param {(provisional:boolean) => void} opts.onSeasonChanging
 *   a new season is about to be fetched and the old one is already gone from
 *   the screen. The view drops the ticks, clears the focus and falls the
 *   filter back if the new season does not have it.
 */
export function createSeasonsBoardLoading({
  seasons, live, render, onIndexReady, onSeasonChanging,
}) {
  /* --- state ---------------------------------------------------------------
   * Every one of these describes something that came off the wire. Nothing in
   * here is a choice the reader made.
   * ---------------------------------------------------------------------- */

  /** `loading` | `ok` | `unavailable` — the index, not a season. */
  let indexState = 'loading';
  let index = null;
  let indexReason = '';

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

  /** ==> THE ARCHIVE-WIDE RANKING TABLE, AND IT IS HELD HERE RATHER THAN IN
   *  THE PANEL BECAUSE THE PANEL IS NOT ITS ONLY FUTURE READER. <== §57.44.
   *  It arrives with the season (`data/seasons.js` puts it in the same
   *  `Promise.all` as the text) and `once()` holds the bytes for the session,
   *  so stepping through years re-reads a pointer rather than re-fetching 4 KB.
   *  `null` until a settled season has loaded, and `null` for the season in
   *  progress, which has no archive rank by design. */
  let rankings = null;

  /** ==> WHICH BASIN THE LOADED TABLE IS BEING READ AGAINST. <== Set beside
   *  `rankings` and never read from the view, because this file deliberately
   *  holds no basin state — the basin is the READER'S choice and lives in the
   *  view (see `loadSeason` below). This is a different fact: it is which
   *  basin the season that actually loaded belongs to, which is a property of
   *  the load rather than of the reader, and holding the two together is what
   *  stops a panel ranking an Atlantic storm against the Pacific in the beat
   *  after a basin change. */
  let rankingsBasin = null;
  let score = null;
  let roster = null;
  /** True while the chosen year is the one still running. */
  let provisional = false;
  /** Storms the live index listed that would not load. Zero on a settled
   *  year, which cannot have any — its storms come in one file. */
  let unreadable = 0;

  /** Bumped on every season load, so a slow fetch that lands after the reader
   *  has moved on cannot paint the wrong year over the right one. */
  let loadToken = 0;

  /* --- which years exist --------------------------------------------------
   * The rule itself is `lib/season-years.js` — the settled index answers for
   * every year NOAA has reviewed, the live one adds at most one on top, and
   * both the picker and the load path ask the same question so they can never
   * disagree about which years are choosable. Moved out when the board crossed
   * §12's ceiling for the third seasons pass running; the four functions there
   * read only the two indexes, which is what made them the cut that costs
   * nothing. These are the bindings that hand them this board's state — and
   * they live HERE now rather than in the view, because the two indexes they
   * read are both fetched things.
   * ---------------------------------------------------------------------- */

  const yearDeps = () => ({ seasonsIn: seasons.seasonsIn, index, liveIndex });

  const liveYear = () => liveYearOf(liveIndex);
  const yearsFor = (b) => yearsForBasin(yearDeps(), b);
  const isLive = (b, y) => isLiveSeason(yearDeps(), b, y);

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

    /* The years are knowable now. Which one the reader opens on is the view's
     * call, and so is asking for it. */
    onIndexReady();
  }

  /**
   * The index failed and the reader pressed the retry on the failure screen.
   *
   * Its own method rather than the view flipping `indexState` and calling
   * `loadIndexOnce` again, which is what it used to do — a view reaching in to
   * set a fetch state by hand is the boundary leaking, and it is the one place
   * in the old file where it did.
   */
  function retryIndex() {
    indexState = 'loading';
    render();
    loadIndexOnce();
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

  /**
   * Fetch one season and hold it.
   *
   * The basin and the year are ARGUMENTS rather than state here, because they
   * are the reader's choices and they live in the view. This file is told
   * which season to go and get; it never decides.
   */
  async function loadSeason(basin, year) {
    if (indexState !== 'ok' || basin == null || year == null) return;

    const token = ++loadToken;
    const wasLive = isLive(basin, year);
    seasonState = 'loading';
    entries = [];
    rankings = null;
    rankingsBasin = null;
    score = null;
    roster = null;
    unreadable = 0;
    provisional = wasLive;
    /* Everything the reader had chosen about the season that is leaving —
     * the ticks, the focus and the filter — goes here, in the view. It runs
     * BEFORE the fetch and not after, because the globe has to empty the
     * moment the year changes: leaving 2005's tracks up while 1935 loads
     * would put a year on the bar that the globe is not showing. */
    onSeasonChanging(provisional);
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
    /* ==> THE LIVE BRANCH RETURNS NO TABLE AND THAT IS THE CORRECT OUTCOME,
     * NOT A GAP. <== `live.loadLiveSeason` reads operational b-decks, whose
     * figures NOAA has not reviewed and will move. `rankStorm` refuses a
     * provisional storm anyway, so this is the belt beside that brace: no
     * table means the section cannot be built even if that rule were ever
     * loosened. */
    rankings = res.rankings || null;
    /* ==> NOT `rankings ? basin : null`, WHICH IS WHAT THIS SAID AND WHICH
     * GUARDED NOTHING. <== A mutation run survived deleting the condition,
     * and the reason is that `rankStorm` bails on a missing table before it
     * ever looks at the basin. A guard with no observable effect is a guard
     * the next reader has to work out is dead, so it is deleted rather than
     * tested (§12, retire cleanly). Both slots are cleared together at the top
     * of this function, which is where the staleness actually matters. */
    rankingsBasin = basin;
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

  return {
    loadIndexOnce,
    retryIndex,
    retryLive,
    loadSeason,

    /* The year rules, bound to the two indexes this file holds. */
    liveYear,
    yearsFor,
    isLive,

    /** The settled index itself, for the picker's basin list and labels — the
     *  only piece of it the view reads directly, and it reads it through the
     *  `seasons` facade's own helpers. */
    index: () => index,
    indexState: () => indexState,

    /** ==> THE LIVE ARRAY, NOT A COPY. <== The panel and the roster both walk
     *  it on every repaint and every tap; cloning a season each time to defend
     *  against a mutation nobody makes would cost more than it protects. It is
     *  replaced wholesale on every load, never edited in place. */
    entries: () => entries,

    /** The ranking table with the basin it must be read against, in one shape,
     *  because reading them apart is how a panel comes to rank an Atlantic
     *  storm against the Pacific after a basin change. */
    archive: () => ({ table: rankings, basin: rankingsBasin }),

    /** Everything the render reads, in one bundle. One call per redraw rather
     *  than a dozen getters threaded through the template. */
    state: () => ({
      indexState,
      liveRetrying,
      liveReason,
      liveStale: Boolean(liveIndex?.stale),
      seasonState,
      seasonReason,
      score,
      roster,
      provisional,
      unreadable,
    }),
  };
}
