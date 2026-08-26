/**
 * seasons-wall-markup.js — the Wall of Years, as markup.
 * SPEC-SEASONS-BUILD.md §57.29, §57.36, §57.30 step 14.
 *
 * Pure functions. No state, no listeners, no fetch — the view owns all three.
 * Everything here is reachable from `node` with a stand-in DOM, which is how
 * `tools/test-seasons-wall.mjs` drives it.
 *
 * ==> THE STRIP IS SVG AND THE ROW IS A BUTTON, AND NEITHER HALF IS
 * DECORATIVE-BY-ACCIDENT. <== The dots carry no information a screen reader can
 * reach, so the `<svg>` is `aria-hidden` and the button carries a sentence
 * saying everything the strip says (`rowLabel` in `lib/wall-index.js`). Getting
 * that backwards — a labelled svg inside an unlabelled button — reads the year
 * twice and the storms not at all.
 *
 * ==> WHAT IS DELIBERATELY NOT HERE YET. <== The glow and the landfall
 * triangles are step 4, and so are the honesty MARKS that a non-year sort
 * needs; the filters and the sort control are step 3. The pre-1966 shading and
 * the line at the boundary ARE here, because in year order they are the only
 * thing standing between a short 1890s strip and a reader concluding the
 * 1890s were quiet (§57.36).
 */

import { categoryColor, categoryShortLabel } from '../lib/category.js';
import { CAT, rowLabel, SATELLITE_ERA_FROM } from '../lib/wall-index.js';
import { esc } from './seasons-board-markup.js';

/** A storm the record never graded gets GENERIC and never a colour it did not
 *  earn (SPEC §6). `'tropical'` is the nature every HURDAT2 storm in this file
 *  has by construction — the parser drops everything else (§57.13). */
export const dotColor = (cat) => categoryColor(Number.isFinite(cat) ? cat : null, 'tropical', null);

/** `tropical depression`, `Category 4` — for the row's spoken label. */
export const catLabel = (cat) => categoryShortLabel(cat, 'tropical', null);

/**
 * One season's dots, as elements rather than as SVG.
 *
 * ==> IT WAS AN `<svg>` FOR ONE PUSH AND THE GLOW IS WHY IT IS NOT. <== Aaron
 * on glass, 2026-08-26: the dots have to glow the way the live storm list's do.
 * That glow is `box-shadow: 0 0 var(--dot-glow-blur) …` (`ui/panels.css`), and
 * `box-shadow` does not apply to an SVG circle. The alternatives were an SVG
 * filter per row — 175 filter passes down a scroll, which is exactly the frame
 * budget this app protects — or a second faked halo circle behind every dot,
 * which is a SECOND definition of a glow that would drift from the real one.
 *
 * So the strip is the same construction the live list already uses: a span per
 * storm, its colour on a custom property, the glow in CSS off the one token.
 * One rule, one place, and the gate on `--dot-glow-blur` covers both.
 *
 * ==> AND THE SIZE IS NO LONGER WRITTEN INTO THE MARKUP. <== It is a custom
 * property on the container, which is what lets the view correct the size
 * AFTER layout without rebuilding 175 rows — see `view-seasons-wall.js`.
 *
 * ==> LEFT TO RIGHT IS THE SEASON HAPPENING, AND SORTING THESE IS FORBIDDEN.
 * <== §57.36. The generator writes them in order of first fix and nothing here
 * reorders them: reorder by strength and June stops being on the left, at which
 * point no two rows on the screen can be compared to each other, which is the
 * only thing the wall is for.
 */
/**
 * One season's dots.
 *
 * ==> LEFT TO RIGHT IS THE SEASON HAPPENING, AND SORTING THESE IS FORBIDDEN.
 * <== §57.36. The generator writes them in order of first fix and nothing here
 * reorders them: reorder by strength and June stops being on the left, at which
 * point no two rows on the screen can be compared to each other, which is the
 * only thing the wall is for.
 *
 * ==> THE SVG IS SIZED IN THE SAME UNITS IT IS DRAWN IN. <== `width`/`height`
 * in CSS pixels matching the viewBox, so there is no scaling factor between
 * what the arithmetic says a dot is and what lands on the glass. A strip scaled
 * to fit its box would make `wallDotMin` a lie.
 */
export function stripHtml(list) {
  if (!list.length) return '';
  let parts = '';
  for (const storm of list) {
    parts += `<i style="--wall-swatch:${dotColor(storm[CAT])}"></i>`;
  }
  return `<span class="wall-strip" aria-hidden="true">${parts}</span>`;
}

/**
 * One row.
 *
 * ==> THE COUNT COLUMN CARRIES BOTH FIGURES FROM THE FIRST PUSH. <== §57.36.
 * With no filter on there is only one number to show, so today `shown` and
 * `total` are always equal and the small half is omitted. The SHAPE is right
 * now so that step 3 fills a slot rather than changing every row on the wall.
 */
export function rowHtml(row, { filtered = false } = {}) {
  const label = rowLabel(row, { catLabel });
  const count = filtered && row.shown.length !== row.total
    ? `${row.shown.length}<small> of ${row.total}</small>`
    : `${row.total}`;

  /* ==> AN ASTERISK RATHER THAN A SHADED BACKGROUND. <== Aaron on glass,
   * 2026-08-26: at the contrast a sepia palette allows, the shaded band under
   * 1966 was barely distinguishable from the rows above it, so the one signal
   * standing between a short 1890s strip and a reader concluding the 1890s
   * were quiet was a tint most eyes would miss. A mark on the year is a
   * different KIND of signal — it survives any palette, it survives a
   * colour-blind reader, and it is the mark §57.36 always wanted for the
   * moment a sort scatters these rows and a contiguous band stops being
   * possible at all. That moment is step 3; the mark lands now. */
  return `<button class="wall-row" type="button" data-year="${row.year}"${row.pre ? ' data-pre="1"' : ''}
      aria-label="${esc(label)}">
      <span class="wall-year">${row.year}${row.pre ? '<b class="wall-star">*</b>' : ''}</span>
      <span class="wall-strip-slot">${stripHtml(row.shown)}</span>
      <span class="wall-count">${count}</span>
    </button>`;
}

/**
 * The season in progress, pinned above the wall.
 *
 * ==> IT IS A ROW, NOT A BANNER, BECAUSE IT IS A DESTINATION. <== It opens the
 * same Season Details screen every other year opens, so it is the same control
 * with the same 44px target and the same three input paths.
 *
 * ==> AND IT SAYS HOW MANY STORMS ARE STILL RUNNING, IN WORDS, RATHER THAN
 * DRAWING THEM. <== §57.21c. A storm the live app is still tracking is not
 * part of the past — it is not on the sepia globe either — so a dot beside the
 * finished ones would say the season is over when it is not. The count is the
 * honest version of the same fact and it sits where a reader is already
 * looking.
 *
 * ==> WITH THE LIVE FEED SILENT, NEITHER CLAIM IS MADE. <== §5. `activeKnown`
 * false means nobody could be asked which storms are still going, so the row
 * says the season is still being written and stops there rather than reporting
 * a zero it cannot stand behind.
 */
export function liveRowHtml(row) {
  const n = row.shown.length;
  const drawn = `${n} finished storm${n === 1 ? '' : 's'}`;
  /* ==> THE BASIN IS IN THE SENTENCE, AND LEAVING IT OUT READ AS A LIE. <==
   * Aaron on glass, 2026-08-26: the Atlantic row said "nothing active right
   * now" while two storms were running. Checked against the real feed in the
   * archive branch — Iselle in the East Pacific and Lala in the Central
   * Pacific, and no Atlantic storm at all. The COUNT was right and the WORDS
   * claimed the whole world. A row that is about one basin has to say which,
   * or its reader will correctly conclude it is wrong. */
  /* ==> "IN THE REGION" RATHER THAN THE BASIN'S NAME. <== Aaron on glass,
   * 2026-08-26. Naming it was the fix for the row reading as a lie — the
   * Atlantic row once said "nothing active right now" while two Pacific storms
   * were running — but `East and Central Pacific` spelled out pushed the count
   * off the right edge of a phone. The basin switch sits directly above this
   * row and is the only thing it can mean, so the shorter word carries the
   * same qualification in a quarter of the space. */
  const note = !row.activeKnown
    ? 'still being written'
    : row.active > 0
      ? `${row.active} active in the region`
      : 'nothing active in the region';

  return `<button class="wall-row wall-row-live" type="button" data-year="${row.year}" data-live="1"
      aria-label="${esc(`${row.year}, this season — ${drawn}, ${note}`)}">
      <span class="wall-year">${row.year}</span>
      <span class="wall-strip-slot">${stripHtml(row.shown)}</span>
      <span class="wall-live-note">${esc(note)}</span>
      <span class="wall-count">${n}</span>
    </button>`;
}

/** What the pinned row says while its storms are still being fetched, and what
 *  it says when they could not be. Both keep the row on screen: a row that
 *  disappears on failure reads as "there is no current season", which is the
 *  one thing this row exists to deny (§5). */
export function liveRowPlaceholderHtml(year, note) {
  return `<div class="wall-row wall-row-live wall-row-flat" role="listitem"
      aria-label="${esc(`${year == null ? 'This season' : year} — ${note}`)}">
      <span class="wall-year">${year == null ? '—' : year}</span>
      <span class="wall-live-note wall-live-note-wide">${esc(note)}</span>
    </div>`;
}

/**
 * A season the record holds no storms for.
 *
 * ==> IT KEEPS ITS PLACE AND ITS YEAR, AND COLLAPSING IT WOULD REDRAW HISTORY.
 * <== §57.36. A run of empty years is what a quiet stretch LOOKS like, and the
 * gap is the information. It is a hairline rather than a full row because it is
 * not a destination — there is nothing to open — and 44px of nothing repeated
 * down the wall would drown the years that do carry storms.
 *
 * Not a button, deliberately: a control that does nothing when pressed is worse
 * than no control, and it would take a tab stop for a year with no content.
 */
export function hairlineHtml(row) {
  return `<div class="wall-hair" role="listitem"
    aria-label="${row.year} — no storms recorded"><span>${row.year}</span></div>`;
}

/**
 * The line under which nobody was watching from orbit.
 *
 * ==> A SENTENCE, NOT A TOOLTIP AND NOT A SHADE ON ITS OWN. <== §57.36. The
 * shading tells a reader something is different up there; only words say what,
 * and the difference between "these years were quiet" and "nobody could see
 * these years" is the whole §5 claim this feature makes about its own data.
 *
 * Drawn ONCE, at the boundary, and only while the wall is in year order —
 * scattered years cannot carry a line and the caller decides that.
 */
export function eraLineHtml() {
  return `<p class="wall-era"><b class="wall-star">*</b> Before 1966 nobody was watching from
    orbit. A storm that stayed at sea was simply never recorded, so every starred row is an
    undercount &mdash; a short strip there is not evidence of a quiet year.</p>`;
}

/**
 * The tally, and it is on screen under every combination.
 *
 * ==> AN OVER-FILTERED WALL AND A BROKEN WALL ARE THE SAME SCREEN WITHOUT IT.
 * <== §57.36, and §5. Today nothing filters, so this counts the seasons that
 * hold storms against the ones that genuinely do not — which is already a real
 * distinction: 1914 held one storm and the years around it held none.
 */
export function tallyHtml(live, empty) {
  const seasons = `${live} season${live === 1 ? '' : 's'} shown`;
  return `<p class="wall-tally">${seasons}${empty ? ` &middot; ${empty} with none` : ''}</p>`;
}

/**
 * The whole wall.
 *
 * @param {Array} rows   from `rowsFor`, newest first
 * @param {object} opts
 * @param {number} opts.size
 * @param {number} opts.gap
 * @param {boolean} [opts.filtered]
 */
export function wallHtml(rows, { size, gap, filtered = false } = {}) {
  const live = rows.filter((r) => r.shown.length > 0).length;
  const empty = rows.length - live;

  let html = tallyHtml(live, empty);
  html += `<div class="wall" role="list" style="--wall-dot:${size}px;--wall-dot-gap:${gap}px">`;

  let eraDrawn = false;
  for (const row of rows) {
    /* Rows arrive newest first, so the boundary is crossed exactly once on the
     * way down and the line lands immediately above the first pre-satellite
     * year. A basin whose record starts after 1966 never crosses it and never
     * draws the line, which is correct rather than a missing case. */
    if (!eraDrawn && row.year < SATELLITE_ERA_FROM) {
      html += eraLineHtml();
      eraDrawn = true;
    }
    html += row.shown.length === 0 ? hairlineHtml(row) : rowHtml(row, { filtered });
  }

  return `${html}</div>`;
}
