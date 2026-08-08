/**
 * _cache-path.js — the one place that names which cache layer answered.
 *
 * WHY THIS FILE EXISTS AT ALL. Three routes had each grown their own private
 * copy of this object, and nine more were about to. Twelve copies of five
 * strings is twelve chances for one of them to say `laststale` or `last_good`
 * and for a header read to quietly stop matching — which is the exact failure
 * this header was added to prevent. §12's rule: any pattern used twice gets
 * extracted before the second use. This is the third.
 *
 * WHAT THE HEADER IS FOR. `X-Landfall-Cache` rides on every relay response and
 * says, in one word, which of five layers produced the body. Without it a
 * stale timestamp is unattributable: you can see that an answer is old, and you
 * cannot see whether it came from this datacentre's slot, the globally warmed
 * copy, the nine-hour last-good slot, or a real fetch. Diagnosing the August
 * 2026 stale-stamp bug took a live measurement precisely because nothing on the
 * wire said which path had run.
 *
 * NOT EVERY ROUTE HAS EVERY LAYER. The geocode route has no KV behind it, so
 * `KV` and `KV_STALE` never appear on its responses. That is
 * fine and expected — a name that never fires is cheaper than a route inventing
 * its own word for the one that does.
 *
 * SELF-CONTAINED, like everything under `functions/` (§3). It imports nothing,
 * and deliberately does NOT live in `_kv-cache.js`: routes with no KV at all
 * need this vocabulary, and importing a file called "kv-cache" to get it would
 * misdescribe what those routes do.
 */

/**
 * The five layers, nearest first. The order below is the order every route
 * tries them in, and reading it top to bottom is the fastest description of
 * the caching design there is.
 */
export const CACHE_PATH = Object.freeze({
  /** L1 — this datacentre's own short-lived slot. Free, and the common case. */
  FRESH: 'fresh',
  /** L2 — the globally warmed KV copy, still inside its freshness window. */
  KV: 'kv',
  /** L1's long-lived slot, served immediately with a refresh running behind it. */
  LAST_GOOD: 'last-good',
  /** The KV copy judged too old, served anyway rather than showing nothing (§5). */
  KV_STALE: 'kv-stale',
  /** No cache had it. A real request to the source just happened. */
  UPSTREAM: 'upstream',
});

/** The header name, so no route types the string. */
export const CACHE_PATH_HEADER = 'X-Landfall-Cache';
