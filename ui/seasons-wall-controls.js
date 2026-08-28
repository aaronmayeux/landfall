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
      <span>Made landfall</span>
      <span class="switch-track" aria-hidden="true"></span>
    </button>`;
}

/**
 * What each threshold's figure reads as.
 *
 * ==> HOISTED OUT OF `moreFiltersHtml` AND EXPORTED, BECAUSE A SECOND CALLER
 * APPEARED. <== §12: a pattern used twice gets extracted before the second
 * use. The view patches this readout in place while the reader drags (the
 * slider fix — see `view-seasons-wall.js`'s `onInput`), so the words are now
 * written in one place and read in two. Inline copies would look identical
 * the day they were written and drift the first time a unit was retuned, and
 * the symptom would be the dragged figure disagreeing with the rendered one.
 *
 * ==> `Any` IS NOT IN HERE, BECAUSE IT IS NOT A VALUE. <== It is what the row
 * says when the filter is OFF, which `thresholdHtml` decides from whether the
 * value is finite at all. Folding it in would make every caller ask the same
 * question twice.
 */
export const THRESHOLD_WORDS = Object.freeze({
  days: (v) => `${v} day${v === 1 ? '' : 's'}`,
  pressure: (v) => `${v} mb`,
  ace: (v) => `${v} ACE`,
});

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
    words: THRESHOLD_WORDS.days,
  }) + thresholdHtml({
    id: 'pressure',
    label: 'Pressure below',
    value: f.maxPressureMb,
    min: SEASONS.wallPressureMin,
    max: SEASONS.wallPressureMax,
    step: SEASONS.wallPressureStep,
    words: THRESHOLD_WORDS.pressure,
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
    words: THRESHOLD_WORDS.ace,
  });

  /* ==> THE ROWS SIT INSIDE A WRAPPER, AND THE WRAPPER IS WHAT ANIMATES. <==
   * A `<details>` cannot be transitioned: the browser flips its children
   * between rendered and not-rendered, so there is nothing in between to ease.
   * The shipped trick is a grid whose single row goes 0fr -> 1fr, which IS
   * animatable — and the inner element needs `min-height: 0` and
   * `overflow: hidden` or it refuses to be squashed below its content.
   *
   * ==> WHICH MEANS THE PANEL MUST NOT BE `display: none` WHILE CLOSED. <== A
   * closed `<details>` hides everything after the summary, so the markup keeps
   * the panel visible to CSS and lets the grid do the hiding. Its own rule in
   * `seasons.css` says so where a future reader would otherwise "fix" it. */
  return `<details class="wall-more"${open ? ' open' : ''} data-more>
      <summary>
        <span>More filters</span>
        <span class="wall-more-chevron" aria-hidden="true"></span>
      </summary>
      <div class="wall-more-panel"><div class="wall-more-inner">${rows}</div></div>
    </details>`;
}

/* ---------------------------------------------------------------------------
 * THE SORT
 * ------------------------------------------------------------------------- */

/**
 * ==> FIVE BUTTONS, AND PRESSING THE SELECTED ONE REVERSES IT. <== Aaron on
 * glass, 2026-08-27, against the mockup. This shipped first as a `<select>`
 * holding ten named orderings, on the argument that "press it again" is an
 * affordance nothing on screen announces. He looked at both and chose the
 * buttons, and he is the one holding the phone.
 *
 * ==> SO THE ARROW HAS TO DO THE ANNOUNCING. <== The selected button carries a
 * visible ↓ or ↑ — that is the whole signal that direction exists at all, and
 * without it this control has a hidden second state. `aria-label` spells the
 * rest out for a screen reader: which way it is sorting now, and that pressing
 * again flips it. Enter on a focused button is the keyboard path and it is the
 * same one press-again uses, so §13 is satisfied by the ordinary button
 * behaviour rather than by a second control.
 *
 * ==> AND THE ROW WRAPS RATHER THAN SCROLLING SIDEWAYS. <== The mockup has
 * four; this has five, and five labels do not fit across 390px at a legible
 * size. A horizontal scroller would hide ACE behind a gesture with nothing
 * saying it was there.
 */
const SORT_KEYS = [
  ['year', 'Year', 'Newest year first', 'Oldest year first'],
  ['count', 'Count', 'Most storms first', 'Fewest storms first'],
  ['strongest', 'Strongest', 'Strongest first', 'Weakest first'],
  /* ==> "MADE LANDFALL", AND IT MATCHES THE FILTER TOGGLE'S OWN WORDING ON
   * PURPOSE. <== The two controls ask the same question — did this storm touch
   * land — and calling it two things invited the reader to assume the sort
   * counted something the toggle did not.
   *
   * ==> IT WAS "CAME ASHORE" UNTIL 2026-08-28 AND AARON'S REASON FOR THE
   * CHANGE IS THE WHOLE ARGUMENT: THE APP IS CALLED LANDFALL. <== The old
   * wording was chosen to avoid implying a COUNT of crossings, but that
   * concern is about what the number means and is answered where the number is
   * computed (`lib/wall-index.js` counts storms, not crossings). It was never
   * a reason to spend the app's own word. */
  ['landfalls', 'Made landfall', 'Most landfalls first', 'Fewest landfalls first'],
  ['ace', 'ACE', 'Most ACE first', 'Least ACE first'],
];

export function sortHtml(key, dir) {
  const buttons = SORT_KEYS.map(([k, label, descLabel, ascLabel]) => {
    const on = k === key;
    const desc = on ? dir !== 'asc' : true;
    const now = desc ? descLabel : ascLabel;
    const flipped = desc ? ascLabel : descLabel;
    /* An unselected button says what it WOULD do; the selected one says what it
     * is doing and what a second press changes it to. */
    const spoken = on ? `${now}. Press again for ${flipped.toLowerCase()}` : now;
    const arrow = on ? `<span class="wall-sort-arrow" aria-hidden="true">${desc ? '↓' : '↑'}</span>` : '';
    return `
      <button class="wall-sort-btn" type="button" data-sort="${k}"
              aria-pressed="${String(on)}" aria-label="${esc(spoken)}"
      ><span aria-hidden="true">${label}</span>${arrow}</button>`;
  }).join('');

  return `<div class="wall-sort" role="group" aria-label="Order">${buttons}</div>`;
}

/* ---------------------------------------------------------------------------
 * THE HONESTY LINE
 * ------------------------------------------------------------------------- */

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
export function honestyHtml(split) {
  /* A basin whose whole record is post-satellite has no comparison to draw and
   * nothing to disclose — the East Pacific starts in 1949, so it does have
   * pre-1966 seasons, but a future basin might not. Saying nothing is correct
   * here rather than a missing case. */
  if (!split || split.preSeasons === 0) return '';

  return `<p class="wall-honesty" role="note">
      <b class="wall-star">*</b>
      Starred seasons are from before satellites, when a storm that stayed at sea
      went uncounted &mdash; so their figures are undercounts, not the weather.</p>`;
}

/* ---------------------------------------------------------------------------
 * THE WHOLE CONTROL BLOCK
 * ------------------------------------------------------------------------- */

/**
 * Everything above the wall.
 *
 * ==> THE HONESTY LINE IS NO LONGER RENDERED HERE, AND THAT IS THE SLIDER FIX
 * REACHING BACK ONE FILE. <== It is a function of the FILTERED rows, so it
 * changes as a threshold moves — which meant it had to live below the sliders
 * rather than in the same block as them, or a drag would rebuild its own
 * control. `view-seasons-wall.js`'s results slot renders it now, and
 * `honestyHtml` is exported for that caller. This block is the controls and
 * nothing else.
 *
 * @param {object} opts
 * @param {object} opts.filter
 * @param {string} opts.sortKey
 * @param {string} opts.sortDir
 * @param {boolean} opts.moreOpen
 */
export function controlsHtml({ filter, sortKey, sortDir, moreOpen }) {
  return `<div class="wall-controls">
      ${chipsHtml(filter.cats)}
      ${landfallToggleHtml(filter.landfall)}
      ${sortHtml(sortKey, sortDir)}
      ${moreFiltersHtml(filter, moreOpen)}
    </div>`;
}
