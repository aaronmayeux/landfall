/**
 * view-season-detail.js — one finished storm, in full. §57.15, §57.22,
 * §57.22a, §57.22b, §57.30 step 7.
 *
 * ==> THIS IS THE STEP WHERE TWO SESSIONS OF PARSER WORK BECOMES A SCREEN.
 * <== `lib/season-facts.js` has computed peak, lifespan, time at strength,
 * ACE, every landfall, fastest intensification and how a storm ended since
 * step 2, and nothing has ever displayed a single one of them.
 *
 * ==> IT IS A SIBLING OF THE BOARD, NOT A CHILD OF THE LIVE DETAIL PANEL. <==
 * §57.22 says "same shell, same section pattern, different sections inside" and
 * that is exactly what this does: it reuses `.detail-section` and
 * `.detail-vitals` from the live panel's stylesheet and shares none of its
 * code. `ui/view-storm-detail.js` is 1,869 lines of live-feed machinery —
 * advisories, gusts, alerts, flood, surge, ships, a stepper — and every one of
 * those is a §57.25 rule 1 deletion here. Reusing it would mean threading a
 * "this is history" flag through all of it.
 *
 * ==> THE MARKUP LIVES NEXT DOOR AND DID FROM DAY ONE. <==
 * `ui/season-detail-markup.js`. `ui/view-seasons-board.js` has crossed §12's
 * ceiling on four seasons passes running and been cut every time along exactly
 * this seam; doing it up front costs nothing and skips the next rediscovery.
 *
 * ==> ONE ASYNC THING, AND IT HAS THREE STATES LIKE EVERYTHING ELSE. <== The
 * storm's facts are already in memory — the board parsed the season to draw
 * the roster — so this panel paints instantly and completely. The single
 * exception is NOAA's written report, which is a lookup against a file
 * (`data/season-reports.js`), and §5 applies to it in full: *has*, *none*, and
 * *could not check* say three different things, because saying "no report was
 * written" about a storm whose report exists is the all-clear-during-an-outage
 * bug at the size of one link.
 *
 * ==> THREE THINGS IN THE FIRST VERSION OF THIS FILE WERE WRONG AND NONE OF
 * THEM WAS EVER SEEN, BECAUSE STEP 7 WAS REVERTED BEFORE ANYBODY OPENED THE
 * PANEL. <== They are called out at their sites below rather than only here,
 * but the shape is worth naming once: all three were the panel agreeing with
 * itself while disagreeing with something outside it — the drawer's view
 * contract, the keyboard, and the globe.
 *
 * Imports config/, lib/ and its own markup. No map — the globe belongs to
 * `main.js` and this panel never reaches for it; it asks its caller instead.
 */

import { SEASONS } from '../config/constants.js';
import { rankInSeason } from '../lib/season-facts.js';
import { rankStorm } from '../lib/rankings.js';
import { stormDisplayName } from '../lib/season-names.js';
import { storyClauses } from '../lib/season-story.js';
import {
  changeHtml, headHtml, landfallsHtml, lifeHtml, movementHtml, noStormHtml,
  peakHtml, reportHtml, storyHtml, windFieldHtml,
} from './season-detail-markup.js';
/* ==> THE TWO RANK SECTIONS LIVE NEXT DOOR. <== SPEC.md §12. They are the only
 * renderers on this panel that take a comparison rather than a fact, and they
 * were the 126 lines that put `season-detail-markup.js` over the ceiling. */
import { archiveRankHtml, seasonRankHtml } from './season-rank-markup.js';

/**
 * @param {object} opts
 * @param {() => Array<{storm:object, facts:object}>} opts.entries
 *   the season the board currently holds. A FUNCTION rather than an array,
 *   because the board reloads on a year change and a captured array would
 *   leave this panel describing last year's storm under this year's heading.
 * @param {(id:string) => Promise<object>} opts.loadReport
 *   `data/season-reports.js`'s `reportFor`, injected so a suite can drive
 *   every one of its three answers without a network.
 * @param {() => ({table:object|null, basin:string|null})} opts.archive
 *   the archive-wide ranking table and which basin the board is showing.
 *   ==> A FUNCTION FOR THE SAME REASON `entries` IS. <== §57.44. The board
 *   reloads on a basin change, and a table captured when this panel first
 *   painted would go on ranking an Atlantic storm against the Pacific.
 * @param {() => string} opts.units  the reader's measurement preference.
 * @param {(id:string) => void} [opts.onOpen]
 *   the panel opened on this storm. The board draws it and focuses it, so
 *   opening a storm from anywhere leaves the map agreeing with the panel —
 *   §57.21a's rule that the roster and the globe must never disagree,
 *   extended one screen further.
 */
export function createSeasonDetailView({ entries, archive, loadReport, units, onOpen }) {
  let host = null;
  let bodyEl = null;

  /** Which storm this panel is about. Held rather than read from the drawer,
   *  because a re-render after the report arrives has to draw the same storm
   *  the reader opened, not whatever is top of the list. */
  let stormId = null;

  /** The report answer: `null` before the lookup starts, then whatever
   *  `data/season-reports.js` said. Its own slot rather than a flag, so the
   *  three states in §5 stay three states all the way to the markup. */
  let report = null;

  /** ==> WHICH SECTIONS THE READER HAS FOLDED, FOR THIS STORM ONLY. <== Held
   *  in memory and cleared on every `onEnter`, so opening a second storm gives
   *  all of it again. See the note above `section()` for why it is not
   *  persisted the way the live panel's is.
   *
   *  ==> IT MUST SURVIVE A RE-RENDER EVEN THOUGH IT DOES NOT SURVIVE A STORM.
   *  <== This panel re-renders when NOAA's report arrives, which is a beat
   *  after it paints. Without this the reader's folds would spring open under
   *  them a second after they made them, on every storm that has a report. */
  const collapsed = Object.create(null);

  /** ==> A TOKEN, BECAUSE THE READER CAN OPEN A SECOND STORM WHILE THE FIRST
   *  LOOKUP IS IN THE AIR. <== Without it the slower answer wins and Katrina's
   *  report link lands on Rita's panel. Compared on arrival rather than
   *  cancelled, because a fetch that is already gone costs nothing to ignore
   *  and cancelling it would not make the second one faster. */
  let asked = 0;

  function entryFor(id) {
    return entries().find((e) => e.storm.id === id) || null;
  }

  function entry() {
    return entryFor(stormId);
  }

  /** Every storm in the season the board is holding, as facts. The denominator
   *  behind "3rd strongest of 31" — read fresh on every render for the same
   *  reason `entries` is a function rather than an array. */
  function seasonFacts() {
    return entries().map((e) => e.facts).filter(Boolean);
  }

  /** The archive-wide table and the basin it is read against, both read fresh
   *  on every render. Two small readers rather than one destructure so a
   *  caller that supplies neither costs nothing. */
  function archiveTable() {
    return archive?.()?.table || null;
  }

  function archiveBasin() {
    return archive?.()?.basin || null;
  }

  /* --- sections ---------------------------------------------------------
   * ==> EVERY SECTION FOLDS, THE SAME WAY THE LIVE PANEL'S DO. <== Aaron's
   * call, 2026-08-29. The head is a real `<button>`, which is what buys the
   * 44px target, the hover, the focus ring and Enter/Space for free — the
   * whole recipe already exists in `ui/panels.css` under
   * `.detail-section-head`, and this panel had been rendering a `<div>` into
   * it and getting only the type styling. **No CSS changed.**
   *
   * ==> BUT THE STATE IS NOT PERSISTED, AND THAT PART OF THE OLD RULE STANDS.
   * <== The live panel writes a reader's folds to storage because a live storm
   * is one thing they come back to over days. An archive storm is opened, read
   * and left; the reader who taps 1893's second storm has never seen this
   * panel before and should get all of it. So the folds live for as long as
   * one storm is open and no longer — nothing to persist means nothing to get
   * stale, and nothing carries a fold from Katrina onto a storm from 1851 that
   * has half as many sections.
   *
   * ==> `id` IS AN ARGUMENT RATHER THAN DERIVED FROM THE TITLE. <== Same
   * reasoning the live panel gives for its icon: a slug computed from the
   * heading would change the moment a heading is reworded, and the reader's
   * open section would silently spring shut on deploy. The id is a stable
   * name; the title is copy.
   * -------------------------------------------------------------------- */

  function section(id, title, innerHtml) {
    if (!innerHtml) return '';
    const shut = !!collapsed[id];
    return `
      <section class="detail-section" data-section="${id}" data-collapsed="${shut}">
        <button class="detail-section-head" type="button" aria-expanded="${!shut}">
          <h2><span>${title}</span></h2>
          <span class="detail-chevron" aria-hidden="true"></span>
        </button>
        <div class="detail-section-body">${innerHtml}</div>
      </section>`;
  }

  function render() {
    if (!bodyEl) return;

    const e = entry();
    if (!e) {
      bodyEl.innerHTML = noStormHtml();
      return;
    }

    const { storm, facts } = e;
    const system = units();

    /* ==> THE PARAGRAPH IS BUILT HERE RATHER THAN CACHED WITH THE FACTS,
     * BECAUSE IT DEPENDS ON THE READER'S UNITS. <== `stormFacts` is stable
     * forever and is computed once when the board loads a season; this reads
     * mph or km/h and would go stale the moment somebody changed the setting.
     * It is a few string joins over one storm, so rebuilding it per render is
     * free — and `points` and `places` both hang off the storm the board is
     * already holding, so nothing is fetched to draw it. */
    const story = storyClauses(facts, {
      name: stormDisplayName(storm),
      points: storm.points,
      places: storm.places ?? null,
      system,
    });

    bodyEl.innerHTML = `
      ${headHtml({ storm, facts, provisional: !!facts.provisional })}
      ${storyHtml(story)}
      ${/* ==> THE RANK IS COMPUTED HERE RATHER THAN CACHED WITH THE FACTS,
          * BECAUSE IT IS A FACT ABOUT THE SEASON AND THE SEASON IS WHAT THE
          * BOARD RELOADS. <== `entries()` is a function for exactly this
          * reason: a rank captured when the panel first painted would go on
          * describing last year's roster under this year's heading. It is one
          * pass over at most 31 storms, so rebuilding it per render is free. */
    section('rank-season', 'In its season', seasonRankHtml(rankInSeason(facts, seasonFacts())))}
      ${/* ==> IT SITS DIRECTLY UNDER `In its season`, NARROW COMPARISON THEN
          * WIDE. <== §57.44. The two rank sections answer the same question at
          * two sizes, and a reader who has just read "3rd strongest of 28"
          * reads "11th strongest in the Atlantic" as the next sentence rather
          * than as a contradiction. Separated by anything else they read as
          * two unrelated facts about ranking.
          *
          * ==> AND IT DRAWS NOTHING AT ALL WHEN THE TABLE DID NOT ARRIVE. <==
          * `section()` returns '' for empty markup, so a 404 on a 4 KB
          * companion costs this section and nothing else. That is deliberate
          * rather than a §5 silence: a rank is a comparison the app offers,
          * not a fact about the storm, and every figure it would have ranked
          * is already on screen above with its own units. There is no wrong
          * impression left behind by its absence. */
    section('rank-archive', 'Where it ranks', archiveRankHtml(
      rankStorm(facts, archiveTable(), archiveBasin()),
      { year: storm.year },
    ))}
      ${section('peak', 'Strongest', peakHtml(facts, system))}
      ${section('life', 'Its life', lifeHtml(facts))}
      ${section('landfalls', 'Landfalls', landfallsHtml(facts, system, {
    markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
    markerHoleTo: SEASONS.landfallMarkerHoleTo,
    places: storm.places ?? null,
  }))}
      ${section('change', 'How it changed', changeHtml(facts, system, {
    windowHours: SEASONS.intensificationWindowHours,
  }))}
      ${section('movement', 'How it moved', movementHtml(facts, system, {
    floorKt: SEASONS.trackSpeedFloorKt,
    maxLegHours: SEASONS.trackSpeedMaxLegHours,
  }))}
      ${section('windfield', 'Wind footprint', windFieldHtml(facts, {
    firstSeason: SEASONS.windFieldFirstSeason,
  }))}
      ${section('report', "NOAA's report", reportHtml(report, storm.year, SEASONS.reportsFirstSeason))}`;
  }

  async function lookUpReport() {
    const mine = ++asked;
    report = { state: 'loading' };
    render();
    let answer;
    try {
      answer = await loadReport(stormId);
    } catch (err) {
      /* The facade is supposed to answer rather than throw, and this is the
       * belt: a panel that showed nothing at all in its report section would
       * be the silence §5 forbids, whichever layer failed. */
      answer = { state: 'unknown', reason: String(err?.message || err) };
    }
    if (mine !== asked) return; /* the reader moved on */
    report = answer;
    render();
  }

  function onClick(ev) {
    if (ev.target.closest('[data-retry="report"]')) {
      lookUpReport();
      return;
    }

    /* ==> DELEGATED, RATHER THAN A LISTENER PER HEAD REWIRED AFTER EVERY
     * RENDER. <== `render()` replaces `innerHTML` wholesale and runs again
     * when NOAA's report arrives, so per-head listeners would have to be
     * reattached each time and the failure mode is silent: the heads stop
     * responding a beat after the panel paints, on exactly the storms that
     * have a report. One listener on the body outlives every repaint.
     *
     * ==> THE DOM IS UPDATED HERE AND `collapsed` IS THE RECORD. <== Not a
     * re-render: folding a section must not rebuild eight others, and a
     * re-render would also lose the reader's scroll position halfway down a
     * long panel. `render()` reads `collapsed` when it next runs for its own
     * reasons, so the two cannot drift. */
    const head = ev.target.closest('.detail-section-head');
    if (!head) return;
    const sec = head.closest('.detail-section');
    const id = sec?.dataset.section;
    if (!id) return;
    const shut = sec.dataset.collapsed !== 'true';
    sec.dataset.collapsed = String(shut);
    head.setAttribute('aria-expanded', String(!shut));
    collapsed[id] = shut;
  }

  return {
    id: 'season-detail',

    /**
     * ==> `title` IS A STRING AND `titleFor` IS THE FUNCTION, AND GETTING
     * THAT BACKWARDS IS BUG ONE. <== The first version of this file exported
     * `title(arg)` as a function. `ui/drawer.js` reads
     * `def.titleFor ? def.titleFor(arg) : def.title`, then appends the result
     * only when it is a string or a node — so a function fell through both
     * arms and the panel would have opened with an EMPTY header. It rendered
     * without throwing and every other view looked fine, which is why nothing
     * caught it.
     *
     * The string is the fallback for a panel opened on nothing; `titleFor`
     * names the storm, because a storm's own name is the only honest heading
     * and "Storm detail" would be furniture.
     */
    title: 'Storm',

    titleFor(arg) {
      const e = entryFor(arg);
      return e ? stormDisplayName(e.storm) : 'Storm';
    },

    /** The label on a Back button pointing AT this panel. No side effects,
     *  unlike `titleFor` — the drawer builds this for a view that is not on
     *  screen, so it must not reach into anything. Nothing pushes on top of
     *  this panel today; it costs one line to stay correct if something ever
     *  does. */
    backLabelFor(arg) {
      const e = entryFor(arg);
      return e ? stormDisplayName(e.storm) : 'Storm';
    },

    mount(el) {
      host = el;
      host.innerHTML = '<div class="drawer-body" id="season-detail-body"></div>';
      bodyEl = host.querySelector('#season-detail-body');
      bodyEl.addEventListener('click', onClick);
    },

    /**
     * Open on a storm.
     *
     * ==> THE REPORT IS LOOKED UP ON EVERY ENTRY, NOT ONCE PER PANEL. <== The
     * facade holds the index for the session, so a second storm costs a map
     * lookup rather than a request — but a FAILED lookup falls out of that
     * cache on purpose, so opening another storm after a bad moment on a train
     * is a real retry rather than a replay of the failure.
     *
     * ==> `onOpen` FIRES ON EVERY ENTRY INCLUDING A RETURN BY Back, AND THAT
     * IS DELIBERATE. <== It is what keeps the globe showing the storm this
     * panel is about. A reader who backs out to the roster, unticks the storm
     * and comes forward again would otherwise be reading Katrina's figures
     * over a globe with no Katrina on it.
     */
    onEnter(arg) {
      stormId = arg || null;
      report = null;
      /* ==> EVERY STORM OPENS FULLY EXPANDED. <== See `section()`: an archive
       * storm is opened, read and left, so a fold made on Katrina must not
       * arrive pre-applied on a storm from 1851 that has half as many sections
       * and no reason for any of them to be shut. */
      for (const k of Object.keys(collapsed)) delete collapsed[k];
      render();
      if (stormId) {
        onOpen?.(stormId);
        lookUpReport();
      }
    },

    /**
     * First stop is the panel's own heading.
     *
     * ==> IT CARRIES `tabindex="-1"` FOR THIS, AND ITS ABSENCE WAS BUG TWO.
     * <== The drawer does `v.def.focus?.() || backBtn` and then calls
     * `.focus()` on whatever comes back. An `<h1>` is truthy, so the fallback
     * never ran — and `.focus()` on a heading with no tabindex is a silent
     * no-op. A reader who pressed the chevron with the keyboard would have had
     * focus left on a button that the drawer had just hidden, which is §13's
     * "focus must not be left on a control inside a panel that is now
     * off-screen" with nothing to say it had happened.
     *
     * A heading rather than the Back button because this screen is something
     * to read: a screen reader lands on the storm's name and reads down, and
     * Back is the drawer's own next tab stop either way.
     */
    focus() {
      return bodyEl?.querySelector('.season-detail-name');
    },
  };
}
