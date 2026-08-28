/**
 * land-raster.mjs — turn coastline rings into a land mask. RUNNER ONLY.
 * SPEC-SEASONS-BUILD.md §57.7a.
 *
 * ==> THIS FILE MUST NEVER REACH A BROWSER, AND THAT IS THE WHOLE REASON IT IS
 * A SEPARATE FILE. <== It was the first half of `lib/landfall.js` until
 * 2026-08-28, when Aaron chose to ship a prebuilt mask so the phone could
 * answer the running season (§57.7b). Every import in this project ships to
 * every visitor, so leaving the rasteriser beside the walk would have put a
 * scanline fill, 480,000 coastline edges and a 119 MB allocation on the boot
 * path of a phone that needs none of them — it needs the ANSWER, which is the
 * mask, and the mask is built here once a month on a runner.
 *
 * It lives in `tools/` rather than `lib/` for exactly that reason: `lib/` is
 * shipped code and `tools/` is not, so the seam is visible in the path.
 *
 * The walk — `landfallsFor`, `cameAshore` — stayed in `lib/landfall.js`,
 * because that half genuinely does run on both sides and must give the same
 * answer in both. One method, one answer.
 */

import { SEASONS } from '../config/constants.js';

/* ---------------------------------------------------------------------------
 * THE LAND MASK
 * ------------------------------------------------------------------------- */

/**
 * Rasterise coastline rings into a land mask.
 *
 * ==> EVEN-ODD SCANLINE FILL, SO A HOLE IS A HOLE WITHOUT ANY RING-NESTING
 * LOGIC. <== Filling between alternating crossings on each raster row handles
 * an inner ring correctly and never needs to know which way a ring winds,
 * which is the class of bug `map/coast-source.js` records having to reason
 * about elsewhere.
 *
 * ==> AND THE SOURCE TURNS OUT TO CARRY ALMOST NO HOLES, WHICH IS FINE HERE
 * FOR A REASON WORTH WRITING DOWN. <== Measured on the shipped Natural Earth
 * land polygons: 6,837 outer rings and exactly ONE inner ring. So an enclosed
 * lake reads as LAND — Superior, Okeechobee, Victoria all do — while every
 * water body connected to the sea reads as water, which is the part that
 * matters: Pamlico Sound, Chesapeake Bay, Lake Pontchartrain and the Laguna
 * Madre are all correctly water, and those are exactly the ragged places
 * landfalls actually happen.
 *
 * An enclosed lake reading as land cannot produce a false landfall, because a
 * storm cannot reach one without crossing the real coast first — by the time
 * it is over Okeechobee the landfall has already fired. If a source with real
 * lake holes is ever swapped in, the fill above already handles it.
 *
 * ==> ONE BYTE PER CELL RATHER THAN ONE BIT, DELIBERATELY. <== A bitfield is
 * eight times smaller and cannot be filled with `TypedArray.fill`, which is
 * what makes the row fill fast. This runs on a runner with gigabytes free, so
 * 119 MB is the cheap side of the trade. If this ever has to reach a browser
 * that decision flips, and it is the only thing in this file that would need
 * to change.
 *
 * @param {Array<Array<[number,number]>>} rings  closed [lon, lat] loops
 * @param {object} [opts]
 * @returns {{isLand:(lon:number,lat:number)=>boolean, width:number,
 *   height:number, step:number, latMin:number, latMax:number, cells:number}}
 */
export function buildLandMask(rings, {
  step = SEASONS.landfallMaskStep,
  latMin = SEASONS.landfallMaskLatMin,
  latMax = SEASONS.landfallMaskLatMax,
} = {}) {
  const width = Math.round(360 / step);
  const height = Math.round((latMax - latMin) / step);
  const mask = new Uint8Array(width * height);

  /* Bucket every edge by the raster rows it spans, so each row's fill looks at
   * the handful of edges that can possibly cross it rather than at all of
   * them. Without this the fill is O(rows x edges) — 6,600 x 480,000. */
  const rowEdges = Array.from({ length: height }, () => []);
  for (const ring of rings || []) {
    for (let i = 1; i < ring.length; i++) {
      const [x0, y0] = ring[i - 1];
      const [x1, y1] = ring[i];
      /* A horizontal edge crosses no scanline and would make the crossing
       * count odd where it touched one. Dropped rather than special-cased. */
      if (y0 === y1) continue;
      let lo = Math.ceil((Math.min(y0, y1) - latMin) / step - 0.5);
      let hi = Math.floor((Math.max(y0, y1) - latMin) / step - 0.5);
      if (hi < 0 || lo >= height) continue;
      if (lo < 0) lo = 0;
      if (hi >= height) hi = height - 1;
      for (let row = lo; row <= hi; row++) rowEdges[row].push(x0, y0, x1, y1);
    }
  }

  const xs = [];
  for (let row = 0; row < height; row++) {
    const y = latMin + (row + 0.5) * step;
    const edges = rowEdges[row];
    xs.length = 0;
    for (let k = 0; k < edges.length; k += 4) {
      const x0 = edges[k], y0 = edges[k + 1], x1 = edges[k + 2], y1 = edges[k + 3];
      /* The half-open rule: an edge counts when the scanline is above one end
       * and not the other, which keeps a vertex shared by two edges from being
       * counted twice and flipping the parity for the rest of the row.
       *
       * ==> IT IS BELT AND BRACES HERE, NOT LOAD-BEARING, AND SAYING SO IS
       * HONEST. <== The row bucketing above already hands this loop only the
       * edges that span the row, so this test almost never fires.
       * `tools/test-landfall.mjs` tried to mutation-check it on 2026-08-27 —
       * boxes, lakes and a spike with its apex sitting exactly on a scanline —
       * and could not construct a shape where removing it changes an answer.
       * It stays because the day the bucketing is rewritten it becomes the
       * only thing standing between a shared vertex and an inside-out
       * continent, but no test covers it and none pretends to. */
      if ((y0 > y) === (y1 > y)) continue;
      xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    }
    if (!xs.length) continue;
    xs.sort((a, b) => a - b);
    const base = row * width;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let c0 = Math.round((xs[k] + 180) / step);
      let c1 = Math.round((xs[k + 1] + 180) / step);
      if (c1 < 0 || c0 >= width) continue;
      if (c0 < 0) c0 = 0;
      if (c1 >= width) c1 = width - 1;
      mask.fill(1, base + c0, base + c1 + 1);
    }
  }

  const isLand = (lon, lat) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    if (lat < latMin || lat >= latMax) return false;
    /* Longitudes arrive UNWRAPPED — `lib/hurdat.js` carries `lonU` so a track
     * crossing the date line stays one continuous line rather than jumping
     * 360°. The mask is indexed on real longitude, so the wrap happens here
     * and only here.
     *
     * ==> IT IS ARITHMETIC RATHER THAN A LOOP, AND MUTATION TESTING IS WHY.
     * <== This was `while (x < -180) x += 360` on 2026-08-27 and a longitude
     * needing TWO turns came out at -530, which produced a NEGATIVE column and
     * read a cell from the previous row — a wrong answer with no error, on a
     * lookup that runs two million times per archive. The double modulo below
     * is total for any input in one step and cannot produce an index outside
     * the row. The bounds check after it is belt and braces and it stays. */
    const x = (((lon + 180) % 360) + 360) % 360;
    const col = Math.floor(x / step);
    const row = Math.floor((lat - latMin) / step);
    if (col < 0 || col >= width || row < 0 || row >= height) return false;
    return mask[row * width + col] === 1;
  };

  return { isLand, width, height, step, latMin, latMax, cells: mask.length };
}
