/**
 * _vaa.js — the WMO `VA ADVISORY` bulletin parser. Pure: no fetch, no DOM.
 *
 * ONE TEMPLATE, NINE CENTRES, AND THE WHITESPACE IS A LIE EVERY TIME. All nine
 * VAAC centres emit the same fields in the same order and format them
 * differently enough that a line-oriented parser silently drops half of them.
 * Measured against live bulletins from six centres on 2026-07-30 (fixtures and
 * evidence in samples/vaac/):
 *
 *   - Wellington indents continuation lines eight spaces. **Toulouse wraps at
 *     column zero.** So indentation cannot detect a continuation, in either
 *     direction, and the naive rule fails on the ONE bulletin that mattered
 *     that day — the live Etna eruption.
 *   - Washington puts a blank line between every field. Tokyo puts none.
 *   - Tokyo writes `FCST VA CLD +6 HR:`, Washington writes `+6HR:`.
 *   - Darwin and Washington write `EST VA DTG` / `EST VA CLD` where Tokyo,
 *     Wellington and Anchorage write `OBS`. Same slot, estimated not observed.
 *   - Buenos Aires writes `SUMMIT ELEV` where the rest write `SOURCE ELEV`.
 *   - Elevation units are `3357M`, `1496M AMSL`, `12287 FT AMSL` and
 *     `19576 FT (5967 M)`, all in the same field.
 *   - Not every advisory terminates with `=`. Washington's has none at all;
 *     London's sits on its own line.
 *
 * ==> SO THIS PARSER IS LABEL-DRIVEN, NOT LINE-DRIVEN, AND THAT IS THE WHOLE
 * DESIGN. <== It finds each known label, then takes everything up to the NEXT
 * known label as that field's value. Wrapping, indentation, blank lines and
 * the presence or absence of `=` all stop being facts it depends on. It is
 * also why it survives whitespace no rule here depends on. The relay reads
 * 62 raw `.txt` bulletin slots across nine centres and each centre formats the
 * same template differently; the parser is not allowed to care.
 *
 * ==> AND AN ADVISORY IS NOT AN ERUPTION. <== This is the part that puts dead
 * volcanoes on a globe if it is skipped. A centre issues a bulletin to say ash
 * has STOPPED just as readily as to say it started: Tokyo's newest Sheveluch
 * bulletin, Wellington's newest Ambae bulletin and Washington's newest Santa
 * Maria bulletin were ALL closes on 2026-07-30. Counting bulletins instead of
 * reading them puts three dead events on the globe. `classify()` below is that
 * reading, and it is tested against all three.
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED like every other file under functions/ (§3) — it imports
 * nothing, including config/constants.js. **The two numbers it would have
 * imported are passed IN by the caller** (`opts.exerciseStatus`,
 * `opts.flightLevelToFeet`) so the VOLCANO block stays the one place they are
 * defined and this file cannot drift from it. tools/test-vaa.mjs asserts the
 * values it is called with match that block.
 */

/**
 * Every field label this template can carry, longest first.
 *
 * ORDER IS LOAD-BEARING AND NOT ALPHABETICAL. The scan takes the first label
 * that matches at a position, so `OBS VA DTG` has to be tried before
 * `OBS VA CLD`... no — it has to be tried before nothing, but `VA` prefixes
 * overlap (`FCST VA CLD +12 HR` contains `FCST VA CLD +1`), and a shorter
 * label matching first would swallow the longer one's digits into its value.
 * Sorting by descending length at module load makes that impossible to get
 * wrong by editing this list.
 */
const LABELS = [
  'STATUS',
  'DTG',
  'VAAC',
  'VOLCANO',
  'PSN',
  'AREA',
  'SOURCE ELEV',
  'SUMMIT ELEV',
  'ADVISORY NR',
  'INFO SOURCE',
  'AVIATION COLOUR CODE',
  'AVIATION COLOR CODE',
  'ERUPTION DETAILS',
  'OBS VA DTG',
  'EST VA DTG',
  'OBS VA CLD',
  'EST VA CLD',
  'FCST VA CLD +6 HR',
  'FCST VA CLD +6HR',
  'FCST VA CLD +12 HR',
  'FCST VA CLD +12HR',
  'FCST VA CLD +18 HR',
  'FCST VA CLD +18HR',
  'RMK',
  'NXT ADVISORY',
].sort((a, b) => b.length - a.length);

/** The header line every bulletin opens a record with. */
const RECORD_START = /VA ADVISORY(?:\s*-\s*CORRECTION)?/g;

/**
 * Resuspended ash — old deposits lifted by wind, not erupted.
 *
 * `RESUSP` covers `RESUSPENDED`, `RESUSPENSION` and the clipped `RESUSP` the
 * centres use when a line is running long. `NO ERUPTION` is the second half
 * because Buenos Aires leads with it, and a centre that says outright that
 * nothing erupted is not a signal to argue with.
 */
const RESUSPENDED_RE = /\bRESUSP|\bNO\s+ERUPTION\b/i;

/**
 * Split a stream of concatenated bulletins into individual advisory bodies.
 *
 * ==> RECORDS ARE SPLIT ON THE `VA ADVISORY` HEADER, NOT ON THE `=`
 * TERMINATOR. <== The plan for this route said every advisory ends with `=`.
 * It does not: Washington's bulletin has no terminator at all. Splitting on
 * `=` loses that centre's advisories entirely and, worse, fuses the one after
 * it onto the end of the previous record — a fused record parses cleanly and
 * reports the WRONG volcano, which is the failure mode that never looks like
 * a bug. The header is mandatory (it is the WMO product name) and appears
 * exactly once per advisory, so it is the reliable boundary.
 *
 * `VA ADVISORY -CORRECTION` is a title variant, not a different product: same
 * volcano, same advisory number, superseding body. It opens a record too, and
 * the dedupe on GVP-number-plus-DTG is what resolves it against the original.
 *
 * @param {string} stream  one or many bulletins, any whitespace, tags stripped
 * @returns {string[]} advisory bodies, in the order they appeared
 */
export function splitAdvisories(stream) {
  if (typeof stream !== 'string' || !stream) return [];

  const starts = [];
  RECORD_START.lastIndex = 0;
  let m;
  while ((m = RECORD_START.exec(stream)) !== null) {
    starts.push({ at: m.index, after: m.index + m[0].length });
    /* A zero-length match cannot happen with this pattern, but an unguarded
     * exec loop on a global regex is how one hangs a Worker. */
    if (m.index === RECORD_START.lastIndex) RECORD_START.lastIndex++;
  }
  if (!starts.length) return [];

  return starts.map((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : stream.length;
    return trimTrailingHeading(stream.slice(s.after, end));
  });
}

/**
 * Remove a WMO abbreviated heading left dangling on the end of a record.
 *
 * ==> CAUGHT ON THE FIRST LIVE DEPLOY, NOT BY THE FIXTURES. <== Every bulletin
 * opens with a heading line — `FVPS02 NZKL 151845` — which sits ABOVE the
 * `VA ADVISORY` product name this splitter cuts on. So when several bulletins
 * arrive concatenated, each record ends with the NEXT one's heading, and the
 * last field parsed absorbs it. The live payload showed
 * `nextAdvisory: "NO FURTHER ADVISORIES= FVPS02 NZKL 151845"`.
 *
 * Harmless-looking, and worth fixing properly rather than tolerating: the
 * contaminated field is whichever field happens to be last, which varies by
 * centre, so on a different bulletin the same bug lands in `RMK` or in
 * `ERUPTION DETAILS` — text a person reads. The single-fixture tests could not
 * see it because one bulletin has no next bulletin; the test for it now
 * concatenates, which is how the relay actually receives them.
 */
function trimTrailingHeading(body) {
  return body.replace(/\s*\bFV[A-Z]{2}\d{2}\s+[A-Z]{4}\s+\d{6}\s*$/, '');
}

/**
 * Pull the labelled fields out of one advisory body.
 *
 * Returns a plain map of label -> value with runs of whitespace collapsed to
 * single spaces, which is where every wrapping and indentation difference
 * between the nine centres goes to die.
 */
function fields(body) {
  const found = [];
  for (const label of LABELS) {
    /* The label, then optional spaces, then a colon. `\b` on the left stops
     * `DTG` matching inside `OBS VA DTG` — which would otherwise hand the
     * observation time to the advisory-time field on every bulletin from
     * every centre. */
    const re = new RegExp(`(?:^|[^A-Z+])(${escapeRe(label)})\\s*:`, 'g');
    let m;
    while ((m = re.exec(body)) !== null) {
      found.push({ label, start: m.index + m[0].indexOf(m[1]), valueAt: re.lastIndex });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  if (!found.length) return {};

  /* Sort by position, then each field's value runs to the next field's label.
   * A label appearing twice keeps the FIRST occurrence — the second is prose
   * inside an RMK quoting a field name, which happens. */
  found.sort((a, b) => a.start - b.start);
  const out = {};
  for (let i = 0; i < found.length; i++) {
    const f = found[i];
    if (f.label in out) continue;
    const end = i + 1 < found.length ? found[i + 1].start : body.length;
    out[f.label] = squash(body.slice(f.valueAt, end));
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Collapse all whitespace, drop a trailing record terminator. */
const squash = (s) =>
  String(s).replace(/\s+/g, ' ').replace(/\s*=\s*$/, '').trim();

/**
 * `20260730/0350Z` -> ISO string. The advisory's own date-time group.
 * Returns null on anything that is not that shape — including `UNKNOWN`,
 * which test bulletins put in fields that normally hold data.
 */
export function parseDtg(dtg) {
  const m = /^(\d{4})(\d{2})(\d{2})\/(\d{2})(\d{2})Z$/.exec(String(dtg || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  if (!Number.isFinite(ms)) return null;
  /* Sanity, not paranoia: a bulletin claiming month 19 is corrupt, and
   * Date.UTC would happily roll it into next year rather than complain. */
  const dt = new Date(ms);
  if (dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) return null;
  return dt.toISOString();
}

/**
 * The ash-cloud field, read for whether there is actually ash in it.
 *
 * ==> THE TRAP THAT WOULD HAVE SHIPPED, AND IT IS THE REASON THIS IS ITS OWN
 * FUNCTION. <== `OBS VA CLD` holds a flight level when there is an ash cloud
 * (`SFC/FL230 N3806 E01442 - ...`) and, when there is NOT, it holds the words
 * `VA NOT IDENTIFIABLE` **followed by the WIND at a flight level**:
 *
 *     OBS VA CLD: VA NOT IDENTIFIABLE FM SATELLITE DATA WIND FL180 340/15KT
 *
 * That is Tokyo's Sheveluch close. A scan for `FL\d+` finds `FL180`, reads it
 * as a 18,000 ft ash plume, and puts an eruption on the globe at a volcano
 * whose bulletin exists to say the ash is gone. The same trap is live in
 * Wellington's Ambae close and London's Krysuvik exercise. **So the string is
 * cut at ` WIND ` before anything looks for a level.**
 *
 * @returns {{ash: boolean, topFeet: number|null, baseSurface: boolean, raw: string}}
 */
export function readAshCloud(raw, flightLevelToFeet) {
  const value = squash(raw || '');
  if (!value) return { ash: false, topFeet: null, baseSurface: false, raw: '' };

  /* Everything from `WIND` onward describes the air, not the ash. */
  const cloud = value.split(/\bWIND\b/)[0];

  /* An explicit denial outranks any token that follows it. */
  const denied = /\bVA\s+NOT\s+IDENTIFIABLE\b|\bNO\s+VA\s+EXP\b|\bNOT\s+AVBL\b|\bNOT\s+PROVIDED\b/.test(
    cloud
  );
  if (denied) return { ash: false, topFeet: null, baseSurface: false, raw: value };

  /* `SFC/FL230`, `FL150/230`, or a bare `FL230`. The TOP is what a plume
   * height is: the highest level ash was seen at.
   *
   * ==> IN THE BANDED FORM THE TOP CARRIES NO `FL` PREFIX. <== `FL150/230`
   * means base 15,000 ft, top 23,000 ft, and a scan for `FL\d+` alone finds
   * only the BASE — reporting a 23,000 ft plume as 15,000 ft. It fails quietly
   * because the answer is still a plausible altitude. The optional second
   * group is that top. */
  const levels = [];
  for (const m of cloud.matchAll(/\bFL(\d{2,3})(?:\/(\d{2,3}))?/g)) {
    levels.push(+m[1]);
    if (m[2] !== undefined) levels.push(+m[2]);
  }
  const baseSurface = /\bSFC\b/.test(cloud);
  if (!levels.length) {
    /* Ash asserted with no level — a real state (a position list with no
     * height). Honest answer is "ash, height unknown", never a made-up
     * number. */
    const hasPosition = /\b[NS]\d{4}\s+[EW]\d{5}\b/.test(cloud);
    return { ash: hasPosition, topFeet: null, baseSurface, raw: value };
  }

  return {
    ash: true,
    topFeet: Math.max(...levels) * flightLevelToFeet,
    baseSurface,
    raw: value,
  };
}

/**
 * Parse one advisory body into a record, or null if it is not usable.
 *
 * `null` is returned with a stated `reason` on the shape below rather than
 * thrown, because the caller has to COUNT the rejects — a source that has
 * quietly started emitting nothing but drills must be visible, not silent
 * (§5). See `parseStream()`.
 */
export function parseAdvisory(body, opts = {}) {
  const exerciseStatus = opts.exerciseStatus || ['EXER', 'TEST'];
  const flToFeet = opts.flightLevelToFeet || 100;

  const f = fields(body);
  const dtgIso = parseDtg(f.DTG);

  /* --- The three guards, and each one has a hole the other two cover. ----
   *
   * Measured on Toulouse's test bulletin (samples/vaac/toulouse-test-unknown):
   * it carries `AVIATION COLOUR CODE: RED`, an `ERUPTION AT` time, and NO
   * `STATUS:` line at all. "Absence of STATUS means operational" — which is
   * what the plan for this route said — would publish a RED eruption from a
   * drill. It is caught by the OTHER two guards. None of the three is
   * sufficient alone; that is why all three are here. */

  /* 1. Declared exercise or test traffic. */
  const status = (f.STATUS || '').toUpperCase();
  if (status && exerciseStatus.some((s) => status.includes(s))) {
    return { ok: false, reason: 'exercise', vaac: f.VAAC || null, dtg: dtgIso };
  }

  /* 2. Unjoinable volcano. Buenos Aires emits `VOLCANO: UNKNOWN` for
   *    resuspended Andean ash — a real operational product about a real ash
   *    cloud that cannot be attributed to a volcano. It must be DROPPED, not
   *    guessed at. Note the number is still present and number-shaped
   *    (`UNKNOWN 600000`), so the test reads the NAME. */
  const vol = /^(.*?)\s+(\d{6})\s*$/.exec(f.VOLCANO || '');
  const rawName = (f.VOLCANO || '').trim().toUpperCase();
  if (!vol || rawName.startsWith('UNKNOWN')) {
    return { ok: false, reason: 'unknown_volcano', vaac: f.VAAC || null, dtg: dtgIso };
  }

  /* 3. No usable date-time group. Cannot be aged, cannot be deduped, cannot
   *    be trusted. */
  if (!dtgIso) {
    return { ok: false, reason: 'no_dtg', vaac: f.VAAC || null, dtg: null };
  }

  const cloud = readAshCloud(f['OBS VA CLD'] ?? f['EST VA CLD'], flToFeet);
  const observed = 'OBS VA CLD' in f;

  return {
    ok: true,
    /** The join key: the modern 6-digit GVP number, which is exactly what
     *  assets/hazards/volcanoes-holocene.geojson is indexed on. GVP publishes
     *  the catalog the centres work from, so this is free — no crosswalk, and
     *  never a name match (London writes `KRYSUVIK`; GVP says
     *  `Krýsuvík-Trölladyngja`). */
    n: +vol[2],
    /** Display only. The catalog is the authority on a volcano's name. */
    vaacName: vol[1].trim(),
    vaac: f.VAAC || null,
    dtg: dtgIso,
    /** `2026/430`. NOT AN EVENT ID — it resets per volcano per year, and on
     *  2026-07-30 Toulouse was at `2026/1` while Washington was at `2026/430`
     *  on the same day. Carried for display, never keyed on. */
    advisoryNr: f['ADVISORY NR'] || null,
    /** §22.3 fixed colour contract. `NOT GIVEN` is a real value and stays a
     *  string rather than becoming null — "the centre declined to state a
     *  colour" is not the same as "we have no colour field". */
    colour: f['AVIATION COLOUR CODE'] || f['AVIATION COLOR CODE'] || null,
    eruptionDetails: f['ERUPTION DETAILS'] || null,
    /** ==> WIND LIFTING OLD ASH OFF THE GROUND IS NOT AN ERUPTION. <== A real
     *  ash cloud, a real aviation hazard, and no volcano doing anything. The
     *  advisory is KEPT — it is true and it is operationally useful — but it
     *  is marked, because anything that draws an eruption column from it has
     *  invented an eruption (§42.1.9).
     *
     *  **The old guard was an accident and it does not hold.** The plan
     *  assumed these fall out on their own because Buenos Aires writes
     *  `VOLCANO: UNKNOWN` for resuspended Andean ash. Measured on the live
     *  wire 2026-07-31: Sabancaya (354006) arrived NAMED and NUMBERED,
     *  advisory 2026/472, `ERUPTION DETAILS: NO ERUPTION - RESUSPENDED VA`,
     *  with a 21,000 ft top — joined the catalog cleanly and read as active.
     *
     *  Both fields are read because the phrase moves: the centres put it in
     *  `ERUPTION DETAILS` when they are opening on it and in `RMK` when they
     *  are explaining a cloud already described. */
    resuspended: RESUSPENDED_RE.test(
      `${f['ERUPTION DETAILS'] || ''} ${f.RMK || ''}`
    ),
    /** True when the centre OBSERVED the cloud, false when it ESTIMATED it
     *  (`EST VA CLD`, Darwin and Washington). Same slot, different
     *  confidence, and a UI that says "observed" about an estimate is the
     *  §5 rule about a smaller promise rendering larger data. */
    observed,
    ash: cloud.ash,
    /** Plume top in feet, or null. The only machine-readable height either
     *  live feed publishes. */
    plumeTopFeet: cloud.topFeet,
    ashCloudRaw: cloud.raw,
    nextAdvisory: f['NXT ADVISORY'] || null,
    status: classify(f, cloud),
  };
}

/**
 * active / closing / quiet — what this bulletin says the volcano is DOING.
 *
 * Derived from the six live bulletins in samples/vaac/, not from a guess:
 *
 *   Toulouse  Etna         ERUPTION ONGOING + ash SFC/FL230       -> active
 *   Tokyo     Sheveluch    VA IS NOT IDENTIFIABLE + NO FURTHER    -> closing
 *   Washington Santa Maria VA EMS ENDED + NO FURTHER              -> closing
 *   Wellington Ambae       ash no longer observable + NO FURTHER  -> closing
 *   Buenos Aires Sabancaya NO VA EMISSION + NO FURTHER            -> closing
 *
 * `quiet` is the fifth case and it is not in the fixtures: no ash in this
 * bulletin, but the centre has scheduled another one, so it is still watching.
 * That is neither an eruption nor an ending, and collapsing it into either
 * would be the app inventing a conclusion the centre did not reach.
 *
 * ==> ASH PRESENCE IS THE PRIMARY TEST, NOT THE PROSE. <== `ERUPTION DETAILS`
 * is free text and every centre writes it differently; the cloud field is
 * structured. Prose only decides between `closing` and `quiet`.
 */
function classify(f, cloud) {
  if (cloud.ash) return 'active';
  const next = (f['NXT ADVISORY'] || '').toUpperCase();
  if (/NO\s+FURTHER\s+ADVISOR/.test(next)) return 'closing';
  return 'quiet';
}

/**
 * Parse a whole stream and reduce it to one record per volcano-plus-DTG.
 *
 * ==> DEDUPE IS NOT OPTIONAL AND IT IS NOT ABOUT TIDINESS. <== Centres issue
 * on each other's behalf — a London advisory read `RMK: VAAC LONDON IS ISSUING
 * THIS ADVISORY ON BEHALF OF VAAC TOULOUSE` with `INFO SOURCE: VAAC TOULOUSE`
 * — and this relay deliberately reads OVERLAPPING bulletin slots: the same
 * advisory goes out on both the `pawu` and `panc` originators and again on the
 * AWIPS `.vaa.akN` re-routings, and Melbourne relays Darwin. That overlap is
 * fetched on purpose, because `fvfe01.rjtd..txt` and `fvfe01.rjtd.vaa.ak1.txt`
 * are not the same bytes and guessing which one to skip is how an eruption goes
 * missing. Reading all of it is only safe BECAUSE of this dedupe. Keyed on GVP
 * number + DTG, per VOLCANO.dedupeKey.
 *
 * Then, per volcano, the NEWEST advisory wins. Not the most alarming one: a
 * close published after an eruption is the current truth, and taking the max
 * over some severity would pin a volcano to its worst moment forever.
 *
 * @returns {{advisories: object[], rejected: object, seen: number}}
 */
export function parseStream(stream, opts = {}) {
  const bodies = splitAdvisories(stream);
  const rejected = { exercise: 0, unknown_volcano: 0, no_dtg: 0 };
  const byKey = new Map();

  for (const body of bodies) {
    const rec = parseAdvisory(body, opts);
    if (!rec.ok) {
      if (rec.reason in rejected) rejected[rec.reason]++;
      continue;
    }
    const key = `${rec.n}+${rec.dtg}`;
    if (!byKey.has(key)) byKey.set(key, rec);
  }

  /* Newest per volcano. */
  const newest = new Map();
  for (const rec of byKey.values()) {
    const prev = newest.get(rec.n);
    if (!prev || rec.dtg > prev.dtg) newest.set(rec.n, rec);
  }

  return {
    advisories: [...newest.values()].sort((a, b) => (a.dtg < b.dtg ? 1 : -1)),
    rejected,
    seen: bodies.length,
  };
}
