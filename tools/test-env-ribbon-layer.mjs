#!/usr/bin/env node
/**
 * test-env-ribbon-layer.mjs — the environment ribbon draws for the storm you
 * TAPPED, not only for the ones you did not. §47.5.
 *
 * WHAT THIS IS FOR. The layer shipped with an ambient source and a no-op
 * `update`, on the belief that one presentation was enough. `registry.js`
 * excludes the selected storm from the ambient merge — deliberately, so its
 * geometry does not draw twice — so tapping a storm erased its own ribbon and
 * closing the drawer brought it back. Every OTHER storm on screen kept its
 * color the whole time, which is what made it read as a caching fault.
 *
 * Nothing in `lib/cone-ribbon.js` was wrong, so no ribbon-building test could
 * have caught it: the slices were built correctly and then handed to a source
 * nobody was drawing. This runs the REAL engine against a stub map and asks
 * the only question that matters — after a tap, are the slices on the map.
 *
 * Zero dependencies. Run: node tools/test-env-ribbon-layer.mjs
 */

import path from 'node:path';
process.chdir(path.resolve(import.meta.dirname, '..'));

await import('../map/layers/environment.js');
const { createLayerEngine } = await import('../map/layers/registry.js');

let pass = 0;
const failures = [];
const ok = (cond, msg) => { cond ? pass++ : failures.push(msg); };

/* A stub map that records what each source was last handed and what each
 * layer's visibility was last set to. Everything below reads these two maps —
 * no assertion inspects the layer module's own variables, because a test that
 * reads the implementation agrees with the bug. */
function stubMap() {
  const sources = new Map();
  const layers = new Map();
  return {
    sources,
    layers,
    getSource: (id) => sources.get(id),
    addSource: (id) => sources.set(id, {
      data: { type: 'FeatureCollection', features: [] },
      setData(fc) { this.data = fc; },
    }),
    getLayer: (id) => layers.get(id),
    addLayer: (l) => layers.set(l.id, { ...l, visibility: 'visible' }),
    setLayoutProperty: (id, _prop, value) => {
      const l = layers.get(id);
      if (l) l.visibility = value;
    },
  };
}

const count = (map, id) => map.getSource(id)?.data?.features?.length ?? 0;

/** One storm's environment slot, in the shape app/bundle-pipeline.js writes. */
const bundleFor = (tag) => ({
  layers: {
    environment: {
      status: 'ok',
      fc: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { tag } }] },
    },
  },
});

const hernan = { id: 'ep08' };
const lala = { id: 'cp01' };

const map = stubMap();
const engine = createLayerEngine(map);
engine.attach();
/* The row ships off, so nothing is visible until it is switched on. Every
 * assertion below is about WHICH FEATURES REACH WHICH SOURCE, which is
 * independent of the switch — the visibility rules get their own block. */
engine.setToggle('environment', true);

engine.ambientBundle(hernan, bundleFor('hernan'));
engine.ambientBundle(lala, bundleFor('lala'));

ok(count(map, 'amb-env-ribbon') === 2,
   `both storms' slices should be ambient before any tap — found ${count(map, 'amb-env-ribbon')}`);

/* ==> THE BUG, IN ONE ASSERTION. <== */
engine.setBundle(hernan, bundleFor('hernan'));
ok(count(map, 'sel-env-ribbon') === 1,
   'tapping a storm must draw ITS ribbon on the selection source — this is the ' +
   'regression that made a tapped cone go back to plain veil');
ok(count(map, 'amb-env-ribbon') === 1,
   `the tapped storm must LEAVE the ambient merge so it is not drawn twice — ` +
   `ambient held ${count(map, 'amb-env-ribbon')}`);
ok(map.getSource('amb-env-ribbon').data.features.every((f) => f.properties.tag === 'lala'),
   'the storm left in the ambient merge must be the one that was not tapped');

/* Selecting a second storm hands the sources over rather than accumulating. */
engine.setBundle(lala, bundleFor('lala'));
ok(count(map, 'sel-env-ribbon') === 1 &&
   map.getSource('sel-env-ribbon').data.features[0].properties.tag === 'lala',
   'selecting a second storm replaces the selection ribbon, never appends to it');
ok(map.getSource('amb-env-ribbon').data.features.every((f) => f.properties.tag === 'hernan'),
   'the previously-selected storm rejoins the ambient merge');

/* Closing the drawer. The formerly-selected storm goes back to ambient and the
 * selection source empties — otherwise its ribbon draws twice, at double
 * opacity, on exactly the storm the reader was just looking at. */
engine.clearSelection();
ok(count(map, 'sel-env-ribbon') === 0,
   'closing the drawer must empty the selection source');
ok(count(map, 'amb-env-ribbon') === 2,
   `both storms return to ambient after deselection — found ${count(map, 'amb-env-ribbon')}`);

/* A storm with no run at all. The slot is `status: 'none'` with a null `fc`,
 * and the selection source has to end up EMPTY rather than keeping whatever
 * the last storm put there — the previous storm's ribbon under this storm's
 * name is the §5 failure, wearing the map's clothes. */
engine.setBundle(hernan, bundleFor('hernan'));
engine.setBundle(lala, { layers: { environment: { status: 'none', fc: null } } });
ok(count(map, 'sel-env-ribbon') === 0,
   'a selected storm with no drawable run must clear the selection source, not ' +
   "inherit the previous storm's slices");

/* THE SWITCH REACHES BOTH LAYERS. One presentation left visible under a
 * switched-off row is half a layer, which reads as a bug rather than as a
 * control. */
const ids = ['amb-env-ribbon-fill', 'sel-env-ribbon-fill'];
engine.setToggle('environment', false);
for (const id of ids) {
  ok(map.getLayer(id)?.visibility === 'none', `${id} must hide when the row is switched off`);
}
engine.setToggle('environment', true);
for (const id of ids) {
  ok(map.getLayer(id)?.visibility === 'visible', `${id} must come back when the row is switched on`);
}

/* Both presentations paint identically. They differ only in which source they
 * read; a shade of difference between them would show as the tapped cone
 * changing color at the moment of the tap. */
const paints = ids.map((id) => JSON.stringify(map.getLayer(id).paint));
ok(paints[0] === paints[1],
   'the two presentations must carry identical paint — a tap must not change the color');

console.log('');
for (const f of failures) console.log(`  \u2717 ${f}`);
console.log(failures.length
  ? `\n  ${pass} passed, ${failures.length} failed`
  : `\n\u2713 ${pass} assertions passed — the ribbon survives a tap`);
console.log('  (whether the violet reads right against the cone is glass)');
process.exit(failures.length ? 1 : 0);
