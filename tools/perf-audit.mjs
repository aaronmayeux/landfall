#!/usr/bin/env node
/**
 * perf-audit.mjs — THE WHOLE PERFORMANCE PICTURE, IN ONE RUN, AUTOMATED.
 *
 * ===> WHY THIS EXISTS WHEN `load-probe.mjs` ALREADY DOES SOME OF IT. <===
 * `load-probe.mjs:327` and `boot-profile.mjs:86` both build their Playwright
 * context with `serviceWorkers: 'block'`. That was a deliberate simplification
 * and its comment says so. The consequence was not intended: **98% of real
 * sessions are service-worker controlled** (D1 `sessions`, 1,991 of 2,036), so
 * every module-staircase number this project holds was measured on a code path
 * almost nobody uses. This runs BOTH and reports the gap, which is the number
 * that should drive any bundling decision.
 *
 * It also measures four things nothing here measured before:
 *   - the SERIAL DEPTH of the data layer (how many round trips deep the
 *     waterfall is, not how many requests it makes)
 *   - RADAR TILE VOLUME, per load and per pan (NOW.md item 0b, "never watched")
 *   - FRAME PACING while the globe idles (SPEC-MAP §9.7's open question)
 *   - the COLOUR-NULL count (NOW.md item 0d, "dozens of times per load" and
 *     never once counted)
 *
 * ===> IT MEASURES THE DEPLOY, NOT A LOCAL COPY. <===
 * Defaults to the live URL. The sandbox cannot reach it and that is expected —
 * this is built to run on the GitHub Actions runner, which has open internet,
 * exactly like `offline-check` and the other browser suites that cannot run
 * locally. `.github/workflows/perf-audit.yml` is its home.
 *
 * ===> A MAC IS THE FASTEST PLATFORM WE HAVE AND THE RUNNER IS NOT A PHONE. <===
 * SPEC-NEXT §52 measures Mac first paint at 204ms against Windows at 684. So
 * this throttles by default (4x CPU, 40ms RTT) and the numbers are a REGRESSION
 * SIGNAL, not a field measurement. D1 is where field magnitude lives. Compare
 * runs of this tool to each other; never to a phone.
 *
 * USAGE
 *   node tools/perf-audit.mjs                        # live URL, throttled
 *   node tools/perf-audit.mjs --fast                 # no throttling
 *   node tools/perf-audit.mjs --json out.json        # machine-readable
 *   node tools/perf-audit.mjs --budget               # exit 1 on regression
 *   LANDFALL_URL=http://127.0.0.1:8099 node tools/perf-audit.mjs
 *
 * NEEDS PLAYWRIGHT. Pin 1.56.0 in the sandbox; the runner has no such limit.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTRUMENT, summarise, serialDepth, RADAR_RE } from './perf-instrument.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/* ===> EVERY BEHAVIOURAL NUMBER IN ONE PLACE (§ TUNING). <=== Defined before
 * the logic that reads them, and none of them appear as a literal below. */
const AUDIT = Object.freeze({
  URL: process.env.LANDFALL_URL || 'https://landfall.getgravitate.app/',
  VIEWPORT: { width: 390, height: 844 },
  DEVICE_SCALE: 2,
  CPU_SLOWDOWN: 4,
  RTT_MS: 40,
  DOWNLOAD_BPS: (10 * 1024 * 1024) / 8,
  UPLOAD_BPS: (3 * 1024 * 1024) / 8,
  /* Long enough for the globe, both storm lists and the geometry fan-out to
   * land on a throttled run. Measured: the last boot API call lands ~2.7s in
   * unthrottled, so 4x of that plus headroom. */
  SETTLE_MS: 14000,
  /* Frame sampling window. Two seconds is ~120 frames at 60Hz, enough for a
   * p95 to mean something without making the run drag. */
  FRAME_MS: 2000,
  /* How far to pan when asking whether radar re-requests tiles. Roughly one
   * viewport at the zoom the storms sit at. */
  PAN_PX: 300,
  /* A wave boundary. A gap larger than this between two module requests means
   * the second could not be known until the first was parsed. */
  WAVE_GAP_MS: 40,
});

const argv = process.argv.slice(2);
const FAST = argv.includes('--fast');
const CHECK_BUDGET = argv.includes('--budget');
const JSON_OUT = flag('--json');

function flag(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

/* --------------------------------------------------------------------------
 * the arms
 * ------------------------------------------------------------------------ */

/**
 * One measured load.
 *
 * `serviceWorkers` is the variable this whole tool exists to expose. `warm`
 * loads twice in the same context so the second visit meets the browser's own
 * caches exactly as a returning visitor does — which, for a PWA, is nearly
 * every visitor.
 */
async function arm(browser, { name, serviceWorkers, warm, seedLayers = null }) {
  const ctx = await browser.newContext({
    viewport: AUDIT.VIEWPORT,
    deviceScaleFactor: AUDIT.DEVICE_SCALE,
    serviceWorkers,
  });
  const page = await ctx.newPage();
  await page.addInitScript(INSTRUMENT);

  /* Layer prefs live in localStorage under `landfall.layers` (STORAGE_KEY in
   * config/constants.js). Seeding it before the first navigation is how this
   * turns radar on WITHOUT driving the drawer UI — the UI path is a different
   * test and would make this one flaky. */
  if (seedLayers) {
    await page.addInitScript((v) => {
      try { localStorage.setItem('landfall.layers', v); } catch (e) {}
    }, JSON.stringify(seedLayers));
  }

  const cdp = await ctx.newCDPSession(page);
  if (!FAST) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: AUDIT.CPU_SLOWDOWN });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: AUDIT.RTT_MS,
      downloadThroughput: AUDIT.DOWNLOAD_BPS,
      uploadThroughput: AUDIT.UPLOAD_BPS,
    });
  }

  /* Counted from the network side as well as from resource timing, because a
   * tile served from the HTTP cache does not always appear as a resource entry
   * and radar volume is exactly the question where that would mislead. */
  const wire = [];
  page.on('request', (r) => wire.push(r.url()));

  if (warm) {
    await page.goto(AUDIT.URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(AUDIT.SETTLE_MS);
    wire.length = 0;
  }

  await page.goto(AUDIT.URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(AUDIT.SETTLE_MS);

  const raw = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    return {
      res: performance.getEntriesByType('resource').map((r) => ({
        name: r.name, start: r.startTime, end: r.responseEnd,
        size: r.transferSize, worker: r.workerStart || 0,
      })),
      ttfb: Math.round(nav.responseStart || 0),
      dcl: Math.round(nav.domContentLoadedEventEnd || 0),
      load: Math.round(nav.loadEventEnd || 0),
      fcp: Math.round(window.__audit.fcp),
      lcp: Math.round(window.__audit.lcp),
      boot: window.__audit.boot,
      longTasks: window.__audit.longTasks,
      colorNulls: window.__audit.colorNulls,
      colorSamples: window.__audit.errors.slice(0, 5),
      swControlled: !!navigator.serviceWorker.controller,
      /* Did the map actually build? A hidden or throttled tab can finish
       * "loading" with no style at all, and every map number below would then
       * be a measurement of nothing. Reported so a zero can be told from a
       * genuine zero. */
      styleLoaded: !!(window.__landfall && window.__landfall.map
        && window.__landfall.map.isStyleLoaded && window.__landfall.map.isStyleLoaded()),
      storms: (() => {
        try { return (window.__landfall.getState().storms || []).length; } catch (e) { return null; }
      })(),
    };
  });

  const blocked = raw.longTasks.reduce((a, t) => a + t.dur, 0);
  const out = {
    arm: name,
    swControlled: raw.swControlled,
    styleLoaded: raw.styleLoaded,
    storms: raw.storms,
    ttfbMs: raw.ttfb, fcpMs: raw.fcp, lcpMs: raw.lcp, dclMs: raw.dcl, loadMs: raw.load,
    bootMarks: raw.boot,
    longTaskCount: raw.longTasks.length,
    blockedMs: Math.round(blocked),
    colorNulls: raw.colorNulls,
    colorSamples: raw.colorSamples,
    ...summarise(raw.res, { gapMs: AUDIT.WAVE_GAP_MS }),
    data: serialDepth(raw.res),
    radarTiles: wire.filter((u) => RADAR_RE.test(u)).length,
  };

  return { out, page, ctx, wire };
}

/**
 * Radar's request volume, which NOW.md item 0b says has never been watched.
 *
 * ==> THE QUESTION IS NOT "HOW MANY ON LOAD". <== One image per storm became
 * roughly thirty tiles per viewport, and tiles are cheap, immutable and
 * edge-shared — so the load number alone could look bad and be fine. What
 * decides whether the layer is affordable is whether PANNING re-requests, and
 * whether a full source rebuild is triggered by movement that should only need
 * new tiles. So: count on load, pan, count again.
 */
async function radarProbe(browser) {
  const { out, page, ctx, wire } = await arm(browser, {
    name: 'radar',
    serviceWorkers: 'allow',
    warm: false,
    seedLayers: { imagery: 'radar' },
  });

  const onLoad = wire.filter((u) => RADAR_RE.test(u)).length;

  wire.length = 0;
  await page.mouse.move(AUDIT.VIEWPORT.width / 2, AUDIT.VIEWPORT.height / 2);
  await page.mouse.down();
  await page.mouse.move(AUDIT.VIEWPORT.width / 2 - AUDIT.PAN_PX, AUDIT.VIEWPORT.height / 2, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(3000);
  const onPan = wire.filter((u) => RADAR_RE.test(u)).length;

  /* Frame pacing while the globe sits still. `attachIdleRotation` calls
   * setCenter per frame below DIVE.zHandoff, so "resting" is not resting. */
  let frames = [];
  try {
    frames = await page.evaluate((ms) => window.__auditFrames(ms), AUDIT.FRAME_MS);
  } catch (e) { frames = []; }

  await ctx.close();
  return { ...out, radarOnLoad: onLoad, radarOnPan: onPan, frames: framePacing(frames) };
}

/**
 * ==> THE MEAN IS THE ONE NUMBER THAT CANNOT SHOW A STUTTER. <== Reported as
 * the tail: how many frames missed a 60Hz budget and how bad the worst was.
 */
function framePacing(intervals) {
  if (!intervals.length) return null;
  const s = intervals.slice().sort((a, b) => a - b);
  const at = (p) => Math.round(s[Math.floor(s.length * p)] * 10) / 10;
  const budget = 1000 / 60;
  return {
    frames: s.length,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    worstMs: Math.round(s[s.length - 1] * 10) / 10,
    droppedPct: Math.round((intervals.filter((i) => i > budget * 1.5).length / intervals.length) * 100),
    approxFps: Math.round(1000 / at(0.5)),
  };
}

/* --------------------------------------------------------------------------
 * report
 * ------------------------------------------------------------------------ */

function line(label, v) {
  return `  ${String(label).padEnd(26)} ${v}`;
}

function report(results, radar) {
  const L = [];
  L.push('');
  L.push(`LANDFALL PERF AUDIT  ${new Date().toISOString()}`);
  L.push(`  url ${AUDIT.URL}`);
  L.push(`  ${FAST ? 'UNTHROTTLED — not a user-facing number' : `throttled ${AUDIT.CPU_SLOWDOWN}x CPU / ${AUDIT.RTT_MS}ms RTT`}`);
  L.push('');

  for (const r of results) {
    L.push(`── ${r.arm}${r.swControlled ? '  [service worker controlling]' : ''}`);
    if (!r.styleLoaded) {
      L.push('  !! STYLE NEVER LOADED — the map did not build. Map numbers below are meaningless.');
    }
    L.push(line('first paint', `${r.fcpMs} ms`));
    L.push(line('LCP', `${r.lcpMs} ms`));
    L.push(line('DOMContentLoaded', `${r.dclMs} ms`));
    L.push(line('our modules', `${r.ourModules} in ${r.ourWaves} waves`));
    L.push(line('module staircase', `${r.staircaseMs} ms  (${r.firstModuleAtMs} → ${r.lastModuleAtMs})`));
    L.push(line('first API call at', r.firstApiAtMs === null ? '(none)' : `${r.firstApiAtMs} ms`));
    L.push(line('data serial depth', `${r.data.depth} round trips`));
    L.push(line('API requests', `${r.apiCount}  (${r.apiKB} KB)`));
    L.push(line('blocked on main thread', `${r.blockedMs} ms across ${r.longTaskCount} long tasks`));
    L.push(line('colour-null errors', r.colorNulls));
    L.push(line('total transfer', `${r.transferKB} KB over ${r.totalRequests} requests`));
    L.push(line('storms tracked', r.storms));
    L.push('');
  }

  if (radar) {
    L.push('── radar');
    if (!radar.storms) {
      L.push('  no storms tracked — radar draws nothing by design, tile counts are 0 and mean nothing');
    }
    L.push(line('tiles on load', radar.radarOnLoad));
    L.push(line('tiles after one pan', radar.radarOnPan));
    if (radar.frames) {
      L.push(line('idle frame median', `${radar.frames.medianMs} ms  (~${radar.frames.approxFps} fps)`));
      L.push(line('idle frame p95', `${radar.frames.p95Ms} ms`));
      L.push(line('idle frames dropped', `${radar.frames.droppedPct}%`));
    }
    L.push('');
  }

  if (results[0] && results[1]) {
    const [a, b] = results;
    L.push('── the gap the old probes could not see');
    L.push(`  ${a.arm} vs ${b.arm}: staircase ${a.staircaseMs} vs ${b.staircaseMs} ms, `
      + `modules ${a.ourModules} vs ${b.ourModules}, transfer ${a.transferKB} vs ${b.transferKB} KB`);
    L.push('');
  }

  return L.join('\n');
}

/**
 * ==> A BUDGET IS ONLY HONEST IF IT FAILS. <== The thresholds live in
 * `tools/perf-budget.json` so raising one is a reviewable diff rather than an
 * edit buried in a tool nobody reads.
 */
function checkBudget(results, radar) {
  const file = path.join(HERE, 'perf-budget.json');
  if (!fs.existsSync(file)) return { ok: true, notes: ['no budget file — nothing to check'] };
  const budget = JSON.parse(fs.readFileSync(file, 'utf8'));
  const notes = [];
  let ok = true;

  const warm = results.find((r) => r.arm === budget.armUnderBudget) || results[0];

  /* ==> A BUDGET THAT PASSES ON A RUN THAT MEASURED NOTHING IS A GREEN TICK
   * ON SILENCE. <== `report` has always printed "STYLE NEVER LOADED — map
   * numbers below are meaningless", and the budget then went on to check those
   * same meaningless numbers and pass them. Measured 2026-08-21: all three
   * arms reported `styleLoaded: false` and `colorNulls: 0 <= 0` was recorded as
   * a pass — while the live app was emitting about fifteen colour-null errors
   * per load. A zero from an instrument that never ran is not a zero. */
  if (!warm.styleLoaded) {
    notes.push(`FAIL styleLoaded: the map never built on ${warm.arm} — nothing below was measured`);
    ok = false;
  }

  for (const [key, max] of Object.entries(budget.max || {})) {
    const got = key === 'dataSerialDepth' ? warm.data.depth
      : key === 'radarTilesOnPan' ? (radar ? radar.radarOnPan : 0)
      : warm[key];
    if (typeof got !== 'number') { notes.push(`${key}: not measured, skipped`); continue; }
    if (got > max) { ok = false; notes.push(`FAIL ${key}: ${got} > ${max}`); }
    else notes.push(`ok   ${key}: ${got} <= ${max}`);
  }
  return { ok, notes };
}

/* --------------------------------------------------------------------------
 * main
 * ------------------------------------------------------------------------ */

async function main() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    console.error('perf-audit needs playwright. On the runner: npm i playwright && npx playwright install --with-deps chromium');
    process.exit(2);
  }

  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader'],
  });

  const results = [];
  let radar = null;
  try {
    /* ==> ARM ORDER IS THE POINT. <== `cold-nosw` reproduces what load-probe
     * has always measured. `warm-sw` is what a returning PWA user actually
     * gets, and is the path 98% of D1 sessions are on. The difference between
     * the two is the finding. */
    results.push((await arm(browser, { name: 'cold-nosw', serviceWorkers: 'block', warm: false })).out);
    results.push((await arm(browser, { name: 'warm-sw', serviceWorkers: 'allow', warm: true })).out);
    radar = await radarProbe(browser);
  } finally {
    await browser.close();
  }

  const text = report(results, radar);
  console.log(text);

  const budget = CHECK_BUDGET ? checkBudget(results, radar) : null;
  if (budget) {
    console.log('── budget');
    for (const n of budget.notes) console.log('  ' + n);
    console.log('');
  }

  if (JSON_OUT) {
    const payload = { at: new Date().toISOString(), url: AUDIT.URL, throttled: !FAST, results, radar, budget };
    fs.writeFileSync(path.resolve(ROOT, JSON_OUT), JSON.stringify(payload, null, 2));
    console.log(`  wrote ${JSON_OUT}`);
  }

  if (budget && !budget.ok) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
