/**
 * test-app-layer-state.mjs — the same global-state rules, on the layers the app
 * adds itself.
 *
 * `tools/test-theme-state.mjs` walks `buildStyle()`, which is the BASEMAP. The
 * cones, tracks, forecast points, storm markers and graticule are added
 * imperatively at `style.load` and never appear in that object — so the check
 * that would have caught the black ring could not see the layer the black ring
 * was on.
 *
 * This builds them for real: import `map/layers/index.js` so every module
 * registers itself, then run the actual layer engine against a stub map that
 * records `addLayer`. No mocking of the layer definitions themselves — the
 * objects checked below are the objects MapLibre would receive.
 *
 * Zero dependencies. `node tools/test-app-layer-state.mjs`.
 */

import path from 'node:path';
process.chdir(path.resolve(import.meta.dirname, '..'));

const { assertNoDataDrivenState, stateKeys } = await import('./lib-state-scan.mjs');
const { THEME_STATE } = await import('../map/theme-state.js');

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };

const added = [];
const stub = {
  getSource: () => null,
  addSource: () => {},
  getLayer: () => null,
  addLayer: (l) => added.push(l),
  on: () => {},
};

await import('../map/layers/index.js');
const { createLayerEngine } = await import('../map/layers/registry.js');
createLayerEngine(stub).attach();

ok(added.length > 10, `only ${added.length} app layers built — the engine did not attach`);

/* THE RULE THAT SHIPPED A BLACK RING. See the long note in
 * tools/test-theme-state.mjs. */
assertNoDataDrivenState(added, 'app layers', ok);

/* And every gs() key these layers reference is one that actually exists —
 * token-check greps the source for this, which cannot see a key built by
 * string concatenation. This sees the object. */
for (const layer of added) {
  for (const k of stateKeys(layer.paint)) {
    ok(k in THEME_STATE,
       `${layer.id} references global-state '${k}', which THEME_STATE does not publish — ` +
       `MapLibre would read undefined and drop the layer`);
  }
}

console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(failures.length ? `\n  ${pass} passed, ${failures.length} failed`
                            : `\n✓ ${pass} assertions passed across ${added.length} app layers`);
process.exit(failures.length ? 1 : 0);
