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
 * The URL for one storm's satellite disc — OUR RELAY, not the vendor.
 *
 * ==> IT WENT BEHIND THE RELAY ON 2026-07-26, AND NOT FOR CORS <==
 *
 * Every satellite vendor here sends `Access-Control-Allow-Origin: *`, so the
 * browser always could fetch these directly, and did. What changed is a
 * measurement: GIBS sends `no-store, no-cache, must-revalidate` with a 1970
 * `Expires` and a `Pragma: no-cache`, so nothing was EVER cached — every
 * toggle re-downloaded 826 KB — and it is slow and wildly variable, measured at
 * 0.8 s to 30.7 s on four identical back-to-back requests.
 *
 * Behind `/api/imagery/satellite` we own the response headers, so the browser
 * cache works and Cloudflare's edge collapses every reader into one upstream
 * request per box per five minutes. That is the only thing that helps a COLD
 * start, which no client-side cache can reach.
 *
 * WHICH LEAVES THIS FUNCTION SHAPED LIKE THE RADAR ONE: it names a bird and a
 * box, and the WMS spelling now lives in the relay. `sat.endpoint`, `sat.layer`
 * and `sat.wms` STAY IN `SATELLITES` — they are the documentation of what each
 * bird actually is, and the relay carries a deliberately narrow mirror of them
 * (see the note on `BIRDS` in functions/api/imagery/satellite.js). Change one,
 * change the other.
 *
 * There is NO TIME PARAMETER anywhere in this path — see
 * IMAGERY_SENDS_NO_TIME. Which is also what makes this URL a usable cache key:
 * stable across refreshes for a given storm and box (lib/imagery-cache.js).
 */
export function discUrl(sat, bbox, px = IMAGERY.requestPx) {
  return relayUrl(IMAGERY.satellite.relay, { sat: sat.id, bbox, px: String(px) });
}

/**
 * The URL for one storm's radar disc.
 *
 * MOVED HERE FROM map/imagery.js in the same pass that relayed satellite, and
 * the move is the point: the two are now siblings hitting two routes of the same
 * relay, and a cache keyed on the URL (lib/imagery-cache.js) needs both spelled
 * the SAME WAY. Built in two different files they would drift — one absolute and
 * one relative is enough to make the same frame cache under two keys.
 *
 * This file's header says pure functions only, no DOM, and that still holds:
 * these come back RELATIVE, with no `location` read anywhere. `fetch` resolves a
 * relative URL against the document on its own, and a relative string is the
 * better cache key regardless — it cannot change identity because the page moved
 * to a different host.
 */
export function radarUrl(bbox, px = IMAGERY.requestPx) {
  return relayUrl(IMAGERY.radar.relay, { bbox, px: String(px) });
}

/** One relay-URL builder so query encoding and parameter ORDER are identical
 *  across both routes. Order matters here in a way it does not for the server:
 *  the string is a cache key, and `?bbox=…&px=…` and `?px=…&bbox=…` are the same
 *  request under two different keys. */
function relayUrl(path, params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.set(k, v);
  return `${path}?${q.toString()}`;
}

/** Is this storm inside the radar service's stated extent? Ground radar is
 *  blank over the open ocean where storms live, so this is the difference
 *  between "no coverage here" and a blank raster reading as clear sky (§5). */
export function inRadarCoverage(lat, lon) {
  const { radar } = IMAGERY;
  const x = wrapLon(lon);
  return x >= radar.lonMin && x <= radar.lonMax && lat >= radar.latMin && lat <= radar.latMax;
}
