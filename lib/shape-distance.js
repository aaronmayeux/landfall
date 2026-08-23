/**
 * shape-distance.js — how near a shape comes to a track, measured cheaply.
 * SPEC-FLOOD-PLAN.md §56.18.
 *
 * ==> THIS LEFT `lib/flood.js` BECAUSE IT IS NOT ABOUT FLOODS. <== Every
 * function here answers one question — *what is the shortest distance between
 * this polygon and this line of points* — and none of them knows what a flood
 * alert is, what a corridor radius means, or which storm is on screen. It was
 * written inside the flood file because that is where the need appeared, and it
 * pushed that file over §12's 700-line ceiling, which is the ceiling doing its
 * job: the file had grown a second concern.
 *
 * ==> THE EXACT ANSWER AND THE CHEAP ANSWER BOTH LIVE HERE, TOGETHER, ON
 * PURPOSE. <== `nearestNm` is the definition of correct and `nearestNmWithin`
 * is the fast path that must agree with it at every radius. Separating them
 * would put the thing under test and the thing it is tested against in
 * different files and invite exactly the drift the suite exists to catch.
 *
 * Imports config/ and lib/geo.js. No DOM, no data siblings, no knowledge of
 * anything above lib/ — which is what keeps the whole match testable on plain
 * node with no browser.
 */

import { RAIN } from '../config/constants.js';
import { greatCircleNm, DEG, EARTH_RADIUS_NM } from './geo.js';

/** Nautical miles in one degree of latitude. Exact enough for a reject test,
 *  and latitude is the one axis with no seam and no convergence, which is why
 *  the per-sample prefilter uses it and nothing else. */
const NM_PER_DEG_LAT = 60;

/* ---------------------------------------------------------------------------
 * MAKING THE MATCH CHEAP — §56.18
 *
 * ==> THE MATCH USED TO COST 800 ms OF ARITHMETIC FOR ONE STORM, AND ALMOST
 * ALL OF IT WAS SPENT ON SHAPES THOUSANDS OF MILES AWAY. <== Measured on Ida's
 * real track against the archived national list plus Phase 4's resolved watch
 * zones. Two things caused it, and neither was the number of alerts.
 *
 *   1. THE ONLY PREFILTER WAS LATITUDE. A Hawaii coastal zone sits at 19.0–19.7
 *      and Ida's track spans 16.5–48.8, so the latitude gate rejected NOTHING
 *      and every one of that zone's 1,970 points was measured against all 363
 *      track samples — for a shape 4,000 miles away.
 *   2. NWS ZONE BOUNDARIES ARE DRAWN AT 65 METRES PER POINT. Against a corridor
 *      300 NAUTICAL MILES wide. The precision is real and it is irrelevant to
 *      this question.
 *
 * So: reject the whole shape in one comparison when the two bounding boxes
 * cannot possibly reach each other, and measure a THINNED outline first,
 * falling back to every point only where the answer actually turns on it.
 *
 * ==> THE DECISION STAYS EXACT AT EVERY RADIUS. THAT IS THE WHOLE DESIGN.
 * <== A cheaper match that drops an alert just inside the corridor is a §5
 * safety bug wearing a performance win. Verified in `tools/test-flood-fast.mjs`
 * by walking a real zone boundary across the corridor edge in 0.05 nm steps at
 * five radii — 1,400 include/exclude decisions, none of which moves.
 * ------------------------------------------------------------------------- */

/** A shape's rings, whatever kind of shape it is. ONE reader, because the fast
 *  path and the exact path disagreeing about what a MultiPolygon contains is a
 *  bug neither of them could show on its own. */
function ringsOf(geometry) {
  if (geometry?.type === 'Polygon') return geometry.coordinates || [];
  if (geometry?.type === 'MultiPolygon') {
    const out = [];
    for (const poly of geometry.coordinates || []) out.push(...(poly || []));
    return out;
  }
  /* A house (§56.9): a ring of one vertex, so nothing below needs a branch. */
  if (geometry?.type === 'Point') return [[geometry.coordinates]];
  return null;
}

/** The lat/lon extremes of a set of points, or null if there are none. */
function boxOf(rings) {
  let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
  for (const ring of rings || []) {
    for (const pt of ring || []) {
      const lon = pt?.[0], lat = pt?.[1];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
      if (lon < w) w = lon;
      if (lon > e) e = lon;
    }
  }
  return Number.isFinite(s) ? { s, n, w, e } : null;
}

/** The same box around a track's samples. */
export function trackBox(samples) {
  let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
  for (const p of samples || []) {
    if (!Number.isFinite(p?.lon) || !Number.isFinite(p?.lat)) continue;
    if (p.lat < s) s = p.lat;
    if (p.lat > n) n = p.lat;
    if (p.lon < w) w = p.lon;
    if (p.lon > e) e = p.lon;
  }
  return Number.isFinite(s) ? { s, n, w, e } : null;
}

/**
 * A LOWER bound on the great-circle distance between two boxes, in nautical
 * miles. Zero when they overlap.
 *
 * ==> IT IS A BOUND AND NOT AN ESTIMATE, WHICH IS WHY IT IS SAFE TO REJECT ON.
 * <== Haversine says
 *   sin²(d/2R) = sin²(Δφ/2) + cos φ₁ · cos φ₂ · sin²(Δλ/2)
 * Substituting the SMALLEST latitude gap and the SMALLEST longitude gap the two
 * boxes admit, and the cosine at the HIGHEST latitude either box reaches, can
 * only make the right-hand side smaller — so the distance it yields can only be
 * smaller than the true one. If that number is already outside the corridor, no
 * point inside either box can be inside it.
 *
 * ==> AND THE ANTIMERIDIAN CANNOT MAKE IT WRONG, ONLY SLOW. <== A shape drawn
 * across the seam — the Aleutians are real US forecast zones — has a box
 * spanning most of the planet. That is detected and the longitude term is
 * dropped, which weakens the bound to the latitude-only one this file already
 * used. The shape then falls through to the measurement below. The old
 * `extent()` machinery was deleted for measuring longitude in two frames and
 * picking one; this never picks, it declines.
 *
 * ==> EXPORTED FOR ONE REASON: THIS IS THE STAGE WITH NO SECOND OPINION BEHIND
 * IT. <== A shape the boxes discard is never measured again, so if this number
 * can ever exceed the true distance it can drop a live flood warning off a
 * storm. Reaching it only through the public door meant the assertion could
 * only test the CONSEQUENCE — and a probe grid coarse enough to be quick never
 * lands in the narrow band where a slightly-too-large bound actually bites. It
 * proved that by passing with a deliberate 2% inflation in it. The property is
 * asserted head-on now: `bound <= exact`, every probe, in
 * `tools/test-flood-fast.mjs`.
 */
export function boxLowerNm(a, b) {
  const dLatDeg = a.s > b.n ? a.s - b.n : b.s > a.n ? b.s - a.n : 0;

  /* A box wider than half the planet is a seam-crossing shape, and its west and
   * east edges no longer bracket it. No longitude claim is made about it. */
  const seam = a.e - a.w > 180 || b.e - b.w > 180;
  let dLonDeg = 0;
  if (!seam) {
    const wrap = (x) => (x > 180 ? x - 360 : x < -180 ? x + 360 : x);
    const gapEast = wrap(b.w - a.e);
    const gapWest = wrap(a.w - b.e);
    if (gapEast > 0 || gapWest > 0) {
      dLonDeg = Math.min(gapEast > 0 ? gapEast : 360, gapWest > 0 ? gapWest : 360);
    }
  }

  if (dLatDeg === 0 && dLonDeg === 0) return 0;

  const dLat = dLatDeg * DEG;
  const dLon = dLonDeg * DEG;
  /* Clamped off the poles: cos(90°) is 0 and would make the longitude term
   * vanish, which is still a valid bound but a needlessly weak one. */
  const phi = Math.min(89, Math.max(Math.abs(a.s), Math.abs(a.n), Math.abs(b.s), Math.abs(b.n)));
  const c = Math.cos(phi * DEG);
  const h = Math.sin(dLat / 2) ** 2 + c * c * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A ring with points dropped until no two survivors sit closer than `tolNm`.
 *
 * ==> IT IS A WALK ALONG THE OUTLINE, NOT "EVERY NTH POINT". <== NWS draws
 * detail where the coast is complicated and long straight runs where it is not,
 * so a fixed stride would over-thin the headlands and under-thin the straights.
 * Accumulating real distance means every dropped point is within `tolNm` of a
 * kept one, whatever the local density — which is the property the error bound
 * rests on.
 *
 * The last point is always kept, so a ring still closes.
 */
function thinRing(ring, tolNm) {
  if (!Array.isArray(ring) || ring.length <= 2) return ring || [];
  const out = [ring[0]];
  let acc = 0;
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i - 1], q = ring[i];
    acc += greatCircleNm(p[0], p[1], q[0], q[1]);
    if (acc >= tolNm) {
      out.push(q);
      acc = 0;
    }
  }
  const last = ring[ring.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * The box and thinned outline for one shape, computed once and held.
 *
 * ==> KEYED ON THE GEOMETRY OBJECT ITSELF, IN A `WeakMap`. <== The alert list
 * is fetched once per client TTL and every consumer reads the same slot, so
 * `inForce`'s spread copies the geometry REFERENCE rather than the shape —
 * meaning the same object arrives here on every repaint and the thinning is
 * paid once per fetch rather than once per render. A `WeakMap` because when the
 * list is replaced the old shapes should go with it and nothing here should be
 * the reason a dropped payload stays in memory.
 */
const shapeCache = new WeakMap();

function shapeOf(geometry, tolNm) {
  let held = shapeCache.get(geometry);
  if (held && held.tolNm === tolNm) return held;

  const rings = ringsOf(geometry);
  if (!rings) return null;
  const box = boxOf(rings);
  held = box ? { box, thin: rings.map((r) => thinRing(r, tolNm)), tolNm } : null;
  if (held) shapeCache.set(geometry, held);
  return held;
}

/** The nearest of a set of rings to a set of samples, with the same per-sample
 *  latitude gate the exact measurement uses. */
function grindRings(rings, samples, box) {
  let best = Infinity;
  for (const s of samples) {
    const latGap = s.lat > box.n ? s.lat - box.n : s.lat < box.s ? box.s - s.lat : 0;
    if (latGap * NM_PER_DEG_LAT >= best) continue;
    for (const ring of rings) {
      for (const pt of ring || []) {
        const lon = pt?.[0], lat = pt?.[1];
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        const d = greatCircleNm(s.lon, s.lat, lon, lat);
        if (d < best) best = d;
      }
    }
  }
  return Number.isFinite(best) ? best : null;
}

/**
 * How near this shape comes to this track, in nautical miles, or `null` when it
 * is outside `radiusNm` — computed the cheap way. §56.18.
 *
 * ==> `null` HERE MEANS "OUTSIDE THE CORRIDOR", NOT "COULD NOT BE MEASURED".
 * <== Different from `nearestNm`, deliberately, and the caller must not conflate
 * them: an unmeasurable shape is counted as `unplaceable` and an alert the
 * reader is told about, while an out-of-corridor one is simply not this storm's.
 * The two are told apart by `ringsOf` returning nothing, which is checked first.
 *
 * THREE STAGES, EACH ONLY REACHED IF THE ONE BEFORE IT COULD NOT DECIDE:
 *
 *   1. THE BOXES. One comparison. Kills every shape in another part of the
 *      country, which on a real national list is nearly all of them.
 *   2. THE THINNED OUTLINE. Overstates by at most `tolNm`, so anything it puts
 *      beyond `radius + tol` is genuinely outside and anything it puts inside
 *      `radius − tol` is genuinely inside. Both are answers.
 *   3. THE FULL OUTLINE. Reached only in the band between those two, where the
 *      thinning could actually change the verdict. A zone lying across the
 *      track is hundreds of miles inside the corridor and never gets here.
 */
export function nearestNmWithin(geometry, samples, radiusNm, tolNm = RAIN.floodCoarseTolNm) {
  if (!samples?.length || !ringsOf(geometry)) return null;
  const box = trackBox(samples);
  if (!box) return null;
  return nearestNmWithinBoxed(geometry, samples, box, radiusNm, tolNm);
}

/** The same, when the caller already has the track's box — the list case, where
 *  recomputing it per alert would be its own waste. */
export function nearestNmWithinBoxed(geometry, samples, tBox, radiusNm, tolNm) {
  const shape = shapeOf(geometry, tolNm);
  if (!shape) return null;

  if (boxLowerNm(shape.box, tBox) > radiusNm) return null;

  const coarse = grindRings(shape.thin, samples, shape.box);
  if (coarse == null || coarse > radiusNm + tolNm) return null;
  if (coarse > radiusNm - tolNm) {
    /* The close call. Measure every point NWS drew and let the caller's own
     * radius test decide on an exact number. */
    const exact = nearestNm(geometry, samples);
    return exact != null && exact <= radiusNm ? exact : null;
  }
  return coarse;
}

/**
 * The shortest distance from a shape to a set of track samples, in nautical
 * miles, or `null` if either side has nothing to measure.
 *
 * ==> THIS IS THE EXACT ANSWER AND IT IS STILL THE ONE THAT DEFINES CORRECT.
 * <== `nearestNmWithin` above is faster and is what the list match calls; this
 * is what it falls back to on a close call and what every test measures it
 * against. Keep them agreeing.
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

  const rings = ringsOf(geometry);
  if (!rings) return null;

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
