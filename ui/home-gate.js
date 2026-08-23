/**
 * home-gate.js (ui) — does the storm on screen reach the reader's house?
 * SPEC §56.9.
 *
 * ==> ONE TEST, ASKED TWICE, AND THAT IS THE WHOLE DESIGN. <== The corridor
 * that decides *which flood alerts belong to this storm* (§56.3) is the same
 * question as *does this storm reach my house*. Same function, same samples,
 * same `RAIN.floodCorridorNm` — so the home screen and the alert list cannot
 * come to different conclusions about one storm.
 *
 * ==> AND THE PROBLEM IT SOLVES IS POSITION, NOT ARITHMETIC. <== The home
 * dashboard has a stepper and every cyclone on Earth can be cycled through it.
 * `Rain` and `Flooding` are plain queries at the reader's address with no storm
 * in them, so stepping to a Japan typhoon left a rainfall figure sitting under
 * its name — a true number claiming a connection nobody made. There is no
 * exception to catch and no wrong digit to spot, which is exactly why it needed
 * a rule of its own rather than a line inside a render function.
 *
 * ==> IT IS ITS OWN FILE BECAUSE `ui/view-home.js` IS OVER §12's CEILING. <==
 * That file takes a seam and nothing else: one call, handed the three things
 * only it knows — the home, the storm on screen, and the geometry bundle if it
 * has landed. Everything with a rule in it is here. Same shape as
 * `ui/countdown-home.js`, deliberately.
 *
 * Pure. No DOM, no fetch, no module state.
 *
 * Imports: lib/ only (§12).
 */

import { homeInCorridor } from '../lib/flood.js';

/**
 * How near the storm on screen actually comes to the house, or null when there
 * is nothing to ask about — no home, or no storm.
 *
 * ==> THE BUNDLE IS OPTIONAL AND ITS ABSENCE IS NOT AN UNKNOWN. <== It lands
 * after the first paint, so for the first moment of every storm there is no
 * track to measure. `homeInCorridor` always carries the storm's own published
 * position, so an answer exists from the first frame — and because adding track
 * samples can only LOWER the nearest distance, the answer can only get more
 * inclusive as the geometry arrives. **A section can appear under the reader;
 * one can never vanish from under their finger.**
 *
 * @param {{lat:number, lon:number}|null} home
 * @param {{lat:number, lon:number}|null} storm the storm on screen.
 * @param {{past?:Array, forecast?:Array}|null} bundle the geometry, if it has
 *   landed. Null while it is in flight, on a failure, and on an ended storm
 *   rebuilt from a skeleton.
 */
export function houseCorridor({ home = null, storm = null, bundle = null } = {}) {
  if (!home || !storm) return null;
  return homeInCorridor({
    storm,
    past: bundle?.past || [],
    forecast: bundle?.forecast || [],
    home,
  });
}

/**
 * Do the house sections — `Rain` and `Flooding` — draw at all right now?
 *
 * ==> THE NO-STORM CASE IS AN EXCEPTION AND IT IS NOT A LOOPHOLE. <== On a calm
 * day with nothing near, showing the reader their own rain forecast and any
 * alert over their address is this screen's entire job. What the gate forbids
 * is those sections rendering UNDER a storm they have nothing to do with — not
 * their existing. So: in range, **or no storm on screen at all**.
 *
 * ==> WITHOUT THAT SECOND ARM THE GATE ONLY EVER SUBTRACTS. <== Until §56.9
 * both sections were built only where a threat storm existed, so a genuinely
 * quiet day showed the reader neither. Adding the corridor and not the
 * exception would have made a quiet day emptier still, which is the opposite of
 * what this screen is for.
 *
 * No home is `false`, and that is not §5's silence: it is a question nobody
 * asked, and the caller draws nothing for it either way.
 */
export function houseSectionsShow({ home = null, storm = null, bundle = null } = {}) {
  if (!home) return false;
  if (!storm) return true;
  return houseCorridor({ home, storm, bundle })?.inside === true;
}
