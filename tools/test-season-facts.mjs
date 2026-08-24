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
const { stormFacts, seasonFacts, __internals } = await import('../lib/season-facts.js');
const { categoryShortLabel } = await import('../lib/category.js');
const { SEASONS } = await import('../config/constants.js');

const storm = (f) => readFileSync(`samples/seasons/storms/${f}.txt`, 'utf8');
const season = (f) => readFileSync(`samples/seasons/seasons/${f}.txt`, 'utf8');
const bdeck = (f) => readFileSync(`samples/seasons/bdecks/${f}.dat`, 'utf8');
const one = (f) => parseHurdat2(storm(f)).storms[0];
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
