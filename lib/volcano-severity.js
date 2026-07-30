/**
 * volcano-severity.js — the three catalog channels, normalised to 0–1 and
 * combined into one equally-weighted score.
 *
 * ==> THIS FILE EXISTS SO THE MISSING-VALUE RULE HAS EXACTLY ONE HOME. <== The
 * rule is three lines of arithmetic and a branch, which is precisely the size
 * of thing that gets retyped at a call site and quietly diverges. It is stated
 * in prose in `config/constants.js` beside the numbers and implemented here;
 * `tools/test-volcano-severity.mjs` asserts both against the shipped catalog.
 *
 * ==> WHAT THIS SCORE IS FOR, AND THE ONE THING IT MUST NEVER DO. <== It ranks
 * the QUIET. §42.1.1: what is erupting now is drawn regardless of history, and
 * live state outranks history everywhere the two disagree. Great Sitkin scores
 * 0.240 and is erupting today; Merapi scores 0.809 and is erupting today; they
 * mean completely different things and that difference is the whole argument
 * for the exposure channel. **Nothing may use this score to decide WHETHER a
 * live eruption appears.** Selection of the quiet context, and how loudly a
 * mark reads — those two, nothing else.
 *
 * ==> TWO KINDS OF ABSENCE, ONE TEST. <== The test is `ec == null`, and it is
 * the whole rule:
 *
 *   ec absent      → GVP recorded no Holocene eruption. Verified against the
 *                    shipped file: of the 364 with no `ec`, zero have a `vei`
 *                    and zero have a `last`. So it is a RECORDED ZERO, and
 *                    substituting 0 makes the floor fall out of the transform
 *                    instead of being a special case bolted onto it.
 *   vei absent     → zero if `ec` is also absent (same 364, no explosivity on
 *                    record); the channel median if `ec` is present (162
 *                    volcanoes that erupted and nobody sized it — a genuine
 *                    unknown).
 *   pop30 absent   → always the channel median (35 volcanoes). `pop30 === 0`
 *                    is a MEASURED zero for 214 more and stays 0. Collapsing
 *                    those two is SPEC.md §5's `unavailable`-as-`clear`.
 *
 * ==> AND `vei` IS NOT LOGGED. <== It is already a log scale. The other two
 * are not. See the block comment on `VOLCANO.severity` for the measurement.
 *
 * Pure functions over plain property bags. No DOM, no state, no I/O.
 */

import { VOLCANO } from '../config/constants.js';

const { weights: WEIGHT, channels: CH } = VOLCANO.severity;

/** Normalise a raw value to 0–1 under a channel's own transform. Exported
 *  because the marks in Phase E want individual channels, not just the
 *  composite — a dot sized by exposure and lit by explosivity reads more than
 *  one sized by their average. */
export function normaliseChannel(key, raw) {
  const c = CH[key];
  if (!c) throw new Error(`volcano-severity: unknown channel ${key}`);
  const v = Math.max(0, Number(raw) || 0);
  const n = c.transform === 'log1p' ? Math.log1p(v) / Math.log1p(c.max) : v / c.max;
  /* Clamped rather than trusted. A catalog re-fetch that lands a value past
   * the recorded maximum should read as saturated, never as >1 leaking into a
   * weighted sum. The drift test is what makes that loud; this keeps it from
   * being wrong in the meantime. */
  return Math.min(1, Math.max(0, n));
}

/** The midpoint a genuine unknown sits at, on the normalised scale. Each
 *  channel's own median, not a flat 0.5 — see `VOLCANO.severity`. */
export function channelMidpoint(key) {
  return normaliseChannel(key, CH[key].median);
}

/**
 * The three channels for one volcano, each 0–1, with the missing-value rule
 * applied. `props` is a catalog feature's `properties` bag.
 *
 * Returns the resolved values AND `known`, naming which channels were measured
 * for this volcano rather than substituted. **A surface that reports a score
 * without being able to say what was measured is the §5 failure in miniature**
 * — Phase E's inspector needs to be able to say "no VEI on record" rather than
 * showing a middling number as if it were a reading.
 */
export function severityChannels(props = {}) {
  const hasEruptionRecord = props.ec != null;
  const hasVei = props.vei != null;
  const hasPop = props.pop30 != null;

  return {
    /* Absent is a recorded zero, so 0 goes straight through the transform. */
    ec: normaliseChannel('ec', hasEruptionRecord ? props.ec : 0),

    vei: hasVei
      ? normaliseChannel('vei', props.vei)
      : hasEruptionRecord
        ? channelMidpoint('vei') /* erupted, unsized — a real unknown */
        : 0 /* never erupted — no explosivity on record */,

    /* A measured 0 is a fact about the Aleutians and must not become the
     * midpoint. Only an ABSENT key is unknown. */
    pop30: hasPop ? normaliseChannel('pop30', props.pop30) : channelMidpoint('pop30'),

    known: { ec: hasEruptionRecord, vei: hasVei, pop30: hasPop },
  };
}

/**
 * One 0–1 severity score. Equal thirds by default; pass `weights` to override
 * (the weights are normalised by their own sum, so a caller cannot silently
 * push the score off the 0–1 scale by passing three ones).
 */
export function severityScore(props = {}, weights = WEIGHT) {
  const c = severityChannels(props);
  const total = weights.ec + weights.vei + weights.pop30;
  if (!(total > 0)) throw new Error('volcano-severity: weights sum to zero');
  return (c.ec * weights.ec + c.vei * weights.vei + c.pop30 * weights.pop30) / total;
}
