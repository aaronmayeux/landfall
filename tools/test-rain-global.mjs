#!/usr/bin/env node
/**
 * test-rain-global.mjs — §48.14's acceptance cases against real bytes.
 *
 * WHAT THIS IS FOR, AND IT IS ONE CLAIM. §48.15's whole design is that
 * `/api/rain/global` serves the SAME BODY `/api/nws/rainfall` serves, so that
 * `lib/rainfall.js` never learns there are two sources and not one line of
 * arithmetic, windowing or wording is duplicated. That claim is either true or
 * the app has two rainfall parsers that will drift. This suite asserts it by
 * running Open-Meteo's real bytes through the new projection and then through
 * the EXISTING reader — the same `readSeries`, `windowTotalMm` and
 * `rainSummary` the American path uses, with no adapter in between.
 *
 * The bytes are Manila, fetched by the archive runner on 2026-08-19: 72 hourly
 * values, no nulls, no gaps, `mm` and ISO-8601 on a UTC base.
 *
 * ==> THE TRAP IS THE INTERVAL, AND IT IS SILENT. <== §48.4: `validTime` is an
 * instant, a solidus and an ISO 8601 duration. Open-Meteo sends a bare
 * `2026-08-19T00:00` with no zone and no length. Emitting that unchanged
 * parses to nothing and the section reads "no rainfall forecast" over a real
 * forecast; emitting it with the wrong duration sums an hour as six. Neither
 * throws.
 *
 * ==> EVERY ASSERTION HERE WAS VERIFIED TO FAIL WITH THE RULE BROKEN. <==
 * SPEC §12. The mutations run were — emitting the bare timestamp with no
 * interval, changing `PT1H` to `PT6H`, dropping the units lookup and assuming
 * mm, and defaulting `provenance()` to `open-meteo` instead of `nws`.
 *
 * ==> THE CLOCK AND THE ZONE ARE PINNED, for `test-rainfall.mjs`'s reason: the
 * "through" label is the reader's own local day.
 *
 * Zero dependencies. Run: node tools/test-rain-global.mjs
 */

process.env.TZ = 'UTC';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'samples/rain');

const { readSeries, windowTotalMm, rainSummary, provenance, parseInterval } =
  await import(path.join(ROOT, 'lib/rainfall.js'));
const { projectOpenMeteo } = await import(path.join(ROOT, 'functions/api/rain/global.js'));

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

if (new Date('2026-08-19T00:00:00Z').getTimezoneOffset() !== 0) {
  console.error('TZ pin did not take — this suite computes UTC day labels and cannot run.');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(path.join(SAMPLES, 'openmeteo-manila-ph.json'), 'utf8'));
const relayed = projectOpenMeteo({ body: raw, fetchedAt: '2026-08-19T18:26:52.000Z' });

/* ---------------------------------------------------------------------------
 * THE PROJECTION
 * ------------------------------------------------------------------------- */
console.log('\nprojection — Open-Meteo\u2019s arrays become NWS\u2019s shape');

eq('every hourly value survives', relayed.values.length, 72);
eq('the raw payload really had 72', raw.hourly.time.length, 72);
eq('and none of them was null', raw.hourly.precipitation.filter((v) => v == null).length, 0);

/* ==> THE UNIT IS READ, NEVER ASSUMED (§48.4). <== It happens to be mm on
 * both sources, which is exactly the coincidence that makes assuming it look
 * safe until the day it is not. */
eq('the source states millimetres', raw.hourly_units.precipitation, 'mm');
eq('and the projection declares the code the reader expects', relayed.uom, 'wmoUnit:mm');
eq(
  'an unrecognised unit yields no series rather than a guess',
  projectOpenMeteo({ body: { ...raw, hourly_units: { precipitation: 'furlongs' } } }).values,
  null
);

/* ==> THE INTERVAL IS BUILT TO NWS'S GRAMMAR AND IT MUST PARSE. <== */
eq('the first interval is an instant, a solidus and a duration',
  relayed.values[0].validTime, '2026-08-19T00:00:00+00:00/PT1H');
const span = parseInterval(relayed.values[0].validTime);
truthy('and the existing parser reads it', span);
eq('as exactly one hour', span.endMs - span.startMs, 3600000);
eq('starting at the stated instant', span.startMs, Date.parse('2026-08-19T00:00:00Z'));

/* ---------------------------------------------------------------------------
 * THROUGH THE EXISTING READER, UNCHANGED
 * ------------------------------------------------------------------------- */
console.log('\nthe same reader the American path uses — no second parser');

const series = readSeries(relayed);
eq('readSeries accepts it with no adapter', series.state, 'ok');
eq('and finds every block', series.blocks.length, 72);

/* The total, computed from the source's own numbers rather than restated. If
 * the projection ever multiplies by a wrong factor, this is the line that
 * moves — and it moves silently everywhere else. */
const expectedMm = raw.hourly.precipitation.reduce((s, v) => s + v, 0);
close('the 120-hour total matches the raw sum', windowTotalMm(series.blocks, 120), expectedMm);
truthy('and the capture really has rain in it', expectedMm > 0);

const out = rainSummary(relayed, { system: 'metric', now: Date.parse('2026-08-19T00:00:00Z') });
eq('rainSummary reads it', out.state, 'ok');
truthy('and produces a figure', typeof out.totalText === 'string' && out.totalText.endsWith('mm'));
truthy('with an end label from the last block it actually has', !!out.throughWords);

/* ---------------------------------------------------------------------------
 * PROVENANCE — the one field that differs, and it decides two sentences
 * ------------------------------------------------------------------------- */
console.log('\nprovenance — which source answered, and what "no alerts" means');

eq('the global payload names itself', out.provider.name, 'open-meteo');

/* ==> THE COORDINATE THE MODEL ANSWERED FOR, NOT THE ONE ASKED. <== Measured:
 * 14.5995/120.9842 went up and 14.586995/121.002785 came back. §48.10's risk
 * is a reader comparing this figure against an advisory without knowing which
 * point it is for, and this is the only thing on either surface that says. */
close('it reports the snapped grid latitude', out.provider.gridLat, 14.586995);
close('and the snapped grid longitude', out.provider.gridLon, 121.002785);
truthy('which is NOT the coordinate that was asked for',
  Math.abs(out.provider.gridLat - 14.5995) > 0.001);

/* ==> `alerts: null` MEANS TWO DIFFERENT THINGS AND THIS IS WHAT SEPARATES
 * THEM (§48.16, §5). <== From NWS it means the alerts hop failed and what is
 * in force is UNKNOWN — retryable. From here it means no flood-warning source
 * exists for this place at all — a durable fact. Collapsing them puts "could
 * not be checked just now" under a house that will never get an answer. */
eq('the global source never claims to know about warnings', out.provider.alertsKnown, false);
eq('an NWS payload with alerts does', provenance({ alerts: [] }).alertsKnown, true);
eq('an NWS payload with a failed alerts hop does not', provenance({ alerts: null }).alertsKnown, false);

/* ==> A PAYLOAD WITH NO `provider` IS NWS, AND THAT KEEPS EVERY OLD FIXTURE
 * HONEST. <== `/api/nws/rainfall` predates the second source and sends no such
 * field. Defaulting to null instead would relabel the whole of `samples/rain/`
 * — which is what `test-rainfall.mjs` runs against — as coming from nowhere. */
eq('a payload with no provider field is the American one', provenance({}).name, 'nws');
eq('and a stray value is not trusted', provenance({ provider: 'somewhere-else' }).name, 'nws');

/* ---------------------------------------------------------------------------
 * THE SHAPES OF NOTHING
 * ------------------------------------------------------------------------- */
console.log('\nthe shapes of nothing — never an empty series');

/* ==> A 200 WITH NO SERIES IS NOT "NO RAIN HERE". <== This model covers the
 * planet, so it cannot report a place as uncovered. Emitting `values: []`
 * would read downstream as a forecast of nothing, which is a claim nobody
 * made; `values: null` reads as unreadable, which is the truth. */
eq('an empty body yields no series rather than an empty one',
  projectOpenMeteo({ body: {} }).values, null);
eq('and readSeries calls that not_covered rather than dry',
  readSeries(projectOpenMeteo({ body: {} })).state, 'not_covered');

/* A null inside the series is a gap, not a dry hour. Never seen in the
 * archive; asserted because summing one as zero would quietly shrink a total
 * with nothing to show for it. */
const holed = projectOpenMeteo({
  body: {
    hourly_units: { precipitation: 'mm' },
    hourly: { time: ['2026-08-19T00:00', '2026-08-19T01:00'], precipitation: [3, null] },
  },
});
eq('a null hour is dropped, not zeroed', holed.values.length, 1);
close('so the total is the hour we actually have', windowTotalMm(readSeries(holed).blocks, 120), 3);

/* ------------------------------------------------------------------------- */
console.log(
  failures === 0
    ? '\n\u2713 rain-global: every acceptance case passes\n'
    : `\n\u2717 rain-global: ${failures} failure(s)\n`
);
process.exit(failures === 0 ? 0 : 1);
