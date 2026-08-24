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
 * WHAT IS NOT HERE, ON PURPOSE: landfall marks, name labels along the tracks,
 * focus-and-dim and the wind field are step 6; the detail panel is step 7; the
 * near-home slider is step 9 and is why §57.19's fourth filter is absent from
 * the three below rather than present and dead.
 *
 * Imports config/, lib/ and its own siblings. Never data/ or map/ — the fetch
 * and the globe both arrive as injected facades (§12).
 */

import { SEASONS } from '../config/constants.js';
import { stormFacts, seasonFacts } from '../lib/season-facts.js';
import { rosterFor } from '../lib/season-names.js';
import {
  emptyRosterHtml, esc, filtersFor, filtersHtml, ghostsHtml, indexFailedHtml,
  pickerHtml, rowHtml, scoreHtml, seasonFailedHtml, waitingHtml,
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
 * @param {(where:{basin:string,year:number,label:string}|null) => void} opts.onWhere
 *   the bar's sentence. Called whenever the year or basin settles.
 */
export function createSeasonsBoardView({ seasons, live, onSelection, onWhere }) {
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

  /** Bumped on every season load, so a slow fetch that lands after the reader
   *  has moved on cannot paint the wrong year over the right one. */
  let loadToken = 0;

  /* --- which years exist --------------------------------------------------
   * The settled index answers for every year NOAA has reviewed; the live one
   * adds at most one more on top. Both are asked here rather than in the
   * markup, so the picker and the load path can never disagree about which
   * years are choosable.
   * ---------------------------------------------------------------------- */

  /** The season in progress, or null. Read off the b-deck FILENAMES by the
   *  route, never off the reader's clock (§58.1). */
  function liveYear() {
    return liveIndex?.year ?? null;
  }

  /** Does this basin have a live half at all? `SEASONS.liveBasins` answers,
   *  and a basin missing from it has none — the honest state for the rest of
   *  the world until step 13. */
  function basinHasLive(b) {
    return Boolean(SEASONS.liveBasins[b]);
  }

  /** Every year this basin offers, newest first. The live season sits at the
   *  top when there is one, and only when the settled record has not already
   *  caught up to it — in the spring both roads briefly know the same year and
   *  the reviewed one wins, because it is the better record of the two. */
  function yearsFor(b) {
    const settled = seasons.seasonsIn(index, b);
    const ly = liveYear();
    if (ly == null || !basinHasLive(b) || settled.includes(ly)) return settled;
    return [ly, ...settled];
  }

  /** Is this the year still running? The one place that question is answered,
   *  because it decides the road, the filters, the stamp and the ghosts. */
  function isLive(b, y) {
    return liveYear() != null && Number(y) === liveYear() && basinHasLive(b)
      && !seasons.seasonsIn(index, b).includes(Number(y));
  }

  /* --- selection ---------------------------------------------------------- */

  function selectedEntries() {
    return entries.filter((e) => ticked.has(e.storm.id));
  }

  function pushSelection() {
    onSelection?.(selectedEntries());
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

  function visibleEntries() {
    if (filter === 'majors') {
      return entries.filter((e) => Number.isFinite(e.facts.peakWindKt)
        && e.facts.peakWindKt >= SEASONS.majorKt);
    }
    if (filter === 'landfalls') return entries.filter((e) => e.facts.landfalls.length > 0);
    return entries;
  }

  /**
   * The current season could not be reached.
   *
   * ==> IT IS SAID ON EVERY SETTLED YEAR, NOT ONLY WHERE 2026 WOULD HAVE SAT.
   * <== There is no row to hang it on: the year is simply absent from the
   * picker, and an absent option explains nothing. A reader who came to see
   * what is happening now needs to know the road is down rather than conclude
   * the archive stops at last year.
   */
  function liveDownHtml() {
    if (!basinHasLive(basin)) return '';
    if (liveRetrying) return waitingHtml('Looking for the season still running…');
    if (!liveReason) return '';
    /* ==> AND IT GETS A BUTTON, BECAUSE THIS ONE CAN ACTUALLY SUCCEED. <== §5
     * asks every error state for a recovery action, and the distinction the
     * rest of this view draws is whether pressing it could ever work: a year
     * the archive does not hold gets no Retry, a road that was down for a
     * moment does. `data/seasons-live.js` drops a failed fetch out of its own
     * map, so this is a real second attempt rather than a replay. */
    return `<p class="seasons-note seasons-bad">The season still running could not
      be reached, so it is not in the list above. The settled years are all here.</p>
      <button class="seasons-retry" type="button" data-retry="live">Try again</button>`;
  }

  function rosterHtml() {
    if (seasonState === 'loading') {
      return waitingHtml(provisional ? 'Reading this season…' : 'Reading the record…');
    }

    if (seasonState === 'unavailable') {
      return seasonFailedHtml({ year, reason: seasonReason });
    }

    const rows = visibleEntries();

    /* ==> GHOSTS ARE A WHOLE-SEASON FACT AND A NARROWED LIST IS NOT THE PLACE
     * FOR THEM. <== Step 5a's rule, kept deliberately across the markup split:
     * "eighteen names are still unused" is about the season, and printing it
     * under a Majors list would put an unfiltered claim at the foot of a
     * filtered one. `null` rather than a flag — the markup is told what to
     * draw, never what the state is (§57.18a). */
    const ghosts = filter === 'all' ? roster : null;

    if (!rows.length) {
      return `
        ${emptyRosterHtml({ year, filtered: entries.length > 0, provisional })}
        ${ghostsHtml(ghosts)}`;
    }

    const list = rows
      .map((e) => rowHtml({ storm: e.storm, facts: e.facts, on: ticked.has(e.storm.id) }))
      .join('');

    return `
      <ul class="seasons-roster">${list}</ul>
      ${ghostsHtml(ghosts)}`;
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
      ${liveDownHtml()}
      ${scorecard}
      ${filters}
      ${rosterHtml()}`;
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

    /** Leaving the archive entirely — drop the globe's tracks and forget the
     *  ticks, so a second visit does not open with a stale selection. */
    reset() {
      ticked.clear();
      pushSelection();
    },
  };
}
