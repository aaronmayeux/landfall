/**
 * wall-filter.js — the Wall of Years' filters, its sort, and the honesty
 * numbers that have to sit under both. SPEC-SEASONS-BUILD.md §57.36.
 *
 * Pure. No DOM, no network, no `data/`, no `config` beyond the constants — all
 * of it runs under `node`, which is why the arithmetic is here and not in the
 * view. `tools/test-wall-filter.mjs` drives every function in this file.
 *
 * ==> THE ONE RULE THE WHOLE SCREEN RESTS ON: FILTER FIRST, THEN SORT WHAT
 * SURVIVES. <== §57.36. Every sort key except `year` is recomputed over the
 * FILTERED set, and getting that backwards makes the feature useless without
 * looking broken: filter to Category 5, sort by count, and a season-total
 * `count` would rank 2005 above 1932 on the strength of 31 storms the filter
 * was explicitly asked to ignore.
 *
 * ==> AND IT IS WHY THERE IS NO "SORT BY NUMBER OF CATEGORY 5s" KEY. <== That
 * question, and every question shaped like it — most landfalling storms, most
 * majors, most ACE from storms that hit land — falls out of two general
 * controls stacked. A key per question is the combinatorial explosion the rule
 * exists to prevent.
 *
 * ==> EVERY THRESHOLD EXCLUDES WHAT IT CANNOT MEASURE. <== §5. A storm with no
 * central pressure is not a storm at 1013 mb, a storm with no ACE is not a
 * storm at 0, and an ungraded storm is not a tropical depression. Each of them
 * is dropped by a filter that asks about the thing it is missing, rather than
 * swept in on a stand-in figure the source never published.
 */

import { SEASONS } from '../config/constants.js';
import {
  ACE, CAT, DAYS, LANDFALL, PRESSURE_MB, SATELLITE_ERA_FROM,
} from './wall-index.js';

/** How many category chips there are: TD, TS, Cat 1 through Cat 5. Derived
 *  from the index range `lib/category.js` produces rather than typed, so a
 *  scheme that ever grew a class would grow a chip with it. */
export const CATEGORY_INDEXES = Object.freeze([0, 1, 2, 3, 4, 5, 6]);

/**
 * The empty filter — everything checked, nothing thresholded.
 *
 * ==> A FRESH OBJECT EVERY CALL, DELIBERATELY. <== The view holds this as
 * mutable reader state and a shared frozen default would be written through on
 * the first chip tap.
 */
export function emptyFilter() {
  return {
    cats: new Set(CATEGORY_INDEXES),
    landfall: false,
    minAce: null,
    minDays: null,
    maxPressureMb: null,
  };
}

/** Is the category chip row actually narrowing anything? All seven checked is
 *  the same answer as no category filter at all, and the two must be treated
 *  identically or an ungraded storm would vanish from an unfiltered wall. */
export const categoriesNarrowed = (f) => !!f?.cats && f.cats.size < CATEGORY_INDEXES.length;

/**
 * Is anything narrowing the wall right now?
 *
 * ==> THIS DRIVES THREE SEPARATE THINGS AND HAS TO AGREE WITH ITSELF. <== The
 * count column showing `4 of 31`, the ACE figure being labelled as filtered
 * rather than as NOAA's published number, and the pre-1966 undercount line
 * appearing at all. A filter that is "on" for one of those and "off" for
 * another is three screens disagreeing about what the reader did.
 */
export function isFiltered(f) {
  if (!f) return false;
  return categoriesNarrowed(f)
    || !!f.landfall
    || Number.isFinite(f.minAce)
    || Number.isFinite(f.minDays)
    || Number.isFinite(f.maxPressureMb);
}

/**
 * One filter, as a predicate over a raw storm row.
 *
 * Returns `null` when nothing is narrowing, so `rowsFor` takes its cheap path
 * and every season keeps its own array rather than a copy of it — 3,266 storms
 * filtered on every repaint of a screen that mostly is not filtering.
 */
export function keepFor(f) {
  if (!isFiltered(f)) return null;

  const cats = categoriesNarrowed(f) ? f.cats : null;
  const { landfall } = f;
  const minAce = Number.isFinite(f.minAce) ? f.minAce : null;
  const minDays = Number.isFinite(f.minDays) ? f.minDays : null;
  const maxMb = Number.isFinite(f.maxPressureMb) ? f.maxPressureMb : null;

  return (s) => {
    /* ==> AN UNGRADED STORM FAILS A CATEGORY FILTER RATHER THAN JOINING ONE.
     * <== §6. The record never said what it was, so it cannot be claimed for a
     * chip; showing it under `Category 5` would be inventing the grade the
     * whole column is missing. It is still on an unfiltered wall, because
     * there the question is not being asked. */
    if (cats && !cats.has(s[CAT])) return false;
    if (landfall && !s[LANDFALL]) return false;
    if (minAce != null && !(Number.isFinite(s[ACE]) && s[ACE] >= minAce)) return false;
    if (minDays != null && !(Number.isFinite(s[DAYS]) && s[DAYS] >= minDays)) return false;
    /* Lower is stronger, so this one is a ceiling where the other two are
     * floors. See `SEASONS.wallPressureMin`. */
    if (maxMb != null && !(Number.isFinite(s[PRESSURE_MB]) && s[PRESSURE_MB] <= maxMb)) return false;
    return true;
  };
}

/* ---------------------------------------------------------------------------
 * SORT
 * ------------------------------------------------------------------------- */

/**
 * The value one row sorts on, for one key.
 *
 * ==> FOUR OF THE FIVE READ THE FILTERED FIGURES, AND THAT IS THE POINT. <==
 * `rowsFor` has already computed `shown`, `strongest`, `landfalls` and `ace`
 * over what survived, so this function does no filtering of its own — it just
 * must not reach for `total` by accident. `year` is the only key that is a
 * fact about the row rather than about its contents.
 */
export function sortValue(row, key) {
  if (key === 'count') return row.shown.length;
  if (key === 'strongest') return row.strongest;          /* -1 for none graded */
  if (key === 'landfalls') return row.landfalls;
  if (key === 'ace') return row.aceMeasured ? row.ace : null;
  return row.year;
}

/**
 * Sort a set of rows. Returns a new array; the input is left alone.
 *
 * ==> AN UNMEASURABLE VALUE SINKS TO THE BOTTOM IN BOTH DIRECTIONS. <== §5
 * through a comparator. A season whose storms carry no ACE has an UNKNOWN ACE,
 * not an ACE of nought — so "lowest ACE first" must not present it as the
 * quietest season on record. Bottom in both directions is the only placement
 * that never states something the file does not say.
 *
 * ==> AND EVERY TIE BREAKS BY YEAR, NEWEST FIRST, IN BOTH DIRECTIONS. <==
 * §57.36. Under a tight filter most rows tie at zero, so the tiebreak is what
 * the reader actually sees for most of the screen; leaving it to the sort's
 * stability would make the order depend on which basin file happened to load.
 */
export function sortRows(rows, key = SEASONS.wallSortDefault, dir = SEASONS.wallSortDirDefault) {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    const aNull = av == null;
    const bNull = bv == null;
    if (aNull !== bNull) return aNull ? 1 : -1;
    if (!aNull && av !== bv) return (av - bv) * sign;
    return b.year - a.year;
  });
}

/** Whether the wall is still a timeline. The satellite-era line can only be
 *  drawn while it is, and empty rows only keep their place while it is. */
export const isTimeline = (key) => key === 'year';

/* ---------------------------------------------------------------------------
 * THE UNDERCOUNT, IN NUMBERS
 * ------------------------------------------------------------------------- */

/**
 * How many storms matching the current filter came from each era, and at what
 * rate per season.
 *
 * ==> THIS IS WHERE A SORT CONTROL ACCIDENTALLY MAKES A CLIMATE CLAIM. <==
 * §57.36. Filter to Category 5 and sort by count and the leaderboard is almost
 * entirely modern — 3 of the top 20 seasons are pre-satellite. Almost none of
 * that gap is weather: nobody could measure a 140-knot wind over open water in
 * 1890, so a storm that stayed at sea was recorded at whatever a ship happened
 * to see. Unmarked, that screen states that Category 5 hurricanes are a modern
 * phenomenon, which this dataset cannot support.
 *
 * Measured off the shipped file 2026-08-26 for the Cat 5 case: 13 storms over
 * 115 pre-satellite seasons against 32 over 60 since — 0.11 a year against
 * 0.53, and the ratio is what the line on screen quotes.
 *
 * @param {Array} rows  from `rowsFor`, already filtered
 */
export function eraSplit(rows) {
  let preStorms = 0, preSeasons = 0, postStorms = 0, postSeasons = 0;
  for (const row of rows) {
    if (row.year < SATELLITE_ERA_FROM) { preSeasons++; preStorms += row.shown.length; }
    else { postSeasons++; postStorms += row.shown.length; }
  }
  const rate = (n, d) => (d > 0 ? n / d : null);
  const preRate = rate(preStorms, preSeasons);
  const postRate = rate(postStorms, postSeasons);
  return {
    from: SATELLITE_ERA_FROM,
    preStorms,
    preSeasons,
    postStorms,
    postSeasons,
    preRate,
    postRate,
    /* Null rather than Infinity when the older era found nothing at all: "the
     * modern rate is infinitely higher" is not a sentence, and a basin whose
     * record starts after 1966 has no older era to compare against. */
    ratio: preRate != null && postRate != null && preRate > 0 ? postRate / preRate : null,
  };
}

/* ---------------------------------------------------------------------------
 * SAYING WHAT THE FILTER IS, IN WORDS
 * ------------------------------------------------------------------------- */

/**
 * `Category 3, 4 or 5` — an Oxford-free list, because these are the reader's
 * own chips read back and a comma before `or` reads as a fourth item.
 *
 * ==> AND A PREFIX EVERY ITEM SHARES IS SAID ONCE. <== Caught by
 * `tools/test-wall-filter.mjs` before it reached glass: three ticked chips came
 * back as *"Category 3, Category 4 or Category 5"*, which is how a machine
 * lists things and not how the sentence around it reads. Collapsing happens
 * only when EVERY item shares the word — tick a tropical storm alongside two
 * hurricane categories and there is no common prefix, so each is named in full
 * rather than one of them being quietly reworded to match the others.
 */
function joinOr(parts) {
  if (parts.length <= 1) return parts[0] || '';

  const first = parts[0].split(' ')[0];
  const shared = !!first && parts.every((p) => p.startsWith(`${first} `));
  const items = shared ? parts.map((p) => p.slice(first.length + 1)) : parts;
  const list = `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
  return shared ? `${first} ${list}` : list;
}

/** One decimal, but only when there is one — `10 days`, not `10.0 days`. */
const trim = (n) => String(Math.round(n * 10) / 10);

/**
 * The active filter as a noun phrase, with no article on the front.
 *
 * ==> THE COLLAPSED TAIL IS UNREADABLE WITHOUT IT. <== §57.36 asks for
 * *"142 seasons had no Category 5"*, and a generic *"142 seasons had none"*
 * makes the reader scroll back up to the chips to find out what they just
 * hid — on the one screen where an over-filtered wall and a broken wall look
 * identical.
 *
 * @param {object} f
 * @param {object} opts
 * @param {(cat:number) => string} opts.catLabel  injected, so this file needs
 *   no opinion about how a category is spelled. The wall's markup already owns
 *   that mapping and there must not be a second one.
 */
export function filterPhrase(f, { catLabel }) {
  if (!isFiltered(f)) return 'storm';

  const clauses = [];
  if (Number.isFinite(f.minDays)) clauses.push(`lasting ${trim(f.minDays)} days or more`);
  if (Number.isFinite(f.maxPressureMb)) clauses.push(`below ${f.maxPressureMb} mb`);
  if (Number.isFinite(f.minAce)) clauses.push(`worth ${trim(f.minAce)} ACE or more`);

  /* Chips read back in the order they sit on screen, weakest to strongest,
   * rather than in Set insertion order — a reader who ticked 5 then 3 should
   * see `Category 3 or 5`, which is what the row of chips looks like. */
  const noun = categoriesNarrowed(f)
    ? joinOr(CATEGORY_INDEXES.filter((c) => f.cats.has(c)).map(catLabel))
    : 'storm';

  const head = f.landfall ? `landfalling ${noun}` : noun;
  return clauses.length ? `${head} ${clauses.join(' and ')}` : head;
}

/**
 * The figure a row is being sorted by, for the extra column.
 *
 * ==> SORTING BY A NUMBER THAT IS NOWHERE ON SCREEN READS AS A BROKEN CONTROL.
 * <== Aaron, 2026-08-26. `year` and `count` are already both drawn — the year
 * column and the count column — so those two return nothing and the extra
 * column does not appear at all, which is what keeps the strip its full width
 * in the ordinary case.
 *
 * @returns {{value:string, unit:string}|null}
 */
export function sortFigure(row, key, { catLabel }) {
  if (key === 'year' || key === 'count') return null;
  if (key === 'strongest') {
    return row.strongest < 0
      ? { value: '—', unit: 'none graded' }
      : { value: catLabel(row.strongest), unit: 'strongest' };
  }
  /* ==> THE UNIT SAYS STORMS, BECAUSE THAT IS WHAT THE NUMBER IS. <== It read
   * `landfalls` and the figure counted storms, which is the exact mismatch
   * §57.7a set out to fix and then fixed in the other direction. */
  if (key === 'landfalls') {
    return { value: String(row.landfalls), unit: row.landfalls === 1 ? 'storm ashore' : 'storms ashore' };
  }
  /* ==> UNMEASURED ACE IS A DASH, NEVER A NOUGHT. <== The same §5 distinction
   * the comparator makes, made again where the reader can see it. */
  return row.aceMeasured
    ? { value: trim(row.ace), unit: 'ACE' }
    : { value: '—', unit: 'ACE not measured' };
}
