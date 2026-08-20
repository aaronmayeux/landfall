#!/usr/bin/env node
/**
 * test-ships.mjs — the SHIPS parser against the twelve fixtures. §47.2, §47.4, §47.10.
 *
 * WHAT THIS IS FOR. The environment ribbon reports the model's own accounting
 * in knots and claims to add nothing of its own. That claim is only worth
 * anything if the nineteen contribution rows land in the right three groups
 * and none of them is quietly dropped — which is exactly the mistake §47.4
 * records being made once already, when an earlier version of the section
 * named sixteen rows and left the accounting short by as much as 20 kt.
 *
 * ==> THE RECONCILIATION DOES NOT CATCH A MIS-GROUPED ROW, AND §47.4 SAYS IT
 * DOES. <== The section reads "a residual outside +-4 kt means a row is in the
 * wrong group or a row exists that this section has never seen". The second
 * half is true. The FIRST HALF IS NOT: the three groups are summed together
 * before being compared to TOTAL CHANGE, so moving `SST POTENTIAL` from
 * headroom into environment leaves the residual at exactly zero while
 * inverting the ribbon on every major hurricane — the single failure §47.4
 * calls the most important decision in the section.
 *
 * What actually catches it is the block of MEASURED ANCHORS below: real ranges
 * off named fixtures, quoted in §47.10, which move violently the moment a row
 * changes group. Mutation-tested at the bottom of this file by moving a row
 * and confirming the anchors go red while the reconciliation stays green.
 * Without them this suite would pass on the same wrong assumption as the bug,
 * which is worse than having no suite at all.
 *
 * Zero dependencies. Run: node tools/test-ships.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  parseShips,
  ShipsParseError,
  SHIPS_ROWS,
  SHIPS_ENV_KEYS,
  SHIPS_RECONCILE_TOLERANCE_KT,
} from '../functions/api/nhc/_ships-parse.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'samples', 'ships');

let failures = 0;
const ok = (label) => console.log(`  \u2713 ${label}`);
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return ok(label);
  failures++;
  console.error(`  \u2717 ${label}\n      expected ${e}\n      actual   ${a}`);
};
const truthy = (label, value) => {
  if (value) return ok(label);
  failures++;
  console.error(`  \u2717 ${label}`);
};

const raw = (f) => readFileSync(path.join(DIR, f), 'utf8');
const files = readdirSync(DIR).filter((f) => f.endsWith('_ships.txt')).sort();
const parsed = new Map();

const range = (a) => (a.length ? [Math.min(...a), Math.max(...a)] : null);
const drawableOnly = (r, a) => a.filter((_, i) => r.drawable[i]);

/* ==========================================================================
 * 1. EVERY FIXTURE PARSES.
 *
 * The twelve are not representative, they are the season's EXTREMES (§47.10):
 * the only major hurricane, the only file containing SUBT, the most hostile
 * and most helpful environments, the biggest headroom, the file with no
 * position past hour 0, the biggest land-decay gap, both Atlantic shapes with
 * their eyewall block, the latest-published run and the one published early.
 * A parser that handles all of them handles the season. Twelve were promoted
 * for the parser (§47.10); three more — the §47.8 acceptance storms Hernan,
 * 94L and Lala — came with the health paragraph. The sixteenth is Lala's
 * 12Z run of 2026-08-20, which is here to be the RUN half of
 * `tools/test-cone-dateline.mjs`: that test needs a real SHIPS file to pair
 * with a real dateline-split cone, and a made-up run beside real geometry
 * would prove only that the two halves of the fixture agree with each other.
 * This count moves with the table so a fixture silently dropped from the repo
 * still fails loudly.
 * ======================================================================= */
console.log('\nfixtures parse');
check('sixteen fixtures are present', files.length, 16);
for (const f of files) {
  try {
    parsed.set(f, parseShips(raw(f)));
    ok(`${f} parses`);
  } catch (e) {
    failures++;
    console.error(`  \u2717 ${f} threw: ${e.message}`);
  }
}
if (parsed.size !== files.length) {
  console.error('\nfixtures did not all parse; the rest of this suite is meaningless.');
  process.exit(1);
}

/* ==========================================================================
 * 2. THE NINETEEN ROWS, AND THEIR THREE GROUPS. §47.4.
 * ======================================================================= */
console.log('\nthe nineteen contribution rows');
check('nineteen rows are read and placed', SHIPS_ROWS.length, 19);
check(
  'ten are the environment (the only colored group)',
  SHIPS_ROWS.filter((r) => r.group === 'env').length,
  10
);
check(
  'one is water headroom, shown and never colored',
  SHIPS_ROWS.filter((r) => r.group === 'headroom').map((r) => r.label),
  ['SST POTENTIAL']
);
check(
  'eight are the storm and the model\u2019s bookkeeping',
  SHIPS_ROWS.filter((r) => r.group === 'storm').length,
  8
);
check(
  'the three shear rows are summed into one term, because shear is one thing to a reader',
  SHIPS_ROWS.filter((r) => r.key === 'shear').map((r) => r.label),
  ['VERTICAL SHEAR MAG', 'VERTICAL SHEAR ADJ', 'VERTICAL SHEAR DIR']
);
check('so ten environment rows become eight terms', SHIPS_ENV_KEYS.length, 8);
truthy(
  'SST POTENTIAL is NOT among the colored terms \u2014 §47.4\u2019s single most important decision',
  !SHIPS_ENV_KEYS.includes('sstPotential')
);

/* ==========================================================================
 * 3. THE RECONCILIATION, ON EVERY HOUR OF EVERY FILE.
 *
 * The parser throws past the tolerance, so reaching here at all proves it
 * held. This re-checks it from the OUTSIDE, against the published payload,
 * because the payload is what the map colors — a parser that reconciled
 * internally and then emitted a different `environmentKt` would pass its own
 * assertion and still be wrong.
 * ======================================================================= */
console.log('\nreconciliation \u2014 three groups add back to TOTAL CHANGE');
let worstResidual = 0;
for (const [f, r] of parsed) {
  let worst = 0;
  for (let i = 0; i < r.hours.length; i++) {
    const sum = r.environmentKt[i] + r.headroomKt[i] + r.stormKt[i];
    worst = Math.max(worst, Math.abs(r.totalChangeKt[i] - sum));
  }
  worstResidual = Math.max(worstResidual, worst);
  truthy(`${f} reconciles at all 16 hours (worst ${worst} kt)`, worst <= SHIPS_RECONCILE_TOLERANCE_KT);
}
truthy(
  `worst residual across all twelve is ${worstResidual} kt, inside §47.4\u2019s +-${SHIPS_RECONCILE_TOLERANCE_KT}`,
  worstResidual <= SHIPS_RECONCILE_TOLERANCE_KT
);

/* ==========================================================================
 * 4. MEASURED ANCHORS, quoted from §47.10 and §47.5.
 *
 * ==> THIS IS THE BLOCK THAT GUARDS THE GROUPING. <== Each number was measured
 * against a real file and written into the spec before this parser existed.
 * They are quoted over the DRAWABLE hours, which is the window §47 measures
 * in — the same file's full 16 columns run wider, because the tail past the
 * end of the forecast is never painted.
 * ======================================================================= */
console.log('\nmeasured anchors from §47.10');
const major = parsed.get('26072706EP0726_ships.txt');
check(
  'the season\u2019s only major hurricane: environment runs -13..+3 over its drawable hours',
  range(drawableOnly(major, major.environmentKt)),
  [-13, 3]
);
check(
  'the same run: headroom runs -83..-1 \u2014 the file that proves the exclusion',
  range(drawableOnly(major, major.headroomKt)),
  [-83, -1]
);
check('and it is a 140 kt storm', major.currentWindKt, 140);

const helpful = parsed.get('26072012EP0526_ships.txt');
check(
  'most helpful environment of any named storm in the season: +38 kt',
  Math.max(...helpful.environmentKt),
  38
);

const hostileAl = parsed.get('26081406AL9226_ships.txt');
check(
  'most hostile drawable environment: -52 kt',
  Math.min(...drawableOnly(hostileAl, hostileAl.environmentKt)),
  -52
);

const cp = parsed.get('26071600CP9126_ships.txt');
check(
  'biggest headroom in the season, on a 25 kt system: +67 kt',
  Math.max(...drawableOnly(cp, cp.headroomKt)),
  67
);
check('and that system really is 25 kt \u2014 headroom is weakness, not warmth', cp.currentWindKt, 25);
check(
  'biggest ocean-heat term that ever reaches the map: 4 kt',
  Math.max(...drawableOnly(cp, cp.terms.oceanHeat)),
  4
);

const decay = parsed.get('26060618EP9226_ships.txt');
check(
  'largest land-decay gap in the season: 42 kt between V (KT) NO LAND and V (KT) LAND',
  Math.max(...decay.vNoLandKt.map((v, i) => (v === null ? 0 : v - decay.vLandKt[i]))),
  42
);

/* ==========================================================================
 * 5. THE EIGHT NON-NUMERIC TOKENS. §47.2.
 * ======================================================================= */
console.log('\nthe eight tokens that are not numbers');
const types = new Set();
for (const r of parsed.values()) for (const t of r.stormType) types.add(t);
check(
  'TROP, SUBT and EXTP are all met, and N/A becomes null',
  [...types].sort(),
  ['EXTP', 'SUBT', 'TROP', null].sort()
);
const subt = parsed.get('26080218EP0726_ships.txt');
truthy(
  'the season\u2019s ONLY SUBT sits in the fixture chosen for it, beside EXTP and TROP',
  subt.stormType.includes('SUBT') &&
    subt.stormType.includes('EXTP') &&
    subt.stormType.includes('TROP')
);
truthy(
  'LOST in MODEL VTX does not reach the payload \u2014 it is in the top table this layer does not read',
  raw('26081406AL9226_ships.txt').includes('LOST')
);
truthy(
  'xx.x and xxx.x become null positions rather than numbers',
  parsed.get('26060618EP9126_ships.txt').lat.every((v) => v === null || typeof v === 'number')
);

/* ==========================================================================
 * 6. THE ATLANTIC SECOND `TIME (HR)`. §47.2.
 *
 * Every Atlantic file carries a DSHIPS eyewall-replacement block with its own
 * `TIME (HR)` row. A label lookup that does not take the FIRST match reads
 * that table instead, on all 60 Atlantic files in the season.
 * ======================================================================= */
console.log('\nthe Atlantic second TIME (HR) trap');
for (const f of ['26072112AL0226_ships.txt', '26081406AL9226_ships.txt']) {
  const src = raw(f);
  const timeRows = src.split(/\r?\n/).filter((l) => /TIME \(HR\)/.test(l));
  truthy(`${f} really does carry two TIME (HR) rows, so the trap is live`, timeRows.length === 2);
  truthy(
    `${f} also carries the DSHIPS block and its DIS tokens`,
    src.includes('DSHIPS INTENSITY FORECAST') && src.includes('DIS')
  );
  const r = parsed.get(f);
  check(`${f} reads the FIRST table: forecast hours start at +6`, r.hours[0], 6);
  check(`${f} reads the FIRST table: sixteen contribution hours`, r.hours.length, 16);
}

/* ==========================================================================
 * 7. BASIN COMES FROM THE ID, NEVER THE HEADER TEXT. §47.2.
 * ======================================================================= */
console.log('\nbasin from the id, not the banner');
for (const f of ['26071600CP9126_ships.txt', '26081106CP9326_ships.txt']) {
  truthy(`${f} is headed EAST PACIFIC \u2014 the banner is wrong`, raw(f).includes('EAST PACIFIC'));
  check(`${f} is nonetheless Central Pacific, from its id`, parsed.get(f).basin, 'CP');
}
check('the four-digit year survives on the id', major.id, 'EP072026');
check('and the FILENAME form carries a two-digit year \u2014 the whole trap', major.stormId, 'EP0726');
check('the run\u2019s synoptic stamp rebuilds its own filename', major.synoptic, '26072706');
check('issued at the synoptic hour, in UTC', major.issuedAt, '2026-07-27T06:00:00.000Z');
check('invests are read like anything else', cp.kind, 'invest');
check('and named storms are marked as such', major.kind, 'storm');

/* ==========================================================================
 * 8. WINDS AND POSITIONS TRUNCATE INDEPENDENTLY, EITHER CAN COME FIRST. §47.2.
 * ======================================================================= */
console.log('\ntwo forecast ends, in both orders');
const noPos = parsed.get('26060618EP9126_ships.txt');
check('EP9126 publishes winds to +60 h', noPos.lastWindHr, 60);
check('EP9126 publishes NO position past hour 0 \u2014 §47.6\u2019s nothing-to-draw case', noPos.lastPositionHr, null);
check('so nothing about it is drawable', noPos.drawableHours, 0);

const longPos = parsed.get('26061618EP9326_ships.txt');
check('EP9326 runs the other way: wind stops at +84 h', longPos.lastWindHr, 84);
check('while its position runs to +120 h', longPos.lastPositionHr, 120);
check('drawable takes where BOTH exist (§47.2), so nine hours', longPos.drawableHours, 9);

/* ==========================================================================
 * 9. UNITS AND SIGNS.
 * ======================================================================= */
console.log('\nunits and signs');
check('longitude is signed east, so a west Atlantic storm is negative', parsed.get('26072112AL0226_ships.txt').lon[0], -86.7);
check('the current position comes off the file\u2019s own summary line', [major.currentLat, major.currentLon], [15.1, -111.7]);
truthy(
  'nothing is converted \u2014 every figure out of here is a whole knot',
  [...parsed.values()].every((r) => r.environmentKt.every(Number.isInteger))
);
truthy(
  'push and pull bracket the net at every hour of every file',
  [...parsed.values()].every((r) =>
    r.hours.every((_, i) => Math.abs(r.pushKt[i] + r.pullKt[i] - r.environmentKt[i]) < 1e-9)
  )
);

/* ==========================================================================
 * 10. MUTATION TESTS.
 *
 * Every assertion above is now attacked. A test that cannot be made to fail by
 * breaking the thing it tests is not a test, and this project has shipped one
 * before. Each case damages a real fixture and demands a specific failure —
 * not merely "it threw", because a parser that threw `ships_no_header` at a
 * reconciliation bug would pass a looser check while telling us nothing.
 * ======================================================================= */
console.log('\nmutation tests \u2014 break it and confirm it goes red');

const throws = (label, text, code) => {
  try {
    parseShips(text);
  } catch (e) {
    if (e instanceof ShipsParseError && e.code === code) return ok(`${label} \u2192 ${code}`);
    failures++;
    return console.error(`  \u2717 ${label}\n      expected ${code}\n      actual   ${e.code || e.message}`);
  }
  failures++;
  console.error(`  \u2717 ${label} \u2014 DID NOT THROW, so the assertion it tests is decoration`);
};

const base = raw('26072706EP0726_ships.txt');

throws(
  'a row label the file has never carried',
  base.replace('  OCEAN HEAT CONTENT ', '  OCEAN HEAT CONTENTX'),
  'ships_unknown_row'
);
throws(
  'a contribution row deleted outright',
  base.split('\n').filter((l) => !l.startsWith('  SAMPLE MEAN CHANGE')).join('\n'),
  'ships_missing_row'
);
/* ==> AIMED AT A ROW THE PARSER ACTUALLY READS. <== The first version of this
 * case put its token in `TH_E DEV (C)`, which this layer never opens — it
 * passed by doing nothing at all, which is precisely the failure the whole
 * mutation block exists to catch. Two rows, one in each table. */
throws(
  'a ninth non-numeric token in the forecast wind row',
  base.replace('V (KT) NO LAND   140', 'V (KT) NO LAND  ZZZZ'),
  'ships_unknown_token'
);
throws(
  'a ninth non-numeric token inside the contributions block',
  base.replace('  200 MB DIVERGENCE      0.    0.', '  200 MB DIVERGENCE      0.  ZZZZ'),
  'ships_unknown_token'
);
throws(
  'a Storm Type value the file has never carried',
  base.replace('Storm Type      TROP', 'Storm Type      WARM'),
  'ships_unknown_token'
);
throws(
  'a column dropped from a top-table row',
  base.replace(/^LAT \(DEG N\)     15\.1 /m, 'LAT (DEG N)          '),
  'ships_bad_columns'
);
throws(
  'a column dropped from a contribution row',
  base.replace('  PERSISTENCE            7.', '  PERSISTENCE              '),
  'ships_bad_columns'
);
throws('the identity line removed', base.replace(/^.*EP072026.*$/m, ''), 'ships_no_header');
throws(
  'the current-wind line removed',
  base.replace(/^.*CURRENT MAX WIND.*$/m, ''),
  'ships_no_current'
);
throws(
  'the whole contributions block removed',
  base.replace('INDIVIDUAL CONTRIBUTIONS TO INTENSITY CHANGE', 'SOMETHING ELSE ENTIRELY'),
  'ships_no_contributions'
);
throws('an empty body', 'not a ships file', 'ships_not_text');

/* The reconciliation itself: bend TOTAL CHANGE past the tolerance and the
 * parse must stop. Bending it WITHIN the tolerance must not — a check that
 * fires on ordinary rounding slop would be turned off within a week. */
const bendTotal = (kt) =>
  base.replace(
    /^ {2}TOTAL CHANGE {11}4\./m,
    `  TOTAL CHANGE       ${String(4 + kt)}.`.replace(/(\s+)(-?\d+\.)$/, (_, s, v) => s.slice(v.length - 2) + v)
  );
throws('TOTAL CHANGE bent 9 kt past the groups', bendTotal(9), 'ships_reconcile');
try {
  parseShips(bendTotal(3));
  ok('TOTAL CHANGE bent 3 kt still parses \u2014 rounding slop is not an error');
} catch (e) {
  failures++;
  console.error(`  \u2717 the tolerance is too tight: 3 kt of slop threw ${e.code}`);
}

/* ==> AND THE ONE THE RECONCILIATION CANNOT SEE. <== Move `SST POTENTIAL` out
 * of headroom and into the environment — the exact mistake §47.4 exists to
 * prevent, which would paint the season's only major hurricane as the most
 * hostile environment of the year at the moment it was most dangerous. The
 * residual does not move at all, because the three groups are summed together
 * before the comparison. The measured anchors are the only thing that sees it,
 * so this proves they do. */
const headroomRow = SHIPS_ROWS.find((r) => r.label === 'SST POTENTIAL');
headroomRow.group = 'env';
try {
  const misgrouped = parseShips(base);
  const worst = Math.max(
    ...misgrouped.hours.map((_, i) =>
      Math.abs(
        misgrouped.totalChangeKt[i] -
          (misgrouped.environmentKt[i] + misgrouped.headroomKt[i] + misgrouped.stormKt[i])
      )
    )
  );
  truthy(
    'mis-grouping SST POTENTIAL leaves the reconciliation UNTOUCHED \u2014 §47.4 overstates it',
    worst <= SHIPS_RECONCILE_TOLERANCE_KT
  );
  const bad = range(drawableOnly(misgrouped, misgrouped.environmentKt));
  truthy(
    `and the measured anchor catches it instead: environment becomes ${bad[0]}..${bad[1]}, not -13..3`,
    bad[0] !== -13 || bad[1] !== 3
  );
} finally {
  headroomRow.group = 'headroom';
}
check('the group table is restored after that mutation', headroomRow.group, 'headroom');

console.log(
  failures === 0
    ? `\nAll SHIPS checks passed \u2014 ${files.length} fixtures, ${files.length * 16} forecast hours reconciled.\n`
    : `\n${failures} SHIPS check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
