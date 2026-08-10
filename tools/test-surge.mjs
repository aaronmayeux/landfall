/**
 * test-surge.mjs — peak storm surge normalization, against the real bytes.
 *
 * Runs on plain node, no dependencies, no browser:  node tools/test-surge.mjs
 *
 * ==> IT ASSERTS AGAINST THE ARCHIVE, NOT AGAINST A FIXTURE WE INVENTED. <==
 * Every expectation below was read out of Hurricane Milton's 22 published
 * advisories in `samples/milton-al142024/surge/`. Where a number appears it is
 * a count of NHC's own features, not a round figure that looked plausible.
 *
 * ==> AND IT PINS THE BUG THAT MOTIVATED THE WHOLE MODULE. <== SPEC-DATA.md
 * §4.8 said `symbolid` carries the colour class; the live service declares it
 * an integer. The HA project searched that integer for the substring "blue",
 * never matched, and silently coloured bands by ARRIVAL ORDER. The last group
 * here fails if anything ever resolves a severity from `symbolid` again.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSurge } from '../data/surge.js';
import { bandSelect } from '../map/coast-band.js';
import { dimCoast } from '../map/layers/surge.js';
import { clipReachesToUncovered } from '../lib/surge-clip.js';
import { OPACITY } from '../config/tokens.js';
import { COAST_BAND } from '../config/constants.js';
import { SURGE } from '../config/constants.js';
import { SURGE_RAMP } from '../config/tokens.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'samples/milton-al142024/surge');

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const load = (adv) => JSON.parse(fs.readFileSync(path.join(DIR, adv, 'peaksurge.geojson'), 'utf8'));

/* ---- the fixture itself ---------------------------------------------------- */

eq('fixture holds 22 advisories', index.advisories.length, 22);
eq('fixture records its tolerance', index.simplifiedToleranceDeg, SURGE.offsetDeg);
ok('fixture and app simplify at the same tolerance',
   index.simplifiedToleranceDeg === SURGE.offsetDeg,
   'a fixture generalized differently from production is prettier than production');

/* ---- normalization of the fixture path ------------------------------------- */

for (const row of index.advisories) {
  const { fc, dropped } = normalizeSurge(load(row.advisory), { fromFixture: true });
  eq(`adv ${row.advisory}: nothing dropped`, dropped, 0);
  eq(`adv ${row.advisory}: polygon count`,
     fc.features.filter((f) => f.properties.kind === 'polygon').length, row.polygons);
  eq(`adv ${row.advisory}: line count`,
     fc.features.filter((f) => f.properties.kind === 'line').length, row.lines);

  for (const f of fc.features) {
    ok(`adv ${row.advisory}: colour is one of the five`,
       SURGE.colors.includes(f.properties.color), String(f.properties.color));
    eq(`adv ${row.advisory}: severity matches colour`,
       f.properties.severity, SURGE.colors.indexOf(f.properties.color));
    ok(`adv ${row.advisory}: place is not a depth`,
       !/\d\s*-\s*\d+\s*ft/i.test(String(f.properties.place || '')),
       `place read as "${f.properties.place}"`);
  }
}

/* ==> SURGE IS NOT BANDS ONLY. <== Every plan before the archive was read
 * assumed polygons. If a future change filters lines out, this goes red. */
{
  const { fc } = normalizeSurge(load('017'), { fromFixture: true });
  const lines = fc.features.filter((f) => f.properties.kind === 'line');
  ok('advisory 017 carries coastal reaches, not just bands', lines.length === 13,
      `got ${lines.length} lines`);
  ok('a reach carries its own depth', lines.every((f) => f.properties.range),
      'a line with no range is a coast told nothing');
}

/* Milton's worst: 10-15 ft into Tampa Bay, purple, at advisory 017. If this
 * ever stops being true the fixture changed under us. */
{
  const { fc } = normalizeSurge(load('017'), { fromFixture: true });
  const tampa = fc.features.find((f) => f.properties.place === 'Tampa Bay');
  ok('Tampa Bay is present at advisory 017', !!tampa);
  eq('Tampa Bay is purple', tampa?.properties.color, 'purple');
  eq('Tampa Bay severity is 4', tampa?.properties.severity, 4);
  eq('Tampa Bay range is NHC\'s own words', tampa?.properties.range, '10-15 ft');
}

/* ---- the ramp and the data agree ------------------------------------------- */

eq('ramp has one entry per colour', SURGE_RAMP.length, SURGE.colors.length);
ok('every colour in the archive has a ramp entry',
   SURGE.colors.every((_, i) => typeof SURGE_RAMP[i]?.color === 'string'));

/* ==> THE COLOUR IS A BUCKET, NOT THE DEPTH. <== The ramp labels red "Up to
 * 12 ft"; the archive publishes 5-10, 6-10 AND 8-12 ft as red. This asserts
 * the disagreement is real, so nobody "fixes" it by rewriting NHC's range to
 * match a legend rung. */
{
  const seen = new Map();
  for (const row of index.advisories) {
    const { fc } = normalizeSurge(load(row.advisory), { fromFixture: true });
    for (const f of fc.features) {
      if (!seen.has(f.properties.color)) seen.set(f.properties.color, new Set());
      seen.get(f.properties.color).add(f.properties.range);
    }
  }
  ok('red carries more than one published range',
     (seen.get('red')?.size || 0) > 1,
     `red ranges: ${[...(seen.get('red') || [])].join(', ')}`);
  ok('all five colours appear somewhere in the archive',
     SURGE.colors.every((c) => seen.has(c)),
     `missing: ${SURGE.colors.filter((c) => !seen.has(c)).join(', ')}`);
}

/* ---- the live path, and the trap it must not fall into --------------------- */

{
  /* Shaped like the live service: popupinfo carries the description JSON, and
   * `symbolid` is an INTEGER that must never be read as a colour. */
  const live = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        name: 'Tampa Bay...8-12 ft',
        symbolid: 3,
        popupinfo: '{"peak_surge_range": "8-12 ft", "color": "red"}',
      },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    }],
  };
  const { fc, via } = normalizeSurge(live, { fromFixture: false });
  eq('live: one feature normalized', fc.features.length, 1);
  eq('live: colour read from popupinfo', via, 'popupinfo.json');
  eq('live: severity is red\'s', fc.features[0].properties.severity, 3);
  eq('live: range preserved verbatim', fc.features[0].properties.range, '8-12 ft');
  eq('live: place stripped of its depth', fc.features[0].properties.place, 'Tampa Bay');
}

{
  /* ==> THE HA BUG, PINNED. <== A feature whose ONLY severity hint is an
   * integer `symbolid` must yield nothing — not a default colour, and above
   * all not a colour derived from its position in the list. */
  const trap = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'Somewhere...5-10 ft', symbolid: 4 },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
      { type: 'Feature', properties: { name: 'Elsewhere...1-3 ft', symbolid: 0 },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    ],
  };
  const { fc, dropped } = normalizeSurge(trap, { fromFixture: false });
  eq('symbolid alone yields no features', fc.features.length, 0);
  eq('and they are counted as dropped, not silently missing', dropped, 2);
}

{
  /* A colour word in a plain string still resolves — that is the loose path,
   * and it must stay LAST so a place called "Blue Hill Bay" cannot beat a
   * structured field. */
  const loose = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { name: 'Blue Hill Bay...1-3 ft', snippet: 'Peak surge 1-3 ft (blue)' },
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    }],
  };
  const { fc, via } = normalizeSurge(loose, { fromFixture: false });
  eq('loose match resolves a colour', fc.features[0]?.properties.color, 'blue');
  eq('and reports which field answered', via, 'snippet.text');
  eq('a LineString normalizes as a reach', fc.features[0]?.properties.kind, 'line');
}

{
  const { fc, dropped } = normalizeSurge({ type: 'FeatureCollection', features: [] });
  eq('empty in, empty out', fc.features.length, 0);
  eq('and nothing claimed dropped', dropped, 0);
}

/* ---- the reaches are painted onto coastline, not drawn as chords ----------- */

{
  /* ==> THE CORRIDOR WIDTH MUST ACTUALLY BE HONOURED. <== `bandSelect` took a
   * hardcoded `COAST_BAND.halfWidthKm` until surge needed a narrower one, and
   * a width argument that is quietly ignored looks exactly like a width that
   * works — the map would just paint a 50 km corridor while the constant said
   * 20. This pins that the parameter reaches the geometry. */
  /* A reach running due east, ~98 km long, so the corridor's FLAT END CAPS are
   * not what the test is measuring — the first draft put the coast off the END
   * of a short reach, where nothing is painted at any width, and the failure
   * looked like the argument being ignored. */
  const reach = [{
    type: 'Feature',
    properties: { kind: 'line', color: 'red', severity: 3, range: '8-12 ft', place: 'Somewhere' },
    geometry: { type: 'LineString', coordinates: [[-83.0, 28.0], [-82.0, 28.0]] },
  }];
  /* Coast running parallel, ~17 km to the south: inside a 50 km corridor,
   * outside the surge one. JITTERED, because `isTileEdge` discards straight
   * axis-aligned runs as basemap tile seams and a perfectly flat test ring is
   * filtered before selection ever happens. */
  const rings = [[[-82.8, 27.845], [-82.6, 27.86], [-82.4, 27.83], [-82.2, 27.855]]];

  const wide = bandSelect(reach, rings, COAST_BAND.halfWidthKm);
  const narrow = bandSelect(reach, rings, SURGE.bandHalfWidthKm);
  ok('a wide corridor reaches coast ~17 km away', wide.paintedCount === 1,
     `painted ${wide.paintedCount}`);
  ok('the surge corridor does not', narrow.paintedCount === 0,
     `painted ${narrow.paintedCount} — the width argument is being ignored`);
  ok('and an unpainted reach keeps NHC\'s own geometry rather than vanishing',
     narrow.features.length === 1 && narrow.features[0].properties._banded === false,
     'a reach that cannot be banded must fall back, never disappear (§5)');
}

ok('the surge corridor is narrower than watch/warning\'s',
   SURGE.bandHalfWidthKm < COAST_BAND.halfWidthKm,
   'adjacent reaches carry different depths; a wide band paints the deeper one onto the shallower coast');

/* ---- a reach stops where a filled area already says it --------------------- */

{
  /* A square filled area, and a reach running straight through it and out the
   * far side — which is what BANDING produces in practice: the reach snapped
   * onto a coastline that is also the fill's edge. The earlier measurement
   * used NHC's raw lines and found ~5% overlap; banded, it is most of the
   * length, and that gap is why the outline kept reappearing. */
  const area = {
    properties: { kind: 'polygon' },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
  };
  const reach = {
    properties: { kind: 'line', color: 'red', severity: 3 },
    /* Vertices chosen so no segment MIDPOINT lands exactly on the fill's edge.
     * The first draft used [-5,5],[5,5],[15,5], whose midpoints sit at x=0 and
     * x=10 — precisely the boundary, where a ray cast is a coin toss. */
    geometry: { type: 'LineString', coordinates: [[-5, 5], [3, 5], [7, 5], [15, 5]] },
  };
  const { features, droppedWholly } = clipReachesToUncovered([reach], [area]);
  eq('the reach survives', features.length, 1);
  eq('nothing was wholly dropped', droppedWholly, 0);
  const g = features[0].geometry;
  ok('and it is now two runs, one either side of the fill',
     g.type === 'MultiLineString' && g.coordinates.length === 2, JSON.stringify(g).slice(0, 90));

  /* Wholly inside: nothing left to draw, and it is COUNTED rather than
   * silently vanishing. */
  const inside = {
    properties: { kind: 'line' },
    geometry: { type: 'LineString', coordinates: [[2, 5], [8, 5]] },
  };
  const r2 = clipReachesToUncovered([inside], [area]);
  eq('a reach entirely under a fill draws nothing', r2.features.length, 0);
  eq('and is counted', r2.droppedWholly, 1);

  /* ==> THE §5 HALF. <== With no filled areas at all, every reach keeps every
   * metre — it is then the only thing saying that coast has a forecast. */
  const r3 = clipReachesToUncovered([reach], []);
  eq('no fills means no clipping', r3.features.length, 1);
  eq('and the geometry is untouched',
     JSON.stringify(r3.features[0].geometry), JSON.stringify(reach.geometry));

  /* A hole in the fill is genuinely uncovered ground, so a reach crossing it
   * still draws there. */
  const donut = {
    properties: { kind: 'polygon' },
    geometry: { type: 'Polygon', coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ] },
  };
  const through = {
    properties: { kind: 'line' },
    geometry: { type: 'LineString', coordinates: [[4.2, 5], [5.8, 5]] },
  };
  const r4 = clipReachesToUncovered([through], [donut]);
  eq('a reach inside a hole is not clipped away', r4.features.length, 1);
}

/* ---- one transparency, and nothing draws twice ----------------------------- */

{
  /* ==> THE CONTRACT, PINNED. <== Every piece of surge paint draws at exactly
   * one opacity, and that opacity is the SAME TOKEN rather than a matching
   * number. A second wash of the same colour over the first is the seam this
   * whole pass removed, and it is the kind of thing that creeps back in as a
   * "just add an outline" one-liner. */
  const layers = [];
  const map = {
    getSource: () => null,
    addSource: () => {},
    addLayer: (l) => layers.push(l),
    getLayer: () => null,
    on: () => {},
  };
  const { surgeLayersForTest } = await import('../map/layers/surge.js');
  for (const l of surgeLayersForTest('t', 'src', null)) layers.push(l);

  const fills = layers.filter((l) => l.type === 'fill');
  const lines = layers.filter((l) => l.type === 'line');
  eq('exactly one fill layer', fills.length, 1);
  eq('exactly one line layer', lines.length, 1);
  eq('the fill draws at the surge opacity', fills[0].paint['fill-opacity'], OPACITY.surgeFill);
  eq('the reach draws at the SAME opacity', lines[0].paint['line-opacity'], OPACITY.surgeFill);
  eq('the reach is the flat width, not a ramp', lines[0].paint['line-width'], OPACITY.surgeReachPx);
  ok('the reach width is a number, not a zoom expression',
     typeof lines[0].paint['line-width'] === 'number');
  ok('the fill has no outline colour — it would composite over its own fill',
     fills[0].paint['fill-outline-color'] === undefined);
  ok('no layer is blurred (a glow is a second wash)',
     layers.every((l) => l.paint['line-blur'] === undefined));
  ok('the fill and the reach never draw the same feature',
     JSON.stringify(fills[0].filter) !== JSON.stringify(lines[0].filter));
}

/* ---- the coastline dims while surge shows, and comes back exactly ---------- */

{
  /* A stub map: just the two coast layers and their paint. The real ones carry
   * a ZOOM RAMP rather than a number, which is the whole reason this is
   * fiddly, so the stub carries one too. */
  const ramp = ['interpolate', ['linear'], ['zoom'], 3, 0.42, 6, 0.72];
  const paint = { 'coast-glow': ramp, 'coast-core': ramp };
  const map = {
    getLayer: (id) => (id in paint ? { id } : null),
    getPaintProperty: (id) => paint[id],
    setPaintProperty: (id, _prop, v) => { paint[id] = v; },
  };

  dimCoast(map, true);
  ok('dimming wraps the zoom ramp rather than replacing it',
     Array.isArray(paint['coast-core']) && paint['coast-core'][0] === '*',
     JSON.stringify(paint['coast-core']).slice(0, 60));
  eq('and multiplies by the token', paint['coast-core'][2], OPACITY.surgeCoastDim);

  /* ==> THE NESTING TRAP. <== Without the saved original, a second dim wraps
   * the first wrap and the coast fades further every time the segment moves. */
  const afterFirst = JSON.stringify(paint['coast-core']);
  dimCoast(map, true);
  eq('a repeat dim is a no-op, not a second wrap', JSON.stringify(paint['coast-core']), afterFirst);

  dimCoast(map, false);
  eq('restoring puts the exact original expression back',
     JSON.stringify(paint['coast-core']), JSON.stringify(ramp));
  eq('and the glow too', JSON.stringify(paint['coast-glow']), JSON.stringify(ramp));

  /* A basemap outage must not stop surge drawing (§5). */
  const bare = { getLayer: () => null, getPaintProperty: () => undefined, setPaintProperty: () => {
    throw new Error('must not touch a layer that does not exist');
  } };
  let threw = false;
  try { dimCoast(bare, true); dimCoast(bare, false); } catch { threw = true; }
  ok('a missing basemap is survived, not thrown on', !threw);
}

/* ---------------------------------------------------------------------------- */

if (failures.length) {
  console.error(`\n✗ test-surge: ${failures.length} failed, ${pass} passed\n`);
  for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
  if (failures.length > 30) console.error(`  …and ${failures.length - 30} more`);
  process.exit(1);
}
console.log(`✓ test-surge: ${pass} assertions against Milton's published bytes`);
