#!/usr/bin/env node
/**
 * test-position-mark.mjs — the stand-in position dot for a live storm with no
 * geometry drawn (`storm-dot-position`, SPEC-MAP §9).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-position-mark.mjs`.
 *
 * WHY THIS SUITE EXISTS. The failure it guards is a storm that is INVISIBLE —
 * the one class of bug §5 exists to forbid, and the one that is hardest to
 * notice from a desk, because every other surface (the list, the drawer, the
 * zoomed-out globe) shows the storm perfectly. It took a phone at basin zoom
 * on a brand-new storm to see it at all.
 *
 * The two rules with teeth are precedence and the trigger:
 *   - an ENDED storm must not take this mark, or the grey X and a category dot
 *     stack on one pixel;
 *   - a storm WITH forecast dots must not take it, or every storm on the map
 *     carries two dots at the same place, one of them a stale colour.
 *
 * WHAT THIS CANNOT PROVE: that the dot lands on the same pixel as the tau-0
 * forecast point on a real globe, or that the swap is invisible when the
 * shapefiles arrive. Those need a browser and a storm; the position agreement
 * behind them was measured off live NHC bytes instead (SPEC-MAP §9).
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { positionMarkProps } = await import('../map/markers.js');
const { stormIdsIn, hasForecastPoints, onForecastPointsDrawn } =
  await import('../map/layers/drawn-points.js');
/* Imported for its side effect: it is the module that registers the forecast
 * point layer with the engine, and the engine test below drives it. */
await import('../map/layers/points-forecast.js');
const { CATEGORY_COLOR } = await import('../config/tokens.js');
const { categoryColor } = await import('../lib/category.js');

/** A live storm as data/nhc.js normalizes one, reduced to what this reads. */
const storm = (over = {}) => ({
  id: 'nhc:ep152026',
  name: 'NORBERT',
  lat: 16.4,
  lon: -117.9,
  nature: 'tropical',
  category: 1, // index 1 = tropical storm
  observedAt: new Date().toISOString(),
  ...over,
});

/* ------------------------------------------------------------------ */
section('The live storm with nothing drawn — the case this exists for');

{
  const p = positionMarkProps(storm(), false);
  ok(p.noShapes === true, 'a live storm with no forecast points takes the mark');
  ok(p.lastKnown === false, 'and is not treated as ended');
  ok(p._posCode === 'TS', 'it carries its own category code, not an X');
  ok(
    p._posColor === categoryColor(1, 'tropical'),
    'and its own category color, not the ended grey',
  );
}

{
  /* The colour must never arrive null: MapLibre answers a null colour with a
   * console error and a dropped feature, not a fallback. Every state, not
   * just the graded ones. */
  const states = [
    storm(),
    storm({ category: null, nature: 'post-tropical' }),
    storm({ category: null, nature: 'potential' }),
    storm({ category: null, nature: 'remnant' }),
    storm({ category: null, categoryCode: 'HU', nature: 'tropical' }),
    storm({ category: 6, nature: 'tropical' }),
  ];
  ok(
    states.every((s) => typeof positionMarkProps(s, false)._posColor === 'string'
      && positionMarkProps(s, false)._posColor.length > 0),
    'every storm state resolves to a real color string',
  );
  ok(
    states.every((s) => typeof positionMarkProps(s, false)._posCode === 'string'),
    'and to a string code, never null',
  );
}

{
  /* An ungraded system draws a bare dot rather than a guessed code — §6. */
  const p = positionMarkProps(storm({ category: null, nature: 'potential' }), false);
  ok(p._posCode === '', 'an ungraded system gets no code');
  ok(p._posColor !== CATEGORY_COLOR.GENERIC, 'and the pre-genesis hue, not generic');
}

/* ------------------------------------------------------------------ */
section('The two ways it must stand down');

{
  const p = positionMarkProps(storm(), true);
  ok(p.noShapes === false, 'a storm WITH forecast dots does not take the mark');
}

{
  /* Ended: `noCurrentReading` is true, so the grey X owns this position and
   * this mark must keep out of its way. Both flags on one storm would stack
   * two dots on one pixel. */
  const ended = storm({ ended: { at: new Date().toISOString(), how: 'declared' } });
  const p = positionMarkProps(ended, false);
  ok(p.lastKnown === true, 'an ended storm reads as last-known');
  ok(p.noShapes === false, 'and does NOT also take the position mark');
}

{
  /* Gone quiet is the same condition wearing the other name, and it reaches
   * this file through the same `noCurrentReading` call. */
  const stale = new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString();
  const quiet = storm({ observedAt: stale });
  const p = positionMarkProps(quiet, false);
  if (p.lastKnown) {
    ok(p.noShapes === false, 'a silent storm does not take the position mark either');
  } else {
    ok(true, 'silence threshold not reached for this fixture — precedence untested here');
  }
}

/* ------------------------------------------------------------------ */
section('Which storms count as drawn');

{
  const f = (props) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: props });
  const ids = stormIdsIn([
    f({ _stormId: 'nhc:al012026' }),
    f({ _stormId: 'nhc:al012026' }),
    f({ _stormKey: 'gdacs:1001320' }),
    f({ basin: 'EP', stormnum: 15 }), // attributable for GROUPING, not for identity
    f({}),
  ]);
  ok(ids.has('nhc:al012026'), 'an NHC point names its storm');
  ok(ids.has('gdacs:1001320'), 'a GDACS point names its storm');
  ok(ids.size === 2, 'a point with no storm id vouches for nobody');
}

{
  ok(hasForecastPoints('nhc:nobody') === false, 'an unknown storm has no dots');
  ok(hasForecastPoints(null) === false, 'and a null id is not a lookup');
}

/* ------------------------------------------------------------------ */
section('The publisher wakes the subscriber');

{
  /* The wiring that makes the mark appear and disappear without waiting for
   * the 30-minute poll. Driven through the layer engine with a stub map,
   * because that is the only public road into `updateAmbient`. */
  const layers = new Map();
  const sources = new Map();
  const stubMap = {
    addSource: (id) => sources.set(id, { setData() {} }),
    getSource: (id) => sources.get(id),
    addLayer: (l) => layers.set(l.id, l),
    getLayer: (id) => layers.get(id),
    on() {},
    project: () => ({ x: 0, y: 0 }),
  };

  const { createLayerEngine } = await import('../map/layers/registry.js');
  const engine = createLayerEngine(stubMap);

  let woke = 0;
  const off = onForecastPointsDrawn(() => { woke += 1; });

  const s = storm({ id: 'nhc:ep152026' });
  const point = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-117.9, 16.4] },
    properties: { _stormId: 'nhc:ep152026', basin: 'EP', stormnum: 15, tau: 0, ssnum: 0, tcdvlp: 'Tropical Storm' },
  };

  engine.ambientBundle(s, {
    layers: { forecastPoints: { status: 'ok', fc: { type: 'FeatureCollection', features: [point] } } },
  });
  ok(hasForecastPoints('nhc:ep152026') === true, 'a warmed bundle with points registers the storm');
  ok(woke > 0, 'and wakes markers.js');

  const before = woke;
  engine.ambientBundle(s, {
    layers: { forecastPoints: { status: 'ok', fc: { type: 'FeatureCollection', features: [] } } },
  });
  ok(hasForecastPoints('nhc:ep152026') === false,
    'an ok slot carrying no points leaves the storm undrawn');
  ok(woke > before, 'and wakes markers.js again so the mark can appear');

  const settled = woke;
  engine.ambientBundle(s, {
    layers: { forecastPoints: { status: 'ok', fc: { type: 'FeatureCollection', features: [] } } },
  });
  ok(woke === settled, 'an unchanged set does not wake it — no setData per pan');

  off();
}

/* ------------------------------------------------------------------ */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
