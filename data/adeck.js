/**
 * adeck.js — model guidance tracks: fetch, cache, and WARM for every storm.
 *
 * Sits between the relay route (`/api/nhc/adeck`) and the map layer. Owns the
 * network and the cache; owns no parsing (lib/adeck.js) and no drawing
 * (map/layers/model-tracks.js).
 *
 * WARMED FOR EVERY STORM, NOT FETCHED ON SELECTION (Aaron, 2026-07-25).
 * §7 describes model tracks as an on-demand layer and this deviates from that
 * deliberately: selecting a storm should show its guidance instantly, the same
 * way MapServer geometry became ambient in Phase 4. The spinner-on-tap version
 * was built first and the call went the other way before it ever reached
 * glass. §7's line is stale; this file is the as-built.
 *
 * BUT ONLY WHILE THE LAYER IS ON. Warming decks for a layer nobody switched on
 * is pure data spend on a phone, and the toggle ships OFF. main.js gates the
 * call; this module never polls on its own.
 *
 * THE PAYLOAD IS WHY THE RELAY FILTERS. A raw deck is a few MB and a busy
 * season is nine storms at once. The relay drops every model outside the
 * shortlist before it reaches the wire — argued in full at the top of
 * functions/api/nhc/adeck.js, and reachable unfiltered via `?full=1`.
 *
 * THREE STATES, NEVER TWO (§5). The map cannot tell "no guidance published"
 * from "the fetch died" from "this source has none", and all three look
 * identical as an empty map. Each is a distinct status here:
 *   ok           — tracks parsed and present
 *   none         — the deck exists and holds nothing we draw, or NOAA has no
 *                  deck yet (a storm that just formed)
 *   unsupported  — GDACS. Permanent, and not a failure.
 *   unavailable  — the fetch or the parse failed. Retryable.
 *
 * No DOM, ever. Imports: config/, lib/, data/ siblings.
 */

import { CACHE, ENDPOINT, MODEL_TRACKS, POLL } from '../config/constants.js';
import { matchStormByName } from '../lib/advisory.js';
import { getTcgpIndex } from './tcgp-index.js';
import { parseAdeck } from '../lib/adeck.js';

/* ---------------------------------------------------------------------------
 * THE CACHE — keyed per (storm, advisory), like every other per-storm cache
 * in the app. A new advisory changes advisoryKey, so the entry misses
 * naturally and there is nothing to evict on a schedule (§7).
 * ------------------------------------------------------------------------- */

const store = new Map(); // advisoryKey -> result

/** Bounded, like every cache in this project (§7). Insertion order is the
 *  eviction order — a Map iterates oldest-first, which is a good enough LRU
 *  for a list that only ever holds one entry per live storm. */
function put(key, value) {
  store.delete(key);
  store.set(key, value);
  while (store.size > CACHE.geometryLruStorms) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
}

export const getAdeck = (key) => store.get(key) || null;

/** Drop one entry so the next request refetches. The Layers row's retry path
 *  (§7 — the toggle IS the recovery) is the only caller. */
export function evictAdeck(key) {
  store.delete(key);
}

/* ---------------------------------------------------------------------------
 * THE FETCH
 * ------------------------------------------------------------------------- */

/**
 * Model guidance for one storm.
 *
 * @returns {Promise<{status, tracks, error, fetchedAt, stale}>}
 *
 * NEVER THROWS. Every failure comes back as a status, because a thrown error
 * here would have to be caught identically by the warm loop and the retry
 * path, and two catch blocks drift. The layer and the row both read `status`.
 */
/**
 * Which relay can answer for this storm, and under what id.
 *
 * ==> THIS USED TO BE A FLAT REFUSAL, AND THE REFUSAL WAS TRUE <==
 * Every non-NHC storm returned `unsupported` on the reasoning that GDACS
 * publishes no model guidance. GDACS still doesn't — but that was never the
 * question. The question is whether guidance EXISTS for the storm, and for
 * West Pacific, North Indian and Southern Hemisphere storms it does: UCAR's
 * TCGP publishes ATCF a-decks for exactly the basins NOAA's public directory
 * leaves out (§15, measured 2026-07-26 on Noul).
 *
 * The old note is kept in mind rather than deleted from memory: a source
 * limitation and a coverage limitation look identical from the outside, and
 * this one was the second kind wearing the first one's words for a month.
 *
 * ==> THE JOIN, AND WHY IT NEEDS A NETWORK CALL <==
 * TCGP names its file after the ATCF id (`awp112026.dat`). GDACS does not
 * publish one — its `sourceid` is an empty string. The designation lives only
 * inside JTWC's warning header, which is what `data/jtwc-index.js` reads.
 * So resolving a GDACS storm to a deck is asynchronous and can itself fail,
 * which is why this returns a STATUS and not just a URL.
 *
 * @returns {Promise<{url: string}|{status: string}>}
 */
async function resolveDeck(storm) {
  if (storm.source === 'nhc') {
    return { url: `${ENDPOINT.relay}/nhc/adeck?storm=${encodeURIComponent(storm.sourceId)}` };
  }

  /* ==> ASK TCGP WHICH STORMS TCGP HAS DECKS FOR <==
   * This used to ask JTWC's LIVE WARNING FEED for a designation and build the
   * filename from it. That worked and was wrong: the deck lives at TCGP, so
   * borrowing its identifier from the Navy added a second liveness condition
   * nobody wrote down. When JTWC issued its final warning on Noul — 20 kt and
   * inland — the designation disappeared and the app stopped even ATTEMPTING
   * a fetch that would have succeeded, while a current 12Z deck sat there
   * readable. Seen on glass 2026-07-26.
   *
   * TCGP publishes its own current-storms list, with the deck id in every
   * link. That is the same source, answering the same question, and it cannot
   * go stale independently of the thing it describes. */
  const index = await getTcgpIndex();

  const hit = matchStormByName(index.storms, storm?.name);
  if (!hit) {
    /* A DEGRADED INDEX IS NOT EVIDENCE OF ABSENCE. A missing name in a failed
     * or partial list says nothing about whether a deck exists, so it reads
     * `unavailable` (retryable) rather than `none` (settled). */
    if (index.state !== 'ok') return { status: 'unavailable' };
    /* A healthy list that does not carry this storm means TCGP files no deck
     * for it — an invest it has not opened a page for, or a basin it does not
     * cover. Nothing to fetch and nothing broken. */
    return { status: 'none' };
  }

  if (!hit.id) return { status: 'none' };

  return { url: `${ENDPOINT.relay}/tcgp/adeck?storm=${encodeURIComponent(hit.id)}` };
}

/**
 * Model guidance for one storm.
 *
 * @returns {Promise<{status, tracks, error, fetchedAt, stale}>}
 *
 * NEVER THROWS. Every failure comes back as a status, because a thrown error
 * here would have to be caught identically by the warm loop and the retry
 * path, and two catch blocks drift. The layer and the row both read `status`.
 */
export async function fetchModelTracks(storm) {
  let resolved;
  try {
    resolved = await resolveDeck(storm);
  } catch (e) {
    return {
      status: 'unavailable', tracks: [], error: e?.message || 'failed',
      fetchedAt: null, stale: false,
    };
  }

  if (!resolved.url) {
    return {
      status: resolved.status, tracks: [], error: null, fetchedAt: null, stale: false,
    };
  }

  const url = resolved.url;

  let text;
  let fetchedAt = null;
  let stale = false;
  try {
    const res = await fetchDeckText(url);
    text = res.text;
    fetchedAt = res.fetchedAt;
    stale = res.stale;
  } catch (e) {
    return {
      status: 'unavailable',
      tracks: [],
      error: e?.message || 'failed',
      fetchedAt: null,
      stale: false,
    };
  }

  /* An empty body is the relay's `none` (NOAA has no deck for this storm
   * yet), and it is a legitimate state — a storm that formed an hour ago has
   * had no guidance run against it. Distinguished from a failure so the row
   * can say "no guidance published yet" instead of offering a retry that
   * cannot help. */
  if (!text.trim()) {
    return { status: 'none', tracks: [], error: null, fetchedAt, stale };
  }

  let tracks;
  try {
    tracks = parseAdeck(text, {
      cur: Number.isFinite(storm.lat) && Number.isFinite(storm.lon)
        ? { lon: storm.lon, lat: storm.lat }
        : null,
      headingDeg: Number.isFinite(storm.headingDeg) ? storm.headingDeg : null,
    });
  } catch (e) {
    /* The parser is written not to throw on bad rows, so reaching here means
     * something structural. Named on the console because the row only says
     * WHICH layer failed, not why — the debuggable-on-a-phone seam (§4). */
    console.warn(`[landfall] a-deck parse failed for ${storm.id}:`, e?.message || e);
    return {
      status: 'unavailable',
      tracks: [],
      error: 'could not read the guidance file',
      fetchedAt,
      stale,
    };
  }

  return {
    /* A deck that parsed but yielded nothing we draw is `none`, not a
     * failure: every model in it may be stale, or outside the shortlist.
     * Retrying would fetch the identical bytes. */
    status: tracks.length ? 'ok' : 'none',
    tracks,
    error: null,
    fetchedAt,
    stale,
  };
}

/**
 * The deck is TEXT, and data/relay.js's `fetchFeed` insists on JSON.
 *
 * NOT ROUTED THROUGH fetchFeed, and not because of laziness: its JSON parse is
 * a real guard for the feeds — it is what catches a 200 carrying an upstream
 * error page — and loosening it to accommodate one text endpoint would weaken
 * the check for the two feeds that actually need it. The deck's equivalent
 * guard lives in the relay route, which refuses to serve a body that does not
 * look like an ATCF deck.
 *
 * THE TIMEOUT IS NOT OPTIONAL AND IS THE REASON THIS IS NOT A BARE `fetch`.
 * Warming runs unattended in the background; a request that hangs with no
 * abort leaves the worker slot occupied forever, the Layers row stuck on
 * "Loading…", and — because the warm loop is one-at-a-time — every remaining
 * storm's deck permanently unfetched behind it. A phone that walks out of
 * signal is not an edge case during a hurricane; it is the expected case.
 *
 * NO RETRY LOOP HERE, deliberately, and this is where it differs from the
 * feeds. `fetchFeed` retries at 5/15/45s because a missing storm list blanks
 * the app. A missing deck costs one layer on one storm, the warm pass runs
 * again on the next poll, and the row offers a tap-to-retry in the meantime —
 * so backing off politely beats hammering a dead endpoint with megabyte
 * requests from a phone.
 */
async function fetchDeckText(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), POLL.fetchTimeout);
  let res;
  try {
    res = await fetch(url, { cache: 'no-store', signal: ctl.signal });
  } catch (e) {
    /* Named in human terms right here — §5 forbids raw exception text
     * reaching a surface, and 'AbortError' is exactly that. */
    throw new Error(e?.name === 'AbortError' ? 'timed out' : 'network error');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  /* Reading the BODY can hang too, long after the headers arrived, and the
   * abort signal above no longer covers it — the timer has already fired and
   * been cleared. A deck is megabytes on a bad connection, so this is the
   * likelier of the two stalls, not the theoretical one. */
  const bodyTimer = setTimeout(() => ctl.abort(), POLL.fetchTimeout);
  let text;
  try {
    text = await res.text();
  } catch (e) {
    throw new Error(e?.name === 'AbortError' ? 'timed out' : 'incomplete response');
  } finally {
    clearTimeout(bodyTimer);
  }

  return {
    text,
    fetchedAt: res.headers.get('X-Landfall-Fetched-At') || null,
    stale: res.headers.get('X-Landfall-Stale') === 'true',
  };
}

/* ---------------------------------------------------------------------------
 * WARMING
 *
 * The same shape data/warm.js uses for geometry bundles: bounded concurrency,
 * cache-first, one run at a time with a queued re-run. Deliberately a SECOND
 * copy rather than a shared helper — §12 extracts on the third use, and the
 * two differ in what they gate on (this one only runs while a layer is on)
 * and in how they treat a cached failure.
 * ------------------------------------------------------------------------- */

let running = false;
let rerun = null;

/**
 * Warm model tracks for every storm in the list.
 *
 * `onResult(storm, result)` fires for each storm as its deck lands — cached
 * or fresh — so the map paints incrementally rather than waiting on the
 * slowest fetch.
 *
 * CACHED FAILURES ARE SKIPPED, and unlike geometry they are also RETRIED on
 * the next poll rather than held forever. Geometry caches its failures hard
 * because selection is what retries them; nothing taps a warm-only layer, so
 * a permanently-cached failure would mean a model layer that went down once
 * and never came back until the advisory changed.
 */
export async function warmModelTracks(storms, onResult) {
  if (running) {
    rerun = { storms, onResult };
    return;
  }
  running = true;
  try {
    const queue = (storms || []).filter((s) => s && s.advisoryKey);

    const workers = Array.from(
      { length: Math.min(MODEL_TRACKS.warmConcurrency, queue.length) },
      async () => {
        while (queue.length) {
          const storm = queue.shift();
          const cached = getAdeck(storm.advisoryKey);
          /* A resolved entry is reused. `unavailable` is NOT resolved — see
           * the note above — so it falls through and is tried again. */
          if (cached && cached.status !== 'unavailable') {
            onResult?.(storm, cached);
            continue;
          }
          const result = await fetchModelTracks(storm);
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
      warmModelTracks(next.storms, next.onResult);
    }
  }
}
