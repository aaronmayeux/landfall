/**
 * imagery.js — which satellite, which box, which URL (SPEC §4).
 *
 * Pure functions only. No DOM, no fetching, no MapLibre — this file answers
 * geometry and addressing questions and nothing else, so the answers can be
 * checked without a map on screen.
 *
 * THE SHAPE OF THE FEATURE, and why it is not a global mosaic. Landfall draws
 * a DISC around each storm's eye, not a repainted planet. Aaron's call and the
 * right one on every axis at once: it is a fraction of the bytes, it needs no
 * seamless blending between four satellites with four different calibrations,
 * and a feathered disc reads as weather sitting on a globe where a full-globe
 * raster reads as a different basemap. The vendor choice collapses from "build
 * a mosaic" to "look up one longitude."
 *
 * Imports: config/ only.
 */

import { IMAGERY, SATELLITES } from '../config/constants.js';

/** Web Mercator's half-circumference in metres. Every projected value here
 *  derives from this one number rather than repeating 20037508 by hand. */
const MERC_R = 20037508.342789244;

/** Mercator cannot represent the poles, and every projection library picks the
 *  same practical cutoff. A storm never goes near it; a clamp here means a bad
 *  latitude produces a wrong-looking box instead of an Infinity that poisons
 *  a URL. */
const MERC_MAX_LAT = 85.0511287798066;

/** Mean Earth radius in km — the one input to "how many degrees is 600 km". */
const EARTH_KM = 6371;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Longitude wrapped into -180..180. Storm feeds are not consistent about
 *  this and a disc that straddles the dateline must not address itself with a
 *  longitude of 190. */
export function wrapLon(lon) {
  /* THE DATELINE RESOLVES TO -180, NEVER +180, AND THAT IS LOad-BEARING.
   *
   * An earlier version normalized -180 up to +180 because it reads more
   * naturally. It opened a one-degree-wide hole in the satellite table: the
   * ranges are half-open [min, max), so +180 matched neither Himawari's
   * [105, 180) nor GOES-West's [-180, -105), and a storm sitting exactly on
   * the dateline resolved to NO satellite and drew nothing. Caught by walking
   * every whole longitude through satelliteForLon, not by reading the code.
   *
   * Landing on -180 puts it in GOES-West, which has real imagery there
   * (measured: both GOES-West and Himawari cover a box straddling the
   * dateline), and closes the table with no special case anywhere else. */
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

export const mercX = (lon) => (lon * MERC_R) / 180;

export function mercY(lat) {
  const l = clamp(lat, -MERC_MAX_LAT, MERC_MAX_LAT);
  return (Math.log(Math.tan(((90 + l) * Math.PI) / 360)) / (Math.PI / 180)) * (MERC_R / 180);
}

/**
 * Which satellite owns this longitude.
 *
 * The ranges in `SATELLITES` are contiguous and cover the globe, so this can
 * only miss if the table is edited wrong — in which case it returns null and
 * the caller shows "no coverage" rather than drawing a guess. Never fall back
 * to a default satellite: a wrong bird returns a black frame, and a black
 * frame over a storm reads as clear sky (§5).
 */
export function satelliteForLon(lon) {
  const x = wrapLon(lon);
  for (const s of SATELLITES) {
    /* One range crosses the dateline in the general case; today's table does
     * not, but the check costs nothing and stops a future edit from silently
     * losing the Pacific. */
    const wraps = s.lonMin > s.lonMax;
    if (wraps ? x >= s.lonMin || x < s.lonMax : x >= s.lonMin && x < s.lonMax) return s;
  }
  return null;
}

/**
 * The disc's bounding box, as BOTH a projected box for the WMS request and
 * corner coordinates for MapLibre.
 *
 * THESE TWO MUST DESCRIBE THE SAME RECTANGLE or the imagery lands off the
 * storm. The box is built in METRES first and converted back to degrees for
 * the corners, rather than being computed twice in two coordinate systems —
 * one source, one arithmetic path, no chance of the two disagreeing.
 *
 * A square in Mercator metres is NOT a square in kilometres away from the
 * equator, and that is correct here: the image the server returns is Mercator,
 * MapLibre draws it as a Mercator quad, and the two match exactly. Requesting
 * a true circle on the ground would need a reprojection nobody is writing.
 */
export function discBox(lat, lon, radiusKm = IMAGERY.discRadiusKm) {
  const cx = mercX(wrapLon(lon));
  const cy = mercY(lat);

  /* Mercator's scale factor grows as 1/cos(latitude): a 600 km radius at 40N
   * spans more Mercator metres than the same radius at the equator. Without
   * this the disc would shrink towards the poles. */
  const half = (radiusKm / EARTH_KM) * (MERC_R / Math.PI) / Math.cos((clamp(lat, -MERC_MAX_LAT, MERC_MAX_LAT) * Math.PI) / 180);

  const minX = cx - half;
  const maxX = cx + half;
  const minY = clamp(cy - half, -MERC_R, MERC_R);
  const maxY = clamp(cy + half, -MERC_R, MERC_R);

  const lonOf = (x) => (x * 180) / MERC_R;
  const latOf = (y) =>
    (Math.atan(Math.exp((y / (MERC_R / 180)) * (Math.PI / 180))) * 360) / Math.PI - 90;

  const west = lonOf(minX);
  const east = lonOf(maxX);
  const south = latOf(minY);
  const north = latOf(maxY);

  return {
    bbox: `${minX},${minY},${maxX},${maxY}`,
    /* MapLibre's image source wants corners clockwise from top-left. Values
     * may run past +/-180 for a disc across the dateline; MapLibre handles a
     * continuous longitude, and wrapping them here would fold the quad. */
    corners: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
  };
}

/**
 * The GetMap URL for one storm disc.
 *
 * NO TIME PARAMETER, EVER — see IMAGERY_SENDS_NO_TIME in config/constants.js.
 * That is a measured decision with a measurement behind it, not an omission.
 *
 * WMS 1.1.1 spells the projection SRS and 1.3.0 spells it CRS. Both are in the
 * table because both vendors are in the table.
 */
export function discUrl(sat, bbox, px = IMAGERY.requestPx) {
  const u = new URL(sat.endpoint);
  const p = u.searchParams;
  p.set('SERVICE', 'WMS');
  p.set('VERSION', sat.wms);
  p.set('REQUEST', 'GetMap');
  p.set('LAYERS', sat.layer);
  p.set(sat.wms === '1.3.0' ? 'CRS' : 'SRS', 'EPSG:3857');
  p.set('BBOX', bbox);
  p.set('WIDTH', String(px));
  p.set('HEIGHT', String(px));
  /* PNG, NEVER JPEG. Inherited and still true: JPEG ringing near the black end
   * keys as coloured halos once a knockout runs over it. Both vendors were
   * measured serving PNG. */
  p.set('FORMAT', 'image/png');
  p.set('TRANSPARENT', 'true');
  p.set('STYLES', '');
  return u.toString();
}

/** Is this storm inside the radar service's stated extent? Ground radar is
 *  blank over the open ocean where storms live, so this is the difference
 *  between "no coverage here" and a blank raster reading as clear sky (§5). */
export function inRadarCoverage(lat, lon) {
  const { radar } = IMAGERY;
  const x = wrapLon(lon);
  return x >= radar.lonMin && x <= radar.lonMax && lat >= radar.latMin && lat <= radar.latMax;
}
