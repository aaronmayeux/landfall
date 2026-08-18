/**
 * data/carq.js — fetch each GDACS storm's analysed history, hand it to the
 * pure parser, and attach the result to the storm.
 *
 * The thin async half of lib/carq.js, which holds all the reasoning and every
 * rule. Same split, same reasons and the same shape as data/jtwc-wind.js
 * beside it — read that file's note first; everything it says about why the
 * try/catch is the point applies here word for word.
 *
 * ==> AN ENRICHMENT MUST NEVER COST THE APP A TYPHOON <==
 * The GDACS roster is the ONLY source of storms for every basin outside the
 * Atlantic and eastern Pacific. Past-bead height is a refinement on top of it.
 * So every failure path here returns the storms UNCHANGED, and a storm with no
 * deck behaves exactly as it did before this file existed: its past beads fall
 * back to the class midpoint under `peakWindKt`, which is a known approximation
 * rather than a lie.
 *
 * ==> WHY THIS IS PER-STORM AND THE JTWC JOIN IS NOT <==
 * JTWC's index is ONE document covering every active warning, so that join is
 * a single request however many storms are up. An a-deck is per storm and
 * there is no combined form, so this is one request each. They are small
 * (`?carq=1` returns only the CARQ rows — a handful per cycle against ~15,300
 * in a full deck), colo-cached, and warmed by the cron, but the cost is real
 * and is the reason for `skip` below.
 *
 * No DOM, ever. Imports: data/ and lib/ siblings, plus config.
 */

import { ADVISORY_TEXT, CACHE, ENDPOINT } from '../config/constants.js';
import { parseCarq } from '../lib/carq.js';
import { fetchText } from './relay.js';
import { getTcgpIndex } from './tcgp-index.js';
import { matchStormByName } from '../lib/advisory.js';

/**
 * Decks already parsed this session, keyed by TCGP deck id.
 *
 * A storm's analysed history only grows — a new cycle adds six hours to the
 * back and revises the last day — so re-reading it on every 5-minute poll would
 * spend a request to learn almost nothing. The TTL matches the index's own,
 * because both turn over on the same 6-hourly cycle and two constants free to
 * drift apart would be two answers to one question (§Tuning).
 */
const cache = new Map();

/** ==> THE SAME NUMBER THE INDEX USES, READ FROM THE SAME PLACE. <== This was
 *  a hand-written `15 * 60 * 1000` sitting beside a comment saying it matched
 *  `ADVISORY_TEXT.indexTtl`. It did match, on the day it was written. Two
 *  copies of one number free to drift apart are two answers to one question
 *  (§Tuning), and the drift would show up as a deck the app re-reads on a
 *  different clock from the index that names it. */
const TTL_MS = ADVISORY_TEXT.indexTtl;

/** ==> BOUNDED, LIKE EVERY OTHER CACHE IN THIS PROJECT (§7). <== It was not,
 *  and it is the only per-storm cache here that was not. Insertion order is the
 *  eviction order — a Map iterates oldest-first, which is a good enough LRU for
 *  a list holding one entry per live storm. Same shape as `data/adeck.js` and
 *  `data/ships.js`, deliberately, so all three read as one pattern. */
function put(key, value) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE.geometryLruStorms) {
    cache.delete(cache.keys().next().value); // oldest first
  }
}

/**
 * True when this storm cannot benefit and must not cost a request.
 *
 * NHC PUBLISHES A MEASURED WIND AT EVERY PAST POSITION, so an Atlantic or
 * eastern Pacific storm never reaches the derived path this file exists to
 * fix. Asking TCGP about one would be a request whose answer is guaranteed to
 * change nothing.
 *
 * An ENDED or SILENT storm is skipped for a different reason and it is worth
 * stating so nobody "fixes" it: it draws no ridge at all now
 * (map/storm-mesh.js), so there are no beads for a wind to land on. It keeps
 * its head, its map trail and its list row either way.
 */
function skip(storm) {
  return storm?.source !== 'gdacs';
}

/**
 * One storm's analyses, or null.
 *
 * NEVER THROWS. Every failure — a missing index, an unnamed storm, a deck TCGP
 * does not file, a dead relay — comes back as null and leaves the storm's beads
 * exactly as they were.
 */
async function analysesFor(storm) {
  const index = await getTcgpIndex();
  const hit = matchStormByName(index?.storms, storm?.name);
  /* A DEGRADED INDEX IS NOT EVIDENCE OF ABSENCE, and here that distinction
   * costs nothing to honour: there is no user-facing claim either way, so both
   * cases return null and the beads keep their fallback. Recorded because the
   * same lookup in data/adeck.js DOES have to tell them apart, and a reader
   * moving between the two files should not think one of them is wrong. */
  if (!hit?.id) return null;

  const now = Date.now();
  const cached = cache.get(hit.id);
  if (cached && now - cached.at < TTL_MS) return cached.analyses;

  const url = `${ENDPOINT.relay}/tcgp/adeck?storm=${encodeURIComponent(hit.id)}&carq=1`;
  const { text } = await fetchText(url);
  const analyses = parseCarq(text);

  /* An EMPTY parse is cached too, and deliberately. TCGP files no analysis rows
   * for some storms — an invest it has only just opened a page for. Without
   * this the app would re-ask every poll for a deck that has nothing in it,
   * which is the most pointless request the app could make and the one it would
   * make most often. */
  put(hit.id, { at: now, analyses });
  return analyses;
}

/**
 * @param {object[]} storms normalized GDACS storms
 * @returns {Promise<object[]>} the same storms, each with `carq` set to its
 *          analysed history where one could be read
 */
export async function withCarqHistory(storms) {
  const list = Array.isArray(storms) ? storms : [];
  if (list.length === 0) return list;

  const wanted = list.filter((s) => !skip(s));
  if (wanted.length === 0) return list;

  /* PER STORM, so one dead deck cannot take the others down with it.
   * `allSettled` and not `all`: a single rejection would otherwise discard
   * every history fetched alongside it. */
  const results = await Promise.allSettled(wanted.map((s) => analysesFor(s)));

  const byId = new Map();
  let matched = 0;
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled' || !r.value?.length) return;
    byId.set(wanted[i].id, r.value);
    matched += 1;
  });

  /* DIAGNOSTIC ONLY — there is no user-facing claim to make. A storm without a
   * deck still renders, still has a ridge, and still lifts the cage; it is just
   * doing it from a class midpoint instead of a measured wind. What the console
   * gets is the difference between "TCGP files nothing for these" and "we asked
   * and could not use the answer". Nothing is logged when everything matched: a
   * quiet console is the signal that the join is working. */
  if (wanted.length > 0 && matched < wanted.length) {
    console.warn(
      `[landfall] CARQ history matched ${matched}/${wanted.length} GDACS storms` +
        ' — unmatched storms keep the derived class midpoint (SPEC §4)'
    );
  }

  if (matched === 0) return list;

  /* A NEW OBJECT PER STORM, never a mutation. data/store.js compares list
   * identity to decide what changed, and the storms handed in here may already
   * be referenced by a render in flight. */
  return list.map((s) => (byId.has(s.id) ? { ...s, carq: byId.get(s.id) } : s));
}

/** Drop every parsed deck so the next call re-reads. Retry paths call this. */
export function evictCarq() {
  cache.clear();
}
