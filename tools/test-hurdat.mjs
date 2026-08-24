#!/usr/bin/env node
/**
 * test-hurdat.mjs — the history parser, against bytes NOAA published.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-hurdat.mjs`, same as every other
 * suite here (§12 — this project has no toolchain by design).
 *
 * ==> EVERY FIXTURE IS REAL AND EACH ONE IS HERE FOR A NAMED REASON. <== They
 * were cut out of the full 6.75 MB Atlantic and 3.89 MB Pacific files on a
 * GitHub runner (`tools/seasons-fixtures.mjs`) at storm boundaries, unedited.
 * `samples/seasons/HOW-THESE-WERE-CUT.md` says which storm proves what.
 *
 * ==> THE FOUR ASSERTIONS THAT MATTER ARE THE FOUR SILENT BUGS. <== Each was
 * verified by reintroducing the bug and watching this suite go red — the §12
 * rule that a test passing on the same wrong assumption as the code is worse
 * than no test at all.
 *
 *   1. ATCF MERGE. Three lines share a timestamp, one per wind threshold. A
 *      reader that overwrites keeps one and silently drops the other two.
 *      Verified red by replacing the merge with an assignment.
 *   2. THE B-DECK NAME. It changes DOWN the file. Reading the first row labels
 *      Bertha `GENESIS004`. Verified red by taking the first non-placeholder.
 *   3. THE DATELINE. Della's longitude jumps 359.1° at record 35. Verified red
 *      by returning `lon` unchanged as `lonU`.
 *   4. NO YEAR GATES. AL011852 carries a radius of maximum wind in 1852, so
 *      "RMW exists from 2021" is a generality and not a rule. Verified red by
 *      nulling RMW before 2021.
 *
 * WHAT THIS CANNOT PROVE: that a track READS correctly on a globe. That is a
 * phone.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { parseHurdat2, parseBdeck, parseStormId, isRealStorm, groupBySeason } =
  await import('../lib/hurdat.js');
const { SEASONS } = await import('../config/constants.js');

const storm = (f) => readFileSync(`samples/seasons/storms/${f}.txt`, 'utf8');
const bdeck = (f) => readFileSync(`samples/seasons/bdecks/${f}.dat`, 'utf8');
const season = (f) => readFileSync(`samples/seasons/seasons/${f}.txt`, 'utf8');

const one = (text) => {
  const r = parseHurdat2(text);
  return { s: r.storms[0], faults: r.faults };
};

/* ------------------------------------------------------------------------- */
section('storm ids and the §57.13 filter');
{
  const p = parseStormId('AL092021');
  ok(p && p.basin === 'AL' && p.number === 9 && p.year === 2021,
    `AL092021 must read as Atlantic storm 9 of 2021. Got ${JSON.stringify(p)}`);

  ok(parseStormId('nonsense') === null, 'a non-id must return null, not a guess');
  ok(parseStormId('') === null, 'an empty id must return null');

  ok(isRealStorm('AL092021'), 'a numbered storm is real');
  ok(!isRealStorm('AL922026'),
    'invest 92 must be filtered — those numbers are REUSED inside one season, '
    + 'so an unfiltered mirror ships three different systems all called 92');
  ok(!isRealStorm('AL852026'), 'test system 85 must be filtered');
  ok(!isRealStorm('XX012021'), 'a basin NHC does not publish must be filtered');
}

/* ------------------------------------------------------------------------- */
section('IDA 2021 — the hand-check, against NOAA\'s own written report');
{
  const { s, faults } = one(storm('al092021'));

  ok(faults.length === 0, `Ida must parse with no faults. Got ${JSON.stringify(faults)}`);
  ok(s.id === 'AL092021' && s.name === 'IDA', `Ida's header must read out. Got ${s.id} ${s.name}`);
  ok(s.points.length === 40, `Ida has 40 records in the file. Got ${s.points.length}`);
  ok(s.provisional === false, 'HURDAT2 is the REVIEWED database, so nothing from it is provisional');

  /* Every figure below is stated in `samples/ida-al092021/tcr-AL092021_Ida.txt`,
   * NOAA's own Tropical Cyclone Report — a DIFFERENT document from the one
   * being parsed. Two independent NOAA sources agreeing is the strongest check
   * available without a phone. */
  const lf = s.points.filter((p) => p.marker === 'L');
  ok(lf.length === 3, `Ida made three marked landfalls. Got ${lf.length}`);

  const la = lf[2];
  ok(la.windKt === 130,
    `the report puts the Louisiana landfall at 130 kt. Got ${la.windKt}`);
  ok(la.pressureMb === 931,
    `the report puts the Louisiana landfall pressure near 931 mb. Got ${la.pressureMb}`);
  ok(Math.abs(la.lat - 29.1) < 0.001 && Math.abs(la.lon - (-90.2)) < 0.001,
    `the Louisiana landfall is 29.1N 90.2W. Got ${la.lat} ${la.lon}`);

  const cuba = lf[1];
  ok(new Date(cuba.time).toISOString() === '2021-08-27T23:25:00.000Z',
    `the report puts the mainland Cuba landfall at 2325 UTC. Got ${new Date(cuba.time).toISOString()}`);

  const lowest = Math.min(...s.points.filter((p) => p.pressureMb != null).map((p) => p.pressureMb));
  ok(lowest === 929, `the report gives 929 mb as Ida's minimum pressure. Got ${lowest}`);

  /* ==> A LANDFALL ROW IS NOT ON THE SIX-HOUR CLOCK. <== 1655Z and 2325Z are
   * both in this file, which is exactly why ACE cannot sum every row. */
  ok(new Date(la.time).getUTCMinutes() === 55,
    'Ida\'s Louisiana landfall is stamped at 55 minutes past — an inserted record, not a synoptic one');
}

/* ------------------------------------------------------------------------- */
section('the wind field — twelve numbers on one row, grouped by threshold');
{
  const { s } = one(storm('al092021'));
  const peak = s.points.reduce((a, b) => (b.windKt > a.windKt ? b : a));

  ok(peak.radii.r34 && peak.radii.r50 && peak.radii.r64,
    'a 2021 storm at peak carries all three wind thresholds');
  ok(peak.radii.r34.ne === 130 && peak.radii.r34.se === 110
    && peak.radii.r34.sw === 80 && peak.radii.r34.nw === 110,
    `the 34 kt quadrants must read NE/SE/SW/NW in that order. Got ${JSON.stringify(peak.radii.r34)}`);
  ok(peak.radii.r64.ne > peak.radii.r64.sw,
    'the 64 kt core must be smaller to the southwest than the northeast on this record');

  /* The groups are nested largest to smallest. A reader that mixed up the
   * three column blocks would break this without breaking anything above. */
  ok(peak.radii.r34.ne > peak.radii.r50.ne && peak.radii.r50.ne > peak.radii.r64.ne,
    '34 kt reaches further than 50 kt, which reaches further than 64 kt');
}

/* ------------------------------------------------------------------------- */
section('==> NO YEAR GATES. THE SENTINEL IS READ PER ROW. <==');
{
  /* ANDREW 1992 — before the 2004 wind-radii cliff. */
  const andrew = one(storm('al041992')).s;
  ok(andrew.name === 'ANDREW', `AL041992 must be ANDREW. Got ${andrew.name}`);
  ok(andrew.points.every((p) => !p.radii.r34 && !p.radii.r50 && !p.radii.r64),
    'Andrew predates the wind-radii era, so every group must be null rather than a row of -999s');
  ok(andrew.points.some((p) => p.pressureMb != null),
    'Andrew DOES carry pressure — the cliffs are not all in the same place');
  ok(andrew.points.some((p) => p.marker === 'L'),
    'Andrew is 1992, past the end of §57.7\'s landfall hole, so his landfalls ARE marked');

  /* ==> HUGO 1989 DISPROVES §57.7, AND THE SPEC IS FIXED RATHER THAN THIS
   * TEST. <== §57.7 said continental US landfalls are marked only for
   * 1851-1970 and 1991 onward, and that the app would therefore have to
   * compute the missing twenty years itself against a coastline. Hugo is
   * 1989, squarely inside the claimed hole, and NOAA marks all five of his
   * landfalls INCLUDING Sullivan's Island, South Carolina at 0400Z on 22
   * September. The gap has been backfilled at some point since whatever
   * document that claim came from. This assertion is now what was measured. */
  const hugo = one(storm('al111989')).s;
  ok(hugo.name === 'HUGO', `AL111989 must be HUGO. Got ${hugo.name}`);
  const hugoLf = hugo.points.filter((p) => p.marker === 'L');
  ok(hugoLf.length === 5, `Hugo carries five marked landfalls. Got ${hugoLf.length}`);
  const carolina = hugoLf[hugoLf.length - 1];
  ok(Math.abs(carolina.lat - 32.8) < 0.001 && Math.abs(carolina.lon - (-79.8)) < 0.001,
    `Hugo's US landfall IS marked, at 32.8N 79.8W. Got ${carolina.lat} ${carolina.lon}`);
  ok(carolina.windKt === 120 && carolina.pressureMb === 934,
    `and it carries 120 kt and 934 mb. Got ${carolina.windKt} ${carolina.pressureMb}`);
  ok(hugo.points.some((p) => Number.isFinite(p.rmwNm)),
    'Hugo also carries a radius of maximum wind in 1989 — a THIRD storm contradicting '
    + 'the 2021 cliff, which is why nothing in this parser asks what year it is');

  /* ==> AL011852 CARRIES A RADIUS OF MAXIMUM WIND. IN 1852. <== §57.6 puts
   * that cliff at 2021, and this row is why nothing in the parser asks what
   * year it is. Found by rule, not by hand — the cutter went looking. */
  const s1852 = one(storm('al011852')).s;
  const rmw = s1852.points.filter((p) => Number.isFinite(p.rmwNm));
  ok(rmw.length === 1 && rmw[0].rmwNm === 10,
    `AL011852 carries exactly one real RMW, 10 nm, on its landfall row. Got ${JSON.stringify(rmw.map((p) => p.rmwNm))}`);
  ok(s1852.year === 1852, 'and it is 1852, which is 169 years before the stated cliff');

  /* -99 — no intensity ever assigned, a different absence from -999, and it
   * sits on ONE row of a storm whose other four rows carry a real wind. A
   * whole-storm assertion would have passed on a parser that nulled the lot. */
  const noInt = one(storm('al021971')).s;
  const nullWinds = noInt.points.filter((p) => p.windKt === null);
  ok(nullWinds.length === 1,
    `exactly one of AL021971's five rows is -99. Got ${nullWinds.length} null winds`);
  ok(noInt.points.filter((p) => p.windKt === 25).length === 3,
    'and the three 25 kt rows either side of it must survive unchanged — a parser that '
    + 'nulls a whole storm on one bad row loses real data');
  ok(!noInt.points.some((p) => p.windKt === -99 || p.windKt === 0),
    'a -99 wind must become null, not -99 and not 0 — a storm graded at minus ninety-nine knots '
    + 'would sort below every real storm, and one graded 0 would paint as a calm sea');
}

/* ------------------------------------------------------------------------- */
section('==> THE DATELINE — DELLA, CP011957 <==');
{
  const della = one(storm('cp011957')).s;
  ok(della.name === 'DELLA', `CP011957 must be DELLA. Got ${della.name}`);

  const pts = della.points;
  const rawSteps = pts.slice(1).map((p, i) => Math.abs(p.lon - pts[i].lon));
  const uSteps = pts.slice(1).map((p, i) => Math.abs(p.lonU - pts[i].lonU));

  ok(Math.max(...rawSteps) > 350,
    `the PUBLISHED longitudes must contain the 359-degree lie — that is what the fix is for. `
    + `Biggest raw step ${Math.max(...rawSteps).toFixed(1)}deg`);
  ok(Math.max(...uSteps) < 5,
    `==> UNWRAPPED, NO STEP MAY EXCEED A REAL SIX-HOUR MOVE. <== A 359-degree step handed to `
    + `a map is a line instructed to travel the long way round the planet, and it draws exactly `
    + `that. Biggest unwrapped step ${Math.max(...uSteps).toFixed(1)}deg`);

  ok(pts.some((p) => p.lon > 0) && pts.some((p) => p.lon < 0),
    'Della really does publish both hemispheres — she crosses, she is not a synthetic case');
  ok(pts.every((p) => p.lonU < 0),
    'unwrapped, her whole track stays in one continuous frame west of the anchor');
  ok(pts[0].lonU === pts[0].lon,
    'the first point must keep its published value — nothing translates a track that never crosses');

  /* A storm that never goes near the seam must be untouched. */
  const ida = one(storm('al092021')).s;
  ok(ida.points.every((p) => p.lonU === p.lon),
    'Ida never approaches the antimeridian, so the unwrap must be a no-op on her');

  /* An EAST longitude in the ATLANTIC file — a different case from the seam,
   * and a parser that assumes "Atlantic means west, negate the number" gets
   * this storm's whole second half backwards. */
  const s1932 = one(storm('al041932')).s;
  ok(s1932.points.some((p) => p.lon > 0),
    'AL041932 runs east past the prime meridian and must keep its positive longitudes');
  const east = s1932.points.filter((p) => p.lon > 0);
  ok(Math.max(...east.map((p) => p.lon)) > 40,
    `it reaches past 40E. Got ${Math.max(...east.map((p) => p.lon)).toFixed(1)}`);
  ok(s1932.points.every((p, i, a) => i === 0 || Math.abs(p.lonU - a[i - 1].lonU) < 15),
    'crossing the PRIME meridian is continuous in signed degrees and must not be "corrected" into a jump');
}

/* ------------------------------------------------------------------------- */
section('unnamed storms, and a header that is a placeholder rather than a name');
{
  const labor = one(storm('al031935')).s;
  ok(labor.name === null,
    '==> `UNNAMED` IS NOT A NAME. <== It must come back as null so the roster can say '
    + `"Storm 3, 1935" rather than printing NOAA's placeholder at a reader. Got ${labor.name}`);
  ok(labor.number === 3 && labor.year === 1935, 'and the id still identifies it');

  const first = one(storm('al011851')).s;
  ok(first.points.length === 14, `AL011851 has 14 records. Got ${first.points.length}`);
  ok(first.points.every((p) => p.pressureMb === null),
    '1851 has no pressure at all — every -999 must be null, never 0 and never -999');
}

/* ------------------------------------------------------------------------- */
section('a whole season, and the header row count is checked rather than trusted');
{
  const r = parseHurdat2(season('al-2005'));
  ok(r.faults.length === 0,
    `the 2005 Atlantic season must parse clean. Got ${JSON.stringify(r.faults.slice(0, 3))}`);
  ok(r.storms.length === 31, `2005 holds 31 storms in the file. Got ${r.storms.length}`);
  ok(r.storms.every((s) => s.year === 2005), 'every storm in the cut belongs to 2005');
  ok(r.storms.some((s) => s.name === 'KATRINA'), '2005 must contain KATRINA');

  const grouped = groupBySeason(r.storms);
  ok(grouped.size === 1, `one basin, one year, one group. Got ${grouped.size}`);
  ok(grouped.get('AL-2005').storms[0].number === 1, 'a season is ordered by storm number');

  /* ==> A ROW-COUNT MISMATCH IS A FAULT, NOT A SHRUG. <== The header carries
   * its own count and it is the only integrity signal the format offers. */
  const broken = season('al-2005').replace('AL012005,', 'AL012005,').split('\n');
  const hdr = broken.findIndex((l) => l.startsWith('AL012005'));
  const parts = broken[hdr].split(',');
  parts[2] = ' 999';
  broken[hdr] = parts.join(',');
  const bad = parseHurdat2(broken.join('\n'));
  ok(bad.faults.some((f) => f.kind === 'row_count_mismatch'),
    'a header claiming 999 rows over a storm with far fewer must be reported');
  ok(bad.storms.length === 31,
    'and the other thirty storms must survive — one bad header must not lose a season');
}

/* ------------------------------------------------------------------------- */
section('==> ATCF: ONE LINE PER WIND THRESHOLD, SO THE READER MERGES <==');
{
  const { storm: lala, faults } = parseBdeck(bdeck('bcp012026'), { id: 'CP012026' });
  ok(faults.length === 0, `Lala's b-deck must parse clean. Got ${JSON.stringify(faults.slice(0, 3))}`);
  ok(lala.name === 'LALA', `the LAST real name wins. Got ${lala.name}`);
  ok(lala.provisional === true,
    'a b-deck is what forecasters wrote at the time, and the app must be able to stamp it');

  const peak = lala.points.reduce((a, b) => (b.windKt > a.windKt ? b : a));
  ok(peak.radii.r34 && peak.radii.r50 && peak.radii.r64,
    '==> ALL THREE THRESHOLDS MUST SURVIVE ONE TIMESTAMP. <== They arrive as three separate '
    + 'lines repeating the same position. A reader that assigns instead of merging keeps '
    + `whichever came last and throws the other two away, silently. Got ${JSON.stringify(peak.radii)}`);
  /* Guarded: with the merge broken this is null, and a THROWN suite names its
   * line number rather than its finding. A red line that reads is the point. */
  ok(!!peak.radii.r34 && !!peak.radii.r64 && peak.radii.r34.ne > peak.radii.r64.ne,
    'and they must land in the right slots — 34 kt reaching further than 64 kt');

  /* The count is the proof the merge happened rather than the file being
   * one-line-per-time. Three lines, one point. */
  const lines = bdeck('bcp012026').split('\n').filter((l) => l.trim()).length;
  ok(lines > lala.points.length * 1.5,
    `${lines} lines collapsed to ${lala.points.length} points — if these were equal the merge `
    + 'would never have been exercised and this whole section would be testing nothing');
}

/* ------------------------------------------------------------------------- */
section('==> AND THE B-DECK NAME CHANGES DOWN THE FILE <==');
{
  const raw = bdeck('bal022026');
  const names = [...new Set(raw.split('\n').filter((l) => l.trim())
    .map((l) => (l.split(',')[SEASONS.atcf.name] || '').trim()))];
  ok(names.length > 1,
    `Bertha's file must carry more than one name or this assertion tests nothing. Got ${names.join(', ')}`);
  ok(names[0].startsWith('GENESIS'),
    `and the FIRST one must be an internal counter — that is the trap. Got ${names[0]}`);

  const { storm: bertha } = parseBdeck(raw, { id: 'AL022026' });
  ok(bertha.name === 'BERTHA',
    `reading the first row labels this storm ${names[0]}. The last real name is the answer. Got ${bertha.name}`);

  /* A one-line-per-time storm looks identical to a format that does not do the
   * threshold split at all. It is here so nobody concludes the merge is
   * untested by finding a weak storm that never exercises it. */
  const { storm: weak } = parseBdeck(bdeck('bal012026'), { id: 'AL012026' });
  ok(weak && weak.points.length > 0, 'a weak storm still parses');
  ok(weak.points.every((p) => !p.radii.r64),
    'and never reaching 64 kt, it carries no 64 kt field — which is why a weak storm '
    + 'cannot prove the merge works');
}

/* ------------------------------------------------------------------------- */
section('ATCF coordinates are TENTHS, and HURDAT2 coordinates are not');
{
  const { storm: lala } = parseBdeck(bdeck('bcp012026'), { id: 'CP012026' });
  ok(lala.points.every((p) => Math.abs(p.lat) <= 90),
    '==> `205N` IS 20.5, NOT 205. <== A parser reading the digits as degrees produces '
    + 'coordinates hundreds of degrees off, which on a globe wraps to a plausible-looking '
    + 'wrong place instead of failing');
  ok(lala.points.every((p) => Math.abs(p.lon) <= 180),
    'and `1685W` is -168.5, not -1685');

  const ida = one(storm('al092021')).s;
  ok(Math.abs(ida.points[0].lat - 16.5) < 0.001,
    `HURDAT2 writes DECIMAL degrees, so \`16.5N\` is 16.5. Got ${ida.points[0].lat}`);
}

/* ------------------------------------------------------------------------- */
section('bad input is reported, never guessed at and never thrown');
{
  const empty = parseHurdat2('');
  ok(empty.storms.length === 0 && empty.faults.length === 0, 'empty text is empty, not an error');

  const junk = parseHurdat2('this is not a hurdat file\nnor is this\n');
  ok(junk.storms.length === 0, 'junk produces no storms');
  ok(junk.faults.length > 0, 'and it DOES produce faults — silence on a broken file is §5');

  const shortRow = 'AL012021,               ALPHA,      2,\n'
    + '20210101, 0000,  , TS, 10.0N,  50.0W,  40, 1000\n'
    + '20210101, 0600,  , TS, 10.5N,  50.5W,  45, 1000, 0,0,0,0, 0,0,0,0, 0,0,0,0, 20\n';
  const sr = parseHurdat2(shortRow);
  ok(sr.faults.some((f) => f.kind === 'bad_row_width'),
    'a row that is not 21 fields wide must be reported by width, not silently half-read');
  ok(sr.storms[0].points.length === 1,
    'and the GOOD row on either side of it must survive');

  const noPoints = parseBdeck('');
  ok(noPoints.storm === null, 'an empty b-deck yields no storm rather than an empty husk');
}

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
