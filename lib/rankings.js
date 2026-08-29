/**
 * rankings.js — where one storm stands against the whole archive.
 * SPEC-SEASONS-BUILD.md §57.44, §57.42 Tier 1 item 11.
 *
 * ==> ONE MODULE, IMPORTED BY BOTH SIDES, FOR THE SAME REASON `hurdat.js` IS.
 * <== `tools/seasons-rankings.mjs` builds the ladder on a runner and this
 * panel reads it on a phone. If the two disagreed about which statistics exist
 * or which end of one is rank 1, the file would still parse and every rank on
 * screen would be wrong with nothing to say so. They share this file instead.
 *
 * ==> A RANK IS ONLY EVER TAKEN AGAINST STORMS THAT HAVE THE FIGURE. <== The
 * same rule `rankInSeason` already follows one screen up, and it matters far
 * more here: 1,254 of the Atlantic's 2,004 storms carry any pressure reading
 * at all, measured 2026-08-29. "3rd lowest of 3,266" would be a claim about a
 * set that does not exist, and it would be wrong by a third.
 *
 * No DOM, no network, no clock.
 */

import { SEASONS } from '../config/constants.js';
import { nmPerDisplayUnit, resolveSystem } from './units.js';

/**
 * A stored nautical mile, in display units, rounded the way `formatDistance`
 * rounds it. §57.46.
 *
 * ==> IT TAKES THE RATIO FROM `lib/units.js` RATHER THAN CARRYING ITS OWN.
 * <== That file keeps 1.15077945 and 1.852 private on purpose, and a second
 * copy here is a second opinion about how long a mile is — one that would
 * agree today and drift the moment anybody touched either. `nmPerDisplayUnit`
 * exists so a caller can convert without knowing the numbers.
 *
 * ==> AND IT MIRRORS THE DECIMAL BRANCH, NOT JUST THE CONVERSION. <==
 * `formatDistance` prints one decimal under ten display units. Rounding
 * everything would put a storm just above the archive's distance floor on a
 * rung it does not print, which is the ACE fault at a sample size of one.
 */
function quantizeDisplay(nm, system) {
  const v = nm / nmPerDisplayUnit(system);
  return v < 10 ? Number(v.toFixed(1)) : Math.round(v);
}

/* ---------------------------------------------------------------------------
 * ROUNDING
 * ------------------------------------------------------------------------- */

/**
 * ==> A RUNG IS THE NUMBER THE PANEL PRINTS, PRODUCED BY THE OPERATION THE
 * PANEL PRINTS IT WITH. <== §57.44.
 *
 * The first version quantized everything with `Math.round(v / step) * step`,
 * which is the obvious way and is WRONG for a decimal step. `(6.55).toFixed(1)`
 * is `6.5`, because 6.55 is not exactly 6.55 in binary and is stored a hair
 * below; `Math.round(6.55 / 0.1) * 0.1` is `6.6`, because the division lands a
 * hair above. **Five real storms in the archive printed one ACE and ranked at
 * another** — exactly the fault the rule was written to prevent, arriving
 * through the rule's own implementation. `tools/test-rankings.mjs` found it by
 * running every real ACE value through both.
 *
 * So each statistic names the operation its renderer uses, and both sides call
 * the same one. Agreement is then by construction rather than by coincidence.
 * The NAME travels in the file, so a ladder built by an older runner still says
 * how to read it.
 *
 * ==> ADDING A STATISTIC MEANS READING ITS RENDERER, NOT PICKING FROM THIS
 * LIST. <== If a new figure is printed some third way, it needs a third
 * quantizer here rather than the closest fit.
 */
export const QUANTIZERS = Object.freeze({
  /** Whole units. `formatPressure`, `windWords` and `spanWords` all use
   *  `Math.round`, so this is theirs. */
  round: (v) => Math.round(v),
  /** One decimal, via `toFixed` because that is what `lifeHtml` prints ACE
   *  with. Not `Math.round(v * 10) / 10`, which disagrees with it. */
  fixed1: (v) => Number(v.toFixed(1)),

  /* ==> DISTANCE NEEDS TWO QUANTIZERS AND EVERY OTHER STATISTIC NEEDS ONE,
   * BECAUSE IT IS THE ONLY ONE WHOSE PRINTED FIGURE DEPENDS ON THE READER.
   * <== §57.46. Wind prints its knots in brackets, pressure is millibars
   * everywhere, lifespan is hours and ACE is a bare index — each has ONE
   * printed rounding, so one rung serves it. `formatDistance` renders the same
   * stored nautical mile as miles or as kilometres, and those two roundings
   * carve the archive into different classes.
   *
   * MEASURED over both mirrored basins: a rung of whole NAUTICAL MILES would
   * split **575 storms that print the identical mile figure** — three storms
   * all reading `1,014 mi` at ranks one apart — and 263 that print the
   * identical kilometre figure. That is precisely the fault §57.44's rung rule
   * was written to prevent, arriving through a statistic that rule did not
   * anticipate. A rung of whole kilometres is worse in the other direction:
   * 999 storms print the same miles and would rank apart.
   *
   * ==> SO THERE IS NO SINGLE HONEST RUNG, AND THE LADDER IS BUILT TWICE. <==
   * `RANK_STATS` carries `trackDistanceMi` and `trackDistanceKm`, identical
   * but for these two, and `rankStorm` reads whichever matches the reader.
   *
   * ==> EACH ONE REPRODUCES `formatDistance` EXACTLY, INCLUDING ITS DECIMAL
   * BRANCH. <== That function prints one decimal under ten display units and
   * whole ones above, because "0 miles" for something 0.4 miles away is
   * actively wrong. A quantizer that rounded everything would disagree with
   * the panel for a storm just over the floor, which is the single-storm
   * version of the ACE fault. `tools/test-rankings.mjs` sweeps the conversion
   * and demands the rung and the raw value render as the same string. */
  miles: (nm) => quantizeDisplay(nm, 'imperial'),
  km: (nm) => quantizeDisplay(nm, 'metric'),
});

/**
 * Is a pool big enough that a rank taken against it means anything?
 *
 * ==> IT IS A FUNCTION RATHER THAN AN INLINE COMPARISON BECAUSE A GUARD WHOSE
 * CONDITION IS FALSE TODAY CANNOT BE TESTED THROUGH ITS OUTPUT. <== Mutation
 * run 2026-08-29: deleting the floor from the builder changed not one byte of
 * the shipped file, because the thinnest ladder in the archive is the East
 * Pacific's pressure at 754. So the rule survived deletion silently — which is
 * §12's failure with the guard and the test swapped round. Pulled out here, it
 * can be driven directly and the deletion goes red.
 *
 * The day it matters is step 13: the South Atlantic carries a handful of
 * storms in the entire record, and a scope that small must produce no rank
 * rather than a proud one.
 */
export function meetsFloor(count) {
  return Number.isFinite(count) && count >= SEASONS.rankingsMinStorms;
}

/**
 * Do the two ways of counting the archive agree?
 *
 * ==> THE SAME REASON `meetsFloor` IS A FUNCTION, AND A SHARPER ONE. <== This
 * is the guard against the exact 2x that blocked this item for a week (§57.42):
 * `seasons/data/` holds the per-season slices AND the two cumulative files, so
 * a walk that reads both counts every storm twice. Today they agree at 3,266
 * each, so deleting the check changes nothing observable — and the suite was
 * green over its removal until this was lifted out.
 */
export function countsAgree(cumulative, slices) {
  return Number.isFinite(cumulative) && Number.isFinite(slices) && cumulative === slices;
}

/** The rung `value` sits on, or null when the statistic is unreadable. */
export function toRung(quantize, value) {
  const q = QUANTIZERS[quantize];
  if (!q || !Number.isFinite(value)) return null;
  const r = q(value);
  return Number.isFinite(r) ? r : null;
}

/* ---------------------------------------------------------------------------
 * WHAT GETS RANKED
 * ------------------------------------------------------------------------- */

/**
 * The track length this storm can be ranked on, or null. §57.46.
 *
 * ==> ONE FUNCTION FOR BOTH ENTRIES, SO THE PAIR CANNOT DRIFT. <== They differ
 * only in which unit they round to; if the floor rule were written twice, a
 * later change to one would leave metric readers ranking three storms
 * imperial readers do not, and nothing on either screen would look wrong.
 */
function readRankableDistance(f) {
  const nm = f?.trackDistance?.totalNm;
  return Number.isFinite(nm) && nm >= SEASONS.trackDistanceFloorNm ? nm : null;
}

/**
 * ==> `quantize` NAMES THE ROUNDING THE PANEL PRINTS THE FIGURE WITH, AND THAT
 * IS THE WHOLE RULE. <== ACE renders as one decimal, so two storms both showing
 * `12.4` must share a rank; ranking them at full float precision puts one forty
 * places above the other while the screen shows the same number twice. Every
 * entry below is read off its renderer rather than chosen — see `QUANTIZERS`
 * for what went wrong when one was chosen.
 *
 * `direction` is which end is first place. `low` for pressure, because a deep
 * storm is a strong one.
 */
export const RANK_STATS = Object.freeze({
  peakWindKt: Object.freeze({
    direction: 'high',
    quantize: 'round',
    read: (f) => f?.peakWindKt,
    /* `windWords` prints `Math.round(kt)`, and HURDAT2 winds are whole knots
     * in 5 kt increments anyway. */
    label: 'Peak winds',
    superlative: 'strongest',
  }),
  lowestPressureMb: Object.freeze({
    direction: 'low',
    quantize: 'round',
    read: (f) => f?.lowestPressureMb,
    /* `formatPressure` prints `Math.round(mb)`. */
    label: 'Lowest pressure',
    superlative: 'lowest',
  }),
  lifespanHours: Object.freeze({
    direction: 'high',
    quantize: 'round',
    read: (f) => f?.lifespanHours,
    /* `spanWords` prints whole hours. */
    label: 'Lifespan',
    superlative: 'longest-lived',
  }),
  hoursAtMajor: Object.freeze({
    direction: 'high',
    quantize: 'round',
    read: (f) => (Number.isFinite(f?.hoursAtMajor) && f.hoursAtMajor > 0 ? f.hoursAtMajor : null),
    /* ==> ZERO IS EXCLUDED RATHER THAN RANKED LAST. <== The same rule
     * `lifeHtml` already applies to the row itself: a storm that never became
     * a major hurricane did not come last at being one, it simply never was
     * one. Ranking the 2,600 storms that never reached it would make "1,900th
     * of 3,266" the ordinary answer and say nothing. */
    label: 'At major strength',
    superlative: 'longest',
  }),
  ace: Object.freeze({
    direction: 'high',
    quantize: 'fixed1',
    read: (f) => (Number.isFinite(f?.ace) && f?.aceRecords > 0 ? f.ace : null),
    /* `lifeHtml` prints `.toFixed(1)`, and it declines to print ACE at all
     * when no synoptic record backed it. The read matches, so a storm with no
     * ACE row cannot pick up an ACE rank. */
    label: 'ACE',
    superlative: 'highest',
  }),
  fastest24hGainKt: Object.freeze({
    direction: 'high',
    quantize: 'round',
    read: (f) => {
      const g = f?.fastest24h?.gainKt;
      /* ==> A LOSS IS NOT A SLOW GAIN. <== `changeHtml` refuses to print a
       * non-positive best window, because labelling a weakening storm's least
       * bad day "intensification" is wrong. Ranking it would be the same
       * wrongness with a number on it. */
      return Number.isFinite(g) && g > 0 ? g : null;
    },
    label: 'Fastest strengthening',
    superlative: 'fastest',
  }),

  /* ==> ONE FACT, TWO ENTRIES, AND ONLY ONE OF THEM EVER REACHES A PANEL. <==
   * §57.46. `rankStorm` skips the entry whose `system` is not the reader's, so
   * a storm shows `Distance travelled` once and `rankingsMaxRows` counts it
   * once. The pair exists because the printed figure is unit-dependent and a
   * rung must be the number the panel prints — see `QUANTIZERS`.
   *
   * ==> A STORM UNDER THE ARCHIVE'S DISTANCE FLOOR IS EXCLUDED, NOT RANKED
   * LAST. <== The same rule `hoursAtMajor` already applies. Three storms in
   * the archive have a track the record never moves, and `movementHtml` prints
   * `no movement recorded` for them precisely because the figure is not a
   * measurement of a short track — so `3,232nd longest of 3,234` beside it
   * would be a rank taken on a number the panel has just declined to state. */
  trackDistanceMi: Object.freeze({
    direction: 'high',
    quantize: 'miles',
    system: 'imperial',
    read: (f) => readRankableDistance(f),
    label: 'Distance travelled',
    superlative: 'longest track',
  }),
  trackDistanceKm: Object.freeze({
    direction: 'high',
    quantize: 'km',
    system: 'metric',
    read: (f) => readRankableDistance(f),
    label: 'Distance travelled',
    superlative: 'longest track',
  }),
});

/* ---------------------------------------------------------------------------
 * THE FILE
 * ------------------------------------------------------------------------- */

/**
 * ==> THE HALF OF THE FILENAME THAT MOVES WHEN *WE* CHANGE THE FILE'S MEANING,
 * AND IT EXISTS BECAUSE ITS ABSENCE REACHED A PHONE. <== §57.47.
 *
 * §57.44 named the danger and got the direction wrong. It reasoned that the
 * stamp had to carry every basin's revision "so a stamp that failed to move
 * when NOAA revised one basin would leave a stale ladder on every returning
 * phone until 2027" — correct, and it protects against NOAA changing the
 * INPUT. It never considered that this repo could change the OUTPUT.
 *
 * §57.46 did exactly that: `RANK_STATS` gained two entries, the file gained
 * two ladders per scope, and the name did not move because NOAA had not
 * revised anything. `_headers` holds `/seasons/data/*` immutable for a year,
 * so every phone that had ever opened the archive went on serving the
 * six-statistic table. Aaron opened Sandy on glass and the distance row was
 * simply not there — no error, no empty section, a panel that looked
 * completely correct and was a version behind.
 *
 * ==> BUMP THIS WHENEVER THE FILE'S SHAPE OR CONTENT RULES CHANGE. <== A new
 * statistic, a changed quantizer, a changed floor, a changed `read`. The test
 * for whether it needs bumping is not "did the code change" but "would a
 * phone holding yesterday's file be wrong", and the answer is yes for every
 * one of those.
 */
export const RANKINGS_SCHEMA = 'v2';

/**
 * Which rankings file belongs to this index, derived identically on both
 * sides.
 *
 * ==> IT IS DERIVED RATHER THAN NAMED IN `index.json`, AND THAT IS A WRITER
 * RULE, NOT A STYLE CHOICE. <== §57.40a: two jobs must never write one file.
 * `index.json` belongs to the mirror job; a rankings job that edited it to add
 * its own filename would be the second writer, and the failure mode is a lost
 * edit that nothing detects. Both sides compute the same string from the
 * revisions the index already carries instead.
 *
 * ==> THE STAMP IS EVERY CONTRIBUTING BASIN'S REVISION, DEDUPLICATED AND
 * SORTED. <== One file spans several basins, so one basin's revision cannot
 * name it. Today both basins are `02272026` and the stamp is `02272026`; the
 * day NOAA revises one and not the other it becomes `02272026-05142026` and
 * the URL changes, which is exactly what has to happen — the file is
 * `immutable` for a year under `_headers`, so a stamp that failed to move
 * would leave a stale ladder on every returning phone until 2027.
 *
 * @param {object} basins  `index.basins`, or any map of `{revision}`
 * @returns {{revision:string, file:string}|{revision:null, file:null}}
 */
export function rankingsFileName(basins) {
  const revisions = [...new Set(Object.values(basins || {})
    .map((b) => b?.revision)
    .filter((r) => typeof r === 'string' && r))].sort();
  if (!revisions.length) return { revision: null, file: null };
  const revision = revisions.join('-');
  return { revision, file: `rankings-${RANKINGS_SCHEMA}-${revision}.json` };
}

/**
 * The order scopes are read in: the storm's own basin first, then everything.
 *
 * ==> BASIN LEADS BECAUSE IT IS THE HONEST COMPARISON. <== Aaron's call
 * 2026-08-29. One basin is one agency, one set of instruments and one span of
 * coverage; the cross-basin figure is the one people want and the one with the
 * caveats, so it goes second in the sentence rather than first.
 */
export function scopeOrder(members) {
  return [...(members || []), 'all'];
}

/* ---------------------------------------------------------------------------
 * THE LOOKUP
 * ------------------------------------------------------------------------- */

/**
 * Where `value` sits on one ladder.
 *
 * Rank is how many storms are strictly better, plus one — so ties share a
 * place and the next value down skips, which is how ranks are read everywhere
 * else. `tied` counts this storm too, matching `rankInSeason`'s shape exactly
 * so one renderer can read either.
 *
 * @returns {{rank:number, tied:number, of:number}|null}
 */
export function placeOn(ladder, value) {
  if (!ladder || !Number.isFinite(value)) return null;
  const { values, counts, direction, quantize } = ladder;
  if (!Array.isArray(values) || !Array.isArray(counts)) return null;
  if (values.length !== counts.length || !values.length) return null;

  /* Rounded the same way the ladder was built AND the same way the panel
   * prints it, or a value that is on the ladder by every printed appearance
   * would miss it by float dust. */
  const key = toRung(quantize, value);
  if (key === null) return null;

  let better = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === key) return { rank: better + 1, tied: counts[i], of: ladder.of };
    const isBetter = direction === 'low' ? v < key : v > key;
    if (!isBetter) break;
    better += counts[i];
  }
  /* ==> A VALUE THE LADDER HAS NEVER SEEN GETS NO RANK, RATHER THAN AN
   * INTERPOLATED ONE. <== It means the storm is not in the set this table was
   * built from — the season still running, most likely, whose provisional
   * figures are not part of the reviewed record. Placing it anyway would rank
   * a working number against settled ones and print it with the same
   * confidence. §5: say nothing rather than say something unearned. */
  return null;
}

/**
 * Every rank this storm has, in both scopes, ready for a renderer.
 *
 * @param {object} facts    from `stormFacts`
 * @param {object} table    the parsed rankings file, or null
 * @param {string} basin    the archive basin this storm belongs to
 * @param {string} [system] the reader's measurement preference. §57.46 — it
 *   decides which of the two distance ladders is read. Everything else on the
 *   panel already takes it; this is the first thing in `lib/` that needs it,
 *   and it needs it for the same reason: the rank must match the figure.
 * @returns {{scopes:Array, rows:Array}|null}
 */
export function rankStorm(facts, table, basin, system) {
  if (!facts || !table?.scopes) return null;

  /* ==> A STORM FROM THE SEASON STILL RUNNING GETS NO ARCHIVE RANK, AND THIS
   * IS THE ONLY PLACE THAT RULE CAN LIVE. <== §57.11, §57.44. Its figures come
   * off an operational b-deck NOAA has not reviewed and will move — Katrina's
   * 902 mb is settled, this morning's 968 mb is a working number. The ladder
   * would place it perfectly happily, because 968 is a value the archive holds,
   * and the reader would get "141st lowest on record" printed in exactly the
   * same voice as a figure from 1935.
   *
   * Refused HERE rather than at the call site because the panel is not the only
   * thing that will want ranks — the roster and the wall are both obvious next
   * readers, and a rule enforced in one renderer is a rule the second one has
   * to remember. */
  if (facts.provisional) return null;

  const order = Array.isArray(table.scopeOrder) && table.scopeOrder.length
    ? table.scopeOrder
    : scopeOrder(Object.keys(table.scopes).filter((k) => k !== 'all'));

  /* The storm's own basin, then `all`. A basin the table does not carry is
   * skipped rather than faked — that is what a new basin looks like on the day
   * its data lands and before its ladder is rebuilt. */
  const wanted = order.filter((k) => k === basin || k === 'all');
  const scopes = wanted
    .map((key) => ({ key, ...table.scopes[key] }))
    .filter((s) => s && s.stats);

  if (!scopes.length) return null;

  const rows = [];
  for (const [key, def] of Object.entries(RANK_STATS)) {
    /* ==> A UNIT-DEPENDENT STATISTIC SHIPS ONE LADDER PER UNIT AND THE READER
     * SEES EXACTLY ONE. <== §57.46. `trackDistanceMi` and `trackDistanceKm`
     * are one fact rounded two ways, because a rung has to be the number the
     * panel prints and `formatDistance` prints two different ones. Skipping
     * here rather than filtering the table means the file stays one shape for
     * every reader and the choice is made at the last moment, alongside every
     * other unit decision on this panel.
     *
     * ==> AN ENTRY WITH NO `system` IS UNIT-FREE AND ALWAYS SHOWN. <== Wind
     * prints its knots in brackets, pressure is millibars everywhere, lifespan
     * is hours. Six of the eight entries are in that group and none of them
     * should have to declare anything. */
    if (def.system && def.system !== resolveSystem(system)) continue;

    const mine = def.read(facts);
    if (!Number.isFinite(mine)) continue;

    const places = [];
    for (const scope of scopes) {
      /* ==> A WIND RANK IS DECLINED IN A SCOPE THAT SAYS ITS WINDS ARE NOT
       * COMPARABLE. <== §57.44. Both basins in the archive today are NHC's, so
       * every wind is a one-minute sustained average and `windComparable` is
       * true everywhere. The day the rest of the world lands, a scope mixing a
       * ten-minute Tokyo average with a one-minute Miami one sets it false and
       * this row simply does not appear there — rather than appearing wrong. */
      if (def.direction && key === 'peakWindKt' && scope.windComparable === false) continue;
      const place = placeOn(scope.stats[key], mine);
      if (place) places.push({ scope, place });
    }
    if (places.length) rows.push({ key, def, places });
  }

  return rows.length ? { scopes, rows } : null;
}

/**
 * True when this storm's ranks need the pre-satellite sentence beside them.
 *
 * ==> IT IS A CLAIM ABOUT THE ERA AND IS DECIDED FROM THE YEAR, NEVER FROM THE
 * FIGURES. <== The same rule and the same constant as `seasonFacts`'s
 * `undercountLikely`: before satellites, storms that stayed at sea were never
 * recorded at all, so the denominator under an old storm's rank is a count of
 * what was *written down*. The figures are exactly what cannot show that.
 */
export function eraCaveat(year) {
  return Number.isFinite(year) && year < SEASONS.satelliteEraFrom;
}
