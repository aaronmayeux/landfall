/**
 * season-rank-markup.js — the two rank sections on the archive's storm panel.
 * SPEC-SEASONS-BUILD.md §57.43, §57.44, SPEC.md §12.
 *
 * ==> A CUT TAKEN IN THE PASS THAT CAUSED IT, NOT DEFERRED TO THE NEXT ONE.
 * <== §12's ceiling is ~700 lines. `ui/season-detail-markup.js` went into
 * §57.44 at 698 and came out at 824, entirely because the archive-wide ranking
 * section landed in it. `NOW.md` records `ui/view-seasons-board.js` crossing
 * that ceiling on five consecutive passes with the cut promised each time and
 * taken later at a bigger size, so this one is taken now.
 *
 * ==> THE SEAM IS "RANKING", AND IT IS A REAL ONE RATHER THAN A LINE COUNT.
 * <== Both functions here answer the same question — where does this storm
 * stand — at two sizes, one against its season and one against the archive.
 * They are the only two renderers on the panel that take a comparison rather
 * than a fact, and they are the only two that need `ordinal`, which comes with
 * them. Nothing else in the panel imports any of it.
 *
 * ==> NO BEHAVIOUR CHANGED IN THE MOVE. <== Deliberately, so a break can only
 * be the move itself. `tools/test-rankings.mjs` and `tools/test-season-detail.mjs`
 * both drive these functions and both were green before and after.
 *
 * Imports config/ and lib/. No DOM, no network, no clock.
 */

import { SEASONS } from '../config/constants.js';
/* ==> THE COUNT IS SPELLED OUT BY THE APP'S ONE OPINION ABOUT COUNTS, NOT BY
 * A SECOND LIST HERE. <== §57.50. Aaron's rule is that counts are words and
 * durations are digits, and `lib/season-story.js` already owns the words the
 * storm-life paragraph says them with. A copy in this file would agree today
 * and drift the moment either was touched, and the two sentences sit two
 * sections apart on the same panel. */
import { countWord } from '../lib/season-story.js';
import { formatDistance, formatPressure, formatWind } from '../lib/units.js';
import { absenceHtml, rowsHtml, spanWords, utcDay } from './season-markup-bits.js';
import { figureRowsHtml } from './season-figure-row.js';
import { spineHtml } from './season-spine.js';
import { toRung } from '../lib/rankings.js';

/**
 * `3` → `3rd`. The teens are the whole reason this is a function: 11, 12 and
 * 13 take `th` while 1, 2 and 3 take `st`, `nd`, `rd`, and a season with 31
 * storms reaches every one of those cases.
 */
export function ordinal(n) {
  if (!Number.isInteger(n) || n < 1) return null;
  const teen = n % 100;
  /* ==> GROUPED, BECAUSE THE ARCHIVE RANKS REACH FOUR DIGITS. <== §57.44. A
   * season tops out around 31 and never needed it; ranking against 3,266
   * storms produces `1034th`, which reads as a serial number rather than a
   * place. The suffix rule is unchanged — it is decided from the digits, and
   * the separator is added after. */
  const g = n.toLocaleString();
  if (teen >= 11 && teen <= 13) return `${g}th`;
  const last = n % 10;
  return `${g}${last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'}`;
}

/**
 * Where this storm stood among the storms it shared a season with. §57.43.
 *
 * ==> RANKS SHARE A PLACE, BECAUSE THE RECORD IS WRITTEN IN FIVE-KNOT STEPS.
 * <== 54 of the archive's 294 seasons have a tied strongest storm. Printing an
 * outright winner where two storms drew would be the app stating something the
 * record does not support, and the reader who looks up the other one finds the
 * same claim made twice.
 *
 * @param {object|null} rank  from `rankInSeason` in `lib/season-facts.js`
 */
export function seasonRankHtml(rank) {
  if (!rank) return '';

  const place = (r, superlative, comparative) => {
    if (!r || !Number.isInteger(r.rank)) return null;
    const ord = ordinal(r.rank);
    const word = r.rank === 1 ? superlative : `${ord} ${comparative}`;
    /* `tied` counts this storm too, so two storms sharing a place is 2. */
    const head = r.tied > 1 ? `Tied ${word.charAt(0).toLowerCase()}${word.slice(1)}` : word;
    return `${head} of ${r.of}`;
  };

  const rows = [
    ['Strength', place(rank.strength, 'Strongest', 'strongest')],
    ['Lifespan', place(rank.lifespan, 'Longest-lived', 'longest-lived')],
  ];

  /* ==> ONLY SAID WHEN IT IS TRUE OF THIS STORM. <== `rankInSeason` checks the
   * id, so a season with one major does not put this sentence on the other
   * twenty storms in it. */
  const only = rank.onlyMajor
    ? absenceHtml('It was the only major hurricane of its season.')
    : '';

  return rowsHtml(rows) + only;
}

/**
 * How many other storms were running beside this one. §57.50, §57.42 Tier 1
 * item 10.
 *
 * ==> IT IS A SENTENCE RATHER THAN A ROW, AND THE ROW VERSION IS WHY. <==
 * `Storms at once — 5` is a value that carries no meaning without its label
 * and still leaves out the date that makes it checkable. §57.25 bans exactly
 * that shape, and the two §57.48 sentences in this same section already
 * settled the question for facts of this kind.
 *
 * ==> IT SAYS NOTHING WHEN THE STORM WAS ALONE, WHICH IS 1,267 OF 3,266. <==
 * Measured 2026-08-29 — 1,243 storms looked at and found alone, plus the 24
 * one-storm seasons there is nothing to compare in. 38.8%. *"No other storm was running at
 * the same time"* would be a non-event stated on four storms in ten, and the
 * panel is already crowded at nine sections. Silence here is the ordinary
 * case, not a gap — `seasonCompany` has already distinguished a real zero from
 * a season it could not compare, and neither one has anything to say.
 *
 * ==> IT DOES NOT NAME THE OTHER STORMS. <== Considered and dropped: 1,351 of
 * the archive's 3,266 storms have no name at all, so about a third of any list
 * would read *"Ginger, Edith and two unnamed storms"*, and at the archive's
 * busiest — six others at once, 13 September 1971 — the sentence runs longer
 * than everything else in the section put together. The roster is one tap away
 * and already lists them.
 *
 * ==> AND IT SAYS "IN THE SAME BASIN" RATHER THAN "IN THE ATLANTIC". <== The
 * archive loads one basin at a time, so an unqualified count would be a claim
 * about the whole planet and it would be wrong — the East Pacific was busy on
 * most of these days too. Naming the basin would mean plumbing a label from
 * `seasons/index.json` down to this function; saying *"the same basin"* is the
 * wording the two §57.48 sentences in this section already use, costs no
 * plumbing, and stays correct on the day step 13 adds basins nobody has
 * labelled yet.
 *
 * @param {object|null} c  from `seasonCompany` in `lib/season-company.js`
 * @returns {string}  HTML, or '' when the storm was alone or there was nothing
 *   to compare it against
 */
export function seasonCompanyHtml(c) {
  if (!Number.isFinite(c?.peak) || c.peak < 1) return '';
  const day = utcDay(c.dayMs);
  if (!day) return '';

  return absenceHtml(c.peak === 1
    ? `One other storm in the same basin was running at the same time, on ${day}.`
    : `${countWord(c.peak).charAt(0).toUpperCase()}${countWord(c.peak).slice(1)} other `
      + `storms in the same basin were running at the same time, on ${day}.`);
}

/**
 * Where this storm stands against the whole archive. §57.44, §57.57.
 *
 * ==> §57.44 BUILT THIS AS ONE SECTION AND STEP 3 REVERSED THAT, ON
 * MEASUREMENT RATHER THAN ON TASTE. <== It refused to glue ranks onto the
 * existing rows for two stated reasons, and §57.54b answers both. *"The scope
 * sentence would have to be repeated six times or left off entirely"* — it is
 * neither: it is one footnote at the foot of the panel, governing every rank
 * on screen at once, which is stronger than six copies. *"`Lowest pressure`
 * would become a row whose value ran to two lines on a 390px phone"* — it
 * already did. `NOW.md` recorded each rank row wrapping to THREE lines at
 * 390px, and folding removes the duplicate label, so it saves height rather
 * than costing it.
 *
 * ==> THE BASIN COMES FIRST IN EVERY SENTENCE AND THE ARCHIVE SECOND. <==
 * Aaron's call, 2026-08-29. One basin is one agency, one set of instruments
 * and one span of coverage, so it is the comparison that is honest without
 * qualification. The cross-basin figure is the one a reader actually wants and
 * the one carrying the caveats, so it earns its place but not the front of the
 * sentence.
 *
 * ==> AND NOTHING HERE EVER SAYS "ON RECORD". <== §57.44. The set behind
 * `overall` is two NHC basins today and will be most of the planet after step
 * 13. A reader who saw "3rd lowest on record" this year and "31st lowest on
 * record" next year, about the same storm, would reasonably conclude the app
 * broke. The count is in the row and the membership is in the footnote, so
 * both widen when the data does and neither ever silently changes meaning.
 */

/* ---------------------------------------------------------------------------
 * THE AXIS — what the two ends of a distribution bar say
 * ------------------------------------------------------------------------ */

/**
 * ==> THE AXIS LABELS LIVE HERE AND NOT IN `RANK_STATS`, AND §57.54k IS WHY.
 * <== `lib/rankings.js` is at 477 lines and should gain nothing from this
 * build: the bar reads a ladder that file already exports. More to the point,
 * these are RENDERING decisions — which unit the reader sees, whether a
 * duration is spelled in days — and `lib/` deciding them would put the panel's
 * wording behind a data module.
 *
 * ==> EVERY ONE OF THEM PRINTS THE END IN THE SAME UNITS AS THE ROW ABOVE IT.
 * <== That is the whole contract. A row reading `173 mph (150 kt)` over a bar
 * whose ends said `25` and `165` would be two different measurements stacked
 * on top of each other, which is the exact fault §57.54a found in the panel
 * this build exists to fix.
 *
 * ==> AND THE LADDER'S OWN UNITS ARE NOT ALWAYS THE ROW'S UNITS. <== The wind
 * ladders are in KNOTS and the row leads with mph or km/h, so the axis
 * converts. The two distance ladders are already in miles and kilometres —
 * §57.46 built them that way — so the axis must NOT convert, and handing a
 * mile figure to `formatDistance` (which takes nautical miles) would inflate
 * the far end by 15%. §57.54c records that exact fault happening to the marker
 * on the prototype.
 */
const AXIS = Object.freeze({
  peakWindKt: (kt, system) => formatWind(kt, system),
  /* ==> PRESSURE IS THE ONE BAR WHERE LOW IS STRONG, AND IT SAYS SO IN WORDS.
   * <== §57.54c. Every other bar reads low-to-high left-to-right and needs no
   * note; adding one everywhere would make this case invisible again. */
  lowestPressureMb: (mb) => formatPressure(mb),
  /* `spanWords` returns null at or below zero, and the lifespan ladder starts
   * at 0 hours — a storm with a single recorded fix. The end label is the
   * ladder's real floor, so it is spelled rather than dropped. */
  lifespanHours: (h) => (h > 0 ? spanWords(h) : '0 hours'),
  hoursAtMajor: (h) => (h > 0 ? spanWords(h) : '0 hours'),
  /* ACE has no unit and §57.54e is where it gets its plain-English name. Here
   * it is the bare figure, printed the way `lifeHtml` prints it. */
  ace: (v) => v.toFixed(1),
  /* A GAIN, not a speed. `formatWind` would print it as mph, and "58 mph in 24
   * hours" reads as how fast the storm travelled. Knots is what the row says. */
  fastest24hGainKt: (kt) => `${Math.round(kt)} kt`,
  trackDistanceMi: (mi) => `${Math.round(mi).toLocaleString()} mi`,
  trackDistanceKm: (km) => `${Math.round(km).toLocaleString()} km`,
});

/** Words appended to an end label where the direction of the bar is not
 *  obvious from the numbers alone. Pressure only, and §57.54c says why. */
const AXIS_NOTES = Object.freeze({
  lowestPressureMb: { low: '(strongest)', high: '(weakest)' },
});

/**
 * The bar under one ranked row, or '' when it cannot be drawn.
 *
 * ==> IT IS DRAWN AGAINST THE BASIN LADDER, NOT THE ARCHIVE-WIDE ONE, AND
 * §57.54k FLAGGED THIS IN ADVANCE AS THE THING MOST LIKELY TO COME BACK WRONG.
 * <== The row's text cites the basin AND the overall count; the bar can only
 * show one population. The basin is the honest comparison — one agency, one
 * set of instruments, one span of coverage — and it is the one the row states
 * first, so the bar follows the front of the sentence. **If it reads as a
 * mismatch on glass the lever is barring the `all` ladder instead, and that is
 * a glass call rather than a rewrite.**
 */
function spineFor(row, system) {
  const axis = AXIS[row.key];
  if (typeof axis !== 'function') return '';
  const own = row.places.find((p) => p.scope.key !== 'all') || row.places[0];
  const ladder = own?.scope?.stats?.[row.key];
  if (!ladder) return '';

  const raw = row.value;
  if (!Number.isFinite(raw)) return '';

  const notes = AXIS_NOTES[row.key] || {};
  /* ==> THE FIGURE PRINTED ON THE BAR IS THE RUNG, NOT THE RAW VALUE, AND IT
   * IS THE SAME TRAP AS THE MARK'S POSITION. <== §57.64. The axis formatters
   * take a ladder's own units; `read()` returns nautical miles for both
   * distance entries. Handing `raw` straight to `axis` here would print
   * `1,830 mi` under a mark placed correctly at the 2,106 mi rung — the
   * mirror image of §57.54c's fault, with the number wrong instead of the
   * position. `toRung` is the one conversion that speaks the ladder's units. */
  const figure = axis(toRung(row.def.quantize, raw), system);
  return spineHtml(ladder, row.def.quantize, raw, {
    axis: (v) => axis(v, system),
    figure: figure == null ? '' : figure,
    lowNote: notes.low || '',
    highNote: notes.high || '',
    /* ==> THE SUMMARY IS THE PICTURE IN WORDS, BECAUSE THE PICTURE IS NOT AN
     * ACCESSIBLE ANSWER. <== `ui/chart-home.js`'s rule. The rank itself is
     * already in the row's own value and is not repeated here. */
    summary: `Across ${own.scope.inWords}, this figure runs from `
      + `${axis(Math.min(...ladder.values), system)} to `
      + `${axis(Math.max(...ladder.values), system)}.`,
  });
}

/**
 * Where this storm stands, one entry per ranked statistic, ready for the row
 * that already prints the figure. §57.57b.
 *
 * ==> IT RETURNS A LOOKUP RATHER THAN A SECTION, AND THAT IS THE WHOLE OF
 * STEP 3. <== §57.54b. This function used to be `archiveRankHtml` and it built
 * a `Where it ranks` section: seven rows, each naming a statistic that already
 * appeared somewhere else on the panel. Measured across all 3,266 storms that
 * section was **33.2% of the panel**, and every row in it duplicated a label
 * three to five sections away. It is deleted. What it knew — how to word a
 * rank and how to draw a bar — is unchanged and now hangs off the figures
 * themselves.
 *
 * ==> THE KEY IS THE `RANK_STATS` KEY, NOT THE LABEL. <== Two entries carry
 * the label `Distance travelled` and a label is copy: a heading reworded at
 * step 7 would silently drop a bar and nothing would look broken. The key is a
 * stable name.
 *
 * ==> AND THE DISTANCE PAIR GETS ONE ALIAS, SO THE CALLER NEVER RE-MAKES A
 * CHOICE THAT HAS ALREADY BEEN MADE. <== §57.46 ships `trackDistanceMi` and
 * `trackDistanceKm` — one fact rounded two ways — and `rankStorm` has already
 * picked the reader's one before this function sees it. `movementHtml` asking
 * for whichever of the two matched would be a second reader of the units
 * preference, free to disagree with the first. It asks for `trackDistance` and
 * gets whichever arrived.
 *
 * @param {object|null} ranked  from `rankStorm`
 * @param {object} [opts]
 * @param {string} [opts.system]  the reader's measurement preference
 * @returns {Map<string, {rank:string, spine:string}>}  empty when nothing ranks
 */
export function rankMarks(ranked, { system = null } = {}) {
  const marks = new Map();
  if (!ranked?.rows?.length) return marks;

  const n = (v) => Number(v).toLocaleString();

  /* ==> NO ROW SAYS "TIED", AND THAT IS A SCALE DECISION RATHER THAN A LOSS
   * OF HONESTY. <== `seasonRankHtml` marks ties, and it is right to: inside a
   * 28-storm season a shared place is unusual and therefore worth pointing at.
   * Against 3,266 storms it is the NORM — winds are recorded in 5 kt steps and
   * lifespans in whole hours, so Katrina's panel came back with `Tied` on six
   * rows out of six. A qualifier that fires everywhere qualifies nothing and
   * reads as hedging. The fact itself is not dropped: it is stated once, in
   * the footnote, where it applies to every rank on screen at once.
   *
   * ==> AND THE SUPERLATIVE IS SAID ONCE PER ROW, NOT TWICE. <== The first
   * draft read `11th strongest in the Atlantic, 15th strongest of 3,266`. The
   * second `strongest` is carried by the first and its only effect is length,
   * on the panel with the least room to spare. */
  const words = (place, superlative) => {
    const ord = ordinal(place.rank);
    if (!ord) return null;
    return place.rank === 1
      ? superlative.charAt(0).toUpperCase() + superlative.slice(1)
      : `${ord} ${superlative}`;
  };

  for (const row of ranked.rows) {
    const parts = [];
    for (const { scope, place } of row.places) {
      if (scope.key === 'all') {
        /* ==> THE DENOMINATOR IS ON THE ROW AND THE MEMBERSHIP IS IN THE
         * FOOTNOTE. <== They differ per statistic — 2,008 storms carry a
         * pressure reading against 3,266 carrying a wind — so one number in
         * the footnote could only ever be right for one row. */
        const ord = ordinal(place.rank);
        if (ord) parts.push(`${ord} of ${n(place.of)} overall`);
        continue;
      }
      const w = words(place, row.def.superlative);
      if (w) parts.push(`${w} in ${scope.inWords}`);
    }
    if (!parts.length) continue;

    const mark = { rank: parts.join(', '), spine: spineFor(row, system) };
    marks.set(row.key, mark);
    if (row.def.system) marks.set('trackDistance', mark);
  }

  return marks;
}

/**
 * The two sentences that govern every rank on the panel at once. §57.54b,
 * §57.57c.
 *
 * ==> ONE FOOTNOTE AT THE FOOT OF THE PANEL, NOT A SENTENCE INSIDE EVERY ROW.
 * <== §57.44 refused to fold ranks into existing rows partly because *"the
 * scope sentence would have to be repeated six times or left off entirely"*.
 * It is neither. Down here it correctly qualifies all seven ranks, which is
 * stronger than six copies and stronger than one copy inside one section.
 *
 * ==> IT IS NOT A `section()` AND THEREFORE CANNOT BE FOLDED AWAY. <== Same
 * rule the honesty line in the header follows: a sentence that stops the rest
 * of the panel being misread must not be something a reader collapses once and
 * then reads the figures without.
 *
 * @param {object|null} ranked  from `rankStorm`
 * @param {object} [opts]
 * @param {number} [opts.year]  the storm's year, for the pre-satellite sentence
 */
export function rankFootnoteHtml(ranked, { year = null } = {}) {
  if (!ranked?.rows?.length) return '';

  const n = (v) => Number(v).toLocaleString();

  /* ==> THE MEMBERSHIP IS READ OFF THE TABLE'S OWN `parts` AND NOT REBUILT
   * FROM THE SCOPES THAT REACHED THIS FUNCTION. <== §57.44, and this was a
   * real fault rather than a precaution. `rankStorm` hands over the storm's
   * OWN basin plus `all` and nothing else, so a roll-call assembled from what
   * arrived named one basin while the rank beside it had been taken against
   * both: *"every storm in the settled record: 2,004 Atlantic"* printed under
   * *"15th of 3,266"*. The builder writes the roll-call, so it is always the
   * whole set and it widens on the day a basin is added with no edit here. */
  const all = ranked.scopes.find((s) => s.key === 'all');
  if (!all) return '';

  const roll = Array.isArray(all.parts) && all.parts.length
    ? all.parts.map((p) => `${n(p.storms)} ${p.label}`).join(' and ')
    : n(all.storms);

  /* ==> IT NAMES ITSELF, BECAUSE IT NO LONGER SITS UNDER A HEADING THAT DID.
   * <== Under `Where it ranks` the reader had just read the section title, so
   * *"Overall means…"* had an antecedent. At the foot of the panel, several
   * screens below the last bar, it does not — so the first clause says which
   * lines it is about. */
  const scopeNote = `The rankings above compare this storm with every other in `
    + `the settled record. Overall means ${roll}, back to ${all.firstSeason}. `
    + `Each figure is ranked only against the storms that have it, which is why `
    + `the totals differ from row to row. Storms sharing a figure share a place, `
    + `so several storms can be 11th.`;

  /* ==> THE PRE-SATELLITE SENTENCE IS ABOUT THE DENOMINATOR, NOT ABOUT THIS
   * STORM. <== The wall and the board both already say that a quiet-looking
   * 1935 is an undercount. Here the undercount is on the OTHER side of the
   * comparison: the storms an old storm is being ranked against are the ones
   * somebody wrote down, and every storm that stayed at sea before satellites
   * is missing from the count. That makes an old storm's rank flattering, not
   * unreliable, and saying which way it leans is the useful half. */
  const era = eraCaveatWords(year);

  return `<footer class="season-detail-footnote">${absenceHtml(scopeNote)}`
    + `${era ? absenceHtml(era) : ''}</footer>`;
}

/** The pre-satellite sentence in the panel's rank footnote. Its own function so
 *  the suite can drive it on both sides of the boundary without building a
 *  table. */
export function eraCaveatWords(year) {
  if (!Number.isFinite(year) || year >= SEASONS.satelliteEraFrom) return null;
  return `Before ${SEASONS.satelliteEraFrom} nobody was watching from orbit, so `
    + `storms that stayed at sea were never recorded at all. This storm is being `
    + `ranked against the ones that were written down, and there were more than `
    + `that. Its place would be lower in a complete record, not higher.`;
}
