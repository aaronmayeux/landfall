/**
 * windrange.js — GDACS current wind, MEASURED from its own wind field.
 *
 * THE PROBLEM THIS SOLVES. GDACS publishes no current wind number anywhere
 * (§4: `severitydata.severity` is a FORECAST PEAK and stays in `peakWindKt`).
 * Until this file existed, everything that needed "how strong is this storm
 * right now" fell through to `representativeKt()` — the MIDDLE of the stated
 * class's range. For a hurricane that means ~110 kt for every GDACS storm on
 * earth, because the class `HU` spans Cat 1 to Cat 5. A marginal Cat 1 and a
 * 140 kt super typhoon stood at exactly the same height on the cage.
 *
 * THE MEASUREMENT. GDACS DOES publish a wind field: timestepped 60 / 90 /
 * 120 km/h footprints whose earliest key is the current analysis time. Test
 * whether the storm's own centre falls inside each one and its current
 * intensity is bracketed — not guessed:
 *
 *   inside 120 km/h  ->  at least 64.8 kt          (open top: see below)
 *   inside  90 only  ->  48.6 .. 64.8 kt
 *   inside  60 only  ->  32.4 .. 48.6 kt
 *   inside none      ->  below 32.4 kt
 *
 * Validated four for four against NHC ground truth on the 2026-07-24 audit:
 * Genevieve 32-49 kt (NHC said 40), Fausto >=65 (NHC said 90), Bertha <32,
 * Noul >=65.
 *
 * A RANGE, NEVER A NUMBER. The honesty of this measurement is that we do not
 * have a point value, and collapsing it to one would manufacture precision
 * the source never published — the exact sin `severity` was committing. The
 * ceiling above the top band is `null`, not a number: GDACS's strongest
 * footprint IS the Cat 1 floor, so "at least 65 kt" is everything it can
 * tell us and inventing a top would re-import the very ceiling this replaces.
 *
 * WHY THE FLOOR IS WHAT THE CAGE USES. The floor is a MEASUREMENT — the storm
 * is at least this strong, because its centre sits inside a published
 * footprint for that speed. A midpoint is an assumption. Height and node
 * colour stay one signal (§9) because both now come from the wind field
 * rather than from a class label.
 *
 * Pure geometry and arithmetic. No DOM, no fetch, no app state. Imports
 * config/ only (§12).
 */

import { GDACS_GEOMETRY } from '../config/constants.js';

/* Knot thresholds, DERIVED from the published km/h — never hand-typed
 * alongside them (§12: constants hold the source, downstream is arithmetic).
 * Sorted strongest first so the first containing band wins. */
const KMH_PER_KT = 1.852;

const TIERS = Object.freeze(
  Object.values(GDACS_GEOMETRY.bandClass)
    .map((b) => Object.freeze({ kmh: b.kmh, kt: b.kmh / KMH_PER_KT }))
    .sort((a, b) => b.kmh - a.kmh)
);

/** The weakest published threshold — the ceiling when the centre is in none
 *  of the bands. */
const WEAKEST = TIERS[TIERS.length - 1];

/**
 * Ray-casting point-in-polygon. Counts crossings of a ray running due east
 * from the point; odd means inside.
 *
 * NO ANTIMERIDIAN HANDLING, DELIBERATELY. A GDACS band is a storm-sized blob
 * a few degrees across and the test point is its own centre — the two are
 * always in the same coordinate neighbourhood. A ring that genuinely straddles
 * 180 deg would need splitting, and this returns `false` rather than a wrong
 * `true`: no range is an honest absence (the caller omits the reading), while
 * a wrong range is a fabricated measurement.
 */
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (!Number.isFinite(xi) || !Number.isFinite(yi)) continue;
    const straddles = yi > lat !== yj > lat;
    if (!straddles) continue;
    const x = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (lon < x) inside = !inside;
  }
  return inside;
}

/** Polygon containment with holes: inside an outer ring and not inside any
 *  of its interior rings. GeoJSON puts the outer ring first. */
function pointInPolygon(lon, lat, rings) {
  if (!Array.isArray(rings) || !rings.length) return false;
  if (!pointInRing(lon, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lon, lat, rings[i])) return false;
  }
  return true;
}

/** Handles Polygon and MultiPolygon; anything else is not a band. */
function pointInFeature(lon, lat, feature) {
  const g = feature?.geometry;
  if (!g) return false;
  if (g.type === 'Polygon') return pointInPolygon(lon, lat, g.coordinates);
  if (g.type === 'MultiPolygon') {
    return (g.coordinates || []).some((rings) => pointInPolygon(lon, lat, rings));
  }
  return false;
}

/**
 * Bracket a storm's CURRENT intensity from the current-timestep wind bands.
 *
 * @param {{lon:number, lat:number}} centre - the storm's live fix. The FEED's
 *   position, which §4 establishes is the storm — never a polygon centroid.
 * @param {Array<object>} bands - current-timestep band features. Each needs
 *   `properties._gdacsKmh` (what the source itself published) to be placed in
 *   a tier; a band whose threshold cannot be read is skipped rather than
 *   guessed, matching the drawing layer's own rule (§6 safety colors).
 * @returns {{floorKt:number, ceilingKt:number|null, source:'gdacs-windfield'}|null}
 *   null when there is nothing to measure against — the caller then has no
 *   reading, which is a different thing from a reading of zero.
 */
export function windRangeFromBands(centre, bands) {
  if (!Number.isFinite(centre?.lon) || !Number.isFinite(centre?.lat)) return null;
  const list = Array.isArray(bands) ? bands : [];
  if (!list.length) return null;

  /* Which thresholds this payload actually contains. A storm too weak for a
   * 120 km/h footprint simply has no red band, and "not inside the red band"
   * would be a false negative if we assumed one was published. Only tiers
   * PRESENT in the payload can be reasoned about. */
  const present = new Set();
  for (const f of list) {
    const kmh = f?.properties?._gdacsKmh;
    if (Number.isFinite(kmh)) present.add(kmh);
  }
  if (!present.size) return null;

  const tiers = TIERS.filter((t) => present.has(t.kmh));
  if (!tiers.length) return null;

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const inside = list.some(
      (f) => f?.properties?._gdacsKmh === tier.kmh && pointInFeature(centre.lon, centre.lat, f)
    );
    if (!inside) continue;
    /* Inside this tier. The ceiling is the next STRONGER published tier, or
     * null at the top — GDACS cannot see above its strongest band. */
    const stronger = tiers[i - 1];
    return {
      floorKt: tier.kt,
      ceilingKt: stronger ? stronger.kt : null,
      source: 'gdacs-windfield',
    };
  }

  /* Outside every published band: weaker than the weakest threshold. The
   * floor is 0 — genuinely nothing measured below — and the ceiling is that
   * threshold. This is a real reading, not a failure: it is how a depression
   * is told apart from a storm. */
  return { floorKt: 0, ceilingKt: WEAKEST.kt, source: 'gdacs-windfield' };
}

/**
 * The number a visual ramp should use: the measured floor.
 *
 * Never displayed as a wind speed — the panel prints the RANGE (§5). This is
 * the cage's input, replacing `representativeKt()` for any storm that has a
 * reading.
 */
export function rampKtFromRange(range) {
  return Number.isFinite(range?.floorKt) ? range.floorKt : null;
}
