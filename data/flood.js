/**
 * flood.js (data) — every NWS flood alert in force, fetched once and shared.
 * SPEC §48.21.
 *
 * ONE FETCH FOR THE WHOLE APP, not one per storm — the same shape
 * `data/cap.js` takes and for the same reason. The list is national, so the
 * set a storm's panel filters is the set the map layer draws. A per-storm
 * fetch would be the same bytes over and over, returning overlapping subsets.
 *
 * ==> IT IS NO LONGER GATED ON THE LAYER SWITCH (§56.17). <== This header used
 * to say the fetch happened when "either the Flood alerts toggle goes on or a
 * storm drawer asks for its count". The second half was never true — the
 * drawer's facade is read-only by design — and that stale half-sentence is most
 * of why nobody noticed the `Flooding` section saying *Checking flood alerts…*
 * forever for everyone who never found the map switch.
 *
 * §56.7 put `Flooding` on both screens permanently, so the list is what that
 * section costs: one national request per client TTL, shared by the map and
 * both screens. What the switch still gates is DRAWING — pushing county-scale
 * geometry into a MapLibre source is the expensive half, and nobody who left
 * the layer off pays it.
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
 * ==> IT MAKES A SECOND FETCH, AND THAT IS THE JOIN §56.4 IS BUILT AROUND. <==
 * A Flood Watch arrives with `geometry: null` — issued for a list of zones
 * rather than for a box a forecaster drew — so it can be neither drawn nor
 * matched to a track. The zones it names are resolved through `data/zones.js`
 * and joined on here, once, where the whole national list is in hand.
 *
 * ==> THE TWO FETCHES ARE SEPARATE BECAUSE THE TWO FACTS HAVE DIFFERENT
 * LIFETIMES. <== This list stops being true in minutes. A county line last
 * moved in April. Merging them would either re-fetch boundaries every three
 * minutes or serve a stale alert list, and neither is survivable on a hazard
 * surface.
 *
 * ==> AND THE SECOND FETCH CANNOT FAIL THE FIRST. <== The alerts are already in
 * hand when it runs, so a boundary that does not come back costs that alert its
 * shape and costs the list nothing. It stays `ok`, the watch stays in it, and
 * the watch is said and not drawn.
 *
 * No DOM. Imports config/, lib/ and data/.
 */

import { ENDPOINT, CACHE } from '../config/constants.js';
import { zonesNeeded, applyZones } from '../lib/zones.js';
import { fetchFeed } from './relay.js';
import { loadZones } from './zones.js';

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

      /* ==> THE ZONE JOIN, AND IT IS DELIBERATELY INSIDE THE ONE PLACE THE
       * WHOLE LIST EXISTS. <== Every consumer — the map layer, both screens'
       * sections, the corridor match — reads this slot, so joining here means
       * not one of them has to know a watch ever lacked a shape. §56.4.
       *
       * Awaited rather than fired and forgotten: a section that renders
       * without the shapes and then rearranges itself a second later is worse
       * than one that takes a moment. The boundaries are held for the session
       * after the first call, so this costs a round trip once. */
      const needed = zonesNeeded(json.alerts);
      const { zones } = needed.length ? await loadZones(needed, { now }) : { zones: {} };

      return slot('ok', applyZones(json.alerts, zones), { fetchedAt, stale: !!relayStale });
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
