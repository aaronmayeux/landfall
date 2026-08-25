/**
 * tcr-index.mjs — build the storm → written-report lookup. §57.22, §57.22a,
 * §57.30 step 7, `SPEC-OPS.md` §18.
 *
 * ==> WHY A FILE IN THE REPO AND NOT A URL BUILT AT READ TIME. <== §57.22a
 * measured it: 510 of 534 report filenames follow `AL122005_Katrina.pdf`, and
 * the 24 that do not break in two systematic ways — a storm that crossed
 * basins carries BOTH ids, and an unnamed storm is written with its number
 * spelled out where we hold `UNNAMED`. A constructed URL is right most of the
 * time, and **a link that is right most of the time is the silent failure this
 * whole exercise exists to prevent**: a dead link looks exactly like a live one
 * until somebody presses it, in the one panel whose entire job is historical
 * accuracy.
 *
 * Constructing and then VERIFYING would work — a miss is a clean 404 — at the
 * cost of a request to NOAA every time a reader opens a panel, to answer a
 * question that never changes for a settled season. A lookup answers it
 * offline, instantly, and for a season the reader has already downloaded.
 *
 * ==> TWO SOURCES, AND THE ONE THAT LOOKS BETTER IS THE WEAKER OF THEM. <==
 *
 *   THE PER-SEASON HTML PAGES carry the storm id inside every filename, so a
 *   match is EXACT. They only go back to 1995.
 *
 *   `TCR_StormReportsIndex.xml` is NOAA's own machine-readable index and
 *   reaches back to 1958 — 37 more years — but it carries **no storm id at
 *   all**: only a name, a year and a basin. Every row has to be matched to a
 *   storm by name, and a name match is a GUESS wearing a tidy format.
 *
 * So both are read, exact ids win wherever they exist, and every entry records
 * which road it came by. A future session auditing a wrong link needs to know
 * whether it was read or inferred, and that cannot be reconstructed later.
 *
 * ==> A NAME MATCH IS ACCEPTED ONLY WHEN IT IS UNAMBIGUOUS. <== Exactly one
 * storm in that season and basin may answer to that name. Anything else is
 * DROPPED and counted, never resolved by preferring the first or the strongest
 * — an index that quietly picks between two candidates is worse than one with a
 * hole in it, because the hole is visible and the wrong pick is not.
 *
 * ==> AND IT CAN REFUSE. <== Same shape and same reason as
 * `tools/seasons-hurdat.mjs`: if the run produces fewer entries than the file
 * it would replace, nothing is written and the job FAILS. Either NOAA
 * restructured their pages or our reader stopped understanding them, and both
 * are worse than a month with no update. A silent replacement would empty the
 * report links and nobody would notice until they opened a storm.
 *
 * Zero dependencies. Run:
 *     node tools/tcr-index.mjs <repo-root> <report-dir>
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app, andy@getgravitate.app)';
const TIMEOUT_MS = 45_000;
const PACE_MS = 300;

/** Where the index page lives. The only hardcoded URL in this file, and it is
 *  hardcoded because it is the door — everything else is discovered by reading
 *  what it links. */
const ENTRY = 'https://www.nhc.noaa.gov/data/tcr/index.php';

/** NOAA's own machine-readable index, at the path the entry page links it —
 *  NOT under /data/tcr/, which is where §57.22a records this being guessed
 *  wrong and reported as an absence. */
const XML = 'https://www.nhc.noaa.gov/TCR_StormReportsIndex.xml';

/** Every URL is stored relative to this, because storing it 1,200 times is
 *  most of the file. */
const ORIGIN = 'https://www.nhc.noaa.gov';

/** How many entries to verify by HEAD before writing. The index is a set of
 *  claims; a sample says whether the claims resolve. Both roads are sampled
 *  separately, because the name-matched half is the half that can be wrong in
 *  a way the exact half cannot. */
const VERIFY_PER_ROAD = 25;

/** A cap, so a restructured index that suddenly links thousands of pages
 *  cannot turn this into a crawl of NOAA's site. */
const MAX_SEASON_PAGES = 200;

const ROOT = process.argv[2] || '.';
const REPORT_DIR = process.argv[3] || '/tmp/tcr-index';
const OUT_FILE = join(ROOT, 'seasons', 'reports.json');

const notes = [];
const say = (s = '') => notes.push(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------------------------
 * FETCH
 * ----------------------------------------------------------------------- */

async function get(url, { method = 'GET' } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method,
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const body = method === 'HEAD' ? null : await r.text();
    return { http: r.status, body };
  } catch (err) {
    return { http: null, body: null, reason: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

function hrefs(html, base) {
  const out = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try { out.push(new URL(m[1], base).href); } catch { /* malformed is not a finding */ }
  }
  return out;
}

/* --------------------------------------------------------------------------
 * OUR OWN HISTORY — what a report has to attach to
 * ----------------------------------------------------------------------- */

/**
 * Every real storm we hold. Read off the HURDAT2 header rows directly rather
 * than through `lib/hurdat.js`, deliberately: a generator that shares a
 * dependency with the data it is matching against can agree with it while both
 * are wrong, and this one only needs three fields.
 */
function ourStorms() {
  const dir = join(ROOT, 'seasons', 'data');
  const out = [];
  for (const f of readdirSync(dir).filter((x) => /^(atlantic|epacific)-\d{4}-/.test(x))) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const line of text.split('\n')) {
      const m = /^([A-Z]{2}\d{6}),\s*([^,]*),/.exec(line);
      if (!m) continue;
      const id = m[1];
      const num = Number(id.slice(2, 4));
      if (num < 1 || num > 79) continue; /* invests and test systems — §57.13 */
      out.push({
        id,
        name: m[2].trim().toUpperCase(),
        year: Number(id.slice(4, 8)),
        basin: id.slice(0, 2),
        number: num,
      });
    }
  }
  return out;
}

/* --------------------------------------------------------------------------
 * ROAD 1 — THE PER-SEASON HTML PAGES. Exact, 1995 on.
 * ----------------------------------------------------------------------- */

/** Every ATCF-shaped id in a filename. Plural on purpose: a storm that crossed
 *  basins carries two, and BOTH must reach the same report — a reader who
 *  opens Bonnie from the Pacific side wants the same document. */
function idsIn(file) {
  const out = [];
  const re = /([A-Z]{2})(\d{2})(\d{4})/gi;
  let m;
  while ((m = re.exec(file))) out.push(`${m[1].toUpperCase()}${m[2]}${m[3]}`);
  return out;
}

async function fromHtml(known) {
  const entry = await get(ENTRY);
  if (entry.http !== 200 || !entry.body) {
    say(`- **The index page did not answer** (HTTP ${entry.http ?? 'no reply'}). No exact matches this run.`);
    return new Map();
  }

  const seasonPages = [...new Set(
    hrefs(entry.body, ENTRY).filter((u) => /index\.php\?season=\d{4}&basin=[a-z]+/i.test(u))
  )].sort().reverse();

  const found = new Map(); // id -> relative url
  let visited = 0;
  for (const page of seasonPages) {
    if (visited >= MAX_SEASON_PAGES) break;
    const r = await get(page);
    visited++;
    await sleep(PACE_MS);
    if (r.http !== 200 || !r.body) continue;
    for (const u of hrefs(r.body, page)) {
      if (!/\.pdf$/i.test(u) || !u.startsWith(ORIGIN)) continue;
      const file = decodeURIComponent(u.split('/').pop() || '');
      for (const id of idsIn(file)) {
        /* Only ids we actually hold. A report for a storm outside our two
         * mirrored basins is real and is not ours to link — the Central
         * Pacific pages carry `CP` ids that HURDAT2 files under `EP`. */
        if (known.has(id) && !found.has(id)) found.set(id, u.slice(ORIGIN.length));
      }
    }
  }
  say(`- Read **${visited}** season pages and matched **${found.size}** storms by id.`);
  return found;
}

/* --------------------------------------------------------------------------
 * ROAD 2 — THE XML. Broad, 1958 on, and every match is a NAME match.
 * ----------------------------------------------------------------------- */

/**
 * NOAA's basin word → our basin code.
 *
 * ==> MEASURED, NOT ASSUMED, AND THE FIRST GUESS SILENTLY LOST 508 ROWS. <==
 * A reasonable-looking map of `Atlantic` / `Eastern Pacific` / `Central
 * Pacific` matched 690 of 1,199 rows and dropped the rest before they were
 * ever tested — no error, no warning, just a Pacific half that quietly did not
 * exist. The XML uses exactly two words: `Atlantic` (690) and `Pacific` (508).
 *
 * Both Pacific basins land on `EP` because that is where HURDAT2 files them:
 * the Central Pacific has its own `CP` operational ids but its best track
 * lives in the East Pacific file.
 *
 * A basin word that is not in here is COUNTED as unmapped rather than skipped
 * in silence, because that is exactly the failure this comment records.
 */
const BASIN_OF = {
  Atlantic: ['AL'],
  /* ==> A PACIFIC ROW HAS TO LOOK IN TWO BUCKETS. <== HURDAT2's East Pacific
   * FILE contains storms with `EP` ids and storms with `CP` ids — the Central
   * Pacific has its own operational numbering but its best track lives in that
   * one file. NOAA's XML says only `Pacific`, so a row for Kika or Halola or
   * Omeka would never find its storm if this named one code. Measured: 27 rows
   * were dropped for exactly this before it was a list, and every one of them
   * is a Central Pacific storm. The "exactly one candidate" rule still applies
   * across the union, so widening the search does not weaken the match. */
  Pacific: ['EP', 'CP'],
  'Eastern Pacific': ['EP'],
  'Central Pacific': ['CP'],
};

/**
 * Strip the descriptive prefix NOAA puts on an unnamed system, leaving what it
 * is actually called.
 *
 * `Tropical Depression Two (Atlantic)` → `TWO`. That still will not match our
 * `UNNAMED`, and it is not meant to — it is turned back into a NUMBER below,
 * which is a far stronger key than a name for exactly these storms.
 */
function bareName(raw) {
  return String(raw || '')
    .replace(/\([^)]*\)/g, '')
    .replace(/^(Tropical|Subtropical|Potential)\s+(Depression|Storm|Cyclone)\s+/i, '')
    .replace(/^(Hurricane|Tropical\s+Storm|Major\s+Hurricane)\s+/i, '')
    .trim()
    .toUpperCase();
}

const WORD_NUMBER = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9,
  TEN: 10, ELEVEN: 11, TWELVE: 12, THIRTEEN: 13, FOURTEEN: 14, FIFTEEN: 15,
  SIXTEEN: 16, SEVENTEEN: 17, EIGHTEEN: 18, NINETEEN: 19, TWENTY: 20,
};

function fromXml(storms, alreadyExact) {
  return (async () => {
    const r = await get(XML);
    if (r.http !== 200 || !r.body) {
      say(`- **The XML index did not answer** (HTTP ${r.http ?? 'no reply'}). No name matches this run.`);
      return { found: new Map(), dropped: [] };
    }

    /* By season and basin, so "exactly one candidate" is a question about a
     * small set rather than about 3,266 storms. */
    const bucket = new Map();
    for (const s of storms) {
      const k = `${s.year}:${s.basin}`;
      if (!bucket.has(k)) bucket.set(k, []);
      bucket.get(k).push(s);
    }

    const found = new Map();
    const dropped = [];
    const unmapped = new Map();
    const rows = r.body.split('<row>').slice(1);
    for (const row of rows) {
      const g = (tag) => (new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(row) || [, ''])[1].trim();
      const url = g('StormReportURL');
      const year = Number(g('Year'));
      const basinWord = g('Basin');
      const basin = BASIN_OF[basinWord];
      const raw = g('StormName');
      if (!url || !Number.isFinite(year) || !url.startsWith(ORIGIN)) continue;
      if (!basin || !basin.length) {
        /* ==> COUNTED, NEVER SKIPPED IN SILENCE. <== The first version of this
         * file mapped three basin words and the XML uses two, so 508 rows fell
         * through this branch with no trace at all — a Pacific half that
         * quietly did not exist. A word we cannot map is now a number in the
         * summary, which is the difference between a bug and a finding. */
        unmapped.set(basinWord, (unmapped.get(basinWord) || 0) + 1);
        continue;
      }

      const candidates = basin.flatMap((b) => bucket.get(`${year}:${b}`) || []);
      const nm = bareName(raw);

      /* ==> THE `-E` AND `-C` SUFFIX. <== `Tropical Depression Two-E` is the
       * ATCF operational form for an East Pacific depression, and `-C` for a
       * Central Pacific one. HURDAT2 does not use them. `lib/hurdat.js` already
       * strips the same suffix for the same reason (§57.14); it is repeated
       * here rather than imported so this generator keeps no dependency on the
       * parser it is matching against. Worth ~30 rows. */
      const stem = nm.replace(/-[EC]$/, '');

      /* A NUMBERED system is matched on its NUMBER, not its name — that is the
       * whole reason `Tropical Depression Two` is readable at all, and it is a
       * stronger key than any string comparison. §57.14 reads a spelled-out
       * number as a placeholder on our side, so the two representations only
       * meet here. */
      const asNumber = WORD_NUMBER[stem] ?? (/^\d+$/.test(stem) ? Number(stem) : null);
      let hits = asNumber != null
        ? candidates.filter((s) => s.number === asNumber)
        : candidates.filter((s) => s.name && s.name === stem);

      /* ==> NOAA TRUNCATED SOME OLDER PACIFIC NAMES TO EIGHT CHARACTERS. <==
       * `Geneviev`, `Priscill`, `Guillerm`, `Georgett` — real rows, and an
       * exact comparison drops every one. A prefix match recovers them and is
       * still safe under the rule below, because it must ALSO resolve to
       * exactly one storm in that season and basin.
       *
       * FIVE CHARACTERS MINIMUM, so a short stem cannot sweep up a season. It
       * is only tried when the exact comparison found nothing, so it can never
       * override a real match. */
      if (!hits.length && asNumber == null && stem.length >= 5) {
        hits = candidates.filter((s) => s.name && s.name.startsWith(stem));
      }

      if (hits.length !== 1) {
        /* ==> AMBIGUOUS OR UNMATCHED IS DROPPED AND COUNTED, NEVER GUESSED.
         * <== Preferring the first or the strongest candidate would produce an
         * index that is quietly wrong, and a wrong link is invisible where a
         * missing one is not. */
        dropped.push({ raw, year, basin, candidates: hits.length });
        continue;
      }
      const id = hits[0].id;
      if (alreadyExact.has(id)) continue; /* the read answer beats the inferred one */
      if (!found.has(id)) found.set(id, url.slice(ORIGIN.length));
    }
    say(`- Read **${rows.length}** XML rows and matched **${found.size}** further storms by name or number.`);
    say(`- **${dropped.length}** rows could not be attached to exactly one storm and were dropped.`);
    for (const [word, n] of unmapped) {
      say(`- > **${n} rows carry the basin word \`${word}\`, which this job does not map.**`);
      say('  > That is not a skip, it is a hole — add it to `BASIN_OF` or say why not.');
    }
    return { found, dropped, unmapped };
  })();
}

/* --------------------------------------------------------------------------
 * VERIFY, JUDGE, WRITE
 * ----------------------------------------------------------------------- */

async function verify(entries, label) {
  const list = [...entries];
  if (!list.length) return { ok: 0, of: 0, bad: [] };
  const step = Math.max(1, Math.floor(list.length / VERIFY_PER_ROAD));
  const sample = [];
  for (let i = 0; i < list.length && sample.length < VERIFY_PER_ROAD; i += step) sample.push(list[i]);

  let ok = 0;
  const bad = [];
  for (const [id, rel] of sample) {
    const r = await get(ORIGIN + rel, { method: 'HEAD' });
    if (r.http === 200) ok++;
    else bad.push(`${id} → HTTP ${r.http ?? 'no reply'}`);
    await sleep(PACE_MS);
  }
  say(`- **${label}: ${ok} of ${sample.length}** sampled links returned 200.`);
  for (const b of bad) say(`  - did not resolve: ${b}`);
  return { ok, of: sample.length, bad };
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });

  const storms = ourStorms();
  const known = new Set(storms.map((s) => s.id));
  say(`# NHC report index`);
  say('');
  say(`Built ${new Date().toISOString()} against **${storms.length}** storms in \`seasons/data/\`.`);
  say('');

  const exact = await fromHtml(known);
  const { found: named, dropped, unmapped } = await fromXml(storms, exact);

  const reports = {};
  for (const [id, rel] of exact) reports[id] = { u: rel, via: 'id' };
  for (const [id, rel] of named) reports[id] = { u: rel, via: 'name' };

  const total = Object.keys(reports).length;
  const years = Object.keys(reports).map((id) => Number(id.slice(4, 8)));
  const earliest = years.length ? Math.min(...years) : null;

  say('');
  say(`**${total} storms of ${storms.length} have a written report — `
    + `${(100 * total / storms.length).toFixed(1)}%. Earliest: ${earliest ?? 'none'}.**`);
  say('');

  const vExact = await verify(exact, 'Read from a filename');
  const vNamed = await verify(named, 'Matched by name or number');

  /* ==> THE REFUSAL. <== Fewer entries than the file we would replace means
   * something broke — NOAA restructured, or our reader stopped understanding
   * them — and a silent replacement empties the report links with no symptom
   * until somebody opens a storm. */
  let previous = 0;
  if (existsSync(OUT_FILE)) {
    try { previous = Object.keys(JSON.parse(readFileSync(OUT_FILE, 'utf8')).reports || {}).length; } catch { previous = 0; }
  }

  let decision = 'commit';
  let reason = '';
  if (total < previous) {
    decision = 'fail';
    reason = `this run found ${total} reports where the file on disk has ${previous}`;
  } else if (vExact.of && vExact.ok === 0) {
    decision = 'fail';
    reason = 'not one sampled exact link resolved — the pages have moved or changed shape';
  } else if (vNamed.of && vNamed.ok / vNamed.of < 0.8) {
    decision = 'fail';
    reason = `only ${vNamed.ok} of ${vNamed.of} name-matched links resolved — the matching is producing bad urls`;
  } else if (unmapped && unmapped.size) {
    /* ==> AN UNMAPPED BASIN WORD FAILS THE RUN RATHER THAN SHRINKING THE
     * INDEX. <== This is the exact fault that lost 508 Pacific rows on the
     * first draft, and its symptom was nothing at all: a smaller index that
     * still looked healthy. Loud is the only safe direction. */
    decision = 'fail';
    reason = `NOAA used a basin word this job does not map: ${[...unmapped.keys()].join(', ')}`;
  }

  if (decision === 'fail') {
    say('');
    say(`> **REFUSED: ${reason}.** Nothing was written. The file already in the`);
    say('> repo is left exactly as it was, which is the loud direction — either');
    say('> NOAA changed something or our reader did, and both are worse than a');
    say('> month with no update.');
    writeFileSync(join(REPORT_DIR, 'decision.txt'), 'fail\n');
    writeFileSync(join(REPORT_DIR, 'summary.md'), `${notes.join('\n')}\n`);
    console.error(notes.join('\n'));
    process.exit(1);
  }

  const before = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf8') : '';
  const payload = `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    source: 'nhc.noaa.gov/data/tcr + TCR_StormReportsIndex.xml',
    storms: storms.length,
    reports,
  }, null, 0)}\n`;

  if (payload.replace(/"generatedAt":"[^"]*",/, '') === before.replace(/"generatedAt":"[^"]*",/, '')) {
    say('');
    say('> Nothing moved — the index is identical to the one already in the repo,');
    say('> so no commit. A monthly commit on no new information would fire a');
    say('> Pages build and churn every reader\u2019s service worker for nothing.');
    writeFileSync(join(REPORT_DIR, 'decision.txt'), 'skip\n');
    writeFileSync(join(REPORT_DIR, 'summary.md'), `${notes.join('\n')}\n`);
    console.log(notes.join('\n'));
    return;
  }

  mkdirSync(join(ROOT, 'seasons'), { recursive: true });
  writeFileSync(OUT_FILE, payload);
  say('');
  say(`Wrote \`seasons/reports.json\` — ${(payload.length / 1024).toFixed(1)} KB.`);
  if (dropped.length) {
    say('');
    say('Rows that could not be attached to exactly one storm:');
    for (const d of dropped.slice(0, 25)) {
      say(`- ${d.year} ${d.basin} \u201C${d.raw}\u201D — ${d.candidates} candidates`);
    }
    if (dropped.length > 25) say(`- \u2026and ${dropped.length - 25} more`);
  }

  writeFileSync(join(REPORT_DIR, 'decision.txt'), 'commit\n');
  writeFileSync(join(REPORT_DIR, 'commit-message.txt'),
    `The written reports NOAA has for ${total} storms, back to ${earliest}\n\n`
    + `Read from NHC's per-season pages (exact, by storm id) and from\n`
    + `TCR_StormReportsIndex.xml (by name or number, only where exactly one\n`
    + `storm in that season and basin can answer to it).\n\n`
    + `${dropped.length} XML rows could not be attached to one storm and were\n`
    + `dropped rather than guessed at.\n`);
  writeFileSync(join(REPORT_DIR, 'summary.md'), `${notes.join('\n')}\n`);
  console.log(notes.join('\n'));
}

main().catch((err) => {
  say('');
  say(`> **THE GENERATOR FAILED:** \`${String(err?.message || err)}\``);
  try {
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(join(REPORT_DIR, 'decision.txt'), 'fail\n');
    writeFileSync(join(REPORT_DIR, 'summary.md'), `${notes.join('\n')}\n`);
  } catch { /* nothing left to do */ }
  console.error(err);
  process.exit(1);
});
