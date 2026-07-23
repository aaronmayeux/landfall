/**
 * coast-trace.js — watch/warning segments re-cut against the drawn coastline.
 *
 * THE PROBLEM (SPEC §7, now measured rather than predicted). NHC publishes
 * watch/warnings as BREAKPOINTS — named coastal reference points — joined by
 * straight lines. Probed live on Bertha 2026-07-23: 11 vertices over 464 km,
 * median spacing 51 km. Drawn as delivered, a warning covering a bay renders
 * as a chord slicing across open water.
 *
 * THE FIX. Snap each breakpoint to the nearest vertex of the DRAWN coast,
 * then walk the coastline between consecutive breakpoints. A traced segment
 * IS coastline, so it follows every bay and inlet and can never peel off the
 * shoreline — it is made of the same vertices the coast is drawn from.
 *
 * WHAT MAKES THIS HONEST (§5, §7):
 *   - Tracing is best-effort and always reversible. Any segment that cannot
 *     be traced confidently keeps NHC's delivered geometry and is FLAGGED
 *     `_traced: false`. Official geometry isn't ours to curve.
 *   - Every rejection is a measured threshold in COAST_TRACE, not a vibe:
 *     too few coast vertices, a breakpoint too far offshore to snap, a walk
 *     that ran too long, a path suspiciously longer than the chord.
 *   - A segment is traced or it is not — never a silent blend of real
 *     coastline and chord, which would look authoritative while being half
 *     invented.
 *
 * WINDING IS NEVER ASSUMED. Between two points on a closed ring there are
 * always two paths. We walk BOTH and keep the shorter — which is why this
 * works identically on OpenMapTiles (ocean polygon edge) and Protomaps (land
 * polygon edge) even though they may wind opposite ways. No flag, no sign
 * flip when TILES.useR2 goes true.
 *
 * THIS FILE IS SCHEMA-BLIND. It receives rings of [lon, lat] from
 * map/coast-source.js and never learns where they came from.
 *
 * Imports: config/ only. Pure — no map, no DOM, no fetch.
 */

import { COAST_TRACE } from '../config/constants.js';

const R_KM = 6371;
const toRad = Math.PI / 180;

/* ---------------------------------------------------------------------------
 * DISTANCE
 *
 * Two measures on purpose. Real distance where a threshold is expressed in
 * km and must mean km. A cheap planar proxy for nearest-neighbour scanning,
 * where only ORDERING matters and haversine's trig would be paid millions of
 * times — the cos(lat) term keeps longitude honest away from the equator.
 * ------------------------------------------------------------------------- */

function haversineKm(a, b) {
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const la1 = a[1] * toRad;
  const la2 = b[1] * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Squared planar distance with longitude scaled by cos(lat). Ordering only. */
function approxSq(a, b, cosLat) {
  const dx = (a[0] - b[0]) * cosLat;
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function pathLengthKm(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += haversineKm(pts[i - 1], pts[i]);
  return total;
}

/* ---------------------------------------------------------------------------
 * STITCHING
 *
 * Vector tiles clip geometry at tile boundaries, so one continuous shoreline
 * arrives as many disjoint pieces whose endpoints coincide. Walking those
 * un-stitched means the trace dead-ends at every tile edge.
 *
 * Greedy endpoint joining: take a piece, repeatedly attach whichever unused
 * piece starts (or, reversed, ends) within stitchToleranceKm of the current
 * tail. Greedy is right here because coastline pieces meet at genuinely
 * shared endpoints — this is reassembling a cut line, not solving a routing
 * problem. Tolerance is tuned to tile slack, well below island separation, so
 * distinct islands cannot weld together.
 * ------------------------------------------------------------------------- */

function stitchRings(rings) {
  const tol = COAST_TRACE.stitchToleranceKm;
  const used = new Array(rings.length).fill(false);
  const out = [];

  for (let i = 0; i < rings.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let path = rings[i].slice();

    /* GROW FROM BOTH ENDS. Tiles arrive in arbitrary order, so the piece
     * that continues this run may join either the tail OR the head — and a
     * tail-only stitcher silently leaves the run split, which downstream
     * reads as two landmasses and refuses to trace between them. That was a
     * real bug: shuffled tile pieces produced `split-landmass` on a
     * coastline that was in fact continuous. */
    let extended = true;
    while (extended) {
      extended = false;
      const head = path[0];
      const tail = path[path.length - 1];

      for (let j = 0; j < rings.length; j++) {
        if (used[j]) continue;
        const cand = rings[j];
        const cHead = cand[0];
        const cTail = cand[cand.length - 1];

        /* Four ways two pieces can meet. Each appends the candidate in
         * whichever orientation makes one continuous run. */
        if (haversineKm(tail, cHead) <= tol) {
          path = path.concat(cand.slice(1));
        } else if (haversineKm(tail, cTail) <= tol) {
          path = path.concat(cand.slice().reverse().slice(1));
        } else if (haversineKm(head, cTail) <= tol) {
          path = cand.slice(0, -1).concat(path);
        } else if (haversineKm(head, cHead) <= tol) {
          path = cand.slice().reverse().slice(0, -1).concat(path);
        } else {
          continue;
        }

        used[j] = true;
        extended = true;
        break;
      }
    }

    out.push(path);
  }

  return out;
}

/** Is this path effectively closed? Decides whether the walk may wrap around
 *  the end — on an open path it must not, or it teleports across the gap. */
function isClosed(path) {
  return (
    path.length > 2 &&
    haversineKm(path[0], path[path.length - 1]) <= COAST_TRACE.stitchToleranceKm
  );
}

/* ---------------------------------------------------------------------------
 * SNAPPING
 * ------------------------------------------------------------------------- */

/**
 * Nearest coast vertex to a point, across all stitched paths.
 * @returns {{path: number, index: number, km: number} | null}
 */
function nearestVertex(point, paths) {
  const cosLat = Math.cos(point[1] * toRad);
  let best = null;
  let bestSq = Infinity;

  for (let p = 0; p < paths.length; p++) {
    const path = paths[p];
    for (let i = 0; i < path.length; i++) {
      const d = approxSq(point, path[i], cosLat);
      if (d < bestSq) {
        bestSq = d;
        best = { path: p, index: i };
      }
    }
  }

  if (!best) return null;
  /* Confirm the winner with a real distance — the proxy ranked it, but the
   * threshold is in kilometres and must be measured in kilometres. */
  return { ...best, km: haversineKm(point, paths[best.path][best.index]) };
}

/* ---------------------------------------------------------------------------
 * WALKING
 * ------------------------------------------------------------------------- */

/**
 * Coastline vertices from index `a` to index `b` along one path.
 *
 * Tries both directions and returns the SHORTER. On a closed path the reverse
 * direction wraps through the seam; on an open path it does not — wrapping an
 * open path would jump the gap between two unconnected ends, drawing a line
 * straight through open water.
 *
 * @returns {Array | null} null when a direction exceeds maxWalkVertices — a
 *   runaway walk is a frame-budget hazard on a phone.
 */
function walkBetween(path, a, b) {
  const n = path.length;
  const closed = isClosed(path);
  const cap = COAST_TRACE.maxWalkVertices;

  const forward = [];
  {
    let i = a;
    let guard = 0;
    while (guard++ <= cap) {
      forward.push(path[i]);
      if (i === b) break;
      i++;
      if (i >= n) {
        if (!closed) { forward.length = 0; break; }
        i = 0;
      }
    }
    if (guard > cap) forward.length = 0;
  }

  const backward = [];
  {
    let i = a;
    let guard = 0;
    while (guard++ <= cap) {
      backward.push(path[i]);
      if (i === b) break;
      i--;
      if (i < 0) {
        if (!closed) { backward.length = 0; break; }
        i = n - 1;
      }
    }
    if (guard > cap) backward.length = 0;
  }

  const fOk = forward.length > 1;
  const bOk = backward.length > 1;
  if (!fOk && !bOk) return null;
  if (!fOk) return backward;
  if (!bOk) return forward;

  /* THE DIRECTION DECISION. Shorter in real distance, not fewer vertices —
   * vertex density varies wildly along a coastline, so counting vertices
   * would happily choose the long way round a smooth coast over the short
   * way through a detailed bay. */
  return pathLengthKm(forward) <= pathLengthKm(backward) ? forward : backward;
}

/* ---------------------------------------------------------------------------
 * TRACING ONE SEGMENT
 * ------------------------------------------------------------------------- */

/** Positions of a LineString / MultiLineString feature, flattened. */
function linePositions(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return geometry.coordinates;
  if (geometry.type === 'MultiLineString') return geometry.coordinates.flat();
  return [];
}

/**
 * Re-cut one segment against the coast.
 * @returns {{coords: Array, traced: boolean, reason: string|null}}
 */
function traceOne(positions, paths) {
  if (positions.length < 2) {
    return { coords: positions, traced: false, reason: 'degenerate' };
  }

  const out = [];

  for (let i = 0; i < positions.length - 1; i++) {
    const from = positions[i];
    const to = positions[i + 1];

    const a = nearestVertex(from, paths);
    const b = nearestVertex(to, paths);

    /* Any leg we cannot trust fails the WHOLE segment back to NHC's
     * geometry. Per-leg fallback would produce a line that is half surveyed
     * coastline and half invented chord, reading as equally authoritative
     * along its length. Traced or not traced — nothing in between. */
    if (!a || !b) return { coords: positions, traced: false, reason: 'no-coast' };
    if (a.km > COAST_TRACE.snapMaxKm || b.km > COAST_TRACE.snapMaxKm) {
      return { coords: positions, traced: false, reason: 'snap-too-far' };
    }
    if (a.path !== b.path) {
      return { coords: positions, traced: false, reason: 'split-landmass' };
    }

    const walk = walkBetween(paths[a.path], a.index, b.index);
    if (!walk) return { coords: positions, traced: false, reason: 'walk-overflow' };

    /* A trace far longer than the chord means the walk went the wrong way
     * around the landmass, or stitching welded something it should not
     * have. Reject rather than draw a 4000 km "warning". */
    const chordKm = haversineKm(from, to);
    if (chordKm > 0 && pathLengthKm(walk) > chordKm * COAST_TRACE.maxTraceRatio) {
      return { coords: positions, traced: false, reason: 'implausible-length' };
    }

    /* Drop the duplicate join vertex between consecutive legs. */
    out.push(...(out.length ? walk.slice(1) : walk));
  }

  if (out.length < 2) return { coords: positions, traced: false, reason: 'empty-trace' };
  return { coords: out, traced: true, reason: null };
}

/* ---------------------------------------------------------------------------
 * THE ENTRY POINT
 * ------------------------------------------------------------------------- */

function flag(f, traced, reason) {
  return {
    ...f,
    properties: {
      ...f.properties,
      _traced: traced,
      ...(traced ? {} : { _traceReason: reason }),
    },
  };
}

/**
 * Trace watch/warning segments against coastline rings.
 *
 * @param {Array} features  watch/warning GeoJSON features
 * @param {Array} rings     coastline rings from map/coast-source.js
 * @returns {{features: Array, traced: boolean, tracedCount: number, total: number}}
 *   Each returned feature carries `_traced`, plus `_traceReason` when false.
 *   `traced` is true only when EVERY segment traced.
 */
export function traceSegments(features, rings) {
  const list = features || [];

  /* No substrate: return the delivered geometry, flagged. This is the §7
   * fallback and the honest state whenever the basemap has not loaded
   * enough coast to trace against. */
  if (!rings?.length) {
    return {
      features: list.map((f) => flag(f, false, 'no-coastline')),
      traced: false,
      tracedCount: 0,
      total: list.length,
    };
  }

  const paths = stitchRings(rings);
  let tracedCount = 0;

  const out = list.map((f) => {
    const positions = linePositions(f.geometry);
    if (positions.length < 2) return flag(f, false, 'not-a-line');

    const { coords, traced, reason } = traceOne(positions, paths);
    if (traced) tracedCount++;

    return {
      ...f,
      geometry: { type: 'LineString', coordinates: coords },
      properties: {
        ...f.properties,
        _traced: traced,
        ...(traced ? {} : { _traceReason: reason }),
      },
    };
  });

  return {
    features: out,
    traced: tracedCount === list.length && list.length > 0,
    tracedCount,
    total: list.length,
  };
}
