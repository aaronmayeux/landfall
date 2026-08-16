#!/usr/bin/env node
/**
 * test-watchwarning.mjs — a warning in force with nothing to draw.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-watchwarning.mjs`.
 *
 * ===========================================================================
 * THE BUG THIS EXISTS FOR
 * ===========================================================================
 *
 * Measured live on Lala, advisory 5A, 2026-08-13. NHC's MapServer layer 8
 * answered with ONE feature carrying every attribute a watch has —
 * `tcww: "HWA"`, the storm's name, the advisory number, bin CP2 — and
 * `"geometry": null`, `"shape": null`, `"st_length(shape)": null`. The row's
 * own `idp_source` names `cp012026-005A_ww_wwlin`, the LINE shapefile, so the
 * geometry exists upstream and was lost before the service. Our relay asks for
 * it (`returnGeometry: true`) and does not simplify layer 8, so nothing on our
 * side dropped it.
 *
 * WHAT THAT LOOKED LIKE. The detail panel reads properties, so it correctly
 * said "Hurricane Watch". The map paints geometry, so the coast drew in its
 * ordinary color. A Hurricane Watch in force and a coast under no watch at
 * all were pixel-identical, and the app said nothing. That is the §5 failure
 * with the worst consequence in this codebase — an all-clear that is not one.
 *
 * The coastal band select had ALREADY detected it, tagging the feature
 * `_bandReason: 'not-a-line'`. Nothing had ever read that field.
 *
 * ===========================================================================
 * WHAT EACH ASSERTION IS GUARDING
 * ===========================================================================
 *
 * `drawn` on a legend entry is the one bit the panel forks its sentence on.
 * Every case below is a way that bit could go wrong and put the app back where
 * it was: a null shape, an empty shape, a one-point line, and — the case that
 * would make the note untrustworthy in the other direction — a product with
 * SOME features drawable, which must not be flagged as missing.
 *
 * The fixture is the real body, verbatim. It is not paraphrased and not
 * trimmed, because the whole reason this suite exists is that nobody believed
 * a layer could answer this way until the bytes were in front of them.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { wwLegend, wwHasOutline, wwCodeFromProps } =
  await import('../lib/watchwarning.js');

/* ---------------------------------------------------------------------------
 * THE REAL BODY — /api/nhc/mapserver?layer=8&bin=CP2, 2026-08-13
 * ------------------------------------------------------------------------- */

const LALA_5A = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 3,
      geometry: null,
      properties: {
        objectid: 3,
        stormname: 'Lala',
        stormtype: 'TS',
        basin: 'CP',
        advdate: '800 AM HST Thu Aug 13 2026',
        advisnum: '5A',
        fcstprd: 120,
        stormnum: 1,
        tcww: 'HWA',
        idp_source: 'cp012026-005A_ww_wwlin',
        idp_filedate: 1786644147000,
        idp_ingestdate: 1786644194000,
        shape: null,
        'st_length(shape)': null,
        binnumber: 'CP2',
      },
    },
  ],
};

/* A drawable warning, shaped like Ida's `ww_wwlin` features. */
const line = (code, coords) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: coords },
  properties: { tcww: code, stormname: 'Ida' },
});

/* ---------------------------------------------------------------------------
 * 1. THE PRODUCT IS STILL READ. The order is real; only its outline is missing.
 * ------------------------------------------------------------------------- */

section('the shapeless watch is still a watch');

const lala = wwLegend(LALA_5A.features);

ok(lala.length === 1, `expected one legend entry, got ${lala.length}`);
ok(lala[0]?.code === 'HWA', `expected HWA, got ${lala[0]?.code}`);
ok(lala[0]?.label === 'Hurricane Watch', `label was ${lala[0]?.label}`);
ok(
  wwCodeFromProps(LALA_5A.features[0].properties) === 'HWA',
  'the code must still be readable off a feature with no geometry — the ' +
    'order is in force whether or not we can draw it'
);
ok(
  typeof lala[0]?.color === 'string' && lala[0].color.length > 0,
  'a shapeless product still needs its §6 color for the legend swatch'
);

/* ==> THE ASSERTION THE WHOLE FILE IS FOR. <== Flip `wwHasOutline` to return
 * true for a null geometry and this goes red. Verified by doing exactly that
 * before committing: with `if (!g) return true;` this line fails and every
 * other assertion in section 1 still passes — which is the point, because
 * that combination is precisely what shipped. */
ok(
  lala[0]?.drawn === false,
  'A NULL GEOMETRY MUST REPORT drawn:false. This is the bit the panel uses ' +
    'to tell the reader the coast is unmarked; true here restores the silent ' +
    'all-clear.'
);

/* ---------------------------------------------------------------------------
 * 2. THE OTHER WAYS A SHAPE CAN BE UNDRAWABLE
 * ------------------------------------------------------------------------- */

section('empty and degenerate geometry');

ok(wwHasOutline({ geometry: null }) === false, 'null geometry is not an outline');
ok(wwHasOutline({}) === false, 'a feature with no geometry key is not an outline');
ok(
  wwHasOutline({ geometry: { type: 'LineString', coordinates: [] } }) === false,
  'an empty LineString is a shape in name only'
);
ok(
  wwHasOutline({ geometry: { type: 'LineString', coordinates: [[-90, 30]] } }) === false,
  'ONE POINT IS NOT A LINE. A line layer draws nothing from it, so counting ' +
    'it as drawn would report a coast painted that is not.'
);
ok(
  wwHasOutline({ geometry: { type: 'MultiLineString', coordinates: [[], []] } }) === false,
  'a MultiLineString of empty parts is not an outline'
);
ok(
  wwHasOutline({
    geometry: { type: 'MultiLineString', coordinates: [[], [[-90, 30], [-89, 30]]] },
  }) === true,
  'one real part is enough for a MultiLineString — the band select emits ' +
    'exactly this shape, one part per run of coast'
);
ok(
  wwHasOutline({ geometry: { type: 'Point', coordinates: [-90, 30] } }) === false,
  'a point geometry cannot be drawn by a line layer'
);
ok(
  wwHasOutline(line('HWR', [[-90, 30], [-89.5, 29.9]])) === true,
  'an ordinary two-point breakpoint line is drawable'
);

/* ---------------------------------------------------------------------------
 * 3. PARTLY DRAWABLE IS NOT MISSING
 *
 * NHC issues one product as several segments — Ida's advisory 12 carried three
 * TWR features and three HWR. If one of six lost its shape, saying the whole
 * Hurricane Warning is "not on the map" is false, and a note that cries wolf
 * on the common case is a note nobody reads on the case that matters.
 * ------------------------------------------------------------------------- */

section('a product with some geometry is drawn');

const mixed = wwLegend([
  { geometry: null, properties: { tcww: 'HWR' } },
  line('HWR', [[-90, 30], [-89.5, 29.9]]),
  { geometry: null, properties: { tcww: 'TWA' } },
]);

const hwr = mixed.find((e) => e.code === 'HWR');
const twa = mixed.find((e) => e.code === 'TWA');

ok(hwr?.drawn === true, 'HWR has one drawable segment, so it IS on the map');
ok(twa?.drawn === false, 'TWA has none, so it is not');
ok(
  mixed.length === 2,
  `dedupe by code must survive the drawn flag — got ${mixed.length} entries`
);

/* ==> THE SAME PRODUCT, SEGMENTS THE OTHER WAY ROUND. <== The fold has to be
 * an OR across every feature of a code, and the fixture above could not tell
 * that from "whichever feature came last" — its drawable segment happened to
 * be second, so a last-one-wins fold got the right answer for the wrong
 * reason and the mutation ran green. NHC's feature order is not ours to
 * predict, so both orders are asserted. */
const reversed = wwLegend([
  line('HWR', [[-90, 30], [-89.5, 29.9]]),
  { geometry: null, properties: { tcww: 'HWR' } },
]);
ok(
  reversed[0]?.drawn === true,
  'A DRAWABLE SEGMENT FOLLOWED BY A SHAPELESS ONE IS STILL DRAWN. Order must ' +
    'not decide this — a fold that keeps only the last feature would report ' +
    'a painted coast as unmarked.'
);

/* ORDER IS SEVERITY, and it must not have been disturbed by the Set -> Map
 * change that carried the flag. A Hurricane Warning under a Tropical Storm
 * Watch in the legend is the §6 contract broken in the list as well as on the
 * coast. */
ok(mixed[0]?.code === 'HWR', `severest first: got ${mixed[0]?.code}`);

/* ---------------------------------------------------------------------------
 * 4. NOTHING IN, NOTHING OUT
 * ------------------------------------------------------------------------- */

section('empty and junk input');

ok(wwLegend([]).length === 0, 'no features, no legend');
ok(wwLegend(null).length === 0, 'null features, no legend');
ok(
  wwLegend([{ geometry: null, properties: { stormname: 'Lala' } }]).length === 0,
  'A FEATURE WITH NO RECOGNISABLE CODE IS NOT A WATCH. It must not become a ' +
    'legend row at all — an unlabelled swatch in a list of government orders ' +
    'is worse than an omission.'
);

/* ------------------------------------------------------------------------- */

console.log('');
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log(`\n✗ ${failures.length} failed, ${pass} passed\n`);
  process.exit(1);
}
console.log(`✓ ${pass} assertions passed`);
console.log('  (whether the note READS beside a live watch is glass)\n');
