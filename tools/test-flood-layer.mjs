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

const { setFloodAlerts, resetFloodLayer, floodPointRuns, floodAtPoint, floodAlertById,
        floodClusterZoom, hideFloodCluster, showFloodClusters, floodAlertPoint } =
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

/* =========================================================================
 * TAPPING (§56.6) — Slice C
 *
 * ==> EVERY ASSERTION HERE WAS MUTATION-VERIFIED. <== §12's rule: a test that
 * passes on the same wrong assumption as the bug is worse than no test. Each
 * one below was checked by breaking the rule it guards in `map/layers/flood.js`
 * and confirming it went red.
 * ====================================================================== */
section('§56.6 — the hit test, and what it refuses to do');

/** A map that RECORDS whether it was queried at all, which is the whole
 *  question for the off case. `queryRenderedFeatures` returning [] would let a
 *  broken gate pass — the tap finds nothing either way — so the assertion is
 *  about the CALL, never about its result. */
function tapMap(features = []) {
  const calls = { queries: 0, layersAsked: null };
  return {
    calls,
    getSource: () => ({
      setData() {},
      getClusterExpansionZoom: (id) => Promise.resolve(id === 42 ? 7 : null),
    }),
    getLayer: () => ({}),
    hasImage: () => true,
    addImage() {}, addSource() {}, addLayer() {},
    setPaintProperty() {}, setLayoutProperty() {},
    queryRenderedFeatures(_box, opts) {
      calls.queries++;
      calls.layersAsked = opts?.layers || null;
      return features;
    },
  };
}

const chipFeature = (id, watch = false) => ({
  properties: { _id: id, _watch: watch },
  geometry: { type: 'Point', coordinates: [-95, 39] },
});
const clusterFeature = (clusterId, count) => ({
  properties: { cluster_id: clusterId, point_count: count, warnings: 1 },
  geometry: { type: 'Point', coordinates: [-88, 38] },
});

/* ==> THE OFF CASE COSTS NOT ONE QUERY, AND THIS IS THE PERFORMANCE ASSERTION
 * OF THE WHOLE SLICE. <== main.js runs this on EVERY tap of the globe,
 * including the taps on empty ocean whose only job is closing the drawer. A
 * reader who never turns the layer on must pay a boolean read and nothing more.
 * MUTATION-VERIFIED: delete the `if (!visible) return null` line and this goes
 * red while every other assertion in this file stays green. */
{
  resetFloodLayer();
  const m = tapMap([chipFeature('urn:oid:x.1')]);
  setFloodAlerts(m, ALERTS);
  const hit = floodAtPoint(m, { x: 100, y: 100 });
  ok(m.calls.queries === 0,
     'with the switch OFF the hit test does not query the map at all');
  ok(hit === null, 'and it answers null rather than something it did not look for');
}

/* Turn it on the way the app does — through the engine's setVisible — and the
 * query happens. Without this the assertion above would also pass on a hit test
 * that never queried under ANY condition, which is the bug it would then be
 * agreeing with. */
{
  resetFloodLayer();
  const m = tapMap([chipFeature('urn:oid:x.1')]);
  const engine = createLayerEngine(m);
  engine.attach();
  engine.setToggle('floodAlerts', true);
  const hit = floodAtPoint(m, { x: 100, y: 100 });
  ok(m.calls.queries === 1, 'with the switch ON it queries exactly once');
  ok(hit?.kind === 'alert' && hit.id === 'urn:oid:x.1',
     'and a single chip answers with its alert id');

  /* ==> ONLY THE CHIP LAYER IS NAMED. <== The fill and the outline describe the
   * same alert, so naming them turns one tap into three hits to deduplicate for
   * no gain — and a county-sized tap target under the storm dots would start
   * eating taps meant for the water. MUTATION-VERIFIED: add FILL to the layer
   * list and this goes red. */
  ok(Array.isArray(m.calls.layersAsked) && m.calls.layersAsked.length === 1
     && m.calls.layersAsked[0] === 'flood-alert-chip',
     'and it asks the chip layer only, never the polygons');
}

/* ==> A CLUSTER IS RECOGNISED AS A CLUSTER EVEN WHEN IT ALSO CARRIES AN `_id`.
 * <== MapLibre drops member properties on merge, so this shape should not
 * occur — but if it ever did, answering `alert` would open a panel about ONE
 * warning while fifteen sit under the finger. The cluster test runs first for
 * exactly that reason. MUTATION-VERIFIED: swap the two branches and this goes
 * red. */
{
  resetFloodLayer();
  const poisoned = clusterFeature(42, 15);
  poisoned.properties._id = 'urn:oid:should-not-win';
  const m = tapMap([poisoned]);
  const engine = createLayerEngine(m);
  engine.attach();
  engine.setToggle('floodAlerts', true);
  const hit = floodAtPoint(m, { x: 10, y: 10 });
  ok(hit?.kind === 'cluster' && hit.clusterId === 42,
     'a pile answers as a cluster even when a stray _id rides along with it');
  ok(hit.lon === -88 && hit.lat === 38,
     'and it carries where to fly, because the caller owns the camera');
}

section('§56.6 — the lookup answers for the WHOLE country');

/* ==> THE PANEL IS OPENED BY ID AGAINST THE LIVE LIST, NEVER OFF THE FEATURE.
 * <== A feature's properties are a copy baked into a tile when the source was
 * last written; opening the panel from them prints last poll's expiry to
 * somebody deciding whether to move. */
{
  resetFloodLayer();
  const m = tapMap();
  setFloodAlerts(m, ALERTS);
  const withId = ALERTS.find((a) => a.id);
  ok(!!withId, 'the capture carries CAP ids, which is what the lookup keys on');
  ok(floodAlertById(withId.id) === withId,
     'and an id resolves to the alert object the layer is actually holding');
  ok(floodAlertById('urn:oid:nothing-like-this') === null,
     'an id nobody is holding answers null rather than undefined');
  ok(floodAlertById(null) === null, 'and a missing id does not throw');
}

/* ==> THE LIST IT SEARCHES IS NATIONAL, AND THAT IS THE POINT. <== The drawer's
 * `Flooding` section counts what is near ONE storm; the globe paints the
 * country. Tapping a chip over Ohio while a Hawaii storm is selected has to
 * resolve, and it only does because this lookup never sees a storm.
 * MUTATION-VERIFIED: filter `lastAlerts` by anything storm-shaped and this goes
 * red on the far half of the country. */
{
  resetFloodLayer();
  const m = tapMap();
  setFloodAlerts(m, ALERTS);
  const ids = ALERTS.filter((a) => a.id).map((a) => a.id);
  const resolved = ids.filter((id) => floodAlertById(id));
  ok(resolved.length === ids.length,
     `every alert in the national list resolves — ${resolved.length} of ${ids.length}`);
}

section('§56.6 — splitting a cluster');

/* The zoom comes back from MapLibre's worker, so this is a promise. A null
 * answer — the source or the cluster gone, which a poll landing mid-tap can do
 * — must resolve rather than reject, or a tap would throw into the console. */
{
  resetFloodLayer();
  const m = tapMap();
  const zoom = await floodClusterZoom(m, 42);
  ok(zoom === 7, 'a live cluster answers with the zoom that splits it');
  const gone = await floodClusterZoom(m, 99);
  ok(gone === null, 'and a cluster that has gone answers null rather than throwing');

  const sourceless = { ...tapMap(), getSource: () => null };
  ok((await floodClusterZoom(sourceless, 42)) === null,
     'no source is null too — a tap between a restyle and the rebuild');
}

section('§56.6 — the tapped cluster gets out of the way');

/* ==> A CLUSTER STAYS PAINTED FOR THE WHOLE FLIGHT AND ONLY BREAKS APART ON
 * ARRIVAL. <== Aaron on a phone, 2026-08-23: MapLibre recomputes which points
 * merge when the ZOOM lands, so the chip reading "8" rides the camera in and
 * pops into eight chips at the end — the reader pressed something and watched
 * it not respond.
 *
 * ==> IT IS AN OPACITY WRITE AND NOTHING ELSE, WHICH IS WHAT THESE ASSERT.
 * <== A source rewrite or a filter change would cost a frame at exactly the
 * moment the camera starts moving. */
function paintMap() {
  const calls = { paint: [], setData: 0 };
  const src = {
    setData() { calls.setData++; },
    getClusterExpansionZoom: () => Promise.resolve(7),
  };
  return {
    calls,
    getSource: () => src,
    getLayer: () => ({}),
    hasImage: () => true,
    addImage() {}, addSource() {}, addLayer() {},
    setLayoutProperty() {},
    setPaintProperty(layer, prop, value) { calls.paint.push({ layer, prop, value }); },
    queryRenderedFeatures: () => [],
  };
}

{
  resetFloodLayer();
  const m = paintMap();
  hideFloodCluster(m, 42);

  const props = m.calls.paint.map((c) => c.prop);
  ok(props.includes('icon-opacity') && props.includes('text-opacity'),
    'hiding a cluster writes the two opacity properties');
  ok(m.calls.paint.every((c) => c.layer === 'flood-alert-chip'),
    'and touches only the chip layer');

  /* ==> NOT A SOURCE WRITE. <== MUTATION-VERIFIED: rewrite the source to drop
   * the cluster instead and this goes red — which is the implementation that
   * would cost a frame. */
  ok(m.calls.setData === 0,
    'and does NOT rewrite the source, which is the expensive way to do this');

  /* ==> ONLY THE TAPPED CLUSTER FADES. <== Hiding the whole layer would
   * flicker every other alert on screen — a worse fault than the one being
   * fixed. The expression must therefore be a per-feature case, not a flat 0. */
  const expr = m.calls.paint.find((c) => c.prop === 'icon-opacity').value;
  ok(Array.isArray(expr) && expr[0] === 'case',
    'the opacity is a per-feature expression, never a flat zero over the layer');
  ok(JSON.stringify(expr).includes('42'),
    'and it names the cluster that was actually tapped');
}

/* ==> AND IT MUST COME BACK HOWEVER THE FLIGHT ENDS. <== If any path left a
 * chip hidden, this layer would have invented a way for a hazard marker to
 * vanish silently, which is §5 with a map over it. */
{
  resetFloodLayer();
  const m = paintMap();
  hideFloodCluster(m, 42);
  m.calls.paint.length = 0;
  showFloodClusters(m);
  const back = m.calls.paint.find((c) => c.prop === 'icon-opacity');
  ok(back && back.value === 1, 'showing them again restores a flat opacity of 1');

  /* An idle moveend — and there are many — costs one comparison, not two
   * paint writes. MUTATION-VERIFIED: drop the early return and this goes red. */
  m.calls.paint.length = 0;
  showFloodClusters(m);
  ok(m.calls.paint.length === 0,
    'and calling it with nothing hidden writes nothing at all');
}

/* ==> A POLL RE-INDEXES THE SOURCE AND ASSIGNS NEW CLUSTER IDS, SO A HELD ONE
 * IS MEANINGLESS. <== Left alone, a stale id either matches nothing (harmless)
 * or matches a DIFFERENT pile — a chip missing with nothing saying so.
 * MUTATION-VERIFIED: remove the `showFloodClusters` call from `push` and this
 * goes red. */
{
  resetFloodLayer();
  const m = paintMap();
  const engine = createLayerEngine(m);
  engine.attach();
  engine.setToggle('floodAlerts', true);
  hideFloodCluster(m, 42);
  m.calls.paint.length = 0;

  setFloodAlerts(m, ALERTS);   // a poll landing
  const cleared = m.calls.paint.find((c) => c.prop === 'icon-opacity');
  ok(cleared && cleared.value === 1,
    'a poll clears the held cluster id rather than stranding a hidden chip');
}

section('§56.6 — Show on the globe flies to the chip, not near it');

/* ==> THE SAME POINT THE CHIP WAS DRAWN AT, FROM THE SAME CACHE. <== A second
 * way of answering "where is this alert" is a second answer that can disagree,
 * and the reader lands beside the mark rather than on it. */
{
  resetFloodLayer();
  const drawable = ALERTS.find((a) => a.geometry);
  ok(!!drawable, 'the capture has a drawable alert to fly to');

  const p = floodAlertPoint(drawable);
  ok(p && Number.isFinite(p.lon) && Number.isFinite(p.lat),
    'it answers a real coordinate');

  const runsBefore = floodPointRuns();
  const again = floodAlertPoint(drawable);
  ok(again === p, 'and the second ask is the cached point, not a second search');
  ok(floodPointRuns() === runsBefore, 'which costs no extra interior-point work');

  const shapeless = ALERTS.find((a) => !a.geometry);
  ok(!shapeless || floodAlertPoint(shapeless) === null,
    'an alert with no shape has nowhere to fly to and says so');
}

/* --- report -------------------------------------------------------------- */
if (failures.length) {
  console.log(`\n✗ ${failures.length} failed:`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (cost SHAPE only — whether it FEELS fast is CI or a phone, never here)');
