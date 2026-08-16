/**
 * perf.js — what actually happened, in milliseconds. SPEC §17 A5.
 *
 * ==> THE PROBLEM IT SOLVES <==
 * Cloudflare Web Analytics said the slowest 1% of visitors waited 8.6 seconds
 * and that almost all of them were on iPhones. It could not say WHY, because
 * its own element-level debug view returns nothing. "Slow on iOS" is not a
 * bug report — the fix for a slow download is not the fix for a slow parse is
 * not the fix for a slow first tile. This module turns one useless number
 * into the sequence of numbers that produced it.
 *
 * ==> ONE ROW PER SESSION. THE PHONE DOES THE ARITHMETIC. <==
 * Everything here ACCUMULATES IN MEMORY and is read exactly once, as a single
 * flat snapshot, when the session ends. Nothing is sent per event.
 *
 * That is not tidiness, it is the difference between affordable and not. Long
 * tasks alone can fire hundreds of times in a bad minute; streaming them would
 * be hundreds of database writes for one visitor, and D1's free tier is 100k
 * rows a day TOTAL. A count and a sum answer the same question for one row.
 * The rule for anything added here: if it can happen more than once, store an
 * aggregate, never a list.
 *
 * ==> IT CANNOT BREAK THE APP, AND IT CANNOT COST A FRAME. <==
 * Same contract as lib/telemetry.js, for the same reason: diagnostics that can
 * degrade the product are worse than no diagnostics. Every export is wrapped
 * and swallows its own failures. PerformanceObserver callbacks do arithmetic
 * on numbers and nothing else — no DOM reads, no layout, no allocation beyond
 * a few counters. If an observer type is unsupported the browser throws at
 * registration, each one is registered separately, and a failure there costs
 * exactly that one metric rather than the whole module.
 *
 * ==> WHAT IS DELIBERATELY NOT HERE <==
 * No user agent string. It is the single highest-entropy fingerprinting field
 * on the web and the coarse `platform` bucket below answers the question that
 * was actually being asked (iPhone versus not). Device fields WERE added on
 * 2026-07-28 as a deliberate decision — see SPEC §17 — but the UA string was
 * not part of it and should not arrive later by accident.
 *
 * Home coordinates never appear in telemetry. That has not changed and does
 * not change. (It is deliberately narrower than "never leave the device",
 * which stopped being true when the rainfall forecast started asking about a
 * point — see data/home.js. Nothing here sends one, and nothing here may.)
 * See lib/telemetry.js for the contract that governs all of this.
 *
 * Imports: config/ only. Wired by main.js; never imported by a render path.
 */

import { PERF } from '../config/constants.js';

/* --- state ---------------------------------------------------------------- */

let started = false;

/** Largest Contentful Paint, in ms from navigation start. The observer fires
 *  repeatedly as bigger elements paint; the LAST value is the real one, which
 *  is why this is overwritten rather than accumulated. */
let lcpMs = 0;

/** Long tasks — anything that blocked the main thread past PERF.longTaskMs.
 *  Count AND total, because they answer different questions: many short
 *  blocks is a different disease from one enormous one.
 *
 *  ==> THESE COVER THE WHOLE VISIT, NOT THE BOOT. READ THE NEXT BLOCK. <== */
let longTaskCount = 0;
let longTaskTotalMs = 0;

/** The same two numbers, frozen at the last boot milestone.
 *
 *  ==> WITHOUT THIS SPLIT THE COLUMN IS UNREADABLE, AND IT READ AS A BUG. <==
 *  The totals above accumulate until the page hides, which on a phone is
 *  minutes later. Every load timing in the row stops at boot. Comparing the
 *  two — the obvious thing to do, since they sit side by side in the table —
 *  produces rows claiming 74 SECONDS of blocked main thread during an
 *  11-second load, which looks exactly like a broken counter and was read as
 *  one on 2026-08-14. Nothing was broken; the question was malformed.
 *
 *  So the boot-bounded figure is stored as its own pair. `mark()` copies the
 *  live totals on every milestone, and since 'storms' is the last one to
 *  fire, whatever is left here is the cost of getting the app on screen.
 *
 *  Keep BOTH. Blocking during startup is why a visitor leaves before seeing
 *  anything; blocking afterwards is why the globe feels bad in the hand. They
 *  are different bugs with different fixes. */
let bootLongTaskCount = 0;
let bootLongTaskMs = 0;

/* Visit duration is NOT held in a variable here — `snapshot()` reads
 * `performance.now()` directly at the moment the summary is taken, which is
 * the end of the visit by definition. A variable would only be a second copy
 * of the same clock, one that could go stale.
 *
 * ==> IT IS THE DENOMINATOR THE BLOCKED-TIME COLUMNS NEVER HAD. <==
 * "2.4 seconds of frozen main thread" means nothing on its own: unremarkable
 * across a ten-minute visit, catastrophic across a fifteen-second one.
 * Without it the whole-visit figures can only be compared against boot
 * timings, which is the exact mistake documented above. */

/** Worst interaction latency seen this session. This is the honest local
 *  version of INP: the browser reports each interaction's duration, and the
 *  worst one is what the session FELT like. An average would hide it. */
let worstEventMs = 0;

/** WebGL context loss. THE iOS HYPOTHESIS THIS MODULE EXISTS TO TEST.
 *  Safari drops WebGL contexts under memory pressure, and on a globe app that
 *  looks exactly like "it was slow" from the outside while actually being
 *  "the graphics card was taken away". Wired by main.js on both canvases. */
let webglLost = 0;

/** Was the page ALREADY out of sight when this module started, and when did
 *  it first go out of sight afterwards?
 *
 *  ==> THESE ARE NOT METRICS. THEY ARE THE VALIDITY FLAG FOR EVERY TIMING
 *      COLUMN ABOVE THEM. <==
 *  A backgrounded tab, a locked phone, a speculative prerender — the clock
 *  keeps running but paint and script do not, so First Contentful Paint and
 *  every app milestone come back enormous while nothing was actually slow.
 *  One real session on 2026-07-29 recorded 97 SECONDS to storms this way and
 *  single-handedly made iOS look like the worst platform in the table when
 *  its true median is the second BEST. The conclusion drawn from that number
 *  was wrong, and it was wrong for two days.
 *
 *  Without these two integers there is no way to tell that row from a
 *  genuinely broken load, because after the fact the two are identical.
 *  `nav_type` does not answer it: that session was `back_forward`, but so are
 *  plenty of honest loads, and plenty of hidden loads are `navigate`.
 *
 *  Zero on both means every timing in the row is trustworthy. Anything else
 *  means exclude the row from timing analysis — not from usage analysis,
 *  which is unaffected. */
let hiddenAtStart = 0;
let firstHiddenMs = 0;

/** App milestones, in ms from navigation start. Bounded: a typo in a mark
 *  name must not grow this without limit. */
const marks = new Map();

/* --- helpers -------------------------------------------------------------- */

/** Round to a whole millisecond. Sub-millisecond precision is noise here and
 *  it is also, on its own, a fingerprinting surface. */
function ms(value) {
  return typeof value === 'number' && isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** Live observers, kept so snapshot() can drain them. See drainPending(). */
const observers = [];

/** Register one observer. Each call is independently wrapped: an observer type
 *  this browser does not know throws at observe(), and losing `longtask` on
 *  Safari must not also cost us LCP on Chrome. */
function observe(type, handler, extra) {
  try {
    const po = new PerformanceObserver((list) => {
      try {
        for (const entry of list.getEntries()) handler(entry);
      } catch {
        /* one bad entry never kills the observer */
      }
    });
    po.observe({ type, buffered: true, ...extra });
    observers.push({ po, handler });
  } catch {
    /* unsupported here; that metric is simply absent from the snapshot */
  }
}

/**
 * Deliver anything the browser has recorded but not yet handed over.
 *
 * ==> WITHOUT THIS, LCP IS FREQUENTLY ZERO, AND ZERO IS A LIE. <==
 * PerformanceObserver callbacks are queued, not synchronous. Largest
 * Contentful Paint in particular is only FINALISED when the page hides —
 * which is the exact moment snapshot() runs — so on a fast load the entry
 * routinely exists inside the browser and has never reached our handler.
 * Observed live on 2026-07-28: a desktop session recorded fcp 256ms and
 * lcp 0.
 *
 * A zero would then sit in an integer column next to real milliseconds and
 * quietly drag down every average computed from the table, which is worse
 * than a missing value because it looks like a fast one.
 *
 * takeRecords() returns the pending queue and empties it, so this is the
 * documented way to close that gap rather than a trick.
 */
function drainPending() {
  for (const { po, handler } of observers) {
    try {
      for (const entry of po.takeRecords()) handler(entry);
    } catch {
      /* one observer refusing to drain never costs the other metrics */
    }
  }
}

/**
 * Coarse platform bucket.
 *
 * A SMALL FIXED SET, NOT A PARSED USER AGENT. The question this has to answer
 * is "iPhone or not", and a six-value enum answers it. Anything finer is
 * fingerprinting for no diagnostic gain.
 */
function platform() {
  try {
    const ua = navigator.userAgent || '';
    /* iPadOS reports itself as a Mac; the touch-points check is the standard
     * way to tell a real Mac from an iPad, and an iPad belongs with iOS
     * because it shares the Safari engine that is under suspicion. */
    if (/iPhone|iPod/.test(ua)) return 'ios';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    if (/Macintosh/.test(ua)) return 'macos';
    if (/Windows/.test(ua)) return 'windows';
    if (/Linux|X11/.test(ua)) return 'linux';
    return 'other';
  } catch {
    return 'other';
  }
}

/**
 * Where this visit came from — HOSTNAME ONLY, never the full URL.
 *
 * ==> WHY IT IS HERE, AND WHY IT IS NOT A LOCATION FIELD. <==
 * On 2026-08-14 Landfall was posted to several forums and the traffic
 * tripled. Nothing in the table could say so. The arrival was inferred from
 * the phone-versus-laptop ratio — 69% iPhone against a 33% baseline — which
 * is guesswork dressed as analysis, and it would have been wrong if the same
 * spike had come from a newsletter.
 *
 * ==> HOSTNAME ONLY, AND THE TRUNCATION IS THE POINT. <==
 * A full referrer URL is a privacy problem wearing a diagnostic costume: the
 * path and query of the referring page can carry search terms, thread titles,
 * and in the worst case a session token somebody pasted. "reddit.com" cannot.
 * `new URL(...).hostname` discards everything after the host, so the
 * dangerous half is dropped HERE, on the device, and never travels.
 *
 * Empty string when the visit was typed, bookmarked, opened from the home
 * screen, or came from a referrer the browser refused to parse. Empty is the
 * common case and is not a failure.
 *
 * Measured against the contract in lib/telemetry.js: a site name is a
 * property of the LINK, not of the person who clicked it, and it is identical
 * for everyone who arrived the same way — so it cannot be joined back to
 * anybody. That is the bar, and it is why this one passes where a region
 * bucket does not.
 */
function refHost() {
  try {
    const raw = document?.referrer || '';
    if (!raw) return '';
    const host = new URL(raw).hostname || '';
    /* Same-origin referrers are our own navigations and say nothing about
     * where the visitor came from; they would also be the single most common
     * value and would bury the ones that matter. */
    if (host === location.hostname) return '';
    return host.slice(0, 64);
  } catch {
    /* an unparseable referrer is an empty column, not an exception */
    return '';
  }
}

/** Rendering engine, three values. Safari-versus-not is the axis that matters
 *  for a WebGL app; the exact version is not worth its entropy. */
function engine() {
  try {
    const ua = navigator.userAgent || '';
    if (/Edg\//.test(ua) || /Chrome\//.test(ua) || /Chromium/.test(ua)) return 'blink';
    if (/Firefox\//.test(ua)) return 'gecko';
    if (/Safari\//.test(ua)) return 'webkit';
    return 'other';
  } catch {
    return 'other';
  }
}

/* --- public --------------------------------------------------------------- */

/**
 * Start observing. Idempotent, and safe to call before anything has rendered.
 *
 * Called from the first line of boot alongside startTelemetry(), because
 * `buffered: true` only backfills entries the browser has already recorded —
 * register late and the early paint entries are simply gone.
 */
export function startPerf() {
  try {
    if (started) return;
    started = true;

    /* Read BEFORE any observer is registered — this is the state at the
     * earliest moment we get to look. 'prerender' counts as hidden: the page
     * is being built speculatively and nothing on it is being seen. */
    const vis = document?.visibilityState;
    hiddenAtStart = vis === 'hidden' || vis === 'prerender' ? 1 : 0;

    /* ==> ON `window`, IN THE CAPTURE PHASE. BOTH PARTS ARE LOAD-BEARING. <==
     * `visibilitychange` is the SAME event that ends the visit: lib/telemetry.js
     * listens for it and takes this module's snapshot when it fires. So if that
     * listener runs before this one, the flag below is still zero at the moment
     * it is read — and the column would report "never hidden" on every single
     * row, forever, while looking perfectly healthy.
     *
     * It would have. main.js calls startTelemetry() before startPerf(), and
     * listeners on the same target fire in registration order, so the obvious
     * `document.addEventListener(...)` version of this was already broken when
     * it was written.
     *
     * The event is fired at `document` and it bubbles, so the propagation path
     * runs window (capture) -> document (target) -> window (bubble). A capture
     * listener on `window` is therefore guaranteed to run BEFORE anything
     * listening on `document`, whatever order the modules were started in.
     * That is a property of the DOM, not of our boot sequence, which is the
     * point — reordering main.js cannot silently break this again.
     *
     * FIRST hide only, never overwritten: a visit that dips out of sight and
     * comes back has already invalidated its load timings, and the later hides
     * add nothing. */
    window.addEventListener('visibilitychange', () => {
      try {
        if (document.visibilityState === 'hidden' && !firstHiddenMs) {
          firstHiddenMs = ms(performance.now());
        }
      } catch {
        /* a missing flag is a missing column, not a broken app */
      }
    }, { capture: true });

    observe('largest-contentful-paint', (e) => {
      /* renderTime is absent on cross-origin resources without Timing-Allow-
       * Origin; loadTime is the documented fallback and startTime is the
       * union of the two. */
      lcpMs = ms(e.startTime);
    });

    observe('longtask', (e) => {
      longTaskCount += 1;
      longTaskTotalMs += e.duration || 0;
    });

    /* durationThreshold keeps the callback off the hot path: the browser only
     * reports interactions already slow enough to be worth hearing about, so
     * a fast-tapping user does not generate a callback per tap. */
    observe('event', (e) => {
      const d = e.duration || 0;
      if (d > worstEventMs) worstEventMs = d;
    }, { durationThreshold: PERF.eventThresholdMs });
  } catch {
    /* No perf data this session. The app is unaffected, which is the point. */
  }
}

/**
 * Record an app milestone.
 *
 * These are the numbers Cloudflare cannot give you: not "the page painted"
 * but "the globe became touchable", "storm data arrived", "a storm was
 * actually on screen". The gaps BETWEEN them are where the 8.6 seconds is
 * hiding.
 *
 * First write wins — these are one-time milestones, and a restyle re-running
 * boot code must not overwrite the real boot timing with a later one.
 *
 * @param {string} name Short fixed key. See PERF.marks for the allowed set.
 */
export function mark(name) {
  try {
    if (!PERF.marks.includes(name)) return;
    if (marks.has(name)) return;
    if (marks.size >= PERF.maxMarks) return;
    marks.set(name, ms(performance.now()));

    /* Freeze the blocked-time totals as they stand at this milestone. The
     * last milestone to fire wins, so what survives is the cost of the boot
     * rather than of the whole visit. See the declaration for why the two
     * must never be collapsed into one column. */
    bootLongTaskCount = longTaskCount;
    bootLongTaskMs = longTaskTotalMs;
  } catch {
    /* a missing mark is a missing column, not a broken app */
  }
}

/**
 * Record that a WebGL context was lost.
 *
 * Deliberately a COUNTER RESET TO A FLAG rather than a count: one loss and
 * five losses are the same finding — this device could not hold the globe.
 */
export function noteWebglLoss() {
  try {
    webglLost = 1;
  } catch {
    /* unreachable, but this module never throws on principle */
  }
}

/**
 * The whole session as one flat object of numbers and short strings.
 *
 * ==> FLAT AND FIXED ON PURPOSE. <==
 * Every key here is written out by hand and every value is a number or a
 * short enum. There is no nesting, no spread, and nothing derived from
 * caller input — the same rule lib/telemetry.js enforces for events, applied
 * to the thing that feeds it. A field cannot arrive here by accident.
 *
 * @returns {object}
 */
export function snapshot() {
  try {
    /* FIRST, before reading anything. The browser may be holding entries it
     * has recorded and not yet delivered — most importantly the final LCP,
     * which it only settles as the page hides, which is now. */
    drainPending();

    const nav = performance.getEntriesByType?.('navigation')?.[0] || null;
    const paint = performance.getEntriesByType?.('paint') || [];
    const fcp = paint.find((p) => p.name === 'first-contentful-paint');
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;

    return {
      /* --- environment ------------------------------------------------- */
      platform: platform(),
      engine: engine(),
      /* Hostname only, and empty for a direct or same-origin visit. See
       * refHost() for why this is not the location field it looks like. */
      ref_host: refHost(),

      /* --- how the page was reached ------------------------------------ */
      /* navigate | reload | back_forward | prerender. A reload-heavy sample
       * means somebody was fighting the app, which changes how to read the
       * timings above it. */
      nav_type: String(nav?.type || 'navigate').slice(0, 16),
      /* ZERO MEANS IT CAME FROM CACHE. This is the field that separates
       * "first-time visitor downloading the whole map library" from
       * "returning user with everything warm" — and forum traffic is almost
       * entirely the former, which is exactly the population that was slow. */
      transfer_bytes: ms(nav?.transferSize),
      /* Whether a service worker was already installed and controlling this
       * load. The other half of the cold-versus-warm question, and the one
       * that says whether the PWA cache is actually doing its job. */
      sw_controlled: navigator.serviceWorker?.controller ? 1 : 0,

      /* --- browser-reported load timings -------------------------------- */
      ttfb_ms: ms(nav?.responseStart),
      fcp_ms: ms(fcp?.startTime),
      lcp_ms: lcpMs,
      dcl_ms: ms(nav?.domContentLoadedEventEnd),
      load_ms: ms(nav?.loadEventEnd),

      /* --- the app's own milestones ------------------------------------- */
      /* The vendored MapLibre + Three have finished running and the app's own
       * code is starting. `fcp` -> here is the browser digesting 1.5 MB of
       * library; here -> `globe` is us building the map. */
      t_scripts_ms: marks.get('scripts') || 0,
      t_globe_ms: marks.get('globe') || 0,
      t_data_ms: marks.get('data') || 0,
      t_storms_ms: marks.get('storms') || 0,

      /* --- is any of the above trustworthy? ------------------------------ */
      /* Read these FIRST when reading a row. See the declaration above. */
      hidden_at_start: hiddenAtStart,
      first_hidden_ms: firstHiddenMs,

      /* --- how it felt once running ------------------------------------- */
      /* ==> `longtask_*` IS THE WHOLE VISIT. `boot_longtask_*` IS THE BOOT.
       *     NEVER COMPARE THE FORMER AGAINST A LOAD TIMING. <== */
      longtask_n: longTaskCount,
      longtask_ms: ms(longTaskTotalMs),
      boot_longtask_n: bootLongTaskCount,
      boot_longtask_ms: ms(bootLongTaskMs),
      /* The denominator for the two above. Read now, at the end of the visit. */
      visit_ms: ms(performance.now()),
      worst_event_ms: ms(worstEventMs),
      webgl_lost: webglLost,

      /* --- connection ---------------------------------------------------- */
      conn_type: String(conn?.effectiveType || '').slice(0, 8),
      conn_rtt: ms(conn?.rtt),
      conn_down: conn?.downlink ? Math.round(conn.downlink * 10) : 0, // tenths of Mbps
      save_data: conn?.saveData ? 1 : 0,

      /* --- device -------------------------------------------------------- */
      /* ==> ADDED 2026-07-28 AS A DELIBERATE DECISION. <==
       * These are fingerprinting ingredients and they were included with that
       * understood, to answer whether slow iPhones are simply OLD iPhones —
       * a question nothing else here can answer. There is still no identifier
       * of any kind, and home coordinates still never appear in this payload.
       * See SPEC §17. Do not extend this block without the same conversation. */
      screen_w: ms(screen?.width),
      screen_h: ms(screen?.height),
      dpr: window.devicePixelRatio ? Math.round(window.devicePixelRatio * 10) : 0, // tenths
      mem_gb: ms(navigator.deviceMemory),
      cores: ms(navigator.hardwareConcurrency),
    };
  } catch {
    /* A snapshot that throws would take the whole beacon with it. An empty
     * object costs one row of columns, not the session. */
    return {};
  }
}
