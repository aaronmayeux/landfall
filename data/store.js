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
import { fetchGenesis } from './genesis.js';
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

  /**
   * THE AREAS BEING WATCHED (§45) — ITS OWN BRANCH, NOT A THIRD ENTRY IN
   * `sources`, AND THAT SEPARATION IS LOAD-BEARING.
   *
   * `sources` feeds `lastGood`, the merge, and `data/lifecycle.js` — which
   * counts a source answering WITHOUT a given storm in it as evidence that the
   * storm has ended. A watched area is not a storm and never was, so letting
   * one through that machinery would let a genesis list retire a live
   * hurricane. Structurally absent is the only safe version of that guarantee.
   *
   * Shape mirrors `data/genesis.js`'s return: `status` is the section's answer
   * in §5's three words, `sources` holds the per-source split so a partial
   * outage can be named, and `areas` is the merged, ordered list.
   */
  genesis: {
    status: 'loading',
    areas: [],
    sources: {
      nhc: { status: 'loading', areas: [], reason: null },
      jtwc: { status: 'loading', areas: [], reason: null },
    },
    fetchedAt: null,
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
 *   'ok'           storms on screen, OR areas being watched (even if one
 *                  source is down — partial data is shown and the outage is
 *                  named separately)
 *   'clear'        every source clean, zero storms AND nothing being watched.
 *                  The only true all-clear, and §45 is why that sentence now
 *                  has a second half.
 */
export function overallStatus(s = state) {
  const st = [s.sources.nhc.status, s.sources.gdacs.status];

  /* STORMS FIRST. Anything on screen is the answer, whatever the other feed is
   * still doing — partial data is shown and the outage is named separately. */
  if (s.storms.length > 0) return 'ok';

  /* ==> A WATCHED AREA DOWNGRADES `clear` TO `ok`, EXACTLY AS AN ENDED STORM
   *     DOES. <== (§45.5, Aaron's call 2026-08-09.)
   *
   * The rule this obeys already existed and is not new: ANYTHING DRAWN ON THE
   * GLOBE OUTRANKS AN ALL-CLEAR. A grey ended-storm dot contradicts "all
   * clear", and a hatched genesis patch contradicts it the same way. Measured
   * 2026-08-09, both fetches minutes apart: `CurrentStorms.json` returned
   * `{"activeStorms":[]}` while the outlook published FIVE watched areas, one
   * at 80% over seven days. A literal all-clear at that instant is technically
   * true of storms and is exactly the honest-looking wrong answer §5 exists to
   * prevent.
   *
   * `ok` RATHER THAN A FOURTH WORD. A status of its own was the alternative
   * and it would have cost a new branch in three places that each restate this
   * ladder — here, `ui/view-storms.js`'s deliberate copy, and main.js — with
   * three chances to drift. Nothing ambiguous reaches the screen either way:
   * the pill and the empty state read the COUNTS, not this word, so zero
   * storms with three areas says "3 areas being watched" and not "ok".
   *
   * ONLY A REAL AREA COUNTS. `genesis.status === 'unavailable'` is NOT a
   * downgrade — an outage on the outlook must not masquerade as something
   * being watched. It falls through to the source ladder below, where a
   * genuinely unknown sky is already handled honestly. */
  if (s.genesis?.areas?.length > 0) return 'ok';

  /* ==> ANY SOURCE STILL LOADING IS LOADING, NOT UNAVAILABLE. <==
   *
   * This used to read `st.every(loading)`, and the two feeds are fetched in
   * PARALLEL, so the instant the faster one landed empty while the slower one
   * was still in flight the answer fell straight through to `unavailable` — a
   * red "Storm feeds are not responding" on a perfectly healthy startup. On a
   * good network that is a flash; on a phone waiting out a slow upstream it is
   * the first thing the app says. Calling a normal boot an outage is the §5
   * failure pointed the wrong way: it spends the credibility that the real
   * outage message needs.
   *
   * `loading` is an INITIAL value only — nothing ever sets a slot back to it,
   * so this can never blank a populated list on the 30-minute refresh.
   *
   * Nothing is hidden. A feed that genuinely failed is still `unavailable`
   * once the other one resolves, and the middle rung (`slow`) already says
   * "still trying, not going well" at two seconds. */
  if (st.some((x) => x === 'loading')) return 'loading';
  if (s.genesis?.status === 'loading') return 'loading';

  /* ==> `clear` NOW HAS A SECOND HALF, AND IT IS THE WHOLE POINT OF §45. <==
   *
   * The old sentence was "every storm source clean, zero storms". That is an
   * all-clear about STORMS, and it was published on a day when NHC was
   * watching five areas. The honest sentence is "nobody is reporting a storm
   * AND nobody is watching anything", and it needs the watch list to have
   * actually answered before it can be said.
   *
   * A GENESIS OUTAGE THEREFORE BLOCKS `clear` AND FALLS TO `unavailable`,
   * which is the correct and slightly uncomfortable answer: we cannot see the
   * whole question, so we do not get to give the reassuring half of it. The
   * status strip names which source is down, so the user is told what is
   * unknown rather than left with a bare red word.
   *
   * `none_matched` IS A CLEAN ANSWER. The source looked and published nothing.
   * That is the state most of the year and it earns the all-clear. */
  if (st.every((x) => x === 'ok') && s.genesis?.status === 'none_matched') return 'clear';
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
   * draw while GDACS is still timing out (SPEC §4 reason #3).
   *
   * GENESIS RIDES THE SAME TICK ON PURPOSE (`POLL.genesis` says why): a
   * watched area and a storm are the same question asked at two ranges, and a
   * user watching an 80% area turn into a depression must not see the list and
   * the globe disagree for half an hour because two timers fired apart. It is
   * still INDEPENDENT — `pollGenesis` swallows its own failure, so a dead
   * outlook can never delay or blank the storm list. */
  await Promise.allSettled([
    pollSource('nhc', fetchNhcStorms),
    pollSource('gdacs', fetchGdacsStorms),
    pollGenesis(),
  ]);
}

/** The watch list. Never throws — `fetchGenesis` resolves to a state object
 *  whatever happens upstream, and the one thing that must not happen here is a
 *  rejection escaping into `pollAll` and looking like a storm-feed problem. */
async function pollGenesis() {
  try {
    state.genesis = await fetchGenesis();
  } catch (e) {
    /* Belt and braces. `fetchGenesis` catches per source, so reaching this
     * means something structural broke — and the honest answer is still
     * "we could not look", never "nothing is being watched". */
    state.genesis = {
      status: 'unavailable',
      areas: [],
      sources: {
        nhc: { status: 'unavailable', areas: [], reason: e?.message || 'failed' },
        jtwc: { status: 'unavailable', areas: [], reason: e?.message || 'failed' },
      },
      fetchedAt: state.genesis?.fetchedAt ?? null,
    };
  }
  emit();
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
