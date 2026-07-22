/**
 * graticule.js — the lat/long grid.
 *
 * Generated in code. No tile source carries a graticule, and building one
 * would mean a second tile file for four hundred straight lines.
 *
 * SPEC §9: "Dimmer than the coast; it's what gives the 'digital sphere' read."
 *
 * Two things make this correct rather than merely present:
 *
 * 1. DENSIFICATION. A line from (0°, -90°) to (0°, 90°) has two vertices.
 *    MapLibre draws the shortest path between them, which on a globe cuts a
 *    chord THROUGH the sphere rather than following its surface. Every line
 *    here is subdivided so it curves with the globe.
 *
 * 2. MAJOR LINES CARRY MEANING. The equator, prime meridian, and the tropics
 *    are drawn brighter than the rest. That is not decoration — SPEC §12's
 *    "structural devices encode something true." A grid where every line is
 *    identical tells you nothing about where you are.
 *
 * Imports only from config/. No DOM.
 */

import { DARK, SIZE, OPACITY } from '../config/tokens.js';
import { ZOOM, GLOBE } from '../config/constants.js';
import { GRATICULE_INSERT_BEFORE } from './style-dark.js';

export const GRATICULE_SOURCE_ID = 'graticule';
export const GRATICULE_LAYER_MINOR = 'graticule-minor';
export const GRATICULE_LAYER_MAJOR = 'graticule-major';

/** Latitudes that mean something. The tropics are where these storms live;
 *  drawing them brighter is information, not ornament. */
const TROPIC_LAT = 23.43665;
const MAJOR_LATS = [0, TROPIC_LAT, -TROPIC_LAT];
const MAJOR_LONS = [0, 180, -180];

/** Meridians stop short of the poles. Lines converging on a single point
 *  produce a dense scribble at each pole that reads as a rendering bug. */
const POLE_CUTOFF = 85;

const isMajorLat = (lat) => MAJOR_LATS.some((m) => Math.abs(lat - m) < 0.001);
const isMajorLon = (lon) => MAJOR_LONS.some((m) => Math.abs(lon - m) < 0.001);

/**
 * Builds the graticule as a GeoJSON FeatureCollection.
 *
 * @param {object} opts
 * @param {number} opts.stepDeg    - spacing between lines
 * @param {number} opts.densifyDeg - vertex spacing ALONG each line
 * @returns {object} GeoJSON FeatureCollection
 */
export function buildGraticule({
  stepDeg = GLOBE.graticuleStepDeg,
  densifyDeg = GLOBE.graticuleDensifyDeg,
} = {}) {
  const features = [];

  /* Parallels — lines of constant latitude, running east-west.
   * These need densifying too: at high latitude a parallel is a small circle,
   * and two endpoints would draw a straight chord across it. */
  for (let lat = -90 + stepDeg; lat < 90; lat += stepDeg) {
    const coords = [];
    for (let lon = -180; lon <= 180; lon += densifyDeg) {
      coords.push([lon, lat]);
    }
    features.push({
      type: 'Feature',
      properties: { major: isMajorLat(lat), kind: 'parallel', value: lat },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }

  /* The equator is not on the `stepDeg` grid unless stepDeg divides 90, so it
   * gets added explicitly rather than being left to arithmetic luck. */
  if (!features.some((f) => f.properties.kind === 'parallel' && f.properties.value === 0)) {
    const coords = [];
    for (let lon = -180; lon <= 180; lon += densifyDeg) coords.push([lon, 0]);
    features.push({
      type: 'Feature',
      properties: { major: true, kind: 'parallel', value: 0 },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }

  /* The tropics, likewise — 23.43665° will never land on a step boundary. */
  for (const lat of [TROPIC_LAT, -TROPIC_LAT]) {
    const coords = [];
    for (let lon = -180; lon <= 180; lon += densifyDeg) coords.push([lon, lat]);
    features.push({
      type: 'Feature',
      properties: { major: true, kind: 'tropic', value: lat },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }

  /* Meridians — lines of constant longitude, running north-south. */
  for (let lon = -180; lon < 180; lon += stepDeg) {
    const coords = [];
    for (let lat = -POLE_CUTOFF; lat <= POLE_CUTOFF; lat += densifyDeg) {
      coords.push([lon, lat]);
    }
    features.push({
      type: 'Feature',
      properties: { major: isMajorLon(lon), kind: 'meridian', value: lon },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }

  return { type: 'FeatureCollection', features };
}

/**
 * Adds the graticule source and its two layers to a live map.
 *
 * Inserted BENEATH the coastline (SPEC §13 draw order). The graticule is
 * reference, not content — a grid line crossing over a glowing coast reads
 * as an error.
 *
 * @param {maplibregl.Map} map
 */
export function addGraticule(map) {
  if (map.getSource(GRATICULE_SOURCE_ID)) return;

  map.addSource(GRATICULE_SOURCE_ID, {
    type: 'geojson',
    data: buildGraticule(),
  });

  const byZoom = (stops) => ['interpolate', ['linear'], ['zoom'], ...stops.flat()];

  /* Minor lines fade out as you descend. At the local band you are looking at
   * a bay, and a 15° grid is meaningless there — it would just be clutter
   * over the thing you zoomed in to see. */
  map.addLayer(
    {
      id: GRATICULE_LAYER_MINOR,
      type: 'line',
      source: GRATICULE_SOURCE_ID,
      filter: ['!', ['get', 'major']],
      paint: {
        'line-color': DARK.graticule,
        'line-width': SIZE.graticuleWidth,
        'line-opacity': byZoom([
          [ZOOM.planet, OPACITY.graticule],
          [ZOOM.basin, OPACITY.graticule],
          [ZOOM.regional, OPACITY.graticule * 0.4],
          [ZOOM.local, 0],
        ]),
      },
    },
    GRATICULE_INSERT_BEFORE
  );

  /* Major lines persist further — the equator and the tropics stay useful
   * when you are looking at a basin. */
  map.addLayer(
    {
      id: GRATICULE_LAYER_MAJOR,
      type: 'line',
      source: GRATICULE_SOURCE_ID,
      filter: ['get', 'major'],
      paint: {
        'line-color': DARK.graticuleMajor,
        'line-width': SIZE.graticuleWidthMajor,
        'line-opacity': byZoom([
          [ZOOM.planet, OPACITY.graticuleMajor],
          [ZOOM.regional, OPACITY.graticuleMajor * 0.6],
          [ZOOM.max, 0],
        ]),
      },
    },
    GRATICULE_INSERT_BEFORE
  );
}

/**
 * Toggles graticule visibility. This is the additive layer's on/off path
 * (SPEC §7) — it uses `visibility` rather than removing the layers, so
 * re-enabling costs nothing and the source stays warm.
 *
 * @param {maplibregl.Map} map
 * @param {boolean} visible
 */
export function setGraticuleVisible(map, visible) {
  const v = visible ? 'visible' : 'none';
  for (const id of [GRATICULE_LAYER_MINOR, GRATICULE_LAYER_MAJOR]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  }
}
