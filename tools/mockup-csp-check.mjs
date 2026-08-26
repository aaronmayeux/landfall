#!/usr/bin/env node
/**
 * mockup-csp-check.mjs — boot every page under `mockups/` against the REAL
 * policy and fail on any violation.
 *
 * ===> IT EXISTS BECAUSE THE SAME BUG SHIPPED TWICE. <===
 * `_headers` sends `script-src 'self'` plus ONE pinned hash — index.html's own
 * boot script — and no `'unsafe-inline'`. An inline `<script>` on any other
 * page is refused by the live CSP.
 *
 * ==> AND THE SYMPTOM LOOKS LIKE A DATA BUG, WHICH IS WHY A HUMAN DOES NOT
 *     CATCH IT. <== `style-src` DOES allow inline, so the page renders. The
 * layout draws, the controls draw, the chrome is styled, and every panel
 * inside is empty. It reads as "the file did not load". Nothing appears in the
 * console unless somebody has a console open on the device it happened on.
 *
 * `mockups/environment-ribbon.html` hit this, was fixed, and wrote the warning
 * into its own file header. `mockups/seasons-wall.html` hit the identical wall
 * on 2026-08-26 with that warning sitting in a sibling file nobody had reason
 * to open. **A rule recorded inside one artifact does not reach the next one.**
 * SPEC-OPS.md §17.4 carries the prose; this carries the enforcement.
 *
 * ===> IT PARSES THE POLICY OUT OF `_headers`. <=== Same rule csp-check.mjs
 * follows and for the same reason: a checker carrying its own copy of the
 * policy passes while the deploy fails.
 *
 * ===> WHAT IT DOES NOT DO. <=== It does not check that a mockup LOOKS right —
 * that is glass, and §57.31 item 1 is explicit that a paint chip cannot settle
 * colour. It checks that the page's own script is permitted to run at all.
 * A mockup with no script of its own passes trivially and correctly.
 *
 * Run: node tools/mockup-csp-check.mjs
 * NEEDS PLAYWRIGHT AND A RUNNING SERVER ON 8099.
 * Use `bash tools/with-server.sh node tools/mockup-csp-check.mjs` — a server
 * started as a background process does not survive between shell calls.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from './module-graph.mjs';

const ORIGIN = 'http://127.0.0.1:8099';
const SETTLE_MS = 700;

/** The enforced policy, straight out of `_headers`. */
function policyFromHeaders() {
  const text = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s+Content-Security-Policy(-Report-Only)?:\s*(.+)$/);
    if (m) return m[2].trim();
  }
  return null;
}

const policy = policyFromHeaders();
if (!policy) {
  console.error('✗ no Content-Security-Policy line found in _headers');
  process.exit(1);
}

const pages = fs.readdirSync(path.join(ROOT, 'mockups'))
  .filter((f) => f.endsWith('.html')).sort();

if (!pages.length) {
  console.error('✗ no mockup pages found — this check has nothing to guard');
  process.exit(1);
}

const browser = await chromium.launch();
const failures = [];

for (const file of pages) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const seen = [];

  /* Stamp the real policy onto every response. The dev server sends no
   * headers at all, which is exactly the blind spot that let this ship. */
  await page.route('**/*', async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      headers: { ...res.headers(), 'content-security-policy': policy },
    });
  });

  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window.__cspViolations ||= []).push(
        `${e.violatedDirective} blocked ${e.blockedURI || 'inline'}`,
      );
    });
  });
  page.on('pageerror', (e) => seen.push(`uncaught: ${e}`));

  try {
    await page.goto(`${ORIGIN}/mockups/${file}`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(SETTLE_MS);
    seen.push(...(await page.evaluate(() => window.__cspViolations || [])));
  } catch (e) {
    seen.push(`could not load: ${e.message}`);
  }

  if (seen.length) failures.push({ file, seen });
  else console.log(`  ok    mockups/${file}`);
  await page.close();
}

await browser.close();

if (failures.length) {
  console.error('\n✗ a mockup does not survive the live CSP\n');
  for (const f of failures) {
    console.error(`  mockups/${f.file}`);
    for (const s of f.seen) console.error(`    ${s}`);
  }
  console.error('\n  The fix is almost always the same: move the inline <script> into a');
  console.error('  sibling .js file and load it with src=. Same-origin .js is permitted');
  console.error('  and needs no policy change. NEVER edit the CSP to make a mockup work.');
  process.exit(1);
}

console.log(`\n✓ all ${pages.length} mockups run under the enforced policy`);
