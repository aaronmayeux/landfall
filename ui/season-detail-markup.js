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
import { formatWind, formatPressure } from '../lib/units.js';
/* Every "…" in this app pulses through one helper, so a waiting line reads as
 * thinking rather than as a full stop that lost its way.
 * `tools/test-loading-dots.mjs` fails the build on a stray one — it caught this
 * file's report line, and stayed red on `main` for the whole time step 7 was
 * reverted. */
import { dotted } from './loading-dots.js';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------------------------------------------------------------------
 * SMALL FORMATTERS
 *
 * ==> EVERY ONE OF THESE RETURNS null RATHER THAN A DASH. <== The caller then
 * omits the row entirely, which is the rule the live panel already follows and
 * the reason it never shows an empty pair. A dash is a value that means
 * nothing; no row means no claim.
 * ------------------------------------------------------------------------ */

/** UTC, always, and it says so. ==> THE STORM'S OWN TIME ZONE IS NOT
 *  KNOWABLE AND THE READER'S IS THE WRONG ONE. <== HURDAT2 is stamped in UTC;
 *  rendering an 1893 Louisiana landfall in the reader's local clock would put
 *  a Gulf hurricane ashore at a time nobody in Louisiana experienced, and
 *  worse, the offset would depend on where the reader happens to be sitting.
 *  The live app shows local time because a live storm is about the reader's
 *  next few hours. History is not. */
const UTC = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
});

export function utcStamp(ms) {
  if (!Number.isFinite(ms)) return null;
  return `${UTC.format(new Date(ms))} UTC`;
}

const UTC_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
});

export function utcDay(ms) {
  if (!Number.isFinite(ms)) return null;
  return UTC_DAY.format(new Date(ms));
}

/** `23.1, -75.1` → `23.1°N 75.1°W`. Hemisphere letters rather than signs,
 *  because a minus sign in front of a longitude is a programmer's convention
 *  and this panel is read by a person. */
export function coords(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew}`;
}

/**
 * Hours as a phrase a person would say.
 *
 * Days once it is past a day, because "138 hours at hurricane strength" is a
 * number the reader has to divide, and the thing they want to know is that it
 * was most of a week.
 */
export function spanWords(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return null;
  if (hours < 24) {
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const days = hours / 24;
  const whole = Math.floor(days);
  const rest = Math.round(hours - whole * 24);
  if (rest === 0) return `${whole} day${whole === 1 ? '' : 's'}`;
  return `${whole} day${whole === 1 ? '' : 's'}, ${rest} hour${rest === 1 ? '' : 's'}`;
}

/** Wind in the reader's units with the knots beside it, the same shape the
 *  live Vitals row uses — knots are the number the record is actually in, and
 *  a reader comparing against NOAA's own page needs to see it. */
export function windWords(kt, system) {
  if (!Number.isFinite(kt)) return null;
  return `${formatWind(kt, system)} (${Math.round(kt)} kt)`;
}

/* ---------------------------------------------------------------------------
 * ROWS
 * ------------------------------------------------------------------------ */

/**
 * A definition list, or '' when there is nothing to say.
 *
 * ==> ROWS ARRIVE AS PAIRS AND THE VALUE IS ESCAPED HERE. <== The same rule
 * and the same reason as the live panel's `detail-vitals`: a row never hands
 * over raw HTML, so a storm name reaching this one refactor from now cannot
 * be treated as markup.
 */
export function rowsHtml(rows) {
  const real = (rows || []).filter(([, v]) => v != null && v !== '');
  if (!real.length) return '';
  return `<dl class="detail-vitals">${real
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
    .join('')}</dl>`;
}

/**
 * A §57.25 rule 2 sentence — the record is silent and here is why. Styled as
 * a note rather than as an error, because it is neither a failure nor a
 * warning: it is a fact about 1851.
 *
 * ==> THE DOTS ARE APPLIED HERE, AFTER THE ESCAPE, AND THAT ORDER IS THE
 * WHOLE POINT. <== The first version of this panel called
 * `absenceHtml(dotted('Checking…'))`, which handed a `<span class="dots">` to
 * `esc()` — so the waiting line would have rendered with visible angle
 * brackets on screen. It was never seen, because step 7 was reverted before
 * anybody opened the panel. Doing it in here means no call site can get the
 * order wrong, and `loading-dots.js`'s own rule makes it safe: escaping never
 * produces a `…`, and a trailing `…` in this app means "still working" and
 * nothing else.
 */
export function absenceHtml(text) {
  return text ? `<p class="detail-note">${dotted(esc(text))}</p>` : '';
}

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
export function peakHtml(facts, system) {
  if (facts?.missing?.wind) {
    return absenceHtml(
      'No wind speed was ever recorded for this storm. That is ordinary for the '
      + '19th century — the record holds where it went, not how strong it was.'
    );
  }
  return rowsHtml([
    ['Peak winds', windWords(facts.peakWindKt, system)],
    ['Reached', utcStamp(facts.peakTime)],
    ['Where', coords(facts.peakLat, facts.peakLon)],
    ['Lowest pressure', Number.isFinite(facts.lowestPressureMb)
      ? formatPressure(facts.lowestPressureMb) : null],
    ['Measured', Number.isFinite(facts.lowestPressureMb)
      ? utcStamp(facts.lowestPressureTime) : null],
  ]) + (facts?.missing?.pressure
    ? absenceHtml('No pressure reading survives for this storm.')
    : '');
}

/** Lifespan and time at strength. §57.15. */
export function lifeHtml(facts) {
  const rows = [
    ['First seen', utcDay(facts.firstTime)],
    ['Last seen', utcDay(facts.lastTime)],
    ['Lifespan', spanWords(facts.lifespanHours)],
  ];
  /* ==> ZERO HOURS AT HURRICANE STRENGTH IS OMITTED, NOT SHOWN AS ZERO. <==
   * A tropical storm that never became a hurricane is not "0 days at hurricane
   * strength" — that phrasing invites the reader to wonder what went wrong.
   * It simply never was one, and the peak figure above already says so.
   *
   * ==> AND THESE TWO GUARDS ARE BELT-AND-BRACES RATHER THAN THE MECHANISM.
   * <== Written down because a mutation run on 2026-08-25 proved it: removing
   * them changes nothing, because `spanWords` answers null for zero and
   * `rowsHtml` already drops any row whose value is null. The rule is enforced
   * once, in `rowsHtml`, for every row on this panel. These stay as the
   * clearer statement of intent at the call site — but nobody should believe
   * they are load-bearing, and a comment implying they were would be worse
   * than no comment. */
  const hur = spanWords(facts.hoursAtHurricane);
  const maj = spanWords(facts.hoursAtMajor);
  if (hur) rows.push(['At hurricane strength', hur]);
  if (maj) rows.push(['At major strength', maj]);

  /* ACE, and it is stated with its own caveat rather than as a bare number.
   * ==> IT IS COMPUTED FROM SYNOPTIC RECORDS ONLY AND A STORM WITH FEW OF
   * THEM HAS A LOW FIGURE FOR A REASON THAT IS NOT ABOUT THE STORM. <== The
   * count is shown so the reader can see the difference between a quiet storm
   * and a thinly observed one, which is the whole difference between 1885 and
   * 2005. */
  if (Number.isFinite(facts.ace) && facts.aceRecords > 0) {
    rows.push(['ACE', `${facts.ace.toFixed(1)} × 10⁴ kt²`]);
    rows.push(['From', `${facts.aceRecords} six-hourly observation${facts.aceRecords === 1 ? '' : 's'}`]);
  }

  return rowsHtml(rows);
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
 */
export function landfallsHtml(facts, system, { markerHoleFrom, markerHoleTo }) {
  const list = facts?.landfalls || [];

  if (!list.length) {
    /* ==> SINCE §57.7a AN EMPTY LIST USUALLY MEANS WHAT IT SAYS, AND THE
     * SENTENCE HAS TO KNOW WHICH KIND OF EMPTY IT IS. <== We compute landfalls
     * ourselves now, so a 1976 storm with none genuinely stayed at sea and the
     * hole paragraph below would be the app apologising for a fact. It is kept
     * for exactly the case it was written for — the computed file not being
     * on screen, which `landfallSource` is the only honest way to detect. */
    if (facts?.landfallSource === 'computed') {
      return absenceHtml('This storm did not come ashore.');
    }

    const inHole = Number.isFinite(facts?.year)
      && facts.year >= markerHoleFrom && facts.year <= markerHoleTo;
    if (inHole) {
      return absenceHtml(
        `NOAA did not mark landfalls in the best track between ${markerHoleFrom} `
        + `and ${markerHoleTo}. This storm may well have come ashore — the record `
        + 'simply does not flag the moment it did.'
      );
    }
    return absenceHtml('NOAA marked no landfall for this storm.');
  }

  const items = list.map((lf) => {
    const bits = [utcStamp(lf.time), coords(lf.lat, lf.lon)].filter(Boolean);
    const strength = [
      windWords(lf.windKt, system),
      Number.isFinite(lf.pressureMb) ? formatPressure(lf.pressureMb) : null,
    ].filter(Boolean);
    const catRaw = lf.category != null ? categoryShortLabel(lf.category, 'tropical', null) : null;
    const cat = catRaw && catRaw !== '—' ? catRaw : null;
    return `
      <li class="season-landfall">
        <span class="season-landfall-when">${esc(bits.join(' · '))}</span>
        ${cat || strength.length
    ? `<span class="season-landfall-what">${esc([cat, ...strength].filter(Boolean).join(' · '))}</span>`
    : ''}
      </li>`;
  }).join('');

  /* ==> THE STRENGTH SHOWN IS THE STRENGTH AT THE COAST, NOT THE PEAK, AND
   * THAT IS THE SAME CALL THE GLOBE MAKES. <== `map/layers/season-points.js`
   * colours a fix by what was actually there rather than by what the storm
   * once was, because Katrina peaked at Cat 5 over water and came ashore at
   * Cat 3.
   * The panel and the globe must agree, or one of them is lying. */
  return `<ul class="season-landfalls">${items}</ul>`;
}

/** Fastest intensification, and how it ended. §57.15. */
export function changeHtml(facts, system, { windowHours }) {
  const rows = [];
  const f = facts?.fastest;
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
    rows.push(['Fastest strengthening', `${Math.round(f.gainKt)} kt in ${spanWords(f.hours)}`]);
    rows.push(['Began', utcStamp(f.fromTime)]);
    /* Rapid intensification has an agreed threshold, and naming it is the
     * difference between a number and a fact the reader can place. */
    if (f.gainKt >= SEASONS.rapidIntensificationKt && f.hours <= windowHours) {
      rows.push(['', `That meets the ${SEASONS.rapidIntensificationKt} kt in `
        + `${windowHours} hours that forecasters call rapid intensification.`]);
    }
  }

  const ENDINGS = {
    extratropical: 'Became extratropical — it lost its tropical structure and '
      + 'carried on as an ordinary storm system.',
    dissipated: 'Dissipated. The record simply stops.',
    remnant_low: 'Weakened to a remnant low.',
  };
  const ending = ENDINGS[facts?.ending] || null;

  return rowsHtml(rows) + (ending ? absenceHtml(ending) : '');
}

/**
 * The wind field, and what it cannot say. §57.25 rule 2, §57.26a.
 *
 * Shares its wording rule with the roster's footprint note so the two can
 * never disagree — a reader who saw one sentence on the board and a different
 * one here would reasonably conclude the app does not know.
 */
export function windFieldHtml(facts, { firstSeason }) {
  if (!facts?.missing?.windField) {
    return absenceHtml(
      'The footprint on the globe is the ground that ever saw 34, 50 or 64 knot '
      + 'winds over this storm\u2019s whole life. Tap the storm\u2019s track to see it.'
    );
  }
  const era = Number.isFinite(facts.year) && facts.year < firstSeason;
  return absenceHtml(era
    ? `Wind field size wasn\u2019t recorded before ${firstSeason}, so there is no `
      + 'footprint to draw for this storm.'
    : 'No wind field was recorded for this storm, so there is no footprint to draw.');
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
        storm — the full account, with the meteorology and the damage.</p>
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
