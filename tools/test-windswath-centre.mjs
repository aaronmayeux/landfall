#!/usr/bin/env node
/**
 * test-windswath-centre.mjs — a wind ring is placed at its OWN centre
 * (SPEC-MAP.md §7.13, `lib/windswath.js` `centreOfRadiiRing`).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-windswath-centre.mjs`.
 *
 * ==> WHAT BROKE. <== NHC serves the 5-day forecast POINTS and the forecast
 * RADII as separate ArcGIS layers on separate publish cycles. The swath took
 * the quadrant NUMBERS from the radii and the CENTRES from the points, joined
 * on tau. On 2026-08-21 Moke's points were advisory 4, published 09:13Z, while
 * her radii were advisory 6, published 21:12Z — two advisories and twelve hours
 * apart. Every wind band was drawn 108 to 151 nm east-southeast of where NHC
 * drew it.
 *
 * ==> LALA CANNOT SEE THIS ONE EITHER. THIS IS THE THIRD TIME. <== Her points
 * and her radii are BOTH advisory 36A, published five minutes apart, and her
 * solved centres match her forecast points to the third decimal. A suite built
 * on Lala alone passes before and after the fix. That is asserted below rather
 * than assumed, and Lala earns her keep here as the no-op control: a fix that
 * moved every storm's bands to correct one storm's would be a regression
 * wearing a fix's clothes.
 *
 * MUTATIONS THIS SUITE IS PROVEN TO CATCH (each run by hand against
 * `lib/windswath.js`, confirmed failing, reverted):
 *   1. forecast tier reads `centreByTau` instead of the solve  -> Moke moves
 *   2. the seam unwrap dropped from `centreOfRadiiRing`        -> Lala tau 120
 *   3. `centreSolveTolNm` raised past the current field's miss -> a non-rose
 *      is accepted as a rose
 *   4. the entry takes the solved centre but the POINTS' clock -> Moke's two
 *      nearest-term rings are dropped as already-past
 *   5. `anyRadius` guard removed                               -> an all-zero
 *      ring solves to a meaningless point
 *
 * WHAT THIS CANNOT PROVE: that the corridor READS right. That is a phone.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { centreOfRadiiRing, buildFullTrack, radiusAtBearing } =
  await import('../lib/windswath.js');
const { parseNhcValidtime } = await import('../lib/time.js');

const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const quadOf = (p) => ({
  ne: Number(p.ne) || 0, se: Number(p.se) || 0,
  sw: Number(p.sw) || 0, nw: Number(p.nw) || 0,
});

/* Nautical miles between two lon/lat, longitude scaled by cos(mean latitude).
 * Same planar frame lib/windswath.js sweeps in. */
const nm = (a, b) => {
  const k = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  let dLon = a.lon - b.lon;
  while (dLon > 180) dLon -= 360;
  while (dLon <= -180) dLon += 360;
  return Math.hypot(dLon * k, a.lat - b.lat) * 60;
};

const STORMS = {
  Lala: {
    dir: 'samples/lala-cp012026',
    radii: 'wind-swath-038-recurve.geojson',
    points: 'forecast-points-038-stale.geojson',
    lon: -170.4, lat: 28.6,
  },
  Moke: {
    dir: 'samples/moke-cp032026',
    radii: 'wind-swath-adv6.geojson',
    points: 'forecast-points-006-stale.geojson',
    pastRadii: 'wind-past-adv6.geojson',
    pastPoints: 'past-points-adv6.geojson',
    current: 'wind-current-adv6.geojson',
    lon: -147.2, lat: 13.9,
  },
};

const load = (name) => {
  const s = STORMS[name];
  const radii = read(`${s.dir}/${s.radii}`);
  const points = read(`${s.dir}/${s.points}`);
  for (const f of points.features) {
    f.properties._time = parseNhcValidtime(f.properties.validtime, f.properties.advdate);
  }
  const pointByTau = new Map(
    points.features.map((f) => [Number(f.properties.tau), f.geometry.coordinates])
  );
  return { s, radii, points, pointByTau };
};

/* ---------------------------------------------------------------------------
 * THE SOLVE ITSELF
 * ------------------------------------------------------------------------- */
section('every published ring states its own centre, and states it twice');
{
  let worst = 0;
  let solved = 0;
  let total = 0;
  for (const name of ['Lala', 'Moke']) {
    const { radii } = load(name);
    for (const f of radii.features) {
      total++;
      const c = centreOfRadiiRing(f.geometry, quadOf(f.properties));
      if (c) { solved++; worst = Math.max(worst, c.missNm); }
      else failures.push(`${name} tau ${f.properties.tau} ${f.properties.radii} kt would not solve`);
    }
  }
  ok(solved === total, `every forecast ring must solve, ${solved}/${total}`);
  ok(worst < 1, `the two solves must close on one point, worst miss ${worst.toFixed(2)} nm`);
  /* The measured worst across both storms is 0.55 nm and the tolerance is 2.
   * If this ever creeps toward the fence, the fence is not the thing to move. */
  ok(worst < 1, 'and must stay far below WIND_SWEEP.centreSolveTolNm');
}

section('the past tier solves too — the same shape, the same rule');
{
  const past = read(`${STORMS.Moke.dir}/${STORMS.Moke.pastRadii}`);
  for (const f of past.features) {
    const c = centreOfRadiiRing(f.geometry, quadOf(f.properties));
    ok(c != null, `Moke's past ring at ${f.properties.synoptime} must solve`);
  }
}

section('a shape that is NOT a quadrant rose is refused, not guessed at');
{
  /* The CURRENT wind field is a merged product, not four arcs about a point.
   * Measured on these bytes it misses by 5 to 33 nm, which is what the
   * tolerance is for. Refusing it is the honest answer: the current tier is
   * placed at the feed position and never needed this. */
  const cur = read(`${STORMS.Moke.dir}/${STORMS.Moke.current}`);
  let refused = 0;
  for (const f of cur.features) {
    if (centreOfRadiiRing(f.geometry, quadOf(f.properties)) == null) refused++;
  }
  ok(refused === cur.features.length,
    `the current field must not be mistaken for a rose, ${refused}/${cur.features.length} refused`);

  ok(centreOfRadiiRing(null, { ne: 60, se: 0, sw: 0, nw: 60 }) == null,
    'no geometry, no centre');

  /* ==> A COLLAPSED RING WITH ALL-ZERO RADII IS THE ONE CASE THE TOLERANCE
   * CANNOT SEE. <== Every vertex at one point makes both solves agree
   * perfectly — miss 0.00 nm — so it sails through the fence and "solves" to a
   * place it has no business stating. A service serving a degenerate polygon is
   * not hypothetical; NHC has served empty and single-vertex features before
   * (§4). The all-zero guard is what refuses it, and this is the assertion that
   * fails if the guard is taken out. */
  const collapsed = { coordinates: [[[-147, 13], [-147, 13], [-147, 13], [-147, 13]]] };
  ok(centreOfRadiiRing(collapsed, { ne: 0, se: 0, sw: 0, nw: 0 }) == null,
    'an all-zero ring states nothing and must not be solved to a point');
  ok(centreOfRadiiRing(collapsed, { ne: 60, se: 0, sw: 0, nw: 60 }) == null,
    'and a ring with radii but no extent is not a rose either');

  ok(centreOfRadiiRing({ coordinates: [[[-147, 13], [-146, 13], [-146, 14], [-147, 13]]] },
    { ne: 0, se: 0, sw: 0, nw: 0 }) == null,
    'nor is a scribble with nothing published to size it');
}

section('a ring across the antimeridian solves on one branch of longitude');
{
  const { radii } = load('Lala');
  /* Lala's five-day rings straddle 180. Wrapped into (-180, 180] their raw
   * bounding box spans the globe, and an unguarded solve landed 17,000 nm out —
   * measured, not imagined. */
  const seam = radii.features.filter((f) => {
    const lons = [];
    (function w(a) { typeof a[0] === 'number' ? lons.push(a[0]) : a.forEach(w); })(f.geometry.coordinates);
    return Math.max(...lons) - Math.min(...lons) > 180;
  });
  ok(seam.length > 0, 'the fixture must still carry a seam-crossing ring');
  for (const f of seam) {
    const c = centreOfRadiiRing(f.geometry, quadOf(f.properties));
    ok(c != null, `Lala tau ${f.properties.tau} crosses 180 and must still solve`);
    ok(c != null && Math.abs(c.lon) > 170,
      `a seam ring's centre belongs near 180, got ${c ? c.lon.toFixed(2) : 'null'}`);
  }
}

/* ---------------------------------------------------------------------------
 * WHAT IT CHANGES, AND WHAT IT MUST NOT
 * ------------------------------------------------------------------------- */
section('Lala is a no-op — her two products agree and the fix must not move her');
{
  const { radii, pointByTau } = load('Lala');
  let worst = 0;
  for (const f of radii.features) {
    const tau = Number(f.properties.tau);
    const p = pointByTau.get(tau);
    const c = centreOfRadiiRing(f.geometry, quadOf(f.properties));
    if (!p || !c) continue;
    worst = Math.max(worst, nm(c, { lon: p[0], lat: p[1] }));
  }
  ok(worst < 1,
    `Lala's solved centres must match her forecast points, worst ${worst.toFixed(2)} nm`);
}

section("Moke is the one that moves, and it is not a rounding error");
{
  const { radii, pointByTau } = load('Moke');
  const shifts = [];
  for (const f of radii.features) {
    const tau = Number(f.properties.tau);
    const p = pointByTau.get(tau);
    const c = centreOfRadiiRing(f.geometry, quadOf(f.properties));
    if (!p || !c) continue;
    shifts.push(nm(c, { lon: p[0], lat: p[1] }));
  }
  ok(shifts.length >= 8, `every Moke tau must be measurable, got ${shifts.length}`);
  ok(Math.min(...shifts) > 100,
    `the smallest correction must be real, got ${Math.min(...shifts).toFixed(0)} nm`);
  ok(Math.max(...shifts) < 200,
    `and bounded — a correction past 200 nm means the solve is wrong, got ${Math.max(...shifts).toFixed(0)} nm`);
}

section("Moke's tau 0 lands on the storm, which is the tell");
{
  const { radii } = load('Moke');
  const t0 = radii.features.find((f) => Number(f.properties.tau) === 0);
  const c = centreOfRadiiRing(t0.geometry, quadOf(t0.properties));
  ok(c != null, 'tau 0 must solve');
  ok(c != null && nm(c, { lon: STORMS.Moke.lon, lat: STORMS.Moke.lat }) < 2,
    `the tau-0 ring is the analysis AT the storm; solved ${c ? c.lon.toFixed(2) + ',' + c.lat.toFixed(2) : 'null'} against the feed's -147.20,13.90`);
}

/* ---------------------------------------------------------------------------
 * END TO END — the band NHC published vs the band we draw
 * ------------------------------------------------------------------------- */
const build = (name) => {
  const s = STORMS[name];
  const points = read(`${s.dir}/${s.points}`);
  for (const f of points.features) {
    f.properties._time = parseNhcValidtime(f.properties.validtime, f.properties.advdate);
  }
  return buildFullTrack({
    pastRadii: s.pastRadii ? read(`${s.dir}/${s.pastRadii}`).features : [],
    pastPoints: s.pastPoints ? read(`${s.dir}/${s.pastPoints}`).features : [],
    currentField: s.current ? read(`${s.dir}/${s.current}`).features : [],
    forecastRadii: read(`${s.dir}/${s.radii}`).features,
    forecastPoints: points.features,
    currentPos: { lon: s.lon, lat: s.lat, at: '2026-08-21T21:00:00.000Z' },
  });
};

/**
 * Build with the solve DEFEATED, so the forecast tier falls back to the joined
 * forecast points exactly as it did before §7.13.
 *
 * ==> THE OLD BEHAVIOUR IS REPRODUCED THROUGH THE REAL FALLBACK PATH, NOT BY
 * COPYING IT. <== Replacing each ring's geometry with a triangle makes
 * `centreOfRadiiRing` refuse, which sends the entry down the `centreByTau`
 * branch — the same branch, the same code. A hand-written "old build" here
 * would be a second implementation that could quietly stop matching the one it
 * claims to compare against.
 */
const buildStale = (name) => {
  const s = STORMS[name];
  const points = read(`${s.dir}/${s.points}`);
  for (const f of points.features) {
    f.properties._time = parseNhcValidtime(f.properties.validtime, f.properties.advdate);
  }
  const blinded = read(`${s.dir}/${s.radii}`).features.map((f) => ({
    ...f,
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  }));
  return buildFullTrack({
    pastRadii: [], pastPoints: [], currentField: [],
    forecastRadii: blinded,
    forecastPoints: points.features,
    currentPos: { lon: s.lon, lat: s.lat, at: '2026-08-21T21:00:00.000Z' },
  });
};

/** Share of published wind-rose boundary points that land inside the band we
 *  actually draw. The §7.12 measure, run here against the CENTRES the rings
 *  state rather than the ones the stale product supplied. */
function coverage(name, kt, bands = build(name).filter((f) => Number(f.properties.radii) === kt)) {
  const s = STORMS[name];
  if (!bands.length) return 0;
  const rings = bands.map((f) => f.geometry.coordinates[0]);
  const radii = read(`${s.dir}/${s.radii}`).features
    .filter((f) => Number(f.properties.radii) === kt);

  let inside = 0;
  let total = 0;
  for (const f of radii) {
    const c = centreOfRadiiRing(f.geometry, quadOf(f.properties));
    if (!c) continue;
    const q = quadOf(f.properties);
    const cos = Math.cos(c.lat * Math.PI / 180);
    for (let brg = 0; brg < 360; brg += 5) {
      const r = radiusAtBearing(q, brg) * 0.8; // §7.12's stated 0.8x sample
      if (r <= 0) continue;
      const p = [
        c.lon + (r * Math.sin(brg * Math.PI / 180)) / 60 / cos,
        c.lat + (r * Math.cos(brg * Math.PI / 180)) / 60,
      ];
      total++;
      if (rings.some((ring) => pointInRing(p, ring))) inside++;
    }
  }
  return total ? inside / total : null;
}

function pointInRing(p, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) &&
        p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

section('the drawn band contains the rings it is made of');
{
  /* ==> ASSERTED AS A COMPARISON, NOT AGAINST A NUMBER SOMEONE PICKED. <== The
   * absolute share is held down by the documented smoothing shrink (§7.12) and
   * moves whenever a tuning constant does. What must hold is the DIRECTION: a
   * band drawn around centres the rings state has to contain those rings better
   * than a band drawn around centres a twelve-hour-old product supplied. */
  const mNew = coverage('Moke', 34);
  const mOld = coverage('Moke', 34, buildStale('Moke').filter((f) => Number(f.properties.radii) === 34));
  /* MEASURED on these bytes: 81.2% solved against 58.7% stale, a 22.5 point
   * swing. The bar is 15 — clear of the measurement's own wobble and nowhere
   * near a value the two placements could reach by accident. */
  ok(mNew > mOld + 0.15,
    `Moke's band must contain far more of its own rings than the stale placement did: ${(mNew * 100).toFixed(1)}% vs ${(mOld * 100).toFixed(1)}%`);

  const lNew = coverage('Lala', 34);
  const lOld = coverage('Lala', 34, buildStale('Lala').filter((f) => Number(f.properties.radii) === 34));
  ok(Math.abs(lNew - lOld) < 0.02,
    `and Lala must be untouched — her two products already agreed: ${(lNew * 100).toFixed(1)}% vs ${(lOld * 100).toFixed(1)}%`);
  ok(lNew > 0.5, `Lala's band must still contain its rings, got ${(lNew * 100).toFixed(1)}%`);
}

section("the band's extent brackets every ring NHC published");
{
  const s = STORMS.Moke;
  for (const kt of [34, 50]) {
    const raw = read(`${s.dir}/${s.radii}`).features
      .filter((f) => Number(f.properties.radii) === kt);
    if (!raw.length) continue;
    const lons = [];
    for (const f of raw) {
      (function w(a) { typeof a[0] === 'number' ? lons.push(a[0]) : a.forEach(w); })(f.geometry.coordinates);
    }
    const band = build('Moke').filter((f) => Number(f.properties.radii) === kt);
    ok(band.length > 0, `Moke must still draw a ${kt} kt band`);
    const bl = [];
    for (const f of band) {
      (function w(a) { typeof a[0] === 'number' ? bl.push(a[0]) : a.forEach(w); })(f.geometry.coordinates);
    }
    /* A band that stops short of a ring is a forecast hour silently dropped —
     * the 50 kt band used to end 2.3 deg east of its own tau-36 ring, and the
     * 34 kt band 2.6 deg east of its tau-96 ring. */
    ok(Math.min(...bl) <= Math.min(...lons) + 0.15,
      `the ${kt} kt band must reach its westernmost ring: band ${Math.min(...bl).toFixed(2)} vs ring ${Math.min(...lons).toFixed(2)}`);
  }
}

section('a ring that will not solve is still placed, not dropped');
{
  /* Radii with no recoverable centre — the geometry is a scribble, so the solve
   * refuses — must still land on the joined forecast point. Losing a band is a
   * §5 failure; a band in roughly the right place is not. */
  const built = buildFullTrack({
    pastRadii: [], pastPoints: [], currentField: [],
    forecastRadii: [0, 12, 24].map((tau) => ({
      type: 'Feature',
      properties: { radii: 34, tau, ne: 60, se: 60, sw: 60, nw: 60 },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    })),
    forecastPoints: [0, 12, 24].map((tau) => ({
      type: 'Feature',
      properties: { tau, _time: Date.UTC(2026, 7, 22, 6 + tau) },
      geometry: { type: 'Point', coordinates: [-140 - tau / 12, 15 + tau / 24] },
    })),
    currentPos: { lon: -139.8, lat: 14.9, at: '2026-08-22T05:00:00.000Z' },
  });
  ok(built.length > 0, 'an unsolvable ring must still draw from its joined centre');
  const lons = [];
  for (const f of built) {
    (function w(a) { typeof a[0] === 'number' ? lons.push(a[0]) : a.forEach(w); })(f.geometry.coordinates);
  }
  ok(Math.min(...lons) < -139 && Math.max(...lons) > -145,
    'and must sit on the forecast points, not at the scribble');
}

section("the ring's clock comes with the ring's place, never one of each");
{
  /* ==> THE FORECAST TIER ALONE, BECAUSE THE PAST AND CURRENT TIERS HIDE THIS.
   * <== §7.12 drops any forecast hour already behind the storm. Moke's forecast
   * POINTS put tau 0 at 21/06Z and tau 12 at 21/18Z, both behind the feed's
   * 21:00Z, so ordering by THEM silently drops her two nearest-term rings. Her
   * RADII are valid 21:00Z and 22/06Z and belong on the timeline.
   *
   * With the past and current tiers supplied, the band still starts at the
   * storm either way and the loss is invisible — which is exactly how a
   * mismatched clock survives a suite. Stripped to the forecast tier, the
   * band's near end moves 1.8 deg.
   *
   * Taking the centre from one product and the hour from the other is §7.12's
   * fault mirrored, and it must not be possible to do only half of §7.13. */
  const s = STORMS.Moke;
  const points = read(`${s.dir}/${s.points}`);
  for (const f of points.features) {
    f.properties._time = parseNhcValidtime(f.properties.validtime, f.properties.advdate);
  }
  const fcOnly = buildFullTrack({
    pastRadii: [], pastPoints: [], currentField: [],
    forecastRadii: read(`${s.dir}/${s.radii}`).features,
    forecastPoints: points.features,
    currentPos: { lon: s.lon, lat: s.lat, at: '2026-08-21T21:00:00.000Z' },
  }).filter((f) => Number(f.properties.radii) === 34);

  ok(fcOnly.length > 0, 'the forecast tier alone must still draw a band');
  const lons = [];
  for (const f of fcOnly) {
    (function w(a) { typeof a[0] === 'number' ? lons.push(a[0]) : a.forEach(w); })(f.geometry.coordinates);
  }
  /* tau 0's ring is centred on the storm at -147.20 and reaches 60 nm, so a
   * band that kept it must come east of -148.5. Ordered by the stale points it
   * stops at -149.76. */
  ok(Math.max(...lons) > -148.5,
    `the near-term rings must survive the timeline, band's east end ${Math.max(...lons).toFixed(2)} (stale clock gives -149.76)`);
  ok(Math.min(...lons) < -165,
    `and the far end must still reach tau 96, got ${Math.min(...lons).toFixed(2)}`);
}

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
