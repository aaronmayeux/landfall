/**
 * seasons-names.mjs — keep the name rosters current without anybody typing one.
 *
 * ==> WHAT CHANGED, AND WHY THE OLD REASONING NO LONGER HOLDS. <==
 * `lib/season-names.js` used to carry two hand-typed lists covering one year,
 * on the argument that NHC publishes names as a PDF and a web page and a
 * scraper aimed at either would silently empty the roster the day NOAA
 * restyles it. Two facts, both measured from the real page on 2026-08-24,
 * turn that argument around:
 *
 *   1. The page carries SIX YEARS AHEAD, with the year written in each column
 *      header — 2026 through 2031 for both basins. There is no rotation to
 *      compute, no anchor year to get wrong, and no retirement table to
 *      maintain. NOAA does that work and we read the answer.
 *   2. Because of (1), one good read covers six seasons. If this job breaks
 *      tomorrow and stays broken, the app is still right until 2032.
 *
 * ==> AND NOTHING IS SCRAPED AT RUNTIME. <== The output is a generated JS
 * module committed to the repo. A phone never touches NHC. A restyle makes
 * THIS JOB go red; it cannot empty a roster on a screen, because the last good
 * file stays exactly where it is. That is the opposite failure shape from the
 * one the original note feared, and it is why the decision was reversed.
 *
 * ==> IT REFUSES RATHER THAN GUESSES. <== Any fault at all — a column headed
 * something that is not a year, a list of the wrong length, initials out of
 * order, a name that is not a name, a year that jumps — and this exits non-zero
 * having written nothing. A month with no update beats a month with the wrong
 * names, and a red job is visible where a silently wrong roster is not.
 *
 * ==> THE GATE THAT ACTUALLY CATCHES A MISREAD. <== Everything above proves the
 * lists are WELL FORMED; a well-formed list of the wrong names passes all of
 * it. So the current year's lists are checked position by position against
 * NOAA's own b-decks in `samples/seasons-live/` — the names this season really
 * spent, in the order it spent them. A shifted column or a swapped pair dies
 * here. Nothing can check the UNUSED tail; that is what makes it a ghost.
 *
 * ==> IT NEVER LOSES A YEAR. <== The new page is merged OVER what the repo
 * already holds, never substituted for it. NOAA's window rolls forward each
 * year, so a straight replacement would quietly drop the season that just
 * ended. Merging also means a retirement decided in spring overwrites the old
 * name in every year it touches.
 *
 * Zero dependencies. Run: node tools/seasons-names.mjs <repo-root> <report-dir>
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseNamesPage } from './seasons-names-parse.mjs';

const SOURCE = 'https://www.nhc.noaa.gov/aboutnames.shtml';
const USER_AGENT =
  'Landfall/1.0 (+https://landfall.getgravitate.app, andy@getgravitate.app)';
const TIMEOUT_MS = 45_000;

const OUT_FILE = join('lib', 'season-names-data.js');

/**
 * ==> THE CENTRAL PACIFIC LISTS GO IN `tools/`, NOT `lib/`, AND THAT IS §12.
 * <== Every import in `lib/` ships to every visitor. Nothing the app draws
 * reads these 48 names — they exist so `tools/seasons-retired.mjs` can tell a
 * name still in service from a name withdrawn (§57.51). Putting them beside
 * the rosters would post 48 names to every phone to answer a question only a
 * runner ever asks.
 */
const CP_FILE = join('tools', 'cpacific-lists.mjs');

const ROOT = resolve(process.argv[2] || '.');
const REPORT = resolve(process.argv[3] || '/tmp/names-report');

const faults = [];
const notes = [];

/* ---------------------------------------------------------------------------
 * 1. Fetch.
 * ------------------------------------------------------------------------ */

/**
 * ==> A PAGE THIS SMALL IS NOT THE PAGE. <== Measured: the real one is about
 * 31 KB. An error page, a redirect landing page or a truncated read can all
 * answer 200 with a few hundred characters, and the parser would then report a
 * pile of "no section" faults that read like NOAA restructured the site. One
 * clear sentence is better than six misleading ones.
 */
function tooSmall(body) {
  if (body && body.length >= 8000) return body;
  faults.push(`the page came back only ${body ? body.length : 0} characters — too small to be it`);
  return null;
}

async function fetchPage() {
  /* ==> A LOCAL FILE CAN STAND IN FOR THE FETCH, AND THAT IS NOT A TEST HOOK.
   * <== A session cannot reach nhc.noaa.gov (SPEC-OPS.md §18), so without this
   * the only way to exercise the write-and-merge half is to push and watch a
   * runner. Pointing it at `samples/nhc-names/` runs the whole job end to end
   * inside the wall, against bytes the runner itself captured. The scheduled
   * job never sets it. */
  const local = process.env.SEASONS_NAMES_HTML;
  if (local) {
    notes.push(`read ${local} instead of fetching (SEASONS_NAMES_HTML is set)`);
    return tooSmall(await readFile(resolve(local), 'utf8'));
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SOURCE, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      signal: ctl.signal,
    });
    if (!res.ok) { faults.push(`${SOURCE} answered HTTP ${res.status}`); return null; }
    const body = await res.text();
    notes.push(`fetched ${body.length} characters, HTTP ${res.status}`);
    return tooSmall(body);
  } catch (err) {
    faults.push(`could not reach ${SOURCE}: ${String(err && err.message || err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------------------
 * 2. The real-bytes gate. §57.18a.
 * ------------------------------------------------------------------------ */

/**
 * Every name this season has actually spent, per basin, in order, read out of
 * the mirrored ATCF b-decks with the parser the app itself ships.
 */
async function usedNamesFromMirror() {
  const dir = join(ROOT, 'samples', 'seasons-live');
  if (!existsSync(dir)) {
    faults.push('samples/seasons-live/ is missing — the rosters cannot be checked against real bytes');
    return null;
  }
  /* ==> THE APP'S OWN PARSER, LOADED BY PATH, AND A FAILURE HERE IS A FAULT
   * RATHER THAN A CRASH. <== An unhandled throw would kill this script before
   * it wrote a report, so the runner would show a stack trace and no summary —
   * loud, but unreadable, and indistinguishable from the network being down. */
  let parseBdeck;
  try {
    ({ parseBdeck } = await import(pathToFileURL(join(ROOT, 'lib', 'hurdat.js')).href));
  } catch (err) {
    faults.push(`lib/hurdat.js could not be loaded: ${String(err && err.message || err)}`);
    return null;
  }
  const { readdirSync } = await import('node:fs');

  const byBasin = { atlantic: [], epacific: [] };
  const PREFIX = { bal: 'atlantic', bep: 'epacific' };

  const files = readdirSync(dir).filter((f) => f.endsWith('.dat')).sort();
  for (const f of files) {
    const basin = PREFIX[f.slice(0, 3)];
    if (!basin) continue;
    const id = f.replace(/^b|\.dat$/g, '').toUpperCase();
    const text = await readFile(join(dir, f), 'utf8');
    const { storm } = parseBdeck(text, { id });
    const n = storm?.name ? String(storm.name).toUpperCase() : null;
    /* Storm number out of the filename, so a gap in the mirror leaves a gap
     * rather than shifting everything after it up by one. */
    const num = Number(f.slice(3, 5));
    if (n && Number.isFinite(num)) byBasin[basin][num - 1] = n;
  }
  return byBasin;
}

function checkAgainstMirror(rosters, used, year) {
  for (const [basin, names] of Object.entries(used)) {
    const roster = rosters[basin]?.[year];
    if (!roster) { faults.push(`${basin}: the page carries no ${year} column to check`); continue; }
    let checked = 0;
    names.forEach((name, i) => {
      if (!name) return; /* a storm we have not mirrored — not a fault */
      checked++;
      if (roster[i] !== name) {
        faults.push(
          `${basin} ${year}: storm ${i + 1} was named ${name}, ` +
          `but the page puts ${roster[i] || '(nothing)'} at position ${i + 1}`
        );
      }
    });
    if (!checked) faults.push(`${basin}: no mirrored storm names to check ${year} against`);
    else notes.push(`${basin} ${year}: ${checked} spent names match the page position for position`);
  }
}

/* ---------------------------------------------------------------------------
 * 3. Merge over what the repo already holds.
 * ------------------------------------------------------------------------ */

async function existingRosters() {
  const path = join(ROOT, OUT_FILE);
  if (!existsSync(path)) { notes.push('no existing data file — this run creates it'); return {}; }
  try {
    const mod = await import(pathToFileURL(path).href + `?t=${Date.now()}`);
    return mod.NAME_ROSTERS || {};
  } catch (err) {
    faults.push(`the existing ${OUT_FILE} could not be read: ${String(err && err.message || err)}`);
    return null;
  }
}

function merge(existing, fresh) {
  const out = {};
  for (const basin of new Set([...Object.keys(existing), ...Object.keys(fresh)])) {
    const years = { ...(existing[basin] || {}) };
    for (const [y, names] of Object.entries(fresh[basin] || {})) years[y] = names;
    out[basin] = years;
  }
  /* The one thing a merge must never do. Belt and braces: if a year the repo
   * held is not in the result, something above is wrong. */
  for (const [basin, years] of Object.entries(existing)) {
    for (const y of Object.keys(years)) {
      if (!out[basin]?.[y]) faults.push(`${basin} ${y} would be lost — refusing`);
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * 4. Render the module.
 * ------------------------------------------------------------------------ */

function render(rosters) {
  const basins = Object.keys(rosters).sort();
  const body = basins.map((basin) => {
    const years = Object.keys(rosters[basin]).map(Number).sort((a, b) => a - b);
    const blocks = years.map((y) => {
      const names = rosters[basin][y];
      /* Wrapped at a readable width so a diff shows which name changed rather
       * than one 400-character line going red. */
      const lines = [];
      let line = '';
      for (const n of names) {
        const piece = `'${n}', `;
        if (line.length + piece.length > 68) { lines.push(line.trimEnd()); line = ''; }
        line += piece;
      }
      if (line.trim()) lines.push(line.trimEnd().replace(/,$/, ''));
      return `    ${y}: [\n${lines.map((l) => `      ${l}`).join('\n')}\n    ],`;
    });
    return `  ${basin}: {\n${blocks.join('\n')}\n  },`;
  });

  return `/**
 * season-names-data.js — GENERATED. DO NOT EDIT BY HAND.
 *
 * Written by \`tools/seasons-names.mjs\` from NHC's own names page:
 *   ${SOURCE}
 *
 * That page publishes six years ahead with the year in each column header, so
 * one read covers six seasons and a retirement decided by the WMO in spring
 * arrives here on its own. The job refuses to write anything it cannot verify,
 * so if NOAA restyles the page this file simply stops changing — it never
 * empties and it never guesses.
 *
 * ==> THE LOGIC IS NEXT DOOR IN \`lib/season-names.js\`, AND IT GATES THIS TO
 * THE CURRENT SEASON. <== This file accumulates years and will hold past ones
 * forever; ghosts are the season in progress only (Aaron's call, 2026-08-24).
 * Do not read this table directly from a view.
 *
 * Central Pacific is absent on purpose (§57.12) — its four lists run one after
 * another across season boundaries, so "the names for 2026" has no answer.
 *
 * Generated ${new Date().toISOString()}.
 */

export const NAME_ROSTERS = Object.freeze({
${body.join('\n')}
});
`;
}

function renderCpacific(lists) {
  const blocks = lists.map((names, i) => {
    const rows = [];
    let line = '';
    for (const n of names) {
      const piece = `'${n}', `;
      if (line.length + piece.length > 68) { rows.push(line.trimEnd()); line = ''; }
      line += piece;
    }
    if (line.trim()) rows.push(line.trimEnd().replace(/,$/, ''));
    return `  /* List ${i + 1} */\n  [\n${rows.map((l) => `    ${l}`).join('\n')}\n  ],`;
  });

  return `/**
 * cpacific-lists.mjs — GENERATED. DO NOT EDIT BY HAND.
 *
 * The four Central Pacific name lists currently in service, written by
 * \`tools/seasons-names.mjs\` from NHC's own names page:
 *   ${SOURCE}
 *
 * ==> THIS IS NOT A ROSTER AND MUST NEVER BECOME ONE. <== §57.12. CPHC runs
 * these four lists one after another across season boundaries — when the
 * bottom of one is reached the next name is the top of the next — so "the
 * names for 2026" is a question with no answer in this basin. What IS well
 * defined, and all this file claims, is the flat set of names in service.
 *
 * ==> IT LIVES IN tools/ BECAUSE NOTHING THE APP DRAWS READS IT. <== §12: an
 * import in \`lib/\` is bytes on every phone. \`tools/seasons-retired.mjs\` is the
 * only reader — a name still in service somewhere cannot be a retired name,
 * and without this set every Central Pacific name that ever crossed into the
 * east Pacific best-track record falls out of that subtraction looking
 * retired. Measured: Ela, Ulika, Lana and Akoni all do.
 *
 * ==> REPLACED WHOLE ON EVERY RUN, NEVER MERGED. <== A withdrawn name has to
 * be able to LEAVE this file, or the job that reads it can never see a
 * Central Pacific retirement happen.
 *
 * Generated ${new Date().toISOString()}.
 */

export const CPACIFIC_LISTS = Object.freeze([
${blocks.join('\n')}
].map(Object.freeze));

/** Every Central Pacific name in service, flattened. */
export const CPACIFIC_IN_SERVICE = Object.freeze(CPACIFIC_LISTS.flat());
`;
}

/* ---------------------------------------------------------------------------
 * 5. Run.
 * ------------------------------------------------------------------------ */

await mkdir(REPORT, { recursive: true });

const summary = ['# seasons-names', ''];
let decision = 'skip';

const html = await fetchPage();
let written = null;

if (html) {
  const { rosters, cpacific, faults: parseFaults } = parseNamesPage(html);
  faults.push(...parseFaults);

  const counted = Object.entries(rosters)
    .map(([b, y]) => `${b}: ${Object.keys(y).length} years`).join(', ');
  notes.push(`parsed ${counted || 'nothing'}`);
  notes.push(`cpacific: ${cpacific.length} lists, ${cpacific.flat().length} names in service`);

  const used = await usedNamesFromMirror();
  /* The current season, taken from the earliest year the page publishes — it
   * always leads with the year now in progress. Not from the clock, so this
   * job cannot disagree with the page it is reading. */
  const leadYear = Math.min(
    ...Object.values(rosters).flatMap((y) => Object.keys(y).map(Number))
  );
  if (used && Number.isFinite(leadYear)) checkAgainstMirror(rosters, used, leadYear);

  const existing = await existingRosters();
  if (existing && !faults.length) {
    const merged = merge(existing, rosters);
    if (!faults.length) {
      const text = render(merged);
      const path = join(ROOT, OUT_FILE);
      const before = existsSync(path) ? await readFile(path, 'utf8') : '';
      /* The generated header carries a timestamp, so comparing whole files
       * would commit every month on no news. Compare the DATA. */
      const strip = (s) => s.slice(s.indexOf('export const NAME_ROSTERS'));
      if (before && strip(before) === strip(text)) {
        notes.push('the page says exactly what the repo already holds — nothing to commit');
      } else {
        await writeFile(path, text, 'utf8');
        written = merged;
        decision = 'commit';
      }

      /* ==> THE CENTRAL PACIFIC FILE IS REPLACED, NEVER MERGED, AND THAT IS
       * THE OPPOSITE RULE FROM THE ROSTERS ABOVE. <== A roster is keyed on a
       * year, so an old year is still true and losing it loses history. These
       * four lists have no year on them: they are the names in service NOW,
       * and merging would keep a withdrawn name in service forever — which is
       * exactly the silent mask §57.51 exists to avoid. The shape gates in the
       * parser are what stand in for the merge's protection. */
      const cpPath = join(ROOT, CP_FILE);
      const cpText = renderCpacific(cpacific);
      /* ==> MAKE THE DIRECTORY FIRST. <== `writeFile` into a directory that
       * does not exist throws, and an unhandled throw here kills the script
       * BEFORE it writes its summary — so the runner shows a stack trace, no
       * report, and a failure indistinguishable from the network being down.
       * That is the same trap `usedNamesFromMirror` already guards against,
       * and this hit it the first time the job wrote a second file. */
      await mkdir(dirname(cpPath), { recursive: true });
      const cpBefore = existsSync(cpPath) ? await readFile(cpPath, 'utf8') : '';
      const cpStrip = (s) => s.slice(s.indexOf('export const CPACIFIC_LISTS'));
      if (cpBefore && cpStrip(cpBefore) === cpStrip(cpText)) {
        notes.push('the Central Pacific lists are unchanged');
      } else {
        await writeFile(cpPath, cpText, 'utf8');
        notes.push(`wrote ${CP_FILE}`);
        decision = 'commit';
      }
    }
  }
}

/* ---------------------------------------------------------------------------
 * 6. Report.
 * ------------------------------------------------------------------------ */

summary.push(`source: ${SOURCE}`, '');
for (const n of notes) summary.push(`- ${n}`);
if (faults.length) {
  summary.push('', '## REFUSED — nothing was written', '');
  for (const f of faults) summary.push(`- ${f}`);
} else if (written) {
  summary.push('', '## wrote ' + OUT_FILE, '');
  for (const [basin, years] of Object.entries(written)) {
    summary.push(`- ${basin}: ${Object.keys(years).sort().join(', ')}`);
  }
}

await writeFile(join(REPORT, 'summary.md'), summary.join('\n') + '\n', 'utf8');
await writeFile(join(REPORT, 'decision.txt'), decision + '\n', 'utf8');

if (decision === 'commit') {
  /* ==> EITHER FILE CAN MOVE ON ITS OWN. <== The rosters and the Central
   * Pacific lists come off one page but change on different occasions, so the
   * subject line has to be built from what actually moved rather than
   * assuming the rosters did. Reading `written` unconditionally threw here
   * the first time the Central Pacific file was created against unchanged
   * rosters. */
  const years = written
    ? Object.values(written).flatMap((y) => Object.keys(y).map(Number))
    : [];
  const subject = years.length
    ? `Name rosters refreshed from NHC (${Math.min(...years)}\u2013${Math.max(...years)})`
    : 'Central Pacific name lists refreshed from NHC';
  await writeFile(join(REPORT, 'commit-message.txt'),
    `${subject}\n\n` +
    `Generated by tools/seasons-names.mjs from ${SOURCE}.\n` +
    `Verified position for position against samples/seasons-live/.\n`, 'utf8');
}

console.log(summary.join('\n'));

if (faults.length) {
  console.error('\nREFUSED. Nothing was written.');
  process.exit(1);
}
