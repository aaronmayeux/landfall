/**
 * test-layer-defaults.mjs — what a first-time visitor sees, pinned.
 *
 * The defaults in config/layers.js are a product decision, not a detail
 * (§7). They were set on 2026-10-09 to match Aaron's own phone: full-track
 * wind swath, watch/warning stripe, every model track on, cone off. A default
 * flipped by a tidy-up would change what every new visitor lands on with no
 * test going red, so this pins all of them, plus the two start-up seeds that
 * have to agree with them or the map flashes a layer and then removes it.
 *
 * Zero dependencies. `node tools/test-layer-defaults.mjs`.
 */

import path from 'node:path';
import fs from 'node:fs';
process.chdir(path.resolve(import.meta.dirname, '..'));

const { defaultLayerState, defaultModelState } = await import('../config/layers.js');

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };

const EXPECTED = {
  windField: 'swath',
  coastal: 'watchWarning',
  imagery: 'off',
  genesis: true,
  forecastTimes: true,
  cone: false,
  environment: false,
  modelTracks: true,
  floodAlerts: false,
  homeMarker: true,
  stateNames: true,
  cities: true,
  graticule: false,
  population: false,
};

const got = defaultLayerState();
for (const [k, v] of Object.entries(EXPECTED)) {
  ok(got[k] === v, `default ${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(got[k])}`);
}
for (const k of Object.keys(got)) {
  ok(k in EXPECTED, `new layer "${k}" has no pinned default here — add it deliberately`);
}

/* Every model in the shortlist starts checked. */
const models = defaultModelState();
ok(Object.keys(models).length > 0, 'model shortlist is empty');
for (const [k, v] of Object.entries(models)) ok(v === true, `model ${k} does not default on`);

/* The start-up seeds. Read from source, because the modules need a map to
 * import and the seed is a single line whose only job is to agree with the
 * manifest above. */
const seed = (file) => {
  const m = fs.readFileSync(file, 'utf8').match(/^let visible = (true|false);/m);
  return m ? m[1] === 'true' : undefined;
};
ok(seed('map/layers/cone.js') === EXPECTED.cone,
  'cone.js start-up seed disagrees with the cone default (flash on load)');
ok(seed('map/layers/genesis.js') === EXPECTED.genesis,
  'genesis.js start-up seed disagrees with its default');

if (failures.length) {
  console.error(`test-layer-defaults: ${failures.length} FAILED, ${pass} passed`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`test-layer-defaults: ${pass} passed`);
