/**
 * surge.js — Peak Storm Surge bands, fetched by PLACE (SPEC §4.8, §8).
 *
 * ==> EVERY OTHER GEOMETRY CACHE IN THIS APP IS KEYED ON A STORM. THIS ONE IS
 *     KEYED ON A POSITION, AND THAT IS NOT A STYLE CHOICE. <==
 * `NHC_PeakStormSurge` publishes ONE polygon layer for every active storm at
 * once, with no `stormid` and no `binnumber` to filter on. The only filter
 * available is spatial. So the key is a rounded storm position, and two storms
 * in the same corner of the Gulf legitimately share one fetch — the bands come
 * back for both and the point test sorts it out on the device.
 *
 * ==> HOME'S COORDINATES ARE NEVER SENT. <== The envelope is centred on the
 * STORM. A tight envelope around the user's house would be smaller and faster
 * and would put their address in a URL, a relay log and a shared cache key.
 * Home is device-local (§8) — the whole band set comes back and
 * `lib/home-exposure.js` does the point-in-band test here on the phone.
 *
 * ROUNDING IS DONE HERE, ON PURPOSE. The relay REJECTS a non-integer rather
 * than rounding it, so the two sides cannot quietly disagree about what a
 * cache key means. A storm has to travel 60 nm before the key moves; the
 * envelope is 12 degrees deep, so nothing near its edge is lost.
 *
 * THE IN-MEMORY CACHE IS NOT A PERFORMANCE FEATURE, IT IS A FAN-OUT ONE. Every
 * storm's exposure block asks for surge, and several storms in one basin round
 * to nearby keys. Without this, selecting three Gulf storms in a row is three
 * identical relay round trips inside a minute.
 *
 * No DOM. Imports config/, data/relay.js.
 */

import { HOME_THREAT, CACHE } from '../config/constants.js';
import { fetchFeed } from './relay.js';

/** Rounded to the step the relay will accept. `Math.round` and not `trunc`:
 *  trunc pulls toward zero, so a storm at -89.6 and one at 89.6 would round
 *  in opposite directions relative to the ground and the envelope would sit
 *  lopsided in the southern and western hemispheres. */
export function surgeKey(lon, lat) {
  const step = HOME_THREAT.surgeKeyStepDeg;
  return {
    lon: Math.round(lon / step) * step,
    lat: Math.round(lat / step) * step,
  };
}

/** key -> {at, slot} */
const memo = new Map();

/** In-flight requests, so two storms asking at once make one fetch. */
const inflight = new Map();

/**
 * Surge bands near a storm position.
 *
 * ALWAYS RESOLVES TO A SLOT, NEVER THROWS. The exposure block reads this
 * alongside the watch/warning layer, and a rejected promise here would take
 * that block's other rows down with it (§5). The three answers are kept apart:
 * `unavailable` (the fetch died — the panel says so and offers a retry),
 * `none` (NHC published no surge product near this storm, which is the normal
 * case for a fish storm and is NOT an error), and `ok`.
 *
 * @returns {Promise<{status:'ok'|'none'|'unavailable', fc, error, fetchedAt, stale}>}
 */
export async function fetchSurge(lon, lat, { force = false } = {}) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return { status: 'unavailable', fc: null, error: 'no storm position', fetchedAt: null, stale: false };
  }

  const k = surgeKey(lon, lat);
  const id = `${k.lon},${k.lat}`;

  const held = memo.get(id);
  if (held && !force) {
    /* An `unavailable` slot is retried on the SHORT clock, a good one on the
     * geometry clock. Holding a failure for half an hour turns one bad minute
     * into half an hour of a blank surge row. */
    const ttl = held.slot.status === 'unavailable' ? CACHE.geometryRetryMs : CACHE.surgeFresh;
    if (Date.now() - held.at < ttl) return held.slot;
  }

  if (inflight.has(id)) return inflight.get(id);

  const p = (async () => {
    let slot;
    try {
      const { json, fetchedAt, relayStale } = await fetchFeed(
        `/api/nhc/surge?lon=${k.lon}&lat=${k.lat}`
      );

      if (json && json.error) {
        /* ArcGIS's 200-with-an-error-body, forwarded verbatim by the relay.
         * A refused query is `unavailable`, never an empty coast. */
        slot = { status: 'unavailable', fc: null, error: json.error.message || 'query error', fetchedAt, stale: false };
      } else if (!json || json.type !== 'FeatureCollection') {
        slot = { status: 'unavailable', fc: null, error: 'not a FeatureCollection', fetchedAt, stale: false };
      } else {
        const n = Array.isArray(json.features) ? json.features.length : 0;
        slot = {
          status: n ? 'ok' : 'none',
          fc: json,
          error: null,
          fetchedAt: fetchedAt || null,
          stale: !!relayStale,
        };
      }
    } catch (e) {
      slot = { status: 'unavailable', fc: null, error: e?.message || 'failed', fetchedAt: null, stale: false };
    }

    memo.set(id, { at: Date.now(), slot });
    inflight.delete(id);
    return slot;
  })();

  inflight.set(id, p);
  return p;
}

/** Drop everything held. Called when home changes or the app comes back from
 *  a long background — a surge footprint is per-advisory and a remembered one
 *  from yesterday is worse than a fresh fetch. */
export function forgetSurge() {
  memo.clear();
}
