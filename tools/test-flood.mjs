#!/usr/bin/env node
/**
 * test-flood.mjs — §48.21's acceptance cases against real captured bytes.
 *
 * WHAT THIS IS FOR. This feature has three failures that all PARSE, none of
 * which throws, and every one of which produces a page that looks right:
 *
 *   1. A cone crossing the antimeridian measured as the whole planet, so every
 *      Central Pacific storm claims every flood warning in the country.
 *   2. An expired warning surviving in a held payload and being DRAWN, which
 *      tells somebody they are in danger when they are not.
 *   3. A watch with no polygon vanishing off the globe with no count saying so,
 *      which is §5's silence with a map over it.
 *
 * None of the three has a shape. All three are asserted here against bytes NWS
 * and NHC actually served: `samples/rain/alerts-hilo-hi.json` for the alerts
 * (five real products, two with polygons and three without) and
 * `samples/flood/cone-lala-cp2.geojson` for the seam, which is Lala's real
 * published cone off the archive branch.
 *
 * Zero dependencies. Run: node tools/test-flood.mjs
 */

process.env.TZ = 'Pacific/Honolulu';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const {
  inForce, extent, extentsOverlap, alertsInCone, coneSummary, isFloodFamily,
} = await import(path.join(ROOT, 'lib/flood.js'));
const { projectFlood } = await import(path.join(ROOT, 'functions/api/nws/flood.js'));

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
const near = (label, actual, expected, tol = 0.001) =>
  Math.abs(actual - expected) < tol ? ok(label) : fail(label, `expected ~${expected}, got ${actual}`);

const load = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

const RAW = load('samples/rain/alerts-hilo-hi.json');
const ROWS = projectFlood([RAW]).alerts;
/** The moment those alerts were live, pinned off the capture itself rather
 *  than typed, so the suite cannot drift from its own fixture. */
const LIVE = Date.parse(RAW.features[0].properties.sent);
const LALA_CONE = load('samples/flood/cone-lala-cp2.geojson').features[0].geometry;

/* ---------------------------------------------------------------------------
 * 1. THE RELAY PROJECTION
 * ------------------------------------------------------------------------- */
console.log('\nThe relay projection');
{
  const out = projectFlood([RAW]);
  eq('five alerts in the capture', out.total, 5);

  /* ==> THE COUNT THAT MATTERS IS NOT THE NUMBER OF ALERTS, IT IS THE NUMBER
   * THAT CAN BE DRAWN. <== Measured on these bytes: the Flash Flood Warning
   * and the Hurricane Warning carry polygons; the Flood Watch, the High Surf
   * Warning and the Tropical Cyclone Local Statement carry `geometry: null`
   * with zone lists instead. A layer drawing two of five while a sentence
   * claims five are on screen is the failure this pair of numbers prevents. */
  eq('and only two of them carry a shape', out.drawable, 2);

  const ffw = out.alerts.find((a) => a.event === 'Flash Flood Warning');
  const watch = out.alerts.find((a) => a.event === 'Flood Watch');

  truthy('the warning keeps its polygon', ffw.geometry?.type === 'Polygon');
  eq('and is marked drawable', ffw.drawable, true);
  eq('the watch has no geometry to keep', watch.geometry, null);
  /* STATED, NOT INFERRED FROM THE NULL. "We could not draw it" and "there was
   * nothing to draw" are different facts and only one is about the source. */
  eq('and says so rather than leaving it to be guessed', watch.drawable, false);

  /* THE AREA SURVIVES, WHOLE (§48.20). The reader is hunting for their own
   * zone in that list; truncating is how you hide it from them. */
  truthy('the watch keeps every zone it covers',
    /Maui Windward West/.test(watch.areaDesc) && /Big Island North/.test(watch.areaDesc));

  /* THE 55 KB OF TEXT AND POLYGON DETAIL STILL GOES. */
  const wire = JSON.stringify(out);
  truthy('description and instruction are gone',
    !wire.includes('WHAT...') && !wire.includes('instruction'));
  console.log(`      (5 alerts project to ${Buffer.byteLength(wire)} bytes)`);
}

/* ---------------------------------------------------------------------------
 * 2. WHAT IS IN FORCE
 * ------------------------------------------------------------------------- */
console.log('\nWhat is in force, at a moment somebody chose');
{
  const live = inForce(ROWS, LIVE);
  eq('all five are in force when they were sent', live.length, 5);

  /* ==> AN EXPIRED WARNING IS GONE FROM THE SAME PAYLOAD. <== The Hilo Flash
   * Flood Warning ran 52 minutes. The relay holds fifteen and the client three,
   * so a held payload can contain one that has run out — and on this surface
   * that is not a wrong sentence, it is a green box over somebody's house
   * saying they are in danger. Filtered at RENDER, not only at fetch. */
  const ends = Date.parse(
    RAW.features.find((f) => f.properties.event === 'Flash Flood Warning').properties.ends
  );
  const after = inForce(ROWS, ends + 60_000);
  truthy('a minute past its own expiry the warning is gone',
    !after.some((a) => a.event === 'Flash Flood Warning'));
  truthy('and the longer-lived ones are still there', after.length < 5 && after.length > 0);

  /* IMMEDIATE FIRST, THEN SOONEST TO END. A warning with twenty minutes left is
   * more use above one with eighteen hours. */
  truthy('immediate alerts sort first', live[0].immediate === true);

  /* ==> THE TENSE COMES FROM THE CLOCK, NEVER FROM `urgency` (§48.20). <== The
   * captured Flood Watch reads `urgency: Future` with an `onset` four hours in
   * the PAST, because the urgency is about when the HAZARD is expected and the
   * onset is about when the MESSAGE took effect. */
  const watch = live.find((a) => a.event === 'Flood Watch');
  eq('the watch reads urgency Future', watch.urgency, 'Future');
  truthy('its onset is already behind the moment it was sent', watch.onsetMs < LIVE);
  eq('so it has BEGUN, whatever its urgency says', watch.begun, true);

  /* ==> THE ROWS MUST BE THE SHAPE `ui/rain-alerts.js` READS, AND THE FIRST
   * BUILD WAS NOT. <== That builder is shared with the house block (§48.20)
   * and reads `area` and `remaining`. The relay projects NWS's own field name
   * `areaDesc` and carries no duration at all, so the first render of the
   * drawer block printed the event and the expiry and silently dropped BOTH
   * the affected area and the time left. Nothing threw; the row looked
   * finished. It was caught by rendering the block, not by a unit test of the
   * parser — which is exactly why this assertion exists at the seam rather
   * than a hundred lines downstream. */
  const ffw = live.find((a) => a.event === 'Flash Flood Warning');
  eq('the area is carried under the name the row builder reads',
    ffw.area, 'Hawaii in Hawaii, HI');
  eq('and the time left is computed, not left absent', ffw.remaining, '52 min left');
  truthy('NWS\u2019s own field name survives beside it, unrenamed',
    ffw.areaDesc === ffw.area);
}

/* ---------------------------------------------------------------------------
 * 3. THE SEAM — the bug that would have claimed the whole country
 * ------------------------------------------------------------------------- */
console.log('\nThe antimeridian');
{
  /* ==> THIS IS THE MOST IMPORTANT BLOCK IN THE FILE. <== Lala is a real
   * Central Pacific storm and her real published cone has vertices either side
   * of 180. A plain min/max bounding box measures it as -180..180 — the whole
   * planet — so every flood warning in the United States falls inside it.
   * Nothing throws. The sentence reads perfectly. */
  const e = extent(LALA_CONE);
  eq('her cone is measured as TWO longitude spans, not one', e.lon.length, 2);
  near('the eastern span starts at 177.1E', e.lon[0][0], 177.1477, 0.01);
  near('and the western one ends at 172.1W', e.lon[1][1], -172.1057, 0.01);
  near('south edge', e.south, 30.2489, 0.01);
  near('north edge', e.north, 41.0835, 0.01);

  /* THE WIDTH IS THE WHOLE POINT: about ten degrees, not three hundred and
   * sixty. Computed from the spans rather than typed. */
  const width = (180 - e.lon[0][0]) + (e.lon[1][1] + 180);
  near('so the cone is about 10.7 degrees wide, not 360', width, 10.7466, 0.01);

  /* AND THE CONSEQUENCE, ASSERTED ON THE REAL ALERTS. Hawaii is nowhere near
   * Lala's cone; before the fix every one of these matched. */
  eq('no Hawaii flood alert falls inside a Central Pacific cone',
    coneSummary(ROWS, LALA_CONE, LIVE).state, 'none_matched');

  /* A NON-CROSSING SHAPE IS STILL ONE SPAN. The fix must not turn every
   * ordinary cone into a two-piece extent. */
  const gulf = { type: 'Polygon', coordinates: [[[-95, 25], [-88, 25], [-88, 31], [-95, 31], [-95, 25]]] };
  eq('an ordinary cone is one span', extent(gulf).lon.length, 1);
  eq('and it is the plain box', extent(gulf).lon[0], [-95, -88]);

  /* THE OVERLAP TEST HAS TO CROSS THE SEAM TOO. A box just east of 180 and a
   * cone spanning it must meet. */
  const eastOf180 = { type: 'Polygon', coordinates: [[[178, 32], [179, 32], [179, 34], [178, 34], [178, 32]]] };
  truthy('a shape east of 180 meets a cone that crosses it',
    extentsOverlap(extent(eastOf180), extent(LALA_CONE)));
  const westOf180 = { type: 'Polygon', coordinates: [[[-178, 32], [-177, 32], [-177, 34], [-178, 34], [-178, 32]]] };
  truthy('and so does one west of it',
    extentsOverlap(extent(westOf180), extent(LALA_CONE)));
  /* AND SOMETHING GENUINELY OUTSIDE STILL MISSES, or the test above passes on
   * a function that returns true for everything. */
  const florida = { type: 'Polygon', coordinates: [[[-82, 25], [-80, 25], [-80, 28], [-82, 28], [-82, 25]]] };
  truthy('Florida does not meet a Central Pacific cone',
    !extentsOverlap(extent(florida), extent(LALA_CONE)));
}

/* ---------------------------------------------------------------------------
 * 4. MATCHING A STORM'S CONE
 * ------------------------------------------------------------------------- */
console.log('\nWhich alerts fall inside a cone');
{
  /* A box drawn round the Big Island, which is where these alerts are. */
  const overHawaii = {
    type: 'Polygon',
    coordinates: [[[-157, 18], [-154, 18], [-154, 21], [-157, 21], [-157, 18]]],
  };
  const s = coneSummary(ROWS, overHawaii, LIVE);
  eq('a cone over Hawaii matches', s.state, 'ok');

  /* ==> ONE, NOT TWO, AND THE HURRICANE WARNING IS WHY. <== It carries a
   * polygon over the same island and it is not a flood product. The route asks
   * upstream for three products by name so it should never arrive — but
   * `isFloodFamily` is the belt, because NWS renames products and a Coastal
   * Flood Advisory here would put a second answer beside §51's surge section. */
  eq('exactly one flood alert, not the Hurricane Warning beside it', s.total, 1);
  eq('and it is the Flash Flood Warning', s.alerts[0].event, 'Flash Flood Warning');
  eq('drawable', s.drawable, 1);
  eq('immediate', s.immediate, 1);

  truthy('the belt itself agrees',
    isFloodFamily('Flash Flood Warning') && isFloodFamily('Flood Watch') &&
    !isFloodFamily('Hurricane Warning') && !isFloodFamily('High Surf Warning'));

  /* ==> `no_cone` IS NOT `none_matched`, AND BOTH PRODUCE AN EMPTY LIST. <==
   * This is the §5 distinction this feature is most likely to get wrong. A
   * storm with no published cone has nothing to test against and the honest
   * answer is that we cannot say; a storm whose cone WAS tested and contained
   * nothing is a real all-clear. Rendering them the same is an all-clear built
   * from an absence. */
  eq('a storm with no cone cannot say', alertsInCone(ROWS, null).state, 'no_cone');
  eq('a storm with a cone and nothing in it CAN say',
    alertsInCone(ROWS, LALA_CONE).state, 'none_matched');

  /* AN EXPIRED ALERT DOES NOT MATCH A CONE EITHER. The expiry filter runs
   * before the geometry test, so a stale payload cannot paint a stale box. */
  const ends = Date.parse(
    RAW.features.find((f) => f.properties.event === 'Flash Flood Warning').properties.ends
  );
  eq('and an expired warning falls out before the cone is even asked',
    coneSummary(ROWS, overHawaii, ends + 60_000).state, 'none_matched');
}

/* ---------------------------------------------------------------------------
 * 5. MUTATIONS — each bug must change the answer
 * ------------------------------------------------------------------------- */
console.log('\nMutations — each bug must change the answer');
{
  /* Bug 1: the seam, measured as a plain min/max box. THE ONE THIS FEATURE
   * would have shipped. */
  const naive = (geom) => {
    const pts = [];
    const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
    for (const r of rings) pts.push(...r);
    const lons = pts.map((p) => p[0]);
    return [Math.min(...lons), Math.max(...lons)];
  };
  const [w, e] = naive(LALA_CONE);
  truthy('a plain min/max box on this cone spans the planet', e - w > 350);
  truthy('and the seam-aware one does not',
    extent(LALA_CONE).lon.every(([a, b]) => b - a < 180));

  /* Bug 2: filter expiry only at fetch. Same bytes, past the expiry. */
  const ends = Date.parse(
    RAW.features.find((f) => f.properties.event === 'Flash Flood Warning').properties.ends
  );
  truthy('an expired warning cannot survive a held payload',
    inForce(ROWS, LIVE).length !== inForce(ROWS, ends + 60_000).length);

  /* Bug 3: give a shapeless watch a shape. There is nothing to invent from —
   * asserted as the absence it is, so a later "helpful" default has something
   * to break. */
  const watch = ROWS.find((a) => a.event === 'Flood Watch');
  truthy('a watch is carried with no geometry and no substitute',
    watch.geometry === null && watch.drawable === false);

  /* Bug 4: infer the tense from `urgency`. The captured watch proves it wrong
   * on its own bytes. */
  const live = inForce(ROWS, LIVE);
  const w2 = live.find((a) => a.event === 'Flood Watch');
  truthy('urgency Future would say not-yet-begun and the clock says otherwise',
    w2.urgency === 'Future' && w2.begun === true);

  /* Bug 5: treat a missing cone as an empty cone. */
  truthy('no cone and an empty cone are different answers',
    alertsInCone(ROWS, null).state !== alertsInCone(ROWS, LALA_CONE).state);

  /* Bug 6: drop the flood-family belt and let a Hurricane Warning through. */
  const overHawaii = {
    type: 'Polygon',
    coordinates: [[[-157, 18], [-154, 18], [-154, 21], [-157, 21], [-157, 18]]],
  };
  const withBelt = coneSummary(ROWS, overHawaii, LIVE).total;
  const withoutBelt = ROWS.filter((a) =>
    a.geometry && extentsOverlap(extent(a.geometry), extent(overHawaii))).length;
  truthy('the belt is doing work — two shapes are over Hawaii and one is a flood',
    withoutBelt === 2 && withBelt === 1);
}

console.log(
  failures === 0
    ? '\n\u2713 flood: every acceptance case passes\n'
    : `\n\u2717 flood: ${failures} failure(s)\n`
);
process.exit(failures === 0 ? 0 : 1);
