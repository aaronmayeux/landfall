#!/usr/bin/env node
/**
 * test-coast-stripe.mjs — the watch/warning stripe IS the coastline, restroked.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-coast-stripe.mjs`.
 *
 * ===========================================================================
 * WHAT WENT WRONG, AND WHY A TEST CAN CATCH IT
 * ===========================================================================
 *
 * The stripe shipped as a flat 8 px at every zoom while the coastline it
 * paints over fades with distance — 0.59 px on the globe, 1.71 px zoomed in.
 * So the warning color was about five times the width of the line it was
 * supposed to be REPLACING at close range, and thirteen times it far out. On
 * Bertha's smooth Texas coast at a basin zoom that read as a marked shore; on
 * Ida's Mississippi delta at close zoom the strokes on adjacent marsh islands
 * merged into a solid red slab (Aaron, on glass, 2026-08-10).
 *
 * The failure was not the number 8. It was that the stripe had a width OF ITS
 * OWN, unrelated to the thing it sits on, so the two could drift apart with
 * nobody noticing — and nothing broke, nothing errored, and the layer went on
 * working. That is the shape of bug this project keeps meeting.
 *
 * So the assertions below are all RELATIONS, never absolute pixel values. A
 * future coastline restyle drags the stripe with it and this suite stays
 * green; a future stripe that stops tracking the coast fails here whatever
 * width it picked.
 *
 * WHAT THIS CANNOT PROVE: that 1.8x reads right on glass. That is Aaron's,
 * and he already made the call.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

/* map/style.js reaches for theme state, which reads no DOM at import time but
 * does expect a global. Nothing here renders; the curves are pure data. */
const { coastCoreWidth, coastGlowWidth, coastGlowBlur } =
  await import('../map/style.js');
const { SIZE, STORM_GEO, OPACITY } = await import('../config/tokens.js');
const { ZOOM } = await import('../config/constants.js');

/* ---------------------------------------------------------------------------
 * READING A MAPLIBRE ZOOM CURVE
 *
 * `['interpolate', ['linear'], ['zoom'], z0, v0, z1, v1, …]`. Parsed rather
 * than hand-copied so the test reads whatever the style actually built.
 * ------------------------------------------------------------------------- */

function stopsOf(expr) {
  ok(Array.isArray(expr) && expr[0] === 'interpolate',
     'the width is a zoom curve, not a bare number');
  const out = [];
  for (let i = 3; i < expr.length; i += 2) out.push([expr[i], expr[i + 1]]);
  return out;
}

function at(expr, z) {
  const stops = stopsOf(expr);
  if (z <= stops[0][0]) return stops[0][1];
  if (z >= stops.at(-1)[0]) return stops.at(-1)[1];
  for (let i = 1; i < stops.length; i++) {
    const [z0, v0] = stops[i - 1];
    const [z1, v1] = stops[i];
    if (z <= z1) return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
  }
  return NaN;
}

/** Every zoom band the app actually uses, plus the ends. */
const ZOOMS = [ZOOM.min, ZOOM.planet, ZOOM.basin, ZOOM.regional, ZOOM.local, ZOOM.max];

/* ---------------------------------------------------------------------------
 * THE STRIPE TRACKS THE COAST
 * ------------------------------------------------------------------------- */
section('the stripe rides the coastline curve, at every zoom');

const coastCore = coastCoreWidth();
const stripeCore = coastCoreWidth(STORM_GEO.stripeCoreScale);
const coastGlow = coastGlowWidth();
const stripeGlow = coastGlowWidth(STORM_GEO.stripeGlowScale);

ok(
  stopsOf(stripeCore).map(([z]) => z).join() === stopsOf(coastCore).map(([z]) => z).join(),
  'the stripe breaks at the same zooms the coast breaks at'
);

/* ==> THIS IS THE ASSERTION THAT WOULD HAVE CAUGHT THE SLAB. <== A flat width
 * holds one value while the coast fades, so the ratio blows out at the ends —
 * which is precisely where nobody was looking. Checking the ratio at every
 * band, rather than the width at one, is the difference. */
for (const z of ZOOMS) {
  const ratio = at(stripeCore, z) / at(coastCore, z);
  ok(
    Math.abs(ratio - STORM_GEO.stripeCoreScale) < 1e-9,
    `at z${z} the stripe is exactly stripeCoreScale x the coast (got ${ratio.toFixed(3)})`
  );
}

/* A curve that never changes is a flat width wearing a curve's clothes. */
ok(
  at(stripeCore, ZOOM.min) < at(stripeCore, ZOOM.local),
  'the stripe fades with distance rather than holding one width'
);

/* ---------------------------------------------------------------------------
 * THE STRIPE REPLACES THE CYAN RATHER THAN SITTING ON IT
 *
 * The coast is TWO passes. Paint only the core and the cyan halo fringes out
 * either side of the warning color, which reads as a coast drawn twice.
 * ------------------------------------------------------------------------- */
section('both passes of the coast stack are covered');

for (const z of ZOOMS) {
  ok(
    at(stripeGlow, z) >= at(coastGlow, z),
    `at z${z} the stripe's halo covers the cyan halo (${at(stripeGlow, z).toFixed(2)} vs ${at(coastGlow, z).toFixed(2)})`
  );
  ok(
    at(stripeCore, z) >= at(coastCore, z),
    `at z${z} the stripe's core covers the cyan core`
  );
}

/* ==> AND IT MUST NOT OVERSHOOT INTO A WASH. <== A halo scaled like the core
 * pushes soft color ~2 px past anywhere the cyan reached. On the delta, where
 * marsh islands sit a few pixels apart, that fills the water between them and
 * rebuilds the slab in a dimmer color — the same bug, quieter. The stack has
 * to keep its SHAPE, not just its coverage. */
for (const z of [ZOOM.basin, ZOOM.local]) {
  const coastStandoff = (at(coastGlow, z) - at(coastCore, z)) / 2;
  const stripeStandoff = (at(stripeGlow, z) - at(stripeCore, z)) / 2;
  ok(
    stripeStandoff <= coastStandoff * 1.25,
    `at z${z} the stripe's halo does not reach further past its core than the cyan does ` +
      `(${stripeStandoff.toFixed(2)}px vs ${coastStandoff.toFixed(2)}px)`
  );
  ok(stripeStandoff > 0, `at z${z} there is a halo outside the core at all`);
}

ok(
  STORM_GEO.stripeGlowScale < STORM_GEO.stripeCoreScale,
  'the halo is scaled less than the core, deliberately'
);

/* ---------------------------------------------------------------------------
 * THE SOFTNESS COMES ALONG TOO
 * ------------------------------------------------------------------------- */
section('the halo is a halo');

ok(Array.isArray(coastGlowBlur()), 'the stripe halo carries the coast blur curve');
ok(
  STORM_GEO.stripeOpacity * OPACITY.coastGlow < STORM_GEO.stripeOpacity,
  'the halo is dimmer than the core it sits under'
);

/* The tokens are multipliers now, and a pixel value smuggled back in would
 * silently produce a 1.8-pixel stripe rather than a 1.8x one. */
ok(
  STORM_GEO.stripeCoreScale < 4 && STORM_GEO.stripeGlowScale < 4,
  'the stripe tokens are ratios, not pixel widths'
);
ok(SIZE.coastWidthCore > 0, 'the coastline still has a width to be a ratio of');

/* ------------------------------------------------------------------------- */
if (failures.length) {
  console.log(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (relations only — whether 1.8x reads right is a glass call)');
