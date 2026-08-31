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
 *   3. TWO PILLS go on screen (§57.38). The top one is the way out and is
 *      always visible; the bottom one says what is currently drawn and sits
 *      under the drawer, so it costs the globe no layout. The bar that used to
 *      do both jobs was deleted at step 5.
 *   4. THE WALL GOES UP. `lib/archive-mode.js` is what `data/lifecycle.js`
 *      reads before it writes, and it is the reason a 1935 storm cannot end
 *      up in the live ended-storm registry the way Ida did in August (§57.2).
 *
 * ==> LEAVING RUNS EVERY ONE OF THOSE BACKWARDS, AND IT RUNS EVEN IF ENTERING
 * WENT WRONG. <== A half-entered archive with no way out is the failure mode
 * worth spending code on: sepia sky, no storms, no pill. Entry is wrapped, and
 * a throw anywhere inside it leaves through the same door a button press
 * would.
 *
 * ==> THE BOARD IS A VIEW IN THE ONE DRAWER, REGISTERED HERE ON FIRST ENTRY.
 * <== §16 says there is exactly one panel element on screen. Registering it
 * from this file rather than from `app/views.js` is what keeps it off the boot
 * path: `ui/view-seasons-board.js`, `data/seasons.js`, `lib/season-facts.js`
 * and `lib/season-names.js` are all reached through this module's own dynamic
 * import and never ship to a visitor who does not open the archive.
 * `data/seasons-live.js` joined them at step 5b for the same reason.
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
import * as seasonsLive from '../data/seasons-live.js';
import { createSeasonsBoardView } from '../ui/view-seasons-board.js';
import { createSeasonsWallView } from '../ui/view-seasons-wall.js';
import { createSeasonDetailView } from '../ui/view-season-detail.js';
import { reportFor, forgetReports } from '../data/season-reports.js';
import { resolveSystem } from '../lib/units.js';
import { getHome } from '../data/home.js';
import { settingValue } from '../data/settings-prefs.js';
import { createSeasonsStatusPill, pillDetail } from './status-pill.js';
import { createSeasonsPill } from './pill.js';
import { createSeasonClock } from './clock-control.js';
import * as deepLink from './deep-link.js';

/**
 * WHERE THE READER WAS LAST TIME THEY HAD THE ARCHIVE'S DRAWER OPEN.
 *
 * ==> IT EXISTS SO REOPENING IS RESUMING RATHER THAN STARTING OVER. <== The
 * ladder is `Past storms -> a year -> a storm` (§57.39), and the drawer can be
 * minimised at any rung. Without this, the one control that reopens it would
 * always land on the top of the wall — so a reader who minimised the drawer to
 * look at 2005's tracks would lose 2005 to get the roster back.
 *
 * ==> IT IS FED BY `drawer.onChange`, AND THE FIRST VERSION WROTE IT ONLY WHEN
 * A YEAR WAS TAPPED. <== That version was wrong in a way Aaron caught on glass
 * and a Playwright run reproduced exactly: open 2005, press Back to the wall,
 * minimise, reopen — and it came back on 2005, because nothing had ever
 * unwritten the year. A record of "the last rung the reader ENTERED" is not a
 * record of where they ARE. Only the drawer knows that, so only the drawer is
 * allowed to say it.
 *
 * ==> AND IT IS DELIBERATELY NOT UPDATED WHILE THE DRAWER IS SHUT. <== `close`
 * clears the stack, so `currentId()` answers null the moment it happens. A
 * listener that took that at face value would wipe the memory in the very act
 * of creating the need for it.
 */
let lastRung = { year: null, stormId: null };

/** Registered once per page load. A dynamic import is cached, so a second
 *  `import()` returns this same namespace — which is what makes "has the board
 *  been registered" answerable from module state rather than by asking the
 *  drawer, whose `register` is deliberately dumb and would happily add a
 *  second host for the same id. */
let boardView = null;

/** The Wall of Years (§57.36, step 14) — rung 2, and the archive's front door.
 *  Registered beside the board and guarded the same way. It is built in
 *  `ensureBoard` rather than in a function of its own, because a wall the
 *  drawer knows about with no board underneath it is a year row that opens
 *  nothing: the two rungs are registered together or neither is. */
let wallView = null;

/** The storm detail panel (§57.22, §57.22b, step 7). Registered beside the
 *  board and for the same reason: once per page load, guarded on module state
 *  rather than on anything the drawer could tell us. */
let detailView = null;

/** The CURRENT session's archive globe. The board is registered once and lives
 *  for the page, while the injected globe arrives per entry — so the board
 *  reaches it through this rather than closing over the first one it ever saw,
 *  which would draw a second visit's tracks into a dead facade. */
let currentArchiveGlobe = null;

/** The CURRENT session's way of asking the live app what is still running
 *  (§57.21c). Same shape and same reason as `currentArchiveGlobe` above: the
 *  board is registered once and lives for the page, while the injection
 *  arrives per entry — so the board must reach it through this rather than
 *  closing over the first one it ever saw. */
let currentLiveRunningIds = null;

/** What the board last said is ticked. §57.67 slice C.
 *
 *  ==> IT IS HELD BECAUSE THE GLOBE NOW HAS TWO REASONS TO BE REDRAWN AND ONLY
 *  ONE OF THEM COMES FROM THE BOARD. <== Ticking a storm changes the SET;
 *  dragging the scrubber changes the MOMENT. The board knows nothing about the
 *  second and the clock knows nothing about the first, so neither of them holds
 *  both halves of a push. This does. */
let currentSelected = [];

/** The one live session, or null. Module state, and the module is a singleton
 *  because a dynamic import is cached — a second `import()` returns this same
 *  namespace, which is what makes double entry detectable rather than a race. */
let session = null;

/**
 * Push the whole ticked set and the clock's moment at once. §57.67 slice C.
 *
 * ==> ONE WRITER, AND BOTH ROADS RUN THROUGH IT. <== `map/layers/season-
 * tracks.js` spends a paragraph on why the cut is an argument to the whole-set
 * push rather than a call of its own: a moment that can be pushed separately is
 * a moment that can be forgotten, and the globe would then show dots from one
 * time under a line from another. That guarantee only holds if this side has
 * one expression for the pair too — a second call site that read the set and
 * forgot to ask for the cut would put the same bug back on this side of the
 * injection.
 *
 * The clock is asked rather than checked. It answers null whenever it is not
 * engaged, and `map/layers/season-cut.js` answers "all of it" to a null cut, so
 * there is no branch here about whether a clock exists.
 */
function pushGlobe() {
  currentArchiveGlobe?.setTracks?.(currentSelected, session?.clock?.cut?.() ?? null);
}

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
  liveRunningIds = null,
  from = null,
  fromUrl = false,
  returnFocusTo = null,
} = {}) {
  /* Already in. Re-entering from the other door is not an error and must not
   * build a second bar — it is somebody pressing the thing they are already
   * looking at. */
  if (session) return session.handle;

  /* ==> THE WAY OUT IS A PILL AT THE TOP, AND IT IS THE ONLY ONE. <== Step 6,
   * §57.37. Escape steps the drawer back and closes it; it never leaves the
   * archive. So this control is the whole of the exit, which is why it is
   * built before anything that can throw and torn down last. */
  const pill = createSeasonsPill({ onLeave: () => leave() });

  /* ==> AND THE ONE AT THE BOTTOM SAYS WHAT IS DRAWN. <== Step 5, §57.38. It
   * carries the deleted bar's sentence unchanged and inherits its behaviour:
   * pressing it TOGGLES the drawer rather than only opening it. Aaron on glass,
   * 2026-08-25 — the open-only version was a one-way door, so the only way to
   * clear the globe again was to hunt for the chevron in the drawer's header.
   *
   * ==> AND IT REOPENS THE RUNG THE READER LEFT, NOT THE TOP OF THE WALL. <==
   * §57.39 put a screen above the board, so "open the archive's drawer"
   * stopped having one answer. Always landing on the wall would mean a reader
   * who minimised the drawer to look at 2005's tracks lost 2005 to get the
   * roster back — the drawer's whole reason for minimising rather than closing
   * (§57.21b item 8) undone by the control that reopens it. */
  const statusPill = createSeasonsStatusPill({
    onToggleBoard: () => safely(() => toggleDrawer()),
  });

  /* ==> AND THE THIRD PIECE OF ARCHIVE FURNITURE IS THE CLOCK. <== §57.67
   * slice C. It is a button in the control cluster and a slider in a pill that
   * takes the caption's slot; `seasons/clock-control.js` owns both, including
   * putting them on screen and taking them off again.
   *
   * ==> IT IS BUILT PER VISIT, LIKE THE TWO PILLS AND UNLIKE THE BOARD. <== The
   * board is registered once for the page and outlives every entry. This holds
   * a ticked set and a moment, both of which belong to ONE visit — carrying
   * them across would mean re-entering the archive and finding last visit's
   * season frozen at last visit's date. */
  const clock = createSeasonClock({
    /* The clock knows the moment and nothing else; this file knows who needs to
     * be told. One writer for the globe, shared with the board's own tick
     * handler — see `pushGlobe`. */
    onScrub: () => safely(() => pushGlobe()),
  });

  /** ==> ONE FUNCTION, TWO CONTROLS, AND THAT IS DELIBERATE. <== The bottom
   *  pill is hidden above 720px (`#storm-pill` sets that precedent and this
   *  follows it), so on a desktop the archive would otherwise have no way to
   *  get the drawer back. §57.37 gives that job to `btn-storms`, which reaches
   *  it through `reopenArchiveDrawer` below. The two are the narrow and wide
   *  halves of one action, split exactly the way the live app already splits
   *  the pill and the cluster — so they share the function rather than growing
   *  two rules about rungs that could drift apart.
   *
   *  The wall is rebuilt first either way, so Back from a restored year finds
   *  it rather than finding nothing. */
  function toggleDrawer() {
    if (drawer?.isOpen?.()) { drawer.close(); return; }
    restoreRung(drawer);
  }

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
    from,
    statusPill,
    pill,
    /* ==> THE CLOCK IS ON THE SESSION FOR THE REASON `statusPill` IS. <==
     * `ensureBoard` runs ONCE per page load and its callbacks outlive every
     * visit, while this is rebuilt on each entry. A closure over the local
     * would therefore hold visit one's control forever and scrub a detached
     * element on every later visit — silently, because nothing throws. Same
     * trap, same shape, same fix. */
    clock,
    /* ==> WHY THE LINK'S VERDICT IS ON THE SESSION AND NOT A LOCAL. <== The
     * wall reads it back through a getter, and the wall is registered once per
     * page load while this object is rebuilt on every entry. Holding it here
     * is what makes "which link opened THIS visit" answerable. */
    linkReason,
    /* ==> THE TOGGLE IS ON THE SESSION BECAUSE `btn-storms` REACHES IT FROM
     * OUTSIDE EVERY CLOSURE. <== `reopenArchiveDrawer` is exported for
     * `main.js`'s cluster handler, which runs on the live page and has no way
     * into this function's scope. Holding it here rather than in a module
     * variable ties its lifetime to the visit: no session, no toggle, so a
     * cluster press after leaving cannot reopen a drawer over the live globe. */
    toggleDrawer,
    /* ==> THE DRAWER IS ON THE SESSION SO `openSeasonStorm` CAN REACH IT.
     * §57.21d. <== It is the same object every visit — `main.js` builds one
     * for the page — but the exported entry point runs outside every closure
     * that has it, and holding it here rather than in a fourth module variable
     * keeps its lifetime tied to the visit: no session, no drawer, no way for
     * a stray tap to push a panel over the live globe. */
    drawer,
    handle: null,
    /* ==> THE ENTRY FLIGHT HAPPENS ONCE PER VISIT AND THIS IS WHAT MAKES IT
     * ONCE. <== `onWhere` is the hook that fires the moment the board has
     * settled a season, which is the first moment the basin is KNOWN — but it
     * also fires on every tick, every filter and every focus, and a camera
     * that chased those would fly back to the basin every time the reader
     * ticked a storm. §57.21c. */
    flownIn: false,
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
    /* ==> THE REPORT INDEX IS DROPPED ON THE WAY OUT. <== It is ~100 KB held
     * for the session, and a session can outlive a deploy — a reader who
     * leaves the archive, sits for an hour and comes back should not be
     * answering "does this storm have a report" out of a copy the server has
     * since replaced. Cheap to re-fetch, and `_headers` marks it `no-cache`
     * precisely so the second fetch is honest. */
    safely(() => forgetReports());
    currentArchiveGlobe = null;
    currentLiveRunningIds = null;
    /* ==> THE WATCHER GOES BEFORE THE DRAWER IS CLOSED, AND THE ORDER IS THE
     * WHOLE OF IT. <== `close` fires a change with an empty stack. The
     * listener guards against believing that, but a listener left bound across
     * a session boundary is a listener still running for a session that has
     * ended — and the next entry would add a second one. */
    safely(() => session?.unwatchRung?.());
    /* ==> AND THE RUNG IS FORGOTTEN ON THE WAY OUT, NOT ON THE WAY IN. <==
     * Leaving the archive entirely is a different act from minimising the
     * drawer. Coming back afterwards is a new visit and should open on the
     * wall — carrying 2005 across it would be a screen remembering a choice
     * from a visit that has ended, which is the mistake `openFrom` records. */
    lastRung = { year: null, stormId: null };
    safely(() => drawer?.close?.());
    safely(() => liveGlobe?.show());
    safely(() => statusPill.unmount());
    safely(() => pill.unmount());
    /* ==> THE CLOCK COMES DOWN BEFORE `data-seasons` DOES, WHICH IS THE SAME
     * ORDER THE PILLS FOLLOW. <== Its own `unmount` also drops
     * `data-seasons-clock`, and that attribute hides the archive's caption
     * pill — left on the document it would go on hiding a live-app surface
     * from inside a world nobody is in any more. Two attributes, taken off in
     * the order they went on. */
    safely(() => clock.unmount());
    /* And the held set with it. It is the ticked storms of a visit that has
     * ended; a later push reading it would draw 2005 over the live globe. */
    currentSelected = [];
    /* ==> THE LAYOUT ATTRIBUTE COMES OFF HERE, NOT INSIDE A COMPONENT. <==
     * Step 6, 2026-08-28. It used to ride on `bar.mount`/`unmount`, which was
     * only ever true by accident — the bar happened to be the first thing on
     * screen. Every rule it drives outlives the bar: the drawer's fixed sheet
     * height, the two hidden cluster buttons, and the live surfaces the
     * archive suppresses. Step 5 deleted `seasons/bar.js` and none of that
     * went with it, because the session owns it rather than any one piece of
     * furniture. Last of the chrome teardown, for the same reason it is first on the
     * way in: nothing should be laid out for the archive after the archive
     * has stopped being on screen. */
    safely(() => document.documentElement.removeAttribute('data-seasons'));
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

    /* ==> THE ATTRIBUTE GOES ON BEFORE ANY ARCHIVE FURNITURE DOES. <== It is
     * what every `html[data-seasons="on"]` rule in `seasons/seasons.css` hangs
     * off, so mounting either pill first would lay it out against the live
     * app's geometry for a frame and then move it. */
    document.documentElement.setAttribute('data-seasons', 'on');
    /* The way out goes on screen in the same breath as the thing it is the way
     * out OF. Anything below here can throw; the catch calls `leave()`, and
     * `leave()` can only tidy up a pill that exists. */
    pill.mount();
    /* ==> THE BOTTOM PILL MOUNTS SILENT AND STAYS SILENT UNTIL IT HAS A FACT.
     * <== It goes up before the board has read a byte, and `setDetail` has
     * never been called, so it is `hidden` — an empty lozenge over the globe
     * would be a control with no label. The board fills it through `onWhere`
     * a moment later. That is not §5 silence: the drawer is open on top of it
     * at that moment, saying in its own words that it is still loading. */
    statusPill.mount();
    /* ==> AND THE CLOCK MOUNTS SILENT TOO, FOR A DIFFERENT REASON. <== Its FAB
     * is `hidden` until storms are actually drawn (§57.67a call 1) and its pill
     * is `hidden` until the reader presses it, so at this moment it is two
     * elements nobody can see. It goes up here rather than on the first tick
     * because the alternative is a control appearing mid-session from a code
     * path that also has to know how to remove it — the pills settled that
     * shape and this follows it. */
    clock.mount();

    currentArchiveGlobe = archiveGlobe || null;
    currentLiveRunningIds = liveRunningIds || null;
    state.unwatchRung = watchRung(drawer);
    /* ==> WHICH DOOR THIS WAS DECIDES WHICH FILTER OPENS, AND IT IS ASKED ON
     * EVERY ENTRY. <== §57.16 calls the home door the BETTER one, because Home
     * already answers what a storm means for this house and the archive answers
     * the same question in the past tense. Step 4 wrote `from` for exactly this
     * and this is where it is finally spent.
     *
     * ==> IT IS NOT A CONSTRUCTION-TIME DEFAULT, WHICH IS THE MISTAKE THIS
     * SHAPE AVOIDS. <== The board is built once and outlives every session, so
     * a filter chosen when it was created would be the filter forever: enter
     * once from the dashboard and every later visit off the storms list would
     * still open on Near home. A reader with no house set gets All anyway —
     * `filtersFor` does not offer a filter there is no home for, and
     * `onSeasonChanging` drops any filter the season does not carry. */
    const board = ensureBoard({ drawer, linkReason });
    board.openFrom(from);
    board.setSeason(state.season);

    /* ==> THE WALL IS THE FIRST SCREEN NOW, AND A YEAR SITS ON TOP OF IT.
     * §57.36, §57.39. <== `go` rather than `push` for the wall: entering the
     * archive is a fresh start, and a history stack reaching back into the
     * live app is a Back button that walks a reader out of a world the palette
     * says they are still in.
     *
     * ==> A DEEP LINK NAMING A YEAR STILL LANDS ON THAT YEAR, WITH THE WALL
     * UNDERNEATH IT. <== `?season=2005` is a link to a season, not to a list
     * of seasons, so making the reader tap through the wall to reach it would
     * break the one thing the parameter is for. Pushing rather than going
     * means their Back button finds the wall — which is where they would have
     * come from had they walked in.
     *
     * The rung record looks after itself from here: `watchRung` below is
     * already listening, so whichever of these two navigations happens is what
     * gets remembered. */
    drawer?.go?.('seasons-wall');
    if (Number.isFinite(state.season)) {
      drawer?.push?.('seasons-board', state.season);
    }

    deepLink.write({ season: state.season, storms: state.storms });
  } catch (e) {
    /* ==> A FAILED ENTRY LEAVES. <== The alternative is a reader looking at a
     * sepia globe with no storms and no pill, and no way back short of a
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
 * The Storms button was pressed while the archive is open. §57.37, §57.38b.
 *
 * ==> IT IS THE WIDE HALF OF WHAT THE BOTTOM PILL DOES ON A PHONE. <== That
 * pill is `display: none` above 720px, exactly as `#storm-pill` is, so without
 * this a desktop reader who minimised the archive's drawer would have no way
 * to get it back. Both roads call the SAME function on the session, so they
 * cannot drift into two different ideas of which rung the reader left.
 *
 * ==> IT TOGGLES RATHER THAN OPENS. <== Aaron on glass, 2026-08-25, about the
 * control this one inherits from: an open-only version is a one-way door, and
 * the reader is then hunting the drawer's header chevron to see the globe
 * again.
 *
 * @returns {boolean} true when the archive handled the press, so `main.js`
 *   knows to leave the live storm list alone. False when there is no session,
 *   which is every ordinary press on the live globe.
 */
export function reopenArchiveDrawer() {
  if (!seasonsOpen() || !session?.toggleDrawer) return false;
  safely(() => session.toggleDrawer());
  return true;
}

/**
 * A tap on the globe chose a storm, or chose open water. §57.21 item 2.
 *
 * ==> THE WAY IN FOR THE ONE THING THE ARCHIVE CANNOT OWN: THE MAP. <== The
 * globe belongs to `main.js` and is injected down as `archiveGlobe`, so a tap
 * on it arrives there and has to come back up. It lands on the BOARD rather
 * than on the globe, because the board holds the focus and the roster has to
 * agree with the map about which storm is bright — a track lighting up while
 * the list looks unchanged is the panel and the map disagreeing, which is the
 * failure `onSelection`'s whole-set contract exists to prevent for ticks.
 *
 * Guarded on the session rather than on the board: the view is registered once
 * and outlives every visit, so a stray call after leaving would otherwise
 * focus a storm on a globe nobody is looking at.
 *
 * @param {string|null} id  a storm id, or null for "all of them evenly"
 */
export function focusSeasonStorm(id) {
  if (!seasonsOpen()) return;
  safely(() => boardView?.setFocus?.(id ?? null));
}

/**
 * Open one storm: its panel, and the globe framed on it.
 *
 * ==> ONE FUNCTION, TWO CALLERS, AND THAT IS THE WHOLE POINT OF HOISTING IT
 * OUT OF THE BOARD'S CALLBACK. <== §57.21d. The roster row's chevron has done
 * this since §57.22b; a tap on a glyph out at the space floor now does the
 * same thing, and Aaron's words for it were "the same as the roster row's
 * chevron". Two copies would be two behaviours the moment either was tuned,
 * and the difference — a camera that flies on one road and not the other —
 * reads as a bug in the globe rather than as a second implementation.
 *
 * `push` rather than `go`: the panel sits ON TOP of the board, so Back is one
 * press and lands the reader on the roster they came from with their scroll
 * position and their ticks intact. `go` would throw that history away and
 * leave Back walking out of the archive entirely.
 *
 * ==> AND THE GLOBE GOES WITH THE PANEL. §57.21c item 4. <== The reader asked
 * to read about one storm; the strip of globe left above the sheet should be
 * showing it rather than whatever ocean they were last looking at.
 *
 * ==> IT HANDS OVER POINTS, NOT THE STORM. <== `seasons/` must never let
 * anything about `map/` leak in, and the reverse holds too: the camera has no
 * business knowing what a season entry looks like. A list of coordinates is
 * the smallest thing that crosses the wall.
 *
 * AFTER the push, so the drawer is up and `archiveOffset()` measures the sheet
 * that is actually going to be there. Measuring first would centre the storm
 * on the whole screen and then let the sheet slide up over it, which is the
 * exact bug the offset exists to prevent.
 *
 * A storm the roster cannot find, or one with no usable fix, simply does not
 * move the camera — the panel still opens and says what it knows.
 */
/**
 * Keep `lastRung` in step with wherever the drawer actually is.
 *
 * ==> ONE LISTENER, AND IT ONLY EVER BELIEVES AN OPEN DRAWER. <== See
 * `lastRung`. A `close` empties the stack, so `currentId()` says null at
 * exactly the moment the memory becomes useful, and a listener without this
 * guard erases it on its way out.
 *
 * @returns {() => void} the unsubscribe, held on the session
 */
function watchRung(drawer) {
  return drawer?.onChange?.(() => {
    if (!drawer.isOpen?.()) return;
    const id = drawer.currentId?.();
    const arg = drawer.currentArg?.();
    if (id === 'seasons-wall') lastRung = { year: null, stormId: null };
    else if (id === 'seasons-board') {
      lastRung = { year: Number.isFinite(arg) ? arg : lastRung.year, stormId: null };
    } else if (id === 'season-detail') lastRung = { ...lastRung, stormId: arg || null };
    /* Any other view is not a rung of this ladder — Layers and Settings both
     * push on top of the archive — so the memory is left alone rather than
     * overwritten with a side trip. */
  }) || (() => {});
}

/**
 * Put the reader back where they were, whole ladder included.
 *
 * ==> THE RUNGS BELOW ARE REBUILT, NOT SKIPPED. <== Landing straight on a
 * storm's panel with an empty history would leave Back walking out of the
 * archive from a screen three deep. So the wall goes down first, then the
 * year, then the storm, and every Back press finds what it would have found
 * had the reader walked in.
 */
function restoreRung(drawer) {
  /* ==> SNAPSHOT FIRST, OR THE RESTORE ERASES WHAT IT IS RESTORING. <== The
   * first line below navigates to the wall, `watchRung` hears it, and "the
   * reader is on the wall" is exactly what it writes down — so by the time the
   * next line read `lastRung.year` it was already null and every restore
   * landed on the top of the wall. Caught by re-running the same Playwright
   * reproduction that found the original fault, which is the only reason it
   * did not ship as the fix for it. */
  const want = { ...lastRung };

  drawer?.go?.('seasons-wall');
  if (!Number.isFinite(want.year)) return;
  boardView?.setSeason?.(want.year);
  drawer?.push?.('seasons-board', want.year);
  /* `openStormNow` rather than a bare push: it also draws the storm and
   * focuses it, and a panel about Katrina over a globe that is not drawing her
   * is the disagreement §57.21a exists to prevent. */
  if (want.stormId) openStormNow(drawer, want.stormId);
}

function openStormNow(drawer, id) {
  drawer?.push?.('season-detail', id);
  const entry = boardView?.currentEntries?.().find((e) => e.storm.id === id);
  if (!entry) return;
  /* ==> A STILL-RUNNING STORM OPENS ITS PANEL AND THE CAMERA STAYS PUT.
   * §57.21c. <== `showStorm` already refuses to tick or focus one, because it
   * is deliberately not on the sepia globe. Flying to it would be the same
   * disagreement in a new place: a several-second flight ending on a patch of
   * empty ocean, with a panel of figures beside it about a storm that is not
   * drawn there. The reader would reasonably read the blank water as a
   * rendering fault rather than as the rule it is. */
  const running = currentLiveRunningIds?.();
  if (running?.has(String(id).toLowerCase())) return;
  currentArchiveGlobe?.flyToStorm?.(entry.storm.points || []);
}

/**
 * A tap on a glyph out at the space floor chose a storm. §57.21d.
 *
 * ==> THE SAME SHAPE AS `focusSeasonStorm` ABOVE AND FOR THE SAME REASON. <==
 * The globe belongs to `main.js` and is injected down, so a tap on it arrives
 * there and has to come back up through this file. It cannot go straight at
 * the drawer, because `seasons/` owns which view a storm opens in.
 *
 * ==> IT NEEDS THE DRAWER, AND THE DRAWER IS THE ONE INJECTED THING THIS FILE
 * DOES NOT KEEP PER-SESSION. <== `currentArchiveGlobe` and
 * `currentLiveRunningIds` are re-pointed on every entry because they are built
 * fresh each time. The drawer is not: `main.js` builds exactly one for the
 * page and hands the same object in every visit, which is why the board can be
 * registered against it once and outlive every session. So this reads it back
 * off the live session rather than holding a fourth module variable that could
 * only ever hold the same value.
 *
 * Guarded on the session, so a stray call after leaving cannot push a panel
 * over the live globe.
 */
export function openSeasonStorm(id) {
  if (!seasonsOpen() || !id) return;
  safely(() => openStormNow(session?.drawer, id));
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
 * touches the globe or the pill itself — it says what changed, and this file
 * decides who needs to know.
 */
/* ==> THE PILL IS READ OFF THE SESSION, NOT CLOSED OVER. <== This function
 * runs ONCE per page load and both views it builds outlive every visit, while
 * `statusPill` is built fresh on each entry. A closure over the parameter would
 * therefore hold visit one's element forever and write every later visit's
 * sentence into a detached node — silently, because `setDetail` on an orphan
 * throws nothing. Same trap `linkNote` is a getter to avoid, found the same
 * way. `drawer` is safe to close over for the opposite reason: main.js builds
 * exactly one for the page. */
function ensureBoard({ drawer, linkReason }) {
  if (boardView) return boardView;

  boardView = createSeasonsBoardView({
    seasons: seasonsData,

    /* ==> BOTH ARE GETTERS, AND `ui/` NEVER IMPORTS `data/`. <== §12. The
     * board is registered once and outlives every session, so a value read
     * here would be a house and a unit system frozen at the moment somebody
     * first opened the archive. `data/home.js` and `data/settings-prefs.js`
     * both answer from storage on every call, so asking at render time is both
     * current and cheap. §57.19. */
    home: () => getHome(),
    system: () => resolveSystem(settingValue('units')),
    /* ==> THE SECOND ROAD, AND IT IS INJECTED SEPARATELY ON PURPOSE. <==
     * §57.30 step 5b. `data/seasons.js` reads a settled year out of a static
     * file in this repo; `data/seasons-live.js` reads the season still
     * running off two KV-backed routes. Handing the board one merged facade
     * would hide which of the two a failure came from, and those two failures
     * want different sentences (§5). */
    live: seasonsLive,

    /* The globe redraws from the WHOLE ticked set on every change, so there is
     * no add path and no remove path to drift apart.
     *
     * ==> IT NOW GOES THROUGH `pushGlobe` RATHER THAN CALLING THE FACADE, AND
     * THE CLOCK IS TOLD FIRST. §57.67 slice C. <== The order is the whole of
     * it: `setEntries` recomputes the timeline over the new set and resets the
     * moment, so asking for a cut before it ran would hand the globe a moment
     * measured against the timeline the reader just changed. §57.67c names that
     * cost explicitly — the span is the ticked storms' own window, so ticking a
     * fifth storm moves both of its ends. */
    onSelection: (selected) => safely(() => {
      currentSelected = Array.isArray(selected) ? selected : [];
      safely(() => session?.clock?.setEntries(currentSelected));
      pushGlobe();
    }),

    /* ==> FOCUS IS A SECOND CALLBACK RATHER THAN A FIELD ON THE FIRST, AND
     * THAT IS ABOUT COST. <== §57.21 item 2. Ticking changes the DATA on the
     * globe — a re-push and a re-tile. Focusing changes one paint property on
     * layers whose data is untouched. Folding focus into `onSelection` would
     * have meant every tap on a track re-pushing a season's worth of geometry
     * to say one storm got brighter, which is the difference between a repaint
     * and a rebuild on the interaction §57.21 calls the most important in the
     * feature. */
    onFocus: (id) => safely(() => currentArchiveGlobe?.setFocus?.(id)),

    /* ==> A BAD LINK'S REASON OUTRANKS THE YEAR. <== A reader who arrived on
     * `?season=1066` needs to know the link was wrong, and that stays true
     * after the board falls back to a season that does exist. Saying
     * `2025 · Atlantic` over the top of it would silently swallow the one
     * message the words exist to carry (§5). */
    onWhere: (where) => safely(() => {
      /* ==> THE ENTRY FLIGHT RIDES ON THIS HOOK BECAUSE IT IS THE FIRST MOMENT
       * THE BASIN IS KNOWN. §57.21c item 5. <== Flying at `openSeasons` time
       * would mean flying before the index has been read, when the season and
       * its basin are both still null — so the storm-list door could only ever
       * have gone to a default. It is deliberately OUTSIDE the bad-link guard
       * below: a reader sent a broken `?season=` still gets a camera pointed
       * somewhere sensible while the wall tells them the link was wrong.
       *
       * The once-flag is not an optimisation. `onWhere` fires on every tick,
       * every filter change and every focus, and without it the globe would
       * fly back to the basin each time somebody ticked a storm — including
       * straight after `flyToStorm` had just framed one. */
      if (where && !session?.flownIn && session) {
        session.flownIn = true;
        currentArchiveGlobe?.flyToEntry?.({ from: session.from, basin: where.basin });
      }
      /* ==> A STEP TO A NEIGHBOURING YEAR HAS TO REACH THE DRAWER'S HEADING.
       * <== Rung 3 is titled with the year (§57.39) and the drawer builds that
       * from the navigation argument, so a `+`/`−` press inside the board would
       * otherwise leave `2005` over 2006's roster. Re-pushing the same view id
       * replaces the top of the stack rather than growing it, so Back still
       * finds the wall and one press still gets there.
       *
       * Guarded on the board being the current view: `onWhere` also fires from
       * a re-render underneath an open storm panel, and navigating out of that
       * panel because a repaint happened would close a screen the reader is
       * reading. */
      if (Number.isFinite(where?.year)
        && drawer?.currentId?.() === 'seasons-board'
        && drawer?.currentArg?.() !== where.year) {
        drawer.push('seasons-board', where.year);
      }

      /* ==> THE BAD-LINK GUARD THAT USED TO SIT HERE IS GONE, AND STEP 5 IS
       * WHY. <== It existed because the bar showed one sentence at a time, so
       * `2025 · Atlantic` would have painted over `That year is not in the
       * record` and swallowed the one message the words exist to carry (§5).
       * The two facts now live on two elements — the note on the wall, the
       * count on this pill — so they no longer compete and the reader gets
       * both. Suppressing the count here would now be hiding a true thing for
       * no reason.
       *
       * ==> THE BOARD REPORTS FACTS AND THE PILL OWNS THE WORDS. §57.21b item
       * 8. <== `pillDetail` is a pure function in `seasons/status-pill.js`, so
       * the sentence lives beside the element that shows it and can be driven
       * by a suite without a DOM. This file stays what it was: the place that
       * decides WHO needs to know, never what they are told. */
      session?.statusPill?.setDetail(pillDetail(where));
    }),

    /* ==> A ROW'S CHEVRON OPENS THE STORM'S PANEL. §57.22b. <== `push` rather
     * than `go`: the panel sits ON TOP of the board, so Back is one press and
     * lands the reader on the roster they came from with their scroll position
     * and their ticks intact. `go` would throw that history away and leave
     * Back walking out of the archive entirely. */
    onOpenStorm: (id) => safely(() => {
      openStormNow(drawer, id);
    }),

    /* ==> THE ONE QUESTION THE ARCHIVE HAS TO ASK THE LIVE APP. §57.21c. <==
     * Which storms are still happening, so the roster can say `– active` and
     * the globe can leave them off. It is main.js's answer because main.js
     * holds the live storm list, and it arrives as a function so the board can
     * ask at paint time rather than holding a copy that goes stale while
     * somebody reads. Null when the feed has never resolved, which the board
     * treats as "cannot ask" rather than "nothing is running". */
    liveRunningIds: () => currentLiveRunningIds?.() ?? null,
  });

  /* ==> AND IT HAS TO BE HANDED TO THE DRAWER, WHICH IS THE STEP THAT WAS
   * MISSING. <== Building the view is not the same as registering it:
   * `drawer.go('seasons-board')` navigates to an id the drawer knows, and
   * without this it knows nothing by that name. `tools/test-archive-mode.mjs`
   * caught it — the entry path ran clean and the board would never have been
   * on screen. */
  drawer?.register?.(boardView);

  /* ==> AND IT IS HANDED THE DRAWER'S OWN HEADER REDRAW. §57.39a. <== The
   * board's heading names the BASIN, and on the frame the view is entered the
   * index has not landed, so there is no basin to name yet and the header
   * falls back to `Past storms`. Without this it stayed on that fallback until
   * something re-pushed the view — pressing `+` did, so the header caught up
   * only if the reader happened to change year. Aaron on glass, 2026-08-28.
   *
   * The board only calls it when the answer actually changes, which is once a
   * visit; see the note beside `render` in `ui/view-seasons-board.js` for why
   * that guard is what makes it safe to put on the render path at all. */
  boardView.setChromeRefresh?.(() => drawer?.refreshChrome?.());

  /* ==> THE WALL IS REGISTERED IN THE SAME BREATH, AND THE ORDER OF THESE TWO
   * DOES NOT MATTER BUT THEIR PRESENCE DOES. <== A wall the drawer knows with
   * no board behind it is a screen full of year rows that open nothing, and
   * `drawer.push` fails silently rather than throwing — the exact fault the
   * comment above records the board itself having. Registering all three rungs
   * at one call site means there is one place to forget instead of three. */
  wallView = createSeasonsWallView({
    seasons: seasonsData,

    /* ==> THE BAD LINK'S REASON LANDS HERE NOW, AND STEP 5 IS WHY. <== It was
     * the archive bar's, and the bar is deleted. Its replacement
     * (`seasons/status-pill.js`) sits UNDER the drawer so it costs the globe
     * no layout — which is the whole win — but that means it is covered at the
     * exact moment a bad link matters, because entering opens the drawer on
     * this wall. So the sentence goes on the screen the reader is actually
     * looking at.
     *
     * ==> A GETTER, FOR THE REASON `home` AND `system` ARE GETTERS. <== The
     * wall is registered ONCE per page load and outlives every visit, so a
     * plain string here would be the note from whichever visit happened to be
     * first — arrive on a bad link, leave, come back clean, and the wall would
     * still be apologising about a link from ten minutes ago. Reading it off
     * the live session means it is true for the visit on screen and empty when
     * there is no visit at all. */
    linkNote: () => detailFor(session?.linkReason ?? 'absent'),

    /* ==> THE SEASON IN PROGRESS IS NOT IN `seasons/wall.json` AND CANNOT BE.
     * <== It comes out of HURDAT2, NOAA's reviewed record, which does not hold
     * the current year until the following spring (§57.11). Without this the
     * wall's newest row would be last year and the season actually happening
     * would be unreachable — the regression that removing the year dropdown
     * created. Separate from `seasons` for the reason the board records: two
     * different sources, two different failures, two different sentences. */
    live: seasonsLive,

    /* Which storms are still running, so the pinned row draws the finished
     * ones and COUNTS the rest instead of drawing them. §57.21c — the same
     * rule that keeps a running storm off the sepia globe. */
    liveRunningIds: () => currentLiveRunningIds?.() ?? null,

    /* ==> A YEAR ROW `push`es THE BOARD, IT DOES NOT `go` TO IT. §57.39. <==
     * The board's Back has to land on the wall the reader tapped from, with
     * their scroll position intact. `go` throws the stack away and leaves Back
     * walking straight out of the archive. */
    onOpenYear: (year, basin) => safely(() => {
      /* Basin first: `setSeason` only holds a number, and a board still on the
       * Atlantic would load the Atlantic's copy of the year the reader tapped
       * on the Pacific wall — the same four digits, the wrong storms, and
       * nothing on screen saying so. */
      boardView?.setBasin?.(basin);
      boardView?.setSeason?.(year);
      /* The year rides along as the navigation argument as well as through
       * `setSeason`, because the drawer builds its heading from the argument
       * before the view renders. Without it the header would read `Past
       * storms` for one frame and then the year. */
      drawer?.push?.('seasons-board', year);
    }),

    /* ==> THE ENTRY FLIGHT MOVED HERE WITH THE FRONT DOOR. §57.21c item 5. <==
     * It used to ride on the board's `onWhere`, because the board was the
     * first screen that knew which basin was open. The wall is that screen
     * now, and the board no longer loads a season until a year is tapped — so
     * leaving the flight where it was would have meant a reader entering the
     * archive and getting no camera move at all until they picked a year.
     *
     * `session.flownIn` is the same once-flag as before and is deliberately
     * shared with the board's copy: whichever of the two speaks first flies,
     * and the other one does not fly again. */
    onWhere: (where) => safely(() => {
      if (where && session && !session.flownIn) {
        session.flownIn = true;
        currentArchiveGlobe?.flyToEntry?.({ from: session.from, basin: where.basin });
      }
      /* ==> THE WALL FEEDS THE PILL TOO, AND LEAVING IT OUT WAS A REAL HOLE.
       * <== Glass, 2026-08-28. Step 5 wired only the BOARD's report, so the
       * pill was empty for the whole of the archive's first screen — which is
       * the screen every visit starts on. `rung` is what tells the two apart:
       * the board knows how many storms are drawn, the wall draws none. */
      session?.statusPill?.setDetail(
        pillDetail(where ? { ...where, rung: 'wall' } : null));
    }),
  });
  drawer?.register?.(wallView);

  /* ==> THE DETAIL PANEL IS REGISTERED AT THE SAME MOMENT, NOT ON FIRST OPEN.
   * <== A view the drawer does not know is a `push` that silently does
   * nothing, which is the exact fault the comment above records the board
   * having. Registering both together means there is one place to forget, not
   * two. It is still a dynamic import away from the boot path — this whole
   * file is (§57.35 fault 4) — so a reader who never opens the archive never
   * downloads it.
   *
   * ==> IT IS HANDED A FUNCTION, NOT THE STORMS. <== The board reloads its
   * entries on every year change, and a captured array would leave the panel
   * describing last year's storm under this year's heading. */
  detailView = createSeasonDetailView({
    entries: () => boardView?.currentEntries?.() || [],
    /* ==> THE TABLE AND ITS BASIN, RESOLVED AT CALL TIME LIKE EVERYTHING ELSE
     * HERE. <== §57.44. The board reloads on a basin change as well as a year
     * change, and a captured table would go on ranking against the basin the
     * reader has left. */
    archive: () => boardView?.currentArchive?.() || { table: null, basin: null },
    loadReport: reportFor,
    /* ==> RESOLVED AT CALL TIME, NOT CAPTURED. <== `app/views.js` does exactly
     * this and the reason is the same: a stored preference of `auto` has to go
     * on following the device, and a reader who changes units in Settings and
     * comes back must see the new ones without the archive being re-entered. */
    units: () => resolveSystem(settingValue('units')),
    /* ==> OPENING A STORM DRAWS IT AND FOCUSES IT, AND THAT IS ONE CALL
     * BECAUSE IT HAS TO BE ONE RULE. <== §57.21a says the roster and the globe
     * must never disagree about which storm is the subject; a panel about
     * Katrina over a globe with Rita bright — or with nothing on it at all —
     * is the same lie in a new place. `showStorm` ticks the storm if it is not
     * already drawn, which `setFocus` alone cannot do: it refuses an id nobody
     * has ticked, on purpose. */
    onOpen: (id) => safely(() => boardView?.showStorm?.(id)),
  });
  drawer?.register?.(detailView);

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
