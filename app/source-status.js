/**
 * source-status.js — the two judgements the store subscription makes about
 * feed health, out where they can be tested.
 *
 * The subscription itself STAYS in main.js. It is a fan-out to ten modules,
 * and a fan-out is wiring — which is what §12 says that file is for. What
 * moved here is the part that decides something.
 *
 * Imports: nothing. Both functions are plain data in, an answer out.
 */

/* ---------------------------------------------------------------------------
 * THE DATA MILESTONE
 * ------------------------------------------------------------------------- */

/**
 * Has ANY source finished its first fetch, whatever it resolved to?
 *
 * ==> AN EMPTY BASIN IS A REAL AND FAST ANSWER. <==
 * This is the `data` half of the pair of milestones that split the blame for a
 * slow load: globe -> data is the network and upstream, data -> storms is
 * ours. Testing for storms instead of for a resolved source would make a
 * healthy quiet day — every feed answering promptly with nothing in it — look
 * identical to a hang, which is the same §5 confusion the status strip exists
 * to prevent, arriving through the telemetry instead of the screen.
 *
 * `loading` is the only status that means "still waiting". `clear`,
 * `unavailable` and `ok` are all answers.
 */
export function anySourceResolved(sources) {
  if (!sources) return false;
  return Object.values(sources).some((s) => s?.status && s.status !== 'loading');
}

/* ---------------------------------------------------------------------------
 * TRANSITION REPORTING
 * ------------------------------------------------------------------------- */

/**
 * Report a source CHANGING state, never its current state (§17 A5).
 *
 * ==> THE TRANSITION IS THE EVENT; THE STEADY STATE IS NOT NEWS. <==
 * The store fires on every poll, so reporting unconditionally would send "nhc
 * is still down" every five minutes and bury the moment it broke under a
 * hundred copies of itself. It would also burn D1's write budget on a fact
 * nobody can act on — see the telemetry note's rule that anything which can
 * happen more than once gets stored as an aggregate.
 *
 * SEEDED EMPTY, deliberately. The store's fire-on-subscribe delivers the boot
 * state, so `loading` -> `ok` on first load counts as a real transition and is
 * worth exactly one event: it is the cheapest possible confirmation that the
 * app works at all for somebody who is not Aaron.
 *
 * A MISSING STATUS IS NOT A TRANSITION. A source that arrives without one has
 * told us nothing, and recording it as a change would both send a junk event
 * and — worse — overwrite the last real status, so the genuine recovery that
 * follows would look like no change at all and never be reported.
 *
 * @param {(name: string, status: string, error?: string) => void} report
 */
export function createSourceReporter(report) {
  const last = Object.create(null);

  return {
    /** @param {object} sources  the store's per-source map */
    update(sources) {
      if (!sources) return;
      for (const [name, src] of Object.entries(sources)) {
        const status = src?.status;
        if (!status || last[name] === status) continue;
        last[name] = status;
        report(name, status, src?.error);
      }
    },

    /** What each source was last reported as. For tests and the console seam. */
    value: () => ({ ...last }),
  };
}
