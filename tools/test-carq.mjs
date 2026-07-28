#!/usr/bin/env node
/**
 * test-carq.mjs — the analysed-history parse and the join that uses it.
 *
 * ZERO DEPENDENCIES, like every other tool here: a guard that only runs on the
 * machine which happens to have a package installed is not a guard (§12).
 *
 * THE FIXTURE IS REAL BYTES. `samples/other/tcgp-carq-wp122026.txt` is
 * DOLPHIN's own a-deck read live through our relay on 2026-07-28, abridged to
 * the rows that exercise each rule with the original spacing, column order and
 * zero-padding exactly as they arrived. Three of the assertions below describe
 * behaviour that only shows up in real data:
 *
 *   - one valid time published by five cycles, which DISAGREE
 *   - tau-0 rows triplicated across the three wind-radius thresholds
 *   - a storm crossing the dateline inside its own history
 *
 * WHAT THIS CANNOT PROVE: that the ridge looks right. THE STANDING RULE — when
 * a fixture passes and glass fails, the fixture is wrong.
 *
 * ONE ASSERTION IS AN INDEPENDENT CROSS-CHECK and is the most valuable line in
 * the file: the 2026-07-28 00Z analysis must come out at 13.0N 172.8E and
 * 60 kt, which is exactly what /api/jtwc/storms reported for DOLPHIN's fix at
 * that moment — a different product, parsed by different code, fetched
 * separately. Two sources agreeing is worth more than any number of internal
 * consistency checks.
 */

/* THREE is a CDN global in the browser; lib/geo.js needs it at import time for
 * an unrelated export. Set BEFORE the dynamic imports — a static `import` is
 * hoisted and would run geo.js first. */
globalThis.THREE = {
  Vector3: class {
    constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
    normalize() { return this; }
  },
};

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const { parseCarq, carqWindAt, CARQ_MATCH_NM } = await import('../lib/carq.js');

const DECK = readFileSync(join(HERE, '../samples/other/tcgp-carq-wp122026.txt'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  FAIL  ${what}`);
};
const near = (a, b, what, tol = 0.05) =>
  ok(a != null && Math.abs(a - b) <= tol, `${what} (got ${a}, want ${b})`);

const at = (y, m, d, h) => Date.UTC(y, m - 1, d, h);
const analyses = parseCarq(DECK);
const find = (t) => analyses.find((a) => a.at === t);

console.log('\n--- the parse ---');
{
  ok(analyses.length === 8, `12 rows collapse to 8 valid times (got ${analyses.length})`);
  ok(
    analyses.every((a, i) => i === 0 || a.at > analyses[i - 1].at),
    'sorted oldest first, strictly increasing'
  );
  ok(
    analyses.every((a) => Number.isFinite(a.windKt) && a.windKt > 0),
    'every analysis carries a real wind'
  );
}

console.log('\n--- tau-0 rows are triplicated and must collapse to one ---');
{
  /* 2026-07-26 00Z appears three times in the fixture, once per wind-radius
   * threshold, identical but for that column. */
  const hits = analyses.filter((a) => a.at === at(2026, 7, 26, 0));
  ok(hits.length === 1, `one analysis, not three (got ${hits.length})`);
  near(hits[0].windKt, 20, 'and it keeps the right wind');
}

console.log('\n--- the newest cycle wins a disagreement ---');
{
  /* THE ONE THAT ONLY REAL DATA TEACHES. Valid 2026-07-27 00Z is published by
   * its own 00Z cycle as 128N and by the later 06Z and 00Z-next-day cycles as
   * 131N. JTWC revised its own analysis; the correction must win. */
  const a = find(at(2026, 7, 27, 0));
  near(a?.lat, 13.1, 'takes the revised 13.1N, not the original 12.8N');
  ok(a?.lat !== 12.8, 'and specifically not the stale reading');
}

console.log('\n--- the dateline is crossed inside one storm\'s history ---');
{
  near(find(at(2026, 7, 26, 0))?.lon, -176.0, 'starts east of the line at 176.0W');
  near(find(at(2026, 7, 26, 18))?.lon, 179.7, 'crosses to 179.7E');
  near(find(at(2026, 7, 28, 12))?.lon, 170.7, 'ends at 170.7E');
}

console.log('\n--- CROSS-CHECK against /api/jtwc/storms, a different product ---');
{
  /* JTWC's live warning reported DOLPHIN's 2026-07-28T00:00Z fix as
   * lat 13, lon 172.8, windKt 60. This deck is parsed by different code from a
   * different endpoint and must agree. */
  const a = find(at(2026, 7, 28, 0));
  near(a?.lat, 13.0, 'lat agrees with the JTWC warning');
  near(a?.lon, 172.8, 'lon agrees with the JTWC warning');
  near(a?.windKt, 60, 'wind agrees with the JTWC warning');
}

console.log('\n--- the intensification ladder is the whole point ---');
{
  const ladder = analyses.map((a) => a.windKt);
  ok(
    JSON.stringify(ladder) === JSON.stringify([20, 20, 25, 30, 35, 60, 75, 100]),
    `real winds, not one flat guess (got ${ladder.join(', ')})`
  );
  ok(
    Math.max(...ladder) - Math.min(...ladder) > 50,
    'a ridge with a shape — the class midpoint would draw all eight the same height'
  );
}

console.log('\n--- the join ---');
{
  const t = at(2026, 7, 28, 6);
  const hit = carqWindAt(analyses, t, 171.7, 13.3);
  near(hit?.windKt, 75, 'an exact time and place matches');

  /* Both agencies analyse independently, so a normal GDACS dot sits tens of
   * miles off JTWC's for the same hour and must still match. */
  const nearby = carqWindAt(analyses, t, 172.3, 13.6);
  near(nearby?.windKt, 75, 'a normal inter-agency disagreement still matches');
  ok(nearby.distanceNm > 0 && nearby.distanceNm < CARQ_MATCH_NM, 'inside the guard');
}

console.log('\n--- both guards prefer silence ---');
{
  const t = at(2026, 7, 28, 6);
  ok(
    carqWindAt(analyses, t, 140.0, 13.3) === null,
    'a position a different ocean away is refused, not stamped'
  );
  ok(
    carqWindAt(analyses, at(2026, 7, 20, 6), 171.7, 13.3) === null,
    'a time outside the deck is refused'
  );
  ok(carqWindAt([], t, 171.7, 13.3) === null, 'an empty deck refuses');
  ok(carqWindAt(analyses, NaN, 171.7, 13.3) === null, 'an unreadable time refuses');
}

console.log('\n--- the dateline does not break the position guard ---');
{
  /* A dot at 179.8E against an analysis at 179.7E is twelve miles apart. A
   * subtraction of raw longitudes would call it 359.5 degrees and refuse. */
  const hit = carqWindAt(analyses, at(2026, 7, 26, 18), 179.8, 12.7);
  near(hit?.windKt, 25, 'matches across the line');
  ok(hit.distanceNm < 20, `and knows it is close (got ${hit?.distanceNm?.toFixed(1)} nm)`);

  const across = carqWindAt(analyses, at(2026, 7, 26, 18), -179.9, 12.7);
  ok(across != null, 'a dot on the OTHER side of the line still matches');
}

console.log('\n--- junk in, silence out ---');
{
  ok(parseCarq('').length === 0, 'empty string');
  ok(parseCarq(null).length === 0, 'null');
  ok(parseCarq('not,an,a-deck\nat,all').length === 0, 'wrong shape');
  ok(
    parseCarq('WP, 12, 2026072812, 01, AEMN,  12, 134N, 1707E, 100').length === 0,
    'a guidance model is not history — only CARQ is read'
  );
  ok(
    parseCarq('WP, 12, 2026072812, 01, CARQ,  12, 134N, 1707E, 100').length === 0,
    'a POSITIVE tau is refused — history never lies in the future'
  );
  ok(
    parseCarq('WP, 12, 2026072812, 01, CARQ,   0, 134N, 1707E,   0').length === 0,
    'a zero wind is "not analysed", never a calm storm'
  );
  ok(
    parseCarq('WP, 12, 2026072812, 01, CARQ,   0, 134N, 1707E, 9999').length === 0,
    'a sentinel wind is refused, not drawn at full Cat 5 height'
  );
  ok(
    parseCarq('WP, 12, BADDATE00, 01, CARQ,   0, 134N, 1707E, 100').length === 0,
    'an unparseable cycle is dropped'
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
