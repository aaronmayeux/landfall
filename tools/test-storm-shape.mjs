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
const { comeback, seasonWindow, origin } = await import('../lib/storm-shape.js');
const { stormFacts } = await import('../lib/season-facts.js');
const { comebackHtml, seasonWindowHtml, originHtml } = await import('../ui/season-shape-markup.js');
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
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
