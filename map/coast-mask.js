/**
 * coast-mask.js — THE COASTLINE AS AN OFF-SCREEN IMAGE, SO A SHADER CAN ASK
 * "AM I OVER WATER?" ONE PIXEL AT A TIME.
 *
 * ==> WHY AN IMAGE AND NOT A POINT TEST. <== Two CPU shoreline cuts shipped
 * before this and both were reverted, and neither failed because clipping is
 * hard. They failed on three properties of the data, and painting a shape into
 * a canvas makes all three stop mattering at once:
 *
 *   - The basemap hands the same stretch of coast back TWICE, because tiles
 *     carry a buffer of their neighbours. An even-odd ray cast counts crossings
 *     and two copies cancel to the wrong answer — the straight lines and the
 *     cross in the screenshot were tile seams, not coastline. **A fill paints
 *     the same pixel twice and the answer is unchanged.**
 *   - Winding direction is not guaranteed and nothing upstream promises it.
 *     **A fill per polygon does not read winding.**
 *   - The water mesh's own grid is about a kilometre, so a per-vertex test
 *     could only ever draw a kilometre staircase. **A texel here is a couple of
 *     hundred metres, and it is not tied to the mesh at all.**
 *
 * ==> THE ONE THING THAT STILL MATTERS IS POLARITY, AND IT IS READ, NEVER
 * ASSUMED. <== OpenMapTiles publishes no land polygon: what comes back is the
 * OCEAN. Protomaps has a real `earth` layer and what comes back is the LAND.
 * `coastPolygons()` reports which schema answered and this file inverts on it.
 * Getting that backwards paints water exactly where the island is, which is
 * what the second attempt did.
 *
 * ==> AND IT FAILS TOWARDS TODAY'S BUG, NEVER TOWARDS AN EMPTY SEA. <== If no
 * schema answers, or too little coastline is loaded to trust, this returns
 * `null` and the caller draws water everywhere — which is the behaviour that
 * shipped for months. A mask that silently deleted the ocean because a tile was
 * late would be a far worse failure than the one it is fixing, and it would
 * look like a rendering bug rather than a data one.
 *
 * Imports `map/coast-source.js` and `config/`. Needs a canvas; no THREE, no
 * MapLibre beyond what it is handed.
 */

import { VOLCANO } from '../config/constants.js';
import { coastPolygons, coastGeneration } from './coast-source.js';

const MASK = VOLCANO.map3d.water.mask;

/** White where the sea is allowed to draw. The shader reads one channel. */
const WET = '#ffffff';
const DRY = '#000000';

/**
 * Build the shore mask for the map's current view.
 *
 * @param {object} map a MapLibre map
 * @returns {{canvas: HTMLCanvasElement, minLon: number, minLat: number,
 *            maxLon: number, maxLat: number, generation: number,
 *            schema: string, polygons: number} | null}
 *   `null` means "no trustworthy coastline right now" — the caller MUST treat
 *   that as "draw the sea unmasked", not as "there is no sea here".
 */
export function buildCoastMask(map) {
  if (!map || typeof map.getBounds !== 'function') return null;

  const coast = coastPolygons(map);
  /* The honest no-substrate state. Not an empty coastline — an absent one. */
  if (!coast.schema || !coast.polygons.length) return null;

  /* ==> THE BOX IS THE VIEW PLUS A MARGIN, IN PLAIN LON/LAT. <== The mask only
   * has to cover the water that can be on screen, and a box in degrees is the
   * one space both this canvas and the water shader can agree on without
   * either of them knowing about Mercator or about the globe blend. */
  const b = map.getBounds();
  const west = b.getWest();
  const east = b.getEast();
  const south = b.getSouth();
  const north = b.getNorth();

  /* getBounds can hand back a wrapped or inverted box near the antimeridian.
   * A mask drawn from an inverted box is a mask covering the wrong half of the
   * planet, so bail rather than draw something confidently wrong. */
  if (!(east > west) || !(north > south)) return null;

  const padLon = (east - west) * MASK.viewPad;
  const padLat = (north - south) * MASK.viewPad;
  const minLon = west - padLon;
  const maxLon = east + padLon;
  const minLat = south - padLat;
  const maxLat = north + padLat;

  const size = MASK.sizePx;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const x = cv.getContext('2d');
  if (!x) return null;

  const oceanRings = coast.schema === 'openmaptiles';

  /* Start from whichever answer the polygons are NOT going to paint, so one
   * fill pass is the whole job. Ocean polygons paint wet onto a dry field;
   * land polygons paint dry onto a wet one. */
  x.fillStyle = oceanRings ? DRY : WET;
  x.fillRect(0, 0, size, size);
  x.fillStyle = oceanRings ? WET : DRY;

  const spanLon = maxLon - minLon;
  const spanLat = maxLat - minLat;
  const px = (lon) => ((lon - minLon) / spanLon) * size;
  /* Latitude runs up the world and down the canvas. */
  const py = (lat) => ((maxLat - lat) / spanLat) * size;

  /* ==> ONE PATH PER POLYGON, AND `evenodd` INSIDE IT. <== These two choices
   * are what make the duplicate-geometry problem disappear rather than get
   * worked around:
   *
   *   - A SEPARATE PATH PER POLYGON means two copies of one island arriving
   *     from two overlapping tiles are two independent fills. They paint the
   *     same pixels the same colour. Nothing cancels. Had every ring gone into
   *     one path, the duplicates would have cancelled exactly as they did in
   *     the reverted ray cast.
   *   - `evenodd` WITHIN a polygon punches its holes out correctly no matter
   *     which way the rings wind. GeoJSON says outer rings and holes wind
   *     oppositely; tile data does not always agree, and `nonzero` believes it.
   */
  for (const poly of coast.polygons) {
    x.beginPath();
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const cx = px(ring[i][0]);
        const cy = py(ring[i][1]);
        if (i === 0) x.moveTo(cx, cy);
        else x.lineTo(cx, cy);
      }
      x.closePath();
    }
    x.fill('evenodd');
  }

  return {
    canvas: cv,
    minLon,
    minLat,
    maxLon,
    maxLat,
    generation: coastGeneration(map),
    schema: coast.schema,
    polygons: coast.polygons.length,
  };
}
