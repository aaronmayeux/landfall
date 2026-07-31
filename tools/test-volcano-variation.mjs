/**
 * test-volcano-variation.mjs — every volcano is its own mountain, and none of
 * them got any wider.
 *
 * ==> THE SANDBOX HAS NO BROWSER, SO THIS FILE IS THE ONLY GROUND TRUTH THIS
 * FEATURE HAS. <== `lib/volcano-variation.js` deliberately has no THREE, no
 * DOM and no pixels in it for exactly that reason. What is asserted here is
 * not "does it look nice" — that is a phone's job — but the four things that
 * would be invisible on glass until they had already done damage:
 *
 *   1. NOTHING GETS WIDER. A footprint sized to hit a target is the mistake
 *      that killed `fill-extrusion` and then `inflate` (SPEC-GLOBES §42.1.4a,
 *      §42.1.4b). Variation may reshape a mountain inside its true footprint
 *      and may never push a single vertex past it.
 *   2. NO SUMMIT IS RAISED. The smooth-max merge's whole guarantee is that a
 *      peak is never inflated by a neighbour. Variation is subtractive so that
 *      guarantee survives, and this proves it rather than asserting it in a
 *      comment.
 *   3. IT IS THE SAME MOUNTAIN EVERY TIME. Seeded from the GVP catalog number,
 *      so a reload never reshuffles the planet.
 *   4. IT IS ACTUALLY DIFFERENT PER VOLCANO. GVP numbers run sequentially
 *      within a region, and a seed that walks a PRNG in lockstep would give a
 *      whole arc one shape — the original problem arriving by another door.
 *
 * Runs against `assets/hazards/volcanoes-holocene.geojson` — the real file.
 *
 *   node tools/test-volcano-variation.mjs
 */

import { readFileSync } from 'node:fs';
import { VOLCANO } from '../config/constants.js';
import { volcanoFamily } from '../lib/volcano-shape.js';
import {
  isEdifice,
  volcanoBaseRadius,
} from '../lib/volcano-dimensions.js';
import { ridgeMember, buildRidge, buildRidges, heightFrac, profileTable } from '../lib/volcano-ridge.js';
import {
  volcanoVariation,
  warpRadius,
  breachHeight,
  smoothstep01,
} from '../lib/volcano-variation.js';

const M3 = VOLCANO.map3d;
const R = M3.ridge;
const V = R.variation;
const SHAPES = VOLCANO.shapes.families;

let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log('  ok   ' + name);
  } else {
    failed++;
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

const catalog = JSON.parse(
  readFileSync(new URL('../assets/hazards/volcanoes-holocene.geojson', import.meta.url), 'utf8')
);
const marks = catalog.features.map((f) => {
  const p = f.properties;
  const c = f.geometry.coordinates;
  return {
    n: p.n,
    name: p.name,
    elev: Number(p.elev),
    lon: c[0],
    lat: c[1],
    submarine: Number(p.elev) < 0,
    family: volcanoFamily(p),
    erupting: false,
    tier: Number(p[VOLCANO.marks.tierField] || 0),
  };
});
const drawable = marks.filter(isEdifice);
const tier = drawable.filter((m) => m.tier >= VOLCANO.marks.tierMin);
const byName = new Map(drawable.map((m) => [m.name, m]));

/* Bearings sampled around a volcano. 360 is far more than the ~33 cells the
 * grid actually has around a mid-flank, so a violation cannot hide between
 * two samples. */
const BEARINGS = 360;

/** The radius, as a fraction of the true one, at which a volcano's profile
 *  runs out on one bearing. Bisection on `warpRadius`, which is monotonic in
 *  q for every family. */
function outlineAt(v, cosT, sinT) {
  let lo = 0;
  let hi = 1.5;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (warpRadius(v, mid, cosT, sinT) < 1) lo = mid;
    else hi = mid;
  }
  return lo;
}

console.log('\n== 1. NOTHING GETS WIDER, AND THIS IS THE ONE THAT MATTERS ==');

/* ==> THE WHOLE CATALOG, NOT A SAMPLE. <== 1,024 edifices x 360 bearings is
 * cheap and the alternative is discovering on a phone that one family in one
 * corner of the seed space pushes past its footprint. */
let worstOverrun = 0;
let worstWho = '';
let meanSum = 0;
for (const m of drawable) {
  const spec = SHAPES[m.family] || SHAPES.cone;
  const v = volcanoVariation(Number(m.n) || 1, spec);
  let mean = 0;
  for (let i = 0; i < BEARINGS; i++) {
    const th = (i / BEARINGS) * Math.PI * 2;
    const r = outlineAt(v, Math.cos(th), Math.sin(th));
    mean += r;
    if (r > worstOverrun) {
      worstOverrun = r;
      worstWho = m.name + ' (' + m.family + ')';
    }
  }
  meanSum += mean / BEARINGS;
}
check(
  'no volcano in the catalog reaches past its own true radius on any bearing',
  worstOverrun <= 1 + 1e-9,
  worstWho + ' reaches ' + (worstOverrun * 100).toFixed(3) + '%'
);
check(
  'and the widest bearing does reach it, so the footprint is not merely shrunk',
  worstOverrun > 0.999,
  (worstOverrun * 100).toFixed(3) + '%'
);
console.log(
  '  ..   a varied mountain averages ' +
    ((meanSum / drawable.length) * 100).toFixed(0) +
    '% of its true radius across all bearings — the stated cost of pinning the maximum'
);

/* The same thing again on real geometry rather than on the maths, because the
 * grid, the trimming and the alpha ramp all sit between the two. */
let worstVertex = 0;
for (const m of tier) {
  const mem = ridgeMember(m);
  const one = buildRidge([mem]);
  for (let vtx = 0; vtx * 4 + 3 < one.colors.length; vtx++) {
    if (one.colors[vtx * 4 + 3] <= 0) continue;
    const d = Math.hypot(one.positions[vtx * 3], one.positions[vtx * 3 + 1]);
    worstVertex = Math.max(worstVertex, d / mem.radius);
  }
}
check(
  'and no VISIBLE vertex of any drawn mountain sits outside its footprint',
  worstVertex <= 1 + 1e-6,
  (worstVertex * 100).toFixed(2) + '% of the true radius'
);

/* ==> THE GUARD ON THE WHOLE CLASS OF MISTAKE, NOT ON THIS IMPLEMENTATION.
 * <== `tools/test-volcano-map3d.mjs` already fails if a scale factor appears
 * on `map3d` under any name. This is the same test aimed at the new file's own
 * constants, because "variation" is exactly the kind of word a future size
 * fudge would hide behind. */
const sizeKeys = Object.keys(V).filter((k) =>
  /inflate|inflation|minPx|pixelFloor|widthScale|footprintScale|grow|expand/i.test(k)
);
check(
  'nothing in the variation constants scales a footprint up',
  sizeKeys.length === 0,
  'found ' + sizeKeys.join(', ')
);

console.log('\n== 2. NO SUMMIT IS RAISED, SO THE MERGE STILL MEANS WHAT IT SAYS ==');

/* ==> THE CLAIM IS ABOUT THE PEAK, NOT ABOUT EVERY POINT, AND THE DIFFERENCE
 * IS THE SUMMIT OFFSET. <== Sliding a summit sideways necessarily lifts the
 * ground on the side it moves toward — that is what an off-centre summit IS.
 * What must hold is that the mountain's own CEILING never rises, because that
 * is the quantity the smooth-max merge reasons about: a peak that cannot grow
 * cannot be inflated by a neighbour either. Two separate things are asserted:
 * the varied profile never exceeds the unvaried profile's maximum, and
 * `breachHeight` on its own is purely subtractive. */
let worstCeiling = 0;
let worstBreachLift = 0;
for (const fam of Object.keys(SHAPES)) {
  const spec = SHAPES[fam];
  const table = profileTable(spec);
  const floorFrac = table.h[0];
  /* The exact ceiling, not a sampled one: `heightFrac` interpolates linearly
   * between table entries, so it can never return more than the table's own
   * largest height. Sampling it instead misses a caldera's rim by a hair and
   * turns this check into a test of the sample step. */
  let ceiling = 0;
  for (let i = 0; i < table.h.length; i++) ceiling = Math.max(ceiling, table.h[i]);
  for (const seed of [210010, 300240, 357070, 1101, 999983]) {
    const v = volcanoVariation(seed, spec);
    for (let i = 0; i < 64; i++) {
      const th = (i / 64) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      for (let q = 0; q <= 1.0001; q += 0.01) {
        const hf = heightFrac(table, warpRadius(v, q, c, s));
        const varied = breachHeight(v, hf, floorFrac, c, s);
        worstCeiling = Math.max(worstCeiling, varied - ceiling);
        worstBreachLift = Math.max(worstBreachLift, breachHeight(v, hf, floorFrac, c, s) - hf);
      }
    }
  }
}
check(
  'no varied mountain ever stands taller than the profile it came from',
  worstCeiling <= 1e-9,
  'over by ' + worstCeiling.toExponential(2)
);
check(
  'and the crater breach is purely subtractive on every family',
  worstBreachLift <= 1e-9,
  'lifted by ' + worstBreachLift.toExponential(2)
);

/* And the summit is still the summit. Grid discretisation means the peak node
 * is not exactly on the axis, which was already true before variation. */
let lowestPeak = Infinity;
let lowestWho = '';
for (const m of tier) {
  const mem = ridgeMember(m);
  const one = buildRidge([mem]);
  let top = -Infinity;
  for (let i = 2; i < one.positions.length; i += 3) top = Math.max(top, one.positions[i]);
  const frac = (top - mem.baseZ) / mem.height;
  if (frac < lowestPeak) {
    lowestPeak = frac;
    lowestWho = m.name;
  }
}
check(
  'every drawn summit still reaches its modelled height',
  lowestPeak > 0.9 && lowestPeak <= 1 + 1e-9,
  lowestWho + ' at ' + (lowestPeak * 100).toFixed(1) + '%'
);

console.log('\n== 3. THE SAME VOLCANO IS THE SAME MOUNTAIN EVERY TIME ==');

const fuji = byName.get('Fujisan');
if (fuji) {
  const a = buildRidge([ridgeMember(fuji)]);
  const b = buildRidge([ridgeMember(fuji)]);
  let identical = a.positions.length === b.positions.length;
  for (let i = 0; identical && i < a.positions.length; i++) {
    if (a.positions[i] !== b.positions[i]) identical = false;
  }
  check('building the same volcano twice gives byte-identical geometry', identical);
}
check(
  'the same seed and family always give the same coefficients',
  JSON.stringify(volcanoVariation(300240, SHAPES.cone)) ===
    JSON.stringify(volcanoVariation(300240, SHAPES.cone))
);

/* ==> NOTHING HERE MAY READ A CLOCK OR A RANDOM SOURCE. <== A mountain that
 * reshapes on reload is worse than one that looks like its neighbour, and this
 * is the only way to catch it without a browser. */
const src = readFileSync(new URL('../lib/volcano-variation.js', import.meta.url), 'utf8')
  /* Comments stripped first — this file NAMES `Math.random` in the comment
   * explaining why it does not call it, and a check that fails on its own
   * documentation teaches the next session to delete the documentation. */
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(
  'the variation file calls neither Math.random nor Date',
  !/Math\s*\.\s*random|Date\s*\.\s*now|new\s+Date/.test(src)
);

console.log('\n== 4. AND IT REALLY IS DIFFERENT PER VOLCANO ==');

/* ==> SEQUENTIAL SEEDS ARE THE FAILURE MODE, NOT RANDOM ONES. <== Kamchatka
 * runs 300240, 300250, 300260 and a raw sequential seed walks a xorshift's
 * state in lockstep, which would hand a whole arc one shape. The hash in
 * `rng()` exists for this and this is what proves it. */
function outline(seed, spec) {
  const v = volcanoVariation(seed, spec);
  const out = [];
  for (let i = 0; i < 64; i++) {
    const th = (i / 64) * Math.PI * 2;
    out.push(outlineAt(v, Math.cos(th), Math.sin(th)));
  }
  return out;
}
function distance(p, q) {
  let worst = 0;
  for (let i = 0; i < p.length; i++) worst = Math.max(worst, Math.abs(p[i] - q[i]));
  return worst;
}

const runs = [300240, 300250, 300260, 300270, 300280, 300290];
let closestRun = Infinity;
for (let i = 0; i < runs.length; i++) {
  for (let j = i + 1; j < runs.length; j++) {
    closestRun = Math.min(closestRun, distance(outline(runs[i], SHAPES.cone), outline(runs[j], SHAPES.cone)));
  }
}
check(
  'a run of consecutive catalog numbers gives six visibly different mountains',
  closestRun > 0.05,
  'closest pair differs by ' + (closestRun * 100).toFixed(1) + '% of a base radius'
);

/* And across the whole drawn set, no two cones are near-copies of each other. */
const cones = tier.filter((m) => m.family === 'cone').slice(0, 40);
const shapes = cones.map((m) => ({ name: m.name, o: outline(Number(m.n) || 1, SHAPES.cone) }));
let closestPair = Infinity;
let closestWho = '';
for (let i = 0; i < shapes.length; i++) {
  for (let j = i + 1; j < shapes.length; j++) {
    const d = distance(shapes[i].o, shapes[j].o);
    if (d < closestPair) {
      closestPair = d;
      closestWho = shapes[i].name + ' / ' + shapes[j].name;
    }
  }
}
check(
  'no two drawn stratovolcanoes are near-copies of each other',
  closestPair > 0.04,
  closestWho + ' differ by only ' + (closestPair * 100).toFixed(1) + '%'
);

console.log('\n== the crater: reshaped, never filled in and never punched through ==');

/* ==> A CRATER IS ELEVEN GRID CELLS ACROSS AND THAT IS WHY THE FLANK WARP
 * STOPS AT THE RIM. <== Rendered from the real vertex colours at `amount`
 * 0.30 with the warp running all the way in, the bowl was gone and a caldera
 * read as a lumpy hill. The gate is `spec.topR`, which already IS the rim
 * radius: 0.04 on a cone, where it changes nothing, and 0.55 on a caldera. */
const cSpec = SHAPES.caldera;
const cTable = profileTable(cSpec);
const cFloor = cTable.h[0];
check(
  'the caldera profile really does have a floor below its rim',
  cFloor < 0.9 && cFloor > 0,
  'floor ' + cFloor.toFixed(3)
);

let insideMoved = 0;
for (const seed of [241080, 273083, 262000, 285070]) {
  const v = volcanoVariation(seed, cSpec);
  for (let i = 0; i < 32; i++) {
    const th = (i / 32) * Math.PI * 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    for (let q = 0; q < cSpec.topR; q += 0.02) {
      /* The outline warp must be inert here. The summit offset is not — it
       * slides the whole bowl sideways on purpose — so it is subtracted back
       * out before comparing. Bearings where the offset carries the sample
       * past the axis are skipped: `warpRadius` clamps a negative radius to
       * zero, which is deliberate and is not the outline warp firing. */
      const shift = v.offset * (1 - q) * (c * v.offC + s * v.offS);
      if (q - shift <= 0) continue;
      insideMoved = Math.max(insideMoved, Math.abs(warpRadius(v, q, c, s) + shift - q));
    }
  }
}
check(
  'the outline warp is inert inside a crater rim',
  insideMoved < 1e-9,
  'moved by ' + insideMoved.toExponential(2)
);

let belowFloor = 0;
let rimCut = 0;
for (const seed of [241080, 273083, 262000, 285070, 300240]) {
  const v = volcanoVariation(seed, cSpec);
  for (let i = 0; i < 64; i++) {
    const th = (i / 64) * Math.PI * 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    for (let q = 0; q <= 1.0001; q += 0.01) {
      const hf = heightFrac(cTable, warpRadius(v, q, c, s));
      const out = breachHeight(v, hf, cFloor, c, s);
      if (hf >= cFloor) belowFloor = Math.max(belowFloor, cFloor - out);
      rimCut = Math.max(rimCut, hf - out);
    }
  }
}
check(
  'the breach never cuts a rim below the crater floor it stands on',
  belowFloor <= 1e-9,
  'cut ' + belowFloor.toExponential(2) + ' below the floor'
);
check(
  'and it does cut a real notch, rather than being a no-op',
  rimCut > 0.02,
  'deepest cut ' + rimCut.toFixed(3) + ' of the full height'
);

/* Four families out of five have no crater and must pay nothing for one. */
let touched = '';
for (const fam of ['cone', 'dome', 'shield', 'fissure']) {
  const v = volcanoVariation(300240, SHAPES[fam]);
  const t = profileTable(SHAPES[fam]);
  for (let i = 0; i < 16 && !touched; i++) {
    const th = (i / 16) * Math.PI * 2;
    for (let q = 0; q <= 1.0001; q += 0.02) {
      const hf = heightFrac(t, q);
      if (breachHeight(v, hf, t.h[0], Math.cos(th), Math.sin(th)) !== hf) touched = fam;
    }
  }
}
check('the breach is identity on every family without a crater', touched === '', touched);

console.log('\n== it costs no geometry, and the maths is finite everywhere ==');

/* ==> THE DRAWN SET IS CAPPED AT `map3d.maxDrawn`, AND MEASURING THE WHOLE
 * CATALOG INSTEAD WOULD BE A BUDGET NOBODY PAYS. <== Same denominator as
 * `tools/test-volcano-ridge.mjs`, so the two numbers are comparable. */
const ridges = buildRidges(drawable.slice(0, M3.maxDrawn));
let nodes = 0;
let tris = 0;
for (const r of ridges) {
  nodes += r.positions.length / 3;
  tris += r.indices.length / 3;
}
console.log(
  '  ..   ' + Math.min(drawable.length, M3.maxDrawn) + ' volcanoes in ' + ridges.length +
    ' ridges — ' + nodes.toLocaleString() + ' nodes, ' + tris.toLocaleString() + ' triangles'
);

/* ==> A NODE COUNT IS FIXED BY THE TRUE RADII AND VARIATION MAY NOT MOVE IT.
 * <== The grid is sized from a cluster's true bounds and its smallest true
 * member radius, none of which variation touches. If a future change lets the
 * grid respond to the varied shape, the cost measured for this feature stops
 * being the cost it has. */
check(
  'triangles never exceed two per grid cell, so nothing is being subdivided',
  tris <= nodes * 2,
  tris + ' triangles for ' + nodes + ' nodes'
);
check(
  'the drawn layer stays inside the same triangle budget as before variation',
  tris < 600000,
  tris.toLocaleString() + ' triangles'
);

/* The NaN sweep runs over the WHOLE catalog rather than the drawn cap, because
 * a non-finite value would come from one volcano's seed or geometry and the
 * cap is an arbitrary slice of the list. */
let nan = 0;
for (const r of buildRidges(drawable)) {
  for (let i = 0; i < r.positions.length; i++) if (!Number.isFinite(r.positions[i])) nan++;
  for (let i = 0; i < r.colors.length; i++) if (!Number.isFinite(r.colors[i])) nan++;
}
check('nothing in the whole catalog produces a NaN', nan === 0, nan + ' non-finite values');

console.log('\n== and it is still big enough to read where the mountains arrive ==');

/* ==> THE SHRINK HAS TO BE CHECKED AGAINST THE HANDOFF, NOT ASSUMED HARMLESS.
 * <== `tools/test-volcano-map3d.mjs` asserts a median volcano is at least
 * 30 px across at `map3d.handoff[0]`, but it measures the CONSTANT — the true
 * radius. What is actually drawn is now narrower than that, so the same bar
 * has to be met by the geometry. */
const EARTH_M = 40075016.686;
const drawnWidths = tier
  .map((m) => {
    const spec = SHAPES[m.family] || SHAPES.cone;
    const v = volcanoVariation(Number(m.n) || 1, spec);
    let mean = 0;
    for (let i = 0; i < 64; i++) {
      const th = (i / 64) * Math.PI * 2;
      mean += outlineAt(v, Math.cos(th), Math.sin(th));
    }
    const mpp = (EARTH_M * Math.cos((m.lat * Math.PI) / 180)) / (512 * Math.pow(2, M3.handoff[0]));
    return (volcanoBaseRadius(m) * (mean / 64) * 2) / mpp;
  })
  .sort((a, b) => a - b);
const medianDrawn = drawnWidths[Math.floor(drawnWidths.length / 2)];
console.log('  ..   a median DRAWN volcano is ' + medianDrawn.toFixed(0) + ' px across at z' + M3.handoff[0]);
check(
  'the median drawn mountain still clears the 30 px the handoff was chosen for',
  medianDrawn >= 30,
  medianDrawn.toFixed(0) + ' px'
);

console.log('\n== the dial itself ==');
check('the master amount is on the tuning range it was reasoned over', V.amount > 0 && V.amount <= 0.45, String(V.amount));
check('the harmonic ladder stops at 7, which is what the grid can hold', Math.max(...V.harmonics.map(([k]) => k)) <= 7);
check('and it carries no k=1, which would be paid for in footprint', !V.harmonics.some(([k]) => k === 1));
check('smoothstep01 is a real ramp', smoothstep01(-1) === 0 && smoothstep01(2) === 1 && Math.abs(smoothstep01(0.5) - 0.5) < 1e-12);

console.log('');
if (failed) {
  console.log(failed + ' check(s) failed');
  process.exit(1);
}
console.log('all checks passed');
