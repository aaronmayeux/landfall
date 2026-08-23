/**
 * perf-instrument.mjs — WHAT THE PAGE MEASURES ABOUT ITSELF.
 *
 * Split out of `perf-audit.mjs` because it is the one part that runs in the
 * BROWSER rather than in node, and mixing the two in one file makes it very
 * easy to reference a node variable from page code that cannot see it. Keeping
 * the page half here, as a string with no closure over anything, makes that
 * mistake impossible rather than merely unlikely.
 *
 * ==> EVERYTHING HERE IS BUFFERED, BECAUSE THE PROBE ARRIVES LATE. <==
 * `addInitScript` runs before the document, but a PerformanceObserver created
 * there still misses entries emitted during the same task. Every observer below
 * passes `buffered: true` so the entries that landed before it existed are
 * replayed into it. An unbuffered observer here reads zero long tasks on a page
 * that blocked for a second, which is the most flattering possible lie.
 */

/* The module classes the audit reports separately. Ours vs vendor matters
 * because they want opposite fixes: our count is a bundling question, vendor
 * size is a loading-strategy question. */
export const OURS_RE = /\/(main|pwa)\.js$|\/(app|lib|map|ui|config|data|replay|surge)\//;
export const VENDOR_RE = /\/vendor\//;
export const API_RE = /\/api\//;
export const RADAR_RE = /\/api\/imagery\/radar/;

/**
 * Runs via `addInitScript`, i.e. before any page script, on every navigation.
 *
 * Collects into `window.__audit`. Never throws: a probe that breaks the page it
 * is measuring produces a number for a page nobody ships.
 */
export const INSTRUMENT = `
window.__audit = {
  longTasks: [],
  lcp: 0,
  fcp: 0,
  boot: {},
  frames: null,
  errors: [],
  /* MAIN THREAD ONLY — see the note below. Renamed from `colorNulls` on
   * 2026-08-23 so that no reader of a report can mistake it for the total. */
  colorNullsMainThread: 0,
  /* Stated as a fact about the instrument rather than left to be inferred from
   * a suspiciously round number. */
  workerConsoleWatched: false,
};

/* ==> THE COLOUR-NULL COUNTER, AND ==> A ZERO FROM IT IS NOT A ZERO. <==
 *
 * MapLibre reports an unparseable colour by calling console.error rather than
 * by throwing, so counting it means watching a console. This patches the one on
 * the MAIN page — and the known source is MapLibre's WORKER, which has its own
 * global scope and its own console that nothing here can reach.
 *
 * NOW.md recorded a run where this read 0 and the errors were happening the
 * whole time. That was taken as progress. It was an instrument pointed at the
 * wrong thread, and the number it produced was worse than no number, because a
 * blank counter reads as good news.
 *
 * It is not silently fixed here: reaching a worker's console needs a CDP
 * attach, which is a real piece of work and belongs in its own change. What IS
 * fixed is the lie — the field is named for the thread it actually watches, and
 * `workerConsoleWatched` travels beside it as a permanent false so no report can
 * present this as a complete count again. */
(function () {
  const realError = console.error.bind(console);
  console.error = function (...args) {
    try {
      const msg = args.map((a) => (typeof a === 'string' ? a : (a && a.message) || '')).join(' ');
      if (msg.indexOf('Could not parse color') !== -1) {
        window.__audit.colorNullsMainThread++;
        if (window.__audit.errors.length < 40) window.__audit.errors.push(msg.slice(0, 200));
      }
    } catch (e) {}
    return realError(...args);
  };
})();

try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__audit.longTasks.push({ start: e.startTime, dur: e.duration });
  }).observe({ type: 'longtask', buffered: true });
} catch (e) {}

try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__audit.lcp = e.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
} catch (e) {}

try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__audit.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });
} catch (e) {}

/* The app's own boot marks, read rather than re-derived. \`lib/perf.js\` already
 * names the three stages that matter (globe, data, storms) and D1 stores them,
 * so the audit reports the SAME numbers the field telemetry does instead of
 * inventing a fourth definition of "loaded". */
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__audit.boot[e.name] = e.startTime;
  }).observe({ type: 'mark', buffered: true });
} catch (e) {}

/**
 * Frame pacing, sampled on demand.
 *
 * ==> AVERAGE FPS HIDES THE THING THAT IS ACTUALLY FELT. <== A globe that runs
 * at 60 and drops one 200ms frame reads as a stutter and averages to 57, which
 * looks fine. So this keeps the whole interval list and the audit reports the
 * long tail, not the mean.
 */
window.__auditFrames = function (ms) {
  return new Promise((resolve) => {
    const intervals = [];
    let last = performance.now();
    const stop = last + ms;
    function tick(now) {
      intervals.push(now - last);
      last = now;
      if (now < stop) requestAnimationFrame(tick);
      else resolve(intervals);
    }
    requestAnimationFrame(tick);
  });
};
`;

/**
 * Turn a list of resource-timing entries into the numbers the report wants.
 *
 * ==> "WAVES" IS THE NUMBER A BUNDLE CHANGES; BYTES IS NOT. <== A browser
 * cannot request a module it has not yet parsed a reference to, so an import
 * graph costs one SEQUENTIAL round trip per level regardless of how small the
 * files are. Counting a new wave whenever the gap between consecutive starts
 * exceeds `gapMs` approximates that from the outside, which is the only place
 * this can be measured against a real deploy.
 */
export function summarise(res, { gapMs = 40 } = {}) {
  const ours = res.filter((r) => OURS_RE.test(path(r.name)));
  const vendor = res.filter((r) => VENDOR_RE.test(path(r.name)));
  const api = res.filter((r) => API_RE.test(path(r.name)));

  const starts = ours.map((r) => r.start).sort((a, b) => a - b);
  let waves = starts.length ? 1 : 0;
  for (let i = 1; i < starts.length; i++) if (starts[i] - starts[i - 1] > gapMs) waves++;

  const first = ours.length ? Math.min(...ours.map((r) => r.start)) : 0;
  const last = ours.length ? Math.max(...ours.map((r) => r.end)) : 0;

  return {
    ourModules: ours.length,
    ourWaves: waves,
    staircaseMs: Math.round(last - first),
    firstModuleAtMs: Math.round(first),
    lastModuleAtMs: Math.round(last),
    vendorCount: vendor.length,
    vendorKB: kb(vendor),
    apiCount: api.length,
    apiKB: kb(api),
    totalRequests: res.length,
    transferKB: kb(res),
    /* ==> THE FIRST API CALL IS THE HONEST "WHEN DOES DATA START" NUMBER. <==
     * First paint is not gated on data by design, but storms-on-screen is, and
     * this is the moment that clock starts. If it sits far past first paint the
     * module graph is what is holding the data back, not the feeds. */
    firstApiAtMs: api.length ? Math.round(Math.min(...api.map((r) => r.start))) : null,
  };
}

/**
 * The longest chain of API requests where each one starts only after the
 * previous finished — the serial depth of the data layer.
 *
 * ==> DEPTH, NOT COUNT, IS WHAT A PHONE PAYS FOR. <== Twenty parallel requests
 * cost one round trip; four sequential ones cost four. This walks the requests
 * in start order and grows a chain whenever a request begins after an earlier
 * one ended, which is the observable signature of an `await` between them.
 * It is a LOWER BOUND: two independent fetches that happen to be spaced apart
 * look serial from out here. Treat a rise as a real regression and a fall as
 * real progress; do not read the absolute value as gospel.
 */
export function serialDepth(res, tolMs = 5) {
  const api = res
    .filter((r) => API_RE.test(path(r.name)))
    .map((r) => ({ url: path(r.name) + search(r.name), start: r.start, end: r.end }))
    .sort((a, b) => a.start - b.start);

  let best = [];
  const chainTo = new Map();
  for (let i = 0; i < api.length; i++) {
    let bestPrev = null;
    for (let j = 0; j < i; j++) {
      if (api[j].end - tolMs <= api[i].start) {
        const c = chainTo.get(j) || [api[j]];
        if (!bestPrev || c.length > bestPrev.length) bestPrev = c;
      }
    }
    const chain = bestPrev ? [...bestPrev, api[i]] : [api[i]];
    chainTo.set(i, chain);
    if (chain.length > best.length) best = chain;
  }
  return { depth: best.length, chain: best.map((c) => ({ url: c.url, startMs: Math.round(c.start) })) };
}

function path(u) {
  try { return new URL(u).pathname; } catch { return u; }
}
function search(u) {
  try { return new URL(u).search.slice(0, 60); } catch { return ''; }
}
function kb(list) {
  return Math.round(list.reduce((a, r) => a + (r.size || 0), 0) / 1024);
}
