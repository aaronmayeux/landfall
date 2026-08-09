#!/usr/bin/env node
/**
 * ida-capture.mjs — pull Hurricane Ida's (AL092021) advisory record verbatim.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT tools/archive-fetch.mjs. The archive
 * script snapshots LIVE feeds hourly. This one reaches into NHC's 2021
 * ARCHIVE, runs once, and its output is committed as a fixture rather than to
 * the rolling archive branch. Ida is the first real hurricane the home
 * corridor has ever been measured against; Bertha never reached hurricane
 * strength, so the 50 kt and 64 kt bands had only ever been drawn against a
 * fabricated storm.
 *
 * IT RUNS ON A GITHUB RUNNER, NOT IN A SESSION. A cloud session reaches
 * GitHub and npm and nothing else. WebFetch can read an advisory but runs a
 * small model over the page, so what comes back is a rendering of the bytes
 * and not the bytes. A fixture that a test measures to a tenth of a nautical
 * mile has to be the bytes.
 *
 * Zero dependencies. Run: node tools/ida-capture.mjs <output-dir>
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) {
  console.error('usage: node tools/ida-capture.mjs <output-dir>');
  process.exit(2);
}

const UA = 'Landfall/1.0 (+https://landfall.getgravitate.app)';
const BASE = 'https://www.nhc.noaa.gov/archive/2021/al09';

/** Unwrap the <pre> block NHC wraps every archived text product in, and undo
 *  the four entities that can appear inside it. Nothing else is touched — the
 *  fixed-column layout of a TCM is load-bearing and any reflow corrupts it. */
function unwrapPre(html) {
  const m = html.match(/<pre>([\s\S]*?)<\/pre>/i);
  if (!m) return null;
  return m[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/^\n/, '');
}

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' } });
  return { status: res.status, ok: res.ok, body: res.ok ? await res.text() : null };
}

mkdirSync(join(OUT, 'fstadv'), { recursive: true });
mkdirSync(join(OUT, 'public'), { recursive: true });

const manifest = { fetchedAt: new Date().toISOString(), products: [] };

for (const kind of ['fstadv', 'public']) {
  for (let n = 1; n <= 30; n++) {
    const nnn = String(n).padStart(3, '0');
    const url = `${BASE}/al092021.${kind}.${nnn}.shtml`;
    const r = await get(url);
    if (!r.ok) {
      console.log(`--   ${kind} ${nnn}  HTTP ${r.status}`);
      manifest.products.push({ kind, n: nnn, url, status: 'absent', http: r.status });
      continue;
    }
    const text = unwrapPre(r.body);
    if (!text) {
      /* A 200 with no <pre> is a redirect page or a layout change, and writing
         it as if it were an advisory is how a fixture goes quietly wrong. */
      console.log(`FAIL ${kind} ${nnn}  200 but no <pre>`);
      manifest.products.push({ kind, n: nnn, url, status: 'no-pre', http: 200 });
      continue;
    }
    writeFileSync(join(OUT, kind, `al092021.${kind}.${nnn}.txt`), text);
    console.log(`ok   ${kind} ${nnn}  ${text.length} B`);
    manifest.products.push({ kind, n: nnn, url, status: 'ok', http: 200, bytes: text.length });
  }
}

writeFileSync(join(OUT, 'capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nwrote ${manifest.products.filter((p) => p.status === 'ok').length} products to ${OUT}`);
