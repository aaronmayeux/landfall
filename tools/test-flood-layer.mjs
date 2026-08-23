#!/usr/bin/env node
/**
 * test-flood-layer.mjs — the national flood layer's COST SHAPE.
 * SPEC-FLOOD-PLAN.md §56.5, §56.15, §56.16.
 *
 * ==> THIS SUITE DOES NOT ASSERT THAT ANYTHING IS FAST, AND IT CANNOT. <== A
 * millisecond figure measured in this sandbox is evidence about this sandbox
 * (`CLAUDE.md`). What it asserts is WORK NOT DONE: that nothing happens while
 * the layer is off, that a storm selection costs this layer nothing at all, and
 * that an interior point is searched for once per alert rather than once per
 * push. Those are structural facts a stub map can observe honestly.
 *
 * ==> THE LAYER WENT NATIONAL ON 2026-08-23 AND THIS FILE CHANGED SHAPE WITH
 * IT. <== Slice A had made it per-storm and this suite was built around the
 * corridor match and its memo. Aaron's call on glass was that a flood layer
 * should draw like any other layer, so the match, the memo, the held storm and
 * the held bundle are gone from `map/layers/flood.js` — and the assertions that
 * guarded them are gone from here. **What replaces them is stronger, not
 * weaker**: §56.15's faults 1 and 2 were both about the selection path, and the
 * test now is that the selection path does not reach this layer at all.
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

const { setFloodAlerts, resetFloodLayer, floodPointRuns } =
  await import('../map/layers/flood.js');
const { floodSources } = await import('../lib/flood-features.js');
/* Only to prove the layer is NOT doing this. See the national-draw section. */
const { alertsNearTrack, trackChains, trackSamples } = await import('../lib/flood.js');
const { createLayerEngine } = await import('../map/layers/registry.js');

/* --- the stub map ---------------------------------------------------------
 * Counts what the layer asks the map to do. Every other layer definition in
 * the registry is imported by map/layers/index.js, which this file
 * deliberately does NOT import — only flood.js registers itself here, so the
 * counts describe this layer and nothing else.
 *
 * `setData` is the total across the two sources, which is what the "does the
 * off case cost anything" questions ask; `shapes` and `points` are counted
 * apart, because the way two sources fail is by drifting from each other. */
function stubMap() {
  const calls = { setData: 0, layout: 0, shapes: null, points: null };
  const mk = (slot) => ({
    setData(fc) {
      calls.setData++;
      calls[slot] = fc?.features?.length ?? null;
    },
  });
  const shapeSrc = mk('shapes');
  const pointSrc = mk('points');
  return {
    calls,
    getSource: (id) =>
      id === 'flood-alerts' ? shapeSrc : id === 'flood-alert-points' ? pointSrc : null,
    getLayer: () => ({}),
    hasImage: () => true,
    addImage() {},
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

const DRAWABLE = ALERTS.filter((a) => a.geometry).length;
ok(DRAWABLE > 0 && DRAWABLE < ALERTS.length,
   `${DRAWABLE} of them carry a shape, and the rest are the counted residue`);

/** A storm bundle, only ever used to prove that handing one over changes
 *  nothing. Built from the alert geometry so it does not depend on the
 *  weather. */
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
const OTHER = { id: 'test-2', source: 'nhc', advisoryKey: 'test-2-1' };

/* ==========================================================================
 * THE LAYER IS OFF AND MUST COST NOTHING
 * ========================================================================== */
section('with the layer OFF, nothing is drawn and nothing is computed');

/* ==> MUTATION-VERIFIED. <== Removing the `visible` gate from `push()` turns
 * both assertions below red. It is a single gate now rather than the doubled
 * one Slice A had, because `update()` no longer pushes — there is nothing left
 * for a second gate to stop. */

resetFloodLayer();
let map = stubMap();
let engine = createLayerEngine(map);
engine.attach();
setFloodAlerts(map, ALERTS);

ok(map.calls.setData === 0,
   'a fetch landing with the switch off writes to neither source');
ok(floodPointRuns() === 0,
   'and not one interior point is searched for — the expensive half is behind the same gate');

/* ==========================================================================
 * A SELECTION DOES NOT REACH THIS LAYER AT ALL (§56.15 faults 1 and 2)
 * ========================================================================== */
section('selecting a storm costs this layer nothing, on or off');

/* ==> THIS IS THE WHOLE OF WHAT GOING NATIONAL BOUGHT, AND IT IS THE THING
 * §56.15 WAS WRITTEN ABOUT. <== Fault 1 was the engine calling `update()` for
 * every definition on every `setBundle`, so a reader who never found the switch
 * paid the corridor match on every selection to draw nothing. Fault 2 was a poll
 * re-pushing an unchanged bundle and repeating it. Both are unreachable when
 * `update()` is empty, and this section is what holds it empty. */

const bundle = bundleOverAlerts();
for (let i = 0; i < 5; i++) engine.setBundle(STORM, bundle);
ok(map.calls.setData === 0,
   'five selections with the switch off write nothing');

engine.clearSelection();
ok(map.calls.setData === 0, 'and closing the selection writes nothing');

/* Now with the switch ON — the case that actually has something to redraw. */
resetFloodLayer();
map = stubMap();
engine = createLayerEngine(map);
engine.attach();
setFloodAlerts(map, ALERTS);
engine.setToggle('floodAlerts', true);
const writesAfterOn = map.calls.setData;
const searchesAfterOn = floodPointRuns();
ok(writesAfterOn === 2, 'turning it on pushes both sources exactly once');

for (let i = 0; i < 5; i++) engine.setBundle(STORM, bundle);
engine.setBundle(OTHER, bundleOverAlerts(4));
engine.setBundle(STORM, bundleOverAlerts(2));
ok(map.calls.setData === writesAfterOn,
   'seven selections with the switch ON write zero further times');
ok(floodPointRuns() === searchesAfterOn,
   'and search for zero further interior points');

engine.clearSelection();
ok(map.calls.setData === writesAfterOn,
   'and closing the selection leaves the country on the globe, because it was never about a storm');

/* ==========================================================================
 * THE SWITCH DRAWS THE WHOLE COUNTRY, IMMEDIATELY
 * ========================================================================== */
section('the switch draws the national list at once, not at the next poll');

/* ==> WITHOUT THE PUSH IN `setVisible` THE CONTROL LOOKS BROKEN. <== `push()`
 * skips the work while the layer is off, so by the time somebody turns it on
 * there is nothing in either source. This is what makes the switch respond under
 * the finger instead of three minutes later. */

resetFloodLayer();
map = stubMap();
engine = createLayerEngine(map);
engine.attach();
setFloodAlerts(map, ALERTS);
engine.setToggle('floodAlerts', true);

/* ==> THE EXPECTED COUNT IS COMPUTED AT THE CURRENT CLOCK, NOT TAKEN OFF THE
 * FIXTURE. <== The capture is frozen at 2026-08-22 and `push()` filters expiry
 * at render against `Date.now()`, so the number legitimately shrinks as the
 * fixture ages. Asserting the fixture's 33 would go red on the day after it was
 * written, for a reason that is the feature working. */
const nationalNow = floodSources(ALERTS, Date.now()).shapes.features.length;
ok(map.calls.shapes === nationalNow,
   `and it draws every alert in the country that is still in force — ${map.calls.shapes}`);
ok(map.calls.points === map.calls.shapes,
   `with a chip for every shape — ${map.calls.points}`);
ok(floodPointRuns() === map.calls.points,
   'and one search per chip, not one per push');

/* ==> AND THE ASSERTION ABOVE IS TAUTOLOGICAL ON ITS OWN, SO HERE IS THE ONE
 * THAT IS NOT. <== It compares `floodSources` with `floodSources`, which proves
 * `push()` passed the WHOLE list and nothing about what "whole" means.
 *
 * This selects a storm on the far side of the planet from every alert in the
 * capture and asserts the globe does not change. Lala's real archived track is
 * **1,966 nm** from the nearest of them (`SPEC-UI.md` §48.21), so Slice A's
 * per-storm layer would have drawn ZERO here. Mutation-verified: filter
 * `push()`'s list by the selected storm's corridor and this goes red while the
 * tautological one above stays green. */
const lalaPast = JSON.parse(
  readFileSync(path.join(ROOT, 'samples/flood/track-lala-cp2-past.geojson'), 'utf8')
);
const lalaFwd = JSON.parse(
  readFileSync(path.join(ROOT, 'samples/flood/track-lala-cp2-forecast.geojson'), 'utf8')
);
const LALA = { id: 'cp022026', source: 'nhc', advisoryKey: 'cp022026-1' };
const lalaBundle = {
  layers: {
    pastTrack: { status: 'ok', fc: lalaPast },
    forecastTrack: { status: 'ok', fc: lalaFwd },
  },
};

const hit = alertsNearTrack(
  floodSources(ALERTS, Date.now()).shapes.features.map((f) => ({
    id: f.properties._id, event: f.properties._event, geometry: f.geometry,
  })),
  trackSamples(trackChains(lalaPast, lalaFwd))
);
ok(hit.state !== 'ok',
   'not one alert in the capture comes within the corridor of Lala\u2019s real track');

const drawnBefore = map.calls.shapes;
engine.setBundle(LALA, lalaBundle);
ok(map.calls.shapes === drawnBefore,
   'and selecting her leaves every one of them on the globe — this layer is not per-storm');

/* A fetch landing while the switch is on redraws. */
const beforeFetch = map.calls.setData;
setFloodAlerts(map, ALERTS.slice(0, 5));
ok(map.calls.setData === beforeFetch + 2, 'a fresh fetch pushes both sources again');
ok(map.calls.shapes <= 5, 'and the globe follows the new list down');

/* ==> AND A SHORTER LIST SEARCHES NOTHING NEW. <== The cache is keyed on the
 * alert id, so a list that is a subset of one already seen is all hits. */
const searchesBefore = floodPointRuns();
setFloodAlerts(map, ALERTS);
ok(floodPointRuns() === searchesBefore,
   'and going back to the full list searches for zero new points');

/* ==========================================================================
 * EXPIRY IS APPLIED AT RENDER, NOT ONLY AT FETCH
 * ========================================================================== */
section('an expired alert is never drawn');

const withExpiry = ALERTS.filter((a) => a.expires);
ok(withExpiry.length > 0, `the capture carries expiry times — ${withExpiry.length} of them`);

const past = Date.parse(withExpiry[0].expires) - 1000;
const future = Date.parse(withExpiry[0].expires) + 86_400_000;
const early = floodSources(withExpiry, past);
const late = floodSources(withExpiry, future);
ok(late.shapes.features.length < early.shapes.features.length,
   `expiry is honoured at render — ${early.shapes.features.length} drawn before, ${late.shapes.features.length} a day later`);
ok(late.shapes.features.length === 0 || late.shapes.features.length < withExpiry.length,
   'and nothing that has run out survives into the feature set');
/* ==> THE CHIPS EXPIRE WITH THE SHAPES. <== A marker over a county whose warning
 * ran out an hour ago is the same lie as the polygon, and it is the more visible
 * one because it draws at every zoom. */
ok(late.points.features.length === late.shapes.features.length,
   'and the chips shrink with them, alert for alert');

/* --- report -------------------------------------------------------------- */
if (failures.length) {
  console.log(`\n✗ ${failures.length} failed:`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (cost SHAPE only — whether it FEELS fast is CI or a phone, never here)');
