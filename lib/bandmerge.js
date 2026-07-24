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
 * DISCONNECTED RESULTS ARE CORRECT, NOT A BUG. A tight threshold on a
 * fast-moving storm can leave gaps between consecutive timesteps — measured:
 * a 120 km/h core about 1° wide, on fixes ~1.4° apart, merges to SEVEN
 * separate rings rather than one corridor. That is what the source
 * published. Bridging them would draw hurricane-force wind across water
 * GDACS never claimed it reached, which is the §5 lie in its most dangerous
 * form (inventing severity, not omitting it). Every contour is returned and
 * every one is drawn.
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
 * Trace the outer boundary of a filled grid with marching squares.
 *
 * Returns the boundary as grid-space points in order. Only the LARGEST
 * contour is kept: GDACS bands along one track overlap heavily and produce a
 * single blob, but a storm whose early and late positions do not overlap can
 * produce two, and drawing the smaller as a separate feature is handled by
 * the caller rather than silently dropped.
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
