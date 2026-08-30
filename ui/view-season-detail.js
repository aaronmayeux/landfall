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
import { seasonCompany } from '../lib/season-company.js';
import { rankStorm } from '../lib/rankings.js';
import { isCollapsed, readSections, writeSections } from '../lib/section-state.js';
import { iconSvg } from './section-icon.js';
import { stormDisplayName } from '../lib/season-names.js';
import { storyClauses } from '../lib/season-story.js';
/* The retired-names join. Under `data/` because `lib/` may not import that
 * directory (§12), so the pure story module takes the answer as an argument. */
import { retirementFor } from '../data/retired-lookup.js';
import {
  changeHtml, headHtml, landfallsHtml, lifeHtml, noStormHtml,
  peakHtml, reportHtml, storyHtml,
} from './season-detail-markup.js';
/* ==> `Where it went` LIVES NEXT DOOR. <== SPEC.md §12, §57.57.
 * `ui/season-detail-markup.js` was 711 lines against the ~700 ceiling and
 * §57.54k required the cut before any of step 3's restructuring landed there.
 * The seam is the subject §57.54f already drew: everything left in the old
 * file is about how strong a storm was, and these two are about the ground it
 * covered. */
import { movementHtml, windFieldHtml } from './season-track-markup.js';
/* ==> THE TWO RANK SECTIONS LIVE NEXT DOOR. <== SPEC.md §12. They are the only
 * renderers on this panel that take a comparison rather than a fact, and they
 * were the 126 lines that put `season-detail-markup.js` over the ceiling. */
import { archiveRankHtml, seasonRankHtml, seasonCompanyHtml } from './season-rank-markup.js';
/* ==> §57.48. THREE SENTENCES THAT JOIN THREE SECTIONS THAT ALREADY EXIST.
 * <== They are appended to the markup those sections are built from rather
 * than given headings of their own, which is Aaron's call: the panel is at
 * nine sections and a tenth was not worth three facts. A section is where a
 * sentence appears; it does not have to be where the sentence is written, and
 * `ui/season-detail-markup.js` was 19 lines under §12's ceiling. */
import { comebackHtml, seasonWindowHtml, originHtml, loopHtml } from './season-shape-markup.js';

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
/**
 * ==> THE TWO RANK SECTIONS OPEN AND THE REST FOLD. <== Aaron's call,
 * 2026-08-29. The panel has nine sections and a reader stepping through the
 * archive is looking for where a storm SITS before they want its arithmetic,
 * so the comparison is what the panel opens on. Everything else is one tap
 * away and its heading is still on screen, which is the difference between
 * folded and absent.
 *
 * ==> IT IS THE OPEN LIST RATHER THAN THE CLOSED ONE, AND THAT IS DELIBERATE.
 * <== A new section added to this panel then defaults to FOLDED, which is the
 * safe direction: an unfamiliar section arriving already open pushes eight
 * known ones off a phone screen, and the reader who was looking for `Landfalls`
 * has to hunt for it. A closed list would have made the new section open by
 * omission, which is the failure mode nobody notices until it is on glass.
 */
const OPEN_BY_DEFAULT = new Set(['rank-season', 'rank-archive']);

/**
 * ==> THIS PANEL'S FOLDS SHARE ONE STORAGE RECORD WITH THE LIVE PANEL'S, SO
 * THEY ARE NAMESPACED. <== `lib/section-state.js` owns a single key, which is
 * right — the parsing rules and the private-mode failure behaviour should have
 * one owner. But the record is flat, so two panels putting a bare `wind` in it
 * would silently fold each other's sections, and the bug would look like the
 * app forgetting a choice rather than like a collision.
 *
 * No id collides today (the live panel uses `home`, `vitals`, `wind`, `ww`,
 * `advisory`, `environment`, `flooding`, `people` and `rainfall`) and that is
 * exactly the state in which a prefix is cheap. Added later, it would also
 * have to migrate whatever readers had already written.
 */
const storeKey = (id) => `season:${id}`;

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

  /** ==> WHICH SECTIONS THE READER HAS FOLDED, PERSISTED THE WAY THE LIVE
   *  PANEL'S ARE. <== Aaron's call, 2026-08-29, reversing the decision
   *  recorded here on the same day. The old reasoning was that an archive
   *  storm is opened, read and left, so nothing was worth keeping; the
   *  reasoning that beats it is that **a reader stepping through 1851 to 2025
   *  is doing the same thing over and over**, and re-folding six sections on
   *  every storm is the tax that reasoning missed.
   *
   *  ==> AND IT MUST SURVIVE A RE-RENDER AS WELL AS A RELOAD. <== This panel
   *  redraws when NOAA's report arrives a beat after it paints, so a fold
   *  living only in the DOM would spring open under the reader a second after
   *  they made it, on the 47% of storms that have a report. Reading the record
   *  in `section()` covers both, because a redraw and a fresh load take the
   *  same road. */
  let collapsed = readSections();

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
   *
   * ==> AND SO IS `icon`, FOR THE LIVE PANEL'S OWN REASON. <== A map from id
   * to icon would be a second list of this panel's sections that a new section
   * could be added to only half of, and the failure is that the new section
   * silently gets no icon and looks like a rendering bug. Passed at the call
   * site it sits in the same line as the heading it belongs to and is
   * impossible to forget.
   *
   * ==> AN UNKNOWN ICON NAME COSTS THE ICON AND NOTHING ELSE. <== `iconSvg`
   * answers '' rather than throwing. A heading with no glyph is a cosmetic
   * loss; a heading that takes the drawer down with it is not.
   * -------------------------------------------------------------------- */

  function section(id, title, icon, innerHtml) {
    if (!innerHtml) return '';
    const shut = isCollapsed(collapsed, storeKey(id), !OPEN_BY_DEFAULT.has(id));
    return `
      <section class="detail-section" data-section="${id}" data-collapsed="${shut}">
        <button class="detail-section-head" type="button" aria-expanded="${!shut}">
          <h2>${iconSvg(icon)}<span>${title}</span></h2>
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
      /* ==> KEYED ON `storm.basin`, WHICH IS EXACT PER STORM, RATHER THAN ON
       * THE WALL'S TWO BUCKETS. <== §57.52. The wall has `atlantic` and
       * `epacific` and the second of those holds CPHC storms as well —
       * `CP012006` IOKE is in the east Pacific file — so the wall's Pacific
       * predicate has to union two lists. A panel is looking at ONE storm and
       * the parser already knows whether it is `AL`, `EP` or `CP`, so it asks
       * the precise question. A name retired in one basin is often still in
       * service in another, and this is the surface where that matters. */
      retirement: retirementFor(stormDisplayName(storm), storm.year, storm.basin),
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
    section('rank-season', 'In its season', 'calendar',
      seasonRankHtml(rankInSeason(facts, seasonFacts()))
      /* ==> §57.50. IT SITS BETWEEN THE RANKS AND THE CALENDAR BECAUSE IT IS
       * THE THIRD THING THIS SECTION SAYS ABOUT THE OTHER STORMS. <== The two
       * rank rows answer where it came among them and this answers how many
       * of them were on the ocean at once, so the three read as one thought.
       * The season window below is about the calendar and keeps the last
       * place §57.48 gave it.
       *
       * ==> AND IT DELIBERATELY DOES NOT LEAD WITH "IT WAS NOT ALONE". <==
       * That was the first wording and it lands directly under
       * `seasonRankHtml`'s *"It was the only major hurricane of its season"*
       * on the storms that get both. Two adjacent sentences opening `only`
       * and `not alone` read as an argument even though they are about
       * different things. Leading with the count removes the collision
       * without weakening the sentence. */
      + seasonCompanyHtml(seasonCompany(facts, seasonFacts()))
      /* ==> §57.48. IT GOES LAST, UNDER THE RANKS, BECAUSE IT IS ABOUT THE
       * CALENDAR RATHER THAN ABOUT THE OTHER STORMS. <== The two rank rows
       * answer "where did it come among them"; this answers "was it even
       * supposed to be there". Above them it would be the first thing read
       * about a section headed `In its season` and would push the comparison
       * the heading promises down the screen. */
      + seasonWindowHtml(facts.seasonWindow))}
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
    section('rank-archive', 'Where it ranks', 'podium', archiveRankHtml(
      /* ==> `system` IS AN ARGUMENT HERE FOR THE SAME REASON IT IS ONE
       * EVERYWHERE ELSE ON THIS PANEL. <== §57.46. The distance rank ships as
       * two ladders, one rounded to miles and one to kilometres, because a
       * rung has to be the number the row above it prints. Handing the
       * preference down is what keeps the rank and the figure agreeing when a
       * reader switches units. */
      rankStorm(facts, archiveTable(), archiveBasin(), system),
      /* §57.56 — the distribution bar's end labels are in the reader's units
       * too, for the same reason the rung is. */
      { year: storm.year, system },
    ))}
      ${section('peak', 'Strongest', 'gauge', peakHtml(facts, system))}
      ${section('life', 'Its life', 'clock', lifeHtml(facts))}
      ${section('landfalls', 'Landfalls', 'pin', landfallsHtml(facts, system, {
    markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
    markerHoleTo: SEASONS.landfallMarkerHoleTo,
    places: storm.places ?? null,
  }))}
      ${section('change', 'How it changed', 'trend', changeHtml(facts, system, {
    windowHours: SEASONS.intensificationWindowHours,
    /* ==> §57.48. THE COMEBACK IS HANDED IN RATHER THAN APPENDED, BECAUSE THIS
     * SECTION IS IN CHRONOLOGICAL ORDER AND APPENDING WOULD BREAK IT. <== The
     * section runs strengthening, then the weakening before the coast, then
     * how the storm finished. A comeback happened before it finished, so a
     * sentence stuck on the end would sit under `Dissipated. The record simply
     * stops.` and describe a hurricane coming back afterwards. The other two
     * §57.48 sentences ARE appended, because neither joins an ordered list. */
    comebackHtml: comebackHtml(facts.comeback),
  }))}
      ${section('movement', 'How it moved', 'track', movementHtml(facts, system, {
    floorKt: SEASONS.trackSpeedFloorKt,
    maxLegHours: SEASONS.trackSpeedMaxLegHours,
    /* ==> §57.45. `system` two arguments up is what puts the distance in the
     * reader's own miles or kilometres; these two only decide WHICH figures
     * get printed, never their units. */
    distanceFloorNm: SEASONS.trackDistanceFloorNm,
    cycloneShareMax: SEASONS.trackDistanceCycloneShareMax,
  })
    /* ==> §57.48, §57.49. BOTH SENTENCES ARE APPENDED, AND THAT IS SAFE HERE
     * IN A WAY IT WAS NOT IN `How it changed`. <== That section is a
     * chronology; this one is a set of facts about the track with no order to
     * break.
     *
     * ==> THE LOOP GOES ABOVE THE BIRTHPLACE BECAUSE IT IS THE RARE ONE.
     * <== Aaron's call, 2026-08-29. The origin sentence fires on 1,993 of the
     * 2,004 Atlantic storms, so it reads as background; the loop fires on 120
     * of 3,266 and is the reason a reader stops. A rare fact printed under a
     * near-universal one is a rare fact nobody sees. */
    + loopHtml(facts.loop, system)
    + originHtml(facts.origin))}
      ${section('windfield', 'Wind footprint', 'wind', windFieldHtml(facts, {
    firstSeason: SEASONS.windFieldFirstSeason,
  }))}
      ${section('report', "NOAA's report", 'doc', reportHtml(report, storm.year, SEASONS.reportsFirstSeason))}`;
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
    collapsed[storeKey(id)] = shut;
    writeSections(collapsed);
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
