#!/usr/bin/env node
/**
 * test-seam-layers.mjs — the antimeridian cut, undone on every layer that
 * carries one (`lib/seam-stitch.js` wired at `data/nhc-mapserver.js`).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-seam-layers.mjs`.
 *
 * ==> WHAT WAS WRONG. <== NHC's MapServer wraps geometry into (−180, 180], so
 * any shape crossing the antimeridian is CUT along the meridian and returned as
 * a `MultiPolygon` whose two parts each carry a straight artificial edge down
 * the seam. `lib/seam-stitch.js` undoes that, and on 2026-08-20 it was wired to
 * the CONE alone — because the cone was the only layer anyone had cut bytes
 * for. SPEC-MAP.md §7.9 recorded the scope honestly and predicted the rest
 * would be "a call site, not a design".
 *
 * ==> THE BYTES ARRIVED 2026-08-24. <== Lala CP012026 tracked northwest onto
 * the seam. Her cone arrives cut and so do two of her forecast wind rings. Her
 * CURRENT wind field is still whole only because at 176°W it has not reached
 * ±180 yet — and that is the layer that would have shown the fault, because it
 * is drawn RAW: `map/layers/wind-field.js` reads the `windCurrent` slot
 * straight and nothing ever replaces it the way the envelope builder replaces
 * `windSwath`. Cut and unrepaired it draws two blobs on opposite rims of the
 * map with the artificial edges stroked as real wind-field edges.
 *
 * ==> SO THIS SUITE TESTS THE REPAIR ON RINGS THAT ARE REALLY CUT, AND TESTS
 * THE WIRING SEPARATELY. <== The repair is exercised on `samples/
 * lala-cp012026-dateline/windSwath.geojson` — genuinely cut wind rings from the
 * archive, not a cone and not a shape anybody drew to match the fix. The wiring
 * is exercised by running the module's own `stitchSeams` shape over a whole
 * layer and checking nothing else moved.
 *
 * ==> AREA IS THE ASSERTION THAT PROVES A STITCH. <== A repair that dropped a
 * stretch of outline, or tied a bow at the join, would still close and still
 * look plausible in a coordinate dump. The stitched ring's area must match the
 * two halves' areas added together — measured on a plane, since the shapes are
 * small and the question is whether any outline went missing.
 *
 * WHAT THIS CANNOT PROVE: that the repaired wind field READS as one shape on a
 * globe. That is a question for a phone.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { stitchDatelineSplit } = await import('../lib/seam-stitch.js');
const { buildFullTrack } = await import('../lib/windswath.js');
const { WIND_SWEEP } = await import('../config/constants.js');
const { parseNhcValidtime } = await import('../lib/time.js');

const S = 'samples/lala-cp012026-dateline';
const feats = (f) => JSON.parse(readFileSync(`${S}/${f}`, 'utf8')).features;

/** Twice the signed area of a closed ring, on the raw lon/lat plane. */
function ringArea2(r) {
  let s = 0;
  for (let i = 0; i < r.length; i += 1) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

/** Longitude span of a geometry, whatever its type. */
function lonSpan(geometry) {
  let mn = Infinity;
  let mx = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === 'number') { mn = Math.min(mn, c[0]); mx = Math.max(mx, c[0]); return; }
    c.forEach(walk);
  };
  walk(geometry.coordinates);
  return { mn, mx, span: mx - mn };
}

/* The wiring, mirrored from data/nhc-mapserver.js. Kept here rather than
 * imported because that module reaches the network on load; the SHAPE of the
 * wiring is what is asserted, and a drift between the two is caught by the
 * relay-mirror check the same way every other mirror in tools/ is. */
const stitchSeams = (fc) => ({
  ...fc,
  features: (fc.features || []).map((f) => (
    f.geometry?.type === 'MultiPolygon'
      ? { ...f, geometry: stitchDatelineSplit(f.geometry) }
      : f
  )),
});

/* ---------------------------------------------------------------------------
 * THE FIXTURE
 * ------------------------------------------------------------------------- */
section('the fixture carries wind rings the source really cut');
{
  const cut = feats('windSwath.geojson').filter((f) => f.geometry?.type === 'MultiPolygon');
  ok(cut.length === 2,
    `the forecast radii must carry exactly two cut rings, got ${cut.length}`
    + ' — if this changed the fixture has been swapped and reproduces nothing');

  for (const f of cut) {
    ok(f.geometry.coordinates.length === 2,
      'a cut ring arrives as exactly two parts');
    /* ==> THE SIDE IS THE BOX'S MIDPOINT, NOT THE FIRST VERTEX. <== A cut part
     * routinely STARTS at exactly ±180, which is the boundary itself and says
     * nothing about which side the part lives on. Measured: tau 72's eastern
     * half begins at 180.00000000010016 and tau 96's western half begins at
     * -179.99992399999252. The box midpoint is unambiguous. */
    const mids = f.geometry.coordinates.map((poly) => {
      let mn = Infinity;
      let mx = -Infinity;
      for (const [lon] of poly[0]) { mn = Math.min(mn, lon); mx = Math.max(mx, lon); }
      return (mn + mx) / 2;
    });
    ok(mids.some((m) => m > 0) && mids.some((m) => m < 0),
      `tau ${f.properties.tau}: the two parts must sit on OPPOSITE sides of ±180`
      + ` — that is what makes it a cut, got midpoints ${mids.map((m) => m.toFixed(2))}`);
  }

  /* The current field is NOT cut yet, and the suite says so out loud so that
   * when it becomes cut nobody reads this as the fixture rotting. */
  ok(!feats('windCurrent.geojson').some((f) => f.geometry?.type === 'MultiPolygon'),
    'the current wind field is still whole in this run — it had not reached the'
    + ' seam at 175.3°W. When a future capture has it cut, that is the layer'
    + ' this whole fix exists for, not a broken fixture');
}

/* ---------------------------------------------------------------------------
 * THE REPAIR, ON REAL CUT WIND RINGS
 * ------------------------------------------------------------------------- */
section('a cut wind ring is stitched back into one shape');
{
  const cut = feats('windSwath.geojson').filter((f) => f.geometry?.type === 'MultiPolygon');

  for (const f of cut) {
    const label = `${f.properties.radii} kt tau ${f.properties.tau}`;
    const before = f.geometry.coordinates.map((poly) => poly[0]);
    const out = stitchDatelineSplit(f.geometry);

    ok(out.type === 'Polygon',
      `${label}: a clean two-part cut must come back as one Polygon, got ${out.type}`);
    if (out.type !== 'Polygon') continue;

    const ring = out.coordinates[0];
    ok(ring.length > 3, `${label}: the stitched ring must have real extent`);
    ok(ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1],
      `${label}: the stitched ring must be closed`);
    ok(ring.every((v) => Number.isFinite(v[0]) && Number.isFinite(v[1])),
      `${label}: no non-finite coordinate may survive the stitch`);

    /* ==> AREA IS WHAT PROVES NOTHING WENT MISSING. <== */
    const want = before.reduce((s, r) => s + Math.abs(ringArea2(r)), 0);
    const got = Math.abs(ringArea2(ring));
    ok(Math.abs(got - want) / want < 0.02,
      `${label}: the stitched shape must cover what the two halves covered —`
      + ` halves ${want.toFixed(4)}, stitched ${got.toFixed(4)}`);

    /* One shape across the seam, not two on opposite rims. */
    const { span, mn, mx } = lonSpan(out);
    ok(span < 180,
      `${label}: the stitched ring spans ${span.toFixed(2)}° — a stitch that`
      + ' left the halves on different branches is worse than the cut');
    ok(mn < -180 || mx > 180,
      `${label}: the stitched ring must run past ±180 (got ${mn.toFixed(2)}..`
      + `${mx.toFixed(2)}) — that is what makes MapLibre draw it as one shape`);

    /* The artificial edge is gone: no two consecutive vertices both sitting on
     * the meridian with real latitude between them. */
    let seamEdges = 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const a = ring[i];
      const b = ring[i + 1];
      const onSeam = (p) => Math.abs(Math.abs(p[0]) - 180) <= 1e-4;
      if (onSeam(a) && onSeam(b) && Math.abs(a[1] - b[1]) > 1e-4) seamEdges += 1;
    }
    ok(seamEdges === 0,
      `${label}: ${seamEdges} artificial seam edge(s) survived — the outline`
      + ' layer strokes every edge it is handed, so a survivor draws as a hard'
      + ' line down the middle of a shape that has no edge there');
  }
}

/* ---------------------------------------------------------------------------
 * THE WIRING
 * ------------------------------------------------------------------------- */
section('the wiring repairs the cut features and leaves everything else alone');
{
  for (const name of ['windSwath.geojson', 'windCurrent.geojson', 'forecastPoints.geojson']) {
    const before = feats(name);
    const after = stitchSeams({ type: 'FeatureCollection', features: before }).features;

    ok(after.length === before.length,
      `${name}: the repair must not add or drop a feature`);

    for (let i = 0; i < before.length; i += 1) {
      ok(JSON.stringify(after[i].properties) === JSON.stringify(before[i].properties),
        `${name}: feature ${i} lost or gained a property`);
      if (before[i].geometry?.type !== 'MultiPolygon') {
        ok(after[i] === before[i],
          `${name}: feature ${i} is not cut and must be handed back untouched,`
          + ' not rebuilt — an untouched feature is the cheap common path');
      } else {
        /* ==> THE ASSERTION THIS SECTION WAS MISSING. <== Checking only that
         * uncut features pass through unchanged is a test that passes just as
         * happily against a repair that does NOTHING. Mutating `stitchSeams`
         * into a pass-through left every other assertion here green. */
        ok(after[i].geometry.type === 'Polygon',
          `${name}: feature ${i} arrived cut and must come back as one Polygon,`
          + ` got ${after[i].geometry.type} — the wiring is not doing anything`);
        ok(after[i] !== before[i],
          `${name}: feature ${i} arrived cut and must be a NEW object`);
      }
    }
  }

  const cutCount = feats('windSwath.geojson')
    .filter((f) => f.geometry?.type === 'MultiPolygon').length;
  const repaired = stitchSeams({ features: feats('windSwath.geojson') }).features
    .filter((f) => f.geometry?.type === 'Polygon').length;
  ok(cutCount === 2 && repaired === feats('windSwath.geojson').length,
    `every ring must be a single Polygon after the wiring — ${cutCount} arrived`
    + ` cut, ${repaired} of ${feats('windSwath.geojson').length} came back whole`);

  /* A Point layer has nothing to repair and must come through identical. */
  const pts = feats('forecastPoints.geojson');
  ok(stitchSeams({ features: pts }).features.every((f, i) => f === pts[i]),
    'a Point layer passes through by reference');
}

section('the repair never returns something worse than its input');
{
  /* Two polygons that both touch the meridian but are NOT two halves of one
   * cut: their seam edges disagree, so this is not a stitch. §5 — hand it back
   * rather than invent a join. */
  const notACut = {
    type: 'MultiPolygon',
    coordinates: [
      [[[180, 10], [180, 20], [175, 20], [175, 10], [180, 10]]],
      [[[-180, 40], [-180, 50], [-175, 50], [-175, 40], [-180, 40]]],
    ],
  };
  const out = stitchDatelineSplit(notACut);
  ok(out === notACut,
    'two unrelated shapes that merely both touch ±180 must be handed straight'
    + ' back, by reference — joining them would invent an outline no source'
    + ' published');

  /* Three parts is not a clean two-part cut. */
  const three = { type: 'MultiPolygon', coordinates: [...notACut.coordinates, notACut.coordinates[0]] };
  ok(stitchDatelineSplit(three) === three, 'a three-part shape is handed back');

  /* A shape that never goes near the meridian. */
  const plain = {
    type: 'MultiPolygon',
    coordinates: [[[[-100, 20], [-96, 20], [-96, 24], [-100, 24], [-100, 20]]]],
  };
  ok(stitchDatelineSplit(plain) === plain, 'a shape nowhere near ±180 is handed back');

  /* Not a polygon at all. */
  const line = { type: 'LineString', coordinates: [[179, 10], [-179, 10]] };
  ok(stitchDatelineSplit(line) === line, 'a LineString is not this function\'s problem');
  ok(stitchDatelineSplit(null) === null, 'and null does not throw');
}

/* ---------------------------------------------------------------------------
 * THE PATH THAT ALREADY WORKED
 * ------------------------------------------------------------------------- */
section('stitching the forecast radii does not disturb the built corridor');
{
  /* ==> THIS IS THE ASSERTION THAT MADE THE WIRING SAFE TO DO AT THE DOOR.
   * <== The forecast radii feed the swath envelope builder, which solves each
   * ring's own centre out of its geometry (§7.13). Handing it stitched rings
   * instead of cut ones must change nothing, or a repair aimed at the current
   * field would have quietly moved the corridor. Measured 2026-08-24: identical
   * to six decimal places, every vertex, both bands. */
  const fp = feats('forecastPoints.geojson');
  for (const f of fp) {
    f.properties._time = parseNhcValidtime(f.properties.validtime, f.properties.advdate);
  }
  const base = {
    currentField: feats('windCurrent.geojson'),
    forecastPoints: fp,
    currentPos: { lon: -175.3, lat: 33.4, headingDeg: 320 },
  };
  const sig = (out) => JSON.stringify(out.map((f) => [
    f.properties.radii,
    f.geometry.coordinates[0].map((v) => v.map((n) => n.toFixed(6)).join(',')),
  ]));

  const asIs = buildFullTrack({ ...base, forecastRadii: feats('windSwath.geojson') }, WIND_SWEEP);
  const stitched = buildFullTrack({
    ...base,
    forecastRadii: stitchSeams({ features: feats('windSwath.geojson') }).features,
  }, WIND_SWEEP);

  ok(asIs.length > 0, 'the corridor must still build');
  ok(sig(asIs) === sig(stitched),
    'the built corridor must be identical whether the raw radii arrived cut or'
    + ' stitched — anything else means this repair moved a shape that was right');
}

section('the SHIPPED module is actually wired, not just capable of being');
{
  /* ==> A HELPER THAT NOBODY CALLS IS THE FAULT THIS FIX EXISTS TO CORRECT.
   * <== `lib/seam-stitch.js` was written on 2026-08-20, worked correctly on
   * wind rings from the day it shipped, and repaired nothing but the cone for
   * four days — because one call site was missing. Every assertion above would
   * have passed throughout. So the source is read.
   *
   * A source read is a blunt instrument and it is the right one here: the
   * alternative is importing `data/nhc-mapserver.js`, whose fetch path needs a
   * network this sandbox does not have. Same reasoning as the relay mirrors. */
  const src = readFileSync('data/nhc-mapserver.js', 'utf8');

  ok(/from '\.\.\/lib\/seam-stitch\.js'/.test(src),
    'data/nhc-mapserver.js must import the stitch');
  ok(/function stitchSeams\(/.test(src),
    'and define the per-layer wrapper');
  ok(/stitchSeams\(scrubSentinels\(fc\)\)/.test(src),
    'and CALL it on the fetch path, wrapping the sentinel scrub — if this'
    + ' assertion is the only thing that broke, somebody removed the wiring and'
    + ' left the helper behind, which is exactly the state this fix corrected');

  /* The mirror above must not drift from the shipped shape. */
  ok(/f\.geometry\?\.type === 'MultiPolygon'/.test(src),
    'the shipped wrapper must gate on MultiPolygon, like the mirror in this file');
  ok(/stitchDatelineSplit\(f\.geometry\)/.test(src),
    'and hand the geometry to the stitch');

  /* And the cone keeps its own call — a pure library must not assume its
   * caller stitched first. */
  const cone = readFileSync('lib/cone-smooth.js', 'utf8');
  ok(/stitchDatelineSplit\(f\.geometry\)/.test(cone),
    'lib/cone-smooth.js keeps its own stitch: it is a pure library and cannot'
    + ' assume the caller repaired the shape. The second call is a type check.');
}

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
