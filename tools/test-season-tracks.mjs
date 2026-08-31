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
const { clockSpan, clockFrameAt, stormGrades } = await import('../lib/season-clock.js');
const { categoryColor } = await import('../lib/category.js');
const { stormFacts } = await import('../lib/season-facts.js');
const { CATEGORY_COLOR, ARCHIVE_GEO } = await import('../config/tokens.js');
const { SEASONS } = await import('../config/constants.js');
/* The archive forces sepia, and `season-tracks.js` bakes the selected storm's
 * ink from whatever palette is current — so this suite has to ask the same
 * question the layer does rather than hardcode a hex. */
const { palette: PALETTE } = await import('../config/theme.js');
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

  /* ==> WITH A STORM SELECTED, EVERY NAME ON THIS LAYER GOES DARK — INCLUDING
   * THE SELECTED STORM'S OWN, WHICH IS THE PART THAT LOOKS WRONG AND IS NOT.
   * <== The others go because a dimmed word is illegible AND still holds its
   * place in MapLibre's collision index, so faded names would go on winning
   * placement fights against the one the reader asked for. The selected
   * storm's goes because it is drawn SOMEWHERE ELSE: `season-points.js` puts
   * it beside the first dot, placed in screen space. Drawn in both places it
   * would be the same word twice on one storm. */
  eq('every name on the line layer is taken out while something is selected',
    map.paintOf('season-track-name', 'text-opacity'), 0);

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
 * 1b-ii. ==> THE SELECTED STORM'S LINE CHANGES INK. <==
 *
 * Aaron's call, 2026-08-25. A storm opened in full detail wears the live
 * globe's forecast ink and gains a category dot at every fix
 * (`season-points.js`), so the DOTS carry the intensity story and the line
 * stops competing with them. Every other track keeps its peak-category hue.
 * ------------------------------------------------------------------------ */
{
  const al2005 = seasonOf('atlantic', 2005);
  const katrina = al2005.find((s) => s.name === 'KATRINA');
  const map = fakeMap();
  ensureSeasonTracks(map);
  setSeasonTracks(map, al2005.slice(0, 6).map(entry));

  eq('==> WITH NOTHING OPEN IT IS A BARE FEATURE READ. <== Every track wears '
    + 'its own peak, which is the archive\'s default reading and the whole '
    + 'point of §6 on this screen',
  map.layer('season-tracks').paint['line-color'], ['get', 'color']);

  setSeasonTrackFocus(map, katrina.id);
  const ink = map.paintOf('season-tracks', 'line-color');
  eq('opening one storm switches ONLY that storm\'s ink, leaving the rest on '
    + 'their category colour', [ink[0], ink[1], ink[3]],
  ['case', ['==', ['get', 'id'], katrina.id], ['get', 'color']]);
  /* ==> ASKED OF `palette()` RATHER THAN HARDCODED, BECAUSE THE HARNESS IS NOT
   * THE ARCHIVE. <== Nothing here forces sepia, so this process reads the DARK
   * value while a phone inside the archive reads the sepia one. What is being
   * guarded is that the layer takes the ink from the CURRENT palette at call
   * time — which is the whole reason it re-bakes on every selection change
   * instead of at install. */
  eq('and the ink it switches to is the live globe\'s forecast track',
    ink[2], PALETTE().geo.trackForecast);

  /* ==> AND IT IS BAKED, NOT NAMED. <== `map/theme-state.js` rule 1b: this
   * expression reads `['get','id']`, so a `global-state` reference in it is
   * evaluated in the worker, which never receives the state, and resolves to
   * BLACK without throwing. Baking is safe here only because the archive
   * forces sepia for as long as it is open. */
  ok('the ink names no global state, or every selected track renders black on '
    + 'a phone while looking fine in a test that only checks the shape',
  !JSON.stringify(ink).includes('global-state'));

  setSeasonTrackFocus(map, null);
  eq('closing it puts every line back on its own category',
    map.paintOf('season-tracks', 'line-color'), ['get', 'color']);
}

/* ---------------------------------------------------------------------------
 * 1b-iii. ==> THE TRACKS ARE SMOOTHED, AND THE CURVES ARE MEMOISED. <==
 *
 * The same centripetal Catmull-Rom every live track uses, so an archive track
 * and a live one bend the same way rather than the archive showing a hard
 * corner at every six-hourly fix.
 * ------------------------------------------------------------------------ */
{
  const al2005 = seasonOf('atlantic', 2005);
  const katrina = al2005.find((s) => s.name === 'KATRINA');
  const raw = katrina.points
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lonU)).length;

  const map = fakeMap();
  ensureSeasonTracks(map);
  setSeasonTracks(map, [entry(katrina)]);
  const drawn = map.data().features[0].geometry.coordinates;

  ok(`her ${raw} fixes become ${drawn.length} vertices — if these are equal, `
    + 'the curve has been lost and the track is drawn as straight legs between '
    + 'fixes', drawn.length > raw);
  ok('and it stays inside the archive\'s vertex budget, which is smaller than '
    + 'the live globe\'s because a season can put thirty tracks on screen',
  drawn.length <= SEASONS.trackMaxVertices);

  /* ==> THE CURVE PASSES THROUGH THE PUBLISHED FIXES. <== Catmull-Rom
   * interpolates rather than approximating, so the first and last vertices are
   * NOAA's own positions. A smoothing that moved them would be the app drawing
   * a storm somewhere it was not. */
  const first = katrina.points.find((p) => Number.isFinite(p.lat) && Number.isFinite(p.lonU));
  eq('the curve starts at the position NOAA published',
    drawn[0], [first.lonU, first.lat]);

  /* THE MEMO. Ticking is a whole-set push, so without it every tick re-splines
   * every storm already on the globe. */
  eq('one storm ticked, one curve held', __internals.curveCount(), 1);
  setSeasonTracks(map, al2005.slice(0, 6).map(entry));
  eq('six ticked, six held', __internals.curveCount(), 6);

  eq('==> AND IT IS PRUNED TO WHAT IS DRAWN, NEVER GROWN. <== A reader '
    + 'browsing a dozen seasons in one visit would otherwise accumulate every '
    + 'curve of every storm they ever ticked',
  (setSeasonTracks(map, [entry(katrina)]), __internals.curveCount()), 1);

  clearSeasonTracks(map);
  eq('and leaving drops them all', __internals.curveCount(), 0);

  /* A two-point storm is a straight segment and must come back UNCHANGED
   * rather than padded — `smoothPath` returns fewer than three points as they
   * came, and a version that invented vertices would be drawing a curve
   * through a storm with nothing to curve around. */
  const two = {
    id: 'AL081855',
    points: [
      { time: 0, lat: 22, lon: -60, lonU: -60, windKt: 45, status: 'TS' },
      { time: 21600000, lat: 23, lon: -61, lonU: -61, windKt: 45, status: 'TS' },
    ],
  };
  const map2 = fakeMap();
  ensureSeasonTracks(map2);
  setSeasonTracks(map2, [entry(two)]);
  eq('a two-fix storm stays the straight segment it genuinely is',
    map2.data().features[0].geometry.coordinates, [[-60, 22], [-61, 23]]);
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
    + '<== It is not a LINE, so it is dropped here — `season-points.js` gives it '
    + 'a dot, and `tools/test-season-points.mjs` is what proves it is not simply '
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

/* ---------------------------------------------------------------------------
 * 9. ==> THE CLOCK COLOURS THE TRAIL PER FIX. §57.67 slice E, call 3. <==
 *
 * Peak is still the answer with no cut in hand, and that is asserted first,
 * because the whole claim of this slice is that it did not reverse a decision
 * that is still correct — it added an exception the clock switches on.
 * ------------------------------------------------------------------------ */
{
  const al2005 = seasonOf('atlantic', 2005);
  const katrina = al2005.find((st) => st.name === 'KATRINA');
  const e = [entry(katrina)];
  const span = clockSpan(e);
  const cutAt = (t) => new Map(
    clockFrameAt(e, t).storms.map((st) => [st.id, st.state])
  );

  const map = fakeMap();
  ensureSeasonTracks(map, 'storm-dot-planet');

  setSeasonTracks(map, e);
  const uncut = map.data().features;
  eq('with no clock, one storm is still exactly one line', uncut.length, 1);
  eq('and it still wears its PEAK colour, which is the archive default',
    uncut[0].properties.color,
    __internals.trackColor(stormFacts(katrina)));

  /* ==> THE RUNS ARE FOUND BY SCANNING THE REAL RECORD, NEVER TYPED. <== The
   * point of the run merge is that it is fewer pieces than fixes, and a typed
   * number would go stale the day the grading rule changes — which it did on
   * 2026-08-29 when the dots started reading the status column (§57.7f). */
  const runs = __internals.colorRuns(katrina);
  const grades = stormGrades(katrina);
  ok(`Katrina holds ${runs.length} grades across ${grades.length} fixes`,
    runs.length > 1 && runs.length < grades.length);
  eq('the first run opens on her first fix', runs[0].fix, 0);
  ok('every run opens later than the one before it',
    runs.every((r, i) => i === 0 || r.fix > runs[i - 1].fix));
  ok('and no two neighbouring runs are the same colour, which is the whole '
    + 'saving', runs.every((r, i) => i === 0 || r.color !== runs[i - 1].color));

  /* ==> AND EVERY RUN'S COLOUR IS THE GRADE AT THE FIX IT OPENS ON. <== The
   * assertion that would catch an off-by-one between the grade list and the fix
   * list — a track wearing yesterday's category all the way down. */
  let matched = 0;
  for (const r of runs) {
    const g = grades[r.fix];
    if (r.color === categoryColor(g.category, g.nature, null)) matched++;
  }
  eq('every run wears the grade of the fix it opens on', matched, runs.length);

  setSeasonTracks(map, e, cutAt(span.to));
  const pieces = map.data().features;
  eq('with the clock engaged she is drawn as one line per run',
    pieces.length, runs.length);
  eq('in the same order, in the same colours',
    pieces.map((f) => f.properties.color), runs.map((r) => r.color));
  ok('and every piece still carries her id, so focus and the tap test still '
    + 'find her', pieces.every((f) => f.properties.id === katrina.id));

  /* ==> THE PIECES MEET. <== A gap at a category change is exactly where the
   * reader is looking, so each piece's last coordinate is the next one's
   * first. Asserted on the coordinates rather than on the vertex numbers,
   * because the coordinates are what MapLibre draws. */
  let joins = 0;
  for (let i = 1; i < pieces.length; i++) {
    const before = pieces[i - 1].geometry.coordinates.at(-1);
    const after = pieces[i].geometry.coordinates[0];
    if (before[0] === after[0] && before[1] === after[1]) joins++;
  }
  eq('every piece starts exactly where the one before it ended',
    joins, pieces.length - 1);

  /* ==> THE LABEL RIDES THE FIRST PIECE AND ONLY THE FIRST. <== Otherwise
   * MapLibre sets her name along all five of them and the globe says KATRINA
   * five times where it said it once. */
  eq('the first piece carries the label', pieces[0].properties.label, 'KATRINA');
  eq('and not one of the others does',
    pieces.slice(1).filter((f) => f.properties.label !== null).length, 0);

  /* ==> A ONE-COLOUR STORM IS ONE PIECE, WHICH IS NOT A SPECIAL CASE. <== It
   * falls out of the run merge, and it is worth an assertion because it is the
   * shape the 19th-century record is full of: no wind readings at all, so no
   * grade changes to cut at. */
  const flat = seasonOf('atlantic', 1851).find((st) => st.points.length > 3);
  const fe = [entry(flat)];
  const fSpan = clockSpan(fe);
  setSeasonTracks(map, fe, new Map(
    clockFrameAt(fe, fSpan.to).storms.map((st) => [st.id, st.state])
  ));
  const flatRuns = __internals.colorRuns(flat);
  eq(`${flat.id} holds one grade all the way through, so it is one line`,
    map.data().features.length, flatRuns.length);
  eq('and it kept its label', map.data().features[0].properties.label !== null, true);

  clearSeasonTracks(map);
}

/* ---------------------------------------------------------------------------
 * 10. ==> THE TIPS COME BACK OUT, WHICH IS WHAT THE HEAD STANDS ON. <==
 * §57.67 slice E, and §57.67e is the measurement behind it.
 * ------------------------------------------------------------------------ */
{
  const al2005 = seasonOf('atlantic', 2005);
  const katrina = al2005.find((st) => st.name === 'KATRINA');
  const e = [entry(katrina)];
  const span = clockSpan(e);

  const map = fakeMap();
  ensureSeasonTracks(map, 'storm-dot-planet');

  /* ==> THE MOMENT IS FOUND BY SCANNING, NOT PICKED, AND THE FIRST DRAFT OF
   * THIS PROVED WHY. <== It was written on the halfway mark of her timeline,
   * where the tip and the clock's own position happen to be the SAME POINT —
   * so it compared a value with itself and would have stayed green with the
   * whole rule deleted. That is §57.67d, §57.67f and §57.67i's finding for the
   * fourth time, and the cure is the same one: scan for the moment that can
   * actually tell the two answers apart. */
  let at = span.from;
  let off = 0;
  for (let i = 0; i <= 200; i++) {
    const t = span.from + (span.spanMs * i) / 200;
    const st = clockFrameAt(e, t).storms[0].state;
    if (!Number.isFinite(st.lon)) continue;
    setSeasonTracks(map, e, new Map([[katrina.id, st]]));
    const tip = map.data().features.at(-1)?.geometry.coordinates.at(-1);
    if (!tip) continue;
    const d = Math.hypot(tip[0] - st.lon, tip[1] - st.lat);
    if (d > off) { off = d; at = t; }
  }

  const worst = new Map(clockFrameAt(e, at).storms.map((st) => [st.id, st.state]));
  const tips = setSeasonTracks(map, e, worst);

  ok('the push hands back a tip per drawn storm', tips.get(katrina.id) != null);

  /* ==> IT IS THE LAST VERTEX OF THE DRAWN LINE, NOT THE CLOCK'S OWN POSITION.
   * <== §57.67e: the clock interpolates straight between two fixes and the
   * curve bends between them, so a head placed at the clock's point floats off
   * its track on a recurve. This is the assertion that catches somebody
   * "simplifying" it back. */
  const drawn = map.data().features;
  const lastPiece = drawn[drawn.length - 1].geometry.coordinates;
  eq('and it is exactly where her drawn line ends',
    tips.get(katrina.id), lastPiece.at(-1));

  const state = worst.get(katrina.id);
  ok(`==> AND THE TWO ANSWERS REALLY DO PART COMPANY — ${(off * 111).toFixed(1)} km `
    + 'at the worst moment of Katrina\'s life, measured across 200 of them. <== '
    + 'If they ever agree everywhere, the curve has stopped being a curve and '
    + 'this whole rule is dead',
    off > 0.01 && Math.hypot(
      tips.get(katrina.id)[0] - state.lon,
      tips.get(katrina.id)[1] - state.lat
    ) === off);

  /* An unborn storm draws no line, so it has no tip — and a head with no trail
   * to stand on is exactly the case `season-head.js` falls back for. */
  const early = new Map(clockFrameAt(e, span.from - 3_600_000).storms
    .map((st) => [st.id, st.state]));
  const noTips = setSeasonTracks(map, e, early);
  eq('a storm that has not happened yet hands back no tip', noTips.size, 0);

  eq('and pushing to a map with no source hands back an empty map, not null',
    setSeasonTracks(fakeMap(), e).size, 0);

  clearSeasonTracks(map);
}

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} assertions pass — archive tracks, the seam, focus and the hit test`);
