/**
 * test-archive-paint.mjs — live geometry must not reach the sepia globe.
 * §57.21c.
 *
 * ==> THIS SUITE EXISTS BECAUSE THE LAST ONE TESTED THE RULE AND THE WIRING
 * WAS WHAT BROKE. <== `tools/test-seasons-board.mjs` proves the roster's
 * active rule, mutation-verified, and it stayed green through a week in which
 * every live storm's cone was painted over 1935. The rule was never the
 * problem. So nothing below asserts a rule: it drives the REAL layer engine
 * through the REAL doors main.js pushes through, with the flag flipped, and
 * asks what came out the other side.
 *
 * The second half is blunter still and deliberately so. It reads the shipped
 * `main.js` and asserts the engine is CONSTRUCTED with the gate — because a
 * refusal nobody wired up is exactly the state this suite was written to
 * correct, and a behavioural test of the engine alone cannot see that.
 *
 * Zero dependencies, plain node.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };
const eq = (what, got, want) => ok(
  `${what}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`,
  JSON.stringify(got) === JSON.stringify(want)
);

const { createLayerEngine, registerLayer } = await import('../map/layers/registry.js');

/* ---------------------------------------------------------------------------
 * A stand-in layer and a stand-in map.
 *
 * The engine's whole job is to hand feature arrays to layer definitions, so a
 * definition that records what it was handed IS the observation point. No
 * MapLibre needed and none faked: `ensure`, `update`, `clear` and
 * `updateAmbient` are the entire contract this file calls.
 * ------------------------------------------------------------------------ */

/** Everything the engine pushed at a layer, newest last. */
const drawn = { ambient: [], selected: [], cleared: 0, forgotten: [] };

registerLayer({
  key: 'cone',
  type: 'baseline',
  order: 10,
  ensure: () => {},
  update: (_map, storm) => drawn.selected.push(storm.id),
  clear: () => { drawn.cleared++; },
  updateAmbient: (_map, features) => drawn.ambient.push(features.map((f) => f.id)),
  forget: (id) => drawn.forgotten.push(id),
});

/** The engine only ever asks the map for a layer, to find its insert anchor. */
const map = { getLayer: () => null };

/** A bundle in the shape `ambientFeatures` reads: one ok slot, one feature. */
const bundleFor = (id) => ({
  layers: { cone: { status: 'ok', error: null, fc: { features: [{ id }] } } },
});

/** The newest ambient push, or null if the engine never made one. */
const lastAmbient = () => (drawn.ambient.length ? drawn.ambient.at(-1) : null);

function fresh() {
  drawn.ambient.length = 0;
  drawn.selected.length = 0;
  drawn.cleared = 0;
  drawn.forgotten.length = 0;
}

/* ---------------------------------------------------------------------------
 * 1. THE LIVE WORLD IS THE CONTROL. Everything below is a claim about what
 *    CHANGES when the archive opens, so it is worth nothing without proof
 *    that the ordinary case draws.
 * ------------------------------------------------------------------------ */

{
  fresh();
  const engine = createLayerEngine(map, { painting: () => true });
  engine.ambientBundle({ id: 'nhc:ep092026' }, bundleFor('ep09-cone'));
  eq('live: an ambient bundle reaches the layer', lastAmbient(), ['ep09-cone']);

  engine.setBundle({ id: 'nhc:cp012026' }, bundleFor('cp01-cone'));
  eq('live: a selected bundle reaches the layer', drawn.selected, ['nhc:cp012026']);
}

/* ---------------------------------------------------------------------------
 * 2. THE ARCHIVE IS OPEN, AND EACH OF THE FOUR MISSED ROADS ENDS HERE.
 *
 *    They are driven by NAME rather than as one loop, because the point of
 *    the fix is that four different callers with four different reasons all
 *    have to obey one rule — and a single generic assertion would not say
 *    which of them a regression had let back in.
 * ------------------------------------------------------------------------ */

{
  fresh();
  let archive = false;
  const engine = createLayerEngine(map, { painting: () => !archive });

  /* Enter: the poll has already warmed this week's storms, so the engine is
   * holding them and the layer has drawn them. That is the real starting
   * state and it matters — a suite that entered the archive from an empty
   * engine could not tell a refusal from a globe that was blank anyway. */
  engine.ambientBundle({ id: 'nhc:ep092026' }, bundleFor('ep09-cone'));
  engine.ambientBundle({ id: 'nhc:ep102026' }, bundleFor('ep10-cone'));
  eq('entry: two live storms are drawn before the door is pressed',
    lastAmbient(), ['ep09-cone', 'ep10-cone']);

  /* `openSeasons` order: the wall, then the selection, then `liveGlobe.hide()`,
   * then the palette. The flag is up BEFORE the clearing call, which is why
   * `ambientPrune` must not be behind the same gate. */
  archive = true;
  engine.ambientPrune(new Set());
  eq('hide(): the prune empties the globe even though the flag is already up',
    lastAmbient(), []);
  eq('hide(): and each layer is told which storms left',
    drawn.forgotten, ['nhc:ep092026', 'nhc:ep102026']);

  const after = drawn.ambient.length;

  /* ROAD 1 — the palette repaint. `forceMode(MODE.SEPIA)` announces, and
   * `app/theme-switch.js`'s `repaint()` calls main.js's `onRepushGuidance`,
   * which is `repushSelected()` + `repushAmbient()`. This is the one that put
   * everything back one line after `hide()` took it away. */
  engine.ambientBundle({ id: 'nhc:ep092026' }, bundleFor('ep09-cone'));
  engine.setBundle({ id: 'nhc:cp012026' }, bundleFor('cp01-cone'));
  eq('the palette repaint does not put the live cones back',
    drawn.ambient.length, after);
  eq('and does not put a selected storm back', drawn.selected, []);

  /* ROAD 2 — a layer toggle pressed inside the archive. Same two calls, from
   * `subscribeLayers`. */
  engine.ambientBundle({ id: 'nhc:ep102026' }, bundleFor('ep10-cone'));
  eq('a layer toggle inside the archive draws nothing live',
    drawn.ambient.length, after);

  /* ROAD 3 and 4 — `onDeckLanded` and `onShipsLanded`, minutes later, when a
   * model deck or a SHIPS run finishes. Asynchronous, which is the whole
   * reason the gate asks the question fresh instead of holding an answer. */
  engine.ambientBundle({ id: 'nhc:ep092026' }, bundleFor('ep09-guidance'));
  engine.ambientBundle({ id: 'nhc:ep092026' }, bundleFor('ep09-ribbon'));
  eq('a deck or a SHIPS run landing inside the archive draws nothing',
    drawn.ambient.length, after);

  /* LEAVING. `seasons/index.js`'s `leave()` drops the wall FIRST, then the
   * palette, then `liveGlobe.show()` — so both of those repushes have to
   * land. This is the half that makes the refusal safe: nothing was saved
   * anywhere inside the engine, and the geometry still comes back, because
   * `app/bundle-pipeline.js` held it the whole time. */
  archive = false;
  engine.ambientBundle({ id: 'nhc:ep092026' }, bundleFor('ep09-cone'));
  engine.ambientBundle({ id: 'nhc:ep102026' }, bundleFor('ep10-cone'));
  eq('leaving: the live cones come back',
    lastAmbient(), ['ep09-cone', 'ep10-cone']);

  engine.setBundle({ id: 'nhc:cp012026' }, bundleFor('cp01-cone'));
  eq('leaving: and a selection can be pushed again',
    drawn.selected, ['nhc:cp012026']);
}

/* ---------------------------------------------------------------------------
 * 3. AND THE GATE IS ACTUALLY WIRED UP.
 *
 * ==> A FILE-LEVEL READ, WHICH IS THE CRUDEST INSTRUMENT HERE AND THE ONE
 * THIS BUG CALLED FOR. <== Everything above passes just as happily against an
 * engine nobody hands a predicate to — it would default to always-painting
 * and the shipped app would be exactly as broken as it was. The gap between
 * "the mechanism works" and "the mechanism is connected" is precisely where
 * push 1 died, and `tools/test-seam-layers.mjs` made the same argument for
 * the same reason: a helper nobody calls is the state to guard against.
 * ------------------------------------------------------------------------ */

{
  const mainJs = readFileSync(join(ROOT, 'main.js'), 'utf8');

  /* ==> UP TO THE SEMICOLON, NOT TO THE FIRST `)`. <== The gate is an arrow
   * function, so it carries brackets of its own and a lazy match ends inside
   * it — which read as "no gate wired" against a file that had one. Caught
   * while writing this; worth a line, because a scan that reports a false
   * FAILURE trains the next session to distrust the suite. */
  const construction = mainJs.match(/createLayerEngine\(.*?\);/s);
  ok('main.js constructs the layer engine', Boolean(construction));

  const call = construction?.[0] || '';
  ok(`main.js passes a paint gate to the engine\n     got:  ${call}`,
    /painting\s*:/.test(call));
  ok(`and the gate is the archive flag, asked fresh\n     got:  ${call}`,
    /painting\s*:\s*\(\s*\)\s*=>\s*!\s*isArchive\(\)/.test(call));

  ok('main.js imports isArchive', /import\s*\{[^}]*\bisArchive\b/.test(mainJs));

  const registry = readFileSync(join(ROOT, 'map', 'layers', 'registry.js'), 'utf8');
  ok('the engine accepts a painting predicate',
    /createLayerEngine\(map,\s*\{\s*painting/.test(registry));
  ok('and refuses on it in both push doors',
    (registry.match(/if\s*\(!painting\(\)\)\s*return;/g) || []).length === 2);
}

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`test-archive-paint: ${pass} passed, ${fails.length} FAILED\n`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`test-archive-paint: ${pass} assertions passed`);
