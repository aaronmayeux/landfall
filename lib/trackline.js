/**
 * trackline.js — one continuous, curved storm path from the two track slots.
 *
 * THE PROBLEM THIS SOLVES, MEASURED OFF GLASS 2026-07-26 (Aaron's screenshot
 * of Fausto, pixels read directly):
 *
 *   1. NHC's Past Track line STOPS SHORT OF THE CURRENT POSITION. Its western
 *      end sat 254 screen pixels from the forecast's first dot. Extended in a
 *      straight line it passed within 4 px of that dot's centre — so the two
 *      layers are one path with a leg missing, not a projection fault. The map
 *      drew a storm whose history simply stopped somewhere out at sea.
 *
 *   2. BOTH TRACKS ARE STRAIGHT LINES BETWEEN 6-HOURLY FIXES, so a storm that
 *      curves reads as a chain of corners. Every other tracker looks like
 *      this. A hurricane does not travel in facets.
 *
 * WHAT IT DOES, in order:
 *   stitch  → chain scattered segments into one polyline per slot
 *   orient  → make the past track END where the forecast track BEGINS
 *   join    → concatenate them into ONE run through the current position
 *   spline  → bend the whole run as a single curve
 *   cut     → hand the two halves back to their own slots
 *
 * SPLINING ACROSS THE SEAM IS THE POINT. Smoothing the halves separately
 * leaves a kink exactly where the eye is looking — at the storm. One curve
 * through both means the tangent carries through the current position, and
 * the dotted past flows into the solid forecast without a corner.
 *
 * THE CONNECTING LEG IS DOTTED, NOT SOLID. The cut is at the forecast's FIRST
 * original point, so the leg that closes the gap belongs to the past track.
 * The storm has already travelled it; drawing it in the forecast's confident
 * white would promote history to prediction (SPEC §7 line grammar).
 *
 * WE NEVER MOVE A REPORTED POSITION. Centripetal Catmull-Rom passes exactly
 * through every published fix; only the space BETWEEN fixes changes. It is
 * centripetal (alpha 0.5) rather than uniform for one reason that matters on a
 * recurve: uniform Catmull-Rom overshoots and can loop back on itself where
 * the direction change is sharp, which on a hurricane track is precisely the
 * moment somebody is watching. Centripetal cannot cusp or self-intersect.
 *
 * IS A CURVE HONEST? A straight line between two 6-hourly fixes is just as
 * invented as a curve, and a storm carries momentum. The curve is the better
 * guess, not a decoration. Neither is a claim about where the eye was at 03Z.
 *
 * THERE IS NO DISTANCE GUARD ON THE JOIN — Aaron's call, 2026-07-26. A first
 * draft refused to connect across an implausibly large gap. That would have
 * meant the app quietly went back to drawing the broken version on exactly the
 * days something was wrong, which is the failure this file exists to remove.
 * A badly stale feed now draws one long leg to the current position, and the
 * silence badge (lib/silence.js) is what says the record is old.
 *
 * PLANAR FRAME. Longitude is scaled by cos(latitude) before splining and
 * unscaled after, so the curve is computed on something shaped like the ocean
 * rather than on a stretched lon/lat grid. Without it a track at 40°N bends
 * visibly wrong in the east-west direction.
 *
 * ANTIMERIDIAN. Every distance uses a wrapped longitude delta, so a run
 * published either side of 180° still chains, and the output is deliberately
 * left UNWRAPPED (longitudes may run past ±180) because that is what MapLibre
 * needs to draw a continuous line across the seam. The first vertex keeps its
 * source longitude, so nothing shifts.
 *
 * NOT MEMOIZED, deliberately. A full ambient repush is ten storms of a few
 * hundred vertices each — tens of microseconds — and every caching scheme here
 * has to key on objects that main.js rebuilds on every push anyway.
 *
 * FAILURE IS PASS-THROUGH. This is cosmetic geometry. Anything unexpected
 * returns the bundle untouched with a console warning: a straight track is a
 * worse picture, a missing track is a §5 bug.
 *
 * Pure functions. Imports: config/constants only. No DOM, ever.
 */

import { TRACK_LINE } from '../config/constants.js';

const DEG = Math.PI / 180;

/* ---------------------------------------------------------------------------
 * SMALL GEOMETRY
 * ------------------------------------------------------------------------- */

/** Longitude difference wrapped into (−180, 180]. Used by EVERY distance in
 *  this file, so 179.9 and −179.9 read as neighbours rather than a world
 *  apart — which is the difference between chaining a Pacific track and
 *  scattering it. */
function dLon(a, b) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/** Squared separation in degrees, longitude wrapped and latitude-scaled.
 *  Squared because every use is a comparison; the root buys nothing. */
function sep2(p, q) {
  const cos = Math.cos(((p[1] + q[1]) / 2) * DEG);
  const x = dLon(p[0], q[0]) * cos;
  const y = p[1] - q[1];
  return x * x + y * y;
}

const isPt = (p) =>
  Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/* ---------------------------------------------------------------------------
 * STITCH — scattered segments to one polyline
 * ------------------------------------------------------------------------- */

/**
 * Every coordinate run in a slot's features.
 *
 * GDACS PUBLISHES A TRACK AS ~30 SEPARATE TWO-POINT SEGMENTS IN SCRAMBLED
 * ORDER — grouped by intensity class, not by time, and the forecast flag flips
 * inside a class run (spec-parameter.md §5.3). They only ever LOOKED like a
 * track because consecutive segments happen to abut on screen. Smoothing them
 * where they lie would do nothing at all: a two-point segment has no corner.
 * NHC sends one line and this is a no-op there.
 */
function runsFrom(fc) {
  const out = [];
  for (const f of fc?.features || []) {
    const g = f?.geometry;
    if (!g) continue;
    if (g.type === 'LineString') out.push(g.coordinates);
    else if (g.type === 'MultiLineString') out.push(...g.coordinates);
  }
  return out
    .map((r) => (Array.isArray(r) ? r.filter(isPt) : []))
    .filter((r) => r.length >= 2);
}

/**
 * Chain runs head-to-tail into as few polylines as possible, then force
 * whatever is left into ONE by walking nearest endpoints.
 *
 * Two passes on purpose. The first joins only endpoints that genuinely
 * coincide (`joinEpsDeg`), which is what GDACS's shared fixes do and what
 * makes the common case exact rather than approximate. The second is the
 * fallback for anything the first could not resolve, and it follows the same
 * rule as the past→forecast join: always connect. A track in pieces is the
 * bug, not the safe answer.
 */
function stitch(runs) {
  if (runs.length <= 1) return runs[0] ? [...runs[0]] : [];

  const eps2 = TRACK_LINE.joinEpsDeg * TRACK_LINE.joinEpsDeg;
  const pool = runs.map((r) => [...r]);
  const chains = [];

  while (pool.length) {
    const chain = pool.pop();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const r = pool[i];
        const head = chain[0];
        const tail = chain[chain.length - 1];
        let merged = null;
        if (sep2(tail, r[0]) <= eps2) merged = () => chain.push(...r.slice(1));
        else if (sep2(tail, r[r.length - 1]) <= eps2)
          merged = () => chain.push(...r.slice(0, -1).reverse());
        else if (sep2(head, r[r.length - 1]) <= eps2)
          merged = () => chain.unshift(...r.slice(0, -1));
        else if (sep2(head, r[0]) <= eps2)
          merged = () => chain.unshift(...r.slice(1).reverse());
        if (merged) {
          merged();
          pool.splice(i, 1);
          grew = true;
          break;
        }
      }
    }
    chains.push(chain);
  }

  if (chains.length === 1) return chains[0];

  /* Longest first, then absorb the rest by whichever endpoint is nearest.
   *  Starting from the longest keeps the dominant run's own order intact
   *  instead of letting a two-point offcut decide the direction of the whole
   *  track. */
  chains.sort((a, b) => b.length - a.length);
  const out = chains.shift();
  while (chains.length) {
    let best = null;
    for (let i = 0; i < chains.length; i++) {
      const c = chains[i];
      const cand = [
        { d: sep2(out[out.length - 1], c[0]), i, at: 'tail', rev: false },
        { d: sep2(out[out.length - 1], c[c.length - 1]), i, at: 'tail', rev: true },
        { d: sep2(out[0], c[c.length - 1]), i, at: 'head', rev: false },
        { d: sep2(out[0], c[0]), i, at: 'head', rev: true },
      ];
      for (const k of cand) if (!best || k.d < best.d) best = k;
    }
    const c = chains.splice(best.i, 1)[0];
    const piece = best.rev ? [...c].reverse() : c;
    if (best.at === 'tail') out.push(...piece);
    else out.unshift(...piece);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * ORIENT + JOIN
 * ------------------------------------------------------------------------- */

/**
 * Flip either polyline as needed so the past ENDS where the forecast BEGINS.
 *
 * Neither source guarantees a direction, and neither is checked for one: a
 * LineString drawn backwards renders identically, so a wrong assumption here
 * would never show up until the join placed the connecting leg at the wrong
 * end of the world. Measured, not assumed — the pairing with the smallest
 * separation is the seam.
 */
function orient(past, forecast) {
  if (!past.length || !forecast.length) return { past, forecast };
  const pH = past[0];
  const pT = past[past.length - 1];
  const fH = forecast[0];
  const fT = forecast[forecast.length - 1];
  const opts = [
    { d: sep2(pT, fH), p: false, f: false },
    { d: sep2(pT, fT), p: false, f: true },
    { d: sep2(pH, fH), p: true, f: false },
    { d: sep2(pH, fT), p: true, f: true },
  ];
  let best = opts[0];
  for (const o of opts) if (o.d < best.d) best = o;
  return {
    past: best.p ? [...past].reverse() : past,
    forecast: best.f ? [...forecast].reverse() : forecast,
  };
}

/* ---------------------------------------------------------------------------
 * THE SPLINE
 * ------------------------------------------------------------------------- */

/** Longitudes made continuous relative to the first point, so a run that
 *  crosses 180° is one monotonic sequence instead of a 360° jump. The first
 *  point keeps its source value, so nothing translates. */
function unwrapLons(pts) {
  const out = [pts[0].slice(0, 2)];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[i - 1][0];
    out.push([prev + dLon(pts[i][0], prev), pts[i][1]]);
  }
  return out;
}

/** Drop consecutive duplicates. Catmull-Rom divides by the gap between knots,
 *  and GDACS's abutting segments hand us exact repeats at every seam. */
function dedupe(pts) {
  const out = [pts[0]];
  const eps2 = TRACK_LINE.joinEpsDeg * TRACK_LINE.joinEpsDeg;
  const kept = [0];
  for (let i = 1; i < pts.length; i++) {
    if (sep2(pts[i], out[out.length - 1]) > eps2) {
      out.push(pts[i]);
      kept.push(i);
    }
  }
  return { pts: out, kept };
}

/** One centripetal Catmull-Rom sample between p1 and p2. */
function crPoint(p0, p1, p2, p3, t) {
  const tj = (ti, a, b) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return ti + Math.max(Math.pow(d, TRACK_LINE.alpha), TRACK_LINE.minKnotGap);
  };
  const t0 = 0;
  const t1 = tj(t0, p0, p1);
  const t2 = tj(t1, p1, p2);
  const t3 = tj(t2, p2, p3);
  const tt = t1 + (t2 - t1) * t;

  const lerp = (a, b, ta, tb) => {
    const w = (tt - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/**
 * Bend a polyline into a curve through all of its own points.
 *
 * Returns the curve plus `index`, mapping each ORIGINAL point to its position
 * in the output. That map is what lets the caller cut the curve at the
 * forecast's first fix without re-searching for it in a few hundred vertices.
 *
 * Subdivision is length-scaled, not fixed: a fixed count makes a long leg
 * faceted again at close zoom while wasting vertices on a short one. Bounded
 * both ways, and the whole curve is capped by `maxVertices` so a pathological
 * track costs a coarser line rather than the frame budget.
 */
function spline(pts) {
  if (pts.length < 3) return { curve: pts, index: pts.map((_, i) => i) };

  const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const cos = Math.max(Math.cos(lat0 * DEG), TRACK_LINE.minCosLat);
  const xy = pts.map((p) => [p[0] * cos, p[1]]);

  /* Reflected phantom ends: the curve leaves and arrives along the direction
   *  of its own first and last legs, rather than flattening into them. */
  const before = [2 * xy[0][0] - xy[1][0], 2 * xy[0][1] - xy[1][1]];
  const after = [
    2 * xy[xy.length - 1][0] - xy[xy.length - 2][0],
    2 * xy[xy.length - 1][1] - xy[xy.length - 2][1],
  ];

  let budget = TRACK_LINE.maxVertices;
  const curve = [];
  const index = [];

  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = i === 0 ? before : xy[i - 1];
    const p1 = xy[i];
    const p2 = xy[i + 1];
    const p3 = i + 2 < xy.length ? xy[i + 2] : after;

    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    let n = Math.ceil(len / TRACK_LINE.spacingDeg);
    n = Math.min(Math.max(n, TRACK_LINE.minPerLeg), TRACK_LINE.maxPerLeg);
    n = Math.max(1, Math.min(n, budget));
    budget -= n;

    index.push(curve.length);
    for (let k = 0; k < n; k++) {
      const s = crPoint(p0, p1, p2, p3, k / n);
      curve.push([s[0] / cos, s[1]]);
    }
  }
  index.push(curve.length);
  curve.push([xy[xy.length - 1][0] / cos, xy[xy.length - 1][1]]);

  return { curve, index };
}

/* ---------------------------------------------------------------------------
 * THE BUNDLE DECORATION
 * ------------------------------------------------------------------------- */

const lineFeature = (props, coords) => ({
  type: 'Feature',
  properties: { ...(props || {}), _smoothed: true },
  geometry: { type: 'LineString', coordinates: coords },
});

const okSlot = (props, coords) => ({
  status: 'ok',
  fc: { type: 'FeatureCollection', features: [lineFeature(props, coords)] },
  error: null,
});

/** Properties of a slot's first feature, so the smoothed line keeps whatever
 *  the source stamped on it (`idp_filedate`, `advisnum`, the GDACS event
 *  block). Nothing downstream reads them off the LINE today — the bundle
 *  stamp is taken before this runs — but throwing them away would be a
 *  silent change to what the map carries. */
const propsOf = (fc) => fc?.features?.[0]?.properties || {};

/**
 * A bundle whose two track slots hold one continuous, curved path.
 *
 * A SHALLOW COPY, never a mutation — same rule as withModelTracks and
 * silenceBundle in main.js, and for the same reason: the bundle is a cached
 * object shared with the ambient collections and the cage's ridge builder.
 *
 * MUST RUN AFTER SILENCING. A silent storm has no forecast slot left, so it
 * gets its past track smoothed and nothing joined — which is right: the leg
 * to the current position is a claim about now, and nobody has heard from
 * that storm since yesterday. Run before silencing and the connector would
 * survive the emptying, reaching out toward a forecast that is no longer
 * drawn.
 */
export function smoothTracks(bundle) {
  if (!bundle?.layers) return bundle;
  const pastSlot = bundle.layers.pastTrack;
  const fcSlot = bundle.layers.forecastTrack;
  const hasPast = pastSlot?.status === 'ok';
  const hasFc = fcSlot?.status === 'ok';
  if (!hasPast && !hasFc) return bundle;

  try {
    /* A single-vertex run is not a line and cannot be oriented — it is
     * dropped rather than joined, because there is no direction in it to
     * decide which end of the storm's history it belongs to. */
    let past = hasPast ? stitch(runsFrom(pastSlot.fc)) : [];
    let forecast = hasFc ? stitch(runsFrom(fcSlot.fc)) : [];
    if (past.length < 2) past = [];
    if (forecast.length < 2) forecast = [];
    if (!past.length && !forecast.length) return bundle;

    ({ past, forecast } = orient(past, forecast));

    /* ONE RUN, THEN ONE CUT. `seam` is the index of the forecast's own first
     * fix inside the combined run — the current position, the dot everything
     * else on screen is anchored to. Both halves are emitted up to and from
     * that vertex, so they share it exactly and cannot separate however the
     * curve is tuned. */
    const combined = [...past, ...forecast];
    const seam = past.length;

    const wrapped = unwrapLons(combined);
    const { pts, kept } = dedupe(wrapped);
    if (pts.length < 2) return bundle;

    /* Where the seam landed after duplicate removal. When past and forecast
     * meet at the same coordinate — the healthy case, and every case once
     * NOAA closes the gap at source — the forecast's first point is dropped
     * as a duplicate of the past's last, and the surviving vertex is the one
     * the two halves pivot on. Finding it by walking `kept` rather than by
     * arithmetic on lengths means the answer stays right however many
     * duplicates the source had. */
    let seamAt = kept.indexOf(seam);
    if (seamAt < 0) {
      seamAt = 0;
      for (let j = 0; j < kept.length; j++) if (kept[j] < seam) seamAt = j;
    }

    const { curve, index } = spline(pts);
    if (curve.length < 2) return bundle;

    const layers = { ...bundle.layers };

    if (!past.length) {
      layers.forecastTrack = okSlot(propsOf(fcSlot.fc), curve);
    } else if (!forecast.length) {
      layers.pastTrack = okSlot(propsOf(pastSlot.fc), curve);
    } else {
      const cut = Math.min(Math.max(index[seamAt] ?? 0, 1), curve.length - 1);
      layers.pastTrack = okSlot(propsOf(pastSlot.fc), curve.slice(0, cut + 1));
      layers.forecastTrack = okSlot(propsOf(fcSlot.fc), curve.slice(cut));
    }

    return { ...bundle, layers };
  } catch (e) {
    /* Cosmetic geometry must never cost a track. Straight lines are a worse
     * picture; a blank ocean is a §5 bug. */
    console.warn('[landfall] track smoothing failed; drawing raw tracks:', e?.message || e);
    return bundle;
  }
}

/* Exported for tools/test-trackline.mjs only. Kept here rather than duplicated
 * in the test so the suite exercises the shipped maths. */
export const __internals = { stitch, orient, spline, unwrapLons, dLon, runsFrom };
