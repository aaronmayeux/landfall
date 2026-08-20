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
import { extractNhcProduct, nhcAdvisoryNumber, nhcGustKt, matchJtwcStorm } from '../lib/advisory.js';
import { fetchText } from './relay.js';
import { getJtwcIndex, evictJtwcIndex } from './jtwc-index.js';

/* Re-exported so the advisory section's Retry keeps one import site. The
 * index itself now lives in data/jtwc-index.js — model tracks needs it too. */
export { evictJtwcIndex };

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

/* --- the gust, out of a second NHC product -----------------------------------
 *
 * ==> A SEPARATE CACHE, BECAUSE IT IS A SEPARATE PAGE. <== The store above is
 * keyed on `advisoryKey` and holds the PUBLIC advisory. The gust comes out of
 * the coded FORECAST advisory (`lib/advisory.js` `nhcGustKt` explains why it
 * has to), which is a different URL under the same key. Sharing one map would
 * mean the second read evicting the first and the panel refetching the
 * advisory text every time it rendered a wind row.
 * ------------------------------------------------------------------------ */

const gustStore = new Map();

export function evictNhcGust(advisoryKey) {
  gustStore.delete(advisoryKey);
}

/**
 * The gust for an NHC storm, in knots, or null.
 *
 * ==> LAZY, AND ONLY EVER FROM THE DRAWER. <== `observeDeclarations` already
 * reads one text product per NHC storm on a poll, unprompted, for every storm
 * in the list. Adding a second one there would double a cost nobody asked for
 * on behalf of a row most readers never scroll to. This is called when a storm
 * panel opens, so a reader who never taps a storm pays nothing, and the result
 * is cached per advisory — six hours — so stepping between two storms and back
 * costs one round trip each and no more.
 *
 * NULL COVERS BOTH "NO GUST STATED" AND "COULD NOT READ IT", DELIBERATELY, and
 * this is the one place in this file that collapses two states on purpose. The
 * distinction earns its keep when a reader is looking at a section and needs to
 * know whether to retry; it does not earn its keep for ONE ROW inside a section
 * that has already rendered from a different source. A failed gust read leaves
 * the Winds row exactly as it was, which is the honest picture — we know the
 * wind, we do not know the gust. There is nothing for a Retry button to be
 * attached to and nothing a reader could do with the difference.
 *
 * FAILURES ARE CACHED like every other read here. A dead product must not be
 * refetched on every repaint.
 */
export async function fetchNhcGustKt(storm) {
  if (!storm || storm.source !== 'nhc') return null;
  const bin = storm.raw?.binNumber;
  const key = storm.advisoryKey;
  if (!bin || !key) return null;

  if (gustStore.has(key)) {
    const v = gustStore.get(key);
    gustStore.delete(key);
    gustStore.set(key, v);
    return v;
  }

  let kt = null;
  try {
    const { text: html } = await fetchText(
      `${ENDPOINT.relay}/nhc/advisory?bin=${encodeURIComponent(bin)}&kind=TCM`
    );
    const product = extractNhcProduct(html);
    kt = product ? nhcGustKt(product.text) : null;
  } catch {
    kt = null;
  }

  gustStore.set(key, kt);
  while (gustStore.size > ADVISORY_TEXT.lruStorms) {
    gustStore.delete(gustStore.keys().next().value);
  }
  return kt;
}
