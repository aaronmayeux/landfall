#!/usr/bin/env node
/**
 * test-drawer-trim.mjs — the drawer de-duplication pass (2026-08-10).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-drawer-trim.mjs`, same as every
 * other suite here (§12 — this project has no toolchain by design).
 *
 * WHAT THIS GUARDS, AND WHY IT IS ONE FILE. Aaron read four screenshots off a
 * phone and every finding in them had the same shape: a fact stated more than
 * once, or a fact stated wrongly because the code that stated it could not see
 * which of several silences it was looking at. The fixes touch five files and
 * one bug; splitting them across five suites would hide the fact that they are
 * one argument.
 *
 * THE FIXTURE IS THE STORM FROM THE SCREENSHOT. FIFTEEN-26, 6,272 miles WNW of
 * a house in Prairieville, moving W at 5 kt with a published heading — which is
 * the exact combination that produced the contradiction. A synthetic storm with
 * no motion would have passed the old code.
 *
 * WHAT THIS CANNOT PROVE: that the drawer LOOKS right. Three headings that
 * differ by a pixel, whether an amber stamp on a heading reads as a warning or
 * as furniture, whether the coordinate hint is legible at arm's length — all
 * glass. What it proves is that the app no longer says two different things
 * about one storm, and that the rules deciding what to hoist are the strict
 * ones they were written to be.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { motionTrend, motionTrendDetail } = await import('../data/home.js');
const { formatDistance, formatCoords } = await import('../lib/units.js');
const { APPROACH } = await import('../config/constants.js');

/* Prairieville, Louisiana — the house in the screenshot's footer. */
const HOME = { lon: -90.955, lat: 30.301 };

/* ---------------------------------------------------------------------------
 * THE BUG: SIX SILENCES WORE ONE SENTENCE
 * ------------------------------------------------------------------------- */
section('motionTrendDetail — the reason, not just the word');

/* FIFTEEN-26 as the feed published it: a real heading and a real speed, on the
 * far side of the planet. `motionTrend` correctly declines to say "closing" —
 * over a great circle crossing Alaska the word is meaningless — but the screen
 * then explained that silence by blaming NHC for publishing nothing, four
 * inches above a vitals row printing "Moving W at 5 mph" off the same
 * advisory. THIS ASSERTION IS THE BUG. */
const fifteen = { lon: 137.4, lat: 17.2, headingDeg: 270, speedKt: 5 };
const far = motionTrendDetail(fifteen, HOME);
ok(far.trend === null, 'a storm 6,000 miles away still gets no trend word');
ok(
  far.why === 'too-far',
  'THE REASON IS DISTANCE, NOT A MISSING FIELD. `no-motion` here is the bug: '
  + 'it makes the screen say nobody published a heading while the vitals row '
  + `prints one. got: ${far.why}`
);

/* GDACS publishes neither heading nor speed, and that IS the missing-field
 * case. The two must not collapse into each other in either direction. */
const gdacs = { lon: -88, lat: 26 };
ok(
  motionTrendDetail(gdacs, HOME).why === 'no-motion',
  'a source that publishes no motion at all is still `no-motion`'
);

/* NHC publishes drifting systems at 0 kt. A heading with no speed behind it
 * points nowhere, and "not moving" is a different sentence from "not stated". */
ok(
  motionTrendDetail({ lon: -88, lat: 26, headingDeg: 270, speedKt: 0 }, HOME).why
    === 'stationary',
  'a 0 kt drifter is `stationary`, not `no-motion`'
);

ok(motionTrendDetail(null, HOME).why === 'no-home', 'no storm is `no-home`');
ok(motionTrendDetail(fifteen, null).why === 'no-home', 'no home is `no-home`');
ok(
  motionTrendDetail({ headingDeg: 270, speedKt: 20 }, HOME).why === 'no-position',
  'a storm with motion but no position is `no-position`'
);

/* A storm inside the relevance ring, moving fast enough to be worth a word.
 * Due east of home at ~350 nm, heading west: unambiguously closing. */
const closing = { lon: -84.2, lat: 30.301, headingDeg: 270, speedKt: 20 };
const near = motionTrendDetail(closing, HOME);
ok(near.trend === 'closing', `a storm bearing down reads as closing: got ${near.trend}`);
ok(near.why === null, 'a storm WITH a word carries no reason — the two are exclusive');

/* And the same storm running the other way. WITHOUT THIS FIXTURE the wrapper
 * check below is blind: a `motionTrend` rewritten to return 'closing' or null
 * and nothing else agrees with `motionTrendDetail` on every other case here,
 * so the drift only shows up on a storm that is leaving. Caught by mutation,
 * not by reading. */
const receding = { lon: -84.2, lat: 30.301, headingDeg: 90, speedKt: 20 };
ok(
  motionTrendDetail(receding, HOME).trend === 'receding',
  `a storm running away reads as receding: got ${motionTrendDetail(receding, HOME).trend}`
);

/* Broadside inside the deadband: moving, near, and honestly unanswerable. This
 * is the sixth silence, and it must not be reported as a missing field either. */
const broadside = { lon: -90.955, lat: 35.301, headingDeg: 90, speedKt: 3 };
const side = motionTrendDetail(broadside, HOME);
ok(
  side.trend === null && side.why === 'broadside',
  `a storm passing broadside is \`broadside\`: got ${side.trend} / ${side.why}`
);

/* ==> ONE LADDER, NOT TWO. <== The whole point of making motionTrend a wrapper
 * is that the word and the reason cannot drift apart. If someone later
 * reintroduces a second copy of the ladder, this catches the first disagreement
 * rather than the fiftieth. */
for (const s of [fifteen, gdacs, closing, receding, broadside, { lon: -88, lat: 26, headingDeg: 1, speedKt: 0 }]) {
  ok(
    motionTrend(s, HOME) === motionTrendDetail(s, HOME).trend,
    'motionTrend() and motionTrendDetail().trend never disagree'
  );
}

/* The relevance cut is a constant, not a literal in either file. A storm one
 * mile inside the ring is relevant; one mile outside is not. */
ok(APPROACH.relevanceNm === 1500, `relevanceNm is still the documented 1500 nm: got ${APPROACH.relevanceNm}`);

/* ---------------------------------------------------------------------------
 * FALSE PRECISION
 * ------------------------------------------------------------------------- */
section('formatDistance — three tiers');

/* The screenshot's number. 6,272 miles is a position off an hours-old advisory
 * on a system moving 5 mph, measured to a geocoded house. The last digit is a
 * rendering artefact and printing it claims accuracy nobody has. */
const shown = formatDistance(5450, 'imperial');
ok(
  shown !== '6,272 mi',
  `the exact string from the screenshot is gone: got ${shown}`
);
ok(/0 mi$/.test(shown), `it rounds to a ten: got ${shown}`);

/* Under the threshold the exact figure starts to matter and must survive. A
 * closest pass of 37 miles is not 40. */
ok(formatDistance(32, 'imperial') === '37 mi', `mid-range stays exact: got ${formatDistance(32, 'imperial')}`);

/* And the bottom tier is untouched — "0 miles" for something 0.4 miles away
 * was the original reason this function has tiers at all. */
ok(formatDistance(0.35, 'imperial') === '0.4 mi', `close range keeps its decimal: got ${formatDistance(0.35, 'imperial')}`);

/* Metric readers hit the tier at the same physical distance, not at a number
 * that happens to look round in miles. */
const km = formatDistance(5450, 'metric');
ok(/0 km$/.test(km), `metric rounds on the same rule: got ${km}`);

ok(formatDistance(null, 'imperial') === '—', 'a missing distance is still an em-dash, not 0');

/* ---------------------------------------------------------------------------
 * THE SHARED COORDINATE FORMATTER
 * ------------------------------------------------------------------------- */
section('formatCoords — one copy, two precisions');

ok(
  formatCoords(-36.3, 12.6) === '12.6°N 36.3°W',
  `the detail panel's form is unchanged: got ${formatCoords(-36.3, 12.6)}`
);
ok(
  formatCoords(-41.4, 18.2, 0) === '18°N 41°W',
  `the list row's coarse form: got ${formatCoords(-41.4, 18.2, 0)}`
);
ok(formatCoords(140.2, -8.7) === '8.7°S 140.2°E', 'southern and eastern hemispheres');
ok(formatCoords(undefined, 12) === '—', 'a missing coordinate is an em-dash, not NaN°N');

/* THE OLD COPY IS GONE, NOT LEFT AS A DEAD FUNCTION (§12). Two coordinate
 * formatters is how one of them ends up printing -36.3°E for 36.3°W. */
const detailSrc = fs.readFileSync('ui/view-area-detail.js', 'utf8');
ok(
  !/function coords\s*\(/.test(detailSrc),
  'ui/view-area-detail.js no longer carries its own coordinate formatter'
);
ok(
  /formatCoords/.test(detailSrc),
  'ui/view-area-detail.js uses the shared one'
);

/* ---------------------------------------------------------------------------
 * THE VIEW RULES
 *
 * These are source assertions, and they are weaker than the ones above — the
 * functions live inside a closure with no export, which is right for view code
 * and means a browser is the only thing that can call them. They are here
 * because each pins a specific sentence that was WRONG on glass, so a
 * regression puts the old string back and this goes red.
 * ------------------------------------------------------------------------- */
section('the drawer rules, as written');

const homeSrc = fs.readFileSync('ui/view-home.js', 'utf8');
const stormsSrc = fs.readFileSync('ui/view-storms.js', 'utf8');

/* The countdown must not hardcode one explanation for every silence. */
ok(
  !/det:\s*dash\.trend\s*\?[^\n]*\n?[^\n]*'nobody publishes/.test(homeSrc),
  'the countdown no longer hardcodes "nobody publishes" for every trend gap'
);
ok(
  /TREND_GAP\[dash\.trendUnavailable\]/.test(homeSrc),
  'the countdown picks its sentence from the reason'
);
/* `too-far` maps to the empty string deliberately — see the table's note. */
ok(
  /'too-far':\s*''/.test(homeSrc),
  'a too-far storm gets NO gloss, because the distance above it is complete'
);

/* The far-off collapse. The three sections that only make sense about an
 * approach must be gated on the app's own answer to whether there is one. */
ok(
  /const farOff = dash\.approach\?\.relevant === false;/.test(homeSrc),
  'the dashboard asks whether the storm ever comes near'
);
for (const sect of ['chartSectHtml', 'figuresHtml', 'countdownHtml']) {
  ok(
    new RegExp(`farOff \\? '' : ${sect}\\(dash\\)`).test(homeSrc),
    `${sect} is not built for a storm that never comes near`
  );
}
/* Vitals and the home row are NOT gated. Cutting those would be a §5 silence:
 * they are the only place the storm's own figures and the advisory age appear. */
ok(
  /\n      vitalsHtml\(dash\),\n      homeRowHtml\(home\),/.test(homeSrc),
  'the vitals and the advisory stamp survive the collapse — nothing goes blank'
);

/* The hoist rules. Each of these three lines is what stops a heading making a
 * claim about a row it does not cover. */
ok(
  /if \(isEnded\(s\) \|\| isSilent\(s\)\) continue;/.test(stormsSrc),
  'ended and silent rows are skipped when working out a shared age'
);
ok(
  /if \(!isStale\(s\)\) return null;/.test(stormsSrc),
  'ANY fresh row cancels the hoist — a heading must never age a live storm'
);
ok(
  /if \(ages\.length < 2\) return null;/.test(stormsSrc),
  'one row is not repetition, so nothing is hoisted off it'
);

/* Ended and silent must still render on the row itself. They are facts about a
 * storm, not about the feed's cadence, and they are the two the reader must
 * not have to reconstruct from a heading. */
ok(
  /if \(isEnded\(s\)\) return `\$\{SEP\}<span class="row-ended">/.test(stormsSrc)
  && /if \(isSilent\(s\)\) return `\$\{SEP\}<span class="row-silent">/.test(stormsSrc),
  'ageSuffix still puts "ended" and "not updating" on the row, never on a heading'
);

/* THE HOIST IS VISUAL ONLY. `rowLabel` is the accessibility surface for an
 * aria-hidden canvas, and a screen-reader user reads rows without carrying a
 * heading down the list. If the hoisted value ever reaches rowLabel, every row
 * silently loses its age for the reader with the least context. */
const rowLabelBody = stormsSrc.slice(
  stormsSrc.indexOf('function rowLabel('),
  stormsSrc.indexOf('const SEP =')
);
ok(
  rowLabelBody.length > 0 && !/hoist/i.test(rowLabelBody),
  'rowLabel still speaks every storm\'s own age — the hoist never reaches it'
);

/* The heading is hidden whenever there are no rows under it. "Active · 0" over
 * "Storm feeds are not responding" is a flat contradiction: zero is what we
 * could not find out. */
ok(
  (stormsSrc.match(/renderHead\(null\);/g) || []).length === 4,
  'every empty list state blanks the heading — got '
  + (stormsSrc.match(/renderHead\(null\);/g) || []).length + ' of 4'
);

/* The heading lives OUTSIDE role="list". An <h2> among listitems is invisible
 * to the heading navigation it exists for (§16). */
const skeleton = stormsSrc.slice(
  stormsSrc.indexOf('function buildSkeleton'),
  stormsSrc.indexOf('function buildSkeleton') + 1400
);
ok(
  skeleton.indexOf('<h2 class="list-head"') < skeleton.indexOf('id="storm-list"'),
  'the heading is a sibling of the list, not a child of it'
);

/* Two scales in one list must never look like one scale. The source tag only
 * leaves the rows when every row agrees. */
ok(
  /return areas\.every\(\(a\) => a\.source === first\) \? first : null;/.test(stormsSrc),
  'a mixed NHC/JTWC list puts the source back on every row'
);

/* The two-day line is REPLACED when it would repeat, never dropped. A quietly
 * missing line reads as "not stated", which is a different fact from "equal". */
ok(
  /same odds \$\{GENESIS\.HORIZON\.twoDay\}/.test(stormsSrc),
  'a two-day figure equal to the seven-day one says so instead of repeating it'
);
/* Checked against the CODE, not the comments — the note above `watchTwoDay`
 * explains why this phrasing was rejected and would otherwise trip its own
 * assertion. */
const stormsCode = stormsSrc.replace(/\/\*[\s\S]*?\*\//g, '');
ok(
  !/all of it (inside|within)/i.test(stormsCode),
  'and it stops short of the arithmetic — NHC rounds to tens, so equal-after-'
  + 'rounding is not equal'
);

/* The duplicate-title hint goes on the rows that need it AND into the
 * accessible name. Two rows that are word-for-word identical are worse for a
 * screen-reader user than for a sighted one, not better. */
ok(
  /if \(!dupes\.has\(a\.title\)\) return null;/.test(stormsSrc),
  'a uniquely-titled area gets no coordinate hint'
);
ok(
  /\$\{a\.title\}\$\{where \? ` at \$\{where\}` : ''\}/.test(stormsSrc),
  'the coordinates are in the accessible name too, not just on the glass'
);

/* ---------------------------------------------------------------------------
 * THE STYLES THE NEW MARKUP DEPENDS ON
 * ------------------------------------------------------------------------- */
section('panels.css — the new classes exist');

const css = fs.readFileSync('ui/panels.css', 'utf8');
for (const cls of ['.list-head', '.list-count', '.head-note', '.row-where']) {
  ok(css.includes(`${cls} {`), `${cls} is styled`);
}
ok(
  css.includes(".list-head[data-hidden='true'] { display: none; }"),
  'the heading actually hides when told to'
);
ok(
  css.includes(".head-note[data-tone='stale'] { color: var(--stale); }"),
  'THE HOISTED AGE KEEPS `--stale`. Moving a fact up a level must not change '
  + 'what its colour means (§6)'
);
/* Zero hardcoded hex in feature CSS — the single visual contract. */
const newBlock = css.slice(css.indexOf('/* --- the storm list'), css.indexOf('/* --- storm rows'));
ok(
  !/#[0-9a-fA-F]{3,8}\b/.test(newBlock),
  'nothing added in this pass hardcodes a colour'
);

/* --- report --------------------------------------------------------------- */
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (the drawer still needs a look on glass — nothing here proves it LOOKS right)');
