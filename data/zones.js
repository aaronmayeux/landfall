/**
 * zones.js (data) — NWS zone boundaries, fetched once and shared. §56.4.
 *
 * ==> A BOUNDARY IS THE LONGEST-LIVED THING THIS APP FETCHES. <== Measured on
 * the captured responses: NWS serves a zone with `max-age=2592000` — thirty
 * days — and a `last-modified` four months old. So this holds what it has
 * gotten for the whole session and asks only for codes it has never seen.
 * Nothing here polls, nothing here expires on a timer the reader can feel.
 *
 * ==> IT IS ASKED FOR ONLY WHAT IS MISSING, AND THE ASKING IS BATCHED. <== One
 * call carries every unresolved code across every shapeless alert in force —
 * 23 on the day this was built, capped at `RAIN.zonesPerRequest`. A request per
 * zone would be seventeen round trips to draw one watch.
 *
 * ==> A FAILURE HERE IS NOT A FAILURE OF THE FLOOD LIST. <== The alerts are
 * already in hand when this runs. If the boundaries do not come back, the list
 * still renders and the watches in it are SAID AND NOT DRAWN (§56.4). So this
 * never throws and never rejects: it returns what it has, and what it could not
 * get comes back named.
 *
 * No DOM. Imports config/, lib/ and data/relay.js.
 */

import { ENDPOINT, RAIN, CACHE } from '../config/constants.js';
import { fetchFeed } from './relay.js';

const url = (ids) => `${ENDPOINT.relay}/nws/zone?ids=${encodeURIComponent(ids.join(','))}`;

/** Every boundary this session has resolved, by code. Shared by the map layer
 *  and every storm panel opened in this session. */
let held = new Map();

/** When this session started holding them. One clock for the whole map, not one
 *  per zone: they are all refreshed by the same call and a per-entry age would
 *  be four hundred timestamps recording one fetch. */
let heldAt = 0;

/** Codes that came back `missing` and are not worth re-asking for on every
 *  render. Cleared with everything else. */
let refused = new Set();

/** A fetch already in flight, keyed by the id list, so the map layer and a
 *  storm drawer asking at the same moment make one request. */
let inFlight = new Map();

/** Drop everything held so the next call refetches. The Retry button and the
 *  test seam are the only callers. */
export function evictZones() {
  held = new Map();
  heldAt = 0;
  refused = new Set();
  inFlight = new Map();
}

export const resetZones = evictZones;

/**
 * Boundaries for `codes`, as `{ zones, missing }`.
 *
 * NEVER THROWS and never rejects. `zones` is whatever resolved — possibly
 * nothing — and `missing` names every code that did not, so a caller can say
 * WHICH watch it could not place.
 *
 * @param {string[]} codes
 * @param {{ now?: number, retry?: boolean }} opts
 */
export async function loadZones(codes, { now = Date.now(), retry = false } = {}) {
  if (retry) evictZones();
  if (heldAt && now - heldAt > CACHE.zoneClient) evictZones();

  const want = [...new Set(codes || [])]
    .filter((c) => c && !held.has(c) && !refused.has(c))
    .sort();

  if (want.length) {
    /* ==> THE CAP IS THE RELAY'S AND IT IS ENFORCED AGAIN HERE. <== Asking for
     * more than the route accepts gets a 400 for the whole batch, which would
     * turn a big flood day into no boundaries at all rather than into most of
     * them. The overflow is left unresolved and named, which is the same
     * outcome as a zone that would not answer. */
    const batch = want.slice(0, RAIN.zonesPerRequest);
    for (const over of want.slice(RAIN.zonesPerRequest)) refused.add(over);

    const key = batch.join(',');
    const run = inFlight.get(key) || (async () => {
      try {
        const { json } = await fetchFeed(url(batch));
        if (json?.status !== 'ok' || !json.zones) throw new Error('unreadable');
        for (const [code, zone] of Object.entries(json.zones)) {
          if (zone?.geometry) held.set(code, zone);
        }
        for (const m of json.missing || []) refused.add(m?.id);
      } catch {
        /* ==> A WHOLE-BATCH FAILURE IS NOT REMEMBERED AS A REFUSAL. <== A zone
         * NWS declines to serve will not start working; a network that dropped
         * one request will. Marking these refused would mean one bad moment
         * cost the reader every boundary until they reloaded the app. */
      }
      if (!heldAt) heldAt = now;
    })();

    inFlight.set(key, run);
    await run;
    inFlight.delete(key);
  }

  const zones = {};
  const missing = [];
  for (const c of new Set(codes || [])) {
    if (held.has(c)) zones[c] = held.get(c);
    else missing.push(c);
  }
  return { zones, missing };
}
