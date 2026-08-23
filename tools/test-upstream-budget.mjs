#!/usr/bin/env node
/**
 * test-upstream-budget.mjs — a slow upstream must never outlast the reader.
 *
 * ==> WHAT THIS GUARDS, IN ONE SENTENCE. <== Every relay route that goes to
 * gdacs.org caps how long it will wait, so that when GDACS is slow the route
 * gives up and serves the copy it already holds — instead of holding the line
 * until the PHONE gives up first and gets nothing at all.
 *
 * ---------------------------------------------------------------------------
 * THE OUTAGE THIS FILE EXISTS BECAUSE OF (2026-08-23)
 *
 * `functions/api/gdacs/geometry.js` had no cap. GDACS was intermittently taking
 * longer than thirty seconds; the route waited, and `POLL.fetchTimeout` (30 s,
 * client side) fired first. Every non-US storm lost its cone, its track and its
 * wind field on the globe, while the storm list beside it was perfectly healthy
 * — the list comes off a different route, which HAD the cap.
 *
 * ==> AND THE ROUTE'S OWN LAST-GOOD FALLBACK WAS ALREADY WRITTEN AND CORRECT.
 * <== `cache.match(lastGoodKey)`, the warm-copy path under it, and the honest
 * 502 under that. None of it could ever execute: the client had hung up long
 * before control reached those lines. **A fallback below an uncapped wait is
 * unreachable code, and unreachable code passes every test that does not
 * measure the wait.** That is the specific hole this file fills.
 *
 * It is the DOLPHIN-26 bug (SPEC-DATA §4, 2026-08-01) on the route that did not
 * get the fix. That fix went into the two STORM LISTS under the parity rule
 * "no data behaviour is finished until both sources have it" — read as a rule
 * about SOURCES, so a third route on a source that already had it was missed.
 * ==> CASE B BELOW RESTATES THE PARITY RULE AS BEING ABOUT ROUTES, so the next
 * route to talk to a slow upstream fails here rather than during a typhoon. <==
 *
 * ---------------------------------------------------------------------------
 * TWO CASES
 *
 *   A. BEHAVIOURAL. Drive the real `onRequestGet` with an upstream that never
 *      answers and a colo cache holding a last-good copy. The route must come
 *      back with that copy, flagged stale. Mutation-verified: delete `signal:`
 *      from the fetch call and this case reports HUNG.
 *
 *   B. STRUCTURAL. Every GDACS route declares a budget, and every budget has
 *      real headroom under the client's own abort. Cheap, and it is the half
 *      that catches a NEW route rather than a regression in an old one.
 *
 * ==> CASE A CANNOT BE ALLOWED TO HANG WHEN IT FAILS. <== A suite that hangs is
 * worse than a red one (§12): it blocks whatever runs it and names nothing —
 * `test-genesis.mjs` is already doing that and it costs a session every time.
 * So the route is raced against a 2 s watchdog and a timeout is a FAILED
 * ASSERTION with a sentence attached, never a stall.
 *
 * Zero dependencies (§12). Run: node tools/test-upstream-budget.mjs
 */

import { readFileSync } from 'node:fs';
import { POLL } from '../config/constants.js';

let pass = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) { pass++; return; }
  failures.push(msg);
  console.error(`  FAIL  ${msg}`);
}

const section = (s) => console.log(`\n  ${s}\n`);

/* ---------------------------------------------------------------------------
 * CASE A — a hanging upstream yields the last-good copy, not a stall
 * ------------------------------------------------------------------------- */

section('a GDACS that never answers must not outlast the reader');

const GEOM_URL =
  'https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1000123';

const LAST_GOOD = '{"type":"FeatureCollection","features":[{"lastGood":true}]}';

/**
 * The stub upstream: a fetch that resolves only when its signal aborts.
 *
 * ==> IT REJECTS ON ABORT RATHER THAN RESOLVING, BECAUSE THAT IS WHAT THE
 * PLATFORM DOES. <== An aborted `fetch` rejects with an AbortError, and the
 * route's `catch` is what routes control to the last-good path. A stub that
 * resolved would test a code path that does not exist in production.
 *
 * ==> AND IT IGNORES THE SIGNAL ENTIRELY IF IT IS NOT GIVEN ONE. <== That is
 * the mutation this case is built to catch: with `signal:` removed from the
 * route, nothing here ever settles, and the watchdog below turns that into a
 * named failure instead of a hung suite.
 */
function installHangingFetch() {
  let sawSignal = false;
  globalThis.fetch = (_url, init) => {
    const signal = init && init.signal;
    if (signal) sawSignal = true;
    return new Promise((_resolve, reject) => {
      if (!signal) return; // never settles — the un-capped case
      if (signal.aborted) {
        reject(new Error('aborted'));
        return;
      }
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  };
  return () => sawSignal;
}

/** A colo cache that misses on the fresh slot and hits on last-good.
 *
 *  Keyed on the URL rather than answering everything, because the route checks
 *  the FRESH slot first and a stub that answered that one would return before
 *  ever reaching the fetch this case is about. */
const cacheWithLastGood = () => ({
  match: async (key) => {
    if (!String(key.url || key).includes('/last-good/')) return null;
    return new Response(LAST_GOOD, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Landfall-Fetched-At': new Date(Date.now() - 3600 * 1000).toISOString(),
        'Cache-Control': 's-maxage=43200',
      },
    });
  },
  put: async () => {},
});

/** Fire any timer of a second or more immediately, so a 10-second budget does
 *  not cost this suite ten seconds.
 *
 *  ==> THIS SHORTENS THE CLOCK, IT DOES NOT REMOVE THE CAP. <== The route still
 *  has to CREATE a timer and still has to hand its signal to `fetch`; a route
 *  with no cap creates nothing for this to shorten and still hangs. So the
 *  mutation stays catchable. The exact 10 s value is Case B's job, not this
 *  one's — asserting a real ten-second wall clock here would buy nothing and
 *  cost ten seconds on every run. */
function installFastClock() {
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) =>
    (ms >= 1000 ? real(fn, 0, ...rest) : real(fn, ms, ...rest));
  return () => { globalThis.setTimeout = real; };
}

/** The watchdog. Never let a failure become a stall.
 *
 *  ==> IT HOLDS ITS OWN REFERENCE TO THE REAL `setTimeout`, TAKEN AT MODULE
 *  LOAD. <== `installFastClock` collapses every timer of a second or more to
 *  zero, and the watchdog's own two seconds is one of those — so a shared
 *  global would fire it instantly and report EVERY run as hung, including the
 *  passing ones. Found by running it: the first version failed against a route
 *  that was already fixed. */
const REAL_SET_TIMEOUT = globalThis.setTimeout;
const HUNG = Symbol('hung');

/** ==> THE TIMER IS NOT `unref`ed, AND THAT IS THE SECOND THING THIS WATCHDOG
 *  GOT WRONG BEFORE IT WORKED. <== With `unref()` node has nothing left to wait
 *  on the moment the route's promise stops settling, so the process EXITS —
 *  quietly, code 0, with only a "detected unsettled top-level await" notice
 *  that no CI loop reads as a failure. The mutation run that proved this
 *  produced a green exit over a broken route, which is the exact class §12
 *  calls worse than no test. A referenced timer holds the process open the full
 *  two seconds, resolves HUNG, and the assertion goes red with a sentence on
 *  it. `cancel()` puts the two seconds back on the passing path. */
function watchdog(ms) {
  let t;
  const promise = new Promise((resolve) => { t = REAL_SET_TIMEOUT(() => resolve(HUNG), ms); });
  return { promise, cancel: () => clearTimeout(t) };
}

{
  const realFetch = globalThis.fetch;
  const sawSignal = installHangingFetch();
  const restoreClock = installFastClock();

  const { onRequestGet } = await import('../functions/api/gdacs/geometry.js');

  globalThis.caches = { default: cacheWithLastGood() };

  const context = {
    request: new Request(
      `https://landfall.test/api/gdacs/geometry?url=${encodeURIComponent(GEOM_URL)}`
    ),
    env: {},
    waitUntil: () => {},
  };

  const dog = watchdog(2000);
  const res = await Promise.race([onRequestGet(context), dog.promise]);
  dog.cancel();

  restoreClock();
  globalThis.fetch = realFetch;

  ok(
    res !== HUNG,
    'a hanging GDACS is abandoned and the route answers — it did NOT. The upstream '
      + 'fetch in functions/api/gdacs/geometry.js has no abort signal, so the client '
      + 'times out first and every non-US storm loses its geometry.'
  );

  if (res !== HUNG) {
    ok(sawSignal(), 'the upstream fetch is given an AbortSignal');
    ok(res.status === 200, `a last-good copy is served, not an error (got ${res.status})`);
    ok(
      res.headers.get('X-Landfall-Stale') === 'true',
      'the served copy is flagged stale so the client can show its age (SPEC §5)'
    );
    const body = await res.text();
    ok(body === LAST_GOOD, 'the body is the last-good copy the cache was holding');
  }
}

/* ---------------------------------------------------------------------------
 * CASE B — every GDACS route caps its wait, with headroom under the client
 * ------------------------------------------------------------------------- */

section('every route that talks to gdacs.org declares a budget');

/** ==> THE ROUTES CANNOT IMPORT `config/constants.js` AND THIS FILE CAN. <==
 *  Pages Functions run in their own workerd runtime with no bundler, so each
 *  route mirrors its numbers by hand. That hand-mirroring is exactly what
 *  drifts, so the comparison lives here, in a test that CAN see both sides —
 *  the same arrangement `tools/test-relay-mirrors.mjs` uses for the cache
 *  table. */
const GDACS_ROUTES = [
  'functions/api/gdacs/geometry.js',
  'functions/api/gdacs/events.js',
];

for (const path of GDACS_ROUTES) {
  const src = readFileSync(path, 'utf8');

  const decl = src.match(/const\s+UPSTREAM_BUDGET_MS\s*=\s*([^;]+);/);
  ok(!!decl, `${path} declares UPSTREAM_BUDGET_MS`);
  if (!decl) continue;

  /* `10 * 1000` and friends. Evaluated rather than pattern-matched so the
   *  routes stay free to spell the number however reads best. */
  let ms = null;
  try {
    ms = Number(new Function(`return (${decl[1]});`)());
  } catch { /* falls through to the assertion below */ }
  ok(Number.isFinite(ms) && ms > 0, `${path}: UPSTREAM_BUDGET_MS is a real number`);
  if (!Number.isFinite(ms)) continue;

  /* ==> HALF THE CLIENT'S ABORT, NOT JUST UNDER IT. <== A budget of 29 s
   * against a 30 s client is arithmetically "inside" and practically a coin
   * flip — which is the DOLPHIN-26 failure exactly: 20 s against 20 s, four
   * attempts, four aborts. The margin has to cover the rest of the round trip
   * (TLS, the colo, the last-good read that happens AFTER the budget blows)
   * and it has to be big enough that nobody ever has to think about it. */
  ok(
    ms <= POLL.fetchTimeout / 2,
    `${path}: budget ${ms} ms must be at most half the client's `
      + `${POLL.fetchTimeout} ms abort, so the route always loses the race first`
  );

  /* The signal has to actually reach the fetch. A constant nobody passes is
   * the shape this whole file exists to catch. */
  ok(
    /signal:\s*\w+\.signal/.test(src),
    `${path}: the budget's AbortSignal is passed to fetch()`
  );
}

/* ------------------------------------------------------------------------- */

console.log(`\n  ${pass} assertions passed, ${failures.length} failed\n`);
if (failures.length) process.exit(1);
