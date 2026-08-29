#!/usr/bin/env node
/**
 * test-season-facts.mjs — the figures nobody publishes, checked against NOAA.
 * SPEC-SEASONS-BUILD.md §57.15, §57.22.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-season-facts.mjs`.
 *
 * ==> IDA IS THE HAND-CHECK AND IT IS A TRUE CROSS-SOURCE ONE. <== Every
 * number asserted about her below is stated in `samples/ida-al092021/
 * tcr-AL092021_Ida.txt` — NOAA's own Tropical Cyclone Report, a DIFFERENT
 * document from the HURDAT2 database being parsed, written by different people
 * for a different purpose. Two independent NOAA sources agreeing is the
 * strongest check available without a phone, and it is why §57.30 step 2 names
 * her.
 *
 * ==> THE SILENT BUG THIS SUITE EXISTS FOR IS ACE. <== The index is defined
 * over the four six-hourly synoptic observations. NOAA inserts EXTRA records
 * at landfalls and at peaks — Ida has three landfall rows and none of them is
 * on the six-hour clock — so a sum over every row in the file double-counts
 * the most intense moments of the most intense storms. Nothing errors and the
 * number stays plausible. Both totals are computed below and asserted to
 * differ, so the day someone "simplifies" the filter away, this says so.
 *
 * WHAT THIS CANNOT PROVE: whether the detail panel READS well. That is glass.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { parseHurdat2, parseBdeck } = await import('../lib/hurdat.js');
const {
  stormFacts, seasonFacts, rankInSeason, __internals,
} = await import('../lib/season-facts.js');
const { categoryShortLabel } = await import('../lib/category.js');
const { SEASONS } = await import('../config/constants.js');

const storm = (f) => readFileSync(`samples/seasons/storms/${f}.txt`, 'utf8');
const season = (f) => readFileSync(`samples/seasons/seasons/${f}.txt`, 'utf8');
const bdeck = (f) => readFileSync(`samples/seasons/bdecks/${f}.dat`, 'utf8');
const one = (f) => parseHurdat2(storm(f)).storms[0];
const seasonStorms = (f) => parseHurdat2(season(f)).storms;
const iso = (ms) => new Date(ms).toISOString();

/* ------------------------------------------------------------------------- */
section('IDA — against NOAA\'s own Tropical Cyclone Report');
{
  const f = stormFacts(one('al092021'));

  ok(f.peakWindKt === 130,
    `the report gives Ida's peak as 130 kt. Got ${f.peakWindKt}`);
  /* `nature`, not the HURDAT status code. `lib/category.js` grades on the WORD
   * ('tropical', 'subtropical'), and 130 kt is index 5 on its zero-based scale
   * where 0 is TD and 1 is TS. Asserting the label rather than the index is
   * deliberate — an off-by-one in that mapping is exactly the kind of thing a
   * numeric assertion agrees with. */
  ok(categoryShortLabel(f.peakCategory, 'tropical') === 'Cat 4',
    `the report calls that category 4 on the Saffir-Simpson scale. Got `
    + `${categoryShortLabel(f.peakCategory, 'tropical')}`);
  ok(f.lowestPressureMb === 929,
    `the report gives 929 mb as the minimum pressure, from a P-3 dropsonde. Got ${f.lowestPressureMb}`);

  ok(f.landfalls.length === 3, `three marked landfalls. Got ${f.landfalls.length}`);
  const la = f.landfalls[2];
  ok(la.windKt === 130 && la.pressureMb === 931,
    `the Louisiana landfall was 130 kt and 931 mb. Got ${la.windKt} kt ${la.pressureMb} mb`);
  ok(categoryShortLabel(la.category, 'tropical') === 'Cat 4',
    `and calls the landfall intensity category 4 — the report says it ties the strongest on `
    + `record to hit Louisiana. Got ${categoryShortLabel(la.category, 'tropical')}`);
  ok(f.landfalls.every((l) => l.source === 'noaa'),
    '==> A MARK NOAA PUBLISHED AND A MARK WE DERIVED MUST STAY TELLABLE APART. <== §57.7 '
    + 'reserves the right to compute landfalls ourselves, and the day that happens a later '
    + 'session has to be able to see which is which. The field is here from the first day '
    + 'rather than retrofitted');

  ok(f.ending === 'extratropical',
    `the report says Ida became an extratropical low. Got ${f.ending}`);

  ok(f.fastest24h && f.fastest24h.gainKt === 60,
    `Ida gained 60 kt in her fastest 24 hours. Got ${f.fastest24h?.gainKt}`);
  ok(f.fastest24h.hours <= SEASONS.intensificationWindowHours,
    `and the window must not exceed 24 hours. Got ${f.fastest24h.hours}`);

  ok(f.hoursAtMajor > 0 && f.hoursAtMajor < f.hoursAtHurricane,
    `time at major must be real and shorter than time at hurricane. `
    + `Got major ${f.hoursAtMajor}h, hurricane ${f.hoursAtHurricane}h`);
  ok(f.lifespanHours > f.hoursAtHurricane,
    'and her whole life must be longer than the hurricane part of it');
}

/* ------------------------------------------------------------------------- */
section('==> ACE COUNTS SYNOPTIC RECORDS ONLY <==');
{
  const ida = one('al092021');
  const f = stormFacts(ida);

  ok(Math.abs(f.ace - 10.58) < 0.01,
    `Ida's ACE is 10.58 by the standard definition. Got ${f.ace?.toFixed(4)}`);

  /* The naive version: every row, no clock filter. */
  let naive = 0;
  for (const p of ida.points) {
    if (!Number.isFinite(p.windKt) || p.windKt < SEASONS.namedStormKt) continue;
    if (!__internals.isCyclone(p.status)) continue;
    naive += p.windKt * p.windKt;
  }
  naive /= SEASONS.aceDivisor;

  ok(naive > f.ace,
    `==> SUMMING EVERY ROW INFLATES IT. <== NOAA inserts extra records at landfalls and peaks `
    + `and they are not observations on the six-hour clock. Naive ${naive.toFixed(4)} vs `
    + `correct ${f.ace.toFixed(4)} — plausible, wrong, and silent`);
  ok((naive - f.ace) / f.ace > 0.1,
    `and the inflation is over ten percent on Ida, not a rounding error. `
    + `Got ${(((naive - f.ace) / f.ace) * 100).toFixed(1)}%`);

  /* The clock itself. A landfall stamped 1655Z shares an hour with nothing. */
  ok(__internals.isSynoptic(Date.parse('2021-08-29T12:00:00Z')), '1200Z on the hour is synoptic');
  ok(!__internals.isSynoptic(Date.parse('2021-08-29T16:55:00Z')),
    '==> 1655Z IS NOT. <== Ida\'s Louisiana landfall row, and the reason the minute is checked '
    + 'and not just the hour');
  ok(!__internals.isSynoptic(Date.parse('2021-08-29T13:00:00Z')), '1300Z on the hour is still not synoptic');
  ok(!__internals.isSynoptic(Date.parse('2021-08-29T18:30:00Z')),
    'and 1830Z is not, even though 18 is one of the four hours');

  /* ==> AND STATUS MATTERS AS MUCH AS THE CLOCK — ASSERTED HEAD-ON. <== Ida
   * cannot show this: she goes extratropical below hurricane force, so removing
   * the status filter changes none of her numbers and every assertion above
   * stays green over the bug. That is the §12 failure exactly, and it was found
   * by mutation rather than by reading. This storm is synthetic ON PURPOSE — it
   * is the shape no fixture in the archive happens to have. */
  const exStorm = {
    id: 'ZZ012000', basin: 'AL', number: 1, year: 2000, name: 'GHOST',
    points: [0, 6, 12, 18].map((h) => ({
      time: Date.parse('2000-09-01T00:00:00Z') + h * 3600e3,
      status: 'EX', lat: 45, lon: -50, lonU: -50, windKt: 80,
      pressureMb: 960, radii: {}, marker: null, rmwNm: null,
    })),
  };
  const exFacts = stormFacts(exStorm);
  ok(exFacts.ace === null,
    `==> AN EXTRATROPICAL LOW AT 80 KT ON THE HOUR CONTRIBUTES NOTHING TO ACE. <== It is on `
    + `the clock and it is strong, and it is not a tropical cyclone. Got ${exFacts.ace}`);
  ok(exFacts.hoursAtHurricane === 0,
    `and it counts no hours at hurricane strength either — "days at hurricane strength" is `
    + `about the cyclone, not about the wind. Got ${exFacts.hoursAtHurricane}`);
  ok(exFacts.peakWindKt === 80,
    'though its peak wind is still 80 kt, because that IS what was measured');

  /* Status matters as much as the clock. */
  ok(__internals.isCyclone('HU') && __internals.isCyclone('SS'),
    'a hurricane and a subtropical storm both count');
  ok(!__internals.isCyclone('EX') && !__internals.isCyclone('LO') && !__internals.isCyclone('WV'),
    'an extratropical low, a low and a wave do not — all three are in the file');
}

/* ------------------------------------------------------------------------- */
section('what the file could not say, said out loud');
{
  /* ANDREW 1992 — no wind field at all. */
  const andrew = stormFacts(one('al041992'));
  ok(andrew.missing.windField === true,
    'Andrew predates the wind-radii era and the panel must be able to say so');
  ok(andrew.missing.pressure === false,
    'but he DOES carry pressure — the absences are not all in the same place, and a single '
    + '"old storm" flag would be a lie about half of them');
  ok(andrew.peakWindKt >= 130, `and his peak is real. Got ${andrew.peakWindKt} kt`);

  /* 1851 — no pressure anywhere. */
  const first = stormFacts(one('al011851'));
  ok(first.missing.pressure === true, '1851 has no pressure at all');
  ok(first.lowestPressureMb === null,
    '==> AND THE FIGURE IS null, NEVER ZERO. <== A storm reported at 0 mb would sort as the '
    + 'deepest in the record and paint as the most intense thing ever measured');
  ok(first.missing.wind === false, 'wind, though, goes all the way back');

  /* AL021971 — one row with no intensity, four with a real one. */
  const noInt = stormFacts(one('al021971'));
  ok(noInt.peakWindKt === 25,
    `a -99 row must not become the peak or the floor. Got ${noInt.peakWindKt}`);

  /* A storm with no usable numbers at all must not fabricate a scorecard. */
  const hollow = stormFacts({ id: 'ZZ012000', points: [{ time: 0, status: 'LO', lat: 0, lon: 0, windKt: null, pressureMb: null, radii: {}, marker: null }] });
  ok(hollow.peakWindKt === null && hollow.ace === null,
    'a storm with no wind has no peak and no ACE — null, not zero');
  ok(hollow.missing.wind === true, 'and it says so');
}

/* ------------------------------------------------------------------------- */
section('ties, edges, and the shape of a single-record storm');
{
  const mk = (rows) => ({
    id: 'ZZ012000', basin: 'AL', number: 1, year: 2000, name: 'TEST',
    points: rows.map(([t, kt, status = 'HU']) => ({
      time: t, status, lat: 20, lon: -60, lonU: -60, windKt: kt,
      pressureMb: null, radii: {}, marker: null, rmwNm: null,
    })),
  });

  /* A peak held across three records reports when it was FIRST reached. */
  const held = stormFacts(mk([[0, 90], [6e6, 120], [12e6, 120], [18e6, 100]]));
  ok(held.peakTime === 6e6,
    `a tie must resolve to the EARLIER record, so a storm holding its peak reports when it `
    + `got there rather than when it was last measured at it. Got ${held.peakTime}`);

  /* One record: a lifespan of zero, not a negative or a NaN. The wind is
   * ABOVE hurricane force on purpose — at 50 kt the hours assertion below
   * would pass whether the last record contributed time or not, which is a
   * test agreeing with the bug rather than catching it. */
  const single = stormFacts(mk([[1000, 90]]));
  ok(single.lifespanHours === 0, `one record is a lifespan of zero. Got ${single.lifespanHours}`);
  ok(single.hoursAtHurricane === 0,
    '==> AND THE LAST RECORD CONTRIBUTES NO TIME. <== Assuming a trailing six hours would '
    + 'invent strength a storm may never have had');

  /* Out of order in, in order out. */
  const jumbled = stormFacts(mk([[18e6, 60], [0, 40], [6e6, 100]]));
  ok(jumbled.firstTime === 0 && jumbled.lastTime === 18e6,
    'records arriving out of order must still yield the right span');

  ok(stormFacts(null) === null, 'no storm, no facts');
  ok(stormFacts({ points: [] }) === null, 'no points, no facts');
}

/* ------------------------------------------------------------------------- */
section('the 2005 season scorecard');
{
  const storms = parseHurdat2(season('al-2005')).storms;
  const s = seasonFacts(storms, { year: 2005, basin: 'AL' });

  ok(s.storms === 31, `2005 holds 31 systems in the file. Got ${s.storms}`);
  ok(s.hurricanes === 15,
    `2005 produced 15 hurricanes — the figure the season is known by. Got ${s.hurricanes}`);
  ok(s.majors === 7, `and 7 major hurricanes. Got ${s.majors}`);
  ok(s.named >= s.hurricanes && s.hurricanes >= s.majors,
    'the three counts must nest — every major is a hurricane, every hurricane is named');

  ok(s.strongest && s.strongest.name === 'WILMA',
    `Wilma is the strongest storm of 2005 and the deepest Atlantic hurricane on record. `
    + `Got ${s.strongest?.name}`);
  ok(s.strongest.lowestPressureMb === 882,
    `and her 882 mb is the record itself. Got ${s.strongest.lowestPressureMb}`);

  ok(s.ace > 200 && s.ace < 300,
    `2005's ACE is famously around 250. Got ${s.ace?.toFixed(1)}`);
  ok(s.landfalls > 0 && s.stormsWithLandfall > 0, 'and it had landfalls');

  ok(s.undercountLikely === false,
    '2005 is well inside the satellite era, so no undercount line');
  ok(s.provisional === false, 'and HURDAT2 is the reviewed database');

  /* ==> A QUIET-LOOKING 1935 IS NOT EVIDENCE OF A QUIET SEASON. <== */
  const old = seasonFacts([one('al031935')], { year: 1935, basin: 'AL' });
  ok(old.undercountLikely === true,
    'before the satellite era the storms that stayed at sea are simply missing, and the board '
    + 'has to say so — a claim about the ERA, decidable only from the year, because the numbers '
    + 'are exactly what cannot show it');
}

/* ------------------------------------------------------------------------- */
section('==> HOW MUCH IT WEAKENED BEFORE THE COAST — §57.43 <==');
{
  /* KATRINA is the case §57.42 named: a Category 5 that arrived a Category 3,
   * and the fact people get wrong most often. Both figures are read off her own
   * rows rather than quoted, and both agree with NOAA's report. */
  const k = stormFacts(seasonStorms('al-2005').find((s) => s.id === 'AL122005'));
  const cw = k.coastalWeakening;
  ok(cw && cw.peakWindKt === 150 && cw.landfallWindKt === 110,
    `Katrina peaked at 150 kt and came ashore at 110. Got ${cw?.peakWindKt} -> ${cw?.landfallWindKt}`);
  ok(cw.dropKt === 40, `so she gave up 40 kt. Got ${cw.dropKt}`);
  ok(cw.categoriesDropped === 2,
    `and two Saffir-Simpson categories, 5 down to 3. Got ${cw.categoriesDropped}`);
  ok(categoryShortLabel(cw.peakCategory, 'tropical') === 'Cat 5'
    && categoryShortLabel(cw.landfallCategory, 'tropical') === 'Cat 3',
  '==> GRADED BY THE SAME FUNCTION AS EVERY OTHER CATEGORY IN THE APP. <== A '
    + 'numeric assertion on the index would agree with an off-by-one; the label '
    + 'is the claim a reader sees. Got '
    + `${categoryShortLabel(cw.peakCategory, 'tropical')} -> `
    + `${categoryShortLabel(cw.landfallCategory, 'tropical')}`);
  ok(cw.landfallIndex === 1 && k.landfalls[cw.landfallIndex].windKt === 110,
    '==> AND IT IS THE HARDEST LANDFALL, NOT THE FIRST. <== Katrina crossed '
    + 'Florida at 70 kt before Louisiana at 110, and `lib/season-story.js` calls '
    + 'the Louisiana one the hardest. Two surfaces on one panel naming different '
    + `landfalls would read as a contradiction. Got index ${cw.landfallIndex}`);

  /* ==> THE ANCHOR IS THE PEAK BEFORE THAT LANDFALL, AND OPHELIA IS THE STORM
   * THAT PROVES IT MATTERS. <== She brushed land as a 25 kt depression and only
   * later reached 75 kt out at sea. Anchored on her OVERALL peak the panel
   * would announce that she had been a Category 1 and came ashore a tropical
   * depression — a 50 kt weakening that never happened, stated fluently, about
   * a storm that was not a hurricane on the day it touched the coast.
   *
   * MEASURED 2026-08-29 over the whole mirrored archive: 226 of 1,341 storms
   * with a gradeable landfall reached their overall peak AFTER it. This is
   * 17% of the cases, not a curiosity. */
  const oph = stormFacts(seasonStorms('al-2005').find((s) => s.id === 'AL162005'));
  ok(oph.peakWindKt === 75,
    `Ophelia's overall peak is 75 kt. Got ${oph.peakWindKt}`);
  ok(oph.coastalWeakening.peakWindKt === 25,
    '==> BUT SHE WAS ONLY 25 KT WHEN SHE CAME ASHORE, AND HAD NEVER BEEN '
    + 'STRONGER. <== The anchor must be the peak up to that moment. Got '
    + `${oph.coastalWeakening.peakWindKt}`);
  ok(oph.coastalWeakening.dropKt === 0,
    `so her weakening is zero, and the panel says she came ashore at her `
    + `strongest. Got ${oph.coastalWeakening.dropKt}`);

  /* ==> NO DROP CAN BE NEGATIVE, AND THAT NEEDED THE LANDFALL'S OWN WIND
   * INSIDE THE WINDOW. <== `lib/landfall.js` interpolates the wind at the
   * crossing between the two fixes either side and rounds it, so a
   * strengthening storm can be marginally stronger at the coast than at any
   * fix at or before it. Leaving the landfall out produced 84 negative drops
   * across the archive — a weakening figure claiming the storm got stronger. */
  const everyone = [...seasonStorms('al-2005'), ...seasonStorms('al-2021')].map(stormFacts);
  const graded = everyone.filter((f) => f.coastalWeakening);
  ok(graded.length > 5, `two whole seasons give several gradeable landfalls. Got ${graded.length}`);
  ok(graded.every((f) => f.coastalWeakening.dropKt >= 0),
    'and not one of them weakened by a negative amount');
  ok(graded.every((f) => f.coastalWeakening.categoriesDropped >= 0),
    'nor dropped a negative number of categories');
  ok(everyone.filter((f) => !f.landfalls.length).every((f) => f.coastalWeakening === null),
    '==> A STORM THAT NEVER CAME ASHORE HAS NO ANSWER, NOT A ZERO ONE. <== §5 '
    + 'and §57.25: null is the truth and zero is a claim');

  /* ==> AND THE ABOVE CANNOT PROVE IT, WHICH A MUTATION SAID BEFORE A READING
   * DID. <== Every fixture in this directory uses NOAA's own `L` markers, and
   * those sit ON a row, so a landfall's wind is always exactly some fix's wind
   * and the peak window contains it whether or not anyone put it there. Taking
   * the landfall back out of the window left this whole suite green.
   *
   * The negative drop only exists for the landfalls WE compute (§57.7a), where
   * `lib/landfall.js` interpolates the wind at the coastline crossing between
   * the two fixes either side and rounds it. A storm still strengthening as it
   * hits is therefore marginally stronger at the coast than at any fix at or
   * before it — 84 storms across the archive. Driven directly, because the
   * fixture that would show it does not exist here. */
  const rising = stormFacts({
    id: 'ZZ052000', basin: 'AL', number: 5, year: 2000, name: 'RISING',
    landfallsComputed: [{
      /* Between the 60 kt fix and the 80 kt fix, and after both in wind. */
      time: Date.parse('2000-09-01T09:00:00Z'),
      lat: 25, lon: -80, windKt: 70, pressureMb: null, category: 1, source: 'computed',
    }],
    points: [0, 6, 12].map((h, i) => ({
      time: Date.parse('2000-09-01T00:00:00Z') + h * 3600e3,
      status: 'TS', lat: 24 + i, lon: -80, lonU: -80, windKt: [50, 60, 80][i],
      pressureMb: null, radii: {}, marker: null, rmwNm: null,
    })),
  });
  ok(rising.landfallSource === 'computed' && rising.landfalls.length === 1,
    'the driven storm really is using a computed landfall');
  ok(rising.coastalWeakening.peakWindKt === 70,
    '==> THE STRONGEST IT HAD EVER BEEN, INCLUDING AT THE COAST ITSELF. <== The '
    + 'fixes at or before the crossing top out at 60 kt and the crossing itself '
    + `is 70. Got ${rising.coastalWeakening.peakWindKt}`);
  ok(rising.coastalWeakening.dropKt === 0,
    '==> SO IT WEAKENED BY NOTHING, RATHER THAN BY MINUS TEN KNOTS. <== A '
    + 'negative weakening is a sentence saying the storm got stronger on its way '
    + `ashore, printed under a heading that says it got weaker. Got `
    + `${rising.coastalWeakening.dropKt}`);
}

/* ------------------------------------------------------------------------- */
section('==> HOW FAST IT WAS MOVING — §57.43 <==');
{
  const ida = one('al092021');
  const f = stormFacts(ida);
  const s = f.forwardSpeed;

  ok(s && s.legs > 10, `Ida gives a real walk of legs. Got ${s?.legs}`);
  ok(s.fastestKt > s.slowestKt, 'fastest must exceed slowest');
  ok(s.fastestKt < 60 && s.slowestKt >= 0,
    `==> AND BOTH MUST BE PHYSICALLY POSSIBLE. <== The fastest leg in the whole `
    + `archive is 59.6 kt, measured. Got ${s.fastestKt.toFixed(1)} / `
    + `${s.slowestKt.toFixed(1)}`);

  /* ==> EVERY LEG IS A WHOLE SYNOPTIC STEP, AND IDA IS THE STORM THAT CAN
   * SHOW IT. <== Her Louisiana landfall row is stamped 1655Z. Walk the raw
   * rows and that row cuts one six-hour leg into a 4h55m one and a 1h05m one;
   * every position in the file is rounded to 0.1°, about 6 nm, so a leg that
   * short divides rounding error by a fraction of an hour. Measured across the
   * archive, 2,250 of 71,941 raw legs are under six hours and the worst of
   * them reads 49 kt on a storm that was crawling. Walking the synoptic rows
   * BRIDGES the inserted rows instead of tripping over them. */
  const spans = [];
  {
    const syn = ida.points
      .filter((p) => __internals.isSynoptic(p.time) && __internals.isCyclone(p.status))
      .sort((a, b) => a.time - b.time);
    for (let i = 0; i < syn.length - 1; i++) spans.push((syn[i + 1].time - syn[i].time) / 3600e3);
  }
  ok(spans.length === s.legs,
    `the walk uses exactly the synoptic cyclone legs. Got ${s.legs} against ${spans.length}`);
  ok(spans.every((h) => h <= SEASONS.trackSpeedMaxLegHours),
    'and none of them is longer than the cap');
  ok(ida.points.some((p) => !__internals.isSynoptic(p.time)),
    '==> AND IDA REALLY DOES CARRY OFF-CLOCK ROWS, SO THIS IS NOT VACUOUS. <== '
    + 'A filter asserted against a storm that has nothing to filter is the §12 '
    + 'failure — green over the bug');

  /* ==> A GAP IS NOT A SLOW LEG, AND THE ARCHIVE HAS 63 OF THEM. <== When a
   * storm spends the middle of a stretch as a wave or a low, nobody writes
   * synoptic rows and the two cyclone fixes either side can be days apart.
   * AL062023 has a 228-hour one. Dividing that distance by that time is the
   * straight line between two places the storm happened to be, and reporting
   * it as "slowest" measures the record's silence. Built by hand because no
   * fixture in this directory has the shape. */
  const gapStorm = {
    id: 'ZZ022000', basin: 'AL', number: 2, year: 2000, name: 'GAPPY',
    points: [
      /* Two ordinary six-hour legs, then a five-day hole, then one more. */
      [0, 20], [6, 20], [12, 20], [252, 20], [258, 20],
    ].map(([h, kt], i) => ({
      time: Date.parse('2000-09-01T00:00:00Z') + h * 3600e3,
      status: 'TS', lat: 20 + i * 3, lon: -50, lonU: -50, windKt: kt,
      pressureMb: null, radii: {}, marker: null, rmwNm: null,
    })),
  };
  const gs = stormFacts(gapStorm).forwardSpeed;
  ok(gs.legs === 3,
    `==> THE FIVE-DAY LEG IS DROPPED, NOT DIVIDED. <== Four consecutive pairs, `
    + `one of them a hole. Got ${gs.legs} legs`);
  ok(gs.slowestKt > 5,
    '==> AND THE DROPPED LEG WOULD HAVE BECOME THE "SLOWEST" FIGURE. <== It '
    + 'covers three degrees of latitude in five days, which averages under a '
    + `knot and would have been reported as the storm crawling. Got `
    + `${gs.slowestKt.toFixed(2)} kt`);

  /* Non-cyclone fixes are out, for the same reason `stallWindow` excludes
   * them: a remnant low sprinting northeast in the westerlies is the
   * atmosphere moving, not the storm. */
  const exStorm = {
    id: 'ZZ032000', basin: 'AL', number: 3, year: 2000, name: 'SPRINTER',
    points: [0, 6, 12].map((h, i) => ({
      time: Date.parse('2000-09-01T00:00:00Z') + h * 3600e3,
      status: 'EX', lat: 45 + i * 4, lon: -50, lonU: -50, windKt: 80,
      pressureMb: null, radii: {}, marker: null, rmwNm: null,
    })),
  };
  ok(stormFacts(exStorm).forwardSpeed === null,
    '==> AN EXTRATROPICAL LOW COVERING FOUR DEGREES IN SIX HOURS IS NOT THIS '
    + 'STORM\'S FORWARD SPEED. <== It is on the clock and it is fast, and it is '
    + 'not a tropical cyclone');

  /* ==> THE DATE LINE, AND THE HONEST VERSION OF WHY THIS PASSES. <== Della
   * crosses at record 34 and the haversine handles it for free, because
   * sin(Δλ/2) is periodic — passing raw `lon` gives an identical answer, and
   * that was measured rather than assumed. This assertion exists so that a
   * later session swapping in flat-plane arithmetic loses the protection
   * LOUDLY: on a plane that crossing reads as 359° of travel in six hours. */
  const della = stormFacts(one('cp011957')).forwardSpeed;
  ok(della.fastestKt < 60,
    `Della crosses the antimeridian and her fastest leg stays sane. Got `
    + `${della.fastestKt.toFixed(1)} kt`);

  /* A storm seen once has no distance to divide, and says so with null. */
  const lonely = stormFacts({
    id: 'ZZ042000', basin: 'AL', number: 4, year: 2000, name: 'ONCE',
    points: [{
      time: Date.parse('2000-09-01T00:00:00Z'), status: 'TS',
      lat: 20, lon: -50, lonU: -50, windKt: 40,
      pressureMb: null, radii: {}, marker: null, rmwNm: null,
    }],
  });
  ok(lonely.forwardSpeed === null,
    '==> ONE FIX IS NOT A SPEED OF ZERO. <== 32 storms in the archive were '
    + 'never seen twice on the six-hourly clock');
}

/* ------------------------------------------------------------------------- */
section('==> HOW FAR IT WENT — §57.45 <==');
{
  const harvey = one('al092017');
  const hd = stormFacts(harvey).trackDistance;

  /* ==> EVERY CONSECUTIVE PAIR IS A LEG, WITH NONE OF `forwardSpeed`'s
   * FILTERING. <== This is the whole design of §57.45 in one assertion, and it
   * is the one that goes red the moment somebody "tidies" this walk to match
   * the speed walk above it. Harvey carries 74 fixes and must give 73 legs;
   * the synoptic-and-cyclone walk gives him 36. */
  ok(hd && hd.legs === harvey.points.length - 1,
    `==> NO FIX IS SKIPPED AND NO LEG IS CAPPED. <== Harvey has `
    + `${harvey.points.length} fixes, so 73 legs. Got ${hd?.legs}`);
  ok(hd.legs > stormFacts(harvey).forwardSpeed.legs,
    '==> AND THE TWO WALKS REALLY ARE DIFFERENT, SO THIS IS NOT VACUOUS. <== '
    + 'A distance walk that happened to equal the speed walk would pass the '
    + 'assertion above while being the thing it forbids');

  ok(Math.abs(hd.totalNm - 4350) < 1,
    `Harvey's whole track measures 4,350 nm. Got ${hd.totalNm.toFixed(1)}`);
  ok(Math.abs(hd.cycloneNm - 2297) < 1,
    `and 2,297 nm of it as a tropical cyclone. Got ${hd.cycloneNm.toFixed(1)}`);

  /* ==> THE TWO FIGURES PARTITION THE TRACK, WHICH IS WHY A LEG IS
   * ATTRIBUTED TO THE STATUS AT ITS START. <== Requiring both ends to be a
   * cyclone leaves every transition leg belonging to neither, and the panel's
   * "the gap between the two is ground it covered as a wave" sentence then
   * quietly overstates that gap by six hours of travel per transition.
   * Measured directly rather than by re-deriving the walk: the non-cyclone
   * remainder computed from the start status must add back to the total. */
  {
    const pts = harvey.points.slice().sort((a, b) => a.time - b.time);
    let nonCyclone = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      if (__internals.isCyclone(pts[i].status)) continue;
      nonCyclone += __internals.distanceNm(
        pts[i].lat, pts[i].lonU, pts[i + 1].lat, pts[i + 1].lonU,
      );
    }
    ok(Math.abs((hd.cycloneNm + nonCyclone) - hd.totalNm) < 1e-6,
      `==> CYCLONE MILES PLUS THE REST EQUALS THE WHOLE TRACK, EXACTLY. <== `
      + `Got ${(hd.cycloneNm + nonCyclone).toFixed(4)} against `
      + `${hd.totalNm.toFixed(4)}`);
    ok(nonCyclone > 1000,
      '==> AND HARVEY REALLY DOES HAVE A LARGE NON-CYCLONE STRETCH. <== He '
      + 'crossed the Caribbean as a wave. A partition asserted on a storm that '
      + `was a cyclone throughout proves nothing. Got ${nonCyclone.toFixed(0)} nm`);
  }

  /* A storm that was a cyclone for every fix reports the same figure twice,
   * and that is what keeps the panel's second row off it. */
  const andrew = stormFacts(one('al041992')).trackDistance;
  ok(andrew.cycloneNm === andrew.totalNm,
    `Andrew was a tropical cyclone for every leg of his track. Got `
    + `${andrew.cycloneNm.toFixed(1)} of ${andrew.totalNm.toFixed(1)}`);

  /* ==> THE DATE LINE, AND THE HONEST VERSION OF WHY THIS PASSES. <== The
   * same haversine and the same reasoning as the speed walk: sin(Δλ/2) is
   * periodic, so Della's crossing costs nothing. The assertion exists so that
   * a later session swapping in flat-plane arithmetic loses the protection
   * LOUDLY — on a plane her crossing leg alone reads as roughly 18,000 nm. */
  const della = stormFacts(one('cp011957')).trackDistance;
  ok(Math.abs(della.totalNm - 3029) < 2,
    `Della crosses the antimeridian and her track stays 3,029 nm. Got `
    + `${della.totalNm.toFixed(1)}`);

  /* ==> THE RECORD DOES CONTAIN STORMS IT NEVER MOVES, AND NO FIXTURE IN THIS
   * DIRECTORY HAS THE SHAPE. <== Measured over both mirrored basins
   * 2026-08-29: three of 3,234 storms total under one 0.1° step, and AL051851
   * is the case — sixteen consecutive fixes at 32.5N 73.5W, four days at
   * 50 kt. Built by hand here for the same reason §57.43 built its gap storm.
   * The facts layer reports the real zero; refusing to print it is the
   * renderer's job and `test-season-detail.mjs` holds that half. */
  const stuck = stormFacts({
    id: 'ZZ051851', basin: 'AL', number: 5, year: 1851, name: 'STUCK',
    points: [0, 6, 12, 18].map((h) => ({
      time: Date.parse('1851-09-13T00:00:00Z') + h * 3600e3,
      status: 'TS', lat: 32.5, lon: -73.5, lonU: -73.5, windKt: 50,
      pressureMb: null, radii: {}, marker: null, rmwNm: null,
    })),
  });
  ok(stuck.trackDistance && stuck.trackDistance.totalNm === 0,
    `==> A STORM THE RECORD NEVER MOVES REPORTS A REAL ZERO, NOT A NULL. <== `
    + `Zero is a measurement; null would mean nobody looked. Got `
    + `${stuck.trackDistance?.totalNm}`);
  ok(stuck.trackDistance.legs === 3,
    `and it still walked its three legs. Got ${stuck.trackDistance.legs}`);

  /* One fix is not a distance of zero, exactly as it is not a speed of zero. */
  ok(stormFacts({
    id: 'ZZ062000', basin: 'AL', number: 6, year: 2000, name: 'ONCE',
    points: [{
      time: Date.parse('2000-09-01T00:00:00Z'), status: 'TS',
      lat: 20, lon: -50, lonU: -50, windKt: 40,
      pressureMb: null, radii: {}, marker: null, rmwNm: null,
    }],
  }).trackDistance === null,
    '==> ONE FIX IS NOT A TRACK OF ZERO LENGTH. <== It is a storm nobody '
    + 'measured twice, which is a different sentence on the panel');

  /* ==> THE CLAIM THAT THE FILE HAS NO GAPS IS ASSERTED, NOT REMEMBERED. <==
   * §57.45 gives this walk no leg cap on the strength of one measurement:
   * 84,365 consecutive legs across both mirrored basins, not one longer than
   * six hours, the worst exactly 6.00. If that ever stops being true the walk
   * needs a cap and this is what says so. Checked against every fixture here
   * rather than the whole archive, which no suite may read. */
  {
    let worst = 0;
    for (const f of ['al092017', 'al182012', 'al041992', 'al122005', 'cp011957',
      'al092021', 'al011851', 'al031935']) {
      const pts = one(f).points.slice().sort((a, b) => a.time - b.time);
      for (let i = 0; i < pts.length - 1; i++) {
        worst = Math.max(worst, (pts[i + 1].time - pts[i].time) / 3600e3);
      }
    }
    ok(worst <= SEASONS.trackSpeedMaxLegHours,
      `==> AND THAT IS WHY THIS WALK NEEDS NO LEG CAP. <== The longest gap `
      + `between two consecutive rows in any fixture here is ${worst} hours`);
  }
}

/* ------------------------------------------------------------------------- */
section('==> WHERE IT STOOD IN ITS OWN SEASON — §57.43 <==');
{
  const all = seasonStorms('al-2005').map(stormFacts);
  const rank = (id) => rankInSeason(all.find((f) => f.id === id), all);

  const k = rank('AL122005');
  ok(k.storms === 31, `2005 held 31 storms. Got ${k.storms}`);
  ok(k.strength.rank === 3 && k.strength.of === 31,
    `==> KATRINA IS THIRD, BEHIND WILMA AND RITA. <== Got ${k.strength.rank} `
    + `of ${k.strength.of}`);
  ok(k.strength.tied === 1, `and nothing ties her 150 kt. Got ${k.strength.tied}`);

  const w = rank('AL252005');
  ok(w.strength.rank === 1 && w.strength.tied === 1,
    `Wilma's 160 kt is the outright strongest. Got rank ${w.strength.rank}, `
    + `tied ${w.strength.tied}`);

  /* ==> TIES ARE NOT AN EDGE CASE AND THE RECORD IS WHY. <== HURDAT2 writes
   * wind in five-knot steps, so seasons draw at the top constantly: measured
   * 2026-08-29, 54 of 294 seasons have a tied strongest storm and 12 have a
   * tie for longest-lived. Claiming an outright winner where the record shows
   * a draw would put the same claim on two different storms' panels. */
  ok(all.some((f) => rankInSeason(f, all).strength.tied > 1),
    '2005 contains at least one tied strength rank, so the case below is real');
  {
    /* Standard competition ranking: two storms tied at Nth are both Nth and
     * the next one down is (N+2)th, never (N+1)th. */
    const byWind = all.slice().sort((a, b) => b.peakWindKt - a.peakWindKt);
    const ranks = byWind.map((f) => rankInSeason(f, all).strength.rank);
    ok(ranks[0] === 1, 'the strongest is first');
    ok(ranks.every((r, i) => i === 0 || r >= ranks[i - 1]),
      'and ranks never go backwards down the sorted list');
    const dupIndex = byWind.findIndex((f, i) => i > 0 && f.peakWindKt === byWind[i - 1].peakWindKt);
    ok(dupIndex > 0 && ranks[dupIndex] === ranks[dupIndex - 1],
      '==> TWO STORMS ON THE SAME WIND SHARE A RANK. <== Got '
      + `${ranks[dupIndex - 1]} and ${ranks[dupIndex]}`);
    const after = byWind.findIndex((f, i) => i > dupIndex && f.peakWindKt !== byWind[dupIndex].peakWindKt);
    ok(after > 0 && ranks[after] === after + 1,
      '==> AND THE NEXT STORM DOWN SKIPS THE PLACE THE TIE CONSUMED. <== A tie '
      + 'for 2nd is followed by 4th, not 3rd, or the season has two storms '
      + `claiming third. Got ${ranks[after]} at position ${after + 1}`);

    /* ==> AND THE TIED RANK'S OWN VALUE IS ASSERTED, WHICH THE THREE CHECKS
     * ABOVE DO NOT DO. <== A mutation run caught this: counting ties into
     * "above" shifts every tied rank down by one and leaves every untied one
     * alone, so the ordering and the skip both stayed green while two storms
     * drawing for 4th were both reported 5th. */
    const tiedWind = byWind[dupIndex].peakWindKt;
    const strictlyAbove = all.filter((f) => f.peakWindKt > tiedWind).length;
    ok(ranks[dupIndex] === strictlyAbove + 1,
      '==> A TIE TAKES THE PLACE ABOVE IT, NOT THE PLACE BELOW. <== Two storms '
      + `beaten by ${strictlyAbove} others are both ${strictlyAbove + 1}. Got `
      + `${ranks[dupIndex]}`);
  }

  ok(rankInSeason(all[0], [all[0]]) === null,
    '==> A ONE-STORM SEASON HAS NO RANKING. <== "1st strongest of 1" tells the '
    + 'reader nothing while looking like it told them something, and 24 seasons '
    + 'in the archive are that shape');
  ok(rankInSeason(all[0], []) === null, 'and neither has an empty one');

  /* ==> THE ONLY-MAJOR FLAG NAMES ONE STORM, NOT THE WHOLE SEASON. <== It is
   * built by hand because 2005 had seven majors; 67 seasons in the archive had
   * exactly one. If it were a season-level fact the sentence would appear on
   * every storm in that season, including the ones that were not it. */
  const majors = all.filter((f) => f.peakWindKt >= SEASONS.majorKt);
  ok(majors.length === 7, `2005 had seven majors. Got ${majors.length}`);
  ok(all.every((f) => rankInSeason(f, all).onlyMajor === false),
    'so nothing in 2005 is the only one');
  const trio = [majors[0], ...all.filter((f) => f.peakWindKt < SEASONS.majorKt).slice(0, 3)];
  ok(rankInSeason(trio[0], trio).onlyMajor === true,
    'a season with one major flags that storm');
  ok(trio.slice(1).every((f) => rankInSeason(f, trio).onlyMajor === false),
    '==> AND FLAGS NONE OF THE OTHERS. <== The id is checked, not the count');

  /* A storm ranked against a season it is not in has no standing in it. */
  ok(rankInSeason(all[0], all.slice(1)) === null,
    'a storm that is not in the list gets no rank rather than a wrong one');

  /* ==> THE DENOMINATOR IS THE STORMS THAT CARRY THE FIGURE, AND 2005 CANNOT
   * SHOW IT. <== Every storm in the mirrored archive has a peak wind, so
   * replacing the graded filter with the whole list left this suite green.
   * The case is real all the same — the season still running arrives from ATCF
   * b-decks (§57.11), where a fix can carry no wind at all — and counting an
   * unmeasured storm into "of 31" quietly makes every other rank a claim about
   * a different set. Driven directly, because no fixture has the shape. */
  const blind = {
    id: 'ZZ062000', basin: 'AL', number: 6, year: 2000, name: 'BLIND',
    peakWindKt: null, lifespanHours: 24,
  };
  const mixed = [all[0], all[1], blind];
  const r = rankInSeason(all[0], mixed);
  ok(r.strength.of === 2,
    '==> THE STORM NOBODY MEASURED IS NOT THE WEAKEST OF THE SEASON. <== It is '
    + `outside the comparison entirely. Got "of ${r.strength.of}"`);
  ok(r.storms === 3,
    'though the season still held three storms, and that count is a different '
    + `question from the ranking\u2019s denominator. Got ${r.storms}`);
  ok(rankInSeason(blind, mixed).strength === null,
    'and the unmeasured storm itself gets no strength rank at all');
}

/* ------------------------------------------------------------------------- */
section('a b-deck storm carries the same shape, and its own stamp');
{
  const { storm: lala } = parseBdeck(bdeck('bcp012026'), { id: 'CP012026' });
  const f = stormFacts(lala);

  ok(f.provisional === true,
    '==> OPERATIONAL, NOT REVIEWED. <== §57.11: NOAA revises a b-deck months later, and the '
    + 'panel must be able to stamp the difference rather than presenting both as the record');
  ok(Number.isFinite(f.peakWindKt) && f.peakWindKt >= 100,
    `Lala's peak must come through the same code path. Got ${f.peakWindKt}`);
  ok(Number.isFinite(f.ace) && f.ace > 0, 'and ACE computes on operational data too');

  const s = seasonFacts([lala], { year: 2026, basin: 'CP' });
  ok(s.provisional === true, 'and a season containing one provisional storm is provisional');
}

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
