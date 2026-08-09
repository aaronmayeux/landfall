/**
 * genesis.js — the two watch-list sources, fetched and merged. SPEC §45.
 *
 * NOT A STORM SOURCE, AND DELIBERATELY NOT PLUMBED THROUGH ONE. It would have
 * been shorter to add `genesis` alongside `nhc` and `gdacs` in the store's
 * source table and let the existing loop carry it, and it would have been
 * wrong: that table feeds `lastGood`, the merge, and — most importantly —
 * `data/lifecycle.js`, which counts a source answering without a storm in it
 * as EVIDENCE THAT THE STORM HAS ENDED. Handing the lifecycle a list of things
 * that were never storms would let a watched area's absence retire a real
 * hurricane. It lives in its own branch of state for that reason.
 *
 * TWO SOURCES THAT DO NOT SPEAK THE SAME LANGUAGE, AND ARE NOT MADE TO (§45.3).
 * NHC gives a percentage over two and seven days. JTWC gives a word over 24
 * hours. They are merged into ONE LIST for ordering and rendered as what each
 * source actually said, each row labelled with its own source and horizon.
 *
 * THE THREE STATES ARE KEPT APART, PER SOURCE (§45.5):
 *   unavailable  the query errored. Say which source. NEVER fall through to
 *                "nothing is being watched".
 *   none_matched the source answered and published no areas. Real, common,
 *                and completely different from the above.
 *   ok           it answered with areas.
 * Rolling these up into one flag was the first draft and it destroyed the only
 * distinction the section exists to make: on a day with one source down and
 * the other clean, a single flag has to pick between lying and shouting.
 *
 * ONE SOURCE DOWN IS NOT BOTH DOWN. NHC and JTWC cover different halves of the
 * world and are fetched independently, so an NHC outage leaves the West
 * Pacific list intact and says so, exactly as a GDACS outage does for storms.
 *
 * No DOM. Imports config/, lib/, data/relay.js.
 */

import { GENESIS } from '../config/constants.js';
import { normalizeNhcAreas, sortAreas } from '../lib/genesis.js';
import { parseAbpw } from '../lib/abpw.js';
import { fetchFeed, fetchText } from './relay.js';

const NHC_URL = '/api/nhc/genesis?part=areas';
const JTWC_URL = '/api/jtwc/abpw';

/** NHC's outlook. Resolves to a slot; never throws — a thrown error here would
 *  take the JTWC half down with it through `Promise.all`. */
async function fetchNhc() {
  try {
    const { data, fetchedAt, relayStale } = await fetchFeed(NHC_URL);

    /* ArcGIS reports failure as HTTP 200 with an `error` body, and the relay
     * forwards it verbatim precisely so this line can exist. Reading it as a
     * FeatureCollection with no features would turn a refused query into a
     * published all-clear. */
    if (data && data.error) {
      return slot('unavailable', [], { fetchedAt, reason: 'the outlook query was refused' });
    }

    const areas = normalizeNhcAreas(data);

    /* TRUNCATION IS AN OUTAGE, NOT A SHORT LIST. `maxRecordCount` is 2000 and
     * a busy season peaks in single digits, so hitting it exactly means the
     * response was cut and we are looking at a subset without being told. */
    if (areas.length >= GENESIS.maxRecords) {
      return slot('unavailable', [], { fetchedAt, reason: 'the outlook response was truncated' });
    }

    return slot(areas.length ? 'ok' : 'none_matched', areas, { fetchedAt, relayStale });
  } catch (e) {
    return slot('unavailable', [], { reason: e?.message || 'failed' });
  }
}

/** JTWC's bulletin. `parseAbpw` returns a state and never throws, so the only
 *  catch here is the fetch itself. */
async function fetchJtwc() {
  try {
    const { text, fetchedAt, relayStale } = await fetchText(JTWC_URL);
    const parsed = parseAbpw(text);
    return slot(parsed.status, parsed.systems, {
      fetchedAt,
      relayStale,
      issuedAt: parsed.issuedAt,
      reason: parsed.reason,
    });
  } catch (e) {
    return slot('unavailable', [], { reason: e?.message || 'failed' });
  }
}

function slot(status, areas, extra = {}) {
  return {
    status,
    areas,
    fetchedAt: extra.fetchedAt ?? null,
    relayStale: !!extra.relayStale,
    issuedAt: extra.issuedAt ?? null,
    reason: extra.reason ?? null,
  };
}

/**
 * Both sources, in parallel, merged into one ordered list.
 *
 * `status` is the WHOLE section's answer and it is not a fourth vocabulary —
 * it is the same three words applied to the pair:
 *   ok            at least one source published at least one area
 *   none_matched  every source answered, none published anything
 *   unavailable   nothing answered. The only state where the section must
 *                 refuse to imply an all-clear.
 *
 * ==> A PARTIAL OUTAGE IS `ok` OR `none_matched`, NEVER `unavailable`, AND THE
 *     DEAD SOURCE IS NAMED SEPARATELY. <== Same rule the storm list follows:
 * show what we have, name what may be missing. `ui/view-storms.js` reads
 * `sources` for that sentence.
 */
export async function fetchGenesis() {
  const [nhc, jtwc] = await Promise.all([fetchNhc(), fetchJtwc()]);
  const sources = { nhc, jtwc };
  const areas = [...nhc.areas, ...jtwc.areas].sort(sortAreas);

  const all = [nhc, jtwc];
  const status = areas.length
    ? 'ok'
    : all.every((s) => s.status === 'unavailable')
      ? 'unavailable'
      : 'none_matched';

  return { status, areas, sources, fetchedAt: new Date().toISOString() };
}
