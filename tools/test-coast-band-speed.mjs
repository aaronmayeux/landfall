#!/usr/bin/env node
/**
 * test-coast-band-speed.mjs — the fast select paints exactly what the slow
 * one painted, and a first paint does not wait.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-coast-band-speed.mjs`.
 *
 * ===========================================================================
 * WHY THIS FILE IS MOSTLY AN ORACLE AND NOT A STOPWATCH
 * ===========================================================================
 *
 * The stripe repainted about a second after a pinch ended (Aaron, on glass,
 * 2026-08-10). Three things were spent: a 400 ms debounce, MapLibre's tile
 * decode, and the select. Only the first and third are ours.
 *
 * The select got a leg grid — corridor legs bucketed into cells of the
 * corridor's own half-width, so a coast vertex is tested against the one or
 * two legs actually near it rather than all eighteen. That is a pure
 * optimisation, which is exactly the kind of change that quietly alters
 * output. So the bulk of this suite is a REFERENCE IMPLEMENTATION of the
 * pre-grid scan, kept here verbatim, asserted run-for-run and
 * coordinate-for-coordinate against the real one.
 *
 * ==> A FASTER SELECT THAT PAINTS DIFFERENTLY IS WORSE THAN A SLOW ONE. <==
 * A warning stripe is safety information; there is no speed worth a coast
 * that is warned on one build and not the next. If the grid ever disagrees
 * with the scan, this fails, and the answer is to delete the grid rather than
 * to update the oracle.
 *
 * Timings are printed, never asserted. A shared CI box's clock says nothing
 * about a phone, and a test that fails on a busy runner teaches people to
 * ignore it.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { bandSelect } = await import('../map/coast-band.js');
const { COAST_BAND } = await import('../config/constants.js');

const KM = 111.32;
const R = Math.PI / 180;
const W = COAST_BAND.halfWidthKm;
const W2 = W * W;

/* ---------------------------------------------------------------------------
 * THE ORACLE — the corridor scan exactly as it was before the grid.
 *
 * Every leg, every time, no bucketing. Slow on purpose and correct by
 * construction, because it is the behaviour that was confirmed on glass.
 * ------------------------------------------------------------------------- */

function oracleRuns(feature, rings) {
  const g = feature.geometry;
  const parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates;

  let sum = 0;
  let n = 0;
  for (const p of parts) for (const q of p) { sum += q[1]; n++; }
  if (n < 2) return [];

  const kmLon = KM * Math.cos((sum / n) * R);
  const toXY = (p) => [p[0] * kmLon, p[1] * KM];

  const legs = [];
  const bb = { w: Infinity, e: -Infinity, s: Infinity, n: -Infinity };
  for (const part of parts) {
    if (part.length < 2) continue;
    for (let i = 0; i < part.length - 1; i++) {
      legs.push({ a: toXY(part[i]), b: toXY(part[i + 1]), first: i === 0, last: i === part.length - 2 });
    }
    for (const p of part) {
      if (p[0] < bb.w) bb.w = p[0];
      if (p[0] > bb.e) bb.e = p[0];
      if (p[1] < bb.s) bb.s = p[1];
      if (p[1] > bb.n) bb.n = p[1];
    }
  }
  if (!legs.length) return [];

  bb.w -= W / kmLon; bb.e += W / kmLon;
  bb.s -= W / KM;    bb.n += W / KM;

  const inBand = (p) => {
    if (p[0] < bb.w || p[0] > bb.e || p[1] < bb.s || p[1] > bb.n) return false;
    const [px, py] = toXY(p);
    for (const leg of legs) {
      const abx = leg.b[0] - leg.a[0];
      const aby = leg.b[1] - leg.a[1];
      const apx = px - leg.a[0];
      const apy = py - leg.a[1];
      const len2 = abx * abx + aby * aby;
      let t = len2 ? (apx * abx + apy * aby) / len2 : 0;
      if (leg.first && t < 0) continue;
      if (leg.last && t > 1) continue;
      t = Math.max(0, Math.min(1, t));
      const dx = apx - t * abx;
      const dy = apy - t * aby;
      if (dx * dx + dy * dy <= W2) return true;
    }
    return false;
  };

  const isEdge = (a, b) => {
    const eps = COAST_BAND.tileEdgeEpsDeg;
    if (!(Math.abs(a[0] - b[0]) <= eps || Math.abs(a[1] - b[1]) <= eps)) return false;
    const dx = (b[0] - a[0]) * kmLon;
    const dy = (b[1] - a[1]) * KM;
    return dx * dx + dy * dy >= COAST_BAND.tileEdgeMinKm ** 2;
  };

  const runs = [];
  for (const ring of rings) {
    let run = null;
    let prev = null;
    let prevIn = false;
    for (const v of ring) {
      const vIn = inBand(v);
      if (vIn && prevIn && !isEdge(prev, v)) {
        if (!run) run = [prev];
        run.push(v);
      } else if (run) { runs.push(run); run = null; }
      prev = v;
      prevIn = vIn;
    }
    if (run) runs.push(run);
  }
  return runs;
}

/* ---------------------------------------------------------------------------
 * COASTLINE AND WARNINGS, SHAPED LIKE THE REAL ONES
 *
 * The warning lines are Ida's advisory 12 geometry, rounded: an 18-vertex
 * hurricane warning over 530 km plus five shorter ones. Eighteen legs is what
 * makes the grid worth having, so a fixture with three would measure nothing.
 * ------------------------------------------------------------------------- */

function coast(totalVertices, ringLen, seed, lon0 = -93, lat0 = 29.3, span = 4.2) {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const rings = [];
  let n = 0;
  let lon = lon0;
  let lat = lat0;
  while (n < totalVertices) {
    const ring = [];
    for (let i = 0; i < ringLen; i++) {
      lon += 0.0004;
      lat += Math.sin(lon * 300) * 0.0008;
      if (lon > lon0 + span) { lon = lon0; lat = lat0 + rnd() * 0.9; }
      ring.push([lon, lat]);
    }
    rings.push(ring);
    n += ringLen;
  }
  return rings;
}

const line = (pts, code) => ({
  type: 'Feature',
  properties: { TCWW: code },
  geometry: { type: 'LineString', coordinates: pts },
});

const IDA_ADV12 = [
  line(Array.from({ length: 18 }, (_, i) => [-92.04 + i * 0.16, 29.08 + i * 0.06]), 'HWR'),
  line(Array.from({ length: 5 }, (_, i) => [-90.42 + i * 0.16, 30.04 + i * 0.08]), 'HWR'),
  line(Array.from({ length: 5 }, (_, i) => [-90.57 + i * 0.03, 30.17 + i * 0.04]), 'HWR'),
  line(Array.from({ length: 6 }, (_, i) => [-88.33 + i * 0.13, 30.27 + i * 0.07]), 'TWR'),
  line(Array.from({ length: 3 }, (_, i) => [-93.30 + i * 0.42, 29.53 + i * 0.08]), 'TWR'),
  line(Array.from({ length: 5 }, (_, i) => [-89.60 + i * 0.26, 30.15 + i * 0.05]), 'TWR'),
];

const runsOf = (f) => (f.properties?._banded === true ? f.geometry.coordinates : []);

/* ---------------------------------------------------------------------------
 * IDENTICAL OUTPUT
 * ------------------------------------------------------------------------- */
section('the leg grid paints exactly what the full scan painted');

let referenceRuns = 0;
let referenceVertices = 0;

for (const seed of [1, 7, 99]) {
  for (const size of [20000, 60000, 150000]) {
    const rings = coast(size, 500, seed);
    const got = bandSelect(IDA_ADV12, rings);

    let agree = true;
    IDA_ADV12.forEach((f, i) => {
      const mine = runsOf(got.features[i]);
      const theirs = oracleRuns(f, rings);
      referenceRuns += theirs.length;
      for (const run of theirs) referenceVertices += run.length;
      if (JSON.stringify(mine) !== JSON.stringify(theirs)) agree = false;
    });

    ok(agree, `seed ${seed}, ${size} vertices: every run identical to the full scan`);
  }
}

ok(referenceRuns > 100, `the oracle actually painted something (${referenceRuns} runs)`);
ok(referenceVertices > 10000, `over real geometry (${referenceVertices} vertices)`);

/* A coast entirely outside the corridor must still come back as the honest
 * fallback and not as an empty paint — the §5 distinction the grid must not
 * quietly turn into "no warning here". */
{
  const elsewhere = coast(20000, 500, 3, -70, 40, 6);
  const got = bandSelect(IDA_ADV12, elsewhere);
  ok(got.paintedCount === 0, 'a coast nowhere near the warning paints nothing');
  ok(
    got.features.every((f) => f.properties._banded === false && f.properties._bandReason),
    'and every feature keeps its delivered chords, flagged with a reason'
  );
}

/* ---------------------------------------------------------------------------
 * THE FIRST PAINT DOES NOT WAIT
 * ------------------------------------------------------------------------- */
section('a zoom with no band yet skips the debounce');

const { bandFor, bandMissingFor, clearBands } = await import('../map/coast-band-cache.js');

{
  const rings = coast(20000, 500, 5);
  const map = {
    on() {},
    getZoom: () => 7,
    querySourceFeatures(_s, opts) {
      if (opts.sourceLayer === 'earth') throw new Error('no such source-layer');
      return rings.map((ring) => ({
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { class: 'ocean' },
      }));
    },
  };

  clearBands();
  ok(bandMissingFor(map, ['ida']), 'before any select, this zoom has no band');

  bandFor(map, 'ida', IDA_ADV12, 'adv12');
  ok(!bandMissingFor(map, ['ida']), 'after one select, it does');

  /* The zoom the user just arrived at is the one that matters. A band held for
   * a DIFFERENT zoom must not count as "already painted here" — that is the
   * whole reason the wait is skipped. */
  map.getZoom = () => 10;
  ok(bandMissingFor(map, ['ida']), 'a band held at another zoom does not count');

  ok(
    bandMissingFor(map, ['ida', 'ambient']),
    'and any missing key is enough — the ambient stripe waits on nobody either'
  );
}

ok(
  COAST_BAND.reselectDebounceMs > 0 && COAST_BAND.reselectDebounceMs <= 200,
  `the debounce still collapses a pinch without being felt (${COAST_BAND.reselectDebounceMs} ms)`
);

/* ---------------------------------------------------------------------------
 * TIMINGS — printed, never asserted.
 * ------------------------------------------------------------------------- */
section('for the record, on whatever machine this is');

{
  const rings = coast(150000, 500, 1);
  bandSelect(IDA_ADV12, rings);
  IDA_ADV12.forEach((f) => oracleRuns(f, rings));

  let t = performance.now();
  bandSelect(IDA_ADV12, rings);
  const fast = performance.now() - t;

  t = performance.now();
  IDA_ADV12.forEach((f) => oracleRuns(f, rings));
  const slow = performance.now() - t;

  console.log(`    150k vertices, 6 warnings: was ${slow.toFixed(1)} ms, now ${fast.toFixed(1)} ms`);

  /* Wide zoom: most of what the decode hands back is coast in another ocean. */
  const near = coast(40000, 500, 2);
  const far = [...coast(80000, 500, 4, -80, 25, 9), ...coast(80000, 500, 6, -70, 40, 9)];
  bandSelect(IDA_ADV12, [...near, ...far]);
  t = performance.now();
  bandSelect(IDA_ADV12, [...near, ...far]);
  const mixed = performance.now() - t;
  t = performance.now();
  bandSelect(IDA_ADV12, near);
  const justNear = performance.now() - t;
  console.log(
    `    200k vertices, 80% of it in another ocean: ${mixed.toFixed(1)} ms ` +
      `(the near 40k alone is ${justNear.toFixed(1)} ms)`
  );
}

/* ------------------------------------------------------------------------- */
if (failures.length) {
  console.log(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (identity against the old scan — whether it FEELS instant is a phone question)');
