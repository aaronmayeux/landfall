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
const { CATEGORY_COLOR } = await import('../config/tokens.js');
const { ensureSeasonTracks, setSeasonTracks, clearSeasonTracks, __internals } =
  await import('../map/layers/season-tracks.js');

/** A map that remembers. No expression validation, on purpose — see above. */
function fakeMap() {
  const sources = new Map();
  const layers = [];
  return {
    added: layers,
    getSource: (id) => sources.get(id) || null,
    getLayer: (id) => layers.find((l) => l.id === id) || null,
    addSource(id, def) { sources.set(id, { def, data: def.data, setData(d) { this.data = d; } }); },
    addLayer(def, beforeId) { layers.push({ ...def, beforeId }); },
    data: () => sources.get('season-tracks')?.data,
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
  eq('one layer is added', map.added.length, 1);
  eq('and it draws beneath the storm dots', map.added[0].beforeId, 'storm-dot-planet');
  eq('it starts empty rather than undefined', map.data().features, []);

  ensureSeasonTracks(map, 'storm-dot-planet');
  eq('==> ATTACHING TWICE ADDS NOTHING. <== The archive is entered and left '
    + 'freely and the source outlives all of it', map.added.length, 1);

  /* The colour is read per feature. If this ever becomes a constant, the
   * category ramp has silently stopped reaching the archive. */
  eq('the line colour comes off the feature', map.added[0].paint['line-color'],
    ['get', 'color']);
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
    + '<== It is dropped; step 6 gives it a dot', map.data().features.length, 1);
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
console.log(`✓ ${pass} assertions pass — archive tracks, including the seam`);
