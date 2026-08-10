/**
 * replay-mode.js — one answer to "is this page a replay?".
 *
 * ==> IT READS THE URL, NOT THE RELAY GLOBAL, AND THAT IS THE WHOLE POINT. <==
 *
 * `replay/boot.js` sets `globalThis.__LANDFALL_RELAY_BASE__`, but it sets it
 * AFTER an `await` — it has to fetch the archive index before it knows which
 * advisory to point at. Module bodies elsewhere in the app run during that
 * await. Anything that has to know at module-init time therefore cannot ask
 * the global; it would get `undefined` and quietly decide it was not a replay.
 * `data/lifecycle.js` is exactly that case: it loads its store the instant it
 * is imported. `?replay=` is in the URL before a single byte of script runs,
 * so it is the only test that cannot race.
 *
 * WHY THIS EXISTS AT ALL. The replay is the real app on real archived bytes,
 * which is its strength and also its one hazard: anything the app WRITES
 * during a replay is written for real. On 2026-08-10 Hurricane Ida turned up
 * as a grey ended storm on the live app, days after the replay was last run,
 * because the ended-storm store had saved her exactly as designed and had no
 * idea the storm was five years old. A replay must be able to exercise a
 * write path without leaving 2021 behind on the device.
 *
 * Imports nothing. Safe where there is no `location` at all — the test suites
 * run these modules in Node.
 */

/** True when this page was opened as a replay (`?replay=…`). */
export function isReplay() {
  try {
    if (typeof location === 'undefined' || !location.search) return false;
    return new URLSearchParams(location.search).has('replay');
  } catch {
    return false;
  }
}

/**
 * A storage key, moved aside when this page is a replay.
 *
 * The replay gets its own key rather than no key at all, deliberately: a
 * replay that skips persistence entirely stops testing the persistence, and
 * the save/load path is half of what the ended-storm feature IS. Its data is
 * sandboxed, not suppressed.
 */
export function scopedKey(key) {
  return isReplay() ? `${key}.replay` : key;
}
