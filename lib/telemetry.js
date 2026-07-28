/**
 * telemetry.js — how Aaron finds out Landfall is broken. SPEC §17 A5.
 *
 * ==> THE PROBLEM IT SOLVES <==
 * Until 2026-07-25 there was no error reporting of any kind. A failure was
 * visible only when Aaron looked at his own phone. For one user that is fine
 * — he IS the monitoring. For a public app it is the whole problem: Landfall
 * can be dead for an entire region and the first signal is somebody
 * complaining, during the storm, when it is too late to matter.
 *
 * ==> WHAT IT SENDS, AND WHY FEED HEALTH BEATS STACK TRACES <==
 * Four kinds of event, and the third is the reason this file exists:
 *   - `error`      an uncaught exception
 *   - `rejection`  an unhandled promise rejection
 *   - `source`     A SOURCE CHANGED STATE (§5's three states)
 *   - `session`    one summary of the whole visit, sent once at the end
 *
 * The `session` event carries load timings, device and connection context,
 * and plain counts of what was used — see lib/perf.js and lib/usage.js. It is
 * built by a callback main.js registers rather than by importing those
 * modules here, so this file keeps its config-only imports and cannot be
 * broken by a fault in either of them.
 *
 * The first two are ordinary. The third is the one worth paging on: a feed
 * flipping to `unavailable` is the failure this app's entire failure
 * philosophy is built around, and it usually happens with NO exception thrown
 * anywhere — the fetch returns, the parse succeeds, the data is simply gone.
 * A crash reporter would see a perfectly healthy app. Reporting the state
 * machine is reporting the thing that actually goes wrong.
 *
 * ============================================================================
 * ==> THE PRIVACY CONTRACT. NOT NEGOTIABLE, AND NOT A SETTING. <==
 * ============================================================================
 * HOME COORDINATES NEVER LEAVE THE DEVICE. Not exact, not rounded, not
 * coarsened to a city, not bucketed to a region, not hashed. No user id, no
 * session id, no cross-visit identifier, nothing that could be joined back to
 * a person.
 *
 * This is not caution, it is the product. Landfall has no accounts and stores
 * home on the device (§2, §8), and once there is anything to sell that is one
 * of the few things a competitor with an ad model structurally cannot copy.
 * A telemetry module is exactly where a promise like that gets quietly
 * broken, one useful-seeming field at a time, so the rule is stated here in
 * the file that would break it: EVERY FIELD IS GUILTY UNTIL PROVEN IT CANNOT
 * BE JOINED BACK TO A PERSON. If a future field needs an argument for why it
 * is safe, it is not safe.
 *
 * The allowlist below is the enforcement, not this comment. Events are built
 * field by field from fixed keys — never spread, never `JSON.stringify(obj)`
 * of something a caller handed in — so a field cannot arrive by accident.
 *
 * ==> IT CANNOT BREAK THE APP. <==
 * A telemetry module that throws is worse than no telemetry at all: it turns
 * a cosmetic bug into a dead page, and it does it inside the error handler,
 * where nothing is left to catch it. Every public function here is wrapped
 * and swallows its own failures. It never blocks a frame, never awaits on the
 * render path, and holds a bounded queue — a poll storm cannot turn into a
 * beacon storm (§17's rule about client bugs becoming traffic).
 *
 * Imports: config/ only. Wired by main.js; never imported by a render path.
 */

import { TELEMETRY } from '../config/constants.js';

/* --- state ---------------------------------------------------------------- */

/** Bounded queue. Drops OLDEST on overflow — during a cascade the newest
 *  events describe the current state, and the first ten are the same failure
 *  ten times. */
let queue = [];

/** Per-session send budget. A runaway loop firing thousands of errors must
 *  not become thousands of requests; past this ceiling the module goes quiet
 *  for the rest of the session and says so once. */
let sent = 0;
let silenced = false;

/** Deduplication. The same exception thrown every animation frame is one
 *  fact, not six hundred. Keyed by everything that makes two events
 *  DIFFERENT, cleared per flush — see dedupeKey() for why that wording is
 *  load-bearing. */
let seen = new Set();

let started = false;
let sampled = false;

/** Supplies the one-per-visit summary. Registered by main.js via
 *  setSessionSnapshot(); null until then, and a null source simply means no
 *  session row — never an error. */
let sessionSource = null;

/** The summary is sent ONCE, ever.
 *
 * ==> WHY ONCE, AND WHAT THAT COSTS. <==
 * The only reliable end-of-visit signal on mobile Safari is
 * `visibilitychange` -> hidden, and a phone user backgrounds an app
 * constantly. Sending on every hide would write a row per background and
 * inflate every count; with no session identifier — deliberately, see the
 * privacy contract above — those rows could not be collapsed afterwards.
 *
 * So: the FIRST hide wins. Load timings are complete long before then, which
 * is what this was built for. The honest cost is that actions taken after the
 * first background are not counted, so usage numbers are a FLOOR, not a
 * total. Read them that way. */
let sessionSent = false;

/* --- helpers -------------------------------------------------------------- */

/**
 * Trim and cap a string field.
 *
 * The cap is not politeness — an unbounded message field is how a page's own
 * DOM or a URL containing who-knows-what ends up in a log.
 */
function clip(value, max) {
  if (typeof value !== 'string') return '';
  return value.slice(0, max);
}

/**
 * A stack trace with anything that is not our own code stripped out.
 *
 * Frames carry full URLs, and a URL can carry a query string. Ours cannot
 * today — but "our URLs have no secrets in them" is a property that holds
 * until somebody adds a parameter, and this file must not be the thing that
 * has to be remembered at that moment. So: keep the path, drop the origin,
 * drop everything after `?` or `#`, and keep only the first few frames.
 */
function safeStack(err) {
  const raw = typeof err?.stack === 'string' ? err.stack : '';
  if (!raw) return '';
  return raw
    .split('\n')
    .slice(0, TELEMETRY.stackFrames)
    .map((line) =>
      line
        .replace(/https?:\/\/[^/\s)]+/g, '')
        .replace(/[?#][^\s)]*/g, '')
        .trim()
    )
    .join(' | ')
    .slice(0, TELEMETRY.maxStackChars);
}

/**
 * Queue one event.
 *
 * PRIVATE, and every caller below builds its payload from fixed keys. There
 * is deliberately no exported "send anything" function — that is the door
 * through which an unreviewed field would arrive.
 */
/**
 * The de-duplication key.
 *
 * ==> IT MUST CONTAIN EVERYTHING THAT MAKES TWO EVENTS DIFFERENT. <==
 * This function exists because that was once not true, and the failure it
 * caused is the worst one this module can have.
 *
 * The key used to be `kind + (message || source)`. A source event carries no
 * message, so every event about NHC — whatever had happened to it — collapsed
 * to the single key `source:nhc`. The FIRST state a source reported in a
 * flush window was kept and every later one was silently discarded as a
 * repeat. In practice that meant:
 *
 *   loading      -> queued
 *   ok           -> DROPPED, looked like a repeat
 *   unavailable  -> DROPPED, looked like a repeat
 *
 * and because reportSource() queues BEFORE it flushes, an outage then shipped
 * the stale `loading` row. **A dead feed was reported as still loading** —
 * the one signal this whole module exists to send, quietly replaced by a
 * meaningless one. Confirmed on live data 2026-07-27: six sampled sessions,
 * every row `loading`, not one `ok`.
 *
 * Status is therefore part of the key, and any field added later that changes
 * what an event MEANS belongs here too. The rule is not "key by message" — it
 * is "two events that say different things must not collide."
 *
 * @param {string} kind
 * @param {{message?: string, source?: string, status?: string}} fields
 * @returns {string}
 */
function dedupeKey(kind, fields) {
  return [kind, fields.message || '', fields.source || '', fields.status || ''].join('|');
}

function push(kind, fields) {
  if (silenced || !sampled) return;

  const key = dedupeKey(kind, fields);
  if (seen.has(key)) return;
  seen.add(key);

  if (queue.length >= TELEMETRY.maxQueue) queue.shift();
  queue.push({ k: kind, ...fields });
}

/**
 * Send whatever is queued, and forget it.
 *
 * `sendBeacon` and not `fetch`: it survives the page being closed, which is
 * exactly when the interesting failures get reported, and the browser
 * schedules it off the critical path so it cannot cost a frame.
 */
function flush() {
  if (!queue.length || silenced) return;

  const batch = queue;
  queue = [];
  seen = new Set();

  sent += 1;
  if (sent > TELEMETRY.maxSendsPerSession) {
    silenced = true;
    return;
  }

  try {
    const body = JSON.stringify({
      v: 1,
      /* App build identity, NOT a user identity — it is the same string for
       * everyone on this deploy, which is the whole point. */
      app: TELEMETRY.appVersion,
      /* Which of the app's own surfaces the session is in. Standalone versus
       * browser tab changes which bugs are even possible (§14 Phase 5), and
       * it is a single bit that describes the APP, not the person. */
      standalone: isStandalone(),
      events: batch,
    });

    navigator.sendBeacon?.(TELEMETRY.endpoint, new Blob([body], { type: 'application/json' }));
  } catch {
    /* A failed beacon is not worth a second attempt and definitely not worth
     * an exception on the way out of the page. */
  }
}

function isStandalone() {
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
      navigator.standalone === true
    );
  } catch {
    return false;
  }
}

/**
 * Queue the one-per-visit summary, if there is one and it has not gone yet.
 *
 * Called immediately before the final flush rather than on a timer, so the
 * numbers are as late as they can be while still being sendable.
 */
function pushSessionOnce() {
  try {
    if (sessionSent || silenced || !sampled || !sessionSource) return;
    sessionSent = true;

    const fields = sessionSource();
    if (!fields || typeof fields !== 'object') return;

    /* Spread is safe HERE and nowhere else in this file: `fields` comes from
     * our own perf/usage snapshots, which build themselves key by key from
     * fixed lists — it is never caller input. The server rebuilds every field
     * from its own allowlist regardless (functions/api/beacon.js), so this is
     * the second of two gates, not the only one. */
    push('session', fields);
  } catch {
    /* a missing summary is a missing row, never a broken page-hide */
  }
}

/** Both end-of-visit paths do the same two things, so they share one function
 *  — a `pagehide` that forgot to send the summary would be a silent gap that
 *  only shows up as missing desktop data weeks later. */
function endOfVisit() {
  pushSessionOnce();
  flush();
}

/* --- public --------------------------------------------------------------- */

/**
 * Register the source of the per-visit summary.
 *
 * A CALLBACK RATHER THAN AN IMPORT, deliberately. This module is the one that
 * must work when nothing else does; importing lib/perf.js would mean a fault
 * there could take error reporting down with it. main.js is the composition
 * root and this is composition.
 *
 * @param {() => object} fn Returns a flat object of numbers and short strings.
 */
export function setSessionSnapshot(fn) {
  try {
    if (typeof fn === 'function') sessionSource = fn;
  } catch {
    /* see the header: this module cannot be the reason anything breaks */
  }
}

/**
 * Report a source-state change. THE EVENT THAT MATTERS MOST.
 *
 * Called from the store's subscription in main.js on a real transition only —
 * not every poll — because a source that has been down for an hour is one
 * fact, and re-reporting it every 5 minutes buries the moment it broke.
 *
 * @param {string} source  'nhc' | 'gdacs' — which feed.
 * @param {string} status  'ok' | 'unavailable' | 'loading'.
 * @param {string} [reason] Short machine code from the store, never prose and
 *        never a raw exception (§5: errors surface in human language at the
 *        UI, in codes everywhere else).
 */
export function reportSource(source, status, reason) {
  try {
    push('source', {
      source: clip(source, 16),
      status: clip(status, 16),
      reason: clip(reason, TELEMETRY.maxMessageChars),
    });
    /* Flush a source failure IMMEDIATELY rather than waiting for the page to
     * be hidden. This is the signal Aaron is meant to act on, and a user
     * whose app just went blank may never background the tab at all — they
     * close it. */
    if (status === 'unavailable') flush();
  } catch {
    /* see the header: this module cannot be the reason anything breaks */
  }
}

/**
 * Start listening. Idempotent; safe to call before the app has rendered.
 *
 * @param {object} [opts]
 * @param {number} [opts.sampleRate] 0..1. Overrides the constant — used by
 *        the headless tests to force capture on.
 */
export function startTelemetry(opts = {}) {
  try {
    if (started) return;
    started = true;

    /* SAMPLING IS DECIDED ONCE PER SESSION, not per event. Sampling each
     * event independently would give a partial picture of a single broken
     * session — half its errors — which is worse than either having it or
     * not. One coin flip at boot means a captured session is captured whole.
     *
     * Math.random() is correct here and is not a seeding problem: nothing
     * about this needs to be reproducible. */
    const rate = typeof opts.sampleRate === 'number' ? opts.sampleRate : TELEMETRY.sampleRate;
    sampled = Math.random() < rate;
    if (!sampled) return;

    window.addEventListener('error', (e) => {
      try {
        push('error', {
          message: clip(e?.message, TELEMETRY.maxMessageChars),
          stack: safeStack(e?.error),
        });
      } catch {
        /* never rethrow inside an error handler */
      }
    });

    window.addEventListener('unhandledrejection', (e) => {
      try {
        const r = e?.reason;
        push('rejection', {
          message: clip(typeof r === 'string' ? r : r?.message, TELEMETRY.maxMessageChars),
          stack: safeStack(r),
        });
      } catch {
        /* as above */
      }
    });

    /* `visibilitychange` -> hidden, NOT `unload`: unload does not fire
     * reliably on mobile Safari, which is most of this app's traffic. This
     * is the standard-and-actually-works pairing with sendBeacon. */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') endOfVisit();
    });

    /* Belt and braces for desktop, where a tab can go straight to closed. */
    window.addEventListener('pagehide', endOfVisit);
  } catch {
    /* If wiring itself fails the app simply has no telemetry, which is where
     * it was yesterday. It does not get a broken boot out of it. */
  }
}

/** Test seam — the headless check asserts the queue never carries a home
 *  coordinate. Not used by the app. */
export function _drainForTest() {
  const out = queue.slice();
  queue = [];
  seen = new Set();
  return out;
}
