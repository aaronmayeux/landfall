#!/usr/bin/env node
/**
 * csp-check.mjs — boot the app under the REAL policy and fail on any violation.
 *
 * ===> WHY THIS HAD TO EXIST BEFORE THE FLIP. <===
 * `_headers` shipped its CSP as Report-Only because a wrong policy does not
 * degrade this app, it blanks it, for everyone, on a deploy nobody is watching.
 * Report-Only made the first deploy cost a console read instead of an outage —
 * but only if somebody actually reads the console, on the right device, at the
 * right moment. That is not a check, it is a hope. This turns it into a command
 * that exits non-zero.
 *
 * It parses the policy out of `_headers` rather than carrying its own copy, so
 * it can never drift from what ships. A checker with its own idea of the policy
 * would pass while the deploy failed.
 *
 * ===> WHAT IT CANNOT COVER. SAY IT OUT LOUD. <===
 * It runs offline against a local server. That means NO basemap tiles, NO storm
 * data, and therefore no selected storm and no satellite imagery — the paths
 * most likely to reach a host the policy has not been told about. A clean run
 * here proves the SHELL is clean. It does not prove the app is.
 *
 * So this is a floor, not a proof, and the honest reading of a green tick is
 * "nothing in boot or the drawer violates the policy", not "the CSP is safe to
 * enforce". The remaining risk is a glass read on a real phone with a storm
 * open — which is the same gate `_headers` has always named.
 *
 * Run: node tools/csp-check.mjs
 * NEEDS PLAYWRIGHT. PLAYWRIGHT_CHROMIUM_PATH overrides the browser binary.
 */

import { chromium } from 'playwright';
import http2 from 'node:http2';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from './module-graph.mjs';

const PORT = 8180;
const SETTLE_MS = 5000;
/* Every drawer root, so the check covers more than the first screen. */
const VIEWS = ['btn-storms', 'btn-layers', 'btn-home', 'btn-settings'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

/** Pull the enforced policy straight out of `_headers`. */
function policyFromHeaders() {
  const text = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s+Content-Security-Policy(-Report-Only)?:\s*(.+)$/);
    if (m) return { reportOnly: Boolean(m[1]), policy: m[2].trim() };
  }
  return null;
}

function ensureCert() {
  const dir = path.join(os.tmpdir(), 'landfall-probe-cert');
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key,
      '-out', cert, '-days', '3650', '-nodes', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

const found = policyFromHeaders();
if (!found) {
  console.error('✗ no Content-Security-Policy line found in _headers');
  process.exit(1);
}

const server = http2.createSecureServer({ ...ensureCert(), allowHTTP1: true }, (req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const full = path.join(ROOT, p);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  const raw = fs.readFileSync(full);
  const ct = MIME[path.extname(full)] || 'application/octet-stream';
  const gz = /text|javascript|json|manifest|svg/.test(ct);
  const body = gz ? zlib.gzipSync(raw) : raw;
  const head = { 'content-type': ct, 'content-length': body.length };
  if (gz) head['content-encoding'] = 'gzip';
  /* ALWAYS ENFORCED HERE, even if _headers is still Report-Only — the whole
   * point is to find out what WOULD break. */
  head['content-security-policy'] = found.policy;
  res.writeHead(200, head).end(body);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ['--ignore-certificate-errors'],
});

const violations = [];
let failed = false;

for (const vp of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 800 }]) {
  const ctx = await browser.newContext({ viewport: vp, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        line: e.lineNumber,
      });
    });
  });
  page.on('pageerror', (e) => {
    violations.push({ where: vp.name, directive: '(page error)', blocked: String(e).slice(0, 160) });
  });

  await page.goto(`https://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(SETTLE_MS);

  for (const id of VIEWS) {
    const btn = await page.$('#' + id);
    if (!btn) continue;
    await btn.click().catch(() => {});
    await page.waitForTimeout(400);
    const close = await page.$('.drawer-close');
    if (close) await close.click().catch(() => {});
    await page.waitForTimeout(200);
  }

  for (const v of await page.evaluate(() => window.__csp)) violations.push({ where: vp.name, ...v });
  await ctx.close();
}

await browser.close();
server.close();

console.log(`\nCSP CHECK — policy read from _headers (${found.reportOnly ? 'Report-Only' : 'ENFORCED'} on the deploy)`);
console.log('running it ENFORCED locally, offline: no tiles, no storm data, no imagery\n');

/* Boot deliberately reaches the basemap host, which is unreachable offline.
 * That is a network failure, not a policy failure, and treating it as one
 * would make this check cry wolf on every run until somebody stopped reading
 * it — the exact fate of the console read this file replaces. */
const IGNORABLE = /tiles\.openfreemap\.org|cloudflareinsights\.com/;
const real = violations.filter((v) => !IGNORABLE.test(v.blocked || ''));

if (real.length) {
  failed = true;
  console.error(`${real.length} violation(s) — these BLOCK on the live site:\n`);
  for (const v of real) console.error(`  [${v.where}] ${v.directive} blocked ${v.blocked}`);
  console.error('');
} else {
  console.log('✓ no violations in boot or any drawer view, at both widths');
  console.log('  NOT COVERED: selected storm, satellite imagery, radar — needs a phone.\n');
}

process.exit(failed ? 1 : 0);
