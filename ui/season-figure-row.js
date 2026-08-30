/**
 * season-figure-row.js — the panel's row renderer: label, figure, where it
 * stands, and the spread. SPEC-SEASONS-BUILD.md §57.54b, §57.54k, §57.56,
 * §57.57.
 *
 * ==> SINCE STEP 3 THIS IS THE MERGED ROW AND IT IS THE POINT OF THE WHOLE
 * REBUILD. <== §57.54b. Every ranked figure on the archive's storm panel now
 * lives in exactly one place — the row that already printed it — instead of
 * being stated once in its own section and again in a `Where it ranks` section
 * three to five sections away. That duplication was 33% of the panel and it is
 * what Aaron saw as disjointedness.
 *
 * ==> THIS FILE EXISTED AT STEP 2 RATHER THAN STEP 3, ON PURPOSE. <== §57.54k:
 * `ui/season-detail-markup.js` is already at §12's ceiling and the FIGURE ROW
 * — label, value, rank, bar — is the one renderer steps 2, 3 and 4 all write
 * into. `ui/season-detail-markup.js` was itself split out of the view on day
 * one rather than at the ceiling; this is the same decision at the same point
 * in the same file's life. `NOW.md` records `ui/view-seasons-board.js`
 * crossing the ceiling on five consecutive passes with the cut promised each
 * time and taken later at a bigger size.
 *
 * ==> IT IS A SEPARATE RENDERER FROM `rowsHtml` BECAUSE IT TAKES TRUSTED
 * MARKUP AND `rowsHtml` MUST NEVER. <== `rowsHtml` escapes both halves of
 * every row, so a storm name reaching it cannot be treated as HTML, and that
 * rule is worth more than the duplication saved by adding a third element to
 * it. Here the label and the value are escaped exactly the same way and the
 * third slot is `spine`, which is only ever the string
 * `ui/season-spine.js` just built. No caller may put anything else there and
 * nothing derived from a data file reaches it.
 *
 * ==> THE MARKUP IS THE SAME `<dl class="detail-vitals">` THE PANEL ALREADY
 * USES. <== §57.56 wired the bar into the EXISTING `Where it ranks` section so
 * the one new drawing primitive was judged on glass against a layout nobody
 * had changed. A different row shape there would have made that comparison
 * meaningless — and it is why step 3 could then move the bar under the real
 * figures without also introducing it.
 *
 * Imports ui/ only. No DOM, no network, no clock.
 */

import { esc } from './season-markup-bits.js';

/**
 * A definition list whose rows may each carry a rank and a distribution bar
 * beneath the value.
 *
 * ==> IT TAKES A KEY PER ROW AND LOOKS THE MARK UP ITSELF, RATHER THAN BEING
 * HANDED FINISHED RANK TEXT. <== §57.57b. The four sections that own a ranked
 * figure — `Strongest`, `Its life`, `How it changed`, `How it moved` — say
 * only *this row is the peak wind figure*. Not one of them learns what a rank
 * sentence reads like or that a bar exists, so the day the bar changes shape
 * there is one file to edit rather than four. It is also the only arrangement
 * in which a MISSPELLED key is findable: `tools/test-season-detail.mjs`
 * asserts that every `RANK_STATS` key is claimed by exactly one row across the
 * whole panel, which a renderer handed pre-built strings could not check.
 *
 * ==> A ROW WITH NO LABEL IS KEPT, AND THAT REVERSES WHAT THIS FILE DID AT
 * STEP 2. <== §57.56e dropped it, on the grounds that this renderer had
 * exactly one shape of caller — a ranked statistic, which always has a label
 * from `RANK_STATS` — so a missing label meant a table that had failed to load
 * and there was nothing to print. **That reasoning was about the call sites,
 * and step 3 changed the call sites.** This is now the panel's ordinary row
 * renderer, with the same callers `rowsHtml` has, so §57.55a's rule is the one
 * that applies: a label-less pair is a programming mistake rather than a data
 * state, and dropping it here would turn a visible layout fault into content
 * that silently vanishes. The guard is `tools/test-season-detail.mjs`'s sweep,
 * which renders every storm-facing renderer and fails on an empty `<dt>`.
 *
 * @param {Array<{label:string, value:string, key?:string}>} rows
 *   `key` is a `RANK_STATS` key when this row prints a ranked figure.
 * @param {Map<string, {rank:string, spine:string}>|null} marks
 *   from `rankMarks` in `ui/season-rank-markup.js`. Absent, or missing this
 *   row's key, means the row draws exactly as it did before step 3.
 * @returns {string} HTML, or '' when there is nothing to say
 */
export function figureRowsHtml(rows, marks = null) {
  const real = (rows || []).filter((r) => r && r.value != null && r.value !== '');
  if (!real.length) return '';

  return `<dl class="detail-vitals">${real.map((r) => {
    const mark = (r.key && marks?.get(r.key)) || null;

    /* ==> THE RANK AND THE BAR GO INSIDE THE `<dd>`, NOT BESIDE IT. <==
     * `.detail-vitals` is `grid-template-columns: auto 1fr`; either one as its
     * own grid child would land in the label column on one row and the value
     * column on the next, depending on how many cells came before it. Inside
     * the value cell they are always under the figure they describe, which is
     * the association §57.54b is asking the reader to make: one label, one
     * figure, where it stands, what the spread is.
     *
     * ==> THE RANK IS ESCAPED. <== It is assembled from ordinals and from
     * `scope.inWords`, and that last one comes out of a data file rather than
     * out of this repo. `spine` is the one slot that takes trusted markup and
     * it only ever holds the string `ui/season-spine.js` just built.
     *
     * ==> AND THE CELL SPANS BOTH COLUMNS WHENEVER IT CARRIES A MARK, NOT
     * ONLY WHEN IT CARRIES A BAR. <== The rank sentence wraps to two or three
     * lines at 390px, so indented behind whatever width `Fastest
     * strengthening` claimed it would be a paragraph in a half-width gutter —
     * which is §57.55a's fault exactly, arriving through a different door.
     * Rows with no mark keep the exact two-column shape they have today. */
    const cell = mark
      ? `<dd class="has-rank">${esc(r.value)}`
        + `<span class="detail-figure-rank">${esc(mark.rank)}</span>${mark.spine}</dd>`
      : `<dd>${esc(r.value)}</dd>`;
    /* ==> THE LABEL CARRIES THE CLASS TOO, AND THAT IS WHAT MAKES THE BLOCK A
     * BLOCK. <== §57.66. A marked figure is five stacked lines — label, value,
     * rank, bar, axis — and the grid's row `gap` is `--space-tight`, so the
     * distance between two FACTS was the same 4px as the distance between two
     * lines INSIDE one fact. Aaron on glass, 2026-08-30: *"all the data runs
     * together and I can't tell what belongs with what."*
     *
     * The divider has to start at the label rather than at the value, so the
     * class goes on the `<dt>`. It is the same name on both halves on purpose:
     * they are one figure, and a second name would let a later pass style one
     * and forget the other. */
    return `<dt${mark ? ' class="has-rank"' : ''}>${esc(r.label)}</dt>${cell}`;
  }).join('')}</dl>`;
}
