#!/usr/bin/env node
/**
 * test-rankings.mjs — where a storm stands against the whole archive.
 * §57.44, §57.42 Tier 1 item 11.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-rankings.mjs`.
 *
 * ==> THE CENTRAL ASSERTION IS A BRUTE-FORCE CROSS-CHECK AGAINST THE REAL
 * ARCHIVE, NOT A HAND-BUILT LADDER. <== §12: a test that passes on the same
 * wrong assumption as the bug is worse than no test, and a ladder written by
 * hand in this file would be the ladder builder's own arithmetic marking its
 * own homework. Section 2 sorts all 3,266 storms the obvious slow way and
 * demands the shipped table agree, rank for rank.
 *
 * ==> AND IT ASSERTS THE DENOMINATORS SEPARATELY, BECAUSE THAT IS THE HALF A
 * RANK CHECK CANNOT SEE. <== Ranking against the wrong set still produces
 * self-consistent ranks. Only counting the set catches "of 3,266" printed
 * under a figure 1,258 storms do not have.
 */

import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { SEASONS } = await import('../config/constants.js');
const { parseHurdat2 } = await import('../lib/hurdat.js');
const { stormFacts } = await import('../lib/season-facts.js');
const {
  RANK_STATS, QUANTIZERS, toRung, placeOn, rankStorm, rankingsFileName, scopeOrder,
  eraCaveat, meetsFloor, countsAgree,
} = await import('../lib/rankings.js');
const { archiveRankHtml, eraCaveatWords } = await import('../ui/season-rank-markup.js');

const TABLE_FILE = 'seasons/data/rankings-02272026.json';
const table = existsSync(TABLE_FILE) ? JSON.parse(readFileSync(TABLE_FILE, 'utf8')) : null;

const raw = (f) => readFileSync(`samples/seasons/storms/${f}.txt`, 'utf8');
const oneStorm = (f) => parseHurdat2(raw(f)).storms[0];

/* ------------------------------------------------------------------------- */
section('THE FILENAME — derived on both sides, and it moves when a revision does');
{
  const one = rankingsFileName({ atlantic: { revision: 'A' }, epacific: { revision: 'A' } });
  ok(one.file === 'rankings-A.json',
    `two basins on one revision give one stamp. Got ${one.file}`);

  const two = rankingsFileName({ atlantic: { revision: 'B' }, epacific: { revision: 'A' } });
  ok(two.file === 'rankings-A-B.json',
    `a split revision names both, sorted so the order of the index cannot change the URL. Got ${two.file}`);

  const flipped = rankingsFileName({ epacific: { revision: 'A' }, atlantic: { revision: 'B' } });
  ok(flipped.file === two.file,
    'and the same two revisions in the other order give the same filename');

  ok(rankingsFileName({}).file === null,
    'no basins means no filename rather than a guessed one');
  ok(rankingsFileName({ atlantic: {} }).file === null,
    'a basin with no revision means no filename — the same fail-closed rule the places sidecar has');

  /* ==> THE STAMP MUST CHANGE WHEN ANY BASIN'S DOES, AND THIS IS WHY. <== The
   * file is `immutable` for a year under `_headers`. A stamp that failed to
   * move when NOAA revised one basin would leave a stale ladder on every
   * returning phone until 2027, and nothing on screen would say so. */
  ok(one.file !== two.file,
    'revising one basin changes the URL, so no phone keeps a stale ladder for a year');
}

/* ------------------------------------------------------------------------- */
section('THE TWO GUARDS — driven directly, because their condition is false today');
{
  /* ==> BOTH OF THESE SURVIVED DELETION IN THE FIRST MUTATION RUN. <== Not
   * because the assertions were weak but because neither guard fires against
   * the current archive, so removing one changes no output at all. A rule that
   * cannot be caught being deleted is a rule that will be deleted. They are
   * functions now and they are driven here rather than through the file. */

  ok(meetsFloor(SEASONS.rankingsMinStorms) === true,
    `a pool exactly at the floor of ${SEASONS.rankingsMinStorms} is ranked`);
  ok(meetsFloor(SEASONS.rankingsMinStorms - 1) === false,
    'one storm below it is not — no rank rather than a proud one');
  ok(meetsFloor(2) === false,
    'and "2nd lowest of 2" never reaches a screen, which is arithmetic rather than information');
  ok(meetsFloor(null) === false && meetsFloor(NaN) === false,
    'an uncountable pool is refused rather than treated as zero');

  ok(countsAgree(3266, 3266) === true,
    'the two ways of counting the archive agreeing is the passing case');
  ok(countsAgree(3266, 6532) === false,
    'the exact 2x that blocked this item for a week is caught, not shipped');
  ok(countsAgree(3266, 3265) === false,
    'and so is the one-storm loss that cat-ing the two files causes');
  ok(countsAgree(3266, null) === false,
    'a count that could not be taken is not agreement');
}

/* ------------------------------------------------------------------------- */
section('THE LADDER — checked against brute force over the real archive');
{
  if (!table) {
    failures.push(`${TABLE_FILE} is missing. Run: node tools/seasons-rankings.mjs`);
  } else {
    const index = JSON.parse(readFileSync('seasons/index.json', 'utf8'));
    const facts = { atlantic: [], epacific: [] };
    for (const [basin, meta] of Object.entries(index.basins)) {
      const file = meta.file.startsWith('/') ? meta.file.slice(1) : meta.file;
      const { storms } = parseHurdat2(readFileSync(file, 'utf8'));
      facts[basin] = storms.map(stormFacts).filter(Boolean);
    }
    const all = [...facts.atlantic, ...facts.epacific];

    ok(all.length === 3266,
      `the archive is 3,266 storms. Got ${all.length}`);

    /* ==> THE PER-SEASON SLICES MUST AGREE WITH THE CUMULATIVE FILES. <==
     * §57.42. This is the exact 2x that blocked this item for a week: a walk
     * over `seasons/data/*.txt` unfiltered reads both sets and counts every
     * storm twice. Asserting the two agree is what makes "3,266" quotable. */
    ok(table.scopes.all.storms === all.length,
      `the shipped table's total matches. Got ${table.scopes.all.storms}`);

    for (const [scopeKey, list] of [['atlantic', facts.atlantic], ['epacific', facts.epacific], ['all', all]]) {
      const scope = table.scopes[scopeKey];
      ok(scope && scope.storms === list.length,
        `${scopeKey} holds ${list.length} storms. Table says ${scope?.storms}`);

      for (const [statKey, def] of Object.entries(RANK_STATS)) {
        const pool = list.map(def.read).filter((v) => Number.isFinite(v));
        const ladder = scope?.stats?.[statKey];
        if (!ladder) {
          ok(pool.length < SEASONS.rankingsMinStorms,
            `${scopeKey}.${statKey} is absent from the table but ${pool.length} storms have it`);
          continue;
        }
        /* ==> THE DENOMINATOR IS THE HALF A RANK CHECK CANNOT SEE. <== Ranking
         * against the wrong set still produces self-consistent ranks; only
         * counting the set catches "of 3,266" under a figure 1,258 storms do
         * not have. */
        ok(ladder.of === pool.length,
          `${scopeKey}.${statKey} denominator is ${pool.length}. Table says ${ladder.of}`);
      }
    }

    /* Brute force. Every storm, every statistic, in the `all` scope. */
    let checked = 0;
    let mismatched = 0;
    let firstBad = null;
    for (const [statKey, def] of Object.entries(RANK_STATS)) {
      const q = (v) => toRung(def.quantize, v);
      const pool = all.map(def.read).filter((v) => Number.isFinite(v)).map(q);
      const ladder = table.scopes.all.stats[statKey];
      for (const f of all) {
        const mine = def.read(f);
        if (!Number.isFinite(mine)) continue;
        const key = q(mine);
        const better = pool.filter((v) => (def.direction === 'low' ? v < key : v > key)).length;
        const tied = pool.filter((v) => v === key).length;
        const got = placeOn(ladder, mine);
        checked++;
        const good = got && got.rank === better + 1 && got.tied === tied && got.of === pool.length;
        if (!good) {
          mismatched++;
          firstBad ||= `${f.id} ${statKey}: got ${JSON.stringify(got)}, `
            + `brute force says rank ${better + 1} tied ${tied} of ${pool.length}`;
        }
      }
    }
    /* ==> THE EXPECTED COUNT IS COMPUTED, NOT TYPED. <== §12: never assert a
     * number that can be derived from the data. The first draft said
     * `> 15000` on a guess and the real figure is 14,991, so the assertion
     * failed while the code was correct — and a looser guess would have passed
     * while silently covering half the archive. */
    const expected = Object.values(RANK_STATS)
      .reduce((sum, d) => sum + all.map(d.read).filter((v) => Number.isFinite(v)).length, 0);
    ok(checked === expected,
      `every rankable figure in the archive was cross-checked. Expected ${expected}, checked ${checked}`);
    ok(mismatched === 0,
      `every rank matches brute force. ${mismatched} disagreed. ${firstBad || ''}`);
  }
}

/* ------------------------------------------------------------------------- */
section('TIES AND ORDER — a shared place is shared, and the next one skips');
{
  const ladder = { direction: 'low', quantize: 'round', of: 6, values: [900, 910, 920], counts: [1, 3, 2] };
  ok(placeOn(ladder, 900).rank === 1, 'the best value is first');
  ok(placeOn(ladder, 910).rank === 2, 'three storms tied at 910 all read 2nd');
  ok(placeOn(ladder, 910).tied === 3, 'and `tied` counts all three, matching rankInSeason');
  ok(placeOn(ladder, 920).rank === 5,
    `the value after a three-way tie is 5th, not 3rd. Got ${placeOn(ladder, 920).rank}`);
  ok(placeOn(ladder, 920).of === 6, 'and the denominator is every storm on the ladder');

  const high = { direction: 'high', quantize: 'round', of: 3, values: [150, 100], counts: [1, 2] };
  ok(placeOn(high, 150).rank === 1 && placeOn(high, 100).rank === 2,
    'a `high` ladder runs the other way and rank 1 is still the biggest number');

  /* ==> A VALUE THE LADDER HAS NEVER SEEN IS REFUSED, NOT INTERPOLATED. <== */
  ok(placeOn(ladder, 915) === null,
    'a value between two rungs gets no rank rather than a made-up one');
  ok(placeOn(ladder, 890) === null, 'and neither does one better than the best');
  ok(placeOn(null, 900) === null && placeOn(ladder, NaN) === null,
    'a missing ladder or a missing value is null, not a throw');
}

/* ------------------------------------------------------------------------- */
section('QUANTIZING — two storms showing the same number share a rank');
{
  /* ACE renders as one decimal. 12.44 and 12.44999 both print `12.4`, so they
   * must rank together or the panel shows one number and two places. */
  const ladder = { direction: 'high', quantize: 'fixed1', of: 2, values: [12.4], counts: [2] };
  ok(placeOn(ladder, 12.44)?.rank === 1, '12.44 lands on the 12.4 rung');
  ok(placeOn(ladder, 12.42)?.rank === 1, 'and so does 12.42, which also prints 12.4');
  ok(placeOn(ladder, 12.44)?.tied === 2, 'they share the rung rather than splitting it');

  /* ==> THE RULE IS "SAME PRINTED NUMBER, SAME RUNG", SO IT IS CHECKED AGAINST
   * THE THING THAT DOES THE PRINTING. <== `lifeHtml` renders ACE with
   * `toFixed(1)`; this ladder quantizes with `Math.round(v / 0.1) * 0.1`. Those
   * are two different roundings of the same float and there is no reason in
   * advance for them to agree — the first draft of this suite assumed 12.35
   * printed as 12.4, and JavaScript prints 12.3. Rather than reason about it,
   * every real ACE value in the archive is run through both. */
  if (table) {
    const index = JSON.parse(readFileSync('seasons/index.json', 'utf8'));
    let disagreed = 0;
    let sample = null;
    let seen = 0;
    for (const meta of Object.values(index.basins)) {
      const file = meta.file.startsWith('/') ? meta.file.slice(1) : meta.file;
      for (const st of parseHurdat2(readFileSync(file, 'utf8')).storms) {
        const v = RANK_STATS.ace.read(stormFacts(st));
        if (!Number.isFinite(v)) continue;
        seen++;
        const printed = v.toFixed(1);
        const rung = toRung(RANK_STATS.ace.quantize, v).toFixed(1);
        if (printed !== rung) { disagreed++; sample ||= `${v} prints ${printed} but ranks at ${rung}`; }
      }
    }
    ok(seen > 2000, `every real ACE figure was checked. Saw ${seen}`);
    ok(disagreed === 0,
      `the ladder's rung and the panel's printed figure agree on every storm. `
      + `${disagreed} disagreed. ${sample || ''}`);
  }

  ok(RANK_STATS.ace.quantize === 'fixed1',
    'ACE rounds the way `lifeHtml` prints it, with toFixed(1)');
  ok(RANK_STATS.lowestPressureMb.quantize === 'round',
    'pressure the way `formatPressure` prints it, with Math.round');
  ok(RANK_STATS.lifespanHours.quantize === 'round',
    'lifespan the way `spanWords` prints it, with Math.round');

  /* ==> THE CASE THAT BROKE IT, KEPT AS A REGRESSION. <== `Math.round(6.55 /
   * 0.1) * 0.1` is 6.6 and `(6.55).toFixed(1)` is 6.5. Five real storms
   * printed one ACE and ranked at another until the ladder was made to use the
   * renderer's own operation. */
  ok(toRung('fixed1', 6.55) === 6.5,
    `6.55 rungs at 6.5, matching what the panel prints. Got ${toRung('fixed1', 6.55)}`);
  ok(Math.round(6.55 / 0.1) * 0.1 !== 6.5,
    'and the arithmetic it replaced genuinely disagrees, so this is a real guard');
  ok(toRung('nope', 5) === null && toRung('round', NaN) === null,
    'an unknown quantizer or an unreadable value is null rather than a throw');
  ok(Object.keys(QUANTIZERS).length === 2,
    'two quantizers today, and a third statistic printed a third way needs a third');
}

/* ------------------------------------------------------------------------- */
section('WHAT NEVER GETS RANKED');
{
  const base = {
    id: 'AL011900', year: 1900, basin: 'AL', peakWindKt: 100, lowestPressureMb: 950,
    lifespanHours: 100, hoursAtMajor: 0, ace: 5, aceRecords: 10,
    fastest24h: { gainKt: -10, hours: 24 },
  };

  ok(RANK_STATS.hoursAtMajor.read(base) === null,
    'a storm that never reached major strength did not come last at it — no rank');
  ok(RANK_STATS.hoursAtMajor.read({ ...base, hoursAtMajor: 24 }) === 24,
    'a storm that did reach it is ranked normally');

  ok(RANK_STATS.fastest24hGainKt.read(base) === null,
    'a weakening storm gets no "fastest strengthening" rank — a loss is not a slow gain');
  ok(RANK_STATS.fastest24hGainKt.read({ ...base, fastest24h: { gainKt: 30 } }) === 30,
    'a real gain is ranked');

  ok(RANK_STATS.ace.read({ ...base, aceRecords: 0 }) === null,
    'ACE with no synoptic record behind it is not ranked, matching what lifeHtml prints');

  /* ==> THE SEASON STILL RUNNING GETS NO ARCHIVE RANK, AND THE LADDER WOULD
   * HAPPILY PLACE IT. <== That is exactly why the refusal is explicit. */
  if (table) {
    const settled = rankStorm({ ...base, provisional: false }, table, 'atlantic');
    const running = rankStorm({ ...base, provisional: true }, table, 'atlantic');
    ok(settled && settled.rows.length > 0,
      'a settled storm gets its ranks');
    ok(running === null,
      'a provisional storm gets none, even though every one of its figures is on the ladder');
  }
}

/* ------------------------------------------------------------------------- */
section('SCOPES — the storm\'s own basin, then everything, in that order');
{
  ok(JSON.stringify(scopeOrder(['atlantic', 'epacific'])) === '["atlantic","epacific","all"]',
    '`all` is last');

  if (table) {
    const katrina = stormFacts(oneStorm('al122005'));
    const ranked = rankStorm(katrina, table, 'atlantic');
    ok(ranked.scopes.length === 2, `two scopes reach the panel. Got ${ranked.scopes.length}`);
    ok(ranked.scopes[0].key === 'atlantic' && ranked.scopes[1].key === 'all',
      'basin first, archive second — the honest comparison leads');
    ok(!ranked.scopes.some((s) => s.key === 'epacific'),
      'an Atlantic storm is never shown a Pacific rank');

    const guillermo = stormFacts(oneStorm('ep152021'));
    const gr = rankStorm(guillermo, table, 'epacific');
    ok(gr.scopes[0].key === 'epacific',
      'and a Pacific storm leads with the Pacific');

    /* ==> A BASIN THE TABLE DOES NOT CARRY PRODUCES NO BASIN ROW RATHER THAN A
     * WRONG ONE. <== This is what a new basin looks like on the day its data
     * lands and before its ladder is rebuilt. */
    const unknown = rankStorm(katrina, table, 'westpacific');
    ok(unknown && unknown.scopes.length === 1 && unknown.scopes[0].key === 'all',
      'an unknown basin falls back to the archive scope alone, never to another basin');
  }
}

/* ------------------------------------------------------------------------- */
section('WIND ACROSS BASINS — declined when a scope says its winds are not comparable');
{
  const facts = {
    id: 'X', year: 2005, provisional: false, peakWindKt: 150, lowestPressureMb: 902,
  };
  const stats = {
    peakWindKt: { direction: 'high', quantize: 'round', of: 10, values: [150], counts: [1] },
    lowestPressureMb: { direction: 'low', quantize: 'round', of: 10, values: [902], counts: [1] },
  };

  const comparable = rankStorm(facts, {
    scopeOrder: ['atlantic', 'all'],
    scopes: {
      atlantic: { inWords: 'the Atlantic', storms: 10, windComparable: true, stats },
      all: { inWords: 'everywhere', storms: 10, windComparable: true, stats },
    },
  }, 'atlantic');
  ok(comparable.rows.some((r) => r.key === 'peakWindKt'),
    'a wind rank appears when the scope says its winds are one measurement');
  ok(comparable.rows.find((r) => r.key === 'peakWindKt').places.length === 2,
    'in both scopes');

  /* ==> THE ONE THAT MATTERS WHEN THE WORLD ARRIVES. <== §57.31: IBTrACS
   * carries twelve agencies' opinions of one storm, and most of the world
   * reports a ten-minute average where the US reports one minute. Mixed in one
   * ladder, every typhoon sinks below hurricanes it actually beat. */
  const mixed = rankStorm(facts, {
    scopeOrder: ['atlantic', 'all'],
    scopes: {
      atlantic: { inWords: 'the Atlantic', storms: 10, windComparable: true, stats },
      all: { inWords: 'everywhere', storms: 10, windComparable: false, stats },
    },
  }, 'atlantic');
  const windRow = mixed.rows.find((r) => r.key === 'peakWindKt');
  ok(windRow.places.length === 1 && windRow.places[0].scope.key === 'atlantic',
    'a scope with mixed averaging periods gets no wind rank — the basin keeps its own');
  ok(mixed.rows.find((r) => r.key === 'lowestPressureMb').places.length === 2,
    'and pressure is unaffected, because a millibar is a millibar everywhere');

  if (table) {
    ok(table.scopes.all.windComparable === true,
      'today every basin in the archive is NHC\'s, so the archive wind rank is honest');
  }
}

/* ------------------------------------------------------------------------- */
section('THE SENTENCE — what actually reaches the screen');
{
  if (table) {
    const katrina = stormFacts(oneStorm('al122005'));
    const html = archiveRankHtml(rankStorm(katrina, table, 'atlantic'), { year: 2005 });

    ok(html.includes('Lowest pressure'), 'the pressure row is there');
    ok(/\d+(st|nd|rd|th) lowest in the Atlantic/.test(html),
      `the basin rank leads and names the basin. Got: ${html.slice(0, 200)}`);
    ok(/of [\d,]+ overall/.test(html),
      'the archive rank carries its own denominator');

    /* ==> NOTHING ON SCREEN EVER SAYS "ON RECORD". <== §57.44. The set behind
     * it doubles when step 13 lands, and a reader seeing a storm's rank change
     * with the wording unchanged would conclude the app broke. */
    ok(!/on record/i.test(html),
      'and the phrase "on record" appears nowhere, because the set it names will change');

    ok(html.includes('3,266') || html.includes('2,008'),
      'the totals are grouped with commas rather than printed raw');

    ok(/Each figure is ranked only against the storms that have it/.test(html),
      'the note explains why the totals differ from row to row');
    /* ==> THE ROLL-CALL MUST NAME EVERY BASIN, NOT JUST THE STORM'S OWN. <==
     * This assertion caught a real fault: the note was assembled from the
     * scopes that reached the renderer, which is the storm's basin plus `all`,
     * so it read "every storm in the settled record: 2,004 Atlantic" directly
     * under a rank taken against 3,266. Built from the table's own `parts` now. */
    ok(html.includes('2,004 Atlantic') && html.includes('1,262 East and Central Pacific'),
      `the note names every basin and its count, not just the storm's own. Got: ${html.slice(-400)}`);
    ok(table.scopes.all.parts.length === table.scopes.all.members.length,
      'and the file spells out one part per member basin, so the sentence widens with the data');

    /* ==> NO ROW SAYS "TIED", AND SIX OF SIX DID BEFORE THIS. <== A qualifier
     * that fires on every row qualifies nothing. The fact is in the note. */
    ok(!/Tied/.test(html),
      `no row hedges with "Tied" on a 3,266-storm ladder where ties are the norm`);
    ok(/share a place/.test(html),
      'and the note says so once, for every row at once');

    /* Four-digit ranks are grouped. `1034th` reads as a serial number. */
    ok(!/[^,\d]\d{4}(st|nd|rd|th)/.test(html),
      `four-digit ranks carry a thousands separator. Got: ${html}`);

    /* ==> AN EMPTY OR MISSING TABLE DRAWS NOTHING, RATHER THAN A HEADING WITH
     * A SHRUG UNDER IT. <== */
    ok(archiveRankHtml(null) === '', 'no ranking means no section');
    ok(archiveRankHtml({ scopes: [], rows: [] }) === '', 'and neither does an empty one');

    /* Six statistics, and the constant is what stops a seventh arriving free. */
    const rows = (html.match(/<dt>/g) || []).length;
    ok(rows <= SEASONS.rankingsMaxRows,
      `at most ${SEASONS.rankingsMaxRows} rank rows reach the panel. Got ${rows}`);
  }
}

/* ------------------------------------------------------------------------- */
section('THE PRE-SATELLITE SENTENCE — about the denominator, not about the storm');
{
  ok(eraCaveat(1935) === true, '1935 is before satellites');
  ok(eraCaveat(SEASONS.satelliteEraFrom) === false,
    `${SEASONS.satelliteEraFrom} is not, and the boundary year itself is modern`);
  ok(eraCaveat(2005) === false, 'and 2005 certainly is not');
  ok(eraCaveat(null) === false, 'a storm with no year gets no claim about its era');

  const old = eraCaveatWords(1935);
  ok(typeof old === 'string' && old.length > 0, '1935 gets the sentence');
  ok(eraCaveatWords(2005) === null, '2005 does not');

  /* ==> IT SAYS WHICH WAY THE ERROR LEANS, AND THAT IS THE USEFUL HALF. <== An
   * old storm is ranked against the storms somebody wrote down. The ones that
   * stayed at sea are missing from the count, so the rank flatters. Saying
   * only "the record is thin" leaves the reader unable to use the number. */
  ok(/lower in a complete record/.test(old),
    'and it says the storm\'s true place would be LOWER, not merely that the record is thin');
  ok(!/unreliable|inaccurate/i.test(old),
    'without calling the figure unreliable, which it is not — it is a rank in a smaller set');

  if (table) {
    const labor = stormFacts(oneStorm('al031935'));
    const html = archiveRankHtml(rankStorm(labor, table, 'atlantic'), { year: 1935 });
    ok(/lower in a complete record/.test(html),
      'a 1935 storm carries the sentence on its panel');

    const katrina = stormFacts(oneStorm('al122005'));
    const modern = archiveRankHtml(rankStorm(katrina, table, 'atlantic'), { year: 2005 });
    ok(!/lower in a complete record/.test(modern),
      'and a 2005 storm does not');
  }
}

/* ------------------------------------------------------------------------- */
section('THE KNOWN STORMS — spot checks a human can argue with');
{
  if (table) {
    /* These are the figures NOAA itself publishes as the archive's extremes,
     * so they are the one place this suite can check the ladder against
     * something outside this repo. */
    const wilma = placeOn(table.scopes.atlantic.stats.lowestPressureMb, 882);
    ok(wilma?.rank === 1,
      `Wilma's 882 mb is the lowest pressure in the Atlantic record. Got ${wilma?.rank}`);

    const patricia = placeOn(table.scopes.all.stats.lowestPressureMb, 872);
    ok(patricia?.rank === 1,
      `Patricia's 872 mb is the lowest in the whole archive. Got ${patricia?.rank}`);
    ok(placeOn(table.scopes.all.stats.lowestPressureMb, 882)?.rank === 2,
      'and Wilma is second to her once the Pacific is in the set');

    const patriciaWind = placeOn(table.scopes.all.stats.peakWindKt, 185);
    ok(patriciaWind?.rank === 1,
      `Patricia's 185 kt is the strongest wind in the archive. Got ${patriciaWind?.rank}`);
  }
}

/* ------------------------------------------------------------------------- */
section('THE WIRING — how the table reaches the panel, and what happens when it does not');
{
  /* ==> THIS WHOLE SECTION EXISTS BECAUSE THREE MUTATIONS SURVIVED WITHOUT
   * IT. <== The library was covered and the renderer was covered; the road
   * between them was not, and a table that never arrives or arrives under the
   * wrong basin fails silently rather than loudly. */
  const { loadSeason, loadRankings, clearSeasonCache } = await import('../data/seasons.js');
  const index = JSON.parse(readFileSync('seasons/index.json', 'utf8'));
  const realFetch = globalThis.fetch;

  /** Serve the real shipped files off disk; refuse whichever URL is named. */
  const serve = (deny = null) => async (url) => {
    const name = String(url).split('/').pop();
    if (deny && name.includes(deny)) return { ok: false, status: 404 };
    const body = readFileSync(`seasons/data/${name}`, 'utf8');
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };

  globalThis.fetch = serve();
  clearSeasonCache();
  let res = await loadSeason(index, 'atlantic', 2005);
  ok(res.status === 'ok', 'the season loads');
  ok(res.rankings?.scopes?.all?.storms === 3266,
    `==> THE TABLE RIDES IN WITH THE SEASON. <== Got ${res.rankings?.scopes?.all?.storms}`);
  ok(res.rankings.scopes.atlantic && res.rankings.scopes.epacific,
    'carrying every scope, not just the basin that was asked for');

  /* A storm the panel would actually draw, end to end through the real road. */
  const katrina = res.storms.find((st) => st.name === 'KATRINA');
  const endToEnd = archiveRankHtml(
    rankStorm(stormFacts(katrina), res.rankings, 'atlantic'), { year: 2005 },
  );
  ok(/lowest in the Atlantic/.test(endToEnd),
    'and a rank reaches the markup off the fetched table rather than off a fixture');

  /* ==> LOSING A 4 KB COMPANION MUST NOT LOSE THE YEAR. <== §5, and the same
   * rule the landfalls and the places already follow. A rank is the least
   * load-bearing thing on that panel: every figure it would have ranked is
   * already on screen with its own units. */
  globalThis.fetch = serve('rankings');
  clearSeasonCache();
  res = await loadSeason(index, 'atlantic', 2005);
  ok(res.status === 'ok' && res.storms.length > 0,
    'a 404 on the rankings file leaves 175 years of history untouched');
  ok(res.rankings === null,
    `==> AND IT ARRIVES AS null RATHER THAN AS AN EMPTY SHAPE. <== A hollow `
    + `{scopes:{}} would reach the renderer and draw a heading with nothing under it. `
    + `Got ${JSON.stringify(res.rankings)}`);
  ok(archiveRankHtml(rankStorm(stormFacts(res.storms[0]), res.rankings, 'atlantic')) === '',
    'so the section draws nothing at all, rather than a shrug');
  ok(res.storms.some((st) => (st.landfallsComputed || []).length > 0),
    'and the landfalls, a different file and a different job, are unaffected');

  /* ==> A BASIN WITH NO REVISION IS NOT FETCHED AT A GUESSED FILENAME. <== The
   * same fail-closed rule the places sidecar has. */
  globalThis.fetch = serve();
  clearSeasonCache();
  ok(await loadRankings({ dir: '/seasons/data', basins: {} }) === null,
    'an index with no basins is answered null rather than fetched at a guess');
  ok(await loadRankings({ dir: '/seasons/data', basins: { atlantic: {} } }) === null,
    'and so is a basin carrying no revision');

  /* ==> THE TABLE AND ITS BASIN ARE ONLY EVER CORRECT TOGETHER. <== Read apart,
   * an Atlantic storm gets ranked against the Pacific ladder and the answer is
   * printed with full confidence. Losing the basin is not a crash; it silently
   * drops the row a reader most wants. */
  const withBasin = rankStorm(stormFacts(katrina), JSON.parse(
    readFileSync(TABLE_FILE, 'utf8'),
  ), 'atlantic');
  const noBasin = rankStorm(stormFacts(katrina), JSON.parse(
    readFileSync(TABLE_FILE, 'utf8'),
  ), null);
  ok(withBasin.scopes.length === 2 && noBasin.scopes.length === 1,
    'a table handed over without its basin loses the basin rank silently');
  ok(!/in the Atlantic/.test(archiveRankHtml(noBasin, { year: 2005 })),
    'and the sentence a reader most wants is the one that disappears');

  /* ==> A 200 CARRYING THE WRONG SHAPE IS NOT A 404, AND ONLY ONE OF THE TWO
   * TAKES THE catch(). <== Cloudflare's SPA fallback answers a missing file
   * with `index.html` at status 200 (§57.35), and a route rewritten one day to
   * return `{}` would answer just as cheerfully. Both arrive down the `.then`,
   * where a shape check is the only thing standing between the renderer and a
   * heading with nothing under it. */
  globalThis.fetch = async (url) => (String(url).includes('rankings')
    ? { ok: true, status: 200, json: async () => ({ generated: 'x' }) }
    : serve()(url));
  clearSeasonCache();
  res = await loadSeason(index, 'atlantic', 2005);
  ok(res.rankings === null,
    `a 200 with no scopes in it is refused at the door, not passed on. `
    + `Got ${JSON.stringify(res.rankings)}`);
  ok(res.status === 'ok' && res.storms.length > 0, 'and the season is still fine');

  globalThis.fetch = realFetch;
  clearSeasonCache();
}

/* ------------------------------------------------------------------------- */
section('THE BOARD — the table is dropped on a year change and travels with its basin');
{
  /* ==> DRIVEN WITH STUBS RATHER THAN LEFT UNCOVERED. <== Two mutations
   * survived every other section in this file: keeping the old table across a
   * season change, and handing it to the panel without the basin it must be
   * read against. Neither throws. Both silently print a rank against the wrong
   * set. `createSeasonsBoardLoading` takes every dependency as an injected
   * facade, so this costs a stub rather than a browser. */
  const { createSeasonsBoardLoading } = await import('../ui/seasons-board-loading.js');

  const tableA = { scopeOrder: ['atlantic', 'all'], scopes: { atlantic: {}, all: {} } };
  const tableB = { scopeOrder: ['epacific', 'all'], scopes: { epacific: {}, all: {} } };

  const seasonsStub = {
    loadIndex: async () => ({ status: 'ok', index: { basins: { atlantic: {}, epacific: {} } } }),
    seasonsIn: () => [2005, 2004],
    loadSeason: async (_i, basin) => ({
      status: 'ok', storms: [], faults: [],
      rankings: basin === 'atlantic' ? tableA : tableB,
    }),
  };
  const liveStub = {
    loadLiveIndex: async () => ({ status: 'unavailable', reason: 'stubbed' }),
    loadLiveSeason: async () => ({ status: 'ok', storms: [], faults: [] }),
  };

  const board = createSeasonsBoardLoading({
    seasons: seasonsStub,
    live: liveStub,
    render: () => {},
    onIndexReady: () => {},
    onSeasonChanging: () => {},
  });
  await board.loadIndexOnce();

  ok(board.archive().table === null,
    'before any season is loaded there is no table, rather than an empty one');

  await board.loadSeason('atlantic', 2005);
  ok(board.archive().table === tableA, 'the loaded season hands over its table');
  ok(board.archive().basin === 'atlantic',
    `and the basin it must be read against travels with it. Got ${board.archive().basin}`);

  /* ==> THE BASIN CHANGE IS THE CASE THAT MATTERS. <== A table kept from the
   * Atlantic and read against a Pacific storm does not fail; it ranks her
   * against the wrong ladder and prints the answer in the same voice. */
  await board.loadSeason('epacific', 2005);
  ok(board.archive().table === tableB && board.archive().basin === 'epacific',
    'a basin change replaces both together, never one without the other');

  /* And a season that fails to load must not leave the previous one's table
   * behind it, which would rank the storms of a year that never arrived. */
  seasonsStub.loadSeason = async () => ({ status: 'unavailable', reason: 'stubbed' });
  await board.loadSeason('atlantic', 1899);
  ok(board.archive().table === null && board.archive().basin === null,
    'a season that failed to load leaves no stale table behind it');
}

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
