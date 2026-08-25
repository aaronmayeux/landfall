/**
 * test-season-marks.mjs — the archive globe's POINTS. §57.21 item 3,
 * §57.30 step 6.
 *
 * ==> TWO THINGS THIS SUITE EXISTS TO CATCH, AND THEY ARE BOTH THINGS THAT
 * LOOK FINE ON A DESK. <==
 *
 * 1. **A LANDFALL MARK WEARING THE WRONG CATEGORY.** The mark's fill is the
 *    storm's strength AT THE COAST; the track beside it is the storm's PEAK.
 *    Katrina peaked at Cat 5 over open water and came ashore in Louisiana at
 *    Cat 3. A mark drawn from `peakCategory` would be magenta, would look
 *    perfectly plausible, and would be the app stating something false about
 *    the one event it is named after. Checked against her real records.
 *
 * 2. **A ONE-RECORD STORM DRAWING NOTHING.** `season-tracks.js` needs two
 *    points to make a line and drops anything shorter. Before this file, a
 *    reader ticking a single-sighting storm from the 1850s watched nothing
 *    happen — the silence §5 forbids, and invisible in any test that only
 *    counts tracks.
 *
 * The map is a stub that records what was pushed. It deliberately does NOT
 * validate expressions — the same rule `tools/test-season-tracks.mjs` states
 * and for the same reason.
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

const { parseHurdat2 } = await import('../lib/hurdat.js');
const { stormFacts } = await import('../lib/season-facts.js');
const { CATEGORY_COLOR, ARCHIVE_GEO } = await import('../config/tokens.js');
const {
  ensureSeasonMarks, setSeasonMarks, clearSeasonMarks, setSeasonMarkFocus, __internals,
} = await import('../map/layers/season-marks.js');

function fakeMap() {
  const sources = new Map();
  const layers = [];
  const paint = new Map();
  return {
    added: layers,
    getSource: (id) => sources.get(id) || null,
    getLayer: (id) => layers.find((l) => l.id === id) || null,
    addSource(id, def) { sources.set(id, { def, data: def.data, setData(d) { this.data = d; } }); },
    addLayer(def, beforeId) { layers.push({ ...def, beforeId }); },
    setPaintProperty(layerId, prop, value) { paint.set(`${layerId}.${prop}`, value); },
    paintOf: (layerId, prop) => paint.get(`${layerId}.${prop}`),
    layer: (id) => layers.find((l) => l.id === id),
    data: () => sources.get('season-marks')?.data,
  };
}

const entry = (storm) => ({ storm, facts: stormFacts(storm) });

const seasonOf = (basin, year) => {
  const index = JSON.parse(readFileSync(join(ROOT, 'seasons', 'index.json'), 'utf8'));
  const file = index.basins[basin].seasons[String(year)];
  return parseHurdat2(readFileSync(join(ROOT, 'seasons', 'data', file), 'utf8')).storms;
};

const kindsOf = (map) => map.data().features.map((f) => f.properties.kind);

/* ---------------------------------------------------------------------------
 * 1. ATTACHING
 * ------------------------------------------------------------------------ */
{
  const map = fakeMap();
  ensureSeasonMarks(map, 'season-track-name');
  eq('two layers are added — the one-record dot and the landfall mark',
    map.added.map((l) => l.id), ['season-mark-one', 'season-mark-landfall']);
  eq('==> THE LANDFALL MARK GOES IN LAST, SO IT IS ON TOP. <== MapLibre '
    + 'inserts beneath the anchor, so insertion order is bottom-up and a '
    + 'landfall hidden under a one-record dot is the one stacking accident '
    + 'that matters here', map.added[1].id, 'season-mark-landfall');
  eq('both anchor under the name layer, so a pin sits ON its track rather '
    + 'than under it', map.added.map((l) => l.beforeId),
  ['season-track-name', 'season-track-name']);
  eq('it starts empty rather than undefined', map.data().features, []);

  ensureSeasonMarks(map, 'season-track-name');
  eq('attaching twice adds nothing', map.added.length, 2);

  /* The two layers share a source and are told apart by a filter. If a filter
   * ever goes missing, every landfall gets a bare dot drawn under it and every
   * one-record storm gets a ring it has not earned. */
  eq('the quiet dot is filtered to its own kind',
    map.layer('season-mark-one').filter, ['==', ['get', 'kind'], 'one']);
  eq('and so is the landfall mark',
    map.layer('season-mark-landfall').filter, ['==', ['get', 'kind'], 'landfall']);

  /* ==> THEME-STATE RULE 1B. <== The ring is a themed colour and the fill is a
   * feature read, and they must stay on SEPARATE properties: one property
   * holding both is evaluated in the worker, which never receives the global
   * state, and resolves to black without throwing. */
  const lf = map.layer('season-mark-landfall').paint;
  ok('the ring ink is a bare global-state reference with no feature read',
    JSON.stringify(lf['circle-stroke-color']).includes('global-state')
    && !JSON.stringify(lf['circle-stroke-color']).includes('"get"'));
  eq('and the fill is a bare feature read with no global state',
    lf['circle-color'], ['get', 'color']);
}

/* ---------------------------------------------------------------------------
 * 2. ==> KATRINA CAME ASHORE AT CAT 3, NOT CAT 5. <==
 * ------------------------------------------------------------------------ */
{
  const katrina = seasonOf('atlantic', 2005).find((s) => s.name === 'KATRINA');
  ok('Katrina is in the archive', !!katrina);

  const facts = stormFacts(katrina);
  /* The scale is an INDEX, not a Saffir-Simpson number: 0 is TD, 1 is TS and
   * 6 is Cat 5 (`lib/category.js`). Spelled out because reading `5` here as
   * "Cat 5" is the obvious mistake and it would make the assertion below
   * assert nothing. */
  eq('her PEAK is the top of the ramp, which is what her TRACK is drawn in',
    facts.peakCategory, 6);

  const map = fakeMap();
  ensureSeasonMarks(map);
  setSeasonMarks(map, [entry(katrina)]);

  const marks = map.data().features.filter((f) => f.properties.kind === 'landfall');
  ok(`NOAA marked ${marks.length} landfalls on her, and every one is drawn`,
    marks.length === facts.landfalls.length && marks.length > 0);

  /* THE ASSERTION THIS FILE WAS WRITTEN FOR. Her Louisiana landfall is Cat 3
   * in NOAA's own record; a mark drawn from peak would be magenta. */
  const cats = facts.landfalls.map((l) => l.category);
  ok(`her landfall categories are ${JSON.stringify(cats)} — NOT all at peak`,
    cats.some((c) => c !== 6));
  ok('==> AND NO MARK WEARS HER PEAK COLOUR. <== If this goes red, the fill '
    + 'has been switched to `peakCategory` and the app is claiming a Cat 5 '
    + 'made landfall',
  marks.every((m) => m.properties.color !== CATEGORY_COLOR.CAT5));

  /* Each mark carries the STORM's id, not its own — that is what makes a
   * storm's three pins brighten and dim with its track as one object. */
  ok('every mark is attributed to the storm rather than to itself',
    marks.every((m) => m.properties.id === katrina.id));
}

/* ---------------------------------------------------------------------------
 * 3. A COLOUR ALWAYS RESOLVES — including in a century with no wind readings.
 * ------------------------------------------------------------------------ */
{
  const al1851 = seasonOf('atlantic', 1851);
  const map = fakeMap();
  ensureSeasonMarks(map);
  setSeasonMarks(map, al1851.map(entry));

  const feats = map.data().features;
  ok(`1851 puts ${feats.length} marks on the globe`, feats.length > 0);
  ok('every one carries a real colour string',
    feats.every((f) => typeof f.properties.color === 'string'
      && f.properties.color.startsWith('#')));
  ok('and none is the string "null" or "undefined"',
    feats.every((f) => f.properties.color !== 'null'
      && f.properties.color !== 'undefined'));

  /* A landfall row with no wind reading is real in this era, and it must get
   * the ungraded hue rather than a missing paint property — the same
   * guarantee `season-tracks.js` carries for the line colour. */
  const blank = {
    id: 'AL991851',
    points: [
      { time: 0, lat: 25, lon: -80, lonU: -80, windKt: null, status: 'HU', marker: 'L' },
      { time: 21600000, lat: 26, lon: -81, lonU: -81, windKt: null, status: 'HU' },
    ],
  };
  const out = __internals.marksForStorm(blank, stormFacts(blank));
  eq('an ungraded landfall still produces a mark', out.length, 1);
  eq('and it is the generic hue, not a category it never earned',
    out[0].properties.color, CATEGORY_COLOR.GENERIC);
}

/* ---------------------------------------------------------------------------
 * 4. ==> THE ONE-RECORD STORM. IT USED TO DRAW NOTHING AT ALL. <==
 * ------------------------------------------------------------------------ */
{
  const one = {
    id: 'AL071855',
    points: [{ time: 0, lat: 22, lon: -60, lonU: -60, windKt: 45, status: 'TS' }],
  };
  const map = fakeMap();
  ensureSeasonMarks(map);
  setSeasonMarks(map, [entry(one)]);

  eq('==> A SINGLE SIGHTING IS DRAWN AS A DOT RATHER THAN DROPPED. <== '
    + '`season-tracks.js` cannot make a line from one point, so without this '
    + 'a reader ticks the storm and nothing happens — silence that looks like '
    + '"nothing there"', kindsOf(map), ['one']);
  eq('at the position NOAA published', map.data().features[0].geometry.coordinates,
    [-60, 22]);

  /* ==> THE DOT AND THE PIN MUST NEVER BE CONFUSABLE. <== A ring means NOAA
   * marked this as a landfall; a bare dot means this is all there is. If the
   * sizes ever converge, that distinction is gone from the glass. */
  ok('the one-record dot is smaller than a landfall mark',
    ARCHIVE_GEO.onePointRadius < ARCHIVE_GEO.landfallRadius);
  ok('and it carries no ring at all',
    map.layer('season-mark-one').paint['circle-stroke-width'] === undefined);

  /* A two-point storm is a line and gets no dot — otherwise every short storm
   * in the record grows a mark it did not earn. */
  const two = {
    id: 'AL081855',
    points: [
      { time: 0, lat: 22, lon: -60, lonU: -60, windKt: 45, status: 'TS' },
      { time: 21600000, lat: 23, lon: -61, lonU: -61, windKt: 45, status: 'TS' },
    ],
  };
  const map2 = fakeMap();
  ensureSeasonMarks(map2);
  setSeasonMarks(map2, [entry(two)]);
  eq('a two-point storm is a LINE and gets no dot', map2.data().features.length, 0);
}

/* ---------------------------------------------------------------------------
 * 5. THE WHOLE-SET CONTRACT, and the focus that has to match the tracks.
 * ------------------------------------------------------------------------ */
{
  const al2005 = seasonOf('atlantic', 2005);
  const katrina = al2005.find((s) => s.name === 'KATRINA');
  const map = fakeMap();
  ensureSeasonMarks(map);

  setSeasonMarks(map, al2005.slice(0, 6).map(entry));
  const some = map.data().features.length;
  ok(`six storms put ${some} marks up`, some > 0);

  setSeasonMarks(map, []);
  eq('nothing ticked draws nothing', map.data().features.length, 0);

  setSeasonMarks(map, [entry(katrina)]);
  const before = JSON.stringify(map.data());
  setSeasonMarkFocus(map, katrina.id);
  eq('focusing does not touch the data here either',
    JSON.stringify(map.data()), before);

  const want = ['case', ['==', ['get', 'id'], katrina.id],
    ARCHIVE_GEO.focusedOpacity, ARCHIVE_GEO.dimmedOpacity];
  eq('the landfall fill dims with its storm',
    map.paintOf('season-mark-landfall', 'circle-opacity'), want);
  eq('==> AND SO DOES ITS RING. <== A full-strength ring on a ghosted fill '
    + 'reads as a rendering fault rather than as emphasis',
  map.paintOf('season-mark-landfall', 'circle-stroke-opacity'), want);
  eq('and the one-record dot dims on the same rule',
    map.paintOf('season-mark-one', 'circle-opacity'), want);

  /* A layer rebuilt after a style install must come back at the CURRENT
   * focus, not the default. */
  const rebuilt = fakeMap();
  ensureSeasonMarks(rebuilt);
  eq('a fresh layer is built at the current focus',
    rebuilt.layer('season-mark-landfall').paint['circle-opacity'], want);

  clearSeasonMarks(map);
  eq('leaving empties the layer', map.data().features.length, 0);
  eq('and forgets the focus', __internals.focus(), null);

  /* A push before the source exists must be a no-op rather than a throw. */
  const bare = fakeMap();
  setSeasonMarks(bare, [entry(katrina)]);
  setSeasonMarkFocus(bare, katrina.id);
  clearSeasonMarks(bare);
  ok('pushing to a map with no source is a no-op, not a crash', true);
  pass++;
}

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} assertions pass — landfall marks and one-record storms`);
