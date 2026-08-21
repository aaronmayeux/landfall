#!/usr/bin/env node
/**
 * test-telemetry-queries.mjs — the guards inside the D1 SQL, enforced.
 *
 * WHY THIS EXISTS AT ALL
 * Every rule this file checks was, until now, only a comment. Each one is there
 * because breaking it produced a WRONG NUMBER THAT LOOKED RIGHT — a day of
 * sessions dated 1970, a people-count that reported one person for the whole of
 * July, a bucket of unknown-provenance visits reported as "direct". None of
 * those errored. They were quoted, and believed. A comment cannot stop that
 * happening again; a test that fails can.
 *
 * WHAT THIS IS NOT
 * It does not check that the SQL runs — api.cloudflare.com is unreachable from
 * the sandbox by design, and a query that runs can still be confidently wrong,
 * which is the failure mode that actually bit. It checks the properties that
 * make an answer honest.
 *
 * MUTATION-VERIFIED 2026-08-20. Each assertion below was confirmed to FAIL when
 * its guard was removed from tools/telemetry-queries.mjs — deleting the
 * `device <> ''` guard, shortening the no-referrer label to "(direct)", and
 * swapping `DATE(ts, 'unixepoch')` for a divide by 1000 each turned this suite
 * red. A test that has never been seen to fail is decoration.
 *
 * Zero dependencies. Run: node tools/test-telemetry-queries.mjs
 */

import { QUERIES, NO_REFERRER_LABEL } from './telemetry-queries.mjs';

let failures = 0;
let checks = 0;

function ok(cond, what) {
  checks++;
  if (cond) return;
  failures++;
  console.error(`FAIL  ${what}`);
}

/* --- the list itself ------------------------------------------------------ */

ok(Array.isArray(QUERIES) && QUERIES.length > 0, 'QUERIES is a non-empty array');

const names = QUERIES.map((q) => q.name);
ok(new Set(names).size === names.length,
  'query names are unique — two queries sharing a name would silently overwrite ' +
  "each other's output file, leaving one answer wearing the other's name");

for (const q of QUERIES) {
  ok(typeof q.name === 'string' && /^[a-z0-9-]+$/.test(q.name),
    `${q.name}: name is a safe filename (it becomes <name>.json)`);
  ok(typeof q.note === 'string' && q.note.trim().length > 20,
    `${q.name}: has a note explaining what the numbers mean`);
  ok(typeof q.sql === 'string' && /^\s*SELECT\b/i.test(q.sql),
    `${q.name}: SQL is a bare SELECT — this pull is read-only and stays that way`);
  ok(!/;/.test(q.sql),
    `${q.name}: SQL holds no semicolon — the D1 endpoint returns one result per ` +
    'statement and this script only ever reads the first, so a second statement ' +
    'would run and be thrown away');
}

/* --- rule 1: ts is in SECONDS -------------------------------------------- */

for (const q of QUERIES) {
  if (!/\bts\b/.test(q.sql)) continue;
  ok(!/ts\s*\/\s*1000/.test(q.sql),
    `${q.name}: does not divide ts by 1000. sessions.ts is UNIX SECONDS. ` +
    'Dividing produces dates in 1970 that group without erroring — the exact ' +
    'bug that shipped one row reading "1970-01-21: 335 sessions"');
}

/* --- rule 2: timings_ok gates AVERAGES, and only averages ---------------- */

const MS_AVG = /AVG\(\s*\w*(?:_ms|lcp|ttfb|fcp)\w*\s*\)/i;
for (const q of QUERIES) {
  if (!MS_AVG.test(q.sql)) continue;
  ok(/timings_ok\s*=\s*1/.test(q.sql),
    `${q.name}: averages a millisecond column, so it must filter timings_ok = 1. ` +
    'Rows with untrustworthy clocks move an average without saying they did');
}

for (const q of QUERIES) {
  if (!/timings_ok/.test(q.sql)) continue;
  ok(MS_AVG.test(q.sql),
    `${q.name}: filters timings_ok but averages nothing. A row with bad timings ` +
    'is still a real visit — filtering it out of a COUNT undercounts traffic ' +
    'and reports the undercount as the total');
}

/* --- rule 3: an empty identifier is not an identifier -------------------- */

const peopleQueries = QUERIES.filter((q) => /COUNT\(\s*DISTINCT[\s\S]*device/i.test(q.sql));
ok(peopleQueries.length > 0,
  'at least one query counts distinct devices — without one, "how many people" ' +
  'is unanswerable and only visit counts exist');

for (const q of peopleQueries) {
  ok(/device\s*<>\s*''/.test(q.sql),
    `${q.name}: counts distinct devices, so it must exclude device = ''. The ` +
    'column was added 2026-08-05 and every older row carries the default. ' +
    'Without this guard every pre-2026-08-05 day reports exactly ONE person — ' +
    'a plausible number that is a pure artefact');
}

const dailyDevices = QUERIES.find((q) => q.name === 'daily-devices');
ok(!!dailyDevices, 'daily-devices query exists');
if (dailyDevices) {
  ok(/sessions_without_device/.test(dailyDevices.sql),
    'daily-devices reports how many rows its people-count ignored. A floor ' +
    'presented without its hole reads as a total');
}

/* --- the referrer bucket must stay honest -------------------------------- */

const refQueries = QUERIES.filter((q) => /ref_host/.test(q.sql));
ok(refQueries.length >= 2,
  'referrers are queried both all-time and per-day — the all-time table alone ' +
  'flattens a one-day spike and a steady trickle into the same row');

for (const q of refQueries) {
  ok(q.sql.includes(NO_REFERRER_LABEL),
    `${q.name}: buckets empty ref_host under the shared honest label`);
  ok(!/'\(direct\)'/.test(q.sql),
    `${q.name}: does NOT label the empty bucket "(direct)". ref_host was added ` +
    '2026-08-14; that bucket also holds every older session, whose referrer is ' +
    'simply unknown. Calling it direct turns missing data into a finding');
}

ok(/pre-2026-08-14/.test(NO_REFERRER_LABEL),
  'the no-referrer label names the date the column was added, so the caveat ' +
  'travels with the number into whatever reads it');

/* --- both new answers are actually reachable ----------------------------- */

for (const required of ['daily-devices', 'referrers', 'referrers-daily']) {
  ok(names.includes(required),
    `${required} is in the pull — this is what makes "how many people" and ` +
    '"where did they come from" answerable from the archive with no connector');
}

/* --- report -------------------------------------------------------------- */

if (failures) {
  console.error(`\ntelemetry-queries: ${failures} of ${checks} checks FAILED`);
  process.exit(1);
}
console.log(`telemetry-queries: ${checks} checks passed`);
