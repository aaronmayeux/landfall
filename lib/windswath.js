/**
 * windswath.js — the full-track wind swath as ONE merged envelope per
 * threshold (SPEC §4: three tiers, one swath).
 *
 * WHY BUILT, NOT DRAWN. NHC publishes the tiers as per-time quadrant rings
 * (+10 past, +13 current, +12 forecast). Drawing them directly stacks
 * dozens of translucent polygons whose fills compound wherever they overlap
 * — Aaron rejected that look outright; beauty is a driving factor of this
 * app. NHC's own merged product (+9) is rasterized garbage (100%
 * axis-aligned edges, measured 2026-07-24). So the clean merged outline has
 * to be constructed here, from the same four quadrant numbers NHC built
 * theirs from.
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

const DEG = Math.PI / 180;

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
  ring.push(ring[0].slice());
  return ring;
}

/**
 * Build the merged full-track envelope features from the raw tier slots.
 *
 * Inputs (all optional except currentPos — absent tiers simply contribute
 * nothing, per §14's stated-gap rule: what IS published still draws):
 *   pastRadii      — +10 features (radii, ne/se/sw/nw, synoptime)
 *   pastPoints     — +7 features (dtg, geometry Point) — centres for +10
 *   currentField   — +13 features (radii, ne/se/sw/nw)
 *   forecastRadii  — +12 features (radii, ne/se/sw/nw, tau)
 *   forecastPoints — +2 features (tau, geometry Point) — centres for +12
 *   currentPos     — { lon, lat } — the FEED's current position (§4: that is
 *                    the storm; tau 0 is the older synoptic analysis)
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

  /* ---- Past tier: join +10 radii to +7 centres on the 10-digit synoptic
   * time — +7.dtg is a NUMBER, +10.synoptime a STRING of the same digits
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

  /* ---- Forecast tier: +12 radii joined to +2 centres on tau. */
  const centreByTau = new Map();
  for (const f of input.forecastPoints || []) {
    const tau = f.properties?.tau;
    const c = f.geometry?.type === 'Point' ? f.geometry.coordinates : null;
    if (Number.isFinite(tau) && c) centreByTau.set(tau, c);
  }
  const fcByTau = new Map(); // tau -> { kt -> quad }
  for (const f of input.forecastRadii || []) {
    const t = kt(f.properties?.radii);
    const tau = f.properties?.tau;
    if (t == null || !Number.isFinite(tau)) continue;
    if (!fcByTau.has(tau)) fcByTau.set(tau, {});
    fcByTau.get(tau)[t] = quadOf(f.properties);
  }
  const forecast = [...fcByTau.keys()]
    .sort((a, b) => a - b)
    .map((tau) => {
      const c = centreByTau.get(tau);
      return c ? { lon: c[0], lat: c[1], tau, quads: fcByTau.get(tau) } : null;
    })
    .filter(Boolean);

  /* ---- One timeline, strictly along travel (§4): past oldest→newest,
   * current, forecast by ascending tau. Past points coinciding with the
   * current position are dropped so the seam carries no zero-length
   * segment. Tau 0 is the synoptic analysis BEHIND the current position —
   * inserting it after the current entry would fold the timeline back on
   * itself — so it is dropped whenever a current entry exists; without one
   * it stands in as the best available "now". */
  const timeline = [];
  for (const p of past) {
    if (
      cur &&
      Math.abs(p.lat - cur.lat) < opts.coincideDeg &&
      Math.abs(p.lon - cur.lon) < opts.coincideDeg
    )
      continue;
    timeline.push(p);
  }
  if (cur) timeline.push(cur);
  for (const p of forecast) {
    if (p.tau === 0 && cur) continue;
    timeline.push(p);
  }
  if (!timeline.length) return [];

  /* ---- Planar frame, one reference for the whole envelope. */
  const refLat = timeline.reduce((s, p) => s + p.lat, 0) / timeline.length;
  const lonScale = 60 * Math.cos(refLat * DEG);
  const lon0 = timeline[0].lon;
  const toPlane = (p) => ({ x: (p.lon - lon0) * lonScale, y: p.lat * 60 });
  const toLonLat = ([x, y]) => [lon0 + x / lonScale, y / 60];

  /* ---- Per threshold: contiguous runs of timeline points that HAVE the
   * ring, swept; broken wherever a point does not. */
  const features = [];
  for (const t of thresholds) {
    let run = [];
    const flush = () => {
      if (run.length) {
        const ring = sweepRun(run, opts);
        if (ring && ring.every((v) => isFinite(v[0]) && isFinite(v[1]))) {
          features.push({
            type: 'Feature',
            properties: { radii: t, _built: 'sweep' },
            geometry: { type: 'Polygon', coordinates: [ring.map(toLonLat)] },
          });
        }
      }
      run = [];
    };
    for (const p of timeline) {
      const q = p.quads?.[t];
      if (anyRadius(q)) run.push({ ...toPlane(p), quad: q });
      else flush();
    }
    flush();
  }
  return features;
}
