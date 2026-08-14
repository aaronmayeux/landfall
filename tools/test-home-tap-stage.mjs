#!/usr/bin/env node
/**
 * test-home-tap-stage.mjs — the two-stage house tap (SPEC-MAP §9.16).
 *
 * ZERO DEPENDENCIES, like every other suite here. The module under test takes
 * a map and a container, so both are stubs: a tiny event emitter with `on`,
 * `off` and `fire`, and an element with `addEventListener`. Nothing here
 * touches a real DOM or a real camera, and nothing here can say whether the
 * gesture FEELS right — that is glass.
 *
 * ==> WHY THIS SUITE EXISTS. <== Every assertion below is about an ORDER or
 * about which events count, and both are invisible in a diff:
 *
 *   - ARMING MUST HAPPEN AFTER THE FLIGHT. MapLibre fires `zoomstart` from
 *     inside `flyTo`, and the module resets on `zoomstart`. Arm first and the
 *     flight immediately wipes it, so every tap stays a first tap and the
 *     second stage never happens at all. There is no error, no warning, and
 *     nothing on screen except a gesture that quietly does one thing forever.
 *   - `pointerdown` MUST NOT RESET. The house glyph takes no pointer events;
 *     the tap is resolved afterwards by the map's own click handler, so the
 *     pointerdown that begins the tap arrives BEFORE the tap is read. Listening
 *     to it — which is what the idle drift does — would wipe the stage
 *     milliseconds before the tap that needs it.
 *   - `keydown` MUST RESET. The keyboard pans with `setCenter` and zooms with
 *     `zoomTo`, plain programmatic calls that fire no drag and carry no
 *     original event, so every "did a human do this" test in MapLibre misses
 *     them. Without this listener a keyboard user is locked in the second
 *     stage with no way back (§13).
 *   - `movestart` MUST NOT RESET. The idle drift calls `setCenter` every frame
 *     of its rotation; resetting on that would expire the escalation while
 *     somebody is still deciding whether to tap again.
 *
 * MUTATION-TESTED (§12): each rule below was watched going red with its line
 * removed from map/home-tap-stage.js.
 */

import { createHomeTapStage, STAGE } from '../map/home-tap-stage.js';

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/* --- stubs ---------------------------------------------------------------- */

function fakeMap() {
  const handlers = new Map();
  return {
    on(ev, fn) {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev).add(fn);
    },
    off(ev, fn) {
      handlers.get(ev)?.delete(fn);
    },
    fire(ev) {
      for (const fn of handlers.get(ev) || []) fn({});
    },
    listenerCount: (ev) => (handlers.get(ev) || new Set()).size,
    getContainer: () => null,
  };
}

function fakeEl() {
  const handlers = new Map();
  return {
    addEventListener(ev, fn) {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev).add(fn);
    },
    removeEventListener(ev, fn) {
      handlers.get(ev)?.delete(fn);
    },
    fire(ev) {
      for (const fn of handlers.get(ev) || []) fn({});
    },
    listenerCount: (ev) => (handlers.get(ev) || new Set()).size,
  };
}

const build = () => {
  const map = fakeMap();
  const container = fakeEl();
  const changes = [];
  const stage = createHomeTapStage(map, {
    container,
    onChange: (s) => changes.push(s),
  });
  return { map, container, stage, changes };
};

/** What a real house tap does, in the real order: fly (which fires the map's
 *  camera events), then arm. Every ordering assertion below goes through this
 *  so the test cannot drift from the call site. */
const tap = ({ map, stage }, { flies = true, hasPair = true } = {}) => {
  const wantsPair = stage.stage() === STAGE.PAIR;
  if (flies) map.fire('zoomstart'); // what flyTo does, synchronously
  stage.armed(hasPair && !wantsPair);
  return wantsPair;
};

/* --- 1. the escalation ---------------------------------------------------- */
console.log('\nthe two-stage tap');

{
  const rig = build();
  check('starts on house', rig.stage.stage() === STAGE.HOUSE, rig.stage.stage());

  const first = tap(rig);
  check('the first tap flies to the house', first === false);
  check('and arms the pair', rig.stage.stage() === STAGE.PAIR, rig.stage.stage());

  const second = tap(rig);
  check('the second tap frames the pair', second === true);
  check('and drops back to house', rig.stage.stage() === STAGE.HOUSE, rig.stage.stage());

  const third = tap(rig);
  check('the third tap flies to the house again', third === false);
}

/* THE ORDER, ASSERTED DIRECTLY. Arming BEFORE the flight is the failure this
 * whole file exists to catch: it looks identical in review and silently makes
 * the second stage unreachable forever. */
{
  const { map, stage } = build();
  stage.armed(true);   // wrong order — armed first
  map.fire('zoomstart'); // the flight the caller was about to start
  check(
    'arming before the flight is wiped by it',
    stage.stage() === STAGE.HOUSE,
    'if this passes as PAIR the reset listener is gone, not the bug fixed'
  );
}

/* --- 2. the calm day ------------------------------------------------------ */
console.log('\nwith no storm to pair against');

{
  const rig = build();
  tap(rig, { hasPair: false });
  check('the first tap does not arm a second stage', rig.stage.stage() === STAGE.HOUSE);

  const second = tap(rig, { hasPair: false });
  check('so every tap keeps flying to the house', second === false);
  check('and the label never changes', rig.changes.length === 0, rig.changes.join(','));
}

/* --- 3. what resets it, and what must not --------------------------------- */
console.log('\nwhat counts as "the user went somewhere else"');

for (const ev of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) {
  const rig = build();
  tap(rig);
  rig.map.fire(ev);
  check(`${ev} resets to house`, rig.stage.stage() === STAGE.HOUSE);
}

{
  const rig = build();
  tap(rig);
  rig.container.fire('keydown');
  check(
    'a key press resets to house',
    rig.stage.stage() === STAGE.HOUSE,
    'the keyboard pans with setCenter — no drag, no original event, so this listener IS the keyboard path'
  );
}

{
  const rig = build();
  tap(rig);
  rig.map.fire('pointerdown');
  check(
    'pointerdown does NOT reset',
    rig.stage.stage() === STAGE.PAIR,
    'the house tap begins with a pointerdown; resetting on it wipes the stage before the tap is read'
  );
}

{
  const rig = build();
  tap(rig);
  rig.map.fire('movestart');
  rig.map.fire('move');
  check(
    'the idle drift does NOT reset',
    rig.stage.stage() === STAGE.PAIR,
    'setCenter fires movestart every frame of the rotation'
  );
}

/* --- 4. the label follows ------------------------------------------------- */
console.log('\nthe button label follows the stage');

{
  const rig = build();
  tap(rig);
  check('arming announces the pair', rig.changes.at(-1) === STAGE.PAIR, rig.changes.join(','));

  rig.map.fire('dragstart');
  check('a reset announces the house', rig.changes.at(-1) === STAGE.HOUSE, rig.changes.join(','));

  const before = rig.changes.length;
  rig.map.fire('dragstart');
  check('a no-op reset says nothing', rig.changes.length === before, `${before} -> ${rig.changes.length}`);
}

/* --- 5. it lets go -------------------------------------------------------- */
console.log('\ndetach');

{
  const { map, container, stage } = build();
  stage.detach();
  check('map listeners removed', map.listenerCount('dragstart') === 0);
  check('key listener removed', container.listenerCount('keydown') === 0);
}

/* --- done ----------------------------------------------------------------- */
console.log('');
if (failures) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
console.log('all home-tap-stage checks passed');
