/**
 * season-frame.js — where the archive's camera goes. §57.21c.
 *
 * Two flights, and they are the two questions the archive asks of the camera:
 *
 *   ENTERING     — the globe should already be pointing at something worth
 *                  looking at by the time the board finishes loading.
 *   OPENING A STORM — the reader tapped a row to read about one storm, so the
 *                  storm should be in the strip of globe above the sheet.
 *
 * ==> IT IS ITS OWN FILE BECAUSE `main.js` IS 1,660 LINES AND §12'S ROW ON IT
 * HAS SAID SO FOR FIVE PASSES. <== These are three small decisions with real
 * reasoning behind them, and bolting them onto the orchestrator for convenience
 * is precisely what that rule forbids. `main.js` keeps the wiring; this owns
 * the arithmetic.
 *
 * ==> AND IT TAKES AN OFFSET RATHER THAN READING THE DOM. <== The same shape
 * every other flight in the app takes and for the same reason: the caller
 * measures the drawer once per flight (`offsetWidth` is a layout read) and
 * this file stays testable without a browser.
 *
 * Imports config/ and one map/ sibling. `seasons/` never reaches in here —
 * main.js injects these through the `archiveGlobe` facade (§12).
 */

import { SEASONS, ZOOM } from '../config/constants.js';
import { flyToPoint } from './globe.js';

/**
 * Where the globe should be pointing when the archive opens.
 *
 * ==> THE DOOR DECIDES, AND THE TWO DOORS ARE ASKING DIFFERENT QUESTIONS. <==
 * Aaron's call, 2026-08-25. §57.16 already gives the storm-list door and the
 * home-dashboard door different `data-door` values; this is the first thing to
 * read them.
 *
 * A reader who pressed `Past storms` at the bottom of the LIVE STORM LIST was
 * looking at this year's ocean and asked for history of it. Swinging the globe
 * to their house is a non-sequitur — their house is not what they were looking
 * at, and on the Atlantic default it puts the camera over land with the record
 * off the edge.
 *
 * A reader who pressed the same row on the HOME DASHBOARD is somewhere else
 * entirely: that whole screen is about their house, and step 9's near-home
 * filter opens from this door. Home is the honest continuation.
 *
 * @param {'storms'|'home'|null} from
 * @param {string|null} basin      the season's basin, as `seasons/index.json` keys it
 * @param {{lon:number, lat:number}|null} home
 * @returns {{lon:number, lat:number}|null}  null when there is nowhere to go
 */
export function entryTarget(from, basin, home) {
  if (from === 'home') return home || null;
  const view = SEASONS.basinView[basin];
  /* ==> A BASIN WITH NO REST POSITION FALLS BACK TO HOME, NOT TO NOTHING. <==
   * `SEASONS.basinView` covers the two basins the record holds; step 13 adds
   * the rest of the world and will add rows here. Until then an unknown basin
   * should still put the reader somewhere they recognise rather than leaving
   * the camera wherever the live app happened to have left it — which after a
   * selection is a close zoom on a storm that has just been erased. */
  return view ? { lon: view.lon, lat: view.lat } : (home || null);
}

/**
 * Point the camera at the archive on the way in.
 *
 * ==> ZOOM IS `ZOOM.basin`, WHICH IS THE FLOOR AT WHICH NAMES APPEAR. <== One
 * step in from the planet band. Entering at the space floor would put the
 * reader on a globe whose tracks carry no labels at all (`season-tracks.js`
 * sets the same floor on its name layer), so the first frame of the feature
 * would be a knot of anonymous lines.
 *
 * ==> AND THE FLIGHT IS OFFSET FOR THE SHEET, BECAUSE THE BOARD OPENS WITH IT.
 * <== `seasons/index.js` calls `drawer.go('seasons-board')` in the same breath
 * as entering, so a centred flight lands the basin under the sheet on a phone.
 */
export function flyToArchiveEntry(map, { from, basin, home, offset }) {
  const target = entryTarget(from, basin, home);
  if (!target) return false;
  flyToPoint(map, target, { zoom: ZOOM.basin, offset });
  return true;
}

/**
 * Frame one archive storm in the globe left visible above the drawer.
 *
 * ==> IT FLIES TO THE FIRST FIX, NOT TO THE WHOLE TRACK. <== Aaron on glass,
 * 2026-08-25, and it reversed what was built first. Fitting the entire track
 * reasoned well on paper — a finished storm is a curve and centring Katrina on
 * any single fix leaves most of her off screen — but the zoom that fits a
 * two-thousand-mile arc is about `ZOOM.basin`, and what that actually put on
 * screen was a panel about one storm over a lot of empty ocean. Close on the
 * start reads better, and the start is the fix that is already marked: §57.21a
 * puts the white direction ring and the name there, and §57.21c puts the glyph
 * there. The reader is flown to the thing with a mark on it.
 *
 * ==> AND THAT DELETED THE SEAM ARITHMETIC RATHER THAN SOLVING IT. <== The
 * whole-track version took bounds off `lonU`, the unwrapped longitude, because
 * a min/max over raw values on a dateline-crossing storm reports a track
 * spanning the planet. There is no span here, so there is nothing to unwrap —
 * and the seam now bites the OTHER way round, which is why the point below is
 * read off `lon` and not `lonU`. See the note on it.
 *
 * @param {object} map
 * @param {Array<{lon:number, lat:number}>} points  the storm's recorded fixes,
 *   in the order the record has them — the FIRST is the one framed
 * @param {object} opts
 * @param {[number,number]} [opts.offset]  where the centre lands on screen
 * @returns {boolean}  false when there was nothing to frame
 */
export function flyToArchiveStorm(map, points, { offset } = {}) {
  const first = (points || []).find(
    (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon)
  );
  if (!first) return false;

  /* ==> `lon`, THE PUBLISHED LONGITUDE, AND NEVER `lonU`. <== This is the one
   * seam decision left in the archive's camera and it is the reverse of the
   * one the whole-track fit had to make. `lonU` is unwrapped so that a track
   * crossing ±180 draws as one continuous line rather than jumping the map, so
   * a storm's later fixes can carry values like 185 or -190 — and `lib/hurdat.js`
   * unwraps relative to the FIRST fix, which means a start fix at 179.4°E can
   * itself be handed to the camera as a number outside ±180 in a record that
   * was unwrapped the other way.
   *
   * MapLibre takes a centre longitude literally and flies the short way to the
   * number it is given, so an out-of-range value sends the camera the long way
   * round the planet — a several-second flight across the wrong hemisphere to
   * arrive at a point it was already next to. The published value is always in
   * range and always names the right place, and there is no line being drawn
   * here for an unwrap to keep continuous. `tools/test-season-frame.mjs` drives
   * Della (CP011957), the repo's seam fixture, and the mutation is swapping
   * this one property. */
  flyToPoint(map, { lon: first.lon, lat: first.lat }, {
    zoom: SEASONS.stormZoom,
    offset,
  });
  return true;
}
