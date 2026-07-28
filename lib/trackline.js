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
 * DIRECTION — the invariant that keeps an assembled path honest
 *
 * A STORM DOES NOT REVERSE ONTO ITS OWN PATH BETWEEN TWO CONSECUTIVE FIXES.
 * Storms loop, and a real loop turns thirty or forty degrees per six-hourly
 * fix; a near-180° turn is never weather, it is an assembly mistake. Every
 * way this file can build a wrong path — chaining two descriptions of the
 * same history tail-to-tail, or joining the forecast onto the OLD end of the
 * track instead of the new one — shows up as exactly that reversal, so one
 * check catches all of them without having to know which one happened.
 *
 * Caught on glass 2026-07-26 (Aaron, Genevieve): the past track drew as TWO
 * lines forming a lens — both arms leaving the current-position dot, bowing
 * ~44 px apart, closing again at the far end of the track. That is one
 * polyline going out and coming back, which is what an unguarded assembly
 * produces and what nothing downstream can tell from a legitimate track.
 * ------------------------------------------------------------------------- */

/** Turn angle at `b` going a → b → c, in degrees. 0 is straight ahead, 180 is
 *  a complete reversal. Longitude is latitude-scaled so the angle is the one
 *  on the water rather than the one on a stretched grid. */
function turnDeg(a, b, c) {
  const cos = Math.cos(b[1] * DEG);
  const v1x = dLon(b[0], a[0]) * cos;
  const v1y = b[1] - a[1];
  const v2x = dLon(c[0], b[0]) * cos;
  const v2y = c[1] - b[1];
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (!m1 || !m2) return 0;
  const cosT = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
  return Math.acos(cosT) / DEG;
}

/** Planar length of a polyline, for choosing which side of a fold to keep. */
function runLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.sqrt(sep2(pts[i - 1], pts[i]));
  return d;
}

/**
 * Cut a polyline at any point where it doubles back, and keep the longest
 * piece.
 *
 * Deliberately keeps the LONGEST rather than the first: when a full track has
 * been chained to a partial copy of itself, the full one is the real journey
 * and the offcut is the artefact. Warns on the console — this is a fault in
 * the input or in the chaining, not a routine tidy, and silently dropping
 * geometry is how a track quietly gets shorter than the storm's history.
 */
function unfold(pts, what) {
  if (pts.length < 3) return pts;
  const cuts = [];
  for (let i = 1; i < pts.length - 1; i++) {
    if (turnDeg(pts[i - 1], pts[i], pts[i + 1]) > TRACK_LINE.maxTurnDeg) cuts.push(i);
  }
  if (!cuts.length) return pts;

  const bounds = [0, ...cuts, pts.length - 1];
  let best = pts;
  let bestLen = -1;
  for (let k = 0; k < bounds.length - 1; k++) {
    const piece = pts.slice(bounds[k], bounds[k + 1] + 1);
    const len = runLength(piece);
    if (len > bestLen) { bestLen = len; best = piece; }
  }
  console.warn(
    `[landfall] ${what}: track doubles back at ${cuts.length} point(s) — ` +
    `keeping the longest run (${best.length} of ${pts.length} vertices)`
  );
  return best;
}

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
 * Chain runs head-to-tail wherever their endpoints genuinely coincide.
 *
 * Returns ALL the chains it could build, not one line. GDACS's segments share
 * their fixes exactly, so a whole track collapses to a single chain and the
 * caller never sees the plural.
 *
 * ===> IT USED TO FORCE THE LEFTOVERS INTO ONE LINE. THAT WAS THE BUG. <===
 * The first version, having chained what it could, concatenated whatever was
 * left by nearest endpoint — reasoning that a track in pieces is the fault and
 * one line is the fix. It is not. Two runs describing the SAME history, which
 * is what a source sends when it publishes a track twice, got joined tail to
 * tail: the path walked out along one description and back along the other.
 * On Genevieve (2026-07-26, Aaron) that drew as a lens — two dotted arms
 * leaving the current-position dot, bowing 44 px apart, closing again at the
 * far end of the track.
 *
 * AND IT CANNOT BE CAUGHT DOWNSTREAM. A fold made of two near-parallel copies
 * turns only about 120° at the seam — measured on the reproduction — which is
 * inside the range a genuine sharp recurve reaches. Any threshold low enough
 * to catch it would cut real tracks. The only safe move is not to build it.
 *
 * SO: runs that will not chain stay separate, and separate is EXACTLY what
 * they were before this module existed. That is the floor this whole feature
 * has to clear — a storm whose track cannot be assembled draws the way it
 * always drew, rather than the way we would have liked it to.
 *
 * `joinEpsDeg` is the whole judgement, and it is deliberately tight: two ends
 * are the same end when they are the same COORDINATE, never when they are
 * merely near each other. Near is how you glue two storms together.
 */
function stitch(runs) {
  if (runs.length <= 1) return runs.length ? [[...runs[0]]] : [];

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

  /* Longest first: the caller joins the forecast onto chains[0], and the
   * longest chain is the storm's real journey rather than an offcut. */
  chains.sort((a, b) => runLength(b) - runLength(a));
  return chains;
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
 * end of the world. Measured, not assumed.
 *
 * ===> DISTANCE ALONE IS NOT ENOUGH, AND THAT COST A GLASS FAILURE. <===
 * The first version picked whichever pairing of endpoints was closest. On
 * Genevieve (2026-07-26) it chose the OLD end of the past track, so the
 * connector ran from her oldest fix straight back to the current position —
 * drawing the real track outbound and a chord inbound, a lens with both ends
 * pinned. Nothing errored; the geometry was simply a journey she never made.
 *
 * DIRECTION OF TRAVEL OUTRANKS DISTANCE NOW. A pairing that makes the path
 * reverse onto itself at the seam is REFUSED outright, however near its two
 * endpoints happen to be; among what is left, the smallest gap wins. The
 * connector has to continue where the storm was going, which is the whole
 * meaning of "the most recent end".
 */
function orient(past, forecast) {
  if (!past.length || !forecast.length) return { past, forecast };

  const opts = [
    { p: false, f: false },
    { p: false, f: true },
    { p: true, f: false },
    { p: true, f: true },
  ].map((o) => {
    const pp = o.p ? [...past].reverse() : past;
    const ff = o.f ? [...forecast].reverse() : forecast;
    const tail = pp[pp.length - 1];
    /* The turn the path would take at the seam: in along the past track's
     * last leg, out along the connector. `Infinity` when the past track is a
     * bare two points and there is no incoming leg to compare against — that
     * case falls back to distance, which is all there is to go on. */
    const turn = pp.length >= 2 ? turnDeg(pp[pp.length - 2], tail, ff[0]) : 0;
    return { ...o, past: pp, forecast: ff, gap: sep2(tail, ff[0]), turn };
  });

  const forward = opts.filter((o) => o.turn <= TRACK_LINE.maxTurnDeg);
  const pool = forward.length ? forward : opts;
  if (!forward.length) {
    console.warn('[landfall] track join: every orientation doubles back; taking the nearest');
  }
  let best = pool[0];
  for (const o of pool) if (o.gap < best.gap) best = o;
  return { past: best.past, forecast: best.forecast };
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

/** `extras` are chains that would not join the main one. They ride in the same
 *  slot as additional features — which is precisely how a multi-part track
 *  drew before this module existed, so an unassemblable track is never worse
 *  off than it was. */
const okSlot = (props, coords, extras = []) => ({
  status: 'ok',
  fc: { type: 'FeatureCollection', features: [lineFeature(props, coords), ...extras] },
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
 * withoutFuture in lib/future-slots.js, and for the same reason: the bundle is a
 * cached object shared with the ambient collections and the cage's ridge builder.
 *
 * MUST RUN AFTER THE FUTURE SLOTS ARE EMPTIED. A silent or ENDED storm has no
 * forecast slot left, so it gets its past track smoothed and nothing joined —
 * which is right: the leg to the current position is a claim about now, and
 * nobody has published one. Run it first and that connector would survive the
 * emptying, reaching out toward a forecast that is no longer drawn.
 */
export function smoothTracks(bundle, label = 'storm') {
  if (!bundle?.layers) return bundle;
  const pastSlot = bundle.layers.pastTrack;
  const fcSlot = bundle.layers.forecastTrack;
  const hasPast = pastSlot?.status === 'ok';
  const hasFc = fcSlot?.status === 'ok';
  if (!hasPast && !hasFc) return bundle;

  try {
    const pastRuns = hasPast ? runsFrom(pastSlot.fc) : [];
    const fcRuns = hasFc ? runsFrom(fcSlot.fc) : [];

    /* A run of one vertex is not a line and carries no direction, so there is
     * nothing to orient it by. Dropped rather than guessed at. */
    const pastChains = stitch(pastRuns).map((c) => unfold(c, `${label} past track`)).filter((c) => c.length >= 2);
    const fcChains = stitch(fcRuns).map((c) => unfold(c, `${label} forecast track`)).filter((c) => c.length >= 2);
    if (!pastChains.length && !fcChains.length) return bundle;

    if (pastChains.length > 1 || fcChains.length > 1) {
      /* THE DIAGNOSTIC THAT WAS MISSING. When Genevieve drew a doubled track
       * there was no way to tell from outside whether her source had sent one
       * line or several, and the sandbox cannot reach NOAA to look. One line
       * on the console answers it next time — and names the storm, because
       * every other storm on screen was drawing correctly. */
      console.info(
        `[landfall] ${label}: track will not assemble into one line — ` +
        `past ${pastRuns.length} run(s) → ${pastChains.length} chain(s), ` +
        `forecast ${fcRuns.length} → ${fcChains.length}. Drawing them separately.`
      );
    }

    /* THE MAIN CHAIN IS THE ONE THE FORECAST JOINS. `stitch` returns longest
     * first, and the longest chain is the storm's real journey rather than an
     * offcut. Every other chain is smoothed on its own and drawn as it always
     * was — separate, unjoined, and honest about being separate. */
    let past = pastChains[0] || [];
    let forecast = fcChains[0] || [];
    const extraPast = pastChains.slice(1);
    const extraFc = fcChains.slice(1);

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
     * the two halves pivot on. Found by walking `kept` rather than by
     * arithmetic on lengths, so it stays right however many duplicates the
     * source had. */
    let seamAt = kept.indexOf(seam);
    if (seamAt < 0) {
      seamAt = 0;
      for (let j = 0; j < kept.length; j++) if (kept[j] < seam) seamAt = j;
    }

    const { curve, index } = spline(pts);
    if (curve.length < 2) return bundle;

    const layers = { ...bundle.layers };
    const pastProps = propsOf(pastSlot?.fc);
    const fcProps = propsOf(fcSlot?.fc);
    const smoothed = (chains, props) =>
      chains.map((c) => lineFeature(props, spline(dedupe(unwrapLons(c)).pts).curve));

    if (!past.length) {
      layers.forecastTrack = okSlot(fcProps, curve, smoothed(extraFc, fcProps));
    } else if (!forecast.length) {
      layers.pastTrack = okSlot(pastProps, curve, smoothed(extraPast, pastProps));
    } else {
      const cut = Math.min(Math.max(index[seamAt] ?? 0, 1), curve.length - 1);
      layers.pastTrack = okSlot(pastProps, curve.slice(0, cut + 1), smoothed(extraPast, pastProps));
      layers.forecastTrack = okSlot(fcProps, curve.slice(cut), smoothed(extraFc, fcProps));
    }

    return { ...bundle, layers };
  } catch (e) {
    /* Cosmetic geometry must never cost a track. Straight lines are a worse
     * picture; a blank ocean is a §5 bug. */
    console.warn(`[landfall] ${label}: track smoothing failed; drawing raw tracks:`, e?.message || e);
    return bundle;
  }
}

/* Exported for tools/test-trackline.mjs only. Kept here rather than duplicated
 * in the test so the suite exercises the shipped maths. */
export const __internals = { stitch, orient, spline, unwrapLons, dLon, runsFrom, unfold, turnDeg };
