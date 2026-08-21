#!/usr/bin/env node
/**
 * test-jtwc-formation-alert.mjs — an invest is not a broken index.
 *
 * ZERO DEPENDENCIES, like every other tool here.
 *
 * ===========================================================================
 * THE BUG THIS GUARDS
 * ===========================================================================
 *
 * JTWC's RSS lists TROPICAL CYCLONE FORMATION ALERTS next to numbered
 * warnings, so /api/jtwc/storms fetched them like anything else. A formation
 * alert has no designation and no warning number — JTWC is saying a system
 * MIGHT form, not that one has — so `parseSubject` returned null and the
 * product was dropped. Correct so far.
 *
 * The arithmetic afterwards was not. A dropped product made
 * `storms.length < keys.length`, which is the test for a DEGRADED index, so
 * the route answered `partial`.
 *
 * ==> AND `partial` IS LOAD-BEARING. <== `lib/jtwc-wind.js` withholds the
 * `jtwcRoster` field on anything but `ok`, deliberately, because a storm
 * missing from a SHORT list may be missing because its own product failed. So
 * one invest anywhere on Earth suppressed the "JTWC has stopped warning on this
 * storm" signal for every storm at once — and in August JTWC is watching a
 * disturbance somewhere most of the time.
 *
 * ===========================================================================
 * THE FIXTURE IS REAL BYTES
 * ===========================================================================
 *
 * INVEST 91E, product `ep9126web.txt`, archived 2026-08-21T19:00:00Z. Read out
 * of the archive branch with `git show`, kept verbatim including CRLF line
 * endings and trailing spaces, because a parser that only works on tidied text
 * is a parser that works on nothing.
 *
 * Observed live that same hour: `productsListed: 5`, four storms, state
 * `partial` — with nothing whatsoever wrong upstream.
 *
 * ===========================================================================
 * MUTATION-VERIFIED
 * ===========================================================================
 *
 * Confirmed to FAIL when `isFormationAlert` is made to return false — which is
 * the pre-fix behaviour exactly. A test that passes either way guards nothing.
 */

import { isFormationAlert, parseSubject, isFinalWarning } from '../functions/api/jtwc/storms.js';

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

/* --- fixtures --------------------------------------------------------------
 * Real bytes. CRLF preserved.
 * ------------------------------------------------------------------------ */

const INVEST_91E = [
  'WTPN21 PHNC 210700',
  'MSGID/GENADMIN/JOINT TYPHOON WRNCEN PEARL HARBOR HI//',
  'SUBJ/TROPICAL CYCLONE FORMATION ALERT (INVEST 91E)//',
  'RMKS/',
  '1. FORMATION OF A SIGNIFICANT TROPICAL CYCLONE IS POSSIBLE WITHIN',
  '160 NM EITHER SIDE OF A LINE FROM 8.4N 113.6W TO 8.6N 118.7W',
  'WITHIN THE NEXT 12 TO 24 HOURS. AVAILABLE DATA DOES NOT JUSTIFY',
  'ISSUANCE OF NUMBERED TROPICAL CYCLONE WARNINGS AT THIS TIME.',
  'WINDS IN THE AREA ARE ESTIMATED TO BE 18 TO 23 KNOTS. METSAT',
  'IMAGERY AT 210000Z INDICATES THAT A CIRCULATION CENTER IS LOCATED',
  'NEAR 8.4N 114.0W. THE SYSTEM IS MOVING WESTWARD AT 10 KNOTS.',
  '3. THIS ALERT WILL BE REISSUED, UPGRADED TO WARNING OR CANCELLED BY ',
  '220700Z.//',
  'NNNN',
].join('\r\n');

/* 17W (SAUDEL) warning 013, same archived hour. The control: a real warning
 * must not be mistaken for an alert. */
const SAUDEL = [
  'WTPN31 PGTW 211500',
  'MSGID/GENADMIN/JOINT TYPHOON WRNCEN PEARL HARBOR HI//',
  'SUBJ/TYPHOON 17W (SAUDEL) WARNING NR 013//',
  'RMKS/',
  '1. TYPHOON 17W (SAUDEL) WARNING NR 013    ',
  '   UPGRADED FROM TROPICAL STORM 17W',
  '   WARNING POSITION:',
  '   211200Z --- NEAR 16.0N 148.1E',
  '   MAX SUSTAINED WINDS - 070 KT, GUSTS 085 KT',
].join('\r\n');

/* --- the detector ---------------------------------------------------------- */

section('a formation alert is recognised as one');
ok(isFormationAlert(INVEST_91E) === true,
  'INVEST 91E reads as a formation alert');
ok(parseSubject(INVEST_91E) === null,
  'and still has no parseable storm identity — it never enters the index');
ok(isFinalWarning(INVEST_91E) === false,
  'and is not mistaken for a final warning');

section('a real warning is not');
ok(isFormationAlert(SAUDEL) === false,
  'SAUDEL warning 013 is not a formation alert');
ok(parseSubject(SAUDEL)?.designation === '17W',
  'and still parses as 17W');

section('nothing else trips it');
ok(isFormationAlert('') === false, 'empty text is not an alert');
ok(isFormationAlert(null) === false, 'null is not an alert');
ok(isFormationAlert(
  'SUBJ/TYPHOON 17W (SAUDEL) WARNING NR 013//\r\nTHE TROPICAL CYCLONE FORMATION ALERT IS CANCELLED.'
) === false,
  'the phrase in the BODY of a warning does not make it an alert — the match is anchored to SUBJ/');

/* --- the arithmetic that broke -------------------------------------------
 * The route's own state calculation, reproduced against a real product mix,
 * because that is the line that was wrong and the line a regression would hit.
 * Kept in step with functions/api/jtwc/storms.js by hand — if it drifts, the
 * numbers below stop describing anything.
 * ------------------------------------------------------------------------ */

const stateFor = (products) => {
  const alerts = products.filter(isFormationAlert).length;
  const storms = products.filter((t) => !isFormationAlert(t) && parseSubject(t)).length;
  const warnable = products.length - alerts;
  return warnable === 0 ? 'clear' : storms < warnable ? 'partial' : 'ok';
};

section('the mix that was live on 2026-08-21');
ok(stateFor([SAUDEL, SAUDEL, SAUDEL, SAUDEL, INVEST_91E]) === 'ok',
  'four warnings and one invest is a HEALTHY index — this is the assertion that fails without the fix');

section('a genuine shortfall still reports partial');
ok(stateFor([SAUDEL, 'GARBAGE THAT WILL NOT PARSE']) === 'partial',
  'a product that reads but will not parse still degrades the index');
ok(stateFor([SAUDEL, INVEST_91E, 'GARBAGE THAT WILL NOT PARSE']) === 'partial',
  'an invest does not mask a real failure sitting beside it');

section('an ocean of nothing but invests is clear, not partial');
ok(stateFor([INVEST_91E, INVEST_91E]) === 'clear',
  'JTWC warning on no storm, every product read — that is clear');
ok(stateFor([]) === 'clear',
  'and an empty product list is still clear');

/* --- report --------------------------------------------------------------- */
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (real archived bytes — they still cannot tell you a storm reads right on a phone)');
