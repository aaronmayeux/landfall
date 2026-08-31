#!/usr/bin/env node
/**
 * test-season-clock.mjs — the season clock's arithmetic.
 * SPEC-SEASONS-BUILD.md §57.23, §57.67 slice A, §57.35 fault 3.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-season-clock.mjs`.
 *
 * ==> THE ONE ASSERTION THIS SUITE EXISTS FOR IS SECTION 1, AND IT IS ABOUT
 * UNITS. <== Step 10 shipped on 2026-08-26 and was reverted whole. One of its
 * three defects was a clock that paced itself on real elapsed milliseconds and
 * divided by a storm-time step of 8,640,000, so it owed its first step after
 * two and a half hours. **Both quantities were milliseconds and the arithmetic
 * was correct in isolation.** Nothing about it read as wrong, no test could see
 * it, and the console said nothing. So section 1 asserts the round trip in both
 * directions against a duration written out in words — one real second is one
 * storm day — and reversing the division anywhere in `lib/season-clock.js`
 * turns it red.
 *
 * ==> EVERY EXPECTATION IS COMPUTED OFF THE REAL FILE, NEVER TYPED. <==
 * `CLAUDE.md`'s first rule. The fixes, the timestamps and the winds all come
 * out of `samples/seasons/storms/`, so a test cannot pass by agreeing with a
 * number somebody remembered.
 *
 * WHAT THIS CANNOT PROVE: whether a season is worth watching, whether a day a
 * second is the right pace, or whether the globe holds frame rate. The first
 * two are glass and the third is a phone (`CLAUDE.md`).
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);
const near = (a, b, eps = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps;

const { parseHurdat2 } = await import('../lib/hurdat.js');
const { categoryFromKt } = await import('../lib/category.js');
const { SEASONS } = await import('../config/constants.js');
const {
  toStormMs, toRealMs, stepRealMs, clockSpan, stormStateAt, stormGrades, clockFrameAt, __internals,
} = await import('../lib/season-clock.js');

const one = (f) => parseHurdat2(readFileSync(`samples/seasons/storms/${f}.txt`, 'utf8')).storms[0];

const KATRINA = one('al122005');
const IDA = one('al092021');
const DELLA = one('cp011957');   /* the dateline storm */
const FIRST = one('al011851');   /* the oldest entry in the record */

const entry = (storm) => ({ storm, facts: {} });

/* A duration written out in the units a human uses, so section 1 is comparing
 * against words rather than against another copy of the same arithmetic. */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_SECOND_MS = 1000;

/* ========================================================================= */
section('1. ==> REAL TIME AND STORM TIME, THE FAULT THAT CAUSED THE REVERT <==');

ok(near(toStormMs(ONE_SECOND_MS), ONE_DAY_MS * SEASONS.clockDaysPerSecond),
  'one real second buys exactly clockDaysPerSecond days of storm time');
ok(near(toRealMs(ONE_DAY_MS * SEASONS.clockDaysPerSecond), ONE_SECOND_MS),
  'one day of storm time costs exactly one real second');
ok(near(toRealMs(toStormMs(12_345)), 12_345, 1e-6),
  'the round trip returns what went in');
ok(near(toStormMs(toRealMs(987_654_321)), 987_654_321, 1e-3),
  'and the round trip the other way round does too');

/* ==> THE SYMPTOM ASSERTION, NOT THE ARITHMETIC ONE. <== The reverted build's
 * first step was owed after roughly 2.4 HOURS. A test that only checks the
 * ratio is a test that agrees with whichever direction the code went; this one
 * asserts the consequence, in the shape a reader would have reported it. */
ok(toStormMs(stepRealMs()) > 0, 'a single step advances storm time at all');
ok(toRealMs(ONE_DAY_MS) < 60_000,
  'a storm day must not take a minute of real time — the reverted build made it 2.4 hours');
ok(stepRealMs() > 0 && stepRealMs() < 1000,
  'the loop asks more than once a second and less than a thousand times');
ok(near(stepRealMs(), 1000 / SEASONS.clockStepsPerSecond),
  'the step interval is the constant, not a literal');
ok(SEASONS.clockStepsPerSecond >= 8 && SEASONS.clockStepsPerSecond <= 12,
  'the step rate sits inside §57.35 fault 3\'s measured band');

ok(toStormMs(NaN) === 0 && toStormMs(undefined) === 0,
  'a broken elapsed time advances nothing rather than producing NaN');
ok(toRealMs(NaN) === 0, 'and the inverse refuses the same way');

/* ========================================================================= */
section('2. The span is the ticked storms\' own, not the calendar year');

const kPts = KATRINA.points.filter((p) => Number.isFinite(p.time));
const iPts = IDA.points.filter((p) => Number.isFinite(p.time));

const both = clockSpan([entry(KATRINA), entry(IDA)]);
ok(both !== null, 'two real storms produce a span');
ok(both.from === Math.min(kPts[0].time, iPts[0].time),
  'the span opens on the earlier storm\'s first fix');
ok(both.to === Math.max(kPts[kPts.length - 1].time, iPts[iPts.length - 1].time),
  'and closes on the later storm\'s last fix');
ok(both.spanMs === both.to - both.from, 'spanMs is the difference, not a second opinion');

/* ==> THE TWO SPANS MUST DIFFER, OR THIS SECTION PROVES NOTHING. <== Katrina is
 * 2005 and Ida is 2021, so a span over both is sixteen years wide and a span
 * over one is days. A build that ignored the argument entirely would pass a
 * comparison between two similar years. */
const kOnly = clockSpan([entry(KATRINA)]);
ok(kOnly.spanMs < both.spanMs / 100,
  'one storm\'s span is a tiny fraction of two storms sixteen years apart');
ok(kOnly.from === kPts[0].time && kOnly.to === kPts[kPts.length - 1].time,
  'one storm\'s span is exactly its own first and last fix');

ok(clockSpan([]) === null, 'nothing ticked, no timeline');
ok(clockSpan([entry({ points: [] })]) === null, 'a storm with no fixes contributes no timeline');
ok(clockSpan([entry(null), entry(KATRINA)]).from === kPts[0].time,
  'a null storm in the list is skipped rather than thrown over');

/* ==> THE FLOOR, AND THE SINGLE OBSERVATION SITS IN THE MIDDLE OF IT. <== */
const single = { id: 'X', points: [{ lat: 25, lon: -70, lonU: -70, time: Date.UTC(1900, 5, 1), windKt: 40, status: 'TS' }] };
const tiny = clockSpan([entry(single)]);
ok(near(tiny.spanMs, SEASONS.clockMinSpanDays * ONE_DAY_MS),
  'a one-fix storm is widened to the minimum span rather than left at zero');
ok(near((tiny.from + tiny.to) / 2, single.points[0].time),
  'and the observation sits at the midpoint, not pinned to the left edge');
ok(tiny.spanMs > 0, 'so nothing downstream can divide by a zero-length timeline');

ok(near(both.realMs, toRealMs(both.spanMs)),
  'the span reports how long it takes to watch, through the same conversion');

/* ========================================================================= */
section('3. Where one storm was — phases and positions');

const k0 = kPts[0];
const kLast = kPts[kPts.length - 1];

const before = stormStateAt(KATRINA, k0.time - ONE_DAY_MS);
ok(before.phase === 'unborn', 'before the first fix the storm is unborn');
ok(before.drawnFixes === 0, 'and nothing of its track has happened');
ok(before.lon === null && before.lat === null,
  'an unborn storm has no position — not a stub at its birthplace');

const at0 = stormStateAt(KATRINA, k0.time);
ok(at0.phase === 'running', 'at its first fix it is running');
ok(at0.drawnFixes === 1, 'one fix is behind it');
ok(at0.legFraction === 0, 'and it has travelled none of the next leg');
ok(at0.lon === k0.lonU && at0.lat === k0.lat,
  'its position is the recorded one exactly, with no interpolation drift');

const after = stormStateAt(KATRINA, kLast.time + ONE_DAY_MS);
ok(after.phase === 'ended', 'past the last fix it has ended');
ok(after.drawnFixes === kPts.length,
  `the whole track stays drawn — all ${kPts.length} fixes`);
ok(after.lon === kLast.lonU && after.lat === kLast.lat,
  'and it reports where it ended rather than nothing');

const atLast = stormStateAt(KATRINA, kLast.time);
ok(atLast.phase === 'ended', 'the last fix itself counts as ended, not as a final running step');

ok(stormStateAt(null, k0.time).phase === 'absent', 'a null storm is absent');
ok(stormStateAt({ points: [] }, k0.time).phase === 'absent', 'a storm with no fixes is absent');
ok(stormStateAt(KATRINA, NaN).phase === 'absent', 'a broken moment answers absent rather than throwing');

/* ========================================================================= */
section('4. Between two fixes — interpolation, and what refuses to interpolate');

/* The first leg of Katrina, driven at its exact midpoint. */
const a = kPts[0];
const b = kPts[1];
const mid = stormStateAt(KATRINA, (a.time + b.time) / 2);
ok(mid.phase === 'running', 'the midpoint of a leg is running');
ok(mid.drawnFixes === 1, 'one fix is complete behind it');
ok(near(mid.legFraction, 0.5), 'and it is half way along the leg');
ok(near(mid.lon, (a.lonU + b.lonU) / 2), 'longitude is the midpoint of the two records');
ok(near(mid.lat, (a.lat + b.lat) / 2), 'latitude is too');

if (Number.isFinite(a.windKt) && Number.isFinite(b.windKt)) {
  ok(near(mid.windKt, (a.windKt + b.windKt) / 2), 'wind slides between the two readings');
}
ok(stormStateAt(KATRINA, a.time).windKt === a.windKt,
  'and at a fix the wind is exactly what the record says');

/* ==> STATUS DOES NOT INTERPOLATE, AND THIS IS THE ASSERTION THAT SAYS SO.
 * <== `HU` nine tenths of the way to `EX` is not a thing. It holds until the
 * record changes it.
 *
 * ==> IT HAS TO RUN ON A LEG WHERE THE STATUS GENUINELY CHANGES, AND THE FIRST
 * VERSION OF THIS DID NOT. <== Katrina's opening leg is `TD` to `TD`, so an
 * assertion driven there compares a string to itself and stays green with the
 * rule deleted — the exact failure §12 calls worse than no test. The mutation
 * run on 2026-08-31 caught it. The leg is FOUND rather than typed, so a
 * revision to the file cannot quietly turn this back into a tautology. */
const changeIdx = kPts.findIndex((p, i) => (
  i + 1 < kPts.length && kPts[i + 1].status && p.status !== kPts[i + 1].status
));
ok(changeIdx >= 0, 'Katrina changes status somewhere in the file, so this is testable');
const ca = kPts[changeIdx];
const cb = kPts[changeIdx + 1];
const late = stormStateAt(KATRINA, ca.time + (cb.time - ca.time) * 0.9);
ok(late.status === ca.status,
  `nine tenths from ${ca.status} to ${cb.status} the status is still ${ca.status}`);
ok(late.status !== cb.status, 'and it is emphatically not the one it is heading toward');
ok(late.drawnFixes === changeIdx + 1, 'and the fix count has not advanced early');

/* Every fix in turn: the index must be right and the position exact. */
let indexOk = true;
let exactOk = true;
for (let i = 0; i < kPts.length - 1; i++) {
  const s = stormStateAt(KATRINA, kPts[i].time);
  if (s.drawnFixes !== i + 1) indexOk = false;
  if (s.lon !== kPts[i].lonU || s.lat !== kPts[i].lat) exactOk = false;
}
ok(indexOk, `every one of Katrina's ${kPts.length} fixes lands on its own index`);
ok(exactOk, 'and every one reports its own recorded position');

/* ==> TWO FIXES SHARING A TIMESTAMP MUST NOT PRODUCE INFINITY. <== They are
 * real: ATCF writes one line per wind threshold and a merge that fails leaves
 * two.
 *
 * ==> AND THIS ASSERTS THE OUTCOME RATHER THAN THE GUARD, BECAUSE THE MUTATION
 * RUN PROVED IT CANNOT REACH THE GUARD. <== Deleting `lib/season-clock.js`'s
 * `legMs > 0` check leaves this suite green, and the reason is the scan above
 * it: the loop walks PAST every fix whose time is at or before the moment, so
 * the fix it stops on can never share a timestamp with the one after it. The
 * check is unreachable by construction today and is kept as a floor under a
 * second source arriving (step 13), not because anything here exercises it.
 * Saying so is the point — a comment claiming this case drives that line would
 * be a false statement about coverage. */
const dup = {
  id: 'D',
  points: [
    { lat: 20, lon: -60, lonU: -60, time: 1000, windKt: 40, status: 'TS' },
    { lat: 21, lon: -61, lonU: -61, time: 1000, windKt: 50, status: 'TS' },
    { lat: 22, lon: -62, lonU: -62, time: 2000, windKt: 60, status: 'HU' },
  ],
};
const dupState = stormStateAt(dup, 1000);
ok(Number.isFinite(dupState.lon) && Number.isFinite(dupState.lat),
  'two fixes sharing a timestamp produce a real position, not Infinity');
ok(Number.isFinite(dupState.legFraction), 'and a real fraction');

/* ========================================================================= */
section('5. The antimeridian — the head must not go the long way round');

const dPts = DELLA.points.filter((p) => Number.isFinite(p.time));
ok(dPts.some((p) => Math.abs(p.lon) > 170),
  'Della is genuinely out at the seam, so this section is testing something');
ok(dPts.some((p) => p.lonU !== p.lon),
  'and her continuous longitude has actually left her published one');

/* Walk her whole life in small steps and assert the head never teleports. A
 * build interpolating raw `lon` instead of `lonU` jumps ~360° at the seam. */
let biggestJump = 0;
let prevLon = null;
const steps = 400;
for (let i = 0; i <= steps; i++) {
  const t = dPts[0].time + ((dPts[dPts.length - 1].time - dPts[0].time) * i) / steps;
  const s = stormStateAt(DELLA, t);
  if (prevLon !== null && Number.isFinite(s.lon)) {
    biggestJump = Math.max(biggestJump, Math.abs(s.lon - prevLon));
  }
  if (Number.isFinite(s.lon)) prevLon = s.lon;
}
ok(biggestJump < 5,
  `Della's head moves continuously across the date line — biggest step ${biggestJump.toFixed(3)}°`);

/* ========================================================================= */
section('6. Grading — the same rule the globe\'s dots use, and no colour');

const kMid = stormStateAt(KATRINA, (a.time + b.time) / 2);
ok(!('color' in kMid), 'the engine answers no colour — that is the palette\'s business');
ok(typeof kMid.nature === 'string', 'it answers a nature');

/* A fix where Katrina was a real hurricane, found rather than remembered. */
const hu = kPts.find((p) => p.status === 'HU' && Number.isFinite(p.windKt));
ok(!!hu, 'Katrina has a hurricane fix in the file to test against');
if (hu) {
  const s = stormStateAt(KATRINA, hu.time);
  ok(s.nature === 'tropical', 'a HU fix grades as a tropical cyclone');
  ok(s.category === categoryFromKt(hu.windKt),
    `and its category is categoryFromKt's answer for ${hu.windKt} kt, not a second opinion`);
}

/* A non-cyclone fix gets no Saffir-Simpson number at all. */
const notTc = kPts.find((p) => p.status === 'EX' || p.status === 'LO' || p.status === 'DB' || p.status === 'WV');
if (notTc) {
  const s = stormStateAt(KATRINA, notTc.time);
  ok(s.category === null,
    `a ${notTc.status} fix earns no category, however hard the wind was blowing`);
} else {
  ok(true, 'Katrina carries no non-cyclone fix — nothing to assert here');
}

const grades = stormGrades(KATRINA);
ok(grades.length === kPts.length, 'stormGrades answers once per usable fix');
ok(grades.every((g, i) => g.time === kPts[i].time), 'in time order, matching the record');
ok(grades.some((g) => g.category !== null), 'and at least one of Katrina\'s fixes is graded');

/* ==> THE COLOURS ALONG THE TRACK MUST ACTUALLY CHANGE, OR THE FEATURE IS THE
 * PEAK COLOUR WEARING A DIFFERENT NAME. <== */
const distinct = new Set(grades.map((g) => `${g.nature}:${g.category}`));
ok(distinct.size > 1,
  `Katrina's track passes through ${distinct.size} different grades, so per-fix colouring says something`);

ok(stormGrades(null).length === 0, 'no storm, no grades');
ok(stormGrades({ points: [] }).length === 0, 'no fixes, no grades');

/* ========================================================================= */
section('7. Which way it spins');

ok(stormStateAt(KATRINA, hu ? hu.time : k0.time).spin === 1,
  'an Atlantic storm spins counter-clockwise');

/* ==> CONSTRUCTED, BECAUSE THE ARCHIVE HAS NO SOUTHERN STORM IN IT YET. <==
 * Every storm here is Atlantic or East Pacific, so a hardcoded direction would
 * look right until step 13 brings IBTrACS. */
const southern = {
  id: 'S',
  points: [
    { lat: -15, lon: 120, lonU: 120, time: 1000, windKt: 60, status: 'HU' },
    { lat: -18, lon: 118, lonU: 118, time: 21_600_000, windKt: 70, status: 'HU' },
  ],
};
ok(stormStateAt(southern, 1000).spin === -1,
  'a southern-hemisphere storm spins clockwise');
ok(__internals.spinSign(0) === 1, 'the equator resolves rather than returning nothing');

/* ========================================================================= */
section('8. Heading — which way the head is pointing');

const head = stormStateAt(KATRINA, (a.time + b.time) / 2);
ok(Number.isFinite(head.headingDeg) && head.headingDeg >= 0 && head.headingDeg < 360,
  'a running head carries a bearing in degrees');
ok(before.headingDeg === null, 'an unborn storm carries no bearing');

/* A storm moving due east must read 90°, within the spherical correction. */
const due = {
  id: 'E',
  points: [
    { lat: 0, lon: 0, lonU: 0, time: 0, windKt: 50, status: 'TS' },
    { lat: 0, lon: 5, lonU: 5, time: 21_600_000, windKt: 50, status: 'TS' },
  ],
};
ok(near(stormStateAt(due, 10_800_000).headingDeg, 90, 0.01),
  'a storm running due east along the equator reads 90°');

/* ========================================================================= */
section('9. One frame, every ticked storm');

const frame = clockFrameAt([entry(KATRINA), entry(IDA), entry({ id: 'EMPTY', points: [] })], k0.time);
ok(frame.at === k0.time, 'the frame reports the moment it was asked for');
ok(frame.storms.length === 3,
  'every ticked storm is in the answer, including the one with no fixes');
ok(frame.storms[0].state.phase === 'running', 'Katrina is running at her own first fix');
ok(frame.storms[1].state.phase === 'unborn', 'Ida, sixteen years later, has not been born');
ok(frame.storms[2].state.phase === 'absent', 'and the empty storm is absent rather than missing');
ok(frame.storms[0].id === KATRINA.id, 'each answer carries its storm\'s id');
ok(clockFrameAt([], 0).storms.length === 0, 'an empty tick list is an empty frame');

/* ==> A FRAME AT THE VERY END OF THE SPAN LEAVES EVERY TRACK COMPLETE. <== The
 * accumulation is the point of the feature (§57.23): running the clock to the
 * end must leave the reader looking at the whole season, not at an empty
 * globe. */
const endFrame = clockFrameAt([entry(KATRINA), entry(IDA)], both.to);
ok(endFrame.storms.every((s) => s.state.phase === 'ended'),
  'at the end of the span every storm has ended');
ok(endFrame.storms[0].state.drawnFixes === kPts.length
  && endFrame.storms[1].state.drawnFixes === iPts.length,
  'and every track is drawn in full');

/* ==> AND A FRAME AT THE VERY START DRAWS ALMOST NOTHING. <== The opposite
 * failure is the one the reverted build actually shipped: a globe that opens
 * on the clock's first moment is empty, which read as broken. */
const startFrame = clockFrameAt([entry(KATRINA), entry(IDA)], both.from);
const drawnAtStart = startFrame.storms.reduce((n, s) => n + s.state.drawnFixes, 0);
ok(drawnAtStart <= 1,
  `at the first moment of the span at most one fix exists (${drawnAtStart}) — which is why static tracks stay the default`);

/* ========================================================================= */
section('10. The oldest and thinnest entries in the record');

const fPts = FIRST.points.filter((p) => Number.isFinite(p.time));
ok(fPts.length >= 1, `AL011851 has ${fPts.length} usable fixes`);
const firstSpan = clockSpan([entry(FIRST)]);
ok(firstSpan !== null && firstSpan.spanMs > 0,
  'the first storm in the record gets a timeline with length');
const firstState = stormStateAt(FIRST, fPts[0].time);
ok(firstState.phase === 'running' || firstState.phase === 'ended',
  'and it has a state at its own first fix');
ok(!Number.isNaN(firstState.lon) && !Number.isNaN(firstState.lat),
  'with a position that is a number rather than NaN');

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
