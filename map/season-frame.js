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
 * ==> AND IT TAKES A DRAWER BOX RATHER THAN READING THE DOM. <== The same
 * shape `map/home-frame.js` takes and for the same reason: the caller measures
 * once per flight (`getBoundingClientRect` is a layout read) and this file
 * stays testable without a browser.
 *
 * Imports config/, lib/ and two map/ siblings. `seasons/` never reaches in
 * here — main.js injects these through the `archiveGlobe` facade (§12).
 */

import { SEASONS, ZOOM } from '../config/constants.js';
import { flyToPoint } from './globe.js';
import { visibleStrip, fitPair } from './home-frame.js';

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
 * ==> A FINISHED STORM IS A CURVE, NOT A POINT, SO THIS FITS ITS WHOLE TRACK.
 * <== `flyToStorm` centres on a live storm's current position at a fixed zoom
 * because a live storm IS a position. Katrina is a two-thousand-mile arc from
 * the Bahamas to Ohio, and centring her at the same zoom on any single fix
 * frames a patch of ocean with most of her off the screen. The reader tapped
 * the row to look at the storm; the storm is the line.
 *
 * ==> IT REUSES `fitPair` RATHER THAN REDERIVING THE ARITHMETIC. <==
 * `map/home-frame.js` already solves "what zoom puts two points inside a box,
 * and where is the middle" — including the antimeridian unwrap and the
 * Mercator-errs-wide argument. Handing it the track's two bounding corners is
 * the same question with different points in it. A second copy of that
 * arithmetic is a second place for the seam to be got wrong.
 *
 * @param {object} map
 * @param {Array<{lon:number, lat:number}>} points  the storm's recorded fixes
 * @param {object} opts
 * @param {{width:number, height:number}} opts.viewport
 * @param {{width:number, height:number, wide:boolean}} opts.drawerBox
 * @param {[number,number]} [opts.offset]  where the centre lands on screen
 * @returns {boolean}  false when there was nothing to frame
 */
export function flyToArchiveStorm(map, points, { viewport, drawerBox, offset }) {
  const pts = (points || []).filter(
    (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon)
  );
  if (!pts.length) return false;

  /* ==> BOUNDS OFF `lonU`, THE UNWRAPPED LONGITUDE. <== This is the one place
   * in the archive's camera work where the seam bites. A storm running from
   * 179.2°W to 179.9°E publishes two longitudes 0.9° apart whose numbers differ
   * by 359.1, so a min/max over the raw values reports a track spanning the
   * whole planet and `fitPair` dutifully zooms out to the space floor to fit
   * it. `lib/hurdat.js` carries `lonU` on every point for exactly this, and
   * `season-tracks.js` draws it for the same reason. Falling back to `lon` when
   * a point somehow lacks it keeps a malformed record framable rather than
   * unopenable. */
  const lons = pts.map((p) => (Number.isFinite(p.lonU) ? p.lonU : p.lon));
  const lats = pts.map((p) => p.lat);

  const strip = visibleStrip(viewport, drawerBox);
  const fit = fitPair({
    home: { lon: Math.min(...lons), lat: Math.min(...lats) },
    storm: { lon: Math.max(...lons), lat: Math.max(...lats) },
    strip,
  });

  /* ==> CLAMPED AT BOTH ENDS. <== A one-fix storm — real, and common before
   * 1900 — has zero extent on both axes, so `fitPair` divides by zero on both
   * and answers `Infinity`. Without a ceiling that is a flight to the maximum
   * zoom the style has, arriving at a single dot over featureless water. The
   * floor matters less often and is the same idea: a storm that genuinely
   * crossed half the planet should not push the camera below the band where
   * its own name is allowed to draw. */
  const zoom = Math.max(ZOOM.basin, Math.min(ZOOM.max, fit.zoom));
  flyToPoint(map, fit.center, { zoom, offset });
  return true;
}
