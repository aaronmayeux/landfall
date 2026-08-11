#!/usr/bin/env node
/**
 * test-outlook.mjs — the text outlook, parsed from real bulletins.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-outlook.mjs`.
 *
 * ==> EVERY BULLETIN HERE IS BYTES NHC ACTUALLY PUBLISHED. <== Nothing is
 * fabricated and nothing is hand-tidied; `samples/outlook-text/README.md` says
 * where each one came from. That matters more here than anywhere else in this
 * repo, because this parser's entire job is to be believed when it contradicts
 * another NOAA source. A parser proven against bytes somebody imagined has no
 * standing to call the GIS layer a liar.
 *
 * The bulletin under test in `atlantic-current.txt` is THE ONE FROM THE
 * INCIDENT: ABNT20 KNHC 111142, live at the moment NHC's GIS layer 3 was
 * answering `{"features":[]}` and Landfall was telling people nothing was
 * being watched.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseOutlook, reconcile, reconcileBasins, issuedAt } from '../lib/outlook.js';
import { OUTLOOK } from '../config/constants.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const sample = (n) => fs.readFileSync(path.join(ROOT, 'samples/outlook-text', n), 'utf8');

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

/** The moment the two August bulletins were current. */
const AUG = Date.parse('2026-08-11T12:00:00Z');
/** The moment the June bulletin was current. */
const JUN = Date.parse('2026-06-24T12:00:00Z');

/* ---------------------------------------------------------------------------
 * 1. THE BULLETIN FROM THE INCIDENT
 * ------------------------------------------------------------------------- */

section('ABNT20 111142 — the bulletin that was right while the map layer was wrong');

const atlantic = parseOutlook(sample('atlantic-current.txt'), { now: AUG });

{
  ok(atlantic.state === 'ok', 'it parses');
  ok(atlantic.wmo === 'ABNT20', 'the WMO header is read');
  ok(atlantic.basin === 'atlantic', 'and resolved to a basin');
  ok(atlantic.areas.length === 3, `three areas — got ${atlantic.areas.length}`);
  ok(atlantic.formationNotExpected === false, 'and it does not claim an all-clear');

  /* THE HEADLINE NUMBER. This is the 70% seven-day area that was live on the
   * Atlantic while the app said nothing was being watched. If this assertion
   * ever goes red, the feature has stopped being able to see the thing it was
   * built for. */
  const hot = atlantic.areas.find((a) => a.prob7 === 70);
  ok(!!hot, 'the 70% seven-day area is found');
  ok(hot && hot.title === 'Central Tropical Atlantic', `and titled — got "${hot && hot.title}"`);
  ok(hot && hot.risk7 === 'high', 'and carries its risk word');
  ok(hot && hot.prob48 === 30, 'and its 48-hour chance is separate from its 7-day one');

  /* ==> `near 0 percent` IS A REAL SPELLING AND IT IS NOT RARE. <== A regex
   * demanding a digit after the risk word drops this area silently, and an
   * area dropped is an area we fail to notice the layer had lost — the
   * undercount runs in the unsafe direction. */
  const zero = atlantic.areas.find((a) => a.title === 'East of the Windward Islands');
  ok(!!zero, 'the near-zero area survives');
  ok(zero && zero.prob48 === 0 && zero.prob7 === 0, '"near 0 percent" reads as 0, not as missing');
  ok(zero && zero.risk48 === 'low', 'and still carries its risk word');
}

section('ABPZ20 111139 — the East Pacific, and an invest designator');

{
  const ep = parseOutlook(sample('epacific-current.txt'), { now: AUG });
  ok(ep.state === 'ok', 'it parses');
  ok(ep.basin === 'epacific', 'a different WMO header resolves to a different basin');
  ok(ep.areas.length === 2, `two areas — got ${ep.areas.length}`);

  const cp = ep.areas[0];
  ok(cp.designator === 'CP93', 'the invest designator is captured');
  ok(cp.title === 'Central Pacific (CP93)', 'and the title is left as NHC wrote it');
  ok(cp.prob7 === 90 && cp.risk7 === 'high', 'the 90% area reads correctly');
}

section('A genuine quiet-season all-clear');

{
  const clear = parseOutlook(sample('atlantic-all-clear.txt'), { now: JUN });
  ok(clear.state === 'ok', 'it parses');
  ok(clear.formationNotExpected === true, 'and says formation is not expected');
  ok(clear.areas.length === 0, 'with no areas');
  /* THE ALL-CLEAR HAS TO BE REACHABLE. Most of the year this is the correct
   * answer, and a feature built to prevent a false all-clear that makes a TRUE
   * one unreachable has only moved the lie. */
  ok(reconcile(0, clear).verdict === 'both-clear', 'and both sources agreeing on nothing is its own verdict');
}

/* ---------------------------------------------------------------------------
 * 2. THE FROZEN MIRROR
 * ------------------------------------------------------------------------- */

section('A bulletin that stopped being reissued is not evidence');

{
  /* ==> MEASURED, NOT INVENTED. <== A real NOAA path was serving this June
   * bulletin on 11 August: two months old, plain text, HTTP 200, healthy by
   * every signal except the line inside the body. A source trusted to
   * CONTRADICT another source must be checked harder than one merely read. */
  const frozen = parseOutlook(sample('atlantic-all-clear.txt'), { now: AUG });
  ok(frozen.state === 'stale', `an old bulletin is stale, not ok — got "${frozen.state}"`);
  ok(frozen.ageMs > OUTLOOK.maxAgeMs, 'and its age is reported');

  const r = reconcile(0, frozen);
  ok(r.verdict === 'no-arbiter', 'a stale bulletin refuses to arbitrate');
  ok(r.textCount === null, 'and offers no count for anything to lean on');

  /* THE DIRECTION OF THAT REFUSAL IS THE POINT. Believing it would have said
   * "both clear" — an immediate all-clear, sourced from a two-month-old
   * document, with more confidence than before this feature existed. */
  ok(r.verdict !== 'both-clear', 'it must NOT hand out a fast all-clear on stale bytes');
}

section('A bulletin just inside the window is still evidence');

{
  const justFresh = parseOutlook(
    sample('atlantic-current.txt'),
    { now: Date.parse('2026-08-11T11:42:00Z') + OUTLOOK.maxAgeMs - 60_000 }
  );
  ok(justFresh.state === 'ok', 'eleven hours and change still counts — the cutoff is not jumpy');
}

/* ---------------------------------------------------------------------------
 * 3. THE MONTH BOUNDARY
 * ------------------------------------------------------------------------- */

section('DDHHMM has no month, and guessing wrong dates a bulletin into the future');

{
  /* Read on the 1st, a bulletin stamped day 31 belongs to LAST month. Assuming
   * the current month puts it thirty days ahead, which sails through every
   * staleness check there is — the unsafe direction. */
  const now = Date.parse('2026-09-01T06:00:00Z');
  const ms = issuedAt(31, 23, 42, now);
  ok(ms < now, 'a day-31 stamp read on the 1st resolves to the past');
  ok(now - ms < 8 * 60 * 60 * 1000, 'and to the recent past, not a month ago');

  /* And the ordinary case still works. */
  const same = issuedAt(11, 11, 42, AUG);
  ok(same === Date.parse('2026-08-11T11:42:00Z'), 'a same-month stamp is exact');

  /* A few hours ahead is clock skew, not a month wrap. */
  const skew = issuedAt(11, 13, 0, Date.parse('2026-08-11T12:00:00Z'));
  ok(skew > Date.parse('2026-08-11T12:00:00Z'), 'an hour of skew is tolerated, not rewound a month');
}

/* ---------------------------------------------------------------------------
 * 4. THINGS THAT ARE NOT BULLETINS
 *
 * Every one of these must be `unreadable` and NEVER an all-clear. That
 * collapse — "we could not read it" quietly becoming "there is nothing out
 * there" — is the original bug this whole feature answers, and re-committing
 * it inside the fix would be the worst possible place for it.
 * ------------------------------------------------------------------------- */

section('Garbage is unreadable, never an all-clear');

for (const [label, input] of [
  ['an empty string', ''],
  ['whitespace', '   \n\n  '],
  ['null', null],
  ['a number', 12345],
  ['an HTML error page', '<html><body><h1>404 Not Found</h1></body></html>'],
  ['a truncated bulletin with no header', 'Tropical Weather Outlook\nNWS National Hurricane Center'],
]) {
  const r = parseOutlook(input, { now: AUG });
  ok(r.state === 'unreadable', `${label} is unreadable`);
  ok(r.reason !== null, `${label} says why`);
  ok(reconcile(0, r).verdict === 'no-arbiter', `${label} does not arbitrate`);
}

{
  /* An HTML page that happens to contain the words is still not a bulletin —
   * no WMO header, so nothing here will speak for it. */
  const r = parseOutlook(
    '<html>Tropical cyclone formation is not expected during the next 7 days.</html>',
    { now: AUG }
  );
  ok(r.state === 'unreadable', 'the all-clear SENTENCE alone is not an all-clear');
  ok(r.formationNotExpected === false, 'and the flag is not set from a headerless page');
}

section('A bulletin that contradicts itself is refused, not resolved');

{
  const contradictory = sample('atlantic-current.txt').replace(
    'For the North Atlantic...Caribbean Sea and the Gulf of America:',
    'For the North Atlantic...Caribbean Sea and the Gulf of America:\n\nTropical cyclone formation is not expected during the next 7 days.'
  );
  const r = parseOutlook(contradictory, { now: AUG });
  ok(r.state === 'unreadable', 'areas AND an all-clear in one bulletin is not readable');
  /* Either half could be the true one. Picking wrong means inventing areas or
   * announcing an all-clear over real ones, so neither is picked. */
  ok(reconcile(0, r).verdict === 'no-arbiter', 'and it arbitrates nothing');
}

section('An area with no title nearby is named, not given its neighbour\u2019s');

{
  /* ==> THE ONLY SYNTHETIC INPUT IN THIS FILE, AND IT IS LABELLED. <== No real
   * bulletin separates an area from its title by thirty lines, so the lookback
   * bound cannot be exercised by archived bytes — mutation-checked and
   * confirmed: removing the bound changes nothing against all three real
   * fixtures. This is a degenerate input testing OUR bound, not a claim about
   * how NHC formats anything.
   *
   * It matters because the failure is silent and wrong rather than silent and
   * absent: without the bound, an untitled area inherits the title of whatever
   * area came before it, and the screen then shows two areas with one name and
   * different percentages. */
  const filler = Array(OUTLOOK.titleLookbackLines + 10).fill('Prose with no colon on it').join('\n');
  const synthetic = [
    'ABNT20 KNHC 111142',
    'TWOAT',
    '',
    'Real Title:',
    filler,
    '* Formation chance through 48 hours...low...20 percent.',
    '* Formation chance through 7 days...low...20 percent.',
  ].join('\n');

  const r = parseOutlook(synthetic, { now: AUG });
  ok(r.areas.length === 1, 'the area is still found — the count never depends on the title');
  ok(r.areas[0].title === 'Unnamed area',
    `an out-of-range title is not borrowed — got "${r.areas[0].title}"`);
}

/* ---------------------------------------------------------------------------
 * 5. THE RECONCILIATION — the reason any of this is here
 * ------------------------------------------------------------------------- */

section('The 04:26Z verdict: the layer is empty and the forecaster is not');

{
  const r = reconcile(0, atlantic);
  ok(r.verdict === 'layer-broken', `the layer is called broken — got "${r.verdict}"`);
  ok(r.textCount === 3, 'and the number it should have had is reported');
  /* ==> THIS IS WHAT THE FEATURE BUYS. <== Before it, "the layer is empty and
   * it is in season" was an inference from history, worth six hours of holding
   * and no more. Now it is a reading, and the hold can outlast the window
   * because we are not guessing. */
}

section('The other verdicts');

{
  ok(reconcile(3, atlantic).verdict === 'agree', 'matching counts agree');
  ok(reconcile(1, atlantic).verdict === 'layer-short', 'a short layer is named short');
  ok(reconcile(1, atlantic).textCount === 3, 'and says how short');
  /* The GIS layer publishes before the prose is written, so this happens
   * legitimately for a few minutes every cycle. Named, never treated as a
   * fault — an alarm that fires every six hours is an alarm nobody reads. */
  ok(reconcile(5, atlantic).verdict === 'layer-ahead', 'a layer ahead of the prose is not a fault');
  ok(reconcile(null, atlantic).verdict === 'no-arbiter', 'no layer answer, nothing to reconcile');
}

section('An all-clear in the prose does not license blanking a populated layer');

{
  const clear = parseOutlook(sample('atlantic-all-clear.txt'), { now: JUN });
  const r = reconcile(4, clear);
  ok(r.verdict === 'layer-ahead', 'four polygons against a clear bulletin is layer-ahead');
  /* NOT `layer-broken`, and not a reason to erase anything. The polygons are
   * the thing that can be drawn; the prose cannot replace them, only comment
   * on them. */
  ok(r.verdict !== 'layer-broken', 'the prose never condemns a layer that HAS areas');
}

/* ---------------------------------------------------------------------------
 * 5. THE GAPS A MUTATION RUN FOUND — EVERY ONE OF THESE WENT GREEN AGAINST THE
 *    BUG BEFORE IT WAS WRITTEN
 *
 * ==> FIVE OF THIS SUITE'S ORIGINAL 65 ASSERTIONS COULD NOT FAIL. <== Found by
 * breaking `lib/outlook.js` one guard at a time and re-running: the parser was
 * proven against two real bulletins, and two real bulletins exercise the happy
 * path of every branch and the sad path of none. A regex only matters on the
 * input that breaks it, and NHC's own bytes are — by construction — the input
 * that does not.
 *
 * The two below with `MALFORMED` on them are the ones that matter. This file
 * argues at length that a half-formed area still counts, "because dropping it
 * would undercount exactly when the product is malformed, which is when the
 * count matters most." That behaviour had no test at all, and a malformed
 * bulletin is precisely when this arbiter gets consulted.
 * ------------------------------------------------------------------------- */

section('MALFORMED: an area is counted even when its prose is not');

/** A bulletin's skeleton with arbitrary body lines, stamped current. */
const bulletin = (...body) =>
  ['ABNT20 KNHC 111142', 'TWOAT ', '', 'Tropical Weather Outlook',
   'NWS National Hurricane Center Miami FL', '800 AM EDT Tue Aug 11 2026', '',
   'For the North Atlantic...Caribbean Sea and the Gulf of America:', '',
   ...body].join('\n');

{
  /* A 48-hour line with no 7-day line under it — the product cut off, or a
   * horizon renamed. The area is still an area NHC is watching. */
  const r = parseOutlook(bulletin(
    'Central Tropical Atlantic:',
    'Some prose.',
    '* Formation chance through 48 hours...low...30 percent.',
    '',
    'East of the Windward Islands:',
    'More prose.',
    '* Formation chance through 48 hours...low...near 0 percent.',
    '* Formation chance through 7 days...high...70 percent.'
  ), { now: AUG });
  ok(r.state === 'ok', 'a bulletin missing a horizon is still readable');
  ok(
    r.areas.length === 2,
    'AN AREA WITH ONLY A 48-HOUR LINE IS STILL COUNTED. Dropping it would '
    + 'undercount exactly when the product is malformed, which is when the '
    + `count matters most — got ${r.areas.length}`
  );
  ok(r.areas[0].prob48 === 30 && r.areas[0].prob7 === null,
    'and it carries the horizon it has and null for the one it does not');
}

{
  /* The LAST area in the bulletin having only a 48-hour line. A different code
   * path from the one above: this one leaves an area pending when the walk
   * runs out of lines, rather than closing it by opening the next. */
  const r = parseOutlook(bulletin(
    'Central Tropical Atlantic:',
    '* Formation chance through 48 hours...low...30 percent.',
    '* Formation chance through 7 days...high...70 percent.',
    '',
    'Central Subtropical Atlantic:',
    '* Formation chance through 48 hours...low...10 percent.'
  ), { now: AUG });
  ok(
    r.areas.length === 2,
    'AND SO IS THE LAST ONE, when the walk simply runs out. A separate branch '
    + `from the one above and it had no test either — got ${r.areas.length}`
  );
  ok(r.areas[1].title === 'Central Subtropical Atlantic', 'still correctly titled');
}

{
  /* A 7-day line with no 48-hour line ABOVE it at all. */
  const r = parseOutlook(bulletin(
    'Central Tropical Atlantic:',
    '* Formation chance through 7 days...high...70 percent.'
  ), { now: AUG });
  ok(r.areas.length === 1, 'a 7-day line standing alone still names an area');
  ok(r.areas[0].prob7 === 70 && r.areas[0].prob48 === null, 'with only what it said');
}

section('MALFORMED: a heading that is not an area never becomes one');

{
  /* `NOT_A_TITLE` exists so a bulletin's opening line and its Active Systems
   * list cannot be mistaken for watched areas. On NHC's real bytes the walk
   * finds a genuine title first and never reaches them, so emptying that list
   * changed nothing and no assertion noticed. Here the genuine title is gone. */
  const r = parseOutlook(bulletin(
    '* Formation chance through 48 hours...low...30 percent.',
    '* Formation chance through 7 days...high...70 percent.'
  ), { now: AUG });
  ok(r.areas.length === 1, 'the area is still found from its numbers');
  ok(
    r.areas[0].title === 'Unnamed area',
    'AND IT IS NOT LABELLED "For the North Atlantic". That line opens every '
    + 'bulletin and ends in a colon; without the filter it becomes the nearest '
    + `title above every area in a malformed product — got ${JSON.stringify(r.areas[0].title)}`
  );
}

{
  const r = parseOutlook([
    'ABNT20 KNHC 111142', 'TWOAT ', '', 'Tropical Weather Outlook',
    'NWS National Hurricane Center Miami FL', '800 AM EDT Tue Aug 11 2026', '',
    'Active Systems:',
    '* Formation chance through 48 hours...low...30 percent.',
  ].join('\n'), { now: AUG });
  ok(
    r.areas[0].title === 'Unnamed area',
    'and neither does "Active Systems", which lists NHC\u2019s NAMED STORMS. '
    + 'Labelling an area with it would render an active hurricane as a thing '
    + 'that might one day form'
  );
}

section('MALFORMED: a horizon in hours that is not 48');

{
  /* `is48` tests the unit AND the number. NHC publishes 48 hours and 7 days
   * and nothing else, so the number half never mattered on real bytes. It
   * matters the day a third horizon appears: a 72-hour line arriving as a NEW
   * AREA rather than as a second horizon doubles the count, and this arbiter's
   * whole contribution is a count. */
  const r = parseOutlook(bulletin(
    'Central Tropical Atlantic:',
    '* Formation chance through 48 hours...low...30 percent.',
    '* Formation chance through 72 hours...medium...50 percent.'
  ), { now: AUG });
  ok(
    r.areas.length === 1,
    'a horizon in HOURS that is not 48 closes the area it belongs to, it does '
    + `not open a new one — got ${r.areas.length}`
  );
}

/* ---------------------------------------------------------------------------
 * 6. ONE LAYER, TWO BULLETINS
 *
 * NHC returns the Atlantic and the East Pacific in a single FeatureCollection
 * and publishes the prose as two separate products, so there is one count on
 * one side and two on the other. `reconcileBasins` is that asymmetry.
 * ------------------------------------------------------------------------- */

section('reconcileBasins — counts are summed, areas are never matched');

const AT = parseOutlook(sample('atlantic-current.txt'), { now: AUG });
const EP = parseOutlook(sample('epacific-current.txt'), { now: AUG });
const CLEAR = parseOutlook(sample('atlantic-all-clear.txt'), { now: JUN });
/** The same all-clear wording under the Pacific header, so both basins can be
 *  quiet at once. No all-clear East Pacific bulletin has been captured yet,
 *  and re-heading a real one beats inventing forecaster prose. */
const EP_CLEAR = parseOutlook(
  sample('atlantic-all-clear.txt').replace('ABNT20', 'ABPZ20'), { now: JUN }
);
const UNREADABLE = parseOutlook('not a bulletin', { now: AUG });

{
  const r = reconcileBasins(0, [AT, EP]);
  ok(r.verdict === 'layer-broken', 'an empty layer under five prose areas is layer-broken');
  ok(r.textCount === 5, `summed across both basins — got ${r.textCount}`);
  ok(r.readable === 2 && r.expected === 2, 'and it says how much of the sky it read');
}

{
  ok(reconcileBasins(5, [AT, EP]).verdict === 'agree', 'five against five agrees');
  ok(reconcileBasins(2, [AT, EP]).verdict === 'layer-short', 'a short layer is named short');
  ok(reconcileBasins(9, [AT, EP]).verdict === 'layer-ahead',
    'a layer ahead of the prose is expected briefly and is never a fault');
  ok(reconcileBasins(0, [CLEAR, EP_CLEAR]).verdict === 'both-clear',
    'both basins quiet and a layer agreeing is a PROVEN all-clear');
  ok(reconcileBasins(null, [AT, EP]).verdict === 'no-arbiter',
    'no layer answer, nothing to reconcile');
  ok(reconcileBasins(0, []).verdict === 'no-arbiter', 'and no bulletins is no arbiter');
}

section('reconcileBasins — a half-read sky can accuse, but it cannot acquit');

{
  const r = reconcileBasins(0, [AT, UNREADABLE]);
  ok(
    r.verdict === 'layer-broken',
    'ONE readable bulletin listing areas over an empty layer is certain '
    + 'whatever the other says — you cannot un-see an area'
  );
  ok(r.readable === 1 && r.expected === 2, 'and it reports that it only read half');
}

{
  const r = reconcileBasins(0, [CLEAR, UNREADABLE]);
  ok(
    r.verdict === 'no-arbiter',
    'BUT ONE BASIN READING CLEAR WHILE THE OTHER IS UNREADABLE IS NOT AN '
    + 'ALL-CLEAR. An empty sky declared over an ocean nobody looked at is §5\u2019s '
    + `worst failure, committed by the feature written to prevent it. Got ${r.verdict}`
  );
}

{
  ok(
    reconcileBasins(2, [AT, UNREADABLE]).verdict === 'no-arbiter',
    'and every comparison finer than "the layer is empty" needs the whole sum '
    + 'too — a missing basin makes a healthy layer look like it is publishing '
    + 'areas nobody wrote about'
  );
}

section('reconcileBasins — a stale half is not a readable half');

{
  const stale = parseOutlook(
    sample('atlantic-current.txt').replace('KNHC 111142', 'KNHC 091142'), { now: AUG }
  );
  ok(stale.state === 'stale', 'two days on, the bulletin is stale');
  ok(
    reconcileBasins(0, [stale, EP_CLEAR]).verdict === 'no-arbiter',
    'A FROZEN MIRROR CANNOT ACCUSE A LIVE LAYER. Measured on a real NOAA path '
    + 'serving a two-month-old bulletin at HTTP 200 — healthy by every signal '
    + 'except the line inside the body'
  );
}

/* ------------------------------------------------------------------------- */

if (failures.length) {
  console.log(`\n✗ ${failures.length} failed\n`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed\n`);
