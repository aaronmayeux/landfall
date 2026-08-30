/**
 * seasons-retired-derive.mjs — the arithmetic behind the retired-names answer.
 *
 * ==> IT IS PURE ON PURPOSE, AND THAT IS THE SAME SPLIT `seasons-names-parse`
 * USES. <== No fetch, no fs, no clock. `seasons-retired.mjs` reads the files,
 * writes the module and reports; this does nothing but turn strings and sets
 * into an answer. That is what lets `tools/test-seasons-retired.mjs` drive
 * every rule against invented edge cases AND against the real archive without
 * a network, which is the only way a session inside the wall can prove any of
 * it works.
 *
 * ==> WHY THIS LIVES IN tools/ AND NOT lib/. <== §12: every import in `lib/`
 * ships to every visitor. A phone reads the OUTPUT, `data/retired-names.js`.
 * It never computes it.
 *
 * The method and the reasoning are in `seasons-retired.mjs`. This file holds
 * the rules and nothing else.
 */

/**
 * HURDAT2 names an unnamed depression after its number. Those are not names.
 * The record spells them both ways — TWENTY-ONE in 2023, TWENTYONE in 2019 —
 * which is why this is a pattern and not a list.
 */
export const ORDINAL = /^(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE|THIRTEEN|FOURTEEN|FIFTEEN|SIXTEEN|SEVENTEEN|EIGHTEEN|NINETEEN|TWENTY|THIRTY)(-?(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE))?$/;

/**
 * The first season each basin's subtraction may speak about. MEASURED — the
 * numbers behind each are in `data/retired-names-historic.js`.
 */
export const FLOOR = Object.freeze({ atlantic: 1979, epacific: 1995, cpacific: 1995 });

/**
 * ==> SIX, AND IT IS THE SIX MOST RECENT RATHER THAN EVERY YEAR ON FILE. <==
 * `lib/season-names-data.js` merges forward and never drops a year, so it will
 * eventually hold seasons already spent. A name retired after one of those
 * seasons is taken off the list it will next appear on, but the stale column
 * keeps it — and a union over every year would then report a genuinely retired
 * name as still in service, silently, forever. That is §57.17's failure
 * arriving by a different door and this constant is what shuts it.
 */
export const ACTIVE_LIST_COUNT = 6;

/** The first season a name could have come off the supplemental list. */
export const SUPPLEMENTAL_ERA = 2021;

/**
 * Retirement runs at one or two names a year; the worst real season is 2005
 * with five. More than this in one run means a parse changed shape.
 */
export const DELTA_CAP = 6;

/** Which id prefixes belong to which basin. One NOAA file carries two. */
export const BASINS = Object.freeze([
  { key: 'atlantic', file: 'hurdat2-atlantic-', prefixes: ['AL'] },
  { key: 'epacific', file: 'hurdat2-epacific-', prefixes: ['EP'] },
  { key: 'cpacific', file: 'hurdat2-epacific-', prefixes: ['CP'] },
]);

/**
 * Every named storm in one basin, out of raw HURDAT2 text.
 *
 * Header rows only — exactly four comma-separated fields, `AL011851, NAME, 14,`.
 * Track rows carry twenty-odd and are skipped by the field count alone, so a
 * name that happens to look like a coordinate cannot get in.
 *
 * @returns {{ used: Map<string, number[]>, spend: Map<number, number>, headers: number }}
 */
export function readBasin(text, prefixes) {
  const used = new Map();
  const spend = new Map();
  let headers = 0;
  for (const line of String(text || '').split('\n')) {
    const parts = line.split(',');
    if (parts.length !== 4) continue;
    const id = parts[0].trim();
    if (!/^[A-Z]{2}\d{6}$/.test(id)) continue;
    if (!prefixes.includes(id.slice(0, 2))) continue;
    headers++;
    const name = parts[1].trim().toUpperCase();
    const year = Number(id.slice(4));
    if (name === 'UNNAMED' || ORDINAL.test(name)) continue;
    spend.set(year, (spend.get(year) || 0) + 1);
    if (!used.has(name)) used.set(name, []);
    used.get(name).push(year);
  }
  return { used, spend, headers };
}

/**
 * The names still in service: the six most recent rotating lists per basin,
 * plus every Central Pacific name (its lists are continuous, not annual).
 *
 * @returns {{ inService: Set<string>, listLengths: Record<string, number>, faults: string[] }}
 */
export function inServiceFrom(rosters, cpacificNames) {
  const faults = [];
  const inService = new Set();
  const listLengths = {};

  for (const [basin, byYear] of Object.entries(rosters || {})) {
    const years = Object.keys(byYear).map(Number).sort((a, b) => a - b).slice(-ACTIVE_LIST_COUNT);
    if (years.length !== ACTIVE_LIST_COUNT) {
      faults.push(`${basin}: ${years.length} active lists, expected ${ACTIVE_LIST_COUNT}`);
    }
    for (const y of years) for (const n of byYear[y]) inService.add(String(n).toUpperCase());
    listLengths[basin] = Math.max(0, ...years.map((y) => byYear[y].length));
  }

  const cp = Array.from(cpacificNames || []);
  if (!cp.length) faults.push('no Central Pacific names in service');
  for (const n of cp) inService.add(String(n).toUpperCase());
  /* ==> THE CENTRAL PACIFIC GUARD MUST NEVER FIRE. <== Its lists run one after
   * another across seasons, so there is no end of a list to run past and no
   * supplemental list to fall onto. Infinity says that rather than a number
   * that would be a guess. */
  listLengths.cpacific = Infinity;

  return { inService, listLengths, faults };
}

/**
 * The subtraction.
 *
 * @param {Record<string, {used: Map, spend: Map}>} record  per basin
 * @param {Set<string>} inService
 * @param {object} exclusions  { greek:Set, described:Set, neverUsed:Set }
 * @param {Record<string, number>} listLengths
 * @returns {{ derived: Record<string, [string, number][]>, declined: string[] }}
 */
export function derive(record, inService, exclusions, listLengths) {
  const { greek, described, neverUsed } = exclusions;
  const derived = { atlantic: [], epacific: [], cpacific: [] };
  const declined = [];

  /* ==> THE BASINS ARE WALKED IN ORDER AND THE FIRST ONE CLAIMS A NAME. <==
   * Otto 2016, Bonnie 2022 and Julia 2022 all crossed from the Atlantic into
   * the east Pacific and the record carries each under both prefixes. Without
   * this, an Atlantic retirement is reported twice and an Atlantic name still
   * in service is reported as an east Pacific retirement. Measured 2026-08-30:
   * those three exactly, and nothing else. */
  const claimed = new Set();

  for (const { key } of BASINS) {
    const basin = record[key];
    if (!basin) continue;
    const floor = FLOOR[key];
    for (const [name, years] of [...basin.used].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (!years.some((y) => y >= floor)) continue;
      if (inService.has(name)) continue;
      if (claimed.has(name)) continue;
      if (greek.has(name) || described.has(name) || neverUsed.has(name)) continue;

      /* ==> THE SUPPLEMENTAL GUARD, AND IT DECLINES RATHER THAN GUESSES. <==
       * We hold the six rotating lists but not the supplemental list. A name
       * spent past the end of a rotating list from 2021 on could be a
       * supplemental name still in perfectly good standing, and nothing here
       * can tell. §5: that is "we could not look", never "not retired", so it
       * is dropped from the answer and said out loud in the report. */
      const cap = listLengths[key] ?? Infinity;
      const risky = years.filter((y) => y >= SUPPLEMENTAL_ERA && (basin.spend.get(y) || 0) > cap);
      if (risky.length) {
        declined.push(`${name} (${risky.join(', ')}): that season ran past the rotating list in the supplemental era — cannot judge`);
        continue;
      }

      claimed.add(name);
      derived[key].push([name, Math.max(...years)]);
    }
  }
  return { derived, declined };
}

/**
 * GATE — every claimed name appears in the record in the year claimed, and
 * NEVER after it. A retired name cannot be used again, so a later use means
 * the claim is wrong. Free: we own the data.
 */
export function crossCheck(derived, record) {
  const faults = [];
  for (const { key } of BASINS) {
    for (const [name, year] of derived[key] || []) {
      const years = record[key]?.used.get(name);
      if (!years) { faults.push(`${key}: ${name} is claimed retired but appears in no storm`); continue; }
      if (!years.includes(year)) {
        faults.push(`${key}: ${name} is dated ${year} but the record has it in ${years.join(', ')}`);
      }
      const after = years.filter((y) => y > year);
      if (after.length) {
        faults.push(`${key}: ${name} was used again in ${after.join(', ')} after being retired in ${year}`);
      }
    }
  }
  return faults;
}

/**
 * GATE — monotonic and delta-capped, against the answer already committed.
 *
 * Retirement is append-only: a name never returns to service. So a name
 * LEAVING the answer cannot be legitimate, and it is the signature of a
 * half-parsed active list — the one failure that would otherwise be quiet.
 *
 * @param {Set<string>} now    every name in the new answer, all sources
 * @param {Set<string>} before every name in the committed answer
 */
export function judge(now, before) {
  const faults = [];
  const notes = [];
  if (!before) return { faults, notes };

  const lost = [...before].filter((n) => !now.has(n));
  if (lost.length) {
    faults.push(`${lost.length} name(s) would be UN-retired, which cannot happen: ${lost.join(', ')}`);
  }
  const gained = [...now].filter((n) => !before.has(n));
  if (gained.length > DELTA_CAP) {
    faults.push(`${gained.length} new retirements in one run, over the cap of ${DELTA_CAP}: ${gained.join(', ')}`);
  } else if (gained.length) {
    notes.push(`new since the committed answer: ${gained.join(', ')}`);
  } else {
    notes.push('no change against the committed answer');
  }
  return { faults, notes };
}
