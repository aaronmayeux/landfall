/**
 * seasons-board-furniture.js — everything the season board says ABOUT A SEASON,
 * as opposed to about a storm.
 * SPEC-SEASONS-BUILD.md §57.18, §57.18a, §57.18b, §57.26a.
 *
 * ==> THIS CUT WAS NAMED IN §12'S TABLE AND ORDERED TO BE TAKEN BEFORE STEP 9.
 * <== It was not, and step 9 landed on `ui/seasons-board-markup.js` first,
 * carrying it to 785 lines. The cut is being taken in the same session, in its
 * own commit, so a bisect can still tell a move from a behaviour change — but
 * the row in §12 records the order it actually happened in rather than the
 * order it was planned in, because that is the pattern worth catching.
 *
 * ==> THE BOUNDARY IS THE SUBJECT, NOT THE SIZE. <== `ui/seasons-board-markup.js`
 * is now the ROSTER: one storm's row, the master checkbox above the list, the
 * filters, the picker, and the assembly that puts them together. This file is
 * the SEASON: the scorecard and its honesty lines, the unused-name ghosts, the
 * wind-footprint note, and the four sentences for the ways a season can fail to
 * arrive. The two share no state and the dependency runs one way — the roster
 * imports these, and nothing here knows a roster exists.
 *
 * ==> EVERY FUNCTION IS PURE AND TOLD, NOT READING. <== Unchanged from where
 * they lived before: handed what is true, returns a string, reads no module
 * state, no clock and no DOM. That is what let them move at all.
 *
 * Imports config/ and lib/. No DOM, no network, no clock.
 */

import { SEASONS } from '../config/constants.js';
import { stormDisplayName } from '../lib/season-names.js';
import { dotted } from './loading-dots.js';
/* ==> `NEAR_HOME_FILTER` IS IMPORTED RATHER THAN RE-DECLARED. <== The empty
 * roster sentence branches on it, and a second string literal is exactly how a
 * filter offered by one file and unknown to another ends up narrowing a roster
 * to nothing (§5). */
import { NEAR_HOME_FILTER } from './seasons-near-home.js';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** How a storm is called on a row, and along its track on the globe. The rule
 *  lives in `lib/season-names.js`; this re-export is here so the sentences
 *  below name a storm exactly the way the row beside them does — §57.14 gives
 *  an unnamed storm a display form, and two files disagreeing about it is the
 *  panel contradicting itself. */
export const displayName = stormDisplayName;

/**
 * Six numbers and the sentences that stop them being read as more than they
 * are.
 *
 * @param {object} opts
 * @param {object|null} opts.score        from `seasonFacts`
 * @param {object|null} opts.roster       from `rosterFor`, or null
 * @param {boolean} opts.provisional      the season in progress
 * @param {boolean} opts.stale            the live index came from a stored copy
 * @param {number} opts.unreadable        storms whose track would not load
 */
export function scoreHtml({ score, roster, provisional, stale, unreadable }) {
  if (!score) return '';

  /* ==> A LANDFALL FIGURE THE RECORD CANNOT SUPPORT IS A DASH, NEVER A ZERO.
   * <== §5, and this is the sharpest case of it in the feature: the app is
   * called Landfall, and `0` on that cell reads as "nothing reached land this
   * year" rather than "nobody has marked them yet". Both are six characters on
   * a phone and only one of them is true. The line under the grid is what
   * turns the dash from a hole into an answer.
   *
   * ==> AND IT COUNTS STORMS THAT CAME ASHORE, NOT TIMES A COAST WAS CROSSED.
   * §57.39b. <== Aaron on glass, 2026-08-28, on 2020. Both figures are real
   * and this cell had the other one: 2020 Atlantic is 18 storms and 34
   * crossings — Laura alone made 7 of them, across Hispaniola, Cuba and
   * Louisiana. Printed as `34` it sat two lines above `All 18 storms shown`
   * under the Landfalls filter, and one screen away from the Wall of Years
   * saying `18 of 31`. One word, three surfaces, two meanings, and nothing on
   * screen to tell a reader which question was being answered.
   *
   * ==> THE APP ALREADY DECIDED WHICH QUESTION, AND THIS CELL HAD NOT HEARD.
   * <== §57.7a: the wall carried a real crossing count for about a day and
   * Aaron reverted it on 2026-08-27, because counting crossings turns a season
   * into a ranking of ARCHIPELAGOS — 1933 topped the board at 41 while a year
   * that flattened the Gulf coast scored 6. A season's question is how many
   * storms reached land. How often one particular storm did is a fact about
   * that storm, and it is on the storm's own row and in its panel.
   *
   * ==> SO THE LABEL CHANGES WITH THE NUMBER, AND HAD TO. <== `Landfalls: 18`
   * would be a worse lie than `Landfalls: 34` — the same word over a figure
   * that no longer counts landfalls at all. `Came ashore` is the wall's own
   * wording for the same measurement, so the two screens now agree in words as
   * well as in arithmetic. */
  const cells = [
    ['Storms', score.storms],
    ['Named', score.named],
    ['Hurricanes', score.hurricanes],
    ['Majors', score.majors],
    ['ACE', Number.isFinite(score.ace) ? score.ace.toFixed(1) : '—'],
    ['Came ashore', provisional ? '—' : score.stormsWithLandfall],
  ].map(([k, v]) => `
      <div class="seasons-stat">
        <span class="seasons-stat-n">${esc(v)}</span>
        <span class="seasons-stat-k">${esc(k)}</span>
      </div>`).join('');

  /* ==> THE UNDERCOUNT LINE IS NOT A FOOTNOTE. <== Before the satellite era
   * nobody saw the storms that stayed at sea, so a quiet-looking 1935 is not
   * evidence of a quiet season. Printing six confident numbers with nothing
   * beside them would be the app making a claim the record cannot support. */
  const note = score.undercountLikely
    ? `<p class="seasons-note">Before ${SEASONS.satelliteEraFrom}, storms that stayed out
         at sea were often never seen. These counts are a floor, not a total.</p>`
    : '';

  /* §57.11 — the app must be able to say WHICH record it is showing, and this
   * is where it says it. Two facts, deliberately in one sentence: the numbers
   * will change, and the season is not over, so they are a running total
   * rather than a result. */
  const prov = provisional
    ? `<p class="seasons-note">These are working numbers for a season still
         running. NOAA reviews them and publishes the settled record the
         following spring — positions and strengths will move. Landfall marks
         come with that reviewed record.</p>`
    : '';

  /* Stale, and said rather than hidden. A stored copy is still a correct list
   * of the storms it knew about; what it cannot promise is that nothing has
   * formed since. §5 — stale plus a timestamp beats a blank screen, and beats
   * a fresh-looking screen that is neither. */
  const old = stale
    ? `<p class="seasons-note">This list came from a stored copy — a storm that
         formed in the last few hours may not be on it yet.</p>`
    : '';

  /* ==> STORMS THAT FAILED TO LOAD ARE COUNTED OUT LOUD. <== The season index
   * says fifteen and the globe has twelve: without this the reader is looking
   * at a season that is quietly three storms short and reads as complete.
   *
   * ==> AND THE SECOND HALF OF THAT SENTENCE IS NOT A FLOURISH. <== A storm's
   * NAME is inside the file that would not load, so a season short one storm
   * is also a season whose roster believes that name was never spent — the
   * missing storm turns up in the unused list below. Nothing can fix that
   * (the index carries ids, not names), so it is disclosed. Left unsaid, the
   * ghost list would be quietly wrong on exactly the day something is already
   * wrong, which is the worst moment to be silently misleading. */
  const alsoGhosts = roster?.ghosts?.length
    ? ` ${unreadable === 1 ? 'Its name' : 'Their names'} may show as unused below.`
    : '';
  const short = unreadable > 0
    ? `<p class="seasons-note seasons-bad">${unreadable}
         ${unreadable === 1 ? 'storm could' : 'storms could'} not be read, so
         ${unreadable === 1 ? 'it is' : 'they are'} missing from this list and
         from these numbers.${alsoGhosts}</p>`
    : '';

  /* Names all spent — the loudest thing a season can say about its own shape,
   * and for a settled year it is the whole of what ghosts would have said. */
  const spent = roster?.reachedEnd
    ? '<p class="seasons-note">Every name on the list was used.</p>'
    : '';

  return `<div class="seasons-score">${cells}</div>${note}${prov}${old}${short}${spent}`;
}

/**
 * The current season could not be reached.
 *
 * ==> IT IS SAID ON EVERY SETTLED YEAR, NOT ONLY WHERE 2026 WOULD HAVE SAT.
 * <== There is no row to hang it on: the year is simply absent from the
 * picker, and an absent option explains nothing. A reader who came to see
 * what is happening now needs to know the road is down rather than conclude
 * the archive stops at last year.
 *
 * ==> MOVED HERE FROM THE VIEW WHEN THAT FILE CROSSED §12'S 700-LINE CEILING.
 * <== It was always a markup function living outside the markup file, and it
 * is TOLD what to draw rather than reading state, the same as everything else
 * in here — `null` and flags in, a string out. Nothing about the behaviour
 * moved with it.
 *
 * @param {object} opts
 * @param {boolean} opts.hasLive  does this basin have a season in progress at
 *   all? A basin with none has nothing to say, which is honest silence rather
 *   than an error (§5)
 * @param {boolean} opts.retrying a second attempt is in the air
 * @param {string} opts.reason    why it could not be reached; empty when it was
 */
export function liveDownHtml({ hasLive, retrying, reason }) {
  if (!hasLive) return '';
  if (retrying) return waitingHtml('Looking for the season still running…');
  if (!reason) return '';
  /* ==> AND IT GETS A BUTTON, BECAUSE THIS ONE CAN ACTUALLY SUCCEED. <== §5
   * asks every error state for a recovery action, and the distinction the
   * rest of this board draws is whether pressing it could ever work: a year
   * the archive does not hold gets no Retry, a road that was down for a
   * moment does. `data/seasons-live.js` drops a failed fetch out of its own
   * map, so this is a real second attempt rather than a replay. */
  return `<p class="seasons-note seasons-bad">The season still running could not
      be reached, so it is not in the list above. The settled years are all here.</p>
      <button class="seasons-retry" type="button" data-retry="live">Try again</button>`;
}

/**
 * The empty slot the footprint note is written into. §57.26a.
 *
 * ==> ALWAYS IN THE MARKUP, EMPTY MOST OF THE TIME, FOR THE SAME REASON
 * `showAllHtml` IS. <== Its content depends on which storm is focused, and
 * focus moves on every tap on a track. Rebuilding the roster to say one
 * sentence would cost the reader their scroll position and their focus ring on
 * the feature's most frequent interaction — so the view patches this one
 * element instead, exactly as it patches the row classes.
 *
 * `role="status"` because it appears in response to the reader's own action
 * and a screen reader should hear it without being moved there. It is polite
 * by default, so it waits its turn rather than interrupting.
 */
export function footprintSlotHtml() {
  return `<div class="seasons-footprint" role="status"></div>`;
}

/**
 * Why the focused storm has no wind footprint. §57.25 rule 2, §57.26a.
 *
 * ==> THE SENTENCE IS THE WHOLE POINT OF STEP 6b, NOT A CAPTION ON IT. <==
 * Three quarters of the archive has no wind field — measured, 826 storms of
 * 3,266 — so for most of what a reader opens, this line IS the feature. §57.25
 * asks it to teach something true about the record rather than read as a
 * missing button, and that is the thing to judge on glass.
 *
 * ==> TWO WORDINGS, AND THE SECOND ONE EXISTS SO THE FIRST CANNOT LIE. <== The
 * era sentence is only said for a storm from before the first season that
 * records a wind field. A 2004-or-later storm with nothing to draw gets a
 * plain statement instead, because "wasn't recorded before 2004" would be a
 * claim about the record that this storm is the counter-example to. Every
 * settled season measures 100% coverage from 2004 on, so in practice the
 * second wording is for the season still running, whose b-decks are a
 * different source — which is exactly the case worth not guessing about.
 *
 * ==> AND IT IS SILENT WHEN THERE IS A FOOTPRINT. <== §57.25's rule is that an
 * absence which is information gets said; a presence speaks for itself, and
 * the shape is on the globe. A line reading "this storm has a wind footprint"
 * next to a wind footprint is furniture.
 *
 * ==> IT NAMES THE STORM THROUGH `displayName`, THE SAME ROUTE `rowHtml`
 * TAKES. <== §57.14 gives an unnamed storm a display form, and a sentence
 * calling it something the row beside it does not is the panel disagreeing
 * with itself.
 *
 * @param {object|null} opts  `{ storm, facts }` for the FOCUSED storm, or null
 * @returns {string} markup, or '' when nothing needs saying
 */
export function footprintNoteHtml(entry) {
  const { storm, facts } = entry || {};
  if (!storm || !facts) return '';
  if (!facts.missing?.windField) return '';

  const era = Number.isFinite(facts.year) && facts.year < SEASONS.windFieldFirstSeason;
  const why = era
    ? `Wind field size wasn't recorded before ${SEASONS.windFieldFirstSeason}`
    : 'No wind field was recorded for this storm';

  /* The two wordings are literals in this file and the year is a number out
   * of a frozen constants block, so only the NAME goes through `esc` — it is
   * the one value here that came out of a data file. Escaping the sentence as
   * well turned its apostrophe into an entity for no gain. */
  return `<p class="seasons-note">${why}, so there is no wind
      footprint for ${esc(displayName(storm))}.</p>`;
}

/**
 * The unused names, for the season still running.
 *
 * ==> AND THE OFF-LIST CASE IS SAID OUT LOUD RATHER THAN SWALLOWED. <== A
 * storm carrying a name that is not on the roster means either the season ran
 * past its list onto the WMO supplemental one — real, and what replaced the
 * Greek alphabet in 2021 — or the list in this repo is wrong. Both need a
 * reader to know, and a roster that quietly hid the second would look perfect
 * while lying (§5).
 */
export function ghostsHtml(roster) {
  if (!roster) return '';

  const off = roster.offList.length
    ? `<p class="seasons-note">${esc(roster.offList.join(', '))} ${
      roster.offList.length === 1 ? 'is' : 'are'} not on this year's list —
        the season has gone past it, or the list here is out of date.</p>`
    : '';

  if (!roster.ghosts.length) return off;

  const rows = roster.ghosts.map((n) => `
      <li class="seasons-row seasons-row-ghost">
        <span class="seasons-ghost-name">${esc(n)}</span>
      </li>`).join('');

  return `
      ${off}
      <p class="seasons-note" id="seasons-ghosts-note">${roster.ghosts.length}
        ${roster.ghosts.length === 1 ? 'name is' : 'names are'} still unused this season.</p>
      <ul class="seasons-roster" aria-labelledby="seasons-ghosts-note">${rows}</ul>`;
}

/** ==> THE TRAILING ELLIPSIS HAS TO MOVE. <== `ui/loading-dots.js`: a static
 *  `…` on glass is indistinguishable from a sentence that has finished and
 *  trailed off, so a reader cannot tell a live fetch from a screen that has
 *  quietly given up. Every waiting sentence in this app goes through the same
 *  helper, and `tools/test-loading-dots.mjs` is what caught this one sitting
 *  outside it. */
export function waitingHtml(sentence) {
  return `<p class="seasons-note" role="status">${dotted(sentence)}</p>`;
}

/**
 * A season that could not be loaded.
 *
 * Two different failures, two different sentences. A year the index does not
 * carry is not a network problem and offering Retry for it would be a button
 * that can never work.
 */
export function seasonFailedHtml({ year, reason }) {
  const missing = reason === 'not_in_index';
  return `
        <p class="seasons-note seasons-bad" role="status">
          ${missing
    ? `The archive does not hold ${esc(year)} for this basin.`
    : 'That season could not be loaded. It may be a connection problem.'}
        </p>
        ${missing ? '' : '<button class="seasons-retry" type="button">Try again</button>'}`;
}

/**
 * ==> AN EMPTY ROSTER IS A REAL ANSWER, AND IT HAS FOUR CAUSES. <== The
 * record says the year was quiet (the Atlantic recorded two storms in 1914);
 * the reader's own filter matched nothing; the season in progress has not had a
 * storm yet, which in January is simply true; or nothing came near their house,
 * which is the one a reader is most likely to be pleased about. Four different
 * facts, and a reader who cannot tell them apart will think the archive is
 * broken.
 *
 * ==> AND NEAR HOME GETS ITS OWN WORDS RATHER THAN THE GENERIC FILTER ONE. <==
 * *"No storms in 1997 match that filter"* is true and useless. Under this
 * filter the empty answer IS the answer somebody asked for — nothing came near
 * — and saying it in those words is the difference between the feature working
 * and the feature looking like it failed. It names the radius, because a reader
 * who has just dragged a slider needs to know which circle came back empty.
 */
export function emptyRosterHtml({ year, filtered, provisional, filter = null, radiusWords = '' }) {
  if (filter === NEAR_HOME_FILTER && radiusWords) {
    return `<p class="seasons-note">No storm in ${esc(year)} came within
        ${esc(radiusWords)} of home.</p>`;
  }
  if (filtered) return `<p class="seasons-note">No storms in ${esc(year)} match that filter.</p>`;
  return provisional
    ? `<p class="seasons-note">No storms have formed yet in ${esc(year)} in this basin.</p>`
    : `<p class="seasons-note">The record has no storms for ${esc(year)} in this basin.</p>`;
}

/** The index itself failed, so there are no years to choose between. */
export function indexFailedHtml() {
  return `
        <p class="seasons-note seasons-bad" role="status">
          The archive index could not be loaded, so there are no years to choose from.
        </p>
        <button class="seasons-retry" type="button">Try again</button>`;
}