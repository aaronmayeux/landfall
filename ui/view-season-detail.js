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
import { stormDisplayName } from '../lib/season-names.js';
import {
  changeHtml, headHtml, landfallsHtml, lifeHtml, noStormHtml, peakHtml,
  reportHtml, windFieldHtml,
} from './season-detail-markup.js';

/**
 * @param {object} opts
 * @param {() => Array<{storm:object, facts:object}>} opts.entries
 *   the season the board currently holds. A FUNCTION rather than an array,
 *   because the board reloads on a year change and a captured array would
 *   leave this panel describing last year's storm under this year's heading.
 * @param {(id:string) => Promise<object>} opts.loadReport
 *   `data/season-reports.js`'s `reportFor`, injected so a suite can drive
 *   every one of its three answers without a network.
 * @param {() => string} opts.units  the reader's measurement preference.
 * @param {(id:string) => void} [opts.onOpen]
 *   the panel opened on this storm. The board draws it and focuses it, so
 *   opening a storm from anywhere leaves the map agreeing with the panel —
 *   §57.21a's rule that the roster and the globe must never disagree,
 *   extended one screen further.
 */
export function createSeasonDetailView({ entries, loadReport, units, onOpen }) {
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

  /* --- sections ---------------------------------------------------------
   * ==> COLLAPSE STATE IS DELIBERATELY NOT KEPT. <== The live panel remembers
   * which sections a reader folded, because a live storm is one thing they
   * come back to over days. An archive storm is opened, read and left; the
   * reader who taps 1893's second storm has never seen this panel before and
   * should get all of it. Nothing to persist means nothing to get stale.
   * -------------------------------------------------------------------- */

  function section(title, innerHtml) {
    if (!innerHtml) return '';
    return `
      <section class="detail-section" data-collapsed="false">
        <div class="detail-section-head">
          <h2><span>${title}</span></h2>
        </div>
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

    bodyEl.innerHTML = `
      ${headHtml({ storm, facts, provisional: !!facts.provisional })}
      ${section('Strongest', peakHtml(facts, system))}
      ${section('Its life', lifeHtml(facts))}
      ${section('Landfalls', landfallsHtml(facts, system, {
    markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
    markerHoleTo: SEASONS.landfallMarkerHoleTo,
  }))}
      ${section('How it changed', changeHtml(facts, system, {
    windowHours: SEASONS.intensificationWindowHours,
  }))}
      ${section('Wind footprint', windFieldHtml(facts, {
    firstSeason: SEASONS.windFieldFirstSeason,
  }))}
      ${section("NOAA's report", reportHtml(report, storm.year, SEASONS.reportsFirstSeason))}`;
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
    }
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
