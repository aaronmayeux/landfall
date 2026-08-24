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
 * NOTHING IS FETCHED HERE AND NOTHING IS DRAWN. The year picker, the roster
 * and the tracks are steps 5 and 6. What is on screen after entering is an
 * empty sepia globe and a bar that says so in words — which is the honest
 * shape of a half-built feature, and not the same thing as silence (§5).
 *
 * Imports: config/, lib/ and its own directory. Nothing in the app imports
 * this except the dynamic import in main.js.
 */

import { forceMode, MODE, releaseMode } from '../config/theme.js';
import { isArchive, setArchive } from '../lib/archive-mode.js';
import { createSeasonsBar } from './bar.js';
import * as deepLink from './deep-link.js';

/**
 * What the bar says while there is nothing to draw.
 *
 * ==> THIS SENTENCE IS DELETED IN STEP 5, NOT EDITED. <== It exists because
 * the globe is genuinely empty and an empty globe with no explanation reads as
 * a broken app. The moment there is a year picker there is something true to
 * say instead, and a leftover apology beside a working feature is worse than
 * the silence it replaced.
 */
const NOTHING_YET = 'The year picker is not built yet — there is nothing to draw.';

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
 * @param {{close:()=>void, isOpen:()=>boolean}} deps.drawer
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
  drawer,
  recenterAndClear,
  fromUrl = false,
  returnFocusTo = null,
} = {}) {
  /* Already in. Re-entering from the other door is not an error and must not
   * build a second bar — it is somebody pressing the thing they are already
   * looking at. */
  if (session) return session.handle;

  const bar = createSeasonsBar({ onLeave: () => leave() });

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

    /* The drawer is a live-app surface — a storm list over an archive globe
     * is two different worlds in one screenshot. Closed rather than emptied:
     * step 5's board is its own view and will open on its own terms. */
    safely(() => recenterAndClear?.());
    safely(() => drawer?.close?.());

    safely(() => liveGlobe?.hide());
    forceMode(MODE.SEPIA);

    bar.setDetail(detailFor(linkReason));
    bar.mount();
    bar.focusLeave();

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
 * What the bar says, given how the reader got here.
 *
 * Three outcomes and three sentences, because they are three different facts.
 * A bad year in a link is the app's ONE chance to say the link is wrong — the
 * globe underneath it is empty either way, so without this the reader cannot
 * tell a typo from a quiet season, which is exactly the confusion §5 is about.
 */
function detailFor(reason) {
  if (reason === 'malformed') return `That link's year could not be read. ${NOTHING_YET}`;
  if (reason === 'out-of-range') return `That year is not in the record. ${NOTHING_YET}`;
  return NOTHING_YET;
}

/** Run a teardown step whose failure must not stop the ones after it. */
function safely(fn) {
  try {
    fn();
  } catch (e) {
    console.warn('[landfall] archive step failed:', e);
  }
}
