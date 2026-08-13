/**
 * category.js — Saffir-Simpson category from wind, and its labels/colors.
 *
 * Pure functions. Wind arrives in KNOTS — always (SPEC §8). Every threshold is
 * defined in knots in config/constants.js; this file is the only place they
 * are applied.
 *
 * Imports: config/ only.
 */

import { CATEGORY_THRESHOLD_KT, CATEGORY_TOP_KT } from '../config/constants.js';
import { CATEGORY_COLOR, HURRICANE_UNKNOWN_COLOR, PREGENESIS_COLOR } from '../config/tokens.js';

/* ---------------------------------------------------------------------------
 * CLASS MIDPOINTS — the wind a classification stands for when no number exists.
 *
 * WHY THIS IS NEEDED. GDACS publishes no current wind speed at all. It states
 * a classification in words ("Tropical Storm") and, separately, a FORECAST
 * PEAK. Anything downstream that wants a number for a GDACS storm's present
 * strength has three options: use the peak (wrong — it describes a moment that
 * has not happened), use the class FLOOR (understates every storm by up to a
 * full category), or use the middle of the class's range. The middle is the
 * honest one: given only "this is a tropical storm", the expected wind is the
 * centre of the tropical-storm band, not its lowest possible value.
 *
 * DERIVED, NOT HAND-TYPED (SPEC §12: "the constants file holds SOURCES;
 * anything downstream is arithmetic on them"). Each class's midpoint is
 * computed from CATEGORY_THRESHOLD_KT itself, so editing a breakpoint moves
 * the midpoint with it and the two can never drift apart. Cat 5 is
 * open-ended and takes CATEGORY_TOP_KT as its nominal upper bound.
 *
 * THIS IS NOT A MEASUREMENT AND MUST NEVER BE DISPLAYED AS ONE. It is a
 * stand-in for ranking and for visual ramps. SPEC §5 forbids stating a
 * fabricated number as fact — the storm panel still omits wind for a GDACS
 * storm rather than printing a midpoint as if the source had said it.
 * ------------------------------------------------------------------------- */

/** Ascending by floor, so each entry's ceiling is the next one's floor. */
const ASCENDING = [...CATEGORY_THRESHOLD_KT].sort((a, b) => a.min - b.min);

const MID_BY_INDEX = ASCENDING.map((t, i) => {
  const top = i + 1 < ASCENDING.length ? ASCENDING[i + 1].min : CATEGORY_TOP_KT;
  return (t.min + top) / 2;
});

/** Floor of the lowest hurricane class (Cat 1), for the unknown-category case. */
const HURRICANE_FLOOR_KT = ASCENDING.find((t) => t.category === 2)?.min ?? 64;



/**
 * Wind (kt) → category index: 0 = TD, 1 = TS, 2..6 = Cat 1..5. Null in →
 * null out (GDACS sometimes has no wind; unknown is unknown, not TD).
 */
export function categoryFromKt(windKt) {
  if (windKt == null || !isFinite(windKt)) return null;
  for (const t of CATEGORY_THRESHOLD_KT) {
    if (windKt >= t.min) return t.category;
  }
  return 0;
}

/** Index → color, honoring SPEC §6: non-tropical / unknown-category storms get
 *  the GENERIC hue, never a Saffir-Simpson color they haven't earned. */
const BY_INDEX = [
  CATEGORY_COLOR.TD,
  CATEGORY_COLOR.TS,
  CATEGORY_COLOR.CAT1,
  CATEGORY_COLOR.CAT2,
  CATEGORY_COLOR.CAT3,
  CATEGORY_COLOR.CAT4,
  CATEGORY_COLOR.CAT5,
];

/** `nature` values that carry a meaningful Saffir-Simpson reading. */
const CATEGORIZABLE = new Set(['tropical', 'subtropical']);

/** `nature` values for a system that is NOT a tropical cyclone and is not the
 *  wreck of one either — nothing has happened here yet. Deliberately excludes
 *  `post-tropical`: that one WAS a cyclone and keeps the louder hue. */
const UNGRADED_SYSTEM = new Set(['potential', 'remnant']);

/**
 * A representative wind in knots for a classification with no measured wind.
 *
 * Returns null when there is nothing to stand for — an unknown classification
 * is unknown, and callers must degrade rather than invent. Never call this
 * when a real `windKt` exists; the measurement always wins.
 *
 * `code` handles GDACS's "HU": hurricane strength with NO Saffir-Simpson
 * number, because its strongest published band IS the Cat 1 floor and a Cat 1
 * is indistinguishable from a Cat 5 in everything it publishes (SPEC §6). The
 * midpoint of the WHOLE hurricane range is the right answer there for the same
 * reason the per-class midpoint is right elsewhere: given only "somewhere at
 * or above hurricane force", the centre of that span is the expected value.
 */
export function representativeKt(category, nature, code = null) {
  if (!CATEGORIZABLE.has(nature)) return null;
  if (category == null) {
    return code === 'HU' ? (HURRICANE_FLOOR_KT + CATEGORY_TOP_KT) / 2 : null;
  }
  return MID_BY_INDEX[category] ?? null;
}

/**
 * Index → color.
 *
 * `code` is the optional source-reported intensity letter, and it exists for
 * ONE case: GDACS's "HU". Its strongest published wind band is the Cat 1
 * floor, so it can report hurricane strength without a Saffir-Simpson number.
 * That is a real severity and must not fall through to the generic hue, where
 * a typhoon would read duller than the tropical storm beside it.
 *
 * Honors §6 otherwise: non-tropical or genuinely unknown gets GENERIC, never
 * a Saffir-Simpson color it has not earned.
 */
export function categoryColor(category, nature, code = null) {
  /* ==> "NOT GRADED" IS TWO DIFFERENT STATES AND ONE HUE WAS ANSWERING BOTH.
   *
   * `potential` and `remnant` are systems NHC declines to grade because they
   * are NOT cyclones — a Potential Cyclone, a low, a disturbance, a wave. They
   * were drawing in the brick GENERIC, which reads hotter than the TD blue a
   * storm gets the moment it IS graded, so the earliest and weakest stretch of
   * a track shouted louder than the storm it became. `PREGENESIS_COLOR` is the
   * globe's own furniture family — see config/tokens.js for why that is the
   * already-settled answer to "how do you draw a maybe".
   *
   * `post-tropical` deliberately does NOT come here. It was a named cyclone and
   * can still be lethal, so it keeps the hue that holds the eye. */
  if (UNGRADED_SYSTEM.has(nature)) return PREGENESIS_COLOR;
  if (!CATEGORIZABLE.has(nature)) return CATEGORY_COLOR.GENERIC;
  if (category == null) {
    return code === 'HU' ? HURRICANE_UNKNOWN_COLOR : CATEGORY_COLOR.GENERIC;
  }
  return BY_INDEX[category] ?? CATEGORY_COLOR.GENERIC;
}

/** Compact code for drawing INSIDE a forecast point (§7). Two characters
 *  maximum — "TD", "TS", "1".."5" — because it has to fit in a circle at
 *  z4 on a phone. This is deliberately not `categoryShortLabel`: that one
 *  says "Cat 3" for a list row, which will not fit in a dot. Anything
 *  without an earned Saffir-Simpson reading gets no code at all rather than
 *  a guessed one; the dot's color still carries §6. */
export function categoryDotCode(category, nature) {
  if (!CATEGORIZABLE.has(nature) || category == null) return '';
  if (category === 0) return 'TD';
  if (category === 1) return 'TS';
  const n = category - 1;
  return n >= 1 && n <= 5 ? String(n) : '';
}

/** Short label for list rows: "TD", "TS", "Cat 1".."Cat 5". */
export function categoryShortLabel(category, nature, code = null) {
  if (!CATEGORIZABLE.has(nature)) {
    // Trust NHC's own label for what kind of thing it is (SPEC §4).
    if (nature === 'post-tropical') return 'Post-Trop';
    if (nature === 'potential') return 'Potential';
    if (nature === 'remnant') return 'Remnant';
    return '—';
  }
  /* Hurricane strength, category unavailable — say so rather than showing a
   * dash, which reads as "no data" for a storm we know is a hurricane. */
  if (category == null) return code === 'HU' ? 'HU' : '—';
  if (category === 0) return 'TD';
  if (category === 1) return 'TS';
  return `Cat ${category - 1}`;
}
