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
 *  - BOTH SOURCES. This said "NHC storms only" for a while after the code
 *    below had already stopped being NHC-only — GDACS geometry ships and is
 *    warmed exactly like NHC's, because both fetchers return the identical
 *    bundle shape. The only source-aware line is which fetcher to call.
 *  - Cache-first, and the CACHE decides: `geometryNeedsFetch` answers whether
 *    this storm's current advisory is already held, or was attempted recently
 *    enough to leave alone. A dead layer must not refetch on every poll (§7),
 *    and an attempt that came back EMPTY must not be treated as settled until
 *    the next advisory — data/cache.js carries the measurement behind that
 *    distinction.
 *  - A FAILED WARM STILL PAINTS. If the storm has good geometry from an
 *    earlier advisory, `putGeometry` hands it back and the map keeps drawing
 *    it (§5). Losing a fetch is not a reason to erase a cone.
 *  - Bounded concurrency (constants), sequential-ish on purpose: this rides
 *    a phone radio alongside tiles.
 *  - One run at a time. A poll landing mid-warm queues a re-run rather than
 *    racing the first.
 *
 * No DOM, ever. Imports: config/, data/ siblings.
 */

import { CACHE } from '../config/constants.js';
import { getGeometry, putGeometry, geometryNeedsFetch } from './cache.js';
import { fetchStormGeometry } from './nhc-mapserver.js';
import { fetchGdacsGeometry } from './gdacs-geometry.js';

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
    /* BOTH SOURCES now (§14). They return the same bundle shape, so the
     * only source-aware line is which fetcher to call. */
    const queue = (storms || []).filter(
      (s) => s.source === 'nhc' || s.source === 'gdacs'
    );
    const workers = Array.from(
      { length: Math.min(CACHE.geometryWarmConcurrency, queue.length) },
      async () => {
        while (queue.length) {
          const storm = queue.shift();
          if (!geometryNeedsFetch(storm.id, storm.advisoryKey)) {
            /* Already held, or attempted too recently to be worth asking
             * again. Repaint from what we have either way — an ambient layer
             * that was cleared by a style reload needs the push. */
            const held = getGeometry(storm.id);
            if (held && !held.error) onBundle?.(storm, held);
            continue;
          }
          try {
            const bundle = await (storm.source === 'gdacs'
              ? fetchGdacsGeometry(storm)
              : fetchStormGeometry(storm));
            /* putGeometry returns what to DRAW, which is not always what we
             * just fetched: an empty answer loses to geometry we already
             * hold (data/cache.js). Painting the return value rather than
             * `bundle` is what keeps a storm on screen across a basin
             * change. */
            const draw = putGeometry(storm.id, bundle, storm.advisoryKey);
            if (draw && !draw.error) onBundle?.(storm, draw);
          } catch (e) {
            /* Warm failures are quiet by design: nothing on screen promised
             * this data yet. The attempt is recorded so the next poll doesn't
             * hammer a dead endpoint, and any geometry already held survives
             * it and keeps drawing (§5). */
            console.warn(`[landfall] warm geometry failed for ${storm.id}:`, e?.message || e);
            const draw = putGeometry(storm.id, { error: e?.message || 'failed' }, storm.advisoryKey);
            if (draw && !draw.error) onBundle?.(storm, draw);
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
