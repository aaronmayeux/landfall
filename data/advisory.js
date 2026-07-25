/**
 * advisory.js — fetch the advisory TEXT for a storm, from whichever agency
 * actually writes one for it (SPEC §16 item 7, Phase 6 step 6).
 *
 * TWO SOURCES, ONE SHAPE. NHC storms get NHC's Public Advisory. GDACS storms
 * get JTWC's warning, because GDACS itself publishes no advisory text at all
 * — checked in four places 2026-07-25, recorded in
 * functions/api/jtwc/inspect.js — while naming JTWC as its source. Everything
 * downstream sees the same record and does not care which agency wrote it.
 *
 * THE RETURN IS A STATE, NOT A THROW. Four of them, and the distinction is
 * the whole point (§5 — "never ship silence on failure"):
 *
 *   ok           the words are here
 *   none_matched nobody is warning on this storm by that name — a real,
 *                honest answer, and NOT a failure
 *   unsupported  this storm cannot have advisory text (no bin number, an
 *                unknown source). Nothing has gone wrong
 *   unavailable  we tried and could not get it. THIS is the failure, and it
 *                is the only one that offers a retry
 *
 * Collapsing `none_matched` into `unavailable` would put a Retry button under
 * a storm that will never have text; collapsing `unavailable` into
 * `none_matched` would tell a reader during a hurricane that no advisory
 * exists when one does. Both are the same §5 bug in opposite directions.
 *
 * WHY A DEGRADED INDEX READS AS `unavailable`. If JTWC's list names five
 * warnings and only four could be read, a name that is not in the four is not
 * evidence of anything — the fifth is exactly where it would be. The relay
 * reports that as `partial` and this file refuses to turn it into a "no
 * warning exists" claim. That is the same mistake step 5 shipped: a coverage
 * limit stated as a data absence.
 *
 * No DOM, ever. Imports: config/, lib/, data/ siblings.
 */

import { ADVISORY_TEXT, ENDPOINT } from '../config/constants.js';
import { extractNhcProduct, nhcAdvisoryNumber, matchJtwcStorm } from '../lib/advisory.js';
import { fetchFeed, fetchText } from './relay.js';

/* --- the per-(storm, advisory) cache ---------------------------------------
 * Keyed on advisoryKey exactly like the geometry cache, so a new advisory
 * self-invalidates and nothing here needs a timer. Failures are cached too —
 * a dead source must not refetch on every render — and the section's Retry
 * evicts, because the control IS the recovery (§5/§7).
 * ------------------------------------------------------------------------ */

const store = new Map();

function cacheGet(key) {
  if (!store.has(key)) return null;
  const v = store.get(key);
  store.delete(key);
  store.set(key, v); // refresh recency
  return v;
}

function cachePut(key, rec) {
  if (store.has(key)) store.delete(key);
  store.set(key, rec);
  while (store.size > ADVISORY_TEXT.lruStorms) {
    store.delete(store.keys().next().value); // oldest first
  }
  return rec;
}

export function evictAdvisory(advisoryKey) {
  store.delete(advisoryKey);
}

/* --- the JTWC name index ---------------------------------------------------
 * ONE copy for the whole app, not one per storm. Resolving a name means
 * reading every active warning, so this is the expensive half and it is
 * shared: selecting a second GDACS storm inside the TTL costs nothing.
 * ------------------------------------------------------------------------ */

let jtwcIndex = null;      // { state, storms, pubDate, fetchedAt }
let jtwcIndexAt = 0;
let jtwcInFlight = null;   // dedupes concurrent selections

async function getJtwcIndex({ force = false } = {}) {
  const fresh = jtwcIndex && Date.now() - jtwcIndexAt < ADVISORY_TEXT.indexTtl;
  if (fresh && !force) return jtwcIndex;
  /* Two storms selected in the same second must not both fetch the index —
   * that is eight upstream reads twice over, on a phone. */
  if (jtwcInFlight && !force) return jtwcInFlight;

  jtwcInFlight = (async () => {
    try {
      const { json } = await fetchFeed(`${ENDPOINT.relay}/jtwc/storms`);
      jtwcIndex = {
        state: json?.state || 'ok',
        storms: Array.isArray(json?.storms) ? json.storms : [],
        pubDate: json?.pubDate || null,
        fetchedAt: json?.fetchedAt || null,
      };
      jtwcIndexAt = Date.now();
      return jtwcIndex;
    } catch (e) {
      /* A failed index is NOT an empty index. Returning `{storms: []}` here
       * is how "we could not reach JTWC" becomes "no storm has a warning",
       * which is the §5 failure this whole file is arranged to avoid. */
      return { state: 'unavailable', storms: [], detail: e?.message || 'failed' };
    } finally {
      jtwcInFlight = null;
    }
  })();

  return jtwcInFlight;
}

/** Drop the shared index so the next call re-reads it. The section's Retry
 *  path calls this — otherwise retrying a storm whose name is missing from a
 *  degraded index would keep matching against the same degraded copy. */
export function evictJtwcIndex() {
  jtwcIndex = null;
  jtwcIndexAt = 0;
}

/* --- the two source paths --------------------------------------------------- */

async function fetchNhcAdvisory(storm) {
  const bin = storm?.raw?.binNumber;
  if (!bin) {
    /* An NHC storm with no bin number cannot address a text product. It has
     * not failed at anything — there is simply nothing to ask for. */
    return { state: 'unsupported', reason: 'no_bin' };
  }

  const url =
    `${ENDPOINT.relay}/nhc/advisory?bin=${encodeURIComponent(bin)}` +
    `&kind=${encodeURIComponent(ADVISORY_TEXT.kind)}`;

  const { text: html, relayStale, fetchedAt } = await fetchText(url);
  const product = extractNhcProduct(html);
  if (!product) {
    /* The page came back but held no product. That is a real failure with a
     * real recovery, not an absence — NHC publishes an advisory for every
     * active storm, so an empty one means we got the wrong page or a broken
     * one. Named, and retryable. */
    return { state: 'unavailable', detail: 'no advisory text in the page' };
  }

  return {
    state: 'ok',
    agency: 'nhc',
    text: product.text,
    /* The number the PRODUCT states, which can differ from the feed's — that
     * disagreement is information, and the panel says which it is showing. */
    advisoryNumber: nhcAdvisoryNumber(product.text),
    relayStale,
    fetchedAt,
  };
}

async function fetchJtwcAdvisory(storm, { force = false } = {}) {
  const index = await getJtwcIndex({ force });

  if (index.state === 'unavailable') {
    return { state: 'unavailable', detail: index.detail || 'JTWC list unreachable' };
  }

  const hit = matchJtwcStorm(index.storms, storm?.name);

  if (!hit) {
    /* A SHORT LIST PROVES NOTHING. `partial` means products were listed that
     * would not read, so the missing name could be sitting in one of them. */
    if (index.state === 'partial') {
      return { state: 'unavailable', detail: 'JTWC list came back incomplete' };
    }
    return { state: 'none_matched', agency: 'jtwc' };
  }

  const { text, relayStale, fetchedAt } = await fetchText(
    `${ENDPOINT.relay}/jtwc/warning?product=${encodeURIComponent(hit.product)}`
  );

  if (!text || text.length < 200) {
    return { state: 'unavailable', detail: 'JTWC warning came back empty' };
  }

  return {
    state: 'ok',
    agency: 'jtwc',
    text: text.replace(/\r\n?/g, '\n').trimEnd(),
    designation: hit.designation,
    advisoryNumber: hit.warningNumber,
    relayStale,
    fetchedAt,
  };
}

/* --- the one entry point ---------------------------------------------------- */

/**
 * The advisory text record for a storm.
 *
 * Never throws. Every outcome — including every failure — comes back as one
 * of the four states, because a surface that must render loading, empty, and
 * error explicitly (§5) is easier to get right when the data layer has
 * already made that choice than when the view has to interpret an exception.
 *
 * @param {object} storm
 * @param {{retry?: boolean}} [opts] retry evicts this storm's cached record
 *   AND the shared JTWC index — the control is the recovery.
 */
export async function fetchAdvisory(storm, { retry = false } = {}) {
  if (!storm) return { state: 'unsupported', reason: 'no_storm' };

  const key = storm.advisoryKey;
  if (retry) {
    evictAdvisory(key);
    evictJtwcIndex();
  } else {
    const cached = cacheGet(key);
    if (cached) return cached;
  }

  let rec;
  try {
    if (storm.source === 'nhc') {
      rec = await fetchNhcAdvisory(storm);
    } else if (storm.source === 'gdacs') {
      rec = await fetchJtwcAdvisory(storm, { force: retry });
    } else {
      /* An unknown source is nothing to ask for, not a breakage. Same read
       * the geometry pipeline takes on the same case. */
      rec = { state: 'unsupported', reason: 'unknown_source' };
    }
  } catch (e) {
    rec = { state: 'unavailable', detail: e?.message || 'failed' };
  }

  return cachePut(key, rec);
}
