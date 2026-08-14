/**
 * map/home-frame.js — WHERE THE CAMERA GOES WHEN THE HOME DRAWER OPENS.
 *
 * SPEC-MAP.md §9.16.
 *
 * ==> THE CENTRE IS ALWAYS THE HOUSE. THE ZOOM IS WHAT ADAPTS. <== The Home
 * drawer is about a RELATIONSHIP — your house and the storm the ranking picked
 * — and a camera can only be pointed at one place. Two answers were considered
 * and both were wrong for the same reason:
 *
 *   Fly to the STORM. Then the Home button does exactly what tapping that storm
 *   in the storm list already does, and "Home" quietly stops meaning *you*.
 *   Worse: `pickThreatStorm` has NO distance limit — with nothing near you it
 *   returns the nearest active cyclone anywhere on Earth. So on a quiet day the
 *   Home button would swing the globe to a typhoon off Japan while the panel
 *   underneath said nothing is near you. The camera would be arguing with the
 *   words.
 *
 *   Fly to the HOUSE at a fixed zoom. Honest, but it puts the panel's whole
 *   subject off screen whenever the storm is more than a few hundred miles out,
 *   and it duplicates what tapping the house glyph on the globe already does.
 *
 * So: centre on the house every single time — a promise the camera can keep in
 * every weather — and choose the zoom so the storm is IN FRAME when it is close
 * enough for that to mean anything. When it is not, the view simply widens
 * around the house and the storm is not there, which is the truth.
 *
 * ==> NO `fitBounds`, DELIBERATELY. <== Framing two points with MapLibre's
 * bounds fitting means handing the globe projection a box that wraps the
 * antimeridian for any trans-Pacific pair, and it returns a centre we do not
 * want anyway (the midpoint between you and the storm, i.e. open ocean). The
 * arithmetic below is a dozen lines, has no projection edge cases, and keeps
 * the centre fixed on the one point that matters.
 *
 * Pure — no map, no DOM, no clock. Everything it needs is passed in, so
 * tools/test-home-frame.mjs can drive every band on plain node.
 *
 * Imports: config/constants.js only.
 */

import { GLOBE } from '../config/constants.js';

/**
 * Metres per pixel at zoom 0 on the equator, for MapLibre's 512px tile grid.
 * Earth's equatorial circumference (40,075,016.686 m) over 512 px. NOT the
 * 156543.03 figure quoted in most tutorials — that one is for 256px tiles and
 * would put every zoom here one whole level out.
 */
const M_PER_PX_Z0 = 40075016.686 / 512;

/** Nautical mile in metres, exactly, by definition. */
const M_PER_NM = 1852;

/**
 * How much of the visible strip the house-to-storm gap is allowed to fill.
 *
 * Not 1.0. At 1.0 the storm lands exactly on the edge of the visible area,
 * which on a globe means it is on the curve of the limb where a glyph is
 * foreshortened into a smear — technically framed, practically not there. This
 * leaves a quarter of the strip as margin so the storm sits inside the picture
 * rather than on its border.
 */
const FILL = 0.75;

/**
 * The visible strip of globe, in CSS pixels, once the drawer is subtracted.
 *
 * ==> THE DRAWER IS NOT PART OF THE PICTURE, AND THIS IS THE ONLY PLACE THAT
 * KNOWS IT. <== On a phone the sheet eats the bottom; at desktop widths it is a
 * left rail and eats the side. The camera is already offset into what is left
 * (`panelOffsetFor` in app/views.js), so the space the storm has to land in is
 * the REMAINDER, not the viewport. Framing against the full viewport would put
 * the storm behind the panel that just opened — the exact bug the offset
 * exists to prevent, reintroduced one layer up.
 *
 * @param {{width:number, height:number}} viewport
 * @param {{width:number, height:number, wide:boolean}} drawerBox
 * @returns {number} the short side of the visible strip, in px
 */
export function visibleShortSide(viewport, drawerBox) {
  const vw = Math.max(1, viewport?.width || 0);
  const vh = Math.max(1, viewport?.height || 0);
  const dw = Math.max(0, drawerBox?.width || 0);
  const dh = Math.max(0, drawerBox?.height || 0);

  const usableW = drawerBox?.wide ? Math.max(1, vw - dw) : vw;
  const usableH = drawerBox?.wide ? vh : Math.max(1, vh - dh);

  return Math.min(usableW, usableH);
}

/**
 * The zoom that frames a storm `nm` away from a house at `lat`.
 *
 * THE ARITHMETIC. At zoom z and latitude φ, one pixel covers
 * `M_PER_PX_Z0 * cos(φ) / 2^z` metres. Half the visible strip therefore covers
 * `(S/2) * that`. Setting that half-extent equal to the gap and solving for z:
 *
 *     2^z = S * M_PER_PX_Z0 * cos(φ) * FILL / (2 * gap)
 *
 * `cos(φ)` is Mercator's stretch, and it is the reason a storm 500 nm from a
 * house in Maine needs a wider view than one 500 nm from a house in Florida:
 * the same ground distance is more pixels the further north you are.
 *
 * ==> IT ERRS TOWARD TOO WIDE, WHICH IS THE SAFE DIRECTION. <== This is the
 * Mercator relationship, and at low zoom MapLibre is drawing a SPHERE, which
 * shows MORE ground than Mercator would for the same zoom number. So where the
 * two disagree, the real view contains more than this promised — the storm is
 * still in frame. The opposite error would put it just off the edge.
 *
 * @param {object} o
 * @param {number} o.lat        the house's latitude
 * @param {number} o.nm         house-to-storm distance in nautical miles
 * @param {number} o.shortSide  visible strip's short side in px
 * @returns {number} a MapLibre zoom, already clamped to the band below
 */
export function zoomToFrame({ lat, nm, shortSide }) {
  const gap = Math.max(1, (Number(nm) || 0) * M_PER_NM);
  /* Clamped off the poles: cos(90°) is 0 and would collapse the whole
   * expression. 85° is MapLibre's own Mercator limit.
   *
   * THE `Math.abs` IS DEFENSIVE AND CURRENTLY UNOBSERVABLE — said plainly so
   * nobody spends an afternoon writing the test that proves it. Cosine is even,
   * so it changes nothing for ordinary southern latitudes; it exists so that
   * `Math.min(85, -90)` gives 85 rather than -90. Today the resulting zoom is
   * floored to `homeFrameMinZoom` either way, so no output distinguishes the
   * two. It stays because the floor is a tunable number and this is a trap
   * waiting for the day somebody lowers it. */
  const phi = (Math.min(85, Math.abs(Number(lat) || 0)) * Math.PI) / 180;

  const ratio = (shortSide * M_PER_PX_Z0 * Math.cos(phi) * FILL) / (2 * gap);
  const z = Math.log2(Math.max(Number.EPSILON, ratio));

  return clampFrameZoom(z);
}

/**
 * The band a framing zoom is allowed to live in.
 *
 * ==> A FLOOR, NOT A CLIFF. <== The first shape of this rule was "past N miles,
 * forget the storm and go to homeZoom", which is a discontinuity: 1,999 miles
 * gives you the whole hemisphere and 2,001 miles snaps to your street. A floor
 * is continuous — the view widens as the storm gets further away and then
 * simply stops widening, and past that point the storm is off screen without
 * anything jumping.
 *
 * The CEILING is `GLOBE.homeZoom`, the same zoom tapping the house glyph gives
 * you. A storm 30 miles away must not zoom you further in than "take me to my
 * house" does, or the two ways of looking at your own home disagree.
 *
 * The FLOOR is `GLOBE.homeFrameMinZoom`. On a phone-sized strip that is roughly
 * a 1,800 nm reach — about three to four days of storm travel, which is as far
 * out as "this one is coming for me" still means anything.
 */
export function clampFrameZoom(z) {
  if (!Number.isFinite(z)) return GLOBE.homeZoom;
  return Math.max(GLOBE.homeFrameMinZoom, Math.min(GLOBE.homeZoom, z));
}

/**
 * The whole decision, in one call: where the camera goes when the Home drawer
 * opens, or `null` for "do not move".
 *
 * NULL IS A REAL ANSWER AND IT IS RETURNED IN TWO CASES. With no home set there
 * is nothing to centre on — the drawer is showing the "Set your home" prompt
 * and yanking the globe somewhere arbitrary would be noise. With no storm in
 * the ranking, the house still gets framed, but at `GLOBE.homeZoom` rather than
 * a computed one: there is no gap to frame.
 *
 * @param {object} o
 * @param {{lat:number, lon:number}|null} o.home
 * @param {number|null} o.nm  distance to the threat storm, or null
 * @param {{width:number, height:number}} o.viewport
 * @param {{width:number, height:number, wide:boolean}} o.drawerBox
 * @returns {{center:{lat:number, lon:number}, zoom:number}|null}
 */
export function homeFrame({ home, nm, viewport, drawerBox }) {
  if (!home || !Number.isFinite(home.lat) || !Number.isFinite(home.lon)) return null;

  if (!Number.isFinite(nm) || nm <= 0) {
    return { center: { lat: home.lat, lon: home.lon }, zoom: GLOBE.homeZoom };
  }

  const shortSide = visibleShortSide(viewport, drawerBox);
  return {
    center: { lat: home.lat, lon: home.lon },
    zoom: zoomToFrame({ lat: home.lat, nm, shortSide }),
  };
}
