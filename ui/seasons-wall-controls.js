/**
 * seasons-wall-controls.js — the Wall of Years' filters and its sort control.
 * SPEC-SEASONS-BUILD.md §57.36, §57.30 step 3.
 *
 * Pure functions. No state, no listeners, no fetch — the view owns all three,
 * exactly as `ui/seasons-wall-markup.js` does. It is a second file rather than
 * more of that one because §12's ceiling is real and step 3 puts considerably
 * more on this screen than step 14 did: the two files together are what the
 * wall draws, and the split is rows versus controls.
 *
 * ==> IT REUSES `.seg-group`, `.switch-row` AND `.slider-row` FROM panels.css.
 * <== §12 — any pattern used twice is extracted before the second use, and all
 * three of those already exist. A wall-local lookalike would drift from the
 * real one the first time either moved, and the drawer would end up with two
 * definitions of what a toggle is.
 *
 * ==> WHAT IS DELIBERATELY NOT HERE. <== The near-home slider, which §57.36
 * lists among these controls and which is held back to its own pass: the wall
 * never loads track data, so filtering 175 years by distance needs the
 * whole-basin file — 0.93 MB — whose phone cost is unmeasured. And the retired
 * -names chip, which needs a list of ~120 retired names that does not exist in
 * this repo and which §57.17 forbids scraping. `seasons/wall.json` carries the
 * storm NAMES already, so that chip is a list away rather than a rebuild away.
 */

import { SEASONS } from '../config/constants.js';
import { CATEGORY_INDEXES, isFiltered, isTimeline } from '../lib/wall-filter.js';
import { esc } from './seasons-board-markup.js';
import { catLabel, dotColor } from './seasons-wall-markup.js';

/* ---------------------------------------------------------------------------
 * THE CHIPS
 * ------------------------------------------------------------------------- */

/** What sits INSIDE a chip. The colour is the documentation — §57.36 chose
 *  seven coloured chips over seven labelled checkboxes precisely so the
 *  control explains itself in one row — so the text is the shortest thing that
 *  disambiguates two chips of similar hue. `TD`, `TS`, then bare numerals. */
const CHIP_TEXT = ['TD', 'TS', '1', '2', '3', '4', '5'];

/**
 * The seven category chips.
 *
 * ==> EACH ONE IS A REAL `aria-pressed` BUTTON, NOT A STYLED DIV. <== §13.
 * Seven independent on/off controls is a set of toggle buttons, not a
 * radiogroup — a reader can hold Cat 3, 4 and 5 at once and that is the point.
 * A radiogroup would announce them as mutually exclusive, which is a lie about
 * what the control does.
 *
 * ==> THE VISIBLE LABEL IS A NUMERAL AND THE SPOKEN ONE IS A SENTENCE. <== A
 * screen reader hearing "4, pressed" has no idea whether that is a category, a
 * count or a year, so `aria-label` carries the whole thing and the numeral is
 * left for the eye.
 *
 * ==> AND THE COLOUR IS THE SAME FUNCTION THE DOTS USE. <== `dotColor`, from
 * the markup file. §10's fixed visual contract: a Cat 3 chip and a Cat 3 dot
 * are the same claim and must not be two lookups that could disagree.
 */
export function chipsHtml(cats) {
  const on = (c) => !!cats?.has(c);
  const chips = CATEGORY_INDEXES.map((c) => `
      <button class="wall-chip" type="button" data-chip="${c}"
              aria-pressed="${String(on(c))}"
              aria-label="${esc(catLabel(c))}"
              style="--wall-chip-ink:${dotColor(c)}"
      ><span aria-hidden="true">${CHIP_TEXT[c]}</span></button>`).join('');

  return `<div class="wall-chips" role="group" aria-label="Strength">${chips}</div>`;
}

/* ---------------------------------------------------------------------------
 * THE TOGGLE AND THE THRESHOLDS
 * ------------------------------------------------------------------------- */

/** The landfall toggle, in the app's own switch. Visible by default per
 *  §57.36: it is the one filter a reader arrives already wanting. */
export function landfallToggleHtml(on) {
  return `<button class="switch-row wall-switch" type="button" role="switch"
      data-landfall aria-checked="${String(!!on)}">
      <span>Came ashore</span>
      <span class="switch-track" aria-hidden="true"></span>
    </button>`;
}

/**
 * One threshold slider.
 *
 * ==> ZERO IS OFF, AND THE SLIDER SAYS SO IN WORDS RATHER THAN SHOWING A `0`.
 * <== A slider parked at its floor filtering nothing, labelled `0 days`, reads
 * as a filter that is on and matching everything — which is indistinguishable
 * from a broken filter. `Any` is the honest label for the same position.
 *
 * `aria-valuetext` carries the same words, or a screen reader announces the
 * raw number and loses the distinction entirely.
 */
function thresholdHtml({ id, label, value, min, max, step, words, invert = false }) {
  const v = Number.isFinite(value) ? value : (invert ? max : min);
  const text = Number.isFinite(value) ? words(v) : 'Any';
  return `
      <div class="slider-row">
        <label class="slider-label" for="wall-${id}">
          <span>${esc(label)}</span>
          <span class="slider-value">${esc(text)}</span>
        </label>
        <input class="slider" type="range" id="wall-${id}" data-threshold="${id}"
               min="${min}" max="${max}" step="${step}" value="${v}"
               aria-valuetext="${esc(text)}">
      </div>`;
}

/**
 * The collapsed set. §57.36 puts these behind a disclosure because they are
 * questions a reader arrives with occasionally, and the seven chips plus the
 * landfall toggle plus the sort control already fill the space above the wall
 * on a phone — every row of controls is a row of years the reader cannot see.
 *
 * ==> A REAL `<details>`, NOT A DIV THAT REMEMBERS. <== It is open and closed
 * by keyboard for free, it is announced as a disclosure, and its state
 * survives the view's own re-render only because the view passes `open` back
 * in — which it must, or changing a chip would slam this shut under the
 * reader's thumb.
 */
export function moreFiltersHtml(f, open) {
  const rows = thresholdHtml({
    id: 'days',
    label: 'Lasted at least',
    value: f.minDays,
    min: SEASONS.wallDaysMin,
    max: SEASONS.wallDaysMax,
    step: SEASONS.wallDaysStep,
    words: (v) => `${v} day${v === 1 ? '' : 's'}`,
  }) + thresholdHtml({
    id: 'pressure',
    label: 'Pressure below',
    value: f.maxPressureMb,
    min: SEASONS.wallPressureMin,
    max: SEASONS.wallPressureMax,
    step: SEASONS.wallPressureStep,
    words: (v) => `${v} mb`,
    /* ==> THIS ONE'S "OFF" IS AT THE TOP OF THE TRAVEL, NOT THE BOTTOM. <==
     * Lower pressure is a stronger storm, so dragging LEFT narrows here and
     * narrows nothing on the other two. Parking it at the max when unset is
     * what makes the first drag off the rail behave the way the thumb
     * expects. */
    invert: true,
  }) + thresholdHtml({
    id: 'ace',
    label: 'ACE at least',
    value: f.minAce,
    min: SEASONS.wallAceMin,
    max: SEASONS.wallAceMax,
    step: SEASONS.wallAceStep,
    words: (v) => `${v} ACE`,
  });

  return `<details class="wall-more"${open ? ' open' : ''} data-more>
      <summary>More filters</summary>
      ${rows}
    </details>`;
}

/* ---------------------------------------------------------------------------
 * THE SORT
 * ------------------------------------------------------------------------- */

/**
 * ==> TEN NAMED ORDERINGS IN ONE NATIVE DROPDOWN, RATHER THAN FIVE BUTTONS
 * THAT FLIP WHEN PRESSED TWICE. <== Aaron's call, 2026-08-26. Five segments
 * where re-pressing the selected one reverses it is compact and it is the
 * usual pattern, but nothing on screen says the second press does anything
 * different, and §13 requires a keyboard path for every action — "press it
 * again" has no honest keyboard equivalent that is not just a second Enter
 * doing something invisible.
 *
 * A `<select>` gets the keyboard, the screen reader and the platform picker
 * for nothing, and it costs one line instead of a row of five.
 *
 * ==> THE WORDS ARE THE ORDERING, NOT THE FIELD. <== `Most storms first`
 * rather than `Count, descending`. The reader is choosing an arrangement of
 * the screen, and "descending" makes them work out which end that puts first.
 */
const SORT_OPTIONS = [
  ['year', 'desc', 'Newest year first'],
  ['year', 'asc', 'Oldest year first'],
  ['count', 'desc', 'Most storms first'],
  ['count', 'asc', 'Fewest storms first'],
  ['strongest', 'desc', 'Strongest first'],
  ['strongest', 'asc', 'Weakest first'],
  ['landfalls', 'desc', 'Most landfalls first'],
  ['landfalls', 'asc', 'Fewest landfalls first'],
  ['ace', 'desc', 'Most ACE first'],
  ['ace', 'asc', 'Least ACE first'],
];

export function sortHtml(key, dir) {
  const opts = SORT_OPTIONS.map(([k, d, label]) => `
      <option value="${k}:${d}"${k === key && d === dir ? ' selected' : ''}>${esc(label)}</option>`).join('');
  return `<div class="wall-sort">
      <label class="wall-sort-label" for="wall-sort">Order</label>
      <select class="wall-sort-select" id="wall-sort" data-sort>${opts}</select>
    </div>`;
}

/* ---------------------------------------------------------------------------
 * THE HONESTY LINE
 * ------------------------------------------------------------------------- */

/** `0.53` -> `0.53`, `2` -> `2`. Two places is the resolution the rates
 *  actually differ at — 0.11 against 0.53 — and three would be a precision the
 *  underlying counts do not support. */
const rate = (n) => (n == null ? '—' : String(Math.round(n * 100) / 100));

/**
 * The pre-satellite undercount, in the numbers it currently has.
 *
 * ==> IT IS A PERSISTENT LINE, NOT A TOOLTIP AND NOT A SHADE. <== §57.36. In
 * year order a contiguous band and a line at 1966 carry this on their own,
 * because the shading reads as "the record gets thinner up here". Sort by
 * anything else and those years scatter through the list, the line cannot be
 * drawn at all, and the band loses its meaning — at which point an unmarked
 * leaderboard states that Category 5 hurricanes are a modern phenomenon. That
 * is a climate claim this dataset cannot support, made accidentally, by a
 * sort control.
 *
 * ==> SO IT APPEARS WHENEVER A FILTER **OR** A NON-YEAR SORT IS ACTIVE. <==
 * Either one is enough. A filter alone still scatters the counts across the
 * eras; a sort alone still destroys the band.
 *
 * @param {object} split  from `eraSplit`
 * @param {string} phrase from `filterPhrase`
 */
export function honestyHtml(split, phrase) {
  /* A basin whose whole record is post-satellite has no comparison to draw and
   * nothing to disclose — the East Pacific starts in 1949, so it does have
   * pre-1966 seasons, but a future basin might not. Saying nothing is correct
   * here rather than a missing case. */
  if (!split || split.preSeasons === 0) return '';

  const per = (n) => `${rate(n)} a year`;
  const times = split.ratio != null && split.ratio >= 1.5
    ? ` &mdash; about ${Math.round(split.ratio * 10) / 10}&times; the rate`
    : '';

  return `<p class="wall-honesty" role="note">
      <b class="wall-star">*</b>
      Before ${split.from}, ${split.preStorms} of these across ${split.preSeasons} seasons
      (${per(split.preRate)}). Since, ${split.postStorms} across ${split.postSeasons}
      (${per(split.postRate)})${times}.
      Almost none of that gap is weather &mdash; nobody could measure a storm that stayed at
      sea before satellites, so every starred row is an undercount and a
      ${esc(phrase)} leaderboard is not a record of the weather.</p>`;
}

/* ---------------------------------------------------------------------------
 * THE WHOLE CONTROL BLOCK
 * ------------------------------------------------------------------------- */

/**
 * Everything above the wall.
 *
 * @param {object} opts
 * @param {object} opts.filter
 * @param {string} opts.sortKey
 * @param {string} opts.sortDir
 * @param {boolean} opts.moreOpen
 * @param {object|null} opts.split   from `eraSplit`, over the filtered rows
 * @param {string} opts.phrase       from `filterPhrase`
 */
export function controlsHtml({ filter, sortKey, sortDir, moreOpen, split, phrase }) {
  const disclose = isFiltered(filter) || !isTimeline(sortKey);
  return `<div class="wall-controls">
      ${chipsHtml(filter.cats)}
      ${landfallToggleHtml(filter.landfall)}
      ${sortHtml(sortKey, sortDir)}
      ${moreFiltersHtml(filter, moreOpen)}
    </div>${disclose ? honestyHtml(split, phrase) : ''}`;
}
