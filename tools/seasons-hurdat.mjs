#!/usr/bin/env node
/**
 * seasons-hurdat.mjs — bring the SETTLED record into the repo.
 * SPEC-SEASONS-BUILD.md §57.3, §57.4, §57.30 step 3b, §57.34 rule 3,
 * §57.35 FIX 11. SPEC-OPS.md §18.8.
 *
 * WHAT IT DOES. Walks NOAA's HURDAT2 directory, picks the newest file for each
 * of the two basins, downloads it, PROVES it parses, and writes it into
 * `seasons/data/` with the season and the revision date in the filename. The
 * old file for that basin is deleted in the same commit — §57.34 rule 3, one
 * file per basin, replaced and never accumulated.
 *
 * It runs on a GitHub Actions runner. The cloud sandbox cannot reach NOAA.
 *
 * ==> PICKING THE FILE IS THE HARD PART AND SORTING THE DIRECTORY IS WRONG.
 * <== NOAA leaves every past revision in place — 41 files on the day this was
 * measured, going back to a 2018 vintage — and the newest is not the last one
 * alphabetically. The step 0 probe proved that the expensive way by reading a
 * file two seasons out of date. Measured off the real listing, which is kept at
 * `samples/seasons/listings/hurdat-directory-2026-08-24.html`:
 *
 *     hurdat2-1851-2025-02272026.txt          <- the Atlantic file we want
 *     hurdat2-atl-1851-2023-042624.txt        <- sorts AFTER it, two seasons stale
 *     hurdat2-atl-02052024.txt                <- no season range at all
 *     hurdat2-nepac-1949-2025-02272026.txt    <- the Pacific file we want
 *     hurdat2-format-atlantic.pdf             <- not data
 *
 * So the rule is: match the canonical shape only, rank by LAST SEASON, and
 * break ties on the revision date. **Anything that looks HURDAT-ish and does
 * not match is REPORTED rather than ignored**, because the failure mode of a
 * naming change is this job quietly doing nothing for a year.
 *
 * ==> AND THE REVISION DATE IS IN THE OUTPUT FILENAME, WHICH §57.35 FIX 11 DID
 * NOT ASK FOR. <== FIX 11 says the year in the filename is the cache bust, and
 * that is right up until NOAA revises a season it has already published —
 * which it does. The real listing carries FIVE revisions of the 2022 Atlantic
 * file: `04042023`, `04072023`, `040723`, `042723`, `050423`. With only the
 * season in the name, every one of those writes to the same URL, and that URL
 * is served `immutable` — so a browser that fetched the first revision keeps it
 * forever and never sees the correction. Putting the revision in the name means
 * any republish is a new URL. The spec has been corrected.
 *
 * ==> NOTHING IS COMMITTED THAT PARSES WORSE THAN WHAT IT REPLACES. <== Not in
 * the spec; added because the cost of getting this wrong is silent and total.
 * A truncated download, a redirect to an error page, or a format change would
 * otherwise replace 175 good seasons with rubbish, and the only symptom would
 * be an empty history nobody opens for months. The new file must parse with
 * ZERO faults and carry at least as many storms as the file it replaces.
 * `lib/hurdat.js` is the same parser the app ships, so a file that passes here
 * is a file the browser can read.
 *
 * Zero dependencies. Writes into the working tree; the workflow decides whether
 * to commit, and only commits when a byte actually moved.
 *
 *   node tools/seasons-hurdat.mjs <repo-root> <report-dir>
 *
 * Exits 0 when NOAA is simply down — a bad upstream is news, not a broken
 * build. It exits non-zero only when it could not write its own output, or when
 * a downloaded file FAILED the guard, because that is a thing a human must look
 * at rather than a thing to retry next month.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseHurdat2 } from '../lib/hurdat.js';
import { syncSlices } from './seasons-slice.mjs';
import { syncWall } from './seasons-wall.mjs';

/* ---------------------------------------------------------------------------
 * WHERE THE DATA COMES FROM
 *
 * Runner-only constants, kept here rather than in `config/constants.js` on
 * purpose: that file ships to every visitor on every load (§12 — no build step,
 * every import is downloaded), and a directory URL for a job that runs on a
 * server is not something a phone should pay to download. Same call
 * `tools/seasons-mirror.mjs` and `tools/archive-fetch.mjs` already make.
 * ------------------------------------------------------------------------- */

/** NOAA's HURDAT2 directory. Every revision ever published lives here. */
export const HURDAT_INDEX = 'https://www.nhc.noaa.gov/data/hurdat/';

/** Be identifiable in their logs. Same string the relay and the archive use. */
const UA = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** Generous. These are 4-7 MB files off a government server. */
const TIMEOUT_MS = 120_000;

/** Where the files land. **NOT under `data/`** — that path is already
 *  `no-cache` in `_headers` because it holds JS modules, and these want the
 *  exact opposite treatment (§57.30 step 3b, §57.35 FIX 11). */
export const OUT_DIR = 'seasons/data';

/** The index the app reads to find out which file to fetch. Its whole job is
 *  to be the ONE mutable thing pointing at immutable files, so the February
 *  swap needs no code change and no deploy of anything but data. */
export const INDEX_FILE = 'seasons/index.json';

/**
 * The two basins, their filename patterns, and the floor each must clear.
 *
 * ==> THE PATTERNS MATCH THE CANONICAL SHAPE AND NOTHING ELSE. <== The Atlantic
 * one deliberately does NOT match `hurdat2-atl-1851-2023-042624.txt`. That file
 * really is Atlantic data, and it is also a naming NOAA used once and stopped
 * using; accepting both means the ranking has to reason about which lineage is
 * authoritative. Matching one shape and REPORTING the rest is the version where
 * a change is visible instead of silently absorbed.
 *
 * ==> THE FLOORS ONLY EVER CATCH A CATASTROPHE. <== Measured 2026-08-24 on the
 * real files: Atlantic 2,004 storms over 1851-2025, E/C Pacific 1,262 over
 * 1949-2025. The floors sit at roughly three quarters of that, so an ordinary
 * year's growth can never trip them and a half-downloaded file always does.
 * They are the backstop for a FIRST run, when there is no previous file to
 * compare against; every run after that has the stronger test below.
 */
export const BASINS = Object.freeze([
  {
    key: 'atlantic',
    label: 'Atlantic',
    /* hurdat2-1851-2025-02272026.txt */
    pattern: /^hurdat2-(\d{4})-(\d{4})-([0-9a-z]+)\.txt$/i,
    stormFloor: 1500,
  },
  {
    key: 'epacific',
    label: 'East and Central Pacific',
    /* hurdat2-nepac-1949-2025-02272026.txt */
    pattern: /^hurdat2-nepac-(\d{4})-(\d{4})-([0-9a-z]+)\.txt$/i,
    stormFloor: 900,
  },
]);

/** A filename that mentions hurdat but matched no basin pattern and is not a
 *  format document. Reported, so a naming change is loud. */
const HURDAT_ISH = /^hurdat/i;
const FORMAT_DOC = /\.pdf$/i;

/* ---------------------------------------------------------------------------
 * PURE HELPERS — everything below is testable with no network.
 * `tools/test-seasons-hurdat.mjs` drives all of them against the real listing.
 * ------------------------------------------------------------------------- */

/** Every `href` in a directory listing, however it is quoted. */
export function hrefs(html) {
  return [...String(html || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
}

/**
 * A revision stamp → a sortable number, or null.
 *
 * ==> THE STAMP COMES IN TWO WIDTHS AND ONE OF THEM HAS A LETTER ON IT. <==
 * Measured on the real listing: `052425` is MMDDYY, `02272026` is MMDDYYYY, and
 * `043021a` is MMDDYY with a revision letter. Guessing one format would have
 * ranked `04042023` (April 2023) below `050423` (May 2023) correctly by luck
 * and `02272026` (February 2026) below both by mistake — the newest file in the
 * directory, ranked last.
 *
 * Returns `YYYYMMDD * 100 + letter`, so the letter breaks a same-day tie and
 * nothing else. A two-digit year is read as 2000+YY; this file will need
 * looking at again in 2100 and that is a fine trade for not inventing a rule
 * NOAA has not published.
 */
export function revisionRank(stamp) {
  const s = String(stamp || '').toLowerCase();
  const m = /^(\d{6}|\d{8})([a-z]?)$/.exec(s);
  if (!m) return null;
  const digits = m[1];
  const letter = m[2] ? m[2].charCodeAt(0) - 96 : 0;
  const mm = Number(digits.slice(0, 2));
  const dd = Number(digits.slice(2, 4));
  const yy = digits.slice(4);
  const year = yy.length === 4 ? Number(yy) : 2000 + Number(yy);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return (year * 10000 + mm * 100 + dd) * 100 + letter;
}

/**
 * A directory listing → the newest file for each basin, plus what it could not
 * place.
 *
 * ==> RANKED BY LAST SEASON FIRST, REVISION SECOND, AND NEVER BY SORTING THE
 * DIRECTORY. <== The step 0 probe read a file two seasons stale by sorting; the
 * listing puts `hurdat2-atl-…` after `hurdat2-1851-…` because `a` sorts after
 * `1`, and that one character is the whole bug.
 */
export function pickFiles(html) {
  const names = hrefs(html).map((h) => h.split('/').pop()).filter(Boolean);
  const chosen = {};
  const counts = {};
  const unplaced = [];

  for (const basin of BASINS) {
    const candidates = [];
    for (const name of names) {
      const m = basin.pattern.exec(name);
      if (!m) continue;
      const rank = revisionRank(m[3]);
      /* A revision stamp we cannot read is not a candidate. Ranking it as zero
       * would make it lose every tie, which sounds harmless and would silently
       * discard the newest file the day NOAA changes the stamp format. */
      if (rank == null) { unplaced.push({ name, why: 'revision stamp is not a date' }); continue; }
      candidates.push({
        name,
        firstSeason: Number(m[1]),
        lastSeason: Number(m[2]),
        revision: m[3].toLowerCase(),
        rank,
      });
    }
    counts[basin.key] = candidates.length;
    candidates.sort((a, b) => b.lastSeason - a.lastSeason || b.rank - a.rank);
    chosen[basin.key] = candidates[0] || null;
  }

  const placed = new Set(Object.values(chosen).filter(Boolean).map((c) => c.name));
  for (const name of names) {
    if (!HURDAT_ISH.test(name) || FORMAT_DOC.test(name)) continue;
    if (placed.has(name)) continue;
    if (unplaced.some((u) => u.name === name)) continue;
    if (BASINS.some((b) => b.pattern.test(name))) continue; /* matched, just not newest */
    unplaced.push({ name, why: 'no basin pattern matched this name' });
  }

  return { chosen, counts, unplaced, listed: names.length };
}

/** `seasons/data/hurdat2-atlantic-2025-02272026.txt` — the served filename.
 *  Season AND revision, so any republish is a new URL (see the header). */
export const outputName = (basinKey, lastSeason, revision) =>
  `hurdat2-${basinKey}-${lastSeason}-${revision}.txt`;

/**
 * Does this downloaded file deserve to replace the one already there?
 *
 * ==> ZERO FAULTS IS A HARD GATE, NOT A THRESHOLD. <== `parseHurdat2` reports
 * every unreadable row and every header whose declared row count does not match
 * what followed. A truncated download always trips the second one, which is why
 * this is the check rather than a byte-size comparison — the file grows every
 * year, so there is no size that means "complete".
 *
 * @returns {{ok: boolean, reason: string|null, storms: number, faults: number}}
 */
export function judge(text, { previousText = null, stormFloor = 0 } = {}) {
  const parsed = parseHurdat2(text);
  const storms = parsed.storms.length;
  const faults = parsed.faults.length;

  if (faults > 0) {
    const kinds = [...new Set(parsed.faults.map((f) => f.kind))].join(', ');
    return { ok: false, reason: `parsed with ${faults} fault(s): ${kinds}`, storms, faults };
  }

  if (previousText != null) {
    const before = parseHurdat2(previousText).storms.length;
    if (storms < before) {
      /* HURDAT2 only ever grows: a reanalysis can change a storm's numbers, it
       * does not delete a hurricane from history. Fewer storms than last time
       * means we are holding less of the record than we were, which is the one
       * outcome this job must never produce. */
      return {
        ok: false,
        reason: `${storms} storms against ${before} in the file it would replace`,
        storms,
        faults,
      };
    }
    return { ok: true, reason: null, storms, faults };
  }

  if (storms < stormFloor) {
    return { ok: false, reason: `${storms} storms, under the ${stormFloor} floor`, storms, faults };
  }
  return { ok: true, reason: null, storms, faults };
}

/**
 * The seasons index the app reads.
 *
 * ==> THE ONE MUTABLE FILE POINTING AT IMMUTABLE ONES. <== Without it the app
 * has to hardcode a filename, and next February's swap breaks history until
 * somebody edits code and deploys. With it, the swap is a data commit.
 */
export function buildIndex(entries, { generatedAt }) {
  return {
    generatedAt,
    source: HURDAT_INDEX,
    /* Where every file named in here lives. The app joins this to a name from
     * `basins[…].seasons` and composes nothing itself — a filename rule
     * written down in two places is a rule that will disagree with itself the
     * first time either end changes. */
    dir: `/${OUT_DIR}`,
    /* §57.11 — HURDAT2 is the REVIEWED database. The app must be able to say
     * which of the two records it is showing, and it cannot say it if the
     * shape does not carry it. `/api/seasons/live` says `provisional: true`. */
    provisional: false,
    basins: entries,
  };
}

/* ---------------------------------------------------------------------------
 * THE RUN
 * ------------------------------------------------------------------------- */

async function getText(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Files already in `seasons/data/` for a basin, so the old one can go. */
function existingFor(root, basinKey) {
  const dir = join(root, OUT_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.startsWith(`hurdat2-${basinKey}-`) && n.endsWith('.txt'));
}

async function run(root, reportDir) {
  mkdirSync(reportDir, { recursive: true });
  mkdirSync(join(root, OUT_DIR), { recursive: true });

  const report = {
    runAt: new Date().toISOString(),
    status: 'ok',
    listed: 0,
    unplaced: [],
    basins: {},
  };
  const lines = [];
  const entries = {};
  let changed = false;
  let hardFailure = false;

  let listing;
  try {
    listing = await getText(HURDAT_INDEX);
  } catch (e) {
    report.status = 'unavailable';
    report.reason = String(e && e.message ? e.message : e);
    lines.push(`NOAA's HURDAT2 directory could not be read: ${report.reason}`);
    writeReport(reportDir, report, lines, 'skip');
    return 0;
  }

  const { chosen, counts, unplaced, listed } = pickFiles(listing);
  report.listed = listed;
  report.unplaced = unplaced;

  /* ==> A NAMING CHANGE MUST BE LOUD. <== If NOAA renames these files, every
   * pattern above stops matching, this job finds nothing, and — without this
   * line — reports a cheerful "nothing changed" every month forever. */
  if (unplaced.length) {
    lines.push(`**${unplaced.length} hurdat file(s) matched no pattern.** If NOAA has renamed them, the patterns in \`tools/seasons-hurdat.mjs\` need updating:`);
    for (const u of unplaced) lines.push(`- \`${u.name}\` — ${u.why}`);
    lines.push('');
  }

  for (const basin of BASINS) {
    const pick = chosen[basin.key];
    const slot = { candidates: counts[basin.key] };
    report.basins[basin.key] = slot;

    if (!pick) {
      slot.status = 'not_found';
      hardFailure = true;
      lines.push(`**${basin.label}: no file matched.** ${counts[basin.key]} candidates.`);
      continue;
    }

    slot.chose = pick.name;
    slot.lastSeason = pick.lastSeason;

    const outName = outputName(basin.key, pick.lastSeason, pick.revision);
    const outPath = join(root, OUT_DIR, outName);
    const held = existingFor(root, basin.key);

    if (held.length === 1 && held[0] === outName && existsSync(outPath)) {
      /* Already have exactly this revision. Do not spend 7 MB of somebody
       * else's bandwidth confirming it. */
      slot.status = 'unchanged';
      const text = readFileSync(outPath, 'utf8');
      entries[basin.key] = describe(basin, pick, outName, text);
      lines.push(`${basin.label}: unchanged — \`${outName}\``);
      continue;
    }

    let text;
    try {
      text = await getText(`${HURDAT_INDEX}${pick.name}`);
    } catch (e) {
      slot.status = 'fetch_failed';
      slot.reason = String(e && e.message ? e.message : e);
      lines.push(`**${basin.label}: download failed** — ${slot.reason}. Keeping what is already there.`);
      for (const name of held) entries[basin.key] = describeHeld(basin, root, name);
      continue;
    }

    const previousText = held.length ? readFileSync(join(root, OUT_DIR, held[0]), 'utf8') : null;
    const verdict = judge(text, { previousText, stormFloor: basin.stormFloor });
    slot.storms = verdict.storms;
    slot.faults = verdict.faults;

    if (!verdict.ok) {
      /* ==> REFUSED, AND THAT IS A NON-ZERO EXIT. <== Nothing is written and
       * the file already in the repo stays exactly as it is. This is the one
       * outcome a human has to look at: either NOAA published something broken
       * or our parser stopped understanding their format, and both of those
       * are worse than a month with no update. */
      slot.status = 'refused';
      slot.reason = verdict.reason;
      hardFailure = true;
      lines.push(`**${basin.label}: REFUSED \`${pick.name}\`** — ${verdict.reason}. The file already in the repo is untouched.`);
      if (held.length) entries[basin.key] = describeHeld(basin, root, held[0]);
      continue;
    }

    /* §57.34 rule 3 — one file per basin, replaced, never accumulated. The
     * delete and the write are in the same run and therefore the same commit;
     * deleted is deleted (§12). */
    for (const name of held) {
      if (name === outName) continue;
      rmSync(join(root, OUT_DIR, name));
      lines.push(`${basin.label}: removed \`${name}\``);
    }
    writeFileSync(outPath, text);
    changed = true;
    slot.status = 'stored';
    slot.bytes = Buffer.byteLength(text);
    entries[basin.key] = describe(basin, pick, outName, text);
    lines.push(`**${basin.label}: stored \`${outName}\`** — ${verdict.storms} storms, ${(slot.bytes / 1e6).toFixed(2)} MB, zero faults.`);
  }

  /* ==> CUT EVERY BASIN INTO SEASONS, WHATEVER HAPPENED ABOVE. <== §57.35 FIX
   * 12. This runs against whatever file is CURRENT — freshly stored, unchanged
   * for a year, or the older one we kept when a download failed — because the
   * slices have to describe the file that is actually there. Reconciling
   * rather than reacting also means the first run after this feature was added
   * fills in a directory whose basin file has not moved in months.
   *
   * A basin that cannot be cut is a hard failure and writes nothing, exactly
   * like a refused download: half a history is worse than last month's. */
  for (const basin of BASINS) {
    const entry = entries[basin.key];
    if (!entry || !entry.revision) continue;
    const name = String(entry.file).split('/').pop();
    const path = join(root, OUT_DIR, name);
    if (!existsSync(path)) continue;

    const sync = syncSlices(join(root, OUT_DIR), basin.key, entry.revision, readFileSync(path, 'utf8'));
    const slot = report.basins[basin.key] || (report.basins[basin.key] = {});

    if (!sync.ok) {
      slot.slices = 'refused';
      slot.sliceReason = sync.reason;
      hardFailure = true;
      lines.push(`**${basin.label}: the per-season cut was REFUSED** — ${sync.reason}. No season file was written or removed.`);
      continue;
    }

    entry.seasons = sync.seasons;
    slot.slices = Object.keys(sync.seasons).length;
    if (sync.written || sync.removed) {
      changed = true;
      lines.push(`${basin.label}: ${slot.slices} season files — ${sync.written} written, ${sync.removed} removed.`);
    } else {
      lines.push(`${basin.label}: ${slot.slices} season files, unchanged.`);
    }
  }

  /* The index is rewritten every run from what is actually on disk, so it can
   * never describe a file that is not there. */
  const indexPath = join(root, INDEX_FILE);
  const nextIndex = buildIndex(entries, { generatedAt: report.runAt });
  const nextText = `${JSON.stringify(nextIndex, null, 2)}\n`;
  const prevText = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null;
  /* Compared WITHOUT its timestamp, or every run would commit an empty change
   * — the fault `seasons-mirror` shipped and a runner caught (§18.7 rule 4). */
  if (stripStamp(prevText) !== stripStamp(nextText)) {
    writeFileSync(indexPath, nextText);
    changed = true;
    lines.push(`Rewrote \`${INDEX_FILE}\`.`);
  }

  /* ==> THE WALL IS REBUILT FROM WHATEVER IS ACTUALLY ON DISK, AFTER THE
   * INDEX. <== §57.36. It reduces every storm in both basins to four numbers,
   * and it reads the index to learn which revision of each basin file is
   * really there — so it has to run once the index describes this run rather
   * than the last one. Skipped when nothing changed, because rebuilding it
   * would only rewrite identical bytes.
   *
   * A failure here is reported and does NOT fail the run: the wall going stale
   * for a month is a screen showing last February's history, which is bad; the
   * whole job refusing is a screen showing nothing, which is worse. */
  if (changed) {
    try {
      const w = syncWall(root, nextIndex, { generatedAt: report.runAt });
      if (w.written) lines.push(`Rebuilt \`seasons/wall.json\` (${w.bytes.toLocaleString()} B).`);
      else lines.push('`seasons/wall.json` unchanged.');
    } catch (e) {
      lines.push(`**The wall of years could not be rebuilt** — ${e?.message || e}. `
        + 'The archive still works; the Wall of Years is showing the previous run.');
    }
  }

  writeReport(reportDir, report, lines, changed ? 'commit' : 'skip');
  return hardFailure ? 1 : 0;
}

const stripStamp = (text) => {
  if (text == null) return null;
  try {
    const o = JSON.parse(text);
    delete o.generatedAt;
    return JSON.stringify(o);
  } catch { return text; }
};

function describe(basin, pick, outName, text) {
  const parsed = parseHurdat2(text);
  return {
    label: basin.label,
    file: `/${OUT_DIR}/${outName}`,
    upstream: pick.name,
    firstSeason: pick.firstSeason,
    lastSeason: pick.lastSeason,
    revision: pick.revision,
    bytes: Buffer.byteLength(text),
    storms: parsed.storms.length,
  };
}

function describeHeld(basin, root, name) {
  const text = readFileSync(join(root, OUT_DIR, name), 'utf8');
  const m = /^hurdat2-[a-z]+-(\d{4})-([0-9a-z]+)\.txt$/i.exec(name);
  const parsed = parseHurdat2(text);
  return {
    label: basin.label,
    file: `/${OUT_DIR}/${name}`,
    upstream: null,
    firstSeason: parsed.storms.length ? parsed.storms[0].year : null,
    lastSeason: m ? Number(m[1]) : null,
    revision: m ? m[2] : null,
    bytes: Buffer.byteLength(text),
    storms: parsed.storms.length,
  };
}

function writeReport(dir, report, lines, decision) {
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(dir, 'decision.txt'), `${decision}\n`);
  const subject = subjectFor(report, decision);
  writeFileSync(join(dir, 'commit-message.txt'), `${subject}\n`);
  writeFileSync(
    join(dir, 'summary.md'),
    `## seasons-hurdat — ${report.status}\n\n${lines.join('\n')}\n`
  );
  console.log(`decision: ${decision}`);
  for (const l of lines) console.log(l.replace(/\*\*/g, ''));
}

/** The commit subject names what moved. `git log` is the only interface this
 *  will ever have, so a subject that says "update" is a subject that costs
 *  somebody a diff. */
function subjectFor(report, decision) {
  if (decision !== 'commit') return 'seasons-hurdat: nothing moved';
  const moved = Object.entries(report.basins)
    .filter(([, b]) => b.status === 'stored')
    .map(([k, b]) => `${k} ${b.lastSeason}`);
  if (!moved.length) return 'seasons-hurdat: index rewritten';
  return `seasons-hurdat: ${moved.join(', ')} (§57.34 rule 3 — replaced, not accumulated)`;
}

/* Only run when invoked directly, so the helpers above can be imported by the
 * test suite without firing a download. */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const root = process.argv[2] || '.';
  const reportDir = process.argv[3] || '/tmp/seasons-hurdat';
  run(root, reportDir).then((code) => process.exit(code)).catch((e) => {
    console.error(`seasons-hurdat could not write its own output: ${e && e.stack ? e.stack : e}`);
    process.exit(2);
  });
}
