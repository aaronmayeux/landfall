#!/usr/bin/env node
/**
 * test-zones.mjs — zone boundaries, and the join that gives a watch a shape. §56.4.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-zones.mjs`, like every suite here.
 *
 * ===========================================================================
 * THE FIXTURES ARE REAL BYTES AND THEY WERE UNREADABLE UNTIL 2026-08-23
 * ===========================================================================
 *
 * `api.weather.gov` is outside the sandbox wall and WebFetch comes back empty
 * against it — NWS answers 403 without a contact in the User-Agent and WebFetch
 * cannot set one. So until the archive runner fetched them, **no zone boundary
 * had ever been read by this project**: not its envelope, not its geometry
 * type, not its vertex count, not its byte cost. §12 forbids a parser written
 * on guesses about all four, which is why Phase 4 waited for these.
 *
 * `samples/flood/zones/` holds three of them verbatim, frozen off `archive`
 * because that branch's window is 72 hours and rolls:
 *
 *   HIZ023.geojson     Kona — a MULTIPOLYGON, the big one
 *   VAZ507.geojson     Northern Virginia Blue Ridge — a plain Polygon, the small one
 *   bulk-probe.geojson the collection endpoint's answer for all 23 zones at once
 *
 * ==> EVERY NUMBER BELOW IS RECOMPUTED OFF THOSE FILES, NEVER TYPED. <==
 * CLAUDE.md's first rule. Swap a fixture and these fail loudly rather than
 * quietly agreeing with a stale sentence.
 *
 * ===========================================================================
 * WHAT IT CANNOT PROVE
 * ===========================================================================
 *
 * That the ROUTE works. A Pages Function is not reachable from a sandbox and
 * neither is its upstream, so `projectZone` — the pure projection — is the only
 * part of `functions/api/nws/zone.js` anything here can stand on. The fetching,
 * the per-zone cache and the partial-failure assembly around it are unproven
 * until they run at the edge.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { splitUgc, zonesNeeded, applyZones } = await import(path.join(ROOT, 'lib/zones.js'));
const { projectZone } = await import(path.join(ROOT, 'functions/api/nws/zone.js'));
const { projectFlood } = await import(path.join(ROOT, 'functions/api/nws/flood.js'));
const { alertsNearTrack, trackChains, trackSamples } = await import(path.join(ROOT, 'lib/flood.js'));
const { RAIN } = await import(path.join(ROOT, 'config/constants.js'));

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

const load = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const bytes = (rel) => Buffer.byteLength(readFileSync(path.join(ROOT, rel)));
const vertices = (g) => {
  let n = 0;
  const walk = (c) => { if (typeof c[0] === 'number') { n++; return; } c.forEach(walk); };
  walk(g.coordinates);
  return n;
};

const KONA = load('samples/flood/zones/HIZ023.geojson');
const BLUE_RIDGE = load('samples/flood/zones/VAZ507.geojson');
const BULK = load('samples/flood/zones/bulk-probe.geojson');
const WATCHES = load('samples/flood/watches-national.json');

/* ---------------------------------------------------------------------------
 * 1. WHAT A ZONE BOUNDARY ACTUALLY IS
 * ------------------------------------------------------------------------- */
console.log('\nWhat a zone boundary actually is');
{
  /* ==> BOTH GEOMETRY TYPES ARE REAL AND A PARSER MUST HANDLE BOTH. <== Kona
   * is a MultiPolygon because the zone includes offshore islands; the Blue
   * Ridge zone is a plain Polygon. Handling only one would have been the
   * obvious guess and it would have been wrong half the time. */
  eq('a zone with islands is a MultiPolygon', KONA.geometry.type, 'MultiPolygon');
  eq('and one without is a plain Polygon', BLUE_RIDGE.geometry.type, 'Polygon');

  /* THE SPREAD IS ENORMOUS AND THE PROJECTION IS WHY THIS ROUTE EXISTS. */
  const konaFile = bytes('samples/flood/zones/HIZ023.geojson');
  const konaGeom = Buffer.byteLength(JSON.stringify(KONA.geometry));
  truthy('the served document is far bigger than the boundary in it',
    konaFile > konaGeom * 4);
  console.log(`      (Kona: ${konaFile} bytes served, ${konaGeom} of them geometry, `
    + `${vertices(KONA.geometry)} vertices)`);
  console.log(`      (Blue Ridge: ${bytes('samples/flood/zones/VAZ507.geojson')} bytes served, `
    + `${vertices(BLUE_RIDGE.geometry)} vertices)`);

  /* THE TWO FIELDS THE PROJECTION KEEPS BESIDE THE SHAPE. §56.2 established
   * that a watch's areaDesc names zones and never a state, so this is where the
   * state comes from. */
  eq('the zone knows its own name', KONA.properties.name, 'Kona');
  eq('and its state', KONA.properties.state, 'HI');
}

/* ---------------------------------------------------------------------------
 * 2. THE BULK PROBE — ==> IT ANSWERS, AND IT ANSWERS WITHOUT SHAPES <==
 * ------------------------------------------------------------------------- */
console.log('\nThe bulk endpoint, asked for the first time');
{
  /* §56.4 priced zone resolution at one request per zone and §48.21 rejected
   * the whole feature on that arithmetic. The collection endpoint was the hope
   * that would delete the objection. It half does: one request DOES return
   * every zone asked for. */
  eq('one request came back with every zone in the id list',
    BULK.features.length, splitUgc(
      WATCHES.features.flatMap((f) => f.properties.geocode.UGC)).forecast.length);

  /* ==> AND EVERY ONE OF THEM HAS A NULL GEOMETRY. <== Which is the whole
   * finding. The list endpoint serves metadata; boundaries come one at a time.
   * The per-zone loop is not an implementation choice, it is the only route. */
  eq('and not one of them carries a boundary',
    BULK.features.filter((f) => f.geometry).length, 0);
}

/* ---------------------------------------------------------------------------
 * 3. THE PROJECTION
 * ------------------------------------------------------------------------- */
console.log('\nThe relay projection');
{
  const kona = projectZone(KONA);
  eq('it keeps the name', kona.name, 'Kona');
  eq('and the state', kona.state, 'HI');
  eq('and the geometry type', kona.geometry.type, 'MultiPolygon');

  /* ==> NOT ONE VERTEX IS DROPPED. <== §56.4 permits fetching NWS's boundary
   * precisely because it is NWS's boundary. Rounding moves a point by
   * centimetres; dropping one would make the shape ours. */
  eq('every vertex survives the rounding',
    vertices(kona.geometry), vertices(KONA.geometry));

  /* FOUR DECIMAL PLACES, WHICH IS ABOUT ELEVEN METRES. */
  const places = (n) => { const s = String(n); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
  let worst = 0;
  const walk = (c) => {
    if (typeof c[0] === 'number') { worst = Math.max(worst, places(c[0]), places(c[1])); return; }
    c.forEach(walk);
  };
  walk(kona.geometry.coordinates);
  truthy(`no coordinate is finer than ${RAIN.zoneWireDecimals} places (worst: ${worst})`,
    worst <= RAIN.zoneWireDecimals);

  /* AND THE SAVING IS REAL, computed rather than claimed. */
  const before = Buffer.byteLength(JSON.stringify(KONA.geometry));
  const after = Buffer.byteLength(JSON.stringify(kona.geometry));
  truthy('the rounded boundary is smaller than the published one', after < before);
  console.log(`      (${before} bytes of coordinates become ${after} — `
    + `${(100 - (100 * after) / before).toFixed(1)}%)`);

  /* THE OBSERVATION STATIONS, THE OFFICE URLS AND THE DATES ALL GO. */
  const wire = JSON.stringify(kona);
  truthy('nothing but name, state and shape crosses the wire',
    !wire.includes('observationStations') && !wire.includes('forecastOffice')
    && !wire.includes('effectiveDate'));

  /* ==> A BODY WITH NO BOUNDARY IS NULL, NOT AN EMPTY SHAPE. <== The bulk
   * endpoint returns exactly this, and an empty MultiPolygon would draw
   * nothing while counting as placed — §5 with a coordinate array. */
  eq('a zone document with no geometry projects to null',
    projectZone(BULK.features[0]), null);
  eq('and so does junk', projectZone(null), null);
}

/* ---------------------------------------------------------------------------
 * 4. THE JOIN — a watch gets a shape
 * ------------------------------------------------------------------------- */
console.log('\nThe join: a watch with no shape gets one');

/** The three real watches, through the real relay projection. */
const ALERTS = projectFlood([WATCHES]).alerts;
/** The two boundaries this repo holds, keyed the way the route returns them. */
const ZONE_MAP = {
  HIZ023: projectZone(KONA),
  VAZ507: projectZone(BLUE_RIDGE),
};
{
  truthy('every captured watch arrives with no geometry',
    ALERTS.every((a) => a.geometry === null));

  const needed = zonesNeeded(ALERTS);
  eq('the join asks for every zone across every shapeless alert',
    needed, splitUgc(WATCHES.features.flatMap((f) => f.properties.geocode.UGC)).forecast);
  truthy('which is more than one watch’s worth', needed.length > 8);

  const joined = applyZones(ALERTS, ZONE_MAP);
  const hawaii = joined.find((a) => a.zones.includes('HIZ023'));
  const virginia = joined.find((a) => a.zones.includes('VAZ507'));
  const pennsylvania = joined.find((a) => a.zones.some((z) => z.startsWith('PA')));

  eq('the Hawaii watch now has a shape', hawaii.geometry.type, 'MultiPolygon');
  eq('and it is marked drawable', hawaii.drawable, true);
  /* ==> AND IT SAYS THE SHAPE DID NOT COME OFF THE ALERT. <== A forecaster drew
   * a warning's polygon for that warning; this one is a boundary fetched
   * separately and joined here, and a surface that wants to word that
   * difference has to be able to see it. */
  eq('and says the shape came from its zones', hawaii.placedFromZones, true);

  /* ==> THE PARTIAL RESOLVE IS NAMED, NOT SMOOTHED OVER. <== This repo holds
   * one of the eight Hawaii boundaries, so the shape drawn is smaller than the
   * watch's real area. Presenting that as the whole is the §5 failure this
   * feature exists to avoid. */
  eq('the seven zones that did not resolve are named',
    hawaii.zonesUnresolved, hawaii.zones.filter((z) => z !== 'HIZ023'));
  truthy('which is most of them', hawaii.zonesUnresolved.length === hawaii.zones.length - 1);

  /* ==> THE SHAPE IS THE UNION OF NWS's OWN RINGS AND NOTHING ELSE. <== Every
   * ring in the joined geometry is a ring that came out of a zone document. */
  eq('every ring in it came from the zone boundary',
    hawaii.geometry.coordinates.length, projectZone(KONA).geometry.coordinates.length);

  eq('a watch whose only held zone is a plain Polygon still gets a MultiPolygon',
    virginia.geometry.type, 'MultiPolygon');
  eq('and carries exactly that one ring', virginia.geometry.coordinates.length, 1);

  /* ==> AND ONE WHOSE ZONES ALL FAILED KEEPS ITS NULL. <== Said and not drawn.
   * Never dropped, never given a substitute shape (§48.21). */
  eq('the watch with no boundaries at all is still shapeless',
    pennsylvania.geometry, null);
  eq('and is not claimed to be drawable', pennsylvania.drawable, false);
  eq('and says so', pennsylvania.placedFromZones, false);
  eq('and names every zone it is missing',
    pennsylvania.zonesUnresolved, pennsylvania.zones);

  /* AN ALERT THAT ALREADY HAD A SHAPE IS RETURNED UNTOUCHED, BY IDENTITY. */
  const warning = { event: 'Flood Warning', geometry: { type: 'Polygon', coordinates: [] }, zones: [], counties: ['HIC001'] };
  eq('an alert that already had a polygon is not asked about',
    zonesNeeded([warning]), []);
  truthy('and passes through the join by identity',
    applyZones([warning], ZONE_MAP)[0] === warning);
}

/* ---------------------------------------------------------------------------
 * 5. WHAT THE JOIN UNLOCKS — the watch can now be MATCHED
 * ------------------------------------------------------------------------- */
console.log('\nWhat it unlocks: a watch can be measured against a track');
{
  /* This is the whole point of Phase 4. Before the join, a watch could not be
   * matched to a storm at all — there was nothing to measure a distance from,
   * so it was held back and counted. */
  const past = load('samples/flood/track-lala-cp2-past.geojson');
  const forecast = load('samples/flood/track-lala-cp2-forecast.geojson');
  const samples = trackSamples(trackChains(past, forecast));

  const before = alertsNearTrack(ALERTS, samples);
  eq('before the join, nothing matches Lala', before.state, 'none_matched');
  eq('and all three watches are counted as unplaceable', before.unplaceable, ALERTS.length);

  const after = alertsNearTrack(applyZones(ALERTS, ZONE_MAP), samples);
  /* ==> LALA IS A HAWAII STORM AND KONA IS A HAWAII ZONE. <== The match is a
   * measured distance, not an assumption: it holds because the boundary is
   * genuinely inside the corridor, and the two zones that did not resolve stay
   * counted rather than forgotten. */
  eq('after it, the Hawaii watch is inside the corridor', after.state, 'ok');
  eq('exactly one watch matched', after.total, 1);
  truthy('and it is the one with the Hawaii boundary',
    after.alerts[0].zones.includes('HIZ023'));
  truthy(`measured, not assumed (${after.alerts[0].nearestNm.toFixed(1)} nm, corridor ${RAIN.floodCorridorNm} nm)`,
    after.alerts[0].nearestNm < RAIN.floodCorridorNm);
  eq('the watch that never got a shape is still counted as unplaceable',
    after.unplaceable, 1);
}

/* ------------------------------------------------------------------------- */

if (failures) {
  console.error(`\n✗ zones: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log('\n✓ zones: every acceptance case passes\n');
