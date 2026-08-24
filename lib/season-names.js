/**
 * season-names.js — the names a season was GIVEN, so the board can show the
 * ones it never reached. SPEC-SEASONS-BUILD.md §57.12, §57.18.
 *
 * ==> HURDAT2 AND THE B-DECKS ONLY RECORD NAMES THAT WERE USED. <== A ghost is
 * a name that was on the year's list and never got spent, and no file NOAA
 * publishes contains one. The only way to know that 2026 still has eighteen
 * names left is to hold the list itself, which is what this file is.
 *
 * ==> IT COVERS THE CURRENT YEAR AND NOTHING ELSE. AARON'S CALL, 2026-08-24.
 * <== Ghosts answer "how far has this season got", which is a question about a
 * season still running. A settled year's roster already shows how far it got —
 * the names it used ARE the answer, and 2005 running into the Greek alphabet
 * says "they ran out" more loudly than six blank rows would. So this file is
 * two lists, not one hundred and seventy-five, and that is the whole reason
 * the feature was affordable.
 *
 * ==> AND AN UNKNOWN YEAR SHOWS NO GHOSTS RATHER THAN THE WRONG ONES. <== The
 * lists rotate every six years with retired names swapped out, so 2026's list
 * is NOT 2027's. `namesFor` is keyed on the year explicitly and returns null
 * for anything it was not told about. When the season turns over and nobody
 * has added the new list, the board loses its ghost rows and says nothing
 * about names remaining — which is §5's honest silence. Printing last year's
 * names against this year's storms would be a confident lie, and it is the one
 * failure this shape makes impossible.
 *
 * ==> THE LISTS ARE HAND-MAINTAINED AND THAT IS A DELIBERATE COST. <== One
 * entry per basin each spring, after the WMO committee meets in March. Same
 * reasoning as §57.17's retired names: NHC publishes these as a PDF and a web
 * page, and a scraper aimed at either would silently empty the roster the day
 * NOAA restyles it.
 *
 * PROVENANCE — READ THIS BEFORE EDITING A NAME.
 *
 * Both lists were transcribed on 2026-08-24 from NHC's own pronunciation
 * guides, which are the primary source rather than a summary of one:
 *   Atlantic      https://www.nhc.noaa.gov/pdf/aboutnames_pronounce_atlc.pdf
 *   East Pacific  https://www.nhc.noaa.gov/pdf/aboutnames_pronounce_epac.pdf
 *
 * ==> AND BOTH WERE THEN CHECKED AGAINST OUR OWN MIRRORED BYTES, WHICH IS THE
 * PART THAT MAKES THEM TRUSTWORTHY. <== The `seasons-live` branch holds this
 * season's real ATCF b-decks. Every name the season has actually spent, in the
 * order NOAA spent it, matches the head of the list below:
 *   Atlantic      ARTHUR, BERTHA, CRISTOBAL          — positions 1-3 of 21
 *   East Pacific  AMANDA … ISELLE                    — positions 1-9 of 24
 * `tools/test-season-names.mjs` re-runs that check against the mirror, so a
 * mistyped name in the used range fails the suite rather than reaching a
 * screen. It cannot check the UNUSED tail — nothing can, until a storm spends
 * it — which is exactly why the source is NHC's file and not a news article.
 *
 * Imports nothing. No DOM, no network, no clock.
 */

/**
 * ==> CENTRAL PACIFIC IS ABSENT ON PURPOSE AND IT IS NOT AN OMISSION. <==
 * §57.12. CPHC runs FOUR lists used continuously, one name after the next
 * across season boundaries — it does not start again in January. Measured in
 * our own files rather than recalled: the Central Pacific ran HONE (2024),
 * IONA and KELI (2025), LALA and MOKE (2026). That is one alphabet crossing
 * three seasons, so "the names for 2026" is a question with no answer, and a
 * Central Pacific roster with ghosts on it would be inventing a structure the
 * basin does not have.
 *
 * A basin missing from this table gets a plain storm list. That is §57.12's
 * rule and it is also what protects step 13's West Pacific from a screen built
 * on an assumption that only holds in two basins.
 */
const ROSTERS = Object.freeze({
  /* NHC publishes 21 for the Atlantic — Q, U, X, Y and Z are not used. */
  atlantic: Object.freeze({
    2026: Object.freeze([
      'ARTHUR', 'BERTHA', 'CRISTOBAL', 'DOLLY', 'EDOUARD', 'FAY', 'GONZALO',
      'HANNA', 'ISAIAS', 'JOSEPHINE', 'KYLE', 'LEAH', 'MARCO', 'NANA', 'OMAR',
      'PAULETTE', 'RENE', 'SALLY', 'TEDDY', 'VICKY', 'WILFRED',
    ]),
  }),

  /* And 24 for the East Pacific, which does use X, Y and Z. */
  epacific: Object.freeze({
    2026: Object.freeze([
      'AMANDA', 'BORIS', 'CRISTINA', 'DOUGLAS', 'ELIDA', 'FAUSTO', 'GENEVIEVE',
      'HERNAN', 'ISELLE', 'JULIO', 'KARINA', 'LOWELL', 'MARIE', 'NORBERT',
      'ODALYS', 'POLO', 'RACHEL', 'SIMON', 'TRUDY', 'VANCE', 'WINNIE',
      'XAVIER', 'YOLANDA', 'ZEKE',
    ]),
  }),
});

/**
 * The names a basin was given for a year, or null if we do not hold them.
 *
 * NULL IS A REAL ANSWER AND THE CALLER MUST TREAT IT AS ONE. It means three
 * different true things — a settled year we deliberately do not carry, a basin
 * with no annual list at all, and a new season nobody has typed yet — and in
 * every one of them the honest screen is a roster with no ghost rows on it.
 *
 * @param {string} basin  'atlantic' or 'epacific', as `seasons/index.json` keys them
 * @param {number} year
 * @returns {ReadonlyArray<string>|null}
 */
export function namesFor(basin, year) {
  const byYear = ROSTERS[String(basin || '').toLowerCase()];
  if (!byYear) return null;
  return byYear[Number(year)] || null;
}

/** Do we hold a roster for this basin and year? The board asks before it
 *  promises a reader anything about names remaining. */
export function hasRoster(basin, year) {
  return namesFor(basin, year) !== null;
}

/**
 * Split a year's roster into what the season spent and what it has left.
 *
 * @param {string} basin
 * @param {number} year
 * @param {Iterable<string>} usedNames  every name the season has actually used
 * @returns {{
 *   roster: ReadonlyArray<string>,
 *   ghosts: string[],
 *   used: string[],
 *   offList: string[],
 *   reachedEnd: boolean,
 * } | null}
 *
 * ==> GHOSTS ARE COMPUTED BY MEMBERSHIP, NOT BY COUNTING FORWARD FROM THE LAST
 * NAME USED. <== Counting is the obvious way and it is wrong in a way that
 * only shows on a bad day: NHC very occasionally skips a name, and a season
 * whose ninth storm took the tenth name would have its true ghost quietly
 * removed from the list by an index. Membership cannot make that mistake, and
 * it costs nothing at twenty-four names.
 *
 * ==> `offList` IS THE FINDING, NOT AN ERROR TO SWALLOW. <== A used name that
 * is not on the roster means one of two things, and both matter. Either the
 * season ran past its 21 and is drawing on the WMO supplemental list — real,
 * and the reason the Greek alphabet was abolished in 2021 — or the list in
 * this file is wrong. Silently ignoring it would hide the second case forever,
 * which is §5's shape exactly: the roster would look fine and be a lie. The
 * board says so out loud instead.
 */
export function rosterFor(basin, year, usedNames = []) {
  const roster = namesFor(basin, year);
  if (!roster) return null;

  /* Upper-cased on both sides. HURDAT2 writes names in capitals and the ATCF
   * b-decks do too, but the comparison must not depend on that holding — a
   * roster that silently stopped matching would show every name as a ghost. */
  const used = [];
  const offList = [];
  const seen = new Set();
  for (const raw of usedNames) {
    const n = String(raw || '').trim().toUpperCase();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    (roster.includes(n) ? used : offList).push(n);
  }

  const ghosts = roster.filter((n) => !seen.has(n));

  return {
    roster,
    ghosts,
    used,
    offList,
    /* Every name spent. The thing worth SAYING rather than drawing — it is
     * what "they ran out of names" means, and it is the one state where a
     * roster with no ghosts left on it is the whole story. */
    reachedEnd: ghosts.length === 0,
  };
}

/** For the suite, so a test can walk every list this file holds without
 *  reaching into module state or hardcoding the years again. */
export const __internals = { ROSTERS };
