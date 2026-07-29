#!/usr/bin/env node
/**
 * load-probe.mjs — TIME A COLD LOAD. Nothing else in this repo could.
 *
 * ===> WHY IT EXISTS. <===
 * Cloudflare Web Analytics says the LCP tail is bad (P99 8.6s, ~6% Poor) and
 * will not say WHY — its LCP Debug View returns "No data" for this site. Field
 * data tells you that you have a problem; it cannot tell you which of your own
 * files caused it. This is the lab half, and the rule it enforces is the one in
 * NOW.md: MEASURE FIRST, and "not worth it" is an acceptable answer.
 *
 * ===> WHAT IT MEASURES, AND WHY EACH NUMBER IS HERE. <===
 *   waves          how many SEQUENTIAL round trips the import graph costs. A
 *                  browser cannot request a module it has not yet parsed a
 *                  reference to, so this is latency you pay per-round-trip, not
 *                  per-byte. The single number a modulepreload hint attacks.
 *   staircase      wall-clock from the FIRST of our modules being requested to
 *                  the LAST one arriving. What the wave count costs in ms.
 *   LCP / DCL      what the user experiences. The bar.
 *   long tasks     main-thread blocks >50ms during boot. The OTHER suspect for
 *                  the LCP tail, and the one a preload hint does NOT fix — if
 *                  the staircase is short and this is long, preloading is
 *                  theatre and the answer is "not worth it".
 *   revalidations  repeat-visit 304s. `_headers` puts `no-cache` on every
 *                  module, which is correct for versioning and means a warm
 *                  visit STILL pays a conditional request per file. This counts
 *                  them so the cost of that correctness is a number, not a
 *                  worry.
 *
 * ===> IT THROTTLES BY DEFAULT, AND THAT IS NOT PESSIMISM. <===
 * "It runs on my laptop" is not proof it runs on a phone (§ project lens 4). An
 * unthrottled localhost load has ~0ms round trips, which makes a 5-wave
 * staircase free and the whole measurement a lie that says everything is fine.
 * Defaults emulate a mid-tier phone on decent 4G: 4x CPU slowdown, 40ms RTT.
 * `--fast` turns it off for comparison; do not read a --fast number as a
 * user-facing one.
 *
 * ===> LOCAL MODE SERVES THE REAL `_headers`. <===
 * The bundled static server PARSES `_headers` and applies the Cache-Control it
 * finds, with ETags and real 304s. A probe against `python3 -m http.server`
 * would measure a caching policy this app does not have. It also means a
 * directory missing from `_headers` shows up here as a module with no
 * instruction, which is a bug this probe can see.
 *
 * USAGE
 *   node tools/load-probe.mjs                 # local server, phone-ish
 *   node tools/load-probe.mjs --fast          # no throttling
 *   node tools/load-probe.mjs --runs 5        # median of 5
 *   node tools/load-probe.mjs --json out.json # machine-readable, for diffing
 *   LANDFALL_URL=https://landfall.getgravitate.app node tools/load-probe.mjs
 *
 * Against LANDFALL_URL it measures the real deploy — real headers, real tiles,
 * real Cloudflare. Locally the basemap is blank (no CDN reach) and that is
 * fine: the import staircase is ours and is what is being measured.
 *
 * NEEDS PLAYWRIGHT. PLAYWRIGHT_CHROMIUM_PATH overrides the browser binary.
 */

import { chromium } from 'playwright';
import http2 from 'node:http2';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { buildGraph, ROOT } from './module-graph.mjs';

/* --------------------------------------------------------------------------
 * Tuning. Every number that changes behaviour is named here (§ TUNING).
 * ----------------------------------------------------------------------- */
const PROBE = {
  PORT: 8177,
  RUNS: 3,
  /* Mid-tier phone on good 4G. Not a worst case — a median one. */
  CPU_SLOWDOWN: 4,
  RTT_MS: 40,
  DOWNLOAD_BPS: (10 * 1024 * 1024) / 8, // 10 Mbps
  UPLOAD_BPS: (3 * 1024 * 1024) / 8,
  /* A task over this blocks the main thread visibly. Web standard figure. */
  LONG_TASK_MS: 50,
  /* Give the app room to settle before reading metrics. */
  SETTLE_MS: 6000,
  VIEWPORT: { width: 390, height: 844 },
};

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const FAST = flag('--fast');
/* ===> `--preload` IS AN EXPERIMENT SWITCH, NOT A FEATURE. <===
 * It injects `<link rel="modulepreload">` for the whole graph into the served
 * index.html at request time. Nothing on disk changes and nothing ships. The
 * point is to get a real before/after number for the candidate fix BEFORE
 * committing to it, because the honest answer to "should we preload?" might be
 * no, and there is no way to know that without measuring both. */
const PRELOAD = flag('--preload');
/* How deep to preload. `--preload` alone hints the whole graph; `--preload 1`
 * hints only wave 1. The distinction turned out to matter — see the note on
 * withPreloads(). */
const PRELOAD_DEPTH = Number(opt('--preload', '99'));
const COLD_ONLY = flag('--cold-only');
/* ===> THE OTHER EXPERIMENT SWITCH. <===
 * MapLibre and Three are 1.5 MB of classic <script> at the end of <body>, and
 * both were measured at a combined 1.69s of download+compile+execute on a
 * 4x-throttled phone. They now carry `defer` (see the comment on them in
 * index.html). This switch takes it back off so the win stays reproducible. */
/* Now that `defer` SHIPS in index.html, the switch is the inverse: strip it, to
 * re-measure the counterfactual. Kept rather than deleted because the argument
 * for the attribute is a number, and a number nobody can reproduce is an
 * opinion. */
const NO_DEFER_VENDOR = flag('--no-defer-vendor');
/* ===> THE BOOT SCREEN IS GATED ON A THIRD-PARTY HOST. <===
 * map/style.js declares the basemap source as `url: https://tiles.openfreemap
 * .org/planet` — a TileJSON that MapLibre must FETCH and resolve before it
 * fires `style.load`, and main.js calls boot.done() on exactly that event. So
 * "how long is the splash up" is partly a question about somebody else's CDN.
 *
 * This sandbox cannot reach that host at all, which would make every local
 * number a worst case dressed up as a baseline. `--stub-basemap` answers the
 * TileJSON locally after a configurable delay, so the healthy case and the
 * outage case are both measurable and neither is guessed at. */
const STUB_BASEMAP = flag('--stub-basemap');
const STUB_DELAY_MS = Number(opt('--stub-basemap', '60'));
const RUNS = Number(opt('--runs', PROBE.RUNS));
const JSON_OUT = opt('--json', null);
const REMOTE = process.env.LANDFALL_URL || null;
const URL_UNDER_TEST = REMOTE || `https://127.0.0.1:${PROBE.PORT}/index.html`;

/* --------------------------------------------------------------------------
 * Static server that honours `_headers`. Local mode only.
 * ----------------------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.pmtiles': 'application/octet-stream',
};

/** Parse `_headers` into [pattern, {header: value}] pairs, in file order. */
function parseHeaders() {
  const file = path.join(ROOT, '_headers');
  if (!fs.existsSync(file)) return [];
  const rules = [];
  let current = null;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: {} };
      rules.push(current);
    } else if (current) {
      const i = raw.indexOf(':');
      if (i > 0) current.headers[raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
    }
  }
  return rules;
}

/* Cloudflare's `*` matches across path separators — `/map/*` really does cover
 * `/map/layers/cone.js`. Getting this wrong would invent a cache rule the
 * deploy does not have, which is the exact class of error this probe exists to
 * avoid. */
const toRe = (p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

function headersFor(rules, urlPath) {
  const out = {};
  for (const r of rules) if (toRe(r.pattern).test(urlPath)) Object.assign(out, r.headers);
  return out;
}

/* Wave 0 is already in the HTML as <script type="module">, so it needs no hint;
 * everything below it is what the browser cannot see until it has parsed a
 * parent. Inserted immediately before the first module <script> so the browser
 * meets the hints while it is still parsing the head of the body. */
/**
 * ===> MORE PRELOADING IS NOT BETTER, AND THE PROBE PROVED IT. <===
 * Hinting the WHOLE graph (99 modules) cut the staircase 43% and pushed FIRST
 * PAINT from ~444ms to ~768ms. The hints are fetched at high priority, so they
 * compete with the boot screen for the same connection and the same main
 * thread: the app loads sooner and FEELS slower. Under the project's overriding
 * lens, feel wins, so that trade is a regression however good the waterfall
 * looks. Depth is therefore a knob, and the right value is a measurement.
 */
function withPreloads(html) {
  const later = buildGraph().modules.filter((m) => m.wave > 0 && m.wave <= PRELOAD_DEPTH);
  const links = later.map((m) => `<link rel="modulepreload" href="./${m.file}">`).join('\n');
  return html.replace('<script type="module" src="./main.js"></script>',
    `${links}\n<script type="module" src="./main.js"></script>`);
}

/**
 * ===> THE PROBE SERVER SPEAKS HTTP/2, AND THAT IS NOT A DETAIL. <===
 * The first version of this file served plain HTTP/1.1, which caps a browser at
 * SIX concurrent connections per host. With 101 modules that cap — not the
 * import graph — is what serialises the load, and the probe reported a ~1.8s
 * "staircase" that was mostly an artifact of the test rig. Cloudflare serves
 * HTTP/2, where all 101 ride one multiplexed connection and only the WAVE
 * boundaries cost a round trip.
 *
 * Measuring a bottleneck the deploy does not have is worse than not measuring:
 * it would have justified a fix for a problem that does not exist. So the probe
 * runs TLS + h2 with a throwaway self-signed cert and Chromium told to ignore
 * it. Verify the verifier — the rig has to match the transport.
 */
function ensureCert() {
  const dir = path.join(os.tmpdir(), 'landfall-probe-cert');
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert,
      '-days', '3650', '-nodes', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ], { stdio: 'ignore' });
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

function startServer(rules) {
  const server = http2.createSecureServer({ ...ensureCert(), allowHTTP1: true }, (req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const full = path.join(ROOT, urlPath);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    let raw = fs.readFileSync(full);
    if ((PRELOAD || NO_DEFER_VENDOR) && urlPath.endsWith('index.html')) {
      let html = raw.toString('utf8');
      if (PRELOAD) html = withPreloads(html);
      if (NO_DEFER_VENDOR) html = html.replace(/<script defer src="\.\/vendor\//g,
        '<script src="./vendor/');
      raw = Buffer.from(html);
    }
    const etag = '"' + crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16) + '"';
    const extra = headersFor(rules, urlPath);
    const head = {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      ETag: etag,
      ...extra,
    };
    /* Real conditional responses, so a warm run measures 304s and not a lie. */
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, head).end();
      return;
    }
    /* ===> COMPRESS, OR THE WHOLE MEASUREMENT IS WRONG. <===
     * Cloudflare gzips/brotlis text responses automatically. A probe server
     * that does not would measure ~1.5 MB of module bytes where the deploy
     * ships ~350 KB, blame the staircase for time the network never spends,
     * and send this pass off to optimise the wrong thing. */
    const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const compressible = /text|javascript|json|manifest|svg/.test(head['Content-Type']);
    const body = wantsGzip && compressible ? zlib.gzipSync(raw) : raw;
    if (body !== raw) head['Content-Encoding'] = 'gzip';
    res.writeHead(200, { ...head, 'Content-Length': body.length }).end(body);
  });
  return new Promise((r) => server.listen(PROBE.PORT, '127.0.0.1', () => r(server)));
}

/* --------------------------------------------------------------------------
 * The instrumentation injected before any app code runs.
 * ----------------------------------------------------------------------- */
const INSTRUMENT = `
  window.__probe = { longTasks: [], lcp: 0, lcpEl: null, bootDone: 0, bootGone: 0 };
  /* ===> THE ONLY MILESTONE THAT MATCHES WHAT THE USER SEES. <===
   * #boot is position:fixed, inset:0, z-index:100, opaque --ocean. Chrome's LCP
   * algorithm does NOT test for occlusion, so it happily reports an element
   * UNDERNEATH that overlay — measured here as button#storm-pill at ~340ms
   * while the screen shows nothing but a spinning mark for seconds afterwards.
   * The field LCP for this app is therefore fiction, and so is any decision
   * made from it. boot.js sets data-done="true" the moment the map is
   * touchable, then removes the element after the fade.
   *
   * POLLED ON rAF, NOT A MutationObserver. The first version observed
   * document.documentElement from an init script and reported 0 on every run:
   * at document_start there is nothing to observe yet, and an observer that
   * never attached fails SILENTLY — it just keeps returning the initial value,
   * which looks exactly like "the boot screen never lifted". A metric that
   * cannot tell "did not happen" from "did not measure" is worse than no
   * metric. A poll cannot attach to the wrong thing. */
  (function pollBoot() {
    const el = document.getElementById('boot');
    if (el && el.dataset.done === 'true' && !window.__probe.bootDone) {
      window.__probe.bootDone = performance.now();
    }
    if (window.__probe.bootDone && !el) {
      window.__probe.bootGone = performance.now();
      return;
    }
    requestAnimationFrame(pollBoot);
  })();

  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__probe.longTasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        window.__probe.lcp = e.startTime;
        window.__probe.lcpEl = e.element
          ? e.element.tagName.toLowerCase() + (e.element.id ? '#' + e.element.id : '')
          : e.url || '(none)';
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
`;

const OURS = /\/(main|pwa)\.js$|\/(app|lib|map|ui|config|data)\//;

async function measure(browser, { warm }) {
  const ctx = await browser.newContext({
    viewport: PROBE.VIEWPORT,
    deviceScaleFactor: 2,
    serviceWorkers: 'block', // the worker's own cache is a separate question
  });
  const page = await ctx.newPage();
  await page.addInitScript(INSTRUMENT);

  const cdp = await ctx.newCDPSession(page);
  if (!FAST) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: PROBE.CPU_SLOWDOWN });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: PROBE.RTT_MS,
      downloadThroughput: PROBE.DOWNLOAD_BPS,
      uploadThroughput: PROBE.UPLOAD_BPS,
    });
  }

  /* Answer the OpenFreeMap TileJSON locally so `style.load` can resolve. The
   * body is the minimum MapLibre accepts; the tiles themselves still 404,
   * which is correct — this measures the STYLE dependency, not the tiles. */
  if (STUB_BASEMAP) {
    await page.route('https://tiles.openfreemap.org/**', async (route) => {
      await new Promise((r) => setTimeout(r, STUB_DELAY_MS));
      if (!route.request().url().endsWith('/planet')) return route.abort();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/x/{z}/{x}/{y}.pbf'],
          minzoom: 0, maxzoom: 14, vector_layers: [{ id: 'water', fields: {} }],
        }),
      });
    });
  }

  const reqs = [];
  page.on('response', async (res) => {
    const u = res.url();
    reqs.push({ url: u, status: res.status(), ours: OURS.test(new global.URL(u).pathname) });
  });

  /* A warm run loads twice in the SAME context, so the second load meets the
   * browser's own HTTP cache exactly as a returning visitor does. */
  if (warm) {
    await page.goto(URL_UNDER_TEST, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(PROBE.SETTLE_MS);
    reqs.length = 0;
    await page.evaluate(() => { window.__probe = { longTasks: [], lcp: 0, lcpEl: null }; });
  }

  const t0 = Date.now();
  await page.goto(URL_UNDER_TEST, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(PROBE.SETTLE_MS);

  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const res = performance.getEntriesByType('resource').map((r) => ({
      name: r.name,
      start: r.startTime,
      end: r.responseEnd,
      size: r.transferSize,
    }));
    const paints = {};
    for (const p of performance.getEntriesByType('paint')) paints[p.name] = p.startTime;
    return {
      ttfb: nav.responseStart || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      fcp: paints['first-contentful-paint'] || 0,
      lcp: window.__probe.lcp,
      lcpEl: window.__probe.lcpEl,
      bootDone: window.__probe.bootDone,
      bootGone: window.__probe.bootGone,
      longTasks: window.__probe.longTasks,
      res,
    };
  });

  const ourRes = m.res.filter((r) => OURS.test(new global.URL(r.name).pathname));
  const staircase = ourRes.length
    ? Math.max(...ourRes.map((r) => r.end)) - Math.min(...ourRes.map((r) => r.start))
    : 0;

  /* ===> SPLIT BOOT FROM STEADY STATE, OR MISREAD BOTH. <===
   * The clear globe runs a continuous rAF idle rotation. Under a 4x CPU
   * throttle that alone emits back-to-back >50ms tasks forever, so a single
   * "total long task time" number over the whole window is dominated by the
   * animation and blames boot for work boot never did. Long tasks BEFORE
   * DOMContentLoaded are the load-speed problem; long tasks after it are the
   * frame-budget problem, which is pass 2's territory, not this one.  */
  const longBefore = m.longTasks.filter((t) => t.dur >= PROBE.LONG_TASK_MS && t.start < m.dcl);
  const longAfter = m.longTasks.filter((t) => t.dur >= PROBE.LONG_TASK_MS && t.start >= m.dcl);
  const blocking = longBefore.reduce((n, t) => n + (t.dur - PROBE.LONG_TASK_MS), 0);

  await ctx.close();
  return {
    wall: Date.now() - t0,
    ttfb: m.ttfb,
    fcp: m.fcp,
    lcp: m.lcp,
    dcl: m.dcl,
    staircase,
    moduleCount: ourRes.length,
    moduleBytes: ourRes.reduce((n, r) => n + (r.size || 0), 0),
    longTaskCount: longBefore.length,
    longTaskMs: longBefore.reduce((n, t) => n + t.dur, 0),
    blockingMs: blocking,
    afterCount: longAfter.length,
    afterMs: longAfter.reduce((n, t) => n + t.dur, 0),
    lcpEl: m.lcpEl,
    bootDone: m.bootDone,
    bootGone: m.bootGone,
    revalidations: reqs.filter((r) => r.ours && r.status === 304).length,
    freshFetches: reqs.filter((r) => r.ours && r.status === 200).length,
    slowest: ourRes.sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, 5)
      .map((r) => ({ file: new global.URL(r.name).pathname, ms: Math.round(r.end - r.start) })),
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const ms = (n) => `${Math.round(n)}ms`;

/* -------------------------------------------------------------------------- */

const graph = buildGraph();
let server = null;
if (!REMOTE) server = await startServer(parseHeaders());

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  /* The probe server's cert is a throwaway self-signed one, generated per
   * machine. Only ever pointed at 127.0.0.1. */
  args: REMOTE ? [] : ['--ignore-certificate-errors'],
});

console.log(`\nLOAD PROBE — ${URL_UNDER_TEST}`);
console.log(FAST ? 'no throttling (NOT a user-facing number)'
  : `${PROBE.CPU_SLOWDOWN}x CPU, ${PROBE.RTT_MS}ms RTT, ${(PROBE.DOWNLOAD_BPS * 8 / 1024 / 1024).toFixed(0)} Mbps`);
console.log(`static graph: ${graph.modules.length} modules, ${graph.waves} waves, ` +
  `${(graph.modules.reduce((n, m) => n + (m.bytes || 0), 0) / 1024).toFixed(0)} KB unminified\n`);

const results = { cold: [], warm: [] };
for (const mode of COLD_ONLY ? ['cold'] : ['cold', 'warm']) {
  for (let i = 0; i < RUNS; i++) results[mode].push(await measure(browser, { warm: mode === 'warm' }));
}
await browser.close();
if (server) server.close();

const summarise = (rows) => ({
  lcp: median(rows.map((r) => r.lcp)),
  bootDone: median(rows.map((r) => r.bootDone)),
  fcp: median(rows.map((r) => r.fcp)),
  dcl: median(rows.map((r) => r.dcl)),
  ttfb: median(rows.map((r) => r.ttfb)),
  staircase: median(rows.map((r) => r.staircase)),
  blockingMs: median(rows.map((r) => r.blockingMs)),
  longTaskMs: median(rows.map((r) => r.longTaskMs)),
  longTaskCount: median(rows.map((r) => r.longTaskCount)),
  afterCount: median(rows.map((r) => r.afterCount)),
  afterMs: median(rows.map((r) => r.afterMs)),
  moduleCount: median(rows.map((r) => r.moduleCount)),
  moduleKB: median(rows.map((r) => r.moduleBytes)) / 1024,
  revalidations: median(rows.map((r) => r.revalidations)),
  freshFetches: median(rows.map((r) => r.freshFetches)),
});

const out = { url: URL_UNDER_TEST, fast: FAST, runs: RUNS, graph: { modules: graph.modules.length, waves: graph.waves } };
for (const mode of COLD_ONLY ? ['cold'] : ['cold', 'warm']) {
  const s = summarise(results[mode]);
  out[mode] = s;
  console.log(`=== ${mode.toUpperCase()} (median of ${RUNS}) ===`);
  console.log(`  TTFB               ${ms(s.ttfb)}`);
  console.log(`  First paint        ${ms(s.fcp)}`);
  console.log(`  LCP                ${ms(s.lcp)}   (${results[mode][0].lcpEl})`);
  console.log(`  DOMContentLoaded   ${ms(s.dcl)}`);
  console.log(`  GLOBE ON GLASS     ${ms(s.bootDone)}   <-- boot veil lifts. THE REAL NUMBER.`);
  console.log(`  Module staircase   ${ms(s.staircase)}   (${s.moduleCount} files, ${s.moduleKB.toFixed(0)} KB)`);
  console.log(`  Requests           ${s.freshFetches} fresh, ${s.revalidations} revalidated (304)`);
  console.log(`  Boot main thread   ${s.longTaskCount} long tasks, ${ms(s.longTaskMs)} total, ${ms(s.blockingMs)} blocking  (before DCL)`);
  console.log(`  After DCL          ${s.afterCount} long tasks, ${ms(s.afterMs)} total  (render loop — pass 2's problem, not this one)\n`);
}

console.log('slowest individual modules (cold, run 1):');
for (const f of results.cold[0].slowest) console.log(`  ${ms(f.ms).padStart(7)}  ${f.file}`);
console.log('');

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ ...out, raw: results }, null, 2));
  console.log(`wrote ${JSON_OUT}\n`);
}
