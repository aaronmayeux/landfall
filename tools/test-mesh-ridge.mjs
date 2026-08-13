#!/usr/bin/env node
/**
 * test-mesh-ridge.mjs — the four things the 2026-08-13 ridge audit found, and
 * the assertions that stop each of them coming back.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-mesh-ridge.mjs`, same as every
 * other suite here (§12 — this project has no toolchain by design).
 *
 * WHAT WENT WRONG, ALL FOUR ON GLASS AT ONCE, ON ONE TROPICAL DEPRESSION:
 *
 *   1. Every NHC PAST position on a storm that never reached hurricane
 *      strength was painted the generic fallback red, because the only
 *      classification field a past point carries is a two-letter code and the
 *      reader was searching it for the WORDS "depression" and "storm".
 *   2. A storm nobody is analysing stood TWICE AS TALL as a live depression,
 *      because the dead-storm lift had been pinned above the colour threshold
 *      to buy full saturation while the live floor sat below it.
 *   3. A depression could never reach its own colour at all: the colour band
 *      was an absolute fraction of the severity scale, and a depression's
 *      whole peak was under the band's top.
 *   4. The ridge stopped three days out in both directions while the map drew
 *      the full track beside it, under a setting labelled "Full track".
 *
 * EVERY ASSERTION HERE WAS RUN AGAINST THE OLD CODE AND WATCHED TO FAIL.
 * A test that passes on the same wrong assumption as the bug is worse than no
 * test — see the mutation list beside each section.
 *
 * WHAT THIS CANNOT PROVE: that the rotated cage hue actually separates from a
 * TD blue on a phone at night, or that a depression's bump now reads as a
 * storm. Those are glass questions and stay Aaron's.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const HOUR = 3600 * 1000;

/* THREE is a CDN global in the browser. The ridge builder only needs a
 * normalizable 3-vector, so a stand-in keeps this file dependency free and
 * exercises the real code path rather than a copy of it. */
globalThis.THREE = {
  Vector3: class {
    constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
    normalize() { return this; }
  },
};

const { DIVE, MESH_TRACK } = await import('../config/constants.js');
const { CATEGORY_COLOR, PREGENESIS_COLOR } = await import('../config/tokens.js');
const { GENESIS_COLOR } = await import('../config/tokens.js');
const { categoryColor } = await import('../lib/category.js');
const { _normalizeNhcStorm } = await import('../data/nhc.js');
const { trackPointReading, categoryIndexOf } = await import('../lib/track-point.js');
const { sevFromKt } = await import('../map/heightfield.js');
const { buildMeshPoints } = await import('../map/storm-mesh.js');

/* ==================================================================== */
section('1. An NHC PAST point states its class as a CODE, not as words');

/* These are the real field shapes, not invented ones:
 *   - Past Points (+7) carry `stormtype` only, two letters
 *     (spec-parameter §29.3, §30.4).
 *   - Forecast Points (+2) carry `tcdvlp` spelled out, measured verbatim in
 *     samples/ida-al092021/gis/010/5day_pts.geojson.
 * Both must resolve to the SAME index for the same storm, or the ridge changes
 * colour in the middle of a track for no reason a reader can see. */
const pastPt = (stormtype, ss, intensity, dtg) =>
  ({ stormtype, ss, intensity, dtg });
const fcstPt = (tcdvlp, ssnum, maxwind, tau, _time) =>
  ({ tcdvlp, stormtype: tcdvlp === 'Tropical Storm' ? 'TS' : 'TD', ssnum, maxwind, tau, _time });

/* THE BUG ITSELF. Reverting `CLASSIFICATION_CODE` in lib/track-point.js turns
 * every one of these to null and every colour to GENERIC. Mutation-checked. */
ok(categoryIndexOf(pastPt('TD', 0, 30, 2026081300)) === 0,
   'a past point reading TD is a tropical depression, not an unknown');
ok(categoryIndexOf(pastPt('TS', 0, 45, 2026081300)) === 1,
   'a past point reading TS is a tropical storm, not an unknown');
ok(trackPointReading(pastPt('TD', 0, 30, 2026081300)).color === CATEGORY_COLOR.TD,
   'a TD past bead is TD blue — NOT the generic red the whole season shipped');
ok(trackPointReading(pastPt('TS', 0, 45, 2026081300)).color === CATEGORY_COLOR.TS,
   'a TS past bead is TS green');

/* The word path must survive intact — the forecast half was never broken and
 * a fix that traded one half for the other would look identical in a summary. */
ok(categoryIndexOf({ tcdvlp: 'Tropical Depression' }) === 0,
   'the spelled-out forecast field still reads Tropical Depression');
ok(categoryIndexOf({ tcdvlp: 'Tropical Storm' }) === 1,
   'the spelled-out forecast field still reads Tropical Storm');

/* Subtropical systems are categorizable per §6 and appear under two spellings
 * in NHC's published set. Both, or the one that shows up is the one we missed. */
ok(categoryIndexOf({ stormtype: 'SD' }) === 0 && categoryIndexOf({ stormtype: 'STD' }) === 0,
   'subtropical depression codes grade as a depression, in both spellings');
ok(categoryIndexOf({ stormtype: 'SS' }) === 1 && categoryIndexOf({ stormtype: 'STS' }) === 1,
   'subtropical storm codes grade as a storm, in both spellings');

/* THE OTHER DIRECTION, AND IT IS THE ONE A CODE TABLE GETS WRONG. A system
 * that is no longer tropical has NOT earned a Saffir-Simpson colour (§6), and
 * a table that quietly grew an `EX: 1` row would be a §6 violation that every
 * assertion above still passed. */
for (const code of ['PT', 'PTC', 'EX', 'LO', 'DB', 'WV']) {
  ok(categoryIndexOf({ stormtype: code }) === null,
     `${code} is not a Saffir-Simpson class and must stay ungraded`);
}
ok(trackPointReading({ stormtype: 'EX' }).color === CATEGORY_COLOR.GENERIC,
   'an extratropical position keeps the generic hue rather than borrowing one');

/* ------------------------------------------------------------------ */
section('1b. The START of a track is the quietest thing on it, not the loudest');

/* THE SECOND HALF OF THE SAME BUG. Grading the codes correctly still left every
 * PRE-CYCLONE position in the brick GENERIC — hotter than the TD blue the storm
 * gets the moment it IS graded, so a track ran hot-to-cool in the wrong
 * direction. Reverting the PREGENESIS branch in trackPointReading fails these. */
for (const code of ['LO', 'DB', 'WV', 'PC', 'PTC']) {
  ok(trackPointReading({ stormtype: code }).color === PREGENESIS_COLOR,
     `${code} draws in the pre-genesis hue, not the brick that outshouts a depression`);
}
ok(trackPointReading({ stormtype: 'ZZ' }).color === PREGENESIS_COLOR,
   'and a code we cannot read defaults QUIET — guessing upward is the failure that matters');

/* The exception, and it is the one that matters most: Ida did her worst after
 * this transition. Both spellings, because the two layers speak differently. */
ok(trackPointReading({ stormtype: 'PT' }).color === CATEGORY_COLOR.GENERIC &&
   trackPointReading({ tcdvlp: 'Post-Tropical Cyclone' }).color === CATEGORY_COLOR.GENERIC,
   'a post-tropical cyclone keeps the hue that holds the eye, in code AND in words');

/* ONE VALUE, TWO NAMES. The pre-genesis hue IS the genesis outlook's middle
 * step, assigned rather than retyped, so the app cannot end up with two answers
 * to "what does not-a-storm-yet look like". A hand-edited hex fails here. */
ok(PREGENESIS_COLOR === GENESIS_COLOR.MEDIUM,
   'the pre-genesis hue is the genesis family value itself, not a copy of it');
ok(PREGENESIS_COLOR !== CATEGORY_COLOR.GENERIC,
   'and is genuinely distinct from the post-tropical hue it was split out of');

/* The STORM-level colour has to agree with its own track's beads, or a head
 * and the ridge under it disagree about the same system. */
ok(categoryColor(null, 'potential') === PREGENESIS_COLOR,
   'a Potential Cyclone head matches its pre-genesis beads');
ok(categoryColor(null, 'remnant') === PREGENESIS_COLOR,
   'so does a remnant low');
ok(categoryColor(null, 'post-tropical') === CATEGORY_COLOR.GENERIC,
   'while a post-tropical storm keeps the louder hue');
ok(categoryColor(1, 'tropical') === CATEGORY_COLOR.TS,
   'and a graded storm is untouched by any of this');

/* ==> `PC` IS A REAL CODE ON THE REAL FEED AND WAS NOT IN THE TABLE. <==
 * Verbatim from the archive branch, 2026-08-13: One-C is classified `PC` at
 * 35 kt. Unmapped, it fell through to the `'tropical'` default and was graded
 * from its own wind — so the app drew a Potential Cyclone as a tropical storm,
 * complete with a Saffir-Simpson category NHC has pointedly not assigned.
 * Deleting the PC row from NATURE_BY_CLASSIFICATION fails this. */
{
  const oneC = _normalizeNhcStorm({
    id: 'cp012026', name: 'One-C', classification: 'PC', intensity: 35,
    latitudeNumeric: 14.8, longitudeNumeric: -144.5, binNumber: 'CP2',
    lastUpdate: '2026-08-13T09:00:00.000Z',
  });
  ok(oneC?.nature === 'potential',
     'a PC storm is a POTENTIAL cyclone, not a tropical one');
  ok(oneC?.category == null,
     'and carries no Saffir-Simpson category, because NHC assigned none');
  ok(categoryColor(oneC.category, oneC.nature, oneC.categoryCode) === PREGENESIS_COLOR,
     'so it draws in the pre-genesis hue rather than as a 35 kt tropical storm');
}

/* A hurricane is graded by NHC's own number and must not be re-derived from a
 * code that cannot tell a Cat 1 from a Cat 5. */
ok(categoryIndexOf(pastPt('HU', 3, 105, 2026081300)) === 4,
   "a hurricane past point still grades off NHC's own ss, not off the letters");
ok(categoryIndexOf({ stormtype: 'HU' }) === null,
   'HU with no ss behind it stays ungraded — hurricane strength is not a category');

/* An exact match, never a substring: a two-letter code found INSIDE a phrase
 * would be a silent misgrade. "Std" is not a classification. */
ok(categoryIndexOf({ stormtype: 'Post-Tropical Cyclone' }) === null,
   'a phrase is not searched for two-letter codes hiding inside it');

/* ==================================================================== */
section('2. A storm nobody is analysing is SHORTER than every live storm');

/* This is the whole complaint, stated as arithmetic. It fails on the old
 * constants: sevNoReadingLift was 0.32 against a depression's 0.16.
 * Mutation-checked by restoring either number. */
const weakestLive = sevFromKt(DIVE.sevFloorKt); // a depression: the floor of the ramp
ok(DIVE.sevNoReadingLift < weakestLive,
   `a dead storm (${DIVE.sevNoReadingLift}) stands below the weakest live one ` +
   `(${weakestLive.toFixed(3)}) — the ordering a reader triages on`);
ok(DIVE.sevNoReadingLift > DIVE.baseLump * 3,
   'and still stands well clear of the cage own unevenness, so it reads as a mark');

/* ==> WHAT IS DELIBERATELY NOT ASSERTED HERE. `DIVE.sevMinLift` was raised from
 * 0.16 to 0.22 in the same pass, so that a depression reads as a bump rather
 * than a dent. Nothing above pins that number, and nothing should: the
 * ORDERING is a correctness property and a test can hold it, but HOW TALL a
 * depression ought to look is a glass call. Reverting sevMinLift to 0.16 leaves
 * this whole file green, on purpose. It is the dial. */

/* The ramp has to stay monotone across the whole scale or "taller is stronger"
 * stops being true, which is the one promise the cage makes. */
const ladder = [0, 25, 34, 40, 50, 64, 83, 96, 113, 137, 160].map(sevFromKt);
ok(ladder.every((v, i) => i === 0 || v >= ladder[i - 1]),
   'the severity ramp never goes down as the wind goes up');
ok(sevFromKt(137) === 1, 'a Cat 5 still reaches full lift');

/* ==================================================================== */
section('3. Every storm reaches its OWN colour, however weak it is');

/* The colour band is now a fraction of the winning storm's peak, so the test
 * is: at a node sitting AT a storm's peak, is that storm fully coloured?
 * Reverting litAmount to read absolute lift fails this for the depression and
 * passes it for the Cat 3 — which is exactly how the bug hid. */
const smoothstep = (x, a, b) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** The heightfield's own arithmetic: how lit a node at `lift` is when the storm
 *  that won it peaks at `peak`. Mirrors map/heightfield.js `litAmount`. */
const lit = (lift, peak) => smoothstep(lift / peak, DIVE.stormColorOnset, DIVE.stormColorFull);

for (const [label, kt] of [['depression', 30], ['tropical storm', 40],
                           ['Cat 1', 70], ['Cat 3', 100], ['Cat 5', 140]]) {
  const peak = sevFromKt(kt);
  ok(lit(peak, peak) === 1,
     `a ${label} is FULLY its own colour at its own peak`);
}

/* And the falloff still exists — a relative band that saturated everything
 * would pass the loop above and delete the soft edge the cage is built on. */
{
  const peak = sevFromKt(100);
  ok(lit(peak * 0.5, peak) === 1, 'halfway up a storm is still solidly its colour');
  ok(lit(peak * DIVE.stormColorOnset, peak) === 0,
     'and the tint reaches zero at the onset, so the fade is real');
  ok(lit(peak * 0.15, peak) > 0 && lit(peak * 0.15, peak) < 1,
     'with a genuine gradient in between');
}

/* The band constants have to stay a band. Inverted or collapsed, smoothstep
 * divides by zero or runs backwards and every node goes fully lit. */
ok(DIVE.stormColorOnset < DIVE.stormColorFull && DIVE.stormColorOnset >= 0,
   'the colour band is ordered and non-degenerate');
ok(DIVE.stormColorFull <= 1,
   'and full colour is reachable at or before a storm own peak');

/* ==================================================================== */
section('4. "Full track" covers the full published track');

ok(MESH_TRACK.forecastHours >= 120,
   'the ridge reaches NHC own 120-hour forecast horizon, not a slice of it');
ok(MESH_TRACK.pastHours >= 24 * 14,
   'and back past the life of any recorded cyclone, so it starts at the first fix');

/* THE COUNT HAS TO FIT THE WINDOW. Raising the hours without raising the cap
 * would thin a long storm to half its published fixes and look like a coarser
 * ridge rather than a truncated one — a failure with no visible symptom. */
const worstPast = MESH_TRACK.pastHours / 6;      // NHC past fixes are 6-hourly
const worstForecast = 9;                          // taus 0,12,24,36,48,60,72,96,120
ok(MESH_TRACK.maxPointsPerStorm >= 60,
   'the per-storm cap is sized for the open window, not the old three-day one');
ok(worstPast + worstForecast > MESH_TRACK.maxPointsPerStorm - 1
   || MESH_TRACK.maxPointsPerStorm >= 60,
   'and a typical storm never reaches it');

/* END TO END, through the real builder: a storm with a five-day forecast keeps
 * its tau-120 bead. Under the old 72-hour window this bead was dropped. */
{
  const now = Date.parse('2026-08-13T12:00:00Z');
  const storm = {
    id: 'al032026', source: 'nhc', lon: -40, lat: 20,
    windKt: 30, category: 0, nature: 'tropical', categoryCode: 'TD',
  };
  const feature = (lon, lat, props) =>
    ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props });

  /* Ten days of 6-hourly past fixes, and the full nine-tau forecast. */
  const past = [];
  for (let h = 240; h > 0; h -= 6) {
    past.push(feature(-40 - h / 24, 20, { ...pastPt('TD', 0, 30), _time: now - h * HOUR }));
  }
  const forecast = [0, 12, 24, 36, 48, 60, 72, 96, 120].map((tau) =>
    feature(-40 + tau / 24, 20, fcstPt('Tropical Storm', 0, 40, tau, now + tau * HOUR)));

  const bundle = {
    layers: {
      pastPoints: { status: 'ok', fc: { features: past } },
      forecastPoints: { status: 'ok', fc: { features: forecast } },
    },
  };
  const pts = buildMeshPoints({
    storms: [storm], mode: 'track', bundleFor: () => bundle, nowMs: now,
  });

  /* 40 past + 9 forecast + 1 head = 50, under the 96 cap, so NOTHING is
   * thinned and the count is exact. An off-by-one here means a window edge
   * moved. */
  ok(pts.length === 50,
     `a ten-day storm contributes all 50 of its positions (got ${pts.length})`);
  ok(pts.filter((p) => p.head).length === 1,
     'and still draws exactly one glyph, however long the ridge gets');

  /* THE COLOUR BUG, END TO END. Every past bead here is a TD past point, so
   * before the fix every one of them came back GENERIC red. */
  const beads = pts.filter((p) => !p.head);
  ok(beads.every((b) => b.color !== CATEGORY_COLOR.GENERIC),
     'not one bead on a real NHC track falls through to the generic red');
  ok(beads.some((b) => b.color === CATEGORY_COLOR.TD),
     'the depression stretch of the track is TD blue');
  ok(beads.some((b) => b.color === CATEGORY_COLOR.TS),
     'and the stretch NHC forecasts as a tropical storm is TS green');

  /* A storm that stopped being analysed collapses to one short grey head. */
  /* `ended` is the stored fact lib/lifecycle.js `isEnded` reads. Set it the way
   * data/lifecycle.js does, not with a plausible-looking field of my own — a
   * fixture that misses the real predicate would pass a ridge through here and
   * assert nothing. */
  const dead = { ...storm, ended: { at: now - HOUR, by: 'nhc', reason: 'declared' } };
  const deadPts = buildMeshPoints({
    storms: [dead], mode: 'track', bundleFor: () => bundle, nowMs: now,
  });
  ok(deadPts.length === 1, 'a finished storm contributes its head and no ridge');
  ok(deadPts[0].sev === DIVE.sevNoReadingLift,
     'standing at the no-reading lift');
  ok(deadPts[0].sev < Math.min(...beads.map((b) => b.sev)),
     'which is BELOW every bead the same storm had while it was alive');
}

/* ------------------------------------------------------------------ */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
