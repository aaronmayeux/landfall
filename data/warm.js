/**
 * warm.js — keep per-storm geometry WARM for every NHC storm (SPEC §9).
 *
 * The zoom ladder makes tracks and cones AMBIENT detail — past track from
 * the basin band, cone/forecast from the regional band — for every storm in
 * view, not just the tapped one. That only works if the geometry is already
 * here, so this module prefetches bundles into data/cache.js as soon as the
 * feed lands, and selection becomes a cache hit instead of a spinner.
 *
 * Rules:
 *  - NHC storms only. GDACS has no MapServer geometry (its wind-band product
 *    is Phase 6).
 *  - Cache-first: a storm whose current advisoryKey is already cached (even
 *    as a FAILURE) is skipped — a dead layer must not refetch on every poll
 *    (§7); selection's retry path is what clears failures. A NEW advisory
 *    needs no eviction: the key changes and misses naturally.
 *  - Bounded concurrency (constants), sequential-ish on purpose: this rides
 *    a phone radio alongside tiles.
 *  - One run at a time. A poll landing mid-warm queues a re-run rather than
 *    racing the first.
 *
 * No DOM, ever. Imports: config/, data/ siblings.
 */

import { CACHE } from '../config/constants.js';
import { getGeometry, putGeometry } from './cache.js';
import { fetchStormGeometry } from './nhc-mapserver.js';

let running = false;
let rerun = null; // queued args when a poll lands mid-run

/**
 * Warm the cache for the given storms. Calls `onBundle(storm, bundle)` for
 * every bundle that becomes available — cached or freshly fetched — so the
 * caller can paint ambient layers incrementally instead of waiting for the
 * slowest storm.
 */
export async function warmGeometry(storms, onBundle) {
  if (running) {
    rerun = { storms, onBundle };
    return;
  }
  running = true;
  try {
    const queue = (storms || []).filter((s) => s.source === 'nhc');
    const workers = Array.from(
      { length: Math.min(CACHE.geometryWarmConcurrency, queue.length) },
      async () => {
        while (queue.length) {
          const storm = queue.shift();
          const cached = getGeometry(storm.advisoryKey);
          if (cached) {
            if (!cached.error) onBundle?.(storm, cached);
            continue; // cached failure: skipped, selection retries it (§7)
          }
          try {
            const bundle = await fetchStormGeometry(storm);
            putGeometry(storm.advisoryKey, bundle);
            onBundle?.(storm, bundle);
          } catch (e) {
            /* Warm failures are quiet by design: nothing on screen promised
             * this data yet. Cache the failure so the next poll doesn't
             * hammer a dead endpoint; selection surfaces and retries it. */
            console.warn(`[landfall] warm geometry failed for ${storm.id}:`, e?.message || e);
            putGeometry(storm.advisoryKey, { error: e?.message || 'failed' });
          }
        }
      }
    );
    await Promise.all(workers);
  } finally {
    running = false;
    if (rerun) {
      const next = rerun;
      rerun = null;
      warmGeometry(next.storms, next.onBundle);
    }
  }
}
