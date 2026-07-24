/**
 * bandmerge.js — merge stacked per-timestep band polygons into ONE smooth
 * outline per threshold.
 *
 * WHY A SECOND MERGER, next to lib/windswath.js. Both solve the same visible
 * problem — "don't stack translucent polygons whose fills compound" — but
 * they start from different inputs and cannot share a code path:
 *
 *   NHC  publishes quadrant RADII (four numbers per time). windswath.js
 *        sweeps a corridor from those numbers. It never sees a polygon.
 *   GDACS publishes finished POLYGONS (confirmed on glass 2026-07-24 —
 *        quadrant-shaped, NOT the symmetric circles the spec claimed). There
 *        are no radii to sweep, so the merge has to be a union of shapes.
 *
 * What IS shared, and deliberately reused rather than reinvented, is the
 * finishing technique windswath.js paid for in on-glass iterations:
 * uniform resample, then iterated 3-point averaging. Those stages are pure
 * ring geometry and care nothing about where the ring came from — they live
 * in lib/ringpolish.js and both files call them.
 *
 * THE UNION, and why it is a raster pass and not a polygon-clipping library:
 * a robust boolean union of concave, self-touching polygons is a genuinely
 * hard algorithm (Vatti/Greiner-Hormann and their degenerate cases) and
 * pulling in a clipping library breaks the no-build-step rule. What we need
 * is far weaker than exact clipping: a smooth outline of "everywhere this
 * threshold reaches," at app zoom, on a phone. So the shapes are stamped
 * into a coarse occupancy grid, the outer boundary is traced, and the trace
 * is then resampled and smoothed by the NHC polish. Grid resolution is a
 * stated constant, the trace is O(cells), and the result is a single ring
 * with no interior seams — which is exactly the look the stacked version
 * failed to produce.
 *
 * DIRECTION OF ERROR IS OUTWARD, and that is stated rather than hidden. A
 * cell is filled if ANY band polygon covers its centre, so the traced
 * boundary can sit up to one cell outside the true union. At the default
 * resolution that is small against a band a hundred nautical miles wide, and
 * it errs toward claiming slightly MORE area than published. That is the
 * opposite of windswath.js's inward-only guarantee, so it is recorded here
 * as the accepted trade: for GDACS the alternative is drawing nothing (the
 * source publishes no radii to sweep inward from), and a slightly generous
 * smooth outline beats both a compounding stack and a blank map (§5).
 *
 * DISCONNECTED RESULTS WERE A BUG, NOT A FEATURE — and this file argued the
 * opposite one commit ago. The claim was that a band merging into seven
 * separate rings was "honest", because bridging them would draw wind the
 * source never published. That was wrong, and glass showed it: the green
 * band read as beads on a wire rather than a swath. The error in the
 * reasoning was treating discrete fixes as the full claim, when they are
 * SAMPLES of a continuous process. A storm does not teleport between fixes,
 * and the app already interpolates between NHC's 6-hourly fixes for exactly
 * that reason. Consecutive shapes are now bridged (see bridgeQuad), bounded
 * so the corridor never reaches past published extent.
 *
 * Genuinely separate contours are still returned and drawn — a band that
 * dies out and reappears is a real gap, not a sampling artifact.
 *
 * WHY BRIDGING LIVES HERE AND NOT IN THE SHARED POLISH. Aaron asked for it
 * in the shared engine, in case NHC ever publishes fewer, more spaced-out
 * points. It was tested rather than assumed: `lib/windswath.js` fed only
 * FOUR fixes 24 h apart with a tight 64 kt core still returns ONE continuous
 * corridor. It cannot bead, by construction — it never stamps discrete
 * shapes, it resamples the track and walks a continuous left wall and right
 * wall along it. Sparser NHC fixes would give a slightly coarser curve, not
 * beads. Beading is a failure mode of stamp-and-trace specifically, which is
 * the GDACS path only, so the fix belongs here. The genuinely shared part —
 * resample then average — is already extracted to `lib/ringpolish.js`.
 *
 * Pure functions. Imports: config/ and lib/ only. No DOM, ever.
 */

import { BAND_MERGE } from '../config/constants.js';
import { resampleClosedRing, smoothClosedRing } from './ringpolish.js';

/** Bounding box over many GeoJSON polygons, in degrees. */
function bounds(polygons) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const rings of polygons) {
    for (const ring of rings) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/**
 * Stamp one polygon into the grid by SCANLINE, not by per-cell testing.
 *
 * The naive version tests every cell in the polygon's bounding box against
 * every ring vertex: O(cells × vertices), which measured ~54M operations for
 * one realistic storm and ~350 ms per storm across three thresholds. That
 * cost lands in the warm-prefetch path, which runs for every storm as the
 * feed arrives — synchronous JS blocking the main thread while the user is
 * touching the map. Jank, and avoidable.
 *
 * Scanline is the standard fix and it is O(cells + vertices): for each grid
 * row, intersect the row's y against every edge once, sort the crossings,
 * and fill between pairs. Same even-odd rule as the point test, same result,
 * one pass over the edges per row instead of one per cell.
 */
function stampPolygon(grid, rings, w, h, minX, minY, cell) {
  if (!rings.length) return;

  /* Row range this polygon can touch. */
  let pMinY = Infinity, pMaxY = -Infinity;
  for (const ring of rings) {
    for (const [, y] of ring) {
      if (y < pMinY) pMinY = y;
      if (y > pMaxY) pMaxY = y;
    }
  }
  const gy0 = Math.max(0, Math.floor((pMinY - minY) / cell));
  const gy1 = Math.min(h - 1, Math.ceil((pMaxY - minY) / cell));

  const xs = [];
  for (let gy = gy0; gy <= gy1; gy++) {
    const y = minY + gy * cell;
    xs.length = 0;

    /* Crossings against EVERY ring — outer and holes together. Even-odd
     * then handles holes for free: a cell inside a hole is crossed an even
     * number of times and stays empty. */
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y)) {
          xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);

    for (let k = 0; k + 1 < xs.length; k += 2) {
      const gxA = Math.max(0, Math.ceil((xs[k] - minX) / cell));
      const gxB = Math.min(w - 1, Math.floor((xs[k + 1] - minX) / cell));
      const row = gy * w;
      for (let gx = gxA; gx <= gxB; gx++) grid[row + gx] = 1;
    }
  }
}

/**
 * Area-weighted centroid of a polygon's outer ring, with a vertex-average
 * fallback for degenerate rings. Used to order shapes along the track and to
 * decide which side of the corridor a vertex sits on.
 */
function centroid(rings) {
  const ring = rings[0];
  if (!ring || ring.length < 3) return null;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    a += cross;
    cx += (ring[i][0] + ring[i + 1][0]) * cross;
    cy += (ring[i][1] + ring[i + 1][1]) * cross;
  }
  if (Math.abs(a) < 1e-12) {
    let sx = 0, sy = 0;
    for (const [x, y] of ring) { sx += x; sy += y; }
    return [sx / ring.length, sy / ring.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/**
 * Bridge the gap between two consecutive band shapes.
 *
 * THE PROBLEM THIS SOLVES, seen on glass 2026-07-24: GDACS publishes fixes
 * ~12 h apart, so a band narrower than the distance travelled between them
 * merges into a string of disconnected blobs — beads on a wire. The storm
 * did not teleport between those fixes; the wind field swept the ground
 * between them, and drawing beads understates the threat.
 *
 * I PREVIOUSLY ARGUED THE OPPOSITE and was wrong. The claim was that
 * bridging "claims wind the source never published". But the app already
 * does exactly this interpolation for NHC: `lib/windswath.js` resamples
 * between 6-hourly fixes at 10 nm and sweeps a corridor, and the spec calls
 * that legitimate precisely because the interpolated values stay bounded by
 * the published endpoints. Discrete fixes are samples of a continuous
 * process, for both sources. The beads were the artifact; the corridor is
 * the honest reading.
 *
 * THE CONSTRUCTION — a quadrilateral per side, from the widest extent of
 * each shape perpendicular to travel:
 *   1. Take the travel direction between the two centroids.
 *   2. On each shape, find the vertex furthest to the LEFT of that direction
 *      and the vertex furthest to the RIGHT. That is "the largest radius on
 *      each side of the forecast path" — Aaron's instruction, and it is the
 *      same quantity the NHC sweep gets analytically from quadrant radii.
 *   3. Fill the quadrilateral joining shape A's left/right extremes to shape
 *      B's left/right extremes.
 *
 * WHY THIS CANNOT OVERSTATE, which matters because these are safety colors:
 * every corner of the bridge is a REAL VERTEX of a published polygon. The
 * quadrilateral is their convex hull, so no point of the bridge lies further
 * from the track than the wider of the two shapes at its own end. The bridge
 * fills between published extents; it never reaches past them. Same
 * inward-only guarantee the NHC sweep gives, arrived at from shapes instead
 * of radii.
 */
function bridgeQuad(ringsA, ringsB) {
  const ca = centroid(ringsA);
  const cb = centroid(ringsB);
  if (!ca || !cb) return null;

  const dx = cb[0] - ca[0];
  const dy = cb[1] - ca[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null; // same place: nothing to bridge

  /* Unit normal to travel. Signed distance along it is "how far left". */
  const nx = -dy / len;
  const ny = dx / len;

  const extremes = (rings, c) => {
    let left = null, right = null, lMax = -Infinity, rMax = -Infinity;
    for (const [x, y] of rings[0]) {
      const d = (x - c[0]) * nx + (y - c[1]) * ny;
      if (d > lMax) { lMax = d; left = [x, y]; }
      if (-d > rMax) { rMax = -d; right = [x, y]; }
    }
    return { left, right };
  };

  const a = extremes(ringsA, ca);
  const b = extremes(ringsB, cb);
  if (!a.left || !a.right || !b.left || !b.right) return null;

  /* Wound consistently so the scanline fill sees a simple quad. */
  return [[a.left, b.left, b.right, a.right, a.left]];
}
/**
 * Trace the outer boundary of a filled grid with marching squares.
 *
 * Returns the boundary as grid-space points in order. Every contour is
 * returned, not just the largest: after bridging, a threshold normally
 * traces as one corridor, but a genuinely separate blob (a second system, or
 * a band that reappears after dying out) is a real feature and gets drawn.
 */
function marchingSquares(grid, w, h) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : grid[y * w + x]);

  /* Find every boundary cell, then walk contours from unvisited ones. */
  const seen = new Uint8Array(w * h);
  const contours = [];

  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      if (!at(sx, sy) || seen[sy * w + sx]) continue;
      /* Only start on a boundary cell (has an empty 4-neighbour). */
      if (at(sx - 1, sy) && at(sx + 1, sy) && at(sx, sy - 1) && at(sx, sy + 1)) continue;

      /* Moore-neighbourhood boundary walk. */
      const contour = [];
      const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
      let cx = sx, cy = sy, dir = 0;
      const startX = sx, startY = sy;
      let guard = 0;
      const guardMax = w * h * 8;

      do {
        contour.push([cx, cy]);
        seen[cy * w + cx] = 1;
        let moved = false;
        /* Turn left, then scan clockwise for the next filled neighbour. */
        for (let k = 0; k < 8; k++) {
          const nd = (dir + 6 + k) % 8;
          const nx = cx + DIRS[nd][0];
          const ny = cy + DIRS[nd][1];
          if (at(nx, ny)) {
            cx = nx; cy = ny; dir = nd; moved = true;
            break;
          }
        }
        if (!moved) break; // isolated cell
      } while (++guard < guardMax && !(cx === startX && cy === startY));

      if (contour.length >= BAND_MERGE.minContourCells) contours.push(contour);
    }
  }

  return contours;
}

/**
 * Merge one threshold's stacked polygons into smooth outline ring(s).
 *
 * @param {Array<Array<Array<[number,number]>>>} polygons — each an array of
 *        rings (outer first), in lon/lat degrees.
 * @returns {Array<Array<[number,number]>>} closed rings in lon/lat, largest
 *          first. Empty when there is nothing to merge.
 */
export function mergeBandPolygons(polygons) {
  if (!polygons?.length) return [];

  const bb = bounds(polygons);
  if (!bb) return [];

  /* Grid sized from the constant, with a one-cell margin so a shape touching
   * the bounding box still has an empty ring of cells to trace against. */
  const cell = BAND_MERGE.cellDeg;
  const pad = cell * 2;
  const minX = bb.minX - pad;
  const minY = bb.minY - pad;
  const w = Math.ceil((bb.maxX - bb.minX + pad * 2) / cell) + 1;
  const h = Math.ceil((bb.maxY - bb.minY + pad * 2) / cell) + 1;

  /* GUARD THE BUDGET. A pathological span (a storm crossing many degrees, or
   * bad data with an outlier vertex) must not allocate an enormous grid on a
   * phone. Past the cap we bail and the caller keeps the unmerged stack —
   * uglier, but correct and bounded (§9: jank is worse than a coarse look). */
  if (w * h > BAND_MERGE.maxCells || w < 3 || h < 3) return [];

  const grid = new Uint8Array(w * h);
  for (const rings of polygons) {
    stampPolygon(grid, rings, w, h, minX, minY, cell);
  }

  /* BRIDGE THE GAPS. Stamped alone, shapes narrower than the distance
   * between fixes leave beads on a wire (seen on glass 2026-07-24). The
   * storm swept the ground between its fixes, so the corridor between
   * consecutive shapes is filled — see bridgeQuad for why this cannot
   * overstate extent.
   *
   * ORDER MATTERS: `polygons` arrives in whatever order the source listed
   * them, and bridging shape 1 to shape 5 would cut a chord across the
   * track's curve. They are sorted along the track first, by projecting
   * each centroid onto the dominant axis of travel — robust for the
   * roughly-monotonic tracks these bands follow, and a storm that genuinely
   * doubles back simply gets a slightly generous corridor at the turn. */
  if (BAND_MERGE.bridgeGaps && polygons.length > 1) {
    const withCentroids = polygons
      .map((rings) => ({ rings, c: centroid(rings) }))
      .filter((p) => p.c);

    if (withCentroids.length > 1) {
      const first = withCentroids[0].c;
      const lastP = withCentroids[withCentroids.length - 1].c;
      const ax = lastP[0] - first[0];
      const ay = lastP[1] - first[1];
      const alen = Math.hypot(ax, ay) || 1;
      const ux = ax / alen;
      const uy = ay / alen;
      withCentroids.sort((p, q) => (p.c[0] * ux + p.c[1] * uy) - (q.c[0] * ux + q.c[1] * uy));

      for (let i = 0; i + 1 < withCentroids.length; i++) {
        const quad = bridgeQuad(withCentroids[i].rings, withCentroids[i + 1].rings);
        if (quad) stampPolygon(grid, quad, w, h, minX, minY, cell);
      }
    }
  }

  const contours = marchingSquares(grid, w, h);
  if (!contours.length) return [];

  /* Grid space → lon/lat, then the NHC finishing technique: uniform
   * resample so the averaging is a clean low-pass, then iterated 3-point
   * averaging. This is the step Aaron asked for by name — the same pass
   * that took the NHC swath from a corner at every fix to a smooth wall. */
  const rings = contours
    .map((c) => c.map(([gx, gy]) => [minX + gx * cell, minY + gy * cell]))
    .map((r) => smoothClosedRing(resampleClosedRing(r, cell * BAND_MERGE.resampleCells), BAND_MERGE.smoothPasses))
    .filter((r) => r.length >= BAND_MERGE.minRingPoints);

  /* Largest first — area, shoelace. The caller draws them all; ordering just
   * makes the primary blob predictable for anything that samples ring 0. */
  const area = (r) => {
    let a = 0;
    for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
    return Math.abs(a / 2);
  };
  return rings.sort((a, b) => area(b) - area(a));
}
