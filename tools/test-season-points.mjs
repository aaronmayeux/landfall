/**
 * test-season-points.mjs — the archive globe's DOTS. §57.21 item 3,
 * §57.30 step 6.
 *
 * ==> THREE THINGS THIS SUITE EXISTS TO CATCH, AND ALL THREE LOOK FINE ON A
 * DESK. <==
 *
 * 1. **A DOT WEARING THE STORM'S PEAK INSTEAD OF THE STRENGTH AT THAT MOMENT.**
 *    The track carries peak; a fix carries what was actually blowing there.
 *    Katrina peaked at Cat 5 over open water and was a tropical storm crossing
 *    Florida. A chain of dots drawn from `peakCategory` would be forty magenta
 *    discs, would look perfectly plausible, and would be the app stating
 *    something false about the storm it is best known for.
 *
 * 2. **A ONE-RECORD STORM DRAWING NOTHING.** `season-tracks.js` needs two
 *    points to make a line and drops anything shorter. Without its own dot, a
 *    reader ticking a single-sighting storm from the 1850s watches nothing
 *    happen — the silence §5 forbids, and invisible in any test that only
 *    counts tracks. It is drawn WHETHER OR NOT the storm is selected, which is
 *    the whole difference between the two kinds of dot here.
 *
 * 3. **PER-FIX DOTS ESCAPING THEIR BOUND.** They exist only for the storm the
 *    reader opened. 2005 has 28 storms averaging about 40 fixes; drawing them
 *    all is eleven hundred ten-pixel discs over the lines they annotate.
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
const { stormDisplayName } = await import('../lib/season-names.js');
const { palette } = await import('../config/theme.js');
const {
  CATEGORY_COLOR, ARCHIVE_GEO, STORM_GEO,
} = await import('../config/tokens.js');

/* Every Saffir-Simpson hue, so a non-cyclone dot can be asserted to wear NONE
 * of them rather than merely not the one the test happened to think of. */
const CAT_HUES = new Set(Object.entries(CATEGORY_COLOR)
  .filter(([k]) => k !== 'GENERIC').map(([, v]) => v));
const {
  ensureSeasonPoints, setSeasonPoints, clearSeasonPoints, setSeasonPointFocus, __internals,
} = await import('../map/layers/season-points.js');

function fakeMap() {
  const sources = new Map();
  const layers = [];
  const paint = new Map();
  const events = [];
  return {
    added: layers,
    events,
    on(type) { events.push(type); },
    getSource: (id) => sources.get(id) || null,
    getLayer: (id) => layers.find((l) => l.id === id) || null,
    addSource(id, def) { sources.set(id, { def, data: def.data, setData(d) { this.data = d; } }); },
    addLayer(def, beforeId) { layers.push({ ...def, beforeId }); },
    setPaintProperty(layerId, prop, value) { paint.set(`${layerId}.${prop}`, value); },
    paintOf: (layerId, prop) => paint.get(`${layerId}.${prop}`),
    layer: (id) => layers.find((l) => l.id === id),
    data: () => sources.get('season-points')?.data,
  };
}

const entry = (storm) => ({ storm, facts: stormFacts(storm) });

const seasonOf = (basin, year) => {
  const index = JSON.parse(readFileSync(join(ROOT, 'seasons', 'index.json'), 'utf8'));
  const file = index.basins[basin].seasons[String(year)];
  return parseHurdat2(readFileSync(join(ROOT, 'seasons', 'data', file), 'utf8')).storms;
};

const kindsOf = (map) => map.data().features.map((f) => f.properties.kind);
const fixesOf = (map) => map.data().features.filter((f) => f.properties.kind === 'fix');

/* ---------------------------------------------------------------------------
 * 1. ATTACHING
 * ------------------------------------------------------------------------ */
{
  const map = fakeMap();
  ensureSeasonPoints(map, 'season-track-name');
  eq('four layers are added — the one-record dot, the fixes, their codes and '
    + 'the selected storm\'s name',
  map.added.map((l) => l.id),
  ['season-point-one', 'season-point-fix', 'season-point-code', 'season-point-name']);
  eq('==> THE CODE GOES IN ABOVE ITS OWN DOT. <== MapLibre inserts beneath the '
    + 'anchor, so insertion order is bottom-up and a code drawn under its '
    + 'circle is invisible', map.added[2].id, 'season-point-code');
  eq('and the NAME goes in last of all, so it is above every dot on the globe',
    map.added[3].id, 'season-point-name');
  eq('all four anchor under the track-name layer, so a fix sits ON its track '
    + 'rather than under it', map.added.map((l) => l.beforeId),
  ['season-track-name', 'season-track-name', 'season-track-name', 'season-track-name']);
  eq('it starts empty rather than undefined', map.data().features, []);

  ensureSeasonPoints(map, 'season-track-name');
  eq('attaching twice adds nothing', map.added.length, 4);

  /* The layers share a source and are told apart by a filter. If a filter ever
   * goes missing, every one-record storm grows a code it has not earned and
   * every fix gets a second dot under it. */
  eq('the quiet dot is filtered to its own kind',
    map.layer('season-point-one').filter, ['==', ['get', 'kind'], 'one']);
  eq('and so are the fixes',
    map.layer('season-point-fix').filter, ['==', ['get', 'kind'], 'fix']);
  eq('and their codes', map.layer('season-point-code').filter,
    ['==', ['get', 'kind'], 'fix']);

  /* ==> THE FIXES ARE THE LIVE GLOBE'S FORECAST DOT, NOT A LOOKALIKE. <== The
   * point of reading the same tokens is that the two globes cannot drift, so
   * this asserts the tokens themselves rather than the numbers they hold. */
  const fix = map.layer('season-point-fix').paint;
  /* ==> A CYCLONE'S FIX IS STILL EXACTLY A FORECAST DOT. <== §57.7g added a
   * second, smaller radius for a system that was never a storm. The token
   * identity this assertion exists to protect is the DEFAULT arm — if that ever
   * stops being `pointRadius` the two globes have drifted, whatever the other
   * arm says. */
  eq('a fix is a forecast dot\'s radius', fix['circle-radius'], [
    'case', ['get', '_small'], STORM_GEO.remnantPointRadius, STORM_GEO.pointRadius,
  ]);
  ok('and the expression reads feature data only, never global state — rule 1b',
    !JSON.stringify(fix['circle-radius']).includes('global-state'));
  eq('and its ring widens on the earliest point, the same way and by the same '
    + 'amount', fix['circle-stroke-width'],
  ['case', ['get', '_first'], STORM_GEO.pointStrokeWidthFirst, STORM_GEO.pointStrokeWidth]);
  eq('and the code inside it is a forecast code\'s size',
    map.layer('season-point-code').layout['text-size'], STORM_GEO.pointCodeSize);

  /* ==> THEME-STATE RULE 1B, AND IT IS THE REASON THE RING INK IS SET BY
   * `paintInks` RATHER THAN DECLARED. <== A property holding both a
   * `global-state` reference and a `['get', …]` is evaluated in the worker,
   * which never receives the global state, and resolves to black without
   * throwing. This one reads `_first`, so it must carry no state reference. */
  const ring = map.paintOf('season-point-fix', 'circle-stroke-color');
  ok('the ring ink is set at push time rather than declared', ring !== undefined);
  ok('==> AND IT NAMES NO GLOBAL STATE. <== If this goes red, somebody has '
    + 'reached for `gs()` in an expression that also reads feature data, and '
    + 'the rings will render BLACK on a phone while looking fine in a test '
    + 'that only checks the expression is present',
  !JSON.stringify(ring).includes('global-state'));
  eq('and the fill is a bare feature read with no global state',
    fix['circle-color'], ['get', 'color']);

  /* The code's ink reads NO feature data, so it is allowed to name state — and
   * should, because then it re-themes for free. */
  ok('the code ink does name global state, which it is allowed to because it '
    + 'reads no feature data',
  JSON.stringify(map.layer('season-point-code').paint['text-color']).includes('global-state'));
}

/* ---------------------------------------------------------------------------
 * 2. ==> KATRINA WAS NOT A CAT 5 FOR MOST OF HER LIFE. <==
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
  ensureSeasonPoints(map);
  setSeasonPoints(map, [entry(katrina)]);
  eq('ticked but not opened, she has no fixes at all', fixesOf(map).length, 0);

  setSeasonPointFocus(map, katrina.id);
  const fixes = fixesOf(map);
  const drawable = katrina.points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  eq(`opened, every one of her ${drawable.length} recorded positions is drawn`,
    fixes.length, drawable.length);

  /* THE ASSERTION THIS FILE WAS WRITTEN FOR. */
  const colours = new Set(fixes.map((f) => f.properties.color));
  ok(`her dots take ${colours.size} different colours across the storm — if `
    + 'this goes to 1, the fill has been switched to `peakCategory` and the app '
    + 'is drawing her as a Cat 5 over Florida', colours.size > 1);
  ok('and the peak colour is among them, because she did reach it',
    colours.has(CATEGORY_COLOR.CAT5));

  /* Exactly one ring marks the start, or the chain has no direction. */
  const firsts = fixes.filter((f) => f.properties._first);
  eq('exactly one fix is marked as the earliest', firsts.length, 1);
  eq('and it is the first record in the file, which HURDAT2 publishes in order',
    firsts[0].geometry.coordinates, [drawable[0].lon, drawable[0].lat]);

  /* Each dot carries the STORM's id, not its own. Nothing in this app selects
   * an individual fix. */
  ok('every dot is attributed to the storm rather than to itself',
    fixes.every((f) => f.properties.id === katrina.id));

  /* ==> LANDFALL PINS ARE GONE, AND THIS IS THE GUARD AGAINST THEM COMING
   * BACK BY ACCIDENT. <== Aaron's call, 2026-08-25. `lib/season-facts.js`
   * still reads NOAA's `L` records and the roster still marks them; what is
   * gone is the mark on the globe. */
  ok('NOAA still marks landfalls on her, so this is a real absence rather than '
    + 'an empty record', facts.landfalls.length > 0);
  eq('and not one of them draws a pin', kindsOf(map).filter((k) => k === 'landfall'), []);
}

/* ---------------------------------------------------------------------------
 * 2b. ==> THE SELECTED STORM'S NAME SITS ON ITS FIRST DOT. <==
 *
 * Aaron's call, 2026-08-25. Unselected tracks still set their names ALONG the
 * line; a selected one no longer can, because the line is now a chain of forty
 * dots and a name lying along it reads as running through them.
 * ------------------------------------------------------------------------ */
{
  const katrina = seasonOf('atlantic', 2005).find((s) => s.name === 'KATRINA');
  const map = fakeMap();
  ensureSeasonPoints(map);
  /* ==> THE SELECTION IS MODULE STATE AND THE BLOCK ABOVE LEFT KATRINA IN IT.
   * <== A fresh stand-in map does not give a fresh layer module. Cleared
   * explicitly, or this block's first assertion measures the block above it. */
  setSeasonPointFocus(map, null);
  setSeasonPoints(map, [entry(katrina)]);

  eq('==> TICKED BUT NOT OPENED, THERE IS NO NAME HERE AT ALL. <== It is still '
    + 'set along the track by MapLibre, which is the right tool for a bare '
    + 'curve', map.data().features.filter((f) => f.properties._name).length, 0);

  setSeasonPointFocus(map, katrina.id);
  const named = map.data().features.filter((f) => f.properties._name);
  eq('opened, exactly one feature carries the name', named.length, 1);
  ok('and it is the EARLIEST fix, not an arbitrary one — the name marks where '
    + 'the storm began', named[0].properties._first === true);
  eq('the name is the one the roster shows, so a track and its row can never '
    + 'disagree', named[0].properties._name, stormDisplayName(katrina));

  /* ==> THE LAYER IS FILTERED TO THAT ONE FEATURE. <== Without the filter the
   * name would draw on every fix — forty copies of the word along the track,
   * which is worse than the along-the-line placement it replaced. */
  eq('the name layer draws only the earliest fix',
    map.layer('season-point-name').filter,
    ['all', ['==', ['get', 'kind'], 'fix'], ['get', '_first']]);

  /* ==> WITH NO CAMERA THERE IS NO SCREEN SPACE, SO THE NAME FALLS BACK RATHER
   * THAN VANISHING. <== A stand-in map has no `project`, and neither does a
   * style that has not installed. §5: the failure has to stay visible, and the
   * visible thing here is the storm's identity. */
  eq('with nothing to project against it falls back to below the dot',
    named[0].properties._nameAnchor, 'top');
  ok('with a real offset rather than an undefined one',
    Array.isArray(named[0].properties._nameOffset)
    && named[0].properties._nameOffset.every(Number.isFinite));

  /* ==> GIVEN A CAMERA, IT PLACES. <== The projection is faked as a plain
   * scale — enough for `placeName` to run its collision search over a real
   * track shape, which is what is being exercised. */
  const projected = fakeMap();
  projected.project = ([lon, lat]) => ({ x: (lon + 180) * 20, y: (90 - lat) * 20 });
  ensureSeasonPoints(projected);
  setSeasonPoints(projected, [entry(katrina)]);
  setSeasonPointFocus(projected, katrina.id);
  const placed = projected.data().features.find((f) => f.properties._name);
  ok('the anchor is one of the two the placement search offers, and never a '
    + 'diagonal — anything off the vertical was judged on glass to read as '
    + 'knocked askew rather than placed',
  ['top', 'bottom'].includes(placed.properties._nameAnchor));
  ok('the offset is a real pair of ems',
    placed.properties._nameOffset.every(Number.isFinite));
  ok('==> AND IT IS PUSHED AWAY FROM THE DOT RATHER THAN LEFT ON IT. <== A '
    + 'zero offset means the name is drawn through the dot it labels',
  Math.abs(placed.properties._nameOffset[1]) > 0);

  /* ==> AND THE SEARCH ACTUALLY DRIVES THE ANCHOR, WHICH KATRINA ALONE CANNOT
   * PROVE. <== Below the dot is both the search's FIRST choice and its
   * fallback, so a storm that happens to place below passes whether the
   * placement ran or not — a mutation that computed the placement and then
   * never applied the anchor survived this block until this case existed.
   *
   * This track runs due SOUTH from its first fix, which under the projection
   * above is straight DOWN the screen — so the space below the first dot is
   * full of its own line and the search has to take the other spot. */
  const southward = {
    id: 'AL991999',
    points: Array.from({ length: 6 }, (_, k) => ({
      time: k * 21600000,
      lat: 40 - k * 2,
      lon: -60,
      lonU: -60,
      windKt: 60,
      status: 'TS',
    })),
  };
  const down = fakeMap();
  down.project = ([lon, lat]) => ({ x: (lon + 180) * 20, y: (90 - lat) * 20 });
  ensureSeasonPoints(down);
  setSeasonPoints(down, [entry(southward)]);
  setSeasonPointFocus(down, southward.id);
  const pushedDown = down.data().features.find((f) => f.properties._name);
  eq('a track running down the screen pushes its name ABOVE the first dot',
    pushedDown.properties._nameAnchor, 'bottom');
  ok('and the offset travels the same way the anchor says it does — an anchor '
    + 'and an offset disagreeing is a name drawn across its own track',
  pushedDown.properties._nameOffset[1] < 0);

  /* ==> `text-variable-anchor` MUST STAY ABSENT. <== Setting it makes MapLibre
   * choose the anchor itself and silently ignore ours, which on glass looks
   * exactly like the placement search failing. `map/markers.js` learned this
   * on the live globe. */
  eq('MapLibre is not allowed to pick the anchor itself',
    projected.layer('season-point-name').layout['text-variable-anchor'], undefined);

  /* The camera invalidates screen-space placement, so there has to be a
   * listener. Bound in `ensure`, which runs once for the life of the page. */
  ok('the layer listens for the camera settling',
    projected.events.includes('moveend'));
}

{
  const al1851 = seasonOf('atlantic', 1851);
  const map = fakeMap();
  ensureSeasonPoints(map);
  setSeasonPoints(map, al1851.map(entry));
  setSeasonPointFocus(map, al1851[0].id);

  const feats = map.data().features;
  ok(`1851 puts ${feats.length} dots on the globe`, feats.length > 0);
  ok('every one carries a real colour string',
    feats.every((f) => typeof f.properties.color === 'string'
      && f.properties.color.startsWith('#')));
  ok('and none is the string "null" or "undefined"',
    feats.every((f) => f.properties.color !== 'null'
      && f.properties.color !== 'undefined'));

  /* A fix with no wind reading is real in this era, and it must get the
   * ungraded hue rather than a missing paint property — the same guarantee
   * `season-tracks.js` carries for the line colour.
   *
   * ==> IT CARRIES A STATUS, AND SINCE §57.7f THAT MATTERS. <== The 19th
   * century is short of WINDS, not of statuses; every one of these rows says
   * `HU` or `TS` or `TD`. Driving this with no status at all would exercise the
   * remnant branch and assert nothing about the case it was written for. */
  const g = __internals.gradeAt(null, 'HU', 0, 0);
  eq('an ungraded cyclone fix is the generic hue, not a category it never earned',
    g.color, CATEGORY_COLOR.GENERIC);
  eq('==> AND IT CARRIES NO CODE RATHER THAN A GUESSED ONE. <== A blank circle '
    + 'says "nobody measured this"; a "TD" would be the app inventing a reading',
  g.code, '');
}

/* ---------------------------------------------------------------------------
 * 3b. ==> THE STATUS COLUMN DECIDES WHAT A DOT IS. §57.7f <==
 *
 * Aaron, 2026-08-29, on Beryl 2018: a chain of green `TS` dots across Dominica
 * and Puerto Rico, under a panel correctly saying she never came ashore. Her
 * wind never dropped — 45 kt at Dominica — so grading from wind alone could
 * never have got this right. HURDAT2 codes her `DB`.
 * ------------------------------------------------------------------------ */
{
  /* ==> BERYL'S OWN ROWS, NOT AN INVENTED SHAPE. <== §12: a case that builds
   * its own convenient input can pass on the same wrong assumption as the bug.
   * These four are copied from her record in `seasons/data`. */
  const beryl = { id: 'AL022018', points: [
    { time: 4, lat: 13.4, lon: -55.2, lonU: -55.2, windKt: 45, status: 'TS' },
    { time: 5, lat: 14.1, lon: -56.9, lonU: -56.9, windKt: 45, status: 'DB' },
    { time: 6, lat: 15.5, lon: -61.3, lonU: -61.3, windKt: 35, status: 'DB' },
    { time: 7, lat: 33.3, lon: -69.4, lonU: -69.4, windKt: 25, status: 'LO' },
  ] };
  const born = 4;

  const stillTs = __internals.gradeAt(45, 'TS', born, 4);
  const nowDb = __internals.gradeAt(45, 'DB', born, 5);
  eq('at 45 kt as a TS she is a tropical storm', stillTs.code, 'TS');
  eq('==> AT THE SAME 45 kt AS A DB SHE IS BLANK. <== The wind is identical and '
    + 'the answer is different, which is the whole point',
  nowDb.code, '');
  eq('and she is graded remnant rather than tropical', nowDb.nature, 'remnant');
  ok('so the two dots are not the same colour', stillTs.color !== nowDb.color);
  eq('==> THE DISTURBANCE TAKES THE ENDED-STORM GREY. <== \u00a757.7g, Aaron on '
    + 'glass: the teal read too close to the TD blue and the brick read as a '
    + 'strong storm. Neither system has a severity to claim',
  nowDb.color, palette().stormEnded);
  ok('and it draws small, which is what separates it from a post-tropical dot',
    nowDb.small === true);

  /* ==> A `LO` AFTER THE CYCLONE PHASE IS POST-TROPICAL AND STAYS LOUD. <==
   * Sandy approaching New Jersey must not go quiet; she was still lethal. */
  const tail = __internals.gradeAt(25, 'LO', born, 7);
  eq('a low AFTER the storm was a cyclone is post-tropical', tail.nature, 'post-tropical');
  eq('it is the same grey as a remnant', tail.color, palette().stormEnded);
  ok('==> AND IT DRAWS FULL SIZE, WHICH IS THE WHOLE SEPARATION. <== Sandy '
    + 'crossed New Jersey at 80 kt as an EX; a 25 kt wave drifted the '
    + 'mid-Atlantic. One grey, two sizes',
  tail.small === false);
  eq('and it carries the record\u2019s own letters', tail.code, 'LO');

  /* The identical code BEFORE the storm ever formed is the other answer, and
   * this is the pair that proves the rule is about sequence rather than code. */
  const preGenesis = __internals.gradeAt(25, 'LO', born, 1);
  eq('the same LO before it was ever a cyclone is a remnant', preGenesis.nature, 'remnant');
  ok('and draws small and blank', preGenesis.small === true && preGenesis.code === '');

  /* ==> NO SAFFIR-SIMPSON NUMBER ON ANYTHING THAT IS NOT A CYCLONE. <== 687
   * fixes in the archive wore one before this, on `EX` and `LO` rows. That is
   * the grading \u00a76 and \u00a757.7c forbid, and it was on the globe rather than on
   * the panel where it was being watched for. */
  for (const [status, when] of [['EX', 7], ['LO', 7], ['DB', 5], ['WV', 5]]) {
    const hurricaneForce = __internals.gradeAt(100, status, born, when);
    ok(`a ${status} fix at 100 kt wears no category number`,
      !/^[1-5]$/.test(hurricaneForce.code));
    ok(`and no Saffir-Simpson hue`, !CAT_HUES.has(hurricaneForce.color));
  }

  /* The whole storm through the real builder, which is what actually reaches
   * the globe. */
  const feats = __internals.pointsForStorm(beryl, true);
  const codes = feats.map((f) => f.properties._code);
  eq('through the builder her four dots read TS, blank, blank, LO',
    codes.join('|'), 'TS|||LO');
  eq('and the two disturbances are the small ones',
    feats.map((f) => (f.properties._small ? 's' : 'L')).join(''), 'LssL');

  /* A status the record does not carry today must not overflow the circle.
   * `lib/hurdat.js` passes the column through unvalidated on purpose. */
  eq('a three-letter code is dropped rather than truncated to a wrong label',
    __internals.gradeAt(30, 'PTX', born, 7).code, '');
  eq('and an absent status is simply blank',
    __internals.gradeAt(30, null, born, 7).code, '');
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
  ensureSeasonPoints(map);
  setSeasonPoints(map, [entry(one)]);

  eq('==> A SINGLE SIGHTING IS DRAWN AS A DOT RATHER THAN DROPPED. <== '
    + '`season-tracks.js` cannot make a line from one point, so without this '
    + 'a reader ticks the storm and nothing happens — silence that looks like '
    + '"nothing there"', kindsOf(map), ['one']);
  eq('at the position NOAA published', map.data().features[0].geometry.coordinates,
    [-60, 22]);

  /* ==> AND IT DOES NOT WAIT TO BE OPENED, WHICH IS THE WHOLE DIFFERENCE
   * BETWEEN THE TWO KINDS. <== A fix is DETAIL and waits to be asked for. This
   * dot is the storm's ENTIRE presence on the globe, so withholding it until
   * selection would be the same silence arriving through a new door. */
  setSeasonPointFocus(map, 'SOMETHING-ELSE');
  eq('it is still drawn while a different storm is open', kindsOf(map), ['one']);
  setSeasonPointFocus(map, null);
  eq('and with nothing open at all', kindsOf(map), ['one']);

  /* ==> IT MUST NEVER DOUBLE UP WITH A FIX. <== Opening a one-record storm has
   * to give one dot, not a plain dot with a forecast-sized disc on top of it. */
  setSeasonPointFocus(map, one.id);
  eq('opening it gives one dot, not two stacked', kindsOf(map), ['one']);

  /* A two-point storm is a line and gets no standing dot — otherwise every
   * short storm in the record grows a mark it did not earn. */
  const two = {
    id: 'AL081855',
    points: [
      { time: 0, lat: 22, lon: -60, lonU: -60, windKt: 45, status: 'TS' },
      { time: 21600000, lat: 23, lon: -61, lonU: -61, windKt: 45, status: 'TS' },
    ],
  };
  const map2 = fakeMap();
  ensureSeasonPoints(map2);
  setSeasonPoints(map2, [entry(two)]);
  eq('a two-point storm is a LINE and gets no dot', map2.data().features.length, 0);
  setSeasonPointFocus(map2, two.id);
  eq('until it is opened, and then it gets one per fix', fixesOf(map2).length, 2);
}

/* ---------------------------------------------------------------------------
 * 5. THE WHOLE-SET CONTRACT, AND THE BOUND THAT KEEPS THE FIXES AFFORDABLE.
 * ------------------------------------------------------------------------ */
{
  const al2005 = seasonOf('atlantic', 2005);
  const katrina = al2005.find((s) => s.name === 'KATRINA');
  const map = fakeMap();
  ensureSeasonPoints(map);

  setSeasonPoints(map, al2005.map(entry));
  eq('==> A WHOLE SEASON TICKED AND NOTHING OPENED DRAWS NO FIXES AT ALL. <== '
    + 'This is the bound the feature depends on: 2005 is 28 storms averaging '
    + 'about 40 records, and drawing them all is eleven hundred ten-pixel '
    + 'discs over the lines they are supposed to annotate', fixesOf(map).length, 0);

  setSeasonPointFocus(map, katrina.id);
  const opened = fixesOf(map).length;
  ok(`opening one storm inside a fully ticked season draws ${opened} dots, `
    + 'which is one storm\'s worth', opened > 0 && opened < 200);
  ok('and they all belong to that storm',
    fixesOf(map).every((f) => f.properties.id === katrina.id));

  setSeasonPoints(map, []);
  eq('nothing ticked draws nothing', map.data().features.length, 0);

  /* ==> THE SET IS REMEMBERED, WHICH IS WHAT LETS A SELECTION CHANGE REBUILD
   * WITHOUT THE BOARD PUSHING TWICE. <== */
  setSeasonPoints(map, [entry(katrina)]);
  eq('the layer remembers what it was given', __internals.setSize(), 1);
  setSeasonPointFocus(map, katrina.id);
  ok('so opening a storm can produce its fixes with no second push from the '
    + 'board', fixesOf(map).length > 0);

  /* The one-record dot still dims with the tracks around it. The fixes do not
   * carry a focus expression at all, and that is not an omission — every
   * feature in that layer belongs to the one storm being looked at. */
  const want = ['case', ['==', ['get', 'id'], katrina.id],
    ARCHIVE_GEO.focusedOpacity, ARCHIVE_GEO.dimmedOpacity];
  eq('the one-record dot dims on the same rule as the tracks',
    map.paintOf('season-point-one', 'circle-opacity'), want);
  eq('and the fixes carry no focus expression, because there is nothing for '
    + 'them to be dimmed against',
  map.layer('season-point-fix').paint['circle-opacity'], undefined);

  /* A layer rebuilt after a style install must come back at the CURRENT
   * selection, not the default. */
  const rebuilt = fakeMap();
  ensureSeasonPoints(rebuilt);
  eq('a fresh layer is built at the current selection',
    rebuilt.layer('season-point-one').paint['circle-opacity'], want);

  clearSeasonPoints(map);
  eq('leaving empties the layer', map.data().features.length, 0);
  eq('and forgets the selection', __internals.focus(), null);
  eq('and forgets the set, so a second visit cannot redraw a stale season',
    __internals.setSize(), 0);

  /* A push before the source exists must be a no-op rather than a throw. */
  const bare = fakeMap();
  setSeasonPoints(bare, [entry(katrina)]);
  setSeasonPointFocus(bare, katrina.id);
  clearSeasonPoints(bare);
  ok('pushing to a map with no source is a no-op, not a crash', true);
  pass++;
}

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} assertions pass — per-fix dots and one-record storms`);
