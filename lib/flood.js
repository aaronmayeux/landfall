/**
 * flood.js — NWS flood alerts, read. SPEC §48.21, §56.3.
 *
 * Pure. No DOM, no network, no clock of its own — every function that needs
 * "now" is handed it, for the same reason `lib/rainfall.js` is: an expiry check
 * against `Date.now()` can only be tested during an actual flood warning, and
 * the one captured set of live alerts this project has is from August.
 *
 * ==> THE HARD PROBLEM HERE IS NOT PARSING, IT IS ATTRIBUTION. <== An NWS flood
 * warning does not name a storm. It says *Flash Flood Warning, Hawaii in
 * Hawaii, HI* and nothing else — the hurricane sitting on top of it is not
 * mentioned anywhere in the product. So any row this app puts under a storm's
 * name is this app asserting a connection the source never made, which is
 * exactly what §50.3 forbids for the CAP list: **a geographic match is not a
 * causal claim.**
 *
 * What is claimed here is therefore the weakest true thing: **this alert's area
 * comes within a stated distance of this storm's track.** That is a statement
 * about two shapes and one number, verifiable from all three, and it makes no
 * assertion about cause. The UI is required to word it that way (§56.3) — a
 * distance, never "caused by" and never "this storm's flooding".
 *
 * ==> AND A STORM CAN BE INNOCENT. <== A stalled front can flood a county while
 * the hurricane on screen goes out to sea, and both can be inside one corridor.
 * The wording is the only defence and it has to hold on its own.
 *
 * ==> THE MATCH IS A DISTANCE FROM THE TRACK, NOT AN OVERLAP WITH THE CONE, AND
 * THAT REPLACED A WHOLE FILE OF BOUNDING-BOX MACHINERY ON 2026-08-22. <== §56.3.
 * A cone is where the storm's CENTRE might go; it says nothing about where the
 * weather is. Flooding happens hundreds of miles from a centre, inland, days
 * after landfall, from a system that has stopped being a hurricane — Ida drowned
 * New Jersey while her centre was over Pennsylvania. A cone-shaped search finds
 * the alerts nearest the middle of the storm and misses the ones that matter
 * most.
 *
 * ==> AND IT DELETES THE ANTIMERIDIAN PROBLEM RATHER THAN SOLVING IT AGAIN. <==
 * The old `extent()` measured longitude in two frames and picked the narrower,
 * because a plain bounding box on Lala's real cone measured −180 to 180 — the
 * whole planet — and claimed every flood warning in the country. A great-circle
 * distance has no frames and no seam: `greatCircleNm` is built on
 * `sin(dLon/2)²`, which is periodic in 360°, so an unwrapped longitude of 190°
 * and one of −170° are the same point to it. Nothing here has to know where the
 * seam is.
 *
 * Imports: config/ and lib/ only.
 */

import { RAIN } from '../config/constants.js';
import { greatCircleNm, densifyTrack } from './geo.js';
import { remainingWords } from './rainfall.js';

/* ---------------------------------------------------------------------------
 * WHAT IS IN FORCE
 * ------------------------------------------------------------------------- */

/**
 * Alerts still in force at `nowMs`, immediate ones first.
 *
 * ==> THE EXPIRY FILTER IS APPLIED AT RENDER AND NOT ONLY AT FETCH. <== §48.6.
 * A flash flood warning is routinely shorter-lived than one poll interval —
 * Hilo's ran 52 minutes — so a payload held for even three minutes can contain
 * a warning that has run out. On a list that is a wrong sentence; on a map it
 * is a shape telling somebody they are in danger when they are not.
 *
 * `ends` outranks `expires` when both are present and disagree: one is when the
 * message goes stale, the other is when the weather does.
 *
 * ==> NO EVENT FILTER HERE, UNLIKE `floodAlerts()` IN `lib/rainfall.js`. <==
 * That function reads a payload containing every hazard in force at a point and
 * has to pick the flood family out of hurricane warnings and surf advisories.
 * This one reads a route that asked the upstream for three named products by
 * name, so everything in it is already the flood family. Filtering again would
 * be a second copy of a rule that would then have to be kept in step.
 */
export function inForce(alerts, nowMs) {
  const out = [];
  for (const a of alerts || []) {
    const until = Date.parse(a?.ends || a?.expires || '');
    if (Number.isFinite(until) && until <= nowMs) continue;

    const onset = Date.parse(a?.onset || '');
    out.push({
      ...a,
      /* ==> RENAMED TO WHAT THE ROW BUILDER READS, AND THIS WAS A REAL BUG.
       * <== `ui/rain-alerts.js` is the one shared row builder (§56.7) and it
       * reads `area` and `remaining`. The relay projects NWS's own field name,
       * `areaDesc`, and carries no duration at all — so the first render of
       * this block printed the event and the expiry and silently dropped BOTH
       * the affected area and the time left. Nothing threw and the row looked
       * finished. Caught by rendering it, not by a unit test of the parser.
       *
       * Mapped here rather than in the relay: the relay's job is to pass NWS's
       * fields through under NWS's names (§4.3), and the shape a UI component
       * wants is a client concern. */
      area: a?.areaDesc || null,
      untilMs: Number.isFinite(until) ? until : null,
      onsetMs: Number.isFinite(onset) ? onset : null,
      remaining: remainingWords(until, nowMs),
      /* ==> THE TENSE COMES FROM THE CLOCK, NEVER FROM `urgency` (§56.7).
       * <== The captured Flood Watch reads `urgency: Future` with an `onset`
       * four hours in the PAST, because the urgency is about when the HAZARD
       * is expected and the onset is about when the MESSAGE took effect. */
      begun: !Number.isFinite(onset) || onset <= nowMs,
      immediate: a?.urgency === 'Immediate',
    });
  }
  /* Immediate first, then soonest to end — a warning with twenty minutes left
   * is more use above one with eighteen hours. */
  out.sort((a, b) =>
    Number(b.immediate) - Number(a.immediate) ||
    (a.untilMs ?? Infinity) - (b.untilMs ?? Infinity));
  return out;
}

/* ---------------------------------------------------------------------------
 * WHERE IT IS — THE CORRIDOR
 *
 * ==> ONE DISTANCE, FROM THE WHOLE TRACK, PAST AND FORECAST. <== §56.3.
 *
 * Past track included because a storm that has already crossed a region is
 * still flooding it — the water arrives after the wind leaves. Forecast track
 * included because that is where it is going. Neither half alone answers the
 * question.
 * ------------------------------------------------------------------------- */

/** Nautical miles in one degree of latitude. Exact enough for a reject test,
 *  and latitude is the one axis with no seam and no convergence, which is why
 *  the cheap prefilter below uses it and nothing else. */
const NM_PER_DEG_LAT = 60;

/**
 * Every line in a set of track FeatureCollections, as separate chains of
 * `{lon, lat}`.
 *
 * ==> CHAINS STAY SEPARATE AND THAT IS THE POINT, NOT AN OVERSIGHT. <== Lala's
 * real past track off the archive is **fourteen** LineString features, not one
 * — the mapserver publishes it in segments. Flattening them into a single list
 * and interpolating straight through would draw legs between the end of one
 * segment and the start of the next, and those legs are not anywhere the storm
 * went. Measuring each chain on its own invents nothing.
 *
 * ==> AND NO CONNECTOR IS NEEDED BETWEEN PAST AND FORECAST. <== It would be the
 * obvious next worry. `lib/trackline.js` cuts one smoothed curve into
 * `curve.slice(0, cut + 1)` and `curve.slice(cut)` — the two slots SHARE the
 * vertex at the cut — so the chains already meet at the storm's position. On
 * an unsmoothed bundle they meet at the same published point for the same
 * reason. There is no gap to bridge.
 *
 * @param {...object} fcs FeatureCollections, in the order they should be read.
 * @returns {Array<Array<{lon:number, lat:number}>>}
 */
export function trackChains(...fcs) {
  const chains = [];
  const take = (coords) => {
    const chain = [];
    for (const pt of coords || []) {
      const [lon, lat] = pt || [];
      if (Number.isFinite(lon) && Number.isFinite(lat)) chain.push({ lon, lat });
    }
    if (chain.length) chains.push(chain);
  };

  for (const fc of fcs) {
    for (const f of fc?.features || []) {
      const g = f?.geometry;
      if (g?.type === 'LineString') take(g.coordinates);
      else if (g?.type === 'MultiLineString') for (const line of g.coordinates || []) take(line);
    }
  }
  return chains;
}

/**
 * Every chain densified, as one flat list of sample points to measure against.
 *
 * ==> DENSIFIED BECAUSE THE MINIMUM USUALLY FALLS BETWEEN TWO PUBLISHED POINTS.
 * <== The same reason `data/home-corridor.js` densifies, and the same tool:
 * `densifyTrack` at `TRACK_SUBDIVISIONS`, which `lib/geo.js` documents as finer
 * than the forecast's own resolution. Measuring vertex-to-vertex against a
 * 12-hour NHC leg puts the true nearest approach up to a few nautical miles
 * further away than it is, and that error runs toward DROPPING an alert just
 * inside the corridor — the one direction §56.3 says not to be wrong in.
 *
 * A chain of a single point is kept as that point. It is a real place the storm
 * was; there is simply nothing to interpolate through.
 */
export function trackSamples(chains) {
  const out = [];
  for (const chain of chains || []) {
    if (chain.length === 1) { out.push(chain[0]); continue; }
    for (const p of densifyTrack(chain)) out.push(p);
  }
  return out;
}

/**
 * The shortest distance from a shape to a set of track samples, in nautical
 * miles, or `null` if either side has nothing to measure.
 *
 * ==> NEAREST VERTEX OF THE SHAPE, NOT ITS CENTRE. <== §56.3. A flood warning
 * polygon is a county-sized box a forecaster drew; its centre can sit tens of
 * miles from the edge nearest the storm. Measuring from the vertices overstates
 * the overlap slightly and in ONE direction — toward including an alert just
 * outside the corridor, never toward dropping one just inside. On a hazard
 * surface that is the direction to be wrong in, and it is the same reasoning
 * §48.19 uses to keep a partly-elapsed rainfall block rather than prorate it.
 *
 * ==> AN EDGE THAT PASSES CLOSE BETWEEN TWO VERTICES IS MEASURED AS FURTHER
 * THAN IT IS, AND THAT IS ACCEPTED. <== The polygons are small — 0.060° to
 * 0.440° wide, median 0.270°, measured off the archive (§56.2) — so the gap
 * between neighbouring vertices is a few miles against a corridor of hundreds.
 * A true point-to-segment distance would buy accuracy far below the radius's
 * own uncertainty, which is a number nobody has measured yet at all.
 *
 * ==> A `Point` IS ACCEPTED, AND IT IS THE READER'S HOUSE (§56.9). <== "How
 * near does this shape come to this track" is the question the alert list asks
 * about a county and the question the home screen asks about an address, and
 * one function answering both is what stops the two drifting apart. A house is
 * a ring of one vertex, so the loops below need no branch for it — and for a
 * single vertex the "nearest vertex rather than nearest edge" caveat above
 * does not apply at all. That answer is exact.
 */
export function nearestNm(geometry, samples) {
  if (!samples?.length) return null;

  const rings = [];
  if (geometry?.type === 'Polygon') rings.push(...(geometry.coordinates || []));
  else if (geometry?.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates || []) rings.push(...(poly || []));
  } else if (geometry?.type === 'Point') rings.push([geometry.coordinates]);
  else return null;

  /* THE CHEAP REJECT, AND IT IS EXACT RATHER THAN APPROXIMATE. A degree of
   * latitude is 60 nm everywhere, so a shape whose whole latitude band sits
   * further than the radius from the track's whole latitude band cannot
   * possibly be inside it — no longitude, no seam, no frames. This is the
   * bounding box the deleted `extent()` could not safely be. */
  let sLat = Infinity, nLat = -Infinity;
  for (const ring of rings) {
    for (const pt of ring || []) {
      const lat = pt?.[1];
      if (!Number.isFinite(lat)) continue;
      if (lat < sLat) sLat = lat;
      if (lat > nLat) nLat = lat;
    }
  }
  if (!Number.isFinite(sLat)) return null;

  let best = Infinity;
  for (const s of samples) {
    /* Per-sample latitude gate. Cheaper than a haversine by an order of
     * magnitude and it cannot change the answer: this distance is a LOWER
     * bound on the true one. */
    const latGap = s.lat > nLat ? s.lat - nLat : s.lat < sLat ? sLat - s.lat : 0;
    if (latGap * NM_PER_DEG_LAT >= best) continue;

    for (const ring of rings) {
      for (const pt of ring || []) {
        const [lon, lat] = pt || [];
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        const d = greatCircleNm(s.lon, s.lat, lon, lat);
        if (d < best) best = d;
      }
    }
  }
  return Number.isFinite(best) ? best : null;
}

/**
 * The alerts whose shape comes within `radiusNm` of this storm's track. §56.3.
 *
 * @returns {{state:'ok', alerts:Array, total:number} |
 *           {state:'no_track'} | {state:'none_matched'}}
 *
 * ==> `no_track` IS NOT `none_matched` AND THE PANEL SAYS SO. <== A storm with
 * no published track — geometry still in flight, an ended storm rebuilt from a
 * skeleton — has nothing to measure alerts against. The honest answer is that
 * we cannot say, and it must never render as the honest answer for a storm
 * whose track WAS measured and came near nothing. That is §5's `unavailable`
 * versus `none_matched` distinction in a new place, and it is the one this
 * feature is most likely to get wrong, because both produce an empty list.
 *
 * ==> AN ALERT WITH NO SHAPE IS NOT MATCHED, AND THE COUNT SAYS SO ELSEWHERE.
 * <== A Flood Watch carries `geometry: null` (§56.4), so there is nothing to
 * measure a distance from. Keeping it anyway would put an Ohio watch under a
 * Hawaii storm — a false statement about shapes, made by us. Phase 4 gives
 * watches their published zone polygons and this whole special case
 * disappears; until then they are held back here and counted by the caller,
 * never silently dropped.
 *
 * Each matched alert carries `nearestNm` — how close it actually came. Computed
 * here because it is free once the minimum is found, and a row that can say
 * "180 nm from the track" is a row that is not asserting a cause.
 */
export function alertsNearTrack(alerts, samples, radiusNm = RAIN.floodCorridorNm) {
  if (!samples?.length) return { state: 'no_track' };

  const matched = [];
  for (const a of alerts || []) {
    /* THE BELT TO THE ROUTE'S BRACES. `/api/nws/flood` asks the upstream for
     * three products by name, so nothing else should arrive — but "should" is
     * doing the work in that sentence. NWS renames products, and a Coastal
     * Flood Advisory reaching here would put a second, contradictory answer
     * beside §51's surge section. */
    if (!isFloodFamily(a?.event)) continue;
    /* No shape to place. Held back rather than matched — see above. */
    if (!a?.geometry) continue;
    const nm = nearestNm(a.geometry, samples);
    if (nm == null || nm > radiusNm) continue;
    matched.push({ ...a, nearestNm: nm });
  }

  if (!matched.length) return { state: 'none_matched' };
  return { state: 'ok', alerts: matched, total: matched.length };
}

/**
 * The sentence's two numbers: how many are in force inside the corridor, and
 * how many of those can actually be drawn.
 *
 * ==> A COUNT OF ALERTS IS NOT A COUNT OF SHAPES, AND THE DRAWER MUST BE ABLE
 * TO SAY SO. <== The layer draws what carries a polygon. If nineteen are in
 * force and eleven can be drawn, a sentence claiming nineteen are on the globe
 * is wrong and a globe silently showing eleven is worse. Both travel.
 */
export function corridorSummary(alerts, samples, nowMs, radiusNm = RAIN.floodCorridorNm) {
  const live = inForce(alerts, nowMs);
  const hit = alertsNearTrack(live, samples, radiusNm);
  /* ==> `radiusNm` TRAVELS ON EVERY STATE, INCLUDING THE EMPTY ONES. <== The
   * `none_matched` sentence names the distance too — "no flood alerts within
   * 345 mi" is an answer, where "no flood alerts nearby" is a vibe. It would
   * be easy to attach this only to the `ok` path and leave the empty case
   * reaching for an undefined. */
  if (hit.state !== 'ok') return { ...hit, live, radiusNm };

  const drawable = hit.alerts.filter((a) => a.drawable).length;
  const immediate = hit.alerts.filter((a) => a.immediate).length;
  return { state: 'ok', alerts: hit.alerts, total: hit.total, drawable, immediate, live, radiusNm };
}

/**
 * Is this alert one the flood family owns? A belt to the relay's braces.
 *
 * The route asks the upstream for three products by name, so nothing else
 * should ever arrive. This exists because "should" is doing the work in that
 * sentence: NWS renames products, and a Coastal Flood Advisory reaching this
 * layer would put a second, contradictory answer next to §51's surge section.
 */
export const isFloodFamily = (event) =>
  String(event || '').toLowerCase().includes(RAIN.alertEventMatch);

/* ---------------------------------------------------------------------------
 * THE HOUSE IN THE CORRIDOR — §56.9
 *
 * ==> ONE TEST, ASKED TWICE. <== Everything above answers *which alerts belong
 * to this storm*. This answers *does this storm reach my house*, and it is the
 * same question with the shape swapped: how near does a thing on the ground
 * come to this storm's track. So it is the same samples, the same
 * `nearestNm`, and the same `RAIN.floodCorridorNm` — and the home screen and
 * the alert list cannot come to different conclusions about one storm.
 *
 * ==> IT REPLACES TWO DIFFERENTLY-SIZED RINGS. <== §56.9 records what went:
 * the house figure was gated on the wind field at 300 nm and the flood warnings
 * on `APPROACH.relevanceNm` at 1,500. Two rings meant a storm could be near
 * enough for one sentence and too far for the one beside it, which is a
 * distinction no reader was ever going to hold. Both are gone; this is the only
 * ring left.
 * ------------------------------------------------------------------------- */

/**
 * Every place this storm has been or is going, as sample points to measure
 * against — its published position always included.
 *
 * ==> THE POSITION IS IN THERE SO THERE IS ALWAYS AN ANSWER, AND THAT IS A
 * SAFETY PROPERTY RATHER THAN A CONVENIENCE. <== The geometry bundle lands
 * after the first paint, so for the first second of every storm the track
 * arrays are empty. Without the position this would have to return "cannot
 * say" and the caller would have to decide what to do with an unknown on a
 * screen about the reader's own house.
 *
 * With it there is no unknown, and the answer has a property worth stating
 * plainly: **adding track samples can only lower the minimum distance, never
 * raise it.** So as the geometry arrives the gate can open and can never
 * close. A section can appear under the reader; one can never vanish from
 * under their finger.
 *
 * The two track arrays are kept as SEPARATE chains and are not concatenated —
 * densifying across the join would draw a leg from the end of the observed
 * track to the start of the forecast, which is not anywhere the storm went.
 * They already meet at the storm's own position, so nothing is lost.
 *
 * @param {{lon:number, lat:number}} storm the storm's published position.
 * @param {Array<{lon:number, lat:number}>} [past] the observed track.
 * @param {Array<{lon:number, lat:number}>} [forecast] the forecast track.
 * @returns {Array<{lon:number, lat:number}>}
 */
export function stormSamples({ storm = null, past = null, forecast = null } = {}) {
  const clean = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((p) => Number.isFinite(p?.lon) && Number.isFinite(p?.lat))
      .map((p) => ({ lon: p.lon, lat: p.lat, time: p.time ?? null }));

  const chains = [];
  if (Number.isFinite(storm?.lon) && Number.isFinite(storm?.lat)) {
    chains.push([{ lon: storm.lon, lat: storm.lat }]);
  }
  for (const list of [past, forecast]) {
    const chain = clean(list);
    if (chain.length) chains.push(chain);
  }
  return trackSamples(chains);
}

/**
 * Does this storm's corridor reach the reader's house? §56.9.
 *
 * @returns {{inside:boolean, nm:number|null, radiusNm:number}} `nm` is how near
 *   the storm actually comes, which is the number a sentence can quote; it is
 *   null only when there is no home set or no position to measure from.
 *
 * ==> `inside` IS FALSE WHEN THERE IS NOTHING TO MEASURE, AND THAT IS NOT §5's
 * SILENCE. <== No home set is not a source that failed — it is a question
 * nobody asked, and the caller draws nothing for it either way. Every case
 * where a source WAS asked has a position to measure from, because a storm
 * without one does not reach a screen.
 */
export function homeInCorridor({
  storm = null, past = null, forecast = null, home = null,
  radiusNm = RAIN.floodCorridorNm,
} = {}) {
  if (!Number.isFinite(home?.lon) || !Number.isFinite(home?.lat)) {
    return { inside: false, nm: null, radiusNm };
  }
  const samples = stormSamples({ storm, past, forecast });
  const nm = nearestNm({ type: 'Point', coordinates: [home.lon, home.lat] }, samples);
  if (nm == null) return { inside: false, nm: null, radiusNm };
  return { inside: nm <= radiusNm, nm, radiusNm };
}
