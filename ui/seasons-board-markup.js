/**
 * seasons-board-markup.js — every string of HTML the season board draws.
 * SPEC-SEASONS-BUILD.md §57.18, §57.18a, §57.19, §57.30 step 5.
 *
 * ==> IT IS A SPLIT ALONG STATE VERSUS MARKUP, AND NOTHING ELSE MOVED. <==
 * `ui/view-seasons-board.js` was 584 lines before step 5b and the current
 * season's three extra states would have carried it past §12's ~700 ceiling.
 * The cut that costs nothing is this one: the view owns what is true, this
 * file owns what that looks like. Every function below is PURE — it is handed
 * what it needs and reads no module state, no clock and no DOM — so it can be
 * driven straight from a suite without mounting anything.
 *
 * ==> THE BOARD STILL OWNS EVERY DECISION. <== Nothing here decides which
 * filters exist, which year is live, or whether a season is provisional. It is
 * told. That is what keeps a rule from ending up written twice, once in the
 * state machine and once in a template, which is how the two drift.
 *
 * Imports config/ and lib/. No DOM, no network, no clock.
 */

import { SEASONS } from '../config/constants.js';
import { categoryColor, categoryShortLabel } from '../lib/category.js';
import { stormDisplayName } from '../lib/season-names.js';
import {
  NEAR_HOME_FILTER, approachNoteHtml, entriesNearHome, nearHomeFilters,
} from './seasons-near-home.js';
/* ==> THE ROSTER ASSEMBLES; IT DOES NOT WRITE THE SEASON'S SENTENCES. <== The
 * five below are `ui/seasons-board-furniture.js`'s, and the import runs one
 * way: this file reaches for them, and nothing over there knows a roster
 * exists. That is the boundary the cut was made on — a storm's row against a
 * season's furniture — and a re-export here to save the callers a line would
 * quietly turn it back into one file with two names. */
import {
  emptyRosterHtml, footprintSlotHtml, ghostsHtml, seasonFailedHtml, waitingHtml,
} from './seasons-board-furniture.js';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * The filters a season can offer. §57.19 drops "None" — it was a button that
 * did nothing useful — and holds "Near home" back to step 9, which owns the
 * radius slider and the precomputed distances it filters on.
 *
 * ==> LANDFALLS IS NOT OFFERED FOR THE SEASON IN PROGRESS, AND THAT IS A
 * MEASUREMENT RATHER THAN A PREFERENCE. <== A landfall mark is NOAA's `L`
 * record identifier, which lives in HURDAT2 and in no ATCF b-deck. Counted
 * over all fifteen b-decks in `samples/seasons-live/` — 601 rows, the whole
 * 2026 season — the parser finds zero landfalls on storms that plainly
 * reached land.
 *
 * ==> AND THE TRAP IS THAT AN `L` IS SITTING RIGHT THERE. <== Column 23 is
 * ATCF's SUBREGION letter. Over those same 601 rows it takes exactly three
 * values, and they are the three basins: `L` on all 55 Atlantic rows, `C` on
 * all 144 Central Pacific ones, `E` on all 402 East Pacific ones. Anyone who
 * reached for it would ship a feature marking every Atlantic record as a
 * landfall and no Pacific one.
 *
 * So the filter could only ever come back empty, and a control that cannot
 * succeed is the same mistake as a Retry button on a year the archive does not
 * hold (§57.18a).
 */
/** The default for `activeIds`. A frozen module-level Set rather than `new Set()`
 *  in the parameter list: that would allocate one per render, and this is called
 *  on every repaint of a list that can run to forty rows. Never written to. */
const EMPTY_SET = new Set();

const FILTER_ALL = Object.freeze({ id: 'all', label: 'All' });
const FILTER_MAJORS = Object.freeze({ id: 'majors', label: 'Majors' });
const FILTER_LANDFALLS = Object.freeze({ id: 'landfalls', label: 'Landfalls' });

/**
 * ==> AND `Near home` IS THE FOURTH, WHICH §57.19 ASKED FOR AND STEP 5 HELD
 * BACK. <== It was deliberately absent rather than present and dead while step
 * 9 was unbuilt. It is offered ONLY when a home is set — `nearHomeFilters`
 * makes that call, in `ui/seasons-near-home.js`, beside the measurement it
 * governs — for the same reason `Landfalls` is withheld from the season in
 * progress: a filter that can only ever come back empty is a control that
 * cannot succeed, and an empty roster is the one shape this feature must not
 * produce by accident (§5).
 *
 * @param {boolean} provisional  the season still running
 * @param {{lon:number,lat:number}|null} [home]
 */
export function filtersFor(provisional, home = null) {
  const base = provisional
    ? [FILTER_ALL, FILTER_MAJORS]
    : [FILTER_ALL, FILTER_MAJORS, FILTER_LANDFALLS];
  return [...base, ...nearHomeFilters(home)];
}

/**
 * Which storms one filter actually shows.
 *
 * ==> IT LIVES BESIDE `filtersFor` BECAUSE THE TWO ARE ONE RULE. <== That
 * function says which filters EXIST; this one says what each of them SELECTS,
 * and a filter offered by one and unknown to the other is a control that
 * narrows to nothing. They were in different files until this pass, which is
 * exactly the drift §12 warns about — and moving this one here is also what
 * took `ui/view-seasons-board.js` back under the ceiling for the third seasons
 * pass running.
 *
 * ==> AN UNKNOWN FILTER ID SHOWS EVERYTHING RATHER THAN NOTHING. <== §5's
 * shape applied to a control: a roster that empties because a filter name
 * drifted looks exactly like a season with no storms in it, and the reader
 * cannot tell those apart. Showing too much is visibly wrong; showing nothing
 * is invisibly wrong.
 *
 * @param {Array<{storm:object, facts:object}>} entries  the whole season
 * @param {string} filter  a filter id from `filtersFor`
 */
export function entriesMatching(entries, filter, near = null) {
  /* ==> NEAR HOME IS ANSWERED FIRST AND BY SOMEBODY ELSE. <== It is the one
   * filter whose answer is not a property of the storm — it depends on where
   * the reader lives and how far they dragged a slider — so it takes an extra
   * argument the other three have no use for, and the measurement itself lives
   * in `ui/seasons-near-home.js` beside the geometry that produces it.
   *
   * ==> WITHOUT THAT ARGUMENT IT SHOWS EVERYTHING, WHICH IS THE UNKNOWN-FILTER
   * RULE BELOW APPLIED TO A KNOWN ONE. <== A caller that forgot to pass the
   * radius is a bug, and the visible failure (too many rows) is the one a
   * reader can see. The invisible one — a roster that empties because a
   * parameter went missing — looks exactly like a season with no storms in it. */
  if (filter === NEAR_HOME_FILTER) {
    if (!near?.home || !Number.isFinite(near?.nm)) return entries;
    return entriesNearHome(entries, near.home, near.nm);
  }
  if (filter === 'majors') {
    return entries.filter((e) => Number.isFinite(e.facts.peakWindKt)
      && e.facts.peakWindKt >= SEASONS.majorKt);
  }
  if (filter === 'landfalls') return entries.filter((e) => e.facts.landfalls.length > 0);
  return entries;
}

/** Month and day, no year — the year is the whole screen's subject and
 *  repeating it on thirty rows is noise. UTC because the records are. */
const MD = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', timeZone: 'UTC',
});

/**
 * @param {object|null} facts   from `stormFacts`
 * @param {boolean} [active]    the storm is still happening (§57.21c)
 *
 * ==> A RUNNING STORM HAS NO END DATE, SO THE CELL SAYS SO INSTEAD OF PRINTING
 * ONE. <== The last row in a live b-deck is where the storm was six hours ago,
 * not where it stopped. Formatting it as the second half of a range would put a
 * finished date on a storm that is still out there — the same claim the archive
 * refuses to make by leaving it off the globe, made again in eight characters.
 *
 * The START date stays. It is a real fact, it is the thing the chronological
 * roster is ordered by, and dropping it would cost the reader the one date this
 * row can honestly give them.
 */
export function dateRange(facts, active = false) {
  if (!Number.isFinite(facts?.firstTime)) return active ? 'active' : '';
  const a = MD.format(new Date(facts.firstTime));
  if (active) return `${a} – active`;
  const b = MD.format(new Date(facts.lastTime));
  return a === b ? a : `${a} – ${b}`;
}

/** How a storm is called on a row — and, since step 6, along its track on the
 *  globe. The rule moved to `lib/season-names.js` when it got that second
 *  caller; this re-export is here so the markup's own callers below read the
 *  same as they always did. */
export const displayName = stormDisplayName;

/* ---------------------------------------------------------------------------
 * THE PICKER
 * ------------------------------------------------------------------------- */

/* ==> THE YEAR PICKER IS NOT IN THIS FILE ANY MORE. <== §57.39a. It is the
 * drawer's HEADING now, built by `ui/year-stepper.js` as a live node rather
 * than as a string of markup, and the row it used to occupy at the top of the
 * body is deleted. Two reasons, both from glass on 2026-08-28: the year was
 * printed twice one line apart (`pickerHtml` used to argue that repetition
 * earned its place, and it did not), and the two buttons sat directly under
 * the Back chevron and the close X, which is the mis-press fault
 * `ui/storm-stepper.js` was rebuilt to escape in the live drawers.
 *
 * It could not stay a string. The header is a SIBLING of the body this file
 * writes into, so it is outside the board's one delegated click listener, and
 * a control rebuilt on every render would throw away the focus of a reader
 * walking the record by keyboard. Both of those want a persistent element.
 *
 * ==> WHAT THE OLD COMMENT SAID ABOUT THE 175-YEAR `<select>` AND THE BASIN
 * SEGMENTS IS STILL TRUE AND STILL LOAD-BEARING. <== §57.36. There is one way
 * into a year and it is the Wall of Years; a second control listing every
 * season would be a second front door, and two doors to one place drift apart
 * the moment either grows a filter. The wall owns the basin for a sharper
 * reason: changing basin with a year already open has to decide what becomes
 * of a year the other ocean does not hold, and the Pacific record starts in
 * 1949. The wall changes it while nothing is open, where that cannot arise.
 * What is left here is the NEIGHBOURS, which is the move a reader comparing
 * two seasons actually makes.
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * FILTERS AND ROWS
 * ------------------------------------------------------------------------- */

export function filtersHtml({ filters, filter }) {
  const segs = filters.map((f) => `
      <button class="seg" type="button" role="radio" data-filter="${esc(f.id)}"
              aria-checked="${String(f.id === filter)}">${esc(f.label)}</button>`).join('');
  return `<div class="seg-group" role="radiogroup" aria-label="Filter">${segs}</div>`;
}

/**
 * One storm. §57.21b item 1.
 *
 * ==> LEFT TO RIGHT: A REAL CHECKBOX, THE CATEGORY DOT, THE NAME, THE STRENGTH
 * BADGE, THE LANDFALL MARK, THE DATES. <== Aaron's list, 2026-08-25.
 *
 * ==> THE DOT STOPPED BEING THE CHECKBOX. <== It was a hollow ring in the
 * storm's Saffir-Simpson colour that filled when ticked — one element carrying
 * two meanings, which was only ever a way to avoid putting a second control on
 * a forty-row list. With a real tick box beside it the ring has no job, so the
 * dot is now `.row-swatch`: the same 12px solid dot with its faint glow that
 * every other list in this app uses, from one rule rather than two that look
 * alike.
 *
 * ==> AND THE BOX IS THE APP'S OWN, NOT A NATIVE ONE. <== The `<input>` is
 * real and does all the work — state, keyboard, screen reader — and is moved
 * out of sight; `.check-box` beside it is the drawn tick the Layers panel
 * already uses. A platform checkbox would be a different shape and a different
 * blue on every device the app runs on, which is the one thing a fixed visual
 * contract (§10) exists to prevent.
 *
 * ==> STRENGTH IS THE STORM LIST'S OWN BADGE, FROM THE SAME FUNCTION AND THE
 * SAME CLASS. <== `.row-badge` in neutral ink, right-aligned. Colour and text
 * do not double up: the swatch is already the hue, so tinting the word would
 * say the same thing twice (§6) — and Cat 1's yellow cannot reach AA at badge
 * size on a light background anyway.
 *
 * ==> THE WHOLE ROW IS THE **OPEN** TARGET NOW, NOT THE TICK TARGET, AND THAT
 * REVERSES §57.21b ITEM 1. <== Aaron on glass, 2026-08-25: *"tapping anywhere
 * on the row should open the storm detail."* The row was a `<label>` whose
 * every pixel ticked, with a chevron at the end that opened; the argument was
 * that a 44px box inside a 320px row is a target most thumbs miss. It still
 * is — which is why the swatch, the text and the chevron are now ONE button
 * spanning everything the box does not, rather than the tap zone shrinking.
 *
 * ==> AND OPENING STILL DRAWS THE STORM, SO NOTHING IS LOST BY TAPPING THE
 * WRONG ONE. <== `showStorm` ticks a storm on the way into its panel, so the
 * row tap is a superset of what the label used to do. The box remains for the
 * reader comparing four storms on the globe who does not want a panel each
 * time.
 *
 * ==> THE CHEVRON IS NOW A GLYPH INSIDE THAT BUTTON RATHER THAN A BUTTON OF
 * ITS OWN. §57.22b. <== It was its own 44px control at the end of the row.
 * With the whole row opening, a second button doing the same thing would be
 * two tab stops and two press targets for one action — so it is decoration
 * on the one that already exists, and says which way the row goes.
 *
 * ==> THIS IS THE EXACT MARKUP THAT WAS UNDER SUSPICION FOR A DAY. <== Step 7
 * added it, glass reported every tap target in this drawer misbehaving, and
 * the whole step was reverted with the cause unknown. The row was then rebuilt
 * from scratch for §57.21b and confirmed on glass — which cleared the row and
 * is the evidence this is being built on. If taps misbehave again, the chevron
 * is now the narrowest remaining suspect and `tools/seasons-row-check.mjs`
 * measures its box.
 *
 * A real `<button>` rather than a tap zone, so the keyboard gets it for free —
 * Tab reaches the checkbox and then the chevron on every row, in reading
 * order, and Enter opens. That is §13's third input path, obtained as a side
 * effect of using the right element rather than as a special case.
 *
 * ==> IT SITS OUTSIDE THE `<label>`, AND THAT IS LOAD-BEARING RATHER THAN
 * TIDY. <== Nested inside, every press of it would ALSO toggle the checkbox it
 * was nested in, because that is a label's whole job — so opening a storm
 * would silently draw or undraw its track on the way past.
 */
export function rowHtml({ storm, facts, on, active = false, near = null, home = null, system = null }) {
  const color = categoryColor(facts.peakCategory ?? null, 'tropical', null);
  const strength = categoryShortLabel(facts.peakCategory ?? null, 'tropical', null);

  /* ==> A STORM THAT IS STILL HAPPENING IS LISTED AND CANNOT BE DRAWN. <==
   * §57.21c, Aaron's call 2026-08-25. It stays on the roster because leaving it
   * off would make the season in progress look shorter than it is — the one
   * screen whose whole job is "what has this year done so far". What it may not
   * do is go on the sepia globe: it has a cone, a wind field and a warning map
   * on the LIVE globe, and half a best track drawn in archive ink beside 1935
   * is the app telling a reader a storm is over that nobody has declared over.
   *
   * ==> THE BOX IS DISABLED RATHER THAN ABSENT, AND THAT IS §5 AND §13 BOTH.
   * <== A row that silently has no checkbox where every other row has one reads
   * as a rendering fault, and it is a control that vanishes rather than
   * explains (§7). Disabled, it keeps the column aligned, keeps its place in
   * the tab order's logic, and carries the reason in the label a screen reader
   * hears. `aria-disabled` rides alongside `disabled` because the two are read
   * by different assistive stacks. */
  const drawLabel = active
    ? `${displayName(storm)} is still happening — it is on the live globe, not this one`
    : `Draw ${displayName(storm)} on the globe`;

  /* The landfall mark. §57.21a took the pin off the globe, so this row is now
   * the ONLY place a landfall surfaces — which is why it moved to the left of
   * the dates rather than trailing them. It names itself in words for a screen
   * reader rather than leaving a glyph to carry meaning on its own (§13). A
   * provisional season simply has none, which is the absence `scoreHtml`
   * explains rather than one to explain again on every row. */
  const lf = facts.landfalls.length
    ? '<span class="seasons-lf" aria-hidden="true">▲</span>'
    : '';
  const lfLabel = facts.landfalls.length
    ? `, made ${facts.landfalls.length === 1 ? 'landfall' : `${facts.landfalls.length} landfalls`}`
    : '';

  return `
      <li class="seasons-row" data-row="${esc(storm.id)}" ${active ? 'data-active="true"' : ''}>
        <label class="seasons-check">
          <input type="checkbox" data-storm="${esc(storm.id)}" ${on ? 'checked' : ''}
                 ${active ? 'disabled aria-disabled="true"' : ''}
                 aria-label="${esc(drawLabel)}">
          <span class="check-box" aria-hidden="true"></span>
        </label>
        <button class="seasons-open" type="button" data-open="${esc(storm.id)}"
                aria-label="Open ${esc(displayName(storm))}, ${esc(strength)}${lfLabel}">
          <span class="row-swatch" style="--swatch: ${esc(color)}" aria-hidden="true"></span>
          <span class="seasons-row-text">
            <span class="seasons-name">${esc(displayName(storm))}</span>
            <span class="row-badge">${esc(strength)}</span>
            <span class="seasons-row-meta">
              ${lf}
              <span class="seasons-when">${esc(dateRange(facts, active))}</span>
            </span>
            ${approachNoteHtml(near, home, system)}
          </span>
          <span class="seasons-open-chevron" aria-hidden="true"></span>
        </button>
      </li>`;
}

/**
 * The master checkbox above the roster. §57.21b item 4.
 *
 * ==> IT IS THE SPREADSHEET'S THREE-STATE FILTER HEADER, NOT TWO BUTTONS. <==
 * Aaron's call, 2026-08-25: it should be a checkbox like all the other
 * checkboxes and behave the way a spreadsheet's does. None ticked, it is
 * empty; some ticked, a bar; all ticked, a tick. Pressing it when it is not
 * full ticks everything on the list, and pressing it when it is full clears
 * them. That is one control that can answer "put the whole year up" and "clear
 * it" without either being a separate button, and every reader who has met a
 * spreadsheet already knows what the bar means.
 *
 * ==> "EVERYTHING ON THE LIST" MEANS THE FILTERED LIST, WHICH IS ALSO THE
 * SPREADSHEET'S RULE. <== Under Majors it ticks the majors. A master box that
 * reached past the filter would put storms on the globe that the roster is not
 * showing — the panel and the map disagreeing, which is the failure this whole
 * view is careful about.
 *
 * ==> AND WITH §57.21a's SPLIT THIS IS THE CHEAP CASE. <== Ticking all of 2005
 * is 28 tracks with no dots and no dimming. It was the expensive case under the
 * old coupling, where the last storm ticked would have ghosted the other 27.
 *
 * The indeterminate state cannot be expressed in markup — it is a property, not
 * an attribute — so the view sets it after every render. `aria-checked="mixed"`
 * is what carries it to a screen reader, and it is written here because the
 * markup knows the count.
 *
 * @param {number} shown   rows currently on the list
 * @param {number} on      how many of them are ticked
 */
export function checkAllHtml({ shown, on }) {
  const all = shown > 0 && on === shown;
  const some = on > 0 && on < shown;
  const label = shown === 1 ? 'The one storm shown' : `All ${shown} storms shown`;
  return `
      <label class="seasons-check seasons-check-all">
        <input type="checkbox" data-check-all ${all ? 'checked' : ''}
               aria-checked="${some ? 'mixed' : String(all)}"
               aria-label="${esc(label)}">
        <span class="check-box" aria-hidden="true"></span>
        <span class="seasons-name">${esc(label)}</span>
      </label>`;
}

/**
 * The whole roster block — the list, or the reason there is no list.
 *
 * ==> IT MOVED HERE WHEN §12'S CEILING WAS CROSSED A SECOND TIME, AND IT IS
 * THE SAME CUT `liveDownHtml` TOOK. <== Step 6b's footprint slot carried
 * `ui/view-seasons-board.js` to 705 lines. This was the piece that had least
 * business being there: assembling a roster is markup work, and every decision
 * in it was already being made by the view and passed down. Nothing about the
 * behaviour moved with it.
 *
 * TOLD, NOT READING. `ghosts` arrives as the roster or as `null` — the view
 * decides that a narrowed list gets no whole-season ghost line, because
 * "eighteen names are still unused" is a claim about the season and printing
 * it under a Majors list would put an unfiltered fact at the foot of a
 * filtered one (§57.18a). This file never learns what the filter is.
 *
 * @param {object} opts
 * @param {string} opts.state       'loading' | 'unavailable' | 'ok'
 * @param {string} opts.reason      why the season could not be read
 * @param {number} opts.year
 * @param {boolean} opts.provisional  is this the season still running
 * @param {Array<{storm:object,facts:object}>} opts.rows  already filtered
 * @param {boolean} opts.anyEntries   did the season have storms BEFORE the
 *   filter — an empty list means two different things and this is which
 * @param {Set<string>} opts.ticked
 * @param {object|null} opts.ghosts   the unused-name roster, or null
 */
export function seasonRosterHtml({
  state, reason, year, provisional, rows, anyEntries, ticked, ghosts,
  activeIds = EMPTY_SET, home = null, system = null, filter = null, radiusWords = '',
}) {
  if (state === 'loading') {
    return waitingHtml(provisional ? 'Reading this season…' : 'Reading the record…');
  }
  if (state === 'unavailable') return seasonFailedHtml({ year, reason });

  if (!rows.length) {
    return `
        ${emptyRosterHtml({ year, filtered: anyEntries, provisional, filter, radiusWords })}
        ${ghostsHtml(ghosts)}`;
  }

  const list = rows
    .map((e) => rowHtml({
      storm: e.storm,
      facts: e.facts,
      on: ticked.has(e.storm.id),
      active: activeIds.has(e.storm.id),
      /* ==> PRESENT ON EXACTLY THE ROWS `entriesNearHome` PRODUCED, AND ABSENT
       * EVERYWHERE ELSE. <== The measurement rides on the entry rather than
       * being recomputed here, so the caption cannot disagree with the filter
       * that let the row through — and under the other three filters there is
       * no `near` on the entry at all, so the line simply is not drawn. One
       * source of truth per row, and no second measurement to drift. */
      near: e.near || null,
      home,
      system,
    }))
    .join('');

  /* ==> THE MASTER BOX SPEAKS FOR THE ROWS THAT CAN ACTUALLY BE DRAWN. <==
   * §57.21c. A running storm's box is disabled, so counting it in the total
   * would make a fully-ticked list read as partial forever — the bar would
   * never fill, and pressing the box would never show a tick. That is a control
   * whose state is unreachable, which is worse than one that is simply wrong. */
  const drawable = rows.filter((e) => !activeIds.has(e.storm.id));

  /* ==> THE MASTER BOX SITS ABOVE THE LIST, NOT INSIDE IT. <== It is not a
   * storm, and a `<li>` in a roster of storms is what a screen reader would
   * call it. It also has to survive being counted: `rows.length` is the
   * FILTERED list and `ticked` is the whole season, so the tally below counts
   * the intersection rather than the set. Ticking three majors and switching
   * to All must not show a full box. */
  const on = drawable.reduce((n, e) => n + (ticked.has(e.storm.id) ? 1 : 0), 0);

  /* ==> `Show all evenly` USED TO SIT HERE AND IS GONE. <== It existed to undo
   * the coupling where ticking a storm also selected it, and that coupling was
   * removed on 2026-08-25 (see `ui/view-seasons-board.js`). Selecting is now a
   * deliberate act with its own two ways out — a tap on open water, and Enter
   * on the open storm's row — so a third control undoing something the reader
   * did on purpose is one control too many. */
  return `
      ${footprintSlotHtml()}
      ${checkAllHtml({ shown: drawable.length, on })}
      <ul class="seasons-roster">${list}</ul>
      ${ghostsHtml(ghosts)}`;
}

/* ---------------------------------------------------------------------------
 * WAITING AND FAILING
 * ------------------------------------------------------------------------- */
