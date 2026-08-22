#!/usr/bin/env node
/**
 * test-cone-anchor.mjs — the cone starts at the STORM, not at the advisory's
 * analysis position (SPEC-MAP.md §7.9, §7.11).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-cone-anchor.mjs`.
 *
 * ==> WHY THIS SUITE EXISTS SEPARATELY FROM test-cone-sweep.mjs. <== That suite
 * runs the Ida corpus, whose tracks are NOT re-anchored, so the published cone
 * and the track start in the same place and the whole question this file asks
 * cannot arise there. Deleting the behind-the-storm skip left all 61 of its
 * assertions green. Verified by doing it.
 *
 * THE FIXTURE IS REAL ARCHIVED BYTES — the 2026-08-21T23:30Z run:
 *
 *   published cone   advisory 36A, apex at 26.65N
 *   forecast points  advisory 36A, tau-0 valid 09:00Z at 26.90N
 *   storm feed       advisory 038, 21:00Z, 28.60N 170.40W
 *
 * The feed is 135 miles ahead of the cone's apex. That gap is the entire test.
 *
 * WHAT THIS CANNOT PROVE: whether the cone READS as starting at the storm. That
 * is glass.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { reanchorNow } = await import('../lib/forecast-now.js');
const { smoothTracks } = await import('../lib/trackline.js');
const { smoothCone } = await import('../lib/cone-smooth.js');
const { sweepConeDetail } = await import('../lib/cone-sweep.js');
const { parseNhcValidtime } = await import('../lib/time.js');
const { firstCrossing } = await import('../lib/unloop.js');

const S = 'samples/lala-cp012026';
const read = (f) => JSON.parse(readFileSync(`${S}/${f}`, 'utf8'));

const NOW = Date.parse('2026-08-22T00:39:00Z');
const STORM = { lon: -170.4, lat: 28.6, observedAt: '2026-08-21T21:00:00.000Z' };
const slot = (fc) => ({ status: 'ok', fc, error: null });

function forecastPoints() {
  const fc = read('forecast-points-038-stale.geojson');
  for (const f of fc.features) {
    f.properties._time = parseNhcValidtime(f.properties.validtime, f.properties.advdate);
  }
  return fc;
}

function bundle(anchored) {
  const b = { layers: {
    pastTrack: slot(read('past-track-038-doubled.geojson')),
    pastPoints: slot(read('past-points-038.geojson')),
    forecastTrack: slot(read('forecast-track-038-stale.geojson')),
    forecastPoints: slot(forecastPoints()),
    cone: slot(read('cone-038-stale.geojson')),
  } };
  return anchored ? reanchorNow(b, STORM, NOW, 'Lala') : b;
}

/* Quiet the modules' own console — the refusal notice is asserted, not read. */
function muted(fn) {
  const w = console.warn;
  const i = console.info;
  const seen = [];
  console.warn = (m) => seen.push(String(m));
  console.info = (m) => seen.push(String(m));
  try { return { out: fn(), seen }; } finally { console.warn = w; console.info = i; }
}

const coneOf = (b) => smoothCone(smoothTracks(b, 'Lala', null), `Lala-${Math.random()}`)
  .layers.cone.fc.features[0];
const latsOf = (f) => {
  const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
  return rings.flat().map((p) => p[1]);
};
const MI = 69.09;

/* ---------------------------------------------------------------------------
 * THE FIXTURE
 * ------------------------------------------------------------------------- */
section('the fixture still carries the gap');
{
  const cone = read('cone-038-stale.geojson').features[0];
  const lats = latsOf(cone);
  ok(Math.abs(Math.min(...lats) - 26.65) < 0.05,
    `the published cone's apex should sit at 26.65N, got ${Math.min(...lats).toFixed(2)}`);
  ok(STORM.lat - Math.min(...lats) > 1.5,
    'the storm must be well ahead of the published apex — without that gap this suite '
    + 'is not testing anything');
  ok(cone.geometry.type === 'MultiPolygon',
    'the cone must still arrive cut at the antimeridian — the stitch is upstream of '
    + 'everything here and a fixture without the cut skips it');
}

/* ---------------------------------------------------------------------------
 * THE POINT
 * ------------------------------------------------------------------------- */
section('the rebuilt cone starts at the storm, not at the analysis position');
{
  const f = muted(() => coneOf(bundle(true))).out;
  ok(f.properties._swept === true,
    'the rebuild must RUN — falling back to the published outline is what put the '
    + 'apex 135 miles behind the storm in the first place');

  const lats = latsOf(f);
  const tailMi = (STORM.lat - Math.min(...lats)) * MI;
  ok(tailMi < 60,
    `the drawn cone may reach behind the storm only by its own rounded start cap, `
    + `got ${tailMi.toFixed(0)} miles`);
  ok(tailMi > 0,
    'and it must reach back SOME way — a cone chopped flat at the storm has lost its cap');

  ok(firstCrossing(f.geometry.coordinates[0].slice(0, -1)) == null,
    'the rebuilt cone must not cross itself');
  ok(Math.max(...lats) > 38,
    `the cone must still reach its full forecast extent, got ${Math.max(...lats).toFixed(2)}N`);
}

section('without the re-anchor the fallback is what draws, tail and all');
{
  /* Not an endorsement of the old behaviour — a control. If this stops showing
   * a long tail, the fixture no longer reproduces the situation. */
  const f = muted(() => coneOf(bundle(false))).out;
  const tailMi = (STORM.lat - Math.min(...latsOf(f))) * MI;
  ok(tailMi > 120,
    `on the un-re-anchored track the cone still reaches far behind the storm `
    + `(${tailMi.toFixed(0)} mi) — that is the shape Aaron reported`);
}

/* ---------------------------------------------------------------------------
 * THE GUARD THAT HAD TO MOVE
 * ------------------------------------------------------------------------- */
section('the undercut guard asks its question only where the track goes');
{
  const b = bundle(true);
  const track = smoothTracks(b, 'Lala', null).layers.forecastTrack.fc.features[0].geometry.coordinates;

  /* ==> THE ASSERTION THAT CATCHES THE SKIP BEING DELETED. <== The published
   * cone extends 135 miles behind this track's first station. Without the skip
   * the guard reads that as a 1.62 degree undercut against a 1.27 allowance and
   * refuses a rebuild that is otherwise sound. The Ida corpus cannot see this,
   * because its tracks are not re-anchored. */
  const stitched = read('cone-038-stale.geojson').features[0];
  const parts = stitched.geometry.type === 'MultiPolygon'
    ? stitched.geometry.coordinates
    : [stitched.geometry.coordinates];
  ok(parts.length === 2, `the fixture cone should be a two-part dateline cut, got ${parts.length}`);

  ok(track[0][1] > 28.5,
    `the re-anchored track must start on the storm, got ${track[0][1].toFixed(2)}N`);

  /* Straight at the sweep, no smoothCone wrapper, so a refusal here is the
   * sweep's own and not the stitch's. */
  const { stitchDatelineSplit } = await import('../lib/seam-stitch.js');
  const one = stitchDatelineSplit(stitched.geometry);
  ok(one?.type === 'Polygon', 'the stitch must hand the sweep a single polygon');
  const swept = sweepConeDetail(track, one.coordinates);
  ok(swept != null,
    'the sweep must ACCEPT the re-anchored track against the stale cone — this is the '
    + 'assertion that fails when the behind-the-storm skip is removed');
}

section('a cone mostly behind the storm falls back rather than drawing a sliver');
{
  /* The skip is right for a tail and wrong for a whole cone. A track starting
   * near the published cone's far end leaves almost nothing ahead, and
   * CONE_SWEEP.minAheadFrac must turn it away. */
  const b = bundle(true);
  const track = smoothTracks(b, 'Lala', null).layers.forecastTrack.fc.features[0].geometry.coordinates;
  const { stitchDatelineSplit } = await import('../lib/seam-stitch.js');
  const one = stitchDatelineSplit(read('cone-038-stale.geojson').features[0].geometry);
  const tail = track.slice(Math.floor(track.length * 0.8));
  ok(tail.length >= 3, 'the trimmed track is still a line');
  ok(sweepConeDetail(tail, one.coordinates) == null,
    'a track starting near the cone\'s far end must be refused — presenting a sliver '
    + 'as the whole forecast is the §5 failure the skip could otherwise cause');
}

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
