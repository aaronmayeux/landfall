/**
 * store.js — the one place storm state lives (SPEC §4).
 *
 * Holds the merged storm list AND per-source health, because an empty list
 * means nothing on its own — the UI reads `sources` to decide between "quiet
 * ocean" and "we can't see half the planet" (SPEC §5).
 *
 * Also owns the poll loop: both sources fetched in parallel every 30 minutes,
 * only while the page is visible, refetch-on-return. Each source updates its
 * own slot — one timing out never delays or blanks the other.
 *
 * On a source failure the store KEEPS that source's last-good storms, flagged
 * by the source status. Content is never replaced by an error (SPEC §4);
 * stale + timestamp beats blank, always.
 *
 * store.js never imports map/ or ui/ — they subscribe to it. That is what
 * keeps the import arrow pointing one way (SPEC §12).
 *
 * Imports: config/, lib/, data/ siblings.
 */

import { POLL } from '../config/constants.js';
import { fetchNhcStorms } from './nhc.js';
import { fetchGdacsStorms } from './gdacs.js';
import { mergeWithEnded } from './merge.js';
import {
  observeSource,
  observeDeclarations,
  endedStorms,
  onLifecycleChange,
} from './lifecycle.js';

const state = {
  /** Normalized, merged, NHC-wins, canonically sorted. */
  storms: [],
  sources: {
    /* `slow` is the middle rung: loading, and it has been loading long enough
     * to say so. See armSlowTimer below. */
    nhc: { status: 'loading', fetchedAt: null, error: null, slow: false },
    gdacs: { status: 'loading', fetchedAt: null, error: null, slow: false },
  },
};

/** Last clean list per source — what the merge uses when that source errors. */
const lastGood = { nhc: [], gdacs: [] };

const listeners = new Set();

export function getState() {
  return state;
}

/** Subscribe to changes. Fires immediately with current state (a subscriber
 *  arriving after the first poll must not wait 30 min to learn about it). */
export function subscribe(cb) {
  listeners.add(cb);
  cb(state);
  return () => listeners.delete(cb);
}

/**
 * ENDED STORMS ARE UNIONED IN AT MERGE TIME, NOT HELD IN `lastGood`.
 *
 * They cannot live in `lastGood` — that is each source's last CLEAN list, and an
 * ended storm's defining property is that it is not in any clean list. Putting
 * one there would make the next poll delete it again, which is the bug this
 * whole pass exists to fix.
 *
 * The dedupe and the basin rule live in data/merge.js, which already owns both.
 */
function emit() {
  state.storms = mergeWithEnded(lastGood.nhc, lastGood.gdacs, endedStorms());
  for (const cb of listeners) cb(state);
}

/* A storm ending has to reach the UI on the poll it happens, and the DECLARED
 * path is asynchronous — it reads advisory text, so it can land well after the
 * store has already emitted for that poll. Without this the badge and the grey
 * dot would wait for the next 30-minute tick. */
onLifecycleChange(() => emit());

/**
 * Overall condition for surfaces that need ONE answer (the 3D cage, the empty
 * state). The three-state vocabulary of SPEC §5:
 *   'loading'      nothing has resolved yet
 *   'unavailable'  a source is down AND we can't honestly say the ocean is
 *                  clear (no storms visible ≠ no storms)
 *   'ok'           storms on screen (even if one source is down — partial
 *                  data is shown and the outage is named separately)
 *   'clear'        every source clean, zero storms. The only true all-clear.
 */
export function overallStatus(s = state) {
  const st = [s.sources.nhc.status, s.sources.gdacs.status];
  if (st.every((x) => x === 'loading')) return 'loading';
  if (s.storms.length > 0) return 'ok';
  if (st.every((x) => x === 'ok')) return 'clear';
  return 'unavailable';
}

/* ==> THE MIDDLE RUNG BETWEEN "CHECKING" AND "GAVE UP". <==
 *
 * `POLL.retryBackoff` is 5 + 15 + 45 seconds, and `pollSource` publishes
 * nothing until the whole ladder is exhausted. Measured with the network cut
 * (`tools/offline-check.mjs`): SIXTY-EIGHT SECONDS of a globe with no storms
 * and no explanation, on a phone that knew the first attempt had failed
 * instantly. Silence for a minute is not meaningfully better than silence
 * forever — it just runs out the clock on the person's patience instead of
 * ours, and it is very likely why the retry button has never been pressed by a
 * real user: the button arrives after they have gone.
 *
 * `POLL.errorDelayWhenEmpty` was written for exactly this and had never been
 * read by any code. Its comment — "feedback is needed fast or it reads as
 * broken" — is the whole design.
 *
 * WHY A TIMER AND NOT A SIGNAL FROM THE FETCH. Threading "an attempt failed"
 * up from `data/relay.js` would mean a callback through every fetcher, and it
 * would answer a NARROWER question than the one being asked. What matters to
 * someone looking at an empty screen is not which internal attempt failed; it
 * is that two seconds have passed and nothing has appeared. A dead network and
 * a very slow one both earn the same honest sentence, and the timer covers
 * both without knowing the difference.
 *
 * ONLY WHEN THE SCREEN IS EMPTY. With storms already drawn there is nothing
 * urgent to say — the app is working and the numbers are simply a moment old,
 * which is what the delayed banner is for.
 *
 * `slow` NEVER OUTLIVES ITS POLL. It is cleared on the way out of `pollSource`
 * whichever way that goes, so it cannot get stuck the way the basemap message
 * did (SPEC-UI §16).
 */
function armSlowTimer(source) {
  if (lastGood[source]?.length) return null;
  return setTimeout(() => {
    if (state.sources[source].status !== 'loading') return;
    state.sources[source].slow = true;
    emit();
  }, POLL.errorDelayWhenEmpty);
}

async function pollSource(source, fetcher) {
  const slowTimer = armSlowTimer(source);
  try {
    const { storms, fetchedAt, relayStale } = await fetcher();
    lastGood[source] = storms;

    /* ==> THE LIFECYCLE HOOKS LIVE IN THE SUCCESS BRANCH, AND ONLY HERE. <==
     *
     * This placement IS the "a bad connection must never kill a storm" rule.
     * `observeSource` counts a poll as evidence that a storm is gone, so it must
     * be unreachable from the catch below — not guarded by a flag inside it,
     * which a later refactor could pass wrong, but structurally absent from the
     * failure path. The absence of the call is the "no votes" case.
     *
     * `observeDeclarations` is NOT awaited on purpose. It reads advisory text —
     * a round trip per NHC storm — and storms must draw on the poll they arrive
     * rather than behind a text fetch. It emits through `onLifecycleChange` when
     * it finds an ending, so nothing waits and nothing is lost. Its rejections
     * are swallowed because a final-advisory read that failed is not evidence of
     * anything, and an unhandled rejection in a poll loop is noise in the
     * console during exactly the outage someone is trying to diagnose. */
    observeSource(source, storms);
    observeDeclarations(storms).catch(() => {});

    state.sources[source] = {
      /* The relay serving ITS last-good means upstream is down even though
       * our fetch succeeded — honest status is stale-ok, not fresh-ok. */
      status: 'ok',
      fetchedAt,
      error: null,
      relayStale: !!relayStale,
      slow: false,
    };
  } catch (e) {
    state.sources[source] = {
      status: 'unavailable',
      /* fetchedAt keeps its previous value's meaning via lastGood age — but
       * the slot itself records when we last SUCCEEDED, so keep the old one. */
      fetchedAt: state.sources[source].fetchedAt,
      error: e?.message || 'failed',
      relayStale: false,
      /* The outage message supersedes the slow one. Both true at once would be
       * two answers to one question. */
      slow: false,
    };
  } finally {
    /* Whichever way the poll went, the timer must not fire behind it and put
     * `slow` back on a slot that has already resolved. */
    if (slowTimer) clearTimeout(slowTimer);
  }
  emit();
}

let timer = null;

/**
 * Fetch both sources. UNCONDITIONAL — no visibility check lives here, and that
 * is the whole point of this function's shape.
 *
 * IT USED TO CHECK `document.hidden` AND RETURN EARLY, AND THAT SWALLOWED THE
 * FIRST LOAD. `startPolling()` calls this once immediately, so a page that
 * began life hidden — a background tab from a cmd-click, a speculative
 * prerender, a PWA still behind its splash — fetched NOTHING, left both source
 * slots on `loading` forever, and sat on "Checking the oceans…" with no error
 * to show for it. The app only ever recovered because a SEPARATE
 * `visibilitychange` listener happened to fetch on the way back in.
 *
 * That is the trap: the first load was load-bearing on a listener that reads
 * like an optimization. Anyone deleting or refactoring `onVisible` for good
 * reasons would have silently removed the app's only path to its first fetch,
 * and the symptom — a permanent, error-free "Checking the oceans…" — looks
 * exactly like a dead feed rather than like a bug in the poll loop. It cost a
 * misdiagnosis on 2026-07-26 before the cause was found.
 *
 * The battery rule the check was there for is real, but it is about the TIMER,
 * not about loading: don't spend a cell radio re-fetching every 30 minutes for
 * a tab nobody is looking at. So the check moved to `tick()`, which is the only
 * caller that fires unattended. Every deliberate call — first load, return to
 * the tab, the Retry button — always fetches.
 */
async function pollAll() {
  /* Parallel and independent — each source emits as it lands, so NHC storms
   * draw while GDACS is still timing out (SPEC §4 reason #3). */
  await Promise.allSettled([
    pollSource('nhc', fetchNhcStorms),
    pollSource('gdacs', fetchGdacsStorms),
  ]);
}

/** The unattended tick, and THE ONLY PLACE THE VISIBILITY RULE BELONGS. A
 *  hidden tab skips its scheduled fetch to save battery; `onVisible` catches it
 *  up the moment anyone looks. Skipping here is free because nothing is on
 *  screen to be wrong — skipping the FIRST load was not. */
function tick() {
  if (typeof document !== 'undefined' && document.hidden) return;
  pollAll();
}

/** Starts the 30-minute poll loop. Idempotent. Returns a stop function. */
export function startPolling() {
  if (timer) return stopPolling;
  pollAll(); // first load, always — never gated on visibility (see above)
  timer = setInterval(tick, POLL.storms);
  document.addEventListener('visibilitychange', onVisible);
  return stopPolling;
}

function onVisible() {
  /* Coming back to a tab that sat hidden through a poll: fetch now rather
   * than showing up-to-30-min-old data for up to 30 more minutes. This is now
   * purely the freshness optimization it reads as — the first load no longer
   * depends on it. */
  if (!document.hidden) pollAll();
}

function stopPolling() {
  clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisible);
}

/** Manual retry — the 44 px Retry button and re-toggled layers land here.
 *  Same path as a poll tick; no special cases to go stale. */
export function refresh() {
  return pollAll();
}
