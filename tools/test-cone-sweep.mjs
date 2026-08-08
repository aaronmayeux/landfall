#!/usr/bin/env node
/**
 * test-cone-sweep.mjs — the cone rebuilt as a swept circle (lib/cone-sweep.js).
 *
 * ZERO DEPENDENCIES, like every other suite here.
 *
 * ==> WHY THIS SUITE BUILDS ITS OWN GROUND TRUTH, AND WHY IT DOES IT THE HARD
 * WAY. <== Three hand-written "published cones" were tried while this module
 * was being built and ALL THREE were wrong — a nearest-neighbour walk over
 * circle samples that produced a tangle, an arc-stitching construction whose
 * radii could not be recovered from it, and a version that drew circles in raw
 * lon/lat when the code works in a locally-isotropic frame. Each one sent the
 * investigation after a bug in the module that was really a bug in the fixture.
 *
 * So the fixture is built from a PREDICATE, not from drawn geometry: a point is
 * inside the cone if it is inside any circle centred anywhere on the segment
 * between two consecutive forecast points, with the radius interpolated. That
 * is the definition of the published shape, it is impossible to get subtly
 * wrong, and the outline is recovered from it by marching squares. The suite
 * then CHECKS ITSELF by recovering the radii back out of the outline and
 * comparing them to the ones it built with. If that check fails, the fixture is
 * broken and every assertion below it is meaningless.
 *
 * Storms are placed near the equator on purpose, so cos(latitude) ≈ 1 and the
 * planar frame is a no-op. The frame is exercised by the real-payload case at
 * the bottom, which sits at 20°N.
 *
 * WHAT IT CANNOT PROVE: that the cone LOOKS right against its track. Glass.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { sweepCone } = await import('../lib/cone-sweep.js');
const { smoothPath } = await import('../lib/trackline.js');
const { CONE_SWEEP } = await import('../config/constants.js');

/* ---------------------------------------------------------------------------
 * GROUND TRUTH
 * ------------------------------------------------------------------------- */

/** Inside the published cone: inside any circle swept along the STRAIGHT
 *  segments between consecutive forecast points. That is what a source draws. */
function hullPredicate(C, R, steps = 64) {
  return (p) => {
    for (let i = 0; i < C.length - 1; i++) {
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const cx = C[i][0] + (C[i + 1][0] - C[i][0]) * t;
        const cy = C[i][1] + (C[i + 1][1] - C[i][1]) * t;
        const r = R[i] + (R[i + 1] - R[i]) * t;
        if ((p[0] - cx) ** 2 + (p[1] - cy) ** 2 <= r * r) return true;
      }
    }
    return false;
  };
}

/** Marching squares, chained into one closed ring. */
function contour(pred, x0, x1, y0, y1, h) {
  const nx = Math.ceil((x1 - x0) / h) + 1;
  const ny = Math.ceil((y1 - y0) / h) + 1;
  const g = [];
  for (let i = 0; i < nx; i++) {
    g.push([]);
    for (let j = 0; j < ny; j++) g[i].push(pred([x0 + i * h, y0 + j * h]) ? 1 : 0);
  }
  const segs = [];
  const P = (i, j) => [x0 + i * h, y0 + j * h];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  for (let i = 0; i < nx - 1; i++) for (let j = 0; j < ny - 1; j++) {
    const idx = g[i][j] | (g[i + 1][j] << 1) | (g[i + 1][j + 1] << 2) | (g[i][j + 1] << 3);
    if (idx === 0 || idx === 15) continue;
    const B = mid(P(i, j), P(i + 1, j));
    const Rt = mid(P(i + 1, j), P(i + 1, j + 1));
    const T = mid(P(i, j + 1), P(i + 1, j + 1));
    const Lf = mid(P(i, j), P(i, j + 1));
    const push = (p, q) => segs.push([p, q]);
    switch (idx) {
      case 1: case 14: push(Lf, B); break;
      case 2: case 13: push(B, Rt); break;
      case 3: case 12: push(Lf, Rt); break;
      case 4: case 11: push(Rt, T); break;
      case 6: case 9: push(B, T); break;
      case 7: case 8: push(Lf, T); break;
      case 5: push(Lf, B); push(Rt, T); break;
      case 10: push(B, Rt); push(Lf, T); break;
    }
  }
  const key = (p) => p[0].toFixed(6) + ',' + p[1].toFixed(6);
  const map = new Map();
  for (const [p, q] of segs) {
    if (!map.has(key(p))) map.set(key(p), []);
    map.get(key(p)).push(q);
    if (!map.has(key(q))) map.set(key(q), []);
    map.get(key(q)).push(p);
  }
  const start = segs[0][0];
  const ring = [start];
  let prev = null;
  let cur = start;
  for (let n = 0; n < segs.length * 2 + 10; n++) {
    const nb = map.get(key(cur)) || [];
    const nxt = nb.find((v) => !prev || key(v) !== key(prev));
    if (!nxt) break;
    if (key(nxt) === key(start)) { ring.push(start); break; }
    ring.push(nxt);
    prev = cur;
    cur = nxt;
  }
  return ring;
}

/** A storm of fixed track LENGTH whose heading rotates by `turnDeg` across it.
 *  Length is held constant on purpose: an earlier version varied the turn by
 *  shortening the track, which at low turn made the day-5 circle bigger than
 *  the whole track and produced a "cone" that was one disc. */
function storm(turnDeg, n = 8, L = 20) {
  const C = [[140, 1]];
  const R = [];
  const ds = L / (n - 1);
  for (let i = 1; i < n; i++) {
    const h = ((140 + (turnDeg * (i - 0.5)) / (n - 1)) * Math.PI) / 180;
    C.push([C[i - 1][0] + ds * Math.cos(h), C[i - 1][1] + ds * Math.sin(h)]);
  }
  /* Convex growth, like a real cone: the radius accelerates. That convexity is
   * what exposed the monotone-cubic sag, so a linear ramp here would hide it. */
  for (let i = 0; i < n; i++) R.push(0.35 + 3.15 * (i / (n - 1)) ** 1.4);
  return { C, R };
}

function published(C, R, h = 0.04) {
  const xs = C.map((p) => p[0]);
  const ys = C.map((p) => p[1]);
  const m = Math.max(...R) + 1;
  return contour(hullPredicate(C, R), Math.min(...xs) - m, Math.max(...xs) + m,
    Math.min(...ys) - m, Math.max(...ys) + m, h);
}

/* ---------------------------------------------------------------------------
 * MEASURES
 * ------------------------------------------------------------------------- */

const open = (r) =>
  (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) ? r.slice(0, -1) : r;

function area(r) {
  const p = open(r);
  let A = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    A += p[i][0] * p[j][1] - p[j][0] * p[i][1];
  }
  return Math.abs(A / 2);
}

function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function inRing(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][1];
    const yj = ring[j][1];
    if ((yi > pt[1]) !== (yj > pt[1]) &&
        pt[0] < ((ring[j][0] - ring[i][0]) * (pt[1] - yi)) / (yj - yi) + ring[i][0]) c = !c;
  }
  return c;
}

/** Deepest point of `inner` lying outside `outer`. */
function worstUndercut(inner, outer) {
  let w = 0;
  for (const v of inner) {
    if (inRing(v, outer)) continue;
    let d = Infinity;
    for (let i = 0; i < outer.length - 1; i++) d = Math.min(d, segDist(v, outer[i], outer[i + 1]));
    if (d > w) w = d;
  }
  return w;
}

/**
 * The longest stretch of outline, in degrees of arc, over which the direction
 * turns by less than 1° in total. THE METRIC THE WHOLE JOB IS JUDGED ON —
 * "faceted" means a long run of this, and the first attempt at this suite got
 * it wrong by testing the angle at each VERTEX instead of the running total,
 * which reads any finely-sampled curve as straight.
 */
function longestStraightRun(r) {
  const p = open(r);
  const n = p.length;
  const seg = [];
  const dir = [];
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    seg.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
    dir.push(Math.atan2(b[1] - a[1], b[0] - a[0]));
  }
  let best = 0;
  for (let i = 0; i < n; i++) {
    let L = 0;
    let turn = 0;
    for (let j = i; j < i + n; j++) {
      const k = j % n;
      let d = dir[(j + 1) % n] - dir[k];
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      turn += Math.abs(d);
      if ((turn * 180) / Math.PI >= 1) break;
      L += seg[k];
    }
    if (L > best) best = L;
  }
  return best;
}

function selfIntersects(r) {
  const p = open(r);
  const n = p.length;
  const s = (u, v, w) => Math.sign((v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]));
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = p[i], b = p[(i + 1) % n], c = p[j], d = p[(j + 1) % n];
      if (s(a, b, c) !== s(a, b, d) && s(c, d, a) !== s(c, d, b)) return true;
    }
  }
  return false;
}

/* ---------------------------------------------------------------------------
 * THE FIXTURE CHECKS ITSELF FIRST
 * ------------------------------------------------------------------------- */

section('the ground truth is sound — if this fails, nothing below means anything');
{
  const { C, R } = storm(30);
  const pub = published(C, R);
  ok(pub.length > 500, `marching squares recovered a dense outline (${pub.length} vertices)`);
  ok(pub[0][0] === pub[pub.length - 1][0] && pub[0][1] === pub[pub.length - 1][1],
     'and it closes');

  /* Recover each circle's radius back out of the outline. This is the same
   * measurement lib/cone-sweep.js makes, so if the fixture is a tangle the
   * numbers come back wrong here rather than silently poisoning the module. */
  let worst = 0;
  C.forEach((c, i) => {
    let m = Infinity;
    for (let j = 0; j < pub.length - 1; j++) m = Math.min(m, segDist(c, pub[j], pub[j + 1]));
    worst = Math.max(worst, Math.abs(m - R[i]));
  });
  ok(worst < 0.03, `every built radius is recoverable from it (worst error ${worst.toFixed(4)}°)`);
}

/* ---------------------------------------------------------------------------
 * THE SWEEP, ACROSS THE RANGE OF TURNS A STORM ACTUALLY MAKES
 * ------------------------------------------------------------------------- */

section('the sweep, from a straight run to a hard recurve');
for (const turnDeg of [0, 15, 30, 50, 75]) {
  const { C, R } = storm(turnDeg);
  const pub = published(C, R);
  const track = smoothPath(C);
  const swept = sweepCone(track, C, [pub]);

  ok(!!swept, `${turnDeg}°: the rebuild is accepted`);
  if (!swept) continue;

  /* Area may fall SLIGHTLY on a hard recurve — that is the accepted trade, the
   * inner flank giving back a little more than the outer flank gains. What it
   * may not do is move much in either direction: a big gain means the shape is
   * being inflated, a big loss means ground is being taken off a hazard layer. */
  const grow = area(swept) / area(pub) - 1;
  ok(grow > -0.01 && grow < 0.05,
     `${turnDeg}°: area barely moves (${(grow * 100).toFixed(1)}%)`);

  /* The undercut budget is the module's own: the sagitta of the smoothed track
   * plus a slice of the cone's radius for the polygon-corner artifact. Tested
   * against a bound computed HERE from the same rule, so a change to either
   * constant has to be a deliberate one. */
  const cut = worstUndercut(pub, swept);
  const allow = 0.02 * 20 * (turnDeg / 60) + Math.max(...R) * CONE_SWEEP.undercutRadiusFrac
    + 0.03; // + the fixture's own grid resolution
  ok(cut < allow,
     `${turnDeg}°: deepest undercut ${(cut * 111).toFixed(0)} km, inside the allowance`);

  ok(!selfIntersects(swept), `${turnDeg}°: the outline does not cross itself`);
}

section('THE POINT OF THE EXERCISE — the flanks bend instead of running straight');
{
  /* Few forecast points and a real turn: this is the shape that produced the
   * complaint, where a source's tangent lines are hundreds of km long. */
  const { C, R } = storm(60, 5, 20);
  const pub = published(C, R);
  const swept = sweepCone(smoothPath(C), C, [pub]);
  ok(!!swept, 'a sparse, strongly curving cone rebuilds');
  if (swept) {
    const before = longestStraightRun(pub);
    const after = longestStraightRun(swept);
    ok(before > 1.5, `the published outline has a long straight run (${before.toFixed(2)}°)`);
    ok(after < before / 2,
       `the rebuild breaks it up (${before.toFixed(2)}° → ${after.toFixed(2)}°)`);
  }
}

/* ---------------------------------------------------------------------------
 * THE THREE CAUSES OF UNDERCUT, EACH PINNED SO IT CANNOT COME BACK
 * ------------------------------------------------------------------------- */

section('a STRAIGHT track must reproduce the published cone EXACTLY');
{
  /* THIS IS THE REGRESSION TEST FOR TWO SEPARATE BUGS, and it is the tightest
   * assertion in the suite because both of them looked from outside exactly
   * like the sagitta trade the module openly accepts, while having nothing to
   * do with it:
   *
   *   - interpolating the radius with a monotone cubic ALONE. It sags below its
   *     own chords on the accelerating radii a real cone has, and the published
   *     flank sits precisely ON those chords. Worth 3.5 km on the shipped GDACS
   *     payload.
   *   - offsetting along the normal BY THE RADIUS. A widening cone's edge leans
   *     away from the track, so measured along the normal it is r/cos(φ) out,
   *     not r. Worth 11 km.
   *
   * With a straight track the sagitta is exactly zero and the published outline
   * is exactly reproducible, so the fixture is built ANALYTICALLY rather than by
   * marching squares — no grid, no noise, and a half-kilometre tolerance that
   * either bug blows straight through. The radii are strongly convex on purpose;
   * a linear ramp would hide the first bug completely. */
  const n = 6;
  const C = [];
  const R = [];
  for (let i = 0; i < n; i++) {
    C.push([140 - (i * 20) / (n - 1), 1]);
    R.push(0.3 + 3.2 * (i / (n - 1)) ** 2);
  }

  /* The exact hull outline of a chain of discs on a straight line: the outer
   * tangent between each consecutive pair, plus a half-circle at each end. */
  /* Outward unit normal of the tangent line touching discs i and i+1: the one
   * vector u with u·(C[i+1] − C[i]) = R[i] − R[i+1] and |u| = 1. The touch
   * point on each disc is then simply its centre plus its radius along u. */
  const normalOf = (i, sgn) => {
    const dx = C[i + 1][0] - C[i][0];
    const u1 = (R[i] - R[i + 1]) / dx;
    return [u1, sgn * Math.sqrt(Math.max(0, 1 - u1 * u1))];
  };
  const touch = (i, u) => [C[i][0] + R[i] * u[0], C[i][1] + R[i] * u[1]];
  const arc = (c, r, a0, a1, steps = 120) => {
    const o = [];
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (a1 - a0) * (k / steps);
      o.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
    return o;
  };
  /* THE TANGENT LEGS ARE SUBDIVIDED, and that is not cosmetic. A published leg
   * is two vertices, both sitting on a forecast point's own circle — the two
   * places the rebuild is exact by construction. A fixture carrying only those
   * cannot see a radius profile that sags in the MIDDLE of the leg, and for a
   * full round of testing it did not: a 3.5 km sag passed every assertion. */
  const along = (a, b, steps = 24) => {
    const o = [];
    for (let k = 0; k <= steps; k++) {
      o.push([a[0] + (b[0] - a[0]) * (k / steps), a[1] + (b[1] - a[1]) * (k / steps)]);
    }
    return o;
  };
  const upper = [];
  const lower = [];
  for (let i = 0; i < n - 1; i++) {
    const uu = normalOf(i, +1);
    const ul = normalOf(i, -1);
    upper.push(...along(touch(i, uu), touch(i + 1, uu)));
    lower.push(...along(touch(i, ul), touch(i + 1, ul)));
  }
  /* Caps run between the real touch angles, not a nominal ±90°, or the fixture
   * carries a notch of its own and stops being ground truth. */
  const uEndU = normalOf(n - 2, +1);
  const uEndL = normalOf(n - 2, -1);
  const uStU = normalOf(0, +1);
  const uStL = normalOf(0, -1);
  const ang = (u) => Math.atan2(u[1], u[0]);
  const pub = [
    ...upper,
    ...arc(C[n - 1], R[n - 1], ang(uEndU), 2 * Math.PI + ang(uEndL)),
    ...lower.slice().reverse(),
    ...arc(C[0], R[0], ang(uStL), ang(uStU)),
  ];
  pub.push(pub[0].slice());

  /* The fixture checks itself, same rule as the marching-squares one. */
  let worstR = 0;
  C.forEach((c, i) => {
    let m = Infinity;
    for (let j = 0; j < pub.length - 1; j++) m = Math.min(m, segDist(c, pub[j], pub[j + 1]));
    worstR = Math.max(worstR, Math.abs(m - R[i]));
  });
  ok(worstR < 0.002, `the analytic fixture is exact (radius error ${worstR.toFixed(5)}°)`);

  const swept = sweepCone(smoothPath(C), C, [pub]);
  ok(!!swept, 'a straight cone rebuilds');
  if (swept) {
    const cut = worstUndercut(pub, swept);
    ok(cut < 0.005,
       `and lands ON the published flank, not inside it (${(cut * 111).toFixed(2)} km)`);
    ok(area(swept) / area(pub) - 1 < 0.02,
       `without inflating it either (+${((area(swept) / area(pub) - 1) * 100).toFixed(2)}%)`);
  }
}

section('refusals — it must decline rather than draw something wrong');
{
  const { C, R } = storm(30);
  const pub = published(C, R);

  const elsewhere = C.map((p) => [p[0] - 40, p[1] + 25]);
  ok(sweepCone(smoothPath(elsewhere), elsewhere, [pub]) === null,
     'a cone belonging to a different storm is refused, not swept');

  ok(sweepCone(smoothPath(C), C.slice(0, 1), [pub]) === null,
     'one forecast point is not a track to sweep along');
  ok(sweepCone([[1, 1], [2, 2]], C, [pub]) === null, 'a two-vertex track is refused');
  ok(sweepCone(smoothPath(C), C, []) === null, 'no published rings, no rebuild');
  ok(sweepCone(null, C, [pub]) === null, 'no track at all is survivable');
}

/* ---------------------------------------------------------------------------
 * REAL PAYLOAD — the shipped GDACS cone, at 20°N so the planar frame is live
 * ------------------------------------------------------------------------- */

section('the real GDACS cone from samples/');
{
  const raw = JSON.parse(fs.readFileSync('samples/gdacs/geometry-TC.json', 'utf8'));
  const feats = Array.isArray(raw) ? raw : raw.features;
  const cone = feats.find((f) => f?.properties?.Class === 'Poly_Cones')?.geometry?.coordinates?.[0];
  const segs = feats
    .filter((f) => String(f?.properties?.Class || '').startsWith('Line_') &&
                   String(f?.properties?.forecast) === 'true')
    .map((f) => f.geometry.coordinates);

  ok(!!cone && segs.length > 3, 'the sample still carries a cone and a forecast track');
  if (cone && segs.length > 3) {
    const pts = [segs[0][0]];
    for (const s of segs) pts.push(s[1]);
    const swept = sweepCone(smoothPath(pts), pts, [cone]);
    ok(!!swept, 'the shipped payload rebuilds');
    if (swept) {
      const grow = area(swept) / area(cone) - 1;
      ok(grow > 0 && grow < 0.05, `area grows ${(grow * 100).toFixed(2)}%`);
      const cut = worstUndercut(cone, swept);
      ok(cut < 0.02, `deepest undercut ${(cut * 111).toFixed(1)} km — corner clipping, not a gap`);
      ok(!selfIntersects(swept), 'and the outline does not cross itself');
    }
  }
}

console.log('');
if (failures.length) {
  console.log(`✗ ${failures.length} failed, ${pass} passed\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log('');
  process.exit(1);
}
console.log(`✓ ${pass} assertions passed`);
console.log('  (geometry only — whether the cone LOOKS right against its track is glass)');
