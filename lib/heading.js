/**
 * heading.js — WHICH WAY THE STORM IS ACTUALLY GOING (SPEC-UI §16.4).
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 *
 * The storm list used to carry a ↗ or a ↘ on its third line, and neither was
 * a direction. ↗ meant "moving away from your house" and ↘ meant "closing on
 * it" — a relationship between two points dressed up as a compass mark. On a
 * row that also says "6,363 mi WNW" that is one arrow too many pointing at
 * nothing, and Aaron read it on glass exactly the way it looks: as a bearing.
 *
 * So the mark becomes a real one. North is up, the arrow points where the
 * cyclone is travelling, and the closing-versus-receding fact it used to carry
 * moves entirely onto the color and the words beside it — both of which were
 * already saying it.
 *
 * ===========================================================================
 * TWO SOURCES, IN ORDER, AND NEVER A THIRD
 * ===========================================================================
 *
 *   published   `storm.headingDeg`. NHC publishes `movementDir` on every
 *               advisory; lib/jtwc-wind.js fills the same field in for the
 *               GDACS storms JTWC happens to be warning on.
 *
 *   derived     the bearing from the storm's current position to the first
 *               forecast point far enough away to define one. Available for
 *               both sources, because data/gdacs-points.js and
 *               data/nhc-mapserver.js emit the same point shape.
 *
 *   nothing     no arrow. Not a guess, not a stale one held over, not the old
 *               ↗ borrowed back to fill the space.
 *
 * ==> THE THIRD CASE IS REAL AND IT IS NOT RARE. <== GDACS publishes no motion
 * at all (data/gdacs.js), so a GDACS storm with no JTWC warning and no
 * geometry loaded yet has neither source. DOLPHIN-26 was exactly that storm.
 * Inventing a direction for it is the §5 fabrication with a friendlier face —
 * a missing arrow reads as "not stated", a wrong one reads as fact, and the
 * fact in question is which way a cyclone is heading.
 *
 * ===========================================================================
 * WHAT THE DERIVED ONE IS AND IS NOT
 * ===========================================================================
 *
 * It is the direction of the track, which is what the arrow claims. It is NOT
 * the agency's published motion vector, and the two can differ by a few
 * degrees on a recurving storm because one is instantaneous and the other is a
 * chord across the next few hours. That difference is under the width of a
 * compass point and well under the width of the arrowhead, so nothing on
 * screen can show it. It is flagged in the return value anyway, so a caller
 * that wants to say "forecast track" rather than "moving" can.
 *
 * Pure functions. No DOM, ever. Imports: config/, lib/geo.js.
 */

import { MOTION } from '../config/constants.js';
import { bearingDeg, greatCircleNm } from './geo.js';

const finite = (n) => (Number.isFinite(n) ? Number(n) : null);

/**
 * The storm's direction of travel, in compass degrees.
 *
 * @param {object} storm       the store's storm object
 * @param {Array|null} forecast  normalized forecast points ({lon, lat, ...}),
 *        or null/[] when none have been loaded. Callers that have no geometry
 *        pass nothing and get the published answer or null.
 * @returns {{deg: number, derived: boolean}|null}
 */
export function motionHeading(storm, forecast = null) {
  if (!storm) return null;

  /* THE AGENCY'S OWN NUMBER WINS, ALWAYS, and it wins even when a track is
   * sitting right there. It is what NHC quotes in the advisory the reader can
   * go and check, and a screen disagreeing with the bulletin it cites is worse
   * than a screen that is a degree less precise. */
  const published = finite(storm.headingDeg);
  if (published != null) return { deg: norm(published), derived: false };

  const lon = finite(storm.lon);
  const lat = finite(storm.lat);
  if (lon == null || lat == null) return null;

  const pts = Array.isArray(forecast) ? forecast : [];
  if (!pts.length) return null;

  /* WALK UNTIL A POINT IS FAR ENOUGH, then stop. A forecast point almost on
   * top of the current fix is two roundings of the same position, and the
   * bearing between them swings through ninety degrees between polls on a
   * storm that has not turned at all — see MOTION.minTrackNm. The walk is
   * bounded by MOTION.maxProbePoints so a barely-moving storm gets no arrow
   * rather than one describing tomorrow. */
  const limit = Math.min(pts.length, MOTION.maxProbePoints);
  for (let i = 0; i < limit; i += 1) {
    const p = pts[i];
    const plon = finite(p?.lon);
    const plat = finite(p?.lat);
    if (plon == null || plat == null) continue;
    if (greatCircleNm(lon, lat, plon, plat) < MOTION.minTrackNm) continue;
    return { deg: norm(bearingDeg(lon, lat, plon, plat)), derived: true };
  }

  return null;
}

/** Compass degrees, normalised into [0, 360). Exported because the arrow's
 *  CSS rotation and every test that pins one both want the same wrapping, and
 *  two versions of "mod 360" is how a 359.7° heading ends up drawn at -0.3°
 *  in one place and 359.7° in another. */
export function norm(deg) {
  return ((Number(deg) % 360) + 360) % 360;
}

/**
 * The heading as WORDS, for a screen reader.
 *
 * ==> THE ARROW IS THE ONE THING ON THE ROW THAT IS PURELY VISUAL. <== The
 * canvas is `aria-hidden` and the list is this app's whole accessibility
 * surface (§16), so a fact carried by a rotation and nothing else is a fact
 * that does not exist for a reader who cannot see it. The old glyph was
 * `aria-hidden` and its meaning spliced in as a word; the new one needs the
 * same treatment and a bigger vocabulary.
 *
 * Spelled out rather than abbreviated: a screen reader says "N N E" for the
 * compass short form, which is not a direction anybody hears.
 */
const SPOKEN = Object.freeze([
  'north', 'north-northeast', 'northeast', 'east-northeast',
  'east', 'east-southeast', 'southeast', 'south-southeast',
  'south', 'south-southwest', 'southwest', 'west-southwest',
  'west', 'west-northwest', 'northwest', 'north-northwest',
]);

export function headingWords(deg) {
  if (!Number.isFinite(deg)) return null;
  return SPOKEN[Math.round(norm(deg) / 22.5) % 16];
}
