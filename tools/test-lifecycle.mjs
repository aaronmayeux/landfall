#!/usr/bin/env node
/**
 * test-lifecycle.mjs — the graceful end of a storm (SPEC §5).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-lifecycle.mjs`, same as every other
 * suite here (§12 — this project has no toolchain by design).
 *
 * ===========================================================================
 * THE BULLETIN FIXTURES ARE REAL TEXT, AND THAT IS THE POINT OF THIS FILE
 * ===========================================================================
 *
 * The two strings this whole feature hangs on were read off live products on
 * 2026-07-28 and are pasted below WITH THEIR ORIGINAL LINE BREAKS:
 *
 *   - Post-Tropical Cyclone Imelda, AL092025, Public Advisory 24 (NHC)
 *   - Typhoon 26W (Mangkhut), Warning NR 039 (JTWC)
 *
 * The wrapping is not incidental. NHC and JTWC hard-wrap at ~70 columns, so
 * "This is the last public advisory issued by the National Hurricane Center on
 * this system." arrives with a newline inside it, and WHERE that newline falls
 * moves with the length of the storm's name. A matcher written against a
 * single-space fixture passes here and then silently fails on the next storm —
 * which looks exactly like no storm ever ending, the quietest possible bug. So
 * the fixtures keep the breaks and there is an explicit assertion that a
 * re-wrapped copy still matches.
 *
 * ===========================================================================
 * WHAT THIS SUITE IS REALLY FOR: THE GLITCH CASES
 * ===========================================================================
 *
 * Aaron's one hard requirement was that a bad connection or a weird upstream
 * hiccup must never kill a storm. Three scenarios below are dedicated to that,
 * and they are the reason this file exists rather than a couple of regex checks:
 * a failed poll casting no vote, a reappearance resetting the count, and a
 * truncated list being refused. Every one of them is a case where the naive
 * implementation — a timer — reports a dead storm.
 *
 * WHAT THIS CANNOT PROVE: that the grey dot and the badge look right, or that
 * the track survives a real reload in a real browser. That is glass.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

/* ---------------------------------------------------------------------------
 * A localStorage stand-in.
 *
 * data/lifecycle.js persists, and persistence is HALF of what is being tested —
 * an ended storm that does not survive a reload has just moved the abrupt
 * disappearance to page load. Node has no localStorage, so it gets a minimal
 * one before the module is imported (the module reads it at init).
 * ------------------------------------------------------------------------- */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

/* data/lifecycle.js reads advisory TEXT through data/advisory.js, which fetches.
 * Stubbed at the global level so no test in this file touches the network: the
 * suite must run in a sandbox with no route to NOAA, and a test that silently
 * depends on a live feed is a test that fails for the wrong reason. */
let advisoryText = null;         // what the next NHC advisory read returns
let advisoryFails = false;       // or whether it blows up instead
globalThis.fetch = async (url) => {
  if (advisoryFails) throw new Error('network down');
  if (String(url).includes('/nhc/advisory')) {
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => `<pre>${advisoryText || ''}</pre>`,
    };
  }
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => '', json: async () => ({}) };
};

const { ENDED } = await import('../config/constants.js');
const {
  isEnded, endedExpired, endedNote, endedSectionNote, becameWhat, agencyName,
  ENDED_SHORT,
} = await import('../lib/lifecycle.js');
const { isNhcFinalAdvisory, isJtwcFinalWarning } = await import('../lib/advisory.js');
const { isFinalWarning } = await import('../functions/api/jtwc/storms.js');
const { matchJtwcFinal, joinJtwcWinds } = await import('../lib/jtwc-wind.js');
const {
  observeSource, observeDeclarations, endedStorms, resetLifecycle,
  rehydrateTrack,
} = await import('../data/lifecycle.js');
const { mergeWithEnded, sortStorms } = await import('../data/merge.js');
const { trackPointReading, windKtOf } = await import('../lib/track-point.js');
const { representativeKt } = await import('../lib/category.js');
const { HURRICANE_UNKNOWN_COLOR } = await import('../config/tokens.js');

/* ---------------------------------------------------------------------------
 * REAL BULLETIN TEXT — line breaks preserved exactly as published.
 * ------------------------------------------------------------------------- */

/** Post-Tropical Cyclone Imelda, AL092025, Advisory 24. Trimmed to the two
 *  blocks that carry the markers, verbatim, breaks intact. */
const IMELDA_FINAL = `
BULLETIN
Post-Tropical Cyclone Imelda Advisory Number  24
NWS National Hurricane Center Miami FL       AL092025
1100 AM AST Thu Oct 02 2025

...IMELDA BECOMES A STRONG EXTRATROPICAL CYCLONE OVER THE CENTRAL
ATLANTIC...
...THIS IS THE FINAL NHC ADVISORY...

NEXT ADVISORY
-------------
This is the last public advisory issued by the National Hurricane
Center on this system. Additional information on this system can be
found in High Seas Forecasts issued by the National Weather Service.

$$
Forecaster Reinhart
`;

/** The SAME storm one advisory earlier in its life — a normal advisory, which
 *  must NOT match. This is the assertion that catches a matcher loose enough to
 *  fire on the words "advisory" and "final" appearing anywhere. */
const IMELDA_ROUTINE = `
BULLETIN
Hurricane Imelda Advisory Number  23
NWS National Hurricane Center Miami FL       AL092025
500 AM AST Thu Oct 02 2025

...IMELDA MOVING RAPIDLY NORTHEASTWARD...

NEXT ADVISORY
-------------
Next complete advisory at 1100 AM AST.

$$
Forecaster Reinhart
`;

/** Typhoon 26W (Mangkhut) Warning NR 039 — the final one. */
const MANGKHUT_FINAL = `
WTPN31 PGTW 180300
SUBJ/TYPHOON 26W (MANGKHUT) WARNING NR 039//

180000Z --- NEAR 22.1N 111.4E
MAX SUSTAINED WINDS - 070 KT, GUSTS 085 KT

REMARKS: THIS IS THE FINAL WARNING ON THIS SYSTEM BY THE JOINT TYPHOON
WRNCEN PEARL HARBOR HI. THE SYSTEM WILL BE CLOSELY MONITORED FOR SIGNS
OF REGENERATION.
`;

const MANGKHUT_ROUTINE = `
WTPN31 PGTW 170300
SUBJ/TYPHOON 26W (MANGKHUT) WARNING NR 035//

170000Z --- NEAR 20.4N 116.1E
MAX SUSTAINED WINDS - 125 KT, GUSTS 155 KT

REMARKS: WARNING POSITION IS BASED ON A PARTIAL MICROWAVE EYE.
`;

/* ---------------------------------------------------------------------------
 * Storm fixtures
 * ------------------------------------------------------------------------- */

const HOUR = 3600 * 1000;
const NOW = Date.parse('2026-07-28T18:00:00Z');

const nhcStorm = (over = {}) => ({
  id: 'nhc:al092025', source: 'nhc', sourceId: 'al092025', name: 'Imelda',
  basin: 'atlantic', lat: 33.2, lon: -59.5,
  windKt: 65, peakWindKt: 65, category: 1, categoryCode: 'HU',
  nature: 'tropical',
  observedAt: '2026-07-28T15:00:00Z',
  advisoryKey: 'nhc:al092025:024',
  raw: { binNumber: 'AT1' },
  ...over,
});

const gdacsStorm = (over = {}) => ({
  id: 'gdacs:1021234', source: 'gdacs', sourceId: '1021234', name: 'MANGKHUT-26',
  basin: 'west-pacific', lat: 22.1, lon: 111.4,
  windKt: 70, peakWindKt: 90, category: 1, categoryCode: 'HU',
  nature: 'tropical',
  observedAt: '2026-07-28T12:00:00Z',
  advisoryKey: 'gdacs:1021234:14',
  ...over,
});

/* ===========================================================================
 * 1. THE MARKERS
 * ======================================================================== */
section('the bulletins say it in words');

ok(isNhcFinalAdvisory(IMELDA_FINAL), 'NHC final advisory is recognised');
ok(!isNhcFinalAdvisory(IMELDA_ROUTINE), 'a routine NHC advisory is NOT final');
ok(isJtwcFinalWarning(MANGKHUT_FINAL), 'JTWC final warning is recognised');
ok(!isJtwcFinalWarning(MANGKHUT_ROUTINE), 'a routine JTWC warning is NOT final');

/* THE WRAPPING ASSERTION. The published break falls after "Hurricane"; a storm
 * with a longer name pushes it elsewhere. Both forms must match, or the feature
 * works on Imelda and quietly stops working on the next storm. */
ok(
  isNhcFinalAdvisory(IMELDA_FINAL.replace(/\s+/g, ' ')),
  'the NHC marker survives re-wrapping to one line'
);
ok(
  isNhcFinalAdvisory(
    IMELDA_FINAL.replace(
      'This is the last public advisory issued by the National Hurricane\nCenter on this system.',
      'This is the last public advisory issued by the\nNational Hurricane Center on this system.'
    )
  ),
  'the NHC marker survives the line break moving'
);
ok(
  isJtwcFinalWarning(MANGKHUT_FINAL.replace(/\s+/g, ' ')),
  'the JTWC marker survives re-wrapping to one line'
);

/* THE HEADLINE FORM ALONE IS ENOUGH. It is short and unwrapped, which is why it
 * is worth carrying as a second door — some products state it and nothing
 * else. */
ok(
  isNhcFinalAdvisory('...THIS IS THE FINAL NHC ADVISORY...'),
  'the NHC headline marker stands alone'
);

/* NOT PINNED TO PEARL HARBOR. JTWC's byline is not a stable fact, and matching
 * it would stop detecting endings the day it changed. */
ok(
  isJtwcFinalWarning('THIS IS THE FINAL WARNING ON THIS SYSTEM BY JTWC.'),
  'the JTWC marker does not depend on the issuing-centre byline'
);

ok(!isNhcFinalAdvisory(''), 'empty text is not a final advisory');
ok(!isNhcFinalAdvisory(null), 'null text is not a final advisory');
ok(!isJtwcFinalWarning(''), 'empty text is not a final warning');

section('the relay copy and the app copy agree');

/* THE MIRRORED REGEX. A Pages Function cannot import the app bundle (§3), so
 * `isFinalWarning` in functions/api/jtwc/storms.js is a hand copy of
 * `isJtwcFinalWarning`. This is the guard that makes a copy acceptable — the
 * same shape tools/test-advisory.mjs already applies to `parseSubject`. */
for (const [label, text] of [
  ['final warning', MANGKHUT_FINAL],
  ['routine warning', MANGKHUT_ROUTINE],
  ['one-line final', MANGKHUT_FINAL.replace(/\s+/g, ' ')],
  ['empty', ''],
]) {
  ok(
    isFinalWarning(text) === isJtwcFinalWarning(text),
    `relay and app agree on: ${label}`
  );
}

/* ===========================================================================
 * 2. THE JTWC JOIN — a declaration is not a measurement
 * ======================================================================== */
section('the final flag rides the name, not the fix');

const entryFinal = {
  kind: 'TYPHOON', designation: '26W', name: 'MANGKHUT', warningNumber: '039',
  product: 'wp2626', final: true,
  fix: { at: '2026-07-28T00:00:00Z', windKt: 70, lat: 22.1, lon: 111.4 },
};

ok(
  matchJtwcFinal(gdacsStorm(), [entryFinal])?.warningNumber === '039',
  'a final warning matches its GDACS storm by name'
);
ok(
  matchJtwcFinal(gdacsStorm(), [{ ...entryFinal, final: false }]) === null,
  'a non-final warning yields no declaration'
);
/* AN OLDER RELAY RESPONSE has no `final` field at all. `undefined` must read as
 * "not final" — treating it as unknown would mean no storm ends until the KV
 * copy turns over. */
const { final: _drop, ...entryNoFlag } = entryFinal;
ok(
  matchJtwcFinal(gdacsStorm(), [entryNoFlag]) === null,
  'a relay response predating the flag ends nothing'
);

/* ==> THE THREE CASES THE WIND GUARDS WOULD HAVE REJECTED. <== Each one is a
 * real scenario in which the storm has genuinely ended and the guarded match
 * says no. This is why `matchJtwcFinal` deliberately does not reuse them. */
ok(
  matchJtwcFinal(gdacsStorm(), [{ ...entryFinal, fix: null }])?.warningNumber === '039',
  'a final warning with no usable fix still declares (the wind guard would refuse)'
);
ok(
  matchJtwcFinal(
    gdacsStorm(),
    [{ ...entryFinal, fix: { ...entryFinal.fix, at: '2026-07-20T00:00:00Z' } }]
  )?.warningNumber === '039',
  'a days-old final warning still declares — it is the LAST one and never refreshes'
);
ok(
  /* The frozen-GDACS case: JTWC kept warning and moved 900 nm away. The wind
   * join refuses this on purpose; the declaration must not. */
  matchJtwcFinal(
    gdacsStorm({ lat: 10.0, lon: 130.0 }),
    [entryFinal]
  )?.warningNumber === '039',
  'a final warning far from a frozen GDACS position still declares'
);

/* And the join surfaces it on the storm object without disturbing the wind. */
const joined = joinJtwcWinds([gdacsStorm()], { state: 'ok', storms: [entryFinal] }, NOW);
ok(joined.storms[0].jtwcFinal?.warningNumber === '039', 'joinJtwcWinds attaches jtwcFinal');
ok(
  joinJtwcWinds([nhcStorm()], { state: 'ok', storms: [entryFinal] }, NOW).storms[0].jtwcFinal
    === undefined,
  'an NHC storm is never given a JTWC declaration'
);

/* ===========================================================================
 * 3. DECLARED — the fast path
 * ======================================================================== */
section('declared: the agency said so');

resetLifecycle();
advisoryText = IMELDA_FINAL;
/* A storm has to be SEEN before it can be declared — the registry needs a
 * last-known record to write the ending onto. That is one clean poll. */
observeSource('nhc', [nhcStorm()]);
await observeDeclarations([nhcStorm()]);
let dead = endedStorms(NOW);
ok(dead.length === 1, 'a final NHC advisory ends the storm on the same poll');
ok(dead[0]?.ended?.reason === 'declared', 'the reason is declared');
ok(dead[0]?.ended?.by === 'nhc', 'the ending is attributed to NHC');
ok(isEnded(dead[0]), 'isEnded agrees');

/* THE POST-TROPICAL CASE. Imelda's final advisory was issued on an
 * extratropical system carrying 75 mph winds — the exact storm that makes
 * "dissipated" a lie. `became` is the honest version, and it comes from NHC's
 * own classification rather than from us. */
resetLifecycle();
advisoryText = IMELDA_FINAL;
observeSource('nhc', [nhcStorm({ nature: 'post-tropical' })]);
await observeDeclarations([nhcStorm({ nature: 'post-tropical' })]);
const ptc = endedStorms(NOW)[0];
ok(ptc?.ended?.became === 'became post-tropical', 'NHC classification supplies "became"');
ok(
  endedNote(ptc).detail.includes('became post-tropical'),
  'the badge passes the transition through'
);
ok(becameWhat('tropical') === null, 'a still-tropical final advisory claims no transition');
ok(becameWhat('remnant') === 'weakened to a remnant low', 'remnant low is named');

/* ==> A ROUTINE ADVISORY ENDS NOTHING. <==
 *
 * NOTE THE FRESH `advisoryKey`, and it is not test hygiene for its own sake:
 * data/advisory.js caches text per advisory key, correctly — one advisory has one
 * text forever. Reusing 024 here would hand this scenario the FINAL advisory out
 * of the cache and the assertion would pass for the wrong reason. Each scenario
 * below gets its own key for the same reason. */
resetLifecycle();
advisoryText = IMELDA_ROUTINE;
const routine = nhcStorm({ advisoryKey: 'nhc:al092025:023' });
observeSource('nhc', [routine]);
await observeDeclarations([routine]);
ok(endedStorms(NOW).length === 0, 'a routine advisory ends nothing');

/* ==> A FAILED ADVISORY READ ENDS NOTHING. <== The single most important
 * assertion on the declared path: `isNhcFinalAdvisory('')` returns false
 * honestly, and that false is indistinguishable from a real "not final" unless
 * the fetch state is checked FIRST. Getting this backwards would be harmless;
 * getting the surrounding logic backwards — treating unreadable as final —
 * would end every storm during any NOAA outage. */
resetLifecycle();
advisoryFails = true;
const unread = nhcStorm({ advisoryKey: 'nhc:al092025:022' });
observeSource('nhc', [unread]);
await observeDeclarations([unread]);
ok(endedStorms(NOW).length === 0, 'an unreadable advisory ends nothing');
advisoryFails = false;

/* The GDACS path, through the flag the join attached. */
resetLifecycle();
const declaredGdacs = gdacsStorm({ jtwcFinal: { designation: '26W', warningNumber: '039', at: '2026-07-28T00:00:00Z' } });
observeSource('gdacs', [declaredGdacs]);
await observeDeclarations([declaredGdacs]);
const g = endedStorms(NOW)[0];
ok(g?.ended?.reason === 'declared', 'a JTWC final warning ends a GDACS storm');
ok(
  g?.ended?.by === 'jtwc',
  'the ending is attributed to JTWC, not to GDACS whose list the storm was on'
);
ok(
  endedNote(g).headline.includes('Joint Typhoon Warning Center'),
  'the badge names the agency that actually spoke'
);
ok(
  !endedNote(g).headline.includes('GDACS'),
  'the badge does not credit GDACS for a sentence JTWC wrote'
);

/* ===========================================================================
 * 4. ABSENT — counted, never timed
 * ======================================================================== */
section('absent: three clean confirmations, and not one fewer');

resetLifecycle();
observeSource('nhc', [nhcStorm()]);
for (let i = 1; i < ENDED.absentConfirmations; i++) {
  observeSource('nhc', [nhcStorm({ id: 'nhc:al102025', name: 'Other' })]);
  ok(
    endedStorms(NOW).length === 0,
    `still alive after ${i} confirmation${i === 1 ? '' : 's'} of ${ENDED.absentConfirmations}`
  );
}
observeSource('nhc', [nhcStorm({ id: 'nhc:al102025', name: 'Other' })]);
dead = endedStorms(NOW);
ok(dead.length === 1, 'confirmed absent on the threshold poll');
ok(dead[0].ended.reason === 'absent', 'the reason is absent');
ok(
  !endedNote(dead[0]).headline.includes('final advisory'),
  'an absent ending never claims a final advisory it did not read'
);
ok(
  endedNote(dead[0]).headline.includes('stopped listing'),
  'an absent ending says only that the feed stopped carrying it'
);

section('a glitch must never kill a storm');

/* ==> FAILED POLLS CAST NO VOTES. <== The store calls observeSource only from
 * its success branch, so a failure is the ABSENCE of a call. Simulated here the
 * same way: nothing happens. A timer-based rule would have ended this storm. */
resetLifecycle();
observeSource('nhc', [nhcStorm()]);
/* ... hours of dead connectivity: no calls at all ... */
ok(endedStorms(NOW).length === 0, 'no polls at all ends nothing, however long');
ok(
  endedStorms(Date.parse('2026-08-05T00:00:00Z')).length === 0,
  'and still nothing a week later — this rule has no clock in it'
);

/* ==> A REAPPEARANCE RESETS THE COUNT. <== Two misses then a return then two
 * more misses is not five; it is two. */
resetLifecycle();
const other = nhcStorm({ id: 'nhc:al102025', name: 'Other' });
observeSource('nhc', [nhcStorm()]);
observeSource('nhc', [other]);
observeSource('nhc', [other]);
observeSource('nhc', [nhcStorm()]);          // back again
observeSource('nhc', [other]);
observeSource('nhc', [other]);
ok(
  endedStorms(NOW).length === 0,
  'two misses, a reappearance, two more misses: the counter restarted'
);
observeSource('nhc', [other]);
ok(endedStorms(NOW).length === 1, 'and it ends on the third consecutive miss');

/* ==> A REVIVED STORM COMES BACK. <== Storms regenerate. A grey "no longer
 * tracked" dot on a system NHC has resumed warning on is an all-clear over a
 * live storm — the §5 lie in its worst form. */
resetLifecycle();
observeSource('nhc', [nhcStorm()]);
for (let i = 0; i < ENDED.absentConfirmations; i++) observeSource('nhc', [other]);
ok(endedStorms(NOW).length === 1, 'ended, ready to be revived');
observeSource('nhc', [nhcStorm()]);
ok(endedStorms(NOW).length === 0, 'a storm back in the feed is no longer ended');

/* A DECLARED storm is NOT revived merely by still being listed — which is the
 * normal state for hours after a final advisory. Only a newer bulletin revives
 * it. Get this wrong and the state can never stick at all. */
resetLifecycle();
advisoryText = IMELDA_FINAL;
observeSource('nhc', [nhcStorm()]);
await observeDeclarations([nhcStorm()]);
ok(endedStorms(NOW).length === 1, 'declared while still listed');
observeSource('nhc', [nhcStorm()]);   // NHC still lists it, same advisory
ok(
  endedStorms(NOW).length === 1,
  'a declared storm still in the feed under the SAME advisory stays ended'
);
observeSource('nhc', [nhcStorm({ advisoryKey: 'nhc:al092025:025' })]);
ok(
  endedStorms(NOW).length === 0,
  'a NEWER advisory revives it — regeneration is real and must be noticed'
);

section('a truncated list is not evidence');

/* ==> THE GDACS CAP INCIDENT, AS A TEST. <== On 2026-07-26 a wildfire season
 * crowded a live typhoon off a 100-feature cap. That is a clean 200 with storms
 * missing, and it must not vote. */
resetLifecycle();
const many = Array.from({ length: 8 }, (_, i) =>
  gdacsStorm({ id: `gdacs:${i}`, name: `TC-${i}` })
);
for (let i = 0; i < 2; i++) observeSource('gdacs', many);
/* The list collapses to one. Seven storms "vanish" at once. */
for (let i = 0; i < ENDED.absentConfirmations; i++) observeSource('gdacs', [many[0]]);
const survivors = endedStorms(NOW).length;
ok(
  survivors < 7,
  `a sudden collapse does not end all seven at once (ended ${survivors})`
);

/* ==> AND IT MUST NOT DEADLOCK. <== A guard that simply refused forever would
 * mean no storm ever ends again after one collapse. The baseline is adopted, so
 * the mechanism keeps working — a real collapse costs one extra poll. */
resetLifecycle();
for (let i = 0; i < 2; i++) observeSource('gdacs', many);
for (let i = 0; i < ENDED.absentConfirmations + 1; i++) observeSource('gdacs', [many[0]]);
ok(
  endedStorms(NOW).length > 0,
  'the truncation guard does not jam the mechanism shut permanently'
);

/* ==> AN EMPTY LIST COSTS ONE POLL, THEN COUNTS. <==
 *
 * This assertion started life as "an empty clean list ends nothing" and it was
 * WRONG about the design in two ways the code comment in observeSource now
 * records: it deadlocked the guard once the baseline reached zero, and it
 * contradicted `overallStatus`, which already treats zero storms from clean
 * sources as the app's only true all-clear. Going 1 → 0 is also how a season's
 * last storm normally ends.
 *
 * What is guaranteed is that the collapse poll itself never votes — so a
 * one-off empty answer from a flaky relay costs nothing at all. */
resetLifecycle();
observeSource('nhc', [nhcStorm()]);
for (let i = 0; i < ENDED.absentConfirmations; i++) observeSource('nhc', []);
ok(
  endedStorms(NOW).length === 0,
  'the poll where the list collapsed to empty cast no vote'
);
observeSource('nhc', []);
ok(
  endedStorms(NOW).length === 1,
  'and a feed that keeps saying "no storms" is eventually believed'
);

/* A SINGLE empty poll between two good ones is worth nothing whatsoever. */
resetLifecycle();
observeSource('nhc', [nhcStorm()]);
observeSource('nhc', []);
observeSource('nhc', [nhcStorm()]);
ok(endedStorms(NOW).length === 0, 'one empty poll surrounded by good ones ends nothing');

/* ===========================================================================
 * 5. THE GRACE PERIOD
 * ======================================================================== */
/* ===========================================================================
 * 4b. JTWC'S ROSTER — the second authority over a GDACS storm
 * ======================================================================== */
section("JTWC's roster kills what GDACS will not let die");

/* GDACS does not reliably retire storms: it kept NOUL-26 listed for days after
 * her last analysis. So a storm can be neither absent (it never leaves the
 * list) nor declared (JTWC's final warning scrolled off before we looked). The
 * roster is the way out — falling off JTWC's active list is the same shape of
 * evidence as falling out of a source's list. */
const listed = (over = {}) => gdacsStorm({ jtwcRoster: { listed: true }, ...over });
const unlisted = (over = {}) => gdacsStorm({ jtwcRoster: { listed: false }, ...over });

resetLifecycle();
observeSource('gdacs', [listed()]);
for (let i = 1; i < ENDED.absentConfirmations; i++) {
  observeSource('gdacs', [unlisted()]);
  ok(endedStorms(NOW).length === 0, `roster: alive after ${i} of ${ENDED.absentConfirmations}`);
}
observeSource('gdacs', [unlisted()]);
dead = endedStorms(NOW);
ok(dead.length === 1, 'off the roster three times running: confirmed over');
ok(dead[0].ended.by === 'jtwc', 'attributed to JTWC, whose list it fell off');
ok(dead[0].ended.reason === 'absent', 'and to absence, because nobody said a word');
ok(
  endedNote(dead[0]).headline.includes('Joint Typhoon Warning Center'),
  'the copy names JTWC, not GDACS'
);
ok(
  endedNote(dead[0]).headline.includes('stopped listing'),
  'and claims only that the list stopped carrying it'
);

/* ==> STILL BEING IN GDACS IS NOT A CONTRADICTION. <== The storm never left
 * GDACS; that is the whole condition. If the GDACS list revived it, the storm
 * would be promoted and revived on alternating polls forever. */
observeSource('gdacs', [unlisted()]);
ok(endedStorms(NOW).length === 1, 'still in the GDACS list, and still over');

/* Only JTWC listing it again is evidence. */
observeSource('gdacs', [listed()]);
ok(endedStorms(NOW).length === 0, 'back on JTWC\u2019s roster: revived');

/* ==> A STORM JTWC NEVER CARRIED CANNOT BE KILLED BY ITS ABSENCE. <== GDACS
 * covers systems JTWC does not warn on at all. For those the roster is not
 * silence about the storm's fate; it is a list that was never going to mention
 * it. */
resetLifecycle();
for (let i = 0; i <= ENDED.absentConfirmations + 2; i++) {
  observeSource('gdacs', [unlisted({ id: 'gdacs:9', name: 'SOMETHING-26' })]);
}
ok(
  endedStorms(NOW).length === 0,
  'never on the roster, never killed by the roster'
);

/* ==> A JTWC OUTAGE MOVES THE TALLY BY ZERO. <== lib/jtwc-wind.js attaches no
 * `jtwcRoster` at all unless the index came back clean, so an unreachable or
 * partial index is silence, not a vote — in either direction. */
resetLifecycle();
observeSource('gdacs', [listed()]);
observeSource('gdacs', [unlisted()]);            // 1 of 3
for (let i = 0; i < 6; i++) observeSource('gdacs', [gdacsStorm()]); // no verdict at all
ok(endedStorms(NOW).length === 0, 'six blind polls do not finish the count');
observeSource('gdacs', [unlisted()]);            // 2 of 3
ok(endedStorms(NOW).length === 0, 'and the tally was HELD, not reset — 2 of 3');
observeSource('gdacs', [unlisted()]);            // 3 of 3
ok(endedStorms(NOW).length === 1, 'the count resumes exactly where it stopped');

section('24 hours of grace, measured from the last published fix');

/* The window is anchored to `observedAt` — the last thing anybody PUBLISHED
 * about the storm — not to the moment the app worked out it was over. So the
 * fixtures move the fix time, and `ended.at` is deliberately left fresh in the
 * first block to prove it is not what is being read. */
const fixedAt = (iso) => ({
  ...nhcStorm(),
  observedAt: iso,
  ended: { reason: 'declared', by: 'nhc', at: new Date(NOW).toISOString(), became: null, key: null },
});

ok(!endedExpired(fixedAt('2026-07-28T00:00:00Z'), NOW), '18 h since the last fix: still shown');
ok(
  !endedExpired(fixedAt(new Date(NOW - (ENDED.holdFor - HOUR)).toISOString()), NOW),
  'one hour inside the window: still shown'
);
ok(
  endedExpired(fixedAt(new Date(NOW - (ENDED.holdFor + HOUR)).toISOString()), NOW),
  'one hour past the window: dropped'
);
ok(ENDED.holdFor === 24 * HOUR, 'the grace period is 24 hours (Aaron’s call)');

/* ==> THE NOUL CASE, AND THE WHOLE REASON THE ANCHOR MOVED. <== A storm
 * confirmed dead LONG after its last transmission must not be handed a fresh
 * full window starting from the confirmation. Under the old rule this record
 * had 24 more hours to run; under the new one it is already gone. */
ok(
  endedExpired(
    {
      ...gdacsStorm(),
      observedAt: new Date(NOW - 84 * HOUR).toISOString(),
      ended: { reason: 'absent', by: 'jtwc', at: new Date(NOW).toISOString(), became: null, key: null },
    },
    NOW
  ),
  'confirmed dead today, last fix three and a half days ago: dropped now'
);

/* A CORRUPT RECORD EXPIRES rather than becoming permanent furniture — but only
 * when BOTH stamps are unreadable. An unparseable fix time falls back to
 * `ended.at` rather than throwing the storm away for a parse failure. */
ok(
  !endedExpired(
    { ...nhcStorm(), observedAt: 'not a date',
      ended: { reason: 'declared', by: 'nhc', at: new Date(NOW - HOUR).toISOString(), became: null, key: null } },
    NOW
  ),
  'an unreadable fix time falls back to the ended stamp'
);
ok(
  endedExpired(
    { ...nhcStorm(), observedAt: 'not a date',
      ended: { reason: 'declared', by: 'nhc', at: 'also not a date', became: null, key: null } },
    NOW
  ),
  'both stamps unreadable: expires'
);
ok(!endedExpired(nhcStorm(), NOW), 'a live storm is never expired');

/* The sweep runs on READ — there is no timer, because nothing happens at 36
 * hours except that the record stops being worth screen space. */
resetLifecycle();
advisoryText = IMELDA_FINAL;
observeSource('nhc', [nhcStorm({ observedAt: '2026-07-25T00:00:00Z' })]);
await observeDeclarations([nhcStorm({ observedAt: '2026-07-25T00:00:00Z' })]);
ok(endedStorms(NOW).length === 0, 'a storm that ended 90 h ago is swept on read');

/* ===========================================================================
 * 6. THE LIST — one storm, one row
 * ======================================================================== */
section('merge: the registry wins, and NHC still wins over GDACS');

const liveNhc = nhcStorm();
const deadNhc = { ...nhcStorm(), ended: { reason: 'declared', by: 'nhc', at: '2026-07-28T15:00:00Z', became: null, key: null } };

let merged = mergeWithEnded([liveNhc], [], [deadNhc], NOW);
ok(merged.length === 1, 'a storm in the feed AND the registry appears once');
ok(isEnded(merged[0]), 'and the registry copy is the one kept');

/* THE BERTHA SHADOW. A GDACS copy of an Atlantic storm is dropped while alive;
 * it must not return through the grace period as a grey second Bertha. */
const deadGdacsShadow = {
  ...gdacsStorm({ id: 'gdacs:9999', name: 'BERTHA-26', basin: 'atlantic' }),
  ended: { reason: 'absent', by: 'gdacs', at: '2026-07-28T15:00:00Z', became: null, key: null },
};
merged = mergeWithEnded([liveNhc], [], [deadGdacsShadow], NOW);
ok(
  merged.length === 1 && merged[0].source === 'nhc',
  'an ended GDACS copy of an NHC-basin storm stays dropped'
);

/* ORDER: live, then silent, then ended — all within the basin. */
const silent = nhcStorm({ id: 'nhc:s', name: 'Silent', observedAt: '2026-07-26T00:00:00Z' });
const sorted = sortStorms([deadNhc, silent, nhcStorm({ id: 'nhc:live', name: 'Live' })], NOW);
ok(sorted[0].name === 'Live', 'live sorts first');
ok(sorted[1].name === 'Silent', 'silent sorts above ended');
ok(isEnded(sorted[2]), 'ended sorts last');

/* ===========================================================================
 * 7. THE WORDS
 * ======================================================================== */
section('the copy never claims the storm dissipated');

const declaredNote = endedNote(deadNhc);
for (const [label, s] of [['declared', declaredNote], ['absent', endedNote({ ...nhcStorm(), ended: { reason: 'absent', by: 'nhc', at: '2026-07-28T15:00:00Z', became: null, key: null } })]]) {
  const all = `${s.headline} ${s.detail}`.toLowerCase();
  ok(!all.includes('dissipat'), `${label}: never says dissipated`);
  ok(!all.includes('all clear'), `${label}: never says all clear`);
  ok(!all.includes('safe'), `${label}: never says safe`);
  ok(s.detail.includes('last published'), `${label}: says the position is the last published`);
}
ok(
  declaredNote.detail.includes('no further advisories'),
  'declared: accounts for the missing forecast'
);
ok(endedNote(nhcStorm()) === null, 'a live storm has no ended badge');
ok(endedSectionNote(nhcStorm()) === null, 'a live storm has no section note');
ok(
  endedSectionNote(deadNhc).includes('no further advisories'),
  'the section note says there will not be another update'
);
ok(
  !endedSectionNote(deadNhc).includes('None in effect'),
  'the section note never reuses the all-clear sentence'
);
ok(ENDED_SHORT === 'ended', 'the row word is "ended"');
ok(agencyName('jtwc').includes('Joint Typhoon'), 'JTWC has a name of its own');
ok(agencyName('nonsense') === 'The issuing agency', 'an unknown agency credits nobody');

/* ===========================================================================
 * 8. PERSISTENCE — an ended storm survives the reload
 * ======================================================================== */
section('the track survives a reload');

/* THE WHOLE REASON THIS PERSISTS: nothing can rebuild an ended storm. It is out
 * of both feeds, a refetch returns nothing, and the in-memory geometry cache is
 * gone. Without this the abrupt disappearance simply moves to page load. */
const track = [
  [-58.0, 31.0, Date.parse('2026-07-27T00:00:00Z'), 90, 4],
  [-59.0, 32.0, Date.parse('2026-07-27T12:00:00Z'), 75, 3],
  [-59.5, 33.2, Date.parse('2026-07-28T00:00:00Z'), 65, 2],
];
const slot = rehydrateTrack(track);
ok(slot.status === 'ok', 'a rehydrated track is an ok slot');
ok(slot.fc.features.length === 3, 'every point survives');
const p0 = slot.fc.features[0].properties;
ok(p0._time === track[0][2], 'the time is stamped where lib/track-point.js reads it');
ok(p0._windKt === 90, 'the wind is stamped where lib/track-point.js reads it');
ok(p0._catStamped === true, 'the category is flagged as already resolved');
ok(
  rehydrateTrack([[1, 2, 100, null, null]]).fc.features[0].properties._catStamped === true,
  'a NULL category is still STAMPED — a stamped null is a real reading, not a gap'
);
ok(
  rehydrateTrack([[1, 2, 100, null, null]]).fc.features[0].properties._windKt === undefined,
  'a missing wind is omitted, never zeroed'
);

/* ==> THE GDACS HURRICANE ROUND TRIP, AND IT IS THE ASSERTION THAT WOULD HAVE
 * CAUGHT A FLAT RIDGE ON GLASS. <==
 *
 * A GDACS hurricane has NO category index — its strongest published band is the
 * Cat 1 floor, so the source cannot say which hurricane it is — and carries its
 * whole severity in the intensity CODE. The first version of `compactTrack`
 * persisted the index and dropped the code, so every bead came back with no
 * readable intensity at all, `representativeKt` returned null, and
 * `sevFromKt(null)` put the entire ridge on the cage's noise floor: a perfectly
 * level track in the generic hue instead of a hurricane. It looked like the mesh
 * was broken rather than like data had been lost.
 *
 * The check is the FULL CHAIN a cage bead actually walks — reading, then wind —
 * because that is where the loss showed up. Asserting the tuple round-trips
 * would have passed the whole time. */
{
  const gdacsPoint = rehydrateTrack([[120.5, 21.1, 1000, null, null, 'HU']])
    .fc.features[0].properties;
  const reading = trackPointReading(gdacsPoint);
  const kt = windKtOf(gdacsPoint) ?? representativeKt(reading.index, 'tropical', reading.code);
  ok(gdacsPoint._catCode === 'HU', 'a GDACS intensity code survives the round trip');
  ok(reading.code === 'HU', 'and the reading finds it where a live point keeps it');
  ok(
    reading.color === HURRICANE_UNKNOWN_COLOR,
    `and it colours as an unknown-strength hurricane, not generic (${reading.color})`
  );
  ok(kt != null && kt > 100, `and it lifts the cage rather than flooring it (${kt} kt)`);

  /* A five-element tuple predating the fix still behaves — no migration, and
   * records expire inside ENDED.holdFor so the old shape cannot outlive a day
   * and a half. It floors, which is the loss this fix removes; what matters is
   * that it does not throw. */
  const legacy = rehydrateTrack([[120.5, 21.1, 1000, null, null]]).fc.features[0].properties;
  ok(legacy._catCode === undefined, 'a pre-fix tuple simply carries no code');
  ok(
    trackPointReading(legacy).code === '',
    'and degrades to no reading rather than throwing'
  );
}
ok(rehydrateTrack(null).fc.features.length === 0, 'a missing track degrades to empty');

/* And the blob really is on disk under its own key. */
resetLifecycle();
advisoryText = IMELDA_FINAL;
observeSource('nhc', [nhcStorm()]);
await observeDeclarations([nhcStorm()]);
const raw = JSON.parse(mem.get('landfall.ended'));
ok(raw?.v === 1, 'the registry is persisted with a schema version');
ok(raw.ended.length === 1, 'the ended storm is in the persisted blob');
ok(raw.ended[0].storm.ended.reason === 'declared', 'with its reason intact');

/* ------------------------------------------------------------------------- */
if (failures.length) {
  console.log(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (the bulletin fixtures are REAL published text — they still cannot');
console.log('   tell you the grey dot and the badge read right on a phone)');
