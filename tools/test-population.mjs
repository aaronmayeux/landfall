/**
 * test-population.mjs — the in-path headcount and the shipped town list.
 *
 * Zero dependencies, node only. Run: node tools/test-population.mjs
 *
 * WHAT THIS CAN AND CANNOT COVER. The counting is pure arithmetic over
 * geometry, so it tests properly and thoroughly. The heat layer is a MapLibre
 * paint spec — no assertions here reach it, for the same reason the model
 * tracks and advisory suites stop at the data boundary: a browser test needs
 * the toolchain this project refuses. The layer is confirmed on glass.
 */

import { readFileSync } from 'node:fs';
import { peopleInFeatures, peopleInPhases, formatPeople } from '../lib/population-count.js';
import { FUTURE_SLOTS } from '../lib/future-slots.js';
import { POPULATION } from '../config/constants.js';
import { DARK, LIGHT } from '../config/tokens.js';

let pass = 0;
let fail = 0;

function ok(cond, label) {
  if (cond) { pass += 1; } else { fail += 1; console.error(`  FAIL  ${label}`); }
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} — got ${actual}, want ${expected}`);
}

/** A closed square ring, counter-clockwise. */
const square = (minLon, minLat, maxLon, maxLat) => [
  [minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat],
];

const poly = (rings) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: rings } });

/* --- the basics --------------------------------------------------------- */

{
  const towns = [0, 0, 5000, 10, 10, 1000, -5, -5, 250];
  const box = poly([square(-1, -1, 1, 1)]);
  const r = peopleInFeatures(towns, [box]);
  eq(r.people, 5000, 'one town inside a square');
  eq(r.towns, 1, 'one town counted');
}

{
  const towns = [0, 0, 5000];
  eq(peopleInFeatures(towns, [poly([square(10, 10, 20, 20)])]).people, 0,
    'town outside the shape counts nobody');
}

{
  /* A MEASURED ZERO IS NOT AN ERROR. Open ocean genuinely has nobody in it,
   * and the caller must be able to tell that from "we could not count". */
  const r = peopleInFeatures([0, 0, 5000], [poly([square(40, 40, 50, 50)])]);
  ok(r !== null, 'empty result is an object, not null');
  eq(r.people, 0, 'measured zero is zero');
}

{
  /* NO TOWN LIST IS `unavailable` AND MUST BE null, NOT ZERO. This is the
   * single most important distinction in the file: a failed download reported
   * as "0 people in the path" during a landfall is a safety-adjacent lie. */
  eq(peopleInFeatures(null, [poly([square(-1, -1, 1, 1)])]), null,
    'null towns returns null');
  eq(peopleInFeatures([], [poly([square(-1, -1, 1, 1)])]), null,
    'empty towns returns null');
}

{
  eq(peopleInFeatures([0, 0, 5000], []).people, 0, 'no features counts nobody');
  eq(peopleInFeatures([0, 0, 5000], [{ type: 'Feature', geometry: null }]).people, 0,
    'a feature with no geometry is skipped, not thrown on');
  eq(
    peopleInFeatures([0, 0, 5000], [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    }]).people,
    0,
    'a non-polygon is ignored rather than misread'
  );
}

/* --- holes -------------------------------------------------------------- */

{
  const towns = [0, 0, 5000, 3, 3, 700];
  const withHole = poly([square(-5, -5, 5, 5), square(-1, -1, 1, 1)]);
  const r = peopleInFeatures(towns, [withHole]);
  eq(r.people, 700, 'a town inside a hole is not counted');
  eq(r.towns, 1, 'only the town in the solid part counts');
}

/* --- MultiPolygon and overlap ------------------------------------------- */

{
  const mp = {
    type: 'Feature',
    geometry: {
      type: 'MultiPolygon',
      coordinates: [[square(-2, -2, 2, 2)], [square(10, 10, 14, 14)]],
    },
  };
  const r = peopleInFeatures([0, 0, 100, 12, 12, 50, 50, 50, 9], [mp]);
  eq(r.people, 150, 'both parts of a MultiPolygon count');
  eq(r.towns, 2, 'and only those two');
}

{
  /* ==> A TOWN UNDER TWO OVERLAPPING RINGS IS ONE TOWN. <== The wind swath is
   * a union of overlapping circles by construction, so this is the normal
   * case, not an edge case. Counting it twice would inflate every landfall. */
  const a = poly([square(-2, -2, 2, 2)]);
  const b = poly([square(-1, -1, 3, 3)]);
  const r = peopleInFeatures([0, 0, 1000], [a, b]);
  eq(r.people, 1000, 'overlapping rings do not double count');
  eq(r.towns, 1, 'and report one town');
}

/* --- the antimeridian --------------------------------------------------- */

{
  /* A West Pacific swath crossing 180°. Its ring runs 175 → -175, which a
   * naive bounding box reads as "the whole planet except a sliver". */
  const ring = [
    [175, 10], [-175, 10], [-175, 20], [175, 20], [175, 10],
  ];
  const shape = poly([ring]);
  const r = peopleInFeatures([178, 15, 4000, -178, 15, 6000, 0, 15, 9000], [shape]);
  eq(r.people, 10000, 'both sides of the dateline count');
  eq(r.towns, 2, 'and the town on the far side of the world does not');
}

{
  /* The same shape must not start swallowing the opposite hemisphere. */
  const ring = [[175, 10], [-175, 10], [-175, 20], [175, 20], [175, 10]];
  eq(peopleInFeatures([-90, 15, 500000], [poly([ring])]).people, 0,
    'a dateline shape excludes the Americas');
}

{
  /* An ordinary Atlantic shape and a wrapped Pacific one in the same call —
   * two live storms, which is a normal August. */
  const atlantic = poly([square(-80, 20, -70, 30)]);
  const pacific = poly([[[175, 10], [-175, 10], [-175, 20], [175, 20], [175, 10]]]);
  const r = peopleInFeatures([-75, 25, 300, 178, 15, 700], [atlantic, pacific]);
  eq(r.people, 1000, 'wrapped and unwrapped shapes coexist in one count');
}

/* --- degenerate geometry ------------------------------------------------ */

{
  /* A ring with a horizontal edge exactly at the town's latitude. At two
   * decimal places, towns land on round latitudes constantly. */
  const ring = [[-1, 0], [1, 0], [1, 1], [-1, 1], [-1, 0]];
  const r = peopleInFeatures([0, 0.5, 42], [poly([ring])]);
  ok(Number.isFinite(r.people), 'a horizontal edge does not produce NaN');
  eq(r.people, 42, 'and the town inside still counts');
}

{
  eq(peopleInFeatures([0, 0, 1], [poly([[[0, 0], [1, 1], [0, 0]]])]).people, 0,
    'a ring with too few points is skipped');
}

/* --- formatting --------------------------------------------------------- */

eq(formatPeople(0), '0', 'zero formats as zero');
eq(formatPeople(842), '842', 'under a thousand shows exactly');
eq(formatPeople(4200), '4K', 'thousands round');
eq(formatPeople(4183662), '4.2M', 'millions keep one decimal under ten');
eq(formatPeople(42836620), '43M', 'tens of millions drop the decimal');
eq(formatPeople(3.04e9), '3.0B', 'billions');
eq(formatPeople(-1), null, 'negative is not a headcount');
eq(formatPeople(NaN), null, 'NaN is not a headcount');

/* --- the shipped file --------------------------------------------------- */

{
  const flat = JSON.parse(readFileSync(new URL('../' + POPULATION.url, import.meta.url), 'utf8'));
  ok(Array.isArray(flat), 'town file is an array');
  eq(flat.length % 3, 0, 'town file length is a multiple of three');
  eq(flat.length / 3, POPULATION.expectedTowns, 'town count matches the constant');

  let minPop = Infinity;
  let badCoord = 0;
  let people = 0;
  for (let i = 0; i < flat.length; i += 3) {
    const lon = flat[i];
    const lat = flat[i + 1];
    const pop = flat[i + 2];
    if (pop < minPop) minPop = pop;
    if (!(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90)) badCoord += 1;
    people += pop;
  }
  eq(badCoord, 0, 'every coordinate is on the planet');
  ok(minPop >= POPULATION.minTownPopulation,
    `smallest town is ${minPop}, floor is ${POPULATION.minTownPopulation}`);

  /* ==> THE WORLD TOTAL IS THE PPLX REGRESSION GUARD. <== Sections of cities
   * are already inside their parent's figure; leaving them in added 91 million
   * phantom people, concentrated in dense coastal cities. If a rebuild ever
   * drops that filter this total jumps and this assertion catches it. */
  ok(people > 2.9e9 && people < 3.2e9,
    `world total ${people.toLocaleString()} is inside the expected band`);

  /* And it must stay well UNDER real world population, because the whole
   * honesty story of this feature is that it undercounts. A total near 8
   * billion would mean the list had grown into something it is not. */
  ok(people < 5e9, 'world total is an undercount, as documented');
}

/* --- constants sanity --------------------------------------------------- */

eq(POPULATION.pathSlot, 'windSwath', 'the headcount reads the swath, not the cone');
ok(POPULATION.weightMaxLog > POPULATION.weightMinLog, 'weight range is not inverted');
{
  const t = POPULATION.fadeThresholdLog;
  let mono = true;
  for (let i = 1; i < t.length; i += 1) {
    if (t[i].zoom <= t[i - 1].zoom) mono = false;
    if (t[i].log >= t[i - 1].log) mono = false;
  }
  ok(mono, 'fade thresholds rise in zoom and fall in population');
  ok(POPULATION.fadeWidthLog > 0, 'fade width is a real width');

  /* ==> THE ASSERTION THAT PROTECTS AGAINST THE BUG AARON SAW ON GLASS. <==
   * The filter must never remove a town the fade would have drawn. For each
   * filter range, its population floor has to sit at or below the LOWEST
   * threshold the fade reaches anywhere in that range — otherwise a town in
   * mid-fade gets clipped and reappears in one frame at the next step, which
   * is exactly the pop-in this whole design replaced. */
  const f = POPULATION.filterFloor;
  let safe = true;
  const thresholdAt = (z) => {
    if (z <= t[0].zoom) return t[0].log;
    if (z >= t[t.length - 1].zoom) return t[t.length - 1].log;
    for (let i = 1; i < t.length; i += 1) {
      if (z <= t[i].zoom) {
        const k = (z - t[i - 1].zoom) / (t[i].zoom - t[i - 1].zoom);
        return t[i - 1].log + k * (t[i].log - t[i - 1].log);
      }
    }
    return t[t.length - 1].log;
  };
  for (let i = 0; i < f.length; i += 1) {
    const from = f[i].zoom;
    const to = i + 1 < f.length ? f[i + 1].zoom : 24;
    /* The fade only ever gets LOWER with zoom, so the lowest threshold inside
     * a range is at its far end. Sampled anyway rather than reasoned about —
     * this is the assertion that catches someone reordering the table. */
    let lowest = Infinity;
    for (let z = from; z <= to; z += 0.25) lowest = Math.min(lowest, thresholdAt(z));
    /* No town exists below the file's own floor, so a threshold that dips
     * under it is not a constraint — nothing down there to clip. */
    const binding = Math.max(lowest, Math.log10(POPULATION.minTownPopulation));
    if (Math.log10(f[i].pop) > binding + 1e-9) safe = false;
  }
  ok(safe, 'filter never clips a town that the fade would have drawn');

  let rises = true;
  for (let i = 1; i < f.length; i += 1) {
    if (f[i].zoom <= f[i - 1].zoom) rises = false;
    if (f[i].pop > f[i - 1].pop) rises = false;
  }
  ok(rises, 'filter floors rise in zoom and fall in population');

  const radii = POPULATION.heatRadius;
  let grows = true;
  for (let i = 1; i < radii.length; i += 1) {
    if (radii[i].zoom <= radii[i - 1].zoom) grows = false;
    if (radii[i].px <= radii[i - 1].px) grows = false;
  }
  ok(grows, 'heat radius grows with zoom so cities do not break into dots');

  ok(POPULATION.weightFloor > 0 && POPULATION.weightFloor < 1,
    'the smallest town carries a non-zero weight');
}

/* --- the palette IS the coastline, on purpose ---------------------------- */

{
  /* ==> THE TOP OF THE RAMP MUST EQUAL `coastGlow`, IN EVERY PALETTE. <==
   * Two passes deliberately steered this color AWAY from the coastline, on
   * the reasoning that the coast is the primary structure and a field sharing
   * its hue would muddy it. Aaron looked at both on glass and chose the coast
   * color itself.
   *
   * So this is no longer a separation test, it is a BINDING test: a future
   * coastline recolor has to drag the population field with it, or the two
   * quietly split and the decision is lost with nobody noticing. */
  eq(DARK.populationHigh, DARK.coastGlow, 'dark: population top stop is the coast color');
  eq(LIGHT.populationHigh, LIGHT.coastGlow, 'light: population top stop is the coast color');
}

/* --- the blur is anchored to the ground, not the screen ------------------- */

{
  /* ==> THE ASSERTION FOR "SO LARGE OVER JAPAN, THEN IT SHRINKS AND
   * DISAPPEARS". <== A screen-pixel radius means a different real-world
   * distance at every zoom, which is what produced a 400 km smear at the basin
   * band and specks at the local band. Through the doubling band the pixel
   * figure has to track `groundRadiusKm`, so a blob keeps its size on the
   * planet while the planet changes size on the phone. */
  const kmAt = (zoom, px) => px / ((512 * Math.pow(2, zoom)) / 40075);
  const band = POPULATION.heatRadius.filter((r) => r.zoom >= 5 && r.zoom <= 8);
  ok(band.length >= 3, 'the ground-scale band has enough stops to be a curve');
  let tracks = true;
  for (const r of band) {
    const km = kmAt(r.zoom, r.px);
    /* Within a quarter of the target. Tighter would be asserting the rounding
     * of the pixel values rather than the shape of the curve. */
    if (Math.abs(km - POPULATION.groundRadiusKm) > POPULATION.groundRadiusKm * 0.25) tracks = false;
  }
  ok(tracks, `radius holds ~${POPULATION.groundRadiusKm} km through the ground-scale band`);

  /* And the far ends are clamped, not ground-true — stated so nobody "fixes"
   * the table into unbounded doubling and puts a 500 px quad under every town. */
  const first = POPULATION.heatRadius[0];
  ok(kmAt(first.zoom, first.px) > POPULATION.groundRadiusKm,
    'the planet band is floored above ground scale, so a city is a readable dot');
  const last = POPULATION.heatRadius[POPULATION.heatRadius.length - 1];
  ok(kmAt(last.zoom, last.px) < POPULATION.groundRadiusKm,
    'the local band is capped below ground scale, to bound heatmap cost');
}

/* --- THE PAST/AHEAD SPLIT (§54) --------------------------------------
 *
 * The bug these exist against: the full envelope covers where the storm has
 * BEEN as well as where it is going, so a headcount over it captioned "in the
 * path" warns about wind that already fell. Hurricane Lala, advisory 34A, put
 * 1.3M Hawaiians on screen as though they were about to be hit, days after the
 * storm cleared them, with nobody at all ahead of it.
 * ---------------------------------------------------------------------- */

{
  /* Lala's shape, reduced to the fact that broke: a long envelope with people
   * only at the back of it, and a forward half that reaches nobody. */
  const towns = [
    -158, 21, 350000,   // Honolulu — behind the storm
    -157, 20, 50000,    // behind
    -172, 25, 4000,     // ahead, but the forward shape misses it by design
  ];
  const all = poly([square(-175, 15, -150, 30)]);
  const ahead = poly([square(-175, 24, -168, 30)]);

  const r = peopleInPhases(towns, [all], [ahead]);
  eq(r.ahead.people, 4000, 'ahead counts only what the forward shape reaches');
  eq(r.ahead.towns, 1, 'ahead town count');
  eq(r.past.people, 400000, 'past counts what the full shape reaches and the forward one does not');
  eq(r.past.towns, 2, 'past town count');
  eq(r.total.people, 404000, 'total is the two buckets and nothing else');
  ok(r.total.people === r.ahead.people + r.past.people, 'the buckets sum to the total, always');
  ok(r.total.towns === r.ahead.towns + r.past.towns, 'town counts sum too');
}

{
  /* The Lala case proper: nobody ahead at all. A measured zero here is what
   * flips the section into past tense, so it must be a real zero and not an
   * absence — and `past` must still hold everybody. */
  const towns = [-158, 21, 350000];
  const all = poly([square(-175, 15, -150, 30)]);
  const ahead = poly([square(-175, 24, -168, 30)]);

  const r = peopleInPhases(towns, [all], [ahead]);
  eq(r.ahead.people, 0, 'nobody ahead is a measured zero');
  eq(r.past.people, 350000, 'and everybody is behind');
}

{
  /* ==> THE REASON THIS IS NOT `total - ahead`. <== The two envelopes come off
   * the same sweep but are smoothed over different runs, so the forward shape
   * can poke a nautical mile or two outside the full one near its far end. A
   * town in that sliver is inside `ahead` and outside `all`. Subtraction would
   * return MINUS one town. Classification cannot. */
  const towns = [5, 5, 1000];
  const all = poly([square(-10, -10, 4, 10)]);      // does not reach the town
  const ahead = poly([square(0, 0, 6, 10)]);        // does

  const r = peopleInPhases(towns, [all], [ahead]);
  eq(r.ahead.people, 1000, 'a town the forward shape reaches and the full one misses is ahead');
  eq(r.past.people, 0, 'and past never goes negative');
  eq(r.total.people, 1000, 'total includes it');
}

{
  /* Empty forward shape — the "we could not build it" case must not silently
   * become "everyone is behind you". The caller gates on slot status rather
   * than on this, but the arithmetic still has to be honest about it. */
  const towns = [0, 0, 1000];
  const r = peopleInPhases(towns, [poly([square(-1, -1, 1, 1)])], []);
  eq(r.ahead.people, 0, 'no forward rings means nobody measured ahead');
  eq(r.past.people, 1000, 'and the full shape still counts');
}

{
  const r = peopleInPhases(null, [], []);
  ok(r === null, 'no town list is null, never a zero');
}

{
  /* The whole-envelope path is unchanged for callers that have no forward
   * shape — GDACS storms, which publish no past wind field at all. */
  const towns = [0, 0, 1000, 10, 10, 2000];
  const box = poly([square(-1, -1, 1, 1)]);
  eq(peopleInFeatures(towns, [box]).people, 1000, 'the single-shape count still works');
}

{
  /* ==> THE FORWARD SLOT IS A CLAIM ABOUT NEXT AND MUST DIE WITH THE OTHERS.
   * <== A silent or ended storm drops every forward-looking slot. If this one
   * were missed, the headcount would go on announcing who is still ahead of a
   * storm whose agency stopped publishing — the exact confident-future problem
   * `lib/future-slots.js` exists to remove. */
  ok(FUTURE_SLOTS.includes(POPULATION.aheadSlot),
    `${POPULATION.aheadSlot} is dropped for silent and ended storms`);
  ok(FUTURE_SLOTS.includes(POPULATION.pathSlot),
    `${POPULATION.pathSlot} is dropped for silent and ended storms`);
}

console.log(`population: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
