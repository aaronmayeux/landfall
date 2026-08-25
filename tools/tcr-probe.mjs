/**
 * tcr-probe.mjs — measure NHC's Tropical Cyclone Report archive before step 7
 * links to a single one of them.
 *
 * ==> WHY IT EXISTS. <== `SPEC-SEASONS-BUILD.md` §57.22 asks the archive's
 * detail panel for *"a link to NHC's written report where one exists"*, and
 * three things about that sentence are unmeasured: what the URL actually is,
 * which storms have one, and what a missing one returns. A session reaches
 * GitHub and npm and nothing else, so none of them can be answered from
 * inside one. This runs on an Actions runner, which has open internet.
 *
 * ==> AND GETTING IT WRONG IS WORSE HERE THAN ALMOST ANYWHERE ELSE IN THE APP.
 * <== A guessed URL pattern ships dead links into a panel whose entire job is
 * historical accuracy — and it fails SILENTLY, because a link looks identical
 * whether it resolves or not. §5's rule about silence applies to a hyperlink
 * exactly as it does to a feed. **"Where one exists" is the hard half**: a
 * link offered on a storm that has no report is a promise the archive cannot
 * keep, and offering none on a storm that HAS one quietly hides the best
 * source about it.
 *
 * ==> NOTHING HERE GUESSES A URL. <== Same rule as `seasons-probe.mjs`, and
 * the same reason: a hardcoded filename is a 404 that reads as "the report is
 * gone" instead of "we made the name up". Every report is reached by fetching
 * a DIRECTORY or an INDEX and reading what is in it. The one deliberate
 * exception is Q4, which asks a KNOWN-BAD url on purpose to see the shape of a
 * miss — and it is labelled as such.
 *
 * ==> IT CROSS-REFERENCES AGAINST OUR OWN MIRRORED HISTORY, NOT AGAINST A
 * GUESS AT HOW MANY STORMS THERE WERE. <== Coverage is only meaningful as a
 * fraction, and `seasons/data/` already holds every HURDAT2 season. The runner
 * has the repo checked out, so the denominator is real.
 *
 * ==> WHAT IT WRITES. <==
 *   manifest.json   every request: status, HTTP, bytes, ms, every response
 *                   header. Headers are the half nothing else can show us.
 *   findings.md     the derived answers, written to be read on a phone
 *   raw/...         exact bytes, unmodified, so a later session can re-derive
 *
 * ==> IT IS A ONE-SHOT SURVEY AND IT IS NOT PART OF THE HOURLY ARCHIVE. <==
 * `archive-fetch.mjs` snapshots feeds the app already uses, forever. This
 * answers a question and is then deleted. Nothing in the app imports it.
 *
 * Zero dependencies. Plain node, plain fetch. Run:
 *     node tools/tcr-probe.mjs /tmp/tcr
 */

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/* Naming ourselves is the polite thing and makes us identifiable in NOAA's
 * logs if a sweep ever looks like abuse. Same string the other probes use. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app, andy@getgravitate.app)';

const TIMEOUT_MS = 45_000;

/** How much of a large text file to keep. Enough to see the shape, small
 *  enough that the results branch stays readable on a phone. */
const SAMPLE_BYTES = 256 * 1024;

/** ==> A PACE, BECAUSE THIS ASKS NOAA FOR A LOT OF SMALL THINGS. <== The
 *  coverage question needs a HEAD per sampled report. Politeness is not
 *  optional when the alternative is being mistaken for a scraper by the agency
 *  whose data this whole feature is built on. */
const PACE_MS = 350;

/** How many reports to verify by HEAD. The index tells us what NHC CLAIMS
 *  exists; a sample tells us whether those claims resolve. Spread across the
 *  whole range rather than taken from the top, because the interesting failure
 *  is an old entry pointing at a file that moved. */
const HEAD_SAMPLE = 40;

/** ==> HOW MANY PER-SEASON PAGES TO FOLLOW. <== The index is a grid of
 *  season-and-basin pages, roughly 35 years by 3 basins. Following all of them
 *  at the pace above is ~40 seconds of requests, which is fine — but the cap
 *  exists so a restructured index that suddenly links a thousand pages cannot
 *  turn a decision aid into a crawl of NOAA's site. When the cap bites, the
 *  findings say so and call the coverage a FLOOR rather than a total. */
const MAX_SEASON_PAGES = 120;

const OUT = process.argv[2] || '/tmp/tcr';
const RAW = join(OUT, 'raw');

const manifest = {
  probedAt: new Date().toISOString(),
  runner: 'github-actions',
  requests: [],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function save(rel, data) {
  const p = join(RAW, rel);
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, data);
}

/**
 * One request, fully recorded.
 *
 * ==> A 404 IS AN ANSWER, NOT A FAILURE. <== It is how "no report was ever
 * written for this storm" arrives, and collapsing it into `unavailable` would
 * destroy the exact distinction this probe exists to draw. `status` is
 * `answered` for anything the server actually replied to, whatever the code;
 * `unavailable` means we never got a reply at all.
 */
async function grab(name, url, note, { method = 'GET', maxBytes = null } = {}) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const rec = {
    name, url, method, note,
    status: 'unavailable', http: null, httpText: '',
    bytes: 0, contentLength: null, contentType: null,
    truncated: false, ms: 0, headers: {}, reason: null,
  };
  let body = null;
  try {
    const r = await fetch(url, {
      method,
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    rec.status = 'answered';
    rec.http = r.status;
    rec.httpText = r.statusText || '';
    rec.finalUrl = r.url !== url ? r.url : null;
    for (const [k, v] of r.headers) rec.headers[k] = v;
    rec.contentType = r.headers.get('content-type');
    const declared = r.headers.get('content-length');
    rec.contentLength = declared == null ? null : Number(declared);

    if (method === 'HEAD') {
      rec.bytes = 0;
    } else {
      const buf = Buffer.from(await r.arrayBuffer());
      rec.bytes = buf.length;
      if (maxBytes != null && buf.length > maxBytes) {
        body = buf.subarray(0, maxBytes).toString('utf8');
        rec.truncated = true;
      } else {
        body = buf.toString('utf8');
      }
    }
  } catch (err) {
    rec.reason = String(err?.message || err);
  } finally {
    clearTimeout(timer);
    rec.ms = Date.now() - started;
    manifest.requests.push(rec);
  }
  return { rec, body };
}

/* --------------------------------------------------------------------------
 * OUR OWN HISTORY — the denominator
 * ----------------------------------------------------------------------- */

/**
 * Every real storm we hold, as `{ id, name, year, basin }`.
 *
 * Read straight off `seasons/data/` headers rather than through
 * `lib/hurdat.js`, deliberately: this file must keep running if the parser
 * changes, and all it needs is the first field of each header row. A probe
 * that shares a dependency with the thing it is measuring against can agree
 * with it while both are wrong.
 */
async function ourStorms(root) {
  const dir = join(root, 'seasons', 'data');
  const out = [];
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => /^(atlantic|epacific)-\d{4}-/.test(f));
  } catch (err) {
    return { storms: out, error: String(err?.message || err) };
  }
  for (const f of files) {
    const text = await readFile(join(dir, f), 'utf8');
    for (const line of text.split('\n')) {
      const m = /^([A-Z]{2}\d{6}),\s*([^,]*),/.exec(line);
      if (!m) continue;
      const id = m[1];
      const num = Number(id.slice(2, 4));
      /* 90-99 are invests and 80-89 are test systems — §57.13. */
      if (num < 1 || num > 79) continue;
      out.push({ id, name: m[2].trim().toUpperCase(), year: Number(id.slice(4, 8)), basin: id.slice(0, 2) });
    }
  }
  return { storms: out, error: null };
}

/* --------------------------------------------------------------------------
 * READING AN INDEX
 * ----------------------------------------------------------------------- */

/** Every href in a page, absolute. Blunt on purpose — an HTML parser is a
 *  dependency and this only needs the links. */
function hrefs(html, base) {
  const out = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try { out.push(new URL(m[1], base).href); } catch { /* a malformed href is not a finding */ }
  }
  return out;
}

/**
 * Pull a storm identity out of a report filename, WITHOUT assuming the layout.
 *
 * The shape NHC appears to use is `AL122005_Katrina.pdf`. This does not assume
 * that — it looks for an ATCF-shaped id anywhere in the name and reports what
 * came with it. Anything that yields no id is kept as an EXCEPTION rather than
 * dropped, because the exceptions are the finding: they are what would break a
 * pattern built from the majority.
 */
function identify(url) {
  const file = decodeURIComponent(url.split('/').pop() || '');
  const m = /([A-Z]{2})(\d{2})(\d{4})/i.exec(file);
  if (!m) return { file, url, id: null };
  const id = `${m[1].toUpperCase()}${m[2]}${m[3]}`;
  const rest = file.replace(m[0], '').replace(/\.[a-z0-9]+$/i, '').replace(/^[_\-\s]+/, '');
  return { file, url, id, basin: m[1].toUpperCase(), number: Number(m[2]), year: Number(m[3]), tail: rest };
}

/* --------------------------------------------------------------------------
 * THE RUN
 * ----------------------------------------------------------------------- */

const findings = [];
const say = (s = '') => findings.push(s);

async function main() {
  const root = process.env.GITHUB_WORKSPACE || process.cwd();
  await mkdir(RAW, { recursive: true });

  const { storms, error: stormsError } = await ourStorms(root);
  const byId = new Map(storms.map((s) => [s.id, s]));

  say('# NHC Tropical Cyclone Reports — what is actually there');
  say('');
  say(`Probed ${manifest.probedAt} on a GitHub Actions runner.`);
  say('');
  say('**This answers one question and it gates §57.22 / step 7:** can the');
  say("archive's detail panel offer a link to NHC's written report, and can it");
  say('tell which storms have one? A guessed URL ships dead links into a panel');
  say('about historical accuracy, and it fails silently.');
  say('');
  if (stormsError) {
    say(`> **The repo\'s own history could not be read** (\`${stormsError}\`), so`);
    say('> every coverage figure below is missing its denominator.');
    say('');
  } else {
    say(`Denominator: **${storms.length} real storms** across both HURDAT2 basins`);
    say('in `seasons/data/`.');
    say('');
  }

  /* ---- Q1: is there an index at all, and is any of it machine-readable? --- */

  say('## Q1 — Is there an index, and is any of it machine-readable?');
  say('');

  const candidates = [
    ['tcr-index', 'https://www.nhc.noaa.gov/data/tcr/index.php', "NHC's own report index page"],
    /* ==> THE XML IS AT THE SITE ROOT, AND THE FIRST RUN OF THIS PROBE LOOKED
     * IN THE WRONG PLACE. <== It asked for `/data/tcr/TCR_StormReportsIndex.xml`
     * — the one URL in this file that was GUESSED rather than read — and got a
     * clean 404, which findings.md duly reported as "no machine-readable index".
     * The index page's own markup links it at `/TCR_StormReportsIndex.xml`.
     *
     * That is the fault this file's header warns about, committed by this file,
     * and it is worth leaving written down: **a guessed URL's 404 is
     * indistinguishable from an absence**, and the only reason it was caught is
     * that the probe saved the raw bytes for a human to read afterwards. */
    ['tcr-xml', 'https://www.nhc.noaa.gov/TCR_StormReportsIndex.xml',
      'the machine-readable index, at the path the index page itself links'],
  ];

  const pages = new Map();
  for (const [name, url, note] of candidates) {
    const { rec, body } = await grab(name, url, note, { maxBytes: SAMPLE_BYTES });
    if (body != null) {
      await save(`${name}.txt`, body);
      pages.set(name, body);
    }
    const size = rec.contentLength != null ? `${rec.contentLength} bytes` : `${rec.bytes} bytes read`;
    say(`- \`${url}\` → **HTTP ${rec.http ?? 'no reply'}**`
      + `${rec.reason ? ` (${rec.reason})` : ''}, ${size}, \`${rec.contentType || 'no content-type'}\``
      + `${rec.truncated ? ' — TRUNCATED in raw/' : ''}`);
    await sleep(PACE_MS);
  }
  say('');
  say('> If the XML resolves it is a far better source than scraping a page NHC');
  say('> may restyle at any time. **The first run of this probe reported it');
  say('> missing and was wrong** — it guessed the path. The index page links it');
  say('> at the site root, and that is where it is asked for now.');
  say('');

  /* ---- The index is per season AND per basin, which the first run missed too.
   * The top-level page carries no report links at all — only navigation and a
   * grid of `index.php?season=YYYY&basin=xxx`. Following those is the only way
   * to see what is actually published. */
  const seasonLinks = new Set();
  for (const [name, body] of pages) {
    const base = candidates.find((c) => c[0] === name)[1];
    for (const u of hrefs(body, base)) {
      if (/index\.php\?season=\d{4}&basin=[a-z]+/i.test(u)) seasonLinks.add(u);
    }
  }
  say(`The top-level page carries **no report links at all** — it is navigation`);
  say(`plus a grid of **${seasonLinks.size}** per-season, per-basin pages. Those`);
  say('are where the reports live, so the probe follows them.');
  say('');

  /* Newest first: coverage questions are answered fastest from the end where
   * reports certainly exist, and if the pace budget runs out mid-sweep the
   * partial answer is still the useful half. */
  const ordered = [...seasonLinks].sort().reverse();
  let followed = 0;
  for (const u of ordered) {
    if (followed >= MAX_SEASON_PAGES) break;
    const key = `season-${u.split('?')[1].replace(/[^a-z0-9]+/gi, '-')}`;
    const { body } = await grab(key, u, 'one season and basin of reports', { maxBytes: SAMPLE_BYTES });
    if (body != null) {
      pages.set(key, body);
      await save(`${key}.txt`, body);
    }
    followed++;
    await sleep(PACE_MS);
  }
  say(`Followed **${followed}** of them${followed < ordered.length
    ? ` (capped at ${MAX_SEASON_PAGES}; ${ordered.length - followed} not visited, so`
      + ' the coverage figures below are a FLOOR rather than a total)' : ''}.`);
  say('');

  /* ---- Q2: what is actually linked, and what is the filename pattern? ----- */

  say('## Q2 — What is linked, and does one filename pattern cover it?');
  say('');

  const all = new Map(); // url -> identity
  for (const [name, body] of pages) {
    /* Season pages are keyed by their query string, not by a candidate name, so
     * the base falls back to the index page they were all reached from — same
     * origin and same directory, which is all `new URL` needs. */
    const base = candidates.find((c) => c[0] === name)?.[1]
      || 'https://www.nhc.noaa.gov/data/tcr/index.php';
    for (const u of hrefs(body, base)) {
      if (!/\.(pdf|shtml?|html?)$/i.test(u)) continue;
      if (!/nhc\.noaa\.gov/i.test(u)) continue;
      if (!all.has(u)) all.set(u, identify(u));
    }
  }

  const identified = [...all.values()].filter((x) => x.id);
  const exceptions = [...all.values()].filter((x) => !x.id);

  say(`- **${all.size}** report-shaped links found across those pages.`);
  say(`- **${identified.length}** carry an ATCF-shaped storm id in the filename.`);
  say(`- **${exceptions.length}** do not — these are the ones that would break a`);
  say('  pattern built from the majority, so they are listed in full below.');
  say('');

  if (identified.length) {
    /* Does the tail after the id actually equal the storm's name? That is the
     * difference between a URL we can BUILD from an id and one we can only
     * LOOK UP — and it decides whether step 7 needs to ship an index. */
    let tailMatches = 0;
    let tailDiffers = 0;
    const tailExamples = [];
    for (const x of identified) {
      const ours = byId.get(x.id);
      if (!ours) continue;
      const a = (x.tail || '').replace(/[^A-Z]/gi, '').toUpperCase();
      const b = (ours.name || '').replace(/[^A-Z]/gi, '').toUpperCase();
      if (a && b && a === b) tailMatches++;
      else {
        tailDiffers++;
        if (tailExamples.length < 12) tailExamples.push(`\`${x.file}\` — we hold that id as **${ours.name || 'UNNAMED'}**`);
      }
    }
    say('### Can a URL be BUILT from a storm id, or must it be LOOKED UP?');
    say('');
    say('This is the question that decides whether step 7 has to ship an index');
    say('file. If the tail after the id is always the storm name we already');
    say('hold, the panel can construct the link. If not, it cannot — and a');
    say('constructed link that 404s is the silent failure this probe exists for.');
    say('');
    say(`- tail equals the name we hold: **${tailMatches}**`);
    say(`- tail differs: **${tailDiffers}**`);
    if (tailExamples.length) {
      say('');
      say('Where it differs:');
      for (const e of tailExamples) say(`  - ${e}`);
    }
    say('');

    const exts = {};
    for (const x of identified) {
      const e = (x.file.match(/\.([a-z0-9]+)$/i) || [, '?'])[1].toLowerCase();
      exts[e] = (exts[e] || 0) + 1;
    }
    say(`File types: ${Object.entries(exts).map(([e, n]) => `\`.${e}\` ×${n}`).join(', ')}`);
    say('');
  }

  if (exceptions.length) {
    say('### The exceptions, in full');
    say('');
    for (const x of exceptions.slice(0, 60)) say(`- \`${x.file}\``);
    if (exceptions.length > 60) say(`- …and ${exceptions.length - 60} more (see \`manifest.json\`)`);
    say('');
  }

  /* ---- Q3: coverage against our own history ------------------------------ */

  say('## Q3 — Which storms have one?');
  say('');

  if (!stormsError && identified.length) {
    const haveReport = new Set(identified.map((x) => x.id));
    const years = [...new Set(storms.map((s) => s.year))].sort((a, b) => a - b);
    let firstYear = null;
    const rows = [];
    for (const y of years) {
      const ours = storms.filter((s) => s.year === y);
      const hit = ours.filter((s) => haveReport.has(s.id)).length;
      if (hit > 0 && firstYear == null) firstYear = y;
      if (hit > 0) rows.push({ y, hit, of: ours.length });
    }
    const covered = storms.filter((s) => haveReport.has(s.id)).length;

    say(`- **${covered} of ${storms.length}** storms we hold have a report linked`);
    say(`  from the pages above — **${(100 * covered / storms.length).toFixed(1)}%**.`);
    say(`- Earliest year with any report: **${firstYear ?? 'none found'}**.`);
    say('');
    say('> ==> A LOW NUMBER HERE IS NOT NECESSARILY THE TRUTH ABOUT NHC. <== It');
    say('> may be the truth about the INDEX — a page that only lists recent');
    say('> years, or paginates. Compare the earliest year above against Q1: if');
    say('> the index is a single page and it stops, that is a real cliff. If it');
    say('> links to per-year pages, this probe has only read the top level and');
    say('> a second pass should follow them.');
    say('');
    if (rows.length) {
      say('| Year | Reports | Storms |');
      say('|---:|---:|---:|');
      for (const r of rows.slice(-40)) say(`| ${r.y} | ${r.hit} | ${r.of} |`);
      if (rows.length > 40) say('');
      if (rows.length > 40) say(`*(showing the last 40 of ${rows.length} years with any report)*`);
      say('');
    }
  } else {
    say('_Not derivable — see Q1 and Q2._');
    say('');
  }

  /* ---- Q4: do the links resolve, and what does a miss look like? --------- */

  say('## Q4 — Do those links resolve, and what does a MISS look like?');
  say('');
  say('An index entry is a claim. These are HEAD requests against a spread of');
  say('them — spread rather than taken from the top, because the interesting');
  say('failure is an old entry pointing at a file that has since moved.');
  say('');

  const sample = [];
  if (identified.length) {
    const step = Math.max(1, Math.floor(identified.length / HEAD_SAMPLE));
    for (let i = 0; i < identified.length && sample.length < HEAD_SAMPLE; i += step) sample.push(identified[i]);
  }

  let okCount = 0;
  const badOnes = [];
  const sizes = [];
  for (const x of sample) {
    const { rec } = await grab(`head:${x.file}`, x.url, 'does this index entry resolve', { method: 'HEAD' });
    if (rec.http === 200) {
      okCount++;
      if (rec.contentLength) sizes.push(rec.contentLength);
    } else {
      badOnes.push(`\`${x.file}\` → HTTP ${rec.http ?? 'no reply'}${rec.reason ? ` (${rec.reason})` : ''}`);
    }
    await sleep(PACE_MS);
  }
  say(`- **${okCount} of ${sample.length}** sampled links returned HTTP 200.`);
  if (sizes.length) {
    sizes.sort((a, b) => a - b);
    const mb = (n) => (n / 1024 / 1024).toFixed(2);
    say(`- Report size: **${mb(sizes[0])} MB** smallest, **${mb(sizes[Math.floor(sizes.length / 2)])} MB** median, **${mb(sizes[sizes.length - 1])} MB** largest.`);
    say('  *(Relevant because §57.22 only wants to LINK to these — but if a later')
    say('  pass ever considers mirroring one, this is the number.)*');
  }
  if (badOnes.length) {
    say('- **Entries that did not resolve:**');
    for (const b of badOnes) say(`  - ${b}`);
  }
  say('');

  /* ==> THE ONE DELIBERATE GUESS IN THIS FILE, AND IT IS GUESSING ON PURPOSE.
   * <== Everything above reads what NHC published. This asks for a report that
   * cannot exist — a real 19th-century storm id, from an era with no reports —
   * to see what the server does with a miss. If it 404s, a constructed link
   * can be verified. If it 200s with a friendly "not found" page, it cannot,
   * and step 7 must not construct links at all. */
  const bogus = 'https://www.nhc.noaa.gov/data/tcr/AL011851_Unnamed.pdf';
  const { rec: missRec } = await grab('deliberate-miss', bogus,
    'A REPORT THAT CANNOT EXIST — asked for on purpose to see the shape of a miss');
  say(`**A report that cannot exist** (\`${bogus.split('/').pop()}\`, an 1851 storm):`);
  say(`HTTP **${missRec.http ?? 'no reply'}**, \`${missRec.contentType || 'no content-type'}\`, ${missRec.bytes} bytes.`);
  say('');
  say('> This decides whether a link may be CONSTRUCTED at all. A clean 404');
  say('> means a miss is detectable. A 200 carrying a friendly error page means');
  say("> it is not, and step 7 must only ever link to something it read out of");
  say('> an index.');
  say('');

  /* ---- Q5: the JTWC b-deck question, folded in ---------------------------- */

  say('## Q5 — Does JTWC publish live ATCF b-decks? *(secondary)*');
  say('');
  say('`NOW.md` has carried this as "a small addition to the next probe run"');
  say('twice. If JTWC publishes b-decks the way NHC does, the rest-of-world');
  say('capture gets a better source than our own relay output.');
  say('');
  say('> ==> THESE ARE CANDIDATES, NOT KNOWN URLS, AND THAT MATTERS FOR HOW THE');
  say('> RESULT IS READ. <== Unlike everything above, nothing here was');
  say('> discovered by listing a directory — nobody knows where JTWC would put');
  say('> these. **A 404 below means "this candidate did not answer", never');
  say('> "JTWC has no b-decks."** A hit is real evidence; a miss is not.');
  say('');
  const jtwc = [
    ['jtwc-root', 'https://www.metoc.navy.mil/jtwc/jtwc.html', 'the public product page'],
    ['jtwc-products', 'https://www.metoc.navy.mil/jtwc/products/', 'the product directory, if it lists'],
    ['nrl-atcf', 'https://www.nrlmry.navy.mil/atcf_web/docs/', 'the ATCF documentation area'],
  ];
  for (const [name, url, note] of jtwc) {
    const { rec, body } = await grab(name, url, note, { maxBytes: SAMPLE_BYTES });
    if (body != null) await save(`${name}.txt`, body);
    let bdeckHint = '';
    if (body) {
      const hits = (body.match(/b[a-z]{2}\d{6}\.(dat|txt)/gi) || []).slice(0, 5);
      bdeckHint = hits.length ? ` — **b-deck-shaped filenames present**: ${hits.join(', ')}` : ' — no b-deck-shaped filename in the body';
    }
    say(`- \`${url}\` → HTTP ${rec.http ?? 'no reply'}${rec.reason ? ` (${rec.reason})` : ''}${bdeckHint}`);
    await sleep(PACE_MS);
  }
  say('');

  /* ---- what to do with this --------------------------------------------- */

  say('## What this decides');
  say('');
  say('1. **If the tail is always the name we hold and a miss is a clean 404** —');
  say('   step 7 can construct the link from the storm id and verify it. Cheapest');
  say('   outcome.');
  say('2. **If the tails differ or a miss returns 200** — the link must come from');
  say('   an index, which means shipping one. That is a real cost and it changes');
  say('   the shape of step 7.');
  say('3. **If coverage starts at a recent year** — §57.25 rule 2 applies and the');
  say('   panel says why there is no report, rather than showing nothing.');
  say('');
  say('Raw bytes are in `raw/`; every response header is in `manifest.json`.');

  await writeFile(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(OUT, 'findings.md'), `${findings.join('\n')}\n`);
  console.log(findings.join('\n'));
}

/* A probe that throws tells us nothing. Whatever it got so far is written and
 * the exit is clean — a bad upstream is news, not a broken build. */
main().catch(async (err) => {
  say('');
  say(`> **THE PROBE ITSELF FAILED PART WAY THROUGH:** \`${String(err?.message || err)}\``);
  say('> Everything above this line was still measured. Everything below it was not run.');
  try {
    await writeFile(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(OUT, 'findings.md'), `${findings.join('\n')}\n`);
  } catch { /* nothing left to do about it */ }
  console.error(err);
});
