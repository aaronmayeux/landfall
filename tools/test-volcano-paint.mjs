/**
 * test-volcano-paint.mjs — the MapLibre paint expressions, checked against the
 * one rule that fails at STYLE LOAD rather than on screen.
 *
 * ==> A ZOOM EXPRESSION MAY ONLY BE THE INPUT TO A TOP-LEVEL `step` OR
 * `interpolate`. <== The natural way to write "this value, faded by zoom" is
 * `['*', <value>, <zoom curve>]`, and MapLibre rejects it outright with
 * `"zoom" expression may only be used as input to a top-level "step" or
 * "interpolate" expression.` The layer does not degrade — it never gets added,
 * and the only trace is a console message on a device nobody has a console
 * attached to. That is exactly SPEC.md §5's silent failure, so it is asserted
 * here instead.
 *
 * The rule is mirrored from MapLibre 5.6's own validator, and it has a second
 * clause worth catching too: only ONE zoom-based subexpression per property.
 *
 *   node tools/test-volcano-paint.mjs
 */

import { circlePaint, extrudePaint } from '../proto/volcano-map.js';
import { VOLCANO } from '../config/constants.js';

const EX = VOLCANO.extrusion;

let passed = 0;
const failures = [];
function ok(what, cond, detail = '') {
  if (cond) passed++;
  else failures.push(`${what}${detail ? ' — ' + detail : ''}`);
}
function group(name) {
  console.log('\n  ' + name);
}

const isExpr = (v) => Array.isArray(v) && typeof v[0] === 'string';
const isZoom = (v) => isExpr(v) && v[0] === 'zoom';

/**
 * `interpolate` and `step` put their input in DIFFERENT places, and the stop
 * pairs start at a different index in each. Getting that wrong is how the first
 * version of this guard passed a nested curve.
 *
 *   ['interpolate', <type>, <input>, stop, out, stop, out, ...]
 *   ['step',        <input>, out0,   stop, out, stop, out, ...]
 */
function curveParts(node) {
  if (!isExpr(node)) return null;
  if (node[0] === 'interpolate') return { input: node[2], outputs: node.slice(3).filter((_, i) => i % 2 === 1) };
  if (node[0] === 'step') return { input: node[1], outputs: [node[2], ...node.slice(3).filter((_, i) => i % 2 === 1)] };
  return null;
}

/** Does a zoom reference appear anywhere in here? */
function hasZoom(node) {
  if (isZoom(node)) return true;
  if (!Array.isArray(node)) return false;
  return node.some(hasZoom);
}

/**
 * Count the legal zoom curves and report any illegal zoom reference.
 * A curve is legal only at the ROOT of the property value.
 */
function audit(node, atRoot) {
  if (!isExpr(node)) {
    if (Array.isArray(node)) {
      return node.reduce((acc, c) => merge(acc, audit(c, false)), { curves: 0, illegal: false });
    }
    return { curves: 0, illegal: false };
  }

  const parts = curveParts(node);
  if (parts && isZoom(parts.input)) {
    if (!atRoot) return { curves: 1, illegal: true };
    /* The curve's own OUTPUT values may be data-driven, and must not contain a
     * second zoom reference. */
    return { curves: 1, illegal: parts.outputs.some(hasZoom) };
  }

  if (isZoom(node)) return { curves: 0, illegal: true };

  return node
    .slice(1)
    .reduce((acc, c) => merge(acc, audit(c, false)), { curves: 0, illegal: false });
}

function merge(a, b) {
  return { curves: a.curves + b.curves, illegal: a.illegal || b.illegal };
}

console.log('volcano paint expressions — MapLibre 5.6 zoom rules');

/* ------------------------------------------------------------------------ */
group('the guard itself catches the mistake it exists for');

/* If this passes something MapLibre rejects, every assertion below is worth
 * nothing. The shape checked here is the exact one that was written first. */
const trap = ['*', ['get', 'hM'], ['interpolate', ['linear'], ['zoom'], 5, 7, 11, 1.4]];
ok('a zoom curve nested in a multiply is caught', audit(trap, true).illegal);
const double = [
  'interpolate', ['linear'], ['zoom'],
  5, ['interpolate', ['linear'], ['zoom'], 5, 0, 8, 1],
  8, 1,
];
ok('a zoom curve nested in another one is caught', audit(double, true).illegal);
ok(
  'a legal composite is NOT caught',
  !audit(['interpolate', ['linear'], ['zoom'], 5, ['get', 'hM'], 8, 0], true).illegal
);

/* ------------------------------------------------------------------------ */
group('every paint property is legal');

for (const [layer, paint] of [['circle', circlePaint()], ['fill-extrusion', extrudePaint()]]) {
  for (const [prop, value] of Object.entries(paint)) {
    const { illegal, curves } = audit(value, true);
    ok(`${layer}.${prop} places its zoom curve legally`, !illegal);
    ok(`${layer}.${prop} has at most one zoom curve`, curves <= 1, String(curves));
  }
}

/* ------------------------------------------------------------------------ */
group('the ladder is wired the way the constants describe it');

const circle = circlePaint();
const extrude = extrudePaint();

/* The bands must OVERLAP. A hard switch between two ways of drawing one
 * volcano is a pop, and the plate seams already taught this project that. */
ok(
  'the extrusions arrive before the circles leave',
  EX.extrudeIn[0] < EX.circleOut[1],
  `extrude from ${EX.extrudeIn[0]}, circle gone by ${EX.circleOut[1]}`
);
ok(
  'the circles arrive while the Three pips are still up',
  EX.circleIn[0] < 3.8,
  `circles from ${EX.circleIn[0]}, pips gone by ~3.8`
);
ok('the circle envelope is in order', EX.circleIn[1] <= EX.circleOut[0]);

/* Exaggeration must COME OFF as you descend — the whole reason it is a curve
 * and not a constant. */
const mults = EX.heightExaggeration.map(([, m]) => m);
ok(
  'vertical exaggeration decreases with zoom',
  mults.every((m, i) => i === 0 || m < mults[i - 1]),
  mults.join(' → ')
);
ok('it never inverts the terrain', mults.every((m) => m > 0), mults.join(' '));
ok(
  'and it lands near true scale at the close end',
  mults[mults.length - 1] < 2,
  String(mults[mults.length - 1])
);

/* Colour is not themeable and must not drift between renderers. */
ok(
  'the circle and the extrusion agree about erupting',
  JSON.stringify(circle['circle-color']) === JSON.stringify(extrude['fill-extrusion-color'])
);

/* ------------------------------------------------------------------------ */
console.log('\n' + '-'.repeat(60));
if (failures.length) {
  console.log(`FAILED — ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED — ${passed} assertions\n`);
