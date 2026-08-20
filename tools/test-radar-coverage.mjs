#!/usr/bin/env node
/**
 * test-radar-coverage.mjs — radar's geometry and its three coverage states
 * (SPEC §4, §4.9).
 *
 * WHY THIS SUITE EXISTS. Wave 6 replaced NOAA with RainViewer, and in doing so
 * replaced the two things that decided what a blank radar frame MEANS:
 *
 *   1. A WMS took any rectangle we asked for. RainViewer takes a ZOOM, which is
 *      a power of two, so the radius the user asked for has to be turned into a
 *      whole zoom and the leftover trimmed with the feather. Get that wrong and
 *      the disc is drawn at the wrong size on the globe — real weather in the
 *      wrong place, with nothing on screen to say so.
 *   2. Coverage was a hand-written bounding box. It is now a mask, with THREE
 *      states rather than two, and the third one exists entirely to stop the
 *      app saying "clear" about ground nobody is watching.
 *
 * ==> THE ORDERING IN `radarEmptyMessage` IS THE SAFETY PROPERTY, NOT A STYLE
 * CHOICE, AND MOST OF THIS FILE IS ABOUT IT. <== A mixed set of discs must be
 * summarised by its WORST member. Reverse two branches and the app tells
 * somebody the radar is clear over a storm no radar can see, which is exactly
 * the §5 failure this project treats as the worst thing it can ship — and it
 * would look completely normal on screen.
 *
 * Zero dependencies (§12). No DOM: everything under test is a pure function,
 * which is why `verdictFor` and `radarEmptyMessage` were split out of the
 * canvas and network code that surrounds them.
 *
 * Run: node tools/test-radar-coverage.mjs
 */

import { IMAGERY } from '../config/constants.js';
import { radarZoomFor, radarHalfKm, radarBox, radarUrl, radarCoverageUrl } from '../lib/imagery.js';
import { verdictFor, radarEmptyMessage } from '../data/radar-coverage.js';

let failures = 0;
let checked = 0;

const ok = (label, cond, detail = '') => {
  checked++;
  if (cond) return;
  failures++;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
};

const eq = (label, actual, expected) =>
  ok(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

/* ---------------------------------------------------------------------------
 * 1. THE ZOOM ALWAYS COVERS WHAT WAS ASKED FOR.
 *
 * The one property that must hold everywhere: whatever radius the slider is
 * set to, at whatever latitude a storm sits, the frame that comes back has to
 * contain that radius. A zoom one step too sharp crops real rainbands off the
 * edge of the picture and the app has no way to know it happened.
 *
 * Walked across the slider's whole declared range and every latitude a cyclone
 * can reach, rather than at three convenient points — the failure mode here is
 * an off-by-one at a boundary, and boundaries are what a sparse test misses.
 * ------------------------------------------------------------------------- */
const { min: rMin, max: rMax, step: rStep } = IMAGERY.tuning.radiusKm;

for (let lat = -60; lat <= 60; lat += 5) {
  for (let r = rMin; r <= rMax; r += rStep) {
    const z = radarZoomFor(lat, r);
    const half = radarHalfKm(lat, z);
    ok(
      `z${z} covers ${r} km at ${lat}°`,
      half >= r - 1e-9,
      `half-extent is ${half.toFixed(1)} km, needed ${r} km`,
    );
  }
}

/* AND IT IS THE SHARPEST ZOOM THAT DOES. Covering is half the requirement;
 * always returning zoom 0 would satisfy the loop above and hand back a picture
 * of the whole planet for a 300 km disc. */
for (let lat = -60; lat <= 60; lat += 15) {
  for (let r = rMin; r <= rMax; r += 100) {
    const z = radarZoomFor(lat, r);
    if (z >= IMAGERY.radar.maxZoom) continue;
    ok(
      `z${z} is the sharpest that covers ${r} km at ${lat}°`,
      radarHalfKm(lat, z + 1) < r,
      `z${z + 1} would also have covered it (${radarHalfKm(lat, z + 1).toFixed(1)} km)`,
    );
  }
}

/* Clamped at both ends, and never NaN. A NaN zoom prints into a URL as the
 * string "NaN", which the relay rejects with a 400 — a failure, but a confusing
 * one, and only after a round trip. */
ok('a zero radius clamps rather than dividing by zero',
  radarZoomFor(0, 0) === IMAGERY.radar.maxZoom);
ok('a negative radius clamps rather than returning NaN',
  radarZoomFor(0, -50) === IMAGERY.radar.maxZoom);
ok('an absurdly large radius clamps to minZoom',
  radarZoomFor(0, 500000) === IMAGERY.radar.minZoom);
for (let lat = -85; lat <= 85; lat += 5) {
  const z = radarZoomFor(lat, 900);
  ok(`zoom at ${lat}° is a whole number in range`,
    Number.isInteger(z) && z >= IMAGERY.radar.minZoom && z <= IMAGERY.radar.maxZoom,
    `got ${z}`);
}

/* Known reference points, from §4.9's measured table. These are the numbers
 * the spec quotes to Aaron, so they are the numbers that have to stay true. */
ok('z5 is ±626 km at the equator', Math.abs(radarHalfKm(0, 5) - 626) < 2, `${radarHalfKm(0, 5).toFixed(1)}`);
ok('z6 is ±313 km at the equator', Math.abs(radarHalfKm(0, 6) - 313) < 2, `${radarHalfKm(0, 6).toFixed(1)}`);
ok('z4 is ±1252 km at the equator', Math.abs(radarHalfKm(0, 4) - 1252) < 3, `${radarHalfKm(0, 4).toFixed(1)}`);

/* ---------------------------------------------------------------------------
 * 2. THE RIM FRACTION IS THE LEFTOVER, AND IT IS NEVER MORE THAN ALL OF IT.
 *
 * Above 1 the feather would be told to fade at a radius outside the image,
 * where there are no pixels — the rim would land nowhere, the disc would draw
 * to a hard square edge, and `keptFraction` would be measured across pixels
 * that were never painted.
 * ------------------------------------------------------------------------- */
for (let lat = -60; lat <= 60; lat += 10) {
  for (let r = rMin; r <= rMax; r += 100) {
    const z = radarZoomFor(lat, r);
    const { rimFraction } = radarBox(lat, 0, z, r);
    ok(`rim fraction is a usable fraction at ${lat}° / ${r} km`,
      rimFraction > 0 && rimFraction <= 1,
      `got ${rimFraction}`);
    /* And it describes the ACTUAL ratio, not a placeholder. A stubbed 1 would
     * pass the bounds check above while silently drawing every disc at the full
     * frame size. */
    ok(`rim fraction matches the geometry at ${lat}° / ${r} km`,
      Math.abs(rimFraction - Math.min(1, r / radarHalfKm(lat, z))) < 1e-9);
  }
}

/* The box is centred on the storm and square in projected metres. The corners
 * come back clockwise from top-left, same contract as `discBox`. */
{
  const { corners } = radarBox(25, -80, 5, 900);
  const [tl, tr, br, bl] = corners;
  ok('corners run clockwise from top-left', tl[0] === bl[0] && tr[0] === br[0] && tl[1] === tr[1] && bl[1] === br[1]);
  ok('the box is centred on the storm in longitude', Math.abs((tl[0] + tr[0]) / 2 - -80) < 1e-9);
  ok('north is above south', tl[1] > bl[1]);
}

/* ---------------------------------------------------------------------------
 * 3. THE URLS ARE STABLE CACHE KEYS.
 *
 * This string keys three separate caches — the browser's, the frame LRU, and
 * Cloudflare's edge. Two spellings of the same request is two downloads of the
 * same bytes, which on a free service that blocks abusive IPs is not a
 * cosmetic problem.
 * ------------------------------------------------------------------------- */
eq('radar URL is fixed to two decimals and stable in order',
  radarUrl(25.123456, -80.987654, 4, 512),
  '/api/imagery/radar?lat=25.12&lon=-80.99&z=4&px=512');

eq('the mask URL mirrors it exactly, on its own route',
  radarCoverageUrl(25.123456, -80.987654, 4, 512),
  '/api/imagery/radar-coverage?lat=25.12&lon=-80.99&z=4&px=512');

eq('a longitude past the dateline is wrapped before it is printed',
  radarUrl(10, 190, 5, 512),
  '/api/imagery/radar?lat=10.00&lon=-170.00&z=5&px=512');

eq('two spellings of the same coordinate produce one key',
  radarUrl(25.1234, -80.9876, 4, 512),
  radarUrl(25.1249, -80.9871, 4, 512));

/* ---------------------------------------------------------------------------
 * 4. THE MASK THRESHOLD.
 * ------------------------------------------------------------------------- */
const cut = IMAGERY.radar.noCoverageFraction;

eq('a fully opaque box has no radar in it', verdictFor(1), 'none');
eq('a fully transparent box is covered', verdictFor(0), 'covered');
eq('Miami’s measured 0.07 reads as covered', verdictFor(0.07), 'covered');
eq('Madagascar’s measured 0.99 reads as covered, not as none', verdictFor(0.99), 'covered');
eq('exactly at the cut is none', verdictFor(cut), 'none');
eq('a hair under the cut is covered', verdictFor(cut - 1e-6), 'covered');
/* NaN is what a zero-pixel image or a division by an empty total produces, and
 * it must not fall through to the reassuring branch. */
eq('a nonsense fraction is unknown, never covered', verdictFor(NaN), 'unknown');

/* ==> THE THRESHOLD MUST LEAVE ROOM ABOVE THE WORST REAL COVERAGE. <== 0.99 is
 * a real measured box with real radar in it (Madagascar). A cut at or below it
 * would call that box empty and suppress the honest wording. */
ok('the threshold sits above the worst measured real coverage', cut > 0.99,
  `noCoverageFraction is ${cut}`);

/* ---------------------------------------------------------------------------
 * 5. THE WORDING, WORST-CASE-FIRST. THE HEART OF THE SUITE.
 * ------------------------------------------------------------------------- */
const says = (verdicts) => radarEmptyMessage(verdicts);
const isAllClear = (msg) => /showing no rain/.test(msg);
const admitsAGap = (msg) => /not an all-clear|could not check/.test(msg);

ok('every disc covered — and only then — may say there is no rain',
  isAllClear(says(['covered', 'covered'])));

ok('every disc uncovered names the gap',
  admitsAGap(says(['none', 'none'])) && !isAllClear(says(['none', 'none'])));

/* ==> THE MIXED CASES. EVERY ONE OF THESE IS A WAY TO ACCIDENTALLY SHIP AN
 * ALL-CLEAR. <== */
const mixed = [
  ['none', 'covered'],
  ['covered', 'none'],
  ['unknown', 'covered'],
  ['covered', 'unknown'],
  [null, 'covered'],
  ['covered', null],
  ['covered', 'covered', 'none'],
  ['covered', 'covered', null],
  ['none', 'unknown', 'covered'],
];
for (const set of mixed) {
  const msg = says(set);
  ok(`a mixed set ${JSON.stringify(set)} never reads as an all-clear`,
    !isAllClear(msg), `said: ${msg}`);
  ok(`a mixed set ${JSON.stringify(set)} says what is missing`,
    admitsAGap(msg), `said: ${msg}`);
}

/* A 'none' anywhere outranks an 'unknown' anywhere — a known gap is a stronger
 * statement than an unmeasured one and should be the sentence shown. */
ok('a known gap beats an unmeasured one in the wording',
  /no radar watching them/.test(says(['none', 'unknown'])), says(['none', 'unknown']));

/* Nothing to summarise is not an all-clear either. An empty array reaches here
 * when every disc was dropped between the check and the render. */
ok('an empty set is not an all-clear', !isAllClear(says([])));
ok('a non-array is not an all-clear', !isAllClear(says(undefined)));

/* ==> AND THE TEST THAT PROVES THIS SUITE CAN FAIL. <== A suite that passes on
 * the same wrong assumption as the bug is worse than no suite. This reproduces
 * the OLD behaviour — one sentence for every blank frame, chosen without
 * consulting the mask — and asserts that it would be caught. If this ever
 * stops failing, the checks above have gone blind. */
const oldBehaviour = () => 'Radar is watching and showing no rain near these storms';
ok('the suite would catch a regression to the single-sentence behaviour',
  isAllClear(oldBehaviour(['none', 'covered'])) === true && !isAllClear(says(['none', 'covered'])),
  'the mixed-set checks above would not have detected the pre-Wave-6 wording');

/* ------------------------------------------------------------------------- */

if (failures) {
  console.error(`\n${failures} of ${checked} radar coverage checks failed.\n`);
  process.exit(1);
}
console.log(`✓ radar geometry and coverage states hold: ${checked} checks`);
