/**
 * surge-clip.js — a coastal reach stops where a filled area already says the
 * same thing.
 *
 * ==> THIS EXISTS BECAUSE OF A MEASUREMENT THAT TESTED THE WRONG GEOMETRY.
 *     <== The one-wash pass measured how often a reach crosses a filled area
 * and got 6 of 107 vertices, about 5.6%, and concluded the overlap was
 * negligible. That measurement ran on NHC's RAW published lines. It is not
 * what the app draws.
 *
 * What the app draws is the BANDED reach: the line snapped onto the loaded
 * coastline (map/coast-band.js). And on this basemap the coastline is the land
 * polygon's edge — which is very nearly the boundary of the surge polygon
 * sitting right beside it. So after banding, a reach traces the same coast the
 * fill already covers, and the true overlap is not 5% but most of its length.
 * That is the bright outline hugging every shape at Marco Island, and the
 * orange tracery over Ten Thousand Islands where every islet gets its own
 * 5 px line on top of the fill.
 *
 * THE FIX IS NOT A THINNER LINE. A reach inside a filled area is DUPLICATE
 * PAINT OF THE SAME FACT: NHC published a depth for that water as an area, and
 * drawing a line along its edge adds no information and breaks the one-wash
 * contract in OPACITY.surgeFill. So the segment is dropped.
 *
 * WHAT IS NOT DROPPED, and this is the §5 half: a reach with no filled area
 * under it is the ONLY thing saying that coast has a forecast, and it keeps
 * every metre. A reach that ends up entirely inside filled areas keeps nothing
 * — correctly, because the fill is already showing its depth — but the feature
 * is not deleted, so nothing downstream can mistake "already covered" for
 * "never published".
 *
 * Pure. Imports nothing. No map, no DOM.
 */

/** Ray-cast point-in-ring. Rings arrive closed; the wrap term handles both. */
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[k];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and outside every hole. A pocket of high ground is
 *  genuinely not covered, so a reach crossing one still draws. */
function pointInPolygon(x, y, rings) {
  if (!pointInRing(x, y, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(x, y, rings[i])) return false;
  return true;
}

function coveredBy(x, y, areas) {
  for (const a of areas) {
    const g = a.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') {
      if (pointInPolygon(x, y, g.coordinates)) return true;
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) if (pointInPolygon(x, y, poly)) return true;
    }
  }
  return false;
}

/** Keep the runs of a line that are NOT inside any filled area.
 *
 *  Tested at each segment's MIDPOINT rather than its endpoints: a segment
 *  straddling a boundary has one end in and one out, and either endpoint test
 *  alone would flicker between keeping and dropping it along a coast that the
 *  fill follows closely — which is every coast this runs on. */
function keepUncovered(line, areas) {
  const out = [];
  let run = [];
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const covered = coveredBy((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, areas);
    if (covered) {
      if (run.length >= 2) out.push(run);
      run = [];
    } else {
      if (!run.length) run.push(a);
      run.push(b);
    }
  }
  if (run.length >= 2) out.push(run);
  return out;
}

/**
 * @param {Array} reaches banded reach features (LineString or MultiLineString)
 * @param {Array} areas   surge polygon features
 * @returns {{features: Array, droppedWholly: number}} `droppedWholly` counts
 *   reaches with nothing left to draw — logged, not hidden, because a sudden
 *   jump in it means the fills grew over the lines rather than the lines
 *   disappearing.
 */
export function clipReachesToUncovered(reaches, areas) {
  if (!areas?.length) return { features: reaches || [], droppedWholly: 0 };

  const features = [];
  let droppedWholly = 0;

  for (const f of reaches || []) {
    const g = f.geometry;
    if (!g) continue;
    const lines =
      g.type === 'LineString' ? [g.coordinates]
      : g.type === 'MultiLineString' ? g.coordinates
      : null;
    if (!lines) { features.push(f); continue; }

    const kept = [];
    for (const line of lines) for (const part of keepUncovered(line, areas)) kept.push(part);

    if (!kept.length) { droppedWholly++; continue; }
    features.push({
      ...f,
      geometry: kept.length === 1
        ? { type: 'LineString', coordinates: kept[0] }
        : { type: 'MultiLineString', coordinates: kept },
    });
  }

  return { features, droppedWholly };
}
