#!/usr/bin/env node
/**
 * test-session-row.mjs — the session row's three silent contracts.
 *
 * WHY THIS EXISTS. The `sessions` table is written by positional SQL: one
 * hand-written column list in functions/api/_telemetry-store.js, one
 * hand-written field list in functions/api/beacon.js, one snapshot builder in
 * lib/perf.js, and a database whose real column order was set by a sequence of
 * `ALTER TABLE ADD COLUMN` statements typed months apart.
 *
 * ===> EVERY FAILURE MODE HERE IS SILENT. THAT IS THE WHOLE POINT. <===
 * Nothing in this chain throws when it goes wrong:
 *
 *   - A column list that drifts out of order does not error. It writes
 *     `visit_ms` into `boot_longtask_ms` and every row after it is quietly,
 *     confidently wrong. D1 will not complain: they are both integers.
 *   - A field the client sends and the server's allowlist does not name is
 *     dropped in silence, and the column reads 0 forever — which is
 *     indistinguishable from "this browser did not report it".
 *   - A validity rule that is too generous stores an impossible number as a
 *     fact, which is exactly how a 368-second iPhone row passed as clean on
 *     2026-08-14 and how a wrong platform comparison got drawn on 2026-08-05.
 *
 * This table's entire job is to be trusted when something looks strange. A
 * dataset that is quietly wrong is worse than no dataset, because the app
 * ships changes based on it.
 *
 * WHAT THIS COVERS:
 *  1. the storage column list and the beacon's field lists name the same set
 *  2. lib/perf.js and lib/usage.js actually emit every field the server
 *     accepts — a name typed two ways is a permanently-zero column
 *  3. referrer hostnames are shape-checked, not clipped
 *  4. the timings_ok ceiling rejects a boot no honest phone produced
 *
 * WHAT IT DOES NOT COVER: whether D1's live column order matches the code.
 * That needs the network and is checked by hand at ALTER TABLE time — see the
 * appended-column note in _telemetry-store.js. This is a contract test
 * between four files.
 *
 * Zero dependencies, like every other tool here (§12).
 *
 * Run: node tools/test-session-row.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let failures = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return;
  failures++;
  console.error(`  ✗ ${label}\n      expected ${e}\n      actual   ${a}`);
};

/* Pull a flat array-of-strings literal out of a source file by the name it is
 * assigned to. Read from the SOURCE TEXT rather than imported, because both
 * of these live in Pages Function modules that may touch Workers globals. */
function stringList(src, name) {
  const at = src.indexOf(name);
  if (at < 0) return null;
  const open = src.indexOf('[', at);
  const close = src.indexOf(']', open);
  if (open < 0 || close < 0) return null;
  return [...src.slice(open, close).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

const storeSrc = read('functions/api/_telemetry-store.js');
const beaconSrc = read('functions/api/beacon.js');
const perfSrc = read('lib/perf.js');
const usageSrc = read('lib/usage.js');

/* ---------------------------------------------------------------------------
 * 1. THE COLUMN LIST AND THE ALLOWLISTS DESCRIBE THE SAME ROW.
 *
 * The store writes positionally, so its list is the schema. The beacon builds
 * the object. A field in one and not the other is either a column that is
 * never written or a value that is never stored, and neither says a word.
 * ------------------------------------------------------------------------- */

const columns = stringList(storeSrc, 'SESSION_COLUMNS');
const nums = stringList(beaconSrc, 'SESSION_NUMS');

check('SESSION_COLUMNS is readable', Array.isArray(columns) && columns.length > 40, true);
check('SESSION_NUMS is readable', Array.isArray(nums) && nums.length > 20, true);

/* Fields the store holds that do not come from SESSION_NUMS: the envelope
 * fields, the enums, the derived flag, and the one free-form string. Named
 * explicitly so that adding a column without deciding which kind it is fails
 * here rather than silently joining this list. */
const NON_NUMERIC = new Set([
  'ts', 'app', 'country', 'standalone',
  'platform', 'engine', 'nav_type', 'conn_type',
  'device', 'timings_ok', 'ref_host',
]);

const numericColumns = columns.filter((c) => !NON_NUMERIC.has(c));
const missingFromBeacon = numericColumns.filter((c) => !nums.includes(c));
const missingFromStore = nums.filter((c) => !columns.includes(c));

check('every numeric column is named in the beacon allowlist', missingFromBeacon, []);
check('every allowlisted number has a column to land in', missingFromStore, []);

/* ---------------------------------------------------------------------------
 * 2. THE CLIENT ACTUALLY EMITS WHAT THE SERVER ACCEPTS.
 *
 * ===> THIS IS THE ONE THAT CATCHES A TYPO. <===
 * The server rebuilds the row from its own allowlist, so a client field named
 * `t_script_ms` where the server expects `t_scripts_ms` is not an error
 * anywhere. It is a column that reads zero on every row, forever, looking
 * exactly like a browser that does not support the measurement.
 * ------------------------------------------------------------------------- */

const clientSrc = `${perfSrc}\n${usageSrc}`;

/* Two shapes count as "the client names this field", because the two modules
 * build their halves differently and both are legitimate:
 *   `field:`   a literal key in perf.js's hand-written snapshot object
 *   `'field'`  a member of usage.js's ACTIONS list, which snapshot() loops
 *              over to build its keys dynamically
 * Anything matching neither is a name that exists only on the server. */
const emitted = (f) => clientSrc.includes(`${f}:`) || clientSrc.includes(`'${f}'`);

const neverEmitted = nums.filter((f) => !emitted(f));
check('every allowlisted field is emitted by perf.js or usage.js', neverEmitted, []);
check('ref_host is emitted by the client too', emitted('ref_host'), true);

/* The boot milestone must be a legal mark name or mark() drops it on the
 * floor and t_scripts_ms is zero on every row. */
const constantsSrc = read('config/constants.js');
check("'scripts' is an allowed mark name", /marks:[^)]*'scripts'/.test(constantsSrc), true);

/* ===> A COMMENTED-OUT CALL STILL CONTAINS THE STRING. <===
 * `includes("perfMark('scripts')")` passes happily against `// perfMark(...)`,
 * which is exactly the state a half-finished debugging session leaves behind
 * — and the column would read zero on every row while this test stayed green.
 * Caught by mutation-testing on 2026-08-14. Comment lines are stripped first;
 * the call must survive as live code. */
const liveCode = (src) => src
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
  .join('\n');

check('main.js actually fires the scripts mark, uncommented',
  liveCode(read('main.js')).includes("perfMark('scripts')"), true);

/* ---------------------------------------------------------------------------
 * 3. REFERRER HOSTNAMES ARE SHAPE-CHECKED, NOT CLIPPED.
 *
 * `ref_host` is the only free-form string a client can put in this row. The
 * rule stated in beacon.js is that an open string column is how arbitrary
 * caller-controlled data gets into a dataset — so this must reject anything
 * that is not a hostname rather than storing 64 characters of it.
 * ------------------------------------------------------------------------- */

const REF_HOST_SHAPE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const refHostStr = (value) => {
  if (typeof value !== 'string' || value.length > 64) return '';
  const host = value.toLowerCase();
  return REF_HOST_SHAPE.test(host) ? host : '';
};

/* The regex under test is the one in the route. If the two drift this test is
 * checking a copy of itself, so the copy is verified against the source. */
check('the shape tested here is the shape the route uses',
  beaconSrc.includes(REF_HOST_SHAPE.source), true);

check('an ordinary referrer survives', refHostStr('reddit.com'), 'reddit.com');
check('a subdomain survives', refHostStr('old.reddit.com'), 'old.reddit.com');
check('case is folded so GROUP BY does not split', refHostStr('Reddit.com'), 'reddit.com');
check('a hyphenated host survives', refHostStr('news-site.co.uk'), 'news-site.co.uk');

check('a full URL is rejected, not clipped',
  refHostStr('https://reddit.com/r/hawaii?q=secret'), '');
check('a path is rejected', refHostStr('reddit.com/r/hawaii'), '');
check('a query string is rejected', refHostStr('reddit.com?token=abc123'), '');
check('a bare word with no dot is rejected', refHostStr('localhost'), '');
check('an email address is rejected', refHostStr('someone@example.com'), '');
check('whitespace is rejected', refHostStr('reddit.com evil'), '');
check('a prose sentence is rejected', refHostStr('my home is at 21.3 -157.8'), '');
check('an over-long value is rejected outright', refHostStr(`${'a'.repeat(70)}.com`), '');
check('a non-string is rejected', refHostStr(null), '');
check('empty stays empty', refHostStr(''), '');

/* ---------------------------------------------------------------------------
 * 4. THE VALIDITY RULE, INCLUDING THE CEILING.
 *
 * The visibility half was already right and is re-checked here so a change to
 * the ceiling cannot quietly break it. The ceiling is the new half: a screen
 * that locks mid-load does not reliably fire `visibilitychange` on iOS, so a
 * six-minute "load" can satisfy every visibility test and still be a phone in
 * a pocket.
 * ------------------------------------------------------------------------- */

const MAX_PLAUSIBLE_BOOT_MS = 60000;

const timingsOk = (row) => {
  const lastMarkMs = Math.max(
    row.t_scripts_ms || 0, row.t_globe_ms || 0, row.t_data_ms || 0, row.t_storms_ms || 0,
  );
  const visibleThroughBoot =
    (row.hidden_at_start || 0) === 0 &&
    lastMarkMs > 0 &&
    ((row.first_hidden_ms || 0) === 0 || row.first_hidden_ms > lastMarkMs);
  return visibleThroughBoot && lastMarkMs <= MAX_PLAUSIBLE_BOOT_MS ? 1 : 2;
};

/* ===> THE COPY BELOW IS A REIMPLEMENTATION, SO IT PROVES NOTHING ON ITS OWN.
 *      THESE THREE CHECKS ARE WHAT TIE IT TO THE SHIPPING CODE. <===
 * Deleting the ceiling from beacon.js does not change the function above, so
 * without these the whole section would keep passing while production went
 * back to storing six-minute screen locks as measurements. That was caught by
 * mutation-testing this file on 2026-08-14 — the first version of it passed
 * happily with the ceiling ripped out.
 *
 * Same remedy as tools/test-kv-keys.mjs: assert against the route's actual
 * source text, not just against a copy of its behaviour. The constant being
 * DECLARED is not enough — an unused constant declares nothing — so the
 * derivation expression itself is what gets checked. */
/* ===> READ THE NUMBER OUT AND COMPARE IT AS A NUMBER. <===
 * The obvious `includes('MAX_PLAUSIBLE_BOOT_MS = 60000')` is a SUBSTRING
 * match, so it is perfectly satisfied by `= 600000` — a ceiling ten times too
 * high, which is to say no ceiling at all for the screen-lock rows this
 * exists to reject. Mutation-testing caught it on 2026-08-14; reading the
 * check, it looks completely sound. */
const declaredCeiling = Number(
  beaconSrc.match(/MAX_PLAUSIBLE_BOOT_MS\s*=\s*(\d+)/)?.[1] ?? NaN,
);
check('the ceiling tested here is the ceiling the route declares',
  declaredCeiling, MAX_PLAUSIBLE_BOOT_MS);
check('the route computes the ceiling from the last milestone',
  /plausibleBoot\s*=\s*lastMarkMs\s*<=\s*MAX_PLAUSIBLE_BOOT_MS/.test(beaconSrc), true);
check('the route actually applies the ceiling to timings_ok',
  /timings_ok\s*=\s*visibleThroughBoot\s*&&\s*plausibleBoot/.test(beaconSrc), true);
check('the scripts mark is inside the route\'s milestone maximum',
  /lastMarkMs\s*=\s*Math\.max\([^)]*t_scripts_ms/.test(beaconSrc), true);

check('a clean desktop load is a measurement',
  timingsOk({ t_globe_ms: 900, t_storms_ms: 1400 }), 1);
check('a phone put down AFTER the boot is still a measurement',
  timingsOk({ t_globe_ms: 900, t_storms_ms: 1400, first_hidden_ms: 8000 }), 1);
check('a page hidden DURING the boot is not',
  timingsOk({ t_globe_ms: 900, t_storms_ms: 4000, first_hidden_ms: 1200 }), 2);
check('a page already hidden when it started is not',
  timingsOk({ t_globe_ms: 900, t_storms_ms: 1400, hidden_at_start: 1 }), 2);
check('a boot that reached no milestone is not',
  timingsOk({}), 2);

/* The real row that prompted the ceiling: iOS, 2026-08-13, fcp 366,635ms.
 * Every visibility flag on it reads clean. */
check('the 368-second screen-lock row is rejected',
  timingsOk({ t_globe_ms: 367522, t_data_ms: 368380, t_storms_ms: 368380 }), 2);

/* The slowest HONEST load in the table, a 2G Android on 2026-08-09. It must
 * survive — a ceiling that throws away real bad loads would hide exactly the
 * problem this column exists to find. */
check('the slowest real load, 35 seconds on 2G, survives',
  timingsOk({ t_globe_ms: 28384, t_data_ms: 30262, t_storms_ms: 34944 }), 1);

check('a boot just under the ceiling survives', timingsOk({ t_storms_ms: 59999 }), 1);
check('a boot just over the ceiling does not', timingsOk({ t_storms_ms: 60001 }), 2);

/* The scripts mark counts toward the ceiling too — a row where only the
 * earliest milestone landed, impossibly late, must not slip through. */
check('an impossible scripts mark alone is caught',
  timingsOk({ t_scripts_ms: 120000 }), 2);

/* ------------------------------------------------------------------------- */

if (failures) {
  console.error(`\n${failures} session-row contract failure(s) — the table would be quietly wrong.\n`);
  process.exit(1);
}
console.log('✓ session row contract holds: columns aligned, referrer bounded, ceiling enforced');
