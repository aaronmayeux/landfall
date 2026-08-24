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

/** How a storm is called on a row. §57.14: an unnamed storm displays as its
 *  number, never as a blank and never as the spelled-out number NOAA wrote in
 *  the name column (`lib/hurdat.js` folds those into unnamed). */
export function displayName(storm) {
  return storm?.name || `Storm ${storm?.number ?? '?'}`;
}

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
 * One storm. The checkbox's dot is BOTH the tick and the category, so peak
 * strength reads down the list whether or not a storm is on the globe, in one
 * column rather than two. The whole row is the label, so the target is the row.
 */
export function rowHtml({ storm, facts, on }) {
  const color = categoryColor(facts.peakCategory ?? null, 'tropical', null);
  const strength = categoryShortLabel(facts.peakCategory ?? null, 'tropical', null);

  /* The landfall mark. §57.21 calls these the most confident thing on the
   * archive globe and the reason the app is called Landfall — so the roster
   * names it in words for a screen reader rather than leaving a glyph to
   * carry meaning on its own (§13). A provisional season simply has none,
   * which is the absence `scoreHtml` explains rather than one to explain
   * again on every row. */
  const lf = facts.landfalls.length
    ? '<span class="seasons-lf" aria-hidden="true">▲</span>'
    : '';
  const lfLabel = facts.landfalls.length
    ? `, made ${facts.landfalls.length === 1 ? 'landfall' : `${facts.landfalls.length} landfalls`}`
    : '';

  return `
      <li class="seasons-row">
        <label class="seasons-check">
          <input type="checkbox" data-storm="${esc(storm.id)}" ${on ? 'checked' : ''}
                 aria-label="${esc(displayName(storm))}, ${esc(strength)}${lfLabel}">
          <span class="seasons-dot" style="--swatch: ${esc(color)}" aria-hidden="true"></span>
          <span class="seasons-name">${esc(displayName(storm))}</span>
          <span class="seasons-when">${esc(dateRange(facts))}</span>
          ${lf}
        </label>
      </li>`;
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
