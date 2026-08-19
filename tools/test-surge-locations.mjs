#!/usr/bin/env node
/**
 * test-surge-locations.mjs — §51's acceptance cases against real bytes.
 *
 * WHAT THIS IS FOR. §51 has three traps that all PARSE and none of which
 * throws, which is the same reason `test-rainfall.mjs` exists:
 *
 *   1. THE FIRST FEATURE IS NOT A TOWN. Every export opens with a header
 *      feature at the storm's own position carrying `city: null`. Kept, it
 *      renders as an unnamed place in the ocean with no height.
 *   2. `-1` IS AN ABSENCE, NOT A SMALL NUMBER. A negative water height summed
 *      or coloured produces a plausible figure under somebody's house.
 *   3. NEAREST HAS TO HAVE A CEILING. Lala's 47 towns cover the Big Island,
 *      Maui, Molokai and Oahu — and NOT Kauai. Nearest-with-no-ceiling hands a
 *      Lihue house a town 150 km away across open ocean and states it as that
 *      house's forecast.
 *
 * Every figure below is computed from bytes GDACS actually served, fetched by
 * the hourly archive runner on 2026-08-19 and copied into
 * `samples/surge-locations/`. Three storms on purpose: Lala is NOAA-sourced
 * with 47 towns, Saudel is JTWC-sourced with 2, and Hernán is mid-ocean with
 * none — which is the `none_matched` path and the only one of the three that
 * may be worded as an all-clear.
 *
 * ==> EVERY ASSERTION HERE WAS VERIFIED TO FAIL WITH THE RULE BROKEN. <==
 * SPEC §12: a test that passes on the same wrong assumption as the bug is
 * worse than no test. The mutations run were — dropping the `city` guard in
 * `projectLocations`, changing `<= NO_HEIGHT` to `< 0`, removing the radius
 * test in `nearestPlace`, and returning `state: 'none_matched'` for the
 * out-of-range case. Each broke at least one line below.
 *
 * Zero dependencies. Run: node tools/test-surge-locations.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'samples/surge-locations');

const {
  surgeRung, surgeColor, formatSurgeHeight, nearestPlace, surgeAtHome,
  kmBetween, gdacsEventIdOf,
} = await import(path.join(ROOT, 'lib/surge-locations.js'));
const { projectLocations, locationsUrl, hoursFrom } =
  await import(path.join(ROOT, 'functions/api/gdacs/surge.js'));
const { GDACS_SURGE } = await import(path.join(ROOT, 'config/constants.js'));

let failures = 0;
const ok = (label) => console.log(`  \u2713 ${label}`);
const fail = (label, detail) => {
  failures++;
  console.error(`  \u2717 ${label}${detail ? `\n      ${detail}` : ''}`);
};
const truthy = (label, v) => (v ? ok(label) : fail(label, `expected truthy, got ${JSON.stringify(v)}`));
const falsy = (label, v) => (!v ? ok(label) : fail(label, `expected falsy, got ${JSON.stringify(v)}`));
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  a === e ? ok(label) : fail(label, `expected ${e}\n      actual   ${a}`);
};
const close = (label, actual, expected, tol = 0.5) =>
  Math.abs(actual - expected) < tol
    ? ok(label)
    : fail(label, `expected ${expected}\n      actual   ${actual}`);

const load = (name) => JSON.parse(readFileSync(path.join(SAMPLES, `${name}.json`), 'utf8'));

/** A raw export → the shape the client actually receives, through the relay's
 *  own projection. Testing the client against RAW bytes would test a payload
 *  no phone ever sees; testing the projection alone would leave the seam
 *  between them unexercised. This runs both. */
const relayed = (name) => projectLocations(load(name));

/* ---------------------------------------------------------------------------
 * THE RELAY PROJECTION
 * ------------------------------------------------------------------------- */
console.log('\nrelay projection — the header feature and the sentinel');

const lala = relayed('getlocations-lala-1001303');
const saudel = relayed('getlocations-saudel-1001305');
const hernan = relayed('getlocations-hernan-1001304');

/* The raw file has 48 features and 47 of them are towns. If the header ever
 * survives the projection, this is the line that says so. */
eq('lala: 48 raw features become 47 towns', lala.placeCount, 47);
eq('saudel: 3 raw features become 2 towns', saudel.placeCount, 2);
eq('hernan: header alone becomes zero towns', hernan.placeCount, 0);

falsy(
  'no projected town is missing a name',
  lala.places.some((p) => !p.city) || saudel.places.some((p) => !p.city)
);

/* Deepest first — the home matcher and the layer both rely on `places[0]`
 * being the storm's worst, and nothing downstream re-sorts. */
eq('lala sorts deepest first', lala.places[0].city, 'Hookena');
eq('lala deepest height', lala.places[0].heightM, 0.17);
eq('saudel deepest height', saudel.places[0].heightM, 0.48);

truthy(
  'lala heights descend',
  lala.places.every((p, i) => i === 0 || lala.places[i - 1].heightM >= p.heightM)
);

/* ==> THE UNIT IS METRES AND THE WHOLE ARCHIVE IS SUB-METRE. <== This is the
 * assertion behind the separate ramp. If it ever fails because a real typhoon
 * produced two metres, the ramp is already open-ended at the top and the fix
 * is to delete this line, not to widen a bucket. */
truthy(
  'every archived height is below one metre',
  [...lala.places, ...saudel.places].every((p) => p.heightM > 0 && p.heightM < 1)
);

/* Coordinates survive as numbers — they arrive as padded strings. */
close('lala Hookena latitude', lala.places[0].lat, 19.38306, 0.0001);
close('lala Hookena longitude', lala.places[0].lon, -155.900833, 0.0001);

/* The offsets. Saudel's Shomushon reads "87:00" and "93:00" — hours from the
 * storm's FIRST bulletin, not clock times. */
eq('saudel arrival offset parses to hours', saudel.places[0].arrivalHours, 87);
eq('saudel peak offset parses to hours', saudel.places[0].peakHours, 93);
eq('hoursFrom handles a half hour', hoursFrom('12:30'), 12.5);
eq('hoursFrom rejects a clock time', hoursFrom('2026-08-19T12:00'), null);
eq('hoursFrom rejects an empty value', hoursFrom(''), null);

/* ==> A NON-GDACS URL IS NEVER FOLLOWED. <== This route takes an event id off
 * the open internet and then fetches a URL found inside somebody else's JSON.
 * Without the host test it is a request forwarder. */
eq(
  'locationsUrl finds the real export',
  locationsUrl(load('eventdata-lala-1001303')),
  'https://www.gdacs.org/gdacsapi/api/export/getlocations?id=782843'
);
eq(
  'locationsUrl refuses a foreign host',
  locationsUrl({ properties: { impacts: [{ resource: { locations: 'https://evil.example/x' } }] } }),
  null
);
eq('locationsUrl on a record with no impacts', locationsUrl({ properties: {} }), null);

/* The sentinel. Hernán's card carries `-1`; a town carrying it must not become
 * a town with a small surge. */
eq(
  'a sentinel height is dropped, not shown as zero',
  projectLocations({
    features: [{ properties: { city: 'Nowhere', maxheight: '-1', latitude: '1', longitude: '1' } }],
  }).placeCount,
  0
);

/* ---------------------------------------------------------------------------
 * THE RAMP
 * ------------------------------------------------------------------------- */
console.log('\nthe ramp — its own scale, not NHC\u2019s');

eq('0.05 m is the bottom rung', surgeRung(0.05), 0);
eq('0.3 m is the second rung', surgeRung(0.3), 1);
eq('0.75 m is the third rung', surgeRung(0.75), 2);
eq('1.5 m is the fourth rung', surgeRung(1.5), 3);
eq('4 m lands on the open top rung', surgeRung(4), 4);
eq('a missing height has no rung', surgeRung(null), null);
eq('a missing height has no colour', surgeColor(NaN), null);

/* ==> THE POINT OF THE SEPARATE RAMP, ASSERTED. <== Lala's deepest and
 * Saudel's deepest must NOT be the same colour. On NHC's ramp they would both
 * be blue — every observation this product has ever made sits under its bottom
 * rung of "up to 3 ft" — and the globe would show one colour for the whole
 * planet outside America. */
truthy(
  'the archive\u2019s two deepest storms are different colours',
  surgeColor(lala.places[0].heightM) !== surgeColor(saudel.places[0].heightM)
);

/* Formatting goes through the app's one surge formatter, in the reader's own
 * units — never dual-printed. */
eq('0.48 m in metric', formatSurgeHeight(0.48, 'metric'), '0.5 m');
eq('0.48 m in imperial', formatSurgeHeight(0.48, 'imperial'), '2 ft');
eq('a negligible height gets no figure', formatSurgeHeight(0.04, 'metric'), null);
eq('a missing height gets no figure', formatSurgeHeight(null, 'metric'), null);
truthy('the negligible floor is the constant, not a literal', GDACS_SURGE.negligibleM === 0.1);

/* ---------------------------------------------------------------------------
 * NEAREST, AND ITS CEILING
 * ------------------------------------------------------------------------- */
console.log('\nnearest town — the ceiling is the whole safety property');

/* Hilo, on the windward side of the Big Island. Lala models it directly. */
const hiloHome = { lat: 19.7177, lon: -155.0829 };
const atHilo = nearestPlace(lala.places, hiloHome);
truthy('a Hilo house finds a town', atHilo);
eq('and it is Hilo itself', atHilo.place.city, 'Hilo');
truthy('at essentially zero distance', atHilo.km < 1);

/* ==> A HONOLULU HOUSE **IS** COVERED, AND FINDING THAT OUT KILLED THE FIRST
 * VERSION OF THIS SUITE. <== It asserted that Oahu was out of range, on the
 * assumption that Lala's towns were Big Island only. The bytes disagree: 41 of
 * the 47 are on the Big Island, four are on Molokai and Maui, and two are on
 * Oahu — Kailua sits 15.8 km from this house. The assertion was wrong, not the
 * code, which is the whole reason this suite runs against real bytes. */
const honoluluHome = { lat: 21.3069, lon: -157.8583 };
const atHonolulu = nearestPlace(lala.places, honoluluHome);
truthy('a Honolulu house is covered after all', atHonolulu);
eq('by Kailua on the windward side', atHonolulu.place.city, 'Kailua');
truthy('inside the radius', atHonolulu.km < GDACS_SURGE.homeRadiusKm);

/* ==> THE ASSERTION THE RADIUS ACTUALLY EXISTS FOR. <== Kauai is the one
 * Hawaiian island Lala modelled nothing on; Lihue's nearest modelled town is
 * on Oahu, about 150 km away. Without the ceiling, `nearestPlace` returns that
 * town and the dashboard prints its number as this house's forecast. */
const lihueHome = { lat: 21.9788, lon: -159.3690 };
eq('a Kauai house finds nothing within the radius', nearestPlace(lala.places, lihueHome), null);
truthy(
  'and the town it would otherwise have taken is far outside it',
  Math.min(...lala.places.map((p) => kmBetween(lihueHome.lon, lihueHome.lat, p.lon, p.lat)))
    > GDACS_SURGE.homeRadiusKm
);

eq('no places means no nearest', nearestPlace([], hiloHome), null);
eq('no home means no nearest', nearestPlace(lala.places, null), null);

/* ---------------------------------------------------------------------------
 * THE FOUR STATES
 * ------------------------------------------------------------------------- */
console.log('\nfour states, and only one of them is an all-clear');

const atHome = surgeAtHome(lala, hiloHome, { system: 'metric' });
eq('a house beside a modelled town is ok', atHome.state, 'ok');
eq('and is told about its own town', atHome.here.city, 'Hilo');
eq('with a figure in its own units', atHome.here.heightText, '0.1 m');
/* ==> THE WORST-TOWN LINE IS SUPPRESSED HERE, AND THAT IS THE FIX RATHER THAN
 * THE BUG. <== Hilo reads 0.13 m and the storm's deepest, Hookena, reads 0.17.
 * Lala's entire 47-town spread is 0.10 to 0.17 — one rung of the ramp, seven
 * centimetres end to end. Naming a "deepest anywhere" that is the same colour
 * as the reader's own town is noise. The first version of this rule compared
 * against `negligibleM` and silenced the line on every storm in the archive
 * for an unprincipled reason; the rung is the principled one. */
eq('the storm\u2019s worst is not named when it shares this town\u2019s rung', atHome.worst, null);
truthy('though the storm really does have a deeper town elsewhere',
  lala.places[0].city === 'Hookena' && lala.places[0].heightM > atHome.here.heightM);
eq('and it IS named when it is a rung up', surgeAtHome(
  { placeCount: 2, places: [
    { city: 'Deep', country: 'X', heightM: 0.8, lat: 19.72, lon: -155.09, arrivalHours: 1, peakHours: 2 },
    { city: 'Shallow', country: 'X', heightM: 0.12, lat: 19.7177, lon: -155.0829, arrivalHours: 1, peakHours: 2 },
  ] }, hiloHome, { system: 'metric' }).worst.city, 'Deep');

/* ==> `out_of_range` IS NOT `none_matched` AND THE DIFFERENCE IS SAFETY. <==
 * The model produced 47 towns and none is near this house. That is nobody
 * having looked here, not a statement that the house is dry. If these two ever
 * collapse into one state, the Honolulu house is told "no coastal flooding is
 * modelled for this storm" while the storm models 47 towns two islands away. */
const away = surgeAtHome(lala, lihueHome, { system: 'metric' });
eq('a Kauai house is out_of_range', away.state, 'out_of_range');
truthy('and is still told the storm\u2019s deepest town', away.worst?.city === 'Hookena');
truthy('out_of_range is not none_matched', away.state !== 'none_matched');

/* Hernán: the model ran across the storm and found no populated place at all.
 * The one honest all-clear. */
eq('a storm with no towns anywhere is none_matched',
  surgeAtHome(hernan, hiloHome, { system: 'metric' }).state, 'none_matched');
eq('a relay none_matched is passed through',
  surgeAtHome({ status: 'none_matched', placeCount: 0, places: [] }, hiloHome).state, 'none_matched');

/* Saudel, the JTWC storm — the same parser, no second code path. Shomushon is
 * on Saipan; a house there gets an answer from a storm no American product
 * covers. */
const saipanHome = { lat: 18.13, lon: 145.77 };
const atSaipan = surgeAtHome(saudel, saipanHome, { system: 'imperial' });
eq('a JTWC storm answers through the same parser', atSaipan.state, 'ok');
eq('with a real town', atSaipan.here.city, 'Shomushon');
eq('and a real figure', atSaipan.here.heightText, '2 ft');
truthy('and its arrival and peak are hours apart',
  atSaipan.here.peakHours - atSaipan.here.arrivalHours === 6);

/* ==> `arrivalMs` STAYS NULL WITHOUT A BULLETIN BASE. <== The offsets are
 * hours from bulletin 1, whose publication time this route does not carry.
 * Printing a clock time from a guessed base is a confident wrong answer about
 * when somebody's street floods. */
eq('no clock time without a bulletin base', atSaipan.here.arrivalMs, null);
truthy('and a real one with it',
  surgeAtHome(saudel, saipanHome, { bulletinBaseMs: 0 }).here.arrivalMs === 87 * 3600000);

/* ---------------------------------------------------------------------------
 * WHICH STORMS CAN BE ASKED AT ALL
 * ------------------------------------------------------------------------- */
console.log('\nthe event id — read off the fields that exist');

eq('a GDACS storm yields its event id',
  gdacsEventIdOf({ source: 'gdacs', sourceId: '1001303' }), '1001303');
/* ==> AN NHC STORM YIELDS NOTHING, AND §51.5 RECORDS WHAT THAT COSTS. <==
 * `mergeStorms` drops the GDACS twin of every storm in an NHC basin, so Lala
 * reaches the app as its NHC record alone and this feature cannot see the 47
 * towns above. Asserted rather than left implicit, because the day somebody
 * closes that gap this line is the one that has to change. */
eq('an NHC storm yields none', gdacsEventIdOf({ source: 'nhc', sourceId: 'cp012026' }), null);
eq('a storm with no source yields none', gdacsEventIdOf({}), null);
eq('no storm at all yields none', gdacsEventIdOf(null), null);

/* ------------------------------------------------------------------------- */
console.log(
  failures === 0
    ? '\n\u2713 surge-locations: every acceptance case passes\n'
    : `\n\u2717 surge-locations: ${failures} failure(s)\n`
);
process.exit(failures === 0 ? 0 : 1);
