#!/usr/bin/env node
/**
 * test-gdacs-corridor.mjs — a GDACS storm's wind-arrival countdown (§49.16).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-gdacs-corridor.mjs`.
 *
 * ===========================================================================
 * WHAT THIS IS ABOUT
 * ===========================================================================
 *
 * Half the world's cyclones come from GDACS, and until §49.16 not one of them
 * could tell a reader when the wind arrives at their house. The data was in
 * the payload the whole time — as POLYGONS rather than as numbers — and
 * `data/home-corridor.js` reads numbers.
 *
 * So the thing under test is a CONVERSION, and the one question that matters
 * about a conversion is whether it changes the answer. It does not: a GDACS
 * band is four constant-radius sectors, and `lib/quadrant-radii.js` reads the
 * sector radii back out exactly. The first section proves that against the
 * real bytes rather than asserting it.
 *
 * ===========================================================================
 * THE FIXTURE IS A REAL GDACS PAYLOAD ALREADY IN THE REPO
 * ===========================================================================
 *
 * `samples/gdacs/geometry-TC.json` — 77 features, 9 forecast hours, all three
 * band classes, and (the part no invented fixture would have had) degenerate
 * zero-area bands at both ends of the run. Every expected value below was
 * MEASURED by running the real functions against it. None was chosen to make
 * an assertion pass.
 *
 * ===========================================================================
 * WHAT THIS CANNOT PROVE
 * ===========================================================================
 *
 * Whether a shorter drawer reads as honest or as broken. A GDACS storm gets
 * the chart, the rail and the headline and does NOT get the past-wind
 * sentence, the earliest-arrival hedge, rainfall or a watch/warning — because
 * nobody publishes them. Whether that lands as "the source knows less" or as
 * "the app is missing something" is glass, and it is Aaron's.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

/* data/home.js reads localStorage at module scope on first getHome(). */
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const near = (a, b, tol, m) =>
  ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b}±${tol})`);
const section = (n) => console.log(`\n  ${n}`);

const RAW = JSON.parse(fs.readFileSync('samples/gdacs/geometry-TC.json', 'utf8'));

/* The relay is never reached: `fetchFeed` gets the fixture verbatim. */
globalThis.fetch = async () => ({
  ok: true, status: 200, headers: { get: () => null },
  json: async () => RAW, text: async () => JSON.stringify(RAW),
});

const { quadrantRadiiNm } = await import('../lib/quadrant-radii.js');
const { radiusAtBearing } = await import('../lib/windswath.js');
const { fetchGdacsGeometry } = await import('../data/gdacs-geometry.js');
const { buildCorridor, crossings } = await import('../data/home-corridor.js');
const { buildHomeDashboard } = await import('../data/home-dashboard.js');
const { countdownHtml } = await import('../ui/countdown-home.js');
const { homeChart } = await import('../ui/chart-home.js');
const { GDACS_GEOMETRY } = await import('../config/constants.js');

/* The storm the fixture describes. Position and time are the ANALYSIS values
 * off the payload's own first forecast dot — read, not chosen. */
const STORM = {
  id: 'gdacs:1001294', source: 'gdacs', name: 'FIXTURE',
  lon: -114.6, lat: 17.1, windKt: 95, category: 2, nature: 'tropical',
  observedAt: '2026-07-28T03:00:00.000Z',
  /* GDACS's basins are the ones NHC publishes no track-error table for, which
   * is load-bearing in section 5 below. */
  basin: 'westPacific',
  raw: { geometryUrl: 'https://www.gdacs.org/gdacsapi/x' },
};
const NOW = Date.parse(STORM.observedAt);

const bundle = await fetchGdacsGeometry(STORM);

/* ======================================================================
 * 1. THE FIXTURE IS WHAT THIS SUITE THINKS IT IS
 *
 * Everything below is measured off these features. If the sample is ever
 * replaced with a payload of a different shape, the numbers would move
 * together and every assertion would still pass — self-consistent fiction.
 * ====================================================================== */
section('the fixture');

const bandFeatures = RAW.features.filter((f) => f.properties?.featuretype === 'WindRadii');
ok(bandFeatures.length === 27, `27 per-timestep band features (${bandFeatures.length})`);
ok(
  new Set(bandFeatures.map((f) => f.properties.Class)).size === 3,
  'across all three band classes'
);
const degenerate = bandFeatures.filter((f) => {
  const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
  const xs = rings.flat().map((p) => p[0]);
  return Math.max(...xs) - Math.min(...xs) < GDACS_GEOMETRY.degenerateSpanDeg;
});
ok(degenerate.length === 5,
   `and 5 of them are zero-area — the case no invented fixture has (${degenerate.length})`);

/* ======================================================================
 * 2. THE CONVERSION IS A RECOVERY, NOT AN ESTIMATE
 *
 * ==> THE CENTRAL CLAIM OF §49.16. <== A GDACS band is four constant-radius
 * sectors. If that is true, the radii read back out are ROUND NUMBERS and the
 * shape's own vertices sit on them to within a rounding step. If it were
 * false — if the bands were organic outlines — the recovered figures would be
 * ragged and this section would say so.
 * ====================================================================== */
section('reading the radii back out of the drawn shape');

const radii = bundle.forecastRadii;
ok(Array.isArray(radii) && radii.length === 27,
   `every band became a radii row (${radii?.length})`);

const roundTo5 = radii.filter((r) =>
  [r.ne, r.se, r.sw, r.nw].every((v) => Math.abs(v - Math.round(v / 5) * 5) < 0.5)
);
ok(roundTo5.length === radii.length,
   `all ${radii.length} rows land on round 5 nm figures — the source's own numbers ` +
   `(${roundTo5.length} did)`);

/* Spot values, measured. The analysis hour's 60 km/h band. */
const tau0 = radii.find((r) => r.tau === 0 && r.kt === 34);
near(tau0.ne, 129.7, 0.4, 'tau 0, 60 km/h band: NE reach');
near(tau0.se, 130.3, 0.4, 'tau 0, 60 km/h band: SE reach');
near(tau0.sw, 90.1, 0.4, 'tau 0, 60 km/h band: SW reach');
near(tau0.nw, 129.7, 0.4, 'tau 0, 60 km/h band: NW reach');

/* ==> THE SEAM TEST, AND IT IS THE ONE THAT EARNS THE WINDOW CONSTANT. <==
 *
 * The claim in `GDACS_GEOMETRY.quadrantWindowDeg` is that a whole-quadrant
 * reading picks up the radial seams and inherits the NEIGHBOUR's radius
 * across them. That is measured here on the real shape, both ways, and the
 * measurement is more specific than the first version of this suite assumed:
 *
 *   - The MEDIAN survives the whole quadrant, because the seam vertices are a
 *     handful against ~90 arc vertices. So the two medians agree.
 *   - The SPREAD does not. Over the whole quadrant it is tens of miles; inside
 *     the window it is a rounding step.
 *
 * That is what the window actually buys: not a different answer today, but a
 * bucket with nothing in it for the median to have to absorb. A band whose
 * sectors were sampled unevenly — which no rule stops GDACS from publishing —
 * would tip a whole-quadrant median and cannot tip a windowed one. */
{
  const orange = RAW.features.find(
    (f) => f.properties?.featuretype === 'WindRadii' &&
           f.properties?.Class === 'Poly_Orange' &&
           f.properties?.polygondate === '2026-07-28T03:00:00'
  );
  const centre = [STORM.lon, STORM.lat];
  const windowed = quadrantRadiiNm(orange.geometry, centre, GDACS_GEOMETRY.quadrantWindowDeg);
  ok(!!windowed, 'the middle-half reading returns a full set of four');
  ok(
    ['ne', 'se', 'sw', 'nw'].every((k) => Math.abs(windowed[k] - Math.round(windowed[k] / 5) * 5) < 0.5),
    'and lands on the round figures'
  );

  /* Both spreads, measured off the same vertices this module walks. */
  const DEG = Math.PI / 180;
  const R_NM = 3440.065;
  const gc = (lo, la) => {
    const dLat = (la - centre[1]) * DEG;
    const dLon = (lo - centre[0]) * DEG;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(centre[1] * DEG) * Math.cos(la * DEG) * Math.sin(dLon / 2) ** 2;
    return R_NM * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  };
  const brg = (lo, la) => {
    const p1 = centre[1] * DEG, p2 = la * DEG, dl = (lo - centre[0]) * DEG;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) / DEG + 360) % 360;
  };
  const rings = orange.geometry.type === 'Polygon'
    ? orange.geometry.coordinates : orange.geometry.coordinates.flat();
  const gap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const spreadWithin = (halfDeg) => {
    const vals = [];
    for (const ring of rings) {
      for (const [lo, la] of ring) {
        if (gap(brg(lo, la), 45) <= halfDeg) vals.push(gc(lo, la));
      }
    }
    return vals.length ? Math.max(...vals) - Math.min(...vals) : null;
  };
  const wholeSpread = spreadWithin(45);
  const windowSpread = spreadWithin(GDACS_GEOMETRY.quadrantWindowDeg / 2);
  ok(wholeSpread > 5,
     `across a whole quadrant the seams span ${wholeSpread?.toFixed(1)} nm of radius`);
  ok(windowSpread < 1,
     `inside the sampling window it collapses to ${windowSpread?.toFixed(2)} nm — a flat sector`);
}

/* Fails closed rather than filling a corner with a zero. */
ok(quadrantRadiiNm({ type: 'Point', coordinates: [0, 0] }, [0, 0], 45) === null,
   'a geometry with no rings returns null, not a set of zeros');
ok(quadrantRadiiNm(
     { type: 'Polygon', coordinates: [[[0.5, 0.5], [0.6, 0.5], [0.6, 0.6], [0.5, 0.5]]] },
     [0, 0], 45
   ) === null,
   'a shape occupying one quadrant returns null rather than zeroing the other three');

/* ==> MUTATION: the window must actually be doing work. <== A window of 90°
 * is the bug this constant exists to prevent, so if the two readings agreed
 * the assertion above would be guarding nothing. Already proven differing
 * above; this states the constant's own bound. */
ok(GDACS_GEOMETRY.quadrantWindowDeg > 0 && GDACS_GEOMETRY.quadrantWindowDeg <= 90,
   'the sampling window stays inside the range where the four windows cannot overlap');
ok(quadrantRadiiNm(bandFeatures[0].geometry, [STORM.lon, STORM.lat], 120) === null,
   'and a window wider than a quadrant is refused outright');

/* ======================================================================
 * 3. A PUBLISHED ZERO SURVIVES AS A ZERO
 *
 * GDACS says "this threshold does not reach this hour" by publishing a
 * zero-area shape, not by omitting the feature. Dropped for drawing (it
 * pinches the corridor), kept for the arithmetic — a published zero is a
 * measurement (spec-parameter §37.5), and losing it would turn "the source
 * says no" into "the source said nothing".
 * ====================================================================== */
section('the published zeros');

const zeros = radii.filter((r) => r.ne === 0 && r.se === 0 && r.sw === 0 && r.nw === 0);
ok(zeros.length === 5,
   `all 5 zero-area bands became explicit zero rows (${zeros.length})`);
ok(zeros.every((r) => r.tau >= 69),
   'and every one of them is at the far end of the forecast, where the field dies out');
ok(radii.filter((r) => r.kt === 64).some((r) => r.ne > 0),
   'the 120 km/h band still has real reach earlier in the run');

/* The drawn layers must NOT have gained them. */
const drawnCurrent = bundle.layers.windCurrent.fc.features;
ok(drawnCurrent.length === 3,
   `the map still draws exactly the three current bands (${drawnCurrent.length})`);

/* ======================================================================
 * 4. THE CORRIDOR — THE WHOLE POINT
 * ====================================================================== */
section('the wind-arrival corridor');

/* Home sits on the forecast track, at the tau-33 position. Chosen so the
 * wind genuinely arrives; a house nowhere near the storm would exercise the
 * all-clear path and prove nothing about arrival. */
const HOME = { lon: -119.0, lat: 18.9 };

const co = buildCorridor({
  storm: STORM, forecast: bundle.forecast, radii: bundle.forecastRadii,
  past: bundle.past, pastRadii: bundle.pastRadii, home: HOME, now: NOW,
});

ok(co.ok, 'the corridor builds');
ok(co.forwardOk, 'with a forward half');
ok(JSON.stringify(co.published) === '[34,50,64]', 'all three thresholds are published');
ok(co.worst === 64, `the worst wind reaching the house is the top band (${co.worst})`);

const arrive = (kt) => co.forecast[kt].windows[0][0];
near((Date.parse(arrive(34)) - NOW) / 3_600_000, 18.4, 0.3,
     'tropical-storm-force wind arrives ~18.4 h out');
near((Date.parse(arrive(50)) - NOW) / 3_600_000, 25.1, 0.3,
     'damaging wind arrives ~25.1 h out');
near((Date.parse(arrive(64)) - NOW) / 3_600_000, 28.2, 0.3,
     'hurricane-force wind arrives ~28.2 h out');
near(co.forecast[64].totalHours, 8.0, 0.2, 'and it is on the house for ~8 hours');

/* ==> ARRIVALS MUST NEST. <== A stronger field lives inside a weaker one, so
 * it cannot arrive first or leave last. If the quadrant recovery ever mixed
 * up which polygon is which threshold, this is what would catch it — and
 * nothing else in the suite would. */
ok(Date.parse(arrive(34)) < Date.parse(arrive(50)), '34 arrives before 50');
ok(Date.parse(arrive(50)) < Date.parse(arrive(64)), '50 arrives before 64');
ok(co.forecast[64].totalHours < co.forecast[50].totalHours, '64 lasts less time than 50');
ok(co.forecast[50].totalHours < co.forecast[34].totalHours, '50 lasts less time than 34');

/* ==> MUTATION CHECK: this suite has to fail when the bug comes back. <== The
 * bug §49.16 fixes is an EMPTY radii array reaching the corridor. Re-run the
 * exact same call with the radii removed and confirm the corridor collapses —
 * an assertion that stayed green here would be guarding nothing at all. */
{
  const broken = buildCorridor({
    storm: STORM, forecast: bundle.forecast, radii: [],
    past: bundle.past, pastRadii: bundle.pastRadii, home: HOME, now: NOW,
  });
  ok(broken.ok === false && broken.unavailable === 'no-radii',
     'with the radii taken away the corridor reports no-radii — so the pass above is real');
}

/* ==> AND THE CENTRE HAS TO BE THE PUBLISHED ONE. <== Measure the same bands
 * from a centre 2° off and the recovered radii move. If they did not, the
 * conversion would not be reading the shape at all. */
{
  const off = quadrantRadiiNm(bandFeatures[0].geometry, [STORM.lon + 2, STORM.lat],
                              GDACS_GEOMETRY.quadrantWindowDeg);
  const right = quadrantRadiiNm(bandFeatures[0].geometry, [STORM.lon, STORM.lat],
                                GDACS_GEOMETRY.quadrantWindowDeg);
  ok(!off || ['ne', 'se', 'sw', 'nw'].some((k) => Math.abs(off[k] - right[k]) > 5),
     'a wrong centre produces different radii — the measurement is of the shape, not of nothing');
}

/* `radiusAtBearing` is the shared blend. Reading the recovered quadrants back
 * through it must land between the flanking sectors, never outside them. */
{
  const r = radiusAtBearing(tau0, 90); // due east, between NE and SE
  ok(r >= Math.min(tau0.ne, tau0.se) - 0.01 && r <= Math.max(tau0.ne, tau0.se) + 0.01,
     'the blend at a seam bearing stays between the two sectors it joins');
}

/* ======================================================================
 * 5. NO HEDGE IS INVENTED FOR A BASIN NOBODY PUBLISHES ERROR BARS FOR
 *
 * `earliest` composes NHC's track-error circle with a wind field. NHC
 * publishes that circle for the Atlantic and the Pacific it forecasts and for
 * nowhere else, so on a GDACS storm there is no error bar to apply. This used
 * to fall through a `?? 0`, which made `gapEarly` identical to `gap` — a
 * dashed "could start this early" line drawn exactly on top of the band edge
 * it hedges, and a Timeline row naming the moment the row above it names.
 * ====================================================================== */
section('the earliest-arrival hedge');

ok(co.earliest[34] === null && co.earliest[50] === null && co.earliest[64] === null,
   'no earliest-arrival figure exists for a basin with no published error table');
ok(co.samples.every((s) => s.gapEarly[34] === null),
   'and no sample carries a shifted gap to build one from');
ok(co.samples.every((s) => s.coneNm === null),
   'because the error circle itself is null here, not zero');

/* ==> AND THE NHC SIDE IS UNTOUCHED. <== Same storm, same geometry, relabelled
 * into a basin NHC does publish a table for. The hedge must come back — if it
 * did not, the fix above would have deleted a real figure from real storms. */
{
  const atl = buildCorridor({
    storm: { ...STORM, basin: 'atlantic' }, forecast: bundle.forecast,
    radii: bundle.forecastRadii, past: bundle.past, pastRadii: bundle.pastRadii,
    home: HOME, now: NOW,
  });
  ok(atl.earliest[34] !== null,
     'in an NHC basin the earliest-arrival figure is still computed');
  ok(Date.parse(atl.earliest[34].windows[0][0]) < Date.parse(arrive(34)),
     'and it is genuinely earlier than the published arrival');
}

/* ======================================================================
 * 6. WHAT REACHES THE SCREEN
 *
 * The rail is the accessible twin of the chart, so its ORDER is not cosmetic.
 * And §34.1's rule stands: GDACS's thresholds are 60/90/120 km/h, near NHC's
 * and deliberately not identical, so nothing a reader can see may call them
 * 34, 50 or 64 kt.
 * ====================================================================== */
section('the screen');

const dash = buildHomeDashboard({
  storm: STORM, forecast: bundle.forecast, past: bundle.past,
  radii: bundle.forecastRadii, pastRadii: bundle.pastRadii,
  home: HOME, now: NOW, trackState: 'ok',
});
ok(!!dash.corridor?.ok, 'the dashboard carries a live corridor');

const rail = countdownHtml(dash, () => 'imperial', (i, t) => `<h3>${t}</h3>`);
ok(rail.length > 0, 'the Timeline renders');

const events = [...rail.matchAll(/<div class="home-rail-ev">([^<]*)<\/div>/g)].map((m) => m[1]);
ok(events.some((e) => /Tropical-storm force wind reaches you/.test(e)),
   'it names the first wind arriving');
ok(events.some((e) => /Hurricane-force wind reaches you/.test(e)),
   'and the worst one');
ok(events.some((e) => /The wind is past you/.test(e)),
   'and the all-clear at the end');

/* ==> THE NUMBERS GDACS DID NOT SAY MUST NOT APPEAR. <== `GDACS_GEOMETRY`'s
 * bandClass note forbids relabelling 60/90/120 km/h as 34/50/64 kt anywhere a
 * user can see. `WIND_LABEL` says what the wind DOES and carries no figure;
 * its fallback (`kt + ' kt'`) does, and this is what stops that fallback ever
 * reaching a GDACS screen unnoticed. */
ok(!/\b(34|50|64)\s*kt\b/.test(rail),
   'the rail never labels a GDACS band with an NHC knot threshold');

const rows = [...rail.matchAll(/<div class="home-rail-lead">([^<]*)<\/div>/g)].map((m) => m[1]);
ok(rows[0] === 'now', 'the rail starts at now');
const hrs = rows.slice(1).map((t) => {
  const m = t.match(/in (\d+) (hrs?|mins?)/);
  return m ? (m[2].startsWith('hr') ? +m[1] : +m[1] / 60) : null;
});
ok(hrs.length > 0 && hrs.every((h) => h != null),
   `every remaining row carries a lead time (${rows.join(' | ')})`);
for (let i = 1; i < hrs.length; i++) {
  ok(hrs[i] >= hrs[i - 1], `the rail runs forwards at row ${i + 1} (${rows.join(' | ')})`);
}

/* ==> AND NO HEDGE ROW. <== Section 5 proves the figure is absent; this
 * proves the row built from it is too. */
ok(!/Wind could start this early/.test(rail),
   'the rail carries no earliest-arrival row for a storm with no error table');

const svg = homeChart(dash, 'imperial');
ok(!!svg && svg.length > 1000, `the chart renders (${svg?.length || 0} chars)`);
ok(!/stroke-dasharray="4 3"/.test(svg),
   'and draws no dashed hedge line on top of the band edge');
ok(/aria-label="[^"]*wind reaches you[^"]*"/.test(svg),
   'the chart states the wind answer for a screen reader');
ok(!/\b(34|50|64)\s*(kt|knot)\b/.test(svg),
   'and the chart never labels a GDACS band with an NHC knot threshold');

/* ======================================================================
 * 7. WHAT GDACS STILL DOES NOT PUBLISH, SAID OUT LOUD
 *
 * §49.16 gives GDACS storms the FORWARD half. The past wind field is still
 * genuinely absent — measured across every live GDACS storm — and the screen
 * has to keep saying so rather than inheriting an all-clear.
 * ====================================================================== */
section('the half that is still missing');

ok(Array.isArray(bundle.pastRadii) && bundle.pastRadii.length === 0,
   'GDACS still publishes no past wind field');
ok(bundle.layers.windPast.status === 'none',
   'and the layer says `none` rather than an error');
ok(co.past === null,
   'so the corridor has no past arm and cannot claim wind did or did not already reach the house');

/* ==> THE ABSENCE IS NOT SILENCE (§5). <== `crossings` on an empty series is
 * the shape every past-tense sentence is gated on; it must return null so the
 * view says "no past wind field is published" instead of "nothing reached
 * you". */
ok(crossings([], 'gap', 34) === null,
   'an unmeasured past reads as null, never as a clear one');

for (const f of failures) console.log(`  ✗ ${f}`);
console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed`
    : `\n✓ ${pass} assertions passed`
);
console.log('  (the numbers are right; whether a shorter drawer READS is glass)');
process.exit(failures.length ? 1 : 0);
