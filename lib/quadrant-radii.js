/**
 * quadrant-radii.js — a DRAWN wind band → the four quadrant radii that drew it.
 *
 * ==> THIS IS A RECOVERY, NOT AN ESTIMATE, AND THE MEASUREMENT SAYS SO. <==
 *
 * NHC publishes wind extent as four numbers per threshold — how far 34 kt
 * winds reach northeast, southeast, southwest and northwest of the centre —
 * and `data/home-corridor.js` is built on them. GDACS publishes the same
 * quantity as a PICTURE: a closed polygon per threshold per forecast hour.
 * This turns the picture back into the numbers.
 *
 * WHY THAT IS LOSSLESS HERE AND WOULD NOT BE ON AN ARBITRARY SHAPE. A GDACS
 * band is four constant-radius sectors joined by radial seams at 0/90/180/270
 * — the same construction `data/gdacs-geometry.js polishGeometry()` exists to
 * smooth for drawing. Inside a sector the radius does not vary. MEASURED on
 * ONE-C-26 off `origin/archive:latest/geometry/`, 2026-08-18, against the
 * storm's own published centre dot:
 *
 *   Poly_Green   (60 km/h)   ne 79.9   se 70.1   sw 50.0   nw 89.8   nm
 *   Poly_Orange  (90 km/h)   ne 40.0   se 20.0   sw 20.0   nw 40.0
 *   Poly_Red    (120 km/h)   ne 20.0   se 15.0   sw 10.0   nw 20.0
 *
 * Round nautical miles, with under 0.5 nm of spread across the ~90 vertices
 * inside each sector. Those ARE the numbers GDACS drew from. So converting to
 * quadrants and blending them back through `radiusAtBearing` is not an
 * approximation of the polygon — it is the source's own figures, fed to the
 * one wind-corridor implementation the app has (§12: a second copy of the
 * arrival math is how two screens come to disagree about when the wind hits).
 *
 * ==> THE MIDDLE HALF OF EACH QUADRANT, AND THAT WINDOW IS LOAD-BEARING. <==
 * The seams are radial segments running between one sector's radius and the
 * next, so their vertices sit at bearings of exactly 0/90/180/270 carrying
 * every value in between. A naive per-quadrant maximum reads those and
 * inherits the NEIGHBOUR'S radius: on the band above it returns 90 nm for the
 * northeast quadrant, which is the northwest figure leaking across the seam at
 * due north. Sampling only the middle half of each quadrant excludes the seams
 * entirely, and the median inside that window is then flat to a tenth of a
 * mile. Both halves matter — the window removes the contamination, the median
 * removes whatever the window missed.
 *
 * ==> AN EMPTY QUADRANT WINDOW HAS TWO CAUSES AND THEY ARE OPPOSITE FACTS. <==
 *
 *   1. THE SHAPE IS UNREADABLE. Nothing sits in that corner and nothing sits
 *      on the centre either. The whole band returns null: zero means "no wind
 *      that strong on that side", which is a measurement (spec-parameter
 *      §37.5), and publishing one because a shape could not be read would be
 *      inventing an all-clear for a flank. Null means the threshold is simply
 *      not published at that hour, which `sampleCorridor` already refuses to
 *      interpolate across.
 *
 *   2. GDACS DREW THAT QUADRANT AT ZERO. Where a flank reaches nothing the
 *      source does not shrink the sector or omit it — it collapses every one
 *      of its vertices onto the storm's own published dot. That is the same
 *      habit `data/gdacs-geometry.js isDegenerate()` already handles for a
 *      whole band, applied to one side of one. It is a PUBLISHED ZERO and
 *      returning null for it throws away real data.
 *
 * ==> TELLING THEM APART IS NOT A JUDGEMENT, IT IS A LOOKUP. <== Case 2 leaves
 * vertices AT the centre — 0.0000 nm from it, because GDACS writes the dot's
 * own coordinates — and case 1 does not. So an empty window beside centred
 * vertices is a zero, an empty window beside none is a refusal.
 *
 * WHAT IT COST WHILE THIS FILE COULD NOT TELL THEM APART, MEASURED off
 * `origin/archive:latest/geometry/` on 2026-08-20: SAUDEL-26 lost the FIRST
 * published reading of all three thresholds (34 kt at tau 0, 50 at tau 12, 64
 * at tau 24) and TWO-C-26 lost 34 kt at taus 9 and 21. Every one of those was
 * a band with three normal sectors and one drawn at zero.
 *
 * Pure. Imports lib/geo.js only. No DOM, no config, no fetching — the sampling
 * window and the centre tolerance arrive as arguments so the constants stay in
 * one findable place.
 */

import { greatCircleNm, bearingDeg } from './geo.js';

/** Quadrant centre bearings and their keys, in the order and under the names
 *  `lib/windswath.js radiusAtBearing()` expects. The two files must agree
 *  about which corner is which or every reach is read on the wrong flank. */
const QUAD_CENTRES = [45, 135, 225, 315];
const QUAD_KEYS = ['ne', 'se', 'sw', 'nw'];

/** Every linear ring in a Polygon or MultiPolygon, or null for anything else.
 *  Holes come through with the outer rings and that is harmless: a GDACS band
 *  has none, and a vertex on one would sit at a radius the sector already
 *  covers. */
function ringsOf(geometry) {
  if (geometry?.type === 'Polygon') return geometry.coordinates || null;
  if (geometry?.type === 'MultiPolygon') return (geometry.coordinates || []).flat();
  return null;
}

/** Smallest angle between two compass bearings, degrees, always 0–180. */
function angleGap(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * The four quadrant radii, nautical miles, or null.
 *
 * @param {object} geometry   a GeoJSON Polygon or MultiPolygon — one band, one
 *                            threshold, one forecast hour.
 * @param {[number, number]} centre  the storm's PUBLISHED position for that
 *                            hour. Not a centroid: a band is asymmetric, so its
 *                            bounding-box centre is not the storm and measuring
 *                            from one would shift every radius.
 * @param {number} windowDeg  width of the sampling window at each quadrant
 *                            centre, degrees. Must be ≤ 90 — wider and the
 *                            windows overlap and a vertex is counted twice.
 * @param {number} centreNm   how close to `centre` a vertex has to sit to be
 *                            read as GDACS drawing that flank at zero rather
 *                            than as part of an arc. Zero or absent turns the
 *                            behaviour off and every empty window fails closed.
 * @returns {{ne:number, se:number, sw:number, nw:number}|null}
 */
export function quadrantRadiiNm(geometry, centre, windowDeg, centreNm = 0) {
  const rings = ringsOf(geometry);
  const [clon, clat] = centre || [];
  if (!rings?.length || !Number.isFinite(clon) || !Number.isFinite(clat)) return null;
  if (!Number.isFinite(windowDeg) || windowDeg <= 0 || windowDeg > 90) return null;
  const atCentreNm = Number.isFinite(centreNm) && centreNm > 0 ? centreNm : 0;

  const half = windowDeg / 2;
  const buckets = [[], [], [], []];
  /* ==> COUNTED, AND EXCLUDED FROM EVERY BUCKET. <== A vertex sitting on the
   * centre has no meaningful bearing — `bearingDeg` returns 0 for it — so at
   * a window that happens to contain due north it would land in the northeast
   * bucket carrying a radius of zero and drag that quadrant's median down. It
   * belongs to no quadrant and to all four equally; the honest reading is to
   * hold it out of the sampling entirely and let its PRESENCE decide what an
   * empty window means. */
  let centred = 0;

  for (const ring of rings) {
    for (const pt of ring || []) {
      const lon = pt?.[0];
      const lat = pt?.[1];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (atCentreNm && greatCircleNm(clon, clat, lon, lat) <= atCentreNm) {
        centred++;
        continue;
      }
      const brg = bearingDeg(clon, clat, lon, lat);
      for (let q = 0; q < 4; q++) {
        if (angleGap(brg, QUAD_CENTRES[q]) > half) continue;
        /* Distance computed only once the vertex has earned a bucket. Three
         * bands times nine forecast hours times 365 vertices is 10,000
         * candidates per storm, and most of them are seam-adjacent and
         * discarded. */
        buckets[q].push(greatCircleNm(clon, clat, lon, lat));
        break; // windows cannot overlap at windowDeg ≤ 90
      }
    }
  }

  const out = {};
  for (let q = 0; q < 4; q++) {
    const vals = buckets[q];
    if (!vals.length) {
      /* Empty beside centred vertices: the source drew this flank at zero and
       * that is a measurement. Empty beside none: the shape is unreadable and
       * the whole band fails closed. See the header — these are opposite
       * facts and this is the only line that separates them. */
      if (!centred) return null;
      out[QUAD_KEYS[q]] = 0;
      continue;
    }
    vals.sort((a, b) => a - b);
    out[QUAD_KEYS[q]] = vals[vals.length >> 1];
  }
  return out;
}
