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

/** Which side each label landed on, hidden ones as null. */
const sides = (out) => out.map((o) => (o.hidden ? null : (o.side > 0 ? 'A' : 'B')));

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

/**
 * Rebuild the strip of text a label occupies on screen, FROM THE VALUES
 * MapLibre IS ACTUALLY HANDED — the rotation, the anchor and the offset.
 * Deriving it from the module's internals instead would let a bug in the
 * hand-off pass unnoticed, which is the exact class of failure this file has
 * already produced three times.
 *
 * A `right` anchor means the text runs the other way from its rotation, so
 * the direction out from the dot is rotation + 180.
 */
function strip(pt, o) {
  const dir = ((o.anchor === 'right' ? o.rotDeg + 180 : o.rotDeg) * Math.PI) / 180;
  const ux = Math.cos(dir);
  const uy = Math.sin(dir);
  const len = TEXT.length * LABEL_PLACEMENT.charWidthPx;
  const start = Math.abs(o.offPx);
  const mid = start + len / 2;
  return {
    cx: pt.x + ux * mid,
    cy: pt.y + uy * mid,
    ux,
    uy,
    hl: len / 2,
    ht: LABEL_PLACEMENT.lineHeightPx / 2,
    /* Where the text begins — used to check it clears the dot. */
    nearPx: start,
  };
}

const extent = (b, nx, ny) =>
  b.hl * Math.abs(b.ux * nx + b.uy * ny) + b.ht * Math.abs(-b.uy * nx + b.ux * ny);

/** Separating-axis test, written independently of the module's own copy. */
function hit(a, b) {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const axes = [[a.ux, a.uy], [-a.uy, a.ux], [b.ux, b.uy], [-b.uy, b.ux]];
  for (const [nx, ny] of axes) {
    if (Math.abs(dx * nx + dy * ny) > extent(a, nx, ny) + extent(b, nx, ny)) return false;
  }
  return true;
}

/** Does any visible label overlap any other? The whole point of the module. */
function anyOverlap(pts, out) {
  const strips = out.map((o, i) => (o.hidden ? null : strip(pts[i], o))).filter(Boolean);
  for (let i = 0; i < strips.length; i++) {
    for (let j = i + 1; j < strips.length; j++) if (hit(strips[i], strips[j])) return true;
  }
  return false;
}

/** Does a label's INK reach within dotClearPx of a dot? Written against the
 *  text's real extents, not the padded collision box — counting collision
 *  padding as ink measures a clearance the label actually has. */
function dotHit(st, px, py) {
  const dx = px - st.cx;
  const dy = py - st.cy;
  const along = dx * st.ux + dy * st.uy;
  const across = -dx * st.uy + dy * st.ux;
  const nx = Math.max(-st.hl, Math.min(st.hl, along));
  const ny = Math.max(-st.ht, Math.min(st.ht, across));
  return (along - nx) ** 2 + (across - ny) ** 2 < LABEL_PLACEMENT.dotClearPx ** 2;
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

/** A tightly wound S-curve — two and a half cycles, 100px amplitude, dots
 *  only 25px apart. This is the shape that genuinely needs two groups: the
 *  clear direction is one way through the first half of the track and the
 *  other way through the second, so no single side holds all nine labels.
 *
 *  It is this extreme because the obvious candidates DO NOT split any more.
 *  Once the text tilts onto a shared shallow angle, a hairpin, a loop, a
 *  zigzag and a gentle S all fit comfortably on one side — checked across a
 *  sweep of amplitudes, spacings and cycle counts, not assumed. A test that
 *  never reaches the code it claims to cover is worse than none. */
const tightS = (n = 9) =>
  Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * Math.PI * 5;
    return { x: 700 - i * 25, y: 400 + Math.sin(t) * 100 };
  });

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

const h = tightS();
const hOut = place(h);
const hRuns = runLengths(hOut);

/* THE POINT OF THIS SECTION. If the hairpin ever stops splitting, every
 * assertion below becomes vacuously true and the multi-group path goes
 * uncovered without anything failing. Assert the split itself first. */
ok(hRuns.length > 1, `the tight S genuinely splits — groups ${hRuns.join('/')}`);
ok(switches(hOut) === 1, `tight S: exactly one side change, not ${switches(hOut)}`);
ok(!anyOverlap(h, hOut), 'tight S: no overlaps');
ok(Math.min(...hRuns) >= 2, `tight S groups are ${hRuns.join('/')} — no group of one`);
ok(Math.max(...hRuns) - Math.min(...hRuns) <= 1,
  `tight S groups ${hRuns.join('/')} are as even as an odd count allows`);
ok(kept(hOut) === 9, `tight S: kept all ${kept(hOut)}/9 while splitting`);

/* The cap is the load-bearing rule: three groups maximum, because a fourth
 * group on a nine-point track is two labels long and that IS alternating. */
for (const pts of [westward(50), westward(35), westward(50, 9), recurve(), tightS()]) {
  const out = place(pts);
  ok(switches(out) <= LABEL_PLACEMENT.maxRuns - 1,
    `never more than ${LABEL_PLACEMENT.maxRuns - 1} side changes`);
}

/* --- the contract points-forecast.js relies on ----------------------------- */
section('contract');

ok(place([]).length === 0, 'no points in, no placements out');

const one = place([{ x: 400, y: 400 }]);
ok(one.length === 1 && !one[0].hidden, 'a lone point still gets its label');
ok(Math.abs(Math.abs(one[0].offPx) - LABEL_PLACEMENT.spokeStartPx) < 0.001,
  'the text starts exactly spokeStartPx from the dot');

/* THE THREE RULES ABOUT THE ANGLE, which are the whole of Aaron's spec:
 * one shared angle per storm, as shallow as the labels allow, never past 45. */
section('one shared angle, as shallow as it can be, never past 45');

const shapes = [
  ['westward', westward(50)],
  ['westward tight', westward(30, 9)],
  ['due north', Array.from({ length: 8 }, (_, i) => ({ x: 400, y: 700 - i * 55 }))],
  ['diagonal', diagonal(60)],
  ['recurve', recurve()],
  ['tight S', tightS()],
];

for (const [name, pts] of shapes) {
  const out = place(pts);
  const angles = new Set(out.map((o) => o.rotDeg));
  ok(angles.size === 1,
    `${name}: every label shares one angle (${[...angles].join(', ')})`);
  ok(Math.abs(out[0].rotDeg) <= LABEL_PLACEMENT.maxTextTiltDeg + 0.001,
    `${name}: ${out[0].rotDeg}° is inside the ${LABEL_PLACEMENT.maxTextTiltDeg}° ceiling`);
  ok(out[0].rotDeg % LABEL_PLACEMENT.tiltStepDeg === 0,
    `${name}: the angle lands on a search step, not somewhere between two`);
}

/* SHALLOWEST THAT FITS. A diagonal track staggers its labels vertically all
 * by itself, so it must resolve to dead horizontal — if it tilts, the search
 * is reaching past an angle that already worked. */
const diagOut = place(diagonal(60));
ok(diagOut[0].rotDeg === 0, `a diagonal track needs no tilt at all (got ${diagOut[0].rotDeg}°)`);
ok(kept(diagOut) === 8, 'and it keeps every label at 0°');

/* A due-west track cannot use vertical stagger, so it MUST tilt — and the
 * tilt it picks should be the smallest one that works, not the ceiling. */
const westOut = place(westward(50));
ok(westOut[0].rotDeg !== 0, 'a due-west track does have to tilt');
ok(Math.abs(westOut[0].rotDeg) < LABEL_PLACEMENT.maxTextTiltDeg,
  `and it stops short of the ceiling (${westOut[0].rotDeg}°), so the sweep is not just running out`);
ok(kept(westOut) === 8, 'keeping all eight labels');

/* The direction a label runs still varies — that is the side — but it is
 * expressed as an anchor flip, never as a second rotation. Otherwise "one
 * shared angle" would be true of the data and false of the picture. */
const mixed = [tightS(), recurve(), westward(50)].flatMap((pts) => {
  const out = place(pts);
  return out.map((o) => ({ o, rot: out[0].rotDeg }));
});
ok(mixed.every(({ o, rot }) => o.rotDeg === rot),
  'a label on the far side keeps the same rotation and flips its anchor instead');
const rightAnchored = mixed.filter(({ o }) => !o.hidden && o.anchor === 'right');
ok(rightAnchored.every(({ o }) => o.offPx < 0),
  `every right-anchored label is pushed away from its dot (${rightAnchored.length} checked)`);

/* The text must not sit on a dot — its own or anybody else's. This is the
 * Noul bug from glass in its two forms: the spoke length used to be measured
 * to the label's CENTRE, and a shallow angle can lay the text straight along
 * the track and through the next point. */
section('the text clears every dot, not just its own');

for (const [name, pts] of shapes) {
  const out = place(pts);
  const vis = out.map((o, i) => (o.hidden ? null : { s: strip(pts[i], o), i })).filter(Boolean);
  ok(vis.every(({ s: st }) => st.nearPx >= LABEL_PLACEMENT.spokeStartPx - 0.001),
    `${name}: the text begins clear of its own dot`);
  const crosses = vis.filter(({ s: st, i }) =>
    pts.some((p, j) => j !== i && dotHit(st, p.x, p.y)));
  ok(crosses.length === 0, `${name}: no label runs across another dot`);
}

const nine = place(westward(60, 9));
ok(nine.length === 9, 'one entry per input point, same order');
ok(nine.every((o) => Number.isFinite(o.rotDeg) && Number.isFinite(o.offPx)),
  'every rotation and offset is finite — a NaN takes the whole layer down');
ok(nine.every((o) => o.anchor === 'left' || o.anchor === 'right'),
  'anchor is always a value MapLibre accepts');
ok(nine.every((o) => o.side === 1 || o.side === -1), 'side is always +1 or -1');

/* Two points at the identical position have no track between them, so the
 * tangent is undefined. It must degrade to a placement, not to NaN. */
const same = place([{ x: 400, y: 400 }, { x: 400, y: 400 }, { x: 400, y: 400 }]);
ok(same.every((o) => Number.isFinite(o.rotDeg) && Number.isFinite(o.offPx)),
  'identical coordinates degrade to finite values');

/* An empty label still has to come back with usable numbers: points-forecast
 * hides it separately, and a NaN here would reach MapLibre first. */
const blank = placeSpokes([{ x: 400, y: 400, text: '' }, { x: 340, y: 400, text: '' }]);
ok(blank.every((o) => Number.isFinite(o.rotDeg) && Number.isFinite(o.offPx)),
  'an empty label string is still placed finitely');

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
