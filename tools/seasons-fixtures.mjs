#!/usr/bin/env node
/* seasons-fixtures.mjs — cut REAL HURDAT2 storms out of NOAA's full files.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT THE PROBE
 * `tools/seasons-probe.mjs` answered "what shape is this file". It saved the
 * first 96 KB of each HURDAT2 file, which is 1851-1859 — a decade with no
 * names, no wind radii, no record identifiers and no pressure. Every modern
 * feature of the format is absent from it, so a parser written against that
 * sample is a parser nobody has tested.
 *
 * This job downloads the WHOLE file on a runner (the sandbox cannot reach
 * NOAA) and cuts out a handful of storms chosen to exercise every cliff in
 * §57.6, then publishes them. They get copied into `samples/seasons/` by hand,
 * as permanent fixtures, exactly like every other sample in this repo.
 *
 * DATA, NOT CODE. One orphan commit on `seasons-fixtures-results`, force
 * pushed, never merged into main.
 *
 * HOW TO READ THE RESULT (works from a phone)
 *   git fetch origin seasons-fixtures-results
 *   git show origin/seasons-fixtures-results:findings.md
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const OUT = process.argv[2] || '/tmp/seasons-fixtures';
const BASE = 'https://www.nhc.noaa.gov/data/hurdat/';
const USER_AGENT = 'landfall-seasons-fixtures (github.com/aaronmayeux/landfall)';

/* Politeness toward a public service. Two full files, paced. */
const PAUSE_MS = 2000;
const TIMEOUT_MS = 120000;

const report = [];
const say = (s) => { report.push(s); };

async function save(rel, text) {
  const p = join(OUT, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, text);
  return p;
}

async function grab(url, { timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      signal: ctrl.signal,
    });
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status} ${r.statusText}` };
    const text = await r.text();
    return { ok: true, text, bytes: text.length };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

const hrefs = (html) =>
  [...String(html || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);

/* ==> PICK BY THE YEARS IN THE NAME, NOT BY SORTING THE STRING. <==
 * Lifted verbatim in spirit from seasons-probe.mjs, and it is there because
 * the probe's first run read a file two seasons stale. NOAA leaves every past
 * revision in the directory. */
function latestOf(list) {
  let best = null;
  let bestKey = -1;
  for (const f of list) {
    const years = f.match(/\d{4}/g) || [];
    if (years.length < 2) continue;
    const covers = Number(years[1]);
    const rev = f.replace(/\D/g, '');
    const key = covers * 1e12 + Number(rev.slice(-8));
    if (key > bestKey) { bestKey = key; best = f; }
  }
  return best;
}

/* Split a HURDAT2 file into storms WITHOUT parsing the rows. A header line has
 * three fields plus a trailing comma; a data line has twenty-one. That is the
 * only distinction this cutter needs, and keeping it dumb means a change in
 * the data columns cannot break the cutter. */
function splitStorms(text) {
  const lines = text.split('\n');
  const storms = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    const fields = line.split(',');
    if (fields.length <= 4) {
      if (cur) storms.push(cur);
      cur = { id: fields[0].trim(), name: (fields[1] || '').trim(), header: line, rows: [] };
    } else if (cur) {
      cur.rows.push(line);
    }
  }
  if (cur) storms.push(cur);
  return storms;
}

const asText = (s) => [s.header, ...s.rows].join('\n') + '\n';
const yearOf = (s) => Number(s.id.slice(4, 8));
const fieldAt = (row, i) => (row.split(',')[i] || '').trim();

/* Storms named on purpose. Each one is here to make a specific rule in §57.6
 * or §57.7 testable against bytes NOAA actually published. */
const WANTED = [
  ['AL092021', 'IDA 2021 — §57.30 step 2 names her as the hand-check, and we already hold her full advisory capture in samples/ida-al092021 to check against. Post-2021 so she carries radius of maximum wind.'],
  ['AL122005', 'KATRINA 2005 — wind radii present (2004+), RMW absent (pre-2021), several landfalls. The middle band §57.9 describes.'],
  ['AL041992', 'ANDREW 1992 — pre-2004, so NO wind radii at all, but landfalls ARE marked (the §57.7 gap ends in 1991). Pressure present.'],
  ['AL111989', 'HUGO 1989 — inside the 1971-1990 landfall hole. A US landfall that NOAA did not mark. §57.7.'],
  ['AL031935', 'LABOR DAY 1935 — UNNAMED, pre-1950, and the headline entry on §57.14 alias list.'],
  ['AL011851', 'The first storm in the file. Already held as part of the probe sample; kept here so one directory holds every era.'],
  ['EP152021', 'A 2021 E Pacific storm — the Pacific file with a modern row shape.'],
];

async function cutFile(label, file, wantedIds, wholeSeasons) {
  const url = BASE + file;
  const got = await grab(url);
  if (!got.ok) {
    say(`\n**${label}: \`${file}\` could not be read — ${got.reason}.**\n`);
    return null;
  }

  const storms = splitStorms(got.text);
  const years = storms.map(yearOf).filter(Number.isFinite);
  const first = Math.min(...years);
  const last = Math.max(...years);

  say(`\n### ${label} — \`${file}\``);
  say(`\n${(got.bytes / 1048576).toFixed(2)} MB, ${storms.length} storms, ${first}-${last}.\n`);

  const byId = new Map(storms.map((s) => [s.id, s]));
  const cut = [];

  for (const [id, why] of wantedIds) {
    const s = byId.get(id);
    if (!s) { cut.push([id, null, why, 'NOT FOUND in this file']); continue; }
    await save(`storms/${id.toLowerCase()}.txt`, asText(s));
    cut.push([id, s, why, `${s.rows.length} rows`]);
  }

  /* Rule-based finds. These are things §57.6 says exist somewhere in the file
   * without saying WHERE, so the cutter looks rather than guesses. */
  const finds = [];

  const noIntensity = storms.find((s) => s.rows.some((r) => fieldAt(r, 6) === '-99'));
  if (noIntensity) {
    await save(`storms/${noIntensity.id.toLowerCase()}.txt`, asText(noIntensity));
    finds.push([noIntensity.id, `A row with NO assigned intensity (\`-99\`). §57.6 says the non-developing depressions of 1967 have this; this is the first one in the file.`, `${noIntensity.rows.length} rows`]);
  } else {
    finds.push(['—', 'No `-99` wind value anywhere in this file.', 'nothing cut']);
  }

  const eastLon = storms.find((s) => s.rows.some((r) => /E$/.test(fieldAt(r, 5))));
  if (eastLon) {
    await save(`storms/${eastLon.id.toLowerCase()}.txt`, asText(eastLon));
    finds.push([eastLon.id, 'Carries an EAST longitude. A parser that assumes W and negates blindly puts this storm on the wrong side of the planet.', `${eastLon.rows.length} rows`]);
  } else {
    finds.push(['—', 'No east longitude in this file.', 'nothing cut']);
  }

  const rapid = storms.find((s) => s.rows.some((r) => fieldAt(r, 2) === 'R'));
  if (rapid) {
    await save(`storms/${rapid.id.toLowerCase()}.txt`, asText(rapid));
    finds.push([rapid.id, 'Carries an `R` record identifier — a rapid intensity change. §57.5.', `${rapid.rows.length} rows`]);
  } else {
    finds.push(['—', 'No `R` record identifier in this file.', 'nothing cut']);
  }

  const rmw = storms.find((s) => s.rows.some((r) => {
    const v = fieldAt(r, 20);
    return v && v !== '-999';
  }));
  if (rmw) {
    await save(`storms/${rmw.id.toLowerCase()}.txt`, asText(rmw));
    finds.push([rmw.id, 'The first storm with a real radius of maximum wind (field 21). §57.6 puts that cliff at 2021.', `${rmw.rows.length} rows`]);
  } else {
    finds.push(['—', 'No radius of maximum wind anywhere in this file.', 'nothing cut']);
  }

  /* Whole seasons. Step 5's board and §57.15's season totals need a real one,
   * and a season is the unit the feature is organised by. */
  const seasonFiles = [];
  for (const year of wholeSeasons) {
    const inYear = storms.filter((s) => yearOf(s) === year);
    if (!inYear.length) { seasonFiles.push([year, 0, 0]); continue; }
    const text = inYear.map(asText).join('');
    const prefix = inYear[0].id.slice(0, 2).toLowerCase();
    await save(`seasons/${prefix}-${year}.txt`, text);
    seasonFiles.push([year, inYear.length, text.length]);
  }

  /* Every distinct value the format actually uses, counted rather than
   * remembered. A parser needs the real list, not §57.4's list. */
  const statuses = new Map();
  const identifiers = new Map();
  const widths = new Map();
  let dataRows = 0;
  for (const s of storms) {
    for (const r of s.rows) {
      dataRows++;
      const f = r.split(',');
      widths.set(f.length, (widths.get(f.length) || 0) + 1);
      const st = (f[3] || '').trim();
      statuses.set(st, (statuses.get(st) || 0) + 1);
      const id = (f[2] || '').trim();
      if (id) identifiers.set(id, (identifiers.get(id) || 0) + 1);
    }
  }

  const tally = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `\`${k}\` ${v}`).join(' · ');

  /* ==> §57.7 SAYS THERE IS A TWENTY-YEAR HOLE IN LANDFALL MARKS, 1971-1990,
   * AND HUGO 1989 CONTRADICTS IT. <== His Sullivan's Island landfall is marked
   * in the file this job just downloaded. One storm is not a measurement, so
   * this counts `L` markers by year across the WHOLE file. If the claimed hole
   * is empty, §57.7's decision to compute those landfalls ourselves is work
   * that does not need doing. If it is only thin, the decision stands. */
  const lfByYear = new Map();
  for (const s of storms) {
    const y = yearOf(s);
    if (!Number.isFinite(y)) continue;
    const n = s.rows.filter((r) => fieldAt(r, 2) === 'L').length;
    lfByYear.set(y, (lfByYear.get(y) || 0) + n);
  }
  const decade = (from, to) => {
    let n = 0;
    let yearsWith = 0;
    for (let y = from; y <= to; y++) {
      const c = lfByYear.get(y) || 0;
      n += c;
      if (c) yearsWith++;
    }
    return { n, yearsWith, years: to - from + 1 };
  };
  say('\n**==> THE §57.7 LANDFALL GAP, COUNTED <==**\n');
  say('| period | `L` markers | years with at least one | years |');
  say('|---|---|---|---|');
  for (const [label, d] of [
    ['1951-1970 (spec says present)', decade(1951, 1970)],
    ['**1971-1990 (spec says MISSING)**', decade(1971, 1990)],
    ['1991-2010 (spec says present)', decade(1991, 2010)],
  ]) {
    say(`| ${label} | ${d.n} | ${d.yearsWith} | ${d.years} |`);
  }
  const empty = [...Array(20)].map((_, i) => 1971 + i).filter((y) => !lfByYear.get(y));
  say(`\nEmpty years inside the claimed hole: ${empty.length ? empty.join(', ') : '**none**'}\n`);

  say('\n**Named storms cut**\n');
  say('| id | name | rows | why |');
  say('|---|---|---|---|');
  for (const [id, s, why, note] of cut) {
    say(`| \`${id}\` | ${s ? s.name : '—'} | ${note} | ${why} |`);
  }

  say('\n**Found by rule**\n');
  say('| id | rows | what it proves |');
  say('|---|---|---|');
  for (const [id, why, note] of finds) say(`| \`${id}\` | ${note} | ${why} |`);

  say('\n**Whole seasons cut**\n');
  for (const [year, n, bytes] of seasonFiles) {
    say(n ? `- **${year}** — ${n} storms, ${(bytes / 1024).toFixed(0)} KB` : `- **${year}** — not in this file`);
  }

  say('\n**Counted across the WHOLE file, not a sample**\n');
  say(`- Data rows: **${dataRows}**`);
  say(`- Field counts on data rows: ${tally(widths)}`);
  say(`- Status values: ${tally(statuses)}`);
  say(`- Record identifiers: ${tally(identifiers)}`);

  return { file, storms: storms.length, bytes: got.bytes };
}

async function main() {
  say('# Seasons fixtures — real storms cut from the full HURDAT2 files\n');
  say(`Run ${new Date().toISOString()}. Source: ${BASE}\n`);
  say('**These are bytes NOAA published, cut at storm boundaries, nothing edited.**');
  say('Copy the ones worth keeping into `samples/seasons/` on `main` by hand.\n');

  const idx = await grab(BASE);
  if (!idx.ok) {
    say(`\n**COULD NOT READ THE DIRECTORY — ${idx.reason}.** Nothing was cut.\n`);
    await save('findings.md', report.join('\n'));
    process.exitCode = 1;
    return;
  }

  const all = hrefs(idx.text).map((h) => h.split('/').pop())
    .filter((h) => /^hurdat2.*\.txt$/i.test(h));
  const pac = all.filter((f) => /nepac/i.test(f));
  const atl = all.filter((f) => !/nepac/i.test(f));

  say(`\nDirectory holds ${all.length} HURDAT2 files. Atlantic ${atl.length}, E/C Pacific ${pac.length}.`);
  say('The newest is picked by the last season in the filename, never by sorting.\n');

  const atlFile = latestOf(atl);
  const pacFile = latestOf(pac);

  const atlWanted = WANTED.filter(([id]) => id.startsWith('AL'));
  const pacWanted = WANTED.filter(([id]) => !id.startsWith('AL'));

  if (atlFile) await cutFile('Atlantic', atlFile, atlWanted, [2005, 2021]);
  else say('\n**No Atlantic file matched.**\n');

  await new Promise((r) => setTimeout(r, PAUSE_MS));

  if (pacFile) await cutFile('E/C Pacific', pacFile, pacWanted, [2021]);
  else say('\n**No E/C Pacific file matched.**\n');

  await save('findings.md', report.join('\n'));
  console.log(report.join('\n'));
}

main().catch(async (e) => {
  say(`\n**THE CUTTER THREW.** \`${String(e?.stack || e)}\`\n`);
  await save('findings.md', report.join('\n'));
  process.exitCode = 1;
});
