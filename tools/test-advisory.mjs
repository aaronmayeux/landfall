#!/usr/bin/env node
/**
 * test-advisory.mjs — the advisory-text parse rules and the JTWC name join.
 *
 * ZERO DEPENDENCIES, like every other tool here and for the same reason: a
 * guard that only runs on the machine which happens to have a package
 * installed is not a guard (§12 — no toolchain by design).
 *
 * WHAT THIS CAN AND CANNOT PROVE, stated up front:
 *
 *   IT CAN prove the extraction and matching rules — that the product comes
 *   out of the `<pre>` with NOAA's injected anchors flattened to their text,
 *   that entities decode, that a JTWC subject line parses in both its named
 *   and unnamed forms, that GDACS's year suffix falls off, and — the one that
 *   actually earns its keep — that the SUBJECT-LINE REGEX DUPLICATED INTO THE
 *   PAGES FUNCTION still agrees with the one in lib/. Those two cannot import
 *   each other (separate runtimes, §3), so drift between them is silent and
 *   this is the only thing watching for it.
 *
 *   IT CANNOT prove the panel is right. The HTML fixtures below are shaped
 *   from a real probe of /api/nhc/inspect?text=EP1 on 2026-07-25 — one bare
 *   `<pre>`, 2,171 characters, with a live `<a href>` inside the rip-current
 *   paragraph — but they are still fixtures. THE STANDING RULE: when a
 *   fixture passes and glass fails, the fixture is wrong. Go read the real
 *   bytes; both inspect routes are permanent and cost nothing idle.
 */

import fs from 'node:fs';
import {
  extractNhcProduct,
  nhcAdvisoryNumber,
  nhcGustKt,
  parseJtwcWarning,
  stormNameKey,
  matchJtwcStorm,
  decodeEntities,
  tidyProductText,
} from '../lib/advisory.js';
import { parseSubject } from '../functions/api/jtwc/storms.js';

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

/* --- fixtures --------------------------------------------------------------
 * Shaped from the real probe, not invented: the page is site furniture around
 * ONE bare <pre>, and NOAA injects a live anchor inside the product text.
 * ------------------------------------------------------------------------ */

const PRODUCT_BODY = `000
WTPZ31 KNHC 250237
TCPEP1

BULLETIN
Hurricane Fausto Advisory Number  25
NWS National Hurricane Center Miami FL       EP062026
500 PM HST Fri Jul 24 2026

...FAUSTO HOLDING STEADY ON A WESTWARD TRACK TOWARD THE CENTRAL
PACIFIC...


SUMMARY OF 500 PM HST...0300 UTC...INFORMATION
----------------------------------------------
LOCATION...18.7N 133.9W
MAXIMUM SUSTAINED WINDS...105 MPH...165 KM/H
MINIMUM CENTRAL PRESSURE...967 MB...28.56 INCHES


HAZARDS AFFECTING LAND
----------------------
Surf: Swells will affect the coast. Please consult products from
your local weather office and see <a href='https://www.hurricanes.gov/graphics_ep1.shtml?ripCurrents'>hurricanes.gov/graphics_ep1.shtml?ripCurrents</a>


NEXT ADVISORY
-------------
Next complete advisory at 1100 PM HST.

$$
Forecaster Gibbs/Evans/Pierce`;

const page = (inner) =>
  `<!DOCTYPE html><html><head><title></title></head><body>
   <div class="nav"><a href="/">Home</a></div>
   <pre>${inner}</pre>
   <div class="footer-legal"><p><a href="/foia">FOIA</a></p></div>
   </body></html>`;

/* --- NHC extraction --------------------------------------------------------- */
section('NHC product extraction');

const got = extractNhcProduct(page(PRODUCT_BODY));
ok(got !== null, 'a page with a product returns one');
ok(got.text.startsWith('000\nWTPZ31 KNHC 250237'), 'the product starts at its WMO header');
ok(got.text.endsWith('Forecaster Gibbs/Evans/Pierce'), 'the product runs to the forecaster line');
ok(!/<a\b/i.test(got.text), 'NOAA’s injected anchor tag is gone');
ok(
  got.text.includes('hurricanes.gov/graphics_ep1.shtml?ripCurrents'),
  'the anchor’s TEXT survives — dropping it would delete a line the forecaster wrote'
);
ok(!/<[a-z]/i.test(got.text), 'no markup of any kind reaches the screen');
ok(got.text.includes('\n\n'), 'interior blank lines are structure and are preserved');

section('extraction failure modes');
ok(extractNhcProduct('<html><body>no product here</body></html>') === null,
  'a page with no <pre> returns null, never an empty string');
ok(extractNhcProduct(page('too short')) === null,
  'a <pre> holding a fragment is not an advisory');
ok(extractNhcProduct('') === null, 'empty input returns null');
ok(extractNhcProduct(null) === null, 'null input returns null');

/* Today there is exactly one <pre>. "Longest" rather than "first" is what
 * keeps a decorative block added later from becoming the advisory. */
const twoBlocks = `<pre>a decorative block that is quite long but still shorter</pre>${page(PRODUCT_BODY)}`;
ok(
  extractNhcProduct(twoBlocks).text.includes('Forecaster Gibbs'),
  'with two <pre> blocks the LONGEST wins, not the first'
);

section('advisory number, as the product states it');
ok(nhcAdvisoryNumber(PRODUCT_BODY) === '25', 'plain number');
ok(nhcAdvisoryNumber('Tropical Storm Bertha Advisory Number  12A') === '12A',
  'intermediate advisories keep their letter');
ok(nhcAdvisoryNumber('nothing here') === null, 'absent reads as null, not as zero');

/* ---------------------------------------------------------------------------
 * THE GUST — §16 vitals. NHC publishes it in ONE place and it is not the page
 * this app used to read.
 *
 * Checked against the live feed and the archive 2026-08-20: `CurrentStorms.json`
 * has no gust field at any depth, and the PUBLIC advisory says only "with
 * higher gusts" in all nineteen archived Bertha advisories. The coded FORECAST
 * advisory states a number, and `samples/bertha-al022026/fstadv-010.txt` is a
 * real one.
 * ------------------------------------------------------------------------- */
section('the gust, out of the coded forecast advisory');

const FSTADV = fs.readFileSync('samples/bertha-al022026/fstadv-010.txt', 'utf8');

ok(nhcGustKt(FSTADV) === 60, 'the CURRENT gust is read, in knots');

/* ==> AND THE FORECAST GUSTS ARE NOT — TESTED AGAINST THE BLOCK ALONE, WHICH
 * IS THE ONLY WAY THIS ASSERTION MEANS ANYTHING. <==
 *
 * The same product carries six more gust figures below the current one, one
 * per forecast hour, written `MAX WIND  45 KT...GUSTS  55 KT.` — no "TO". A
 * pattern loose enough to accept those would print a 24-hour forecast under a
 * row labelled in the present tense.
 *
 * THE FIRST DRAFT OF THIS CHECK WAS WORTHLESS AND IS WORTH RECORDING. It
 * asserted `nhcGustKt(FSTADV) !== 55` against the whole document — but the
 * current gust always appears ABOVE the forecast block, so a loose regex
 * returns 60 from the first line anyway and the test passes over the bug.
 * Verified by loosening the pattern on purpose: 66 assertions, all green.
 *
 * Feeding the forecast block on its own is what actually separates the two
 * patterns. There is no "GUSTS TO" anywhere in it, so the strict version must
 * find nothing at all. */
const FORECAST_BLOCK =
  'FORECAST VALID 22/0600Z 29.6N  87.9W\n'
  + 'MAX WIND  45 KT...GUSTS  55 KT.\n'
  + '34 KT... 60NE  90SE  50SW  40NW.';
ok(
  /GUSTS\s+55 KT/.test(FORECAST_BLOCK),
  'the block really does state a gust — otherwise the check below passes for '
  + 'the wrong reason'
);
ok(
  nhcGustKt(FORECAST_BLOCK) === null,
  'A FORECAST GUST IS NOT A CURRENT GUST. `MAX WIND ... GUSTS 55 KT` carries '
  + 'no "TO" and must not be read at all — this is the assertion that fails '
  + 'when the pattern is loosened, and the one above it does not'
);

ok(
  nhcGustKt('MAX SUSTAINED WINDS  30 KT WITH GUSTS TO  40 KT.') === 40,
  'the three-column padding NHC pads its numbers with is absorbed'
);
ok(nhcGustKt('MAX SUSTAINED WINDS 85 KT WITH GUSTS TO 105 KT.') === 105,
  'and a three-digit gust needs no padding to be read');
ok(
  nhcGustKt('Maximum sustained winds are near 60 mph (95 km/h) with higher gusts.') === null,
  'THE PUBLIC ADVISORY YIELDS NULL, which is the whole reason a second product '
  + 'is fetched — this phrase is what the app had available before and it '
  + 'carries no number at all'
);
ok(nhcGustKt('') === null, 'an empty read is null, never zero');
ok(nhcGustKt(null) === null, 'and so is a missing one');
ok(
  nhcGustKt('WITH GUSTS TO 0 KT.') === null && nhcGustKt('WITH GUSTS TO 999 KT.') === null,
  'AN IMPOSSIBLE FIGURE IS REFUSED RATHER THAN CLAMPED. A wrong number on a '
  + 'hurricane panel looks exactly as authoritative as a right one, so the '
  + 'row is dropped instead'
);

section('text hygiene');
ok(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot;') === 'a & b <c> "d"', 'named entities decode');
ok(decodeEntities('&amp;lt;') === '&lt;', '&amp; decodes LAST so &amp;lt; cannot become a tag');
ok(decodeEntities('&#65;&#x42;') === 'AB', 'numeric entities decode, decimal and hex');
ok(tidyProductText('a   \nb\t\n') === 'a\nb', 'trailing whitespace goes, content does not');
ok(tidyProductText('\n\n\nmiddle\n\n\n') === 'middle', 'leading and trailing blank lines go');
ok(tidyProductText('a\r\nb') === 'a\nb', 'CRLF normalises');

/* --- JTWC ------------------------------------------------------------------- */
section('JTWC subject line');

const NAMED = 'SUBJ/TYPHOON 11W (NOUL) WARNING NR 008//';
const UNNAMED = 'SUBJ/TROPICAL DEPRESSION 12W WARNING NR 001//';
const LONGKIND = 'SUBJ/SUPER TYPHOON 09W (BAVI) WARNING NR 014//';

const n = parseJtwcWarning(NAMED);
ok(n.designation === '11W', 'designation');
ok(n.name === 'NOUL', 'name');
ok(n.warningNumber === '008', 'warning number keeps its padding');
ok(n.kind === 'TYPHOON', 'storm type');

const u = parseJtwcWarning(UNNAMED);
ok(u !== null, 'an UNNAMED depression still parses — it gets a number before a name');
ok(u.designation === '12W' && u.name === null, 'unnamed reads as a null name, not an empty one');

ok(parseJtwcWarning(LONGKIND).kind === 'SUPER TYPHOON', 'a two-word storm type survives');
ok(parseJtwcWarning(LONGKIND).name === 'BAVI', 'and does not eat the name');
ok(parseJtwcWarning('nothing like a warning') === null, 'a non-warning returns null');
ok(parseJtwcWarning('') === null, 'empty returns null');

/* --- THE DRIFT GUARD -------------------------------------------------------
 * lib/advisory.js runs in the browser; functions/api/jtwc/storms.js runs in
 * workerd and cannot import it. The copy is forced. This is the only thing
 * that will ever notice the two diverging.
 * ------------------------------------------------------------------------ */
section('worker copy has not drifted from lib/');

const CORPUS = [
  NAMED, UNNAMED, LONGKIND,
  'SUBJ/TROPICAL STORM 07E (GENEVIEVE) WARNING NR 003//',
  'SUBJ/HURRICANE 06E (FAUSTO) WARNING NR 025//',
  'SUBJ/TYPHOON 11W (NOUL) WARNING NR 8//',
  'nothing like a warning',
  '',
  'SUBJ/TROPICAL CYCLONE 03S (CHALANE) WARNING NR 021//',
];
for (const s of CORPUS) {
  const a = JSON.stringify(parseJtwcWarning(s));
  const b = JSON.stringify(parseSubject(s));
  ok(a === b, `lib and worker agree on: ${s.slice(0, 46) || '(empty)'}`);
}

/* --- the name join ---------------------------------------------------------- */
section('GDACS name to JTWC name');

ok(stormNameKey('NOUL-26') === 'NOUL', 'GDACS strips its year suffix');
ok(stormNameKey('Noul') === 'NOUL', 'case folds');
ok(stormNameKey('  noul  ') === 'NOUL', 'whitespace goes');
ok(stormNameKey('TC FAUSTO-26') === 'TCFAUSTO', 'non-letters go — blunt on purpose');
ok(stormNameKey('') === '', 'empty stays empty');
ok(stormNameKey(null) === '', 'null does not throw');
/* The suffix rule is anchored to a TRAILING hyphen-plus-digits so a real
 * hyphenated name is not amputated. */
ok(stormNameKey('SAINT-MARIE') === 'SAINTMARIE', 'a hyphenated NAME is not treated as a suffix');

const INDEX = [
  { designation: '11W', name: 'NOUL', warningNumber: '008', product: 'wp1126' },
  { designation: '06E', name: 'FAUSTO', warningNumber: '025', product: 'ep0626' },
  { designation: '12W', name: null, warningNumber: '001', product: 'wp1226' },
];

ok(matchJtwcStorm(INDEX, 'NOUL-26')?.product === 'wp1126', 'a GDACS name finds its warning');
ok(matchJtwcStorm(INDEX, 'Fausto')?.designation === '06E', 'case-insensitive match');
ok(matchJtwcStorm(INDEX, 'MAYSAK-26') === null,
  'an unmatched name returns NULL — a wrong advisory is worse than none');
ok(matchJtwcStorm(INDEX, '') === null, 'an empty name matches nothing');
ok(matchJtwcStorm(INDEX, null) === null, 'a null name matches nothing');
ok(matchJtwcStorm(null, 'NOUL') === null, 'a missing index matches nothing');
/* The unnamed entry has `name: null`, which keys to ''. An empty query must
 * not collide with it — that would hand a random depression's warning to a
 * storm whose name we failed to read. */
ok(matchJtwcStorm(INDEX, '   ') === null, 'a blank name does not collide with the unnamed entry');

section('the descriptive-prefix fallback');
/* GDACS's `name` field carries a prefix its `eventname` does not. The clean
 * field is preferred, so this is a fallback for a case not yet seen — but the
 * failure it prevents is a FALSE CLAIM on screen, not a missing feature. */
ok(matchJtwcStorm(INDEX, 'Tropical Cyclone FAUSTO-26')?.product === 'ep0626',
  'a descriptive prefix does not hide a storm JTWC is warning on');
ok(matchJtwcStorm(INDEX, 'Hurricane Noul')?.designation === '11W',
  'prefix fallback works for any wording, not one hardcoded phrase');
ok(matchJtwcStorm([{ name: 'AUL', product: 'x' }], 'NOUL-26') === null,
  'a short suffix cannot match — three letters is not evidence');
ok(
  matchJtwcStorm(
    [{ name: 'FAUSTO', product: 'a' }, { name: 'GRANFAUSTO', product: 'b' }],
    'Tropical Cyclone GRANFAUSTO-26'
  ) === null,
  'an AMBIGUOUS suffix match returns null — two candidates is as bad as a wrong one'
);

/* --- report --------------------------------------------------------------- */
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (fixtures shaped from a real probe — they still cannot tell you it reads right on a phone)');
