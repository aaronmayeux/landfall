/**
 * test-idle-drift.mjs — THE IDLE DRIFT MUST NOT WAKE THE PHONE FOR NOTHING.
 *
 * ==> THE BUG THIS EXISTS TO STOP COMING BACK. <== `step()` used to schedule
 * the next animation frame unconditionally and put the zoom check around
 * `setCenter` only. So once the camera was past `DIVE.zHandoff` the loop kept
 * running for the rest of the session, every frame, reading two camera values
 * and throwing them away. Nothing on screen moved, so nothing looked wrong —
 * which is exactly why it survived. A frame callback that does nothing still
 * pins the loop and still costs battery on a phone.
 *
 * The assertions below are FRAME COUNTS, not pixels. They can be checked in a
 * sandbox with a fake map, which is the whole reason this file can exist —
 * what a MapLibre frame actually COSTS is a glass measurement and is NOT
 * claimed here (NOW.md NEXT UP item 1).
 *
 * Imports nothing but the module under test.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

const noop = () => {};
globalThis.window = {
  matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
  addEventListener: noop,
  navigator: {},
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
};
globalThis.document = {
  hidden: false,
  addEventListener: noop,
  removeEventListener: noop,
  getElementById: () => null,
  createElement: () => ({ style: {}, dataset: {}, appendChild: noop }),
  documentElement: { style: { setProperty: noop } },
};
globalThis.localStorage = globalThis.window.localStorage;

/* A hand-driven clock. `requestAnimationFrame` queues; `tick()` runs exactly
 * one frame. Nothing here is time-based, so the test cannot flake. */
let queue = [];
let frames = 0;
globalThis.requestAnimationFrame = (fn) => {
  queue.push(fn);
  return queue.length;
};
globalThis.cancelAnimationFrame = () => { queue = []; };
const tick = (t) => {
  const due = queue;
  queue = [];
  for (const fn of due) { frames++; fn(t); }
};

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { attachIdleRotation } = await import('../map/globe.js');
const { DIVE } = await import('../config/constants.js');

/** The smallest map the drift touches: a camera and a container. */
function fakeMap(zoom) {
  const listeners = {};
  let center = { lng: 0, lat: 0 };
  let setCenterCalls = 0;
  return {
    getZoom: () => zoom,
    setZoom(z) { zoom = z; },
    getCenter: () => ({ ...center }),
    setCenter([lng, lat]) { center = { lng, lat }; setCenterCalls++; },
    getContainer: () => ({
      addEventListener: (e, fn) => { listeners[e] = fn; },
      removeEventListener: (e) => { delete listeners[e]; },
    }),
    fire: (e) => listeners[e] && listeners[e](),
    get calls() { return setCenterCalls; },
  };
}

/* attachIdleRotation arms a resume TIMER rather than starting immediately, so
 * every case below has to let that timer fire before any frame exists. The
 * shipped delay is 12 s (`GLOBE.idleResumeDelay`), which is a real-clock wait
 * no test should take — every case passes a 1 ms delay in through `config`,
 * the same override channel the settings store uses. */
const CFG = { resumeDelayMs: 1 };
const runTimers = () => new Promise((r) => setTimeout(r, 10));

/* --- zoomed out: it drifts, and it keeps drifting ------------------------- */
section('zoomed out at the planet band — the drift runs');

{
  const map = fakeMap(DIVE.zHandoff - 1);
  const idle = attachIdleRotation(map, { config: CFG });
  await runTimers();
  frames = 0;
  tick(16); tick(32); tick(48);
  ok(frames === 3, `three ticks run three frames (ran ${frames})`);
  ok(map.calls === 3, `and each one moves the camera (${map.calls} setCenter calls)`);
  ok(queue.length === 1, 'the loop is still armed for the next frame');
  idle.detach();
}

/* --- zoomed in: it stops dead --------------------------------------------- */
section('zoomed past DIVE.zHandoff — the loop ENDS, it does not idle');

{
  const map = fakeMap(DIVE.zHandoff + 1);
  const idle = attachIdleRotation(map, { config: CFG });
  await runTimers();
  frames = 0;
  tick(16);
  ok(frames === 1, 'it wakes exactly once to notice it has nothing to do');
  ok(map.calls === 0, 'and never moves the camera at street zoom');
  ok(queue.length === 0,
    '==> AND SCHEDULES NOTHING FURTHER. This is the whole test: a non-empty ' +
    'queue here is the loop spinning for the rest of the session.');
  tick(32); tick(48);
  ok(frames === 1, `still one frame after two more ticks (ran ${frames})`);
  idle.detach();
}

/* --- and it comes back ----------------------------------------------------- */
section('zooming back out re-arms it — stopping is not one-way');

{
  const map = fakeMap(DIVE.zHandoff + 1);
  const idle = attachIdleRotation(map, { config: CFG });
  await runTimers();
  tick(16);
  ok(queue.length === 0, 'stopped while zoomed in');

  /* The user zooms out. Every route that can do this calls interrupt() — the
   * gesture listeners here, and main.js for programmatic moves. */
  map.setZoom(DIVE.zHandoff - 2);
  map.fire('wheel');
  await runTimers();

  frames = 0;
  tick(64); tick(80);
  ok(frames === 2, `the drift resumed after the zoom-out (${frames} frames)`);
  ok(map.calls > 0, 'and the camera is moving again');
  idle.detach();
}

/* --- detach really detaches ------------------------------------------------ */
section('detach stops everything');

{
  const map = fakeMap(DIVE.zHandoff - 1);
  const idle = attachIdleRotation(map, { config: CFG });
  await runTimers();
  tick(16);
  idle.detach();
  const before = map.calls;
  tick(32); tick(48);
  ok(map.calls === before, 'no camera movement after detach');
  ok(queue.length === 0, 'and no frame left queued');
}

console.log('');
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log(`\n✗ ${failures.length} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`✓ ${pass} assertions passed`);
console.log('  (frame counts only — what a MapLibre frame COSTS is glass, NOW.md item 1)');
