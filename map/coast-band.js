/**
 * coast-band.js — watch/warning coastal painting by WIDE-BAND SELECT.
 *
 * THE PROBLEM (SPEC §7). NHC publishes watch/warnings as BREAKPOINTS — named
 * coastal reference points joined by straight lines (measured on Bertha:
 * 11 vertices over 464 km). Drawn as delivered, a warning covering a bay
 * renders as a chord slicing across open water.
 *
 * THE FIX — and why it is a SELECT, not a TRACE. The previous approach
 * (snap-and-walk, retired 2026-07-24) tried to walk ONE exact coastline path
 * between breakpoints. Every failure it ever had was a walk failure: it could
 * not step from the mainland onto a barrier island, and it could wander the
 * wrong way along tile-boundary edges. This module drops the walk entirely:
 *
 *   1. Buffer NHC's breakpoint polyline into a corridor of half-width
 *      COAST_BAND.halfWidthKm, with FLAT END CAPS so it does not bleed past
 *      the first and last breakpoint.
 *   2. Select every coast segment (rings from map/coast-source.js) that falls
 *      inside the corridor.
 *   3. Paint those segments the warning color. No ordering, no stitching, no
 *      winding — a segment is in the band or it is not.
 *
 * WIDE AND INCLUSIVE ON PURPOSE (Aaron, verbatim: "I WANT it to catch all the
 * little bays and islands. This is a warning to the area. They are in the
 * area. We can cast a wide band."). A watch/warning is issued for an AREA;
 * every bay, inlet, and barrier island inside it is under the warning.
 * Over-inclusion near the line is the desired behavior, not a bug. Inside the
 * warned area there is no "wrong" coast to avoid — only coast in the band or
 * out of it.
 *
 * WHAT KEEPS THIS HONEST (§5, §7):
 *   - No coast loaded in the corridor is `unavailable`, never "no warning
 *     here": the feature keeps NHC's delivered geometry, flagged
 *     `_banded: false` with a reason. Official geometry isn't ours to curve —
 *     the chord is the fallback, exactly as before.
 *   - Tile-boundary edges are filtered before selection. The ocean polygon's
 *     ring is part real shoreline and part straight tile edge; painting a
 *     tile seam as warned coastline is a confident wrong line (§5).
 *
 * THIS FILE IS SCHEMA-BLIND. It receives rings of [lon, lat] from
 * map/coast-source.js and never learns which basemap they came from.
 *
 * Imports: config/ only. Pure — no map, no DOM, no fetch.
 */

import { COAST_BAND } from '../config/constants.js';

const KM_PER_DEG_LAT = 111.32;
const toRad = Math.PI / 180;

/* ---------------------------------------------------------------------------
 * GEOMETRY PARTS
 *
 * A feature's parts are kept separate on purpose: flattening a
 * MultiLineString would invent a phantom leg between the end of one part and
 * the start of the next, and that phantom leg would carry corridor width
 * across coast NHC never warned.
 * ------------------------------------------------------------------------- */

function lineParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

/* ---------------------------------------------------------------------------
 * THE CORRIDOR
 *
 * All distance work happens in a local planar km-space (equirectangular,
 * longitude scaled by cos of the feature's mean latitude). At corridor scale
 * (tens of km) the planar error is far below the width of the band, and the
 * per-vertex cost is two multiplies instead of haversine trig paid tens of
 * thousands of times per re-select.
 * ------------------------------------------------------------------------- */

/**
 * Build the corridor test for one feature's breakpoint parts.
 *
 * FLAT END CAPS: the first leg of each part rejects projections before its
 * start (t < 0) and the last leg rejects projections past its end (t > 1),
 * so the corridor is capped at the perpendicular through the first and last
 * breakpoint instead of bleeding a half-disc of extra coast past the ends.
 * Interior joints clamp normally — the neighbouring leg covers them.
 *
 * @returns {{ inBand: (lonLat) => boolean, toXY: (lonLat) => [x, y],
 *             bbox: {w, e, s, n} } | null}
 */
function corridor(parts, halfWidthKm) {
  let latSum = 0;
  let n = 0;
  for (const part of parts) for (const p of part) { latSum += p[1]; n++; }
  if (n < 2) return null;

  const cosLat = Math.cos((latSum / n) * toRad);
  const kmLon = KM_PER_DEG_LAT * cosLat;
  const toXY = (p) => [p[0] * kmLon, p[1] * KM_PER_DEG_LAT];

  /* Legs as km-space segments, each knowing whether it is an end leg. */
  const legs = [];
  const bbox = { w: Infinity, e: -Infinity, s: Infinity, n: -Infinity };
  for (const part of parts) {
    if (part.length < 2) continue;
    for (let i = 0; i < part.length - 1; i++) {
      legs.push({
        a: toXY(part[i]),
        b: toXY(part[i + 1]),
        first: i === 0,
        last: i === part.length - 2,
      });
    }
    for (const p of part) {
      if (p[0] < bbox.w) bbox.w = p[0];
      if (p[0] > bbox.e) bbox.e = p[0];
      if (p[1] < bbox.s) bbox.s = p[1];
      if (p[1] > bbox.n) bbox.n = p[1];
    }
  }
  if (!legs.length) return null;

  /* Degree-space prefilter box, expanded by the half-width. Most coast
   * vertices on screen are nowhere near the warning; this rejects them with
   * four comparisons before any leg math runs. */
  const padLat = halfWidthKm / KM_PER_DEG_LAT;
  const padLon = halfWidthKm / kmLon;
  bbox.w -= padLon; bbox.e += padLon; bbox.s -= padLat; bbox.n += padLat;

  const W2 = halfWidthKm * halfWidthKm;

  /* -------------------------------------------------------------------------
   * THE LEG GRID
   *
   * ==> WITHOUT THIS, EVERY COAST VERTEX IS TESTED AGAINST EVERY LEG. <==
   * Ida's main hurricane warning is 18 legs over 531 km, and at delta density
   * that is well over a million segment projections per select — measured at
   * 43 ms per 150k vertices on a desktop, which is three to four times that on
   * a phone, on the critical path between a pinch ending and the stripe
   * repainting.
   *
   * Legs are bucketed into square cells of the corridor's own half-width, each
   * leg registered in every cell its W-padded box touches. A point can then
   * only be within W of a leg in its own cell, so the test walks one or two
   * legs instead of eighteen. MEASURED 2.2-2.7x faster with byte-identical
   * output — the hit count was compared, because a faster select that paints
   * differently is worse than a slow one.
   * ---------------------------------------------------------------------- */
  const cell = halfWidthKm;
  let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
  for (const leg of legs) {
    gx0 = Math.min(gx0, leg.a[0], leg.b[0]);
    gx1 = Math.max(gx1, leg.a[0], leg.b[0]);
    gy0 = Math.min(gy0, leg.a[1], leg.b[1]);
    gy1 = Math.max(gy1, leg.a[1], leg.b[1]);
  }
  gx0 -= halfWidthKm; gy0 -= halfWidthKm;
  gx1 += halfWidthKm; gy1 += halfWidthKm;

  const cols = Math.max(1, Math.ceil((gx1 - gx0) / cell));
  const rows = Math.max(1, Math.ceil((gy1 - gy0) / cell));
  const buckets = new Array(cols * rows);
  for (const leg of legs) {
    const c0 = Math.max(0, Math.floor((Math.min(leg.a[0], leg.b[0]) - halfWidthKm - gx0) / cell));
    const c1 = Math.min(cols - 1, Math.floor((Math.max(leg.a[0], leg.b[0]) + halfWidthKm - gx0) / cell));
    const r0 = Math.max(0, Math.floor((Math.min(leg.a[1], leg.b[1]) - halfWidthKm - gy0) / cell));
    const r1 = Math.min(rows - 1, Math.floor((Math.max(leg.a[1], leg.b[1]) + halfWidthKm - gy0) / cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c;
        (buckets[i] || (buckets[i] = [])).push(leg);
      }
    }
  }

  /** Is this point within W of `leg`, respecting that leg's flat caps? */
  function reaches(leg, px, py) {
    const abx = leg.b[0] - leg.a[0];
    const aby = leg.b[1] - leg.a[1];
    const apx = px - leg.a[0];
    const apy = py - leg.a[1];
    const len2 = abx * abx + aby * aby;
    let t = len2 ? (apx * abx + apy * aby) / len2 : 0;
    if (leg.first && t < 0) return false; /* flat cap: before the start */
    if (leg.last && t > 1) return false;  /* flat cap: past the end */
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = apx - t * abx;
    const dy = apy - t * aby;
    return dx * dx + dy * dy <= W2;
  }

  function inBand(p) {
    if (p[0] < bbox.w || p[0] > bbox.e || p[1] < bbox.s || p[1] > bbox.n) {
      return false;
    }
    const px = p[0] * kmLon;
    const py = p[1] * KM_PER_DEG_LAT;
    const c = Math.floor((px - gx0) / cell);
    const r = Math.floor((py - gy0) / cell);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
    const near = buckets[r * cols + c];
    if (!near) return false;
    for (let i = 0; i < near.length; i++) {
      if (reaches(near[i], px, py)) return true;
    }
    return false;
  }

  return { inBand, toXY, bbox };
}

/* ---------------------------------------------------------------------------
 * TILE-BOUNDARY FILTER
 *
 * On OpenMapTiles the coast is the edge of the OCEAN POLYGON, and a
 * tile-clipped polygon's ring is part real shoreline and part straight tile
 * boundary. Those artificial edges are detectable: they run EXACTLY constant
 * in longitude or latitude (tile edges are meridians and parallels in web
 * mercator) for longer than real quantized coastline plausibly does. A
 * dropped real segment costs an invisible gap in a thick stripe; a kept tile
 * edge paints a straight blue seam across the map. Err toward dropping.
 * ------------------------------------------------------------------------- */

function isTileEdge(a, b, kmLon) {
  const eps = COAST_BAND.tileEdgeEpsDeg;
  const axisAligned =
    Math.abs(a[0] - b[0]) <= eps || Math.abs(a[1] - b[1]) <= eps;
  if (!axisAligned) return false;
  const dx = (b[0] - a[0]) * kmLon;
  const dy = (b[1] - a[1]) * KM_PER_DEG_LAT;
  return dx * dx + dy * dy >= COAST_BAND.tileEdgeMinKm ** 2;
}

/* ---------------------------------------------------------------------------
 * SELECTION
 * ------------------------------------------------------------------------- */

/**
 * Coast runs inside the corridor. A run is a maximal chain of consecutive
 * ring vertices that are all in the band, broken wherever a segment is a
 * tile-boundary edge. Two-point minimum — a single vertex paints nothing.
 *
 * ==> WHOLE RINGS ARE REJECTED BEFORE ANY VERTEX IS TOUCHED. <== The decode
 * hands back every ring from every loaded tile, and at a basin zoom that is
 * the Atlantic and the Yucatán along with the coast we care about. A ring
 * whose own extent misses the corridor's cannot contribute a single vertex,
 * and four comparisons settles it instead of several thousand.
 */
function selectRuns(rings, band) {
  const kmLon = band.toXY([1, 0])[0]; /* km per degree of longitude here */
  const { w, e, s, n } = band.bbox;
  const runs = [];

  for (const ring of rings) {
    let rw = Infinity;
    let re = -Infinity;
    let rs = Infinity;
    let rn = -Infinity;
    for (const v of ring) {
      if (v[0] < rw) rw = v[0];
      if (v[0] > re) re = v[0];
      if (v[1] < rs) rs = v[1];
      if (v[1] > rn) rn = v[1];
    }
    if (re < w || rw > e || rn < s || rs > n) continue;

    let run = null;
    let prev = null;
    let prevIn = false;

    for (const v of ring) {
      const vIn = band.inBand(v);
      if (vIn && prevIn && !isTileEdge(prev, v, kmLon)) {
        if (!run) run = [prev];
        run.push(v);
      } else if (run) {
        runs.push(run);
        run = null;
      }
      prev = v;
      prevIn = vIn;
    }
    if (run) runs.push(run);
  }

  return runs;
}

/* ---------------------------------------------------------------------------
 * THE ENTRY POINT
 * ------------------------------------------------------------------------- */

/**
 * Paint watch/warning features onto the coast by band select.
 *
 * @param {Array} features  watch/warning GeoJSON features (NHC breakpoints)
 * @param {Array} rings     coastline rings from map/coast-source.js
 * `halfWidthKm` defaults to the watch/warning corridor. Surge passes its own,
 * narrower one — a warning covers an AREA so over-inclusion is right, while
 * adjacent surge reaches carry DIFFERENT DEPTHS and a wide corridor would
 * paint the deeper forecast onto its shallower neighbour's coast.
 *
 * @returns {{features: Array, paintedCount: number, total: number}}
 *   Painted features carry `_banded: true` and a MultiLineString of coast
 *   runs. A feature with no coast in its corridor keeps NHC's delivered
 *   geometry, flagged `_banded: false` with `_bandReason` — the §5
 *   `unavailable` state, never "no warning here".
 */
export function bandSelect(features, rings, halfWidthKm = COAST_BAND.halfWidthKm) {
  const list = features || [];

  const fallback = (f, reason) => ({
    ...f,
    properties: { ...f.properties, _banded: false, _bandReason: reason },
  });

  /* No substrate at all: every feature keeps its chords, flagged. */
  if (!rings?.length) {
    return {
      features: list.map((f) => fallback(f, 'no-coastline')),
      paintedCount: 0,
      total: list.length,
    };
  }

  let paintedCount = 0;
  const out = list.map((f) => {
    const parts = lineParts(f.geometry);
    if (!parts.length) return fallback(f, 'not-a-line');

    const band = corridor(parts, halfWidthKm);
    if (!band) return fallback(f, 'degenerate');

    const runs = selectRuns(rings, band);
    if (!runs.length) return fallback(f, 'no-coast-in-band');

    paintedCount++;
    return {
      ...f,
      geometry: { type: 'MultiLineString', coordinates: runs },
      properties: { ...f.properties, _banded: true, _bandRuns: runs.length },
    };
  });

  return { features: out, paintedCount, total: list.length };
}
