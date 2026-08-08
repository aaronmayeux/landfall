#!/usr/bin/env node
/**
 * test-cone-smooth.mjs — the cone of uncertainty, curved instead of faceted.
 *
 * ZERO DEPENDENCIES, like every other suite here. It runs against the REAL
 * shipped GDACS cone in samples/gdacs/geometry-TC.json, put through the REAL
 * simplifier the data layer uses, because a synthetic ring cannot reproduce
 * the failure: the facets come from Douglas-Peucker meeting a particular
 * published outline, and a hand-written pentagon has no opinion about that.
 *
 * ==> THE BAR §12 SETS: a test that passes on the same wrong assumption as the
 * bug is worse than no test. So the suite MEASURES the faceting first and
 * asserts it is present in the input. If DP ever stops producing corners, the
 * "input is faceted" assertion fails and this suite tells you the fixture went
 * stale instead of quietly certifying a smoother that no longer does anything.
 *
 * WHAT IT CANNOT PROVE: that the cone LOOKS right against its track. That is
 * glass, and it is Aaron's.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { simplifyRing } = await import('../lib/simplify.js');
const { splineClosedRing } = await import('../lib/ringpolish.js');
const { smoothCone } = await import('../lib/cone-smooth.js');
const { CONE_CURVE, TRACK_LINE, SIMPLIFY } = await import('../config/constants.js');

const OPTS = {
  spacingDeg: CONE_CURVE.spacingDeg,
  minPerLeg: CONE_CURVE.minPerLeg,
  maxPerLeg: CONE_CURVE.maxPerLeg,
  maxVertices: CONE_CURVE.maxVertices,
  alpha: TRACK_LINE.alpha,
  minKnotGap: TRACK_LINE.minKnotGap,
  minCosLat: TRACK_LINE.minCosLat,
};

/* --- ring measures -------------------------------------------------------- */

const open = (r) =>
  (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) ? r.slice(0, -1) : r;

/** Worst turn between consecutive legs, degrees. 0 is a perfect circle's limit;
 *  a big number is a corner. */
function worstTurn(ring) {
  const p = open(ring);
  const n = p.length;
  let m = 0;
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
    const v1 = [b[0] - a[0], b[1] - a[1]];
    const v2 = [c[0] - b[0], c[1] - b[1]];
    const d1 = Math.hypot(...v1), d2 = Math.hypot(...v2);
    if (!d1 || !d2) continue;
    const cs = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (d1 * d2)));
    m = Math.max(m, (Math.acos(cs) * 180) / Math.PI);
  }
  return m;
}

/** Shoelace area, absolute, square degrees. */
function area(ring) {
  const p = open(ring);
  let A = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    A += p[i][0] * p[j][1] - p[j][0] * p[i][1];
  }
  return Math.abs(A / 2);
}

function pointInRing(pt, ring) {
  const p = open(ring);
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > pt[1]) !== (p[j][1] > pt[1]) &&
        pt[0] < ((p[j][0] - p[i][0]) * (pt[1] - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}

function distToRing(pt, ring) {
  let m = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = dx * dx + dy * dy;
    let t = L ? ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    m = Math.min(m, Math.hypot(pt[0] - a[0] - t * dx, pt[1] - a[1] - t * dy));
  }
  return m;
}

/** Worst excursion of `ring` inside and outside `ref`, degrees. */
function excursion(ring, ref) {
  let inn = 0, out = 0;
  for (const q of open(ring)) {
    const d = distToRing(q, ref);
    if (pointInRing(q, ref)) inn = Math.max(inn, d); else out = Math.max(out, d);
  }
  return { inn, out };
}

/** Does a closed ring cross itself? A self-intersecting cone fills with a
 *  hole, which is the one way this smoother could produce a §5 failure. */
function selfIntersects(ring) {
  const p = open(ring);
  const n = p.length;
  const hit = (a, b, c, d) => {
    const s = (u, v, w) => Math.sign((v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]));
    return s(a, b, c) !== s(a, b, d) && s(c, d, a) !== s(c, d, b);
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent across the seam
      if (hit(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true;
    }
  }
  return false;
}

/* --- the real cone, through the real simplifier --------------------------- */

const raw = JSON.parse(fs.readFileSync('samples/gdacs/geometry-TC.json', 'utf8'));
const feats = Array.isArray(raw) ? raw : raw.features;
const coneFeature = feats.find((f) => f?.properties?.Class === 'Poly_Cones');

section('the fixture is the shipped path, not an invention');
ok(!!coneFeature, 'samples/gdacs/geometry-TC.json still carries a Poly_Cones feature');

const published = coneFeature.geometry.coordinates[0];
const thinned = simplifyRing(published, SIMPLIFY.gdacsToleranceDeg);
const curved = splineClosedRing(thinned, OPTS);

const tPub = worstTurn(published);
const tThin = worstTurn(thinned);
const tCurve = worstTurn(curved);

ok(published.length > 200, `published cone is dense (${published.length} vertices)`);
ok(thinned.length < published.length / 2,
   `DP at ${SIMPLIFY.gdacsToleranceDeg}° really thins it (${published.length} → ${thinned.length})`);

section('the bug is present in the input — if this fails, the fixture went stale');
ok(tThin > tPub * 1.5,
   `simplification SHARPENS the outline: ${tPub.toFixed(1)}° published → ${tThin.toFixed(1)}° thinned`);
ok(tThin > 15, `the thinned cone has a genuine corner (${tThin.toFixed(1)}°), not a rounding artifact`);

section('the curve removes it');
ok(tCurve < tThin * 0.75,
   `worst turn drops materially: ${tThin.toFixed(1)}° → ${tCurve.toFixed(1)}°`);
ok(tCurve <= tPub + 2,
   `and lands no worse than the source published: ${tCurve.toFixed(1)}° vs ${tPub.toFixed(1)}°`);

section('SAFETY — a hazard shape may only ever be wrong outward');
const aThin = area(thinned);
const aCurve = area(curved);
ok(aCurve >= aThin, `area does not shrink: ${aThin.toFixed(4)} → ${aCurve.toFixed(4)} sq°`);
ok(aCurve < aThin * 1.01, `and does not inflate either (+${(((aCurve / aThin) - 1) * 100).toFixed(2)}%)`);

const ex = excursion(curved, published);
ok(ex.inn < 0.05, `worst excursion INSIDE the published outline is ${ex.inn.toFixed(4)}° (< 0.05)`);
ok(ex.out < 0.05, `worst excursion OUTSIDE it is ${ex.out.toFixed(4)}° (< 0.05)`);

ok(!selfIntersects(curved),
   'the curved ring does not cross itself — a self-intersecting cone fills with a hole');

section('budget');
ok(curved.length <= CONE_CURVE.maxVertices,
   `under the vertex ceiling (${curved.length} <= ${CONE_CURVE.maxVertices})`);
ok(curved.length < published.length * 2,
   `and near the published density (${curved.length} vs ${published.length})`);

section('every input vertex survives — nothing published is moved');
{
  const eps = 1e-9;
  const missing = open(thinned).filter(
    (v) => !curved.some((q) => Math.abs(q[0] - v[0]) < eps && Math.abs(q[1] - v[1]) < eps)
  );
  ok(missing.length === 0,
     `all ${open(thinned).length} input vertices appear verbatim in the curve (${missing.length} missing)`);
}

section('OUTPUT DENSITY IS OURS, NOT THE SOURCE\'S — safe to point at an NHC cone');
{
  /* THE REGRESSION THIS PINS DOWN. Splining the RAW published ring reproduces
   * every published micro-facet as knots and doubles the vertex count for a
   * shape nobody can tell apart. `smoothCone` thins to knots first, so a
   * densely-published cone and a DP-thinned one come out at the same density.
   * If someone removes that step, the two numbers below diverge and this
   * fails. */
  const naive = splineClosedRing(published, OPTS);
  ok(naive.length > published.length * 2,
     `splining raw would balloon it (${published.length} → ${naive.length}) — the reason knots come first`);

  const viaModule = (ring) => {
    const b = { layers: { cone: { status: 'ok', error: null, fc: { type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] } } } };
    return smoothCone(b).layers.cone.fc.features[0].geometry.coordinates[0];
  };
  const fromDense = viaModule(published);
  const fromThin = viaModule(thinned);
  ok(fromDense.length === fromThin.length,
     `dense and thinned input give the SAME output density (${fromDense.length} vs ${fromThin.length})`);
  ok(fromDense.length < published.length * 1.6,
     `and it does not balloon (${published.length} → ${fromDense.length})`);
  ok(worstTurn(fromDense) < tThin * 0.75,
     `and it is materially smoother than what ships today (${tThin.toFixed(1)}° → ${worstTurn(fromDense).toFixed(1)}°)`);
  ok(fromDense.every((p, i) => p[0] === fromThin[i][0] && p[1] === fromThin[i][1]),
     'the two are in fact the SAME ring — the source’s vertex count stops mattering here');
}

section('the closing seam is curved like every other vertex');
{
  /* A square, rotated so no leg is axis-aligned. Every corner including the
   * one at index 0 must round; a smoother that treats the seam as an end
   * leaves exactly one 90° corner behind. */
  const sq = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  const c = splineClosedRing(sq, OPTS);
  ok(worstTurn(c) < 90, `the seam vertex rounds too (worst turn ${worstTurn(c).toFixed(1)}° < 90°)`);
  ok(!selfIntersects(c), 'and a tight closed shape does not fold through itself');
}

section('degenerate input is returned, never guessed at');
ok(splineClosedRing([[0, 0], [1, 1]], OPTS).length === 2, 'a two-point "ring" comes back untouched');
ok(splineClosedRing(null, OPTS) === null, 'null comes back as null');
{
  const bad = [[0, 0], [1, NaN], [2, 2], [0, 2], [0, 0]];
  ok(splineClosedRing(bad, OPTS) === bad, 'a ring with a non-finite coordinate is passed through');
}

/* --- the bundle wrapper --------------------------------------------------- */

section('smoothCone on a bundle');
const bundleWith = (slot) => ({ layers: { cone: slot, pastTrack: { status: 'none' } } });
const coneSlot = {
  status: 'ok',
  fc: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { a: 1 },
        geometry: { type: 'Polygon', coordinates: [thinned] } }] },
  error: null,
};

{
  const b = bundleWith(coneSlot);
  const out = smoothCone(b, 'TEST');
  ok(out !== b, 'returns a new bundle — the cached one is never mutated');
  ok(b.layers.cone.fc.features[0].geometry.coordinates[0] === thinned,
     'and the input bundle still holds its original ring');
  const ring = out.layers.cone.fc.features[0].geometry.coordinates[0];
  ok(ring.length > thinned.length, 'the cone slot came out curved');
  ok(out.layers.cone.fc.features[0].properties.a === 1, 'source properties survive');
  ok(out.layers.cone.fc.features[0].properties._smoothed === true, '_smoothed is stamped');
  ok(out.layers.pastTrack === b.layers.pastTrack, 'no other slot is touched');
}

{
  const b = { layers: { cone: { status: 'none', fc: null, error: null } } };
  ok(smoothCone(b) === b, 'a cone-less bundle is returned identically');
  ok(smoothCone(undefined) === undefined, 'no bundle at all is survivable');
  ok(smoothCone({ layers: {} }).layers !== undefined, 'a bundle with no cone slot is fine');
}

{
  /* MultiPolygon and holes: both rings must curve. */
  const hole = [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]];
  const outer = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  const b = bundleWith({ status: 'ok', error: null, fc: { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[outer, hole]] } },
  ] } });
  const g = smoothCone(b).layers.cone.fc.features[0].geometry;
  ok(g.type === 'MultiPolygon', 'a MultiPolygon stays a MultiPolygon');
  ok(g.coordinates[0][0].length > outer.length, 'the outer ring is curved');
  ok(g.coordinates[0][1].length > hole.length, 'and so is the hole');
}

{
  const b = bundleWith({ status: 'ok', error: null, fc: { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
  ] } });
  const g = smoothCone(b).layers.cone.fc.features[0].geometry;
  ok(g.type === 'LineString' && g.coordinates.length === 2,
     'a non-polygon cone is left exactly as it arrived rather than reshaped');
}

section('which of the two paths runs');
{
  /* A bundle carrying a smoothed forecast track AND forecast points can be
   * swept; one missing either falls back to the outline curve. `_swept` is the
   * only way to tell from outside which happened, and "which path ran" is the
   * first question anybody debugging this will ask. */
  const segs = feats
    .filter((f) => String(f?.properties?.Class || '').startsWith('Line_') &&
                   String(f?.properties?.forecast) === 'true')
    .map((f) => f.geometry.coordinates);
  const fcPts = [segs[0][0]];
  for (const sg of segs) fcPts.push(sg[1]);
  const { smoothPath } = await import('../lib/trackline.js');
  const curve = smoothPath(fcPts);

  const full = {
    layers: {
      cone: { status: 'ok', error: null, fc: { type: 'FeatureCollection', features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [published] } }] } },
      forecastTrack: { status: 'ok', error: null, fc: { type: 'FeatureCollection', features: [
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: curve } }] } },
      forecastPoints: { status: 'ok', error: null, fc: { type: 'FeatureCollection', features:
        fcPts.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } })) } },
    },
  };
  const swept = smoothCone(full, 'TEST').layers.cone.fc.features[0];
  ok(swept.properties._swept === true, 'a bundle with a track and points is SWEPT');
  ok(swept.geometry.coordinates[0].length > 100, 'and comes back as a real outline');

  /* FORECAST POINTS ARE NO LONGER NEEDED — the rebuild measures the published
   * outline against the track and never asks where the forecast hours are. A
   * source that publishes a cone and a track but no dots still gets redrawn. */
  const noPoints = { layers: { ...full.layers, forecastPoints: { status: 'none', fc: null, error: null } } };
  ok(smoothCone(noPoints).layers.cone.fc.features[0].properties._swept === true,
     'it still rebuilds with no forecast points at all');

  const noTrack = { layers: { ...full.layers, forecastTrack: { status: 'none', fc: null, error: null } } };
  ok(smoothCone(noTrack).layers.cone.fc.features[0].properties._swept === false,
     'without a forecast track it falls back too');

  /* A track that arrived in pieces is not one path to sweep along. */
  const split = { layers: { ...full.layers, forecastTrack: { status: 'ok', error: null,
    fc: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: curve.slice(0, 40) } },
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: curve.slice(60) } },
    ] } } } };
  ok(smoothCone(split).layers.cone.fc.features[0].properties._swept === false,
     'a track that would not assemble into one line falls back rather than guessing a spine');
}

section('the antimeridian');
{
  /* A ring straddling 180°. Unwrapped it is a clean box; wrapped it has a 360°
   * step in the middle. The curve must not fly across the world, and the
   * output must stay in the same (−180, 180] convention it arrived in. */
  const straddle = [[179, 10], [-179, 10], [-179, 14], [179, 14], [179, 10]];
  const c = splineClosedRing(straddle, OPTS);
  ok(c.every((p) => p[0] >= -180 && p[0] <= 180),
     'a wrapped ring comes back wrapped — this smoother does not change how a straddling cone is drawn');
  const spanOk = c.every((p) => Math.abs(p[0]) > 170);
  ok(spanOk, 'and no vertex is flung to the far side of the planet by the seam');
  ok(c.every((p) => p[1] > 8 && p[1] < 16), 'latitude stays in the neighbourhood it started in');
}

/* --- report --------------------------------------------------------------- */

console.log('');
if (failures.length) {
  console.log(`✗ ${failures.length} failed, ${pass} passed\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log('');
  process.exit(1);
}
console.log(`✓ ${pass} assertions passed`);
console.log('  (geometry only — whether the cone LOOKS right against its track is glass)');
