/**
 * population-count.js — HOW MANY PEOPLE ARE INSIDE THIS SHAPE.
 *
 * Pure. No fetch, no DOM, no map. Given the flat town array (see
 * tools/build-population.mjs) and some GeoJSON polygons, return a headcount.
 *
 * ==> THE ANSWER IS ALWAYS AN UNDERCOUNT, AND EVERY CALLER MUST SAY SO. <==
 * The town list is everyone living in a named place of 1,000 or more people.
 * Farms, hamlets, and open country hold nobody as far as this function is
 * concerned, and that is a large number of real people — rural Louisiana and
 * the Bay of Bengal deltas are exactly where the gap is widest and exactly
 * where a hurricane app must not overstate its confidence. The world total of
 * the shipped file is about 3.04 billion against a real population near 8.1
 * billion. Render it with a "≈" and the word estimate. Never as a census.
 *
 * WHY NOT A DENSITY GRID. A real 1 km population raster would answer this
 * properly, and it would also be a texture upload on a device where texture
 * upload is already the measured cold-load problem. This is the cheap honest
 * answer; the expensive accurate one is a separate decision, not a TODO.
 *
 * --- SPEED --------------------------------------------------------------
 *
 * 107,464 towns against a wind swath that may carry a few hundred rings.
 * Done naively that is tens of millions of ray casts on the main thread
 * during a tap, which is the exact class of work that shows up as a long
 * task on the Windows sessions telemetry keeps flagging.
 *
 * So there are two gates before any real work happens:
 *
 *   1. ONE BOUNDING BOX for the whole feature set, tested per town. A storm
 *      covers a few percent of the planet, so this rejects ~99% of the list
 *      with four number comparisons and no allocation.
 *   2. A PER-RING BOUNDING BOX, tested per surviving town, before that ring's
 *      ray cast runs.
 *
 * Only what survives both is ray cast. Measured shape of the work: a Gulf
 * hurricane's 34 kt swath leaves a few thousand towns past gate 1 and a few
 * hundred past gate 2.
 *
 * --- ANTIMERIDIAN -------------------------------------------------------
 *
 * ==> A WEST PACIFIC TYPHOON CROSSES 180° AND A NAIVE BOX SILENTLY MATCHES
 * THE WHOLE PLANET. <== A ring spanning the dateline has vertices near +179
 * and near -179, so its longitude box becomes [-179, +179] — nearly global —
 * and gate 1 stops rejecting anything. The count would still be arithmetically
 * correct, because the ray casts run and the ray casts are right; it would
 * just take the slow path across every town on Earth on the one basin where
 * that hurts most.
 *
 * Handled by SHIFTING, not by splitting: a ring wider than 180° is treated as
 * living in an unwrapped world where longitudes run past ±180, and towns are
 * shifted by ±360 to match before testing. Splitting rings would be the other
 * approach and it rewrites the geometry, which is how a shape picks up seams
 * it never had.
 */

/** A ring whose longitude span exceeds this is assumed to be wrapped rather
 *  than genuinely hemispheric. No real storm shape is 180° wide; a wrapped
 *  one measures as ~358°. */
const WRAP_SPAN_DEG = 180;

/**
 * Ray-cast point-in-ring. Standard even-odd crossing test.
 *
 * `ring` is a flat GeoJSON linear ring: an array of [lon, lat] pairs whose
 * last point repeats the first. Holes are handled by the caller flipping
 * membership, not here — this answers one ring at a time.
 */
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    /* The `!==` guard matters: a horizontal edge at exactly the test latitude
     * divides by zero, and a town sitting on one is a real occurrence at
     * 2-decimal-place coordinates. */
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Bounding box of one ring, plus whether it looks wrapped. */
function ringBox(ring) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, maxLon, minLat, maxLat, wrapped: maxLon - minLon > WRAP_SPAN_DEG };
}

/**
 * Rewrite a wrapped ring into a continuous one past +180, and report the
 * shifted box. A ring straddling the dateline has its western vertices
 * (negative longitudes) pushed up by 360 so the whole shape is contiguous;
 * towns get the same treatment at test time.
 */
function unwrapRing(ring) {
  const out = ring.map(([lon, lat]) => [lon < 0 ? lon + 360 : lon, lat]);
  return { ring: out, box: ringBox(out) };
}

/**
 * Collect every polygon ring out of a GeoJSON feature list, pre-boxed.
 *
 * Rings are kept FLAT with their winding role attached rather than nested per
 * polygon, because a wind swath's holes are rare and the flat form keeps the
 * inner loop free of a second level of indexing. Outer rings add, inner rings
 * (holes) subtract.
 */
function collectRings(features) {
  const rings = [];
  for (const f of features || []) {
    const g = f?.geometry;
    if (!g) continue;
    const polys =
      g.type === 'Polygon' ? [g.coordinates]
        : g.type === 'MultiPolygon' ? g.coordinates
          : null;
    if (!polys) continue;
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i += 1) {
        const raw = poly[i];
        if (!Array.isArray(raw) || raw.length < 4) continue;
        const box0 = ringBox(raw);
        const { ring, box } = box0.wrapped ? unwrapRing(raw) : { ring: raw, box: box0 };
        rings.push({ ring, box, hole: i > 0, wrapped: box0.wrapped });
      }
    }
  }
  return rings;
}

/**
 * A feature set turned into the form the town loop wants: its rings, and the
 * gate-1 box over all of them.
 *
 * Gate 1 is built in BOTH frames — the plain one and the unwrapped one —
 * because a storm set can in principle hold a wrapped ring and an ordinary one
 * at the same time (two typhoons, one either side of the dateline). Testing a
 * town against both is two extra comparisons and removes a whole class of
 * "why is this basin slow".
 */
function prepare(features) {
  const rings = collectRings(features);

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLonW = Infinity;
  let maxLonW = -Infinity;
  let anyWrapped = false;

  for (const r of rings) {
    if (r.box.minLat < minLat) minLat = r.box.minLat;
    if (r.box.maxLat > maxLat) maxLat = r.box.maxLat;
    if (r.wrapped) {
      anyWrapped = true;
      if (r.box.minLon < minLonW) minLonW = r.box.minLon;
      if (r.box.maxLon > maxLonW) maxLonW = r.box.maxLon;
    } else {
      if (r.box.minLon < minLon) minLon = r.box.minLon;
      if (r.box.maxLon > maxLon) maxLon = r.box.maxLon;
    }
  }

  return { rings, minLat, maxLat, minLon, maxLon, minLonW, maxLonW, anyWrapped };
}

/**
 * Is this one town inside this one prepared shape?
 *
 * `lonW` is the caller's precomputed unwrapped longitude — the same town seen
 * from the unwrapped frame. A town at -170 is at +190 to a ring that crossed
 * the dateline going east. It is passed in rather than recomputed because with
 * two shapes it would otherwise be computed twice per town for no reason.
 */
function insideShape(p, lon, lat, lonW) {
  if (!p.rings.length) return false;
  if (lat < p.minLat || lat > p.maxLat) return false;

  const plain = lon >= p.minLon && lon <= p.maxLon;
  const wrapped = p.anyWrapped && lonW >= p.minLonW && lonW <= p.maxLonW;
  if (!plain && !wrapped) return false;

  /* Gate 2 and the ray cast, per ring. Outer-ring hits and hole hits are
   * counted separately: a town in a hole is inside an outer ring and must come
   * back out. Holes in a wind swath are vanishingly rare but a swath is a union
   * of many circles and MapLibre does publish the odd one. */
  let outer = 0;
  let holes = 0;
  for (const r of p.rings) {
    const b = r.box;
    if (lat < b.minLat || lat > b.maxLat) continue;
    const x = r.wrapped ? lonW : lon;
    if (x < b.minLon || x > b.maxLon) continue;
    if (!inRing(x, lat, r.ring)) continue;
    if (r.hole) holes += 1; else outer += 1;
  }
  return outer > holes;
}

/**
 * How many people live inside these features.
 *
 * @param {number[]|null} towns Flat [lon, lat, pop, …]. Null or empty is not
 *        an error here — it is the caller's `unavailable`, and this returns
 *        null so the two cannot be confused with a real zero.
 * @param {object[]} features GeoJSON features. Non-polygons are ignored.
 * @returns {{people:number, towns:number}|null} null when there is nothing to
 *        count WITH; `{people: 0, towns: 0}` when there is genuinely nobody
 *        inside the shape, which is a real and correct answer over open ocean.
 */
export function peopleInFeatures(towns, features) {
  if (!towns || towns.length < 3) return null;

  const shape = prepare(features);
  if (!shape.rings.length) return { people: 0, towns: 0 };

  let people = 0;
  let hit = 0;

  for (let i = 0; i < towns.length; i += 3) {
    const lon = towns[i];
    const lat = towns[i + 1];
    const lonW = lon < 0 ? lon + 360 : lon;
    if (insideShape(shape, lon, lat, lonW)) {
      people += towns[i + 2];
      hit += 1;
    }
  }

  return { people, towns: hit };
}

/**
 * Split the headcount into what is STILL COMING and what has ALREADY HAPPENED.
 *
 * ==> WHY THIS EXISTS. <== NHC's full-track envelope is one merged shape
 * covering where the storm has been, where it is, and where it is forecast to
 * go, with nothing inside it marking where the past ends (`lib/windswath.js`).
 * Counted whole and captioned "in the path", it says a million people are in
 * danger from wind that fell on them days ago. Measured on Hurricane Lala,
 * advisory 34A, 2026-08-21: 1,337,723 people in 121 towns, every one of them in
 * Hawaii, and every one of them behind the storm. Nobody at all was ahead of it.
 *
 * ==> AND WHY IT IS ONE PASS OVER TWO SHAPES RATHER THAN TWO COUNTS AND A
 * SUBTRACTION. <== `past = total - ahead` looks equivalent and is not. It is
 * only true if the ahead shape is a strict subset of the full one, and it is
 * not: both are built by the same sweep, but the smoothing runs over the whole
 * run, so the two boundaries differ by a nautical mile or two near the forecast
 * end. A town sitting in that sliver would be counted in `ahead` and not in
 * `total`, and the subtraction would hand back a NEGATIVE number of people. So
 * each town is classified once, against both shapes, and the three buckets are
 * summed directly. They cannot disagree with each other.
 *
 * @param {number[]|null} towns Flat [lon, lat, pop, …], as above.
 * @param {object[]} allFeatures The full envelope — past, present and forecast.
 * @param {object[]} aheadFeatures The forward-only envelope — present and
 *        forecast. Must be built from the same source as `allFeatures`.
 * @returns {{total:{people:number,towns:number},
 *            ahead:{people:number,towns:number},
 *            past:{people:number,towns:number}}|null}
 *        `ahead` is everyone inside the forward shape. `past` is everyone
 *        inside the full shape but NOT the forward one — already been through
 *        it. `total` is everyone inside either, so `ahead + past === total`
 *        by construction. null when there is nothing to count with.
 */
export function peopleInPhases(towns, allFeatures, aheadFeatures) {
  if (!towns || towns.length < 3) return null;

  const all = prepare(allFeatures);
  const ahead = prepare(aheadFeatures);
  const zero = () => ({ people: 0, towns: 0 });
  if (!all.rings.length && !ahead.rings.length) {
    return { total: zero(), ahead: zero(), past: zero() };
  }

  const out = { total: zero(), ahead: zero(), past: zero() };

  for (let i = 0; i < towns.length; i += 3) {
    const lon = towns[i];
    const lat = towns[i + 1];
    const pop = towns[i + 2];
    const lonW = lon < 0 ? lon + 360 : lon;

    const inAhead = insideShape(ahead, lon, lat, lonW);
    /* The full shape is only tested when the forward one missed. A town that
     * is ahead is ahead whatever the full envelope says about it, and skipping
     * the second ray cast for those is most of the cost of the second shape. */
    const bucket = inAhead ? out.ahead
      : insideShape(all, lon, lat, lonW) ? out.past
        : null;
    if (!bucket) continue;

    bucket.people += pop;
    bucket.towns += 1;
    out.total.people += pop;
    out.total.towns += 1;
  }

  return out;
}

/**
 * Round a headcount to something a person can read and that does not claim
 * precision the data cannot support.
 *
 * ==> THE ROUNDING IS PART OF THE HONESTY, NOT COSMETICS. <== "4,183,662
 * people" reads as a measurement. It is a sum over a town list with a known
 * floor and no rural coverage at all, so the third significant figure is
 * fiction and the seventh is an insult. Two significant figures is what the
 * input supports.
 *
 * Under 1,000 is shown exactly, because at that size the count is a handful
 * of named towns and rounding it to "0K" would be worse than useless.
 */
export function formatPeople(n) {
  if (!Number.isFinite(n) || n < 0) return null;
  if (n === 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1e6) return `${Math.round(n / 1e3)}K`;
  if (n < 1e9) {
    const m = n / 1e6;
    return `${m < 10 ? m.toFixed(1) : Math.round(m)}M`;
  }
  return `${(n / 1e9).toFixed(1)}B`;
}
