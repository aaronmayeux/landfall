#!/usr/bin/env node
/**
 * test-rainfall.mjs — §48's acceptance cases against real captured bytes.
 *
 * WHAT THIS IS FOR. §48 has two traps that both PARSE and neither of which
 * throws: the units are millimetres while the advisory beside them is written
 * in inches, and `validTime` is an interval rather than a timestamp. Getting
 * either wrong produces a plausible number on the page and no error anywhere.
 * A hand-written fixture cannot catch that, because a hand-written fixture is
 * written by whoever also wrote the bug. So every figure below is computed
 * from bytes NWS actually served, captured by the §48.13 probe on
 * 2026-08-16T01:49Z and copied into `samples/rain/`.
 *
 * ==> THE CLOCK AND THE ZONE ARE BOTH PINNED. <== The "through" label is the
 * reader's own local day, and the acceptance case is that Hilo's series must
 * read as Thursday. In Honolulu it is; in London the same instant is Thursday
 * afternoon and in Sydney it is Friday. TZ is forced before the first Date is
 * built and the suite refuses to run if the pin did not take.
 *
 * Zero dependencies. Run: node tools/test-rainfall.mjs
 */

process.env.TZ = 'Pacific/Honolulu';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'samples/rain');

const {
  parseDuration, parseInterval, readSeries, windowTotalMm, windowBlocks,
  peakBlock, formatRainTotal, floodAlerts, rainSummary, houseRainInRange,
  futureBlocks, houseRainScope, remainingWords,
} = await import(path.join(ROOT, 'lib/rainfall.js'));
const { RAIN, APPROACH } = await import(path.join(ROOT, 'config/constants.js'));
const { reachesHome } = await import(path.join(ROOT, 'data/home-corridor.js'));
const { createRainStorm } = await import(path.join(ROOT, 'ui/rain-storm.js'));
const { createFloodingHome } = await import(path.join(ROOT, 'ui/flooding-home.js'));
const { projectOpenMeteo } =
  await import(path.join(ROOT, 'functions/api/rain/global.js'));
const { projectPoint, stripAlerts } =
  await import(path.join(ROOT, 'functions/api/nws/rainfall.js'));
const { advisoryRainfall, hazardsBlock, rewrapProduct, extractNhcProduct } =
  await import(path.join(ROOT, 'lib/advisory.js'));

let failures = 0;
const ok = (label) => console.log(`  \u2713 ${label}`);
const fail = (label, detail) => {
  failures++;
  console.error(`  \u2717 ${label}${detail ? `\n      ${detail}` : ''}`);
};
const truthy = (label, v) => (v ? ok(label) : fail(label));
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  a === e ? ok(label) : fail(label, `expected ${e}\n      actual   ${a}`);
};
/** Millimetres compare to three decimals — the grids publish that precision
 *  and rounding here would hide exactly the arithmetic this suite checks. */
const close = (label, actual, expected) =>
  Math.abs(actual - expected) < 0.0005
    ? ok(label)
    : fail(label, `expected ${expected}\n      actual   ${actual}`);

/* HST is UTC-10 and has no daylight saving, so the offset is 600 all year. */
if (new Date('2026-08-15T22:00:00Z').getTimezoneOffset() !== 600) {
  console.error('TZ pin did not take — this suite computes Hawaii times and cannot run.');
  process.exit(1);
}

const load = (name) => JSON.parse(readFileSync(path.join(SAMPLES, `${name}.json`), 'utf8'));

/** A raw grid → the shape the client actually receives, through the relay's
 *  own projection. Testing the client against the RAW bytes would test a
 *  payload no phone ever sees; testing the projection separately would leave
 *  the seam between them unexercised. This runs both. */
const relayed = (gridName, alertsName) =>
  projectPoint({
    point: { properties: { gridId: 'TEST', relativeLocation: { properties: { city: 'Hilo', state: 'HI' } } } },
    grid: load(gridName),
    alerts: alertsName ? load(alertsName) : null,
    alertsOk: !!alertsName,
  });

/* ---------------------------------------------------------------------------
 * 1. DURATIONS AND INTERVALS — the trap that parses (§48.4)
 * ------------------------------------------------------------------------- */
console.log('\nIntervals and durations');
{
  eq('PT1H', parseDuration('PT1H'), 3600000);
  eq('PT6H', parseDuration('PT6H'), 21600000);
  eq('PT12H', parseDuration('PT12H'), 43200000);
  eq('PT5H — the one §48.4 does not list, measured at Key West',
    parseDuration('PT5H'), 18000000);
  eq('P1DT6H', parseDuration('P1DT6H'), 30 * 3600000);
  eq('PT30M', parseDuration('PT30M'), 1800000);
  eq('a duration with no parts is not a duration', parseDuration('P'), null);
  eq('months are not a rainfall block', parseDuration('P1M'), null);

  const span = parseInterval('2026-08-15T22:00:00+00:00/PT6H');
  eq('the start is the instant before the solidus', span.startMs, Date.parse('2026-08-15T22:00:00Z'));
  eq('the end is start plus duration', span.endMs, Date.parse('2026-08-16T04:00:00Z'));

  /* ==> THE HISTORIC WRONG ANSWER. <== Splitting on `T` returns "2026-08-15"
   * and "22:00:00+00:00/PT6H"; the first of those parses to a real date and
   * nothing throws. */
  truthy('a bare timestamp with no interval is refused',
    parseInterval('2026-08-15T22:00:00+00:00') === null);
  truthy('an unreadable duration takes the whole block with it',
    parseInterval('2026-08-15T22:00:00+00:00/6H') === null);
}

/* ---------------------------------------------------------------------------
 * 2. HILO — units, mixed durations, the windows, the peak (§48.11)
 * ------------------------------------------------------------------------- */
console.log('\nHilo, Big Island — the mixed-duration case');
{
  const payload = relayed('grid-hilo-hi', 'alerts-hilo-hi');
  eq('units are read off the payload', payload.uom, 'wmoUnit:mm');

  const series = readSeries(payload);
  eq('the series reads', series.state, 'ok');
  eq('20 blocks', series.blocks.length, 20);

  const lengths = [...new Set(series.blocks.map((b) => b.durationMs / 3600000))].sort((a, b) => a - b);
  eq('PT1H and PT6H both present', lengths, [1, 6]);

  close('first 24 h = 254.508 mm', windowTotalMm(series.blocks, 24), 254.508);
  close('first 48 h = 274.320 mm', windowTotalMm(series.blocks, 48), 274.320);
  close('first 72 h = 282.956 mm', windowTotalMm(series.blocks, 72), 282.956);
  close('the 120 h window equals the 72 h window — the series ends first',
    windowTotalMm(series.blocks, 120), 282.956);
  /* The two windows agree on the TOTAL and disagree on the block set, which
   * is the whole reason the equality above is worth asserting: it is not that
   * nothing is out there, it is that what is out there is zeroes. */
  eq('and it is a different SET of blocks, not the same one',
    [windowBlocks(series.blocks, 24).length, windowBlocks(series.blocks, 48).length,
     windowBlocks(series.blocks, 72).length, windowBlocks(series.blocks, 120).length],
    [5, 9, 13, 20]);

  const peak = peakBlock(series.blocks);
  close('peak block 84.836 mm', peak.mm, 84.836);
  eq('peak block starts 2026-08-15T22:00Z', new Date(peak.startMs).toISOString(),
    '2026-08-15T22:00:00.000Z');

  const PROBE = Date.parse('2026-08-16T01:49:00Z');
  const out = rainSummary(payload, { system: 'imperial', now: PROBE });

  /* ==> THE TOTAL IS WHAT IS STILL AHEAD, NOT THE WHOLE SERIES (§48.19). <==
   * This asserted 282.956 mm — every block NWS sent — and that figure was
   * wrong on the page rather than in the arithmetic: the grid starts at
   * 15:00Z and the probe read it at 01:49Z the next day, so two blocks
   * totalling 63.754 mm had already fallen before anybody could see the
   * sentence calling them "expected". Every figure below is computed off the
   * fixture at that instant, never typed. */
  close('the total is what has not already fallen', out.totalMm, 219.202);
  eq('219.202 mm — 8.63 in — renders as 9 inches', out.totalText, '9 inches');

  /* THE TWO BLOCKS THAT LEFT, NAMED. A clip that silently dropped the wrong
   * ones would still produce a smaller number that looked reasonable. */
  const kept = futureBlocks(series.blocks, PROBE);
  eq('two blocks are behind the probe and eighteen are not',
    [series.blocks.length, kept.length], [20, 18]);
  close('and they are the 5.334 and 58.420 that ended before it',
    series.blocks.reduce((a, b) => a + b.mm, 0) - kept.reduce((a, b) => a + b.mm, 0), 63.754);
  /* ==> THE BLOCK CONTAINING `now` SURVIVES WHOLE. <== 22:00Z/PT6H runs to
   * 04:00Z and the probe sits inside it. Prorating would mean inventing a
   * rate; dropping it would lose rain the reader is about to get. */
  truthy('the block the probe is standing inside is kept, not prorated',
    kept[0].startMs === Date.parse('2026-08-15T22:00:00Z') && kept[0].mm === 84.836);

  truthy('not negligible', out.negligible === false);
  eq('the label says Thursday, not five days', out.throughWords, 'early Thursday');
  truthy('the peak earns its sentence', !!out.peak);
  eq('the peak is six hours', out.peak.lengthWords, 'six hours');
  /* 84.836 mm is 3.34 inches, and the rounding rule is the rounding rule
   * everywhere: whole inches above one. The peak is not allowed its own
   * precision just because it is a smaller number than the total. */
  eq('the peak renders as 3 inches', out.peak.text, '3 inches');
  /* ==> THE SHARE MOVED BECAUSE THE DENOMINATOR DID, AND THAT IS THE FIX
   * WORKING. <== It read 30% of the whole series; against the rain that is
   * actually still coming the same six hours are 39%. The old figure divided
   * a future peak by a total carrying the past, which understated exactly the
   * "most of it in six hours" signal §48.8 says separates a flood from a wet
   * week. */
  truthy('the peak is about 39% of the rain still to come',
    Math.abs(out.peak.share - 0.387022) < 0.001);
  eq('the place is named, because §48.10 turns on it', out.place, 'Hilo, HI');
}

/* ---------------------------------------------------------------------------
 * 3. THE OTHER BLOCK LENGTHS — Guam, San Juan (§48.11)
 * ------------------------------------------------------------------------- */
console.log('\nTwelve-hour and three-hour blocks');
{
  const gu = readSeries(relayed('grid-tamuning-gu'));
  eq('Guam reads', gu.state, 'ok');
  eq('17 blocks', gu.blocks.length, 17);
  truthy('PT12H present', gu.blocks.some((b) => b.durationMs === 12 * 3600000));
  close('144.272 mm', gu.blocks.reduce((a, b) => a + b.mm, 0), 144.272);
  eq('144.272 mm — 5.68 in — rounds to 6 inches',
    formatRainTotal(144.272, 'imperial'), '6 inches');

  const pr = readSeries(relayed('grid-san-juan-pr'));
  eq('San Juan reads', pr.state, 'ok');
  eq('29 blocks', pr.blocks.length, 29);
  truthy('PT3H present', pr.blocks.some((b) => b.durationMs === 3 * 3600000));
  close('44.450 mm', pr.blocks.reduce((a, b) => a + b.mm, 0), 44.450);
}

/* ---------------------------------------------------------------------------
 * 4. NEGLIGIBLE RAIN IS WORDS (§48.8)
 * ------------------------------------------------------------------------- */
console.log('\nGalveston — a quarter of a millimetre');
{
  const payload = relayed('grid-galveston-tx');
  const series = readSeries(payload);
  eq('30 blocks', series.blocks.length, 30);
  close('0.254 mm across all of them', series.blocks.reduce((a, b) => a + b.mm, 0), 0.254);

  const out = rainSummary(payload, { system: 'imperial', now: Date.parse('2026-08-16T01:49:00Z') });
  truthy('flagged negligible, so the section says so in words', out.negligible === true);
  /* ==> AND THE NUMBER IT WOULD OTHERWISE HAVE PRINTED IS THE POINT. <== */
  eq('the figure it replaces would have been 0.0 inches', out.totalText, '0.0 inches');
  truthy('no peak sentence on a dry forecast', out.peak === null);
}

/* ---------------------------------------------------------------------------
 * 5. UNITS AND ROUNDING (§48.8)
 * ------------------------------------------------------------------------- */
console.log('\nRounding');
{
  eq('whole inches above one', formatRainTotal(282.956, 'imperial'), '11 inches');
  eq('one inch is singular', formatRainTotal(25.4, 'imperial'), '1 inch');
  eq('one decimal below an inch', formatRainTotal(20, 'imperial'), '0.8 inches');
  eq('metric is whole millimetres', formatRainTotal(282.956, 'metric'), '283 mm');
  eq('metric below an inch is still whole mm', formatRainTotal(20, 'metric'), '20 mm');

  /* Units are READ. A payload in inches must convert, not pass through. */
  const inInches = { uom: 'wmoUnit:in', values: [{ validTime: '2026-08-15T15:00:00+00:00/PT6H', value: 2 }] };
  close('2 inches of payload is 50.8 mm', readSeries(inInches).blocks[0].mm, 50.8);
  eq('an unrecognised unit is an answer, not a guess',
    readSeries({ uom: 'wmoUnit:furlong', values: [{ validTime: '2026-08-15T15:00:00+00:00/PT6H', value: 2 }] }).state,
    'unreadable');
  eq('a 200 with no series is not covered, and never an error',
    readSeries({ uom: 'wmoUnit:mm', values: [] }).state, 'not_covered');
}

/* ---------------------------------------------------------------------------
 * 6. ALERTS — the family filter and the expiry (§48.6)
 * ------------------------------------------------------------------------- */
console.log('\nAlerts in force at Hilo');
{
  const all = stripAlerts(load('alerts-hilo-hi'));
  eq('five alerts were in force', all.length, 5);

  /* Just before the Flash Flood Warning expired: 2026-08-15T16:00-10:00. */
  const during = Date.parse('2026-08-16T01:49:00Z');
  const kept = floodAlerts(all, during);
  eq('only the flood family survives', kept.map((a) => a.event),
    ['Flash Flood Warning', 'Flood Watch']);
  truthy('the hurricane warning is left to the In effect section',
    !kept.some((a) => a.event === 'Hurricane Warning'));
  truthy('high surf and the local statement belong to neither section',
    !kept.some((a) => /Surf|Local Statement/.test(a.event)));
  truthy('the immediate one sorts first', kept[0].immediate === true);

  /* ==> EXPIRY IS HONOURED AT RENDER, NOT ONLY AT FETCH. <== The Flash Flood
   * Warning ran 52 minutes. One minute past its end it must be gone, from the
   * SAME payload — which is exactly what a cached answer is. */
  const after = Date.parse('2026-08-16T02:01:00Z');
  const later = floodAlerts(all, after);
  eq('a minute past its end the warning is gone', later.map((a) => a.event), ['Flood Watch']);

  /* And the whole payload path: the summary must drop it too. */
  const out = rainSummary(relayed('grid-hilo-hi', 'alerts-hilo-hi'), { system: 'imperial', now: after });
  eq('the summary drops it as well', out.alerts.map((a) => a.event), ['Flood Watch']);
}

/* ---------------------------------------------------------------------------
 * 7. OUTSIDE COVERAGE — two statuses, one fact (§48.5)
 * ------------------------------------------------------------------------- */
console.log('\nNassau, Bahamas — outside coverage');
{
  const points = load('points-nassau-bs');
  const alerts = load('alerts-nassau-bs');
  eq('the grid says 404', points.status, 404);
  eq('and names InvalidPoint', points.type, 'https://api.weather.gov/problems/InvalidPoint');
  eq('the alerts say 400 — a DIFFERENT status for the SAME fact', alerts.status, 400);
  eq('and name InvalidParameter', alerts.type, 'https://api.weather.gov/problems/InvalidParameter');

  /* The relay matches on the `problems/` URI, which is the stable half. This
   * asserts the pattern the route uses actually matches both bodies — the
   * whole §48.5 decision rests on it. */
  const OUT_OF_BOUNDS = /problems\/(InvalidPoint|InvalidParameter)/;
  truthy('one pattern recognises both', OUT_OF_BOUNDS.test(JSON.stringify(points)) &&
    OUT_OF_BOUNDS.test(JSON.stringify(alerts)));

  /* A payload with no alerts key at all is UNKNOWN, never "nothing in force". */
  const unknown = rainSummary({ ...relayed('grid-hilo-hi'), alerts: null },
    { system: 'imperial', now: Date.parse('2026-08-16T01:49:00Z') });
  eq('a failed alerts hop yields no alerts to show', unknown.alerts, []);
  truthy('and the payload still says it was not known', unknown.state === 'ok');
}

/* ---------------------------------------------------------------------------
 * 8. THE ADVISORY PARAGRAPH (§48.2)
 * ------------------------------------------------------------------------- */
console.log('\nLala advisory HFOTCPCP2 — the rainfall block');
{
  const html = readFileSync(path.join(SAMPLES, 'advisory-lala-HFOTCPCP2.html'), 'utf8');
  const text = extractNhcProduct(html).text;

  const out = advisoryRainfall(text);
  eq('the block is found', out.state, 'ok');
  eq('one paragraph', out.paragraphs.length, 1);
  truthy('it opens on NHC\u2019s own first words',
    out.paragraphs[0].startsWith('Lala is expected to produce rainfall totals of 10 to 20 inches'));
  truthy('it closes on the mudslides sentence',
    out.paragraphs[0].endsWith('especially in areas of steep terrain.'));

  /* ==> IT STOPS AT THE NEXT LABEL. <== The storm surge block follows five
   * lines later and reads as rainfall if the parser runs on. */
  truthy('storm surge is not swept in', !out.paragraphs[0].includes('storm surge'));
  truthy('the wind block above it is not swept in', !out.paragraphs[0].includes('Hurricane conditions'));

  /* Both pointer paragraphs measured present, and both stripped (§48.2). */
  truthy('the rainfall graphic pointer is stripped',
    !out.paragraphs.some((p) => p.includes('complete depiction')));
  truthy('the WPC storm summary pointer is stripped',
    !out.paragraphs.some((p) => p.includes('rainfall observations')));
  truthy('and both really were in the source',
    text.includes('For a complete depiction') && text.includes('For a list of rainfall observations'));

  /* Rewrapping: the teletype newlines are gone, the sentence is whole. */
  truthy('hard wraps are rewrapped away', !out.paragraphs[0].includes('\n'));
}

console.log('\nIda 2021 — a multi-paragraph block, and a fifth label');
{
  const adv11 = readFileSync(
    path.join(ROOT, 'samples/ida-al092021/public/al092021.public.011.txt'), 'utf8');
  const out = advisoryRainfall(adv11);
  eq('the block is found', out.state, 'ok');
  eq('TWO paragraphs, and the second is not lost', out.paragraphs.length, 2);
  truthy('the second paragraph is the elsewhere one',
    out.paragraphs[1].startsWith('Elsewhere across eastern Louisiana'));
  /* ==> THE NEXT LABEL HERE IS `TORNADOES:`, WHICH §48.2 NEVER SAW. <== The
   * parser stops at whatever label comes next rather than at a list of the
   * ones a spec happened to record. */
  truthy('the tornado block is not swept in',
    !out.paragraphs.some((p) => p.includes('Tornadoes will be possible')));
  truthy('and TORNADOES really is the next label in this product',
    /\nTORNADOES:/.test(adv11));

  const adv1 = readFileSync(
    path.join(ROOT, 'samples/ida-al092021/public/al092021.public.001.txt'), 'utf8');
  const first = advisoryRainfall(adv1);
  eq('advisory 1 also reads', first.state, 'ok');
  truthy('its trailing Gulf Coast paragraph survives',
    first.paragraphs[1].includes('central U.S. Gulf Coast'));
  /* Whitespace-only separator lines: NHC writes `\n \n` as often as `\n\n`,
   * and treating only the empty one as a break joins two paragraphs. */
  truthy('a space-only line is still a paragraph break', first.paragraphs.length === 2);
}

console.log('\nNo land hazards, and no block at all');
{
  /* ==> THIS FIXTURE IS SYNTHESISED AND SAYS SO. <== §48.11 names "a Hernan
   * advisory" for this case and NO SUCH BYTES WERE EVER CAPTURED — the probe
   * branch holds two NHC pages and one of them is a 404. What is asserted
   * here is the PARSER's behaviour on the shape §48.2 describes, not a claim
   * that this is what Hernan said. Replace it with real bytes the next time a
   * storm publishes `None.` */
  const synthetic = [
    'BULLETIN', 'Hurricane Somebody Advisory Number 3', '',
    'HAZARDS AFFECTING LAND', '----------------------', 'None.', '',
    'NEXT ADVISORY', '-------------', 'Next complete advisory at 5 PM.', '$$',
  ].join('\n');
  eq('`None.` is its own answer, never a failure',
    advisoryRainfall(synthetic).state, 'no_hazards');

  /* A product with a hazards block that has no rainfall label. */
  const noRain = synthetic.replace('None.', 'WIND: Tropical storm conditions are possible.');
  eq('a block with no rainfall label is named as that', advisoryRainfall(noRain).state, 'no_rainfall');

  /* JTWC text has no such block at all. */
  eq('no block at all is a fourth answer', advisoryRainfall('SUBJ/TYPHOON 11W (NOUL) WARNING NR 008//').state, 'no_block');
  eq('and hazardsBlock says so directly', hazardsBlock('nothing here'), null);
}

/* ---------------------------------------------------------------------------
 * 9. THE RELAY PROJECTION (§48.7)
 * ------------------------------------------------------------------------- */
console.log('\nThe relay projection');
{
  const raw = load('grid-hilo-hi');
  const body = relayed('grid-hilo-hi', 'alerts-hilo-hi');

  const rawBytes = JSON.stringify(raw).length;
  const outBytes = JSON.stringify(body).length;
  /* ==> THE RATIO MOVED WHEN §48.20 ADDED `areaDesc`, AND THE THRESHOLD MOVED
   * WITH IT DELIBERATELY. <== It was a twentieth. Carrying the zone list costs
   * a few hundred bytes per alert and buys the reader the answer to "is this
   * about me", which is the question a warning with no area attached forces
   * them to guess at. A tenth still catches the regression this assertion
   * exists for — a projection that stops projecting and ships the whole 55 KB
   * of `description`, `instruction` and polygon. Both figures print, so a
   * silent drift shows up in the output even while the test passes. */
  truthy(`the grid shrinks from ${rawBytes} bytes to ${outBytes}`, outBytes < rawBytes / 10);
  truthy('humidity is gone', !JSON.stringify(body).includes('relativeHumidity'));
  truthy('the field we came for is not', body.values.length === 20);
  eq('the grid\u2019s own updateTime travels with it', body.updateTime, raw.properties.updateTime);

  /* Alerts keep their six fields and lose their text and their polygon —
   * which is nearly all of the 55 KB. */
  const alertBytes = JSON.stringify(load('alerts-hilo-hi')).length;
  const strippedBytes = JSON.stringify(stripAlerts(load('alerts-hilo-hi'))).length;
  truthy(`alerts shrink from ${alertBytes} bytes to ${strippedBytes}`, strippedBytes < alertBytes / 10);
  /* ==> AND THE AREA IS WHAT THE EXTRA BYTES BOUGHT. <== Asserted directly, so
   * a future tidy-up of `stripAlerts` cannot drop it and leave every other
   * assertion here green. */
  truthy('the affected area survives the projection',
    body.alerts.every((a) => 'areaDesc' in a) &&
    body.alerts.some((a) => /Big Island/.test(a.areaDesc || '')));
  truthy('no alert description survives', !JSON.stringify(body.alerts).includes('WHAT...'));
  truthy('but the expiry does, because rendering honours it',
    body.alerts.every((a) => 'expires' in a));

  /* A failed alerts hop is null, NOT an empty list. */
  const noAlerts = projectPoint({ point: {}, grid: raw, alerts: null, alertsOk: false });
  eq('a failed alerts hop reads as unknown', noAlerts.alerts, null);
  const emptyAlerts = projectPoint({ point: {}, grid: raw, alerts: { features: [] }, alertsOk: true });
  eq('and a real empty answer reads as empty', emptyAlerts.alerts, []);
}

/* ---------------------------------------------------------------------------
 * MUTATIONS. A rule whose test cannot be made to fail is decoration (§12).
 * Each block reintroduces a named bug and asserts the output MOVES — that the
 * assertions above would have caught it.
 * ------------------------------------------------------------------------- */
console.log('\nMutations — each bug must change the answer');
{
  const payload = relayed('grid-hilo-hi', 'alerts-hilo-hi');
  const now = Date.parse('2026-08-16T01:49:00Z');
  const good = rainSummary(payload, { system: 'imperial', now });

  /* Bug 1 (§48.4, the expensive one): assume inches because the advisory is
   * written in inches. The figure stays plausible and is 25.4x too small. */
  const asInches = rainSummary({ ...payload, uom: 'wmoUnit:in' }, { system: 'imperial', now });
  truthy('assuming inches changes the total', asInches.totalMm !== good.totalMm);
  truthy('and the wrong answer looks entirely plausible on the page',
    asInches.totalText !== '9 inches' && asInches.negligible === false);

  /* Bug 2 (§48.4): discard the duration and treat every block as one hour.
   * The 24-hour window is what moves — the total does not, which is why the
   * window assertions above exist at all. */
  const series = readSeries(payload);
  const flattened = series.blocks.map((b) => ({ ...b, durationMs: 3600000, endMs: b.startMs + 3600000 }));
  truthy('a fixed one-hour step changes where the series ends',
    flattened[flattened.length - 1].endMs !== series.blocks[series.blocks.length - 1].endMs);

  /* Bug 3 (§48.11): label by the WINDOW rather than by the last block held.
   *
   * ==> AND THE OBVIOUS MUTATION CANNOT BITE ON THIS FIXTURE, WHICH IS WORTH
   * WRITING DOWN. <== Hilo's window ends 2026-08-20T15:00Z and its series
   * ends 2026-08-20T10:00Z — five hours apart, both `early Thursday` in
   * Honolulu. So substituting one for the other changes NOTHING here, and a
   * suite that asserted it did would be asserting an accident.
   *
   * What CAN be proven is the rule itself: the label follows the data. Cut
   * the series short and the label must move with it. A label computed from
   * the window is unmoved by that, which is exactly the bug. */
  const shortened = { ...payload, values: payload.values.slice(0, 8) };
  const cut = rainSummary(shortened, { system: 'imperial', now });
  truthy('cutting the series short moves the label',
    cut.throughMs !== good.throughMs && cut.throughWords !== good.throughWords);
  truthy('and the window it sits in has not changed at all',
    readSeries(shortened).blocks[0].startMs === series.blocks[0].startMs);

  /* Bug 4 (§48.8): print the number instead of the words on a dry forecast. */
  const dry = rainSummary(relayed('grid-galveston-tx'), { system: 'imperial', now });
  truthy('Galveston is negligible and 0.0 inches is what it would have printed',
    dry.negligible && dry.totalText === '0.0 inches');

  /* Bug 5 (§48.6): filter alerts only at fetch. Re-running the SAME payload
   * past the expiry must drop the warning. */
  const past = rainSummary(payload, { system: 'imperial', now: Date.parse('2026-08-16T03:00:00Z') });
  truthy('an expired warning cannot survive a cached payload',
    good.alerts.length !== past.alerts.length);

  /* Bug 6 (§48.6): treat severity as the ordering. Both flood alerts are
   * `Severe`, so a severity sort cannot put the live one first. */
  const both = floodAlerts(stripAlerts(load('alerts-hilo-hi')), now);
  truthy('severity alone cannot separate the two flood alerts',
    both.length === 2 && both[0].severity === both[1].severity);
  truthy('urgency can, and does', both[0].immediate && !both[1].immediate);

  /* Bug 7 (§48.2): run past the next label. Delete the STORM SURGE label from
   * the product and the paragraph must grow — which proves the stop is real
   * and not an artefact of where the block happens to end. */
  const html = readFileSync(path.join(SAMPLES, 'advisory-lala-HFOTCPCP2.html'), 'utf8');
  const text = extractNhcProduct(html).text;
  const unlabelled = text.replace('STORM SURGE:', 'Storm surge');
  const before = advisoryRainfall(text).paragraphs.join(' ').length;
  const after = advisoryRainfall(unlabelled).paragraphs.join(' ').length;
  truthy('a missing label lets the block run on, so the stop is doing work', after > before);

  /* Bug 8: rewrapping on empty lines only. NHC's separator is often a line
   * holding one space. */
  eq('a space-only line separates paragraphs',
    rewrapProduct('one line\nwrapped\n \nsecond para').length, 2);

  /* Bug 9 (§48.19, the one this pass exists for): sum the WHOLE series and
   * call it "expected". Nothing throws, nothing looks wrong, and the figure is
   * inflated by however much has already fallen.
   *
   * ==> THE MUTATION IS RUN AGAINST THE REAL FIXTURE AT A REAL MOMENT. <==
   * Hilo's grid starts 15:00Z and the probe read it at 01:49Z the next day.
   * Skipping the clip puts 63.754 mm of yesterday's rain back into a sentence
   * about tomorrow, and moves the printed figure two whole inches. */
  const unclipped = readSeries(payload).blocks.reduce((a, b) => a + b.mm, 0);
  truthy('summing the whole series inflates the total',
    unclipped > good.totalMm);
  truthy('and it does so by a figure a reader would act on',
    formatRainTotal(unclipped, 'imperial') !== good.totalText);
  /* ==> AND THE PEAK'S SHARE MOVES WITH IT. <== A peak divided by a total
   * carrying the past understates exactly the "most of it in six hours"
   * signal §48.8 says separates a flood from a wet week. */
  truthy('and the heaviest block looks like a smaller share than it is',
    peakBlock(futureBlocks(readSeries(payload).blocks, now)).mm / unclipped
      < good.peak.share);
  /* THE CLIP IS AT THE BLOCK'S END, NOT ITS START. Clipping on `startMs`
   * would throw away the block the reader is currently standing inside —
   * 84.836 mm of it here, the heaviest in the series. */
  truthy('clipping on the start instead of the end would drop the block we are in',
    futureBlocks(readSeries(payload).blocks, now).length >
    readSeries(payload).blocks.filter((b) => b.startMs > now).length);

  /* Bug 10 (§48.16): let a global-model payload with no series read as
   * `not_covered`. It prints *"neither the National Weather Service nor the
   * global model has a forecast for this point"*, with no Retry — a confident
   * claim about somebody's house, assembled out of our own reading failure.
   * Open-Meteo covers the planet and cannot report a place as uncovered. */
  const blindGlobal = { provider: 'open-meteo', values: null, uom: 'inch/h' };
  eq('an unreadable global payload is unreadable, not uncovered',
    readSeries(blindGlobal).state, 'unreadable');
  /* AND THE NWS ROUTE KEEPS THE OPPOSITE ANSWER, because a 200 grid genuinely
   * carrying no precipitation series IS a statement about coverage (§48.5).
   * One rule that fired on both would be the same bug pointing the other way. */
  eq('the same shape from NWS is still a coverage answer',
    readSeries({ values: null, uom: null }).state, 'not_covered');

  /* ------------------------------------------------------------------------
   * §48.18 — WHEN THE HOUSE FIGURE BELONGS BESIDE A STORM.
   *
   * ==> THE FAILURE THIS GUARDS IS NOT A WRONG NUMBER. <== The house forecast
   * is true for every storm on the globe, because it is about a PLACE. Print
   * it under a typhoon 6,000 nm away and it is a correct figure in a position
   * that implies a connection nobody claimed. There is no exception to catch
   * and no shape to the failure, which is exactly why it needs a test.
   *
   * ==> AND THE GATE IS NO LONGER A DISTANCE. <== It borrowed
   * `APPROACH.relevanceNm` — 1,500 nm, about a basin's width — which drew the
   * figure under every storm within roughly 1,725 miles. What decides now is
   * whether the storm's own published wind field crosses the house, measured
   * by `data/home-corridor.js`. Distance survives only as the fallback for a
   * storm nobody published a field for, at `RAIN.houseFallbackNm`.
   *
   * Thresholds are read from RAIN rather than typed, so a suite that passes
   * cannot be one that agreed with a number somebody changed.
   * ---------------------------------------------------------------------- */
  const R = RAIN.houseFallbackNm;

  /* --- the measurement wins, in both directions -------------------------- */
  truthy('a storm whose wind field reaches the house is in range',
    houseRainInRange({ reach: 'reaches', distanceNm: 900, approachNm: 900 }));
  /* ==> THE CASE THE WHOLE CHANGE EXISTS FOR. <== A storm 40 nm offshore whose
   * published field is MEASURED to stop short of the house. Distance would say
   * yes twice over; the wind field says no, and the wind field is the answer.
   * If this ever passes on distance, the gate has quietly reverted. */
  truthy('a near storm measured to miss the house is NOT, however close it is',
    !houseRainInRange({ reach: 'misses', distanceNm: 40, approachNm: 12 }));

  /* --- the fallback, and only where nothing was measured ------------------ */
  truthy('with no wind field published, a storm inside the fallback is in range',
    houseRainInRange({ reach: null, distanceNm: 12 }));
  truthy('and one on the far side of the planet is not',
    !houseRainInRange({ reach: null, distanceNm: 6000 }));

  /* THE BOUNDARY IS INCLUSIVE, and both sides of it are asserted — a gate
   * tested only well inside its range passes for an off-by-one that swaps
   * `<=` for `<`. */
  truthy('exactly at the fallback counts as near', houseRainInRange({ distanceNm: R }));
  truthy('one mile past it does not', !houseRainInRange({ distanceNm: R + 1 }));

  /* ==> THE OLD THRESHOLD IS ASSERTED DEAD. <== 1,500 nm was the gate; a storm
   * sitting there must now be out. Without this, restoring the borrow would
   * pass every other case in this block. */
  truthy('a storm at the OLD 1,500 nm threshold no longer earns the figure',
    !houseRainInRange({ distanceNm: 1500 }));

  /* A far storm whose forecast track closes inside the fallback. Gating on
   * where it is at this moment would hide the figure for exactly the days it
   * matters most. */
  truthy('a far storm closing inside the fallback is in range',
    houseRainInRange({ distanceNm: R + 900, approachNm: R - 100 }));
  truthy('a far storm that stays far is not',
    houseRainInRange({ distanceNm: R + 900, approachNm: R + 800 }) === false);

  /* NO NUMBERS MEANS NO. The track has not landed yet and there is no
   * distance either — an unknown must not be treated as near, or the block
   * renders under every storm during the seconds before geometry arrives. */
  truthy('nothing known is not in range', !houseRainInRange({}));
  truthy('no argument at all is not in range', !houseRainInRange());
  truthy('a non-finite distance is not in range',
    !houseRainInRange({ distanceNm: NaN, approachNm: null }));

  /* ------------------------------------------------------------------------
   * §48.18 — READING THE CORRIDOR. `reachesHome` has THREE answers and the
   * third one is the point: folding "measured, and it misses" together with
   * "nobody published a field to measure" is the §5 failure aimed at the
   * reader's own house.
   * ---------------------------------------------------------------------- */
  eq('no corridor at all is unknown, never a miss', reachesHome(null), null);
  eq('a corridor that could not be built is unknown', reachesHome({ ok: false }), null);
  eq('a forecast field crossing the house reaches',
    reachesHome({ ok: true, forwardOk: true, worst: 64, begun: false, past: null }), 'reaches');
  eq('a forecast field walked and missing is a real miss',
    reachesHome({ ok: true, forwardOk: true, worst: null, begun: false, past: null }), 'misses');
  /* ==> WIND THAT ALREADY BLEW IS WIND THAT REACHED. <== NHC stops issuing
   * forecast radii late in a storm's life, so the storm with no forward field
   * is the one most likely to have just gone over somebody. */
  eq('a past field that went over the house reaches, with no forecast at all',
    reachesHome({ ok: true, forwardOk: false, past: { worst: 34 } }), 'reaches');
  /* ==> AND A PAST THAT MISSED SETTLES NOTHING ABOUT THE FUTURE. <== There is
   * no forecast wind field on a past-only corridor, so "it has not reached you
   * yet" is exactly as unknown as it was before. */
  eq('a past-only corridor that missed is still unknown ahead',
    reachesHome({ ok: true, forwardOk: false, past: { worst: null } }), null);
  eq('a window that opened and closed before now still counts as reached',
    reachesHome({ ok: true, forwardOk: true, worst: null, begun: true, past: null }), 'reaches');

  /* ------------------------------------------------------------------------
   * §48.20 — TWO TIERS, BECAUSE A FLOOD WARNING IS NOT THE STORM'S.
   *
   * ==> THE FIRST CUT OF §48.18 GATED THE WHOLE BLOCK ON THE WIND FIELD AND
   * THAT DELETED THE WARNINGS TOO. <== A rainfall TOTAL under a storm that
   * misses the house is noise — its position implies a connection nobody
   * claimed. A flood WARNING under the same storm makes no claim about the
   * storm at all: it is an agency's statement about the reader's own address,
   * in force now, true whichever storm they happened to tap. And the storm
   * drawer is routinely the only screen anybody opens during a hurricane.
   * ---------------------------------------------------------------------- */
  eq('a storm whose wind reaches the house earns the whole block',
    houseRainScope({ reach: 'reaches', distanceNm: 60 }), 'full');
  /* ==> THE CASE THIS TIER EXISTS FOR. <== Measured to miss, still in the
   * reader's world: the warnings survive and the figure does not. */
  eq('a storm measured to miss still earns the warnings',
    houseRainScope({ reach: 'misses', distanceNm: 400 }), 'alerts');
  /* AND THE FAR SIDE OF THE PLANET EARNS NOTHING, which is what stops a flood
   * warning at home appearing under every cyclone on Earth. */
  eq('a storm on the far side of the planet earns nothing',
    houseRainScope({ reach: 'misses', distanceNm: 4000 }), 'none');

  /* THE WARNINGS TIER IS `APPROACH.relevanceNm`, READ RATHER THAN TYPED — and
   * this is the question that constant was written for. Both sides asserted,
   * because a boundary tested on one side passes for a flipped comparison. */
  eq('exactly at the relevance ring still earns the warnings',
    houseRainScope({ reach: 'misses', distanceNm: APPROACH.relevanceNm }), 'alerts');
  eq('one mile past it earns nothing',
    houseRainScope({ reach: 'misses', distanceNm: APPROACH.relevanceNm + 1 }), 'none');

  /* ==> THE TWO RINGS ARE DIFFERENT SIZES AND MUST STAY THAT WAY. <== If they
   * ever collapse to one number, one of the two tiers has stopped existing and
   * every case above still passes. */
  truthy('the warnings ring is wider than the figure ring',
    APPROACH.relevanceNm > RAIN.houseFallbackNm);

  /* A storm closing on the house from outside both rings takes the tier its
   * APPROACH earns, not the one its current distance would. */
  eq('a far storm closing inside the figure ring earns the whole block',
    houseRainScope({ distanceNm: 4000, approachNm: 100 }), 'full');
  eq('and one closing only inside the relevance ring earns the warnings',
    houseRainScope({ distanceNm: 4000, approachNm: 1000 }), 'alerts');

  eq('no argument at all earns nothing', houseRainScope(), 'none');

  /* ------------------------------------------------------------------------
   * §48.20 — HOW LONG A WARNING HAS LEFT.
   *
   * ==> MINUTES, AND THIS IS THE ONE FIGURE IN §48 WHERE THEY MATTER. <==
   * Hilo's Flash Flood Warning ran 52 minutes. `durationWords` rounds to whole
   * hours and would call that "an hour", overstating the time a reader has on
   * the one number whose whole point is how little is left.
   * ---------------------------------------------------------------------- */
  const T0 = Date.parse('2026-08-15T15:08:00-10:00');
  eq('52 minutes is stated in minutes, not rounded to an hour',
    remainingWords(Date.parse('2026-08-15T16:00:00-10:00'), T0), '52 min left');
  eq('an hour and a half rounds to hours', remainingWords(T0 + 90 * 60000, T0), '2 hours left');
  eq('one hour is singular', remainingWords(T0 + 60 * 60000, T0), '1 hour left');
  eq('three days is stated in days', remainingWords(T0 + 72 * 3600000, T0), '3 days left');
  /* NOTHING TO SAY IS SAID AS NOTHING. An alert with no end time is a real
   * shape — two of the five captured carry `ends: null` — and inventing a
   * duration for one is §5. */
  eq('an alert already past gets no duration', remainingWords(T0 - 1000, T0), null);
  eq('an absent end time gets no duration', remainingWords(NaN, T0), null);
}

/* ==========================================================================
 * §48.17, §48.20, §56.7 — WHAT THE TWO SECTIONS ACTUALLY RENDER.
 *
 * ==> THESE EXIST BECAUSE THE HOUSE BLOCK SHIPPED WITH A REAL BUG THAT NOTHING
 * CAUGHT. <== It rendered a rainfall total for the house and DROPPED the flood
 * warnings in force, on the reasoning that the dashboard already showed them
 * and the app must not say things twice. It was not said twice, and a reader
 * who tapped a storm and never opened the dashboard got a number and no
 * warning at all. Every suite passed: it is not an exception, not a parse
 * failure and not a wrong figure — it is a TRUE SENTENCE THAT WAS NEVER
 * PRINTED, which is exactly the shape §5 exists to forbid and exactly what a
 * unit test of the arithmetic cannot see. So these assert the RENDERED STRING.
 *
 * ==> THE ROWS MOVED TO `Flooding` ON 2026-08-22 (§56.7) AND THESE MOVED WITH
 * THEM RATHER THAN BEING DELETED. <== Every assertion below still asserts the
 * thing it was written to assert; what changed is which controller is asked.
 * Deleting a §5 acceptance case because its code moved house is how the bug it
 * was written for comes back.
 *
 * Both controllers are string building with no DOM, so this runs on plain node.
 * ========================================================================== */
{
  const hiloAlerts = load('alerts-hilo-hi');
  /* The moment those warnings were live. Pinned off the capture itself rather
   * than typed, so the suite cannot drift from its own fixture. */
  const LIVE = Date.parse(hiloAlerts.features[0].properties.sent);

  const nws = projectPoint({
    grid: load('grid-hilo-hi'),
    point: { properties: { gridId: 'HFO', relativeLocation: { properties: { city: 'Hilo', state: 'HI' } } } },
    alerts: hiloAlerts,
    alertsOk: true,
  });
  /* The SAME grid with the alerts hop having failed — `alerts: null` means
   * "not known", which is a different sentence from "none in force". */
  const nwsNoAlertsHop = projectPoint({
    grid: load('grid-hilo-hi'), point: null, alerts: null, alertsOk: false,
  });
  /* The same grid with the hop having SUCCEEDED and returned nothing. A real
   * all-clear, and the state that must not render the same as the one above. */
  const nwsNoneInForce = projectPoint({
    grid: load('grid-hilo-hi'), point: null,
    alerts: { type: 'FeatureCollection', features: [] }, alertsOk: true,
  });
  const openMeteo = projectOpenMeteo({ body: load('openmeteo-manila-ph'), fetchedAt: null });

  const HOME = { lat: 19.72, lon: -155.08 };
  const flat = (h) => h.replace(/\s+/g, ' ');

  /** Render the storm drawer's Rainfall section for a GDACS storm (no advisory
   *  range above it) at a chosen moment. */
  async function renderRain(payload, atMs, range = { reach: 'reaches', distanceNm: 200 }) {
    const storm = { id: 'g1', source: 'gdacs', advisoryKey: null };
    const c = createRainStorm({
      loadAdvisory: async () => ({ state: 'unsupported' }),
      rain: { loadRainfall: async () => ({ status: 'ok', payload }), retryRainfall: async () => ({}) },
      house: { get: () => HOME, rangeNm: () => range },
      units: () => 'imperial',
      now: () => atMs,
    });
    await c.ensure(storm, () => {});
    return c.html(storm);
  }

  /** Render the home dashboard's Flooding section at a chosen moment.
   *
   *  ==> NO STORM BY DEFAULT, AND THAT IS THE POINT OF THE MOVE. <== The rows
   *  are an agency's statement about the reader's own address; nothing about
   *  them depends on which storm is on screen, or on there being one. The old
   *  house block had to carry a two-tier scope rule to get that right (§48.20)
   *  and this has no tiers to get wrong. */
  async function renderFlood(payload, atMs, storm = null) {
    const c = createFloodingHome({
      rain: { loadRainfall: async () => ({ status: 'ok', payload }), retryRainfall: async () => ({}) },
      /* A model facade that is never actually asked: every storm in these
       * fixtures is either absent or NHC's, and §51.5 declines those before a
       * fetch. It is present rather than null because the SECTION only draws
       * its second half when the feature is wired at all, and a null here
       * would silently skip the half these assertions are about. */
      surge: { loadSurge: async () => ({ status: 'unavailable' }), retrySurge: async () => ({}) },
      units: () => 'imperial',
      now: () => atMs,
    });
    await c.ensure(storm, HOME, () => {});
    return c.inner(storm, HOME, '<HEAD>');
  }

  const live = await renderFlood(nws, LIVE);
  const rainLive = await renderRain(nws, LIVE);

  /* THE BUG, ASSERTED DIRECTLY. */
  truthy('a live Flash Flood Warning reaches the reader',
    live.includes('Flash Flood Warning'));

  /* ==> AND IT IS ABOVE OUR OWN FIGURES, NOT BELOW THEM (§48.6). <== The rule
   * is that somebody else's order about right now outranks our arithmetic on a
   * forecast. It used to be asserted WITHIN one section, against the rainfall
   * total. Since §56.7 the rainfall total is in the section above and the
   * order is `Rain, then Flooding`, so what this asserts now is the surviving
   * half: inside Flooding, the rows come before the modelled figure and the
   * coverage prose. Index order is the only thing that can assert this without
   * a browser. */
  const withModel = await renderFlood(nws, LIVE, { id: 'n1', source: 'nhc' });
  truthy('the rows render above our own modelled prose',
    withModel.indexOf('Flash Flood Warning') < withModel.indexOf('flood-model'));

  /* ==> AND THE RAINFALL TOTAL IS NOT IN THIS SECTION AT ALL. <== §56.7 left
   * Rain a forecast and only a forecast. A Flooding section that also printed
   * the total would be the merge undone by a copy-paste. */
  truthy('no rainfall total leaks into the Flooding section',
    !live.includes('expected through') && !live.includes('The heaviest'));

  /* AN EXPIRED WARNING IS NOT A WARNING. Same bytes, later the same evening.
   * Without this, a test of the line above would also pass on code that
   * renders every alert it is ever handed, forever.
   *
   * ==> AND THE ROW IS REPLACED BY THE ALL-CLEAR, NOT BY NOTHING. <== That is
   * new with §56.7 and it is the one behaviour the move actually changed:
   * inside Rain an empty list was correctly silent, because the total below it
   * was the section's answer. A section headed *Flooding* with nothing under
   * it cannot be told from one that failed to load. */
  const floodEnds = Date.parse(
    hiloAlerts.features.find((f) => /Flash Flood Warning/.test(f.properties.event))
      .properties.ends
  );
  const later = await renderFlood(nws, floodEnds + 60_000);
  truthy('an expired warning does not reach the reader',
    !later.includes('Flash Flood Warning'));
  /* ==> THE WATCH IS STILL RUNNING AT THAT MOMENT, AND THAT IS THE POINT OF
   * PINNING THIS ONE MINUTE PAST THE WARNING'S OWN `ends`. <== It proves the
   * filter is per-alert rather than per-payload: one row goes and the other
   * stays. A moment past everything would prove only that a list can be
   * emptied. */
  truthy('but the watch that is still running does',
    later.includes('Flood Watch'));

  /* PAST EVERY ALERT IN THE FIXTURE, and the section says so rather than going
   * blank. That is new with §56.7 and it is the one behaviour the move
   * actually changed: inside Rain an empty list was correctly silent, because
   * the total below it was the section's answer. A section headed *Flooding*
   * with nothing under it cannot be told from one that failed to load. */
  const allEnds = Math.max(...hiloAlerts.features
    .map((f) => Date.parse(f.properties.ends || f.properties.expires || ''))
    .filter(Number.isFinite));
  const afterAll = await renderFlood(nws, allEnds + 60_000);
  truthy('and once every alert has run out the section says so rather than going blank',
    flat(afterAll).includes('No flood alerts are in force for your address'));

  /* ==> THE URGENCY SIGNAL SURVIVED THE RESTYLE, AND THAT IS WHAT THIS
   * CHECKS. <== The rows lost their fill and their red/amber ink on 2026-08-22
   * because the highlight read as decoration on glass. §48.6's rule did not go
   * with it: `Immediate` is happening and `Expected`/`Future` are not, severity
   * cannot separate them — both flood alerts here are `Severe` — and deleting
   * the colour without replacing the signal would have quietly deleted the
   * distinction too. It lives in the SENTENCE now, which is the one place a
   * stylesheet, a screen reader and a colour-blind reader all reach. */
  truthy('the immediate warning says it is in force, in words',
    /Flash Flood Warning[\s\S]*?in force until/.test(live));
  truthy('and the watch does not, so the two do not read the same',
    /Flood Watch<\/span>\s*<span class="rain-alert-until">until /.test(live));
  /* NEITHER ROW CARRIES A COLOUR OR A FILL ANY MORE. A restyle that reached
   * for an inline style or a state class would be the old shape coming back. */
  truthy('the rows carry no inline colour and no urgency class',
    !/rain-alert[^>]*style=/.test(live) && !/rain-alert--/.test(live));

  /* ==> WHERE IT APPLIES, ON THE ROW (§48.20). <== A warning with no area
   * attached asks the reader to assume it is about them, which on the flood
   * family is the one assumption worth not making. Both captured areas
   * asserted: the one-zone warning and the seventeen-zone watch. */
  truthy('the warning names its affected area',
    live.includes('Hawaii in Hawaii, HI'));
  truthy('and the watch names every zone it covers, untruncated',
    live.includes('Maui Windward West') && live.includes('Big Island North')
      && !live.includes('…') && !/\+\d+ more/.test(live));

  /* ==> AND HOW LONG IT HAS TO RUN, IN MINUTES WHERE THAT IS THE TRUTH. <==
   * Hilo's warning ran 52 minutes. Rounded to hours it would read "an hour",
   * overstating the time a reader has on the one figure whose whole point is
   * how little is left. */
  truthy('the warning says how long is left, to the minute',
    live.includes('52 min left'));
  truthy('and the watch says its own, in hours',
    /1[0-9] hours left/.test(live));
  /* THE CLOCK TIME AND THE DURATION ARE BOTH THERE, not one instead of the
   * other: a clock time is what somebody plans against, a duration is what
   * tells them whether to move now. */
  truthy('the end time is stated as well as the duration',
    live.includes('in force until') && live.includes('min left'));

  /* ========================================================================
   * §48.20 → §56.7 — A STORM THAT MISSES THE HOUSE KEEPS THE WARNINGS,
   * AND NOW IT CANNOT DO OTHERWISE.
   *
   * ==> THE FIRST CUT OF §48.18 DELETED THEM ALONG WITH THE FIGURE. <== The
   * total is the storm's to imply and the warning is not: it is an agency's
   * statement about the reader's own address, true whichever storm they
   * tapped. §48.20 fixed that with a second scope tier inside the house block.
   *
   * ==> THE FIX IS STRUCTURAL NOW RATHER THAN CONDITIONAL, WHICH IS WHY THE
   * ASSERTIONS CHANGED SHAPE. <== The rows do not read the storm at all. So
   * these no longer prove that a rule fires correctly for a distant storm;
   * they prove there is no longer a rule that COULD get it wrong — the same
   * rendering for a near storm, a distant storm and no storm at all.
   * ===================================================================== */
  const nearStorm = await renderFlood(nws, LIVE, { id: 'g1', source: 'gdacs' });
  const noStorm = live;
  truthy('the warning renders with a storm on screen and with none',
    nearStorm.includes('Flash Flood Warning') && noStorm.includes('Flash Flood Warning'));
  truthy('with its area and its duration intact, either way',
    nearStorm.includes('Hawaii in Hawaii, HI') && nearStorm.includes('52 min left')
      && noStorm.includes('Hawaii in Hawaii, HI') && noStorm.includes('52 min left'));

  /* ==> AND NOTHING THAT WOULD IMPLY THE STORM CAUSED IT. <== No total, no
   * peak, no provenance line — those are the things whose POSITION under a
   * storm's name makes a claim, which is the whole of §48.18. */
  const missed = await renderRain(nws, LIVE, { reach: 'misses', distanceNm: 400 });
  truthy('a measured miss prints no rainfall figure for the house',
    !missed.includes('expected through') && !missed.includes('The heaviest'));
  /* ==> AND IT NOW PRINTS NO HOUSE BLOCK AT ALL, WHICH IS NOT A LOSS. <==
   * §48.20's warnings-only tier existed to carry the flood rows for exactly
   * this case, and those rows are `Flooding`'s now. What is left for the tier
   * to draw is nothing, so it draws nothing rather than a heading over an
   * explanation of why there is no number. Nothing on screen makes a claim,
   * which is the state §48.18 was reaching for. */
  truthy('and no house heading is left standing over an empty explanation',
    !missed.includes('At your house'));

  /* ==> BUT A STORM THAT DOES REACH STILL GETS ITS FIGURE. <== Without this,
   * the assertion above would pass on a house block that had simply stopped
   * rendering. */
  truthy('a storm that reaches the house still prints the total',
    rainLive.includes('At your house') && rainLive.includes('expected through'));

  truthy('the heaviest block names when it starts',
    /The heaviest[^<]*from [A-Z][a-z]{2} /.test(flat(rainLive)));

  /* ==> A FORECAST THAT HAS ENTIRELY RUN OUT IS NOT A FORECAST OF NO RAIN
   * (§48.19). <== Every block in these bytes ended days before this moment.
   * The honest answer is that the forecast has run out; "no meaningful rain
   * expected" would be an all-clear assembled from an absence. */
  const lapsed = await renderRain(nws, LIVE + 7 * 24 * 60 * 60 * 1000);
  truthy('a wholly elapsed forecast says it ran out, and does not say "no rain"',
    lapsed.includes('has run out') && !lapsed.includes('No meaningful rain'));
  truthy('and it offers a Retry, because a fresh fetch is the fix',
    lapsed.includes('data-retry="rain-house"'));
  truthy('and it prints no total at all',
    !lapsed.includes('expected through'));

  /* ==> THE TWO MEANINGS OF `alerts: null`, AND THEY MUST NOT SWAP (§48.16).
   * <== From NWS it is a hiccup and retryable; from the global model it is a
   * durable fact. Each case asserts the sentence it SHOULD have and the
   * absence of the other one, because a block that printed both would pass a
   * test that only looked for the right one.
   *
   * ==> AND NEITHER MAY READ AS THE ALL-CLEAR, WHICH IS THE WHOLE §5 POINT
   * AND IS NOW ASSERTABLE. <== Inside Rain there was no all-clear string to
   * confuse them with; `Flooding` has one, so "nothing is in force" and "we
   * could not find out" are three distinct outcomes that must stay distinct. */
  const hopFailed = await renderFlood(nwsNoAlertsHop, LIVE);
  truthy('a failed NWS alerts hop says so, and does not claim none are published',
    hopFailed.includes('could not be checked') &&
    !hopFailed.includes('aren’t published'));
  truthy('and a failed hop never reads as the all-clear',
    !flat(hopFailed).includes('No flood alerts are in force for your address'));

  const global = await renderFlood(openMeteo, LIVE);
  truthy('the global model says alerts are not published here, not that they failed',
    global.includes('aren’t published') &&
    !global.includes('could not be checked'));
  truthy('and that never reads as the all-clear either',
    !flat(global).includes('No flood alerts are in force for your address'));

  const clear = await renderFlood(nwsNoneInForce, LIVE);
  truthy('a successful hop with nothing in force IS the all-clear',
    flat(clear).includes('No flood alerts are in force for your address') &&
    !clear.includes('could not be checked') && !clear.includes('aren’t published'));

  /* THE ATTRIBUTION SENTENCE, which stays with the rainfall total: a gridded
   * total is all rain from all causes, and a figure under a storm's name reads
   * as that storm's doing unless it says otherwise. */
  truthy('the total is not attributed to the storm',
    rainLive.includes('not this') && rainLive.includes('storm alone'));
}

console.log(
  failures === 0
    ? '\nAll rainfall checks passed.\n'
    : `\n${failures} rainfall check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
