/**
 * windswath.js — the full-track wind swath as ONE merged envelope per
 * threshold (SPEC §4: three tiers, one swath).
 *
 * WHY BUILT, NOT DRAWN. NHC publishes the tiers as per-time quadrant rings
 * (layer 13 past, 16 current, 15 forecast — the ids in `SUMMARY_LAYER`).
 * Drawing them directly stacks
 * dozens of translucent polygons whose fills compound wherever they overlap
 * — Aaron rejected that look outright; beauty is a driving factor of this
 * app. NHC's own merged product is rasterized garbage (100%
 * axis-aligned edges, measured 2026-07-24). So the clean merged outline has
 * to be constructed here, from the same four quadrant numbers NHC built
 * theirs from.
 *
 * ==> THE LAYER NUMBERS IN THIS HEADER WERE WRONG FOR MONTHS. <== They read
 * `+10`, `+13`, `+12`, `+7`, `+2` — offsets from some earlier service whose
 * base has been gone longer than anyone remembers, against real ids of 13, 16,
 * 15, 10 and 5. Nothing broke, because the CODE never used them; only a reader
 * trying to check this file against the service did, and they were sent to the
 * wrong products. `SUMMARY_LAYER` in `data/nhc-mapserver.js` is the only place
 * these ids are stated for real.
 *
 * THE CONSTRUCTION — a swept corridor:
 *  1. Each timeline point carries a centre and four quadrant radii
 *     (ne/se/sw/nw, nm, at compass 45/135/225/315). Radius at any bearing
 *     is a periodic COSINE blend between the flanking quadrants — the HA
 *     project's proven method, chosen because a cosine CANNOT overshoot the
 *     issued radii where a spline can (§4: these are safety colors on a
 *     safety layer; the only acceptable direction to be wrong is inward).
 *  2. The track is resampled at a fixed step (WIND_SWEEP.stepNm), centre
 *     and quadrant values interpolated LINEARLY between published points —
 *     bounded by its endpoints, so interpolation also cannot exceed
 *     anything NHC published. Bearings come from a central difference over
 *     the resampled centres, which smooths the joints between 6-hourly
 *     fixes without any explicit corner handling.
 *  3. The boundary walks the left offsets nose-to-tail, fans around the
 *     final ring's front half, walks the right offsets tail-to-nose, and
 *     fans around the first ring's back half. Every boundary vertex is ON
 *     some point's blended ring; chords between samples cut inward. No
 *     vertex can land outside published extent.
 *
 * KNOWN LIMIT, accepted and recorded: a track that loops back on itself
 * (Harvey-style stalls) self-intersects the corridor. Rare, bounded — the
 * fill renders imperfectly rather than wrongly-colored — and the caller's
 * solver fallback (§5) covers construction THROWING, which this does not.
 * Measure on glass before engineering for it.
 *
 * PLANAR FRAME: nautical miles on a local tangent plane — 1° lat = 60 nm,
 * 1° lon = 60·cos(refLat) nm, refLat fixed per envelope so forward and
 * inverse round-trip exactly. Distortion at storm latitudes is far below
 * the width of any band.
 *
 * Pure functions. Imports: config/constants (tuning), lib/wind (thresholds).
 */

import { WIND_SWEEP } from '../config/constants.js';
import { WIND_KT } from './wind.js';
import { firstCrossing, cutLoop, pathCrossings, splitIndices, segCross } from './unloop.js';
import { unionRings, pointInRing } from './polyunion.js';
import { parseSynopticStamp } from './time.js';
import { alongTrackNm } from './geo.js';

const DEG = Math.PI / 180;

/* ---------------------------------------------------------------------------
 * THE ANTIMERIDIAN — the timeline does not arrive on one branch
 *
 * ==> THIS IS THE SAME FAULT lib/cone-sweep.js NAMES, ARRIVING AT A DIFFERENT
 * DOOR. <== Every position feeding this file is wrapped into (-180, 180]: the
 * source publishes it that way and `solveCentre` below deliberately wraps its
 * answer back. That is fine until the storm walks onto the seam, at which
 * point consecutive positions a hundred miles apart on the water land at
 * opposite ends of the number line — and the planar frame at the foot of
 * `buildFullTrack` measures every point by RAW SUBTRACTION from the first one.
 *
 * MEASURED 2026-08-24 off `origin/archive:latest/geometry/`, Lala CP012026 at
 * 33.4N 175.3W tracking 320°: her nine forecast points run -179.40 to +179.20,
 * her past track back to -137.30. Raw subtraction makes the far end of the
 * forecast 316° from the start of the past instead of 43°, so the corridor was
 * swept most of the way around the planet. The built 34 kt band spanned
 * **359.75° of longitude** — a green ring around the globe, which is what
 * Aaron reported on glass.
 *
 * SPEC-MAP.md §7.9 fixed exactly this for the cone on 2026-08-20 and recorded
 * that the wind bands were reachable by the same seam but had no bytes to
 * build against yet ("only the cone is stitched today, and that is scope
 * rather than a finding"). The bytes now exist.
 *
 * THE OUTPUT IS LEFT UNWRAPPED, past ±180, which is `lib/trackline.js`'s
 * convention for the track and `lib/cone-sweep.js`'s for the cone: it is what
 * makes MapLibre draw ONE shape across the seam instead of two on opposite
 * rims. Anything reading the polygon as numbers rather than drawing it has to
 * know that — `lib/population-count.js` does, and says so.
 * ------------------------------------------------------------------------- */

/** Shortest signed step from one longitude to another, degrees, in (-180, 180].
 *  Two storm fixes a degree apart across the seam are a degree apart. */
export function lonStep(from, to) {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/**
 * Put an ordered list of `{lon, lat}` positions on ONE continuous branch of
 * longitude, in place of the wrapped values, by chaining shortest steps from
 * the first entry. Returns new objects; the inputs are shared with other tiers
 * and must not be mutated.
 *
 * ORDER ALONG TRAVEL IS THE PRECONDITION, and it holds here because the
 * timeline is built oldest-to-newest by construction (§4). Consecutive storm
 * positions are hours apart and never approach 180° of separation, so the
 * shortest step is always the true one. A shuffled list would chain nonsense —
 * which is why this is a timeline helper and not a general ring utility.
 */
export function onOneBranch(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    if (i === 0) { out.push(points[i]); continue; }
    const prev = out[i - 1].lon;
    const lon = prev + lonStep(prev, points[i].lon);
    out.push(lon === points[i].lon ? points[i] : { ...points[i], lon });
  }
  return out;
}

/** Quadrant centres in compass degrees, in blend order. */
const QUAD_BEARINGS = [45, 135, 225, 315];
const QUAD_KEYS = ['ne', 'se', 'sw', 'nw'];

/** Radius (nm) at compass bearing `theta` for quadrant values `quad`
 *  ({ne,se,sw,nw}). Periodic cosine blend between the two flanking quadrant
 *  centres — see the header for why cosine and not a spline. */
export function radiusAtBearing(quad, theta) {
  const t360 = ((theta % 360) + 360) % 360;
  const rel = (t360 - 45 + 360) % 360;
  const idx = Math.floor(rel / 90) % 4;
  const a = quad[QUAD_KEYS[idx]] || 0;
  const b = quad[QUAD_KEYS[(idx + 1) % 4]] || 0;
  const t = (rel - idx * 90) / 90;
  return a + ((b - a) * (1 - Math.cos(Math.PI * t))) / 2;
}

const anyRadius = (q) =>
  !!q && ((q.ne || 0) > 0 || (q.se || 0) > 0 || (q.sw || 0) > 0 || (q.nw || 0) > 0);

/**
 * A wind-radii ring's OWN centre, solved from its geometry and its four
 * published quadrant numbers. `{ lon, lat, missNm }`, or null.
 *
 * ==> A RING STATES ITS CENTRE TWICE, AND THAT IS THE WHOLE TRICK. <== §7.13.
 * The shape is four quarter-circles about one point, so its bounding box is
 * pinned to that point by the quadrant radii:
 *
 *     north edge = lat + max(ne, nw)        east edge = lon + max(ne, se)/cos
 *     south edge = lat - max(se, sw)        west edge = lon - max(nw, sw)/cos
 *
 * Two independent answers for the latitude, two for the longitude. On a real
 * rose they agree — measured, worst case 0.55 nm across every archived ring on
 * two storms. `missNm` is how far they missed, and a ring missing by more than
 * `WIND_SWEEP.centreSolveTolNm` is not a rose and gets no centre from here.
 *
 * ==> WHY THIS EXISTS AT ALL: THE PRODUCT THAT HANGS THE RINGS CAN BE OLDER
 * THAN THE RINGS. <== §7.13. NHC serves the 5-day forecast POINTS and the
 * forecast RADII as separate ArcGIS layers on separate publish cycles, and on
 * 2026-08-21 Moke's points were two advisories and twelve hours behind her
 * radii. Joining them on tau alone hung current rings on stale centres and
 * moved every wind band 108-151 nm east-southeast of where NHC drew it.
 *
 * ==> A CENTROID IS STILL NOT A CENTRE, AND THIS IS NOT ONE. <== The header's
 * long-standing rule stands. A quadrant rose with ne=130 and sw=80 has its
 * centroid well northeast of its centre; this solves the centre from stated
 * radii and never averages vertices.
 *
 * SEAM-SAFE. NHC serves geometry wrapped into (-180, 180], so a ring crossing
 * the antimeridian arrives with vertices at both ends of the number line and a
 * raw min/max spans the globe. Measured on Lala's tau-120 34 kt ring, which
 * straddles 180: unwrapped it solves clean, wrapped it lands 17,000 nm out.
 * Longitudes are put on one continuous branch before the box is taken and the
 * answer is wrapped back on the way out.
 */
export function centreOfRadiiRing(geometry, quad, tolNm = WIND_SWEEP.centreSolveTolNm) {
  if (!geometry || !anyRadius(quad)) return null;

  const pts = [];
  (function walk(a) {
    if (!Array.isArray(a)) return;
    if (typeof a[0] === 'number') pts.push(a);
    else for (const v of a) walk(v);
  })(geometry.coordinates);
  if (pts.length < 4) return null;

  /* One branch of longitude: each vertex within 180° of the one before it. */
  let prev = pts[0][0];
  let lonMin = prev;
  let lonMax = prev;
  let latMin = pts[0][1];
  let latMax = pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const raw = pts[i][0];
    const lon = raw + 360 * Math.round((prev - raw) / 360);
    prev = lon;
    if (lon < lonMin) lonMin = lon;
    if (lon > lonMax) lonMax = lon;
    const lat = pts[i][1];
    if (lat < latMin) latMin = lat;
    if (lat > latMax) latMax = lat;
  }
  if (!Number.isFinite(lonMin) || !Number.isFinite(latMin)) return null;

  const ne = quad.ne || 0;
  const se = quad.se || 0;
  const sw = quad.sw || 0;
  const nw = quad.nw || 0;

  const latFromN = latMax - Math.max(ne, nw) / 60;
  const latFromS = latMin + Math.max(se, sw) / 60;
  const lat = (latFromN + latFromS) / 2;
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) return null;

  const cos = Math.max(Math.cos(lat * DEG), 0.01);
  const lonFromE = lonMax - Math.max(ne, se) / 60 / cos;
  const lonFromW = lonMin + Math.max(nw, sw) / 60 / cos;
  const lon = (lonFromE + lonFromW) / 2;
  if (!Number.isFinite(lon)) return null;

  const missNm = Math.max(
    Math.abs(latFromN - latFromS) * 60,
    Math.abs(lonFromE - lonFromW) * 60 * cos
  );
  if (missNm > tolNm) return null;

  /* Back into (-180, 180] — the branch above is an internal frame. */
  let out = lon;
  while (out > 180) out -= 360;
  while (out <= -180) out += 360;
  return { lon: out, lat, missNm };
}

/** Compass-bearing unit vector in the planar frame (x east, y north). */
const dir = (theta) => [Math.sin(theta * DEG), Math.cos(theta * DEG)];

/** A closed ring sampled fully around one point — the single-point case. */
function fullRing(p, samples) {
  const ring = [];
  for (let k = 0; k < samples; k++) {
    const th = (360 * k) / samples;
    const r = radiusAtBearing(p.quad, th);
    const [dx, dy] = dir(th);
    ring.push([p.x + r * dx, p.y + r * dy]);
  }
  ring.push(ring[0].slice());
  return ring;
}

/**
 * Cut self-intersection loops out of a ring until it is simple, in place.
 *
 * ==> IT IS A FUNCTION SO IT CAN RUN TWICE, AND THAT IS THE WHOLE POINT. <==
 * It used to sit inline, once, BEFORE the final polish. The polish is 3-point
 * averaging on a closed ring: it can nudge a concave vertex outward, so it is
 * capable of MAKING a crossing, and nothing downstream would have looked. The
 * check has to be the last thing that happens, not the second to last.
 *
 * SPEC-MAP.md §7.12 recorded this as a live fault on Jeanne 2004 — a 34 kt
 * ring going in clean at 282 vertices and coming out crossing at 283. **That
 * does not reproduce.** Re-measured 2026-08-29 at exactly that stage, with
 * `firstCrossing` and again with a looser test that counts even a touch: all
 * seven of her final rings are simple. The fault was recorded wrong or has
 * since been fixed by something else. The GUARD is kept anyway, because the
 * structural hole was real — the only check that could catch a polish-made
 * crossing ran before the polish — and a second pass on an already-simple ring
 * is one `firstCrossing` call that finds nothing.
 */
function cutAllLoops(ring, opts) {
  for (let cuts = 0; cuts <= opts.maxLoopCuts; cuts++) {
    const hit = firstCrossing(ring);
    if (!hit) return;
    if (cuts === opts.maxLoopCuts) {
      /* ==> NEVER SPIN, AND NEVER GO QUIET. <== A ring still crossing after
       * the guard is a shape nobody has seen. It is drawn as it is — a
       * slightly wrong band beats a missing one (§5) — and it says so. */
      console.warn(
        '[landfall] wind swath: a band still crosses itself after '
        + `${opts.maxLoopCuts} loop cuts. Drawing it as-is; the geometry is `
        + 'outside anything measured. Expect a fin.'
      );
      return;
    }
    cutLoop(ring, hit);
  }
}

/**
 * Cut one threshold's run into pieces at the loop breaks it carries.
 *
 * ==> A BREAK SHARES ITS POINT WITH THE PIECE BEFORE IT. <== The two corridors
 * meet at the storm's own position rather than leaving a gap. A MISSING ring
 * is the opposite and is handled by the caller: that is the agency saying
 * there was no wind at this hour, and the runs must genuinely part there (§5).
 *
 * ==> A PIECE SHORTER THAN ONE RESAMPLE STEP IS DROPPED, AND THAT IS A REAL
 * FAULT RATHER THAN TIDINESS. <== A break landing on the second-to-last fix of
 * a run leaves a stub with two near-coincident points. `sweepRun` turns that
 * into a ring of repeated vertices — measured on Ida 2021: a 73-vertex polygon
 * carrying 18 zero-length edges, which on the map is a small circle OUTLINED
 * inside the band. It covers nothing the neighbouring piece's end cap does not
 * already cover, because they share the point it is drawn around. It goes.
 *
 * @param {Array<{x:number, y:number, quad:object, brk:boolean}>} run
 * @param {object} opts  WIND_SWEEP
 * @returns {Array<Array>} pieces in travel order; empty for an empty run
 */
function breakRun(run, opts) {
  if (!run.length) return [];

  const pieces = [];
  let cur = [];
  for (let i = 0; i < run.length; i++) {
    cur.push(run[i]);
    /* Never break on the first or last point: there would be nothing on one
     * side of it to sweep. */
    if (run[i].brk && i > 0 && i < run.length - 1) {
      pieces.push(cur);
      cur = [run[i]];
    }
  }
  pieces.push(cur);
  if (pieces.length === 1) return pieces;

  return pieces.filter((p) => {
    if (p.length === 1) return true; /* a genuine one-fix run still draws a ring */
    let len = 0;
    for (let i = 1; i < p.length; i++) len += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    return len >= opts.stepNm;
  });
}

/**
 * The timeline indices at which every band must be broken, because the storm
 * drove back across its own track there.
 *
 * ==> A CORRIDOR TRACED AS TWO WALLS IS ONLY A CORRIDOR WHILE THE PATH DOES
 * NOT OVERLAP ITSELF. <== `sweepRun` below walks a left wall out and a right
 * wall back. On a track that loops, those two names stop describing two sides
 * of one corridor: the inner wall swings past the loop's centre and the
 * boundary it traces stops enclosing the ground the storm actually covered.
 *
 * MEASURED, Jeanne 2004 (SPEC-MAP.md §7.12): 26.2% of her 64 kt outline fell
 * outside her 34 kt outline, and 31.5% outside her 50 kt. That is impossible —
 * anywhere that saw 64 kt saw 34 — and it is the WIDE band losing the area,
 * because the wider the corridor the sooner it outgrows the loop. Katrina and
 * Harvey, who never loop, measure 0% on all three pairs.
 *
 * ==> CUTTING THE WALL CANNOT REACH THIS, WHICH WAS MEASURED BEFORE IT WAS
 * BELIEVED. <== Disabling `cutLoop` entirely moves the figure from 26.2% to
 * 20.0%. The wall cutter is doing its job; the spine is what is wrong.
 *
 * ==> THE CROSSINGS ARE READ OFF THE WHOLE TIMELINE ONCE, NOT OFF EACH
 * THRESHOLD'S RUN, AND THE DIFFERENCE IS MEASURABLE. <== Looping is a fact
 * about the TRACK; it does not change with the wind speed being drawn. Solving
 * it per run splits the 34 kt band at a crossing its 50 kt band never sees, so
 * the two get smoothed over different sub-spines and drift apart at the edges
 * — measured on Harvey 2017, who does not even loop: per-run splitting put
 * 2.8% of his 50 kt outline outside his 34 kt outline, a fault he did not have
 * before. One set of cut points for all three bands, and he is back to 0%.
 *
 * ==> `maxRunSplits` IS A GUARD AND NOT A DIAL. <== Every break is another
 * translucent polygon and another outline on the map. A track past the guard
 * is a shape nobody has measured; it is swept whole, with the nesting fault it
 * came with, and it says so — a slightly wrong band beats a missing one (§5),
 * and going quiet is never the answer.
 *
 * @param {Array<{x:number, y:number}>} spine  the whole timeline, planar
 * @param {object} opts  WIND_SWEEP
 * @returns {Set<number>} timeline indices to break every run at
 */
function trackSplitPoints(spine, opts) {
  if (spine.length < 4) return new Set();

  /* ==> A CROSSING IS NOT AUTOMATICALLY A LOOP. <== HURDAT2 stores position to
   * 0.1°, about 6 nm, so a stalling storm jittering inside its own rounding
   * manufactures crossings that never happened. Harvey 2017 has one: 8 nm
   * across, twelve hours, which is Harvey sitting still over Texas. Breaking
   * his corridor there cost real accuracy and bought nothing — measured, it
   * put 2.8% of his 50 kt outline outside his 34 kt outline, worst offender
   * 10 nm, a fault he did not have before. Refusing it returns him to 0%. */
  const real = pathCrossings(spine.map((p) => [p.x, p.y]))
    .filter((c) => c.width >= opts.loopMinWidthNm);
  const cuts = splitIndices(real);
  if (!cuts.length) return new Set();

  if (cuts.length > opts.maxRunSplits) {
    console.warn(
      `[landfall] wind swath: a track crosses itself in ${cuts.length} places, past `
      + `the ${opts.maxRunSplits} this is measured for. Sweeping it whole; the bands `
      + 'will not nest around the loops.'
    );
    return new Set();
  }
  return new Set(cuts);
}

/**
 * The swept corridor for one ordered run of points, in the planar frame.
 * `pts`: [{x, y, quad}], travel order. Returns a closed ring or null.
 */
function sweepRun(pts, opts) {
  if (!pts.length) return null;
  if (pts.length === 1) return fullRing(pts[0], opts.ringSamples);

  /* Cumulative distance along the raw track. Zero-length duplicate segments
   * are tolerated by the walk below (they contribute no samples). */
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  const total = cum[cum.length - 1];
  if (!(total > 0)) return fullRing(pts[0], opts.ringSamples);

  /* Resample: centre and quadrant values lerped between published points.
   * Step count is clamped so a pathological track cannot explode the
   * vertex budget — the step widens rather than the build dying (§9: feel
   * is the overriding lens). */
  const steps = Math.max(1, Math.min(Math.ceil(total / opts.stepNm), opts.maxSamples));
  const S = [];
  let seg = 0;
  for (let s = 0; s <= steps; s++) {
    const d = (total * s) / steps;
    while (seg < pts.length - 2 && cum[seg + 1] < d) seg++;
    const span = cum[seg + 1] - cum[seg];
    const t = span > 0 ? (d - cum[seg]) / span : 0;
    const A = pts[seg];
    const B = pts[seg + 1];
    const quad = {};
    for (const k of QUAD_KEYS) quad[k] = (A.quad[k] || 0) + ((B.quad[k] || 0) - (A.quad[k] || 0)) * t;
    S.push({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, quad });
  }

  /* SMOOTH THE SAMPLES — Aaron's call: smoothness over accuracy, with as
   * much accuracy as possible. Piecewise-linear interpolation is exact at
   * the fixes but carries a slope CORNER through every one, and the walls
   * mirror every wobble in the raw track — on glass that read as
   * jaggedness. Iterated 3-point averaging over the 10 nm samples is a
   * Gaussian of sigma ≈ sqrt(passes/2)·stepNm (~22 nm at the defaults):
   * fix-scale corners round off, sub-fix wobble dissolves. The error is
   * BOUNDED and stated: each averaged value stays between its neighbours,
   * so a smoothed radius can never exceed any published radius, and a
   * centre can drift from the linear path only where the track curves —
   * by less than the track's own deviation inside the ~2·sigma window.
   * Endpoints are pinned so the envelope still starts and ends exactly at
   * the first and last published fix. */
  for (let p = 0; p < opts.smoothPasses; p++) {
    for (let i = 1; i < S.length - 1; i++) {
      const a = S[i - 1], b = S[i], c = S[i + 1];
      b.x = (a.x + 2 * b.x + c.x) / 4;
      b.y = (a.y + 2 * b.y + c.y) / 4;
      for (const k of QUAD_KEYS) b.quad[k] = (a.quad[k] + 2 * b.quad[k] + c.quad[k]) / 4;
    }
  }

  /* Bearing per sample: central difference, smoothing the 6-hourly joints. */
  const bearings = S.map((_, i) => {
    const a = S[Math.max(0, i - 1)];
    const b = S[Math.min(S.length - 1, i + 1)];
    return Math.atan2(b.x - a.x, b.y - a.y) / DEG;
  });

  const offset = (p, theta) => {
    const r = radiusAtBearing(p.quad, theta);
    const [dx, dy] = dir(theta);
    return [p.x + r * dx, p.y + r * dy];
  };

  const ring = [];
  /* Left wall, nose to tail. */
  for (let i = 0; i < S.length; i++) ring.push(offset(S[i], bearings[i] - 90));
  /* Front cap: fan the last ring from its left perpendicular through its
   * heading to its right perpendicular. */
  const bn = bearings[bearings.length - 1];
  for (let k = 1; k < opts.capSamples; k++) {
    ring.push(offset(S[S.length - 1], bn - 90 + (180 * k) / opts.capSamples));
  }
  /* Right wall, tail to nose. */
  for (let i = S.length - 1; i >= 0; i--) ring.push(offset(S[i], bearings[i] + 90));
  /* Back cap: fan the first ring from its right perpendicular through its
   * stern to its left perpendicular. */
  const b0 = bearings[0];
  for (let k = 1; k < opts.capSamples; k++) {
    ring.push(offset(S[0], b0 + 90 + (180 * k) / opts.capSamples));
  }

  /* DESPIKE — remove wall folds before polishing. Where the radius profile
   * changes faster than the wall advances (violent radii swings, sharp
   * turns), the offset curve locally reverses and leaves a hairline
   * zigzag: near-reversal turns on sub-step segments (measured: 150–170°
   * turns on 0.7–3 nm segments, against ~10 nm honest spacing). Those
   * vertices are cut. The guard is BOTH conditions — a sharp turn on
   * short segments — because a genuine cusp (a published ZERO quadrant
   * pinches the ring to the centre) also turns hard but descends on
   * step-length segments, and cutting it would paint wind where NHC
   * published none. Cutting a fold spans at most spikeMaxSegNm and lands
   * inside coverage the neighbouring samples already claim. */
  const turnCos = Math.cos(opts.spikeTurnDeg * DEG);
  for (let guard = ring.length; guard > 0; guard--) {
    let cut = false;
    for (let i = 0; i < ring.length && ring.length > 8; i++) {
      const n = ring.length;
      const a = ring[(i - 1 + n) % n];
      const b = ring[i];
      const c = ring[(i + 1) % n];
      const v1 = [b[0] - a[0], b[1] - a[1]];
      const v2 = [c[0] - b[0], c[1] - b[1]];
      const l1 = Math.hypot(v1[0], v1[1]);
      const l2 = Math.hypot(v2[0], v2[1]);
      if (l1 > opts.spikeMaxSegNm && l2 > opts.spikeMaxSegNm) continue;
      if (!l1 || !l2) { ring.splice(i, 1); cut = true; i--; continue; }
      const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
      /* cos below the threshold cosine means the direction reversed by
       * more than spikeTurnDeg — a fold, not a corner. */
      if (cos >= turnCos) continue;
      ring.splice(i, 1);
      cut = true;
      i--;
    }
    if (!cut) break;
  }

  /* ==> CUT THE LOOPS. THE DESPIKE ABOVE CANNOT SEE THESE. <==
   *
   * A fold and a CROSSING are different faults. The despike removes a
   * hairline fold — a near-reversal on sub-step segments. Offset a curve
   * inward by more than its own radius of curvature and something else
   * happens: the wall swings round and genuinely crosses itself, over tens
   * of vertices, at honest step spacing and gentle per-vertex turns. Every
   * local test passes. The ring is simply not simple any more.
   *
   * That drew as the fins and spurs Aaron reported (SPEC-MAP.md §7.12).
   * MEASURED on the archived bytes: Lala's 34 kt ring crossed itself three
   * times, enclosing 90, 41 and 25 vertices, all between 27.8N and 30.4N —
   * her recurve, where the track's turning radius drops below the 130-160 nm
   * she was throwing 34 kt winds out to.
   *
   * ==> CUTTING THE LOOP IS THE CORRECT ANSWER, NOT A COSMETIC ONE. <== The
   * region this ring is trying to describe is the UNION of every wind rose
   * along the path. On the inside of a tight turn the boundary of that union
   * is the ENVELOPE of the offset curve — which is exactly the offset curve
   * with its self-intersection loops trimmed away. The loop is an artefact of
   * tracing a boundary that the swept area never had. Nothing published is
   * lost: every point inside a cut loop is still inside the ring, claimed by
   * the samples on either side of the crossing.
   *
   * THE LARGER PIECE WINS, BY AREA. A crossing splits the ring into two
   * closed pieces. Which is the storm and which is the artefact is decided by
   * comparing their areas, not by assuming the loop is the shorter run of
   * indices — that assumption holds for the folds measured here and would
   * fail silently on the day it did not. */
  cutAllLoops(ring, opts);

  /* UNIFORM RESAMPLE before polishing. The despiked ring's vertex spacing
   * is irregular (walls at step spacing, caps finer, cut regions coarser),
   * and 3-point averaging over IRREGULAR spacing can sharpen local angles
   * instead of rounding them — measured: the polish pass manufactured a
   * 154° micro-kink out of an 85° corner it was meant to soften. On
   * uniform spacing the same averaging is a clean low-pass and can only
   * round. Resampled points lie ON the ring; chords cut inward. */
  {
    const spacing = opts.stepNm / 2;
    const per = [0];
    for (let i = 1; i < ring.length; i++) {
      per.push(per[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
    }
    const close = Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]);
    const total = per[per.length - 1] + close;
    if (total > spacing * 8) {
      const count = Math.min(Math.ceil(total / spacing), opts.maxSamples);
      const out = [];
      let j = 0;
      for (let s = 0; s < count; s++) {
        const d = (total * s) / count;
        while (j < ring.length - 1 && per[j + 1] < d) j++;
        const a = ring[j];
        const b = ring[(j + 1) % ring.length];
        const span = (j + 1 < per.length ? per[j + 1] : total) - per[j];
        const t = span > 0 ? (d - per[j]) / span : 0;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
      ring.length = 0;
      ring.push(...out);
    }
  }

  /* FINAL POLISH: the same 3-point averaging on the closed ring itself,
   * rounding the wall/cap junctions and shaving any hairline fold where an
   * inside turn made the walls cross. On a ring this CAN nudge a concave
   * vertex outward — toward its neighbours' chord — but the move is
   * bounded by the sagitta at 10 nm vertex spacing: a couple of nm at the
   * sharpest dent, against bands a hundred wide. Aaron's stated trade
   * (smoothness over accuracy), taken with the bound recorded. */
  for (let p = 0; p < opts.ringSmoothPasses; p++) {
    const n = ring.length;
    const prev = ring.map((v) => v.slice());
    for (let i = 0; i < n; i++) {
      const a = prev[(i - 1 + n) % n];
      const c = prev[(i + 1) % n];
      ring[i] = [(a[0] + 2 * prev[i][0] + c[0]) / 4, (a[1] + 2 * prev[i][1] + c[1]) / 4];
    }
  }

  /* ==> AND CHECK AGAIN, BECAUSE THE POLISH IS CAPABLE OF MAKING ONE. <==
   * See `cutAllLoops`. On every ring measured this finds nothing; it exists so
   * the last thing to touch the geometry is not also the last thing nobody
   * looked at. */
  cutAllLoops(ring, opts);

  ring.push(ring[0].slice());
  return ring;
}

/**
 * How many LEADING forecast entries the storm has already driven past (§7.14).
 *
 * WALKED FROM THE FRONT AND STOPPED AT THE FIRST LIVE ONE, unlike the two clock
 * rules beside the call site, which filter. A recurving storm's later hours
 * genuinely lie behind its present heading — that is what recurving IS — and
 * cutting those from the middle would delete real forecast wind.
 *
 * NO READABLE HEADING, NO TEST: returns 0 and the clock rules stand alone. A
 * heading is never inferred here — deriving one from the forecast points would
 * be asking the suspect for its own alibi, and doubting them is this function's
 * whole job.
 *
 * @param {Array} entries  forecast tier entries, ascending tau, each {lon, lat}
 * @param {{lon: number, lat: number}} from  the storm's current position
 * @param {number} headingDeg  the agency's published motion, compass degrees
 * @param {number} graceNm  how far behind before an entry counts as past
 * @returns {number} count of leading entries to skip
 */
function leadingOvertaken(entries, from, headingDeg, graceNm) {
  if (!Number.isFinite(headingDeg)) return 0;
  let n = 0;
  while (n < entries.length) {
    const along = alongTrackNm(from.lon, from.lat, entries[n].lon, entries[n].lat, headingDeg);
    if (along == null || along >= -graceNm) break;
    n += 1;
  }
  return n;
}

/**
 * Build the merged full-track envelope features from the raw tier slots.
 *
 * Inputs (all optional except currentPos — absent tiers simply contribute
 * nothing, per §14's stated-gap rule: what IS published still draws):
 *   pastRadii      — layer 13 features (radii, ne/se/sw/nw, synoptime)
 *   pastPoints     — layer 10 features (dtg, geometry Point) — centres for 13
 *   currentField   — layer 16 features (radii, ne/se/sw/nw)
 *   forecastRadii  — layer 15 features (radii, ne/se/sw/nw, tau)
 *   forecastPoints — layer 5 features (tau, geometry Point) — centres for 15
 *   currentPos     — { lon, lat, at, headingDeg } — the FEED's current position
 *                    (§4: that is the storm; tau 0 is the older synoptic
 *                    analysis). `at` orders the timeline, `headingDeg` is the
 *                    agency's published motion and is what §7.14 projects
 *                    against; both are optional and each rule that needs one
 *                    simply does not run without it.
 *
 * Returns [{ type:'Feature', properties:{ radii, _built:'sweep' },
 * geometry: Polygon }] — one feature per (threshold, contiguous run). A
 * threshold's run BREAKS at any timeline point where that threshold has no
 * published ring: sweeping across a time NHC published as ring-free would
 * claim wind NHC did not (§5). Geometry coordinates are used for every
 * centre; attribute lat/lon pairs are rounded whole degrees on both point
 * layers (measured, §4).
 */
export function buildFullTrack(input, opts = WIND_SWEEP) {
  const thresholds = [WIND_KT.KT34, WIND_KT.KT50, WIND_KT.KT64];

  const kt = (v) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return thresholds.includes(n) ? n : null;
  };
  const quadOf = (p) => ({
    ne: Number(p.ne) || 0,
    se: Number(p.se) || 0,
    sw: Number(p.sw) || 0,
    nw: Number(p.nw) || 0,
  });

  /* ---- Past tier: join layer 13 radii to layer 10 centres on the
   * 10-digit synoptic time — 10.dtg is a NUMBER, 13.synoptime a STRING of the same digits
   * (measured live, §4). Radii without a joinable centre are dropped: a
   * ring with no stated centre cannot be placed, and a centroid is not a
   * centre (§4). */
  const radiiBySynop = new Map(); // synoptime string -> { kt -> quad }
  for (const f of input.pastRadii || []) {
    const t = kt(f.properties?.radii);
    const syn = f.properties?.synoptime != null ? String(f.properties.synoptime) : null;
    if (t == null || !syn) continue;
    if (!radiiBySynop.has(syn)) radiiBySynop.set(syn, {});
    radiiBySynop.get(syn)[t] = quadOf(f.properties);
  }
  const past = [];
  for (const f of input.pastPoints || []) {
    const dtg = f.properties?.dtg != null ? String(f.properties.dtg) : null;
    const c = f.geometry?.type === 'Point' ? f.geometry.coordinates : null;
    if (!dtg || !c) continue;
    past.push({ lon: c[0], lat: c[1], order: Number(f.properties.dtg), quads: radiiBySynop.get(dtg) || {} });
  }
  past.sort((a, b) => a.order - b.order);

  /* ---- Current tier: one entry at the feed position. */
  const cur = input.currentPos ? { lon: input.currentPos.lon, lat: input.currentPos.lat, quads: {} } : null;
  if (cur) {
    for (const f of input.currentField || []) {
      const t = kt(f.properties?.radii);
      if (t != null) cur.quads[t] = quadOf(f.properties);
    }
  }

  /* ---- Forecast tier: layer 15 radii joined to layer 5 centres on tau. */
  const centreByTau = new Map();
  /* The CENTRE's own valid hour, per tau. Kept alongside the position because
   * it is what decides whether this entry sits behind the storm on the
   * timeline — see the splice below. The wind ROSE's `validtime` is a
   * different hour again (measured: NHC published advisory 36A with forecast
   * points on a 09Z cycle and wind radii on a 06Z synoptic), and using it here
   * would order the timeline by one clock and place it by another. */
  const timeByTau = new Map();
  for (const f of input.forecastPoints || []) {
    const tau = f.properties?.tau;
    const c = f.geometry?.type === 'Point' ? f.geometry.coordinates : null;
    if (Number.isFinite(tau) && c) {
      centreByTau.set(tau, c);
      const at = Number(f.properties?._time);
      if (Number.isFinite(at)) timeByTau.set(tau, at);
    }
  }
  const fcByTau = new Map(); // tau -> { kt -> quad }
  /* ==> THE RING'S OWN CENTRE AND THE RING'S OWN CLOCK, WHEN IT WILL GIVE
   * THEM. <== §7.13. `centreOfRadiiRing` solves the centre out of the shape
   * and its published radii; `synoptime` is the hour that shape is valid at.
   * They are taken TOGETHER or not at all — placing by one product's clock
   * while ordering by another's is the exact fault §7.12 records, and taking
   * only the centre here would recreate it mirrored. */
  const solvedByTau = new Map(); // tau -> { lon, lat, missNm }
  const solvedAtByTau = new Map(); // tau -> epoch ms
  for (const f of input.forecastRadii || []) {
    const t = kt(f.properties?.radii);
    const tau = f.properties?.tau;
    if (t == null || !Number.isFinite(tau)) continue;
    const quad = quadOf(f.properties);
    if (!fcByTau.has(tau)) fcByTau.set(tau, {});
    fcByTau.get(tau)[t] = quad;

    /* Several thresholds share a tau and each solves the same point. The one
     * that CLOSES TIGHTEST wins — no averaging, which would have to reason
     * about the seam a second time, and no first-wins, which would depend on
     * feature order the service does not promise. */
    const c = centreOfRadiiRing(f.geometry, quad);
    if (c) {
      const held = solvedByTau.get(tau);
      if (!held || c.missNm < held.missNm) solvedByTau.set(tau, c);
      /* ==> `validtime`, NOT `synoptime`, AND THE TWO ARE NOT INTERCHANGEABLE
       * HERE. <== On this layer `synoptime` is the RUN's base hour and is
       * identical on every ring in the file (measured: 2026082118 on all ten of
       * Moke's); `validtime` is the hour THIS ring is valid at, and it is what
       * decides where the ring sits on the timeline. Ordering by the run base
       * would put every forecast hour at the same instant, behind the storm,
       * and the drop rule would take the lot.
       *
       * TEN DIGITS HERE, `DD/HHMM` ON THE FORECAST POINTS. Same field name,
       * different format, different layer — which is why the two parsers are
       * separate functions in lib/time.js rather than one with a mode flag. */
      const at = parseSynopticStamp(f.properties?.validtime);
      if (at != null && !solvedAtByTau.has(tau)) solvedAtByTau.set(tau, at);
    }
  }
  const forecast = [...fcByTau.keys()]
    .sort((a, b) => a - b)
    .map((tau) => {
      /* THE JOINED POINT IS THE FALLBACK NOW, NOT THE DEFAULT. A ring that
       * will not solve — a shape that is not a clean rose, or all-zero radii —
       * still gets placed the old way rather than dropped, because a band in
       * roughly the right place beats no band (§5). */
      const solved = solvedByTau.get(tau);
      if (solved) {
        return {
          lon: solved.lon,
          lat: solved.lat,
          tau,
          at: solvedAtByTau.get(tau) ?? timeByTau.get(tau) ?? null,
          quads: fcByTau.get(tau),
        };
      }
      const c = centreByTau.get(tau);
      return c
        ? { lon: c[0], lat: c[1], tau, at: timeByTau.get(tau) ?? null, quads: fcByTau.get(tau) }
        : null;
    })
    .filter(Boolean);

  /* ---- One timeline, strictly along travel (§4): past oldest→newest,
   * current, forecast by ascending tau. Past points coinciding with the
   * current position are dropped so the seam carries no zero-length
   * segment.
   *
   * ==> EVERY FORECAST HOUR BEHIND THE CURRENT POSITION IS DROPPED, NOT JUST
   * TAU 0. <== This rule used to name tau 0 alone, on the reasoning that the
   * synoptic analysis is the one entry sitting behind the storm and inserting
   * it after the current entry would fold the timeline back on itself. That
   * reasoning was exactly right and the list was too short.
   *
   * MEASURED 2026-08-21 on Lala: the feed had her at 28.6N at 21:00Z while
   * advisory 36A, published nine hours earlier, still ran tau 0 at 26.9N and
   * tau 12 at 28.1N. Dropping tau 0 left the timeline going
   * current 28.6N -> tau-12 28.1N -> tau-24 29.8N. It still folds back, just
   * half a degree instead of one and a half — and half a degree is nothing
   * against a corridor 130 to 160 nm wide, so both walls swung round and
   * crossed themselves. Aaron saw the result as fins and spurs.
   *
   * This is the same fact lib/forecast-now.js §7.11 handles for the track
   * line, arriving through a second door. A forecast hour that has already
   * happened is not a forecast, wherever it is being drawn.
   *
   * TIME FIRST, TAU AS THE FALLBACK. When both the feed's observation time and
   * the centre's valid hour are readable the comparison is made on them. When
   * either is missing the old tau-0 rule stands unchanged, because a source
   * that publishes no usable clock is not evidence that its hours have passed.
   * Without a current entry at all, tau 0 stays and stands in as the best
   * available "now". */
  /* THE LONGITUDE TEST GOES THROUGH `lonStep`, NOT THROUGH SUBTRACTION. A past
   * fix at 179.98 and a current position at -179.99 are two thousandths of a
   * degree apart on the water and 359.97 apart on the number line; raw
   * subtraction keeps the duplicate and the tier seam gets the zero-length
   * segment this test exists to prevent. */
  const timeline = [];
  for (const p of past) {
    if (
      cur &&
      Math.abs(p.lat - cur.lat) < opts.coincideDeg &&
      Math.abs(lonStep(cur.lon, p.lon)) < opts.coincideDeg
    )
      continue;
    timeline.push(p);
  }
  if (cur) timeline.push(cur);
  const curAt = Number.isFinite(Date.parse(input.currentPos?.at ?? ''))
    ? Date.parse(input.currentPos.at)
    : null;

  /* ==> AND THE CLOCK IS STILL NOT THE WHOLE ANSWER. <== §7.14. Both rules
   * above ask what TIME it is. Neither catches a forecast hour that has not
   * arrived yet and is already BEHIND the storm, which is what happens whenever
   * the forecast radii are an advisory older than the position and the storm is
   * running faster than that advisory said it would.
   *
   * MEASURED 2026-08-22T13:04Z: Lala's feed had her at 30.3N 172.0W at 09:00Z;
   * advisory 39's 34 kt ring for 12:00Z solved to 30.1N 171.2W — three hours
   * away and 34 nm behind her along her heading. The timeline ran 43 nm on a
   * bearing of 106° and then turned back to 316°, and a 210° reversal inside a
   * corridor 130-150 nm wide sends both walls round across themselves.
   * lib/unloop.js then cut the crossings out, which is why it read on glass as
   * a link rather than as an obvious fold.
   *
   * Must agree hour for hour with lib/forecast-now.js §7.11, which asks the
   * identical question about the identical advisory for the track line — hence
   * one shared `alongTrackNm` and one shared grace distance. */
  const passed = cur
    ? leadingOvertaken(forecast, cur, input.currentPos?.headingDeg, opts.behindGraceNm)
    : 0;

  for (let i = 0; i < forecast.length; i += 1) {
    const p = forecast[i];
    if (cur && p.tau === 0) continue;
    if (cur && curAt != null && p.at != null && p.at <= curAt) continue;
    if (i < passed) continue;
    timeline.push(p);
  }
  if (!timeline.length) return [];

  return sweepTimeline(timeline, opts);
}

/**
 * Merge one threshold's pieces into as few shapes as possible.
 *
 * ==> A BAND IS ONE REGION AND SHOULD BE ONE SHAPE. <== The loop split above
 * makes a band several polygons. On the map that read as edges drawn INSIDE
 * the band's own colour — the line layer outlines every polygon, cut caps
 * included — and as a darker lobe wherever two overlapped, because 0.14 fill
 * on 0.14 fill is 0.26. Aaron off glass, 2026-08-30. Measured: 12.2% of
 * Jeanne 2004's outline and 17.7% of Nadine 2012's was boundary buried inside
 * a sibling, against 0% before the split.
 *
 * ==> PIECES THAT DO NOT TOUCH STAY APART, AND THAT IS NOT A COMPROMISE. <==
 * A band genuinely breaks where the agency published no ring — the storm's
 * wind field ended and started again — and merging across that would claim
 * wind nobody recorded (§5). Only overlapping pieces merge, so the two kinds
 * of break stay different: a loop break heals, a no-wind break does not.
 *
 * ==> IT KEEPS THE UNMERGED PIECES WHEN THE UNION REFUSES. <== `unionRings`
 * answers null on any shape it does not model rather than guessing, and the
 * fallback is exactly what shipped before this function existed. The worst
 * case is the map Aaron already has, never a missing band (§5).
 *
 * @param {Array<Array>} rings  closed rings from `sweepRun`, one threshold
 * @param {object} opts  WIND_SWEEP
 * @returns {Array<Array>} closed rings, ready to become features
 */
function mergeBands(rings, opts) {
  if (rings.length < 2 || opts.mergePieces === false) return rings;

  /* `sweepRun` returns rings closed (last vertex repeats the first); the union
   * walks them open. Converted here so neither side has to know the other's
   * convention. */
  const open = rings.map((r) => (
    r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]
      ? r.slice(0, -1)
      : r.slice()
  ));

  /* Group by overlap, transitively: A touches B and B touches C makes one
   * shape of all three even where A and C are nowhere near each other. */
  const groups = [];
  for (const ring of open) {
    const hits = groups.filter((g) => g.some((o) => ringsOverlap(ring, o)));
    if (!hits.length) { groups.push([ring]); continue; }
    const merged = [ring, ...hits.flat()];
    for (const h of hits) groups.splice(groups.indexOf(h), 1);
    groups.push(merged);
  }

  const out = [];
  for (const g of groups) {
    if (g.length === 1) { out.push(closeRing(g[0])); continue; }
    const united = unionRings(g, { stepBudget: opts.unionStepBudget });
    if (united) {
      out.push(closeRing(united));
    } else {
      /* ==> SAY SO. <== A refusal is a shape outside what the union models,
       * and the band is still drawn. Silence on a known-imperfect shape is
       * the §5 failure. */
      console.warn(
        '[landfall] wind swath: could not merge a band\'s pieces into one shape. '
        + 'Drawing them separately; expect an edge inside the band.'
      );
      for (const r of g) out.push(closeRing(r));
    }
  }
  return out;
}

/** Two rings overlap when either has a vertex strictly inside the other, or
 *  their boundaries cross. Both tests are needed: two rings can cross without
 *  either holding the other's vertices only in contrived cases, but a piece
 *  wholly swallowed by its neighbour has no crossing at all. */
function ringsOverlap(a, b) {
  if (a.some((v) => pointInRing(v, b))) return true;
  if (b.some((v) => pointInRing(v, a))) return true;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

const closeRing = (r) => (
  r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]
    ? r
    : [...r, r[0].slice()]
);

/**
 * Sweep an ordered timeline into merged envelopes, one feature per
 * (threshold, contiguous run).
 *
 * ==> EXTRACTED FROM `buildFullTrack` FOR THE ARCHIVE, WITH NO BEHAVIOUR
 * CHANGE. <== Everything above it in that function is about a LIVE feed —
 * joining radii to centres across five MapServer layers, dropping forecast
 * hours that have already happened, solving a ring's own centre. None of that
 * exists for a finished storm: `lib/season-windswath.js` builds the same
 * timeline shape straight out of HURDAT2's twelve radii columns. What is left
 * here — one branch of longitude, one planar frame, contiguous runs per
 * threshold — is the same maths either way, and duplicating it is how the two
 * would drift apart on the seam.
 *
 * @param {Array<{lon:number, lat:number, quads:object}>} timeline
 *   strictly ordered along travel, longitudes as published (inside ±180).
 *   `quads` is keyed by threshold in knots; a threshold absent from a point
 *   BREAKS that threshold's run there.
 * @param {object} [opts] WIND_SWEEP, or a copy of it
 * @returns {Array} GeoJSON Polygon features, `properties.radii` in knots
 */
export function sweepTimeline(timeline, opts = WIND_SWEEP) {
  if (!timeline?.length) return [];
  const thresholds = [WIND_KT.KT34, WIND_KT.KT50, WIND_KT.KT64];

  /* ---- ONE BRANCH OF LONGITUDE, BEFORE ANYTHING MEASURES A DISTANCE. ----
   * See the header block: every entry arrives wrapped into (-180, 180], and
   * the frame below subtracts raw longitudes. This is the last point at which
   * the list is complete and still strictly ordered along travel, which is
   * `onOneBranch`'s precondition. */
  const branched = onOneBranch(timeline);

  /* ---- Planar frame, one reference for the whole envelope. */
  const refLat = branched.reduce((s, p) => s + p.lat, 0) / branched.length;
  const lonScale = 60 * Math.cos(refLat * DEG);
  const lon0 = branched[0].lon;
  const toPlane = (p) => ({ x: (p.lon - lon0) * lonScale, y: p.lat * 60 });
  const toLonLat = ([x, y]) => [lon0 + x / lonScale, y / 60];

  /* ---- Per threshold: contiguous runs of timeline points that HAVE the
   * ring, swept; broken wherever a point does not. */
  /* ---- Where the storm drove back over itself. Read once off the whole
   * timeline and applied to every threshold — see `trackSplitPoints`. */
  const breakAt = trackSplitPoints(branched.map(toPlane), opts);

  const features = [];
  for (const t of thresholds) {
    let run = [];
    const rings = [];
    const flush = () => {
      /* ==> THE MERGE HAPPENS INSIDE ONE RUN AND NEVER ACROSS TWO. <== The two
       * kinds of break are not the same fact. A LOOP break is this file's own
       * doing and the ground either side of it is continuously swept, so those
       * pieces heal. A break BETWEEN runs is the agency saying it published no
       * ring for that hour, and healing across it would answer a question
       * nobody asked (§5) — even where the two runs happen to overlap on the
       * map. `tools/test-season-swath.mjs` asserts exactly this on a zero row
       * mid-life, and caught it when this first merged everything in sight. */
      const pieces = [];
      for (const piece of breakRun(run, opts)) {
        const ring = sweepRun(piece, opts);
        if (ring && ring.every((v) => isFinite(v[0]) && isFinite(v[1]))) pieces.push(ring);
      }
      rings.push(...mergeBands(pieces, opts));
      run = [];
    };
    for (let i = 0; i < branched.length; i++) {
      const p = branched[i];
      const q = p.quads?.[t];
      if (!anyRadius(q)) { flush(); continue; }
      run.push({ ...toPlane(p), quad: q, brk: breakAt.has(i) });
    }
    flush();

    for (const ring of rings) {
      features.push({
        type: 'Feature',
        properties: { radii: t, _built: 'sweep' },
        geometry: { type: 'Polygon', coordinates: [ring.map(toLonLat)] },
      });
    }
  }
  return features;
}

/* Exported for the suites only. Kept here rather than duplicated in a test so
 * they exercise the shipped maths.
 *
 * (The comment above this line sat over nothing for a while — the export it
 * described had been removed and it was left behind. Retired properly on
 * 2026-08-22 rather than left as a signpost to a deleted thing, §12.) */
export const __internals = { leadingOvertaken, breakRun };
