/**
 * retired-lookup.js — the join between a storm and the retired-names list.
 * SPEC-SEASONS-BUILD.md §57.51, §57.52.
 *
 * `data/retired-names.js` is GENERATED and holds `[NAME, YEAR]` pairs. This
 * file is the only place in the app that turns those pairs into an answer
 * about one storm, so there is exactly one join and it cannot drift.
 *
 * ==> THE KEY IS NAME PLUS YEAR, AND THAT IS THE WHOLE REASON THIS FILE
 * EXISTS. <== Ida 2021 is retired and Ida 2009 is not. Measured against the
 * shipped `seasons/wall.json` 2026-08-30: joining on the NAME alone marks
 * 369 storms where the honest answer is 120, so **208 storms would carry a
 * badge they never earned** — and every one of them reads perfectly, which is
 * this project's most expensive failure shape. Two of the 208 run backwards
 * (Carol 1965 and Edna 1968 both predate nothing — their names were retired
 * for the 1954 storms), so "it was retired later" is not a safe reading
 * either.
 *
 * ==> THE PACIFIC IS A UNION AND THE CENTRAL PACIFIC IS NOT A THIRD BASIN ON
 * THE WALL, AND THE STORM PANEL CANNOT SPLIT THEM EITHER. <==
 * `seasons/wall.json` has two buckets, `atlantic` and `epacific`, and CPHC
 * storms live in the second of them. Filtering the wall's Pacific rows against
 * `RETIRED_EPACIFIC` alone silently loses IWA, INIKI, IOKE and PAKA, the four
 * best-known Hawaii storms in the record.
 *
 * The panel looks at one storm and could in principle ask a sharper question,
 * and it was built that way first. **The record refuses to cooperate:** IWA is
 * `CP041982`, IOKE is `CP012006`, PAKA is `CP051997` and INIKI is `EP181992`.
 * Iniki is the most destructive storm in Hawaii's history and keying on its
 * own basin prefix gave it nothing. So both surfaces union `EP` and `CP`, and
 * `BASIN_POOL` below records that no `NAME|YEAR` collides between the two
 * lists, which is what makes the union safe rather than merely convenient.
 *
 * ==> AND NOTHING HERE EVER ANSWERS "NOT RETIRED". <== §5. `retirementFor`
 * returns a fact or it returns `null`, and `null` means only that this file
 * has nothing to say. Below a basin's derivation floor the frozen historic
 * block is what answers, and the app never prints a negative sentence — so a
 * storm we could not check and a storm that was genuinely not retired look
 * identical on screen because neither is spoken about at all. A sentence
 * saying "this name was never retired" is the one thing this file must not
 * make possible.
 *
 * `lib/` may not import `data/` (§12), which is why the join lives here and
 * the wall's filter takes it as an injected predicate.
 */

import {
  RETIRED_ATLANTIC, RETIRED_EPACIFIC, RETIRED_CPACIFIC,
  RETIRED_BY_DESCRIPTION, RETIRED_UNSURE,
} from './retired-names.js';

/** `NAME|YEAR`, the shape `RETIRED_UNSURE` is already keyed by. One spelling
 *  of the key, used by every map below. */
const key = (name, year) => `${String(name || '').toUpperCase()}|${year}`;

/**
 * ==> `byName` IS A RETIREMENT BY NAME; `byDescription` IS THE GREEK PAIR. <==
 * §57.51. Eta and Iota are exported separately by the generated file precisely
 * so a caller has to opt in, and they are kept apart here for the same reason:
 * the two need different sentences and folding them together is how the wrong
 * one gets printed.
 */
function indexOf(pairs) {
  const m = new Set();
  for (const [name, year] of pairs || []) m.add(key(name, year));
  return m;
}

const BY_NAME = Object.freeze({
  AL: indexOf(RETIRED_ATLANTIC),
  EP: indexOf(RETIRED_EPACIFIC),
  CP: indexOf(RETIRED_CPACIFIC),
});

const BY_DESCRIPTION = Object.freeze({
  AL: indexOf(RETIRED_BY_DESCRIPTION.filter(([, , b]) => b === 'atlantic')),
  EP: indexOf(RETIRED_BY_DESCRIPTION.filter(([, , b]) => b === 'epacific')),
  CP: indexOf(RETIRED_BY_DESCRIPTION.filter(([, , b]) => b === 'cpacific')),
});

/** Which retired-name lists a storm's own basin prefix has to be checked
 *  against.
 *
 * ==> `EP` AND `CP` ARE ONE POOL, AND THE PANEL LEARNED THAT THE HARD WAY.
 * <== The first version of this file keyed the storm panel straight off
 * `storm.basin`, on the argument that a panel looks at ONE storm so it can ask
 * the precise question. **That was wrong, and running it against the real
 * archive is what said so.** The record does not put CPHC storms under a
 * consistent prefix: `IWA` is `CP041982`, `IOKE` is `CP012006`, `PAKA` is
 * `CP051997` — and `INIKI` is `EP181992`. Iniki is the most destructive storm
 * in Hawaii's history and it silently got no sentence.
 *
 * ==> UNIONING IS SAFE AND THAT IS MEASURED, NOT ASSUMED. <== No `NAME|YEAR`
 * appears in both `RETIRED_EPACIFIC` and `RETIRED_CPACIFIC`, so nothing can be
 * claimed twice or claimed by the wrong desk. The Atlantic stays on its own,
 * because a name retired in one ocean is routinely still in service in the
 * other and that separation is load-bearing.
 */
const BASIN_POOL = Object.freeze({
  AL: Object.freeze(['AL']),
  EP: Object.freeze(['EP', 'CP']),
  CP: Object.freeze(['EP', 'CP']),
});

/** Which HURDAT2 basin prefixes a wall bucket contains. The Pacific bucket is
 *  two of them, for the same reason `BASIN_POOL` unions them. */
const WALL_BASINS = Object.freeze({
  atlantic: Object.freeze(['AL']),
  epacific: Object.freeze(['EP', 'CP']),
});

/**
 * What, if anything, this app can say about this storm's name.
 *
 * @param {string} name   the storm's name, any case. Unnamed storms answer null.
 * @param {number} year
 * @param {string} basin  `AL`, `EP` or `CP` — `storm.basin` straight off the
 *   parser. An unknown basin answers null rather than searching all three: a
 *   name that is retired in one ocean is often in service in the other.
 * @returns {{kind:'name'|'description', datedToThisStorm:boolean}|null}
 *   `kind` picks the sentence. `datedToThisStorm` is false for the three
 *   entries `RETIRED_UNSURE` flags, where the name's retirement is settled but
 *   WHICH storm earned it is not — Carol and Edna were each retired, brought
 *   back, and retired again, and NOAA's own table lists the later year.
 */
export function retirementFor(name, year, basin) {
  if (!name || !Number.isFinite(year)) return null;
  const pool = BASIN_POOL[String(basin || '').toUpperCase()];
  if (!pool) return null;
  const k = key(name, year);

  /* ==> DESCRIPTION IS CHECKED FIRST, ACROSS THE WHOLE POOL, BEFORE ANY
   * ORDINARY MATCH. <== Eta and Iota need a different sentence, and a pool
   * that found an ordinary match first would print the wrong one. They are not
   * in `RETIRED_ATLANTIC` today (§57.51 keeps them out deliberately), so this
   * ordering is belt and braces rather than load-bearing — which is exactly
   * the kind of guard worth keeping, because the day someone folds them in to
   * simplify the generated file, this still says the true thing. */
  for (const p of pool) {
    if (BY_DESCRIPTION[p]?.has(k)) return { kind: 'description', datedToThisStorm: true };
  }
  for (const p of pool) {
    if (BY_NAME[p]?.has(k)) return { kind: 'name', datedToThisStorm: !RETIRED_UNSURE[k] };
  }
  return null;
}

/**
 * The wall's predicate, bound to one basin bucket.
 *
 * ==> IT COUNTS ETA AND IOTA, AND THE PANEL'S SENTENCE OPTS IN SEPARATELY.
 * <== A filter has no wording to get wrong, and the WMO counts the Greek pair
 * among its own retirements — `tools/test-retired-names.mjs` reconciles the
 * Atlantic decade sums against published figures and leaving the two out drops
 * the 2020s from 10 to 8. So a reader asking the wall for retired storms gets
 * the WMO's answer; only the sentence has to be careful about HOW they were
 * retired.
 *
 * ==> THE MEMO LIVES HERE RATHER THAN IN THE VIEW, AND THAT IS WHERE IT
 * BELONGS RATHER THAN WHERE IT IS CONVENIENT. <== It was a trio of module
 * variables in `ui/view-seasons-wall.js` first, and `doc-check` pushed that
 * file over §12's ceiling, which was the gate doing its job: a cache over an
 * index is the business of whoever builds the index. The returned predicate
 * runs over every storm in the basin on every repaint — 2,004 of them in the
 * Atlantic, on every chip tap and every frame of a threshold drag — so
 * flattening two `Set`s inside that loop would be work every reader pays for
 * to answer a question most are not asking.
 *
 * Safe to cache forever: the lists are frozen at module load and there are two
 * basins.
 *
 * @param {string} wallBasin  `atlantic` or `epacific`
 * @returns {(name:string, year:number) => boolean}
 */
const PREDICATES = new Map();

export function retiredPredicateFor(wallBasin) {
  if (PREDICATES.has(wallBasin)) return PREDICATES.get(wallBasin);

  const prefixes = WALL_BASINS[wallBasin];
  /* An unknown basin matches nothing rather than everything. The honest
   * failure for a bucket we cannot index is an empty wall, which is loud. */
  const fn = prefixes ? build(prefixes) : () => false;
  PREDICATES.set(wallBasin, fn);
  return fn;
}

function build(prefixes) {
  const all = new Set();
  for (const p of prefixes) {
    for (const k of BY_NAME[p]) all.add(k);
    for (const k of BY_DESCRIPTION[p]) all.add(k);
  }

  /* ==> `!!name` IS A SHORTCUT, NOT THE GUARD, AND THE REDUNDANCY IS RECORDED
   * RATHER THAN TIDIED. <== An unnamed storm keys as `|1954`, which is in no
   * index, so the `Set` lookup would answer false on its own — a mutation
   * deleting this test survives every assertion in the suite and that is
   * correct rather than a hole. It is kept because 1,139 of the Atlantic's
   * 2,004 storms carry no name, and skipping a lookup for each of them on
   * every repaint is worth one `&&`. The BEHAVIOUR is asserted whichever rule
   * is carrying it. */
  return (name, year) => !!name && all.has(key(name, year));
}

/** For the suite, so it can walk the same index the app reads rather than
 *  rebuilding one that could agree with a bug. */
export const __internals = { key, BY_NAME, BY_DESCRIPTION, WALL_BASINS, BASIN_POOL };
