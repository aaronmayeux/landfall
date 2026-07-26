/**
 * /api/tcgp/inspect — READ-ONLY probe into UCAR's Tropical Cyclone Guidance
 * Project (TCGP).
 *
 * WHY THIS EXISTS. §15 carries the last open question standing between model
 * tracks and §14's both-sources rule: NOAA's public a-deck directory serves
 * `al`/`ep`/`cp` ONLY, so every GDACS storm — every West Pacific typhoon and
 * Indian Ocean cyclone the app draws — has no model guidance at all. TCGP
 * publishes a-decks for those basins. What has NEVER been read is a single
 * BYTE of one, and §4's standing rule is that a parser is not written against
 * a guessed shape.
 *
 * ==> WHAT IS ALREADY MEASURED, 2026-07-26, AND WHAT IS NOT <==
 *
 * MEASURED (by reading TCGP's own pages, not inferred):
 *   - A-deck files exist for wp/io/sh, publicly linked, no login and no key.
 *   - The URL is fully derivable from a storm id. Noul's is `awp112026.dat`.
 *   - The LIVE host is the beta one below. The long-standing production host
 *     `hurricanes.ral.ucar.edu` still serves storm pages, but its current-
 *     storms index froze on 26 May 2026 and reports "no current storms" in
 *     every basin — two months stale and confidently wrong. The beta host
 *     was updated 26 July 2026 03:27 UTC and listed Fausto, Genevieve and
 *     Noul correctly.
 *   - TCGP's designation for Noul is WP11, matching the `11W` JTWC already
 *     gives us through /api/jtwc/storms. The id join §15 called solved is
 *     confirmed against a third, independent source.
 *
 * NOT MEASURED, WHICH IS THE ENTIRE POINT OF THIS ROUTE:
 *   - Whether `lib/adeck.js` parses these rows unchanged.
 *   - WHICH MODELS A NON-NHC DECK CARRIES. `MODEL_TRACKS.techs` (TVCN / HCCA
 *     / AVNO / UKX / HFSA) was derived from Atlantic decks. §15 says plainly:
 *     do not assume they appear in a western Pacific deck. TCGP's own plot
 *     titles for Noul name GEFS, GEPS and NAVGEM, which is a hint the mix
 *     genuinely differs — but a chart title is not a file, and this project
 *     has paid for that difference before (§14, the wind swath).
 *   - Whether the file is plain text or gzipped. NOAA's equivalent is
 *     `.dat.gz`; TCGP's link says `.dat`. This route DETECTS rather than
 *     assumes, and reports which it found.
 *
 * ==> THE HOST RISK, RECORDED SO IT IS NOT DISCOVERED LATER <==
 * The live data sits behind a path containing `hurricanes-beta` on a host
 * named `verif.rap.ucar.edu`, which reads like an internal verification
 * server. That is not a stable address to build a shipped feature on. Nothing
 * here commits the app to it — this route reads, it does not ship a layer.
 * Resolve the host question before any of this reaches a user.
 *
 * ==> WHAT TCGP SAYS ABOUT ITS OWN DATA <==
 * Recorded because it bears on whether the app uses this at all, and a note
 * in a commit message is not where that belongs. TCGP's guidelines state, in
 * their own capitals, "DO NOT USE THIS SITE FOR LIFE AND DEATH DECISIONS",
 * describe the site as built for tropical cyclone experts and researchers
 * with everyone else welcome for informational and educational purposes only,
 * and warn that it is not maintained in a 24/7 operational environment and
 * may go down without notice. The last of those is an ENGINEERING fact
 * whatever is decided about the rest: this source WILL be unavailable
 * sometimes, and §5 requires that to look different from "no models forecast
 * this storm".
 *
 * SAFE TO LEAVE DEPLOYED, on the same terms as its four siblings. It:
 *   - only ever GETs from one hardcoded host,
 *   - writes nothing, anywhere,
 *   - caches nothing,
 *   - refuses everything unless INSPECT_KEY is set and matches,
 *   - accepts a storm id matching a strict pattern and nothing else.
 *
 * NOT A GENERAL PROXY. The host is fixed, the basin must be one of the three
 * NHC does not cover, and the path is built from an allowlisted shape.
 *
 * USAGE:
 *   /api/tcgp/inspect?storm=wp112026           → the deck, described
 *   /api/tcgp/inspect?storm=wp112026&samples=1 → plus 3 real rows per model
 *   /api/tcgp/inspect?storm=wp112026&full=1   → its RAW bytes, untruncated
 *
 * NO CSP CHANGE IS NEEDED. The browser never talks to this host — this runs
 * server-side, same as every other relay (§17 Pass B).
 *
 * Imports: ../_inspect-guard.js. Imported by nothing.
 */

import { guardInspect } from '../_inspect-guard.js';

const HOST = 'https://verif.rap.ucar.edu';
const BASE = `${HOST}/jntweb/hurricanes-beta/realtime/plots`;

/** Be identifiable in UCAR's logs, same as the other relays. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/**
 * Basin code → the folder segment TCGP files it under.
 *
 * EVERY ONE OF THESE WAS READ OFF A LIVE TCGP URL on 2026-07-26, not guessed
 * from the basin's English name: `wp112026` and `wp102026` under
 * northwestpacific, `io932026` under northindian, `sh272026` / `sh292026` /
 * `sh312026` under southernhemisphere.
 *
 * DELIBERATELY ONLY THE THREE NHC DOES NOT COVER. `al`, `ep` and `cp` are
 * absent on purpose and their folder names are NOT recorded here even though
 * TCGP carries them: the app already has an authoritative deck for those
 * basins straight from NOAA, and a second source for the same storm is a way
 * for two answers to disagree in front of a user. If this ever needs to
 * change it should be a decision, not a line someone helpfully filled in.
 */
const BASIN_FOLDER = Object.freeze({
  wp: 'northwestpacific',
  io: 'northindian',
  sh: 'southernhemisphere',
});

/**
 * `wp|io|sh` + two digits + a four-digit year, and NOTHING else reaches the
 * upstream URL. Same reasoning as /api/nhc/adeck's guard: this is a path built
 * from a query parameter, so the allowed shape is an explicit allowlist rather
 * than an escape — `..%2f` and friends cannot survive a pattern that only
 * admits eight known characters.
 */
const STORM_ID = /^(wp|io|sh)(\d{2})(\d{4})$/;

/** Column 4 (zero-based) of an ATCF row is the model code. Mirrors adeck.js. */
const TECH_COLUMN = 4;

/**
 * Rows of each model to show when samples are asked for.
 *
 * ==> SAMPLES ARE OFF BY DEFAULT, AND THAT IS A SCAR <==
 * The first version of this route emitted three sample rows for every model
 * and put the summary AFTER them. A West Pacific deck turned out to carry 87
 * models, so the response ran to hundreds of lines and the one field the
 * probe existed to produce — whether the five models we draw appear at all —
 * was past the end of what could be read. The probe answered its own question
 * and then buried the answer under its evidence.
 *
 * PUT THE ANSWER BEFORE THE EVIDENCE. A diagnostic that has to be read in
 * full is a diagnostic that will be read in part.
 */
const SAMPLE_ROWS = 3;

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

/** Gzip magic number. TCGP links a bare `.dat`; NOAA's equivalent is gzipped. */
function looksGzipped(bytes) {
  return bytes.length > 1 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Pull the model code out of an ATCF row without splitting the whole line.
 * Lifted from /api/nhc/adeck.js so the two read the column identically.
 *
 * @returns {string|null} The code, or null if the row is too short.
 */
function techOf(line) {
  let start = 0;
  let col = 0;
  while (col <= TECH_COLUMN) {
    const comma = line.indexOf(',', start);
    if (comma === -1) return col === TECH_COLUMN ? line.slice(start).trim() : null;
    if (col === TECH_COLUMN) return line.slice(start, comma).trim();
    start = comma + 1;
    col += 1;
  }
  return null;
}

/**
 * Describe a deck without interpreting it.
 *
 * Everything here is a COUNT or a VERBATIM row. Nothing is normalised,
 * reordered or corrected, because the question this route exists to answer is
 * what the file actually says — a describer that tidies its input answers a
 * different question than the one asked.
 */
function describe(text, withSamples) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  /** model code → { rows, newestCycle, minTau, maxTau, samples[] } */
  const techs = new Map();
  /** Every distinct cycle timestamp seen, as published (column 2). */
  const cycles = new Set();
  let unparsed = 0;

  for (const line of lines) {
    const tech = techOf(line);
    if (!tech) { unparsed += 1; continue; }
    if (!techs.has(tech)) {
      techs.set(tech, {
        rows: 0, newestCycle: null, minTau: Infinity, maxTau: -Infinity, samples: [],
      });
    }
    const entry = techs.get(tech);
    entry.rows += 1;
    if (withSamples && entry.samples.length < SAMPLE_ROWS) entry.samples.push(line);

    const parts = line.split(',');
    const cycle = parts[2] ? parts[2].trim() : '';
    if (cycle) {
      cycles.add(cycle);
      /* String compare is correct on a zero-padded YYYYMMDDHH. */
      if (!entry.newestCycle || cycle > entry.newestCycle) entry.newestCycle = cycle;
    }
    /* TAU, the forecast hour. Reported per model because a NEGATIVE tau means
     * the row describes the PAST, not a forecast — `CARQ` carries -18/-12/-6.
     * A model whose taus are all <= 0 is not guidance and must never be drawn
     * as a forecast line. */
    const tau = Number(parts[5]);
    if (Number.isFinite(tau)) {
      if (tau < entry.minTau) entry.minTau = tau;
      if (tau > entry.maxTau) entry.maxTau = tau;
    }
  }

  const sortedCycles = [...cycles].sort();

  return {
    /* --- THE ANSWER, FIRST. See SAMPLE_ROWS above for why this ordering is
     * not cosmetic. --------------------------------------------------- */

    /* Do the five the app already draws appear in a non-NHC deck at all?
     * §15 said explicitly not to assume they do. */
    nhcShortlistPresent: ['TVCN', 'HCCA', 'AVNO', 'UKX', 'HFSA']
      .filter((t) => techs.has(t)),
    distinctTechs: techs.size,
    lines: lines.length,
    unparsedRows: unparsed,
    cycleCount: sortedCycles.length,
    oldestCycle: sortedCycles[0] ?? null,
    newestCycle: sortedCycles[sortedCycles.length - 1] ?? null,

    /* --- THE EVIDENCE, AFTER IT. --------------------------------------- */

    /* Busiest first — a code with real coverage is what a shortlist would be
     * drawn from, and a code appearing twice is noise. */
    techs: [...techs.entries()]
      .sort((a, b) => b[1].rows - a[1].rows)
      .map(([tech, v]) => ({
        tech,
        rows: v.rows,
        newestCycle: v.newestCycle,
        tau: Number.isFinite(v.minTau) ? [v.minTau, v.maxTau] : null,
        ...(withSamples ? { samples: v.samples } : {}),
      })),
    firstRow: lines[0] ?? null,
    lastRow: lines[lines.length - 1] ?? null,
  };
}

export async function onRequestGet(context) {
  const denied = guardInspect(context);
  if (denied) return denied;

  const url = new URL(context.request.url);
  const storm = String(url.searchParams.get('storm') || '').toLowerCase().trim();
  const full = url.searchParams.get('full') === '1';

  const match = STORM_ID.exec(storm);
  if (!match) {
    return new Response(
      JSON.stringify({
        error: 'bad_storm_id',
        expected: 'wp|io|sh + two digits + four-digit year, e.g. wp112026',
        note: 'al/ep/cp are deliberately not served here — NOAA is the source for those basins.',
      }),
      { status: 400, headers: jsonHeaders }
    );
  }

  const [, basin, , year] = match;
  const folder = BASIN_FOLDER[basin];
  const upstream = `${BASE}/${folder}/${year}/${storm}/a${storm}.dat`;

  let response;
  try {
    response = await fetch(upstream, { headers: { 'User-Agent': USER_AGENT } });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'upstream_unreachable', upstream, detail: String(e?.message || e) }),
      { status: 502, headers: jsonHeaders }
    );
  }

  /* A missing deck is NOT an error — same three-state distinction /api/nhc/adeck
   * makes (§5). A storm with no guidance run against it yet is `none`, and it
   * must never be reported as a dead source. */
  if (response.status === 404) {
    return new Response(
      JSON.stringify({ result: 'none', upstream, note: 'No deck published for this storm.' }),
      { headers: jsonHeaders }
    );
  }
  if (!response.ok) {
    return new Response(
      JSON.stringify({ error: 'upstream_status', upstream, status: response.status }),
      { status: 502, headers: jsonHeaders }
    );
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  const gzipped = looksGzipped(buffer);

  let text;
  try {
    text = gzipped
      ? await new Response(
          new Response(buffer).body.pipeThrough(new DecompressionStream('gzip'))
        ).text()
      : new TextDecoder().decode(buffer);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'decode_failed', upstream, gzipped, detail: String(e?.message || e) }),
      { status: 502, headers: jsonHeaders }
    );
  }

  if (full) {
    return new Response(text, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  /* Is this even a deck? Checked on what arrived, before describing it — an
   * error page described as a deck yields "0 models", which reads exactly like
   * a real storm nobody is modelling (§5). Every ATCF row opens with a
   * two-letter basin and a comma. */
  const looksLikeAdeck = /^[A-Z]{2},/m.test(text);

  return new Response(
    JSON.stringify({
      upstream,
      httpStatus: response.status,
      contentType: response.headers.get('Content-Type'),
      bytes: buffer.length,
      gzipped,
      looksLikeAdeck,
      ...(looksLikeAdeck
        ? describe(text, url.searchParams.get('samples') === '1')
        : { head: text.slice(0, 600) }),
    }, null, 2),
    { headers: jsonHeaders }
  );
}
