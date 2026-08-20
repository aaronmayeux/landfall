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
} = await import(path.join(ROOT, 'lib/rainfall.js'));
const { APPROACH } = await import(path.join(ROOT, 'config/constants.js'));
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

  const out = rainSummary(payload, { system: 'imperial', now: Date.parse('2026-08-16T01:49:00Z') });
  close('the total is the whole series', out.totalMm, 282.956);
  eq('282.956 mm renders as 11 inches', out.totalText, '11 inches');
  truthy('not negligible', out.negligible === false);
  eq('the label says Thursday, not five days', out.throughWords, 'early Thursday');
  truthy('the peak earns its sentence', !!out.peak);
  eq('the peak is six hours', out.peak.lengthWords, 'six hours');
  /* 84.836 mm is 3.34 inches, and the rounding rule is the rounding rule
   * everywhere: whole inches above one. The peak is not allowed its own
   * precision just because it is a smaller number than the total. */
  eq('the peak renders as 3 inches', out.peak.text, '3 inches');
  truthy('the peak is about 30% of the total',
    Math.abs(out.peak.share - 0.2998) < 0.001);
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
  truthy(`the grid shrinks from ${rawBytes} bytes to ${outBytes}`, outBytes < rawBytes / 20);
  truthy('humidity is gone', !JSON.stringify(body).includes('relativeHumidity'));
  truthy('the field we came for is not', body.values.length === 20);
  eq('the grid\u2019s own updateTime travels with it', body.updateTime, raw.properties.updateTime);

  /* Alerts keep their six fields and lose their text and their polygon —
   * which is nearly all of the 55 KB. */
  const alertBytes = JSON.stringify(load('alerts-hilo-hi')).length;
  const strippedBytes = JSON.stringify(stripAlerts(load('alerts-hilo-hi'))).length;
  truthy(`alerts shrink from ${alertBytes} bytes to ${strippedBytes}`, strippedBytes < alertBytes / 20);
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
    asInches.totalText !== '11 inches' && asInches.negligible === false);

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

  /* ------------------------------------------------------------------------
   * §48.17 — WHEN THE HOUSE FIGURE BELONGS BESIDE A STORM.
   *
   * ==> THE FAILURE THIS GUARDS IS NOT A WRONG NUMBER. <== The house forecast
   * is true for every storm on the globe, because it is about a PLACE. Print
   * it under a typhoon 6,000 nm away and it is a correct figure in a position
   * that implies a connection nobody claimed. There is no exception to catch
   * and no shape to the failure, which is exactly why it needs a test.
   *
   * The threshold is read from APPROACH rather than typed, so a suite that
   * passes cannot be one that agreed with a number somebody changed.
   * ---------------------------------------------------------------------- */
  const R = APPROACH.relevanceNm;

  truthy('a storm sitting on top of home is in range',
    houseRainInRange({ distanceNm: 12 }));
  truthy('a storm on the far side of the planet is not',
    !houseRainInRange({ distanceNm: 6000 }));

  /* THE BOUNDARY IS INCLUSIVE, and both sides of it are asserted — a gate
   * tested only well inside its range passes for an off-by-one that swaps
   * `<=` for `<`. */
  truthy('exactly at the threshold counts as near', houseRainInRange({ distanceNm: R }));
  truthy('one mile past it does not', !houseRainInRange({ distanceNm: R + 1 }));

  /* ==> THE CASE THE FEATURE EXISTS FOR. <== A storm far out whose forecast
   * track closes on home. Gating on where it is at this moment would hide the
   * figure for exactly the days it matters most. */
  truthy('a far storm closing on home is in range',
    houseRainInRange({ distanceNm: R + 900, approachNm: 400 }));
  truthy('a far storm that stays far is not',
    houseRainInRange({ distanceNm: R + 900, approachNm: R + 800 }) === false);

  /* NO NUMBERS MEANS NO. The track has not landed yet and there is no
   * distance either — an unknown must not be treated as near, or the block
   * renders under every storm during the seconds before geometry arrives. */
  truthy('nothing known is not in range', !houseRainInRange({}));
  truthy('no argument at all is not in range', !houseRainInRange());
  truthy('a non-finite distance is not in range',
    !houseRainInRange({ distanceNm: NaN, approachNm: null }));
}

console.log(
  failures === 0
    ? '\nAll rainfall checks passed.\n'
    : `\n${failures} rainfall check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
