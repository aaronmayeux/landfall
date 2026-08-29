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
});

/* ---------------------------------------------------------------------------
 * THE FILE
 * ------------------------------------------------------------------------- */

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
  return { revision, file: `rankings-${revision}.json` };
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
 * @returns {{scopes:Array, rows:Array}|null}
 */
export function rankStorm(facts, table, basin) {
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
