/**
 * category.js — Saffir-Simpson category from wind, and its labels/colors.
 *
 * Pure functions. Wind arrives in KNOTS — always (SPEC §8). Every threshold is
 * defined in knots in config/constants.js; this file is the only place they
 * are applied.
 *
 * Imports: config/ only.
 */

import { CATEGORY_THRESHOLD_KT } from '../config/constants.js';
import { CATEGORY_COLOR } from '../config/tokens.js';

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

export function categoryColor(category, nature) {
  if (!CATEGORIZABLE.has(nature) || category == null) return CATEGORY_COLOR.GENERIC;
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
export function categoryShortLabel(category, nature) {
  if (!CATEGORIZABLE.has(nature)) {
    // Trust NHC's own label for what kind of thing it is (SPEC §4).
    if (nature === 'post-tropical') return 'Post-Trop';
    if (nature === 'potential') return 'Potential';
    if (nature === 'remnant') return 'Remnant';
    return '—';
  }
  if (category == null) return '—';
  if (category === 0) return 'TD';
  if (category === 1) return 'TS';
  return `Cat ${category - 1}`;
}
