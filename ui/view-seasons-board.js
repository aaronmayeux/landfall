/**
 * view-seasons-board.js — the season board. §57.18, §57.19, §57.30 step 5.
 *
 * ==> IT IS A VIEW INSIDE THE ONE DRAWER, NOT A SECOND PANEL. <== §16 says
 * there is exactly one panel element on screen and everything else is a view
 * inside it. Building the archive its own sheet would have meant a second
 * focus trap, a second scroll container, a second set of sheet-or-rail
 * breakpoints and a second Escape rule — four chances to drift out of step
 * with the panel every other screen in this app uses. It registers late,
 * from `seasons/index.js`, so nothing about it is on the boot path.
 *
 * ==> THE ROSTER IS CHRONOLOGICAL, AND THE ORDER IS THE POINT. <== §57.18.
 * Names are handed out in order, so the list a season used IS the order it
 * happened in, and how far down the alphabet the names reach is how far the
 * season got. Nobody should ever "tidy" this by sorting it by strength.
 *
 * ==> GHOSTS ARE THE CURRENT YEAR ONLY, AND THEIR ABSENCE IS SILENT. <==
 * Aaron's call, 2026-08-24, reaffirmed when the rosters stopped being typed by
 * hand. `lib/season-names-data.js` now carries six years ahead and accumulates
 * past ones, so the rule is enforced by the year this view hands to
 * `rosterFor` — not by the data being thin. A settled year has no ghost rows
 * and says nothing about names remaining. That is the honest shape: for a
 * finished season the names it used already answer "how far did it get", and
 * 2005 running past its list says it louder than blank rows would.
 *
 * ==> A SEASON WITH NO STORMS AND A SEASON WE COULD NOT REACH GET DIFFERENT
 * SENTENCES. <== §5, and it is the whole reason this view has three states
 * rather than an empty list. The Atlantic genuinely recorded two storms in
 * 1914; NOAA's file being unreachable is a different fact, and an archive that
 * drew both as a blank roster would be telling a reader a quiet year happened
 * when the truth is we do not know.
 *
 * WHAT IS NOT HERE, ON PURPOSE: landfall marks, name labels along the tracks,
 * focus-and-dim and the wind field are step 6; the detail panel is step 7; the
 * near-home slider is step 9 and is why §57.19's fourth filter is absent from
 * the three below rather than present and dead.
 *
 * Imports config/, lib/ and its own siblings. Never data/ or map/ — the fetch
 * and the globe both arrive as injected facades (§12).
 */

import { SEASONS } from '../config/constants.js';
import { categoryColor, categoryShortLabel } from '../lib/category.js';
import { stormFacts, seasonFacts } from '../lib/season-facts.js';
import { rosterFor } from '../lib/season-names.js';
import { dotted } from './loading-dots.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * The three filters. §57.19 drops "None" — it was a button that did nothing
 * useful — and holds "Near home" back to step 9, which owns the radius slider
 * and the precomputed distances it filters on.
 */
const FILTERS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'majors', label: 'Majors' },
  { id: 'landfalls', label: 'Landfalls' },
]);

/** Month and day, no year — the year is the whole screen's subject and
 *  repeating it on thirty rows is noise. UTC because the records are. */
const MD = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', timeZone: 'UTC',
});

function dateRange(facts) {
  if (!Number.isFinite(facts?.firstTime)) return '';
  const a = MD.format(new Date(facts.firstTime));
  const b = MD.format(new Date(facts.lastTime));
  return a === b ? a : `${a} – ${b}`;
}

/** How a storm is called on a row. §57.14: an unnamed storm displays as its
 *  number, never as a blank and never as the spelled-out number NOAA wrote in
 *  the name column (`lib/hurdat.js` folds those into unnamed). */
function displayName(storm) {
  return storm?.name || `Storm ${storm?.number ?? '?'}`;
}

/**
 * @param {object} opts
 * @param {object} opts.seasons  injected fetch facade — `loadIndex`,
 *   `loadSeason`, `seasonsIn`, `basinsIn`, `basinLabel`. `ui/` never imports
 *   `data/` (§12), the same shape every other panel in this app takes.
 * @param {(selected:Array<{storm:object,facts:object}>) => void} opts.onSelection
 *   ticked storms changed — the globe redraws from the whole set.
 * @param {(where:{basin:string,year:number,label:string}|null) => void} opts.onWhere
 *   the bar's sentence. Called whenever the year or basin settles.
 */
export function createSeasonsBoardView({ seasons, onSelection, onWhere }) {
  let host = null;
  let bodyEl = null;

  /* --- state ---------------------------------------------------------------
   * All of it is this view's own. Nothing here is read by anybody else, and
   * the globe learns about changes through `onSelection` rather than by
   * reaching in.
   * ---------------------------------------------------------------------- */

  /** `loading` | `ok` | `unavailable` — the index, not a season. */
  let indexState = 'loading';
  let index = null;
  let indexReason = '';

  let basin = null;
  let year = null;

  /** `loading` | `ok` | `unavailable`, for the season currently chosen. */
  let seasonState = 'loading';
  let seasonReason = '';
  /** `[{ storm, facts }]`, chronological, as parsed. */
  let entries = [];
  let score = null;
  let roster = null;

  let filter = 'all';
  /** Storm ids the reader has ticked. Survives a filter change on purpose —
   *  switching to Majors and back must not silently wipe the globe. */
  const ticked = new Set();

  /** Bumped on every season load, so a slow fetch that lands after the reader
   *  has moved on cannot paint the wrong year over the right one. */
  let loadToken = 0;

  /* --- selection ---------------------------------------------------------- */

  function selectedEntries() {
    return entries.filter((e) => ticked.has(e.storm.id));
  }

  function pushSelection() {
    onSelection?.(selectedEntries());
  }

  /* --- loading ------------------------------------------------------------ */

  async function loadIndexOnce() {
    const res = await seasons.loadIndex();
    if (res.status !== 'ok') {
      indexState = 'unavailable';
      indexReason = res.reason || '';
      render();
      return;
    }
    index = res.index;
    indexState = 'ok';

    /* Default to the newest year of the first basin the index lists. The
     * newest is the one a reader is most likely to want and the only one they
     * can compare against their own memory. */
    const first = seasons.basinsIn(index)[0] || null;
    if (basin == null) basin = first;

    /* ==> A REQUESTED YEAR THE ARCHIVE DOES NOT HOLD IS DROPPED, NOT DRAWN.
     * <== `setSeason` may have been handed a year before this ran. It is a
     * number the link parser accepted, which is not the same as a season this
     * basin has — the Pacific record only opens in 1949, so `?season=1900`
     * is a real Atlantic year with no Pacific half. Falling back to the newest
     * is right; silently loading a file that is not there would spend the
     * reader's one attempt on a 404. */
    const years = seasons.seasonsIn(index, basin);
    if (year == null || !years.includes(year)) year = years[0] ?? null;

    render();
    loadSeasonNow();
  }

  async function loadSeasonNow() {
    if (indexState !== 'ok' || basin == null || year == null) return;

    const token = ++loadToken;
    seasonState = 'loading';
    entries = [];
    score = null;
    roster = null;
    /* The globe empties the moment the year changes, before the new one
     * arrives. Leaving 2005's tracks up while 1935 loads would put a year on
     * the bar that the globe is not showing. */
    ticked.clear();
    pushSelection();
    announceWhere();
    render();

    const res = await seasons.loadSeason(index, basin, year);
    if (token !== loadToken) return; /* the reader moved on */

    if (res.status !== 'ok') {
      seasonState = 'unavailable';
      seasonReason = res.reason || '';
      render();
      return;
    }

    entries = res.storms.map((storm) => ({ storm, facts: stormFacts(storm) }))
      .filter((e) => e.facts);
    score = seasonFacts(res.storms, { year, basin });
    /* ==> THE FOURTH ARGUMENT IS THE GHOSTS-ARE-THIS-SEASON-ONLY RULE, AND IT
     * IS READ HERE RATHER THAN INSIDE THE MODULE. <== `lib/season-names.js` is
     * clock-free by design so the suite can pin any year it likes; the clock
     * belongs at the edge, which is here. UTC because every date in this app is
     * UTC, and calendar year is the right question: NHC names an off-season
     * storm from the list for the calendar year it forms in. */
    roster = rosterFor(
      basin, year,
      entries.map((e) => e.storm.name).filter(Boolean),
      new Date().getUTCFullYear()
    );
    seasonState = 'ok';
    render();
  }

  function announceWhere() {
    onWhere?.(
      indexState === 'ok' && basin && year
        ? { basin, year, label: `${year} · ${seasons.basinLabel(index, basin)}` }
        : null
    );
  }

  /* --- markup -------------------------------------------------------------
   * Rebuilt wholesale on state change, like the Layers view: the shape is
   * small and static and one render path cannot drift from a patch path. The
   * SCROLLER is built once and never replaced, which is what stops the panel
   * snapping to the top every time a checkbox moves.
   * ---------------------------------------------------------------------- */

  function pickerHtml() {
    const basins = seasons.basinsIn(index);
    const years = seasons.seasonsIn(index, basin);
    const i = years.indexOf(year);

    const basinSegs = basins.map((b) => `
      <button class="seg" type="button" role="radio" data-basin="${esc(b)}"
              aria-checked="${String(b === basin)}">
        ${esc(seasons.basinLabel(index, b))}
      </button>`).join('');

    /* A native <select> for 175 years, and that is a considered choice rather
     * than a shrug. It is one control that already works by thumb, by mouse
     * and by keyboard, it gets the OS's own scroll-and-type behaviour free,
     * and on a phone it opens the platform picker — which beats anything a
     * list of 175 rows in a 60vh sheet could do. §57.29's Wall of Years is the
     * richer alternative and is explicitly last, and only if this proves to be
     * the weak link. */
    const options = years.map((y) => `
      <option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('');

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

  function scoreHtml() {
    if (!score) return '';

    const cells = [
      ['Storms', score.storms],
      ['Named', score.named],
      ['Hurricanes', score.hurricanes],
      ['Majors', score.majors],
      ['ACE', Number.isFinite(score.ace) ? score.ace.toFixed(1) : '—'],
      ['Landfalls', score.landfalls],
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

    /* Names all spent — the loudest thing a season can say about its own shape,
     * and for a settled year it is the whole of what ghosts would have said. */
    const spent = roster?.reachedEnd
      ? `<p class="seasons-note">Every name on the list was used.</p>`
      : '';

    return `<div class="seasons-score">${cells}</div>${note}${spent}`;
  }

  function filtersHtml() {
    const segs = FILTERS.map((f) => `
      <button class="seg" type="button" role="radio" data-filter="${esc(f.id)}"
              aria-checked="${String(f.id === filter)}">${esc(f.label)}</button>`).join('');
    return `<div class="seg-group" role="radiogroup" aria-label="Filter">${segs}</div>`;
  }

  function visibleEntries() {
    if (filter === 'majors') {
      return entries.filter((e) => Number.isFinite(e.facts.peakWindKt)
        && e.facts.peakWindKt >= SEASONS.majorKt);
    }
    if (filter === 'landfalls') return entries.filter((e) => e.facts.landfalls.length > 0);
    return entries;
  }

  function rowHtml(entry) {
    const { storm, facts } = entry;
    const color = categoryColor(facts.peakCategory ?? null, 'tropical', null);
    const strength = categoryShortLabel(facts.peakCategory ?? null, 'tropical', null);
    const on = ticked.has(storm.id);

    /* The landfall mark. §57.21 calls these the most confident thing on the
     * archive globe and the reason the app is called Landfall — so the roster
     * names it in words for a screen reader rather than leaving a glyph to
     * carry meaning on its own (§13). */
    const lf = facts.landfalls.length
      ? `<span class="seasons-lf" aria-hidden="true">▲</span>`
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
   * storm carrying a name that is not on the roster means either the season
   * ran past its list onto the WMO supplemental one — real, and what replaced
   * the Greek alphabet in 2021 — or the list in this repo is wrong. Both need
   * a reader to know, and a roster that quietly hid the second would look
   * perfect while lying (§5).
   */
  function ghostsHtml() {
    if (!roster || filter !== 'all') return '';

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

  function rosterHtml() {
    if (seasonState === 'loading') {
      /* ==> THE TRAILING ELLIPSIS HAS TO MOVE. <== `ui/loading-dots.js`: a
       * static `…` on glass is indistinguishable from a sentence that has
       * finished and trailed off, so a reader cannot tell a live fetch from a
       * screen that has quietly given up. Every waiting sentence in this app
       * goes through the same helper, and `tools/test-loading-dots.mjs` is
       * what caught this one sitting outside it. */
      return `<p class="seasons-note" role="status">${dotted('Reading the record…')}</p>`;
    }

    if (seasonState === 'unavailable') {
      /* Two different failures, two different sentences. A year the index does
       * not carry is not a network problem and offering Retry for it would be
       * a button that can never work. */
      const missing = seasonReason === 'not_in_index';
      return `
        <p class="seasons-note seasons-bad" role="status">
          ${missing
            ? `The archive does not hold ${esc(year)} for this basin.`
            : `That season could not be loaded. It may be a connection problem.`}
        </p>
        ${missing ? '' : '<button class="seasons-retry" type="button">Try again</button>'}`;
    }

    const rows = visibleEntries();

    if (!rows.length) {
      /* ==> AN EMPTY ROSTER IS A REAL ANSWER HERE, AND IT HAS TWO CAUSES. <==
       * Either the record says the year was quiet — the Atlantic recorded two
       * storms in 1914 — or the reader's own filter matched nothing. They are
       * different facts and a reader who cannot tell them apart will think the
       * archive is broken. */
      const filtered = entries.length > 0;
      return `
        <p class="seasons-note">
          ${filtered
            ? `No storms in ${esc(year)} match that filter.`
            : `The record has no storms for ${esc(year)} in this basin.`}
        </p>
        ${ghostsHtml()}`;
    }

    return `
      <ul class="seasons-roster">${rows.map(rowHtml).join('')}</ul>
      ${ghostsHtml()}`;
  }

  function render() {
    if (!bodyEl) return;

    if (indexState === 'loading') {
      bodyEl.innerHTML =
        `<p class="seasons-note" role="status">${dotted('Opening the archive…')}</p>`;
      return;
    }

    if (indexState === 'unavailable') {
      bodyEl.innerHTML = `
        <p class="seasons-note seasons-bad" role="status">
          The archive index could not be loaded, so there are no years to choose from.
        </p>
        <button class="seasons-retry" type="button">Try again</button>`;
      return;
    }

    bodyEl.innerHTML = `
      ${pickerHtml()}
      ${scoreHtml()}
      ${filtersHtml()}
      ${rosterHtml()}`;
  }

  /* --- input --------------------------------------------------------------
   * ONE DELEGATED LISTENER PER EVENT TYPE, on the scroller, so a wholesale
   * re-render cannot leave a handler bound to a discarded node. Every control
   * below is a real <button>, <select> or <input>, so tap, click and keyboard
   * are the same path and none of this branches on device (§13).
   * ---------------------------------------------------------------------- */

  function onClick(e) {
    const basinBtn = e.target.closest('[data-basin]');
    if (basinBtn) {
      const next = basinBtn.dataset.basin;
      if (next === basin) return;
      basin = next;
      /* Hold the year across a basin change when the other basin has it. The
       * Pacific record opens in 1949, so 1900 has no Pacific half — falling
       * back to that basin's newest year is better than refusing the switch. */
      const years = seasons.seasonsIn(index, basin);
      if (!years.includes(year)) year = years[0] ?? null;
      loadSeasonNow();
      return;
    }

    const step = e.target.closest('[data-step]');
    if (step) {
      const years = seasons.seasonsIn(index, basin);
      const i = years.indexOf(year);
      const next = step.dataset.step === 'older' ? years[i + 1] : years[i - 1];
      if (next == null) return;
      year = next;
      loadSeasonNow();
      return;
    }

    const filterBtn = e.target.closest('[data-filter]');
    if (filterBtn) {
      if (filterBtn.dataset.filter === filter) return;
      filter = filterBtn.dataset.filter;
      /* The globe is NOT touched. A filter narrows what the roster shows; it
       * does not un-choose a storm the reader deliberately ticked, and a
       * ticked storm vanishing off the globe because a filter moved would be
       * the panel and the map disagreeing about what is selected. */
      render();
      return;
    }

    if (e.target.closest('.seasons-retry')) {
      if (indexState === 'unavailable') {
        indexState = 'loading';
        render();
        loadIndexOnce();
      } else {
        loadSeasonNow();
      }
    }
  }

  function onChange(e) {
    const select = e.target.closest('.seasons-select');
    if (select) {
      const next = Number(select.value);
      if (!Number.isFinite(next) || next === year) return;
      year = next;
      loadSeasonNow();
      return;
    }

    const box = e.target.closest('[data-storm]');
    if (box) {
      const id = box.dataset.storm;
      if (box.checked) ticked.add(id); else ticked.delete(id);
      /* No re-render. The checkbox has already drawn itself and rebuilding the
       * list under a thumb mid-tap is how a roster loses its scroll position
       * and its focus ring at once. */
      pushSelection();
    }
  }

  return {
    id: 'seasons-board',
    title: 'Past storms',

    mount(el) {
      host = el;
      host.innerHTML = '<div class="drawer-body" id="seasons-board-body"></div>';
      bodyEl = host.querySelector('#seasons-board-body');
      bodyEl.addEventListener('click', onClick);
      bodyEl.addEventListener('change', onChange);
      render();
      loadIndexOnce();
    },

    onEnter() {
      /* Re-announce on every entry. The reader may have closed the board and
       * come back, and the bar must still name the year the globe is showing. */
      announceWhere();
      render();
    },

    /** First stop is the year, because choosing a year is why anyone opens
     *  this. Not the Back button, and not the first storm. */
    focus() {
      return bodyEl?.querySelector('.seasons-select');
    },

    /**
     * Open on a particular year — a `?season=` link, and nothing else today.
     *
     * ==> IT IS ASKED FOR, NOT IMPOSED, AND THAT IS WHY IT TAKES EFFECT IN TWO
     * PLACES. <== Entry calls this BEFORE the index has arrived, so there is
     * no list of years yet to check the request against. The year is held and
     * `loadIndexOnce` honours it once it knows which years exist — and drops
     * it if the archive does not hold that one, rather than opening on a
     * season that is not there. `seasons/deep-link.js` has already proved the
     * year is a plausible number; only the index knows if it is a real season.
     */
    setSeason(y) {
      if (Number.isFinite(y)) year = y;
    },

    /** Leaving the archive entirely — drop the globe's tracks and forget the
     *  ticks, so a second visit does not open with a stale selection. */
    reset() {
      ticked.clear();
      pushSelection();
    },
  };
}
