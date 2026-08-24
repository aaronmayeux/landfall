/**
 * hurdat.js — NOAA's two history formats, read into one shape.
 * SPEC-SEASONS-BUILD.md §57.4, §57.4a, §57.13, §57.30 step 2.
 *
 * ==> ONE PARSER, IMPORTED BY BOTH SIDES. <== This is a plain ES module with
 * no DOM and no network, so the Node runner that mirrors NOAA and the browser
 * Worker that indexes a download import the SAME file. Two parsers drifting
 * apart is a bug this project has already paid for elsewhere.
 *
 * ==> THE TWO FORMATS ARE NOT THE SAME FORMAT, AND THE DIFFERENCE IS SILENT.
 * <== HURDAT2 is the reviewed database: one fixed-width row per time, all
 * twelve wind-radii numbers on it. ATCF b-decks are the operational working
 * file: ONE LINE PER WIND THRESHOLD, so up to three lines share a timestamp
 * and repeat the position. A reader keyed on time that overwrites keeps
 * whichever threshold happened to come last and throws the other two away —
 * a Cat 4's wind field reduced to its 64 kt core or its 34 kt envelope
 * depending on line order. Nothing errors. `tools/test-hurdat.mjs` reproduces
 * exactly that and goes red for it.
 *
 * ==> AND THE STORM'S NAME IS NOT A PROPERTY OF THE B-DECK FILE. <== It
 * changes DOWN the file as the system is reclassified. All fourteen 2026
 * b-decks carry more than one: Bertha's rows read GENESIS004 → INVEST → TWO →
 * BERTHA. Reading the first row's name, which is the obvious thing to do,
 * labels a storm with an internal genesis counter. Take the LAST.
 *
 * ==> THE DATELINE. <== Both formats write longitude inside -180..180 with a
 * hemisphere letter, so a storm crossing the antimeridian publishes 179.2W and
 * then 179.9E — two positions half a degree apart whose numbers are 359 apart.
 * Handed to a map unchanged, that is a line instructed to travel the long way
 * round the world, and it draws exactly that. Every normalised point therefore
 * carries `lon` (what the file said) AND `lonU` (continuous, may run past
 * ±180), computed once here rather than by each consumer. Hurricane Della,
 * CP011957, crosses at record 35 of 48 and is the fixture.
 *
 * ==> NOTHING HERE GATES ON A YEAR. <== §57.6 lists cliffs — wind radii from
 * 2004, radius of maximum wind from 2021 — and they are true as generalities
 * and false as rules. AL011852 carries a radius of maximum wind of 10 nm on
 * its landfall row, in 1852. Every missing value is decided by reading the
 * sentinel on that row, never by asking what year it is.
 *
 * Imports config/ and lib/adeck.js (for the ATCF coordinate and timestamp
 * readers, which are already proven on live decks). No DOM, no network, no
 * clock, no map.
 */

import { SEASONS } from '../config/constants.js';
import { atcfLatLon, parseDtg } from './adeck.js';

/* ---------------------------------------------------------------------------
 * SMALL READERS
 * ------------------------------------------------------------------------- */

const trim = (s) => String(s ?? '').trim();

/**
 * A HURDAT2 number, with both missing markers turned into null.
 *
 * `-999` means nobody measured it. `-99` means no intensity was ever assigned
 * — the non-developing depressions §57.6 describes. Both become null because
 * both mean "we do not know", and the distinction is recorded in the constants
 * block rather than carried into every downstream consumer as two kinds of
 * nothing.
 */
function num(field) {
  const t = trim(field);
  if (!t) return null;
  if (t === SEASONS.hurdatMissing || t === SEASONS.hurdatNoIntensity) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/**
 * `'28.0N'` / `'94.8W'` → signed degrees. HURDAT2 writes DECIMAL degrees with
 * a hemisphere letter; ATCF writes TENTHS with one. Two readers, deliberately,
 * because a single one guessing which it was handed is how `286N` becomes 286
 * degrees — a coordinate that silently wraps to a plausible wrong place on a
 * globe instead of failing.
 */
function hurdatLatLon(token) {
  const t = trim(token);
  if (t.length < 2) return null;
  const hemi = t[t.length - 1].toUpperCase();
  if (hemi !== 'N' && hemi !== 'S' && hemi !== 'E' && hemi !== 'W') return null;
  const v = Number(t.slice(0, -1));
  if (!Number.isFinite(v)) return null;
  return hemi === 'W' || hemi === 'S' ? -v : v;
}

/** `'20210829'`, `'1655'` → epoch ms, UTC. Parsed field by field rather than
 *  by `Date.parse`, which has no defined behaviour for either of these. */
function hurdatTime(dateField, timeField) {
  const d = trim(dateField);
  const t = trim(timeField).padStart(4, '0');
  if (!/^\d{8}$/.test(d) || !/^\d{4}$/.test(t)) return null;
  const ms = Date.UTC(
    Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)),
    Number(t.slice(0, 2)), Number(t.slice(2, 4)),
  );
  return Number.isFinite(ms) ? ms : null;
}

/** Four quadrant radii, or null when the whole group is missing. A group with
 *  SOME numbers is kept as-is: a partial measurement is still a measurement,
 *  and turning it into nothing would throw away real data. */
function radiiGroup(fields, start) {
  const v = SEASONS.quadrantOrder.map((_, i) => num(fields[start + i]));
  if (v.every((x) => x == null)) return null;
  const out = {};
  SEASONS.quadrantOrder.forEach((q, i) => { out[q] = v[i]; });
  return out;
}

/* ---------------------------------------------------------------------------
 * THE DATELINE
 * ------------------------------------------------------------------------- */

/** Longitude difference folded into (-180, 180]. Every seam-safe step in the
 *  app uses this shape; it is repeated here rather than imported so this file
 *  keeps its one-way dependency on `adeck.js` down to the two ATCF readers. */
function dLon(a, b) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/**
 * Fill in `lonU` — the same track with longitudes made continuous, so a
 * crossing of the antimeridian carries on past ±180 instead of snapping back.
 *
 * The first point keeps its published value, so nothing translates and a
 * storm that never goes near the seam has `lonU === lon` on every record.
 * Mutates in place because it runs once, over a freshly built array, inside
 * this file.
 */
function unwrapLongitudes(points) {
  if (!points.length) return points;
  points[0].lonU = points[0].lon;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].lonU;
    points[i].lonU = prev + dLon(points[i].lon, prev);
  }
  return points;
}

/* ---------------------------------------------------------------------------
 * WHICH STORMS ARE REAL — §57.13
 * ------------------------------------------------------------------------- */

/**
 * `'AL092021'` → `{ basin, number, year }`, or null if it is not a storm id.
 *
 * The number band matters: 90–99 are invests and those numbers are REUSED
 * several times inside one season, so mirroring a directory unfiltered ships
 * three different systems all called 92 and they overwrite each other. 80–89
 * are internal test systems.
 */
export function parseStormId(id) {
  const t = trim(id).toUpperCase();
  if (!/^[A-Z]{2}\d{6}$/.test(t)) return null;
  const basin = t.slice(0, 2);
  const number = Number(t.slice(2, 4));
  const year = Number(t.slice(4, 8));
  return { basin, number, year };
}

/** True when this id names a real storm rather than an invest or a test. */
export function isRealStorm(id) {
  const p = parseStormId(id);
  if (!p) return false;
  if (!SEASONS.nhcBasins.includes(p.basin)) return false;
  return p.number >= SEASONS.realStormNumberMin && p.number <= SEASONS.realStormNumberMax;
}

/** A name the file uses as a placeholder rather than as a name. Pre-1950
 *  storms are all UNNAMED; a b-deck's early rows are genesis counters and
 *  invest markers. §57.14 gives unnamed storms a display form elsewhere —
 *  this only decides whether the file told us a name at all. */
function isPlaceholderName(name) {
  const n = trim(name).toUpperCase();
  if (!n) return true;
  if (n === 'UNNAMED' || n === 'INVEST' || n === 'NONAME') return true;
  return /^GENESIS\d*$/.test(n);
}

/* ---------------------------------------------------------------------------
 * HURDAT2
 * ------------------------------------------------------------------------- */

/**
 * Read a whole HURDAT2 file — or one storm cut out of it — into storms.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {boolean} [opts.keepUnreal]  keep invests and test numbers, for tests
 * @returns {{storms: Array, faults: Array}}
 *
 * ==> FAULTS ARE RETURNED, NEVER THROWN AND NEVER SWALLOWED. <== A 6.8 MB
 * file with one bad row must not lose 174 good seasons, and it must not
 * pretend the row was fine either. Every unreadable row and every header whose
 * declared row count does not match what followed comes back in `faults`, and
 * §5 makes surfacing that the caller's job.
 */
export function parseHurdat2(text, { keepUnreal = false } = {}) {
  const storms = [];
  const faults = [];
  const lines = String(text ?? '').split('\n');

  let current = null;
  let declaredRows = 0;

  const closeCurrent = () => {
    if (!current) return;
    if (declaredRows && current.points.length !== declaredRows) {
      /* The header carries its own row count. Checking it is free and it is
       * the only integrity signal the format offers — a mismatch means the
       * splitter and the file disagree about where this storm ended. */
      faults.push({
        kind: 'row_count_mismatch',
        id: current.id,
        declared: declaredRows,
        found: current.points.length,
      });
    }
    unwrapLongitudes(current.points);
    storms.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (!line.trim()) continue;
    const fields = line.split(',');

    if (fields.length <= SEASONS.hurdatHeaderFields) {
      closeCurrent();
      const id = trim(fields[0]).toUpperCase();
      const parsed = parseStormId(id);
      if (!parsed) {
        faults.push({ kind: 'bad_header', line: i + 1, text: line.slice(0, 80) });
        declaredRows = 0;
        continue;
      }
      if (!keepUnreal && !isRealStorm(id)) {
        /* Skipped, not a fault. §57.13 says these are supposed to be here. */
        declaredRows = 0;
        continue;
      }
      const rawName = trim(fields[1]);
      declaredRows = Number(trim(fields[2])) || 0;
      current = {
        id,
        basin: parsed.basin,
        number: parsed.number,
        year: parsed.year,
        name: isPlaceholderName(rawName) ? null : rawName.toUpperCase(),
        source: 'hurdat2',
        /* HURDAT2 is the reviewed database. §57.11: the app must be able to
         * say which of the two it is showing, and it cannot say it if the
         * shape does not carry it. */
        provisional: false,
        points: [],
      };
      continue;
    }

    if (!current) continue; /* a data row before any header we kept */

    if (fields.length !== SEASONS.hurdatDataFields) {
      faults.push({
        kind: 'bad_row_width',
        id: current.id,
        line: i + 1,
        found: fields.length,
        expected: SEASONS.hurdatDataFields,
      });
      continue;
    }

    const time = hurdatTime(fields[0], fields[1]);
    const lat = hurdatLatLon(fields[4]);
    const lon = hurdatLatLon(fields[5]);
    if (time == null || lat == null || lon == null) {
      faults.push({ kind: 'bad_row_values', id: current.id, line: i + 1 });
      continue;
    }

    current.points.push({
      time,
      /* NOAA has already marked the moments that matter — landfall, peak wind,
       * minimum pressure, rapid change. §57.5 lists seven codes; the real file
       * carries nine, adding `T` and `S`. Whatever is in the column is carried
       * through unvalidated, because a closed list would silently drop the
       * tenth code NOAA adds. */
      marker: trim(fields[2]) || null,
      status: trim(fields[3]).toUpperCase(),
      lat,
      lon,
      lonU: lon,
      windKt: num(fields[6]),
      pressureMb: num(fields[7]),
      radii: {
        r34: radiiGroup(fields, 8),
        r50: radiiGroup(fields, 12),
        r64: radiiGroup(fields, 16),
      },
      rmwNm: num(fields[20]),
    });
  }

  closeCurrent();
  return { storms, faults };
}

/* ---------------------------------------------------------------------------
 * ATCF B-DECKS
 * ------------------------------------------------------------------------- */

const A = SEASONS.atcf;

/**
 * Read one ATCF b-deck — the operational working file for a storm in progress.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.id]  fallback id, e.g. from the filename
 * @returns {{storm: object|null, faults: Array}}
 */
export function parseBdeck(text, { id = null } = {}) {
  const faults = [];
  const lines = String(text ?? '').split('\n');

  /* Keyed on timestamp. THE VALUE IS MERGED INTO, NEVER REPLACED — see the
   * file header. A Map keeps insertion order, which is the file's order, which
   * is chronological; nothing here re-sorts and then hopes. */
  const byTime = new Map();

  let basin = null;
  let number = null;
  let year = null;
  let lastName = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (!line.trim()) continue;
    const f = line.split(',').map(trim);

    if (f.length <= A.name) {
      faults.push({ kind: 'short_row', line: i + 1, found: f.length });
      continue;
    }

    if (f[A.tech] && f[A.tech].toUpperCase() !== SEASONS.atcfBestTech) continue;

    const time = parseDtg(f[A.dtg]);
    const lat = atcfLatLon(f[A.lat]);
    const lon = atcfLatLon(f[A.lon]);
    if (time == null || lat == null || lon == null) {
      faults.push({ kind: 'bad_row_values', line: i + 1 });
      continue;
    }

    basin = basin || (f[A.basin] || '').toUpperCase();
    if (number == null) number = Number(f[A.cycloneNumber]);
    if (year == null) year = Number(String(f[A.dtg]).slice(0, 4));

    /* ==> THE LAST NON-PLACEHOLDER NAME WINS. <== Not the first row's, which
     * is a genesis counter, and not the last row's unconditionally either: a
     * storm that decays back to a remnant low can end its file on a row NHC
     * has stopped naming. Keeping the last REAL name is what survives both. */
    const rowName = f[A.name];
    if (!isPlaceholderName(rowName)) lastName = rowName.toUpperCase();

    let pt = byTime.get(time);
    if (!pt) {
      pt = {
        time,
        marker: null,
        status: (f[A.status] || '').toUpperCase(),
        lat,
        lon,
        lonU: lon,
        windKt: num(f[A.windKt]),
        pressureMb: num(f[A.pressureMb]),
        gustKt: num(f[A.gustKt]),
        radii: { r34: null, r50: null, r64: null },
        rmwNm: num(f[A.rmwNm]),
      };
      byTime.set(time, pt);
    }

    /* THE MERGE. Field 12 says which threshold THIS line is about; the four
     * radii that follow belong to that threshold and to no other. */
    const threshold = num(f[A.radThresholdKt]);
    if (threshold && SEASONS.radiiThresholdsKt.includes(threshold)) {
      const group = radiiGroup(f, A.radNe);
      if (group) pt.radii[`r${threshold}`] = group;
    }
  }

  const points = [...byTime.values()];
  if (!points.length) return { storm: null, faults };

  unwrapLongitudes(points);

  const fromId = id ? parseStormId(id) : null;
  const finalId = fromId
    ? `${fromId.basin}${String(fromId.number).padStart(2, '0')}${fromId.year}`
    : (basin && number != null && year != null
      ? `${basin}${String(number).padStart(2, '0')}${year}`
      : null);

  return {
    storm: {
      id: finalId,
      basin: fromId ? fromId.basin : basin,
      number: fromId ? fromId.number : number,
      year: fromId ? fromId.year : year,
      name: lastName,
      source: 'atcf',
      /* ==> OPERATIONAL, NOT REVIEWED. <== §57.11: a b-deck is what forecasters
       * wrote at the time and NOAA revises it months later. The app must stamp
       * this on screen, and it can only do that if the flag rides along. */
      provisional: true,
      points,
    },
    faults,
  };
}

/* ---------------------------------------------------------------------------
 * SEASONS
 * ------------------------------------------------------------------------- */

/**
 * Group parsed storms into seasons, newest first inside each basin.
 *
 * The unit the whole feature is organised by, so it is built once here rather
 * than by each surface that wants it.
 */
export function groupBySeason(storms) {
  const out = new Map();
  for (const s of storms || []) {
    if (!s || !Number.isFinite(s.year)) continue;
    const key = `${s.basin}-${s.year}`;
    if (!out.has(key)) out.set(key, { basin: s.basin, year: s.year, storms: [] });
    out.get(key).storms.push(s);
  }
  for (const season of out.values()) season.storms.sort((a, b) => a.number - b.number);
  return out;
}

export const __internals = { hurdatLatLon, hurdatTime, num, radiiGroup, dLon, unwrapLongitudes, isPlaceholderName };
