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
import { dotted } from './loading-dots.js';

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
const FILTER_ALL = Object.freeze({ id: 'all', label: 'All' });
const FILTER_MAJORS = Object.freeze({ id: 'majors', label: 'Majors' });
const FILTER_LANDFALLS = Object.freeze({ id: 'landfalls', label: 'Landfalls' });

export function filtersFor(provisional) {
  return provisional
    ? [FILTER_ALL, FILTER_MAJORS]
    : [FILTER_ALL, FILTER_MAJORS, FILTER_LANDFALLS];
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
export function entriesMatching(entries, filter) {
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

export function dateRange(facts) {
  if (!Number.isFinite(facts?.firstTime)) return '';
  const a = MD.format(new Date(facts.firstTime));
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

/**
 * Basin segments, a native year `<select>`, and two step buttons.
 *
 * A native `<select>` for 175 years is a considered choice rather than a
 * shrug. It is one control that already works by thumb, by mouse and by
 * keyboard, it gets the OS's own scroll-and-type behaviour free, and on a
 * phone it opens the platform picker — which beats anything a list of 175 rows
 * in a 60vh sheet could do. §57.29's Wall of Years is the richer alternative
 * and is explicitly last, and only if this proves to be the weak link.
 *
 * ==> THE SEASON IN PROGRESS SAYS SO IN THE OPTION ITSELF. <== It sits at the
 * top because the list runs newest first and it IS the newest, but a bare
 * `2026` beside `2025` would read as one more settled year in a file NOAA has
 * reviewed. It has not. The words are on the option because that is the moment
 * the reader chooses it, rather than only in a note they meet afterwards.
 */
export function pickerHtml({ basins, labelFor, basin, years, year, liveYear }) {
  const i = years.indexOf(year);

  const basinSegs = basins.map((b) => `
      <button class="seg" type="button" role="radio" data-basin="${esc(b)}"
              aria-checked="${String(b === basin)}">
        ${esc(labelFor(b))}
      </button>`).join('');

  const options = years.map((y) => `
      <option value="${y}" ${y === year ? 'selected' : ''}>${y}${
  y === liveYear ? ' — this season' : ''}</option>`).join('');

  /* Older is DOWN the list, so "previous year" is the next index along.
   * Disabled at the ends rather than hidden — a control that vanishes reads
   * as a bug (§7). */
  const older = years[i + 1];
  const newer = years[i - 1];

  return `
      <div class="seasons-picker">
        <div class="seg-group" role="radiogroup" aria-label="Basin">${basinSegs}</div>
        <div class="seasons-year">
          <button class="seasons-step" type="button" data-step="older"
                  aria-label="Previous season"
                  ${older == null ? 'disabled aria-disabled="true"' : ''}>−</button>
          <select class="seasons-select" aria-label="Season">${options}</select>
          <button class="seasons-step" type="button" data-step="newer"
                  aria-label="Next season"
                  ${newer == null ? 'disabled aria-disabled="true"' : ''}>+</button>
        </div>
      </div>`;
}

/* ---------------------------------------------------------------------------
 * THE SCORECARD
 * ------------------------------------------------------------------------- */

/**
 * Six numbers and the sentences that stop them being read as more than they
 * are.
 *
 * @param {object} opts
 * @param {object|null} opts.score        from `seasonFacts`
 * @param {object|null} opts.roster       from `rosterFor`, or null
 * @param {boolean} opts.provisional      the season in progress
 * @param {boolean} opts.stale            the live index came from a stored copy
 * @param {number} opts.unreadable        storms whose track would not load
 */
export function scoreHtml({ score, roster, provisional, stale, unreadable }) {
  if (!score) return '';

  /* ==> A LANDFALL FIGURE THE RECORD CANNOT SUPPORT IS A DASH, NEVER A ZERO.
   * <== §5, and this is the sharpest case of it in the feature: the app is
   * called Landfall, and `0` on that cell reads as "nothing reached land this
   * year" rather than "nobody has marked them yet". Both are six characters on
   * a phone and only one of them is true. The line under the grid is what
   * turns the dash from a hole into an answer. */
  const cells = [
    ['Storms', score.storms],
    ['Named', score.named],
    ['Hurricanes', score.hurricanes],
    ['Majors', score.majors],
    ['ACE', Number.isFinite(score.ace) ? score.ace.toFixed(1) : '—'],
    ['Landfalls', provisional ? '—' : score.landfalls],
  ].map(([k, v]) => `
      <div class="seasons-stat">
        <span class="seasons-stat-n">${esc(v)}</span>
        <span class="seasons-stat-k">${esc(k)}</span>
      </div>`).join('');

  /* ==> THE UNDERCOUNT LINE IS NOT A FOOTNOTE. <== Before the satellite era
   * nobody saw the storms that stayed at sea, so a quiet-looking 1935 is not
   * evidence of a quiet season. Printing six confident numbers with nothing
   * beside them would be the app making a claim the record cannot support. */
  const note = score.undercountLikely
    ? `<p class="seasons-note">Before ${SEASONS.satelliteEraFrom}, storms that stayed out
         at sea were often never seen. These counts are a floor, not a total.</p>`
    : '';

  /* §57.11 — the app must be able to say WHICH record it is showing, and this
   * is where it says it. Two facts, deliberately in one sentence: the numbers
   * will change, and the season is not over, so they are a running total
   * rather than a result. */
  const prov = provisional
    ? `<p class="seasons-note">These are working numbers for a season still
         running. NOAA reviews them and publishes the settled record the
         following spring — positions and strengths will move. Landfall marks
         come with that reviewed record.</p>`
    : '';

  /* Stale, and said rather than hidden. A stored copy is still a correct list
   * of the storms it knew about; what it cannot promise is that nothing has
   * formed since. §5 — stale plus a timestamp beats a blank screen, and beats
   * a fresh-looking screen that is neither. */
  const old = stale
    ? `<p class="seasons-note">This list came from a stored copy — a storm that
         formed in the last few hours may not be on it yet.</p>`
    : '';

  /* ==> STORMS THAT FAILED TO LOAD ARE COUNTED OUT LOUD. <== The season index
   * says fifteen and the globe has twelve: without this the reader is looking
   * at a season that is quietly three storms short and reads as complete.
   *
   * ==> AND THE SECOND HALF OF THAT SENTENCE IS NOT A FLOURISH. <== A storm's
   * NAME is inside the file that would not load, so a season short one storm
   * is also a season whose roster believes that name was never spent — the
   * missing storm turns up in the unused list below. Nothing can fix that
   * (the index carries ids, not names), so it is disclosed. Left unsaid, the
   * ghost list would be quietly wrong on exactly the day something is already
   * wrong, which is the worst moment to be silently misleading. */
  const alsoGhosts = roster?.ghosts?.length
    ? ` ${unreadable === 1 ? 'Its name' : 'Their names'} may show as unused below.`
    : '';
  const short = unreadable > 0
    ? `<p class="seasons-note seasons-bad">${unreadable}
         ${unreadable === 1 ? 'storm could' : 'storms could'} not be read, so
         ${unreadable === 1 ? 'it is' : 'they are'} missing from this list and
         from these numbers.${alsoGhosts}</p>`
    : '';

  /* Names all spent — the loudest thing a season can say about its own shape,
   * and for a settled year it is the whole of what ghosts would have said. */
  const spent = roster?.reachedEnd
    ? '<p class="seasons-note">Every name on the list was used.</p>'
    : '';

  return `<div class="seasons-score">${cells}</div>${note}${prov}${old}${short}${spent}`;
}

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
export function rowHtml({ storm, facts, on }) {
  const color = categoryColor(facts.peakCategory ?? null, 'tropical', null);
  const strength = categoryShortLabel(facts.peakCategory ?? null, 'tropical', null);

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
      <li class="seasons-row" data-row="${esc(storm.id)}">
        <label class="seasons-check">
          <input type="checkbox" data-storm="${esc(storm.id)}" ${on ? 'checked' : ''}
                 aria-label="Draw ${esc(displayName(storm))} on the globe">
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
              <span class="seasons-when">${esc(dateRange(facts))}</span>
            </span>
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
 * The current season could not be reached.
 *
 * ==> IT IS SAID ON EVERY SETTLED YEAR, NOT ONLY WHERE 2026 WOULD HAVE SAT.
 * <== There is no row to hang it on: the year is simply absent from the
 * picker, and an absent option explains nothing. A reader who came to see
 * what is happening now needs to know the road is down rather than conclude
 * the archive stops at last year.
 *
 * ==> MOVED HERE FROM THE VIEW WHEN THAT FILE CROSSED §12'S 700-LINE CEILING.
 * <== It was always a markup function living outside the markup file, and it
 * is TOLD what to draw rather than reading state, the same as everything else
 * in here — `null` and flags in, a string out. Nothing about the behaviour
 * moved with it.
 *
 * @param {object} opts
 * @param {boolean} opts.hasLive  does this basin have a season in progress at
 *   all? A basin with none has nothing to say, which is honest silence rather
 *   than an error (§5)
 * @param {boolean} opts.retrying a second attempt is in the air
 * @param {string} opts.reason    why it could not be reached; empty when it was
 */
export function liveDownHtml({ hasLive, retrying, reason }) {
  if (!hasLive) return '';
  if (retrying) return waitingHtml('Looking for the season still running…');
  if (!reason) return '';
  /* ==> AND IT GETS A BUTTON, BECAUSE THIS ONE CAN ACTUALLY SUCCEED. <== §5
   * asks every error state for a recovery action, and the distinction the
   * rest of this board draws is whether pressing it could ever work: a year
   * the archive does not hold gets no Retry, a road that was down for a
   * moment does. `data/seasons-live.js` drops a failed fetch out of its own
   * map, so this is a real second attempt rather than a replay. */
  return `<p class="seasons-note seasons-bad">The season still running could not
      be reached, so it is not in the list above. The settled years are all here.</p>
      <button class="seasons-retry" type="button" data-retry="live">Try again</button>`;
}

/**
 * The empty slot the footprint note is written into. §57.26a.
 *
 * ==> ALWAYS IN THE MARKUP, EMPTY MOST OF THE TIME, FOR THE SAME REASON
 * `showAllHtml` IS. <== Its content depends on which storm is focused, and
 * focus moves on every tap on a track. Rebuilding the roster to say one
 * sentence would cost the reader their scroll position and their focus ring on
 * the feature's most frequent interaction — so the view patches this one
 * element instead, exactly as it patches the row classes.
 *
 * `role="status"` because it appears in response to the reader's own action
 * and a screen reader should hear it without being moved there. It is polite
 * by default, so it waits its turn rather than interrupting.
 */
export function footprintSlotHtml() {
  return `<div class="seasons-footprint" role="status"></div>`;
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
}) {
  if (state === 'loading') {
    return waitingHtml(provisional ? 'Reading this season…' : 'Reading the record…');
  }
  if (state === 'unavailable') return seasonFailedHtml({ year, reason });

  if (!rows.length) {
    return `
        ${emptyRosterHtml({ year, filtered: anyEntries, provisional })}
        ${ghostsHtml(ghosts)}`;
  }

  const list = rows
    .map((e) => rowHtml({ storm: e.storm, facts: e.facts, on: ticked.has(e.storm.id) }))
    .join('');

  /* ==> THE MASTER BOX SITS ABOVE THE LIST, NOT INSIDE IT. <== It is not a
   * storm, and a `<li>` in a roster of storms is what a screen reader would
   * call it. It also has to survive being counted: `rows.length` is the
   * FILTERED list and `ticked` is the whole season, so the tally below counts
   * the intersection rather than the set. Ticking three majors and switching
   * to All must not show a full box. */
  const on = rows.reduce((n, e) => n + (ticked.has(e.storm.id) ? 1 : 0), 0);

  /* ==> `Show all evenly` USED TO SIT HERE AND IS GONE. <== It existed to undo
   * the coupling where ticking a storm also selected it, and that coupling was
   * removed on 2026-08-25 (see `ui/view-seasons-board.js`). Selecting is now a
   * deliberate act with its own two ways out — a tap on open water, and Enter
   * on the open storm's row — so a third control undoing something the reader
   * did on purpose is one control too many. */
  return `
      ${footprintSlotHtml()}
      ${checkAllHtml({ shown: rows.length, on })}
      <ul class="seasons-roster">${list}</ul>
      ${ghostsHtml(ghosts)}`;
}

/**
 * Why the focused storm has no wind footprint. §57.25 rule 2, §57.26a.
 *
 * ==> THE SENTENCE IS THE WHOLE POINT OF STEP 6b, NOT A CAPTION ON IT. <==
 * Three quarters of the archive has no wind field — measured, 826 storms of
 * 3,266 — so for most of what a reader opens, this line IS the feature. §57.25
 * asks it to teach something true about the record rather than read as a
 * missing button, and that is the thing to judge on glass.
 *
 * ==> TWO WORDINGS, AND THE SECOND ONE EXISTS SO THE FIRST CANNOT LIE. <== The
 * era sentence is only said for a storm from before the first season that
 * records a wind field. A 2004-or-later storm with nothing to draw gets a
 * plain statement instead, because "wasn't recorded before 2004" would be a
 * claim about the record that this storm is the counter-example to. Every
 * settled season measures 100% coverage from 2004 on, so in practice the
 * second wording is for the season still running, whose b-decks are a
 * different source — which is exactly the case worth not guessing about.
 *
 * ==> AND IT IS SILENT WHEN THERE IS A FOOTPRINT. <== §57.25's rule is that an
 * absence which is information gets said; a presence speaks for itself, and
 * the shape is on the globe. A line reading "this storm has a wind footprint"
 * next to a wind footprint is furniture.
 *
 * ==> IT NAMES THE STORM THROUGH `displayName`, THE SAME ROUTE `rowHtml`
 * TAKES. <== §57.14 gives an unnamed storm a display form, and a sentence
 * calling it something the row beside it does not is the panel disagreeing
 * with itself.
 *
 * @param {object|null} opts  `{ storm, facts }` for the FOCUSED storm, or null
 * @returns {string} markup, or '' when nothing needs saying
 */
export function footprintNoteHtml(entry) {
  const { storm, facts } = entry || {};
  if (!storm || !facts) return '';
  if (!facts.missing?.windField) return '';

  const era = Number.isFinite(facts.year) && facts.year < SEASONS.windFieldFirstSeason;
  const why = era
    ? `Wind field size wasn't recorded before ${SEASONS.windFieldFirstSeason}`
    : 'No wind field was recorded for this storm';

  /* The two wordings are literals in this file and the year is a number out
   * of a frozen constants block, so only the NAME goes through `esc` — it is
   * the one value here that came out of a data file. Escaping the sentence as
   * well turned its apostrophe into an entity for no gain. */
  return `<p class="seasons-note">${why}, so there is no wind
      footprint for ${esc(displayName(storm))}.</p>`;
}

/**
 * The unused names, for the season still running.
 *
 * ==> AND THE OFF-LIST CASE IS SAID OUT LOUD RATHER THAN SWALLOWED. <== A
 * storm carrying a name that is not on the roster means either the season ran
 * past its list onto the WMO supplemental one — real, and what replaced the
 * Greek alphabet in 2021 — or the list in this repo is wrong. Both need a
 * reader to know, and a roster that quietly hid the second would look perfect
 * while lying (§5).
 */
export function ghostsHtml(roster) {
  if (!roster) return '';

  const off = roster.offList.length
    ? `<p class="seasons-note">${esc(roster.offList.join(', '))} ${
      roster.offList.length === 1 ? 'is' : 'are'} not on this year's list —
        the season has gone past it, or the list here is out of date.</p>`
    : '';

  if (!roster.ghosts.length) return off;

  const rows = roster.ghosts.map((n) => `
      <li class="seasons-row seasons-row-ghost">
        <span class="seasons-ghost-name">${esc(n)}</span>
      </li>`).join('');

  return `
      ${off}
      <p class="seasons-note" id="seasons-ghosts-note">${roster.ghosts.length}
        ${roster.ghosts.length === 1 ? 'name is' : 'names are'} still unused this season.</p>
      <ul class="seasons-roster" aria-labelledby="seasons-ghosts-note">${rows}</ul>`;
}

/* ---------------------------------------------------------------------------
 * WAITING AND FAILING
 * ------------------------------------------------------------------------- */

/** ==> THE TRAILING ELLIPSIS HAS TO MOVE. <== `ui/loading-dots.js`: a static
 *  `…` on glass is indistinguishable from a sentence that has finished and
 *  trailed off, so a reader cannot tell a live fetch from a screen that has
 *  quietly given up. Every waiting sentence in this app goes through the same
 *  helper, and `tools/test-loading-dots.mjs` is what caught this one sitting
 *  outside it. */
export function waitingHtml(sentence) {
  return `<p class="seasons-note" role="status">${dotted(sentence)}</p>`;
}

/**
 * A season that could not be loaded.
 *
 * Two different failures, two different sentences. A year the index does not
 * carry is not a network problem and offering Retry for it would be a button
 * that can never work.
 */
export function seasonFailedHtml({ year, reason }) {
  const missing = reason === 'not_in_index';
  return `
        <p class="seasons-note seasons-bad" role="status">
          ${missing
    ? `The archive does not hold ${esc(year)} for this basin.`
    : 'That season could not be loaded. It may be a connection problem.'}
        </p>
        ${missing ? '' : '<button class="seasons-retry" type="button">Try again</button>'}`;
}

/**
 * ==> AN EMPTY ROSTER IS A REAL ANSWER, AND IT HAS THREE CAUSES. <== The
 * record says the year was quiet (the Atlantic recorded two storms in 1914);
 * the reader's own filter matched nothing; or the season in progress has not
 * had a storm yet, which in January is simply true. Three different facts, and
 * a reader who cannot tell them apart will think the archive is broken.
 */
export function emptyRosterHtml({ year, filtered, provisional }) {
  if (filtered) return `<p class="seasons-note">No storms in ${esc(year)} match that filter.</p>`;
  return provisional
    ? `<p class="seasons-note">No storms have formed yet in ${esc(year)} in this basin.</p>`
    : `<p class="seasons-note">The record has no storms for ${esc(year)} in this basin.</p>`;
}

/** The index itself failed, so there are no years to choose between. */
export function indexFailedHtml() {
  return `
        <p class="seasons-note seasons-bad" role="status">
          The archive index could not be loaded, so there are no years to choose from.
        </p>
        <button class="seasons-retry" type="button">Try again</button>`;
}
