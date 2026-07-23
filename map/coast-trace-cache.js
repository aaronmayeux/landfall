/**
 * coast-trace-cache.js — keeps the BEST trace achieved so far, per storm.
 *
 * WHY THIS EXISTS. Coastline vertices come from LOADED tiles only
 * (map/coast-source.js). That makes any single trace attempt a function of
 * where the camera happened to be:
 *
 *   zoomed into the warning area -> lots of coast -> a good trace
 *   zoomed out to the basin      -> coarse tiles  -> a blocky trace
 *   panned so half is off-screen -> half the coast -> a failed trace
 *
 * Re-tracing on every camera move would therefore make the stripe visibly
 * DEGRADE as you zoom out — geometry rewriting itself under the user reads as
 * a rendering bug, and per §5 a confident-looking wrong line is worse than an
 * honest one.
 *
 * THE RULE: A TRACE MAY ONLY IMPROVE. Keep the best result per storm; replace
 * it only when a new attempt is strictly better. Never regress, so the stripe
 * only ever gets sharper as tiles load.
 *
 * "Better" is: more segments successfully traced, and on a tie, more total
 * vertices (a denser walk of the same coast is a finer one). Vertex count is
 * the tiebreak and never the primary test — a single long wrong walk could
 * out-vertex a correct trace, but it cannot out-COUNT it, and the count is
 * gated by every rejection rule in coast-trace.js.
 *
 * Invalidation is by advisory stamp: new NHC geometry means the old trace
 * describes a warning that no longer exists, however good it was.
 *
 * Imports: map/ siblings + config. No DOM.
 */

import { coastRings } from './coast-source.js';
import { traceSegments } from './coast-trace.js';

/** stormKey -> { stamp, result, score } */
const cache = new Map();

/** Higher is better. Segments traced dominates; vertices break ties. */
function scoreOf(result) {
  const vertices = result.features.reduce(
    (n, f) => n + (f.geometry?.coordinates?.length || 0),
    0
  );
  return { traced: result.tracedCount, vertices };
}

function better(a, b) {
  if (!b) return true;
  if (a.traced !== b.traced) return a.traced > b.traced;
  return a.vertices > b.vertices;
}

/**
 * Trace, or return a previously better trace.
 *
 * @param {object} map        MapLibre map (queried for loaded coastline)
 * @param {string} key        cache key — storm id, or 'ambient'
 * @param {Array}  features   raw NHC watch/warning features
 * @param {string} stamp      advisory identity; a change clears the entry
 * @returns {{features, traced, tracedCount, total, fromCache: boolean}}
 */
export function tracedFor(map, key, features, stamp) {
  const list = features || [];
  if (!list.length) {
    cache.delete(key);
    return { features: [], traced: false, tracedCount: 0, total: 0, fromCache: false };
  }

  const prev = cache.get(key);
  if (prev && prev.stamp !== stamp) cache.delete(key);

  const held = cache.get(key);
  const { rings } = coastRings(map);

  /* No coast loaded right now. If a good trace is already held, keep showing
   * it — it was traced against real coastline and is still correct geometry.
   * Otherwise fall through so the delivered chords are returned, flagged. */
  if (!rings.length && held) {
    return { ...held.result, fromCache: true };
  }

  const attempt = traceSegments(list, rings);
  const score = scoreOf(attempt);

  if (!held || better(score, held.score)) {
    cache.set(key, { stamp, result: attempt, score });
    return { ...attempt, fromCache: false };
  }

  return { ...held.result, fromCache: true };
}

/** Drop a storm's trace — selection closed, or the storm left the feed. */
export function forgetTrace(key) {
  cache.delete(key);
}

/** Drop everything. Used when the basemap style reloads and every cached
 *  trace was made against vertices that no longer exist. */
export function clearTraces() {
  cache.clear();
}
