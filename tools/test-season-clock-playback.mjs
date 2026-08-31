#!/usr/bin/env node
/**
 * test-season-clock-playback.mjs — the thing that wakes up ten times a second.
 * SPEC-SEASONS-BUILD.md §57.23, §57.67 slice D.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-season-clock-playback.mjs`. No DOM
 * at all — `seasons/clock-playback.js` knows about time and nothing else, which
 * is the whole reason it is a separate file from the control.
 *
 * ==> THIS SUITE EXISTS BECAUSE THREE MUTATIONS SURVIVED THE CONTROL'S SUITE
 * AND ALL THREE WERE ABOUT THE SAME BLIND SPOT. <== Run on 2026-08-31:
 * rescheduling the next wake-up BEFORE the work instead of after it, and
 * stamping the elapsed time AFTER the work instead of before it, both left
 * `tools/test-season-clock-control.mjs` completely green. They had to, because
 * that suite drives a fake clock the component cannot move — so `onTick` there
 * takes exactly zero real time, and "before the work" and "after the work" are
 * the same instant. A test that cannot express the difference between two
 * answers cannot tell you which one you shipped.
 *
 * Here the tick is allowed to CONSUME time, which is what a real one does:
 * pushing geometry into three MapLibre sources is real milliseconds on a phone.
 *
 * ==> AND ONE OF THOSE TWO MUTATIONS FOUND A WRONG SENTENCE RATHER THAN A
 * MISSING TEST, WHICH IS THE PART WORTH KEEPING. <== The comment on that line
 * argued that stamping after the work would run the season FAST. It runs it
 * SLOW: the drawing time is simply dropped, and the clock loses exactly as much
 * as the render costs, on exactly the phones least able to afford it. The code
 * was right and its own explanation was backwards, which is worse than no
 * comment — section 3 below is the direction, computed rather than argued.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
process.chdir(join(HERE, '..'));

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };
const eq = (what, got, want) => ok(
  `${what}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`,
  JSON.stringify(got) === JSON.stringify(want)
);
const section = (n) => console.log(`\n  ${n}`);

const { createPlayhead } = await import('../seasons/clock-playback.js');
const { stepRealMs } = await import('../lib/season-clock.js');

const STEP = stepRealMs();

/**
 * A clock this file owns.
 *
 * ==> `consume` IS THE ONE THING THE CONTROL'S FAKE CLOCK CANNOT DO, AND IT IS
 * WHY THIS FILE EXISTS. <== It moves real time forward WITHOUT firing anything,
 * which is what a tick doing actual work looks like from the outside: the wall
 * clock advances while nothing else gets a turn.
 */
function fakeTime() {
  let t = 0;
  let next = 1;
  let lag = 0;
  const queue = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = next++; queue.push({ id, at: t + ms, fn }); return id; },
    clearTimer: (id) => {
      const i = queue.findIndex((q) => q.id === id);
      if (i !== -1) queue.splice(i, 1);
    },
    /** Real time passes inside a tick — the tick is doing its work. */
    consume(ms) { t += ms; },
    /** The next wake-up arrives late, which is the ordinary case on a phone. */
    lateNext(ms) { lag = ms; },
    run(ms) {
      const end = t + ms;
      for (;;) {
        const due = queue.filter((q) => q.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        queue.splice(queue.indexOf(due), 1);
        t = due.at + lag;
        lag = 0;
        due.fn();
      }
      t = Math.max(t, end);
    },
    pending: () => queue.length,
    nextAt: () => (queue.length ? Math.min(...queue.map((q) => q.at)) : null),
  };
}

/* ---------------------------------------------------------------------------
 * 1. NOTHING HAPPENS UNTIL IT IS STARTED
 * ------------------------------------------------------------------------ */
section('1. starting and stopping');
{
  const time = fakeTime();
  const seen = [];
  const head = createPlayhead({ onTick: (ms) => seen.push(ms), ...time, now: time.now });

  eq('it is not running before anybody starts it', head.running(), false);
  eq('and nothing is scheduled', time.pending(), 0);

  time.run(10_000);
  eq('so ten seconds of real time do nothing at all', seen, []);

  head.start();
  eq('started, it is running', head.running(), true);
  eq('==> WITH EXACTLY ONE WAKE-UP PENDING, AND IT IS `stepRealMs` AWAY. <== '
    + '§57.35 fault 3 is a measurement, not a preference: `setData` is a fresh '
    + 'parse and re-index in the map worker every time it is called, so sixty '
    + 'of them a second will not hold frame rate on a phone. Ten is the middle '
    + 'of that fault\'s measured 8-12 band',
  [time.pending(), time.nextAt() - time.now()], [1, STEP]);

  time.run(50);
  const due = time.nextAt();
  head.start();
  eq('==> STARTING AGAIN WHILE RUNNING CHANGES NOTHING, INCLUDING WHEN THE NEXT '
    + 'WAKE-UP IS. <== Not just "no second timer" — `schedule` cancels, so a '
    + 'duplicate loop was never the risk. The risk is the wake-up MOVING: a '
    + 'second start would re-stamp the elapsed measurement and push the pending '
    + 'tick out by however long the first one had already waited, so a stray '
    + 'second press would nudge the season\'s pace every time it happened',
  [time.pending(), time.nextAt()], [1, due]);

  head.stop();
  eq('stopped, nothing is left scheduled', [head.running(), time.pending()], [false, 0]);
  head.stop();
  eq('and stopping twice is a no-op, not a throw', head.running(), false);
}

/* ---------------------------------------------------------------------------
 * 2. EACH TICK REPORTS HOW LONG IT HAS ACTUALLY BEEN
 * ------------------------------------------------------------------------ */
section('2. it measures rather than counts');
{
  const time = fakeTime();
  const seen = [];
  const head = createPlayhead({ onTick: (ms) => seen.push(ms), ...time, now: time.now });

  head.start();
  time.run(1000);
  eq(`ten punctual wake-ups in a real second, each reporting ${STEP}ms`,
    [seen.length, seen.every((m) => m === STEP)], [10, true]);

  seen.length = 0;
  time.lateNext(400);
  time.run(STEP);
  eq('==> A WAKE-UP THAT ARRIVES 400ms LATE REPORTS 500, NOT 100. <== Browser '
    + 'timers are a floor and never a promise — a busy main thread, a mid-drag '
    + 'repaint or a low-power mode all deliver a late one. A loop that counted '
    + 'ticks instead of measuring them would run the season slow by however '
    + 'late they were, cumulatively, with nothing on screen saying so',
  seen, [STEP + 400]);

  head.stop();
}

/* ---------------------------------------------------------------------------
 * 3. THE WORK ITSELF TAKES TIME, AND BOTH HALVES OF THAT ARE ASSERTED
 *
 * ==> NEITHER OF THESE COULD BE SEEN FROM THE CONTROL'S SUITE. <== There the
 * tick takes zero real time, so "before the work" and "after the work" are the
 * same instant and both mutations were invisible. Here the tick spends 80ms,
 * which is what pushing three sources costs on a phone that is struggling.
 * ------------------------------------------------------------------------ */
section('3. when the tick itself takes time');
{
  const WORK = 80;
  const time = fakeTime();
  const seen = [];
  const head = createPlayhead({
    onTick: (ms) => { seen.push(ms); time.consume(WORK); },
    ...time,
    now: time.now,
  });

  head.start();
  time.run(STEP);

  eq(`the first tick reports ${STEP}ms, which is the interval it waited`,
    seen, [STEP]);
  eq('==> AND THE NEXT WAKE-UP IS A FULL INTERVAL AFTER THE WORK FINISHED, NOT '
    + 'AFTER IT STARTED. <== This is the difference between a chain of '
    + '`setTimeout` and a `setInterval`, and it is the whole reason for the '
    + 'chain: a device that cannot keep up must run at fewer steps a second, '
    + 'never accumulate a backlog of work it will never catch up on. '
    + `Scheduled before the work it would sit at ${STEP * 2}`,
  time.nextAt(), STEP + WORK + STEP);

  seen.length = 0;
  time.run(STEP + WORK);

  eq('==> AND THE TICK AFTER IT REPORTS THE WORK AS ELAPSED TIME RATHER THAN '
    + 'LOSING IT. <== The stamp is taken BEFORE the work, so no real '
    + 'millisecond goes unaccounted for. Taken after it, this would report '
    + `${STEP} and the season would run SLOW by exactly the cost of drawing `
    + 'it — worst on the phones least able to afford it, which reads as "the '
    + 'app feels sluggish" rather than as a wrong number anybody could point at',
  seen, [STEP + WORK]);

  head.stop();
}

/* ---------------------------------------------------------------------------
 * 4. THE TICK IS ALLOWED TO STOP US, WHICH IS HOW THE SEASON ENDS
 * ------------------------------------------------------------------------ */
section('4. stopping from inside a tick');
{
  const time = fakeTime();
  let ticks = 0;
  const head = createPlayhead({
    onTick: () => { ticks += 1; if (ticks === 3) head.stop(); },
    ...time,
    now: time.now,
  });

  head.start();
  time.run(10_000);

  eq('==> REACHING THE END OF THE TIMELINE IS A TICK CALLING `stop` ON ITS OWN '
    + 'LOOP, SO THE RESCHEDULE HAS TO BE ASKED RATHER THAN ASSUMED. <== A '
    + 'wake-up left pending after the season finished would hold the whole '
    + 'component alive and fire over whatever came next',
  [ticks, head.running(), time.pending()], [3, false, 0]);
}

/* ---------------------------------------------------------------------------
 * 5. A CLOCK THAT GOES BACKWARDS NEVER RUNS THE SEASON BACKWARDS
 * ------------------------------------------------------------------------ */
section('5. a clock that jumps');
{
  let t = 0;
  const queue = [];
  const seen = [];
  const head = createPlayhead({
    onTick: (ms) => seen.push(ms),
    now: () => t,
    setTimer: (fn) => { queue.push(fn); return queue.length; },
    clearTimer: () => {},
  });

  head.start();
  /* A system clock correction, a suspended machine, a `Date.now` fallback on a
   * device whose owner changed the time zone. `performance.now` is monotonic
   * and this should not be reachable — which is exactly why it is guarded
   * rather than trusted, and why the guard is asserted rather than assumed. */
  t = -5000;
  queue.shift()();

  eq('==> A NEGATIVE ELAPSED TIME REPORTS ZERO, NOT A NEGATIVE. <== Handed '
    + 'through, it would run the season BACKWARDS, which reads as the app '
    + 'being broken rather than as a clock being odd',
  seen, [0]);
  head.stop();
}

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions pass — the season clock's loop wakes ten times `
  + 'a second, measures rather than counts, and never piles up');
