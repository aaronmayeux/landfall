#!/usr/bin/env node
/**
 * test-water-mask.mjs — the one assumption the shore mask rests on, asserted
 * for every palette the app can be wearing.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-water-mask.mjs`, same as every
 * other suite here (§12 — this project has no toolchain by design).
 *
 * ==> WHAT THIS FILE IS FOR. <== The sea sheet decides where the shoreline is
 * by photographing the basemap underneath itself and asking, per pixel,
 * whether that pixel is nearer the OCEAN colour or the LAND colour. That test
 * is only meaningful while those two colours are far enough apart to tell
 * apart. Nothing else in the codebase knows that: `config/tokens.js` picks
 * ocean and land for how the globe reads, and a future recolour has no reason
 * to consider a shader in `proto/` that samples them.
 *
 * ==> AND THE FAILURE WOULD BE SILENT AND ON A PHONE. <== Bring the pair too
 * close and the mask does not error — it starts cutting the sea in the wrong
 * places, or stops cutting it at all, and the only symptom is water lying over
 * an island in Vanuatu. That is exactly the class of bug that has already cost
 * this feature three deploys. So the margin is asserted at check time.
 *
 * ==> THE PLANET-BAND LAND COLOUR IS DELIBERATELY NOT ASSERTED. <== `landFaint`
 * sits very close to the ocean on purpose — at the planet band the continents
 * are meant to barely register so the 3D mesh is the hero. It would fail this
 * check, and it is not a bug, because the mask only exists above
 * `VOLCANO.map3d.handoff[0]`, which is `ZOOM.local` — the last stop of the
 * background's zoom ramp, where the land colour is exactly `landHigh`. This
 * suite asserts that relationship too, so the exemption cannot outlive the
 * reason for it.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { VOLCANO, ZOOM } = await import('../config/constants.js');
const { DARK, LIGHT } = await import('../config/tokens.js');
const { DEEP_WORLD } = await import('../config/worlds/deep.js');
const DEEP = DEEP_WORLD.map;

const SHORE = VOLCANO.map3d.water.shore;

/** Unit RGB from `#rrggbb`. The same conversion the mask itself does, and
 *  deliberately the same naive one — this is a comparison against raw sRGB
 *  bytes read out of a canvas, not a perceptual colour difference. */
function rgb(hex) {
  const h = String(hex).replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* ==> HOW WIDE THE MARGIN HAS TO BE, AND WHY IT IS THIS NUMBER. <== The shader
 * decides with a RATIO: `dSea / (dSea + dLand)`, ramped over `softness` either
 * side of 0.5. For a pixel sitting exactly on the land colour that ratio is 1,
 * which clears the ramp by a mile whatever the gap. What the gap actually buys
 * is headroom against the antialiased pixels ALONG the shoreline, which are
 * blends of the two and land mid-ramp — and against a future palette tweak
 * nudging the pair together without anyone noticing.
 *
 * 0.12 in unit RGB is roughly a 30/255 step across all three channels. Below
 * that, two colours are close enough that a JPEG-grade artefact or a driver's
 * dithering could move a pixel across the halfway line. The narrowest real pair
 * today is Sky's dark theme at 0.218, so this is a floor with room, not a
 * measurement trimmed to fit. */
const MIN_SEPARATION = 0.12;

/* --- the palettes ---------------------------------------------------------- */
section('sea and land are far enough apart to tell apart, in every palette');

/** A world layers its overrides on top of the theme — the same one-line merge
 *  `buildStyle()` does — so this checks the palettes that can actually be on
 *  screen rather than the raw token tables. */
const palettes = [
  ['Sky · dark', DARK],
  ['Sky · light', LIGHT],
  ['Deep · dark', { ...DARK, ...DEEP }],
  ['Deep · light', { ...LIGHT, ...DEEP }],
];

for (const [name, P] of palettes) {
  const d = dist(rgb(P.ocean), rgb(P.landHigh));
  ok(
    d >= MIN_SEPARATION,
    `${name}: ocean ${P.ocean} and landHigh ${P.landHigh} are ${d.toFixed(3)} apart, ` +
      `below the ${MIN_SEPARATION} the shore mask needs`
  );
  console.log(`    ${name.padEnd(13)} ${P.ocean} / ${P.landHigh}  gap ${d.toFixed(3)}`);
}

/* --- the ramp cannot swallow the gap --------------------------------------- */
section('the ramp is narrower than the decision it sits on');

ok(
  SHORE.softness > 0 && SHORE.softness < 0.5,
  `shore.softness is a half-width around 0.5 and must be inside (0, 0.5) (is ${SHORE.softness})`
);

/* A pixel exactly on either anchor scores 0 or 1. The ramp spans
 * 0.5 ± softness, so anything below 0.5 is unreachable by an anchor pixel — the
 * assertion is that the ramp does not reach an anchor, which would make a pure
 * ocean pixel partially dry or a pure land pixel partially wet. */
ok(
  0.5 + SHORE.softness < 1,
  `shore.softness ${SHORE.softness} lets the ramp reach a pure land pixel, which would draw water on it`
);
ok(
  0.5 - SHORE.softness > 0,
  `shore.softness ${SHORE.softness} lets the ramp reach a pure sea pixel, which would fade the open ocean`
);

/* --- the unknown-pixel guard is loose enough for a real shoreline ---------- */
section('the unknown-pixel guard does not reject the coastline it is guarding');

/* A shoreline pixel is a blend of the two anchors, so it lies ON the segment
 * between them. Its distance to the NEARER anchor is at worst half the gap. If
 * `maxDistance` were below that, the guard would reject the antialiased coast
 * itself and the mask would cut a one-pixel gutter along every shore. */
for (const [name, P] of palettes) {
  const half = dist(rgb(P.ocean), rgb(P.landHigh)) / 2;
  ok(
    SHORE.maxDistance > half,
    `${name}: maxDistance ${SHORE.maxDistance} is below half the sea/land gap (${half.toFixed(3)}), ` +
      'so the guard would reject the shoreline pixels themselves'
  );
}

/* --- the exemption for landFaint is still earned --------------------------- */
section('the mask only exists where the land colour is landHigh');

ok(
  VOLCANO.map3d.handoff[0] >= ZOOM.local,
  `the 3D layer fades in at z${VOLCANO.map3d.handoff[0]} and the background reaches landHigh at ` +
    `z${ZOOM.local} — below that the land colour is a blend and the mask's anchor is wrong`
);

/* And the reason the exemption is needed: landFaint really is too close to the
 * ocean to mask against. Asserted so that if a future palette pulls them apart,
 * this note stops claiming a constraint that no longer exists. */
for (const [name, P] of palettes) {
  const d = dist(rgb(P.ocean), rgb(P.landFaint));
  console.log(`    ${name.padEnd(13)} landFaint gap ${d.toFixed(3)} (unmaskable by design)`);
}

/* --- done ------------------------------------------------------------------ */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
