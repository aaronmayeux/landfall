/**
 * interior-point.js — a point that is guaranteed to be INSIDE its own polygon.
 * SPEC §56.5.
 *
 * ==> THIS EXISTS BECAUSE THE CHEAP ANSWER IS WRONG ONE TIME IN FIVE, AND IT
 * IS WRONG ON EXACTLY THE SHAPES THIS FEATURE DRAWS. <== §56.2 measured the
 * bounding-box centre of every flood polygon in one national capture: five of
 * twenty-five fell OUTSIDE their own polygon, and every one of the five was a
 * river corridor — a long bent shape whose bbox centre sits in the bend, on
 * dry land, in a different county. A hazard icon in the wrong county is not a
 * cosmetic miss; it is this app telling somebody the water is somewhere it is
 * not. Re-measured here on the frozen 2026-08-22 national snapshot plus the two
 * archived zone boundaries — 35 shapes — the bbox centre falls outside its own
 * polygon **6 times**.
 *
 * ==> THE AREA-WEIGHTED CENTROID IS NOT THE ANSWER EITHER, AND THE REASON IS
 * NOT THAT IT WAS MEASURED TO FAIL. <== It was measured, on those same 35
 * shapes, and it landed inside all 35. What it does not have is a GUARANTEE: a
 * crescent or a ring-shaped county puts a centroid in the hole by construction,
 * and none of those happened to be in one quiet day's capture. This file's
 * guarantee is enforced by a containment test on the way out (see the last
 * lines of `interiorPoint`) rather than hoped for, which is the difference that
 * matters on a hazard surface.
 *
 * ==> IT IS NEEDED FOR CLUSTERING AND FOR NOTHING ELSE. <== §56.2 also
 * measured that a symbol layer riding a POLYGON source already places one icon
 * per polygon and places it inside — MapLibre computes this itself for its own
 * labels. But MapLibre clusters `Point` geometry only, so the icons cannot ride
 * the polygon source, and the moment a point has to be built by hand it has to
 * be built correctly.
 *
 * THE ALGORITHM is the pole of inaccessibility — the interior point furthest
 * from any edge — by the grid-subdivision search MapLibre uses internally for
 * its own polygon labels. A queue of square cells, always take the most
 * promising, stop subdividing when a cell cannot beat the best answer by more
 * than `precision`. No dependency, no build step.
 *
 * ==> IT WORKS IN DEGREES, TREATED AS A PLANE, AND THAT IS SOUND FOR THE ONE
 * THING IT PROMISES. <== A degree of longitude is shorter than a degree of
 * latitude everywhere but the equator, so at 45°N the search runs over a
 * horizontally stretched copy of the county. That moves the answer slightly
 * off the true visual centre. It CANNOT move the answer outside the polygon:
 * inside-ness is topological and survives the stretch, and nothing is ever
 * returned that did not pass the containment test. The guarantee this file
 * makes is "inside", not "perfectly centred", and the test asserts the one it
 * makes.
 *
 * ==> AND IT DOES NOT CROSS THE ANTIMERIDIAN, BECAUSE NOTHING IT IS GIVEN
 * DOES. <== Every shape reaching here is an NWS product: a forecaster-drawn
 * warning polygon or a US forecast zone. A ring spanning the seam would make
 * the bounding box the whole world and the search would return the middle of
 * the Atlantic — so `interiorPoint` refuses a ring wider than half the globe
 * rather than answering wrongly. If NWS ever publishes an Aleutian zone that
 * wraps, that refusal is the signal to unwrap here, not a silent bad icon.
 *
 * Pure. No imports, no DOM, no config — a geometry function and its two
 * predicates.
 */

/* ==> THE SEARCH IS BOUNDED BY WORK, NOT ONLY BY PRECISION. <== A ring with
 * thousands of vertices around a coastline — which is exactly what an NWS
 * forecast zone is (§56.4 measured 23 of them at 1.63 MB) — can keep the queue
 * growing while every cell still looks promising. This ceiling makes the cost
 * predictable on the frame a reader is looking at. Hitting it returns the best
 * point found SO FAR, which has already passed the containment test, so a
 * truncated search degrades to a slightly less centred point and never to a
 * wrong one. */
const MAX_CELLS = 4000;

/** The default stopping distance, in degrees. Roughly 100 m at the equator —
 *  far finer than any polygon this draws needs, and the cell ceiling above is
 *  what actually stops the search on a big shape. */
const PRECISION_DEG = 0.001;

/** Widest a ring may span before this file refuses it. Half the globe: past
 *  that the ring is either crossing the seam or is corrupt, and both deserve
 *  no icon rather than a confident one in the wrong ocean. */
const MAX_SPAN_DEG = 180;

/* ---------------------------------------------------------------------------
 * THE TWO PREDICATES
 *
 * Exported because the TEST needs them, and because a containment test is the
 * thing a caller most often wants next. They are the whole correctness
 * argument of this file: `signedDistance` is positive inside and negative
 * outside, and nothing here ever returns a point whose signed distance is not
 * positive.
 * ------------------------------------------------------------------------- */

/**
 * Is (x, y) inside this set of rings?
 *
 * Ray casting, counting crossings of a horizontal ray. Holes fall out for
 * free: a point inside a hole crosses the outer ring once and the hole ring
 * once, which is even, which is outside. That is why every ring of the polygon
 * is fed in together rather than the outer ring alone.
 *
 * @param {number} x longitude
 * @param {number} y latitude
 * @param {Array<Array<number[]>>} rings outer ring first, then holes.
 */
export function pointInRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      /* `(yi > y) !== (yj > y)` is the half-open rule: an edge counts when it
       * spans the ray, and a vertex sitting exactly on the ray counts for one
       * of its two edges rather than both. Without it a ray grazing a vertex
       * is counted twice and the answer flips. */
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Squared distance from (x, y) to the segment (ax,ay)-(bx,by). Squared, so
 *  the hot loop never calls `Math.sqrt` — the caller takes the root once. */
function segDistSq(x, y, ax, ay, bx, by) {
  let px = ax;
  let py = ay;
  const dx = bx - ax;
  const dy = by - ay;

  if (dx !== 0 || dy !== 0) {
    const t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      px = bx;
      py = by;
    } else if (t > 0) {
      px += dx * t;
      py += dy * t;
    }
  }
  return (x - px) ** 2 + (y - py) ** 2;
}

/**
 * Distance from (x, y) to the nearest ring edge, POSITIVE INSIDE and NEGATIVE
 * OUTSIDE. Degrees.
 *
 * The sign is the entire point. The search below maximises this number, so a
 * cell out at sea scores negatively and loses to any cell on land without
 * needing a separate containment pass.
 */
export function signedDistance(x, y, rings) {
  let minSq = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const d = segDistSq(x, y, ring[i][0], ring[i][1], ring[j][0], ring[j][1]);
      if (d < minSq) minSq = d;
    }
  }
  if (!Number.isFinite(minSq)) return -Infinity;
  return (pointInRings(x, y, rings) ? 1 : -1) * Math.sqrt(minSq);
}

/* ---------------------------------------------------------------------------
 * THE SEARCH
 * ------------------------------------------------------------------------- */

/** One square of the search. `d` is its centre's signed distance; `max` is the
 *  best score any point inside it could possibly have — the centre's distance
 *  plus the half-diagonal. `max` is what the queue is ordered by, and it is why
 *  a whole cell can be discarded rather than subdivided. */
function makeCell(x, y, h, rings) {
  const d = signedDistance(x, y, rings);
  return { x, y, h, d, max: d + h * Math.SQRT2 };
}

/**
 * A binary max-heap on `max`.
 *
 * ==> A PLAIN ARRAY WITH A LINEAR SCAN WOULD ALSO WORK AND IS NOT WHAT SHIPPED.
 * <== The queue reaches hundreds of cells on a coastline zone, and a linear
 * scan per pop is quadratic on exactly the shape that is already the most
 * expensive. Twenty lines buys a predictable cost on the frame a reader is
 * looking at, which is the overriding lens.
 */
function heapPush(heap, cell) {
  heap.push(cell);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].max >= heap[i].max) break;
    const swap = heap[parent];
    heap[parent] = heap[i];
    heap[i] = swap;
    i = parent;
  }
}

function heapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let big = i;
      if (l < heap.length && heap[l].max > heap[big].max) big = l;
      if (r < heap.length && heap[r].max > heap[big].max) big = r;
      if (big === i) break;
      const swap = heap[big];
      heap[big] = heap[i];
      heap[i] = swap;
      i = big;
    }
  }
  return top;
}

/**
 * Every ring of a Polygon, or of the LARGEST-AREA member of a MultiPolygon.
 *
 * ==> THE LARGEST MEMBER, NOT ALL OF THEM, AND THE REASON IS NOT THE ONE THIS
 * COMMENT FIRST GAVE. <== The guess was that flattening an archipelago into one
 * ring set would land the point in the sea BETWEEN the islands. Measured on
 * HIZ023 — a real captured zone — it does something quieter and worse.
 *
 * That zone has three members: one genuine island of 1,959 vertices, and two
 * SLIVERS of six and five vertices with effectively zero area, which NWS ships
 * and nothing here can wish away. Flattened, the search settles inside one of
 * the slivers: about 0.001° — roughly a hundred metres — off the island the
 * alert is actually about. It passes a naive "is it inside any member" check
 * and puts the chip on a speck offshore.
 *
 * So the member is chosen by AREA first and the containment test then runs
 * against that member alone. One chip on the biggest island is the honest
 * answer to "where is this alert", and it is the answer MapLibre's own polygon
 * labelling gives. `tools/test-interior-point.mjs` holds the measurement.
 *
 * Area is the shoelace absolute value of each member's OUTER ring. Holes are
 * not subtracted: they cannot change which member is biggest by enough to
 * matter, and an island with a lake in it is still that island.
 */
export function largestRingSet(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Polygon') {
    return Array.isArray(geometry.coordinates) && geometry.coordinates.length
      ? geometry.coordinates
      : null;
  }
  if (geometry.type !== 'MultiPolygon' || !Array.isArray(geometry.coordinates)) return null;

  let best = null;
  let bestArea = -1;
  for (const poly of geometry.coordinates) {
    const outer = poly && poly[0];
    if (!Array.isArray(outer) || outer.length < 4) continue;
    let a = 0;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      a += (outer[j][0] + outer[i][0]) * (outer[j][1] - outer[i][1]);
    }
    a = Math.abs(a / 2);
    if (a > bestArea) {
      bestArea = a;
      best = poly;
    }
  }
  return best;
}

/**
 * A point inside this polygon, as far from its edges as the search can get.
 *
 * @param {{type:string, coordinates:Array}|null} geometry Polygon or MultiPolygon.
 * @param {number} [precision] stopping distance in degrees.
 * @returns {{lon:number, lat:number}|null} `null` when the geometry is missing,
 *   is not a polygon type, spans the seam, or is too degenerate to contain
 *   anything.
 *
 * ==> NULL IS A REAL ANSWER AND CALLERS MUST NOT DEFAULT IT. <== §5. An alert
 * whose shape produced no interior point has no icon, and the honest thing is
 * for it to be COUNTED and said — exactly as `unplaceable` counts a watch
 * whose boundaries never came back. Substituting the bbox centre here to avoid
 * a null would put back the one-in-five error this file exists to delete.
 */
export function interiorPoint(geometry, precision = PRECISION_DEG) {
  const rings = largestRingSet(geometry);
  if (!rings || !rings.length) return null;

  const outer = rings[0];
  if (!Array.isArray(outer) || outer.length < 4) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outer) {
    const x = p && p[0];
    const y = p && p[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const width = maxX - minX;
  const height = maxY - minY;
  if (width > MAX_SPAN_DEG || height > MAX_SPAN_DEG) return null;

  const cellSize = Math.min(width, height);
  if (!(cellSize > 0)) return null;

  let h = cellSize / 2;

  const heap = [];
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      heapPush(heap, makeCell(x + h, y + h, h, rings));
    }
  }

  /* THE SEED IS THE BBOX CENTRE, AND THAT IS SAFE HERE FOR THE ONE REASON IT
   * IS NOT SAFE AS AN ANSWER. It is only ever a candidate: it survives as best
   * solely if it outscores every cell the search reaches, and its score is
   * NEGATIVE whenever it is outside — which is precisely the one-in-five case.
   * So the shape that breaks the bbox centre is the shape where the search
   * overtakes it on the very first subdivision. */
  let best = makeCell(minX + width / 2, minY + height / 2, 0, rings);

  let visited = 0;
  while (heap.length && visited < MAX_CELLS) {
    const cell = heapPop(heap);
    visited++;

    if (cell.d > best.d) best = cell;

    /* Nothing inside this cell can beat what we already hold by enough to
     * care. Discard it whole rather than subdividing — this is the line that
     * keeps the search from being an exhaustive grid. */
    if (cell.max - best.d <= precision) continue;

    h = cell.h / 2;
    heapPush(heap, makeCell(cell.x - h, cell.y - h, h, rings));
    heapPush(heap, makeCell(cell.x + h, cell.y - h, h, rings));
    heapPush(heap, makeCell(cell.x - h, cell.y + h, h, rings));
    heapPush(heap, makeCell(cell.x + h, cell.y + h, h, rings));
  }

  /* ==> THE GUARANTEE, ENFORCED RATHER THAN ASSUMED. <== Everything above is
   * an optimisation over this one test. A sliver so thin that no cell centre
   * ever landed inside it arrives here with a negative best, and the right
   * answer for it is NO ICON — not an icon beside the county. */
  if (!(best.d > 0)) return null;
  return { lon: best.x, lat: best.y };
}
