/**
 * season-detail-markup.js — every string of HTML the archive's storm detail
 * panel draws. SPEC-SEASONS-BUILD.md §57.15, §57.22, §57.22a, §57.30 step 7.
 *
 * ==> SPLIT FROM THE VIEW ON DAY ONE, RATHER THAN WHEN THE CEILING WAS HIT.
 * <== `ui/view-seasons-board.js` has now crossed §12's 700 lines twice in two
 * sessions and been cut twice, both times along exactly this seam. Doing it
 * up front costs nothing and skips the third rediscovery. Every function here
 * is PURE — told what to draw, reading no module state, no clock and no DOM —
 * so a suite can drive it without mounting anything.
 *
 * ==> THE HONESTY LINE IS THE MOST IMPORTANT STRING IN THIS FILE. <== §57.22.
 * A best track is cleaned-up hindsight, finalised months after the season by
 * people re-examining every observation. It is NOT what the forecasters knew
 * on the night — and on a globe that looks exactly like the live view, with a
 * track and a wind footprint drawn the same way, a reader has no way to tell
 * those apart. That sentence is the only thing that tells them.
 *
 * ==> AND THE SECOND MOST IMPORTANT THING IS WHAT IS **NOT** SAID. <== §57.25
 * rule 2: where the record is silent the panel says why, in a sentence that
 * teaches something true about the record. Where a thing never existed it is
 * deleted entirely. A row reading `Pressure —` is neither: it is a shrug, and
 * it looks like a bug. **Every value here is either a real number or a
 * sentence about its absence. Nothing is ever zeroed and nothing is ever
 * dashed.**
 *
 * Imports config/ and lib/. No DOM, no network, no clock.
 */

import { SEASONS } from '../config/constants.js';
import { categoryColor, categoryShortLabel } from '../lib/category.js';
import { stormDisplayName } from '../lib/season-names.js';
/* ==> THE PROSE CATEGORY LABEL COMES FROM THE STORY FILE RATHER THAN BEING
 * WRITTEN AGAIN HERE. <== `categoryPhrase` says "a Category 3"; this file's own
 * `categoryShortLabel` says "Cat 3", which is right for a list row and wrong
 * inside a sentence. Two spellings of the same grading is how a panel comes to
 * disagree with its own paragraph four lines further up. */
import { categoryPhrase, countWord } from '../lib/season-story.js';
/* ==> `formatDistance` AND `formatSpeed` LEFT WITH `Where it went`. <== §57.57.
 * They were the only two unit conversions on this panel that were about the
 * GROUND rather than about the storm's strength, and both went to
 * `ui/season-track-markup.js` with the two renderers that used them. What is
 * left here is wind and pressure, and the same rule governs them: the reader's
 * choice arrives as the `system` argument every renderer on this panel takes,
 * and a conversion written by hand would be a second opinion about a Settings
 * value `lib/units.js` already owns. */
import { formatWind, formatPressure } from '../lib/units.js';
/* ==> THE PIECES EVERY SECTION BELOW IS BUILT OUT OF LIVE NEXT DOOR. <==
 * SPEC.md §12, §57.45. Escaping, the four small formatters, the definition
 * list and the note paragraph went to `ui/season-markup-bits.js` when this
 * file crossed the ceiling again. Nothing in that file knows what a storm is;
 * everything in this one does, and that is the line between them.
 *
 * `dotted` went with `absenceHtml`, which was its only caller here. */
import {
  absenceHtml, coords, esc, spanWords, utcDay, utcStamp, windWords,
} from './season-markup-bits.js';
/* ==> EVERY ROW ON THIS PANEL GOES THROUGH `figureRowsHtml` SINCE STEP 3, NOT
 * ONLY THE ONES CARRYING A BAR. <== §57.57b. A row names its `RANK_STATS` key
 * when it prints a ranked figure and says nothing otherwise, and that renderer
 * does the lookup. Splitting the sections between two row renderers on whether
 * a given storm happened to rank would put two `<dl>`s inside one section on
 * some storms and one on others. */
import { figureRowsHtml } from './season-figure-row.js';
/* ==> THE LIST TAKES ITS NUMBERS FROM THE CHART'S OWN MODULE RATHER THAN
 * COUNTING AGAIN. <== §57.60. Two renderers counting the same array is how the
 * discs and the list end up disagreeing with nobody able to see it. The import
 * runs one way — the chart knows nothing about this file — so there is no
 * cycle, and it is the same shape as `figureRowsHtml` above. */
import { orderedLandfalls } from './season-life-chart.js';

/* ---------------------------------------------------------------------------
 * THE HEADER
 * ------------------------------------------------------------------------ */

/**
 * Name, strength and the honesty line.
 *
 * ==> THE HONESTY LINE IS IN THE HEADER AND NOT IN A SECTION, ON PURPOSE. <==
 * §57.22 asks for it; where it goes is this file's call. A collapsible section
 * can be collapsed, and the one sentence that stops the whole panel being
 * misread must not be something a reader can fold away and then forget. It
 * sits under the name, above everything it qualifies.
 */
export function headHtml({ storm, facts, provisional }) {
  const name = stormDisplayName(storm);
  const color = categoryColor(facts?.peakCategory ?? null, 'tropical', null);
  /* `categoryShortLabel` is the only label this repo has, and it is the one the
   * roster row already uses — so a storm reads the same in the list and in its
   * own panel. It answers `—` for an ungraded storm, which is a dash and is
   * exactly what this file refuses everywhere else, so that answer is dropped
   * rather than shown. */
  const shortLabel = facts?.peakCategory != null
    ? categoryShortLabel(facts.peakCategory, 'tropical', null)
    : null;
  const strength = shortLabel && shortLabel !== '—' ? shortLabel : null;

  /* ==> THE PROVISIONAL STAMP IS ABOVE THE HONESTY LINE, AND WHEN IT SHOWS,
   * THE HONESTY LINE IS WRONG. <== §57.11. A storm from the season still
   * running came out of an ATCF b-deck, which is the operational working file
   * — it has NOT been finalised after the season, because the season has not
   * ended. Saying "finalised after the season" over it would be exactly the
   * false reassurance the sentence exists to prevent, so the two are
   * alternatives rather than a stack. */
  const honesty = provisional
    ? `<p class="detail-note season-honesty">This season is still running, so
        these are operational figures that NOAA has not yet reviewed. They will
        change.</p>`
    : `<p class="detail-note season-honesty">NOAA best-track data, finalised
        after the season. These are not the forecasts issued at the time.</p>`;

  return `
    <header class="season-detail-head">
      <h1 class="season-detail-name" tabindex="-1">
        <span class="season-detail-dot" style="--swatch: ${esc(color)}" aria-hidden="true"></span>
        ${esc(name)}
      </h1>
      ${strength ? `<p class="season-detail-strength">${esc(strength)} · ${esc(String(storm.year))}</p>` : ''}
      ${honesty}
    </header>`;
}

/**
 * The storm's life in a paragraph. §57.41.
 *
 * ==> IT SITS UNDER THE HONESTY LINE AND ABOVE `Strongest`, AND IT IS NOT A
 * SECTION. <== Aaron's call on the placement; the rest follows from it. Every
 * `section()` on this panel can be collapsed, and a paragraph that summarises
 * the whole record must not be something a reader folds away and then reads the
 * figures without. It is also qualified by the honesty line above it, so
 * nothing here can be read before that sentence.
 *
 * ==> NO CLAUSE IS ASSEMBLED IN THIS FILE. <== `lib/season-story.js` returns
 * finished sentences and this only escapes them and puts them in a tag. The
 * arithmetic and the wording are one thing, tested together, and a renderer
 * that started making its own sentences would be a second author for the same
 * paragraph.
 *
 * @param {string[]} clauses  from `storyClauses`
 */
export function storyHtml(clauses) {
  const real = (clauses || []).filter((s) => typeof s === 'string' && s.trim());
  if (!real.length) return '';
  return `<p class="season-story">${esc(real.join(' '))}</p>`;
}

/* ---------------------------------------------------------------------------
 * THE SECTIONS
 * ------------------------------------------------------------------------ */

/** Peak intensity, when and where. §57.15. */
export function peakHtml(facts, system, marks = null) {
  if (facts?.missing?.wind) {
    return absenceHtml(
      'No wind speed was ever recorded for this storm. That is ordinary for the '
      + '19th century. The record holds where it went, not how strong it was.'
    );
  }
  /* ==> TWO OF THESE FIVE ROWS NAME A `RANK_STATS` KEY AND THE OTHER THREE DO
   * NOT. <== §57.57b. A key is this row saying *I am the peak wind figure*,
   * and nothing more: `figureRowsHtml` does the lookup, so this function never
   * learns what a rank sentence reads like or that a bar exists. `Reached`,
   * `Where` and `Measured` are stamps rather than figures — there is no
   * ladder of dates and no sense in ranking one — so they carry no key and
   * draw in the two-column shape they always had. */
  return figureRowsHtml([
    { key: 'peakWindKt', label: 'Peak winds', value: windWords(facts.peakWindKt, system) },
    { label: 'Reached', value: utcStamp(facts.peakTime) },
    { label: 'Where', value: coords(facts.peakLat, facts.peakLon) },
    {
      key: 'lowestPressureMb',
      label: 'Lowest pressure',
      value: Number.isFinite(facts.lowestPressureMb)
        ? formatPressure(facts.lowestPressureMb) : null,
    },
    {
      label: 'Measured',
      value: Number.isFinite(facts.lowestPressureMb)
        ? utcStamp(facts.lowestPressureTime) : null,
    },
  ], marks) + (facts?.missing?.pressure
    ? absenceHtml('No pressure reading survives for this storm.')
    : '');
}

/** Lifespan and time at strength. §57.15. */
export function lifeHtml(facts, marks = null) {
  const rows = [
    { label: 'First seen', value: utcDay(facts.firstTime) },
    { label: 'Last seen', value: utcDay(facts.lastTime) },
    { key: 'lifespanHours', label: 'Lifespan', value: spanWords(facts.lifespanHours) },
  ];
  /* ==> ZERO HOURS AT HURRICANE STRENGTH IS OMITTED, NOT SHOWN AS ZERO. <==
   * A tropical storm that never became a hurricane is not "0 days at hurricane
   * strength" — that phrasing invites the reader to wonder what went wrong.
   * It simply never was one, and the peak figure above already says so.
   *
   * ==> AND THESE TWO GUARDS ARE BELT-AND-BRACES RATHER THAN THE MECHANISM.
   * <== Written down because a mutation run on 2026-08-25 proved it: removing
   * them changes nothing, because `spanWords` answers null for zero and the
   * row renderer already drops any row whose value is null. The rule is
   * enforced once, in `figureRowsHtml`, for every row on this panel. These
   * stay as the clearer statement of intent at the call site — but nobody
   * should believe they are load-bearing, and a comment implying they were
   * would be worse than no comment.
   *
   * ==> `At hurricane strength` CARRIES NO KEY BECAUSE NOTHING RANKS IT. <==
   * `RANK_STATS` holds `hoursAtMajor` and not its hurricane sibling, and a key
   * naming a statistic the table does not have would look like a bar that had
   * failed to draw. A row with no mark is the ordinary case, not a fault. */
  const hur = spanWords(facts.hoursAtHurricane);
  const maj = spanWords(facts.hoursAtMajor);
  if (hur) rows.push({ label: 'At hurricane strength', value: hur });
  if (maj) rows.push({ key: 'hoursAtMajor', label: 'At major strength', value: maj });

  /* ==> ACE IS NOT AN ACRONYM ON THIS PANEL AND IT IS NOT TWO ROWS. <== §57.58,
   * §57.54e. It printed `ACE 20.0 × 10⁴ kt²` over `From 24 six-hourly
   * observations`: two pieces of jargon, a unit nobody can picture, and no
   * meaning. Aaron asked for it to be explained.
   *
   * ==> THE COUNT MOVED INTO THE VALUE RATHER THAN BEING DROPPED. <== It is
   * the one thing on this row that is about the RECORD instead of the storm:
   * ACE is computed from synoptic records only, so a thinly observed 1885
   * storm scores low for a reason that is not about the weather. Two rows for
   * one figure was the thing making it read as arithmetic; the fact itself is
   * worth keeping, so it rides in the value where it qualifies the number it
   * is next to.
   *
   * ==> THE UNIT IS GONE AND THAT IS DELIBERATE. <== `× 10⁴ kt²` is exact and
   * unreadable. Nothing a reader can do with this figure needs it: the bar
   * under the row places the storm against the whole archive, which is the
   * anchor a bare 20.0 never had. */
  let aceNote = null;
  if (Number.isFinite(facts.ace) && facts.aceRecords > 0) {
    rows.push({
      key: 'ace',
      label: 'Power and stamina score',
      value: `${facts.ace.toFixed(1)} from ${facts.aceRecords} reading`
        + `${facts.aceRecords === 1 ? '' : 's'}`,
    });

    /* ==> THE CADENCE IS DERIVED FROM THE CONSTANT THAT PRODUCED THE FIGURE,
     * NEVER TYPED. <== `CLAUDE.md`'s rule. `aceSynopticHours` is the list of
     * hours ACE counts and it is evenly spaced by definition — synoptic
     * observation times — so the gap is 24 divided by how many there are. A
     * typed "6 hours" beside a constant somebody later moves is a sentence
     * that reads perfectly and describes a different measurement from the one
     * above it, which is the fault §57.41 already paid for once.
     *
     * ==> "FOUR TIMES AS MUCH" IS EXACT, NOT APPROXIMATE. <== The sum is of
     * wind SQUARED (`lib/season-facts.js`), so doubling the wind quadruples
     * the contribution: 40 kt gives 0.160 per reading and 80 kt gives 0.640.
     * The divisor is linear and does not touch the ratio.
     *
     * ==> AND IT IS A `.detail-note`, WHICH IS WHERE AN EXPLANATION BELONGS AS
     * WELL AS AN ABSENCE. <== §57.55a settled this for the
     * rapid-intensification sentence: that style's own rule is a caveat about
     * the figure beside it, quieter than the numbers, and a gloss under the
     * row it explains is exactly that shape. */
    const hours = 24 / SEASONS.aceSynopticHours.length;
    aceNote = 'One score for strength and staying power together. It adds up the '
      + `wind every ${hours} hours the storm was at least a tropical storm, `
      + 'counting stronger winds far more heavily: double the wind and those '
      + 'hours count four times as much. A brief violent storm can score less '
      + 'than a long steady one.';
  }

  /* The gloss sits UNDER the row, which is where it can be reached without
   * hunting. ACE is pushed last, so nothing separates the two. §57.54e names
   * the lever if it ever reads as too much on glass — putting it BEHIND the
   * row rather than under it — and that is a glass call rather than a
   * rewrite. */
  return figureRowsHtml(rows, marks) + absenceHtml(aceNote);
}

/**
 * Every landfall. §57.15, §57.7.
 *
 * ==> THE 1971–1982 HOLE GETS ITS OWN SENTENCE, BECAUSE ITS ABSENCE IS THE
 * ONE THAT LOOKS LIKE A FACT. <== §57.7: NOAA's `L` markers are missing for
 * US landfalls across those twelve Atlantic years. Every other empty landfall
 * list on this panel means "this storm stayed at sea", which is real
 * information. In that window it means "nobody wrote it down", and the two
 * read identically. A storm that plainly hit Texas showing no landfalls is
 * the app appearing to state something false.
 *
 * ==> THE PLACE NAME LEADS AND THE COORDINATES STAY UNDER IT. <== Aaron on
 * glass, 2026-08-29: this section still read `29.3°N 89.6°W` after §57.40 had
 * already worked out it was Port Sulphur, Louisiana. The name is what a reader
 * scans for, so it goes first — but it does NOT replace the coordinates. Those
 * are exact and are what the record actually holds, while a name 22 km away is
 * an orientation rather than a position. Both, in that order.
 */
export function landfallsHtml(facts, system, { markerHoleFrom, markerHoleTo, places = null }) {
  const list = facts?.landfalls || [];

  /* ==> WHAT THE WALK TURNED DOWN GETS A SENTENCE, BECAUSE SILENCE IS NEVER
   * THE ANSWER. <== §5, §57.7e. 135 real coast crossings across the archive
   * are not landfalls: 86 were under the wind floor, 38 carried a code that is
   * not a former cyclone, 11 happened before the system had become one. For 26
   * storms that is EVERY crossing they have, so this panel said "this storm
   * did not come ashore" over a track that plainly touched land.
   *
   * ==> ONE SENTENCE, AND IT DOES NOT NAME THE THREE REASONS. <== They are
   * three ways of saying the system was not a tropical cyclone at the moment
   * it crossed, which is the part a reader needs. Splitting them would put a
   * paragraph of vocabulary under a list of places, and the storm's own dates
   * and winds are already on screen for anyone who wants to work out which.
   *
   * `null` is the fourth state and is deliberately silent: the walk did not
   * run, so there is nothing to disclose and nothing to claim. */
  const refused = Number.isFinite(facts?.crossingsDeclined) ? facts.crossingsDeclined : 0;
  const refusedNote = refused > 0
    ? absenceHtml(
      `Its track crossed a coast ${refused === 1 ? 'one other time' : `${countWord(refused)} other times`} `
      + 'while it was not a tropical cyclone. This archive does not count that as '
      + 'coming ashore.'
    )
    : '';

  if (!list.length) {
    /* ==> SINCE §57.7a AN EMPTY LIST USUALLY MEANS WHAT IT SAYS, AND THE
     * SENTENCE HAS TO KNOW WHICH KIND OF EMPTY IT IS. <== We compute landfalls
     * ourselves now, so a 1976 storm with none genuinely stayed at sea and the
     * hole paragraph below would be the app apologising for a fact. It is kept
     * for exactly the case it was written for — the computed file not being
     * on screen, which `landfallSource` is the only honest way to detect. */
    if (facts?.landfallSource === 'computed') {
      /* ==> AND ON 26 STORMS THIS SENTENCE ALONE WAS THE MISLEADING PART. <==
       * §57.7e. "This storm did not come ashore" is true by this app's rule and
       * reads as "it stayed at sea", which for these is false. The refusal
       * sentence is what makes the two agree, so it is not optional here. */
      return absenceHtml('This storm did not come ashore.') + refusedNote;
    }

    const inHole = Number.isFinite(facts?.year)
      && facts.year >= markerHoleFrom && facts.year <= markerHoleTo;
    if (inHole) {
      return absenceHtml(
        `NOAA did not mark landfalls in the best track between ${markerHoleFrom} `
        + `and ${markerHoleTo}. This storm may well have come ashore. The record `
        + 'simply does not flag the moment it did.'
      );
    }
    return absenceHtml('NOAA marked no landfall for this storm.');
  }

  /* ==> THE NAMES ARE INDEX-ALIGNED AGAINST THE COMPUTED LIST AND ARE REFUSED
   * IF THEY CANNOT BE. <== §57.40a. The sidecar names the landfalls WE
   * computed. When that file did not arrive, `stormFacts` falls back to NOAA's
   * sparser `L` markers — a different list, in a different order, of a
   * different length — and lining the two up would print Cameron's name beside
   * a Florida landfall. The length check plus `landfallSource` is the whole
   * guard, and dropping to coordinates alone is a real answer rather than a
   * degradation: it is what this panel showed before §57.40 existed, and it is
   * never wrong. */
  const names = places && facts.landfallSource === 'computed'
    && Array.isArray(places.landfalls) && places.landfalls.length === list.length
    ? places.landfalls : null;

  /* ==> THE ROWS RUN IN THE CHART'S ORDER AND THE NAME IS LOOKED UP BY WHERE
   * THE MARK CAME FROM. <== §57.60, §57.40a. `orderedLandfalls` sorts by time
   * and hands back each mark's place in the unsorted list; the names sidecar is
   * index-aligned to that unsorted list, so `index` is what reads it and `n` is
   * what the reader sees. Using one for the other is the mislabelling the
   * length guard above already refuses on a different road. */
  const items = orderedLandfalls(facts).map(({ mark: lf, index, n }) => {
    const where = names?.[index]?.name || null;
    const bits = [utcStamp(lf.time), coords(lf.lat, lf.lon)].filter(Boolean);
    const strength = [
      windWords(lf.windKt, system),
      Number.isFinite(lf.pressureMb) ? formatPressure(lf.pressureMb) : null,
    ].filter(Boolean);
    /* ==> THE NATURE CARRIED ON THE ENTRY, NOT AN ASSUMED `tropical`. <==
     * §57.7c. A post-tropical landfall has no Saffir-Simpson number by design,
     * and hard-coding `tropical` here would have printed a bare dash for it —
     * which reads as "no data" for a storm we know came ashore at 80 mph.
     * `categoryShortLabel` already speaks this vocabulary, so Sandy's New
     * Jersey row says `Post-Trop` in the same words the live storm list uses
     * rather than in a second one invented here. */
    const catRaw = categoryShortLabel(lf.category ?? null, lf.nature || 'tropical', null);
    const cat = catRaw && catRaw !== '—' ? catRaw : null;
    /* ==> THE BADGE IS HIDDEN FROM A SCREEN READER AND A WORD IS READ IN ITS
     * PLACE. <== A bare `1` announced ahead of a place name reads as a list
     * index the reader cannot act on. `Landfall 1` says what the digit is FOR,
     * which is the same thing the chart's caption tells a sighted reader —
     * §57.59's rule that the picture is never the only place a fact lives. */
    return `
      <li class="season-landfall">
        <span class="visually-hidden">Landfall ${n}.</span>
        <span class="season-landfall-n" aria-hidden="true">${n}</span>
        <span class="season-landfall-detail">
          ${where ? `<span class="season-landfall-where">${esc(where)}</span>` : ''}
          <span class="season-landfall-when">${esc(bits.join(' · '))}</span>
          ${cat || strength.length
    ? `<span class="season-landfall-what">${esc([cat, ...strength].filter(Boolean).join(' · '))}</span>`
    : ''}
        </span>
      </li>`;
  }).join('');

  /* ==> THE STRENGTH SHOWN IS THE STRENGTH AT THE COAST, NOT THE PEAK, AND
   * THAT IS THE SAME CALL THE GLOBE MAKES. <== `map/layers/season-points.js`
   * colours a fix by what was actually there rather than by what the storm
   * once was, because Katrina peaked at Cat 5 over water and came ashore at
   * Cat 3.
   * The panel and the globe must agree, or one of them is lying. */
  /* ==> AN `<ol>` RATHER THAN A `<ul>`, WHICH IS THE MOCKUP'S ELEMENT AND THE
   * HONEST ONE. <== §57.60c. Since step 6 the order of these rows is load
   * bearing — it is what the numbers on the chart above refer to — and that is
   * the whole distinction between the two elements. The visually-hidden
   * `Landfall n.` on each row stays: `list-style: none` makes some screen
   * readers drop list semantics entirely, so the number cannot be left to the
   * element to announce. */
  return `<ol class="season-landfalls">${items}</ol>${refusedNote}`;
}

/** Fastest intensification, and how it ended. §57.15. */
export function changeHtml(facts, system, { windowHours, comebackHtml = '' }, marks = null) {
  const rows = [];
  let riNote = null;
  /* ==> `fastest24h`, NOT `fastest`, AND THIS ONE WORD MEANT THE SECTION HAD
   * NEVER RENDERED. <== `lib/season-facts.js` writes `fastest24h`; this file
   * asked for `fastest` and got `undefined` on every storm since step 7, so
   * `Fastest strengthening`, `Began` and the rapid-intensification sentence
   * have never once been on screen. `How it changed` was the ending sentence
   * and nothing else, on every storm in 175 years. Aaron spotted it on glass
   * (Katrina, 2026-08-29) as the section reading thin.
   *
   * ==> AND `tools/test-season-detail.mjs` WAS GREEN OVER IT, BECAUSE IT
   * HAND-BUILT ITS OWN FACTS OBJECT USING THE WRONG NAME. <== §12's failure —
   * a test that passes on the same wrong assumption as the bug is worse than
   * no test. It drives real `stormFacts` output now, so the two names cannot
   * drift apart again without something going red. */
  const f = facts?.fastest24h;
  /* ==> A NEGATIVE OR ZERO "FASTEST GAIN" IS A WEAKENING STORM AND IS NOT
   * SHOWN. <== `season-facts` reports the best window it found, and for a
   * storm that only ever weakened that is a loss. Labelling a loss
   * "intensification" would be wrong, and showing it as zero would imply a
   * measurement rather than an absence.
   *
   * ==> NO STORM IN THE SETTLED RECORD CAN REACH THIS BRANCH, AND IT STAYS
   * ANYWAY. <== Measured 2026-08-25 across all 3,266 mirrored storms: **zero**
   * have a best 24-hour window that is a loss, because a storm's first record
   * is near its weakest and almost anything after it is a gain. So this is not
   * dead code kept out of caution — it guards **the season still running**,
   * which arrives from ATCF b-decks rather than HURDAT2 (§57.11) and is not
   * what that measurement covers. A storm caught mid-decay by an operational
   * feed is exactly the shape that produces it.
   *
   * `tools/test-season-detail.mjs` drives it directly, because there is no
   * real example to find. */
  if (f && Number.isFinite(f.gainKt) && f.gainKt > 0) {
    /* ==> THIS ONE SPAN IS SAID IN HOURS RATHER THAN THROUGH `spanWords`, AND
     * THE SENTENCE TWO ROWS DOWN IS WHY. <== The window is capped at
     * `intensificationWindowHours`, so `spanWords` renders the common case as
     * "1 day" — directly above a line reading "the 30 kt in 24 hours that
     * forecasters call rapid intensification". Two ways of saying the same
     * duration, three lines apart, reads as two different measurements. It is
     * always hours here, and the number is interpolated rather than typed.
     *
     * Only visible from 2026-08-29: the whole block had never rendered (see
     * `fastest24h` above), so nobody had ever seen these two lines together. */
    rows.push({
      key: 'fastest24hGainKt',
      label: 'Fastest strengthening',
      value: `${Math.round(f.gainKt)} kt in ${Math.round(f.hours)} hours`,
    });
    rows.push({ label: 'Began', value: utcStamp(f.fromTime) });
    /* Rapid intensification has an agreed threshold, and naming it is the
     * difference between a number and a fact the reader can place.
     *
     * ==> IT IS A SENTENCE AND IT LEFT THE ROW LIST, BECAUSE A ROW WITH NO
     * LABEL IS NOT A ROW. <== §57.55. It was pushed as `['', 'That meets…']`,
     * and the row renderer drops a row on its VALUE being empty and never
     * looks at
     * the key — so the pair survived into `<dt></dt><dd>the whole
     * sentence</dd>`. `.detail-vitals` is `grid-template-columns: auto 1fr`,
     * so the sentence rendered inside the value column, indented behind
     * whatever width `Fastest strengthening` had already claimed. At 390px
     * that is a full sentence in a half-width gutter, on 945 of the 3,266
     * storms in the archive. On screen since 2026-08-29, when the
     * `fastest24h` fix above made this block render for the first time.
     *
     * `.detail-note` is the right home rather than a workaround: the style's
     * own rule is a caveat about the figure beside it, quieter than the
     * numbers, and that is exactly what this sentence is about the row
     * directly above it. */
    riNote = (f.gainKt >= SEASONS.rapidIntensificationKt && f.hours <= windowHours)
      ? `That meets the ${SEASONS.rapidIntensificationKt} kt in ${windowHours} `
        + 'hours that forecasters call rapid intensification.'
      : null;
  }

  /* ==> THE SECTION IS IN TIME ORDER AND `comebackHtml` HAS TO LAND INSIDE IT.
   * <== §57.48. Strengthening, then what it gave up at the coast, then the
   * comeback. It arrives already built rather than being computed here,
   * because this file was 19 lines under §12's ceiling — see
   * `ui/season-shape-markup.js`. An empty string is the ordinary case: 14
   * storms in 3,266 have a comeback.
   *
   * The rapid-intensification sentence goes first among the sentences because
   * it belongs to the strengthening figures immediately above it, and the
   * order here is the order things happened.
   *
   * ==> THE ENDING SENTENCE USED TO CLOSE THIS AND IT IS `endingHtml` NOW.
   * <== §57.54f, §57.61. Step 7 merges this block into `How hard it blew` and
   * puts the ending under `How long it lasted`, where a storm's finish belongs
   * next to how long it ran. A renderer cannot be composed into two different
   * sections while it emits both, so the sentence was lifted out first, as its
   * own commit with the panel byte-identical. */
  return figureRowsHtml(rows, marks)
    + absenceHtml(riNote)
    + absenceHtml(coastalWeakeningWords(facts?.coastalWeakening, system))
    + comebackHtml;
}

/**
 * How the storm finished. §57.15, §57.54f, §57.61.
 *
 * ==> IT IS ITS OWN RENDERER BECAUSE IT ANSWERS A DIFFERENT QUESTION FROM THE
 * ROWS IT USED TO SIT UNDER. <== `changeHtml` is about how hard a storm blew
 * and how fast it got there; this is the last thing that happened to it, and
 * §57.54f puts it under `How long it lasted` beside the first-seen, last-seen
 * and lifespan figures it actually belongs to.
 *
 * ==> AN ENDING THIS PANEL HAS NO WORDS FOR SAYS NOTHING, AND THAT IS NOT
 * HYPOTHETICAL. <== Counted across all 3,266 storms in `seasons/data/`,
 * 2026-08-30: 1,949 dissipated, 804 extratropical, 502 remnant low, and
 * **11 fall through to `unknown`** — 10 whose last record is `DB` and 1 whose
 * last record is `WV`, storms that ran down into a disturbance or a wave
 * rather than into any of the three endings `lib/season-facts.js` names. They
 * printed nothing before this extraction and they print nothing after it.
 *
 * ==> THE FIRST VERSION OF THIS COMMENT SAID 6,532 STORMS AND 22 UNKNOWNS,
 * AND BOTH WERE EXACTLY DOUBLE. <== The count read every `.txt` in
 * `seasons/data/`, which also holds two whole-basin `hurdat2-*.txt` files
 * carrying every storm a second time. **Only the `basin-YYYY-` files are one
 * storm each.** The tell was in the figure itself: 6,532 is twice 3,266, and
 * 3,266 is the denominator this panel prints in its own footnote.
 *
 * ==> SILENCE IS THE RIGHT ANSWER HERE AND §5 IS WHY, NOT DESPITE IT. <== The
 * rule bans an absence a reader would misread as a fact. Nothing on this
 * section claims to say how every storm ended, `Last seen` and `Lifespan` are
 * both still printed above it, and inventing a fourth sentence would be this
 * panel guessing at a status HURDAT2 did record and we chose not to word.
 * **Whether those 11 deserve their own sentence is a product call nobody has
 * made** — §57.61a records it as open rather than as a gap.
 *
 * @returns {string} HTML, or '' when the record does not say
 */
export function endingHtml(facts) {
  const ENDINGS = {
    extratropical: 'Became extratropical. It lost its tropical structure and '
      + 'carried on as an ordinary storm system.',
    dissipated: 'Dissipated. The record simply stops.',
    remnant_low: 'Weakened to a remnant low.',
  };
  return absenceHtml(ENDINGS[facts?.ending] || null);
}

/**
 * How much the storm gave up between its strongest moment and the coast.
 * §57.43, `coastalWeakening` in `lib/season-facts.js`.
 *
 * ==> IT IS A SENTENCE RATHER THAN A ROW, AND THAT IS BECAUSE IT IS A
 * COMPARISON. <== `Weakened before landfall — 46 mph` is a figure the reader
 * then has to reassemble into the thing they actually wanted to know, which is
 * that a Category 5 arrived as a Category 3. The two numbers only mean
 * anything next to each other, so they are said next to each other.
 *
 * ==> AND ZERO GETS ITS OWN SENTENCE INSTEAD OF BEING DROPPED. <== §57.25 bans
 * a row reading `0`, because a zero in a value slot is a shrug. But "it came
 * ashore at its strongest" is not an absence — it is the most alarming thing
 * this section can say, and it is the case for 703 of the 1,341 storms in the
 * archive that came ashore at a gradeable strength.
 *
 * ==> THE MIDDLE CASE EXISTS BECAUSE A DROP IN WIND IS NOT ALWAYS A DROP IN
 * CATEGORY. <== 150 kt to 140 kt is ten knots gone and still a Category 5 at
 * the coast. Naming the same category twice in one sentence reads as a
 * misprint, so that case states the wind and the surviving category instead.
 *
 * @returns {string|null}  a sentence, or null when there is nothing to say
 */
export function coastalWeakeningWords(cw, system) {
  if (!cw || !Number.isFinite(cw.dropKt) || !Number.isFinite(cw.peakWindKt)) return null;

  if (cw.dropKt === 0) {
    return 'It came ashore at its strongest. It had not weakened at all before it hit.';
  }

  /* ==> `formatWind` ON A DIFFERENCE, DELIBERATELY. <== Wind is a linear
   * conversion with no offset, so the gap between two speeds converts exactly
   * the way the speeds do, and using the same formatter means the figure here
   * can never disagree with the peak and landfall numbers on the same panel. */
  const gap = formatWind(cw.dropKt, system);
  const was = categoryPhrase(cw.peakCategory);
  const landed = categoryPhrase(cw.landfallCategory);

  /* ==> NO EM DASH ANYWHERE NEAR A WIND FIGURE. <== `lib/units.js` returns a
   * bare em dash as its MISSING sentinel, so a sentence carrying one
   * decoratively is a sentence where a failed conversion would hide in plain
   * sight. `lib/season-story.js` bans the character outright for exactly this
   * reason and the ban only works if nothing writes one for punctuation. */
  if (cw.categoriesDropped > 0 && was && landed) {
    return `It had been ${was} before its hardest landfall and came ashore `
      + `${landed}, ${gap} weaker.`;
  }
  return landed
    ? `It gave up ${gap} between its strongest point and its hardest landfall, `
      + `but it was still ${landed} when it came ashore.`
    : `It gave up ${gap} between its strongest point and its hardest landfall.`;
}

/**
 * NHC's written report on this storm, or why there is none. §57.22, §57.22a.
 *
 * ==> THREE STATES AND THEY SAY THREE DIFFERENT THINGS. <== §5. The one worth
 * spelling out is the difference between the second and the third: *no report
 * was written* is a fact about the record, and *we could not check* is a fact
 * about this moment. Saying the first when the second is true would state
 * something false about a storm whose report exists — the all-clear-during-an-
 * outage bug, at the size of one link.
 *
 * ==> AND THE ABSENCE IS THE COMMON CASE, NOT THE EDGE ONE. <== NOAA wrote
 * these for roughly a sixth of the storms in the record and none at all before
 * 1958, so on most of the archive this row IS the report section. §57.25 rule
 * 2: it names the era rather than shrugging, because *"NOAA did not write these
 * before 1958"* teaches something true and *"no report"* teaches nothing.
 *
 * @param {object} report  the answer from `data/season-reports.js`
 * @param {number} year    the storm's year, for the era sentence
 * @param {number} firstYear  the earliest year any report exists for
 */
export function reportHtml(report, year, firstYear) {
  if (!report || report.state === 'loading') {
    return absenceHtml('Checking whether NOAA wrote a report on this storm…');
  }

  if (report.state === 'unknown') {
    /* ==> IT GETS A RETRY, BECAUSE THIS ONE CAN ACTUALLY SUCCEED. <== §5 asks
     * every error state for a recovery action, and the distinction this panel
     * draws is whether pressing it could ever work. A storm from 1851 gets no
     * button; a lookup that failed on a train does. */
    return `<p class="detail-note">The list of NOAA reports could not be
        reached, so this storm may or may not have one.</p>
        <button class="seasons-retry" type="button" data-retry="report">Try again</button>`;
  }

  if (report.state === 'has') {
    return `<p class="detail-note">NOAA published a written report on this
        storm: the full account, with the meteorology and the damage.</p>
        <a class="season-report-link" href="${esc(report.url)}"
           target="_blank" rel="noopener noreferrer">
          Read NOAA's report<span class="season-report-ext" aria-hidden="true"></span>
          <span class="visually-hidden"> (opens on nhc.noaa.gov in a new tab)</span>
        </a>`;
  }

  const beforeEra = Number.isFinite(year) && Number.isFinite(firstYear) && year < firstYear;
  return absenceHtml(beforeEra
    ? `NOAA did not begin writing these reports until ${firstYear}, so there is `
      + 'none for this storm.'
    : 'NOAA did not write a report on this storm. They are written for the '
      + 'storms that mattered most, not for every one.');
}

/* ---------------------------------------------------------------------------
 * THE STATES THAT ARE NOT A STORM
 * ------------------------------------------------------------------------ */

/** Asked for a storm the season does not hold. Reachable from a stale deep
 *  link and from a season change with a panel open. */
export function noStormHtml() {
  return `<p class="detail-note">That storm is not in this season.</p>`;
}
