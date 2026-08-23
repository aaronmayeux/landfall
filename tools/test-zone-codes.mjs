#!/usr/bin/env node
/**
 * test-zone-codes.mjs — which zones a Flood Watch names. §56.4.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-zone-codes.mjs`, like every suite here.
 *
 * ===========================================================================
 * WHAT THIS CAN PROVE, AND WHAT IT DELIBERATELY CANNOT
 * ===========================================================================
 *
 * Phase 4 of the flood plan needs two things NWS publishes: the list of zones a
 * watch names, and the boundary of each zone. **Only the first is readable from
 * a sandbox.** `api.weather.gov` is outside the wall, so the zone BOUNDARY —
 * its envelope, its geometry type, its vertex count, its byte cost — is not
 * asserted anywhere in this file and must not be. That is what the archive
 * runner is being sent to fetch, and §12's rule is that a test passing on the
 * same guess as the code is worse than no test at all.
 *
 * So this suite covers exactly the decision it can stand on: **which URLs the
 * runner asks for.** A wrong code 404s and lands in the manifest looking
 * identical to a zone NWS genuinely dropped, which would poison the very
 * capture this is being taken to get.
 *
 * ===========================================================================
 * THE FIXTURE IS REAL BYTES AND THE COUNTS ARE COMPUTED
 * ===========================================================================
 *
 * `samples/flood/watches-national.json` is `api.weather.gov/alerts/active
 * ?event=Flood%20Watch` verbatim, taken off the `archive` branch and frozen
 * here because that branch's window is 72 hours and rolls. Captured
 * 2026-08-23T01:51:50Z: three watches, 8 + 11 + 4 zones, every one of them
 * carrying `geometry: null`.
 *
 * ==> EVERY NUMBER BELOW WAS PRINTED BY RUNNING CODE OVER THAT FILE, NOT TYPED
 * FROM THE PARAGRAPH ABOVE. <== The suite recomputes the totals from the
 * fixture rather than hardcoding 23, so a fixture swapped for a busier day
 * fails loudly on the assertions that matter instead of silently agreeing with
 * a stale sentence. CLAUDE.md's first rule.
 */

import { readFileSync } from 'node:fs';
import { watchZoneCodes } from './zone-codes.mjs';

const failures = [];
let pass = 0;
const ok = (cond, label) => (cond ? pass++ : failures.push(label));

const WATCHES = JSON.parse(
  readFileSync(new URL('../samples/flood/watches-national.json', import.meta.url), 'utf8')
);

/* --- the fixture is what this file claims it is --------------------------- */

ok(Array.isArray(WATCHES.features), 'the fixture is a FeatureCollection');
ok(
  WATCHES.features.every((f) => f.properties?.event === 'Flood Watch'),
  'every row in the fixture is a Flood Watch'
);
/* ==> THE PREMISE OF THE WHOLE PHASE, ASSERTED RATHER THAN RECITED. <== If a
 * watch ever arrives carrying a real polygon, §56.4's reason for existing is
 * weaker and this line is where that gets noticed. */
ok(
  WATCHES.features.every((f) => f.geometry === null),
  'and every one of them carries geometry: null — the premise of §56.4'
);

/* --- the codes ------------------------------------------------------------ */

const { forecast, county, malformed } = watchZoneCodes(WATCHES);

/* Computed from the fixture, never typed. */
const rawTotal = WATCHES.features.reduce(
  (n, f) => n + (f.properties?.geocode?.UGC?.length || 0),
  0
);
const distinct = new Set(
  WATCHES.features.flatMap((f) => f.properties?.geocode?.UGC || [])
).size;

ok(forecast.length === distinct, `every distinct zone is returned (${distinct})`);
ok(rawTotal === distinct, 'and on this capture no zone is named by two watches');
ok(forecast.length > 0, 'the capture names at least one zone');
ok(malformed === 0, 'nothing in the real capture is malformed');
/* ==> RECORDED AS A MEASUREMENT, NOT AS A RULE. <== Every code in this capture
 * is a forecast zone. That is what one quiet day looked like; it is NOT a
 * guarantee about Flood Watches in general, which is exactly why the code path
 * for county codes exists and is tested below on a synthetic fixture. */
ok(county.length === 0, 'and every code in this capture is a forecast zone, not a county');

/* --- the shape of what comes out ----------------------------------------- */

ok(
  forecast.every((c) => /^[A-Z]{2}Z\d{3}$/.test(c)),
  'every returned code is a well-formed forecast zone'
);
ok(
  forecast.join(',') === [...forecast].sort().join(','),
  'the list is sorted, so file names are stable across runs'
);

/* The states in the capture, computed rather than named. */
const states = [...new Set(forecast.map((c) => c.slice(0, 2)))].sort();
ok(states.length >= 2, `the capture spans more than one state (${states.join(', ')})`);

/* --- COUNTY CODES GO DOWN A DIFFERENT PATH AND MUST NOT BE LUMPED IN ------ */
/* A mutation test caught this gap: a regex accepting both `Z` and `C` passed
 * every assertion above, because the real capture happens to contain no county
 * code at all. A synthetic fixture is the only way to drive it. */

const mixed = {
  features: [
    {
      geometry: null,
      properties: {
        event: 'Flood Watch',
        geocode: { UGC: ['OHZ011', 'OHC011', 'PAC003', 'PAZ017'] },
      },
    },
  ],
};
const m = watchZoneCodes(mixed);
ok(
  m.forecast.join(',') === 'OHZ011,PAZ017',
  'only forecast zones reach the /zones/forecast/ list'
);
ok(
  m.county.join(',') === 'OHC011,PAC003',
  'county codes are kept and reported separately, never silently dropped'
);
ok(
  !m.forecast.some((c) => c.includes('C')),
  'and no county code can become a /zones/forecast/ URL that 404s'
);

/* --- DEDUPLICATION ACROSS WATCHES, NOT JUST WITHIN ONE -------------------- */
/* The other gap the mutation test found: the real capture has no zone named by
 * two watches, so removing the Set changed nothing and everything still passed.
 * Neighbouring offices routinely both name a zone. */

const shared = {
  features: [
    { geometry: null, properties: { event: 'Flood Watch', geocode: { UGC: ['OHZ011', 'OHZ012'] } } },
    { geometry: null, properties: { event: 'Flood Watch', geocode: { UGC: ['OHZ012', 'OHZ013'] } } },
  ],
};
const d = watchZoneCodes(shared);
ok(
  d.forecast.join(',') === 'OHZ011,OHZ012,OHZ013',
  'a zone named by two watches is fetched once, not twice'
);

/* --- the things that must NOT become a URL -------------------------------- */

const junk = {
  features: [
    {
      geometry: null,
      properties: {
        event: 'Flood Watch',
        geocode: {
          UGC: [
            'OHZ011',      // good
            'ohz012',      // good, lowercase — normalised, not dropped
            '  PAZ017  ',  // good, padded
            'OHZ11',       // two digits, not three
            'OHZ0111',     // four digits
            'O H Z 0 1 1', // spaced
            'SAME:015001', // a SAME code that wandered into the wrong array
            '',
            null,
            undefined,
          ],
        },
      },
    },
  ],
};
const cleaned = watchZoneCodes(junk);
ok(
  cleaned.forecast.join(',') === 'OHZ011,OHZ012,PAZ017',
  'malformed codes are dropped and good ones normalised, never guessed at'
);
ok(cleaned.malformed === 4, `and the drops are counted, not swallowed (${cleaned.malformed})`);

/* --- zero is a real answer ------------------------------------------------ */

ok(watchZoneCodes({ features: [] }).forecast.length === 0, 'no watches derives no URLs');
ok(watchZoneCodes(null).forecast.length === 0, 'and a null body does not throw');
ok(
  watchZoneCodes({ features: [{ properties: {} }] }).forecast.length === 0,
  'nor does a watch with no geocode block'
);

/* ------------------------------------------------------------------------- */

for (const f of failures) console.log(`  ✗ ${f}`);
console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed`
    : `\n✓ ${pass} assertions passed — ${forecast.length} zones across ${states.length} states`
);
console.log('  (what a zone BOUNDARY looks like is not asserted here — nothing');
console.log('   in a sandbox has ever seen one. That is what the runner is for.)');
process.exit(failures.length ? 1 : 0);
