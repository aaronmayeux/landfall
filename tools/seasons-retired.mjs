#!/usr/bin/env node
/**
 * seasons-retired.mjs — work out which storm names have been retired, from
 * data we already hold, so that nobody ever has to maintain a list.
 *
 * ==> THE METHOD: SUBTRACT THE NAMES STILL IN SERVICE FROM THE NAMES EVER
 * USED. <== §57.51. Retirement IS removal from the active lists, so:
 *
 *     retired = every name the best-track record shows was used
 *               minus every name still on an active list
 *               minus the exclusions below
 *
 * Both halves are already in this repo and both already refresh themselves.
 * The record is `seasons/data/hurdat2-*.txt`, rewritten by `seasons-hurdat`
 * every month. The lists in service are `lib/season-names-data.js` and
 * `tools/cpacific-lists.mjs`, rewritten by `seasons-names` every month off
 * NHC's own page. This job fetches nothing.
 *
 * ==> WHY THIS IS SAFE WHERE §57.17 REFUSED A SCRAPER, AND IT IS THE WHOLE
 * ARGUMENT. <== §57.17 rejected scraping NHC's retired-names page because a
 * restyle would SILENTLY EMPTY the feature — the shelf would still render and
 * simply be missing entries, which is the §5 failure exactly. Reading the
 * ACTIVE list inverts the failure: parse zero active names and every name ever
 * used looks retired, which is a flood rather than a silence. A loud wrong
 * answer is survivable and a gate can catch it. A silent one cannot.
 *
 * And the gates below never SHIP a flood either — any fault at all keeps the
 * committed answer and exits non-zero, so the last good file stays where it is
 * and the job goes red.
 *
 * ==> WHAT IT CANNOT DERIVE LIVES IN `data/retired-names-historic.js`. <==
 * That file is hand-written and frozen and this job never writes it. Read its
 * header for why each floor is where it is; the short version is that below
 * the floor a name being off the list means "dropped" or "misspelt" as often
 * as it means "retired", and nothing in the data can tell those apart.
 *
 * Zero dependencies. Run: node tools/seasons-retired.mjs <repo-root> <report-dir>
 * Add --check to compare against the committed file without writing.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  HISTORIC_ATLANTIC, HISTORIC_EPACIFIC, HISTORIC_CPACIFIC,
  RETIRED_BY_DESCRIPTION, GREEK_NEVER_RETIRED, RETIRED_NEVER_USED,
} from '../data/retired-names-historic.js';
import {
  BASINS, FLOOR, ACTIVE_LIST_COUNT, SUPPLEMENTAL_ERA,
  readBasin, inServiceFrom, derive, crossCheck, judge,
} from './seasons-retired-derive.mjs';

/* ---------------------------------------------------------------------------
 * ==> EVERY RULE AND EVERY NUMBER LIVES IN `seasons-retired-derive.mjs`. <==
 * This file reads the files, applies them and writes the report. Keeping a
 * second copy of a floor or a cap here is how the two drift apart and how the
 * suite ends up proving something the runner does not do.
 * ------------------------------------------------------------------------ */

const OUT_FILE = join('data', 'retired-names.js');

/**
 * The floor under the number of names in service. MEASURED 2026-08-30: 305
 * across the three basins. A floor rather than an equality, because NOAA can
 * legitimately lengthen a list — but a HALF-parsed set of lists turns every
 * name it lost into a false retirement, and that flood has to be caught on
 * the way in. The monotonic gate downstream only sees names LEAVING.
 */
const MIN_IN_SERVICE = 250;

const ROOT = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const REPORT = resolve(process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '/tmp/retired-report');
const CHECK_ONLY = process.argv.includes('--check');

const faults = [];
const notes = [];

/* ---------------------------------------------------------------------------
 * 1. The record — every name ever used, and when.
 * ------------------------------------------------------------------------ */

/**
 * ==> READ THE WHOLE-BASIN FILES, NEVER A GLOB OVER `seasons/data/*.txt`. <==
 * §57.42. That directory holds the per-season slices AND the two whole-basin
 * files, so a glob visits every storm twice — 6,532 entries against 3,266 real
 * ones, an exact 2x that has already stopped one pass dead.
 */
function bestTrackFile(dir, prefix) {
  const found = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.txt')).sort();
  if (!found.length) { faults.push(`no ${prefix}*.txt in seasons/data/`); return null; }
  /* NOAA revises seasons it has already published and the revision stamp is in
   * the filename (§57.35 FIX 11), so the newest name is the current one. */
  return join(dir, found[found.length - 1]);
}

/**
 * Every named storm in one basin: `Map<name, { years:[], seasons:Map }>`.
 * Header rows only — four comma-separated fields, `AL011851, NAME, 14,`.
 */
async function readRecord() {
  const dir = join(ROOT, 'seasons', 'data');
  if (!existsSync(dir)) { faults.push('seasons/data/ is missing'); return null; }

  const record = {};
  const cache = new Map();

  for (const { key, file, prefixes } of BASINS) {
    const path = bestTrackFile(dir, file);
    if (!path) return null;
    if (!cache.has(path)) cache.set(path, await readFile(path, 'utf8'));

    const basin = readBasin(cache.get(path), prefixes);
    if (!basin.headers) { faults.push(`${key}: no storm headers found in ${path}`); return null; }
    notes.push(`${key}: ${basin.headers} storms in the record, ${basin.used.size} distinct names`);
    record[key] = basin;
  }
  return record;
}

/* ---------------------------------------------------------------------------
 * 2. The names still in service.
 * ------------------------------------------------------------------------ */

async function readInService() {
  let rosters = null;
  let cpacific = null;
  try {
    const mod = await import(pathToFileURL(join(ROOT, 'lib', 'season-names-data.js')).href + `?t=${Date.now()}`);
    rosters = mod.NAME_ROSTERS || {};
  } catch (err) {
    faults.push(`lib/season-names-data.js could not be read: ${String(err && err.message || err)}`);
    return null;
  }
  try {
    const cp = await import(pathToFileURL(join(ROOT, 'tools', 'cpacific-lists.mjs')).href + `?t=${Date.now()}`);
    cpacific = cp.CPACIFIC_IN_SERVICE || [];
  } catch (err) {
    faults.push(`tools/cpacific-lists.mjs could not be read: ${String(err && err.message || err)}`);
    return null;
  }

  const { inService, listLengths, faults: f } = inServiceFrom(rosters, cpacific);
  faults.push(...f);

  /* ==> GATE, SHAPE. A PARSE THAT HALF WORKED IS THE DANGEROUS CASE. <== A
   * short active list turns every name it lost into a false retirement, and
   * the monotonic gate downstream only catches names LEAVING the answer. This
   * catches the flood arriving. MEASURED 2026-08-30: 305 names in service
   * across the three basins. Asserted as a floor rather than an equality
   * because NOAA can legitimately lengthen a list. */
  if (inService.size < MIN_IN_SERVICE) {
    faults.push(`only ${inService.size} names are in service — the lists did not parse`);
  }
  const spread = Object.entries(listLengths)
    .map(([b, n]) => `${b} list ${Number.isFinite(n) ? n : 'continuous'}`).join(', ');
  notes.push(`in service: ${inService.size} names (${spread})`);
  return { inService, listLengths };
}

/* ---------------------------------------------------------------------------
 * 3. The subtraction.
 * ------------------------------------------------------------------------ */

/* ---------------------------------------------------------------------------
 * 4. The gates. Any failure keeps the committed answer.
 * ------------------------------------------------------------------------ */

async function committed() {
  const path = join(ROOT, OUT_FILE);
  if (!existsSync(path)) { notes.push('no committed answer — this run creates it'); return null; }
  try {
    const mod = await import(pathToFileURL(path).href + `?t=${Date.now()}`);
    return {
      atlantic: mod.RETIRED_ATLANTIC || [],
      epacific: mod.RETIRED_EPACIFIC || [],
      cpacific: mod.RETIRED_CPACIFIC || [],
      /* The Greek pair is exported on its own, so a comparison that only read
       * the three basin arrays would report Eta and Iota as newly retired on
       * every run forever. */
      described: mod.RETIRED_BY_DESCRIPTION || [],
    };
  } catch (err) {
    faults.push(`the committed ${OUT_FILE} could not be read: ${String(err && err.message || err)}`);
    return undefined;
  }
}

/* ---------------------------------------------------------------------------
 * 5. Render.
 * ------------------------------------------------------------------------ */

function block(name, rows, comment) {
  const lines = [];
  let line = '';
  for (const [n, y] of rows) {
    const piece = `['${n}', ${y}], `;
    if (line.length + piece.length > 70) { lines.push(line.trimEnd()); line = ''; }
    line += piece;
  }
  if (line.trim()) lines.push(line.trimEnd().replace(/,$/, ''));
  return `${comment}\nexport const ${name} = Object.freeze([\n${lines.map((l) => `  ${l}`).join('\n')}\n]);\n`;
}

function render(derived) {
  const counts = Object.fromEntries(Object.entries(derived).map(([k, v]) => [k, v.length]));
  return `/**
 * retired-names.js — GENERATED. DO NOT EDIT BY HAND.
 *
 * Every name the WMO has withdrawn, and the storm that earned it. Written by
 * \`tools/seasons-retired.mjs\`; read that file for the method and the gates.
 *
 * ==> IT IS DERIVED, NOT TRANSCRIBED, AND NOTHING FETCHES A LIST OF RETIRED
 * NAMES. <== Retirement is defined as removal from the active lists, so this
 * is every name the best-track record shows was used minus every name still in
 * service. Both halves already refresh themselves monthly. §57.51.
 *
 * ==> THE FAILURE DIRECTION IS THE LOUD ONE, WHICH IS WHY §57.17'S OBJECTION
 * TO A SCRAPER DOES NOT APPLY. <== A page restyle here makes every name look
 * retired — a flood, caught by the gates, refused, and the last good file left
 * exactly where it is. §57.17 refused the opposite: a silently emptied list
 * that still renders.
 *
 * ==> WHAT COULD NOT BE DERIVED IS NEXT DOOR IN \`retired-names-historic.js\`
 * AND THIS FILE ONLY RE-EXPORTS IT. <== That file is hand-written and frozen
 * and this job never touches it. The provenance stays readable: an entry in
 * \`RETIRED_DERIVED\` was computed this month; an entry that is only in
 * \`RETIRED_HISTORIC\` was written by a person once and cannot change.
 *
 * Derived this run: ${counts.atlantic} Atlantic, ${counts.epacific} east Pacific, ${counts.cpacific} central Pacific.
 *
 * Entries are \`[name, year]\`, upper case, so the join to HURDAT2 needs no
 * normalisation.
 *
 * Generated ${new Date().toISOString()}.
 */

import {
  HISTORIC_ATLANTIC, HISTORIC_EPACIFIC, HISTORIC_CPACIFIC,
  RETIRED_BY_DESCRIPTION,
} from './retired-names-historic.js';

export {
  RETIRED_BY_DESCRIPTION,
  RETIRED_UNSURE,
  RETIRED_NEVER_USED,
} from './retired-names-historic.js';

${block('DERIVED_ATLANTIC', derived.atlantic,
  '/** Atlantic, computed from the record and the lists in service. */')}
${block('DERIVED_EPACIFIC', derived.epacific,
  '/** East Pacific, computed. */')}
${block('DERIVED_CPACIFIC', derived.cpacific,
  '/** Central Pacific, computed. Storms whose id carries the CP prefix. */')}
/** Which entries were computed and which were written by hand, kept apart on
 *  purpose — the two are different kinds of claim. */
export const RETIRED_DERIVED = Object.freeze({
  atlantic: DERIVED_ATLANTIC,
  epacific: DERIVED_EPACIFIC,
  cpacific: DERIVED_CPACIFIC,
});
export const RETIRED_HISTORIC = Object.freeze({
  atlantic: HISTORIC_ATLANTIC,
  epacific: HISTORIC_EPACIFIC,
  cpacific: HISTORIC_CPACIFIC,
});

/* The two together, which is what a reader of this file almost always wants.
 * ==> THE GREEK PAIR IS DELIBERATELY NOT IN HERE. <== Eta and Iota were
 * retired by DESCRIPTION rather than by name and any copy about them has to
 * read differently; folding them in would let a caller print "the name Eta was
 * retired and will never be used again", which is false twice over. They are
 * exported above under their own name so a caller has to opt in. */
export const RETIRED_ATLANTIC = Object.freeze([...HISTORIC_ATLANTIC, ...DERIVED_ATLANTIC]);
export const RETIRED_EPACIFIC = Object.freeze([...HISTORIC_EPACIFIC, ...DERIVED_EPACIFIC]);
export const RETIRED_CPACIFIC = Object.freeze([...HISTORIC_CPACIFIC, ...DERIVED_CPACIFIC]);
`;
}

/* ---------------------------------------------------------------------------
 * 6. Run.
 * ------------------------------------------------------------------------ */

await mkdir(REPORT, { recursive: true });

const summary = ['# seasons-retired', ''];
let decision = 'skip';
let wrote = null;

const record = await readRecord();
const inService = record ? await readInService() : null;

if (record && inService && !faults.length) {
  const { inService: names, listLengths } = inService;

  const { derived, declined } = derive(record, names, {
    greek: new Set(GREEK_NEVER_RETIRED),
    described: new Set(RETIRED_BY_DESCRIPTION.map(([n]) => n)),
    neverUsed: new Set(RETIRED_NEVER_USED),
  }, listLengths);

  for (const d of declined) notes.push(`DECLINED: ${d}`);
  notes.push(`derived ${derived.atlantic.length} Atlantic, ${derived.epacific.length} east Pacific, `
    + `${derived.cpacific.length} central Pacific (floors ${FLOOR.atlantic}/${FLOOR.epacific}/${FLOOR.cpacific}, `
    + `${ACTIVE_LIST_COUNT} active lists, supplemental era from ${SUPPLEMENTAL_ERA})`);

  faults.push(...crossCheck(derived, record));

  const old = await committed();
  if (old !== undefined) {
    /* ==> THE MONOTONIC GATE COMPARES THE WHOLE ANSWER, NOT THE DERIVED HALF.
     * <== The committed file exports the derived names and the frozen historic
     * ones under one array each. Measuring only the derived block reports all
     * 34 historic entries as un-retired on every run — which it did, the first
     * time this was wired. The Greek pair counts as present too: they are
     * still retired, they are simply exported separately because the copy
     * about them has to differ. */
    const now = new Set([
      ...Object.values(derived).flat().map(([n]) => n),
      ...HISTORIC_ATLANTIC.map(([n]) => n),
      ...HISTORIC_EPACIFIC.map(([n]) => n),
      ...HISTORIC_CPACIFIC.map(([n]) => n),
      ...RETIRED_BY_DESCRIPTION.map(([n]) => n),
    ]);
    const before = old && new Set(
      [...old.atlantic, ...old.epacific, ...old.cpacific, ...old.described].map(([n]) => n));
    const verdict = judge(now, before);
    faults.push(...verdict.faults);
    notes.push(...verdict.notes);
  }

  if (!faults.length) {
    const text = render(derived);
    const path = join(ROOT, OUT_FILE);
    const before = existsSync(path) ? await readFile(path, 'utf8') : '';
    /* The header carries a timestamp, so comparing whole files would commit on
     * no news every month and churn the service worker for every reader. */
    const strip = (t) => t.slice(t.indexOf('import {'));
    if (before && strip(before) === strip(text)) {
      notes.push('the answer is exactly what the repo already holds — nothing to commit');
    } else if (CHECK_ONLY) {
      faults.push(`--check: ${OUT_FILE} is out of date — run this without --check`);
    } else {
      await writeFile(path, text, 'utf8');
      wrote = derived;
      decision = 'commit';
    }
  }
}

summary.push('');
for (const n of notes) summary.push(`- ${n}`);
if (faults.length) {
  summary.push('', '## REFUSED — nothing was written', '');
  for (const f of faults) summary.push(`- ${f}`);
} else if (wrote) {
  summary.push('', `## wrote ${OUT_FILE}`, '');
}

await writeFile(join(REPORT, 'summary.md'), summary.join('\n') + '\n', 'utf8');
await writeFile(join(REPORT, 'decision.txt'), decision + '\n', 'utf8');
if (decision === 'commit') {
  await writeFile(join(REPORT, 'commit-message.txt'),
    'Retired names re-derived from the record and the lists in service\n\n' +
    'Generated by tools/seasons-retired.mjs. Nothing was fetched: the answer is\n' +
    'every name HURDAT2 shows was used minus every name still on an active list.\n', 'utf8');
}

console.log(summary.join('\n'));

if (faults.length) {
  console.error('\nREFUSED. Nothing was written.');
  process.exit(1);
}
