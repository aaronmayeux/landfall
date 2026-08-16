#!/usr/bin/env node
/**
 * ships-corpus.mjs — pull a whole season of SHIPS files and describe what is
 * actually in them.
 *
 * WHY THIS EXISTS
 * §47 colors the cone from SHIPS. Seven files pasted by hand on 2026-08-15
 * produced seven separate format landmines — `N/A` past a short forecast,
 * `LOST` in the vortex row, `xx.x` positions while data columns keep going,
 * a basin header that contradicts the storm id, invests, and files carrying
 * sections the others lack. Seven files, seven surprises. The directory holds
 * roughly six hundred.
 *
 * A parser built against seven files is a parser built against one person's
 * imagination of the other five hundred and ninety-three. This pulls the lot
 * so the parser can be built against evidence, and so a test can exist that is
 * worth having: parse every file NHC published this season, assert none throw.
 *
 * WHAT IT PRODUCES
 *   <out>/files/          every fetched file, verbatim
 *   <out>/inventory.json  what is IN them — the actual deliverable
 *   <out>/index.html      the directory listing it worked from
 *
 * THE INVENTORY IS THE POINT. Nobody can hold six hundred files in their head
 * or in a context window. The inventory is a few KB and answers the questions
 * a parser author actually has: which non-numeric tokens appear in numeric
 * columns, which section headings exist and how often, how many forecast hours
 * a file can carry, how late a run can be published, and which rows are not
 * always present.
 *
 * NOT WIRED INTO THE HOURLY ARCHIVE, AND NOT RUN FROM A SESSION. It is a
 * one-off against someone else's public server: six hundred requests, so it
 * paces itself and identifies itself. Run it from the workflow, not by hand.
 *
 * THE CORPUS DOES NOT GO IN main. Every file in main ships to every visitor.
 * Six megabytes of text nobody's browser will ever read belongs on its own
 * branch. A dozen chosen files land in samples/ as fixtures; the rest stay
 * where a session can `git show` them.
 *
 * Zero dependencies. Run: node tools/ships-corpus.mjs <output-dir> [year]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) {
  console.error('usage: node tools/ships-corpus.mjs <output-dir> [year]');
  process.exit(2);
}
/** Two-digit year as it appears inside a SHIPS filename. */
const YEAR2 = String(process.argv[3] || new Date().getUTCFullYear()).slice(-2);

const INDEX_URL = 'https://ftp.nhc.noaa.gov/atcf/stext/';
const UA = 'Landfall/1.0 (+https://landfall.getgravitate.app)';
const TIMEOUT_MS = 30_000;

/** Be a polite guest. Six hundred requests at someone else's public server
 *  deserves a gap between them; the job has no deadline. */
const PACE_MS = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------------------------
 * WHICH FILES. The directory holds three kinds of storm number and only one
 * of them is a storm:
 *   01-49  real systems, named or numbered           <- what we want
 *   80-89  test systems (they appear out of season, e.g. AL8126 in March)
 *   90-99  invests, which DO get full SHIPS runs
 *
 * Invests are kept. They are real model output on real disturbances, they
 * carry sections the named-storm files do not (94L's eyewall-replacement
 * block), and a parser that chokes on one has a bug. Whether the ribbon ever
 * DRAWS an invest is a §45 question and a different one entirely.
 *
 * Test systems are dropped. They are exercises, not weather.
 * ----------------------------------------------------------------------- */
const NAME_RE = /^(\d{8})([A-Z]{2})(\d{2})(\d{2})_ships\.txt$/;

function classify(num) {
  const n = Number(num);
  if (n >= 80 && n <= 89) return 'test';
  if (n >= 90 && n <= 99) return 'invest';
  return 'storm';
}

/** Parse the Apache index. Names are truncated in the display text, so the
 *  href is the only reliable source — the visible label reads
 *  `26081506EP0826_ships..>` with the extension cut off. */
function parseIndex(html) {
  const out = [];
  const re = /href="([^"?][^"]*_ships\.txt)"/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return [...new Set(out)];
}

async function grab(url, { text = true } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ctl.signal });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status} ${res.statusText}` };
    const body = text ? await res.text() : Buffer.from(await res.arrayBuffer());
    return { ok: true, body, headers: Object.fromEntries(res.headers.entries()) };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------------------------------------------------
 * THE INVENTORY. Everything below reads a file and records what SHAPE it is,
 * never what it MEANS. No interpretation here on purpose: this runs before the
 * parser exists and its whole job is to tell the parser author what they are
 * about to meet.
 * ----------------------------------------------------------------------- */

/** A data row is a label followed by a run of columns. Labels are the first
 *  ~20 characters; the rest is values separated by whitespace. Mixed case is
 *  allowed — `Storm Type` is a real row. */
const ROW_RE = /^([A-Za-z0-9_ ()./-]{3,26}?)\s{2,}(.+)$/;

/** Anything that is not a plain number. These are the landmines. */
const isNumeric = (t) => /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t);

/** ==> A LABEL FOLLOWED BY WORDS IS A SENTENCE, NOT A ROW. <==
 *
 * Caught by testing this against a real file before it ever ran: prose lines
 * match the row shape perfectly. `INDIVIDUAL CONTRIBUTIONS TO INTENSITY
 * CHANGE`, `CURRENT MAX WIND (KT): 30. LAT, LON:` and the RI predictor table's
 * column headings were all being scraped as data, filling the landmine tally
 * with English words — `Predictor`, `Contribution`, `to` — which would have
 * buried the four tokens that actually matter under a hundred that do not.
 *
 * A real data row is overwhelmingly numeric even when it is full of `N/A`,
 * because the placeholders sit in numeric COLUMNS. Requiring most tokens to be
 * short and column-shaped separates the two without knowing any row names. */
const COLUMN_TOKEN_RE = /^[-+]?[\dA-Za-z./]{1,6}$/;
function looksLikeDataRow(tokens) {
  if (tokens.length < 4) return false;
  const columnish = tokens.filter((t) => COLUMN_TOKEN_RE.test(t)).length;
  return columnish / tokens.length >= 0.9;
}

function inspect(name, text) {
  const lines = text.split('\n');
  const rec = {
    name,
    bytes: Buffer.byteLength(text),
    lines: lines.length,
    headerLine: (lines[3] || '').trim(),
    sections: [],
    rowLabels: [],
    /** token -> how many times it appeared where a number was expected */
    nonNumeric: {},
    timeColumns: null,
    forecastHoursWithData: null,
    endsWith: text.endsWith('\n') ? 'newline' : 'no-newline',
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;

    /* Section headings: the file marks them with banners of asterisks, hashes
       or a run of dashes. Recorded verbatim so nothing is assumed about order
       or presence — 94L carries two blocks the other files lack. */
    if (/^\s*(\*\*|##|\s*\*\s)/.test(line) || /^\s*-{20,}\s*$/.test(line)) {
      /* Digits collapse to `#`. Without this every file yields its own
         "distinct" heading because the storm date and the NPASS counters are
         baked into the banner, and the tally becomes a list of six hundred
         near-identical strings instead of the handful of SHAPES we want. */
      const t = line
        .replace(/[*#]/g, ' ')
        .replace(/\d+/g, '#')
        .replace(/\s+/g, ' ')
        .trim();
      if (t && !/^[-#]+$/.test(t)) rec.sections.push(t.slice(0, 90));
      continue;
    }

    if (/^TIME \(HR\)/.test(line)) {
      const cols = line.split(/\s+/).slice(2).filter(Boolean);
      rec.timeColumns = cols.length;
      continue;
    }

    /* Contribution rows are indented two spaces and their labels run to 20
       characters, so matching against the raw line pushed the longest of them
       — 850 MB ENV VORTICITY, DAYS FROM CLIM. PEAK — past the label cap and
       dropped them silently. A dropped row reads downstream as a row that is
       "not in every file", which is exactly the wrong answer. */
    const m = ROW_RE.exec(line.replace(/^\s+/, ''));
    if (!m) continue;
    const label = m[1].trim();
    const tokens = m[2].trim().split(/\s+/);
    if (!/[A-Za-z]/.test(label)) continue;
    if (!looksLikeDataRow(tokens)) continue;
    rec.rowLabels.push(label);
    for (const t of tokens) {
      if (isNumeric(t)) continue;
      rec.nonNumeric[t] = (rec.nonNumeric[t] || 0) + 1;
    }

    /* How far the forecast actually goes. `V (KT) LAND` is the intensity
       forecast the health paragraph reads (§47.8), so its numeric run is the
       usable length of the file. */
    if (/^V \(KT\) LAND/.test(line)) {
      let n = 0;
      for (const t of tokens) { if (!isNumeric(t)) break; n++; }
      rec.forecastHoursWithData = n;
    }
  }
  rec.rowLabels = [...new Set(rec.rowLabels)];
  rec.sections = [...new Set(rec.sections)];
  return rec;
}

/* --------------------------------------------------------------------------
 * RUN
 * ----------------------------------------------------------------------- */

mkdirSync(join(OUT, 'files'), { recursive: true });

console.log(`fetching the index: ${INDEX_URL}`);
const idx = await grab(INDEX_URL);
if (!idx.ok) {
  console.error(`index unreachable — ${idx.reason}`);
  process.exit(1);
}
writeFileSync(join(OUT, 'index.html'), idx.body);

const all = parseIndex(idx.body);
console.log(`index lists ${all.length} SHIPS file(s)`);

const wanted = [];
const skipped = { test: 0, otherYear: 0, unparsed: 0 };
for (const f of all) {
  const m = NAME_RE.exec(f);
  if (!m) { skipped.unparsed++; continue; }
  const [, stamp, basin, num, yr] = m;
  if (yr !== YEAR2) { skipped.otherYear++; continue; }
  const kind = classify(num);
  if (kind === 'test') { skipped.test++; continue; }
  wanted.push({ file: f, stamp, basin, num, kind });
}
console.log(
  `taking ${wanted.length} — skipped ${skipped.test} test system(s), ` +
    `${skipped.otherYear} from other years, ${skipped.unparsed} unrecognised name(s)`
);

const records = [];
const failures = [];
let done = 0;
for (const w of wanted) {
  const r = await grab(`${INDEX_URL}${w.file}`);
  done++;
  if (!r.ok) {
    failures.push({ file: w.file, reason: r.reason });
    console.log(`FAIL ${w.file}  ${r.reason}`);
  } else {
    writeFileSync(join(OUT, 'files', w.file), r.body);
    const rec = inspect(w.file, r.body);
    rec.basin = w.basin;
    rec.stormNumber = w.num;
    rec.kind = w.kind;
    rec.synoptic = w.stamp;
    rec.lastModified = r.headers['last-modified'] || null;
    records.push(rec);
  }
  if (done % 50 === 0) console.log(`  ${done}/${wanted.length}`);
  await sleep(PACE_MS);
}

/* ---- roll the per-file records up into the thing a person can read ------ */

const tally = (rows, pick) => {
  const t = {};
  for (const r of rows) for (const v of [].concat(pick(r) ?? [])) {
    if (v != null) t[v] = (t[v] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(t).sort((a, b) => b[1] - a[1]));
};

const nonNumeric = {};
for (const r of records) {
  for (const [tok, n] of Object.entries(r.nonNumeric)) {
    nonNumeric[tok] = (nonNumeric[tok] || 0) + n;
  }
}

/** How long after its nominal hour a run was actually published. The relay
 *  cannot assume the newest synoptic slot exists, and this says by how much. */
const lags = [];
for (const r of records) {
  if (!r.lastModified) continue;
  const s = r.synoptic;
  const nominal = Date.UTC(
    2000 + Number(s.slice(0, 2)), Number(s.slice(2, 4)) - 1,
    Number(s.slice(4, 6)), Number(s.slice(6, 8))
  );
  const mins = Math.round((Date.parse(r.lastModified) - nominal) / 60000);
  if (Number.isFinite(mins)) lags.push(mins);
}
lags.sort((a, b) => a - b);
const pct = (p) => (lags.length ? lags[Math.min(lags.length - 1, Math.floor(lags.length * p))] : null);

/** Rows that are NOT in every file. A parser must treat these as optional. */
const labelCounts = tally(records, (r) => r.rowLabels);
const notAlwaysPresent = Object.entries(labelCounts)
  .filter(([, n]) => n < records.length)
  .map(([label, n]) => ({ label, inFiles: n, ofFiles: records.length }));

const inventory = {
  builtAt: new Date().toISOString(),
  season: YEAR2,
  indexUrl: INDEX_URL,
  counts: {
    listed: all.length,
    fetched: records.length,
    failed: failures.length,
    skipped,
    byKind: tally(records, (r) => r.kind),
    byBasin: tally(records, (r) => r.basin),
    distinctStorms: new Set(records.map((r) => `${r.basin}${r.stormNumber}`)).size,
  },
  /* ==> THE HEADLINE. Every token that turned up where a number belonged. <==
     Seven hand-pasted files produced N/A, LOST, xx.x and xxx.x. Anything here
     that is not one of those four is something nobody has seen yet, and the
     parser has to survive it. */
  nonNumericTokens: nonNumeric,
  sectionHeadings: tally(records, (r) => r.sections),
  rowLabels: labelCounts,
  rowsNotInEveryFile: notAlwaysPresent,
  timeColumnCounts: tally(records, (r) => r.timeColumns),
  forecastHoursWithData: tally(records, (r) => r.forecastHoursWithData),
  fileEndings: tally(records, (r) => r.endsWith),
  bytes: {
    min: Math.min(...records.map((r) => r.bytes)),
    max: Math.max(...records.map((r) => r.bytes)),
  },
  publicationLagMinutes: {
    n: lags.length,
    min: lags[0] ?? null,
    p50: pct(0.5),
    p90: pct(0.9),
    max: lags[lags.length - 1] ?? null,
  },
  failures,
  files: records.map((r) => ({
    name: r.name, kind: r.kind, basin: r.basin, synoptic: r.synoptic,
    bytes: r.bytes, hours: r.forecastHoursWithData,
    header: r.headerLine, lastModified: r.lastModified,
  })),
};

writeFileSync(join(OUT, 'inventory.json'), JSON.stringify(inventory, null, 2));

console.log('\n--- inventory ---');
console.log(`fetched ${records.length}, failed ${failures.length}`);
console.log('non-numeric tokens where a number was expected:');
for (const [t, n] of Object.entries(nonNumeric)) console.log(`   ${JSON.stringify(t).padEnd(12)} ${n}`);
console.log(`forecast-hour counts: ${JSON.stringify(inventory.forecastHoursWithData)}`);
console.log(`publication lag (min): ${JSON.stringify(inventory.publicationLagMinutes)}`);
console.log(`rows missing from some files: ${notAlwaysPresent.length}`);
console.log(`\nwrote ${join(OUT, 'inventory.json')}`);
