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

import { ENDPOINT, GENESIS, OUTLOOK } from '../config/constants.js';
import { normalizeNhcAreas, sortAreas } from '../lib/genesis.js';
import { parseAbpw } from '../lib/abpw.js';
import { parseOutlook, reconcileBasins } from '../lib/outlook.js';
import { fetchFeed, fetchText } from './relay.js';

/* ==> THROUGH `ENDPOINT.relay`, NOT A HARDCODED PATH. <== These two were the
 * last feed URLs written out by hand, and on the Ida replay it showed: the
 * relay was pointed at August 2021 while these two kept asking the live
 * endpoint, so a 2026 genesis area was hatched onto a 2021 map with a
 * percentage attached to it. Every other feed fetch in the app already goes
 * through the one base; these do now too, and the replay answers 404, which
 * the section renders as "unavailable" rather than as an all-clear. */
/** NHC's `basin` field on the outlook layer, to the WMO product that covers
 *  it. The layer says "Pacific" for one product that spans the EAST and
 *  CENTRAL Pacific — `ABPZ20` carries both, `CP93` included — so this is a
 *  genuine translation and not a case difference. A closed table: an
 *  unrecognised word falls back to the summed comparison rather than being
 *  quietly dropped. */
const LAYER_BASIN = Object.freeze({
  atlantic: 'atlantic',
  pacific: 'epacific',
  'east pacific': 'epacific',
  'eastern pacific': 'epacific',
  'central pacific': 'epacific',
});

const nhcUrl = () => `${ENDPOINT.relay}/nhc/genesis?part=areas`;
const jtwcUrl = () => `${ENDPOINT.relay}/jtwc/abpw`;
const outlookUrl = (basin) => `${ENDPOINT.relay}/nhc/outlook?basin=${basin}`;

/**
 * NHC's outlook IN WORDS, both basins, as evidence about the polygons.
 *
 * ==> IT NEVER DRAWS AND IT NEVER ADDS AN AREA TO THE LIST. <== There is no
 * geometry in a paragraph. Every area on the globe still comes from the GIS
 * layer; these two bulletins only answer whether that layer is telling the
 * truth (§45.9). Nothing here reaches `areas`.
 *
 * NEVER THROWS, per basin. The two products fail independently — one basin's
 * page can 404 or freeze while the other is fine — and a thrown error here
 * would take the polygons down with it through `Promise.all`, which would turn
 * a second opinion into a single point of failure for the thing it was added
 * to protect.
 */
async function fetchOutlook(basin, now) {
  try {
    const { text } = await fetchText(outlookUrl(basin));
    return parseOutlook(text, { now });
  } catch (e) {
    /* The parser's own vocabulary, so a dead fetch and an unreadable page
     * arrive at `reconcileBasins` as the same thing: not evidence. */
    return {
      state: 'unreadable',
      reason: e?.message || 'the outlook bulletin could not be fetched',
      wmo: null,
      basin,
      issued: null,
      ageMs: null,
      formationNotExpected: false,
      areas: [],
    };
  }
}

/** NHC's outlook. Resolves to a slot; never throws — a thrown error here would
 *  take the JTWC half down with it through `Promise.all`. */
async function fetchNhc(outlooks) {
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
    const { json, fetchedAt, relayStale, relayHeld } = await fetchFeed(nhcUrl());

    /* ==> KEPT AFTER THE SOURCE CHANGED, AND WORTH SAYING WHY. <== This guard
     * was written for ArcGIS, which reported failure as HTTP 200 with an
     * `error` body that the relay forwarded verbatim. The outlook comes from
     * NHC's KMZ now and that convention is gone — the relay refuses an
     * unreadable document outright rather than passing it on (§4.3), so
     * nothing upstream produces this shape today.
     *
     * It stays because what it asserts is not about ArcGIS: a body carrying an
     * error is never a published all-clear. Deleting it would leave the
     * shape-check below as the only thing between an unexpected payload and
     * "nothing is being watched", and §45.5 is the one place in this app where
     * a redundant guard is cheaper than a clever one. */
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

    /* TRUNCATION IS AN OUTAGE, NOT A SHORT LIST — and this now guards against
     * a different thing than it was written for. ArcGIS had a `maxRecordCount`
     * of 2000 and would silently return a subset at exactly that number. A KMZ
     * has no paging and cannot truncate that way, so the specific mechanism is
     * gone. What the check still buys is a ceiling on absurdity: a busy season
     * peaks in single digits, so an outlook claiming thousands of watched
     * areas is a source that has changed shape, and drawing it would be worse
     * than saying so. */
    if (areas.length >= GENESIS.maxRecords) {
      return slot('unavailable', [], { fetchedAt, reason: 'the outlook response was truncated' });
    }

    /* ==> THE RELAY SAYS WHY IT REMEMBERED, AND THE TWO REASONS ARE NOT THE
     * SAME EVENT. <== `relayStale` is set by both of its remembering paths:
     * upstream refused to answer, and upstream answered with NOTHING while we
     * had areas minutes ago. Only the second is "the layer has stopped
     * publishing". This used to be inferred as `relayStale && areas.length`,
     * which is equally true of a dead NHC — a sentence about a specific fault,
     * printed for a different one. The marker has been on the wire since the
     * held branch shipped; it is read now. */
    const held = !!relayHeld && areas.length > 0;
    const lapsed = relayHeld === OUTLOOK.heldLapsedMarker;

    /* ==> WHAT THE ARBITER IS ASKED ABOUT IS UPSTREAM'S COUNT, NOT THE ONE IN
     * OUR HANDS. <== A held response carries REMEMBERED areas, so counting
     * them would tell the arbiter the layer published areas at the exact
     * moment it published none. While holding, upstream said zero — that is
     * what "held" means — so zero is the honest number to judge. Getting this
     * backwards would make `both-clear` unreachable forever, which is half the
     * point of having an arbiter at all. */
    /* ==> GROUPED BY NHC'S OWN WORD, SO EACH BASIN IS JUDGED AGAINST ITS OWN
     * BULLETIN. <== `sourceBasin` is the layer's `basin` field, carried
     * through `normalizeNhcAreas` and until now shown but never used. It reads
     * "Atlantic" and "Pacific" on the real bytes; the prose comes as `atlantic`
     * and `epacific`. One is a display word and one is a WMO product, so the
     * two vocabularies are mapped here explicitly rather than lowercased and
     * hoped about.
     *
     * WHY IT MATTERS: summed, one dark basin beside a healthy one is
     * `layer-short`, a verdict nothing acts on — so a broken Atlantic under a
     * working Pacific reported quietly and drew nothing. Split, it is
     * `layer-broken`, which holds.
     *
     * A basin with no bulletin and a basin with no polygons are different, and
     * a count of 0 is stated for BOTH known basins rather than left absent:
     * "the layer answered and this basin had none" is the whole question. */
    const layerCounts = { atlantic: 0, epacific: 0 };
    let ungrouped = 0;
    for (const a of areas) {
      const b = LAYER_BASIN[String(a.sourceBasin || '').toLowerCase()];
      if (b) layerCounts[b] += 1;
      else ungrouped += 1;
    }

    /* ==> AN AREA WE CANNOT FILE IS NOT ONE WE MAY IGNORE. <== If NHC renames
     * a basin or adds one, every unrecognised area would otherwise vanish from
     * the count and make a healthy layer look broken — a false outage, which
     * is the mirror of the bug this whole feature answers. Fall back to the
     * summed comparison, which needs no grouping and is what shipped before. */
    const verdict = held
      /* HELD MEANS UPSTREAM SAID NOTHING, IN EVERY BASIN. The areas in hand
       * are remembered ones; grouping THEM would tell the arbiter the layer
       * published at the moment it published nothing. */
      ? reconcileBasins({ atlantic: 0, epacific: 0 }, outlooks)
      : reconcileBasins(ungrouped ? areas.length : layerCounts, outlooks);
    const arbiter = { ...verdict, outlooks };

    /* ==> A TRUE ALL-CLEAR, PROVEN, AND SHOWN AT ONCE. <== Both bulletins
     * readable, both describing nothing, and the layer agreeing. There is
     * nothing left to hold for: the six-hour window exists only because an
     * empty layer is normally unprovable, and here it has been proved. Any
     * remembered areas are dropped rather than shown for another few hours. */
    if (verdict.verdict === 'both-clear') {
      return slot('none_matched', [], { fetchedAt, relayStale, arbiter });
    }

    /* ==> THE LAYER IS EMPTY AND A FORECASTER IS DESCRIBING AREAS. <== This is
     * the 2026-08-11 incident, and it is the state the whole feature exists
     * for. There is nothing to draw — the relay had no memory to offer, or its
     * memory lapsed — but "we cannot see" is emphatically not "there is
     * nothing to see". `unavailable`, which §45.5 forbids from ever reading as
     * All Clear, with the forecaster's own count carried alongside so the
     * section can say what is actually out there. */
    if (verdict.verdict === 'layer-broken' && areas.length === 0) {
      return slot('unavailable', [], {
        fetchedAt,
        relayStale,
        arbiter,
        reason: 'the outlook layer published nothing while the forecast text listed areas',
      });
    }

    /* ==> THESE AREAS ARE REAL, AND THEY ARE NOT CURRENT. <== The relay serves
     * its last real answer when NHC's layer answers 200 with nothing inside
     * one outlook cycle of having had areas — see HELD_SECONDS in
     * functions/api/nhc/genesis.js for the night that made it necessary.
     *
     * STATUS STAYS `ok`, DELIBERATELY. We have areas, they are NHC's, and the
     * globe should draw them; downgrading to `unavailable` would blank the
     * very patches this whole branch exists to keep on screen. What changes is
     * that the section must SAY the layer has stopped, with an age — stale
     * data plus a visible timestamp, never stale data passed off as current.
     *
     * ==> AND PAST THE SIX HOURS, THE RELAY OFFERS AND WE DECIDE. <== A
     * `-lapsed` marker means the memory outlived the window. A full outlook
     * cycle of emptiness is normally simply true, so it is NOT drawn on the
     * relay's say-so — only when a bulletin independently says the layer is
     * wrong, which turns the hold from an inference into a reading. Without
     * that reading the remembered areas are dropped and the emptiness is
     * believed, exactly as before this file knew about bulletins. */
    if (held && lapsed && verdict.verdict !== 'layer-broken') {
      return slot('none_matched', [], { fetchedAt, relayStale, arbiter });
    }

    return slot(areas.length ? 'ok' : 'none_matched', areas, {
      fetchedAt,
      relayStale,
      arbiter,
      held,
      lapsed: held && lapsed,
    });
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
    /** The relay is serving its last real answer because NHC's layer answered
     *  with nothing. The areas are genuine and are NOT current — see the note
     *  at the call site. Listed here explicitly because this builder DROPS
     *  anything it does not name, and a caveat that is silently discarded is
     *  worse than one that was never written. */
    held: !!extra.held,
    /** The hold outlived its six-hour window and is being shown anyway, on the
     *  strength of a bulletin rather than on the shape of the drop. A different
     *  fact from `held` and a different sentence on screen. */
    lapsed: !!extra.lapsed,
    /** What the text outlook said, and what it makes of the layer. Null on
     *  every source that has no arbiter — JTWC publishes no second opinion. */
    arbiter: extra.arbiter ?? null,
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
  /* ==> THE BULLETINS ARE FETCHED FIRST BECAUSE THE POLYGONS ARE JUDGED
   * AGAINST THEM. <== Everything still goes out in parallel — the two
   * bulletins together, then the two area sources together — so this costs one
   * extra round trip and never a serial chain of four. The alternative,
   * arbitrating on the NEXT poll against the LAST poll's bulletin, would put a
   * thirty-minute lag on the one judgement that has to be current. */
  const outlooks = await Promise.all(OUTLOOK.basins.map((b) => fetchOutlook(b, now)));
  const [nhc, jtwc] = await Promise.all([fetchNhc(outlooks), fetchJtwc(now)]);
  const sources = { nhc, jtwc };
  const areas = [...nhc.areas, ...jtwc.areas].sort(sortAreas);

  const all = [nhc, jtwc];
  const status = areas.length
    ? 'ok'
    : all.every((s) => s.status === 'unavailable')
      ? 'unavailable'
      : 'none_matched';

  /* ==> "NOBODY REPORTED AN AREA" AND "EVERYBODY LOOKED" ARE DIFFERENT FACTS,
   * AND ONLY ONE OF THEM EARNS AN ALL-CLEAR. <==
   *
   * `status` above deliberately reports a PARTIAL outage as `none_matched`,
   * because the drawer's job in that state is to show what we have and name
   * what is missing — never to blank a live source because its neighbour died.
   * That is right for the drawer and it is wrong for the headline, which had
   * been reading the same word and printing "All clear" over a dead NHC.
   *
   * §45.5 already SAID the rule — `clear` requires the watch list to have
   * answered — and `data/store.js` and `ui/view-storms.js` both carry a comment
   * claiming an outage "falls through to unavailable". It could not: the
   * rollup had already turned it into `none_matched` one function earlier. The
   * intent and the code disagreed for as long as both existed.
   *
   * So the completeness of the answer is stated separately instead of being
   * squeezed out of a word that has another job. */
  const answered = all.every((s) => s.status !== 'unavailable');

  return { status, answered, areas, sources, fetchedAt: new Date().toISOString() };
}
