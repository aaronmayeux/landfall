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

import { POLL, FRESHNESS } from '../config/constants.js';
import { ageMs } from '../lib/time.js';
import { fetchNhcStorms } from './nhc.js';
import { fetchGdacsStorms } from './gdacs.js';
import { mergeStorms } from './merge.js';

const state = {
  /** Normalized, merged, NHC-wins, canonically sorted. */
  storms: [],
  sources: {
    nhc: { status: 'loading', fetchedAt: null, error: null },
    gdacs: { status: 'loading', fetchedAt: null, error: null },
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

function emit() {
  state.storms = mergeStorms(lastGood.nhc, lastGood.gdacs);
  for (const cb of listeners) cb(state);
}

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

/** True when a source's data is past the aging threshold (SPEC §16 bands). */
export function isSourceStale(source, s = state) {
  const a = ageMs(s.sources[source]?.fetchedAt);
  return a != null && a > FRESHNESS.freshUntil;
}

async function pollSource(source, fetcher) {
  try {
    const { storms, fetchedAt, relayStale } = await fetcher();
    lastGood[source] = storms;
    state.sources[source] = {
      /* The relay serving ITS last-good means upstream is down even though
       * our fetch succeeded — honest status is stale-ok, not fresh-ok. */
      status: 'ok',
      fetchedAt,
      error: null,
      relayStale: !!relayStale,
    };
  } catch (e) {
    state.sources[source] = {
      status: 'unavailable',
      /* fetchedAt keeps its previous value's meaning via lastGood age — but
       * the slot itself records when we last SUCCEEDED, so keep the old one. */
      fetchedAt: state.sources[source].fetchedAt,
      error: e?.message || 'failed',
      relayStale: false,
    };
  }
  emit();
}

let timer = null;

async function pollAll() {
  if (typeof document !== 'undefined' && document.hidden) return;
  /* Parallel and independent — each source emits as it lands, so NHC storms
   * draw while GDACS is still timing out (SPEC §4 reason #3). */
  await Promise.allSettled([
    pollSource('nhc', fetchNhcStorms),
    pollSource('gdacs', fetchGdacsStorms),
  ]);
}

/** Starts the 30-minute poll loop. Idempotent. Returns a stop function. */
export function startPolling() {
  if (timer) return stopPolling;
  pollAll();
  timer = setInterval(pollAll, POLL.storms);
  document.addEventListener('visibilitychange', onVisible);
  return stopPolling;
}

function onVisible() {
  /* Coming back to a tab that sat hidden through a poll: fetch now rather
   * than showing up-to-30-min-old data for up to 30 more minutes. */
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
