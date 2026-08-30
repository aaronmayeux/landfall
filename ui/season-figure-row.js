/**
 * season-figure-row.js — a row that can carry a drawing under its value.
 * SPEC-SEASONS-BUILD.md §57.54k, §57.56.
 *
 * ==> THIS FILE EXISTS AT STEP 2 RATHER THAN STEP 3, ON PURPOSE. <== §57.54k:
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
 * USES. <== §57.56 wires the bar into the EXISTING `Where it ranks` section so
 * the one new drawing primitive is judged on glass against a layout nobody
 * changed. A different row shape here would have made that comparison
 * meaningless.
 *
 * Imports ui/ only. No DOM, no network, no clock.
 */

import { esc } from './season-markup-bits.js';

/**
 * A definition list whose rows may each carry a drawing beneath the value.
 *
 * ==> A ROW WITH NO LABEL IS DROPPED HERE, WHICH IS THE OPPOSITE OF WHAT
 * `rowsHtml` DOES, AND THE DIFFERENCE IS DELIBERATE. <== §57.55a records why
 * `rowsHtml` does not filter on the key: a label-less pair reaching it is a
 * programming mistake and silently dropping content would hide it. That
 * reasoning is about a renderer with call sites that push prose. This one has
 * exactly one shape of caller — a ranked statistic, which always has a label
 * from `RANK_STATS` — so a missing label here is a table that failed to load
 * rather than a sentence in the wrong place, and there is nothing to print.
 *
 * @param {Array<{label:string, value:string, spine?:string}>} rows
 * @returns {string} HTML, or '' when there is nothing to say
 */
export function figureRowsHtml(rows) {
  const real = (rows || []).filter(
    (r) => r && r.label && r.value != null && r.value !== ''
  );
  if (!real.length) return '';

  return `<dl class="detail-vitals">${real.map((r) => {
    /* ==> THE BAR GOES INSIDE THE `<dd>`, NOT BESIDE IT. <== `.detail-vitals`
     * is `grid-template-columns: auto 1fr`; a bar as its own grid child would
     * land in the label column on one row and the value column on the next,
     * depending on how many cells came before it. Inside the value cell it is
     * always under the figure it describes, which is the association §57.54b
     * is asking the reader to make.
     *
     * ==> AND THE CELL IS THE FULL WIDTH OF THE PANEL ONLY WHEN IT CARRIES A
     * BAR. <== `.detail-vitals` gives the value column whatever the label
     * column leaves, which is right for `173 mph (150 kt)` and wrong for a
     * distribution across 3,266 storms. `ui/panels.css` handles that off the
     * `has-spine` class rather than this file guessing at a width. */
    const cell = r.spine
      ? `<dd class="has-spine">${esc(r.value)}${r.spine}</dd>`
      : `<dd>${esc(r.value)}</dd>`;
    return `<dt>${esc(r.label)}</dt>${cell}`;
  }).join('')}</dl>`;
}
