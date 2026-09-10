#!/usr/bin/env node
/**
 * test-category-ink.mjs — bone for a reading with nothing to claim (§57.7g).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-category-ink.mjs`.
 *
 * ===========================================================================
 * WHAT WENT WRONG
 * ===========================================================================
 *
 * The home rail's "Closest it came" row landed on a pre-genesis fix — a moment
 * when the system carried a wind and no classification anyone would grade. It
 * drew in the brick `CATEGORY_COLOR.GENERIC` and read on a phone as a severe
 * storm. Seen on glass 2026-09-10.
 *
 * §57.7g had already settled what that state looks like, on 2026-08-29, after
 * the archive globe tried both of the other candidates: the teal
 * `PREGENESIS_COLOR` read too close to the `TD` blue and the brick read like a
 * strong storm, so an ungraded system takes `stormEnded` — bone, a mark
 * drained of its colour and still fully present. The home dashboard never got
 * the memo.
 *
 * ===========================================================================
 * WHY THERE ARE TWO FUNCTIONS AND WHY THAT IS NOT A SMELL
 * ===========================================================================
 *
 * `stormEnded` is PALETTE-SCOPED. `categoryColor` feeds MapLibre features and
 * Three.js materials as well as CSS, and a palette value baked into a map
 * feature is stale the instant the theme flips — with no legal cheap fix,
 * because `map/theme-state.js` rule 1b forbids an expression reading both
 * global state and feature data and there is a gate that fails the build on
 * one. So `categoryInk` exists for CSS contexts, where
 * `var(--storm-ended)` resolves and rethemes for free, and `categoryColor` is
 * unchanged for everything that hands a colour to a rendering engine.
 *
 * ==> THE RISK THAT CREATES IS DRIFT, AND SECTION 3 IS THE WHOLE ANSWER TO IT.
 * <== Two functions answering one question is how a list and a globe come to
 * disagree about one storm. So rather than trusting a comment, this suite
 * walks the ENTIRE input matrix and asserts the two agree on every reading
 * that has a colour to earn, and differ on exactly the readings that do not.
 *
 * ===========================================================================
 * WHAT THIS CANNOT PROVE
 * ===========================================================================
 *
 * Whether bone READS as "nothing was graded here" on a phone, next to a green
 * TS dot two rows down. That is glass and it is Aaron's.
 */

import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { categoryColor, categoryInk, UNGRADED_INK } = await import('../lib/category.js');
const { CATEGORY_COLOR, HURRICANE_UNKNOWN_COLOR, PREGENESIS_COLOR } =
  await import('../config/tokens.js');
const { DARK, LIGHT } = await import('../config/tokens.js');

/* =========================================================================
 * 1. THE INK IS THE VARIABLE, NOT A HEX
 *
 * A hex here would be the bug the whole design avoids: bone is two different
 * values in two themes, and a resolved one cannot follow a theme flip.
 * ====================================================================== */
section('the ink is the variable, not a hex');

ok(UNGRADED_INK === 'var(--storm-ended)',
   `the ungraded ink is the custom property (got ${UNGRADED_INK})`);
ok(!/^#/.test(UNGRADED_INK),
   'and is NOT a resolved hex, which could not follow a theme flip');

/* ==> THE VARIABLE HAS TO BE WRITTEN BY SOMETHING OR IT RENDERS AS NOTHING.
 * <== A `var()` naming nothing throws nothing and paints nothing, and NOW.md
 * records that as the one CSS mistake this repo has no gate for. This is that
 * gate, for this one property. */
const themeSwitch = fs.readFileSync('app/theme-switch.js', 'utf8');
ok(themeSwitch.includes("setProperty('--storm-ended'"),
   'app/theme-switch.js writes --storm-ended, so the var() resolves to something');

/* And it must resolve to something DIFFERENT in the two themes, or the
 * palette-scoping this whole design is built around is imaginary. */
ok(DARK.stormEnded !== LIGHT.stormEnded,
   'bone is genuinely a different value per theme — the reason categoryInk exists');

/* =========================================================================
 * 2. THE READINGS THAT HAVE NOTHING TO CLAIM
 * ====================================================================== */
section('the readings that have nothing to claim');

ok(categoryInk(null, 'potential') === UNGRADED_INK,
   'a Potential Cyclone is bone');
ok(categoryInk(null, 'remnant') === UNGRADED_INK,
   'so is a remnant low');
ok(categoryInk(null, 'tropical') === UNGRADED_INK,
   'AND SO IS A TROPICAL READING WITH NO CATEGORY — this is the rail row that '
   + 'started it, and the case the other two would not have caught');
ok(categoryInk(null, 'subtropical') === UNGRADED_INK,
   'the same for subtropical, which grades the same way');

/* ==> THE TWO THINGS THAT ARE NOT UNGRADED, AND BOTH ARE DELIBERATE. <== */
ok(categoryInk(null, 'tropical', 'HU') === HURRICANE_UNKNOWN_COLOR,
   "GDACS's HU is hurricane strength with no Saffir-Simpson number — a real "
   + 'severity, and it must not read as nothing was graded');
ok(categoryInk(null, 'post-tropical') === CATEGORY_COLOR.GENERIC,
   'a post-tropical cyclone keeps the louder hue: it was named, and it can '
   + 'still be the dangerous part of its own life');

/* =========================================================================
 * 3. THE AGREEMENT MATRIX — the drift guard
 *
 * ==> ASSERTED OVER THE WHOLE INPUT SPACE, NOT OVER A HANDFUL OF CASES. <==
 * Every category the app can produce, crossed with every nature and both codes.
 * The rule is stated once and checked everywhere: the two functions differ on
 * exactly the ungraded readings and are identical on every other one.
 * ====================================================================== */
section('the agreement matrix');

const CATEGORIES = [null, 0, 1, 2, 3, 4, 5, 6];
const NATURES = [
  'tropical', 'subtropical', 'post-tropical', 'potential', 'remnant',
  'extratropical', null, undefined, '',
];
const CODES = [null, 'HU', 'TS', 'ZZ'];

let agreed = 0;
let boned = 0;
for (const cat of CATEGORIES) {
  for (const nature of NATURES) {
    for (const code of CODES) {
      const ink = categoryInk(cat, nature, code);
      const col = categoryColor(cat, nature, code);
      if (ink === UNGRADED_INK) {
        boned++;
        /* Every bone answer must replace one of the two hues §57.7g rejected,
         * and never a Saffir-Simpson colour a reading actually earned. */
        ok(col === PREGENESIS_COLOR || col === CATEGORY_COLOR.GENERIC,
           `bone replaced ${col} at (${cat}, ${nature}, ${code}) — it may only `
           + 'ever replace the teal or the brick, never an earned category hue');
      } else {
        agreed++;
        ok(ink === col,
           `categoryInk and categoryColor disagree at (${cat}, ${nature}, ${code}): `
           + `${ink} vs ${col}`);
      }
    }
  }
}

ok(agreed > 0 && boned > 0,
   `the matrix exercised both branches (${agreed} agreed, ${boned} boned) — a `
   + 'matrix that only ever hit one of them would pass while proving nothing');

/* =========================================================================
 * 4. `categoryColor` ITSELF DID NOT MOVE
 *
 * ==> THE MAP WAS DELIBERATELY LEFT ALONE (Aaron, 2026-09-10). <== These four
 * are the assertion that a later session cannot quietly bone the map by
 * "finishing the job" without deciding to. Changing categoryColor's ungraded
 * answers fails here.
 * ====================================================================== */
section('categoryColor itself did not move');

ok(categoryColor(null, 'potential') === PREGENESIS_COLOR,
   'the map still draws a Potential Cyclone in the pre-genesis teal');
ok(categoryColor(null, 'remnant') === PREGENESIS_COLOR,
   'and a remnant low the same');
ok(categoryColor(null, 'tropical') === CATEGORY_COLOR.GENERIC,
   'and an ungraded tropical reading still takes the brick on the map');
ok(categoryColor(1, 'tropical') === CATEGORY_COLOR.TS,
   'and a graded storm is untouched by any of this, on either function');

/* =========================================================================
 * 5. IT REACHES THE RAIL
 *
 * Sections above drive the pure function. The bug was that the RAIL asked the
 * wrong one, so the fix is only proven by building a real row and reading the
 * markup it produces.
 * ====================================================================== */
section('it reaches the rail');

const { buildHomeDashboard } = await import('../data/home-dashboard.js');
const { countdownHtml } = await import('../ui/countdown-home.js');

const ISSUED = '2026-07-21T21:00:00Z';
const NOW = Date.parse(ISSUED);
const FIX = fs.readFileSync('samples/bertha-al022026/fstadv-010.txt', 'utf8');
ok(FIX.includes('TROPICAL STORM CENTER LOCATED NEAR 29.4N  87.2W AT 21/2100Z'),
   'fixture states the position this section uses');

/* ==> THE STORM IS GRADED AND THE FORECAST IS NOT, WHICH IS THE REAL SHAPE.
 * <== Bertha is a tropical storm now; the milestone rows below describe
 * forecast hours whose category the source did not supply. That is exactly the
 * pairing the rail got wrong — a graded head painting an ungraded row. */
const CURVE = [
  { time: '2026-07-22T06:00:00Z', lat: 29.6, lon: -87.9, windKt: 45, tau: 9, category: 1, stormType: 'TS' },
  { time: '2026-07-22T18:00:00Z', lat: 29.5, lon: -89.3, windKt: 45, tau: 21, category: 1, stormType: 'TS' },
  { time: '2026-07-23T06:00:00Z', lat: 29.3, lon: -91.4, windKt: 40, tau: 33, category: 1, stormType: 'TS' },
  { time: '2026-07-23T18:00:00Z', lat: 29.4, lon: -93.4, windKt: 35, tau: 45, category: 1, stormType: 'TS' },
  { time: '2026-07-24T06:00:00Z', lat: 29.8, lon: -95.6, windKt: 30, tau: 57, category: 0, stormType: 'TD' },
  { time: '2026-07-24T18:00:00Z', lat: 30.3, lon: -97.6, windKt: 25, tau: 69, category: 0, stormType: 'TD' },
];
const STORM = {
  id: 'nhc:al022026', source: 'nhc', sourceId: 'al022026', name: 'Bertha',
  basin: 'atlantic', lat: 29.4, lon: -87.2,
  windKt: 50, pressureMb: 995, headingDeg: 305, speedKt: 5,
  nature: 'tropical', category: 1, categorySource: 'derived',
  observedAt: ISSUED, advisoryKey: 'al022026-10', can: { forecastPoints: true },
};
const HOME = { lon: -90.0715, lat: 29.9511, label: 'New Orleans, Louisiana', source: 'address' };

const graded = buildHomeDashboard({
  storm: STORM, forecast: CURVE, home: HOME, now: NOW, trackState: 'ok' });
const gradedRail = countdownHtml(graded, () => 'imperial', (i, t) => `<h3>${t}</h3>`);

ok(gradedRail.includes('--rail-dot:'),
   'the rail writes its dot colour as a custom property — the context a var() needs');
ok(!gradedRail.includes(`--rail-dot:${UNGRADED_INK}`),
   'a fully graded storm draws NO bone dot, so the assertion below is not free');

/* THE SAME STORM WITH THE CATEGORIES STRIPPED OFF ITS FORECAST — the fix
 * NHC published a wind for and declined to classify. */
const ungraded = buildHomeDashboard({
  storm: STORM,
  forecast: CURVE.map(({ category, stormType, ...p }) => ({ ...p, category: null })),
  home: HOME, now: NOW, trackState: 'ok',
});
const ungradedRail = countdownHtml(ungraded, () => 'imperial', (i, t) => `<h3>${t}</h3>`);

ok(ungradedRail.includes(`--rail-dot:${UNGRADED_INK}`),
   'AN UNGRADED ROW DRAWS BONE ON THE REAL RAIL — the assertion the fix exists for');
ok(!ungradedRail.includes(`--rail-dot:${CATEGORY_COLOR.GENERIC}`),
   'and no brick survives anywhere on it');

/* =========================================================================
 * 6. EVERY CALL SITE, AND THIS ONE IS A SOURCE ASSERTION ON PURPOSE
 *
 * ==> THE RENDERED CHECK ABOVE ONLY REACHES ONE OF THE THREE. <== Measured
 * while writing this file: with the forecast categories stripped, the rail
 * produces exactly one coloured row — the closest pass. `milestones` is EMPTY,
 * because a class crossing is by definition a pair of categories and there are
 * none; and the observed-pass row needs a storm already going away. Reverting
 * either of those two call sites to `categoryColor` left this suite green.
 *
 * A fixture reaching all three is buildable and would be a lot of scaffolding
 * for a one-token question. The rule is simpler than the fixture: these two
 * files are CSS-only surfaces, so neither has any business calling the
 * engine-facing function at all. Asserted as text, labelled as text, and it
 * catches all six sites at once.
 *
 * ==> IT IS NOT A SUBSTITUTE FOR SECTION 5 AND MUST NOT BECOME ONE. <== This
 * proves which function is named; section 5 proves what the function does when
 * a real dashboard drives it. Deleting either leaves a hole the other does not
 * cover.
 * ====================================================================== */
section('every call site');

for (const f of ['ui/countdown-home.js', 'ui/view-home.js']) {
  const src = fs.readFileSync(f, 'utf8');
  /* Comments legitimately discuss `categoryColor`; a CALL is what matters. */
  ok(!/(?<!`)\bcategoryColor\s*\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
     `${f} calls categoryInk and never categoryColor — it is a CSS surface`);
  ok(src.includes('categoryInk'),
     `${f} does use categoryInk, so the line above is not passing on an absence`);
}

console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
