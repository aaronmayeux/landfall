/**
 * population.js — THE TOWN LIST, FETCHED ONCE, SHARED BY TWO READERS.
 *
 * The heat layer (map/population.js) and the storm drawer's headcount both
 * want the same 107,464 towns. This is the only thing that fetches them.
 *
 * ==> IT IS LAZY AND IT IS SHARED, AND BOTH HALVES MATTER. <== Lazy, because
 * 670 KB gzipped on the critical path competes with the cone for a phone
 * connection during a hurricane, and the layer ships off. Shared, because
 * without a single in-flight promise the obvious sequence — switch the layer
 * on, tap a storm — fires two requests for the same megabyte before the first
 * has landed. That is the exact bug `fetchFrameOnce` was added to imagery for
 * (Phase 7): a store that can answer "have we got it" but not "is it already
 * on the wire".
 *
 * THREE STATES, NOT TWO (SPEC.md §5). A failed fetch and an empty result must
 * never look alike, and here they genuinely cannot be confused: this file is
 * static and shipped, so `ok` is the only success and anything else is
 * `unavailable`. There is no `none` — a town list with nothing in it would be
 * a broken build, not a real answer, and `expectedTowns` exists to catch it.
 *
 * Imports: config/constants.js only. No map, no DOM.
 */

import { POPULATION } from '../config/constants.js';

/** The parsed flat array, once we have it. */
let towns = null;

/** The in-flight request, so a second caller joins rather than starting one. */
let pending = null;

/** Why it failed, if it did. Cleared on a retry so a recovered network can
 *  actually recover — a permanently sticky failure is how a transient blip
 *  turns into a feature that is off until the app is reloaded. */
let failure = null;

/**
 * What the loader currently knows, without asking it to do anything.
 * Synchronous, so a render pass can decide what to draw without awaiting.
 *
 * @returns {'idle'|'loading'|'ok'|'unavailable'}
 */
export function populationState() {
  if (towns) return 'ok';
  if (pending) return 'loading';
  if (failure) return 'unavailable';
  return 'idle';
}

/** The towns, or null if we do not have them. Never throws. */
export function townsOrNull() {
  return towns;
}

/**
 * Fetch the town list, or hand back the one we already have.
 *
 * Resolves to the flat array on success and to `null` on failure — it does
 * NOT reject. A caller that forgets a `.catch` on a resource this optional
 * would otherwise turn a missing decoration into an unhandled rejection in
 * the console of somebody watching a hurricane.
 *
 * @param {() => void} [onSettle] Called after the state changes, so a view
 *        that rendered `loading` knows to render again. Called on both
 *        success and failure — a spinner that never resolves is worse than
 *        an error message.
 */
export function loadTowns(onSettle) {
  if (towns) return Promise.resolve(towns);
  if (pending) return pending;

  /* A retry clears the old failure BEFORE the request, not after it. If it is
   * cleared on success only, `populationState()` reports `unavailable` for the
   * whole duration of the retry and a view refreshing mid-flight paints the
   * error it is in the middle of recovering from. */
  failure = null;

  pending = fetch(POPULATION.url, { cache: 'force-cache' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((flat) => {
      if (!Array.isArray(flat) || flat.length % 3 !== 0 || flat.length < 3) {
        throw new Error('malformed town list');
      }
      /* ==> A TRUNCATED FILE PARSES FINE AND LIES QUIETLY. <== A JSON array cut
       * short is still valid JSON if it happens to end after a complete triple,
       * and the headcount it produces looks entirely reasonable — just too
       * small, in a way nobody can see. Checked against the known count rather
       * than trusted. */
      const count = flat.length / 3;
      if (count !== POPULATION.expectedTowns) {
        throw new Error(`town count ${count}, expected ${POPULATION.expectedTowns}`);
      }
      towns = flat;
      pending = null;
      if (onSettle) onSettle();
      return towns;
    })
    .catch((err) => {
      failure = err;
      pending = null;
      if (onSettle) onSettle();
      return null;
    });

  return pending;
}
