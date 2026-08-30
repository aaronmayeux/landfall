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

/**
 * The box is taller than the columns, and the extra room is the axis.
 *
 * ==> THE BASELINE RULE AND ITS END TICKS ARE WHAT MADE THIS READ AS
 * INFORMATION RATHER THAN AS A SMUDGE. <== §57.64. The first version drew the
 * columns and nothing else, so the bar had no floor and no ends — the reader
 * had to infer where the range started and stopped from where the ink happened
 * to run out. On the coarse ladders, where the last few columns are one pixel
 * tall, that is not inferable at all.
 *
 * `PLOT` is where the columns live and where the baseline sits. `H` leaves
 * `OVERSHOOT` above it for the mark and the same below for the mark and the
 * end ticks, so all three cross the baseline rather than stopping at it.
 */
const PLOT = 24;
const OVERSHOOT = 3;
const H = PLOT + OVERSHOOT * 2;

/**
 * How far in from each end the mark may be drawn, in viewBox units. The stroke
 * is 2px of real screen and the box stretches to roughly 350px on a phone, so
 * one viewBox unit is about 3.5px — the inset is a shade over half the stroke
 * at the narrowest width this panel is ever drawn at.
 */
const MARK_INSET = 0.5;

/**
 * How close to an end the mark has to be before its figure label stops being
 * centred on it and pins to that end instead.
 *
 * A FIFTH. The longest figure this label ever carries is a lifespan —
 * `32 days, 18 hours` — which is about a third of the panel's width at 390px,
 * so half of it overhangs by a sixth. A fifth clears that with room, and it is
 * far enough from the middle that the pinned label still reads as belonging to
 * a mark near the end rather than to the end itself.
 */
const FIGURE_EDGE = 0.2;

/**
 * The hairline between one column and the next, in viewBox units.
 *
 * ==> AARON ASKED FOR A SINGLE PIXEL ON 2026-08-30, HAVING REJECTED THE
 * MOCKUP'S WIDE GAPS THE SAME DAY. <== §57.65. The two are different requests
 * and the difference is the whole point: the mockup drew separated BARS, which
 * reads as a row of tallies; this is a continuous silhouette with a seam, so
 * the eye can still follow the shape across the bar but can count the steps
 * where it wants to.
 *
 * ==> IT IS APPROXIMATELY ONE PIXEL, NOT EXACTLY ONE, AND THAT IS INHERENT.
 * <== `preserveAspectRatio="none"` stretches this 100-unit box to whatever the
 * panel is wide, so one viewBox unit is 100/panelWidth pixels and there is no
 * fixed answer. 0.28 is one device pixel at 358px, which is the panel's width
 * inside a 390px phone — the size this is judged at. It grows to about two
 * pixels at the 719px top of the narrow layout and sits near one again at the
 * wide layout's `clamp(340px, 36vw, 440px)`.
 *
 * ==> THE ALTERNATIVE WAS A NON-SCALING STROKE AND IT IS WORSE HERE. <== That
 * would hold the seam at exactly one pixel everywhere, and it would have to be
 * painted in the panel's background colour to read as a gap — which turns a
 * hole into an opaque overlay that is wrong the moment anything is drawn
 * behind the bar. A narrower column is a real gap.
 *
 * The narrowest pitch this can eat into is 2.5 units, at the `spineBins` cap
 * of 40, so the seam is at most 11% of a column and never closes one.
 */
const COLUMN_GAP = 0.28;
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
  const floor = OVERSHOOT + PLOT;
  const parts = [];
  for (let i = 0; i < n; i++) {
    if (bins[i] <= 0) continue;
    const scaled = Math.sqrt(bins[i] / tallest);
    const h = Math.max(SEASONS.spineMinColumn, scaled) * PLOT;
    /* ==> THE SEAM IS TAKEN HALF FROM EACH SIDE, SO THE COLUMN STAYS CENTRED
     * ON ITS OWN BIN. <== Shaving it off one edge only would walk every column
     * a half-gap off the value it represents, and the mark is placed from that
     * same value — so the mark would drift out of its own column at one end of
     * the bar and not the other. */
    const x = i * step + COLUMN_GAP / 2;
    const w = step - COLUMN_GAP;
    /* ==> A HAIRLINE SEAM, NOT SEPARATED BARS. <== §57.64, §57.65. Aaron
     * rejected the mockup's wide fixed-width gaps and then asked for a single
     * pixel between columns. The silhouette is still continuous enough to
     * follow across the bar; the seam only lets the eye count the steps.
     * `COLUMN_GAP` carries the reasoning and the measurement.
     *
     * Drawn from the baseline up, so a short column sits ON the floor rather
     * than floating in the middle of the bar. */
    parts.push(`M${x.toFixed(2)} ${floor}h${w.toFixed(2)}v${(-h).toFixed(2)}h${(-w).toFixed(2)}z`);
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
 * @param {string} [opts.figure] this storm's own figure, printed on the bar
 * @param {string} [opts.lowNote]   words appended to the LEFT label
 * @param {string} [opts.highNote]  words appended to the RIGHT label
 * @param {string} [opts.summary]   the `aria-label`; the row's own words
 * @returns {string} HTML, or '' when this ladder cannot be drawn
 */
export function spineHtml(ladder, quantize, raw, {
  axis, figure = '', lowNote = '', highNote = '', summary = '',
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
  const top = OVERSHOOT + PLOT;
  const bottom = (top + OVERSHOOT).toFixed(2);

  /* ==> THE FIGURE IS PRINTED ON THE BAR, UNDER THE MARK, AND IT IS THE HALF
   * THAT WAS MISSING. <== §57.64. Without it the mark is a position with no
   * value: the reader can see that this storm sits four fifths of the way
   * along and has to look back up to the row to learn what four fifths MEANS.
   * The two extremes are already spelled at the ends, so the third number
   * completes the sentence the bar is trying to say.
   *
   * ==> IT IS ANCHORED IN THREE POSITIONS RATHER THAN CENTRED ALWAYS. <== A
   * label centred on a mark at 2% hangs half of itself off the left edge of
   * the panel. Near either end it pins to that end instead, which is what the
   * mockup did and the only thing that works for a record-holder. */
  /* ==> THE CLASS NAMES ARE WRITTEN OUT IN FULL RATHER THAN BUILT FROM THE
   * ANCHOR. <== `class="is-${anchor}"` is shorter and `tools/css-orphan-check.mjs`
   * cannot see it — it reported all three rules as dead CSS, which is the
   * check working exactly as intended. A class a tool cannot grep is a class
   * nobody can find from the stylesheet either. */
  const pin = f < FIGURE_EDGE
    ? 'season-spine-figure-start'
    : (f > 1 - FIGURE_EDGE ? 'season-spine-figure-end' : 'season-spine-figure-mid');

  /* ==> THE SVG IS `aria-hidden` AND THE WORDS ARE THE ANSWER. <== A screen
   * reader handed forty columns and a line reads a shape it cannot use. The
   * label carries the same three facts the picture does — the two ends and
   * where this storm falls between them — and `ui/chart-home.js` states the
   * same rule for the same reason. */
  return '<div class="season-spine">'
    + `<svg class="season-spine-plot" viewBox="0 0 ${W} ${H}" `
    + 'preserveAspectRatio="none" aria-hidden="true" focusable="false">'
    + `<path class="season-spine-fill" d="${d}"/>`
    /* The floor the columns stand on, and a tick at each end of the range.
     * Every one of these is a `<line>` with `vector-effect="non-scaling-stroke"`
     * for the same reason the mark is: `preserveAspectRatio="none"` stretches
     * this 100-unit box to whatever the panel is wide, so a shape's thickness
     * would otherwise be a different number of device pixels on every screen
     * and on every orientation change. */
    + `<line class="season-spine-rule" x1="0" y1="${top}" x2="${W}" y2="${top}" `
    + 'vector-effect="non-scaling-stroke"/>'
    + `<line class="season-spine-tick" x1="${MARK_INSET}" y1="${top - OVERSHOOT}" `
    + `x2="${MARK_INSET}" y2="${bottom}" vector-effect="non-scaling-stroke"/>`
    + `<line class="season-spine-tick" x1="${W - MARK_INSET}" y1="${top - OVERSHOOT}" `
    + `x2="${W - MARK_INSET}" y2="${bottom}" vector-effect="non-scaling-stroke"/>`
    /* ==> THE MARK RUNS THE FULL HEIGHT OF THE BOX AND CROSSES THE BASELINE.
     * <== It has to be findable when the column under it is one pixel tall,
     * which is the ordinary case at the thin end of every one of these
     * ladders. A mark that stopped at the top of its own column would be
     * shortest exactly where the storm is rarest. */
    + `<line class="season-spine-mark" x1="${x}" y1="0" x2="${x}" y2="${H}" `
    + 'vector-effect="non-scaling-stroke"/>'
    + '</svg>'
    /* ==> THE THREE LABELS ARE HTML, NOT SVG `<text>`, AND THE DRAWER'S WIDTH
     * IS WHY. <== The mockup put them inside the box and scaled the whole SVG
     * proportionally, which is exact at the 390px it was drawn for. This panel
     * runs from 320px to 719px before the wide layout takes over and pins it
     * to `clamp(340px, 36vw, 440px)`, so a proportionally scaled box would
     * render its 9.5px axis text at nearly 18px on a tablet held in portrait.
     * In HTML the labels take the panel's own type tokens and do not scale at
     * all, and they still line up with the bar's ends because the SVG is
     * exactly the same width as the paragraph under it. */
    + (figure
      ? `<p class="season-spine-figure"><span class="${pin}"`
        + (pin.endsWith('mid') ? ` style="--spine-at: ${x}%"` : '')
        + `>${esc(figure)}</span></p>`
      : '')
    + '<p class="season-spine-axis">'
    + `<span>${esc(low)}${lowNote ? ` ${esc(lowNote)}` : ''}</span>`
    + `<span>${esc(high)}${highNote ? ` ${esc(highNote)}` : ''}</span>`
    + '</p>'
    + (summary ? `<span class="visually-hidden">${esc(summary)}</span>` : '')
    + '</div>';
}
