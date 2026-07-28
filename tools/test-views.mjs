#!/usr/bin/env node
/**
 * test-views.mjs — the four decisions that came out of boot()'s closure with
 * app/views.js.
 *
 * ZERO DEPENDENCIES, like every other suite here.
 *
 * WHY THIS SUITE EXISTS. Two of these are ORDERS, not values, and an order is
 * the hardest thing in this app to notice going wrong:
 *
 *   - `runSelect` starts the geometry fetch LAST. Start it before the drawer
 *     has been pushed with the new storm and the fetch's synchronous
 *     "loading" state reaches the detail view while the view is still entered
 *     with the PREVIOUS storm — which is the drawer's one-storm-behind
 *     advisory bug, and it took a session to find the first time.
 *   - `runRecenter` clears the pipeline whether or not the drawer was open.
 *     Guard that behind `isOpen()` and a selection ends in one place while
 *     still being drawn in another.
 *
 * Neither has an error state. Both just quietly show the wrong thing. Inside
 * the closure there was no way to write an assertion about either; the whole
 * reason they take an argument bag is so this file can.
 *
 * The DOM SHIM below exists for one reason: app/views.js imports pwa.js, which
 * registers window listeners at module load. Nothing under test touches the
 * DOM. If this shim ever needs to grow much past what is here, that is a
 * signal a module has picked up a top-level side effect worth questioning.
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
  addEventListener: noop,
  getElementById: () => null,
  createElement: () => ({ style: {}, dataset: {}, appendChild: noop }),
  documentElement: { style: { setProperty: noop } },
};
/* `navigator` is deliberately NOT shimmed — Node defines it read-only, and
 * nothing here reaches it at module load. */
globalThis.localStorage = globalThis.window.localStorage;

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const { panelOffsetFor, familiesForStorms, recenterTarget, runSelect, runRecenter } =
  await import('../app/views.js');

const { MODEL_FAMILY } = await import('../config/constants.js');

/* --- panelOffsetFor -------------------------------------------------------- */
section('panelOffsetFor — where the camera puts the storm around the drawer');

ok(same(panelOffsetFor({ width: 340, height: 0, wide: true }), [170, 0]),
  'WIDE: the left rail pushes the storm RIGHT by half the rail, and never vertically');
ok(same(panelOffsetFor({ width: 0, height: 600, wide: false }), [0, -300]),
  'NARROW: the bottom sheet pushes the storm UP by half the sheet — negative, and the sign is the whole thing');
ok(same(panelOffsetFor({ width: 340, height: 600, wide: true }), [170, 0]),
  'the wide branch ignores height even when the element reports one — the rail is beside the globe, not under it');
ok(same(panelOffsetFor({ width: 340, height: 600, wide: false }), [0, -300]),
  'and the narrow branch ignores width for the same reason');

ok(same(panelOffsetFor({ width: 0, height: 0, wide: false }), [0, -0]),
  'A CLOSED DRAWER MEASURES ZERO and gets no offset — the storm lands dead centre, which is correct rather than a special case');
ok(same(panelOffsetFor(), [0, -0]),
  'no box at all does not throw; it degrades to centred');

/* --- familiesForStorms ----------------------------------------------------- */
section('familiesForStorms — which model groups the picker offers');

ok(familiesForStorms([{ source: 'nhc' }]).has(MODEL_FAMILY.NHC),
  'an NHC storm asks for NOAA\'s a-decks');
ok(familiesForStorms([{ source: 'gdacs' }]).has(MODEL_FAMILY.GLOBAL),
  'a GDACS storm asks for TCGP — safe because merge.js already drops GDACS copies inside NHC basins');

const both = familiesForStorms([{ source: 'nhc' }, { source: 'gdacs' }]);
ok(both.size === 2, 'a mixed board asks for both');

ok(familiesForStorms([]).size === 0,
  'NO STORMS RETURNS AN EMPTY SET, which modelSelectorGroups reads as "show everything" — a selector that vanishes reads as a broken panel (§5)');
ok(familiesForStorms(null).size === 0, 'a null list is the same answer, not a throw');
ok(familiesForStorms(undefined).size === 0, 'and so is no list at all');

let threw = false;
try { familiesForStorms([null, { source: 'nhc' }]); } catch { threw = true; }
ok(!threw, 'A JUNK ENTRY DOES NOT THROW. It counts as global, which only ever widens the picker — showing more models than needed is the same answer as showing none, and both are safe');

/* --- recenterTarget -------------------------------------------------------- */
section('recenterTarget — where "back out" lands');

ok(same(recenterTarget({ lon: -90.2, lat: 29.9 }), { center: [-90.2, 29.9] }),
  'HOME WINS, and the pair is [lon, lat] — MapLibre order, which is the trap');
ok(recenterTarget(null) === undefined,
  'no home hands the decision back to map/globe.js rather than inventing a centre here');
ok(recenterTarget(undefined) === undefined, 'same for undefined');

/* --- runSelect ------------------------------------------------------------- */
section('runSelect — THE ORDER IS THE CONTRACT');

function selectRig() {
  const log = [];
  const storm = { id: 'al012026', name: 'Test' };
  const deps = {
    count: (k) => log.push(`count:${k}`),
    idle: { interrupt: () => log.push('idle.interrupt') },
    pipeline: {
      select: (s) => log.push(`pipeline.select:${s.id}`),
      load: (s) => log.push(`pipeline.load:${s.id}`),
    },
    drawer: { push: (view, s) => log.push(`drawer.push:${view}:${s.id}`) },
    fly: (s) => log.push(`fly:${s.id}`),
    refreshModelStatus: () => log.push('refreshModelStatus'),
  };
  return { log, storm, deps };
}

{
  const { log, storm, deps } = selectRig();
  runSelect(storm, deps);

  ok(same(log, [
    'count:storm_select',
    'idle.interrupt',
    'pipeline.select:al012026',
    'refreshModelStatus',
    'drawer.push:detail:al012026',
    'fly:al012026',
    'pipeline.load:al012026',
  ]), 'the whole sequence, exactly — any reordering fails this line');

  const push = log.findIndex((l) => l.startsWith('drawer.push'));
  const load = log.findIndex((l) => l.startsWith('pipeline.load'));
  ok(push < load,
    '==> THE DRAWER IS PUSHED BEFORE THE FETCH STARTS. <== Reversed, the fetch\'s synchronous "loading" reaches a detail view still entered with the PREVIOUS storm — the one-storm-behind advisory bug');

  const sel = log.findIndex((l) => l.startsWith('pipeline.select'));
  ok(sel < push, 'the selection is RECORDED before the drawer is told about it, so the view reads a pipeline that already agrees with it');

  const refresh = log.indexOf('refreshModelStatus');
  ok(refresh < load,
    'the guidance row is recomputed BEFORE any fetch, so a cache hit shows its real state instead of flashing "loading"');

  ok(log.indexOf('idle.interrupt') === 1,
    'the drift is interrupted first — selection can come from the drawer, where no gesture ever reaches the map, and the drift\'s per-frame setCenter would stomp the flyTo');

  ok(log[0] === 'count:storm_select',
    'ONE COUNT, at the one place every route into selection arrives — a dot, a row, and Enter on a row all land here');
}

/* --- runRecenter ----------------------------------------------------------- */
section('runRecenter — ending a selection means ending all of it');

function recenterRig(open) {
  const log = [];
  const deps = {
    count: (k) => log.push(`count:${k}`),
    drawer: {
      isOpen: () => open,
      close: () => log.push('drawer.close'),
    },
    pipeline: { clear: () => log.push('pipeline.clear') },
    refreshModelStatus: () => log.push('refreshModelStatus'),
    idle: { interrupt: () => log.push('idle.interrupt') },
    goHome: () => log.push('goHome'),
  };
  return { log, deps };
}

{
  const { log, deps } = recenterRig(true);
  runRecenter(deps);
  ok(same(log, [
    'count:recenter',
    'drawer.close',
    'pipeline.clear',
    'refreshModelStatus',
    'idle.interrupt',
    'goHome',
  ]), 'drawer open: the whole sequence, exactly');
}

{
  const { log, deps } = recenterRig(false);
  runRecenter(deps);
  ok(!log.includes('drawer.close'),
    'a closed drawer is not closed again');
  ok(log.includes('pipeline.clear'),
    '==> BUT THE PIPELINE IS STILL CLEARED. <== Closing the drawer deliberately LEAVES the geometry drawn (§16 — you dismissed it to look at the map), so this is the only path off that state and it cannot be gated on the drawer');
  ok(same(log, ['count:recenter', 'pipeline.clear', 'refreshModelStatus', 'idle.interrupt', 'goHome']),
    'and the rest of the order is unchanged by the drawer being shut');
}

{
  const { log, deps } = recenterRig(true);
  runRecenter(deps);
  ok(log.indexOf('idle.interrupt') < log.indexOf('goHome'),
    'the drift is interrupted BEFORE the camera moves, or its per-frame setCenter stomps the easeTo');
  ok(log.indexOf('pipeline.clear') < log.indexOf('refreshModelStatus'),
    'the guidance row is recomputed AFTER the selection is gone, so it describes the state the app is actually in');
}

/* --- report -------------------------------------------------------------- */
if (failures.length) {
  console.log(`\n✗ ${failures.length} failed:`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (the orders and the pure parts — whether the views themselves render is a glass question)');
