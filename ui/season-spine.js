/**
 * season-spine.js — the distribution bar under a ranked figure.
 * SPEC-SEASONS-BUILD.md §57.54c, §57.56.
 *
 * ==> THE WHOLE DISTRIBUTION WAS ALREADY ON EVERY PHONE AND NOBODY HAD DRAWN
 * IT. <== `rankings-v2` stores `values` (every distinct rung, sorted
 * best-first) and `counts` (how many storms sit on each), per statistic, per
 * scope. That is a complete histogram, shipped since §57.44 and read only for
 * a single ordinal. This file draws it.
 *
 * ==> IT IS ONE `<svg>` WITH THREE CHILDREN, AND THAT IS A PERFORMANCE
 * DECISION. <== The obvious build is a flex row of forty `<div>`s. Eight
 * ranked rows on a panel is 320 elements per storm opened, on a phone that is
 * already running a globe. One `<path>` carries the whole silhouette, so a
 * bar costs three nodes and the panel costs 24.
 *
 * ==> AND IT IS NOT A CHART LIBRARY. <== No axes engine, no scales, no
 * tooltips. `ui/chart-home.js` already sets the rule this file follows: a
 * picture is never the accessible answer, so every fact here is also written
 * in the row above it and the `aria-label` is a summary rather than a
 * substitute.
 *
 * Imports config/ and lib/. No DOM, no network, no clock — it returns a
 * string, like every other renderer on this panel.
 */

import { SEASONS } from '../config/constants.js';
import { toRung } from '../lib/rankings.js';
import { esc } from './season-markup-bits.js';

/* ---------------------------------------------------------------------------
 * THE GEOMETRY
 * ------------------------------------------------------------------------ */

/**
 * The viewBox the path is built in. Unitless on purpose: the CSS sizes the bar
 * and `preserveAspectRatio="none"` stretches it, so one number here cannot go
 * stale against a stylesheet nobody edited at the same time.
 */
const W = 100;
const H = 24;

/**
 * How far in from each end the mark may be drawn, in viewBox units. The stroke
 * is 2px of real screen and the box stretches to roughly 350px on a phone, so
 * one viewBox unit is about 3.5px — the inset is a shade over half the stroke
 * at the narrowest width this panel is ever drawn at.
 */
const MARK_INSET = 0.5;

/**
 * Bin a ladder into columns.
 *
 * ==> THE BINS ARE LAID OUT ALONG THE VALUE, NOT ALONG THE RANK. <== A bar
 * spaced by rank is a straight line by construction — every ladder would look
 * identical and say nothing. Spacing by value is what makes pressure a hump
 * and distance a long right tail.
 *
 * ==> AND LOW IS ALWAYS LEFT, WHICHEVER END IS FIRST PLACE. <== §57.54c. The
 * ladder's own `values` run best-first, so for pressure they run 882 to 1016
 * and for wind 165 to 25. Drawing in ladder order would flip half the bars and
 * leave the reader working out which way each one ran. The one statistic where
 * low is strong says so in words at the ends instead.
 *
 * @param {object} ladder  one `stats[key]` entry from the rankings table
 * @returns {{bins:number[], min:number, max:number}|null}
 */
export function binLadder(ladder) {
  const values = ladder?.values;
  const counts = ladder?.counts;
  if (!Array.isArray(values) || !Array.isArray(counts)) return null;
  if (values.length !== counts.length || values.length < 2) return null;

  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) return null;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!(max > min)) return null;

  /* ==> THE BIN COUNT IS CAPPED BY THE LADDER'S OWN RESOLUTION, AND THAT IS
   * THE MEASUREMENT THAT PUT `spineBins` WHERE IT IS. <== `fastest24hGainKt`
   * holds 18 rungs on a 5 kt grid; drawn in 40 columns, 22 of them come back
   * empty and the bar is a comb rather than a distribution. A ladder can never
   * fill more columns than it has rungs, so it is not asked to. */
  const n = Math.max(2, Math.min(SEASONS.spineBins, values.length));
  const bins = new Array(n).fill(0);
  for (let i = 0; i < values.length; i++) {
    const c = counts[i];
    if (!Number.isFinite(c) || c <= 0) continue;
    let b = Math.floor(((values[i] - min) / (max - min)) * n);
    if (b >= n) b = n - 1;
    if (b < 0) b = 0;
    bins[b] += c;
  }
  return { bins, min, max };
}

/**
 * Where a value sits along the bar, 0 at the left end and 1 at the right.
 *
 * ==> IT TAKES THE RUNG, NEVER THE RAW FIGURE, AND THE PROTOTYPE GOT THIS
 * WRONG FIRST. <== §57.54c. §57.46's two distance ladders store DISPLAY units
 * — miles or kilometres — while `RANK_STATS.read()` returns nautical miles.
 * Handed the raw figure, Katrina's mark landed at 16.9% of a bar where she
 * belongs at 19.5%, and at 10.4% on the kilometre ladder, with the correct
 * `2,106 mi` printed beside it the whole time. Nothing about that invited a
 * second look, which is exactly `CLAUDE.md`'s fluent-wrong-number failure with
 * a chart under it.
 *
 * `toRung` is the only conversion guaranteed to speak a ladder's own units,
 * because it is what built them.
 */
export function markFraction(ladder, quantize, raw) {
  const box = binLadder(ladder);
  if (!box) return null;
  const rung = toRung(quantize, raw);
  if (rung === null || !Number.isFinite(rung)) return null;
  const f = (rung - box.min) / (box.max - box.min);
  /* A storm outside the ladder's own range cannot happen for a storm the
   * ladder was built from, and CAN for the season still running. Clamped
   * rather than refused: `rankStorm` has already declined to give it a rank,
   * so nothing reaches here without one. */
  return Math.min(1, Math.max(0, f));
}

/**
 * The silhouette, as one SVG path.
 *
 * ==> HEIGHTS ARE ON A SQUARE ROOT SCALE AND THE BAR SAYS SO NOWHERE, WHICH IS
 * A REAL COST. <== Linear is the honest scale and it does not work here:
 * measured 2026-08-30, a linear ACE bar leaves 12 of its 31 occupied columns
 * under a twentieth of the tallest and therefore invisible. The bar's job is
 * where this storm sits among the others, not how many others there were —
 * that number is in the row above it, exactly. A scale that hides half the
 * archive answers the question worse than one that compresses it.
 *
 * ==> AND A COLUMN HOLDING STORMS IS NEVER DRAWN AS EMPTY. <== §5, with a
 * chart under it. `spineMinColumn` is the floor, because "one storm did this"
 * and "no storm ever did" are different facts and must not share a blank
 * column.
 */
function pathFor(bins) {
  let tallest = 0;
  for (const b of bins) if (b > tallest) tallest = b;
  if (tallest <= 0) return null;

  const n = bins.length;
  const step = W / n;
  const parts = [];
  for (let i = 0; i < n; i++) {
    if (bins[i] <= 0) continue;
    const scaled = Math.sqrt(bins[i] / tallest);
    const h = Math.max(SEASONS.spineMinColumn, scaled) * H;
    const x = i * step;
    /* Drawn from the baseline up, so a short column sits ON the floor rather
     * than floating in the middle of the bar. */
    parts.push(`M${x.toFixed(2)} ${H}h${step.toFixed(2)}v${(-h).toFixed(2)}h${(-step).toFixed(2)}z`);
  }
  return parts.length ? parts.join('') : null;
}

/* ---------------------------------------------------------------------------
 * THE MARKUP
 * ------------------------------------------------------------------------ */

/**
 * One distribution bar with its two end labels and this storm's mark.
 *
 * ==> BOTH ENDS CARRY THE REAL EXTREME VALUE, AND THAT IS THE FIX FOR THE ONE
 * THING AARON COULD NOT READ IN THE FIRST MOCKUP. <== He could not tell which
 * end of the bar was which. The answer was an axis rather than a bigger bar:
 * the numbers at the ends are the archive's actual shortest and longest, so
 * the mark between them needs no legend.
 *
 * @param {object} ladder    one `stats[key]` entry
 * @param {string} quantize  the `RANK_STATS` entry's quantizer name
 * @param {number} raw       this storm's figure, in whatever units `read` gave
 * @param {object} opts
 * @param {function} opts.axis   value -> the end label's text
 * @param {string} [opts.lowNote]   words appended to the LEFT label
 * @param {string} [opts.highNote]  words appended to the RIGHT label
 * @param {string} [opts.summary]   the `aria-label`; the row's own words
 * @returns {string} HTML, or '' when this ladder cannot be drawn
 */
export function spineHtml(ladder, quantize, raw, {
  axis, lowNote = '', highNote = '', summary = '',
} = {}) {
  const box = binLadder(ladder);
  if (!box || typeof axis !== 'function') return '';
  const d = pathFor(box.bins);
  if (!d) return '';
  const f = markFraction(ladder, quantize, raw);
  if (f === null) return '';

  const low = axis(box.min);
  const high = axis(box.max);
  if (low === null || high === null) return '';

  /* ==> THE MARK IS INSET FROM BOTH ENDS BY HALF ITS OWN WIDTH. <== A
   * first-place storm sits at fraction 0, and a stroke centred on x=0 draws
   * half of itself outside the box and gets clipped — so the strongest storm
   * in the archive would show the FAINTEST mark on the panel. That is the
   * "findable at both extremes" question answered in the geometry rather than
   * left to glass. */
  const x = (MARK_INSET + f * (W - MARK_INSET * 2)).toFixed(2);

  /* ==> THE SVG IS `aria-hidden` AND THE WORDS ARE THE ANSWER. <== A screen
   * reader handed forty columns and a line reads a shape it cannot use. The
   * label carries the same three facts the picture does — the two ends and
   * where this storm falls between them — and `ui/chart-home.js` states the
   * same rule for the same reason. */
  return '<div class="season-spine">'
    + `<svg class="season-spine-plot" viewBox="0 0 ${W} ${H}" `
    + 'preserveAspectRatio="none" aria-hidden="true" focusable="false">'
    + `<path class="season-spine-fill" d="${d}"/>`
    /* ==> A LINE WITH `vector-effect="non-scaling-stroke"`, NOT A RECT. <==
     * `preserveAspectRatio="none"` stretches this 100-unit box to whatever the
     * panel is wide, so a rect's width would be a different number of device
     * pixels on every screen and on every orientation change. The stroke
     * ignores the transform and stays the width the stylesheet asked for. */
    + `<line class="season-spine-mark" x1="${x}" y1="0" x2="${x}" y2="${H}" `
    + 'vector-effect="non-scaling-stroke"/>'
    + '</svg>'
    + '<p class="season-spine-axis">'
    + `<span>${esc(low)}${lowNote ? ` ${esc(lowNote)}` : ''}</span>`
    + `<span>${esc(high)}${highNote ? ` ${esc(highNote)}` : ''}</span>`
    + '</p>'
    + (summary ? `<span class="visually-hidden">${esc(summary)}</span>` : '')
    + '</div>';
}
