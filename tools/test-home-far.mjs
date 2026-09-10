#!/usr/bin/env node
/**
 * test-home-far.mjs — the Timeline on a storm that never comes near you.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-home-far.mjs`, like every suite.
 *
 * ===========================================================================
 * THE BUG THIS IS THE PROOF AGAINST
 * ===========================================================================
 *
 * `ui/view-home.js` cut the whole Timeline section on `dash.far`, alongside
 * the headline and the chart. That fork was written for the approach
 * machinery — closest pass, strength at the pass, the arrival trend — which
 * on a cyclone 6,000 nm away produces sentences that are each arithmetically
 * true and together absurd (§56.9, PEILOU-26 on glass, 2026-08-11).
 *
 * ==> BUT THE RAIL IS NOT ONLY APPROACH MACHINERY. <== It carries two
 * families of row. The house-relative ones — wind reaches you, the 100-mile
 * ring, both closest passes — are EACH ALREADY GATED on the corridor or on
 * `approach.relevant`, so on a far storm they cannot fire on their own. The
 * other family is the storm's own class changes, which mention no house, are
 * honest at any distance, and are the thing a reader stepping to a far
 * cyclone came for. Cutting the section threw the second family away to stop
 * the first, which was already stopped.
 *
 * The inconsistency that surfaced it: a GDACS storm with no published heading
 * lands on the `track-unknown` rung and never reaches `far-off`, so it kept a
 * full Timeline at 6,105 nm while an NHC storm at 1,640 nm lost one. Aaron
 * saw both screens and asked why. Fixed by removing the guard, not by
 * reordering the rungs.
 *
 * ===========================================================================
 * THE FIXTURE AND WHY IT IS THIS ONE
 * ===========================================================================
 *
 * Bertha, Advisory 10, verbatim from `samples/bertha-al022026/fstadv-010.txt`
 * — the same storm `tools/test-home.mjs` drives, transcribed the same way and
 * grepped against the file below so a typo cannot quietly move every figure
 * in one direction.
 *
 * She is run against TWO homes, and the pair is the whole design:
 *
 *   New Orleans — 153 nm. `far` false. The rail is full of house rows.
 *   Tokyo       — 6,086 nm. `far` true. The rail is her history and nothing
 *                 else.
 *
 * ==> THE NEAR HOME IS NOT DECORATION. <== Without it, "no row says
 * 'Closest pass'" would pass just as well against a suite that had broken the
 * house rows everywhere. The control proves the assertion has teeth.
 *
 * Every figure below was MEASURED by running these functions against the
 * fixture, not chosen to make an assertion pass.
 *
 * ===========================================================================
 * WHAT THIS CANNOT PROVE
 * ===========================================================================
 *
 * Whether a rail with no countdown left in it still reads as a TIMELINE, or
 * wants different words at that heading. Glass, on a phone, and Aaron's.
 */

import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

/* data/home.js reads localStorage at module scope on first getHome(). */
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { buildHomeDashboard } = await import('../data/home-dashboard.js');
const { countdownHtml } = await import('../ui/countdown-home.js');

const FIX = fs.readFileSync('samples/bertha-al022026/fstadv-010.txt', 'utf8');

const ISSUED = '2026-07-21T21:00:00Z';
const NOW = Date.parse(ISSUED);

/** Transcribed from the fixture. Every row is grepped for below. */
const FORECAST = [
  { time: '2026-07-22T06:00:00Z', lat: 29.6, lon: -87.9, windKt: 45, tau: 9,
    line: 'FORECAST VALID 22/0600Z 29.6N  87.9W' },
  { time: '2026-07-22T18:00:00Z', lat: 29.5, lon: -89.3, windKt: 45, tau: 21,
    line: 'FORECAST VALID 22/1800Z 29.5N  89.3W' },
  { time: '2026-07-23T06:00:00Z', lat: 29.3, lon: -91.4, windKt: 40, tau: 33,
    line: 'FORECAST VALID 23/0600Z 29.3N  91.4W' },
  { time: '2026-07-23T18:00:00Z', lat: 29.4, lon: -93.4, windKt: 35, tau: 45,
    line: 'FORECAST VALID 23/1800Z 29.4N  93.4W' },
  { time: '2026-07-24T06:00:00Z', lat: 29.8, lon: -95.6, windKt: 30, tau: 57,
    line: 'FORECAST VALID 24/0600Z 29.8N  95.6W' },
  { time: '2026-07-24T18:00:00Z', lat: 30.3, lon: -97.6, windKt: 25, tau: 69,
    line: 'FORECAST VALID 24/1800Z 30.3N  97.6W' },
];

section('the fixture says what this suite claims it says');
ok(FIX.includes('TROPICAL STORM CENTER LOCATED NEAR 29.4N  87.2W AT 21/2100Z'),
   'fixture states the position this suite uses');
ok(FIX.includes('PRESENT MOVEMENT TOWARD THE NORTHWEST OR 305 DEGREES AT   5 KT'),
   'fixture states the heading and speed — without both, the storm lands on the '
   + '`track-unknown` rung and `far` is never true, which would make this whole suite vacuous');
for (const f of FORECAST) ok(FIX.includes(f.line), `fixture carries "${f.line}"`);
ok(FORECAST.length === (FIX.match(/^FORECAST VALID /gm) || []).length,
   'every FORECAST VALID line in the fixture is transcribed — none dropped');

const STORM = {
  id: 'nhc:al022026', source: 'nhc', sourceId: 'al022026', name: 'Bertha',
  basin: 'atlantic', lat: 29.4, lon: -87.2,
  windKt: 50, pressureMb: 995, headingDeg: 305, speedKt: 5,
  nature: 'tropical', category: 1, categorySource: 'derived',
  observedAt: ISSUED, advisoryKey: 'al022026-10',
  can: { forecastPoints: true },
};
const CURVE = FORECAST.map(({ line, ...p }) => ({
  ...p, category: p.windKt >= 34 ? 1 : 0, categorySource: 'reported',
  stormType: p.windKt >= 34 ? 'TS' : 'TD',
}));

const NEAR_HOME = { lon: -90.0715, lat: 29.9511, label: 'New Orleans, Louisiana', source: 'address' };
const FAR_HOME = { lon: 139.6917, lat: 35.6895, label: 'Tokyo, Japan', source: 'address' };

const dashFor = (home) =>
  buildHomeDashboard({ storm: STORM, forecast: CURVE, home, now: NOW, trackState: 'ok' });

/** Plain text of the rail, tags stripped, so an assertion reads the sentence a
 *  reader reads rather than the markup around it. */
const railText = (dash) =>
  countdownHtml(dash, () => 'imperial', (i, t) => `<h3>${t}</h3>`)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/* =========================================================================
 * 1. THE TWO HOMES LAND ON THE TWO RUNGS
 *
 * If this section is wrong nothing below means anything, so it is asserted
 * rather than assumed.
 * ====================================================================== */
section('the two homes land on the two rungs');

const near = dashFor(NEAR_HOME);
const far = dashFor(FAR_HOME);

ok(near.far === false, 'New Orleans is not far');
ok(near.stage === 'closing', `New Orleans is on the closing rung (got ${near.stage})`);
ok(far.far === true, 'Tokyo is far');
ok(far.stage === 'far-off',
   `Tokyo is on the far-off rung and NOT on track-unknown (got ${far.stage})`);
ok(far.approach?.relevant === false,
   'the whole remaining track was walked and judged irrelevant — which is what `far` means');

/* =========================================================================
 * 2. THE HISTORY SURVIVES THE DISTANCE
 *
 * The rail is built the same way for both homes; only its contents differ.
 * ====================================================================== */
section('the history survives the distance');

const nearText = railText(near);
const farText = railText(far);

ok(farText !== '', 'a far storm still has a rail');
ok(/Timeline/.test(farText), 'and it is still headed Timeline');
ok(/Weakens to a depression/.test(farText),
   `the class change is on it (got: ${farText})`);
ok(/Bertha is [\d,]+ mi \w+ of you/.test(farText),
   'and the live-distance row, which is the `now` divider, is on it too');

/* ==> THE CONTROL. <== Same milestone, near home, so the assertion above
 * cannot be satisfied by a suite that had broken class rows outright. */
ok(/Weakens to a depression/.test(nearText),
   'the same class change is on the near rail — the row is not far-only');

/* =========================================================================
 * 3. AND NOT ONE HOUSE-RELATIVE ROW COMES WITH IT
 *
 * ==> THIS IS THE HALF THAT REPLACES THE GUARD. <== Removing the fork is only
 * safe because every approach row gates itself. Each phrase below is asserted
 * ABSENT on the far rail and PRESENT on the near one, in pairs, because an
 * absence on its own proves nothing about whether the row can appear at all.
 * ====================================================================== */
section('and not one house-relative row comes with it');

const HOUSE_ROWS = [
  [/Closest pass/, 'the forecast closest pass'],
  [/Comes within [\d,]+ mi of you/, 'the near-ring arrival'],
  [/Back beyond [\d,]+ mi/, 'the near-ring exit'],
];

for (const [re, what] of HOUSE_ROWS) {
  ok(re.test(nearText), `${what} appears on the near rail`);
  ok(!re.test(farText), `${what} does NOT appear on the far rail`);
}

ok(!/reaches you/.test(farText),
   'no wind-arrival row on the far rail — the corridor produced nothing to arrive');
ok(!/The wind is past you/.test(farText),
   'and no all-clear either, which on a storm that was never near would be an answer to nothing');

/* =========================================================================
 * 4. THE SECTION ACTUALLY REACHES THE SCREEN
 *
 * ==> SECTIONS 2 AND 3 DRIVE `countdownHtml` DIRECTLY AND WOULD BOTH HAVE
 * PASSED WITH THE BUG STILL IN. <== The bug was never in the rail builder; it
 * was one ternary in `ui/view-home.js` throwing the builder's output away. So
 * the change is only actually proven by mounting the view and reading what
 * lands in the body.
 * ====================================================================== */
section('the section actually reaches the screen');

const { createHomeDashboardView } = await import('../ui/view-home.js');
const { setHome, clearHome } = await import('../data/home.js');
const { installFakeDocument, fakeHost } = await import('./fake-dom.mjs');

/* Rain has its own suite against real NWS bytes; here it only has to be WIRED
 * so the dashboard's own paths run with the section present. */
const RAIN_STUB = {
  loadRainfall: async () => ({ status: 'not_covered', payload: null, fetchedAt: null, stale: false }),
  retryRainfall: async () => ({ status: 'not_covered', payload: null, fetchedAt: null, stale: false }),
};

installFakeDocument();

const renderAt = async (home) => {
  setHome({ lon: home.lon, lat: home.lat, label: home.label, source: 'address' });
  const host = fakeHost();
  const v = createHomeDashboardView({
    units: () => 'imperial',
    onEditHome() {}, onOpenStorm() {},
    warmGeometry: async () => ({ state: 'ok', bundle: { forecast: CURVE }, error: null }),
    now: () => NOW,
    rain: RAIN_STUB,
  });
  v.mount(host);
  v.onEnter();
  v.update({ storms: [STORM], sources: { nhc: { status: 'ok' }, gdacs: { status: 'ok' } } });
  await new Promise((r) => setTimeout(r, 0));
  return host.read();
};

const farHtml = await renderAt(FAR_HOME);
const nearHtml = await renderAt(NEAR_HOME);
clearHome();

const plain = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const farPlain = plain(farHtml);
const nearPlain = plain(nearHtml);

ok(/Bertha/.test(farPlain), 'the far screen names the storm — the view rendered at all');
ok(/Timeline/.test(farPlain),
   'THE TIMELINE SECTION IS ON THE FAR SCREEN — this is the assertion the fix exists for');
ok(/Weakens to a depression/.test(farPlain),
   'and the storm history reached the body, not just the rail builder');
ok(/Timeline/.test(nearPlain), 'the near screen still has its Timeline');

/* ==> AND THE REST OF THE FORK IS UNTOUCHED. <== One arm of it came off; the
 * headline and the chart are still cut on a far storm and must stay cut.
 *
 * ==> THE PHRASE IS `of home` AND THAT IS NOT ARBITRARY. <== The first draft
 * of these two asserted on `Closest pass`, ran green, and was WORTHLESS: a far
 * storm's headline does not say `Closest pass`, it says *"On this forecast it
 * never comes near you"*, so removing the headline guard changed nothing the
 * assertion could see. Caught by mutating the guards out and watching the
 * suite stay green — 33 passed, which is the exact shape CLAUDE.md warns about.
 *
 * `of home` is the discriminator because the headline is the only thing on
 * this screen that says it. Every rail row says `of you`. So this pair goes
 * red the moment the HEADLINE stops forking, and it was verified doing so.
 *
 * ==> THE CHART ARM IS NOT COVERED HERE AND CANNOT BE. <== Mutating its guard
 * out leaves this suite green, because the chart is an SVG and emits no text
 * for a string assertion to catch. Said plainly rather than left as a gap
 * somebody later reads as coverage: if the chart ever needs a guard test it
 * is a Playwright check, not this file. */
const HEADLINE = /[\d,]+ mi \w+ of home/;
ok(!HEADLINE.test(farPlain),
   'the headline is still cut on the far screen');
ok(HEADLINE.test(nearPlain),
   'and still drawn on the near one — without this the line above proves nothing');

console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
