#!/usr/bin/env node
/**
 * test-place-label.mjs — how a point becomes words (SPEC-UI §8).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-place-label.mjs`, like every suite
 * here.
 *
 * ===========================================================================
 * WHAT IS ACTUALLY AT RISK HERE
 * ===========================================================================
 *
 * Two sources answer two different questions about one point — the geocoder
 * says what it is called, the basemap says whether it is water — and either
 * can fail independently. That is four inputs collapsing to four outputs, and
 * every wrong collapse is a sentence the user reads and believes:
 *
 *   saying "Open water" about a house         — because a harbour tile said so
 *   saying "Unnamed location" about the ocean — because nothing was named
 *   saying "Open water" about the Sahara      — because nothing was named
 *   printing coordinates when we knew better  — the bug this replaced
 *
 * None of those throws. None shows up in a console. They are all just the app
 * confidently saying the wrong thing in good English, which is why the rules
 * are in one pure function and why that function is driven here.
 *
 * ===========================================================================
 * THE ONE RULE WORTH STATING TWICE: A NAME BEATS THE WATER FLAG
 * ===========================================================================
 *
 * Coastal towns, harbours, river mouths and barrier islands all produce points
 * the vector tiles call water while the geocoder names them without hesitating.
 * At these resolutions the tile edge and the real shoreline are simply not the
 * same line. So when both answer, the NAME wins — anything else tells somebody
 * who searched their own address that they live in the sea.
 *
 * ===========================================================================
 * WHAT THIS CANNOT PROVE
 * ===========================================================================
 *
 * Whether `map/water-at.js` returns the right answer against real tiles. That
 * needs a basemap, the sandbox cannot reach `tiles.openfreemap.org`, and a
 * fixture asserting what a tile contains would be a fiction that passes. This
 * suite drives the DECISION given an answer; the answer itself is glass.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

const {
  placeText, placeSubText, placeKindFrom, coordText, PLACE_KIND,
} = await import('../lib/place-label.js');

let pass = 0;
const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else failures.push(msg); };
const eq = (got, want, msg) =>
  ok(got === want, `${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

/* --------------------------------------------------------------- the kinds */

eq(placeKindFrom({ label: 'Galveston, Texas', water: 'land' }), PLACE_KIND.named,
   'a name on land is named');

eq(placeKindFrom({ label: null, water: 'water' }), PLACE_KIND.water,
   'no name plus water is water');

eq(placeKindFrom({ label: null, water: 'land' }), PLACE_KIND.unnamed,
   'no name on land is UNNAMED, not water — the Sahara is not the Atlantic');

eq(placeKindFrom({ label: null, water: 'unknown' }), PLACE_KIND.unknown,
   'nothing known either way is unknown');

eq(placeKindFrom({ label: null, water: 'land', lookupFailed: true }), PLACE_KIND.unknown,
   'a FAILED lookup on land is unknown, never "unnamed" — a source outage must '
   + 'not read as a fact about the place (§5)');

/* THE PRECEDENCE RULE. If this flips, every coastal home says "Open water". */
eq(placeKindFrom({ label: 'Galveston, Texas', water: 'water' }), PLACE_KIND.named,
   'a NAME BEATS THE WATER FLAG — a harbour tile must not overrule the geocoder');

eq(placeKindFrom({ label: null, water: 'water', lookupFailed: true }), PLACE_KIND.water,
   'water still wins over a failed lookup — the basemap answered, so we know');

/* ------------------------------------------------------------ the sentences */

const AT = { lat: 29.3013, lon: -94.7977 };

eq(placeText({ ...AT, label: 'Galveston, Texas', place: 'named' }), 'Galveston, Texas',
   'a named place prints its name');
eq(placeText({ ...AT, label: null, place: 'water' }), 'Open water',
   'water prints "Open water"');
eq(placeText({ ...AT, label: null, place: 'unnamed' }), 'Unnamed location',
   'unnamed land prints "Unnamed location"');
eq(placeText({ ...AT, label: null, place: 'unknown' }), '29.301, -94.798',
   'unknown falls back to coordinates — the honest answer, not a guess');

/* THE MIGRATION CASE. Every home stored before this feature existed has no
 * `place` field at all. If those all became "Unnamed location" on the day this
 * shipped, the feature would have broken more labels than it fixed. */
eq(placeText({ ...AT, label: '10 Main St, Galveston' }), '10 Main St, Galveston',
   'an OLD home with a label but no `place` is treated as named');
eq(placeText({ ...AT, label: null }), '29.301, -94.798',
   'an old home with neither falls back to coordinates, not to "unnamed"');

eq(placeText(null), '', 'no home prints nothing rather than throwing');

/* ------------------------------------------------------------- the sub-line */

eq(placeSubText({ ...AT, label: 'Galveston, Texas', place: 'named' }), '29.301, -94.798',
   'a named place still carries its exact point underneath');
eq(placeSubText({ ...AT, label: null, place: 'water' }), '29.301, -94.798',
   'so does open water');
eq(placeSubText({ ...AT, label: null, place: 'unknown' }), '',
   'but unknown prints NO sub-line — the coordinates are already the headline '
   + 'and saying them twice in two sizes reads as a rendering bug');

/* ----------------------------------------------------------- the coordinates */

eq(coordText({ lat: 0, lon: 0 }), '0.000, 0.000',
   'null island formats rather than being falsy-skipped');
eq(coordText({ lat: -33.86881, lon: 151.20929 }), '-33.869, 151.209',
   'three decimals, lat first, rounded not truncated');
eq(coordText({ lat: NaN, lon: 5 }), '', 'a NaN coordinate prints nothing rather than "NaN"');
eq(coordText(null), '', 'no point prints nothing rather than throwing');

for (const f of failures) console.log(`  ✗ ${f}`);
console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed`
    : `\n✓ ${pass} assertions passed`
);
console.log('  (the rules are right; whether "Open water" READS is glass)');
process.exit(failures.length ? 1 : 0);
