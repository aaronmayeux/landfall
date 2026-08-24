/**
 * season-names.js — the names a season was GIVEN, so the board can show the
 * ones it never reached. SPEC-SEASONS-BUILD.md §57.12, §57.18, §57.18a.
 *
 * ==> HURDAT2 AND THE B-DECKS ONLY RECORD NAMES THAT WERE USED. <== A ghost is
 * a name that was on the year's list and never got spent, and no file NOAA
 * publishes as DATA contains one. The only way to know that 2026 still has
 * eighteen names left is to hold the list itself.
 *
 * ==> THE LISTS ARE NO LONGER TYPED BY HAND. <== Aaron's call, 2026-08-24.
 * They live in `lib/season-names-data.js`, which is GENERATED monthly by
 * `tools/seasons-names.mjs` from NHC's own names page. That page carries six
 * years ahead with the year in each column header, so there is no rotation to
 * compute and no retirement table to maintain — and a broken read leaves the
 * last good file untouched rather than emptying a roster. The full argument,
 * including why the earlier "hand-maintained is a deliberate cost" note was
 * wrong, is at the top of `tools/seasons-names.mjs`.
 *
 * ==> GHOSTS ARE THE CURRENT SEASON AND NOTHING ELSE. AARON'S CALL, TWICE.
 * <== Ghosts answer "how far has this season got", which is a question about a
 * season still running. A settled year's roster already answers it — the names
 * it used ARE how far it got, and 2005 running past its list says "they ran
 * out" more loudly than six blank rows would.
 *
 * **The data file now holds future and past years, so THIS MODULE is the thing
 * enforcing that.** The gate is `rosterFor`'s fourth argument, and it is
 * FAIL-CLOSED on purpose: a caller that does not say what year it is gets no
 * roster at all. Forgetting the argument costs a reader some ghost rows;
 * defaulting it would eventually put last season's names beside this season's
 * storms, which is a confident lie and the one failure this shape makes
 * impossible.
 *
 * ==> AND A YEAR WE SIMPLY DO NOT HOLD SHOWS NO GHOSTS RATHER THAN THE WRONG
 * ONES. <== 1935 has no list here and never will. `namesFor` returns null for
 * anything it was not given, and the board says nothing about names remaining
 * — which is §5's honest silence.
 *
 * Imports one generated sibling. No DOM, no network, no clock.
 */

import { NAME_ROSTERS } from './season-names-data.js';

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
 * A basin missing from the table gets a plain storm list. That is §57.12's
 * rule and it is also what protects step 13's West Pacific from a screen built
 * on an assumption that only holds in two basins.
 */

/**
 * The names a basin was given for a year, or null if we do not hold them.
 *
 * ==> UNGATED. THIS IS THE RAW TABLE AND A VIEW MUST NOT CALL IT. <== It
 * answers for every year the generated file carries, including years already
 * finished and years not yet begun, because the job and the suite both need to
 * see the whole table. Ghost rows on a screen go through `rosterFor`.
 *
 * @param {string} basin  'atlantic' or 'epacific', as `seasons/index.json` keys them
 * @param {number} year
 * @returns {ReadonlyArray<string>|null}
 */
export function namesFor(basin, year) {
  const byYear = NAME_ROSTERS[String(basin || '').toLowerCase()];
  if (!byYear) return null;
  return byYear[Number(year)] || null;
}

/**
 * Do we hold a roster we are willing to SHOW for this basin and year? The
 * board asks before it promises a reader anything about names remaining, so
 * this carries the current-season gate as well as the has-it check.
 *
 * @param {string} basin
 * @param {number} year
 * @param {number} currentYear  the season in progress; anything else answers false
 */
export function hasRoster(basin, year, currentYear) {
  return Number(year) === Number(currentYear) && namesFor(basin, year) !== null;
}

/**
 * Split the current season's roster into what it has spent and what it has left.
 *
 * @param {string} basin
 * @param {number} year                the season being looked at
 * @param {Iterable<string>} usedNames every name that season has actually used
 * @param {number} currentYear         the season in progress
 * @returns {{
 *   roster: ReadonlyArray<string>,
 *   ghosts: string[],
 *   used: string[],
 *   offList: string[],
 *   reachedEnd: boolean,
 * } | null}
 *
 * ==> NULL IS A REAL ANSWER AND THE CALLER MUST TREAT IT AS ONE. <== It means
 * four different true things — a settled year, a future year, a basin with no
 * annual list at all, and a caller that did not say what year it is — and in
 * every one of them the honest screen is a roster with no ghost rows on it.
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
 * and the reason the Greek alphabet was abolished in 2021 — or the generated
 * list is wrong. Silently ignoring it would hide the second case forever,
 * which is §5's shape exactly: the roster would look fine and be a lie. The
 * board says so out loud instead.
 */
export function rosterFor(basin, year, usedNames = [], currentYear = null) {
  if (!hasRoster(basin, year, currentYear)) return null;
  const roster = namesFor(basin, year);

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

/** For the suite and the generator, so a test can walk every list this repo
 *  holds without reaching into module state or hardcoding the years again. */
export const __internals = { ROSTERS: NAME_ROSTERS };
