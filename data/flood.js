/**
 * flood.js (data) — every NWS flood alert in force, fetched once and shared.
 * SPEC §48.21.
 *
 * ONE FETCH FOR THE WHOLE APP, not one per storm — the same shape
 * `data/cap.js` takes and for the same reason. The list is national, so the
 * set a storm's panel filters is the set the map layer draws. A per-storm
 * fetch would be the same bytes over and over, returning overlapping subsets.
 *
 * ==> IT IS GATED ON THE LAYER SWITCH AND ON NOTHING ELSE. <== Nothing calls
 * this until either the Flood alerts toggle goes on or a storm drawer asks for
 * its count. There is no warm loop and no poll: a reader who never turns the
 * layer on and never opens a storm near home pays nothing for this feature.
 *
 * ==> NOT PLUMBED THROUGH THE STORM SOURCE TABLE. <== `data/lifecycle.js`
 * treats a source answering without a storm in it as evidence that storm has
 * ended. This is not a storm source — it is a list of things a weather office
 * said about water on the ground — and letting its silence reach the lifecycle
 * would let a quiet afternoon retire a live hurricane. Same reasoning
 * `data/cap.js` and `data/genesis.js` both record.
 *
 * ==> AND NOTHING IS HELD. <== Every forecast route in this app keeps a
 * last-good copy, because a stale forecast beats a blank section (§5). This
 * one must not, and the relay refuses too. An expired flood warning is not a
 * stale reading of a live fact; it is a shape on a map telling somebody they
 * are in danger when they are not. §50.5 reaches the same conclusion about the
 * CAP list for the same reason.
 *
 * THE THREE STATES ARE KEPT APART (§5):
 *   unavailable  the fetch or the parse failed. Say so, offer Retry, and NEVER
 *                fall through to "no flood warnings are in force".
 *   ok           it answered. `alerts` may legitimately be empty, which means
 *                no weather office in the United States currently has a flood
 *                product out — common, and true.
 * The `none_matched` half — the feed answered and nothing comes near THIS
 * storm's track (§56.3) — is decided per storm in `lib/flood.js`, not here,
 * because the feed being empty and this storm having nothing near it are
 * different facts and the panel words them differently.
 *
 * No DOM. Imports config/, lib/ and data/relay.js.
 */

import { ENDPOINT, CACHE } from '../config/constants.js';
import { fetchFeed } from './relay.js';

const url = () => `${ENDPOINT.relay}/nws/flood`;

/** The last answer, with the moment we took it. Shared by the map layer and
 *  every storm panel opened in this session. */
let cached = null;

/** A fetch already in flight, so flipping the layer on while a storm drawer's
 *  request is still out does not fire a second one. */
let inFlight = null;

const slot = (state, alerts, extra = {}) =>
  Object.freeze({
    state,
    alerts,
    total: alerts.length,
    drawable: alerts.filter((a) => a.drawable).length,
    reason: null,
    fetchedAt: null,
    stale: false,
    ...extra,
  });

/** Drop the held answer so the next call refetches. The Retry button and the
 *  test seam are the only callers. */
export function evictFlood() {
  cached = null;
  inFlight = null;
}

export const resetFlood = evictFlood;

/**
 * The national flood alert list.
 *
 * NEVER THROWS. Every failure resolves to an `unavailable` slot carrying the
 * reason in words, because a thrown error here would reach a hazard layer
 * whose whole job is to not go silent.
 *
 * @param {{ now?: number, retry?: boolean }} opts
 */
export async function loadFloodAlerts({ now = Date.now(), retry = false } = {}) {
  if (!retry && cached && now - cached.at < CACHE.floodClient) return cached.slot;
  if (!retry && inFlight) return inFlight;

  const run = (async () => {
    try {
      const { json, fetchedAt, relayStale } = await fetchFeed(url());

      if (json?.status !== 'ok' || !Array.isArray(json.alerts)) {
        /* A body we cannot read is NOT an empty list. Rendering it as one
         * would paint an all-clear over whatever is actually happening. */
        return slot('unavailable', [], { reason: 'the flood list came back in a form this app could not read' });
      }

      return slot('ok', json.alerts, { fetchedAt, stale: !!relayStale });
    } catch (e) {
      return slot('unavailable', [], { reason: e?.message || 'the flood list did not load' });
    }
  })();

  inFlight = run;
  const result = await run;
  inFlight = null;
  cached = { at: now, slot: result };
  return result;
}
