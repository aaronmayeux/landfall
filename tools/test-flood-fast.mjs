#!/usr/bin/env node
/**
 * test-flood-fast.mjs — the cheap corridor match answers exactly what the
 * expensive one answers. SPEC-FLOOD-PLAN §56.18.
 *
 * ==> WHAT THIS FILE IS DEFENDING AGAINST IS A PERFORMANCE WIN THAT DROPS AN
 * ALERT. <== §56.18 made the match about 250 times cheaper by rejecting whole
 * shapes on their bounding boxes and by measuring a THINNED outline before the
 * full one. Both are approximations. An approximation that decides a flood
 * warning is 301 nm away when it is 299 is a §5 safety failure that no reader
 * can see, no exception reports and no screenshot catches — the row is simply
 * not there.
 *
 * So the contract this file holds is narrow and absolute:
 *
 *   THE INCLUDE/EXCLUDE VERDICT IS IDENTICAL TO MEASURING EVERY POINT NWS DREW,
 *   AT EVERY RADIUS.
 *
 * Only the reported DISTANCE may move, by at most `RAIN.floodCoarseTolNm`, and
 * only ever upward — a row may say a warning is a mile further from the track
 * than it is; it may never say it is nearer, and the alert may never vanish.
 *
 * ==> THE HARD CASE IS THE CORRIDOR EDGE, SO THIS WALKS A REAL BOUNDARY ACROSS
 * IT. <== A test that checks a zone plainly inside and a zone plainly outside
 * proves nothing about an approximation — those are the two cases every
 * approximation gets right. HIZ023, a real 1,970-point NWS coastal zone, is
 * stepped across the edge in 0.05 nm increments at five different radii, and
 * every one of those decisions is compared against the exact measurement.
 *
 * ==> AND THE BOUND IS CHECKED AS A BOUND, NOT AS AN ESTIMATE. <== The box
 * reject is only safe because `boxLowerNm` can never exceed the true distance.
 * That is asserted directly, against random shapes including ones straddling
 * the antimeridian, rather than inferred from the verdicts agreeing.
 *
 * Zero dependencies. Run: node tools/test-flood-fast.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { alertsNearTrack, trackChains, trackSamples } from '../lib/flood.js';
import {
  boxLowerNm,
  nearestNm,
  nearestNmWithin,
  trackBox,
} from '../lib/shape-distance.js';
import { greatCircleNm } from '../lib/geo.js';
import { RAIN } from '../config/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));

let passed = 0;
let failed = 0;
const ok = (label) => { passed++; console.log(`  ✓ ${label}`); };
const bad = (label, detail) => {
  failed++;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
};
const is = (got, want, label) =>
  got === want ? ok(label) : bad(label, `expected ${want}, got ${got}`);
const yes = (cond, label, detail) => (cond ? ok(label) : bad(label, detail));

const TOL = RAIN.floodCoarseTolNm;

/* ---------------------------------------------------------------------------
 * THE BYTES
 * ------------------------------------------------------------------------- */

const geomOf = (g) => (g.features ? g.features[0].geometry : g.geometry || g);

const HIZ = geomOf(read('samples/flood/zones/HIZ023.geojson'));
const VAZ = geomOf(read('samples/flood/zones/VAZ507.geojson'));
const national = read('samples/flood/alerts-national.json');
const NATIONAL = (national.alerts || national).filter((a) => a.geometry);

/* Ida: a mainland US storm with a long track, which is the case where the
 * latitude-only prefilter this pass replaced rejected nothing at all. */
const IDA_SAMPLES = trackSamples(
  trackChains(
    read('samples/ida-al092021/gis/best-track/AL092021_lin.geojson'),
    read('samples/ida-al092021/gis/019/5day_lin.geojson')
  )
);

/* Lala: Central Pacific, the storm whose cone crosses the antimeridian. */
const LALA_SAMPLES = trackSamples(
  trackChains(
    read('samples/flood/track-lala-cp2-past.geojson'),
    read('samples/flood/track-lala-cp2-forecast.geojson')
  )
);

const shift = (g, dLon, dLat) => ({
  type: g.type,
  coordinates:
    g.type === 'MultiPolygon'
      ? g.coordinates.map((p) => p.map((r) => r.map(([x, y]) => [x + dLon, y + dLat])))
      : g.coordinates.map((r) => r.map(([x, y]) => [x + dLon, y + dLat])),
});

/** A shape's lat/lon extremes, built HERE rather than imported. The bound is
 *  being checked against the truth, so the box it is handed has to come from
 *  somewhere other than the file under test — otherwise one mistake in reading
 *  a MultiPolygon would cancel itself out and the assertion would hold over a
 *  bug. Same reasoning as the thinning check further down. */
const boxOfShape = (g) => {
  const rings =
    g.type === 'MultiPolygon' ? g.coordinates.flat()
    : g.type === 'Polygon' ? g.coordinates
    : [[g.coordinates]];
  let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lat < s) s = lat;
      if (lat > n) n = lat;
      if (lon < w) w = lon;
      if (lon > e) e = lon;
    }
  }
  return { s, n, w, e };
};

/* ---------------------------------------------------------------------------
 * 1. THE VERDICT NEVER MOVES — the whole point of the file
 * ------------------------------------------------------------------------- */

console.log('\n§56.18 — the cheap match and the exact match agree');

{
  /* A real boundary walked across the corridor edge. 0.05° of latitude is 3 nm,
   * so this crosses in steps far finer than the tolerance being tested. */
  const walk = [];
  for (let d = 0; d <= 14; d += 0.05) walk.push(shift(HIZ, 65, 10 + d));

  const shapes = [...NATIONAL.map((a) => a.geometry), ...walk, VAZ, HIZ];
  const radii = [50, 100, 200, 300, 400];

  let decisions = 0;
  let flips = 0;
  let worstErr = 0;
  let understated = 0;

  for (const radius of radii) {
    for (const g of shapes) {
      const exact = nearestNm(g, IDA_SAMPLES);
      const fast = nearestNmWithin(g, IDA_SAMPLES, radius);
      const exactIn = exact != null && exact <= radius;
      const fastIn = fast != null;
      decisions++;
      if (exactIn !== fastIn) flips++;
      if (fastIn && exact != null) {
        if (fast < exact - 1e-9) understated++;
        worstErr = Math.max(worstErr, Math.abs(fast - exact));
      }
    }
  }

  console.log(`    ${decisions} include/exclude decisions across ${radii.length} radii`);
  is(flips, 0, 'not one alert moves in or out of the corridor');
  is(understated, 0, 'the reported distance is never SHORTER than the truth');
  yes(
    worstErr <= TOL + 1e-9,
    `the reported distance is never more than ${TOL} nm long (worst ${worstErr.toFixed(3)} nm)`,
    `worst error ${worstErr} exceeds the ${TOL} nm budget`
  );
}

/* ---------------------------------------------------------------------------
 * 2. THE BOUND IS A BOUND
 *
 * The box reject is the one stage with no second opinion behind it — a shape it
 * discards is never measured again. If it can ever exceed the true distance, it
 * can discard something real.
 * ------------------------------------------------------------------------- */

console.log('\n§56.18 — the box reject can never exceed the true distance');

{
  /* `boxLowerNm` is internal, so it is exercised through the door the app uses:
   * ask for a huge radius (nothing can be rejected) and a tight one, and check
   * that anything the tight radius discarded really was outside it. */
  const probes = [];
  for (let lon = -180; lon < 180; lon += 17) {
    for (let lat = -80; lat <= 80; lat += 23) probes.push(shift(HIZ, lon + 155, lat - 19));
  }
  /* Straddling the antimeridian: a real US case (the Aleutians) and the exact
   * shape that broke the deleted `extent()` machinery. */
  probes.push({
    type: 'Polygon',
    coordinates: [[[179.5, 51], [-179.5, 51], [-179.5, 52], [179.5, 52], [179.5, 51]]],
  });

  let wrongfullyDropped = 0;
  let checked = 0;
  for (const radius of [100, 300, 900, 3000]) {
    for (const g of probes) {
      const exact = nearestNm(g, LALA_SAMPLES);
      const fast = nearestNmWithin(g, LALA_SAMPLES, radius);
      checked++;
      if (fast == null && exact != null && exact <= radius) wrongfullyDropped++;
    }
  }
  console.log(`    ${checked} shapes tested at four radii, spread over the whole globe`);
  is(wrongfullyDropped, 0, 'nothing inside the corridor is ever rejected on its box');

  /* ==> AND THE INVARIANT ITSELF, HEAD-ON. <== The loop above tests the
   * CONSEQUENCE — did anything real get dropped — and it is not sensitive
   * enough on its own. A bound only slightly too large drops something only
   * when it lands between the true distance and the radius, which a probe grid
   * this coarse almost never straddles. It was verified to pass with a
   * deliberate 2% inflation in `boxLowerNm`, which is the §12 failure. What the
   * reject actually rests on is one inequality, so assert that instead: the
   * bound is never larger than the distance it is supposed to bound. */
  const tBox = trackBox(LALA_SAMPLES);
  let notABound = 0;
  let tightest = Infinity;
  for (const g of probes) {
    const exact = nearestNm(g, LALA_SAMPLES);
    if (exact == null) continue;
    const bound = boxLowerNm(boxOfShape(g), tBox);
    if (bound > exact + 1e-9) notABound++;
    /* How close the bound gets to the truth — a bound that is always far below
     * it would satisfy the inequality and reject nothing, so this number is
     * what says the assertion above has teeth. */
    if (exact > 1) tightest = Math.min(tightest, exact - bound);
  }
  console.log(`    closest the bound ever came to the true distance: ${tightest.toFixed(1)} nm`);
  is(notABound, 0, 'the box bound is never larger than the true distance');
  yes(
    tightest < 50,
    'and it comes close enough to the truth to actually reject anything',
    `the bound never got within 50 nm of the truth (best ${tightest.toFixed(1)} nm), so the assertion above proves nothing`
  );
}

{
  /* The seam shape specifically, because it is the case the bound DECLINES to
   * judge rather than judges. It must fall through and be measured, not be
   * dropped and not be silently kept. */
  const seam = {
    type: 'Polygon',
    coordinates: [[[179.0, 18], [-179.0, 18], [-179.0, 20], [179.0, 20], [179.0, 18]]],
  };
  const exact = nearestNm(seam, LALA_SAMPLES);
  const near = nearestNmWithin(seam, LALA_SAMPLES, Math.ceil(exact) + 5);
  const far = nearestNmWithin(seam, LALA_SAMPLES, Math.max(1, Math.floor(exact) - 5));
  yes(near != null, 'a shape drawn across the antimeridian is still found when it is near');
  is(far, null, 'and is still rejected when it is far');
}

/* ---------------------------------------------------------------------------
 * 3. THE LIST MATCH, END TO END
 * ------------------------------------------------------------------------- */

console.log('\n§56.18 — the whole list match is unchanged');

{
  const withWatches = [
    ...NATIONAL,
    /* Phase 4's resolved watch zones: the shapes that made this expensive. One
     * on the track, one four thousand miles from it. */
    { id: 'near', event: 'Flood Watch', drawable: true, geometry: shift(HIZ, 65, 10) },
    { id: 'far', event: 'Flood Watch', drawable: true, geometry: HIZ },
  ];

  const got = alertsNearTrack(withWatches, IDA_SAMPLES, RAIN.floodCorridorNm);
  const ids = new Set((got.alerts || []).map((a) => a.id));

  /* The exact answer, computed the slow way, right here — so this assertion is
   * not comparing the code against a number somebody typed once. */
  const wantIds = new Set(
    withWatches
      .filter((a) => {
        const d = nearestNm(a.geometry, IDA_SAMPLES);
        return d != null && d <= RAIN.floodCorridorNm;
      })
      .map((a) => a.id)
  );

  is(got.state, 'ok', 'the list still matches');
  is(ids.size, wantIds.size, `the same number of alerts match (${wantIds.size})`);
  yes(
    [...wantIds].every((id) => ids.has(id)),
    'and they are the same alerts, one for one'
  );
  yes(ids.has('near'), 'the watch zone lying across the track is kept');
  yes(!ids.has('far'), 'the identical zone four thousand miles away is not');
}

{
  /* A shapeless alert is still COUNTED and not silently dropped — `null` from
   * the cheap path means "outside the corridor" and must never be confused with
   * "could not be measured" (§56.4). */
  const got = alertsNearTrack(
    [{ id: 'x', event: 'Flood Watch', geometry: null }],
    IDA_SAMPLES,
    RAIN.floodCorridorNm
  );
  is(got.state, 'none_matched', 'a shapeless alert still matches nothing');
  is(got.unplaceable, 1, 'and is still counted as unplaceable rather than vanishing');
}

/* ---------------------------------------------------------------------------
 * 4. THE HOUSE — one vertex, and it must stay exact
 * ------------------------------------------------------------------------- */

console.log('\n§56.9 — a Point is still measured exactly');

{
  const house = { type: 'Point', coordinates: [-90.5, 30.4] };
  const exact = nearestNm(house, IDA_SAMPLES);
  const fast = nearestNmWithin(house, IDA_SAMPLES, RAIN.floodCorridorNm);
  yes(exact != null, 'the house is measured at all');
  yes(
    fast != null && Math.abs(fast - exact) < 1e-9,
    'and the cheap path returns the identical number for it',
    `exact ${exact}, fast ${fast}`
  );
}

/* ---------------------------------------------------------------------------
 * 5. IT IS ACTUALLY CHEAPER
 *
 * ==> A TIME IS NOT A BUDGET HERE. <== This repo's rule is that a sandbox
 * measurement is evidence about the sandbox (§56.15). What is asserted is the
 * RATIO between two functions running on the same machine in the same second,
 * which is a property of the arithmetic rather than of the hardware — and the
 * point of asserting it is that a later change quietly reintroducing the full
 * grind would otherwise be invisible.
 * ------------------------------------------------------------------------- */

console.log('\n§56.18 — the shape it was all for');

{
  const zones = Array.from({ length: 23 }, () => HIZ);
  const time = (fn) => {
    fn();
    const t = process.hrtime.bigint();
    for (let i = 0; i < 5; i++) fn();
    return Number(process.hrtime.bigint() - t) / 1e6 / 5;
  };
  const box = trackBox(IDA_SAMPLES);
  const slow = time(() => zones.forEach((g) => nearestNm(g, IDA_SAMPLES)));
  const fast = time(() =>
    zones.forEach((g) => nearestNmWithin(g, IDA_SAMPLES, RAIN.floodCorridorNm))
  );
  console.log(`    23 far zones: ${slow.toFixed(0)} ms measuring every point, ${fast.toFixed(1)} ms with the reject`);
  yes(box != null, 'the track has a box to reject against');
  yes(
    fast * 10 < slow,
    'rejecting on the box is at least ten times cheaper than grinding',
    `${fast.toFixed(1)} ms is not ten times better than ${slow.toFixed(0)} ms`
  );
}

/* ---------------------------------------------------------------------------
 * 6. THE THINNING IS DOING SOMETHING
 *
 * If `floodCoarseTolNm` were ever set to zero, or the walk broken so it kept
 * every point, everything above would still pass — the answers would be exact
 * and slow. That is the failure §12 calls worse than no test, so the reduction
 * is asserted on its own.
 * ------------------------------------------------------------------------- */

console.log('\n§56.18 — the outline really is thinned');

{
  const rings = HIZ.type === 'MultiPolygon' ? HIZ.coordinates.flat() : HIZ.coordinates;
  const full = rings.reduce((n, r) => n + r.length, 0);

  /* Rebuilt here rather than imported, so this asserts the PROPERTY against the
   * real boundary independent of the implementation.
   *
   * ==> AND THE PROPERTY IS ABOUT THE DROPPED POINTS, NOT ABOUT THE GAPS. <==
   * The first version of this assertion measured the distance between
   * neighbouring KEPT points and demanded it stay inside the budget. It went
   * red, and it was the assertion that was wrong: one edge of HIZ023 is 7.9 nm
   * long all by itself, so between those two points there is nothing to drop
   * and nothing to be wrong about. What the error bound actually rests on is
   * that every point NWS drew is within the budget of a point that survived. */
  const kept = [];
  for (const ring of rings) {
    let acc = 0;
    kept.push(ring[0]);
    for (let i = 1; i < ring.length; i++) {
      acc += greatCircleNm(ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1]);
      if (acc >= TOL) { kept.push(ring[i]); acc = 0; }
    }
  }

  /* Every drawn point against every kept point. Slow and deliberately so — this
   * is the definition, not an optimisation of it. */
  let worstOrphan = 0;
  for (const ring of rings) {
    for (const pt of ring) {
      let best = Infinity;
      for (const k of kept) {
        const d = greatCircleNm(pt[0], pt[1], k[0], k[1]);
        if (d < best) best = d;
      }
      if (best > worstOrphan) worstOrphan = best;
    }
  }

  console.log(`    HIZ023: ${full} points drawn, ${kept.length} kept at ${TOL} nm`);
  yes(kept.length * 5 < full, 'the coarse outline is at least five times smaller than the drawn one',
    `${kept.length} of ${full} is not a five-fold reduction`);
  yes(
    worstOrphan <= TOL + 1e-9,
    `every drawn point is within ${TOL} nm of one that survived (worst ${worstOrphan.toFixed(3)} nm)`,
    `a point ${worstOrphan} nm from the nearest survivor breaks the error bound the verdict rests on`
  );
}

console.log(
  failed
    ? `\n✗ flood-fast: ${failed} failed, ${passed} passed\n`
    : `\n✓ flood-fast: ${passed} assertions passed — cheap and exact are the same answer\n`
);
process.exit(failed ? 1 : 0);
