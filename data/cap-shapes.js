/**
 * cap-shapes.js (data) — the warning AREAS for alerts, fetched on demand.
 * SPEC §50.10, §50.11.
 *
 * ==> SEPARATE FROM `data/cap.js` BECAUSE THE TWO ARE WANTED AT DIFFERENT
 * MOMENTS. <== The alert LIST is fetched once per session and read by every
 * storm panel; it is 8 KB and everybody needs it. The SHAPES are wanted only
 * for the alerts of the storm currently open, only when the coastal layer is
 * actually drawing, and they are the half that carries weight. Fetching them
 * alongside the list would mean every reader downloading polygons for
 * countries they never looked at.
 *
 * ==> KEYED BY THE SET, NOT BY THE STORM. <== Two storms hitting the same
 * country share an alert, and a storm's alert set changes as agencies issue
 * and expire. Caching per storm would refetch identical geometry for the
 * second storm and hold stale geometry for the first. The id list IS the
 * identity of the answer.
 *
 * NEVER THROWS. Every failure resolves to an `unavailable` slot. A layer whose
 * data promise rejects paints nothing and says nothing, which is the §5
 * failure — and here the specific lie is a coast with a warning on it looking
 * exactly like a coast without one.
 *
 * No DOM. Imports config/ and data/relay.js.
 */

import { ENDPOINT, CACHE } from '../config/constants.js';
import { fetchFeed } from './relay.js';

/** Rows per request, mirroring `MAX_IDS` in `functions/api/cap/shapes.js`.
 *  Enforced on BOTH sides on purpose: the relay's copy stops a crafted URL,
 *  and this one stops us sending a request we know will be refused — a 400 is
 *  a worse way to learn our own limit than not crossing it. */
const MAX_IDS = 20;

/** id list -> the cache key AND the query string. Sorted and deduped so two
 *  callers asking for the same alerts in different orders share one answer. */
const keyOf = (ids) => [...new Set(ids)].sort((a, b) => a - b).join(',');

/** key -> { at, slot }. Small by construction: one entry per distinct alert
 *  set, and the whole global cyclone feed measured one to five rows a day. */
const cached = new Map();

/** key -> in-flight promise, so a repaint mid-fetch does not fire a second. */
const inFlight = new Map();

const slot = (state, shapes, extra = {}) =>
  Object.freeze({ state, shapes, reason: null, fetchedAt: null, stale: false, ...extra });

/**
 * Warning areas for the given alert row ids.
 *
 * @param {number[]} ids `objectId` off the normalized alerts
 * @returns {Promise<{state:'ok'|'unavailable'|'none', shapes: Map<number, Array>}>}
 *   `shapes` maps a row id to its flat list of rings. A row the service did
 *   not answer for is simply absent — the caller paints what it has and the
 *   layer says which alerts went unpainted.
 */
export async function loadShapes(ids, { now = Date.now(), retry = false } = {}) {
  const list = (ids || []).filter((n) => Number.isInteger(n));
  /* ==> NO IDS IS `none`, NOT `unavailable`. <== It means every alert in hand
   * arrived without a row id, which is a real and different fact from the
   * service failing, and the two must not read the same downstream (§5). */
  if (!list.length) return slot('none', new Map());

  const key = keyOf(list.slice(0, MAX_IDS));

  if (!retry) {
    const hit = cached.get(key);
    if (hit && now - hit.at < CACHE.capClient) return hit.slot;
    const running = inFlight.get(key);
    if (running) return running;
  }

  const run = (async () => {
    try {
      const { json, fetchedAt, relayStale } = await fetchFeed(
        `${ENDPOINT.relay}/cap/shapes?ids=${key}`
      );

      /* The shape is CHECKED rather than assumed — `data/genesis.js`'s scar:
       * an undefined body read as an empty list and shipped a false all-clear.
       * Here an empty list would mean "no warning area anywhere", which paints
       * a warned coast as unwarned. */
      if (!json || !Array.isArray(json.features)) {
        return slot('unavailable', new Map(), {
          fetchedAt,
          reason: 'the warning areas could not be read',
        });
      }

      const shapes = new Map();
      for (const f of json.features) {
        if (typeof f?.id !== 'number' || !Array.isArray(f?.rings)) continue;
        shapes.set(f.id, f.rings);
      }
      return slot('ok', shapes, { fetchedAt, stale: !!relayStale });
    } catch (e) {
      return slot('unavailable', new Map(), {
        reason: e?.message
          ? `the warning areas could not be fetched (${e.message})`
          : 'the warning areas could not be fetched',
      });
    }
  })();

  inFlight.set(key, run);
  const result = await run;
  inFlight.delete(key);
  /* A FAILURE IS NOT CACHED — it would outlast its own recovery. */
  if (result.state === 'ok') cached.set(key, { at: now, slot: result });
  return result;
}

/** Drop everything held. For tests and for the replay switch, which changes
 *  what "now" means underneath a cached answer. */
export function resetShapes() {
  cached.clear();
  inFlight.clear();
}
