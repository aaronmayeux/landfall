/**
 * test-season-glyph-tap.mjs — tapping a hurricane glyph on the archive globe.
 * §57.21d.
 *
 * ==> THE ONE THING THIS SUITE EXISTS TO PROVE IS THAT THE MARK AND ITS TARGET
 * ARE THE SAME FIX. <== `map/season-mesh.js` stamps the glyph on element 0 of a
 * filtered, chronologically sorted list, and builds the tap target from element
 * 0 of the same list. If those two ever came apart the app would show a mark
 * you can plainly see, and a tap on it would open the wrong storm or nothing —
 * a fault with no console line and no visible cause. So the assertions below
 * compare the ridge's own head point against the glyph list rather than
 * checking each against a number typed here.
 *
 * ==> THE STORMS ARE REAL AND READ OFF DISK. <== `seasons/data/` is in this
 * repo. An invented track would have neat six-hourly rows starting at a round
 * longitude, which is exactly the shape that hides a fault about which fix is
 * first. Della, CP011957, is the repo's seam fixture.
 *
 * ==> MAPLIBRE IS STOOD IN FOR, AND THE STAND-IN IS AN ORTHOGRAPHIC GLOBE. <==
 * The thing under test is the arbitration — which glyphs are considered, which
 * are refused for being round the back, and which of two near-misses wins. A
 * real MapLibre would be testing MapLibre. The stand-in projects the way a
 * globe seen from far away does, which is enough to place a pixel and is
 * honest about being an approximation: nothing here asserts a screen position
 * to the pixel, only which storm a tap resolves to.
 *
 * Zero dependencies, plain node.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };
const eq = (what, got, want) => ok(
  `${what} (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`,
  Object.is(got, want)
);

/* ==> THREE IS A VENDORED GLOBAL, AND THIS STAND-IN DOES REAL ARITHMETIC. <==
 * The sibling suites stub `normalize()` as a no-op because they only ever ask
 * for a direction's identity. This one takes a DOT PRODUCT of two directions
 * and compares it against a threshold, so a `normalize` that does not
 * normalize would make every facing test pass and the round-the-back refusal
 * would be untested while reading green. Copied rather than shared for the
 * reason the others state: the day one suite needs different behaviour the
 * rest must not silently inherit it. */
globalThis.THREE = {
  Vector3: class {
    constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
    normalize() {
      const L = Math.hypot(this.x, this.y, this.z) || 1;
      this.x /= L; this.y /= L; this.z /= L;
      return this;
    }
    dot(o) { return this.x * o.x + this.y * o.y + this.z * o.z; }
  },
};

const {
  seasonGlyphs, seasonGlyphAtPoint, buildSeasonMeshPoints,
} = await import('../map/season-mesh.js');
const { parseHurdat2 } = await import('../lib/hurdat.js');
const { stormFacts } = await import('../lib/season-facts.js');
const { SEASONS, DIVE } = await import('../config/constants.js');
const { SIZE } = await import('../config/tokens.js');
const { lonLatToVec3 } = await import('../lib/geo.js');

const REACH = parseInt(SIZE.touchTarget, 10) / 2;

/* --- real storms ------------------------------------------------------------ */

function seasonStorms(basin, year) {
  const dir = join(ROOT, 'seasons/data');
  const file = readdirSync(dir).find(
    (f) => f.startsWith(`${basin}-${year}`) && f.endsWith('.txt')
  );
  if (!file) return null;
  return parseHurdat2(readFileSync(join(dir, file), 'utf8'))?.storms || null;
}

const atl2005 = seasonStorms('atlantic', 2005);
ok('the 2005 Atlantic file is in the repo and parses', Array.isArray(atl2005) && atl2005.length > 0);

const entries = (atl2005 || []).map((storm) => ({ storm, facts: stormFacts(storm) }));

/* --- the stand-in globe ------------------------------------------------------
 * Orthographic: a direction on the unit sphere, rotated so the map's centre
 * faces the viewer, then its x/y scaled to pixels. Anything on the far side
 * still gets a screen point — which is the whole reason the facing test exists,
 * and this stand-in reproduces that faithfully rather than hiding it.
 * -------------------------------------------------------------------------- */

const PX_PER_RADIUS = 400;
const SCREEN = { w: 390, h: 844 };

function makeMap(centre, zoom) {
  const c = lonLatToVec3(centre.lng, centre.lat, 1).normalize();
  /* An east-pointing and a north-pointing axis at the centre, so the
   * projection is a rotation rather than a raw x/y read (which would collapse
   * at the poles and quietly make half the assertions meaningless). */
  const east = new THREE.Vector3(Math.cos(centre.lng * Math.PI / 180), 0,
    -Math.sin(centre.lng * Math.PI / 180)).normalize();
  const north = new THREE.Vector3(
    c.y * east.z - c.z * east.y,
    c.z * east.x - c.x * east.z,
    c.x * east.y - c.y * east.x
  ).normalize();
  return {
    getZoom: () => zoom,
    getCenter: () => centre,
    project: ([lon, lat]) => {
      const v = lonLatToVec3(lon, lat, 1).normalize();
      return {
        x: SCREEN.w / 2 + v.dot(east) * PX_PER_RADIUS,
        y: SCREEN.h / 2 - v.dot(north) * PX_PER_RADIUS,
      };
    },
  };
}

/** The zoom for a given dive phase, so the tests name a PHASE and never a
 *  magic zoom number that would go stale if the band moved. */
const zoomAtPhase = (p) => DIVE.zSpace + p * (DIVE.zHandoff - DIVE.zSpace);

const FLOOR = zoomAtPhase(0);

/* --- the mark and its target are one decision -------------------------------- */

const glyphs = seasonGlyphs(entries);

eq('every drawn storm gets exactly one glyph', glyphs.length, entries.length);

ok('and every glyph names a storm',
  glyphs.every((g) => typeof g.id === 'string' && g.id.length > 0));

ok('no two glyphs claim the same storm',
  new Set(glyphs.map((g) => g.id)).size === glyphs.length);

/* ==> THE LOAD-BEARING ONE. <== The ridge marks its head point with `head:
 * true` and puts it at a direction; the glyph list puts a tap target at a
 * longitude and latitude. These must be the same place. Compared as vectors
 * because that is the only form both sides speak. */
{
  const ridge = buildSeasonMeshPoints(entries);
  const heads = ridge.filter((p) => p.head);
  eq('the ridge stamps one head per drawn storm', heads.length, entries.length);

  let worst = 0;
  for (let i = 0; i < heads.length; i++) {
    const want = lonLatToVec3(glyphs[i].lon, glyphs[i].lat, 1).normalize();
    const got = heads[i].dir;
    worst = Math.max(worst, Math.hypot(got.x - want.x, got.y - want.y, got.z - want.z));
  }
  ok(`the tap target sits exactly where the mark is drawn (worst gap ${worst})`,
    worst < 1e-12);
}

/* --- a tap on a glyph opens that storm --------------------------------------- */

{
  /* Katrina if the record has her, otherwise the first storm — the assertion
   * is about the mechanism, not about who. */
  const target = glyphs.find((g) => g.id.toLowerCase().includes('al12')) || glyphs[0];
  const map = makeMap({ lng: target.lon, lat: target.lat }, FLOOR);
  const p = map.project([target.lon, target.lat]);

  eq('a tap dead on a glyph opens that storm',
    seasonGlyphAtPoint(map, p, glyphs), target.id);

  eq('and a tap a few pixels off still does — the target is a finger, not a point',
    seasonGlyphAtPoint(map, { x: p.x + 8, y: p.y + 8 }, glyphs), target.id);

  /* ==> ONE GLYPH, NOT THE WHOLE SEASON, AND THE FIRST VERSION OF THIS
   * ASSERTION FAILED BECAUSE OF IT. <== 2005 is busy enough that a tap a
   * touch target away from Katrina lands inside ANOTHER storm's reach — which
   * is the arbitration working, not the reach failing. The reach is a fact
   * about one mark and is tested against one mark. */
  eq('a tap a whole touch target away does not',
    seasonGlyphAtPoint(map, { x: p.x + REACH * 2 + 5, y: p.y }, [target]), null);
}

/* --- the far side of the planet is refused ------------------------------------ */

{
  /* One storm, and the camera pointed at its ANTIPODE. It is round the back;
   * the stand-in projects it to a screen point regardless, exactly as MapLibre
   * does, and the facing test is the only thing standing between that and a
   * tap on empty ocean opening a storm the reader cannot see. */
  const g = glyphs[0];
  const anti = { lng: g.lon + 180, lat: -g.lat };
  const map = makeMap(anti, FLOOR);
  const p = map.project([g.lon, g.lat]);

  ok('MapLibre would happily project a point on the far side (the stand-in does)',
    Number.isFinite(p.x) && Number.isFinite(p.y));

  eq('  and a tap right on it opens nothing',
    seasonGlyphAtPoint(map, p, [g]), null);

  /* And the near side of the same storm still answers, so the refusal above is
   * the facing test rather than the whole feature being switched off. */
  const front = makeMap({ lng: g.lon, lat: g.lat }, FLOOR);
  eq('  while the same storm face-on still answers',
    seasonGlyphAtPoint(front, front.project([g.lon, g.lat]), [g]), g.id);
}

{
  /* The threshold is a cap a little SMALLER than a hemisphere, because a
   * camera at a finite distance cannot see all the way to 90°. A storm exactly
   * on the rim must be refused, or the app would answer taps on a sliver that
   * is geometrically behind the limb. */
  ok('the facing floor is inside a hemisphere, not at it',
    SEASONS.glyphFacingMin > 0 && SEASONS.glyphFacingMin < 1);

  const g = { id: 'rim', lon: 0, lat: 0 };
  /* Just past the horizon: an angle whose cosine is under the floor. */
  const past = Math.acos(SEASONS.glyphFacingMin) * 180 / Math.PI + 1;
  const map = makeMap({ lng: past, lat: 0 }, FLOOR);
  eq('a storm just past the horizon is refused',
    seasonGlyphAtPoint(map, map.project([g.lon, g.lat]), [g]), null);

  const inside = Math.acos(SEASONS.glyphFacingMin) * 180 / Math.PI - 1;
  const map2 = makeMap({ lng: inside, lat: 0 }, FLOOR);
  eq('  and one just inside it is not',
    seasonGlyphAtPoint(map2, map2.project([g.lon, g.lat]), [g]), 'rim');
}

/* --- the glyph and the track do not fight ------------------------------------ */

{
  const g = glyphs[0];
  const centre = { lng: g.lon, lat: g.lat };

  const atFloor = makeMap(centre, FLOOR);
  eq('at the space floor the glyph answers',
    seasonGlyphAtPoint(atFloor, atFloor.project([g.lon, g.lat]), [g]), g.id);

  const atEdge = makeMap(centre, zoomAtPhase(SEASONS.glyphTapMaxPhase));
  eq('  it still answers at the last phase it is at full strength',
    seasonGlyphAtPoint(atEdge, atEdge.project([g.lon, g.lat]), [g]), g.id);

  const past = makeMap(centre, zoomAtPhase(SEASONS.glyphTapMaxPhase + 0.01));
  eq('  and stops the moment it starts fading, so the track owns closer zooms',
    seasonGlyphAtPoint(past, past.project([g.lon, g.lat]), [g]), null);

  const wayIn = makeMap(centre, DIVE.zHandoff);
  eq('  and is long gone once MapLibre owns the screen',
    seasonGlyphAtPoint(wayIn, wayIn.project([g.lon, g.lat]), [g]), null);
}

/* ==> AND THE CEILING IS READ OFF THE FADE RATHER THAN TYPED. <== Two numbers
 * kept in step by hand drift, and the symptom is a glyph at full strength that
 * will not answer a tap — which reads as a broken app. */
eq('the tap ceiling is the near end of the glyph fade, not a second number',
  SEASONS.glyphTapMaxPhase, DIVE.fade.nodes[0]);

/* --- nearest wins ------------------------------------------------------------ */

{
  /* Two storms whose first fixes are a thumb's width apart. First-found would
   * return whichever the roster happened to list first; the reader aimed at
   * the nearer one. */
  const a = { id: 'near', lon: 0, lat: 0 };
  const map = makeMap({ lng: 0, lat: 0 }, FLOOR);
  const pa = map.project([0, 0]);

  /* Find a longitude offset that lands ~15 px away on the stand-in. */
  let bLon = 0;
  for (let d = 0.1; d < 20; d += 0.05) {
    const p = map.project([d, 0]);
    if (Math.hypot(p.x - pa.x, p.y - pa.y) >= 15) { bLon = d; break; }
  }
  ok('the stand-in can place a second glyph a thumb away', bLon > 0);
  const b = { id: 'far', lon: bLon, lat: 0 };

  const between = map.project([bLon * 0.6, 0]);
  eq('a tap between two glyphs takes the nearer, whatever order they arrive in',
    seasonGlyphAtPoint(map, between, [a, b]), 'far');
  eq('  and the same tap gives the same answer with the list reversed',
    seasonGlyphAtPoint(map, between, [b, a]), 'far');

  const nearer = map.project([bLon * 0.2, 0]);
  eq('a tap nearer the first takes the first',
    seasonGlyphAtPoint(map, nearer, [a, b]), 'near');
}

/* --- nothing drawn, nothing hit ---------------------------------------------- */

{
  const map = makeMap({ lng: 0, lat: 0 }, FLOOR);
  eq('an empty archive answers no tap', seasonGlyphAtPoint(map, { x: 10, y: 10 }, []), null);
  eq('  nor does a missing list', seasonGlyphAtPoint(map, { x: 10, y: 10 }, null), null);
  eq('  nor a missing map', seasonGlyphAtPoint(null, { x: 10, y: 10 }, glyphs), null);
}

eq('a storm with no usable fix contributes no glyph rather than a broken one',
  seasonGlyphs([{ storm: { id: 'empty', points: [] } }]).length, 0);

eq('  and one whose rows carry no position is dropped the same way',
  seasonGlyphs([{ storm: { id: 'nan', points: [{ lat: null, lon: null, time: 1 }] } }]).length, 0);

/* --- the glyph is the FIRST fix, and first means oldest ----------------------- */

{
  /* Rows handed over newest-first. The parser emits file order and nothing
   * downstream promises it; the glyph must still land on the opening fix. */
  const storm = {
    id: 'order',
    points: [
      { lat: 30, lon: -60, time: 2000, windKt: 90 },
      { lat: 20, lon: -50, time: 1000, windKt: 35 },
    ],
  };
  const out = seasonGlyphs([{ storm }]);
  eq('the glyph goes on the oldest fix even when the rows arrive backwards',
    out[0]?.lon, -50);
}

/* --- the exported way in exists ---------------------------------------------- */

{
  /* ==> A FILE READ, AND IT IS THE RIGHT INSTRUMENT HERE. <== Everything above
   * passes just as happily against a hit-test nothing calls — which is exactly
   * how push 1 of this feature shipped green (§57.21c). The wiring is the
   * thing most likely to be missing, and it cannot be exercised without a
   * browser, so it is asserted as text. */
  const mainJs = readFileSync(join(ROOT, 'main.js'), 'utf8');

  /* ==> THE CALL, NOT THE NAME, AND THE FIRST VERSION OF THIS SURVIVED A
   * MUTATION BECAUSE OF IT. <== Asserting `indexOf('seasonGlyphAtPoint')`
   * matched the word inside the comment that explains the branch, so
   * commenting the call out left the suite green — a test passing on the same
   * wrong assumption as the bug, which §12 calls worse than no test. Both
   * halves now match an actual invocation with its actual arguments.
   *
   * ==> AND THAT WAS ONLY HALF THE FIX, WHICH §57.21e FOUND BY RE-RUNNING THE
   * MUTATION. <== Arguments and all, `// openSeasonStormNow(glyphId);` still
   * matches — a commented-out call is the same text as a live one. So the
   * comments come OFF before anything is read, and the assertions below are
   * about code rather than about prose. Block comments first, then line
   * comments, so a `//` inside a block cannot orphan the rest of the file. */
  const mainCode = mainJs
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');

  ok('the comment strip left real code behind to assert against',
    mainCode.includes("map.on('click'") && mainCode.length > 1000);

  const glyphCall = mainCode.indexOf('seasonGlyphAtPoint(map, e.point, seasonGlyphList)');
  const trackCall = mainCode.indexOf('seasonStormAtPoint(map, e.point)');
  ok('main.js actually calls the glyph hit-test', glyphCall > 0);
  ok('  and calls it BEFORE the track hit-test',
    glyphCall > 0 && trackCall > 0 && glyphCall < trackCall);
  ok('  and opens the storm rather than merely focusing it',
    /openSeasonStormNow\(glyphId\)/.test(mainCode));

  ok('main.js keeps the glyph list current from setTracks',
    /seasonGlyphList\s*=\s*seasonGlyphs\(selected\)/.test(mainCode));

  ok('and empties it with the ridge, so a stale list cannot answer a tap',
    /seasonGlyphList\s*=\s*\[\]/.test(mainCode));

  const seasonsIdx = readFileSync(join(ROOT, 'seasons/index.js'), 'utf8');
  ok('seasons/index.js exports the way in',
    /export function openSeasonStorm\(/.test(seasonsIdx));

  /* ==> ONE FUNCTION, NOT TWO THAT LOOK ALIKE. <== The chevron and the glyph
   * must run the same body or they will drift. Asserted by counting the
   * callers of the hoisted function rather than by reading either call site. */
  const calls = (seasonsIdx.match(/openStormNow\(/g) || []).length;
  ok(`the chevron and the glyph share one open-a-storm body (${calls} call sites)`,
    calls >= 2 && /function openStormNow\(/.test(seasonsIdx));
}

/* --- the keyboard path ------------------------------------------------------- */

{
  /* §13: a gesture-only way to open a storm is a bug, not a limitation. The
   * keyboard road is Enter on a ticked roster row, which predates this work —
   * asserted here rather than assumed, because this is the pass that makes the
   * gesture exist and therefore the pass that owes the other two paths. */
  const board = readFileSync(join(ROOT, 'ui/view-seasons-board.js'), 'utf8')
    + readFileSync(join(ROOT, 'ui/seasons-board-markup.js'), 'utf8');
  ok('the roster still has a keyboard way to open a storm',
    /onOpenStorm/.test(board));
}

/* --- report ------------------------------------------------------------------ */

console.log(`\ntest-season-glyph-tap: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL  ${f}`);
process.exit(fails.length ? 1 : 0);
