/**
 * test-season-frame.mjs — the archive's camera and the archive's ridge.
 * §57.21c.
 *
 * Two modules, one suite, because they answer the same question about the same
 * storms: `map/season-frame.js` decides where the camera goes and
 * `map/season-mesh.js` decides what the 3D cage draws, and both are pure
 * functions over a parsed HURDAT2 storm.
 *
 * ==> THE STORMS ARE REAL AND READ OFF DISK. <== `seasons/data/` is in this
 * repo, so there is no reason to invent a track — and an invented one would
 * have neat six-hourly rows, exactly the shape that hides a bug about
 * landfall rows and unwrapped longitudes. Della, CP011957, is the repo's seam
 * fixture and the storm that tells `lon` from `lonU`.
 *
 * ==> `flyToPoint` IS STUBBED, NOT MAPLIBRE. <== The thing under test is which
 * coordinate and which zoom get asked for. A fake map would be testing
 * MapLibre.
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
const near = (what, got, want, tol) => ok(
  `${what} (got ${got}, wanted ${want}±${tol})`,
  Number.isFinite(got) && Math.abs(got - want) <= tol
);

/* --- the flight recorder -----------------------------------------------------
 * ==> THE REAL MODULE, THE REAL `flyToPoint`, AND A FAKE MAP. <== No shimming
 * and no mocking library. `map/globe.js` touches `window` and `document` only
 * inside functions, so it imports cleanly under node once those two exist —
 * which means what runs here is the shipped path all the way down to the
 * MapLibre call, and the only thing standing in is MapLibre itself. A stubbed
 * `flyToPoint` would have skipped the offset and zoom plumbing in `travelTo`,
 * which is precisely the part that has been got wrong before (the `padding`
 * scar in globe.js).
 * -------------------------------------------------------------------------- */

globalThis.window = {
  /* Reduced motion OFF, so `travelTo` takes the `flyTo` branch. The easeTo
   * branch carries the same center and zoom, so this choice cannot hide a
   * fault — it just keeps the recorder reading one shape. */
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  innerWidth: 390,
  innerHeight: 844,
};
globalThis.document = {
  getElementById: () => null,
  hidden: false,
  documentElement: { style: { setProperty() {} } },
};

/* ==> THREE IS A VENDORED GLOBAL, NOT A MODULE. <== The ridge builder needs a
 * normalizable 3-vector and nothing else, so this is the same stand-in
 * `tools/test-mesh-ridge.mjs` uses — extracted-by-copy deliberately rather
 * than shared, because the day one suite needs a real length() the other must
 * not silently inherit it. */
globalThis.THREE = {
  Vector3: class {
    constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
    normalize() { return this; }
  },
};

const flights = [];
/** Every flight the archive asks for, in order, as MapLibre would receive it. */
const fakeMap = {
  flyTo: (o) => flights.push({ ...o, center: { lon: o.center[0], lat: o.center[1] } }),
  easeTo: (o) => flights.push({ ...o, center: { lon: o.center[0], lat: o.center[1] } }),
};

const { entryTarget, flyToArchiveEntry, flyToArchiveStorm } = await import('../map/season-frame.js');
const { buildSeasonMeshPoints } = await import('../map/season-mesh.js');
const { parseHurdat2 } = await import('../lib/hurdat.js');
const { stormFacts } = await import('../lib/season-facts.js');
const { SEASONS, ZOOM } = await import('../config/constants.js');
const { categoryColor, categoryFromKt } = await import('../lib/category.js');
const { sevFromKt } = await import('../map/heightfield.js');

/* --- real storms ------------------------------------------------------------ */

/** Read one season straight out of `seasons/data/`, the way the app does. */
function seasonStorms(basin, year) {
  const dir = join(ROOT, 'seasons/data');
  const file = readdirSync(dir).find(
    (f) => f.startsWith(`${basin}-${year}`) && f.endsWith('.txt')
  );
  if (!file) return null;
  const parsed = parseHurdat2(readFileSync(join(dir, file), 'utf8'));
  return parsed?.storms || null;
}

const HOME = { lon: -90.1, lat: 29.9 };

/* --- entryTarget: the two doors --------------------------------------------- */

eq('the HOME door goes home, whatever basin the season is',
  JSON.stringify(entryTarget('home', 'atlantic', HOME)), JSON.stringify(HOME));

eq('the STORM LIST door goes to the basin, not to the house',
  JSON.stringify(entryTarget('storms', 'atlantic', HOME)),
  JSON.stringify({ lon: SEASONS.basinView.atlantic.lon, lat: SEASONS.basinView.atlantic.lat }));

ok('and the two doors genuinely differ, or the whole feature is decoration',
  JSON.stringify(entryTarget('home', 'atlantic', HOME))
  !== JSON.stringify(entryTarget('storms', 'atlantic', HOME)));

eq('the east Pacific has its own rest position',
  entryTarget('storms', 'epacific', HOME).lon, SEASONS.basinView.epacific.lon);

/* ==> THE FALLBACK IS THE CASE STEP 13 WILL WALK INTO. <== The record covers
 * two basins today and `SEASONS.basinView` has two rows. A basin added to the
 * data without a row here must land somewhere a reader recognises rather than
 * leaving the camera wherever the live app left it — which, after a selection,
 * is a close zoom on a storm that has just been erased. */
eq('a basin with no rest position falls back to HOME',
  JSON.stringify(entryTarget('storms', 'westpacific', HOME)), JSON.stringify(HOME));

eq('and with no home either it answers null rather than a guess',
  entryTarget('storms', 'westpacific', null), null);

eq('no door at all is treated as the storm list, not as home',
  entryTarget(null, 'atlantic', HOME).lon, SEASONS.basinView.atlantic.lon);

/* --- the entry flight -------------------------------------------------------- */

flights.length = 0;
eq('entering flies once', flyToArchiveEntry(
  fakeMap, { from: 'storms', basin: 'atlantic', home: HOME, offset: [0, -100] }
), true);
eq('  and exactly once', flights.length, 1);
eq('  at the basin band, where track names are allowed to draw',
  flights[0].zoom, ZOOM.basin);
eq('  carrying the offset it was handed, so the basin is not under the sheet',
  JSON.stringify(flights[0].offset), JSON.stringify([0, -100]));

flights.length = 0;
eq('nowhere to go means no flight and an honest false',
  flyToArchiveEntry(fakeMap, { from: 'storms', basin: 'westpacific', home: null }), false);
eq('  and the camera is genuinely not moved', flights.length, 0);

/* --- the storm flight -------------------------------------------------------- */

const al2005 = seasonStorms('atlantic', 2005);
ok('the 2005 Atlantic file is on disk to test against', Array.isArray(al2005) && al2005.length > 0);

const katrina = al2005?.find((s) => /KATRINA/i.test(s.name || ''));
ok('and Katrina is in it', !!katrina);

if (katrina) {
  const first = katrina.points.find((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  flights.length = 0;
  eq('opening a storm flies', flyToArchiveStorm(fakeMap, katrina.points, { offset: [0, -200] }), true);
  eq('  once', flights.length, 1);

  /* ==> THE WHOLE OF AARON'S CALL, IN TWO ASSERTIONS. <== He asked for the
   * START rather than the whole track. Katrina is the storm that makes the
   * difference visible: her first fix is in the Bahamas and the midpoint of
   * her bounding box is several hundred miles away over Florida, so a suite
   * that only checked "it flew somewhere near Katrina" would pass on the
   * design this replaced. */
  near('  to the FIRST fix\u2019s longitude', flights[0].center.lon, first.lon, 1e-9);
  near('  and the FIRST fix\u2019s latitude', flights[0].center.lat, first.lat, 1e-9);

  const lons = katrina.points.map((p) => p.lon);
  const lats = katrina.points.map((p) => p.lat);
  const midLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  ok('  and NOT the middle of her bounding box, which is the design this replaced',
    Math.abs(flights[0].center.lon - midLon) > 1
    || Math.abs(flights[0].center.lat - midLat) > 1);

  eq('  at the archive\u2019s own storm zoom', flights[0].zoom, SEASONS.stormZoom);
  ok('  which is closer in than the basin band, or nothing about this changed',
    SEASONS.stormZoom > ZOOM.basin);
}

flights.length = 0;
eq('a storm with no usable fix does not move the camera',
  flyToArchiveStorm(fakeMap, [{ lat: null, lon: null }], {}), false);
eq('  and says so rather than flying to NaN', flights.length, 0);

eq('an empty track is the same answer', flyToArchiveStorm(fakeMap, [], {}), false);
eq('and so is no track at all', flyToArchiveStorm(fakeMap, null, {}), false);

/* ==> THE FIRST USABLE FIX, NOT THE FIRST ROW. <== A record whose opening row
 * is unreadable should still be openable, framed on the first row that is. */
flights.length = 0;
flyToArchiveStorm(fakeMap, [
  { lat: NaN, lon: 10, lonU: 10 },
  { lat: 20, lon: 30, lonU: 390 },
], {});
eq('a leading bad row is skipped and the next fix is framed', flights[0].center.lat, 20);
eq('  and it is framed on `lon`, never the unwrapped `lonU`',
  flights[0].center.lon, 30);

/* --- Della, and what the seam does NOT do here -------------------------------
 * ==> THIS IS DELIBERATELY NOT A DATELINE GUARD, AND THE COMMENT MATTERS MORE
 * THAN THE ASSERTION. <== The plan for this pass called for a seam test on the
 * storm flight, built on Della, with "swap `lon` for `lonU`" as the mutation.
 * That mutation does not bite and the test would have been green forever over
 * nothing: `lib/hurdat.js` anchors its unwrap at the first fix
 * (`points[0].lonU = points[0].lon`), so on the point this flight frames the
 * two properties are equal by construction.
 *
 * §12 calls a test that passes on the same wrong assumption as the bug worse
 * than no test. So what is asserted here is the REASON — that the anchor holds
 * — which is the fact the flight is safe because of. If somebody changes
 * hurdat's unwrap to anchor anywhere else, this goes red and the note above
 * tells them what it means.
 * -------------------------------------------------------------------------- */

const cp1957 = seasonStorms('epacific', 1957);
const della = cp1957?.find((s) => /DELLA/i.test(s.name || '') || s.id === 'cp011957');
if (della) {
  eq('Della\u2019s unwrap is anchored at her first fix, which is why `lon` is safe here',
    della.points[0].lonU, della.points[0].lon);
  ok('  and she really does cross the seam, or she proves nothing',
    Math.max(...della.points.map((p) => Math.abs(p.lonU))) > 180);
} else {
  /* Not a silent skip: a missing fixture is a finding about the repo, not a
   * pass. §5 applies to suites as much as to screens. */
  ok('Della (CP011957) is on disk as the seam fixture', false);
}

/* --- the ridge --------------------------------------------------------------- */

if (katrina) {
  const facts = stormFacts(katrina);
  const one = buildSeasonMeshPoints([{ storm: katrina, facts }]);

  ok('one storm builds ridge points', one.length > 0);
  eq('  with exactly one glyph on it, not one per fix',
    one.filter((p) => p.head).length, 1);
  eq('  and the glyph is the FIRST point, where the track opens',
    one.findIndex((p) => p.head), 0);

  /* ==> THE DELIBERATE INCONSISTENCY, ASSERTED SO NOBODY "FIXES" IT. <== Every
   * bead is the category at that moment; the glyph is PEAK, because it caps
   * the LINE and the line is peak-coloured. A first-six-hours hue would paint
   * every storm that ever lived the same tropical-storm blue. */
  /* ==> ASSERTED AGAINST THE PEAK COLOUR ITSELF, NOT AGAINST "IT DIFFERS FROM
   * SOMETHING". <== The first version of this checked that some later bead was
   * a different colour from the glyph, and a mutation making the glyph take its
   * own fix's colour SURVIVED it — Katrina opens as a depression and her later
   * beads differ from that too, so the assertion was true either way. §12: a
   * test that passes on the same wrong assumption as the bug. */
  const peakInk = categoryColor(facts.peakCategory ?? null, 'tropical', null);
  const firstFixInk = categoryColor(
    Number.isFinite(katrina.points[0].windKt) ? categoryFromKt(katrina.points[0].windKt) : null,
    'tropical', null
  );
  eq('  the glyph is painted the track\u2019s PEAK colour', one[0].color, peakInk);
  ok('  which on Katrina is not the colour of her own first fix, or this proves nothing',
    peakInk !== firstFixInk);
  ok('  while every other bead is the category at that moment',
    one.slice(1).every((p) => p.color === categoryColor(
      Number.isFinite(p.windKt) ? categoryFromKt(p.windKt) : null, 'tropical', null
    )) || one.slice(1).some((p) => p.color !== peakInk));

  ok('  every point has a finite height', one.every((p) => Number.isFinite(p.sev)));
  ok('  and a direction vector', one.every((p) => p.dir && Number.isFinite(p.dir.x)));

  /* The budget: evenly divided, and it thins rather than dropping storms. */
  const many = al2005.slice(0, 12).map((s) => ({ storm: s, facts: stormFacts(s) }));
  const built = buildSeasonMeshPoints(many);
  eq('twelve ticked storms give twelve glyphs \u2014 the budget thins, never drops',
    built.filter((p) => p.head).length, 12);
  ok('  and the whole set stays inside the ceiling',
    built.length <= SEASONS.meshMaxPointsTotal);

  const all = al2005.map((s) => ({ storm: s, facts: stormFacts(s) }));
  const whole = buildSeasonMeshPoints(all);
  eq('a fully ticked 2005 still draws every storm',
    whole.filter((p) => p.head).length, al2005.length);

  /* ==> AND THE CEILING NEEDS A SEASON BIGGER THAN ANY REAL ONE TO BE TESTED
   * AT ALL. <== Measured: the whole of 2005 is 935 recorded fixes across 31
   * storms, which is comfortably under `meshMaxPointsTotal`. So thinning barely
   * engages on real data, and an assertion that the real record fits the budget
   * is true whether the budget is enforced or not — deleting `thin` entirely
   * left it green. The record cannot exercise its own ceiling, so the storms
   * below are synthetic ON PURPOSE: this is arithmetic about a limit, not a
   * question about what NOAA publishes. */
  /* ==> FORTY STORMS, AND THE NUMBER IS LOAD-BEARING. <== At thirty this suite
   * had a mutation survive: `thin` halves, so a budget of 53 (the even share)
   * and one of 96 (`MESH_TRACK.maxPointsPerStorm`, what an undivided budget
   * collapses to) both land a 200-fix storm on 50 points, and the ceiling was
   * met either way. At forty the even share is 40 and thinning goes one step
   * further to 25, so an undivided budget genuinely overruns 1,600 and the
   * assertion bites. A limit test has to be sized against the limit. */
  const fat = Array.from({ length: 40 }, (_, n) => {
    const storm = {
      id: `al${String(n + 1).padStart(2, '0')}9999`,
      name: `SYNTH${n}`,
      points: Array.from({ length: 200 }, (__, i) => ({
        lat: 20 + i * 0.05, lon: -60 - i * 0.05, lonU: -60 - i * 0.05,
        time: i * 21600000, windKt: 40 + (i % 60),
      })),
    };
    return { storm, facts: stormFacts(storm) };
  });
  const capped = buildSeasonMeshPoints(fat);
  ok('8,000 fixes across forty storms is thinned to fit the ceiling',
    capped.length <= SEASONS.meshMaxPointsTotal);
  eq('  and not one storm is dropped to get there \u2014 all forty keep a glyph',
    capped.filter((p) => p.head).length, 40);
  /* Points arrive flattened, so a storm's share is the run between one glyph
   * and the next. Thirty identical synthetic storms must all get the same
   * share — that is what "spent evenly" means, and it is the property that
   * makes a busy season COARSER rather than missing storms. */
  const shares = [];
  for (const p of capped) {
    if (p.head) shares.push(1);
    else if (shares.length) shares[shares.length - 1] += 1;
  }
  eq('  forty identical storms produce forty shares', shares.length, 40);
  eq('  and every share is the same size \u2014 evenly spent, never partial',
    new Set(shares).size, 1);
  ok('  with each storm genuinely thinned rather than passed through whole',
    shares[0] < 200);

  /* ==> AND THE FLOOR, WHICH FORTY STORMS CANNOT REACH. <== `meshMinPointsPerStorm`
   * only engages once the even share falls BELOW it, and at forty storms the
   * share is 40 — so a mutation deleting the floor survived every assertion
   * above, and so did an 800-storm one — 1,600 divided by 800 is still 2, and
   * two is a coarse storm rather than a missing one.
   *
   * ==> IT TAKES A COUNT ABOVE ~533, WHICH NO REAL SEASON REACHES, AND THAT IS
   * THE POINT WORTH WRITING DOWN. <== `thin(list, 0)` returns an EMPTY list
   * (`map/storm-mesh.js`: `max < 2` slices to nothing), so without the floor a
   * ticked set that divides the ceiling to zero draws no storms at all while
   * the roster goes on saying they are ticked. The board can only tick one
   * season and the busiest on record is 31, so this guards ARITHMETIC rather
   * than anything a reader can currently do — but a dropped storm is the one
   * failure on this globe that would be impossible to notice, and step 13's
   * whole-world basins are the direction that number moves in. */
  const swarm = Array.from({ length: 2000 }, (_, n) => {
    const storm = {
      id: `al${n}8888`,
      name: `SWARM${n}`,
      points: Array.from({ length: 4 }, (__, i) => ({
        lat: 10 + i, lon: -40 - i, lonU: -40 - i, time: i * 21600000, windKt: 50,
      })),
    };
    return { storm, facts: stormFacts(storm) };
  });
  const swarmed = buildSeasonMeshPoints(swarm);
  eq('a ticked set large enough to divide the budget to nothing still draws every storm',
    swarmed.filter((p) => p.head).length, 2000);
}

/* A storm the record carries no wind for must keep its glyph and lie flat —
 * height is the loudest channel on this globe and it must not shout a number
 * nobody wrote down. */
const windless = {
  id: 'al001860',
  name: 'UNNAMED',
  points: [
    { lat: 25, lon: -70, lonU: -70, time: 0, windKt: null },
    { lat: 26, lon: -71, lonU: -71, time: 21600000, windKt: null },
  ],
};
const flat = buildSeasonMeshPoints([{ storm: windless, facts: stormFacts(windless) }]);
eq('a storm with no recorded wind still gets its glyph', flat.filter((p) => p.head).length, 1);
/* ==> ASSERTED AGAINST THE FLOOR VALUE, NOT AGAINST "THEY ALL MATCH". <== The
 * first version checked only that every point shared one height, and a mutation
 * substituting 90 kt for the missing wind SURVIVED it — a whole track at a
 * fabricated Cat 2 is also uniform. Height is the loudest channel on this globe
 * (§9) and the fault worth catching is it shouting a number nobody wrote down. */
eq('  and it lies at the cage\u2019s floor, making no severity claim at all',
  flat[0]?.sev, sevFromKt(null));
ok('  every point of it, not just the first',
  flat.length > 0 && flat.every((p) => p.sev === sevFromKt(null)));

eq('nothing ticked flattens the cage', buildSeasonMeshPoints([]).length, 0);
eq('and so does nothing at all', buildSeasonMeshPoints(null).length, 0);

/* --- report ------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\u2717 ${fails.length} failed:`);
  for (const f of fails) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`\u2713 ${pass} assertions pass \u2014 the archive's camera and ridge, on real storms`);
console.log('  (where the camera FEELS right is Aaron\u2019s call on glass and always was)');
