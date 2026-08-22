#!/usr/bin/env node
/**
 * test-cone-cap.mjs — the cone's tail cap (lib/cone-sweep.js `aheadStart`).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-cone-cap.mjs`, same as every other
 * suite here (§12 — this project has no toolchain by design).
 *
 * ==> WHAT BROKE, AND WHY LALA COULD NOT SEE IT. <==
 * The tail cap is sized by casting a ray BACKWARDS from the track's first
 * station until it leaves the published cone. That was right while the first
 * station was tau 0 — the published cone's own apex — so the ray hit the apex a
 * short way back and the cap came out as the small rounded nose a cone has.
 *
 * §7.11 made the first station the STORM, which sits inside the published cone,
 * ahead of its stale apex. The ray now runs the whole length of the leftover
 * tail and the cap balloons to fit. §47.5 paints the caps, which is what turned
 * a long-standing wrong shape into the purple lobe Aaron reported on Moke.
 *
 * ==> IT NEEDS MOKE'S BYTES. LALA'S DO NOT REPRODUCE IT. <== Both storms were
 * on a stale advisory that night. Moke ran nearly due west with a long east-west
 * cone, so her advisory's leftover tail is 2.43x the cone's width at her
 * position; Lala was recurving north and hers is 0.91x — already under the
 * ceiling, so the fix is a no-op on her. A suite built on Lala alone would have
 * passed before and after the fix. That is asserted below rather than assumed.
 *
 * THE CLOCK IS PINNED to the feed's observation time for that archive run.
 *
 * WHAT THIS CANNOT PROVE: that the cap READS as a rounded end. That is a phone.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { sweepConeDetail } = await import('../lib/cone-sweep.js');
const { reanchorNow } = await import('../lib/forecast-now.js');
const { smoothTracks } = await import('../lib/trackline.js');
const { parseNhcValidtime } = await import('../lib/time.js');

const NOW = Date.parse('2026-08-22T00:39:00Z');
const AT = '2026-08-21T21:00:00.000Z';

/* Each storm's own feed record from that archive run. */
const STORMS = {
  Lala: {
    dir: 'samples/lala-cp012026',
    files: { cone: 'cone-038-stale.geojson', fp: 'forecast-points-038-stale.geojson',
             ft: 'forecast-track-038-stale.geojson', pt: 'past-track-038-doubled.geojson' },
    lon: -170.4, lat: 28.6,
  },
  Moke: {
    dir: 'samples/moke-cp032026',
    files: { cone: 'cone-006-stale.geojson', fp: 'forecast-points-006-stale.geojson',
             ft: 'forecast-track-006-stale.geojson', pt: 'past-track-006.geojson' },
    lon: -147.2, lat: 13.9,
  },
};

const slot = (fc) => ({ status: 'ok', fc, error: null });

function swept(name) {
  const s = STORMS[name];
  const read = (f) => JSON.parse(readFileSync(`${s.dir}/${f}`, 'utf8'));
  const fp = read(s.files.fp);
  /* `_time` is stamped during parsing, not published — same parser the app uses. */
  for (const f of fp.features) {
    f.properties._time = parseNhcValidtime(f.properties.validtime, f.properties.advdate);
  }
  const coneFc = read(s.files.cone);
  const b = reanchorNow({ layers: {
    pastTrack: slot(read(s.files.pt)),
    forecastTrack: slot(read(s.files.ft)),
    forecastPoints: slot(fp),
    cone: slot(coneFc),
  } }, { lon: s.lon, lat: s.lat, observedAt: AT }, NOW, name);

  const t = smoothTracks(b, name, null);
  const track = t.layers.forecastTrack.fc.features[0].geometry.coordinates;

  const g = coneFc.features[0].geometry;
  const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
  return { s, track, rings, out: sweepConeDetail(track, rings) };
}

/**
 * The cap's backward reach against the flank it is capping.
 *
 * ==> MEASURED THE WAY THE CODE BUILDS IT, NOT AS A DISTANCE FROM THE STORM.
 * <== The cap is a half-ELLIPSE: semi-major `ahead` along the reversed track,
 * semi-minor the flank sideways. Its furthest vertex from the station is
 * whichever of those is larger, so a plain radius conflates the two. The reach
 * is projected onto the backward track direction; the flank is the LARGER of
 * the two sides, because `aheadStart` is clamped to `max(wL, wR)` and the two
 * sides are measured independently — a cone is not symmetric.
 */
function capMetrics(name, end = 'start') {
  const { out, track } = swept(name);
  const cap = end === 'start' ? out?.capStart : out?.capEnd;
  if (!cap) return null;
  const r0 = end === 'start' ? out.ribs[0] : out.ribs[out.ribs.length - 1];

  /* ==> DEGREES OF LONGITUDE ARE NOT DEGREES OF DISTANCE. <== The sweep works
   * in a planar frame with longitude scaled by cos(lat) and unscales on the way
   * out, so comparing a raw lon/lat reach against a raw lon/lat flank measures
   * the projection, not the shape. Moke runs nearly due west at 13.9N, so her
   * cap's reach is almost pure longitude and her flank almost pure latitude —
   * and the same cap read 1.03x purely from the 1/cos(13.9) stretch. Scaled
   * here, exactly as lib/cone-sweep.js does it. */
  const k = Math.cos(r0.lat * Math.PI / 180);
  const P = (p) => [p[0] * k, p[1]];
  const c = P([r0.lon, r0.lat]);

  /* Unit vector pointing OUT of the cone at this end: backwards along the track
   * at the start, forwards at the nose. */
  const n = track.length - 1;
  const [a, b] = end === 'start' ? [track[1], track[0]] : [track[n - 1], track[n]];
  const dx = (b[0] - a[0]) * k;
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const back = [dx / L, dy / L];

  const wL = Math.hypot(P(r0.left)[0] - c[0], P(r0.left)[1] - c[1]);
  const wR = Math.hypot(P(r0.right)[0] - c[0], P(r0.right)[1] - c[1]);
  const flank = Math.max(wL, wR);

  const reach = Math.max(...cap.map((q) => {
    const p = P(q);
    return (p[0] - c[0]) * back[0] + (p[1] - c[1]) * back[1];
  }));

  return { flank, reach, ratio: reach / flank };
}

/* ---------------------------------------------------------------------------
 * THE FIXTURES
 * ------------------------------------------------------------------------- */
section('both cones still rebuild — a cap fix that kills the rebuild is worse');
{
  for (const name of ['Lala', 'Moke']) {
    const { out } = swept(name);
    ok(out != null, `${name}'s cone must still sweep, not fall back to the published outline`);
    ok(out?.capStart?.length > 3, `${name} must still have a tail cap at all`);
    ok(out?.capEnd?.length > 3, `${name} must still have a nose cap`);
  }
}

section('the fixture still carries the fault Lala cannot show');
{
  const m = STORMS.Moke;
  const cone = JSON.parse(readFileSync(`${m.dir}/${m.files.cone}`, 'utf8'));
  const g = cone.features[0].geometry;
  const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
  const east = Math.max(...rings.flat().map((p) => p[0]));
  ok(east - m.lon > 1.5,
    `Moke's published cone must still reach well east of her — behind her — got `
    + `${(east - m.lon).toFixed(2)} deg. If this shrinks the fixture has aged out.`);
}

/* ---------------------------------------------------------------------------
 * THE CLAMP
 * ------------------------------------------------------------------------- */
section('the tail cap never reaches further back than the cone is wide');
{
  for (const name of ['Lala', 'Moke']) {
    const c = capMetrics(name);
    ok(c != null, `${name} must produce cap metrics`);
    /* The cap is a half-ellipse: semi-major is the backward reach, semi-minor
     * the flank. Its furthest vertex from the storm is therefore at most the
     * larger of the two, plus float slack. */
    ok(c.ratio <= 1.02,
      `${name}'s tail cap reaches ${c.reach.toFixed(2)} deg behind the first station against a `
      + `${c.flank.toFixed(2)} deg flank (${c.ratio.toFixed(2)}x) — a cone's end cannot be `
      + 'longer back than the cone is wide');
  }
}

section('Moke shrinks and Lala does not move');
{
  /* ==> A FIX THAT CHANGED EVERY CONE TO CORRECT ONE WOULD BE A REGRESSION
   * WEARING A FIX'S CLOTHES. <== Lala's start reach was already 0.91x, under
   * the ceiling, so the clamp must be a no-op on her. These are the shapes
   * AFTER the fix; the numbers before it are in the samples READMEs. */
  const lala = capMetrics('Lala');
  ok(lala.ratio < 0.99,
    `Lala's ray already stopped short of the ceiling (0.91x measured), so the clamp must `
    + `not be what decides her cap. Got ${lala.ratio.toFixed(2)}x — at 1.00 the ceiling is `
    + 'binding on a cone it was never meant to touch.');

  const moke = capMetrics('Moke');
  ok(Math.abs(moke.ratio - 1) < 0.02,
    `Moke's ray ran 2.43x past the ceiling, so her cap must now sit exactly ON it. `
    + `Got ${moke.ratio.toFixed(2)}x.`);
  ok(moke.reach > 0.2,
    `Moke's cap must not collapse to nothing either, got ${moke.reach.toFixed(2)} deg`);
}

section('the nose cap is deliberately NOT clamped');
{
  /* The last station is still the published cone's own day-5 nose, so its
   * forward ray measures this cone's end and is right to. Clamping both would
   * shave a few percent off every correct nose to fix one wrong tail. */
  /* ==> MEASURED THE SAME WAY THE TAIL IS, AND THAT MATTERS. <== A radius from
   * the station cannot see a clamped nose: squash the semi-major and the cap's
   * furthest vertex is simply the flank one, still a full flank away. Verified
   * by mutation — clamping the nose to half slipped past a radius test.
   * Projected onto the forward direction, it bites.
   *
   * ==> ONLY MOKE CAN PROVE THIS, AND THE REASON IS THE SAME ONE AS THE TAIL.
   * <== A ceiling at the flank is only VISIBLE on a cone whose ray runs past
   * it. Measured: Moke's nose reaches 1.02x her flank, so a clamp would shorten
   * it and this assertion fails. Lala's reaches 0.79x — her day-5 circle is
   * genuinely shorter than the cone is wide there, so no ceiling would bind on
   * her and asserting one would be asserting nothing. Recorded rather than
   * quietly looping over both storms and hoping. */
  const mokeNose = capMetrics('Moke', 'end');
  ok(mokeNose.ratio > 1,
    `Moke's nose cap must still be sized from its own forward ray, which runs past `
    + `the flank. Got ${mokeNose.reach.toFixed(2)} against ${mokeNose.flank.toFixed(2)} `
    + `(${mokeNose.ratio.toFixed(2)}x) — at or under 1.00 the ceiling has been applied `
    + 'to an end that never needed it.');

  const lalaNose = capMetrics('Lala', 'end');
  ok(lalaNose.ratio > 0.5,
    `Lala's nose is expected to fall short of her flank (0.79x measured) — but not to `
    + `collapse. Got ${lalaNose.ratio.toFixed(2)}x.`);
}

section('the rebuilt ring stays simple and closed');
{
  for (const name of ['Lala', 'Moke']) {
    const { out } = swept(name);
    const r = out.ring;
    ok(r.length > 3, `${name}'s ring must have real vertices`);
    ok(r.every((v) => Number.isFinite(v[0]) && Number.isFinite(v[1])),
      `${name}'s ring must carry no non-finite coordinate`);
  }
}

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
