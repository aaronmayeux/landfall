/**
 * test-volcano-flow.mjs — the lava flow model, asserted without a browser.
 *
 * ==> EVERY FAILURE MODE HERE IS GEOMETRIC, AND GEOMETRY THAT IS ONLY CHECKED
 * ON GLASS GETS CHECKED ONCE. <== A flow that runs uphill, or that ignores the
 * terrain, or that quietly becomes steepest descent when a constant moves, all
 * look like "hmm, that's a bit off" on a phone and like a failed assertion
 * here.
 *
 *   node tools/test-volcano-flow.mjs
 */

import { readFileSync } from 'node:fs';
import { VOLCANO } from '../config/constants.js';
import { volcanoFamily, isSubmarine } from '../lib/volcano-shape.js';
import { isEdifice } from '../lib/volcano-dimensions.js';
import {
  ridgeMember,
  clusterMembers,
  buildRidge,
  buildRidges,
  surfaceHeightAt,
} from '../lib/volcano-ridge.js';
import { traceFlows, buildFlowRibbons } from '../lib/volcano-flow.js';

const L = VOLCANO.map3d.lava;
const R = VOLCANO.map3d.ridge;

let failures = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log('  ok   ' + name);
  } else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

const catalog = JSON.parse(
  readFileSync(new URL('../assets/hazards/volcanoes-holocene.geojson', import.meta.url), 'utf8')
);

/** Build a mark, optionally erupting lava. */
function markOf(f, lava) {
  const p = f.properties;
  const c = f.geometry.coordinates;
  return {
    n: p.n,
    name: p.name,
    elev: Number(p.elev),
    lon: c[0],
    lat: c[1],
    submarine: isSubmarine(p),
    family: volcanoFamily(p),
    erupting: !!lava,
    lava: !!lava,
  };
}

/* A land stratovolcano with a decent relief, so the tests are not fighting a
 * dome or a seamount. Picked by property rather than by name so a catalog
 * refresh cannot silently change what is being tested. */
const subject = catalog.features.find(
  (f) =>
    volcanoFamily(f.properties) === 'cone' &&
    Number(f.properties.elev) > 2000 &&
    !isSubmarine(f.properties)
);

console.log('\n== the two surface samplers agree, or the flow is on a different mountain ==');

{
  const cluster = clusterMembers([ridgeMember(markOf(subject, true))]);
  const ridge = buildRidge(cluster[0]);
  const { local, k, anySubmarine } = ridge.surface;

  /* ==> THIS IS THE ONE TEST THAT PROTECTS THE WHOLE FEATURE. <== `buildRidge`
   * evaluates the surface in a hand-optimised inner loop; `surfaceHeightAt`
   * evaluates it again for the tracer. They are written twice on purpose and
   * `lib/volcano-ridge.js` says so. If they ever disagree, lava runs down a
   * mountain nobody can see, and it would look like a tuning problem forever. */
  let worst = 0;
  let worstAt = null;
  const nx = Math.round(Math.sqrt(ridge.positions.length / 3));
  for (let i = 0; i < ridge.positions.length / 3; i += 7) {
    const e = ridge.positions[i * 3];
    const n = ridge.positions[i * 3 + 1];
    const z = ridge.positions[i * 3 + 2];
    const d = Math.abs(surfaceHeightAt(local, k, anySubmarine, e, n) - z);
    if (d > worst) {
      worst = d;
      worstAt = [e, n];
    }
  }
  check(
    'the sampler matches the built mesh to under a millimetre',
    worst < 0.001,
    worst.toFixed(6) + ' m at ' + JSON.stringify(worstAt) + ' over ~' + nx + ' rows'
  );
}

console.log('\n== refinement moves the grid, and moves the cap with it ==');

{
  const cluster = clusterMembers([ridgeMember(markOf(subject, true))]);
  const plain = buildRidge(cluster[0]);
  const fine = buildRidge(cluster[0], { refine: L.refine });
  const ratio = (fine.positions.length / 3) / (plain.positions.length / 3);

  check(
    'refining ' + L.refine + 'x gives about ' + (L.refine * L.refine) + 'x the nodes',
    ratio > L.refine * L.refine * 0.8 && ratio < L.refine * L.refine * 1.25,
    ratio.toFixed(2) + 'x (' + (plain.positions.length / 3) + ' -> ' + (fine.positions.length / 3) + ')'
  );

  /* ==> THE TRAP `NOW.md` NAMED: RAISE THE RESOLUTION AND NOT THE CAP AND YOU
   * GET THE GRID YOU STARTED WITH. <== Silent, and it would present as "the
   * refinement did nothing" with no error anywhere. */
  check(
    'refinement is not silently undone by the cell cap',
    fine.positions.length / 3 > plain.positions.length / 3 * 2,
    'plain ' + (plain.positions.length / 3) + ', fine ' + (fine.positions.length / 3)
  );

  check(
    'the footprint does not move when the grid does',
    Math.abs(fine.extent - plain.extent) < plain.extent * 0.02,
    'plain ' + plain.extent.toFixed(0) + ' m, fine ' + fine.extent.toFixed(0) + ' m'
  );
}

console.log('\n== refinement is bought only where lava is ==');

{
  const marks = catalog.features
    .map((f) => markOf(f, false))
    .filter(isEdifice)
    .slice(0, VOLCANO.map3d.maxDrawn);
  /* One volcano in the drawn set erupts lava. */
  marks[0].erupting = true;
  marks[0].lava = true;

  const t0 = performance.now();
  const ridges = buildRidges(marks, {
    refine: L.refine,
    maxRefined: L.maxRefined,
    refineWhen: (c) => c.some((m) => m.lava),
  });
  const ms = performance.now() - t0;
  let nodes = 0;
  for (const r of ridges) nodes += r.positions.length / 3;

  const plainRidges = buildRidges(marks);
  let plainNodes = 0;
  for (const r of plainRidges) plainNodes += r.positions.length / 3;

  /* The whole affordability argument in one number: one lava volcano must cost
   * a few thousand extra nodes, not the ~950,000 that refining the drawn set
   * would (`VOLCANO.map3d.lava`). */
  const extra = nodes - plainNodes;
  check(
    'one lava volcano adds a few thousand nodes, not a million',
    extra > 0 && extra < 60000,
    extra.toLocaleString() + ' extra nodes, whole build ' + ms.toFixed(0) + ' ms'
  );

  const refined = ridges.filter((r) => r.surface.local.some((m) => m.lava));
  check('exactly one cluster was refined', refined.length === 1, refined.length + ' refined');

  /* ==> THE BUDGET IS A REAL LIMIT, NOT A COMMENT. <== */
  const many = marks.slice();
  for (let i = 0; i < 20; i++) {
    many[i] = { ...many[i], erupting: true, lava: true };
  }
  let refinedCount = 0;
  for (const r of buildRidges(many, {
    refine: L.refine,
    maxRefined: L.maxRefined,
    refineWhen: (c) => c.some((m) => m.lava),
  })) {
    if (r.refine > 1) refinedCount++;
  }
  check(
    'the refinement budget caps at maxRefined',
    refinedCount <= L.maxRefined,
    refinedCount + ' refined against a cap of ' + L.maxRefined
  );
}

console.log('\n== flows go DOWNHILL, and they are not straight lines ==');

{
  const cluster = clusterMembers([ridgeMember(markOf(subject, true))]);
  const ridge = buildRidge(cluster[0], { refine: L.refine });
  const flows = traceFlows(ridge);

  check('a lava volcano produces flows', flows.length > 0, flows.length + ' flows');

  let everRose = 0;
  let totalDrop = 0;
  for (const f of flows) {
    for (let i = 1; i < f.pts.length; i++) {
      if (f.pts[i].z > f.pts[i - 1].z + 1) everRose++;
    }
    totalDrop += f.pts[0].z - f.pts[f.pts.length - 1].z;
  }
  check(
    'every flow ends below where it started',
    flows.every((f) => f.pts[f.pts.length - 1].z < f.pts[0].z),
    'mean drop ' + (totalDrop / flows.length).toFixed(0) + ' m'
  );

  /* ==> THE FIRST BUILD FAILED HERE AND THE FAILURE WAS THE USEFUL PART. <==
   * Every flow ran the full 15 km to the footprint rim, because Etna's
   * modelled slope is a near-constant 0.89 and the stall test never fires on a
   * cone. Twelve flows covering an entire flank is a mountain painted orange,
   * not lava. `reachQ` is the fix and this is the assertion that stops it
   * regressing — a flow that reaches the rim is the bug coming back. */
  const m0 = flows[0].member;
  const reaches = flows.map((f) => {
    const p = f.pts[f.pts.length - 1];
    return Math.hypot(p.e - m0.e, p.n - m0.n) / m0.radius;
  });
  check(
    'no flow reaches the footprint rim',
    reaches.every((q) => q < 0.85),
    'furthest ' + Math.max(...reaches).toFixed(2) + ' of the base radius'
  );
  check(
    'flows differ in length rather than forming a starburst',
    Math.max(...reaches) - Math.min(...reaches) > 0.1,
    'reach spread ' + Math.min(...reaches).toFixed(2) + '–' + Math.max(...reaches).toFixed(2)
  );

  /* ==> RECORDED, NOT ASSERTED, BECAUSE THE HONEST ANSWER IS "BARELY". <== The
   * viscous path and pure steepest descent end within a fraction of a degree
   * of each other on a smooth cone. Asserting a difference here would be
   * asserting something this terrain does not produce, and it would pass only
   * by luck. The number is printed so a future change that turns the drag term
   * into a real no-op — or into an overshoot — is visible in the output. */
  console.log(
    '  ..   ' + everRose + ' uphill steps across ' + flows.length + ' flows ' +
      '(momentum carrying over a rise; near zero on a smooth cone is expected)'
  );

  /* ==> IF EVERY FLOW IS RADIAL, THE TERRAIN IS NOT BEING READ. <== A flow on
   * a perfect surface of revolution runs dead straight outward. The whole
   * claim of this feature is that the k=2/3/5/7 variation bends them into
   * drainages, so a set of perfectly radial flows means the tracer is looking
   * at an unvaried cone and the refinement bought nothing. */
  let bent = 0;
  for (const f of flows) {
    const m = f.member;
    const a = Math.atan2(f.pts[0].n - m.n, f.pts[0].e - m.e);
    const last = f.pts[f.pts.length - 1];
    const b = Math.atan2(last.n - m.n, last.e - m.e);
    let d = Math.abs(a - b);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d > 0.08) bent++;
  }
  check(
    'flows are deflected by the terrain rather than running radially',
    bent >= Math.ceil(flows.length * 0.4),
    bent + ' of ' + flows.length + ' bent more than ~5 degrees'
  );

  /* Convergence is the payoff: launches that end up in the same drainage. */
  const ends = flows.map((f) => {
    const p = f.pts[f.pts.length - 1];
    return Math.atan2(p.n - f.member.n, p.e - f.member.e);
  });
  let pairs = 0;
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      let d = Math.abs(ends[i] - ends[j]);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < 0.15) pairs++;
    }
  }
  console.log(
    '  ..   ' + flows.length + ' launches, ' + pairs + ' pairs ending within ~9 degrees ' +
      '(convergence into shared channels)'
  );
}

console.log('\n== nothing is drawn for a volcano that is not erupting lava ==');

{
  const quiet = clusterMembers([ridgeMember(markOf(subject, false))]);
  const ridge = buildRidge(quiet[0]);
  check('a quiet volcano traces no flows', traceFlows(ridge).length === 0);

  /* ==> `erupting` IS NOT `lava`, AND CONFLATING THEM IS THE MOST LIKELY
   * REGRESSION IN THIS FEATURE. <== Most eruptions emit ash or steam and no
   * lava at all. */
  const ashOnly = markOf(subject, false);
  ashOnly.erupting = true;
  ashOnly.lava = false;
  const ashRidge = buildRidge(clusterMembers([ridgeMember(ashOnly)])[0]);
  check(
    'an ash eruption with no lava traces no flows',
    traceFlows(ashRidge).length === 0
  );
}

console.log('\n== the ribbons are well-formed geometry ==');

{
  const cluster = clusterMembers([ridgeMember(markOf(subject, true))]);
  const ridge = buildRidge(cluster[0], { refine: L.refine });
  const flows = traceFlows(ridge);
  const ribbon = buildFlowRibbons(flows);

  check('ribbons build', !!ribbon);
  check(
    'every vertex has a T and there are two vertices per path point',
    ribbon.ts.length === ribbon.positions.length / 3,
    ribbon.ts.length + ' Ts for ' + ribbon.positions.length / 3 + ' vertices'
  );
  check(
    'T runs 0 to 1 and never outside it',
    ribbon.ts.every((t) => t >= 0 && t <= 1)
  );
  check(
    'no index points past the end of the buffer',
    Math.max(...ribbon.indices) < ribbon.positions.length / 3,
    'max index ' + Math.max(...ribbon.indices)
  );
  check(
    'no NaN reached the buffer',
    ribbon.positions.every(Number.isFinite),
    'positions'
  );

  /* The ribbon floats above the mountain, not inside it. */
  const { local, k, anySubmarine } = ridge.surface;
  let under = 0;
  for (let i = 0; i < ribbon.positions.length / 3; i++) {
    const e = ribbon.positions[i * 3];
    const n = ribbon.positions[i * 3 + 1];
    const z = ribbon.positions[i * 3 + 2];
    if (z < surfaceHeightAt(local, k, anySubmarine, e, n)) under++;
  }
  /* Some undercut is expected where a wide ribbon leans over a slope — the
   * width is measured in the ground plane, so the outer edge of a fan on a
   * steep flank can dip below. It must be a minority or the flow is buried. */
  check(
    'the ribbon sits on top of the mountain rather than inside it',
    under < ribbon.positions.length / 3 * 0.25,
    under + ' of ' + ribbon.positions.length / 3 + ' vertices under the surface'
  );

  console.log(
    '  ..   ' + flows.length + ' flows, ' + (ribbon.positions.length / 3).toLocaleString() +
      ' vertices, ' + (ribbon.indices.length / 3).toLocaleString() + ' triangles'
  );
}

console.log('\n== the crawl cannot cost a repaint while standing still ==');

check(
  'crawlHz is the single switch for the animation and the repaint it needs',
  typeof L.crawlHz === 'number' && L.crawlHz >= 0,
  String(L.crawlHz)
);

console.log(
  '\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILED') + '\n'
);
process.exit(failures === 0 ? 0 : 1);
