/**
 * cap.js (data) — the CAP alert feed, fetched once and shared. SPEC §50.
 *
 * ONE FETCH FOR THE WHOLE APP, not one per storm. The feed is global and
 * small (8 KB measured), so the list every storm's panel filters is the same
 * list. A per-storm fetch would be the same bytes over and over.
 *
 * ==> NOT PLUMBED THROUGH THE STORM SOURCE TABLE, for `data/genesis.js`'s
 * reason. <== `data/lifecycle.js` treats a source answering without a storm in
 * it as evidence the storm has ended. CAP is not a storm source — it is a list
 * of things agencies said — and letting its silence reach the lifecycle would
 * let a quiet weather office retire a live hurricane.
 *
 * THE THREE STATES ARE KEPT APART (§5, §50.6):
 *   unavailable  the fetch or the parse failed. Say so. NEVER fall through to
 *                "no agency has issued anything".
 *   ok           it answered. `alerts` may legitimately be empty, which means
 *                no country anywhere currently has a cyclone alert in force.
 * The `none_matched` half of the distinction is decided per storm, in
 * `lib/cap.js`, not here — the feed answering globally and this storm's
 * countries having nothing are different facts and the panel words them
 * differently.
 *
 * No DOM. Imports config/, lib/, data/relay.js.
 */

import { ENDPOINT, CACHE } from '../config/constants.js';
import { readAlerts } from '../lib/cap.js';
import { fetchFeed } from './relay.js';

const url = () => `${ENDPOINT.relay}/cap/alerts`;

/** The last answer, with the moment we took it. Shared by every storm panel
 *  opened in this session. */
let cached = null;

/** A fetch already in flight, so opening three storms in a row while the
 *  first request is still out does not fire three of them. */
let inFlight = null;

const slot = (state, alerts, extra = {}) =>
  Object.freeze({ state, alerts, reason: null, fetchedAt: null, stale: false, ...extra });

/**
 * The global alert list.
 *
 * NEVER THROWS. Every failure resolves to an `unavailable` slot carrying the
 * reason in words, because a thrown error here would reach a section whose
 * whole job is to not go silent.
 *
 * @param {{ now?: number, retry?: boolean }} opts
 */
export async function loadAlerts({ now = Date.now(), retry = false } = {}) {
  if (!retry && cached && now - cached.at < CACHE.capClient) return cached.slot;
  if (!retry && inFlight) return inFlight;

  const run = (async () => {
    try {
      const { json, fetchedAt, relayStale } = await fetchFeed(url());

      /* ==> `json`, NOT `data`. <== `data/genesis.js` carries the scar: the
       * relay resolves to `{ json, text, ... }`, an early version there read a
       * property that did not exist, and the undefined body parsed as zero
       * areas and shipped a false all-clear. The shape is checked below rather
       * than assumed for the same reason. */
      const alerts = readAlerts(json, now);

      /* readAlerts returns null for a body it could not read — including
       * ArcGIS's HTTP-200-with-an-error-object — and that is an outage, not an
       * empty sky. */
      if (alerts === null) {
        return slot('unavailable', [], {
          fetchedAt,
          reason: 'the alert list could not be read',
        });
      }

      return slot('ok', alerts, { fetchedAt, stale: !!relayStale });
    } catch (e) {
      return slot('unavailable', [], {
        reason: e?.message
          ? `the alert list could not be fetched (${e.message})`
          : 'the alert list could not be fetched',
      });
    }
  })();

  inFlight = run;
  const result = await run;
  inFlight = null;
  /* A FAILURE IS NOT CACHED. Holding an outage for the client window would
   * make one bad moment last minutes past its recovery, and the retry button
   * in the panel would do nothing visible. */
  if (result.state === 'ok') cached = { at: now, slot: result };
  return result;
}

/** Drop what we hold. For tests and for the replay switch, which changes what
 *  "now" means underneath a cached answer. */
export function resetAlerts() {
  cached = null;
  inFlight = null;
}
