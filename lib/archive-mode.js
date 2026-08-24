/**
 * archive-mode.js — is the app showing HISTORY right now?
 *
 * ==> ONE FLAG, AND IT EXISTS SO THE ANSWER CANNOT BE TWO DIFFERENT ANSWERS.
 * <== Seasons (SPEC-SEASONS-BUILD.md §57) swaps the globe out from under the
 * live app: a forced palette, a bar along the bottom, and no live storms. Half
 * a dozen surfaces have to know, and each one asking a different object — the
 * shell, a URL parameter, a DOM attribute — is how three of them end up
 * disagreeing on the way OUT, which is the direction nobody tests.
 *
 * ==> AND IT IS THE THING §57.2 IS ABOUT. <== On 2026-08-10 Hurricane Ida
 * appeared as a grey ended storm on the LIVE app, days after a replay, because
 * the ended-storm store saved her exactly as designed and had no idea the
 * storm was five years old. `lib/replay-mode.js` was written for that. Seasons
 * touches the same write paths with 175 years of storms behind it, so the same
 * wall goes up before there is anything to push through it — `data/lifecycle.js`
 * refuses to persist while this is on. Building the wall AFTER the data exists
 * means building it in the same pass that would prove it was needed.
 *
 * WHY THIS IS NOT `lib/replay-mode.js` WITH A SECOND FUNCTION. A replay is
 * decided by the URL before a single byte of script runs, so that file can be
 * a pure read of `location.search` with no state in it at all. Seasons is
 * ENTERED, at any moment, from a button — it has to be a flag somebody sets,
 * and mixing a settable flag into a file whose whole documented value is
 * being unsettable would make both harder to trust.
 *
 * Imports nothing, holds no DOM, and is safe in Node — the suites import it
 * directly.
 */

/** True while Seasons owns the screen. */
let on = false;

/** Notified on every real change. A Set, so a double-subscribe is one entry. */
const listeners = new Set();

/** Is the app showing history right now? */
export function isArchive() {
  return on;
}

/**
 * Enter or leave archive mode. Returns true if the flag actually moved.
 *
 * ==> ONLY `seasons/index.js` MAY CALL THIS. <== It is exported rather than
 * hidden because a module cannot restrict its own callers, but a second caller
 * is the bug: the flag is what the exit path is written against, and a surface
 * that flips it without also releasing the palette and putting the storms back
 * leaves the app in a state with no way out of it except a reload.
 *
 * Idempotent on purpose. A leave path runs on error routes too, and a
 * double-leave that threw would be a way to strand somebody in the archive.
 */
export function setArchive(next) {
  const want = !!next;
  if (want === on) return false;
  on = want;
  for (const fn of listeners) {
    try {
      fn(on);
    } catch (e) {
      /* One bad subscriber must not stop the others. A half-entered archive —
       * sepia sky, live storms still on it — is worse than a failed entry,
       * which is the same contract config/theme.js keeps for the palette. */
      console.warn('[landfall] archive subscriber failed:', e);
    }
  }
  return true;
}

/** Subscribe to entering and leaving. Returns an unsubscribe.
 *
 *  DOES NOT FIRE ON REGISTRATION. Everything that subscribes is already
 *  looking at the live app, which is what `false` means. */
export function subscribeArchive(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Reset, for the suites only. Module state outlives an `import`, so a suite
 *  that entered archive mode in one section would otherwise poison the next. */
export function _resetArchiveMode() {
  on = false;
  listeners.clear();
}
