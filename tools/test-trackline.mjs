#!/usr/bin/env node
/**
 * test-trackline.mjs — the joined, curved storm path (lib/trackline.js).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-trackline.mjs`, same as every
 * other suite here (§12 — this project has no toolchain by design).
 *
 * THE HEADLINE FIXTURE IS NOT SYNTHETIC. Fausto's numbers below are back-
 * calculated from Aaron's 2026-07-26 screenshot, whose pixels were read
 * directly: the past track's western end sat 254 px from the forecast's first
 * dot, and extending it in a straight line put it within 4 px of that dot's
 * centre. That is the shape the module exists to fix, and a made-up fixture
 * with the two ends already touching would have passed every test here while
 * the real storm drew a gap.
 *
 * THE GDACS FIXTURE IS SCRAMBLED ON PURPOSE. Its segments arrive grouped by
 * intensity class, not by time, with the forecast flag flipping inside a class
 * run (spec-parameter.md §32.3). A stitcher tested against tidy input is
 * testing nothing.
 *
 * WHAT THIS CANNOT PROVE: that the curve looks right. Deviation is bounded and
 * checked here; whether a hurricane path READS as a hurricane path is a
 * question for a phone.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { smoothTracks, smoothPath, __internals } = await import('../lib/trackline.js');
const { TRACK_LINE } = await import('../config/constants.js');
const { stitch, orient, spline, unwrapLons, dLon, runsFrom, unfold, turnDeg, extendToAnchor } = __internals;

const line = (coords, props = {}) => ({
  type: 'Feature',
  properties: props,
  geometry: { type: 'LineString', coordinates: coords },
});
const slot = (features) => ({
  status: 'ok',
  fc: { type: 'FeatureCollection', features },
  error: null,
});
const NONE = { status: 'none', fc: null, error: null };

const coordsOf = (b, key) => b.layers[key].fc.features[0].geometry.coordinates;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const samePt = (p, q, tol = 1e-9) => near(p[0], q[0], tol) && near(p[1], q[1], tol);

/* Perpendicular distance from a point to the segment a→b, in degrees. */
function offChord(p, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = p[0] - a[0];
  const wy = p[1] - a[1];
  const L2 = vx * vx + vy * vy;
  const t = L2 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / L2)) : 0;
  return Math.hypot(wx - t * vx, wy - t * vy);
}

/* ---------------------------------------------------------------------------
 * THE CONSTANTS THAT CARRY AN ARGUMENT
 * ------------------------------------------------------------------------- */
section('tuning');
ok(TRACK_LINE.alpha === 0.5, 'alpha is 0.5 — CENTRIPETAL, the no-cusp guarantee');
ok(TRACK_LINE.minPerLeg >= 2, 'a leg is subdivided, never left as its own chord');
ok(TRACK_LINE.maxVertices >= 600, 'the vertex ceiling clears a realistic worst case');
ok(!('maxJoinDeg' in TRACK_LINE) && !('maxJoinNm' in TRACK_LINE),
   'NO distance guard on the join — Aaron 2026-07-26, it always connects');

/* ---------------------------------------------------------------------------
 * LONGITUDE, AND THE ANTIMERIDIAN
 * ------------------------------------------------------------------------- */
section('longitude');
ok(dLon(179, -179) === -2, '179 and −179 are two degrees apart, not 358');
ok(dLon(-179, 179) === 2, '…and symmetrically the other way');
ok(dLon(10, 5) === 5, 'ordinary differences are untouched');

const wrapped = unwrapLons([[179, 20], [179.8, 20.2], [-179.4, 20.4], [-178.6, 20.6]]);
ok(wrapped[0][0] === 179, 'the first point keeps its published longitude — nothing translates');
ok(wrapped.every((p, i) => i === 0 || p[0] > wrapped[i - 1][0]),
   'a run across 180° comes out monotonic, so MapLibre draws it whole');
ok(near(wrapped[3][0], 181.4, 1e-9), 'and continues past 180 rather than snapping back');

/* ---------------------------------------------------------------------------
 * STITCH — GDACS's scrambled segments
 * ------------------------------------------------------------------------- */
section('stitch (GDACS ships ~30 segments in intensity order)');
const fixes = Array.from({ length: 9 }, (_, i) => [120 + i * 0.9, 18 + i * 0.55]);
const segs = [];
for (let i = 0; i < fixes.length - 1; i++) segs.push([fixes[i], fixes[i + 1]]);
/* Scrambled AND with some segments published backwards — both are real. */
const scrambled = [segs[5], [...segs[0]].reverse(), segs[3], segs[7], segs[1],
                   [...segs[6]].reverse(), segs[2], segs[4]];
const chains = stitch(scrambled);
ok(chains.length === 1, `eight scattered segments chain to ONE polyline (got ${chains.length})`);
const chained = chains[0];
ok(chained.length === fixes.length, `…of ${fixes.length} points (got ${chained.length})`);
ok(samePt(chained[0], fixes[0]) || samePt(chained[0], fixes[8]),
   'the chain starts at one true end of the track, not in the middle');
const forward = samePt(chained[0], fixes[0]);
ok(fixes.every((f, i) => samePt(f, chained[forward ? i : fixes.length - 1 - i])),
   'every fix appears exactly once, in true time order');

ok(stitch([[[0, 0], [1, 1]]])[0].length === 2, 'a single run (NHC) passes through untouched');

/* ===> THE RULE THAT COST A GLASS FAILURE. <===
 * Runs that will not chain are NOT forced into one line. Forcing them is what
 * drew Genevieve's lens: two descriptions of one history joined tail to tail.
 * They stay separate, which is exactly how they drew before this module. */
const split = stitch([[[0, 0], [1, 0], [2, 0]], [[40, 0], [41, 0]]]);
ok(split.length === 2, 'unmergeable pieces stay SEPARATE — never concatenated into a path nobody travelled');
ok(split[0].length === 3 && split[1].length === 2, 'and both survive, longest first, nothing dropped');

/* The antimeridian seam, published as two runs either side of 180. */
const seamChain = stitch([[[178, 12], [180, 12.4]], [[-180, 12.4], [-178, 12.8]]]);
ok(seamChain.length === 1 && seamChain[0].length === 3,
   'runs meeting at ±180 DO chain as neighbours (180 === −180)');

section('runsFrom');
ok(runsFrom({ features: [line([[0, 0], [1, 1]])] }).length === 1, 'LineString → one run');
ok(runsFrom({ features: [{ geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] } }] }).length === 2,
   'MultiLineString → one run per part');
ok(runsFrom({ features: [line([[0, 0]])] }).length === 0, 'a one-vertex "line" is not a run');
ok(runsFrom({ features: [line([[0, 0], [NaN, 1], [2, 2]])] })[0].length === 2,
   'non-finite coordinates are dropped, not propagated');

/* ---------------------------------------------------------------------------
 * ORIENT
 * ------------------------------------------------------------------------- */
section('orient');
const p = [[10, 10], [11, 11], [12, 12]];
const f = [[12, 12], [13, 13]];
let o = orient([...p].reverse(), f);
ok(samePt(o.past[o.past.length - 1], [12, 12]), 'a backwards past track is flipped to END at the seam');
o = orient(p, [...f].reverse());
ok(samePt(o.forecast[0], [12, 12]), 'a backwards forecast track is flipped to BEGIN at the seam');
o = orient(p, f);
ok(samePt(o.past[0], [10, 10]) && samePt(o.forecast[0], [12, 12]), 'correct input is left alone');

/* ---------------------------------------------------------------------------
 * THE SPLINE
 * ------------------------------------------------------------------------- */
section('spline');
const knots = [[-140, 18], [-141.5, 18.6], [-143, 19.4], [-144.2, 20.6], [-145, 22]];
const { curve, index } = spline(knots);
ok(curve.length > knots.length * 3, `the curve is denser than its knots (${curve.length} from ${knots.length})`);
ok(curve.length <= TRACK_LINE.maxVertices, 'and stays inside the vertex ceiling');
ok(index.length === knots.length, 'every knot is indexed into the curve');
ok(knots.every((k, i) => samePt(curve[index[i]], k, 1e-9)),
   'EVERY PUBLISHED FIX IS ON THE CURVE, exactly — we never move a reported position');
ok(samePt(curve[0], knots[0]) && samePt(curve[curve.length - 1], knots[knots.length - 1]),
   'the ends are the published ends');

/* Monotonic in longitude: a centripetal curve through a westward track cannot
 * double back. This is the cusp test, and it is the reason alpha is 0.5. */
ok(curve.every((c, i) => i === 0 || c[0] <= curve[i - 1][0] + 1e-9),
   'no cusp, no loop: the curve never reverses direction on the knots');

/* Bounded deviation — it bends, but not off into its own opinion. */
let worst = 0;
for (let i = 0; i < knots.length - 1; i++) {
  for (let j = index[i]; j <= index[i + 1]; j++) {
    worst = Math.max(worst, offChord(curve[j], knots[i], knots[i + 1]));
  }
}
const legLen = Math.hypot(knots[1][0] - knots[0][0], knots[1][1] - knots[0][1]);
ok(worst > 0.01, `the curve genuinely departs the straight chord (${worst.toFixed(3)}°)`);
ok(worst < legLen * 0.25, `…but by less than a quarter of a leg (${(worst / legLen).toFixed(3)})`);

/* A sharp recurve is where uniform Catmull-Rom fails. */
const recurve = [[-70, 25], [-72, 28], [-73, 32], [-71, 36], [-67, 39], [-62, 41]];
const rc = spline(recurve);
ok(recurve.every((k, i) => samePt(rc.curve[rc.index[i]], k, 1e-9)), 'a recurve still passes through every fix');
let maxStep = 0;
for (let i = 1; i < rc.curve.length; i++) {
  maxStep = Math.max(maxStep, Math.hypot(rc.curve[i][0] - rc.curve[i - 1][0], rc.curve[i][1] - rc.curve[i - 1][1]));
}
ok(maxStep < 1.0, `a recurve produces no wild jump between vertices (max step ${maxStep.toFixed(3)}°)`);

ok(spline([[0, 0], [1, 1]]).curve.length === 2, 'two points stay two points — nothing to bend');

/* ---------------------------------------------------------------------------
 * FAUSTO — the bug that started this, 2026-07-26
 * ------------------------------------------------------------------------- */
section('Fausto (measured off glass 2026-07-26)');
/* A past track heading west-northwest that STOPS SHORT, and a forecast that
 * begins at the current position roughly a fix-and-a-half further on. */
const fPast = [[-134.0, 17.2], [-134.9, 17.6], [-135.8, 18.0], [-136.7, 18.4], [-137.5, 18.8]];
const fFcst = [[-139.8, 19.7], [-141.4, 20.4], [-143.0, 21.3], [-144.3, 22.5]];
const gapBefore = Math.hypot(fFcst[0][0] - fPast[4][0], fFcst[0][1] - fPast[4][1]);
ok(gapBefore > 2, `the fixture really does have a gap (${gapBefore.toFixed(2)}°)`);

const fausto = smoothTracks({
  layers: { pastTrack: slot([line(fPast, { idp_filedate: 123 })]), forecastTrack: slot([line(fFcst)]) },
});
const fp = coordsOf(fausto, 'pastTrack');
const ff = coordsOf(fausto, 'forecastTrack');

ok(samePt(fp[fp.length - 1], ff[0]),
   'THE JOIN: the past track now ends on the exact vertex the forecast starts from');
ok(samePt(ff[0], fFcst[0], 1e-6),
   '…and that vertex is the forecast\'s FIRST DOT — the current position, not a midpoint');
ok(fp.some((c) => samePt(c, fPast[4], 1e-6)),
   'the past track still passes through its own last published fix');
ok(fPast.every((k) => fp.some((c) => samePt(c, k, 1e-6))),
   'every past fix survives the join');
ok(fFcst.every((k) => ff.some((c) => samePt(c, k, 1e-6))),
   'every forecast point survives the join');

/* THE CONNECTING LEG IS HISTORY. It must be in the dotted slot, not the
 * confident white one — the storm has already travelled it. */
const legVertices = fp.filter((c) => c[0] < fPast[4][0] && c[0] > fFcst[0][0]).length;
ok(legVertices >= TRACK_LINE.minPerLeg,
   `the connector is drawn by the PAST track (${legVertices} vertices in the gap)`);
ok(!ff.some((c) => c[0] > fFcst[0][0] + 1e-9),
   'the forecast track draws nothing east of the current position');

ok(fausto.layers.pastTrack.fc.features[0].properties.idp_filedate === 123,
   'source properties ride through the rebuild');
ok(fausto.layers.pastTrack.fc.features[0].properties._smoothed === true,
   'and the rebuilt line says so');
ok(fausto.layers.pastTrack.fc.features.length === 1 && fausto.layers.forecastTrack.fc.features.length === 1,
   'each slot comes back as exactly one feature');

/* No kink at the seam: the heading either side of the join must agree. */
const bearing = (a, b) => Math.atan2(b[1] - a[1], (b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180));
const inB = bearing(fp[fp.length - 3], fp[fp.length - 1]);
const outB = bearing(ff[0], ff[2]);
let dB = Math.abs((inB - outB) * 180 / Math.PI);
if (dB > 180) dB = 360 - dB;
ok(dB < 12, `the curve carries its tangent THROUGH the current position (${dB.toFixed(1)}° kink)`);

/* ---------------------------------------------------------------------------
 * THE LENS — Genevieve, 2026-07-26, and the invariant that kills it
 * ------------------------------------------------------------------------- */
section('direction (the no-doubling-back invariant)');
ok(TRACK_LINE.maxTurnDeg === 150, 'a path may not turn more than 150° at one fix');
ok(near(turnDeg([0, 0], [1, 0], [2, 0]), 0, 1e-6), 'straight ahead is a 0° turn');
ok(near(turnDeg([0, 0], [1, 0], [0, 0]), 180, 1e-6), 'a complete reversal is 180°');
ok(turnDeg([0, 0], [1, 0], [1.7, 0.7]) < 60, 'a hard recurve is nowhere near the limit');

/* A full track chained tail-to-tail with a partial copy of itself — the shape
 * a stitcher makes when two runs describe the same history. */
const real = [[-120, 15], [-121, 15.6], [-122, 16.3], [-123, 17.1], [-124, 18]];
const folded = [...real, ...[[-123.4, 17.3], [-122.4, 16.5], [-121.4, 15.8]]];
const fixed = unfold(folded, 'test');
ok(fixed.length === real.length, `the doubled-back tail is cut off (${fixed.length} of ${folded.length})`);
ok(real.every((k, i) => samePt(fixed[i], k)), 'and the longer, real run is the one kept');
ok(unfold(real, 'test') === real, 'a clean track is returned untouched, same reference');
ok(unfold([[0, 0], [1, 1]], 'test').length === 2, 'a two-point run has no interior turn to judge');

section('Genevieve — the lens, reproduced and killed');
/* Her past track published NEWEST FIRST, so its LAST element is the oldest fix.
 * The old orient() compared endpoint distances only; if the old end scores
 * nearer for any reason, the connector runs from there back to the storm and
 * the map draws the track outbound and a chord inbound. */
const gvPast = [[-108.3, 12.9], [-107.4, 12.4], [-106.4, 11.9], [-105.3, 11.5],
                [-104.1, 11.2], [-102.8, 11.0], [-101.4, 10.9]];
const gvFcst = [[-108.3, 12.9], [-109.6, 13.6], [-111.0, 14.5], [-112.3, 15.6]];
const gv = smoothTracks({
  layers: { pastTrack: slot([line(gvPast)]), forecastTrack: slot([line(gvFcst)]) },
}, 'GENEVIEVE');
const gvp = coordsOf(gv, 'pastTrack');

ok(samePt(gvp[gvp.length - 1], gvFcst[0], 1e-6),
   'the past track ends on the current position — the NEWEST fix, not the oldest');
/* THE LENS TEST. A doubled path visits the same longitude twice. Walking the
 * result, longitude must move one way only for a track heading steadily east. */
let reversals = 0;
for (let i = 2; i < gvp.length; i++) {
  if ((gvp[i][0] - gvp[i - 1][0]) * (gvp[i - 1][0] - gvp[i - 2][0]) < -1e-12) reversals++;
}
ok(reversals === 0, `no lens: the path never turns back on itself (${reversals} reversals)`);
let gvTurn = 0;
for (let i = 1; i < gvp.length - 1; i++) gvTurn = Math.max(gvTurn, turnDeg(gvp[i - 1], gvp[i], gvp[i + 1]));
ok(gvTurn < TRACK_LINE.maxTurnDeg, `and no vertex doubles back (worst turn ${gvTurn.toFixed(1)}°)`);
ok(gvPast.every((k) => gvp.some((c) => samePt(c, k, 1e-6))), 'every one of her past fixes still draws');

/* Same storm with the past track published OLDEST first — the other convention.
 * Both must land on the same answer, which is the point of measuring rather
 * than assuming a direction. */
const gvRev = smoothTracks({
  layers: { pastTrack: slot([line([...gvPast].reverse())]), forecastTrack: slot([line(gvFcst)]) },
}, 'GENEVIEVE');
const gvrp = coordsOf(gvRev, 'pastTrack');
ok(samePt(gvrp[gvrp.length - 1], gvFcst[0], 1e-6),
   'published the other way round, it still ends on the current position');
ok(Math.abs(gvrp.length - gvp.length) <= 2, 'and produces the same path either way');

/* TWO RUNS DESCRIBING THE SAME HISTORY — the shape most likely behind
 * Genevieve's lens, reproduced. Both published storm-first, differing slightly,
 * so the chainer's fallback joins them tail-to-tail and the path walks out and
 * comes back. This is the fixture that proves the guard is load-bearing: the
 * assertion below FAILS without `unfold`. */
const runA = [[-108.3, 12.9], [-107.4, 12.4], [-106.4, 11.9], [-105.3, 11.5], [-104.1, 11.2]];
const runB = [[-108.3, 12.85], [-107.3, 12.3], [-106.3, 11.8], [-105.2, 11.4], [-104.0, 11.1]];
const lensChains = stitch([runA, runB]);
ok(lensChains.length === 2, 'two descriptions of one track are NOT welded together');
ok(lensChains[0].length === runA.length && lensChains[1].length === runB.length,
   'each stays whole and separate');
/* Proof the old approach could not have been rescued downstream: welded, the
 * fold turns only ~120°, which is inside the range a real recurve reaches. No
 * angle threshold could have told them apart. */
const welded = [...runA, ...[...runB].reverse()];
let weldTurn = 0;
for (let i = 1; i < welded.length - 1; i++) weldTurn = Math.max(weldTurn, turnDeg(welded[i - 1], welded[i], welded[i + 1]));
ok(weldTurn < TRACK_LINE.maxTurnDeg,
   `a welded lens folds by only ${weldTurn.toFixed(1)}° — under the guard, which is WHY it must not be built`);

/* End to end, through the real decoration. */
const dbl = smoothTracks({
  layers: { pastTrack: slot([line(runA), line(runB)]), forecastTrack: slot([line(gvFcst)]) },
}, 'GENEVIEVE');
const dblFeats = dbl.layers.pastTrack.fc.features;
const dblp = dblFeats[0].geometry.coordinates;
ok(dblFeats.length === 2, 'a two-description past track stays TWO features — no lens is manufactured');
let dblTurn = 0;
for (let i = 1; i < dblp.length - 1; i++) dblTurn = Math.max(dblTurn, turnDeg(dblp[i - 1], dblp[i], dblp[i + 1]));
ok(dblTurn < 90, `each one is a clean curve (worst turn ${dblTurn.toFixed(1)}°)`);
ok(samePt(dblp[dblp.length - 1], gvFcst[0], 1e-6), 'the main chain still joins the current position');
ok(dblFeats[1].geometry.coordinates.length > runB.length, 'and the odd one out is still smoothed, just not joined');

/* The seam rule in isolation: whichever way the source publishes the run, the
 * past track must end on the fix that CONTINUES its direction of travel. */
const eastPast = [[0, 0], [1, 0.1], [2, 0.2]];
const eastFcst = [[2.4, 0.28], [3.2, 0.35]];
for (const [name, pub] of [['oldest first', eastPast], ['newest first', [...eastPast].reverse()]]) {
  const t = orient(pub, eastFcst);
  ok(samePt(t.past[t.past.length - 1], [2, 0.2]),
     `published ${name}, the past track still ends on the most recent fix`);
  const turn = turnDeg(t.past[t.past.length - 2], t.past[t.past.length - 1], t.forecast[0]);
  ok(turn <= TRACK_LINE.maxTurnDeg, `…and the seam continues forward (${turn.toFixed(1)}°)`);
}

/* ---------------------------------------------------------------------------
 * A HUGE GAP STILL CONNECTS — the instruction, tested
 * ------------------------------------------------------------------------- */
section('always connect');
const stale = smoothTracks({
  layers: {
    pastTrack: slot([line([[-120, 15], [-121, 15.5], [-122, 16]])]),
    forecastTrack: slot([line([[-140, 22], [-142, 23]])]),
  },
});
const sp = coordsOf(stale, 'pastTrack');
ok(samePt(sp[sp.length - 1], [-140, 22], 1e-6),
   'an implausible 18° gap is STILL closed — no distance guard, by instruction');
ok(sp.length <= TRACK_LINE.maxVertices,
   'and one enormous leg does not eat the vertex budget');


/* ---------------------------------------------------------------------------
 * THE LAST KNOWN POSITION — a track with no forecast still has to reach its X
 * ------------------------------------------------------------------------- */
section('the trail reaches the last known position');

/* A live storm gets the leg free: the forecast starts at tau-0 and `orient`
 * turns the past around to meet it. Empty the forecast and that connector goes
 * with it, leaving the dotted trail stopping short of the grey X with open
 * water in between. This is the fix for that. */
const LAST = [-138.4, 19.2];  // ~1° past the end of fPast, where the X is drawn

const anchored = smoothTracks(
  { layers: { pastTrack: slot([line(fPast)]), forecastTrack: NONE } },
  'Fausto',
  LAST
);
const ap = coordsOf(anchored, 'pastTrack');
const apEnd = ap[ap.length - 1];
ok(Math.hypot(apEnd[0] - LAST[0], apEnd[1] - LAST[1]) < 1e-6,
   'the smoothed history now ENDS exactly on the last known position');
ok(ap.length > fPast.length, 'and it is still a smoothed curve, not a raw polyline');

/* THE CHAIN HAS NO DIRECTION. `stitch` may hand back either end first, so the
 * anchor has to be appended to whichever end the storm actually reached. */
const reversed = smoothTracks(
  { layers: { pastTrack: slot([line([...fPast].reverse())]), forecastTrack: NONE } },
  'Fausto reversed',
  LAST
);
const rp = coordsOf(reversed, 'pastTrack');
const rpEnd = rp[rp.length - 1];
ok(Math.hypot(rpEnd[0] - LAST[0], rpEnd[1] - LAST[1]) < 1e-6,
   'a track handed back backwards is flipped, and the anchor still lands on the end');
ok(rp.every((c) => c[0] >= LAST[0] - 1e-9),
   'and nothing was drawn past it — the leg goes to the anchor, not through it');

/* ==> THE CAP. A leg across an ocean the storm never crossed is worse than a
 * visible gap: one is a missing line, the other is an invented track. */
const farAway = smoothTracks(
  { layers: { pastTrack: slot([line(fPast)]), forecastTrack: NONE } },
  'Fausto with a bad position',
  [-100.0, 19.2]  // ~37° away
);
const fap = coordsOf(farAway, 'pastTrack');
ok(fap.every((c) => c[0] <= fPast[0][0] + 1e-6),
   'an anchor beyond the cap is REFUSED — the track is left short, not stretched');

/* A LIVE STORM IGNORES IT. The forecast owns the join, and a second connector
 * would fight the first. */
const live = smoothTracks(
  { layers: { pastTrack: slot([line(fPast)]), forecastTrack: slot([line(fFcst)]) } },
  'Fausto alive',
  LAST
);
ok(Math.abs(coordsOf(live, 'forecastTrack').at(-1)[0] - fFcst.at(-1)[0]) < 1e-6,
   'with a forecast present the anchor changes nothing — the forecast still owns the end');

/* Degenerate anchors are silence, not a crash. */
for (const [bad, why] of [
  [null, 'null'], [undefined, 'undefined'], [[NaN, 1], 'NaN'], [['a', 'b'], 'not numbers'], [[1], 'too short'],
]) {
  const out = extendToAnchor([[0, 0], [1, 1]], bad, 'x');
  ok(out.length === 2, `a ${why} anchor is ignored rather than appended`);
}


/* ---------------------------------------------------------------------------
 * smoothPath — one standalone run, no seam (model guidance)
 * ------------------------------------------------------------------------- */
section('smoothPath — guidance gets the same curve');

const run = [[-60, 20], [-62.2, 21.1], [-64.5, 22.4], [-66.9, 24.0], [-69.0, 26.1]];
const curved = smoothPath(run);

ok(curved.length > run.length, 'a run of fixes becomes a curve');
ok(JSON.stringify(curved[0]) === JSON.stringify(run[0]),
   'and it STARTS on the model\u2019s own first fix, not near it');
ok(JSON.stringify(curved.at(-1)) === JSON.stringify(run.at(-1)),
   'and ENDS on its last one');

/* ==> THE BUDGET IS SPREAD ACROSS THE LEGS, NOT SPENT FRONT TO BACK. <== It was
 * a running total each leg drew down until it hit zero, so a path with more legs
 * than budget came out smooth at the start and DEAD STRAIGHT at the end, with
 * one hard corner where the money ran out. On a guidance run that put the elbow
 * mid-track and left the whole outer half unsmoothed — reported on glass as "the
 * model tracks are no smoother", which was half true in the most literal way. */
const long = Array.from({ length: 11 }, (_, i) => [-55 - i * 1.9, 18 + i * 1.35]);
const starved = spline(long, 40);                    // 10 legs, 4 vertices each
const legLens = [];
for (let i = 1; i < starved.index.length; i++) {
  legLens.push(starved.index[i] - starved.index[i - 1]);
}
ok(new Set(legLens).size === 1,
   'a budget too small for the path is shared EVENLY — every leg gets the same');
ok(legLens.every((n) => n > 1),
   'and no leg is starved down to a straight segment while others run rich');

const tight = smoothPath(run, 12);
ok(tight.length < curved.length, 'a smaller vertex budget yields a coarser curve');
ok(JSON.stringify(tight.at(-1)) === JSON.stringify(run.at(-1)),
   'and the budget never costs the run its last fix');

/* ==> IT DOES NOT UNWRAP, AND THAT IS THE WHOLE CONTRACT WITH lib/adeck.js.
 * <== The a-deck parser already ran `unwrapRun` against the STORM's longitude,
 * which is a better anchor than this path's first point. Unwrapping again here
 * would re-anchor it and draw a track that crossed 180° cleanly a world away. */
const crossing = [[176, 12], [179, 13], [182, 14], [185, 15]]; // already continuous
const crossed = smoothPath(crossing);
ok(crossed.every((c) => c[0] >= 176 - 1e-6 && c[0] <= 185 + 1e-6),
   'an already-continuous run past 180° is left past 180° — no second unwrap');

/* Degenerate input is returned as it came, never padded and never thrown on. */
const two = [[0, 0], [1, 1]];
ok(smoothPath(two) === two, 'two points are not a curve — the SAME array back');
ok(smoothPath([]) .length === 0, 'an empty run is empty');
ok(smoothPath(null) === null, 'null in, null out');
const junky = [[0, 0], ['a', 'b'], [NaN, 1]];
ok(smoothPath(junky) === junky, 'a run with too few REAL points is left alone');

/* ---------------------------------------------------------------------------
 * THE SLOTS, AND EVERY WAY THIS CAN BE HANDED NOTHING
 * ------------------------------------------------------------------------- */
section('slots and degenerate input');
const silent = smoothTracks({
  layers: { pastTrack: slot([line(fPast)]), forecastTrack: NONE },
});
ok(silent.layers.forecastTrack === NONE, 'a silenced forecast slot is left exactly as it was');
ok(coordsOf(silent, 'pastTrack').length > fPast.length, 'the surviving history is still smoothed');
ok(!coordsOf(silent, 'pastTrack').some((c) => c[0] < fPast[4][0] - 1e-9),
   'a silent storm grows NO connector — there is nothing forward to reach for');

const fcOnly = smoothTracks({ layers: { pastTrack: NONE, forecastTrack: slot([line(fFcst)]) } });
ok(coordsOf(fcOnly, 'forecastTrack').length > fFcst.length, 'a forecast with no history smooths alone');
ok(fcOnly.layers.pastTrack === NONE, 'and the empty past slot is untouched');

const untouched = { layers: { pastTrack: NONE, forecastTrack: NONE } };
ok(smoothTracks(untouched) === untouched, 'nothing to do → the SAME object back, no copy');
ok(smoothTracks(null) === null, 'null in, null out');
ok(smoothTracks({}).layers === undefined, 'a bundle with no layers is passed through');

const oneVertex = { layers: { pastTrack: slot([line([[0, 0]])]), forecastTrack: NONE } };
ok(smoothTracks(oneVertex) === oneVertex, 'a one-vertex track is not a line and is left alone');

const junk = { layers: { pastTrack: slot([{ type: 'Feature', properties: {}, geometry: null }]), forecastTrack: NONE } };
ok(smoothTracks(junk) === junk, 'a feature with no geometry does not throw');

/* SHALLOW COPY, NEVER A MUTATION — the bundle is shared with the ambient
 * collections and the cage's ridge builder. */
const original = { layers: { pastTrack: slot([line(fPast)]), forecastTrack: slot([line(fFcst)]) }, forecast: [1, 2] };
const originalPastFc = original.layers.pastTrack.fc;
const copy = smoothTracks(original);
ok(original.layers.pastTrack.fc === originalPastFc, 'the input bundle is not written into');
ok(copy !== original && copy.layers !== original.layers, 'a new bundle and a new layers map come back');
ok(copy.forecast === original.forecast, 'everything else rides through by reference');

/* Idempotent IN SHAPE. main.js always smooths a raw cached bundle, never an
 * already-smoothed one — but a future caller that does must not get a curve
 * bent twice. Checked as geometry rather than as a vertex count: a second pass
 * legitimately resamples a denser line, and counting vertices would be testing
 * the sampler instead of the shape. */
const twice = smoothTracks(copy);
const once = coordsOf(copy, 'pastTrack');
const again = coordsOf(twice, 'pastTrack');
ok(samePt(again[0], once[0], 1e-6) && samePt(again[again.length - 1], once[once.length - 1], 1e-6),
   'a second pass keeps the same endpoints');
let drift = 0;
for (const c of again) {
  let best = Infinity;
  for (let i = 1; i < once.length; i++) best = Math.min(best, offChord(c, once[i - 1], once[i]));
  drift = Math.max(drift, best);
}
ok(drift < 1e-3, `a second pass rides the same curve (max drift ${drift.toExponential(1)}°, ~${(drift * 60).toFixed(3)} nm)`);
ok(again.length <= TRACK_LINE.maxVertices + 2, 'and still respects the vertex ceiling');

/* ---------------------------------------------------------------------------
 * GDACS END TO END — scrambled segments through the whole decoration
 * ------------------------------------------------------------------------- */
section('GDACS end to end');
const gPast = [[112.0, 20.0], [113.1, 20.6], [114.3, 21.1], [115.6, 21.5], [116.8, 21.8]];
const gFcst = [[116.8, 21.8], [115.4, 22.6], [114.0, 23.5]];
const gSegs = [];
for (let i = 0; i < gPast.length - 1; i++) gSegs.push(line([gPast[i], gPast[i + 1]]));
const gdacs = smoothTracks({
  layers: {
    /* Intensity-grouped, some reversed — the real publication order. */
    pastTrack: slot([gSegs[2], gSegs[0], gSegs[3], gSegs[1]].map((s, i) =>
      i % 2 ? line([...s.geometry.coordinates].reverse()) : s)),
    forecastTrack: slot([line([gFcst[0], gFcst[1]]), line([gFcst[1], gFcst[2]])]),
  },
});
const gp = coordsOf(gdacs, 'pastTrack');
const gf = coordsOf(gdacs, 'forecastTrack');
ok(gdacs.layers.pastTrack.fc.features.length === 1, 'four scrambled segments become ONE past line');
ok(gdacs.layers.forecastTrack.fc.features.length === 1, 'they share endpoints exactly, so they genuinely chain');
ok(gPast.every((k) => gp.some((c) => samePt(c, k, 1e-6))), 'every GDACS past fix survives');
ok(samePt(gp[gp.length - 1], gf[0]), 'the two halves meet on one shared vertex');
ok(samePt(gp[gp.length - 1], gFcst[0], 1e-6),
   'and they meet at the current position, where past and forecast already agreed');
ok(gp.length > gPast.length * 3, 'the stitched history is genuinely curved, not four straight legs');

/* ---------------------------------------------------------------------------
 * WEST PACIFIC ACROSS THE ANTIMERIDIAN
 * ------------------------------------------------------------------------- */
section('antimeridian, end to end');
const wp = smoothTracks({
  layers: {
    pastTrack: slot([line([[176.0, 14.0], [177.6, 14.8], [179.2, 15.7]])]),
    forecastTrack: slot([line([[-179.2, 16.6], [-177.4, 17.6]])]),
  },
});
const wpp = coordsOf(wp, 'pastTrack');
const wpf = coordsOf(wp, 'forecastTrack');
ok(wpp.every((c, i) => i === 0 || c[0] > wpp[i - 1][0]),
   'the path runs continuously east across 180 instead of tearing back');
ok(wpp[0][0] === 176.0, 'the first vertex keeps its published longitude');
ok(near(wpf[wpf.length - 1][0], 182.6, 1e-6),
   'the far end is expressed past 180 (182.6, not −177.4) so MapLibre draws it whole');
ok(samePt(wpp[wpp.length - 1], wpf[0]), 'and it still joins across the seam');

/* ---------------------------------------------------------------------------
 * FRAME BUDGET
 * ------------------------------------------------------------------------- */
section('cost');
/* A mature storm: 45 six-hourly fixes plus a seven-point forecast, ten of them
 * on screen, pushed the way an ambient repush pushes them. */
const bigPast = Array.from({ length: 45 }, (_, i) => [-40 - i * 0.55, 12 + i * 0.28]);
const bigFcst = Array.from({ length: 7 }, (_, i) => [-40 + i * 0.9, 12 - i * 0.4]);
const bundle = () => ({ layers: { pastTrack: slot([line(bigPast)]), forecastTrack: slot([line(bigFcst)]) } });
const t0 = performance.now();
for (let i = 0; i < 100; i++) smoothTracks(bundle());
const ms = (performance.now() - t0) / 100;
const big = smoothTracks(bundle());
const total = coordsOf(big, 'pastTrack').length + coordsOf(big, 'forecastTrack').length;
ok(total <= TRACK_LINE.maxVertices + 2, `a mature storm lands at ${total} vertices, inside the ceiling`);
ok(ms < 5, `one storm costs ${ms.toFixed(2)} ms — ten of them is nowhere near a frame`);

/* --- report --------------------------------------------------------------- */
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (the maths is checked; whether the path READS as a hurricane is a question for glass)');
