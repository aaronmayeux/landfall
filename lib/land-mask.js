/**
 * land-mask.js — IS THIS POINT ON LAND?
 *
 * ==> WHY THIS EXISTS. <== The volcano layer draws a translucent sea sheet over
 * every seamount, three times wider than the seamount itself
 * (`VOLCANO.map3d.water.spread`). Near a coast that sheet runs straight across
 * whatever land MapLibre has painted underneath, because a custom layer draws
 * over the basemap unconditionally and the sheet has no idea where the shore
 * is. Reported on glass 2026-07-31: water on top of landmass.
 *
 * ==> THE LAND SHAPES COME FROM THE BASEMAP ITSELF, NOT FROM A SHIPPED ASSET.
 * <== `map/coast-source.js` pulls coastline rings out of the tiles MapLibre
 * currently has loaded, which means the mask is cut against the EXACT polygons
 * being painted underneath. A shipped low-resolution coastline would line up
 * with the painted shore only by luck, and would be visibly wrong at the zooms
 * this layer draws at (z7 and up). It also costs no bytes.
 *
 * ==> THE PRICE, STATED ONCE: THIS IS TILE STATE, SO IT CHANGES AS YOU PAN.
 * <== `coastGeneration(map)` is the cheap identity that says whether it moved.
 * A caller holding a built mask compares generations and rebuilds when they
 * differ — per pan-settle, never per frame.
 *
 * ==> AND `null` IS A REAL ANSWER. <== When no tile has answered yet we do not
 * know where land is. That is `unavailable`, and it is NOT "no land here"
 * (SPEC.md §5). `createLandMask` returns null rather than an empty mask that
 * would quietly report the whole planet as ocean.
 *
 * No THREE, no DOM, no MapLibre — plain numbers in, plain numbers out, so
 * `tools/test-land-mask.mjs` asserts all of it without a browser.
 */

import { LAND_MASK } from '../config/constants.js';

/**
 * Signed longitude difference b − a, wrapped to (−180, 180].
 *
 * ==> THE ANTIMERIDIAN IS NOT AN EDGE CASE HERE, IT IS TUESDAY. <== The
 * volcanoes this mask serves are Aleutian, Kuril, Kamchatkan and Fijian. A
 * plain subtraction puts a crossing 359° "east" of a query point that is
 * actually 1° west of it, and the ray cast counts it — which flips land and
 * sea for a whole island.
 */
export function lonDelta(a, b) {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/**
 * Build a point-in-land test from coastline rings.
 *
 * @param {Array<Array<[number,number]>>} rings closed rings in [lon, lat]
 * @returns {{landAt: function(number, number): boolean,
 *            segments: number, rings: number,
 *            minLat: number, maxLat: number}|null}
 *   `null` when there is nothing to build from — see the header.
 */
export function createLandMask(rings) {
  if (!Array.isArray(rings) || rings.length === 0) return null;

  /* ---- flatten to segments, unwrapped -----------------------------------
   *
   * ==> EACH SEGMENT'S SECOND LONGITUDE IS STORED RELATIVE TO ITS FIRST. <==
   * A ring that crosses 180° arrives as `179.9 -> -179.9`, which as raw
   * numbers is a segment running most of the way around the planet westward.
   * Unwrapped it is a 0.2° step east, which is what it actually is. Every
   * crossing test below then interpolates along a segment that is short in
   * both coordinates, and the only wrap-aware comparison left is the single
   * `lonDelta` against the query point. */
  const lat1 = [];
  const lat2 = [];
  const lon1 = [];
  const lon2 = [];

  let minLat = Infinity;
  let maxLat = -Infinity;
  let ringCount = 0;

  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    ringCount++;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (!a || !b) continue;
      const aLat = a[1];
      const bLat = b[1];
      /* A horizontal segment can never be crossed by a horizontal ray, and
       * keeping it would only add a degenerate divide below. */
      if (aLat === bLat) continue;

      lat1.push(aLat);
      lat2.push(bLat);
      lon1.push(a[0]);
      lon2.push(a[0] + lonDelta(a[0], b[0]));

      if (aLat < minLat) minLat = aLat;
      if (aLat > maxLat) maxLat = aLat;
      if (bLat < minLat) minLat = bLat;
      if (bLat > maxLat) maxLat = bLat;

      if (lat1.length >= LAND_MASK.maxSegments) break;
    }
    if (lat1.length >= LAND_MASK.maxSegments) break;
  }

  const n = lat1.length;
  if (n === 0) return null;

  /* ---- index by latitude row --------------------------------------------
   *
   * ==> A RAY CAST IS ONLY EXPENSIVE IF IT LOOKS AT EVERY SEGMENT. <== The
   * ray runs east along one line of latitude, so the only segments that can
   * possibly cross it are the ones whose own latitude span contains it. Rows
   * make that lookup a subscript instead of a scan. Measured shape at z8: a
   * few thousand segments over a screenful, so a row holds a handful.
   *
   * The grid is built over the rings' OWN latitude range rather than over
   * −90..90, because tiles cover a screen and not a planet — a fixed world
   * grid would put every segment in three rows out of 256. */
  const span = maxLat - minLat;
  const rows = Math.max(1, Math.min(LAND_MASK.indexRows, n));
  /* A zero span means every segment sits on one line of latitude, which the
   * horizontal-segment skip above has already made impossible — but a single
   * row is still the correct answer for a degenerate input rather than a
   * divide by zero. */
  const rowSpan = span > 0 ? span / rows : 1;

  const buckets = new Array(rows);
  for (let i = 0; i < rows; i++) buckets[i] = [];

  const rowOf = (lat) => {
    const r = Math.floor((lat - minLat) / rowSpan);
    return r < 0 ? 0 : r >= rows ? rows - 1 : r;
  };

  for (let s = 0; s < n; s++) {
    const lo = rowOf(Math.min(lat1[s], lat2[s]));
    const hi = rowOf(Math.max(lat1[s], lat2[s]));
    for (let r = lo; r <= hi; r++) buckets[r].push(s);
  }

  /**
   * Even-odd ray cast, eastward.
   *
   * ==> THE HALF-OPEN LATITUDE TEST IS WHAT STOPS A SHARED VERTEX BEING
   * COUNTED TWICE. <== `(lat1 > y) !== (lat2 > y)` treats a segment as
   * covering its lower endpoint and not its upper one, so a ray passing
   * exactly through the join between two segments crosses exactly once. The
   * naive `>=` on both sides counts it twice and reports the inside of an
   * island as ocean along one line of latitude — a one-pixel stripe, which is
   * the kind of thing that gets blamed on the renderer for a week.
   */
  function landAt(lon, lat) {
    if (lat < minLat || lat > maxLat) return false;
    const bucket = buckets[rowOf(lat)];
    let crossings = 0;
    for (let k = 0; k < bucket.length; k++) {
      const s = bucket[k];
      const y1 = lat1[s];
      const y2 = lat2[s];
      if (y1 > lat === y2 > lat) continue;
      const t = (lat - y1) / (y2 - y1);
      const xlon = lon1[s] + t * (lon2[s] - lon1[s]);
      if (lonDelta(lon, xlon) > 0) crossings++;
    }
    return (crossings & 1) === 1;
  }

  return { landAt, segments: n, rings: ringCount, minLat, maxLat };
}
