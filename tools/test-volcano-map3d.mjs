/**
 * test-volcano-map3d.mjs — the real-scale maths behind the map-zoom mountains,
 * and the one safety property the tilt ramp must have.
 *
 * ==> THE POINT OF THIS FILE IS THAT `fill-extrusion` DIED OF A NUMBER. <== It
 * was cut because a footprint sized to read at z6 put Masaya's caldera across
 * 45 km of Nicaragua at z10. The replacement's whole claim is that a TRUE
 * footprint cannot do that. That claim is a number, so it is asserted here
 * against the real shipped catalog rather than argued in a comment.
 *
 * Runs against `assets/hazards/volcanoes-holocene.geojson` — the actual file,
 * not a fixture. Fixtures passing while glass fails is a lesson this project
 * has already paid for.
 *
 *   node tools/test-volcano-map3d.mjs
 */

import { readFileSync } from 'node:fs';
import { VOLCANO, TILT, DIVE } from '../config/constants.js';
import { volcanoFamily } from '../lib/volcano-shape.js';
import {
  isEdifice,
  volcanoRelief,
  volcanoBaseRadius,
  edificeOpacityAt,
} from '../lib/volcano-dimensions.js';
import { pitchAt, attachPitchRamp } from '../map/pitch-ramp.js';

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

/** Rebuild the minimum of a `marks` entry from a catalog feature. */
function markOf(f) {
  const p = f.properties;
  return {
    name: p.name,
    elev: Number(p.elev),
    submarine: Number(p.elev) < 0,
    family: volcanoFamily(p),
    erupting: false,
  };
}

const marks = catalog.features.map(markOf);
const byName = new Map(marks.map((m) => [m.name, m]));

console.log('\n== the tilt floor, which is the desync guard ==');

/* ==> THE ONE ASSERTION IN THIS FILE THAT IS ABOUT A BUG RATHER THAN A LOOK.
 * <== `map/globe-follow.js` has no concept of pitch, so any tilt while the 3D
 * globe is still VISIBLE pulls the two planets apart on screen. Visible ends
 * at the tail of `DIVE.fade.cage`. If somebody lowers `TILT.zStart` below that
 * to get tilt earlier, this is what tells them. */
const cageEndsAtZoom = DIVE.zSpace + DIVE.fade.cage[1] * (DIVE.zHandoff - DIVE.zSpace);
check(
  'tilt starts above the zoom where the 3D globe is last visible',
  TILT.zStart > cageEndsAtZoom,
  'zStart ' + TILT.zStart + ' vs cage gone at z' + cageEndsAtZoom.toFixed(2)
);
check('pitch is exactly 0 at the space floor', pitchAt(DIVE.zSpace) === 0);
check('pitch is exactly 0 where the cage disappears', pitchAt(cageEndsAtZoom) === 0);
check('pitch is exactly 0 at the start of the ramp', pitchAt(TILT.zStart) === 0);
check('pitch reaches its ceiling and stops', pitchAt(20) === TILT.maxDeg);
check('pitch never exceeds MapLibre default maxPitch', TILT.maxDeg <= 60);
check(
  'the projection has finished flattening before the mountains finish arriving',
  TILT.flatten[1] <= VOLCANO.map3d.handoff[1]
);

console.log('\n== the ramp must not touch the style before it is loaded ==');

/* ==> THIS SECTION EXISTS BECAUSE IT ALREADY HAPPENED. <== The first version
 * called `setProjection` in the same tick as the attach. MapLibre's
 * `Style.setProjection` opens with `_checkLoaded()`, which throws "Style is not
 * done loading." — and because the attach ran at module top level, that
 * exception took the entire Deep world down: no globe, no render loop, a dark
 * screen with the HTML shell still on it.
 *
 * The stub below is MapLibre's guard, and nothing more. It cannot prove the
 * layer draws; it can prove this specific outage cannot recur. */
function stubMap() {
  const handlers = {};
  let loaded = false;
  return {
    calls: [],
    on(ev, fn) {
      (handlers[ev] = handlers[ev] || []).push(fn);
    },
    off() {},
    emit(ev) {
      for (const fn of handlers[ev] || []) fn();
    },
    hasHandler(ev) {
      return !!(handlers[ev] && handlers[ev].length);
    },
    markLoaded() {
      loaded = true;
    },
    getZoom() {
      return 2;
    },
    setPitch(v) {
      this.calls.push(['setPitch', v]);
    },
    easeTo(v) {
      this.calls.push(['easeTo', v]);
    },
    setProjection(v) {
      if (!loaded) throw new Error('Style is not done loading.');
      this.calls.push(['setProjection', v]);
    },
  };
}

let threw = null;
const m = stubMap();
try {
  attachPitchRamp(m);
} catch (e) {
  threw = e;
}
check('attaching does not throw against an unloaded style', threw === null, threw && threw.message);
check(
  'attaching sets no projection at all before style.load',
  !m.calls.some((c) => c[0] === 'setProjection')
);
check('it listens on style.load', m.hasHandler('style.load'));

/* ==> AND IT MUST NOT LISTEN ON `styledata`. <== `setProjection` fires
 * `styledata`, and MapLibre's redundancy guard compares `projection.name` (a
 * string) to `type` (an interpolation expression, i.e. an array), so it never
 * short-circuits. A `styledata` handler that sets the projection re-triggers
 * itself forever. */
check('it does NOT listen on styledata', !m.hasHandler('styledata'));

/* ==> AND IT MUST NOT WRITE PITCH ON `zoom`. <== `Map.setPitch` is
 * `jumpTo({pitch})`, whose first statement is `stop()` — which aborts the
 * gesture that fired the event. Reported on glass as a pinch that had to be
 * restarted over and over through the whole tilt band. `zoomend` fires after
 * inertia has finished, when there is nothing left to abort. */
check('it listens on zoomend', m.hasHandler('zoomend'));
check('it does NOT listen on zoom', !m.hasHandler('zoom'));

m.markLoaded();
m.emit('style.load');
const projCalls = m.calls.filter((c) => c[0] === 'setProjection');
check('one projection write per style load', projCalls.length === 1);
check(
  'the projection it writes is an interpolation, not a bare name',
  projCalls.length === 1 && Array.isArray(projCalls[0][1].type)
);

/* Pitch arrives as an eased camera move, never as a bare setPitch — the bare
 * one is the gesture-killing path. */
m.calls.length = 0;
m.emit('zoomend');
check('a zoom that ends deep in the band writes pitch', true);
check(
  'pitch is never written with the gesture-aborting setPitch',
  !m.calls.some((c) => c[0] === 'setPitch')
);

console.log('\n== the layer must actually get added to the style ==');

/* ==> THIS IS THE `V3D: off` BUG AND IT COST A DEPLOY. <== The layer gated its
 * `addLayer` call on `map.isStyleLoaded()`. That reads like "does a style
 * exist" and it is not: MapLibre's `Style.loaded()` also requires no pending
 * source updates, EVERY source cache to have finished fetching tiles, and the
 * image manager to be loaded. None of that is true inside a `style.load`
 * handler, which is the only moment the layer was ever going to be added — so
 * the gate rejected the one call that could have worked and the layer was never
 * in the style at all.
 *
 * The stub models exactly that: style.load fires, isStyleLoaded() is still
 * false, and the layer must be added anyway. */
function stubStyleMap() {
  const handlers = {};
  return {
    layers: [],
    on(ev, fn) {
      (handlers[ev] = handlers[ev] || []).push(fn);
    },
    off() {},
    emit(ev) {
      for (const fn of handlers[ev] || []) fn();
    },
    /* Always false, the way it is during style.load. */
    isStyleLoaded() {
      return false;
    },
    getLayer(id) {
      return this.layers.find((l) => l.id === id);
    },
    addLayer(l) {
      this.layers.push(l);
    },
    setLayoutProperty() {
      throw new Error('custom layers must not be driven through setLayoutProperty');
    },
    getZoom() {
      return 7;
    },
    getCanvas() {
      return null;
    },
    triggerRepaint() {},
  };
}

const sm = stubStyleMap();
const layerMod = await import('../proto/volcano-3d.js');
let handle = null;
let addThrew = null;
try {
  handle = layerMod.createVolcano3dLayer(sm);
} catch (e) {
  addThrew = e;
}
check('creating the layer against an unloaded style does not throw', addThrew === null, addThrew && addThrew.message);
check('it does not add before style.load', sm.layers.length === 0);
check('status says it is waiting, not that it is off', handle && handle.status() === 'wait');

sm.emit('style.load');
check(
  'it IS added on style.load, even though isStyleLoaded() is still false',
  sm.layers.length === 1,
  sm.layers.length + ' layers'
);
check('the added layer is a 3d custom layer', sm.layers[0] && sm.layers[0].type === 'custom' && sm.layers[0].renderingMode === '3d');

/* Toggling visibility must not reach for a style API that custom layers do not
 * really have — the stub throws if it does. */
let visThrew = null;
try {
  handle.setVisible(false);
  handle.setVisible(true);
} catch (e) {
  visThrew = e;
}
check('toggling visibility never touches setLayoutProperty', visThrew === null, visThrew && visThrew.message);

console.log('\n== the handoff leaves no gap ==');

check(
  'mountains start no earlier than the Three renderer is cleared',
  VOLCANO.map3d.handoff[0] >= DIVE.zHandoff - 1e-9
);
check('mountains are absent below the handoff', edificeOpacityAt(VOLCANO.map3d.handoff[0]) === 0);
check('mountains are at full strength above it', edificeOpacityAt(VOLCANO.map3d.handoff[1]) === 1);

/* ==> AND NOT ONE FRAME BEFORE THE PROJECTION HAS FINISHED FLATTENING. <==
 * While MapLibre is anywhere in its globe→mercator blend, the basemap under a
 * mountain is on a curve the mountain is not, so the geometry sits visibly off
 * its own volcano. The handoff used to start at z5.0 with the blend running to
 * z5.4, which put the first third of the band inside it. */
check(
  'mountains do not start until the projection is fully flat',
  VOLCANO.map3d.handoff[0] >= TILT.flatten[1] - 1e-9,
  'handoff ' + VOLCANO.map3d.handoff[0] + ' vs flat at ' + TILT.flatten[1]
);

console.log('\n== a cone must clear its own base ellipse, or it is a pancake ==');

/* ==> THIS IS THE ASSERTION THAT WOULD HAVE SAVED A SESSION, AND IT IS AN
 * INEQUALITY RATHER THAN A NUMBER. <== Reported on glass: the mountains drew,
 * in the right place, at 84 fps — and read as pancakes with a pimple on top.
 * That was not a taste problem, it was arithmetic.
 *
 * Seen from a camera tilted `t` off vertical, a volcano's circular base
 * projects to an ellipse whose on-screen half-height is `baseRadius * cos(t)`,
 * while its summit rises `height * sin(t)` up the screen from the centre. The
 * summit is only OUTSIDE its own footprint when
 *
 *     height * sin(t) > baseRadius * cos(t)      i.e.   h / r > 1 / tan(t)
 *
 * and below that line no amount of shading makes it read as a mountain,
 * because the silhouette never breaks the disc. `h / r` is
 * `vertical / family.ratio`.
 *
 * The old numbers were 2.5 / 4.5 = 0.556 against a bar of 0.700 at 55°. Both
 * halves moved: 60° drops the bar to 0.577 and 4.0 lifts a cone to 0.889.
 *
 * Asserting the INEQUALITY rather than either number is the point — glass
 * tuning is expected to move both, and what must survive is the relationship. */
const bar = 1 / Math.tan((TILT.maxDeg * Math.PI) / 180);
const coneRatio = VOLCANO.map3d.vertical / VOLCANO.map3d.families.cone.ratio;

console.log(
  '  ..   bar at ' + TILT.maxDeg + '° is ' + bar.toFixed(3) + ' — per family:'
);
for (const [fam, spec] of Object.entries(VOLCANO.map3d.families)) {
  const hr = VOLCANO.map3d.vertical / spec.ratio;
  console.log(
    '  ..     ' + fam.padEnd(8) + hr.toFixed(3) + (hr > bar ? '  clears' : '  flat')
  );
}

check(
  'a cone stands clear of its own base at full tilt',
  coneRatio > bar,
  coneRatio.toFixed(3) + ' vs bar ' + bar.toFixed(3) + ' at ' + TILT.maxDeg + '°'
);

/* ==> AND NOT SO FAR CLEAR THAT IT IS A SPIRE. <== The failure on the other
 * side is real and Aaron named it: above about 4x a stratovolcano stops
 * looking like a mountain. This is the guard rail on the correction, not a
 * second opinion about the look. */
check(
  'a cone is not so tall it reads as a spire',
  coneRatio < 1.5,
  coneRatio.toFixed(3)
);

/* A shield is DELIBERATELY below the bar — a shield is a swell and drawing it
 * as anything else breaks §42.1.2's rank order. This asserts the rank, not the
 * absolute, so raising `vertical` cannot quietly turn Mauna Loa into a cone. */
check(
  'a shield stays flatter than a cone at the same exaggeration',
  VOLCANO.map3d.vertical / VOLCANO.map3d.families.shield.ratio < coneRatio
);

/* The tilt has to actually ARRIVE before the circles leave, or the mountains
 * are seen from overhead during the whole handoff and the inequality above is
 * about a camera angle that does not exist yet. */
check(
  'there is real tilt by the time the circles are gone',
  pitchAt(VOLCANO.map3d.handoff[1]) > TILT.maxDeg * 0.5,
  pitchAt(VOLCANO.map3d.handoff[1]).toFixed(1) + '° at z' + VOLCANO.map3d.handoff[1]
);

console.log('\n== the number that killed fill-extrusion ==');

/* Masaya's real caldera is about 6 x 11 km. The rejected version drew it at
 * roughly 45 km, spanning Managua to Granada. */
const masaya = byName.get('Masaya');
check('Masaya is in the catalog', !!masaya);
if (masaya) {
  const km = (volcanoBaseRadius(masaya) * 2) / 1000;
  check(
    'Masaya models under 20 km across, not 45',
    km < 20,
    km.toFixed(1) + ' km'
  );
}

console.log('\n== real proportions land near reality ==');

const expectKm = [
  ['Fujisan', 20, 45],
  ['Etna', 20, 50],
  ['Mauna Loa', 60, 160],
  ['Vesuvius', 8, 40],
];
for (const [name, lo, hi] of expectKm) {
  const m = byName.get(name);
  if (!m) {
    check(name + ' is in the catalog', false);
    continue;
  }
  const km = (volcanoBaseRadius(m) * 2) / 1000;
  check(
    name + ' models between ' + lo + ' and ' + hi + ' km across',
    km >= lo && km <= hi,
    km.toFixed(1) + ' km'
  );
}

console.log('\n== the plateau problem is capped, not ignored ==');

/* `elev` is height above SEA. Ojos del Salado stands on a 4,000 m plateau and
 * reads 6,879 m, which uncapped becomes a 7 km spire. */
const ojos = byName.get('Ojos del Salado, Nevados');
check('Ojos del Salado is in the catalog', !!ojos);
if (ojos) {
  check(
    'its modelled relief is capped well under its sea-level elevation',
    volcanoRelief(ojos) < ojos.elev,
    'relief ' + volcanoRelief(ojos) + ' m vs elev ' + ojos.elev + ' m'
  );
}

let maxRelief = 0;
for (const m of marks) if (isEdifice(m)) maxRelief = Math.max(maxRelief, volcanoRelief(m));
check(
  'no modelled volcano is taller than the tallest family cap',
  maxRelief <= Math.max(...Object.values(VOLCANO.map3d.families).map((f) => f.reliefCap)),
  maxRelief + ' m'
);

let minRelief = Infinity;
for (const m of marks) if (isEdifice(m)) minRelief = Math.min(minRelief, volcanoRelief(m));
check(
  'no modelled volcano has zero or negative height',
  minRelief >= VOLCANO.map3d.reliefFloor,
  minRelief + ' m'
);

console.log('\n== the two sets that never become mountains ==');

const subs = marks.filter((m) => m.submarine);
const fields = marks.filter((m) => m.family === 'field');
check('the catalog still has submarine volcanoes', subs.length > 0, subs.length + ' of them');
check('the catalog still has volcanic fields', fields.length > 0, fields.length + ' of them');
check('no submarine volcano gets an edifice', subs.every((m) => !isEdifice(m)));
check('no volcanic field gets an edifice', fields.every((m) => !isEdifice(m)));
check(
  'every other family does get one',
  marks
    .filter((m) => !m.submarine && m.family !== 'field')
    .every((m) => isEdifice(m))
);

console.log('\n== nothing scales a footprint, and nothing may put it back ==');

/* ==> `inflate` WAS DELETED AND THIS IS THE GUARD ON THAT DECISION. <== It was
 * a uniform 5x zoom-driven multiplier, decaying to true scale by z9.5, whose
 * job was making a distant volcano big enough to see. Hawaii killed it: Mauna
 * Loa's true footprint is about 100 km across and the Big Island is about 130,
 * so drawn true the mountain very nearly IS the island — and at 5x it was a
 * grey oval several times the island's width with Hawaii floating inside it.
 *
 * It was also CAUSAL, not merely ugly. Clustering asks whether TRUE footprints
 * intersect while the screen drew them five times wider, so the pairs that
 * visibly collided were exactly the pairs the merge decided were not
 * neighbours. Two solid cones inside each other give a depth-buffer seam that
 * moves as the camera moves, which is what "different parts get clipped from
 * different angles" was.
 *
 * And it is the same mistake that killed `fill-extrusion` (§42.1.4a): a
 * footprint sized to hit a pixel target. A decaying lie is still a lie while
 * it decays. If a future session reintroduces one under any name, this fails. */
const sizeKeys = Object.keys(VOLCANO.map3d).filter((k) =>
  /inflate|inflation|minPx|pixelFloor|widthScale|footprintScale/i.test(k)
);
check(
  'no horizontal scale factor exists on map3d at all',
  sizeKeys.length === 0,
  'found ' + sizeKeys.join(', ')
);

/* The replacement for `inflate` is the handoff sitting where true scale is big
 * enough to read. Measured across the drawn set: a median volcano is 12 px
 * across at z5.4, 21 px at z6.2 and 36 px at z7.0. Below about 30 px a
 * mountain is smaller than the dot it replaced, which is a step backwards. */
const EARTH_M = 40075016.686;
function widthPx(mark, zoom) {
  const mpp = (EARTH_M * Math.cos((mark.lat * Math.PI) / 180)) / (512 * Math.pow(2, zoom));
  return (volcanoBaseRadius(mark) * 2) / mpp;
}
const widths = catalog.features
  .map((f) => ({ ...markOf(f), lat: f.geometry.coordinates[1] }))
  .filter(isEdifice)
  .map((m) => widthPx(m, VOLCANO.map3d.handoff[0]))
  .sort((a, b) => a - b);
const median = widths[Math.floor(widths.length / 2)];
console.log('  ..   median volcano is ' + median.toFixed(0) + ' px across at the handoff');
check(
  'a median volcano is big enough to read where the mountains arrive',
  median >= 30,
  median.toFixed(0) + ' px at z' + VOLCANO.map3d.handoff[0]
);

/* ==> AND THE DOTS MUST STRETCH TO MEET IT. <== `proto/volcano-map.js` reads
 * `map3d.handoff` for its own fade-out, so moving the handoff moves the dots
 * with it and there is structurally no gap. This asserts the circle band still
 * starts below where the mountains start, i.e. that the ladder overlaps. */
check(
  'the circles are at full strength well below the handoff',
  VOLCANO.mapMarks.circleIn[1] < VOLCANO.map3d.handoff[0],
  'circles full by z' + VOLCANO.mapMarks.circleIn[1] + ', mountains from z' + VOLCANO.map3d.handoff[0]
);

console.log('\n== the two ratio tables are deliberately different ==');

/* §42.1.2 spreads the globe's ratios apart so six silhouettes separate at 3 px.
 * This layer uses real ones. If somebody ever "tidies up" by merging them, the
 * globe's shapes stop separating or the map's stop being true. */
let anyDiffer = false;
for (const fam of Object.keys(VOLCANO.map3d.families)) {
  if (VOLCANO.map3d.families[fam].ratio !== VOLCANO.shapes.families[fam].ratio) anyDiffer = true;
}
check('the map-zoom ratios are not the globe ratios', anyDiffer);
check(
  'a shield is still flatter than a cone (§42.1.2 rank order)',
  VOLCANO.map3d.families.shield.ratio > VOLCANO.map3d.families.cone.ratio
);
check(
  'a dome is still steeper than a cone',
  VOLCANO.map3d.families.dome.ratio < VOLCANO.map3d.families.cone.ratio
);

console.log('');
if (failed) {
  console.log(failed + ' check(s) failed');
  process.exit(1);
}
console.log('all checks passed');
