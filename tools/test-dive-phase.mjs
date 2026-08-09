#!/usr/bin/env node
/**
 * test-dive-phase.mjs — THE DIVE CROSSFADE MUST NOT MOVE WHEN YOU ONLY SPIN.
 *
 * ==> THE BUG THIS EXISTS TO STOP COMING BACK. <==
 *
 * MapLibre's globe projection draws the planet at a pixel radius of
 * `worldSize / (2π · cos(latitude))`. At a fixed zoom NUMBER the globe would
 * swell as the centre nears a pole, so MapLibre hides that by rewriting the
 * zoom on every camera move: `handleMapControlsPan`, `handleJumpToCenterZoom`
 * (where `map.setCenter` lands), `handleEaseTo` and `handleFlyTo` each end
 * with `setZoom(oldZoom + log2(cos(newLat) / cos(oldLat)))`. Verified by
 * reading `vendor/maplibre-gl-5.6.0.js`, not assumed.
 *
 * `globe3d.js` fed that number straight into `divePhase`, whose whole band is
 * three zoom levels wide. Equator to 60° is a full level, so spinning north
 * slid the crossfade by a THIRD — cage, nodes, storm glyphs and the basemap's
 * opacity all moved with no gesture behind them.
 *
 * WHAT THIS CAN AND CANNOT PROVE. It CAN prove the arithmetic is latitude-
 * invariant, and it CAN prove no dive-path file has gone back to reading
 * `map.getZoom()` raw — that second half is the one that actually fails if
 * someone reverts a line. It CANNOT prove the fade looks right on a phone.
 * That stays glass.
 *
 * ZERO DEPENDENCIES. Plain `node tools/test-dive-phase.mjs`.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

const { equatorZoom, divePhase } = await import('../map/globe-follow.js');
const { DIVE } = await import('../config/constants.js');

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

/* A map stub that pans the way MapLibre's globe camera helper really pans:
 * move the centre, then rewrite the zoom by MapLibre's own term. If MapLibre
 * ever stops doing this, the "the raw read really did drift" case below goes
 * red and tells us to come back here. */
function fakeGlobeMap(lng, lat, zoom) {
  const cos = (d) => Math.cos((d * Math.PI) / 180);
  return {
    getZoom: () => zoom,
    getCenter: () => ({ lng, lat }),
    panTo(nextLng, nextLat) {
      zoom += Math.log2(cos(nextLat) / cos(lat));
      lng = nextLng;
      lat = nextLat;
      return this;
    },
  };
}

const naiveDive = (map) => divePhase(map.getZoom());
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* --- the normalised number holds across a pole-ward spin ------------------ */
section('equatorZoom is latitude-invariant under a pure spin');

for (const lat of [0, 15, 30, 45, 60, 75, 85]) {
  const map = fakeGlobeMap(0, 0, 3.5);
  const before = equatorZoom(map);
  map.panTo(40, lat);
  ok(
    near(equatorZoom(map), before, 1e-9),
    `spin to ${lat}°N holds equatorZoom (${before.toFixed(4)} → ${equatorZoom(map).toFixed(4)})`
  );
}

/* Southern hemisphere is the same problem mirrored — the fix clamps on
 * Math.abs(lat), and a sign slip there would only show up below the equator. */
for (const lat of [-30, -60, -85]) {
  const map = fakeGlobeMap(0, 0, 3.5);
  const before = equatorZoom(map);
  map.panTo(-120, lat);
  ok(near(equatorZoom(map), before, 1e-9), `spin to ${Math.abs(lat)}°S holds equatorZoom`);
}

/* --- and so does the crossfade it drives ---------------------------------- */
section('divePhase(equatorZoom) holds; the raw read does NOT');

{
  const map = fakeGlobeMap(0, 0, 3.5);
  const fixedBefore = divePhase(equatorZoom(map));
  const naiveBefore = naiveDive(map);
  map.panTo(0, 60);

  ok(near(divePhase(equatorZoom(map)), fixedBefore), 'normalised p is unchanged at 60°');

  /* THE BUG, MEASURED. A full zoom level across a three-level band is a third
   * of the entire handoff. This assertion is what stops the fix being quietly
   * deleted as unnecessary: if MapLibre ever stops rewriting the zoom, this
   * goes red and the normalisation can be reconsidered on evidence. */
  const drift = Math.abs(naiveDive(map) - naiveBefore);
  const band = DIVE.zHandoff - DIVE.zSpace;
  ok(drift > 0.3, `raw map.getZoom() drifts p by ${drift.toFixed(3)} at 60° — the bug`);
  ok(near(drift, 1 / band, 1e-9), `and that drift is exactly one zoom level / ${band}`);
}

/* --- the pole guard ------------------------------------------------------- */
section('no Infinity at the latitude ceiling');

{
  const map = fakeGlobeMap(0, 89.9, 3.5);
  ok(Number.isFinite(equatorZoom(map)), 'equatorZoom stays finite past MapLibre\'s clamp');
  ok(Number.isFinite(divePhase(equatorZoom(map))), 'and so does p');
}

/* --- the reversion guard: no dive-path file may read the zoom raw --------- *
 * The arithmetic above passes whether or not the app calls it. THIS is the
 * half that fails when someone puts `map.getZoom()` back. */
section('no dive-path file reads map.getZoom() raw');

const DIVE_PATH = [
  'map/globe3d.js',
  'map/globe.js',
  'map/marker-home.js',
];

/* globe.js legitimately reads the raw zoom in the +/- key handlers: those
 * hand a number straight back to map.zoomTo(), MapLibre's own units, and
 * normalising there would break the keyboard step. Allow those two lines by
 * their exact shape and nothing else. */
const ALLOWED = /map\.zoomTo\(map\.getZoom\(\) [+-] GLOBE\.keyZoomStep\)/;

for (const file of DIVE_PATH) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const offenders = [];
  lines.forEach((line, i) => {
    if (line.trim().startsWith('*')) return;         // prose, not code
    if (!line.includes('map.getZoom()')) return;
    if (ALLOWED.test(line)) return;
    offenders.push(`${file}:${i + 1}`);
  });
  ok(offenders.length === 0, `${file} has no raw zoom read (${offenders.join(', ')})`);
}

console.log('');
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log(`\n✗ ${failures.length} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`✓ ${pass} assertions passed`);
console.log('  (arithmetic + a source scan — how the fade LOOKS is glass)');
