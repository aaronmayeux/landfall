/**
 * seasons-names-probe.mjs — read NHC's names page BEFORE writing a parser for it.
 *
 * ==> WHY THIS EXISTS AS ITS OWN RUN. <== `CLAUDE.md`: never build against a
 * guessed payload shape. A session reaches GitHub and npm and nothing else, so
 * the only honest look at `aboutnames.shtml` is from an Actions runner. A
 * summarising fetch tool can say roughly what is on the page; it cannot show
 * the markup, and the markup is the entire question — where the year headers
 * live, how the name cells are separated, and whether the two basin tables are
 * distinguishable from the four Central Pacific ones.
 *
 * ==> IT IS DELETED ONCE `tools/seasons-names.mjs` EXISTS. <== Same shape and
 * same lifetime as `seasons-probe.mjs`: a one-shot survey, run when the branch
 * moves, never scheduled, never imported by anything the app ships.
 *
 * WHAT IT WRITES
 *   manifest.json   status, HTTP, bytes, ms, every response header
 *   raw/aboutnames.shtml   the exact bytes, unmodified
 *   findings.md     a structural read of the tables, for a human
 *
 * Zero dependencies. Run: node tools/seasons-names-probe.mjs /tmp/names
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const USER_AGENT =
  'Landfall/1.0 (+https://landfall.getgravitate.app, andy@getgravitate.app)';
const TIMEOUT_MS = 45_000;

const TARGETS = [
  ['aboutnames.shtml', 'https://www.nhc.noaa.gov/aboutnames.shtml'],
  /* The text version. If it exists and is stable it is a far better parse
   * target than the styled page — fewer wrappers to break. Worth measuring. */
  ['aboutnames-text.shtml', 'https://www.nhc.noaa.gov/aboutnames.shtml?text'],
];

const out = process.argv[2] || '/tmp/names';

async function grab(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' },
      signal: ctl.signal,
      redirect: 'follow',
    });
    const body = await res.text();
    return {
      ok: true,
      http: res.status,
      finalUrl: res.url,
      ms: Date.now() - t0,
      bytes: Buffer.byteLength(body, 'utf8'),
      headers: Object.fromEntries(res.headers.entries()),
      body,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err), ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A deliberately dumb structural read. It does NOT try to be the parser — it
 * reports what is there so a human can decide what the parser should look for.
 */
function describe(html) {
  const lines = [];
  const tables = html.split(/<table\b/i).slice(1);
  lines.push(`tables on the page: ${tables.length}`);

  tables.forEach((chunk, i) => {
    const table = chunk.slice(0, chunk.search(/<\/table>/i));
    const rows = table.split(/<tr\b/i).slice(1);
    const headCells = (rows[0] || '')
      .split(/<t[hd]\b/i).slice(1)
      .map((c) => c.slice(0, c.search(/<\/t[hd]>/i)).replace(/<[^>]*>/g, '').trim());
    lines.push('');
    lines.push(`--- table ${i + 1}: ${rows.length} rows, ${headCells.length} header cells`);
    lines.push(`    header cells: ${JSON.stringify(headCells)}`);
    /* The first two body rows, tags stripped, so the cell separator is visible. */
    rows.slice(1, 3).forEach((r, n) => {
      const cells = r.split(/<t[hd]\b/i).slice(1)
        .map((c) => c.slice(0, c.search(/<\/t[hd]>/i)));
      lines.push(`    body row ${n + 1} raw cell 1: ${JSON.stringify(cells[0] || '').slice(0, 300)}`);
      lines.push(`    body row ${n + 1} stripped:  ${JSON.stringify(
        cells.map((c) => c.replace(/<[^>]*>/g, '').trim())).slice(0, 400)}`);
    });
  });

  /* Where the basin headings sit relative to the tables — the parser has to
   * tell an Atlantic table from an East Pacific one somehow. */
  const anchors = [...html.matchAll(/<a\s+[^>]*name="([^"]+)"/gi)].map((m) => m[1]);
  lines.push('');
  lines.push(`named anchors: ${JSON.stringify(anchors)}`);
  const headings = [...html.matchAll(/<h([1-6])[^>]*>([\s\S]{0,120}?)<\/h\1>/gi)]
    .map((m) => m[2].replace(/<[^>]*>/g, '').trim());
  lines.push(`headings: ${JSON.stringify(headings)}`);

  return lines.join('\n');
}

await mkdir(join(out, 'raw'), { recursive: true });

const manifest = { probedAt: new Date().toISOString(), requests: [] };
const findings = ['# NHC names page — what is actually there', ''];

for (const [name, url] of TARGETS) {
  const r = await grab(url);
  manifest.requests.push({
    name, url,
    ok: r.ok, http: r.http, finalUrl: r.finalUrl,
    ms: r.ms, bytes: r.bytes, error: r.error,
    headers: r.headers,
  });

  findings.push(`## ${name}`);
  findings.push('');
  if (!r.ok) {
    findings.push(`FAILED: ${r.error}`);
    findings.push('');
    continue;
  }
  await writeFile(join(out, 'raw', name), r.body, 'utf8');
  findings.push(`HTTP ${r.http}, ${r.bytes} bytes, ${r.ms} ms`);
  findings.push(`last-modified: ${r.headers['last-modified'] || '(none)'}`);
  findings.push('');
  findings.push('```');
  findings.push(describe(r.body));
  findings.push('```');
  findings.push('');
}

await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
await writeFile(join(out, 'findings.md'), findings.join('\n'), 'utf8');

console.log(findings.join('\n'));
