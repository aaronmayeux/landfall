/**
 * seasons-probe.mjs — STEP 0 OF §57.30. Measure NOAA's own files before a line
 * of the Seasons parser is written.
 *
 * ==> WHY IT EXISTS. <==
 * `SPEC-SEASONS-BUILD.md` §57.31 lists five things as ASSUMED rather than read:
 * the ATCF b-deck line layout, what is really in the current-season directory,
 * how far back NHC's advisory archive reaches, whether HURDAT2 matches §57.4,
 * and how big IBTrACS is. A session reaches GitHub and npm and nothing else, so
 * none of them can be answered from inside one. This runs on an Actions runner,
 * which has open internet.
 *
 * ==> WHY IT IS NOT PART OF THE HOURLY ARCHIVE. <==
 * `archive-fetch.mjs` snapshots feeds the app ALREADY uses, every hour, forever.
 * This is a one-shot survey of files we are still deciding about. It runs when
 * the branch moves and not otherwise, and it is deleted once §57.31 is closed.
 * Nothing in the app imports it.
 *
 * ==> WHAT IT WRITES. <==
 *   manifest.json   every request: status, HTTP, bytes, ms, and every response
 *                   header. Headers are the half nothing else can show us.
 *   findings.md     the derived answers, written to be pasted into the spec
 *   raw/...         exact bytes, unmodified. Big files are TRUNCATED and say so
 *
 * ==> SIZE IS MEASURED WITHOUT DOWNLOADING. <== IBTrACS may be hundreds of
 * megabytes and the question about it is only "does it fit under Cloudflare's
 * 25 MiB per-file cap" (§57.33 limit 3). A HEAD request answers that for free.
 * Downloading it to find out would be a rude thing to do to NOAA's server and
 * would tell us nothing extra.
 *
 * ==> NOTHING HERE GUESSES A URL. <== Every file is reached by fetching a
 * DIRECTORY and reading what is in it. A hardcoded HURDAT2 filename carries a
 * revision date that changes every February, so a guessed one is a 404 that
 * reads as "the file is gone" instead of "we made the name up".
 *
 * Zero dependencies. Plain node, plain fetch. Run:
 *     node tools/seasons-probe.mjs /tmp/seasons
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/* NOAA does not refuse anonymous clients the way NWS does, but naming
 * ourselves is the polite thing and makes us identifiable in their logs if a
 * sweep ever looks like abuse. Same string rain-probe.mjs uses. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app, andy@getgravitate.app)';

/** A source that has not answered in this long is reported as a timeout rather
 *  than hanging the run. Generous — NOAA's FTP-over-HTTPS is not fast. */
const TIMEOUT_MS = 45_000;

/** How much of a large text file to keep. Enough to see the shape of every
 *  record type, small enough that the results branch stays readable. */
const SAMPLE_BYTES = 96 * 1024;

/** Cloudflare Pages refuses any single file above this (§57.33 limit 3). The
 *  whole IBTrACS question is whether it clears this number. */
const PAGES_FILE_CAP = 25 * 1024 * 1024;

/* --------------------------------------------------------------------------
 * FETCH PLUMBING
 * ----------------------------------------------------------------------- */

const manifest = {
  probedAt: new Date().toISOString(),
  runner: 'github-actions',
  pagesFileCapBytes: PAGES_FILE_CAP,
  requests: [],
};

const OUT = process.argv[2] || '/tmp/seasons';
const RAW = join(OUT, 'raw');

async function save(rel, data) {
  const p = join(RAW, rel);
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, data);
}

/**
 * One request, fully recorded.
 *
 * A 404 is an ANSWER, not a failure — it is how "the archive does not go back
 * this far" arrives, and collapsing it into `unavailable` would destroy exactly
 * the distinction this probe exists to draw.
 */
async function grab(name, url, note, { method = 'GET', maxBytes = null } = {}) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const rec = {
    name, url, method, note,
    status: 'unavailable', http: null, httpText: '',
    bytes: 0, contentLength: null, truncated: false, ms: 0, headers: {}, reason: null,
  };
  let body = null;
  try {
    const r = await fetch(url, {
      method,
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      signal: ctrl.signal,
    });
    rec.http = r.status;
    rec.httpText = r.statusText || '';
    for (const [k, v] of r.headers) rec.headers[k] = v;
    const declared = r.headers.get('content-length');
    rec.contentLength = declared == null ? null : Number(declared);

    if (method === 'HEAD') {
      rec.bytes = 0;
    } else if (maxBytes != null && rec.contentLength != null && rec.contentLength > maxBytes) {
      /* KNOWN TO BE BIG BEFORE WE READ IT. Take the first slice by reading the
       * stream and stopping, rather than by asking for a Range — a server that
       * ignores Range would silently hand us the whole thing. */
      const reader = r.body.getReader();
      const chunks = [];
      let got = 0;
      while (got < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        got += value.length;
      }
      try { await reader.cancel(); } catch { /* the point is to stop reading */ }
      body = Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
      rec.bytes = got;
      rec.truncated = true;
    } else {
      const buf = Buffer.from(await r.arrayBuffer());
      rec.bytes = buf.length;
      body = buf.toString('utf8');
      if (maxBytes != null && rec.bytes > maxBytes) {
        body = body.slice(0, maxBytes);
        rec.truncated = true;
      }
    }

    rec.status = r.ok ? 'ok' : (r.status === 404 ? 'not_present' : 'http_error');
    if (!r.ok) rec.reason = `HTTP ${r.status} ${r.statusText}`;
  } catch (e) {
    rec.reason = String(e?.message || e);
  } finally {
    clearTimeout(timer);
    rec.ms = Date.now() - started;
  }
  manifest.requests.push(rec);
  return { rec, body };
}

/** Pull hrefs out of an Apache autoindex page. Deliberately dumb: no HTML
 *  parser, because the only thing we want is the link text. */
function hrefs(html) {
  if (!html) return [];
  const out = [];
  const re = /href="([^"?][^"]*)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

const bytesHuman = (n) =>
  n == null ? 'unknown'
  : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB`
  : n >= 1024 ? `${(n / 1024).toFixed(1)} KB`
  : `${n} B`;

/* --------------------------------------------------------------------------
 * FINDINGS — every probe pushes one block of markdown
 * ----------------------------------------------------------------------- */

const findings = [];
const say = (s) => findings.push(s);

/* --------------------------------------------------------------------------
 * 1 — THE CURRENT-SEASON b-deck DIRECTORY (§57.13, §57.31 item 4)
 * ----------------------------------------------------------------------- */

/** §57.13, verbatim from NHC's own README: 01–30 are real storms, 90–99 are
 *  invests whose numbers are REUSED within a season, 80–89 are internal test
 *  systems that must always be ignored. This function is the filter that rule
 *  describes, and it is here so the probe reports what it would actually keep
 *  rather than what the rule says in prose. */
function classifyBdeck(filename) {
  const m = /^b([a-z]{2})(\d{2})(\d{4})\.dat$/i.exec(filename);
  if (!m) return { filename, kind: 'unrecognised' };
  const [, basin, numStr, year] = m;
  const num = Number(numStr);
  const kind = num >= 1 && num <= 30 ? 'storm'
             : num >= 80 && num <= 89 ? 'test'
             : num >= 90 && num <= 99 ? 'invest'
             : 'out_of_range';
  return { filename, basin: basin.toLowerCase(), number: num, year: Number(year), kind };
}

async function probeBdecks() {
  const { rec, body } = await grab(
    'atcf/btk-index',
    'https://ftp.nhc.noaa.gov/atcf/btk/',
    'The live b-deck directory. §57.3 says this is what HURDAT2 is later built from.',
  );
  await save('atcf/btk-index.html', body ?? '');

  if (rec.status !== 'ok') {
    say(`## 1 — Current-season b-decks\n\n**COULD NOT READ THE DIRECTORY.** \`${rec.reason || rec.status}\`. Everything below about b-decks is unmeasured.\n`);
    return;
  }

  const files = hrefs(body).filter((h) => /\.dat$/i.test(h)).map((h) => h.split('/').pop());
  const classified = files.map(classifyBdeck);
  const byKind = {};
  for (const c of classified) byKind[c.kind] = (byKind[c.kind] || 0) + 1;

  const years = [...new Set(classified.map((c) => c.year).filter(Boolean))].sort();
  const basins = [...new Set(classified.map((c) => c.basin).filter(Boolean))].sort();
  const keep = classified.filter((c) => c.kind === 'storm');

  /* Fetch ONE real storm file whole. The line layout is §57.31 item 4 and the
   * only way to close it is to look at real bytes. Prefer the highest-numbered
   * Atlantic storm — later in the season means more records and a better
   * chance of carrying every optional column. */
  const pick = keep.filter((c) => c.basin === 'al').sort((a, b) => b.number - a.number)[0]
            || keep.sort((a, b) => b.number - a.number)[0]
            || null;

  let layout = '';
  if (pick) {
    const { rec: br, body: bBody } = await grab(
      `atcf/btk/${pick.filename}`,
      `https://ftp.nhc.noaa.gov/atcf/btk/${pick.filename}`,
      'One whole b-deck. §57.31 item 4: the line layout is ASSUMED, not read.',
    );
    await save(`atcf/${pick.filename}`, bBody ?? '');
    if (br.status === 'ok' && bBody) {
      const lines = bBody.split('\n').filter((l) => l.trim());
      const first = lines[0] || '';
      const cols = first.split(',').map((c) => c.trim());
      const widths = lines.map((l) => l.split(',').length);
      const uniqueWidths = [...new Set(widths)].sort((a, b) => a - b);

      layout =
        `### The line layout, read rather than assumed\n\n` +
        `\`${pick.filename}\` — ${lines.length} lines, ${bytesHuman(br.bytes)}.\n\n` +
        `**Comma-separated fields per line: ${uniqueWidths.join(', ')}.** ` +
        (uniqueWidths.length > 1
          ? `**NOT FIXED WIDTH — a parser indexing by column number will break.**\n\n`
          : `Consistent across every line.\n\n`) +
        `First line, one field per row, so the positions can be counted:\n\n` +
        '```\n' +
        cols.map((c, i) => `${String(i).padStart(2, ' ')}  ${c}`).join('\n') +
        '\n```\n\n' +
        `First five lines verbatim:\n\n` +
        '```\n' + lines.slice(0, 5).join('\n') + '\n```\n\n' +
        `Last line verbatim:\n\n` +
        '```\n' + (lines[lines.length - 1] || '') + '\n```\n';
    }
  }

  say(
    `## 1 — Current-season b-decks — MEASURED\n\n` +
    `\`https://ftp.nhc.noaa.gov/atcf/btk/\` holds **${files.length} \`.dat\` files**.\n\n` +
    `| §57.13 class | count |\n|---|---|\n` +
    Object.entries(byKind).map(([k, v]) => `| ${k} | ${v} |`).join('\n') + '\n\n' +
    `Basins present: ${basins.join(', ') || 'none'}. Years present: ${years.join(', ') || 'none'}.\n\n` +
    `**${keep.length} files survive §57.13's filter** (numbers 01–30). ` +
    (byKind.test ? `**${byKind.test} test systems** would have shipped without it. ` : `No test systems in the directory today. `) +
    (byKind.invest ? `**${byKind.invest} invests**, whose numbers are reused within a season.` : `No invests in the directory today.`) +
    `\n\nSurviving files: ${keep.map((c) => c.filename).join(', ') || '(none)'}\n\n` +
    layout,
  );
}

/* --------------------------------------------------------------------------
 * 2 — HURDAT2 (§57.4, §57.6)
 * ----------------------------------------------------------------------- */

async function probeHurdat() {
  const { rec, body } = await grab(
    'hurdat/index',
    'https://www.nhc.noaa.gov/data/hurdat/',
    'The HURDAT2 directory. The filename carries a revision date, so it is READ, never guessed.',
  );
  await save('hurdat/index.html', body ?? '');

  if (rec.status !== 'ok') {
    say(`## 2 — HURDAT2\n\n**COULD NOT READ THE DIRECTORY.** \`${rec.reason || rec.status}\`.\n`);
    return;
  }

  const all = hrefs(body).map((h) => h.split('/').pop()).filter((h) => /^hurdat2.*\.txt$/i.test(h));
  /* Atlantic files are named hurdat2-YYYY-YYYY-*.txt; the Pacific ones carry
   * `nepac` in the name. Anything that matches neither is reported rather than
   * dropped — an unexpected file in this directory is a finding. */
  const atl = all.filter((f) => !/nepac/i.test(f)).sort();
  const pac = all.filter((f) => /nepac/i.test(f)).sort();
  const other = all.filter((f) => !atl.includes(f) && !pac.includes(f));

  let detail = '';
  for (const [label, file] of [['Atlantic', atl[atl.length - 1]], ['E/C Pacific', pac[pac.length - 1]]]) {
    if (!file) { detail += `\n**${label}: no file matched in the directory.**\n`; continue; }
    const url = `https://www.nhc.noaa.gov/data/hurdat/${file}`;
    const { rec: hr, body: hBody } = await grab(
      `hurdat/${file}`, url, `${label} HURDAT2. §57.4's field list is checked against this.`,
      { maxBytes: SAMPLE_BYTES },
    );
    await save(`hurdat/${file}`, hBody ?? '');
    if (hr.status !== 'ok' || !hBody) {
      detail += `\n**${label}: \`${file}\` — ${hr.reason || hr.status}.**\n`;
      continue;
    }

    const lines = hBody.split('\n').filter((l) => l.trim());
    /* A HURDAT2 header line is three fields; a data line is twenty-one. That
     * is the §57.4 claim, and this counts it rather than restating it. */
    const headerLines = lines.filter((l) => l.split(',').length <= 4);
    const dataLines = lines.filter((l) => l.split(',').length > 4);
    const dataWidths = [...new Set(dataLines.map((l) => l.split(',').length))].sort((a, b) => a - b);
    const sentinels = {
      '-999': hBody.split('-999').length - 1,
      '-99': (hBody.match(/(?<![\d-])-99(?![\d])/g) || []).length,
    };
    const statuses = [...new Set(dataLines.map((l) => (l.split(',')[3] || '').trim()))].sort();

    detail +=
      `\n### ${label} — \`${file}\`\n\n` +
      `Declared size **${bytesHuman(hr.contentLength)}**` +
      (hr.truncated ? ` (first ${bytesHuman(hr.bytes)} sampled)` : '') + `.\n\n` +
      `In the sample: ${headerLines.length} header lines, ${dataLines.length} data lines. ` +
      `**Data fields per line: ${dataWidths.join(', ')}** ` +
      (dataWidths.length === 1 ? `— consistent.` : `— **NOT consistent.**`) + `\n\n` +
      `Status codes seen: ${statuses.map((s) => `\`${s}\``).join(', ')}. ` +
      `§57.4 expects TD, TS, HU, EX, SD, SS, LO, WV, DB.\n\n` +
      `Sentinels in the sample: \`-999\` × ${sentinels['-999']}, \`-99\` × ${sentinels['-99']}.\n\n` +
      `First header and its first two data lines, verbatim:\n\n` +
      '```\n' + lines.slice(0, 3).join('\n') + '\n```\n';
  }

  say(
    `## 2 — HURDAT2 — MEASURED\n\n` +
    `Files in \`/data/hurdat/\`: ${all.length}. Atlantic ${atl.length}, Pacific ${pac.length}` +
    (other.length ? `, **unclassified ${other.length}: ${other.join(', ')}**` : '') + `.\n\n` +
    `Full listing: ${all.join(', ') || '(none)'}\n` +
    detail,
  );
}

/* --------------------------------------------------------------------------
 * 3 — HOW FAR BACK THE ADVISORY ARCHIVE GOES (§57.31 item 5, gates step 11)
 * ----------------------------------------------------------------------- */

/** Probed, not guessed at. Spread wide rather than dense: the question is
 *  where the cliff is, and a wide net finds it in one run. Anchored on years
 *  the shelf will care about — Andrew '92, Katrina '05, Sandy '12 (§57.30
 *  step 11). */
const ARCHIVE_YEARS = [1958, 1969, 1979, 1988, 1992, 1995, 1998, 2000, 2003, 2005,
                       2008, 2012, 2017, 2021, 2024, 2025, 2026];

async function probeArchiveDepth() {
  const rows = [];
  for (const year of ARCHIVE_YEARS) {
    /* TEXT — the written advisories. */
    const { rec: t } = await grab(
      `archive/text/${year}`,
      `https://www.nhc.noaa.gov/archive/${year}/`,
      `Does the written advisory archive reach ${year}?`,
      { method: 'HEAD' },
    );
    /* GIS — the cone, forecast track and watch/warning geometry. §57.10 calls
     * this out separately BECAUSE they do not go back equally far, and a storm
     * with text but no geometry is a different Tier 2 storm entirely. */
    const { rec: g } = await grab(
      `archive/gis/${year}`,
      `https://www.nhc.noaa.gov/gis/archive_forecast.php?year=${year}`,
      `Does the GIS archive reach ${year}?`,
      { method: 'HEAD' },
    );
    /* The ATCF year archive — where the b-decks for a finished season live.
     * Step 3's mirror will read from here, so its depth matters too. */
    const { rec: a } = await grab(
      `archive/atcf/${year}`,
      `https://ftp.nhc.noaa.gov/atcf/archive/${year}/`,
      `Does the ATCF season archive reach ${year}?`,
      { method: 'HEAD' },
    );
    rows.push({ year, text: t.http, gis: g.http, atcf: a.http });
    await new Promise((r) => setTimeout(r, 200)); // pace it; someone else's server
  }

  const firstOk = (key) => {
    const hit = rows.filter((r) => r[key] === 200).sort((a, b) => a.year - b.year)[0];
    return hit ? hit.year : null;
  };

  say(
    `## 3 — How far back the archive goes — MEASURED\n\n` +
    `HTTP status per year. **200 means the year exists; anything else means it does not** ` +
    `(a HEAD on a directory that is not there is a 404).\n\n` +
    `| year | text advisories | GIS | ATCF season |\n|---|---|---|---|\n` +
    rows.map((r) => `| ${r.year} | ${r.text ?? '—'} | ${r.gis ?? '—'} | ${r.atcf ?? '—'} |`).join('\n') +
    `\n\n**Earliest year that answered 200:** text ${firstOk('text') ?? 'none of the probed years'}, ` +
    `GIS ${firstOk('gis') ?? 'none of the probed years'}, ` +
    `ATCF ${firstOk('atcf') ?? 'none of the probed years'}.\n\n` +
    `> **A 200 on a year directory is not proof a given storm is complete in it.** ` +
    `It says the shelf is eligible, which is all step 11 needs to draw up a list. ` +
    `Whether a chosen storm has every advisory is checked when it is captured, in step 12.\n`,
  );
}

/* --------------------------------------------------------------------------
 * 4 — IBTrACS (§57.31 item 3, §57.33 limit 3)
 * ----------------------------------------------------------------------- */

const IBTRACS_DIRS = [
  ['csv', 'https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/'],
  ['netcdf', 'https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/netcdf/'],
];

async function probeIbtracs() {
  let out = `## 4 — IBTrACS — MEASURED\n\n`;
  let anyOk = false;

  for (const [label, url] of IBTRACS_DIRS) {
    const { rec, body } = await grab(
      `ibtracs/index-${label}`, url,
      `IBTrACS ${label} directory. §57.33 limit 3: does any file clear Cloudflare's 25 MiB cap?`,
    );
    await save(`ibtracs/index-${label}.html`, body ?? '');
    if (rec.status !== 'ok') {
      out += `**\`${label}\` directory: ${rec.reason || rec.status}.**\n\n`;
      continue;
    }
    anyOk = true;
    const files = hrefs(body).map((h) => h.split('/').pop())
      .filter((h) => /\.(csv|nc)$/i.test(h));

    /* HEAD every file. This is the whole point — sizes without a download. */
    const sized = [];
    for (const f of files.slice(0, 40)) {
      const { rec: hr } = await grab(`ibtracs/${label}/${f}`, url + f, `Size of ${f}`, { method: 'HEAD' });
      sized.push({ file: f, bytes: hr.contentLength, http: hr.http });
      await new Promise((r) => setTimeout(r, 120));
    }
    sized.sort((a, b) => (b.bytes || 0) - (a.bytes || 0));

    const over = sized.filter((s) => (s.bytes || 0) > PAGES_FILE_CAP);
    out +=
      `### \`${label}\` — ${files.length} files\n\n` +
      `| file | size | over the 25 MiB cap? |\n|---|---|---|\n` +
      sized.slice(0, 20).map((s) =>
        `| ${s.file} | ${bytesHuman(s.bytes)} | ${(s.bytes || 0) > PAGES_FILE_CAP ? '**YES**' : 'no'} |`,
      ).join('\n') +
      (files.length > 20 ? `\n\n*(largest 20 of ${files.length} shown, sorted by size)*` : '') +
      `\n\n**${over.length} of ${sized.length} measured files exceed the cap.**\n\n`;
  }

  /* One small per-basin file read for its shape, if one exists. The format is
   * §57.31 item 3 and unread. */
  if (anyOk) {
    const base = IBTRACS_DIRS[0][1];
    const { rec, body } = await grab(
      'ibtracs/sample', `${base}ibtracs.WP.list.v04r01.csv`,
      'One basin file, sampled. What the columns actually are — §57.31 item 3.',
      { maxBytes: SAMPLE_BYTES },
    );
    await save('ibtracs/sample-WP.csv', body ?? '');
    if (rec.status === 'ok' && body) {
      const lines = body.split('\n').filter((l) => l.trim());
      const cols = (lines[0] || '').split(',');
      out +=
        `### One basin file, read\n\n` +
        `\`ibtracs.WP.list.v04r01.csv\` — declared **${bytesHuman(rec.contentLength)}**` +
        (rec.truncated ? ` (first ${bytesHuman(rec.bytes)} sampled)` : '') +
        `, ${cols.length} columns.\n\n` +
        `Column names:\n\n\`\`\`\n${cols.join('\n')}\n\`\`\`\n\n` +
        `First three lines verbatim:\n\n\`\`\`\n${lines.slice(0, 3).join('\n')}\n\`\`\`\n`;
    } else {
      out += `### One basin file\n\nCould not read a per-basin sample: ${rec.reason || rec.status}. ` +
             `**The per-basin filename was constructed rather than read from the listing — ` +
             `if this failed, take the real names from the directory table above.**\n`;
    }
  }

  say(out);
}

/* --------------------------------------------------------------------------
 * MAIN
 * ----------------------------------------------------------------------- */

await mkdir(RAW, { recursive: true });

/* Sequential on purpose. This hits three of NOAA's servers and there is no
 * hurry — a probe that looks like a scraper is a probe that gets blocked. */
await probeBdecks();
await probeHurdat();
await probeArchiveDepth();
await probeIbtracs();

const failed = manifest.requests.filter((r) => r.status === 'unavailable' || r.status === 'http_error');

const head =
  `# Seasons — step 0 findings\n\n` +
  `Probed ${manifest.probedAt} on a GitHub Actions runner.\n\n` +
  `**${manifest.requests.length} requests, ${failed.length} failed outright.** ` +
  `A 404 is not a failure here — it is how "this year does not exist" arrives.\n\n` +
  `**These answers replace the assumptions in \`SPEC-SEASONS-BUILD.md\` §57.31.** ` +
  `Raw bytes are under \`raw/\`; every response header is in \`manifest.json\`.\n\n` +
  (failed.length
    ? `## Requests that failed\n\n` +
      failed.map((f) => `- \`${f.name}\` — ${f.reason || f.status}`).join('\n') + `\n\n`
    : '') +
  `---\n\n`;

await writeFile(join(OUT, 'findings.md'), head + findings.join('\n---\n\n'));
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`${manifest.requests.length} requests, ${failed.length} failed`);
console.log(`wrote ${join(OUT, 'findings.md')}`);
