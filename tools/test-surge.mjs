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
 * §4.8 said `symbolid` carries the color class; the live service declares it
 * an integer. The HA project searched that integer for the substring "blue",
 * never matched, and silently colored bands by ARRIVAL ORDER. The last group
 * here fails if anything ever resolves a severity from `symbolid` again.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSurge, selectForStorm } from '../data/surge.js';
import { bandSelect } from '../map/coast-band.js';
import { dimCoast } from '../map/layers/surge.js';
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
    ok(`adv ${row.advisory}: color is one of the five`,
       SURGE.colors.includes(f.properties.color), String(f.properties.color));
    eq(`adv ${row.advisory}: severity matches color`,
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

eq('ramp has one entry per color', SURGE_RAMP.length, SURGE.colors.length);
ok('every color in the archive has a ramp entry',
   SURGE.colors.every((_, i) => typeof SURGE_RAMP[i]?.color === 'string'));

/* ==> THE COLOR IS A BUCKET, NOT THE DEPTH. <== The ramp labels red "Up to
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
  ok('all five colors appear somewhere in the archive',
     SURGE.colors.every((c) => seen.has(c)),
     `missing: ${SURGE.colors.filter((c) => !seen.has(c)).join(', ')}`);
}

/* ---- the live path, and the trap it must not fall into --------------------- */

{
  /* Shaped like the live service: popupinfo carries the description JSON, and
   * `symbolid` is an INTEGER that must never be read as a color. */
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
  eq('live: color read from popupinfo', via, 'popupinfo.json');
  /* Optional chaining so a reader that drops the feature reports THIS rule by
   * name instead of throwing a TypeError here and taking every later group in
   * the file down with it — measured while mutation-testing the Lala group,
   * which never got to run because this line crashed the process first. */
  eq('live: severity is red\'s', fc.features[0]?.properties?.severity, 3);
  eq('live: range preserved verbatim', fc.features[0]?.properties?.range, '8-12 ft');
  eq('live: place stripped of its depth', fc.features[0]?.properties?.place, 'Tampa Bay');
}

{
  /* ==> THE HA BUG, PINNED. <== A feature whose ONLY severity hint is an
   * integer `symbolid` must yield nothing — not a default color, and above
   * all not a color derived from its position in the list. */
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
  /* A color word in a plain string still resolves — that is the loose path,
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
  eq('loose match resolves a color', fc.features[0]?.properties.color, 'blue');
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

/* ---------------------------------------------------------------------------
 * LALA — THE FIRST LIVE BYTES, AND THE ONLY THING THAT CAN TEST THE READER.
 *
 * Milton's fixture is already normalized, so it proves the RENDERER and cannot
 * prove the reader: the service's own attribute names are gone by the time
 * that file is written. These are the raw bytes with NHC's fields on them.
 * `samples/lala-cp012026/surge/README.md` carries the measurements.
 * ------------------------------------------------------------------------- */
{
  const LALA = path.join(ROOT, 'samples/lala-cp012026/surge');
  const polys = JSON.parse(fs.readFileSync(path.join(LALA, 'peaksurge-polygons.geojson'), 'utf8'));
  const lines = JSON.parse(fs.readFileSync(path.join(LALA, 'peaksurge-lines.geojson'), 'utf8'));

  /* The relay merges both layers into one collection; so does this. */
  const merged = { type: 'FeatureCollection', features: [...polys.features, ...lines.features] };
  eq('Lala advisory 017 published 11 surge features', merged.features.length, 11);
  eq('and no coastal reaches — an empty layer is an ANSWER, not a failure',
     lines.features.length, 0);

  /* --- THE READER. What the live path actually pulls the color out of. --- */
  const live = normalizeSurge(merged, { fromFixture: false });
  eq('every live feature is read, none dropped', live.dropped, 0);
  eq('all 11 survive normalization', live.fc.features.length, 11);
  eq('and the color comes from popupinfo, not from a fallback', live.via, 'popupinfo.json');

  /* ==> THE HA BUG, PINNED AGAINST THE BYTES THAT WOULD TRIGGER IT. <== NHC
   * forecast 1-2 ft everywhere on this storm. Anything that resolves severity
   * from `symbolid` (0 on every feature) or from arrival order paints a ramp
   * here instead, which is what the HA integration does on this exact file. */
  const sevs = new Set(live.fc.features.map((f) => f.properties.severity));
  eq('every Lala band is ONE severity — NHC forecast 1-2 ft everywhere', sevs.size, 1);
  eq('and that severity is blue', [...sevs][0], SURGE.colors.indexOf('blue'));
  /* ==> THIS IS THE ONE THAT WOULD HAVE CAUGHT THE HA BUG, AND THE FIRST
   * VERSION OF IT COULD NOT FAIL. <== It originally asserted that no band's
   * severity equalled its own index — which on an all-blue storm is trivially
   * true for every feature past the first, whatever the reader does. A test
   * that passes on the broken code is worse than no test (§ test discipline),
   * so it is stated the way the failure actually looks instead: index-order
   * coloring produces a RISING RAMP across features that are all one depth. */
  const ramp = live.fc.features.map((f) => f.properties.severity);
  ok('severity does not climb with position in the list (the HA failure)',
     !ramp.some((s, i) => i > 0 && s > ramp[i - 1]),
     JSON.stringify(live.fc.features.map((f) => f.properties.color)));

  /* OPTIONAL CHAINING IS NOT DEFENSIVENESS HERE, IT IS THE DIFFERENCE BETWEEN
   * A FAILURE AND A CRASH. Mutation-tested: dropping `popupinfo` from
   * `SURGE.liveColorFields` correctly empties this collection, and a bare
   * `features[0].properties` then throws a TypeError — the suite exits non-zero
   * with a stack trace instead of naming the rule that broke. The gate still
   * catches it; the person reading the output learns nothing. */
  eq('the range is NHC\'s own words, kept verbatim',
     live.fc.features[0]?.properties?.range, '1-2 ft');
  eq('and the place is the name with the depth cut off',
     live.fc.features[0]?.properties?.place, 'Oahu');

  /* --- THE SELECTOR. Which filter answers, and what it excludes. --- */
  const LALA_POS = { lat: 20.9, lng: -160 }; // CurrentStorms.json, same archive run

  const mine = selectForStorm(merged, { ...LALA_POS, stormId: 'cp012026' });
  eq('the storm id claims all 11 features', mine.byId, 11);
  eq('so the spatial box is never consulted', mine.byBox, 0);

  /* A DIFFERENT storm's id must take nothing, even standing in the same ocean
   * — this is the whole reason to prefer the id over a 12° box. */
  const other = selectForStorm(merged, { ...LALA_POS, stormId: 'ep092026' });
  eq('another storm\'s id takes none of Lala\'s bands', other.fc.features.length, 0);

  /* With no id to match on, the box must still find them: a feature that
   * states no id is filtered spatially rather than silently dropped. */
  const stripped = {
    type: 'FeatureCollection',
    features: merged.features.map((f) => ({
      ...f,
      properties: { ...f.properties, idp_subset: undefined },
    })),
  };
  const boxed = selectForStorm(stripped, { ...LALA_POS, stormId: 'cp012026' });
  eq('with no id on the feature, the box still finds all 11', boxed.byBox, 11);

  /* And the box must be a real filter, not a pass-through. Miami is 55° away. */
  const miami = selectForStorm(stripped, { lat: 25.8, lng: -80.2, stormId: null });
  eq('a storm in another ocean gets none of them', miami.fc.features.length, 0);
}

/* ---------------------------------------------------------------------------- */

if (failures.length) {
  console.error(`\n✗ test-surge: ${failures.length} failed, ${pass} passed\n`);
  for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
  if (failures.length > 30) console.error(`  …and ${failures.length - 30} more`);
  process.exit(1);
}
console.log(`✓ test-surge: ${pass} assertions against Milton's published bytes`);
