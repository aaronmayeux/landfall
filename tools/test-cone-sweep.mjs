#!/usr/bin/env node
/**
 * test-cone-sweep.mjs — the cone redrawn along the smoothed track.
 *
 * ZERO DEPENDENCIES, like every other suite here.
 *
 * ==> THE ASSERTION THIS SUITE EXISTS FOR IS "ASYMMETRY SURVIVES". <== The
 * previous design modelled a cone as a growing circle and recovered ONE radius
 * per forecast point. Measured on the shipped GDACS payload, a published cone
 * is up to 43% wider on one side of its own forecast track than the other, so
 * that model collapsed two real numbers into the smaller one, came out too
 * narrow, tripped its own safety check and fell back on every storm. Silently.
 * The suite now pins the property that broke: what goes in on each side comes
 * out on that side.
 *
 * Fixtures are built at the equator so cos(latitude) ≈ 1 and the planar frame
 * is a no-op; the real-payload case at the bottom sits at 20°N and exercises it.
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

const { sweepCone, sweepConeDetail } = await import('../lib/cone-sweep.js');
const { measureConeRibs } = await import('../lib/cone-measure.js');
const { smoothPath, smoothTracks } = await import('../lib/trackline.js');

/* ---------------------------------------------------------------------------
 * FIXTURES
 * ------------------------------------------------------------------------- */

/** A storm of fixed track length whose heading rotates by `turnDeg` across it. */
function storm(turnDeg, n = 8, L = 20) {
  const C = [[140, 1]];
  const ds = L / (n - 1);
  for (let i = 1; i < n; i++) {
    const h = ((140 + (turnDeg * (i - 0.5)) / (n - 1)) * Math.PI) / 180;
    C.push([C[i - 1][0] + ds * Math.cos(h), C[i - 1][1] + ds * Math.sin(h)]);
  }
  const R = [];
  for (let i = 0; i < n; i++) R.push(0.35 + 3.15 * (i / (n - 1)) ** 1.4);
  return { C, R };
}

/** The outer tangent normal between two discs. */
function tangentNormal(c1, r1, c2, r2, sgn) {
  const dx = c2[0] - c1[0];
  const dy = c2[1] - c1[1];
  const d = Math.hypot(dx, dy);
  const g = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
  const a = Math.atan2(dy, dx) + sgn * g;
  return [Math.cos(a), Math.sin(a)];
}

/** A published cone, built the way a source builds one: the discs at each
 *  forecast hour joined by the lines pulled taut around consecutive pairs.
 *  The STRAIGHT LEGS are the thing under test. */
function publishedCone(C, R, step = 0.05) {
  const side = (sgn) => {
    const pts = [];
    for (let i = 0; i < C.length - 1; i++) {
      const u = tangentNormal(C[i], R[i], C[i + 1], R[i + 1], sgn);
      const prev = i > 0 ? tangentNormal(C[i - 1], R[i - 1], C[i], R[i], sgn) : null;
      if (prev) {
        let a0 = Math.atan2(prev[1], prev[0]);
        const a1 = Math.atan2(u[1], u[0]);
        let da = a1 - a0;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        const n = Math.max(1, Math.ceil((Math.abs(da) * R[i]) / step));
        for (let k = 0; k <= n; k++) {
          const a = a0 + (da * k) / n;
          pts.push([C[i][0] + R[i] * Math.cos(a), C[i][1] + R[i] * Math.sin(a)]);
        }
      } else pts.push([C[i][0] + R[i] * u[0], C[i][1] + R[i] * u[1]]);
      pts.push([C[i + 1][0] + R[i + 1] * u[0], C[i + 1][1] + R[i + 1] * u[1]]);
    }
    return pts;
  };
  const cap = (c, r, from, to, dir) => {
    let a0 = Math.atan2(from[1], from[0]);
    const a1 = Math.atan2(to[1], to[0]);
    let da = a1 - a0;
    while (da * dir < 0) da += dir * 2 * Math.PI;
    const n = Math.max(8, Math.ceil((Math.abs(da) * r) / step));
    const o = [];
    for (let k = 1; k < n; k++) {
      const a = a0 + (da * k) / n;
      o.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
    return o;
  };
  const L = side(+1);
  const Rt = side(-1);
  const l = C.length - 1;
  const ring = [
    ...L,
    ...cap(C[l], R[l], tangentNormal(C[l - 1], R[l - 1], C[l], R[l], +1),
           tangentNormal(C[l - 1], R[l - 1], C[l], R[l], -1), -1),
    ...Rt.slice().reverse(),
    ...cap(C[0], R[0], tangentNormal(C[0], R[0], C[1], R[1], -1),
           tangentNormal(C[0], R[0], C[1], R[1], +1), -1),
  ];
  ring.push(ring[0].slice());
  return ring;
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

/** First crossing of `ring` from `p` along unit `d`. */
function ray(p, d, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const den = d[0] * ey - d[1] * ex;
    if (!den) continue;
    const ax = a[0] - p[0];
    const ay = a[1] - p[1];
    const t = (ax * ey - ay * ex) / den;
    const u = (ax * d[1] - ay * d[0]) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return Number.isFinite(best) ? best : NaN;
}

/** Tangent of the track nearest `q`. */
function tangentAt(q, track) {
  let bi = 0;
  let bd = Infinity;
  track.forEach((p, i) => {
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < bd) { bd = d; bi = i; }
  });
  const a = track[Math.max(0, bi - 1)];
  const b = track[Math.min(track.length - 1, bi + 1)];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  return [dx / L, dy / L];
}

/** Longest stretch, in degrees of arc, turning less than 1° in total. THE
 *  METRIC THE JOB IS JUDGED ON — "faceted" is a long run of this. */
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

/** Total absolute turning, degrees. A smooth convex ring is 360 however finely
 *  it is sampled; RIPPLE is what pushes it up, so this is the ripple meter.
 *  Zero-length segments are dropped or they inject nonsense angles. */
function totalTurning(r) {
  const p = open(r).filter((q, i, arr) =>
    i === 0 || Math.hypot(q[0] - arr[i - 1][0], q[1] - arr[i - 1][1]) > 1e-9);
  const n = p.length;
  let T = 0;
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n];
    const b = p[i];
    const c = p[(i + 1) % n];
    let d = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    T += Math.abs(d);
  }
  return (T * 180) / Math.PI;
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
 * THE POINT OF THE EXERCISE
 * ------------------------------------------------------------------------- */

section('a curving storm — the flanks must stop being straight');
{
  const { C, R } = storm(70);
  const pub = publishedCone(C, R);
  const track = smoothPath(C);
  const out = sweepCone(track, [pub]);
  ok(!!out, 'it rebuilds');
  if (out) {
    const before = longestStraightRun(pub);
    const after = longestStraightRun(out);
    ok(before > 2, `the published outline runs straight for ${before.toFixed(2)}°`);
    ok(after < before / 2, `and the rebuild does not (${before.toFixed(2)}° → ${after.toFixed(2)}°)`);

    /* RIPPLE IS THE FAILURE MODE OF THIS DESIGN, not faceting. Measuring the
     * width perpendicular to a curving track against a straight published leg
     * gives a profile that dips mid-leg and peaks at the corners; too narrow a
     * blur leaves that oscillation in the drawn edge as a wobble. Measured at
     * a 1° window: total turning 1477°. At the shipped window it settles near
     * 1000°, and a perfectly smooth convex ring would be 360°. */
    const turn = totalTurning(out);
    ok(turn < 1100, `and it does not ripple (total turning ${turn.toFixed(0)}°, < 1100)`);
    ok(!selfIntersects(out), 'and does not cross itself');

    const grow = area(out) / area(pub) - 1;
    ok(Math.abs(grow) < 0.05, `area stays close to published (${(grow * 100).toFixed(1)}%)`);
  }
}

section('a lopsided cone stays lopsided — nothing here assumes symmetry');
{
  /* Real published cones ARE symmetric about their track — see the payload
   * case below, and note that this suite once asserted the opposite on the
   * strength of a broken ray test. This is a PROPERTY test, not a claim about
   * the data: the two sides are measured independently, so a source that ever
   * did publish a lopsided cone would be drawn lopsided rather than averaged
   * into a shape nobody published. */
  const { C } = storm(40);
  const track = smoothPath(C);
  const wide = (i, n) => 0.5 + 2.0 * (i / n);          // left
  const narrow = (i, n) => 0.3 + 0.8 * (i / n);        // right
  const tanOf = (i) => {
    const a = track[Math.max(0, i - 1)];
    const b = track[Math.min(track.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    return [dx / L, dy / L];
  };
  const n = track.length - 1;
  const left = track.map((p, i) => {
    const t = tanOf(i);
    return [p[0] - t[1] * wide(i, n), p[1] + t[0] * wide(i, n)];
  });
  const right = track.map((p, i) => {
    const t = tanOf(i);
    return [p[0] + t[1] * narrow(i, n), p[1] - t[0] * narrow(i, n)];
  });
  const pub = [...left, ...right.slice().reverse()];
  pub.push(pub[0].slice());

  const out = sweepCone(track, [pub]);
  ok(!!out, 'a lopsided cone rebuilds');
  if (out) {
    /* Sample well inside the ends, where the caps do not dominate. */
    let worstL = 0;
    let worstR = 0;
    for (const frac of [0.35, 0.5, 0.65]) {
      const i = Math.round(track.length * frac);
      const t = tanOf(i);
      const nn = [-t[1], t[0]];
      const pl = ray(track[i], nn, pub);
      const pr = ray(track[i], [-nn[0], -nn[1]], pub);
      const ol = ray(track[i], nn, out);
      const or = ray(track[i], [-nn[0], -nn[1]], out);
      ok(Number.isFinite(pl) && Number.isFinite(pr) && Number.isFinite(ol) && Number.isFinite(or),
         `at ${(frac * 100) | 0}% along, all four widths are measurable`);
      worstL = Math.max(worstL, Math.abs(ol - pl));
      worstR = Math.max(worstR, Math.abs(or - pr));
      ok(ol > or * 1.5,
         `at ${(frac * 100) | 0}% along, the rebuild is still much wider on the left (${ol.toFixed(2)} vs ${or.toFixed(2)})`);
    }
    ok(worstL < 0.15 && worstR < 0.15,
       `and both widths match the published ones (worst ${(Math.max(worstL, worstR) * 111).toFixed(0)} km)`);
  }
}

section('a short forecast must not be smoothed into a sausage');
{
  /* The blur window is wide on purpose. A cone shorter than the window would
   * have its taper flattened away without the cap on window length. */
  const { C, R } = storm(20, 4, 5);
  const pub = publishedCone(C, R);
  const track = smoothPath(C);
  const out = sweepCone(track, [pub]);
  ok(!!out, 'a short cone rebuilds');
  if (out) {
    const tanOf = (q) => tangentAt(q, track);
    const near = track[Math.round(track.length * 0.15)];
    const far = track[Math.round(track.length * 0.85)];
    const wN = ray(near, [-tanOf(near)[1], tanOf(near)[0]], out);
    const wF = ray(far, [-tanOf(far)[1], tanOf(far)[0]], out);
    ok(wF > wN * 1.5, `it still tapers (${wN.toFixed(2)}° near the storm → ${wF.toFixed(2)}° at the far end)`);
  }
}

section('the antimeridian — the inputs do not arrive on the same branch');
{
  /* lib/trackline.js emits the smoothed track UNWRAPPED (past ±180, so MapLibre
   * draws one continuous line across the seam); the cone arrives wrapped. Before
   * this was handled every dateline-crossing storm refused itself silently. */
  const { C, R } = storm(40);
  const pub = publishedCone(C, R);
  const home = sweepCone(smoothPath(C), [pub]);
  ok(!!home, 'the storm rebuilds away from the seam');

  const wrap = (x) => { let v = x; while (v > 180) v -= 360; while (v <= -180) v += 360; return v; };
  const delta = 180 - (C[0][0] + C[C.length - 1][0]) / 2;
  const pubW = pub.map((p) => [wrap(p[0] + delta), p[1]]);
  const trackUnwrapped = smoothPath(C).map((p) => [p[0] + delta, p[1]]);
  ok(Math.max(...trackUnwrapped.map((p) => p[0])) > 180,
     'the fixture really does put the track past ±180');
  ok(Math.min(...pubW.map((p) => p[0])) < 0 && Math.max(...pubW.map((p) => p[0])) > 0,
     'and really does split the cone across the seam');

  const seam = sweepCone(trackUnwrapped, [pubW]);
  ok(!!seam, 'the same storm on the dateline rebuilds too');
  if (home && seam) {
    let worst = 0;
    for (let i = 0; i < home.length; i++) {
      worst = Math.max(worst, Math.abs((seam[i][0] - delta) - home[i][0]),
                              Math.abs(seam[i][1] - home[i][1]));
    }
    ok(worst < 1e-6, `the shape is identical once the shift is removed (${worst.toExponential(1)}°)`);
    let jump = 0;
    for (let i = 1; i < seam.length; i++) jump = Math.max(jump, Math.abs(seam[i][0] - seam[i - 1][0]));
    ok(jump < 180, `and the ring does not tear (largest step ${jump.toFixed(2)}°)`);
  }
}

section('the ribs and the two caps — the parts the ring throws away');
{
  /* NOTHING EXERCISED THESE UNTIL NOW. `sweepConeDetail` is what the
   * environment ribbon (§47.5) is built from, and its ribbon suite runs on
   * hand-written stations — so the shapes this function actually produces went
   * out untested while the arithmetic that consumes them was covered hard. */
  const { C, R } = storm(30);
  const pub = publishedCone(C, R);
  const track = smoothPath(C);
  const d = sweepConeDetail(track, [pub]);

  ok(!!d, 'a cone that rebuilds hands back its detail too');
  ok(d && d.ring.length === sweepCone(track, [pub]).length,
     'and the ring is the same ring sweepCone returns — one measurement, not two');
  ok(d && d.ribs.length > 10, 'with a station every step along the track');
  ok(d && d.ribs[0].t === 0 && Math.abs(d.ribs[d.ribs.length - 1].t - 1) < 1e-12,
     'whose `t` runs 0 at the storm to 1 at the end of the forecast');
  ok(d && d.ribs.every((r, i) => i === 0 || r.t > d.ribs[i - 1].t),
     'ascending, never repeating — the ribbon interpolates hours across these');

  /* ==> A REPEATED VERTEX IS A ZERO-LENGTH SEGMENT, AND A ZERO-LENGTH SEGMENT
   * HAS NO DIRECTION. <== Enough to make a self-intersection test report a
   * crossing that is not there, and enough to hand MapLibre a degenerate edge
   * to triangulate. The body ring has always stripped these; both cap quarters
   * own the point dead ahead, so every cap shipped one until this assertion
   * existed. */
  const repeats = (ring) => {
    let n = 0;
    for (let i = 1; i < ring.length; i++) {
      if (Math.abs(ring[i][0] - ring[i - 1][0]) < 1e-9
       && Math.abs(ring[i][1] - ring[i - 1][1]) < 1e-9) n++;
    }
    /* The closing point repeats the FIRST, which is the opposite end of the
     * ring from its own neighbour, so it never lands in this count. A ring
     * that failed to close is the assertion above. */
    return n;
  };
  for (const [name, ring] of [['start', d?.capStart], ['end', d?.capEnd]]) {
    ok(ring && ring.length > 8, `the ${name} cap is a real half-ellipse, not a sliver`);
    ok(ring && ring[0][0] === ring[ring.length - 1][0]
            && ring[0][1] === ring[ring.length - 1][1],
       `the ${name} cap ring closes`);
    ok(ring && repeats(ring) === 0,
       `and carries no repeated vertex — the ${name} cap's two quarters share the nose`);
  }

  /* THE CAPS JOIN THE BODY EXACTLY. Each closes across the end station's own
   * rib, so a cap that drifted off it would leave a hairline of plain veil
   * showing through the ribbon at the seam. */
  if (d) {
    const first = d.ribs[0];
    const lastRib = d.ribs[d.ribs.length - 1];
    const touches = (ring, pt) =>
      ring.some((p) => Math.abs(p[0] - pt[0]) < 1e-9 && Math.abs(p[1] - pt[1]) < 1e-9);
    ok(touches(d.capStart, first.left) && touches(d.capStart, first.right),
       'the start cap closes on the first station\'s own two edge points');
    ok(touches(d.capEnd, lastRib.left) && touches(d.capEnd, lastRib.right),
       'and the end cap on the last station\'s');
  }
}

section('refusals — decline rather than draw something wrong');
{
  const { C, R } = storm(30);
  const pub = publishedCone(C, R);
  const elsewhere = C.map((p) => [p[0] - 60, p[1] + 30]);
  ok(sweepCone(smoothPath(elsewhere), [pub]) === null,
     'a cone belonging to a different storm is refused');
  ok(sweepCone([[1, 1], [2, 2]], [pub]) === null, 'a two-vertex track is refused');
  ok(sweepCone(smoothPath(C), []) === null, 'no rings, no rebuild');
  ok(sweepCone(null, [pub]) === null, 'no track at all is survivable');
  ok(sweepCone(smoothPath(C), [[[0, 0], [1, 1]]]) === null, 'a degenerate ring is refused');

  /* ==> THE MEASURING PATH REFUSES ON THE SAME TERMS, AND HAS TO. <== It is
   * the softer of the two by design — it marks stations instead of throwing
   * the cone away — and the temptation is to let it answer for anything. The
   * hit floor is where softness stops: below it the track and the cone are not
   * describing the same storm, and slicing a shape the track can barely see
   * would put confident color on a cone that is not this storm's. Refusing is
   * the honest answer and §47.9 already has a sentence for it. */
  ok(measureConeRibs(smoothPath(elsewhere), [pub]) === null,
     'and a cone belonging to a different storm is not MEASURED either');
  ok(measureConeRibs([[1, 1], [2, 2]], [pub]) === null, 'nor is a two-vertex track');
  ok(measureConeRibs(smoothPath(C), []) === null, 'nor a cone with no rings');
  ok(measureConeRibs(null, [pub]) === null, 'and no track at all is survivable here too');
}

/* ---------------------------------------------------------------------------
 * A REBUILD THAT DECLINES MUST STILL MEASURE — §7.9, §47.5.
 *
 * ==> EVERY SYNTHETIC FIXTURE ABOVE PASSED WHILE THE REBUILD WAS REFUSING A
 * THIRD OF A REAL HURRICANE. <== Measured 2026-08-18, after Aaron reported the
 * environment ribbon appearing and disappearing between advisories: of the 35
 * archived Ida cones, twelve were refused, all twelve at `folds`, and on
 * advisory 006 the refusal came from ONE station out of 316. Nothing in this
 * file turned hard enough or carried a cone wide enough relative to its turn to
 * reach that, so the guard costing a third of the ribbons was invisible from
 * inside it. That is what this block is for, and why it is a CORPUS rather than
 * twelve named cases — the failure was not a wrong shape on one advisory, it
 * was color that came and went as the storm turned.
 *
 * ==> THE REBUILD IS STILL ALLOWED TO REFUSE, AND MUST STAY ALLOWED TO. <== A
 * first attempt held the widths back to where `folds` could not fire; all 35
 * then swept and TEN of the twelve recovered outlines crossed themselves,
 * because `folds` is a cheap proxy for self-intersection rather than a test of
 * it. So nothing here asserts that the sweep succeeds. What it asserts is that
 * a refusal costs the DRAWING nothing it was not already going to cost, and
 * costs the MEASUREMENT nothing at all.
 *
 * The fixtures are NHC's own 5-day cone polygon and forecast track, run through
 * the same `smoothTracks` the app applies before `smoothCone` ever sees them —
 * the raw published line is not what the sweep is fed, and feeding it here
 * would test a path that does not exist.
 * ------------------------------------------------------------------------- */
section('every cone Ida ever published');
{
  const dirs = fs.readdirSync('samples/ida-al092021/gis').sort();
  const swept = [];
  const measured = [];
  const blind = [];
  /* Kept so the constructed-refusal block below works the SAME pairs this loop
   * saw, rather than re-reading and re-smoothing them into a second answer. */
  const corpusPairs = [];
  let crossed = 0;
  let outside = 0;
  let unusable = 0;

  /** Distance from a point to a ring, DEGREES.
   *
   *  ==> IT IS A DISTANCE AND NOT AN INSIDE/OUTSIDE TEST, AND THE FIRST
   *  VERSION WAS THE SECOND. <== A measured rib point IS a ray hit on the
   *  published outline, so it lies exactly ON the ring — and an even-odd
   *  point-in-polygon test answers a coin flip for a point on its own edge. It
   *  reported 317 of 357 ribs "outside" at a worst distance of 0.0 m. Asking
   *  how far a point is from the outline is the question that was actually
   *  meant, and it has an answer that is not about rounding. */
  const toRing = (v, r) => {
    let best = Infinity;
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i];
      const b = r[i + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const L = dx * dx + dy * dy;
      let t = L ? ((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = a[0] + t * dx - v[0];
      const qy = a[1] + t * dy - v[1];
      best = Math.min(best, qx * qx + qy * qy);
    }
    return Math.sqrt(best);
  };
  /** One metre, in degrees. Nothing this path does should exceed it. */
  const ON_RING = 1e-5;

  for (const d of dirs) {
    const pg = `samples/ida-al092021/gis/${d}/5day_pgn.geojson`;
    const ln = `samples/ida-al092021/gis/${d}/5day_lin.geojson`;
    if (!fs.existsSync(pg) || !fs.existsSync(ln)) continue;
    const poly = JSON.parse(fs.readFileSync(pg, 'utf8'))
      .features.find((f) => f.geometry?.type === 'Polygon');
    const linfc = JSON.parse(fs.readFileSync(ln, 'utf8'));
    if (!poly) continue;

    /* The app's own order: smooth the track, then work the cone along it. */
    const sm = smoothTracks(
      { layers: { forecastTrack: { status: 'ok', fc: linfc } }, forecast: [], past: [] },
      'Ida'
    );
    const feats = sm.layers.forecastTrack.fc.features;
    if (feats.length !== 1 || feats[0].geometry.type !== 'LineString') continue;
    const track = feats[0].geometry.coordinates;
    const rings = poly.geometry.coordinates;
    corpusPairs.push([track, rings]);

    const out = sweepConeDetail(track, rings);
    if (out) {
      swept.push(d);
      if (selfIntersects(out.ring)) crossed++;
      continue;
    }

    const m = measureConeRibs(track, rings);
    if (!m) { blind.push(d); continue; }
    measured.push(d);

    /* ==> A MEASURED RIB IS A RAY HIT ON THE PUBLISHED OUTLINE, SO IT LIES ON
     * IT. <== This is the entire justification for painting a ribbon on a cone
     * the rebuild would not draw, and it is the one property worth asserting
     * rather than trusting: if every rib end sits on the published edge, the
     * color is inside the shape on screen by construction rather than by
     * agreement. It is also what fails the moment somebody adds a blur or a
     * gap-fill to this path for tidiness — both move a width off the outline,
     * which is exactly right for a shape being drawn and exactly wrong for a
     * measurement of somebody else's. `ok:false` ribs are parked on the track
     * and carry no measurement, so they are not asked. */
    for (const rib of m.ribs) {
      if (!rib.ok) continue;
      if (toRing(rib.left, rings[0]) > ON_RING) outside++;
      if (toRing(rib.right, rings[0]) > ON_RING) outside++;
    }
    if (m.capStart && selfIntersects(m.capStart)) crossed++;
    if (m.capEnd && selfIntersects(m.capEnd)) crossed++;

    /* ==> A FOLD MUST PINCH, NEVER MARK. <== The first version marked both
     * stations of a folding segment unusable and let the slice be skipped;
     * that is a black wedge across the cone on glass, because a slice spans
     * many stations. `ok:false` now means only "no ray hit here", which on a
     * cone the track can see at all never happens. If this starts failing, a
     * fold has gone back to being an absence. */
    if (m.ribs.some((r) => !r.ok)) unusable++;
  }

  const total = swept.length + measured.length + blind.length;
  ok(total >= 30, `the corpus is still there — ${total} advisories with a cone and a track`);

  /* THE HEADLINE. Before this existed, `blind` was 12. */
  ok(blind.length === 0,
     `every advisory yields stations to slice — ${swept.length} swept, ${measured.length} measured${blind.length ? `, ${blind.length} blind (${blind.join(', ')})` : ''}`);

  /* ==> AND BOTH PATHS MUST STILL BE EXERCISED. <== The warning this comment
   * used to carry came true: "if a future change makes the sweep accept
   * everything, `measured` goes to zero and every assertion above passes while
   * the path they were written for stops being exercised at all".
   *
   * §7.9's loop cut is that change. The old wall-fold veto turned away a third
   * of Ida's advisories; the sweep now takes all of them, which is the whole
   * point — those refusals were taking §47.5's environment ribbon down with
   * them. `measured` from this corpus is therefore expected to be ZERO now.
   *
   * The measure path is exercised deliberately instead, on a track trimmed to
   * its last 30% so most of the published cone sits behind the first station
   * and `CONE_SWEEP.minAheadFrac` turns the sweep away. Constructed, because
   * the corpus no longer volunteers one. */
  ok(swept.length > 0,
     `the sweep path is exercised (${swept.length} swept, ${measured.length} measured)`);

  {
    let forcedRefusal = 0;
    let forcedMeasured = 0;
    for (const [track, rings] of corpusPairs) {
      const tail = track.slice(Math.floor(track.length * 0.7));
      if (tail.length < 3) continue;
      if (sweepConeDetail(tail, rings)) continue;
      forcedRefusal++;
      const m = measureConeRibs(tail, rings);
      if (m && m.ribs.some((r) => r.ok)) forcedMeasured++;
    }
    ok(forcedRefusal > 0,
       `a refusal can still be constructed — ${forcedRefusal} of the corpus decline on a trimmed track`);
    ok(forcedMeasured === forcedRefusal,
       'and EVERY cone the sweep declines is still measurable — that is the whole '
       + `reason the two gates are separate (${forcedMeasured}/${forcedRefusal})`);
  }

  ok(outside === 0, 'every measured rib end lands ON the outline it was measured from, within a metre');
  ok(unusable === 0,
     'and not one advisory loses a station to a fold — the edge pinches, so nothing is skipped and no wedge is cut out of the cone');
  ok(crossed === 0, 'and nothing either path hands out crosses itself');
}

section('the real GDACS payload');
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
    const track = smoothPath(pts);
    const out = sweepCone(track, [cone]);
    ok(!!out, 'the shipped payload rebuilds');
    if (out) {
      const grow = area(out) / area(cone) - 1;
      ok(Math.abs(grow) < 0.03, `area stays within 3% of published (${(grow * 100).toFixed(2)}%)`);
      ok(!selfIntersects(out), 'and the outline does not cross itself');

      /* ==> THE PAYLOAD IS SYMMETRIC, AND THIS ASSERTION USED TO CLAIM THE
       * OPPOSITE. <== A 43% asymmetry was measured here and argued from; it was
       * a sign error in the ray test, not the data. Pinned the right way round
       * now, because a suite that certifies a false fact about the source is
       * worse than one that says nothing. */
      let worst = 0;
      for (const frac of [0.3, 0.45, 0.6, 0.75]) {
        const i = Math.round(track.length * frac);
        const t = tangentAt(track[i], track);
        const nn = [-t[1], t[0]];
        const pl = ray(track[i], nn, cone);
        const pr = ray(track[i], [-nn[0], -nn[1]], cone);
        ok(Number.isFinite(pl) && Number.isFinite(pr),
           `at ${(frac * 100) | 0}% along, both published widths are measurable`);
        worst = Math.max(worst, Math.abs(pl - pr) / ((pl + pr) / 2));
      }
      ok(worst < 0.05,
         `the payload IS symmetric about its own track (worst ${(worst * 100).toFixed(1)}%)`);
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
