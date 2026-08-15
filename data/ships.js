/**
 * ships.js — the environment ribbon's numbers: fetch, cache, and WARM for
 * every storm the layer can draw on. SPEC §47.2, §47.6, §47.7.
 *
 * Sits between the relay route (`/api/nhc/ships`) and the map layer. Owns the
 * network and the cache; owns no parsing and no drawing.
 *
 * ==> THE PARSING HAPPENS IN THE RELAY, AND THAT IS THE ONE PLACE THIS APP
 * DOES THAT. <== §47.7. A SHIPS file is 9–10 KB of fixed-width text per storm
 * per advisory and the numbers out of it are a fraction of that; worse, there
 * is no `latest` alias, so "give me this storm's current run" is a LOOP of up
 * to three fetches at three synoptic hours that only ends when one answers or
 * all three miss. That loop cannot live in a browser without three round trips
 * per storm. What arrives here is already small JSON.
 *
 * WARMED FOR EVERY STORM, BUT ONLY WHILE THE LAYER IS ON. Same shape as model
 * guidance, and for the same two reasons: selecting a storm should colour its
 * cone instantly rather than after a round trip, and fetching for a layer
 * nobody switched on is pure data spend on a phone. The row ships OFF. main.js
 * gates the call; this module never polls on its own.
 *
 * FOUR STATES, NEVER TWO (§5). An empty cone looks identical however it got
 * that way, so each way is its own status and the layer row says which:
 *   ok            — a run is published and parsed
 *   basin         — SHIPS does not cover this basin. Permanent, not a failure.
 *   no_run        — inside a covered basin, no run published for this storm
 *                   yet. A fresh depression gets advisories before its first
 *                   run, and that state is measured in hours.
 *   unavailable   — the fetch or the relay failed. Retryable.
 *
 * ==> A SINGLE 404 IS NOT AN OUTAGE AND THIS FILE NEVER SEES ONE. <== §47.2:
 * the newest synoptic slot alone answers 77% of the time, two cover 98%, three
 * cover 99.1%. The relay tries all three and only then says no run is
 * published, so `no_run` here already means all three missed.
 *
 * No DOM, ever. Imports: config/, data/ siblings.
 */

import { CACHE, ENDPOINT, ENV_RIBBON, POLL } from '../config/constants.js';

/* ---------------------------------------------------------------------------
 * THE CACHE — keyed per (storm, advisory), like every other per-storm cache in
 * the app. A new advisory changes `advisoryKey`, so the entry misses naturally
 * and there is nothing to evict on a schedule.
 *
 * A SHIPS RUN AND AN ADVISORY DO NOT ARRIVE TOGETHER, and keying on the
 * advisory is still right. SHIPS can be NEWER than the advisory — a 06 UTC run
 * against a 00 UTC advisory, measured on a real storm (§47.2) — so a new run
 * can land while the key is unchanged and go unseen until the next advisory.
 * That is a wait of at most six hours for a colour that moves a few knots, on
 * a layer that reports a six-hourly product. Keying on the clock instead would
 * refetch every storm on every poll to discover nothing had changed.
 * ------------------------------------------------------------------------- */

const store = new Map(); // advisoryKey -> result

/** Bounded, like every cache in this project. Insertion order is the eviction
 *  order — a Map iterates oldest-first, which is a good enough LRU for a list
 *  holding one entry per live storm. */
function put(key, value) {
  store.delete(key);
  store.set(key, value);
  while (store.size > CACHE.geometryLruStorms) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
}

export const getShips = (key) => store.get(key) || null;

/** Drop one entry so the next request refetches. The Layers row's retry path
 *  (the toggle IS the recovery) is the only caller. */
export function evictShips(key) {
  store.delete(key);
}

/** Test seam, and the reason it exists is that this store is module state:
 *  two suites in one process would otherwise inherit each other's runs. */
export function resetShips() {
  store.clear();
}

/* ---------------------------------------------------------------------------
 * THE FETCH
 * ------------------------------------------------------------------------- */

/**
 * One storm's SHIPS run.
 *
 * NEVER THROWS. Every failure comes back as a status, because a thrown error
 * would have to be caught identically by the warm loop and the retry path, and
 * two catch blocks drift.
 *
 * ==> NON-NHC STORMS ARE ANSWERED WITHOUT A REQUEST. <== SHIPS covers the
 * Atlantic and the East and Central Pacific and nothing else (§47.6), and a
 * GDACS storm is by definition outside those basins — NHC takes priority in
 * its own. Asking the relay would spend a round trip per typhoon per poll to
 * be told a fact this app already knows. The relay still answers
 * `basin_not_covered` for anything that does reach it, so the two agree.
 */
export async function fetchShips(storm) {
  if (!storm || storm.source !== 'nhc' || !storm.sourceId) {
    return { status: 'basin', run: null, fetchedAt: null, stale: false };
  }

  const url = `${ENDPOINT.relay}/nhc/ships?id=${encodeURIComponent(storm.sourceId)}`;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), POLL.fetchTimeout);
  let res;
  try {
    res = await fetch(url, { cache: 'no-store', signal: ctl.signal });
  } catch (e) {
    /* Named in human terms right here — §5 forbids raw exception text reaching
     * a surface, and 'AbortError' is exactly that. */
    return fail(e?.name === 'AbortError' ? 'timed out' : 'network error');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) return fail(`HTTP ${res.status}`);

  let body;
  try {
    body = await res.json();
  } catch {
    return fail('unreadable response');
  }

  const fetchedAt = res.headers.get('X-Landfall-Fetched-At') || null;
  const stale = res.headers.get('X-Landfall-Stale') === 'true';

  /* ==> THE RELAY'S THREE ANSWERS ARE PASSED THROUGH, NOT REINTERPRETED. <==
   * `basin_not_covered` and `no_run_published` arrive as HTTP 200 on purpose:
   * they are answers about the world, not failures of ours, and turning either
   * into an error here would put a Retry button on a row that has nothing to
   * retry. */
  if (body?.status === 'basin_not_covered') {
    return { status: 'basin', run: null, fetchedAt, stale };
  }
  if (body?.status === 'no_run_published') {
    return { status: 'no_run', run: null, fetchedAt, stale };
  }
  if (body?.status !== 'ok') return fail('unexpected answer');

  return { status: 'ok', run: body, fetchedAt, stale };
}

const fail = (error) => ({ status: 'unavailable', run: null, error, fetchedAt: null, stale: false });

/* ---------------------------------------------------------------------------
 * WARMING
 *
 * The same shape data/adeck.js uses, which is the same shape data/warm.js uses
 * for geometry bundles: bounded concurrency, cache-first, one run at a time
 * with a queued re-run. A THIRD copy rather than an extraction, and that is a
 * deliberate call against §12's extract-on-the-second-use rule: the three
 * differ in what they gate on and in how each treats a cached failure, so the
 * shared version would be a helper with three flags, which is three copies
 * wearing one name. If a fourth arrives, extract then.
 * ------------------------------------------------------------------------- */

let running = false;
let rerun = null;

/**
 * Warm the SHIPS run for every storm in the list.
 *
 * `onResult(storm, result)` fires for each storm as its run lands — cached or
 * fresh — so the ribbon paints incrementally rather than waiting on the
 * slowest fetch.
 *
 * CACHED FAILURES ARE SKIPPED BUT RETRIED on the next poll, exactly as model
 * guidance does: nothing taps a warm-only layer, so a permanently-cached
 * failure would mean a layer that went down once and never came back until the
 * advisory changed. `basin` and `no_run` are RESOLVED answers and are kept —
 * a typhoon is not going to move basin, and a storm with no run yet is asked
 * again when its advisory changes.
 */
export async function warmShips(storms, onResult) {
  if (running) {
    rerun = { storms, onResult };
    return;
  }
  running = true;
  try {
    const queue = (storms || []).filter((s) => s && s.advisoryKey);

    const workers = Array.from(
      { length: Math.min(ENV_RIBBON.warmConcurrency, queue.length) },
      async () => {
        while (queue.length) {
          const storm = queue.shift();
          const cached = getShips(storm.advisoryKey);
          if (cached && cached.status !== 'unavailable') {
            onResult?.(storm, cached);
            continue;
          }
          const result = await fetchShips(storm);
          put(storm.advisoryKey, result);
          onResult?.(storm, result);
        }
      }
    );
    await Promise.all(workers);
  } finally {
    running = false;
    if (rerun) {
      const next = rerun;
      rerun = null;
      warmShips(next.storms, next.onResult);
    }
  }
}
