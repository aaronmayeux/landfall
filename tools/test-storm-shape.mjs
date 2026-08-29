#!/usr/bin/env node
/**
 * test-storm-shape.mjs — the comeback, the season window and the origin.
 * SPEC-SEASONS-BUILD.md §57.48, §57.42 Tier 1 items 4, 6 and 8.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-storm-shape.mjs`.
 *
 * ==> IT WALKS THE WHOLE MIRRORED ARCHIVE, AND THAT IS THE POINT RATHER THAN
 * AN EXTRAVAGANCE. <== 3,266 storms parse in about 650 ms, measured
 * 2026-08-29, so the four counts these rules produce can be ASSERTED rather
 * than written into a comment and trusted. Every one of those counts is a
 * number a design decision was made on:
 *
 * - **14 comebacks**, which is why the floor is 34 kt and not 64. At 64 it is
 *   181 storms — a qualifier that fires too often to be worth a sentence.
 * - **11 Atlantic storms east of 30°W and north of 20°N**, which is why
 *   `origin` has three answers instead of two. A boolean tells each of those
 *   it formed inside the basin, which is false and reads perfectly.
 * - **41 East Pacific storms formed between May 15 and May 31**, which is why
 *   the season windows are per basin. One Atlantic window tells every one of
 *   them it beat its own season.
 * - **182 Cape Verde storms**, the denominator behind the origin sentence.
 *
 * A comment holding those numbers goes stale the first time a rule moves and
 * nothing says so. An assertion goes red.
 *
 * ==> AND THE ARCHIVE FILES READ HERE ARE THE WHOLE-BASIN ONES, NOT A GLOB.
 * <== §57.42. `seasons/data/` holds the per-season slices AND the two
 * whole-basin files, so a glob over `*.txt` counts every storm twice and
 * produces an exact 2× that looks like real data.
 *
 * WHAT THIS CANNOT PROVE: whether the three sentences READ well on a phone.
 * That is glass.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { parseHurdat2 } = await import('../lib/hurdat.js');
const { comeback, seasonWindow, origin, trackLoop, __internals } = await import('../lib/storm-shape.js');
const { biggestCrossing, crossing, loopWidthNm } = __internals;
const { stormFacts } = await import('../lib/season-facts.js');
const {
  comebackHtml, seasonWindowHtml, originHtml, loopHtml,
} = await import('../ui/season-shape-markup.js');
const { SEASONS } = await import('../config/constants.js');

const storm = (f) => parseHurdat2(readFileSync(`samples/seasons/storms/${f}.txt`, 'utf8')).storms[0];
const ordered = (s) => s.points.slice().sort((a, b) => a.time - b.time);
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
/** A UTC timestamp from a month and day, for driving `seasonWindow` directly.
 *  The year is arbitrary and never read — the rule compares month and day. */
const at = (month, dayOfMonth) => Date.UTC(2020, month - 1, dayOfMonth);

/* ------------------------------------------------------------------------- */
section('JEANNE 2004 — the comeback, end to end through stormFacts');
{
  const f = stormFacts(storm('al112004'));
  const cb = f.comeback;

  ok(!!cb, 'Jeanne made a comeback and `stormFacts` carries it');
  ok(cb.fellKt === 30,
    `she fell to 30 kt, under the ${SEASONS.comebackFloorKt} kt floor. Got ${cb.fellKt}`);
  ok(day(cb.fellTime) === '2004-09-17',
    `and she was down there on 2004-09-17. Got ${day(cb.fellTime)}`);
  ok(day(cb.backTime) === '2004-09-20',
    `and a hurricane again on 2004-09-20. Got ${day(cb.backTime)}`);
  ok(cb.firstHurricaneTime < cb.fellTime && cb.fellTime < cb.backTime,
    '==> THE THREE STAGES ARE IN ORDER, AND ORDER IS THE WHOLE RULE. <== Every storm on '
    + 'record starts under 34 kt and many reach 64, so a test that only asks whether the '
    + 'storm was ever weak and ever strong is true of the entire archive');

  const html = comebackHtml(cb);
  ok(html.includes('30 knots'), `the sentence names the wind it fell to. Got: ${html}`);
  ok(html.includes('hurricane again'), 'and says it came back');
}

/* ------------------------------------------------------------------------- */
section('THE COMEBACK IS RARE, AND THE FLOOR IS WHAT MAKES IT RARE');
{
  const all = [];
  for (const f of ['seasons/data/hurdat2-atlantic-2025-02272026.txt',
    'seasons/data/hurdat2-epacific-2025-02272026.txt']) {
    all.push(...parseHurdat2(readFileSync(f, 'utf8')).storms);
  }

  ok(all.length === 3266,
    '==> THE DENOMINATOR IS THE WHOLE-BASIN FILES, READ ONCE. <== §57.42: a glob over '
    + `\`seasons/data/*.txt\` reads every storm twice and returns 6,532. Got ${all.length}`);

  const backs = all.filter((s) => comeback(ordered(s)));
  ok(backs.length === 14,
    `14 storms in the archive fell to a depression and came back a hurricane. Got ${backs.length}`);

  const names = backs.map((s) => `${s.id}`);
  for (const id of ['AL112004', 'AL112009', 'AL292020', 'EP101994', 'EP102024']) {
    ok(names.includes(id), `and ${id} is one of them`);
  }

  /* ==> JOHN 2024 IS `DB` AT HIS LOW POINT AND HE IS THE REASON THERE IS NO
   * STATUS FILTER. <== He came ashore in Mexico, fell to pieces over land and
   * rebuilt into a hurricane offshore. The tidy-up that requires a cyclone
   * status at the bottom — the rule `forwardSpeed` and ACE both correctly
   * apply — deletes exactly this storm, and nothing about the result looks
   * wrong. */
  const john = all.find((s) => s.id === 'EP102024');
  const johnBack = comeback(ordered(john));
  ok(!!johnBack,
    '==> A STATUS FILTER ON THE COMEBACK SILENTLY DELETES JOHN 2024. <== He came ashore in '
    + 'Mexico, fell to pieces over land and rebuilt into a hurricane offshore, which is the '
    + 'best example of the fact this sentence exists to state. The tidy-up that requires a '
    + 'cyclone status at the low point — the rule `forwardSpeed` and ACE both correctly '
    + 'apply — removes him and nothing about the result looks wrong');
  const lowPoint = johnBack && ordered(john).find((p) => p.time === johnBack.fellTime);
  ok(lowPoint && String(lowPoint.status).toUpperCase() === 'DB',
    'and he is `DB` at that low point rather than `TD`, which is what makes him the case '
    + `the filter would catch. Got ${lowPoint ? lowPoint.status : 'no comeback at all'}`);

  /* The looser bar, computed rather than remembered — it is the measurement
   * behind `comebackFloorKt` and it is what makes the rule worth having. */
  const loose = all.filter((s) => {
    const w = ordered(s).filter((p) => Number.isFinite(p.windKt));
    let stage = 0;
    for (const p of w) {
      if (stage === 0 && p.windKt >= SEASONS.hurricaneKt) { stage = 1; continue; }
      if (stage === 1 && p.windKt < SEASONS.hurricaneKt) { stage = 2; continue; }
      if (stage === 2 && p.windKt >= SEASONS.hurricaneKt) return true;
    }
    return false;
  });
  ok(loose.length === 181,
    `a floor at hurricane force instead of ${SEASONS.comebackFloorKt} kt catches 181 storms `
    + `rather than 14, which is a qualifier that fires too often to say anything. Got ${loose.length}`);
  ok(loose.length > backs.length * 10,
    'and the gap between the two is an order of magnitude, which is why the floor is low');

  /* ------------------------------------------------------------------ */
  section('THE SEASON WINDOWS ARE PER BASIN, AND 41 STORMS ARE WHY');

  const firstTime = (s) => Math.min(...ordered(s).map((p) => p.time));
  const oos = all.filter((s) => seasonWindow(s.basin, firstTime(s)));
  ok(oos.length === 82,
    `82 storms in the archive formed outside their own basin's season. Got ${oos.length}`);
  ok(oos.filter((s) => seasonWindow(s.basin, firstTime(s)).side === 'early').length === 65,
    '65 of them early');
  ok(oos.filter((s) => seasonWindow(s.basin, firstTime(s)).side === 'late').length === 17,
    'and 17 late');

  /* ==> THE MEASUREMENT AARON'S PER-BASIN CALL WAS MADE ON. <== */
  const mayGap = all.filter((s) => {
    if (s.basin !== 'EP') return false;
    const d = new Date(firstTime(s));
    const key = (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    return key >= 515 && key < 601;
  });
  ok(mayGap.length === 41,
    `41 East Pacific storms formed between May 15 and May 31. Got ${mayGap.length}`);
  ok(mayGap.every((s) => seasonWindow(s.basin, firstTime(s)) === null),
    '==> AND EVERY ONE OF THEM IS IN SEASON. <== The East Pacific opens May 15. Under a '
    + 'single June 1 window all 41 would be told they beat their own season, and the '
    + 'sentence would carry a date that made it look checked');
  ok(mayGap.every((s) => seasonWindow('AL', firstTime(s)) !== null),
    'and every one of them WOULD be out of season under the Atlantic window, which is the '
    + 'mutation this rule exists to survive');

  /* ------------------------------------------------------------------ */
  section('CAPE VERDE, HOME-GROWN, AND THE 11 THAT ARE NEITHER');

  const atlantic = all.filter((s) => s.basin === 'AL');
  const kinds = { 'cape-verde': 0, 'home-grown': 0, neither: 0, none: 0 };
  for (const s of atlantic) {
    const o = origin(s.basin, ordered(s));
    if (!o) { kinds.none++; continue; }
    if (o.kind) kinds[o.kind]++;
    else kinds.neither++;
  }
  ok(atlantic.length === 2004, `2,004 Atlantic storms. Got ${atlantic.length}`);
  ok(kinds['cape-verde'] === 182, `182 born in the Cape Verde box. Got ${kinds['cape-verde']}`);
  ok(kinds['home-grown'] === 1811, `1,811 born west of 30°W. Got ${kinds['home-grown']}`);
  ok(kinds.neither === 11,
    '==> AND 11 ARE NEITHER — EAST OF 30°W AND NORTH OF 20°N. <== A boolean would tell '
    + `each of them it formed inside the basin, which is false. Got ${kinds.neither}`);
  ok(kinds['cape-verde'] + kinds['home-grown'] + kinds.neither + kinds.none === atlantic.length,
    'and the four buckets account for every Atlantic storm');

  ok(all.filter((s) => s.basin !== 'AL').every((s) => origin(s.basin, ordered(s)) === null),
    '==> THE DISTINCTION IS NOT MADE OUTSIDE THE ATLANTIC. <== \u201CCape Verde\u201D names a '
    + 'place upwind of one basin; the same box in the East Pacific is over South America');
}

/* ------------------------------------------------------------------------- */
section('THE SEASON WINDOW BOUNDARIES — both ends inclusive');
{
  ok(seasonWindow('AL', at(6, 1)) === null,
    'a storm first seen on June 1 opened the Atlantic season rather than beating it');
  ok(seasonWindow('AL', at(5, 31)) !== null, 'and May 31 is early');
  ok(seasonWindow('AL', at(11, 30)) === null, 'November 30 closed it');
  ok(seasonWindow('AL', at(12, 1)) !== null, 'and December 1 is late');

  ok(seasonWindow('EP', at(5, 15)) === null, 'the East Pacific opens on May 15');
  ok(seasonWindow('EP', at(5, 14)) !== null, 'and May 14 is early there');
  ok(seasonWindow('AL', at(5, 20)) !== null,
    '==> THE SAME DATE ANSWERS DIFFERENTLY IN THE TWO BASINS, WHICH IS THE WHOLE FEATURE. '
    + '<== May 20 is in season in the East Pacific and out of it in the Atlantic');
  ok(seasonWindow('CP', at(6, 1)) === null, 'the Central Pacific shares the Atlantic dates');

  /* ==> AN UNKNOWN BASIN ANSWERS NOTHING RATHER THAN ANSWERING ATLANTIC. <==
   * §5, and it is what step 13 depends on: a basin whose real season dates
   * this repo has not measured must produce silence, not a graded verdict. */
  ok(seasonWindow('WP', at(1, 15)) === null,
    'a basin with no window on file produces no sentence at all');
  ok(seasonWindow('AL', null) === null, 'and neither does a storm with no first record');
}

/* ------------------------------------------------------------------------- */
section('ANDRES 2021 — out of season, end to end, in the basin that proves the point');
{
  const f = stormFacts(storm('ep012021'));
  ok(f.seasonWindow?.side === 'early',
    `Andres formed May 8, a week before the East Pacific opens. Got ${f.seasonWindow?.side}`);

  const html = seasonWindowHtml(f.seasonWindow);
  ok(html.includes('May 8'), `the sentence names the day it formed. Got: ${html}`);
  ok(html.includes('May 15'),
    '==> AND IT NAMES THIS BASIN\u2019S OWN OPENING DATE, NOT THE ATLANTIC\u2019S. <== A reader '
    + 'who learned \u201Cthe season starts June 1\u201D from an Atlantic storm and then met this '
    + `one with no explanation would think the app had missed one. Got: ${html}`);
  ok(!html.includes('June'), 'and it does not mention June at all');
}

/* ------------------------------------------------------------------------- */
section('HUGO 1989 AND KATRINA 2005 — the two origins, end to end');
{
  const hugo = stormFacts(storm('al111989'));
  ok(hugo.origin?.kind === 'cape-verde',
    `Hugo formed at 13.2N 20.0W, off Africa. Got ${hugo.origin?.kind}`);
  ok(originHtml(hugo.origin).includes('Cape Verde'), 'and the sentence says so');

  const katrina = stormFacts(storm('al122005'));
  ok(katrina.origin?.kind === 'home-grown',
    `Katrina formed at 23.1N 75.1W, over the Bahamas. Got ${katrina.origin?.kind}`);
  ok(originHtml(katrina.origin).includes('inside the basin'),
    'and hers says she formed inside the basin');

  /* ==> A STORM WHOSE FIRST RECORD CARRIES NO POSITION IS DRIVEN DIRECTLY,
   * BECAUSE NO STORM IN THE ARCHIVE IS ONE. <== Counted 2026-08-29 over both
   * mirrored basins: **zero** storms have a first fix without coordinates, and
   * zero have any fix without them. So this is not dead code kept out of
   * caution — it is the same shape as `changeHtml`'s negative-gain branch,
   * which guards the SEASON IN PROGRESS. That arrives from ATCF b-decks
   * (§57.11) rather than from HURDAT2, and step 13 brings basins filed by
   * other agencies entirely.
   *
   * ==> AND A MUTATION RUN IS WHY THIS ASSERTION EXISTS. <== Replacing the
   * search with `ordered[0]` left the whole suite green, because nothing in
   * the archive could tell the difference. §12: a rule no test can break is a
   * rule the next session simplifies away. */
  const leadingBlank = origin('AL', [
    { time: 0 },
    { time: 1, lat: 13.2, lon: -20.0 },
  ]);
  ok(leadingBlank && leadingBlank.kind === 'cape-verde',
    '==> IT READS THE FIRST FIX WITH A POSITION, NOT SIMPLY THE FIRST FIX. <== Taking a '
    + 'missing longitude as zero puts the genesis on the prime meridian and calls every '
    + `such storm Cape Verde. Got ${JSON.stringify(leadingBlank)}`);
  ok(origin('AL', [{ time: 0 }, { time: 1 }]) === null,
    'and a track with no position anywhere in it answers nothing at all');

  const neither = origin('AL', [{ lat: 30.0, lon: -25.0, time: 0 }]);
  /* ==> A STORM NEITHER LABEL FITS DRAWS NOTHING. <== Driven directly, because
   * none of the 11 is a fixture and cutting one out to make it a fixture would
   * be a sample chosen to agree with the rule it is testing. The archive-wide
   * count of 11 above is the check that they are real. */
  ok(neither && neither.kind === null,
    `a genesis at 30N 25W fits neither label. Got ${JSON.stringify(neither)}`);
  ok(originHtml(neither) === '',
    '==> AND IT PRINTS NOTHING RATHER THAN THE NEARER LABEL. <== §5: the rule looked and '
    + 'declined, which is a different thing from the rule not being asked');
}

/* ------------------------------------------------------------------------- */
section('SILENCE IS THE ORDINARY CASE FOR TWO OF THE THREE');
{
  const katrina = stormFacts(storm('al122005'));
  ok(katrina.comeback === null, 'Katrina made no comeback');
  ok(comebackHtml(katrina.comeback) === '',
    '==> AND NOTHING IS SAID ABOUT IT. <== 14 storms in 3,266 have one. A sentence reading '
    + '\u201Cit did not weaken and recover\u201D on the other 3,252 is a qualifier that fires '
    + 'everywhere and therefore qualifies nothing');
  ok(katrina.seasonWindow === null && seasonWindowHtml(katrina.seasonWindow) === '',
    'and an in-season storm says nothing about the calendar either');

  /* A storm with no wind column at all cannot be asked the comeback question,
   * and the answer is null rather than false. §5. */
  ok(comeback([{ time: 0, lat: 20, lon: -60 }]) === null,
    'no wind column means no answer, not a negative one');
  ok(comeback([]) === null && comeback(null) === null, 'and neither does an empty track');
}

/* ------------------------------------------------------------------------- */
section('THE GEOMETRY UNDERNEATH THE LOOP, DRIVEN DIRECTLY');
{
  const p = (lonU, lat) => ({ lonU, lat });

  ok(!!crossing(p(0, 0), p(2, 2), p(0, 2), p(2, 0)), 'a clean X crosses');
  ok(crossing(p(0, 0), p(2, 0), p(0, 1), p(2, 1)) === null, 'parallel segments do not');
  ok(crossing(p(0, 0), p(2, 0), p(3, 0), p(5, 0)) === null, 'and neither do collinear ones');

  /* ==> A SEGMENT THAT MERELY TOUCHES ANOTHER IS NOT A CROSSING, AND THE
   * INEQUALITIES ARE STRICT SO THAT IT IS NOT. <== Two fixes rounded into the
   * same 0.1° cell, or a storm passing back over a fix it already occupied,
   * both produce contact with no enclosed area. Reported as loops they would
   * be loops of zero width. */
  ok(crossing(p(0, 0), p(2, 0), p(1, 0), p(1, 2)) === null,
    'a T-junction touching the middle of a segment is not a crossing');
  ok(crossing(p(0, 0), p(2, 2), p(2, 2), p(4, 0)) === null,
    'and neither is a shared endpoint');

  /* One degree square at the equator: 60 nm on a side, 3,600 square nautical
   * miles, and a circle of that area is 67.7 nm across. */
  const square = [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];
  const w = loopWidthNm(square);
  ok(Math.abs(w - 67.7) < 0.1, `a 1° square at the equator is 67.7 nm wide. Got ${w.toFixed(1)}`);

  /* ==> THE SAME SQUARE AT 60°N IS NARROWER, WHICH IS THE COSINE DOING ITS
   * JOB. <== A degree of longitude is half as long up there, so the shape is
   * half the area and 0.707 of the width. A version that skipped the
   * conversion would call both squares the same size and would inflate every
   * high-latitude loop. */
  const high = [p(0, 60), p(1, 60), p(1, 61), p(0, 61)];
  const wHigh = loopWidthNm(high);
  ok(wHigh < w * 0.75 && wHigh > w * 0.68,
    `the same square at 60°N is about 0.707 as wide. Got ${wHigh.toFixed(1)} against ${w.toFixed(1)}`);
}

/* ------------------------------------------------------------------------- */
section('JEANNE 2004 — the loop, end to end through stormFacts');
{
  const f = stormFacts(storm('al112004'));
  const lp = f.loop;

  ok(!!lp, 'Jeanne looped and `stormFacts` carries it');
  ok(Math.abs(lp.widthNm - 136.1) < 0.5,
    `her circle is 136.1 nm across. Got ${lp?.widthNm?.toFixed(1)}`);
  ok(day(lp.startTime) === '2004-09-20' && day(lp.endTime) === '2004-09-24',
    `and it ran 2004-09-20 to 2004-09-24. Got ${day(lp.startTime)} to ${day(lp.endTime)}`);

  const html = loopHtml(lp, 'imperial');
  ok(html.includes('looped'), `the sentence says she looped. Got: ${html}`);
  ok(html.includes('Sep 20, 2004') && html.includes('Sep 24, 2004'),
    `and names both ends of it, so the reader can check it against the globe. Got: ${html}`);
  ok(html.includes('157 mi'), `and the width in the reader's own units. Got: ${html}`);

  /* ==> THE WIDTH GOES THROUGH `formatDistance`, AND A METRIC READER GETS
   * KILOMETRES. <== §57.45. A conversion written into the sentence would be a
   * second opinion about a setting `lib/units.js` already owns, and `auto`
   * is exactly the value it would get wrong. */
  const metric = loopHtml(lp, 'metric');
  ok(metric.includes('252 km') && !metric.includes('mi '),
    `and the same loop reads 252 km for a metric reader. Got: ${metric}`);

  /* ==> A LOOP WITH NO WIDTH IS DRIVEN DIRECTLY, BECAUSE NO REAL TRACK CAN
   * PRODUCE ONE. <== `loopWidthNm` is a square root of a sum of finite
   * coordinates and is always a number, so this guard is unreachable from the
   * archive — and a mutation deleting it stayed green until this assertion
   * existed. It is kept rather than tidied away for one reason: with the
   * guard gone the sentence would read \u201Cabout \u2014 across\u201D, because a bare em
   * dash is `lib/units.js`'s missing-value sentinel. That is the exact
   * character banned from every clause on this panel, arriving inside one. */
  ok(loopHtml({ startTime: lp.startTime, endTime: lp.endTime }, 'imperial') === '',
    'and a loop with no width says nothing rather than printing the missing-value dash');
}

/* ------------------------------------------------------------------------- */
section('THE FLOOR — THREE STORMS THAT CROSS THEIR OWN TRACK AND GET NO SENTENCE');
{
  /* ==> EACH OF THESE ASSERTS BOTH HALVES, AND THAT IS THE WHOLE POINT OF
   * THE `biggestCrossing` SEAM. <== A suite that only checked `trackLoop`
   * came back null could not tell a loop refused for being too small from a
   * storm that never crossed at all — and separating those two is the only
   * thing `SEASONS.loopMinWidthNm` does. §12: a test that passes on the same
   * wrong assumption as the bug is worse than no test. */

  const harvey = ordered(storm('al092017'));
  const hx = biggestCrossing(harvey);
  ok(hx && Math.abs(hx.widthNm - 8.5) < 0.5,
    `==> HARVEY 2017 CROSSES HIS OWN TRACK AT 8.5 NM. <== Got ${hx?.widthNm?.toFixed(1)}`);
  ok(trackLoop(harvey) === null,
    '==> AND HE DID NOT LOOP. <== That is Harvey sitting still over Texas while HURDAT2 '
    + 'rounds his position to the nearest 0.1°, which is about 6 nm. A rule that says '
    + '\u201CHarvey looped\u201D is a wrong fact that reads perfectly');
  ok(loopHtml(stormFacts(storm('al092017')).loop, 'imperial') === '',
    'and nothing at all is printed on his panel');

  const ophelia = ordered(storm('al172017'));
  const ox = biggestCrossing(ophelia);
  ok(ox && Math.abs(ox.widthNm - 41.9) < 0.5,
    `==> OPHELIA 2017 CROSSES AT 41.9 NM, WHICH IS A REAL LOOP. <== Got ${ox?.widthNm?.toFixed(1)}`);
  ok(trackLoop(ophelia) === null,
    `and she is still under the ${SEASONS.loopMinWidthNm} nm floor, so nothing is said`);

  /* ==> SANDY 2012 MISSES BY 1.2 NM AND IS RECORDED HERE ON PURPOSE. <== Any
   * floor has a storm just underneath it; the honest thing is to know which
   * one rather than discover it on a phone. If the floor is ever moved, this
   * assertion is the first that will say so. */
  const sandy = ordered(storm('al182012'));
  const sx = biggestCrossing(sandy);
  ok(sx && Math.abs(sx.widthNm - 48.8) < 0.5,
    `==> SANDY 2012 IS THE NEAR MISS, AT 48.8 NM. <== Got ${sx?.widthNm?.toFixed(1)}`);
  ok(trackLoop(sandy) === null, 'and 1.2 nm under the floor is under the floor');

  /* And the control: a storm that never crosses at all reads the same to the
   * panel and differently to `biggestCrossing`. */
  ok(biggestCrossing(ordered(storm('al122005'))) === null,
    'Katrina never crosses her own track');
  ok(trackLoop(ordered(storm('al122005'))) === null, 'so she has no loop either');

  ok(trackLoop([]) === null && trackLoop(null) === null,
    'and a track with no positions is answered rather than thrown at');
}

/* ------------------------------------------------------------------------- */
section('THE DATE LINE — WHY THE CROSSING TEST READS `lonU` AND NOT `lon`');
{
  /* ==> A GEOMETRIC PROBE RATHER THAN A STORM, AND SAYING SO IS THE HONEST
   * PART. <== No storm in either mirrored basin goes near 180°, so there is
   * no real track that can show this — which is exactly why it needs
   * asserting rather than leaving to be discovered by step 13's west Pacific.
   * The path below runs west around the world with `lonU` strictly
   * increasing, so it is monotone in x and CANNOT cross itself. The same
   * fixes in published `lon` wrap twice and zigzag. */
  const west = [[178, 10], [190, 40], [300, 20], [420, 50], [530, 20]].map((v, i) => ({
    time: i * 216e5, lat: v[1], lonU: v[0], lon: ((v[0] + 180) % 360) - 180,
  }));

  ok(biggestCrossing(west) === null,
    '==> A TRACK THAT WALKS OVER 180° DOES NOT CROSS ITSELF. <== `lonU` is the continuous '
    + 'running total `lib/hurdat.js` fills in, so the seam is one straight line');

  const naive = west.map((p) => ({ ...p, lonU: p.lon }));
  const fake = biggestCrossing(naive);
  ok(fake && fake.widthNm > 1000,
    '==> AND THE SAME FIXES READ OFF THE PUBLISHED `lon` INVENT A LOOP 1,700 NM ACROSS. '
    + '<== Well over any floor, so it would reach a reader as a sentence. This is the '
    + 'assertion that keeps the seam bug from coming back the next time somebody tidies '
    + `\`lonU\` away as a duplicate of \`lon\`. Got ${fake ? Math.round(fake.widthNm) : 'null'}`);
}

/* ------------------------------------------------------------------------- */
section('A FIGURE OF EIGHT — THE BIGGEST LOOP IS THE ONE REPORTED');
{
  /* Two loops in one track, the second much wider than the first. The walk
   * meets the small one first. */
  const t = (h) => h * 36e5;
  const eight = [
    { time: t(0), lat: 20, lonU: -60 },
    { time: t(6), lat: 21, lonU: -61 },
    { time: t(12), lat: 21, lonU: -59.5 },
    { time: t(18), lat: 19.5, lonU: -60.5 },
    { time: t(24), lat: 22, lonU: -62 },
    { time: t(30), lat: 27, lonU: -68 },
    { time: t(36), lat: 22, lonU: -74 },
    { time: t(42), lat: 17, lonU: -68 },
    { time: t(48), lat: 24, lonU: -63 },
  ];
  const big = biggestCrossing(eight);
  ok(big && big.widthNm > 300,
    `==> THE WIDE LOOP WINS, NOT THE FIRST ONE FOUND. <== Got ${big?.widthNm?.toFixed(0)} nm`);
  ok(big && day(big.startTime) !== day(eight[1].time),
    'and the dates reported belong to the loop that was reported, not to the small one');
}

/* ------------------------------------------------------------------------- */
section('THE LOOP IS RARE, AND THE FLOOR IS WHAT MAKES IT RARE');
{
  const all = [];
  for (const f of ['seasons/data/hurdat2-atlantic-2025-02272026.txt',
    'seasons/data/hurdat2-epacific-2025-02272026.txt']) {
    all.push(...parseHurdat2(readFileSync(f, 'utf8')).storms);
  }

  const crossers = all.filter((s) => biggestCrossing(ordered(s)));
  ok(crossers.length === 224,
    `224 storms in the archive cross their own track at all. Got ${crossers.length}`);

  const loopers = all.filter((s) => trackLoop(ordered(s)));
  ok(loopers.length === 120,
    '==> AND 120 OF THEM DID IT WIDELY ENOUGH TO BE WORTH A SENTENCE. <== 3.7% of the '
    + `archive. The 104 refused are the wobbles. Got ${loopers.length}`);

  const ids = loopers.map((s) => s.id);
  for (const id of ['AL112004', 'AL092004', 'AL142012', 'AL132018']) {
    ok(ids.includes(id), `and ${id} is one of them`);
  }
  for (const id of ['AL092017', 'AL172017', 'AL182012']) {
    ok(!ids.includes(id), `while ${id} is not`);
  }

  /* ==> IVAN 2004 IS THE WIDEST IN THE ARCHIVE AND IS ASSERTED AS SUCH. <==
   * He turned back around Florida into the Gulf, enclosing a circle 684 nm
   * across. A change to the way width is measured that leaves the counts
   * alone would still move this. */
  const widest = loopers
    .map((s) => ({ id: s.id, w: trackLoop(ordered(s)).widthNm }))
    .sort((a, b) => b.w - a.w)[0];
  ok(widest.id === 'AL092004' && Math.abs(widest.w - 684) < 2,
    `Ivan 2004 is the widest loop on record at 684 nm. Got ${widest.id} at ${widest.w.toFixed(0)}`);
}

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
