/**
 * future-slots.js — "keep history, drop the future", in one place.
 *
 * ==> WHY THIS IS ITS OWN FILE <==
 * This rule was born inside lib/silence.js and belonged there while silence
 * was the only reason to apply it. §5's ended state is the second reason: a
 * storm whose agency has issued its final bulletin has exactly the same
 * problem a silent storm does — a cone and a watch stripe on screen that are
 * claims about a future nobody is publishing any more.
 *
 * The project rule is that a pattern used twice gets extracted BEFORE the
 * second use. There is a sharper reason than tidiness here: two copies of this
 * list can drift, and a drifted copy means a storm that hides its cone when it
 * goes quiet and keeps it when it dies — an inconsistency in the one direction
 * §5 cares about, discovered by a user rather than by us.
 *
 * ==> THE RULE <==
 * `pastTrack` and `windSwath` are RECORDS. A day-old record of where a storm
 * has been is still true, and a week-old one is still true. The cone, the
 * forecast track, the forecast points, model guidance, the current wind field
 * and any watch/warning stripe are all CLAIMS about now or next, and neither a
 * silent publisher nor a finished storm supports making them.
 *
 * Pure functions. No DOM, ever. No imports.
 */

/** The slots that make a claim about NOW or NEXT.
 *
 *  `windCurrent` is on this list and `windSwath` is not, which is the whole
 *  rule in one pair: the current wind field says "these are the winds out
 *  there", which nobody knows once the publishing stops. The swath says "these
 *  are the winds this storm has already laid down", which stays true however
 *  long it has been.
 *
 *  `watchWarning` is here for a sharper reason than tidiness. Those are live
 *  government orders, and an expired evacuation stripe painted as current is
 *  the most dangerous thing this app could draw. */
export const FUTURE_SLOTS = Object.freeze([
  'cone',
  'forecastTrack',
  'forecastPoints',
  'watchWarning',
  'modelTracks',
  'windCurrent',
]);

/** An emptied slot. `none` rather than `unavailable`: nothing failed, and a
 *  layer row reporting a fault it did not have would send someone hunting a
 *  dead endpoint. */
const EMPTY_SLOT = Object.freeze({ status: 'none', fc: null, error: null });

/**
 * A bundle with every forward-looking slot emptied, plus `forecast` cleared so
 * the closest-approach maths has nothing to run on.
 *
 * A SHALLOW COPY, never a mutation — the same rule main.js follows for model
 * tracks, and for the same reason: the bundle is a cached object shared with
 * the ambient collections and the cage's ridge builder, so writing into it
 * would strip a storm everywhere it is held, permanently, including after a
 * fresh advisory arrives and brings it back to life.
 *
 * `stamp` is deliberately preserved. The panel still needs to say which
 * advisory the surviving past track came from.
 */
export function withoutFuture(bundle) {
  if (!bundle || !bundle.layers) return bundle;
  const layers = { ...bundle.layers };
  for (const key of FUTURE_SLOTS) {
    if (key in layers) layers[key] = EMPTY_SLOT;
  }
  return { ...bundle, layers, forecast: [] };
}
