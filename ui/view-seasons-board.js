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
 * CHOSE — the basin, the year and the filter — plus the render where the two
 * halves meet.
 *
 * ==> NOR THE TICKS AND THE OPEN STORM, SINCE THE SIXTH CUT. <==
 * `ui/seasons-board-selection.js` holds `ticked`, `focused`, and every rule
 * about which of them the globe is allowed to hear. Both cuts were made on the
 * same test and it is the only one worth applying to this file: **the state
 * goes with the code, or it is a relocation rather than a cut.** Handing a
 * getter over a value you kept is how a knot ends up in two files instead of
 * one.
 *
 * Imports config/, lib/ and its own siblings. Never data/ or map/ — the fetch
 * and the globe both arrive as injected facades (§12).
 */

import { stormDisplayName } from '../lib/season-names.js';
import { createSeasonsBoardLoading } from './seasons-board-loading.js';
import { entriesMatching, filtersFor } from './seasons-board-markup.js';
import { paintTick } from './seasons-board-paint.js';
import { createSeasonsBoardSelection } from './seasons-board-selection.js';
import { createSeasonsBoardRender } from './seasons-board-render.js';
import { NEAR_HOME_FILTER, radiusFromValue } from './seasons-near-home.js';
import { rangeFor } from '../lib/near-home-words.js';
import { createYearStepper } from './year-stepper.js';


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
 * @param {() => (Set<string>|null)} [opts.liveRunningIds]
 *   which storms the LIVE app is still drawing in colour, as lowercased ATCF
 *   ids — or null when the live feed has never answered. §57.21c. Injected as
 *   a FUNCTION rather than a set, because it is a fact about right now and the
 *   board asks at paint time; injected at all rather than imported, because
 *   `ui/` never reaches into `data/` (§12) and the live storm list is
 *   main.js's.
 */
export function createSeasonsBoardView({
  seasons, live, onSelection, onFocus, onWhere, onOpenStorm, liveRunningIds,
  home = null, system = null,
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

  /* ==> HOME AND UNITS ARRIVE AS FUNCTIONS, NOT VALUES, AND THAT IS NOT
   * CEREMONY. <== A drawer view is mounted once and kept for the life of the
   * app (`ui/drawer.js`). A reader can move house from the dashboard or switch
   * to kilometres in Settings while this board is sitting behind them, and a
   * value captured at construction would leave the roster measuring against an
   * address they no longer live at, silently, with nothing on screen wrong
   * enough to notice. Asked at render time, both are always current.
   *
   * ==> `ui/` STILL NEVER IMPORTS `data/`. <== §12. Both getters are handed in
   * from `seasons/index.js`, the same shape the two fetch facades take. */
  const homeNow = () => (typeof home === 'function' ? home() : home) || null;
  const systemNow = () => (typeof system === 'function' ? system() : system) || null;

  /** The radius slider's value, in whatever units the reader's setting shows —
   *  miles or kilometres, never nautical miles. §57.19.
   *
   *  ==> IT IS A READER CHOICE, WHICH IS WHY IT LIVES HERE AND NOT IN THE
   *  LOADING FILE. <== That is the seam the fifth cut was made on: what was
   *  fetched goes there, what was chosen stays here. This is chosen.
   *
   *  ==> AND IT SURVIVES A YEAR CHANGE ON PURPOSE. <== A reader comparing 2005
   *  against 1935 at 50 miles is asking one question of two years. Resetting
   *  the slider on every year change would make them re-ask it each time, and
   *  the filter itself already travels across a year change wherever the new
   *  season offers it (`onSeasonChanging`). */
  let radius = rangeFor(systemNow()).default;


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

  /**
   * The house and the circle, as one bundle, or null.
   *
   * ==> IT IS COMPUTED IN ONE PLACE AND HANDED TO SIX CALLERS. <== Every
   * `entriesMatching` in this file needs it, and so does the roster. Six copies
   * of "read home, read units, convert the slider" is six places the archive's
   * roster can end up disagreeing with the globe about which storms are near,
   * which is the panel-and-map disagreement this whole view is careful about
   * everywhere else.
   *
   * ==> `null` WHEN THE FILTER IS NOT NEAR HOME, DELIBERATELY. <== The other
   * three filters have no use for it, and passing a live measurement they
   * ignore would mean the geometry running on every filter change for nothing.
   */
  function nearNow() {
    if (filter !== NEAR_HOME_FILTER) return null;
    const h = homeNow();
    if (!Number.isFinite(h?.lon) || !Number.isFinite(h?.lat)) return null;
    const r = radiusFromValue(radius, systemNow());
    return r ? { home: h, nm: r.nm } : null;
  }

  /** The circle in the reader's own words, for the empty-roster sentence. It
   *  reads the CLAMPED value rather than `radius`, so the words can never name
   *  a number the filter did not actually use. */
  function radiusWordsNow() {
    const sys = systemNow();
    const r = radiusFromValue(radius, sys);
    return r ? `${r.radius} ${rangeFor(sys).unit}` : '';
  }

  /* --- the selected half ---------------------------------------------------
   * `ui/seasons-board-selection.js` holds what is ticked, what is open, and
   * every rule about which of the two the globe is allowed to hear —
   * INCLUDING the state itself. That is the sixth cut out of this file and it
   * was made on the same test as the fifth: the state went with the code, so
   * there is no piece of it left here to be handed back through a getter.
   *
   * Everything it needs arrives as a getter rather than a value, because this
   * view is mounted once and kept: the season, the filter, the house and the
   * body element all change underneath it.
   * ---------------------------------------------------------------------- */

  const selection = createSeasonsBoardSelection({
    entries: () => loading.entries(),
    provisional: () => loading.state().provisional,
    bodyEl: () => bodyEl,
    liveRunningIds,
    filter: () => filter,
    near: () => nearNow(),
    onSelection,
    onFocus,
    announce: () => announceWhere(),
  });

  /* ==> THE SIX NAMES BELOW ARE ALIASES, AND THEY EXIST SO THE CUT CARRIED NO
   * BEHAVIOUR. <== Twenty-odd call sites through this file read these, and
   * rewriting every one of them to say `selection.` would have meant proving
   * twenty diffs changed nothing rather than one. The move is the change; the
   * spelling is not part of it. `ticked` is the live Set rather than a copy,
   * so `.has`, `.add`, `.delete`, `.clear` and `.size` all still reach the one
   * that decides what the globe draws.
   *
   * ==> `focused` IS THE ONE THAT COULD NOT BE ALIASED. <== It is a primitive,
   * so a local binding would freeze at whatever the highlight was when this
   * ran. The five places that read it ask `focusedId()` instead, and those
   * five lines are the entire behavioural surface of this cut. */
  const { ticked, activeIds, selectedEntries, pushSelection, setFocus } = selection;
  const focusedId = selection.focusedId;
  const paintFocusNow = selection.paintFocus;
  const paintCheckAllNow = selection.paintCheckAll;


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
    if (!filtersFor(provisional, homeNow()).some((f) => f.id === filter)) filter = 'all';
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
    const open = focusedId() ? entries.find((e) => e.storm.id === focusedId()) : null;
    onWhere?.({
      basin,
      year,
      label: `${year} · ${seasons.basinLabel(loading.index(), basin)}`,
      shown: selectedEntries().length,
      openName: open ? stormDisplayName(open.storm) : '',
    });
  }

  /* --- the rendered half ---------------------------------------------------
   * `ui/seasons-board-render.js` assembles every piece of markup this board
   * shows and writes it into the body. It is the seventh cut out of this file
   * and it is a DIFFERENT KIND from the sixth: nothing about it holds state,
   * so a wide bag of getters is safe here in a way it would not have been for
   * the ticks. Reads have nothing to drift out of step with.
   * ---------------------------------------------------------------------- */

  const painter = createSeasonsBoardRender({
    bodyEl: () => bodyEl,
    loading,
    basin: () => basin,
    year: () => year,
    filter: () => filter,
    radius: () => radius,
    home: homeNow,
    system: systemNow,
    near: () => nearNow(),
    radiusWords: () => radiusWordsNow(),
    activeIds,
    ticked,
    paintFocus: paintFocusNow,
    paintCheckAll: paintCheckAllNow,
  });

  /* --- the pinned year row ------------------------------------------------
   * ==> THE YEAR PICKER IS A PINNED ROW UNDER THE HEADER, NOT A ROW IN THE
   * SCROLLER. §57.39a. <== `ui/year-stepper.js` carries the whole account of
   * why, and it is Karina's panel: the header names the basin, this names the
   * year and changes it. Two things about it belong HERE rather than there:
   *
   *   IT IS BUILT ONCE, AT CONSTRUCTION, and attached in `mount`. It has to
   *   outlive every render — that is the entire reason its two buttons survive
   *   their own activation — so it genuinely cannot be part of the body's
   *   `innerHTML` string.
   *
   *   IT READS THIS VIEW'S OWN `year`, NOT THE NAVIGATION ARGUMENT. The two
   *   agree on every ordinary path — the wall passes the year through as the
   *   arg — but a `+` press changes `year` HERE and only reaches the drawer
   *   when `onWhere` re-pushes. Reading the argument would leave the row a
   *   beat behind its own button on the one control a reader uses repeatedly.
   * ---------------------------------------------------------------------- */

  const yearStep = createYearStepper({
    years: () => loading.yearsFor(basin),
    year: () => year,
    onStep: (next) => {
      year = next;
      loadSeasonNow();
    },
  });

  /* Aliases, for the reason given beside the selection module's: the call
   * sites through this file are the same lines they were, so the move is the
   * only change in the diff.
   *
   * ==> `render` IS NOW BOTH HALVES OF THE SCREEN. <== The body and the
   * heading are drawn by two different owners and there is exactly one moment
   * they must agree — a heading reading 2005 over 2006's roster is the
   * panel-and-globe disagreement §57.21a is careful about everywhere else,
   * arriving through the header. Wrapping here rather than teaching forty call
   * sites about a second render keeps that impossible to forget. */
  const { rosterHtml } = painter;

  /* --- the heading catching up ---------------------------------------------
   * ==> THE HEADER SAID `Past storms` UNTIL THE READER STEPPED A YEAR. <==
   * Aaron on glass, 2026-08-28, on the first build of §57.39a. The header is
   * the DRAWER's, drawn once when the view is entered — and on entry the index
   * has not landed, so there is no basin yet to name and `titleFor` correctly
   * falls back. Nothing then redrew it: `onIndexReady` renders the BODY, and
   * the only thing that had ever refreshed the header was `onWhere` re-pushing
   * the view on a year change. So the fallback sat there, looking like the
   * answer, until the reader happened to press `+`.
   *
   * ==> IT IS ASKED FOR ONLY WHEN THE ANSWER CHANGES, WHICH IS WHAT MAKES IT
   * SAFE TO PUT ON THE RENDER PATH. <== `render` runs on every poll, every
   * filter change and every tick of the roster, and rebuilding the drawer's
   * whole header that often would throw away the Back button and the X on a
   * surface the reader may have focused. The basin changes at most once a
   * visit, so this fires once and then never again.
   * ---------------------------------------------------------------------- */

  /** The drawer's `refreshChrome`, injected by `seasons/index.js`. The two live
   *  drawers take the same hook for the same reason — a view cannot redraw
   *  furniture it does not own. Null until wired, and calling it is optional
   *  everywhere: a board mounted by a harness with no drawer must still work. */
  let requestChrome = null;

  /** What the header is showing right now, as far as this view knows. Compared
   *  rather than recomputed-and-hoped: `titleFor` is the only thing that
   *  actually writes it, so it is also the only thing that may claim it. */
  let headingShown = null;

  const headingNow = () => {
    const label = basin ? seasons.basinLabel(loading.index(), basin) : null;
    return label || 'Past storms';
  };

  const render = () => {
    painter.render();
    yearStep.render();
    if (headingNow() !== headingShown) requestChrome?.();
  };

  /* --- input --------------------------------------------------------------
   * ONE DELEGATED LISTENER PER EVENT TYPE, on the scroller, so a wholesale
   * re-render cannot leave a handler bound to a discarded node. Every control
   * below is a real <button>, <select> or <input>, so tap, click and keyboard
   * are the same path and none of this branches on device (§13).
   * ---------------------------------------------------------------------- */

  /* ==> THERE IS NO `[data-step]` BRANCH HERE ANY MORE, AND THERE CANNOT BE.
   * <== §57.39a. The year picker moved into the drawer's header, which is a
   * SIBLING of this body rather than a child of it, so this listener would
   * never see the press. The step lives on the stepper's own element instead —
   * see `yearStep` above. */
  function onClick(e) {
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
    setFocus(focusedId() === id ? null : id);
  }

  /**
   * The reader is dragging the radius. §57.19.
   *
   * ==> `input`, NOT `change`, BECAUSE A SLIDER THAT ONLY ANSWERS ON RELEASE
   * IS NOT A SLIDER. <== The whole reason to drag rather than type a number is
   * to watch the answer move, and this is the one control in the app where the
   * answer is a list rather than a shape on the globe.
   *
   * ==> IT PATCHES, AND WHAT IT PATCHES IS EVERYTHING EXCEPT THE SLIDER. <==
   * `render()` replaces the body, which would replace the range input in the
   * middle of a gesture — the drag would end on a detached node and the thumb
   * would stick. So the value text is written in place and the roster's own
   * wrapper has its contents swapped, which leaves the control untouched and
   * costs one list rebuild per step of the slider rather than per pixel.
   *
   * ==> AND THE FIRST STEP EMPTIES THE GLOBE, ONCE. <== Same rule as a filter
   * change, and Aaron's call of 2026-08-25 behind it: a globe carrying storms
   * the list in front of you does not contain is the panel and the map
   * disagreeing. Narrowing from 200 miles to 50 would otherwise leave the wider
   * set drawn with no rows to point at. Guarded on the set being non-empty, so
   * it is one push at the start of a drag rather than one per step.
   */
  function onInput(e) {
    const slider = e.target.closest('[data-radius]');
    if (!slider) return;

    const sys = systemNow();
    const next = radiusFromValue(slider.value, sys);
    if (!next || next.radius === radius) return;
    radius = next.radius;

    const words = `${radius} ${rangeFor(sys).unit}`;
    const readout = bodyEl?.querySelector('.seasons-radius .slider-value');
    if (readout) readout.textContent = words;
    /* The visible figure and the announced one come off the same string, so a
     * screen-reader user and a sighted one can never be told different numbers.
     * A bare "120" would be a value with no unit on it. */
    slider.setAttribute('aria-valuetext', words);

    if (ticked.size) {
      ticked.clear();
      setFocus(null);
      pushSelection();
    }

    repaintRoster();
  }

  /** Swap the roster's contents and put back the two states `innerHTML` cannot
   *  carry. The same pair `render()` restores, for the same reason: these are
   *  fresh nodes and the focus class and the master box's third state both live
   *  on elements that have just been thrown away. */
  function repaintRoster() {
    const slot = bodyEl?.querySelector('.seasons-roster-slot');
    if (!slot) return;
    slot.innerHTML = rosterHtml();
    paintFocusNow();
    paintCheckAllNow();
  }

  function onChange(e) {
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
      const shown = entriesMatching(loading.entries(), filter, nearNow())
        .filter((x) => !active.has(x.storm.id));
      const full = shown.length > 0 && shown.every((x) => ticked.has(x.storm.id));
      for (const x of shown) {
        if (full) ticked.delete(x.storm.id); else ticked.add(x.storm.id);
      }
      if (focusedId() && !ticked.has(focusedId())) setFocus(null);
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
      if (!box.checked && focusedId() === id) setFocus(null);
    }
  }

  return {
    id: 'seasons-board',

    /** ==> RUNG 3'S HEADING IS THE YEAR. §57.39. <== `2005` is the most useful
     *  four characters that could sit there: the reader tapped a year to get
     *  here, and repeating a generic noun would waste the one line that could
     *  confirm which year they landed on. The drawer passes the year through as
     *  the navigation argument, so the heading is right on the frame the view
     *  opens rather than one render later.
     *
     *  The fallback is the feature's own on-screen name (§57.16a), and it is
     *  reachable: a restore that lost the year would otherwise put an empty
     *  heading on the drawer, which reads as a broken screen rather than as a
     *  missing number. */
    title: 'Past storms',

    /** ==> RUNG 3'S HEADING IS THE BASIN, AND THE YEAR IS THE PINNED ROW UNDER
     *  IT. §57.39a. <== Aaron's call, 2026-08-28, pointing at the live storm
     *  drawer: `KARINA` in the header, `‹ 1 of 7 ›` on its own line beneath.
     *  The archive now has the same two lines — `Atlantic`, then `− 2005 +`.
     *
     *  ==> IT USED TO BE THE YEAR, AND THAT IS WHAT BROKE. <== §57.39's
     *  reasoning was sound on its own terms — four digits confirming where the
     *  reader landed beat a generic noun — but the picker below ALSO drew the
     *  year, so the sheet printed it twice one line apart at the same size. Of
     *  the two, the header is the one that gives way: the year has to be
     *  beside the buttons that change it, and the basin is a fact this drawer
     *  otherwise never states anywhere.
     *
     *  The fallback is the feature's own on-screen name (§57.16a) and it is
     *  reachable: the index has not landed on the first frame, and `basinLabel`
     *  cannot name a basin the index has not described yet. An empty heading
     *  reads as a broken screen rather than as a wait. */
    titleFor: () => {
      /* ==> THIS IS THE ONE PLACE THE HEADING IS WRITTEN, SO IT IS THE ONE
       * PLACE THAT RECORDS WHAT IT SAYS. <== `render` compares against this to
       * decide whether the drawer needs asking to redraw its header at all.
       * Setting it anywhere else would be a second opinion about a string only
       * this function produces, and the two would drift the first time the
       * fallback was reached. */
      headingShown = headingNow();
      return headingShown;
    },

    /** The drawer's own `refreshChrome`, handed in by `seasons/index.js`. Same
     *  hook and same reason as the home dashboard's and the storm panel's: the
     *  header belongs to `ui/drawer.js`, so a view whose title can change while
     *  it is already open has to be able to ask for it back. */
    setChromeRefresh(fn) {
      requestChrome = fn;
    },

    /** ==> THE BUTTON POINTING BACK HERE NAMES THE YEAR, NOT THE BASIN. <==
     *  `ui/drawer.js` asks for this before it asks for a title, so a view can
     *  label itself differently on somebody else's Back button — and here it
     *  should. What sits on top of this board is a storm's panel, reached from
     *  a row's chevron, and `‹ 2005` says which roster you are returning to
     *  where `‹ Atlantic` says only which ocean.
     *
     *  Off the navigation ARGUMENT rather than off `year`: this labels a button
     *  pointing at a view that is not on screen, and the argument is what that
     *  entry in the stack was opened with. */
    backLabelFor: (arg) => (Number.isFinite(arg) ? String(arg) : 'Past storms'),

    /* ==> THE HEADER'S X IS A MINIMISE CHEVRON HERE, AND NOWHERE ELSE. §57.21b
     * item 8. <== Closing this board does not leave the archive — the globe
     * stays sepia and the bar stays on screen as the way back in. An X says
     * "done with this", which is not what the button does. The flag is read by
     * `ui/drawer.js`; every other view leaves it unset and keeps its X. */

    mount(el) {
      host = el;
      host.innerHTML = '<div class="drawer-body" id="seasons-board-body"></div>';
      bodyEl = host.querySelector('#seasons-board-body');
      /* ==> PINNED ABOVE THE SCROLLER, NOT INSIDE IT. §57.39a. <== A SIBLING of
       * the body rather than its first child, which is the same position
       * `ui/storm-stepper.js` takes in the two live drawers. `.drawer-view` is
       * a flex column and the body is the only thing that flexes, so anything
       * prepended here holds still while the roster scrolls under it. That is
       * the point: this is the one control on the screen a reader presses
       * repeatedly, and a picker that scrolled away would have to be hunted
       * for after every step — the same complaint §57.21b item 1 fixed when
       * the sheet itself was resizing. */
      host.prepend(yearStep.el);
      bodyEl.addEventListener('click', onClick);
      bodyEl.addEventListener('change', onChange);
      bodyEl.addEventListener('input', onInput);
      bodyEl.addEventListener('keydown', onKeydown);
      render();
      loading.loadIndexOnce();
    },

    onEnter() {
      /* ==> A UNITS CHANGE WHILE THE BOARD WAS CLOSED HAS TO MOVE THE SLIDER.
       * <== The value is the reader's number in THEIR units, and Settings can
       * flip those between visits. 500 is a real value on the mile slider and
       * off the end of the kilometre one, so a stale number would put the thumb
       * at the maximum while the roster filtered a circle 60% the size — the
       * control and the list disagreeing, silently. `radiusFromValue` clamps
       * into whichever range is now in play, so this is a re-seat rather than a
       * reset: 200 stays 200 in both systems, and only a value the new range
       * cannot express moves at all. */
      const r = radiusFromValue(radius, systemNow());
      if (r) radius = r.radius;

      /* Re-announce on every entry. The reader may have closed the board and
       * come back, and the bar must still name the year the globe is showing. */
      announceWhere();
      render();
    },

    /**
     * Which door this visit came through. §57.16, §57.19.
     *
     * ==> IT SETS THE FILTER AND NOTHING ELSE. <== Called on every entry, from
     * `seasons/index.js`, before the index has arrived — so there is no season
     * yet to check the filter against and none is checked. `onSeasonChanging`
     * runs the moment there is one and drops anything the season does not
     * offer, which is the same guard a deep-linked year goes through.
     *
     * ==> AND IT ALWAYS SETS SOMETHING, INCLUDING BACK TO `all`. <== The board
     * outlives the session. A reader who filtered to Near home, left, and came
     * back off the storms list would otherwise find the archive still narrowed
     * to their house with no memory of having asked for it — a screen that
     * remembers a choice from a visit that has ended.
     */
    openFrom(door) {
      filter = door === 'home' ? NEAR_HOME_FILTER : 'all';
    },

    /** ==> FIRST STOP IS THE YEAR STEPPER, PINNED ABOVE THE SCROLLER. <==
     *  §57.36 moved choosing a year to the wall and §57.39a moved what was
     *  left of the picker out of the body onto its own pinned line, so this no
     *  longer queries the body — the control is not in it.
     *
     *  ==> THE BUTTON JUST PRESSED COMES FIRST. <== A `+` press re-pushes this
     *  view, and the drawer asks this question on the way back in. Handing
     *  back the button under the reader's thumb makes walking the record by
     *  keyboard one press per year; anything else dumps focus at the start of
     *  the header on every step. `firstEnabled` is the answer for every other
     *  way in — a row on the wall, a deep link — and it skips a disabled end,
     *  because 1851 has no `−` and focus on a disabled control is focus
     *  nowhere (§13). */
    focus() {
      return yearStep.takeFocus() || yearStep.firstEnabled();
    },

    /**
     * Which basin this board is showing, chosen on the wall.
     *
     * ==> THE BOARD NO LONGER PICKS A BASIN AND NO LONGER OFFERS THE SWITCH.
     * <== §57.36. The wall owns it, because changing basin there happens while
     * no year is open — whereas changing it here would mean deciding what
     * becomes of a year the other basin does not hold, and the Pacific record
     * starts in 1949. Ignored when the index has not named that basin, so a
     * stale argument cannot empty the roster.
     */
    setBasin(b) {
      if (!b || b === basin || !loading.yearsFor(b).length) return;
      basin = b;
      /* ==> AND IT LOADS, FOR THE REASON `setSeason` DOES. <== The two are
       * called together when a year is opened off the wall, and the year is
       * often the SAME number in both basins — 2005 exists in each. Leaving
       * the load to `setSeason` means it declines as a no-op and the reader
       * gets the Atlantic's 2005 under a Pacific heading: the same four
       * digits, the wrong storms, nothing on screen saying so.
       *
       * Hold the year across the change when the new basin has it. The
       * Pacific record opens in 1949, so 1900 has no Pacific half, and falling
       * back to that basin's newest year is better than an empty roster. */
      const years = loading.yearsFor(basin);
      if (!years.includes(year)) year = years[0] ?? null;
      loadSeasonNow();
    },

    /**
     * Open on a particular year — a `?season=` link, or a row on the wall.
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
      if (!Number.isFinite(y) || y === year) return;
      year = y;
      /* ==> AND IT LOADS, WHICH IT DID NOT NEED TO WHEN IT WAS ONLY EVER
       * CALLED BEFORE MOUNT. <== It had one caller — a `?season=` link, read
       * before the index had arrived — so holding the number was enough and
       * `loadIndexOnce` did the fetching. The wall calls it on an ALREADY
       * MOUNTED board, once per year row tapped, and without this the reader
       * would land on a heading saying 2005 over last year's roster: the
       * panel-and-globe disagreement §57.21a is careful about everywhere else,
       * arriving through the front door.
       *
       * ==> BEFORE THE INDEX LANDS THIS STILL ONLY HOLDS THE NUMBER. <==
       * `yearsFor` answers with nothing until then, so the guard below
       * declines and `loadIndexOnce` honours the held year exactly as it
       * always has — including dropping it when the archive does not hold that
       * season. Only the index knows which years are real. */
      if (loading.yearsFor(basin).includes(y)) loadSeasonNow();
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
