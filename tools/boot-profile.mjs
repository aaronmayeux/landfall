#!/usr/bin/env node
/**
 * boot-profile.mjs — WHICH FILE BURNS THE MAIN THREAD DURING BOOT.
 *
 * `load-probe.mjs` says HOW MUCH the main thread is blocked. It cannot say by
 * WHAT, because a `longtask` PerformanceEntry carries a duration and almost no
 * attribution — that is the whole reason Cloudflare's LCP Debug View was empty
 * and diagnosis needed another route.
 *
 * This takes the other route: a V8 CPU profile across the boot window, self-time
 * summed per script URL and per function. That turns "boot blocks the thread for
 * seconds" into "these three functions do", which is the difference between a
 * guess and a fix.
 *
 * ===> READ THE SPLIT BEFORE DECIDING ANYTHING. <===
 * Boot cost lands in one of three buckets and they want opposite fixes:
 *   PARSE/EVAL of our modules  -> fewer/smaller modules, or defer them
 *   VENDOR (MapLibre, Three)   -> load them later, not smaller
 *   OUR RUNTIME WORK           -> the work itself is too eager; move or chunk it
 * A `modulepreload` hint moves NONE of these — it only removes network round
 * trips. If this profile says the thread is the bottleneck, preloading is
 * theatre and the honest answer is to say so.
 *
 * Throttled 4x by default for the same reason load-probe is: an unthrottled
 * profile flatters a laptop and tells you nothing about the Android phone that
 * blocked 483ms across 3 startup tasks in the field data.
 *
 * USAGE
 *   node tools/boot-profile.mjs
 *   node tools/boot-profile.mjs --fast
 *   LANDFALL_URL=https://landfall.getgravitate.app node tools/boot-profile.mjs
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './module-graph.mjs';

const PROFILE = {
  PORT: 8178,
  CPU_SLOWDOWN: 4,
  RTT_MS: 40,
  DOWNLOAD_BPS: (10 * 1024 * 1024) / 8,
  UPLOAD_BPS: (3 * 1024 * 1024) / 8,
  /* Sample often enough to see a 50ms task as more than one blip. */
  SAMPLE_INTERVAL_US: 200,
  WINDOW_MS: 8000,
  VIEWPORT: { width: 390, height: 844 },
  TOP_N: 14,
};

const argv = process.argv.slice(2);
const FAST = argv.includes('--fast');
const REMOTE = process.env.LANDFALL_URL || null;
const URL_UNDER_TEST = REMOTE || `http://127.0.0.1:${PROFILE.PORT}/index.html`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const full = path.join(ROOT, p);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = fs.readFileSync(full);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Content-Length': body.length,
    }).end(body);
  });
  return new Promise((r) => server.listen(PROFILE.PORT, '127.0.0.1', () => r(server)));
}

const server = REMOTE ? null : await startServer();
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
});
const ctx = await browser.newContext({ viewport: PROFILE.VIEWPORT, serviceWorkers: 'block' });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);

if (!FAST) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: PROFILE.CPU_SLOWDOWN });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: PROFILE.RTT_MS,
    downloadThroughput: PROFILE.DOWNLOAD_BPS, uploadThroughput: PROFILE.UPLOAD_BPS,
  });
}

await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: PROFILE.SAMPLE_INTERVAL_US });
await cdp.send('Profiler.start');

await page.goto(URL_UNDER_TEST, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(PROFILE.WINDOW_MS);

const { profile } = await cdp.send('Profiler.stop');
await browser.close();
if (server) server.close();

/* ---- self time per node, from the sample stream ------------------------- */
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const selfUs = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const id = profile.samples[i];
  selfUs.set(id, (selfUs.get(id) || 0) + (profile.timeDeltas[i] || 0));
}

const CATEGORY = (url) => {
  if (!url) return '(engine)';
  if (url.includes('/vendor/')) return 'vendor';
  if (/\/(main|pwa)\.js$|\/(app|lib|map|ui|config|data)\//.test(url)) return 'ours';
  if (url.startsWith('http')) return 'other';
  return '(engine)';
};

const fileTotals = new Map();
const fnTotals = new Map();
let total = 0;

for (const [id, us] of selfUs) {
  const node = byId.get(id);
  if (!node) continue;
  const cf = node.callFrame;
  const url = cf.url || '';
  const short = url ? url.replace(/^https?:\/\/[^/]+/, '') : `(${cf.functionName || 'idle'})`;
  const ms = us / 1000;
  total += ms;
  /* GC / idle / program are engine time; keep them visible but separate. */
  const key = url ? short : `(engine) ${cf.functionName || 'program'}`;
  fileTotals.set(key, (fileTotals.get(key) || 0) + ms);
  const fnKey = `${cf.functionName || '(anonymous)'}  ${short}:${cf.lineNumber + 1}`;
  fnTotals.set(fnKey, (fnTotals.get(fnKey) || 0) + ms);
}

const catTotals = new Map();
for (const [key, ms] of fileTotals) {
  const c = key.startsWith('(engine)') ? '(engine)' : CATEGORY('http://x' + key);
  catTotals.set(c, (catTotals.get(c) || 0) + ms);
}

const pad = (n) => `${Math.round(n)}ms`.padStart(8);
console.log(`\nBOOT PROFILE — ${URL_UNDER_TEST}`);
console.log(FAST ? 'no throttling (NOT a user-facing number)' : `${PROFILE.CPU_SLOWDOWN}x CPU throttle`);
console.log(`${Math.round(total)}ms of samples across a ${PROFILE.WINDOW_MS}ms window\n`);

console.log('BY CATEGORY');
for (const [c, ms] of [...catTotals].sort((a, b) => b[1] - a[1])) {
  console.log(`${pad(ms)}  ${((ms / total) * 100).toFixed(1).padStart(5)}%  ${c}`);
}

console.log('\nBY FILE (self time)');
for (const [f, ms] of [...fileTotals].sort((a, b) => b[1] - a[1]).slice(0, PROFILE.TOP_N)) {
  console.log(`${pad(ms)}  ${f}`);
}

console.log('\nBY FUNCTION (self time)');
for (const [f, ms] of [...fnTotals].sort((a, b) => b[1] - a[1]).slice(0, PROFILE.TOP_N)) {
  console.log(`${pad(ms)}  ${f}`);
}
console.log('');
