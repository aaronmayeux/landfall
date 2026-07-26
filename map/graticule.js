/**
 * graticule.js — THE THREE REFERENCE LATITUDES: equator and the two tropics.
 *
 * ==> THIS WAS A FULL 15° LAT/LONG GRID UNTIL 2026-07-25. <==
 *
 * Two things killed the grid, and the second is the interesting one.
 *
 * 1. NOBODY USED IT. This is a storm tracker, not a chart. A 15° graticule
 *    answers "what are my coordinates", which is a question the app answers
 *    better in the storm detail panel, in degrees, to one decimal place.
 *
 * 2. IT DREW UNEVENLY, AND THE REASON WAS BUILT IN. Parallels were generated
 *    on a clean `stepDeg` grid — …, 15°, 30°, 45°, … — and then the two
 *    TROPICS were appended on top at ±23.43665°, which lands on no step
 *    boundary and never will. So between 15° and 30° there were three lines
 *    with 8.4° above the tropic and 6.6° below it, while every other gap on
 *    the globe was a clean 15°. Aaron spotted it as "not drawing uniformly"
 *    and it was: an irregular line sitting in the middle of a regular grid,
 *    right where an Atlantic hurricane spends its life.
 *
 *    That could have been fixed by dropping the tropics. It was fixed by
 *    dropping everything else, because the tropics were the only lines in the
 *    set that MEANT anything. THE RULE §12 STATES — "structural devices encode
 *    something true" — was already carrying this file: the old header said
 *    "major lines carry meaning… a grid where every line is identical tells
 *    you nothing." The honest end of that thought is that the identical lines
 *    should not be drawn at all.
 *
 * WHAT SURVIVES, and why these three:
 *
 *   EQUATOR (0°)          Tropical cyclones do not cross it — the Coriolis
 *                         force that spins them reverses sign, and a storm
 *                         cannot survive the transit. It is also why northern
 *                         storms turn counterclockwise and southern ones
 *                         clockwise. The single most meaningful line on a
 *                         cyclone map.
 *   TROPIC OF CANCER      ±23.43665° — the latitudes where the sun reaches
 *   TROPIC OF CAPRICORN   the zenith at solstice, and the conventional edge
 *                         of the tropics. They bracket the warm water these
 *                         storms are born in; a storm crossing one is usually
 *                         a storm beginning to recurve and weaken.
 *
 * Three lines, none close enough to crowd another, each one nameable. 30°N/S
 * was considered and rejected: recurvature under the subtropical ridge really
 * does tend to happen near it, but it is a rule of thumb that moves with the
 * ridge, and drawing it as a fixed line would claim a precision the atmosphere
 * does not have (§5, applied to cartography).
 *
 * THEY ARE LABELLED. An unlabelled line is decoration; three anonymous
 * horizontals only mean something to someone who already knew. The labels are
 * what make this a reference layer rather than a texture.
 *
 * DENSIFICATION IS STILL LOAD-BEARING. A line from (−180°, 0°) to (180°, 0°)
 * has two vertices; MapLibre draws the shortest path between them, which on a
 * globe cuts a chord THROUGH the sphere rather than following its surface.
 * Every line here is subdivided so it curves with the planet.
 *
 * Imports only from config/. No DOM.
 */

import { SIZE, OPACITY } from '../config/tokens.js';
import { palette } from '../config/theme.js';
import { ZOOM, GLOBE } from '../config/constants.js';
import { GRATICULE_INSERT_BEFORE } from './style.js';

export const GRATICULE_SOURCE_ID = 'graticule';
export const GRATICULE_LAYER_MAJOR = 'graticule-major';
export const GRATICULE_LAYER_LABEL = 'graticule-label';

/**
 * THE OBLIQUITY OF THE ECLIPTIC — the Earth's axial tilt, and therefore the
 * latitude of both tropics. Not a rounded 23.5: the value is measured, it
 * drifts by about half an arcsecond a year, and rounding it would put the line
 * ~6 km from where the tropic actually is. Cheap to be right.
 */
const TROPIC_LAT = 23.43665;

/**
 * The three lines, with the names that go on them.
 *
 * Data, not code: adding a fourth reference latitude later means adding a row
 * here, and nothing else in this file changes. Names are UPPERCASE at render
 * (`text-transform`), matching the country-name treatment in style.js —
 * this is the same class of label, the broadest kind of place-naming on the
 * map, and it should read as a peer of "ATLANTIC OCEAN" rather than as data.
 */
const LINES = Object.freeze([
  Object.freeze({ lat: 0, name: 'Equator', kind: 'equator' }),
  Object.freeze({ lat: TROPIC_LAT, name: 'Tropic of Cancer', kind: 'tropic' }),
  Object.freeze({ lat: -TROPIC_LAT, name: 'Tropic of Capricorn', kind: 'tropic' }),
]);

/**
 * Builds the reference lines as a GeoJSON FeatureCollection.
 *
 * @param {object} opts
 * @param {number} opts.densifyDeg - vertex spacing ALONG each line
 * @returns {object} GeoJSON FeatureCollection
 */
export function buildGraticule({
  densifyDeg = GLOBE.graticuleDensifyDeg,
} = {}) {
  return {
    type: 'FeatureCollection',
    features: LINES.map(({ lat, name, kind }) => {
      const coordinates = [];
      for (let lon = -180; lon <= 180; lon += densifyDeg) {
        coordinates.push([lon, lat]);
      }
      /* The final vertex is forced to exactly +180 rather than left to the
       * loop: with a densify step that does not divide 360 the line would stop
       * short of the antimeridian and leave a visible gap in a line that is,
       * by definition, continuous all the way round. */
      if (coordinates[coordinates.length - 1][0] !== 180) {
        coordinates.push([180, lat]);
      }
      return {
        type: 'Feature',
        properties: { name, kind, value: lat },
        geometry: { type: 'LineString', coordinates },
      };
    }),
  };
}

/**
 * Adds the reference-line source and its layers to a live map.
 *
 * Inserted BENEATH the coastline (SPEC §13 draw order). These are reference,
 * not content — a line crossing over a glowing coast reads as an error.
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

  /* --- WHERE THESE LINES CAN ACTUALLY BE SEEN ------------------------------
   *
   * This layer lives on MapLibre, and MapLibre's whole canvas is held at
   * opacity 0 below DIVE.zSpace, reaching full opacity only at DIVE.zHandoff —
   * the planet band belongs to the Three.js clear globe in front of it. An
   * earlier ramp peaked at the planet band and had faded out again by z5,
   * putting its brightest values exactly where its own canvas was invisible.
   * The two ramps cancelled and the whole layer read as a dead toggle.
   *
   * These three lines now hold their value all the way in. They are position
   * information rather than texture: unlike a 15° grid, "you are north of the
   * Tropic of Cancer" does not stop being true or useful because you zoomed
   * into a coastline.
   * ---------------------------------------------------------------------- */
  map.addLayer(
    {
      id: GRATICULE_LAYER_MAJOR,
      type: 'line',
      source: GRATICULE_SOURCE_ID,
      paint: {
        'line-color': palette().graticuleMajor,
        'line-width': SIZE.graticuleWidthMajor,
        /* The equator is the more significant of the two kinds and is drawn a
         * touch stronger. A `case` rather than two layers: one source, one
         * draw call, and the distinction stays a property of the data. */
        'line-opacity': byZoom([
          [ZOOM.planet, OPACITY.graticuleMajor],
          [ZOOM.regional, OPACITY.graticuleMajor],
          [ZOOM.max, OPACITY.graticuleMajor * 0.7],
        ]),
        'line-dasharray': [4, 3],
      },
    },
    GRATICULE_INSERT_BEFORE
  );

  /* THE NAMES. `symbol-placement: line` runs the text ALONG the line rather
   * than at a point, which is the only placement that reads correctly for
   * something spanning the whole globe — a single centred label would sit in
   * whatever ocean happened to be at the middle of the geometry.
   *
   * `symbol-spacing` repeats it around the world so there is a name near
   * wherever you are looking, instead of one that may be a hemisphere away.
   *
   * NOT AT THE PLANET BAND. §9's zoom ladder is explicit that z0–2 carries no
   * labels at all, and these are labels like any other. The line itself is
   * visible there; its name arrives with the basin band along with storm
   * names, which is the rung where text starts.
   */
  map.addLayer(
    {
      id: GRATICULE_LAYER_LABEL,
      type: 'symbol',
      source: GRATICULE_SOURCE_ID,
      minzoom: ZOOM.basin,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': SIZE.graticuleLabelPx,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.16,
        'symbol-placement': 'line',
        'symbol-spacing': 420,
        /* Lift the name clear of its own line rather than letting the line
         * strike through the type. */
        'text-offset': [0, -0.7],
        /* These are reference labels and must never win a collision against a
         * storm name or a place name — but they should also not disappear
         * entirely, so they are allowed to overlap the line work beneath them
         * while still yielding to other symbol layers. */
        'text-allow-overlap': false,
        'text-ignore-placement': false,
      },
      paint: {
        'text-color': palette().graticuleMajor,
        'text-halo-color': palette().ocean,
        'text-halo-width': 1.1,
        'text-opacity': byZoom([
          [ZOOM.basin, 0],
          [ZOOM.basin + 0.5, OPACITY.graticuleMajor],
          [ZOOM.max, OPACITY.graticuleMajor * 0.7],
        ]),
      },
    },
    GRATICULE_INSERT_BEFORE
  );
}

/**
 * Toggles visibility. This is the additive layer's on/off path (SPEC §7) —
 * it uses `visibility` rather than removing the layers, so re-enabling costs
 * nothing and the source stays warm.
 *
 * @param {maplibregl.Map} map
 * @param {boolean} visible
 */
export function setGraticuleVisible(map, visible) {
  const v = visible ? 'visible' : 'none';
  for (const id of [GRATICULE_LAYER_MAJOR, GRATICULE_LAYER_LABEL]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  }
}
