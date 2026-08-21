/**
 * people-in-path.js (ui) — the Population affected section of the storm drawer.
 * SPEC-UI.md "People in the path" for the count; §54 for the past/ahead split
 * and for why the on-screen heading is neither of those names.
 *
 * A SELF-CONTAINED CONTROLLER, for the reason `ui/env-health.js` is one:
 * `ui/view-storm-detail.js` is past §12's file ceiling and the table entry says
 * in as many words that the next detail pass of any size does the split first.
 * §54 was that pass. The view file keeps only the seams — one section row, one
 * ensure call, one repaint — and the state machine, the wording and the
 * arithmetic live here.
 *
 * ==> THE SWATH, NOT THE CONE, AND THAT IS THE WHOLE POINT OF THE SECTION.
 * <== The cone is where the CENTRE is likely to go. Counting people inside it
 * would produce a number that sounds like an impact figure and is not one, and
 * would teach the single most common misreading of a hurricane forecast to
 * everybody who saw it. `POPULATION.pathSlot` names the swath and the reasoning
 * lives beside it in constants.
 *
 * ==> AND THE NUMBER IS AN UNDERCOUNT, WHICH THE SECTION SAYS OUT LOUD. <== It
 * counts residents of named towns of 1,000 or more. Rural coast is invisible to
 * it, and rural coast is where a great many people in the Gulf, the Bay of
 * Bengal and the Philippines actually live. A "≈", the word estimate, and the
 * floor stated in plain English are not hedging — they are the difference
 * between a useful figure and a false one.
 *
 * ==> AND IT IS TWO NUMBERS, NOT ONE, BECAUSE THE SWATH IS THE STORM'S WHOLE
 * LIFE (§54). <== NHC's envelope covers where the storm has been as well as
 * where it is going, in one polygon with no mark on it saying where the past
 * ends. Counted whole under a heading reading "in the path" — which is what
 * this section wore at the time — it reads as a warning about wind that has
 * already fallen. Seen on glass 2026-08-21:
 * Hurricane Lala, advisory 34A, showed 1.3M people in 121 towns — every town in
 * Hawaii, every one of them behind the storm by days, and nobody at all in
 * front of it. The storm was 900 miles out to sea heading north into empty
 * water.
 *
 * So the count is split against `windAhead`: everyone the storm has yet to
 * reach, and everyone it has already been through. The heading and the sentence
 * both follow whichever of those is the live fact.
 *
 * ==> THE SPLIT IS NHC-ONLY, AND THAT IS CORRECT RATHER THAN A GAP. <== GDACS
 * publishes no past wind field at all (`data/gdacs-geometry.js` sets `windPast`
 * to `none`), so its swath already starts at the current position and is
 * already entirely "ahead". Those storms keep the single-figure wording, and it
 * means the same thing it always did.
 *
 * Imports: config/, lib/, never data/ — the town list arrives injected (§12).
 */

import { peopleInFeatures, peopleInPhases, formatPeople } from '../lib/population-count.js';
import { windThresholdFromProps } from '../lib/wind.js';
import { POPULATION } from '../config/constants.js';
import { DOTS } from './loading-dots.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const PEOPLE_SECTION = 'people';

/**
 * @param {{ loadTowns: (done:()=>void)=>void,
 *           townsOrNull: ()=>number[]|null,
 *           populationState: ()=>string }} deps  injected by the view
 */
export function createPeopleInPath({ loadTowns, townsOrNull, populationState }) {
  /** { forId, state:'idle'|'loading'|'ok'|'none'|'unavailable',
   *    split:boolean, total:{people,towns}, ahead:{people,towns},
   *    past:{people,towns} }
   *
   *  `split` false means the forward shape was not available and only `total`
   *  is meaningful — never that everything is ahead. */
  let people = { forId: null, state: 'idle' };

  /** Only the 34 kt ring. The swath nests three thresholds by construction
   *  (§ wind-field), so counting every feature would count everyone inside the
   *  64 kt core three times over — the exact double-count PPLX causes in the
   *  source data, arriving by a different road.
   *
   *  A storm too weak to publish a 34 kt band still publishes something; the
   *  fallback is the whole set rather than reporting nobody. Over-counting a
   *  weak storm's overlap is a smaller lie than "0 people" about a live
   *  system. */
  function only34(features) {
    const outer = features.filter(
      (f) => windThresholdFromProps(f.properties) === POPULATION.pathThresholdKt
    );
    return outer.length ? outer : features;
  }

  /**
   * Compute the headcount, fetching the town list if this is the first ask.
   *
   * BOUND TO THE STORM ID, NOT COMPARED AGAINST STATE ANOTHER LIFECYCLE METHOD
   * WRITES. The view assigns `storm` on its way past during `enter()`, before
   * `onEnter` runs, so any check shaped like `if (s.id !== storm?.id)` is dead
   * by construction — the advisory carried exactly that bug to glass. `forId`
   * is written only here and only read to decide whether a result is stale.
   *
   * @param {object} storm  the selected storm, or null
   * @param {boolean} ghost has the storm left the feed
   * @param {{state:string, bundle:object}} geo the geometry record
   * @param {()=>void} repaint
   */
  function ensure(storm, ghost, geo, repaint) {
    if (!storm || ghost) return;
    const forId = storm.id;
    if (people.forId === forId && people.state !== 'idle') return;

    const flat = townsOrNull();
    if (!flat) {
      people = { forId, state: populationState() === 'unavailable' ? 'unavailable' : 'loading' };
      repaint();
      loadTowns(() => {
        /* Someone may have moved to another storm during the download. */
        if (!storm || storm.id !== forId) return;
        people = { forId: null, state: 'idle' };
        ensure(storm, ghost, geo, repaint);
      });
      return;
    }

    const slot = geo.state === 'ok' ? geo.bundle?.layers?.[POPULATION.pathSlot] : null;
    if (geo.state === 'loading') {
      people = { forId, state: 'loading' };
      repaint();
      return;
    }
    if (geo.state === 'error' || slot?.status === 'unavailable') {
      people = { forId, state: 'unavailable' };
      repaint();
      return;
    }
    if (!slot || slot.status === 'none' || !slot.fc?.features?.length) {
      people = { forId, state: 'none' };
      repaint();
      return;
    }

    const rings = only34(slot.fc.features);

    /* ==> ONLY `ok` UNLOCKS THE SPLIT. <== `none` and `unavailable` both mean
     * the forward shape could not be built, and treating either as "nothing
     * ahead" would put an all-clear on screen that no data supports. Without it
     * the section counts the whole envelope and says so in the words it has
     * always used, which is wrong in the same small way it was before rather
     * than newly wrong in a large way. */
    const aheadSlot = geo.bundle?.layers?.[POPULATION.aheadSlot];
    const aheadRings = aheadSlot?.status === 'ok' && aheadSlot.fc?.features?.length
      ? only34(aheadSlot.fc.features)
      : null;

    if (aheadRings) {
      const r = peopleInPhases(flat, rings, aheadRings);
      people = r
        ? { forId, state: 'ok', split: true, total: r.total, ahead: r.ahead, past: r.past }
        : { forId, state: 'unavailable' };
    } else {
      const result = peopleInFeatures(flat, rings);
      people = result
        ? { forId, state: 'ok', split: false, total: result }
        : { forId, state: 'unavailable' };
    }
    repaint();
  }

  /** The section heading. FIXED, and deliberately tense-neutral.
   *
   *  ==> IT USED TO CHANGE WITH THE COUNT AND THAT WAS THE WRONG FIX. <== The
   *  first cut of §54 swapped the heading to "People it went through" whenever
   *  nobody was ahead, on the grounds that "People in the path" over a
   *  past-tense paragraph is the same false claim in smaller type. The claim
   *  was right; the remedy was not. Aaron's call, 2026-08-21: "went through"
   *  reads as though the storm walked through the people, and a section that
   *  renames itself is harder to find when you are scanning the drawer — open
   *  the same storm twice and the heading has moved.
   *
   *  "Population affected" is true in every state, so the heading never has to
   *  lie and never has to move. THE BODY CARRIES THE TENSE, which is where a
   *  tense belongs: it is a sentence, and a sentence can say "have already been
   *  through" without a two-word heading trying to. */
  function title() {
    return 'Population affected';
  }

  /**
   * The section body's inner HTML. Pure of the DOM.
   *
   * @param {object} storm
   * @param {{ghost:boolean, withheld:string}} ctx `withheld` is the view's
   *        silent/ended note, already decided — the same gate every section in
   *        this drawer sits behind.
   */
  function html(storm, { ghost, withheld } = {}) {
    if (storm && ghost) {
      return '<div class="detail-soft">Not available for a storm that has left the feed.</div>';
    }
    if (withheld) return `<div class="detail-soft">${esc(withheld)}</div>`;

    if (people.state === 'loading' || people.state === 'idle') {
      return `<div class="detail-soft">Counting${DOTS}</div>`;
    }
    if (people.state === 'unavailable') {
      return `<div class="detail-soft">Population estimate unavailable.
        <button type="button" class="detail-retry" data-retry="people">Try again</button></div>`;
    }
    if (people.state === 'none') {
      return '<div class="detail-soft">No wind field published for this advisory, so there is nothing to measure against.</div>';
    }

    const figure = (count) => `<div class="detail-people-figure">≈${esc(formatPeople(count.people))}</div>`;
    const towns = (count) => esc(String(count.towns.toLocaleString()));

    /* A measured zero is a real and common answer — a storm in the open
     * Atlantic genuinely has nobody in its path — and it must not read like a
     * failure. It gets its own sentence rather than "≈0". */
    const nobody = (line) =>
      `<div class="detail-people-figure">Nobody</div><div class="detail-soft">${line}</div>`;

    let headline;
    if (!people.split) {
      /* No forward shape. One figure about the whole envelope, in the words
       * this section has always used. */
      headline = people.total.people === 0
        ? nobody('No towns inside the tropical-storm-force wind field.')
        : `${figure(people.total)}
           <div class="detail-soft">people in ${towns(people.total)} towns inside the
           tropical-storm-force wind field.</div>`;
    } else if (people.ahead.people === 0 && people.past.people === 0) {
      headline = nobody('No towns inside the tropical-storm-force wind field.');
    } else if (people.ahead.people === 0) {
      /* ==> THE WHOLE REASON THE SPLIT EXISTS. <== Everyone this storm reached,
       * it has already reached. Past tense, and the all-clear stated outright
       * rather than left to be inferred from a heading — this is the shape Lala
       * was wearing a future-tense warning in. */
      headline = `${figure(people.past)}
        <div class="detail-soft">people in ${towns(people.past)} towns have already been
        through the tropical-storm-force wind field. Nobody is ahead of the storm now.</div>`;
    } else if (people.past.people === 0) {
      headline = `${figure(people.ahead)}
        <div class="detail-soft">people in ${towns(people.ahead)} towns are inside the
        tropical-storm-force wind field or ahead of it.</div>`;
    } else {
      /* Both are true at once, and the one that can still be acted on leads.
       * The past gets a line, not a second figure — two big numbers stacked at
       * phone width is two things to compare and nothing saying which matters
       * (§49.2, the same call the home drawer's mid-pass case makes). */
      headline = `${figure(people.ahead)}
        <div class="detail-soft">people in ${towns(people.ahead)} towns are inside the
        tropical-storm-force wind field or ahead of it.</div>
        <div class="detail-soft">Another ≈${esc(formatPeople(people.past.people))} in
        ${towns(people.past)} towns have already been through it.</div>`;
    }

    return `${headline}
      <div class="detail-people-note">Estimate. Counts residents of towns of
      ${esc(String(POPULATION.minTownPopulation.toLocaleString()))} or more, so the real
      figure is higher — rural areas are not counted.</div>`;
  }

  /** Bind the retry inside an already-rendered body. `data-retry` scopes the
   *  button so the geometry retry binding in the host view never collects it. */
  function wire(scope, storm, ghost, geo, repaint) {
    for (const btn of scope?.querySelectorAll?.('[data-retry="people"]') || []) {
      btn.addEventListener('click', () => {
        people = { forId: null, state: 'idle' };
        ensure(storm, ghost, geo, repaint);
      });
    }
  }

  /** Forget everything. The view calls this when the drawer closes, so a
   *  reopened panel never paints the previous storm's figure for a frame. */
  function reset() {
    people = { forId: null, state: 'idle' };
  }

  return { html, title, ensure, wire, reset };
}
