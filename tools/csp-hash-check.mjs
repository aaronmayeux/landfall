/**
 * csp-hash-check.mjs — keeps the CSP script hash honest.
 *
 * Run:  node tools/csp-hash-check.mjs
 * Exit: 0 if every inline <script> in index.html is pinned in _headers,
 *       1 otherwise (and it prints the line to paste).
 *
 * WHY THIS EXISTS. index.html carries exactly one inline <script>: the
 * pre-paint theme resolver, which has to run before the first paint and
 * therefore cannot be a module import. `_headers` says, correctly, that an
 * inline script means script-src has to change — but the change does NOT have
 * to be 'unsafe-inline'. A `sha256-` hash pins that exact script and nothing
 * else, which is strictly stronger than 'unsafe-inline' and no weaker than the
 * original 'self'-only policy.
 *
 * The catch with a hash is that it silently stops matching the moment anyone
 * edits the script — including reindenting it. A CSP that no longer matches
 * fails CLOSED: the theme resolver stops running and every light-mode user
 * gets a dark flash on load, with nothing in the console but a CSP report.
 * This script is the thing that makes that impossible to ship.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const headers = readFileSync(new URL('../_headers', import.meta.url), 'utf8');

/* Inline scripts only — anything with a src= is a file on our own origin and
 * is covered by 'self'. */
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1]);

if (!inline.length) {
  console.log('No inline <script> in index.html — nothing to pin.');
  process.exit(0);
}

let bad = 0;
for (const body of inline) {
  /* The hash covers the EXACT bytes between the tags — no trimming, no
   * normalising. Browsers hash what is there, so this must too. */
  const hash = 'sha256-' + createHash('sha256').update(body, 'utf8').digest('base64');
  const pinned = headers.includes(`'${hash}'`);
  const first = body.trim().split('\n')[0].slice(0, 60);
  console.log(`  ${pinned ? 'ok  ' : 'FAIL'} ${hash}  (${first}...)`);
  if (!pinned) {
    bad++;
    console.log(`       add '${hash}' to script-src in _headers`);
  }
}

if (bad) {
  console.error(`\n${bad} inline script(s) not pinned in the CSP.`);
  process.exit(1);
}
console.log('\nEvery inline script is pinned.');
