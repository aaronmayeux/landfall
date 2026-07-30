/**
 * volcano-live.js — the browser side of /api/volcano/live.
 *
 * ONE FETCH, THREE CHANNELS, AND THE CHANNELS STAY APART. The relay has
 * already parsed, deduped and age-filtered (functions/api/volcano/), so this
 * file's whole job is: ask, hand back the three channel states unmerged, and
 * make it impossible for a caller to accidentally read a dead feed as a quiet
 * planet.
 *
 * ==> IT DOES NOT JOIN TO THE CATALOG AND MUST NOT START. <== The payload
 * carries only what is LIVE, keyed on the GVP number `n`. Position, name,
 * elevation, shape family and eruption history all live in
 * assets/hazards/volcanoes-holocene.geojson, which is the authority on all of
 * them (§22.1). The join is Phase E's, in the renderer that owns the field.
 *
 * ==> AND IT DRAWS NOTHING. Phase C ends with data in the browser and no
 * pixels. <== First marks are Phase E, and the Deep globe is not in the live
 * app at all yet — it is /proto-worlds.html.
 *
 * No DOM, ever. Imports: config/, data/relay.js.
 */

import { ENDPOINT, VOLCANO } from '../config/constants.js';
import { fetchFeed } from './relay.js';

/**
 * The three channel names, stated once.
 *
 * ==> THERE IS NO "OVERALL" STATE HERE, DELIBERATELY, AND ADDING ONE WOULD BE
 * A BUG. <== Three feeds at three different ages — ash in hours, US alert
 * levels standing for weeks, the Smithsonian weekly running up to eight days
 * behind by design. A single rolled-up status or a single age badge lies in
 * whichever direction it rounds, and the direction that matters is the one
 * where a VAAC outage reads as an empty sky. Every surface that shows this
 * layer shows per-channel state. `worstState()` below exists ONLY so a caller
 * can decide whether to offer a retry, never to label the layer.
 */
export const CHANNELS = Object.freeze(['ash', 'weekly', 'alerts']);

/** Empty per-channel state, used for the loading and hard-failure shapes so
 *  every consumer sees the same keys at every moment (§5: loading, empty and
 *  error are all handled explicitly, and no surface renders partially). */
const downChannels = (error) =>
  Object.freeze(
    CHANNELS.reduce((acc, key) => {
      acc[key] = { state: VOLCANO.state.unavailable, at: null, count: 0, error };
      return acc;
    }, {})
  );

/**
 * Fetch the live volcano payload.
 *
 * @returns {Promise<{
 *   fetchedAt: string|null,
 *   relayStale: boolean,
 *   sources: object,
 *   volcanoes: object[],
 *   reachedRelay: boolean
 * }>}
 *
 * ==> NEVER THROWS, AND NEVER RETURNS AN EMPTY LIST TO MEAN A FAILURE. <== A
 * relay that cannot be reached comes back with all three channels
 * `unavailable` and `reachedRelay: false`. A caller that only looks at
 * `volcanoes.length` therefore cannot tell a dead relay from a quiet planet —
 * so it is given nothing that lets it make that mistake quietly: the list is
 * empty in both cases and the STATES are the only place the difference lives.
 * That is the same shape data/gdacs.js uses, for the same §5 reason.
 */
export async function fetchVolcanoLive() {
  let res;
  try {
    res = await fetchFeed(`${ENDPOINT.relay}/volcano/live`);
  } catch (e) {
    return {
      fetchedAt: null,
      relayStale: false,
      sources: downChannels(String(e && e.message ? e.message : e)),
      volcanoes: [],
      reachedRelay: false,
    };
  }

  const body = res.json && typeof res.json === 'object' ? res.json : null;
  if (!body || !body.sources) {
    /* The relay answered with something that is not our payload. Treated as a
     * failure of all three channels rather than as an empty world — a 200
     * carrying the wrong shape is exactly the trap the HANS channel taught
     * (see functions/api/volcano/_union.js). */
    return {
      fetchedAt: res.fetchedAt || null,
      relayStale: !!res.relayStale,
      sources: downChannels('relay returned an unexpected shape'),
      volcanoes: [],
      reachedRelay: true,
    };
  }

  return {
    fetchedAt: body.fetchedAt || res.fetchedAt || null,
    /** Set when the RELAY served its last-good copy because every upstream was
     *  down. Distinct from a channel's own `stale`: this one says the whole
     *  payload is from an earlier fetch, and §5 wants it visible with an age
     *  rather than hidden. */
    relayStale: !!res.relayStale,
    sources: body.sources,
    volcanoes: Array.isArray(body.volcanoes) ? body.volcanoes : [],
    reachedRelay: true,
  };
}

/**
 * Is this channel showing something a reader can rely on?
 *
 * `clear` counts as usable — it is a successful fetch of a quiet sky, and on
 * the ash channel it is the normal day. Only `unavailable` does not.
 */
export const channelUsable = (channel) =>
  !!channel && channel.state !== VOLCANO.state.unavailable;

/**
 * The channels that failed, for a retry affordance.
 *
 * ==> RECOVERY IS PER CHANNEL, NOT PER LAYER (§5's "error with a recovery
 * action"). <== Re-fetching everything because the weekly RSS 403'd would
 * re-pull five healthy feeds, and on this route it would also throw away a
 * warm ash reading that is the freshest thing on the globe. The relay is one
 * URL, so a retry does refetch all six — what is per-channel is the SENTENCE
 * shown and the decision to offer the retry at all.
 */
export const failedChannels = (sources) =>
  CHANNELS.filter((key) => !channelUsable(sources && sources[key]));

/**
 * The worst state across the three, for deciding whether to show a problem at
 * all. **Not for labelling the layer** — see the note on CHANNELS.
 */
export function worstState(sources) {
  const S = VOLCANO.state;
  const states = CHANNELS.map((k) => (sources && sources[k] ? sources[k].state : S.unavailable));
  if (states.includes(S.unavailable)) return S.unavailable;
  if (states.includes(S.stale)) return S.stale;
  if (states.every((s) => s === S.clear)) return S.clear;
  return S.ok;
}

/**
 * The volcanoes with live ASH right now — the ones a VAAC centre currently
 * has an ash cloud for.
 *
 * ==> `status === 'active'` AND NOT MERELY "HAS AN ASH ENTRY". <== A centre
 * issues a bulletin to say ash has STOPPED as readily as to say it started,
 * and on 2026-07-30 three of the newest bulletins on the wire were closes.
 * Counting entries instead of reading them puts dead events on the globe.
 */
export const withActiveAsh = (volcanoes) =>
  (volcanoes || []).filter((v) => v.live && v.live.ash && v.live.ash.status === 'active');

/**
 * The full erupting set: the three-way union, which is what Phase E draws.
 *
 * ==> A UNION, NEVER A FILTER, AND NEVER INTERSECTED WITH THE HISTORY TIER.
 * <== Measured: 6 of the 22 volcanoes erupting on 2026-07-30 sit outside the
 * 128-volcano activity tier, and VAAC sees no lava-only eruption at all — so
 * Great Sitkin and Kilauea, both erupting right now, appear in no ash advisory
 * anywhere. Any narrowing of this set hides something that is happening
 * (§42.1.1, §5). History decides what is drawn when nothing is happening; it
 * never suppresses something that is.
 */
export const eruptingSet = (volcanoes) =>
  (volcanoes || []).filter((v) => {
    if (!v.live) return false;
    if (v.live.ash && v.live.ash.status === 'active') return true;
    /* The weekly feed's own words. Both "New Eruptive Activity" and "Ongoing
     * Activity" are eruptions; the distinction is how long it has been going,
     * not whether it is happening. */
    if (v.live.report && /activity/i.test(v.live.report.activity || '')) return true;
    /* A US alert level above the baseline. `NORMAL`/`GREEN` never reach this
     * feed — HANS publishes only elevated volcanoes — so presence is the
     * signal, and the level is what a renderer ranks by. */
    if (v.live.alert && v.live.alert.alertLevel) return true;
    return false;
  });
