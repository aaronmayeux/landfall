/**
 * _slots.js — the WMO bulletin slot table for all nine VAAC centres, and the
 * split that makes reading every one of them possible on the free tier.
 *
 * ==> WHY THIS FILE EXISTS AT ALL: BoM IS GONE. <== `bom.gov.au` carried eight
 * of the nine centres with seven days of history behind ONE fetch, and it
 * answers HTTP 403 to this runtime. Measured 2026-07-30 with a six-variant
 * bisect (`/api/volcano/inspect`, since deleted): every request carrying ANY
 * header was refused with an identical 1,386-byte body reading
 *
 *   "Your access is blocked due to the detection of a potential automated
 *    access request. The Bureau of Meteorology website does not support web
 *    scraping: if you are trying to access Bureau data through automated
 *    means, you should stop."
 *
 * The 200 it serves carries `x-akamai-transformed`, so that is Akamai Bot
 * Manager, and a browser-shaped User-Agent was refused EXACTLY like our own —
 * workerd's fingerprint claiming to be Chrome 126 is a more obvious bot than
 * one that claims nothing. ==> A BARE FETCH WITH NO HEADERS DOES CURRENTLY
 * SUCCEED, AND WE DELIBERATELY DO NOT USE IT. <== BoM asks us in words to
 * stop; it works only as an accident of a WAF ruleset that will flip without
 * warning, and it would flip during the eruption that makes this app worth
 * having. **Do not re-add BoM. This is settled, and it is an ethics decision
 * before it is an engineering one.**
 *
 * ==> AND THE REPLACEMENT COSTS 62 FETCHES AGAINST A CAP OF 50. <== NOAA's raw
 * bulletin dump has all nine centres on one host, verified readable from this
 * runtime (directory listing 200, and the three Wellington slots have been
 * answering in production all along). It is 62 files — enumerated by hand from
 * the listing 2026-07-30, and note that a summariser counted 60. Cloudflare's
 * FREE plan allows 50 external subrequests per invocation and 50 is the free
 * MAXIMUM — the `limits.subrequests` escape hatch only raises a PAID cap
 * (verified against Cloudflare's own docs 2026-07-30). So one route cannot
 * read the world.
 *
 * ==> THE SPLIT IS WHAT LETS US DROP NOTHING. <== Two groups behind
 * `/api/volcano/ash?group=a|b`, ~31 fetches each, each with its own 50-budget.
 * `/api/volcano/live` then spends 2 fetches on those plus weekly plus HANS —
 * four, against fifty. **The point is not that it fits. The point is that
 * NOTHING GETS GUESSED AT.** The alternative was trimming to ~48 slots by
 * dropping the AWIPS re-routings and the Melbourne relays of Darwin, and
 * `fvfe01.rjtd..txt` (880 bytes) is NOT byte-identical to
 * `fvfe01.rjtd.vaa.ak1.txt` (775), so those variants might carry different
 * advisories. Fetching a duplicate is free — `parseStream` dedupes on GVP
 * number + DTG. NOT fetching one is where an eruption goes missing.
 *
 * ==> GROUPED BY CENTRE, NOT ROUND-ROBIN, AND THAT IS A §5 DECISION. <== If a
 * group route dies, per-centre grouping loses whole centres and can NAME them
 * — "Washington, Toulouse, London and Montreal unreachable" is a sentence a
 * person can act on. Interleaving would lose half of every centre and report
 * "partial coverage everywhere", which is mush wearing a number.
 *
 * ==> WHAT THIS COSTS US, STATED PLAINLY BECAUSE IT IS A REAL LOSS. <== These
 * files are LATEST-ONLY and overwritten in place. There is no archive. BoM
 * carried seven days, so a missed poll there was survivable; here **one missed
 * poll is one lost eruption.** The fix is our own archive — the cron Worker
 * accumulating advisories into KV, which would beat BoM's seven days and
 * depend on nobody — and it is the next pass, not this one. Until it exists,
 * this is the honest shape and the payload says so.
 *
 * Pure data plus two pure functions. Imports nothing, per §3.
 */

/** The one host. Fixed here, never caller-supplied. */
export const TGFTP_BASE = 'https://tgftp.nws.noaa.gov/data/raw/fv/';

/**
 * ==> THE DIRECTORY LISTING'S TIMESTAMPS LIE — DO NOT USE THEM. <==
 * `fvxx20.knes..txt` was listed `25-Jul-2026 09:46` while its body read
 * `DTG: 20260730/0024Z`. Change detection reads the `DTG:` line inside the
 * file, which is what `_vaa.js` does. The listing is used for one thing only:
 * discovering that a slot exists, which is why this table is checked in rather
 * than fetched.
 */

/**
 * Every slot, attributed to the centre that originates it.
 *
 * The four-letter code is the WMO originator: `sabm` Buenos Aires, `panc` and
 * `pawu` Anchorage, `adrm` Darwin, `ammc` Melbourne (which RELAYS Darwin),
 * `nzkl` Wellington, `cwao` Montreal, `rjtd` Tokyo, `egrr` London, `lfpw`
 * Toulouse, `knes` Washington.
 *
 * Note the codes that cross the obvious boundaries, because they are the
 * reason this is a hand-checked table and not a filename pattern:
 *   - `fvau04/05/06.nzkl..txt` — WELLINGTON issuing on Australian slot
 *     numbers. A rule keyed on the `fvau` prefix would file these as Darwin.
 *   - `fvxx21.pawu..txt` — ANCHORAGE on an `fvxx` slot, where every other
 *     `fvxx` file belongs to London, Toulouse, Washington or Buenos Aires.
 *   - `fvxx01.sabm..txt` — BUENOS AIRES likewise.
 * ==> SO CENTRE ATTRIBUTION COMES FROM THE ORIGINATOR CODE, NEVER THE SLOT
 * NUMBER. <== Getting this wrong would mis-report which centre is unreachable,
 * which is worse than not reporting it: a confident wrong answer.
 */
export const SLOTS = Object.freeze([
  /* --- group A --------------------------------------------------------- */
  /* Buenos Aires — emits `VOLCANO: UNKNOWN` for resuspended Andean ash, which
   * `parseAdvisory` rejects as unjoinable rather than guessing. */
  { file: 'fvag01.sabm..txt', centre: 'BUENOS AIRES', group: 'a' },
  { file: 'fvag02.sabm..txt', centre: 'BUENOS AIRES', group: 'a' },
  { file: 'fvag03.sabm..txt', centre: 'BUENOS AIRES', group: 'a' },
  { file: 'fvag04.sabm..txt', centre: 'BUENOS AIRES', group: 'a' },
  { file: 'fvag05.sabm..txt', centre: 'BUENOS AIRES', group: 'a' },
  { file: 'fvxx01.sabm..txt', centre: 'BUENOS AIRES', group: 'a' },

  /* Anchorage — five advisory slots AK1..AK5, delivered on both the `pawu`
   * and `panc` originators plus AWIPS `.vaa.akN` re-routings. All of it is
   * fetched; the dedupe sorts it out. */
  { file: 'fvak21.panc.vaa.ak1.txt', centre: 'ANCHORAGE', group: 'a' },
  { file: 'fvak21.pawu..txt', centre: 'ANCHORAGE', group: 'a' },
  { file: 'fvak21.pawu.vaa.ak1.txt', centre: 'ANCHORAGE', group: 'a' },
  { file: 'fvak22.pawu..txt', centre: 'ANCHORAGE', group: 'a' },
  { file: 'fvak22.pawu.vaa.ak2.txt', centre: 'ANCHORAGE', group: 'a' },
  { file: 'fvak23.panc..txt', centre: 'ANCHORAGE', group: 'a' },
  { file: 'fvak23.panc.vaa.ak3.txt', centre: 'ANCHORAGE', group: 'a' },
  { file: 'fvak23.pawu..txt', centre: 'ANCHORAGE', group: 'a' },
  { file: 'fvak23.pawu.vaa.ak3.txt', centre: 'ANCHORAGE', group: 'a' },
  { file: 'fvak24.pawu..txt', centre: 'ANCHORAGE', group: 'a' },
  { file: 'fvak24.pawu.vaa.ak4.txt', centre: 'ANCHORAGE', group: 'a' },
  { file: 'fvak25.pawu..txt', centre: 'ANCHORAGE', group: 'a' },
  { file: 'fvak25.pawu.vaa.ak5.txt', centre: 'ANCHORAGE', group: 'a' },
  { file: 'fvxx21.pawu..txt', centre: 'ANCHORAGE', group: 'a' },

  /* Darwin, plus Melbourne's relay of it. `darwin-va-advisory.shtml` is
   * JS-rendered and reported "Nil current" during an active Semeru advisory —
   * never poll it. These are the raw bulletins. */
  { file: 'fvau01.adrm..txt', centre: 'DARWIN', group: 'a' },
  { file: 'fvau02.adrm..txt', centre: 'DARWIN', group: 'a' },
  { file: 'fvau03.adrm..txt', centre: 'DARWIN', group: 'a' },
  { file: 'fvau04.adrm..txt', centre: 'DARWIN', group: 'a' },
  { file: 'fvau05.adrm..txt', centre: 'DARWIN', group: 'a' },
  { file: 'fvau06.adrm..txt', centre: 'DARWIN', group: 'a' },
  { file: 'fvau07.adrm..txt', centre: 'DARWIN', group: 'a' },
  { file: 'fvau08.adrm..txt', centre: 'DARWIN', group: 'a' },
  { file: 'fvau01.ammc..txt', centre: 'DARWIN', group: 'a' },
  { file: 'fvau02.ammc..txt', centre: 'DARWIN', group: 'a' },

  /* --- group B --------------------------------------------------------- */
  /* Wellington — the centre BoM omitted entirely, which is why it was already
   * being read directly. Covers Vanuatu, Tonga and the Kermadecs. HTTP-only on
   * its own site; these slots are HTTPS. */
  { file: 'fvps01.nzkl..txt', centre: 'WELLINGTON', group: 'b' },
  { file: 'fvps02.nzkl..txt', centre: 'WELLINGTON', group: 'b' },
  { file: 'fvps04.nzkl..txt', centre: 'WELLINGTON', group: 'b' },
  { file: 'fvau04.nzkl..txt', centre: 'WELLINGTON', group: 'b' },
  { file: 'fvau05.nzkl..txt', centre: 'WELLINGTON', group: 'b' },
  { file: 'fvau06.nzkl..txt', centre: 'WELLINGTON', group: 'b' },

  /* Montreal. */
  { file: 'fvcn01.cwao..txt', centre: 'MONTREAL', group: 'b' },
  { file: 'fvcn02.cwao..txt', centre: 'MONTREAL', group: 'b' },
  { file: 'fvcn03.cwao..txt', centre: 'MONTREAL', group: 'b' },
  { file: 'fvcn04.cwao..txt', centre: 'MONTREAL', group: 'b' },

  /* Tokyo. One slot, three AWIPS re-routings of it. */
  { file: 'fvfe01.rjtd..txt', centre: 'TOKYO', group: 'b' },
  { file: 'fvfe01.rjtd.vaa.ak1.txt', centre: 'TOKYO', group: 'b' },
  { file: 'fvfe01.rjtd.vaa.ak2.txt', centre: 'TOKYO', group: 'b' },
  { file: 'fvfe01.rjtd.vaa.ak3.txt', centre: 'TOKYO', group: 'b' },

  /* London — issues `STATUS: EXER` exercise traffic that MUST be filtered,
   * and issues on Toulouse's behalf. Both handled downstream. */
  { file: 'fvxx01.egrr..txt', centre: 'LONDON', group: 'b' },
  { file: 'fvxx01.egrr.par.t2.txt', centre: 'LONDON', group: 'b' },
  { file: 'fvxx02.egrr..txt', centre: 'LONDON', group: 'b' },
  { file: 'fvxx05.egrr..txt', centre: 'LONDON', group: 'b' },
  { file: 'fvxx11.egrr..txt', centre: 'LONDON', group: 'b' },

  /* Toulouse — ETNA'S CENTRE, and the reason this whole pass exists. Etna
   * erupted at AVIATION COLOUR CODE RED with ash to FL230 on 2026-07-30 and
   * appeared nowhere in the ash channel. `fvxx05.lfpw..txt` was the largest
   * file in the directory at 1,536 bytes. Also emits `STATUS: TEST`. */
  { file: 'fvxx01.lfpw..txt', centre: 'TOULOUSE', group: 'b' },
  { file: 'fvxx02.lfpw..txt', centre: 'TOULOUSE', group: 'b' },
  { file: 'fvxx03.lfpw..txt', centre: 'TOULOUSE', group: 'b' },
  { file: 'fvxx04.lfpw..txt', centre: 'TOULOUSE', group: 'b' },
  { file: 'fvxx05.lfpw..txt', centre: 'TOULOUSE', group: 'b' },

  /* Washington. */
  { file: 'fvxx20.knes..txt', centre: 'WASHINGTON', group: 'b' },
  { file: 'fvxx21.knes..txt', centre: 'WASHINGTON', group: 'b' },
  { file: 'fvxx22.knes..txt', centre: 'WASHINGTON', group: 'b' },
  { file: 'fvxx23.knes..txt', centre: 'WASHINGTON', group: 'b' },
  { file: 'fvxx24.knes..txt', centre: 'WASHINGTON', group: 'b' },
  { file: 'fvxx25.knes..txt', centre: 'WASHINGTON', group: 'b' },
  { file: 'fvxx26.knes..txt', centre: 'WASHINGTON', group: 'b' },
  { file: 'fvxx27.knes..txt', centre: 'WASHINGTON', group: 'b' },
]);

/** The two valid group names. A request for anything else is refused rather
 *  than silently served an empty group — an empty group is indistinguishable
 *  from a quiet sky, which is the failure §5 exists to prevent. */
export const GROUPS = Object.freeze(['a', 'b']);

/**
 * The nine centres, as they name themselves in the `VOLCANO:` line. Derived
 * from the table rather than written twice, so a new slot cannot introduce a
 * centre this list does not know about.
 */
export const ALL_CENTRES = Object.freeze(
  [...new Set(SLOTS.map((s) => s.centre))].sort()
);

/** The slots in one group, as full URLs. */
export function slotsInGroup(group) {
  return SLOTS.filter((s) => s.group === group);
}

/** The centres a group is responsible for. Used to report which centres went
 *  dark when a group route fails, rather than reporting a count. */
export function centresInGroup(group) {
  return [...new Set(slotsInGroup(group).map((s) => s.centre))].sort();
}

export const slotUrl = (file) => `${TGFTP_BASE}${file}`;
