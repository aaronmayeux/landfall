/**
 * usage.js — what people actually did. SPEC §17 A5.
 *
 * ==> THE PROBLEM IT SOLVES <==
 * 386 people opened Landfall on 2026-07-27 and there was no way to find out
 * whether a single one of them tapped a storm. Every feature in this app was
 * built on an assumption about what someone would reach for, and every one of
 * those assumptions was untested. A feature nobody opens is not a feature, it
 * is maintenance — and the only way to tell the difference is to count.
 *
 * ==> COUNTS. NOT EVENTS, NOT A SEQUENCE, NOT A SESSION RECORDING. <==
 * This module stores one integer per action name and nothing else. No order,
 * no timestamps, no arguments — not which storm, not which layer, not where
 * on the globe. "Storms selected: 3" is the entire record.
 *
 * That is a privacy decision before it is a storage one. A sequence of
 * actions with times attached is a behavioural fingerprint and it is exactly
 * the kind of thing lib/telemetry.js's contract exists to keep out. Integers
 * cannot be replayed. If a future question needs ordering, that is a
 * conversation to have deliberately, not a field to add quietly.
 *
 * It is also what keeps this affordable: a tap-happy user is one row with
 * bigger numbers, never more rows. See lib/perf.js on the same rule.
 *
 * ==> THE NAME LIST IS AN ALLOWLIST, AND THAT IS THE ENFORCEMENT. <==
 * `count()` ignores anything not in ACTIONS. A typo produces no column rather
 * than a new one, and a caller cannot invent a field by passing a string.
 *
 * Imports: nothing. Wired by main.js; safe to call from anywhere, including
 * inside a click handler, because it does one map lookup and one addition.
 */

/**
 * Every action that can be counted. ADD HERE FIRST, then call it.
 *
 * Keys are short because they become database columns. Keep them stable —
 * renaming one silently splits its history in two.
 */
export const ACTIONS = Object.freeze([
  /* The core loop: did anyone actually open a storm? */
  'storm_select',
  /* Reading the advisory text — the deepest engagement the app offers. */
  'advisory_open',
  /* Layers: the biggest surface in the app and the least validated. */
  'layer_toggle',
  'layer_pair',
  'layer_reset',
  'model_toggle',
  /* Navigation gestures, as a proxy for "did they explore or just look". */
  'recenter',
  /* Home: the one piece of personal setup the app asks for. Counting that it
   * happened, NEVER what was set — see lib/telemetry.js. */
  'home_set',
  /* A retry after a failure: a user who saw something break and cared enough
   * to try again. */
  'retry',
]);

/** Ceiling per action. A render-loop bug that calls count() every frame must
 *  not turn into an absurd number that skews every average; past this the
 *  count simply stops climbing and the value reads as "lots". */
const MAX_PER_ACTION = 9999;

const counts = new Map();

/**
 * Count one action.
 *
 * Never throws, never allocates beyond a map entry, and does no DOM work — it
 * is called from inside input handlers and must not be the reason a tap feels
 * slow. An unknown name is dropped silently: there is nothing useful to do
 * about it at runtime and a console warning inside a click handler is its own
 * small performance bug.
 *
 * @param {string} name One of ACTIONS.
 */
export function count(name) {
  try {
    if (!ACTIONS.includes(name)) return;
    const current = counts.get(name) || 0;
    if (current >= MAX_PER_ACTION) return;
    counts.set(name, current + 1);
  } catch {
    /* diagnostics never break the thing they are diagnosing */
  }
}

/**
 * Every action as a flat object, zeros included.
 *
 * ==> ZEROS ARE THE POINT. <==
 * The interesting answer is almost always a zero. "Nobody opened Layers" is
 * the finding worth having, and it only exists if the column is written. An
 * omitted key would be indistinguishable from a session that never reported.
 *
 * @returns {Record<string, number>}
 */
export function snapshot() {
  try {
    const out = {};
    for (const name of ACTIONS) out[name] = counts.get(name) || 0;
    return out;
  } catch {
    return {};
  }
}
