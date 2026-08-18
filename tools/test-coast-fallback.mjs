#!/usr/bin/env node
/**
 * test-coast-fallback.mjs — a guess must not look like a measurement (§7.10).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-coast-fallback.mjs`.
 *
 * ===========================================================================
 * THE BUG THIS PINS
 * ===========================================================================
 *
 * `map/coast-band.js` snaps NHC's breakpoint lines onto the real coastline.
 * Where it finds no coast in the corridor it keeps NHC's delivered chord,
 * flagged `_banded: false` — right, because official geometry is not ours to
 * discard, and a warning that vanishes is the §5 silence.
 *
 * The chord was then drawn in the STRIPE'S OWN PAINT. So a straight line
 * across open water and a genuinely recolored shoreline were pixel-identical,
 * and nothing anywhere read `_banded` even though the flag had existed since
 * the module was written.
 *
 * Aaron saw it on Lala, 2026-08-18: two solid strokes across empty Pacific,
 * with no land in the frame at all. They were NOT a bug in the warning — NHC
 * had issued a real Tropical Storm Watch and a real Hurricane Watch for the
 * Northwestern Hawaiian Islands, whose atolls the basemap does not carry. The
 * bug was that an admitted approximation was wearing a measurement's clothes.
 *
 * ===========================================================================
 * WHAT IS ASSERTED, AND WHY EACH ONE CAN ACTUALLY FAIL
 * ===========================================================================
 *
 * Every assertion below was verified to FAIL when its rule is broken — the
 * filters removed, the scale swapped back to the stripe's, the marks cut from
 * the wrong end of the pipeline. A test that passes on the same wrong
 * assumption as the bug is worse than no test.
 *
 * THE FIXTURE IS REAL BYTES. `samples/lala-cp012026/watch-warning-025.geojson`
 * is advisory 25 exactly as the NHC MapServer served it, lifted off the
 * archive branch. The coordinates are French Frigate Shoals, Maro Reef and
 * Lisianski Island; nothing here is a shape we invented.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const eq = (name, got, want) =>
  ok(got === want, `${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const { bandSelect } = await import('../map/coast-band.js');
const { chordMarks, chordLayers, IS_BANDED, IS_CHORD, IS_MARK, NOT_MARK } =
  await import('../map/coast-fallback.js');
const { STORM_GEO } = await import('../config/tokens.js');

const LALA = JSON.parse(
  fs.readFileSync('samples/lala-cp012026/watch-warning-025.geojson', 'utf8')
);

/* ---- the fixture is the case, not a stand-in for it ----------------------- */

eq('Lala advisory 25 carries two products', LALA.features.length, 2);
eq('the eastern one is a Tropical Storm Watch', LALA.features[0].properties.tcww, 'TWA');
eq('the western one is a Hurricane Watch', LALA.features[1].properties.tcww, 'HWA');
ok(LALA.features.every((f) => f.geometry?.type === 'LineString'),
   'both products published a real LineString — this fixture is NOT the null-geometry case');

/* The shared breakpoint is the reason marks are not deduped. If NHC ever
 * stops butting adjacent products end to end, the dedupe question changes and
 * this is where it gets noticed. */
const eastEnd = LALA.features[0].geometry.coordinates.at(-1);
const westStart = LALA.features[1].geometry.coordinates[0];
ok(eastEnd[0] === westStart[0] && eastEnd[1] === westStart[1],
   'the two products share a breakpoint exactly — two dots land on one place, by design');

/* ---- with no coastline loaded, everything falls back ---------------------- */

const dry = bandSelect(LALA.features, []);
eq('no coastline means nothing is painted', dry.paintedCount, 0);
ok(dry.features.every((f) => f.properties._banded === false),
   'every feature is flagged _banded:false — the flag the drawing now reads');
ok(dry.features.every((f) => f.geometry.type === 'LineString'),
   "the fallback keeps NHC's delivered geometry rather than curving or dropping it");

/* ---- the dots ------------------------------------------------------------ */

const marks = chordMarks(dry.features);
eq('one dot per breakpoint, both products', marks.length, 4);
ok(marks.every((m) => m.geometry.type === 'Point'), 'marks are Points');
ok(marks.every((m) => m.properties._mark === true), 'marks are flagged _mark');
ok(marks.filter((m) => m.properties.tcww === 'TWA').length === 2 &&
   marks.filter((m) => m.properties.tcww === 'HWA').length === 2,
   'each mark inherits its parent product, so the caller can color it');

/* THE CARPET GUARD. A banded feature's geometry is real coastline — hundreds
 * or thousands of vertices. Dotting those would bury the shore under circles.
 * Fake a band by flipping the flag on the same fixture. */
const bandedLike = dry.features.map((f) => ({
  ...f,
  properties: { ...f.properties, _banded: true },
}));
eq('a banded feature gets no dots at all', chordMarks(bandedLike).length, 0);

/* Features that never went through the band select carry no flag, and must
 * not be dotted either — surge polygons are exactly this shape. */
eq('a feature with no _banded flag gets no dots', chordMarks(LALA.features).length, 0);
eq('nothing in, nothing out', chordMarks(null).length, 0);

/* A watch published with NO shape is a real case (lib/watchwarning.js).
 * bandSelect flags it 'not-a-line'; it must produce no dots rather than
 * throwing on the way past. */
/* Rings must be non-empty or bandSelect short-circuits on 'no-coastline'
 * before it ever looks at the feature. A ring far from anything is enough. */
const shapeless = bandSelect(
  [{ type: 'Feature', geometry: null, properties: { tcww: 'HWA' } }],
  [[[0, 0], [0, 0.1], [0.1, 0.1]]]
);
eq('a shapeless watch is flagged not-a-line', shapeless.features[0].properties._bandReason, 'not-a-line');
eq('and contributes no dots', chordMarks(shapeless.features).length, 0);

/* ---- the layers the module builds ---------------------------------------- */

const built = chordLayers('sel-ww', 'sel-ww', null, {
  color: ['get', '_color'],
  sortKey: ['get', '_sev'],
});
eq('chordLayers builds exactly two layers', built.length, 2);

const [chord, mark] = built;
eq('the chord is a line', chord.type, 'line');
eq('the dots are circles', mark.type, 'circle');

const json = (v) => JSON.stringify(v);
ok(json(chord.filter).includes(json(IS_CHORD)),
   'the chord draws ONLY unbanded features — without this it repaints the snapped shore too');
ok(json(chord.filter).includes(json(NOT_MARK)),
   'the chord excludes marks — a Point in a line layer is a silent no-op today and a bug tomorrow');
ok(json(mark.filter).includes(json(IS_MARK)), 'the circle layer draws only marks');

ok(chord.paint['line-dasharray'] === STORM_GEO.chordDash,
   'the chord is DASHED — a dash reads as approximate at a glance and a solid line does not');

/* THE CORE RELATION, and the one that would silently rot. The chord must stay
 * distinguishable from the MODEL TRACKS beside it — that was the glass failure
 * on the first pass, where a coastline-width chord and `modelDash` read as the
 * same texture and a government order looked like a model's opinion. Asserted
 * as relations, never as pixel counts, so a future track restyle drags the
 * chord along and this stays green. */
eq('the chord is drawn at the forecast track line width, by reference',
   chord.paint['line-width'], STORM_GEO.trackForecastWidth);
ok(STORM_GEO.trackForecastWidth > STORM_GEO.modelLineWidth,
   `the chord must outweigh a model line (${STORM_GEO.trackForecastWidth} vs ` +
   `${STORM_GEO.modelLineWidth}) — a watch is a fact, not a forecast opinion`);
ok(STORM_GEO.chordDash[0] > STORM_GEO.modelDash[0] &&
   STORM_GEO.chordDash[1] < STORM_GEO.modelDash[1],
   'the chord dash must have LONGER marks and SHORTER gaps than modelDash, or the ' +
   'two read as one texture with several models up');
ok(STORM_GEO.chordOpacity <= STORM_GEO.stripeOpacity,
   'the chord must not out-shout paint on a real shore');

/* The rings do NOT ride the zoom curve. The app opens at globe distance; a
 * radius that scaled with the ground would go silent at exactly the zoom that
 * matters most. A ring is a LABEL, never a footprint. */
eq('the ring radius is a fixed pixel number, not a zoom ramp',
   typeof mark.paint['circle-radius'], 'number');

/* ==> HOLLOW, AND THE EMPTINESS IS THE MEANING. <== A FILLED dot in this app
 * is a storm of a known Saffir-Simpson strength (§6). Borrowing that shape for
 * a place would put two meanings on one visual channel — the objection
 * map/watch-marks.js makes at length. Fill this in and nothing errors; it just
 * quietly starts claiming a storm at every breakpoint. */
eq('the ring has no fill', mark.paint['circle-opacity'], 0);
ok(json(mark.paint['circle-stroke-color']) === json(['get', '_color']),
   'the product colour rides the STROKE, since the ring is all stroke');
ok(mark.paint['circle-stroke-width'] >= 2,
   'the stroke must be thick enough to read as a ring at arm’s length');

/* Sized between the first pass and a forecast point: 3.5 was too small to find
 * on a phone, a full `pointRadius` would compete with the dots carrying the
 * category codes. A relation, so a forecast-point resize drags this along. */
ok(STORM_GEO.chordMarkRadius < STORM_GEO.pointRadius,
   `a breakpoint ring (${STORM_GEO.chordMarkRadius}) must stay under a forecast ` +
   `point (${STORM_GEO.pointRadius}) — it marks a place, not a storm`);
ok(STORM_GEO.chordMarkRadius > STORM_GEO.pointRadius / 4,
   'and must stay big enough to find with a thumb on a phone');

/* Color is the §6 fixed contract and survives the fallback untouched. */
ok(json(chord.paint['line-color']) === json(['get', '_color']),
   'the chord keeps the product color — what changes is the confidence claimed, never the severity');

/* ---- and the real layers, as the engine actually builds them -------------- */

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

const byId = (id) => added.find((l) => l.id === id);

/* ==> THE ASSERTION THAT WOULD HAVE CAUGHT THE ORIGINAL BUG. <== The stripe
 * and the reach stroke must filter to banded features. Drop either filter and
 * an unsnapped chord goes straight back to wearing the coastline's paint,
 * with nothing erroring and nothing looking broken until someone stares at a
 * line in the middle of the ocean. */
for (const id of ['sel-ww-core', 'sel-ww-glow', 'amb-ww-core', 'amb-ww-glow']) {
  const layer = byId(id);
  ok(layer, `${id} exists`);
  ok(layer && json(layer.filter ?? null).includes(json(IS_BANDED)),
     `${id} must draw only banded features — otherwise the chord wears the stripe again`);
}
for (const id of ['sel-surge-reach-core', 'sel-surge-reach-glow',
                  'amb-surge-reach-core', 'amb-surge-reach-glow']) {
  const layer = byId(id);
  ok(layer, `${id} exists`);
  ok(layer && json(layer.filter ?? null).includes(json(IS_BANDED)),
     `${id} must draw only banded reaches — surge inherits the identical trap`);
}

/* Both layers ship the fallback pair. Surge was the "similar situation" and
 * shipping the fix on one of them only is how a pattern half-lands. */
for (const id of ['sel-ww-chord', 'sel-ww-chord-mark', 'amb-ww-chord', 'amb-ww-chord-mark',
                  'sel-surge-chord', 'sel-surge-chord-mark',
                  'amb-surge-chord', 'amb-surge-chord-mark']) {
  ok(byId(id), `${id} is registered — the fallback must exist on BOTH coastal segments`);
}

/* Surge's own filters must keep the dots out of the fill and the edge stroke.
 * A mark cut from a reach carries `kind: 'line'`, so the reach filters see it;
 * a mark's parent could carry `kind` at all only because properties are copied
 * wholesale, which is what makes the color work. */
for (const id of ['sel-surge-fill', 'sel-surge-edge']) {
  const layer = byId(id);
  ok(layer && json(layer.filter ?? null).includes(json(NOT_MARK)),
     `${id} must exclude marks`);
}

/* ==> THE DOTS COME OUT COLORED, END TO END. <== A mark copies its parent's
 * properties, so it has to be cut AFTER the layer stamps `_color` and `_sev`
 * on. Cut it a line earlier and every property is still there, every dot still
 * renders, every filter still matches — and `to-color` of undefined is BLACK,
 * silently, in both themes. That is the exact failure map/layers/
 * points-forecast.js already paid for once. Nothing short of driving a real
 * bundle through catches it, so drive one. */
const wrote = new Map();
const recordingStub = {
  ...stub,
  getSource: (id) => ({ setData: (d) => wrote.set(id, d) }),
};
const engine2 = createLayerEngine(recordingStub);
engine2.attach();
engine2.setBundle(
  { id: 'cp012026', source: 'nhc' },
  {
    stamp: { advisnum: '25' },
    layers: { watchWarning: { status: 'ok', fc: LALA } },
  }
);
const painted = wrote.get('sel-ww');
ok(painted, 'the watch/warning source was written');
const wroteMarks = (painted?.features || []).filter((f) => f.properties?._mark === true);
eq('four breakpoint dots reached the source', wroteMarks.length, 4);
ok(wroteMarks.every((m) => typeof m.properties._color === 'string' && m.properties._color),
   'every dot carries a real color — an undefined _color renders BLACK with no error');
ok(wroteMarks.every((m) => typeof m.properties._sev === 'number'),
   'every dot carries a severity, so the severer product wins a shared breakpoint (§6)');

/* The dots draw ABOVE the stripe they sit beside. Adjacent products share
 * breakpoints and only one of them may have found coast; a dot buried under
 * the neighbour's paint says nothing. Order of addLayer IS z-order here. */
const idx = (id) => added.findIndex((l) => l.id === id);
ok(idx('sel-ww-chord-mark') > idx('sel-ww-core'),
   'watch/warning dots are added after the stripe, so they draw on top');
ok(idx('sel-surge-chord-mark') > idx('sel-surge-fill'),
   'surge dots are added after the bands, so they are not buried under an opaque polygon');

console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed`
    : `\n✓ ${pass} assertions passed — the fallback is visibly a fallback`
);
process.exit(failures.length ? 1 : 0);
