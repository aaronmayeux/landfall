/**
 * ended-track.js — a finished storm that arrived without a trail goes and gets
 * one (SPEC §5).
 *
 * ===========================================================================
 * THE BUG THIS EXISTS FOR, MEASURED RATHER THAN REASONED
 * ===========================================================================
 *
 * A dead storm's dotted trail is not fetched from anywhere at the moment it is
 * drawn. It is whatever THIS DEVICE happened to be holding when the storm was
 * promoted into the registry — `promote` in data/lifecycle.js takes the track
 * off the working-set entry, and that entry's track is compacted from the
 * geometry cache.
 *
 * So the trail was never a property of the storm. It was a souvenir of who
 * happened to be watching.
 *
 * A device that first meets a storm ALREADY past `ENDED.lapsedAfter` lapses it
 * inside the very first `observeSource` call — step 1 writes the working-set
 * entry, step 5 promotes it, in the same pass — and the geometry warm is
 * asynchronous and has not run. The record is filed with an empty track, the
 * storm is excluded from warming from that moment on (main.js `warmable`), and
 * `load`/`warm` in app/bundle-pipeline.js refuse to fetch it. Blank forever.
 *
 * MEASURED 2026-08-12, real browser, cleared storage, one poll, one GDACS storm
 * silent 49 h: `endedCount: 1, reason: "lapsed", pastTrack: "none",
 * storedTrackPoints: 0`. Aaron found it as a work PC drawing a finished storm
 * with no trail while his phone — which had been open while the same storm was
 * alive — drew it correctly.
 *
 * ===========================================================================
 * WHY THE FIX IS A FETCH AND NOT A STORE
 * ===========================================================================
 *
 * The obvious answer is to keep dead storms' tracks somewhere central so every
 * device sees the same thing — the relay, or the hourly archive branch. Both
 * were costed and both are the wrong shape for THIS bug:
 *
 *   THE ARCHIVE holds only storms GDACS still flags `iscurrent`, and its
 *   `latest/geometry` folder is deleted and rebuilt from scratch every hour
 *   with no history kept. A retired storm's file is gone on the next run. It
 *   can only serve a storm during exactly the window the storm is fetchable
 *   anyway.
 *
 *   A RELAY STORE would work, and buys something real — trails for storms GDACS
 *   has fully retired, which today vanish from the app entirely. But that is a
 *   different feature ("dead storms stay around longer"), it needs its own
 *   answer on how long and where they live, and holding whole payloads is
 *   ~400 kB a storm while holding just the track means a SECOND parser on the
 *   server. Two parsers for one thing is how the map's trail and the globe's
 *   ridge end up disagreeing about the same storm.
 *
 * The window a new device can even SEE a trackless dead storm is bounded at
 * both ends by the feed: it cannot show a storm before the feed lists it, and
 * it stops showing one when the feed drops it. Inside that window the storm's
 * geometry is still published — DOLPHIN-26 was still serving 54 past-track
 * segments two days after its last analysis. So there is nothing to store. The
 * client was simply refusing to ask.
 *
 * ===========================================================================
 * WHAT IT DOES NOT DO
 * ===========================================================================
 *
 * NO STATE ON SCREEN, EVER. This is repair of something cosmetic that is
 * already missing. A failure leaves the storm exactly as it is now — grey mark,
 * no trail — and says so only in the console. Routing it through the panel's
 * error state would blame the source for a storm that is finished, which is the
 * §5 mistake the ended-storm work exists to avoid.
 *
 * NO CACHE WRITE. The fetched bundle fills the REGISTRY and is then dropped.
 * `endedBundle` rebuilds from the record, so what this device draws after a
 * backfill is byte-identical to what it draws after a reload — one shape for a
 * finished storm rather than two that differ by how you got here.
 *
 * Imports data/ only. No DOM, ever.
 */

import { ENDED } from '../config/constants.js';
import { endedNeedsTrack, fillEndedTrack } from './lifecycle.js';
import { fetchGdacsGeometry } from './gdacs-geometry.js';
import { fetchStormGeometry } from './nhc-mapserver.js';

/** stormId → attempts spent this session. Deliberately NOT persisted; see
 *  `ENDED.trackBackfillAttempts`. */
const attempts = new Map();

/** Storms with a fetch in the air, so two emits in the same poll — a feed
 *  landing and a lifecycle change, which both re-emit — cannot double-request
 *  the same 400 kB payload. */
const inFlight = new Set();

/**
 * Which fetcher speaks for this storm's source.
 *
 * ==> BOTH SOURCES, AS ALWAYS. <== A lapse is the GDACS case in practice —
 * GDACS never drops a storm, so it is the only feed where silence is the only
 * route out — but `observeSource` step 5 runs for whichever source is polling,
 * and an NHC storm that went quiet without a final advisory reaches it too. A
 * repair that only worked for one source would be exactly the half-shipped
 * feature §14 forbids.
 *
 * Anything else is null and simply not attempted: an unknown source has no
 * fetcher and guessing at one is how a 404 loop starts.
 */
function fetcherFor(storm) {
  if (storm?.source === 'gdacs') return fetchGdacsGeometry;
  if (storm?.source === 'nhc') return fetchStormGeometry;
  return null;
}

/**
 * Fill in the missing past track for any ended storm that has none.
 *
 * FIRE AND FORGET. The caller does not await this and must not: it runs beside
 * the ambient push on a poll, and a slow European payload must never hold up
 * drawing the storms that are already on screen. When a repair lands it writes
 * through `fillEndedTrack`, which fires the lifecycle listeners, which re-emits
 * the store — so the map redraws through the SAME path a storm ending does.
 * There is no second route from a filled track to pixels.
 *
 * @param {Array<object>} storms  this poll's storms; non-ended ones are ignored
 * @returns {Promise<number>} how many records were actually repaired — for the
 *          suite, and for a console poke on a phone. Never throws.
 */
export async function backfillEndedTracks(storms) {
  const jobs = [];

  for (const storm of Array.isArray(storms) ? storms : []) {
    const id = storm?.id;
    if (!id || inFlight.has(id)) continue;

    /* The REGISTRY decides, not the storm object handed in. The record is the
     * thing that holds the track and the thing that says how the storm ended,
     * and a caller passing a stale copy must not be able to trigger a fetch the
     * registry would refuse. */
    if (!endedNeedsTrack(id)) continue;

    const spent = attempts.get(id) || 0;
    if (spent >= ENDED.trackBackfillAttempts) continue;

    const fetchGeometry = fetcherFor(storm);
    if (!fetchGeometry) continue;

    attempts.set(id, spent + 1);
    inFlight.add(id);
    jobs.push(
      fetchGeometry(storm)
        .then((bundle) => fillEndedTrack(id, bundle))
        .catch((e) => {
          /* Console only. See the header: a finished storm without its trail is
           * a smaller wrong than a finished storm wearing an outage badge. */
          console.warn(
            `[landfall] ${storm.name || id}: could not recover the past track ` +
            `(attempt ${spent + 1} of ${ENDED.trackBackfillAttempts}):`,
            e?.message || e
          );
          return false;
        })
        .finally(() => inFlight.delete(id))
    );
  }

  if (!jobs.length) return 0;
  const results = await Promise.all(jobs);
  return results.filter(Boolean).length;
}

/** Test seam, matching `resetLifecycle`. Clears the session counters so a suite
 *  can run scenarios in sequence without one bleeding into the next. */
export function _resetBackfill() {
  attempts.clear();
  inFlight.clear();
}
