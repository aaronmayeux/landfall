#!/usr/bin/env node
/**
 * test-world-basemap.mjs — a world's basemap manifest (map/style.js, config/worlds/).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-world-basemap.mjs`, same as every
 * other suite here (§12 — this project has no toolchain by design).
 *
 * TWO THINGS, AND THE FIRST ONE IS THE POINT.
 *
 * 1. ==> SKY DOES NOT MOVE. <== `buildStyle` grew two new parameters (`admin`,
 *    and a third plate colour) and the shipped app passes neither. Every
 *    assertion in the first section is there to prove the app's own basemap came
 *    out of this change byte for byte — because "I added a knob, the default is
 *    the old behaviour" is a claim, and the whole reason it is safe to add knobs
 *    to a live app is that something checks the claim.
 *
 * 2. THE NAME LADDER'S OWN INVARIANT, ENFORCED RATHER THAN WRITTEN DOWN.
 *    `ADMIN.nameLadder` states it in prose: from the moment the cage starts
 *    dissolving until cities arrive, at least one name is on screen at EVERY
 *    zoom. Deep deletes a rung from that ladder (no state names), so it has to
 *    lengthen the rung below. A gap there is invisible in the constants and
 *    obvious on a phone, which is the worst possible place to find it — so this
 *    samples the whole zoom range instead of trusting the six numbers.
 *
 * WHAT THIS CANNOT PROVE: that MapLibre accepts the style. An expression can be
 * structurally reasonable here and still be rejected at load — which happened,
 * and rejected the WHOLE style rather than one layer. `tools/csp-check.mjs` and
 * the headless harness are what catch that. The one specific shape that broke is
 * asserted below anyway, because it cost an hour.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { buildStyle } = await import('../map/style.js');
const { DEEP_WORLD } = await import('../config/worlds/deep.js');
const { SKY_WORLD } = await import('../config/worlds/sky.js');
const { ADMIN, ZOOM, PLATE_LINE } = await import('../config/constants.js');

/* ---------------------------------------------------------------------------
 * A MINIMAL EXPRESSION EVALUATOR
 *
 * Only the shapes this file actually produces: a literal, `byZoom`'s
 * interpolate, and the `case` on `tier` that sits inside its stop values. Not a
 * general MapLibre evaluator and must not become one — if a style ever needs
 * more than this to be testable, the style has grown an expression too clever to
 * reason about.
 * ------------------------------------------------------------------------- */
function evalExpr(e, { zoom = 0, props = {} } = {}) {
  if (typeof e === 'number' || typeof e === 'string' || e == null) return e;
  if (!Array.isArray(e)) return e;
  const [op] = e;
  if (op === 'interpolate') {
    const stops = e.slice(3);
    const zs = [];
    for (let i = 0; i < stops.length; i += 2) zs.push([stops[i], stops[i + 1]]);
    if (zoom <= zs[0][0]) return evalExpr(zs[0][1], { zoom, props });
    if (zoom >= zs[zs.length - 1][0]) return evalExpr(zs[zs.length - 1][1], { zoom, props });
    for (let i = 1; i < zs.length; i++) {
      if (zoom <= zs[i][0]) {
        const [z0, v0] = zs[i - 1];
        const [z1, v1] = zs[i];
        const t = (zoom - z0) / (z1 - z0);
        const a = evalExpr(v0, { zoom, props });
        const b = evalExpr(v1, { zoom, props });
        return a + (b - a) * t;
      }
    }
  }
  if (op === 'case') {
    for (let i = 1; i < e.length - 1; i += 2) {
      if (evalExpr(e[i], { zoom, props })) return evalExpr(e[i + 1], { zoom, props });
    }
    return evalExpr(e[e.length - 1], { zoom, props });
  }
  if (op === '==') return evalExpr(e[1], { zoom, props }) === evalExpr(e[2], { zoom, props });
  if (op === 'get') return props[e[1]];
  if (op === 'to-number') return Number(evalExpr(e[1], { zoom, props }));
  if (op === 'coalesce') {
    for (let i = 1; i < e.length; i++) {
      const v = evalExpr(e[i], { zoom, props });
      if (v !== undefined && v !== null) return v;
    }
    return null;
  }
  throw new Error('the evaluator does not know "' + op + '" — see the note above');
}

/** How many zoom-driven subexpressions are nested inside one property. MapLibre
 *  allows exactly one, and more than one rejects the entire style. */
function zoomExprCount(e) {
  if (!Array.isArray(e)) return 0;
  let n = e[0] === 'interpolate' || e[0] === 'step' ? 1 : 0;
  for (const sub of e.slice(1)) n += zoomExprCount(sub);
  return n;
}

const sky = buildStyle({ palette: SKY_WORLD.map, plates: SKY_WORLD.plates, admin: SKY_WORLD.admin });
const deep = buildStyle({ palette: DEEP_WORLD.map, plates: DEEP_WORLD.plates, admin: DEEP_WORLD.admin });
const bare = buildStyle();
const layer = (style, id) => style.layers.find((l) => l.id === id);
const ids = (style) => style.layers.map((l) => l.id);

/* ---------------------------------------------------------------------------
 * SKY DOES NOT MOVE
 * ------------------------------------------------------------------------- */
section('the shipped app is unchanged');

/* The app calls `createGlobe` with no world at all, so this is the real one. */
ok(ids(bare).includes('admin-state'), 'the app still draws state borders');
ok(ids(bare).includes('place-state'), 'the app still draws state names');
ok(layer(bare, 'place-country').maxzoom === ADMIN.nameLadder.countryOut[1],
  'the app still retires country names at the end of their fade');
ok(!ids(bare).some((id) => id.startsWith('plate-')), 'the app draws no plate boundaries');
ok(!bare.sources.plates, 'the app declares no plate seam source');
ok(!bare.sources['plate-labels'], 'the app declares no plate label source');

/* Sky, as a world descriptor, must be indistinguishable from no world at all on
 * everything the admin block touches — it declares no `admin`, so it is the
 * default path, and if these ever diverge the default stopped being the default. */
ok(JSON.stringify(ids(sky)) === JSON.stringify(ids(bare)), 'Sky and no-world produce the same layer list');
ok(
  JSON.stringify(layer(sky, 'place-country')) === JSON.stringify(layer(bare, 'place-country')),
  'Sky and no-world produce an identical country-name layer'
);

/* ---------------------------------------------------------------------------
 * DEEP DROPS THE STATE FURNITURE
 * ------------------------------------------------------------------------- */
section('Deep: no state lines, no state names');

ok(!ids(deep).includes('admin-state'), 'Deep draws no state borders');
ok(!ids(deep).includes('place-state'), 'Deep draws no state names');
/* ABSENT, NOT HIDDEN. A world declining a class of furniture should not leave
 * MapLibre laying it out behind a `visibility: none`, and a hidden layer is also
 * something a stray `setLayoutProperty` could switch back on. */
ok(
  !deep.layers.some((l) => l.layout && l.layout.visibility === 'none'),
  'nothing on Deep is merely hidden'
);
ok(ids(deep).includes('admin-country'), 'Deep keeps national borders');
ok(ids(deep).includes('place-city'), 'Deep keeps city names');

/* ---------------------------------------------------------------------------
 * NEVER A NAMELESS GLOBE
 * ------------------------------------------------------------------------- */
section('the name ladder holds with a rung removed');

const country = layer(deep, 'place-country');
ok(country.maxzoom === undefined, 'Deep does not retire the country-name layer early');

/* ==> THE MAXZOOM AND THE OPACITY HAVE TO AGREE, AND THIS IS WHY BOTH ARE
 * CHECKED. <== Sustaining the fade while leaving `maxzoom` in place would retire
 * the layer at z5 no matter what the opacity said — the same bug in a different
 * property, and invisible in the constants. */
let gap = null;
for (let z = ADMIN.nameLadder.countryIn[1]; z <= ZOOM.max; z += 0.05) {
  const o = evalExpr(country.paint['text-opacity'], { zoom: z });
  if (!(o > 0.99)) { gap = z; break; }
}
ok(gap === null, `country names hold at full strength from z${ADMIN.nameLadder.countryIn[1]} to z${ZOOM.max}${gap === null ? '' : ` (dropped at z${gap.toFixed(2)})`}`);

/* And the rise is IDENTICAL to Sky's, deliberately: a world changes when a rung
 * ENDS, never when it begins. */
const skyCountry = layer(sky, 'place-country');
for (const z of [3.4, 3.6, 3.8, 4.0]) {
  const a = evalExpr(country.paint['text-opacity'], { zoom: z });
  const b = evalExpr(skyCountry.paint['text-opacity'], { zoom: z });
  ok(Math.abs(a - b) < 1e-9, `country names arrive at the same rate as Sky's at z${z}`);
}

/* ---------------------------------------------------------------------------
 * THE MAGMA STACK
 * ------------------------------------------------------------------------- */
section('three passes, widest to brightest');

const glow = layer(deep, 'plate-glow');
const core = layer(deep, 'plate-core');
const hot = layer(deep, 'plate-hot');
ok(glow && core && hot, 'all three magma passes exist');

/* THE ORDER IN THE ARRAY IS THE ORDER ON SCREEN. A bright core drawn UNDER a
 * wide dim band is not a core, it is a smudge. */
ok(
  ids(deep).indexOf('plate-glow') < ids(deep).indexOf('plate-core') &&
    ids(deep).indexOf('plate-core') < ids(deep).indexOf('plate-hot'),
  'the passes are drawn dimmest-first'
);

/* WIDTHS MUST NEVER CROSS at any zoom. They all derive from one coast width, so
 * they cannot cross by accident — but `SIZE.plateWidthScale` and the hairline
 * floor are both multipliers someone retunes on glass, and a floor is exactly
 * the kind of guard that can make two ramps meet. */
let crossed = null;
for (let z = ZOOM.min; z <= ZOOM.max; z += 0.1) {
  const w = {
    glow: evalExpr(glow.paint['line-width'], { zoom: z }),
    core: evalExpr(core.paint['line-width'], { zoom: z }),
    hot: evalExpr(hot.paint['line-width'], { zoom: z }),
  };
  if (!(w.hot < w.core && w.core < w.glow)) { crossed = { z, w }; break; }
}
ok(crossed === null, `hot < body < heat at every zoom${crossed ? ` (crossed at z${crossed.z.toFixed(1)}: ${JSON.stringify(crossed.w)})` : ''}`);

/* The core is the one pass that is not blurred. That is what makes it read as a
 * hard bright line inside a soft one, which is what makes it read as heat. */
ok(hot.paint['line-blur'] === undefined, 'the hot core is unblurred');
ok(glow.paint['line-blur'] !== undefined && core.paint['line-blur'] !== undefined, 'both outer passes are blurred');

/* NOTHING ANIMATES DOWN HERE. A paint property that varied on anything but zoom
 * would mean something is driving it per frame, which means a full map redraw
 * per frame. The shimmer belongs to the Three shader and only there. */
for (const l of [glow, core, hot]) {
  for (const [k, v] of Object.entries(l.paint)) {
    ok(zoomExprCount(v) <= 1, `${l.id}.${k} holds at most one zoom expression`);
  }
}

/* ---------------------------------------------------------------------------
 * THE PLATE NAME LAYERS
 * ------------------------------------------------------------------------- */
section('plate names, both bands');

const far = layer(deep, 'plate-name-far');
const near = layer(deep, 'plate-name-near');
ok(far && near, 'both displacement bands have a layer');
ok(far.source === 'plate-labels' && near.source === 'plate-labels', 'both read the label source');
ok(deep.sources['plate-labels'] && deep.sources['plate-labels'].data.features.length === 0,
  'the label source is declared EMPTY, to be filled by map/plate-seams.js');

/* ==> THE ONE THAT COST AN HOUR. <== `['*', bandRamp, tierRamp]` is two
 * zoom-driven subexpressions in one property, and MapLibre does not disable that
 * layer — it rejects the entire style, so `style.load` never fires and the map
 * draws nothing at all. The product is folded in JavaScript instead. */
for (const l of [far, near]) {
  ok(zoomExprCount(l.paint['text-opacity']) === 1, `${l.id} text-opacity holds exactly ONE zoom expression`);
}

/* NO `text-offset`. The side a name sits on is carried by the geometry, because
 * MapLibre's keep-upright flip takes `text-offset` with it and would put the
 * Pacific plate over California the moment the globe is turned. Measured in a
 * browser; see lib/plate-lines.js. */
for (const l of [far, near]) {
  ok(l.layout['text-offset'] === undefined, `${l.id} uses no text-offset`);
}

/* THE BANDS HAND OVER RATHER THAN OVERLAP. Two copies of one name at full
 * strength in the same place read as one bold double-struck word. */
const t1 = { tier: 1 };
for (const z of [PLATE_LINE.labelBand - 0.31, PLATE_LINE.labelBand, PLATE_LINE.labelBand + 0.31]) {
  const a = evalExpr(far.paint['text-opacity'], { zoom: z, props: t1 });
  const b = evalExpr(near.paint['text-opacity'], { zoom: z, props: t1 });
  ok(a + b <= 1.001, `at z${z.toFixed(2)} the two bands sum to ${(a + b).toFixed(2)}, never more than one label's worth`);
}
/* And one of them is always carrying, above the tier's arrival — a dead spot in
 * the middle of the crossfade would blink every plate name off at once. */
let blank = null;
for (let z = PLATE_LINE.tierIn[1] + PLATE_LINE.tierFade; z <= ZOOM.max; z += 0.05) {
  const a = evalExpr(far.paint['text-opacity'], { zoom: z, props: t1 });
  const b = evalExpr(near.paint['text-opacity'], { zoom: z, props: t1 });
  if (a + b < 0.99) { blank = { z, a, b }; break; }
}
ok(blank === null, `a tier-1 name is always at full strength once it has arrived${blank ? ` (dipped to ${(blank.a + blank.b).toFixed(2)} at z${blank.z.toFixed(2)})` : ''}`);

/* The tiers arrive in order, and none of them is on screen at the planet band —
 * MapLibre is fully transparent below `DIVE.zSpace`, so a name there would be
 * laid out and paid for and invisible. */
ok(
  PLATE_LINE.tierIn[1] < PLATE_LINE.tierIn[2] && PLATE_LINE.tierIn[2] < PLATE_LINE.tierIn[3],
  'the tiers arrive biggest-first'
);
for (const tier of [1, 2, 3]) {
  const o = evalExpr(far.paint['text-opacity'], { zoom: ZOOM.planet, props: { tier } });
  ok(o === 0, `tier ${tier} draws nothing at the planet band`);
}

/* --- report --------------------------------------------------------------- */
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (the manifest and the ramps; whether MapLibre ACCEPTS the style is the headless run)');
