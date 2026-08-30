#!/usr/bin/env node
/**
 * test-seasons-retired.mjs — the rules behind the retired-names answer.
 *
 * ==> IT DRIVES THE SHIPPED MODULE AGAINST THE REAL ARCHIVE, NOT A FIXTURE.
 * <== §12: a test that passes on the same wrong assumption as the bug it
 * guards is worse than no test. Six of the rules below exist because a
 * measurement on the real files disagreed with what the plan assumed, so
 * every one of them is asserted against those same files. The invented cases
 * are only for shapes the archive does not currently contain — a season that
 * runs onto the supplemental list, a stale roster year — and each says so.
 *
 * ==> EVERY RULE HERE WAS MUTATION-CHECKED. <== Each was deleted from
 * `seasons-retired-derive.mjs` in turn and this suite re-run; each turned red.
 * A rule added later without that step is a rule nobody has proved.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  BASINS, FLOOR, ACTIVE_LIST_COUNT, SUPPLEMENTAL_ERA, DELTA_CAP, ORDINAL,
  readBasin, inServiceFrom, derive, crossCheck, judge,
} from './seasons-retired-derive.mjs';
import { NAME_ROSTERS } from '../lib/season-names-data.js';
import { CPACIFIC_LISTS, CPACIFIC_IN_SERVICE } from './cpacific-lists.mjs';
import {
  HISTORIC_ATLANTIC, HISTORIC_EPACIFIC, HISTORIC_CPACIFIC,
  RETIRED_BY_DESCRIPTION, GREEK_NEVER_RETIRED, RETIRED_NEVER_USED,
} from '../data/retired-names-historic.js';
import { RETIRED_DERIVED } from '../data/retired-names.js';
import { ROOT } from './module-graph.mjs';

let failed = 0;
let checked = 0;
const bad = (m) => { console.error(`  ✗ ${m}`); failed++; };
const ok = (cond, m) => { checked++; if (!cond) bad(m); };

/* ---------------------------------------------------------------------------
 * The real archive, read the way the runner reads it.
 * ------------------------------------------------------------------------ */

function bestTrack(prefix) {
  const dir = path.join(ROOT, 'seasons', 'data');
  const found = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.txt')).sort();
  if (!found.length) { bad(`no ${prefix}*.txt in seasons/data/`); return ''; }
  return fs.readFileSync(path.join(dir, found[found.length - 1]), 'utf8');
}

const TEXT = new Map();
const record = {};
for (const { key, file, prefixes } of BASINS) {
  if (!TEXT.has(file)) TEXT.set(file, bestTrack(file));
  record[key] = readBasin(TEXT.get(file), prefixes);
}

const EXCLUSIONS = {
  greek: new Set(GREEK_NEVER_RETIRED),
  described: new Set(RETIRED_BY_DESCRIPTION.map(([n]) => n)),
  neverUsed: new Set(RETIRED_NEVER_USED),
};

const live = inServiceFrom(NAME_ROSTERS, CPACIFIC_IN_SERVICE);
ok(!live.faults.length, `reading the lists in service reported: ${live.faults.join('; ')}`);

const { derived, declined } = derive(record, live.inService, EXCLUSIONS, live.listLengths);
const flat = Object.values(derived).flat();
const byName = new Map(flat);

/* ---------------------------------------------------------------------------
 * 1. The answer the runner would produce is the answer that is committed.
 *    This is what makes every assertion below about the SHIPPED file rather
 *    than about a calculation nobody reads.
 * ------------------------------------------------------------------------ */

for (const { key } of BASINS) {
  const want = JSON.stringify(RETIRED_DERIVED[key]);
  const got = JSON.stringify(derived[key]);
  ok(want === got, `${key}: the committed derived block does not match a fresh derivation`);
}

/* ---------------------------------------------------------------------------
 * 2. Cross-check: every claimed name joins a real storm and is never used
 *    again afterwards.
 * ------------------------------------------------------------------------ */

const xfaults = crossCheck(derived, record);
ok(!xfaults.length, `cross-check against the record: ${xfaults.join('; ')}`);

/* ==> AND IT HAS TO BE DRIVEN INVENTED AS WELL, BECAUSE A CLEAN ARCHIVE
 * EXERCISES NONE OF IT. <== Deleting the used-again rule changed nothing at
 * all in the run above — of course it did: no real claim is wrong, so the rule
 * never fires and removing it is invisible. §12 calls a test that stays green
 * with the rule gone worse than no test, so each branch is driven by hand. */
{
  const used = new Map([['ZED', [1990, 2001]]]);
  const fake = { atlantic: { used, spend: new Map(), headers: 1 } };
  ok(crossCheck({ atlantic: [['ZED', 1990]], epacific: [], cpacific: [] }, fake).length === 1,
    'a name used again AFTER its retirement year must fail — a retired name cannot come back');
  ok(crossCheck({ atlantic: [['ZED', 2001]], epacific: [], cpacific: [] }, fake).length === 0,
    'and the same name dated to its last use must pass');
  ok(crossCheck({ atlantic: [['ZED', 1995]], epacific: [], cpacific: [] }, fake).length === 2,
    'a year the record does not carry must fail');
  ok(crossCheck({ atlantic: [['NOPE', 1990]], epacific: [], cpacific: [] }, fake).length === 1,
    'a name matching no storm at all must fail');
}

/* A track row must never be read as a storm header.
 *
 * ==> TWO RULES GUARD THIS AND ONLY ONE OF THEM IS LOAD-BEARING. <== The field
 * count and the id pattern both reject it, and loosening the field count alone
 * changes nothing because a track row leads with a date rather than a storm id.
 * That is recorded rather than papered over: the redundancy is deliberate, and
 * this asserts the BEHAVIOUR so it stays true whichever rule is carrying it. */
{
  const text = [
    'AL011851,            UNNAMED,     14,',
    'AL021851,              ZEBRA,      2,',
    '18510625, 0000,  , HU, 28.0N,  94.8W,  80, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999',
  ].join('\n');
  const r = readBasin(text, ['AL']);
  ok(r.headers === 2, `two storm headers expected, read ${r.headers}`);
  ok(r.used.size === 1 && r.used.has('ZEBRA'), 'only the named storm reaches the name list');

  /* ==> AND THE FIELD COUNT ON ITS OWN, WHICH NO REAL ROW CAN REACH. <== Three
   * separate rules reject a track row — the field count, the id pattern and
   * the basin prefix — and any one of them suffices, so deleting any one is
   * invisible against the archive. Measured: deleting all three was invisible
   * too, because a track row leads with a date and fails the prefix. So this
   * drives the field count alone, with a row that passes the other two: a
   * header carrying fields we do not understand is refused rather than
   * guessed at. */
  const wide = readBasin('AL011851, WIDE, 14, unexpected, extra, fields', ['AL']);
  ok(wide.headers === 0, 'a header row with fields we do not recognise must be refused');
  ok(!wide.used.has('WIDE'), 'and its name must not reach the name list');
}

/* ---------------------------------------------------------------------------
 * 3. Nothing below a basin's floor. Below it, "off the list" means dropped or
 *    misspelt as often as it means retired.
 * ------------------------------------------------------------------------ */

for (const { key } of BASINS) {
  for (const [name, year] of derived[key]) {
    ok(year >= FLOOR[key], `${key}: ${name} ${year} is below the ${FLOOR[key]} floor`);
  }
}

/* ---------------------------------------------------------------------------
 * 4. A NAME IN SERVICE IS NEVER RETIRED. The whole method in one line.
 * ------------------------------------------------------------------------ */

for (const [name] of flat) {
  ok(!live.inService.has(name), `${name} is claimed retired but is still on an active list`);
}

/* ---------------------------------------------------------------------------
 * 5. THE CENTRAL PACIFIC NAMES ARE WHY THE PACIFIC ANSWER IS USABLE AT ALL.
 *    CPHC-named storms are recorded under east Pacific ids, so without the
 *    48 names in service every one of them falls out looking retired.
 *    MEASURED 2026-08-30: these four do, and there is no other route to them.
 * ------------------------------------------------------------------------ */

for (const n of ['ELA', 'ULIKA', 'LANA', 'AKONI']) {
  ok(CPACIFIC_IN_SERVICE.includes(n), `${n} should be a Central Pacific name in service`);
  ok(!byName.has(n), `${n} is in service in the Central Pacific and must not be reported retired`);
}
ok(CPACIFIC_LISTS.length === 4, `expected 4 Central Pacific lists, got ${CPACIFIC_LISTS.length}`);
ok(CPACIFIC_IN_SERVICE.length === 48, `expected 48 Central Pacific names, got ${CPACIFIC_IN_SERVICE.length}`);

/* ---------------------------------------------------------------------------
 * 6. THE ATLANTIC CLAIMS A CROSSOVER NAME FIRST. Otto 2016, Bonnie 2022 and
 *    Julia 2022 all crossed into the east Pacific and the record carries them
 *    twice. MEASURED: those three, and nothing else in the archive.
 * ------------------------------------------------------------------------ */

ok(record.epacific.used.has('OTTO'), 'OTTO should appear in the east Pacific record');
ok(derived.atlantic.some(([n]) => n === 'OTTO'), 'OTTO is an Atlantic retirement');
ok(!derived.epacific.some(([n]) => n === 'OTTO'), 'OTTO must not be reported twice, once per basin');
for (const n of ['BONNIE', 'JULIA']) {
  ok(record.epacific.used.has(n), `${n} should appear in the east Pacific record`);
  ok(!byName.has(n), `${n} is still in service in the Atlantic and must not be reported retired`);
}
const seen = new Set();
for (const [n] of flat) {
  ok(!seen.has(n), `${n} appears in the answer under two basins`);
  seen.add(n);
}

/* ==> AND THE LIMITATION THE CLAIM RULE CARRIES IS ASSERTED RATHER THAN
 * ASSUMED AWAY. <== Claiming by NAME means a name genuinely retired in two
 * basins for two different storms in the same era would be reported once.
 * MEASURED 2026-08-30 by running the subtraction per basin with no claim rule
 * at all: exactly one name is claimed twice, OTTO, and both claims are the
 * SAME STORM in the SAME YEAR — a crossover, which is what the rule is for.
 * If a second name ever turns up here, the rule needs a year in it. */
{
  const perBasin = {};
  const noClaim = [];
  for (const { key } of BASINS) {
    perBasin[key] = [...record[key].used]
      .filter(([n, ys]) => ys.some((y) => y >= FLOOR[key])
        && !live.inService.has(n)
        && !EXCLUSIONS.greek.has(n) && !EXCLUSIONS.described.has(n) && !EXCLUSIONS.neverUsed.has(n))
      .map(([n, ys]) => [n, Math.max(...ys)]);
  }
  const where = new Map();
  for (const { key } of BASINS) {
    for (const [n, y] of perBasin[key]) {
      if (!where.has(n)) where.set(n, []);
      where.get(n).push([key, y]);
    }
  }
  for (const [n, places] of where) if (places.length > 1) noClaim.push([n, places]);
  ok(noClaim.length === 1, `${noClaim.length} names are claimed by more than one basin, expected 1 (OTTO)`);
  for (const [n, places] of noClaim) {
    ok(n === 'OTTO', `${n} is claimed by two basins and only OTTO should be`);
    const years = new Set(places.map(([, y]) => y));
    ok(years.size === 1, `${n} is claimed by two basins in different years — the claim rule needs a year in it`);
  }
}

/* ---------------------------------------------------------------------------
 * 7. THE GREEK LETTERS. Seven get nothing; two are retired by DESCRIPTION and
 *    are carried separately so their copy can read differently.
 * ------------------------------------------------------------------------ */

for (const n of GREEK_NEVER_RETIRED) {
  ok(record.atlantic.used.has(n), `${n} should appear in the Atlantic record`);
  ok(!byName.has(n), `${n} was never retired — the Greek alphabet was abolished, not withdrawn name by name`);
}
for (const [n] of RETIRED_BY_DESCRIPTION) {
  ok(!byName.has(n), `${n} must not be in the derived answer — it is retired by description`);
}
ok(RETIRED_BY_DESCRIPTION.length === 2,
  `exactly two Greek storms were retired (Eta and Iota), the file claims ${RETIRED_BY_DESCRIPTION.length}`);

/* ---------------------------------------------------------------------------
 * 8. ORDINALS AND UNNAMED STORMS ARE NOT NAMES. The record labels an unnamed
 *    depression after its number, both with and without the hyphen.
 * ------------------------------------------------------------------------ */

ok(ORDINAL.test('TWENTY-ONE') && ORDINAL.test('TWENTYONE') && ORDINAL.test('NINETEEN'),
  'the ordinal pattern must match both spellings the record uses');
ok(!ORDINAL.test('TEDDY') && !ORDINAL.test('NINA'), 'the ordinal pattern must not eat real names');
for (const { key } of BASINS) {
  for (const name of record[key].used.keys()) {
    ok(name !== 'UNNAMED' && !ORDINAL.test(name), `${key}: "${name}" reached the name list`);
  }
}

/* ---------------------------------------------------------------------------
 * 9. ONLY THE SIX MOST RECENT LISTS COUNT AS IN SERVICE.
 *
 *    ==> THE ARCHIVE CANNOT SHOW THIS YET, WHICH IS THE POINT. <== The roster
 *    file merges forward and never drops a year, so it will eventually hold
 *    seasons already spent. A name retired after one of those seasons is taken
 *    off the list it will next appear on, but the stale column keeps it — and
 *    a union over every year would report it as still in service. Silently.
 *    Forever. So this is driven with a fabricated seventh year.
 * ------------------------------------------------------------------------ */

{
  const stale = { atlantic: { ...NAME_ROSTERS.atlantic } };
  const years = Object.keys(NAME_ROSTERS.atlantic).map(Number).sort((a, b) => a - b);
  /* An older year holding a name that really was retired. Katrina is on no
   * current list and is the least ambiguous case in the archive. */
  stale.atlantic[years[0] - 1] = ['KATRINA', ...NAME_ROSTERS.atlantic[years[0]].slice(1)];
  const s = inServiceFrom(stale, CPACIFIC_IN_SERVICE);
  ok(!s.inService.has('KATRINA'),
    'a stale roster year must not keep a retired name in service');
  ok(!s.faults.length, `the seven-year roster should still parse: ${s.faults.join('; ')}`);
  ok(Object.keys(stale.atlantic).length === ACTIVE_LIST_COUNT + 1,
    'the fabricated roster should carry one year more than the window');
}

/* ---------------------------------------------------------------------------
 * 10. THE SUPPLEMENTAL GUARD DECLINES RATHER THAN GUESSING.
 *
 *     A season from 2021 on that spends more names than its rotating list
 *     holds has run onto the supplemental list, which this repo does not hold.
 *     §5: that is "we could not look", never "not retired".
 *
 *     ==> NO REAL SEASON HAS DONE THIS, SO IT IS DRIVEN INVENTED. <== Asserted
 *     both ways: it declines when it should, and it stays silent otherwise.
 * ------------------------------------------------------------------------ */

ok(declined.length === 0,
  `no season in the record has run onto the supplemental list, but ${declined.length} were declined`);

{
  const spend = new Map([[SUPPLEMENTAL_ERA + 1, 30]]);
  const fake = {
    atlantic: { used: new Map([['ZZZTEST', [SUPPLEMENTAL_ERA + 1]]]), spend, headers: 1 },
  };
  const r = derive(fake, new Set(), EXCLUSIONS, { atlantic: 21 });
  ok(r.derived.atlantic.length === 0,
    'a name spent past the rotating list in the supplemental era must not be claimed retired');
  ok(r.declined.length === 1, 'and it must be declined out loud rather than dropped in silence');

  /* The same storm one year before the supplemental list existed is judgeable:
   * 2005 and 2020 ran onto the GREEK alphabet, which we can see. */
  const early = { atlantic: { used: new Map([['ZZZTEST', [SUPPLEMENTAL_ERA - 1]]]), spend: new Map([[SUPPLEMENTAL_ERA - 1, 30]]), headers: 1 } };
  const e = derive(early, new Set(), EXCLUSIONS, { atlantic: 21 });
  ok(e.derived.atlantic.length === 1, 'a busy season before 2021 is still judgeable');
  ok(e.declined.length === 0, 'and must not be declined');
}

/* ---------------------------------------------------------------------------
 * 11. THE MONOTONIC GATE AND THE DELTA CAP.
 * ------------------------------------------------------------------------ */

{
  const now = new Set(['A', 'B']);
  ok(judge(now, new Set(['A', 'B'])).faults.length === 0, 'an unchanged answer must pass');
  ok(judge(now, new Set(['A', 'B', 'C'])).faults.length === 1,
    'a name leaving the answer must fail — retirement is append-only');
  ok(judge(new Set(['A', 'B']), new Set(['A'])).faults.length === 0, 'one new name must pass');

  const flood = new Set(['A']);
  for (let i = 0; i <= DELTA_CAP; i++) flood.add(`N${i}`);
  ok(judge(flood, new Set(['A'])).faults.length === 1,
    `more than ${DELTA_CAP} new names in one run must fail`);
  ok(judge(new Set([...'A', 'N0']), new Set(['A'])).faults.length === 0,
    'and the cap must not fire below it');
}

/* ---------------------------------------------------------------------------
 * 12. THE HISTORIC BLOCK IS SEPARATE, AND THE TWO NEVER OVERLAP. A name in
 *     both would be counted twice by anything that concatenates them.
 * ------------------------------------------------------------------------ */

/* ==> PER BASIN, NOT GLOBALLY, AND THAT IS A REAL FACT ABOUT THE WORLD RATHER
 * THAN A LOOSENED ASSERTION. <== DORA is a frozen Atlantic entry from 1964 AND
 * a derived east Pacific retirement from 2023. Two different storms, two
 * different basins, one name. A global check reports that as a duplicate and
 * is simply wrong; it fired on exactly this the first time it ran. */
const HISTORIC = { atlantic: HISTORIC_ATLANTIC, epacific: HISTORIC_EPACIFIC, cpacific: HISTORIC_CPACIFIC };
for (const { key } of BASINS) {
  const frozen = new Set(HISTORIC[key].map(([n]) => n));
  for (const [n] of derived[key]) {
    ok(!frozen.has(n), `${key}: ${n} is both derived and in the frozen historic block`);
  }
}
for (const [, y] of HISTORIC_ATLANTIC) ok(y < FLOOR.atlantic, `an Atlantic historic entry is dated ${y}, at or above the floor`);
for (const [, y] of HISTORIC_EPACIFIC) ok(y < FLOOR.epacific, `an east Pacific historic entry is dated ${y}, at or above the floor`);
for (const [, y] of HISTORIC_CPACIFIC) ok(y < FLOOR.cpacific, `a central Pacific historic entry is dated ${y}, at or above the floor`);

/* ---------------------------------------------------------------------------
 * 13. THE MEASURED SHAPE OF TODAY'S ANSWER. Not a rule, a tripwire: if any of
 *     these move, something upstream changed and somebody should know why.
 * ------------------------------------------------------------------------ */

ok(record.atlantic.headers === 2004, `the Atlantic record holds ${record.atlantic.headers} storms, expected 2004`);
ok(derived.atlantic.length === 72, `${derived.atlantic.length} Atlantic retirements derived, expected 72`);
ok(derived.epacific.length === 12, `${derived.epacific.length} east Pacific retirements derived, expected 12`);
ok(derived.cpacific.length === 2, `${derived.cpacific.length} central Pacific retirements derived, expected 2`);
ok(live.inService.size === 305, `${live.inService.size} names in service, expected 305`);

if (failed) {
  console.error(`\n✗ ${failed} of ${checked} checks failed`);
  process.exit(1);
}
console.log(`✓ ${checked} checks — ${flat.length} retirements derived from the record `
  + `and ${live.inService.size} names in service, no list fetched`);
