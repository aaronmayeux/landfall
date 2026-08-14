/**
 * place-label.js — what to CALL the place a home sits on (SPEC-UI §8).
 *
 * ==> ONE FUNCTION, BECAUSE THERE ARE FOUR SCREENS AND THEY MUST AGREE. <==
 * The setup panel's current-home line, the confirm step, the live label under
 * a pin being dragged, and the dashboard's footer row all answer the same
 * question. Before this file, three of them wrote `h.label || h.lat.toFixed(3)
 * + ', ' + h.lon.toFixed(3)` inline and the fourth wrote something slightly
 * different. A home whose name is decided in four places is a home that gets
 * called four things.
 *
 * ==> AND BECAUSE "NO NAME" HAS THREE MEANINGS, NOT ONE. <== The old fallback
 * printed coordinates for all of them, which is §5's silent-failure rule
 * broken in miniature: `29.301, -94.798` is what the app says whether the
 * point is in open water, in unnamed backcountry, or whether the lookup simply
 * failed and we have no idea. Those are three different facts and the user is
 * entitled to know which one they are looking at.
 *
 *   named    a place we can name          "Galveston, Texas, United States"
 *   water    the basemap says this is water  "Open water"
 *   unnamed  on land, nothing named near it  "Unnamed location"
 *   unknown  we could not find out            the coordinates, honestly
 *
 * ==> WATER IS NOT A WARNING. <== Somebody may deliberately watch a point in
 * the Gulf — a rig, a passage, a boat's route — and telling them their home is
 * wrong would be the app second-guessing a choice it has no standing to
 * question. "Open water" is a description, styled like every other place name,
 * and nothing anywhere treats it as an error.
 *
 * Imports: nothing. Pure formatting, so it is testable on plain node.
 */

/** The four kinds a home's place can be. Exported so callers compare against a
 *  constant rather than a typo'd string literal. */
export const PLACE_KIND = Object.freeze({
  named: 'named',
  water: 'water',
  unnamed: 'unnamed',
  unknown: 'unknown',
});

/** Three decimals is about 100 m. Fine enough to tell two candidate pins
 *  apart, coarse enough not to read as false precision on something a thumb
 *  placed. The same figure the reverse-lookup cache key uses, so what is
 *  printed and what was asked for are the same number. */
export function coordText(at) {
  if (!at || !Number.isFinite(at.lat) || !Number.isFinite(at.lon)) return '';
  return `${at.lat.toFixed(3)}, ${at.lon.toFixed(3)}`;
}

/**
 * Work out the kind from the two independent answers, which arrive from two
 * unrelated sources and may arrive in either order.
 *
 * @param {object} opts
 * @param {string|null} opts.label   a name, if the reverse lookup found one
 * @param {'water'|'land'|'unknown'} [opts.water]  what the basemap says
 * @param {boolean} [opts.lookupFailed] the lookup errored rather than finding
 *        nothing — the distinction §5 insists on everywhere else
 */
export function placeKindFrom({ label, water = 'unknown', lookupFailed = false }) {
  /* ==> A NAME WINS OVER THE WATER FLAG, AND THE ORDER MATTERS. <== Coastal
   * towns, harbours and river mouths all produce points the basemap calls
   * water while the geocoder confidently names them, and at the resolutions
   * involved the tile edge and the real shoreline are simply not the same
   * line. Somebody who searched "Galveston" and got a pin thirty metres into
   * the bay must not be told they live in open water. If we have a name, we
   * have the better fact. */
  if (label) return PLACE_KIND.named;
  if (water === 'water') return PLACE_KIND.water;
  if (lookupFailed) return PLACE_KIND.unknown;
  if (water === 'land') return PLACE_KIND.unnamed;
  return PLACE_KIND.unknown;
}

/**
 * The one line to print for a home.
 *
 * @param {object} home  a stored home: { lon, lat, label, place }
 * @returns {string}
 */
export function placeText(home) {
  if (!home) return '';

  /* OLD HOMES HAVE NO `place` FIELD AT ALL, and they must not all become
   * "Unnamed location" the moment this ships. A stored label is a name that
   * was good enough yesterday; treat it as one. Without a label there is
   * genuinely nothing recorded, so the coordinates are the honest answer until
   * the setup panel resolves it. */
  const kind = home.place || (home.label ? PLACE_KIND.named : PLACE_KIND.unknown);

  if (kind === PLACE_KIND.named && home.label) return home.label;
  if (kind === PLACE_KIND.water) return 'Open water';
  if (kind === PLACE_KIND.unnamed) return 'Unnamed location';
  return coordText(home);
}

/**
 * The quiet second line under it, or '' when there is nothing worth adding.
 *
 * Coordinates appear here for every kind EXCEPT `unknown`, where they are
 * already the headline and repeating them would be the app saying the same
 * thing twice in two sizes.
 */
export function placeSubText(home) {
  if (!home) return '';
  const kind = home.place || (home.label ? PLACE_KIND.named : PLACE_KIND.unknown);
  if (kind === PLACE_KIND.unknown) return '';
  return coordText(home);
}
