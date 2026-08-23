#!/usr/bin/env node
/**
 * test-flood-layer.mjs — the per-storm flood layer's COST SHAPE.
 * SPEC-FLOOD-PLAN.md §56.5, §56.15, §56.16 (Slice A).
 *
 * ==> THIS SUITE DOES NOT ASSERT THAT ANYTHING IS FAST, AND IT CANNOT. <== A
 * millisecond figure measured in this sandbox is evidence about this sandbox
 * (`CLAUDE.md`). What it asserts is WORK NOT DONE: that the corridor match and
 * the source write do not happen when the layer is off, and do not happen twice
 * for an unchanged selection. Those are the two faults that made the first
 * attempt at this phase unusable, and both are structural facts a stub map can
 * observe honestly.
 *
 * The stub counts `setData` calls. It does not validate expressions and does
 * not paint — `tools/test-surge.mjs` was green for weeks over a feature that
 * never once ran because its stub accepted an expression MapLibre rejects, so
 * this file claims nothing beyond what it counts. `tools/boot-smoke.mjs` is the
 * gate that watches the real map's error channel.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { failures.push(label); console.log(`  ✗ ${label}`); }
};
const section = (s) => console.log(`\n  ${s}\n`);

const { setFloodAlerts, floodFeatures, resetFloodLayer, floodMatchRuns } =
  await import('../map/layers/flood.js');
const { createLayerEngine } = await import('../map/layers/registry.js');

/* --- the stub map ---------------------------------------------------------
 * Counts what the layer asks the map to do. Every other layer definition in
 * the registry is imported by map/layers/index.js, which this file
 * deliberately does NOT import — only flood.js registers itself here, so the
 * counts describe this layer and nothing else. */
function stubMap() {
  const calls = { setData: 0, layout: 0, lastFeatures: null };
  const src = {
    setData(fc) {
      calls.setData++;
      calls.lastFeatures = fc?.features?.length ?? null;
    },
  };
  return {
    calls,
    getSource: (id) => (id === 'flood-alerts' ? src : null),
    getLayer: () => ({}),
    addSource() {},
    addLayer() {},
    setPaintProperty() {},
    setLayoutProperty() { calls.layout++; },
  };
}

/* --- real bytes -----------------------------------------------------------
 * §56 rule: read the real payload, never a guessed shape. This is the frozen
 * national capture the plan names. */
const national = JSON.parse(
  readFileSync(path.join(ROOT, 'samples/flood/alerts-national.json'), 'utf8')
);
const ALERTS = national.alerts || [];
ok(ALERTS.length > 0, `the frozen national capture loaded — ${ALERTS.length} alerts`);

/** A storm bundle with a track that runs through the alerts we have, so the
 *  match is exercised rather than short-circuited. Built from the alert
 *  geometry itself so this does not depend on the weather. */
function bundleOverAlerts(n = 8) {
  const coords = [];
  for (const a of ALERTS) {
    if (coords.length >= n) break;
    const g = a.geometry;
    const ring = g?.type === 'Polygon' ? g.coordinates?.[0]
      : g?.type === 'MultiPolygon' ? g.coordinates?.[0]?.[0] : null;
    if (ring?.length) coords.push([ring[0][0], ring[0][1]]);
  }
  return {
    layers: {
      pastTrack: { status: 'ok', fc: { type: 'FeatureCollection', features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} },
      ] } },
      forecastTrack: { status: 'ok', fc: { type: 'FeatureCollection', features: [] } },
    },
  };
}

const STORM = { id: 'test-1', source: 'nhc', advisoryKey: 'test-1-1' };

/* ==========================================================================
 * FAULT 1 — THE LAYER IS OFF AND MUST COST NOTHING
 * ========================================================================== */
section('with the layer OFF, a selection does no work (§56.15 fault 1)');

/* ==> MUTATION-VERIFIED, AND THE GATE IS DOUBLED, SO SAY SO. <== These two
 * assertions go red when the visibility check is removed from BOTH `update()`
 * and `push()` in map/layers/flood.js — verified 2026-08-23. Removing either
 * one alone leaves them green, because the other still stops the work. That is
 * defence in depth working as intended and it is written down here so a later
 * session mutating a single line does not conclude this suite is blind to the
 * fault it was written for. The load-bearing one is `push()`: it is the only
 * caller of the corridor match. */

resetFloodLayer();
let map = stubMap();
let engine = createLayerEngine(map);
engine.attach();
setFloodAlerts(map, ALERTS);
map.calls.setData = 0;

const bundle = bundleOverAlerts();
for (let i = 0; i < 5; i++) engine.setBundle(STORM, bundle);

ok(map.calls.setData === 0,
   'five selections with the switch off write to the source zero times');
ok(floodMatchRuns() === 0,
   'and the corridor match never ran at all — this is the cost, not the setData');

engine.clearSelection();
ok(map.calls.setData === 0,
   'and closing the selection does not write either');

/* ==========================================================================
 * THE OTHER HALF OF THAT GATE — TURNING IT ON MUST DRAW AT ONCE
 * ========================================================================== */
section('turning the switch ON draws immediately, not at the next poll');

resetFloodLayer();
map = stubMap();
engine = createLayerEngine(map);
engine.attach();
setFloodAlerts(map, ALERTS);
engine.setBundle(STORM, bundle);
map.calls.setData = 0;

engine.setToggle('floodAlerts', true);
ok(map.calls.setData === 1,
   'flipping it on pushes once, with no new selection and no new fetch');
ok(map.calls.lastFeatures > 0,
   `and it pushes real shapes — ${map.calls.lastFeatures} features`);

/* ==========================================================================
 * FAULT 2 — AN UNCHANGED SELECTION MUST NOT REDO THE MATCH
 * ========================================================================== */
section('an unchanged bundle is matched once (§56.15 fault 2)');

/* The memo is keyed on the bundle and the alert list BY IDENTITY. The trap the
 * plan names is keying it on anything derived — `trackSamples()` builds a new
 * array on every call, so an identity test against samples never hits.
 *
 * This is measured through the feature count rather than a spy: a hit and a
 * miss both push, so the observable difference is whether the SAME array comes
 * back. `floodFeatures` is deterministic over one list, so identity of the
 * matched array is the honest probe. */
const seen = [];
const probeMap = stubMap();
probeMap.getSource = () => ({ setData(fc) { seen.push(fc); } });

resetFloodLayer();
engine = createLayerEngine(probeMap);
engine.attach();
setFloodAlerts(probeMap, ALERTS);
engine.setToggle('floodAlerts', true);
engine.setBundle(STORM, bundle);

ok(floodMatchRuns() === 1, 'the first selection runs the match once');
const firstCount = seen[seen.length - 1].features.length;

/* ==> THE COUNT, NOT THE ANSWER. <== Asserting that five pushes give the same
 * feature count passes with the memo deleted, because recomputing returns the
 * same answer. What separates a memo from no memo is how many times the work
 * happened. */
for (let i = 0; i < 4; i++) engine.setBundle(STORM, bundle);
ok(floodMatchRuns() === 1,
   'four more pushes of the SAME bundle run the match zero further times');
ok(seen[seen.length - 1].features.length === firstCount,
   'and the answer is unchanged, so the memo is not hiding a real update');

/* ==> AND A REAL CHANGE MUST STILL MISS. <== The failure that would matter is
 * the memo swallowing a genuine update: a storm's track moves, the map keeps
 * drawing the old corridor, and nothing says so. */
const movedBundle = bundleOverAlerts(2);
engine.setBundle(STORM, movedBundle);
ok(floodMatchRuns() === 2,
   'a NEW bundle object is re-matched rather than served from the memo');

/* A new alert list must also miss — a fetch landing mid-selection is exactly
 * when the map would otherwise keep drawing the previous answer. */
const trimmed = ALERTS.slice(0, Math.max(1, Math.floor(ALERTS.length / 2)));
setFloodAlerts(probeMap, trimmed);
ok(floodMatchRuns() === 3,
   'a new alert list is re-matched, not served from the memo');

/* ==> AND THE TRAP §56.15 NAMES BY NAME. <== Keying the memo on anything
 * DERIVED from the bundle — samples above all — never hits, because
 * `trackSamples()` builds a fresh array every call and an identity test
 * compares it with the copy it just made. A memo that never hits is the code
 * that was reverted. */
const runsBefore = floodMatchRuns();
for (let i = 0; i < 10; i++) engine.setBundle(STORM, movedBundle);
ok(floodMatchRuns() === runsBefore,
   'ten re-pushes of one bundle run the match zero times — the key is the bundle, not its samples');

/* ==========================================================================
 * IT IS PER-STORM, AND CLOSING THE SELECTION EMPTIES IT
 * ========================================================================== */
section('per-storm, and an empty globe when nothing is selected (§56.5)');

resetFloodLayer();
map = stubMap();
engine = createLayerEngine(map);
engine.attach();
setFloodAlerts(map, ALERTS);
engine.setToggle('floodAlerts', true);
engine.setBundle(STORM, bundle);
const withStorm = map.calls.lastFeatures;

engine.clearSelection();
ok(map.calls.lastFeatures === 0,
   'closing the selection clears the shapes off the globe');
ok(withStorm > 0 && withStorm < ALERTS.length,
   `and a storm draws a SUBSET, not the nation — ${withStorm} of ${ALERTS.length}`);

/* ==> THE NATIONAL DRAW IS GONE AND THIS IS THE ASSERTION THAT HOLDS IT GONE.
 * <== §56.1: the toggle lives in the `Storm detail` group, and a layer painting
 * every county in the country from that group was the contradiction this phase
 * exists to resolve. */

/* ==========================================================================
 * EXPIRY IS APPLIED AT RENDER, NOT ONLY AT FETCH
 * ========================================================================== */
section('an expired alert is never drawn');

const withExpiry = ALERTS.filter((a) => a.expires);
ok(withExpiry.length > 0, `the capture carries expiry times — ${withExpiry.length} of them`);

const past = Date.parse(withExpiry[0].expires) - 1000;
const future = Date.parse(withExpiry[0].expires) + 86_400_000;
const drawnEarly = floodFeatures(withExpiry, past).features.length;
const drawnLate = floodFeatures(withExpiry, future).features.length;
ok(drawnLate < drawnEarly,
   `expiry is honoured at render — ${drawnEarly} drawn before, ${drawnLate} a day later`);
ok(drawnLate === 0 || drawnLate < withExpiry.length,
   'and nothing that has run out survives into the feature set');

/* --- report -------------------------------------------------------------- */
if (failures.length) {
  console.log(`\n✗ ${failures.length} failed:`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (cost SHAPE only — whether it FEELS fast is CI or a phone, never here)');
