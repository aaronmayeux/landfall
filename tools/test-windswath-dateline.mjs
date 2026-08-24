#!/usr/bin/env node
/**
 * test-windswath-dateline.mjs — the wind corridor at the antimeridian
 * (lib/windswath.js, lib/population-count.js).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-windswath-dateline.mjs`, same as
 * every other suite here (§12 — this project has no toolchain by design).
 *
 * ==> THE FAULT. <== `buildFullTrack` flattens the storm's whole path onto a
 * plane by subtracting each position's longitude from the first one's. Every
 * position arrives wrapped into (-180, 180], so the moment a storm walks onto
 * the seam that subtraction reads two points a hundred miles apart as most of
 * a planet apart, and the corridor is swept the long way round the world.
 *
 * MEASURED 2026-08-24 on Lala CP012026, real archived bytes, before the fix:
 * the built 34 kt band spanned **359.75° of longitude**. Aaron saw a green
 * ring around the globe on his phone.
 *
 * ==> AND THE SAME POLYGON FEEDS THE HEADCOUNT, WHICH IS WHY THIS SUITE
 * COVERS TWO FILES. <== `lib/population-count.js` sees a 359°-wide ring,
 * concludes it must straddle the dateline, and shifts it — producing a shape
 * covering most of the planet and a "People in the path" figure that means
 * nothing. Fixing only the drawing would have left that lying quietly, which
 * is the §5 failure this project cares most about.
 *
 * ==> THE SECOND HALF OF THE FIX IS THE PART THAT COULD HAVE GONE WRONG
 * SILENTLY. <== The corrected envelope is emitted UNWRAPPED, past ±180 — the
 * convention `lib/trackline.js` and `lib/cone-sweep.js` already use, and what
 * makes MapLibre draw one shape across the seam instead of two on opposite
 * rims. A ring running -181.2 to -170.4 is continuous and only 10.8° wide, so
 * the headcount's span test does NOT flag it, its box is [-181.2, -170.4], and
 * every town near +179 falls outside and is never counted. That is an
 * undercount with no symptom at all. Asserted below at §"the headcount".
 *
 * THE FIXTURE IS REAL ARCHIVED BYTES. `samples/lala-cp012026-dateline/` is the
 * 2026-08-24T17:37Z archive run, verbatim. Its nine forecast points run
 * -179.40 through +179.20 — the storm is genuinely on the seam, which is what
 * `samples/lala-cp012026/` (three days earlier, entirely east of it) could not
 * test. The past tier is deliberately NOT here: a megabyte, and the fault
 * reproduces without it, which is itself asserted so nobody re-adds it.
 *
 * ==> THE SPAN ASSERTION IS GENERAL, NOT LALA'S. <== A built band wider than
 * 180° of longitude is a bug for every storm in every basin, forever. It is
 * checked as a rule rather than as a number this fixture happens to produce,
 * so the next basin to reach the seam trips it too.
 *
 * WHAT THIS CANNOT PROVE: that the corridor READS right across the seam on a
 * globe. Whether MapLibre draws one shape or two is a question for a phone.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { buildFullTrack, lonStep, onOneBranch } = await import('../lib/windswath.js');
const { WIND_SWEEP } = await import('../config/constants.js');
const { parseNhcValidtime } = await import('../lib/time.js');
const { peopleInFeatures } = await import('../lib/population-count.js');

const S = 'samples/lala-cp012026-dateline';
const feats = (f) => JSON.parse(readFileSync(`${S}/${f}`, 'utf8')).features;

/* The feed's own record for Lala in that archive run. */
const POS = { lon: -175.3, lat: 33.4, headingDeg: 320 };

function forecastPoints() {
  const fs = feats('forecastPoints.geojson');
  for (const f of fs) {
    f.properties._time = parseNhcValidtime(f.properties.validtime, f.properties.advdate);
  }
  return fs;
}

function build(opts = WIND_SWEEP) {
  return buildFullTrack({
    currentField: feats('windCurrent.geojson'),
    forecastRadii: feats('windSwath.geojson'),
    forecastPoints: forecastPoints(),
    currentPos: { ...POS },
  }, opts);
}

/** How many degrees of longitude a band's ring covers. */
function lonSpan(f) {
  let mn = Infinity;
  let mx = -Infinity;
  for (const [lon] of f.geometry.coordinates[0]) {
    if (lon < mn) mn = lon;
    if (lon > mx) mx = lon;
  }
  return mx - mn;
}

/* ---------------------------------------------------------------------------
 * THE FIXTURE — if this stops being true, nothing below tests anything
 * ------------------------------------------------------------------------- */
section('the fixture still straddles the seam');
{
  const fp = forecastPoints();
  const lons = fp.map((f) => f.geometry.coordinates[0]);
  ok(lons.some((l) => l < -170) && lons.some((l) => l > 170),
    'the forecast points must sit on BOTH sides of ±180 — without that this'
    + ' fixture is just another Central Pacific storm and reproduces nothing');

  const raw = feats('windSwath.geojson');
  ok(raw.length > 0, 'the forecast radii must be present');

  /* Out of tau order on the wire. `buildFullTrack` sorts; a fixture tidied
   * into order would stop testing that it does. */
  const taus = fp.map((f) => Number(f.properties.tau));
  ok(taus.some((t, i) => i > 0 && t < taus[i - 1]),
    'the forecast points must still arrive out of tau order');

  ok(!feats('windCurrent.geojson').some((f) => f.properties.tau > 0),
    'the current field is the current field');
}

/* ---------------------------------------------------------------------------
 * THE STEP — the piece of arithmetic the whole fix rests on
 * ------------------------------------------------------------------------- */
section('the shortest step across the seam');
{
  ok(Math.abs(lonStep(179.9, -179.9) - 0.2) < 1e-9,
    `179.9 -> -179.9 is a fifth of a degree east, got ${lonStep(179.9, -179.9)}`);
  ok(Math.abs(lonStep(-179.9, 179.9) + 0.2) < 1e-9,
    `-179.9 -> 179.9 is a fifth of a degree west, got ${lonStep(-179.9, 179.9)}`);
  ok(lonStep(-175, -170) === 5, 'and an ordinary step is left alone');
  ok(lonStep(-5, 5) === 10,
    'the PRIME meridian is not a branch cut — a step across 0 must be untouched');
  ok(lonStep(0, 180) === 180 && lonStep(0, -180) === 180,
    'exactly opposite resolves east, once, rather than oscillating');

  const chained = onOneBranch([
    { lon: -179.4, lat: 36.9 }, { lon: 179.2, lat: 38.3 }, { lon: 177.0, lat: 40.5 },
  ]);
  ok(chained.map((p) => p.lon).every((l, i) => i === 0 || Math.abs(l - chained[i - 1].lon) < 5),
    'a chained timeline must never take a 350° step');
  ok(chained[1].lon < -180,
    `the eastern points move onto the western branch, got ${chained[1].lon}`);
  ok(chained[0].lat === 36.9 && chained[2].lat === 40.5,
    'and latitude is not touched');
}

/* ---------------------------------------------------------------------------
 * THE COINCIDENT FIX — the seam's second, quieter door
 *
 * The past tier and the current tier overlap: the newest archived fix is
 * usually the same observation the feed is reporting. It is dropped so the
 * tier seam carries no zero-length segment (§4), and the test for "same place"
 * subtracted raw longitudes. Two thousandths of a degree apart across ±180
 * subtracts to 359.97, so on the seam the duplicate survived.
 *
 * ==> IT IS OBSERVABLE, WHICH IS WHY IT IS ASSERTED RATHER THAN ARGUED. <==
 * Measured 2026-08-24: with the duplicate kept, the corridor's resampled ring
 * differs from the one built without it. Synthetic positions, because no
 * archived run happens to have the tiers overlapping ON the seam, and the
 * question here is arithmetic rather than data shape.
 * ------------------------------------------------------------------------- */
section('a past fix coincident with the storm is dropped across the seam');
{
  const quad = { ne: 90, se: 80, sw: 70, nw: 85 };
  const point = (lon, lat, dtg) => ({
    type: 'Feature', properties: { dtg }, geometry: { type: 'Point', coordinates: [lon, lat] },
  });
  const radii = (synoptime) => ({
    type: 'Feature', properties: { radii: 34, synoptime, ...quad }, geometry: null,
  });

  const currentPos = { lon: -179.99, lat: 30.0 };
  const stamps = ['2026082400', '2026082406', '2026082412'];
  /* The newest past fix is 179.98 — two thousandths of a degree from the feed
   * position, on the far side of the number line. */
  const pastPoints = [
    point(178.0, 29.0, stamps[0]), point(179.0, 29.5, stamps[1]), point(179.98, 30.0, stamps[2]),
  ];
  const common = {
    pastRadii: stamps.map(radii),
    currentField: [{ type: 'Feature', properties: { radii: 34, ...quad }, geometry: null }],
    forecastRadii: [], forecastPoints: [], currentPos,
  };

  const sig = (fs) => JSON.stringify(fs.map((f) => f.geometry.coordinates[0]
    .map((v) => v.map((n) => n.toFixed(4)).join(',')).join('|')));

  const withDup = buildFullTrack({ ...common, pastPoints });
  const without = buildFullTrack({ ...common, pastPoints: pastPoints.slice(0, 2) });

  ok(withDup.length > 0 && without.length > 0, 'both builds must draw a band');
  ok(sig(withDup) === sig(without),
    'a past fix sitting on the storm must be dropped whichever side of ±180 it'
    + ' is written on — the corridor must not depend on how the source wrapped it');
}

/* ---------------------------------------------------------------------------
 * THE BANDS
 * ------------------------------------------------------------------------- */
section('no band wraps the planet');
{
  const out = build();
  ok(out.length > 0,
    'bands are still drawn — a seam fix that empties the layer is a §5 bug');

  for (const f of out) {
    const span = lonSpan(f);
    ok(span < 180,
      `the ${f.properties.radii} kt band spans ${span.toFixed(2)}° of longitude;`
      + ' anything past 180° has been swept the wrong way round the world');
    ok(span > 0, `the ${f.properties.radii} kt band must have real width`);
  }

  /* The corridor is a five-day Pacific storm, not a hemisphere. A generous
   * bound: the general rule above is the contract, this is the sanity check. */
  const widest = Math.max(...out.map(lonSpan));
  ok(widest < 60,
    `the widest band should be tens of degrees across, got ${widest.toFixed(2)}°`);

  /* Continuity past the seam is the POINT, not an accident: one shape running
   * past -180 rather than two shapes on opposite rims. */
  const past180 = out.filter((f) => f.geometry.coordinates[0].some(([lon]) => lon < -180));
  ok(past180.length > 0,
    'at least one band must run past -180 — a corridor that stopped dead at the'
    + ' seam would be two shapes on opposite edges of the map');
}

section('rings are still well formed after the branch change');
{
  for (const f of build()) {
    const r = f.geometry.coordinates[0];
    ok(r.length > 3, `a band must have a real ring, got ${r.length} vertices`);
    ok(r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1],
      'every ring must still be closed');
    ok(r.every((v) => Number.isFinite(v[0]) && Number.isFinite(v[1])),
      'no band may carry a non-finite coordinate');
    ok(r.every(([, lat]) => lat >= -90 && lat <= 90),
      'no band may carry an impossible latitude');
  }
}

/* ---------------------------------------------------------------------------
 * THE HEADCOUNT — the half of the fix with no visible symptom
 * ------------------------------------------------------------------------- */
section('the headcount reads a ring that runs past ±180');
{
  /* A square straddling the seam, written the way the swath builder now emits
   * one: continuous, longitudes running past -180. 4°x4° centred on 179.5°E.
   * Towns are supplied directly so the assertion is about the geometry and not
   * about who happens to live in the North Pacific. */
  const ring = [
    [-178.5, 30], [-182.5, 30], [-182.5, 34], [-178.5, 34], [-178.5, 30],
  ];
  const shape = [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } }];

  /* lon, lat, population — flat triples, the form peopleInFeatures reads. */
  const towns = new Float64Array([
    179.0, 32, 1000,   // inside, eastern side of the seam
    -179.5, 32, 2000,  // inside, western side
    177.0, 32, 4000,   // outside to the west of the box
    -176.0, 32, 8000,  // outside to the east
  ]);

  const got = peopleInFeatures(towns, shape);
  ok(got.people === 3000,
    'a seam-straddling ring written past ±180 must count both sides and nothing'
    + ` else — expected 3000 people, got ${got.people}`);
  ok(got.towns === 2, `and exactly two towns, got ${got.towns}`);
}

section('and the ordinary case is unchanged');
{
  const ring = [[-100, 20], [-96, 20], [-96, 24], [-100, 24], [-100, 20]];
  const shape = [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } }];
  const towns = new Float64Array([-98, 22, 5000, -90, 22, 9000]);
  ok(peopleInFeatures(towns, shape).people === 5000,
    'a ring nowhere near the seam must count exactly what it always did');
}

section('a ring spanning the prime meridian is not mistaken for a seam ring');
{
  const ring = [[-2, 10], [2, 10], [2, 14], [-2, 14], [-2, 10]];
  const shape = [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } }];
  const towns = new Float64Array([0, 12, 7000, 179, 12, 1000, -179, 12, 1000]);
  ok(peopleInFeatures(towns, shape).people === 7000,
    'longitude 0 is not a branch cut; a shape across it counts only what is'
    + ' inside it, and nothing on the far side of the world');
}

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
