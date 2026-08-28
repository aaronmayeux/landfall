/**
 * view-seasons-wall.js — the Wall of Years. Rung 2 of §57.39's ladder.
 * SPEC-SEASONS-BUILD.md §57.29, §57.36, §57.30 step 14.
 *
 * ==> IT IS THE ARCHIVE'S FRONT DOOR, NOT A SECOND WAY TO REACH A YEAR. <==
 * §57.36. Enter the archive, see the wall, tap a year, land on that season's
 * board. The board's own year dropdown goes with this, so there is exactly one
 * way into a year and it is this screen.
 *
 * ==> A VIEW INSIDE THE ONE DRAWER, LIKE EVERY OTHER SCREEN. <== §16, and the
 * same reasoning `ui/view-seasons-board.js` records: a second sheet would mean
 * a second focus trap, a second scroll container and a second Escape rule.
 * Registered late from `seasons/index.js`, so none of this is on the boot path.
 *
 * ==> IT HOLDS NO SEASON AND NO STORM, AND THAT IS THE WHOLE SEAM. <== The wall
 * knows how many storms a year had and how strong the worst of them was. It
 * does not know their names, their tracks or their dates, and it never fetches
 * a season file. Tapping a year hands a NUMBER to the board and the board does
 * the loading it already knew how to do. Nothing about a season is decided in
 * two places.
 *
 * ==> THE THREE STATES ARE EXPLICIT AND `unavailable` IS NOT AN EMPTY WALL.
 * <== §5. A wall with no rows on it looks identical whether the file failed or
 * the archive is genuinely empty, and the second has never been true. Each
 * state gets its own sentence and the failure gets a real retry.
 *
 * ==> THE FILTERS AND THE SORT STACK IN ONE DIRECTION AND ONLY ONE. <== §57.36,
 * and it is the rule the whole screen rests on: FILTER FIRST, then sort what
 * survives. `keepFor` builds the predicate, `rowsFor` applies it and recomputes
 * every per-row figure over what is left, and only then does `sortRows` run.
 * Sorting first and filtering after would give the same rows in an order
 * computed from storms the reader asked to ignore — wrong, and invisibly so.
 *
 * WHAT IS NOT HERE, ON PURPOSE: the near-home slider, held to its own pass
 * because filtering 175 years by distance needs the 0.93 MB whole-basin file;
 * the retired-names chip, which needs a list this repo does not hold (§57.17);
 * and the landfall triangles, which are step 4.
 *
 * Imports config/, lib/ and its own siblings. Never data/ or map/ — the fetch
 * arrives as an injected facade (§12).
 */

import { SEASONS } from '../config/constants.js';
import { aggregate, dotSizeFor, liveRow, rowsFor } from '../lib/wall-index.js';
import {
  emptyFilter, eraSplit, filterPhrase, isFiltered, keepFor, sortRows,
} from '../lib/wall-filter.js';
import { stormFacts } from '../lib/season-facts.js';
import { loadLandMask } from '../lib/land-mask.js';
import { landfallsFor } from '../lib/landfall.js';
import { esc } from './seasons-board-markup.js';
import { catProse, liveRowHtml, liveRowPlaceholderHtml, wallHtml } from './seasons-wall-markup.js';
import { controlsHtml } from './seasons-wall-controls.js';
import { dotted } from './loading-dots.js';

/** Where a strip's width comes from when the element has not been laid out
 *  yet — first paint, or a hidden host. `dotSizeFor` clamps whatever it gets,
 *  so a wrong guess here is a dot one pixel out for one frame, never a broken
 *  row. Measured from the real sheet at 390px: 32px of padding, a 42px year
 *  column, two 8px gaps and a 46px count column. */
const FALLBACK_STRIP_PX = 390 - 32 - 42 - 16 - 46;

/**
 * @param {object} opts
 * @param {object} opts.seasons  injected fetch facade — `loadWall`, `loadIndex`,
 *   `basinsIn`, `basinLabel`. `ui/` never imports `data/` (§12).
 * @param {(year:number, basin:string) => void} opts.onOpenYear
 *   a year row was pressed. The wall does not know the drawer exists — it says
 *   which year, and `seasons/index.js` pushes the board.
 * @param {object} opts.live  injected facade for the season in progress —
 *   `loadLiveIndex`, `loadLiveSeason`. Separate from `seasons` rather than
 *   folded in, exactly as the board takes it: the two read completely
 *   different sources, and one facade would hide which of them a failure came
 *   from when the two failures want different sentences (§5).
 * @param {() => (Set<string>|null)} [opts.liveRunningIds]
 *   which storms the live app is still drawing, as lowercased ATCF ids, or
 *   null when the feed has never answered. §57.21c.
 * @param {(where:{basin:string, label:string}|null) => void} [opts.onWhere]
 *   which basin the wall is showing, for the pill.
 */
export function createSeasonsWallView({
  seasons, live, onOpenYear, onWhere, liveRunningIds,
}) {
  let host = null;
  let bodyEl = null;

  /* --- the fetched half ----------------------------------------------------
   * Two files, and they are asked for together because neither is useful
   * alone: the wall carries the storms, the index carries the basin labels and
   * the order the basins are listed in. Both are shared promises inside
   * `data/seasons.js`, so entering the archive twice makes one request.
   * ---------------------------------------------------------------------- */

  let status = 'loading';
  let reason = '';
  let wall = null;
  let index = null;

  /** Which basin is on screen. A reader CHOICE, so it survives a reload of the
   *  data and is never reset by one. Null until the index names the basins —
   *  the wall must not hardcode `atlantic`, because which basins exist is the
   *  runner's answer, not this file's. */
  let basin = null;

  /* --- what the reader chose -----------------------------------------------
   * ==> ALL OF IT SURVIVES A BASIN SWITCH AND A DATA RELOAD, DELIBERATELY.
   * <== A reader who narrows to Category 5 and then taps East Pacific is
   * asking the same question of a different ocean; resetting the chips would
   * make the basin switch feel like a Back button. Nothing here is ever
   * cleared by the fetch, only by the reader.
   * ---------------------------------------------------------------------- */

  let filter = emptyFilter();
  let sortKey = SEASONS.wallSortDefault;
  let sortDir = SEASONS.wallSortDirDefault;

  /** Whether the `More filters` disclosure is open. Held here rather than left
   *  to the DOM because every render replaces the markup, and a chip tap that
   *  slammed this shut under the reader's thumb is the kind of fault that only
   *  ever shows up on glass. */
  let moreOpen = false;

  let loadStarted = false;

  /* --- the season in progress ----------------------------------------------
   * ==> A SECOND, SLOWER LOAD THAT MUST NOT HOLD THE WALL UP. <== The wall is
   * one 46 KB file and draws 175 years from it. The current season is a
   * different road entirely — an index, then the b-decks — and waiting for it
   * would put the whole archive behind the slowest thing on the screen. So it
   * runs alongside and fills its row in when it lands.
   *
   * ==> AND THE ROW IS ON SCREEN THE WHOLE TIME. <== §5. A row that appears
   * only on success means the gap between "loading" and "failed" is a wall
   * whose newest year is last year — which reads as a complete record rather
   * than as a missing one.
   * ---------------------------------------------------------------------- */

  let liveStatus = 'loading';
  let liveReason = '';
  let liveYear = null;
  let liveFacts = null;
  let liveBasin = null;

  async function loadLive(forBasin) {
    liveBasin = forBasin;
    liveStatus = 'loading';
    liveFacts = null;
    render();

    const idx = await live.loadLiveIndex();
    if (idx.status !== 'ok') {
      liveStatus = 'unavailable';
      liveReason = 'this season could not be read';
      render();
      return;
    }
    liveYear = idx.year ?? null;

    const season = await live.loadLiveSeason(idx, forBasin, liveYear);
    /* The reader may have switched basin while this was in flight. Painting
     * the answer anyway would put the Atlantic's storms on a Pacific row. */
    if (liveBasin !== forBasin) return;

    if (season.status !== 'ok') {
      liveStatus = 'unavailable';
      liveReason = season.reason || 'this season could not be read';
      render();
      return;
    }

    liveFacts = (season.storms || []).map(stormFacts).filter(Boolean);
    liveStatus = 'ok';
    render();

    /* ==> THE ROW PAINTS FIRST AND THE LANDFALLS CATCH UP. <== §57.7b. The
     * mask is 0.30 MB and the storms are already in hand, so awaiting it here
     * would hold a row the reader can otherwise see immediately — for a mark
     * under a dot. It is deliberately not awaited: the season renders, the
     * mask lands, the triangles appear. Until then `landfallSource` stays
     * `noaa` and `landfallsKnown` is false, which is the honest reading of an
     * empty list rather than a claim that nothing came ashore (§5). */
    markLiveLandfalls(forBasin, season.storms || []);
  }

  /**
   * ==> THE RUNNING SEASON IS MEASURED WITH THE ARCHIVE'S OWN INSTRUMENT. <==
   * §57.7b. The same pinned coastline, the same 0.02° cell and the same walk
   * in `lib/landfall.js` that produced every answer back to 1851. A second
   * method here is exactly how 2026 and 1971 would come to disagree about what
   * a landfall is, on a wall that puts them in one column.
   *
   * ==> A MASK THAT NEVER ARRIVES LEAVES THE ROW EXACTLY AS IT WAS. <== §5. It
   * does not blank the season, and it does not fill in zeroes: it simply never
   * upgrades `noaa` to `computed`, so the row goes on saying it does not know.
   */
  async function markLiveLandfalls(forBasin, storms) {
    if (!storms.length) return;

    let mask;
    try {
      mask = await loadLandMask();
    } catch (err) {
      /* Errors surface near their source in human language, and this one has
       * no reader-facing surface: the row is already correct without it. */
      console.warn('[seasons] the land mask did not load, so this season keeps NOAA\'s landfalls:', err.message);
      return;
    }

    /* The reader may have switched basin or left while that was in flight. */
    if (liveBasin !== forBasin || liveStatus !== 'ok') return;

    for (const storm of storms) {
      storm.landfallsComputed = landfallsFor(storm.points || [], mask.isLand);
    }
    liveFacts = storms.map(stormFacts).filter(Boolean);
    render();
  }

  async function load() {
    if (loadStarted) return;
    loadStarted = true;
    status = 'loading';
    render();

    const [w, i] = await Promise.all([seasons.loadWall(), seasons.loadIndex()]);

    /* ==> EITHER FAILURE IS A FAILURE, AND THE REASON NAMES WHICH. <== A wall
     * drawn from storms with no basin labels would say `atlantic` in the
     * heading; an index with no storms would draw 175 empty rows, which is the
     * one thing §5 forbids this screen from doing. Neither half is optional. */
    if (w.status !== 'ok' || i.status !== 'ok') {
      status = 'unavailable';
      reason = w.status !== 'ok' ? w.reason : i.reason;
      loadStarted = false;    /* so Retry is a real retry */
      render();
      return;
    }

    wall = w.wall;
    index = i.index;

    const basins = seasons.basinsIn(index).filter((b) => wall.basins?.[b]);
    if (!basins.length) {
      status = 'unavailable';
      reason = 'the archive holds no basins';
      loadStarted = false;
      render();
      return;
    }
    if (!basin || !basins.includes(basin)) basin = basins[0];

    status = 'ok';
    render();
    announceWhere();
    loadLive(basin);
  }

  function announceWhere() {
    if (!onWhere) return;
    if (status !== 'ok' || !basin) { onWhere(null); return; }
    onWhere({ basin, label: seasons.basinLabel(index, basin) });
  }

  /* --- markup -------------------------------------------------------------- */

  /** How wide a strip actually is, measured rather than assumed.
   *
   *  ==> IT MEASURES THE STRIP THAT IS ALREADY ON SCREEN, WHICH IS THE WHOLE
   *  RESIZE BUG. <== Aaron on glass, 2026-08-26: the dots were one size on
   *  first open and a smaller one after coming back from a season. He was
   *  right and it was not a trick of the eye. This runs while the NEXT render
   *  is still being assembled, so on the very first paint there is no strip to
   *  measure and it fell back to a guessed width — then every later render
   *  measured the real one and got a different answer. Two sizes, decided by
   *  whether the reader had been here before.
   *
   *  The fix is not a better guess. It is `settleDotSize` below: paint, then
   *  measure, then correct — and the correction is a custom property rather
   *  than a re-render, so it cannot cost 175 rows of markup. */
  function stripPx() {
    /* Measured inside `.wall`, never on the pinned row: that row carries an
     * extra column for its note, so its strip is narrower and sizing the whole
     * basin off it would shrink all 175 rows to fit a row that is not part of
     * the record. */
    const slot = bodyEl?.querySelector('.wall .wall-strip-slot');
    const measured = slot?.getBoundingClientRect?.()?.width;
    return Number.isFinite(measured) && measured > 0 ? measured : FALLBACK_STRIP_PX;
  }

  /**
   * Correct the dot size once the browser has actually laid the strip out.
   *
   * ==> THE SIZE IS A CUSTOM PROPERTY, SO THIS COSTS ONE STYLE WRITE. <== The
   * markup carries no pixel figures at all; every dot reads `--wall-dot` and
   * `--wall-dot-gap` off the container. So correcting a strip that turned out
   * to be 300px rather than the guessed 254 is two `setProperty` calls, not a
   * rebuild of every row — which matters because this runs on every entry.
   *
   * ==> ONE FRAME, AND ONE CORRECTION. <== `requestAnimationFrame` puts this
   * after layout. It deliberately does not loop: the dot size does not change
   * the strip's width — the slot is a `1fr` grid track and takes what is left
   * over whatever is inside it — so one pass converges. A loop here would be a
   * measure-write-measure cycle on a scrolling list, which is the frame budget
   * gone.
   */
  function settleDotSize() {
    if (status !== 'ok' || !basin) return;
    const raf = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
    raf(() => {
      /* ==> THE SIZE GOES ON THE BODY, NOT ON `.wall`, AND THAT WAS A REAL
       * BUG. <== Aaron on glass, 2026-08-26: the pinned 2026 row's dots were
       * visibly bigger than every row under it. The pinned row sits ABOVE the
       * `.wall` container — it is not part of the record — so a property set
       * on `.wall` never reached it and it fell through to the stylesheet's
       * default while the 175 rows below used the computed size. Two dot sizes
       * on one screen, which is the one thing a wall drawn to a single scale
       * must never show. The body is the nearest ancestor of both. */
      if (!bodyEl?.style?.setProperty) return;
      const { size, gap } = dotSizeFor(wall, basin, stripPx());
      bodyEl.style.setProperty('--wall-dot', `${size}px`);
      bodyEl.style.setProperty('--wall-dot-gap', `${gap}px`);
    });
  }

  function basinsHtml() {
    const basins = seasons.basinsIn(index).filter((b) => wall.basins?.[b]);
    if (basins.length < 2) return '';
    let h = '<div class="wall-basins" role="radiogroup" aria-label="Basin">';
    for (const b of basins) {
      h += `<button class="seg" type="button" role="radio" data-basin="${esc(b)}"
        aria-checked="${b === basin}" tabindex="${b === basin ? '0' : '-1'}"
        >${esc(seasons.basinLabel(index, b))}</button>`;
    }
    return `${h}</div>`;
  }

  function bodyHtml() {
    if (status === 'loading') {
      /* `dotted` after `esc`, never before — its own header records that the
       * other order draws visible angle brackets on screen (§57.22b). */
      return `<p class="wall-note">${dotted(esc('Reading every season on record…'))}</p>`;
    }

    if (status === 'unavailable') {
      /* ==> THE REASON IS SHOWN AND THE RETRY IS REAL. <== §5 — a screen that
       * says only "something went wrong" gives a reader nothing to do and
       * gives the next session nothing to read. `loadStarted` was released
       * above, so this button re-fetches rather than re-rendering the same
       * failure. */
      return `<p class="wall-note wall-note-bad">The archive could not be read.
        <span class="wall-why">${esc(reason)}</span></p>
        <button class="wall-retry" type="button" data-retry>Try again</button>`;
    }

    const { size, gap } = dotSizeFor(wall, basin, stripPx());

    /* ==> FILTER, THEN RECOMPUTE, THEN SORT. IN THAT ORDER. <== §57.36. */
    const keep = keepFor(filter);
    const rows = sortRows(rowsFor(wall, basin, keep), sortKey, sortDir);

    const filtered = isFiltered(filter);
    /* ==> THE PROSE LABEL HERE, THE SHORT ONE IN THE ROWS. <== This phrase ends
     * up inside a sentence — *"142 seasons had no Category 5"* — where `Cat 5`
     * would read as a truncation. The figure column keeps the short form,
     * because it is a column. */
    const phrase = filterPhrase(filter, { catLabel: catProse });

    /* Not reachable from the real file — every basin it carries has seasons —
     * but a wall with no rows must still say which of the two it is, because
     * the day the generator writes an empty basin is the day this matters. */
    if (!rows.length) {
      return `<p class="wall-note">The record holds no seasons for this basin.</p>`;
    }

    const controls = controlsHtml({
      filter,
      sortKey,
      sortDir,
      moreOpen,
      /* Computed over the FILTERED rows, so the line quotes the undercount for
       * the question actually on screen rather than for storms in general. */
      split: eraSplit(rows),
      phrase,
    });

    return basinsHtml() + controls + liveHtml(keep)
      + wallHtml(rows, { size, gap, filtered, sortKey, sortDir, phrase });
  }

  /** The pinned row for the season in progress, in whichever of its three
   *  states it is in. Always something — see `loadLive`. */
  function liveHtml(keep) {
    if (liveStatus === 'loading') {
      return liveRowPlaceholderHtml(liveYear, 'counting this season…');
    }
    if (liveStatus === 'unavailable') {
      return liveRowPlaceholderHtml(liveYear, liveReason);
    }

    const row = liveRow({ year: liveYear, facts: liveFacts, running: liveRunningIds?.() ?? null });

    /* ==> THE PINNED ROW OBEYS THE SAME FILTER AS EVERY ROW UNDER IT. <== It
     * is the same wall, one year higher up. A Category 5 filter that emptied
     * 142 settled seasons and left this year showing all of its tropical
     * storms would read as the current season being extraordinary, which is
     * the exact class of accidental claim §57.36's whole filter/sort rule
     * exists to prevent.
     *
     * The aggregate is re-derived rather than kept, for the same reason
     * `rowsFor` re-derives it: the strongest storm STILL SHOWING is a
     * different fact from the strongest storm of the year. `total` is left
     * alone — it is the season's real size and it is what the count column's
     * small half is for. */
    const shown = keep ? row.shown.filter(keep) : row.shown;
    return liveRowHtml(shown === row.shown ? row : { ...row, shown, ...aggregate(shown), landfalls: 0 });
  }

  function render() {
    if (!bodyEl) return;
    bodyEl.innerHTML = bodyHtml();
    settleDotSize();
  }

  /* --- input ---------------------------------------------------------------
   * ==> DELEGATED, BECAUSE EVERY CONTROL LIVES INSIDE MARKUP THAT IS REPLACED
   * ON EVERY RENDER. <== A listener bound to a row evaporates the first time
   * the basin changes. One listener on the body outlives all of it.
   *
   * ==> TAP, CLICK AND KEYBOARD ARE ONE PATH, NOT THREE. <== §13. Every row is
   * a real `<button>`, so Enter and Space arrive here as clicks and there is no
   * second code path to keep in step. The only keyboard-specific handling is
   * the basin group's arrow keys, which a radiogroup owes its reader.
   * ---------------------------------------------------------------------- */

  /* ==> ONE REPAINT PER CHANGE, AND IT REDRAWS THE CONTROLS TOO. <== The
   * chips, the tally, the honesty line and the rows are all functions of the
   * same state, so there is nothing to keep in step by hand — and the one
   * thing the DOM was holding on its own (the disclosure's open state) is
   * captured first, or a chip tap would close it. */
  function changed() {
    moreOpen = !!bodyEl?.querySelector('[data-more]')?.open;
    /* ==> A REPAINT MUST NOT THROW THE READER BACK TO 1851. <== `render()`
     * replaces the body's markup, which resets its scroll to the top. Dragging
     * a threshold slider repaints on every step — twelve arrow presses is
     * twelve jumps — and tapping a chip after scrolling down the wall loses
     * the reader's place entirely. The controls sit at the top, so this is
     * invisible in a fresh session and unmissable in a real one. */
    const top = bodyEl?.scrollTop ?? 0;
    render();
    if (bodyEl) bodyEl.scrollTop = top;
  }

  /** Hand focus back to the control the reader is using. The markup was
   *  replaced, so the element under their thumb is a new one — without this a
   *  keyboard reader moves a slider once and then loses focus into the body.
   *
   *  ==> `preventScroll`, OR RESTORING THE SCROLL POSITION IS UNDONE A LINE
   *  LATER. <== The default scrolls the focused element into view, which on a
   *  phone reads as the sheet lurching every time a chip is tapped. */
  const refocus = (sel) => bodyEl?.querySelector(sel)?.focus({ preventScroll: true });

  /** A threshold slider at its rail is OFF, not a filter matching everything.
   *  Pressure runs the other way — see `SEASONS.wallPressureMin`. */
  function thresholdValue(id, raw) {
    const v = Number(raw);
    if (!Number.isFinite(v)) return null;
    if (id === 'pressure') return v >= SEASONS.wallPressureMax ? null : v;
    return v <= 0 ? null : v;
  }

  function onInput(e) {
    const slider = e.target.closest?.('[data-threshold]');
    if (slider) {
      const id = slider.dataset.threshold;
      const v = thresholdValue(id, slider.value);
      if (id === 'days') filter.minDays = v;
      else if (id === 'pressure') filter.maxPressureMb = v;
      else if (id === 'ace') filter.minAce = v;
      changed();
      /* The markup was replaced, so the element under the thumb is a new one.
       * Handing focus back keeps a keyboard reader on the control they were
       * dragging — without it, arrow-keying a slider moves it once and then
       * loses the focus into the body. */
      refocus(`[data-threshold="${id}"]`);
      return;
    }

  }

  function onClick(e) {
    if (e.target.closest('[data-retry]')) { load(); return; }

    const chip = e.target.closest('[data-chip]');
    if (chip) {
      const c = Number(chip.dataset.chip);
      /* ==> UNCHECKING THE LAST CHIP IS REFUSED RATHER THAN ALLOWED. <== §5.
       * Zero categories checked is a wall with nothing on it, which looks
       * exactly like a wall that failed to load — and the reader's own last
       * tap is the least likely explanation they will reach for. Refusing the
       * tap leaves them one chip from where they were. */
      if (filter.cats.has(c)) { if (filter.cats.size > 1) filter.cats.delete(c); }
      else filter.cats.add(c);
      changed();
      refocus(`[data-chip="${c}"]`);
      return;
    }

    const landfall = e.target.closest('[data-landfall]');
    if (landfall) {
      filter.landfall = !filter.landfall;
      changed();
      refocus('[data-landfall]');
      return;
    }

    const sort = e.target.closest('[data-sort]');
    if (sort) {
      const k = sort.dataset.sort;
      if (SEASONS.wallSortKeys.includes(k)) {
        /* ==> PRESSING THE SELECTED KEY REVERSES IT; PRESSING ANOTHER STARTS
         * IT LARGEST-FIRST. <== Arriving at "fewest landfalls first" because
         * the previous key happened to be ascending would be the control
         * remembering something the reader never asked it to. */
        if (k === sortKey) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortKey = k; sortDir = 'desc'; }
      }
      changed();
      refocus(`[data-sort="${k}"]`);
      return;
    }

    const seg = e.target.closest('[data-basin]');
    if (seg) {
      const next = seg.dataset.basin;
      if (next && next !== basin && wall?.basins?.[next]) {
        basin = next;
        render();
        announceWhere();
        loadLive(next);
        bodyEl.querySelector('[data-basin][aria-checked="true"]')?.focus();
      }
      return;
    }

    const row = e.target.closest('.wall-row');
    if (row) {
      const year = Number(row.dataset.year);
      if (Number.isFinite(year)) onOpenYear?.(year, basin);
    }
  }

  function onKeydown(e) {
    const seg = e.target.closest?.('[data-basin]');
    if (!seg) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const all = [...bodyEl.querySelectorAll('[data-basin]')];
    const i = all.indexOf(seg);
    if (i < 0) return;
    e.preventDefault();
    const next = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
    next?.click();
  }

  return {
    id: 'seasons-wall',

    /** §57.39's rung 2. The heading is the feature's own plural, and the
     *  reader gets there from a door labelled `Past storms` — which is
     *  §57.16a's on-screen name for the whole feature and is deliberately the
     *  same word here rather than a second name for one thing. */
    title: 'Past storms',

    /** ==> THE HEADER'S X IS A MINIMISE CHEVRON, LIKE THE BOARD'S. §57.21b
     *  item 8. <== Closing the wall does not leave the archive — the globe
     *  stays sepia and the top pill stays on screen as the way out. An X says
     *  "done with this", which is not what the button does. */
    minimises: true,

    mount(el) {
      host = el;
      host.innerHTML = '<div class="drawer-body" id="seasons-wall-body"></div>';
      bodyEl = host.querySelector('#seasons-wall-body');
      bodyEl.addEventListener('click', onClick);
      bodyEl.addEventListener('keydown', onKeydown);
      /* `input` rather than `change`, so a dragged slider narrows the wall as
       * it moves. `change` would leave the reader dragging against a screen
       * that does not answer until they let go. */
      bodyEl.addEventListener('input', onInput);
      render();
      load();
    },

    onEnter() {
      /* Re-announce on every entry: the reader may have gone down to a season
       * and come back, and the pill has to name what is on screen now. */
      render();
      announceWhere();
    },

    /** First stop is the basin switch when there is one, and the newest year
     *  otherwise — both are the top of the screen, and neither is the Close
     *  button (§13). */
    focus() {
      return bodyEl?.querySelector('[data-basin][aria-checked="true"]')
        || bodyEl?.querySelector('.wall-row')
        || bodyEl?.querySelector('[data-retry]');
    },

    /** Which basin the wall is on, so a year opened from here lands the board
     *  in the same one. */
    currentBasin: () => basin,
  };
}
