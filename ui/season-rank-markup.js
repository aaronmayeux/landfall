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
import { absenceHtml, rowsHtml, utcDay } from './season-markup-bits.js';

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
 * Where this storm stands against the whole archive. §57.44, §57.42 Tier 1
 * item 11.
 *
 * ==> IT IS ONE SECTION RATHER THAN SIX RANKS GLUED ONTO SIX EXISTING ROWS.
 * <== The obvious build is to append "(3rd lowest on record)" to the pressure
 * row, the wind row and four others. Two things make that wrong. The scope
 * sentence would have to be repeated six times or left off entirely, and it is
 * the sentence that stops the whole section being misread. And `Lowest
 * pressure` would become a row whose value ran to two lines on a 390px phone,
 * which is what `Strongest` looks like before anyone has decided it should.
 * One section states the scope once and the panel's existing rows are
 * untouched.
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
 * broke. The count is in the row and the membership is in the note, so both
 * widen when the data does and neither ever silently changes meaning.
 */
export function archiveRankHtml(ranked, { year = null } = {}) {
  if (!ranked?.rows?.length) return '';

  const n = (v) => Number(v).toLocaleString();

  /* ==> NO ROW SAYS "TIED", AND THAT IS A SCALE DECISION RATHER THAN A LOSS
   * OF HONESTY. <== `seasonRankHtml` one section up marks ties, and it is
   * right to: inside a 28-storm season a shared place is unusual and therefore
   * worth pointing at. Against 3,266 storms it is the NORM — winds are
   * recorded in 5 kt steps and lifespans in whole hours, so Katrina's panel
   * came back with `Tied` on six rows out of six. A qualifier that fires
   * everywhere qualifies nothing and reads as hedging. The fact itself is not
   * dropped: it is stated once, in the note, where it applies to every row at
   * once.
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

  const rows = [];
  /* ==> EVERY RANKED ROW IS PRINTED. THIS USED TO BE
   * `.slice(0, SEASONS.rankingsMaxRows)` AND AARON DELETED THE CAP ON
   * 2026-08-29. <== The truncation made adding a statistic to `RANK_STATS` a
   * glass call about crowding rather than a free addition, and it cut the last
   * rows away with nothing on screen saying so — §5's silence, on a section
   * whose whole job is telling the reader where a figure stands. If this
   * section ever reads as too long the lever is which statistics are worth
   * ranking, decided in `RANK_STATS` where a reader of the code can see it. */
  for (const row of ranked.rows) {
    const parts = [];
    for (const { scope, place } of row.places) {
      if (scope.key === 'all') {
        /* ==> THE DENOMINATOR IS ON THE ROW AND THE MEMBERSHIP IS IN THE NOTE.
         * <== They differ per statistic — 2,008 storms carry a pressure
         * reading against 3,266 carrying a wind — so one number in the note
         * could only ever be right for one row. */
        const ord = ordinal(place.rank);
        if (ord) parts.push(`${ord} of ${n(place.of)} overall`);
        continue;
      }
      const w = words(place, row.def.superlative);
      if (w) parts.push(`${w} in ${scope.inWords}`);
    }
    if (parts.length) rows.push([row.def.label, parts.join(', ')]);
  }

  if (!rows.length) return '';

  /* ==> THE MEMBERSHIP IS READ OFF THE TABLE'S OWN `parts` AND NOT REBUILT
   * FROM THE SCOPES THAT REACHED THIS FUNCTION. <== §57.44, and this was a
   * real fault rather than a precaution. `rankStorm` hands over the storm's
   * OWN basin plus `all` and nothing else, so a roll-call assembled from what
   * arrived named one basin while the rank beside it had been taken against
   * both: *"every storm in the settled record: 2,004 Atlantic"* printed under
   * *"15th of 3,266"*. The builder writes the roll-call, so it is always the
   * whole set and it widens on the day a basin is added with no edit here. */
  const all = ranked.scopes.find((s) => s.key === 'all');
  const roll = Array.isArray(all?.parts) && all.parts.length
    ? all.parts.map((p) => `${n(p.storms)} ${p.label}`).join(' and ')
    : (all ? n(all.storms) : null);

  const scopeNote = all
    ? `Overall means every storm in the settled record: ${roll}, back to `
      + `${all.firstSeason}. Each figure is ranked only against the storms that `
      + `have it, which is why the totals differ from row to row. Storms sharing `
      + `a figure share a place, so several storms can be 11th.`
    : null;

  /* ==> THE PRE-SATELLITE SENTENCE IS ABOUT THE DENOMINATOR, NOT ABOUT THIS
   * STORM. <== The wall and the board both already say that a quiet-looking
   * 1935 is an undercount. Here the undercount is on the OTHER side of the
   * comparison: the storms an old storm is being ranked against are the ones
   * somebody wrote down, and every storm that stayed at sea before satellites
   * is missing from the count. That makes an old storm's rank flattering, not
   * unreliable, and saying which way it leans is the useful half. */
  const era = eraCaveatWords(year);

  return rowsHtml(rows)
    + (scopeNote ? absenceHtml(scopeNote) : '')
    + (era ? absenceHtml(era) : '');
}

/** The pre-satellite sentence for the ranking section. Its own function so the
 *  suite can drive it on both sides of the boundary without building a table. */
export function eraCaveatWords(year) {
  if (!Number.isFinite(year) || year >= SEASONS.satelliteEraFrom) return null;
  return `Before ${SEASONS.satelliteEraFrom} nobody was watching from orbit, so `
    + `storms that stayed at sea were never recorded at all. This storm is being `
    + `ranked against the ones that were written down, and there were more than `
    + `that. Its place would be lower in a complete record, not higher.`;
}
