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

import { ENDPOINT, GENESIS } from '../config/constants.js';
import { normalizeNhcAreas, sortAreas } from '../lib/genesis.js';
import { parseAbpw } from '../lib/abpw.js';
import { fetchFeed, fetchText } from './relay.js';

/* ==> THROUGH `ENDPOINT.relay`, NOT A HARDCODED PATH. <== These two were the
 * last feed URLs written out by hand, and on the Ida replay it showed: the
 * relay was pointed at August 2021 while these two kept asking the live
 * endpoint, so a 2026 genesis area was hatched onto a 2021 map with a
 * percentage attached to it. Every other feed fetch in the app already goes
 * through the one base; these do now too, and the replay answers 404, which
 * the section renders as "unavailable" rather than as an all-clear. */
const nhcUrl = () => `${ENDPOINT.relay}/nhc/genesis?part=areas`;
const jtwcUrl = () => `${ENDPOINT.relay}/jtwc/abpw`;

/** NHC's outlook. Resolves to a slot; never throws — a thrown error here would
 *  take the JTWC half down with it through `Promise.all`. */
async function fetchNhc() {
  try {
    /* ==> `json`, NOT `data`. THIS LINE SHIPPED WRONG AND COST A FALSE
     *     ALL-CLEAR. <==
     *
     * `data/relay.js` resolves to `{ json, text, relayStale, fetchedAt }`. The
     * first version of this line destructured `data`, which is simply not a
     * property that object has — so it was `undefined`, `normalizeNhcAreas`
     * read no features from it, and this function reported `none_matched`:
     * "NHC answered and published nothing." Five live watched areas, one of
     * them at 80% over seven days, rendered as an all-clear for the Atlantic
     * and East Pacific. Caught on glass 2026-08-09, not by any test.
     *
     * IT FAILED SILENTLY IN THE ONE DIRECTION §5 CARES ABOUT. A typo that
     * throws is a red banner and a five-minute fix. A typo that resolves to
     * "nothing is out there" is the precise failure §45 was built to prevent,
     * committed by §45 itself. `tools/test-genesis.mjs` now drives this
     * function against a stubbed relay so the wiring is covered and not just
     * the parser. */
    const { json, fetchedAt, relayStale } = await fetchFeed(nhcUrl());

    /* ArcGIS reports failure as HTTP 200 with an `error` body, and the relay
     * forwards it verbatim precisely so this line can exist. Reading it as a
     * FeatureCollection with no features would turn a refused query into a
     * published all-clear. */
    if (json && json.error) {
      return slot('unavailable', [], { fetchedAt, reason: 'the outlook query was refused' });
    }

    /* A BODY THAT IS NOT A FEATURECOLLECTION IS AN OUTAGE, NOT AN EMPTY SKY.
     * This is the second half of the lesson above: the shape is now checked
     * rather than assumed, so anything unexpected on the wire — or any future
     * mistake on this side of it — says "we could not read the outlook"
     * instead of quietly saying "there is nothing to see". */
    if (!json || json.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
      return slot('unavailable', [], {
        fetchedAt,
        reason: 'the outlook response was not readable',
      });
    }

    const areas = normalizeNhcAreas(json);

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
async function fetchJtwc(now = Date.now()) {
  try {
    const { text, fetchedAt, relayStale } = await fetchText(jtwcUrl());
    const parsed = parseAbpw(text, { now });

    /* ==> THE BULLETIN'S ISSUE TIME BELONGS ON EVERY SYSTEM IN IT. <==
     *
     * It was only on the slot, so the area panel read `area.issuedAt` as
     * undefined and printed "Publication time not stated" under a system whose
     * bulletin says 090300 in its first line. Seen on glass 2026-08-09.
     *
     * One bulletin, one stamp, stamped onto each system rather than looked up
     * through a parent the panel does not have: an NHC area carries its own
     * `idp_filedate` and the panel must be able to ask both the same question. */
    const systems = parsed.systems.map((s) => ({ ...s, issuedAt: parsed.issuedAt }));

    return slot(parsed.status, systems, {
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
/**
 * @param {{now?: number}} [opts] — an injectable clock, for the same reason
 *   buildHomeDashboard takes one. JTWC's bulletin is DROPPED once it is older
 *   than `ABPW.maxAge` (24 h), which is right in the app and made
 *   `tools/test-genesis.mjs` a time bomb: its fixture is a real bulletin with
 *   a real timestamp, so the suite passed for a day after the capture and went
 *   red for good the moment the wall clock rolled past it. A check that goes
 *   permanently red teaches you to ignore the board.
 */
export async function fetchGenesis({ now = Date.now() } = {}) {
  const [nhc, jtwc] = await Promise.all([fetchNhc(), fetchJtwc(now)]);
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
