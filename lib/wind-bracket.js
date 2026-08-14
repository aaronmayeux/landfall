/**
 * wind-bracket.js — current wind for a GDACS storm, bracketed from its own
 * wind bands (spec-parameter §28.2, §28.5).
 *
 * GDACS publishes no current wind number. What it does publish is the current
 * timestep's wind footprints at 60/90/120 km/h, and testing which of those
 * contain the storm's own centre brackets the current intensity into a range:
 * inside 60 and outside 90 means 60–90 km/h at the core, which is 32–49 kt.
 * Validated four-for-four against NHC ground truth on live storms (§28.2's
 * table), which is why this ships as a range and never as a number — the
 * range IS the measurement, and a midpoint would be an invention.
 *
 * THE CEILING BELONGS TO GDACS. 120 km/h is 65 kt, barely the Cat 1 floor,
 * so the strongest thing this can ever say is "at least 65 kt". It cannot
 * tell a Cat 1 from a Cat 5 — no derived number pretends otherwise.
 *
 * ABSENCE IS A MEASUREMENT HERE. GDACS marks "this threshold isn't reached"
 * by publishing a zero-area shape, which the geometry parser drops before
 * anything here runs (GDACS_GEOMETRY.degenerateSpanDeg). A threshold with no
 * live polygon in the current timestep therefore means the storm does not
 * reach that speed anywhere right now, and it counts as "outside" — that is
 * what makes "under 32 kt" and the upper bound of every bracket honest
 * claims rather than gaps.
 *
 * Pure functions, no DOM, no network. Imports config only (§12).
 */

import { GDACS_GEOMETRY } from '../config/constants.js';

/* The three canonical thresholds, ascending, derived from the same table the
 * band parser validates labels against — one source of truth for what Green,
 * Orange and Red mean. Keyed by the `radii` colorKey the parser stamps on
 * every band feature (data/gdacs-geometry.js `tagBand`). */
const THRESHOLDS = Object.freeze(
  Object.values(GDACS_GEOMETRY.bandClass)
    .map((b) => ({ colorKey: b.colorKey, kmh: b.kmh }))
    .sort((a, b) => a.kmh - b.kmh)
);

/** GDACS km/h → whole knots, using GDACS's own ratio (constants.js carries
 *  the reasoning). 60→32, 90→49, 120→65 — the audit's exact figures. */
const toKt = (kmh) => Math.round(kmh / GDACS_GEOMETRY.kmhPerKtGdacs);

/* ---------------------------------------------------------------------------
 * POINT IN POLYGON — even-odd ray cast, antimeridian-safe.
 *
 * Even-odd over EVERY ring of a polygon handles holes without naming them: a
 * point inside the outer ring and inside a hole crosses an even total and
 * comes out "outside", which is correct. MultiPolygon is "inside any part".
 *
 * THE ANTIMERIDIAN IS THE ONE REAL TRAP. GDACS publishes -180..180
 * longitudes, and a West Pacific band near the date line can carry vertices
 * on both sides of the seam — raw ray casting across that jump invents an
 * edge spanning the whole planet. Every vertex longitude is unwrapped to the
 * copy nearest the QUERY POINT before testing, which keeps a storm-sized
 * ring contiguous no matter where it sits. Correct for compact shapes like
 * wind bands; deliberately not a general fix for hemispheric polygons, which
 * nothing here feeds it.
 * ------------------------------------------------------------------------- */

const unwrap = (lon, refLon) => lon + 360 * Math.round((refLon - lon) / 360);

function crossings(ring, lon, lat) {
  let n = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][1], yj = ring[j][1];
    if ((yi > lat) === (yj > lat)) continue;
    const xi = unwrap(ring[i][0], lon), xj = unwrap(ring[j][0], lon);
    const x = xi + ((lat - yi) / (yj - yi)) * (xj - xi);
    if (lon < x) n++;
  }
  return n;
}

/** Even-odd containment for a GeoJSON Polygon or MultiPolygon geometry. */
export function geometryContains(geometry, lon, lat) {
  if (!geometry || !Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  if (geometry.type === 'Polygon') {
    let n = 0;
    for (const ring of geometry.coordinates || []) n += crossings(ring, lon, lat);
    return n % 2 === 1;
  }
  if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates || []) {
      let n = 0;
      for (const ring of poly) n += crossings(ring, lon, lat);
      if (n % 2 === 1) return true;
    }
    return false;
  }
  return false;
}

/**
 * Bracket the current wind from the current-timestep band features.
 *
 * @param {object[]} features  the `windCurrent` slot's features — already
 *        earliest-timestep only and degenerate-free (data/gdacs-geometry.js)
 * @param {number} lon  the storm's own centre, from the list feed
 * @param {number} lat
 * @returns {{minKt: number|null, maxKt: number|null}|null}
 *          floor/ceiling in knots; null bound = open-ended on that side;
 *          null result = no claim can be made.
 *
 * NON-NESTED CONTAINMENT IS REFUSED, NOT PATCHED. Wind bands nest physically
 * — you cannot stand in hurricane-force wind without also standing in
 * gale-force wind — and the parser confirms the areas nest on real data. A
 * centre inside Red but outside Green therefore means broken geometry, and
 * the honest response to broken geometry is no number at all (§5): a bracket
 * invented from a contradiction is exactly the confident-wrong the rule
 * exists to prevent.
 */
export function windBracketFromBands(features, lon, lat) {
  if (!Array.isArray(features) || !features.length) return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const contained = new Map(); // canonical kmh -> boolean
  for (const t of THRESHOLDS) contained.set(t.kmh, false);

  let sawBand = false;
  for (const f of features) {
    const key = f?.properties?.radii;
    const t = THRESHOLDS.find((x) => x.colorKey === key);
    if (!t) continue; // not a band feature; the slot should only carry bands
    sawBand = true;
    if (!contained.get(t.kmh) && geometryContains(f.geometry, lon, lat)) {
      contained.set(t.kmh, true);
    }
  }
  if (!sawBand) return null;

  /* Monotone check: once outside a threshold, every faster one must also be
   * outside. One pass, ascending. */
  let out = false;
  for (const t of THRESHOLDS) {
    const inThis = contained.get(t.kmh);
    if (out && inThis) {
      console.warn(
        '[landfall] wind bracket: centre inside a faster band but outside a ' +
          'slower one — non-nested geometry, refusing to bracket (§5)'
      );
      return null;
    }
    if (!inThis) out = true;
  }

  /* Floor = fastest contained threshold; ceiling = the next one up. */
  let floor = null;
  for (const t of THRESHOLDS) if (contained.get(t.kmh)) floor = t;

  if (!floor) return { minKt: null, maxKt: toKt(THRESHOLDS[0].kmh) };

  const above = THRESHOLDS.find((t) => t.kmh > floor.kmh);
  return {
    minKt: toKt(floor.kmh),
    maxKt: above ? toKt(above.kmh) : null,
  };
}
