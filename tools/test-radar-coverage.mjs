#!/usr/bin/env node
/**
 * test-radar-coverage.mjs — radar's tile addressing and its coverage states
 * (SPEC §4.9).
 *
 * WHY THIS SUITE EXISTS, AND WHY IT CHANGED SHAPE. Radar was a per-storm disc
 * that measured its own alpha to decide whether it had anything in it. It is a
 * TILE LAYER now, and the two things that measurement used to protect are both
 * gone with it:
 *
 *   1. **Nothing counts pixels any more.** MapLibre draws what arrives. So the
 *      coverage mask is no longer a second opinion about a frame already known
 *      to be blank — it is the ONLY thing standing between an empty screen and
 *      an all-clear over ground nobody watches. Most of this file is about the
 *      sentence that gets built from it.
 *   2. **The tiles template is now a correctness surface.** It carries the frame
 *      every tile in a viewport will name, and MapLibre's `{z}/{x}/{y}`
 *      placeholders have to survive URL encoding intact. Percent-encode a brace
 *      and MapLibre requests a literal `{z}`, every tile 400s, and the layer is
 *      silently blank — over a storm, which is the §5 failure.
 *
 * ==> THE ORDERING IN `radarCoverageMessage` IS THE SAFETY PROPERTY, NOT A
 * STYLE CHOICE. <== A mixed set of storms must be summarised by its WORST
 * member. Reverse two branches and the app reassures somebody about a storm no
 * radar can see, and it would look completely normal on screen.
 *
 * Zero dependencies (§12). No DOM: everything under test is pure, which is why
 * `verdictFor` and `radarCoverageMessage` live outside the canvas and network
 * code that surrounds them.
 *
 * Run: node tools/test-radar-coverage.mjs
 */

import { IMAGERY } from '../config/constants.js';
import { radarTilesTemplate, radarFramesUrl, radarCoverageUrl } from '../lib/imagery.js';
import { verdictFor, radarCoverageMessage } from '../data/radar-coverage.js';

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
 * 1. THE TILES TEMPLATE.
 *
 * MapLibre expands `{z}`, `{x}` and `{y}` itself. They must reach it as literal
 * braces — which is exactly what `URLSearchParams` would destroy, and why the
 * builder concatenates them instead of setting them.
 * ------------------------------------------------------------------------- */
const FRAME = '/v2/radar/c3d7e91014b9';
const tpl = radarTilesTemplate(FRAME, 512);

ok('the template keeps MapLibre’s placeholders unescaped',
  tpl.includes('z={z}') && tpl.includes('x={x}') && tpl.includes('y={y}'), tpl);

ok('no percent-encoded brace survives anywhere in the template',
  !/%7[BbDd]/.test(tpl), tpl);

ok('the template names the frame it was given',
  tpl.includes(encodeURIComponent(FRAME)), tpl);

ok('the template points at the radar relay',
  tpl.startsWith(`${IMAGERY.radar.relay}?`), tpl);

ok('the template carries the pixel size',
  /[?&]px=512(&|$)/.test(tpl), tpl);

/* ==> A TEMPLATE WITHOUT A FRAME WOULD LET EVERY TILE PICK ITS OWN. <== That is
 * the seam-between-two-minutes bug, and it would look like weather rather than
 * like a fault. */
ok('a frame is always present in the template', /[?&]f=[^&]+/.test(tpl), tpl);

eq('the frames route is where the client looks for one',
  radarFramesUrl(), IMAGERY.radar.framesRelay);

/* ---------------------------------------------------------------------------
 * 2. THE COVERAGE URL.
 *
 * Fixed zoom, two decimals. Both are cache-key properties: this string keys the
 * browser cache and Cloudflare's edge, and a coverage answer that moved with the
 * camera would be uncacheable and would give one storm different answers at
 * different zooms.
 * ------------------------------------------------------------------------- */
eq('the mask is asked at the fixed coverage zoom, rounded to two decimals',
  radarCoverageUrl(25.123456, -80.987654, 512),
  `/api/imagery/radar-coverage?lat=25.12&lon=-80.99&z=${IMAGERY.radar.coverageZoom}&px=512`);

eq('a longitude past the dateline is wrapped before it is printed',
  radarCoverageUrl(10, 190, 512),
  `/api/imagery/radar-coverage?lat=10.00&lon=-170.00&z=${IMAGERY.radar.coverageZoom}&px=512`);

eq('two spellings of one coordinate produce one key',
  radarCoverageUrl(25.1234, -80.9876, 512),
  radarCoverageUrl(25.1249, -80.9871, 512));

ok('the coverage zoom is inside what the service publishes',
  Number.isInteger(IMAGERY.radar.coverageZoom) &&
  IMAGERY.radar.coverageZoom >= 0 &&
  IMAGERY.radar.coverageZoom <= IMAGERY.radar.maxTileZoom);

/* ---------------------------------------------------------------------------
 * 3. THE TILE SOURCE'S OWN NUMBERS.
 * ------------------------------------------------------------------------- */
ok('512 px images against a 256 px tile slot — the retina pairing',
  IMAGERY.radar.requestPx === 512 && IMAGERY.radar.tileSize === 256);

/* ==> `maxTileZoom` IS WHAT MAKES ZOOMING IN SAFE. <== Declared to MapLibre as
 * the source's maxzoom, it overzooms above this instead of requesting addresses
 * that do not exist. Without it the layer goes BLANK at close range — over a
 * storm, which reads as no rain. */
eq('the source caps at the deepest zoom RainViewer publishes',
  IMAGERY.radar.maxTileZoom, 7);

/* ==> SMOOTH MUST BE 0, AND NOTHING DOWNSTREAM WOULD CATCH IT NOW. <== Blur
 * invents alpha outside the data. While radar was a disc, the alpha measurement
 * would at least have noticed; a tile layer measures nothing, so this constant
 * is the only guard left between a smoothed tile and haze painted over ground
 * no radar can see. */
eq('smooth is 0', IMAGERY.radar.smooth, 0);

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

ok('the threshold sits above the worst measured real coverage', cut > 0.99,
  `noCoverageFraction is ${cut}`);

/* ---------------------------------------------------------------------------
 * 5. THE WORDING. THE HEART OF THE SUITE.
 *
 * The contract is asymmetric on purpose: this function may report that
 * something is MISSING, and may never report that anything is CLEAR. An empty
 * string is a refusal to comment, not a reassurance.
 * ------------------------------------------------------------------------- */
const says = (v) => radarCoverageMessage(v);

/* ==> NO INPUT MAY EVER PRODUCE A REASSURING SENTENCE. <== The old version had
 * a "showing no rain" branch, which a disc could justify by measuring its own
 * alpha. A tile layer measures nothing, so that sentence lost its evidence and
 * was deleted. This asserts it cannot come back by accident. */
const REASSURING = /no rain|all clear|clear\b|nothing to report/i;
const universe = [
  [], ['covered'], ['none'], ['unknown'], [null],
  ['covered', 'covered'], ['none', 'none'], ['unknown', 'unknown'], [null, null],
  ['none', 'covered'], ['covered', 'none'], ['unknown', 'covered'], ['covered', 'unknown'],
  [null, 'covered'], ['covered', null], ['none', 'unknown'], ['unknown', 'none'],
  ['covered', 'covered', 'none'], ['covered', 'covered', null], ['none', 'unknown', 'covered'],
  ['covered', 'none', 'unknown', null],
];
for (const set of universe) {
  const msg = says(set);
  ok(`${JSON.stringify(set)} never claims anything is clear`,
    !REASSURING.test(msg.replace(/not an all-clear/gi, '')), `said: ${msg}`);
}

/* Silence is only ever earned by a set where every storm is known-covered. */
eq('all covered says nothing', says(['covered', 'covered']), '');
eq('nothing tracked says nothing', says([]), '');
ok('a single unresolved storm breaks the silence', says(['covered', null]) !== '');
ok('a single unwatched storm breaks the silence', says(['covered', 'none']) !== '');

/* Worst-case-first: a `none` anywhere outranks everything else. */
for (const set of [['none', 'covered'], ['none', 'unknown'], ['none', null], ['covered', 'none', 'unknown']]) {
  ok(`${JSON.stringify(set)} leads with the gap`,
    /not an all-clear/.test(says(set)), says(set));
}

/* And a set with no `none` but something unresolved says so rather than
 * guessing in either direction. */
for (const set of [['covered', 'unknown'], ['covered', null], ['unknown'], [null]]) {
  ok(`${JSON.stringify(set)} admits it could not check`,
    /could not check/.test(says(set)), says(set));
}

ok('a non-array is treated as nothing tracked, not as an answer', says(undefined) === '');

/* ==> THE TEST THAT PROVES THIS SUITE CAN FAIL. <== A suite that passes on the
 * same wrong assumption as the bug is worse than no suite. This is the deleted
 * pre-tile sentence; if the reassurance detector above ever stops catching it,
 * every check in section 5 has gone blind. */
ok('the reassurance detector would catch the deleted "no rain" sentence',
  REASSURING.test('Radar is watching and showing no rain near these storms'));

/* ------------------------------------------------------------------------- */

if (failures) {
  console.error(`\n${failures} of ${checked} radar checks failed.\n`);
  process.exit(1);
}
console.log(`✓ radar tiles and coverage states hold: ${checked} checks`);
