#!/usr/bin/env node
/**
 * test-flood.mjs — §48.21 and §56.3's acceptance cases against real captured
 * bytes.
 *
 * WHAT THIS IS FOR. This feature has failures that all PARSE, none of which
 * throws, and every one of which produces a page that looks right:
 *
 *   1. A match that claims far more than it should, silently. Until 2026-08-22
 *      the test was a bounding-box overlap with the forecast cone, and a cone
 *      crossing the antimeridian measured as the whole planet — so every
 *      Central Pacific storm claimed every flood warning in the country.
 *   2. An expired warning surviving in a held payload and being DRAWN, which
 *      tells somebody they are in danger when they are not.
 *   3. A watch with no polygon vanishing off the globe with no count saying so,
 *      which is §5's silence with a map over it.
 *   4. A match that claims too LITTLE, which is the new one. A cone is where
 *      the CENTRE might go; the flooding is hundreds of miles away and days
 *      later. §56.3 replaced the cone with a distance from the whole track,
 *      past and forecast, and this file is the proof that the distance finds
 *      the inland river flooding a cone was missing.
 *
 * None of the four has a shape. All four are asserted here against bytes NWS
 * and NHC actually served:
 *
 *   samples/rain/alerts-hilo-hi.json          five real products, two with
 *                                             polygons and three without
 *   samples/flood/alerts-national.json        every US flood alert in force at
 *                                             2026-08-22T22:29:35Z, off the
 *                                             archive branch — 36 of them, 33
 *                                             drawable
 *   samples/flood/track-lala-cp2-*.geojson    Lala's real published past and
 *                                             forecast tracks, the Central
 *                                             Pacific storm whose cone broke
 *                                             the old match
 *   samples/ida-al092021/fstadv/…019.txt      NHC's own advisory-19 positions
 *                                             for Ida, the inland-flooding
 *                                             case §56.3 exists for
 *
 * Zero dependencies. Run: node tools/test-flood.mjs
 */

process.env.TZ = 'Pacific/Honolulu';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const {
  inForce, trackChains, trackSamples, alertsNearTrack, corridorSummary,
  isFloodFamily, stormSamples, homeInCorridor,
} = await import(path.join(ROOT, 'lib/flood.js'));
/* The measurement moved to its own file (§56.18); this suite still asserts
 * against the EXACT one, which is what defines correct for the fast path. */
const { nearestNm } = await import(path.join(ROOT, 'lib/shape-distance.js'));
const { greatCircleNm } = await import(path.join(ROOT, 'lib/geo.js'));
const { RAIN } = await import(path.join(ROOT, 'config/constants.js'));
const { projectFlood } = await import(path.join(ROOT, 'functions/api/nws/flood.js'));
const { parseTcm } = await import(path.join(ROOT, 'tools/tcm-fixture.mjs'));

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
const near = (label, actual, expected, tol = 0.001) =>
  Math.abs(actual - expected) < tol ? ok(label) : fail(label, `expected ~${expected}, got ${actual}`);

const load = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

/* ---------------------------------------------------------------------------
 * FIXTURE HELPERS
 * ------------------------------------------------------------------------- */

/** A one-line FeatureCollection, the shape the geometry bundle's track slots
 *  carry. Built here rather than committed, because a two-point line is not
 *  data — it is a probe. */
const lineFc = (coordinates) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }],
});

/** A tiny square about a point, for the seam probe. */
const polyAt = (lon, lat, d = 0.05) => ({
  type: 'Polygon',
  coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d],
    [lon - d, lat + d], [lon - d, lat - d]]],
});

/** A shape's bounding-box centre, expressed as a degenerate one-point polygon
 *  so `nearestNm` can measure it. ==> ONLY FOR THE MUTATION IN §5. <== §56.2
 *  measured five of twenty-five bbox centres falling OUTSIDE their own polygon,
 *  every one a river corridor. Nothing in the shipped path may use this. */
const bboxCentreAsShape = (geometry) => {
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  }
  const c = [(w + e) / 2, (s + n) / 2];
  return { type: 'Polygon', coordinates: [[c, c, c, c]] };
};

/** `nearestNm` with no prefilter at all — every vertex against every sample.
 *  The reference the optimised one is checked against. */
const bruteNearestNm = (geometry, samples) => {
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  let best = Infinity;
  for (const s of samples) {
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        const d = greatCircleNm(s.lon, s.lat, lon, lat);
        if (d < best) best = d;
      }
    }
  }
  return best;
};

/* ---------------------------------------------------------------------------
 * THE FIXTURES
 * ------------------------------------------------------------------------- */

const RAW = load('samples/rain/alerts-hilo-hi.json');
const ROWS = projectFlood([RAW]).alerts;
/** The moment those alerts were live, pinned off the capture itself rather
 *  than typed, so the suite cannot drift from its own fixture. */
const LIVE = Date.parse(RAW.features[0].properties.sent);
/** When the Hilo Flash Flood Warning ran out. Read off the bytes, used in three
 *  places, so it is named once. */
const FFW_ENDS = Date.parse(
  RAW.features.find((f) => f.properties.event === 'Flash Flood Warning').properties.ends);

const LALA_CONE = load('samples/flood/cone-lala-cp2.geojson').features[0].geometry;

/** Every US flood alert in force in one real hour. §56.2 measured the shape of
 *  this set; the volume is one snapshot on a day with no US landfall. */
const NATIONAL = load('samples/flood/alerts-national.json').alerts;
/** A moment they were all live, taken off the capture rather than typed. */
const NATIONAL_LIVE = Date.parse(NATIONAL[0].onset);

/** ==> LALA'S PAST TRACK IS FOURTEEN SEPARATE LineString FEATURES. <== Not one.
 *  The mapserver publishes it in segments, which is why `trackChains` keeps
 *  chains apart instead of flattening them. */
const LALA_CHAINS = trackChains(
  load('samples/flood/track-lala-cp2-past.geojson'),
  load('samples/flood/track-lala-cp2-forecast.geojson'));
const LALA_SAMPLES = trackSamples(LALA_CHAINS);
/** Her two arms on their own, for §56.9's past-arm case. */
const LALA_PAST_SAMPLES = trackSamples(
  trackChains(load('samples/flood/track-lala-cp2-past.geojson')));
const LALA_FCST_SAMPLES = trackSamples(
  trackChains(load('samples/flood/track-lala-cp2-forecast.geojson')));
/** A house, as `nearestNm` wants it. */
const asPoint = (home) => ({ type: 'Point', coordinates: [home.lon, home.lat] });

/** Ida's advisory 19: her analysed position followed by NHC's six forecast
 *  points, parsed out of the Forecast/Advisory rather than transcribed. */
const IDA = parseTcm(
  readFileSync(path.join(ROOT, 'samples/ida-al092021/fstadv/al092021.fstadv.019.txt'), 'utf8'),
  { id: 'ida', sourceId: 'al092021' });
const IDA_CHAINS = trackChains(lineFc(
  [[IDA.storm.lon, IDA.storm.lat], ...IDA.forecast.map((f) => [f.lon, f.lat])]));
const IDA_SAMPLES = trackSamples(IDA_CHAINS);

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

  /* THE AREA SURVIVES, WHOLE (§56.7). The reader is hunting for their own
   * zone in that list; truncating is how you hide it from them. */
  truthy('the watch keeps every zone it covers',
    /Maui Windward West/.test(watch.areaDesc) && /Big Island North/.test(watch.areaDesc));

  /* -------------------------------------------------------------------------
   * THE ZONE CODES SURVIVE THE RELAY (§56.4)
   *
   * ==> A WATCH HAS NO SHAPE, SO ITS ZONE LIST IS THE ONLY ROUTE TO ONE. <==
   * And the client never sees the upstream body, so a field dropped here is
   * gone for good. These assertions are the guard on that.
   *
   * ==> EVERY COUNT BELOW IS RECOMPUTED OFF THE FIXTURE, NEVER TYPED. <==
   * CLAUDE.md's first rule. Swap the capture for a busier hour and these fail
   * loudly instead of quietly agreeing with a stale sentence.
   * ---------------------------------------------------------------------- */
  const ugcOf = (event) =>
    RAW.features.find((f) => f.properties.event === event).properties.geocode.UGC;

  eq('the watch keeps every forecast zone NWS named',
    watch.zones, [...new Set(ugcOf('Flood Watch'))].sort());
  truthy('which is more than one, or this proves nothing', watch.zones.length > 1);

  /* ==> AND THE STATE COMES BACK WITH THEM, WHICH IS THE POINT. <== §56.2
   * measured that a watch's `areaDesc` names zones and never a state. The
   * two-letter prefix on these codes is the only place in the whole payload
   * that says which state this watch is about. */
  eq('and every one of them carries the state as its prefix',
    [...new Set(watch.zones.map((z) => z.slice(0, 2)))], ['HI']);

  /* ==> THE WARNING IS GEOCODED TO A COUNTY, NOT A ZONE, AND THAT IS MEASURED
   * HERE RATHER THAN ASSUMED. <== The captured Flash Flood Warning names
   * `HIC001` — a `C` code. Every code in the captured WATCHES is a `Z`, which
   * is exactly the coincidence §56.4's mutation pass caught; the warnings in
   * the same capture are the counter-example, and they are real bytes. A
   * resolver that lumped the two together would build `/zones/forecast/HIC001`
   * and get a 404 indistinguishable from a zone NWS does not publish. */
  eq('the warning is geocoded to a county', ugcOf('Flash Flood Warning'), ['HIC001']);
  eq('so it lands in counties, never in zones', ffw.counties, ['HIC001']);
  eq('and its zone list is honestly empty', ffw.zones, []);

  /* ZERO IS THE NORMAL ANSWER, AND ANYTHING ELSE MEANS THE FEED CHANGED SHAPE
   * UNDER US. Without this number, a pattern that has stopped matching looks
   * exactly like a batch of alerts that named no zones (§5). */
  eq('nothing in this capture is unreadable', out.ugcUnread, 0);

  /* ==> AND THE COUNTER IS PROVEN ON A CODE THAT CANNOT BE READ, BECAUSE THE
   * ASSERTION ABOVE DOES NOT PROVE IT. <== Every code in every capture this
   * project holds is well formed, so `ugcUnread === 0` passes whether the
   * arithmetic works or is hardwired to zero — verified: hardwiring it changed
   * nothing. §12 calls a test that passes on the same assumption as the bug
   * worse than no test, so here is the half that fails when it is hardwired.
   * The SHAPE is real bytes; only these four codes are made up, which is the
   * one thing a fixture may invent — a classifier's inputs, not a payload. */
  const junk = projectFlood([{ features: [{ geometry: null, properties: {
    event: 'Flood Watch', geocode: { UGC: ['HIZ001', 'HI0001', 'nonsense', '   '] } } }] }]);
  eq('a code in no shape this app knows is counted, not swallowed', junk.ugcUnread, 2);
  eq('a blank one is skipped rather than counted as a fault', junk.alerts[0].counties, []);
  eq('and the readable zone beside them still comes through', junk.alerts[0].zones, ['HIZ001']);

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

  /* ==> THE TENSE COMES FROM THE CLOCK, NEVER FROM `urgency` (§56.7). <== The
   * captured Flood Watch reads `urgency: Future` with an `onset` four hours in
   * the PAST, because the urgency is about when the HAZARD is expected and the
   * onset is about when the MESSAGE took effect. */
  const watch = live.find((a) => a.event === 'Flood Watch');
  eq('the watch reads urgency Future', watch.urgency, 'Future');
  truthy('its onset is already behind the moment it was sent', watch.onsetMs < LIVE);
  eq('so it has BEGUN, whatever its urgency says', watch.begun, true);

  /* ==> THE ROWS MUST BE THE SHAPE `ui/rain-alerts.js` READS, AND THE FIRST
   * BUILD WAS NOT. <== That builder is the `Flooding` section's row on both
   * screens (§56.7) and reads `area` and `remaining`. The relay projects NWS's
   * own field name `areaDesc` and carries no duration at all, so the first
   * render printed the event and the expiry and silently dropped BOTH
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
 * 3. THE SEAM — the bug the corridor DELETED rather than solved
 * ------------------------------------------------------------------------- */
console.log('\nThe antimeridian, and why there is nothing left to get wrong');
{
  /* ==> THIS BLOCK IS THE RECORD OF A DELETED BUG AND IT IS WORTH ITS LINES.
   * <== Lala is a real Central Pacific storm and her real published cone has
   * vertices either side of 180. Until 2026-08-22 the match was a bounding-box
   * overlap against that cone, and a plain min/max box measures it as
   * -180..180 — the whole planet — so every flood warning in the United States
   * fell inside it. Nothing threw. The sentence read perfectly. The fix at the
   * time was `extent()`: 60 lines measuring longitude in two frames and picking
   * the narrower.
   *
   * §56.3 deleted all of it. The match is now a great-circle distance, which
   * has no frames and no seam, because `greatCircleNm` is built on
   * `sin(dLon/2)²` and that is periodic in 360°. The two assertions below are
   * the before and the after, on the same storm and the same alerts. */
  const naiveSpan = (geom) => {
    const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
    const lons = rings.flat().map((p) => p[0]);
    return Math.max(...lons) - Math.min(...lons);
  };
  truthy('a plain box on her real cone still spans the planet',
    naiveSpan(LALA_CONE) > 350);

  /* AND THE CORRIDOR'S ANSWER ON THE SAME STORM, AGAINST 36 REAL ALERTS. */
  eq('her real track matches none of the national alerts',
    corridorSummary(NATIONAL, LALA_SAMPLES, NATIONAL_LIVE, 300).state, 'none_matched');

  /* HOW WRONG THE BOX WAS, IN ONE NUMBER. Measured off these bytes: the
   * nearest US flood alert to Lala's track is most of an ocean away. */
  let nearest = Infinity;
  for (const a of NATIONAL) {
    if (!a.geometry) continue;
    const d = nearestNm(a.geometry, LALA_SAMPLES);
    if (d < nearest) nearest = d;
  }
  near('the nearest one is 1,966 nm from her track', nearest, 1966, 1);
  console.log(`      (a box said all ${NATIONAL.filter((a) => a.geometry).length}; the corridor says none, at ${Math.round(nearest).toLocaleString()} nm)`);

  /* THE SEAM CANNOT COME BACK THROUGH AN UNWRAPPED LONGITUDE EITHER.
   * `lib/trackline.js` unwraps longitudes before splining, so a track crossing
   * 180 westward reaches this file carrying values past -180. Asserted rather
   * than assumed, because it is the one way a distance test could still grow a
   * frame. */
  const at190 = trackSamples(trackChains(lineFc([[-190, 30], [-189, 30]])));
  const atMinus170 = trackSamples(trackChains(lineFc([[170, 30], [171, 30]])));
  const box = polyAt(170.5, 30);
  near('an unwrapped -190 and a plain 170 are the same place to the corridor',
    nearestNm(box, at190), nearestNm(box, atMinus170), 0.5);
}

/* ---------------------------------------------------------------------------
 * 4. THE CORRIDOR — a real inland track against real alerts
 * ------------------------------------------------------------------------- */
console.log('\nWhich alerts come near a track');
{
  /* ==> IDA IS HERE BECAUSE SHE IS THE CASE §56.3 IS ABOUT. <== A cone is
   * where the CENTRE might go. Ida drowned New Jersey while her centre was
   * over Pennsylvania, and the flooding that killed people was hundreds of
   * miles from the middle of the storm. Her advisory 19 track — NHC's own
   * published positions, off `samples/ida-al092021/` — runs from Mississippi
   * to the New Jersey coast.
   *
   * ==> THE PAIRING IS CONSTRUCTED AND THIS COMMENT SAYS SO. <== These are
   * 2021 track positions measured against 2026 flood alerts. Nothing here
   * claims Ida caused any of them; the assertion is about geometry, which is
   * all `alertsNearTrack` ever claims. Both halves are real published bytes
   * and the distances between them are real distances. */
  const s = corridorSummary(NATIONAL, IDA_SAMPLES, NATIONAL_LIVE, 300);
  eq('a track up the Ohio valley matches', s.state, 'ok');
  eq('25 of the 33 drawable alerts fall within 300 nm', s.total, 25);
  eq('and every one of them can be drawn', s.drawable, 25);

  /* ==> THE WABASH CLUSTER IS THE WHOLE ARGUMENT FOR THE CORRIDOR. <== §56.2
   * measured fifteen of twenty-five alerts sitting in one line along the
   * Wabash valley in Indiana and Illinois. They are 170 to 300 nm from this
   * track — far outside any forecast cone, and exactly the inland river
   * flooding a cone-shaped search was missing. */
  const wabash = s.alerts.filter((a) => /\b(IN|IL)\b/.test(a.areaDesc));
  truthy('the Indiana and Illinois river warnings are in it', wabash.length >= 12);
  truthy('and every one of them is further out than 150 nm',
    wabash.every((a) => a.nearestNm > 150));

  /* THE RADIUS IS DOING WORK IN BOTH DIRECTIONS, or the test above passes on
   * a function that matches everything. Computed, not typed. */
  const tight = corridorSummary(NATIONAL, IDA_SAMPLES, NATIONAL_LIVE, 200).total;
  const wide = corridorSummary(NATIONAL, IDA_SAMPLES, NATIONAL_LIVE, 500).total;
  truthy(`200 nm finds fewer and 500 nm finds more (${tight} < 25 < ${wide})`,
    tight < 25 && wide > 25);

  /* EVERY MATCH CARRIES HOW CLOSE IT ACTUALLY CAME, and it is inside the
   * radius it was matched on. A row that can say a distance is a row that is
   * not asserting a cause. */
  truthy('each match carries its own distance, and it is under the radius',
    s.alerts.every((a) => Number.isFinite(a.nearestNm) && a.nearestNm <= 300));
  eq('and the summary carries the radius it used, for the sentence',
    s.radiusNm, 300);

  /* THE BELT. The Hilo capture has a Hurricane Warning with a polygon over the
   * same island as its flood warning; the route asks upstream for three
   * products by name so it should never arrive, but NWS renames products. */
  const overHawaii = trackSamples(trackChains(lineFc([[-155.5, 19.4], [-155.0, 20.0]])));
  const h = corridorSummary(ROWS, overHawaii, LIVE, 300);
  eq('a track over Hawaii matches', h.state, 'ok');
  eq('exactly one flood alert, not the Hurricane Warning beside it', h.total, 1);
  eq('and it is the Flash Flood Warning', h.alerts[0].event, 'Flash Flood Warning');
  eq('drawable', h.drawable, 1);
  eq('immediate', h.immediate, 1);

  truthy('the belt itself agrees',
    isFloodFamily('Flash Flood Warning') && isFloodFamily('Flood Watch') &&
    !isFloodFamily('Hurricane Warning') && !isFloodFamily('High Surf Warning'));

  /* ==> `no_track` IS NOT `none_matched`, AND BOTH PRODUCE AN EMPTY LIST. <==
   * The §5 distinction this feature is most likely to get wrong. A storm with
   * no published track has nothing to measure against and the honest answer is
   * that we cannot say; a storm whose track WAS measured and came near nothing
   * is a real all-clear. Rendering them the same is an all-clear built from an
   * absence. */
  eq('a storm with no track cannot say', alertsNearTrack(ROWS, []).state, 'no_track');
  eq('and neither can one whose track slots are empty',
    alertsNearTrack(ROWS, trackSamples(trackChains(null, null))).state, 'no_track');
  eq('a storm with a track and nothing near it CAN say',
    alertsNearTrack(ROWS, trackSamples(trackChains(
      lineFc([[-30, 40], [-25, 42]])))).state, 'none_matched');

  /* ==> THE PAST TRACK IS NOT DECORATION, AND THIS IS THE MEASUREMENT THAT
   * PROVES IT. <== §56.3 includes the past track because a storm that has
   * already crossed a region is still flooding it — the water arrives after
   * the wind leaves. Lala is the case, on her own real bytes: she came out of
   * the East Pacific past Hawaii and is now up at 30–41N, so her FORECAST
   * track is most of a thousand miles from the Hilo flash flood warning while
   * her PAST track is twenty-two. A forecast-only match — which is
   * approximately what a cone is — misses it entirely. */
  const ffw = ROWS.find((a) => a.event === 'Flash Flood Warning');
  const pastOnly = trackSamples(trackChains(load('samples/flood/track-lala-cp2-past.geojson')));
  const fcstOnly = trackSamples(trackChains(load('samples/flood/track-lala-cp2-forecast.geojson')));
  near('her past track passes 22 nm from the Hilo warning',
    nearestNm(ffw.geometry, pastOnly), 21.9, 0.2);
  near('her forecast track is 1,083 nm from it', nearestNm(ffw.geometry, fcstOnly), 1083.4, 0.5);
  truthy('so a forecast-only match would drop it and the joined track keeps it',
    nearestNm(ffw.geometry, fcstOnly) > 300 && nearestNm(ffw.geometry, LALA_SAMPLES) < 300);

  /* AN EXPIRED ALERT DOES NOT MATCH A CORRIDOR EITHER. The expiry filter runs
   * before the geometry test, so a stale payload cannot paint a stale box. */
  eq('an expired warning falls out before the distance is even measured',
    corridorSummary(ROWS, overHawaii, FFW_ENDS + 60_000, 300).state, 'none_matched');
}

/* ---------------------------------------------------------------------------
 * 5. MUTATIONS — each bug must change the answer
 * ------------------------------------------------------------------------- */
/* ---------------------------------------------------------------------------
 * 5. THE HOUSE IN THE CORRIDOR (§56.9)
 *
 * ==> ONE RADIUS, ASKED THE OTHER WAY ROUND. <== Everything above measures an
 * ALERT against a track. This measures a HOUSE against the same track with the
 * same function and the same constant, which is the whole of §56.9: the
 * question "which alerts belong to this storm" and the question "does this
 * storm reach my house" stopped being two questions on 2026-08-22.
 *
 * ==> AND IDA IS THE FIXTURE FOR A REASON. <== She is the storm §56.3 was
 * written around: her centre was over Pennsylvania while New Jersey drowned.
 * Every figure below is measured off NHC's own advisory-19 positions at run
 * time, not transcribed.
 * ------------------------------------------------------------------------- */
console.log('\nThe house in the corridor');
{
  /* Real addresses, real coordinates. Newark is Ida's flooding; New Orleans is
   * her landfall; Chicago is the near miss that decides whether the radius is
   * doing anything; Honolulu is the other side of the planet. */
  const NEWARK = { lat: 40.735, lon: -74.172 };
  const NEW_ORLEANS = { lat: 29.95, lon: -90.07 };
  const CHICAGO = { lat: 41.88, lon: -87.63 };
  const HONOLULU = { lat: 21.31, lon: -157.86 };

  const ida = (home, opts = {}) =>
    homeInCorridor({ storm: IDA.storm, forecast: IDA.forecast, home, ...opts });

  /* ==> A DISTANCE COMES BACK AT ALL, AND THIS IS ASSERTED FIRST FOR A REASON.
   * <== It is the `Point` branch in `nearestNm` — the one line that lets a
   * house be measured by the same function as a county. Without this case,
   * deleting that branch fails the suite with a TypeError out of a template
   * string three assertions later: red, but naming the wrong thing. */
  const nmOf = (r) => (Number.isFinite(r.nm) ? r.nm.toFixed(0) : 'no answer');
  truthy('a house is a shape this can measure',
    Number.isFinite(ida(NEWARK).nm));
  truthy('and so is a house measured against a bare position',
    Number.isFinite(homeInCorridor({ storm: IDA.storm, home: NEWARK }).nm));

  /* ==> THE CASE THE WHOLE FEATURE EXISTS FOR. <== Ida's centre at advisory 19
   * is in Mississippi and Newark is 915 nm from it. Her forecast track runs to
   * within 74. A gate on where the storm IS would have shown a New Jersey
   * reader nothing on the day New Jersey flooded. */
  const newark = ida(NEWARK);
  truthy(`Newark is ${nmOf(newark)} nm from Ida's track and inside`,
    newark.inside === true && newark.nm < 100);
  const newarkNow = homeInCorridor({ storm: IDA.storm, home: NEWARK });
  truthy(`and ${nmOf(newarkNow)} nm from where she actually is, which is outside`,
    newarkNow.inside === false && newarkNow.nm > 900);

  /* ==> WHICH IS THE ONE-DIRECTIONAL PROPERTY, ASSERTED. <== The samples always
   * carry the storm's own position, and track samples are added to them, so
   * the nearest distance can only fall as the geometry lands. A section can
   * appear under the reader; one can never vanish from under their finger. */
  truthy('adding the track can only lower the distance, never raise it',
    newark.nm <= newarkNow.nm);

  /* Landfall itself, and it needs no track at all — which is what makes the
   * position-only answer worth having during the first paint. */
  const nola = homeInCorridor({ storm: IDA.storm, home: NEW_ORLEANS });
  truthy(`New Orleans is inside on the position alone, at ${nmOf(nola)} nm`,
    nola.inside === true);

  /* ==> AND THE RADIUS HAS TO BITE SOMEWHERE OR IT IS NOT A GATE. <== Chicago
   * is 367 nm off Ida's track: a real American city, on the same continent, in
   * the same week, and out. Without a case like this every assertion above
   * would pass on a function that returned true. */
  const chicago = ida(CHICAGO);
  truthy(`Chicago is ${nmOf(chicago)} nm out and does NOT get the sections`,
    chicago.inside === false);

  const honolulu = ida(HONOLULU);
  truthy(`and Honolulu, at ${nmOf(honolulu)} nm, is not close`,
    honolulu.inside === false);

  /* ==> THE PAST ARM COUNTS, AND LALA PROVES IT ON HER OWN BYTES. <== The water
   * arrives after the wind leaves, so a storm that has already crossed a place
   * is still flooding it. Her genesis point sits ON her observed track and
   * 2,158 nm from her forecast one — so a gate reading only the forecast would
   * call it a miss. */
  const genesis = { lat: LALA_PAST_SAMPLES[0].lat, lon: LALA_PAST_SAMPLES[0].lon };
  const pastOnly = nearestNm(asPoint(genesis), LALA_PAST_SAMPLES);
  const fcstOnlyNm = nearestNm(asPoint(genesis), LALA_FCST_SAMPLES);
  truthy(`her genesis point is ${pastOnly.toFixed(0)} nm from her past track and ` +
    `${fcstOnlyNm.toFixed(0)} from her forecast`,
    pastOnly < 1 && fcstOnlyNm > 2000);

  /* Both halves handed in, as the view hands them in. */
  const lalaHome = homeInCorridor({
    /* Her published position IS the first vertex of her forecast line — read
     * off the file rather than typed, for the reason CLAUDE.md gives. */
    storm: LALA_FCST_SAMPLES[0],
    past: LALA_PAST_SAMPLES, forecast: LALA_FCST_SAMPLES, home: genesis,
  });
  truthy('and with both arms handed in, the house is inside the corridor',
    lalaHome.inside === true);

  /* NOTHING TO ASK ABOUT IS NOT AN ANSWER, AND IT IS NOT §5's SILENCE EITHER —
   * no home set is a question nobody asked, and the caller draws nothing for it
   * whichever way this comes back. */
  eq('no home is not inside anything', homeInCorridor({ storm: IDA.storm }).inside, false);
  eq('and it reports no distance rather than a made-up one',
    homeInCorridor({ storm: IDA.storm }).nm, null);
  eq('no storm and no track measures nothing',
    homeInCorridor({ home: NEWARK }).nm, null);

  /* THE RADIUS TRAVELS ON THE ANSWER, so a sentence can name it without
   * reaching for the constant a second time and getting a different one. */
  eq('the radius comes back with the answer', ida(NEWARK).radiusNm, RAIN.floodCorridorNm);

  /* ==> BOTH SIDES OF THE BOUNDARY, BECAUSE ONE SIDE PASSES FOR A FLIPPED
   * COMPARISON. <== A synthetic pair rather than a city: the point of this case
   * is the operator and the constant, not the geography.
   *
   * ==> AND THE EXACT-EQUALITY CASE IS NOT ASSERTED, ON PURPOSE. <== `<=`
   * against `<` differ at precisely one distance, and no construction lands
   * there — a degree of longitude at the equator is 60 nm only by convention,
   * and against `greatCircleNm`'s own earth radius five degrees measures
   * 300.20. A test that TYPED 300 and expected a hit would be asserting a
   * rounding, not a rule. What is asserted instead is what a wrong operator
   * would actually break: that the pair straddling the radius comes back on
   * the two different sides of it. Both distances are measured, not assumed. */
  const eq0 = (deg) => homeInCorridor({ storm: { lat: 0, lon: 0 }, home: { lat: 0, lon: deg } });
  const justIn = eq0(4.98);
  const justOut = eq0(5.02);
  truthy(`the probes straddle the radius — ${justIn.nm.toFixed(1)} nm and ` +
    `${justOut.nm.toFixed(1)} against ${RAIN.floodCorridorNm}`,
    justIn.nm < RAIN.floodCorridorNm && justOut.nm > RAIN.floodCorridorNm);
  eq('and the nearer one is inside', justIn.inside, true);
  eq('while the further one is not', justOut.inside, false);
}

console.log('\nMutations — each bug must change the answer');
{
  /* Bug 1: measure the track at its published vertices and skip densifying.
   * ==> THIS IS NOT THEORETICAL AND THE NUMBER IS BIG. <== Ida's advisory 19
   * carries seven positions across five days, so the legs are hundreds of
   * miles long and an alert beside the MIDDLE of a leg gets measured to its
   * ends. Russell and Washington counties in Virginia sit 28 nm from her
   * track and 84 nm from the nearest published point — a 56 nm overstatement,
   * running toward DROPPING an alert that is inside the corridor, which is the
   * one direction §56.3 says not to be wrong in. */
  const russell = NATIONAL.find((a) => a.areaDesc.startsWith('Russell, VA'));
  const sparse = IDA_CHAINS.flat();
  const dense = nearestNm(russell.geometry, IDA_SAMPLES);
  const undensified = nearestNm(russell.geometry, sparse);
  near('densified, Russell County is 28 nm from the track', dense, 28.0, 0.2);
  near('at the published points alone it reads as 84', undensified, 83.8, 0.2);
  truthy('so skipping densification overstates it by more than 50 nm',
    undensified - dense > 50);

  /* Bug 2: match the alert's CENTRE instead of its nearest vertex. §56.3 says
   * nearest vertex; the invariant is that a centre can only ever read as
   * FURTHER, never nearer, so this mutation always loses alerts and never
   * gains one. Asserted across every drawable alert rather than on a chosen
   * example, and the largest gap is printed so a later session can see whether
   * these polygons have grown. */
  let worst = 0;
  let violations = 0;
  for (const a of NATIONAL) {
    if (!a.geometry) continue;
    const v = nearestNm(a.geometry, IDA_SAMPLES);
    const c = nearestNm(bboxCentreAsShape(a.geometry), IDA_SAMPLES);
    if (c < v - 1e-9) violations++;
    if (c - v > worst) worst = c - v;
  }
  eq('a centre is never nearer than the nearest vertex, on any of them', violations, 0);
  truthy(`and on these polygons it is up to ${worst.toFixed(1)} nm further`, worst > 5);

  /* Bug 3: flatten the track's chains into one line before densifying.
   *
   * ==> AND THE HONEST VERSION OF THIS CASE IS THAT LALA DOES NOT PROVE IT.
   * <== Her real past track off the archive is FOURTEEN LineString features
   * plus a forecast one, so it looked like the fixture for this. Measured: her
   * fifteen chains are CONTIGUOUS — consecutive pieces of one line — so
   * flattening them and densifying through invents nothing at all. The
   * furthest any sample sits from a published vertex is 78.7 nm either way,
   * to the digit. An assertion dressed up as being about Lala would have
   * passed on the mutation, which §12 calls worse than no test.
   *
   * So the guard is asserted on a probe that actually has a gap: two chains
   * with an ocean between them, which is what a genuinely segmented feed
   * produces. Flattening bridges it and puts samples in the middle of the
   * Pacific. */
  eq('Lala really is fifteen separate chains', LALA_CHAINS.length, 15);
  const gapped = [[{ lon: -160, lat: 20 }, { lon: -159, lat: 20 }],
    [{ lon: -140, lat: 20 }, { lon: -139, lat: 20 }]];
  const kept = trackSamples(gapped);
  const bridged = trackSamples([gapped.flat()]);
  const strayNm = (set) => {
    let worst = 0;
    for (const s of set) {
      let d = Infinity;
      for (const v of gapped.flat()) {
        const x = greatCircleNm(s.lon, s.lat, v.lon, v.lat);
        if (x < d) d = x;
      }
      if (d > worst) worst = d;
    }
    return worst;
  };
  truthy('kept apart, no sample lands off the published points',
    strayNm(kept) < 30);
  truthy(`flattened, one lands ${Math.round(strayNm(bridged))} nm from anywhere the storm was`,
    strayNm(bridged) > 250);

  /* Bug 4: filter expiry only at fetch. Same bytes, past the expiry. */
  truthy('an expired warning cannot survive a held payload',
    inForce(ROWS, LIVE).length !== inForce(ROWS, FFW_ENDS + 60_000).length);

  /* Bug 5: give a shapeless watch a shape. There is nothing to invent from —
   * asserted as the absence it is, so a later "helpful" default has something
   * to break. Phase 4 (§56.4) gives watches their PUBLISHED zone polygons,
   * which is the opposite of inventing one. */
  const watch = ROWS.find((a) => a.event === 'Flood Watch');
  truthy('a watch is carried with no geometry and no substitute',
    watch.geometry === null && watch.drawable === false);
  truthy('and it does not match a corridor it has no shape to be measured in',
    !corridorSummary(ROWS, LALA_SAMPLES, LIVE, 20_000).alerts?.some(
      (a) => a.event === 'Flood Watch'));

  /* Bug 6: infer the tense from `urgency`. The captured watch proves it wrong
   * on its own bytes. */
  const w2 = inForce(ROWS, LIVE).find((a) => a.event === 'Flood Watch');
  truthy('urgency Future would say not-yet-begun and the clock says otherwise',
    w2.urgency === 'Future' && w2.begun === true);

  /* Bug 7: treat a missing track as an empty one. */
  truthy('no track and a track with nothing near it are different answers',
    alertsNearTrack(ROWS, []).state !== alertsNearTrack(ROWS, LALA_SAMPLES).state);

  /* Bug 8: drop the flood-family belt and let a Hurricane Warning through. */
  const overHawaii = trackSamples(trackChains(lineFc([[-155.5, 19.4], [-155.0, 20.0]])));
  const withBelt = corridorSummary(ROWS, overHawaii, LIVE, 300).total;
  const withoutBelt = ROWS.filter(
    (a) => a.geometry && nearestNm(a.geometry, overHawaii) <= 300).length;
  truthy('the belt is doing work — two shapes are over Hawaii and one is a flood',
    withoutBelt === 2 && withBelt === 1);

  /* Bug 9: drop the latitude prefilter's correctness. It is an optimisation
   * and an optimisation that changes an answer is a bug. Compared against a
   * deliberately unfiltered measurement on every drawable alert. */
  let mismatches = 0;
  for (const a of NATIONAL) {
    if (!a.geometry) continue;
    const fast = nearestNm(a.geometry, IDA_SAMPLES);
    const slow = bruteNearestNm(a.geometry, IDA_SAMPLES);
    if (Math.abs(fast - slow) > 1e-9) mismatches++;
  }
  eq('the latitude prefilter never changes an answer', mismatches, 0);
}

console.log(
  failures === 0
    ? '\n\u2713 flood: every acceptance case passes\n'
    : `\n\u2717 flood: ${failures} failure(s)\n`
);
process.exit(failures === 0 ? 0 : 1);
