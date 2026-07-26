/**
 * cache.js — each storm's BEST-KNOWN geometry (SPEC §5, §7).
 *
 * ===> THE KEY IS THE STORM, NOT THE ADVISORY, AND THAT CHANGE IS THE WHOLE
 *      FILE. READ THIS BEFORE KEYING IT BACK ON `advisoryKey`. <===
 *
 * It used to be keyed on `advisoryKey` ("nhc:ep062026:031"), which was elegant
 * for one reason — a new advisory self-invalidates, so nothing needed a timer.
 * It also had a failure mode nobody looked for, because a cache that never
 * serves stale data seems obviously safe:
 *
 *   AN EMPTY ANSWER WAS STORED AS A SUCCESS, UNDER A KEY THAT COULD NOT
 *   CHANGE UNTIL THE NEXT ADVISORY.
 *
 * Measured live 2026-07-26. Fausto crossed 140°W, NHC moved his bin from EP1
 * to CP1, and the geometry service had not published the new bin yet. The
 * fetch succeeded and returned nothing. That nothing went into the cache under
 * `nhc:ep062026:031` and became the answer for the next SIX HOURS — the app
 * had drawn his cone and wind field correctly minutes earlier and threw them
 * away because a later, emptier answer arrived. See `data/nhc-mapserver.js`
 * for the address side of the same bug.
 *
 * THE RULE NOW: a storm's geometry only ever gets BETTER. A fetch replaces
 * what is held when it carries features and its own advisory stamp is at
 * least as new. An empty result, or a failed one, never overwrites geometry we
 * already have — it is recorded as an attempt so the app knows to say the data
 * is lagging, and so it knows to try again soon.
 *
 * THIS SURVIVES MORE THAN BASIN CHANGES. Anything that makes the source
 * briefly answer with less than it did a minute ago — a publication gap, a
 * partial deploy on NOAA's side, a bin retired early, a single dropped
 * request — now costs a timestamp on screen instead of a blank map. That is
 * §5's "stale data plus a visible timestamp beats a blank screen", enforced
 * in the one place every geometry read passes through rather than argued for
 * per caller.
 *
 * WHY THERE IS A RETRY WINDOW. Advisory-keyed caching gave "try again" for
 * free: a new key meant a new fetch. Storm-keyed caching does not, so an
 * unsuccessful attempt is stamped with the advisory it was for and the time it
 * happened, and `geometryNeedsFetch` lets it be retried after
 * CACHE.geometryRetryMs rather than at the next advisory. Without that window
 * this file would reproduce the exact six-hour freeze it exists to prevent,
 * just with different bookkeeping.
 *
 * The LRU cap (CACHE.geometryLruStorms) stops unbounded growth across a long
 * session — bound every cache.
 *
 * No DOM, ever. Imports: config/ only.
 */

import { CACHE } from '../config/constants.js';

/**
 * Map preserves insertion order — delete+set on read makes it an LRU.
 * @type {Map<string, {
 *   bundle: object|null,      // best geometry held for this storm
 *   bundleKey: string|null,   // the advisoryKey `bundle` was fetched for
 *   triedKey: string|null,    // the advisoryKey of the most recent attempt
 *   triedAt: number,          // epoch ms of that attempt
 *   error: string|null        // why the most recent attempt failed, if it did
 * }>}
 */
const store = new Map();

/** Does this bundle actually carry drawable geometry? `ok` is the only status
 *  that means features exist — `none` and `unavailable` are both empty, for
 *  different reasons, and neither is worth keeping over something that isn't. */
export function bundleHasFeatures(bundle) {
  if (!bundle || bundle.error || !bundle.layers) return false;
  return Object.values(bundle.layers).some((l) => l?.status === 'ok');
}

/**
 * Which of two bundles should a storm keep? Pure, exported, and tested —
 * this one comparison is the entire never-regress rule and it is worth being
 * able to assert on directly.
 *
 * Order of questions matters:
 *   1. Nothing held → take it, whatever it is. An empty first answer is still
 *      the truth as far as we know it, and the panel says so honestly.
 *   2. Features beat no features, in both directions. THIS IS THE RULE. A
 *      fetch that came back empty loses to geometry we already have, no
 *      matter how new it claims to be.
 *   3. Both empty → take the newer attempt; there is nothing to protect.
 *   4. Both have features → compare the GEOMETRY'S OWN stamp, never the
 *      feed's (§4). `>=` rather than `>` so a re-fetch of the same advisory
 *      still refreshes rather than sticking on the first copy forever.
 *   5. Stamps missing or unreadable → take the newer attempt. An
 *      uncomparable pair is not a reason to freeze; it is a reason to move.
 */
export function preferBundle(held, incoming) {
  if (!held) return incoming;
  if (!incoming) return held;

  const hi = bundleHasFeatures(incoming);
  const hh = bundleHasFeatures(held);
  if (hi !== hh) return hi ? incoming : held;
  if (!hi) return incoming;

  const a = incoming.stamp?.filedate;
  const b = held.stamp?.filedate;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return incoming;
  return a >= b ? incoming : held;
}

/** Internal: LRU touch. */
function touch(stormId, rec) {
  if (store.has(stormId)) store.delete(stormId);
  store.set(stormId, rec);
  while (store.size > CACHE.geometryLruStorms) {
    store.delete(store.keys().next().value); // oldest first
  }
  return rec;
}

/** The full record — what is held, what it was for, and how the last attempt
 *  went. `main.js` needs this to tell the panel it is showing older geometry;
 *  everything else wants `getGeometry` below. */
export function getGeometryRecord(stormId) {
  const rec = store.get(stormId);
  if (!rec) return null;
  return touch(stormId, rec);
}

/**
 * What to DRAW for this storm: the held bundle, or an error record when there
 * has never been one, or null when this storm is unknown. Same three-way shape
 * every caller already branches on.
 */
export function getGeometry(stormId) {
  const rec = getGeometryRecord(stormId);
  if (!rec) return null;
  if (rec.bundle) return rec.bundle;
  return rec.error ? { error: rec.error } : null;
}

/**
 * Record an attempt and return what to draw.
 *
 * @param {string} stormId       the storm's stable id ("nhc:ep062026")
 * @param {object} result        a bundle, or `{ error }`
 * @param {string} advisoryKey   the advisory this attempt was FOR
 * @returns {object} the bundle to draw, or `{ error }` if there is none
 */
export function putGeometry(stormId, result, advisoryKey) {
  const rec = store.get(stormId) || {
    bundle: null, bundleKey: null, triedKey: null, triedAt: 0, error: null,
  };

  rec.triedKey = advisoryKey ?? null;
  rec.triedAt = Date.now();

  if (!result || result.error) {
    /* A FAILED FETCH DOES NOT DELETE GOOD GEOMETRY. The error is recorded so
     * the panel can offer Retry, but a cone that drew a minute ago keeps
     * drawing (§5). When nothing is held, the error IS the answer. */
    rec.error = result?.error || 'failed';
  } else {
    rec.error = null;
    const winner = preferBundle(rec.bundle, result);
    if (winner === result) {
      /* Only a bundle we ACCEPTED sets `bundleKey`. If it were stamped on
       * every attempt, a rejected empty answer would look like this
       * advisory's geometry and `geometryNeedsFetch` would stop asking —
       * which is the six-hour freeze in this file's header, rebuilt. */
      rec.bundle = result;
      rec.bundleKey = advisoryKey ?? null;
    } else {
      /* Kept what we had. Worth one console line and only one: on a basin
       * change this is the difference between a map that works and a map that
       * silently blanks, and it should be visible when someone is looking. */
      const from = rec.bundle?.bin;
      const to = result?.bin;
      console.warn(
        `[landfall] ${stormId}: fetch returned no usable geometry` +
          (from && to && from !== to ? ` (bin ${from} → ${to})` : '') +
          `; keeping advisory ${rec.bundle?.stamp?.advisnum ?? '?'}`
      );
    }
  }

  touch(stormId, rec);
  return rec.bundle || { error: rec.error || 'failed' };
}

/**
 * Should this storm be fetched right now?
 *
 * False only when we already hold THIS advisory's geometry, or when the last
 * attempt for this advisory was recent enough to leave alone. Everything else
 * — a new advisory, an attempt that came back empty a while ago, a failure —
 * is worth another ask.
 */
export function geometryNeedsFetch(stormId, advisoryKey, now = Date.now()) {
  const rec = store.get(stormId);
  if (!rec) return true;
  if (rec.bundle && rec.bundleKey === advisoryKey) return false;
  if (rec.triedKey === advisoryKey && now - rec.triedAt < CACHE.geometryRetryMs) return false;
  return true;
}

/** Explicit retry path: the Retry button and re-selection drop the storm
 *  entirely — including good geometry — so the next fetch is real and its
 *  answer is believed. The toggle is the recovery (SPEC §5/§7). */
export function evictGeometry(stormId) {
  store.delete(stormId);
}

/** Test seam. Nothing in the app calls this. */
export function _resetGeometryCache() {
  store.clear();
}
