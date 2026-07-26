#!/usr/bin/env node
/**
 * test-imagery-retry.mjs — the automatic retry, against a fake clock.
 *
 * ===> WHY THIS IS WORTH A SUITE. <===
 * Measured on the deployed relay 2026-07-26: six of seven genuinely cold
 * satellite fetches did not answer inside the relay's 20 s deadline. Before
 * this, a disc that lost that race was marked failed and NOTHING asked again
 * until the five-minute poll. Aaron watched a storm sit blank, walked away, and
 * found the imagery there when he got back.
 *
 * Retry logic is the kind that looks right and is wrong in the timing: a leak
 * that stacks a timer per failure, a schedule that never resets so the second
 * outage starts at 45 s, a timer that survives its own disc and fetches on
 * behalf of a record that no longer exists. None of those throw. All of them
 * are visible here.
 *
 * WHAT THIS DOES NOT COVER: whether GIBS actually answers the second time.
 * That is the vendor's business and was measured by hand — the argument for
 * why a retry helps lives in map/imagery.js's scheduleRetry() header.
 *
 * The module under test is DOM-bound, so rather than stub a map, a canvas and
 * an image decoder, this exercises the SCHEDULE as the module implements it:
 * the same POLL.retryBackoff table, the same one-pending-attempt rule, the same
 * guards, against a clock that never really waits. Ported deliberately — if
 * scheduleRetry's shape changes, this file has to change with it.
 *
 * Zero dependencies (§12). Run: node tools/test-imagery-retry.mjs
 */

import { POLL } from '../config/constants.js';

let passed = 0;
const failures = [];
const ok = (label, cond) => {
  if (cond) { passed++; return; }
  failures.push(label);
  console.error(`  ✗ ${label}`);
};
const eq = (label, a, b) =>
  ok(`${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, a === b);
const group = (n) => console.log(`\n  ${n}`);

/* --- a clock that does not tick on its own -------------------------------- */
function makeClock() {
  let now = 0;
  let seq = 0;
  const pending = new Map(); // id -> {at, fn}
  return {
    now: () => now,
    setTimeout(fn, delay) { pending.set(++seq, { at: now + delay, fn }); return seq; },
    clearTimeout(id) { pending.delete(id); },
    pendingCount: () => pending.size,
    /** Advance to `t`, firing everything due, in time order. */
    advanceTo(t) {
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, x]) => x.at <= t)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, x] = due;
        pending.delete(id);
        now = x.at;
        x.fn();
      }
      now = t;
    },
  };
}

/**
 * The harness — scheduleRetry / cancelRetry as map/imagery.js implements them,
 * with the module's ambient state (destroyed / mode / discs / hidden) as knobs.
 */
function makeWorld() {
  const clock = makeClock();
  const discs = new Map();
  const world = {
    clock, discs,
    destroyed: false, mode: 'satellite', hidden: false,
    loads: [], // storm ids loadDisc was called with
  };

  world.newDisc = (id) => {
    const rec = { failed: false, retryTimer: null, retryStep: 0 };
    discs.set(id, rec);
    return rec;
  };

  world.cancelRetry = (rec) => {
    if (rec?.retryTimer) clock.clearTimeout(rec.retryTimer);
    if (rec) { rec.retryTimer = null; rec.retryStep = 0; }
  };

  world.scheduleRetry = (storm, rec) => {
    if (rec.retryTimer) return;
    const delay = POLL.retryBackoff[rec.retryStep];
    if (delay == null) return;
    rec.retryStep += 1;
    rec.retryTimer = clock.setTimeout(() => {
      rec.retryTimer = null;
      if (world.destroyed || world.mode === 'off') return;
      if (discs.get(storm.id) !== rec) return;
      if (world.hidden) return;
      if (!rec.failed) return;
      world.loads.push(storm.id);
    }, delay);
  };

  /** A failure, as the catch block records it. */
  world.failDisc = (storm, rec) => { rec.failed = true; world.scheduleRetry(storm, rec); };
  /** A success, as the try block records it. */
  world.succeedDisc = (rec) => { rec.failed = false; world.cancelRetry(rec); };
  return world;
}

const S = { id: 'gdacs:1000123' };
const [D1, D2, D3] = POLL.retryBackoff;

/* --- the schedule itself -------------------------------------------------- */
group('the backoff table');
eq('three attempts are configured', POLL.retryBackoff.length, 3);
ok('and they increase', D1 < D2 && D2 < D3);
ok('the first is fast enough to matter (<=10s)', D1 <= 10_000);

group('a failure retries on the backoff schedule');
{
  const w = makeWorld();
  const rec = w.newDisc(S.id);
  w.failDisc(S, rec);

  w.clock.advanceTo(D1 - 1);
  eq('nothing before the first delay', w.loads.length, 0);
  w.clock.advanceTo(D1);
  eq('first retry fires', w.loads.length, 1);

  /* The retry itself fails again — the catch runs a second time. */
  w.failDisc(S, rec);
  w.clock.advanceTo(D1 + D2);
  eq('second retry fires at the next step', w.loads.length, 2);

  w.failDisc(S, rec);
  w.clock.advanceTo(D1 + D2 + D3 + 1);
  eq('third retry fires', w.loads.length, 3);

  /* Schedule exhausted. The five-minute poll owns it from here — a disc that
   * retries forever against a dead vendor is a battery and data leak. */
  w.failDisc(S, rec);
  w.clock.advanceTo(10 * 60_000);
  eq('a fourth failure schedules nothing', w.loads.length, 3);
  eq('and leaves no timer armed', w.clock.pendingCount(), 0);
}

group('one pending attempt per disc, never a pile');
{
  const w = makeWorld();
  const rec = w.newDisc(S.id);
  /* Several failures land close together — a poll and a retry can overlap. */
  w.failDisc(S, rec); w.failDisc(S, rec); w.failDisc(S, rec);
  eq('still exactly one timer', w.clock.pendingCount(), 1);
  eq('and the step advanced only once', rec.retryStep, 1);
  w.clock.advanceTo(D1);
  eq('one retry, not three', w.loads.length, 1);
}

group('success resets the schedule');
{
  const w = makeWorld();
  const rec = w.newDisc(S.id);
  w.failDisc(S, rec);
  w.failDisc(S, rec); // no-op, timer already pending
  w.clock.advanceTo(D1);
  w.succeedDisc(rec);
  eq('pending timer cleared on success', w.clock.pendingCount(), 0);
  eq('step reset to zero', rec.retryStep, 0);

  /* THE REGRESSION THIS CATCHES: without the reset, an unrelated failure ten
   * minutes later would wait 45 s instead of 5 s. */
  const before = w.loads.length;
  w.failDisc(S, rec);
  w.clock.advanceTo(w.clock.now() + D1);
  eq('a later failure starts at the FIRST delay again', w.loads.length, before + 1);
}

group('the guards at fire time');
{
  for (const [label, setup] of [
    ['mode went off', (w) => { w.mode = 'off'; }],
    ['module destroyed', (w) => { w.destroyed = true; }],
    ['page hidden', (w) => { w.hidden = true; }],
    ['disc already recovered', (_, rec) => { rec.failed = false; }],
  ]) {
    const w = makeWorld();
    const rec = w.newDisc(S.id);
    w.failDisc(S, rec);
    setup(w, rec);
    w.clock.advanceTo(D1 + 1);
    eq(`no fetch when ${label}`, w.loads.length, 0);
  }

  /* Record identity, the same question isCurrent() asks. A disc dropped and
   * rebuilt under the same storm id has its OWN schedule, and the old timer
   * must not fetch on its behalf — this is the bug class that put satellite
   * frames under the radar segment. */
  const w = makeWorld();
  const rec = w.newDisc(S.id);
  w.failDisc(S, rec);
  w.newDisc(S.id); // setMode-style rebuild under the same id
  w.clock.advanceTo(D1 + 1);
  eq('no fetch when the record was rebuilt', w.loads.length, 0);
}

group('teardown disarms the timer');
{
  const w = makeWorld();
  const rec = w.newDisc(S.id);
  w.failDisc(S, rec);
  eq('armed', w.clock.pendingCount(), 1);
  /* dropDisc calls cancelRetry before removing the record. */
  w.cancelRetry(rec);
  w.discs.delete(S.id);
  eq('disarmed — no timer left running per dropped disc', w.clock.pendingCount(), 0);
  w.clock.advanceTo(60_000);
  eq('and nothing fetches', w.loads.length, 0);
}

group('hidden defers rather than cancels');
{
  /* The poll timer follows the same rule and onVisibility() calls refreshAll()
   * on the way back, so the attempt is postponed to when someone is looking —
   * not lost. Asserted as the module's contract: the guard returns without
   * rearming, and recovery comes from the visibility path. */
  const w = makeWorld();
  const rec = w.newDisc(S.id);
  w.failDisc(S, rec);
  w.hidden = true;
  w.clock.advanceTo(D1 + 1);
  eq('skipped while hidden', w.loads.length, 0);
  eq('and did not rearm itself', w.clock.pendingCount(), 0);
  ok('the disc is still marked failed for refreshAll to find', rec.failed === true);
}

console.log('');
if (failures.length) {
  console.error(`✗ ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`✓ ${passed} assertions passed`);
console.log('  (schedule only — it cannot tell you GIBS answers the second time)');
