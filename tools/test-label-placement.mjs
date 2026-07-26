#!/usr/bin/env node
/**
 * test-label-placement.mjs — forecast time label spokes
 * (map/layers/label-placement.js).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-label-placement.mjs`, same as
 * every other suite here (§12 — this project has no toolchain by design).
 *
 * WHY THIS SUITE EXISTS AT ALL. This bug outlived several sessions and was
 * repeatedly "fixed" against a single synthetic track that could not
 * reproduce it. The fixtures below are therefore built around the ONE
 * variable that turned out to decide everything — the track's angle on
 * screen — because that is what the old tests held constant.
 *
 * A DIAGONAL track gives the spoke both an across and an up component, so
 * consecutive labels staircase and clear each other. A DUE WEST track puts
 * every label at the same height in a row, where 80px boxes at 50px spacing
 * cannot all fit on one side no matter which side is chosen. Aaron's
 * 2026-07-26 photo is a diagonal storm, which is precisely why it looked
 * correct there while a westward storm did not.
 *
 * WHAT THIS CANNOT PROVE: that a screen full of labels READS well. Overlap,
 * grouping and cost are checked here; legibility is a question for a phone.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { placeSpokes } = await import('../map/layers/label-placement.js');
const { LABEL_PLACEMENT } = await import('../config/constants.js');

/* A real NHC label. Length drives the collision box, so a shorter stand-in
 * would quietly make every fixture easier than reality. */
const TEXT = '12:00 PM Thu';

const place = (pts) => placeSpokes(pts.map((p) => ({ ...p, text: TEXT })));

/** Which side each label landed on, hidden ones as null. Side is read off the
 *  returned vector rather than the `side` field so the test checks the thing
 *  MapLibre is actually handed. */
const sides = (out) => out.map((o) => (o.hidden ? null : (o.oy < 0 ? 'U' : 'D')));

/** Side changes among the labels that are VISIBLE — a hidden label cannot be
 *  a side change, because nobody sees it. */
function switches(out) {
  const v = sides(out).filter(Boolean);
  let n = 0;
  for (let i = 1; i < v.length; i++) if (v[i] !== v[i - 1]) n++;
  return n;
}

const kept = (out) => out.filter((o) => !o.hidden).length;

/** Groups of consecutive same-side visible labels, as run lengths. */
function runLengths(out) {
  const v = sides(out).filter(Boolean);
  const runs = [];
  for (const s of v) {
    if (runs.length && runs[runs.length - 1].s === s) runs[runs.length - 1].n++;
    else runs.push({ s, n: 1 });
  }
  return runs.map((r) => r.n);
}

/** Does any visible label overlap any other? The whole point of the module. */
function anyOverlap(pts, out) {
  const w = TEXT.length * LABEL_PLACEMENT.charWidthPx + LABEL_PLACEMENT.padPx * 2;
  const h = LABEL_PLACEMENT.lineHeightPx + LABEL_PLACEMENT.padPx * 2;
  const boxes = out
    .map((o, i) => (o.hidden ? null : { cx: pts[i].x + o.ox, cy: pts[i].y + o.oy }))
    .filter(Boolean);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (Math.abs(boxes[i].cx - boxes[j].cx) * 2 < w * 2 &&
          Math.abs(boxes[i].cy - boxes[j].cy) * 2 < h * 2) return true;
    }
  }
  return false;
}

/* --- fixtures -------------------------------------------------------------- */

/** Eight forecast points marching due west — the failing case. */
const westward = (gap, n = 8) =>
  Array.from({ length: n }, (_, i) => ({ x: 800 - i * gap, y: 400 }));

/** Eight points on a 45° diagonal — the shape in Aaron's photo. */
const diagonal = (gap, n = 8) =>
  Array.from({ length: n }, (_, i) => ({ x: 800 - i * gap * 0.71, y: 400 - i * gap * 0.71 }));

/** A recurving track: west, then turning north. Real storms do this. */
const recurve = (n = 9) =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return { x: 800 - 500 * t, y: 400 - 260 * t * t };
  });

/** A hairpin — the storm doubles back on itself. This is the shape that
 *  genuinely needs two groups: the inside of the turn is jammed for the whole
 *  second half of the track, so no single side holds all eight labels. It is
 *  in this suite because the more obvious S-curve does NOT force a split
 *  (checked — it thins on one side instead), and a test that never reaches
 *  the code it claims to cover is worse than no test. */
const hairpin = () => ([
  { x: 700, y: 500 }, { x: 640, y: 480 }, { x: 580, y: 450 }, { x: 540, y: 400 },
  { x: 545, y: 345 }, { x: 590, y: 305 }, { x: 650, y: 285 }, { x: 715, y: 280 },
]);

/* --- the goal: one side, whenever the geometry allows it ------------------- */
section('one side whenever it fits');

for (const gap of [50, 70, 90, 120]) {
  const pts = diagonal(gap);
  const out = place(pts);
  ok(switches(out) === 0, `diagonal at ${gap}px: every label on one side`);
  ok(kept(out) === 8, `diagonal at ${gap}px: nothing thinned (${kept(out)}/8)`);
  ok(!anyOverlap(pts, out), `diagonal at ${gap}px: no two labels overlap`);
}

for (const gap of [90, 120]) {
  const out = place(westward(gap));
  ok(switches(out) === 0, `westward at ${gap}px: one side, dots far enough apart`);
  ok(kept(out) === 8, `westward at ${gap}px: nothing thinned`);
}

const north = place(Array.from({ length: 8 }, (_, i) => ({ x: 400, y: 700 - i * 55 })));
ok(switches(north) === 0 && kept(north) === 8, 'due north track: one side, all eight');

/* --- the failing case: thin, never alternate ------------------------------- */
section('a westward track thins rather than alternating');

for (const gap of [35, 50, 70]) {
  const pts = westward(gap);
  const out = place(pts);
  ok(switches(out) === 0, `westward at ${gap}px: still one side (was 5-7 changes)`);
  ok(!anyOverlap(pts, out), `westward at ${gap}px: survivors do not overlap`);
  ok(kept(out) >= 3, `westward at ${gap}px: kept ${kept(out)}, not gutted`);
}

/* The old behaviour, recorded so a regression is unmistakable: placing one
 * label at a time and flipping each collision produced up-down-up-down for
 * all eight. Any suite that lets that back in should fail loudly here. */
const w50 = place(westward(50));
ok(switches(w50) < 7, `the old alternating result (7 changes) cannot come back — got ${switches(w50)}`);

/* --- the first and last label are the two worth keeping -------------------- */
section('thinning protects the ends');

for (const gap of [35, 50, 70]) {
  const out = place(westward(gap));
  ok(!out[0].hidden, `westward at ${gap}px: the nearest forecast hour survives`);
  ok(!out[out.length - 1].hidden, `westward at ${gap}px: the far end of the cone survives`);
}

/* Thinning spreads along the track rather than clearing one stretch: no gap
 * of three consecutive hidden labels while others sit crowded. */
const spread = place(westward(50));
let worstGap = 0;
let runGap = 0;
for (const o of spread) { runGap = o.hidden ? runGap + 1 : 0; worstGap = Math.max(worstGap, runGap); }
ok(worstGap <= 2, `hidden labels spread out — longest blank stretch is ${worstGap}`);

/* --- no rogues: Aaron's explicit rule -------------------------------------- */
section('no single label stranded across the track');

const rec = recurve();
const recOut = place(rec);
ok(switches(recOut) === 0, 'recurving track: one side, no rogue label on the far side');
ok(kept(recOut) >= 8, `recurving track: kept ${kept(recOut)}/9 to get there`);
ok(!anyOverlap(rec, recOut), 'recurving track: no overlaps');

/* This is the arrangement the first cut of the rewrite produced and Aaron
 * rejected by name: eight on one side and one stranded. */
ok(
  !runLengths(recOut).some((n, i, a) => n === 1 && a.length > 1 && Math.max(...a) >= 5),
  'no 1-versus-many split survives the ranking',
);

/* --- when a split IS needed, it is contiguous and even --------------------- */
section('a genuinely jammed track splits into contiguous, balanced groups');

const h = hairpin();
const hOut = place(h);
const hRuns = runLengths(hOut);

/* THE POINT OF THIS SECTION. If the hairpin ever stops splitting, every
 * assertion below becomes vacuously true and the multi-group path goes
 * uncovered without anything failing. Assert the split itself first. */
ok(hRuns.length > 1, `the hairpin genuinely splits — groups ${hRuns.join('/')}`);
ok(switches(hOut) === 1, `hairpin: exactly one side change, not ${switches(hOut)}`);
ok(!anyOverlap(h, hOut), 'hairpin: no overlaps');
ok(Math.min(...hRuns) >= 2, `hairpin groups are ${hRuns.join('/')} — no group of one`);
ok(Math.max(...hRuns) - Math.min(...hRuns) <= 1,
  `hairpin groups ${hRuns.join('/')} are as even as an odd count allows`);
ok(kept(hOut) >= 7, `hairpin: kept ${kept(hOut)}/8 while splitting`);

/* The cap is the load-bearing rule: three groups maximum, because a fourth
 * group on a nine-point track is two labels long and that IS alternating. */
for (const pts of [westward(50), westward(35), westward(50, 9), recurve(), hairpin()]) {
  const out = place(pts);
  ok(switches(out) <= LABEL_PLACEMENT.maxRuns - 1,
    `never more than ${LABEL_PLACEMENT.maxRuns - 1} side changes`);
}

/* --- the contract points-forecast.js relies on ----------------------------- */
section('contract');

ok(place([]).length === 0, 'no points in, no placements out');

const one = place([{ x: 400, y: 400 }]);
ok(one.length === 1 && !one[0].hidden, 'a lone point still gets its label');
ok(Math.abs(Math.hypot(one[0].ox, one[0].oy) - LABEL_PLACEMENT.spokePx) < 0.001,
  'the spoke is exactly spokePx long');

const nine = place(westward(60, 9));
ok(nine.length === 9, 'one entry per input point, same order');
ok(nine.every((o) => Number.isFinite(o.ox) && Number.isFinite(o.oy)),
  'every offset is a finite number — a NaN takes the whole layer down');
ok(nine.every((o) => o.side === 1 || o.side === -1), 'side is always +1 or -1');

/* Two points at the identical position have no track between them, so the
 * tangent is undefined. It must degrade to a placement, not to NaN. */
const same = place([{ x: 400, y: 400 }, { x: 400, y: 400 }, { x: 400, y: 400 }]);
ok(same.every((o) => Number.isFinite(o.ox) && Number.isFinite(o.oy)),
  'identical coordinates degrade to finite offsets');

/* An empty label still has to come back with usable numbers: points-forecast
 * hides it separately, and a NaN here would reach MapLibre first. */
const blank = placeSpokes([{ x: 400, y: 400, text: '' }, { x: 340, y: 400, text: '' }]);
ok(blank.every((o) => Number.isFinite(o.ox)), 'an empty label string is still placed finitely');

/* --- cost ------------------------------------------------------------------ */
section('frame budget');

const costPts = westward(60, 9).map((p) => ({ ...p, text: TEXT }));
const t0 = performance.now();
for (let i = 0; i < 500; i++) placeSpokes(costPts);
const ms = (performance.now() - t0) / 500;
ok(ms < 2, `one storm costs ${ms.toFixed(3)} ms — several storms is nowhere near a frame`);

/* --- report ---------------------------------------------------------------- */
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (grouping and overlap are checked; whether it READS well is a question for glass)');
