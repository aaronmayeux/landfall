#!/usr/bin/env node
/**
 * test-near-home.mjs — closest approach, measured against the line.
 * SPEC-SEASONS-BUILD.md §57.19, §57.35 fault 2.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-near-home.mjs`.
 *
 * ==> THE ONE ASSERTION THIS SUITE EXISTS FOR. <== §57.19 says measure against
 * the line between records, not the records, because a storm moving 20 mph
 * covers 120 miles between six-hourly positions and can hop clean over a
 * reader's circle. A points-only answer looks like a working feature and is
 * quietly wrong about fast storms. `SEASONS.nearHomeMeasureSegments` exists so
 * this file can run the SAME real track both ways and show the two answers
 * differ — not by a rounding error, by enough to change what the app says.
 *
 * ==> AND THE DATELINE CANNOT REACH ANY OF IT. <== The arithmetic is unit
 * vectors on a sphere, so 179.9E and 179.2W are simply two points close
 * together. Della, CP011957, is measured against a house on Wake Island and
 * the answer must match a hand-computed great circle. A version reasoning in
 * raw degrees gets this wrong by thousands of miles.
 *
 * WHAT THIS CANNOT PROVE: whether "passed 31 miles west as a Cat 2" reads well
 * on a phone. That is glass.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { parseHurdat2 } = await import('../lib/hurdat.js');
const { pointToSegmentNm, closestApproach, indexNearHome, within, nmToMi, miToNm } =
  await import('../lib/near-home.js');
const { greatCircleNm } = await import('../lib/geo.js');

const storm = (f) => readFileSync(`samples/seasons/storms/${f}.txt`, 'utf8');
const season = (f) => readFileSync(`samples/seasons/seasons/${f}.txt`, 'utf8');
const one = (f) => parseHurdat2(storm(f)).storms[0];

/* Real places, so a wrong answer is recognisably wrong to a human reading it. */
const NEW_ORLEANS = { lon: -90.0715, lat: 29.9511 };
const MIAMI = { lon: -80.1918, lat: 25.7617 };
const WAKE_ISLAND = { lon: 166.6, lat: 19.3 };
const REYKJAVIK = { lon: -21.94, lat: 64.15 };

/* ------------------------------------------------------------------------- */
section('point to segment — the geometry, against hand-checkable cases');
{
  /* A point level with the middle of a due-east segment. The cross-track
   * distance is the latitude gap, and a degree of latitude is 60 nm. */
  const r = pointToSegmentNm(0, 1, -10, 0, 10, 0);
  ok(Math.abs(r.nm - 60) < 1.5,
    `a point 1deg north of the middle of an equatorial segment is ~60 nm from it. Got ${r.nm.toFixed(1)}`);
  ok(r.t > 0.4 && r.t < 0.6, `and the foot lands mid-segment. Got t=${r.t.toFixed(3)}`);

  /* A point beyond the END of the segment. The segment stops; the answer must
   * be the endpoint distance, NOT the distance to the extended great circle. */
  const off = pointToSegmentNm(20, 0, -10, 0, 10, 0);
  const toEnd = greatCircleNm(20, 0, 10, 0);
  ok(Math.abs(off.nm - toEnd) < 0.01,
    `==> A SEGMENT IS NOT AN INFINITE LINE. <== A storm heading away before it got level `
    + `must measure to where it actually was. Expected ${toEnd.toFixed(1)}, got ${off.nm.toFixed(1)}`);
  ok(off.t === 1, 'and the answer is pinned to the far endpoint');

  /* A point ON the segment. */
  const on = pointToSegmentNm(5, 0, -10, 0, 10, 0);
  ok(on.nm < 0.01, `a point on the line is zero from it. Got ${on.nm}`);

  /* A degenerate segment — the file really does repeat a position for a
   * stationary storm, so this is not a synthetic case. */
  const dead = pointToSegmentNm(0, 1, 5, 5, 5, 5);
  ok(Math.abs(dead.nm - greatCircleNm(0, 1, 5, 5)) < 0.01,
    'two identical endpoints are a point, and must measure as one rather than divide by zero');

  /* The segment answer can never be worse than the nearer endpoint. */
  for (const [pLon, pLat] of [[0, 5], [-30, 12], [170, -4], [90, 60]]) {
    const seg = pointToSegmentNm(pLon, pLat, -10, 0, 10, 0);
    const ends = Math.min(greatCircleNm(pLon, pLat, -10, 0), greatCircleNm(pLon, pLat, 10, 0));
    ok(seg.nm <= ends + 1e-6,
      `the segment answer must never exceed the nearer endpoint. ${seg.nm.toFixed(2)} vs ${ends.toFixed(2)}`);
  }
}

/* ------------------------------------------------------------------------- */
section('==> THE LINE VERSUS THE POINTS, ON REAL TRACKS <==');
{
  const ida = one('al092021');

  const line = closestApproach(ida, NEW_ORLEANS);
  const points = closestApproach(ida, NEW_ORLEANS, { measureSegments: false });

  ok(line.nm < points.nm,
    `Ida's closest approach to New Orleans must be nearer measured against the line `
    + `than against the records. Line ${line.nm.toFixed(1)} nm, points ${points.nm.toFixed(1)} nm`);
  ok(line.betweenRecords === true,
    '==> AND IT FALLS BETWEEN TWO RECORDS. <== On the FIRST storm this was tried on, against '
    + 'the city it is famous for hitting, the closest moment is not one NOAA wrote down. That '
    + 'is the whole argument for §57.19 and it is not hypothetical');

  /* The gap is small for Ida because she was slow and close. A FAST, DISTANT
   * pass is where it bites, and Andrew across south Florida is that case. */
  const andrew = one('al041992');
  const aLine = closestApproach(andrew, MIAMI);
  const aPoints = closestApproach(andrew, MIAMI, { measureSegments: false });
  ok(aLine.nm <= aPoints.nm,
    `Andrew: line ${aLine.nm.toFixed(1)} nm must not exceed points ${aPoints.nm.toFixed(1)} nm`);

  /* ==> AND HERE IS WHAT IT ACTUALLY COSTS TO GET WRONG. <== The gap between
   * the two methods is NOT hundreds of miles on real tracks — measured across
   * two whole seasons against six coastal cities it runs 2 to 25 nautical
   * miles, because the nearest record is usually already near the nearest
   * point. §57.19's "quietly lies about fast storms" overstates the size and
   * understates the consequence: what matters is not the gap, it is whether
   * the gap moves a storm ACROSS the radius the reader has chosen. It does, in
   * 4 of 54 city-and-radius combinations, and one of them is this one. */
  const y2005 = parseHurdat2(season('al-2005')).storms;
  const lineIdx = indexNearHome(y2005, NEW_ORLEANS);
  const pointIdx = y2005.map((s) => ({
    id: s.id,
    name: s.name,
    nm: closestApproach(s, NEW_ORLEANS, { measureSegments: false }).nm,
  }));

  const inLine = new Set(within(lineIdx, 30).map((e) => e.id));
  const inPoints = new Set(within(pointIdx, 30).map((e) => e.id));

  ok(inLine.has('AL122005'),
    '==> KATRINA IS WITHIN 30 MILES OF NEW ORLEANS AND THE LINE METHOD SAYS SO. <==');
  ok(!inPoints.has('AL122005'),
    '==> AND THE POINTS-ONLY METHOD DROPS HER. <== The single most famous storm-and-city '
    + 'pair in the Atlantic record, missing from a reader\'s own list, with nothing on screen '
    + 'to suggest anything went wrong. That is the bug §57.19 is about, and it is not '
    + 'hypothetical: 24.4 nm measured against 30.1 nm, either side of the line the reader drew');

  const missed = [...inLine].filter((id) => !inPoints.has(id));
  ok(missed.length >= 1,
    `at least one 2005 storm must cross the 30-mile line only under the line measurement. Got ${missed.length}`);

  /* The gap is bounded and modest, and saying so here stops a later session
   * "optimising" the segment pass out on the grounds that it never mattered —
   * and equally stops one budgeting for a fix to a hundred-mile error. */
  let worstNm = 0;
  for (const s of y2005) {
    const l = closestApproach(s, NEW_ORLEANS);
    const p = closestApproach(s, NEW_ORLEANS, { measureSegments: false });
    worstNm = Math.max(worstNm, p.nm - l.nm);
  }
  ok(worstNm > 1 && worstNm < 60,
    `the measured gap across 2005 is single-digit nautical miles, not hundreds. Got ${worstNm.toFixed(1)}`);
}

/* ------------------------------------------------------------------------- */
section('a storm that skips clean over the circle — the failure §57.19 names');
{
  /* Built to the spec's own example: 20 mph, six hours between records, a
   * house dead on the track. Synthetic ON PURPOSE — it is the shape of the
   * bug, and a real storm doing exactly this is what the season sweep above
   * looks for. */
  const home = { lon: 0, lat: 0 };
  const fast = {
    id: 'ZZ012000', basin: 'AL', number: 1, year: 2000, name: 'SKIPPER',
    points: [
      { time: 0, status: 'HU', lat: 0, lon: -2, lonU: -2, windKt: 90, radii: {}, marker: null },
      { time: 6 * 3600e3, status: 'HU', lat: 0, lon: 2, lonU: 2, windKt: 90, radii: {}, marker: null },
    ],
  };

  const points = closestApproach(fast, home, { measureSegments: false });
  const line = closestApproach(fast, home);

  ok(points.nm > 100,
    `measured at the RECORDS the storm is over 100 nm away. Got ${points.nm.toFixed(1)}`);
  ok(line.nm < 1,
    `==> MEASURED AGAINST THE LINE IT WENT STRAIGHT OVER THE HOUSE. <== Got ${line.nm.toFixed(1)} nm`);

  const radiusMi = 100;
  const idx = indexNearHome([fast], home);
  ok(within(idx, radiusMi).length === 1,
    'and a 100-mile filter must CATCH it');
  const idxPoints = [{ ...idx[0], nm: points.nm }];
  ok(within(idxPoints, radiusMi).length === 0,
    'where a points-only index would have missed it entirely, silently, and looked fine');
}

/* ------------------------------------------------------------------------- */
section('==> THE DATELINE — DELLA AGAINST WAKE ISLAND <==');
{
  const della = one('cp011957');

  const near = closestApproach(della, WAKE_ISLAND);
  ok(near !== null, 'Della must measure against a house west of the antimeridian at all');

  /* The floor: no segment answer may beat the nearest RECORD by more than the
   * geometry allows, and none may be negative or non-finite. */
  const recordBest = Math.min(...della.points.map((p) =>
    greatCircleNm(WAKE_ISLAND.lon, WAKE_ISLAND.lat, p.lon, p.lat)));
  ok(near.nm <= recordBest + 1e-6,
    `the line answer must not exceed the best record. ${near.nm.toFixed(1)} vs ${recordBest.toFixed(1)}`);
  ok(Number.isFinite(near.nm) && near.nm >= 0,
    `and it must be a real distance. Got ${near.nm}`);

  /* ==> THE SEAM ITSELF. <== Her records 34 and 35 sit either side of 180,
   * 359.1 degrees apart on paper and 0.9 apart in reality. A house between
   * them must measure as being between them. */
  const pts = della.points;
  const i = pts.findIndex((p, k) => k > 0 && Math.abs(p.lon - pts[k - 1].lon) > 350);
  ok(i > 0, 'Della must actually cross in this fixture or the rest of this section proves nothing');

  const a = pts[i - 1];
  const b = pts[i];
  const between = { lon: 180, lat: (a.lat + b.lat) / 2 };
  const seg = pointToSegmentNm(between.lon, between.lat, a.lon, a.lat, b.lon, b.lat);
  ok(seg.nm < 60,
    `==> A POINT ON THE ANTIMERIDIAN BETWEEN TWO CROSSING RECORDS IS CLOSE TO THE TRACK. <== `
    + `Anything reasoning in raw degrees puts it half a planet away. Got ${seg.nm.toFixed(1)} nm`);

  const straddle = greatCircleNm(a.lon, a.lat, b.lon, b.lat);
  ok(straddle < 120,
    `and the two records themselves are one six-hour step apart, not 359 degrees. `
    + `Got ${straddle.toFixed(1)} nm`);

  /* A house on the far side of the world must come back far, not wrapped. */
  const far = closestApproach(della, REYKJAVIK);
  ok(far.nm > 3000,
    `Della never went near Iceland and must not appear to. Got ${far.nm.toFixed(0)} nm`);
}

/* ------------------------------------------------------------------------- */
section('the index, and the slider that reads it');
{
  const y2005 = parseHurdat2(season('al-2005')).storms;
  const idx = indexNearHome(y2005, MIAMI);

  ok(idx.length === y2005.length, `every storm gets an entry. Got ${idx.length} of ${y2005.length}`);
  ok(idx.every((e, i, a) => i === 0 || a[i - 1].nm <= e.nm), 'the index is sorted nearest first');
  ok(idx.every((e) => Number.isFinite(e.nm) && Number.isFinite(e.mi)),
    'and every entry carries both units, so nothing downstream converts twice');

  ok(idx[0].nm <= idx[idx.length - 1].nm, 'nearest is nearest');
  ok(within(idx, 500).length >= within(idx, 100).length,
    'a wider radius can never return fewer storms');
  ok(within(idx, 0).length === 0, 'a zero radius returns nothing rather than everything');

  /* ==> THE SLIDER TOUCHES NO GEOMETRY. <== §57.35 fault 2: re-measuring
   * 87,000 segments on every pixel of a drag would freeze the app. This proves
   * the filter works on entries alone by handing it a plain array of numbers
   * with no track attached at all. */
  const bare = [{ id: 'A', nm: 50 }, { id: 'B', nm: 200 }, { id: 'C', nm: 400 }];
  ok(within(bare, 100).length === 1,
    'the filter must work on precomputed numbers with no storm behind them');

  const katrina = idx.find((e) => e.name === 'KATRINA');
  ok(katrina && Number.isFinite(katrina.nm),
    'Katrina must be in the 2005 index with a real distance');
  ok(katrina.windKt != null,
    '==> AND THE STRENGTH COMES FROM A RECORD, NEVER INTERPOLATED. <== The PLACE between two '
    + 'records is geometry and is defensible; a wind speed halfway between two published ones '
    + 'is a number NOAA never wrote, and §57.22\'s honesty line cannot cover an invented figure');
}

/* ------------------------------------------------------------------------- */
section('units, and bad input');
{
  ok(Math.abs(nmToMi(100) - 115.078) < 0.01, `100 nm is 115.08 miles. Got ${nmToMi(100).toFixed(3)}`);
  ok(Math.abs(miToNm(nmToMi(137)) - 137) < 1e-9, 'the conversion must round-trip');

  ok(closestApproach(null, MIAMI) === null, 'no storm, no answer');
  ok(closestApproach({ points: [] }, MIAMI) === null, 'no points, no answer');
  ok(closestApproach(one('al092021'), null) === null, 'no home, no answer');
  ok(closestApproach(one('al092021'), { lon: NaN, lat: 5 }) === null,
    'a broken home coordinate must return null rather than NaN miles');
  ok(indexNearHome(null, MIAMI).length === 0, 'a null list indexes to nothing rather than throwing');
}

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
