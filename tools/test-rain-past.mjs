#!/usr/bin/env node
/**
 * test-rain-past.mjs — §56.14's acceptance cases against real bytes.
 *
 * WHAT THIS IS FOR. The Flooding section gained a figure for rain that has
 * ALREADY FALLEN at the reader's address — the only flood-relevant number this
 * project has found that covers the whole planet (§48.15 records that the
 * alert rows stop dead at the American border and always will). It is one
 * extra query parameter on a route this app already owns, and everything that
 * could go wrong with it is silent.
 *
 * ==> THE BYTES ARE THE ARCHIVE RUNNER'S OWN PROBE, NOT A FIXTURE ANYBODY
 * WROTE. <== `samples/rain/openmeteo-manila-past-days.json` is
 * `geometry/openmeteo-rain-past-days-probe.json` off the `archive` branch,
 * frozen because that window is 72 hours and rolls. It is the SAME point and
 * the SAME hour as `openmeteo-manila-ph.json` beside it, with `past_days`
 * added and nothing else changed — so the two diff cleanly and the delta is
 * the measurement: 72 hourly values became 120, exactly 48 prepended, in the
 * same array.
 *
 * ==> THE TRAP IS THAT THE PAST/FUTURE BOUNDARY IS NOT MARKED ANYWHERE IN THE
 * BODY, AND EVERY WRONG ANSWER LOOKS RIGHT. <== Measured: no second array, no
 * flag, no gap, no duplicate timestamp. The boundary has to be found against
 * the clock. Three ways to get that wrong, none of which throws:
 *
 *   1. Anchoring the past window on where the prepended block ENDS. That is
 *      00:00 UTC today, which is up to 24 hours before `now`, so hours that
 *      have genuinely elapsed get counted as forecast and the past total comes
 *      out quietly small.
 *   2. Overlapping the two halves — "starts before now" instead of "ends at or
 *      before now" — which puts the block containing this moment in BOTH
 *      totals and shows a reader rain that has both fallen and not yet fallen.
 *   3. Anchoring the window on `blocks[0]` the way the forward window does.
 *      Correct there, wrong here: Open-Meteo prepends whole UTC days, so how
 *      far back the series reaches swings by 24 hours through the UTC day and
 *      two readers an hour apart would get figures measured over different
 *      periods with neither sentence wrong. §56.14 rejects exactly that.
 *
 * ==> AND THE ONE THAT IS NOT ARITHMETIC: A DRY WINDOW AND A FAILED FETCH MUST
 * NOT RENDER THE SAME (§5, §56.14's second rule). <== Asserted below as a
 * property of the STATES rather than of the words, because the words are the
 * caller's.
 *
 * ==> EVERY ASSERTION HERE WAS VERIFIED TO FAIL WITH THE RULE BROKEN. <==
 * SPEC §12. The mutations run are listed at the foot of this file.
 *
 * ==> THE CLOCK IS PINNED AND THAT IS THE WHOLE POINT OF THIS SUITE. <== Every
 * figure below is a function of `now` against a frozen series. A suite that
 * used the real clock would pass today and go red tomorrow with nothing
 * changed.
 *
 * Zero dependencies. Run: node tools/test-rain-past.mjs
 */

process.env.TZ = 'UTC';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'samples/rain');

const {
  readSeries, pastBlocks, pastWindowBlocks, futureBlocks, pastSummary, rainSummary,
} = await import(path.join(ROOT, 'lib/rainfall.js'));
const { projectOpenMeteo } = await import(path.join(ROOT, 'functions/api/rain/global.js'));
const { RAIN } = await import(path.join(ROOT, 'config/constants.js'));

let failures = 0;
const ok = (label) => console.log(`  \u2713 ${label}`);
const fail = (label, detail) => {
  failures++;
  console.error(`  \u2717 ${label}${detail ? `\n      ${detail}` : ''}`);
};
const truthy = (label, v) => (v ? ok(label) : fail(label, `expected truthy, got ${JSON.stringify(v)}`));
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  a === e ? ok(label) : fail(label, `expected ${e}\n      actual   ${a}`);
};
const close = (label, actual, expected) =>
  Math.abs(actual - expected) < 0.0005
    ? ok(label)
    : fail(label, `expected ${expected}\n      actual   ${actual}`);

const raw = JSON.parse(
  readFileSync(path.join(SAMPLES, 'openmeteo-manila-past-days.json'), 'utf8')
);
/* ==> THE PAIR HAS TO BE FROM ONE RUN, AND THE FIRST VERSION OF THIS SUITE GOT
 * IT WRONG. <== `openmeteo-manila-ph.json` beside these is the ORIGINAL §48.14
 * capture from 2026-08-19, five days older, so at this suite's pinned clock its
 * whole forecast has elapsed and `rainSummary` correctly returns `lapsed` with
 * no total at all. Diffing against it measured nothing and the two assertions
 * that used it failed with `expected undefined` — which is the failure doing
 * its job. `openmeteo-manila-no-past.json` is the SAME request, the SAME point
 * and the SAME runner pass as the past-days probe, with `past_days` the only
 * difference. Both end at 2026-08-26T23:00. */
const baseline = JSON.parse(
  readFileSync(path.join(SAMPLES, 'openmeteo-manila-no-past.json'), 'utf8')
);

const payload = projectOpenMeteo({ body: raw, fetchedAt: '2026-08-24T01:48:58Z' });

/* The moment the runner took the capture. Every figure below hangs off it. */
const NOW = Date.parse('2026-08-24T01:48:58Z');

console.log('\nTHE SHAPE OF THE PAYLOAD — measured, not assumed');

const series = readSeries(payload);
eq('the series reads', series.state, 'ok');
eq('120 blocks — 72 forecast plus 48 prepended', series.blocks.length, 120);

/* ==> THE PAST HOURS ARRIVE IN THE SAME ARRAY. <== §56.14's question 1, and
 * the spec says in as many words DO NOT ASSUME THE ARRAY IS SIMPLY LONGER.
 * This is the assertion that it is. */
eq('no second series key appeared', Object.keys(raw.hourly).sort(), ['precipitation', 'time']);
eq('one value per timestamp', raw.hourly.time.length, raw.hourly.precipitation.length);

/* ==> NO DUPLICATE TIMESTAMP MEANS THE HOUR CONTAINING `now` IS COUNTED ONCE.
 * <== §56.14's question 2, second half. If Open-Meteo repeated the join hour
 * across the two halves, every total in this app would double-count it. */
eq('no repeated hour', new Set(raw.hourly.time).size, raw.hourly.time.length);

let gaps = 0;
for (let i = 1; i < series.blocks.length; i++) {
  if (series.blocks[i].startMs !== series.blocks[i - 1].endMs) gaps++;
}
eq('no gap between blocks', gaps, 0);

/* The baseline is the SAME request without `past_days`. Its whole window has
 * to be inside the longer one, or the two are not comparable and the delta
 * measures nothing. */
const longTimes = new Set(raw.hourly.time);
eq(
  'every baseline hour is present in the longer series',
  baseline.hourly.time.filter((t) => longTimes.has(t)).length,
  baseline.hourly.time.length
);
eq('and it is exactly 48 hours longer', raw.hourly.time.length - baseline.hourly.time.length, 48);

console.log('\nTHE SPLIT — past and future are complements, never overlapping');

const behind = pastBlocks(series.blocks, NOW);
const ahead = futureBlocks(series.blocks, NOW);

/* ==> THE PROPERTY THAT MAKES DOUBLE-COUNTING IMPOSSIBLE. <== Every block is
 * in exactly one list. Asserted as arithmetic rather than by inspection so
 * that a future edit to either filter cannot quietly break it. */
eq('every block lands in one half or the other', behind.length + ahead.length, series.blocks.length);
const overlap = behind.filter((b) => ahead.includes(b)).length;
eq('and none lands in both', overlap, 0);

/* ==> THE BLOCK CONTAINING `now` BELONGS TO THE FUTURE. <== 01:48Z sits inside
 * the 01:00 block, which is still partly ahead of the reader. `futureBlocks`
 * keeps it whole rather than prorating (§48.19), so the past must NOT take it.
 * This is mutation 2's assertion. */
const straddling = series.blocks.find((b) => b.startMs <= NOW && b.endMs > NOW);
truthy('a block does straddle this moment', !!straddling);
eq('the past does not claim it', behind.includes(straddling), false);
eq('the future does', ahead.includes(straddling), true);

/* ==> AND THE FORECAST HALF STARTS BEFORE `now`, WHICH IS THE WHOLE REASON THE
 * WINDOW IS ANCHORED ON THE CLOCK. <== The prepended hours end at 00:00 UTC
 * today; `now` is 01:48Z. Two hours of "forecast" have already elapsed. A past
 * window anchored on where the prepended block ends would silently drop them.
 * This is mutation 1's assertion. */
const firstForecastMs = Date.parse('2026-08-24T00:00:00Z');
const elapsedInForecastHalf = series.blocks.filter(
  (b) => b.startMs >= firstForecastMs && b.endMs <= NOW
).length;
eq('one whole forecast hour has already elapsed', elapsedInForecastHalf, 1);
eq('and the past half counts it', behind.filter((b) => b.startMs >= firstForecastMs).length, 1);

console.log('\nTHE WINDOW — anchored on the clock, never on the series');

const win = pastWindowBlocks(series.blocks, NOW, 48);
truthy('a 48-hour window has blocks', win.length > 0);
eq('and none of them ends after now', win.filter((b) => b.endMs > NOW).length, 0);
eq(
  'and none of them ends more than 48 hours back',
  win.filter((b) => b.endMs <= NOW - 48 * 3600 * 1000).length,
  0
);

/* ==> THE NEAR EDGE IS THE CLOCK, AND THIS SUITE SHIPPED WITHOUT ASSERTING IT.
 * <== The first version of this file checked the window's FAR edge four
 * different ways and never once checked the near one, so mutation 1 —
 * anchoring the window on where the prepended half ends instead of on `nowMs`
 * — ran all-green. That mutation silently drops the forecast hours that have
 * already elapsed, up to 24 of them depending on the time of day, and the
 * total it produces is smaller and entirely plausible. §12: a test that passes
 * on the same wrong assumption as the bug is worse than no test.
 *
 * The assertion that closes it is that the window and the UNBOUNDED past agree
 * about where the recent end is. They are computed by different functions with
 * different filters, so they can only agree if both are reading the clock. */
truthy('the unbounded past has blocks to compare against', behind.length > 0);
eq('the window ends where the unbounded past ends', win.at(-1).endMs, behind.at(-1).endMs);

/* ==> AND THE SECOND HALF OF THE SAME HOLE: THE ELAPSED FORECAST HOUR MUST BE
 * INSIDE THE WINDOW, NOT MERELY INSIDE `pastBlocks`. <== The hour from
 * 00:00Z to 01:00Z today is published in the FORECAST half of the series and
 * has already happened. It is the single hour mutation 1 loses, and the one a
 * reader would most notice missing, since it is the most recent rain there is. */
eq(
  'the window contains the forecast hour that has already elapsed',
  win.filter((b) => b.startMs >= firstForecastMs).length,
  1
);

/* ==> A SHORTER WINDOW IS A SUBSET OF A LONGER ONE. <== Mutation 3's
 * assertion: if the window were anchored on `blocks[0]` instead of on the
 * clock, shrinking `hours` would move the window's FAR end and this would
 * fail. */
const win12 = pastWindowBlocks(series.blocks, NOW, 12);
eq('12 hours is a subset of 48', win12.every((b) => win.includes(b)), true);
truthy('and strictly smaller', win12.length < win.length);

/* ==> AND IT MOVES WITH THE CLOCK, NOT WITH THE DATA. <== The same series read
 * an hour later covers a different 48 hours. A window anchored on `blocks[0]`
 * would return an identical list here. */
const winLater = pastWindowBlocks(series.blocks, NOW + 3600 * 1000, 48);
truthy('an hour later the window is not the same list',
  JSON.stringify(winLater.map((b) => b.startMs)) !== JSON.stringify(win.map((b) => b.startMs)));

console.log('\nTHE TOTALS — and they are never the same number as the forecast');

const past = pastSummary(payload, { system: 'imperial', now: NOW, hours: 48 });
eq('state is ok', past.state, 'ok');
truthy('a total came back', Number.isFinite(past.totalMm));
truthy('and it is printed', !!past.totalText);

const winMm = win.reduce((s, b) => s + b.mm, 0);
close('the summary total is the window total', past.totalMm, winMm);

/* ==> THE ONE RULE §56.14 SAYS A LATER SESSION WILL BREAK. <== The past total
 * is never summed into the forecast total. Asserted as two independent
 * numbers computed from disjoint blocks — if anybody ever adds a `totalMm`
 * that spans both, this goes red. */
const fore = rainSummary(payload, { system: 'imperial', now: NOW });
eq('the forecast half still reads ok', fore.state, 'ok');
const aheadMm = ahead.reduce((s, b) => s + b.mm, 0);
close('the forecast total is drawn only from blocks still ahead', fore.totalMm, aheadMm);
truthy('the two totals are different numbers', Math.abs(fore.totalMm - past.totalMm) > 0.0005);

/* ==> AND ADDING `past_days` CHANGED NOTHING THE RAIN SECTION SHOWS. <== The
 * whole safety argument for putting this on the shared route: `futureBlocks`
 * throws the new hours away before any forecast figure is summed. Run the
 * SHORTER capture through the same reader at the same moment and the forecast
 * total must be identical. */
const foreBaseline = rainSummary(
  projectOpenMeteo({ body: baseline, fetchedAt: '2026-08-24T01:48:58Z' }),
  { system: 'imperial', now: NOW }
);
close('the forecast total is unchanged by the longer series', fore.totalMm, foreBaseline.totalMm);
eq('and so is the through label', fore.throughWords, foreBaseline.throughWords);

console.log('\nTHE HOURS ACTUALLY COVERED — never the window asked for');

truthy('coveredHours is reported', Number.isFinite(past.coveredHours));

/* ==> THIS ASSERTION FOUND A REAL BUG AND IT IS WORTH SAYING WHICH. <== The
 * window keeps a block straddling its far edge (splitting invents a rate), so
 * the oldest hourly block in hand begins up to 59 minutes before the window.
 * Uncapped, `coveredHours` reported 49 for a 48-hour window — an odd number on
 * screen and a claim to a wider period than was asked for. It is capped now,
 * and the cap is one-directional: never more than asked, always less when the
 * data does not reach. */
eq('and it never exceeds the window asked for', past.coveredHours, 48);
truthy('the oldest block really does straddle the far edge',
  win[0].startMs < NOW - 48 * 3600 * 1000);

/* A window longer than the series reaches back must report what it HAS. §48.11
 * at the other end: claiming a period we have no numbers for is the same class
 * of error as an undated stale reading. */
const deep = pastSummary(payload, { system: 'imperial', now: NOW, hours: 240 });
truthy('a 10-day window still answers', deep.state === 'ok' || deep.state === 'dry');
truthy('and reports fewer hours than it asked for', deep.coveredHours < 240);

console.log('\nDRY, UNSUPPORTED AND UNREADABLE ARE THREE DIFFERENT ANSWERS');

/* ==> DRY IS A REAL ANSWER AND A FAILED FETCH IS NOT (§56.14 rule 2, §5). <==
 * A source that answered with almost nothing gets a plain sentence. A fetch
 * that failed never reaches this function at all — there is no payload — so
 * these states can never be confused. Asserted by driving a genuinely dry
 * series through it. */
const dryBody = {
  ...raw,
  hourly: { time: raw.hourly.time, precipitation: raw.hourly.time.map(() => 0) },
};
const dry = pastSummary(
  projectOpenMeteo({ body: dryBody, fetchedAt: '2026-08-24T01:48:58Z' }),
  { system: 'imperial', now: NOW, hours: 48 }
);
eq('an all-zero series is dry, not lapsed and not unreadable', dry.state, 'dry');
close('and its total really is zero', dry.totalMm, 0);

/* A trace below the negligible threshold is dry too — the identical judgement
 * `RAIN.negligibleMm` already makes for the forecast (§48.8). */
const traceMm = (RAIN.negligibleMm - 0.5) / 48;
const traceBody = {
  ...raw,
  hourly: { time: raw.hourly.time, precipitation: raw.hourly.time.map(() => traceMm) },
};
const trace = pastSummary(
  projectOpenMeteo({ body: traceBody, fetchedAt: '2026-08-24T01:48:58Z' }),
  { system: 'imperial', now: NOW, hours: 48 }
);
eq('a trace under the threshold is dry', trace.state, 'dry');
truthy('and it did not come back as zero', trace.totalMm > 0);

/* ==> AN NWS PAYLOAD HAS NO PAST HALF AT ALL, AND THAT IS A FACT ABOUT THE
 * SOURCE. <== `quantitativePrecipitation` is a forecast grid; there is no
 * matching observed series (§56.14). It must not read as `lapsed`, which
 * invites a reader to wait for hours that are never coming. */
const nws = JSON.parse(readFileSync(path.join(SAMPLES, 'grid-hilo-hi.json'), 'utf8'));
const nwsPayload = {
  status: 'ok',
  uom: 'wmoUnit:mm',
  values: nws?.properties?.quantitativePrecipitation?.values || [],
  alerts: [],
};
truthy('the NWS fixture has a real series', nwsPayload.values.length > 0);
const unsup = pastSummary(nwsPayload, { system: 'imperial', now: NOW, hours: 48 });
eq('an NWS payload is unsupported, never lapsed', unsup.state, 'unsupported');

/* ==> AND A GLOBAL PAYLOAD WHOSE PAST HAS AGED OUT IS `lapsed`, WHICH IS A
 * DIFFERENT FACT. <== Reachable on a last-good body six hours old (the edge
 * cache's own hold) plus a window that no longer reaches it. */
const lapsed = pastSummary(payload, {
  system: 'imperial',
  now: Date.parse('2026-09-01T00:00:00Z'),
  hours: 48,
});
eq('a series entirely older than the window is lapsed', lapsed.state, 'lapsed');

/* An unreadable body is neither. */
const unreadable = pastSummary(
  { status: 'ok', provider: 'open-meteo', uom: 'wmoUnit:furlongs', values: [{ validTime: 'x/PT1H', value: 1 }] },
  { system: 'imperial', now: NOW, hours: 48 }
);
eq('an unrecognised unit is unreadable', unreadable.state, 'unreadable');

console.log('\nTHE CLOCK IS REQUIRED, AND ITS ABSENCE IS AN EMPTY PAST');

/* ==> `futureBlocks` RETURNS EVERYTHING WHEN IT CANNOT TELL THE TIME; THIS
 * MUST NOT. <== The same default here would report a five-day FORECAST as rain
 * that has already fallen. Opposite directions, and only one of them is safe.
 */
eq('an unknown clock yields no past blocks', pastBlocks(series.blocks, NaN).length, 0);
eq('and the forward twin still returns everything', futureBlocks(series.blocks, NaN).length, 120);
eq('an unknown clock yields no window', pastWindowBlocks(series.blocks, NaN, 48).length, 0);

console.log('\nCONSTANTS');

eq('RAIN.pastHours is the window the section asks for', RAIN.pastHours, 48);
/* ==> `pastDays` IS DELIBERATELY MORE THAN `pastHours` ROUNDS TO. <== The
 * series is prepended in whole UTC days, so asking for exactly two would leave
 * the 48-hour window short for most of the UTC day and the figure would
 * quietly shrink. */
truthy('and pastDays over-asks so the window is always complete',
  RAIN.pastDays * 24 > RAIN.pastHours);

console.log(
  failures ? `\n${failures} failing assertion(s)\n` : '\nall past-rainfall assertions pass\n'
);
process.exit(failures ? 1 : 0);

/* ---------------------------------------------------------------------------
 * MUTATIONS VERIFIED RED — SPEC §12. Each was reintroduced and this suite
 * confirmed to fail on it before being reverted.
 *
 *  1. `pastWindowBlocks` anchored on the end of the prepended half
 *     (`firstForecastMs`) instead of on `nowMs` — the elapsed forecast hour is
 *     dropped and "the past half counts it" goes red.
 *  2. `pastBlocks` filtering `b.startMs < nowMs` instead of `b.endMs <= nowMs`
 *     — the straddling block lands in both halves and "and none lands in both"
 *     goes red.
 *  3. `pastWindowBlocks` anchored on `blocks[0].startMs` the way `windowBlocks`
 *     is — "an hour later the window is not the same list" goes red.
 *  4. `pastSummary` reading the series before checking the provider — the NWS
 *     fixture returns `lapsed` and "an NWS payload is unsupported" goes red.
 *  5. `pastBlocks` returning all blocks on a non-finite clock, mirroring
 *     `futureBlocks` — "an unknown clock yields no past blocks" goes red.
 *  6. `pastSummary` returning `state: 'ok'` regardless of `RAIN.negligibleMm`
 *     — both dry assertions go red.
 *  7. `past_days` removed from the route's upstream URL. ==> THIS SUITE
 *     CANNOT CATCH IT AND THAT IS BY CONSTRUCTION, NOT AN OVERSIGHT. <== The
 *     frozen sample still carries its 120 hours whatever the live route asks
 *     for, so every assertion here stays green while the shipping app reports
 *     "no estimate available" on every house on Earth. Nothing throws. It is
 *     caught by `tools/test-relay-mirrors.mjs`, which asserts that `PAST_DAYS`
 *     is not merely declared but actually spent on the URL — added in this
 *     same pass, because the gate did not previously cover this route at all,
 *     and verified by removing the parameter and watching it go red.
 *  8. `coveredHours` uncapped — it reports 49 for a 48-hour window and "it
 *     never exceeds the window asked for" goes red. This is the bug the suite
 *     found for real rather than one reintroduced afterwards.
 *
 * ==> AND ONE HOLE THIS SUITE SHIPPED WITH BEFORE IT WAS CLOSED, RECORDED SO
 * THE LESSON SURVIVES THE FIX. <== The first version asserted the window's FAR
 * edge four ways and never its NEAR one, so mutation 1 ran ALL-GREEN — the
 * exact failure §12 calls worse than no test, over the exact bug this file
 * exists to prevent. Two assertions closed it: that the window and the
 * unbounded past agree where the recent end is, and that the already-elapsed
 * forecast hour is inside the window. A window check needs both edges pinned.
 * ------------------------------------------------------------------------ */
