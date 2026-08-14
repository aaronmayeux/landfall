/**
 * map/home-frame.js — WHERE THE CAMERA GOES WHEN THE HOME DRAWER OPENS.
 *
 * SPEC-MAP.md §9.16.
 *
 * ==> IT FRAMES THE PAIR. HOUSE AND STORM, SHARING THE SPACE ABOVE THE DRAWER.
 * <== This drawer is about a RELATIONSHIP, and a camera pointed at either end
 * of it tells half the story. Centring on the house put the panel's whole
 * subject off screen; centring on the storm made the Home button do what
 * tapping that storm in the list already does, and quietly stopped `Home`
 * meaning *you*. So the camera centres BETWEEN them and takes the zoom that
 * fits both, with the centre pushed up into the visible strip so the pair sits
 * above the sheet rather than behind it.
 *
 * ==> AND IT STOPS DOING THAT WHEN THE PAIR NO LONGER FITS, WHICH IS THE PART
 * WORTH ARGUING ABOUT. <== `pickThreatStorm` has NO distance limit — with
 * nothing near you it returns the nearest active cyclone anywhere on Earth. The
 * midpoint between New Orleans and a typhoon off Japan is open Pacific with
 * neither end legible: the drawer would open on a view of nothing, to frame
 * something that is not a threat. So below `GLOBE.homeFrameMinZoom` the pair is
 * declared unframable, the camera falls back to the house alone, and the storm
 * is honestly off screen. There IS a discontinuity at that boundary. It sits
 * around 1,800 nm on a phone, where the two ends are a handful of pixels apart
 * anyway, and the alternative — a midpoint view containing neither end — is
 * worse than a jump.
 *
 * ==> NO `fitBounds`, DELIBERATELY. <== Handing MapLibre's bounds fitting a box
 * that crosses the antimeridian is a coin flip about which way round the world
 * it goes, it knows nothing about the drawer, and it cannot express "give up
 * and frame one end". The arithmetic below is exact for Mercator, handles the
 * wrap explicitly, and is a dozen lines.
 *
 * ==> IT WORKS IN MERCATOR WORLD UNITS, NOT IN GROUND MILES. <== What has to
 * fit on screen is SCREEN separation, and on a Mercator grid that is not
 * proportional to ground distance — 400 miles north-south near Alaska is far
 * more pixels than 400 miles near Florida. Nautical miles are the wrong
 * currency for this question and would frame high-latitude pairs too tightly.
 * The midpoint is likewise the MERCATOR midpoint rather than the great-circle
 * one: that is the point that puts the two ends equally far apart on the glass,
 * which is the thing being asked for.
 *
 * Pure — no map, no DOM, no clock. Everything it needs is passed in, so
 * tools/test-home-frame.mjs drives every band on plain node.
 *
 * Imports: config/constants.js only.
 */

import { GLOBE } from '../config/constants.js';

/** MapLibre's world is 512 CSS pixels across at zoom 0. NOT 256 — that is the
 *  raster-tile convention and would put every zoom here one whole level out. */
const WORLD_PX_Z0 = 512;

/**
 * How much of the visible strip the pair is allowed to fill.
 *
 * Not 1.0. At 1.0 the two ends land exactly on the edges of the visible area —
 * on a globe that is the curve of the limb, where a glyph is foreshortened into
 * a smear. Technically framed, practically not there. This leaves a quarter of
 * the strip as margin so both ends sit inside the picture.
 */
const FILL = 0.75;

/* ---------------------------------------------------------------------------
 * MERCATOR
 * ------------------------------------------------------------------------- */

/** Longitude to world X, 0..1 across the planet. Linear — the easy half. */
const mercX = (lon) => (lon + 180) / 360;

/**
 * Latitude to world Y, 0..1 top to bottom. The half that is NOT linear, and the
 * reason the same gap needs a wider view further north.
 *
 * Clamped to ±85.0511°, MapLibre's own Mercator limit: the projection runs to
 * infinity at the poles, and a house in Antarctica would otherwise produce an
 * infinite separation and a zoom of negative infinity.
 */
function mercY(lat) {
  const phi = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI);
}

/** World Y back to latitude. */
const latFromMercY = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/**
 * The storm's longitude expressed on the same side of the world as the house.
 *
 * ==> WITHOUT THIS, A GULF HOUSE AND A WEST-PACIFIC TYPHOON FRAME THE LONG WAY
 * ROUND. <== Home at -90 and a storm at +170 are 100° apart across the
 * antimeridian, but subtract the raw numbers and you get 260° — so the camera
 * would compute a separation covering three quarters of the planet and put the
 * midpoint in Africa. Shifting the storm by whole turns until the gap is under
 * half the world makes the short way the only way.
 */
function unwrapLon(lon, referenceLon) {
  let out = lon;
  while (out - referenceLon > 180) out -= 360;
  while (out - referenceLon < -180) out += 360;
  return out;
}

/** Back into -180..180 for MapLibre. */
const normalizeLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/* ---------------------------------------------------------------------------
 * THE VISIBLE STRIP
 * ------------------------------------------------------------------------- */

/**
 * The globe you can actually see, in CSS pixels, once the drawer is subtracted.
 *
 * ==> THE DRAWER IS NOT PART OF THE PICTURE, AND THIS IS THE ONLY PLACE THAT
 * KNOWS IT. <== On a phone the sheet eats the bottom; at desktop widths it is a
 * left rail and eats the side. The camera is offset into what is left
 * (`panelOffsetFor` in app/views.js), so the box the pair must fit inside is
 * the REMAINDER. Fitting against the full viewport would put one end behind the
 * panel that just opened — the exact bug the offset exists to prevent,
 * reintroduced one layer up.
 *
 * ==> BOTH DIMENSIONS, NOT THE SHORT SIDE. <== A house and a storm on the same
 * latitude need width; one due north of the other needs height. Collapsing to
 * the short side would fit an east-west pair against the strip's HEIGHT and
 * zoom out much further than it ever had to.
 *
 * @returns {{width:number, height:number}}
 */
export function visibleStrip(viewport, drawerBox) {
  const vw = Math.max(1, viewport?.width || 0);
  const vh = Math.max(1, viewport?.height || 0);
  const dw = Math.max(0, drawerBox?.width || 0);
  const dh = Math.max(0, drawerBox?.height || 0);

  return drawerBox?.wide
    ? { width: Math.max(1, vw - dw), height: vh }
    : { width: vw, height: Math.max(1, vh - dh) };
}

/* ---------------------------------------------------------------------------
 * THE FIT
 * ------------------------------------------------------------------------- */

/**
 * The zoom at which two points fit inside a box, and the point halfway between.
 *
 * THE ARITHMETIC. At zoom z the world is `512 · 2^z` pixels across, so a world
 * separation of Δ is `Δ · 512 · 2^z` pixels on screen. Both axes have to fit at
 * once:
 *
 *     2^z ≤ W · FILL / (512 · Δx)     and     2^z ≤ H · FILL / (512 · Δy)
 *
 * so the answer is whichever axis is tighter. A pair separated on only one axis
 * gives the other a zero denominator, which is `Infinity` — correctly meaning
 * "this axis imposes no limit" — and `Math.min` discards it.
 *
 * ==> IT ERRS TOWARD TOO WIDE, WHICH IS THE SAFE DIRECTION. <== This is the
 * Mercator relationship, and below the handoff MapLibre is drawing a SPHERE,
 * which shows MORE ground than Mercator at the same zoom number. Where the two
 * disagree the real view holds more than promised and both ends are still in
 * frame. The opposite error would put one just off the edge.
 *
 * @returns {{center:{lat:number, lon:number}, zoom:number}}
 */
export function fitPair({ home, storm, strip }) {
  const stormLon = unwrapLon(storm.lon, home.lon);

  const dx = Math.abs(mercX(stormLon) - mercX(home.lon));
  const dy = Math.abs(mercY(storm.lat) - mercY(home.lat));

  const byWidth = dx > 0 ? (strip.width * FILL) / (WORLD_PX_Z0 * dx) : Infinity;
  const byHeight = dy > 0 ? (strip.height * FILL) / (WORLD_PX_Z0 * dy) : Infinity;
  const scale = Math.min(byWidth, byHeight);

  return {
    center: {
      lat: latFromMercY((mercY(home.lat) + mercY(storm.lat)) / 2),
      lon: normalizeLon((home.lon + stormLon) / 2),
    },
    /* Both axes unlimited means the storm is exactly on the house. There is no
     * separation to frame, so there is no fit — Infinity, and the caller's
     * ceiling decides. */
    zoom: Math.log2(scale),
  };
}

/* ---------------------------------------------------------------------------
 * THE DECISION
 * ------------------------------------------------------------------------- */

/**
 * Where the camera goes when the Home drawer opens, or `null` for "do not move".
 *
 * NULL IS A REAL ANSWER. With no home set there is nothing to frame against —
 * the drawer is showing the "Set your home" prompt, and yanking the globe
 * somewhere arbitrary would be noise.
 *
 * FOUR OUTCOMES, named in `framed` so a check and a human can both see which
 * one they got:
 *
 *   `pair`       both ends in the visible strip, centred between them. The
 *                normal case and the one the feature exists for.
 *   `too-close`  the fit wants to zoom past `GLOBE.homeZoom`. A storm making
 *                landfall on your street must not zoom closer than "take me to
 *                my house" does, so it caps there and the pair simply sits
 *                comfortably inside the frame instead of filling it. The centre
 *                stays between them — they are both on screen either way.
 *   `too-far`    the fit wants to zoom below `GLOBE.homeFrameMinZoom`. The pair
 *                is not framable, so the CENTRE changes too: back to the house,
 *                at the floor, with the storm honestly off screen.
 *   `house-only` no storm in the ranking. The house at `GLOBE.homeZoom`.
 *
 * @param {object} o
 * @param {{lat:number, lon:number}|null} o.home
 * @param {{lat:number, lon:number}|null} o.storm  the threat storm, or null
 * @param {{width:number, height:number}} o.viewport
 * @param {{width:number, height:number, wide:boolean}} o.drawerBox
 * @returns {{center:{lat:number, lon:number}, zoom:number, framed:string}|null}
 */
export function homeFrame({ home, storm, viewport, drawerBox }) {
  if (!home || !Number.isFinite(home.lat) || !Number.isFinite(home.lon)) return null;

  const houseAlone = (zoom, framed) => ({
    center: { lat: home.lat, lon: home.lon },
    zoom,
    framed,
  });

  if (!storm || !Number.isFinite(storm.lat) || !Number.isFinite(storm.lon)) {
    return houseAlone(GLOBE.homeZoom, 'house-only');
  }

  const fit = fitPair({ home, storm, strip: visibleStrip(viewport, drawerBox) });

  /* Storm exactly on the house — no separation, no fit. Treat it as the house. */
  if (!Number.isFinite(fit.zoom)) return houseAlone(GLOBE.homeZoom, 'too-close');

  /* ==> THE FLOOR IS A TEST, NOT A CLAMP. <== Clamping the zoom up while
   * keeping the midpoint would leave the camera pointed at open ocean between
   * two things it still could not fit — the worst of both. Failing the fit has
   * to change the CENTRE as well, which is why this returns rather than
   * clamping like the ceiling below does. */
  if (fit.zoom < GLOBE.homeFrameMinZoom) {
    return houseAlone(GLOBE.homeFrameMinZoom, 'too-far');
  }

  return {
    center: fit.center,
    zoom: Math.min(GLOBE.homeZoom, fit.zoom),
    framed: fit.zoom > GLOBE.homeZoom ? 'too-close' : 'pair',
  };
}
