/**
 * test-land-mask.mjs — the mask a phone reads, and the chain it feeds.
 * SPEC-SEASONS-BUILD.md §57.7b.
 *
 * ==> THE ONE FAILURE THIS SUITE EXISTS TO CATCH IS A MASK THAT READS FINE AND
 * ANSWERS WRONG. <== A land mask misread by one cell, one row, or one degree of
 * latitude throws no error and produces no obviously bad output. It produces
 * every coastline on Earth shifted sideways, a plausible-looking set of
 * landfalls, and a running season that quietly disagrees with the 175 years
 * printed directly above it. So the checks here are about AGREEMENT — the
 * shipped file against the runner that built it, and the walk over real bytes
 * against places that are actually land.
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { SEASONS } from '../config/constants.js';
import { readLandMask, HEADER_BYTES } from '../lib/land-mask.js';
import { packLandMask } from './land-mask-pack.mjs';
import { buildLandMask } from './land-raster.mjs';
import { landfallsFor } from '../lib/landfall.js';
import { parseBdeck } from '../lib/hurdat.js';
import { stormFacts } from '../lib/season-facts.js';
import { liveRow } from '../lib/wall-index.js';

let passed = 0;
const failures = [];
const ok = (what, cond) => {
  if (cond) { passed++; console.log(`  ok    ${what}`); }
  else { failures.push(what); console.log(`  FAIL  ${what}`); }
};
const eq = (what, got, want) => ok(`${what} — got ${JSON.stringify(got)}`,
  JSON.stringify(got) === JSON.stringify(want));
const section = (t) => console.log(`\n${t}`);
const throws = (what, fn, re) => {
  try { fn(); ok(`${what} — but nothing was thrown`, false); }
  catch (e) { ok(`${what} ("${e.message.slice(0, 60)}")`, re.test(e.message)); }
};

const box = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];

/* --- 1. pack and read are inverses ---------------------------------------- */

section('1. ==> WHAT THE RASTERISER SAYS IS LAND, THE PACKED FILE SAYS IS LAND <==');

/* A shape with a hole in it, so the even-odd fill has something to get wrong,
 * at a coarse step because this is about the FORMAT rather than the coastline. */
const CONTINENT = box(-40, 10, -20, 30);
const LAKE = box(-34, 16, -26, 24);
const opts = { step: 0.1, latMin: -60, latMax: 72 };
const built = buildLandMask([CONTINENT, LAKE], opts);
const coarse = { step: opts.step, latMin: opts.latMin };
const rebuilt = readLandMask(packLandMask(built), { expect: coarse });

eq('the geometry survives the round trip',
  [rebuilt.width, rebuilt.height, rebuilt.step, rebuilt.latMin],
  [built.width, built.height, built.step, built.latMin]);

/* ==> EVERY CELL, NOT A SAMPLE. <== A bit-packing bug is an OFF-BY-ONE, and an
 * off-by-one is invisible to a sample that happens to skip the boundary. This
 * grid is small enough to check exhaustively, so it is checked exhaustively. */
let disagree = 0;
for (let row = 0; row < built.height; row++) {
  const lat = built.latMin + (row + 0.5) * built.step;
  for (let col = 0; col < built.width; col++) {
    const lon = -180 + (col + 0.5) * built.step;
    if (built.isLand(lon, lat) !== rebuilt.isLand(lon, lat)) disagree++;
  }
}
eq(`all ${built.cells.toLocaleString()} cells agree`, disagree, 0);

ok('the land is land', rebuilt.isLand(-38, 12) && rebuilt.isLand(-22, 28));
ok('the lake inside it is not', !rebuilt.isLand(-30, 20));
ok('and the ocean outside it is not', !rebuilt.isLand(-60, 20));

/* --- 2. a bad file is loud, never quietly wrong --------------------------- */

section('2. ==> A MASK THAT CANNOT BE TRUSTED THROWS RATHER THAN ANSWERING <==');

throws('a truncated download is refused',
  () => readLandMask(new Uint8Array(8), { expect: coarse }), /too short/);

const wrongMagic = packLandMask(built);
wrongMagic[0] ^= 0xff;
throws('a file that is not a mask is refused',
  () => readLandMask(wrongMagic, { expect: coarse }), /LFM1/);

const chopped = packLandMask(built).slice(0, -10);
throws('a file shorter than its own header claims is refused',
  () => readLandMask(chopped, { expect: coarse }), /header describes/);

/* ==> AND A MASK BUILT AT A DIFFERENT CELL SIZE IS REFUSED RATHER THAN USED.
 * <== This is the silent-wrong-answer case. The 0.1° mask above is a perfectly
 * valid file; read against 0.02° constants it would place every coastline five
 * times too far from the equator and still return clean booleans. */
throws('a mask whose geometry disagrees with this build is refused',
  () => readLandMask(packLandMask(built)), /rebuild it/);

/* --- 3. the file actually shipped ---------------------------------------- */

section('3. The mask in the repo is the one the constants describe');

const shippedGz = readFileSync(new URL(`..${SEASONS.landfallMaskUrl}`, import.meta.url));
ok(`it is committed gzipped (${(shippedGz.length / 1e6).toFixed(2)} MB)`,
  shippedGz[0] === 0x1f && shippedGz[1] === 0x8b);

/* ==> THE WIRE COST IS ASSERTED, BECAUSE IT IS THE WHOLE REASON THIS APPROACH
 * WAS CHOSEN. <== 0.30 MB measured 2026-08-28. A change that quietly took it
 * to five would be a change to what the phone pays on opening the archive, and
 * it should have to come past a red test. The ceiling is generous rather than
 * tight: this is a tripwire, not a budget. */
ok(`and it is under a megabyte on the wire (${(shippedGz.length / 1e6).toFixed(2)} MB)`,
  shippedGz.length < 1e6);

const shipped = readLandMask(gunzipSync(shippedGz));
eq('its cell size is the constant',
  [shipped.step, shipped.latMin, shipped.latMax],
  [SEASONS.landfallMaskStep, SEASONS.landfallMaskLatMin, SEASONS.landfallMaskLatMax]);

/* Places chosen to be unambiguous at 2.2 km: well inland, or well offshore. */
ok('Kansas is land', shipped.isLand(-98, 38.5));
ok('the Sahara is land', shipped.isLand(10, 25));
ok('the middle of the North Atlantic is not', !shipped.isLand(-40, 35));
ok('the middle of the Pacific is not', !shipped.isLand(-150, 10));
ok('and a longitude needing two wraps still lands in Kansas',
  shipped.isLand(-98 + 720, 38.5));

/* --- 4. real live bytes, all the way to the wall row ---------------------- */

section('4. ==> THE RUNNING SEASON, WALKED OVER REAL b-deck BYTES <==');

/* ==> NOT A FIXTURE. <== These are NHC's own 2026 working best tracks as
 * committed to `samples/seasons/bdecks/`. Invented track data has passed over
 * broken code in this project before; the whole point of this suite is that the
 * answers are checkable against geography. */
const bdeck = (f) => parseBdeck(
  readFileSync(new URL(`../samples/seasons/bdecks/${f}.dat`, import.meta.url), 'utf8'),
  { id: f.slice(1).toUpperCase() },
).storm;

const storms = ['bal012026', 'bal022026', 'bcp012026', 'bep062026'].map(bdeck);
ok('all four sample storms parse', storms.every(Boolean));

/* The walk reads `lonU`, `lat`, `time`, `status` and `windKt`. A live track
 * missing any of them would return silently wrong answers rather than fail. */
ok('every live track point carries what the walk reads',
  storms.every((s) => (s.points || []).every((p) => Number.isFinite(p.lonU)
    && Number.isFinite(p.lat) && Number.isFinite(p.time) && typeof p.status === 'string')));

for (const s of storms) s.landfallsComputed = landfallsFor(s.points || [], shipped.isLand);

const named = Object.fromEntries(storms.map((s) => [s.name, s.landfallsComputed]));
ok(`Arthur came ashore (${named.ARTHUR.length})`, named.ARTHUR.length > 0);
ok(`Bertha came ashore (${named.BERTHA.length})`, named.BERTHA.length > 0);
ok('Lala stayed at sea', named.LALA.length === 0);
ok('Fausto stayed at sea', named.FAUSTO.length === 0);

/* Geography, not a recorded number: Arthur's landfall must be ON the land the
 * mask describes, and in the western Gulf where its track actually goes. */
const arthur = named.ARTHUR[0];
ok(`Arthur's landfall point is on land (${arthur.lat.toFixed(1)}, ${arthur.lon.toFixed(1)})`,
  shipped.isLand(arthur.lon, arthur.lat));
ok('and it is on the Gulf coast rather than somewhere impossible',
  arthur.lat > 20 && arthur.lat < 35 && arthur.lon > -100 && arthur.lon < -80);

section('5. ==> AND THE ROW SAYS IT KNOWS ONLY WHEN IT DOES <==');

const facts = storms.map(stormFacts).filter(Boolean);
eq('every storm is stamped computed', [...new Set(facts.map((f) => f.landfallSource))], ['computed']);

const row = liveRow({ year: 2026, facts, running: new Set() });
ok('the row knows its landfalls', row.landfallsKnown === true);
eq('and counts the storms that came ashore, not the crossings', row.landfalls, 2);
eq('the dots carry the flag', row.shown.map((r) => r[1]), [1, 1, 0, 0]);

/* ==> THE FAILURE PATH IS A FIRST-CLASS CASE (§5). <== A mask that never
 * arrives must leave the row saying "not recorded yet". The bug this guards is
 * the comfortable one: fall back to NOAA's markers, find none — because the
 * working best track carries none (§57.18b) — and report that nothing came
 * ashore this year. That is a claim, and it would be wrong twice over here. */
for (const s of storms) delete s.landfallsComputed;
const bare = liveRow({ year: 2026, facts: storms.map(stormFacts).filter(Boolean), running: new Set() });
ok('without the mask the row does NOT claim to know', bare.landfallsKnown === false);
eq('and claims no landfalls either way', bare.landfalls, 0);
eq('so no dot is marked', bare.shown.map((r) => r[1]), [0, 0, 0, 0]);

console.log(`\ntest-land-mask: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
