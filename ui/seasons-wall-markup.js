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
import { CAT, LANDFALL, rowLabel, SATELLITE_ERA_FROM } from '../lib/wall-index.js';
import { isTimeline, sortFigure } from '../lib/wall-filter.js';
import { esc } from './seasons-board-markup.js';
import { dotted } from './loading-dots.js';

/** A storm the record never graded gets GENERIC and never a colour it did not
 *  earn (SPEC §6). `'tropical'` is the nature every HURDAT2 storm in this file
 *  has by construction — the parser drops everything else (§57.13). */
export const dotColor = (cat) => categoryColor(Number.isFinite(cat) ? cat : null, 'tropical', null);

/** `tropical depression`, `Category 4` — for the row's spoken label. */
export const catLabel = (cat) => categoryShortLabel(cat, 'tropical', null);

/**
 * The same grade, spelled out for a sentence.
 *
 * ==> `Cat 5` IS A COLUMN LABEL AND `Category 5` IS PROSE, AND THE COLLAPSED
 * TAIL NEEDS THE SECOND. <== §57.36's own wording is *"142 seasons had no
 * Category 5"*, and `categoryShortLabel` is deliberately terse because its job
 * is fitting inside a badge on a forty-row list. Abbreviating inside a sentence
 * reads as a truncation rather than as a name.
 *
 * It is here rather than in `lib/category.js` because it is the WALL's
 * register, not a second opinion about what a category is — the numbers and
 * the boundaries still come from there, and this only decides how many letters
 * to spend on them.
 */
export const catProse = (cat) => {
  if (cat === 0) return 'tropical depression';
  if (cat === 1) return 'tropical storm';
  const label = catLabel(cat);
  return label.startsWith('Cat ') ? `Category ${label.slice(4)}` : label;
};

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
/**
 * ==> THE LANDFALL MARK IS AN ATTRIBUTE, NOT A SECOND ELEMENT. <== §57.30 step
 * 14 sub-step 4, and Aaron's shape off the mockup: a small triangle pointing UP
 * at the dot it belongs to, centred under it. In the mockup the strip was still
 * an `<svg>` and the triangle was a drawn `<path>`; the shipped strip is DOM
 * elements, because that is what lets a dot carry the app's `box-shadow` glow
 * (see below). So the triangle is a `::after` on the dot itself.
 *
 * That is one attribute rather than a second span per storm, which matters at
 * this scale: 2005 alone is 31 dots and the wall is 175 rows. It also means the
 * mark can never drift away from its dot, because it IS its dot — no second
 * coordinate system, no re-measuring when the strip resizes.
 *
 * ==> IT IS NEUTRAL INK RATHER THAN THE STORM'S OWN COLOUR, DELIBERATELY. <==
 * Coming ashore is a fact about land; strength is what the dot already says.
 * Tinting the triangle by category would make it a dimmer second copy of the
 * dot sitting directly beneath the dot, which reads as a smudge rather than as
 * a mark. `seasons/seasons.css` carries the geometry.
 */
export function stripHtml(list) {
  if (!list.length) return '';
  let parts = '';
  for (const storm of list) {
    /* ==> THE COLUMN IS 0 OR 1 AND IT IS READ AS A FLAG, NEVER COUNTED. <==
     * §57.7a. It briefly carried a real landfall count and Aaron reverted that
     * on glass: the wall asks whether a storm touched land, not how often. */
    const ashore = storm[LANDFALL] ? ' data-lf' : '';
    parts += `<i style="--wall-swatch:${dotColor(storm[CAT])}"${ashore}></i>`;
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
export function rowHtml(row, { filtered = false, sortKey = 'year' } = {}) {
  const label = rowLabel(row, { catLabel });
  const count = filtered && row.shown.length !== row.total
    ? `${row.shown.length}<small> of ${row.total}</small>`
    : `${row.total}`;

  /* ==> A NUMBER YOU ARE SORTING BY AND CANNOT SEE READS AS A BROKEN CONTROL.
   * <== Aaron, 2026-08-26. Year and count are already drawn in their own
   * columns, so those two sorts add nothing here and the strip keeps its full
   * width. The other three borrow about 2.6em of it — measured against the
   * busiest basin that takes a dot from roughly 7px to 6px, and only while
   * that sort is on. `dotSizeFor` re-measures the strip on every render, so
   * the correction is automatic rather than a second calculation. */
  const fig = sortFigure(row, sortKey, { catLabel });
  /* `sub` is the denominator, and it is drawn in the same `<small> of N</small>`
   * shape the count column uses — one visual idiom for "this many out of that
   * many", so a reader who has learned it once has learned it everywhere. */
  const figure = fig
    ? `<span class="wall-figure" aria-hidden="true">${esc(fig.value)}${
        fig.sub ? `<small> of ${esc(fig.sub)}</small>` : ''}</span>`
    : '';

  /* ==> AN ASTERISK RATHER THAN A SHADED BACKGROUND. <== Aaron on glass,
   * 2026-08-26: at the contrast a sepia palette allows, the shaded band under
   * 1966 was barely distinguishable from the rows above it, so the one signal
   * standing between a short 1890s strip and a reader concluding the 1890s
   * were quiet was a tint most eyes would miss. A mark on the year is a
   * different KIND of signal — it survives any palette, it survives a
   * colour-blind reader, and it is the mark §57.36 always wanted for the
   * moment a sort scatters these rows and a contiguous band stops being
   * possible at all. That moment is step 3; the mark lands now. */
  /* The figure is `aria-hidden` and repeated inside the label instead: read as
   * a bare column it announces "18.8" after a sentence and a count, which is
   * three numbers in a row with no idea which is which. */
  /* Spoken as "18 of 31 storms ashore" where there is a denominator, so a
   * screen-reader reader gets the ratio the sighted one can see rather than a
   * bare figure the column no longer shows on its own. */
  const figWords = fig && fig.sub ? `${fig.value} of ${fig.sub} ${fig.unit}`
    : fig ? `${fig.value} ${fig.unit}` : '';
  const spoken = fig && fig.value !== '—' ? `${label}, ${figWords}` : label;

  const ratio = filtered && row.shown.length !== row.total;

  return `<button class="wall-row" type="button" data-year="${row.year}"${row.pre ? ' data-pre="1"' : ''}${fig ? ' data-figure="1"' : ''}${ratio ? ' data-ratio="1"' : ''}
      aria-label="${esc(spoken)}">
      <span class="wall-year">${row.year}${row.pre ? '<b class="wall-star">*</b>' : ''}</span>
      <span class="wall-strip-slot">${stripHtml(row.shown)}</span>
      ${figure}
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

/**
 * What the pinned row says while its storms are still being fetched, and what
 * it says when they could not be.
 *
 * ==> BOTH STATES KEEP THE ROW ON SCREEN. <== §5. A row that disappears on
 * failure reads as "there is no current season", which is the one thing this
 * row exists to deny.
 *
 * ==> `note` IS PLAIN TEXT AND THE ESCAPING HAPPENS HERE, ONCE. <== Aaron on
 * glass, 2026-08-26: switching basin briefly showed markup on screen as
 * literal text. The caller was handing over `dotted(…)`, which is HTML — the
 * animated ellipsis the live globe uses — and this function escaped it a
 * second time, so the reader saw the tag rather than the dots.
 *
 * The rule `ui/loading-dots.js` already states is escape FIRST and animate
 * SECOND, and the only way to keep a caller from getting it backwards is to
 * take text and never markup. A trailing `…` is what asks for the animation;
 * escaping never produces one, so the two can never collide.
 */
export function liveRowPlaceholderHtml(year, note) {
  const text = String(note ?? '');
  return `<div class="wall-row wall-row-live wall-row-flat" role="listitem"
      aria-label="${esc(`${year == null ? 'This season' : year} — ${text}`)}">
      <span class="wall-year">${year == null ? '—' : year}</span>
      <span class="wall-live-note wall-live-note-wide">${dotted(esc(text))}</span>
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
/**
 * ==> AND WITH A FILTER ON IT MUST NOT SAY "NO STORMS RECORDED". <== §5. Step
 * 3 is the first thing that ever produces an empty row: measured 2026-08-26,
 * EVERY season in both basins holds at least one storm, so before the filters
 * landed this function could not be reached at all and its sentence had never
 * been read by anybody. A filtered-out 2005 is not a quiet year, and saying it
 * is would be the wall lying about the busiest season on record.
 */
export function hairlineHtml(row, { filtered = false, phrase = '' } = {}) {
  const what = filtered && phrase
    ? `${row.year} — no ${phrase}`
    : `${row.year} — no storms recorded`;
  return `<div class="wall-hair" role="listitem"
    aria-label="${esc(what)}"><span>${row.year}</span></div>`;
}

/**
 * The collapsed tail, for a wall that is no longer a timeline.
 *
 * ==> IN YEAR ORDER THE GAPS ARE THE INFORMATION; IN ANY OTHER ORDER THEY ARE
 * DEAD SCROLL. <== §57.36, and it is measured rather than assumed: filtering
 * the Atlantic to Category 5 empties 142 of 175 rows. Sorted by year those 142
 * hairlines are what a quiet stretch LOOKS like and collapsing them would
 * quietly redraw history. Sorted by count the timeline is already destroyed,
 * so the same 142 rows are 142 lines of nothing between the reader and the
 * bottom of the screen.
 *
 * ==> COLLAPSED, NEVER HIDDEN, AND IT NAMES WHAT IT IS HIDING. <== A
 * `<details>` so it opens by keyboard for free. *"142 seasons had none"* would
 * make the reader scroll back to the chips to find out what "none" meant.
 */
export function tailHtml(rows, { filtered, phrase }) {
  if (!rows.length) return '';
  const n = rows.length;
  const what = filtered && phrase ? `no ${phrase}` : 'no storms recorded';
  const inner = rows.map((r) => hairlineHtml(r, { filtered, phrase })).join('');
  return `<details class="wall-tail" data-tail>
      <summary>${n} season${n === 1 ? '' : 's'} had ${esc(what)}</summary>
      <div class="wall-tail-rows" role="list">${inner}</div>
    </details>`;
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
export function wallHtml(rows, {
  size, gap, filtered = false, sortKey = 'year', sortDir = 'desc', phrase = '',
} = {}) {
  const live = rows.filter((r) => r.shown.length > 0).length;
  const empty = rows.length - live;

  /* ==> THE TIMELINE IS WHAT DECIDES WHERE THE EMPTY ROWS GO, AND THE SORT
   * DIRECTION IS PART OF IT. <== Oldest-first is still a timeline: the era
   * line just lands on the way UP the record instead of on the way down. Any
   * other key is not. */
  const timeline = isTimeline(sortKey);

  let html = tallyHtml(live, empty);
  html += `<div class="wall" role="list" style="--wall-dot:${size}px;--wall-dot-gap:${gap}px">`;

  const tail = [];
  let eraDrawn = false;

  for (const row of rows) {
    if (row.shown.length === 0 && !timeline) { tail.push(row); continue; }

    /* ==> THE LINE IS DRAWN AT THE CROSSING, WHICHEVER WAY THE ROWS RUN. <==
     * Newest first it lands immediately above the first pre-satellite year;
     * oldest first it lands immediately below the last one, which is the same
     * boundary approached from the other side. Off a timeline it is not drawn
     * at all — the years are scattered and there is nothing for a line to
     * separate, which is exactly when `honestyHtml` takes over. A basin whose
     * record starts after 1966 never crosses it and never draws it, which is
     * correct rather than a missing case. */
    if (timeline && !eraDrawn) {
      const crossingDown = sortDir !== 'asc' && row.year < SATELLITE_ERA_FROM;
      const crossingUp = sortDir === 'asc' && row.year >= SATELLITE_ERA_FROM;
      if (crossingDown || crossingUp) { html += eraLineHtml(); eraDrawn = true; }
    }

    html += row.shown.length === 0
      ? hairlineHtml(row, { filtered, phrase })
      : rowHtml(row, { filtered, sortKey });
  }

  return `${html}</div>${tailHtml(tail, { filtered, phrase })}`;
}
