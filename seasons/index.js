/**
 * seasons/index.js — the way in and the way out of the archive globe.
 *
 * §57.30 step 4. This module and everything it imports is loaded on FIRST
 * ENTRY and never before (§57.35 fault 4): every import in every file ships to
 * every visitor, this app already carries ~180 modules, and taxing every boot
 * forever for a feature most sessions never open is exactly the cost that
 * audit was written to stop. `main.js` reaches this file through
 * `await import('./seasons/index.js')` and holds nothing but the two doors.
 *
 * ==> WHAT ENTERING ACTUALLY IS. <== Four things, and the fourth is the one
 * that is easy to forget:
 *
 *   1. The palette is FORCED to sepia. Not a setting — `forceMode` remembers
 *      what was live and `releaseMode` puts it back, including a settings
 *      change or an OS theme flip that happened while the archive was open.
 *   2. The live globe is emptied. Storm dots, watched areas, imagery and the
 *      3D cage all go, and the poll behind them stops repainting them.
 *   3. The bar goes on screen, so the way out is always visible.
 *   4. THE WALL GOES UP. `lib/archive-mode.js` is what `data/lifecycle.js`
 *      reads before it writes, and it is the reason a 1935 storm cannot end
 *      up in the live ended-storm registry the way Ida did in August (§57.2).
 *
 * ==> LEAVING RUNS EVERY ONE OF THOSE BACKWARDS, AND IT RUNS EVEN IF ENTERING
 * WENT WRONG. <== A half-entered archive with no way out is the failure mode
 * worth spending code on: sepia sky, no storms, no bar. Entry is wrapped, and
 * a throw anywhere inside it leaves through the same door a button press
 * would.
 *
 * ==> THE BOARD IS A VIEW IN THE ONE DRAWER, REGISTERED HERE ON FIRST ENTRY.
 * <== §16 says there is exactly one panel element on screen. Registering it
 * from this file rather than from `app/views.js` is what keeps it off the boot
 * path: `ui/view-seasons-board.js`, `data/seasons.js`, `lib/season-facts.js`
 * and `lib/season-names.js` are all reached through this module's own dynamic
 * import and never ship to a visitor who does not open the archive.
 *
 * ==> AND THE GLOBE IS STILL SOMEBODY ELSE'S. <== `archiveGlobe` arrives
 * injected, exactly as `liveGlobe` does, so `seasons/` never imports `map/`.
 * This file knows WHEN tracks should be drawn; main.js owns HOW.
 *
 * Imports: config/, lib/ and its own directory. Nothing in the app imports
 * this except the dynamic import in main.js.
 */

import { forceMode, MODE, releaseMode } from '../config/theme.js';
import { isArchive, setArchive } from '../lib/archive-mode.js';
import * as seasonsData from '../data/seasons.js';
import { createSeasonsBoardView } from '../ui/view-seasons-board.js';
import { createSeasonsBar } from './bar.js';
import * as deepLink from './deep-link.js';

/** Registered once per page load. A dynamic import is cached, so a second
 *  `import()` returns this same namespace — which is what makes "has the board
 *  been registered" answerable from module state rather than by asking the
 *  drawer, whose `register` is deliberately dumb and would happily add a
 *  second host for the same id. */
let boardView = null;

/** The CURRENT session's archive globe. The board is registered once and lives
 *  for the page, while the injected globe arrives per entry — so the board
 *  reaches it through this rather than closing over the first one it ever saw,
 *  which would draw a second visit's tracks into a dead facade. */
let currentArchiveGlobe = null;

/** The one live session, or null. Module state, and the module is a singleton
 *  because a dynamic import is cached — a second `import()` returns this same
 *  namespace, which is what makes double entry detectable rather than a race. */
let session = null;

/**
 * Enter the archive.
 *
 * @param {object} deps
 * @param {{hide:()=>void, show:()=>void}} deps.liveGlobe
 *   main.js owns the storm dots, the watched areas, the imagery and the 3D
 *   cage; this file only knows WHEN they should be off. Injected rather than
 *   imported so `seasons/` never reaches into `map/` or `data/`.
 * @param {{register:(def:object)=>void, go:(id:string)=>void,
 *          close:()=>void, isOpen:()=>boolean}} deps.drawer
 * @param {{setTracks:(sel:Array)=>void, clearTracks:()=>void}} deps.archiveGlobe
 *   the archive's own geometry, injected for the same reason `liveGlobe` is:
 *   `seasons/` must never reach into `map/` (§12).
 * @param {() => void} deps.recenterAndClear  drop the selection and its geometry.
 * @param {boolean} [deps.fromUrl]  true when this entry came from
 *   `?season=…` rather than from a door. THE PARSE HAPPENS HERE, not in
 *   main.js, and that is deliberate: `seasons/deep-link.js` must not be on the
 *   boot path either (§57.35 fault 4), so main.js does a one-line check for
 *   the parameter's PRESENCE and this file decides what it means.
 * @param {Element|null} [deps.returnFocusTo]  the control that opened this.
 * @returns {{leave:()=>void}}
 */
export function openSeasons({
  liveGlobe,
  archiveGlobe,
  drawer,
  recenterAndClear,
  fromUrl = false,
  returnFocusTo = null,
} = {}) {
  /* Already in. Re-entering from the other door is not an error and must not
   * build a second bar — it is somebody pressing the thing they are already
   * looking at. */
  if (session) return session.handle;

  const bar = createSeasonsBar({
    onLeave: () => leave(),
    /* The bar's own sentence is the way back to the board once it has been
     * closed. `go` rather than `push`: there is nothing else in the archive's
     * history to go back to, and a stack of one is what Back should find. */
    onOpenBoard: () => safely(() => drawer?.go?.('seasons-board')),
  });

  /* ==> A LINK NAMING A YEAR OUTSIDE THE RECORD IS NOT AN EMPTY SEASON. <==
   * `parse` returns null both when there is no parameter and when there is a
   * bad one; `reasonFor` is what tells those apart, and the bad one gets said
   * out loud rather than opening a silent empty globe (§5). */
  const link = fromUrl ? deepLink.parse(location.search) : null;
  const linkReason = fromUrl ? deepLink.reasonFor(location.search) : 'absent';

  const state = {
    season: link?.season ?? null,
    storms: link?.storms ?? [],
    returnFocusTo,
    bar,
    handle: null,
  };

  function leave() {
    /* Not entered, or already left. A leave path runs from a button, from an
     * error route, and potentially from both — and one that threw on the
     * second call would be a way to strand somebody in sepia. */
    if (session !== state) return;
    session = null;

    /* ORDER IS DELIBERATE AND IT IS THE REVERSE OF ENTRY.
     *
     * The wall comes down FIRST, because everything after it is live-app work
     * that is allowed to persist again. Then the palette, then the storms,
     * because a repaint that lands while the globe is still empty is one
     * frame of the right colours with nothing on them, and a repaint that
     * lands after the storms are back is one frame of the WRONG colours with
     * storms on them, which reads as a glitch. */
    setArchive(false);
    /* `releaseMode` announces, and `app/theme-switch.js` repaints off that
     * announcement — the chrome, the 3D globe and the basemap all together. */
    releaseMode();
    /* The archive's own geometry goes before the live app's comes back, for
     * the same reason the palette does: one frame with 1935's tracks over
     * today's storms would read as a glitch, and it is the frame a reader
     * sees on the way out rather than on the way in. */
    safely(() => archiveGlobe?.clearTracks?.());
    safely(() => boardView?.reset?.());
    currentArchiveGlobe = null;
    safely(() => drawer?.close?.());
    safely(() => liveGlobe?.show());
    safely(() => bar.unmount());
    safely(() => deepLink.clear());

    /* §13. Back to the row that opened this, not the top of the document. If
     * that row is gone — the drawer rebuilt its list while the archive was
     * open — this simply does nothing and the browser keeps focus where it
     * is, which is no worse than the alternative. */
    safely(() => state.returnFocusTo?.focus?.());
  }

  state.handle = { leave };
  session = state;

  try {
    /* THE WALL BEFORE ANYTHING ELSE. Everything below can throw; nothing below
     * should be able to write a historical storm into live storage while it
     * does. */
    setArchive(true);

    /* The live app's own selection goes before its globe does — a storm's
     * cone left drawn over an archive year is two worlds in one screenshot. */
    safely(() => recenterAndClear?.());

    safely(() => liveGlobe?.hide());
    forceMode(MODE.SEPIA);

    /* ==> THE BAR SAYS SOMETHING TRUE FROM THE FIRST FRAME. <== It mounts
     * before the board has read a byte, so without this it would carry an
     * empty sentence for as long as the index takes to arrive. A deep link
     * with a bad year overrides it and keeps saying so — that reason is about
     * the LINK, and it does not stop being true when a season loads. */
    bar.setDetail(detailFor(linkReason));
    bar.mount();

    currentArchiveGlobe = archiveGlobe || null;
    ensureBoard({ bar, drawer, linkReason }).setSeason(state.season);
    /* `go` rather than `push`: entering the archive is a fresh start, and a
     * history stack reaching back into the live app is a Back button that
     * walks a reader out of a world the bar says they are still in. */
    drawer?.go?.('seasons-board');

    deepLink.write({ season: state.season, storms: state.storms });
  } catch (e) {
    /* ==> A FAILED ENTRY LEAVES. <== The alternative is a reader looking at a
     * sepia globe with no storms and no bar, and no way back short of a
     * reload. Reported rather than swallowed: this is a bug, and the console
     * is where the next session finds it. */
    console.error('[landfall] could not enter the archive:', e);
    leave();
  }

  return state.handle;
}

/** Is a session open? For main.js's doors, so pressing the second one while
 *  the first is open does not try to enter twice. */
export function seasonsOpen() {
  return session !== null && isArchive();
}

/** Leave from outside — main.js's own teardown paths. No-op when not in. */
export function leaveSeasons() {
  session?.handle.leave();
}

/**
 * Register the board once, and wire the two things it talks to.
 *
 * ==> IT IS REGISTERED, NEVER RE-REGISTERED. <== `drawer.register` appends a
 * host element and stores it under the view's id; called twice it leaves an
 * orphaned host in the DOM and a live listener bound to it. The archive can be
 * entered and left many times in one page load, so the guard is the module
 * variable rather than anything the drawer could tell us.
 *
 * The two callbacks are the whole of the board's outward reach. It never
 * touches the globe or the bar itself — it says what changed, and this file
 * decides who needs to know.
 */
function ensureBoard({ bar, drawer, linkReason }) {
  if (boardView) return boardView;

  boardView = createSeasonsBoardView({
    seasons: seasonsData,

    /* The globe redraws from the WHOLE ticked set on every change, so there is
     * no add path and no remove path to drift apart. */
    onSelection: (selected) => safely(() => currentArchiveGlobe?.setTracks?.(selected)),

    /* ==> A BAD LINK'S REASON OUTRANKS THE YEAR. <== A reader who arrived on
     * `?season=1066` needs to know the link was wrong, and that stays true
     * after the board falls back to a season that does exist. Saying
     * `2025 · Atlantic` over the top of it would silently swallow the one
     * message the words exist to carry (§5). */
    onWhere: (where) => safely(() => {
      if (linkReason === 'malformed' || linkReason === 'out-of-range') return;
      bar.setDetail(where ? where.label : '');
    }),
  });

  /* ==> AND IT HAS TO BE HANDED TO THE DRAWER, WHICH IS THE STEP THAT WAS
   * MISSING. <== Building the view is not the same as registering it:
   * `drawer.go('seasons-board')` navigates to an id the drawer knows, and
   * without this it knows nothing by that name. `tools/test-archive-mode.mjs`
   * caught it — the entry path ran clean and the board would never have been
   * on screen. */
  drawer?.register?.(boardView);

  return boardView;
}

/**
 * What the bar says about a link that named a year the record does not have.
 *
 * ==> ONLY THE WORDS CAN TELL A TYPO FROM A QUIET SEASON. <== The globe under
 * both is the same globe. `?season=1066` now falls through to a season that
 * exists, so without this the reader is looking at a working archive that is
 * quietly not the year they were sent — which is worse than the old empty
 * globe, not better. Empty string when the link was fine: the board fills the
 * slot with the season a moment later.
 */
function detailFor(reason) {
  if (reason === 'malformed') return 'That link\u2019s year could not be read.';
  if (reason === 'out-of-range') return 'That year is not in the record.';
  return '';
}

/** Run a teardown step whose failure must not stop the ones after it. */
function safely(fn) {
  try {
    fn();
  } catch (e) {
    console.warn('[landfall] archive step failed:', e);
  }
}
