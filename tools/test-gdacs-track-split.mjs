#!/usr/bin/env node
/**
 * test-gdacs-track-split.mjs — which half of a GDACS track is history (§32.6).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-gdacs-track-split.mjs`.
 *
 * ===========================================================================
 * WHAT THIS IS ABOUT
 * ===========================================================================
 *
 * GDACS stamps every `Line_*` track segment with a `forecast` boolean, and the
 * app believed it. On 2026-08-21 EIGHTEEN-26 shipped ELEVEN segments all
 * marked `forecast: true`, four of which the storm had already travelled. The
 * past-track slot came back empty, so the whole track — history included —
 * drew in the forecast's solid line rather than the dotted one. Aaron saw it
 * on glass before any of this existed.
 *
 * `splitTrackLines` dates each segment from the timestep dots' own clock
 * instead, and keeps GDACS's flag only where it cannot.
 *
 * ===========================================================================
 * BOTH FIXTURES ARE REAL BYTES OFF THE ARCHIVE, VERBATIM
 * ===========================================================================
 *
 *   samples/gdacs/geometry-TC-mislabelled-track.json
 *     EIGHTEEN-26, eventid 1001307 episode 5, captured 2026-08-21T20:54Z.
 *     THE DEFECT ITSELF. 12 dots, 11 segments, every one flagged forecast.
 *
 *   samples/gdacs/geometry-TC.json
 *     A healthy storm, already in the repo. THE CONTROL — it proves the
 *     correction does not fire where the source is telling the truth, which
 *     is the half of this that could silently break 90% of storms.
 *
 * Every number below was MEASURED by running the shipped function against
 * those files. None was chosen to make an assertion pass.
 *
 * ===========================================================================
 * WHAT THIS CANNOT PROVE
 * ===========================================================================
 *
 * That the repaired track LOOKS right — that the dotted half reads as history
 * and meets the solid half cleanly at the current position. That is glass and
 * it is Aaron's. This proves only which segments land in which slot.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

const { splitTrackLines } = await import('../data/gdacs-points.js');

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const eq = (a, b, m) => ok(a === b, `${m} (got ${a}, want ${b})`);
const section = (n) => console.log(`\n  ${n}`);

const load = (f) => JSON.parse(fs.readFileSync(`samples/gdacs/${f}`, 'utf8'));

/** The issue time the app reads: `polygondate` off any timestep dot (§32.4). */
function issueOf(features) {
  const dot = features.find((f) => f?.properties?.featuretype === 'PointRadii');
  return Date.parse(`${dot.properties.polygondate}Z`);
}

const lineFeatures = (features) =>
  features.filter((f) => String(f?.properties?.Class || '').startsWith('Line_'));

/* ===========================================================================
 * 1. THE DEFECT — EIGHTEEN-26, and what the raw bytes actually say
 * ======================================================================== */
section('1. the mislabelled payload, as published');

const BAD = load('geometry-TC-mislabelled-track.json');
const badLines = lineFeatures(BAD.features);
const badIssue = issueOf(BAD.features);

eq(badLines.length, 11, 'EIGHTEEN publishes 11 track segments');
eq(
  badLines.filter((f) => String(f.properties.forecast) === 'true').length,
  11,
  'ALL ELEVEN are flagged forecast — this is the bug, in the bytes'
);
eq(
  new Date(badIssue).toISOString(),
  '2026-08-21T18:00:00.000Z',
  'issue time reads off polygondate'
);

/* The dots disagree with the flags, and that disagreement is the evidence. */
const badDots = BAD.features.filter((f) =>
  String(f?.properties?.Class || '').startsWith('Point_Polygon_Point_')
);
eq(badDots.length, 12, 'twelve timestep dots — one more than the segments');
eq(
  badDots.filter((f) => Date.parse(`${
    // "20/08 18:00 UTC" -> the dot's OWN time, not polygondate
    f.properties.polygonlabel.replace(
      /^(\d{2})\/(\d{2}) (\d{2}:\d{2}) UTC$/,
      '2026-$2-$1T$3:00'
    )}Z`) < badIssue).length,
  4,
  'four of those dots predate the issue — four segments of real history'
);

/* ===========================================================================
 * 2. THE REPAIR
 * ======================================================================== */
section('2. the split, dated from the dots');

const fixed = splitTrackLines(BAD.features, badIssue);

eq(fixed.pastTrack.length, 4, 'four segments land in the past slot');
eq(fixed.forecastTrack.length, 7, 'seven land in the forecast slot');
eq(fixed.corrected, 4, 'four corrections announced');
eq(fixed.undated, 0, 'every segment was datable — nothing fell back to the flag');
eq(
  fixed.pastTrack.length + fixed.forecastTrack.length,
  badLines.length,
  'no segment is lost or duplicated by the split'
);

/* ==> THE SPECIFIC FOUR, BY NAME. <== A count alone would pass if the
 * function moved the WRONG four, which on a track that loops back over itself
 * is a live possibility rather than a theoretical one. */
eq(
  fixed.pastTrack.map((f) => f.properties.Class).sort().join(','),
  'Line_Line_0,Line_Line_3,Line_Line_7,Line_Line_9',
  'the past half is exactly the four segments joining the four stale dots'
);

/* THE SEAM. The analysis dot is 21/08 18:00 at [108.8, 21.0]. The segment
 * arriving there is past; the one leaving is forecast; they share the vertex.
 * That shared vertex is what makes the dotted and solid halves meet at the
 * current position instead of overlapping or gapping. */
const ANALYSIS = [108.8, 21.0];
const touches = (f) =>
  f.geometry.coordinates.some(
    (c) => Math.abs(c[0] - ANALYSIS[0]) < 1e-6 && Math.abs(c[1] - ANALYSIS[1]) < 1e-6
  );
eq(fixed.pastTrack.filter(touches).length, 1, 'exactly one past segment ends at the analysis dot');
eq(
  fixed.forecastTrack.filter(touches).length,
  1,
  'exactly one forecast segment starts at the analysis dot'
);

/* ===========================================================================
 * 3. THE CONTROL — a healthy storm must not move
 * ======================================================================== */
section('3. the control: a payload whose flags are right');

const GOOD = load('geometry-TC.json');
const goodIssue = issueOf(GOOD.features);
const goodLines = lineFeatures(GOOD.features);
const flagged = goodLines.filter((f) => String(f.properties.forecast) === 'true').length;
const kept = splitTrackLines(GOOD.features, goodIssue);

eq(goodLines.length, 22, 'the control publishes 22 segments');
eq(flagged, 8, 'eight of them flagged forecast');
eq(kept.corrected, 0, '==> NOTHING IS CORRECTED. The flags and the clock agree. <==');
eq(kept.undated, 0, 'and every segment was datable, so agreement was actually tested');
eq(kept.forecastTrack.length, flagged, 'the forecast slot matches the published flag exactly');
eq(kept.pastTrack.length, goodLines.length - flagged, 'and so does the past slot');

/* ===========================================================================
 * 4. FALLING BACK RATHER THAN GUESSING (§5)
 * ======================================================================== */
section('4. what happens when the clock is unreadable');

/* An unreadable issue time means no analysis position, so nothing can be
 * dated. The published flag has to stand — the alternative is a coin toss
 * dressed as a measurement. */
const blind = splitTrackLines(BAD.features, NaN);
eq(blind.corrected, 0, 'no issue time → no corrections');
eq(blind.undated, badLines.length, 'every segment reported as undated');
eq(
  blind.forecastTrack.length,
  11,
  "and every one keeps GDACS's flag — the old behaviour, not a guess"
);

/* A segment whose endpoints match no dot cannot be dated either. Built by
 * MOVING one real segment far from the track rather than by inventing a
 * feature, so everything else about it stays true to the payload. */
const orphaned = BAD.features.map((f) =>
  f.properties.Class === 'Line_Line_5'
    ? { ...f, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }
    : f
);
const partial = splitTrackLines(orphaned, badIssue);
eq(partial.undated, 1, 'one segment could not be tied to a dot');
eq(partial.corrected, 4, 'the other ten are still judged on their own merits');
eq(
  partial.forecastTrack.some((f) => f.properties.Class === 'Line_Line_5'),
  true,
  'the orphan keeps its published flag rather than being dropped or guessed'
);

/* ==> AND THE SAME TEST WITH THE FLAG POINTING THE OTHER WAY. <== Every one of
 * EIGHTEEN's segments is flagged forecast, so the case above cannot tell
 * "kept the flag" apart from "defaulted to forecast" — they give the same
 * answer. The control has past-flagged segments, so orphaning one of those is
 * the only version of this that actually distinguishes the two. */
const goodPast = goodLines.find((f) => String(f.properties.forecast) !== 'true');
const orphanedPast = GOOD.features.map((f) =>
  f.properties.Class === goodPast.properties.Class
    ? { ...f, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }
    : f
);
const keptFlag = splitTrackLines(orphanedPast, goodIssue);
eq(keptFlag.undated, 1, 'the control orphan is undated too');
eq(
  keptFlag.pastTrack.some((f) => f.properties.Class === goodPast.properties.Class),
  true,
  '==> an undatable PAST segment stays past. A default to forecast fails here. <=='
);
eq(keptFlag.corrected, 0, 'and orphaning one segment does not disturb the other 21');

/* ===========================================================================
 * 5. NO SEGMENT IS INVENTED OR LOST, ON EITHER FIXTURE
 * ======================================================================== */
section('5. conservation');

for (const [name, raw, issue] of [
  ['EIGHTEEN', BAD, badIssue],
  ['control', GOOD, goodIssue],
]) {
  const r = splitTrackLines(raw.features, issue);
  const out = [...r.pastTrack, ...r.forecastTrack].map((f) => f.properties.Class).sort();
  const src = lineFeatures(raw.features).map((f) => f.properties.Class).sort();
  eq(out.join(','), src.join(','), `${name}: the same segments come out that went in`);
}

/* ======================================================================== */
if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (whether the repaired track READS right is glass)');
