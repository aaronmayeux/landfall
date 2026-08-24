#!/usr/bin/env node
/**
 * test-seasons-ids.mjs — the seasons routes' id vocabulary.
 * Drives `functions/api/seasons/_ids.js`. SPEC-DATA.md §58, §57.13.
 *
 * THREE THINGS IT GUARDS, and each is a real failure rather than a hypothetical.
 *
 * 1. **THE FORCED SECOND COPY AGREES WITH THE FIRST.** `isRealStorm` exists in
 *    `lib/hurdat.js` and again in `functions/api/seasons/_ids.js`, because a
 *    Pages Function runs in its own runtime and cannot import the app (§3).
 *    This is the same shape as `parseSubject`, which survived being duplicated
 *    only because a test held the two together. Every basin token and every
 *    storm number 00-99 is put through both, plus a pile of malformed input.
 *
 * 2. **THE ID PATTERN IS ANCHORED AT BOTH ENDS.** `functions/api/seasons/storm.js`
 *    builds an upstream URL out of this value. Unanchored,
 *    `https://evil.example/?ok=al012026` passes and the function fetches it from
 *    inside Cloudflare's network under our User-Agent — the hole
 *    `functions/api/nws/alert.js` closed on the other route that does this.
 *    **The anchors were verified by removing each one and confirming the
 *    refusal cases below go red.**
 *
 * 3. **THE ROUTE AND THE MIRROR DROP THE SAME FILES.** Both walk NHC's b-deck
 *    directory. If they disagree, a reader comparing `/api/seasons/live`
 *    against `git show origin/seasons-live:manifest.json` sees two different
 *    seasons and cannot tell which is wrong. Run against the REAL listing
 *    captured on 2026-08-24, whose answer is independently known: 18 files
 *    listed, 14 real storms, 4 invests dropped by name.
 *
 * Zero dependencies. `node tools/test-seasons-ids.mjs`
 */

import { readFileSync } from 'node:fs';

import {
  parseStormId, isRealStorm, idFromFilename, filenameFromId,
  rejectionReason, indexFromListing, NHC_BASINS, REAL_MIN, REAL_MAX,
} from '../functions/api/seasons/_ids.js';

import {
  parseStormId as libParseStormId,
  isRealStorm as libIsRealStorm,
} from '../lib/hurdat.js';

import { SEASONS } from '../config/constants.js';

let passed = 0;
const failures = [];
const ok = (label, cond) => {
  if (cond) passed++;
  else failures.push(label);
};
const eq = (label, got, want) =>
  ok(`${label} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`,
    JSON.stringify(got) === JSON.stringify(want));

/* ===========================================================================
 * 1. THE TWO COPIES AGREE
 * ========================================================================= */

/* The constants themselves, first. If these drift the rest is theatre. */
eq('basin list matches SEASONS.nhcBasins',
  [...NHC_BASINS].map((b) => b.toUpperCase()).sort(),
  [...SEASONS.nhcBasins].sort());
eq('REAL_MIN matches SEASONS.realStormNumberMin', REAL_MIN, SEASONS.realStormNumberMin);
eq('REAL_MAX matches SEASONS.realStormNumberMax', REAL_MAX, SEASONS.realStormNumberMax);

/* Every basin token that could appear in that directory, real or not, against
 * every storm number 00-99 and three years. 2,400 comparisons. */
const BASIN_TOKENS = ['al', 'ep', 'cp', 'wp', 'io', 'sh', 'xx', 'a1', '12'];
let parity = 0;
for (const basin of BASIN_TOKENS) {
  for (let n = 0; n <= 99; n++) {
    for (const year of [1851, 2005, 2026]) {
      const id = `${basin}${String(n).padStart(2, '0')}${year}`;
      const mine = isRealStorm(id);
      /* lib/hurdat.js upper-cases internally; both must agree on the same
       * characters a caller would actually send. */
      const theirs = libIsRealStorm(id);
      ok(`isRealStorm disagreement on ${id}: route ${mine}, lib ${theirs}`, mine === theirs);

      const mp = parseStormId(id);
      const tp = libParseStormId(id);
      const same = (mp === null && tp === null) ||
        (mp && tp && mp.number === tp.number && mp.year === tp.year &&
          mp.basin.toUpperCase() === tp.basin.toUpperCase());
      ok(`parseStormId disagreement on ${id}`, !!same);
      parity += 2;
    }
  }
}
ok(`parity sweep ran (${parity} comparisons)`, parity === BASIN_TOKENS.length * 100 * 3 * 2);

/* ==> ON MALFORMED INPUT THE TWO ARE DELIBERATELY NOT IDENTICAL, AND THIS
 * SUITE FOUND THAT RATHER THAN ASSUMING IT. <== `lib/hurdat.js` TRIMS before
 * matching, which is right: it reads a field out of a padded CSV row, and
 * `AL012026 ` in a HURDAT2 header is the same storm. The route does NOT trim,
 * which is also right: it reads a URL query parameter, where whitespace is
 * something a caller put there on purpose and the job is to refuse anything
 * that is not exactly the eight characters.
 *
 * ==> SO THE INVARIANT IS ONE-DIRECTIONAL, NOT EQUALITY. <== The route may be
 * STRICTER than the parser and must never be LOOSER. A route that accepts what
 * the parser would reject is the hole; a route that rejects what the parser
 * would accept costs a caller a retype. Written as equality, this block failed
 * on exactly two inputs and both were the route being correct.
 */
const JUNK = [
  '', null, undefined, 'al01202', 'al0120266', 'AL012026 ', ' al012026',
  'al01202a', 'al-012026', 'al012026.dat', 'bal012026', '../al012026',
  'al012026/../../etc/passwd', 'al012026%00', 'al012026\nal022026',
  '\tal012026\t', 'al 012026',
];
for (const j of JUNK) {
  ok(`route is looser than the parser on ${JSON.stringify(j)}`,
    !(isRealStorm(j) === true && libIsRealStorm(j) === false));
}

/* And name the two that differ, so the difference is an assertion rather than
 * a gap. If the route ever starts trimming, these go red and somebody has to
 * decide that on purpose. */
ok('the route refuses a trailing space the parser would accept',
  isRealStorm('AL012026 ') === false && libIsRealStorm('AL012026 ') === true);
ok('the route refuses a leading space the parser would accept',
  isRealStorm(' al012026') === false && libIsRealStorm(' al012026') === true);

/* ===========================================================================
 * 2. THE ANCHORS
 *
 * ==> VERIFIED BY MUTATION. <== With `^` removed from STORM_ID_RE, cases 1-4
 * below turn green and this block goes red. With `$` removed, cases 5-8 do.
 * Both were run before this suite was committed.
 * ========================================================================= */

const MUST_REFUSE = [
  'https://evil.example/?ok=al012026',
  'https://evil.example/al012026',
  'x=al012026',
  '\u0000al012026',
  'al012026?x=y',
  'al012026@evil.example',
  'al012026/../wp012026',
  'al012026\u0000.dat',
  'al012026#al922026',
];
for (const bad of MUST_REFUSE) {
  ok(`refused: ${JSON.stringify(bad)}`, isRealStorm(bad) === false);
  ok(`no partial parse of: ${JSON.stringify(bad)}`, parseStormId(bad) === null);
}

/* And the thing it must still accept, or the guard has eaten the feature. */
ok('accepts al012026', isRealStorm('al012026') === true);
ok('accepts uppercase AL012026', isRealStorm('AL012026') === true);
ok('accepts cp012026', isRealStorm('cp012026') === true);
eq('filenameFromId round-trips', idFromFilename(filenameFromId('al012026')), 'al012026');
eq('filenameFromId lowercases', filenameFromId('AL012026'), 'bal012026.dat');

/* ===========================================================================
 * 3. THE REAL DIRECTORY, AND THE ANSWER IS INDEPENDENTLY KNOWN
 *
 * `samples/seasons/listings/btk-directory-2026-08-24.html` is the byte-for-byte
 * page NHC served on 2026-08-24. The step 0 probe counted it and the seasons
 * mirror stored from it, both independently: 18 listed, 14 stored, these four
 * dropped. Two measurements, same answer.
 * ========================================================================= */

const listing = readFileSync(
  new URL('../samples/seasons/listings/btk-directory-2026-08-24.html', import.meta.url), 'utf8');
const idx = indexFromListing(listing);

eq('listed 18 .dat files', idx.listed, 18);
eq('14 real storms', idx.storms.length, 14);
eq('4 dropped', idx.skipped.length, 4);
eq('the four dropped, by name', idx.skipped.map((s) => s.file),
  ['bal952026.dat', 'bep902026.dat', 'bep912026.dat', 'bep922026.dat']);
eq('the storms, by id', idx.storms.map((s) => s.id), [
  'al012026', 'al022026', 'al032026',
  'cp012026', 'cp022026',
  'ep012026', 'ep022026', 'ep032026', 'ep042026', 'ep052026',
  'ep062026', 'ep072026', 'ep082026', 'ep092026',
]);
ok('every dropped file says why', idx.skipped.every((s) => typeof s.reason === 'string' && s.reason.length > 5));
eq('the year comes off the filename, not the clock',
  [...new Set(idx.storms.map((s) => s.year))], [2026]);

/* The directory's own navigation links must not be counted as storms. The real
 * page carries `?C=N;O=D`, `/atcf/` and `cphc/` — a naive href sweep counts
 * five extra things and reports a nineteen-storm season. */
ok('sort links and the parent directory are not storms',
  !idx.storms.some((s) => /[?/]/.test(s.id)));

/* THE MIRROR'S OWN ANSWER, ASSERTED AGAINST THIS ONE. The manifest committed
 * to `seasons-live` on 2026-08-24 read listed 18, eligible 14, and named these
 * same four skips. Hardcoded here rather than fetched, because a test that
 * needs the network is a test that is red on the sandbox. */
const MIRROR_SAID = {
  listed: 18,
  eligible: 14,
  skipped: ['bal952026.dat', 'bep902026.dat', 'bep912026.dat', 'bep922026.dat'],
};
eq('route agrees with the mirror on the count', idx.listed, MIRROR_SAID.listed);
eq('route agrees with the mirror on eligibility', idx.storms.length, MIRROR_SAID.eligible);
eq('route agrees with the mirror on which files dropped',
  idx.skipped.map((s) => s.file), MIRROR_SAID.skipped);

/* An invest is dropped for the RIGHT reason, not by accident of some other
 * rule. `rejectionReason` is what the wire says, so it has to be true. */
ok('an invest is named as an invest',
  /invest|reused/i.test(rejectionReason('bal952026.dat')));
ok('a non-NHC basin is named as one',
  /basin/i.test(rejectionReason('bwp012026.dat')));
eq('a real storm has no rejection reason', rejectionReason('bal012026.dat'), null);

/* An empty or broken listing must produce zero, never a guess. `live.js` turns
 * a zero into a fall-through to last-good rather than into an empty season. */
eq('an empty page lists nothing', indexFromListing('').listed, 0);
eq('an error page lists nothing', indexFromListing('<h1>503</h1>').listed, 0);

/* ------------------------------------------------------------------------ */

if (failures.length) {
  console.log(`FAIL  test-seasons-ids — ${failures.length} of ${passed + failures.length}`);
  for (const f of failures.slice(0, 20)) console.log(`  - ${f}`);
  if (failures.length > 20) console.log(`  ... and ${failures.length - 20} more`);
  process.exit(1);
}
console.log(`ok    test-seasons-ids — ${passed} assertions`);
