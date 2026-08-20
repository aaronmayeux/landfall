/**
 * test-cone-dateline.mjs — a cone cut in half by the date line still measures.
 *
 * ==> THE BUG THIS EXISTS AGAINST. <== `lib/cone-smooth.js` had ONE gate in
 * front of both the cone REBUILD and the cone MEASUREMENT: single polygon
 * only. That bar is right for the rebuild — a multi-part cone has no single
 * spine and sweeping one track through two shapes invents an outline nobody
 * published — and it is wrong for the measurement, which rays against every
 * ring and draws nothing.
 *
 * NHC's MapServer cuts a cone at ±180 and returns the halves as a
 * MultiPolygon. So EVERY Central Pacific storm whose five-day cone reaches the
 * seam failed the shared gate, got `ribs: null`, and the environment ribbon
 * told the reader *"This cone could not be measured"* about a cone that
 * measures perfectly. SHIPS covers the Central Pacific; this was a live basin
 * silently missing a whole feature, not a corner case.
 *
 * Aaron saw it on Lala, 2026-08-20: Environment switched on, the drawer's
 * environment paragraph full of real numbers, and a grey cone.
 *
 * ==> IT ASSERTS AGAINST THE REAL BYTES, NOT A SHAPE SOMEBODY DREW. <== The
 * three fixtures are exactly what the MapServer served for advisory 33, off
 * the archive branch, and the SHIPS run is the file NHC published at 12Z the
 * same morning. A synthetic two-part cone would have been built by whoever
 * wrote the fix, out of the same idea of the bug as the fix — which is the one
 * kind of test that agrees with the code instead of checking it.
 *
 * Zero dependencies, plain node.
 */

import fs from 'node:fs';
import { smoothCone } from '../lib/cone-smooth.js';
import { buildRibbon } from '../lib/cone-ribbon.js';
import { measureConeRibs } from '../lib/cone-measure.js';
import { stitchDatelineSplit } from '../lib/seam-stitch.js';
import { parseShips } from '../functions/api/nhc/_ships-parse.js';
import { DARK } from '../config/tokens.js';

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.log(`  ✗ ${msg}`); failures++; }
};
const section = (t) => console.log(`\n  ${t}\n`);

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const CONE = read('../samples/lala-cp012026/cone-033-multipolygon.geojson');
const TRACK = read('../samples/lala-cp012026/forecast-track-033.geojson');
const POINTS = read('../samples/lala-cp012026/forecast-points-033.geojson');
const SHIPS = {
  status: 'ok',
  ...parseShips(
    fs.readFileSync(new URL('../samples/ships/26082012CP0126_ships.txt', import.meta.url), 'utf8'),
    'cp012026'
  ),
};

const FORECAST = POINTS.features.map((f) => ({
  lon: f.geometry.coordinates[0],
  lat: f.geometry.coordinates[1],
  tau: f.properties.tau,
}));

const bundleOf = () => ({
  forecast: FORECAST,
  layers: {
    cone: { status: 'ok', fc: structuredClone(CONE) },
    forecastTrack: { status: 'ok', fc: structuredClone(TRACK) },
  },
});

/* ========================================================================= */
section('the fixture really is a cone cut in half by the date line');

const geom = CONE.features[0].geometry;
ok(geom.type === 'MultiPolygon', `NHC served it as a ${geom.type}, not a Polygon`);
ok(geom.coordinates.length === 2, `in two parts (${geom.coordinates.length})`);

const spans = geom.coordinates.map((poly) => {
  const lons = poly[0].map((c) => c[0]);
  return [Math.min(...lons), Math.max(...lons)];
});
/* ==> THE TWO HALVES SIT ON OPPOSITE SIDES OF ±180, WHICH IS THE WHOLE POINT.
 * <== A MultiPolygon whose parts were both in the western hemisphere would be
 * a different fixture testing a different thing, and the fix would look
 * correct against it while the seam case still failed. */
ok(spans.some(([lo]) => lo <= -179.9), `one half runs to the seam from the west (${spans.map(([a, b]) => `${a.toFixed(1)}..${b.toFixed(1)}`).join(' , ')})`);
ok(spans.some(([, hi]) => hi >= 179.9), 'and the other reaches it from the east');

/* ========================================================================= */
section('the measurement handles it, and always could have');

const rings = geom.coordinates.flat();
const direct = measureConeRibs(TRACK.features[0].geometry.coordinates, rings);
ok(direct && direct.ribs.length > 100,
   `measureConeRibs on both rings returns ${direct ? direct.ribs.length : 0} stations`);
ok(direct && direct.ribs.every((r) => r.ok !== false),
   'and every one of them found the cone — the seam costs no station at all');

/* ==> THE GATE WAS THE ONLY THING IN THE WAY, AND THIS IS WHAT PROVES IT. <==
 * The assertion above is about `measureConeRibs` in isolation and passed
 * BEFORE the fix as well. The one below is about `smoothCone`, which is where
 * the gate lived, and it is the assertion that fails on the bug. */
section('smoothCone hands the ribs on rather than dropping them');

const smoothed = smoothCone(bundleOf(), 'LALA');
const ribs = smoothed.layers.cone.ribs;
ok(Array.isArray(ribs) && ribs.length >= 2,
   `a dateline-split cone comes back measured (${ribs ? ribs.length : 'null'} stations) — ` +
   'this is the assertion that fails when the sweep gate and the measure gate share a test');
ok(smoothed.layers.cone.caps?.start && smoothed.layers.cone.caps?.end,
   'with both end caps');

/* THE DRAWING IS THE OTHER HALF OF THE PROMISE, AND IT USED TO BE THE UGLY
 * HALF. The cone is stitched back into one polygon before anything reads it,
 * so what ships to MapLibre is a single continuous outline with no artificial
 * edge down the meridian. */
const drawn = smoothed.layers.cone.fc.features[0];
ok(drawn.geometry.type === 'Polygon',
   `the cone is drawn as one continuous Polygon (${drawn.geometry.type})`);
ok(drawn.geometry.coordinates.length === 1, 'with a single ring and no holes');

/* ==> AND IT REACHES PAST −180 RATHER THAN STOPPING AT IT. <== The eastern
 * half is carried unwrapped, the same convention lib/trackline.js uses for the
 * track, which is what makes the two halves one shape instead of two on
 * opposite rims of the map. */
{
  const lons = drawn.geometry.coordinates[0].map((c) => c[0]);
  ok(Math.min(...lons) < -180,
     `and runs past the meridian to ${Math.min(...lons).toFixed(2)}, not stopping at −180`);
  ok(Math.max(...lons) < 0, 'with no vertex wrapping back to positive longitude');
}

/* ==> NO STRAIGHT EDGE LEFT ALONG THE MERIDIAN. <== This is the assertion that
 * describes what Aaron actually saw: `curveGeometry` rounds every corner it is
 * given, so an artificial seam edge became a curved nose bulging across the
 * line — western half to −180.24, eastern to +180.22 — and the cone's outline
 * layer stroked both as if they were real cone edges. Two overlapping lens
 * shapes with a hard line down the middle. A stitched ring may still CROSS the
 * meridian, but it must never run ALONG it. */
{
  const ring = drawn.geometry.coordinates[0];
  let adjacent = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    if (Math.abs(Math.abs(a[0]) - 180) < 1e-3 && Math.abs(Math.abs(b[0]) - 180) < 1e-3
        && Math.abs(a[1] - b[1]) > 1e-3) adjacent++;
  }
  ok(adjacent === 0,
     `no segment runs along the meridian (${adjacent} found) — the cut edge is gone, not rounded`);
}

/* ========================================================================= */
section('and the ribbon paints, on a real SHIPS run');

const built = buildRibbon({
  ribs,
  caps: smoothed.layers.cone.caps,
  forecast: FORECAST,
  run: SHIPS,
  stops: DARK.geo.envRamp,
  sea: DARK.ocean,
});

ok(built.status === 'ok', `status ok (got ${built.status} / ${built.reason})`);
ok(built.reason === null, 'with no absence to name');

const kind = (n) => built.features.filter((f) => f.properties._kind === n);
ok(kind('slice').length > 20, `${kind('slice').length} colored slices`);
ok(kind('line').length > 20, `${kind('line').length} colored centreline segments`);
ok(built.fromHr === 0, `covering from hour ${built.fromHr}`);
ok(built.toHr >= 96, `out to hour ${built.toHr}`);

/* ==> EVERY SLICE CARRIES A COLOR, OR IT IS A HOLE IN THE CONE. <== */
ok(kind('slice').every((f) => /^#[0-9a-fA-F]{6}$/.test(f.properties._color || '')),
   'every slice has a resolved hex color, never an unresolved expression');

/* ==> THE GEOMETRY STAYS ON ONE BRANCH ACROSS THE SEAM. <== The app's
 * convention (lib/trackline.js) is to leave longitude UNWRAPPED so MapLibre
 * draws one continuous shape across ±180: a point at 178°E is carried as
 * −182. A slice that wrapped back to +178 would be drawn most of the way round
 * the planet, which is a stripe across the whole map rather than a missing
 * one — far more obvious, and worth an assertion so it can never be
 * "corrected" into existence. */
const allLons = built.features
  .flatMap((f) => JSON.stringify(f.geometry).match(/-?\d+(\.\d+)?/g).map(Number))
  .filter((v) => v < -100 || v > 100);
ok(Math.max(...allLons) < 0,
   `no ribbon vertex jumps back to positive longitude (max ${Math.max(...allLons).toFixed(2)})`);
ok(Math.min(...allLons) > -190,
   `and none runs away past one turn (min ${Math.min(...allLons).toFixed(2)})`);

/* ========================================================================= */
section('the two halves are stitched back into one shape');

/* ==> AREA IS THE ASSERTION THAT CANNOT BE FUDGED. <== A stitch that dropped a
 * stretch of outline, doubled one back on itself, or tied a bow at the join
 * would still close and still look plausible in a coordinate dump. The area
 * would not survive any of them. NHC publishes its own figure in
 * `st_area(shape)`, so this is checked against the SOURCE's arithmetic rather
 * than against ours. */
{
  const stitched = stitchDatelineSplit(geom);
  ok(stitched.type === 'Polygon', `two parts become one ${stitched.type}`);

  const shoelace = (ring) => {
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return Math.abs(a / 2);
  };
  const whole = shoelace(stitched.coordinates[0]);
  const parts = geom.coordinates.reduce((a, p) => a + shoelace(p[0]), 0);
  const published = CONE.features[0].properties['st_area(shape)'];
  ok(Math.abs(whole - parts) < 1e-6,
     `the stitched area equals the two parts summed (${whole.toFixed(4)} vs ${parts.toFixed(4)})`);
  ok(Math.abs(whole - published) < 1e-3,
     `and equals NHC's own st_area(shape) of ${published.toFixed(4)}`);

  const ring = stitched.coordinates[0];
  ok(ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1],
     'the ring closes');
  ok(ring.length === geom.coordinates[0][0].length + geom.coordinates[1][0].length - 3,
     `every published vertex survives bar the three the join makes duplicate (${ring.length})`);
}

/* ==> AND IT DECLINES ANYTHING THAT IS NOT A CLEAN TWO-PART CUT. <== §5: the
 * repair must never return something worse than what it was handed. */
{
  const single = { type: 'Polygon', coordinates: [geom.coordinates[0][0]] };
  ok(stitchDatelineSplit(single) === single, 'a Polygon is handed straight back');

  /* Two parts that both touch the meridian but do not share the same cut —
   * the second half's latitudes moved — must not be joined. */
  const mismatched = structuredClone(geom);
  mismatched.coordinates[1][0] = mismatched.coordinates[1][0].map((c) => [c[0], c[1] + 5]);
  ok(stitchDatelineSplit(mismatched).type === 'MultiPolygon',
     'two halves whose seam edges disagree are left alone');

  const three = structuredClone(geom);
  three.coordinates.push(structuredClone(geom.coordinates[1]));
  ok(stitchDatelineSplit(three).type === 'MultiPolygon',
     'and so is anything that is not exactly two parts');
}

/* ========================================================================= */
section('a single-polygon cone is unaffected');

/* ==> THE CHANGE MUST NOT REACH THE COMMON PATH. <== Same fixture with one
 * part removed is an ordinary western-hemisphere cone, and it has to go on
 * being offered to the REBUILD first, exactly as before. */
const onePart = bundleOf();
const big = CONE.features[0].geometry.coordinates[0];
onePart.layers.cone.fc.features[0].geometry = { type: 'Polygon', coordinates: big };
const singleOut = smoothCone(onePart, 'LALA-ONE');
ok(Array.isArray(singleOut.layers.cone.ribs) && singleOut.layers.cone.ribs.length >= 2,
   `a single-polygon cone still measures (${singleOut.layers.cone.ribs?.length} stations)`);

console.log(
  failures
    ? `\n✗ ${failures} failed\n`
    : '\n✓ the date line no longer costs a storm its environment ribbon\n' +
      '  (whether the violet reads across the seam is glass)\n'
);
process.exit(failures ? 1 : 0);
