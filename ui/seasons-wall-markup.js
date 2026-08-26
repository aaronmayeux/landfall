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
export function stripSvg(list, size, gap) {
  const n = list.length;
  if (!n) return '';
  const w = n * size + (n - 1) * gap;
  const r = size / 2;

  let parts = '';
  for (let i = 0; i < n; i++) {
    const cx = i * (size + gap) + r;
    parts += `<circle cx="${cx}" cy="${r}" r="${r}" fill="${dotColor(list[i][CAT])}"/>`;
  }

  return `<svg class="wall-strip" viewBox="0 0 ${w} ${size}" width="${w}" height="${size}"
    preserveAspectRatio="xMinYMid meet" aria-hidden="true" focusable="false">${parts}</svg>`;
}

/**
 * One row.
 *
 * ==> THE COUNT COLUMN CARRIES BOTH FIGURES FROM THE FIRST PUSH. <== §57.36.
 * With no filter on there is only one number to show, so today `shown` and
 * `total` are always equal and the small half is omitted. The SHAPE is right
 * now so that step 3 fills a slot rather than changing every row on the wall.
 */
export function rowHtml(row, { size, gap, filtered = false }) {
  const label = rowLabel(row, { catLabel });
  const count = filtered && row.shown.length !== row.total
    ? `${row.shown.length}<small> of ${row.total}</small>`
    : `${row.total}`;

  return `<button class="wall-row" type="button" data-year="${row.year}"${row.pre ? ' data-pre="1"' : ''}
      aria-label="${esc(label)}">
      <span class="wall-year">${row.year}</span>
      <span class="wall-strip-slot">${stripSvg(row.shown, size, gap)}</span>
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
export function liveRowHtml(row, { size, gap }) {
  const n = row.shown.length;
  const drawn = `${n} finished storm${n === 1 ? '' : 's'}`;
  const note = !row.activeKnown
    ? 'still being written'
    : row.active > 0
      ? `${row.active} active storm${row.active === 1 ? '' : 's'}`
      : 'nothing active right now';

  return `<button class="wall-row wall-row-live" type="button" data-year="${row.year}" data-live="1"
      aria-label="${esc(`${row.year}, this season — ${drawn}, ${note}`)}">
      <span class="wall-year">${row.year}</span>
      <span class="wall-strip-slot">${stripSvg(row.shown, size, gap)}</span>
      <span class="wall-count">${n}</span>
      <span class="wall-live-note">${esc(note)}</span>
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
  return `<p class="wall-era">Below this line nobody was watching from orbit. A storm that
    stayed at sea was simply never recorded, so these rows are an undercount &mdash; a short
    strip here is not evidence of a quiet year.</p>`;
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
export function wallHtml(rows, { size, gap, filtered = false }) {
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
    html += row.shown.length === 0 ? hairlineHtml(row) : rowHtml(row, { size, gap, filtered });
  }

  return `${html}</div>`;
}
