#!/usr/bin/env node
/**
 * test-flood-layer.mjs — the flood layer's COST, not its output. §56.5.
 *
 * WHAT THIS IS FOR. Phase 5 shipped a per-storm layer that was correct and
 * slow, and the slowness had no test because every existing suite asks what
 * the code produces rather than how often it produces it. Aaron felt it on
 * 2026-08-23 as the drawers going sluggish between storms, and all three
 * causes were invisible to a correctness assertion:
 *
 *   1. **The corridor match ran for an invisible layer.** The engine calls
 *      `update` on every definition on every `setBundle`, and this layer is
 *      OFF BY DEFAULT — so a reader who had never touched the switch was
 *      densifying a track and measuring every national alert against it on
 *      every storm switch and every poll, for something that draws nothing.
 *   2. **A poll re-pushing an unchanged bundle redid all of it.** Measured on
 *      real bytes: 12 watches carrying resolved zone boundaries cost ~100 ms,
 *      and `repushSelected()` fires on every poll that touches the selected
 *      storm, on a theme change and on a restyle.
 *   3. **The status row committed even when it had not changed**, and a commit
 *      rewrites the whole Layers panel and rewires it. That one is asserted in
 *      `tools/test-layer-status.mjs`; the two above are here.
 *
 * ==> THE FIXTURE IS DELIBERATELY THE EXPENSIVE SHAPE. <== A real captured NWS
 * forecast zone, HIZ023, 1,970 vertices. §56.4 made watches carry these, and a
 * suite built on the small forecaster-drawn warning polygons would run green
 * over a regression that only bites on the shape that actually costs.
 *
 * Zero dependencies. Run: node tools/test-flood-layer.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

let failures = 0;
const ok = (label) => console.log(`  ✓ ${label}`);
const fail = (label, detail) => {
  failures++;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
};
const truthy = (label, v) => (v ? ok(label) : fail(label));
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  a === e ? ok(label) : fail(label, `expected ${e}\n      actual   ${a}`);
};
const section = (n) => console.log(`\n  ${n}`);

const load = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

/* ---------------------------------------------------------------------------
 * A STUB MAP
 *
 * The same shape `tools/test-app-layer-state.mjs` uses, plus the two source
 * handles this layer writes through, so a push is observable.
 * ------------------------------------------------------------------------- */

const pushed = { shapes: null, points: null };
const sources = new Map([
  ['flood-alerts', { setData: (d) => { pushed.shapes = d; } }],
  ['flood-alert-points', { setData: (d) => { pushed.points = d; } }],
]);
let sourcesAdded = false;
const stub = {
  getSource: (id) => (sourcesAdded ? sources.get(id) || null : null),
  addSource: () => { sourcesAdded = true; },
  getLayer: () => ({}),
  addLayer: () => {},
  setLayoutProperty: () => {},
  setPaintProperty: () => {},
  hasImage: () => true,
  addImage: () => {},
  on: () => {},
};

await import(path.join(ROOT, 'map/layers/index.js'));
const { createLayerEngine } = await import(path.join(ROOT, 'map/layers/registry.js'));
const flood = await import(path.join(ROOT, 'map/layers/flood.js'));

let reports = 0;
let lastReport = null;
flood.setFloodReporter((r) => { reports++; lastReport = r; });

const engine = createLayerEngine(stub);
engine.attach();

/* ---------------------------------------------------------------------------
 * THE FIXTURE
 * ------------------------------------------------------------------------- */

const national = load('samples/flood/alerts-national.json');
const NOW = Date.parse(national.fetchedAt);
const zone = load('samples/flood/zones/HIZ023.geojson').geometry;

const bundleFor = () => ({
  layers: {
    pastTrack: { fc: load('samples/flood/track-lala-cp2-past.geojson') },
    forecastTrack: { fc: load('samples/flood/track-lala-cp2-forecast.geojson') },
  },
});
const held = bundleFor();
const storm = (id) => ({ id });

/* Twelve zone-backed watches on Lala's real track. Twelve rather than the
 * three §56.4 measured in force on a quiet day, because the point of this
 * suite is the cost and the quiet day is not where a regression shows. */
const watches = [];
for (let i = 0; i < 12; i++) {
  watches.push({
    id: 'z' + i,
    event: 'Flood Watch',
    expires: new Date(NOW + 86400000).toISOString(),
    geometry: zone,
  });
}

const timed = (fn) => {
  const s = performance.now();
  fn();
  return performance.now() - s;
};

/* ---------------------------------------------------------------------------
 * 1. THE LAYER IS OFF, AND OFF MUST COST NOTHING
 * ------------------------------------------------------------------------- */

section('the switch is off — the default — and nothing may be spent');

flood.setFloodAlerts(stub, watches, { now: NOW });
reports = 0;
pushed.shapes = null;

const offMs = timed(() => {
  for (let i = 0; i < 5; i++) engine.setBundle(storm('off' + i), bundleFor());
});

eq('five storm switches report nothing', reports, 0);
eq('and nothing is pushed to the globe', pushed.shapes, null);

/* ==> A CEILING, DELIBERATELY LOOSE. <== The measured figure is effectively
 * zero. Before the fix, five switches against this fixture were ~500 ms. 25 ms
 * is far above the real cost and far below the regression, which is what a
 * ceiling is for — it catches the work coming back, not normal variation on
 * whatever runner executes it. */
truthy(`five switches cost ${offMs.toFixed(1)} ms with the layer off, under 25 ms`, offMs < 25);

/* ---------------------------------------------------------------------------
 * 2. THE LAYER IS ON, AND IT MUST ACTUALLY DRAW
 *
 * The cheapest way to "fix" a slow layer is to stop it working. These are the
 * assertions that make the block above mean something.
 * ------------------------------------------------------------------------- */

section('the switch goes on — it must pay the cost it was skipping');

reports = 0;
engine.setToggle('floodAlerts', true);

truthy('turning it on pushes immediately rather than waiting for a poll', reports > 0);
eq('twelve watches are on the globe as shapes', pushed.shapes?.features?.length, 12);
eq('and twelve chips over them', pushed.points?.features?.length, 12);
eq('the row is told what was drawn', lastReport?.state, 'ok');
eq('and how many matched', lastReport?.matched, 12);

engine.setBundle(storm('on-1'), held);
eq('a storm switch with the layer on still draws', pushed.shapes?.features?.length, 12);

/* ---------------------------------------------------------------------------
 * 3. AN UNCHANGED RE-PUSH IS FREE
 * ------------------------------------------------------------------------- */

section('a poll re-pushing the same bundle must not redo the match');

/* Warm it, so the first call is not the one being timed. */
engine.setBundle(storm('on-1'), held);

const repushMs = timed(() => {
  for (let i = 0; i < 10; i++) engine.setBundle(storm('on-1'), held);
});

truthy(`ten identical re-pushes cost ${repushMs.toFixed(1)} ms, under 10 ms`, repushMs < 10);

/* ==> AND THE MEMO MUST STILL BE CORRECT, WHICH IS THE HALF THAT MATTERS.
 * <== A cache keyed on the wrong thing is fast and wrong. A genuinely NEW
 * bundle has to produce a genuinely new answer. */
const fewer = watches.slice(0, 3);
flood.setFloodAlerts(stub, fewer, { now: NOW });
eq('a new alert list is not served from the memo', pushed.shapes?.features?.length, 3);

flood.setFloodAlerts(stub, watches, { now: NOW });
eq('and putting the full list back re-expands it', pushed.shapes?.features?.length, 12);

engine.setBundle(storm('on-2'), bundleFor());
eq('a new bundle is not served from the memo either',
  pushed.shapes?.features?.length, 12);

/* ==> THE CLOCK IS IN THE KEY, AND THIS IS WHY. <== Expiry is filtered at
 * render. A memo that ignored the moment would keep an expired warning on the
 * globe telling somebody they are in danger when they are not. */
flood.setFloodAlerts(stub, watches, { now: NOW + 7 * 86400000 });
eq('a week later the same list draws nothing', pushed.shapes?.features?.length, 0);

/* ---------------------------------------------------------------------------
 * 4. THE SELECTION CLOSING
 * ------------------------------------------------------------------------- */

section('selection closed — nothing drawn, and the row is told why');

flood.setFloodAlerts(stub, watches, { now: NOW });
engine.setBundle(storm('on-3'), bundleFor());
eq('a storm is drawn first', pushed.shapes?.features?.length, 12);

engine.clearSelection();
eq('closing the selection empties the shapes', pushed.shapes?.features?.length, 0);
eq('and the chips', pushed.points?.features?.length, 0);
eq('and the row is told there is no selection, not that it is all clear',
  lastReport?.selected, false);

/* ---------------------------------------------------------------------------
 * 5. TURNING IT BACK OFF
 * ------------------------------------------------------------------------- */

section('the switch goes off again');

engine.setBundle(storm('on-4'), bundleFor());
engine.setToggle('floodAlerts', false);
reports = 0;
const offAgainMs = timed(() => {
  for (let i = 0; i < 5; i++) engine.setBundle(storm('later' + i), bundleFor());
});
eq('switches after it is turned off report nothing again', reports, 0);
truthy(`and cost ${offAgainMs.toFixed(1)} ms, under 25 ms`, offAgainMs < 25);

console.log(
  failures === 0
    ? '\n✓ flood-layer: every acceptance case passes\n'
    : `\n✗ flood-layer: ${failures} failure(s)\n`
);
process.exit(failures === 0 ? 0 : 1);
