#!/usr/bin/env node
/**
 * test-interior-point.mjs — §56.5's acceptance case, against real captured
 * bytes.
 *
 * WHAT THIS IS FOR. The failure this file exists to catch does not throw, does
 * not blank anything, and looks completely fine on screen: a flood alert's
 * marker placed in the WRONG COUNTY. §56.2 measured it — five of twenty-five
 * bounding-box centres fell outside their own polygon, every one of them a
 * river corridor, which is precisely the shape this feature draws. A hazard
 * icon one county over is this app telling somebody the water is somewhere it
 * is not, and nothing about the picture invites a second look.
 *
 * ==> THE ONE ASSERTION THAT MATTERS IS CONTAINMENT, ACROSS THE WHOLE ARCHIVED
 * SET. <== Not "near the middle", not "close to the centroid" — inside. That
 * is the only guarantee `lib/interior-point.js` makes, and it is the only one
 * worth asserting, because it is the one a reader's safety rests on.
 *
 * ==> AND IT IS MUTATION-VERIFIED THE WAY §56.5 ASKS FOR. <== A test that
 * passes on the same wrong assumption as the bug is worse than no test
 * (CLAUDE.md). So the suite re-runs the same containment check with the
 * BOUNDING-BOX CENTRE substituted and asserts that it FAILS — on a measured
 * number of shapes, not on "some". If a future change makes `interiorPoint`
 * quietly return the bbox centre, the first block goes green and this one goes
 * red.
 *
 * The bytes:
 *   samples/flood/alerts-national.json   every US flood alert in force at
 *                                        2026-08-22T22:29:35Z off the archive
 *                                        branch — 36 alerts, 33 with polygons
 *   samples/flood/zones/HIZ023.geojson   a real NWS forecast zone, and a
 *                                        MultiPolygon: eight Hawaiian islands,
 *                                        the case that breaks a naive search
 *   samples/flood/zones/VAZ507.geojson   a real forecast zone, plain Polygon
 *
 * Zero dependencies. Run: node tools/test-interior-point.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { interiorPoint, pointInRings, signedDistance, largestRingSet } =
  await import(path.join(ROOT, 'lib/interior-point.js'));

let failures = 0;
const ok = (label) => console.log(`  ✓ ${label}`);
const fail = (label, detail) => {
  failures++;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
};
const truthy = (label, v) => (v ? ok(label) : fail(label));
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  a === e ? ok(label) : fail(label, `expected ${e}\n      actual   ${a}`);
};
const section = (n) => console.log(`\n  ${n}`);

const load = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

/* ---------------------------------------------------------------------------
 * THE REAL SHAPES
 *
 * Alert polygons and zone boundaries together, because they are genuinely
 * different problems. A warning polygon is a handful of vertices a forecaster
 * drew; a zone boundary is a coastline with thousands. Testing only the first
 * would leave the expensive case unmeasured, and testing only the second would
 * miss the river corridors that motivated the whole file.
 * ------------------------------------------------------------------------- */

const alerts = load('samples/flood/alerts-national.json').alerts;

const zoneDir = path.join(ROOT, 'samples/flood/zones');
const zones = readdirSync(zoneDir)
  /* The bulk probe is a FeatureCollection of NULL geometries — the answer to
   * "does the collection endpoint carry boundaries", which is no. It is not a
   * shape and must not be counted as one. */
  .filter((f) => f.endsWith('.geojson') && f !== 'bulk-probe.geojson')
  .map((f) => ({ id: f.replace('.geojson', ''), geometry: load(`samples/flood/zones/${f}`).geometry }));

const shapes = [
  ...alerts
    .filter((a) => a.geometry)
    .map((a, i) => ({ id: `${a.event} #${i}`, geometry: a.geometry })),
  ...zones,
];

/** The cheap answer this file exists to refuse. Kept here rather than imported,
 *  because the point of the mutation block is to run the WRONG algorithm. */
const bboxCentre = (geometry) => {
  const rings = largestRingSet(geometry);
  if (!rings?.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of rings[0]) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  return { lon: (minX + maxX) / 2, lat: (minY + maxY) / 2 };
};

const inside = (geometry, pt) =>
  !!pt && pointInRings(pt.lon, pt.lat, largestRingSet(geometry));

/* ---------------------------------------------------------------------------
 * 1. THE PREDICATES
 * ------------------------------------------------------------------------- */

section('the two predicates, on shapes with a known answer');

const square = [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]];

truthy('a point in the middle of a square is inside it', pointInRings(1, 1, square));
truthy('a point outside it is not', !pointInRings(3, 1, square));
truthy('the signed distance is POSITIVE inside', signedDistance(1, 1, square) > 0);
truthy('and NEGATIVE outside', signedDistance(3, 1, square) < 0);
truthy('the centre of a 2x2 square is 1 from its nearest edge',
  Math.abs(signedDistance(1, 1, square) - 1) < 1e-9);

/* ==> A HOLE IS OUTSIDE, AND THAT IS WHY EVERY RING GOES IN TOGETHER. <== Ray
 * casting counts an even number of crossings for a point in a hole, so holes
 * fall out for free — but ONLY if the hole ring is in the set. Feeding the
 * outer ring alone would put a marker in the middle of a lake. */
const donut = [
  [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
  [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
];
truthy('a point in a hole reads as OUTSIDE the polygon', !pointInRings(5, 5, donut));
truthy('and its signed distance is negative', signedDistance(5, 5, donut) < 0);
truthy('a point in the ring of the donut is inside', pointInRings(1, 1, donut));

/* A ray grazing a vertex is the classic ray-casting bug: counted twice, the
 * answer flips and a point plainly inside reads as outside. */
const diamond = [[[0, 0], [1, 1], [2, 0], [1, -1], [0, 0]]];
truthy('a ray passing exactly through two vertices still answers correctly',
  pointInRings(1, 0, diamond));

/* ---------------------------------------------------------------------------
 * 2. THE GUARANTEE, ON EVERY ARCHIVED SHAPE
 * ------------------------------------------------------------------------- */

section(`the guarantee, across all ${shapes.length} archived shapes`);

/* ==> THE SET SIZE IS ASSERTED, NOT JUST USED. <== A glob that silently
 * matched nothing would make every loop below pass vacuously, which is the
 * quietest way a suite like this stops testing anything. */
eq('the alert capture still holds 36 alerts', alerts.length, 36);
eq('33 of them carry a polygon', alerts.filter((a) => a.geometry).length, 33);
eq('and two real zone boundaries sit beside them', zones.length, 2);
eq('so the set under test is 35 shapes', shapes.length, 35);

const missing = [];
const outside = [];
for (const s of shapes) {
  const p = interiorPoint(s.geometry);
  if (!p) { missing.push(s.id); continue; }
  if (!inside(s.geometry, p)) outside.push(s.id);
}

eq('every shape produced a point', missing, []);
eq('and every point falls INSIDE its own polygon', outside, []);

/* Containment is the guarantee; this is the sanity check that the point is not
 * merely inside by a hair. A pole of inaccessibility should sit a real
 * distance from the boundary on every one of these. */
const tooTight = shapes.filter((s) => {
  const p = interiorPoint(s.geometry);
  return p && signedDistance(p.lon, p.lat, largestRingSet(s.geometry)) < 1e-4;
});
eq('and none of them is inside by less than a hundredth of a mile', tooTight.map((s) => s.id), []);

/* ---------------------------------------------------------------------------
 * 3. THE MUTATION §56.5 ASKS FOR
 * ------------------------------------------------------------------------- */

section('the mutation: swap in the bounding-box centre and the guarantee breaks');

const bboxOutside = shapes.filter((s) => !inside(s.geometry, bboxCentre(s.geometry)));

/* ==> A MEASURED NUMBER, NOT "MORE THAN ZERO". <== Re-measured on this frozen
 * set: SIX of the thirty-five. §56.2 recorded five of twenty-five on a
 * narrower capture; both are the same finding on different bytes, and the
 * figure here is the one this file can prove. If a future capture changes it,
 * this assertion is where that is noticed rather than where it is papered
 * over. */
eq('the bbox centre falls outside its own polygon on exactly 6 of them',
  bboxOutside.length, 6);

truthy('so the cheap answer and the real one genuinely disagree',
  bboxOutside.length > 0 && outside.length === 0);

/* ---------------------------------------------------------------------------
 * 4. THE MULTIPOLYGON CASE
 * ------------------------------------------------------------------------- */

section('an archipelago: the case a naive search puts in the ocean');

const hawaii = zones.find((z) => z.id === 'HIZ023');
truthy('HIZ023 is a real MultiPolygon', hawaii?.geometry?.type === 'MultiPolygon');
truthy('it has more than one member', hawaii.geometry.coordinates.length > 1);

const hiPoint = interiorPoint(hawaii.geometry);
truthy('it still gets a point', !!hiPoint);
truthy('and the point is inside the LARGEST member, not between the islands',
  inside(hawaii.geometry, hiPoint));

/* ==> AND THE MEMBERS ARE NOT ALL ISLANDS, WHICH IS WHAT MAKES THIS SHARP.
 * <== Read off the real bytes rather than assumed: HIZ023 has THREE members,
 * and two of them are specks — six vertices and five vertices, both of
 * effectively zero area — beside one genuine island of 1,959 vertices. NWS
 * ships those slivers; nothing here can make them go away.
 *
 * So the failure mode is not "a point in the sea between the islands", which
 * is what this comment first claimed before anybody measured it. It is worse
 * and quieter: **the search settles on a speck.** */
eq('HIZ023 has three members', hawaii.geometry.coordinates.length, 3);

const biggest = largestRingSet(hawaii.geometry);
eq('and the one picked is the 1,959-vertex island, not a sliver', biggest[0].length, 1959);

/* ==> FLATTENING EVERY MEMBER INTO ONE RING SET IS THE BUG THIS AVOIDS.
 * <== Measured: it returns a point that IS inside one of the six-vertex
 * slivers — so a containment check against "any member" would pass it — and
 * sits about 0.001 degrees, roughly a hundred metres, OUTSIDE the island the
 * alert is actually about. A chip on a speck off the coast, and every cheap
 * assertion green. This is why `largestRingSet` picks one member by area and
 * why the containment test runs against THAT member alone. */
const allRings = hawaii.geometry.coordinates.flat();
const naive = interiorPoint({ type: 'Polygon', coordinates: allRings });
truthy('flattening every member into one ring set still returns a point', !!naive);
truthy('but that point is NOT on the island the zone is about',
  naive && !pointInRings(naive.lon, naive.lat, biggest));
truthy('while the real answer is', inside(hawaii.geometry, hiPoint));

/* ---------------------------------------------------------------------------
 * 5. THE REFUSALS
 * ------------------------------------------------------------------------- */

section('what it refuses, rather than guessing at');

eq('a null geometry gets no point', interiorPoint(null), null);
eq('a Point gets no point', interiorPoint({ type: 'Point', coordinates: [0, 0] }), null);
eq('a LineString gets no point',
  interiorPoint({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }), null);
eq('an empty Polygon gets no point', interiorPoint({ type: 'Polygon', coordinates: [] }), null);
eq('a ring with a NaN vertex gets no point',
  interiorPoint({ type: 'Polygon', coordinates: [[[0, 0], [1, NaN], [1, 1], [0, 0]]] }), null);

/* A zero-area ring is a real thing to receive from a feed and there is nothing
 * inside it. Refusing costs the alert its chip; inventing a point would put a
 * hazard marker on a line. */
eq('a degenerate zero-width ring gets no point',
  interiorPoint({ type: 'Polygon', coordinates: [[[5, 5], [5, 6], [5, 5], [5, 5]]] }), null);

/* ==> THE SEAM. <== Nothing NWS publishes crosses it today, and the honest
 * response to one that did is no chip rather than a chip in the wrong ocean —
 * a bbox spanning the seam is the whole world and its centre is the Atlantic. */
eq('a ring spanning the antimeridian is refused rather than answered wrongly',
  interiorPoint({
    type: 'Polygon',
    coordinates: [[[-179, 50], [179, 50], [179, 52], [-179, 52], [-179, 50]]],
  }), null);

/* ---------------------------------------------------------------------------
 * 6. COST
 * ------------------------------------------------------------------------- */

section('cost, because this runs on the frame a reader is looking at');

const t0 = Date.now();
for (const s of shapes) interiorPoint(s.geometry);
const ms = Date.now() - t0;

/* ==> A CEILING, AND IT IS DELIBERATELY LOOSE. <== The measured figure on this
 * machine is a few milliseconds for all thirty-five, including two coastline
 * zones with thousands of vertices. 250 ms is far above that: this assertion is
 * here to catch an accidental quadratic — a heap swapped back for a linear
 * scan, a cell ceiling removed — not to police normal variation on whatever
 * runner happens to execute it. */
truthy(`all ${shapes.length} shapes cost ${ms} ms, under the 250 ms ceiling`, ms < 250);

console.log(
  failures === 0
    ? '\n✓ interior-point: every acceptance case passes\n'
    : `\n✗ interior-point: ${failures} failure(s)\n`
);
process.exit(failures === 0 ? 0 : 1);
