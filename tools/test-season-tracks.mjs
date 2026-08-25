/**
 * test-season-tracks.mjs — the archive globe's tracks. §57.30 step 5, §57.21.
 *
 * ==> THE ONE THING THIS SUITE EXISTS TO CATCH IS A TRACK THAT WRAPS THE
 * PLANET. <== `lib/hurdat.js` carries two longitudes on every point: `lon` is
 * what NOAA published, always inside ±180, and `lonU` is the continuous one
 * that may run past it. Drawing `lon` puts a 359°-wide line across the map the
 * moment a storm crosses the antimeridian — the exact fault that made Lala's
 * wind swath a green ring around the globe this week, arriving from a
 * different direction. Hurricane Della, CP011957, does it in the archive's own
 * data, so it is checked against her real records rather than a fixture.
 *
 * The map is a stub that records what was pushed. It deliberately does NOT
 * validate expressions — that is how `tools/test-surge.mjs` stayed green over a
 * feature that never once ran (NOW.md item 0c) — so nothing here asserts that
 * MapLibre accepts the paint. What it asserts is the DATA, which is where a
 * wrapped line and a missing colour both live.
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
  ensureSeasonTracks, setSeasonTracks, clearSeasonTracks,
  setSeasonTrackFocus, seasonStormAtPoint, __internals,
} = await import('../map/layers/season-tracks.js');

/** A map that remembers. No expression validation, on purpose — see above.
 *
 *  `setPaintProperty` and `queryRenderedFeatures` are recorded rather than
 *  simulated. What the focus assertions below check is WHICH property was set
 *  and what expression it was handed; whether MapLibre would then paint the
 *  right pixels is glass, and pretending otherwise here is how a suite ends up
 *  green over a feature that never ran. */
function fakeMap({ hits = [] } = {}) {
  const sources = new Map();
  const layers = [];
  const paint = new Map();
  const queries = [];
  return {
    added: layers,
    queries,
    getSource: (id) => sources.get(id) || null,
    getLayer: (id) => layers.find((l) => l.id === id) || null,
    addSource(id, def) { sources.set(id, { def, data: def.data, setData(d) { this.data = d; } }); },
    addLayer(def, beforeId) { layers.push({ ...def, beforeId }); },
    setPaintProperty(layerId, prop, value) { paint.set(`${layerId}.${prop}`, value); },
    paintOf: (layerId, prop) => paint.get(`${layerId}.${prop}`),
    queryRenderedFeatures(box, opts) { queries.push({ box, opts }); return hits; },
    data: () => sources.get('season-tracks')?.data,
    layer: (id) => layers.find((l) => l.id === id),
  };
}

const entry = (storm) => ({ storm, facts: stormFacts(storm) });

const seasonOf = (basin, year) => {
  const index = JSON.parse(readFileSync(join(ROOT, 'seasons', 'index.json'), 'utf8'));
  const file = index.basins[basin].seasons[String(year)];
  return parseHurdat2(readFileSync(join(ROOT, 'seasons', 'data', file), 'utf8')).storms;
};

/* ---------------------------------------------------------------------------
 * 1. ATTACHING
 * ------------------------------------------------------------------------ */
{
  const map = fakeMap();
  ensureSeasonTracks(map, 'storm-dot-planet');
  eq('two layers are added — the line and its name', map.added.length, 2);
  eq('the line draws beneath the storm dots', map.added[0].beforeId, 'storm-dot-planet');
  eq('and so does the name layer', map.added[1].beforeId, 'storm-dot-planet');
  eq('==> THE NAME GOES IN AFTER THE LINE, SO IT SITS ON TOP OF IT. <== '
    + 'MapLibre inserts each layer directly beneath the anchor, so insertion '
    + 'order is bottom-up and a name added first would be drawn under its own '
    + 'track', map.added.map((l) => l.id), ['season-tracks', 'season-track-name']);
  eq('it starts empty rather than undefined', map.data().features, []);

  ensureSeasonTracks(map, 'storm-dot-planet');
  eq('==> ATTACHING TWICE ADDS NOTHING. <== The archive is entered and left '
    + 'freely and the source outlives all of it', map.added.length, 2);

  /* The colour is read per feature. If this ever becomes a constant, the
   * category ramp has silently stopped reaching the archive. */
  eq('the line colour comes off the feature', map.added[0].paint['line-color'],
    ['get', 'color']);

  /* ==> BOTH LAYERS READ THE SAME SOURCE. <== A name drawn from a second
   * source could outlive the track it names — the exact "label for a storm
   * that is not on the globe" failure that one source makes impossible. */
  eq('the name layer reads the track source', map.added[1].source, 'season-tracks');
  eq('and it sets the name ALONG the line, which is the whole reason this is '
    + 'not a port of name-placement.js',
    map.added[1].layout['symbol-placement'], 'line');
  eq('the label text is the display name, not the raw one — §57.14',
    map.added[1].layout['text-field'], ['get', 'label']);

  /* ==> THEME-STATE RULE 1B. <== A paint property holding BOTH a global-state
   * reference and a feature read is evaluated in the worker, which never
   * receives the global state, and resolves to BLACK without throwing. The ink
   * and the opacity are therefore separate properties, and this asserts they
   * stayed separate. */
  const namePaint = map.added[1].paint;
  ok('the name ink is a bare global-state reference with no feature read',
    JSON.stringify(namePaint['text-color']).includes('global-state')
    && !JSON.stringify(namePaint['text-color']).includes('"get"'));
  ok('and the name opacity carries no global-state',
    !JSON.stringify(namePaint['text-opacity']).includes('global-state'));
}

/* ---------------------------------------------------------------------------
 * 1b. ==> FOCUS AND DIM. §57.21 ITEM 2 — THE MOST IMPORTANT INTERACTION IN
 * THE FEATURE. <==
 *
 * The thing worth guarding is that it is a REPAINT: the data must not move
 * when focus does. A version that re-pushed the GeoJSON would look identical
 * on a desk and cost a re-tile of the source on every tap on a phone.
 * ------------------------------------------------------------------------ */
{
  const al2005 = seasonOf('atlantic', 2005);
  const katrina = al2005.find((s) => s.name === 'KATRINA');
  const map = fakeMap();
  ensureSeasonTracks(map);
  setSeasonTracks(map, al2005.slice(0, 6).map(entry));

  const before = JSON.stringify(map.data());
  setSeasonTrackFocus(map, katrina.id);
  eq('==> FOCUSING DOES NOT TOUCH THE DATA. <== It is a paint-property swap, '
    + 'not a re-push', JSON.stringify(map.data()), before);

  eq('the focused storm draws at full and the rest drop to the ghost value',
    map.paintOf('season-tracks', 'line-opacity'),
    ['case', ['==', ['get', 'id'], katrina.id],
      ARCHIVE_GEO.focusedOpacity, ARCHIVE_GEO.dimmedOpacity]);

  /* ==> AND THE OTHER NAMES GO TO ZERO, NOT TO THE GHOST VALUE. <== A dimmed
   * word is illegible AND still holds its place in MapLibre's collision index,
   * so the faded names would go on winning placement fights against the one
   * name the reader asked for. If this ever becomes `dimmedOpacity`, the
   * focused storm can end up the only unlabelled track on screen. */
  eq('every other NAME is taken out entirely rather than dimmed',
    map.paintOf('season-track-name', 'text-opacity'),
    ['case', ['==', ['get', 'id'], katrina.id], ARCHIVE_GEO.focusedOpacity, 0]);

  setSeasonTrackFocus(map, null);
  eq('==> NO FOCUS IS A PLAIN NUMBER, NOT AN EXPRESSION THAT ALWAYS ANSWERS '
    + 'THE SAME. <== Most of the time nobody has tapped anything, and that '
    + 'state should cost MapLibre nothing to evaluate',
    map.paintOf('season-tracks', 'line-opacity'), ARCHIVE_GEO.focusedOpacity);
  eq('and the names come back', map.paintOf('season-track-name', 'text-opacity'),
    ARCHIVE_GEO.focusedOpacity);

  ok('the dimmed value is a ghost rather than an erasure — a season whose '
    + 'unfocused tracks are invisible is a season you cannot navigate',
    ARCHIVE_GEO.dimmedOpacity > 0 && ARCHIVE_GEO.dimmedOpacity < 0.5);

  /* ==> A LAYER REBUILT UNDER A LIVE FOCUS COMES BACK FOCUSED. <== `ensure`
   * runs again after a style install. Without the held id it would paint the
   * default — every track at full strength while the roster still shows one
   * row marked, which is the panel and the map disagreeing. */
  setSeasonTrackFocus(map, katrina.id);
  const rebuilt = fakeMap();
  ensureSeasonTracks(rebuilt);
  eq('a fresh layer is built at the CURRENT focus, not the default',
    rebuilt.layer('season-tracks').paint['line-opacity'],
    ['case', ['==', ['get', 'id'], katrina.id],
      ARCHIVE_GEO.focusedOpacity, ARCHIVE_GEO.dimmedOpacity]);

  /* And leaving drops it, or a reader returning to 1935 finds one arbitrary
   * storm bright because an id from 2005 matched nothing. */
  clearSeasonTracks(map);
  eq('leaving the archive forgets the focus', __internals.focus(), null);
}

/* ---------------------------------------------------------------------------
 * 1c. THE HIT TEST — a track has to be tappable by a thumb.
 * ------------------------------------------------------------------------ */
{
  const withHit = fakeMap({ hits: [{ properties: { id: 'AL122005' } }] });
  ensureSeasonTracks(withHit);
  eq('a tap on a track answers with its storm',
    seasonStormAtPoint(withHit, { x: 100, y: 200 }), 'AL122005');

  const q = withHit.queries[0];
  eq('==> IT ASKS THE LINE LAYER AND NOT THE NAME LAYER. <== A name is a label '
    + 'ABOUT a track; including it would make the word a bigger target than '
    + 'the line, so a tap aimed at a crossing storm would select whichever '
    + 'name happened to lie over it', q.opts.layers, ['season-tracks']);

  const w = q.box[1][0] - q.box[0][0];
  ok(`the query is a ${w}px BOX and not a point — a track is a 1.75px line and `
    + 'a thumb is not a pixel (§13)', w >= 44);

  const empty = fakeMap({ hits: [] });
  ensureSeasonTracks(empty);
  eq('a tap on open water answers null, which is what clears the focus',
    seasonStormAtPoint(empty, { x: 1, y: 1 }), null);

  /* A feature with no attribution selects nothing rather than a neighbour —
   * the same rule `map/markers.js` states for the live globe. */
  const junk = fakeMap({ hits: [{ properties: {} }] });
  ensureSeasonTracks(junk);
  eq('a hit carrying no id selects nothing', seasonStormAtPoint(junk, { x: 1, y: 1 }), null);

  eq('and asking a map with no layer is a no-op rather than a throw',
    seasonStormAtPoint(fakeMap(), { x: 1, y: 1 }), null);
}

/* ---------------------------------------------------------------------------
 * 2. ==> THE DATELINE. DELLA, CP011957. <==
 * ------------------------------------------------------------------------ */
{
  const della = seasonOf('epacific', 1957).find((s) => s.id === 'CP011957');
  ok('Della is in the archive', !!della);

  const map = fakeMap();
  ensureSeasonTracks(map);
  setSeasonTracks(map, [entry(della)]);

  const coords = map.data().features[0].geometry.coordinates;
  const lons = coords.map((c) => c[0]);
  const span = Math.max(...lons) - Math.min(...lons);

  /* She crosses the seam, so her published longitudes jump 359° in six hours
   * while she actually moved under a degree. Unwrapped, her whole track is a
   * few tens of degrees wide. */
  ok(`==> DELLA'S TRACK IS ${span.toFixed(1)}° WIDE AND MUST NOT BE ~360 <==`,
    span < 180);
  ok('and it runs past ±180, which is what unwrapped means',
    lons.some((l) => Math.abs(l) > 180));

  /* The proof that this is a real risk rather than a hypothetical one: the
   * SAME storm drawn from raw published longitudes does wrap. If this stops
   * being true, Della is no longer the fixture for this and the suite is
   * measuring nothing. */
  const raw = della.points.map((p) => p.lon);
  const rawSpan = Math.max(...raw) - Math.min(...raw);
  ok(`the raw longitudes DO wrap (${rawSpan.toFixed(1)}°), so this test has teeth`,
    rawSpan > 300);

  /* No step between adjacent drawn points may be a seam jump. A track that
   * crosses twice would pass a span check and still tear. */
  const worst = Math.max(...lons.slice(1).map((l, i) => Math.abs(l - lons[i])));
  ok(`no drawn step jumps the seam (worst ${worst.toFixed(2)}°)`, worst < 180);
}

/* ---------------------------------------------------------------------------
 * 3. COLOUR — never null, which is the thirteenth `['get', colour]` in map/.
 * ------------------------------------------------------------------------ */
{
  const al2005 = seasonOf('atlantic', 2005);
  const map = fakeMap();
  ensureSeasonTracks(map);
  setSeasonTracks(map, al2005.map(entry));

  const feats = map.data().features;
  ok('every feature carries a colour',
    feats.every((f) => typeof f.properties.color === 'string' && f.properties.color));
  ok('and none of them is the string "null"',
    feats.every((f) => f.properties.color !== 'null' && f.properties.color !== 'undefined'));

  const katrina = feats.find((f) => f.properties.name === 'KATRINA');
  eq('Katrina draws at her PEAK, which was Cat 5', katrina.properties.color,
    CATEGORY_COLOR.CAT5);

  /* ==> A STORM WITH NO WIND ANYWHERE IN THE FILE STILL GETS A COLOUR. <==
   * Real, and common before 1886. This is the path that would otherwise
   * resolve to undefined and land in NOW.md item 0d's pile. */
  const blank = { points: [
    { time: 0, lat: 10, lon: -50, lonU: -50, windKt: null, status: 'TS' },
    { time: 21600000, lat: 11, lon: -51, lonU: -51, windKt: null, status: 'TS' },
  ] };
  const c = __internals.trackColor(stormFacts(blank));
  ok(`an ungraded storm still resolves to a real colour (${c})`,
    typeof c === 'string' && c.startsWith('#'));
  eq('and it is the generic hue, not a category it never earned',
    c, CATEGORY_COLOR.GENERIC);
}

/* ---------------------------------------------------------------------------
 * 4. THE WHOLE-SET CONTRACT.
 *
 * ==> UNTICKING IS THE SAME CALL AS TICKING, WITH A SHORTER LIST. <== Two
 * paths would be two places for the globe to drift out of step with the
 * roster's checkboxes, and the roster is the thing the reader believes.
 * ------------------------------------------------------------------------ */
{
  const al2005 = seasonOf('atlantic', 2005);
  const map = fakeMap();
  ensureSeasonTracks(map);

  setSeasonTracks(map, al2005.slice(0, 3).map(entry));
  eq('three ticked draws three', map.data().features.length, 3);

  setSeasonTracks(map, al2005.slice(0, 1).map(entry));
  eq('one ticked draws one — the rest are gone, not hidden',
    map.data().features.length, 1);

  setSeasonTracks(map, []);
  eq('nothing ticked draws nothing', map.data().features.length, 0);

  setSeasonTracks(map, al2005.slice(0, 2).map(entry));
  clearSeasonTracks(map);
  eq('and clearing empties it', map.data().features.length, 0);
}

/* ---------------------------------------------------------------------------
 * 5. DEGENERATE TRACKS ARE DROPPED, NOT THROWN AT THE RENDERER.
 * ------------------------------------------------------------------------ */
{
  const map = fakeMap();
  ensureSeasonTracks(map);

  const onePoint = { id: 'X', points: [{ time: 0, lat: 10, lon: -50, lonU: -50, windKt: 40, status: 'TS' }] };
  const noPoints = { id: 'Y', points: [] };
  const good = seasonOf('atlantic', 2005)[0];

  setSeasonTracks(map, [entry(onePoint), entry(noPoints), entry(good)]);
  eq('==> A ONE-RECORD STORM IS A REAL THING AND MUST NOT TAKE THE LAYER DOWN. '
    + '<== It is not a LINE, so it is dropped here — `season-marks.js` gives it '
    + 'a dot, and `tools/test-season-marks.mjs` is what proves it is not simply '
    + 'lost', map.data().features.length, 1);
  eq('and the good storm beside it still drew', map.data().features[0].properties.id, good.id);

  /* A push before the source exists must be a no-op rather than a throw —
   * `styleReady` guards it in main.js, but the layer cannot rely on that. */
  const bare = fakeMap();
  setSeasonTracks(bare, [entry(good)]);
  clearSeasonTracks(bare);
  ok('pushing to a map with no source is a no-op, not a crash', true);
  pass++;
}

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} assertions pass — archive tracks, the seam, focus and the hit test`);
