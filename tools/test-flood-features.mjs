#!/usr/bin/env node
/**
 * test-flood-features.mjs — §56.5's "one list, two sources" contract, against
 * real captured bytes.
 *
 * WHAT THIS IS FOR. The globe draws flood alerts from TWO sources — polygons
 * in one, clusterable points in the other — because MapLibre clusters `Point`
 * geometry only. Two sources is two chances to disagree, and every way they
 * can disagree looks fine on screen:
 *
 *   1. A shape with no chip over it. Invisible below the polygon zoom gate,
 *      which is exactly where the chips are the only thing carrying the layer.
 *   2. A chip with no shape under it. A marker claiming a hazard whose extent
 *      this app cannot draw.
 *   3. An expired alert surviving in a held payload and being painted, which
 *      tells somebody they are in danger when they are not.
 *   4. A chip placed by the cheap arithmetic — the bounding-box centre — which
 *      §56.2 measured landing in the wrong county one time in five.
 *
 * The defence against all four is that ONE function walks ONE list and emits
 * both collections, so there is never a second list to keep in step. This file
 * is the proof that it does, on the same national capture the feature ships
 * against.
 *
 * Bytes:
 *   samples/flood/alerts-national.json   every US flood alert in force at
 *                                        2026-08-22T22:29:35Z off the archive
 *                                        branch — 36 alerts, 33 with polygons,
 *                                        3 without
 *
 * Zero dependencies. Run: node tools/test-flood-features.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { floodSources } = await import(path.join(ROOT, 'lib/flood-features.js'));
const { pointInRings, largestRingSet } = await import(path.join(ROOT, 'lib/interior-point.js'));

let failures = 0;
const ok = (label) => console.log(`  ✓ ${label}`);
const fail = (label, detail) => {
  failures++;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
};
const truthy = (label, v) => (v ? ok(label) : fail(label));
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  a === e ? ok(label) : fail(label, `expected ${e}\n      actual   ${a}`);
};
const section = (n) => console.log(`\n  ${n}`);

const load = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

const national = load('samples/flood/alerts-national.json');
const alerts = national.alerts;

/* The capture was taken at this moment, so every alert in it is in force AT
 * this moment. Anchoring the clock here rather than to `Date.now()` is what
 * keeps this suite from going red on the day the fixture ages out — and the
 * expiry behaviour is asserted deliberately below rather than by accident of
 * when the runner happens to execute. */
const CAPTURED_AT = Date.parse(national.fetchedAt);

/* ---------------------------------------------------------------------------
 * 1. THE TWO SOURCES AGREE, ALERT FOR ALERT
 * ------------------------------------------------------------------------- */

section('one list in, two sources out, on the real national capture');

truthy('the capture carries a usable timestamp', Number.isFinite(CAPTURED_AT));
eq('and 36 alerts', alerts.length, 36);

const out = floodSources(alerts, CAPTURED_AT);

eq('all 36 are in force at the moment they were captured', out.live, 36);
eq('33 of them carry a shape', out.drawn, 33);
eq('and every one of those got a chip', out.iconless, 0);

eq('so the shape source holds 33 features', out.shapes.features.length, 33);
eq('and the point source holds 33 features', out.points.features.length, 33);

/* ==> THE IDS ARE THE SAME SET, IN THE SAME ORDER. <== Equal counts is the
 * weak version of this assertion and would pass while the two sources
 * described different alerts. The tap handler resolves BOTH by `_id`, so the
 * ids are what actually have to match. */
const shapeIds = out.shapes.features.map((f) => f.properties._id);
const pointIds = out.points.features.map((f) => f.properties._id);
eq('the two sources name the same alerts, in the same order', shapeIds, pointIds);
eq('and no id is null', shapeIds.filter((i) => !i), []);
eq('and none is repeated', shapeIds.length - new Set(shapeIds).size, 0);

/* ==> EVERY CHIP IS INSIDE ITS OWN SHAPE. <== §56.5's acceptance case, checked
 * here across the pair rather than shape by shape: this is the assertion that
 * a chip is never floating over a county the polygon does not cover. */
const strays = [];
for (let i = 0; i < out.points.features.length; i++) {
  const pt = out.points.features[i].geometry.coordinates;
  const rings = largestRingSet(out.shapes.features[i].geometry);
  if (!pointInRings(pt[0], pt[1], rings)) strays.push(shapeIds[i]);
}
eq('every chip falls inside the polygon it belongs to', strays, []);

/* ---------------------------------------------------------------------------
 * 2. THE SHAPELESS ALERTS
 * ------------------------------------------------------------------------- */

section('an alert with no shape is counted, never defaulted');

const shapeless = alerts.filter((a) => !a.geometry);
eq('the capture holds 3 alerts with no geometry', shapeless.length, 3);

eq('none of them reaches the shape source', out.shapes.features.length, alerts.length - 3);
eq('and none of them reaches the point source', out.points.features.length, alerts.length - 3);

/* ==> AND NOTHING WAS INVENTED FOR THEM. <== A zone centroid, a circle, a
 * bbox — any of them would be this app drawing a boundary NWS did not draw.
 * The difference between `live` and `drawn` is where they went, and it is the
 * number the status row reads. */
eq('the gap between live and drawn is exactly those three', out.live - out.drawn, 3);

/* ---------------------------------------------------------------------------
 * 3. EXPIRY, FILTERED AT RENDER
 * ------------------------------------------------------------------------- */

section('expiry is filtered here and not only at fetch');

/* ==> THE CAPTURED HILO WARNING RAN 52 MINUTES. <== A payload held even three
 * minutes can contain one that has run out, and an expired warning painted on
 * a map tells somebody they are in danger when they are not. Wind the clock
 * forward a day over the same bytes and the globe has to empty. */
const DAY = 24 * 60 * 60 * 1000;
const later = floodSources(alerts, CAPTURED_AT + DAY);
truthy('a day after the capture, fewer alerts are in force', later.live < out.live);
eq('and the two sources shrink together',
  later.shapes.features.length, later.points.features.length);

const week = floodSources(alerts, CAPTURED_AT + 7 * DAY);
eq('a week later nothing is in force at all', week.live, 0);
eq('the shape source is empty', week.shapes.features.length, 0);
eq('and so is the point source', week.points.features.length, 0);

/* ---------------------------------------------------------------------------
 * 4. THE PROPERTIES BOTH SOURCES CARRY
 * ------------------------------------------------------------------------- */

section('what rides on a feature, and why each field is there');

const oneShape = out.shapes.features[0];
const onePoint = out.points.features[0];

eq('a shape and its chip carry identical properties',
  oneShape.properties, onePoint.properties);
eq('and the fields are exactly the three the paint and the tap need',
  Object.keys(oneShape.properties).sort(), ['_event', '_id', '_watch']);

/* ==> `_watch` COMES OFF THE EVENT TEXT, NOT OFF `severity`. <== Measured on
 * real bytes: a Flood Watch and a Flash Flood Warning both report
 * `severity: "Severe"`, so the field cannot separate them and the paint would
 * draw a watch in the warning shade. */
const severities = new Set(alerts.map((a) => a.severity));
truthy('every alert in the capture reports the same severity', severities.size === 1);

const watchRow = { id: 'w', event: 'Flood Watch', severity: 'Severe',
  expires: new Date(CAPTURED_AT + DAY).toISOString(),
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } };
const warnRow = { ...watchRow, id: 'r', event: 'Flash Flood Warning' };

const pair = floodSources([watchRow, warnRow], CAPTURED_AT);
eq('a Flood Watch is flagged as a watch', pair.shapes.features[0].properties._watch, true);
eq('and a Flash Flood Warning is not', pair.shapes.features[1].properties._watch, false);

/* ---------------------------------------------------------------------------
 * 5. THE REFUSAL, AND THE COUNT THAT MAKES IT VISIBLE
 * ------------------------------------------------------------------------- */

section('a shape that produces no chip is counted, not faked');

/* A zero-area ring is a real thing to receive. `interiorPoint` refuses it
 * rather than reaching for the bbox centre, so the alert keeps its polygon and
 * loses its chip — and `iconless` is what stops that being silent. */
const degenerate = {
  id: 'd', event: 'Flood Warning',
  expires: new Date(CAPTURED_AT + DAY).toISOString(),
  geometry: { type: 'Polygon', coordinates: [[[5, 5], [5, 6], [5, 5], [5, 5]]] },
};
const withBad = floodSources([degenerate], CAPTURED_AT);

eq('it is in force', withBad.live, 1);
eq('it keeps its polygon', withBad.drawn, 1);
eq('it gets no chip', withBad.points.features.length, 0);
eq('and the layer can say so', withBad.iconless, 1);

/* ==> THE MUTATION THAT MATTERS HERE. <== If a future change reaches for the
 * bounding-box centre to keep the counts tidy, `iconless` goes to 0 and the
 * point source gains a feature. Both assertions above go red together, which
 * is the pair that says "somebody put the guess back". */

/* ---------------------------------------------------------------------------
 * 6. THE EMPTY CASES
 * ------------------------------------------------------------------------- */

section('nothing in, nothing out, and no throwing');

for (const [label, input] of [['null', null], ['undefined', undefined], ['an empty list', []]]) {
  const e = floodSources(input, CAPTURED_AT);
  eq(`${label} gives an empty shape source`, e.shapes.features.length, 0);
  eq(`${label} gives an empty point source`, e.points.features.length, 0);
  eq(`${label} counts nothing live`, e.live, 0);
}

/* Both collections are always well-formed GeoJSON, even empty. A layer handed
 * `undefined` for `data` throws inside MapLibre and takes the engine with it. */
const empty = floodSources([], CAPTURED_AT);
eq('and an empty source is still a FeatureCollection', empty.shapes.type, 'FeatureCollection');
eq('with a real features array', Array.isArray(empty.points.features), true);

console.log(
  failures === 0
    ? '\n✓ flood-features: every acceptance case passes\n'
    : `\n✗ flood-features: ${failures} failure(s)\n`
);
process.exit(failures === 0 ? 0 : 1);
