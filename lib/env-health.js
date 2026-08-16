/**
 * env-health.js — the storm health paragraph (SPEC §47.8).
 *
 * A PURE FUNCTION from a parsed SHIPS run to English sentences. No DOM, no
 * network, no module state; the clock and the unit system are arguments, so
 * every sentence it can ever say is testable on plain node.
 *
 * ==> EVERY FIGURE IN EVERY SENTENCE IS COMPUTED, NEVER TYPED. <== This file
 * generates English with numbers in it, which §47.8 calls the single easiest
 * place in the app to be fluently wrong. Its own spec's worked cases were
 * hand-typed twice and wrong both times — a term quoted from a column 24 hours
 * away from the headline, a remainder counting terms that contributed nothing.
 * Everything here reads one array at one index and prints what it read.
 *
 * ==> THE FIGURES LEFT THE PROSE AND WENT INTO A GRID. <== The first version
 * of this file recited its own arithmetic out loud — "shear −2, dry air −2 and
 * cold air aloft −1, and a smaller term and rounding take back 2" — because a
 * paragraph was the only surface it had. It reads like a ledger, which is
 * exactly what §47.8 is not for. The sentences now carry the STORY and the
 * grid under them carries the NUMBERS, and the closure rule moves with them:
 * the cells visibly sum to the headline, so a reader can check the arithmetic
 * instead of being assured of it.
 *
 * THE RULES IT CARRIES (all §47.8, thresholds in config ENV_HEALTH):
 *  - The verdict names the SHAPE of the whole track, never one hour of it,
 *    matched to one of seven shapes; "turning" requires crossing a band
 *    boundary. Too short or too flat falls back to the single furthest hour.
 *  - Every figure in the grid and in the sentences is read at the one hour the
 *    verdict named. Room to grow is the lone exception and is quoted at the
 *    fix — both halves of it, current wind AND the sea's ceiling.
 *  - At most four terms are named, largest first; a term that rounds to zero
 *    in knots is omitted, never listed as 0. A final cell closes the books so
 *    the visible cells always sum to the visible headline, in either unit
 *    system (lib/units closeWindParts). It is called ROUNDING when nothing was
 *    left out and EVERYTHING ELSE when something was.
 *  - Direction comes ONLY from `V (KT) LAND` — the environment never predicts.
 *    Where land decay diverges from the over-water forecast by 10 kt or more,
 *    the coast is named so the fall never reads as the environment's doing.
 *  - Room to grow gets said out loud, and whether it is being USED comes from
 *    the published forecast alone. "Plenty of room and the forecast still has
 *    it easing" is two published numbers set beside each other; "the air is
 *    stopping it from growing" would be this file predicting, and is banned.
 *  - The agreement sentence is REQUIRED on a neutral verdict: quiet and loud
 *    are different warnings wearing the same color.
 *  - Times are the reader's local day and part of day, never UTC, never "+60 h".
 *  - When SHIPS is missing the paragraph is REPLACED, never dropped (§5).
 *
 * PLAIN ENGLISH IS A HARD REQUIREMENT, NOT A PREFERENCE (§47.4). The one term
 * kept from the trade is "wind shear", because every hurricane broadcast on
 * earth uses it and inventing a private name for the most-reported quantity in
 * tropical meteorology makes the app harder to read, not easier. Everything
 * else is said the way a person would say it.
 *
 * PRONOUN: always "it". Two of the spec's worked cases say "she" for storms
 * with women's names; a generator guessing gender from a name would guess
 * wrong somewhere public, and "it" is what NHC's own discussions use.
 *
 * Imports: config/, lib/ siblings only.
 */

import { ENV_HEALTH } from '../config/constants.js';
import { closeWindParts, windDelta, windUnitWord, formatWind } from './units.js';
import { verdict } from './env-verdict.js';
import { at, cap, extremeOf, lastDrawableHr, series, signed } from './env-series.js';

/* ---------------------------------------------------------------------------
 * THE PLAIN-ENGLISH NAMES, §47.4. One fixed name per parser key, whatever the
 * sign. The umbrella term stays "environment", one thing one name.
 *
 * ==> A NAME HAS TO SURVIVE BOTH SIGNS, AND "DRY AIR" DID NOT. <== The
 * `700-500 MB RH` row is POSITIVE when the air around the storm is moist and
 * that is helping it. Named "dry air", a helping hour printed as "dry air +2",
 * which reads as dryness doing the storm a favor — the exact opposite of what
 * the file says. Named for the quantity rather than for one end of it,
 * "moisture around it +2" and "moisture around it −2" are both true. Every
 * name here is checked the same way: read it aloud with a plus and with a
 * minus, and if only one of the two is honest the name is wrong.
 * ------------------------------------------------------------------------- */
const TERM_NAME = Object.freeze({
  shear: 'wind shear',
  tempAloft: 'cold air above it',
  thetaE: 'warm moist air',
  midRh: 'moisture around it',
  vorticity: 'spin in the air around it',
  divergence: 'air flowing out the top',
  tempAdvection: 'warm air moving in',
  oceanHeat: 'deep warm water',
});

/** The parser's key order, which breaks magnitude ties so the same run always
 *  names the same terms. */
const KEY_ORDER = Object.freeze([
  'shear', 'tempAloft', 'thetaE', 'midRh', 'vorticity', 'divergence',
  'tempAdvection', 'oceanHeat',
]);

/* ---------------------------------------------------------------------------
 * PARTS 2 AND 3 — WHAT IS ACTING ON IT.
 *
 * ==> ONE HOUR'S TERMS, READ ONCE, USED TWICE. <== The story sentence and the
 * figures grid must never disagree, so both are built from the same `ranked`
 * list at the same column. Two functions each doing their own ranking is how
 * a paragraph ends up naming a factor the grid below it does not show.
 * ------------------------------------------------------------------------- */

/**
 * Every non-zero term at one hour, ranked by magnitude (ties by the parser's
 * key order), capped, and CLOSED — the figures carry the converted values that
 * sum, with the leftovers in `remainder`.
 */
function rankedAt(run, hr, sys) {
  const c = run.hours.indexOf(hr);

  const all = KEY_ORDER
    .map((key) => ({ key, kt: run.terms[key][c] }))
    .filter((t) => t.kt !== 0)
    .sort((a, b) => Math.abs(b.kt) - Math.abs(a.kt) ||
      KEY_ORDER.indexOf(a.key) - KEY_ORDER.indexOf(b.key));

  const named = [];
  let pos = 0, neg = 0;
  for (const t of all) {
    if (named.length >= ENV_HEALTH.namedTermsMax) break;
    if (t.kt > 0 && pos >= ENV_HEALTH.namedPerSideMax) continue;
    if (t.kt < 0 && neg >= ENV_HEALTH.namedPerSideMax) continue;
    named.push(t);
    if (t.kt > 0) pos++; else neg++;
  }

  const closed = closeWindParts(run.environmentKt[c], named.map((t) => t.kt), sys);
  const display = named.map((t, i) => ({ ...t, v: closed.named[i] }));

  return {
    c,
    all,
    display,
    against: display.filter((t) => t.kt < 0),
    forIt: display.filter((t) => t.kt > 0),
    omitted: all.length - named.length,
    total: closed.total,
    remainder: closed.remainder,
  };
}

/**
 * The STORY sentence — which way the weight sits, in words, with no figures in
 * it at all. The figures are directly underneath in the grid, and a sentence
 * that repeats them is the ledger §47.8 got rid of.
 */
function termsStory(run, hr, sys) {
  const r = rankedAt(run, hr, sys);
  if (!r.all.length) return 'Nothing is pulling either way at that hour.';

  const netKt = run.environmentKt[r.c];
  const top = r.all[0];
  const topShare = netKt !== 0 && Math.sign(top.kt) === Math.sign(netKt)
    ? Math.abs(top.kt) / Math.abs(netKt) : 0;
  const lead = r.display.find((t) => t.key === top.key);

  const names = (ts) => {
    const parts = ts.map((t) => TERM_NAME[t.key]);
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  };

  const main = (lead ? lead.kt : top.kt) < 0 ? 'against' : 'for';
  const mainSide = main === 'against' ? r.against : r.forIt;
  const other = main === 'against' ? r.forIt : r.against;

  /* ==> THE OTHER SIDE IS ITS OWN SENTENCE, INCLUDING WHEN IT IS EMPTY. <==
   * "Nothing at all is working in its favor" is not filler: a storm being
   * ground down from every direction and one with something on its side are
   * different situations, and the reader cannot tell them apart from the
   * headline figure. It was a trailing clause and it read as an afterthought
   * hung off a sentence that was already carrying two ideas. */
  const word = main === 'against' ? 'working in its favor' : 'working against it';
  const otherSentence = !other.length
    ? ` Nothing at all is ${word}.`
    : other.length === 1
      ? ` The only thing ${word} is ${TERM_NAME[other[0].key]}.`
      : ` ${cap(word)}: ${names(other)}.`;

  if (lead && topShare >= ENV_HEALTH.dominantHi) {
    return `Almost all of that is ${TERM_NAME[lead.key]}.${otherSentence}`;
  }
  if (lead && topShare >= ENV_HEALTH.dominantLo && Math.abs(top.kt) >= ENV_HEALTH.sideKt) {
    return `Most of that is ${TERM_NAME[lead.key]}.${otherSentence}`;
  }

  /* ==> NOTHING LEADS, AND SAYING SO IS THE HARD SENTENCE TO WRITE. <== A
   * storm ground down by four small factors is a different picture from one
   * with a single problem, so it has to be said. The first attempt said it as
   * "No single thing is behind it — X and Y lead a group of small ones", and
   * Aaron could not read it. Three separate faults, all worth remembering:
   *
   *  1. "BEHIND IT" ALREADY MEANS THE OPPOSITE IN THIS PARAGRAPH. The verdict
   *     one sentence earlier says the environment "swings behind it", meaning
   *     helping. Reusing the same words for "is the cause of" put a private
   *     second meaning on a phrase the reader had just learned.
   *  2. "A GROUP OF SMALL ONES" — small WHAT. The noun was never supplied.
   *  3. It contradicted the clause above it. The verdict ended "nearly
   *     everything is pulling the same way" and this ended "with nothing
   *     helping", which are the same fact told twice in words that sound
   *     opposed. That clause is now dropped on non-neutral verdicts entirely
   *     (see agreementClause) — this sentence says the same thing concretely
   *     and better.
   *
   * So: name what is spread, name the noun, and never reuse a direction word
   * as a causation word. */
  /* ==> THE NOUN ECHOES THE VERDICT'S OWN VERB. <== The sentence before this
   * one says "costing up to 5 mph", so "That cost is spread across…" picks the
   * reader up where they were left. It was "damage", which Aaron read as too
   * strong for a five-mph number and which also drifts toward describing what
   * happens to the STORM — and what happens to the storm comes from the
   * published forecast in the last sentence, never from here. A cost is a fact
   * about the environment's own accounting. */
  const spread = main === 'against' ? 'That cost' : 'That gain';
  const biggest = mainSide.slice(0, 2);
  if (mainSide.length >= 3) {
    return `${spread} is spread across several factors rather than one, ` +
      `the largest being ${names(biggest)}.${otherSentence}`;
  }
  if (mainSide.length === 2) {
    return `It comes almost entirely from ${names(biggest)}, in roughly equal ` +
      `measure.${otherSentence}`;
  }
  if (mainSide.length === 1) {
    return `${cap(TERM_NAME[mainSide[0].key])} is doing most of it.${otherSentence}`;
  }
  /* Every named term is on the far side of the headline — a small net that the
   * grid's closing cell carries. Nothing leads because nothing on this side
   * exists to lead. */
  return `${cap(word)}: ${names(other)}.`;
}

/**
 * The FIGURES GRID — the same hour, printed rather than recited.
 *
 * ==> THE CELLS SUM TO THE HEADLINE, VISIBLY, AND THAT IS THE POINT. <== A
 * paragraph can assert that its numbers add up and a reader has to take it on
 * trust; a column of figures under a total either adds up or it does not. The
 * closing cell is what makes it true in either unit system, and it is named
 * for what it actually is: ROUNDING when nothing was left out of the list,
 * EVERYTHING ELSE when something was.
 */
function figuresAt(run, hr, sys) {
  const r = rankedAt(run, hr, sys);
  const unit = windUnitWord(sys);
  const cells = r.display.map((t) => ({
    label: cap(TERM_NAME[t.key]),
    value: `${signed(t.v)} ${unit}`,
  }));
  if (r.remainder !== 0) {
    cells.push({
      label: r.omitted === 0 ? 'Rounding' : 'Everything else',
      value: `${signed(r.remainder)} ${unit}`,
    });
  }
  return { when: at(run, hr), total: `${signed(r.total)} ${unit}`, cells };
}


/**
 * Part 4 — room and structure, the two numbers the color deliberately leaves
 * out. The ceiling pair is read AT THE FIX — both halves from the same column
 * — and the headroom and structure figures at the verdict hour.
 */
function roomSentence(run, hr, sys, name) {
  const c = run.hours.indexOf(hr);
  const unit = windUnitWord(sys);
  const struct = windDelta(run.stormKt[c], sys);
  const structBit = struct === 0 ? ''
    : struct < 0
      ? `its own structure costs ${Math.abs(struct)} ${unit}`
      : `its own structure adds ${struct} ${unit}`;

  /* No published ceiling: say the half that exists rather than inventing the
   * other (§5). The whole 2026 corpus publishes it, so this is a guard. */
  if (run.potIntNowKt == null || run.currentWindKt == null) {
    return structBit ? `${cap(structBit)}.` : '';
  }

  const cur = formatWind(run.currentWindKt, sys);      // "75 mph"
  const ceil = formatWind(run.potIntNowKt, sys);
  const withStruct = structBit ? `, and ${structBit}` : '';
  const pair = `${cur} over water that could hold ${ceil}`;

  /* THE PAIR IS THE SENTENCE. "45 mph of headroom" means nothing on its own;
   * the storm's strength beside the sea's ceiling means everything, and both
   * halves come from hour 0 or the sentence is not true (§47.8). */
  const r = roomRatio(run);
  if (r >= ENV_HEALTH.roomNearRatio) {
    return `${name} is close to its ceiling — ${pair} — so there is not much room ` +
      `left to grow${withStruct}.`;
  }
  if (r >= ENV_HEALTH.roomFarRatio) {
    return `There is some room left to grow — ${pair}${withStruct}.`;
  }
  return `There is plenty of room to grow — ${pair}${withStruct}.`;
}

/** Current wind over the sea's ceiling, BOTH AT THE FIX. Its own function
 *  because two sentences branch on it — the room sentence and the bottom
 *  line's closing clause — and two copies of one ratio is how they later
 *  disagree about the same storm in the same paragraph. */
function roomRatio(run) {
  if (run.potIntNowKt == null || run.currentWindKt == null || !run.potIntNowKt) return null;
  return run.currentWindKt / run.potIntNowKt;
}

/**
 * Part 5 — the bottom line: the PUBLISHED intensity forecast in plain words.
 * Direction comes only from `V (KT) LAND`; the environment and the forecast
 * are allowed to disagree, and the clauses exist to keep that honest.
 */
function bottomLine(run, verdictHr, sys) {
  const hr = lastDrawableHr(run);
  if (hr == null) return '';
  const c = run.hours.indexOf(hr);
  const from = formatWind(run.currentWindKt, sys);
  const to = formatWind(run.vLandKt[c], sys);
  const when = at(run, hr);
  const deltaKt = run.vLandKt[c] - run.currentWindKt;

  /* Land decay: where the two forecasts diverge materially at any drawable
   * hour, the coast is doing work the contribution table never accounts for,
   * and the fall must not read as the environment's (§47.4). */
  let landGap = 0;
  for (let i = 0; i < run.hours.length; i++) {
    if (!run.drawable[i]) continue;
    if (run.vNoLandKt[i] != null && run.vLandKt[i] != null) {
      landGap = Math.max(landGap, run.vNoLandKt[i] - run.vLandKt[i]);
    }
  }

  const envPeakKt = extremeOf(series(run)).kt;
  const envAgainst = envPeakKt <= -ENV_HEALTH.sideKt;
  const envFor = envPeakKt >= ENV_HEALTH.sideKt;

  let clause = '';
  if (landGap >= ENV_HEALTH.landGapKt && deltaKt < 0) {
    clause = ` — and that is the land tearing it down, not the environment`;
  } else if (deltaKt >= ENV_HEALTH.sideKt && envAgainst) {
    clause = `, so the environment slows it rather than stopping it`;
  } else if (deltaKt <= -ENV_HEALTH.sideKt && envFor) {
    clause = `, so the environment is not what brings it down`;
  } else if (deltaKt <= -ENV_HEALTH.sideKt && envAgainst &&
    Math.abs(deltaKt) >= ENV_HEALTH.decayShareRatio * Math.abs(envPeakKt)) {
    clause = `, so the environment and its own decay are pulling the same way`;
  }

  /* ==> WHETHER THE ROOM IS BEING USED, AND IT IS TWO PUBLISHED NUMBERS SET
   * BESIDE EACH OTHER — NEVER AN INFERENCE. <== The room sentence says how far
   * under its ceiling the storm sits; this says what the published forecast
   * does about it. "Plenty of room and the forecast still has it easing" is a
   * fact about `POT. INT.` and `V (KT) LAND` together, and it is the honest
   * answer to the only question a reader actually has about headroom. Saying
   * the air is what stops it from filling that room would be this file
   * predicting, which §47.8 forbids without exception.
   *
   * ONE CLAUSE PER SENTENCE. It is appended only where nothing above claimed
   * the slot, because a bottom line carrying two "so…" clauses is the hedging
   * stack §47.8 rules out. */
  const room = roomRatio(run);
  if (!clause && room != null && room < ENV_HEALTH.roomFarRatio) {
    if (deltaKt <= -ENV_HEALTH.sideKt) {
      clause = `, so the room is there and nothing is using it`;
    } else if (deltaKt >= ENV_HEALTH.sideKt) {
      clause = `, using some of that room`;
    } else {
      clause = `, so the room stays where it is`;
    }
  }

  if (Math.abs(deltaKt) < ENV_HEALTH.sideKt) {
    return `The intensity model holds it near ${from} through ${when}${clause}.`;
  }
  if (deltaKt > 0) {
    return `The intensity model has it reaching ${to} by ${when}${clause}.`;
  }
  return `The intensity model has it falling from ${from} to ${to} by ${when}${clause}.`;
}

/* ---------------------------------------------------------------------------
 * THE ENTRY POINT
 * ------------------------------------------------------------------------- */

/**
 * envHealth — the whole paragraph, or its stated replacement.
 *
 * @param {object|null} result  data/ships.js's four-state answer
 *   ({status, run}), or null when nothing has been fetched.
 * @param {{system?: string, stormName?: string}} opts
 * @returns {{kind:'paragraph', sentences:string[]} |
 *           {kind:'replaced', text:string, retryable:boolean}}
 *
 * REPLACED, NEVER DROPPED (§5). Each absence says which absence it is, in the
 * words §47.9 already uses for the layer row, so the two surfaces never tell
 * two stories about the same missing file.
 */
export function envHealth(result, { system = null, stormName = null } = {}) {
  const replaced = (text, retryable = false) => ({ kind: 'replaced', text, retryable });

  if (!result) return replaced('Environment data has not been checked yet.');
  if (result.status === 'basin') {
    return replaced('Not published for storms in this basin — the intensity model behind this covers the Atlantic and the East and Central Pacific.');
  }
  if (result.status === 'no_run') {
    return replaced('No intensity model run published for this storm yet. A fresh system gets advisories before its first run.');
  }
  if (result.status === 'unavailable') {
    return replaced('Environment data unavailable.', true);
  }
  const run = result.run;
  if (!run) return replaced('Environment data unavailable.', true);

  const pts = series(run);
  if (!pts.length) {
    return replaced('This run publishes no forecast track to color, so there is nothing to measure the environment against.');
  }

  /* The app's own name for the storm wins over the file's header — the file
   * says INVEST where the list says 94L, and the drawer must not call the
   * storm two things on one screen. */
  const name = titleCase(stormName || run.name);
  const v = verdict(run, pts, system, name);

  const sentences = [v.text, termsStory(run, v.hr, system)];
  const room = roomSentence(run, v.hr, system, name);
  if (room) sentences.push(room);
  const bottom = bottomLine(run, v.hr, system);
  if (bottom) sentences.push(bottom);

  return {
    kind: 'paragraph',
    sentences,
    figures: figuresAt(run, v.hr, system),
    /* ==> ONE LINE, AND IT IS PROVENANCE (§47.8). <== This was a `notes` ARRAY
     * carrying three things: the room-and-structure aside, a caveat about runs
     * whose winds outlast their positions, and the credit. On glass that was
     * three grey paragraphs between the figures a reader came for and the
     * legend explaining them — a wall nobody read, and Aaron cut all of it on
     * 2026-08-16. What survives is the credit, and it now sits UNDER the
     * legend, which is where provenance belongs: last, after the thing it is
     * the provenance of.
     *
     * THE TWO EXCLUDED FIGURES LEFT THE APP WITH IT, and that is the real cost
     * of this cut. Room to grow and the storm's own structure have no other
     * home — they cannot join the grid, because the grid's contract is that its
     * cells SUM TO THE COLORED NUMBER and neither of them is part of it. */
    source: "From NHC's SHIPS intensity model.",
  };
}

/** "HERNAN" → "Hernan"; invests stay as published ("94L" would arrive as
 *  "INVEST" — the parser's name field — which reads fine title-cased). */
function titleCase(s) {
  if (!s) return 'This storm';
  return s.split(/\s+/).map((w) =>
    /^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
}
